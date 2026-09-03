/**
 * 票據/支票管理路由
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, n } = require('../utils/response');

router.get('/', async (req, res) => {
    try {
        const { bu_no, check_type, status } = req.query;
        let sql = 'SELECT * FROM check_detail WHERE 1=1';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (check_type) { sql += ' AND check_type=?'; params.push(check_type); }
        if (status) { sql += ' AND status=?'; params.push(status); }
        sql += ' ORDER BY check_date DESC LIMIT 500';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.post('/', async (req, res) => {
    try {
        const d = req.body;
        const [result] = await pool.execute(
            `INSERT INTO check_detail (bu_no, check_type, check_num, company_id, check_date,
               due_date, amount, to_company, bank_acct, status, remark)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [n(d.bu_no), n(d.check_type), n(d.check_num), n(d.company_id), n(d.check_date),
             n(d.due_date), n(d.amount), n(d.to_company), n(d.bank_acct), n(d.status || '未兌現'), n(d.remark)]
        );
        ok(res, { uid: result.insertId }, '票據已新增');
    } catch (err) { fail500(res, err); }
});

router.put('/:uid', async (req, res) => {
    try {
        const d = req.body;
        await pool.execute(
            `UPDATE check_detail SET check_type=?, check_num=?, company_id=?, check_date=?,
               due_date=?, amount=?, to_company=?, bank_acct=?, status=?, remark=? WHERE uid=?`,
            [n(d.check_type), n(d.check_num), n(d.company_id), n(d.check_date), n(d.due_date),
             n(d.amount), n(d.to_company), n(d.bank_acct), n(d.status), n(d.remark), n(req.params.uid)]
        );
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

router.delete('/:uid', async (req, res) => {
    try {
        await pool.execute('DELETE FROM check_detail WHERE uid=?', [req.params.uid]);
        ok(res, null, '已刪除');
    } catch (err) { fail500(res, err); }
});

// 兌現
router.post('/:uid/clear', async (req, res) => {
    try {
        await pool.execute(
            "UPDATE check_detail SET status='已兌現' WHERE uid=?", [req.params.uid]
        );
        ok(res, null, '已兌現');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
