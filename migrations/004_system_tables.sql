-- =====================================================================
-- Migration: 004 系統配置 6 表
-- 檔案:     004_system_tables.sql
-- 日期:     2026-09-03 04:59:05
-- 資料庫:   MySQL 8.x / ERMM_db
-- 表數:     6 張
-- 目的:     使用者 / 權限 / 批次控制 / KPI 門檻
--
-- 使用方式:
--   mysql -hlocalhost -uroot -pERMM_db < 004_system_tables.sql
--
-- 回滾:
--   mysql -hlocalhost -uroot -pERMM_db < 004_system_tables_rollback.sql
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 版本追蹤
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(50) PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    description VARCHAR(200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `branch_detail` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `bu_no` varchar(20) NOT NULL,
  `branch_id` varchar(50) NOT NULL,
  `branch_name` varchar(100) DEFAULT NULL,
  `branch_address` varchar(300) DEFAULT NULL,
  `branch_phone` varchar(50) DEFAULT NULL,
  `manager` varchar(50) DEFAULT NULL,
  `inuse_flag` varchar(10) DEFAULT 'USE',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  UNIQUE KEY `uk_bu_branch` (`bu_no`,`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='分公司表';

CREATE TABLE IF NOT EXISTS `cams_batch_control` (
  `id` int NOT NULL AUTO_INCREMENT,
  `batch_id` varchar(50) NOT NULL COMMENT '批次ID',
  `step_name` varchar(100) NOT NULL COMMENT '步驟名稱',
  `seq_SQL` int NOT NULL COMMENT '執行順序',
  `process_status` varchar(10) DEFAULT '00' COMMENT '00=完成/01=執行中/99=失敗',
  `break_point` varchar(5) DEFAULT 'N' COMMENT 'Y=中斷點',
  `start_time` datetime DEFAULT NULL,
  `end_time` datetime DEFAULT NULL,
  `error_msg` text,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_batch` (`batch_id`),
  KEY `idx_status` (`process_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='批次控制表';

CREATE TABLE IF NOT EXISTS `cams_xuser` (
  `id` int NOT NULL AUTO_INCREMENT,
  `xuser_id` varchar(50) NOT NULL COMMENT '使用者帳號',
  `xuser_password` varchar(200) NOT NULL COMMENT '加密密碼',
  `xuser_name` varchar(100) DEFAULT NULL,
  `xuser_dept` varchar(100) DEFAULT NULL,
  `client_id` varchar(50) DEFAULT NULL,
  `inuse_flag` varchar(10) DEFAULT 'USE',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `xuser_id` (`xuser_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='使用者帳號表';

CREATE TABLE IF NOT EXISTS `leader_user` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` varchar(50) NOT NULL COMMENT '使用者ID',
  `procurement` varchar(3) DEFAULT 'N',
  `sales` varchar(3) DEFAULT 'N',
  `production` varchar(3) DEFAULT 'N',
  `engineer` varchar(3) DEFAULT 'N',
  `handbook` varchar(3) DEFAULT 'N',
  `wk_plan` varchar(3) DEFAULT 'N',
  `quality` varchar(3) DEFAULT 'N',
  `document` varchar(3) DEFAULT 'N',
  `price` varchar(3) DEFAULT 'N',
  `stock` varchar(3) DEFAULT 'N',
  `finance` varchar(3) DEFAULT 'Y',
  `imex` varchar(3) DEFAULT 'N',
  `others` varchar(3) DEFAULT 'N',
  `class` varchar(3) DEFAULT '1' COMMENT '管理等級 1-5',
  `login` varchar(3) DEFAULT 'N',
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='使用者權限表';

CREATE TABLE IF NOT EXISTS `login_user_record` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` varchar(50) NOT NULL,
  `bu_no` varchar(50) DEFAULT NULL,
  `login_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `logoff_time` datetime DEFAULT NULL,
  `use_cnt` int DEFAULT '0',
  `xwebpage_id` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_login_time` (`login_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='登入紀錄表';

CREATE TABLE IF NOT EXISTS `mgm_kpi_desc` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `bu_no` varchar(20) NOT NULL,
  `KPI_id` varchar(50) NOT NULL,
  `KPI_name` varchar(100) DEFAULT NULL,
  `KPI1` decimal(18,4) DEFAULT '0.0000' COMMENT '下限',
  `KPI2` decimal(18,4) DEFAULT '0.0000' COMMENT '上限',
  `unit` varchar(20) DEFAULT NULL,
  `pct_type` varchar(5) DEFAULT NULL COMMENT 'asc/desc 判定方向',
  `KPI_value` decimal(18,4) DEFAULT '0.0000' COMMENT '當前值',
  `KPI_color` varchar(10) DEFAULT NULL COMMENT 'RED/YELLOW/GREEN',
  `remark` text,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  UNIQUE KEY `uk_bu_kpi` (`bu_no`,`KPI_id`)
) ENGINE=InnoDB AUTO_INCREMENT=41 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='KPI 門檻定義表';

-- 記錄版本
INSERT IGNORE INTO schema_migrations (version, description) VALUES
('004_branch_detail', '系統配置 6 表 — branch_detail'),
('004_cams_batch_control', '系統配置 6 表 — cams_batch_control'),
('004_cams_xuser', '系統配置 6 表 — cams_xuser'),
('004_leader_user', '系統配置 6 表 — leader_user'),
('004_login_user_record', '系統配置 6 表 — login_user_record'),
('004_mgm_kpi_desc', '系統配置 6 表 — mgm_kpi_desc');

SET FOREIGN_KEY_CHECKS = 1;

-- 驗證
SELECT '=== Migration 004 驗證 ===' AS step;
SELECT TABLE_NAME, TABLE_COMMENT, ENGINE
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA='ERMM_db'
   AND TABLE_NAME IN ('branch_detail', 'cams_batch_control', 'cams_xuser', 'leader_user', 'login_user_record', 'mgm_kpi_desc')
 ORDER BY TABLE_NAME;
