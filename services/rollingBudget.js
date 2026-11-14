/**
 * 滚动预算与三表联动（CFO-05）
 *
 * 逻辑：
 *   1. 以财务汇总（mgm_finance_summary）最新实际月为基准，最近 3 个月平均推导基准收入与费用结构
 *   2. 按假设（增长率、成本率、税率、应收/应付/存货天数、资本支出、还本）滚动生成 N 个月
 *   3. 由同一套数据联动产出：损益表 → 资产负债表 → 现金流量表，并做资产=负债+权益勾稽
 *   4. 由月度预测摊到 13 周，形成滚动现金预测（含安全水位）
 */

const { pool } = require('../config/db');

const DEFAULTS = {
    months: 12,
    revenue_growth: 0.01,
    cost_ratio: 0.5869,
    tax_rate: 0.15,
    ar_days: 60,
    ap_days: 45,
    inv_days: 60,
    capex_monthly: 0,
    loan_repay_monthly: 0
};
const DEFAULT_SAFE_LEVEL = 3000000;
const WEEKS = 13;
const WEEKS_PER_MONTH = 4.3333;

function round2(v) { return Math.round(Number(v || 0) * 100) / 100; }
function round4(v) { return Math.round(Number(v || 0) * 10000) / 10000; }
function clamp(v, min, max) { return Math.min(max, Math.max(min, Number(v) || 0)); }

/** YYYY-MM 加减月份 */
function addMonths(ym, n) {
    if (!ym) return null;
    const [y, m] = ym.split('-').map(Number);
    const total = y * 12 + (m - 1) + n;
    const ny = Math.floor(total / 12), nm = total % 12 + 1;
    return `${ny}-${String(nm).padStart(2, '0')}`;
}

function fmtDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 最近 24 个月财务汇总（新→旧） */
async function getActuals(bu_no) {
    const [rows] = await pool.execute(`
        SELECT YYYY_MM, sale_amt, sale_cost_amt, sale_exp_amt, MGM_EXP_amt, finance_EXP_amt,
               net_profit_amt, AR_amt, AP_amt, stock_value_amt, cash_amt, deposite_amt,
               ttl_asset_amt, ttl_debet_amt, stockholder_amt
        FROM mgm_finance_summary
        WHERE bu_no=?
        ORDER BY YYYY_MM DESC
        LIMIT 24`, [bu_no]);
    return rows;
}

