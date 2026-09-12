/**
 * 清理舊的中文 forecast_type 殘留 + 正式驗證
 * 用法：node database/clean_verify_forecast.js
 */
const { pool } = require('../config/db');

async function main() {
    console.log('🧹 清理舊殘留 forecast_type...');
    const [del] = await pool.execute(
        "DELETE FROM forecast_detail WHERE forecast_type IN ('採購','現金','銷售','成本','現金流')"
    );
    console.log(`   已刪除 ${del.affectedRows} 筆舊中文殘留資料`);

    // 驗證分組統計
    const [group] = await pool.execute(
        `SELECT bu_no, forecast_type, COUNT(*) as cnt,
                SUM(forecast_amt) as total_fc
         FROM forecast_detail 
         WHERE bu_no IN ('HM','SZ','HN')
         GROUP BY bu_no, forecast_type
         ORDER BY bu_no, forecast_type`
    );

    console.log('\n📈 驗證結果 (每組應 24 筆 = 2年×12月):');
    console.table(group.map(r => ({
        公司: r.bu_no, 類型: r.forecast_type,
        筆數: r.cnt, 狀態: r.cnt === 24 ? '✅' : '❌'
    })));

    const total = group.reduce((s, r) => s + r.cnt, 0);
    console.log(`\n🎯 總筆數: ${total} / 216`);

    // 零值檢查
    const [zero] = await pool.execute(
        `SELECT COUNT(*) as z FROM forecast_detail 
         WHERE bu_no IN ('HM','SZ','HN') AND forecast_amt = 0`
    );
    console.log(`⚠️  forecast_amt = 0: ${zero[0].z} 筆`);

    // 無 forecast_type = 中文
    const [cn] = await pool.execute(
        `SELECT COUNT(*) as c FROM forecast_detail 
         WHERE forecast_type NOT IN ('Sales','Cost','Cash Flow')`
    );
    console.log(`🗑  非英文 forecast_type 殘留: ${cn[0].c} 筆`);

    // API compare 邏輯驗證（直接查 SQL）
    console.log('\n🔍 compare 查詢測試 (SZ, 2025, Sales):');
    const [fc] = await pool.execute(
        `SELECT COUNT(*) as c, SUM(forecast_amt) as total
         FROM forecast_detail WHERE bu_no='SZ' AND forecast_type='Sales' AND YYYY_MM LIKE '2025/%'`
    );
    console.log(`   命中 forecast_type='Sales': ${fc[0].c} 筆, 總額 ${Number(fc[0].total).toLocaleString()}`);

    process.exit(0);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
