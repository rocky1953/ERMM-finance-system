-- 028 PO 三单匹配增强：差异处置 + 发票溯源 + 容差
-- 在 025_po_match 基础上补充：
--   1) 发票号/发票日期/差异率，便于差异追溯
--   2) 差异处置状态（挂起/接受/退回）与处置人、原因
--   3) PO_MATCH_HANDLE 码表

SET NAMES utf8mb4;

ALTER TABLE po_match_result
  ADD COLUMN invoice_no     varchar(50)  DEFAULT NULL COMMENT 'AP 发票号' AFTER invoice_uid,
  ADD COLUMN invoice_date   date         DEFAULT NULL COMMENT 'AP 发票日期' AFTER invoice_no,
  ADD COLUMN diff_rate      decimal(10,4) DEFAULT 0 COMMENT '金额差异率 = (发票-收货)/收货' AFTER diff_amount,
  ADD COLUMN handle_status  varchar(20)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/HOLD/ACCEPTED/REJECTED' AFTER auto_matched,
  ADD COLUMN handle_reason  varchar(500) DEFAULT NULL COMMENT '差异处置原因',
  ADD COLUMN handled_by     varchar(50)  DEFAULT NULL,
  ADD COLUMN handled_time   datetime     DEFAULT NULL,
  ADD KEY idx_handle (handle_status);

INSERT INTO cams_system_codes (code_type, code_value, value_description, inuse_flag, sort_order) VALUES
('PO_MATCH_HANDLE', 'PENDING',  '待处理', 'USE', 1),
('PO_MATCH_HANDLE', 'HOLD',     '挂起',   'USE', 2),
('PO_MATCH_HANDLE', 'ACCEPTED', '接受差异', 'USE', 3),
('PO_MATCH_HANDLE', 'REJECTED', '退回处理', 'USE', 4)
ON DUPLICATE KEY UPDATE value_description=VALUES(value_description);

INSERT INTO schema_migrations (version, applied_at, description) VALUES
('028_po_match_enhance', NOW(), 'PO三单匹配差异处置增强');

SELECT '✅ 028 PO 三单匹配增强 迁移完成' AS result;
