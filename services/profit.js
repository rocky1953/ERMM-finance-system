/**
 * 多维盈利分析服务（CFO-06）
 *
 * 口径：
 *   收入 = 已出货数量(dn_qty) × 销售单价 —— 交付口径
 *   成本 = 已出货数量 × 单位成本
 *        单位成本优先取「料件标准成本」= 该料件 PO 加权平均采购价（po_amount_local / po_qty）
 *        无标准成本时按「公司销售成本率」× 销售单价 估算（mgm_finance_summary.sale_cost_amt / sale_amt）
 *   毛利 = 收入 - 成本；毛利率 = 毛利 / 收入
 * 维度：客户 / 产品(料件) / 渠道 / 项目
 */

const { pool } = require('../config/db');

const CHANNEL_NAMES = { DIRECT: '直营', DEALER: '经销', EXPORT: '外销', GROUP: '集团内', OTHER: '其他' };
const DEFAULT_COST_RATIO = 0.7;

/** 公司销售成本率 */
async function getCostRatio(bu_no, YYYY_MM, YYYY) {
    const cond = [];
    const params = [];
    if (bu_no) { cond.push('bu_no=?'); params.push(bu_no); }
    if (YYYY_MM) { cond.push('YYYY_MM=?'); params.push(YYYY_MM); }
    else if (YYYY) { cond.push('YYYY_MM LIKE ?'); params.push(`${YYYY}%`); }
    const f = cond.length ? cond.join(' AND ') : '1=1';
    if (YYYY && !YYYY_MM) {
        const [sumRows] = await pool.execute(
            `SELECT SUM(sale_amt) sale_amt, SUM(sale_cost_amt) sale_cost_amt
             FROM mgm_finance_summary WHERE ${f}`, params);
        const sale = Number(sumRows[0]?.sale_amt || 0), cost = Number(sumRows[0]?.sale_cost_amt || 0);
        if (sale > 0 && cost > 0 && cost / sale < 2) {
            const r = cost / sale;
            return { ratio: r, source: `mgm_finance_summary ${YYYY} 年销售成本率 ${(r * 100).toFixed(1)}%` };
        }
        return { ratio: DEFAULT_COST_RATIO, source: `默认 70%（${YYYY} 年财务汇总缺失成本）` };
    }
    const [rows] = await pool.execute(
        `SELECT sale_amt, sale_cost_amt FROM mgm_finance_summary
         WHERE ${f} ORDER BY YYYY_MM DESC LIMIT 1`, params);
    if (!rows.length) return { ratio: DEFAULT_COST_RATIO, source: '默认 70%（无财务汇总）' };
    const sale = Number(rows[0].sale_amt || 0), cost = Number(rows[0].sale_cost_amt || 0);
    if (sale <= 0 || cost <= 0) return { ratio: DEFAULT_COST_RATIO, source: '默认 70%（财务汇总缺失成本）' };
    const r = cost / sale;
    if (!(r > 0 && r < 2)) return { ratio: DEFAULT_COST_RATIO, source: '默认 70%（成本率异常）' };
    return { ratio: r, source: `mgm_finance_summary 销售成本率 ${(r * 100).toFixed(1)}%` };
}

/** 有出货数据的最新月份（用于默认筛选） */
async function getLatestMonth(bu_no) {
    const [rows] = await pool.execute(
        `SELECT MAX(YYYY_MM) m FROM ermm_erp_so WHERE dn_qty > 0 ${bu_no ? 'AND bu_no=?' : ''}`,
        bu_no ? [bu_no] : []);
    return rows[0]?.m || null;
}

/** 料件标准成本（PO 加权均价） */
async function getStdCostMap(bu_no) {
    const [rows] = await pool.execute(`
        SELECT xitems, SUM(po_amount_local) amt, SUM(po_qty) qty
        FROM ermm_erp_po
        WHERE xitems IS NOT NULL AND po_qty > 0 AND COALESCE(po_amount_local,0) > 0
          ${bu_no ? 'AND bu_no=?' : ''}
        GROUP BY xitems`, bu_no ? [bu_no] : []);
    const map = {};
    rows.forEach(r => {
        const qty = Number(r.qty);
        if (qty > 0) map[r.xitems] = Number(r.amt) / qty;
    });
    return map;
}

