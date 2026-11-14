﻿﻿﻿﻿﻿﻿﻿/**
 * 生成 2026 年 1 月份费用报销与审批中心测试数据
 *
 * 覆盖：
 *  - 6 种状态：DRAFT / PENDING / APPROVED / PAID / REJECTED / CANCELLED
 *  - 多名申请人 / 多家公司 / 多种费用类型
 *  - 完整审批轨迹（wf_instance / wf_task / wf_log / exp_report / exp_report_item）
 *
 * 使用：node scripts/seed_expense_202601.js [--clear]
 * --clear 仅清理本脚本生成的 BX202601 单据；生产环境禁止运行
 */
const { pool } = require('../config/db');

if (process.env.NODE_ENV === 'production') {
    console.error('❌ 测试数据脚本禁止在生产环境运行');
    process.exit(1);
}

const OWNERS = [
    // 有部门的真实用户，用于 dept_manager 路径
    { id: 'U0002', name: '李静怡', dept: '采购部',     type: 'TRANSPORT',  bu: 'HM' },
    { id: 'U0003', name: '王佩珊', dept: '采购部',     type: 'ENTERTAIN',  bu: 'HM' },
    { id: 'U0006', name: '赵淑芬', dept: '财务部',     type: 'OFFICE',     bu: 'HM' },
    { id: 'U0013', name: '黄伟豪', dept: '采购部',     type: 'TRAVEL',     bu: 'LD' },
    { id: 'U0017', name: '林伟豪', dept: '业务部',     type: 'TRAVEL',     bu: 'HM' },
    { id: 'S10049', name: 'george', dept: '',          type: 'OTHER',      bu: 'HM' },
    { id: 'rocky',  name: '戴清沛', dept: '',          type: 'OFFICE',     bu: 'HM' }
];

// 审批人
const ADMINS = ['rocky', 'awa'];

// 待生成的单据定义（12 笔，覆盖 6 种状态各 2 笔）
const PLANS = [
    // ===== DRAFT 草稿（2 笔）=====
    { owner: 'U0002', day: 5,  type: 'TRANSPORT', title: '1月计程车与高铁费', items: [['2026-01-05','TRANSPORT','台北-桃园高铁','345.00'],['2026-01-06','TRANSPORT','计程车','120.00']], status: 'DRAFT' },
    { owner: 'S10049', day: 12, type: 'OFFICE',    title: '办公用品采购（未提交）', items: [['2026-01-12','OFFICE','A4纸x10箱','2800.00'],['2026-01-12','OFFICE','便签','150.00']], status: 'DRAFT' },

    // ===== PENDING 审批中（2 笔）=====
    { owner: 'U0017', day: 8,  type: 'TRAVEL',     title: '业务部主管1月出差-台中', items: [['2026-01-08','TRAVEL','高铁','720.00'],['2026-01-08','TRAVEL','住宿','2800.00'],['2026-01-09','TRAVEL','餐饮','680.00']], status: 'PENDING', waitStep: 1, waitApprover: 'rocky', log: ['SUBMIT'] },
    { owner: 'U0003', day: 14, type: 'ENTERTAIN',  title: '客户聚餐-利腾科技', items: [['2026-01-14','ENTERTAIN','火锅聚餐','3580.00'],['2026-01-14','ENTERTAIN','停车','60.00']], status: 'PENDING', waitStep: 2, waitApprover: 'rocky', log: ['SUBMIT','APPROVE'] },

    // ===== APPROVED 已通过未付款（2 笔）=====
    { owner: 'U0006', day: 3,  type: 'OFFICE',     title: '财务部打印耗材1月', items: [['2026-01-03','OFFICE','硒鼓x3','7200.00']], status: 'APPROVED', log: ['SUBMIT','APPROVE','APPROVE'] },
    { owner: 'U0013', day: 16, type: 'TRAVEL',     title: '采购部-香港出差', items: [['2026-01-16','TRAVEL','机票','22500.00'],['2026-01-17','TRAVEL','住宿(2晚)','8600.00']], status: 'APPROVED', log: ['SUBMIT','APPROVE','APPROVE'] },

    // ===== PAID 已付款（2 笔）=====
    { owner: 'U0002', day: 2,  type: 'TRANSPORT',  title: '1月出差交通费', items: [['2026-01-02','TRANSPORT','高铁','300.00'],['2026-01-02','TRANSPORT','计程车','180.00']], status: 'PAID', log: ['SUBMIT','APPROVE','APPROVE','PAY'] },
    { owner: 'U0003', day: 9,  type: 'ENTERTAIN',  title: '业务聚餐1月初', items: [['2026-01-09','ENTERTAIN','烧烤','2400.00']], status: 'PAID', log: ['SUBMIT','APPROVE','APPROVE','PAY'] },

    // ===== REJECTED 已驳回（2 笔）=====
    { owner: 'S10049', day: 4, type: 'OTHER',      title: '员工福利申请-不予通过', items: [['2026-01-04','OTHER','节日红包','5000.00']], status: 'REJECTED', log: ['SUBMIT','REJECT'] },
    { owner: 'U0017', day: 10, type: 'ENTERTAIN',  title: '超标招待-驳回', items: [['2026-01-10','ENTERTAIN','豪华餐厅','12800.00']], status: 'REJECTED', log: ['SUBMIT','APPROVE','REJECT'] },

    // ===== CANCELLED 申请人撤回（2 笔）=====
    { owner: 'U0006', day: 7,  type: 'OFFICE',     title: '临时取消-撤回申请', items: [['2026-01-07','OFFICE','文件夹','320.00']], status: 'CANCELLED', log: ['SUBMIT','CANCEL'] },
    { owner: 'rocky', day: 11, type: 'OFFICE',     title: '行政主管-撤回重提', items: [['2026-01-11','OFFICE','会议资料','650.00']], status: 'CANCELLED', log: ['SUBMIT','CANCEL'] }
];

