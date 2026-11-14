/**
 * 銷售訂單 ermm_erp_so CRUD
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, n } = require('../utils/response');
const { checkCredit } = require('../services/soCredit');

router.get('/', async (req, res) => {
    try {
        const { bu_no, YYYY_MM, status, limit } = req.query;
        let sql = 'SELECT * FROM ermm_erp_so WHERE 1=1';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (YYYY_MM) { sql += ' AND YYYY_MM=?'; params.push(YYYY_MM); }
        if (status) { sql += ' AND status=?'; params.push(status); }
        sql += ' ORDER BY so_date DESC, uid DESC LIMIT ' + (limit || 200);
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ===== COO-02 销售闭环（SO → DN → AR 发票 → 收款）=====

/**
 * GET /pipeline/summary — 四阶段闭环漏斗汇总
 */
router.get('/pipeline/summary', async (req, res) => {
    try {
        const { bu_no, YYYY_MM } = req.query;
        const cond = [], params = [];
        if (bu_no) { cond.push('bu_no=?'); params.push(bu_no); }
        if (YYYY_MM) { cond.push('YYYY_MM=?'); params.push(YYYY_MM); }
        const w = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

        // 阶段1：销售订单
        const [so] = await pool.execute(`
            SELECT COUNT(*) cnt, COALESCE(SUM(so_qty * unit_price),0) amt,
                   COALESCE(SUM(dn_qty),0) dn_qty_total
            FROM ermm_erp_so ${w}`, params);

        // 阶段2：出货单（按 so_nbr 关联）
        const dCond = [], dParams = [];
        if (bu_no) { dCond.push('d.bu_no=?'); dParams.push(bu_no); }
        if (YYYY_MM) {
            dCond.push("DATE_FORMAT(d.DN_date,'%Y-%m')=?");
            dParams.push(YYYY_MM);
        }
        const [dn] = await pool.execute(`
            SELECT COUNT(*) cnt,
                   COALESCE(SUM(d.DN_qty * COALESCE(s.unit_price,0)),0) amt,
                   COUNT(DISTINCT d.so_nbr) so_cnt
            FROM ermm_erp_so_dn d
            LEFT JOIN ermm_erp_so s ON d.so_nbr = s.so_nbr
            ${dCond.length ? 'WHERE ' + dCond.join(' AND ') : ''}`, dParams);

        // 阶段3：AR 应收发票
        const iCond = ["TX_type='AR'"], iParams = [];
        if (bu_no) { iCond.push('bu_no=?'); iParams.push(bu_no); }
        if (YYYY_MM) { iCond.push('YYYY_MM=?'); iParams.push(YYYY_MM); }
        const [ar] = await pool.execute(`
            SELECT COUNT(*) cnt, COALESCE(SUM(sub_amt),0) amt,
                   COALESCE(SUM(payment),0) paid
            FROM mgm_invoice_details WHERE ${iCond.join(' AND ')}`, iParams);

        // 关联口径：仅统计能通过 order_id 追溯到销售订单的 AR 发票
        const [arLinked] = await pool.execute(`
            SELECT COUNT(*) cnt, COALESCE(SUM(i.sub_amt),0) amt,
                   COALESCE(SUM(i.payment),0) paid
            FROM mgm_invoice_details i
            JOIN ermm_erp_so s ON i.order_id = s.so_nbr
            WHERE i.TX_type='AR'
              ${bu_no ? 'AND i.bu_no=?' : ''}`, bu_no ? [bu_no] : []);

        // 阶段4：实际收款（现金流水借方：DR/借/DB 均为流入）
        const cCond = ["DB_CR IN ('DR','借','DB')", "amt_type IN ('销售收款','应收款收回','销货收入')"], cParams = [];
        if (bu_no) { cCond.push('bu_no=?'); cParams.push(bu_no); }
        if (YYYY_MM) { cCond.push('YYYY_MM=?'); cParams.push(YYYY_MM); }
        const [cash] = await pool.execute(`
            SELECT COUNT(*) cnt, COALESCE(SUM(sub_amt),0) amt
            FROM mgm_casher_details WHERE ${cCond.join(' AND ')}`, cParams);

        const soAmt = Number(so[0].amt), dnAmt = Number(dn[0].amt);
        const arAmt = Number(ar[0].amt), paidAmt = Number(ar[0].paid);
        const cashAmt = Number(cash[0].amt);

        ok(res, {
            stages: [
                { code: 'SO', name: '销售订单', count: so[0].cnt, amount: soAmt },
                { code: 'DN', name: '出货单', count: dn[0].cnt, amount: dnAmt, so_covered: dn[0].so_cnt },
                { code: 'AR', name: '应收发票', count: ar[0].cnt, amount: arAmt, paid: paidAmt, unpaid: arAmt - paidAmt },
                { code: 'CASH', name: '实际收款', count: cash[0].cnt, amount: cashAmt }
            ],
            ar_linked: {
                count: arLinked[0].cnt,
                amount: Number(arLinked[0].amt),
                paid: Number(arLinked[0].paid),
                note: '可按 order_id 追溯至销售订单的 AR 发票'
            },
            conversion: {
                // 金额口径转化率；dn_to_ar 用关联口径，避免月度汇总开票造成失真
                so_to_dn: soAmt ? Math.round(dnAmt / soAmt * 1000) / 10 : 0,
                dn_to_ar: dnAmt ? Math.round(Number(arLinked[0].amt) / dnAmt * 1000) / 10 : 0,
                ar_collect_rate: arAmt ? Math.round(paidAmt / arAmt * 1000) / 10 : 0
            },
            gaps: {
                so_delivered_qty: Number(so[0].dn_qty_total),
                invoice_unpaid: arAmt - paidAmt,
                paid_vs_cash_diff: paidAmt - cashAmt
            }
        });
    } catch (err) { fail500(res, err); }
});

