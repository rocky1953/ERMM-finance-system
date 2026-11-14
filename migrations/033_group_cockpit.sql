-- 033 集团驾驶舱增强（CEO-04）
-- 年度目标维护表；目标达成、BU 排名、外部对标与重大事项看板的数据基础
-- 说明：未维护目标时，服务层按上年实际 × 增长系数自动推导默认目标

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS group_target (
  uid           int           NOT NULL AUTO_INCREMENT,
  bu_no         varchar(20)   NOT NULL COMMENT 'BU 编码；GROUP 表示集团汇总目标',
  year          smallint      NOT NULL COMMENT '目标年度',
  kpi_code      varchar(50)   NOT NULL COMMENT 'revenue/net_profit/gross_margin/inventory_turn/ar_days',
  target_value  decimal(18,4) NOT NULL DEFAULT 0 COMMENT '年度目标值（金额/百分比/次数/天数）',
  update_by     varchar(50)   DEFAULT NULL,
  update_time   datetime      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (uid),
  UNIQUE KEY uk_bu_year_kpi (bu_no, year, kpi_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='集团驾驶舱年度目标';

-- ===== schema_migrations =====
INSERT INTO schema_migrations (version, applied_at, description) VALUES
('033_group_cockpit', NOW(), '集团驾驶舱增强（CEO-04）')
ON DUPLICATE KEY UPDATE applied_at=NOW();

SELECT '✅ 033 集团驾驶舱迁移完成' AS result;
