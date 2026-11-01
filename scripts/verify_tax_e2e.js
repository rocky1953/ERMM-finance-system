/**
 * 報稅模組端到端驗證腳本
 *
 * 驗證內容：
 *   1. 006 migration 的 5 張表是否已建立
 *   2. 自動探測有資料的 bu_no / 稅款所屬期 / 年度
 *   3. 依序跑通 VAT / CIT / IIT 三大模組的「算稅 → 提交申報」流程
 *
 * 使用方式：
 *   node scripts/verify_tax_e2e.js
 */
require('dotenv').config();
const { pool } = require('../config/db');
const { VAT, CIT, IIT, Submit } = require('../services/taxService');

const TABLES = [
    'vat_declarations',
    'cit_annual_settlements',
    'iit_withholding_batches',
    'iit_withholding_details',
    'tax_submit_receipts'
];

async function checkTables() {
    const [rows] = await pool.query(
        `SELECT TABLE_NAME, TABLE_COMMENT
           FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = ?
            AND TABLE_NAME IN (?)`,
        [process.env.DB_NAME, TABLES]
    );
    console.log('\n=== 1. 報稅表檢查 ===');
    for (const name of TABLES) {
        const hit = rows.find(r => r.TABLE_NAME === name);
        console.log(`  ${hit ? 'OK  ' : 'MISS'} ${name}${hit ? ' — ' + hit.TABLE_COMMENT : ''}`);
    }
    if (rows.length !== TABLES.length) throw new Error('報稅表未全部建立，請先執行 migration 006');
    return true;
}

async function detectSource() {
    // 取有發票資料的 bu_no 與最新期間
    const [inv] = await pool.query(
        `SELECT bu_no, YYYY_MM, COUNT(*) AS cnt
           FROM mgm_invoice_details
          WHERE YYYY_MM IS NOT NULL AND YYYY_MM <> ''
          GROUP BY bu_no, YYYY_MM
          ORDER BY YYYY_MM DESC, cnt DESC
          LIMIT 1`
    );
    // 取有財報資料的 bu_no 與最新年度
    const [fin] = await pool.query(
        `SELECT bu_no, YYYY, COUNT(*) AS cnt
           FROM mgm_finance_summary
          WHERE YYYY IS NOT NULL AND YYYY <> ''
          GROUP BY bu_no, YYYY
          ORDER BY YYYY DESC, cnt DESC
          LIMIT 1`
    );
    console.log('\n=== 2. 數據源探測 ===');
    if (!inv.length) throw new Error('mgm_invoice_details 無可用資料，無法跑 VAT');
    if (!fin.length) throw new Error('mgm_finance_summary 無可用資料，無法跑 CIT');
    console.log(`  VAT 來源：bu_no=${inv[0].bu_no} 期間=${inv[0].YYYY_MM}（${inv[0].cnt} 筆）`);
    console.log(`  CIT 來源：bu_no=${fin[0].bu_no} 年度=${fin[0].YYYY}（${fin[0].cnt} 筆）`);
    return {
        vatBu: inv[0].bu_no,
        vatPeriod: String(inv[0].YYYY_MM).replace(/[^0-9]/g, ''),   // 2025-12 / 2026/09 → 202512 / 202609
        citBu: fin[0].bu_no,
        citYear: String(fin[0].YYYY)
    };
}

async function runVat(src) {
    console.log('\n=== 3. VAT 增值稅流程 ===');
    const calc = await VAT.calculate({
        taxPeriod: src.vatPeriod,
        taxpayerType: 1,
        erpSyncToken: 'E2E-TEST',
        bu_no: src.vatBu
    });
    if (!calc.declarationId) throw new Error('VAT 算稅失敗：' + JSON.stringify(calc.validationErrors));
    console.log(`  算稅：declarationId=${calc.declarationId}`);
    console.log(`        銷售額=${calc.totalSalesAmt} 銷項=${calc.totalOutputTax} 進項=${calc.totalInputTax}`);
    console.log(`        留抵=${calc.prevPeriodCredit} 應納稅額=${calc.taxPayable}`);
    console.log(`        附加稅：城建=${calc.surcharges.urbanMaintenance} 教育=${calc.surcharges.educationSurcharge} 地方教育=${calc.surcharges.localEducationSurcharge}`);

    const receipt = await Submit.submit({
        module: 'VAT', bizId: calc.declarationId, operatorId: 'E2E-TEST', pool
    });
    console.log(`  提交：受理號=${receipt.taxBureauReceiptNo} 狀態=${receipt.status} 繳款期限=${receipt.paymentDeadline}`);
    return calc;
}

