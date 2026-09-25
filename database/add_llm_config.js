/**
 * LLM API Key 管理資料表遷移腳本
 * 建立 llm_config 表，並種入 Kimi(Moonshot) / DeepSeek 兩個 OpenAI 相容服務商
 * 執行：node database/add_llm_config.js
 */
const { pool } = require('../config/db');

async function run() {
    try {
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS llm_config (
                uid INT AUTO_INCREMENT PRIMARY KEY,
                provider VARCHAR(32) NOT NULL,
                provider_name VARCHAR(64) NOT NULL,
                api_key VARCHAR(255) DEFAULT '',
                base_url VARCHAR(255) NOT NULL,
                model VARCHAR(64) NOT NULL,
                status VARCHAR(10) DEFAULT 'NOUSE' COMMENT 'USE/NOUSE',
                updated_by VARCHAR(50),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_provider (provider)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        console.log('✅ llm_config 表已建立');

        const seeds = [
            ['kimi', 'Kimi (Moonshot)', '', 'https://api.moonshot.cn/v1', 'kimi-k2.6'],
            ['deepseek', 'DeepSeek', '', 'https://api.deepseek.com/v1', 'deepseek-chat']
        ];
        for (const [provider, name, key, base, model] of seeds) {
            await pool.execute(
                `INSERT IGNORE INTO llm_config (provider, provider_name, api_key, base_url, model, status)
                 VALUES (?, ?, ?, ?, ?, 'NOUSE')`,
                [provider, name, key, base, model]
            );
            console.log(`✅ 已種入服務商：${provider} (${name})`);
        }

        // 舊版 moonshot-v1-* 已於 2026-08-31 停用，沿用舊模型名的記錄一併升級
        const [upd] = await pool.execute(
            "UPDATE llm_config SET model='kimi-k2.6' WHERE provider='kimi' AND model LIKE 'moonshot-v1%'"
        );
        if (upd.affectedRows > 0) console.log(`✅ 已將 ${upd.affectedRows} 筆舊版 moonshot-v1 模型升級為 kimi-k2.6`);

        const [rows] = await pool.query('SELECT provider, provider_name, base_url, model, status FROM llm_config ORDER BY uid');
        console.log('\n目前 llm_config 內容：');
        console.table(rows);
    } catch (e) {
        console.error('❌ 遷移失敗：', e.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

run();
