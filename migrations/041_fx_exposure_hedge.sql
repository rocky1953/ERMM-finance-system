-- 041 汇率敞口与对冲（CFO-08）
-- 基础币别 RMB：敞口金额同时保留原币与折合 RMB
-- 敞口来源：手工录入 / 应付明细（pay_detail）/ 银行贷款（mgm_bank_loan_details）

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `fx_exposure_item` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `bu_no` varchar(10) NOT NULL COMMENT '公司别',
  `YYYY_MM` varchar(7) NOT NULL COMMENT '敞口月份',
  `exposure_type` varchar(20) NOT NULL DEFAULT 'OTHER' COMMENT 'AR/AP/LOAN/CASH/OTHER',
  `currency` varchar(10) NOT NULL COMMENT '原币别',
  `amount_fx` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '原币金额',
  `rate_to_rmb` decimal(18,6) NOT NULL DEFAULT '1.000000' COMMENT '1 原币 = ? RMB',
  `amount_rmb` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '折合 RMB',
  `counterparty` varchar(100) DEFAULT NULL COMMENT '交易对手/银行',
  `due_date` date DEFAULT NULL COMMENT '到期/结算日',
  `source` varchar(20) NOT NULL DEFAULT 'MANUAL' COMMENT 'MANUAL/PAYABLE/LOAN',
  `source_ref` varchar(80) DEFAULT NULL COMMENT '来源单据标识',
  `remark` varchar(500) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  KEY `idx_bu_month` (`bu_no`,`YYYY_MM`),
  KEY `idx_source` (`source`,`source_ref`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='汇率敞口明细';

CREATE TABLE IF NOT EXISTS `fx_hedge` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `bu_no` varchar(10) NOT NULL COMMENT '公司别',
  `YYYY_MM` varchar(7) NOT NULL COMMENT '所属月份',
  `hedge_type` varchar(20) NOT NULL DEFAULT 'FORWARD' COMMENT 'FORWARD/SWAP/OPTION/OTHER',
  `currency` varchar(10) NOT NULL COMMENT '被对冲币别',
  `notional_fx` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '名义本金（原币）',
  `rate_to_rmb` decimal(18,6) NOT NULL DEFAULT '1.000000' COMMENT '折算汇率',
  `amount_rmb` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '折合 RMB',
  `hedge_rate` decimal(18,6) DEFAULT NULL COMMENT '锁定汇率',
  `maturity_date` date DEFAULT NULL COMMENT '到期日',
  `counterparty` varchar(100) DEFAULT NULL COMMENT '交易对手',
  `status` varchar(20) NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE/SETTLED/CANCELLED',
  `remark` varchar(500) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  KEY `idx_bu_month` (`bu_no`,`YYYY_MM`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='汇率对冲合约';

-- 模块权限：经营决策组，一般角色默认不可见
INSERT INTO cams_module_permission
  (module_code, module_name, module_group, allow_general, allow_operator, allow_admin, sort_order)
VALUES
  ('fxExposure', '汇率敞口/对冲', '经营决策', 0, 1, 1, 63)
ON DUPLICATE KEY UPDATE
  module_name=VALUES(module_name), module_group=VALUES(module_group),
  allow_general=VALUES(allow_general), allow_operator=VALUES(allow_operator), allow_admin=VALUES(allow_admin);

INSERT INTO schema_migrations (version, applied_at, description) VALUES
('041_fx_exposure_hedge', NOW(), '汇率敞口与对冲（CFO-08）')
ON DUPLICATE KEY UPDATE applied_at=NOW();

SELECT '✅ 041 汇率敞口与对冲迁移完成' AS result;
