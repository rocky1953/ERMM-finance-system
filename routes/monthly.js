/**
 * 月度項目 monthly_items CRUD（租金/水電/薪資/保險 等）
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, n } = require('../utils/response');

router.get('/', async (req, res) => {
    try {
        const { bu_no, YYYY_MM, item_type, DB_CR } = req.query;
        let sql = 'SELECT * FROM monthly_items WHERE 1=1';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (YYYY_MM) { sql += ' AND YYYY_MM=?'; params.push(YYYY_MM); }
        if (item_type) { sql += ' AND item_type=?'; params.push(item_type); }
        if (DB_CR) { sql += ' AND DB_CR=?'; params.push(DB_CR); }
        sql += ' ORDER BY bu_no, YYYY_MM, item_type, pay_date';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.get('/:uid', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM monthly_items WHERE uid=?', [req.params.uid]);
        if (rows.length === 0) return fail(res, '記錄不存在', 404);
        ok(res, rows[0]);
    } catch (err) { fail500(res, err); }
});

router.post('/', async (req, res) => {
    try {
        const d = req.body;
        const [r] = await pool.execute(`
            INSERT INTO monthly_items (bu_no, YYYY_MM, item_type, item_name, item_amt, pay_date, DB_CR, remark)
            VALUES (?,?,?,?,?,?,?,?)
        `, [
            n(d.bu_no), n(d.YYYY_MM), n(d.item_type), n(d.item_name),
            Number(d.item_amt || 0), d.pay_date || null, n(d.DB_CR), n(d.remark)
        ]);
        ok(res, { uid: r.insertId }, '已新增月度項目');
    } catch (err) { fail500(res, err); }
});

router.put('/:uid', async (req, res) => {
    try {
        const d = req.body;
        const updates = Object.keys(d).filter(k => k !== 'uid' && k !== 'create_time' && k !== 'update_time')
            .map(k => `${k}=?`).join(',');
        const values = Object.keys(d).filter(k => k !== 'uid' && k !== 'create_time' && k !== 'update_time')
            .map(k => d[k]);
        values.push(req.params.uid);
        await pool.execute(`UPDATE monthly_items SET ${updates} WHERE uid=?`, values);
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

router.delete('/:uid', async (req, res) => {
    try {
        await pool.execute('DELETE FROM monthly_items WHERE uid=?', [req.params.uid]);
        ok(res, null, '已刪除');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
