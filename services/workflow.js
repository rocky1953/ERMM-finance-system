/**
 * 通用审批流服务
 *
 * 设计：
 *   wf_process  流程定义（steps_json 描述步骤与审批人规则）
 *   wf_instance 业务单据的流程实例
 *   wf_task     当前步骤的审批任务（同一步骤可多人候选，任一通过即流转）
 *   wf_log      全量审批轨迹
 *
 * 审批人规则 approver_type：
 *   dept_manager 申请人同部门主管（排除申请人）
 *   admin        管理员（财务审批）
 *   user         指定账号（approver_value）
 */
const { pool } = require('../config/db');

const MANAGER_TYPES = ['部门主管', '部門主管', '部门经理', '部門經理', '高阶主管', '高階主管', '高价主管'];
const MANAGER_PLACEHOLDERS = MANAGER_TYPES.map(() => '?').join(',');

function parseSteps(process) {
    if (!process) return [];
    let steps = process.steps_json;
    if (typeof steps === 'string') {
        try { steps = JSON.parse(steps); } catch (e) { steps = []; }
    }
    if (!Array.isArray(steps)) return [];
    return steps
        .filter(s => s && s.step_no != null)
        .map((s, i) => ({
            step_no: Number(s.step_no) || i + 1,
            step_name: s.step_name || `步骤 ${s.step_no || i + 1}`,
            approver_type: s.approver_type || 'admin',
            approver_value: s.approver_value || null
        }))
        .sort((a, b) => a.step_no - b.step_no);
}

async function loadProcess(conn, businessType, procCode) {
    const db = conn || pool;
    // 已启动的实例按 proc_code 读取（即使流程后来被停用也要走完）；新建时才要求 enabled=1
    const sql = procCode
        ? 'SELECT * FROM wf_process WHERE proc_code=? LIMIT 1'
        : 'SELECT * FROM wf_process WHERE business_type=? AND enabled=1 ORDER BY id LIMIT 1';
    const [rows] = await db.execute(sql, [procCode || businessType]);
    return rows[0] || null;
}

async function resolveCandidates(conn, step, ctx) {
    if (step.approver_type === 'user') {
        return step.approver_value ? [String(step.approver_value)] : [];
    }
    if (step.approver_type === 'dept_manager') {
        let dept = ctx.dept;
        if (!dept) {
            // 单据部门可能为空，回退读取申请人当前部门
            const [u] = await conn.execute(
                'SELECT xuser_dept FROM cams_xuser WHERE xuser_id=? LIMIT 1',
                [ctx.applicantId]
            );
            dept = u.length ? u[0].xuser_dept : null;
        }
        if (dept) {
            const params = [ctx.applicantId, dept, ...MANAGER_TYPES];
            const [rows] = await conn.execute(
                `SELECT xuser_id FROM cams_xuser
                  WHERE inuse_flag='USE' AND xuser_id<>? AND xuser_dept=?
                    AND xuser_type IN (${MANAGER_PLACEHOLDERS})`,
                params
            );
            if (rows.length) return rows.map(r => r.xuser_id);
        }
        // 无部门或部门无主管时回退到管理员，避免流程卡死
        const [admins] = await conn.execute(
            "SELECT xuser_id FROM cams_xuser WHERE inuse_flag='USE' AND admin='Yes' AND xuser_id<>?",
            [ctx.applicantId]
        );
        return admins.map(r => r.xuser_id);
    }
    // admin：管理员 / 财务审批
    const [rows] = await conn.execute(
        "SELECT xuser_id FROM cams_xuser WHERE inuse_flag='USE' AND admin='Yes' AND xuser_id<>?",
        [ctx.applicantId]
    );
    return rows.map(r => r.xuser_id);
}

function uniq(list) {
    return [...new Set(list.filter(Boolean))];
}

/**
 * 从指定步骤之后打开下一个有候选人的步骤。
 * 若无可用审批人则记录 SKIP 并继续；全部结束时自动通过。
 */
async function openNextStep(conn, instance, afterStep) {
    const process = await loadProcess(conn, instance.business_type, instance.proc_code);
    const steps = parseSteps(process);
    const remaining = steps.filter(s => s.step_no > afterStep);

    for (const step of remaining) {
        const candidates = uniq(await resolveCandidates(conn, step, {
            applicantId: instance.applicant_id,
            dept: instance.dept
        }));

        if (!candidates.length) {
            // 财务审批必须 fail-closed：没有审批人时不允许自动通过
            throw Object.assign(
                new Error(`${step.step_name}：未找到可用审批人，请检查流程配置或管理员账号`),
                { code: 'WF_NO_APPROVER' }
            );
        }

        for (const approver of candidates) {
            await conn.execute(
                `INSERT INTO wf_task (instance_id, step_no, step_name, approver_id, status)
                 VALUES (?,?,?,?, 'PENDING')`,
                [instance.id, step.step_no, step.step_name, approver]
            );
        }
        await conn.execute(
            'UPDATE wf_instance SET current_step=?, total_steps=?, status=? WHERE id=?',
            [step.step_no, steps.length, 'PENDING', instance.id]
        );
        // 返回实际审批人，供提交结果提示
        const [approverRows] = await conn.execute(
            `SELECT xuser_id, xuser_name FROM cams_xuser
              WHERE xuser_id IN (${candidates.map(() => '?').join(',')})`,
            candidates
        );
        const nameMap = new Map(approverRows.map(r => [r.xuser_id, r.xuser_name]));
        const approvers = candidates.map(id => ({
            user_id: id,
            user_name: nameMap.get(id) || id
        }));
        return { status: 'PENDING', step: step.step_no, approvers };
    }

    await conn.execute(
        'UPDATE wf_instance SET current_step=?, total_steps=?, status=? WHERE id=?',
        [steps.length, steps.length, 'APPROVED', instance.id]
    );
    instance.status = 'APPROVED';
    await syncBusiness(conn, instance, 'APPROVED');
    return { status: 'APPROVED' };
}

