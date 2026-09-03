-- =====================================================================
-- Rollback: 005 ERP 明細 3 表
-- ⚠️ 危險！會 DROP 3 張表的所有資料！
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `bh_mgm_tx_detail`;
DROP TABLE IF EXISTS `mgm_production_details`;
DROP TABLE IF EXISTS `transit_price`;

DELETE FROM schema_migrations WHERE version LIKE '005_%';

SET FOREIGN_KEY_CHECKS = 1;
SELECT 'Rollback 005 completed.' AS status;
