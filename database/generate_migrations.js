/**
 * generate_migrations.js
 * 自動從 MySQL 讀取所有表的 CREATE TABLE，生成 migration 套件
 * 
 * 用法: node generate_migrations.js [--no-run]
 *   --no-run: 只生成檔案，不自動執行
 * 
 * 輸出: migrations/001_*.sql ~ migrations/005_*.sql + rollback + run_all.sql + README
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DB = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || 'ld68315711',
  database: process.env.DB_NAME || 'ERMM_db',
};

// ── Migration 分組（所有表名小寫，符合 Windows lower_case_table_names=1） ──
const GROUPS = [
  {
    version: '001',
    name: 'po_so_tables',
    title: 'ERP PO/SO 原始單據表',
    desc: '三張表: ermm_temp_po, ermm_erp_po, ermm_erp_so',
    tables: ['ermm_temp_po', 'ermm_erp_po', 'ermm_erp_so'],
    skipIfExists: true,
  },
  {
    version: '002',
    name: 'finance_core_tables',
    title: '財務核心 8 表',
    desc: '批次管線 Step7 的目標表 + 日常 CRUD 頁面全部讀這幾張',
    tables: [
      'mgm_finance_summary',     // 財務摘要主表（200+ 欄位，三大報表來源）
      'mgm_casher_details',      // 現金日記帳
      'mgm_invoice_details',     // 發票明細表（AR/AP 發票）
      'ermm_arap_detail',        // 應收應付彙總表
      'pay_detail',              // 付款明細表
      'check_detail',            // 票據明細表
      'mgm_bank_loan_details',   // 銀行貸款明細表
      'forecast_detail',         // 財務預測明細表
    ],
  },
  {
    version: '003',
    name: 'erp_master_tables',
    title: 'ERP 主數據 8 表',
    desc: '批次管線 Step1~Step5 的資料源 + 參數配置',
    tables: [
      'cams_system_codes',            // 系統碼表（匯率 / 減值率 / 狀態）
      'e2_xitems_daily_status',       // 每日庫存狀態（Step5 減值計算來源）
      'e2_xitems_daily_status_chart', // 庫存彙總
      'ermm_erp_documents',          // 文件管理表
      'ermm_erp_so_dn',              // SO 交貨單
      'mgm_account_details',         // 帳戶明細表
      'monthly_items',               // 月度項目表
      'relation_detail',             // 往來對象表
    ],
  },
  {
    version: '004',
    name: 'system_tables',
    title: '系統配置 6 表',
    desc: '使用者 / 權限 / 批次控制 / KPI 門檻',
    tables: [
      'branch_detail',          // 分公司表
      'cams_batch_control',     // 批次控制表
      'cams_xuser',             // 使用者帳號表
      'leader_user',            // 使用者權限表
      'login_user_record',      // 登入紀錄表
      'mgm_kpi_desc',           // KPI 門檻定義表
    ],
  },
  {
    version: '005',
    name: 'erp_detail_tables',
    title: 'ERP 明細 3 表',
    desc: '交易明細 / 生產明細 / 在途價格（擴展用）',
    tables: [
      'bh_mgm_tx_detail',       // 交易明細表
      'mgm_production_details', // 生產明細表
      'transit_price',          // 在途價格表
    ],
  },
];

async function main() {
  const conn = await mysql.createConnection(DB);
  console.log(`✅ 已連線 ${DB.host}/${DB.database}`);

  // 拿所有表的 CREATE TABLE（全小寫比較）
  const [allTables] = await conn.query(
    `SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME != 'schema_migrations'
     ORDER BY TABLE_NAME`,
    [DB.database]
  );

  const tableSet = new Set(allTables.map((r) => r.TABLE_NAME.toLowerCase()));
  const allCreates = {};
  for (const t of allTables) {
    const [rows] = await conn.query(`SHOW CREATE TABLE \`${t.TABLE_NAME}\``);
    // 把表名也強制小寫（lower_case_table_names=1）
    const raw = rows[0]['Create Table'];
    const normalized = raw.replace(/CREATE TABLE `([^`]+)`/i, (m, name) =>
      `CREATE TABLE IF NOT EXISTS \`${name.toLowerCase()}\``
    );
    allCreates[t.TABLE_NAME.toLowerCase()] = normalized;
  }
  console.log(`📋 讀取 ${Object.keys(allCreates).length} 張表的 CREATE TABLE`);

  const outDir = path.join(__dirname, '..', 'migrations');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // ── 生成每個 migration ──
  const summary = [];
  for (const g of GROUPS) {
    if (g.skipIfExists) {
      const f = path.join(outDir, `${g.version}_${g.name}.sql`);
      if (fs.existsSync(f)) {
        console.log(`⏭️  ${g.version} ${g.name} — 已存在，跳過`);
        summary.push({ ...g, tables: g.tables.filter((t) => tableSet.has(t)), created: false });
        continue;
      }
    }

    const presentTables = g.tables.filter((t) => allCreates[t]);
    const missing = g.tables.filter((t) => !allCreates[t]);
    if (presentTables.length === 0) {
      console.log(`⚠️  ${g.version} ${g.name} — 所有表都不存在，跳過`);
      continue;
    }
    if (missing.length > 0) {
      console.log(`  ⚠️  以下表不在 DB 中: ${missing.join(', ')}`);
    }

    const { upSql, downSql } = buildMigration(g, presentTables, allCreates);
    const upPath = path.join(outDir, `${g.version}_${g.name}.sql`);
    const downPath = path.join(outDir, `${g.version}_${g.name}_rollback.sql`);
    fs.writeFileSync(upPath, upSql, 'utf8');
    fs.writeFileSync(downPath, downSql, 'utf8');

    const upSize = (fs.statSync(upPath).size / 1024).toFixed(1);
    console.log(`✅ ${g.version}_${g.name}.sql (${upSize} KB, ${presentTables.length} 表)`);
    summary.push({ ...g, tables: presentTables, created: true });
  }

  fs.writeFileSync(path.join(outDir, 'run_all.sql'), buildRunAll(summary), 'utf8');
  fs.writeFileSync(path.join(outDir, 'README.md'), buildReadme(summary), 'utf8');
  console.log(`✅ run_all.sql + README.md 已生成`);

  // ── 自動執行（用 mysql binary） ──
  if (process.argv.includes('--no-run')) {
    console.log(`\n⏸️  --no-run 指定，跳過自動執行`);
  } else {
    console.log(`\n🚀 開始執行 migration...\n`);
    for (const s of summary) {
      if (!s.created) continue;
      const upPath = path.join(outDir, `${s.version}_${s.name}.sql`);
      try {
        const cmd = `"C:\\Program Files\\MySQL\\MySQL Server 8.3\\bin\\mysql.exe" -h${DB.host} -u${DB.user} -p${DB.password} ${DB.database} < "${upPath}"`;
        execSync(cmd, { stdio: 'pipe' });
        console.log(`  ✅ ${s.version}_${s.name} — 執行成功 (${s.tables.length} 表)`);
      } catch (e) {
        const msg = (e.stderr || e.message).toString().split('\n').slice(0, 3).join(' | ');
        console.log(`  ❌ ${s.version}_${s.name} — ${msg}`);
      }
    }

    console.log(`\n📊 最終版本記錄:`);
    const [vers] = await conn.query(`SELECT version, description, applied_at FROM schema_migrations ORDER BY version`);
    vers.forEach((v) => console.log(`   ${v.version.padEnd(30)} ${v.description.padEnd(30)} ${v.applied_at}`));
  }

  await conn.end();
  console.log(`\n🎉 Migration 套件生成完成！`);
  console.log(`   目錄: ${outDir}`);
  console.log(`   表數: ${summary.reduce((a, s) => a + (s.tables?.length || 0), 0)} 張`);
}

// ───────────────────────────────────────────────────────────────
function buildMigration(group, presentTables, creates) {
  const tableBlocks = presentTables.map((t) => creates[t] + ';').join('\n\n');
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const header = `-- =====================================================================
-- Migration: ${group.version} ${group.title}
-- 檔案:     ${group.version}_${group.name}.sql
-- 日期:     ${now}
-- 資料庫:   MySQL 8.x / ${DB.database}
-- 表數:     ${presentTables.length} 張
-- 目的:     ${group.desc}
--
-- 使用方式:
--   mysql -h${DB.host} -u${DB.user} -p${DB.database} < ${group.version}_${group.name}.sql
--
-- 回滾:
--   mysql -h${DB.host} -u${DB.user} -p${DB.database} < ${group.version}_${group.name}_rollback.sql
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 版本追蹤
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(50) PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    description VARCHAR(200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

  const versionMark = `
-- 記錄版本
INSERT IGNORE INTO schema_migrations (version, description) VALUES
${presentTables.map((t) => `('${group.version}_${t}', '${group.title} — ${t}')`).join(',\n')};
`;

  const footer = `
SET FOREIGN_KEY_CHECKS = 1;

-- 驗證
SELECT '=== Migration ${group.version} 驗證 ===' AS step;
SELECT TABLE_NAME, TABLE_COMMENT, ENGINE
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA='${DB.database}'
   AND TABLE_NAME IN (${presentTables.map((t) => `'${t}'`).join(', ')})
 ORDER BY TABLE_NAME;
`;

  const upSql = header + '\n' + tableBlocks + '\n' + versionMark + footer;

  // Rollback
  const dropBlocks = presentTables.map((t) => `DROP TABLE IF EXISTS \`${t}\`;`).join('\n');
  const downSql = `-- =====================================================================
-- Rollback: ${group.version} ${group.title}
-- ⚠️ 危險！會 DROP ${presentTables.length} 張表的所有資料！
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

${dropBlocks}

DELETE FROM schema_migrations WHERE version LIKE '${group.version}_%';

SET FOREIGN_KEY_CHECKS = 1;
SELECT 'Rollback ${group.version} completed.' AS status;
`;

  return { upSql, downSql };
}

function buildRunAll(summary) {
  const bodies = summary
    .filter((s) => s.tables && s.tables.length > 0 && s.created !== false)
    .map(
      (s) =>
        `-- ▶ ${s.version} ${s.title} (${s.tables.length} 表)\nSOURCE ${s.version}_${s.name}.sql;`
    )
    .join('\n\n');
  return `SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\nCREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(50) PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP, description VARCHAR(200)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n\n${bodies}\n\nSET FOREIGN_KEY_CHECKS = 1;\nSELECT * FROM schema_migrations ORDER BY version;\n`;
}

function buildReadme(summary) {
  const table = summary
    .filter((s) => s.tables && s.tables.length > 0)
    .map(
      (s) =>
        `| ${s.version} | [${s.version}_${s.name}.sql](./${s.version}_${s.name}.sql) | ${s.tables.length} | ${s.title} |`
    )
    .join('\n');
  const allTables = summary
    .filter((s) => s.tables && s.tables.length > 0)
    .flatMap((s) => s.tables.map((t) => `- \`${s.version}_${t}\` → \`${t}\``))
    .join('\n');
  return `# Migrations

資料庫版本管理（MySQL 8.x / ${DB.database}）。

## 執行順序

| Version | 檔案 | 表數 | 說明 |
|---------|------|------|------|
${table}

## 快速執行

\`\`\`bash
# 全部（一次跑完所有 migration）
mysql -h${DB.host} -u${DB.user} -p ${DB.database} < run_all.sql

# 單獨某一組
mysql -h${DB.host} -u${DB.user} -p ${DB.database} < 002_finance_core_tables.sql

# 回滾（⚠️ 危險！會 DROP 所有表資料！）
mysql -h${DB.host} -u${DB.user} -p ${DB.database} < 002_finance_core_tables_rollback.sql

# 查版本
mysql -h${DB.host} -u${DB.user} -p ${DB.database} -e "SELECT * FROM schema_migrations ORDER BY version;"
\`\`\`

## Migration 版本命名規則

每張表一個 version（確保單表回滾粒度）：

${allTables}

## 重複執行安全

所有 migration 使用 \`CREATE TABLE IF NOT EXISTS\` + \`INSERT IGNORE INTO schema_migrations\`，
可安全重複執行。若表已存在，會自動跳過。

## 生成腳本

\`\`\`bash
# 重新從 DB 讀取 CREATE TABLE 生成 migration 套件
node database/generate_migrations.js       # 生成 + 自動執行
node database/generate_migrations.js --no-run  # 只生成檔案
\`\`\`
`;
}

main().catch((e) => {
  console.error('❌ 失敗:', e.message);
  process.exit(1);
});
