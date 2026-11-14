-- 035 项目损益（COO-02）
-- 项目预算、成本归集、收入确认三张表，支撑项目月度损益与预算达成
-- 收入可由「出货收入」按客户-项目映射自动引入（与 CFO-06 项目维度口径一致）

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS project_budget (
  uid            int           NOT NULL AUTO_INCREMENT,
  project_id     varchar(50)   NOT NULL,
  project_name   varchar(200)  DEFAULT NULL,
  year           smallint      NOT NULL COMMENT '预算年度',
  revenue_budget decimal(18,2) NOT NULL DEFAULT 0 COMMENT '年度收入预算',
  cost_budget    decimal(18,2) NOT NULL DEFAULT 0 COMMENT '年度成本预算',
  update_by      varchar(50)   DEFAULT NULL,
  update_time    datetime      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (uid),
  UNIQUE KEY uk_proj_year (project_id, year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目年度预算';

CREATE TABLE IF NOT EXISTS project_cost (
  uid        int           NOT NULL AUTO_INCREMENT,
  bu_no      varchar(20)   NOT NULL DEFAULT 'HM',
  project_id varchar(50)   NOT NULL,
  YYYY_MM    char(7)       NOT NULL,
  cost_type  varchar(20)   NOT NULL DEFAULT 'OTHER' COMMENT 'MATERIAL/LABOR/OUTSOURCE/TRAVEL/OTHER',
  amount     decimal(18,2) NOT NULL DEFAULT 0,
  ref_no     varchar(60)   DEFAULT NULL,
  remark     varchar(500)  DEFAULT NULL,
  created_by varchar(50)   DEFAULT NULL,
  created_at datetime      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (uid),
  KEY idx_proj_ym (project_id, YYYY_MM),
  KEY idx_bu_ym (bu_no, YYYY_MM)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目成本归集';

CREATE TABLE IF NOT EXISTS project_revenue (
  uid          int           NOT NULL AUTO_INCREMENT,
  bu_no        varchar(20)   NOT NULL DEFAULT 'HM',
  project_id   varchar(50)   NOT NULL,
  YYYY_MM      char(7)       NOT NULL,
  revenue_amt  decimal(18,2) NOT NULL DEFAULT 0,
  confirm_type varchar(10)   NOT NULL DEFAULT 'manual' COMMENT 'manual 手工确认 / auto 出货自动引入',
  ref_no       varchar(60)   DEFAULT NULL,
  remark       varchar(500)  DEFAULT NULL,
  created_by   varchar(50)   DEFAULT NULL,
  created_at   datetime      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (uid),
  KEY idx_proj_ym (project_id, YYYY_MM),
  KEY idx_bu_ym (bu_no, YYYY_MM)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目收入确认';

INSERT INTO cams_module_permission (module_code, module_name, module_group, allow_general, allow_operator, allow_admin, sort_order)
SELECT 'projectProfit', '项目损益', '经营决策', 1, 1, 1, 17
WHERE NOT EXISTS (SELECT 1 FROM cams_module_permission WHERE module_code='projectProfit');

INSERT INTO schema_migrations (version, applied_at, description) VALUES
('035_project_profit', NOW(), '项目预算/成本归集/收入确认与项目损益（COO-02）')
ON DUPLICATE KEY UPDATE applied_at=NOW();

SELECT '✅ 035 项目损益迁移完成' AS result;
