/**
 * 付款申請路由（最小閉環）
 * DRAFT → PENDING → APPROVED → PAID / REJECTED / CANCELLED
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const workflow = require('../services/workflow');
const audit = require('../services/audit');

const { perms, readScope } = require('../middleware/perms');
// ====== 工具 ======
function genRequestNo() {
    const d = new Date();
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `PK${yy}${mm}`;
}

// JWT 只带 user_id / admin，主管判断需回查人员主档
async function isFinanceOrManager(u) {
    if (String(u.admin || '').trim() === 'Yes') return true;
    const [rows] = await pool.execute(
        'SELECT xuser_type FROM cams_xuser WHERE xuser_id=? LIMIT 1', [u.user_id]);
    const t = String((rows[0] && rows[0].xuser_type) || '').replace(/\s/g, '');
    return ['部门主管', '部門主管', '部门经理', '部門經理', '高阶主管', '高階主管'].includes(t);
}

// =====================================================================
// 付款排程 / 银行回单 / AR·AP 核销（CFO-02）
// =====================================================================

// 排程日历（按计划付款月）
router.get('/schedule', async (req, res) => {
    try {
        const u = req.user;
        if (!(await isFinanceOrManager(u))) return fail(res, '无权查看付款排程', 403);
        const month = /^\d{4}-\d{2}$/.test(String(req.query.month || ''))
            ? req.query.month : new Date().toISOString().slice(0, 7);

        let sql = `SELECT r.id, r.request_no, r.pay_target, r.pay_type, r.total_amount, r.currency,
                          r.status, r.planned_pay_date, r.due_date, r.bank_receipt_no,
                          r.receipt_date, r.receipt_amount, r.writeoff_status,
                          u.xuser_name AS applicant_name
                     FROM pay_request r
                     LEFT JOIN cams_xuser u ON u.xuser_id=r.applicant_id
                    WHERE r.planned_pay_date IS NOT NULL
                      AND DATE_FORMAT(r.planned_pay_date,'%Y-%m')=?`;
        const params = [month];
        if (req.query.bu_no) { sql += ' AND r.bu_no=?'; params.push(req.query.bu_no); }
        sql += ' ORDER BY r.planned_pay_date, r.id';
        const [rows] = await pool.execute(sql, params);

        const summary = rows.reduce((s, r) => {
            const amt = Number(r.total_amount) || 0;
            s.count += 1;
            s.amount += amt;
            if (r.status === 'PAID') { s.paid_count += 1; s.paid_amount += amt; }
            else { s.pending_count += 1; s.pending_amount += amt; }
            return s;
        }, { count: 0, amount: 0, paid_count: 0, paid_amount: 0, pending_count: 0, pending_amount: 0 });
        ok(res, { month, summary, rows });
    } catch (err) { fail500(res, err); }
});

// 可核销的 AR/AP 发票（未付清）
router.get('/writeoff-sources', async (req, res) => {
    try {
        const u = req.user;
        if (!(await isFinanceOrManager(u))) return fail(res, '无权查看核销来源', 403);
        const type = String(req.query.source_type || 'AP').toUpperCase() === 'AR' ? 'AR' : 'AP';
        let sql = `SELECT uid, bu_no, TX_type, order_id, client_id, invoice_no, sub_amt, payment,
                          (sub_amt - payment) AS open_amount, wk_date, YYYY_MM
                     FROM mgm_invoice_details
                    WHERE TX_type=? AND sub_amt > payment`;
        const params = [type];
        if (req.query.bu_no) { sql += ' AND bu_no=?'; params.push(req.query.bu_no); }
        if (req.query.keyword) {
            sql += ' AND (invoice_no LIKE ? OR client_id LIKE ? OR order_id LIKE ?)';
            const k = `%${req.query.keyword}%`;
            params.push(k, k, k);
        }
        sql += ' ORDER BY wk_date DESC LIMIT 200';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// 设定排程付款日
router.put('/:id/schedule', async (req, res) => {
    try {
        const u = req.user;
        if (!(await isFinanceOrManager(u))) return fail(res, '无权设定付款排程', 403);
        const planned = req.body.planned_pay_date;
        if (!planned || !/^\d{4}-\d{2}-\d{2}$/.test(String(planned))) {
            return fail(res, '请填写有效的计划付款日（YYYY-MM-DD）', 400);
        }
        const [rows] = await pool.execute('SELECT * FROM pay_request WHERE id=?', [req.params.id]);
        if (!rows.length) return fail(res, '付款申请单不存在', 404);
        if (['PAID', 'CANCELLED'].includes(rows[0].status)) {
            return fail(res, `状态 ${rows[0].status} 不可调整排程`, 400);
        }
        await pool.execute(
            'UPDATE pay_request SET planned_pay_date=?, pay_method=COALESCE(?, pay_method) WHERE id=?',
            [planned, req.body.pay_method || null, rows[0].id]
        );
        audit.log(req, {
            module: 'payRequest', action: 'UPDATE', businessType: 'PK-SCHED',
            businessId: rows[0].request_no || rows[0].id,
            summary: `设定付款排程 ${rows[0].request_no || rows[0].id} 计划日期 ${planned}`,
            before: rows[0], after: { planned_pay_date: planned }
        });
        ok(res, { planned_pay_date: planned }, '付款排程已更新');
    } catch (err) { fail500(res, err); }
});

// 登记银行回单（APPROVED → PAID）
router.post('/:id/receipt', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const u = req.user;
        if (String(u.admin || '').trim() !== 'Yes') return fail(res, '只有财务管理员可以登记回单', 403);
        const receiptNo = String(req.body.bank_receipt_no || '').trim();
        if (!receiptNo) return fail(res, '银行回单号必填', 400);
        const receiptDate = req.body.receipt_date || new Date().toISOString().slice(0, 10);

        await conn.beginTransaction();
        const [rows] = await conn.execute('SELECT * FROM pay_request WHERE id=? FOR UPDATE', [req.params.id]);
        if (!rows.length) { await conn.rollback(); return fail(res, '付款申请单不存在', 404); }
        const row = rows[0];
        if (row.status !== 'APPROVED') {
            await conn.rollback();
            return fail(res, `状态 ${row.status} 不可登记回单`, 400);
        }
        const receiptAmount = req.body.receipt_amount != null
            ? Number(req.body.receipt_amount) : Number(row.total_amount);
        if (!Number.isFinite(receiptAmount) || receiptAmount <= 0) {
            await conn.rollback(); return fail(res, '回单金额必须大于 0', 400);
        }

        await conn.execute(
            `UPDATE pay_request
                SET status='PAID', pay_time=NOW(), bank_receipt_no=?, receipt_date=?,
                    receipt_amount=?, receipt_bank=?, planned_pay_date=COALESCE(planned_pay_date, ?)
              WHERE id=?`,
            [receiptNo, receiptDate, receiptAmount.toFixed(2),
                req.body.receipt_bank || null, receiptDate, row.id]
        );
        if (row.wf_instance_id) {
            await conn.execute(
                `INSERT INTO wf_log (instance_id, step_no, action, operator_id, comment)
                 VALUES (?, 0, 'PAY', ?, ?)`,
                [row.wf_instance_id, u.user_id, `银行回单 ${receiptNo}`]
            );
            await conn.execute(
                'UPDATE wf_instance SET status="APPROVED", update_time=NOW() WHERE id=?',
                [row.wf_instance_id]
            );
        }
        await conn.commit();
        audit.log(req, {
            module: 'payRequest', action: 'PAY', businessType: 'PK-RECEIPT',
            businessId: row.request_no || row.id,
            summary: `登记银行回单 ${row.request_no || row.id} 回单号 ${receiptNo} ¥${receiptAmount.toFixed(2)}`,
            before: row,
            after: { bank_receipt_no: receiptNo, receipt_amount: receiptAmount.toFixed(2), status: 'PAID' }
        });
        ok(res, { bank_receipt_no: receiptNo, receipt_amount: receiptAmount.toFixed(2) }, '回单已登记，单据标记为已付款');
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally { conn.release(); }
});

// 核销明细
router.get('/:id/writeoffs', async (req, res) => {
    try {
        const u = req.user;
        if (!(await isFinanceOrManager(u))) return fail(res, '无权查看核销明细', 403);
        const [rows] = await pool.execute(
            `SELECT w.*, r.request_no FROM pay_writeoff w
               LEFT JOIN pay_request r ON r.id=w.request_id
              WHERE w.request_id=? ORDER BY w.id`,
            [req.params.id]
        );
        const total = rows.reduce((s, w) => s + Number(w.writeoff_amount || 0), 0);
        ok(res, { rows, total: total.toFixed(2) });
    } catch (err) { fail500(res, err); }
});

// 新增核销（付款单 → AR/AP 发票）
router.post('/:id/writeoff', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const u = req.user;
        if (!(await isFinanceOrManager(u))) return fail(res, '无权限执行核销', 403);
        const sourceUid = Number(req.body.source_uid);
        const amount = Number(req.body.amount);
        if (!sourceUid) return fail(res, '请选择核销发票', 400);
        if (!Number.isFinite(amount) || amount <= 0) return fail(res, '核销金额必须大于 0', 400);
        const writeoffDate = req.body.writeoff_date || new Date().toISOString().slice(0, 10);

        await conn.beginTransaction();
        const [rrows] = await conn.execute('SELECT * FROM pay_request WHERE id=? FOR UPDATE', [req.params.id]);
        if (!rrows.length) { await conn.rollback(); return fail(res, '付款申请单不存在', 404); }
        const row = rrows[0];
        if (row.status !== 'PAID') {
            await conn.rollback(); return fail(res, '只有已付款的单据可以核销', 400);
        }

        const [wrows] = await conn.execute(
            'SELECT COALESCE(SUM(writeoff_amount),0) AS done FROM pay_writeoff WHERE request_id=?',
            [row.id]
        );
        const done = Number(wrows[0].done) || 0;
        if (done + amount > Number(row.total_amount) + 0.005) {
            await conn.rollback();
            return fail(res, `核销合计不能超过付款金额 ${Number(row.total_amount).toFixed(2)}`, 400);
        }

        const [iv] = await conn.execute(
            'SELECT * FROM mgm_invoice_details WHERE uid=? FOR UPDATE', [sourceUid]
        );
        if (!iv.length) { await conn.rollback(); return fail(res, '发票不存在', 404); }
        const inv = iv[0];
        const openAmount = Number(inv.sub_amt) - Number(inv.payment || 0);
        if (amount > openAmount + 0.005) {
            await conn.rollback(); return fail(res, `核销金额超过该发票未付金额 ${openAmount.toFixed(2)}`, 400);
        }

        await conn.execute(
            `INSERT INTO pay_writeoff
               (request_id, source_type, source_uid, invoice_no, counterparty,
                writeoff_amount, writeoff_date, operator_id, note)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            [row.id, inv.TX_type, inv.uid, inv.invoice_no, inv.client_id,
                amount.toFixed(2), writeoffDate, u.user_id, req.body.note || null]
        );
        const newPayment = Number(inv.payment || 0) + amount;
        await conn.execute(
            `UPDATE mgm_invoice_details
                SET payment=?, pay_date=IF(? >= sub_amt - 0.005, ?, pay_date)
              WHERE uid=?`,
            [newPayment.toFixed(2), newPayment, writeoffDate, inv.uid]
        );

        const newDone = done + amount;
        const woStatus = newDone >= Number(row.total_amount) - 0.005 ? 'WRITTEN' : 'PARTIAL';
        await conn.execute('UPDATE pay_request SET writeoff_status=? WHERE id=?', [woStatus, row.id]);
        await conn.commit();
        audit.log(req, {
            module: 'payRequest', action: 'UPDATE', businessType: 'WR',
            businessId: inv.uid,
            summary: `核销付款单 ${row.request_no || row.id} 发票 ${inv.invoice_no} ¥${amount.toFixed(2)} 状态 ${woStatus}`,
            after: { writeoff_total: newDone.toFixed(2), writeoff_status: woStatus }
        });
        ok(res, { writeoff_total: newDone.toFixed(2), writeoff_status: woStatus },
            woStatus === 'WRITTEN' ? '核销完成' : '已部分核销');
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally { conn.release(); }
});

// 撤销核销
router.delete('/:id/writeoff/:wid', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const u = req.user;
        if (String(u.admin || '').trim() !== 'Yes') return fail(res, '只有财务管理员可以撤销核销', 403);
        await conn.beginTransaction();
        const [rows] = await conn.execute(
            'SELECT * FROM pay_writeoff WHERE id=? AND request_id=?', [req.params.wid, req.params.id]
        );
        if (!rows.length) { await conn.rollback(); return fail(res, '核销记录不存在', 404); }
        const w = rows[0];
        await conn.execute('DELETE FROM pay_writeoff WHERE id=?', [w.id]);
        await conn.execute(
            'UPDATE mgm_invoice_details SET payment=GREATEST(payment-?, 0) WHERE uid=?',
            [w.writeoff_amount, w.source_uid]
        );
        await conn.execute(
            'UPDATE mgm_invoice_details SET pay_date=NULL WHERE uid=? AND payment <= 0.005',
            [w.source_uid]
        );
        const [sumRows] = await conn.execute(
            'SELECT COALESCE(SUM(writeoff_amount),0) AS done FROM pay_writeoff WHERE request_id=?', [req.params.id]
        );
        const done = Number(sumRows[0].done) || 0;
        const [rr] = await conn.execute('SELECT total_amount FROM pay_request WHERE id=?', [req.params.id]);
        const status = done <= 0 ? 'UNWRITTEN'
            : (done >= Number(rr[0]?.total_amount || 0) - 0.005 ? 'WRITTEN' : 'PARTIAL');
        await conn.execute('UPDATE pay_request SET writeoff_status=? WHERE id=?', [status, req.params.id]);
        await conn.commit();
        audit.log(req, {
            module: 'payRequest', action: 'DELETE', businessType: 'WR-DELETE',
            businessId: w.id,
            summary: `撤销核销记录 ${w.id} 发票 ${w.invoice_no} ¥${w.writeoff_amount}`,
            before: w,
            after: { writeoff_total: done.toFixed(2), writeoff_status: status }
        });
        ok(res, { writeoff_total: done.toFixed(2), writeoff_status: status }, '已撤销核销');
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally { conn.release(); }
});

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
router.post('/', perms('payRequest','CREATE'), async (req, res) => {
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
             d.bu_no, d.pay_type, d.pay_target, total, d.currency || 'RMB',
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
                 Number(it.amount) || 0, it.currency_ab || d.currency || 'RMB', it.remark || null]
            );
        }
        await conn.commit();
        const auditAfter5 = { id: reqId, request_no: requestNo, total_amount: total, status: 'DRAFT' };
        audit.log(req, {
            module: 'payRequest', action: 'CREATE', businessType: 'PK',
            businessId: requestNo,
            summary: `新建付款申请单 ${requestNo} ${d.pay_target || ''} ¥${total} 申请人 ${u.user_name || u.user_id}`,
            after: auditAfter5
        });
        ok(res, auditAfter5, '付款申请单已创建');
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
        audit.log(req, {
            module: 'payRequest', action: 'UPDATE', businessType: 'PK',
            businessId: row.request_no || row.id,
            summary: `编辑付款申请单 ${row.request_no || row.id} ${d.pay_target || row.pay_target || ''} ¥${total}`,
            before: row, after: { id: row.id, pay_target: d.pay_target || row.pay_target, total_amount: total }
        });
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
        audit.log(req, {
            module: 'payRequest', action: 'DELETE', businessType: 'PK',
            businessId: row.request_no || row.id,
            summary: `删除付款申请单 ${row.request_no || row.id} ${row.pay_target || ''}`,
            before: row
        });
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
        audit.log(req, {
            module: 'payRequest', action: 'SUBMIT', businessType: 'PK-SUBMIT',
            businessId: row.request_no || row.id,
            summary: `提交付款申请审批 ${row.request_no || row.id} ${row.pay_target || ''} ¥${total}`,
            after: { status: wf.status, wf_instance_id: wf.instanceId }
        });
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
        audit.log(req, {
            module: 'payRequest', action: 'PAY', businessType: 'PK-PAY',
            businessId: row.request_no || row.id,
            summary: `标记付款申请已付款 ${row.request_no || row.id} ${row.pay_target || ''} ¥${row.total_amount}`,
            before: row
        });
        ok(res, null, '已标记为付款');
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally {
        conn.release();
    }
});

module.exports = router;
