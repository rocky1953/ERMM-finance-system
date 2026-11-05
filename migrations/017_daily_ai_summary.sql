-- ===== C-1 每日 AI 摘要存储表 =====
-- 每天定时 / 手动触发，LLM 生成自然语言摘要后存于此表
-- 前端仪表板读取最新一条展示

CREATE TABLE IF NOT EXISTS daily_ai_summary (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    summary_date DATE NOT NULL COMMENT '摘要覆盖的财务期间（通常是昨天或最新月末）',
    generated_time DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '生成时间',
    period_label VARCHAR(20) COMMENT '期间标签，如 2025-12 / 2026-Q1',
    source_modules VARCHAR(200) COMMENT '本次摘要覆盖的数据源模块，逗号分隔',
    trigger_type VARCHAR(20) DEFAULT 'auto' COMMENT 'auto(定时) / manual(手动) / api(API)',
    provider VARCHAR(50) COMMENT 'LLM 服务商',
    model VARCHAR(50) COMMENT 'LLM 模型',

    -- 结构化数据（JSON，前端可直接用）
    data_json JSON COMMENT '聚合的财务快照 + YoY + 现金水位 + 风险评分 + 同业位置',

    -- LLM 输出
    title VARCHAR(200) COMMENT 'AI 生成的标题',
    content TEXT NOT NULL COMMENT 'AI 生成的自然语言摘要正文',
    alerts_json JSON COMMENT 'AI 标记的异常/预警条目列表',
    actions_json JSON COMMENT 'AI 建议的行动项列表',

    -- 元数据
    xuser_id VARCHAR(50) COMMENT '手动触发时的用户 ID',
    xuser_name VARCHAR(100) COMMENT '手动触发时的用户名',
    duration_ms INT COMMENT '生成耗时',
    is_active TINYINT DEFAULT 1,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_date (summary_date),
    INDEX idx_time (generated_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='每日 AI 执行摘要';
