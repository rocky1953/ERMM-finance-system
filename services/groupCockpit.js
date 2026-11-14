/**
 * 集团驾驶舱增强（CEO-04）
 *
 * 输出四块内容：
 *   1. 目标达成：集团与各 BU 的年度目标 vs 年初至今实际，含达成率与进度状态
 *   2. BU 排名：营收 / 净利 / 毛利率 / 现金 / 存货周转 / 应收天数
 *   3. 外部对标：集团实际 vs 同业分位（industry_benchmark）
 *   4. 重大事项：预警中心未读告警；无告警时由现金水位、逾期应收、呆滞库存、目标滞后自动生成
 *
 * 目标口径：
 *   - 优先读取 group_target 维护值
 *   - 未维护时按上年实际推导：营收 ×1.10、净利 ×1.15、毛利率 +0.5pp、
 *     存货周转 ×1.05、应收天数 ×0.95（净利为负时按亏损收窄 20% 推导）
 */

const { pool } = require('../config/db');

const SAFE_CASH = 3000000;
const BENCH_INDUSTRY = '制造业';

const KPIS = [
    { code: 'revenue',        label: '营业收入',     unit: '元',     kind: 'amount', higher: true,  growth: 1.10 },
    { code: 'net_profit',     label: '净利润',       unit: '元',     kind: 'amount', higher: true,  growth: 1.15 },
    { code: 'gross_margin',   label: '毛利率',       unit: '%',      kind: 'ratio',  higher: true,  delta: 0.5 },
    { code: 'inventory_turn', label: '存货周转率',   unit: '次/年',  kind: 'ratio',  higher: true,  growth: 1.05 },
    { code: 'ar_days',        label: '应收天数',     unit: '天',     kind: 'ratio',  higher: false, growth: 0.95 }
];

function num(v) { return (v === null || v === undefined || isNaN(v)) ? 0 : Number(v); }
function round2(v) { return Math.round(num(v) * 100) / 100; }
function round4(v) { return Math.round(num(v) * 10000) / 10000; }
function safeDiv(a, b) { return Number(b) ? Number(a) / Number(b) : null; }

/** 由月度财务行（新→旧）计算期间指标 */
function computeMetrics(rows, ym) {
    const upto = (rows || []).filter(r => r.YYYY_MM <= ym);
    if (!upto.length) return null;
    const year = String(ym).slice(0, 4);
    const ytd = upto.filter(r => String(r.YYYY_MM).startsWith(year));
    const ttm = upto.slice(0, 12);
    const latest = upto[0] || {};
    const sum = (arr, k) => arr.reduce((s, r) => s + num(r[k]), 0);

    const saleYtd = sum(ytd, 'sale_amt');
    const costYtd = sum(ytd, 'sale_cost_amt');
    const netYtd = sum(ytd, 'net_profit_amt');
    const ttmSale = sum(ttm, 'sale_amt');
    const ttmCost = sum(ttm, 'sale_cost_amt');
    const avgStock = ttm.length ? sum(ttm, 'stock_value_amt') / ttm.length : 0;

    return {
        last_month: latest.YYYY_MM,
        revenue: round2(saleYtd),
        cost: round2(costYtd),
        net_profit: round2(netYtd),
        gross_margin: saleYtd > 0 ? round2((saleYtd - costYtd) / saleYtd * 100) : null,
        net_margin: saleYtd > 0 ? round2(netYtd / saleYtd * 100) : null,
        inventory_turn: avgStock > 0 ? round2(ttmCost / avgStock) : null,
        ar_days: ttmSale > 0 ? round2(num(latest.AR_amt) / ttmSale * 365) : null,
        cash: round2(num(latest.cash_amt) + num(latest.deposite_amt)),
        ar: round2(num(latest.AR_amt)),
        inv: round2(num(latest.stock_value_amt)),
        assets: round2(num(latest.ttl_asset_amt)),
        liab: round2(num(latest.ttl_debet_amt)),
        equity: round2(num(latest.stockholder_amt))
    };
}

