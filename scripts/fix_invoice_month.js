/**
 * 補齊發票表 YYYY_MM（缺月）並去除完全重複的單據
 *
 * 現況：13 筆 YYYY_MM 為空，wk_date 均在 2024-12；
 *       同一發票號被重複插入 2~3 次（客戶A/B/C/D、供應商X 等測試單）。
 *
 * 做法：
 *   1. YYYY_MM = DATE_FORMAT(wk_date, '%Y-%m')
 *   2. 完全相同（bu_no/TX_type/invoice_no/wk_date/sub_amt/VAT_amt）只保留 uid 最小的一筆
 *
 * 用法：node scripts/fix_invoice_month.js [--apply]
 */
const { pool } = require('../config/db');
const APPLY = process.argv.includes('--apply');

(async () => {
    const [empty] = await pool.query(
        `SELECT COUNT(*) n, SUM(wk_date IS NULL) no_wkdate
           FROM mgm_invoice_details WHERE YYYY_MM IS NULL OR TRIM(YYYY_MM)=''`
    );
    console.log(`模式：${APPLY ? 'APPLY' : 'DRY-RUN'}｜缺月 ${empty[0].n} 筆（無 wk_date ${empty[0].no_wkdate} 筆）`);

    const [dups] = await pool.query(
        `SELECT bu_no, TX_type, invoice_no, COUNT(*) n, MIN(uid) keep_uid, SUM(sub_amt) total
           FROM mgm_invoice_details
          WHERE YYYY_MM IS NULL OR TRIM(YYYY_MM)=''
          GROUP BY bu_no, TX_type, invoice_no HAVING COUNT(*) > 1`
    );
    console.log('\n重複單號：');
    dups.forEach(d => console.log(`  ${d.bu_no}/${d.TX_type} ${d.invoice_no} × ${d.n}（保留 uid=${d.keep_uid}，金額 ${d.total}）`));

    if (!APPLY) {
        console.log('\n（預演結束，加 --apply 執行）');
        process.exit(0);
    }

    const conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
        // 先去重（此時僅針對缺月單據，避免誤刪正常資料），再補月
        const [u2] = await conn.execute(
            `DELETE r2 FROM mgm_invoice_details r2
              JOIN mgm_invoice_details r1
                ON r1.bu_no = r2.bu_no AND r1.TX_type = r2.TX_type
               AND r1.invoice_no = r2.invoice_no AND r1.wk_date = r2.wk_date
               AND r1.sub_amt = r2.sub_amt AND r1.VAT_amt = r2.VAT_amt
               AND r1.uid < r2.uid
             WHERE (r2.YYYY_MM IS NULL OR TRIM(r2.YYYY_MM)='')`
        );
        const [u1] = await conn.execute(
            `UPDATE mgm_invoice_details
                SET YYYY_MM = DATE_FORMAT(wk_date, '%Y-%m'), update_time = NOW()
              WHERE (YYYY_MM IS NULL OR TRIM(YYYY_MM)='') AND wk_date IS NOT NULL`
        );
        await conn.commit();
        console.log(`\n✅ 刪除重複 ${u2.affectedRows} 筆，補月 ${u1.affectedRows} 筆`);
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }

    const [chk] = await pool.query(
        `SELECT SUM(YYYY_MM IS NULL OR TRIM(YYYY_MM)='') AS still_empty, COUNT(*) total FROM mgm_invoice_details`
    );
    const [m12] = await pool.query(
        `SELECT TX_type, COUNT(*) n, SUM(sub_amt) amt FROM mgm_invoice_details
          WHERE YYYY_MM='2024-12' GROUP BY TX_type`
    );
    console.log(`驗證：仍缺月 ${chk[0].still_empty} / ${chk[0].total} 筆`);
    m12.forEach(r => console.log(`  2024-12 ${r.TX_type}: ${r.n} 筆，金額 ${Number(r.amt).toLocaleString()}`));
    process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
