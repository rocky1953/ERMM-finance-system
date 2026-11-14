/**
 * 付款申請路由（最小閉環）
 * DRAFT → PENDING → APPROVED → PAID / REJECTED / CANCELLED
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const workflow = require('../services/workflow');

// ====== 工具 ======
function genRequestNo() {
    const d = new Date();
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `PK${yy}${mm}`;
}

// ====== 列表 ======
router.get('/', async (req, res) => {
    try {
        const { scope = 'mine', status, bu_no, keyword } = req.query;
        const u = req.user;
        const isAdmin = String(u.admin || '').trim() === 'Yes';

        let sql = `SELECT r.*, u.xuser_name FROM pay_request r
                   LEFT JOIN cams_xuser u ON u.xuser_id=r.applicant_id
                   WHERE 1=1`;
        const params = [];

        if (scope === 'all') {
            if (!isAdmin && !(u.user_type && ['部门主管','部門主管','高阶主管','高階主管'].includes(String(u.user_type).replace(/\s/g,'')))) {
                return fail(res, '无权查看全部单据', 403);
            }
        } else {
            sql += ' AND r.applicant_id=?'; params.push(u.user_id);
        }
        if (status) { sql += ' AND r.status=?'; params.push(status); }
        if (bu_no) { sql += ' AND r.bu_no=?'; params.push(bu_no); }
        if (keyword) {
            sql += ' AND (r.request_no LIKE ? OR r.pay_target LIKE ? OR r.remark LIKE ?)';
            const k = `%${keyword}%`;
            params.push(k, k, k);
        }
        sql += ' ORDER BY r.create_time DESC LIMIT 500';
        const [rows] = await pool.execute(sql, params);

        // 补充 items 和 workflow 状态
        if (rows.length) {
            const ids = rows.map(r => r.id);
            const [items] = await pool.execute(
                `SELECT * FROM pay_request_item WHERE request_id IN (${ids.map(() => '?').join(',')}) ORDER BY request_id, item_no`,
                ids
            );
            const itemMap = {};
            for (const it of items) {
                (itemMap[it.request_id] = itemMap[it.request_id] || []).push(it);
            }
            // 当前步骤（来自 wf_task）
            const [tasks] = await pool.execute(
                `SELECT t.instance_id, t.approver_id FROM wf_task t
                  JOIN wf_instance i ON i.id=t.instance_id
                  WHERE t.status='PENDING' AND i.business_type='PAYMENT'`
            );
            const pendingMap = {};
            for (const t of tasks) {
                (pendingMap[t.instance_id] = pendingMap[t.instance_id] || []).push(t.approver_id);
            }
            for (const r of rows) {
                r.items = itemMap[r.id] || [];
                r.waiting_for = pendingMap[r.wf_instance_id] || [];
            }
        }
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ====== 详情 ======
router.get('/:id', async (req, res) => {
    try {
        const u = req.user;
        const [rows] = await pool.execute(
            `SELECT r.*, u.xuser_name FROM pay_request r
             LEFT JOIN cams_xuser u ON u.xuser_id=r.applicant_id
             WHERE r.id=?`,
            [req.params.id]
        );
        if (!rows.length) return fail(res, '付款申请单不存在', 404);
        const row = rows[0];
        const isOwner = row.applicant_id === u.user_id;
        const isAdmin = String(u.admin || '').trim() === 'Yes';
        // 审批人判断
        let isApprover = false;
        if (row.wf_instance_id) {
            const [trows] = await pool.execute(
                'SELECT id FROM wf_task WHERE instance_id=? AND approver_id=? AND status="PENDING"',
                [row.wf_instance_id, u.user_id]
            );
            isApprover = trows.length > 0;
        }
        if (!isOwner && !isAdmin && !isApprover) return fail(res, '无权查看', 403);

        const [items] = await pool.execute(
            'SELECT * FROM pay_request_item WHERE request_id=? ORDER BY item_no',
            [row.id]
        );
        row.items = items;
        row._canEdit = isOwner && ['DRAFT', 'REJECTED'].includes(row.status);
        row._canSubmit = isOwner && row.status === 'DRAFT';
        row._canPay = isAdmin && row.status === 'APPROVED';
        row._canCancel = isOwner && row.status === 'PENDING';

        // workflow 状态（如果有）
        if (row.wf_instance_id) {
            const [wfRows] = await pool.execute(
                `SELECT i.*,
                    (SELECT GROUP_CONCAT(DISTINCT t.approver_id) FROM wf_task t WHERE t.instance_id=i.id AND t.status='PENDING') AS waiting
                 FROM wf_instance i WHERE i.id=?`,
                [row.wf_instance_id]
            );
            row.workflow = wfRows[0] || null;
        }
        ok(res, row);
    } catch (err) { fail500(res, err); }
});

// ====== 新建 ======
router.post('/', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const d = req.body;
        const u = req.user;
        const items = Array.isArray(d.items) ? d.items : [];
        if (!items.length) return fail(res, '至少需 1 条付款明细', 400);
        const total = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
        if (total <= 0) return fail(res, '合计金额必须大于 0', 400);

        // 生成单号
        const [cnt] = await conn.execute(
            `SELECT COUNT(*) c FROM pay_request WHERE request_no LIKE ?`,
            [`${genRequestNo()}%`]
        );
        const requestNo = `${genRequestNo()}${String(cnt[0].c + 1).padStart(4, '0')}`;

        await conn.beginTransaction();
        const [ur] = await conn.execute(
            `INSERT INTO pay_request
                (request_no, applicant_id, applicant_name, dept, bu_no, pay_type, pay_target,
                 total_amount, currency, pay_method, due_date, remark, status)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'DRAFT')`,
            [requestNo, u.user_id, u.user_name || u.user_id, d.dept || d.bu_no || '',
             d.bu_no, d.pay_type, d.pay_target, total, d.currency || 'TWD',
             d.pay_method, d.due_date || null, d.remark || '']
        );
        const reqId = ur.insertId;
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            await conn.execute(
                `INSERT INTO pay_request_item
                    (request_id, item_no, supplier_name, pay_type, invoice_num, invoice_date,
                     should_date, amount, currency_ab, remark)
                 VALUES (?,?,?,?,?,?,?,?,?,?)`,
                [reqId, i + 1, it.supplier_name || '', it.pay_type || d.pay_type,
                 it.invoice_num || null, it.invoice_date || null, it.should_date || null,
                 Number(it.amount) || 0, it.currency_ab || d.currency || 'TWD', it.remark || null]
            );
        }
        await conn.commit();
        ok(res, { id: reqId, request_no: requestNo, total_amount: total, status: 'DRAFT' }, '付款申请单已创建');
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally {
        conn.release();
    }
});

// ====== 编辑 ======
router.put('/:id', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const d = req.body;
        const u = req.user;
        const [rows] = await pool.execute('SELECT * FROM pay_request WHERE id=?', [req.params.id]);
        if (!rows.length) return fail(res, '不存在', 404);
        const row = rows[0];
        if (row.applicant_id !== u.user_id) return fail(res, '仅申请人可编辑', 403);
        if (!['DRAFT', 'REJECTED'].includes(row.status)) return fail(res, `状态为 ${row.status} 不允许编辑`, 400);

        const items = Array.isArray(d.items) ? d.items : [];
        const total = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
        if (total <= 0) return fail(res, '合计必须大于 0', 400);

        await conn.beginTransaction();
        await conn.execute(
            `UPDATE pay_request SET
                pay_type=?, pay_target=?, total_amount=?, currency=?,
                pay_method=?, due_date=?, remark=?, status='DRAFT',
                wf_instance_id=NULL, submit_time=NULL, approve_time=NULL, pay_time=NULL
             WHERE id=?`,
            [d.pay_type, d.pay_target, total, d.currency || row.currency,
             d.pay_method, d.due_date || null, d.remark || '', req.params.id]
        );
        await conn.execute('DELETE FROM pay_request_item WHERE request_id=?', [req.params.id]);
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            await conn.execute(
                `INSERT INTO pay_request_item
                    (request_id, item_no, supplier_name, pay_type, invoice_num, invoice_date,
                     should_date, amount, currency_ab, remark)
                 VALUES (?,?,?,?,?,?,?,?,?,?)`,
                [req.params.id, i + 1, it.supplier_name || '', it.pay_type || d.pay_type,
                 it.invoice_num || null, it.invoice_date || null, it.should_date || null,
                 Number(it.amount) || 0, it.currency_ab || d.currency || row.currency || 'TWD', it.remark || null]
            );
        }
        await conn.commit();
        ok(res, null, '已更新');
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally {
        conn.release();
    }
});

// ====== 删除（仅草稿）======
router.delete('/:id', async (req, res) => {
    try {
        const u = req.user;
        const [rows] = await pool.execute('SELECT * FROM pay_request WHERE id=?', [req.params.id]);
        if (!rows.length) return fail(res, '不存在', 404);
        const row = rows[0];
        if (row.applicant_id !== u.user_id) return fail(res, '仅申请人可删除', 403);
        if (row.status !== 'DRAFT') return fail(res, '仅草稿可删除', 400);
        await pool.execute('DELETE FROM pay_request WHERE id=?', [req.params.id]);
        ok(res, null, '已删除');
    } catch (err) { fail500(res, err); }
});

// ====== 提交审批 ======
router.post('/:id/submit', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const u = req.user;
        const [rows] = await pool.execute('SELECT * FROM pay_request WHERE id=?', [req.params.id]);
        if (!rows.length) return fail(res, '不存在', 404);
        const row = rows[0];
        if (row.applicant_id !== u.user_id) return fail(res, '仅申请人可提交', 403);
        if (!['DRAFT', 'REJECTED', 'CANCELLED'].includes(row.status))
            return fail(res, `状态 ${row.status} 不可提交`, 400);
        const [items] = await pool.execute('SELECT * FROM pay_request_item WHERE request_id=?', [row.id]);
        if (!items.length) return fail(res, '无明细行', 400);
        const total = items.reduce((s, it) => s + Number(it.amount), 0);

        await conn.beginTransaction();
        const ctx = {
            conn, businessType: 'PAYMENT', businessId: row.id,
            title: row.pay_target || row.request_no, amount: total,
            applicantId: u.user_id, applicantName: u.user_name,
            buNo: row.bu_no, dept: row.dept, procCode: 'PAYMENT_DEFAULT'
        };
        // 用默认流程
        let wf;
        try {
            wf = await workflow.submitWorkflow(conn, ctx);
        } catch (we) {
            await conn.rollback();
            if (we.code === 'WF_NO_APPROVER') return fail(res, '当前无法自动匹配审批人，请检查人员部门或联系管理员', 400);
            if (we.code === 'WF_NO_PROCESS') return fail(res, '付款审批流程未配置，请联系管理员', 400);
            throw we;
        }
        // 同步业务单状态
        await conn.execute(
            'UPDATE pay_request SET total_amount=?, wf_instance_id=?, status=?, submit_time=? WHERE id=?',
            [total, wf.instanceId, wf.status, new Date(), row.id]
        );
        // 写 wf_log
        await conn.execute(
            `INSERT INTO wf_log (instance_id, step_no, action, operator_id, comment, create_time)
             VALUES (?, 0, 'SUBMIT', ?, ?, NOW())`,
            [wf.instanceId, u.user_id, `${row.pay_target || ''} 付款申请提交`]
        );
        await conn.commit();
        const approverNames = (wf.approvers || []).map(a => a.user_name || a.user_id).join('、');
        const message = wf.status === 'APPROVED'
            ? '已自动通过'
            : (approverNames ? `已提交给 ${approverNames} 审批` : '已提交审批');
        ok(res, { status: wf.status, instance_id: wf.instanceId, approvers: wf.approvers || [] }, message);
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally {
        conn.release();
    }
});

// ====== 标记付款（APPROVED → PAID）======
router.post('/:id/pay', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const u = req.user;
        if (String(u.admin || '').trim() !== 'Yes') return fail(res, '仅管理员可标记付款', 403);
        const [rows] = await pool.execute('SELECT * FROM pay_request WHERE id=?', [req.params.id]);
        if (!rows.length) return fail(res, '不存在', 404);
        const row = rows[0];
        if (row.status !== 'APPROVED') return fail(res, `状态 ${row.status} 不可标记付款`, 400);

        await conn.beginTransaction();
        await conn.execute(
            'UPDATE pay_request SET status=?, pay_time=? WHERE id=?',
            ['PAID', new Date(), row.id]
        );
        if (row.wf_instance_id) {
            await conn.execute(
                `INSERT INTO wf_log (instance_id, step_no, action, operator_id, comment, create_time)
                 VALUES (?, 0, 'PAY', ?, '财务标记付款', NOW())`,
                [row.wf_instance_id, u.user_id]
            );
            await conn.execute(
                'UPDATE wf_instance SET status="APPROVED", update_time=NOW() WHERE id=?',
                [row.wf_instance_id]
            );
        }
        await conn.commit();
        ok(res, null, '已标记为付款');
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally {
        conn.release();
    }
});

module.exports = router;
