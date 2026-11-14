/**
 * PO 收货单 (GRN) 路由
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, n } = require('../utils/response');

// ===== 列表 =====
router.get('/', async (req, res) => {
    try {
        const { bu_no, po_id, YYYY_MM, supplier_name } = req.query;
        let sql = `SELECT g.*, p.po_qty, p.unit_price, p.po_amount_local AS po_amount
                   FROM po_grn g
                   LEFT JOIN ermm_erp_po p ON p.uid=g.po_uid
                   WHERE 1=1`;
        const params = [];
        if (bu_no) { sql += ' AND g.bu_no=?'; params.push(bu_no); }
        if (po_id) { sql += ' AND g.po_id LIKE ?'; params.push(`%${po_id}%`); }
        if (YYYY_MM) { sql += ' AND DATE_FORMAT(g.grn_date, "%Y-%m")=?'; params.push(YYYY_MM); }
        if (supplier_name) { sql += ' AND g.supplier_name LIKE ?'; params.push(`%${supplier_name}%`); }
        sql += ' ORDER BY g.grn_date DESC, g.uid DESC LIMIT 500';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ===== PO 下拉（供收货时选择）=====
router.get('/po-options', async (req, res) => {
    try {
        const { bu_no } = req.query;
        let sql = 'SELECT uid, po_id, bu_no, supplier_name, xitems, po_qty, unit_price, po_amount FROM ermm_erp_po WHERE 1=1';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        sql += ' AND po_status NOT IN ("已完成","Closed") ORDER BY po_date DESC LIMIT 200';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ===== 详情 =====
router.get('/:uid', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT g.*, p.po_qty, p.unit_price, p.po_amount_local AS po_amount
             FROM po_grn g LEFT JOIN ermm_erp_po p ON p.uid=g.po_uid WHERE g.uid=?`,
            [req.params.uid]
        );
        if (!rows.length) return fail(res, '不存在', 404);
        ok(res, rows[0]);
    } catch (err) { fail500(res, err); }
});

// ===== 新建 =====
router.post('/', async (req, res) => {
    try {
        const d = req.body;
        const po_uid = Number(d.po_uid) || null;
        const po_id = d.po_id || null;

        // 从 PO 自动带出供应商/料件/单价
        let supplier_name = d.supplier_name, xitems = d.xitems, unit_price = Number(d.unit_price) || 0;
        if (po_uid && !supplier_name) {
            const [[po]] = await pool.execute('SELECT supplier_name, xitems, unit_price FROM ermm_erp_po WHERE uid=?', [po_uid]);
            if (po) {
                supplier_name = po.supplier_name;
                if (!xitems) xitems = po.xitems;
                if (!unit_price) unit_price = Number(po.unit_price) || 0;
            }
        }

        const grn_qty = Number(d.grn_qty) || 0;
        const [r] = await pool.execute(`
            INSERT INTO po_grn (bu_no, po_uid, po_id, xitems, supplier_name, grn_date, grn_qty, unit_price, remark)
            VALUES (?,?,?,?,?,?,?,?,?)`,
            [n(d.bu_no), po_uid, po_id, xitems, supplier_name, d.grn_date || null, grn_qty, unit_price, d.remark || null]
        );
        ok(res, { uid: r.insertId }, '收货单已登记');
    } catch (err) { fail500(res, err); }
});

// ===== 修改 =====
router.put('/:uid', async (req, res) => {
    try {
        const d = req.body;
        const updates = [];
        const values = [];
        for (const k of ['bu_no','po_uid','po_id','xitems','supplier_name','grn_date','grn_qty','unit_price','remark']) {
            if (k in d) { updates.push(`${k}=?`); values.push(d[k] === undefined ? null : d[k]); }
        }
        if (!updates.length) return fail(res, '无更新字段', 400);
        values.push(req.params.uid);
        await pool.execute(`UPDATE po_grn SET ${updates.join(',')}, update_time=NOW() WHERE uid=?`, values);
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

// ===== 删除 =====
router.delete('/:uid', async (req, res) => {
    try {
        // 如已参与匹配，禁止删除
        const [[m]] = await pool.execute('SELECT COUNT(*) c FROM po_match_result WHERE grn_uid=?', [req.params.uid]);
        if (Number(m.c) > 0) return fail(res, '已参与匹配，无法删除', 400);
        await pool.execute('DELETE FROM po_grn WHERE uid=?', [req.params.uid]);
        ok(res, null, '已删除');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
