/**
 * CFO-09 资金与流动性管理
 *
 * 数据来源：
 * 1. 头寸与流动性比率：mgm_finance_summary（现金、银行存款、流动资产、流动负债、借款等）
 * 2. 安全水位：mgm_cash_safe_level（无设定时按「月均现金支出 × 1.5」启发式，最低 300 万）
 * 3. 资金计划：cash_plan_item（按月、按流入/流出编制，支持计划与实际对比）
 * 4. 短期偿债压力：mgm_bank_loan_details（90 天内到期贷款）、pay_request（30 天内待付款）
 * 5. 集团资金池：HM/HN/SZ 头寸汇总，盈余公司向缺口公司给出调剂建议
 */
const { pool } = require('../config/db');

const BUS = ['HM', 'HN', 'SZ'];
const DIRECTIONS = ['IN', 'OUT'];
const ITEM_TYPES = {
    SALES_COLLECTION: { direction: 'IN', label: '销售回款' },
    OTHER_INFLOW: { direction: 'IN', label: '其他流入' },
    PURCHASE_PAYMENT: { direction: 'OUT', label: '采购付款' },
    PAYROLL: { direction: 'OUT', label: '薪酬支付' },
    TAX: { direction: 'OUT', label: '税费缴纳' },
    CAPEX: { direction: 'OUT', label: '资本支出' },
    LOAN_REPAY: { direction: 'OUT', label: '还本付息' },
    OTHER_OUTFLOW: { direction: 'OUT', label: '其他流出' }
};
const MIN_SAFE_FLOOR = 3000000;     // 安全水位下限（元）
const SAFE_COVER_MONTHS = 1.5;      // 安全水位 = 月均现金支出 × 月数
const LOAN_DUE_DAYS = 90;           // 贷款到期观察窗口（天）
const PAY_DUE_DAYS = 30;            // 待付款观察窗口（天）

const n = (v) => Number(v || 0);
const r2 = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.round((x + Number.EPSILON) * 100) / 100 : 0;
};
const r4 = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.round((x + Number.EPSILON) * 10000) / 10000 : null;
};

function normalizeMonth(v) {
    const s = String(v || '').replace('/', '-');
    return /^\d{4}-\d{2}$/.test(s) ? s : null;
}

function prevMonth(month) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const cashOf = (row) => r2(n(row.cash_amt) + n(row.deposite_amt));

function inventoryOf(row) {
    return r2(n(row.stock_P_amt) + n(row.stock_M_amt) + n(row.WIP_M_amt)
        + n(row.WIP_labor_amt) + n(row.WIP_EXP_amt)
        + n(row.stock_transit_amt) + n(row.stock_value_amt));
}

async function latestMonth(bu) {
    const [rows] = await pool.execute(
        'SELECT MAX(YYYY_MM) AS m FROM mgm_finance_summary WHERE bu_no=?', [bu]);
    const m = rows[0]?.m ? String(rows[0].m).slice(0, 7) : '';
    return /^\d{4}-\d{2}$/.test(m) ? m : new Date().toISOString().slice(0, 7);
}

/**
 * 取目标月份财务摘要；无该月数据时回退到该月之前最近一期
 */
async function loadSummary(bu, month) {
    const [exact] = await pool.execute(
        'SELECT * FROM mgm_finance_summary WHERE bu_no=? AND YYYY_MM=? LIMIT 1', [bu, month]);
    if (exact.length) return { row: exact[0], actual_month: month, warning: null };

    const [prev] = await pool.execute(
        `SELECT * FROM mgm_finance_summary WHERE bu_no=? AND YYYY_MM<=?
          ORDER BY YYYY_MM DESC LIMIT 1`, [bu, month]);
    if (prev.length) {
        const actual = String(prev[0].YYYY_MM).slice(0, 7);
        return {
            row: prev[0], actual_month: actual,
            warning: `${bu} 无 ${month} 财务数据，头寸取最近一期 ${actual}`
        };
    }
    return { row: null, actual_month: null, warning: `${bu} 无 ${month} 及以前财务数据` };
}

async function loadSafeAmount(bu, monthlyOutflow) {
    const [rows] = await pool.execute(
        'SELECT safe_amount FROM mgm_cash_safe_level WHERE bu_no=? LIMIT 1', [bu]);
    if (rows.length && n(rows[0].safe_amount) > 0) {
        return { amount: r2(rows[0].safe_amount), source: 'SETTING' };
    }
    const heuristic = Math.max(MIN_SAFE_FLOOR, Math.round(n(monthlyOutflow) * SAFE_COVER_MONTHS));
    return { amount: r2(heuristic), source: 'HEURISTIC' };
}

