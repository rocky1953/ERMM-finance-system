-- 043 战略目标与平衡计分卡（CEO-01）
-- 1. bsc_objective：公司→部门→个人三级目标，按平衡计分卡四维度归类
-- 2. bsc_progress：目标月度实际值（手工录入 / 指标中心同步）

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `bsc_objective` (
  `objective_id` int NOT NULL AUTO_INCREMENT,
  `fiscal_year` varchar(4) NOT NULL COMMENT '年度 YYYY',
  `level` varchar(20) NOT NULL DEFAULT 'COMPANY' COMMENT 'COMPANY/DEPARTMENT/PERSONAL',
  `bu_no` varchar(10) NOT NULL DEFAULT 'GROUP' COMMENT 'GROUP=集团，否则 HM/HN/SZ',
  `perspective` varchar(20) NOT NULL DEFAULT 'FINANCIAL' COMMENT 'FINANCIAL/CUSTOMER/PROCESS/LEARNING',
  `objective_name` varchar(150) NOT NULL COMMENT '目标名称',
  `metric_name` varchar(100) DEFAULT NULL COMMENT '衡量指标',
  `unit` varchar(20) DEFAULT NULL COMMENT '计量单位',
  `metric_direction` varchar(10) NOT NULL DEFAULT 'UP' COMMENT 'UP=越大越好 DOWN=越小越好',
  `baseline_value` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '基线值',
  `target_value` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '目标值',
  `weight` decimal(6,2) NOT NULL DEFAULT '0.00' COMMENT '权重（%）',
  `kpi_id` varchar(50) DEFAULT NULL COMMENT '指标中心 KPI id，用于自动同步实际值',
  `scope_name` varchar(100) DEFAULT NULL COMMENT '部门/个人归属',
  `owner_id` varchar(50) DEFAULT NULL COMMENT '责任人',
  `parent_id` int DEFAULT NULL COMMENT '上级目标',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '1=启用 0=停用',
  `remark` varchar(500) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`objective_id`),
  KEY `idx_year_bu` (`fiscal_year`,`bu_no`),
  KEY `idx_parent` (`parent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='平衡计分卡目标';

CREATE TABLE IF NOT EXISTS `bsc_progress` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `objective_id` int NOT NULL COMMENT '目标 ID',
  `period` varchar(7) NOT NULL COMMENT '期间 YYYY-MM',
  `actual_value` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '实际值',
  `source` varchar(20) NOT NULL DEFAULT 'MANUAL' COMMENT 'MANUAL=手工 KPI=指标中心',
  `note` varchar(500) DEFAULT NULL,
  `created_by` varchar(50) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  UNIQUE KEY `uk_objective_period` (`objective_id`,`period`),
  KEY `idx_period` (`period`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='平衡计分卡目标进度';

-- 模块权限：经营决策组，一般角色默认不可见
INSERT INTO cams_module_permission
  (module_code, module_name, module_group, allow_general, allow_operator, allow_admin, sort_order)
VALUES
  ('strategy', '战略目标/平衡计分卡', '经营决策', 0, 1, 1, 65)
ON DUPLICATE KEY UPDATE
  module_name=VALUES(module_name), module_group=VALUES(module_group),
  allow_general=VALUES(allow_general), allow_operator=VALUES(allow_operator), allow_admin=VALUES(allow_admin);

INSERT INTO schema_migrations (version, applied_at, description) VALUES
('043_strategy_bsc', NOW(), '战略目标与平衡计分卡（CEO-01）')
ON DUPLICATE KEY UPDATE applied_at=NOW();

SELECT '✅ 043 战略目标与平衡计分卡迁移完成' AS result;
