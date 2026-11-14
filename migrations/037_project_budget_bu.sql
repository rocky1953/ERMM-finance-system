-- 037 项目预算按公司别
-- project_budget 增加 bu_no，预算唯一键由 (project_id, year) 调整为 (bu_no, project_id, year)
-- 存量预算默认归属 HM，如实际属于其他公司别需在页面重新维护

SET NAMES utf8mb4;

-- 幂等加列助手：MySQL 8 不支持 ADD COLUMN IF NOT EXISTS
DROP PROCEDURE IF EXISTS sp_add_column;
DELIMITER $$
CREATE PROCEDURE sp_add_column(
    IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_definition TEXT)
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME   = p_table
                      AND COLUMN_NAME  = p_column) THEN
        SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN ', p_definition);
        PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
    END IF;
END$$
DELIMITER ;

CALL sp_add_column('project_budget', 'bu_no',
  '`bu_no` varchar(20) NOT NULL DEFAULT ''HM'' COMMENT ''公司别'' AFTER `uid`');

DROP PROCEDURE IF EXISTS sp_add_column;

-- 删除旧的 (project_id, year) 唯一键
SET @has_old = (SELECT COUNT(1) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME   = 'project_budget'
                   AND INDEX_NAME   = 'uk_proj_year');
SET @ddl = IF(@has_old > 0, 'ALTER TABLE `project_budget` DROP INDEX `uk_proj_year`', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 新增 (bu_no, project_id, year) 唯一键
SET @has_new = (SELECT COUNT(1) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME   = 'project_budget'
                   AND INDEX_NAME   = 'uk_bu_proj_year');
SET @ddl = IF(@has_new = 0,
  'ALTER TABLE `project_budget` ADD UNIQUE KEY `uk_bu_proj_year` (`bu_no`, `project_id`, `year`)',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO schema_migrations (version, applied_at, description) VALUES
('037_project_budget_bu', NOW(), '项目预算按公司别（bu_no + 项目 + 年度唯一）')
ON DUPLICATE KEY UPDATE applied_at=NOW();

SELECT '✅ 037 项目预算按公司别迁移完成' AS result;
