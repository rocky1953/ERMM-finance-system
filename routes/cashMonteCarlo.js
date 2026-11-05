/**
 * Monte Carlo 現金流量概率預測
 * 基於歷史應收/應付款項的波動分佈，模擬未來 N 週現金餘額的概率分佈
 *
 * 輸出：
 *   - 每週餘額 P10 / P25 / Median / P75 / P90
 *   - 現金跌破安全水位的概率（核心指標）
 *   - 最差/最佳情境
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');

// ===== 工具：簡單的 Box-Muller 常態隨機 =====
function randn() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ===== 工具：從歷史數據估計對數常態分佈（金額適合用 log-normal） =====
function fitLogNormal(values) {
    if (!values || values.length < 3) return { mu: 0, sigma: 0.3 };
    const logs = values.filter(v => v > 0).map(Math.log);
    if (logs.length < 3) return { mu: 0, sigma: 0.3 };
    const mu = logs.reduce((a, b) => a + b, 0) / logs.length;
    const variance = logs.reduce((s, l) => s + (l - mu) ** 2, 0) / logs.length;
    return { mu, sigma: Math.sqrt(Math.max(variance, 0.001)) };
}

// ===== 工具：從分佈採樣（下界 0，避免負金額） =====
function sampleLogNormal(dist) {
    const v = Math.exp(dist.mu + dist.sigma * randn());
    return Math.max(0, v);
}

// ===== 工具：百分位 =====
function percentile(sortedArr, p) {
    if (!sortedArr.length) return 0;
    const idx = (sortedArr.length - 1) * p / 100;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return sortedArr[lo];
    return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

// ===== Monte Carlo 核心 =====
async function runMonteCarlo(bu_no, weeks = 13, sims = 1000) {
    // 1. 當前現金餘額
    const [cashRows] = await pool.execute(`
        SELECT SUM(CASE WHEN UPPER(DB_CR)='DR' THEN sub_amt ELSE -sub_amt END) AS balance
        FROM mgm_casher_details WHERE bu_no=?`, [bu_no]);
    const currentBalance = Number(cashRows[0]?.balance || 0);

    // 2. 歷史應收/應付（取最近 12 個月）
    const [arap] = await pool.execute(`
        SELECT YYYY_MM, AR_amt, AP_amt, sale_amt
        FROM mgm_finance_summary
        WHERE bu_no=? AND ttl_asset_amt > 0
        ORDER BY YYYY_MM DESC LIMIT 12`, [bu_no]);

    // 3. 估計歷史 AR/AP 月變動（作為每週流入/流出的波動來源）
    const arMonthChanges = [];   // 每月 AR 回收（= sale - AR 增量）
    const apMonthFlows = [];     // 每月 AP 付款金額
    let avgSale = 0, avgAR = 0, avgAP = 0;
    if (arap.length >= 2) {
        for (let i = 0; i < arap.length - 1; i++) {
            const cur = arap[i], prev = arap[i + 1];
            const sale = Number(cur.sale_amt || 0);
            const arDelta = Number(cur.AR_amt || 0) - Number(prev.AR_amt || 0);
            const apDelta = Number(cur.AP_amt || 0) - Number(prev.AP_amt || 0);
            arMonthChanges.push(Math.max(0, sale - arDelta));  // 銷貨 - AR 增加 = 當期回收
            apMonthFlows.push(Math.max(0, sale * 0.6 + apDelta)); // 假設成本率 60% + AP 增量
        }
        avgSale = arap.reduce((s, r) => s + Number(r.sale_amt || 0), 0) / arap.length;
        avgAR = Number(arap[0].AR_amt || 0);
        avgAP = Number(arap[0].AP_amt || 0);
    } else {
        // 沒有歷史 → 用預設
        avgSale = 10000000;
        avgAR = 8000000;
        avgAP = 5000000;
    }

    // 4. 估計 AR 回收週期（平均收現天數）= AR / (Sale/30) → 換算成週
    const arDays = avgSale > 0 ? (avgAR / (avgSale / 30)) : 60;
    const arWeeks = Math.max(2, Math.min(12, arDays / 7));
    const apDays = avgSale > 0 ? (avgAP / (avgSale * 0.6 / 30)) : 45;
    const apWeeks = Math.max(2, Math.min(10, apDays / 7));

    // 5. 從歷史估計每週流入/流出的對數常態分佈
    const weeklyARInflows = arMonthChanges.map(v => v / 4.33);  // 月→週
    const weeklyAPOutflows = apMonthFlows.map(v => v / 4.33);
    const arDist = fitLogNormal(weeklyARInflows);
    const apDist = fitLogNormal(weeklyAPOutflows);

    // 6. 貸款還本（固定 + 小幅波動）
    const [loanRows] = await pool.execute(`
        SELECT SUM(loan_amt) AS loan_total FROM mgm_bank_loan_details WHERE bu_no=?`, [bu_no]);
    const weeklyLoan = Number(loanRows[0]?.loan_total || 0) * 0.02;
    const loanDist = { mu: Math.log(Math.max(weeklyLoan, 1)), sigma: 0.15 };

    // 7. 安全水位
    const [safeRows] = await pool.execute(`
        SELECT safe_amount FROM mgm_cash_safe_level WHERE bu_no=?`, [bu_no]);
    const safeLevel = Number(safeRows[0]?.safe_amount || 3000000);

    // 8. 跑 Monte Carlo
    const simResults = [];   // simResults[week] = [balance_sim1, balance_sim2, ...]
    for (let w = 0; w <= weeks; w++) simResults.push([]);

    for (let s = 0; s < sims; s++) {
        let bal = currentBalance;
        simResults[0].push(bal);
        for (let w = 1; w <= weeks; w++) {
            const inflow = sampleLogNormal(arDist);
            const outflow = sampleLogNormal(apDist) + sampleLogNormal(loanDist);
            bal += inflow - outflow;
            simResults[w].push(bal);
        }
    }

    // 9. 彙統計
    const weekStats = [];
    let maxGapProb = 0, gapWeek = 0;
    const minBalances = [];

    for (let w = 1; w <= weeks; w++) {
        const sorted = [...simResults[w]].sort((a, b) => a - b);
        const p10 = percentile(sorted, 10);
        const p25 = percentile(sorted, 25);
        const median = percentile(sorted, 50);
        const p75 = percentile(sorted, 75);
        const p90 = percentile(sorted, 90);
        const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
        const belowSafe = sorted.filter(v => v < safeLevel).length;
        const gapProb = belowSafe / sorted.length;

        weekStats.push({
            week: w,
            p10: Math.round(p10 * 100) / 100,
            p25: Math.round(p25 * 100) / 100,
            median: Math.round(median * 100) / 100,
            p75: Math.round(p75 * 100) / 100,
            p90: Math.round(p90 * 100) / 100,
            mean: Math.round(mean * 100) / 100,
            min: Math.round(sorted[0] * 100) / 100,
            max: Math.round(sorted[sorted.length - 1] * 100) / 100,
            below_safe_prob: Math.round(gapProb * 1000) / 10
        });

        if (gapProb > maxGapProb) { maxGapProb = gapProb; gapWeek = w; }
        minBalances.push(sorted[0]);
    }

    // 10. 未來 4 週 / 8 週 / 13 週內至少一次跌破安全水位的概率
    const probWithin = (nWeeks) => {
        let count = 0;
        for (let s = 0; s < sims; s++) {
            let everBelow = false;
            let bal = currentBalance;
            for (let w = 1; w <= nWeeks; w++) {
                const inflow = sampleLogNormal(arDist);
                const outflow = sampleLogNormal(apDist) + sampleLogNormal(loanDist);
                bal += inflow - outflow;
                if (bal < safeLevel) { everBelow = true; break; }
            }
            if (everBelow) count++;
        }
        return Math.round(count / sims * 1000) / 10;
    };

    const prob4w = probWithin(Math.min(4, weeks));
    const prob8w = probWithin(Math.min(8, weeks));
    const probAll = probWithin(weeks);

    return {
        bu_no,
        current_balance: Math.round(currentBalance * 100) / 100,
        safe_level: safeLevel,
        sims,
        weeks,
        // 歷史參數
        ar_avg_weekly: Math.round(avgSale / 4.33 * 100) / 100,
        ap_avg_weekly: Math.round(avgSale * 0.6 / 4.33 * 100) / 100,
        ar_days: Math.round(arDays),
        ap_days: Math.round(apDays),
        // 概率指標（核心輸出）
        prob_4w: prob4w,
        prob_8w: prob8w,
        prob_all: probAll,
        max_gap_prob: Math.round(maxGapProb * 1000) / 10,
        max_gap_week: gapWeek,
        worst_case: Math.round(Math.min(...minBalances) * 100) / 100,
        best_case: weekStats[weeks - 1]?.max || 0,
        // 每週統計
        weekly: weekStats
    };
}

// Monte Carlo API
router.get('/monte-carlo', async (req, res) => {
    try {
        const { bu_no, weeks, sims } = req.query;
        if (!bu_no) return fail(res, '需要 bu_no');
        const w = Math.min(26, parseInt(weeks) || 13);
        const n = Math.min(5000, Math.max(200, parseInt(sims) || 1000));
        const result = await runMonteCarlo(bu_no, w, n);
        ok(res, result);
    } catch (err) { fail500(res, err); }
});

module.exports = router;
