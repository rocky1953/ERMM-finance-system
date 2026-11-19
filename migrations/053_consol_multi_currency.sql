-- CFO-03 抵消分录智能匹配 + 多币种折算 + 合并附注快照
-- 补齐 consol_exchange_rate 缺省币种，新增抵消建议和附注快照表

-- ================================================
-- 1. 汇率补齐（HN=TWD 集团本位币，SZ=HKD，HM=RMB）
--    rate_to_twd 统一折算到集团本位币 TWD
-- ================================================
INSERT INTO consol_exchange_rate (YYYY_MM, currency, rate_to_twd, rate_to_usd, rate_type, source) VALUES
('2025-12','TWD',1.000000,0.032000,'AVG','MANUAL'),
('2025-12','HKD',3.800000,0.120000,'AVG','MANUAL'),
('2025-12','RMB',1.080000,0.150000,'AVG','MANUAL'),
('2025-11','TWD',1.000000,0.031500,'AVG','MANUAL'),
('2025-11','HKD',3.750000,0.119000,'AVG','MANUAL'),
('2025-11','RMB',1.075000,0.149200,'AVG','MANUAL'),
('2025-10','TWD',1.000000,0.031000,'AVG','MANUAL'),
('2025-10','HKD',3.700000,0.118000,'AVG','MANUAL'),
('2025-10','RMB',1.070000,0.148000,'AVG','MANUAL'),
('2026-10','TWD',1.000000,0.032500,'AVG','MANUAL'),
('2026-10','HKD',3.850000,0.121000,'AVG','MANUAL'),
('2026-10','RMB',1.080000,0.150000,'AVG','MANUAL'),
('2026-11','TWD',1.000000,0.032800,'AVG','MANUAL'),
('2026-11','HKD',3.880000,0.122000,'AVG','MANUAL'),
('2026-11','RMB',1.080000,0.151000,'AVG','MANUAL'),
('2026-12','TWD',1.000000,0.033000,'AVG','MANUAL'),
('2026-12','HKD',3.900000,0.123000,'AVG','MANUAL'),
('2026-12','RMB',1.085000,0.152000,'AVG','MANUAL')
ON DUPLICATE KEY UPDATE rate_to_twd=VALUES(rate_to_twd), rate_to_usd=VALUES(rate_to_usd), update_time=NOW();

-- ================================================
-- 2. 公司本位币配置（无独立 company 表，用 cams_system_codes 存）
--    格式: code_type='COMPANY_CURRENCY', code_value=<bu_no>, ext_json={"currency":"TWD","rate_to_base":1.0}
-- ================================================
-- 幂等：cams_system_codes 无 (code_type, code_value) 唯一键，用 NOT EXISTS 避免重复插入
INSERT INTO cams_system_codes (code_type, code_value, value_description, inuse_flag, sort_order)
SELECT s.code_type, s.code_value, s.value_description, 'USE', s.sort_order
FROM (
  SELECT 'COMPANY_CURRENCY' AS code_type, 'HM' AS code_value, '華南合併實業 人民幣（HM 公司本位幣 RMB）' AS value_description, 1 AS sort_order
  UNION ALL SELECT 'COMPANY_CURRENCY', 'HN', '華南合併實業 新台幣（HN 公司本位幣 TWD，集團本位幣）', 2
  UNION ALL SELECT 'COMPANY_CURRENCY', 'SZ', '華南合併實業 港幣（SZ 公司本位幣 HKD）', 3
  UNION ALL SELECT 'GROUP_CONFIG', 'BASE_CURRENCY', '集團合併本位幣=新台幣', 10
) s
WHERE NOT EXISTS (
  SELECT 1 FROM cams_system_codes c
   WHERE c.code_type = s.code_type AND c.code_value = s.code_value
);

