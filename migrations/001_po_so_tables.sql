-- =====================================================================
-- Migration: 001 ERP PO/SO 原始單據表
-- 檔案:     001_po_so_tables.sql
-- 日期:     2026-09-03 04:59:05
-- 資料庫:   MySQL 8.x / ERMM_db
-- 表數:     3 張
-- 目的:     三張表: ermm_temp_po, ermm_erp_po, ermm_erp_so
--
-- 使用方式:
--   mysql -hlocalhost -uroot -pERMM_db < 001_po_so_tables.sql
--
-- 回滾:
--   mysql -hlocalhost -uroot -pERMM_db < 001_po_so_tables_rollback.sql
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 版本追蹤
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(50) PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    description VARCHAR(200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `ermm_temp_po` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `bu_no` varchar(20) NOT NULL,
  `po_id` varchar(50) DEFAULT NULL,
  `supplier_name` varchar(200) DEFAULT NULL,
  `xitems` varchar(100) DEFAULT NULL,
  `po_date` date DEFAULT NULL,
  `po_qty` decimal(18,4) DEFAULT '0.0000',
  `unit_price` decimal(18,6) DEFAULT '0.000000',
  `exchange_rate` decimal(18,6) DEFAULT '1.000000',
  `po_amount` decimal(18,2) DEFAULT '0.00',
  `vat_amt` decimal(18,2) DEFAULT '0.00',
  `batch_id` varchar(50) DEFAULT NULL,
  `sync_time` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  KEY `idx_bu_batch` (`bu_no`,`batch_id`)
) ENGINE=InnoDB AUTO_INCREMENT=95 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='PO暫存表';

CREATE TABLE IF NOT EXISTS `ermm_erp_po` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `bu_no` varchar(20) NOT NULL,
  `po_id` varchar(50) DEFAULT NULL,
  `supplier_name` varchar(200) DEFAULT NULL,
  `xitems` varchar(100) DEFAULT NULL,
  `po_date` date DEFAULT NULL,
  `po_qty` decimal(18,4) DEFAULT '0.0000',
  `unit_price` decimal(18,6) DEFAULT '0.000000',
  `unit_price_local` decimal(18,6) DEFAULT '0.000000',
  `exchange_rate` decimal(18,6) DEFAULT '1.000000',
  `po_amount` decimal(18,2) DEFAULT '0.00',
  `po_amount_local` decimal(18,2) DEFAULT '0.00',
  `vat_amt` decimal(18,2) DEFAULT '0.00',
  `YYYY` varchar(10) DEFAULT NULL,
  `MM` varchar(5) DEFAULT NULL,
  `YYYY_MM` varchar(10) DEFAULT NULL,
  `po_status` varchar(20) DEFAULT '未審核',
  `po_sub_status` varchar(20) DEFAULT '未交付',
  `supplier_type` varchar(30) DEFAULT NULL,
  `inventory_qty` decimal(18,4) DEFAULT '0.0000',
  `qty_balance_approved` decimal(18,4) DEFAULT '0.0000',
  `qty_balance_closed` decimal(18,4) DEFAULT '0.0000',
  `close_batch_id` varchar(50) DEFAULT NULL,
  `deliver_ontime` varchar(5) DEFAULT 'Y',
  `batch_id` varchar(50) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  KEY `idx_bu` (`bu_no`),
  KEY `idx_bu_ym` (`bu_no`,`YYYY_MM`),
  KEY `idx_po_id` (`bu_no`,`po_id`),
  KEY `idx_status` (`po_status`,`po_sub_status`)
) ENGINE=InnoDB AUTO_INCREMENT=126 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='採購訂單(AP來源)';

CREATE TABLE IF NOT EXISTS `ermm_erp_so` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `bu_no` varchar(20) NOT NULL,
  `so_nbr` varchar(50) DEFAULT NULL,
  `client_id` varchar(50) DEFAULT NULL,
  `client_name` varchar(200) DEFAULT NULL,
  `xitems` varchar(100) DEFAULT NULL,
  `so_date` date DEFAULT NULL,
  `so_qty` decimal(18,4) DEFAULT '0.0000',
  `dn_qty` decimal(18,4) DEFAULT '0.0000' COMMENT '交貨數量',
  `unit_price` decimal(18,6) DEFAULT '0.000000',
  `YYYY` varchar(10) DEFAULT NULL,
  `MM` varchar(5) DEFAULT NULL,
  `YYYY_MM` varchar(10) DEFAULT NULL,
  `status` varchar(20) DEFAULT NULL,
  `remark` text,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  KEY `idx_bu` (`bu_no`),
  KEY `idx_bu_ym` (`bu_no`,`YYYY_MM`),
  KEY `idx_so_nbr` (`bu_no`,`so_nbr`)
) ENGINE=InnoDB AUTO_INCREMENT=80 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='銷售訂單(AR來源)';

-- 記錄版本
INSERT IGNORE INTO schema_migrations (version, description) VALUES
('001_ermm_temp_po', 'ERP PO/SO 原始單據表 — ermm_temp_po'),
('001_ermm_erp_po', 'ERP PO/SO 原始單據表 — ermm_erp_po'),
('001_ermm_erp_so', 'ERP PO/SO 原始單據表 — ermm_erp_so');

SET FOREIGN_KEY_CHECKS = 1;

-- 驗證
SELECT '=== Migration 001 驗證 ===' AS step;
SELECT TABLE_NAME, TABLE_COMMENT, ENGINE
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA='ERMM_db'
   AND TABLE_NAME IN ('ermm_temp_po', 'ermm_erp_po', 'ermm_erp_so')
 ORDER BY TABLE_NAME;
