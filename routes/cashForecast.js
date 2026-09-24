/**
 * 現金流量預測路由
 * 未來 13 週滾動預測：結合應收到期、應付到期、貸款還本
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');

// 13 週現金預測
router.get('/weekly', async (req, res) => {
    try {
        const { bu_no, weeks } = req.query;
        if (!bu_no) return fail(res, '需要 bu_no');
        const w = Math.min(26, parseInt(weeks) || 13);

        // 1. 當前現金餘額（現金日記結餘）
        const [cashRows] = await pool.execute(`
            SELECT
                SUM(CASE WHEN UPPER(DB_CR)='DR' THEN sub_amt ELSE -sub_amt END) AS balance
            FROM mgm_casher_details
            WHERE bu_no=?
        `, [bu_no]);
        let balance = Number(cashRows[0]?.balance || 0);

        // 2. 應收帳款：取最近一期 AR_amt，AR_ageing 為逾期金額（回收率較低）
        const [arRows] = await pool.execute(`
            SELECT AR_amt, AR_ageing
            FROM ermm_arap_detail
            WHERE bu_no=? AND AR_amt IS NOT NULL
            ORDER BY YYYY_MM DESC
            LIMIT 1
        `, [bu_no]);
        const ar = arRows[0] || { AR_amt: 0, AR_ageing: 0 };
        const arTotal = Number(ar.AR_amt || 0);
        const arOverdue = Number(ar.AR_ageing || 0);
        // 回收率假設：正常應收 80% 可在未來 6 週回收，逾期部分 30%
        const arCollectible = (arTotal - arOverdue) * 0.8 + arOverdue * 0.3;
        const arInflow = arCollectible / Math.min(w, 6);

        // 3. 應付帳款：取最近一期 AP_amt
        const [apRows] = await pool.execute(`
            SELECT AP_amt
            FROM ermm_arap_detail
            WHERE bu_no=? AND AP_amt IS NOT NULL
            ORDER BY YYYY_MM DESC
            LIMIT 1
        `, [bu_no]);
        const apTotal = Number(apRows[0]?.AP_amt || 0);
        const apOutflow = apTotal / Math.min(w, 6);

        // 4. 貸款還本付息（未來 w 週平均分攤）
        const [loanRows] = await pool.execute(`
            SELECT SUM(loan_amt) AS loan_total
            FROM mgm_bank_loan_details
            WHERE bu_no=?
        `, [bu_no]);
        const loanOutflow = Number(loanRows[0]?.loan_total || 0) * 0.02; // 每週約 2% 攤還

        // 5. 產生每週預測
        const SAFE_LEVEL = 300;
        const forecast = [];
        for (let i = 1; i <= w; i++) {
            const inflow = arInflow;
            const outflow = apOutflow + loanOutflow;
            balance += inflow - outflow;
            forecast.push({
                week: i,
                start_balance: Math.round((balance - inflow + outflow) * 100) / 100,
                inflow: Math.round(inflow * 100) / 100,
                outflow: Math.round(outflow * 100) / 100,
                end_balance: Math.round(balance * 100) / 100,
                is_safe: balance >= SAFE_LEVEL,
                safe_level: SAFE_LEVEL
            });
        }

        // 6. 彙總
        const totalInflow = forecast.reduce((s, f) => s + f.inflow, 0);
        const totalOutflow = forecast.reduce((s, f) => s + f.outflow, 0);
        const minBalance = Math.min(...forecast.map(f => f.end_balance));
        const minWeek = forecast.find(f => f.end_balance === minBalance)?.week;

        ok(res, {
            current_balance: Number(cashRows[0]?.balance || 0),
            total_inflow: Math.round(totalInflow * 100) / 100,
            total_outflow: Math.round(totalOutflow * 100) / 100,
            min_balance: Math.round(minBalance * 100) / 100,
            min_week: minWeek,
            safe_level: SAFE_LEVEL,
            weeks: forecast
        });
    } catch (err) { fail500(res, err); }
});

module.exports = router;
