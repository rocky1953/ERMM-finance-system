-- ============================================================================
-- 050 可观测性：api_metric（接口调用指标）
-- ----------------------------------------------------------------------------
-- 每个 HTTP 请求一行，记录 method / path / status / ms / trace_id。
-- 由 middleware/metrics.js 在 Express 响应结束时异步写入（不阻塞主链路）。
-- 字段索引优化按路径与状态分组查询；按日、按错误、按慢请求均可快速拉取。
-- ============================================================================

CREATE TABLE IF NOT EXISTS api_metric (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    trace_id VARCHAR(32) DEFAULT NULL,
    method VARCHAR(10) NOT NULL,
    path VARCHAR(255) NOT NULL,
    status_code SMALLINT UNSIGNED NOT NULL,
    duration_ms INT UNSIGNED NOT NULL,
    user_id VARCHAR(64) DEFAULT NULL,
    created_at DATETIME NOT NULL,
    -- 便捷字段：避免 group by date(created_at) 函数索引
    created_ymd CHAR(8) NOT NULL COMMENT 'YYYYMMDD',
    INDEX idx_path_status (path(80), status_code),
    INDEX idx_ymd (created_ymd),
    INDEX idx_trace (trace_id),
    INDEX idx_slow (duration_ms, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='接口调用指标';

-- 错误追踪表：只存错误级请求（status >= 400），结构更宽，可存堆栈与请求体摘要
CREATE TABLE IF NOT EXISTS api_error (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    trace_id VARCHAR(32) NOT NULL,
    method VARCHAR(10) NOT NULL,
    path VARCHAR(255) NOT NULL,
    status_code SMALLINT UNSIGNED NOT NULL,
    duration_ms INT UNSIGNED DEFAULT NULL,
    error_message VARCHAR(1024) DEFAULT NULL,
    error_stack TEXT DEFAULT NULL,
    user_id VARCHAR(64) DEFAULT NULL,
    request_body_snippet VARCHAR(2048) DEFAULT NULL,
    response_snippet VARCHAR(2048) DEFAULT NULL,
    created_at DATETIME NOT NULL,
    created_ymd CHAR(8) NOT NULL,
    INDEX idx_trace (trace_id),
    INDEX idx_ymd_status (created_ymd, status_code),
    INDEX idx_path (path(80))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='接口错误追踪';

INSERT INTO schema_migrations (version, applied_at, description) VALUES
('050_api_metric', NOW(), 'CTO-04 可观测性：api_metric + api_error')
ON DUPLICATE KEY UPDATE applied_at=NOW();
