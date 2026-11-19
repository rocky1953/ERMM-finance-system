-- 047 三项补强
-- 1. CFO-01 借支 / 预支与核销：exp_advance、exp_advance_settle
-- 2. CFO-02 付款排程 / 银行回单 / AR·AP 核销：pay_request 扩展字段、pay_writeoff
-- 3. CEO-05 组织人效：部门编制表 hr_headcount_plan

SET NAMES utf8mb4;

-- =====================================================================
-- 1. CFO-01 借支 / 预支与核销
-- =====================================================================
CREATE TABLE IF NOT EXISTS `exp_advance` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `advance_no` varchar(32) DEFAULT NULL COMMENT '借支单号',
  `applicant_id` varchar(50) NOT NULL,
  `applicant_name` varchar(100) DEFAULT NULL,
  `dept` varchar(100) DEFAULT NULL,
  `bu_no` varchar(20) DEFAULT NULL,
  `advance_type` varchar(30) NOT NULL DEFAULT 'GENERAL' COMMENT 'TRAVEL/GENERAL/PETTY',
  `title` varchar(200) NOT NULL COMMENT '借支事由',
  `amount` decimal(14,2) NOT NULL DEFAULT '0.00' COMMENT '借支金额',
  `expected_return_date` date DEFAULT NULL COMMENT '预计报销/归还日',
  `paid_date` date DEFAULT NULL COMMENT '实际拨付日',
  `settled_amount` decimal(14,2) NOT NULL DEFAULT '0.00' COMMENT '已核销金额',
  `balance` decimal(14,2) NOT NULL DEFAULT '0.00' COMMENT '未核销余额',
  `status` varchar(20) NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT/PENDING/APPROVED/PAID/REJECTED/CANCELLED/SETTLED',
  `wf_instance_id` bigint DEFAULT NULL,
  `remark` varchar(500) DEFAULT NULL,
  `submit_time` datetime DEFAULT NULL,
  `approve_time` datetime DEFAULT NULL,
  `pay_time` datetime DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_advance_no` (`advance_no`),
  KEY `idx_adv_applicant` (`applicant_id`),
  KEY `idx_adv_status` (`status`),
  KEY `idx_adv_bu` (`bu_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='借支申请单';

CREATE TABLE IF NOT EXISTS `exp_advance_settle` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `advance_id` bigint NOT NULL,
  `report_id` bigint DEFAULT NULL COMMENT '关联报销单 exp_report.id',
  `settle_amount` decimal(14,2) NOT NULL DEFAULT '0.00' COMMENT '本次核销金额',
  `settle_date` date NOT NULL COMMENT '核销日期',
  `operator_id` varchar(50) DEFAULT NULL,
  `note` varchar(300) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_settle_adv` (`advance_id`),
  KEY `idx_settle_report` (`report_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='借支核销明细';

INSERT INTO `wf_process` (`proc_code`, `proc_name`, `business_type`, `steps_json`, `enabled`) VALUES
('ADVANCE_DEFAULT', '借支申请默认流程', 'ADVANCE',
 '[{"step_no":1,"step_name":"部门主管审批","approver_type":"dept_manager","approver_value":null},{"step_no":2,"step_name":"财务审批","approver_type":"admin","approver_value":null}]',
 1)
ON DUPLICATE KEY UPDATE proc_name=VALUES(proc_name), steps_json=VALUES(steps_json);

INSERT INTO `cams_system_codes` (`code_type`, `code_value`, `value_description`, `inuse_flag`, `sort_order`) VALUES
('ADVANCE_TYPE', 'TRAVEL',  '差旅借支', 'USE', 10),
('ADVANCE_TYPE', 'GENERAL', '一般借支', 'USE', 20),
('ADVANCE_TYPE', 'PETTY',   '备用金',   'USE', 30)
ON DUPLICATE KEY UPDATE value_description=VALUES(value_description);

-- =====================================================================
-- 2. CFO-02 付款排程 / 银行回单 / AR·AP 核销
-- =====================================================================
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pay_request' AND COLUMN_NAME='planned_pay_date')=0,
            'ALTER TABLE pay_request ADD COLUMN planned_pay_date date DEFAULT NULL COMMENT ''排程付款日'' AFTER due_date',
            'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pay_request' AND COLUMN_NAME='bank_receipt_no')=0,
            'ALTER TABLE pay_request ADD COLUMN bank_receipt_no varchar(64) DEFAULT NULL COMMENT ''银行回单号'' AFTER pay_time',
            'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pay_request' AND COLUMN_NAME='receipt_date')=0,
            'ALTER TABLE pay_request ADD COLUMN receipt_date date DEFAULT NULL COMMENT ''回单日期'' AFTER bank_receipt_no',
            'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pay_request' AND COLUMN_NAME='receipt_amount')=0,
            'ALTER TABLE pay_request ADD COLUMN receipt_amount decimal(18,2) DEFAULT NULL COMMENT ''回单金额'' AFTER receipt_date',
            'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pay_request' AND COLUMN_NAME='receipt_bank')=0,
            'ALTER TABLE pay_request ADD COLUMN receipt_bank varchar(100) DEFAULT NULL COMMENT ''回单银行/账户'' AFTER receipt_amount',
            'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pay_request' AND COLUMN_NAME='writeoff_status')=0,
            'ALTER TABLE pay_request ADD COLUMN writeoff_status varchar(20) NOT NULL DEFAULT ''UNWRITTEN'' COMMENT ''UNWRITTEN/PARTIAL/WRITTEN'' AFTER receipt_bank',
            'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `pay_writeoff` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `request_id` bigint NOT NULL COMMENT '付款申请单 id',
  `source_type` varchar(10) NOT NULL COMMENT 'AR/AP',
  `source_uid` int NOT NULL COMMENT 'mgm_invoice_details.uid',
  `invoice_no` varchar(50) DEFAULT NULL,
  `counterparty` varchar(200) DEFAULT NULL COMMENT '客户/供应商',
  `writeoff_amount` decimal(18,2) NOT NULL DEFAULT '0.00',
  `writeoff_date` date NOT NULL,
  `operator_id` varchar(50) DEFAULT NULL,
  `note` varchar(300) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_wo_request` (`request_id`),
  KEY `idx_wo_source` (`source_type`,`source_uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='付款核销（AR/AP 匹配）';

