/**
 * 库存周转、库龄与呆滞处理（COO-05）
 *
 * 数据口径：
 *   1. 库龄 / 呆滞：e2_xitems_daily_status 快照，按料件汇总数量、金额、库龄与减值
 *   2. 周转率 / 周转天数：mgm_finance_summary 近 12 个月销售成本 ÷ 平均存货价值（stock_value_amt）
 *   3. 需求（补货依据）：近 12 个月 SO 交货数量；无销售数据的料件以 PO 采购数量近似
 *   4. 呆滞判定：库龄 > 90 天，或库存覆盖天数 > 180 天
 *   5. 补货：目标覆盖天数（默认 30）不足时给出建议补货量；超储/呆滞给出暂缓采购建议
 */

const { pool } = require('../config/db');

const DEFAULTS = { target_days: 30, lead_days: 15, safety_days: 30 };
const BUCKETS = [
    { key: 'A', min: 0, max: 30 },
    { key: 'B', min: 31, max: 90 },
    { key: 'C', min: 91, max: 180 },
    { key: 'D', min: 181, max: null }
];

function round2(v) { return Math.round(Number(v || 0) * 100) / 100; }
function round4(v) { return Math.round(Number(v || 0) * 10000) / 10000; }

function bucketOf(days) {
    const d = Number(days || 0);
    if (d <= 30) return 'A';
    if (d <= 90) return 'B';
    if (d <= 180) return 'C';
    return 'D';
}

