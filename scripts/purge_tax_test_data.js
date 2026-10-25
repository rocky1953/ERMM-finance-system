/**
 * 清空報稅模組測試資料（僅用於 migration 006 剛建立、尚未上線的階段）
 * 使用方式：node scripts/purge_tax_test_data.js
 */
require('dotenv').config();
const { pool } = require('../config/db');

(async () => {
    await pool.execute('SET FOREIGN_KEY_CHECKS=0');
    for (const t of ['iit_withholding_details', 'iit_withholding_batches',
                     'vat_declarations', 'cit_annual_settlements', 'tax_submit_receipts']) {
        const [r] = await pool.execute(`DELETE FROM ${t}`);
        console.log(`  ${t}: 清除 ${r.affectedRows} 筆`);
    }
    // bonus 相關（migration 009 新增）
    const [bd] = await pool.execute('DELETE FROM bonus_details');
    console.log(`  bonus_details: 清除 ${bd.affectedRows} 筆`);
    await pool.execute('SET FOREIGN_KEY_CHECKS=1');
    process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