async function syncBusiness(conn, instance, status) {
    if (instance.business_type === 'EXPENSE') {
        if (status === 'APPROVED') {
            await conn.execute(
                "UPDATE exp_report SET status='APPROVED', approve_time=NOW() WHERE id=?",
                [instance.business_id]
            );
        } else if (status === 'REJECTED') {
            await conn.execute(
                "UPDATE exp_report SET status='REJECTED' WHERE id=?",
                [instance.business_id]
            );
        }
    } else if (instance.business_type === 'PAYMENT') {
        if (status === 'APPROVED') {
            await conn.execute(
                "UPDATE pay_request SET status='APPROVED', approve_time=NOW() WHERE id=?",
                [instance.business_id]
            );
        } else if (status === 'REJECTED') {
            await conn.execute(
                "UPDATE pay_request SET status='REJECTED' WHERE id=?",
                [instance.business_id]
            );
        }
    } else if (instance.business_type === 'PURCHASE') {
        if (status === 'APPROVED') {
            await conn.execute(
                "UPDATE pr_request SET status='APPROVED', approve_time=NOW() WHERE id=?",
                [instance.business_id]
            );
        } else if (status === 'REJECTED') {
            await conn.execute(
                "UPDATE pr_request SET status='REJECTED' WHERE id=?",
                [instance.business_id]
            );
        }
    }
}

/**
 * 提交单据：新建流程实例，或重新提交已驳回/已撤回的实例。
 * 必须在调用方的事务连接中执行。
 */
