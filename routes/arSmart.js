/**
 * O-3 AR 催收智能排序路由（v2 — 用 mgm_invoice_details 真明细）
 *
 * 数据源: mgm_invoice_details WHERE TX_type='AR'
 *   - client_id: 客户/供应商 ID（当作 partner）
 *   - wk_date: 交易日期
 *   - ageing_days: 已入账天数（关键！）
 *   - sub_amt: 未税金额（当作 tx_amount）
 *   - payment: 已付金额
 *   → 未收金额 = sub_amt - payment
 *
 * 评分模型：
 *   Score = ageDays×40 + overdue×30 + amount×15 + riskFlag×10 + category×5
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail500 } = require('../utils/response');
const BU_INDUSTRY = { HM: '制造业', SZ: '制造业', HN: '批发零售业' };

// ===== 权重配置 =====
const SCORE_WEIGHTS = { ageDays: 40, overdue: 30, amount: 15, riskFlag: 10, category: 5 };

// ===== 账龄天数 → 归一化分数 =====
function ageScore(days) {
    if (days <= 0) return 0;
    if (days <= 30) return (days / 30) * 10;
    if (days <= 60) return 10 + ((days - 30) / 30) * 20;
    if (days <= 90) return 30 + ((days - 60) / 30) * 10;
    return 40;
}
function overdueScore(days) { return Math.min(days * 0.5, 30); }
function amountScore(amt, maxAmt) {
    if (!amt || amt <= 0) return 0;
    const norm = Math.log10(amt + 1) / Math.log10(Math.max(maxAmt, 100) + 1);
    return norm * 15;
}

// ===== 催收行动建议 =====
function buildAction(score, days, riskFlag, amount, isPartiallyPaid) {
    const amtStr = Number(amount).toLocaleString();
    if (score >= 70) {
        if (days >= 120) return `🔴 **律師函/訴訟** — 已逾期 ${days} 天，金額 ${amtStr}，立即啟動法律程序`;
        if (days >= 90) return `🔴 **出納部門每日電話追討** — 已逾期 ${days} 天，金額 ${amtStr}`;
        return `🔴 **高優先電話催收** — 逾期 ${days} 天，金額 ${amtStr}，今日撥打`;
    }
    if (score >= 50) {
        if (riskFlag === 'danger') return `🟠 **重點催收 + 協商** — 逾期 ${days} 天且公司風險偏高，建議安排面談`;
        if (isPartiallyPaid) return `🟠 **跟進剩餘款** — 已部分付款但仍有 ${amtStr} 未收，業務主管跟進`;
        return `🟠 **業務主管介入** — 逾期 ${days} 天，金額 ${amtStr}`;
    }
    if (score >= 30) return `🟡 **例行催收函** — 逾期 ${days} 天，發送正式催收函`;
    if (score >= 15) return `🟢 **溫和提醒** — 逾期 ${days} 天，寄出對帳單 + 付款提醒`;
    return `🟢 **正常管理** — 帳齡 ${days} 天，在正常信用期內`;
}

// ===== 数据加载 =====
async function loadARData(bu_no) {
    // 最新风险指标
    const [[fin]] = await pool.execute(
        `SELECT Z_score, current_ratio, debt_ratio
         FROM mgm_finance_summary
         WHERE bu_no=? AND YYYY_MM=(SELECT MAX(YYYY_MM) FROM mgm_finance_summary)`,
        [bu_no]
    );
    const riskFlag =
        Number(fin?.Z_score || 99) < 1.23 ? 'danger' :
        Number(fin?.current_ratio || 99) < 1.0 ? 'danger' :
        Number(fin?.debt_ratio || 0) > 60 ? 'danger' :
        Number(fin?.Z_score || 99) < 2.9 ? 'watch' : 'safe';

    // AR 明细（mgm_invoice_details TX_type='AR'，含 ageing_days 真账龄）
    const [details] = await pool.execute(
        `SELECT client_id, wk_date, pay_date, ageing_days,
                sub_amt, payment, ageing_days AS age_days
         FROM mgm_invoice_details
         WHERE TX_type='AR' AND (bu_no=? OR bu_no='ALL')`,
        [bu_no]
    );
    return { fin: fin || {}, riskFlag, details };
}

// ===== 主逻辑：评分排序 =====
async function buildSortedList(bu_no, topN = 20) {
    const { fin, riskFlag, details } = await loadARData(bu_no);

    const items = details.map(d => ({
        client: d.client_id || '未命名客戶',
        amount: Number(d.sub_amt || 0),
        paid: Number(d.payment || 0),
        age_days: Number(d.ageing_days || 0),
        wk_date: d.wk_date,
        pay_date: d.pay_date
    })).filter(x => x.amount > 0);

    // 按客户聚合（同一 client_id 有多笔 → 合并）
    const clientMap = new Map();
    for (const x of items) {
        if (!clientMap.has(x.client)) {
            clientMap.set(x.client, {
                client: x.client,
                total_amount: 0, total_paid: 0,
                oldest_age: 0, oldest_date: x.wk_date,
                invoice_count: 0, invoices: []
            });
        }
        const m = clientMap.get(x.client);
        m.total_amount += x.amount;
        m.total_paid += x.paid;
        m.invoice_count++;
        m.invoices.push(x);
        if (x.age_days > m.oldest_age) {
            m.oldest_age = x.age_days;
            m.oldest_date = x.wk_date;
        }
    }

    const clientList = Array.from(clientMap.values());
    const maxAmt = Math.max(...clientList.map(c => c.total_amount), 1);
    const totalAR = clientList.reduce((s, c) => s + c.total_amount, 0);

    const results = [];
    for (const c of clientList) {
        const unpaid = c.total_amount - c.total_paid;
        if (unpaid <= 0) continue; // 已结清不催收

        const age = c.oldest_age;
        const overdue = Math.max(0, age - 30);
        const isPartiallyPaid = c.total_paid > 0 && c.total_paid < c.total_amount;

        // 风险综合分
        let riskScore = 0;
        if (riskFlag === 'danger') riskScore += 5;
        if (riskFlag === 'watch') riskScore += 2;
        if (unpaid / Math.max(totalAR, 1) > 0.1) riskScore += 5; // 单笔占比 > 10%

        const score = ageScore(age) + overdueScore(overdue) + amountScore(unpaid, maxAmt) + riskScore;

        results.push({
            client: c.client,
            total_amount: c.total_amount.toFixed(2),
            unpaid_amount: unpaid.toFixed(2),
            total_paid: c.total_paid.toFixed(2),
            oldest_age_days: age,
            invoice_count: c.invoice_count,
            risk_flag: riskFlag,
            score: Number(score.toFixed(1)),
            risk_score: riskScore,
            is_partially_paid: isPartiallyPaid,
            action: buildAction(score, age, riskFlag, unpaid, isPartiallyPaid)
        });
    }

    results.sort((a, b) => b.score - a.score);
    return { list: results.slice(0, Math.min(topN, results.length)), total_clients: results.length, total_records: details.length };
}

// ===== 概览 =====
async function buildOverview(bu_no) {
    const { details, riskFlag } = await loadARData(bu_no);
    const totalAmt = details.reduce((s, d) => s + Number(d.sub_amt || 0), 0);
    const totalPaid = details.reduce((s, d) => s + Number(d.payment || 0), 0);
    const unpaid = totalAmt - totalPaid;
    const overdue = details.filter(d => Number(d.ageing_days || 0) > 30);
    const overdueAmt = overdue.reduce((s, d) => s + Number(d.sub_amt || 0), 0);

    const ageBuckets = [
        { label: '0-30天', range: [0, 30] },
        { label: '31-60天', range: [31, 60] },
        { label: '61-90天', range: [61, 90] },
        { label: '90+天', range: [91, 99999] }
    ].map(b => {
        const inRange = details.filter(d => {
            const a = Number(d.ageing_days || 0);
            return a >= b.range[0] && a <= b.range[1];
        });
        const sum = inRange.reduce((s, d) => s + Number(d.sub_amt || 0), 0);
        return { label: b.label, amount: sum.toFixed(2), count: inRange.length,
                 pct: totalAmt > 0 ? (sum / totalAmt * 100).toFixed(1) + '%' : '0%' };
    });

    const sorted = await buildSortedList(bu_no, 999);
    const results = sorted.list || [];

    return {
        bu_no, industry: BU_INDUSTRY[bu_no] || '其他',
        total_invoices: details.length,
        total_amount: totalAmt.toFixed(2),
        total_paid: totalPaid.toFixed(2),
        unpaid_amount: unpaid.toFixed(2),
        overdue_count: overdue.length,
        overdue_amount: overdueAmt.toFixed(2),
        overdue_pct: totalAmt > 0 ? (overdueAmt / totalAmt * 100).toFixed(1) + '%' : '0%',
        avg_age_days: details.length > 0
            ? (details.reduce((s, d) => s + Number(d.ageing_days || 0), 0) / details.length).toFixed(1) : '0',
        risk_flag: riskFlag,
        high_priority: results.filter(r => r.score >= 70).length,
        medium_priority: results.filter(r => r.score >= 50 && r.score < 70).length,
        low_priority: results.filter(r => r.score < 50).length,
        age_buckets: ageBuckets
    };
}

// ===== 路由 =====

// GET /api/ar-smart/collections
router.get('/collections', async (req, res) => {
    try {
        const bu = String(req.query.bu_no || 'HM').toUpperCase();
        const topN = Math.min(50, Math.max(5, parseInt(req.query.topN || '20')));
        const { list, total_clients, total_records } = await buildSortedList(bu, topN);

        const tiers = { urgent: [], high: [], medium: [], low: [] };
        list.forEach(r => {
            if (r.score >= 70) tiers.urgent.push(r);
            else if (r.score >= 50) tiers.high.push(r);
            else if (r.score >= 30) tiers.medium.push(r);
            else tiers.low.push(r);
        });
        ok(res, { bu_no: bu, topN, total_clients, total_records, list, tiers });
    } catch (err) { fail500(res, err); }
});

// GET /api/ar-smart/overview
router.get('/overview', async (req, res) => {
    try {
        const bu = String(req.query.bu_no || 'HM').toUpperCase();
        const data = await buildOverview(bu);
        ok(res, data);
    } catch (err) { fail500(res, err); }
});

// GET /api/ar-smart/overview-all
router.get('/overview-all', async (req, res) => {
    try {
        const results = {};
        for (const bu of ['HM', 'SZ', 'HN']) {
            try { results[bu] = await buildOverview(bu); }
            catch (e) { results[bu] = { error: e.message }; }
        }
        ok(res, results);
    } catch (err) { fail500(res, err); }
});

module.exports = router;
