/**
 * CIT 收入/成本人工覆蓋 集成測試
 * 用法: node scripts/test_cit_override.js
 *
 * 核心驗證點：
 *   1) 無覆蓋時，CIT.calculate 用財報匯總值
 *   2) 有覆蓋時，CIT.calculate 用覆蓋值；settlement.is_overridden=1
 *   3) 計算式: (effectiveRevenue - effectiveCost) × taxRate
 *   4) GET/inputs/cit 正確回傳 override + autoRevenue/autoCost 對照
 *   5) PUT 時若前端沒傳 override 字段，舊值保留；傳 null 則清除
 *   6) 邊界：覆蓋值為負數 → 400
 */
require('dotenv').config();
const { pool } = require('../config/db');
const http = require('http');
const { signToken } = require('../middleware/auth');

const BU = '10010';
const YEAR = '2025';
const TOKEN = signToken({ user_id: 'CIT_OVR_TEST', admin: '管理員' });
const PASS = []; const FAIL = [];
function ok(n) { PASS.push(n); console.log(`  ✓ ${n}`); }
function fail(n, err) { FAIL.push(n); console.log(`  ✗ ${n}: ${err}`); }

function req(method, url, body) {
    return new Promise((resolve, reject) => {
        const payload = body != null ? JSON.stringify(body) : null;
        const headers = {
            'Authorization': `Bearer ${TOKEN}`
        };
        if (payload) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(payload);
        }
        const r = http.request({
            hostname: '127.0.0.1', port: 3008, path: url, method, headers
        }, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
                catch { resolve({ status: res.statusCode, body: d }); }
            });
        });
        r.on('error', reject);
        if (payload) r.write(payload);
        r.end();
    });
}

