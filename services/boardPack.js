/**
 * 董事会 / 投资人报告包（CEO-02）
 *
 * 一次取数产出报告包所需的六大区块：
 *   1. 经营摘要：营收/净利/毛利率同比与环比、现金、风险条数
 *   2. 三大报表：损益表（本期 + 年初至今 + 去年同期）、资产负债表（期末 vs 上期）、现金流量表
 *   3. 核心 KPI：盈利能力、偿债能力、营运能力、现金
 *   4. 风险预警：亏损、毛利下滑、负债率、现金水位、逾期应收、经营现金流
 *   5. 重大事项：复用集团驾驶舱（告警 + 指标推导）
 *   6. BU 对比：各公司当月收入/净利/毛利率/负债率
 *
 * 数据源：mgm_finance_summary（含 cash_* 现金流字段与比率字段）、
 *        group_target（目标）、alert_log（告警）、mgm_invoice_details（逾期应收）
 */

const { pool } = require('../config/db');
const { getGroupCockpit } = require('./groupCockpit');

const SAFE_CASH = 3000000;

const SUM_FIELDS = [
    'sale_amt', 'sale_cost_amt', 'net_sale_amt', 'sale_discount_amt',
    'sale_exp_amt', 'MGM_EXP_amt', 'finance_EXP_amt', 'operation_EXP_amt',
    'BIZ_other_INC_amt', 'others_INC_amt', 'others_cost_amt', 'INVEST_profit_amt',
    'operation_profit_amt', 'pretax_profit_amt', 'net_profit_amt',
    'addon_tax_amt', 'sale_tax_amt', 'salary_amt',
    'cash_begin_amt', 'cash_operation_in', 'cash_operation_out',
    'cash_invest_in', 'cash_invest_out', 'cash_finance_in', 'cash_finance_out', 'cash_end_amt'
];

const POINT_FIELDS = [
    'cash_amt', 'deposite_amt', 'AR_amt', 'AR_affiliate_amt', 'AP_amt',
    'stock_value_amt', 'current_asset_amt', 'ttl_asset_amt',
    'loan_amt', 'LT_loan_amt', 'current_debet_amt', 'ttl_debet_amt',
    'captial_stock', 'stockholder_amt', 'employee_cnt'
];

const num = (v) => (v === null || v === undefined || isNaN(v)) ? 0 : Number(v);
const r2 = (v) => Math.round(num(v) * 100) / 100;

function pct(a, b) { return num(b) !== 0 ? r2(num(a) / num(b) * 100) : null; }
function growth(cur, prev) {
    if (prev === null || prev === undefined || num(prev) === 0) return null;
    return r2((num(cur) - num(prev)) / Math.abs(num(prev)) * 100);
}

/** 期间月份：季报取季末三个月，月报取单月 */
function periodMonths(ym, period) {
    const y = String(ym).slice(0, 4);
    const m = Number(String(ym).slice(5, 7));
    if (period === 'quarter') {
        const end = Math.ceil(m / 3) * 3;
        return {
            base: `${y}-${String(end).padStart(2, '0')}`,
            months: [end - 2, end - 1, end].map(x => `${y}-${String(x).padStart(2, '0')}`)
        };
    }
    return { base: String(ym).slice(0, 7), months: [String(ym).slice(0, 7)] };
}