function d(d, hh = 9, mm = 0) {
    return `2026-01-${String(d).padStart(2, '0')} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
}

async function clearData(conn) {
    // 仅清理本脚本生成的 BX202601 单据及其审批轨迹，不影响其他数据
    const [reports] = await conn.query(
        `SELECT id, wf_instance_id FROM exp_report WHERE report_no LIKE 'BX202601%'`
    );
    if (!reports.length) return;

    const reportIds = reports.map(r => r.id);
    const instIds = reports.map(r => r.wf_instance_id).filter(Boolean);
    if (instIds.length) {
        await conn.query('DELETE FROM wf_log WHERE instance_id IN (?)', [instIds]);
        await conn.query('DELETE FROM wf_task WHERE instance_id IN (?)', [instIds]);
        await conn.query('DELETE FROM wf_instance WHERE id IN (?)', [instIds]);
    }
    await conn.query('DELETE FROM exp_report_item WHERE report_id IN (?)', [reportIds]);
    await conn.query('DELETE FROM exp_report WHERE id IN (?)', [reportIds]);
}

async function main() {
    const conn = await pool.getConnection();
    try {
        const args = process.argv.slice(2);
        if (args.includes('--clear')) {
            await clearData(conn);
            console.log('已清理本脚本生成的 BX202601 数据');
        } else {
            const [[cnt]] = await conn.query(`SELECT (SELECT COUNT(*) FROM exp_report) exp, (SELECT COUNT(*) FROM wf_instance) inst, (SELECT COUNT(*) FROM wf_task) task`);
            if (cnt.exp > 0 || cnt.inst > 0) {
                console.error(`⚠️ 检测到已有数据: exp=${cnt.exp} inst=${cnt.inst} task=${cnt.task}`);
                console.error('如需清空再生成，请加 --clear 参数运行');
                process.exit(1);
            }
        }

        const [[proc]] = await conn.query(`SELECT steps_json FROM wf_process WHERE proc_code='EXPENSE_DEFAULT' LIMIT 1`);
        if (!proc) { console.error('未找到 EXPENSE_DEFAULT 流程，请先执行 021 迁移'); process.exit(1); }
        const steps = typeof proc.steps_json === 'string' ? JSON.parse(proc.steps_json) : proc.steps_json;

        let reportId = 0;
        let instId = 0;

        for (const plan of PLANS) {
            const owner = OWNERS.find(o => o.id === plan.owner);
            if (!owner) { console.error('未知 owner', plan.owner); continue; }
            const bu = plan.bu || owner.bu;
            const expenseType = plan.type || owner.type;

            // ---- exp_report ----
            const totalAmount = plan.items.reduce((s, r) => s + parseFloat(r[3]), 0);
            const reportNo = `BX202601${String(++reportId).padStart(4, '0')}`;
            const reportCreateAt = d(plan.day, 9, 30);
            const submitAt = plan.status !== 'DRAFT' ? d(plan.day, 10, 15) : null;
            const approveAt  = plan.status === 'APPROVED' || plan.status === 'PAID' ? d(plan.day, 14, 0) : null;
            const payAt      = plan.status === 'PAID' ? d(plan.day, 15, 30) : null;
            const wfInsId    = plan.status !== 'DRAFT' ? ++instId : null;

            await conn.execute(`
                INSERT INTO exp_report
                (report_no, applicant_id, applicant_name, dept, bu_no, expense_type, title, remark,
                 wf_instance_id, status, submit_time, approve_time, pay_time, create_time, update_time)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [reportNo, owner.id, owner.name, owner.dept, bu, expenseType, plan.title,
                 plan.remark || '2026年1月测试数据',
                 wfInsId, plan.status, submitAt, approveAt, payAt, reportCreateAt, reportCreateAt]
            );
            const expId = (await conn.execute('SELECT LAST_INSERT_ID() id'))[0][0].id;

            // ---- exp_report_item ----
            for (let i = 0; i < plan.items.length; i++) {
                const row = plan.items[i];
                const it = parseFloat(row[3]);
                await conn.execute(`
                    INSERT INTO exp_report_item
                    (report_id, expense_date, category, description, amount, invoice_no, tax_amount, create_time)
                    VALUES (?,?,?,?,?,?,?,?)`,
                    [expId, row[0], row[1], row[2], it, `INV-202601-${reportId}-${i+1}`, 0, d(plan.day, 9, 40 + i)]
                );
            }

            // ---- wf_instance + wf_task + wf_log（非 DRAFT 才有）----
            if (plan.status !== 'DRAFT') {
                const currentStep = plan.waitStep
                    || (plan.status === 'APPROVED' || plan.status === 'PAID' ? steps.length
                        : plan.status === 'REJECTED' || plan.status === 'CANCELLED' ? steps.length
                            : 1);

                await conn.execute(`
                    INSERT INTO wf_instance
                    (proc_code, business_type, business_id, title, amount,
                     applicant_id, bu_no, dept, status, current_step, total_steps,
                     create_time, update_time)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                    ['EXPENSE_DEFAULT', 'EXPENSE', expId, plan.title, totalAmount,
                     owner.id, bu, owner.dept, plan.status, currentStep, steps.length,
                     submitAt, submitAt]
                );
                const instanceId = (await conn.execute('SELECT LAST_INSERT_ID() id'))[0][0].id;

                // 处理每一步：按 plan.log 动作历史和 plan.waitStep 构建
                // log: ['SUBMIT'] 待 step 1 审批；['SUBMIT','APPROVE'] 待 step 2；
                //      ['SUBMIT','APPROVE','APPROVE'] 已完成 → 全部 APPROVED
                //      ['SUBMIT','APPROVE','REJECT'] 驳回
                //      ['SUBMIT','REJECT'] 驳回
                //      ['SUBMIT','CANCEL'] 撤回
                //      ['SUBMIT','APPROVE','APPROVE','PAY'] 已付款（实例本身应是 APPROVED，PAY 写入 wf_log）

                const logActions = plan.log || [];
                // 每一步的审批人（简化：step 1 用 rocky，step 2 用 awa）
                const stepApprover = (stepNo) => stepNo === 1 ? 'rocky' : 'awa';
                const stepApproverName = (stepNo) => stepNo === 1 ? '戴清沛' : 'awa';

                // 生成 wf_task：遍历所有步骤，确定最终状态
                for (let s = 0; s < steps.length; s++) {
                    const stepNo = steps[s].step_no;
                    const approver = stepApprover(stepNo);
                    let taskStatus = 'PENDING';
                    let actionBy = null, actionTime = null, comment = null;

                    // 从 logActions 推断这步是否已处理
                    // SUBMIT(step 0 无) → step 1 PENDING
                    // APPROVE → 对应已处理步
                    // REJECT / CANCEL → 当前步或上一步被处理，后续 SKIPPED
                    const approvedUpTo = logActions.filter(a => a === 'APPROVE').length;
                    const rejectAt = logActions.indexOf('REJECT');
                    const cancelAt = logActions.indexOf('CANCEL');
                    const isRejected = rejectAt !== -1;
                    const isCancel   = cancelAt !== -1;

                    if (s < approvedUpTo) {
                        taskStatus = 'APPROVED';
                        actionBy = approver;
                        actionTime = d(plan.day, 13 + s, 10);
                        comment = '同意';
                    } else if (s === approvedUpTo) {
                        if (isRejected && rejectAt === logActions.length - 1) {
                            taskStatus = 'REJECTED';
                            actionBy = approver;
                            actionTime = d(plan.day, 16, 0);
                            comment = logActions.includes('ENTERTAIN') ? '金额超标，请重走流程' : '资料不全，需补充';
                        } else if (isCancel) {
                            taskStatus = 'SKIPPED';
                            actionBy = null;
                            actionTime = null;
                        } else if (s + 1 === plan.waitStep) {
                            // 刚好是等待的那一步
                            taskStatus = 'PENDING';
                        } else {
                            taskStatus = 'PENDING';
                        }
                    } else {
                        taskStatus = isRejected ? 'SKIPPED' : 'PENDING';
                    }

                    await conn.execute(`
                        INSERT INTO wf_task
                        (instance_id, step_no, step_name, approver_id,
                         status, action_by, action_time, comment, create_time)
                        VALUES (?,?,?,?,?,?,?,?,?)`,
                        [instanceId, stepNo, steps[s].step_name, approver,
                         taskStatus, actionBy, actionTime, comment,
                         taskStatus === 'PENDING' ? submitAt : (actionTime || submitAt)]
                    );
                }

                // ---- wf_log ----
                let logStep = 0;
                for (const act of logActions) {
                    const hh = 10 + logStep;   // 10 点提交 / 13 点审批 / 14 点 2nd / 15 点付款
                    let stepNo = null, comment = null, operatorId = null;
                    if (act === 'SUBMIT') { stepNo = 0; comment = '申请人提交'; operatorId = owner.id; }
                    else if (act === 'APPROVE') { stepNo = ++logStep; comment = '同意'; operatorId = stepApprover(stepNo); }
                    else if (act === 'REJECT') { stepNo = logStep || 1; comment = '资料不全，需补充'; operatorId = stepApprover(stepNo); }
                    else if (act === 'CANCEL') { stepNo = 0; comment = '申请人撤回'; operatorId = owner.id; }
                    else if (act === 'PAY') { stepNo = 0; comment = '财务付款'; operatorId = 'admin'; }

                    await conn.execute(`
                        INSERT INTO wf_log (instance_id, step_no, action, operator_id, comment, create_time)
                        VALUES (?,?,?,?,?,?)`,
                        [instanceId, stepNo, act, operatorId, comment, d(plan.day, hh, act === 'PAY' ? 30 : 15)]
                    );
                    if (act !== 'APPROVE') logStep++;
                }
            }
        }

        const [[cnt]] = await pool.query(`SELECT (SELECT COUNT(*) FROM exp_report) exp,
            (SELECT COUNT(*) FROM exp_report_item) item,
            (SELECT COUNT(*) FROM wf_instance) inst,
            (SELECT COUNT(*) FROM wf_task) task,
            (SELECT COUNT(*) FROM wf_log) log`);
        console.log('✅ 生成完成:', JSON.stringify(cnt));

        const [expSummary] = await pool.query(`SELECT status, COUNT(*) cnt FROM exp_report GROUP BY status`);
        console.log('费用报销状态分布:', expSummary.map(r => `${r.status}×${r.cnt}`).join('  '));

        const [wfSummary] = await pool.query(`SELECT status, COUNT(*) cnt FROM wf_instance GROUP BY status`);
        console.log('审批实例状态分布:', wfSummary.map(r => `${r.status}×${r.cnt}`).join('  '));

    } catch (err) {
        console.error('❌ 生成失败:', err.message);
        throw err;
    } finally {
        conn.release();
    }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
