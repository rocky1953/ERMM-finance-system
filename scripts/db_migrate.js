#!/usr/bin/env node
/**
 * 数据库迁移执行器（台账制 + 实物校验）
 *
 * 作用：比对 migrations/ 目录与 schema_migration_files 台账，只执行「尚未执行过」的迁移档。
 *       历史迁移不会盲目标记为已执行，而是检查它引用的资料表是否真的存在；
 *       缺表则自动退回重跑，避免「台账说有、数据库其实没有」。
 *
 * 用法：
 *   node scripts/db_migrate.js                   执行未执行过的迁移（自动校验历史基线）
 *   node scripts/db_migrate.js --dry-run         只列出将执行哪些档，不写入数据库
 *   node scripts/db_migrate.js --baseline-through 037   强制把 001~037 视为已执行（不推荐）
 *   node scripts/db_migrate.js --help
 *
 * 规则：
 *   1) 迁移档命名 NNN_说明.sql，按编号顺序执行；*_rollback.sql 不自动执行。
 *   2) 执行成功后写入 schema_migration_files，之后不再重复执行。
 *   3) 含 DELIMITER 的档自动改用 mysql 客户端执行。
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');
const mysql = require('mysql2/promise');

const MIGRATION_DIR = path.join(__dirname, '..', 'migrations');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const argValue = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`用法: node scripts/db_migrate.js [--dry-run] [--baseline-through NNN]

  --dry-run               只列出将执行的迁移档，不写入数据库
  --baseline-through NNN  强制把 001~NNN 视为已执行（仅特殊场景使用）
  --help                  显示帮助`);
  process.exit(0);
}

const FORCE_BASELINE = argValue('--baseline-through');

const DB = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'ERMM_db'
};

const sha1 = (file) => crypto.createHash('sha1')
  .update(fs.readFileSync(path.join(MIGRATION_DIR, file)))
  .digest('hex');

function listMigrations() {
  return fs.readdirSync(MIGRATION_DIR)
    .filter((f) => /^\d{3}_.+\.sql$/i.test(f) && !/_rollback\.sql$/i.test(f))
    .sort((a, b) => a.localeCompare(b));
}

/** 去掉 SQL 注释，避免把注释里的表名当成依赖 */
function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/#[^\n]*/g, ' ');
}

const TABLE_PATTERNS = [
  /\bCREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+`?([A-Za-z0-9_]+)`?/gi,
  /\bALTER\s+TABLE\s+`?([A-Za-z0-9_]+)`?/gi,
  /\b(?:INSERT|REPLACE)\s+(?:IGNORE\s+)?INTO\s+`?([A-Za-z0-9_]+)`?/gi,
  /\bDELETE\s+FROM\s+`?([A-Za-z0-9_]+)`?/gi,
  /\bUPDATE\s+`?([A-Za-z0-9_]+)`?\s+SET\b/gi,
  /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+`?[A-Za-z0-9_]+`?\s+ON\s+`?([A-Za-z0-9_]+)`?/gi
];

/** 解析迁移档引用到的资料表（自动排除系统台账表） */
function tableRefs(file) {
  const sql = stripComments(fs.readFileSync(path.join(MIGRATION_DIR, file), 'utf8'));
  const refs = new Set();
  for (const re of TABLE_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(sql)) !== null) {
      const name = m[1];
      if (name && !name.startsWith('schema_migration')) refs.add(name);
    }
  }
  return refs;
}

async function loadTables(conn) {
  const [rows] = await conn.query(
    `SELECT TABLE_NAME AS t FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()`);
  return new Set(rows.map((r) => r.t));
}

async function tableExists(conn, name) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [name]);
  return Number(rows[0].c) > 0;
}

function resolveMysqlClient() {
  const candidates = [];
  if (process.env.MYSQL_BIN) {
    candidates.push(process.env.MYSQL_BIN);
    candidates.push(path.join(process.env.MYSQL_BIN, process.platform === 'win32' ? 'mysql.exe' : 'mysql'));
  }
  candidates.push(process.platform === 'win32' ? 'mysql.exe' : 'mysql');
  for (const c of candidates) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore' });
      return c;
    } catch (_) { /* 继续尝试 */ }
  }
  return null;
}

/** 含 DELIMITER 的档无法用 mysql2 执行，改用 mysql 客户端 */
function runViaMysqlCli(sql, file) {
  const bin = resolveMysqlClient();
  if (!bin) throw new Error('该档含 DELIMITER，需要 mysql 客户端，但未找到 mysql 命令');
  const res = spawnSync(bin, [
    '-h', DB.host, '-P', String(DB.port), '-u', DB.user,
    '--default-character-set=utf8mb4', DB.database
  ], {
    input: sql,
    encoding: 'utf8',
    env: { ...process.env, MYSQL_PWD: DB.password }
  });
  if (res.status !== 0) {
    throw new Error((res.stderr || res.stdout || '').trim() || `mysql 退出码 ${res.status}`);
  }
}

