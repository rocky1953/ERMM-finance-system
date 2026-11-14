/**
 * 采购申请审批闭环
 * DRAFT → PENDING → APPROVED → PO_CREATED / REJECTED / CANCELLED
 * 审批通过后自动写入 ermm_erp_po
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const workflow = require('../services/workflow');

function genPrNo() {
    const d = new Date();
    return `PR${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
}
function genPoNo() {
    const d = new Date();
    return `PO${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
}

// ====== 供应商 ======
router.get('/suppliers', async (req, res) => {
    try {
        const { bu_no, q } = req.query;
        let sql = `SELECT relation_id, relation_name, contact_person, contact_phone, tax_id, bu_no
                   FROM relation_detail WHERE relation_type='供应商' AND inuse_flag='USE'`;
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (q) { sql += ' AND (relation_id LIKE ? OR relation_name LIKE ?)'; const p=`%${q}%`; params.push(p,p); }
        sql += ' ORDER BY relation_name LIMIT 200';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ====== 列表 ======
router.get('/', async (req, res) => {
    try {
        const { scope='mine', status, bu_no, keyword } = req.query;
        const u = req.user;
        const isAdmin = String(u.admin || '').trim() === 'Yes';
        const isManager = u.user_type && ['部门主管','部門主管','高阶主管','高階主管'].includes(String(u.user_type).replace(/\s/g,''));

        let sql = `SELECT r.* FROM pr_request r WHERE 1=1`;
        const params = [];
        if (scope === 'all') {
            if (!isAdmin && !isManager) return fail(res, '无权查看全部', 403);
        } else {
            sql += ' AND r.applicant_id=?'; params.push(u.user_id);
        }
        if (status) { sql += ' AND r.status=?'; params.push(status); }
        if (bu_no) { sql += ' AND r.bu_no=?'; params.push(bu_no); }
        if (keyword) {
            sql += ' AND (r.pr_no LIKE ? OR r.purpose LIKE ? OR r.supplier_name LIKE ?)';
            const k = `%${keyword}%`; params.push(k,k,k);
        }
        sql += ' ORDER BY r.create_time DESC LIMIT 500';
        const [rows] = await pool.execute(sql, params);

        if (rows.length) {
            const ids = rows.map(r => r.id);
            const [items] = await pool.execute(
                `SELECT * FROM pr_request_item WHERE request_id IN (${ids.map(()=>'?').join(',')}) ORDER BY request_id, item_no`,
                ids
            );
            const itemMap = {};
            for (const it of items) (itemMap[it.request_id] = itemMap[it.request_id] || []).push(it);
            const [tasks] = await pool.execute(
                `SELECT t.instance_id, t.approver_id FROM wf_task t
                  JOIN wf_instance i ON i.id=t.instance_id
                 WHERE t.status='PENDING' AND i.business_type='PURCHASE'`
            );
            const pendMap = {};
            for (const t of tasks) (pendMap[t.instance_id] = pendMap[t.instance_id] || []).push(t.approver_id);
            for (const r of rows) {
                r.items = itemMap[r.id] || [];
                r.waiting_for = pendMap[r.wf_instance_id] || [];
            }
        }
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ====== 详情 ======
router.get('/:id', async (req, res) => {
    try {
        const u = req.user;
        const [rows] = await pool.execute('SELECT * FROM pr_request WHERE id=?', [req.params.id]);
        if (!rows.length) return fail(res, '不存在', 404);
        const row = rows[0];
        const isOwner = row.applicant_id === u.user_id;
        const isAdmin = String(u.admin || '').trim() === 'Yes';
        let isApprover = false;
        if (row.wf_instance_id) {
            const [t] = await pool.execute(
                'SELECT id FROM wf_task WHERE instance_id=? AND approver_id=? AND status="PENDING"',
                [row.wf_instance_id, u.user_id]
            );
            isApprover = t.length > 0;
        }
        if (!isOwner && !isAdmin && !isApprover) return fail(res, '无权查看', 403);

        const [items] = await pool.execute('SELECT * FROM pr_request_item WHERE request_id=? ORDER BY item_no', [row.id]);
        row.items = items;
        row._canEdit = isOwner && ['DRAFT','REJECTED'].includes(row.status);
        row._canSubmit = isOwner && row.status === 'DRAFT';
        row._canCancel = isOwner && row.status === 'PENDING';
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
        if (!items.length) return fail(res, '至少 1 条明细', 400);

        let total = 0;
        for (const it of items) {
            const qty = Number(it.qty) || 0;
            const up = Number(it.unit_price) || 0;
            it.amount = Number(it.amount) || Math.round(qty * up * 100) / 100;
            total += it.amount;
        }
        if (total <= 0) return fail(res, '合计必须大于 0', 400);

        const [cnt] = await conn.execute(
            'SELECT COUNT(*) c FROM pr_request WHERE pr_no LIKE ?',
            [`${genPrNo()}%`]
        );
        const prNo = `${genPrNo()}${String(cnt[0].c + 1).padStart(4,'0')}`;

        await conn.beginTransaction();
        const [ur] = await conn.execute(
            `INSERT INTO pr_request
                (pr_no, applicant_id, applicant_name, dept, bu_no, supplier_id, supplier_name,
                 pr_type, purpose, total_amount, currency, need_by_date, remark, status)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'DRAFT')`,
            [prNo, u.user_id, u.user_name || u.user_id, d.dept || '',
             d.bu_no, d.supplier_id || null, d.supplier_name,
             d.pr_type || 'MATERIAL', d.purpose || '', total,
             d.currency || 'TWD', d.need_by_date || null, d.remark || '']
        );
        const rid = ur.insertId;
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            await conn.execute(
                `INSERT INTO pr_request_item
                    (request_id, item_no, xitems, item_name, qty, unit, unit_price, amount, need_by_date, remark)
                 VALUES (?,?,?,?,?,?,?,?,?,?)`,
                [rid, i+1, it.xitems || null, it.item_name || '',
                 Number(it.qty) || 0, it.unit || null, Number(it.unit_price) || 0,
                 Number(it.amount) || 0, it.need_by_date || null, it.remark || null]
            );
        }
        await conn.commit();
        ok(res, { id: rid, pr_no: prNo, total_amount: total, status: 'DRAFT' }, '采购申请单已创建');
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally { conn.release(); }
});

// ====== 编辑 ======
router.put('/:id', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const d = req.body;
        const u = req.user;
        const [rows] = await pool.execute('SELECT * FROM pr_request WHERE id=?', [req.params.id]);
        if (!rows.length) return fail(res, '不存在', 404);
        const row = rows[0];
        if (row.applicant_id !== u.user_id) return fail(res, '仅申请人可编辑', 403);
        if (!['DRAFT', 'REJECTED'].includes(row.status)) return fail(res, `状态 ${row.status} 不可编辑`, 400);

        const items = Array.isArray(d.items) ? d.items : [];
        let total = 0;
        for (const it of items) {
            const qty = Number(it.qty) || 0, up = Number(it.unit_price) || 0;
            it.amount = Number(it.amount) || Math.round(qty * up * 100) / 100;
            total += it.amount;
        }
        if (total <= 0) return fail(res, '合计必须大于 0', 400);

        await conn.beginTransaction();
        await conn.execute(
            `UPDATE pr_request SET supplier_id=?, supplier_name=?, pr_type=?, purpose=?,
                total_amount=?, currency=?, need_by_date=?, remark=?,
                status='DRAFT', wf_instance_id=NULL, submit_time=NULL, approve_time=NULL, po_uid=NULL, po_id=NULL
             WHERE id=?`,
            [d.supplier_id || null, d.supplier_name, d.pr_type || row.pr_type, d.purpose || '',
             total, d.currency || row.currency, d.need_by_date || null, d.remark || '', req.params.id]
        );
        await conn.execute('DELETE FROM pr_request_item WHERE request_id=?', [req.params.id]);
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            await conn.execute(
                `INSERT INTO pr_request_item (request_id, item_no, xitems, item_name, qty, unit, unit_price, amount, need_by_date, remark)
                 VALUES (?,?,?,?,?,?,?,?,?,?)`,
                [req.params.id, i+1, it.xitems || null, it.item_name || '',
                 Number(it.qty) || 0, it.unit || null, Number(it.unit_price) || 0,
                 Number(it.amount) || 0, it.need_by_date || null, it.remark || null]
            );
        }
        await conn.commit();
        ok(res, null, '已更新');
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally { conn.release(); }
});

// ====== 删除 ======
router.delete('/:id', async (req, res) => {
    try {
        const u = req.user;
        const [rows] = await pool.execute('SELECT * FROM pr_request WHERE id=?', [req.params.id]);
        if (!rows.length) return fail(res, '不存在', 404);
        if (rows[0].applicant_id !== u.user_id) return fail(res, '仅申请人可删除', 403);
        if (rows[0].status !== 'DRAFT') return fail(res, '仅草稿可删除', 400);
        await pool.execute('DELETE FROM pr_request WHERE id=?', [req.params.id]);
        ok(res, null, '已删除');
    } catch (err) { fail500(res, err); }
});

// ====== 提交审批 ======
router.post('/:id/submit', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const u = req.user;
        const [rows] = await pool.execute('SELECT * FROM pr_request WHERE id=?', [req.params.id]);
        if (!rows.length) return fail(res, '不存在', 404);
        const row = rows[0];
        if (row.applicant_id !== u.user_id) return fail(res, '仅申请人可提交', 403);
        if (!['DRAFT', 'REJECTED', 'CANCELLED'].includes(row.status))
            return fail(res, `状态 ${row.status} 不可提交`, 400);
        const [items] = await pool.execute('SELECT * FROM pr_request_item WHERE request_id=?', [row.id]);
        if (!items.length) return fail(res, '无明细行', 400);
        const total = items.reduce((s, it) => s + Number(it.amount), 0);

        await conn.beginTransaction();
        const ctx = {
            conn, businessType: 'PURCHASE', businessId: row.id,
            title: row.pr_no + ' ' + (row.purpose || row.supplier_name || ''),
            amount: total, applicantId: u.user_id, applicantName: u.user_name,
            buNo: row.bu_no, dept: row.dept, procCode: 'PR_DEFAULT'
        };
        let wf;
        try { wf = await workflow.submitWorkflow(conn, ctx); }
        catch (we) {
            await conn.rollback();
            if (we.code === 'WF_NO_APPROVER') return fail(res, '无法匹配审批人，请联系管理员', 400);
            if (we.code === 'WF_NO_PROCESS') return fail(res, '采购流程未配置', 400);
            throw we;
        }

        await conn.execute(
            'UPDATE pr_request SET total_amount=?, wf_instance_id=?, status=?, submit_time=? WHERE id=?',
            [total, wf.instanceId, wf.status, new Date(), row.id]
        );
        await conn.execute(
            'INSERT INTO wf_log (instance_id, step_no, action, operator_id, comment, create_time) VALUES (?,0,"SUBMIT",?,?,NOW())',
            [wf.instanceId, u.user_id, `${row.pr_no} 采购申请提交`]
        );
        await conn.commit();

        const approverNames = (wf.approvers || []).map(a => a.user_name || a.user_id).join('、');
        const msg = wf.status === 'APPROVED' ? '已自动通过'
            : approverNames ? `已提交给 ${approverNames} 审批` : '已提交审批';
        ok(res, { status: wf.status, instance_id: wf.instanceId, approvers: wf.approvers || [] }, msg);
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally { conn.release(); }
});

// ====== 生成 PO（审批通过后调用，或手动触发）======
router.post('/:id/generate-po', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const u = req.user;
        const [rows] = await pool.execute('SELECT * FROM pr_request WHERE id=?', [req.params.id]);
        if (!rows.length) return fail(res, '不存在', 404);
        const row = rows[0];
        if (row.status !== 'APPROVED') return fail(res, `状态 ${row.status} 不可生成 PO`, 400);
        if (row.po_uid) return fail(res, '已生成 PO', 400);

        const [items] = await pool.execute('SELECT * FROM pr_request_item WHERE request_id=?', [row.id]);
        if (!items.length) return fail(res, '无明细', 400);

        await conn.beginTransaction();
        // 每明细一行 PO（简化处理）
        const [[poCnt]] = await conn.execute('SELECT COUNT(*) c FROM ermm_erp_po WHERE po_id LIKE ?', [`${genPoNo()}%`]);
        let no = 0;
        let firstUid = null;
        for (const it of items) {
            no++;
            const poId = `${genPoNo()}${String(Number(poCnt.c) + no).padStart(4,'0')}`;
            const poDate = (row.need_by_date ? String(row.need_by_date).substring(0,10) : new Date().toISOString().substring(0,10));
            await conn.execute(
                `INSERT INTO ermm_erp_po
                    (bu_no, po_id, supplier_name, xitems, po_date, po_qty, unit_price, unit_price_local,
                     exchange_rate, po_amount, po_amount_local, vat_amt, YYYY, MM, YYYY_MM, po_status, supplier_type)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, '未审核', ?)`,
                [row.bu_no, poId, row.supplier_name, it.xitems || it.item_name || '',
                 poDate, Number(it.qty) || 0, Number(it.unit_price) || 0, Number(it.unit_price) || 0,
                 1, Number(it.amount) || 0, Number(it.amount) || 0, 0,
                 poDate.substring(0,4), poDate.substring(5,7), poDate.substring(0,7),
                 '物料']
            );
            if (!firstUid) firstUid = (await conn.execute('SELECT LAST_INSERT_ID() id'))[0][0].id;
        }
        await conn.execute(
            'UPDATE pr_request SET status="PO_CREATED", po_uid=?, po_id=?, approve_time=NOW() WHERE id=?',
            [firstUid, `${genPoNo()}${String(Number(poCnt.c) + 1).padStart(4,'0')}`, row.id]
        );
        if (row.wf_instance_id) {
            await conn.execute(
                'INSERT INTO wf_log (instance_id, step_no, action, operator_id, comment, create_time) VALUES (?,0,"GEN_PO",?,?,NOW())',
                [row.wf_instance_id, u.user_id, '审批通过，已自动生成 PO']
            );
        }
        await conn.commit();
        ok(res, { po_uid: firstUid, po_id: `${genPoNo()}${String(Number(poCnt.c) + 1).padStart(4,'0')}` }, `已生成 ${items.length} 笔 PO`);
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally { conn.release(); }
});

module.exports = router;