function buildPosition(row, safe) {
    const cash = cashOf(row);
    const currentAssets = r2(row.current_asset_amt);
    const currentLiabilities = r2(n(row.current_debet_amt) || n(row.AP_amt));
    const inventory = inventoryOf(row);
    const ar = r2(row.AR_amt);
    const ap = r2(row.AP_amt);
    const stLoan = r2(row.loan_amt);
    const ltLoan = r2(row.LT_loan_amt);
    const monthlyOutflow = r2(n(row.sale_cost_amt) + n(row.sale_exp_amt) + n(row.interest_amt));
    const monthlyInflow = r2(row.sale_amt);

    return {
        month: String(row.YYYY_MM).slice(0, 7),
        cash,
        current_assets: currentAssets,
        current_liabilities: currentLiabilities,
        inventory,
        ar,
        ap,
        short_term_loan: stLoan,
        long_term_loan: ltLoan,
        monthly_inflow: monthlyInflow,
        monthly_outflow: monthlyOutflow,
        working_capital: r2(currentAssets - currentLiabilities),
        current_ratio: currentLiabilities > 0 ? r4(currentAssets / currentLiabilities) : null,
        quick_ratio: currentLiabilities > 0 ? r4((currentAssets - inventory) / currentLiabilities) : null,
        cash_ratio: currentLiabilities > 0 ? r4(cash / currentLiabilities) : null,
        debt_ratio: n(row.ttl_asset_amt) > 0 ? r4((n(row.ttl_debet_amt) * 100) / n(row.ttl_asset_amt)) : null,
        cash_cover_months: monthlyOutflow > 0 ? r2(cash / monthlyOutflow) : null,
        surplus: r2(cash - safe.amount)
    };
}

async function loadPlanItems(bu, month) {
    const [rows] = await pool.execute(
        `SELECT * FROM cash_plan_item WHERE bu_no=? AND plan_month=?
          ORDER BY direction DESC, item_type, uid`, [bu, month]);
    return rows.map(r => ({
        ...r,
        plan_amount: r2(r.plan_amount),
        actual_amount: r2(r.actual_amount)
    }));
}

function summarizePlan(items, openingCash, actualNetCash) {
    const planIn = r2(items.filter(i => i.direction === 'IN').reduce((s, i) => s + i.plan_amount, 0));
    const planOut = r2(items.filter(i => i.direction === 'OUT').reduce((s, i) => s + i.plan_amount, 0));
    const actualIn = r2(items.filter(i => i.direction === 'IN').reduce((s, i) => s + i.actual_amount, 0));
    const actualOut = r2(items.filter(i => i.direction === 'OUT').reduce((s, i) => s + i.actual_amount, 0));
    const planNet = r2(planIn - planOut);
    const actualNet = r2(actualIn - actualOut);
    return {
        plan_in: planIn,
        plan_out: planOut,
        plan_net: planNet,
        actual_in: actualIn,
        actual_out: actualOut,
        actual_net: actualNet,
        opening_cash: r2(openingCash),
        closing_plan: r2(openingCash + planNet),
        closing_actual: r2(openingCash + actualNet),
        actual_net_cash: actualNetCash == null ? null : r2(actualNetCash),
        variance: actualNetCash == null ? null : r2(actualNetCash - planNet)
    };
}

async function loadLoans(bu) {
    const [rows] = await pool.execute(
        `SELECT uid, loan_id, bank_id, loan_type, loan_amt, payback_amt, end_date,
                terms_rate, status1,
                DATEDIFF(end_date, CURDATE()) AS days_to_due
           FROM mgm_bank_loan_details
          WHERE bu_no=? AND end_date IS NOT NULL
            AND end_date >= CURDATE()
            AND end_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
          ORDER BY end_date`, [bu, LOAN_DUE_DAYS]);
    const items = rows.map(r => ({
        uid: r.uid,
        loan_id: r.loan_id,
        bank_id: r.bank_id,
        loan_type: r.loan_type,
        loan_amt: r2(r.loan_amt),
        payback_amt: r2(r.payback_amt),
        remaining: r2(Math.max(0, n(r.loan_amt) - n(r.payback_amt))),
        end_date: r.end_date,
        terms_rate: r2(r.terms_rate),
        status: r.status1,
        days_to_due: Number(r.days_to_due)
    }));
    return {
        days: LOAN_DUE_DAYS,
        total: r2(items.reduce((s, i) => s + i.remaining, 0)),
        due_30: r2(items.filter(i => i.days_to_due <= 30).reduce((s, i) => s + i.remaining, 0)),
        items
    };
}