function ytdMonths(ym) {
    const y = String(ym).slice(0, 4);
    const m = Number(String(ym).slice(5, 7));
    return Array.from({ length: m }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
}

function lastYearMonths(months) {
    return months.map(x => `${Number(x.slice(0, 4)) - 1}-${x.slice(5)}`);
}

function prevMonth(ym) {
    const y = Number(String(ym).slice(0, 4));
    const m = Number(String(ym).slice(5, 7));
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function sumRows(rows, fields) {
    const o = {};
    fields.forEach(f => { o[f] = 0; });
    rows.forEach(r => fields.forEach(f => { o[f] = num(o[f]) + num(r[f]); }));
    return o;
}

/** 读取财务行；GROUP 时按月份聚合多家公司 */
async function loadRows(buNo) {
    const isGroup = !buNo || buNo === 'GROUP';
    const [rows] = await pool.execute(`
        SELECT * FROM mgm_finance_summary
        ${isGroup ? '' : 'WHERE bu_no=?'}
        ORDER BY YYYY_MM DESC`, isGroup ? [] : [buNo]);

    const byMonth = new Map();
    rows.forEach(r => {
        if (!byMonth.has(r.YYYY_MM)) byMonth.set(r.YYYY_MM, []);
        byMonth.get(r.YYYY_MM).push(r);
    });

    const months = Array.from(byMonth.keys()).sort().reverse();
    const monthly = months.map(m => {
        const list = byMonth.get(m);
        return Object.assign({ YYYY_MM: m, bu_no: buNo || 'GROUP' }, sumRows(list, SUM_FIELDS), sumRows(list, POINT_FIELDS));
    });
    return { monthly, raw: rows };
}

function pick(monthly, months) {
    const set = new Set(months);
    return monthly.filter(r => set.has(r.YYYY_MM));
}

function incomeOf(rows) {
    const s = sumRows(rows, SUM_FIELDS);
    const gross = num(s.sale_amt) - num(s.sale_cost_amt);
    return {
        sale: r2(s.sale_amt),
        cost: r2(s.sale_cost_amt),
        gross_profit: r2(gross),
        gross_margin: num(s.sale_amt) > 0 ? r2(gross / num(s.sale_amt) * 100) : null,
        sale_exp: r2(s.sale_exp_amt),
        mgmt_exp: r2(s.MGM_EXP_amt),
        finance_exp: r2(s.finance_EXP_amt),
        operation_profit: r2(s.operation_profit_amt),
        pretax_profit: r2(s.pretax_profit_amt),
        net_profit: r2(s.net_profit_amt),
        net_margin: num(s.sale_amt) > 0 ? r2(num(s.net_profit_amt) / num(s.sale_amt) * 100) : null
    };
}

function balanceOf(latest) {
    const cash = num(latest.cash_amt) + num(latest.deposite_amt);
    return {
        cash_total: r2(cash),
        cash: r2(latest.cash_amt),
        deposit: r2(latest.deposite_amt),
        ar: r2(latest.AR_amt),
        inventory: r2(latest.stock_value_amt),
        current_asset: r2(latest.current_asset_amt),
        total_asset: r2(latest.ttl_asset_amt),
        ap: r2(latest.AP_amt),
        short_loan: r2(latest.loan_amt),
        long_loan: r2(latest.LT_loan_amt),
        current_liab: r2(latest.current_debet_amt),
        total_liab: r2(latest.ttl_debet_amt),
        equity: r2(latest.stockholder_amt),
        employee_cnt: num(latest.employee_cnt),
        debt_ratio: num(latest.ttl_asset_amt) > 0 ? r2(num(latest.ttl_debet_amt) / num(latest.ttl_asset_amt) * 100) : null,
        current_ratio: num(latest.current_debet_amt) > 0 ? r2(num(latest.current_asset_amt) / num(latest.current_debet_amt) * 100) / 100 : null,
        net_debt: r2(num(latest.loan_amt) + num(latest.LT_loan_amt) - cash)
    };
}

function cashflowOf(rows, beginBal, endBal) {
    const s = sumRows(rows, SUM_FIELDS);
    const opIn = num(s.cash_operation_in), opOut = num(s.cash_operation_out);
    const invIn = num(s.cash_invest_in), invOut = num(s.cash_invest_out);
    const finIn = num(s.cash_finance_in), finOut = num(s.cash_finance_out);
    // rows 由新到旧：最后一行是本期最早月（取现金期初），第一行是最近月（取现金期末）
    const first = rows[rows.length - 1] || {};
    const last = rows[0] || {};
    // 期初/期末优先与资产负债表「现金及存款」对齐，避免 cash_* 明细与总账口径不一致
    const begin = beginBal !== null && beginBal !== undefined ? num(beginBal) : num(first.cash_begin_amt);
    const end = endBal !== null && endBal !== undefined ? num(endBal) : num(last.cash_end_amt);
    return {
        begin: r2(begin),
        operation_in: r2(opIn),
        operation_out: r2(opOut),
        operation_net: r2(opIn - opOut),
        invest_in: r2(invIn),
        invest_out: r2(invOut),
        invest_net: r2(invIn - invOut),
        finance_in: r2(finIn),
        finance_out: r2(finOut),
        finance_net: r2(finIn - finOut),
        net_change: r2(end - begin),
        end: r2(end)
    };
}

/** 逾期应收（>90 天） */
async function overdueAR(buNo) {
    try {
        const isGroup = !buNo || buNo === 'GROUP';
        const [rows] = await pool.execute(`
            SELECT COUNT(*) AS cnt, COALESCE(SUM(sub_amt - COALESCE(payment,0)),0) AS amt
            FROM mgm_invoice_details
            WHERE TX_type='AR' AND ageing_days > 90 ${isGroup ? '' : 'AND bu_no=?'}`,
            isGroup ? [] : [buNo]);
        return { cnt: num(rows[0] && rows[0].cnt), amt: r2(rows[0] && rows[0].amt) };
    } catch (e) { return { cnt: 0, amt: 0 }; }
}

function buildRisks({ income, incomeLY, balance, cashflow, overdue }) {
    const risks = [];
    if (num(income.net_profit) < 0) {
        risks.push({
            level: income.net_margin !== null && income.net_margin < -10 ? 'critical' : 'warning',
            area: '盈利', title: '本期亏损',
            detail: `净利润 ${income.net_profit.toLocaleString()} 元，净利率 ${income.net_margin === null ? '-' : income.net_margin + '%'}`
        });
    }
    if (incomeLY && incomeLY.gross_margin !== null && income.gross_margin !== null &&
        income.gross_margin < incomeLY.gross_margin - 2) {
        risks.push({
            level: 'warning', area: '盈利', title: '毛利率下滑',
            detail: `本期 ${income.gross_margin}%，去年同期 ${incomeLY.gross_margin}%，下降 ${r2(incomeLY.gross_margin - income.gross_margin)} 个百分点`
        });
    }
    if (balance.debt_ratio !== null && balance.debt_ratio > 60) {
        risks.push({
            level: balance.debt_ratio > 75 ? 'critical' : 'warning', area: '偿债', title: '资产负债率偏高',
            detail: `资产负债率 ${balance.debt_ratio}%，负债 ${balance.total_liab.toLocaleString()} 元 / 资产 ${balance.total_asset.toLocaleString()} 元`
        });
    }
    if (balance.cash_total < SAFE_CASH) {
        risks.push({
            level: balance.cash_total < SAFE_CASH / 2 ? 'critical' : 'warning', area: '资金', title: '现金低于安全水位',
            detail: `期末现金及存款 ${balance.cash_total.toLocaleString()} 元，低于 ${SAFE_CASH.toLocaleString()} 元安全水位`
        });
    }
    if (overdue.amt > 0) {
        risks.push({
            level: overdue.amt > SAFE_CASH ? 'critical' : 'warning', area: '应收', title: '逾期应收超 90 天',
            detail: `${overdue.cnt} 笔，未收金额 ${overdue.amt.toLocaleString()} 元`
        });
    }
    if (cashflow.operation_net < 0) {
        risks.push({
            level: 'warning', area: '现金流', title: '经营现金流为负',
            detail: `经营活动净现金流 ${cashflow.operation_net.toLocaleString()} 元`
        });
    }
    return risks;
}

function buildKpis({ income, incomeLY, incomeYtd, balance, monthly, ym }) {
    const last12 = monthly.slice(0, 12);
    const avgInv = last12.length ? last12.reduce((s, r) => s + num(r.stock_value_amt), 0) / last12.length : 0;
    const ttmSale = last12.reduce((s, r) => s + num(r.sale_amt), 0);
    const ttmCost = last12.reduce((s, r) => s + num(r.sale_cost_amt), 0);
    const days = last12.length * 30 || 30;

    const kpi = (code, label, value, unit, yoy) => ({ code, label, value, unit, yoy });
    return [
        kpi('revenue', '营业收入', income.sale, '元', growth(income.sale, incomeLY && incomeLY.sale)),
        kpi('net_profit', '净利润', income.net_profit, '元', growth(income.net_profit, incomeLY && incomeLY.net_profit)),
        kpi('gross_margin', '毛利率', income.gross_margin, '%', incomeLY && income.gross_margin !== null && incomeLY.gross_margin !== null ? r2(income.gross_margin - incomeLY.gross_margin) : null),
        kpi('net_margin', '净利率', income.net_margin, '%', incomeLY && income.net_margin !== null && incomeLY.net_margin !== null ? r2(income.net_margin - incomeLY.net_margin) : null),
        kpi('roe', '净资产收益率(ROE)', balance.equity > 0 ? r2(num(incomeYtd.net_profit) / balance.equity * 100) : null, '%'),
        kpi('debt_ratio', '资产负债率', balance.debt_ratio, '%'),
        kpi('current_ratio', '流动比率', balance.current_ratio, '倍'),
        kpi('ar_days', '应收天数', ttmSale > 0 ? r2(balance.ar / ttmSale * 365) : null, '天'),
        kpi('inventory_turn', '存货周转率', avgInv > 0 ? r2(ttmCost / avgInv) : null, '次/年'),
        kpi('cash', '现金及存款', balance.cash_total, '元'),
        kpi('net_debt', '净借款', balance.net_debt, '元')
    ];
}

function buildSummary({ buNo, ym, period, income, incomeLY, balance, cashflow, risks, kpis }) {
    const lines = [];
    const revenueYoy = growth(income.sale, incomeLY && incomeLY.sale);
    lines.push(`${buNo === 'GROUP' ? '集团' : buNo} ${ym} ${period === 'quarter' ? '季度' : '月度'}营业收入 ${income.sale.toLocaleString()} 元` +
        (revenueYoy === null ? '' : `，同比${revenueYoy >= 0 ? '增长' : '下降'} ${Math.abs(revenueYoy)}%`));
    lines.push(`净利润 ${income.net_profit.toLocaleString()} 元，毛利率 ${income.gross_margin === null ? '-' : income.gross_margin + '%'}，净利率 ${income.net_margin === null ? '-' : income.net_margin + '%'}`);
    lines.push(`期末资产 ${balance.total_asset.toLocaleString()} 元，负债 ${balance.total_liab.toLocaleString()} 元，资产负债率 ${balance.debt_ratio === null ? '-' : balance.debt_ratio + '%'}；现金及存款 ${balance.cash_total.toLocaleString()} 元`);
    lines.push(`经营活动净现金流 ${cashflow.operation_net.toLocaleString()} 元，本期现金净变动 ${cashflow.net_change.toLocaleString()} 元`);
    const critical = risks.filter(r => r.level === 'critical').length;
    const warning = risks.filter(r => r.level === 'warning').length;
    lines.push(risks.length
        ? `本期识别风险 ${risks.length} 项（严重 ${critical}、关注 ${warning}），详见风险预警章节`
        : '本期未识别到重大财务风险');
    return lines;
}

/**
 * 生成报告包数据
 * @param {object} opts { bu_no, YYYY_MM, period }
 */
async function buildBoardPack({ bu_no = 'GROUP', YYYY_MM, period = 'month' } = {}) {
    const buNo = bu_no || 'GROUP';
    const isGroup = buNo === 'GROUP';

    // 基准月：优先指定，否则取最新一期
    let ym = YYYY_MM ? String(YYYY_MM).slice(0, 7) : null;
    if (!ym) {
        const [r] = await pool.execute(`SELECT MAX(YYYY_MM) AS ym FROM mgm_finance_summary`);
        ym = r[0] && r[0].ym;
    }
    if (!ym) {
        return { bu_no: buNo, YYYY_MM: null, period, empty: true, sections: {} };
    }

    const p = periodMonths(ym, period);
    ym = p.base;
    const months = p.months;
    const prevYm = prevMonth(months[0]);

    const { monthly } = await loadRows(buNo);
    const curRows = pick(monthly, months);
    const ytdRows = pick(monthly, ytdMonths(ym));
    const lyRows = pick(monthly, lastYearMonths(months));
    const latest = monthly.find(r => r.YYYY_MM === ym) || monthly[0] || {};
    const prevRow = monthly.find(r => r.YYYY_MM === prevYm) || {};

    const income = incomeOf(curRows);
    const incomeYtd = incomeOf(ytdRows);
    const incomeLY = lyRows.length ? incomeOf(lyRows) : null;
    const balance = balanceOf(latest);
    const balancePrev = balanceOf(prevRow);
    const cashflow = cashflowOf(curRows, prevRow.YYYY_MM ? balancePrev.cash_total : null, balance.cash_total);
    const overdue = await overdueAR(buNo);

    const risks = buildRisks({ income, incomeLY, balance, cashflow, overdue });
    const kpis = buildKpis({ income, incomeLY, incomeYtd, balance, monthly, ym });
    const summary = buildSummary({ buNo, ym, period, income, incomeLY, balance, cashflow, risks, kpis });

    // 重大事项：复用集团驾驶舱
    let events = [];
    let targets = [];
    let benchmark = null;
    try {
        const g = await getGroupCockpit(ym);
        events = isGroup ? (g.events || []) : (g.events || []).filter(e => !e.bu_no || e.bu_no === buNo);
        const block = (g.targets || []).find(t => t.bu_no === (isGroup ? 'GROUP' : buNo));
        targets = block ? block.rows : [];
        benchmark = g.benchmark || null;
    } catch (e) { /* 驾驶舱不可用时降级 */ }

    // BU 对比（集团口径才展示）
    let buCompare = [];
    if (isGroup) {
        const [buRows] = await pool.execute(`
            SELECT bu_no, sale_amt, sale_cost_amt, net_profit_amt, ttl_asset_amt, ttl_debet_amt, stockholder_amt,
                   cash_amt, deposite_amt
            FROM mgm_finance_summary WHERE YYYY_MM=? ORDER BY bu_no`, [ym]);
        buCompare = buRows.map(r => ({
            bu_no: r.bu_no,
            revenue: r2(r.sale_amt),
            net_profit: r2(r.net_profit_amt),
            gross_margin: num(r.sale_amt) > 0 ? r2((num(r.sale_amt) - num(r.sale_cost_amt)) / num(r.sale_amt) * 100) : null,
            net_margin: num(r.sale_amt) > 0 ? r2(num(r.net_profit_amt) / num(r.sale_amt) * 100) : null,
            debt_ratio: num(r.ttl_asset_amt) > 0 ? r2(num(r.ttl_debet_amt) / num(r.ttl_asset_amt) * 100) : null,
            cash: r2(num(r.cash_amt) + num(r.deposite_amt))
        }));
    }

    return {
        bu_no: buNo,
        YYYY_MM: ym,
        period,
        period_label: period === 'quarter'
            ? `${String(ym).slice(0, 4)} 年 Q${Math.ceil(Number(String(ym).slice(5, 7)) / 3)}`
            : ym,
        generated_at: new Date().toISOString(),
        summary,
        sections: {
            income,
            income_ytd: incomeYtd,
            income_ly: incomeLY,
            balance,
            balance_prev: balancePrev,
            cashflow,
            kpis,
            risks,
            events,
            targets,
            benchmark,
            bu_compare: buCompare,
            overdue_ar: overdue
        }
    };
}

module.exports = { buildBoardPack, SAFE_CASH };
