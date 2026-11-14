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
router.post('/', async (req, res) => {
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
        ok(res, { id: reportId, report_no: reportNo }, '草稿已保存');
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
