-- =====================================================================
-- Migration: 010 回滾
-- =====================================================================
SET NAMES utf8mb4;

ALTER TABLE `cit_annual_settlements`
    DROP COLUMN `is_overridden`;

ALTER TABLE `tax_cit_inputs`
    DROP COLUMN `override_reason`,
    DROP COLUMN `cost_override`,
    DROP COLUMN `revenue_override`;

DELETE FROM schema_migrations WHERE version LIKE '010_%';

SELECT '=== Migration 010 已回滾 ===' AS step;
