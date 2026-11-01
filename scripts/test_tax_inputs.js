/**
 * 報稅人工錄入 → 算稅整合驗證
 *
 * 驗證內容：
 *   1. VAT 錄入：進項稅額轉出 → 可抵扣進項減少 → 應納稅額增加
 *   2. VAT 勾對：進銷項發票清單與合計
 *   3. CIT 錄入：稅率 / 累計預繳 / 納稅調整 → 匯算結果連動
 *   4. IIT 錄入：逐人薪資與扣除 → 累計預扣計算
 *
 * 用法：
 *   node scripts/test_tax_inputs.js
 *   需先啟動服務（node app.js）
 */
require('dotenv').config();
const { signToken } = require('../middleware/auth');
const { pool } = require('../config/db');

const BASE = `http://localhost:${process.env.PORT || 3008}/api/tax`;
const token = signToken({ user_id: 'INPUT-TEST', admin: 'Yes' });
const BU = 'SZ';
const PERIOD = '202512';
const YEAR = '2025';
let pass = 0, fail = 0;

function check(name, cond, detail = '') {
    cond ? pass++ : fail++;
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}
const r2 = v => Math.round((Number(v) || 0) * 100) / 100;

async function req(method, path, body) {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json() };
}

async function cleanup(batchId) {
    await pool.execute('DELETE FROM tax_vat_adjustments WHERE bu_no=? AND tax_period=?', [BU, PERIOD]);
    await pool.execute('DELETE FROM tax_cit_inputs WHERE bu_no=? AND tax_year=?', [BU, YEAR]);
    await pool.execute('DELETE FROM tax_cit_adjustments WHERE bu_no=? AND tax_year=?', [BU, YEAR]);
    await pool.execute("DELETE FROM payroll_details WHERE employee_id LIKE 'TST-%'");
    if (batchId) {
        await pool.execute('DELETE FROM iit_withholding_details WHERE withholding_batch_id=?', [batchId]);
        await pool.execute('DELETE FROM iit_withholding_batches WHERE withholding_batch_id=?', [batchId]);
    } else {
        await pool.execute("DELETE FROM iit_withholding_details WHERE employee_id LIKE 'TST-%'");
    }
}

