/**
 * AR/AP 彙總路由
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, pagination } = require('../utils/response');

// 查詢 ARAP —— 返回真實 DB 結構（每月一行）
router.get('/raw', async (req, res) => {
    try {
        const { bu_no, YYYY_MM } = req.query;
        let sql = `SELECT uid, bu_no, YYYY, YYYY_MM,
            AR_amt, AP_amt, AR_ageing, AP_ageing, update_time
            FROM ermm_arap_detail WHERE 1=1`;
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (YYYY_MM) { sql += ' AND YYYY_MM=?'; params.push(YYYY_MM); }
        sql += ' ORDER BY YYYY_MM DESC';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// 查詢 ARAP —— 返回兩種行（AR 行 + AP 行）匹配前端 type1/amt 讀取
router.get('/', async (req, res) => {
    try {
        const { bu_no, YYYY_MM } = req.query;
        let sql = `SELECT uid, bu_no, YYYY_MM,
            AR_amt, AP_amt, AR_ageing, AP_ageing
            FROM ermm_arap_detail WHERE 1=1`;
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (YYYY_MM) { sql += ' AND YYYY_MM=?'; params.push(YYYY_MM); }
        sql += ' ORDER BY YYYY_MM DESC';
        const [rows] = await pool.execute(sql, params);

        // 關鍵轉換：前端期望每行是一條 AR 或 AP 明細（type1 + amt）
        // 但 DB 是月度匯總（一行有 AR_amt + AP_amt 兩列），所以拆成兩行
        const flat = [];
        rows.forEach(r => {
            if (Number(r.AR_amt || 0) > 0) {
                flat.push({
                    uid: r.uid * 10 + 1,
                    bu_no: r.bu_no, YYYY_MM: r.YYYY_MM,
                    type1: 'AR', amt: Number(r.AR_amt || 0),
                    ageing: Number(r.AR_ageing || 0),
                    cust_name: null, supplier_name: null,
                    currency: 'RMB', due_date: null, status1: 'current'
                });
            }
            if (Number(r.AP_amt || 0) > 0) {
                flat.push({
                    uid: r.uid * 10 + 2,
                    bu_no: r.bu_no, YYYY_MM: r.YYYY_MM,
                    type1: 'AP', amt: Number(r.AP_amt || 0),
                    ageing: Number(r.AP_ageing || 0),
                    cust_name: null, supplier_name: null,
                    currency: 'RMB', due_date: null, status1: 'current'
                });
            }
        });
        ok(res, flat);
    } catch (err) { fail500(res, err); }
});

// 新增 / 修改 AR/AP（按 bu_no + YYYY_MM upsert）
router.post('/', async (req, res) => {
    try {
        const d = req.body;
        const { bu_no, YYYY_MM } = d;
        if (!bu_no || !YYYY_MM) return fail(res, '需要 bu_no 和 YYYY_MM');
        const YYYY = YYYY_MM.split('-')[0];
        await pool.execute(`
            INSERT INTO ermm_arap_detail (bu_no, YYYY, YYYY_MM, AR_amt, AP_amt, AR_ageing, AP_ageing, update_time)
            VALUES (?,?,?,?,?,?,?,NOW())
            ON DUPLICATE KEY UPDATE
                AR_amt=VALUES(AR_amt), AP_amt=VALUES(AP_amt),
                AR_ageing=VALUES(AR_ageing), AP_ageing=VALUES(AP_ageing),
                update_time=NOW()
        `, [bu_no, YYYY, YYYY_MM,
            d.AR_amt || 0, d.AP_amt || 0,
            d.AR_ageing || 0, d.AP_ageing || 0]);
        ok(res, null, '已保存');
    } catch (err) { fail500(res, err); }
});

// 修改單筆（按 uid）
router.put('/:uid', async (req, res) => {
    try {
        const d = req.body;
        const updates = Object.keys(d).filter(k => k !== 'uid' && k !== 'create_time')
            .map(k => `${k}=?`).join(',');
        const values = Object.keys(d).filter(k => k !== 'uid' && k !== 'create_time')
            .map(k => d[k]);
        values.push(req.params.uid);
        await pool.execute(`UPDATE ermm_arap_detail SET ${updates}, update_time=NOW() WHERE uid=?`, values);
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

// 刪除
router.delete('/:uid', async (req, res) => {
    try {
        await pool.execute('DELETE FROM ermm_arap_detail WHERE uid=?', [req.params.uid]);
        ok(res, null, '已刪除');
    } catch (err) { fail500(res, err); }
});

// 按月彙總 AR/AP (從 SO/PO 計算)
router.post('/recalc', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { bu_no } = req.body;
        if (!bu_no) return fail(res, '需要 bu_no');
        await conn.beginTransaction();

        // AR = Σ(unit_price × dn_qty)
        await conn.execute(`
            INSERT INTO ermm_arap_detail (bu_no, YYYY, YYYY_MM, AR_amt, update_time)
            SELECT ?, YYYY, YYYY_MM, SUM(unit_price * dn_qty), NOW()
            FROM ermm_erp_so WHERE bu_no=? AND YYYY_MM IS NOT NULL
            GROUP BY YYYY, YYYY_MM
            ON DUPLICATE KEY UPDATE AR_amt=VALUES(AR_amt), update_time=NOW()
        `, [bu_no, bu_no]);

        // AP = Σ(po_amount + vat_amt) WHERE 審核通過 AND 交付完成
        await conn.execute(`
            INSERT INTO ermm_arap_detail (bu_no, YYYY, YYYY_MM, AP_amt, update_time)
            SELECT ?, YYYY, YYYY_MM, SUM(po_amount + vat_amt), NOW()
            FROM ermm_erp_po WHERE bu_no=? AND YYYY_MM IS NOT NULL
              AND po_status='審核通過' AND po_sub_status='交付完成'
            GROUP BY YYYY, YYYY_MM
            ON DUPLICATE KEY UPDATE AP_amt=VALUES(AP_amt), update_time=NOW()
        `, [bu_no, bu_no]);

        // NULL 歸零
        await conn.execute('UPDATE ermm_arap_detail SET AR_amt=0 WHERE bu_no=? AND AR_amt IS NULL', [bu_no]);
        await conn.execute('UPDATE ermm_arap_detail SET AP_amt=0 WHERE bu_no=? AND AP_amt IS NULL', [bu_no]);

        await conn.commit();

        const [rows] = await conn.execute(
            'SELECT * FROM ermm_arap_detail WHERE bu_no=? ORDER BY YYYY_MM DESC', [bu_no]
        );
        ok(res, rows, 'AR/AP 重新計算完成');
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally {
        conn.release();
    }
});

// ===== CFO-07 应收应付账龄对账（从发票明细实时聚合）=====
/**
 * GET /aging — 按 type=AR|AP + 客户/供应商分组，返回 5 个 ageing bucket
 * Query: type, bu_no, client_id, YYYY_MM
 */
