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
            FROM ERMM_ARAP_detail WHERE 1=1`;
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
            FROM ERMM_ARAP_detail WHERE 1=1`;
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
        const YYYY = YYYY_MM.split('/')[0];
        await pool.execute(`
            INSERT INTO ERMM_ARAP_detail (bu_no, YYYY, YYYY_MM, AR_amt, AP_amt, AR_ageing, AP_ageing, update_time)
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
        await pool.execute(`UPDATE ERMM_ARAP_detail SET ${updates}, update_time=NOW() WHERE uid=?`, values);
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

// 刪除
router.delete('/:uid', async (req, res) => {
    try {
        await pool.execute('DELETE FROM ERMM_ARAP_detail WHERE uid=?', [req.params.uid]);
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
            INSERT INTO ERMM_ARAP_detail (bu_no, YYYY, YYYY_MM, AR_amt, update_time)
            SELECT ?, YYYY, YYYY_MM, SUM(unit_price * dn_qty), NOW()
            FROM ERMM_erp_SO WHERE bu_no=? AND YYYY_MM IS NOT NULL
            GROUP BY YYYY, YYYY_MM
            ON DUPLICATE KEY UPDATE AR_amt=VALUES(AR_amt), update_time=NOW()
        `, [bu_no, bu_no]);

        // AP = Σ(po_amount + vat_amt) WHERE 審核通過 AND 交付完成
        await conn.execute(`
            INSERT INTO ERMM_ARAP_detail (bu_no, YYYY, YYYY_MM, AP_amt, update_time)
            SELECT ?, YYYY, YYYY_MM, SUM(po_amount + vat_amt), NOW()
            FROM ermm_erp_po WHERE bu_no=? AND YYYY_MM IS NOT NULL
              AND po_status='審核通過' AND po_sub_status='交付完成'
            GROUP BY YYYY, YYYY_MM
            ON DUPLICATE KEY UPDATE AP_amt=VALUES(AP_amt), update_time=NOW()
        `, [bu_no, bu_no]);

        // NULL 歸零
        await conn.execute('UPDATE ERMM_ARAP_detail SET AR_amt=0 WHERE bu_no=? AND AR_amt IS NULL', [bu_no]);
        await conn.execute('UPDATE ERMM_ARAP_detail SET AP_amt=0 WHERE bu_no=? AND AP_amt IS NULL', [bu_no]);

        await conn.commit();

        const [rows] = await conn.execute(
            'SELECT * FROM ERMM_ARAP_detail WHERE bu_no=? ORDER BY YYYY_MM DESC', [bu_no]
        );
        ok(res, rows, 'AR/AP 重新計算完成');
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally {
        conn.release();
    }
});

module.exports = router;
