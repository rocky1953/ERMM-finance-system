/**
 * 付款明細路由 pay_detail
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, n } = require('../utils/response');

router.get('/', async (req, res) => {
    try {
        const { bu_no, supplier_name, pay_date, status, YYYY_MM } = req.query;
        let sql = `SELECT uid, bu_no,
            supplier_name AS payee, amount AS amt, currency_ab AS currency,
            finance_type AS pay_method,
            pay_date, should_date, invoice_date, expense_content, remark, data_year,
            CASE WHEN pay_date IS NOT NULL THEN 'paid' ELSE 'unpaid' END AS status1,
            DATE_FORMAT(should_date,'%Y/%m') AS YYYY_MM,
            create_time, update_time
            FROM pay_detail WHERE 1=1`;
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (supplier_name) { sql += ' AND supplier_name LIKE ?'; params.push(`%${supplier_name}%`); }
        if (status === 'paid') { sql += ' AND pay_date IS NOT NULL'; }
        if (status === 'unpaid') { sql += ' AND pay_date IS NULL'; }
        // 關鍵：pay_detail 沒有 YYYY_MM 欄位，用 should_date 推導
        if (YYYY_MM) { sql += ' AND DATE_FORMAT(should_date,\'%Y/%m\')=?'; params.push(YYYY_MM); }
        sql += ' ORDER BY should_date DESC LIMIT 500';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.post('/', async (req, res) => {
    try {
        const d = req.body;
        const [result] = await pool.execute(
            `INSERT INTO pay_detail (bu_no, supplier_name, finance_type, should_date, invoice_date,
               amount, currency_ab, invoice_num, pay_date, expense_content, remark, entry_date, data_year)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [n(d.bu_no), n(d.supplier_name), n(d.finance_type), n(d.should_date), n(d.invoice_date),
             n(d.amount), n(d.currency_ab), n(d.invoice_num), n(d.pay_date), n(d.expense_content),
             n(d.remark), n(d.entry_date || new Date().toISOString().slice(0, 10)), n(d.data_year)]
        );
        ok(res, { uid: result.insertId }, '付款明細已新增');
    } catch (err) { fail500(res, err); }
});

router.put('/:uid', async (req, res) => {
    try {
        const d = req.body;
        await pool.execute(
            `UPDATE pay_detail SET supplier_name=?, finance_type=?, should_date=?, invoice_date=?,
               amount=?, currency_ab=?, invoice_num=?, pay_date=?, expense_content=?, remark=? WHERE uid=?`,
            [n(d.supplier_name), n(d.finance_type), n(d.should_date), n(d.invoice_date), n(d.amount), n(d.currency_ab),
             n(d.invoice_num), n(d.pay_date), n(d.expense_content), n(d.remark), n(req.params.uid)]
        );
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

router.delete('/:uid', async (req, res) => {
    try {
        await pool.execute('DELETE FROM pay_detail WHERE uid=?', [req.params.uid]);
        ok(res, null, '已刪除');
    } catch (err) { fail500(res, err); }
});

// 標記為已付款
router.post('/:uid/pay', async (req, res) => {
    try {
        const { pay_date } = req.body;
        await pool.execute(
            'UPDATE pay_detail SET pay_date=? WHERE uid=?',
            [n(pay_date || new Date().toISOString().slice(0, 10)), n(req.params.uid)]
        );
        ok(res, null, '已標記為付款');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
