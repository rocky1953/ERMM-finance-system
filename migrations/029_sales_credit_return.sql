-- 029 销售履约与信用（COO-03）
-- 客户信用额度主档 + 销售退货单 + 码表 + 模块权限登记

SET NAMES utf8mb4;

-- ===== 客户信用额度 =====
CREATE TABLE IF NOT EXISTS sales_credit_limit (
  uid             int             NOT NULL AUTO_INCREMENT,
  bu_no           varchar(20)     NOT NULL,
  client_id       varchar(100)    NOT NULL COMMENT '客戶編號/名稱（對應 ermm_erp_so.client_id）',
  client_name     varchar(200)    DEFAULT NULL,
  credit_limit    decimal(18,2)   NOT NULL DEFAULT 0 COMMENT '信用額度，0=未設定（不受限）',
  credit_days     int             NOT NULL DEFAULT 30 COMMENT '帳期天數',
  status          varchar(20)     NOT NULL DEFAULT 'USE' COMMENT 'USE=啟用 / HOLD=凍結',
  remark          varchar(500)    DEFAULT NULL,
  update_by       varchar(50)     DEFAULT NULL,
  create_time     datetime        DEFAULT CURRENT_TIMESTAMP,
  update_time     datetime        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (uid),
  UNIQUE KEY uk_bu_client (bu_no, client_id),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客戶信用額度';

-- ===== 銷售退貨單 =====
CREATE TABLE IF NOT EXISTS sales_return (
  uid             int             NOT NULL AUTO_INCREMENT,
  bu_no           varchar(20)     NOT NULL,
  return_no       varchar(50)     NOT NULL COMMENT '退貨單號',
  so_nbr          varchar(50)     DEFAULT NULL COMMENT '關聯銷售訂單',
  client_id       varchar(100)    DEFAULT NULL,
  client_name     varchar(200)    DEFAULT NULL,
  xitems          varchar(100)    DEFAULT NULL,
  return_date     date            DEFAULT NULL,
  return_qty      decimal(18,4)   NOT NULL DEFAULT 0,
  unit_price      decimal(18,6)   NOT NULL DEFAULT 0,
  return_amount   decimal(18,2)   GENERATED ALWAYS AS (return_qty * COALESCE(unit_price,0)) STORED,
  reason_type     varchar(20)     NOT NULL DEFAULT 'QUALITY' COMMENT 'QUALITY/SPEC/OVERSUPPLY/LATE/OTHER',
  status          varchar(20)     NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/APPROVED/CLOSED/REJECTED',
  handled_by      varchar(50)     DEFAULT NULL,
  handled_time    datetime        DEFAULT NULL,
  handle_reason   varchar(500)    DEFAULT NULL,
  remark          varchar(500)    DEFAULT NULL,
  create_time     datetime        DEFAULT CURRENT_TIMESTAMP,
  update_time     datetime        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (uid),
  UNIQUE KEY uk_return_no (return_no),
  KEY idx_so (so_nbr),
  KEY idx_client (client_id),
  KEY idx_status (status),
  KEY idx_date (return_date),
  KEY idx_bu (bu_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='銷售退貨單';

-- ===== 码表 =====
INSERT INTO cams_system_codes (code_type, code_value, value_description, inuse_flag, sort_order) VALUES
('SALES_RETURN_STATUS', 'PENDING',  '待處理', 'USE', 1),
('SALES_RETURN_STATUS', 'APPROVED', '已核准', 'USE', 2),
('SALES_RETURN_STATUS', 'CLOSED',   '已沖銷', 'USE', 3),
('SALES_RETURN_STATUS', 'REJECTED', '已駁回', 'USE', 4),
('SALES_RETURN_REASON', 'QUALITY',     '質量問題', 'USE', 1),
('SALES_RETURN_REASON', 'SPEC',        '規格不符', 'USE', 2),
('SALES_RETURN_REASON', 'OVERSUPPLY',  '超交退回', 'USE', 3),
('SALES_RETURN_REASON', 'LATE',        '交期延誤', 'USE', 4),
('SALES_RETURN_REASON', 'OTHER',       '其他',     'USE', 5),
('SALES_CREDIT_STATUS', 'USE',  '啟用', 'USE', 1),
('SALES_CREDIT_STATUS', 'HOLD', '凍結', 'USE', 2)
ON DUPLICATE KEY UPDATE value_description=VALUES(value_description);

-- ===== 模块权限登记 =====
INSERT INTO cams_module_permission (module_code, module_name, module_group, allow_general, allow_operator, allow_admin, sort_order) VALUES
('salesCredit', '销售履约与信用', 'ERP 原始单据', 1, 1, 1, 18)
ON DUPLICATE KEY UPDATE module_name=VALUES(module_name), module_group=VALUES(module_group);

-- ===== schema_migrations =====
INSERT INTO schema_migrations (version, applied_at, description) VALUES
('029_sales_credit_return', NOW(), '销售履约与信用（信用额度+销售退货）')
ON DUPLICATE KEY UPDATE applied_at=NOW();

SELECT '✅ 029 销售履约与信用 迁移完成' AS result;