function daysBetween(from, to) {
    if (!from || !to) return null;
    return Math.round((new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00')) / 86400000);
}

function ymd(d) {
    return d ? String(d).slice(0, 10) : null;
}

/** 可用快照日期（新→旧） */
async function getSnapshotDates(bu_no) {
    const [rows] = await pool.execute(`
        SELECT stock_date, COUNT(*) item_rows, SUM(stock_value) stock_value
        FROM e2_xitems_daily_status
        WHERE bu_no=? AND stock_date IS NOT NULL
        GROUP BY stock_date
        ORDER BY stock_date DESC`, [bu_no]);
    return rows.map(r => ({
        stock_date: ymd(r.stock_date),
        item_rows: Number(r.item_rows || 0),
        stock_value: round2(r.stock_value)
    }));
}

/**
 * 默认快照 = 同一 BU 内料件行数最多的最近日期
 * （避免个别日期只有少量补录数据，导致库龄结构失真）
 */
async function resolveStockDate(bu_no, stock_date) {
    const dates = await getSnapshotDates(bu_no);
    if (!dates.length) return { stock_date: null, dates };
    if (stock_date && dates.some(d => d.stock_date === ymd(stock_date))) {
        return { stock_date: ymd(stock_date), dates };
    }
    const best = dates.reduce((m, d) => {
        if (!m) return d;
        if (d.item_rows > m.item_rows) return d;
        if (d.item_rows === m.item_rows && d.stock_date > m.stock_date) return d;
        return m;
    }, null);
    return { stock_date: best.stock_date, dates };
}

/** 快照行（批次级，用于库龄分桶） */
async function loadSnapshotRows(bu_no, stock_date) {
    const [rows] = await pool.execute(`
        SELECT xitems, item_name, qty_balance, unit_price, stock_value,
               ageing_days, ageing_category, reduce_percentage, current_value, current_lose
        FROM e2_xitems_daily_status
        WHERE bu_no=? AND stock_date=?
        ORDER BY xitems`, [bu_no, stock_date]);
    return rows.map(r => ({
        xitems: r.xitems,
        item_name: r.item_name,
        qty: Number(r.qty_balance || 0),
        unit_price: Number(r.unit_price || 0),
        stock_value: Number(r.stock_value || 0),
        ageing_days: Number(r.ageing_days || 0),
        ageing_category: r.ageing_category,
        reduce_percentage: Number(r.reduce_percentage || 0),
        current_value: Number(r.current_value || 0),
        current_lose: Number(r.current_lose || 0)
    }));
}

/** 按料件汇总（金额加权库龄） */
function aggregateItems(rows) {
    const map = {};
    rows.forEach(r => {
        const it = map[r.xitems] = map[r.xitems] || {
            xitems: r.xitems, item_name: r.item_name || null,
            qty: 0, stock_value: 0, net_value: 0, provision: 0,
            max_ageing: 0, _ageValue: 0, _reduceValue: 0, batch_cnt: 0
        };
        it.qty += r.qty;
        it.stock_value += r.stock_value;
        it.net_value += r.current_value;
        it.provision += r.current_lose;
        it.max_ageing = Math.max(it.max_ageing, r.ageing_days);
        it._ageValue += r.ageing_days * r.stock_value;
        it._reduceValue += r.reduce_percentage * r.stock_value;
        it.batch_cnt += 1;
    });
    return Object.values(map).map(it => ({
        xitems: it.xitems,
        item_name: it.item_name,
        qty: round4(it.qty),
        stock_value: round2(it.stock_value),
        net_value: round2(it.net_value),
        provision: round2(it.provision),
        max_ageing: it.max_ageing,
        avg_ageing: it.stock_value > 0 ? Math.round(it._ageValue / it.stock_value) : it.max_ageing,
        reduce_percentage: round4(it.stock_value > 0 ? it._reduceValue / it.stock_value : 0),
        bucket: bucketOf(it.max_ageing),
        batch_cnt: it.batch_cnt
    })).sort((a, b) => b.stock_value - a.stock_value);
}

/** 近 12 个月需求（SO 交货优先，缺失时以 PO 采购量近似） */
async function loadDemand(bu_no) {
    const [so] = await pool.execute(`
        SELECT xitems, SUM(dn_qty) qty, MAX(so_date) last_date
        FROM ermm_erp_so
        WHERE bu_no=? AND dn_qty > 0
          AND so_date >= DATE_SUB((SELECT MAX(so_date) FROM ermm_erp_so WHERE bu_no=?), INTERVAL 12 MONTH)
        GROUP BY xitems`, [bu_no, bu_no]);
    const [po] = await pool.execute(`
        SELECT xitems, SUM(po_qty) qty, MAX(po_date) last_date
        FROM ermm_erp_po
        WHERE bu_no=?
          AND po_date >= DATE_SUB((SELECT MAX(po_date) FROM ermm_erp_po WHERE bu_no=?), INTERVAL 12 MONTH)
        GROUP BY xitems`, [bu_no, bu_no]);

    const map = {};
    po.forEach(r => {
        map[r.xitems] = {
            qty_12m: round4(r.qty), source: 'PO',
            last_date: ymd(r.last_date), approx: true
        };
    });
    so.forEach(r => {
        map[r.xitems] = {
            qty_12m: round4(r.qty), source: 'SO',
            last_date: ymd(r.last_date), approx: false
        };
    });
    return map;
}

/** 周转率 / 周转天数（TTM）与 12 个月趋势 */
async function getTurnover(bu_no) {
    const [rows] = await pool.execute(`
        SELECT YYYY_MM, stock_value_amt, stock_P_amt, stock_M_amt, stock_S_amt,
               stock_transit_amt, sale_amt, sale_cost_amt
        FROM mgm_finance_summary
        WHERE bu_no=? AND sale_cost_amt IS NOT NULL
        ORDER BY YYYY_MM DESC
        LIMIT 24`, [bu_no]);

    if (!rows.length) {
        return { latest_month: null, ttm_cogs: 0, avg_inventory: 0, turnover: 0, dsi: 0, trend: [], structure: null };
    }

    const calcWindow = (i) => {
        const win = rows.slice(i, i + 12);
        if (win.length < 3) return null;
        const cogs = win.reduce((s, r) => s + Number(r.sale_cost_amt || 0), 0);
        const inv = win.reduce((s, r) => s + Number(r.stock_value_amt || 0), 0) / win.length;
        const turnover = inv > 0 ? cogs / inv : 0;
        return { cogs, inv, turnover, dsi: turnover > 0 ? 365 / turnover : 0, months: win.length };
    };

    const cur = calcWindow(0);
    const prev = calcWindow(11);
    const latest = rows[0];
    const trend = [];
    for (let i = 11; i >= 0; i--) {
        const w = calcWindow(i);
        if (!w || !rows[i]) continue;
        trend.push({
            YYYY_MM: rows[i].YYYY_MM,
            inventory: round2(rows[i].stock_value_amt),
            cogs_ttm: round2(w.cogs),
            avg_inventory: round2(w.inv),
            turnover: round4(w.turnover),
            dsi: Math.round(w.dsi),
            months_used: w.months
        });
    }

    return {
        latest_month: latest.YYYY_MM,
        ttm_cogs: round2(cur ? cur.cogs : 0),
        avg_inventory: round2(cur ? cur.inv : 0),
        turnover: round4(cur ? cur.turnover : 0),
        dsi: cur ? Math.round(cur.dsi) : 0,
        prev_turnover: round4(prev ? prev.turnover : 0),
        prev_dsi: prev ? Math.round(prev.dsi) : 0,
        trend_months: cur ? cur.months : 0,
        trend,
        structure: {
            total: round2(latest.stock_value_amt),
            finished: round2(latest.stock_P_amt),
            material: round2(latest.stock_M_amt),
            auxiliary: round2(latest.stock_S_amt),
            transit: round2(latest.stock_transit_amt),
            sale_amt: round2(latest.sale_amt),
            sale_cost_amt: round2(latest.sale_cost_amt)
        }
    };
}

/** 库龄结构 + 料件库龄明细 */
async function getAging(bu_no, stock_date) {
    const resolved = await resolveStockDate(bu_no, stock_date);
    if (!resolved.stock_date) {
        return { bu_no, stock_date: null, dates: [], buckets: [], items: [], totals: null };
    }
    const rows = await loadSnapshotRows(bu_no, resolved.stock_date);
    const items = aggregateItems(rows);

    const buckets = BUCKETS.map(b => ({
        key: b.key, min: b.min, max: b.max,
        qty: 0, stock_value: 0, net_value: 0, provision: 0,
        item_set: new Set()
    }));
    rows.forEach(r => {
        const b = buckets.find(x => x.key === bucketOf(r.ageing_days));
        b.qty += r.qty;
        b.stock_value += r.stock_value;
        b.net_value += r.current_value;
        b.provision += r.current_lose;
        b.item_set.add(r.xitems);
    });

    const totalValue = rows.reduce((s, r) => s + r.stock_value, 0);
    const bucketOut = buckets.map(b => ({
        key: b.key, min: b.min, max: b.max,
        qty: round4(b.qty),
        stock_value: round2(b.stock_value),
        net_value: round2(b.net_value),
        provision: round2(b.provision),
        item_cnt: b.item_set.size,
        value_pct: totalValue > 0 ? round4(b.stock_value / totalValue) : 0
    }));

    return {
        bu_no,
        stock_date: resolved.stock_date,
        dates: resolved.dates,
        buckets: bucketOut,
        items,
        totals: {
            item_cnt: items.length,
            qty: round4(rows.reduce((s, r) => s + r.qty, 0)),
            stock_value: round2(totalValue),
            net_value: round2(rows.reduce((s, r) => s + r.current_value, 0)),
            provision: round2(rows.reduce((s, r) => s + r.current_lose, 0)),
            slow_value: round2(items.filter(i => i.max_ageing > 90).reduce((s, i) => s + i.stock_value, 0))
        }
    };
}

/** 呆滞清单（库龄 > 90 天或覆盖天数 > 180 天） */
async function getSlowMoving(bu_no, stock_date) {
    const aging = await getAging(bu_no, stock_date);
    if (!aging.stock_date) return { bu_no, stock_date: null, items: [], summary: null };

    const [demand, actions] = await Promise.all([
        loadDemand(bu_no),
        pool.execute(`SELECT * FROM inv_slow_moving_action WHERE bu_no=? ORDER BY create_time DESC`, [bu_no])
    ]);

    const actionMap = {};
    (actions[0] || []).forEach(a => {
        if (!actionMap[a.xitems]) actionMap[a.xitems] = a;
    });

    const items = aging.items.map(it => {
        const d = demand[it.xitems] || null;
        const avgDaily = d && Number(d.qty_12m) > 0 ? Number(d.qty_12m) / 365 : 0;
        const rawCoverage = avgDaily > 0 ? Math.round(Number(it.qty) / avgDaily) : null;
        const coverageDays = rawCoverage == null ? null : Math.min(rawCoverage, 9999);
        const lastOut = d ? d.last_date : null;
        const noOutDays = lastOut ? daysBetween(lastOut, aging.stock_date) : null;

        // 呆滞判定以库龄为准（数量口径的出库数据不完整，覆盖天数仅作参考）
        if (it.max_ageing <= 90) return null;
        const reason = it.max_ageing > 180 ? '库龄超过 180 天' : '库龄 91-180 天';
        const severe = it.max_ageing > 180;

        return {
            ...it,
            demand_qty_12m: d ? d.qty_12m : 0,
            demand_source: d ? d.source : null,
            demand_approx: d ? d.approx : false,
            avg_daily_out: round4(avgDaily),
            coverage_days: coverageDays,
            coverage_gt_9999: rawCoverage != null && rawCoverage > 9999,
            last_outbound: lastOut,
            days_no_outbound: noOutDays,
            reason,
            severity: severe ? 'severe' : 'high',
            suggest_action: severe ? '降价促销' : '暂停采购',
            action: actionMap[it.xitems] || null
        };
    }).filter(Boolean).sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'severe' ? -1 : 1;
        return b.stock_value - a.stock_value;
    });

    return {
        bu_no,
        stock_date: aging.stock_date,
        items,
        summary: {
            count: items.length,
            severe_cnt: items.filter(i => i.severity === 'severe').length,
            stock_value: round2(items.reduce((s, i) => s + i.stock_value, 0)),
            net_value: round2(items.reduce((s, i) => s + i.net_value, 0)),
            provision: round2(items.reduce((s, i) => s + i.provision, 0)),
            issued_cnt: items.filter(i => i.action).length,
            value_pct: aging.totals.stock_value > 0
                ? round4(items.reduce((s, i) => s + i.stock_value, 0) / aging.totals.stock_value) : 0
        }
    };
}