/** 客户主项目（优先使用 project_customer_map，回退客户主档首个项目） */
async function getProjectMap() {
    try {
        const [rows] = await pool.execute(`
            SELECT m.client_id, m.project_id, COALESCE(p.project_name, m.project_name) AS project_name
            FROM project_customer_map m
            LEFT JOIN mgm_customer_projects p ON p.project_id = m.project_id`);
        if (rows.length) {
            const map = {};
            rows.forEach(r => { map[r.client_id] = { project_id: r.project_id, project_name: r.project_name }; });
            return map;
        }
    } catch (e) {
        // project_customer_map 未建立时回退旧逻辑
    }
    const [rows] = await pool.execute(`
        SELECT customer_id, MIN(project_id) project_id, MIN(project_name) project_name
        FROM mgm_customer_projects WHERE status='active'
        GROUP BY customer_id`);
    const map = {};
    rows.forEach(r => { map[r.customer_id] = { project_id: r.project_id, project_name: r.project_name }; });
    return map;
}

/** 料件成本率覆盖（成品无标准成本时使用） */
async function getCostRateMap(bu_no) {
    const [rows] = await pool.execute(
        `SELECT xitems, cost_rate FROM profit_cost_rate ${bu_no ? 'WHERE bu_no=?' : ''}`,
        bu_no ? [bu_no] : []);
    const map = {};
    rows.forEach(r => { map[r.xitems] = Number(r.cost_rate); });
    return map;
}

/** 客户渠道覆盖表 */
async function getChannelOverride(bu_no) {
    const [rows] = await pool.execute(
        `SELECT client_id, channel_code FROM sales_channel_map ${bu_no ? 'WHERE bu_no=?' : ''}`,
        bu_no ? [bu_no] : []);
    const map = {};
    rows.forEach(r => { map[r.client_id] = r.channel_code; });
    return map;
}

function defaultChannel(client) {
    const s = String(client || '');
    if (/出口|外销|外銷/.test(s)) return 'EXPORT';
    if (/经销|經銷/.test(s)) return 'DEALER';
    if (/总公司|總公司|集团|集團/.test(s)) return 'GROUP';
    return 'DIRECT';
}

/** 基础明细行（带成本与维度归属） */
async function loadBaseRows(bu_no, YYYY_MM, YYYY) {
    const cond = ['dn_qty > 0'];
    const params = [];
    if (bu_no) { cond.push('bu_no=?'); params.push(bu_no); }
    if (YYYY_MM) { cond.push('YYYY_MM=?'); params.push(YYYY_MM); }
    else if (YYYY) { cond.push('YYYY_MM LIKE ?'); params.push(`${YYYY}%`); }
    const [rows] = await pool.execute(`
        SELECT uid, so_nbr, bu_no, client_id, client_name, xitems, YYYY_MM, so_date,
               so_qty, dn_qty, unit_price
        FROM ermm_erp_so
        WHERE ${cond.join(' AND ')}
        ORDER BY so_date`, params);

    const [costCfg, stdCost, rateMap, projMap, chanOv] = await Promise.all([
        getCostRatio(bu_no, YYYY_MM, YYYY),
        getStdCostMap(bu_no),
        getCostRateMap(bu_no),
        getProjectMap(),
        getChannelOverride(bu_no),
    ]);

    let stdCount = 0, rateCount = 0;
    const list = rows.map(r => {
        const qty = Number(r.dn_qty || 0);
        const price = Number(r.unit_price || 0);
        const revenue = qty * price;
        const stdUnit = stdCost[r.xitems];
        const ovRate = rateMap[r.xitems];
        let costUnit, costSource;
        if (stdUnit != null) { costUnit = stdUnit; costSource = 'STD'; stdCount++; }
        else if (ovRate != null) { costUnit = price * ovRate; costSource = 'RATE'; rateCount++; }
        else { costUnit = price * costCfg.ratio; costSource = 'RATIO'; }
        const cost = qty * costUnit;
        const proj = projMap[r.client_id] || {};
        return {
            uid: r.uid, so_nbr: r.so_nbr, bu_no: r.bu_no,
            client_id: r.client_id, client_name: r.client_name || r.client_id,
            xitems: r.xitems || '(未填)',
            YYYY_MM: r.YYYY_MM, so_date: r.so_date,
            qty, unit_price: price,
            revenue: round2(revenue), cost: round2(cost),
            profit: round2(revenue - cost),
            margin: revenue ? round2((revenue - cost) / revenue * 100) : 0,
            cost_source: costSource,
            unit_cost: round6(costUnit),
            channel: chanOv[r.client_id] || defaultChannel(r.client_id || r.client_name),
            project_id: proj.project_id || 'UNASSIGNED',
            project_name: proj.project_name || '未分派项目'
        };
    });

    return {
        rows: list,
        cost_ratio: round2(costCfg.ratio * 100),
        cost_ratio_source: costCfg.source,
        std_cost_coverage: rows.length ? round2(stdCount / rows.length * 100) : 0,
        cost_rate_coverage: rows.length ? round2((stdCount + rateCount) / rows.length * 100) : 0
    };
}

function round2(v) { return Math.round(Number(v || 0) * 100) / 100; }
function round6(v) { return Math.round(Number(v || 0) * 1000000) / 1000000; }

