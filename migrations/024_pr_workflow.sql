-- 024 采购申请审批闭环
-- pr_request + pr_request_item → 审批通过 → 自动生成 ermm_erp_po

SET NAMES utf8mb4;

-- ===== 采购申请单 =====
CREATE TABLE IF NOT EXISTS pr_request (
  id              bigint          NOT NULL AUTO_INCREMENT,
  pr_no           varchar(32)     DEFAULT NULL COMMENT 'PR + YYYYMM + 流水號',
  applicant_id    varchar(50)     NOT NULL,
  applicant_name  varchar(100)    DEFAULT NULL,
  dept            varchar(100)    DEFAULT NULL,
  bu_no           varchar(20)     DEFAULT NULL,
  supplier_id     varchar(50)     DEFAULT NULL,
  supplier_name   varchar(200)    DEFAULT NULL,
  pr_type         varchar(50)     DEFAULT 'MATERIAL' COMMENT 'MATERIAL/SERVICE/ASSET/OTHER',
  purpose         varchar(500)    DEFAULT NULL COMMENT '用途說明',
  total_amount    decimal(18,2)   NOT NULL DEFAULT 0,
  currency        varchar(10)     DEFAULT 'TWD',
  need_by_date    date            DEFAULT NULL COMMENT '需求日期',
  remark          varchar(500)    DEFAULT NULL,
  wf_instance_id  bigint          DEFAULT NULL,
  status          varchar(20)     NOT NULL DEFAULT 'DRAFT',
  submit_time     datetime        DEFAULT NULL,
  approve_time    datetime        DEFAULT NULL,
  po_uid          int             DEFAULT NULL COMMENT '审批通过后生成的 PO UID',
  po_id           varchar(50)     DEFAULT NULL,
  create_time     datetime        DEFAULT CURRENT_TIMESTAMP,
  update_time     datetime        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_applicant (applicant_id),
  KEY idx_status (status),
  KEY idx_bu (bu_no),
  KEY idx_wf (wf_instance_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='采购申请单';

-- ===== 采购申请明细 =====
CREATE TABLE IF NOT EXISTS pr_request_item (
  id              bigint          NOT NULL AUTO_INCREMENT,
  request_id      bigint          NOT NULL,
  item_no         int             NOT NULL DEFAULT 1,
  xitems          varchar(100)    DEFAULT NULL COMMENT '料件編號',
  item_name       varchar(300)    DEFAULT NULL COMMENT '品名/規格',
  qty             decimal(18,4)   NOT NULL DEFAULT 0,
  unit            varchar(20)     DEFAULT NULL,
  unit_price      decimal(18,6)   NOT NULL DEFAULT 0,
  amount          decimal(18,2)   NOT NULL DEFAULT 0,
  need_by_date    date            DEFAULT NULL,
  remark          varchar(500)    DEFAULT NULL,
  create_time     datetime        DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_req (request_id),
  CONSTRAINT fk_pr_item_req FOREIGN KEY (request_id) REFERENCES pr_request(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='采购申请明细';

-- ===== 流程 =====
INSERT INTO wf_process (proc_code, proc_name, business_type, steps_json, enabled) VALUES
('PR_DEFAULT', '采购申请预设流程', 'PURCHASE',
 JSON_ARRAY(
   JSON_OBJECT('step_no', 1, 'step_name', '部門主管審批', 'approver_type', 'dept_manager', 'approver_value', CAST(NULL AS JSON)),
   JSON_OBJECT('step_no', 2, 'step_name', '採購主管審批', 'approver_type', 'admin',       'approver_value', CAST(NULL AS JSON))
 ), 1)
ON DUPLICATE KEY UPDATE proc_name=VALUES(proc_name), steps_json=VALUES(steps_json);

-- ===== 码表 =====
INSERT INTO cams_system_codes (code_type, code_value, value_description, inuse_flag, sort_order) VALUES
('PR_TYPE', 'MATERIAL', '物料', 'USE', 1),
('PR_TYPE', 'SERVICE',  '服務', 'USE', 2),
('PR_TYPE', 'ASSET',    '資產', 'USE', 3),
('PR_TYPE', 'OTHER',    '其他', 'USE', 4),

('PR_STATUS', 'DRAFT',     '草稿',     'USE', 1),
('PR_STATUS', 'PENDING',   '審批中',   'USE', 2),
('PR_STATUS', 'APPROVED',  '已通過',   'USE', 3),
('PR_STATUS', 'PO_CREATED','已建PO',  'USE', 4),
('PR_STATUS', 'REJECTED',  '已駁回',   'USE', 5),
('PR_STATUS', 'CANCELLED', '已撤回',   'USE', 6)
ON DUPLICATE KEY UPDATE value_description=VALUES(value_description);

-- ===== schema_migrations =====
INSERT INTO schema_migrations (version, applied_at, description) VALUES
('024_pr_workflow', NOW(), '采购申请审批闭环');

SELECT '✅ 024 采购申请审批迁移完成' AS result;
