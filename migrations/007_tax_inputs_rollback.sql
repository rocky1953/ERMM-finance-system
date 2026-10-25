-- =====================================================================
-- Migration: 007 回滾
-- 檔案:     007_tax_inputs_rollback.sql
-- 注意:     會刪除所有人工錄入資料，執行前請先備份
-- =====================================================================
SET NAMES utf8mb4;

DROP TABLE IF EXISTS `tax_vat_adjustments`;
DROP TABLE IF EXISTS `tax_cit_inputs`;
DROP TABLE IF EXISTS `tax_cit_adjustments`;
DROP TABLE IF EXISTS `payroll_details`;

ALTER TABLE `vat_declarations` DROP COLUMN `input_tax_transfer_out`;

DELETE FROM schema_migrations WHERE version LIKE '007_%';

SELECT '=== Migration 007 已回滾 ===' AS step;
