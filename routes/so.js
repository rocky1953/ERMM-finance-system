/**
 * 銷售訂單 ERMM_erp_SO CRUD
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, n } = require('../utils/response');

router.get('/', async (req, res) => {
    try {
        const { bu_no, YYYY_MM, status, limit } = req.query;
        let sql = 'SELECT * FROM ERMM_erp_SO WHERE 1=1';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (YYYY_MM) { sql += ' AND YYYY_MM=?'; params.push(YYYY_MM); }
        if (status) { sql += ' AND status=?'; params.push(status); }
        sql += ' ORDER BY so_date DESC, uid DESC LIMIT ' + (limit || 200);
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.get('/:uid', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM ERMM_erp_SO WHERE uid=?', [req.params.uid]);
        if (rows.length === 0) return fail(res, '記錄不存在', 404);
        ok(res, rows[0]);
    } catch (err) { fail500(res, err); }
});

router.post('/', async (req, res) => {
    try {
        const d = req.body;
        let YYYY = d.YYYY, MM = d.MM, YYYY_MM = d.YYYY_MM;
        if (!YYYY_MM && d.so_date) {
            const dt = new Date(d.so_date);
            YYYY_MM = `${dt.getFullYear()}/${String(dt.getMonth()+1).padStart(2,'0')}`;
            YYYY = String(dt.getFullYear());
            MM = String(dt.getMonth()+1).padStart(2,'0');
        }
        const [r] = await pool.execute(`
            INSERT INTO ERMM_erp_SO (bu_no, so_nbr, client_id, client_name, xitems, so_date,
                YYYY, MM, YYYY_MM, so_qty, dn_qty, unit_price, status, remark)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `, [
            n(d.bu_no), n(d.so_nbr), n(d.client_id), n(d.client_name), n(d.xitems),
            d.so_date || null,
            n(YYYY), n(MM), n(YYYY_MM),
            Number(d.so_qty || 0), Number(d.dn_qty || 0), Number(d.unit_price || 0),
            d.status || null, n(d.remark)
        ]);
        ok(res, { uid: r.insertId }, '已新增銷售訂單');
    } catch (err) { fail500(res, err); }
});

router.put('/:uid', async (req, res) => {
    try {
        const d = req.body;
        const updates = Object.keys(d).filter(k => k !== 'uid' && k !== 'create_time')
            .map(k => `${k}=?`).join(',');
        const values = Object.keys(d).filter(k => k !== 'uid' && k !== 'create_time')
            .map(k => d[k]);
        values.push(req.params.uid);
        await pool.execute(`UPDATE ERMM_erp_SO SET ${updates} WHERE uid=?`, values);
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

router.delete('/:uid', async (req, res) => {
    try {
        await pool.execute('DELETE FROM ERMM_erp_SO WHERE uid=?', [req.params.uid]);
        ok(res, null, '已刪除');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
