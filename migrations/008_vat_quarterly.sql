-- =====================================================================
-- Migration: 008 增值稅按季申報
-- 檔案:     008_vat_quarterly.sql
-- 日期:     2026-10-23
-- 資料庫:   MySQL 8.x / ERMM_db
-- 目的:     支援小規模納稅人按季申報，記錄申報週期與所屬期區間，
--           並標記季度免稅情形（季度銷售額未達免征標準）。
-- 使用方式:
--   node scripts/apply_migration.js migrations/008_vat_quarterly.sql
-- 回滾:
--   node scripts/apply_migration.js migrations/008_vat_quarterly_rollback.sql
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

CALL sp_add_column('vat_declarations', 'filing_cycle',
  '`filing_cycle` varchar(10) NOT NULL DEFAULT ''MONTHLY'' COMMENT ''申報週期：MONTHLY=按月，QUARTERLY=按季'' AFTER `tax_period`');
CALL sp_add_column('vat_declarations', 'period_start',
  '`period_start` varchar(6) DEFAULT NULL COMMENT ''稅款所屬期起始月 YYYYMM'' AFTER `filing_cycle`');
CALL sp_add_column('vat_declarations', 'period_end',
  '`period_end` varchar(6) DEFAULT NULL COMMENT ''稅款所屬期結束月 YYYYMM'' AFTER `period_start`');
CALL sp_add_column('vat_declarations', 'tax_exempt',
  '`tax_exempt` tinyint(1) NOT NULL DEFAULT 0 COMMENT ''1=季度銷售額未達免征標準，應納稅額為 0'' AFTER `tax_payable`');

DROP PROCEDURE IF EXISTS sp_add_column;

-- 歷史資料回填：預設為按月，起訖月同 tax_period
UPDATE `vat_declarations`
   SET `period_start` = `tax_period`,
       `period_end`   = `tax_period`
 WHERE `period_start` IS NULL;

INSERT IGNORE INTO schema_migrations (version, description) VALUES
('008_vat_filing_cycle', '增值稅按季申報 — filing_cycle / period_start / period_end / tax_exempt');

SELECT '=== Migration 008 驗證 ===' AS step;
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA='ERMM_db' AND TABLE_NAME='vat_declarations'
   AND COLUMN_NAME IN ('filing_cycle','period_start','period_end','tax_exempt');
