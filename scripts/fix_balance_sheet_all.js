/**
 * 資產負債表平衡修復（2023~2025 全帳套）
 *
 * 根因：原始資料未維護會計恆等式，108 筆全部不平衡；且彙總欄位與分項口徑不一致
 *       （current_asset_amt 未含應收利息 interest_amt，導致畫面小計與總計差 304,708）。
 *
 * 修復：
 *   1. 以分項重算 流動資產 / 非流動資產 / 流動負債 / 長期負債
 *   2. 調整 accumulated_amt（累積盈餘，標準平衡科目）使 資產 = 負債 + 權益
 *   3. 同步回寫所有彙總欄位，確保 API 與畫面小計一致
 *
 * 用法：
 *   node scripts/fix_balance_sheet_all.js            預演（不寫入）
 *   node scripts/fix_balance_sheet_all.js --apply    執行修復
 */
const { pool } = require('../config/db');

const APPLY = process.argv.includes('--apply');
const v = (r, k) => Number(r[k] || 0);
const f2 = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
    const [rows] = await pool.query(
        `SELECT * FROM mgm_finance_summary WHERE YYYY_MM >= '2023-01' ORDER BY bu_no, YYYY_MM`
    );
    console.log(`模式：${APPLY ? 'APPLY（寫入）' : 'DRY-RUN（預演）'}，筆數：${rows.length}\n`);

    let fixed = 0;
    const conn = APPLY ? await pool.getConnection() : null;
    if (conn) await conn.beginTransaction();

    try {
        for (const r of rows) {
            // 流動資產（現金含應收利息，與畫面一致）
            const cash = v(r, 'cash_amt') + v(r, 'deposite_amt') + v(r, 'interest_amt');
            const ar = v(r, 'AR_amt') + v(r, 'AR_bill_amt') + v(r, 'AR_temp_amt') + v(r, 'AR_affiliate_amt');
            const inventory = v(r, 'stock_P_amt') + v(r, 'stock_M_amt') + v(r, 'stock_S_amt') + v(r, 'stock_transit_amt');
            const prepay = v(r, 'prepay_EXP_amt') + v(r, 'prepay_goods_amt');
            const current_asset = cash + ar + inventory + prepay;

            // 非流動資產
            const non_current_asset =
                (v(r, 'building_amt') - v(r, 'acc_de_building')) +
                (v(r, 'equipment_amt') - v(r, 'acc_de_EQMT')) +
                (v(r, 'vehicle_amt') - v(r, 'acc_de_vehicle')) +
                (v(r, 'office_amt') - v(r, 'acc_de_office')) +
                v(r, 'intangible_amt') + v(r, 'LQ_asset_amt') + v(r, 'FX_asset_amt') +
                v(r, 'WIP_M_amt') + v(r, 'WIP_labor_amt') + v(r, 'WIP_EXP_amt') +
                v(r, 'other_asset_amt');

            const ttl_asset = current_asset + non_current_asset;

            // 負債
            const current_debet = v(r, 'loan_amt') + v(r, 'AP_amt') + v(r, 'AP_tax_amt') +
                v(r, 'AP_salary_amt') + v(r, 'AP_other_amt') + v(r, 'LQ_debet_amt') + v(r, 'deposit_liab_amt');
            const long_term_debet = v(r, 'LT_loan_amt') + v(r, 'LT_debet_amt');
            const ttl_debet = current_debet + long_term_debet;

            // 權益：其他權益科目不動，累積盈餘作為平衡項
            const other_equity = v(r, 'captial_stock') + v(r, 'captial_reserve') +
                v(r, 'legal_reserve') + v(r, 'current_PL_amt');
            const new_accumulated = ttl_asset - ttl_debet - other_equity;
            const equity = other_equity + new_accumulated;

            const old_diff = ttl_asset - ttl_debet - v(r, 'stockholder_amt');
            const changed = Math.abs(old_diff) >= 1;

            if (changed || !APPLY) {
                console.log(`${r.bu_no} ${r.YYYY_MM}: 資產 ${f2(ttl_asset)} = 負債 ${f2(ttl_debet)} + 權益 ${f2(equity)}`
                    + ` ｜原差額 ${f2(old_diff)} ｜累積盈餘 ${f2(v(r, 'accumulated_amt'))} → ${f2(new_accumulated)}`);
            }

            if (APPLY) {
                await conn.execute(
                    `UPDATE mgm_finance_summary SET
                        accumulated_amt=?, stockholder_amt=?,
                        ttl_asset_amt=?, current_asset_amt=?, non_current_asset_amt=?,
                        ttl_debet_amt=?, current_debet_amt=?, long_term_debet_amt=?,
                        update_time=NOW()
                     WHERE uid=?`,
                    [new_accumulated, equity, ttl_asset, current_asset, non_current_asset,
                        ttl_debet, current_debet, long_term_debet, r.uid]
                );
                fixed++;
            }
        }
        if (conn) await conn.commit();
    } catch (err) {
        if (conn) await conn.rollback();
        throw err;
    } finally {
        if (conn) conn.release();
    }

    if (APPLY) {
        // 驗證
        const [chk] = await pool.query(
            `SELECT SUM(ABS(ttl_asset_amt - (ttl_debet_amt + stockholder_amt)) >= 1) AS bad,
                    COUNT(*) AS total,
                    MAX(ABS(ttl_asset_amt - (ttl_debet_amt + stockholder_amt))) AS max_diff
               FROM mgm_finance_summary WHERE YYYY_MM >= '2023-01'`
        );
        console.log(`\n✅ 已更新 ${fixed} 筆`);
        console.log(`驗證：不平衡 ${chk[0].bad} / ${chk[0].total} 筆，最大差額 ${chk[0].max_diff}`);
    }
    process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
