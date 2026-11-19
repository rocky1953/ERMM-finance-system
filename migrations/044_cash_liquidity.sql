-- 044 资金与流动性管理（CFO-09）
-- 1. cash_plan_item：月度资金计划明细（流入/流出），支持计划与实际对比
-- 2. 头寸、流动性比率、安全水位、集团资金池、贷款到期与待付款由现有财务摘要/贷款/付款申请计算
-- 3. 预警写入 alert_log，dedup_key = LIQ|规则|公司|月份

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `cash_plan_item` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `bu_no` varchar(10) NOT NULL COMMENT '公司别',
  `plan_month` varchar(7) NOT NULL COMMENT '计划月份 YYYY-MM',
  `direction` varchar(3) NOT NULL COMMENT 'IN=流入 OUT=流出',
  `item_type` varchar(30) NOT NULL COMMENT 'SALES_COLLECTION/OTHER_INFLOW/PURCHASE_PAYMENT/PAYROLL/TAX/CAPEX/LOAN_REPAY/OTHER_OUTFLOW',
  `item_name` varchar(100) NOT NULL COMMENT '计划项名称',
  `plan_amount` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '计划金额',
  `actual_amount` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '实际金额',
  `note` varchar(500) DEFAULT NULL,
  `updated_by` varchar(50) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  KEY `idx_bu_month` (`bu_no`,`plan_month`),
  KEY `idx_direction` (`direction`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='资金计划明细';

-- 模块权限：经营决策组，一般角色默认不可见
INSERT INTO cams_module_permission
  (module_code, module_name, module_group, allow_general, allow_operator, allow_admin, sort_order)
VALUES
  ('cashLiquidity', '资金与流动性管理', '经营决策', 0, 1, 1, 66)
ON DUPLICATE KEY UPDATE
  module_name=VALUES(module_name), module_group=VALUES(module_group),
  allow_general=VALUES(allow_general), allow_operator=VALUES(allow_operator), allow_admin=VALUES(allow_admin);

INSERT INTO schema_migrations (version, applied_at, description) VALUES
('044_cash_liquidity', NOW(), '资金与流动性管理（CFO-09）')
ON DUPLICATE KEY UPDATE applied_at=NOW();

SELECT '✅ 044 资金与流动性管理迁移完成' AS result;