/** 同期聚合多个 BU 的财务行，得到集团口径 */
function aggregateRows(buRowsList) {
    const map = new Map();
    buRowsList.forEach(rows => {
        (rows || []).forEach(r => {
            const k = r.YYYY_MM;
            if (!map.has(k)) {
                map.set(k, {
                    YYYY_MM: k, sale_amt: 0, sale_cost_amt: 0, net_profit_amt: 0,
                    AR_amt: 0, stock_value_amt: 0, cash_amt: 0, deposite_amt: 0,
                    ttl_asset_amt: 0, ttl_debet_amt: 0, stockholder_amt: 0
                });
            }
            const t = map.get(k);
            ['sale_amt', 'sale_cost_amt', 'net_profit_amt', 'AR_amt', 'stock_value_amt',
                'cash_amt', 'deposite_amt', 'ttl_asset_amt', 'ttl_debet_amt', 'stockholder_amt']
                .forEach(f => { t[f] += num(r[f]); });
        });
    });
    return Array.from(map.values()).sort((a, b) => String(b.YYYY_MM).localeCompare(String(a.YYYY_MM)));
}

/** 上年实际推导默认目标 */
function defaultTarget(kpi, prior) {
    if (!prior) return 0;
    const v = prior[kpi.code];
    if (v === null || v === undefined) return 0;
    if (kpi.code === 'gross_margin') return round2(v + (kpi.delta || 0));
    if (kpi.code === 'net_profit' && v < 0) return round2(v * 0.8);
    return round2(v * kpi.growth);
}

function progressOfYear(ym) {
    const m = Number(String(ym).slice(5, 7)) || 12;
    return round2(m / 12 * 100);
}

/** 达成率：金额型 = 实际/目标；比率型按方向换算 */
function attainmentOf(kpi, actual, target) {
    if (actual === null || actual === undefined || !target) return null;
    if (kpi.kind === 'amount') return round2(actual / target * 100);
    if (kpi.higher) return round2(actual / target * 100);
    return round2(target / actual * 100);
}

function statusOf(kpi, att, progress) {
    if (att === null) return 'na';
    if (kpi.kind === 'amount') {
        if (att >= progress + 3) return 'ahead';
        if (att < progress - 3) return 'behind';
        return 'ontrack';
    }
    if (att >= 103) return 'ahead';
    if (att < 97) return 'behind';
    return 'ontrack';
}

function isBetter(kpi, actual, median) {
    if (actual === null || median === null || median === undefined) return null;
    return kpi.higher ? actual >= Number(median) : actual <= Number(median);
}

/** 读取全部财务汇总，按 BU 分组（新→旧） */
async function loadFinance() {
    const [rows] = await pool.execute(`
        SELECT bu_no, YYYY_MM, sale_amt, sale_cost_amt, net_profit_amt, AR_amt,
               stock_value_amt, cash_amt, deposite_amt,
               ttl_asset_amt, ttl_debet_amt, stockholder_amt
        FROM mgm_finance_summary
        ORDER BY bu_no, YYYY_MM DESC`);
    const map = new Map();
    rows.forEach(r => {
        if (!map.has(r.bu_no)) map.set(r.bu_no, []);
        map.get(r.bu_no).push(r);
    });
    return map;
}

async function resolveMonth(ym) {
    if (ym) {
        const target = String(ym).slice(0, 7);
        const [hit] = await pool.execute(
            `SELECT 1 AS ok FROM mgm_finance_summary WHERE YYYY_MM=? LIMIT 1`, [target]);
        if (hit.length) return target;
    }
    const [rows] = await pool.execute(
        `SELECT MAX(YYYY_MM) AS ym FROM mgm_finance_summary`);
    return rows[0] && rows[0].ym ? rows[0].ym : null;
}

/** 预警告警（表不存在时静默降级） */
async function loadAlerts() {
    try {
        const [rows] = await pool.execute(`
            SELECT uid, bu_no, level, title, message, created_at
            FROM alert_log
            ORDER BY is_read ASC, created_at DESC
            LIMIT 8`);
        return rows.map(r => ({
            level: String(r.level || 'warning').toLowerCase(),
            title: r.title || '系统告警',
            message: r.message || '',
            bu_no: r.bu_no || '',
            created_at: r.created_at || null,
            source: 'alert'
        }));
    } catch (e) { return []; }
}

