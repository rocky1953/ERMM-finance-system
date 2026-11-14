-- 022 付款申请审批（最小闭环）
-- pay_request + pay_request_item，复用 wf_process

SET NAMES utf8mb4;

-- ===== 付款申请单 =====
CREATE TABLE IF NOT EXISTS pay_request (
  id              bigint          NOT NULL AUTO_INCREMENT,
  request_no      varchar(32)     DEFAULT NULL,
  applicant_id    varchar(50)     NOT NULL,
  applicant_name  varchar(100)    DEFAULT NULL,
  dept            varchar(100)    DEFAULT NULL,
  bu_no           varchar(20)     DEFAULT NULL,
  pay_type        varchar(50)     DEFAULT NULL COMMENT 'SALARY/TAX/RENT/SUPPLIER/OTHER',
  pay_target      varchar(200)    DEFAULT NULL COMMENT '收款方名稱',
  total_amount    decimal(18,2)   NOT NULL DEFAULT 0,
  currency        varchar(10)     DEFAULT 'TWD',
  pay_method      varchar(30)     DEFAULT NULL COMMENT 'BANK/TRANSFER/CASH/CHECK',
  due_date        date            DEFAULT NULL COMMENT '預計付款日',
  remark          varchar(500)    DEFAULT NULL,
  wf_instance_id  bigint          DEFAULT NULL,
  status          varchar(20)     NOT NULL DEFAULT 'DRAFT',
  submit_time     datetime        DEFAULT NULL,
  approve_time    datetime        DEFAULT NULL,
  pay_time        datetime        DEFAULT NULL,
  pay_detail_ids  text            DEFAULT NULL COMMENT '審批通過後關聯 pay_detail uid 列表 JSON 數組',
  create_time     datetime        DEFAULT CURRENT_TIMESTAMP,
  update_time     datetime        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_applicant (applicant_id),
  KEY idx_status (status),
  KEY idx_bu (bu_no),
  KEY idx_wf_inst (wf_instance_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='付款申請單';

-- ===== 付款申請明細 =====
CREATE TABLE IF NOT EXISTS pay_request_item (
  id              bigint          NOT NULL AUTO_INCREMENT,
  request_id      bigint          NOT NULL,
  item_no         int             NOT NULL DEFAULT 1,
  supplier_name   varchar(200)    DEFAULT NULL,
  pay_type        varchar(50)     DEFAULT NULL COMMENT '工資/稅金/房租/貨款/其他',
  invoice_num     varchar(50)     DEFAULT NULL,
  invoice_date    date            DEFAULT NULL,
  should_date     date            DEFAULT NULL,
  amount          decimal(18,2)   NOT NULL DEFAULT 0,
  currency_ab     varchar(10)     DEFAULT 'TWD',
  remark          varchar(500)    DEFAULT NULL,
  create_time     datetime        DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_req (request_id),
  CONSTRAINT fk_pri_req FOREIGN KEY (request_id) REFERENCES pay_request(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='付款申請明細';

-- ===== 流程定義 =====
INSERT INTO wf_process (proc_code, proc_name, business_type, steps_json, enabled) VALUES
('PAYMENT_DEFAULT', '付款申請預設流程', 'PAYMENT',
 JSON_ARRAY(
   JSON_OBJECT('step_no', 1, 'step_name', '部門主管審批', 'approver_type', 'dept_manager', 'approver_value', CAST(NULL AS JSON)),
   JSON_OBJECT('step_no', 2, 'step_name', '財務審批',    'approver_type', 'admin',       'approver_value', CAST(NULL AS JSON))
 ), 1)
ON DUPLICATE KEY UPDATE proc_name=VALUES(proc_name), steps_json=VALUES(steps_json);

-- ===== 碼表 =====
INSERT INTO cams_system_codes (code_type, code_value, value_description, inuse_flag, sort_order) VALUES
('PAY_TYPE', 'SALARY',   '薪資',   'USE', 1),
('PAY_TYPE', 'TAX',      '稅金',   'USE', 2),
('PAY_TYPE', 'RENT',     '房租',   'USE', 3),
('PAY_TYPE', 'SUPPLIER', '供應商', 'USE', 4),
('PAY_TYPE', 'OTHER',    '其他',   'USE', 5),

('PAY_METHOD', 'BANK',    '銀行轉帳', 'USE', 1),
('PAY_METHOD', 'TRANSFER', '電匯',    'USE', 2),
('PAY_METHOD', 'CASH',    '現金',    'USE', 3),
('PAY_METHOD', 'CHECK',   '支票',    'USE', 4)
ON DUPLICATE KEY UPDATE value_description=VALUES(value_description);

-- ===== schema_migrations =====
INSERT INTO schema_migrations (version, applied_at, description) VALUES
('022_workflow_payment', NOW(), '付款申請審批最小閉環');

-- ===== 完成提示 =====
SELECT '✅ 022 付款申請審批遷移完成' AS result;