async function runCit(src) {
    console.log('\n=== 4. CIT 企業所得稅年度匯算流程 ===');
    const calc = await CIT.calculate({
        taxYear: src.citYear,
        taxpayerIdentNo: '91310000E2ETEST001',
        includeAdjustments: true,
        bu_no: src.citBu
    });
    if (!calc.settlementId) throw new Error('CIT 算稅失敗：' + JSON.stringify(calc.validationErrors));
    console.log(`  算稅：settlementId=${calc.settlementId}`);
    console.log(`        收入=${calc.totalRevenue} 成本=${calc.totalCost}`);
    console.log(`        應納稅所得額=${calc.taxableIncome} 應納稅額=${calc.taxPayable}`);
    console.log(`        累計預繳=${calc.accumPrepaidTax} 補(+)/退(-)=${calc.refundOrSupplement}`);

    const receipt = await Submit.submit({
        module: 'CIT', bizId: calc.settlementId, operatorId: 'E2E-TEST', pool
    });
    console.log(`  提交：受理號=${receipt.taxBureauReceiptNo} 狀態=${receipt.status}`);
    return calc;
}

async function runIit(src) {
    console.log('\n=== 5. IIT 個人所得稅代扣代繳流程 ===');
    const calc = await IIT.calculate({
        taxPeriod: src.vatPeriod,
        incomeType: 'SALARY',
        bu_no: src.vatBu
    });
    if (!calc.withholdingBatchId) throw new Error('IIT 算稅失敗：' + JSON.stringify(calc.validationErrors));
    console.log(`  算稅：batchId=${calc.withholdingBatchId}`);
    console.log(`        人數=${calc.totalEmployees} 代扣稅額合計=${calc.totalWithheldTax}`);
    for (const d of calc.employeeDetails.slice(0, 3)) {
        console.log(`        ${d.employeeId}: 累計收入=${d.cumulativeIncome} 累計扣除=${d.cumulativeDeduction} 本期稅=${d.currentPeriodTax}`);
    }

    const receipt = await Submit.submit({
        module: 'IIT', bizId: calc.withholdingBatchId, operatorId: 'E2E-TEST', pool
    });
    console.log(`  提交：受理號=${receipt.taxBureauReceiptNo} 狀態=${receipt.status}`);
    return calc;
}

async function checkDbWrites() {
    console.log('\n=== 6. 落庫結果核對 ===');
    const [v] = await pool.query('SELECT declaration_id, tax_period, tax_payable, status FROM vat_declarations ORDER BY create_time DESC LIMIT 1');
    const [c] = await pool.query('SELECT settlement_id, tax_year, tax_payable, refund_or_supplement, status FROM cit_annual_settlements ORDER BY create_time DESC LIMIT 1');
    const [i] = await pool.query('SELECT withholding_batch_id, tax_period, total_employees, total_withheld_tax, status FROM iit_withholding_batches ORDER BY create_time DESC LIMIT 1');
    const [r] = await pool.query('SELECT module, biz_id, tax_bureau_receipt_no, status FROM tax_submit_receipts ORDER BY id DESC LIMIT 5');
    console.log('  vat_declarations     :', v[0]);
    console.log('  cit_annual_settlements:', c[0]);
    console.log('  iit_withholding_batches:', i[0]);
    console.log('  iit_withholding_details :', (await pool.query('SELECT COUNT(*) AS c FROM iit_withholding_details'))[0][0]);
    console.log('  tax_submit_receipts  :', r);
}

