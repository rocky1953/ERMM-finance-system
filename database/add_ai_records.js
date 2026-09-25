/**
 * AI 對談記錄資料表遷移腳本
 * 記錄每次「通過 LLM」的問答（問題 + 回答 + 使用模型）
 * 執行：node database/add_ai_records.js
 */
const { pool } = require('../config/db');

async function run() {
    try {
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS ermm_ai_records (
                uid INT AUTO_INCREMENT PRIMARY KEY,
                bu_no VARCHAR(10) NOT NULL COMMENT '公司別',
                xuser_id VARCHAR(50) NOT NULL COMMENT '提問者帳號',
                xuser_name VARCHAR(100) DEFAULT '' COMMENT '提問者姓名',
                ai_records JSON NOT NULL COMMENT '{"question":"問題","answer":"回答"}',
                remark VARCHAR(255) DEFAULT '' COMMENT '模型/資料期間等備註',
                created_time DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '建立時間',
                INDEX idx_bu_time (bu_no, created_time),
                INDEX idx_user_time (xuser_id, created_time)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI 財務問答對談記錄';
        `);
        console.log('✅ ermm_ai_records 表已建立');

        const [cols] = await pool.query('SHOW COLUMNS FROM ermm_ai_records');
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
