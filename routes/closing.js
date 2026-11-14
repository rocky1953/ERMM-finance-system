/**
 * 关账日历 + 任务清单 + 抵消分录 + 折算汇率
 * CFO-03 关账与合并增强
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');

// ====== 关账日历概览 ======
router.get('/calendar', async (req, res) => {
    try {
        const { YYYY_MM } = req.query;
        if (!YYYY_MM) return fail(res, '需要 YYYY_MM', 400);
        const [cal] = await pool.execute(
            'SELECT bu_no, YYYY_MM, status, close_time, closed_by, remark FROM closing_calendar WHERE YYYY_MM=? ORDER BY bu_no',
            [YYYY_MM]
        );
        // 补齐三家公司
        const companies = ['HM', 'HN', 'SZ'];
        const byBu = {};
        for (const r of cal) byBu[r.bu_no] = r;
        const rows = companies.map(bu => byBu[bu] || { bu_no: bu, YYYY_MM, status: 'OPEN' });

        // 各公司任务完成率
        const [tasks] = await pool.execute(
            `SELECT c.bu_no, COUNT(*) total, SUM(CASE WHEN i.status='DONE' OR i.status='NA' THEN 1 ELSE 0 END) done
             FROM closing_task t
             LEFT JOIN closing_task_instance i ON i.task_id=t.id AND i.YYYY_MM=?
             LEFT JOIN closing_calendar c ON c.bu_no=i.bu_no AND c.YYYY_MM=i.YYYY_MM
             WHERE t.inuse_flag='USE'
             GROUP BY c.bu_no`,
            [YYYY_MM]
        );
        const tMap = {};
        for (const t of tasks) tMap[t.bu_no] = t;
        for (const r of rows) {
            r.task_total = (tMap[r.bu_no] && tMap[r.bu_no].total) || 0;
            r.task_done = (tMap[r.bu_no] && tMap[r.bu_no].done) || 0;
            r.task_pct = r.task_total ? Math.round(r.task_done / r.task_total * 100) : null;
        }
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ====== 关账 ======
router.post('/calendar/:bu_no/:YYYY_MM/close', async (req, res) => {
    try {
        const u = req.user;
        const { bu_no, YYYY_MM } = req.params;

        // 检查任务完成率（非管理员需全部 DONE/NA）
        const [[progress]] = await pool.execute(
            `SELECT COUNT(*) ttl, SUM(CASE WHEN i.status IN ('DONE','NA') THEN 1 ELSE 0 END) done
             FROM closing_task t
             LEFT JOIN closing_task_instance i ON i.task_id=t.id AND i.YYYY_MM=? AND i.bu_no=?
             WHERE t.inuse_flag='USE'`,
            [YYYY_MM, bu_no]
        );
        const isAdmin = String(u.admin || '').trim() === 'Yes';
        if (!isAdmin && progress.ttl > 0 && Number(progress.done) < Number(progress.ttl)) {
            return fail(res, `尚有 ${Number(progress.ttl) - Number(progress.done)} 项任务未完成，无法关账`, 400);
        }

        const [existing] = await pool.execute('SELECT id, status FROM closing_calendar WHERE bu_no=? AND YYYY_MM=?', [bu_no, YYYY_MM]);
        if (existing.length && existing[0].status === 'CLOSED') return fail(res, '该期已关账', 400);

        if (existing.length) {
            await pool.execute(
                'UPDATE closing_calendar SET status="CLOSED", close_time=NOW(), closed_by=?, reopen_time=NULL, reopen_by=NULL WHERE id=?',
                [u.user_id, existing[0].id]
            );
        } else {
            await pool.execute(
                `INSERT INTO closing_calendar (bu_no, YYYY_MM, status, close_time, closed_by) VALUES (?,?,?,NOW(),?)`,
                [bu_no, YYYY_MM, 'CLOSED', u.user_id]
            );
        }
        ok(res, null, `${bu_no} ${YYYY_MM} 已关账`);
    } catch (err) { fail500(res, err); }
});

// ====== 重开关账 ======
router.post('/calendar/:bu_no/:YYYY_MM/reopen', async (req, res) => {
    try {
        const u = req.user;
        if (String(u.admin || '').trim() !== 'Yes') return fail(res, '仅管理员可重开关账', 403);
        const { bu_no, YYYY_MM } = req.params;
        await pool.execute(
            `INSERT INTO closing_calendar (bu_no, YYYY_MM, status, reopen_time, reopen_by) VALUES (?,?,?,NOW(),?)
             ON DUPLICATE KEY UPDATE status='OPEN', reopen_time=NOW(), reopen_by=?`,
            [bu_no, YYYY_MM, 'OPEN', u.user_id, u.user_id]
        );
        ok(res, null, `${bu_no} ${YYYY_MM} 已重开`);
    } catch (err) { fail500(res, err); }
});

// ====== 任务 Checklist ======
router.get('/checklist', async (req, res) => {
    try {
        const { bu_no, YYYY_MM } = req.query;
        if (!bu_no || !YYYY_MM) return fail(res, '需要 bu_no 和 YYYY_MM', 400);
        // 检查该期是否已有实例
        const [existing] = await pool.execute(
            'SELECT COUNT(*) c FROM closing_task_instance WHERE bu_no=? AND YYYY_MM=?',
            [bu_no, YYYY_MM]
        );
        if (!Number(existing[0].c)) {
            // 自动生成
            await pool.execute(
                `INSERT INTO closing_task_instance (bu_no, YYYY_MM, task_id, status)
                 SELECT ?, ?, id, 'OPEN' FROM closing_task WHERE inuse_flag='USE'`,
                [bu_no, YYYY_MM]
            );
        }
        const [tasks] = await pool.execute(
            `SELECT i.id, t.task_code, t.task_name, t.category, t.sort_order,
                    i.status, i.done_time, i.done_by, i.remark
             FROM closing_task t
             LEFT JOIN closing_task_instance i ON i.task_id=t.id AND i.bu_no=? AND i.YYYY_MM=?
             WHERE t.inuse_flag='USE'
             ORDER BY t.sort_order`,
            [bu_no, YYYY_MM]
        );
        ok(res, tasks);
    } catch (err) { fail500(res, err); }
});

// ====== 更新任务状态 ======
router.put('/checklist/:id', async (req, res) => {
    try {
        const u = req.user;
        const { status, remark } = req.body;
        if (!['OPEN', 'DONE', 'NA'].includes(status)) return fail(res, 'status 必须是 OPEN/DONE/NA', 400);
        const updates = ['status=?'];
        const params = [status];
        if (status === 'DONE') { updates.push('done_time=NOW()', 'done_by=?'); params.push(u.user_id); }
        else { updates.push('done_time=NULL', 'done_by=NULL'); }
        if (remark !== undefined) { updates.push('remark=?'); params.push(remark); }
        params.push(req.params.id);
        await pool.execute(`UPDATE closing_task_instance SET ${updates.join(', ')} WHERE id=?`, params);
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

// ====== 抵消分录列表 ======
router.get('/elimination', async (req, res) => {
    try {
        const { YYYY_MM } = req.query;
        if (!YYYY_MM) return fail(res, '需要 YYYY_MM', 400);
        const [rows] = await pool.execute(
            'SELECT * FROM consol_elimination_entry WHERE YYYY_MM=? ORDER BY entry_type, bu_no_from',
            [YYYY_MM]
        );
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ====== 抵消分录 CRUD ======
router.post('/elimination', async (req, res) => {
    try {
        const d = req.body;
        const u = req.user;
        const rate = Number(d.rate_to_twd) || 1;
        const [r] = await pool.execute(
            `INSERT INTO consol_elimination_entry
                (YYYY_MM, bu_no_from, bu_no_to, entry_type, amount, currency, rate_to_twd,
                 is_confirmed, confirmed_by, confirmed_time, remark, source)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [d.YYYY_MM, d.bu_no_from, d.bu_no_to, d.entry_type, Number(d.amount) || 0,
             d.currency || 'TWD', rate, d.is_confirmed ? 1 : 0,
             d.is_confirmed ? u.user_id : null, d.is_confirmed ? new Date() : null,
             d.remark || '', d.source || 'MANUAL']
        );
        ok(res, { id: r.insertId }, '已新增');
    } catch (err) { fail500(res, err); }
});

router.put('/elimination/:id', async (req, res) => {
    try {
        const d = req.body;
        const u = req.user;
        const rate = Number(d.rate_to_twd) || 1;
        // 确认只有管理员
        if (d.is_confirmed) {
            if (String(u.admin || '').trim() !== 'Yes') return fail(res, '仅管理员可确认抵消', 403);
        }
        await pool.execute(
            `UPDATE consol_elimination_entry SET
                bu_no_from=?, bu_no_to=?, entry_type=?, amount=?, currency=?, rate_to_twd=?,
                is_confirmed=?, confirmed_by=?, confirmed_time=?, remark=?
             WHERE id=?`,
            [d.bu_no_from, d.bu_no_to, d.entry_type, Number(d.amount) || 0,
             d.currency || 'TWD', rate,
             d.is_confirmed ? 1 : 0, d.is_confirmed ? u.user_id : null,
             d.is_confirmed ? new Date() : null, d.remark || '', req.params.id]
        );
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

router.delete('/elimination/:id', async (req, res) => {
    try {
        await pool.execute('DELETE FROM consol_elimination_entry WHERE id=?', [req.params.id]);
        ok(res, null, '已删除');
    } catch (err) { fail500(res, err); }
});

// ====== 自动生成内部销售冲销 ======
// 从 mgm_finance_summary 提取 AR_affiliate_amt 作为内部销售，按公司对生成抵消分录
router.post('/elimination/generate', async (req, res) => {
    try {
        const { YYYY_MM } = req.body;
        if (!YYYY_MM) return fail(res, '需要 YYYY_MM', 400);

        // 如果已存在，先清除旧的自动生成分录
        await pool.execute(
            "DELETE FROM consol_elimination_entry WHERE YYYY_MM=? AND source='AUTO_INTERNAL_SALE'",
            [YYYY_MM]
        );

        const [rows] = await pool.execute(`
            SELECT bu_no, AR_affiliate_amt, sale_amt
            FROM mgm_finance_summary
            WHERE YYYY_MM=? AND AR_affiliate_amt > 0
        `, [YYYY_MM]);

        let created = 0;
        // 简化处理：每家公司对内部销售全额冲销（实际需按交易对方匹配，这里先按全额）
        for (const r of rows) {
            await pool.execute(
                `INSERT INTO consol_elimination_entry
                    (YYYY_MM, bu_no_from, bu_no_to, entry_type, amount, currency, rate_to_twd, is_confirmed, remark, source)
                 VALUES (?,?,?, 'SALE', ?, 'TWD', 1, 0, '自動從 AR_affiliate_amt 生成，待確認', 'AUTO_INTERNAL_SALE')`,
                [YYYY_MM, r.bu_no, 'CONSOL', Number(r.AR_affiliate_amt)]
            );
            created++;
        }
        ok(res, { created }, `已生成 ${created} 条自动冲销分录（待确认）`);
    } catch (err) { fail500(res, err); }
});

// ====== 折算汇率 CRUD ======
router.get('/rates', async (req, res) => {
    try {
        const { YYYY_MM } = req.query;
        if (!YYYY_MM) return fail(res, '需要 YYYY_MM', 400);
        const [rows] = await pool.execute(
            'SELECT * FROM consol_exchange_rate WHERE YYYY_MM=? ORDER BY currency',
            [YYYY_MM]
        );
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.post('/rates', async (req, res) => {
    try {
        const { YYYY_MM, rates } = req.body;
        if (!YYYY_MM || !Array.isArray(rates)) return fail(res, '格式错误', 400);
        const conn = await pool.getConnection();
        await conn.beginTransaction();
        try {
            for (const r of rates) {
                await conn.execute(
                    `INSERT INTO consol_exchange_rate
                        (YYYY_MM, currency, rate_to_twd, rate_to_usd, rate_type, source)
                     VALUES (?,?,?,?,?,?)
                     ON DUPLICATE KEY UPDATE rate_to_twd=VALUES(rate_to_twd), rate_to_usd=VALUES(rate_to_usd),
                                             rate_type=VALUES(rate_type), source=VALUES(source)`,
                    [YYYY_MM, r.currency, Number(r.rate_to_twd) || 1, Number(r.rate_to_usd) || null,
                     r.rate_type || 'AVG', r.source || 'MANUAL']
                );
            }
            await conn.commit();
            ok(res, null, `已保存 ${rates.length} 条汇率`);
        } catch (e) { await conn.rollback(); throw e; }
        finally { conn.release(); }
    } catch (err) { fail500(res, err); }
});

module.exports = router;