-- =====================================================================
-- 3. CEO-05 部门编制
-- =====================================================================
CREATE TABLE IF NOT EXISTS `hr_headcount_plan` (
  `uid` int NOT NULL AUTO_INCREMENT,
  `bu_no` varchar(10) NOT NULL DEFAULT 'GROUP' COMMENT 'GROUP/HM/HN/SZ',
  `period` varchar(7) NOT NULL COMMENT '编制月份 YYYY-MM',
  `depart_name` varchar(100) NOT NULL DEFAULT '' COMMENT '部门名称',
  `plan_headcount` int NOT NULL DEFAULT '0' COMMENT '编制人数',
  `actual_headcount` int DEFAULT NULL COMMENT '实际人数（空=按人员主档统计）',
  `plan_labor_cost` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '编制人工成本',
  `actual_labor_cost` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '实际人工成本',
  `note` varchar(300) DEFAULT NULL,
  `updated_by` varchar(50) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  UNIQUE KEY `uk_headcount` (`bu_no`,`period`,`depart_name`),
  KEY `idx_hc_period` (`period`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='部门人力编制计划';

-- 2025Q4 演示编制（人工成本 = 编制人数 × 当月人均薪资 × 1.2，可重复执行）
INSERT IGNORE INTO hr_headcount_plan (bu_no, period, depart_name, plan_headcount, plan_labor_cost, note)
SELECT t.bu_no, m.period, t.depart_name, t.plan_headcount,
       ROUND(t.plan_headcount * f.avg_salary * 1.2, 2), '系统初始化编制'
FROM (
  SELECT 'HM' bu_no, '采购部' depart_name, 14 plan_headcount UNION ALL
  SELECT 'HM', '财务部', 8 UNION ALL
  SELECT 'HM', '人事部', 10 UNION ALL
  SELECT 'HM', '业务部', 24 UNION ALL
  SELECT 'HM', '资讯部', 10 UNION ALL
  SELECT 'HM', '总经理室', 8 UNION ALL
  SELECT 'HM', '仓管部', 8 UNION ALL
  SELECT 'HN', '采购部', 6 UNION ALL
  SELECT 'HN', '财务部', 4 UNION ALL
  SELECT 'HN', '人事部', 4 UNION ALL
  SELECT 'HN', '业务部', 10 UNION ALL
  SELECT 'HN', '资讯部', 4 UNION ALL
  SELECT 'HN', '总经理室', 2 UNION ALL
  SELECT 'HN', '仓管部', 3 UNION ALL
  SELECT 'SZ', '采购部', 10 UNION ALL
  SELECT 'SZ', '财务部', 5 UNION ALL
  SELECT 'SZ', '人事部', 6 UNION ALL
  SELECT 'SZ', '业务部', 12 UNION ALL
  SELECT 'SZ', '资讯部', 5 UNION ALL
  SELECT 'SZ', '总经理室', 3 UNION ALL
  SELECT 'SZ', '仓管部', 3
) t
CROSS JOIN (SELECT '2025-10' period UNION ALL SELECT '2025-11' UNION ALL SELECT '2025-12') m
JOIN mgm_finance_summary f ON f.bu_no=t.bu_no AND f.YYYY_MM=m.period;

-- 模块权限：经营决策组
INSERT INTO cams_module_permission
  (module_code, module_name, module_group, allow_general, allow_operator, allow_admin, sort_order)
VALUES
  ('hrEfficiency', '组织人效分析', '经营决策', 0, 1, 1, 69)
ON DUPLICATE KEY UPDATE
  module_name=VALUES(module_name), module_group=VALUES(module_group),
  allow_general=VALUES(allow_general), allow_operator=VALUES(allow_operator), allow_admin=VALUES(allow_admin);

-- =====================================================================
INSERT INTO schema_migrations (version, applied_at, description) VALUES
('047_hr_payment_advance', NOW(), '借支核销、付款排程/回单/核销、部门编制（CFO-01/02、CEO-05）')
ON DUPLICATE KEY UPDATE applied_at=NOW();

SELECT '✅ 047 借支/付款/编制补强迁移完成' AS result;