router.get('/aging', async (req, res) => {
    try {
        const { type = 'AR', bu_no, client_id, YYYY_MM } = req.query;
        const txType = type.toUpperCase();
        let sql = `
            SELECT
                i.uid AS invoice_uid, i.invoice_no, i.client_id, i.bu_no,
                i.sub_amt AS invoice_amt,
                COALESCE(i.payment, 0) AS paid_amt,
                (i.sub_amt - COALESCE(i.payment, 0)) AS unpaid_amt,
                COALESCE(i.pay_date, i.wk_date) AS invoice_date,
                DATEDIFF(CURDATE(), COALESCE(i.pay_date, i.wk_date)) AS days_outstanding
            FROM mgm_invoice_details i
            WHERE i.TX_type=? AND i.sub_amt > COALESCE(i.payment, 0)`;
        const params = [txType];
        if (bu_no) { sql += ' AND i.bu_no=?'; params.push(bu_no); }
        if (client_id) { sql += ' AND i.client_id LIKE ?'; params.push(`%${client_id}%`); }
        if (YYYY_MM) { sql += ' AND i.YYYY_MM=?'; params.push(YYYY_MM); }
        sql += ' ORDER BY i.client_id, i.sub_amt DESC';
        const [rows] = await pool.execute(sql, params);

        const groups = {};
        let totalUnpaid = 0, totalInvoice = 0;
        for (const r of rows) {
            const unpaid = Number(r.unpaid_amt);
            if (unpaid <= 0) continue;
            const g = groups[r.client_id] = groups[r.client_id] || {
                client_id: r.client_id, bu_no: r.bu_no, tx_type: txType,
                count: 0, total_invoice: 0, total_unpaid: 0,
                d0_30: 0, d31_60: 0, d61_90: 0, d91_180: 0, d180p: 0,
                invoices: []
            };
            g.count++;
            g.total_invoice += Number(r.invoice_amt);
            g.total_unpaid += unpaid;
            totalUnpaid += unpaid;
            totalInvoice += Number(r.invoice_amt);
            const d = Number(r.days_outstanding || 0);
            if (d <= 30) g.d0_30 += unpaid;
            else if (d <= 60) g.d31_60 += unpaid;
            else if (d <= 90) g.d61_90 += unpaid;
            else if (d <= 180) g.d91_180 += unpaid;
            else g.d180p += unpaid;
            g.invoices.push({
                invoice_uid: r.invoice_uid, invoice_no: r.invoice_no,
                invoice_date: r.invoice_date, invoice_amt: Number(r.invoice_amt),
                paid_amt: Number(r.paid_amt), unpaid_amt: unpaid, days_outstanding: d
            });
        }
        const list = Object.values(groups).sort((a,b) => b.total_unpaid - a.total_unpaid);
        ok(res, {
            type: txType,
            total_invoice: totalInvoice,
            total_unpaid: totalUnpaid,
            customer_count: list.length,
            groups: list
        });
    } catch (err) { fail500(res, err); }
});

