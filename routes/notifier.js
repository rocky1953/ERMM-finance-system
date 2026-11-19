/**
 * CTO-07 通知路由
 * 渠道配置 / 訂閱管理 / 測試發送 / 手動觸發
 */
const express = require('express');
const router = express.Router();
const { ok, fail, fail500 } = require('../utils/response');
const notifier = require('../services/notifier');
const audit = require('../services/audit');
const { pool } = require('../config/db');

// ===== 渠道配置 =====

router.get('/channels', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT id, channel_code, channel_name, channel_type, scope_bus, inuse_flag, last_test_at, last_test_ok FROM cams_notif_channel ORDER BY id');
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.get('/channels/:code', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM cams_notif_channel WHERE channel_code=?', [req.params.code]);
        if (!rows[0]) return fail(res, '渠道不存在', 404);
        const r = rows[0];
        try { r.config = typeof r.config === 'string' ? JSON.parse(r.config) : r.config; } catch {}
        ok(res, r);
    } catch (err) { fail500(res, err); }
});

router.put('/channels/:code', async (req, res) => {
    try {
        const [old] = await pool.execute('SELECT * FROM cams_notif_channel WHERE channel_code=?', [req.params.code]);
        if (!old[0]) return fail(res, '渠道不存在', 404);
        const { channel_name, config, scope_bus, inuse_flag } = req.body;
        const fields = [];
        const values = [];
        if (channel_name !== undefined) { fields.push('channel_name=?'); values.push(channel_name); }
        if (config !== undefined) { fields.push('config=?'); values.push(JSON.stringify(config)); }
        if (scope_bus !== undefined) { fields.push('scope_bus=?'); values.push(JSON.stringify(scope_bus)); }
        if (inuse_flag !== undefined) { fields.push('inuse_flag=?'); values.push(inuse_flag ? 1 : 0); }
        if (fields.length === 0) return fail(res, '無更新字段');
        values.push(req.params.code);
        await pool.execute(`UPDATE cams_notif_channel SET ${fields.join(',')}, update_time=NOW() WHERE channel_code=?`, values);
        audit.log(req, { module: 'notifier', action: 'UPDATE',
            businessType: 'NOTIF-CHANNEL', businessId: req.params.code,
            summary: `更新通知渠道 ${req.params.code}`,
            before: { config: old[0].config ? '[隱藏]' : null },
            after: { config: config ? '[隱藏]' : null } });
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

// ===== 測試渠道 =====
router.post('/channels/:code/test', async (req, res) => {
    try {
        const r = await notifier.testChannel(req.params.code);
        ok(res, r);
    } catch (err) { fail500(res, err); }
});

// ===== 訂閱規則 =====
router.get('/subscriptions', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT s.*, c.channel_name
             FROM cams_notif_subscription s
             LEFT JOIN cams_notif_channel c ON c.channel_code=s.channel_code
             ORDER BY s.priority, s.id`);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.post('/subscriptions', async (req, res) => {
    try {
        const b = req.body;
        if (!b.event_type || !b.channel_code) return fail(res, '缺少 event_type / channel_code');
        const [r] = await pool.execute(
            `INSERT INTO cams_notif_subscription
                (event_type, event_cat, bu_no, role_filter, user_filter, channel_code, priority, inuse_flag)
             VALUES (?,?,?,?,?,?,?,?)`,
            [b.event_type, b.event_cat || '*', b.bu_no || '*', b.role_filter || '*',
             b.user_filter ? JSON.stringify(b.user_filter) : null,
             b.channel_code, b.priority ?? 50, b.inuse_flag ?? 1]);
        audit.log(req, { module: 'notifier', action: 'CREATE',
            businessType: 'NOTIF-SUB', businessId: String(r.insertId),
            summary: `新增訂閱 ${b.event_type}/${b.event_cat || '*'} → ${b.channel_code}` });
        ok(res, { id: r.insertId });
    } catch (err) { fail500(res, err); }
});

router.put('/subscriptions/:id', async (req, res) => {
    try {
        const fields = [];
        const values = [];
        const b = req.body;
        const set = (k, v) => { if (v !== undefined) { fields.push(`${k}=?`); values.push(v); } };
        set('event_type', b.event_type); set('event_cat', b.event_cat); set('bu_no', b.bu_no);
        set('role_filter', b.role_filter); set('channel_code', b.channel_code);
        set('priority', b.priority); set('inuse_flag', b.inuse_flag);
        if (b.user_filter !== undefined) { set('user_filter', JSON.stringify(b.user_filter)); }
        if (fields.length === 0) return fail(res, '無更新字段');
        values.push(req.params.id);
        await pool.execute(`UPDATE cams_notif_subscription SET ${fields.join(',')}, update_time=NOW() WHERE id=?`, values);
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

router.delete('/subscriptions/:id', async (req, res) => {
    try {
        await pool.execute('DELETE FROM cams_notif_subscription WHERE id=?', [req.params.id]);
        ok(res, null, '已刪除');
    } catch (err) { fail500(res, err); }
});

// ===== 手動觸發測試通知 =====
router.post('/send-test', async (req, res) => {
    try {
        const { event_type = 'CUSTOM', event_cat = 'TEST', title, body, level = 'MEDIUM', bu_no } = req.body;
        const r = await notifier.send({ event_type, event_cat,
            title: title || '[ERMM CTO-07] 手動測試通知',
            body: body || `發送時間：${new Date().toISOString()}\n來源：管理員手動觸發`,
            level, bu_no, storeLog: true });
        ok(res, r);
    } catch (err) { fail500(res, err); }
});

// ===== 查隊列發送狀態 =====
router.get('/queue', async (req, res) => {
    try {
        const { status, limit = 50 } = req.query;
        let sql = 'SELECT * FROM alert_log WHERE 1=1';
        const params = [];
        if (status) { sql += ' AND notify_status=?'; params.push(status); }
        sql += ' ORDER BY created_at DESC LIMIT ?';
        params.push(Number(limit));
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ===== 重發 FAILED 的通知 =====
router.post('/queue/:uid/retry', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM alert_log WHERE uid=? AND notify_status="FAILED"', [req.params.uid]);
        if (!rows[0]) return fail(res, '該記錄不可重發', 400);
        const r = await notifier.send({
            event_type: rows[0].alert_domain || 'ALERT',
            title: rows[0].title, body: rows[0].message,
            level: rows[0].level, bu_no: rows[0].bu_no, storeLog: false
        });
        ok(res, r);
    } catch (err) { fail500(res, err); }
});

module.exports = router;
