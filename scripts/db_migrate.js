#!/usr/bin/env node
/**
 * 数据库迁移执行器（台账制）
 *
 * 作用：比对 migrations/ 目录与 schema_migration_files 台账，只执行「尚未执行过」的迁移档，
 *       使 git pull 后可以安全地自动更新数据库结构。
 *
 * 用法：
 *   node scripts/db_migrate.js                   常规：首次自动建档并基线化 001~037，之后只执行新增档
 *   node scripts/db_migrate.js --dry-run         只列出将执行哪些档，不写入数据库
 *   node scripts/db_migrate.js --baseline-through 037   首次运行时指定历史基线（默认 037）
 *   node scripts/db_migrate.js --help
 *
 * 规则：
 *   1) 迁移档命名 NNN_说明.sql，按编号顺序执行；*_rollback.sql 不自动执行。
 *   2) 执行成功后写入 schema_migration_files，之后不再重复执行。
 *   3) 迁移档必须可重复执行（CREATE TABLE IF NOT EXISTS / ON DUPLICATE KEY / 动态 DDL）。
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const MIGRATION_DIR = path.join(__dirname, '..', 'migrations');
const DEFAULT_BASELINE = '037';

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const argValue = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`用法: node scripts/db_migrate.js [--dry-run] [--baseline-through NNN]

  --dry-run               只列出将执行的迁移档，不写入数据库
  --baseline-through NNN  首次运行时把 001~NNN 视为已执行（默认 ${DEFAULT_BASELINE}）
  --help                  显示帮助`);
  process.exit(0);
}

const baselineRaw = argValue('--baseline-through') || DEFAULT_BASELINE;
if (!/^\d{1,3}$/.test(baselineRaw)) {
  console.error(`✘ --baseline-through 参数无效：${baselineRaw}`);
  process.exit(1);
}
const BASELINE = baselineRaw.padStart(3, '0');

const sha1 = (file) => crypto.createHash('sha1')
  .update(fs.readFileSync(path.join(MIGRATION_DIR, file)))
  .digest('hex');

function listMigrations() {
  return fs.readdirSync(MIGRATION_DIR)
    .filter((f) => /^\d{3}_.+\.sql$/i.test(f) && !/_rollback\.sql$/i.test(f))
    .sort((a, b) => a.localeCompare(b));
}

async function tableExists(conn, name) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [name]);
  return Number(rows[0].c) > 0;
}

(async () => {
  const files = listMigrations();
  if (!files.length) {
    console.error(`✘ ${MIGRATION_DIR} 下没有迁移档`);
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ERMM_db',
    multipleStatements: true
  });

  try {
    console.log(`数据库: ${process.env.DB_USER || 'root'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 3306}/${process.env.DB_NAME || 'ERMM_db'}`);
    console.log(`迁移目录: migrations/  共 ${files.length} 个文件${DRY_RUN ? '（dry-run）' : ''}`);

    if (!DRY_RUN) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS schema_migration_files (
          file_name  VARCHAR(120) PRIMARY KEY,
          checksum   CHAR(40) DEFAULT NULL,
          source     VARCHAR(20) DEFAULT 'run' COMMENT 'run=实际执行 / baseline=历史基线',
          applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='迁移档执行台账'
      `);
    }

    let applied = new Map();
    if (DRY_RUN && !(await tableExists(conn, 'schema_migration_files'))) {
      console.log('ℹ 台账表尚未建立（dry-run 不建表），按空台账比对');
    } else {
      const [rows] = await conn.query('SELECT file_name, checksum FROM schema_migration_files');
      applied = new Map(rows.map((r) => [r.file_name, r.checksum]));
    }

    // 首次运行：把历史迁移（001~BASELINE）登记为基线，不重复执行，避免重复插入种子数据
    if (applied.size === 0) {
      const hasLegacy = await tableExists(conn, 'schema_migrations');
      const legacyCount = hasLegacy
        ? Number((await conn.query('SELECT COUNT(*) AS c FROM schema_migrations'))[0][0].c)
        : 0;

      if (!hasLegacy || legacyCount === 0) {
        console.error('✘ 数据库尚未初始化（找不到 schema_migrations 记录）。');
        console.error('  新库请先执行 migrations/run_all.sql 与 database/add_*.js，或还原数据库备份后重试。');
        process.exit(1);
      }

      const baselineFiles = files.filter((f) => Number(f.slice(0, 3)) <= Number(BASELINE));
      console.log(`ℹ 首次运行：将 001~${BASELINE} 共 ${baselineFiles.length} 个历史迁移登记为已执行（不重复执行）`);
      if (!DRY_RUN) {
        for (const f of baselineFiles) {
          await conn.query(
            'INSERT IGNORE INTO schema_migration_files (file_name, checksum, source) VALUES (?, ?, ?)',
            [f, sha1(f), 'baseline']
          );
          applied.set(f, sha1(f));
        }
      } else {
        baselineFiles.forEach((f) => applied.set(f, null));
      }
    }

    let ran = 0;
    let skipped = 0;
    for (const f of files) {
      const checksum = sha1(f);
      if (applied.has(f)) {
        const old = applied.get(f);
        if (old && old !== checksum) {
          console.warn(`⚠️  ${f} 执行后内容又被修改过（校验码不一致），请改用新增迁移档而不是改旧档`);
        }
        skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`  [将执行] ${f}`);
        ran++;
        continue;
      }

      console.log(`▶ 执行 ${f}`);
      const sql = fs.readFileSync(path.join(MIGRATION_DIR, f), 'utf8');
      try {
        await conn.query(sql);
      } catch (err) {
        console.error(`\n✘ ${f} 执行失败：${err.message}`);
        console.error('  该文件未写入台账，修复后可重新执行；请先确认是否需要还原备份。');
        process.exitCode = 1;
        return;
      }
      await conn.query(
        `INSERT INTO schema_migration_files (file_name, checksum, source) VALUES (?, ?, 'run')
         ON DUPLICATE KEY UPDATE checksum = VALUES(checksum), applied_at = NOW()`,
        [f, checksum]
      );
      ran++;
    }

    console.log(`\n${DRY_RUN ? '待执行' : '本次执行'} ${ran} 个，已执行过 ${skipped} 个`);
    if (!DRY_RUN) {
      const [rows] = await conn.query(
        `SELECT file_name, source, applied_at FROM schema_migration_files ORDER BY applied_at DESC LIMIT 5`);
      if (rows.length) {
        console.log('最近记录：');
        rows.forEach((r) => console.log(`  ${r.applied_at.toISOString?.() || r.applied_at}  ${r.file_name}  (${r.source})`));
      }
    }
    console.log('✔ 数据库结构已同步');
  } finally {
    await conn.end();
  }
})().catch((err) => {
  console.error('✘ 迁移执行失败：', err.message);
  process.exit(1);
});
