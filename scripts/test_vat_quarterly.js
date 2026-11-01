/**
 * 小規模納稅人按季申報驗證
 *
 * 驗證項目：
 *   1. 按季彙總：所屬期 202512 → 彙總 2025-10 / 11 / 12 三個月銷項
 *   2. 按月對照：僅彙總 2025-12，金額應小於季報
 *   3. 簡易計稅：銷項 = 季銷售額 × 3%，不得抵扣進項
 *   4. 免征判定：季度銷售額 ≤ 30 萬時應納稅額為 0（以無發票帳套驗證）
 *   5. 一般納稅人不可按季：返回 400
 *   6. 季報所屬期必須為季末月：返回 400
 *   7. 勾對清單支援按季展開 3 個月
 *   8. 落庫欄位：filing_cycle / period_start / period_end / tax_exempt
 *
 * 用法：
 *   node scripts/test_vat_quarterly.js
 *   需先啟動服務（node app.js）
 */
require('dotenv').config();
const { signToken } = require('../middleware/auth');
const { pool } = require('../config/db');

const BASE = `http://localhost:${process.env.PORT || 3008}/api/tax`;
const token = signToken({ user_id: 'QTEST', admin: 'Yes' });
const BU = 'SZ';
const BU_EMPTY = 'QTEST-NONE';
let pass = 0, fail = 0;
const r2 = v => Math.round((Number(v) || 0) * 100) / 100;

function check(name, cond, detail = '') {
    cond ? pass++ : fail++;
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}
async function req(method, path, body) {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json() };
}

// 直接查庫取得季度各月銷項合計作對照基準
async function invoiceSales(buNo, months) {
    const variants = [];
    for (const ym of months) {
        variants.push(`${ym.slice(0, 4)}/${ym.slice(4)}`);
        variants.push(`${ym.slice(0, 4)}-${ym.slice(4)}`);
    }
    const ph = variants.map(() => '?').join(',');
    const [rows] = await pool.execute(
        `SELECT COALESCE(SUM(sub_amt),0) AS amt, COUNT(1) AS c
           FROM mgm_invoice_details
          WHERE bu_no=? AND TX_type='AR' AND YYYY_MM IN (${ph})`,
        [buNo, ...variants]
    );
    return { amount: r2(rows[0].amt), count: Number(rows[0].c) };
}

