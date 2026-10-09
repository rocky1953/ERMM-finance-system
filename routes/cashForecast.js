/**
 * 現金流量預測路由
 * 未來 13 週滾動預測：結合應收到期、應付到期、貸款還本
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');

const DEFAULT_SAFE_FLOOR = 3000000;   // 安全水位下限（元）：3 百萬
const DEFAULT_SAFE_WEEKS = 3;          // 啟發式：未來週平均流出 × N 週

// 取得 BU 的安全水位（元）；無設定時依「未來週平均流出 × 週數」啟發式產生並落庫，便於後續調整
async function getSafeLevel(buNo, avgWeeklyOutflow) {
    const [rows] = await pool.execute(
        `SELECT safe_amount FROM mgm_cash_safe_level WHERE bu_no=? LIMIT 1`, [buNo]);
    if (rows.length > 0) return Number(rows[0].safe_amount) || 0;

    const heuristic = Math.max(
        DEFAULT_SAFE_FLOOR,
        Math.round((Number(avgWeeklyOutflow) || 0) * DEFAULT_SAFE_WEEKS)
    );
    try {
        await pool.execute(
            `INSERT INTO mgm_cash_safe_level (bu_no, safe_amount, set_by, set_by_name, remark)
             VALUES (?,?, 'SYSTEM', '系統預設', '依未來週平均流出 × 3 自動產生')`,
            [buNo, heuristic]);
    } catch (e) {
        // 並發插入忽略
    }
    return heuristic;
}

// 13 週現金預測
router.get('/weekly', async (req, res) => {
    try {
        const { bu_no, weeks } = req.query;
        if (!bu_no) return fail(res, '需要 bu_no');
        const w = Math.min(26, parseInt(weeks) || 13);

        // 1. 當前現金餘額（現金日記結餘）
        const [cashRows] = await pool.execute(`
            SELECT
                SUM(CASE WHEN UPPER(DB_CR)='DR' THEN sub_amt ELSE -sub_amt END) AS balance
            FROM mgm_casher_details
            WHERE bu_no=?
        `, [bu_no]);
        let balance = Number(cashRows[0]?.balance || 0);

        // 2. 應收帳款：取最近一期 AR_amt，AR_ageing 為逾期金額（回收率較低）
        const [arRows] = await pool.execute(`
            SELECT AR_amt, AR_ageing
            FROM ermm_arap_detail
            WHERE bu_no=? AND AR_amt IS NOT NULL
            ORDER BY YYYY_MM DESC
            LIMIT 1
        `, [bu_no]);
        const ar = arRows[0] || { AR_amt: 0, AR_ageing: 0 };
        const arTotal = Number(ar.AR_amt || 0);
        const arOverdue = Number(ar.AR_ageing || 0);
        // 回收率假設：正常應收 80% 可在未來 6 週回收，逾期部分 30%
        const arCollectible = (arTotal - arOverdue) * 0.8 + arOverdue * 0.3;
        const arInflow = arCollectible / Math.min(w, 6);

        // 3. 應付帳款：取最近一期 AP_amt
        const [apRows] = await pool.execute(`
            SELECT AP_amt
            FROM ermm_arap_detail
            WHERE bu_no=? AND AP_amt IS NOT NULL
            ORDER BY YYYY_MM DESC
            LIMIT 1
        `, [bu_no]);
        const apTotal = Number(apRows[0]?.AP_amt || 0);
        const apOutflow = apTotal / Math.min(w, 6);

        // 4. 貸款還本付息（未來 w 週平均分攤）
        const [loanRows] = await pool.execute(`
            SELECT SUM(loan_amt) AS loan_total
            FROM mgm_bank_loan_details
            WHERE bu_no=?
        `, [bu_no]);
        const loanOutflow = Number(loanRows[0]?.loan_total || 0) * 0.02; // 每週約 2% 攤還

        const weeklyOutflow = apOutflow + loanOutflow;
        // 5. 安全水位（從設定表讀取，無則啟發式產生並落庫）
        const safeLevel = await getSafeLevel(bu_no, weeklyOutflow);

        // 6. 產生每週預測
        const forecast = [];
        for (let i = 1; i <= w; i++) {
            const inflow = arInflow;
            const outflow = weeklyOutflow;
            balance += inflow - outflow;
            forecast.push({
                week: i,
                start_balance: Math.round((balance - inflow + outflow) * 100) / 100,
                inflow: Math.round(inflow * 100) / 100,
                outflow: Math.round(outflow * 100) / 100,
                end_balance: Math.round(balance * 100) / 100,
                is_safe: balance >= safeLevel,
                safe_level: safeLevel
            });
        }

        // 7. 彙總
        const totalInflow = forecast.reduce((s, f) => s + f.inflow, 0);
        const totalOutflow = forecast.reduce((s, f) => s + f.outflow, 0);
        const minBalance = Math.min(...forecast.map(f => f.end_balance));
        const minWeek = forecast.find(f => f.end_balance === minBalance)?.week;

        ok(res, {
            current_balance: Number(cashRows[0]?.balance || 0),
            total_inflow: Math.round(totalInflow * 100) / 100,
            total_outflow: Math.round(totalOutflow * 100) / 100,
            min_balance: Math.round(minBalance * 100) / 100,
            min_week: minWeek,
            safe_level: safeLevel,
            weeks: forecast
        });
    } catch (err) { fail500(res, err); }
});

// 查詢安全水位設定
router.get('/safe-level', async (req, res) => {
    try {
        const { bu_no } = req.query;
        if (!bu_no) return fail(res, '需要 bu_no');
        const [rows] = await pool.execute(
            `SELECT bu_no, safe_amount, set_by, set_by_name, set_time, remark
               FROM mgm_cash_safe_level WHERE bu_no=?`, [bu_no]);
        if (rows.length === 0) {
            return ok(res, { bu_no, safe_amount: null, remark: null, is_default: true });
        }
        ok(res, { ...rows[0], is_default: (rows[0].set_by || '') === 'SYSTEM' });
    } catch (err) { fail500(res, err); }
});

// 設定/更新安全水位（UPSERT）
router.put('/safe-level', async (req, res) => {
    try {
        const { bu_no, safe_amount, remark } = req.body || {};
        if (!bu_no) return fail(res, '需要 bu_no');
        const amt = Number(safe_amount);
        if (!Number.isFinite(amt) || amt < 0) return fail(res, '安全水位金額需為非負數字');
        await pool.execute(`
            INSERT INTO mgm_cash_safe_level (bu_no, safe_amount, set_by, set_by_name, remark)
            VALUES (?,?,?,?,?)
            ON DUPLICATE KEY UPDATE
                safe_amount=VALUES(safe_amount),
                set_by=VALUES(set_by), set_by_name=VALUES(set_by_name),
                remark=VALUES(remark), set_time=CURRENT_TIMESTAMP
        `, [bu_no, amt, req.headers['x-test-user'] || req.user?.user_id || 'MANUAL',
            req.headers['x-test-user-name'] || '', remark || null]);
        ok(res, { bu_no, safe_amount: amt });
    } catch (err) { fail500(res, err); }
});

module.exports = router;
