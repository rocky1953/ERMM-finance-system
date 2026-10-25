-- =====================================================================
-- Rollback: 006 電子化報稅 5 表
-- 檔案:     006_tax_tables_rollback.sql
-- 目的:     刪除 migration 006 建立的所有表
-- 使用方式:
--   mysql -hlocalhost -uroot -p ERMM_db < 006_tax_tables_rollback.sql
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS iit_withholding_details;
DROP TABLE IF EXISTS iit_withholding_batches;
DROP TABLE IF EXISTS cit_annual_settlements;
DROP TABLE IF EXISTS vat_declarations;
DROP TABLE IF EXISTS tax_submit_receipts;

DELETE FROM schema_migrations
 WHERE version LIKE '006_%';

SET FOREIGN_KEY_CHECKS = 1;

SELECT '=== Rollback 006 完成 ===' AS step;
