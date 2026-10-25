/**
 * 修复发票税额口径不一致：
 *   历史 AR 销项发票 VAT_amt 以「含税÷(1+13%)×13%」（即 sub_amt×13/113）写入，
 *   而算税引擎口径为 sub_amt × tax_rate/100（不含税 × 税率）。
 *   本脚本将全库 VAT_amt 统一重算为 sub_amt × tax_rate/100（四舍五入到分）。
 * 用法：node scripts/fix_invoice_vat_amt.js [--apply]
 *   默认 dry-run 仅显示将影响行数；--apply 单一事务写入。
 */
const { pool } = require('../config/db');
const APPLY = process.argv.includes('--apply');

(async () => {
    // 先统计将影响行数（偏差 > 0.01 元）
    const [preview] = await pool.query(`
        SELECT TX_type, COUNT(*) cnt,
               ROUND(SUM(VAT_amt),2) old_sum,
               ROUND(SUM(sub_amt*tax_rate/100),2) new_sum
          FROM mgm_invoice_details
         WHERE tax_rate IS NOT NULL
           AND ABS(VAT_amt - sub_amt*tax_rate/100) > 0.01
         GROUP BY TX_type`);
    console.log(APPLY ? '【APPLY 模式】' : '【DRY-RUN】', '将修正行数：');
    console.table(preview);

    if (!APPLY) { console.log('加 --apply 执行写入'); process.exit(0); }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [r] = await conn.query(`
            UPDATE mgm_invoice_details
               SET VAT_amt = ROUND(sub_amt * tax_rate / 100, 2)
             WHERE tax_rate IS NOT NULL
               AND ABS(VAT_amt - sub_amt*tax_rate/100) > 0.01`);
        console.log(`✅ 已更新 ${r.affectedRows} 行`);
        await conn.commit();
    } catch (e) {
        await conn.rollback();
        console.error('❌ 已回滚:', e.message);
        process.exit(1);
    } finally { conn.release(); }

    // 复核：偏差>1元的月份分组应为 0
    const [chk] = await pool.query(`
        SELECT bu_no, YYYY_MM, TX_type,
               ROUND(SUM(VAT_amt)-SUM(sub_amt*tax_rate/100),2) diff
          FROM mgm_invoice_details
         WHERE tax_rate IS NOT NULL
         GROUP BY bu_no, YYYY_MM, TX_type
        HAVING ABS(diff) > 1`);
    console.log(chk.length === 0 ? '✅ 复核通过：全库无 >1元 偏差' : `⚠ 仍有 ${chk.length} 组偏差`);
    console.table(chk.slice(0, 10));
    process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
