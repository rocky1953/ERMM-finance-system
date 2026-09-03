/**
 * SO 交貨單 ermm_erp_so_dn CRUD
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, n } = require('../utils/response');

router.get('/', async (req, res) => {
    try {
        const { bu_no, so_nbr } = req.query;
        let sql = 'SELECT * FROM ermm_erp_so_dn WHERE 1=1';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (so_nbr) { sql += ' AND so_nbr=?'; params.push(so_nbr); }
        sql += ' ORDER BY bu_no, DN_date DESC, so_nbr';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.get('/:uid', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM ermm_erp_so_dn WHERE uid=?', [req.params.uid]);
        if (rows.length === 0) return fail(res, '記錄不存在', 404);
        ok(res, rows[0]);
    } catch (err) { fail500(res, err); }
});

router.post('/', async (req, res) => {
    try {
        const d = req.body;
        const [r] = await pool.execute(`
            INSERT INTO ermm_erp_so_dn (bu_no, so_nbr, xitems, client_name, DN_date, DN_qty, so_qty)
            VALUES (?,?,?,?,?,?,?)
        `, [
            n(d.bu_no), n(d.so_nbr), n(d.xitems), n(d.client_name),
            d.DN_date || null, Number(d.DN_qty || 0), Number(d.so_qty || 0)
        ]);
        ok(res, { uid: r.insertId }, '已新增交貨單');
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
        await pool.execute(`UPDATE ermm_erp_so_dn SET ${updates} WHERE uid=?`, values);
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

router.delete('/:uid', async (req, res) => {
    try {
        await pool.execute('DELETE FROM ermm_erp_so_dn WHERE uid=?', [req.params.uid]);
        ok(res, null, '已刪除');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
