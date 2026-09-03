/**
 * 批次控制 cams_batch_control CRUD
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, n } = require('../utils/response');

router.get('/', async (req, res) => {
    try {
        const { batch_id, process_status } = req.query;
        let sql = 'SELECT * FROM cams_batch_control WHERE 1=1';
        const params = [];
        if (batch_id) { sql += ' AND batch_id=?'; params.push(batch_id); }
        if (process_status) { sql += ' AND process_status=?'; params.push(process_status); }
        sql += ' ORDER BY batch_id, seq_SQL';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.get('/:id', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM cams_batch_control WHERE id=?', [req.params.id]);
        if (rows.length === 0) return fail(res, '記錄不存在', 404);
        ok(res, rows[0]);
    } catch (err) { fail500(res, err); }
});

router.post('/', async (req, res) => {
    try {
        const d = req.body;
        const [r] = await pool.execute(`
            INSERT INTO cams_batch_control (batch_id, step_name, seq_SQL, process_status, break_point, start_time, end_time, error_msg)
            VALUES (?,?,?,?,?,?,?,?)
        `, [
            n(d.batch_id), n(d.step_name), Number(d.seq_SQL || 0),
            d.process_status || '00', d.break_point || 'N',
            d.start_time || null, d.end_time || null, n(d.error_msg)
        ]);
        ok(res, { id: r.insertId }, '已新增批次步驟');
    } catch (err) { fail500(res, err); }
});

router.put('/:id', async (req, res) => {
    try {
        const d = req.body;
        const updates = Object.keys(d).filter(k => k !== 'id' && k !== 'create_time')
            .map(k => `${k}=?`).join(',');
        const values = Object.keys(d).filter(k => k !== 'id' && k !== 'create_time')
            .map(k => d[k]);
        values.push(req.params.id);
        await pool.execute(`UPDATE cams_batch_control SET ${updates} WHERE id=?`, values);
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

router.delete('/:id', async (req, res) => {
    try {
        await pool.execute('DELETE FROM cams_batch_control WHERE id=?', [req.params.id]);
        ok(res, null, '已刪除');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
