-- =======================================================================
-- 014  llm_config 加 is_default + provider 字段取消硬编码限制
-- =======================================================================

ALTER TABLE llm_config ADD COLUMN is_default TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = 預設使用（當前 LLM 調用以 is_default 為準）'
    AFTER status;

-- 為既有兩個 provider 先選一個當預設
UPDATE llm_config SET is_default = 1 WHERE provider = 'kimi' AND is_default = 0
  AND EXISTS (SELECT 1 FROM llm_config WHERE provider = 'kimi' AND api_key <> '');
-- 若 kimi 沒設 Key 但 deepseek 有，deepseek 當預設
UPDATE llm_config SET is_default = 1 WHERE provider = 'deepseek' AND is_default = 0
  AND api_key <> ''
  AND NOT EXISTS (SELECT 1 FROM llm_config WHERE is_default = 1 AND api_key <> '');
