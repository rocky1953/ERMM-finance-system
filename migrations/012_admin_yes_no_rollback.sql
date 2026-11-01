-- ============================================================
-- 012_admin_yes_no_rollback.sql
-- 回滾：Yes → 管理員（繁體，與歷史文件口徑一致），No → 普通者
-- ============================================================

UPDATE cams_xuser SET admin = '管理員' WHERE admin = 'Yes';
UPDATE cams_xuser SET admin = '普通者' WHERE admin = 'No';

ALTER TABLE cams_xuser
  MODIFY COLUMN admin VARCHAR(10) NOT NULL DEFAULT '普通者' COMMENT '管理員/普通者';
