-- ============================================================================
-- 049 备份恢复：backup_log
-- ----------------------------------------------------------------------------
-- 记录每次数据库备份的元数据（文件名 / 大小 / 状态 / 恢复标记）。
-- 与 scripts/backup.js 配合，支持：每日自动备份 / 手动触发 / 恢复操作。
-- ============================================================================

CREATE TABLE IF NOT EXISTS backup_log (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    backup_type ENUM('AUTO','MANUAL','RESTORE') NOT NULL DEFAULT 'MANUAL',
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(512) NOT NULL,
    file_size BIGINT UNSIGNED DEFAULT NULL,
    status ENUM('RUNNING','SUCCESS','FAILED','RESTORED') NOT NULL DEFAULT 'RUNNING',
    started_at DATETIME NOT NULL,
    finished_at DATETIME DEFAULT NULL,
    duration_ms INT UNSIGNED DEFAULT NULL,
    error_message VARCHAR(1024) DEFAULT NULL,
    remark VARCHAR(512) DEFAULT NULL,
    triggered_by VARCHAR(64) DEFAULT NULL,
    restored_from_id INT UNSIGNED DEFAULT NULL,
    INDEX idx_type_status (backup_type, status),
    INDEX idx_started (started_at),
    INDEX idx_file (file_name(64))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='数据库备份记录';

-- 首次导入迁移标记（兼容既有迁移框架）
INSERT INTO schema_migrations (version, applied_at, description) VALUES
('049_backup_log', NOW(), 'CTO-04 备份恢复：backup_log')
ON DUPLICATE KEY UPDATE applied_at=NOW();
