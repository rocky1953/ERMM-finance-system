-- =====================================================================
-- Rollback: 001 ERP PO/SO 原始單據表
-- ⚠️ 危險！會 DROP 3 張表的所有資料！
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `ermm_temp_po`;
DROP TABLE IF EXISTS `ermm_erp_po`;
DROP TABLE IF EXISTS `ermm_erp_so`;

DELETE FROM schema_migrations WHERE version LIKE '001_%';

SET FOREIGN_KEY_CHECKS = 1;
SELECT 'Rollback 001 completed.' AS status;
