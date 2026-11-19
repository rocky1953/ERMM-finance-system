-- ============================================================================
-- 059 補齊「功能模組使用權限」遺漏的新模組
-- ----------------------------------------------------------------------------
-- 背景：027 建置權限矩陣（77 模組）後，後續交付的頁面未同步登記，
--       導致「功能模塊使用權限」頁面看不到以下 4 個模組：
--         contracts  合同主檔 CTO-05（系統主檔）
--         permission 功能權限（系統主檔，僅管理員）
--         audit      操作審計 CTO-03（日常作業）
--         llmAudit   AI 治理 CTO-09（日常作業）
-- 口徑：與同分組既有模組一致
--       contracts  = 1/1/1（業務主檔，三角色可見）
--       permission = 0/0/1（僅管理員）
--       audit      = 0/1/1（操作員以上）
--       llmAudit   = 0/1/1（操作員以上，與 cams_permission_button 的 VIEW 一致）
-- ============================================================================

INSERT INTO cams_module_permission
  (module_code, module_name, module_group, allow_general, allow_operator, allow_admin, sort_order)
VALUES
  ('contracts',  '合同主档', '系统主档', 1, 1, 1, 58),
  ('permission', '功能权限', '系统主档', 0, 0, 1, 59),
  ('audit',      '操作审计', '日常作业', 0, 1, 1, 36),
  ('llmAudit',   'AI 治理',  '日常作业', 0, 1, 1, 37)
ON DUPLICATE KEY UPDATE
  module_name=VALUES(module_name),
  module_group=VALUES(module_group),
  sort_order=VALUES(sort_order),
  update_time=NOW();

INSERT INTO schema_migrations (version, applied_at, description) VALUES
('059_module_permission_sync', NOW(), '補齊合同主檔 / 功能權限 / 操作審計 / AI 治理 模組權限')
ON DUPLICATE KEY UPDATE applied_at=NOW();

SELECT module_group, module_code, module_name, allow_general, allow_operator, allow_admin, sort_order
FROM cams_module_permission
WHERE module_code IN ('contracts','permission','audit','llmAudit')
ORDER BY sort_order;
