/**
 * 財務情景模擬「已保存方案」資料表遷移腳本
 * 記錄使用者儲存的三情景參數組合與計算結果，供經營會議對比/回溯
 * 執行：node database/add_scenario_saved.js
 */
const { pool } = require('../config/db');

async function run() {
    try {
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS ermm_scenario_saved (
                uid INT AUTO_INCREMENT PRIMARY KEY,
                bu_no VARCHAR(10) NOT NULL COMMENT '公司別',
                YYYY_MM VARCHAR(7) NOT NULL COMMENT '資料期間 YYYY-MM',
                scenario_name VARCHAR(100) NOT NULL COMMENT '方案名稱',
                params_json JSON NOT NULL COMMENT '三情景參數 {optimistic,base,pessimistic}',
                result_json JSON DEFAULT NULL COMMENT '模擬計算結果',
                created_by VARCHAR(50) DEFAULT '' COMMENT '建立者帳號',
                created_by_name VARCHAR(100) DEFAULT '' COMMENT '建立者姓名',
                created_time DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '建立時間',
                INDEX idx_bu_month (bu_no, YYYY_MM),
                INDEX idx_created_by (created_by)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='財務情景模擬已保存方案';
        `);
        console.log('✅ ermm_scenario_saved 表已建立');

        const [cols] = await pool.query('SHOW COLUMNS FROM ermm_scenario_saved');
        console.log('\n欄位結構：');
        console.table(cols.map(c => ({ Field: c.Field, Type: c.Type, Null: c.Null, Default: c.Default })));
    } catch (e) {
        console.error('❌ 遷移失敗：', e.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

run();
