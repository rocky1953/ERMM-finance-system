/**
 * 年終獎單獨計稅 集成測試
 * 用法: node scripts/test_iit_bonus.js
 */
require('dotenv').config();
const { pool } = require('../config/db');
const http = require('http');
const { signToken } = require('../middleware/auth');

const BU = '10010';
const YEAR = '2025';
const TOKEN = signToken({ user_id: 'BONUS_TEST', admin: 'Yes' });
const PASS = []; const FAIL = [];
function ok(name) { PASS.push(name); console.log(`  ✓ ${name}`); }
function fail(name, err) { FAIL.push(name); console.log(`  ✗ ${name}: ${err}`); }

async function httpPost(url, body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = http.request({
            hostname: '127.0.0.1', port: 3008, path: url, method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                'Authorization': `Bearer ${TOKEN}`
            }
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}
async function httpGet(url) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1', port: 3008, path: url, method: 'GET',
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
        });
        req.on('error', reject);
        req.end();
    });
}

// 測試用例 — 不同獎金額對應的適用稅率（按月度稅率表）
const CASES = [
    // bonus ÷ 12 = 2500，<=3000 → 3%，速扣 0
    { emp: 'EMP-001', name: '張三',  bonus: 30000,  expectRate: 0.03, expectQuick: 0,    expectTax: 900 },
    // bonus ÷ 12 = 10000，3000<10000<=12000 → 10%，速扣 210
    { emp: 'EMP-002', name: '李四',  bonus: 120000, expectRate: 0.10, expectQuick: 210,  expectTax: 11790 },
    // bonus ÷ 12 = 25000，12000<25000<=25000 → 20%，速扣 1410
    { emp: 'EMP-003', name: '王五',  bonus: 300000, expectRate: 0.20, expectQuick: 1410, expectTax: 58590 },
    // bonus ÷ 12 = 35000，25000<35000<=35000 → 25%，速扣 2660
    { emp: 'EMP-004', name: '趙六',  bonus: 420000, expectRate: 0.25, expectQuick: 2660, expectTax: 102340 },
    // bonus ÷ 12 = 45000，35000<45000<=55000 → 30%，速扣 4410
    { emp: 'EMP-005', name: '孫七',  bonus: 540000, expectRate: 0.30, expectQuick: 4410, expectTax: 157590 },
    // bonus ÷ 12 = 70000，55000<70000<=80000 → 35%，速扣 7160
    { emp: 'EMP-006', name: '周八',  bonus: 840000, expectRate: 0.35, expectQuick: 7160, expectTax: 286840 },
    // bonus ÷ 12 = 100000，>80000 → 45%，速扣 15160
    { emp: 'EMP-007', name: '吳九',  bonus: 1200000,expectRate: 0.45, expectQuick: 15160,expectTax: 524840 }
];

