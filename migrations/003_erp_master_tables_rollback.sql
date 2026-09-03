-- =====================================================================
-- Rollback: 003 ERP 主數據 8 表
-- ⚠️ 危險！會 DROP 8 張表的所有資料！
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `cams_system_codes`;
DROP TABLE IF EXISTS `e2_xitems_daily_status`;
DROP TABLE IF EXISTS `e2_xitems_daily_status_chart`;
DROP TABLE IF EXISTS `ermm_erp_documents`;
DROP TABLE IF EXISTS `ermm_erp_so_dn`;
DROP TABLE IF EXISTS `mgm_account_details`;
DROP TABLE IF EXISTS `monthly_items`;
DROP TABLE IF EXISTS `relation_detail`;

DELETE FROM schema_migrations WHERE version LIKE '003_%';

SET FOREIGN_KEY_CHECKS = 1;
SELECT 'Rollback 003 completed.' AS status;
