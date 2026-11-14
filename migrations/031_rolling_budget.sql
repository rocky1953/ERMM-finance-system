-- 031 滚动预算与三表联动（CFO-05）
-- 12 个月滚动预算，损益表 / 资产负债表 / 现金流量表联动；13 周现金预测

SET NAMES utf8mb4;

-- ===== 滚动预算假设 =====
CREATE TABLE IF NOT EXISTS rolling_budget_assumption (
  uid                 int             NOT NULL AUTO_INCREMENT,
  bu_no               varchar(20)     NOT NULL,
  base_month          varchar(7)      DEFAULT NULL COMMENT '预测基准月 YYYY-MM（默认取最新实际月）',
  months              int             NOT NULL DEFAULT 12 COMMENT '滚动期数（月）',
  revenue_growth      decimal(8,4)    NOT NULL DEFAULT 0.0100 COMMENT '月收入增长率',
  cost_ratio          decimal(8,4)    NOT NULL DEFAULT 0.5869 COMMENT '销售成本率',
  tax_rate            decimal(8,4)    NOT NULL DEFAULT 0.1500 COMMENT '所得税率',
  ar_days             int             NOT NULL DEFAULT 60 COMMENT '应收账款天数',
  ap_days             int             NOT NULL DEFAULT 45 COMMENT '应付账款天数',
  inv_days            int             NOT NULL DEFAULT 60 COMMENT '存货周转天数',
  capex_monthly       decimal(18,2)   NOT NULL DEFAULT 0.00 COMMENT '每月资本支出',
  loan_repay_monthly  decimal(18,2)   NOT NULL DEFAULT 0.00 COMMENT '每月还本金额',
  update_by           varchar(50)     DEFAULT NULL,
  update_time         datetime        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (uid),
  UNIQUE KEY uk_bu (bu_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='滚动预算假设';

-- ===== 模块权限登记 =====
INSERT INTO cams_module_permission (module_code, module_name, module_group, allow_general, allow_operator, allow_admin, sort_order) VALUES
('rollingBudget', '滚动预算', '经营决策', 0, 1, 1, 12)
ON DUPLICATE KEY UPDATE module_name=VALUES(module_name), module_group=VALUES(module_group);

-- ===== schema_migrations =====
INSERT INTO schema_migrations (version, applied_at, description) VALUES
('031_rolling_budget', NOW(), '滚动预算与三表联动（CFO-05）')
ON DUPLICATE KEY UPDATE applied_at=NOW();

SELECT '✅ 031 滚动预算迁移完成' AS result;
