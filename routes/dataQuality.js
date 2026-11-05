/**
 * T-3 数据质量自动扫描路由
 *
 * 6 大类 20+ 检查项：
 *   1. mgm_finance_summary  — Z_score=0 / 重复 / 空窗 / 成本>营收
 *   2. mgm_invoice_details  — TX_type非法 / 负数 / 付款超额 / 重复发票
 *   3. mgm_bank_loan_details — 余额负数 / 已到期未结清
 *   4. mgm_casher_details   — 借贷不平
 *   5. forecast_detail      — 缺 forecast / 过期 forecast
 *   6. AR/AP 对账           — ermm_arap_detail ≠ invoice 汇总
 *
 * 接口:
 *   GET /api/data-quality/scan      全量扫描
 *   GET /api/data-quality/health    表级别健康度
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail500 } = require('../utils/response');

// ===== 通用工具 =====
function issue(rule_id, severity, category, table, message, detail) {
    return { rule_id, severity, category, table, message, detail };
}

// ===== 1. mgm_finance_summary 财务摘要 =====
async function scanSummary() {
    const issues = [];

    // Q01: Z_score = 0 或 NULL（未计算过）
    try {
        const [rows] = await pool.execute(
            `SELECT bu_no, YYYY_MM, Z_score FROM mgm_finance_summary
             WHERE Z_score IS NULL OR Z_score = 0`);
        rows.forEach(r => issues.push(issue('S-Z0', 'WARN', 'finance_summary', 'mgm_finance_summary',
            `${r.bu_no} ${r.YYYY_MM} Z_score=${r.Z_score}（未计算或为0）`,
            '可触发 /api/batch/step8_risk 重算')));
    } catch (e) { issues.push(issue('S-Z0-ERR', 'INFO', 'finance_summary', 'mgm_finance_summary',
        `扫描异常: ${e.message}`, '')); }

    // Q02: 关键字段 NULL
    try {
        const [rows] = await pool.execute(
            `SELECT bu_no, YYYY_MM, sale_amt, net_profit_amt, total_assets
             FROM mgm_finance_summary
             WHERE sale_amt IS NULL OR net_profit_amt IS NULL OR total_assets IS NULL`);
        rows.forEach(r => issues.push(issue('S-NULL', 'WARN', 'finance_summary', 'mgm_finance_summary',
            `${r.bu_no} ${r.YYYY_MM} 关键字段 NULL`,
            `sale=${r.sale_amt}, net_profit=${r.net_profit_amt}, assets=${r.total_assets}`)));
    } catch (e) {}

    // Q03: sale_amt = 0 但 net_profit_amt ≠ 0（没营收有利润？）
    try {
        const [rows] = await pool.execute(
            `SELECT bu_no, YYYY_MM, sale_amt, net_profit_amt
             FROM mgm_finance_summary
             WHERE (sale_amt IS NULL OR sale_amt = 0)
               AND net_profit_amt IS NOT NULL AND net_profit_amt != 0`);
        rows.forEach(r => issues.push(issue('S-S0', 'ERROR', 'finance_summary', 'mgm_finance_summary',
            `${r.bu_no} ${r.YYYY_MM} 营收为 0 但净利有值`,
            `sale=0, net_profit=${r.net_profit_amt} → 可能 sale_amt 未正确从发票表同步`)));
    } catch (e) {}

    // Q04: sale_cost_amt > sale_amt（成本大于营收 → 毛利为负）
    try {
        const [rows] = await pool.execute(
            `SELECT bu_no, YYYY_MM, sale_amt, sale_cost_amt
             FROM mgm_finance_summary
             WHERE sale_amt > 0 AND sale_cost_amt > sale_amt`);
        rows.forEach(r => issues.push(issue('S-COST', 'WARN', 'finance_summary', 'mgm_finance_summary',
            `${r.bu_no} ${r.YYYY_MM} 成本 > 营收`,
            `sale=${r.sale_amt}, cost=${r.sale_cost_amt}, 毛利=${(r.sale_amt - r.sale_cost_amt).toFixed(0)}`)));
    } catch (e) {}

    // Q05: 同 BU + 同月多条（重复）
    try {
        const [rows] = await pool.execute(
            `SELECT bu_no, YYYY_MM, COUNT(*) AS cnt FROM mgm_finance_summary
             GROUP BY bu_no, YYYY_MM HAVING cnt > 1`);
        rows.forEach(r => issues.push(issue('S-DUP', 'ERROR', 'finance_summary', 'mgm_finance_summary',
            `${r.bu_no} ${r.YYYY_MM} 有 ${r.cnt} 条重复记录`,
            '需删除多余记录，保留一条最新的')));
    } catch (e) {}

    // Q06: 连续月份空窗（同一 BU 缺 2+ 个月）
    try {
        const [months] = await pool.execute(
            `SELECT DISTINCT bu_no, YYYY_MM FROM mgm_finance_summary ORDER BY bu_no, YYYY_MM`);
        const byBU = {};
        months.forEach(r => { (byBU[r.bu_no] = byBU[r.bu_no] || []).push(r.YYYY_MM); });
        for (const [bu, mlist] of Object.entries(byBU)) {
            if (mlist.length < 3) continue;
            const gaps = [];
            for (let i = 1; i < mlist.length; i++) {
                const [y1, m1] = mlist[i-1].split('-').map(Number);
                const [y2, m2] = mlist[i].split('-').map(Number);
                const diff = (y2 - y1) * 12 + (m2 - m1);
                if (diff > 1) gaps.push(`${mlist[i-1]}→${mlist[i]} (缺 ${diff-1} 个月)`);
            }
            if (gaps.length > 0) issues.push(issue('S-GAP', 'WARN', 'finance_summary', 'mgm_finance_summary',
                `${bu} 有月份空窗`, gaps.join('; ')));
        }
    } catch (e) {}

    return issues;
}

// ===== 2. mgm_invoice_details 发票明细 =====
async function scanInvoice() {
    const issues = [];

    // Q10: TX_type 非法
    try {
        const [rows] = await pool.execute(
            `SELECT TX_type, COUNT(*) AS cnt FROM mgm_invoice_details
             WHERE TX_type NOT IN ('AR','AP') GROUP BY TX_type`);
        rows.forEach(r => issues.push(issue('I-TX', 'ERROR', 'invoice', 'mgm_invoice_details',
            `TX_type='${r.TX_type}' 非法（${r.cnt} 笔）`, '合法值: AR / AP')));
    } catch (e) {}

    // Q11: sub_amt < 0 负数金额
    try {
        const [[cnt]] = await pool.execute(
            `SELECT COUNT(*) AS c FROM mgm_invoice_details WHERE sub_amt < 0`);
        if (cnt.c > 0) issues.push(issue('I-NEG', 'ERROR', 'invoice', 'mgm_invoice_details',
            `sub_amt < 0 共 ${cnt.c} 笔负数金额`, '负数发票可能是退货红冲，需确认是否合理'));
    } catch (e) {}

    // Q12: ageing_days 异常大（> 2000 天 ≈ 5.5 年）
    try {
        const [[cnt]] = await pool.execute(
            `SELECT COUNT(*) AS c FROM mgm_invoice_details WHERE ageing_days > 2000`);
        if (cnt.c > 0) issues.push(issue('I-AGE', 'WARN', 'invoice', 'mgm_invoice_details',
            `ageing_days > 2000（${cnt.c} 笔）`, '可能是 wk_date 异常或 ageing_days 未重算'));
    } catch (e) {}

    // Q13: payment > sub_amt（付款超过金额）
    try {
        const [rows] = await pool.execute(
            `SELECT client_id, sub_amt, payment FROM mgm_invoice_details WHERE payment > sub_amt AND sub_amt > 0 LIMIT 10`);
        if (rows.length > 0) issues.push(issue('I-PAY', 'WARN', 'invoice', 'mgm_invoice_details',
            `payment > sub_amt 共 ${rows.length}+ 笔`,
            rows.slice(0,3).map(r => `${r.client_id}: amt=${r.sub_amt}, paid=${r.payment}`).join('; ')));
    } catch (e) {}

    // Q14: 同一 invoice_no 多条（重复发票）
    try {
        const [[cnt]] = await pool.execute(
            `SELECT COUNT(*) AS c FROM (SELECT invoice_no, COUNT(*) n
             FROM mgm_invoice_details WHERE invoice_no IS NOT NULL GROUP BY invoice_no HAVING n>1) t`);
        if (cnt.c > 0) issues.push(issue('I-DUP', 'WARN', 'invoice', 'mgm_invoice_details',
            `重复 invoice_no 共 ${cnt.c} 个`, '去重保留一条'));
    } catch (e) {}

    return issues;
}

// ===== 3. mgm_bank_loan_details 银行贷款 =====
async function scanLoan() {
    const issues = [];
    try {
        const [[cnt]] = await pool.execute(`SELECT COUNT(*) AS c FROM mgm_bank_loan_details WHERE outstanding < 0`);
        if (cnt.c > 0) issues.push(issue('L-NEG', 'ERROR', 'bank_loan', 'mgm_bank_loan_details',
            `outstanding < 0 共 ${cnt.c} 笔`, '余额负数不合理'));
    } catch (e) {}
    try {
        const [[cnt]] = await pool.execute(`SELECT COUNT(*) AS c FROM mgm_bank_loan_details WHERE principal = 0 OR principal IS NULL`);
        if (cnt.c > 0) issues.push(issue('L-P0', 'WARN', 'bank_loan', 'mgm_bank_loan_details',
            `principal = 0 或 NULL 共 ${cnt.c} 笔`, '本金未录入'));
    } catch (e) {}
    try {
        const [[cnt]] = await pool.execute(
            `SELECT COUNT(*) AS c FROM mgm_bank_loan_details
             WHERE maturity_date IS NOT NULL AND maturity_date < CURDATE()
               AND (outstanding > 0 AND outstanding IS NOT NULL)`);
        if (cnt.c > 0) issues.push(issue('L-MAT', 'WARN', 'bank_loan', 'mgm_bank_loan_details',
            `已到期但余额 > 0 共 ${cnt.c} 笔`, '可能是展期未更新或结清未标记'));
    } catch (e) {}
    return issues;
}

// ===== 4. mgm_casher_details 现金日记账 =====
async function scanCash() {
    const issues = [];
    try {
        const [[cnt]] = await pool.execute(
            `SELECT COUNT(*) AS c FROM mgm_casher_details
             WHERE ABS(IFNULL(debit,0) - IFNULL(credit,0)) > 0.01`);
        if (cnt.c > 0) issues.push(issue('C-BAL', 'WARN', 'cash', 'mgm_casher_details',
            `借贷不平共 ${cnt.c} 笔`, `需检查这 ${cnt.c} 条日记账的 debit/credit 是否对称`));
    } catch (e) {}
    return issues;
}

// ===== 5. forecast_detail 财务预测 =====
async function scanForecast() {
    const issues = [];
    try {
        const [months] = await pool.execute(`SELECT DISTINCT YYYY_MM FROM mgm_finance_summary`);
        const [fcMonths] = await pool.execute(`SELECT DISTINCT YYYY_MM FROM forecast_detail`);
        const fcSet = new Set(fcMonths.map(m => m.YYYY_MM));
        const missing = months.filter(m => !fcSet.has(m.YYYY_MM) && m.YYYY_MM >= '2024-01');
        if (missing.length > 0) issues.push(issue('F-MISS', 'INFO', 'forecast', 'forecast_detail',
            `${missing.length} 个月份缺 forecast_detail`, missing.slice(0,5).map(m => m.YYYY_MM).join(', ')));
    } catch (e) {}
    try {
        const [[cnt]] = await pool.execute(
            `SELECT COUNT(*) AS c FROM forecast_detail WHERE YYYY_MM < DATE_FORMAT(CURDATE(), '%Y-%m')`);
        if (cnt.c > 0) issues.push(issue('F-OLD', 'INFO', 'forecast', 'forecast_detail',
            `forecast_detail 里有 ${cnt.c} 条已过期月份`, '过期预测可清理或标记为 archive'));
    } catch (e) {}
    return issues;
}

// ===== 6. AR/AP 对账（ermm_arap_detail vs invoice 汇总）=====
async function scanReconcile() {
    const issues = [];
    try {
        const [rows] = await pool.execute(
            `SELECT d.bu_no, d.YYYY_MM, d.AR_amt AS arap_ar, inv.ar_sum AS inv_ar,
                    ROUND(d.AR_amt - inv.ar_sum, 2) AS diff
             FROM ermm_arap_detail d
             LEFT JOIN (
                 SELECT bu_no, YYYY_MM, SUM(sub_amt) AS ar_sum
                 FROM mgm_invoice_details WHERE TX_type='AR'
                 GROUP BY bu_no, YYYY_MM
             ) inv ON inv.bu_no = d.bu_no AND inv.YYYY_MM = d.YYYY_MM
             WHERE ABS(diff) > 1`);
        if (rows.length > 0) issues.push(issue('R-AR', 'WARN', 'reconcile', 'ermm_arap_detail',
            `AR 对账差异共 ${rows.length} 条（ermm_arap_detail vs invoice 汇总）`,
            rows.slice(0,5).map(r => `${r.bu_no} ${r.YYYY_MM}: diff=${r.diff}`).join('; ')));
    } catch (e) {}
    return issues;
}

// ===== 7. 表级别健康度（表不存在 / 空表）=====
async function scanHealth() {
    const issues = [];
    const tables = [
        'mgm_finance_summary', 'mgm_invoice_details', 'mgm_casher_details',
        'mgm_bank_loan_details', 'ermm_arap_detail', 'forecast_detail',
        'industry_benchmark', 'ermm_knowledge'
    ];
    for (const t of tables) {
        try {
            const [[c]] = await pool.execute(`SELECT COUNT(*) AS c FROM ${t}`);
            if (c.c === 0) issues.push(issue('H-EMPTY', 'ERROR', 'table', t,
                `表 ${t} 是空的`, '无数据，可能 migration 未执行或种子未导入'));
        } catch (e) {
            issues.push(issue('H-MISS', 'ERROR', 'table', t,
                `表 ${t} 不存在或无权限访问`, e.message));
        }
    }
    return issues;
}

// ===== 主扫描入口 =====
const CATEGORIES = [
    { id: 'finance_summary', label: '财务摘要', icon: '📊' },
    { id: 'invoice', label: '发票明细', icon: '🧾' },
    { id: 'bank_loan', label: '银行贷款', icon: '🏦' },
    { id: 'cash', label: '现金日记账', icon: '💵' },
    { id: 'forecast', label: '财务预测', icon: '🔮' },
    { id: 'reconcile', label: 'AR/AP 对账', icon: '⚖️' },
    { id: 'table', label: '表结构健康', icon: '🗂️' }
];

router.get('/scan', async (req, res) => {
    const t0 = Date.now();
    try {
        const all = [
            ...await scanSummary(),
            ...await scanInvoice(),
            ...await scanLoan(),
            ...await scanCash(),
            ...await scanForecast(),
            ...await scanReconcile(),
            ...await scanHealth()
        ];

        // 按 severity 分组
        const bySev = { ERROR: [], WARN: [], INFO: [] };
        all.forEach(i => bySev[i.severity]?.push(i));
        const counts = { ERROR: bySev.ERROR.length, WARN: bySev.WARN.length, INFO: bySev.INFO.length, total: all.length };

        // 按 category 分组
        const byCat = {};
        CATEGORIES.forEach(c => { byCat[c.id] = { label: c.label, icon: c.icon, issues: [] }; });
        all.forEach(i => { if (byCat[i.category]) byCat[i.category].issues.push(i); });

        ok(res, {
            scanned_at: new Date().toISOString(),
            duration_ms: Date.now() - t0,
            counts, bySev, byCat,
            all_issues: all
        });
    } catch (err) { fail500(res, err); }
});

router.get('/health', async (req, res) => {
    try {
        const issues = await scanHealth();
        ok(res, { tables: CATEGORIES, issues });
    } catch (err) { fail500(res, err); }
});

module.exports = router;
