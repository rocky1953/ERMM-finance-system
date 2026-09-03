-- =====================================================================
-- Migration: 003 ERP 主數據 8 表
-- 檔案:     003_erp_master_tables.sql
-- 日期:     2026-09-03 04:59:05
-- 資料庫:   MySQL 8.x / ERMM_db
-- 表數:     8 張
-- 目的:     批次管線 Step1~Step5 的資料源 + 參數配置
--
-- 使用方式:
--   mysql -hlocalhost -uroot -pERMM_db < 003_erp_master_tables.sql
--
-- 回滾:
--   mysql -hlocalhost -uroot -pERMM_db < 003_erp_master_tables_rollback.sql
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 版本追蹤
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(50) PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    description VARCHAR(200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `cams_system_codes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code_type` varchar(50) NOT NULL COMMENT '碼表類型: CURRENCY/BUSINESS_ID/AGEING_STOCK/BATCH_CONTROL/MO_CUTOFF/CUSTOM_CUTOFF/INV_CUTOFF/setup',
  `code_value` varchar(100) NOT NULL COMMENT '代碼值',
  `value_description` varchar(500) DEFAULT NULL COMMENT '說明',
  `value_number1` decimal(18,6) DEFAULT '0.000000' COMMENT '數值1(匯率/減值率)',
  `value_number2` decimal(18,6) DEFAULT '0.000000' COMMENT '數值2',
  `value_number3` decimal(18,6) DEFAULT '0.000000' COMMENT '數值3(VAT_rate)',
  `value_alpha1` varchar(200) DEFAULT NULL COMMENT '字串1(授權碼)',
  `value_alpha2` varchar(200) DEFAULT NULL COMMENT '字串2',
  `value_date1` date DEFAULT NULL COMMENT '日期1(初始授權到期)',
  `value_date2` date DEFAULT NULL COMMENT '日期2(終止授權到期)',
  `inuse_flag` varchar(10) DEFAULT 'USE' COMMENT 'USE/NOUSE',
  `sort_order` int DEFAULT '0',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code_type`,`code_value`)
) ENGINE=InnoDB AUTO_INCREMENT=40 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='系統碼表';

CREATE TABLE IF NOT EXISTS `e2_xitems_daily_status` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `bu_no` varchar(20) NOT NULL,
  `xitems` varchar(100) DEFAULT NULL,
  `item_name` varchar(200) DEFAULT NULL,
  `qty_balance` decimal(18,4) DEFAULT '0.0000',
  `unit_price` decimal(18,6) DEFAULT '0.000000',
  `exchange_rate` decimal(18,6) DEFAULT '1.000000',
  `stock_value` decimal(18,2) DEFAULT '0.00' COMMENT 'stock_value=price×qty×FX',
  `ageing_days` int DEFAULT '0',
  `ageing_category` varchar(30) DEFAULT NULL,
  `reduce_percentage` decimal(10,4) DEFAULT '0.0000' COMMENT '減值率%',
  `current_value` decimal(18,2) DEFAULT '0.00' COMMENT 'current_value=stock_value×(1-reduce%)',
  `current_lose` decimal(18,2) DEFAULT '0.00' COMMENT 'current_lose=stock_value×reduce%',
  `stock_date` date DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  KEY `idx_bu_item` (`bu_no`,`xitems`),
  KEY `idx_stock_date` (`stock_date`)
) ENGINE=InnoDB AUTO_INCREMENT=157 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='每日庫存狀態';

CREATE TABLE IF NOT EXISTS `e2_xitems_daily_status_chart` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `bu_no` varchar(20) NOT NULL,
  `stock_date` date DEFAULT NULL,
  `reduce_percentage` decimal(10,4) DEFAULT '0.0000',
  `stock_value_total` decimal(18,2) DEFAULT '0.00',
  `current_value_total` decimal(18,2) DEFAULT '0.00',
  `current_lose_total` decimal(18,2) DEFAULT '0.00',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  KEY `idx_bu_date` (`bu_no`,`stock_date`)
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='庫存彙總';

CREATE TABLE IF NOT EXISTS `ermm_erp_documents` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `bu_no` varchar(20) NOT NULL,
  `doc_type` varchar(30) DEFAULT NULL COMMENT '銀行貸款/採購合約/其他',
  `xitems` varchar(100) DEFAULT NULL COMMENT '貸款ID/PO編號',
  `doc_name` varchar(200) DEFAULT NULL,
  `doc_path` varchar(500) DEFAULT NULL,
  `upload_user` varchar(50) DEFAULT NULL,
  `upload_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `remark` text,
  PRIMARY KEY (`uid`),
  KEY `idx_bu_doc` (`bu_no`,`doc_type`,`xitems`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='文件管理表';

CREATE TABLE IF NOT EXISTS `ermm_erp_so_dn` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `bu_no` varchar(20) NOT NULL,
  `so_nbr` varchar(50) DEFAULT NULL,
  `xitems` varchar(100) DEFAULT NULL,
  `client_name` varchar(200) DEFAULT NULL,
  `DN_date` date DEFAULT NULL,
  `DN_qty` decimal(18,4) DEFAULT '0.0000',
  `so_qty` decimal(18,4) DEFAULT '0.0000',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  KEY `idx_bu_so` (`bu_no`,`so_nbr`),
  KEY `idx_bu_date` (`bu_no`,`DN_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='SO交貨單';

CREATE TABLE IF NOT EXISTS `mgm_account_details` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `bu_no` varchar(20) NOT NULL,
  `YYYY_MM` varchar(10) DEFAULT NULL,
  `acct_type` varchar(20) DEFAULT NULL COMMENT '帳戶類型',
  `group_id` varchar(30) DEFAULT NULL COMMENT '科目大類',
  `sub_group` varchar(30) DEFAULT NULL COMMENT '子科目',
  `acct_name` varchar(100) DEFAULT NULL,
  `sub_amt` decimal(18,2) DEFAULT '0.00',
  `DB_CR` varchar(3) DEFAULT NULL,
  `remark` text,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  KEY `idx_bu_ym_sub` (`bu_no`,`YYYY_MM`,`sub_group`),
  KEY `idx_bu_ym` (`bu_no`,`YYYY_MM`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='帳戶明細表';

CREATE TABLE IF NOT EXISTS `monthly_items` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `bu_no` varchar(20) NOT NULL,
  `YYYY_MM` varchar(10) NOT NULL,
  `item_type` varchar(30) DEFAULT NULL COMMENT '租金/水電/薪資/保險',
  `item_name` varchar(100) DEFAULT NULL,
  `item_amt` decimal(18,2) DEFAULT '0.00',
  `pay_date` date DEFAULT NULL,
  `DB_CR` varchar(3) DEFAULT NULL,
  `remark` text,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  KEY `idx_bu_ym` (`bu_no`,`YYYY_MM`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='月度項目表';

CREATE TABLE IF NOT EXISTS `relation_detail` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `bu_no` varchar(20) NOT NULL,
  `relation_id` varchar(50) NOT NULL,
  `relation_name` varchar(100) DEFAULT NULL,
  `relation_type` varchar(30) DEFAULT NULL COMMENT '客戶/供應商/關係人',
  `contact_person` varchar(50) DEFAULT NULL,
  `contact_phone` varchar(50) DEFAULT NULL,
  `address` varchar(300) DEFAULT NULL,
  `tax_id` varchar(30) DEFAULT NULL COMMENT '統一編號/稅號',
  `inuse_flag` varchar(10) DEFAULT 'USE',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  UNIQUE KEY `uk_bu_relation` (`bu_no`,`relation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='往來對象表';

-- 記錄版本
INSERT IGNORE INTO schema_migrations (version, description) VALUES
('003_cams_system_codes', 'ERP 主數據 8 表 — cams_system_codes'),
('003_e2_xitems_daily_status', 'ERP 主數據 8 表 — e2_xitems_daily_status'),
('003_e2_xitems_daily_status_chart', 'ERP 主數據 8 表 — e2_xitems_daily_status_chart'),
('003_ermm_erp_documents', 'ERP 主數據 8 表 — ermm_erp_documents'),
('003_ermm_erp_so_dn', 'ERP 主數據 8 表 — ermm_erp_so_dn'),
('003_mgm_account_details', 'ERP 主數據 8 表 — mgm_account_details'),
('003_monthly_items', 'ERP 主數據 8 表 — monthly_items'),
('003_relation_detail', 'ERP 主數據 8 表 — relation_detail');

SET FOREIGN_KEY_CHECKS = 1;

-- 驗證
SELECT '=== Migration 003 驗證 ===' AS step;
SELECT TABLE_NAME, TABLE_COMMENT, ENGINE
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA='ERMM_db'
   AND TABLE_NAME IN ('cams_system_codes', 'e2_xitems_daily_status', 'e2_xitems_daily_status_chart', 'ermm_erp_documents', 'ermm_erp_so_dn', 'mgm_account_details', 'monthly_items', 'relation_detail')
 ORDER BY TABLE_NAME;
