-- 030 多维盈利分析（CFO-06）
-- 客户 / 产品 / 渠道 / 项目 四维盈利；渠道映射可覆盖
-- 成本口径：优先料件标准成本（PO 加权均价），缺失时按公司销售成本率估算

SET NAMES utf8mb4;

-- ===== 客户渠道映射（覆盖默认规则）=====
CREATE TABLE IF NOT EXISTS sales_channel_map (
  uid             int             NOT NULL AUTO_INCREMENT,
  bu_no           varchar(20)     NOT NULL,
  client_id       varchar(100)    NOT NULL,
  channel_code    varchar(20)     NOT NULL COMMENT 'DIRECT/DEALER/EXPORT/GROUP/OTHER',
  update_by       varchar(50)     DEFAULT NULL,
  update_time     datetime        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (uid),
  UNIQUE KEY uk_bu_client (bu_no, client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客戶銷售渠道映射';

-- ===== 料件成本率（成品无标准成本时按售价×成本率估算）=====
CREATE TABLE IF NOT EXISTS profit_cost_rate (
  uid             int             NOT NULL AUTO_INCREMENT,
  bu_no           varchar(20)     NOT NULL,
  xitems          varchar(100)    NOT NULL,
  cost_rate       decimal(8,4)    NOT NULL DEFAULT 0.7000 COMMENT '成本率（0~1）',
  update_by       varchar(50)     DEFAULT NULL,
  update_time     datetime        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (uid),
  UNIQUE KEY uk_bu_item (bu_no, xitems)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='料件成本率（盈利分析用）';

-- ===== 码表 =====
INSERT INTO cams_system_codes (code_type, code_value, value_description, inuse_flag, sort_order) VALUES
('SALES_CHANNEL', 'DIRECT', '直營',   'USE', 1),
('SALES_CHANNEL', 'DEALER', '經銷',   'USE', 2),
('SALES_CHANNEL', 'EXPORT', '外銷',   'USE', 3),
('SALES_CHANNEL', 'GROUP',  '集團內', 'USE', 4),
('SALES_CHANNEL', 'OTHER',  '其他',   'USE', 5)
ON DUPLICATE KEY UPDATE value_description=VALUES(value_description);

-- ===== 模块权限登记 =====
INSERT INTO cams_module_permission (module_code, module_name, module_group, allow_general, allow_operator, allow_admin, sort_order) VALUES
('profitAnalysis', '多维盈利分析', '经营决策', 0, 1, 1, 13)
ON DUPLICATE KEY UPDATE module_name=VALUES(module_name), module_group=VALUES(module_group);

-- ===== schema_migrations =====
INSERT INTO schema_migrations (version, applied_at, description) VALUES
('030_profit_dimension', NOW(), '多维盈利分析（客户/产品/渠道/项目）')
ON DUPLICATE KEY UPDATE applied_at=NOW();

SELECT '✅ 030 多维盈利分析 迁移完成' AS result;