async function submitWorkflow(conn, opts) {
    const { businessType, businessId, title, amount, applicantId, dept, buNo } = opts;

    const [existing] = await conn.execute(
        `SELECT * FROM wf_instance
          WHERE business_type=? AND business_id=?
          ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [businessType, businessId]
    );

    if (existing.length) {
        const instance = existing[0];
        if (instance.status === 'PENDING' || instance.status === 'APPROVED') {
            const err = new Error(instance.status === 'PENDING' ? '该单据正在审批中' : '该单据已审批通过');
            err.code = 'WF_STATE';
            throw err;
        }
        await conn.execute(
            "UPDATE wf_instance SET status='PENDING', current_step=0, amount=?, title=?, dept=?, bu_no=? WHERE id=?",
            [amount, title, dept, buNo, instance.id]
        );
        await conn.execute(
            'INSERT INTO wf_log (instance_id, step_no, action, operator_id, comment) VALUES (?,?,?,?,?)',
            [instance.id, null, 'SUBMIT', applicantId, '重新提交审批']
        );
        const inst = { ...instance, status: 'PENDING', amount, title, dept, bu_no: buNo };
        const next = await openNextStep(conn, inst, 0);
        return { instanceId: instance.id, status: next.status, approvers: next.approvers || [] };
    }

    const process = await loadProcess(conn, businessType);
    if (!process) {
        const err = new Error('未配置审批流程，请联系管理员');
        err.code = 'WF_NO_PROCESS';
        throw err;
    }
    const steps = parseSteps(process);
    if (!steps.length) {
        const err = new Error('审批流程没有有效步骤');
        err.code = 'WF_NO_STEP';
        throw err;
    }

    const [r] = await conn.execute(
        `INSERT INTO wf_instance
           (proc_code, business_type, business_id, title, amount, applicant_id, bu_no, dept, status, current_step, total_steps)
         VALUES (?,?,?,?,?,?,?,?, 'PENDING', 0, ?)`,
        [process.proc_code, businessType, businessId, title, amount, applicantId, buNo, dept, steps.length]
    );
    const instance = {
        id: r.insertId,
        proc_code: process.proc_code,
        business_type: businessType,
        business_id: businessId,
        title, amount, applicant_id: applicantId, bu_no: buNo, dept,
        status: 'PENDING'
    };
    await conn.execute(
        'INSERT INTO wf_log (instance_id, step_no, action, operator_id, comment) VALUES (?,?,?,?,?)',
        [instance.id, null, 'SUBMIT', applicantId, '提交审批']
    );
    const next = await openNextStep(conn, instance, 0);
    return { instanceId: instance.id, status: next.status, approvers: next.approvers || [] };
}

/**
 * 审批任务：approve / reject
 */
async function actOnTask({ taskId, userId, action, comment }) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [tasks] = await conn.execute(
            'SELECT * FROM wf_task WHERE id=? FOR UPDATE',
            [taskId]
        );
        if (!tasks.length) throw Object.assign(new Error('审批任务不存在'), { code: 'NOT_FOUND' });
        const task = tasks[0];
        if (task.status !== 'PENDING') throw Object.assign(new Error('该任务已处理'), { code: 'WF_DONE' });
        if (String(task.approver_id) !== String(userId)) {
            throw Object.assign(new Error('该任务不属于当前使用者'), { code: 'FORBIDDEN' });
        }

        const [instances] = await conn.execute(
            'SELECT * FROM wf_instance WHERE id=? FOR UPDATE',
            [task.instance_id]
        );
        if (!instances.length) throw Object.assign(new Error('流程实例不存在'), { code: 'NOT_FOUND' });
        const instance = instances[0];
        if (instance.status !== 'PENDING') throw Object.assign(new Error('流程已结束'), { code: 'WF_DONE' });

        const approved = action === 'approve';
        await conn.execute(
            `UPDATE wf_task SET status=?, action_by=?, action_time=NOW(), comment=?
              WHERE id=?`,
            [approved ? 'APPROVED' : 'REJECTED', userId, comment || null, taskId]
        );
        // 同一步骤的其他候选人任务标记跳过
        await conn.execute(
            `UPDATE wf_task SET status='SKIPPED', action_by=?, action_time=NOW(), comment=?
              WHERE instance_id=? AND step_no=? AND id<>? AND status='PENDING'`,
            [userId, '同步骤已由他人处理', instance.id, task.step_no, taskId]
        );
        await conn.execute(
            'INSERT INTO wf_log (instance_id, step_no, action, operator_id, comment) VALUES (?,?,?,?,?)',
            [instance.id, task.step_no, approved ? 'APPROVE' : 'REJECT', userId, comment || null]
        );

        if (!approved) {
            await conn.execute(
                "UPDATE wf_task SET status='SKIPPED', action_by=?, action_time=NOW(), comment='流程驳回' WHERE instance_id=? AND status='PENDING'",
                [userId, instance.id]
            );
            await conn.execute(
                "UPDATE wf_instance SET status='REJECTED' WHERE id=?",
                [instance.id]
            );
            instance.status = 'REJECTED';
            await syncBusiness(conn, instance, 'REJECTED');
            await conn.commit();
            return { status: 'REJECTED' };
        }

        const [pending] = await conn.execute(
            "SELECT COUNT(*) AS cnt FROM wf_task WHERE instance_id=? AND step_no=? AND status='PENDING'",
            [instance.id, task.step_no]
        );
        if (Number(pending[0].cnt) > 0) {
            await conn.commit();
            return { status: 'PENDING', step: task.step_no };
        }

        const next = await openNextStep(conn, instance, task.step_no);
        await conn.commit();
        return next;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * 申请人撤回：流程置为 CANCELLED，单据回到草稿。
 */
async function cancelWorkflow({ instanceId, userId }) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [rows] = await conn.execute(
            'SELECT * FROM wf_instance WHERE id=? FOR UPDATE',
            [instanceId]
        );
        if (!rows.length) throw Object.assign(new Error('流程实例不存在'), { code: 'NOT_FOUND' });
        const instance = rows[0];
        if (String(instance.applicant_id) !== String(userId)) {
            throw Object.assign(new Error('只有申请人可以撤回'), { code: 'FORBIDDEN' });
        }
        if (instance.status !== 'PENDING') throw Object.assign(new Error('流程已结束，无法撤回'), { code: 'WF_DONE' });

        await conn.execute(
            "UPDATE wf_instance SET status='CANCELLED' WHERE id=?",
            [instance.id]
        );
        await conn.execute(
            "UPDATE wf_task SET status='SKIPPED', action_by=?, action_time=NOW(), comment='申请人撤回' WHERE instance_id=? AND status='PENDING'",
            [userId, instance.id]
        );
        await conn.execute(
            'INSERT INTO wf_log (instance_id, step_no, action, operator_id, comment) VALUES (?,?,?,?,?)',
            [instance.id, null, 'CANCEL', userId, '申请人撤回']
        );
        if (instance.business_type === 'EXPENSE') {
            await conn.execute(
                "UPDATE exp_report SET status='DRAFT', wf_instance_id=NULL WHERE id=?",
                [instance.business_id]
            );
        } else if (instance.business_type === 'PAYMENT') {
            await conn.execute(
                "UPDATE pay_request SET status='DRAFT', wf_instance_id=NULL WHERE id=?",
                [instance.business_id]
            );
        } else if (instance.business_type === 'PURCHASE') {
            await conn.execute(
                "UPDATE pr_request SET status='DRAFT', wf_instance_id=NULL WHERE id=?",
                [instance.business_id]
            );
        }
        await conn.commit();
        return { status: 'CANCELLED' };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

module.exports = {
    parseSteps,
    loadProcess,
    submitWorkflow,
    actOnTask,
    cancelWorkflow,
    resolveCandidates
};
