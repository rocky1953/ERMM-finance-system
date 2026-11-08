/**
 * 銷售預估訂單 mgm_preorder_lists CRUD + 客戶/專案選單
 * preorder_Id 為 RUID：PR{order_date 年份}-{5 位流水號}（每年重新起算）
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, n } = require('../utils/response');

// ===== 客戶自動完成（listbox 資料源：往來對象客戶 ∪ 專案主檔客戶）=====
router.get('/customers', async (req, res) => {
    try {
        const q = `%${req.query.q || ''}%`;
        const bu = req.query.bu || '';
        const params = [q, q];
        let buFilter = '';
        if (bu) { buFilter = ' AND r.bu_no=?'; params.push(bu); }
        params.push(q, q);
        const [rows] = await pool.execute(
            `SELECT customer_id, customer_name FROM (
                SELECT r.relation_id AS customer_id, r.relation_name AS customer_name
                FROM relation_detail r
                WHERE r.relation_type='客户' AND r.inuse_flag='USE'
                  AND (r.relation_id LIKE ? OR r.relation_name LIKE ?)${buFilter}
                UNION
                SELECT p.customer_id, p.customer_name FROM mgm_customer_projects p
                WHERE p.customer_id LIKE ? OR p.customer_name LIKE ?
            ) x
            ORDER BY customer_id LIMIT 20`, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ===== 客戶專案清單（選定客戶後帶出 project name/ID）=====
router.get('/customers/:customerId/projects', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT project_id, project_name, status FROM mgm_customer_projects
             WHERE customer_id=? ORDER BY project_id`, [req.params.customerId]);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ===== 預估訂單清單 =====
router.get('/', async (req, res) => {
    try {
        const { year, customer_id, status, user_id, limit } = req.query;
        let sql = 'SELECT * FROM mgm_preorder_lists WHERE 1=1';
        const params = [];
        if (year) { sql += ' AND YEAR(order_date)=?'; params.push(year); }
        if (customer_id) { sql += ' AND customer_id=?'; params.push(customer_id); }
        if (status) { sql += ' AND status=?'; params.push(status); }
        if (user_id) { sql += ' AND user_id=?'; params.push(user_id); }
        sql += ' ORDER BY order_date DESC, uid DESC LIMIT ' + (Math.min(Number(limit) || 300, 1000));
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ===== 產生 RUID（同一年內遞增；交易內取號避免併發重號）=====
async function genPreorderId(conn, orderDate) {
    const year = new Date(orderDate || Date.now()).getFullYear();
    const prefix = `PR${year}-`;
    // 鎖定該年度最大號（FOR UPDATE 需要在交易內才有意義）
    const [rows] = await conn.execute(
        `SELECT preorder_Id FROM mgm_preorder_lists
         WHERE preorder_Id LIKE ? ORDER BY preorder_Id DESC LIMIT 1 FOR UPDATE`, [`${prefix}%`]);
    let seq = 1;
    if (rows.length) {
        const m = /-(\d+)$/.exec(rows[0].preorder_Id);
        if (m) seq = Number(m[1]) + 1;
    }
    return prefix + String(seq).padStart(5, '0');
}

// ===== 新增 =====
router.post('/', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const d = req.body;
        if (!d.customer_id || !d.project_id) return fail(res, '請選擇客戶與專案', 400);
        await conn.beginTransaction();
        const preorderId = await genPreorderId(conn, d.order_date);
        const [r] = await conn.execute(`
            INSERT INTO mgm_preorder_lists
                (preorder_Id, user_id, user_name, customer_id, project_id, project_name,
                 order_amt, order_date, status, remark)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        `, [
            preorderId,
            n(d.user_id) || n(req.user && req.user.user_id),
            n(d.user_name) || n(req.user && req.user.user_name),
            n(d.customer_id), n(d.project_id), n(d.project_name),
            Number(d.order_amt || 0), d.order_date || null,
            d.status || 'draft', n(d.remark)
        ]);
        await conn.commit();
        ok(res, { uid: r.insertId, preorder_Id: preorderId }, '已新增預估訂單');
    } catch (err) {
        await conn.rollback().catch(() => {});
        fail500(res, err);
    } finally {
        conn.release();
    }
});

// ===== 更新 =====
router.put('/:uid', async (req, res) => {
    try {
        const d = req.body;
        const allowed = ['customer_id','project_id','project_name','order_amt','order_date','status','remark','user_id','user_name'];
        const keys = Object.keys(d).filter(k => allowed.includes(k));
        if (!keys.length) return fail(res, '無可更新欄位', 400);
        const sets = keys.map(k => `${k}=?`).join(',');
        const values = keys.map(k => ['order_amt'].includes(k) ? Number(d[k] || 0) : d[k]);
        values.push(req.params.uid);
        await pool.execute(`UPDATE mgm_preorder_lists SET ${sets} WHERE uid=?`, values);
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

// ===== 刪除 =====
router.delete('/:uid', async (req, res) => {
    try {
        await pool.execute('DELETE FROM mgm_preorder_lists WHERE uid=?', [req.params.uid]);
        ok(res, null, '已刪除');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