(async () => {
    try {
        const qMonths = ['202510', '202511', '202512'];
        const [qSales, mSales] = await Promise.all([
            invoiceSales(BU, qMonths),
            invoiceSales(BU, ['202512'])
        ]);
        console.log(`\n=== 資料基準（${BU}）===`);
        console.log(`  Q4 三個月銷項：${qSales.count} 張 / ${qSales.amount}`);
        console.log(`  僅 12 月銷項：${mSales.count} 張 / ${mSales.amount}`);

        // ---------- 1. 小規模按季 ----------
        console.log('\n=== 1. 小規模納稅人按季申報 ===');
        let r = await req('POST', '/vat/calculate', {
            taxPeriod: '202512', taxpayerType: 2, filingCycle: 'QUARTERLY', bu_no: BU
        });
        check('HTTP 200', r.status === 200, r.body.message);
        const q = r.body.data || {};
        console.log(`      季銷售額 ${q.totalSalesAmt} / 銷項 ${q.totalOutputTax} / 應納 ${q.taxPayable}`);
        check('filingCycle = QUARTERLY', q.filingCycle === 'QUARTERLY');
        check('所屬期區間 202510~202512',
            q.periodStart === '202510' && q.periodEnd === '202512');
        check('彙總 3 個月', Array.isArray(q.periodMonths) && q.periodMonths.length === 3);
        check('季銷售額 = 三個月合計', r2(q.totalSalesAmt) === qSales.amount,
            `${q.totalSalesAmt} vs ${qSales.amount}`);
        check('銷項 = 季銷售額 × 3%',
            Math.abs(r2(q.totalSalesAmt * 0.03) - r2(q.totalOutputTax)) <= 0.01,
            `${q.totalOutputTax}`);
        check('進項不得抵扣（為 0）', r2(q.totalInputTax) === 0);
        check('應納稅額 = 銷項', r2(q.taxPayable) === r2(q.totalOutputTax));
        check('未觸發免征（銷售額 > 30 萬）', q.taxExempt === false);

        // ---------- 2. 按月對照 ----------
        console.log('\n=== 2. 同月按月申報對照 ===');
        r = await req('POST', '/vat/calculate', {
            taxPeriod: '202512', taxpayerType: 2, filingCycle: 'MONTHLY', bu_no: BU
        });
        const m = r.body.data || {};
        console.log(`      月銷售額 ${m.totalSalesAmt} / 應納 ${m.taxPayable}`);
        check('按月僅取 12 月', r2(m.totalSalesAmt) === mSales.amount,
            `${m.totalSalesAmt} vs ${mSales.amount}`);
        check('按月應納 < 按季應納', r2(m.taxPayable) < r2(q.taxPayable));
        check('按月 filingCycle = MONTHLY', m.filingCycle === 'MONTHLY');

        // ---------- 3. 季度免征 ----------
        console.log('\n=== 3. 季度銷售額未達免征標準 ===');
        r = await req('POST', '/vat/calculate', {
            taxPeriod: '202512', taxpayerType: 2, filingCycle: 'QUARTERLY', bu_no: BU_EMPTY
        });
        const e = r.body.data || {};
        check('HTTP 200', r.status === 200, r.body.message);
        check('銷售額為 0', r2(e.totalSalesAmt) === 0);
        check('taxExempt = true', e.taxExempt === true);
        check('應納稅額 = 0', r2(e.taxPayable) === 0);
        check('附加稅 = 0',
            r2(e.surcharges?.urbanMaintenance) === 0 && r2(e.surcharges?.educationSurcharge) === 0);
        console.log(`      免征說明：${e.exemptReason}`);

        // ---------- 4. 異常用例 ----------
        console.log('\n=== 4. 異常用例 ===');
        r = await req('POST', '/vat/calculate', {
            taxPeriod: '202512', taxpayerType: 1, filingCycle: 'QUARTERLY', bu_no: BU
        });
        check('一般納稅人按季 → 400', r.status === 400, r.body.message);

        r = await req('POST', '/vat/calculate', {
            taxPeriod: '202511', taxpayerType: 2, filingCycle: 'QUARTERLY', bu_no: BU
        });
        check('非季末月 → 400', r.status === 400, r.body.message);

        r = await req('POST', '/vat/calculate', {
            taxPeriod: '202512', taxpayerType: 2, filingCycle: 'YEARLY', bu_no: BU
        });
        check('非法 filingCycle → 400', r.status === 400, r.body.message);

        // ---------- 5. 勾對清單按季 ----------
        console.log('\n=== 5. 勾對清單按季展開 ===');
        r = await req('GET', `/vat/reconcile?bu_no=${BU}&taxPeriod=202512&filingCycle=QUARTERLY&taxpayerType=2`);
        const rec = r.body.data || {};
        check('HTTP 200', r.status === 200, r.body.message);
        check('展開 3 個月', (rec.periods || []).length === 3, (rec.periods || []).join(','));
        check('季銷項張數 = 資料基準', rec.sales?.count === qSales.count,
            `${rec.sales?.count} vs ${qSales.count}`);
        check('季銷項金額 = 資料基準', r2(rec.sales?.amount) === qSales.amount);
        check('季銷項稅額 = 算稅銷項稅額', Math.abs(r2(rec.sales?.outputTax) - r2(q.totalOutputTax)) <= 0.01);

        r = await req('GET', `/vat/reconcile?bu_no=${BU}&taxPeriod=202512&filingCycle=MONTHLY&taxpayerType=2`);
        check('按月勾對 = 12 月張數', r.body.data?.sales?.count === mSales.count,
            `${r.body.data?.sales?.count} vs ${mSales.count}`);

        // ---------- 6. 落庫檢查 ----------
        console.log('\n=== 6. 落庫欄位檢查 ===');
        const [rows] = await pool.execute(
            `SELECT filing_cycle, period_start, period_end, tax_exempt, tax_period
               FROM vat_declarations WHERE declaration_id=?`,
            [q.declarationId]
        );
        const d = rows[0] || {};
        check('filing_cycle 落庫', d.filing_cycle === 'QUARTERLY');
        check('period_start/end 落庫', d.period_start === '202510' && d.period_end === '202512');
        check('tax_exempt 落庫為 0', Number(d.tax_exempt) === 0);

        console.log(`\n=== 彙總：PASS ${pass} / FAIL ${fail} ===`);
        process.exit(fail > 0 ? 1 : 0);
    } catch (err) {
        console.error('\n測試異常:', err.message);
        process.exit(1);
    }
})();
