/**
 * 通用审批流路由
 *  - 待办、流程详情、审批/驳回、撤回
 *  - 管理员维护流程定义
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const { requireAdmin } = require('../middleware/auth');
const { actOnTask, cancelWorkflow } = require('../services/workflow');

const APPROVER_TYPES = ['dept_manager', 'admin', 'user'];

// 待我审批
router.get('/pending', async (req, res) => {
    try {
        const userId = req.user.user_id;
        const { business_type } = req.query;
        let sql = `
            SELECT t.id AS task_id, t.step_no, t.step_name, t.create_time AS task_time,
                   i.id AS instance_id, i.business_type, i.business_id, i.title,
                   i.amount, i.applicant_id, i.bu_no, i.current_step, i.total_steps,
                   i.create_time AS submit_time,
                   u.xuser_name AS applicant_name
              FROM wf_task t
              JOIN wf_instance i ON i.id = t.instance_id
              LEFT JOIN cams_xuser u ON u.xuser_id = i.applicant_id
             WHERE t.approver_id=? AND t.status='PENDING' AND i.status='PENDING'`;
        const params = [userId];
        if (business_type) { sql += ' AND i.business_type=?'; params.push(business_type); }
        sql += ' ORDER BY t.create_time DESC';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// 待办数量
router.get('/summary', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT i.business_type, COUNT(*) AS cnt
               FROM wf_task t JOIN wf_instance i ON i.id=t.instance_id
              WHERE t.approver_id=? AND t.status='PENDING' AND i.status='PENDING'
              GROUP BY i.business_type`,
            [req.user.user_id]
        );
        const total = rows.reduce((s, r) => s + Number(r.cnt), 0);
        ok(res, { total, by_type: rows });
    } catch (err) { fail500(res, err); }
});

// 我提交的（含当前审批人，便于申请人追踪进度）
router.get('/mine', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT i.*,
                    r.status AS business_status,
                    (SELECT GROUP_CONCAT(DISTINCT CONCAT(IFNULL(u.xuser_name, t.approver_id), '(', t.approver_id, ')') SEPARATOR '、')
                       FROM wf_task t LEFT JOIN cams_xuser u ON u.xuser_id=t.approver_id
                      WHERE t.instance_id=i.id AND t.status='PENDING') AS current_approvers,
                    (SELECT COUNT(*) FROM wf_task t
                      WHERE t.instance_id=i.id AND t.status='PENDING') AS pending_cnt
               FROM wf_instance i
               LEFT JOIN exp_report r ON i.business_type='EXPENSE' AND r.id=i.business_id
              WHERE i.applicant_id=?
              ORDER BY i.create_time DESC LIMIT 200`,
            [req.user.user_id]
        );
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// 流程定义（管理员）
router.get('/processes', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM wf_process ORDER BY business_type, id');
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// 更新流程定义（管理员）
router.put('/processes/:id', requireAdmin, async (req, res) => {
    try {
        const { proc_name, steps, enabled } = req.body;
        if (!proc_name) return fail(res, '流程名称必填', 400);
        if (!Array.isArray(steps) || !steps.length) return fail(res, '至少需要一个审批步骤', 400);
        if (steps.length > 10) return fail(res, '审批步骤不能超过 10 个', 400);

        const clean = steps.map((s, i) => {
            const type = APPROVER_TYPES.includes(s.approver_type) ? s.approver_type : 'admin';
            if (type === 'user' && !s.approver_value) {
                throw new Error(`第 ${i + 1} 步为指定人员，必须填写账号`);
            }
            return {
                step_no: i + 1,
                step_name: String(s.step_name || `步骤 ${i + 1}`).trim(),
                approver_type: type,
                approver_value: type === 'user' ? String(s.approver_value).trim() : null
            };
        });

        await pool.execute(
            'UPDATE wf_process SET proc_name=?, steps_json=?, enabled=? WHERE id=?',
            [proc_name, JSON.stringify(clean), enabled ? 1 : 0, req.params.id]
        );
        ok(res, null, '流程已更新');
    } catch (err) {
        if (err.message && err.message.includes('指定人员')) return fail(res, err.message, 400);
        fail500(res, err);
    }
});

// 业务单据的审批记录
router.get('/business/:type/:id', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT * FROM wf_instance
              WHERE business_type=? AND business_id=?
              ORDER BY id DESC LIMIT 1`,
            [req.params.type, req.params.id]
        );
        if (!rows.length) return ok(res, null);
        const detail = await loadInstanceDetail(rows[0].id);
        const userId = req.user.user_id;
        const isApplicant = String(detail.applicant_id) === String(userId);
        const isApprover = (detail.tasks || []).some(t => String(t.approver_id) === String(userId));
        if (!isApplicant && !isApprover && req.user.admin !== 'Yes') {
            return fail(res, '无权查看该流程', 403);
        }
        ok(res, detail);
    } catch (err) { fail500(res, err); }
});

// 流程实例详情
router.get('/instances/:id', async (req, res) => {
    try {
        const detail = await loadInstanceDetail(req.params.id);
        if (!detail) return fail(res, '流程实例不存在', 404);
        const userId = req.user.user_id;
        const isApplicant = String(detail.applicant_id) === String(userId);
        const isApprover = (detail.tasks || []).some(t => String(t.approver_id) === String(userId));
        if (!isApplicant && !isApprover && req.user.admin !== 'Yes') {
            return fail(res, '无权查看该流程', 403);
        }
        ok(res, detail);
    } catch (err) { fail500(res, err); }
});

// 审批 / 驳回
router.post('/tasks/:id/action', async (req, res) => {
    try {
        const action = req.body.action === 'reject' ? 'reject' : 'approve';
        const result = await actOnTask({
            taskId: req.params.id,
            userId: req.user.user_id,
            action,
            comment: req.body.comment
        });
        ok(res, result, action === 'approve' ? '已通过' : '已驳回');
    } catch (err) {
        if (['FORBIDDEN', 'NOT_FOUND', 'WF_DONE', 'WF_NO_APPROVER'].includes(err.code)) {
            return fail(res, err.message, err.code === 'FORBIDDEN' ? 403 : 400);
        }
        fail500(res, err);
    }
});

// 申请人撤回
router.post('/instances/:id/cancel', async (req, res) => {
    try {
        const result = await cancelWorkflow({ instanceId: req.params.id, userId: req.user.user_id });
        ok(res, result, '已撤回');
    } catch (err) {
        if (['FORBIDDEN', 'NOT_FOUND', 'WF_DONE'].includes(err.code)) {
            return fail(res, err.message, err.code === 'FORBIDDEN' ? 403 : 400);
        }
        fail500(res, err);
    }
});

async function loadInstanceDetail(instanceId) {
    const [rows] = await pool.execute('SELECT * FROM wf_instance WHERE id=?', [instanceId]);
    if (!rows.length) return null;
    const instance = rows[0];
    const [tasks] = await pool.execute(
        `SELECT t.*, u.xuser_name AS approver_name
           FROM wf_task t LEFT JOIN cams_xuser u ON u.xuser_id=t.approver_id
          WHERE t.instance_id=? ORDER BY t.step_no, t.id`,
        [instanceId]
    );
    const [logs] = await pool.execute(
        `SELECT l.*, u.xuser_name AS operator_name
           FROM wf_log l LEFT JOIN cams_xuser u ON u.xuser_id=l.operator_id
          WHERE l.instance_id=? ORDER BY l.id`,
        [instanceId]
    );
    return { ...instance, tasks, logs };
}

module.exports = router;
