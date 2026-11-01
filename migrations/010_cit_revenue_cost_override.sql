-- =====================================================================
-- Migration: 010 CIT 收入/成本人工覆蓋
-- 檔案:     010_cit_revenue_cost_override.sql
-- 日期:     2026-10-23
-- 資料庫:   MySQL 8.x / ERMM_db
-- 目的:     當財報與稅務口徑差異大時，允許人工覆蓋收入與成本；
--           NULL 表示仍用自動取數（mgm_finance_summary）
-- 使用方式:
--   node scripts/apply_migration.js migrations/010_cit_revenue_cost_override.sql
-- 回滾:
--   node scripts/apply_migration.js migrations/010_cit_revenue_cost_override_rollback.sql
-- =====================================================================

SET NAMES utf8mb4;

-- ------------------------------------------------------------
-- 幂等加列助手：MySQL 8 不支援 ADD COLUMN IF NOT EXISTS，
-- 改用 information_schema 檢查後再 ALTER，確保 migration 可重複執行
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_add_column;
DELIMITER $$
CREATE PROCEDURE sp_add_column(
    IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_definition TEXT)
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME   = p_table
                      AND COLUMN_NAME  = p_column) THEN
        SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN ', p_definition);
        PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
    END IF;
END$$
DELIMITER ;

CALL sp_add_column('tax_cit_inputs', 'revenue_override',
  '`revenue_override` decimal(18,2) DEFAULT NULL COMMENT ''人工覆蓋營業收入總額（NULL=自動取財報 mgm_finance_summary.sale_amt 匯總）'' AFTER `withheld_tax`');
CALL sp_add_column('tax_cit_inputs', 'cost_override',
  '`cost_override` decimal(18,2) DEFAULT NULL COMMENT ''人工覆蓋營業成本總額（NULL=自動取財報 mgm_finance_summary.sale_cost_amt 匯總）'' AFTER `revenue_override`');
CALL sp_add_column('tax_cit_inputs', 'override_reason',
  '`override_reason` varchar(500) DEFAULT NULL COMMENT ''覆蓋原因說明（審計軌跡）'' AFTER `cost_override`');

-- 批次主表記錄是否使用人工覆蓋（用於後續審計）
CALL sp_add_column('cit_annual_settlements', 'is_overridden',
  '`is_overridden` tinyint(1) DEFAULT 0 COMMENT ''1=收入/成本來自人工覆蓋；0=自動取財報'' AFTER `include_adjustments`');

DROP PROCEDURE IF EXISTS sp_add_column;

INSERT IGNORE INTO schema_migrations (version, description) VALUES
('010_cit_revenue_cost_override', 'CIT 收入/成本人工覆蓋 — tax_cit_inputs 加 override 列 + settlements 加 is_overridden');

SELECT '=== Migration 010 驗證 ===' AS step;
SELECT COLUMN_NAME, COLUMN_COMMENT
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA='ERMM_db' AND TABLE_NAME='tax_cit_inputs'
   AND COLUMN_NAME IN ('revenue_override','cost_override','override_reason');
SELECT COLUMN_NAME, COLUMN_COMMENT
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA='ERMM_db' AND TABLE_NAME='cit_annual_settlements'
   AND COLUMN_NAME='is_overridden';