/** 无告警时由关键指标推导重大事项 */
async function deriveEvents(metricsByBu, targetBlocks, ym) {
    const events = [];
    metricsByBu.forEach(m => {
        if (m.cash < SAFE_CASH) {
            events.push({
                level: m.cash < SAFE_CASH * 0.5 ? 'critical' : 'warning',
                title: '现金低于安全水位',
                message: `${m.bu_no} 最新现金 ${m.cash.toLocaleString()} 元，低于 ${SAFE_CASH.toLocaleString()} 元安全水位`,
                bu_no: m.bu_no, source: 'cash'
            });
        }
    });

    try {
        const [rows] = await pool.execute(`
            SELECT bu_no, COUNT(*) AS cnt,
                   COALESCE(SUM(sub_amt - COALESCE(payment, 0)), 0) AS overdue_amt
            FROM mgm_invoice_details
            WHERE TX_type='AR' AND ageing_days > 90
            GROUP BY bu_no`);
        rows.forEach(r => {
            if (num(r.overdue_amt) <= 0) return;
            events.push({
                level: 'warning',
                title: '逾期应收超 90 天',
                message: `${r.bu_no} 共 ${num(r.cnt)} 笔，未收金额 ${round2(r.overdue_amt).toLocaleString()} 元`,
                bu_no: r.bu_no, source: 'ar'
            });
        });
    } catch (e) { /* ignore */ }

    for (const m of metricsByBu) {
        try {
            const [dRows] = await pool.execute(`
                SELECT stock_date FROM e2_xitems_daily_status
                WHERE bu_no=? AND stock_date IS NOT NULL
                ORDER BY stock_date DESC LIMIT 1`, [m.bu_no]);
            if (!dRows.length) continue;
            const [sRows] = await pool.execute(`
                SELECT COALESCE(SUM(stock_value), 0) AS amt, COUNT(*) AS cnt
                FROM e2_xitems_daily_status
                WHERE bu_no=? AND stock_date=? AND ageing_days > 90`,
                [m.bu_no, dRows[0].stock_date]);
            const amt = num(sRows[0] && sRows[0].amt);
            if (amt <= 0) continue;
            events.push({
                level: 'warning',
                title: '呆滞库存待处理',
                message: `${m.bu_no} 库龄超 90 天库存 ${amt.toLocaleString()} 元（${num(sRows[0].cnt)} 项）`,
                bu_no: m.bu_no, source: 'inventory'
            });
        } catch (e) { /* ignore */ }
    }

    const progress = progressOfYear(ym);
    const lagging = [];
    targetBlocks.forEach(block => {
        if (block.bu_no === 'GROUP') return;
        block.rows.forEach(r => {
            if (r.kind !== 'amount' || r.attainment === null) return;
            if (r.attainment < progress - 10) {
                lagging.push({
                    level: 'critical',
                    title: `${r.label}目标滞后`,
                    message: `${block.bu_no} 达成率 ${r.attainment}%，低于时间进度 ${progress}%`,
                    bu_no: block.bu_no,
                    attainment: r.attainment,
                    source: 'target'
                });
            }
        });
    });
    lagging.sort((a, b) => a.attainment - b.attainment);
    lagging.slice(0, 3).forEach(e => events.push(e));

    const weight = { critical: 0, warning: 1, info: 2 };
    return events.sort((a, b) => (weight[a.level] ?? 9) - (weight[b.level] ?? 9)).slice(0, 8);
}

