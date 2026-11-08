-- Rollback: 020 客戶專案主檔 + 銷售預估訂單
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `mgm_preorder_lists`;
DROP TABLE IF EXISTS `mgm_customer_projects`;
DELETE FROM schema_migrations WHERE version IN ('020_mgm_customer_projects','020_mgm_preorder_lists');
SET FOREIGN_KEY_CHECKS = 1;
