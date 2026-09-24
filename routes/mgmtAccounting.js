/**
 * 管理會計路由
 * 部門損益、責任中心、成本分析、人效分析
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');

// 部門損益表
router.get('/dept-pl', async (req, res) => {
    try {
        const { bu_no, YYYY_MM } = req.query;
        if (!bu_no) return fail(res, '需要 bu_no');
        let sql = `SELECT p.bu_no, p.dept_code, d.dept_name, d.dept_type, d.manager,
                          p.YYYY_MM, p.revenue_amt, p.cost_amt, p.expense_amt, p.profit_amt, p.headcount
                   FROM mgmt_dept_pl p
                   JOIN mgmt_dept d ON p.bu_no=d.bu_no AND p.dept_code=d.dept_code
                   WHERE p.bu_no=?`;
        const params = [bu_no];
        if (YYYY_MM) { sql += ' AND p.YYYY_MM=?'; params.push(YYYY_MM); }
        sql += ' ORDER BY p.YYYY_MM DESC, p.dept_code';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// 部門損益彙總（依部門）
router.get('/dept-summary', async (req, res) => {
    try {
        const { bu_no, YYYY } = req.query;
        if (!bu_no || !YYYY) return fail(res, '需要 bu_no 與 YYYY');
        const [rows] = await pool.execute(`
            SELECT p.dept_code, d.dept_name, d.dept_type,
                   SUM(p.revenue_amt) AS total_revenue,
                   SUM(p.cost_amt) AS total_cost,
                   SUM(p.expense_amt) AS total_expense,
                   SUM(p.profit_amt) AS total_profit,
                   AVG(p.headcount) AS avg_headcount
            FROM mgmt_dept_pl p
            JOIN mgmt_dept d ON p.bu_no=d.bu_no AND p.dept_code=d.dept_code
            WHERE p.bu_no=? AND p.YYYY_MM LIKE ?
            GROUP BY p.dept_code, d.dept_name, d.dept_type
            ORDER BY total_profit DESC
        `, [bu_no, `${YYYY}%`]);

        const totalProfit = rows.reduce((s, r) => s + Number(r.total_profit || 0), 0);
        const data = rows.map(r => ({
            ...r,
            profit_margin: Number(r.total_revenue) > 0 ? (Number(r.total_profit) / Number(r.total_revenue) * 100) : 0,
            profit_per_person: Number(r.avg_headcount) > 0 ? (Number(r.total_profit) / Number(r.avg_headcount)) : 0,
            contribution_pct: totalProfit !== 0 ? (Number(r.total_profit) / totalProfit * 100) : 0
        }));
        ok(res, data);
    } catch (err) { fail500(res, err); }
});

// 成本結構分析
router.get('/cost-structure', async (req, res) => {
    try {
        const { bu_no, YYYY_MM } = req.query;
        if (!bu_no) return fail(res, '需要 bu_no');
        const [rows] = await pool.execute(`
            SELECT sale_amt, sale_cost_amt, sale_exp_amt, MGM_EXP_amt, finance_EXP_amt,
                   operation_EXP_amt, salary_amt, employee_cnt
            FROM mgm_finance_summary
            WHERE bu_no=? ${YYYY_MM ? 'AND YYYY_MM=?' : ''}
            ORDER BY YYYY_MM DESC LIMIT 1
        `, YYYY_MM ? [bu_no, YYYY_MM] : [bu_no]);

        if (rows.length === 0) return ok(res, []);
        const r = rows[0];
        const sale = Number(r.sale_amt || 0);
        const data = [
            { item: '銷售成本', amount: Number(r.sale_cost_amt || 0), pct: sale > 0 ? (Number(r.sale_cost_amt) / sale * 100) : 0 },
            { item: '銷售費用', amount: Number(r.sale_exp_amt || 0), pct: sale > 0 ? (Number(r.sale_exp_amt) / sale * 100) : 0 },
            { item: '管理費用', amount: Number(r.MGM_EXP_amt || 0), pct: sale > 0 ? (Number(r.MGM_EXP_amt) / sale * 100) : 0 },
            { item: '財務費用', amount: Number(r.finance_EXP_amt || 0), pct: sale > 0 ? (Number(r.finance_EXP_amt) / sale * 100) : 0 },
            { item: '薪資費用', amount: Number(r.salary_amt || 0), pct: sale > 0 ? (Number(r.salary_amt) / sale * 100) : 0 }
        ];
        ok(res, { items: data, total_sale: sale, employee_cnt: Number(r.employee_cnt || 0) });
    } catch (err) { fail500(res, err); }
});

// 人效分析
router.get('/efficiency', async (req, res) => {
    try {
        const { bu_no, YYYY_MM } = req.query;
        if (!bu_no) return fail(res, '需要 bu_no');
        const [rows] = await pool.execute(`
            SELECT YYYY_MM, sale_amt, net_profit_amt, employee_cnt, salary_amt,
                   (sale_amt / NULLIF(employee_cnt,0)) AS sale_per_person,
                   (net_profit_amt / NULLIF(employee_cnt,0)) AS profit_per_person,
                   (salary_amt / NULLIF(employee_cnt,0)) AS salary_per_person,
                   (net_profit_amt / NULLIF(salary_amt,0)) AS profit_per_salary
            FROM mgm_finance_summary
            WHERE bu_no=? ${YYYY_MM ? 'AND YYYY_MM=?' : ''}
            ORDER BY YYYY_MM DESC LIMIT 12
        `, YYYY_MM ? [bu_no, YYYY_MM] : [bu_no]);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

module.exports = router;
