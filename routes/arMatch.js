/**
 * 收款核销匹配结果工作台
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const { runMatch } = require('../services/arMatch');

// ====== 执行匹配 ======
router.post('/run', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { YYYY_MM, bu_no } = req.body;
        const result = await runMatch(conn, { YYYY_MM, bu_no });
        ok(res, result, `收款核销匹配完成`);
    } catch (err) {
        fail500(res, err);
    } finally {
        conn.release();
    }
});

// ====== 匹配结果列表 ======
router.get('/results', async (req, res) => {
    try {
        const { YYYY_MM, bu_no, match_status, client_id } = req.query;
        let sql = `SELECT r.*, i.invoice_no AS inv_no, i.order_id, i.client_id, i.sub_amt AS inv_sub_amt,
                          i.payment AS cur_payment, i.pay_date AS cur_pay_date,
                          r.prior_payment + r.receipt_amt AS total_paid,
                          r.invoice_amt - (r.prior_payment + r.receipt_amt) AS final_unpaid
                   FROM ar_match_result r
                   LEFT JOIN mgm_invoice_details i ON i.uid=r.invoice_uid
                   WHERE 1=1`;
        const params = [];
        if (YYYY_MM) { sql += ' AND r.YYYY_MM=?'; params.push(YYYY_MM); }
        if (bu_no) { sql += ' AND r.bu_no=?'; params.push(bu_no); }
        if (match_status) { sql += ' AND r.match_status=?'; params.push(match_status); }
        if (client_id) { sql += ' AND r.client_id LIKE ?'; params.push(`%${client_id}%`); }
        sql += ' ORDER BY r.YYYY_MM DESC, r.bu_no, r.invoice_uid LIMIT 500';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ====== 匹配汇总 ======
router.get('/summary', async (req, res) => {
    try {
        const { YYYY_MM } = req.query;
        let sql = `SELECT match_status, COUNT(*) cnt,
                          SUM(invoice_amt) inv_total, SUM(receipt_amt) rcpt_total,
                          SUM(prior_payment) prior_total, SUM(unpaid_amt) unpaid_total
                   FROM ar_match_result WHERE 1=1`;
        const params = [];
        if (YYYY_MM) { sql += ' AND YYYY_MM=?'; params.push(YYYY_MM); }
        sql += ' GROUP BY match_status';
        const [rows] = await pool.execute(sql, params);

        const [[overall]] = await pool.execute(`
            SELECT COUNT(*) total,
                   SUM(CASE WHEN match_status='PAID_FULL' THEN 1 ELSE 0 END) paid_full,
                   SUM(invoice_amt) inv_amt, SUM(receipt_amt) rcpt_amt
            FROM ar_match_result ${YYYY_MM ? 'WHERE YYYY_MM=?' : ''}`, params);
        ok(res, { by_status: rows, overall });
    } catch (err) { fail500(res, err); }
});

// ====== 手动确认状态 ======
router.post('/results/:id/confirm', async (req, res) => {
    try {
        const u = req.user;
        const { match_status } = req.body;
        if (!match_status) return fail(res, '需要 match_status', 400);
        await pool.execute(
            'UPDATE ar_match_result SET match_status=?, matched_by=?, matched_time=NOW() WHERE id=?',
            [match_status, u.user_id, req.params.id]
        );
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

// ====== 核销（回写 mgm_invoice_details.payment）======
router.post('/results/:id/settle', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const u = req.user;
        const [rows] = await conn.execute('SELECT * FROM ar_match_result WHERE id=?', [req.params.id]);
        if (!rows.length) return fail(res, '不存在', 404);
        const r = rows[0];
        if (r.match_status !== 'PAID_FULL') return fail(res, '仅 PAID_FULL 可核销', 400);
        if (r.receipt_settled) return fail(res, '已核销', 400);
        if (!r.receipt_amt || r.receipt_amt <= 0) return fail(res, '无收款金额，无法核销（未登 receipt？）', 400);

        await conn.beginTransaction();

        // 1. 回写 mgm_invoice_details：payment += receipt_amt, pay_date = 今天
        const [inv] = await conn.execute(
            `UPDATE mgm_invoice_details SET payment = COALESCE(payment,0) + ?, pay_date = CURDATE(), update_time=NOW()
             WHERE uid=? AND TX_type='AR'`,
            [Number(r.receipt_amt), r.invoice_uid]
        );
        if (inv.affectedRows === 0) {
            await conn.rollback();
            return fail(res, '发票不存在或非 AR 类型', 400);
        }

        // 2. 标记核销完成
        await conn.execute(
            `UPDATE ar_match_result SET receipt_settled=1, receipt_settle_time=NOW(),
                 matched_by=?, matched_time=NOW()
             WHERE id=?`,
            [u.user_id, req.params.id]
        );

        await conn.commit();
        ok(res, null, `已回写发票已收金额 +${Number(r.receipt_amt)}`);
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally { conn.release(); }
});

module.exports = router;