/** 补货建议（BU 级金额缺口 + 料件级补货/暂缓） */
async function getReplenishment(bu_no, stock_date, opts = {}) {
    const targetDays = Math.max(1, Number(opts.target_days) || DEFAULTS.target_days);
    const leadDays = Math.max(0, Number(opts.lead_days) || DEFAULTS.lead_days);
    const safetyDays = Math.max(0, Number(opts.safety_days) || DEFAULTS.safety_days);
    const reorderPointDays = leadDays + safetyDays;

    const [aging, turnover, demand] = await Promise.all([
        getAging(bu_no, stock_date),
        getTurnover(bu_no),
        loadDemand(bu_no)
    ]);

    const currentValue = aging.totals ? aging.totals.stock_value : 0;
    const targetValue = round2(turnover.ttm_cogs / 365 * targetDays);
    const gap = round2(targetValue - currentValue);

    const items = [];
    aging.items.forEach(it => {
        const d = demand[it.xitems] || null;
        const avgDaily = d && Number(d.qty_12m) > 0 ? Number(d.qty_12m) / 365 : 0;
        if (avgDaily <= 0) {
            if (it.max_ageing > 90) {
                items.push({
                    ...it, suggest_type: 'HOLD',
                    coverage_days: null, avg_daily_out: 0,
                    suggest_qty: 0, urgency: 'low',
                    reason: '无近 12 个月出库，库龄偏高，建议暂缓采购'
                });
            }
            return;
        }
        const rawCoverage = Math.round(Number(it.qty) / avgDaily);
        const coverage = Math.min(rawCoverage, 9999);
        if (it.max_ageing > 90) {
            items.push({
                ...it, suggest_type: 'HOLD', coverage_days: coverage,
                coverage_gt_9999: rawCoverage > 9999,
                avg_daily_out: round4(avgDaily), suggest_qty: 0,
                urgency: 'low',
                reason: `库龄 ${it.max_ageing} 天，建议暂缓采购，先消化库存`
            });
        } else if (coverage < reorderPointDays) {
            const suggestQty = Math.max(0, round4(avgDaily * reorderPointDays - Number(it.qty)));
            items.push({
                ...it, suggest_type: 'REORDER', coverage_days: coverage,
                coverage_gt_9999: false,
                avg_daily_out: round4(avgDaily), suggest_qty: suggestQty,
                urgency: coverage < leadDays ? 'high' : (coverage < reorderPointDays / 2 ? 'medium' : 'low'),
                reason: `覆盖 ${coverage} 天，低于补货点 ${reorderPointDays} 天`
            });
        }
    });

    items.sort((a, b) => {
        if (a.suggest_type !== b.suggest_type) return a.suggest_type === 'REORDER' ? -1 : 1;
        return b.stock_value - a.stock_value;
    });

    return {
        bu_no,
        stock_date: aging.stock_date,
        target_days: targetDays,
        lead_days: leadDays,
        safety_days: safetyDays,
        reorder_point_days: reorderPointDays,
        bu_level: {
            ttm_cogs: turnover.ttm_cogs,
            current_value: round2(currentValue),
            target_value: targetValue,
            gap_amt: gap,
            suggest_replenish_amt: gap > 0 ? gap : 0,
            excess_amt: gap < 0 ? round2(-gap) : 0
        },
        counts: {
            reorder: items.filter(i => i.suggest_type === 'REORDER').length,
            hold: items.filter(i => i.suggest_type === 'HOLD').length
        },
        items
    };
}

