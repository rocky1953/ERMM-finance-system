/**
 * 验证：进项发票明细（销售成本弹窗数据源）是否可被前端弹窗正确取到
 * 走真实 HTTP，复用前端同款请求：GET /api/invoice?bu_no=&YYYY_MM=&TX_type=AP
 * 默认验证 2023 / 2024 / 2025 三年，可用 --year=YYYY 过滤
 */
require('dotenv').config();
const { signToken } = require('../middleware/auth');
const { pool } = require('../config/db');

const BASE = 'http://localhost:3008';
const TOKEN = signToken({ user_id: 'VERIFY', admin: 'Yes', user_name: '驗證腳本' });

(async () => {
    const YEARS = process.argv.filter(a => a.startsWith('--year=')).map(a => a.split('=')[1]);
    const targets = YEARS.length ? YEARS : ['2023', '2024', '2025'];

    const [summ] = await pool.query(
        `SELECT bu_no, YYYY_MM, sale_cost_amt FROM mgm_finance_summary
          WHERE (${targets.map(() => 'YYYY_MM LIKE ?').join(' OR ')})
            AND sale_cost_amt > 0 ORDER BY bu_no, YYYY_MM`,
        targets.map(y => `${y}-%`)
    );

    let pass = 0, fail = 0;
    const out = [];

    for (const s of summ) {
        const url = `${BASE}/api/invoice?bu_no=${s.bu_no}&YYYY_MM=${s.YYYY_MM}&TX_type=AP`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
        const body = await r.json();
        const rows = body.data || [];
        const sumAmt = rows.reduce((a, x) => a + Number(x.amt || 0), 0);
        const sumTax = rows.reduce((a, x) => a + Number(x.tax_amt || 0), 0);
        const diff = Math.round((Number(s.sale_cost_amt) - sumAmt) * 100) / 100;
        const vatDiff = Math.round((sumTax - sumAmt * 0.13) * 100) / 100;
        const good = r.ok && body.success && rows.length > 0
            && Math.abs(diff) < 0.005 && Math.abs(vatDiff) <= 0.02;
        good ? pass++ : fail++;
        out.push({
            bu: s.bu_no, ym: s.YYYY_MM, http: r.status,
            rows: rows.length, ap_sum: sumAmt.toFixed(2),
            cost: Number(s.sale_cost_amt).toFixed(2),
            tax: sumTax.toFixed(2), diff: diff.toFixed(2),
            vat_diff: vatDiff.toFixed(2),
            ok: good ? 'PASS' : 'FAIL'
        });
    }

    console.table(out);
    console.log(`\n结果：${pass} PASS / ${fail} FAIL（共 ${summ.length} 个月）`);

    // 抽查一条明细字段完整性（前端表头需要 inv_date / inv_no / cust_name / amt / tax_amt / status1）
    const [sample] = await pool.query(
        `SELECT wk_date, invoice_no, client_id, sub_amt, VAT_amt, pay_date, DB_CR, remark
           FROM mgm_invoice_details
          WHERE bu_no='HM' AND TX_type='AP' AND YYYY_MM='2023-06' ORDER BY wk_date`
    );
    console.log('\n=== HM 2023-06 进项发票明细（前端弹窗将显示的内容）===');
    console.table(sample);

    await pool.end();
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
