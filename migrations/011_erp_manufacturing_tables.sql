-- =====================================================================
-- Migration: 011 ERP 製造 4 表
-- 檔案:     011_erp_manufacturing_tables.sql
-- 日期:     2026-10-25
-- 資料庫:   MySQL 8.x / ERMM_db
-- 表數:     4 張
-- 目的:     製造工單、工單用料、工藝路線、報工產出
--
-- 使用方式:
--   mysql -hlocalhost -uroot -p ERMM_db < 011_erp_manufacturing_tables.sql
--
-- 回滾:
--   mysql -hlocalhost -uroot -p ERMM_db < 011_erp_manufacturing_tables_rollback.sql
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 版本追蹤
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(50) PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    description VARCHAR(200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 製造工單主檔（一行一張工單）
CREATE TABLE IF NOT EXISTS `ermm_erp_mo` (
  `uid` int NOT NULL AUTO_INCREMENT COMMENT '主鍵',
  `bu_no` varchar(20) NOT NULL COMMENT '公司別',
  `mo_no` varchar(50) NOT NULL COMMENT '製造工單號',
  `xitems` varchar(100) DEFAULT NULL COMMENT '產品編號',
  `item_name` varchar(200) DEFAULT NULL COMMENT '產品名稱',
  `plan_qty` decimal(18,4) DEFAULT '0.0000' COMMENT '計劃生產數量',
  `completed_qty` decimal(18,4) DEFAULT '0.0000' COMMENT '已完工數量',
  `scrap_qty` decimal(18,4) DEFAULT '0.0000' COMMENT '報廢數量',
  `start_date` date DEFAULT NULL COMMENT '計劃開工日',
  `due_date` date DEFAULT NULL COMMENT '計劃完工日',
  `actual_start_date` date DEFAULT NULL COMMENT '實際開工日',
  `actual_end_date` date DEFAULT NULL COMMENT '實際完工日',
  `mo_status` varchar(20) DEFAULT NULL COMMENT '開立/生產中/完工/結案/取消',
  `customer_name` varchar(200) DEFAULT NULL COMMENT '客戶名稱',
  `so_nbr` varchar(50) DEFAULT NULL COMMENT '關聯銷售訂單號',
  `priority` varchar(20) DEFAULT NULL COMMENT '優先級',
  `remark` text,
  `YYYY_MM` varchar(10) DEFAULT NULL COMMENT '年月(依 start_date)',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  UNIQUE KEY `uk_bu_mo` (`bu_no`,`mo_no`),
  KEY `idx_bu_status` (`bu_no`,`mo_status`),
  KEY `idx_bu_item` (`bu_no`,`xitems`),
  KEY `idx_bu_date` (`bu_no`,`start_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='製造工單主檔';

-- 工單用料明細（BOM 展開，一行一個用料行）
CREATE TABLE IF NOT EXISTS `ermm_erp_mo_component` (
  `uid` int NOT NULL AUTO_INCREMENT COMMENT '主鍵',
  `bu_no` varchar(20) NOT NULL COMMENT '公司別',
  `mo_no` varchar(50) NOT NULL COMMENT '製造工單號',
  `line_no` int NOT NULL DEFAULT '10' COMMENT '行號(同工單內唯一)',
  `component_item` varchar(100) NOT NULL COMMENT '用料物料編號',
  `component_name` varchar(200) DEFAULT NULL COMMENT '用料名稱',
  `req_qty` decimal(18,4) DEFAULT '0.0000' COMMENT '需求用量',
  `issued_qty` decimal(18,4) DEFAULT '0.0000' COMMENT '已領用量',
  `unit` varchar(20) DEFAULT NULL COMMENT '單位',
  `warehouse` varchar(50) DEFAULT NULL COMMENT '領料倉庫',
  `unit_price` decimal(18,6) DEFAULT '0.000000' COMMENT '單價(原幣)',
  `amount` decimal(18,2) DEFAULT '0.00' COMMENT '金額(原幣)',
  `remark` text COMMENT '備註',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '建立時間',
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新時間',
  PRIMARY KEY (`uid`),
  UNIQUE KEY `uk_mo_line` (`bu_no`,`mo_no`,`line_no`),
  KEY `idx_bu_mo` (`bu_no`,`mo_no`),
  KEY `idx_bu_component` (`bu_no`,`component_item`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='工單用料明細表';

-- 工藝路線/工序（一行一道工序）
CREATE TABLE IF NOT EXISTS `ermm_erp_routing` (
  `uid` int NOT NULL AUTO_INCREMENT COMMENT '主鍵',
  `bu_no` varchar(20) NOT NULL COMMENT '公司別',
  `xitems` varchar(100) NOT NULL COMMENT '產品編號',
  `routing_no` varchar(50) NOT NULL COMMENT '工藝路線編號',
  `op_seq` int NOT NULL COMMENT '工序順序',
  `op_code` varchar(50) DEFAULT NULL COMMENT '工序編號',
  `op_name` varchar(100) DEFAULT NULL COMMENT '工序名稱',
  `work_center` varchar(50) DEFAULT NULL COMMENT '工作中心/機台',
  `std_time` decimal(18,4) DEFAULT '0.0000' COMMENT '標準工時(分鐘)',
  `setup_time` decimal(18,4) DEFAULT '0.0000' COMMENT '準備工時(分鐘)',
  `yield_rate` decimal(10,4) DEFAULT '0.0000' COMMENT '良率(%)',
  `is_key_process` varchar(5) DEFAULT 'N' COMMENT '是否關鍵工序 Y/N',
  `remark` text COMMENT '備註',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '建立時間',
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新時間',
  PRIMARY KEY (`uid`),
  UNIQUE KEY `uk_route` (`bu_no`,`xitems`,`routing_no`,`op_seq`),
  KEY `idx_bu_item` (`bu_no`,`xitems`),
  KEY `idx_bu_route` (`bu_no`,`routing_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='工藝路線/工序表';

-- 報工/產出記錄（一行一個工單工序班次）
CREATE TABLE IF NOT EXISTS `ermm_erp_work_report` (
  `uid` int NOT NULL AUTO_INCREMENT COMMENT '主鍵',
  `bu_no` varchar(20) NOT NULL COMMENT '公司別',
  `mo_no` varchar(50) NOT NULL COMMENT '製造工單號',
  `op_seq` int NOT NULL COMMENT '工序順序',
  `wk_date` date NOT NULL COMMENT '報工日期',
  `xitems` varchar(100) DEFAULT NULL COMMENT '產品編號',
  `work_center` varchar(50) DEFAULT NULL COMMENT '工作中心/機台',
  `good_qty` decimal(18,4) DEFAULT '0.0000' COMMENT '良品數量',
  `scrap_qty` decimal(18,4) DEFAULT '0.0000' COMMENT '不良/報廢數量',
  `rework_qty` decimal(18,4) DEFAULT '0.0000' COMMENT '返工數量',
  `operator` varchar(50) DEFAULT NULL COMMENT '作業員',
  `shift` varchar(20) DEFAULT NULL COMMENT '班別',
  `work_hours` decimal(10,2) DEFAULT '0.00' COMMENT '工時(小時)',
  `machine_hours` decimal(10,2) DEFAULT '0.00' COMMENT '機時(小時)',
  `qc_type` varchar(100) DEFAULT NULL COMMENT '質檢類型/結果',
  `remark` text,
  `YYYY_MM` varchar(10) DEFAULT NULL COMMENT '年月(依 wk_date)',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  UNIQUE KEY `uk_report` (`bu_no`,`mo_no`,`op_seq`,`wk_date`,`shift`,`operator`),
  KEY `idx_bu_mo` (`bu_no`,`mo_no`),
  KEY `idx_bu_date` (`bu_no`,`wk_date`),
  KEY `idx_bu_ym` (`bu_no`,`YYYY_MM`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='報工/產出記錄表';

-- 記錄版本
INSERT IGNORE INTO schema_migrations (version, description) VALUES
('011_ermm_erp_mo', 'ERP 製造 4 表 — ermm_erp_mo'),
('011_ermm_erp_mo_component', 'ERP 製造 4 表 — ermm_erp_mo_component'),
('011_ermm_erp_routing', 'ERP 製造 4 表 — ermm_erp_routing'),
('011_ermm_erp_work_report', 'ERP 製造 4 表 — ermm_erp_work_report');

SET FOREIGN_KEY_CHECKS = 1;

-- 驗證
SELECT '=== Migration 011 驗證 ===' AS step;
SELECT TABLE_NAME, TABLE_COMMENT, ENGINE
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA='ERMM_db'
   AND TABLE_NAME IN ('ermm_erp_mo', 'ermm_erp_mo_component', 'ermm_erp_routing', 'ermm_erp_work_report')
 ORDER BY TABLE_NAME;