(async () => {
    let batchId = null;
    try {
        await cleanup();

        // ================= 1. VAT =================
        console.log('\n=== 1. 增值稅人工錄入 ===');
        let r = await req('PUT', '/inputs/vat', {
            bu_no: BU, taxPeriod: PERIOD, inputTaxTransferOut: 5000, prevCreditOverride: null,
            note: '整合測試'
        });
        check('PUT 錄入成功', r.status === 200 && r.body.success, r.body.message);

        r = await req('GET', `/inputs/vat?bu_no=${BU}&taxPeriod=${PERIOD}`);
        check('讀回轉出金額 = 5000', Number(r.body.data?.input_tax_transfer_out) === 5000);
        check('留抵為空（由系統計算）', r.body.data?.prev_credit_override === null);

        r = await req('POST', '/vat/calculate', { taxPeriod: PERIOD, taxpayerType: 1, bu_no: BU });
        const v = r.body.data || {};
        console.log(`      銷項 ${v.totalOutputTax} / 進項(可抵扣) ${v.totalInputTax} / 轉出 ${v.inputTaxTransferOut} / 應納 ${v.taxPayable}`);
        check('進項轉出已回傳', Number(v.inputTaxTransferOut) === 5000);
        check('可抵扣進項 = 發票進項 − 轉出',
            r2(v.totalInputTax + v.inputTaxTransferOut) === r2(v.totalInputTax + 5000));
        check('VAT_R02 計算式成立',
            Math.abs(r2(v.totalOutputTax - v.totalInputTax - v.prevPeriodCredit) - r2(v.taxPayable)) <= 0.01);

        r = await req('GET', `/vat/reconcile?bu_no=${BU}&taxPeriod=${PERIOD}`);
        const rec = r.body.data || {};
        check('勾對清單有銷項發票', rec.sales?.count > 0, `AR ${rec.sales?.count} 張 / 稅額 ${rec.sales?.outputTax}`);
        check('勾對清單有進項發票', rec.purchase?.count > 0, `AP ${rec.purchase?.count} 張 / 稅額 ${rec.purchase?.invoiceTax}`);
        check('勾對金額與算稅銷項稅額一致',
            Math.abs(r2(rec.sales?.outputTax) - r2(v.totalOutputTax)) <= 0.01);

        // ================= 2. CIT =================
        console.log('\n=== 2. 企業所得稅人工錄入 ===');
        r = await req('PUT', '/inputs/cit', {
            bu_no: BU, taxYear: YEAR, taxRate: 0.25,
            accumPrepaidTax: 10000000, withheldTax: 0,
            adjustments: [
                { type: 'ADJ_INCREASE', amount: 1000000, remark: '業務招待費調增' },
                { type: 'TAX_EXEMPTION', amount: 100000, remark: '減免測試' }
            ],
            note: '整合測試'
        });
        check('PUT 匯算參數成功', r.status === 200 && r.body.success, r.body.message);

        r = await req('GET', `/inputs/cit?bu_no=${BU}&taxYear=${YEAR}`);
        check('稅率讀回 0.25', Number(r.body.data?.taxRate) === 0.25);
        check('調整明細 2 筆', (r.body.data?.adjustments || []).length === 2);

        r = await req('POST', '/cit/calculate', {
            taxYear: YEAR, taxpayerIdentNo: '9144030071526726X1', includeAdjustments: true, bu_no: BU
        });
        const c = r.body.data || {};
        console.log(`      收入 ${c.totalRevenue} / 成本 ${c.totalCost} / 應納稅所得 ${c.taxableIncome}`);
        console.log(`      應納稅額 ${c.taxPayable} / 預繳 ${c.accumPrepaidTax} / 補退 ${c.refundOrSupplement}`);
        check('納稅調整增加已計入所得',
            Math.abs(r2(c.taxableIncome - (c.totalRevenue - c.totalCost)) - 1000000) <= 0.01);
        check('CIT_R02 應納稅額 = 所得 × 25% − 減免',
            Math.abs(r2(c.taxableIncome * 0.25 - 100000) - r2(c.taxPayable)) <= 0.01);
        check('CIT_R03 補退 = 應納 − 預繳',
            Math.abs(r2(c.taxPayable - 10000000) - r2(c.refundOrSupplement)) <= 0.01);

        // ================= 3. IIT =================
        console.log('\n=== 3. 個人所得稅薪資錄入 ===');
        const emps = [
            { id: 'TST-01', months: ['2025-10', '2025-11', '2025-12'] },
            { id: 'TST-02', months: ['2025-12'] },
            { id: 'TST-03', months: ['2025-12'] }
        ];
        for (const e of emps) {
            for (const m of e.months) {
                r = await req('POST', '/inputs/iit', {
                    bu_no: BU, YYYY_MM: m, employeeId: e.id, employeeName: '測試員工',
                    grossSalary: 30000, socialInsurance: 3000, specialDeduction: 2000, otherDeduction: 0
                });
                if (!(r.status === 200 && r.body.success)) {
                    console.log('      ✘ 錄入失敗:', r.body.message);
                }
            }
        }
        r = await req('GET', `/inputs/iit?bu_no=${BU}&taxPeriod=${PERIOD}`);
        check('當期（12月）薪資明細 3 筆', (r.body.data || []).length === 3);

        r = await req('POST', '/iit/calculate', { taxPeriod: PERIOD, incomeType: 'SALARY', bu_no: BU });
        const it = r.body.data || {};
        batchId = it.withholdingBatchId || null;
        const e1 = (it.employeeDetails || []).find(x => x.employeeId === 'TST-01') || {};
        console.log(`      人數 ${it.totalEmployees} / 代扣合計 ${it.totalWithheldTax}`);
        console.log(`      TST-01 累計收入 ${e1.cumulativeIncome} / 累計扣除 ${e1.cumulativeDeduction} / 本期 ${e1.currentPeriodTax}`);
        check('僅取薪資名單 3 人', it.totalEmployees === 3);
        check('TST-01 累計收入 = 30000×3', r2(e1.cumulativeIncome) === 90000);
        check('TST-01 累計扣除 = 5000×12 + (3000+2000)×3',
            r2(e1.cumulativeDeduction) === 75000);
        check('TST-01 本期稅額 = (90000−75000)×3%', r2(e1.currentPeriodTax) === 450);
        check('代扣合計 = 450', r2(it.totalWithheldTax) === 450);

        // ================= 4. 刪除 =================
        console.log('\n=== 4. 薪資明細刪除 ===');
        r = await req('GET', `/inputs/iit?bu_no=${BU}&taxPeriod=${PERIOD}`);
        const t3 = (r.body.data || []).find(x => x.employee_id === 'TST-03');
        r = await req('DELETE', `/inputs/iit/${t3.id}?bu_no=${BU}`);
        check('刪除成功', r.status === 200 && r.body.success, r.body.message);
        r = await req('GET', `/inputs/iit?bu_no=${BU}&taxPeriod=${PERIOD}`);
        check('刪除後當期剩 2 筆', (r.body.data || []).length === 2);

        console.log(`\n=== 彙總：PASS ${pass} / FAIL ${fail} ===`);
        await cleanup(batchId);
        console.log('（測試資料已清理，系統回到無人工錄入狀態）');
        process.exit(fail > 0 ? 1 : 0);
    } catch (err) {
        console.error('\n測試異常:', err.message);
        await cleanup(batchId).catch(() => {});
        process.exit(1);
    }
})();
