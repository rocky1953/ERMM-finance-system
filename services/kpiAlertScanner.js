/**
 * 财务 KPI 自动预警扫描（FINANCE 域）
 *
 * 数据源：
 * 1. KPI 当前值：routes/kpiQuery.computeKpis（由 mgm_finance_summary 实时计算）
 * 2. 阈值与条件：alert_rule（alert_domain='FINANCE'，status=1）
 * 3. 预警等级：优先参考 mgm_kpi_desc 的 KPI1/KPI2 灯号（RED→danger，其余→warning）
 *
 * 同一规则 + 公司 + 月份在 cooldown_hours 内只生成一条 alert_log。
 */
const { pool } = require('../config/db');
const { computeKpis } = require('../routes/kpiQuery');
const notifier = require('./notifier');

const BUS = ['HM', 'HN', 'SZ'];

const COND_LABEL = { lt: '<', lte: '≤', gt: '>', gte: '≥', eq: '=', ne: '≠', out_range: '超出区间' };

const SUGGESTIONS = {
    gross_profit: '检视售价与成本结构，复核低毛利产品报价与采购成本。',
    net_profit_margin: '检查费用率与一次性支出，评估费用控管与产品组合优化。',
    current_ratio: '关注短期偿债安排，盘点流动负债到期结构并预留现金。',
    quick_ratio: '检视存货与应收占用，优先提升速动资产比重。',
    debt_ratio: '控制新增借款，评估资产处置、增资或债务重组方案。',
    ar_turn: '加强应收账款催收与客户信用额度管理，缩短收款周期。',
    inventory_turn: '检视呆滞库存与备货策略，加快库存周转。',
    roe: '提升资产使用效率与获利能力，检视资本结构与股东回报。',
    roa: '检视资产报酬率偏低的资产项，优化资产配置。',
    interest_cov: '关注利息负担与获利能力，评估借款利率与还款节奏。',
    sale_growth: '检视订单与出货动能，强化客户开发与销售预测。',
    profit_growth: '分析净利下滑原因，聚焦成本、费用与价格三方面改善。'
};

function condBreach(value, cond, threshold, cfg) {
    switch (String(cond || 'lt')) {
        case 'lt': return value < threshold;
        case 'lte': return value <= threshold;
        case 'gt': return value > threshold;
        case 'gte': return value >= threshold;
        case 'eq': return value === threshold;
        case 'ne': return value !== threshold;
        case 'out_range': {
            const max = cfg && cfg.max !== undefined ? Number(cfg.max) : threshold;
            return value < threshold || value > max;
        }
        default: return false;
    }
}

function levelOf(kpi) {
    if (!kpi || (!kpi.kpi1 && !kpi.kpi2) || kpi.kpi1 === kpi.kpi2) return 'warning';
    const val = Number(kpi.value);
    const asc = kpi.pct_type !== 'desc';
    const red = asc ? val > kpi.kpi2 : val < kpi.kpi1;
    return red ? 'danger' : 'warning';
}

function fmtVal(v, unit) {
    const n = Number(v);
    const s = Number.isFinite(n) ? (Math.round(n * 10000) / 10000).toLocaleString('zh-CN') : '-';
    return unit ? `${s}${unit}` : s;
}

async function latestMonth(bu) {
    const [rows] = await pool.execute(
        'SELECT MAX(YYYY_MM) AS m FROM mgm_finance_summary WHERE bu_no=?', [bu]);
    return rows[0]?.m || null;
}

async function scanBuFinance(bu_no, { YYYY_MM } = {}) {
    const bu = String(bu_no || 'HM').toUpperCase();
    const result = { bu_no: bu, YYYY_MM: null, scanned: 0, triggered: 0, suppressed: 0, created: [], errors: [] };
    try {
        const month = YYYY_MM || await latestMonth(bu);
        result.YYYY_MM = month;
        if (!month) {
            result.errors.push('无财务汇总数据，无法扫描');
            return result;
        }
        const kpis = await computeKpis(bu, month);
        if (!kpis) {
            result.errors.push(`${month} 无财务汇总数据`);
            return result;
        }

        const [rules] = await pool.execute(
            `SELECT * FROM alert_rule
              WHERE alert_domain='FINANCE' AND status=1 AND (bu_no IS NULL OR bu_no=?)
              ORDER BY uid`, [bu]);

        for (const rule of rules) {
            result.scanned++;
            const kpi = kpis[rule.kpi_id];
            if (!kpi || kpi.value === null || kpi.value === undefined) continue;
            const threshold = Number(rule.threshold);
            let cfg = rule.rule_config;
            if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch { cfg = null; } }
            if (!condBreach(Number(kpi.value), rule.cond, threshold, cfg)) continue;

            const cooldown = Math.max(1, Math.min(720, Number(rule.cooldown_hours || 24)));
            const dedupKey = `FIN|${rule.uid}|${bu}|${month}`;
            const [dup] = await pool.execute(
                `SELECT uid FROM alert_log WHERE dedup_key=?
                  AND created_at >= DATE_SUB(NOW(), INTERVAL ${cooldown} HOUR) LIMIT 1`,
                [dedupKey]);
            if (dup.length) { result.suppressed++; continue; }

            const level = levelOf(kpi);
            const unit = kpi.unit || '';
            const title = `⚠️ ${bu} ${month} ${kpi.name}触发预警`;
            const message = `当前值 ${fmtVal(kpi.value, unit)}，规则条件 ${COND_LABEL[rule.cond] || rule.cond} ${fmtVal(threshold, unit)}（${rule.rule_name}）`;
            const suggestion = SUGGESTIONS[rule.kpi_id] || '请至 KPI 查询页检视明细并制定改善行动。';

            const [ins] = await pool.execute(
                `INSERT INTO alert_log
                    (rule_id, bu_no, kpi_id, kpi_name, current_value, threshold, level,
                     title, message, suggestion, channel, alert_domain, dedup_key, notify_status)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?, 'FINANCE', ?, 'PENDING')`,
                [rule.uid, bu, rule.kpi_id, kpi.name, Number(kpi.value), threshold, level,
                 title, message, suggestion, rule.notify_channel || 'inapp', dedupKey]);

            // CTO-07: 自動觸發通知發送
            const levelMap = { danger: 'HIGH', warning: 'MEDIUM', info: 'LOW' };
            notifier.send({
                event_type: 'KPI_TRIGGER',
                event_cat: 'FINANCE',
                title, body: message,
                level: levelMap[level] || 'MEDIUM',
                bu_no: bu, storeLog: false  // 已寫 alert_log，不重複寫
            }).catch(e => console.error('[kpiAlertScanner] notifier.send error:', e.message));

            result.triggered++;
            result.created.push({
                uid: ins.insertId, rule_id: rule.uid, kpi_id: rule.kpi_id,
                kpi_name: kpi.name, value: Number(kpi.value), threshold, level
            });
        }
    } catch (e) {
        result.errors.push(e.message);
    }
    return result;
}

async function scanAllFinance({ YYYY_MM } = {}) {
    const bus = [];
    for (const bu of BUS) bus.push(await scanBuFinance(bu, { YYYY_MM }));
    return { bus, total_created: bus.reduce((s, b) => s + b.created.length, 0) };
}

module.exports = { scanBuFinance, scanAllFinance, condBreach, levelOf };