async function getOverview(bu_no, opts = {}) {
    const [aging, turnover, slow] = await Promise.all([
        getAging(bu_no, opts.stock_date),
        getTurnover(bu_no),
        getSlowMoving(bu_no, opts.stock_date)
    ]);
    const [acts] = await pool.execute(`
        SELECT status, COUNT(*) cnt, SUM(stock_value) stock_value
        FROM inv_slow_moving_action WHERE bu_no=? GROUP BY status`, [bu_no]);
    const actMap = { pending: 0, doing: 0, done: 0 };
    acts.forEach(a => { actMap[a.status] = Number(a.cnt); });

    return {
        bu_no,
        stock_date: aging.stock_date,
        dates: aging.dates,
        aging: { buckets: aging.buckets, totals: aging.totals },
        turnover,
        slow: slow.summary,
        actions: actMap
    };
}

/* ================= 呆滞处理单 ================= */

async function listActions(bu_no, status) {
    let sql = 'SELECT * FROM inv_slow_moving_action WHERE 1=1';
    const params = [];
    if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
    if (status) { sql += ' AND status=?'; params.push(status); }
    sql += ' ORDER BY create_time DESC, uid DESC LIMIT 500';
    const [rows] = await pool.execute(sql, params);
    return rows;
}

async function latestSnapshotOfItem(bu_no, xitems) {
    const [rows] = await pool.execute(`
        SELECT stock_date, SUM(stock_value) stock_value, MAX(ageing_days) ageing_days,
               SUM(current_value) net_value, MAX(item_name) item_name
        FROM e2_xitems_daily_status
        WHERE bu_no=? AND xitems=?
        GROUP BY stock_date
        ORDER BY stock_date DESC
        LIMIT 1`, [bu_no, xitems]);
    return rows[0] || null;
}

