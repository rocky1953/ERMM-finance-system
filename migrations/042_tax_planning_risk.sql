-- 042 税务筹划与税务风险（CFO-07）
-- 1. tax_preference：税收优惠适用登记（applicable NULL = 系统自动判定）
-- 2. 模块权限：经营决策组「税务筹划/风险」

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `tax_preference` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `bu_no` varchar(10) NOT NULL COMMENT '公司别',
  `tax_year` varchar(4) NOT NULL COMMENT '纳税年度 YYYY',
  `policy_code` varchar(40) NOT NULL COMMENT '优惠政策代码',
  `policy_name` varchar(100) NOT NULL COMMENT '优惠政策名称',
  `category` varchar(30) DEFAULT NULL COMMENT 'CIT/VAT/SURCHARGE',
  `applicable` tinyint DEFAULT NULL COMMENT 'NULL=自动判定 1=适用 0=不适用',
  `est_benefit` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '预计节税金额（RMB）',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '1=启用 0=停用',
  `note` varchar(500) DEFAULT NULL COMMENT '备注',
  `updated_by` varchar(50) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  UNIQUE KEY `uk_bu_year_policy` (`bu_no`,`tax_year`,`policy_code`),
  KEY `idx_bu_year` (`bu_no`,`tax_year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='税收优惠适用登记';

-- 模块权限：经营决策组，一般角色默认不可见
INSERT INTO cams_module_permission
  (module_code, module_name, module_group, allow_general, allow_operator, allow_admin, sort_order)
VALUES
  ('taxPlanning', '税务筹划/风险', '经营决策', 0, 1, 1, 64)
ON DUPLICATE KEY UPDATE
  module_name=VALUES(module_name), module_group=VALUES(module_group),
  allow_general=VALUES(allow_general), allow_operator=VALUES(allow_operator), allow_admin=VALUES(allow_admin);

INSERT INTO schema_migrations (version, applied_at, description) VALUES
('042_tax_planning_risk', NOW(), '税务筹划与税务风险（CFO-07）')
ON DUPLICATE KEY UPDATE applied_at=NOW();

SELECT '✅ 042 税务筹划与税务风险迁移完成' AS result;
