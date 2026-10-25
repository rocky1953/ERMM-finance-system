-- =====================================================================
-- Migration: 009 回滾
-- =====================================================================
SET NAMES utf8mb4;

DROP TABLE IF EXISTS `bonus_details`;

ALTER TABLE `iit_withholding_batches`
  DROP COLUMN `bonus_mode`;

ALTER TABLE `iit_withholding_details`
  DROP COLUMN `bonus_amount`,
  DROP COLUMN `bonus_tax`,
  DROP COLUMN `bonus_method`;

DELETE FROM schema_migrations WHERE version LIKE '009_%';

SELECT '=== Migration 009 已回滾 ===' AS step;
