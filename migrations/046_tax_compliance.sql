-- 046 税务与合规管理（CFO-10）
-- 1. tax_filing_task：纳税申报日历/任务（按公司、年度、所属期、税种）
-- 2. tax_compliance_item：税务合规事项清单（发票、合同、档案、关联交易、优惠备案等）
-- 3. tax_regulation：税务法规政策库（集团统一，记录影响评估与落实状态）
-- 4. 预警写入 alert_log，dedup_key = TAXC|规则|公司|年度

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `tax_filing_task` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `bu_no` varchar(10) NOT NULL COMMENT '公司别',
  `tax_year` varchar(4) NOT NULL COMMENT '纳税年度 YYYY',
  `tax_period` varchar(7) NOT NULL DEFAULT '' COMMENT '所属期 YYYY-MM',
  `tax_type` varchar(20) NOT NULL COMMENT 'VAT/CIT/IIT/SURCHARGE/STAMP_DUTY/OTHER',
  `filing_cycle` varchar(10) NOT NULL DEFAULT 'MONTHLY' COMMENT 'MONTHLY/QUARTERLY/ANNUAL',
  `due_date` date NOT NULL COMMENT '申报截止日',
  `filed_date` date DEFAULT NULL COMMENT '实际申报日',
  `status` varchar(20) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/FILED/EXEMPT（逾期由截止日推导）',
  `tax_amount` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '申报税额',
  `receipt_no` varchar(50) DEFAULT NULL COMMENT '税局受理回执号',
  `owner_id` varchar(50) DEFAULT NULL COMMENT '责任人',
  `note` varchar(500) DEFAULT NULL,
  `updated_by` varchar(50) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  UNIQUE KEY `uk_bu_year_period_type_cycle` (`bu_no`,`tax_year`,`tax_period`,`tax_type`,`filing_cycle`),
  KEY `idx_bu_year` (`bu_no`,`tax_year`),
  KEY `idx_due` (`due_date`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='纳税申报日历';

CREATE TABLE IF NOT EXISTS `tax_compliance_item` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `bu_no` varchar(10) NOT NULL COMMENT '公司别',
  `tax_year` varchar(4) NOT NULL COMMENT '纳税年度 YYYY',
  `category` varchar(30) NOT NULL COMMENT 'INVOICE/CONTRACT/ARCHIVE/RELATED_PARTY/PREFERENCE/REGISTRATION/OTHER',
  `item_name` varchar(150) NOT NULL COMMENT '合规事项名称',
  `requirement` varchar(500) DEFAULT NULL COMMENT '合规要求/依据',
  `frequency` varchar(12) NOT NULL DEFAULT 'MONTHLY' COMMENT 'MONTHLY/QUARTERLY/ANNUAL/EVENT',
  `owner_dept` varchar(50) DEFAULT NULL COMMENT '责任部门',
  `owner_id` varchar(50) DEFAULT NULL COMMENT '责任人',
  `due_date` date DEFAULT NULL COMMENT '完成期限',
  `completed_date` date DEFAULT NULL COMMENT '实际完成日',
  `status` varchar(20) NOT NULL DEFAULT 'NOT_STARTED' COMMENT 'NOT_STARTED/IN_PROGRESS/DONE/WAIVED',
  `risk_level` varchar(10) NOT NULL DEFAULT 'MEDIUM' COMMENT 'HIGH/MEDIUM/LOW',
  `evidence` varchar(500) DEFAULT NULL COMMENT '留档/证据说明',
  `note` varchar(500) DEFAULT NULL,
  `updated_by` varchar(50) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  KEY `idx_bu_year` (`bu_no`,`tax_year`),
  KEY `idx_status` (`status`),
  KEY `idx_due` (`due_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='税务合规事项';

CREATE TABLE IF NOT EXISTS `tax_regulation` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `reg_code` varchar(50) DEFAULT NULL COMMENT '法规文号',
  `title` varchar(200) NOT NULL COMMENT '法规/政策名称',
  `category` varchar(20) NOT NULL DEFAULT 'OTHER' COMMENT 'CIT/VAT/IIT/OTHER',
  `issue_org` varchar(100) DEFAULT NULL COMMENT '发文机关',
  `publish_date` date DEFAULT NULL COMMENT '发布日期',
  `effective_date` date DEFAULT NULL COMMENT '生效日期',
  `impact_level` varchar(10) NOT NULL DEFAULT 'MEDIUM' COMMENT 'HIGH/MEDIUM/LOW',
  `summary` text COMMENT '要点摘要',
  `action_required` varchar(500) DEFAULT NULL COMMENT '需采取的行动',
  `status` varchar(20) NOT NULL DEFAULT 'NEW' COMMENT 'NEW/ASSESSING/IMPLEMENTED/ARCHIVED',
  `owner_id` varchar(50) DEFAULT NULL COMMENT '跟进人',
  `note` varchar(500) DEFAULT NULL,
  `updated_by` varchar(50) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  UNIQUE KEY `uk_reg_code` (`reg_code`),
  KEY `idx_effective` (`effective_date`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='税务法规政策库';

-- 模块权限：经营决策组，一般角色默认不可见
INSERT INTO cams_module_permission
  (module_code, module_name, module_group, allow_general, allow_operator, allow_admin, sort_order)
VALUES
  ('taxCompliance', '税务与合规管理', '经营决策', 0, 1, 1, 68)
ON DUPLICATE KEY UPDATE
  module_name=VALUES(module_name), module_group=VALUES(module_group),
  allow_general=VALUES(allow_general), allow_operator=VALUES(allow_operator), allow_admin=VALUES(allow_admin);

INSERT INTO schema_migrations (version, applied_at, description) VALUES
('046_tax_compliance', NOW(), '税务与合规管理（CFO-10）')
ON DUPLICATE KEY UPDATE applied_at=NOW();

SELECT '✅ 046 税务与合规管理迁移完成' AS result;
