﻿﻿﻿﻿﻿﻿﻿/**
 * 2026年1月付款申请测试数据（覆盖 6 种状态）
 * 最小闭环：申请 → 审批 → 标记付款
 *
 * 使用：node scripts/seed_payment_202601.js [--clear]
 * --clear 仅清理本脚本生成的 PK202601 单据；生产环境禁止运行
 */
const { pool } = require('../config/db');

if (process.env.NODE_ENV === 'production') {
    console.error('❌ 测试数据脚本禁止在生产环境运行');
    process.exit(1);
}

const OWNERS = [
    { id: 'U0002', name: '李静怡',  dept: '采购部' },
    { id: 'U0003', name: '王佩珊',  dept: '采购部' },
    { id: 'U0006', name: '赵淑芬',  dept: '财务部' },
    { id: 'U0013', name: '黄伟豪',  dept: '采购部' },
    { id: 'U0017', name: '林伟豪',  dept: '业务部' },
    { id: 'S10049', name: 'george',  dept: '' },
    { id: 'rocky',  name: '戴清沛',  dept: '' }
];

// 覆盖 6 种状态各 2 笔
const PLANS = [
    // ===== DRAFT 草稿 =====
    { owner:'U0002',  day:5,  pay_type:'SUPPLIER', pay_target:'利騰科技', bu_no:'HM', items:[['利騰科技','INV20260105','2026-01-05','2026-01-20',128000]], status:'DRAFT' },
    { owner:'S10049', day:12, pay_type:'TAX',       pay_target:'國家稅務局', bu_no:'HM', items:[['國家稅務局','VAT202601','2026-01-10','2026-01-25',203792.20]], status:'DRAFT' },

    // ===== PENDING 审批中 =====
    { owner:'U0017', day:8,  pay_type:'RENT',      pay_target:'房租管理公司', bu_no:'HM', items:[['房租管理公司','RENT202601','2026-01-01','2026-01-15',124794]], status:'PENDING', waitStep:1, log:['SUBMIT'] },
    { owner:'U0003', day:14, pay_type:'SUPPLIER',  pay_target:'Ventec',       bu_no:'LD', items:[['Ventec','INVLD20260114','2026-01-12','2026-01-28',85600]], status:'PENDING', waitStep:2, log:['SUBMIT','APPROVE'] },

    // ===== APPROVED 已通过未付款 =====
    { owner:'U0006', day:3,  pay_type:'SALARY',    pay_target:'2026年1月薪資',  bu_no:'HM', items:[['薪資','PAY202601','2026-01-31','2026-02-05',850000]], status:'APPROVED', log:['SUBMIT','APPROVE','APPROVE'] },
    { owner:'U0013', day:16, pay_type:'SUPPLIER',  pay_target:'Ichia Materials', bu_no:'HM', items:[['Ichia','INVICH202601','2026-01-15','2026-01-30',268500]], status:'APPROVED', log:['SUBMIT','APPROVE','APPROVE'] },

    // ===== PAID 已付款 =====
    { owner:'U0002', day:2,  pay_type:'TAX',       pay_target:'勞動社會保障局', bu_no:'HM', items:[['勞保局','LB202601','2026-01-10','2026-01-25',156851.30]], status:'PAID', log:['SUBMIT','APPROVE','APPROVE','PAY'] },
    { owner:'U0003', day:9,  pay_type:'OTHER',     pay_target:'會議費用',        bu_no:'HM', items:[['會議中心','CONF202601','2026-01-08','2026-01-15',18500]], status:'PAID', log:['SUBMIT','APPROVE','APPROVE','PAY'] },

    // ===== REJECTED 已驳回 =====
    { owner:'S10049', day:4, pay_type:'OTHER',     pay_target:'員工福利-超標',   bu_no:'HM', items:[['','','2026-01-04','2026-01-10',50000]], status:'REJECTED', log:['SUBMIT','REJECT'] },
    { owner:'U0017', day:10, pay_type:'SUPPLIER',  pay_target:'未核實供應商',    bu_no:'HM', items:[['Unknown','INV20260110','2026-01-10','2026-01-20',98000]], status:'REJECTED', log:['SUBMIT','APPROVE','REJECT'] },

    // ===== CANCELLED 已撤回 =====
    { owner:'U0006', day:7,  pay_type:'RENT',      pay_target:'臨時取消-房租',   bu_no:'HM', items:[['房租管理','RENT202601C','2026-01-01','2026-01-15',124794]], status:'CANCELLED', log:['SUBMIT','CANCEL'] },
    { owner:'rocky', day:11, pay_type:'OTHER',     pay_target:'撤回重提-行政',   bu_no:'HM', items:[['行政支出','ADM202601','2026-01-11','2026-01-20',36000]], status:'CANCELLED', log:['SUBMIT','CANCEL'] }
];

