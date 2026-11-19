-- ============================================================
-- CTO-05 合同主檔：將 PO/SO 與客戶或供應商合同關聯
-- ============================================================

CREATE TABLE IF NOT EXISTS ermm_contract (
    uid             BIGINT AUTO_INCREMENT PRIMARY KEY,
    contract_no     VARCHAR(40) NOT NULL COMMENT '合同編號',
    contract_name   VARCHAR(200) NOT NULL COMMENT '合同名稱',
    contract_type   VARCHAR(30) DEFAULT '采购' COMMENT '採購/銷售/服務/框架協議/保密協議',
    contract_cat    VARCHAR(30) DEFAULT 'PO對應' COMMENT 'PO對應/客戶主合同/供應商主合同/框架協議',
    bu_no           VARCHAR(10) NOT NULL COMMENT '公司碼',
    partner_name    VARCHAR(120) NOT NULL COMMENT '合同相對方（供應商或客戶）',
    partner_type    VARCHAR(20) DEFAULT 'SUPPLIER' COMMENT 'SUPPLIER/CUSTOMER/OTHER',
    -- 金額
    contract_amount DECIMAL(16,2) DEFAULT NULL COMMENT '合同總金額',
    currency        VARCHAR(10) DEFAULT 'RMB',
    contract_basis  VARCHAR(50) DEFAULT 'Fixed' COMMENT '計價基礎 Fixed/RevOpen/UnitPrice/TargetCost',
    -- 時間
    sign_date       DATE DEFAULT NULL COMMENT '簽訂日期',
    effective_date  DATE DEFAULT NULL COMMENT '生效日期',
    expire_date     DATE DEFAULT NULL COMMENT '到期日期',
    -- 關聯
    po_id           VARCHAR(40) DEFAULT NULL COMMENT '對應 PO 編號（如果是 PO 對應合同）',
    po_uid          BIGINT DEFAULT NULL,
    so_id           VARCHAR(40) DEFAULT NULL,
    so_uid          BIGINT DEFAULT NULL,
    -- 合同條款（JSON 存，靈活）
    payment_terms   JSON DEFAULT NULL COMMENT '付款條件',
    settlement_type VARCHAR(40) DEFAULT NULL COMMENT '結算方式 TT/L/C/支票/月結/銀聯/...',
    warranty_period VARCHAR(40) DEFAULT NULL COMMENT '保固期/保修期',
    penalty_clause  VARCHAR(200) DEFAULT NULL COMMENT '違約條款摘要',
    -- 附件
    attachment_url  VARCHAR(500) DEFAULT NULL,
    -- 狀態
    contract_status VARCHAR(20) DEFAULT 'ACTIVE' COMMENT 'ACTIVE/EXPIRED/TERMINATED/DRAFT',
    review_status   VARCHAR(20) DEFAULT 'REVIEWED' COMMENT 'REVIEWED/PENDING_REVIEW',
    inuse_flag      TINYINT DEFAULT 1,
    remark          TEXT DEFAULT NULL,
    create_user     VARCHAR(40) DEFAULT NULL,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_contract_no (contract_no, bu_no),
    INDEX idx_bu (bu_no),
    INDEX idx_partner (partner_name),
    INDEX idx_status (contract_status),
    INDEX idx_expire (expire_date),
    KEY idx_po (po_uid),
    KEY idx_so (so_uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CTO-05 合同主檔';

-- 預設合同（從 ermm_erp_po 取 10 條示範數據）
INSERT INTO ermm_contract
    (contract_no, contract_name, contract_type, contract_cat, bu_no, partner_name, partner_type,
     contract_amount, currency, contract_basis, sign_date, effective_date, expire_date,
     po_id, po_uid, contract_status, remark)
SELECT CONCAT('PO-', po_id),
       CONCAT('採購合同 - ', xitems),
       '采购', 'PO對應',
       bu_no, supplier_name, 'SUPPLIER',
       po_amount, 'RMB', 'Fixed',
       DATE_SUB(po_date, INTERVAL 7 DAY),
       po_date,
       DATE_ADD(po_date, INTERVAL 365 DAY),
       po_id, uid, 'ACTIVE',
       CONCAT('由 PO 自動生成的合同示範數據')
FROM ermm_erp_po
WHERE po_amount > 0
LIMIT 10
ON DUPLICATE KEY UPDATE
    contract_name=VALUES(contract_name),
    contract_status=VALUES(contract_status),
    update_time=NOW();