-- ============================================================================
-- 060 在「系统文件」分组新增「服务器更新手册」模组权限
-- ----------------------------------------------------------------------------
-- 背景：新增 /docs/ops-guide 静态文档页（Ubuntu 服务器更新操作手册），
--       需登记到功能权限矩阵，否则「功能权限」页面看不到该模组。
-- 口径：与同分组文件一致 —— 仅管理员可见（0, 0, 1）。
-- ============================================================================

INSERT INTO cams_module_permission
  (module_code, module_name, module_group, allow_general, allow_operator, allow_admin, sort_order)
VALUES
  ('docOpsGuide', '服务器更新手册', '系统文件', 0, 0, 1, 65)
ON DUPLICATE KEY UPDATE
  module_name=VALUES(module_name),
  module_group=VALUES(module_group),
  allow_general=VALUES(allow_general),
  allow_operator=VALUES(allow_operator),
  allow_admin=VALUES(allow_admin),
  sort_order=VALUES(sort_order),
  update_time=NOW();

INSERT INTO schema_migrations (version, applied_at, description) VALUES
('060_doc_ops_guide_permission', NOW(), '系統文件分組新增伺服器更新手冊模組權限')
ON DUPLICATE KEY UPDATE applied_at=NOW();

SELECT module_group, module_code, module_name, allow_general, allow_operator, allow_admin, sort_order
FROM cams_module_permission
WHERE module_code = 'docOpsGuide';
