-- =====================================================================
-- Rollback: 002 財務核心 8 表
-- ⚠️ 危險！會 DROP 8 張表的所有資料！
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `mgm_finance_summary`;
DROP TABLE IF EXISTS `mgm_casher_details`;
DROP TABLE IF EXISTS `mgm_invoice_details`;
DROP TABLE IF EXISTS `ermm_arap_detail`;
DROP TABLE IF EXISTS `pay_detail`;
DROP TABLE IF EXISTS `check_detail`;
DROP TABLE IF EXISTS `mgm_bank_loan_details`;
DROP TABLE IF EXISTS `forecast_detail`;

DELETE FROM schema_migrations WHERE version LIKE '002_%';

SET FOREIGN_KEY_CHECKS = 1;
SELECT 'Rollback 002 completed.' AS status;
