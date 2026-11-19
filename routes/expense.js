/**
 * 费用报销路由
 *  - 我的报销 / 全部报销
 *  - 草稿、明细、提交审批、撤回、标记付款
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, n } = require('../utils/response');
const { submitWorkflow } = require('../services/workflow');
const audit = require('../services/audit');

const { perms, readScope } = require('../middleware/perms');
const MANAGER_TYPES = ['部门主管', '部門主管', '部门经理', '部門經理', '高阶主管', '高階主管', '高价主管'];

async function getUser(userId) {
    const [rows] = await pool.execute(
        'SELECT xuser_id, xuser_name, xuser_dept, admin, xuser_type FROM cams_xuser WHERE xuser_id=? LIMIT 1',
        [userId]
    );
    return rows[0] || null;
}

function isManager(user) {
    return !!user && (user.admin === 'Yes' || MANAGER_TYPES.includes(String(user.xuser_type || '').trim()));
}

function normalizeItems(items) {
    if (!Array.isArray(items) || !items.length) {
        throw Object.assign(new Error('请至少填写一条费用明细'), { code: 'BAD_ITEMS' });
    }
    return items.map((it, i) => {
        const amount = Number(it.amount);
        if (!Number.isFinite(amount) || amount < 0) {
            throw Object.assign(new Error(`第 ${i + 1} 条明细金额无效`), { code: 'BAD_ITEMS' });
        }
        const tax = Number(it.tax_amount || 0);
        return {
            expense_date: it.expense_date || null,
            category: it.category || null,
            description: it.description || null,
            amount,
            invoice_no: it.invoice_no || null,
            tax_amount: Number.isFinite(tax) ? tax : 0
        };
    });
}

function sumAmount(items) {
    return items.reduce((s, it) => s + Number(it.amount || 0), 0).toFixed(2);
}

// =====================================================================
// 借支 / 预支与核销（CFO-01）
// =====================================================================
const ADVANCE_TYPES = ['TRAVEL', 'GENERAL', 'PETTY'];

function normalizeAdvanceBody(body) {
    const title = String(body.title || '').trim();
    if (!title) throw Object.assign(new Error('借支事由必填'), { code: 'BAD_ADVANCE' });
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw Object.assign(new Error('借支金额必须大于 0'), { code: 'BAD_ADVANCE' });
    }
    const advanceType = ADVANCE_TYPES.includes(body.advance_type) ? body.advance_type : 'GENERAL';
    return {
        title, amount: amount.toFixed(2), advance_type: advanceType,
        bu_no: n(body.bu_no), expected_return_date: body.expected_return_date || null,
        remark: n(body.remark)
    };
}

// 借支列表
router.get('/advances', async (req, res) => {
    try {
        const userId = req.user.user_id;
        const scope = req.query.scope === 'all' ? 'all' : 'mine';
        const user = await getUser(userId);

        let sql = `SELECT a.*, u.xuser_name AS applicant_name,
                          (SELECT COUNT(*) FROM exp_advance_settle s WHERE s.advance_id=a.id) AS settle_count
                     FROM exp_advance a
                     LEFT JOIN cams_xuser u ON u.xuser_id=a.applicant_id
                    WHERE 1=1`;
        const params = [];
        if (scope === 'all') {
            if (!isManager(user)) return fail(res, '无权查看全部借支', 403);
            if (req.query.bu_no) { sql += ' AND a.bu_no=?'; params.push(req.query.bu_no); }
        } else {
            sql += ' AND a.applicant_id=?';
            params.push(userId);
        }
        if (req.query.status) { sql += ' AND a.status=?'; params.push(req.query.status); }
        sql += ' ORDER BY a.id DESC LIMIT 300';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// 借支详情（含核销记录）
router.get('/advances/:id', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT a.*, u.xuser_name AS applicant_name
               FROM exp_advance a LEFT JOIN cams_xuser u ON u.xuser_id=a.applicant_id
              WHERE a.id=?`,
            [req.params.id]
        );
        if (!rows.length) return fail(res, '借支单不存在', 404);
        const advance = rows[0];
        const user = await getUser(req.user.user_id);
        const allowed = String(advance.applicant_id) === String(req.user.user_id) || isManager(user);
        if (!allowed) return fail(res, '无权查看该借支单', 403);

        const [settles] = await pool.execute(
            `SELECT s.*, r.report_no, r.title AS report_title
               FROM exp_advance_settle s
               LEFT JOIN exp_report r ON r.id=s.report_id
              WHERE s.advance_id=? ORDER BY s.id`,
            [advance.id]
        );
        ok(res, { ...advance, settles });
    } catch (err) { fail500(res, err); }
});

// 新建借支单
router.post('/advances', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        let body;
        try { body = normalizeAdvanceBody(req.body); }
        catch (e) { return fail(res, e.message, 400); }

        const user = await getUser(req.user.user_id);
        if (!user) return fail(res, '使用者不存在', 404);

        await conn.beginTransaction();
        const [r] = await conn.execute(
            `INSERT INTO exp_advance
               (applicant_id, applicant_name, dept, bu_no, advance_type, title,
                amount, balance, expected_return_date, remark, status)
             VALUES (?,?,?,?,?,?,?,?,?,?,'DRAFT')`,
            [user.xuser_id, user.xuser_name || user.xuser_id, n(user.xuser_dept), body.bu_no,
                body.advance_type, body.title, body.amount, body.amount,
                body.expected_return_date, body.remark]
        );
        const [d] = await conn.query("SELECT DATE_FORMAT(NOW(),'%Y%m%d') AS d");
        const advanceNo = `JK${d[0].d}${String(r.insertId).padStart(4, '0')}`;
        await conn.execute('UPDATE exp_advance SET advance_no=? WHERE id=?', [advanceNo, r.insertId]);
        await conn.commit();
        const auditAfter1 = { id: r.insertId, advance_no: advanceNo };
        audit.log(req, {
            module: 'expense', action: 'CREATE', businessType: 'JK',
            businessId: advanceNo,
            summary: `新建借支单 ${advanceNo} ${body.title} ¥${body.amount}`,
            after: auditAfter1
        });
        ok(res, auditAfter1, '借支单已保存');
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally { conn.release(); }
});

// 编辑借支单（草稿/被驳回）
router.put('/advances/:id', async (req, res) => {
    try {
        let body;
        try { body = normalizeAdvanceBody(req.body); }
        catch (e) { return fail(res, e.message, 400); }

        const [rows] = await pool.execute('SELECT * FROM exp_advance WHERE id=?', [req.params.id]);
        if (!rows.length) return fail(res, '借支单不存在', 404);
        const row = rows[0];
        if (String(row.applicant_id) !== String(req.user.user_id)) return fail(res, '只能编辑自己的借支单', 403);
        if (!['DRAFT', 'REJECTED'].includes(row.status)) return fail(res, '当前状态不可编辑', 400);

        await pool.execute(
            `UPDATE exp_advance
                SET title=?, advance_type=?, bu_no=?, amount=?, balance=?,
                    expected_return_date=?, remark=?
              WHERE id=?`,
            [body.title, body.advance_type, body.bu_no, body.amount, body.amount,
                body.expected_return_date, body.remark, row.id]
        );
        const auditAfter2 = { id: row.id, title: body.title, advance_type: body.advance_type, amount: body.amount };
        audit.log(req, {
            module: 'expense', action: 'UPDATE', businessType: 'JK',
            businessId: row.advance_no || row.id,
            summary: `编辑借支单 ${row.advance_no || row.id} ${body.title} ¥${body.amount}`,
            before: row, after: auditAfter2
        });
        ok(res, { id: row.id }, '已保存');
    } catch (err) { fail500(res, err); }
});

// 删除借支单（仅草稿）
router.delete('/advances/:id', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM exp_advance WHERE id=?', [req.params.id]);
        if (!rows.length) return fail(res, '借支单不存在', 404);
        const row = rows[0];
        if (String(row.applicant_id) !== String(req.user.user_id)) return fail(res, '只能删除自己的借支单', 403);
        if (row.status !== 'DRAFT') return fail(res, '只有草稿可以删除', 400);
        await pool.execute('DELETE FROM exp_advance WHERE id=?', [row.id]);
        audit.log(req, {
            module: 'expense', action: 'DELETE', businessType: 'JK',
            businessId: row.advance_no || row.id,
            summary: `删除借支单 ${row.advance_no || row.id} ${row.title}`,
            before: row
        });
        ok(res, null, '已删除');
    } catch (err) { fail500(res, err); }
});

// 提交借支审批
router.post('/advances/:id/submit', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [rows] = await conn.execute('SELECT * FROM exp_advance WHERE id=? FOR UPDATE', [req.params.id]);
        if (!rows.length) { await conn.rollback(); return fail(res, '借支单不存在', 404); }
        const row = rows[0];
        if (String(row.applicant_id) !== String(req.user.user_id)) {
            await conn.rollback(); return fail(res, '只能提交自己的借支单', 403);
        }
        if (!['DRAFT', 'REJECTED'].includes(row.status)) {
            await conn.rollback(); return fail(res, '当前状态不可提交', 400);
        }

        const wf = await submitWorkflow(conn, {
            businessType: 'ADVANCE',
            businessId: row.id,
            title: row.title,
            amount: row.amount,
            applicantId: row.applicant_id,
            dept: row.dept,
            buNo: row.bu_no
        });
        const status = wf.status === 'APPROVED' ? 'APPROVED' : 'PENDING';
        await conn.execute(
            `UPDATE exp_advance
                SET status=?, wf_instance_id=?, submit_time=NOW(),
                    approve_time=IF(?='APPROVED', NOW(), NULL)
              WHERE id=?`,
            [status, wf.instanceId, status, row.id]
        );
        await conn.commit();
        const approverNames = (wf.approvers || []).map(a => a.user_name || a.user_id).join('、');
        audit.log(req, {
            module: 'expense', action: 'SUBMIT', businessType: 'JK-SUBMIT',
            businessId: row.advance_no || row.id,
            summary: `提交借支单审批 ${row.advance_no || row.id} ${row.title} ¥${row.amount}`,
            after: { status, wf_instance_id: wf.instanceId }
        });
        ok(res, { status, instance_id: wf.instanceId, approvers: wf.approvers || [] },
            status === 'APPROVED' ? '已自动通过' : (approverNames ? `已提交给 ${approverNames} 审批` : '已提交审批'));
    } catch (err) {
        await conn.rollback();
        if (['WF_STATE', 'WF_NO_PROCESS', 'WF_NO_STEP', 'WF_NO_APPROVER'].includes(err.code)) {
            return fail(res, err.message, 400);
        }
        fail500(res, err);
    } finally { conn.release(); }
});

// 拨付借支（管理员）
router.post('/advances/:id/pay', async (req, res) => {
    if (req.user.admin !== 'Yes') return fail(res, '只有管理员可以拨付借支', 403);
    try {
        const [rows] = await pool.execute('SELECT * FROM exp_advance WHERE id=?', [req.params.id]);
        if (!rows.length) return fail(res, '借支单不存在', 404);
        if (rows[0].status !== 'APPROVED') return fail(res, '只有审批通过的借支单可以拨付', 400);

        await pool.execute(
            "UPDATE exp_advance SET status='PAID', paid_date=CURDATE(), pay_time=NOW() WHERE id=?",
            [rows[0].id]
        );
        if (rows[0].wf_instance_id) {
            await pool.execute(
                'INSERT INTO wf_log (instance_id, step_no, action, operator_id, comment) VALUES (?,?,?,?,?)',
                [rows[0].wf_instance_id, null, 'PAY', req.user.user_id, '借支已拨付']
            );
            await pool.execute(
                "UPDATE wf_instance SET status='APPROVED', update_time=NOW() WHERE id=?",
                [rows[0].wf_instance_id]
            );
        }
        audit.log(req, {
            module: 'expense', action: 'PAY', businessType: 'JK-PAY',
            businessId: rows[0].advance_no || rows[0].id,
            summary: `拨付借支单 ${rows[0].advance_no || rows[0].id} ${rows[0].title} ¥${rows[0].amount}`,
            before: rows[0]
        });
        ok(res, null, '已拨付');
    } catch (err) { fail500(res, err); }
});

// 借支核销（财务/管理员）；可关联报销单
router.post('/advances/:id/settle', async (req, res) => {
    if (req.user.admin !== 'Yes' && !isManager(await getUser(req.user.user_id))) {
        return fail(res, '只有财务或主管可以核销借支', 403);
    }
    const conn = await pool.getConnection();
    try {
        const amount = Number(req.body.amount);
        if (!Number.isFinite(amount) || amount <= 0) return fail(res, '核销金额必须大于 0', 400);
        const settleDate = req.body.settle_date || new Date().toISOString().slice(0, 10);
        const reportId = req.body.report_id ? Number(req.body.report_id) : null;

        await conn.beginTransaction();
        const [rows] = await conn.execute('SELECT * FROM exp_advance WHERE id=? FOR UPDATE', [req.params.id]);
        if (!rows.length) { await conn.rollback(); return fail(res, '借支单不存在', 404); }
        const row = rows[0];
        if (!['PAID', 'SETTLED'].includes(row.status)) {
            await conn.rollback(); return fail(res, '借支尚未拨付，不能核销', 400);
        }
        const balance = Number(row.balance);
        if (amount > balance + 0.005) {
            await conn.rollback();
            return fail(res, `核销金额超过未核销余额 ${balance.toFixed(2)}`, 400);
        }

        let report = null;
        if (reportId) {
            const [rrows] = await conn.execute('SELECT * FROM exp_report WHERE id=?', [reportId]);
            if (!rrows.length) { await conn.rollback(); return fail(res, '报销单不存在', 404); }
            report = rrows[0];
            if (String(report.applicant_id) !== String(row.applicant_id)) {
                await conn.rollback(); return fail(res, '报销单与借支单申请人不一致', 400);
            }
            if (!['PENDING', 'APPROVED', 'PAID'].includes(report.status)) {
                await conn.rollback(); return fail(res, '报销单尚未提交，不能核销', 400);
            }
            if (amount > Number(report.total_amount) + 0.005) {
                await conn.rollback(); return fail(res, '核销金额超过报销单金额', 400);
            }
        }

        await conn.execute(
            `INSERT INTO exp_advance_settle
               (advance_id, report_id, settle_amount, settle_date, operator_id, note)
             VALUES (?,?,?,?,?,?)`,
            [row.id, reportId, amount.toFixed(2), settleDate, req.user.user_id, n(req.body.note)]
        );
        const newSettled = Number(row.settled_amount) + amount;
        const newBalance = Math.max(0, Number((balance - amount).toFixed(2)));
        await conn.execute(
            'UPDATE exp_advance SET settled_amount=?, balance=?, status=? WHERE id=?',
            [newSettled.toFixed(2), newBalance.toFixed(2), newBalance <= 0.005 ? 'SETTLED' : 'PAID', row.id]
        );
        await conn.commit();
        audit.log(req, {
            module: 'expense', action: 'SETTLE', businessType: 'JK-SETTLE',
            businessId: row.advance_no || row.id,
            summary: `核销借支单 ${row.advance_no || row.id} 金额 ¥${amount.toFixed(2)} 余额 ¥${newBalance.toFixed(2)}`,
            before: row,
            after: { settled_amount: newSettled.toFixed(2), balance: newBalance.toFixed(2), status: newBalance <= 0.005 ? 'SETTLED' : 'PAID' }
        });
        ok(res, { settled_amount: newSettled.toFixed(2), balance: newBalance.toFixed(2) },
            newBalance <= 0.005 ? '核销完成，借支已结清' : '已核销');
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally { conn.release(); }
});

// 列表：scope=mine|all
router.get('/', async (req, res) => {
    try {
        const userId = req.user.user_id;
        const scope = req.query.scope === 'all' ? 'all' : 'mine';
        const user = await getUser(userId);

        let sql = `
            SELECT r.*, w.status AS wf_status, w.current_step, w.total_steps,
                   u.xuser_name AS applicant_name
              FROM exp_report r
              LEFT JOIN wf_instance w ON w.id = r.wf_instance_id
              LEFT JOIN cams_xuser u ON u.xuser_id = r.applicant_id
             WHERE 1=1`;
        const params = [];
        if (scope === 'all') {
            if (!isManager(user)) return fail(res, '无权查看全部报销', 403);
            if (req.query.bu_no) { sql += ' AND r.bu_no=?'; params.push(req.query.bu_no); }
        } else {
            sql += ' AND r.applicant_id=?';
            params.push(userId);
        }
        if (req.query.status) { sql += ' AND r.status=?'; params.push(req.query.status); }
        sql += ' ORDER BY r.id DESC LIMIT 300';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// 单笔详情（含明细与审批轨迹）
router.get('/:id', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT r.*, u.xuser_name AS applicant_name
               FROM exp_report r LEFT JOIN cams_xuser u ON u.xuser_id=r.applicant_id
              WHERE r.id=?`,
            [req.params.id]
        );
        if (!rows.length) return fail(res, '报销单不存在', 404);
        const report = rows[0];
        const userId = req.user.user_id;
        const user = await getUser(userId);

        let allowed = String(report.applicant_id) === String(userId) || isManager(user);
        if (!allowed) {
            const [taskRows] = await pool.execute(
                `SELECT 1 FROM wf_task t
                   JOIN wf_instance i ON i.id=t.instance_id
                  WHERE i.business_type='EXPENSE' AND i.business_id=? AND t.approver_id=?
                  LIMIT 1`,
                [report.id, userId]
            );
            allowed = taskRows.length > 0;
        }
        if (!allowed) return fail(res, '无权查看该报销单', 403);

        const [items] = await pool.execute(
            'SELECT * FROM exp_report_item WHERE report_id=? ORDER BY id',
            [report.id]
        );
        const [instances] = await pool.execute(
            `SELECT * FROM wf_instance WHERE business_type='EXPENSE' AND business_id=?
              ORDER BY id DESC LIMIT 1`,
            [report.id]
        );
        let workflow = null;
        if (instances.length) {
            const inst = instances[0];
            const [tasks] = await pool.execute(
                `SELECT t.*, u.xuser_name AS approver_name
                   FROM wf_task t LEFT JOIN cams_xuser u ON u.xuser_id=t.approver_id
                  WHERE t.instance_id=? ORDER BY t.step_no, t.id`,
                [inst.id]
            );
            const [logs] = await pool.execute(
                `SELECT l.*, u.xuser_name AS operator_name
                   FROM wf_log l LEFT JOIN cams_xuser u ON u.xuser_id=l.operator_id
                  WHERE l.instance_id=? ORDER BY l.id`,
                [inst.id]
            );
            workflow = { ...inst, tasks, logs };
        }
        ok(res, { ...report, items, workflow });
    } catch (err) { fail500(res, err); }
});

// 新增草稿
router.post('/', perms('expense','CREATE'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { title, expense_type, bu_no, remark, items } = req.body;
        if (!title || !String(title).trim()) return fail(res, '报销事由必填', 400);
        const cleanItems = normalizeItems(items);
        const total = sumAmount(cleanItems);
        if (Number(total) <= 0) return fail(res, '报销金额必须大于 0', 400);

        const user = await getUser(req.user.user_id);
        if (!user) return fail(res, '使用者不存在', 404);

        await conn.beginTransaction();
        const [r] = await conn.execute(
            `INSERT INTO exp_report
               (applicant_id, applicant_name, dept, bu_no, expense_type, title, total_amount, status, remark)
             VALUES (?,?,?,?,?,?,?,'DRAFT',?)`,
            [user.xuser_id, user.xuser_name || user.xuser_id, n(user.xuser_dept), n(bu_no),
                n(expense_type), String(title).trim(), total, n(remark)]
        );
        const reportId = r.insertId;
        await insertItems(conn, reportId, cleanItems);
        const [dateRows] = await conn.query("SELECT DATE_FORMAT(NOW(),'%Y%m%d') AS d");
        const reportNo = `BX${dateRows[0].d}${String(reportId).padStart(4, '0')}`;
        await conn.execute('UPDATE exp_report SET report_no=? WHERE id=?', [reportNo, reportId]);
        await conn.commit();
        const auditAfter7 = { id: reportId, report_no: reportNo };
        audit.log(req, {
            module: 'expense', action: 'CREATE', businessType: 'BX',
            businessId: reportNo,
            summary: `新建报销单 ${reportNo} ${String(title).trim()} ¥${total} 申请人 ${user.xuser_name || user.xuser_id}`,
            after: auditAfter7
        });
        ok(res, auditAfter7, '草稿已保存');
    } catch (err) {
        await conn.rollback();
        if (err.code === 'BAD_ITEMS') return fail(res, err.message, 400);
        fail500(res, err);
    } finally {
        conn.release();
    }
});

// 编辑草稿 / 被驳回单据
router.put('/:id', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { title, expense_type, bu_no, remark, items } = req.body;
        if (!title || !String(title).trim()) return fail(res, '报销事由必填', 400);
        const cleanItems = normalizeItems(items);
        const total = sumAmount(cleanItems);
        if (Number(total) <= 0) return fail(res, '报销金额必须大于 0', 400);

        await conn.beginTransaction();
        const [rows] = await conn.execute('SELECT * FROM exp_report WHERE id=? FOR UPDATE', [req.params.id]);
        if (!rows.length) { await conn.rollback(); return fail(res, '报销单不存在', 404); }
        const report = rows[0];
        if (String(report.applicant_id) !== String(req.user.user_id)) {
            await conn.rollback();
            return fail(res, '只能编辑自己的报销单', 403);
        }
        if (!['DRAFT', 'REJECTED'].includes(report.status)) {
            await conn.rollback();
            return fail(res, '当前状态不可编辑', 400);
        }

        await conn.execute(
            `UPDATE exp_report SET title=?, expense_type=?, bu_no=?, remark=?, total_amount=?
              WHERE id=?`,
            [String(title).trim(), n(expense_type), n(bu_no), n(remark), total, report.id]
        );
        await conn.execute('DELETE FROM exp_report_item WHERE report_id=?', [report.id]);
        await insertItems(conn, report.id, cleanItems);
        await conn.commit();
        audit.log(req, {
            module: 'expense', action: 'UPDATE', businessType: 'BX',
            businessId: report.report_no || report.id,
            summary: `编辑报销单 ${report.report_no || report.id} ${String(title).trim()} ¥${total}`,
            before: report, after: { id: report.id, title: String(title).trim(), total_amount: total }
        });
        ok(res, { id: report.id }, '已保存');
    } catch (err) {
        await conn.rollback();
        if (err.code === 'BAD_ITEMS') return fail(res, err.message, 400);
        fail500(res, err);
    } finally {
        conn.release();
    }
});

// 删除草稿（仅未提交）
router.delete('/:id', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM exp_report WHERE id=?', [req.params.id]);
        if (!rows.length) return fail(res, '报销单不存在', 404);
        if (String(rows[0].applicant_id) !== String(req.user.user_id)) return fail(res, '只能删除自己的报销单', 403);
        if (rows[0].status !== 'DRAFT') return fail(res, '只有草稿可以删除，已提交单据请撤回或保留记录', 400);
        await pool.execute('DELETE FROM exp_report_item WHERE report_id=?', [req.params.id]);
        await pool.execute('DELETE FROM exp_report WHERE id=?', [req.params.id]);
        audit.log(req, {
            module: 'expense', action: 'DELETE', businessType: 'BX',
            businessId: rows[0].report_no || rows[0].id,
            summary: `删除报销单 ${rows[0].report_no || rows[0].id} ${rows[0].title}`,
            before: rows[0]
        });
        ok(res, null, '已删除');
    } catch (err) { fail500(res, err); }
});

// 提交审批
router.post('/:id/submit', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [rows] = await conn.execute('SELECT * FROM exp_report WHERE id=? FOR UPDATE', [req.params.id]);
        if (!rows.length) { await conn.rollback(); return fail(res, '报销单不存在', 404); }
        const report = rows[0];
        if (String(report.applicant_id) !== String(req.user.user_id)) {
            await conn.rollback();
            return fail(res, '只能提交自己的报销单', 403);
        }
        if (!['DRAFT', 'REJECTED'].includes(report.status)) {
            await conn.rollback();
            return fail(res, '当前状态不可提交', 400);
        }

        const [items] = await conn.execute(
            'SELECT amount FROM exp_report_item WHERE report_id=?',
            [report.id]
        );
        if (!items.length) {
            await conn.rollback();
            return fail(res, '请先填写费用明细', 400);
        }
        const total = items.reduce((s, it) => s + Number(it.amount || 0), 0).toFixed(2);
        if (Number(total) <= 0) {
            await conn.rollback();
            return fail(res, '报销金额必须大于 0', 400);
        }
        await conn.execute('UPDATE exp_report SET total_amount=? WHERE id=?', [total, report.id]);

        const wf = await submitWorkflow(conn, {
            businessType: 'EXPENSE',
            businessId: report.id,
            title: report.title,
            amount: total,
            applicantId: report.applicant_id,
            dept: report.dept,
            buNo: report.bu_no
        });
        const status = wf.status === 'APPROVED' ? 'APPROVED' : 'PENDING';
        await conn.execute(
            `UPDATE exp_report
                SET status=?, wf_instance_id=?, submit_time=NOW(),
                    approve_time=IF(?='APPROVED', NOW(), NULL)
              WHERE id=?`,
            [status, wf.instanceId, status, report.id]
        );
        await conn.commit();
        const approverNames = (wf.approvers || []).map(a => a.user_name || a.user_id).join('、');
        const message = status === 'APPROVED'
            ? '已自动通过'
            : (approverNames ? `已提交给 ${approverNames} 审批` : '已提交审批');
        audit.log(req, {
            module: 'expense', action: 'SUBMIT', businessType: 'BX-SUBMIT',
            businessId: report.report_no || report.id,
            summary: `提交报销单审批 ${report.report_no || report.id} ${report.title} ¥${total}`,
            after: { status, wf_instance_id: wf.instanceId }
        });
        ok(res, { status, instance_id: wf.instanceId, approvers: wf.approvers || [] }, message);
    } catch (err) {
        await conn.rollback();
        if (['WF_STATE', 'WF_NO_PROCESS', 'WF_NO_STEP', 'WF_NO_APPROVER'].includes(err.code)) {
            return fail(res, err.message, 400);
        }
        fail500(res, err);
    } finally {
        conn.release();
    }
});

// 标记已付款（管理员）
router.post('/:id/pay', async (req, res) => {
    if (req.user.admin !== 'Yes') return fail(res, '只有管理员可以标记付款', 403);
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [rows] = await conn.execute('SELECT * FROM exp_report WHERE id=? FOR UPDATE', [req.params.id]);
        if (!rows.length) { await conn.rollback(); return fail(res, '报销单不存在', 404); }
        if (rows[0].status !== 'APPROVED') { await conn.rollback(); return fail(res, '只有审批通过的单据可以付款', 400); }
        await conn.execute("UPDATE exp_report SET status='PAID', pay_time=NOW() WHERE id=?", [rows[0].id]);
        if (rows[0].wf_instance_id) {
            await conn.execute(
                'INSERT INTO wf_log (instance_id, step_no, action, operator_id, comment) VALUES (?,?,?,?,?)',
                [rows[0].wf_instance_id, null, 'PAY', req.user.user_id, '已标记付款']
            );
        }
        await conn.commit();
        audit.log(req, {
            module: 'expense', action: 'PAY', businessType: 'BX-PAY',
            businessId: rows[0].report_no || rows[0].id,
            summary: `标记报销单已付款 ${rows[0].report_no || rows[0].id} ${rows[0].title} ¥${rows[0].total_amount}`,
            before: rows[0]
        });
        ok(res, null, '已标记付款');
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally {
        conn.release();
    }
});

async function insertItems(conn, reportId, items) {
    for (const it of items) {
        await conn.execute(
            `INSERT INTO exp_report_item
               (report_id, expense_date, category, description, amount, invoice_no, tax_amount)
             VALUES (?,?,?,?,?,?,?)`,
            [reportId, it.expense_date, it.category, it.description, it.amount, it.invoice_no, it.tax_amount]
        );
    }
}

module.exports = router;
