-- 038 预算编制与审批
-- budget 增加币别与审批字段；budget_detail 增加唯一键；新增审批日志表

SET NAMES utf8mb4;

-- 幂等加列（MySQL 8 不支持 ADD COLUMN IF NOT EXISTS，使用动态 DDL）
SET @has = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='budget' AND COLUMN_NAME='currency');
SET @ddl = IF(@has=0, 'ALTER TABLE `budget` ADD COLUMN `currency` varchar(10) NOT NULL DEFAULT ''RMB'' COMMENT ''币别'' AFTER `budget_name`', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='budget' AND COLUMN_NAME='submitted_by');
SET @ddl = IF(@has=0, 'ALTER TABLE `budget` ADD COLUMN `submitted_by` varchar(50) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='budget' AND COLUMN_NAME='submitted_at');
SET @ddl = IF(@has=0, 'ALTER TABLE `budget` ADD COLUMN `submitted_at` datetime DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='budget' AND COLUMN_NAME='approved_by');
SET @ddl = IF(@has=0, 'ALTER TABLE `budget` ADD COLUMN `approved_by` varchar(50) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='budget' AND COLUMN_NAME='approved_at');
SET @ddl = IF(@has=0, 'ALTER TABLE `budget` ADD COLUMN `approved_at` datetime DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='budget' AND COLUMN_NAME='reject_reason');
SET @ddl = IF(@has=0, 'ALTER TABLE `budget` ADD COLUMN `reject_reason` varchar(500) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='budget' AND COLUMN_NAME='remark');
SET @ddl = IF(@has=0, 'ALTER TABLE `budget` ADD COLUMN `remark` varchar(500) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- budget_detail 唯一键：同一预算、科目、月份只保留一条，便于录入覆盖
SET @has_uk = (SELECT COUNT(1) FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'budget_detail'
                  AND INDEX_NAME = 'uk_budget_acct_month');
SET @ddl = IF(@has_uk = 0,
  'ALTER TABLE `budget_detail` ADD UNIQUE KEY `uk_budget_acct_month` (`budget_uid`,`account_code`,`YYYY_MM`)',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 审批日志
CREATE TABLE IF NOT EXISTS budget_approval_log (
  id          bigint       NOT NULL AUTO_INCREMENT,
  budget_uid  int          NOT NULL,
  action      varchar(20)  NOT NULL COMMENT 'SUBMIT/APPROVE/REJECT',
  actor       varchar(50)  DEFAULT NULL,
  reason      varchar(500) DEFAULT NULL,
  create_time datetime     DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_budget_uid (budget_uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='预算审批日志';

INSERT INTO schema_migrations (version, applied_at, description) VALUES
('038_budget_approval', NOW(), '预算编制录入与审批：币别/审批字段/唯一键/日志')
ON DUPLICATE KEY UPDATE applied_at=NOW();

SELECT '✅ 038 预算编制与审批迁移完成' AS result;
