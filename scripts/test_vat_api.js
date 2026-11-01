/**
 * VAT 增值稅算稅接口測試腳本
 *
 * 用途：呼叫 POST /api/tax/vat/calculate（可選再呼叫 /submit 提交申報）
 *
 * 使用方式：
 *   node scripts/test_vat_api.js
 *   node scripts/test_vat_api.js 202512 1 SZ
 *   node scripts/test_vat_api.js 202512 1 SZ --submit
 *
 * 參數：
 *   1) taxPeriod     稅款所屬期 YYYYMM，預設 202512
 *   2) taxpayerType  1=一般納稅人 / 2=小規模納稅人，預設 1
 *   3) bu_no         業務單位，預設 SZ
 *   --submit         算稅成功後一併提交申報
 */
require('dotenv').config();
const { signToken } = require('../middleware/auth');

const BASE = `http://localhost:${process.env.PORT || 3008}/api/tax`;
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const withSubmit = process.argv.includes('--submit');

const taxPeriod = args[0] || '202512';
const taxpayerType = Number(args[1] || 1);
const buNo = args[2] || 'SZ';

// 測試用 JWT（正式環境請改為登入取得）
const token = signToken({ user_id: 'VAT-API-TEST', admin: 'Yes' });

async function post(path, body) {
    const res = await fetch(BASE + path, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
    });
    return { status: res.status, body: await res.json() };
}

(async () => {
    try {
        console.log('=== VAT 算稅接口測試 ===');
        console.log(`  URL    : POST ${BASE}/vat/calculate`);
        console.log(`  參數   : taxPeriod=${taxPeriod} taxpayerType=${taxpayerType} bu_no=${buNo}`);
        console.log(`  納稅人 : ${taxpayerType === 1 ? '一般納稅人' : '小規模納稅人'}`);

        const calc = await post('/vat/calculate', {
            taxPeriod,
            taxpayerType,
            erpSyncToken: 'TEST-SCRIPT',
            bu_no: buNo
        });

        console.log(`\n  狀態碼 : ${calc.status}`);
        if (calc.status !== 200) {
            console.error('  算稅失敗:', JSON.stringify(calc.body, null, 2));
            process.exit(1);
        }

        const d = calc.body.data;
        console.log('  算稅結果:');
        console.log(`    declarationId  ${d.declarationId}`);
        console.log(`    銷售額合計     ${d.totalSalesAmt}`);
        console.log(`    銷項稅額       ${d.totalOutputTax}`);
        console.log(`    進項稅額       ${d.totalInputTax}`);
        console.log(`    上期留抵       ${d.prevPeriodCredit}`);
        console.log(`    應納稅額       ${d.taxPayable}`);
        console.log(`    附加稅—城建     ${d.surcharges.urbanMaintenance}`);
        console.log(`    附加稅—教育     ${d.surcharges.educationSurcharge}`);
        console.log(`    附加稅—地方教育 ${d.surcharges.localEducationSurcharge}`);
        console.log(`    稅負合計       ${
            (Number(d.taxPayable) + Number(d.surcharges.urbanMaintenance)
             + Number(d.surcharges.educationSurcharge)
             + Number(d.surcharges.localEducationSurcharge)).toFixed(2)
        }`);

        if (withSubmit) {
            const sub = await post(`/vat/${d.declarationId}/submit`, {
                operatorId: 'VAT-API-TEST',
                declarationId: d.declarationId
            });
            console.log(`\n  提交申報 : ${sub.status}`);
            if (sub.status === 200) {
                console.log(`    受理流水號 ${sub.body.data.taxBureauReceiptNo}`);
                console.log(`    狀態       ${sub.body.data.status}`);
                console.log(`    繳款期限   ${sub.body.data.paymentDeadline}`);
            } else {
                console.error('    提交失敗:', JSON.stringify(sub.body, null, 2));
                process.exit(1);
            }
        } else {
            console.log('\n  （加 --submit 可一併提交申報）');
        }

        console.log('\n✔ 測試通過');
        process.exit(0);
    } catch (err) {
        console.error('\n✘ 請求異常:', err.message);
        console.error('  請確認服務已啟動：node app.js');
        process.exit(1);
    }
})();
