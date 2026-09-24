/**
 * 行動追蹤路由
 * 任務 CRUD + 狀態統計
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');

// 列表
router.get('/', async (req, res) => {
    try {
        const { bu_no, status } = req.query;
        let sql = 'SELECT * FROM action_task WHERE 1=1';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (status) { sql += ' AND status=?'; params.push(status); }
        sql += ' ORDER BY FIELD(status, "pending","doing","done"), priority DESC, due_date ASC';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// 單筆
router.get('/:uid', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM action_task WHERE uid=?', [req.params.uid]);
        if (rows.length === 0) return fail(res, '任務不存在');
        ok(res, rows[0]);
    } catch (err) { fail500(res, err); }
});

// 新增
router.post('/', async (req, res) => {
    try {
        const { bu_no, source_kpi, title, description, assignee, due_date, target_value, priority, created_by } = req.body;
        if (!bu_no || !title) return fail(res, '缺少必要欄位');
        const [r] = await pool.execute(
            `INSERT INTO action_task (bu_no, source_kpi, title, description, assignee, due_date, target_value, priority, created_by)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            [bu_no, source_kpi || null, title, description || null, assignee || null, due_date || null, target_value || null, priority || 'medium', created_by || null]
        );
        ok(res, { uid: r.insertId });
    } catch (err) { fail500(res, err); }
});

// 更新
router.put('/:uid', async (req, res) => {
    try {
        const { title, description, assignee, due_date, status, progress, priority } = req.body;
        const fields = [];
        const values = [];
        if (title !== undefined) { fields.push('title=?'); values.push(title); }
        if (description !== undefined) { fields.push('description=?'); values.push(description); }
        if (assignee !== undefined) { fields.push('assignee=?'); values.push(assignee); }
        if (due_date !== undefined) { fields.push('due_date=?'); values.push(due_date); }
        if (status !== undefined) { fields.push('status=?'); values.push(status); }
        if (progress !== undefined) { fields.push('progress=?'); values.push(progress); }
        if (priority !== undefined) { fields.push('priority=?'); values.push(priority); }
        if (fields.length === 0) return fail(res, '無更新欄位');
        values.push(req.params.uid);
        await pool.execute(`UPDATE action_task SET ${fields.join(',')} WHERE uid=?`, values);
        ok(res, { msg: '已更新' });
    } catch (err) { fail500(res, err); }
});

// 刪除
router.delete('/:uid', async (req, res) => {
    try {
        await pool.execute('DELETE FROM action_task WHERE uid=?', [req.params.uid]);
        ok(res, { msg: '已刪除' });
    } catch (err) { fail500(res, err); }
});

// 統計
router.get('/stats/count', async (req, res) => {
    try {
        const { bu_no } = req.query;
        let sql = `SELECT status, COUNT(*) AS cnt FROM action_task WHERE 1=1`;
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        sql += ' GROUP BY status';
        const [rows] = await pool.execute(sql, params);
        const result = { pending: 0, doing: 0, done: 0 };
        rows.forEach(r => { result[r.status] = r.cnt; });
        ok(res, result);
    } catch (err) { fail500(res, err); }
});

module.exports = router;