async function getGroupCockpit(ymInput) {
    const ym = await resolveMonth(ymInput);
    if (!ym) return { YYYY_MM: null, targets: [], rankings: [], benchmark: [], events: [] };

    const year = String(ym).slice(0, 4);
    const priorYm = `${Number(year) - 1}-12`;
    const finance = await loadFinance();
    const bus = Array.from(finance.keys()).sort();

    const metricsByBu = [];
    const priorByBu = new Map();
    bus.forEach(bu => {
        const rows = finance.get(bu);
        const m = computeMetrics(rows, ym);
        if (m) {
            m.bu_no = bu;
            metricsByBu.push(m);
        }
        priorByBu.set(bu, computeMetrics(rows, priorYm));
    });

    // ---- 目标（优先维护值，否则按上年推导） ----
    const [savedRows] = await pool.execute(
        `SELECT bu_no, kpi_code, target_value FROM group_target WHERE year=?`,
        [Number(year)]);
    const saved = new Map();
    savedRows.forEach(r => saved.set(`${r.bu_no}|${r.kpi_code}`, Number(r.target_value)));

    const blocks = metricsByBu.map(m => {
        const prior = priorByBu.get(m.bu_no);
        return {
            bu_no: m.bu_no,
            rows: KPIS.map(kpi => {
                const savedKey = `${m.bu_no}|${kpi.code}`;
                const target = saved.has(savedKey) ? saved.get(savedKey) : defaultTarget(kpi, prior);
                const actual = m[kpi.code];
                const att = attainmentOf(kpi, actual, target);
                return {
                    kpi_code: kpi.code, label: kpi.label, unit: kpi.unit, kind: kpi.kind,
                    target: round2(target), actual: actual === null ? null : round2(actual),
                    attainment: att, status: statusOf(kpi, att, progressOfYear(ym)),
                    saved: saved.has(savedKey), editable: true
                };
            })
        };
    });

    // 集团目标：优先 GROUP 维护值；否则按 BU 目标汇总
    const groupMetrics = computeMetrics(aggregateRows(bus.map(b => finance.get(b))), ym);
    const groupPrior = computeMetrics(aggregateRows(bus.map(b => finance.get(b))), priorYm);
    const groupRows = KPIS.map(kpi => {
        let target;
        if (saved.has(`GROUP|${kpi.code}`)) {
            target = saved.get(`GROUP|${kpi.code}`);
        } else if (kpi.code === 'revenue' || kpi.code === 'net_profit') {
            target = blocks.reduce((s, b) => s + num(b.rows.find(r => r.kpi_code === kpi.code).target), 0);
        } else if (kpi.code === 'gross_margin') {
            const rev = blocks.reduce((s, b) => s + num(b.rows.find(r => r.kpi_code === 'revenue').target), 0);
            target = rev > 0
                ? blocks.reduce((s, b) => s + num(b.rows.find(r => r.kpi_code === 'gross_margin').target) * num(b.rows.find(r => r.kpi_code === 'revenue').target), 0) / rev
                : defaultTarget(kpi, groupPrior);
        } else if (kpi.code === 'inventory_turn') {
            const inv = blocks.reduce((s, b) => s + num((metricsByBu.find(m => m.bu_no === b.bu_no) || {}).inv), 0);
            target = inv > 0
                ? blocks.reduce((s, b) => s + num(b.rows.find(r => r.kpi_code === 'inventory_turn').target) * num((metricsByBu.find(m => m.bu_no === b.bu_no) || {}).inv), 0) / inv
                : defaultTarget(kpi, groupPrior);
        } else {
            const rev = blocks.reduce((s, b) => s + num(b.rows.find(r => r.kpi_code === 'revenue').target), 0);
            target = rev > 0
                ? blocks.reduce((s, b) => s + num(b.rows.find(r => r.kpi_code === 'ar_days').target) * num(b.rows.find(r => r.kpi_code === 'revenue').target), 0) / rev
                : defaultTarget(kpi, groupPrior);
        }
        const actual = groupMetrics ? groupMetrics[kpi.code] : null;
        const att = attainmentOf(kpi, actual, target);
        return {
            kpi_code: kpi.code, label: kpi.label, unit: kpi.unit, kind: kpi.kind,
            target: round2(target), actual: actual === null ? null : round2(actual),
            attainment: att, status: statusOf(kpi, att, progressOfYear(ym)),
            saved: saved.has(`GROUP|${kpi.code}`), editable: true
        };
    });

    const targetBlocks = [{ bu_no: 'GROUP', rows: groupRows }, ...blocks];

    // ---- BU 排名 ----
    const rankDefs = [
        { key: 'revenue', label: '营业收入', unit: 'amt', higher: true },
        { key: 'net_profit', label: '净利润', unit: 'amt', higher: true },
        { key: 'gross_margin', label: '毛利率', unit: '%', higher: true },
        { key: 'cash', label: '现金余额', unit: 'amt', higher: true },
        { key: 'inventory_turn', label: '存货周转', unit: 'turn', higher: true },
        { key: 'ar_days', label: '应收天数', unit: 'day', higher: false }
    ];
    const rankings = rankDefs.map(def => {
        const rows = metricsByBu
            .filter(m => m[def.key] !== null && m[def.key] !== undefined)
            .sort((a, b) => def.higher ? num(b[def.key]) - num(a[def.key]) : num(a[def.key]) - num(b[def.key]))
            .map((m, i) => ({ rank: i + 1, bu_no: m.bu_no, value: round2(m[def.key]) }));
        return { key: def.key, label: def.label, unit: def.unit, higher: def.higher, rows };
    });

    // ---- 外部对标 ----
    let benchYear = null;
    const [byRows] = await pool.execute(
        `SELECT MAX(year) AS y FROM industry_benchmark WHERE industry=? AND year<=?`,
        [BENCH_INDUSTRY, Number(year)]);
    if (byRows[0] && byRows[0].y) benchYear = byRows[0].y;
    else {
        const [maxRows] = await pool.execute(
            `SELECT MAX(year) AS y FROM industry_benchmark WHERE industry=?`, [BENCH_INDUSTRY]);
        benchYear = maxRows[0] ? maxRows[0].y : null;
    }

    let benchmark = [];
    if (benchYear) {
        const [bRows] = await pool.execute(`
            SELECT kpi_id, p10, p25, median, p75, p90
            FROM industry_benchmark
            WHERE industry=? AND year=?`, [BENCH_INDUSTRY, benchYear]);
        const benchMap = new Map(bRows.map(r => [r.kpi_id, r]));
        const gm = groupMetrics || {};
        const actuals = {
            gross_profit: gm.gross_margin,
            net_profit_margin: gm.net_margin,
            inventory_turn: gm.inventory_turn,
            ar_days: gm.ar_days,
            roe: gm.equity > 0 ? round2(gm.net_profit / gm.equity * 100) : null,
            debt_ratio: gm.assets > 0 ? round2(gm.liab / gm.assets * 100) : null
        };
        const defs = [
            { id: 'gross_profit', label: '毛利率', unit: '%', higher: true },
            { id: 'net_profit_margin', label: '净利率', unit: '%', higher: true },
            { id: 'inventory_turn', label: '存货周转率', unit: '次/年', higher: true },
            { id: 'ar_days', label: '应收天数', unit: '天', higher: false },
            { id: 'roe', label: '净资产收益率', unit: '%', higher: true },
            { id: 'debt_ratio', label: '负债比率', unit: '%', higher: false }
        ];
        benchmark = defs.filter(d => benchMap.has(d.id)).map(d => {
            const b = benchMap.get(d.id);
            const actual = actuals[d.id] === undefined ? null : actuals[d.id];
            return {
                kpi_id: d.id, label: d.label, unit: d.unit, higher: d.higher,
                actual,
                p10: b.p10 === null ? null : round2(b.p10),
                p25: b.p25 === null ? null : round2(b.p25),
                median: b.median === null ? null : round2(b.median),
                p75: b.p75 === null ? null : round2(b.p75),
                p90: b.p90 === null ? null : round2(b.p90),
                better: isBetter(d, actual, b.median)
            };
        });
    }

    // ---- 重大事项：告警 + 指标推导，按标题去重后合并 ----
    const alerts = await loadAlerts();
    const derived = await deriveEvents(metricsByBu, blocks, ym);
    const seen = new Set();
    const weight = { critical: 0, danger: 0, high: 0, warning: 1, info: 2 };
    const events = [...alerts, ...derived]
        .filter(e => {
            const key = `${e.title}|${e.bu_no || ''}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => (weight[String(a.level).toLowerCase()] ?? 9) - (weight[String(b.level).toLowerCase()] ?? 9))
        .slice(0, 8);

    return {
        YYYY_MM: ym,
        year: Number(year),
        months_elapsed: Number(String(ym).slice(5, 7)),
        time_progress: progressOfYear(ym),
        group_metrics: groupMetrics,
        targets: targetBlocks,
        rankings,
        benchmark: { year: benchYear, industry: BENCH_INDUSTRY, rows: benchmark },
        events
    };
}

async function saveTarget({ bu_no, year, kpi_code, target_value, user_id }) {
    const kpi = KPIS.find(k => k.code === kpi_code);
    if (!kpi) throw Object.assign(new Error('kpi_code 不合法'), { status: 400 });
    if (!bu_no) throw Object.assign(new Error('需要 bu_no'), { status: 400 });
    const y = Number(year);
    if (!(y >= 2000 && y <= 2100)) throw Object.assign(new Error('year 不合法'), { status: 400 });
    const v = Number(target_value);
    if (!isFinite(v)) throw Object.assign(new Error('target_value 需为数字'), { status: 400 });

    await pool.execute(`
        INSERT INTO group_target (bu_no, year, kpi_code, target_value, update_by)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE target_value=VALUES(target_value), update_by=VALUES(update_by)`,
        [bu_no, y, kpi_code, v, user_id || null]);
    return { bu_no, year: y, kpi_code, target_value: v };
}

module.exports = { getGroupCockpit, saveTarget, KPIS };
