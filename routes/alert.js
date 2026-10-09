/**
 * 預警通知路由
 * 通知紀錄列表 / 已讀 / 預警規則 CRUD
 * M3：日報域告警規則查詢/修改、手動掃描（/daily-rules、/daily-scan/run）
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const { scanBu } = require('../services/drAlertScanner');

// ============ M3 身份解析（與 routes/dailyReport.js 同口徑） ============
const MANAGER_TYPES = ['部門主管', '高階主管', '部門經理', '部门主管', '部门经理', '高阶主管', '高价主管'];
const ADMIN_MANAGER_VALUES = ['管理員', '管理员'];
function isManagerRole(admin, xuserType) {
    const norm = (s) => String(s || '')
        .replace(/部门/g, '部門').replace(/经理/g, '經理').replace(/高阶/g, '高階')
        .replace(/管理员/g, '管理員').replace(/高价/g, '高階');
    return ADMIN_MANAGER_VALUES.includes(norm(admin)) || MANAGER_TYPES.includes(norm(xuserType));
}
async function resolveActor(req) {
    let uid = req.user && req.user.user_id;
    if (!uid && process.env.NODE_ENV === 'test') uid = req.headers['x-test-user'] || null;
    if (!uid) return { error: 'NO_USER' };
    const [rows] = await pool.execute(
        `SELECT xuser_id, xuser_name, xuser_dept, xuser_type, admin, inuse_flag
           FROM cams_xuser WHERE xuser_id=? LIMIT 1`, [uid]);
    if (rows.length === 0) {
        if (process.env.NODE_ENV === 'test') {
            return { user_id: uid, user_name: uid, xuser_type: '部門主管', admin: '管理員', isManager: true, isSenior: true };
        }
        return { error: 'NOT_FOUND' };
    }
    const u = rows[0];
    return {
        user_id: u.xuser_id, user_name: u.xuser_name || u.xuser_id,
        xuser_dept: u.xuser_dept || null, xuser_type: u.xuser_type || '一般員工',
        admin: u.admin || '普通者',
        isManager: isManagerRole(u.admin, u.xuser_type),
        isSenior: (() => {
            const na = String(u.admin || '').replace(/管理员/g, '管理員');
            const nt = String(u.xuser_type || '').replace(/高阶/g, '高階');
            return na === '管理員' || nt === '高階主管';
        })()
    };
}

// rule_config（mysql2 多自動 parse JSON，容錯）
function parseCfg(v) {
    if (v == null) return {};
    if (typeof v === 'object') return v;
    try { return JSON.parse(v) || {}; } catch { return {}; }
}

// 通知列表（M3：支援 domain 過濾 FINANCE/DAILY_REPORT）
router.get('/logs', async (req, res) => {
    try {
        const { bu_no, limit = 50, domain } = req.query;
        let sql = 'SELECT * FROM alert_log WHERE 1=1';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (domain) { sql += ' AND alert_domain=?'; params.push(domain); }
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

// ============ M3-A 日報域告警規則 ============
// 規則清單（僅主管）
router.get('/daily-rules', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        if (!actor.isManager) return fail(res, '權限不足，僅主管可查看日報告警規則', 403);
        const [rows] = await pool.execute(
            `SELECT uid, rule_name, bu_no, kpi_id, cond, threshold, notify_channel,
                    notify_user, cooldown_hours, status, alert_domain, scope_type, rule_config
               FROM alert_rule
              WHERE alert_domain='DAILY_REPORT'
              ORDER BY uid`);
        ok(res, rows.map(r => ({ ...r, rule_config: parseCfg(r.rule_config) })));
    } catch (err) { fail500(res, err); }
});

// 修改規則（僅主管；kpi_id/cond/domain 不可改，同交易留審計）
router.put('/daily-rules/:uid', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        if (!actor.isManager) return fail(res, '權限不足，僅主管可修改日報告警規則', 403);

        // 不可變欄位明示拒絕
        if (req.body && ('kpi_id' in req.body || 'cond' in req.body || 'alert_domain' in req.body)) {
            return fail(res, 'kpi_id / cond / alert_domain 為不可變欄位', 400);
        }

        const [exist] = await conn.execute(
            `SELECT * FROM alert_rule WHERE uid=? AND alert_domain='DAILY_REPORT' LIMIT 1`,
            [req.params.uid]);
        if (exist.length === 0) return fail(res, '日報告警規則不存在', 404);
        const old = exist[0];

        const b = req.body || {};
        const fields = [];
        const values = [];
        const set = (k, v) => { if (v !== undefined) { fields.push(`${k}=?`); values.push(v); } };
        set('threshold', b.threshold);
        set('cooldown_hours', b.cooldown_hours);
        set('status', b.status);
        set('notify_channel', b.notify_channel);
        if (b.rule_config !== undefined) {
            if (typeof b.rule_config !== 'object' || b.rule_config === null) {
                return fail(res, 'rule_config 必須為物件', 400);
            }
            set('rule_config', JSON.stringify(b.rule_config));
        }
        if (fields.length === 0) return fail(res, '無更新欄位', 400);

        await conn.beginTransaction();
        values.push(req.params.uid);
        await conn.execute(`UPDATE alert_rule SET ${fields.join(',')} WHERE uid=?`, values);

        const newData = {
            threshold: b.threshold !== undefined ? Number(b.threshold) : Number(old.threshold),
            cooldown_hours: b.cooldown_hours !== undefined ? Number(b.cooldown_hours) : old.cooldown_hours,
            status: b.status !== undefined ? Number(b.status) : old.status,
            notify_channel: b.notify_channel !== undefined ? b.notify_channel : old.notify_channel,
            rule_config: b.rule_config !== undefined ? b.rule_config : parseCfg(old.rule_config)
        };
        await conn.execute(
            `INSERT INTO daily_report_audit_log
                (bu_no, target_user_id, target_user_name, action,
                 operator_id, operator_name, operator_ip, old_data, new_data, remark)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [old.bu_no || 'SYS', `RULE:${old.uid}`, old.rule_name, 'ALERT_RULE_UPD',
             actor.user_id, actor.user_name,
             (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim().slice(0, 63),
             JSON.stringify({
                 threshold: Number(old.threshold), cooldown_hours: old.cooldown_hours,
                 status: old.status, notify_channel: old.notify_channel, rule_config: parseCfg(old.rule_config)
             }),
             JSON.stringify(newData), 'M3 日報告警規則修改']);
        await conn.commit();
        ok(res, { msg: '已更新', uid: Number(req.params.uid) });
    } catch (err) {
        try { await conn.rollback(); } catch { /* 忽略 */ }
        fail500(res, err);
    } finally {
        conn.release();
    }
});

// 手動觸發掃描（僅主管；測試環境可注入 as_of）
router.post('/daily-scan/run', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        if (!actor.isManager) return fail(res, '權限不足，僅主管可觸發掃描', 403);

        const bu = (req.body && String(req.body.bu_no || '').trim()) || 'HM';
        let asOf = new Date();
        if (req.body && req.body.as_of && process.env.NODE_ENV === 'test') {
            const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(req.body.as_of).trim());
            if (!m) return fail(res, 'as_of 格式須為 YYYY-MM-DD HH:mm', 400);
            asOf = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
                            Number(m[4]), Number(m[5]), m[6] ? Number(m[6]) : 0, 0);
        }
        const result = await scanBu(bu, { asOf });
        ok(res, result);
    } catch (err) { fail500(res, err); }
});

module.exports = router;
