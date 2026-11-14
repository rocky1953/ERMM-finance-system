/**
 * 收款登记路由 (receipt_detail)
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');

// ===== 列表 =====
router.get('/', async (req, res) => {
    try {
        const { bu_no, invoice_uid, YYYY_MM, client_id } = req.query;
        let sql = `SELECT r.*, i.invoice_no, i.client_id AS inv_client_id, i.sub_amt AS inv_amt,
                          i.payment AS inv_paid, (i.sub_amt - i.payment) AS inv_unpaid
                   FROM receipt_detail r
                   LEFT JOIN mgm_invoice_details i ON i.uid=r.invoice_uid
                   WHERE 1=1`;
        const params = [];
        if (bu_no) { sql += ' AND r.bu_no=?'; params.push(bu_no); }
        if (invoice_uid) { sql += ' AND r.invoice_uid=?'; params.push(invoice_uid); }
        if (client_id) { sql += ' AND r.client_id LIKE ?'; params.push(`%${client_id}%`); }
        if (YYYY_MM) { sql += ' AND DATE_FORMAT(r.receipt_date, "%Y-%m")=?'; params.push(YYYY_MM); }
        sql += ' ORDER BY r.receipt_date DESC, r.uid DESC LIMIT 500';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ===== 未结 AR 发票下拉 =====
router.get('/invoice-options', async (req, res) => {
    try {
        const { bu_no, client_id } = req.query;
        let sql = `SELECT i.uid, i.bu_no, i.invoice_no, i.order_id, i.client_id,
                          i.sub_amt, i.payment,
                          (i.sub_amt - i.payment) AS unpaid
                   FROM mgm_invoice_details i
                   WHERE i.TX_type='AR' AND i.sub_amt > COALESCE(i.payment, 0)`;
        const params = [];
        if (bu_no) { sql += ' AND i.bu_no=?'; params.push(bu_no); }
        if (client_id) { sql += ' AND i.client_id LIKE ?'; params.push(`%${client_id}%`); }
        sql += ' ORDER BY i.uid DESC LIMIT 500';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ===== 详情 =====
router.get('/:uid', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT r.*, i.invoice_no, i.sub_amt AS inv_amt, i.payment AS inv_paid
             FROM receipt_detail r LEFT JOIN mgm_invoice_details i ON i.uid=r.invoice_uid
             WHERE r.uid=?`,
            [req.params.uid]
        );
        if (!rows.length) return fail(res, '不存在', 404);
        ok(res, rows[0]);
    } catch (err) { fail500(res, err); }
});

// ===== 新建 =====
router.post('/', async (req, res) => {
    try {
        const d = req.body;
        const invoice_uid = Number(d.invoice_uid) || null;
        // 从发票自动带出 bu_no / client_id / invoice_no / order_id
        let bu_no = d.bu_no, client_id = d.client_id, invoice_no = d.invoice_no, order_id = d.order_id;
        if (invoice_uid) {
            const [[inv]] = await pool.execute(
                'SELECT bu_no, client_id, invoice_no, order_id FROM mgm_invoice_details WHERE uid=? AND TX_type="AR"',
                [invoice_uid]
            );
            if (inv) {
                if (!bu_no) bu_no = inv.bu_no;
                if (!client_id) client_id = inv.client_id;
                if (!invoice_no) invoice_no = inv.invoice_no;
                if (!order_id) order_id = inv.order_id;
            }
        }
        const receipt_amt = Number(d.receipt_amt) || 0;
        if (!receipt_amt || receipt_amt <= 0) return fail(res, '收款金额必须大于 0', 400);

        const [r] = await pool.execute(`
            INSERT INTO receipt_detail
                (bu_no, client_id, invoice_uid, invoice_no, order_id,
                 receipt_date, receipt_amt, bank_name, currency_ab, remark)
            VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [bu_no, client_id, invoice_uid, invoice_no, order_id,
             d.receipt_date || null, receipt_amt, d.bank_name || null,
             d.currency_ab || 'TWD', d.remark || null]
        );
        ok(res, { uid: r.insertId }, '收款单已登记');
    } catch (err) { fail500(res, err); }
});

// ===== 修改 =====
router.put('/:uid', async (req, res) => {
    try {
        const d = req.body;
        // 已参与匹配（ar_match_result 有引用）则禁止修改金额
        const [[m]] = await pool.execute(
            'SELECT COUNT(*) c FROM ar_match_result WHERE receipt_settled=1 AND invoice_uid IN (SELECT invoice_uid FROM receipt_detail WHERE uid=?)',
            [req.params.uid]
        );
        if (Number(m.c) > 0) return fail(res, '已参与核销，无法修改', 400);

        const updates = [];
        const values = [];
        for (const k of ['bu_no','client_id','invoice_uid','invoice_no','order_id','receipt_date','receipt_amt','bank_name','currency_ab','remark']) {
            if (k in d) { updates.push(`${k}=?`); values.push(d[k] === undefined ? null : d[k]); }
        }
        if (!updates.length) return fail(res, '无更新字段', 400);
        values.push(req.params.uid);
        await pool.execute(`UPDATE receipt_detail SET ${updates.join(',')}, update_time=NOW() WHERE uid=?`, values);
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

// ===== 删除 =====
router.delete('/:uid', async (req, res) => {
    try {
        const [[m]] = await pool.execute(
            'SELECT COUNT(*) c FROM ar_match_result WHERE receipt_settled=1 AND invoice_uid IN (SELECT invoice_uid FROM receipt_detail WHERE uid=?)',
            [req.params.uid]
        );
        if (Number(m.c) > 0) return fail(res, '已参与核销，无法删除', 400);
        await pool.execute('DELETE FROM receipt_detail WHERE uid=?', [req.params.uid]);
        ok(res, null, '已删除');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
