/**
 * 分公司 branch_detail CRUD
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, n } = require('../utils/response');

router.get('/', async (req, res) => {
    try {
        const { bu_no, inuse_flag } = req.query;
        let sql = 'SELECT * FROM branch_detail WHERE 1=1';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (inuse_flag) { sql += ' AND inuse_flag=?'; params.push(inuse_flag); }
        sql += ' ORDER BY bu_no, branch_id';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.get('/:uid', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM branch_detail WHERE uid=?', [req.params.uid]);
        if (rows.length === 0) return fail(res, '記錄不存在', 404);
        ok(res, rows[0]);
    } catch (err) { fail500(res, err); }
});

router.post('/', async (req, res) => {
    try {
        const d = req.body;
        const [r] = await pool.execute(`
            INSERT INTO branch_detail (bu_no, branch_id, branch_name, branch_address, branch_phone, manager, inuse_flag)
            VALUES (?,?,?,?,?,?,?)
        `, [
            n(d.bu_no), n(d.branch_id), n(d.branch_name),
            n(d.branch_address), n(d.branch_phone), n(d.manager),
            d.inuse_flag || 'USE'
        ]);
        ok(res, { uid: r.insertId }, '已新增分公司');
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
        await pool.execute(`UPDATE branch_detail SET ${updates} WHERE uid=?`, values);
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

router.delete('/:uid', async (req, res) => {
    try {
        await pool.execute('DELETE FROM branch_detail WHERE uid=?', [req.params.uid]);
        ok(res, null, '已刪除');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
