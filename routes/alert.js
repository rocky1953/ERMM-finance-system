/**
 * 預警通知路由
 * 通知紀錄列表 / 已讀 / 預警規則 CRUD
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');

// 通知列表
router.get('/logs', async (req, res) => {
    try {
        const { bu_no, limit = 50 } = req.query;
        let sql = 'SELECT * FROM alert_log WHERE 1=1';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        sql += ' ORDER BY is_read ASC, created_at DESC LIMIT ?';
        params.push(Number(limit));
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// 單筆已讀
router.put('/logs/:uid/read', async (req, res) => {
    try {
        await pool.execute('UPDATE alert_log SET is_read=1 WHERE uid=?', [req.params.uid]);
        ok(res, { msg: '已標記已讀' });
    } catch (err) { fail500(res, err); }
});

// 全部已讀
router.put('/logs/read-all', async (req, res) => {
    try {
        const { bu_no } = req.body;
        let sql = 'UPDATE alert_log SET is_read=1 WHERE is_read=0';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        await pool.execute(sql, params);
        ok(res, { msg: '全部已標記已讀' });
    } catch (err) { fail500(res, err); }
});

// 未讀數量
router.get('/logs/unread-count', async (req, res) => {
    try {
        const { bu_no } = req.query;
        let sql = 'SELECT COUNT(*) AS cnt FROM alert_log WHERE is_read=0';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        const [rows] = await pool.execute(sql, params);
        ok(res, { count: rows[0].cnt });
    } catch (err) { fail500(res, err); }
});

// 規則列表
router.get('/rules', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM alert_rule ORDER BY uid');
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// 新增規則
router.post('/rules', async (req, res) => {
    try {
        const { rule_name, bu_no, kpi_id, cond, threshold, notify_channel, notify_user, cooldown_hours, status } = req.body;
        if (!rule_name || !kpi_id || threshold === undefined) return fail(res, '缺少必要欄位');
        const [r] = await pool.execute(
            `INSERT INTO alert_rule (rule_name, bu_no, kpi_id, cond, threshold, notify_channel, notify_user, cooldown_hours, status)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            [rule_name, bu_no || null, kpi_id, cond || 'lt', threshold, notify_channel || 'email', notify_user || null, cooldown_hours || 24, status ?? 1]
        );
        ok(res, { uid: r.insertId });
    } catch (err) { fail500(res, err); }
});

// 更新規則
router.put('/rules/:uid', async (req, res) => {
    try {
        const { rule_name, bu_no, kpi_id, cond, threshold, notify_channel, notify_user, cooldown_hours, status } = req.body;
        const fields = [];
        const values = [];
        const set = (k, v) => { if (v !== undefined) { fields.push(`${k}=?`); values.push(v); } };
        set('rule_name', rule_name); set('bu_no', bu_no); set('kpi_id', kpi_id); set('cond', cond);
        set('threshold', threshold); set('notify_channel', notify_channel); set('notify_user', notify_user);
        set('cooldown_hours', cooldown_hours); set('status', status);
        if (fields.length === 0) return fail(res, '無更新欄位');
        values.push(req.params.uid);
        await pool.execute(`UPDATE alert_rule SET ${fields.join(',')} WHERE uid=?`, values);
        ok(res, { msg: '已更新' });
    } catch (err) { fail500(res, err); }
});

// 刪除規則
router.delete('/rules/:uid', async (req, res) => {
    try {
        await pool.execute('DELETE FROM alert_rule WHERE uid=?', [req.params.uid]);
        ok(res, { msg: '已刪除' });
    } catch (err) { fail500(res, err); }
});

module.exports = router;
