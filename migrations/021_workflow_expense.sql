-- =====================================================================
-- Migration: 021 通用审批流 + 费用报销
-- 文件:     021_workflow_expense.sql
-- 日期:     2026-11-13
-- 数据库:   MySQL 8.x / ERMM_db
-- 表数:     7 张（工作流 4 张 + 费用报销 2 张 + 日志关联沿用 wf_log）
-- 目的:     提供可复用的审批流引擎，并落地费用报销闭环
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 流程定义：steps_json 为步骤数组
CREATE TABLE IF NOT EXISTS `wf_process` (
  `id` int NOT NULL AUTO_INCREMENT,
  `proc_code` varchar(50) NOT NULL COMMENT '流程编码',
  `proc_name` varchar(100) NOT NULL COMMENT '流程名称',
  `business_type` varchar(50) NOT NULL COMMENT '业务类型，如 EXPENSE',
  `steps_json` json NOT NULL COMMENT '步骤数组：step_no/step_name/approver_type/approver_value',
  `enabled` tinyint(1) NOT NULL DEFAULT '1' COMMENT '1=启用 0=停用',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_proc_code` (`proc_code`),
  KEY `idx_business_type` (`business_type`, `enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='审批流程定义';

-- 流程实例：一张业务单据对应一个实例
CREATE TABLE IF NOT EXISTS `wf_instance` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `proc_code` varchar(50) NOT NULL,
  `business_type` varchar(50) NOT NULL,
  `business_id` bigint NOT NULL,
  `title` varchar(200) DEFAULT NULL,
  `amount` decimal(14,2) DEFAULT '0.00',
  `applicant_id` varchar(50) NOT NULL,
  `bu_no` varchar(20) DEFAULT NULL,
  `dept` varchar(100) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/APPROVED/REJECTED/CANCELLED',
  `current_step` int NOT NULL DEFAULT '1',
  `total_steps` int NOT NULL DEFAULT '0',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_business` (`business_type`, `business_id`),
  KEY `idx_applicant` (`applicant_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='审批流程实例';

-- 审批任务：同一步骤可有多个候选人（任一通过即流转）
CREATE TABLE IF NOT EXISTS `wf_task` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `instance_id` bigint NOT NULL,
  `step_no` int NOT NULL,
  `step_name` varchar(100) DEFAULT NULL,
  `approver_id` varchar(50) NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/APPROVED/REJECTED/SKIPPED',
  `action_by` varchar(50) DEFAULT NULL,
  `action_time` datetime DEFAULT NULL,
  `comment` varchar(500) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_instance` (`instance_id`, `step_no`),
  KEY `idx_approver` (`approver_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='审批任务';

-- 审批日志：提交、通过、驳回、撤回、自动跳过
CREATE TABLE IF NOT EXISTS `wf_log` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `instance_id` bigint NOT NULL,
  `step_no` int DEFAULT NULL,
  `action` varchar(20) NOT NULL COMMENT 'SUBMIT/APPROVE/REJECT/CANCEL/SKIP/PAY',
  `operator_id` varchar(50) DEFAULT NULL,
  `comment` varchar(500) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_instance` (`instance_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='审批日志';

-- 费用报销单
CREATE TABLE IF NOT EXISTS `exp_report` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `report_no` varchar(32) DEFAULT NULL COMMENT '报销单号',
  `applicant_id` varchar(50) NOT NULL,
  `applicant_name` varchar(100) DEFAULT NULL,
  `dept` varchar(100) DEFAULT NULL,
  `bu_no` varchar(20) DEFAULT NULL,
  `expense_type` varchar(50) DEFAULT NULL,
  `title` varchar(200) NOT NULL,
  `total_amount` decimal(14,2) NOT NULL DEFAULT '0.00',
  `status` varchar(20) NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT/PENDING/APPROVED/REJECTED/PAID/CANCELLED',
  `remark` varchar(500) DEFAULT NULL,
  `wf_instance_id` bigint DEFAULT NULL,
  `submit_time` datetime DEFAULT NULL,
  `approve_time` datetime DEFAULT NULL,
  `pay_time` datetime DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_report_no` (`report_no`),
  KEY `idx_applicant` (`applicant_id`),
  KEY `idx_status` (`status`),
  KEY `idx_bu` (`bu_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='费用报销单';

-- 费用报销明细
CREATE TABLE IF NOT EXISTS `exp_report_item` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `report_id` bigint NOT NULL,
  `expense_date` date DEFAULT NULL,
  `category` varchar(50) DEFAULT NULL,
  `description` varchar(300) DEFAULT NULL,
  `amount` decimal(14,2) NOT NULL DEFAULT '0.00',
  `invoice_no` varchar(100) DEFAULT NULL,
  `tax_amount` decimal(14,2) NOT NULL DEFAULT '0.00',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_report` (`report_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='费用报销明细';

-- 默认费用报销流程：部门主管 → 管理员/财务
INSERT IGNORE INTO `wf_process` (`proc_code`, `proc_name`, `business_type`, `steps_json`, `enabled`) VALUES
('EXPENSE_DEFAULT', '费用报销默认流程', 'EXPENSE',
 '[{"step_no":1,"step_name":"部门主管审批","approver_type":"dept_manager","approver_value":null},{"step_no":2,"step_name":"财务审批","approver_type":"admin","approver_value":null}]',
 1);

-- 费用类型码表
INSERT IGNORE INTO `cams_system_codes` (`code_type`, `code_value`, `value_description`, `inuse_flag`, `sort_order`) VALUES
('EXPENSE_TYPE', 'TRAVEL', '差旅费', 'USE', 10),
('EXPENSE_TYPE', 'TRANSPORT', '交通费', 'USE', 20),
('EXPENSE_TYPE', 'ENTERTAIN', '业务招待费', 'USE', 30),
('EXPENSE_TYPE', 'OFFICE', '办公费', 'USE', 40),
('EXPENSE_TYPE', 'OTHER', '其他费用', 'USE', 90);

-- 记录版本
INSERT IGNORE INTO schema_migrations (version, description) VALUES
('021_wf_process', '审批流程定义 — wf_process'),
('021_wf_instance', '审批流程实例 — wf_instance'),
('021_wf_task', '审批任务 — wf_task'),
('021_wf_log', '审批日志 — wf_log'),
('021_exp_report', '费用报销单 — exp_report'),
('021_exp_report_item', '费用报销明细 — exp_report_item');

SET FOREIGN_KEY_CHECKS = 1;

SELECT '=== Migration 021 验证 ===' AS step;
SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES
 WHERE TABLE_SCHEMA='ERMM_db'
   AND TABLE_NAME IN ('wf_process','wf_instance','wf_task','wf_log','exp_report','exp_report_item');
