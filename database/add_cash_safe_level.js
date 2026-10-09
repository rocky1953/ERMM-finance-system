/**
 * 現金安全水位設定表 — 冪等遷移
 *   mgm_cash_safe_level (bu_no PK)：每個 BU 一筆安全水位金額（單位：元）
 *   用於「現金流量預測」13 週水位曲線的安全水位線與低水位警示。
 *
 * 執行：node database/add_cash_safe_level.js
 */
const { pool } = require('../config/db');

async function run() {
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS mgm_cash_safe_level (
            bu_no VARCHAR(10) NOT NULL,
            safe_amount DECIMAL(18,2) NOT NULL DEFAULT 3000000 COMMENT '安全水位金額（元）',
            set_by VARCHAR(50) DEFAULT NULL,
            set_by_name VARCHAR(100) DEFAULT '',
            set_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            remark VARCHAR(500) DEFAULT NULL,
            PRIMARY KEY (bu_no)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='現金安全水位設定'
    `);
    console.log('✅ mgm_cash_safe_level 已就緒');
    await pool.end();
}

run().catch(e => { console.error('❌ 失敗：', e.message); process.exit(1); });
