/**
 * 報稅模組審計腳本（第 3 / 4 層檢驗 + 異常用例）
 *
 * 檢查內容：
 *   A. 第 3 層：資料落庫完整性、受理收據關聯
 *   B. 第 4 層：業務規則反算一致性（VAT_R01 / R02 / R03）
 *   C. 異常用例：參數缺失、格式錯誤、類型越界、不存在 ID、重複提交
 *
 * 使用方式：
 *   node scripts/tax_audit.js
 *   需先啟動服務（node app.js），且已跑過 verify_tax_e2e.js
 */
require('dotenv').config();
const { pool } = require('../config/db');
const { signToken } = require('../middleware/auth');

const BASE = `http://localhost:${process.env.PORT || 3008}/api/tax`;
const TOL = 0.01;
let pass = 0, fail = 0;

function check(name, actual, expected) {
    const ok = Math.abs(Number(actual) - Number(expected)) <= TOL;
    ok ? pass++ : fail++;
    console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${name}: 反算=${expected}  存儲=${actual}`);
    return ok;
}
function assertStatus(name, actual, expected) {
    const ok = actual === expected;
    ok ? pass++ : fail++;
    console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${name}: 期望 ${expected}，實際 ${actual}`);
    return ok;
}

async function auditVat() {
    console.log('\n=== A/B. VAT 落庫與規則反算 ===');
    const [rows] = await pool.query(
        `SELECT * FROM vat_declarations ORDER BY create_time DESC LIMIT 1`
    );
    if (!rows.length) throw new Error('尚無 VAT 申報記錄，請先跑 verify_tax_e2e.js');
    const d = rows[0];
    console.log(`  申報單: ${d.declaration_id}  期間=${d.tax_period}  納稅人類型=${d.taxpayer_type}  狀態=${d.status}`);

    // 反查來源發票（季報涵蓋 period_start~period_end 全部月份）
    const start = d.period_start || d.tax_period;
    const end = d.period_end || d.tax_period;
    const variants = [];
    for (let m = Number(start.slice(4)); m <= Number(end.slice(4)); m++) {
        const ym = `${start.slice(0, 4)}${String(m).padStart(2, '0')}`;
        variants.push(`${ym.slice(0, 4)}/${ym.slice(4)}`, `${ym.slice(0, 4)}-${ym.slice(4)}`);
    }
    const ph = variants.map(() => '?').join(',');
    const [src] = await pool.query(
        `SELECT COALESCE(SUM(sub_amt),0) AS sales,
                COALESCE(SUM(sub_amt * IF(tax_rate>1, tax_rate/100, tax_rate)),0) AS outtax
           FROM mgm_invoice_details
          WHERE bu_no=? AND TX_type='AR' AND YYYY_MM IN (${ph})`,
        [d.bu_no, ...variants]
    );
    const srcSales = Number(src[0].sales);
    const isExempt = Number(d.tax_exempt) === 1;
    const srcOutDefault = isExempt ? 0
        : (d.taxpayer_type === 2 ? srcSales * 0.03 : Number(src[0].outtax));

    console.log('\n  [VAT_R01] 銷售額 / 銷項稅額');
    console.log(`        週期=${d.filing_cycle || 'MONTHLY'} 所屬期=${start}~${end}`
        + `${isExempt ? '（免徵）' : ''}`);
    check('銷售額合計', d.total_sales_amt, srcSales);
    check('銷項稅額', d.total_output_tax, srcOutDefault);

    console.log('\n  [VAT_R02] 應納稅額');
    check('應納稅額',
        d.tax_payable,
        Number(d.total_output_tax) - Number(d.total_input_tax) - Number(d.prev_period_credit));

    console.log('\n  [VAT_R03] 附加稅');
    check('城建稅 7%', d.urban_maintenance, Number(d.tax_payable) * 0.07);
    check('教育費附加 3%', d.education_surcharge, Number(d.tax_payable) * 0.03);
    check('地方教育附加 2%', d.local_education_surcharge, Number(d.tax_payable) * 0.02);

    console.log('\n  [收據關聯]');
    const [rc] = await pool.query(
        `SELECT tax_bureau_receipt_no, status FROM tax_submit_receipts WHERE module='VAT' AND biz_id=?`,
        [d.declaration_id]
    );
    if (d.status === 'SUBMITTED') {
        assertStatus('受理收據存在且成功', rc.length === 1 && rc[0].status === 'SUCCESS' ? 200 : 0, 200);
        if (rc.length) console.log(`           受理號 ${rc[0].tax_bureau_receipt_no}`);
    } else {
        console.log('    跳過（本單尚未提交）');
    }
    return d;
}

