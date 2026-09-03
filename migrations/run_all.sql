SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(50) PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP, description VARCHAR(200)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ▶ 001 ERP PO/SO 原始單據表 (3 表)
SOURCE 001_po_so_tables.sql;

-- ▶ 002 財務核心 8 表 (8 表)
SOURCE 002_finance_core_tables.sql;

-- ▶ 003 ERP 主數據 8 表 (8 表)
SOURCE 003_erp_master_tables.sql;

-- ▶ 004 系統配置 6 表 (6 表)
SOURCE 004_system_tables.sql;

-- ▶ 005 ERP 明細 3 表 (3 表)
SOURCE 005_erp_detail_tables.sql;

SET FOREIGN_KEY_CHECKS = 1;
SELECT * FROM schema_migrations ORDER BY version;