function deriveBase(rows) {
    if (!rows || !rows.length) return null;
    const recent = rows.slice(0, Math.min(3, rows.length));
    const avg = k => recent.reduce((s, r) => s + Number(r[k] || 0), 0) / recent.length;
    const latest = rows[0];

    const avgRevenue = avg('sale_amt');
    const avgCost = avg('sale_cost_amt');
    const saleExp = avg('sale_exp_amt'), mgmExp = avg('MGM_EXP_amt'), finExp = avg('finance_EXP_amt');
    const opex = saleExp + mgmExp + finExp;
    const costRatio = avgRevenue > 0 ? avgCost / avgRevenue : DEFAULTS.cost_ratio;
    const opexRatio = avgRevenue > 0 ? opex / avgRevenue : 0.06;

    // 有效所得税率
    const ebt = avgRevenue - avgCost - opex;
    const net = avg('net_profit_amt');
    let taxRate = ebt > 0 ? (ebt - net) / ebt : DEFAULTS.tax_rate;
    if (!(taxRate >= 0 && taxRate < 0.6)) taxRate = DEFAULTS.tax_rate;

    // 其他费用（财务汇总中的营业外/其他支出）：用实际净利反推，避免预测净利率虚高
    const impliedEbt = net / Math.max(0.01, 1 - taxRate);
    const otherExp = Math.max(0, avgRevenue - avgCost - opex - impliedEbt);
    const otherExpRatio = avgRevenue > 0 ? otherExp / avgRevenue : 0;

    const saleLatest = Number(latest.sale_amt || 0);
    const costLatest = Number(latest.sale_cost_amt || 0);
    const ar = Number(latest.AR_amt || 0);
    const ap = Number(latest.AP_amt || 0);
    const inv = Number(latest.stock_value_amt || 0);
    const cash = Number(latest.cash_amt || 0) + Number(latest.deposite_amt || 0);
    const totalAssets = Number(latest.ttl_asset_amt || 0) || (cash + ar + inv);
    const totalLiab = Number(latest.ttl_debet_amt || 0) || ap;
    const equity = Number(latest.stockholder_amt || 0) || (totalAssets - totalLiab);
    const fixedAssets = Math.max(0, totalAssets - cash - ar - inv);
    const otherLiab = Math.max(0, totalLiab - ap);

    // 季节性：按日历月对近 24 个月收入取均值 / 总均值
    const sumByMonth = {}, cntByMonth = {};
    let sumAll = 0;
    rows.forEach(r => {
        const mm = String(r.YYYY_MM || '').slice(5, 7);
        const amt = Number(r.sale_amt || 0);
        if (!mm || amt <= 0) return;
        sumByMonth[mm] = (sumByMonth[mm] || 0) + amt;
        cntByMonth[mm] = (cntByMonth[mm] || 0) + 1;
        sumAll += amt;
    });
    const avgAll = sumAll / Math.max(1, rows.filter(r => Number(r.sale_amt || 0) > 0).length);
    const seasonal = {};
    Object.keys(sumByMonth).forEach(mm => {
        const mAvg = sumByMonth[mm] / cntByMonth[mm];
        seasonal[mm] = clamp(avgAll > 0 ? mAvg / avgAll : 1, 0.6, 1.6);
    });

    const opexSplit = opex > 0
        ? { sale: saleExp / opex, mgm: mgmExp / opex, finance: finExp / opex }
        : { sale: 0.4, mgm: 0.4, finance: 0.2 };

    return {
        latestMonth: latest.YYYY_MM,
        avgRevenue, costRatio, opexRatio, taxRate, opexSplit, otherExpRatio,
        ar, ap, inv, cash, fixedAssets, otherLiab, equity,
        depreciationMonthly: fixedAssets / 120,
        arDays: saleLatest > 0 ? clamp(ar / saleLatest * 30, 0, 180) : DEFAULTS.ar_days,
        apDays: costLatest > 0 ? clamp(ap / costLatest * 30, 0, 180) : DEFAULTS.ap_days,
        invDays: costLatest > 0 ? clamp(inv / costLatest * 30, 0, 240) : DEFAULTS.inv_days,
        seasonal
    };
}

/** 读取假设（无记录时按实际数推导） */
async function loadModel(bu_no) {
    const rows = await getActuals(bu_no);
    const base = deriveBase(rows);
    const [saved] = await pool.execute(
        `SELECT * FROM rolling_budget_assumption WHERE bu_no=? LIMIT 1`, [bu_no]);
    const s = saved[0] || {};
    const baseMonth = s.base_month || base?.latestMonth || null;
    const pick = (v, d) => (v === null || v === undefined ? d : Number(v));
    const assumption = {
        bu_no,
        base_month: baseMonth,
        start_month: addMonths(baseMonth, 1),
        months: Number(s.months || DEFAULTS.months),
        revenue_growth: pick(s.revenue_growth, DEFAULTS.revenue_growth),
        cost_ratio: pick(s.cost_ratio, base ? round4(base.costRatio) : DEFAULTS.cost_ratio),
        tax_rate: pick(s.tax_rate, base ? round4(base.taxRate) : DEFAULTS.tax_rate),
        ar_days: Number(pick(s.ar_days, base ? Math.round(base.arDays) : DEFAULTS.ar_days)),
        ap_days: Number(pick(s.ap_days, base ? Math.round(base.apDays) : DEFAULTS.ap_days)),
        inv_days: Number(pick(s.inv_days, base ? Math.round(base.invDays) : DEFAULTS.inv_days)),
        capex_monthly: pick(s.capex_monthly, DEFAULTS.capex_monthly),
        loan_repay_monthly: pick(s.loan_repay_monthly, DEFAULTS.loan_repay_monthly),
        saved: !!saved.length,
        derived: base ? {
            latest_month: base.latestMonth,
            avg_revenue: round2(base.avgRevenue),
            opex_ratio: round4(base.opexRatio),
            other_exp_ratio: round4(base.otherExpRatio),
            opening_cash: round2(base.cash),
            opening_ar: round2(base.ar),
            opening_ap: round2(base.ap),
            opening_inventory: round2(base.inv),
            opening_equity: round2(base.equity)
        } : null
    };
    return { assumption, base };
}

async function getAssumption(bu_no) {
    return (await loadModel(bu_no)).assumption;
}

