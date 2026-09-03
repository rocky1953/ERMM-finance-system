/**
 * 現金日記帳路由
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, pagination, n } = require('../utils/response');

// 列表
router.get('/', async (req, res) => {
    try {
        const { bu_no, num_vman, DB_CR, YYYY_MM, start_date, end_date } = req.query;
        let sql = 'SELECT * FROM MGM_casher_details WHERE 1=1';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (num_vman) { sql += ' AND num_vman LIKE ?'; params.push(`%${num_vman}%`); }
        if (DB_CR) { sql += ' AND DB_CR=?'; params.push(DB_CR); }
        if (YYYY_MM) { sql += ' AND YYYY_MM=?'; params.push(YYYY_MM); }
        if (start_date) { sql += ' AND wk_date>=?'; params.push(start_date); }
        if (end_date) { sql += ' AND wk_date<=?'; params.push(end_date); }
        sql += ' ORDER BY wk_date ASC, uid ASC LIMIT 500';
        const [rows] = await pool.execute(sql, params);

        // 轉換欄位 + 計算餘額
        let balance = 0;
        const out = rows.map(r => {
            const in_amt = String(r.DB_CR || '').toUpperCase() === 'DR' ? Number(r.sub_amt || 0) : 0;
            const out_amt = String(r.DB_CR || '').toUpperCase() === 'CR' ? Number(r.sub_amt || 0) : 0;
            balance += in_amt - out_amt;
            return {
                ...r,
                DB_CR: r.DB_CR,
                in_amt,
                out_amt,
                balance_amt: balance,
                amount: Number(r.sub_amt || 0)
            };
        });
        // 前端要最新的在前，翻轉
        ok(res, out.reverse());
    } catch (err) { fail500(res, err); }
});

// 新增 (防重複 num_vman)
router.post('/', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const d = req.body;

        // 防重複
        const [exist] = await conn.execute(
            'SELECT uid FROM MGM_casher_details WHERE bu_no=? AND num_vman=?',
            [d.bu_no, d.num_vman]
        );
        if (exist.length > 0) {
            await conn.rollback();
            return fail(res, `num_vman ${d.num_vman} 已存在`);
        }

        // 從 wk_date 自動拆分 YYYY/MM/YYYY_MM
        let YYYY = d.YYYY, MM = d.MM, YYYY_MM = d.YYYY_MM;
        if (d.wk_date) {
            const dt = new Date(d.wk_date);
            YYYY = String(dt.getFullYear());
            MM = String(dt.getMonth() + 1).padStart(2, '0');
            YYYY_MM = `${YYYY}/${MM}`;
        }

        const [result] = await conn.execute(
            `INSERT INTO MGM_casher_details (bu_no, amt_type, client_id, num_vman, sub_amt, DB_CR,
               YYYY, MM, YYYY_MM, wk_date, bank_acct, remark)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [n(d.bu_no), n(d.amt_type), n(d.client_id), n(d.num_vman), n(d.sub_amt), n(d.DB_CR),
             n(YYYY), n(MM), n(YYYY_MM), n(d.wk_date), n(d.bank_acct), n(d.remark)]
        );
        await conn.commit();
        ok(res, { uid: result.insertId, YYYY_MM }, '現金日記帳已新增');
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally {
        conn.release();
    }
});

// 修改
router.put('/:uid', async (req, res) => {
    try {
        const d = req.body;
        let YYYY = d.YYYY, MM = d.MM, YYYY_MM = d.YYYY_MM;
        if (d.wk_date) {
            const dt = new Date(d.wk_date);
            YYYY = String(dt.getFullYear());
            MM = String(dt.getMonth() + 1).padStart(2, '0');
            YYYY_MM = `${YYYY}/${MM}`;
        }
        await pool.execute(
            `UPDATE MGM_casher_details SET bu_no=?, amt_type=?, client_id=?, num_vman=?, sub_amt=?,
               DB_CR=?, YYYY=?, MM=?, YYYY_MM=?, wk_date=?, bank_acct=?, remark=? WHERE uid=?`,
            [n(d.bu_no), n(d.amt_type), n(d.client_id), n(d.num_vman), n(d.sub_amt), n(d.DB_CR),
             n(YYYY), n(MM), n(YYYY_MM), n(d.wk_date), n(d.bank_acct), n(d.remark), n(req.params.uid)]
        );
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

// 刪除
router.delete('/:uid', async (req, res) => {
    try {
        await pool.execute('DELETE FROM MGM_casher_details WHERE uid=?', [req.params.uid]);
        ok(res, null, '已刪除');
    } catch (err) { fail500(res, err); }
});

// 現金流量統計 (按月)
router.get('/summary', async (req, res) => {
    try {
        const { bu_no, YYYY_MM } = req.query;
        if (!bu_no) return fail(res, '需要 bu_no');
        let sql = 'SELECT DB_CR, SUM(sub_amt) AS total FROM MGM_casher_details WHERE bu_no=?';
        const params = [bu_no];
        if (YYYY_MM) { sql += ' AND YYYY_MM=?'; params.push(YYYY_MM); }
        sql += ' GROUP BY DB_CR';
        const [rows] = await pool.execute(sql, params);

        let total_in = 0, total_out = 0;
        for (const r of rows) {
            if (String(r.DB_CR || '').toUpperCase() === 'DR') total_in = Number(r.total || 0);
            else total_out = Number(r.total || 0);
        }

        // 計算累積餘額（從該 BU 開頭累積到當月）
        let balance = 0;
        if (YYYY_MM) {
            const [balRows] = await pool.execute(`
                SELECT DB_CR, SUM(sub_amt) AS total
                FROM MGM_casher_details
                WHERE bu_no=? AND YYYY_MM<=?
                GROUP BY DB_CR
            `, [bu_no, YYYY_MM]);
            for (const r of balRows) {
                if (String(r.DB_CR || '').toUpperCase() === 'DR') balance += Number(r.total || 0);
                else balance -= Number(r.total || 0);
            }
        }

        ok(res, {
            total_in,
            total_out,
            net: total_in - total_out,
            balance
        });
    } catch (err) { fail500(res, err); }
});

module.exports = router;
