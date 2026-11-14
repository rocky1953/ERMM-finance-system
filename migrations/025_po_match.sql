-- 025 采购收货 + 三单匹配
-- PO 收货单 (GRN) + 三单匹配结果表
-- 匹配对象：PO ← GRN (收货) ← AP Invoice (采购发票)

SET NAMES utf8mb4;

-- ===== PO 收货单 =====
CREATE TABLE IF NOT EXISTS po_grn (
  uid             int             NOT NULL AUTO_INCREMENT,
  bu_no           varchar(20)     NOT NULL,
  po_uid          int             DEFAULT NULL COMMENT '對應 ermm_erp_po.uid',
  po_id           varchar(50)     DEFAULT NULL,
  xitems          varchar(100)    DEFAULT NULL COMMENT '料件編號',
  supplier_name   varchar(200)    DEFAULT NULL,
  grn_date        date            DEFAULT NULL,
  grn_qty         decimal(18,4)   NOT NULL DEFAULT 0 COMMENT '實際收貨數量',
  po_qty          decimal(18,4)   DEFAULT NULL COMMENT 'PO 約定數量（關聯顯示用）',
  unit_price      decimal(18,6)   DEFAULT NULL,
  grn_amount      decimal(18,2)   GENERATED ALWAYS AS (grn_qty * COALESCE(unit_price,0)) STORED,
  remark          varchar(500)    DEFAULT NULL,
  create_time     datetime        DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (uid),
  KEY idx_po (po_uid),
  KEY idx_po_id (po_id),
  KEY idx_bu (bu_no),
  KEY idx_date (grn_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='PO 收貨單(GRN)';

-- ===== PO 匹配结果（三单匹配明细）=====
CREATE TABLE IF NOT EXISTS po_match_result (
  id              bigint          NOT NULL AUTO_INCREMENT,
  YYYY_MM         varchar(10)     NOT NULL,
  bu_no           varchar(20)     NOT NULL,

  -- 三单标识
  po_uid          int             DEFAULT NULL,
  grn_uid         int             DEFAULT NULL,
  invoice_uid     int             DEFAULT NULL COMMENT 'mgm_invoice_details.uid (TX_type=AP)',

  xitems          varchar(100)    DEFAULT NULL,
  supplier_name   varchar(200)    DEFAULT NULL,

  -- 数量
  po_qty          decimal(18,4)   DEFAULT 0,
  grn_qty         decimal(18,4)   DEFAULT 0,
  invoice_qty     decimal(18,4)   DEFAULT 0,

  -- 金额（含税）
  po_amount       decimal(18,2)   DEFAULT 0,
  grn_amount      decimal(18,2)   DEFAULT 0,
  invoice_amount  decimal(18,2)   DEFAULT 0,
  vat_amount      decimal(18,2)   DEFAULT 0,

  -- 匹配结果
  match_status    varchar(20)     NOT NULL DEFAULT 'UNMATCHED' COMMENT 'UNMATCHED/PARTIAL/MATCHED/EXCESS',
  match_key       varchar(50)     DEFAULT NULL COMMENT '匹配鍵: po_id+xitems',
  diff_qty        decimal(18,4)   DEFAULT 0 COMMENT '收發票數量差異(發票-收貨)',
  diff_amount     decimal(18,2)   DEFAULT 0 COMMENT '收發票金額差異(發票-收貨)',
  auto_matched    tinyint(1)      DEFAULT 0 COMMENT '1=自動匹配, 0=手動',
  matched_by      varchar(50)     DEFAULT NULL,
  matched_time    datetime        DEFAULT NULL,

  -- 后续 AP 核销
  ap_settled      tinyint(1)      DEFAULT 0 COMMENT '是否已生成/對應應付款',
  ap_pay_uid      int             DEFAULT NULL COMMENT 'pay_detail.uid 關聯',

  remark          varchar(500)    DEFAULT NULL,
  create_time     datetime        DEFAULT CURRENT_TIMESTAMP,
  update_time     datetime        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ym (YYYY_MM),
  KEY idx_status (match_status),
  KEY idx_po (po_uid),
  KEY idx_grn (grn_uid),
  KEY idx_inv (invoice_uid),
  KEY idx_bu (bu_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='PO 三單匹配結果';

-- ===== 码表 =====
INSERT INTO cams_system_codes (code_type, code_value, value_description, inuse_flag, sort_order) VALUES
('PO_MATCH_STATUS', 'UNMATCHED', '未匹配',  'USE', 1),
('PO_MATCH_STATUS', 'PARTIAL',   '部分匹配', 'USE', 2),
('PO_MATCH_STATUS', 'MATCHED',   '完全匹配', 'USE', 3),
('PO_MATCH_STATUS', 'EXCESS',    '发票过量', 'USE', 4),
('PO_MATCH_STATUS', 'DIFF_QTY',  '数量差异', 'USE', 5),
('PO_MATCH_STATUS', 'DIFF_AMT',  '金额差异', 'USE', 6)
ON DUPLICATE KEY UPDATE value_description=VALUES(value_description);

-- ===== schema_migrations =====
INSERT INTO schema_migrations (version, applied_at, description) VALUES
('025_po_match', NOW(), 'PO收货单+三单匹配');

SELECT '✅ 025 PO 收货单 + 三单匹配 迁移完成' AS result;
