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
// 銷售額來自 ermm_erp_so 品項(xitems)；ERP 無工單/BOM（ermm_erp_mo 空），SO 與 PO 訂單號不重疊，
// 無法精確配對材料成本，故毛利額＝品項銷售額 × 當月財務月結實際毛利率（mgm_finance_summary 分攤估算）
router.get('/product', async (req, res) => {
    try {
        const { bu_no, YYYY_MM } = req.query;
        if (!bu_no) return fail(res, '需要 bu_no');
        const [rows] = await pool.execute(`
            WITH fin AS (
                SELECT YYYY_MM,
                       CASE WHEN sale_amt > 0 THEN BIZ_major_margin_amt / sale_amt ELSE 0 END AS gm_rate
                FROM mgm_finance_summary
                WHERE bu_no=? ${YYYY_MM ? 'AND YYYY_MM=?' : ''}
            )
            SELECT
                s.xitems AS product_name,
                COUNT(*) AS order_cnt,
                SUM(s.so_qty * s.unit_price) AS sale_amt,
                SUM(SUM(s.so_qty * s.unit_price)) OVER () AS total_sale,
                SUM(s.so_qty * s.unit_price * COALESCE(f.gm_rate, 0)) AS est_profit
            FROM ermm_erp_so s
            LEFT JOIN fin f ON f.YYYY_MM = s.YYYY_MM
            WHERE s.bu_no=? ${YYYY_MM ? 'AND s.YYYY_MM=?' : ''}
            GROUP BY s.xitems
            ORDER BY est_profit DESC
            LIMIT 20
        `, YYYY_MM ? [bu_no, YYYY_MM, bu_no, YYYY_MM] : [bu_no, bu_no]);

        const totalSale = rows.length ? Number(rows[0].total_sale || 0) : 0;
        const data = rows.map(r => {
            const sale = Number(r.sale_amt || 0);
            const profit = Number(r.est_profit || 0);
            return {
                product_name: r.product_name || '未分類',
                order_cnt: r.order_cnt,
                sale_amt: sale,
                profit_amt: profit,
                profit_rate: sale > 0 ? (profit / sale * 100) : 0,
                contribution_pct: totalSale > 0 ? (profit / totalSale * 100) : 0
            };
        });
        ok(res, data);
    } catch (err) { fail500(res, err); }
});

// 客戶貢獻度（僅統計 AR 銷售發票；貢獻度 = 該客戶銷售額 / 全部客戶銷售額）
// 註：AP 發票的 client_id 是供應商，與客戶無對應成本關係，不可混入客戶毛利
// 毛利率同產品毛利：取當月財務月結實際毛利率分攤估算（ERP 無 BOM 無法按客戶精確算毛利）
router.get('/customer', async (req, res) => {
    try {
        const { bu_no, YYYY_MM } = req.query;
        if (!bu_no) return fail(res, '需要 bu_no');
        const [rows] = await pool.execute(`
            WITH fin AS (
                SELECT YYYY_MM,
                       CASE WHEN sale_amt > 0 THEN BIZ_major_margin_amt / sale_amt ELSE 0 END AS gm_rate
                FROM mgm_finance_summary
                WHERE bu_no=? ${YYYY_MM ? 'AND YYYY_MM=?' : ''}
            )
            SELECT
                i.client_id,
                COUNT(*) AS order_cnt,
                SUM(i.sub_amt) AS sale_amt,
                SUM(SUM(i.sub_amt)) OVER () AS total_sale,
                SUM(i.sub_amt * COALESCE(f.gm_rate, 0)) AS est_profit
            FROM mgm_invoice_details i
            LEFT JOIN fin f ON f.YYYY_MM = i.YYYY_MM
            WHERE i.bu_no=? ${YYYY_MM ? 'AND i.YYYY_MM=?' : ''}
              AND i.TX_type='AR'
              AND i.client_id IS NOT NULL AND i.client_id <> ''
            GROUP BY i.client_id
            ORDER BY sale_amt DESC
            LIMIT 20
        `, YYYY_MM ? [bu_no, YYYY_MM, bu_no, YYYY_MM] : [bu_no, bu_no]);

        const totalSale = rows.length ? Number(rows[0].total_sale || 0) : 0;
        const data = rows.map(r => {
            const sale = Number(r.sale_amt || 0);
            const profit = Number(r.est_profit || 0);
            return {
                client_id: r.client_id,
                order_cnt: r.order_cnt,
                sale_amt: sale,
                profit_amt: profit,
                profit_rate: sale > 0 ? (profit / sale * 100) : 0,
                contribution_pct: totalSale > 0 ? (sale / totalSale * 100) : 0
            };
        });
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