async function loadPendingPayments(bu) {
    const [rows] = await pool.execute(
        `SELECT id, request_no, pay_type, pay_target, total_amount, due_date, status
           FROM pay_request
          WHERE bu_no=? AND status NOT IN ('PAID','REJECTED','CANCELLED','DRAFT')
            AND (due_date IS NULL OR due_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY))
          ORDER BY due_date IS NULL, due_date`, [bu, PAY_DUE_DAYS]);
    const items = rows.map(r => ({
        id: r.id,
        request_no: r.request_no,
        pay_type: r.pay_type,
        pay_target: r.pay_target,
        amount: r2(r.total_amount),
        due_date: r.due_date,
        status: r.status
    }));
    return {
        days: PAY_DUE_DAYS,
        count: items.length,
        amount: r2(items.reduce((s, i) => s + i.amount, 0)),
        items
    };
}

function buildAlerts(bu, month, position, safe, planSummary, loans) {
    const alerts = [];
    const dedup = (code) => `LIQ|${code}|${bu}|${month}`;

    if (position.cash < safe.amount) {
        alerts.push({
            code: 'CASH_BELOW_SAFE', kpi_id: 'LIQ_CASH_BELOW_SAFE', kpi_name: '现金低于安全水位',
            level: 'danger', current_value: position.cash, threshold: safe.amount,
            message: `${bu} ${month} 现金及存款 ${position.cash} 元，低于安全水位 ${safe.amount} 元（缺口 ${r2(safe.amount - position.cash)} 元）`,
            suggestion: '优先催收应收、延后非必要支出，或由集团资金池调入资金补足安全水位。',
            dedup_key: dedup('CASH_BELOW_SAFE')
        });
    }
    if (position.current_ratio !== null && position.current_ratio < 1) {
        alerts.push({
            code: 'CURRENT_RATIO_LOW', kpi_id: 'LIQ_CURRENT_RATIO_LOW', kpi_name: '流动比率低于 1',
            level: 'warning', current_value: position.current_ratio, threshold: 1,
            message: `${bu} ${month} 流动比率 ${position.current_ratio}，流动资产不足以覆盖流动负债`,
            suggestion: '盘点短期借款与应付到期结构，争取续贷或延长账期，压降存货与应收占用。',
            dedup_key: dedup('CURRENT_RATIO_LOW')
        });
    }
    if (planSummary.closing_plan < safe.amount) {
        alerts.push({
            code: 'PLAN_GAP', kpi_id: 'LIQ_PLAN_GAP', kpi_name: '资金计划期末不足',
            level: 'danger', current_value: planSummary.closing_plan, threshold: safe.amount,
            message: `${bu} ${month} 资金计划期末余额 ${planSummary.closing_plan} 元，低于安全水位 ${safe.amount} 元`,
            suggestion: '调整资金计划：加快回款、压缩资本支出或安排短期融资。',
            dedup_key: dedup('PLAN_GAP')
        });
    }
    if (loans.due_30 > 0 && loans.due_30 > position.cash * 0.5) {
        alerts.push({
            code: 'LOAN_MATURITY', kpi_id: 'LIQ_LOAN_MATURITY', kpi_name: '30 天内贷款到期压力',
            level: 'warning', current_value: loans.due_30, threshold: r2(position.cash * 0.5),
            message: `${bu} 30 天内到期贷款本息 ${loans.due_30} 元，超过现金余额的 50%`,
            suggestion: '提前与银行确认续贷/展期，或从集团资金池调剂过桥资金。',
            dedup_key: dedup('LOAN_MATURITY')
        });
    }
    return alerts;
}

/**
 * 单公司资金与流动性明细
 */
async function buildBuDetail(bu, month) {
    const { row, actual_month, warning } = await loadSummary(bu, month);
    if (!row) {
        return {
            bu_no: bu, YYYY_MM: month, warnings: [warning],
            position: null, safe: { amount: 0, source: 'HEURISTIC' },
            plan: { items: [], summary: summarizePlan([], 0, null) },
            loans: { days: LOAN_DUE_DAYS, total: 0, due_30: 0, items: [] },
            pending_payments: { days: PAY_DUE_DAYS, count: 0, amount: 0, items: [] },
            alerts: []
        };
    }

    const monthlyOutflow = n(row.sale_cost_amt) + n(row.sale_exp_amt) + n(row.interest_amt);
    const safe = await loadSafeAmount(bu, monthlyOutflow);
    const position = buildPosition(row, safe);

    const [prev] = await Promise.all([loadSummary(bu, prevMonth(month))]);
    const openingCash = prev.row ? cashOf(prev.row) : position.cash;
    const actualNetCash = prev.row ? r2(position.cash - cashOf(prev.row)) : null;

    const [items, loans, pending] = await Promise.all([
        loadPlanItems(bu, month),
        loadLoans(bu),
        loadPendingPayments(bu)
    ]);
    const summary = summarizePlan(items, openingCash, actualNetCash);
    const alerts = buildAlerts(bu, month, position, safe, summary, loans);

    const warnings = [];
    if (warning) warnings.push(warning);
    if (!prev.row) warnings.push(`无法获取 ${prevMonth(month)} 期初现金，按当期现金余额代替`);

    return {
        bu_no: bu,
        YYYY_MM: month,
        actual_month,
        warnings,
        safe,
        position,
        plan: { month, items, summary },
        loans,
        pending_payments: pending,
        alerts
    };
}

