/**
 * CTO-05 合同主檔路由
 * 採購合同 / 銷售合同 / 服務合同 / 框架協議 的 CRUD + 查詢 + 到期預警
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const audit = require('../services/audit');
const { perms, readScope, applyScope } = require('../middleware/perms');

// ===== 列表查詢（支持 bu_no 數據範圍過濾）=====
router.get('/', readScope('contract'), async (req, res) => {
    try {
        const { bu_no, contract_type, contract_status, partner_name, contract_no, page = 1, page_size = 20 } = req.query;

        let sql = `SELECT c.*, p.po_id, p.xitems as po_item
                   FROM ermm_contract c
                   LEFT JOIN ermm_erp_po p ON p.uid=c.po_uid
                   WHERE 1=1`;
        const params = [];

        // 數據範圍（injectDataScope 已注入 req.dataScope）
        if (req.dataScope?.allowedBus && req.dataScope.allowedBus.length) {
            const ph = req.dataScope.allowedBus.map(() => '?').join(',');
            sql += ` AND c.bu_no IN (${ph})`;
            params.push(...req.dataScope.allowedBus);
        } else if (req.dataScope?.type === 'ALL') {
            // 全權限，看所有
        } else if (bu_no) {
            sql += ' AND c.bu_no=?'; params.push(bu_no);
        }

        if (contract_type) { sql += ' AND c.contract_type=?'; params.push(contract_type); }
        if (contract_status) { sql += ' AND c.contract_status=?'; params.push(contract_status); }
        if (partner_name) { sql += ' AND c.partner_name LIKE ?'; params.push(`%${partner_name}%`); }
        if (contract_no) { sql += ' AND c.contract_no LIKE ?'; params.push(`%${contract_no}%`); }

        sql += ' ORDER BY c.create_time DESC';

        const ps = Math.max(1, Number(page_size));
        sql += ' LIMIT ? OFFSET ?';
        params.push(ps, (Math.max(1, Number(page)) - 1) * ps);

        const [rows] = await pool.execute(sql, params);

        // 解析 JSON 字段
        for (const r of rows) {
            if (r.payment_terms) { try { r.payment_terms = typeof r.payment_terms === 'string' ? JSON.parse(r.payment_terms) : r.payment_terms; } catch {} }
        }

        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ===== 合同類型選項 =====
router.get('/types', async (req, res) => {
    try {
        const [t1] = await pool.execute('SELECT DISTINCT contract_type FROM ermm_contract WHERE bu_no IN ("HM","HN","SZ")');
        const [t2] = await pool.execute('SELECT DISTINCT contract_status FROM ermm_contract WHERE bu_no IN ("HM","HN","SZ")');
        ok(res, {
            contract_types: [...new Set([...t1.map(r => r.contract_type), '采购', '销售', '服务', '框架协议', '保密协议'])].filter(Boolean),
            contract_statuses: [...new Set([...t2.map(r => r.contract_status), 'ACTIVE', 'EXPIRED', 'TERMINATED', 'DRAFT'])].filter(Boolean),
        });
    } catch (err) { fail500(res, err); }
});

// ===== 合同統計（儀表板用）=====
router.get('/stats', readScope('contract'), async (req, res) => {
    try {
        const { bu_no } = req.query;
        let sql = `SELECT
                     contract_type, contract_status,
                     COUNT(*) as cnt,
                     SUM(CASE WHEN contract_amount IS NOT NULL AND contract_amount > 0 THEN contract_amount ELSE 0 END) as total_amount
                   FROM ermm_contract c
                   WHERE 1=1`;
        const params = [];
        if (req.dataScope?.allowedBus && req.dataScope.allowedBus.length) {
            const ph = req.dataScope.allowedBus.map(() => '?').join(',');
            sql += ` AND c.bu_no IN (${ph})`;
            params.push(...req.dataScope.allowedBus);
        } else if (bu_no) { sql += ' AND c.bu_no=?'; params.push(bu_no); }

        const [rows] = await pool.execute(sql + ' GROUP BY contract_type, contract_status', params);

        // 到期預警（簡化）
        let expSql = `SELECT COUNT(*) as cnt FROM ermm_contract
                      WHERE contract_status='ACTIVE'
                        AND expire_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)`;
        const expParams = [];
        if (req.dataScope?.allowedBus && req.dataScope.allowedBus.length) {
            const ph = req.dataScope.allowedBus.map(() => '?').join(',');
            expSql += ` AND bu_no IN (${ph})`;
            expParams.push(...req.dataScope.allowedBus);
        } else if (bu_no) {
            expSql += ' AND bu_no=?';
            expParams.push(bu_no);
        }
        const [expiring] = await pool.execute(expSql, expParams);

        ok(res, { breakdown: rows, expiring_90d: expiring[0].cnt });
    } catch (err) { fail500(res, err); }
});

// ===== 關聯 PO 查詢（放在 /:uid 之前，避免被參數路由攔截）=====
router.get('/po-options', async (req, res) => {
    try {
        const { bu_no, keyword } = req.query;
        let sql = `SELECT uid, po_id, supplier_name, po_date, po_amount, po_status, xitems
                   FROM ermm_erp_po WHERE 1=1`;
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (keyword) { sql += ' AND (po_id LIKE ? OR supplier_name LIKE ? OR xitems LIKE ?)';
            params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
        sql += ' ORDER BY po_date DESC LIMIT 50';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ===== 詳情 =====
router.get('/:uid', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM ermm_contract WHERE uid=?', [req.params.uid]);
        if (!rows[0]) return fail(res, '合同不存在', 404);
        const r = rows[0];
        if (r.payment_terms) { try { r.payment_terms = typeof r.payment_terms === 'string' ? JSON.parse(r.payment_terms) : r.payment_terms; } catch {} }
        ok(res, r);
    } catch (err) { fail500(res, err); }
});

// ===== 新增合同 =====
router.post('/', perms('contract','CREATE'), async (req, res) => {
    try {
        const b = req.body;
        if (!b.contract_no || !b.contract_name || !b.bu_no || !b.partner_name) {
            return fail(res, '缺少必要字段: contract_no/contract_name/bu_no/partner_name', 400);
        }
        const [dup] = await pool.execute(
            'SELECT uid FROM ermm_contract WHERE contract_no=? AND bu_no=?',
            [b.contract_no, b.bu_no]);
        if (dup[0]) return fail(res, '合同編號已存在', 409);

        const [ins] = await pool.execute(
            `INSERT INTO ermm_contract
                (contract_no, contract_name, contract_type, contract_cat, bu_no, partner_name, partner_type,
                 contract_amount, currency, contract_basis, sign_date, effective_date, expire_date,
                 po_id, po_uid, so_id, so_uid,
                 payment_terms, settlement_type, warranty_period, penalty_clause,
                 attachment_url, contract_status, review_status, remark, create_user)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [b.contract_no, b.contract_name, b.contract_type || '采购', b.contract_cat || 'PO對應',
             b.bu_no, b.partner_name, b.partner_type || 'SUPPLIER',
             b.contract_amount ?? null, b.currency || 'RMB', b.contract_basis || 'Fixed',
             b.sign_date || null, b.effective_date || null, b.expire_date || null,
             b.po_id || null, b.po_uid || null, b.so_id || null, b.so_uid || null,
             b.payment_terms ? JSON.stringify(b.payment_terms) : null,
             b.settlement_type || null, b.warranty_period || null, b.penalty_clause || null,
             b.attachment_url || null, b.contract_status || 'ACTIVE', b.review_status || 'REVIEWED',
             b.remark || null, req.user?.user_id || null]
        );

        audit.log(req, { module: 'contracts', action: 'CREATE',
            businessType: 'CONTRACT', businessId: b.contract_no,
            summary: `新增合同 ${b.contract_no} ${b.contract_name} (${b.bu_no})`,
            detail: b });

        ok(res, { uid: ins.insertId, contract_no: b.contract_no });
    } catch (err) { fail500(res, err); }
});

// ===== 更新合同 =====
router.put('/:uid', perms('contract','UPDATE'), async (req, res) => {
    try {
        const [old] = await pool.execute('SELECT * FROM ermm_contract WHERE uid=?', [req.params.uid]);
        if (!old[0]) return fail(res, '合同不存在', 404);

        const b = req.body;
        const fields = [];
        const values = [];
        const simpleFields = ['contract_name','contract_type','contract_cat','partner_name','partner_type',
            'contract_amount','currency','contract_basis','sign_date','effective_date','expire_date',
            'po_id','po_uid','so_id','so_uid',
            'settlement_type','warranty_period','penalty_clause','attachment_url',
            'contract_status','review_status','remark','inuse_flag'];
        for (const f of simpleFields) {
            if (b[f] !== undefined) { fields.push(`${f}=?`); values.push(b[f]); }
        }
        if (b.payment_terms !== undefined) {
            fields.push('payment_terms=?');
            values.push(b.payment_terms ? JSON.stringify(b.payment_terms) : null);
        }

        if (fields.length === 0) return fail(res, '無更新字段');
        values.push(req.params.uid);

        await pool.execute(
            `UPDATE ermm_contract SET ${fields.join(',')}, update_time=NOW() WHERE uid=?`, values);

        audit.log(req, { module: 'contracts', action: 'UPDATE',
            businessType: 'CONTRACT', businessId: old[0].contract_no,
            summary: `更新合同 ${old[0].contract_no} (狀態→${b.contract_status || old[0].contract_status})`,
            before: old[0], after: b });

        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

// ===== 刪除合同（邏輯）=====
router.delete('/:uid', perms('contract','DELETE'), async (req, res) => {
    try {
        const [old] = await pool.execute('SELECT * FROM ermm_contract WHERE uid=?', [req.params.uid]);
        if (!old[0]) return fail(res, '合同不存在', 404);

        await pool.execute('UPDATE ermm_contract SET inuse_flag=0, update_time=NOW() WHERE uid=?', [req.params.uid]);

        audit.log(req, { module: 'contracts', action: 'DELETE',
            businessType: 'CONTRACT', businessId: old[0].contract_no,
            summary: `刪除合同 ${old[0].contract_no} (${old[0].contract_name})`,
            before: old[0] });

        ok(res, null, '已刪除');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
