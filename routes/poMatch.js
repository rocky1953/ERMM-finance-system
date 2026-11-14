/**
 * PO 三单匹配结果工作台
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const { runMatch } = require('../services/poMatch');

// ====== 执行匹配 ======
router.post('/run', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { YYYY_MM, bu_no, qtyTol, amtTol, amtRateTol } = req.body;
        const result = await runMatch(conn, { YYYY_MM, bu_no, qtyTol, amtTol, amtRateTol });
        ok(res, result, `匹配完成：匹配 ${result.matched} / 差异 ${result.partial} / 未匹配 ${result.unmatched} / 过量 ${result.excess}`);
    } catch (err) {
        fail500(res, err);
    } finally {
        conn.release();
    }
});

// ====== 匹配结果列表 ======
router.get('/results', async (req, res) => {
    try {
        const { YYYY_MM, bu_no, match_status, handle_status } = req.query;
        let sql = `SELECT r.*, p.po_id, p.po_status, g.grn_date
                   FROM po_match_result r
                   LEFT JOIN ermm_erp_po p ON p.uid=r.po_uid
                   LEFT JOIN po_grn g ON g.uid=r.grn_uid
                   WHERE 1=1`;
        const params = [];
        if (YYYY_MM) { sql += ' AND r.YYYY_MM=?'; params.push(YYYY_MM); }
        if (bu_no) { sql += ' AND r.bu_no=?'; params.push(bu_no); }
        if (match_status) { sql += ' AND r.match_status=?'; params.push(match_status); }
        if (handle_status) { sql += ' AND r.handle_status=?'; params.push(handle_status); }
        sql += ' ORDER BY r.YYYY_MM DESC, r.bu_no, p.po_id LIMIT 500';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ====== 匹配汇总 ======
router.get('/summary', async (req, res) => {
    try {
        const { YYYY_MM } = req.query;
        let sql = `SELECT match_status, COUNT(*) cnt,
                          SUM(po_amount) po_total, SUM(grn_amount) grn_total, SUM(invoice_amount) inv_total
                   FROM po_match_result WHERE 1=1`;
        const params = [];
        if (YYYY_MM) { sql += ' AND YYYY_MM=?'; params.push(YYYY_MM); }
        sql += ' GROUP BY match_status';
        const [rows] = await pool.execute(sql, params);

        const [[overall]] = await pool.execute(`
            SELECT COUNT(*) total, SUM(CASE WHEN match_status='MATCHED' THEN 1 ELSE 0 END) matched,
                   SUM(po_amount) po_amt, SUM(grn_amount) grn_amt, SUM(invoice_amount) inv_amt,
                   SUM(CASE WHEN match_status<>'MATCHED' THEN 1 ELSE 0 END) exception_cnt,
                   SUM(CASE WHEN ap_settled=1 THEN 1 ELSE 0 END) settled_cnt
            FROM po_match_result ${YYYY_MM ? 'WHERE YYYY_MM=?' : ''}`, params);

        const [byHandle] = await pool.execute(`
            SELECT handle_status, COUNT(*) cnt
            FROM po_match_result ${YYYY_MM ? 'WHERE YYYY_MM=?' : ''}
            GROUP BY handle_status`, params);

        ok(res, { by_status: rows, overall, by_handle: byHandle });
    } catch (err) { fail500(res, err); }
});

// ====== 差异明细（按差异金额倒序，供 CFO 优先处理）======
router.get('/exceptions', async (req, res) => {
    try {
        const { YYYY_MM, bu_no, handle_status } = req.query;
        let sql = `SELECT r.*, p.po_id, p.po_status
                   FROM po_match_result r
                   LEFT JOIN ermm_erp_po p ON p.uid=r.po_uid
                   WHERE r.match_status <> 'MATCHED'`;
        const params = [];
        if (YYYY_MM) { sql += ' AND r.YYYY_MM=?'; params.push(YYYY_MM); }
        if (bu_no) { sql += ' AND r.bu_no=?'; params.push(bu_no); }
        if (handle_status) { sql += ' AND r.handle_status=?'; params.push(handle_status); }
        sql += ' ORDER BY ABS(r.diff_amount) DESC, ABS(r.diff_rate) DESC LIMIT 200';
        const [rows] = await pool.execute(sql, params);

        // 附加建议处置
        const list = rows.map(r => {
            let suggestion = '人工核对';
            if (r.match_status === 'NO_GRN') suggestion = '补办收货单（GRN）后再核销';
            else if (r.match_status === 'EXCESS' && !r.po_uid) suggestion = '补建采购订单或退回发票';
            else if (r.match_status === 'EXCESS') suggestion = '补办收货或退回发票';
            else if (r.match_status === 'PARTIAL' && !Number(r.grn_amount)) suggestion = '补办收货单';
            else if (r.match_status === 'PARTIAL') suggestion = '催收供应商发票';
            else if (r.match_status === 'DIFF_AMT') suggestion = Number(r.diff_amount) > 0 ? '发票金额高于收货，核对价格或折让' : '发票金额低于收货，确认是否分批开票';
            else if (r.match_status === 'DIFF_QTY') suggestion = '核对收货数量与发票数量';
            return { ...r, suggestion };
        });

        const totalDiff = list.reduce((s, r) => s + Math.abs(Number(r.diff_amount || 0)), 0);
        ok(res, { count: list.length, total_abs_diff: totalDiff, rows: list });
    } catch (err) { fail500(res, err); }
});

// ====== 差异处置（挂起 / 接受 / 退回）======
router.post('/results/:id/handle', async (req, res) => {
    try {
        const u = req.user;
        const { handle_status, reason } = req.body;
        const allow = ['PENDING', 'HOLD', 'ACCEPTED', 'REJECTED'];
        if (!allow.includes(handle_status)) return fail(res, 'handle_status 非法', 400);
        if (handle_status !== 'PENDING' && !reason) return fail(res, '请填写处置原因', 400);

        const [rows] = await pool.execute('SELECT id, match_status, ap_settled FROM po_match_result WHERE id=?', [req.params.id]);
        if (!rows.length) return fail(res, '记录不存在', 404);
        if (rows[0].ap_settled) return fail(res, '已生成应付款，不能变更处置', 400);

        await pool.execute(
            `UPDATE po_match_result
             SET handle_status=?, handle_reason=?, handled_by=?, handled_time=NOW()
             WHERE id=?`,
            [handle_status, reason || null, u ? u.user_id : null, req.params.id]
        );
        ok(res, null, '处置已保存');
    } catch (err) { fail500(res, err); }
});

// ====== 手动确认匹配（状态修正）======
router.post('/results/:id/confirm', async (req, res) => {
    try {
        const u = req.user;
        const { match_status } = req.body;
        if (!match_status) return fail(res, '需要 match_status', 400);
        await pool.execute(
            `UPDATE po_match_result SET match_status=?, matched_by=?, matched_time=NOW() WHERE id=?`,
            [match_status, u.user_id, req.params.id]
        );
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

// ====== 已匹配 → 自动生成应付款（pay_detail）======
router.post('/results/:id/settle', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const u = req.user;
        const [rows] = await conn.execute('SELECT * FROM po_match_result WHERE id=?', [req.params.id]);
        if (!rows.length) return fail(res, '不存在', 404);
        const r = rows[0];
        if (r.match_status !== 'MATCHED') return fail(res, '仅 MATCHED 可生成应付款', 400);
        if (r.ap_settled) return fail(res, '已生成应付款', 400);

        await conn.beginTransaction();
        const [[po]] = await conn.execute(
            'SELECT po_date, po_id, supplier_name FROM ermm_erp_po WHERE uid=?',
            [r.po_uid]
        );
        const pay_date = new Date();  // 默认今天
        const dateStr = pay_date.toISOString().substring(0,10);
        const invoiceNum = r.po_id || po?.po_id || `PO-AUTO-${r.po_uid}`;
        const supplier = r.supplier_name || po?.supplier_name || '';

        const [pay] = await conn.execute(`
            INSERT INTO pay_detail
                (bu_no, supplier_name, finance_type, should_date, invoice_date,
                 amount, currency_ab, invoice_num, pay_date, expense_content, remark,
                 data_year, create_time)
            VALUES (?,?,?,?,?,?,?,?,?,?,?, YEAR(NOW()), NOW())`,
            [r.bu_no, supplier, '进货',
             dateStr, po ? String(po.po_date).substring(0,10) : dateStr,
             Number(r.invoice_amount || r.grn_amount || 0), 'CNY',
             invoiceNum, null, r.xitems,
             `PO匹配自动核销 ${invoiceNum}`]
        );
        await conn.execute(
            'UPDATE po_match_result SET ap_settled=1, ap_pay_uid=? WHERE id=?',
            [pay.insertId, req.params.id]
        );
        await conn.commit();
        ok(res, { pay_uid: pay.insertId }, '已生成应付款');
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally { conn.release(); }
});

module.exports = router;