async function negativeCases(submittedId) {
    console.log('\n=== C. 異常用例 ===');
    const token = signToken({ user_id: 'AUDIT', admin: '管理員' });
    const post = async (path, body) => {
        const r = await fetch(BASE + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(body)
        });
        return { status: r.status, body: await r.json() };
    };

    // 確保存在一張已提交的單據，避免用例依賴執行順序
    let targetId = null;
    const [sub] = await pool.query(
        `SELECT declaration_id FROM vat_declarations
          WHERE status='SUBMITTED' ORDER BY create_time DESC LIMIT 1`);
    if (sub.length) {
        targetId = sub[0].declaration_id;
    } else {
        await post(`/vat/${submittedId}/submit`, { operatorId: 'AUDIT' });
        targetId = submittedId;
    }

    const cases = [
        ['缺 taxPeriod', '/vat/calculate', { taxpayerType: 1 }, 400],
        ['taxPeriod 格式錯誤', '/vat/calculate', { taxPeriod: '2025', taxpayerType: 1 }, 400],
        ['taxpayerType 越界', '/vat/calculate', { taxPeriod: '202512', taxpayerType: 3 }, 400],
        ['缺 bu_no', '/vat/calculate', { taxPeriod: '202512', taxpayerType: 1 }, 400],
        ['提交不存在的 ID', '/vat/not-exist-id/submit', { operatorId: 'AUDIT' }, 404],
        ['重複提交', `/vat/${targetId}/submit`, { operatorId: 'AUDIT' }, 400]
    ];

    for (const [name, path, body, expect] of cases) {
        const r = await post(path, body);
        assertStatus(name, r.status, expect);
        console.log(`           → ${r.body.message}`);
    }
}

async function auditCitIit() {
    console.log('\n=== D. CIT / IIT 基本核對 ===');
    const [c] = await pool.query(
        `SELECT * FROM cit_annual_settlements ORDER BY create_time DESC LIMIT 1`);
    if (c.length) {
        const x = c[0];
        console.log(`  CIT: ${x.settlement_id} 年度=${x.tax_year}`);
        check('應納稅所得額', x.taxable_income,
            Number(x.total_revenue) - Number(x.total_cost) - Number(x.tax_free_income)
            + Number(x.tax_adjust_increase) - Number(x.tax_adjust_decrease));
        check('應納稅額', x.tax_payable, Number(x.taxable_income) * Number(x.tax_rate)
            - Number(x.tax_exemptions) - Number(x.tax_credits));
        check('補退稅額', x.refund_or_supplement,
            Number(x.tax_payable) - Number(x.accum_prepaid_tax) - Number(x.withheld_tax));
    }

    const [i] = await pool.query(
        `SELECT * FROM iit_withholding_batches ORDER BY create_time DESC LIMIT 1`);
    if (i.length) {
        const b = i[0];
        const [sum] = await pool.query(
            `SELECT COALESCE(SUM(current_period_tax),0) AS t, COUNT(*) AS c
               FROM iit_withholding_details WHERE withholding_batch_id=?`,
            [b.withholding_batch_id]
        );
        console.log(`  IIT: ${b.withholding_batch_id} 期間=${b.tax_period}`);
        assertStatus('明細筆數與批次一致', Number(b.total_employees), Number(sum[0].c));
        check('代扣稅額合計', b.total_withheld_tax, sum[0].t);

        const [one] = await pool.query(
            `SELECT * FROM iit_withholding_details WHERE withholding_batch_id=? LIMIT 1`,
            [b.withholding_batch_id]
        );
        if (one.length) {
            const e = one[0];
            const taxable = Math.max(0, Number(e.cumulative_income) - Number(e.cumulative_deduction));
            const brackets = [[36000,.03,0],[144000,.10,2520],[300000,.20,16920],
                              [420000,.25,31920],[660000,.30,52920],[960000,.35,85920],
                              [Infinity,.45,181920]];
            const br = brackets.find(x => taxable <= x[0]);
            check('本期稅額（示例員工）', e.current_period_tax,
                Math.max(0, taxable * br[1] - br[2] - Number(e.cumulative_paid_tax)));
        }
    }
}

(async () => {
    try {
        const vat = await auditVat();
        await auditCitIit();
        await negativeCases(vat.declaration_id);

        console.log(`\n=== 彙總：PASS ${pass} / FAIL ${fail} ===`);
        if (fail > 0) {
            console.log('✘ 存在未通過項目');
            process.exit(1);
        }
        console.log('✔ 全部檢驗通過');
        process.exit(0);
    } catch (err) {
        console.error('\n審計異常:', err.message);
        process.exit(1);
    }
})();
