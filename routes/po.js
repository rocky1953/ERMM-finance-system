/**
 * 採購單 ermm_erp_po CRUD
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, n } = require('../utils/response');

router.get('/', async (req, res) => {
    try {
        const { bu_no, YYYY_MM, po_status, limit } = req.query;
        let sql = 'SELECT * FROM ermm_erp_po WHERE 1=1';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (YYYY_MM) { sql += ' AND YYYY_MM=?'; params.push(YYYY_MM); }
        if (po_status) { sql += ' AND po_status=?'; params.push(po_status); }
        sql += ' ORDER BY po_date DESC, uid DESC LIMIT ' + (limit || 200);
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.get('/:uid', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM ermm_erp_po WHERE uid=?', [req.params.uid]);
        if (rows.length === 0) return fail(res, '記錄不存在', 404);
        ok(res, rows[0]);
    } catch (err) { fail500(res, err); }
});

router.post('/', async (req, res) => {
    try {
        const d = req.body;
        let YYYY = d.YYYY, MM = d.MM;
        if (d.YYYY_MM && !YYYY) YYYY = d.YYYY_MM.split('/')[0];
        if (d.YYYY_MM && !MM) MM = d.YYYY_MM.split('/')[1];
        // 若給了 po_date 但沒給 YYYY_MM，自動從日期派生
        let YYYY_MM = d.YYYY_MM;
        if (!YYYY_MM && d.po_date) {
            const dt = new Date(d.po_date);
            YYYY_MM = `${dt.getFullYear()}/${String(dt.getMonth()+1).padStart(2,'0')}`;
            YYYY = String(dt.getFullYear());
            MM = String(dt.getMonth()+1).padStart(2,'0');
        }
        // 自動計算 po_amount = qty * unit_price
        const qty = Number(d.po_qty || 0);
        const up = Number(d.unit_price || 0);
        const amt = d.po_amount != null ? Number(d.po_amount) : Math.round(qty * up * 100) / 100;
        const rate = Number(d.exchange_rate || 1);
        const amtLocal = d.po_amount_local != null ? Number(d.po_amount_local) : Math.round(amt * rate * 100) / 100;
        const upLocal = d.unit_price_local != null ? Number(d.unit_price_local) : Math.round(up * rate * 1000000) / 1000000;

        const [r] = await pool.execute(`
            INSERT INTO ermm_erp_po (bu_no, po_id, supplier_name, xitems, po_date, YYYY, MM, YYYY_MM,
                po_qty, unit_price, unit_price_local, exchange_rate, po_amount, po_amount_local, vat_amt,
                po_status, po_sub_status, supplier_type, inventory_qty, batch_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `, [
            n(d.bu_no), n(d.po_id), n(d.supplier_name), n(d.xitems), d.po_date || null,
            n(YYYY), n(MM), n(YYYY_MM),
            qty, up, upLocal, rate, amt, amtLocal, Number(d.vat_amt || 0),
            d.po_status || '未審核', d.po_sub_status || '未交付', n(d.supplier_type),
            Number(d.inventory_qty || 0), n(d.batch_id)
        ]);
        ok(res, { uid: r.insertId }, '已新增採購單');
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
        await pool.execute(`UPDATE ermm_erp_po SET ${updates} WHERE uid=?`, values);
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

router.delete('/:uid', async (req, res) => {
    try {
        await pool.execute('DELETE FROM ermm_erp_po WHERE uid=?', [req.params.uid]);
        ok(res, null, '已刪除');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
