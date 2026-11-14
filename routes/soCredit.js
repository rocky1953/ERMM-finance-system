/**
 * 销售履约与信用（COO-03）
 * 信用额度 · 超限预检 · 销售退货 · 履约风险
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, n } = require('../utils/response');
const { getCreditRows, checkCredit } = require('../services/soCredit');

// ====== 信用额度看板 ======
router.get('/limits', async (req, res) => {
    try {
        const { bu_no, q } = req.query;
        let rows = await getCreditRows(bu_no);
        if (q) {
            const kw = String(q).toLowerCase();
            rows = rows.filter(r =>
                String(r.client_id).toLowerCase().includes(kw) ||
                String(r.client_name).toLowerCase().includes(kw));
        }
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.get('/summary', async (req, res) => {
    try {
        const { bu_no } = req.query;
        const rows = await getCreditRows(bu_no);

        const rParams = []; let rFilter = '1=1';
        if (bu_no) { rFilter += ' AND bu_no=?'; rParams.push(bu_no); }
        const [[ret]] = await pool.execute(`
            SELECT COUNT(*) cnt,
                   COALESCE(SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END),0) pending_cnt,
                   COALESCE(SUM(CASE WHEN status='PENDING' THEN return_amount ELSE 0 END),0) pending_amt,
                   COALESCE(SUM(CASE WHEN status IN ('APPROVED','CLOSED') THEN return_amount ELSE 0 END),0) approved_amt
            FROM sales_return WHERE ${rFilter}`, rParams);

        const totalLimit = rows.reduce((s, r) => s + r.credit_limit, 0);
        const totalUsed = rows.reduce((s, r) => s + r.used, 0);
        ok(res, {
            client_cnt: rows.length,
            with_limit_cnt: rows.filter(r => r.has_limit).length,
            over_limit_cnt: rows.filter(r => r.over_limit).length,
            frozen_cnt: rows.filter(r => r.status === 'HOLD').length,
            total_limit: Math.round(totalLimit * 100) / 100,
            total_used: Math.round(totalUsed * 100) / 100,
            usage_rate: totalLimit > 0 ? Math.round(totalUsed / totalLimit * 1000) / 10 : 0,
            overdue_cnt: rows.filter(r => r.overdue_amt > 0).length,
            overdue_amt: Math.round(rows.reduce((s, r) => s + r.overdue_amt, 0) * 100) / 100,
            no_invoice_amt: Math.round(rows.reduce((s, r) => s + r.shipped_no_invoice, 0) * 100) / 100,
            returns: {
                count: Number(ret.cnt),
                pending_cnt: Number(ret.pending_cnt),
                pending_amt: Number(ret.pending_amt),
                approved_amt: Number(ret.approved_amt)
            }
        });
    } catch (err) { fail500(res, err); }
});

// ====== 下单信用预检 ======
router.get('/check', async (req, res) => {
    try {
        const { bu_no, client_id, amount } = req.query;
        if (!bu_no || !client_id) return fail(res, '缺少 bu_no 或 client_id', 400);
        const r = await checkCredit(bu_no, client_id, Number(amount) || 0);
        ok(res, r);
    } catch (err) { fail500(res, err); }
});

// ====== 额度维护 ======
router.put('/limits/:client_id', async (req, res) => {
    try {
        const { bu_no, client_name, credit_limit, credit_days, status, remark } = req.body;
        const clientId = req.params.client_id;
        if (!bu_no || !clientId) return fail(res, '缺少 bu_no 或 client_id', 400);
        const limit = Number(credit_limit || 0);
        if (limit < 0) return fail(res, '信用额度不可为负', 400);
        const st = status === 'HOLD' ? 'HOLD' : 'USE';
        await pool.execute(`
            INSERT INTO sales_credit_limit
                (bu_no, client_id, client_name, credit_limit, credit_days, status, remark, update_by)
            VALUES (?,?,?,?,?,?,?,?)
            ON DUPLICATE KEY UPDATE
                client_name=VALUES(client_name), credit_limit=VALUES(credit_limit),
                credit_days=VALUES(credit_days), status=VALUES(status),
                remark=VALUES(remark), update_by=VALUES(update_by)`, [
            bu_no, clientId, n(client_name), limit,
            Number(credit_days || 30), st, n(remark),
            req.user ? req.user.user_id : null
        ]);
        ok(res, { client_id: clientId, credit_limit: limit, status: st }, '信用额度已保存');
    } catch (err) { fail500(res, err); }
});

router.delete('/limits/:client_id', async (req, res) => {
    try {
        const { bu_no } = req.query;
        if (!bu_no) return fail(res, '缺少 bu_no', 400);
        await pool.execute('DELETE FROM sales_credit_limit WHERE bu_no=? AND client_id=?',
            [bu_no, req.params.client_id]);
        ok(res, null, '信用额度已删除');
    } catch (err) { fail500(res, err); }
});

// ====== 销售退货 ======
router.get('/returns', async (req, res) => {
    try {
        const { bu_no, status, client_id, limit } = req.query;
        let sql = 'SELECT * FROM sales_return WHERE 1=1';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (status) { sql += ' AND status=?'; params.push(status); }
        if (client_id) { sql += ' AND (client_id LIKE ? OR client_name LIKE ?)'; params.push(`%${client_id}%`, `%${client_id}%`); }
        sql += ` ORDER BY return_date DESC, uid DESC LIMIT ${Number(limit) || 200}`;
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

async function nextReturnNo(conn, bu_no, dateStr) {
    const ym = String(dateStr || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
    const [rows] = await conn.execute(
        'SELECT return_no FROM sales_return WHERE return_no LIKE ? ORDER BY return_no DESC LIMIT 1',
        [`RT${ym}%`]);
    const seq = rows.length ? Number(String(rows[0].return_no).slice(-3)) + 1 : 1;
    return `RT${ym}${String(seq).padStart(3, '0')}`;
}

router.post('/returns', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const d = req.body;
        if (!d.bu_no) return fail(res, '缺少 bu_no', 400);
        const qty = Number(d.return_qty || 0);
        if (qty <= 0) return fail(res, '退货数量必须大于 0', 400);

        let client_id = d.client_id, client_name = d.client_name,
            xitems = d.xitems, unit_price = Number(d.unit_price || 0);
        // 关联 SO 时补全客户/料件/单价
        if (d.so_nbr) {
            const [so] = await conn.execute('SELECT * FROM ermm_erp_so WHERE so_nbr=? LIMIT 1', [d.so_nbr]);
            if (so.length) {
                client_id = client_id || so[0].client_id;
                client_name = client_name || so[0].client_name;
                xitems = xitems || so[0].xitems;
                if (!unit_price) unit_price = Number(so[0].unit_price || 0);
            }
        }
        const return_date = d.return_date || new Date().toISOString().slice(0, 10);
        const return_no = d.return_no || await nextReturnNo(conn, d.bu_no, return_date);

        const [r] = await conn.execute(`
            INSERT INTO sales_return
                (bu_no, return_no, so_nbr, client_id, client_name, xitems, return_date,
                 return_qty, unit_price, reason_type, status, remark)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [
            d.bu_no, return_no, n(d.so_nbr), n(client_id), n(client_name), n(xitems), return_date,
            qty, unit_price, d.reason_type || 'QUALITY', 'PENDING', n(d.remark)
        ]);
        ok(res, { uid: r.insertId, return_no }, '退货单已登记');
    } catch (err) { fail500(res, err); }
    finally { conn.release(); }
});

const NEXT_STATUS = {
    PENDING: ['APPROVED', 'REJECTED'],
    APPROVED: ['CLOSED'],
    CLOSED: [],
    REJECTED: ['PENDING']
};

router.post('/returns/:uid/status', async (req, res) => {
    try {
        const { status, reason } = req.body;
        if (!NEXT_STATUS[status] && status !== 'PENDING') return fail(res, '状态非法', 400);
        const [rows] = await pool.execute('SELECT * FROM sales_return WHERE uid=?', [req.params.uid]);
        if (!rows.length) return fail(res, '退货单不存在', 404);
        const cur = rows[0].status;
        if (!(NEXT_STATUS[cur] || []).includes(status))
            return fail(res, `不允许从 ${cur} 变更为 ${status}`, 400);
        if ((status === 'REJECTED' || status === 'CLOSED') && !reason)
            return fail(res, '请填写处理原因', 400);
        await pool.execute(`
            UPDATE sales_return
               SET status=?, handled_by=?, handled_time=NOW(), handle_reason=?
             WHERE uid=?`, [status, req.user ? req.user.user_id : null, n(reason), req.params.uid]);
        ok(res, { uid: Number(req.params.uid), status }, '退货单状态已更新');
    } catch (err) { fail500(res, err); }
});

// ====== 履约风险清单 ======
router.get('/risks', async (req, res) => {
    try {
        const { bu_no, limit } = req.query;
        const rows = await getCreditRows(bu_no);
        const max = Number(limit) || 20;

        const [pendingReturns] = await pool.execute(`
            SELECT * FROM sales_return WHERE status='PENDING'
              ${bu_no ? 'AND bu_no=?' : ''}
            ORDER BY return_date DESC LIMIT ${max}`, bu_no ? [bu_no] : []);

        const overLimit = rows.filter(r => r.over_limit)
            .sort((a, b) => b.over_amount - a.over_amount).slice(0, max);
        const overdue = rows.filter(r => r.overdue_amt > 0)
            .sort((a, b) => b.overdue_amt - a.overdue_amt).slice(0, max);
        const noInvoice = rows.filter(r => r.shipped_no_invoice > 0)
            .sort((a, b) => b.shipped_no_invoice - a.shipped_no_invoice).slice(0, max);

        ok(res, {
            counts: {
                over_limit: rows.filter(r => r.over_limit).length,
                overdue: rows.filter(r => r.overdue_amt > 0).length,
                no_invoice: rows.filter(r => r.shipped_no_invoice > 0).length,
                pending_returns: pendingReturns.length
            },
            over_limit: overLimit,
            overdue,
            no_invoice: noInvoice,
            pending_returns: pendingReturns
        });
    } catch (err) { fail500(res, err); }
});

module.exports = router;