(async () => {
    console.log('=== CIT 收入/成本人工覆蓋 集成測試 ===\n');

    // cleanup
    await pool.execute('DELETE FROM tax_cit_inputs WHERE bu_no=? AND tax_year=?', [BU, YEAR]);
    await pool.execute('DELETE FROM cit_annual_settlements WHERE bu_no=? AND tax_year=?', [BU, YEAR]);

    // 1) 確認財報自動值存在
    const [fs] = await pool.execute(
        `SELECT COALESCE(SUM(sale_amt),0) AS sale_amt,
                COALESCE(SUM(sale_cost_amt),0) AS cost_amt
           FROM mgm_finance_summary WHERE bu_no=? AND YYYY=?`, [BU, YEAR]);
    const autoRev = Number(fs[0]?.sale_amt || 0);
    const autoCost = Number(fs[0]?.cost_amt || 0);
    console.log(`  ℹ 財報自動值 revenue=${autoRev} cost=${autoCost}`);

    // 2) 無覆蓋，跑一次 CIT
    const r1 = await req('POST', '/api/tax/cit/calculate', {
        taxYear: YEAR, taxpayerIdentNo: '9144030071526726X1', bu_no: BU
    });
    if (r1.status !== 200) { fail('[2] 無覆蓋算稅 HTTP', JSON.stringify(r1.body)); }
    else {
        const d = r1.body.data;
        if (d.totalRevenue === autoRev) ok(`[2.1] 無覆蓋時 revenue 取財報 ${autoRev}`);
        else fail('[2.1] revenue', `expect ${autoRev} got ${d.totalRevenue}`);
        if (d.totalCost === autoCost) ok(`[2.2] 無覆蓋時 cost 取財報 ${autoCost}`);
        else fail('[2.2] cost', `expect ${autoCost} got ${d.totalCost}`);
        if (d.isOverridden === false) ok('[2.3] isOverridden=false');
        else fail('[2.3] isOverridden', d.isOverridden);

        // 反算核對
        const expectedTaxable = Math.max(0, autoRev - autoCost);
        const expectedPayable = Math.max(0, round2(expectedTaxable * 0.25));
        if (near(expectedPayable, d.taxPayable)) ok(`[2.4] 計算式核對 (${autoRev} - ${autoCost}) × 25% = ${expectedPayable}`);
        else fail('[2.4] 計算式', `expect ${expectedPayable} got ${d.taxPayable}`);

        // 落庫核對
        const [bd] = await pool.execute(
            'SELECT total_revenue, total_cost, is_overridden FROM cit_annual_settlements WHERE settlement_id=?',
            [d.settlementId]);
        if (bd[0].is_overridden === 0) ok('[2.5] settlements.is_overridden=0');
        else fail('[2.5] is_overridden', bd[0].is_overridden);
    }

    // 3) 寫入覆蓋值
    const OVR_REV = 10000000, OVR_COST = 6500000;
    const r2 = await req('PUT', '/api/tax/inputs/cit', {
        bu_no: BU, taxYear: YEAR, taxRate: 0.25, accumPrepaidTax: 0, withheldTax: 0,
        revenueOverride: OVR_REV, costOverride: OVR_COST,
        overrideReason: '測試覆蓋'
    });
    if (r2.status !== 200) { fail('[3] PUT override HTTP', JSON.stringify(r2.body)); }
    else {
        const d = r2.body.data;
        if (d.revenueOverride === OVR_REV) ok(`[3.1] revenueOverride=${OVR_REV}`);
        else fail('[3.1] revenueOverride', d.revenueOverride);
        if (d.costOverride === OVR_COST) ok(`[3.2] costOverride=${OVR_COST}`);
        else fail('[3.2] costOverride', d.costOverride);
    }

    // 4) GET 應回傳 override + auto 對照
    const r3 = await req('GET', `/api/tax/inputs/cit?bu_no=${BU}&taxYear=${YEAR}`);
    if (r3.status === 200) {
        const d = r3.body.data;
        if (d.revenueOverride === OVR_REV && d.costOverride === OVR_COST) ok('[4.1] GET 回傳 override');
        else fail('[4.1] GET override', JSON.stringify({ r: d.revenueOverride, c: d.costOverride }));
        if (d.autoRevenue === autoRev && d.autoCost === autoCost) ok('[4.2] GET 回傳 auto 對照');
        else fail('[4.2] GET auto', JSON.stringify({ ar: d.autoRevenue, ac: d.autoCost }));
        if (d.overrideReason === '測試覆蓋') ok('[4.3] overrideReason');
        else fail('[4.3] overrideReason', d.overrideReason);
    } else fail('[4] GET HTTP', JSON.stringify(r3.body));

    // 5) 有覆蓋，再跑 CIT
    const r4 = await req('POST', '/api/tax/cit/calculate', {
        taxYear: YEAR, taxpayerIdentNo: '9144030071526726X1', bu_no: BU
    });
    if (r4.status !== 200) { fail('[5] 有覆蓋算稅 HTTP', JSON.stringify(r4.body)); }
    else {
        const d = r4.body.data;
        if (d.totalRevenue === OVR_REV) ok(`[5.1] revenue 用覆蓋值 ${OVR_REV}`);
        else fail('[5.1] revenue', `expect ${OVR_REV} got ${d.totalRevenue}`);
        if (d.totalCost === OVR_COST) ok(`[5.2] cost 用覆蓋值 ${OVR_COST}`);
        else fail('[5.2] cost', `expect ${OVR_COST} got ${d.totalCost}`);
        if (d.financeRevenue === autoRev) ok('[5.3] 回傳 financeRevenue 保留財報原值');
        else fail('[5.3] financeRevenue', d.financeRevenue);
        if (d.isOverridden === true) ok('[5.4] isOverridden=true');
        else fail('[5.4] isOverridden', d.isOverridden);

        const expectedTaxable = OVR_REV - OVR_COST;
        const expectedPayable = round2(expectedTaxable * 0.25);
        if (near(expectedPayable, d.taxPayable)) ok(`[5.5] 計算式核對 (${OVR_REV} - ${OVR_COST}) × 25% = ${expectedPayable}`);
        else fail('[5.5] 計算式', `expect ${expectedPayable} got ${d.taxPayable}`);

        // 落庫
        const [bd] = await pool.execute(
            'SELECT total_revenue, total_cost, is_overridden FROM cit_annual_settlements WHERE settlement_id=?',
            [d.settlementId]);
        if (bd[0].is_overridden === 1 && Number(bd[0].total_revenue) === OVR_REV && Number(bd[0].total_cost) === OVR_COST)
            ok('[5.6] settlements 正確記錄覆蓋值與 is_overridden=1');
        else fail('[5.6] settlements', JSON.stringify(bd[0]));
    }

    // 6) 清除覆蓋（PUT 傳 null），應回到財報值
    const r5 = await req('PUT', '/api/tax/inputs/cit', {
        bu_no: BU, taxYear: YEAR, taxRate: 0.25, accumPrepaidTax: 0, withheldTax: 0,
        revenueOverride: null, costOverride: null,
        overrideReason: null
    });
    if (r5.status !== 200) fail('[6] 清除覆蓋 PUT', JSON.stringify(r5.body));
    else {
        const r5g = await req('GET', `/api/tax/inputs/cit?bu_no=${BU}&taxYear=${YEAR}`);
        if (r5g.body.data.revenueOverride == null && r5g.body.data.costOverride == null) ok('[6.1] 覆蓋清除為 NULL');
        else fail('[6.1] 清除後', JSON.stringify(r5g.body.data));
        const r6 = await req('POST', '/api/tax/cit/calculate', {
            taxYear: YEAR, taxpayerIdentNo: '9144030071526726X1', bu_no: BU
        });
        if (r6.body?.data?.totalRevenue === autoRev && r6.body?.data?.isOverridden === false)
            ok('[6.2] 清除後 CIT 自動回到財報值');
        else fail('[6.2] 清除後算稅', JSON.stringify(r6.body?.data));
    }

    // 7) 邊界：覆蓋值負數 → 400
    const rNeg = await req('PUT', '/api/tax/inputs/cit', {
        bu_no: BU, taxYear: YEAR, taxRate: 0.25, accumPrepaidTax: 0, withheldTax: 0,
        revenueOverride: -100, costOverride: 0
    });
    if (rNeg.status === 400) ok('[7] 負數覆蓋 → 400');
    else fail('[7] 負數覆蓋', `status=${rNeg.status}`);

    // cleanup
    await pool.execute('DELETE FROM tax_cit_inputs WHERE bu_no=? AND tax_year=?', [BU, YEAR]);
    await pool.execute('DELETE FROM cit_annual_settlements WHERE bu_no=? AND tax_year=?', [BU, YEAR]);

    console.log(`\n=== 結果: ${PASS.length} PASS / ${FAIL.length} FAIL ===`);
    if (FAIL.length > 0) { FAIL.forEach(f => console.log('  -', f)); process.exit(1); }
    await pool.end();
})().catch(e => { console.error('FATAL', e); process.exit(2); });

function round2(x) { return Math.round((Number(x) + Number.EPSILON) * 100) / 100; }
function near(a, b) { return Math.abs(Number(a) - Number(b)) <= 0.01; }
