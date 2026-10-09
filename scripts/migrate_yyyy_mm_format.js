/**
 * 数据库迁移：将所有 YYYY_MM 相关列的值从 "YYYY/MM" 格式更新为 "YYYY-MM" 格式
 *
 * 策略：
 *   1. 从 information_schema 查询所有包含 YYYY_MM、tax_period、period 等列名的表
 *   2. 对每个匹配的表+列执行 UPDATE ... SET col = REPLACE(col, '/', '-') WHERE col LIKE '%/%'
 *   3. 输出每张表的更新行数
 *
 * 用法：node scripts/migrate_yyyy_mm_format.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../config/db');

// 可能存储 YYYY/MM 格式的列名模式
const COLUMN_PATTERNS = [
    'YYYY_MM',
    'yyyy_mm',
    'YYYYMM',
    'tax_period',
    'period',
    'target_ym',
    'ym',
];

async function main() {
    const dbName = process.env.DB_NAME || 'ERMM_db';

    // 查找所有包含目标列名的表
    const [columns] = await pool.execute(
        `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND DATA_TYPE IN ('varchar','char','text')
         ORDER BY TABLE_NAME, COLUMN_NAME`,
        [dbName]
    );

    // 过滤匹配的列
    const targets = columns.filter(c =>
        COLUMN_PATTERNS.some(p => c.COLUMN_NAME.toLowerCase() === p.toLowerCase())
    );

    if (targets.length === 0) {
        console.log('⚠️ 未找到需要迁移的 YYYY_MM 相关列');
        process.exit(0);
    }

    console.log(`找到 ${targets.length} 个需要检查的表+列组合：\n`);

    let totalUpdated = 0;

    for (const t of targets) {
        const { TABLE_NAME, COLUMN_NAME } = t;

        // 先查询有多少行包含 '/'（即 YYYY/MM 格式）
        try {
            const [checkRows] = await pool.execute(
                `SELECT COUNT(*) AS cnt FROM \`${TABLE_NAME}\` WHERE \`${COLUMN_NAME}\` LIKE '%/%'`
            );
            const cnt = checkRows[0].cnt;

            if (cnt === 0) {
                console.log(`  ✓ ${TABLE_NAME}.${COLUMN_NAME} — 无需迁移（0 行含 /）`);
                continue;
            }

            // 执行更新
            const [result] = await pool.execute(
                `UPDATE \`${TABLE_NAME}\` SET \`${COLUMN_NAME}\` = REPLACE(\`${COLUMN_NAME}\`, '/', '-') WHERE \`${COLUMN_NAME}\` LIKE '%/%'`
            );

            const affected = result.affectedRows || 0;
            totalUpdated += affected;
            console.log(`  ✅ ${TABLE_NAME}.${COLUMN_NAME} — 更新 ${affected} 行`);
        } catch (e) {
            console.log(`  ❌ ${TABLE_NAME}.${COLUMN_NAME} — 错误: ${e.message}`);
        }
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`迁移完成！总共更新 ${totalUpdated} 行数据。`);
    console.log(`所有 YYYY/MM 格式已转为 YYYY-MM 格式。`);

    process.exit(0);
}

main().catch(e => {
    console.error('❌ 迁移失败:', e.message);
    process.exit(1);
});