/**
 * GET /pipeline/clients — 按客户看闭环完整度
 */
router.get('/pipeline/clients', async (req, res) => {
    try {
        const { bu_no } = req.query;
        const soW = bu_no ? 'WHERE bu_no=?' : '';
        const p = bu_no ? [bu_no] : [];

        const [soRows] = await pool.execute(`
            SELECT client_id, client_name, COUNT(*) so_cnt,
                   COALESCE(SUM(so_qty * unit_price),0) so_amt
            FROM ermm_erp_so ${soW}
            GROUP BY client_id, client_name`, p);

        const [arRows] = await pool.execute(`
            SELECT client_id, COUNT(*) ar_cnt, COALESCE(SUM(sub_amt),0) ar_amt,
                   COALESCE(SUM(payment),0) paid_amt
            FROM mgm_invoice_details
            WHERE TX_type='AR' ${bu_no ? 'AND bu_no=?' : ''}
            GROUP BY client_id`, p);

        const [cashRows] = await pool.execute(`
            SELECT client_id, COALESCE(SUM(sub_amt),0) cash_amt
            FROM mgm_casher_details
            WHERE DB_CR IN ('DR','借','DB') AND amt_type IN ('销售收款','应收款收回','销货收入')
              ${bu_no ? 'AND bu_no=?' : ''}
            GROUP BY client_id`, p);

        const arMap = {}, cashMap = {};
        arRows.forEach(r => arMap[r.client_id] = r);
        cashRows.forEach(r => cashMap[r.client_id] = Number(r.cash_amt));

        const list = soRows.map(r => {
            const ar = arMap[r.client_id] || { ar_cnt: 0, ar_amt: 0, paid_amt: 0 };
            const soAmt = Number(r.so_amt), arAmt = Number(ar.ar_amt), paid = Number(ar.paid_amt);
            const collected = cashMap[r.client_id] || 0;
            return {
                client_id: r.client_id, client_name: r.client_name,
                so_cnt: r.so_cnt, so_amt: soAmt,
                ar_cnt: Number(ar.ar_cnt), ar_amt: arAmt, paid_amt: paid,
                unpaid_amt: arAmt - paid,
                cash_amt: collected,
                closed_rate: arAmt ? Math.min(100, Math.round(paid / arAmt * 1000) / 10) : 0,
                status: arAmt === 0 ? '未开票' : (paid >= arAmt ? '已收款' : (paid > 0 ? '部分收款' : '未收款'))
            };
        }).sort((a, b) => b.so_amt - a.so_amt);

        ok(res, { count: list.length, clients: list });
    } catch (err) { fail500(res, err); }
});

/**
 * GET /pipeline/exceptions — 闭环断点清单
 */
router.get('/pipeline/exceptions', async (req, res) => {
    try {
        const { bu_no, limit = 30 } = req.query;

        // 断点1：已出货但无 AR 发票（按 so_nbr 关联）
        const [noInvoice] = await pool.execute(`
            SELECT s.so_nbr, s.client_id, s.client_name, s.so_qty, s.dn_qty, s.unit_price,
                   ROUND(s.dn_qty * s.unit_price, 2) dn_amt, s.so_date, s.status
            FROM ermm_erp_so s
            WHERE s.dn_qty > 0
              AND NOT EXISTS (SELECT 1 FROM mgm_invoice_details i
                              WHERE i.TX_type='AR' AND i.order_id = s.so_nbr)
              ${bu_no ? 'AND s.bu_no=?' : ''}
            ORDER BY dn_amt DESC LIMIT ${Number(limit)}`, bu_no ? [bu_no] : []);

        // 断点2：已开票但长期未收款（逾期 > 90 天）
        const [unpaid] = await pool.execute(`
            SELECT invoice_no, order_id, client_id, sub_amt, COALESCE(payment,0) payment,
                   ROUND(sub_amt - COALESCE(payment,0), 2) unpaid,
                   COALESCE(pay_date, wk_date) invoice_date,
                   DATEDIFF(CURDATE(), COALESCE(pay_date, wk_date)) overdue_days
            FROM mgm_invoice_details
            WHERE TX_type='AR' AND sub_amt > COALESCE(payment,0)
              AND DATEDIFF(CURDATE(), COALESCE(pay_date, wk_date)) > 90
              ${bu_no ? 'AND bu_no=?' : ''}
            ORDER BY unpaid DESC LIMIT ${Number(limit)}`, bu_no ? [bu_no] : []);

        ok(res, {
            delivered_no_invoice: { count: noInvoice.length, rows: noInvoice },
            invoiced_no_payment: { count: unpaid.length, rows: unpaid }
        });
    } catch (err) { fail500(res, err); }
});

