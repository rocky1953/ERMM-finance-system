-- 045 投资与资本配置决策（CEO-03）
-- 1. investment_project：投资项目主档（类别、投资额、折现率、期限、状态）
-- 2. investment_cashflow：项目分年度计划/实际现金流（用于 NPV/IRR/回收期与投后跟踪）
-- 3. investment_budget：年度资本预算上限（按公司别），用于资本配置额度对比

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `investment_project` (
  `project_id` int NOT NULL AUTO_INCREMENT,
  `project_code` varchar(32) DEFAULT NULL COMMENT '项目编号',
  `project_name` varchar(150) NOT NULL COMMENT '项目名称',
  `bu_no` varchar(10) NOT NULL DEFAULT 'GROUP' COMMENT 'GROUP=集团，否则 HM/HN/SZ',
  `category` varchar(20) NOT NULL DEFAULT 'OTHER' COMMENT 'CAPACITY/EQUIPMENT/RD/IT/MA/OTHER',
  `fiscal_year` varchar(4) NOT NULL COMMENT '立项年度 YYYY',
  `start_month` varchar(7) DEFAULT NULL COMMENT '预计开工 YYYY-MM',
  `horizon_years` int NOT NULL DEFAULT 5 COMMENT '现金流年数',
  `discount_rate` decimal(6,2) NOT NULL DEFAULT '8.00' COMMENT '折现率（%）',
  `initial_investment` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '初始投资额',
  `salvage_value` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '期末残值',
  `annual_cashflow` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '等额年净现金流（用于快速建流）',
  `status` varchar(20) NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT/REVIEW/APPROVED/IN_PROGRESS/COMPLETED/ON_HOLD/REJECTED',
  `priority` int NOT NULL DEFAULT '0' COMMENT '决策优先级，数字越小越优先',
  `owner_id` varchar(50) DEFAULT NULL COMMENT '项目负责人',
  `department` varchar(100) DEFAULT NULL COMMENT '责任部门',
  `remark` varchar(500) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`project_id`),
  KEY `idx_year_bu` (`fiscal_year`,`bu_no`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='投资项目主档';

CREATE TABLE IF NOT EXISTS `investment_cashflow` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `year_index` int NOT NULL COMMENT '第 N 年（1 起）',
  `planned_amount` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '计划净现金流',
  `actual_amount` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '实际净现金流（投后跟踪）',
  `note` varchar(200) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  UNIQUE KEY `uk_project_year` (`project_id`,`year_index`),
  CONSTRAINT `fk_inv_cf_project` FOREIGN KEY (`project_id`) REFERENCES `investment_project`(`project_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='投资项目分年度现金流';

CREATE TABLE IF NOT EXISTS `investment_budget` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `fiscal_year` varchar(4) NOT NULL COMMENT '年度 YYYY',
  `bu_no` varchar(10) NOT NULL DEFAULT 'GROUP' COMMENT 'GROUP=集团，否则 HM/HN/SZ',
  `budget_amount` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '年度资本预算上限',
  `note` varchar(200) DEFAULT NULL,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  UNIQUE KEY `uk_year_bu` (`fiscal_year`,`bu_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='年度资本预算';

-- 模块权限：经营决策组，一般角色默认不可见
INSERT INTO cams_module_permission
  (module_code, module_name, module_group, allow_general, allow_operator, allow_admin, sort_order)
VALUES
  ('investment', '投资与资本配置', '经营决策', 0, 1, 1, 67)
ON DUPLICATE KEY UPDATE
  module_name=VALUES(module_name), module_group=VALUES(module_group),
  allow_general=VALUES(allow_general), allow_operator=VALUES(allow_operator), allow_admin=VALUES(allow_admin);

INSERT INTO schema_migrations (version, applied_at, description) VALUES
('045_investment_capital', NOW(), '投资与资本配置决策（CEO-03）')
ON DUPLICATE KEY UPDATE applied_at=NOW();

SELECT '✅ 045 投资与资本配置迁移完成' AS result;
