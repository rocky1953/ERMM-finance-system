-- ============================================================
-- CTO-06 指標中心：統一 KPI 口徑 + 數據血緣
-- ------------------------------------------------------------
-- 問題：毛利率/ROE/負債率等同一指標在 kpiQuery/consolidation/boardPack
--       三處各自硬編碼公式，口徑已出現分歧（例如 ROE 有的用營業利潤，
--       有的用淨利）。
-- 方案：所有 KPI 公式集中在 cams_metric_def 表，services/metricCenter.js
--       統一對外提供 compute/metric/lineage 三個能力。
-- ============================================================

-- 1. 指標定義表
CREATE TABLE IF NOT EXISTS cams_metric_def (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    metric_code     VARCHAR(40) NOT NULL COMMENT '唯一碼: roe / gross_margin / debt_ratio ...',
    metric_name     VARCHAR(80) NOT NULL COMMENT '中文名稱',
    metric_cat      VARCHAR(30) NOT NULL COMMENT '類別: 償債能力/營運能力/獲利能力/成長能力/Z模型',
    metric_group    VARCHAR(30) DEFAULT '財務比率' COMMENT '分組: 財務比率/預警模型/自訂',
    -- 公式存 JS 字串（受限函數，只允許 s/p 參數和基本運算）
    formula_js      TEXT NOT NULL COMMENT 'JS 公式: s.sale_amt / Math.max(1, s.AR_amt)',
    formula_desc    VARCHAR(255) DEFAULT NULL COMMENT '中文公式說明，給財務主管看',
    unit            VARCHAR(10) DEFAULT '' COMMENT '% / 倍 / 天 / 元',
    -- 方向：asc = 值高=差（越大越壞，如負債率）
    --       desc = 值低=差（越小越壞，如 ROE）
    pct_type        VARCHAR(10) DEFAULT 'asc' COMMENT 'asc/desc，影響點燈與同業排名',
    -- 數據血緣：這個指標從哪張表的哪些字段取數
    source_table    VARCHAR(60) NOT NULL COMMENT '主數據源: mgm_finance_summary / fx_exposure ...',
    source_fields   JSON DEFAULT NULL COMMENT '依賴字段列表: ["sale_amt", "ttl_asset_amt"]',
    source_filter   VARCHAR(100) DEFAULT NULL COMMENT '取數過濾條件: bu_no=? AND YYYY_MM=?',
    -- 標竿 / 點燈
    benchmark_enabled TINYINT DEFAULT 1 COMMENT '是否啟用同業標竿對比',
    light_enabled    TINYINT DEFAULT 1 COMMENT '是否啟用點燈',
    -- 維護
    version         INT DEFAULT 1 COMMENT '公式版本號，改公式時 +1',
    inuse_flag      TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_code (metric_code),
    KEY idx_cat (metric_cat),
    KEY idx_source (source_table)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CTO-06 指標定義';

-- 2. 指標依賴（數據血緣，可視化用）
CREATE TABLE IF NOT EXISTS cams_metric_lineage (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    metric_code     VARCHAR(40) NOT NULL,
    depends_on      VARCHAR(40) NOT NULL COMMENT '依賴的另一個指標碼（組合指標用）',
    notes           VARCHAR(100) DEFAULT NULL COMMENT '依賴說明',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_dep (metric_code, depends_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CTO-06 指標血緣';

-- ============================================================
-- 3. 預設 30 個指標（從 kpiQuery.js FORMULAS 遷移 + 口徑統一）
--    ROE/ROA 改用淨利（net_profit_amt），不再用 sale_exp_amt
-- ============================================================
INSERT INTO cams_metric_def (metric_code, metric_name, metric_cat, metric_group, formula_js, formula_desc, unit, pct_type, source_table, source_fields, source_filter, benchmark_enabled, light_enabled) VALUES
-- ---------- 償債能力 ----------
('current_ratio',  '流動比率',    '償債能力', '財務比率', 's.current_asset_amt / Math.max(1, s.current_debet_amt || s.AP_amt)',
 '流動資產 ÷ 流動負債', '倍', 'desc', 'mgm_finance_summary', '["current_asset_amt","current_debet_amt","AP_amt"]', 'bu_no=? AND YYYY_MM=?', 1, 1),
('quick_ratio',    '速動比率',    '償債能力', '財務比率', '(s.current_asset_amt - ((s.stock_P_amt||0)+(s.stock_M_amt||0)+(s.WIP_M_amt||0)+(s.WIP_labor_amt||0)+(s.WIP_EXP_amt||0))) / Math.max(1, s.current_debet_amt || s.AP_amt)',
 '(流動資產 − 存貨) ÷ 流動負債', '倍', 'desc', 'mgm_finance_summary', '["current_asset_amt","current_debet_amt","AP_amt","stock_P_amt","stock_M_amt","WIP_M_amt","WIP_labor_amt","WIP_EXP_amt"]', 'bu_no=? AND YYYY_MM=?', 1, 1),
('debt_ratio',     '負債比率',    '償債能力', '財務比率', '((s.ttl_debet_amt !== undefined && s.ttl_debet_amt !== null ? s.ttl_debet_amt : ((s.loan_amt||0)+(s.AP_amt||0)+(s.LT_loan_amt||0))) * 100) / Math.max(1, s.ttl_asset_amt)',
 '負債總額 ÷ 資產總額 × 100%', '%', 'asc', 'mgm_finance_summary', '["ttl_debet_amt","ttl_asset_amt","loan_amt","AP_amt","LT_loan_amt"]', 'bu_no=? AND YYYY_MM=?', 1, 1),
('interest_cov',   '利息保障倍數','償債能力', '財務比率', '(() => { const int = s.interest_amt || 0; if (int <= 0) return null; return ((s.net_profit_amt||0) + int) / int; })()',
 '(淨利 + 利息費用) ÷ 利息費用', '倍', 'desc', 'mgm_finance_summary', '["net_profit_amt","interest_amt"]', 'bu_no=? AND YYYY_MM=?', 1, 0),
('cash_ratio',     '現金比率',    '償債能力', '財務比率', '((s.cash_amt + s.deposite_amt) * 100) / Math.max(1, s.current_debet_amt || s.AP_amt)',
 '(現金 + 銀行存款) ÷ 流動負債 × 100%', '%', 'desc', 'mgm_finance_summary', '["cash_amt","deposite_amt","current_debet_amt","AP_amt"]', 'bu_no=? AND YYYY_MM=?', 1, 1),

-- ---------- 營運能力 ----------
('inventory_turn', '存貨周轉率',  '營運能力', '財務比率', 's.sale_cost_amt / Math.max(1, (s.stock_P_amt||0)+(s.stock_M_amt||0)+(s.WIP_M_amt||0)+(s.WIP_labor_amt||0)+(s.WIP_EXP_amt||0)+(s.stock_transit_amt||0)+(s.stock_value_amt||0))',
 '銷貨成本 ÷ 平均存貨', '次', 'desc', 'mgm_finance_summary', '["sale_cost_amt","stock_P_amt","stock_M_amt","WIP_M_amt","WIP_labor_amt","WIP_EXP_amt","stock_transit_amt","stock_value_amt"]', 'bu_no=? AND YYYY_MM=?', 1, 1),
('ar_turn',        '應收帳款周轉率','營運能力','財務比率', 's.sale_amt / Math.max(1, s.AR_amt)',
 '營業收入 ÷ 平均應收帳款', '次', 'desc', 'mgm_finance_summary', '["sale_amt","AR_amt"]', 'bu_no=? AND YYYY_MM=?', 1, 1),
('ar_days',        '應收帳款周轉天數','營運能力','財務比率', '365 / Math.max(0.01, s.sale_amt / Math.max(1, s.AR_amt))',
 '365 ÷ 應收帳款周轉率', '天', 'asc', 'mgm_finance_summary', '["sale_amt","AR_amt"]', 'bu_no=? AND YYYY_MM=?', 1, 1),
('total_asset_turn','總資產周轉率','營運能力', '財務比率', 's.sale_amt / Math.max(1, s.ttl_asset_amt)',
 '營業收入 ÷ 平均資產總額', '次', 'desc', 'mgm_finance_summary', '["sale_amt","ttl_asset_amt"]', 'bu_no=? AND YYYY_MM=?', 1, 1),
('fixed_asset_turn','固定資產周轉率','營運能力','財務比率', 's.sale_amt / Math.max(1, (s.office_amt||0)+(s.building_amt||0)+(s.equipment_amt||0)+(s.vehicle_amt||0)+(s.intangible_amt||0))',
 '營業收入 ÷ 固定資產淨額', '次', 'desc', 'mgm_finance_summary', '["sale_amt","office_amt","building_amt","equipment_amt","vehicle_amt","intangible_amt"]', 'bu_no=? AND YYYY_MM=?', 1, 0),

-- ---------- 獲利能力（★ 口徑統一：分子用 net_profit_amt 淨利）----------
('gross_margin',   '銷售毛利率',  '獲利能力', '財務比率', '(s.sale_amt - s.sale_cost_amt) * 100 / Math.max(1, s.sale_amt)',
 '(營業收入 − 營業成本) ÷ 營業收入 × 100%', '%', 'desc', 'mgm_finance_summary', '["sale_amt","sale_cost_amt"]', 'bu_no=? AND YYYY_MM=?', 1, 1),
('net_margin',     '銷售淨利率',  '獲利能力', '財務比率', 's.net_profit_amt * 100 / Math.max(1, s.sale_amt)',
 '淨利 ÷ 營業收入 × 100%', '%', 'desc', 'mgm_finance_summary', '["net_profit_amt","sale_amt"]', 'bu_no=? AND YYYY_MM=?', 1, 1),
('roa',            '資產報酬率ROA','獲利能力', '財務比率', 's.net_profit_amt * 100 / Math.max(1, s.ttl_asset_amt)',
 '淨利 ÷ 資產總額 × 100%', '%', 'desc', 'mgm_finance_summary', '["net_profit_amt","ttl_asset_amt"]', 'bu_no=? AND YYYY_MM=?', 1, 1),
('roe',            '權益報酬率ROE','獲利能力', '財務比率', 's.net_profit_amt * 100 / Math.max(1, (s.stockholder_amt !== undefined && s.stockholder_amt !== null && s.stockholder_amt !== 0 ? s.stockholder_amt : ((s.captial_stock||0)+(s.captial_reserve||0)+(s.accumulated_amt||0))))',
 '淨利 ÷ 股東權益 × 100%', '%', 'desc', 'mgm_finance_summary', '["net_profit_amt","stockholder_amt","captial_stock","captial_reserve","accumulated_amt"]', 'bu_no=? AND YYYY_MM=?', 1, 1),

-- ---------- 成長能力 ----------
('sale_growth',    '銷售成長率',  '成長能力', '成長指標', 'p ? ((s.sale_amt - p.sale_amt) / Math.max(1, p.sale_amt)) * 100 : null',
 '(本期銷售 − 上期銷售) ÷ 上期銷售 × 100%', '%', 'desc', 'mgm_finance_summary', '["sale_amt"]', 'bu_no=? AND YYYY_MM=? 與上期', 1, 0),
('profit_growth',  '淨利成長率',  '成長能力', '成長指標', 'p ? ((s.net_profit_amt - p.net_profit_amt) / Math.max(1, Math.abs(p.net_profit_amt||1))) * 100 : null',
 '(本期淨利 − 上期淨利) ÷ |上期淨利| × 100%', '%', 'desc', 'mgm_finance_summary', '["net_profit_amt"]', 'bu_no=? AND YYYY_MM=? 與上期', 1, 0),

-- ---------- Z 模型 ----------
('altman_z1',      'Z1 值(上市公司)','Z模型分析','預警模型', '(() => { const ta = s.ttl_asset_amt || 1; const wc = s.current_asset_amt - (s.current_debet_amt||s.AP_amt); const re = s.accumulated_amt||0; const ebit = (s.net_profit_amt||0) + (s.interest_amt||0); const eq = s.stockholder_amt||((s.captial_stock||0)+(s.captial_reserve||0)+(s.accumulated_amt||0)); const debt = s.ttl_debet_amt||((s.loan_amt||0)+(s.AP_amt||0)+(s.LT_loan_amt||0)); return (1.2*wc/ta + 1.4*re/ta + 3.3*ebit/ta + 0.6*eq/Math.max(1,debt) + 0.999*s.sale_amt/ta); })()',
 'Altman Z1 = 1.2×營運資本/資產 + 1.4×留存收益/資產 + 3.3×EBIT/資產 + 0.6×權益/負債 + 0.999×銷售/資產', '分', 'desc', 'mgm_finance_summary', '["ttl_asset_amt","current_asset_amt","current_debet_amt","AP_amt","accumulated_amt","net_profit_amt","interest_amt","stockholder_amt","captial_stock","captial_reserve","ttl_debet_amt","loan_amt","LT_loan_amt","sale_amt"]', 'bu_no=? AND YYYY_MM=?', 1, 0),
('altman_z2',      'Z2 值(非上市)','Z模型分析','預警模型', '(() => { const ta = s.ttl_asset_amt || 1; const wc = s.current_asset_amt - (s.current_debet_amt||s.AP_amt); const re = s.accumulated_amt||0; const ebit = (s.net_profit_amt||0) + (s.interest_amt||0); const eq = s.stockholder_amt||((s.captial_stock||0)+(s.captial_reserve||0)+(s.accumulated_amt||0)); const debt = s.ttl_debet_amt||((s.loan_amt||0)+(s.AP_amt||0)+(s.LT_loan_amt||0)); return (6.56*wc/ta + 3.26*re/ta + 6.72*ebit/ta + 1.05*eq/Math.max(1,debt)); })()',
 'Altman Z2 = 6.56×營運資本/資產 + 3.26×留存收益/資產 + 6.72×EBIT/資產 + 1.05×權益/負債', '分', 'desc', 'mgm_finance_summary', '["ttl_asset_amt","current_asset_amt","current_debet_amt","AP_amt","accumulated_amt","net_profit_amt","interest_amt","stockholder_amt","captial_stock","captial_reserve","ttl_debet_amt","loan_amt","LT_loan_amt"]', 'bu_no=? AND YYYY_MM=?', 1, 0),

-- ---------- 董事會報告專用（合併層級）----------
('consol_revenue', '合併營業收入', '合併報表', '合併指標', 's.sale_amt',
 '各公司營業收入加總（折算到集團本位幣）', '元', 'desc', 'mgm_finance_summary', '["sale_amt"]', 'YYYY_MM=? AND bu_no IN (?) 加總', 0, 0),
('consol_asset',   '合併總資產',   '合併報表', '合併指標', 's.ttl_asset_amt',
 '各公司總資產加總（折算到集團本位幣）', '元', 'desc', 'mgm_finance_summary', '["ttl_asset_amt"]', 'YYYY_MM=? AND bu_no IN (?) 加總', 0, 0),
('consol_equity',  '合併股東權益', '合併報表', '合併指標', 's.stockholder_amt',
 '各公司股東權益加總（折算到集團本位幣）', '元', 'desc', 'mgm_finance_summary', '["stockholder_amt"]', 'YYYY_MM=? AND bu_no IN (?) 加總', 0, 0),

-- ---------- 預警監控用 ----------
('ar_overdue_days','應收逾期天數',  '預警監控', '預警指標', '365 / Math.max(0.01, s.sale_amt / Math.max(1, s.AR_amt))',
 '等同 ar_days，值越高代表應收週轉慢', '天', 'asc', 'mgm_finance_summary', '["sale_amt","AR_amt"]', 'bu_no=? AND YYYY_MM=?', 1, 1),
('cash_depletion_rate','現金消耗率','預警監控','預警指標', '((s.cash_amt + s.deposite_amt) - (p ? (p.cash_amt||0)+(p.deposite_amt||0) : 0)) / Math.max(1, p ? ((p.cash_amt||0)+(p.deposite_amt||0)) : 1) * 100',
 '(本月現金 − 上月現金) ÷ 上月現金 × 100%', '%', 'desc', 'mgm_finance_summary', '["cash_amt","deposite_amt"]', 'bu_no=? AND YYYY_MM=?', 0, 0)

ON DUPLICATE KEY UPDATE
  metric_name=VALUES(metric_name), metric_cat=VALUES(metric_cat), metric_group=VALUES(metric_group),
  formula_js=VALUES(formula_js), formula_desc=VALUES(formula_desc),
  unit=VALUES(unit), pct_type=VALUES(pct_type), source_table=VALUES(source_table),
  source_fields=VALUES(source_fields), benchmark_enabled=VALUES(benchmark_enabled),
  light_enabled=VALUES(light_enabled), update_time=NOW(), version=version+1;

-- ============================================================
-- 4. 數據血緣（組合指標依賴原子指標）
-- ============================================================
INSERT INTO cams_metric_lineage (metric_code, depends_on, notes) VALUES
('altman_z1', 'gross_margin',  'Z1 模型中的 ebit 隱含毛利結構'),
('altman_z2', 'gross_margin',  'Z2 模型中的 ebit 隱含毛利結構'),
('consol_gross_margin', 'gross_margin', '合併毛利率 = Σ(各家sale) - Σ(各家cost) ÷ Σ(各家sale)'),
('consol_net_margin',   'net_margin',   '合併淨利率 = Σ(各家net_profit) ÷ Σ(各家sale)'),
('consol_roe',          'roe',          '合併ROE = Σ(各家net_profit) ÷ Σ(各家equity)')
ON DUPLICATE KEY UPDATE notes=VALUES(notes);

INSERT INTO schema_migrations (version, applied_at, description) VALUES
('055_cto06_metric_center', NOW(), 'CTO-06 指標中心：統一 KPI 口徑 + 數據血緣')
ON DUPLICATE KEY UPDATE applied_at=NOW();