async function createAction(body = {}, user) {
    const bu_no = body.bu_no;
    const xitems = body.xitems;
    if (!bu_no || !xitems) throw Object.assign(new Error('需要 bu_no 与 xitems'), { status: 400 });

    const snap = await latestSnapshotOfItem(bu_no, xitems);
    const stockValue = body.stock_value !== undefined && body.stock_value !== null && body.stock_value !== ''
        ? Number(body.stock_value)
        : Number(snap ? snap.stock_value : 0);
    const ageingDays = body.ageing_days !== undefined && body.ageing_days !== null && body.ageing_days !== ''
        ? Number(body.ageing_days)
        : Number(snap ? snap.ageing_days : 0);
    const netValue = Number(snap ? snap.net_value : stockValue);

    const [r] = await pool.execute(`
        INSERT INTO inv_slow_moving_action
            (bu_no, xitems, item_name, stock_date, ageing_days, stock_value, action_type,
             action_qty, expect_recover_amt, priority, owner, due_date, status, remark, create_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        bu_no, xitems, body.item_name || (snap ? snap.item_name : null),
        body.stock_date || (snap ? ymd(snap.stock_date) : null),
        ageingDays, stockValue,
        body.action_type || '降价促销',
        Number(body.action_qty || 0),
        body.expect_recover_amt !== undefined ? Number(body.expect_recover_amt || 0) : round2(netValue),
        body.priority || 'medium',
        body.owner || null,
        body.due_date || null,
        body.status || 'pending',
        body.remark || null,
        user || null
    ]);
    return { uid: r.insertId };
}

const UPDATABLE = ['action_type', 'action_qty', 'expect_recover_amt', 'priority', 'owner', 'due_date', 'status', 'remark'];

async function updateAction(uid, body = {}) {
    const sets = [];
    const values = [];
    UPDATABLE.forEach(k => {
        if (body[k] !== undefined) { sets.push(`${k}=?`); values.push(body[k]); }
    });
    if (!sets.length) throw Object.assign(new Error('没有可更新的字段'), { status: 400 });
    values.push(uid);
    await pool.execute(`UPDATE inv_slow_moving_action SET ${sets.join(',')} WHERE uid=?`, values);
    return { uid: Number(uid) };
}

async function deleteAction(uid) {
    await pool.execute('DELETE FROM inv_slow_moving_action WHERE uid=?', [uid]);
    return { uid: Number(uid) };
}

module.exports = {
    getSnapshotDates,
    getAging,
    getTurnover,
    getSlowMoving,
    getReplenishment,
    getOverview,
    listActions,
    createAction,
    updateAction,
    deleteAction
};
