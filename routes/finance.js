/**
 * 財務入帳 / 報稅 / 勾稽對帳 路由
 *
 * 三大模組（對應 docs/財務核心業務流程圖.md）：
 *   1. 會計入帳（含 RUID）：原始憑證 → 校驗 → RUID → 科目映射 → 分錄 → 審核 → 過帳
 *   2. 報稅（含 RUID）：稅務資料 → RUID 關聯入帳 → 稅目識別 → 稅額計算 → 申報表 → 審核 → 申報 → 回執
 *   3. 勾稽對帳：RUID 雙台帳 → 勾稽引擎 → 匹配/金額一致性 → 差異預警
 *
 * RUID 規則：R{bu}{yyyymmddHHMMss}{3 位隨機}，全域唯一，寫入 fin_ruid_ledger 主台帳。
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');

// ============ 工具 ============
function genRUID(bu) {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const ts = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const rnd = String(Math.floor(Math.random()*900)+100);
    return `R${bu}${ts}${rnd}`;
}

async function createRUID(bu, bizType, sourceId, amount, remark) {
    const ruid = genRUID(bu);
    await pool.execute(
        `INSERT INTO fin_ruid_ledger (ruid, bu_no, biz_type, source_id, amount, remark) VALUES (?,?,?,?,?,?)`,
        [ruid, bu, bizType, sourceId, amount, remark || null]);
    return ruid;
}

function actor(req) {
    return req.headers['x-test-user'] || req.user?.user_id || 'SYSTEM';
}

// ============ 1. 會計科目 ============
router.get('/subjects', async (req, res) => {
    try {
        const { subject_type, is_active } = req.query;
        let sql = 'SELECT * FROM fin_account_subject WHERE 1=1';
        const p = [];
        if (subject_type) { sql += ' AND subject_type=?'; p.push(subject_type); }
        if (is_active !== undefined) { sql += ' AND is_active=?'; p.push(is_active); }
        sql += ' ORDER BY subject_code';
        const [rows] = await pool.execute(sql, p);
        ok(res, rows);
    } catch (e) { fail500(res, e); }
});

router.post('/subjects', async (req, res) => {
    try {
        const { subject_code, subject_name, subject_type, parent_code, balance_dir, remark } = req.body || {};
        if (!subject_code || !subject_name || !subject_type) return fail(res, '科目代碼/名稱/類別必填');
        await pool.execute(
            `INSERT INTO fin_account_subject (subject_code, subject_name, subject_type, parent_code, balance_dir, remark)
             VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE subject_name=VALUES(subject_name), subject_type=VALUES(subject_type), balance_dir=VALUES(balance_dir), remark=VALUES(remark)`,
            [subject_code, subject_name, subject_type, parent_code || null, balance_dir || 'DR', remark || null]);
        ok(res, { subject_code });
    } catch (e) { fail500(res, e); }
});

// ============ 2. 會計憑證（入帳） ============
// 列表
router.get('/vouchers', async (req, res) => {
    try {
        const { bu_no, YYYY_MM, status, keyword } = req.query;
        let sql = `SELECT v.*, u.subject_name AS acct_hint
                   FROM fin_voucher v
                   LEFT JOIN fin_voucher_entry e ON e.voucher_id=v.voucher_id AND e.entry_id=(
                       SELECT MIN(entry_id) FROM fin_voucher_entry WHERE voucher_id=v.voucher_id)
                   LEFT JOIN fin_account_subject u ON u.subject_code=e.subject_code
                   WHERE 1=1`;
        const p = [];
        if (bu_no) { sql += ' AND v.bu_no=?'; p.push(bu_no); }
        if (YYYY_MM) { sql += ' AND v.YYYY_MM=?'; p.push(YYYY_MM); }
        if (status) { sql += ' AND v.status=?'; p.push(status); }
        if (keyword) { sql += ' AND (v.voucher_no LIKE ? OR v.summary LIKE ?)'; p.push(`%${keyword}%`, `%${keyword}%`); }
        sql += ' ORDER BY v.voucher_date DESC, v.voucher_id DESC LIMIT 500';
        const [rows] = await pool.execute(sql, p);
        ok(res, rows);
    } catch (e) { fail500(res, e); }
});

// 單筆（含分錄）
router.get('/vouchers/:id', async (req, res) => {
    try {
        const [[v]] = await pool.execute('SELECT * FROM fin_voucher WHERE voucher_id=?', [req.params.id]);
        if (!v) return fail(res, '憑證不存在', 404);
        const [entries] = await pool.execute('SELECT * FROM fin_voucher_entry WHERE voucher_id=? ORDER BY entry_id', [req.params.id]);
        v.entries = entries;
        ok(res, v);
    } catch (e) { fail500(res, e); }
});

// 新建憑證（含分錄，自動生成 RUID）
router.post('/vouchers', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const d = req.body || {};
        const { bu_no, voucher_date, YYYY_MM, summary, entries = [] } = d;
        if (!bu_no || !voucher_date || !YYYY_MM) return fail(res, 'bu_no/日期/期間必填');
        if (!Array.isArray(entries) || entries.length < 2) return fail(res, '至少需 2 條分錄（借貸）');

        // 校驗：借貸平衡
        let td = 0, tc = 0;
        for (const e of entries) {
            if (!e.subject_code) return fail(res, '每條分錄需指定科目');
            td += Number(e.debit || 0);
            tc += Number(e.credit || 0);
        }
        if (Math.abs(td - tc) > 0.01) return fail(res, `借貸不平衡：借 ${td.toFixed(2)} / 貸 ${tc.toFixed(2)}`);

        const ruid = await createRUID(bu_no, 'VOUCHER', null, td, summary);
        const voucherNo = `V${bu_no}${YYYY_MM.replace('-', '')}${String(Date.now()).slice(-4)}`;

        const [r] = await conn.execute(`
            INSERT INTO fin_voucher (bu_no, ruid, voucher_no, voucher_date, YYYY_MM, summary, total_debit, total_credit, status, created_by)
            VALUES (?,?,?,?,?,?,?,?, 'DRAFT', ?)`,
            [bu_no, ruid, voucherNo, voucher_date, YYYY_MM, summary || null, td, tc, actor(req)]);
        const vid = r.insertId;

        // RUID 關聯來源單號
        await conn.execute('UPDATE fin_ruid_ledger SET source_id=? WHERE ruid=?', [voucherNo, ruid]);

        for (const e of entries) {
            const [[sub]] = await conn.execute('SELECT subject_name FROM fin_account_subject WHERE subject_code=?', [e.subject_code]);
            await conn.execute(`
                INSERT INTO fin_voucher_entry (voucher_id, ruid, subject_code, subject_name, debit, credit, summary, source_doc)
                VALUES (?,?,?,?,?,?,?,?)`,
                [vid, ruid, e.subject_code, sub?.subject_name || e.subject_code,
                 Number(e.debit || 0), Number(e.credit || 0), e.summary || null, e.source_doc || null]);
        }
        await conn.commit();
        ok(res, { voucher_id: vid, ruid, voucher_no: voucherNo }, '憑證已建立（DRAFT）');
    } catch (e) {
        await conn.rollback();
        fail500(res, e);
    } finally { conn.release(); }
});

// 提交審核
router.post('/vouchers/:id/submit', async (req, res) => {
    try {
        const [[v]] = await pool.execute('SELECT status FROM fin_voucher WHERE voucher_id=?', [req.params.id]);
        if (!v) return fail(res, '憑證不存在', 404);
        if (v.status !== 'DRAFT' && v.status !== 'REJECTED') return fail(res, '僅草稿或駁回狀態可提交');
        await pool.execute("UPDATE fin_voucher SET status='SUBMITTED' WHERE voucher_id=?", [req.params.id]);
        ok(res, null, '已提交審核');
    } catch (e) { fail500(res, e); }
});

// 審核通過
router.post('/vouchers/:id/approve', async (req, res) => {
    try {
        const [[v]] = await pool.execute('SELECT status FROM fin_voucher WHERE voucher_id=?', [req.params.id]);
        if (!v) return fail(res, '憑證不存在', 404);
        if (v.status !== 'SUBMITTED') return fail(res, '僅已提交狀態可審核');
        await pool.execute("UPDATE fin_voucher SET status='APPROVED', approved_by=?, approved_time=NOW() WHERE voucher_id=?",
            [actor(req), req.params.id]);
        ok(res, null, '審核通過');
    } catch (e) { fail500(res, e); }
});

// 駁回
router.post('/vouchers/:id/reject', async (req, res) => {
    try {
        const reason = req.body?.reason || '未通過審核';
        await pool.execute("UPDATE fin_voucher SET status='REJECTED', reject_reason=? WHERE voucher_id=? AND status='SUBMITTED'",
            [reason, req.params.id]);
        ok(res, null, '已駁回');
    } catch (e) { fail500(res, e); }
});

// 過帳（正式入帳）：狀態 → POSTED，RUID 與帳簿關聯
router.post('/vouchers/:id/post', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [[v]] = await conn.execute('SELECT * FROM fin_voucher WHERE voucher_id=?', [req.params.id]);
        if (!v) return fail(res, '憑證不存在', 404);
        if (v.status !== 'APPROVED') return fail(res, '僅審核通過狀態可過帳');

        // 更新科目累計餘額（簡化：以分錄彙總計算，實際可擴展為餘額表）
        const [entries] = await conn.execute('SELECT * FROM fin_voucher_entry WHERE voucher_id=?', [req.params.id]);
        for (const e of entries) {
            const delta = e.debit - e.credit;
            await conn.execute(
                `UPDATE fin_account_subject SET remark=CONCAT(IFNULL(remark,''), ' [過帳 ', ?, ']') WHERE subject_code=?`,
                [v.ruid, e.subject_code]);
        }

        await conn.execute("UPDATE fin_voucher SET status='POSTED', posted_time=NOW() WHERE voucher_id=?", [req.params.id]);
        await conn.commit();
        ok(res, { ruid: v.ruid }, '已正式過帳，RUID 已關聯帳簿');
    } catch (e) {
        await conn.rollback();
        fail500(res, e);
    } finally { conn.release(); }
});

// 科目餘額查詢（依期間彙總分錄）
router.get('/subject-balances', async (req, res) => {
    try {
        const { bu_no, YYYY_MM } = req.query;
        let sql = `
            SELECT s.subject_code, s.subject_name, s.subject_type, s.balance_dir,
                   COALESCE(SUM(e.debit),0) AS total_debit,
                   COALESCE(SUM(e.credit),0) AS total_credit
            FROM fin_account_subject s
            LEFT JOIN fin_voucher_entry e ON e.subject_code=s.subject_code
            LEFT JOIN fin_voucher v ON v.voucher_id=e.voucher_id AND v.status='POSTED'
            WHERE 1=1`;
        const p = [];
        if (bu_no) { sql += ' AND v.bu_no=?'; p.push(bu_no); }
        if (YYYY_MM) { sql += ' AND v.YYYY_MM=?'; p.push(YYYY_MM); }
        sql += ' GROUP BY s.subject_code ORDER BY s.subject_code';
        const [rows] = await pool.execute(sql, p);
        ok(res, rows.map(r => ({
            ...r,
            balance: Number(r.balance_dir) === 'CR' ? Number(r.total_credit) - Number(r.total_debit) : Number(r.total_debit) - Number(r.total_credit)
        })));
    } catch (e) { fail500(res, e); }
});

// ============ 3. 報稅 ============
// 稅目稅率配置（可擴展為表）
const TAX_RULES = {
    VAT: { name: '增值稅', rate: 0.13, base: '銷項稅額 - 進項稅額' },
    IT:  { name: '企業所得稅', rate: 0.25, base: '應納稅所得額' },
    ST:  { name: '印花稅', rate: 0.0003, base: '合同金額' }
};

// 申報表列表
router.get('/tax-returns', async (req, res) => {
    try {
        const { bu_no, tax_period, tax_type, status } = req.query;
        let sql = 'SELECT * FROM fin_tax_return WHERE 1=1';
        const p = [];
        if (bu_no) { sql += ' AND bu_no=?'; p.push(bu_no); }
        if (tax_period) { sql += ' AND tax_period=?'; p.push(tax_period); }
        if (tax_type) { sql += ' AND tax_type=?'; p.push(tax_type); }
        if (status) { sql += ' AND status=?'; p.push(status); }
        sql += ' ORDER BY tax_period DESC, return_id DESC LIMIT 500';
        const [rows] = await pool.execute(sql, p);
        ok(res, rows);
    } catch (e) { fail500(res, e); }
});

// 報稅明細表（年度彙總，含明細分錄與稅種合計，供匯出）
router.get('/tax-detail', async (req, res) => {
    try {
        const { bu_no, year, tax_type } = req.query;
        if (!bu_no || !year) return fail(res, 'bu_no 與 year 必填');
        let sql = `
            SELECT r.return_id, r.ruid, r.tax_type, r.tax_period, r.status,
                   r.taxable_amount AS return_taxable, r.tax_amount AS return_tax,
                   r.receipt_no, r.filed_time, r.remark AS return_remark,
                   i.item_name, i.subject_code, i.taxable_amount AS item_taxable,
                   i.tax_rate, i.tax_amount AS item_tax, i.remark AS item_remark
            FROM fin_tax_return r
            LEFT JOIN fin_tax_return_item i ON i.return_id = r.return_id
            WHERE r.bu_no=? AND r.tax_period LIKE ?
        `;
        const p = [bu_no, `${year}-%`];
        if (tax_type) { sql += ' AND r.tax_type=?'; p.push(tax_type); }
        sql += ' ORDER BY r.tax_period, r.return_id, i.item_id';
        const [rows] = await pool.execute(sql, p);

        const TAX_NAME = { VAT: '增值税', IT: '企业所得税', ST: '印花税' };
        const details = rows.map(x => ({
            return_id: x.return_id,
            ruid: x.ruid,
            tax_type: x.tax_type,
            tax_name: TAX_NAME[x.tax_type] || x.tax_type,
            tax_period: x.tax_period,
            status: x.status,
            receipt_no: x.receipt_no || '',
            filed_time: x.filed_time ? String(x.filed_time).slice(0, 19) : '',
            subject_code: x.subject_code || '',
            item_name: x.item_name || '',
            taxable_amount: Number(x.item_taxable ?? x.return_taxable ?? 0),
            tax_rate: Number(x.tax_rate || 0),
            tax_amount: Number(x.item_tax ?? x.return_tax ?? 0),
        }));

        // 按申報表匯總（避免明細多列時重複計）
        const returnsMap = new Map();
        for (const x of rows) {
            if (!returnsMap.has(x.return_id)) {
                returnsMap.set(x.return_id, {
                    tax_type: x.tax_type, tax_name: TAX_NAME[x.tax_type] || x.tax_type,
                    taxable: Number(x.return_taxable || 0), tax: Number(x.return_tax || 0),
                });
            }
        }
        const byType = {};
        let totalTaxable = 0, totalTax = 0;
        for (const v of returnsMap.values()) {
            if (!byType[v.tax_type]) byType[v.tax_type] = { tax_name: v.tax_name, taxable: 0, tax: 0, count: 0 };
            byType[v.tax_type].taxable += v.taxable;
            byType[v.tax_type].tax += v.tax;
            byType[v.tax_type].count += 1;
            totalTaxable += v.taxable;
            totalTax += v.tax;
        }

        ok(res, {
            bu_no, year,
            generated_at: new Date().toISOString(),
            return_count: returnsMap.size,
            item_count: details.length,
            summary: { by_type: byType, total_taxable: totalTaxable, total_tax: totalTax },
            details,
        });
    } catch (e) { fail500(res, e); }
});

// 建立申報表（自動 RUID + 關聯入帳記錄 + 稅額計算）
router.post('/tax-returns', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const { bu_no, tax_period, tax_type, items = [] } = req.body || {};
        if (!bu_no || !tax_period || !tax_type) return fail(res, 'bu_no/期間/稅種必填');
        const rule = TAX_RULES[tax_type];
        if (!rule) return fail(res, '不支援的稅種：' + tax_type);

        // 關聯該期間已過帳的入帳 RUID
        const [vouchers] = await conn.execute(
            `SELECT ruid, total_debit AS amount FROM fin_voucher WHERE bu_no=? AND YYYY_MM=? AND status='POSTED'`,
            [bu_no, tax_period]);

        // 稅額計算
        let taxable = 0, tax = 0;
        const itemsIns = [];
        for (const it of items) {
            const amt = Number(it.taxable_amount || 0);
            const rate = Number(it.tax_rate || rule.rate);
            const t = amt * rate;
            taxable += amt; tax += t;
            itemsIns.push(it);
        }

        const ruid = await createRUID(bu_no, 'TAX', null, tax, `${rule.name} 申報 ${tax_period}`);
        const [r] = await conn.execute(`
            INSERT INTO fin_tax_return (bu_no, ruid, tax_type, tax_period, taxable_amount, tax_amount, status)
            VALUES (?,?,?,?,?,?, 'CALCULATED')`,
            [bu_no, ruid, tax_type, tax_period, taxable, tax]);
        const rid = r.insertId;

        for (const it of itemsIns) {
            const amt = Number(it.taxable_amount || 0);
            const rate = Number(it.tax_rate || rule.rate);
            await conn.execute(`
                INSERT INTO fin_tax_return_item (return_id, ruid, subject_code, item_name, taxable_amount, tax_rate, tax_amount, remark)
                VALUES (?,?,?,?,?,?,?,?)`,
                [rid, ruid, it.subject_code || null, it.item_name || rule.name, amt, rate, amt * rate, it.remark || null]);
        }

        await conn.commit();
        ok(res, { return_id: rid, ruid, tax_amount: Math.round(tax * 100) / 100, linked_vouchers: vouchers.length },
            `已建立${rule.name}申報表（稅額 ${Math.round(tax*100)/100}，關聯 ${vouchers.length} 筆入帳）`);
    } catch (e) {
        await conn.rollback();
        fail500(res, e);
    } finally { conn.release(); }
});

// 審核通過
router.post('/tax-returns/:id/approve', async (req, res) => {
    try {
        await pool.execute("UPDATE fin_tax_return SET status='APPROVED' WHERE return_id=? AND status='CALCULATED'", [req.params.id]);
        ok(res, null, '審核通過');
    } catch (e) { fail500(res, e); }
});

// 提交申報（模擬稅務系統回執）
router.post('/tax-returns/:id/file', async (req, res) => {
    try {
        const [[t]] = await pool.execute('SELECT * FROM fin_tax_return WHERE return_id=?', [req.params.id]);
        if (!t) return fail(res, '申報表不存在', 404);
        if (t.status !== 'APPROVED') return fail(res, '僅審核通過狀態可提交申報');
        const receipt = `RX${t.bu_no}${t.tax_period.replace('-', '')}${String(Date.now()).slice(-6)}`;
        await pool.execute(
            "UPDATE fin_tax_return SET status='FILED', filed_time=NOW(), receipt_no=? WHERE return_id=?",
            [receipt, req.params.id]);
        // RUID 與申報記錄關聯
        await pool.execute('UPDATE fin_ruid_ledger SET source_id=? WHERE ruid=?', [`${t.tax_type}:${t.return_id}`, t.ruid]);
        ok(res, { receipt_no: receipt }, '申報成功，已取得稅務回執');
    } catch (e) { fail500(res, e); }
});

// 取得申報表（含明細）
router.get('/tax-returns/:id', async (req, res) => {
    try {
        const [[t]] = await pool.execute('SELECT * FROM fin_tax_return WHERE return_id=?', [req.params.id]);
        if (!t) return fail(res, '申報表不存在', 404);
        const [items] = await pool.execute('SELECT * FROM fin_tax_return_item WHERE return_id=? ORDER BY item_id', [req.params.id]);
        t.items = items;
        t.tax_name = TAX_RULES[t.tax_type]?.name || t.tax_type;
        ok(res, t);
    } catch (e) { fail500(res, e); }
});

// ============ 4. 勾稽對帳引擎 ============
// 執行勾稽：按期間比對入帳 RUID 與報稅 RUID
router.post('/reconciliation/run', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const { bu_no, period } = req.body || {};
        if (!bu_no || !period) return fail(res, 'bu_no/period 必填');

        // 清除該期間舊勾稽記錄
        await conn.execute('DELETE FROM fin_reconciliation WHERE bu_no=? AND period=?', [bu_no, period]);

        // 入帳記錄（已過帳）
        const [vouchers] = await conn.execute(
            `SELECT ruid, total_debit AS amount FROM fin_voucher WHERE bu_no=? AND YYYY_MM=? AND status='POSTED'`,
            [bu_no, period]);
        // 報稅記錄（已申報）
        const [taxes] = await conn.execute(
            `SELECT ruid, tax_amount AS amount FROM fin_tax_return WHERE bu_no=? AND tax_period=? AND status='FILED'`,
            [bu_no, period]);

        let matched = 0, amountDiff = 0, unmatched = 0;
        // 以入帳 RUID 為主，找對應金額的報稅記錄
        for (const v of vouchers) {
            const tax = taxes.find(t => Math.abs(Number(t.amount) - Number(v.amount)) <= 0.01);
            if (tax) {
                await conn.execute(
                    `INSERT INTO fin_reconciliation (bu_no, period, voucher_ruid, tax_ruid, voucher_amount, tax_amount, diff_amount, match_status)
                     VALUES (?,?,?,?,?,?,0,'MATCHED')`,
                    [bu_no, period, v.ruid, tax.ruid, v.amount, tax.amount]);
                matched++;
            } else {
                const nearTax = taxes.find(t => Math.abs(Number(t.amount) - Number(v.amount)) <= Math.abs(Number(v.amount)) * 0.1);
                const diff = nearTax ? Number(nearTax.amount) - Number(v.amount) : -Number(v.amount);
                await conn.execute(
                    `INSERT INTO fin_reconciliation (bu_no, period, voucher_ruid, tax_ruid, voucher_amount, tax_amount, diff_amount, match_status)
                     VALUES (?,?,?,?,?,?,?,?)`,
                    [bu_no, period, v.ruid, nearTax?.ruid || null, v.amount, nearTax?.amount || 0, diff,
                     nearTax ? 'AMOUNT_DIFF' : 'UNMATCHED']);
                if (nearTax) amountDiff++; else unmatched++;
            }
        }
        // 報稅端找不到入帳對應的
        for (const tax of taxes) {
            const exist = await conn.execute(
                'SELECT recon_id FROM fin_reconciliation WHERE bu_no=? AND period=? AND tax_ruid=?',
                [bu_no, period, tax.ruid]);
            if (exist[0].length === 0) {
                await conn.execute(
                    `INSERT INTO fin_reconciliation (bu_no, period, voucher_ruid, tax_ruid, voucher_amount, tax_amount, diff_amount, match_status)
                     VALUES (?,?,?,?,?,?,?, 'UNMATCHED')`,
                    [bu_no, period, null, tax.ruid, 0, tax.amount, Number(tax.amount)]);
                unmatched++;
            }
        }
        await conn.commit();
        ok(res, { matched, amount_diff: amountDiff, unmatched, total: matched + amountDiff + unmatched }, '勾稽完成');
    } catch (e) {
        await conn.rollback();
        fail500(res, e);
    } finally { conn.release(); }
});

// 勾稽查詢
router.get('/reconciliation', async (req, res) => {
    try {
        const { bu_no, period, match_status } = req.query;
        let sql = 'SELECT * FROM fin_reconciliation WHERE 1=1';
        const p = [];
        if (bu_no) { sql += ' AND bu_no=?'; p.push(bu_no); }
        if (period) { sql += ' AND period=?'; p.push(period); }
        if (match_status) { sql += ' AND match_status=?'; p.push(match_status); }
        sql += ' ORDER BY create_time DESC LIMIT 500';
        const [rows] = await pool.execute(sql, p);
        ok(res, rows);
    } catch (e) { fail500(res, e); }
});

// 處理差異（人工介入）
router.post('/reconciliation/:id/handle', async (req, res) => {
    try {
        const { remark } = req.body || {};
        await pool.execute(
            "UPDATE fin_reconciliation SET match_status='HANDLED', handled=1, remark=? WHERE recon_id=?",
            [remark || '人工處理', req.params.id]);
        ok(res, null, '已標記處理');
    } catch (e) { fail500(res, e); }
});

// ============ 5. RUID 主台帳查詢 ============
router.get('/ruids', async (req, res) => {
    try {
        const { bu_no, biz_type, status } = req.query;
        let sql = 'SELECT * FROM fin_ruid_ledger WHERE 1=1';
        const p = [];
        if (bu_no) { sql += ' AND bu_no=?'; p.push(bu_no); }
        if (biz_type) { sql += ' AND biz_type=?'; p.push(biz_type); }
        if (status) { sql += ' AND status=?'; p.push(status); }
        sql += ' ORDER BY create_time DESC LIMIT 500';
        const [rows] = await pool.execute(sql, p);
        ok(res, rows);
    } catch (e) { fail500(res, e); }
});

module.exports = router;
