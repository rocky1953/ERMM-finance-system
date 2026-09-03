/**
 * KPI 門檻定義 mgm_kpi_desc CRUD
 * 風險指標頁面讀這張表來顯示門檻 / 判定顏色
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, n } = require('../utils/response');

router.get('/', async (req, res) => {
    try {
        const { bu_no, pct_type, KPI_id } = req.query;
        let sql = 'SELECT * FROM mgm_kpi_desc WHERE 1=1';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (pct_type) { sql += ' AND pct_type=?'; params.push(pct_type); }
        if (KPI_id) { sql += ' AND KPI_id=?'; params.push(KPI_id); }
        sql += ' ORDER BY bu_no, KPI_id';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.get('/:uid', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM mgm_kpi_desc WHERE uid=?', [req.params.uid]);
        if (rows.length === 0) return fail(res, '記錄不存在', 404);
        ok(res, rows[0]);
    } catch (err) { fail500(res, err); }
});

router.post('/', async (req, res) => {
    try {
        const d = req.body;
        const [r] = await pool.execute(`
            INSERT INTO mgm_kpi_desc (bu_no, KPI_id, KPI_name, KPI1, KPI2, unit, pct_type, KPI_value, KPI_color, remark)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        `, [
            n(d.bu_no), n(d.KPI_id), n(d.KPI_name),
            Number(d.KPI1 || 0), Number(d.KPI2 || 0),
            n(d.unit), n(d.pct_type),
            Number(d.KPI_value || 0), n(d.KPI_color), n(d.remark)
        ]);
        ok(res, { uid: r.insertId }, '已新增 KPI 門檻');
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
        await pool.execute(`UPDATE mgm_kpi_desc SET ${updates} WHERE uid=?`, values);
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

router.delete('/:uid', async (req, res) => {
    try {
        await pool.execute('DELETE FROM mgm_kpi_desc WHERE uid=?', [req.params.uid]);
        ok(res, null, '已刪除');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
