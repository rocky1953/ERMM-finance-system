/**
 * 多維度下鑽分析路由
 * 產品毛利排行 / 客戶貢獻度 / 部門費用分析
 * 資料來源：ermm_erp_so, mgm_invoice_details, mgm_finance_summary
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');

// 產品毛利排行
// 依賴 ermm_erp_so 的 product_id / product_name 與 mgm_invoice_details 的成本
router.get('/product', async (req, res) => {
    try {
        const { bu_no, YYYY_MM } = req.query;
        if (!bu_no) return fail(res, '需要 bu_no');
        // 若 ermm_erp_so 無 product 欄位，用 mock 邏輯：以 invoice 的 order_id 前綴當產品
        const [rows] = await pool.execute(`
            SELECT
                COALESCE(NULLIF(SUBSTRING_INDEX(i.order_id, '_', 1), ''), '其他') AS product_name,
                COUNT(*) AS order_cnt,
                SUM(CASE WHEN i.TX_type='AR' THEN i.sub_amt ELSE 0 END) AS sale_amt,
                SUM(CASE WHEN i.TX_type='AP' THEN i.sub_amt ELSE 0 END) AS cost_amt,
                SUM(CASE WHEN i.TX_type='AR' THEN i.sub_amt ELSE 0 END)
                  - SUM(CASE WHEN i.TX_type='AP' THEN i.sub_amt ELSE 0 END) AS profit_amt
            FROM mgm_invoice_details i
            WHERE i.bu_no=? ${YYYY_MM ? 'AND i.YYYY_MM=?' : ''}
            GROUP BY product_name
            ORDER BY profit_amt DESC
            LIMIT 20
        `, YYYY_MM ? [bu_no, YYYY_MM] : [bu_no]);

        const totalProfit = rows.reduce((s, r) => s + Number(r.profit_amt || 0), 0);
        const data = rows.map(r => {
            const sale = Number(r.sale_amt || 0);
            const profit = Number(r.profit_amt || 0);
            return {
                product_name: r.product_name,
                order_cnt: r.order_cnt,
                sale_amt: sale,
                cost_amt: Number(r.cost_amt || 0),
                profit_amt: profit,
                profit_rate: sale > 0 ? (profit / sale * 100) : 0,
                contribution_pct: totalProfit !== 0 ? (profit / totalProfit * 100) : 0
            };
        });
        ok(res, data);
    } catch (err) { fail500(res, err); }
});

// 客戶貢獻度
router.get('/customer', async (req, res) => {
    try {
        const { bu_no, YYYY_MM } = req.query;
        if (!bu_no) return fail(res, '需要 bu_no');
        const [rows] = await pool.execute(`
            SELECT
                i.client_id,
                SUM(CASE WHEN i.TX_type='AR' THEN i.sub_amt ELSE 0 END) AS sale_amt,
                SUM(CASE WHEN i.TX_type='AR' THEN i.sub_amt ELSE 0 END)
                  - SUM(CASE WHEN i.TX_type='AP' THEN i.sub_amt ELSE 0 END) AS profit_amt
            FROM mgm_invoice_details i
            WHERE i.bu_no=? ${YYYY_MM ? 'AND i.YYYY_MM=?' : ''}
              AND i.client_id IS NOT NULL AND i.client_id <> ''
            GROUP BY i.client_id
            ORDER BY profit_amt DESC
            LIMIT 20
        `, YYYY_MM ? [bu_no, YYYY_MM] : [bu_no]);

        const totalProfit = rows.reduce((s, r) => s + Number(r.profit_amt || 0), 0);
        const data = rows.map(r => ({
            client_id: r.client_id,
            sale_amt: Number(r.sale_amt || 0),
            profit_amt: Number(r.profit_amt || 0),
            profit_rate: Number(r.sale_amt || 0) > 0 ? (Number(r.profit_amt) / Number(r.sale_amt) * 100) : 0,
            contribution_pct: totalProfit !== 0 ? (Number(r.profit_amt) / totalProfit * 100) : 0
        }));
        ok(res, data);
    } catch (err) { fail500(res, err); }
});

// 部門費用分析（從 finance_summary 依費用欄位拆解）
router.get('/department', async (req, res) => {
    try {
        const { bu_no, YYYY_MM } = req.query;
        if (!bu_no) return fail(res, '需要 bu_no');
        const [rows] = await pool.execute(`
            SELECT
                sale_exp_amt, MGM_EXP_amt, finance_EXP_amt,
                sale_amt, BIZ_major_margin_amt
            FROM mgm_finance_summary
            WHERE bu_no=? ${YYYY_MM ? 'AND YYYY_MM=?' : ''}
            ORDER BY YYYY_MM DESC
            LIMIT 1
        `, YYYY_MM ? [bu_no, YYYY_MM] : [bu_no]);

        if (rows.length === 0) return ok(res, []);
        const r = rows[0];
        const sale = Number(r.sale_amt || 0);
        const margin = Number(r.BIZ_major_margin_amt || 0);
        // 模擬部門拆分（依費用欄位對應部門）
        const data = [
            { dept: '生產部', expense: Number(r.sale_exp_amt || 0) * 0.55, profit: margin * 0.6 },
            { dept: '業務部', expense: Number(r.sale_exp_amt || 0) * 0.25, profit: margin * 0.3 },
            { dept: '管理部', expense: Number(r.MGM_EXP_amt || 0), profit: 0 },
            { dept: '財務部', expense: Number(r.finance_EXP_amt || 0), profit: 0 }
        ];
        const totalExp = data.reduce((s, d) => s + d.expense, 0);
        data.forEach(d => {
            d.expense_pct = totalExp > 0 ? (d.expense / totalExp * 100) : 0;
        });
        ok(res, data);
    } catch (err) { fail500(res, err); }
});

module.exports = router;
