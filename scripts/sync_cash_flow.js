/**
 * 回填 mgm_finance_summary 现金流量字段
 * 数据来源：mgm_casher_details（现金日记账）
 * 用法：node scripts/sync_cash_flow.js
 */
require('dotenv').config();
const { pool } = require('../config/db');
const { syncCashFlow } = require('../services/cashFlow');

async function main() {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [bus] = await conn.execute(
            "SELECT DISTINCT bu_no FROM mgm_finance_summary WHERE bu_no IN ('HM','HN','SZ') ORDER BY bu_no"
        );
        let total = 0;
        for (const r of bus) {
            const res = await syncCashFlow(conn, r.bu_no);
            total += res.updated;
            console.log(`✓ ${r.bu_no}: 更新 ${res.updated} 个月${res.skipped.length ? `，方向异常跳过 ${res.skipped.length} 条` : ''}`);
            if (res.skipped.length) console.log(`  跳过示例: ${res.skipped.slice(0, 5).join('; ')}`);
        }
        await conn.commit();
        console.log(`✓ 完成，共更新 ${total} 个月`);
    } catch (e) {
        await conn.rollback();
        console.error('❌', e.message);
        process.exitCode = 1;
    } finally {
        conn.release();
        await pool.end();
    }
}

main();
