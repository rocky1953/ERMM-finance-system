/**
 * 資產負債表平衡修復腳本
 * 問題：第三方匯入資料未維護會計恆等式（資產 ≠ 負債 + 權益），全部 75 筆都不平衡。
 * 修復：調整 accumulated_amt（保留盈餘，標準平衡科目）使 資產 = 負債 + 權益，
 *       並同步更新存儲的彙總欄位。
 *
 * 用法：node database/fix_balance_sheet.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
    const c = await mysql.createConnection({
        host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
        user: process.env.DB_USER, password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME, charset: 'utf8mb4', dateStrings: true
    });

    const v = (r, k) => Number(r[k] || 0);

    const [rows] = await c.query(`SELECT * FROM MGM_finance_summary ORDER BY bu_no, YYYY_MM`);
    let fixed = 0;

    for (const r of rows) {
        // ===== 重算資產 =====
        const current_asset = v(r,'cash_amt')+v(r,'deposite_amt')+v(r,'AR_amt')+v(r,'AR_bill_amt')+
            v(r,'AR_temp_amt')+v(r,'AR_affiliate_amt')+v(r,'stock_P_amt')+v(r,'stock_M_amt')+
            v(r,'stock_S_amt')+v(r,'stock_transit_amt')+v(r,'prepay_EXP_amt')+v(r,'prepay_goods_amt');
        const non_current_asset = (v(r,'building_amt')-v(r,'acc_de_building'))+(v(r,'equipment_amt')-v(r,'acc_de_EQMT'))+
            (v(r,'vehicle_amt')-v(r,'acc_de_vehicle'))+(v(r,'office_amt')-v(r,'acc_de_office'))+
            v(r,'intangible_amt')+v(r,'LQ_asset_amt')+v(r,'FX_asset_amt')+v(r,'other_asset_amt')+
            v(r,'WIP_M_amt')+v(r,'WIP_labor_amt')+v(r,'WIP_EXP_amt');
        const ttl_asset = current_asset + non_current_asset;

        // ===== 重算負債 =====
        const current_debet = v(r,'loan_amt')+v(r,'AP_amt')+v(r,'AP_tax_amt')+v(r,'AP_salary_amt')+
            v(r,'AP_other_amt')+v(r,'LQ_debet_amt')+v(r,'deposit_liab_amt');
        const long_term_debet = v(r,'LT_loan_amt')+v(r,'LT_debet_amt');
        const ttl_debet = current_debet + long_term_debet;

        // ===== 調整保留盈餘使資產 = 負債 + 權益 =====
        const other_equity = v(r,'captial_stock')+v(r,'captial_reserve')+v(r,'legal_reserve')+v(r,'current_PL_amt');
        const new_accumulated = ttl_asset - ttl_debet - other_equity;
        const equity = other_equity + new_accumulated;

        const old_diff = ttl_asset - ttl_debet - other_equity - v(r,'accumulated_amt');

        await c.execute(`
            UPDATE MGM_finance_summary SET
                accumulated_amt=?,
                ttl_asset_amt=?, ttl_debet_amt=?, stockholder_amt=?,
                current_asset_amt=?, non_current_asset_amt=?,
                current_debet_amt=?, long_term_debet_amt=?,
                update_time=NOW()
            WHERE uid=?
        `, [new_accumulated, ttl_asset, ttl_debet, equity,
            current_asset, non_current_asset, current_debet, long_term_debet, r.uid]);

        if (Math.abs(old_diff) > 1) {
            console.log(`  ${r.bu_no} ${r.YYYY_MM}: 保留盈餘 ${v(r,'accumulated_amt').toFixed(0)} → ${new_accumulated.toFixed(0)} (差額 ${old_diff.toFixed(0)})`);
            fixed++;
        }
    }

    await c.end();
    console.log(`\n✅ 修復完成：${fixed} 筆記錄已平衡`);
    console.log('💡 資產 = 負債 + 權益，透過調整保留盈餘(accumulated_amt)達成平衡');
})();
