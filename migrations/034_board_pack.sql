-- 034 董事会 / 投资人报告包（CEO-02）
-- 记录每次生成的经营报告包快照，保证报告可追溯到当月报表数据
-- 报表本体来自 mgm_finance_summary / group_target / alert_log，不新建重复事实表

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS board_pack (
  uid           int           NOT NULL AUTO_INCREMENT,
  bu_no         varchar(20)   NOT NULL DEFAULT 'GROUP' COMMENT 'GROUP 或 BU 编码',
  YYYY_MM       char(7)       NOT NULL COMMENT '报告基准月（季报为季末月）',
  period_type   varchar(10)   NOT NULL DEFAULT 'month' COMMENT 'month / quarter',
  title         varchar(120)  NOT NULL DEFAULT '' COMMENT '报告标题',
  summary       text                   COMMENT '报告摘要（JSON 快照）',
  generated_by  varchar(50)   DEFAULT NULL,
  created_at    datetime      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (uid),
  KEY idx_bu_ym (bu_no, YYYY_MM),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='董事会报告包生成记录';

-- 模块权限登记（经营决策分组）
INSERT INTO cams_module_permission
  (module_code, module_name, module_group, allow_general, allow_operator, allow_admin, sort_order)
SELECT 'boardPack', '董事会报告包', '经营决策', 1, 1, 1, 16
WHERE NOT EXISTS (SELECT 1 FROM cams_module_permission WHERE module_code='boardPack');

-- ===== schema_migrations =====
INSERT INTO schema_migrations (version, applied_at, description) VALUES
('034_board_pack', NOW(), '董事会/投资人报告包（CEO-02）')
ON DUPLICATE KEY UPDATE applied_at=NOW();

SELECT '✅ 034 董事会报告包迁移完成' AS result;
