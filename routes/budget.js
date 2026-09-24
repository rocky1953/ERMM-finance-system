/**
 * 預算編制路由
 * 預算 vs 實際比較、差異分析、年度預算彙總
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');

// 預算列表
router.get('/', async (req, res) => {
    try {
        const { bu_no } = req.query;
        let sql = 'SELECT * FROM budget WHERE 1=1';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        sql += ' ORDER BY YYYY DESC, bu_no';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// 預算 vs 實際（依科目/月份）
router.get('/detail', async (req, res) => {
    try {
        const { bu_no, YYYY, account_code } = req.query;
        if (!bu_no || !YYYY) return fail(res, '需要 bu_no 與 YYYY');
        let sql = `SELECT account_code, account_name, YYYY_MM, budget_amt, actual_amt,
                          (actual_amt - budget_amt) AS diff_amt,
                          CASE WHEN budget_amt>0 THEN ROUND((actual_amt-budget_amt)/budget_amt*100,2) ELSE 0 END AS diff_pct
                   FROM budget_detail WHERE bu_no=? AND YYYY_MM LIKE ?`;
        const params = [bu_no, `${YYYY}%`];
        if (account_code) { sql += ' AND account_code=?'; params.push(account_code); }
        sql += ' ORDER BY account_code, YYYY_MM';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// 年度預算彙總（依科目）
router.get('/summary', async (req, res) => {
    try {
        const { bu_no, YYYY } = req.query;
        if (!bu_no || !YYYY) return fail(res, '需要 bu_no 與 YYYY');
        const [rows] = await pool.execute(`
            SELECT account_code, account_name,
                   SUM(budget_amt) AS total_budget,
                   SUM(actual_amt) AS total_actual,
                   SUM(actual_amt - budget_amt) AS total_diff,
                   CASE WHEN SUM(budget_amt)>0 THEN ROUND(SUM(actual_amt-budget_amt)/SUM(budget_amt)*100,2) ELSE 0 END AS diff_pct
            FROM budget_detail
            WHERE bu_no=? AND YYYY_MM LIKE ?
            GROUP BY account_code, account_name
            ORDER BY account_code
        `, [bu_no, `${YYYY}%`]);

        // 計算達成率
        const data = rows.map(r => ({
            ...r,
            achievement: r.total_budget > 0 ? Math.round(r.total_actual / r.total_budget * 1000) / 10 : 0
        }));
        ok(res, data);
    } catch (err) { fail500(res, err); }
});

// 月度預算執行進度
router.get('/monthly-progress', async (req, res) => {
    try {
        const { bu_no, YYYY } = req.query;
        if (!bu_no || !YYYY) return fail(res, '需要 bu_no 與 YYYY');
        const [rows] = await pool.execute(`
            SELECT YYYY_MM,
                   SUM(budget_amt) AS month_budget,
                   SUM(actual_amt) AS month_actual
            FROM budget_detail
            WHERE bu_no=? AND YYYY_MM LIKE ?
            GROUP BY YYYY_MM
            ORDER BY YYYY_MM
        `, [bu_no, `${YYYY}%`]);
        let cumBudget = 0, cumActual = 0;
        const data = rows.map(r => {
            cumBudget += Number(r.month_budget || 0);
            cumActual += Number(r.month_actual || 0);
            return {
                YYYY_MM: r.YYYY_MM,
                month_budget: Number(r.month_budget),
                month_actual: Number(r.month_actual),
                cum_budget: Math.round(cumBudget * 100) / 100,
                cum_actual: Math.round(cumActual * 100) / 100,
                achievement: cumBudget > 0 ? Math.round(cumActual / cumBudget * 1000) / 10 : 0
            };
        });
        ok(res, data);
    } catch (err) { fail500(res, err); }
});

module.exports = router;