/**
 * GET /aging/summary — 总体汇总（AR vs AP 并排）
 */
router.get('/aging/summary', async (req, res) => {
    try {
        const { bu_no } = req.query;
        const [all] = await pool.execute(`
            SELECT TX_type,
                   COUNT(*) invoice_count,
                   SUM(sub_amt) total_invoice,
                   SUM(sub_amt - COALESCE(payment,0)) total_unpaid,
                   SUM(CASE WHEN sub_amt > COALESCE(payment,0) THEN 1 ELSE 0 END) open_count
            FROM mgm_invoice_details
            WHERE TX_type IN ('AR','AP') AND sub_amt > 0
            ${bu_no ? 'AND bu_no=?' : ''}
            GROUP BY TX_type`, bu_no ? [bu_no] : []);

        const [buckets] = await pool.execute(`
            SELECT TX_type,
                SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(pay_date, wk_date)) <= 30
                    THEN sub_amt - COALESCE(payment,0) ELSE 0 END) d0_30,
                SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(pay_date, wk_date)) BETWEEN 31 AND 60
                    THEN sub_amt - COALESCE(payment,0) ELSE 0 END) d31_60,
                SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(pay_date, wk_date)) BETWEEN 61 AND 90
                    THEN sub_amt - COALESCE(payment,0) ELSE 0 END) d61_90,
                SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(pay_date, wk_date)) BETWEEN 91 AND 180
                    THEN sub_amt - COALESCE(payment,0) ELSE 0 END) d91_180,
                SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(pay_date, wk_date)) > 180
                    THEN sub_amt - COALESCE(payment,0) ELSE 0 END) d180p
            FROM mgm_invoice_details
            WHERE TX_type IN ('AR','AP') AND sub_amt > COALESCE(payment,0)
            ${bu_no ? 'AND bu_no=?' : ''}
            GROUP BY TX_type`, bu_no ? [bu_no] : []);

        ok(res, { totals: all, buckets });
    } catch (err) { fail500(res, err); }
});

module.exports = router;