function d(d, hh=9, mm=0) {
    return `2026-01-${String(d).padStart(2,'0')} ${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00`;
}

async function clearData(conn) {
    // 仅清理本脚本生成的 PK202601 单据及其审批轨迹，不影响其他数据
    const [rows] = await conn.query(
        `SELECT id, wf_instance_id FROM pay_request WHERE request_no LIKE 'PK202601%'`
    );
    if (!rows.length) return;

    const ids = rows.map(r => r.id);
    const instIds = rows.map(r => r.wf_instance_id).filter(Boolean);
    if (instIds.length) {
        await conn.query('DELETE FROM wf_log WHERE instance_id IN (?)', [instIds]);
        await conn.query('DELETE FROM wf_task WHERE instance_id IN (?)', [instIds]);
        await conn.query('DELETE FROM wf_instance WHERE id IN (?)', [instIds]);
    }
    await conn.query('DELETE FROM pay_request_item WHERE request_id IN (?)', [ids]);
    await conn.query('DELETE FROM pay_request WHERE id IN (?)', [ids]);
}

async function main() {
    const conn = await pool.getConnection();
    try {
        const args = process.argv.slice(2);
        if (args.includes('--clear')) {
            await clearData(conn);
            console.log('已清理本脚本生成的 PK202601 数据');
        }
        const [[cnt]] = await conn.query('SELECT (SELECT COUNT(*) FROM pay_request) c');
        if (cnt.c > 0) { console.error(`已有付款数据 ${cnt.c} 笔，加 --clear 重跑`); process.exit(1); }

        const [[proc]] = await conn.query(`SELECT steps_json FROM wf_process WHERE proc_code='PAYMENT_DEFAULT'`);
        if (!proc) { console.error('未找到 PAYMENT_DEFAULT 流程'); process.exit(1); }
        const steps = typeof proc.steps_json === 'string' ? JSON.parse(proc.steps_json) : proc.steps_json;

        let id = 0;
        for (const p of PLANS) {
            const owner = OWNERS.find(o => o.id === p.owner);
            const items = p.items || [];
            const total = items.reduce((s, r) => s + Number(r[4]), 0);
            id++;

            await conn.execute(`
                INSERT INTO pay_request
                    (request_no, applicant_id, applicant_name, dept, bu_no, pay_type, pay_target,
                     total_amount, currency, pay_method, due_date, remark,
                     status, wf_instance_id, submit_time, approve_time, pay_time, create_time)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [`PK202601${String(id).padStart(4,'0')}`, owner.id, owner.name, owner.dept,
                 p.bu_no, p.pay_type, p.pay_target, total, 'TWD', 'BANK',
                 items[0] && items[0][3] ? items[0][3] : null, '2026年1月付款測試資料',
                 p.status, null, null, null, null, d(p.day, 9, 0)]
            );
            const rid = (await conn.query('SELECT LAST_INSERT_ID() id'))[0][0].id;

            for (let i = 0; i < items.length; i++) {
                const it = items[i];
                await conn.execute(`
                    INSERT INTO pay_request_item
                        (request_id, item_no, supplier_name, pay_type, invoice_num, invoice_date,
                         should_date, amount, currency_ab, create_time)
                    VALUES (?,?,?,?,?,?,?,?,?,?)`,
                    [rid, i+1, it[0], p.pay_type, it[1], it[2], it[3], Number(it[4]), 'TWD', d(p.day, 9, 5 + i)]
                );
            }

            if (p.status !== 'DRAFT') {
                const logActions = p.log || [];
                const approvedUpTo = logActions.filter(a => a === 'APPROVE').length;
                const currentStep = p.waitStep || (p.status === 'APPROVED' || p.status === 'PAID' ? steps.length :
                    p.status === 'REJECTED' || p.status === 'CANCELLED' ? steps.length : 1);

                await conn.execute(`
                    INSERT INTO wf_instance
                        (proc_code, business_type, business_id, title, amount,
                         applicant_id, bu_no, dept, status, current_step, total_steps, create_time)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
                    ['PAYMENT_DEFAULT', 'PAYMENT', rid, p.pay_target, total, owner.id, p.bu_no, owner.dept,
                     p.status === 'PAID' ? 'APPROVED' : p.status, currentStep, steps.length, d(p.day, 10)]
                );
                const iid = (await conn.query('SELECT LAST_INSERT_ID() id'))[0][0].id;

                // 回写 wf_instance_id
                let approveTime = null, payTime = null;
                if (p.status === 'APPROVED' || p.status === 'PAID') approveTime = d(p.day, 14);
                if (p.status === 'PAID') payTime = d(p.day, 15);
                if (p.status === 'CANCELLED') await conn.execute('UPDATE pay_request SET wf_instance_id=?, status=?, pay_time=? WHERE id=?', [iid, 'CANCELLED', null, rid]);
                else if (p.status === 'REJECTED') await conn.execute('UPDATE pay_request SET wf_instance_id=?, status=? WHERE id=?', [iid, 'REJECTED', rid]);
                else if (p.status === 'PENDING') await conn.execute('UPDATE pay_request SET wf_instance_id=?, submit_time=? WHERE id=?', [iid, d(p.day, 10), rid]);
                else {
                    await conn.execute('UPDATE pay_request SET wf_instance_id=?, submit_time=?, approve_time=?, pay_time=? WHERE id=?', [iid, d(p.day, 10), approveTime, payTime, rid]);
                }

                // wf_task
                for (let s = 0; s < steps.length; s++) {
                    const stepNo = steps[s].step_no;
                    const approver = stepNo === 1 ? 'rocky' : 'awa';
                    let tStatus = 'PENDING', actionBy = null, actionTime = null;
                    if (s < approvedUpTo) { tStatus = 'APPROVED'; actionBy = approver; actionTime = d(p.day, 13 + s); }
                    else if (s === approvedUpTo) {
                        if (p.status === 'REJECTED' && logActions.indexOf('REJECT') === logActions.length - 1) {
                            tStatus = 'REJECTED'; actionBy = approver; actionTime = d(p.day, 16);
                        } else if (p.status === 'CANCELLED') { tStatus = 'SKIPPED'; }
                    } else {
                        tStatus = (p.status === 'REJECTED' || p.status === 'CANCELLED') ? 'SKIPPED' : 'PENDING';
                    }
                    await conn.execute(`
                        INSERT INTO wf_task
                            (instance_id, step_no, step_name, approver_id, status, action_by, action_time, create_time)
                        VALUES (?,?,?,?,?,?,?,?)`,
                        [iid, stepNo, steps[s].step_name, approver, tStatus, actionBy, actionTime,
                         tStatus === 'PENDING' ? d(p.day, 10) : (actionTime || d(p.day, 10))]
                    );
                }

                // wf_log
                let logStep = 0;
                for (const act of logActions) {
                    let sn = null, operator = null, comment = null;
                    if (act === 'SUBMIT') { sn = 0; operator = owner.id; comment = '付款申請提交'; }
                    else if (act === 'APPROVE') { sn = ++logStep; operator = sn === 1 ? 'rocky' : 'awa'; comment = '同意'; }
                    else if (act === 'REJECT') { sn = logStep || 1; operator = sn === 1 ? 'rocky' : 'awa'; comment = '資料需補充'; }
                    else if (act === 'CANCEL') { sn = 0; operator = owner.id; comment = '申請人撤回'; }
                    else if (act === 'PAY') { sn = 0; operator = 'admin'; comment = '財務標記付款'; }
                    await conn.execute(`
                        INSERT INTO wf_log (instance_id, step_no, action, operator_id, comment, create_time)
                        VALUES (?,?,?,?,?,?)`,
                        [iid, sn, act, operator, comment, d(p.day, 10 + logStep, act === 'PAY' ? 30 : 15)]
                    );
                    if (act !== 'APPROVE') logStep++;
                }
            }
        }

        const [[a]] = await conn.query(`SELECT (SELECT COUNT(*) FROM pay_request) r,
            (SELECT COUNT(*) FROM pay_request_item) i,
            (SELECT COUNT(*) FROM wf_instance WHERE business_type='PAYMENT') inst,
            (SELECT COUNT(*) FROM wf_task WHERE instance_id IN (SELECT id FROM wf_instance WHERE business_type='PAYMENT')) tsk,
            (SELECT COUNT(*) FROM wf_log WHERE instance_id IN (SELECT id FROM wf_instance WHERE business_type='PAYMENT')) log`);
        console.log('✅ 付款测试数据生成完成:', JSON.stringify(a));

        const [sum] = await conn.query(`SELECT status, COUNT(*) cnt FROM pay_request GROUP BY status`);
        console.log('状态分布:', sum.map(r => `${r.status}×${r.cnt}`).join('  '));
    } catch (e) { console.error('❌ 失败:', e.message); process.exit(1); }
    finally { conn.release(); }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
