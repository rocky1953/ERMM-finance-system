-- =====================================================================
-- Rollback: 004 系統配置 6 表
-- ⚠️ 危險！會 DROP 6 張表的所有資料！
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `branch_detail`;
DROP TABLE IF EXISTS `cams_batch_control`;
DROP TABLE IF EXISTS `cams_xuser`;
DROP TABLE IF EXISTS `leader_user`;
DROP TABLE IF EXISTS `login_user_record`;
DROP TABLE IF EXISTS `mgm_kpi_desc`;

DELETE FROM schema_migrations WHERE version LIKE '004_%';

SET FOREIGN_KEY_CHECKS = 1;
SELECT 'Rollback 004 completed.' AS status;
