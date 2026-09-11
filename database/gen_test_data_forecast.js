/**
 * 財務預測 forecast_detail 逐筆明細測試資料產生器
 * 產生 30 筆，涵蓋 銷售(Sales) / 成本(Cost) / 現金流量(Cash Flow) 三類預測
 *
 * 用法：node database/gen_test_data_forecast.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const BU_NO = ['HM', 'HN', 'SZ'];
const FC_TYPES = ['Sales', 'Cost', 'Cash Flow'];
const YEAR = 2025;

const rand = (n) => Math.floor(Math.random() * n);
const pad = (n, len = 2) => String(n).padStart(len, '0');
const pick = (arr) => arr[rand(arr.length)];

async function main() {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'ERMM_db',
        charset: 'utf8mb4',
        dateStrings: true,
    });

    // 基底金額（依類型與公司）
    const baseAmt = {
        'HM': { 'Sales': 15000000, 'Cost': 9000000, 'Cash Flow': 5000000 },
        'HN': { 'Sales': 8000000, 'Cost': 4500000, 'Cash Flow': 2000000 },
        'SZ': { 'Sales': 12000000, 'Cost': 7000000, 'Cash Flow': 3500000 },
    };

    const rows = [];
    for (let i = 0; i < 30; i++) {
        const bu = pick(BU_NO);
        const type = pick(FC_TYPES);
        const month = 1 + rand(12);
        const ym = `${YEAR}/${pad(month)}`;
        // 預測金額：基底 ± 20% 浮動
        const base = baseAmt[bu][type];
        const fcAmt = Math.round(base * (0.8 + Math.random() * 0.4));
        // 差異金額：預測與實際的差（正負皆可，約 ±10%）
        const diffAmt = Math.round(fcAmt * (Math.random() * 0.2 - 0.1));
        rows.push([bu, ym, type, fcAmt, diffAmt]);
    }

    const [r] = await conn.query(
        `INSERT INTO forecast_detail (bu_no, YYYY_MM, forecast_type, forecast_amt, diff_amt)
         VALUES ?
         ON DUPLICATE KEY UPDATE forecast_amt=VALUES(forecast_amt), diff_amt=VALUES(diff_amt)`,
        [rows]
    );

    await conn.end();

    console.log('✅ 財務預測逐筆明細測試資料產生完成：');
    console.log('='.repeat(50));
    console.log(`   插入/更新筆數: ${r.affectedRows}`);
    console.log(`   年份: ${YEAR}`);
    console.log(`   公司別: ${BU_NO.join(' / ')}`);
    console.log(`   預測類型: ${FC_TYPES.join(' / ')}`);
    console.log('='.repeat(50));
    console.log('');
    console.log('💡 到「財務預測」頁面，切換「逐筆明細」頁籤即可查看');
}

main().catch(err => {
    console.error('❌ 產生失敗:', err.message);
    process.exit(1);
});
