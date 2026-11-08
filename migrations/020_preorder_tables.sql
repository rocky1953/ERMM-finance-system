-- =====================================================================
-- Migration: 020 客戶專案主檔 + 銷售預估訂單
-- 檔案:     020_preorder_tables.sql
-- 日期:     2026-11-08
-- 資料庫:   MySQL 8.x / ERMM_db
-- 表數:     2 張
-- 目的:     mgm_customer_projects（客戶→專案主檔，供業務員選單）
--           mgm_preorder_lists（銷售預估訂單，preorder_Id 為 RUID）
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `mgm_customer_projects` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `customer_id` varchar(50) NOT NULL COMMENT '客戶編號',
  `customer_name` varchar(200) NOT NULL COMMENT '客戶名稱',
  `project_id` varchar(50) NOT NULL COMMENT '專案編號',
  `project_name` varchar(200) NOT NULL COMMENT '專案名稱',
  `status` varchar(20) DEFAULT 'active' COMMENT 'active/closed',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  UNIQUE KEY `uk_cust_proj` (`customer_id`,`project_id`),
  KEY `idx_cust` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='客戶專案主檔';

CREATE TABLE IF NOT EXISTS `mgm_preorder_lists` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `preorder_Id` varchar(30) NOT NULL COMMENT '預估單號(RUID: PRYYYY-#####)',
  `user_id` varchar(50) DEFAULT NULL COMMENT '業務員帳號',
  `user_name` varchar(100) DEFAULT NULL COMMENT '業務員姓名',
  `customer_id` varchar(50) DEFAULT NULL COMMENT '客戶編號',
  `project_id` varchar(50) DEFAULT NULL COMMENT '專案編號',
  `project_name` varchar(200) DEFAULT NULL COMMENT '專案名稱',
  `order_amt` decimal(18,2) DEFAULT '0.00' COMMENT '預估訂單金額',
  `order_date` date DEFAULT NULL COMMENT '預估下單日',
  `status` varchar(20) DEFAULT 'draft' COMMENT 'draft/confirmed/won/lost/cancelled',
  `remark` text COMMENT '備註',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  UNIQUE KEY `uk_preorder_id` (`preorder_Id`),
  KEY `idx_date` (`order_date`),
  KEY `idx_customer` (`customer_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='銷售預估訂單';

-- 記錄版本
INSERT IGNORE INTO schema_migrations (version, description) VALUES
('020_mgm_customer_projects', '客戶專案主檔 — mgm_customer_projects'),
('020_mgm_preorder_lists', '銷售預估訂單 — mgm_preorder_lists');

SET FOREIGN_KEY_CHECKS = 1;

SELECT '=== Migration 020 驗證 ===' AS step;
SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES
 WHERE TABLE_SCHEMA='ERMM_db' AND TABLE_NAME IN ('mgm_customer_projects','mgm_preorder_lists');