async function runHttp(src) {
    const base = `http://localhost:${process.env.PORT || 3008}/api/tax`;
    const { signToken } = require('../middleware/auth');
    const token = signToken({ user_id: 'HTTP-TEST', admin: 'Yes' });
    const post = async (path, body) => {
        const r = await fetch(base + path, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify(body)
        });
        return { status: r.status, json: await r.json() };
    };
    console.log('\n=== HTTP 層驗證（需先啟動服務）===');
    console.log('  base =', base);

    const vat = await post('/vat/calculate', {
        taxPeriod: src.vatPeriod, taxpayerType: 1, bu_no: src.vatBu
    });
    console.log(`  POST /vat/calculate → ${vat.status} ${vat.json.message} taxPayable=${vat.json.data?.taxPayable}`);
    if (vat.status !== 200) throw new Error('VAT 路由失敗');

    const vatSubmit = await post(`/vat/${vat.json.data.declarationId}/submit`, { operatorId: 'HTTP-TEST' });
    console.log(`  POST /vat/:id/submit → ${vatSubmit.status} 受理號=${vatSubmit.json.data?.taxBureauReceiptNo}`);

    const cit = await post('/cit/calculate', {
        taxYear: src.citYear, taxpayerIdentNo: '91310000HTTPTEST01', bu_no: src.citBu
    });
    console.log(`  POST /cit/calculate → ${cit.status} taxPayable=${cit.json.data?.taxPayable}`);

    const citSubmit = await post('/cit/submit', { settlementId: cit.json.data.settlementId, operatorId: 'HTTP-TEST' });
    console.log(`  POST /cit/submit → ${citSubmit.status} 受理號=${citSubmit.json.data?.taxBureauReceiptNo}`);

    const iit = await post('/iit/calculate', {
        taxPeriod: src.vatPeriod, incomeType: 'SALARY', bu_no: src.vatBu
    });
    console.log(`  POST /iit/calculate → ${iit.status} 人數=${iit.json.data?.totalEmployees} 稅額=${iit.json.data?.totalWithheldTax}`);

    const iitSubmit = await post('/iit/submit', { withholdingBatchId: iit.json.data.withholdingBatchId, operatorId: 'HTTP-TEST' });
    console.log(`  POST /iit/submit → ${iitSubmit.status} 受理號=${iitSubmit.json.data?.taxBureauReceiptNo}`);

    // 校驗失敗路徑
    const bad = await post('/vat/calculate', { taxPeriod: '2025' });
    console.log(`  POST /vat/calculate（參數錯誤）→ ${bad.status} ${bad.json.message}`);
    if (bad.status !== 400) throw new Error('參數校驗未返回 400');

    console.log('  HTTP 層全部通過 ✔');
}

async function cleanup(ids) {
    console.log('\n=== 7. 清理本次測試資料 ===');
    await pool.execute('DELETE FROM iit_withholding_details WHERE withholding_batch_id=?', [ids.iit]);
    await pool.execute('DELETE FROM iit_withholding_batches WHERE withholding_batch_id=?', [ids.iit]);
    await pool.execute('DELETE FROM vat_declarations WHERE declaration_id=?', [ids.vat]);
    await pool.execute('DELETE FROM cit_annual_settlements WHERE settlement_id=?', [ids.cit]);
    await pool.execute(
        "DELETE FROM tax_submit_receipts WHERE biz_id IN (?,?,?)",
        [ids.vat, ids.cit, ids.iit]
    );
    console.log('  已清除本次產生的申報與受理記錄');
}

(async () => {
    const created = {};
    try {
        await checkTables();
        const src = await detectSource();
        if (process.argv.includes('--http')) {
            await runHttp(src);
            process.exit(0);
        }
        created.vat = (await runVat(src)).declarationId;
        created.cit = (await runCit(src)).settlementId;
        created.iit = (await runIit(src)).withholdingBatchId;
        await checkDbWrites();
        console.log('\n全部流程跑通 ✔');
        if (process.argv.includes('--clean')) await cleanup(created);
        else console.log('（如需清除本次測試資料，可執行：node scripts/verify_tax_e2e.js --clean）');
        process.exit(0);
    } catch (err) {
        console.error('\n驗證失敗：', err.message);
        process.exit(1);
    }
})();