/**
 * 集团资金池：各公司头寸与内调建议
 */
async function buildGroup(month) {
    const rows = [];
    for (const bu of BUS) {
        const { row, actual_month } = await loadSummary(bu, month);
        if (!row) {
            rows.push({ bu_no: bu, actual_month: null, cash: 0, safe: 0, surplus: 0, current_ratio: null, cash_ratio: null });
            continue;
        }
        const monthlyOutflow = n(row.sale_cost_amt) + n(row.sale_exp_amt) + n(row.interest_amt);
        const safe = await loadSafeAmount(bu, monthlyOutflow);
        const pos = buildPosition(row, safe);
        const items = await loadPlanItems(bu, month);
        const summary = summarizePlan(items, pos.cash, null);
        rows.push({
            bu_no: bu,
            actual_month,
            cash: pos.cash,
            safe: safe.amount,
            surplus: pos.surplus,
            current_ratio: pos.current_ratio,
            cash_ratio: pos.cash_ratio,
            plan_net: summary.plan_net,
            closing_plan: summary.closing_plan
        });
    }

    const totals = {
        cash: r2(rows.reduce((s, r) => s + r.cash, 0)),
        safe: r2(rows.reduce((s, r) => s + r.safe, 0)),
        surplus: r2(rows.reduce((s, r) => s + Math.max(0, r.surplus), 0)),
        gap: r2(rows.reduce((s, r) => s + Math.max(0, -r.surplus), 0))
    };

    // 盈余公司按额度向缺口公司调剂（从大到小贪心）
    const pools = rows.filter(r => r.surplus > 0)
        .map(r => ({ bu_no: r.bu_no, left: r.surplus }))
        .sort((a, b) => b.left - a.left);
    const needs = rows.filter(r => r.surplus < 0)
        .map(r => ({ bu_no: r.bu_no, need: -r.surplus }))
        .sort((a, b) => b.need - a.need);
    const transfers = [];
    for (const need of needs) {
        let remain = need.need;
        for (const p of pools) {
            if (remain <= 0) break;
            if (p.left <= 0) continue;
            const amt = r2(Math.min(remain, p.left));
            if (amt <= 0) continue;
            transfers.push({ from: p.bu_no, to: need.bu_no, amount: amt });
            p.left = r2(p.left - amt);
            remain = r2(remain - amt);
        }
    }

    return { YYYY_MM: month, rows, totals, transfers };
}

async function buildOverview(bu, YYYY_MM) {
    const month = normalizeMonth(YYYY_MM) || await latestMonth(bu);
    const [detail, group] = await Promise.all([
        buildBuDetail(bu, month),
        buildGroup(month)
    ]);
    return { ...detail, group };
}

async function writeAlerts(bu, month, alerts) {
    const created = [];
    let suppressed = 0;
    for (const a of alerts) {
        const [dup] = await pool.execute(
            `SELECT uid FROM alert_log WHERE dedup_key=?
              AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) LIMIT 1`, [a.dedup_key]);
        if (dup.length) { suppressed++; continue; }
        const [ins] = await pool.execute(
            `INSERT INTO alert_log
                (rule_id, bu_no, kpi_id, kpi_name, current_value, threshold, level,
                 title, message, suggestion, channel, alert_domain, dedup_key, notify_status)
             VALUES (NULL,?,?,?,?,?,?,?,?,?,?, 'FINANCE', ?, 'SKIPPED')`,
            [bu, a.kpi_id, a.kpi_name, a.current_value, a.threshold, a.level,
             `⚠️ ${bu} ${month} ${a.kpi_name}`, a.message, a.suggestion,
             'inapp', a.dedup_key]);
        created.push({ uid: ins.insertId, code: a.code, level: a.level, message: a.message });
    }
    return { created, suppressed };
}

async function scanBuLiquidity(bu, YYYY_MM) {
    const month = normalizeMonth(YYYY_MM) || await latestMonth(bu);
    const detail = await buildBuDetail(bu, month);
    const r = await writeAlerts(bu, month, detail.alerts || []);
    return {
        bu_no: bu, YYYY_MM: month, scanned: (detail.alerts || []).length,
        created: r.created, suppressed: r.suppressed,
        alerts: detail.alerts || []
    };
}

module.exports = {
    BUS, DIRECTIONS, ITEM_TYPES,
    normalizeMonth, latestMonth, buildOverview, buildBuDetail, buildGroup,
    buildAlerts, summarizePlan, scanBuLiquidity
};
