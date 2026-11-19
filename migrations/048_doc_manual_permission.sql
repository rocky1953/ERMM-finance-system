-- ============================================================================
-- 048 補齊「系統文件」分組遺漏的兩個手冊模組權限
-- ----------------------------------------------------------------------------
-- 背景：027 建置權限矩陣時僅登記 5 個文件頁；index.html 實際有 7 個
--       （另有 CTO / COO 操作手冊），導致「功能權限」頁面少這兩項。
-- 口徑：與現有 docArchitecture / docExecutive / docDataModel / docManualCeo /
--       docManualCfo 一致 —— 僅管理員可見（0, 0, 1）。
-- ============================================================================

INSERT INTO cams_module_permission
  (module_code, module_name, module_group, allow_general, allow_operator, allow_admin, sort_order)
VALUES
  ('docManualCto', 'CTO 手册', '系统文件', 0, 0, 1, 63),
  ('docManualCoo', 'COO 手册', '系统文件', 0, 0, 1, 64)
ON DUPLICATE KEY UPDATE
  module_name=VALUES(module_name),
  module_group=VALUES(module_group),
  allow_general=VALUES(allow_general),
  allow_operator=VALUES(allow_operator),
  allow_admin=VALUES(allow_admin),
  sort_order=VALUES(sort_order),
  update_time=NOW();

INSERT INTO schema_migrations (version, applied_at, description) VALUES
('048_doc_manual_permission', NOW(), '補齊 CTO / COO 手冊模組權限（系統文件分組）')
ON DUPLICATE KEY UPDATE applied_at=NOW();

SELECT module_group, module_code, module_name, allow_general, allow_operator, allow_admin, sort_order
FROM cams_module_permission
WHERE module_group = '系统文件'
ORDER BY sort_order;
