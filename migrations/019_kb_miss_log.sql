-- ===== T-1 RAG 未命中查询日志 =====
-- 用于识别用户高频 query 没命中的情况，驱动知识库主动扩充

CREATE TABLE IF NOT EXISTS ermm_kb_miss_log (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    query VARCHAR(500) NOT NULL COMMENT '原始用户查询',
    bu_no VARCHAR(10) COMMENT '查询的 BU',
    use_llm TINYINT DEFAULT 0,
    hit_count INT DEFAULT 0 COMMENT '最终命中数（含 FULLTEXT）',
    search_words VARCHAR(500) COMMENT '切词结果（n-gram + split）',
    lang VARCHAR(10) DEFAULT 'zh-TW',
    session_id VARCHAR(100) COMMENT '前端 session_id / conv_id',
    client_ip VARCHAR(45),
    user_id VARCHAR(50),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_created (created_at),
    INDEX idx_query (query(100))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RAG 知识库未命中查询日志';
