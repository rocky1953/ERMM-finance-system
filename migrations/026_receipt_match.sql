-- 026 收款核销（AR 发票 × 收款 × 应收）
-- 收款登记单 + 核销匹配结果表
-- 匹配对象：AR Invoice (mgm_invoice_details TX_type=AR) ← Receipt (银行進帳單)

SET NAMES utf8mb4;

-- ===== 收款登记单（银行进账单）=====
-- MVP：一條 receipt 對一張 AR invoice（前端下拉選未結發票）
CREATE TABLE IF NOT EXISTS receipt_detail (
  uid             int             NOT NULL AUTO_INCREMENT,
  bu_no           varchar(20)     NOT NULL,
  client_id       varchar(100)    DEFAULT NULL COMMENT '客戶名稱',

  -- 關聯 AR 發票
  invoice_uid      int             DEFAULT NULL COMMENT 'mgm_invoice_details.uid',
  invoice_no       varchar(50)     DEFAULT NULL,
  order_id         varchar(50)     DEFAULT NULL COMMENT '銷售單號 (SO)',

  receipt_date    date            DEFAULT NULL,
  receipt_amt      decimal(18,2)   NOT NULL DEFAULT 0 COMMENT '實際收款金額',
  bank_name        varchar(100)    DEFAULT NULL,
  currency_ab      varchar(10)     DEFAULT 'TWD',
  remark           varchar(500)    DEFAULT NULL,

  create_time      datetime        DEFAULT CURRENT_TIMESTAMP,
  update_time      datetime        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (uid),
  KEY idx_inv (invoice_uid),
  KEY idx_client (client_id),
  KEY idx_bu (bu_no),
  KEY idx_date (receipt_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='收款登記單(Receipt/Bank In)';

-- ===== 收款核销匹配结果 =====
CREATE TABLE IF NOT EXISTS ar_match_result (
  id              bigint          NOT NULL AUTO_INCREMENT,
  YYYY_MM         varchar(10)     NOT NULL,
  bu_no           varchar(20)     NOT NULL,

  -- 三单标识
  invoice_uid     int             NOT NULL COMMENT 'mgm_invoice_details.uid (TX_type=AR)',
  invoice_no      varchar(50)     DEFAULT NULL,
  receipt_uid     int             DEFAULT NULL COMMENT 'receipt_detail.uid',

  client_id       varchar(100)    DEFAULT NULL,
  order_id        varchar(50)     DEFAULT NULL COMMENT 'SO 單號',

  -- 金额
  invoice_amt     decimal(18,2)   DEFAULT 0 COMMENT '發票金額(sub_amt)',
  receipt_amt     decimal(18,2)   DEFAULT 0 COMMENT '本次收款金額',
  prior_payment   decimal(18,2)   DEFAULT 0 COMMENT '已存在的 payment (mgm_invoice_details)',
  unpaid_amt      decimal(18,2)   DEFAULT 0 COMMENT '未結金額 = invoice_amt - prior_payment',
  vat_amount      decimal(18,2)   DEFAULT 0,

  -- 匹配结果
  match_status    varchar(20)     NOT NULL DEFAULT 'UNPAID' COMMENT 'UNPAID/PARTIAL/PAID_FULL/OVER_PAID',
  diff_amount     decimal(18,2)   DEFAULT 0 COMMENT '收款與發票差異',
  auto_matched    tinyint(1)      DEFAULT 1 COMMENT '1=自動, 0=手動',
  matched_by      varchar(50)     DEFAULT NULL,
  matched_time    datetime        DEFAULT NULL,

  -- 回寫 AR 發票
  receipt_settled tinyint(1)      DEFAULT 0 COMMENT '是否已回寫 mgm_invoice_details.payment',
  receipt_settle_time datetime     DEFAULT NULL,

  remark          varchar(500)    DEFAULT NULL,
  create_time     datetime        DEFAULT CURRENT_TIMESTAMP,
  update_time     datetime        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_ym (YYYY_MM),
  KEY idx_status (match_status),
  KEY idx_inv (invoice_uid),
  KEY idx_rcpt (receipt_uid),
  KEY idx_client (client_id),
  KEY idx_bu (bu_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='收款核銷匹配結果';

-- ===== 码表 =====
INSERT INTO cams_system_codes (code_type, code_value, value_description, inuse_flag, sort_order) VALUES
('AR_MATCH_STATUS', 'UNPAID',    '未收款',  'USE', 1),
('AR_MATCH_STATUS', 'PARTIAL',   '部分收款', 'USE', 2),
('AR_MATCH_STATUS', 'PAID_FULL', '已全额收', 'USE', 3),
('AR_MATCH_STATUS', 'OVER_PAID', '收款超额', 'USE', 4)
ON DUPLICATE KEY UPDATE value_description=VALUES(value_description);

-- ===== schema_migrations =====
INSERT INTO schema_migrations (version, applied_at, description) VALUES
('026_receipt_match', NOW(), '收款核销(收款登记+AR匹配结果)');

SELECT '✅ 026 收款核销 迁移完成' AS result;
