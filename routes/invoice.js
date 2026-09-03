/**
 * 發票明細路由 (AR/AP Invoice)
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, pagination, n } = require('../utils/response');

// 列表（返回前端期望的字段名：inv_date, inv_no, type1, cust_name, amt, tax_amt, status1）
router.get('/', async (req, res) => {
    try {
        const { bu_no, TX_type, type1, client_id, invoice_no, YYYY_MM } = req.query;
        // 前端傳 type1，後端 DB 用 TX_type，同時兼容
        const filterType = TX_type || type1;
        let sql = `SELECT uid, bu_no,
            wk_date AS inv_date, invoice_no AS inv_no,
            TX_type AS type1, client_id AS cust_name,
            sub_amt AS amt, VAT_amt AS tax_amt,
            CASE WHEN pay_date IS NOT NULL THEN 'paid' ELSE 'unpaid' END AS status1,
            wk_date, pay_date, DB_CR, YYYY_MM, remark, create_time, update_time
            FROM MGM_invoice_details WHERE 1=1`;
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (filterType) { sql += ' AND TX_type=?'; params.push(filterType); }
        if (client_id) { sql += ' AND client_id LIKE ?'; params.push(`%${client_id}%`); }
        if (invoice_no) { sql += ' AND invoice_no LIKE ?'; params.push(`%${invoice_no}%`); }
        if (YYYY_MM) { sql += ' AND YYYY_MM=?'; params.push(YYYY_MM); }
        sql += ' ORDER BY wk_date DESC LIMIT 500';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// 新增
router.post('/', async (req, res) => {
    try {
        const d = req.body;
        const [result] = await pool.execute(
            `INSERT INTO MGM_invoice_details (bu_no, TX_type, order_id, client_id, invoice_no, sub_amt,
               tax_type, tax_rate, VAT_amt, wk_date, pay_date, payment, ageing_days, DB_CR, YYYY_MM, remark)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [n(d.bu_no), n(d.TX_type), n(d.order_id), n(d.client_id), n(d.invoice_no), n(d.sub_amt),
             n(d.tax_type), n(d.tax_rate || 0), n(d.VAT_amt || 0), n(d.wk_date), n(d.pay_date),
             n(d.payment || 0), n(d.ageing_days || 0), n(d.DB_CR), n(d.YYYY_MM), n(d.remark)]
        );
        ok(res, { uid: result.insertId }, '發票已新增');
    } catch (err) { fail500(res, err); }
});

// 修改
router.put('/:uid', async (req, res) => {
    try {
        const d = req.body;
        await pool.execute(
            `UPDATE MGM_invoice_details SET bu_no=?, TX_type=?, order_id=?, client_id=?, invoice_no=?,
               sub_amt=?, tax_type=?, tax_rate=?, VAT_amt=?, wk_date=?, pay_date=?, payment=?,
               ageing_days=?, DB_CR=?, YYYY_MM=?, remark=? WHERE uid=?`,
            [n(d.bu_no), n(d.TX_type), n(d.order_id), n(d.client_id), n(d.invoice_no),
             n(d.sub_amt), n(d.tax_type), n(d.tax_rate), n(d.VAT_amt), n(d.wk_date), n(d.pay_date),
             n(d.payment), n(d.ageing_days), n(d.DB_CR), n(d.YYYY_MM), n(d.remark), n(req.params.uid)]
        );
        ok(res, null, '發票已更新');
    } catch (err) { fail500(res, err); }
});

// 刪除
router.delete('/:uid', async (req, res) => {
    try {
        await pool.execute('DELETE FROM MGM_invoice_details WHERE uid=?', [req.params.uid]);
        ok(res, null, '發票已刪除');
    } catch (err) { fail500(res, err); }
});

// 從 SO 產生 AR 發票
router.post('/genAR', async (req, res) => {
    try {
        const { bu_no, so_nbr } = req.body;
        if (!bu_no || !so_nbr) return fail(res, '需要 bu_no 和 so_nbr');

        const [sos] = await pool.execute(
            'SELECT * FROM ERMM_erp_SO WHERE bu_no=? AND so_nbr=?', [bu_no, so_nbr]
        );
        if (sos.length === 0) return fail(res, 'SO 不存在');

        for (const so of sos) {
            const sub_amt = Number(so.unit_price) * Number(so.dn_qty);
            await pool.execute(
                `INSERT INTO MGM_invoice_details (bu_no, TX_type, order_id, client_id, client_name,
                   invoice_no, sub_amt, wk_date, YYYY_MM)
                 VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE sub_amt=VALUES(sub_amt)`,
                [n(bu_no), 'AR', n(so_nbr), n(so.client_id), n(so.client_name), n(so.so_nbr), n(sub_amt), n(so.so_date), n(so.YYYY_MM)]
            );
        }
        ok(res, null, `已產生 ${sos.length} 筆 AR 發票`);
    } catch (err) { fail500(res, err); }
});

// 從 PO 產生 AP 發票
router.post('/genAP', async (req, res) => {
    try {
        const { bu_no, po_id } = req.body;
        if (!bu_no || !po_id) return fail(res, '需要 bu_no 和 po_id');

        const [pos] = await pool.execute(
            'SELECT * FROM ermm_erp_po WHERE bu_no=? AND po_id=?', [bu_no, po_id]
        );
        if (pos.length === 0) return fail(res, 'PO 不存在');

        for (const po of pos) {
            const sub_amt = Number(po.po_amount) + Number(po.vat_amt);
            await pool.execute(
                `INSERT INTO MGM_invoice_details (bu_no, TX_type, order_id, client_id, invoice_no,
                   sub_amt, VAT_amt, wk_date, YYYY_MM)
                 VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE sub_amt=VALUES(sub_amt)`,
                [n(bu_no), 'AP', n(po_id), n(po.supplier_name), n(po.po_id), n(sub_amt), n(po.vat_amt), n(po.po_date), n(po.YYYY_MM)]
            );
        }
        ok(res, null, `已產生 ${pos.length} 筆 AP 發票`);
    } catch (err) { fail500(res, err); }
});

module.exports = router;
