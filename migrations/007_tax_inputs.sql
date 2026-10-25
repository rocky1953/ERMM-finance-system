-- =====================================================================
-- Migration: 007 報稅人工錄入與勾對表
-- 檔案:     007_tax_inputs.sql
-- 日期:     2026-10-23
-- 資料庫:   MySQL 8.x / ERMM_db
-- 目的:     補齊算稅引擎中「無法自動取數」的欄位，提供人工錄入介面：
--           1. tax_vat_adjustments  增值稅調整（進項轉出 / 上期留抵覆蓋）
--           2. tax_cit_inputs       企業所得稅匯算參數（稅率 / 預繳 / 境外已繳）
--           3. tax_cit_adjustments  企業所得稅納稅調整明細（逐筆）
--           4. payroll_details      工資及個稅扣除明細（逐人逐月）
--           5. vat_declarations    新增 input_tax_transfer_out 欄位
-- 使用方式:
--   mysql -hlocalhost -uroot -p ERMM_db < 007_tax_inputs.sql
-- 回滾:
--   mysql -hlocalhost -uroot -p ERMM_db < 007_tax_inputs_rollback.sql
-- =====================================================================

SET NAMES utf8mb4;

-- ================================================================
-- 1. 增值稅人工調整（每帳套每期一筆）
-- ================================================================
CREATE TABLE IF NOT EXISTS `tax_vat_adjustments` (
  `bu_no`                 varchar(20)  NOT NULL,
  `tax_period`            varchar(10)  NOT NULL COMMENT 'YYYYMM',
  `input_tax_transfer_out` decimal(18,2) DEFAULT '0.00' COMMENT '進項稅額轉出（不得抵扣部分）',
  `prev_credit_override`  decimal(18,2) DEFAULT NULL COMMENT '上期留抵人工覆蓋值；NULL=由系統計算',
  `note`                  varchar(500) DEFAULT NULL,
  `updated_by`            varchar(50) DEFAULT NULL,
  `create_time`           datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time`           datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`bu_no`, `tax_period`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='增值稅人工調整';

-- ================================================================
-- 2. 企業所得稅匯算參數（每帳套每年一筆）
-- ================================================================
CREATE TABLE IF NOT EXISTS `tax_cit_inputs` (
  `bu_no`              varchar(20)  NOT NULL,
  `tax_year`           varchar(10)  NOT NULL COMMENT 'YYYY',
  `tax_rate`           decimal(10,4) DEFAULT '0.2500' COMMENT '適用稅率，0.25=25%',
  `accum_prepaid_tax`  decimal(18,2) DEFAULT '0.00' COMMENT '累計已預繳企業所得稅',
  `withheld_tax`       decimal(18,2) DEFAULT '0.00' COMMENT '境外已繳可抵免稅額',
  `note`               varchar(500) DEFAULT NULL,
  `updated_by`         varchar(50) DEFAULT NULL,
  `create_time`        datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time`        datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`bu_no`, `tax_year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='企業所得稅匯算參數';

-- ================================================================
-- 3. 企業所得稅納稅調整明細（逐筆）
-- ================================================================
CREATE TABLE IF NOT EXISTS `tax_cit_adjustments` (
  `id`              int          NOT NULL AUTO_INCREMENT,
  `bu_no`           varchar(20)  NOT NULL,
  `tax_year`        varchar(10)  NOT NULL COMMENT 'YYYY',
  `adjustment_type` varchar(30)  NOT NULL COMMENT 'TAX_FREE_INCOME/ADJ_INCREASE/ADJ_DECREASE/TAX_EXEMPTION/TAX_CREDIT',
  `amount`          decimal(18,2) NOT NULL DEFAULT '0.00',
  `remark`          varchar(500) DEFAULT NULL,
  `updated_by`      varchar(50)  DEFAULT NULL,
  `create_time`     datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_bu_year` (`bu_no`, `tax_year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='企業所得稅納稅調整明細';

-- ================================================================
-- 4. 工資及個稅扣除明細（逐人逐月）
-- ================================================================
CREATE TABLE IF NOT EXISTS `payroll_details` (
  `id`                int          NOT NULL AUTO_INCREMENT,
  `bu_no`             varchar(20)  NOT NULL,
  `YYYY_MM`           varchar(10)  NOT NULL COMMENT 'YYYY-MM',
  `employee_id`       varchar(50)  NOT NULL COMMENT '員工編號',
  `employee_name`     varchar(100) DEFAULT NULL,
  `gross_salary`      decimal(18,2) DEFAULT '0.00' COMMENT '本期應發工資（稅前收入）',
  `social_insurance`  decimal(18,2) DEFAULT '0.00' COMMENT '三險一金個人部分（月）',
  `special_deduction` decimal(18,2) DEFAULT '0.00' COMMENT '專項附加扣除（月）',
  `other_deduction`   decimal(18,2) DEFAULT '0.00' COMMENT '其他扣除（月）',
  `remark`            varchar(500) DEFAULT NULL,
  `create_time`       datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time`       datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bu_period_emp` (`bu_no`, `YYYY_MM`, `employee_id`),
  KEY `idx_emp` (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='工資及個稅扣除明細';

-- ================================================================
-- 5. 增值稅申報主表：補記進項轉出，保留審計軌跡
-- ================================================================
ALTER TABLE `vat_declarations`
  ADD COLUMN `input_tax_transfer_out` decimal(18,2) DEFAULT '0.00'
  COMMENT '進項稅額轉出' AFTER `total_input_tax`;

-- 版本追蹤
INSERT IGNORE INTO schema_migrations (version, description) VALUES
('007_tax_vat_adjustments', '報稅人工錄入 — tax_vat_adjustments'),
('007_tax_cit_inputs',      '報稅人工錄入 — tax_cit_inputs'),
('007_tax_cit_adjustments', '報稅人工錄入 — tax_cit_adjustments'),
('007_payroll_details',     '報稅人工錄入 — payroll_details');

SELECT '=== Migration 007 驗證 ===' AS step;
SELECT TABLE_NAME, TABLE_COMMENT
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA='ERMM_db'
   AND TABLE_NAME IN ('tax_vat_adjustments','tax_cit_inputs','tax_cit_adjustments','payroll_details');
SELECT COLUMN_NAME FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA='ERMM_db' AND TABLE_NAME='vat_declarations'
   AND COLUMN_NAME='input_tax_transfer_out';
