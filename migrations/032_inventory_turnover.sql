-- 032 库存周转、库龄与呆滞处理（COO-05）
-- 库龄结构取自 e2_xitems_daily_status，周转率/周转天数取自 mgm_finance_summary
-- 呆滞清单可下发处理单，记录处置方式、责任人、时限与状态

SET NAMES utf8mb4;

-- ===== 呆滞处理单 =====
CREATE TABLE IF NOT EXISTS `inv_slow_moving_action` (
  `uid`                int           NOT NULL AUTO_INCREMENT,
  `bu_no`              varchar(20)   NOT NULL,
  `xitems`             varchar(100)  NOT NULL COMMENT '料件',
  `item_name`          varchar(200)  DEFAULT NULL COMMENT '品名',
  `stock_date`         date          DEFAULT NULL COMMENT '库龄快照日期',
  `ageing_days`        int           NOT NULL DEFAULT 0 COMMENT '库龄天数',
  `stock_value`        decimal(18,2) NOT NULL DEFAULT 0.00 COMMENT '库存金额',
  `action_type`        varchar(30)   NOT NULL DEFAULT '降价促销' COMMENT '处置方式',
  `action_qty`         decimal(18,4) NOT NULL DEFAULT 0.0000 COMMENT '处置数量',
  `expect_recover_amt` decimal(18,2) NOT NULL DEFAULT 0.00 COMMENT '预计回收金额',
  `priority`           varchar(20)   NOT NULL DEFAULT 'medium' COMMENT '优先级 low/medium/high',
  `owner`              varchar(50)   DEFAULT NULL COMMENT '责任人',
  `due_date`           date          DEFAULT NULL COMMENT '完成时限',
  `status`             varchar(20)   NOT NULL DEFAULT 'pending' COMMENT 'pending/doing/done',
  `remark`             varchar(500)  DEFAULT NULL,
  `create_by`          varchar(50)   DEFAULT NULL,
  `create_time`        datetime      DEFAULT CURRENT_TIMESTAMP,
  `update_time`        datetime      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`),
  KEY `idx_bu_item` (`bu_no`,`xitems`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='呆滞库存处理单';

-- ===== 处置方式码表 =====
INSERT INTO cams_system_codes (code_type, code_value, value_description, inuse_flag, sort_order) VALUES
('INV_DISPOSAL_TYPE', '降价促销', '折价销售 / 促销消化', 'USE', 1),
('INV_DISPOSAL_TYPE', '退货供应商', '退回供应商换货或退款', 'USE', 2),
('INV_DISPOSAL_TYPE', '报废核销', '无使用价值，报废并计提损失', 'USE', 3),
('INV_DISPOSAL_TYPE', '转用在制品', '替代用于其他在制品 / 订单', 'USE', 4),
('INV_DISPOSAL_TYPE', '暂停采购', '冻结后续采购，先消化库存', 'USE', 5),
('INV_DISPOSAL_TYPE', '调拨其他公司', '调拨至其他 BU 使用', 'USE', 6)
ON DUPLICATE KEY UPDATE value_description=VALUES(value_description), inuse_flag=VALUES(inuse_flag);

-- ===== 模块权限登记 =====
INSERT INTO cams_module_permission (module_code, module_name, module_group, allow_general, allow_operator, allow_admin, sort_order) VALUES
('inventoryTurnover', '库存周转', '经营决策', 0, 1, 1, 14)
ON DUPLICATE KEY UPDATE module_name=VALUES(module_name), module_group=VALUES(module_group);

-- ===== schema_migrations =====
INSERT INTO schema_migrations (version, applied_at, description) VALUES
('032_inventory_turnover', NOW(), '库存周转、库龄与呆滞处理（COO-05）')
ON DUPLICATE KEY UPDATE applied_at=NOW();

SELECT '✅ 032 库存周转迁移完成' AS result;
