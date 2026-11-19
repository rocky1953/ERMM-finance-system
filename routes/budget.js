/**
 * 預算編制路由
 * 預算 vs 實際比較、差異分析、年度預算彙總
 */
const express = require('express');
const { perms, readScope } = require('../middleware/perms');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const { requireAdmin } = require('../middleware/auth');

const BUDGET_BUS = ['HM', 'HN', 'SZ'];
const BUDGET_ACCOUNTS = [
    { code: '4100', name: '销售收入' },
    { code: '5100', name: '销售成本' },
    { code: '6100', name: '销售费用' },
    { code: '6200', name: '管理费用' },
    { code: '6300', name: '财务费用' }
];

function actor(req) {
    return req.user?.user_id || 'SYSTEM';
}

function normYear(v) {
    const y = String(v || '').trim();
    return /^\d{4}$/.test(y) ? y : null;
}

// 預算列表
router.get('/', readScope('budget'), async (req, res) => {
    try {
        const { bu_no } = req.query;
        let sql = 'SELECT * FROM budget WHERE 1=1';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        sql += ' ORDER BY YYYY DESC, bu_no';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// 預算 vs 實際（依科目/月份）
router.get('/detail', readScope('budget'), async (req, res) => {
    try {
        const { bu_no, YYYY, account_code } = req.query;
        if (!bu_no || !YYYY) return fail(res, '需要 bu_no 與 YYYY');
        let sql = `SELECT account_code, account_name, YYYY_MM, budget_amt, actual_amt,
                          (actual_amt - budget_amt) AS diff_amt,
                          CASE WHEN budget_amt>0 THEN ROUND((actual_amt-budget_amt)/budget_amt*100,2) ELSE 0 END AS diff_pct
                   FROM budget_detail WHERE bu_no=? AND YYYY_MM LIKE ?`;
        const params = [bu_no, `${YYYY}%`];
        if (account_code) { sql += ' AND account_code=?'; params.push(account_code); }
        sql += ' ORDER BY account_code, YYYY_MM';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// 年度預算彙總（依科目）
router.get('/summary', async (req, res) => {
    try {
        const { bu_no, YYYY } = req.query;
        if (!bu_no || !YYYY) return fail(res, '需要 bu_no 與 YYYY');
        const [rows] = await pool.execute(`
            SELECT account_code, account_name,
                   SUM(budget_amt) AS total_budget,
                   SUM(actual_amt) AS total_actual,
                   SUM(actual_amt - budget_amt) AS total_diff,
                   CASE WHEN SUM(budget_amt)>0 THEN ROUND(SUM(actual_amt-budget_amt)/SUM(budget_amt)*100,2) ELSE 0 END AS diff_pct
            FROM budget_detail
            WHERE bu_no=? AND YYYY_MM LIKE ?
            GROUP BY account_code, account_name
            ORDER BY account_code
        `, [bu_no, `${YYYY}%`]);

        // 計算達成率
        const data = rows.map(r => ({
            ...r,
            achievement: r.total_budget > 0 ? Math.round(r.total_actual / r.total_budget * 1000) / 10 : 0
        }));
        ok(res, data);
    } catch (err) { fail500(res, err); }
});

// 月度預算執行進度
router.get('/monthly-progress', async (req, res) => {
    try {
        const { bu_no, YYYY } = req.query;
        if (!bu_no || !YYYY) return fail(res, '需要 bu_no 與 YYYY');
        const [rows] = await pool.execute(`
            SELECT YYYY_MM,
                   SUM(budget_amt) AS month_budget,
                   SUM(actual_amt) AS month_actual
            FROM budget_detail
            WHERE bu_no=? AND YYYY_MM LIKE ?
            GROUP BY YYYY_MM
            ORDER BY YYYY_MM
        `, [bu_no, `${YYYY}%`]);
        let cumBudget = 0, cumActual = 0;
        const data = rows.map(r => {
            cumBudget += Number(r.month_budget || 0);
            cumActual += Number(r.month_actual || 0);
            return {
                YYYY_MM: r.YYYY_MM,
                month_budget: Number(r.month_budget),
                month_actual: Number(r.month_actual),
                cum_budget: Math.round(cumBudget * 100) / 100,
                cum_actual: Math.round(cumActual * 100) / 100,
                achievement: cumBudget > 0 ? Math.round(cumActual / cumBudget * 1000) / 10 : 0
            };
        });
        ok(res, data);
    } catch (err) { fail500(res, err); }
});

// ====== 预算编制录入与审批 ======

// 读取指定公司/年度的预算主表、明细与审批日志
router.get('/header', async (req, res) => {
    try {
        const bu = String(req.query.bu_no || '').toUpperCase();
        const y = normYear(req.query.YYYY);
        if (!BUDGET_BUS.includes(bu)) return fail(res, '公司别仅支持 HM/HN/SZ');
        if (!y) return fail(res, '需要 YYYY');

        const [budgets] = await pool.execute(
            'SELECT * FROM budget WHERE bu_no=? AND YYYY=? ORDER BY uid DESC LIMIT 1',
            [bu, y]
        );
        if (budgets.length === 0) {
            return ok(res, { budget: null, details: [], logs: [], accounts: BUDGET_ACCOUNTS });
        }
        const b = budgets[0];
        const [details] = await pool.execute(`
            SELECT uid, account_code, account_name, YYYY_MM, budget_amt, actual_amt
            FROM budget_detail WHERE budget_uid=? ORDER BY YYYY_MM, account_code
        `, [b.uid]);
        const [logs] = await pool.execute(
            'SELECT id, action, actor, reason, create_time FROM budget_approval_log WHERE budget_uid=? ORDER BY id DESC',
            [b.uid]
        );
        ok(res, { budget: b, details, logs, accounts: BUDGET_ACCOUNTS });
    } catch (err) { fail500(res, err); }
});

// 创建预算草稿（已存在则直接返回）
router.post('/', async (req, res) => {
    try {
        const bu = String(req.body?.bu_no || '').toUpperCase();
        const y = normYear(req.body?.YYYY);
        if (!BUDGET_BUS.includes(bu)) return fail(res, '公司别仅支持 HM/HN/SZ');
        if (!y) return fail(res, '需要 YYYY');

        const [exists] = await pool.execute(
            'SELECT uid, status FROM budget WHERE bu_no=? AND YYYY=? LIMIT 1',
            [bu, y]
        );
        if (exists.length) {
            return ok(res, { uid: exists[0].uid, status: exists[0].status }, '预算已存在');
        }

        const name = String(req.body?.budget_name || '').trim() || `${y}年度营业预算`;
        const [r] = await pool.execute(
            "INSERT INTO budget (bu_no, YYYY, budget_name, currency, status, created_by) VALUES (?,?,?,'RMB','draft',?)",
            [bu, y, name, actor(req)]
        );
        ok(res, { uid: r.insertId, status: 'draft' }, '已创建预算草稿');
    } catch (err) { fail500(res, err); }
});

// 保存预算明细（仅草稿/已驳回可编辑）
router.put('/:uid/details', perms('budget','UPDATE'), async (req, res) => {
    let conn;
    try {
        const uid = Number(req.params.uid);
        if (!uid) return fail(res, '预算 ID 无效');

        const [[b]] = await pool.execute('SELECT * FROM budget WHERE uid=?', [uid]);
        if (!b) return fail(res, '预算不存在', 404);
        if (!['draft', 'rejected'].includes(b.status)) {
            return fail(res, '仅草稿或已驳回状态可修改预算');
        }

        const details = Array.isArray(req.body?.details) ? req.body.details : [];
        const clean = [];
        for (const d of details) {
            const code = String(d.account_code || '').trim();
            const acct = BUDGET_ACCOUNTS.find(a => a.code === code);
            if (!acct) continue;
            const ym = String(d.YYYY_MM || '').trim();
            if (!ym.startsWith(`${b.YYYY}-`)) continue;
            const amt = Number(d.budget_amt || 0);
            if (!Number.isFinite(amt) || amt < 0) {
                return fail(res, `${ym} ${code} 预算金额无效`);
            }
            clean.push({ code, name: acct.name, ym, amt: Math.round(amt * 100) / 100 });
        }
        if (clean.length === 0) return fail(res, '没有有效的预算明细');

        conn = await pool.getConnection();
        await conn.beginTransaction();
        for (const d of clean) {
            await conn.execute(`
                INSERT INTO budget_detail (budget_uid, bu_no, account_code, account_name, YYYY_MM, budget_amt)
                VALUES (?,?,?,?,?,?)
                ON DUPLICATE KEY UPDATE budget_amt=VALUES(budget_amt), account_name=VALUES(account_name)
            `, [uid, b.bu_no, d.code, d.name, d.ym, d.amt]);
        }
        await conn.commit();
        ok(res, { saved: clean.length }, '预算明细已保存');
    } catch (err) {
        if (conn) { try { await conn.rollback(); } catch (e) { /* ignore */ } }
        fail500(res, err);
    } finally {
        if (conn) conn.release();
    }
});

// 提交审批
router.post('/:uid/submit', perms('budget','SUBMIT'), async (req, res) => {
    let conn;
    try {
        const uid = Number(req.params.uid);
        const [[b]] = await pool.execute('SELECT status FROM budget WHERE uid=?', [uid]);
        if (!b) return fail(res, '预算不存在', 404);
        if (!['draft', 'rejected'].includes(b.status)) return fail(res, '仅草稿或已驳回状态可提交');

        const [[cnt]] = await pool.execute(
            'SELECT COUNT(*) AS c FROM budget_detail WHERE budget_uid=? AND budget_amt>0',
            [uid]
        );
        if (!cnt.c) return fail(res, '请先录入预算金额再提交');

        conn = await pool.getConnection();
        await conn.beginTransaction();
        await conn.execute(
            "UPDATE budget SET status='submitted', submitted_by=?, submitted_at=NOW(), reject_reason=NULL WHERE uid=?",
            [actor(req), uid]
        );
        await conn.execute(
            'INSERT INTO budget_approval_log (budget_uid, action, actor) VALUES (?,?,?)',
            [uid, 'SUBMIT', actor(req)]
        );
        await conn.commit();
        ok(res, null, '已提交审批');
    } catch (err) {
        if (conn) { try { await conn.rollback(); } catch (e) { /* ignore */ } }
        fail500(res, err);
    } finally {
        if (conn) conn.release();
    }
});

// 审批通过（管理员）
router.post('/:uid/approve', requireAdmin, async (req, res) => {
    let conn;
    try {
        const uid = Number(req.params.uid);
        const [[b]] = await pool.execute('SELECT status FROM budget WHERE uid=?', [uid]);
        if (!b) return fail(res, '预算不存在', 404);
        if (b.status !== 'submitted') return fail(res, '仅已提交状态可审批');

        conn = await pool.getConnection();
        await conn.beginTransaction();
        await conn.execute(
            "UPDATE budget SET status='approved', approved_by=?, approved_at=NOW(), reject_reason=NULL WHERE uid=?",
            [actor(req), uid]
        );
        await conn.execute(
            'INSERT INTO budget_approval_log (budget_uid, action, actor, reason) VALUES (?,?,?,?)',
            [uid, 'APPROVE', actor(req), req.body?.remark || null]
        );
        await conn.commit();
        ok(res, null, '审批通过');
    } catch (err) {
        if (conn) { try { await conn.rollback(); } catch (e) { /* ignore */ } }
        fail500(res, err);
    } finally {
        if (conn) conn.release();
    }
});

// 驳回（管理员）
router.post('/:uid/reject', requireAdmin, async (req, res) => {
    let conn;
    try {
        const uid = Number(req.params.uid);
        const reason = String(req.body?.reason || '').trim();
        if (!reason) return fail(res, '请填写驳回原因');

        const [[b]] = await pool.execute('SELECT status FROM budget WHERE uid=?', [uid]);
        if (!b) return fail(res, '预算不存在', 404);
        if (b.status !== 'submitted') return fail(res, '仅已提交状态可驳回');

        conn = await pool.getConnection();
        await conn.beginTransaction();
        await conn.execute(
            "UPDATE budget SET status='rejected', reject_reason=? WHERE uid=?",
            [reason, uid]
        );
        await conn.execute(
            'INSERT INTO budget_approval_log (budget_uid, action, actor, reason) VALUES (?,?,?,?)',
            [uid, 'REJECT', actor(req), reason]
        );
        await conn.commit();
        ok(res, null, '已驳回');
    } catch (err) {
        if (conn) { try { await conn.rollback(); } catch (e) { /* ignore */ } }
        fail500(res, err);
    } finally {
        if (conn) conn.release();
    }
});

module.exports = router;
