/**
 * 验证 HN 账套 2023 全年数据完整性（真实 HTTP）
 */
require('dotenv').config();
const { signToken } = require('../middleware/auth');
const { pool } = require('../config/db');

const TOKEN = signToken({ user_id: 'VERIFY', admin: 'Yes', user_name: '驗證' });
const BASE = 'http://localhost:3008';

const get = async (p) => {
    const r = await fetch(BASE + p, { headers: { Authorization: `Bearer ${TOKEN}` } });
    let b = null;
    try { b = await r.json(); } catch { }
    return { http: r.status, ok: !!(b && b.success), data: (b && b.data) || null };
};

(async () => {
    const [summ] = await pool.query(
        `SELECT YYYY_MM, sale_amt, sale_cost_amt, ttl_asset_amt, ttl_debet_amt, stockholder_amt
           FROM mgm_finance_summary WHERE bu_no='HN' AND YYYY_MM LIKE '2023-%' ORDER BY YYYY_MM`);

    let pass = 0, fail = 0;
    const rows = [];

    for (const s of summ) {
        const ar = await get(`/api/invoice?bu_no=HN&YYYY_MM=${s.YYYY_MM}&TX_type=AR`);
        const ap = await get(`/api/invoice?bu_no=HN&YYYY_MM=${s.YYYY_MM}&TX_type=AP`);
        const arRows = ar.data || [], apRows = ap.data || [];
        const arSum = arRows.reduce((a, x) => a + Number(x.amt || 0), 0);
        const apSum = apRows.reduce((a, x) => a + Number(x.amt || 0), 0);
        const arTax = arRows.reduce((a, x) => a + Number(x.tax_amt || 0), 0);
        const apTax = apRows.reduce((a, x) => a + Number(x.tax_amt || 0), 0);
        const sale = Number(s.sale_amt), cost = Number(s.sale_cost_amt);
        const bal = Number(s.ttl_asset_amt) - (Number(s.ttl_debet_amt) + Number(s.stockholder_amt));

        const ok = ar.http === 200 && ap.http === 200
            && arRows.length === 5 && apRows.length === 5
            && Math.abs(arSum - sale) < 0.01 && Math.abs(apSum - cost) < 0.01
            && Math.abs(arTax - arSum * 0.13) <= 1 && Math.abs(apTax - apSum * 0.13) <= 1
            && Math.abs(bal) < 1;

        ok ? pass++ : fail++;
        rows.push({
            月份: s.YYYY_MM,
            销项行: arRows.length, 销项合计: arSum.toFixed(2), 收入: sale.toFixed(2),
            进项行: apRows.length, 进项合计: apSum.toFixed(2), 成本: cost.toFixed(2),
            借贷差: bal.toFixed(2),
            结果: ok ? 'PASS' : 'FAIL'
        });
    }

    console.table(rows);

    const totalSale = summ.reduce((a, s) => a + Number(s.sale_amt), 0);
    const totalCost = summ.reduce((a, s) => a + Number(s.sale_cost_amt), 0);
    console.log(`\n全年：营业收入 ${totalSale.toFixed(2)} / 销售成本 ${totalCost.toFixed(2)}`);

    // 其他账套未被影响
    for (const bu of ['HM', 'SZ']) {
        const [c] = await pool.query(
            `SELECT COUNT(*) c, ROUND(SUM(sub_amt),2) s FROM mgm_invoice_details
              WHERE bu_no=? AND YYYY_MM LIKE '2023-%' AND TX_type='AP'`, [bu]);
        console.log(`${bu} 2023 进项：rows=${c[0].c} sum=${c[0].s}`);
    }

    console.log(`\n结果：${pass} PASS / ${fail} FAIL（共 ${summ.length} 个月）`);
    await pool.end();
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
