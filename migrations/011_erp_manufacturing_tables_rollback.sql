-- =====================================================================
-- Rollback: 011 ERP 製造 4 表
-- ⚠️ 危險！會 DROP 4 張表的所有資料！
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `ermm_erp_work_report`;
DROP TABLE IF EXISTS `ermm_erp_routing`;
DROP TABLE IF EXISTS `ermm_erp_mo_component`;
DROP TABLE IF EXISTS `ermm_erp_mo`;

DELETE FROM schema_migrations WHERE version LIKE '011_%';

SET FOREIGN_KEY_CHECKS = 1;
SELECT 'Rollback 011 completed.' AS status;
