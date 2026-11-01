-- =====================================================================
-- Migration: 009 年終獎單獨計稅
-- 檔案:     009_iit_bonus.sql
-- 日期:     2026-10-23
-- 資料庫:   MySQL 8.x / ERMM_db
-- 目的:     支援全年一次性獎金（年終獎）單獨計稅或合併計稅，
--           新增獎金錄入表與批次關聯欄位。
-- 使用方式:
--   node scripts/apply_migration.js migrations/009_iit_bonus.sql
-- 回滾:
--   node scripts/apply_migration.js migrations/009_iit_bonus_rollback.sql
-- =====================================================================

SET NAMES utf8mb4;

-- ================================================================
-- 1. 年終獎錄入（全年一次性獎金）
-- ================================================================
CREATE TABLE IF NOT EXISTS `bonus_details` (
  `id`            int          NOT NULL AUTO_INCREMENT,
  `bu_no`         varchar(20)  NOT NULL,
  `tax_year`      varchar(10)  NOT NULL COMMENT 'YYYY',
  `employee_id`   varchar(50)  NOT NULL,
  `employee_name` varchar(100) DEFAULT NULL,
  `bonus_amount`  decimal(18,2) NOT NULL DEFAULT '0.00',
  `tax_method`    varchar(10)  NOT NULL DEFAULT 'SEPARATE'
      COMMENT 'SEPARATE=單獨計稅（獎金 ÷ 12 找月度稅率）；COMBINED=合併計稅（併入綜合所得）',
  `remark`        varchar(500) DEFAULT NULL,
  `create_time`   datetime     DEFAULT CURRENT_TIMESTAMP,
  `update_time`   datetime     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bu_year_emp` (`bu_no`, `tax_year`, `employee_id`),
  KEY `idx_year` (`tax_year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='全年一次性獎金錄入';

-- ================================================================
-- 2. 扣繳批次：記錄本次是否包含年終獎
-- ================================================================
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

CALL sp_add_column('iit_withholding_batches', 'bonus_mode',
  '`bonus_mode` varchar(10) DEFAULT NULL COMMENT ''SEPARATE/COMBINED 表示本批次是否包含年終獎及計稅方式'' AFTER `income_type`');

-- ================================================================
-- 3. 扣繳明細：年終獎相關欄位（非年終獎時為 0）
-- ================================================================
CALL sp_add_column('iit_withholding_details', 'bonus_amount',
  '`bonus_amount` decimal(18,2) DEFAULT ''0.00'' COMMENT ''年終獎金額'' AFTER `current_period_income`');
CALL sp_add_column('iit_withholding_details', 'bonus_tax',
  '`bonus_tax` decimal(18,2) DEFAULT ''0.00'' COMMENT ''年終獎應扣稅額'' AFTER `bonus_amount`');
CALL sp_add_column('iit_withholding_details', 'bonus_method',
  '`bonus_method` varchar(10) DEFAULT NULL COMMENT ''SEPARATE/COMBINED'' AFTER `bonus_tax`');

DROP PROCEDURE IF EXISTS sp_add_column;

INSERT IGNORE INTO schema_migrations (version, description) VALUES
('009_bonus_details', '年終獎單獨計稅 — bonus_details / batch_bonus_*');

SELECT '=== Migration 009 驗證 ===' AS step;
SELECT TABLE_NAME, TABLE_COMMENT
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA='ERMM_db' AND TABLE_NAME='bonus_details';
SELECT COLUMN_NAME FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA='ERMM_db' AND TABLE_NAME='iit_withholding_batches' AND COLUMN_NAME='bonus_mode';
SELECT COLUMN_NAME FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA='ERMM_db' AND TABLE_NAME='iit_withholding_details'
   AND COLUMN_NAME IN ('bonus_amount','bonus_tax','bonus_method');