(async () => {
    console.log('=== IIT 年終獎單獨計稅 集成測試 ===\n');

    // cleanup
    await pool.execute(
        `DELETE FROM bonus_details WHERE bu_no=? AND tax_year=?`, [BU, YEAR]);
    await pool.execute(
        `DELETE FROM iit_withholding_batches
          WHERE bu_no=? AND income_type='YEAR_END_BONUS'`, [BU]);

    // 1. 寫入錄入 — 全部 SEPARATE
    for (const c of CASES) {
        const r = await httpPost('/api/tax/inputs/bonus', {
            bu_no: BU, taxYear: YEAR,
            employee_id: c.emp, employee_name: c.name,
            bonus_amount: c.bonus, tax_method: 'SEPARATE'
        });
        if (r.status === 200 && r.body.data && Number(r.body.data.bonus_amount) === c.bonus) {
            ok(`[1.1] 錄入 ${c.emp}`);
        } else {
            fail(`[1.1] 錄入 ${c.emp}`, JSON.stringify(r.body));
        }
    }

    // 2. 查詢錄入列表
    const g1 = await httpGet(`/api/tax/inputs/bonus?bu_no=${BU}&taxYear=${YEAR}`);
    if (g1.status === 200 && g1.body.data.length === CASES.length) {
        ok(`[1.2] GET 錄入列表 ${CASES.length} 條`);
    } else {
        fail(`[1.2] GET 錄入列表`, JSON.stringify(g1.body).substring(0, 200));
    }

    // 3. 計算 SEPARATE 年終獎
    const r = await httpPost('/api/tax/iit/bonus/calculate', {
        bu_no: BU, taxYear: YEAR, taxMethod: 'SEPARATE'
    });
    if (r.status !== 200) {
        fail('[2.1] 計算 SEPARATE HTTP', JSON.stringify(r.body));
    } else {
        const data = r.body.data;
        ok(`[2.1] 計算 SEPARATE HTTP 200`);
        if (data.employeeDetails.length === CASES.length) ok('[2.2] 員工明細數量');
        else fail('[2.2] 員工明細數量', `expect ${CASES.length} got ${data.employeeDetails.length}`);
        if (data.taxMethod === 'SEPARATE') ok('[2.3] taxMethod=SEPARATE');
        else fail('[2.3] taxMethod', data.taxMethod);

        // 逐條核對稅率與應納稅額
        for (const d of data.employeeDetails) {
            const exp = CASES.find(c => c.emp === d.employeeId);
            if (!exp) { fail(`[2.4] 找不到對應用例 ${d.employeeId}`); continue; }
            const rateMatch = Number(d.applicableTaxRate) === exp.expectRate;
            const quickMatch = Number(d.quickDeduction) === exp.expectQuick;
            const taxMatch   = Number(d.bonusTax)        === exp.expectTax;
            if (rateMatch && quickMatch && taxMatch) {
                ok(`[2.4] ${d.employeeId} rate=${d.applicableTaxRate} quick=${d.quickDeduction} tax=${d.bonusTax}`);
            } else {
                fail(`[2.4] ${d.employeeId}`,
                     `expect r=${exp.expectRate} q=${exp.expectQuick} t=${exp.expectTax}, got r=${d.applicableTaxRate} q=${d.quickDeduction} t=${d.bonusTax}`);
            }
        }

        // 總額核對
        const expectedTotalBonus = CASES.reduce((s, c) => s + c.bonus, 0);
        const expectedTotalTax   = CASES.reduce((s, c) => s + c.expectTax, 0);
        if (Number(data.totalBonus) === expectedTotalBonus) ok(`[2.5] 總獎金 ${expectedTotalBonus}`);
        else fail('[2.5] 總獎金', `expect ${expectedTotalBonus} got ${data.totalBonus}`);
        if (Number(data.totalWithheldTax) === expectedTotalTax) ok(`[2.6] 總稅額 ${expectedTotalTax}`);
        else fail('[2.6] 總稅額', `expect ${expectedTotalTax} got ${data.totalWithheldTax}`);
    }

    // 4. 落庫核對：批次明細含 bonus_amount / bonus_tax / bonus_method
    const batchId = r.body?.data?.bonusBatchId;
    if (batchId) {
        const [rows] = await pool.execute(
            'SELECT * FROM iit_withholding_batches WHERE withholding_batch_id=?', [batchId]);
        const bd = rows[0];
        if (bd && bd.income_type === 'YEAR_END_BONUS' && bd.bonus_mode === 'SEPARATE') {
            ok(`[3.1] 批次 income_type/bonus_mode`);
        } else {
            fail('[3.1] 批次 income_type/bonus_mode',
                 JSON.stringify({ income_type: bd?.income_type, bonus_mode: bd?.bonus_mode }));
        }
        const [dets] = await pool.execute(
            `SELECT employee_id, bonus_amount, bonus_tax, bonus_method, current_period_tax
               FROM iit_withholding_details WHERE withholding_batch_id=?`, [batchId]);
        let detailOk = true;
        for (const d of dets) {
            const exp = CASES.find(c => c.emp === d.employee_id);
            if (!exp) continue;
            if (Number(d.bonus_amount) !== exp.bonus ||
                Number(d.bonus_tax)    !== exp.expectTax ||
                d.bonus_method         !== 'SEPARATE') {
                detailOk = false; break;
            }
        }
        if (detailOk && dets.length === CASES.length) ok('[3.2] 明細 bonus 欄位落庫正確');
        else fail('[3.2] 明細 bonus 欄位落庫', `count=${dets.length}`);
    } else {
        fail('[3] 批次落庫', '沒有 batchId');
    }

    // 5. delete
    if (g1.body?.data?.[0]?.id) {
        const delId = g1.body.data[0].id;
        const dr = await http.request({hostname:'127.0.0.1', port:3008,
            path:`/api/tax/inputs/bonus/${delId}`, method:'DELETE',
            headers: { 'Authorization': `Bearer ${TOKEN}` }}, res => {
            let data = ''; res.on('data', c=>data+=c); res.on('end', () => {
                if (res.statusCode === 200 && JSON.parse(data).data.affectedRows === 1) {
                    ok('[4] DELETE 成功');
                } else fail('[4] DELETE', `status=${res.statusCode} ${data}`);
            });
        });
        dr.end();
    }

    // 6. 錯誤用例
    const e1 = await httpPost('/api/tax/iit/bonus/calculate', { bu_no: BU, taxYear: 'BAD' });
    if (e1.status === 400) ok('[5.1] taxYear 格式錯誤 → 400');
    else fail('[5.1] taxYear 格式錯誤', `status=${e1.status}`);

    const e2 = await httpPost('/api/tax/inputs/bonus', {});
    if (e2.status === 400) ok('[5.2] 空 body → 400');
    else fail('[5.2] 空 body', `status=${e2.status}`);

    // 7. COMBINED 路徑：寫入 COMBINED 並計算
    await pool.execute(
        `DELETE FROM bonus_details WHERE bu_no=? AND tax_year=? AND employee_id='EMP-008'`,
        [BU, YEAR]);
    await httpPost('/api/tax/inputs/bonus', {
        bu_no: BU, taxYear: YEAR, employee_id: 'EMP-008',
        employee_name: '測試COMBINED', bonus_amount: 60000, tax_method: 'COMBINED'
    });
    const rc = await httpPost('/api/tax/iit/bonus/calculate', {
        bu_no: BU, taxYear: YEAR, taxMethod: 'COMBINED'
    });
    if (rc.status === 200 && rc.body.data.taxMethod === 'COMBINED' && rc.body.data.employeeDetails.length >= 1) {
        ok('[6] COMBINED 路徑 HTTP OK');
    } else {
        fail('[6] COMBINED 路徑', JSON.stringify(rc.body).substring(0, 200));
    }

    // cleanup
    await pool.execute(`DELETE FROM bonus_details WHERE bu_no=? AND tax_year=?`, [BU, YEAR]);
    await pool.execute(
        `DELETE FROM iit_withholding_batches WHERE bu_no=? AND income_type='YEAR_END_BONUS'`, [BU]);

    console.log(`\n=== 結果: ${PASS.length} PASS / ${FAIL.length} FAIL ===`);
    if (FAIL.length > 0) {
        console.log('失敗項:'); FAIL.forEach(f => console.log('  -', f));
        process.exit(1);
    }
    await pool.end();
})().catch(e => { console.error('FATAL', e); process.exit(2); });
