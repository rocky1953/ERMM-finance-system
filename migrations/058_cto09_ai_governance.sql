-- ====================================================================
-- CTO-09 AI 治理 — AI Audit + Rate Limit + 成本追蹤
-- ====================================================================
-- 建立 ermm_ai_audit（完整 LLM 呼叫審計表）
-- 擴充既有 ermm_ai_records（加 token/cost/latency）
-- 建立 cams_ai_rate_limit（每用戶每日配額）
-- ====================================================================

-- 1. LLM 呼叫完整審計表（替代 ermm_ai_records 的簡單記錄）
CREATE TABLE IF NOT EXISTS ermm_ai_audit (
    uid BIGINT AUTO_INCREMENT PRIMARY KEY,
    bu_no VARCHAR(10) NOT NULL COMMENT '公司別',
    xuser_id VARCHAR(50) NOT NULL COMMENT '呼叫者帳號',
    xuser_name VARCHAR(100) DEFAULT '',
    conversation_id VARCHAR(64) DEFAULT NULL COMMENT '對話 session id',
    provider VARCHAR(32) NOT NULL COMMENT 'LLM 服務商代碼',
    model VARCHAR(64) NOT NULL COMMENT '使用模型',
    endpoint VARCHAR(32) DEFAULT 'aiqa' COMMENT '呼叫入口：aiqa/llm/test/script...',
    system_prompt TEXT COMMENT '系統提示詞（截斷前 2000 字）',
    user_prompt TEXT COMMENT '使用者問題（截斷前 2000 字）',
    assistant_reply MEDIUMTEXT COMMENT '模型回覆（截斷前 8000 字）',
    prompt_tokens INT DEFAULT 0,
    completion_tokens INT DEFAULT 0,
    total_tokens INT DEFAULT 0,
    latency_ms INT DEFAULT 0 COMMENT '端到端延遲（毫秒）',
    cost_usd DECIMAL(10,6) DEFAULT 0 COMMENT '估算成本（USD）',
    status VARCHAR(10) NOT NULL COMMENT 'SUCCESS / FAIL / TIMEOUT',
    error_msg VARCHAR(500) DEFAULT NULL,
    ip_address VARCHAR(45) DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_time (xuser_id, created_at),
    INDEX idx_provider_time (provider, created_at),
    INDEX idx_bu_time (bu_no, created_at),
    INDEX idx_status_time (status, created_at),
    INDEX idx_conv (conversation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI LLM 呼叫完整審計日誌';

-- 2. 擴充 ermm_ai_records（既有表，新增治理欄位）
--    幂等加列：MySQL 8 不支援 ADD COLUMN IF NOT EXISTS，改用 INFORMATION_SCHEMA + 动态 DDL
SET @tbl = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ermm_ai_records');

SET @has = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ermm_ai_records' AND COLUMN_NAME = 'provider');
SET @ddl = IF(@tbl > 0 AND @has = 0, 'ALTER TABLE `ermm_ai_records` ADD COLUMN `provider` VARCHAR(32) DEFAULT NULL AFTER `xuser_name`', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ermm_ai_records' AND COLUMN_NAME = 'model');
SET @ddl = IF(@tbl > 0 AND @has = 0, 'ALTER TABLE `ermm_ai_records` ADD COLUMN `model` VARCHAR(64) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ermm_ai_records' AND COLUMN_NAME = 'total_tokens');
SET @ddl = IF(@tbl > 0 AND @has = 0, 'ALTER TABLE `ermm_ai_records` ADD COLUMN `total_tokens` INT DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ermm_ai_records' AND COLUMN_NAME = 'latency_ms');
SET @ddl = IF(@tbl > 0 AND @has = 0, 'ALTER TABLE `ermm_ai_records` ADD COLUMN `latency_ms` INT DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ermm_ai_records' AND COLUMN_NAME = 'cost_usd');
SET @ddl = IF(@tbl > 0 AND @has = 0, 'ALTER TABLE `ermm_ai_records` ADD COLUMN `cost_usd` DECIMAL(10,6) DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ermm_ai_records' AND COLUMN_NAME = 'status');
SET @ddl = IF(@tbl > 0 AND @has = 0, 'ALTER TABLE `ermm_ai_records` ADD COLUMN `status` VARCHAR(10) DEFAULT ''SUCCESS''', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ermm_ai_records' AND INDEX_NAME = 'idx_provider_time');
SET @ddl = IF(@tbl > 0 AND @has = 0, 'ALTER TABLE `ermm_ai_records` ADD INDEX `idx_provider_time` (`provider`, `created_time`)', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. LLM 成本配置表（每 provider + model 的 USD/1K tokens）
CREATE TABLE IF NOT EXISTS cams_ai_model_pricing (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    provider VARCHAR(32) NOT NULL,
    model VARCHAR(64) NOT NULL,
    input_cost_per_1k DECIMAL(10,6) DEFAULT 0 COMMENT 'USD / 1K input tokens',
    output_cost_per_1k DECIMAL(10,6) DEFAULT 0 COMMENT 'USD / 1K output tokens',
    effective_from DATE DEFAULT NULL COMMENT '生效日期，NULL = 立即生效',
    UNIQUE KEY uk_provider_model (provider, model)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI 模型計價配置';

-- 4. 每用戶每日配額表（防濫用）
CREATE TABLE IF NOT EXISTS cams_ai_rate_limit (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    scope VARCHAR(20) NOT NULL COMMENT 'user / bu / global',
    scope_key VARCHAR(64) NOT NULL COMMENT 'xuser_id / bu_no / *',
    daily_token_limit INT DEFAULT 100000,
    daily_call_limit INT DEFAULT 100,
    cost_limit_usd DECIMAL(10,4) DEFAULT 50.0000,
    status VARCHAR(10) DEFAULT 'USE' COMMENT 'USE/NOUSE',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_scope_key (scope, scope_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI 呼叫速率限制配置';

-- ==== Seeds ====

-- 模型計價表（2025 年基準，可後續調整）
INSERT IGNORE INTO cams_ai_model_pricing (provider, model, input_cost_per_1k, output_cost_per_1k) VALUES
    ('openai', 'gpt-4o',             0.0050, 0.0150),
    ('openai', 'gpt-4o-mini',        0.00015, 0.00060),
    ('openai', 'gpt-4',              0.0300, 0.0600),
    ('openai', 'gpt-3.5-turbo',      0.00050, 0.00150),
    ('kimi',   'kimi-k2.6',          0.0010, 0.0040),
    ('kimi',   'moonshot-v1-auto',   0.0050, 0.0180),
    ('deepseek', 'deepseek-chat',    0.00027, 0.00110),
    ('doubao', 'ep-xxx',             0.00080, 0.00200),
    ('aliyun', 'qwen-plus',          0.00040, 0.00120),
    ('zhipu',  'glm-4-flash',        0.00050, 0.00100),
    ('ollama', 'llama3',             0.00000, 0.00000);

-- 預設速率限制（每用戶每日）
INSERT IGNORE INTO cams_ai_rate_limit (scope, scope_key, daily_token_limit, daily_call_limit, cost_limit_usd) VALUES
    ('global', '*',  5000000, 5000, 5000.0000),
    ('bu',     'HM', 1000000, 1000, 1000.0000),
    ('bu',     'HN',  500000,  500,  500.0000),
    ('bu',     'SZ', 1000000, 1000, 1000.0000);

-- CTO-02 按鈕權限（llmAudit 模組）
INSERT INTO cams_permission_button (module_code, button_code, button_name, allow_general, allow_operator, allow_admin)
SELECT s.module_code, s.button_code, s.button_name, s.allow_general, s.allow_operator, s.allow_admin
FROM (
  SELECT 'llmAudit' AS module_code, 'VIEW' AS button_code, '查看 AI 審計' AS button_name, 0 AS allow_general, 1 AS allow_operator, 1 AS allow_admin
  UNION ALL SELECT 'llmAudit', 'EXPORT', '匯出 AI 審計', 0, 0, 1
  UNION ALL SELECT 'llmAudit', 'CONFIG', '配置 AI 治理', 0, 0, 1
) s
WHERE NOT EXISTS (
  SELECT 1 FROM cams_permission_button b
   WHERE b.module_code = s.module_code AND b.button_code = s.button_code
);

INSERT INTO schema_migrations (version, applied_at, description) VALUES
('058_cto09_ai_governance', NOW(), 'CTO-09 AI 治理：審計/配額/成本追蹤')
ON DUPLICATE KEY UPDATE applied_at = NOW();
