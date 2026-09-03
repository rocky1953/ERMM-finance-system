/**
 * 使用者帳號 cams_xuser + 權限 leader_user + 登入紀錄 login_user_record
 * 三張表放在同一個 /api/user route（系統後台用）
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, n } = require('../utils/response');
const crypto = require('crypto');

function hashPwd(pwd) { return crypto.createHash('sha256').update(String(pwd)).digest('hex'); }

// ===== cams_xuser =====
router.get('/', async (req, res) => {
    try {
        const { inuse_flag } = req.query;
        let sql = 'SELECT id, xuser_id, xuser_name, xuser_dept, client_id, inuse_flag, create_time FROM cams_xuser WHERE 1=1';
        const params = [];
        if (inuse_flag) { sql += ' AND inuse_flag=?'; params.push(inuse_flag); }
        sql += ' ORDER BY xuser_id';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.get('/permissions', async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT u.xuser_id, u.xuser_name, u.xuser_dept, u.inuse_flag,
                   l.procurement, l.sales, l.finance, l.stock, l.class, l.login
              FROM cams_xuser u LEFT JOIN leader_user l ON u.xuser_id = l.user_id
             ORDER BY u.xuser_id
        `);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.post('/', async (req, res) => {
    try {
        const d = req.body;
        if (!d.xuser_id || !d.xuser_password) return fail(res, '帳號與密碼必填', 400);
        const hashed = hashPwd(d.xuser_password);
        const [r] = await pool.execute(`
            INSERT INTO cams_xuser (xuser_id, xuser_password, xuser_name, xuser_dept, client_id, inuse_flag)
            VALUES (?,?,?,?,?,?)
        `, [d.xuser_id, hashed, n(d.xuser_name), n(d.xuser_dept), n(d.client_id), d.inuse_flag || 'USE']);
        ok(res, { id: r.insertId }, '已新增使用者');
    } catch (err) { fail500(res, err); }
});

router.put('/:id', async (req, res) => {
    try {
        const d = req.body;
        const fields = ['xuser_name', 'xuser_dept', 'client_id', 'inuse_flag'];
        const updates = fields.filter(k => d[k] !== undefined).map(k => `${k}=?`).join(',');
        const values = fields.filter(k => d[k] !== undefined).map(k => d[k]);
        if (d.xuser_password) {
            updates = (updates ? updates + ',' : '') + 'xuser_password=?';
            values.push(hashPwd(d.xuser_password));
        }
        if (!updates) return fail(res, '無更新欄位', 400);
        values.push(req.params.id);
        await pool.execute(`UPDATE cams_xuser SET ${updates} WHERE id=?`, values);
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

router.delete('/:id', async (req, res) => {
    try {
        await pool.execute('DELETE FROM cams_xuser WHERE id=?', [req.params.id]);
        await pool.execute('DELETE FROM leader_user WHERE user_id=(SELECT xuser_id FROM cams_xuser WHERE id=?)', [req.params.id]);
        ok(res, null, '已刪除');
    } catch (err) { fail500(res, err); }
});

// ===== leader_user 權限 =====
router.put('/:user_id/permissions', async (req, res) => {
    try {
        const d = req.body;
        const perms = ['procurement','sales','production','engineer','handbook','wk_plan',
                       'quality','document','price','stock','finance','imex','others','class','login'];
        const fields = perms.filter(k => d[k] !== undefined);
        if (fields.length === 0) return fail(res, '無權限欄位', 400);
        const updates = fields.map(k => `${k}=?`).join(',');
        const values = fields.map(k => d[k]);
        values.push(req.params.user_id);
        await pool.execute(`INSERT INTO leader_user (user_id, ${fields.join(',')}) VALUES (${req.params.user_id}, ${fields.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE ${updates}`, [req.params.user_id, ...values]);
        ok(res, null, '權限已更新');
    } catch (err) { fail500(res, err); }
});

// ===== login_user_record 登入紀錄（唯讀 + 清除） =====
router.get('/logins', async (req, res) => {
    try {
        const { user_id, from, to, limit } = req.query;
        let sql = 'SELECT * FROM login_user_record WHERE 1=1';
        const params = [];
        if (user_id) { sql += ' AND user_id=?'; params.push(user_id); }
        if (from) { sql += ' AND login_time >= ?'; params.push(from); }
        if (to) { sql += ' AND login_time <= ?'; params.push(to); }
        sql += ' ORDER BY login_time DESC LIMIT ' + (limit || 500);
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.delete('/logins/:id', async (req, res) => {
    try {
        await pool.execute('DELETE FROM login_user_record WHERE id=?', [req.params.id]);
        ok(res, null, '已清除');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