-- ================================================
-- 3. 抵消分录智能建议（从凭证自动匹配）
--    自动扫描 fin_voucher + fin_voucher_entry 的內部交易對手
-- ================================================
CREATE TABLE IF NOT EXISTS consol_elim_suggest (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    YYYY_MM       CHAR(7) NOT NULL COMMENT '關賬月份',
    pair_type     VARCHAR(20) NOT NULL COMMENT 'SALE/AR/AP/LOAN/DIVIDEND/OTHER',
    from_bu       VARCHAR(5) NOT NULL COMMENT '内部交易发起方',
    to_bu         VARCHAR(5) NOT NULL COMMENT '内部交易对手方',
    subject_code  VARCHAR(20) COMMENT '對應科目代碼',
    subject_name  VARCHAR(100),
    amount        DECIMAL(18,2) NOT NULL,
    currency      VARCHAR(3) DEFAULT 'TWD',
    source_doc    VARCHAR(100) COMMENT '原始憑證/單據',
    confidence    DECIMAL(3,2) DEFAULT 0.50 COMMENT '匹配置信度 0-1',
    suggest_action VARCHAR(20) DEFAULT 'CREATE' COMMENT 'CREATE/MATCHED/REJECTED',
    linked_entry_id BIGINT DEFAULT NULL COMMENT '關聯到已確認的抵消分錄',
    remark        VARCHAR(300),
    create_time   DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_pair (YYYY_MM, pair_type, from_bu, to_bu, subject_code, source_doc),
    KEY idx_ymm (YYYY_MM),
    KEY idx_from_bu (from_bu),
    KEY idx_to_bu (to_bu)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='抵消分錄自動匹配建議';

-- ================================================
-- 4. 合併報表快照（供董事會報告包引用、追溯历史版本）
-- ================================================
CREATE TABLE IF NOT EXISTS consol_snapshot (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    YYYY_MM         CHAR(7) NOT NULL,
    snapshot_type   VARCHAR(20) NOT NULL COMMENT 'PnL/BalanceSheet/CashFlow/Overview',
    base_currency   VARCHAR(3) NOT NULL DEFAULT 'TWD',
    bu_no           VARCHAR(5) DEFAULT 'GROUP',
    version_no      INT DEFAULT 1,
    data_json       JSON NOT NULL COMMENT '合併報表完整數據',
    elim_total      DECIMAL(18,2) DEFAULT 0 COMMENT '本期抵消金額總計',
    transl_diff     DECIMAL(18,2) DEFAULT 0 COMMENT '本期折算差異',
    generated_by    VARCHAR(64),
    board_pack_id   BIGINT DEFAULT NULL COMMENT '若已綁定董事會報告包',
    is_final        TINYINT DEFAULT 0 COMMENT '1=已關賬鎖定的最終版本',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_ymm_type (YYYY_MM, snapshot_type),
    KEY idx_board (board_pack_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='合併報表快照';

-- ================================================
-- 5. 折算差異累計表（每期更新，資產負債表需單獨披露）
-- ================================================
CREATE TABLE IF NOT EXISTS consol_translation_diff (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    YYYY_MM       CHAR(7) NOT NULL,
    bu_no         VARCHAR(5) NOT NULL,
    base_currency VARCHAR(3) DEFAULT 'TWD',
    equity_converted DECIMAL(18,2) DEFAULT 0 COMMENT '子公司權益折算',
    income_converted DECIMAL(18,2) DEFAULT 0 COMMENT '子公司損益折算',
    asset_converted  DECIMAL(18,2) DEFAULT 0 COMMENT '子公司資產折算',
    rate_end      DECIMAL(14,6) COMMENT '期末匯率',
    rate_avg      DECIMAL(14,6) COMMENT '平均匯率',
    diff_amount   DECIMAL(18,2) NOT NULL COMMENT '本期折算差異',
    cumul_diff    DECIMAL(18,2) COMMENT '累計折算差異',
    create_time   DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_ymm_bu (YYYY_MM, bu_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='多幣種折算差異累計';

-- ================================================
-- 6. 爲抵消自動匹配預留內部交易科目字典
-- ================================================
INSERT INTO cams_system_codes (code_type, code_value, value_description, inuse_flag, sort_order)
SELECT s.code_type, s.code_value, s.value_description, 'USE', s.sort_order
FROM (
  SELECT 'INTERNAL_SUBJECT' AS code_type, 'AR' AS code_value, '內部應收賬款（內部公司間應收科目）' AS value_description, 1 AS sort_order
  UNION ALL SELECT 'INTERNAL_SUBJECT', 'AP', '內部應付賬款（內部公司間應付科目）', 2
  UNION ALL SELECT 'INTERNAL_SUBJECT', 'SALE', '內部銷貨收入（內部公司間銷售收入）', 3
  UNION ALL SELECT 'INTERNAL_SUBJECT', 'COGS', '內部銷貨成本（內部公司間銷售成本）', 4
  UNION ALL SELECT 'INTERNAL_SUBJECT', 'LOAN', '內部借款（內部公司間借款/墊款）', 5
  UNION ALL SELECT 'INTERNAL_SUBJECT', 'DIVIDEND', '內部股利（內部公司間股利分配）', 6
) s
WHERE NOT EXISTS (
  SELECT 1 FROM cams_system_codes c
   WHERE c.code_type = s.code_type AND c.code_value = s.code_value
);