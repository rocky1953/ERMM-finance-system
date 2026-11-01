-- ============================================================
-- 012_admin_yes_no.sql
-- cams_xuser.admin 欄位值標準化：中文「管理員/管理员」→ 'Yes'，其餘 → 'No'
-- 目的：消除簡繁體混雜導致的權限誤判，前後端統一以 Yes/No 判斷管理員身份
-- 執行方式：node 環境或 mysql 直接執行；執行後需重新登入（JWT 內 admin 為登入時快照）
-- ============================================================

-- 管理員（兼容舊值：繁體、簡體、大小寫 Yes）
UPDATE cams_xuser SET admin = 'Yes'
 WHERE admin IN ('管理員', '管理员', 'YES', 'yes');

-- 其餘一律為普通者
UPDATE cams_xuser SET admin = 'No'
 WHERE admin <> 'Yes';

-- 欄位預設值與註解同步調整
ALTER TABLE cams_xuser
  MODIFY COLUMN admin VARCHAR(10) NOT NULL DEFAULT 'No' COMMENT 'Yes=管理員/No=普通者';
