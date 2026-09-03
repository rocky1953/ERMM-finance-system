/**
 * PO 暫存 ermm_temp_po CRUD
 * 批次管線 Step1 從這裡同步到 ermm_erp_po
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, n } = require('../utils/response');

router.get('/', async (req, res) => {
    try {
        const { bu_no, batch_id } = req.query;
        let sql = 'SELECT * FROM ermm_temp_po WHERE 1=1';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (batch_id) { sql += ' AND batch_id=?'; params.push(batch_id); }
        sql += ' ORDER BY bu_no, po_date DESC, uid DESC';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.get('/:uid', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM ermm_temp_po WHERE uid=?', [req.params.uid]);
        if (rows.length === 0) return fail(res, '記錄不存在', 404);
        ok(res, rows[0]);
    } catch (err) { fail500(res, err); }
});

router.post('/', async (req, res) => {
    try {
        const d = req.body;
        const qty = Number(d.po_qty || 0);
        const up = Number(d.unit_price || 0);
        const rate = Number(d.exchange_rate || 1);
        const amt = d.po_amount != null ? Number(d.po_amount) : Math.round(qty * up * 100) / 100;
        const [r] = await pool.execute(`
            INSERT INTO ermm_temp_po (bu_no, po_id, supplier_name, xitems, po_date, po_qty, unit_price, exchange_rate, po_amount, vat_amt, batch_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
        `, [
            n(d.bu_no), n(d.po_id), n(d.supplier_name), n(d.xitems),
            d.po_date || null, qty, up, rate, amt, Number(d.vat_amt || 0), n(d.batch_id)
        ]);
        ok(res, { uid: r.insertId }, '已新增 PO 暫存');
    } catch (err) { fail500(res, err); }
});

router.put('/:uid', async (req, res) => {
    try {
        const d = req.body;
        const updates = Object.keys(d).filter(k => k !== 'uid' && k !== 'sync_time')
            .map(k => `${k}=?`).join(',');
        const values = Object.keys(d).filter(k => k !== 'uid' && k !== 'sync_time')
            .map(k => d[k]);
        values.push(req.params.uid);
        await pool.execute(`UPDATE ermm_temp_po SET ${updates} WHERE uid=?`, values);
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

router.delete('/:uid', async (req, res) => {
    try {
        await pool.execute('DELETE FROM ermm_temp_po WHERE uid=?', [req.params.uid]);
        ok(res, null, '已刪除');
    } catch (err) { fail500(res, err); }
});

// 清除某個 batch 的暫存（批次管線 Step1 跑前的清理）
router.delete('/batch/:batch_id', async (req, res) => {
    try {
        const [r] = await pool.execute('DELETE FROM ermm_temp_po WHERE batch_id=?', [req.params.batch_id]);
        ok(res, null, `已清除 ${r.affectedRows} 筆`);
    } catch (err) { fail500(res, err); }
});

module.exports = router;
