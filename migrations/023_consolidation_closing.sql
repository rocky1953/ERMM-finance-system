-- 023 关账与合并增强
-- 关账日历 + 任务清单 + 抵消分录 + 多币种折算

SET NAMES utf8mb4;

-- ===== 1. 关账日历（按公司+月份记录关账状态）=====
CREATE TABLE IF NOT EXISTS closing_calendar (
  id              bigint          NOT NULL AUTO_INCREMENT,
  bu_no           varchar(20)     NOT NULL,
  YYYY_MM         varchar(10)     NOT NULL,
  status          varchar(20)     NOT NULL DEFAULT 'OPEN' COMMENT 'OPEN/CLOSED/REOPENED',
  close_time      datetime        DEFAULT NULL,
  closed_by       varchar(50)     DEFAULT NULL,
  reopen_time     datetime        DEFAULT NULL,
  reopen_by       varchar(50)     DEFAULT NULL,
  remark          varchar(500)    DEFAULT NULL,
  create_time     datetime        DEFAULT CURRENT_TIMESTAMP,
  update_time     datetime        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_bu_month (bu_no, YYYY_MM),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='关账日历';

-- ===== 2. 关账任务模板（Checklist 项）=====
CREATE TABLE IF NOT EXISTS closing_task (
  id              bigint          NOT NULL AUTO_INCREMENT,
  task_code       varchar(50)     NOT NULL,
  task_name       varchar(200)    NOT NULL,
  category        varchar(50)     DEFAULT NULL COMMENT 'INPUT/CALC/CONSOL/REPORT',
  sort_order      int             NOT NULL DEFAULT 0,
  inuse_flag      varchar(10)     NOT NULL DEFAULT 'USE',
  description     varchar(500)    DEFAULT NULL,
  create_time     datetime        DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_code (task_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='关账任务模板';

-- ===== 3. 关账任务实例（某月某公司的实际任务）=====
CREATE TABLE IF NOT EXISTS closing_task_instance (
  id              bigint          NOT NULL AUTO_INCREMENT,
  bu_no           varchar(20)     NOT NULL,
  YYYY_MM         varchar(10)     NOT NULL,
  task_id         bigint          NOT NULL,
  status          varchar(20)     NOT NULL DEFAULT 'OPEN' COMMENT 'OPEN/DONE/NA',
  done_time       datetime        DEFAULT NULL,
  done_by         varchar(50)     DEFAULT NULL,
  remark          varchar(500)    DEFAULT NULL,
  create_time     datetime        DEFAULT CURRENT_TIMESTAMP,
  update_time     datetime        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_bu_month_task (bu_no, YYYY_MM, task_id),
  KEY idx_bu_month (bu_no, YYYY_MM),
  CONSTRAINT fk_cti_task FOREIGN KEY (task_id) REFERENCES closing_task(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='关账任务实例';

-- ===== 4. 抵消分录（内部交易明细）=====
CREATE TABLE IF NOT EXISTS consol_elimination_entry (
  id              bigint          NOT NULL AUTO_INCREMENT,
  YYYY_MM         varchar(10)     NOT NULL,
  bu_no_from      varchar(20)     NOT NULL COMMENT '交易发起方',
  bu_no_to        varchar(20)     NOT NULL COMMENT '交易接收方',
  entry_type      varchar(50)     NOT NULL COMMENT 'SALE/AR/AP/LOAN/DIVIDEND/OTHER',
  amount          decimal(18,2)   NOT NULL DEFAULT 0,
  currency        varchar(10)     NOT NULL DEFAULT 'TWD',
  rate_to_twd     decimal(14,6)   DEFAULT 1,
  amount_twd      decimal(18,2)   AS (amount * rate_to_twd) STORED COMMENT '折算新台幣',
  is_confirmed    tinyint(1)      NOT NULL DEFAULT 0,
  confirmed_by    varchar(50)     DEFAULT NULL,
  confirmed_time  datetime        DEFAULT NULL,
  remark          varchar(500)    DEFAULT NULL,
  source          varchar(50)     DEFAULT 'MANUAL',
  create_time     datetime        DEFAULT CURRENT_TIMESTAMP,
  update_time     datetime        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_month (YYYY_MM),
  KEY idx_bu_from (bu_no_from),
  KEY idx_type (entry_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='合并抵消分录';

-- ===== 5. 月度折算汇率（合并时用）=====
CREATE TABLE IF NOT EXISTS consol_exchange_rate (
  id              bigint          NOT NULL AUTO_INCREMENT,
  YYYY_MM         varchar(10)     NOT NULL,
  currency        varchar(10)     NOT NULL,
  rate_to_twd     decimal(14,6)   NOT NULL COMMENT '对新台幣匯率（期末或平均）',
  rate_to_usd     decimal(14,6)   DEFAULT NULL,
  rate_type       varchar(20)     DEFAULT 'AVG' COMMENT 'AVG/END/OPEN',
  source          varchar(50)     DEFAULT 'MANUAL',
  create_time     datetime        DEFAULT CURRENT_TIMESTAMP,
  update_time     datetime        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_month_curr (YYYY_MM, currency)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='合并月度折算汇率';

-- ===== 种子：关账任务模板 =====
INSERT INTO closing_task (task_code, task_name, category, sort_order, inuse_flag, description) VALUES
('INPUT_AR',     '應收帳款確認與核銷',     'INPUT', 1, 'USE', '核對應收帳款餘額、確認收回、核銷壞帳'),
('INPUT_AP',     '應付帳款確認與入帳',     'INPUT', 2, 'USE', '核對應付帳款餘額、確認入帳、預提費用'),
('INPUT_INV',    '存貨盤點與跌價測試',     'INPUT', 3, 'USE', '存貨盤點、報廢、跌價損失確認'),
('INPUT_PAY',    '薪資/獎金/費用確認',     'INPUT', 4, 'USE', '薪資、獎金、勞健保、費用報銷確認入帳'),
('INPUT_TAX',    '稅金計提與申報確認',     'INPUT', 5, 'USE', '營業稅、所得稅、預扣稅金計提與申報核對'),
('CALC_DEPR',    '折舊與攤銷計提',         'CALC',  6, 'USE', '固定資產折舊、無形資產攤銷計算'),
('CALC_INT',     '利息收入/費用計提',      'CALC',  7, 'USE', '銀行存款利息、貸款利息計提'),
('CALC_FX',      '外幣換算損益計算',       'CALC',  8, 'USE', '外幣資產負債期末換算、已實現損益確認'),
('CALC_CLOSING', '收益/費用結轉',          'CALC',  9, 'USE', '損益科目結轉、本期損益確認'),
('CONSOL_ELIM',  '內部交易沖銷',           'CONSOL',10, 'USE', '集團內部銷售/往來/貸款/股利等抵消分錄'),
('CONSOL_FX',    '多幣別折算',             'CONSOL',11, 'USE', '國外子公司報表按期末匯率折算'),
('CONSOL_CHECK', '合併報表勾稽核對',       'CONSOL',12, 'USE', '合併報表資產=負債+股東權益、損益表與資產負債表勾稽'),
('REPORT_PUBLISH','董事會/管理層報告',      'REPORT',13, 'USE', '合併三表、KPI說明、經營摘要整理');

-- ===== 种子：汇率快照（用当前码表的汇率作为历史快照）=====
INSERT INTO consol_exchange_rate (YYYY_MM, currency, rate_to_twd, rate_to_usd, rate_type, source)
SELECT '2025-12', code_value, value_number1, NULL, 'AVG', 'CURRENCY_CODE'
FROM cams_system_codes WHERE code_type='CURRENCY' AND inuse_flag='USE'
ON DUPLICATE KEY UPDATE rate_to_twd=VALUES(rate_to_twd);

-- ===== schema_migrations =====
INSERT INTO schema_migrations (version, applied_at, description) VALUES
('023_consolidation_closing', NOW(), '关账与合并增强：日历/任务/抵消/折算');