/** 12 个月滚动预测 + 三表联动 */
async function project(bu_no, opts = {}) {
    const { assumption: a, base } = await loadModel(bu_no);
    if (!base) {
        return { bu_no, assumption: a, months: [], summary: null, warning: '无财务汇总数据，无法预测' };
    }
    const months = Math.round(clamp(opts.months || a.months || DEFAULTS.months, 1, 36));

    let cash = base.cash, ar = base.ar, inv = base.inv, ap = base.ap;
    let fixedAssets = base.fixedAssets, otherLiab = base.otherLiab, equity = base.equity;
    const dep = base.depreciationMonthly;
    const rows = [];

    for (let i = 1; i <= months; i++) {
        const ym = addMonths(a.start_month, i - 1);
        const season = base.seasonal[String(ym).slice(5, 7)] || 1;
        const revenue = base.avgRevenue * Math.pow(1 + a.revenue_growth, i) * season;
        const cogs = revenue * a.cost_ratio;
        const gross = revenue - cogs;
        const opex = revenue * base.opexRatio;
        const saleExp = opex * base.opexSplit.sale;
        const mgmExp = opex * base.opexSplit.mgm;
        const finExp = opex * base.opexSplit.finance;
        const otherExp = revenue * base.otherExpRatio;
        const ebt = gross - opex - otherExp;
        const tax = Math.max(ebt, 0) * a.tax_rate;
        const net = ebt - tax;

        const newAr = revenue / 30 * a.ar_days;
        const newInv = cogs / 30 * a.inv_days;
        const newAp = cogs / 30 * a.ap_days;

        const cfOper = net + dep - (newAr - ar) - (newInv - inv) + (newAp - ap);
        const cfInv = -a.capex_monthly;
        const cfFin = -a.loan_repay_monthly;
        const cfNet = cfOper + cfInv + cfFin;

        cash += cfNet;
        fixedAssets = fixedAssets - dep + a.capex_monthly;
        otherLiab = Math.max(0, otherLiab - a.loan_repay_monthly);
        ar = newAr; inv = newInv; ap = newAp;
        equity += net;

        const assets = cash + ar + inv + fixedAssets;
        const liabilities = ap + otherLiab;

        rows.push({
            YYYY_MM: ym,
            revenue: round2(revenue),
            cogs: round2(cogs),
            gross_profit: round2(gross),
            sale_exp: round2(saleExp),
            mgm_exp: round2(mgmExp),
            finance_exp: round2(finExp),
            other_exp: round2(otherExp),
            ebt: round2(ebt),
            tax: round2(tax),
            net_profit: round2(net),
            ar: round2(newAr),
            inventory: round2(newInv),
            ap: round2(newAp),
            cash: round2(cash),
            fixed_assets: round2(fixedAssets),
            other_liab: round2(otherLiab),
            assets: round2(assets),
            liabilities: round2(liabilities),
            equity: round2(equity),
            balance_diff: round2(assets - liabilities - equity),
            cf_operating: round2(cfOper),
            cf_investing: round2(cfInv),
            cf_financing: round2(cfFin),
            cf_net: round2(cfNet),
            depreciation: round2(dep)
        });
    }

    const minRow = rows.reduce((m, r) => (m && m.cash <= r.cash ? m : r), null);
    const summary = {
        start_month: a.start_month,
        end_month: rows.length ? rows[rows.length - 1].YYYY_MM : null,
        months: rows.length,
        total_revenue: round2(rows.reduce((s, r) => s + r.revenue, 0)),
        total_net_profit: round2(rows.reduce((s, r) => s + r.net_profit, 0)),
        total_cf_operating: round2(rows.reduce((s, r) => s + r.cf_operating, 0)),
        opening_cash: round2(base.cash),
        ending_cash: rows.length ? rows[rows.length - 1].cash : round2(base.cash),
        min_cash: minRow ? minRow.cash : round2(base.cash),
        min_cash_month: minRow ? minRow.YYYY_MM : null,
        max_balance_diff: round2(Math.max(...rows.map(r => Math.abs(r.balance_diff)), 0))
    };
    return { bu_no, assumption: a, months: rows, summary };
}