/** 按维度聚合 */
function aggregate(rows, keyOf, nameOf) {
    const map = new Map();
    for (const r of rows) {
        const k = keyOf(r);
        if (!map.has(k)) map.set(k, { key: k, name: nameOf(r), revenue: 0, cost: 0, profit: 0, qty: 0, order_cnt: 0 });
        const a = map.get(k);
        a.revenue += r.revenue; a.cost += r.cost; a.profit += r.profit;
        a.qty += r.qty; a.order_cnt += 1;
    }
    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
    const totalProfit = rows.reduce((s, r) => s + r.profit, 0);
    const list = Array.from(map.values()).map(a => ({
        ...a,
        revenue: round2(a.revenue), cost: round2(a.cost), profit: round2(a.profit),
        margin: a.revenue ? round2(a.profit / a.revenue * 100) : 0,
        revenue_share: totalRevenue ? round2(a.revenue / totalRevenue * 100) : 0,
        profit_share: totalProfit ? round2(a.profit / totalProfit * 100) : 0
    })).sort((x, y) => y.profit - x.profit);
    list.forEach((a, i) => { a.rank = i + 1; });

    return {
        totals: {
            revenue: round2(totalRevenue),
            cost: round2(rows.reduce((s, r) => s + r.cost, 0)),
            profit: round2(totalProfit),
            margin: totalRevenue ? round2(totalProfit / totalRevenue * 100) : 0,
            qty: round2(rows.reduce((s, r) => s + r.qty, 0)),
            line_cnt: rows.length
        },
        rows: list
    };
}

const DIMENSIONS = {
    customer: { keyOf: r => r.client_id || r.client_name, nameOf: r => r.client_name || r.client_id },
    product: { keyOf: r => r.xitems, nameOf: r => r.xitems },
    channel: { keyOf: r => r.channel, nameOf: r => CHANNEL_NAMES[r.channel] || r.channel },
    project: { keyOf: r => r.project_id, nameOf: r => r.project_name },
};

async function getDimension(bu_no, YYYY_MM, dim, YYYY) {
    const d = DIMENSIONS[dim];
    if (!d) throw new Error('维度非法：' + dim);
    const base = await loadBaseRows(bu_no, YYYY_MM, YYYY);
    const agg = aggregate(base.rows, d.keyOf, d.nameOf);
    return {
        dimension: dim,
        bu_no, YYYY_MM: YYYY_MM || null,
        cost_ratio: base.cost_ratio,
        cost_ratio_source: base.cost_ratio_source,
        std_cost_coverage: base.std_cost_coverage,
        cost_rate_coverage: base.cost_rate_coverage,
        totals: agg.totals,
        count: agg.rows.length,
        rows: agg.rows
    };
}

/** 汇总：一次扫描同时产出四维结果（供看板） */
async function getSummary(bu_no, YYYY_MM, YYYY) {
    const base = await loadBaseRows(bu_no, YYYY_MM, YYYY);
    const dims = {};
    for (const dim of Object.keys(DIMENSIONS)) {
        const d = DIMENSIONS[dim];
        const agg = aggregate(base.rows, d.keyOf, d.nameOf);
        dims[dim] = {
            count: agg.rows.length,
            totals: agg.totals,
            top: agg.rows.slice(0, 5),
            bottom: agg.rows.slice(-3).reverse()
        };
    }
    return {
        bu_no, YYYY_MM: YYYY_MM || null, YYYY: YYYY || null,
        latest_month: await getLatestMonth(bu_no),
        cost_ratio: base.cost_ratio,
        cost_ratio_source: base.cost_ratio_source,
        std_cost_coverage: base.std_cost_coverage,
        cost_rate_coverage: base.cost_rate_coverage,
        totals: dims.customer.totals,
        dimensions: dims
    };
}

/** 下钻：某维度取值的底层 SO 明细 */
async function getDetails(bu_no, YYYY_MM, dim, key, YYYY) {
    const d = DIMENSIONS[dim];
    if (!d) throw new Error('维度非法：' + dim);
    const base = await loadBaseRows(bu_no, YYYY_MM, YYYY);
    const rows = base.rows.filter(r => String(d.keyOf(r)) === String(key));
    return {
        dimension: dim, key,
        count: rows.length,
        totals: {
            revenue: round2(rows.reduce((s, r) => s + r.revenue, 0)),
            cost: round2(rows.reduce((s, r) => s + r.cost, 0)),
            profit: round2(rows.reduce((s, r) => s + r.profit, 0)),
        },
        rows: rows.sort((a, b) => b.profit - a.profit)
    };
}

module.exports = { getDimension, getDetails, getSummary, getCostRatio, getStdCostMap, loadBaseRows, CHANNEL_NAMES };
