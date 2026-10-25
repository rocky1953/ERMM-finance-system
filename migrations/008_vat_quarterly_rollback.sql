-- =====================================================================
-- Migration: 008 回滾
-- 檔案:     008_vat_quarterly_rollback.sql
-- 注意:     會移除申報週期與免稅標記欄位
-- =====================================================================
SET NAMES utf8mb4;

ALTER TABLE `vat_declarations`
  DROP COLUMN `filing_cycle`,
  DROP COLUMN `period_start`,
  DROP COLUMN `period_end`,
  DROP COLUMN `tax_exempt`;

DELETE FROM schema_migrations WHERE version LIKE '008_%';

SELECT '=== Migration 008 已回滾 ===' AS step;
