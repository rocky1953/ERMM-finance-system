/**
 * 將測試發票金額併入 mgm_finance_summary 的 2024-12 匯總
 *
 * 對象：去重後僅存的 5 張測試單（客戶A/B/C/D、供應商X）
 *   HM/AR INV202412001 含稅 1,199,998.98
 *   HM/AR INV202412002 含稅   399,999.66
 *   HM/AP INV202412003 含稅   759,699.00
 *   HN/AR INV202412010 含稅   366,060.11
 *   SZ/AR INV202412020 含稅   595,739.39
 *
 * 做法：
 *   1. AR_amt += 該公司 AR 測試單含稅合計；AP_amt += AP 測試單含稅合計
 *   2. 以分項重算 流動資產 / 非流動資產 / 負債，調整 accumulated_amt 為平衡項
 *
 * 用法：node scripts/merge_test_invoices_into_summary.js [--apply]
 */
const { pool } = require('../config/db');
const APPLY = process.argv.includes('--apply');
const YM = '2024-12';
const INVOICE_NOS = ['INV202412001', 'INV202412002', 'INV202412003', 'INV202412010', 'INV202412020'];

const v = (r, k) => Number(r[k] || 0);
const f2 = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const balance = (r) => {
    const cash = v(r, 'cash_amt') + v(r, 'deposite_amt') + v(r, 'interest_amt');
    const ar = v(r, 'AR_amt') + v(r, 'AR_bill_amt') + v(r, 'AR_temp_amt') + v(r, 'AR_affiliate_amt');
    const inventory = v(r, 'stock_P_amt') + v(r, 'stock_M_amt') + v(r, 'stock_S_amt') + v(r, 'stock_transit_amt');
    const prepay = v(r, 'prepay_EXP_amt') + v(r, 'prepay_goods_amt');
    const current_asset = cash + ar + inventory + prepay;

    const non_current_asset =
        (v(r, 'building_amt') - v(r, 'acc_de_building')) +
        (v(r, 'equipment_amt') - v(r, 'acc_de_EQMT')) +
        (v(r, 'vehicle_amt') - v(r, 'acc_de_vehicle')) +
        (v(r, 'office_amt') - v(r, 'acc_de_office')) +
        v(r, 'intangible_amt') + v(r, 'LQ_asset_amt') + v(r, 'FX_asset_amt') +
        v(r, 'WIP_M_amt') + v(r, 'WIP_labor_amt') + v(r, 'WIP_EXP_amt') +
        v(r, 'other_asset_amt');
    const ttl_asset = current_asset + non_current_asset;

    const current_debet = v(r, 'loan_amt') + v(r, 'AP_amt') + v(r, 'AP_tax_amt') +
        v(r, 'AP_salary_amt') + v(r, 'AP_other_amt') + v(r, 'LQ_debet_amt') + v(r, 'deposit_liab_amt');
    const long_term_debet = v(r, 'LT_loan_amt') + v(r, 'LT_debet_amt');
    const ttl_debet = current_debet + long_term_debet;

    const other_equity = v(r, 'captial_stock') + v(r, 'captial_reserve') +
        v(r, 'legal_reserve') + v(r, 'current_PL_amt');
    const accumulated = ttl_asset - ttl_debet - other_equity;

    return {
        current_asset, non_current_asset, ttl_asset,
        current_debet, long_term_debet, ttl_debet,
        accumulated, equity: other_equity + accumulated
    };
};

(async () => {
    const [invs] = await pool.query(
        `SELECT bu_no, TX_type, invoice_no, sub_amt, VAT_amt, sub_amt + VAT_amt AS total
           FROM mgm_invoice_details
          WHERE YYYY_MM=? AND invoice_no IN (${INVOICE_NOS.map(() => '?').join(',')})
          ORDER BY bu_no, TX_type, invoice_no`,
        [YM, ...INVOICE_NOS]
    );
    if (invs.length !== 5) throw new Error(`預期 5 張測試單，實得 ${invs.length} 張`);

    const addMap = {};
    invs.forEach(i => {
        const k = `${i.bu_no}/${i.TX_type}`;
        addMap[k] = (addMap[k] || 0) + Number(i.total);
        console.log(`  ${k} ${i.invoice_no} 含稅 ${f2(Number(i.total))}`);
    });

    console.log(`\n模式：${APPLY ? 'APPLY' : 'DRY-RUN'}（月份 ${YM}）\n`);
    const conn = APPLY ? await pool.getConnection() : null;
    if (conn) await conn.beginTransaction();
    const exec = conn || pool;

    try {
        for (const bu_no of Object.keys(addMap).map(k => k.split('/')[0]).filter((x, i, a) => a.indexOf(x) === i)) {
            const [rows] = await exec.execute(`SELECT * FROM mgm_finance_summary WHERE bu_no=? AND YYYY_MM=?`, [bu_no, YM]);
            const r = rows[0];
            if (!r) throw new Error(`缺少 ${bu_no} ${YM} 匯總`);

            const addAR = addMap[`${bu_no}/AR`] || 0;
            const addAP = addMap[`${bu_no}/AP`] || 0;
            const nr = { ...r, AR_amt: v(r, 'AR_amt') + addAR, AP_amt: v(r, 'AP_amt') + addAP };
            const b = balance(nr);

            console.log(`${bu_no}: AR ${f2(v(r, 'AR_amt'))} + ${f2(addAR)} → ${f2(v(nr, 'AR_amt'))}`);
            console.log(`      AP ${f2(v(r, 'AP_amt'))} + ${f2(addAP)} → ${f2(v(nr, 'AP_amt'))}`);
            console.log(`      資產 ${f2(b.ttl_asset)} = 負債 ${f2(b.ttl_debet)} + 權益 ${f2(b.equity)}｜累積盈餘 ${f2(v(r, 'accumulated_amt'))} → ${f2(b.accumulated)}`);

            if (APPLY) {
                await conn.execute(
                    `UPDATE mgm_finance_summary SET
                        AR_amt=?, AP_amt=?,
                        accumulated_amt=?, stockholder_amt=?,
                        ttl_asset_amt=?, current_asset_amt=?, non_current_asset_amt=?,
                        ttl_debet_amt=?, current_debet_amt=?, long_term_debet_amt=?,
                        update_time=NOW()
                     WHERE uid=?`,
                    [v(nr, 'AR_amt'), v(nr, 'AP_amt'),
                        b.accumulated, b.equity,
                        b.ttl_asset, b.current_asset, b.non_current_asset,
                        b.ttl_debet, b.current_debet, b.long_term_debet, r.uid]
                );
            }
        }
        if (conn) await conn.commit();
    } catch (e) {
        if (conn) await conn.rollback();
        throw e;
    } finally {
        if (conn) conn.release();
    }

    if (APPLY) {
        const [chk] = await pool.query(
            `SELECT SUM(ABS(ttl_asset_amt - (ttl_debet_amt + stockholder_amt)) >= 1) bad,
                    COUNT(*) total,
                    MAX(ABS(ttl_asset_amt - (ttl_debet_amt + stockholder_amt))) max_diff
               FROM mgm_finance_summary WHERE YYYY_MM >= '2023-01'`
        );
        console.log(`\n✅ 已併入 ${YM} 匯總`);
        console.log(`驗證：不平衡 ${chk[0].bad} / ${chk[0].total} 筆，最大差額 ${chk[0].max_diff}`);
    }
    process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
