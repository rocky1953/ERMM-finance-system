/**
 * 系統管理路由 - 碼表/公司別/匯率/KPI
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, pagination } = require('../utils/response');

// ===== 碼表 CRUD =====
router.get('/codes', async (req, res) => {
    try {
        const { code_type, code_value } = req.query;
        let sql = 'SELECT * FROM cams_system_codes WHERE 1=1';
        const params = [];
        if (code_type) { sql += ' AND code_type=?'; params.push(code_type); }
        if (code_value) { sql += ' AND code_value LIKE ?'; params.push(`%${code_value}%`); }
        sql += ' ORDER BY code_type, sort_order, code_value';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.get('/codes/:id', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM cams_system_codes WHERE id=?', [req.params.id]);
        if (rows.length === 0) return fail(res, '記錄不存在', 404);
        ok(res, rows[0]);
    } catch (err) { fail500(res, err); }
});

router.post('/codes', async (req, res) => {
    try {
        const d = req.body;
        await pool.execute(
            `INSERT INTO cams_system_codes (code_type, code_value, value_description, value_number1, value_number2, value_number3, sort_order, inuse_flag)
             VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE value_description=VALUES(value_description),
             value_number1=VALUES(value_number1), value_number2=VALUES(value_number2), value_number3=VALUES(value_number3)`,
            [d.code_type, d.code_value, d.value_description,
             Number(d.value_number1||0), Number(d.value_number2||0), Number(d.value_number3||0),
             Number(d.sort_order||0), d.inuse_flag||'USE']
        );
        ok(res, null, '碼表已保存');
    } catch (err) { fail500(res, err); }
});

router.put('/codes/:id', async (req, res) => {
    try {
        const d = req.body;
        const fields = ['code_type','code_value','value_description','value_number1','value_number2','value_number3','sort_order','inuse_flag'];
        const updates = fields.filter(k => d[k] !== undefined).map(k => `${k}=?`).join(',');
        const values = fields.filter(k => d[k] !== undefined).map(k => k.startsWith('value_number') || k === 'sort_order' ? Number(d[k]||0) : d[k]);
        values.push(req.params.id);
        await pool.execute(`UPDATE cams_system_codes SET ${updates} WHERE id=?`, values);
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

router.delete('/codes/:id', async (req, res) => {
    try {
        await pool.execute('DELETE FROM cams_system_codes WHERE id=?', [req.params.id]);
        ok(res, null, '已刪除');
    } catch (err) { fail500(res, err); }
});

// ===== 公司別清單 =====
router.get('/bu', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            "SELECT code_value AS bu_no, value_description AS bu_name, value_number3 AS VAT_rate FROM cams_system_codes WHERE code_type='BUSINESS_ID' AND inuse_flag='USE' ORDER BY code_value"
        );
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ===== 匯率清單 =====
router.get('/currency', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            "SELECT code_value AS currency, value_description AS name, value_number1 AS exchange_rate FROM cams_system_codes WHERE code_type='CURRENCY' AND inuse_flag='USE'"
        );
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ===== KPI 門檻 =====
router.get('/kpi', async (req, res) => {
    try {
        const { bu_no } = req.query;
        const [rows] = await pool.execute(
            'SELECT * FROM MGM_KPI_desc WHERE bu_no=? ORDER BY KPI_id',
            [bu_no || 'HM']
        );
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.post('/kpi', async (req, res) => {
    try {
        const data = req.body;
        await pool.execute(
            `INSERT INTO MGM_KPI_desc (bu_no, KPI_id, KPI_name, KPI1, KPI2, unit, pct_type)
             VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE KPI_name=VALUES(KPI_name), KPI1=VALUES(KPI1), KPI2=VALUES(KPI2)`,
            [data.bu_no, data.KPI_id, data.KPI_name, data.KPI1, data.KPI2, data.unit, data.pct_type]
        );
        ok(res, null, 'KPI 已保存');
    } catch (err) { fail500(res, err); }
});

// ===== 批次控制 =====
router.get('/batch_control', async (req, res) => {
    try {
        const { batch_id } = req.query;
        const sql = batch_id
            ? 'SELECT * FROM cams_batch_control WHERE batch_id=? ORDER BY seq_SQL'
            : 'SELECT * FROM cams_batch_control ORDER BY id DESC LIMIT 100';
        const params = batch_id ? [batch_id] : [];
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ===== 使用者 =====
router.post('/login', async (req, res) => {
    try {
        const { user_id, password } = req.body;
        if (!user_id || !password) return fail(res, '請提供 user_id 和 password');
        const [users] = await pool.execute(
            'SELECT * FROM cams_xuser WHERE xuser_id=? AND xuser_password=? AND inuse_flag="USE"',
            [user_id, password]
        );
        if (users.length === 0) return fail(res, '帳號或密碼錯誤', 401);

        const [perms] = await pool.execute('SELECT * FROM leader_user WHERE user_id=?', [user_id]);
        const user = users[0];

        // 寫入登入記錄
        await pool.execute(
            'INSERT INTO login_user_record (user_id, bu_no, login_time) VALUES (?,?,NOW())',
            [user_id, 'HM']
        );

        ok(res, { user, permissions: perms[0] || {} }, '登入成功');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
