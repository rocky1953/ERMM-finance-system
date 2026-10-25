/**
 * 執行 SQL 遷移檔（支援多語句）
 *
 * 用法：
 *   node scripts/apply_migration.js migrations/007_tax_inputs.sql
 *
 * 說明：以 .env 內的 DB_* 連線，不依賴 mysql CLI 密碼輸入。
 */
require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql2/promise');

(async () => {
    const file = process.argv[2];
    if (!file) {
        console.error('用法: node scripts/apply_migration.js <sql檔路徑>');
        process.exit(1);
    }
    const sql = fs.readFileSync(file, 'utf8');
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'ERMM_db',
        multipleStatements: true
    });
    try {
        const [result] = await conn.query(sql);
        console.log('✔ 執行完成:', file);
        // 印出查詢型語句的結果（驗證 SELECT）
        const sets = Array.isArray(result) ? result.filter(r => Array.isArray(r)) : [];
        sets.forEach(set => { if (set.length) console.table(set); });
    } finally {
        await conn.end();
    }
})().catch(err => {
    console.error('✘ 執行失敗:', err.message);
    process.exit(1);
});
