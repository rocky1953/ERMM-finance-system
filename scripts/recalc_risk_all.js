/**
 * 重算全部帳套・期間的風控指標（Z-Score / Z2 / Z3 / BZ / JZ + 財務比率）
 *
 * 背景：資產負債表平衡修復後，權益(stockholder_amt)與資產總額變動，
 *       原儲存的 Z-Score / ROE / 負債比率等已失真，需重算。
 *
 * 用法：node scripts/recalc_risk_all.js
 *       （預設呼叫本機 http://localhost:3008/api/risk/calc，需服務已啟動）
 */
const { pool } = require('../config/db');

const BASE = process.env.RISK_BASE || 'http://localhost:3008';
const USER = process.env.RISK_USER || 'rocky';
const PASS = process.env.RISK_PASS || '68315711';

(async () => {
    const login = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: USER, password: PASS })
    }).then(r => r.json());
    if (!login.success) throw new Error('登入失敗：' + JSON.stringify(login));
    const token = login.data.token;

    const [rows] = await pool.query(
        `SELECT bu_no, YYYY_MM FROM mgm_finance_summary WHERE YYYY_MM >= '2023-01' ORDER BY bu_no, YYYY_MM`
    );
    console.log(`待重算：${rows.length} 筆\n`);

    let okCount = 0, failed = 0;
    for (const r of rows) {
        const res = await fetch(`${BASE}/api/risk/calc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ bu_no: r.bu_no, YYYY_MM: r.YYYY_MM })
        }).then(x => x.json()).catch(e => ({ success: false, message: e.message }));
        if (res.success) okCount++;
        else { failed++; console.log(`✗ ${r.bu_no} ${r.YYYY_MM}: ${res.message}`); }
    }

    console.log(`\n✅ 成功 ${okCount} 筆，失敗 ${failed} 筆`);

    const [chk] = await pool.query(
        `SELECT risk_color, COUNT(*) AS n, ROUND(MIN(Z_score),2) AS min_z, ROUND(MAX(Z_score),2) AS max_z,
                ROUND(AVG(debt_ratio),2) AS avg_dr, ROUND(AVG(ROE),2) AS avg_roe
           FROM mgm_finance_summary WHERE YYYY_MM >= '2023-01' GROUP BY risk_color`
    );
    console.log('\n風險燈號分佈：');
    chk.forEach(c => console.log(`  ${c.risk_color}: ${c.n} 筆 ｜ Z ${c.min_z}~${c.max_z} ｜ 平均負債比 ${c.avg_dr}% ｜ 平均 ROE ${c.avg_roe}%`));
    process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