/**
 * GET /pipeline/order/:so_nbr — 单张订单全链路追踪
 */
router.get('/pipeline/order/:so_nbr', async (req, res) => {
    try {
        const soNbr = req.params.so_nbr;
        const [so] = await pool.execute('SELECT * FROM ermm_erp_so WHERE so_nbr=?', [soNbr]);
        if (!so.length) return fail(res, '订单不存在', 404);

        const [dns] = await pool.execute(
            'SELECT * FROM ermm_erp_so_dn WHERE so_nbr=? ORDER BY DN_date', [soNbr]);
        const [invs] = await pool.execute(
            "SELECT * FROM mgm_invoice_details WHERE TX_type='AR' AND order_id=? ORDER BY wk_date", [soNbr]);

        const invoiced = invs.reduce((s, i) => s + Number(i.sub_amt), 0);
        const paid = invs.reduce((s, i) => s + Number(i.payment || 0), 0);

        ok(res, {
            so: so[0],
            dn: { count: dns.length, rows: dns },
            invoice: { count: invs.length, rows: invs, total: invoiced, paid, unpaid: invoiced - paid },
            chain_status: invs.length === 0 ? 'WAIT_INVOICE'
                : (paid >= invoiced ? 'CLOSED' : (paid > 0 ? 'PARTIAL_PAID' : 'WAIT_PAYMENT'))
        });
    } catch (err) { fail500(res, err); }
});

router.get('/:uid', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM ermm_erp_so WHERE uid=?', [req.params.uid]);
        if (rows.length === 0) return fail(res, '記錄不存在', 404);
        ok(res, rows[0]);
    } catch (err) { fail500(res, err); }
});

router.post('/', async (req, res) => {
    try {
        const d = req.body;
        let YYYY = d.YYYY, MM = d.MM, YYYY_MM = d.YYYY_MM;
        if (!YYYY_MM && d.so_date) {
            const dt = new Date(d.so_date);
            YYYY_MM = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
            YYYY = String(dt.getFullYear());
            MM = String(dt.getMonth()+1).padStart(2,'0');
        }

        // COO-03 信用额度拦截（仅对已设额度客户生效；管理员可强制放行）
        const orderAmt = Number(d.so_qty || 0) * Number(d.unit_price || 0);
        if (d.bu_no && d.client_id && orderAmt > 0 && !(d.force && req.user && req.user.admin === 'Yes')) {
            const chk = await checkCredit(d.bu_no, d.client_id, orderAmt);
            if (chk.blocked) {
                return res.status(409).json({
                    success: false,
                    message: `${chk.reason}：额度 ${chk.limit}，已用 ${chk.used}，本单 ${orderAmt}，可用 ${chk.available}`,
                    data: chk
                });
            }
        }
        const [r] = await pool.execute(`
            INSERT INTO ermm_erp_so (bu_no, so_nbr, client_id, client_name, xitems, so_date,
                YYYY, MM, YYYY_MM, so_qty, dn_qty, unit_price, status, remark)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `, [
            n(d.bu_no), n(d.so_nbr), n(d.client_id), n(d.client_name), n(d.xitems),
            d.so_date || null,
            n(YYYY), n(MM), n(YYYY_MM),
            Number(d.so_qty || 0), Number(d.dn_qty || 0), Number(d.unit_price || 0),
            d.status || null, n(d.remark)
        ]);
        ok(res, { uid: r.insertId }, '已新增銷售訂單');
    } catch (err) { fail500(res, err); }
});

router.put('/:uid', async (req, res) => {
    try {
        const d = req.body;
        const updates = Object.keys(d).filter(k => k !== 'uid' && k !== 'create_time')
            .map(k => `${k}=?`).join(',');
        const values = Object.keys(d).filter(k => k !== 'uid' && k !== 'create_time')
            .map(k => d[k]);
        values.push(req.params.uid);
        await pool.execute(`UPDATE ermm_erp_so SET ${updates} WHERE uid=?`, values);
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

router.delete('/:uid', async (req, res) => {
    try {
        await pool.execute('DELETE FROM ermm_erp_so WHERE uid=?', [req.params.uid]);
        ok(res, null, '已刪除');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
