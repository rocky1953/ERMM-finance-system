-- =====================================================================
-- Migration: 005 ERP 明細 3 表
-- 檔案:     005_erp_detail_tables.sql
-- 日期:     2026-09-03 04:59:05
-- 資料庫:   MySQL 8.x / ERMM_db
-- 表數:     3 張
-- 目的:     交易明細 / 生產明細 / 在途價格（擴展用）
--
-- 使用方式:
--   mysql -hlocalhost -uroot -pERMM_db < 005_erp_detail_tables.sql
--
-- 回滾:
--   mysql -hlocalhost -uroot -pERMM_db < 005_erp_detail_tables_rollback.sql
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 版本追蹤
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(50) PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    description VARCHAR(200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `bh_mgm_tx_detail` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `bu_no` varchar(20) NOT NULL,
  `event_type` varchar(30) DEFAULT NULL COMMENT '銷售出庫/採購入庫',
  `xitems` varchar(100) DEFAULT NULL,
  `so_nbr` varchar(50) DEFAULT NULL,
  `client_id` varchar(50) DEFAULT NULL,
  `wk_date` date DEFAULT NULL,
  `qty` decimal(18,4) DEFAULT '0.0000',
  `unit_price` decimal(18,6) DEFAULT '0.000000',
  `amt` decimal(18,2) DEFAULT '0.00',
  `YYYY_MM` varchar(10) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  KEY `idx_bu` (`bu_no`),
  KEY `idx_bu_ym` (`bu_no`,`YYYY_MM`),
  KEY `idx_event` (`bu_no`,`event_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='交易明細表';

CREATE TABLE IF NOT EXISTS `mgm_production_details` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `bu_no` varchar(20) NOT NULL,
  `wk_date` date DEFAULT NULL,
  `xitems` varchar(100) DEFAULT NULL,
  `customer_name` varchar(200) DEFAULT NULL,
  `so_nbr` varchar(50) DEFAULT NULL,
  `batch_qty` decimal(18,4) DEFAULT '0.0000',
  `df_qty` decimal(18,4) DEFAULT '0.0000' COMMENT '不良數量',
  `qc_type` varchar(100) DEFAULT NULL,
  `YYYY_MM` varchar(10) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  KEY `idx_bu` (`bu_no`),
  KEY `idx_bu_date` (`bu_no`,`wk_date`),
  KEY `idx_bu_ym` (`bu_no`,`YYYY_MM`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='生產明細表';

CREATE TABLE IF NOT EXISTS `transit_price` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `bu_no` varchar(20) NOT NULL,
  `xitems` varchar(100) NOT NULL COMMENT '物料編號',
  `item_name` varchar(200) DEFAULT NULL,
  `qty` decimal(18,4) DEFAULT '0.0000',
  `unit_price` decimal(18,6) DEFAULT '0.000000',
  `exchange_rate` decimal(18,6) DEFAULT '1.000000',
  `transit_amt` decimal(18,2) DEFAULT '0.00' COMMENT '在途金額',
  `vessel_name` varchar(100) DEFAULT NULL COMMENT '船名',
  `ETD_date` date DEFAULT NULL COMMENT '預計啟運',
  `ETA_date` date DEFAULT NULL COMMENT '預計到港',
  `po_id` varchar(50) DEFAULT NULL,
  `remark` text,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  KEY `idx_bu_item` (`bu_no`,`xitems`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='在途價格表';

-- 記錄版本
INSERT IGNORE INTO schema_migrations (version, description) VALUES
('005_bh_mgm_tx_detail', 'ERP 明細 3 表 — bh_mgm_tx_detail'),
('005_mgm_production_details', 'ERP 明細 3 表 — mgm_production_details'),
('005_transit_price', 'ERP 明細 3 表 — transit_price');

SET FOREIGN_KEY_CHECKS = 1;

-- 驗證
SELECT '=== Migration 005 驗證 ===' AS step;
SELECT TABLE_NAME, TABLE_COMMENT, ENGINE
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA='ERMM_db'
   AND TABLE_NAME IN ('bh_mgm_tx_detail', 'mgm_production_details', 'transit_price')
 ORDER BY TABLE_NAME;
