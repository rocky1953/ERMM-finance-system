/**
 * 銀行貸款管理路由
 * 包含匯兌損益計算、利息日期更新
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, n } = require('../utils/response');

// 列表
router.get('/', async (req, res) => {
    try {
        const { bu_no, status1, type1 } = req.query;
        let sql = 'SELECT * FROM MGM_bank_loan_details WHERE 1=1';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (status1) { sql += ' AND status1=?'; params.push(status1); }
        if (type1) { sql += ' AND type1=?'; params.push(type1); }
        sql += ' ORDER BY bu_no, loan_id';
        const [rows] = await pool.execute(sql, params);

        // 計算 pay_days 和匯兌損益
        const today = new Date();
        for (const r of rows) {
            if (r.next_paydate) {
                const next = new Date(r.next_paydate);
                r.pay_days = Math.ceil((next - today) / (1000 * 60 * 60 * 24));
            }
            r.diff_amt = Number(r.loan_amt || 0) * Number(r.exchange_rate || 0);
            r.loss_flag = r.diff_amt < 0 ? 'Y' : 'N';
        }
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// 新增
router.post('/', async (req, res) => {
    try {
        const d = req.body;
        if (!d.bu_no) return fail(res, 'bu_no 為必填欄位', 400);
        if (!d.loan_id) return fail(res, 'loan_id 為必填欄位', 400);

        // 計算 next_paydate 和 pay_days
        let next_paydate = d.next_paydate;
        let pay_days = d.pay_days || 0;
        if (!next_paydate && d.last_paydate && d.pay_terms) {
            const last = new Date(d.last_paydate);
            next_paydate = new Date(last.setMonth(last.getMonth() + d.pay_terms)).toISOString().slice(0, 10);
        }
        if (next_paydate) {
            const next = new Date(next_paydate);
            pay_days = Math.ceil((next - new Date()) / (1000 * 60 * 60 * 24));
        }

        const [result] = await pool.execute(
            `INSERT INTO MGM_bank_loan_details (bu_no, YYYY, acct_no, type1, acct_amt, unit, loan_id,
               bank_id, branch_id, loan_type, pay_terms, terms_rate, interest_rate, begin_date, end_date,
               pay_days, payback_amt, loan_amt, exchange_rate, last_paydate, next_paydate, status1, loan_desc,
               diff_amt, loss_flag)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [n(d.bu_no), n(d.YYYY), n(d.acct_no), n(d.type1), n(d.acct_amt || 0), n(d.unit), n(d.loan_id),
             n(d.bank_id), n(d.branch_id), n(d.loan_type), n(d.pay_terms), n(d.terms_rate), n(d.interest_rate),
             n(d.begin_date), n(d.end_date), n(pay_days), n(d.payback_amt || 0), n(d.loan_amt || 0),
             n(d.exchange_rate || 1), n(d.last_paydate), n(next_paydate), n(d.status1 || '使用中'), n(d.loan_desc),
             n(d.diff_amt || 0), n(d.loss_flag || 'N')]
        );
        ok(res, { uid: result.insertId }, '銀行貸款已新增');
    } catch (err) { fail500(res, err); }
});

// 修改
router.put('/:uid', async (req, res) => {
    try {
        const d = req.body;
        await pool.execute(
            `UPDATE MGM_bank_loan_details SET bu_no=?, loan_id=?, bank_id=?, loan_type=?, pay_terms=?,
               terms_rate=?, interest_rate=?, exchange_rate=?, last_paydate=?, next_paydate=?,
               loan_amt=?, payback_amt=?, status1=?, loan_desc=? WHERE uid=?`,
            [n(d.bu_no), n(d.loan_id), n(d.bank_id), n(d.loan_type), n(d.pay_terms), n(d.terms_rate), n(d.interest_rate),
             n(d.exchange_rate), n(d.last_paydate), n(d.next_paydate), n(d.loan_amt), n(d.payback_amt), n(d.status1),
             n(d.loan_desc), n(req.params.uid)]
        );
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

// 刪除
router.delete('/:uid', async (req, res) => {
    try {
        await pool.execute('DELETE FROM MGM_bank_loan_details WHERE uid=?', [req.params.uid]);
        ok(res, null, '已刪除');
    } catch (err) { fail500(res, err); }
});

// 更新利息日期 + 匯兌損益 (批次)
router.post('/recalc', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { bu_no } = req.body;
        if (!bu_no) return fail(res, '需要 bu_no');
        await conn.beginTransaction();

        // 取得當前匯率 (從 CURRENCY 碼表)
        const [fx] = await conn.execute(
            "SELECT code_value, value_number1 FROM cams_system_codes WHERE code_type='CURRENCY' AND inuse_flag='USE'"
        );
        const fxMap = {};
        fx.forEach(r => fxMap[r.code_value] = Number(r.value_number1));

        // 更新 pay_days 和匯兌損益
        const [loans] = await conn.execute('SELECT * FROM MGM_bank_loan_details WHERE bu_no=?', [bu_no]);
        const today = new Date();
        let total_loss = 0;

        for (const loan of loans) {
            const updates = [];
            const params = [];

            // pay_days
            if (loan.next_paydate) {
                const next = new Date(loan.next_paydate);
                const days = Math.max(0, Math.ceil((next - today) / (1000 * 60 * 60 * 24)));
                updates.push('pay_days=?');
                params.push(days);
            }

            // 匯兌損益: amt1=loan_amt × exchange_rate, amt2=loan_amt × new_rate
            const newRate = fxMap[loan.unit] || Number(loan.exchange_rate || 1);
            const amt1 = Number(loan.loan_amt || 0) * Number(loan.exchange_rate || 1);
            const amt2 = Number(loan.loan_amt || 0) * newRate;
            const diff = amt2 - amt1;
            updates.push('diff_amt=?'); params.push(diff);
            updates.push('loss_flag=?'); params.push(diff < 0 ? 'Y' : 'N');
            updates.push('exchange_rate=?'); params.push(newRate);

            if (updates.length > 0) {
                params.push(loan.uid);
                await conn.execute(`UPDATE MGM_bank_loan_details SET ${updates.join(',')} WHERE uid=?`, params);
            }
            if (diff < 0) total_loss += Math.abs(diff);
        }

        await conn.commit();
        ok(res, { loan_count: loans.length, total_exchange_loss: total_loss },
           `銀行貸款更新完成(${loans.length}筆, 匯兌損失 ${total_loss.toFixed(2)})`);
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally {
        conn.release();
    }
});

module.exports = router;
