-- ============================================================================
-- 051 全量操作审计：audit_event
-- ----------------------------------------------------------------------------
-- CTO-03 统一操作审计表：所有敏感写操作的单一事实源（single source of truth）。
--   - 业务路由显式调用 services/audit.js.log() → 写入详细信息（before/after）
--   - 兜底中间件 middleware/audit.js 自动捕获未显式记录的写请求 → 只记 path+method
--   - 审批类操作继续走 wf_log（两张表互补，wf_log 偏重流程轨迹，audit_event 偏重业务对象变更）
-- 字段索引：模块+动作、单据类型+单号、用户+时间、日期分区、trace 链路
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_event (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    trace_id VARCHAR(32) DEFAULT NULL COMMENT '关联 api_metric 的 traceId（链路追踪）',
    module VARCHAR(40) NOT NULL COMMENT '模块代码：expense / payRequest / workflow / permission / codeTable ...',
    action VARCHAR(30) NOT NULL COMMENT '动作：CREATE / UPDATE / DELETE / SUBMIT / APPROVE / REJECT / LOCK / EXPORT / LOGIN',
    business_type VARCHAR(40) DEFAULT NULL COMMENT '单据类型（可选）：BX / JK / PK / PO / soCredit / ...',
    business_id VARCHAR(64) DEFAULT NULL COMMENT '单据 id 或单号',
    summary VARCHAR(500) DEFAULT NULL COMMENT '一句话摘要（中文）：便于快速筛选与前端展示',
    detail JSON DEFAULT NULL COMMENT '详细变更：{ before, after, changed_fields } 或 { ip, path, body_summary }',
    user_id VARCHAR(64) DEFAULT NULL COMMENT '操作人工号',
    user_name VARCHAR(64) DEFAULT NULL COMMENT '操作人姓名（冗余，避免联表）',
    bu_no VARCHAR(5) DEFAULT NULL COMMENT '公司',
    ip VARCHAR(64) DEFAULT NULL COMMENT '客户端 IP',
    user_agent VARCHAR(255) DEFAULT NULL,
    created_at DATETIME NOT NULL,
    created_ymd CHAR(8) NOT NULL COMMENT 'YYYYMMDD 分区',
    INDEX idx_module_action (module, action),
    INDEX idx_business (business_type, business_id),
    INDEX idx_user_time (user_id, created_at),
    INDEX idx_ymd (created_ymd),
    INDEX idx_trace (trace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CTO-03 全量操作审计';

INSERT INTO schema_migrations (version, applied_at, description) VALUES
('051_audit_event', NOW(), 'CTO-03 全量操作审计：audit_event')
ON DUPLICATE KEY UPDATE applied_at=NOW();
