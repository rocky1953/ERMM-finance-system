/**
 * 補正 net_sale_amt（淨銷貨收入）
 *
 * 問題：2024 / 2025 全部 72 筆（及 2023 部分 12 筆）net_sale_amt = 0，
 *       但 sale_amt 與發票 AR 明細一致，導致合併報表、戰情看板的營收加總為 0。
 *
 * 做法：net_sale_amt = sale_amt − sale_discount_amt（缺值時回填），不動利潤欄位。
 *
 * 用法：node scripts/fix_net_sale.js [--apply]
 */
const { pool } = require('../config/db');

const APPLY = process.argv.includes('--apply');

(async () => {
    const [rows] = await pool.query(
        `SELECT uid, bu_no, YYYY_MM, sale_amt, sale_discount_amt, net_sale_amt
           FROM mgm_finance_summary
          WHERE YYYY_MM >= '2023-01' AND net_sale_amt = 0 AND sale_amt > 0
          ORDER BY bu_no, YYYY_MM`
    );
    console.log(`模式：${APPLY ? 'APPLY' : 'DRY-RUN'}｜待補正 ${rows.length} 筆\n`);

    const conn = APPLY ? await pool.getConnection() : null;
    if (conn) await conn.beginTransaction();
    let n = 0;
    try {
        for (const r of rows) {
            const net = Number(r.sale_amt) - Number(r.sale_discount_amt || 0);
            if (n < 6) console.log(`${r.bu_no} ${r.YYYY_MM}: sale=${r.sale_amt} 折讓=${r.sale_discount_amt} → net_sale=${net.toFixed(2)}`);
            if (APPLY) {
                await conn.execute(
                    `UPDATE mgm_finance_summary SET net_sale_amt=?, update_time=NOW() WHERE uid=?`,
                    [net, r.uid]
                );
                n++;
            }
        }
        if (conn) await conn.commit();
    } catch (e) {
        if (conn) await conn.rollback();
        throw e;
    } finally {
        if (conn) conn.release();
    }

    if (APPLY) {
        const [chk] = await pool.query(
            `SELECT LEFT(YYYY_MM,4) y, SUM(net_sale_amt = 0) zero_net, COUNT(*) n,
                    ROUND(SUM(net_sale_amt),2) total_net
               FROM mgm_finance_summary WHERE YYYY_MM >= '2023-01' GROUP BY LEFT(YYYY_MM,4)`
        );
        console.log(`\n✅ 已補正 ${n} 筆`);
        chk.forEach(c => console.log(`  ${c.y}: 淨銷貨合計 ${Number(c.total_net).toLocaleString()}｜仍為 0 的 ${c.zero_net} / ${c.n} 筆`));
    }
    process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
