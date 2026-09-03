/**
 * 資料庫連線池 (MySQL2/Promise)
 * ERMM 財務模組
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ERMM_db',
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0,
    charset: 'utf8mb4',
    multipleStatements: true,
    dateStrings: true
});

// 測試連線
async function testConnection() {
    try {
        const conn = await pool.getConnection();
        const [rows] = await conn.execute('SELECT 1 AS test');
        conn.release();
        console.log('✅ 資料庫連線成功:', rows[0]);
        return true;
    } catch (err) {
        console.error('❌ 資料庫連線失敗:', err.message);
        return false;
    }
}

module.exports = { pool, testConnection };
