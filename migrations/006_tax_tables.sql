-- =====================================================================
-- Migration: 006 電子化報稅 5 表
-- 檔案:     006_tax_tables.sql
-- 日期:     2026-10-22
-- 資料庫:   MySQL 8.x / ERMM_db
-- 表數:     5 張
-- 目的:     增值稅申報 / 企業所得稅年度匯算 / 個人所得稅代扣代繳
--           儲存算稅草稿、提交狀態、扣繳明細、稅局受理收據
--
-- 使用方式:
--   mysql -hlocalhost -uroot -p ERMM_db < 006_tax_tables.sql
--
-- 回滾:
--   DROP TABLE IF EXISTS iit_withholding_details;
--   DROP TABLE IF EXISTS iit_withholding_batches;
--   DROP TABLE IF EXISTS cit_annual_settlements;
--   DROP TABLE IF EXISTS vat_declarations;
--   DROP TABLE IF EXISTS tax_submit_receipts;
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(50) PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    description VARCHAR(200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ================================================================
-- 1. 增值稅申報（含附加稅）主表
-- ================================================================
CREATE TABLE IF NOT EXISTS `vat_declarations` (
  `declaration_id`   varchar(64)  NOT NULL COMMENT 'UUID',
  `bu_no`            varchar(20)  NOT NULL,
  `tax_period`       varchar(10)  NOT NULL COMMENT 'YYYYMM',
  `taxpayer_type`    tinyint      NOT NULL COMMENT '1-一般納稅人, 2-小規模納稅人',
  `erp_sync_token`   varchar(100) DEFAULT NULL,
  `total_sales_amt`  decimal(18,2) DEFAULT '0.00' COMMENT '銷售額合計',
  `total_output_tax` decimal(18,2) DEFAULT '0.00' COMMENT '銷項稅額',
  `total_input_tax`  decimal(18,2) DEFAULT '0.00' COMMENT '進項稅額',
  `tax_payable`      decimal(18,2) DEFAULT '0.00' COMMENT '應納稅額',
  `prev_period_credit` decimal(18,2) DEFAULT '0.00' COMMENT '上期留抵稅額',
  `urban_maintenance`  decimal(18,2) DEFAULT '0.00' COMMENT '城建稅',
  `education_surcharge` decimal(18,2) DEFAULT '0.00' COMMENT '教育費附加',
  `local_education_surcharge` decimal(18,2) DEFAULT '0.00' COMMENT '地方教育附加',
  `status`           varchar(20)  DEFAULT 'DRAFT' COMMENT 'DRAFT/CALCULATED/SUBMITTED',
  `operator_id`      varchar(50)  DEFAULT NULL,
  `digital_signature` text,
  `validation_errors` text COMMENT 'JSON 陣列',
  `create_time`      datetime     DEFAULT CURRENT_TIMESTAMP,
  `update_time`      datetime     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`declaration_id`),
  KEY `idx_bu_period` (`bu_no`, `tax_period`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='增值稅申報主表';

-- ================================================================
-- 2. 企業所得稅年度匯算清繳
-- ================================================================
CREATE TABLE IF NOT EXISTS `cit_annual_settlements` (
  `settlement_id`       varchar(64)  NOT NULL COMMENT 'UUID',
  `bu_no`                varchar(20)  NOT NULL,
  `tax_year`             varchar(10)  NOT NULL COMMENT 'YYYY',
  `taxpayer_ident_no`    varchar(30)  NOT NULL COMMENT '統一社會信用代碼',
  `include_adjustments`  tinyint(1)   DEFAULT 1,
  `total_revenue`        decimal(18,2) DEFAULT '0.00' COMMENT '營業收入合計',
  `total_cost`           decimal(18,2) DEFAULT '0.00' COMMENT '營業成本合計',
  `tax_free_income`      decimal(18,2) DEFAULT '0.00' COMMENT '免稅收入',
  `tax_adjust_increase`  decimal(18,2) DEFAULT '0.00' COMMENT '納稅調整增加額',
  `tax_adjust_decrease`  decimal(18,2) DEFAULT '0.00' COMMENT '納稅調整減少額',
  `taxable_income`       decimal(18,2) DEFAULT '0.00' COMMENT '納稅調整後所得',
  `tax_rate`             decimal(10,4) DEFAULT '0.2500',
  `tax_payable`          decimal(18,2) DEFAULT '0.00' COMMENT '應納稅額',
  `tax_exemptions`       decimal(18,2) DEFAULT '0.00' COMMENT '減免所得稅額',
  `tax_credits`          decimal(18,2) DEFAULT '0.00' COMMENT '抵免所得稅額',
  `accum_prepaid_tax`    decimal(18,2) DEFAULT '0.00' COMMENT '累計預繳所得稅額',
  `withheld_tax`         decimal(18,2) DEFAULT '0.00' COMMENT '境外已繳稅額',
  `refund_or_supplement` decimal(18,2) DEFAULT '0.00' COMMENT '正=補稅 / 負=退稅',
  `status`               varchar(20)  DEFAULT 'DRAFT' COMMENT 'DRAFT/CALCULATED/SUBMITTED',
  `operator_id`          varchar(50)  DEFAULT NULL,
  `digital_signature`    text,
  `create_time`          datetime     DEFAULT CURRENT_TIMESTAMP,
  `update_time`          datetime     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`settlement_id`),
  KEY `idx_bu_year` (`bu_no`, `tax_year`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='企業所得稅年度匯算清繳';

-- ================================================================
-- 3. 個人所得稅代扣代繳 批次主表
-- ================================================================
CREATE TABLE IF NOT EXISTS `iit_withholding_batches` (
  `withholding_batch_id` varchar(64)  NOT NULL COMMENT 'UUID',
  `bu_no`                varchar(20)  NOT NULL,
  `tax_period`           varchar(10)  NOT NULL COMMENT 'YYYYMM',
  `income_type`          varchar(30)  NOT NULL COMMENT 'SALARY/LABOR_REMUNERATION/REMUNERATION_FOR_WRITING',
  `total_employees`      int          DEFAULT 0,
  `total_withheld_tax`   decimal(18,2) DEFAULT '0.00',
  `status`               varchar(20)  DEFAULT 'DRAFT',
  `operator_id`          varchar(50)  DEFAULT NULL,
  `create_time`          datetime     DEFAULT CURRENT_TIMESTAMP,
  `update_time`          datetime     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`withholding_batch_id`),
  KEY `idx_bu_period` (`bu_no`, `tax_period`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='個人所得稅扣繳批次';

-- ================================================================
-- 4. 個人所得稅代扣代繳 明細表
-- ================================================================
CREATE TABLE IF NOT EXISTS `iit_withholding_details` (
  `uid`                 int          NOT NULL AUTO_INCREMENT,
  `withholding_batch_id` varchar(64)  NOT NULL,
  `employee_id`         varchar(50)  NOT NULL,
  `bu_no`               varchar(20)  NOT NULL,
  `current_period_income`    decimal(18,2) DEFAULT '0.00' COMMENT '本期收入',
  `cumulative_income`        decimal(18,2) DEFAULT '0.00' COMMENT '累計收入',
  `cumulative_deduction`     decimal(18,2) DEFAULT '0.00' COMMENT '累計扣除(5000*月數+專項附加)',
  `applicable_tax_rate`      decimal(10,4) DEFAULT '0.0000',
  `quick_deduction`          decimal(18,2) DEFAULT '0.00' COMMENT '速算扣除數',
  `cumulative_paid_tax`      decimal(18,2) DEFAULT '0.00' COMMENT '累計已繳稅額',
  `current_period_tax`       decimal(18,2) DEFAULT '0.00' COMMENT '本期應扣稅額',
  `create_time`              datetime     DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  KEY `idx_batch` (`withholding_batch_id`),
  KEY `idx_emp` (`employee_id`),
  CONSTRAINT `fk_iit_detail_batch`
    FOREIGN KEY (`withholding_batch_id`) REFERENCES `iit_withholding_batches`(`withholding_batch_id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='個人所得稅扣繳明細';

-- ================================================================
-- 5. 稅局受理收據（通用於三大模組）
-- ================================================================
CREATE TABLE IF NOT EXISTS `tax_submit_receipts` (
  `id`              int          NOT NULL AUTO_INCREMENT,
  `module`          varchar(30)  NOT NULL COMMENT 'VAT/CIT/IIT',
  `biz_id`          varchar(64)  NOT NULL COMMENT 'declaration_id / settlement_id / batch_id',
  `tax_bureau_receipt_no` varchar(50) NOT NULL COMMENT '稅局受理流水號',
  `submit_time`     datetime     DEFAULT CURRENT_TIMESTAMP,
  `status`          varchar(20)  DEFAULT 'SUCCESS' COMMENT 'SUCCESS/PROCESSING/FAILED',
  `payment_deadline` date        DEFAULT NULL,
  `operator_id`     varchar(50)  DEFAULT NULL,
  `raw_response`    text COMMENT '稅局回傳原文 JSON',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_module_biz` (`module`, `biz_id`),
  KEY `idx_receipt_no` (`tax_bureau_receipt_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='稅局受理收據';

-- 版本追蹤
INSERT IGNORE INTO schema_migrations (version, description) VALUES
('006_vat_declarations',         '報稅 5 表 — vat_declarations'),
('006_cit_annual_settlements',   '報稅 5 表 — cit_annual_settlements'),
('006_iit_withholding_batches',  '報稅 5 表 — iit_withholding_batches'),
('006_iit_withholding_details',  '報稅 5 表 — iit_withholding_details'),
('006_tax_submit_receipts',      '報稅 5 表 — tax_submit_receipts');

SET FOREIGN_KEY_CHECKS = 1;

-- 驗證
SELECT '=== Migration 006 驗證 ===' AS step;
SELECT TABLE_NAME, TABLE_COMMENT
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA='ERMM_db'
   AND TABLE_NAME IN (
       'vat_declarations',
       'cit_annual_settlements',
       'iit_withholding_batches',
       'iit_withholding_details',
       'tax_submit_receipts'
   )
 ORDER BY TABLE_NAME;
