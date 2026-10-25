/**
 * 核对 2024/2025 年度 VAT 算税结果与明细弹窗合计是否一致
 *   销项：引擎 SUM(sub_amt*tax_rate/100) vs 明细 SUM(VAT_amt)
 *   进项：引擎 SUM(VAT_amt)          vs 明细 SUM(VAT_amt)（恒等，仅列示）
 * 用法：node scripts/verify_vat_detail_consistency.js [--fix]
 *   --fix 时对尾差月做末张发票差额兜底（调整该月最大金额发票的 VAT_amt）
 */
const { pool } = require('../config/db');
const FIX = process.argv.includes('--fix');
const r2 = v => Math.round(v * 100) / 100;

(async () => {
    const periods = [];
    for (const y of [2023, 2024, 2025]) for (let m = 1; m <= 12; m++) periods.push(`${y}${String(m).padStart(2, '0')}`);

    let pass = 0, fail = 0;
    const fails = [];
    for (const bu of ['HM', 'SZ', 'HN']) {
        for (const p of periods) {
            const v1 = p, v2 = p.slice(0, 4) + '-' + p.slice(4);
            const [rows] = await pool.query(
                `SELECT TX_type, ROUND(SUM(sub_amt),2) amt,
                        ROUND(SUM(sub_amt*tax_rate/100),2) engine_tax,
                        ROUND(SUM(VAT_amt),2) detail_tax
                   FROM mgm_invoice_details
                  WHERE bu_no=? AND YYYY_MM IN (?,?) GROUP BY TX_type`, [bu, v1, v2]);
            const ar = rows.find(r => r.TX_type === 'AR');
            const ap = rows.find(r => r.TX_type === 'AP');
            const arDiff = ar ? r2(ar.detail_tax - ar.engine_tax) : 0;
            const ok = Math.abs(arDiff) < 0.005;   // 销项引擎 vs 明细
            if (ok) pass++;
            else { fail++; fails.push({ bu, p, arDiff, engine: ar && ar.engine_tax, detail: ar && ar.detail_tax }); }
        }
    }
    console.log(`销项口径核对：${pass} PASS / ${fail} FAIL（共 72 个账套月）`);
    if (fails.length) console.table(fails);

    if (FIX && fails.length) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            for (const f of fails) {
                const v1 = f.p, v2 = f.p.slice(0, 4) + '-' + f.p.slice(4);
                // 末张（金额最大）发票兜底吸收尾差
                const [big] = await conn.query(
                    `SELECT uid, VAT_amt FROM mgm_invoice_details
                      WHERE bu_no=? AND YYYY_MM IN (?,?) AND TX_type='AR'
                      ORDER BY sub_amt DESC LIMIT 1`, [f.bu, v1, v2]);
                if (!big.length) continue;
                const newVat = r2(Number(big[0].VAT_amt) - f.arDiff);
                await conn.query(`UPDATE mgm_invoice_details SET VAT_amt=? WHERE uid=?`, [newVat, big[0].uid]);
                console.log(`  修正 ${f.bu} ${f.p}: uid=${big[0].uid} VAT ${big[0].VAT_amt} → ${newVat}（差额 ${f.arDiff}）`);
            }
            await conn.commit();
            console.log('✅ 尾差已修正');
        } catch (e) { await conn.rollback(); console.error('❌ 回滚:', e.message); }
        finally { conn.release(); }
    }
    process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