(async () => {
  const files = listMigrations();
  if (!files.length) {
    console.error(`✘ ${MIGRATION_DIR} 下没有迁移档`);
    process.exit(1);
  }

  const conn = await mysql.createConnection({ ...DB, multipleStatements: true });

  try {
    console.log(`数据库: ${DB.user}@${DB.host}:${DB.port}/${DB.database}`);
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

    let tables = await loadTables(conn);
    const applied = new Map();
    if (DRY_RUN && !(await tableExists(conn, 'schema_migration_files'))) {
      console.log('ℹ 台账表尚未建立（dry-run 不建表），按空台账比对');
    } else {
      const [rows] = await conn.query(
        'SELECT file_name, checksum, source FROM schema_migration_files');
      rows.forEach((r) => applied.set(r.file_name, { checksum: r.checksum, source: r.source }));
    }

    // ① 校验历史基线：台账写「已执行」，但引用的资料表不存在 → 实际上没跑过，退回重跑
    let dropped = 0;
    for (const f of files) {
      const row = applied.get(f);
      if (!row || row.source !== 'baseline') continue;
      const missing = [...tableRefs(f)].filter((t) => !tables.has(t));
      if (!missing.length) continue;
      console.log(`↺ ${f} 基线校验失败（缺少表 ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ' ...' : ''}），将重新执行`);
      if (!DRY_RUN) await conn.query('DELETE FROM schema_migration_files WHERE file_name = ?', [f]);
      applied.delete(f);
      dropped++;
    }
    if (dropped) console.log(`ℹ 已撤销 ${dropped} 个错误基线`);

    // ② 空台账首次运行：只把「引用的表都真实存在」的历史档登记为基线
    if (applied.size === 0) {
      const legacyCount = (await tableExists(conn, 'schema_migrations'))
        ? Number((await conn.query('SELECT COUNT(*) AS c FROM schema_migrations'))[0][0].c)
        : 0;
      if (!legacyCount) {
        console.error('✘ 数据库尚未初始化（找不到 schema_migrations 记录）。');
        console.error('  新库请先执行 migrations/run_all.sql 与 database/add_*.js，或还原数据库备份后重试。');
        process.exit(1);
      }

      let baselineCount = 0;
      for (const f of files) {
        const num = Number(f.slice(0, 3));
        const refs = tableRefs(f);
        let okToBaseline;
        if (FORCE_BASELINE) {
          okToBaseline = num <= Number(String(FORCE_BASELINE).padStart(3, '0'));
        } else {
          okToBaseline = refs.size === 0 || [...refs].every((t) => tables.has(t));
        }
        if (!okToBaseline) continue;

        if (!DRY_RUN) {
          await conn.query(
            'INSERT IGNORE INTO schema_migration_files (file_name, checksum, source) VALUES (?, ?, ?)',
            [f, sha1(f), 'baseline']);
        }
        applied.set(f, { checksum: sha1(f), source: 'baseline' });
        baselineCount++;
      }
      console.log(`ℹ 首次运行：登记 ${baselineCount} 个历史迁移为已执行，其余将按顺序执行`);
    }

    // 迁移档自带 schema_migrations 版本号时，可作为「确实执行过」的佐证
    let versionPrefixes = null;
    if (await tableExists(conn, 'schema_migrations')) {
      const [versions] = await conn.query('SELECT version FROM schema_migrations');
      versionPrefixes = new Set(
        versions
          .map((r) => String(r.version).slice(0, 3))
          .filter((p) => /^\d{3}$/.test(p)));
    }

    // ③ 按编号顺序执行未执行的迁移
    let ran = 0;
    let skipped = 0;
    for (const f of files) {
      const checksum = sha1(f);
      if (applied.has(f)) {
        const old = applied.get(f).checksum;
        if (old && old !== checksum) {
          console.warn(`⚠️  ${f} 执行后内容又被修改过（校验码不一致），请改用新增迁移档而不是改旧档`);
        }
        skipped++;
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATION_DIR, f), 'utf8');
      const hasCreateTable = /\bCREATE\s+TABLE\b/i.test(stripComments(sql));

      // 无建表语句的档（纯 ALTER/INSERT）用 schema_migrations 版本号佐证是否执行过
      if (!hasCreateTable && versionPrefixes && versionPrefixes.has(f.slice(0, 3))) {
        console.log(`⏭  ${f} 已由 schema_migrations 记录，跳过`);
        if (!DRY_RUN) {
          await conn.query(
            `INSERT INTO schema_migration_files (file_name, checksum, source) VALUES (?, ?, 'run')
             ON DUPLICATE KEY UPDATE checksum = VALUES(checksum)`,
            [f, checksum]);
        }
        applied.set(f, { checksum, source: 'run' });
        skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`  [将执行] ${f}`);
        ran++;
        continue;
      }

      console.log(`▶ 执行 ${f}`);
      try {
        if (/^\s*DELIMITER\b/im.test(sql)) {
          runViaMysqlCli(sql, f);
        } else {
          await conn.query(sql);
        }
      } catch (err) {
        console.error(`\n✘ ${f} 执行失败：${err.message}`);
        console.error('  该文件未写入台账，修复后可重新执行；请先确认是否需要还原备份。');
        process.exitCode = 1;
        return;
      }
      tables = await loadTables(conn);
      await conn.query(
        `INSERT INTO schema_migration_files (file_name, checksum, source) VALUES (?, ?, 'run')
         ON DUPLICATE KEY UPDATE checksum = VALUES(checksum), applied_at = NOW()`,
        [f, checksum]);
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