/** 13 周滚动现金预测（由月度预测摊分） */
async function cash13w(bu_no) {
    const proj = await project(bu_no);
    const a = proj.assumption;
    const base = (await loadModel(bu_no)).base;
    const [slRows] = await pool.execute(
        `SELECT safe_amount FROM mgm_cash_safe_level WHERE bu_no=? LIMIT 1`, [bu_no]);
    const safe = Number(slRows[0]?.safe_amount ?? DEFAULT_SAFE_LEVEL);

    let cash = base ? base.cash : 0;
    const weeks = [];
    for (let w = 1; w <= WEEKS; w++) {
        const mi = Math.min(proj.months.length - 1, Math.floor((w - 1) / WEEKS_PER_MONTH));
        const m = proj.months[mi];
        const inflow = m ? m.revenue / WEEKS_PER_MONTH : 0;
        const outflow = m
            ? (m.cogs + m.sale_exp + m.mgm_exp + m.finance_exp + m.tax) / WEEKS_PER_MONTH
            : 0;
        const capex = (a.capex_monthly || 0) / WEEKS_PER_MONTH;
        const loan = (a.loan_repay_monthly || 0) / WEEKS_PER_MONTH;
        const net = inflow - outflow - capex - loan;
        const start = cash;
        cash += net;

        const d = new Date(a.start_month + '-01T00:00:00');
        d.setDate(d.getDate() + (w - 1) * 7);
        weeks.push({
            week: w,
            week_from: fmtDate(d),
            inflow: round2(inflow),
            outflow: round2(outflow),
            capex: round2(capex),
            loan_repay: round2(loan),
            net: round2(net),
            start_balance: round2(start),
            end_balance: round2(cash),
            is_safe: cash >= safe
        });
    }
    const minWeek = weeks.reduce((m, x) => (m && m.end_balance <= x.end_balance ? m : x), null);
    return {
        bu_no,
        safe_level: safe,
        start_month: a.start_month,
        opening_cash: round2(base ? base.cash : 0),
        ending_cash: round2(cash),
        min_balance: minWeek ? minWeek.end_balance : round2(cash),
        min_week: minWeek ? minWeek.week : null,
        below_safe_weeks: weeks.filter(x => !x.is_safe).length,
        weeks
    };
}

/** 保存假设（UPSERT） */
async function saveAssumption(bu_no, body = {}, user_id) {
    const cur = await getAssumption(bu_no);
    const val = (k, d) => (body[k] === undefined || body[k] === '' || body[k] === null ? cur[k] : Number(body[k]));
    const rec = {
        base_month: body.base_month || cur.base_month,
        months: Math.round(clamp(val('months', DEFAULTS.months), 1, 36)),
        revenue_growth: clamp(val('revenue_growth', DEFAULTS.revenue_growth), -0.5, 0.5),
        cost_ratio: clamp(val('cost_ratio', DEFAULTS.cost_ratio), 0.01, 2),
        tax_rate: clamp(val('tax_rate', DEFAULTS.tax_rate), 0, 0.6),
        ar_days: Math.round(clamp(val('ar_days', DEFAULTS.ar_days), 0, 365)),
        ap_days: Math.round(clamp(val('ap_days', DEFAULTS.ap_days), 0, 365)),
        inv_days: Math.round(clamp(val('inv_days', DEFAULTS.inv_days), 0, 365)),
        capex_monthly: clamp(val('capex_monthly', 0), 0, 1e12),
        loan_repay_monthly: clamp(val('loan_repay_monthly', 0), 0, 1e12)
    };
    await pool.execute(`
        INSERT INTO rolling_budget_assumption
            (bu_no, base_month, months, revenue_growth, cost_ratio, tax_rate,
             ar_days, ap_days, inv_days, capex_monthly, loan_repay_monthly, update_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE
            base_month=VALUES(base_month), months=VALUES(months),
            revenue_growth=VALUES(revenue_growth), cost_ratio=VALUES(cost_ratio),
            tax_rate=VALUES(tax_rate), ar_days=VALUES(ar_days),
            ap_days=VALUES(ap_days), inv_days=VALUES(inv_days),
            capex_monthly=VALUES(capex_monthly), loan_repay_monthly=VALUES(loan_repay_monthly),
            update_by=VALUES(update_by)`,
        [bu_no, rec.base_month, rec.months, rec.revenue_growth, rec.cost_ratio, rec.tax_rate,
            rec.ar_days, rec.ap_days, rec.inv_days, rec.capex_monthly, rec.loan_repay_monthly, user_id || null]);
    return getAssumption(bu_no);
}

module.exports = {
    getAssumption, saveAssumption, project, cash13w,
    _internals: { addMonths, deriveBase }
};
