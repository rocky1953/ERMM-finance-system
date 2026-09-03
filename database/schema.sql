-- ============================================================
-- ERMM 財務模組資料庫 DDL
-- Database: ERMM_db (MySQL 8.3, utf8mb4)
-- Generated: 2026-09-02
-- ============================================================

USE ERMM_db;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ==================== 系統碼表 ====================
CREATE TABLE IF NOT EXISTS cams_system_codes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code_type VARCHAR(50) NOT NULL COMMENT '碼表類型: CURRENCY/BUSINESS_ID/AGEING_STOCK/BATCH_CONTROL/MO_CUTOFF/CUSTOM_CUTOFF/INV_CUTOFF/setup',
    code_value VARCHAR(100) NOT NULL COMMENT '代碼值',
    value_description VARCHAR(500) DEFAULT NULL COMMENT '說明',
    value_number1 DECIMAL(18,6) DEFAULT 0 COMMENT '數值1(匯率/減值率)',
    value_number2 DECIMAL(18,6) DEFAULT 0 COMMENT '數值2',
    value_number3 DECIMAL(18,6) DEFAULT 0 COMMENT '數值3(VAT_rate)',
    value_alpha1 VARCHAR(200) DEFAULT NULL COMMENT '字串1(授權碼)',
    value_alpha2 VARCHAR(200) DEFAULT NULL COMMENT '字串2',
    value_date1 DATE DEFAULT NULL COMMENT '日期1(初始授權到期)',
    value_date2 DATE DEFAULT NULL COMMENT '日期2(終止授權到期)',
    inuse_flag VARCHAR(10) DEFAULT 'USE' COMMENT 'USE/NOUSE',
    sort_order INT DEFAULT 0,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_code (code_type, code_value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系統碼表';

-- ==================== 批次控制表 ====================
CREATE TABLE IF NOT EXISTS cams_batch_control (
    id INT AUTO_INCREMENT PRIMARY KEY,
    batch_id VARCHAR(50) NOT NULL COMMENT '批次ID',
    step_name VARCHAR(100) NOT NULL COMMENT '步驟名稱',
    seq_SQL INT NOT NULL COMMENT '執行順序',
    process_status VARCHAR(10) DEFAULT '00' COMMENT '00=完成/01=執行中/99=失敗',
    break_point VARCHAR(5) DEFAULT 'N' COMMENT 'Y=中斷點',
    start_time DATETIME DEFAULT NULL,
    end_time DATETIME DEFAULT NULL,
    error_msg TEXT DEFAULT NULL,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_batch (batch_id),
    INDEX idx_status (process_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='批次控制表';

-- ==================== 使用者權限表 ====================
CREATE TABLE IF NOT EXISTS cams_xuser (
    id INT AUTO_INCREMENT PRIMARY KEY,
    xuser_id VARCHAR(50) NOT NULL UNIQUE COMMENT '使用者帳號',
    xuser_password VARCHAR(200) NOT NULL COMMENT '加密密碼',
    xuser_name VARCHAR(100) DEFAULT NULL,
    xuser_dept VARCHAR(100) DEFAULT NULL,
    client_id VARCHAR(50) DEFAULT NULL,
    inuse_flag VARCHAR(10) DEFAULT 'USE',
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='使用者帳號表';

CREATE TABLE IF NOT EXISTS leader_user (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL COMMENT '使用者ID',
    procurement VARCHAR(3) DEFAULT 'N',
    sales VARCHAR(3) DEFAULT 'N',
    production VARCHAR(3) DEFAULT 'N',
    engineer VARCHAR(3) DEFAULT 'N',
    handbook VARCHAR(3) DEFAULT 'N',
    wk_plan VARCHAR(3) DEFAULT 'N',
    quality VARCHAR(3) DEFAULT 'N',
    document VARCHAR(3) DEFAULT 'N',
    price VARCHAR(3) DEFAULT 'N',
    stock VARCHAR(3) DEFAULT 'N',
    finance VARCHAR(3) DEFAULT 'Y',
    imex VARCHAR(3) DEFAULT 'N',
    others VARCHAR(3) DEFAULT 'N',
    class VARCHAR(3) DEFAULT '1' COMMENT '管理等級 1-5',
    login VARCHAR(3) DEFAULT 'N',
    INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='使用者權限表';

CREATE TABLE IF NOT EXISTS login_user_record (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    bu_no VARCHAR(50) DEFAULT NULL,
    login_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    logoff_time DATETIME DEFAULT NULL,
    use_cnt INT DEFAULT 0,
    xwebpage_id VARCHAR(100) DEFAULT NULL,
    INDEX idx_user (user_id),
    INDEX idx_login_time (login_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='登入紀錄表';

-- ==================== 7 張核心財務表 ====================

-- ERMM_ARAP_detail: 應收應付彙總表
CREATE TABLE IF NOT EXISTS ERMM_ARAP_detail (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    bu_no VARCHAR(20) NOT NULL COMMENT '業務單位/公司別',
    YYYY VARCHAR(10) NOT NULL COMMENT '年度',
    YYYY_MM VARCHAR(10) NOT NULL COMMENT '年月 2026/09',
    AR_amt DECIMAL(18,2) DEFAULT 0 COMMENT '應收帳款',
    AP_amt DECIMAL(18,2) DEFAULT 0 COMMENT '應付帳款',
    AR_ageing DECIMAL(18,2) DEFAULT 0 COMMENT '應收帳齡金額',
    AP_ageing DECIMAL(18,2) DEFAULT 0 COMMENT '應付帳齡金額',
    batch_id VARCHAR(50) DEFAULT NULL,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_bu_ym (bu_no, YYYY_MM),
    INDEX idx_bu (bu_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='應收應付彙總表';

-- MGM_invoice_details: 發票明細表
CREATE TABLE IF NOT EXISTS MGM_invoice_details (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    bu_no VARCHAR(20) NOT NULL,
    TX_type VARCHAR(10) NOT NULL COMMENT 'AR/AP',
    order_id VARCHAR(50) DEFAULT NULL COMMENT '訂單編號(SO/PO)',
    client_id VARCHAR(50) DEFAULT NULL COMMENT '客戶/供應商',
    invoice_no VARCHAR(50) DEFAULT NULL,
    sub_amt DECIMAL(18,2) DEFAULT 0 COMMENT '金額',
    tax_type VARCHAR(20) DEFAULT NULL,
    tax_rate DECIMAL(10,4) DEFAULT 0,
    VAT_amt DECIMAL(18,2) DEFAULT 0,
    wk_date DATE DEFAULT NULL COMMENT '發票日期',
    pay_date DATE DEFAULT NULL COMMENT '付款日期',
    payment DECIMAL(18,2) DEFAULT 0 COMMENT '已付款',
    ageing_days INT DEFAULT 0 COMMENT '帳齡天數',
    DB_CR VARCHAR(3) DEFAULT NULL COMMENT '借貸別 DR/CR',
    YYYY_MM VARCHAR(10) DEFAULT NULL,
    remark TEXT DEFAULT NULL,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_bu_tx_inv (bu_no, TX_type, invoice_no),
    INDEX idx_bu_order (bu_no, order_id),
    INDEX idx_bu_ym (bu_no, YYYY_MM)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='發票明細表';

-- MGM_casher_details: 現金日記帳
CREATE TABLE IF NOT EXISTS MGM_casher_details (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    bu_no VARCHAR(20) NOT NULL,
    amt_type VARCHAR(20) DEFAULT NULL COMMENT '收支類型',
    client_id VARCHAR(50) DEFAULT NULL,
    num_vman VARCHAR(50) NOT NULL COMMENT '發票/收據號碼(唯一)',
    sub_amt DECIMAL(18,2) DEFAULT 0 COMMENT '金額',
    DB_CR VARCHAR(3) NOT NULL COMMENT 'DR=借方(收款)/CR=貸方(付款)',
    YYYY VARCHAR(10) DEFAULT NULL,
    MM VARCHAR(5) DEFAULT NULL,
    YYYY_MM VARCHAR(10) DEFAULT NULL,
    wk_date DATE DEFAULT NULL,
    bank_acct VARCHAR(50) DEFAULT NULL COMMENT '銀行帳號',
    remark TEXT DEFAULT NULL,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_num_vman (bu_no, num_vman),
    INDEX idx_bu_ym (bu_no, YYYY_MM),
    INDEX idx_bu_date (bu_no, wk_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='現金日記帳';

-- MGM_account_details: 帳戶明細表
CREATE TABLE IF NOT EXISTS MGM_account_details (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    bu_no VARCHAR(20) NOT NULL,
    YYYY_MM VARCHAR(10) DEFAULT NULL,
    acct_type VARCHAR(20) DEFAULT NULL COMMENT '帳戶類型',
    group_id VARCHAR(30) DEFAULT NULL COMMENT '科目大類',
    sub_group VARCHAR(30) DEFAULT NULL COMMENT '子科目',
    acct_name VARCHAR(100) DEFAULT NULL,
    sub_amt DECIMAL(18,2) DEFAULT 0,
    DB_CR VARCHAR(3) DEFAULT NULL,
    remark TEXT DEFAULT NULL,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_bu_ym_sub (bu_no, YYYY_MM, sub_group),
    INDEX idx_bu_ym (bu_no, YYYY_MM)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='帳戶明細表';

-- MGM_bank_loan_details: 銀行貸款明細表
CREATE TABLE IF NOT EXISTS MGM_bank_loan_details (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    bu_no VARCHAR(20) NOT NULL,
    YYYY VARCHAR(10) DEFAULT NULL,
    acct_no VARCHAR(50) DEFAULT NULL COMMENT '帳戶號碼',
    type1 VARCHAR(20) DEFAULT NULL COMMENT '存款/貸款/還款',
    acct_amt DECIMAL(18,2) DEFAULT 0 COMMENT '帳戶金額',
    unit VARCHAR(10) DEFAULT NULL COMMENT '幣別',
    loan_id VARCHAR(50) DEFAULT NULL COMMENT '借/貸款編號',
    bank_id VARCHAR(50) DEFAULT NULL COMMENT '銀行代碼',
    branch_id VARCHAR(50) DEFAULT NULL,
    loan_type VARCHAR(50) DEFAULT NULL COMMENT '貸款類型',
    pay_terms INT DEFAULT 0 COMMENT '還款週期(月)',
    terms_rate DECIMAL(10,4) DEFAULT 0 COMMENT '利率%',
    interest_rate DECIMAL(10,4) DEFAULT 0 COMMENT '利率',
    begin_date DATE DEFAULT NULL COMMENT '起借日期',
    end_date DATE DEFAULT NULL COMMENT '到期日期',
    pay_days INT DEFAULT 0 COMMENT '距下次利息日天數',
    payback_amt DECIMAL(18,2) DEFAULT 0 COMMENT '已還本金',
    loan_amt DECIMAL(18,2) DEFAULT 0 COMMENT '貸款金額',
    exchange_rate DECIMAL(18,6) DEFAULT 1 COMMENT '匯率',
    last_paydate DATE DEFAULT NULL COMMENT '上次利息日',
    next_paydate DATE DEFAULT NULL COMMENT '下次利息日',
    status1 VARCHAR(20) DEFAULT '使用中',
    loan_desc TEXT DEFAULT NULL,
    diff_amt DECIMAL(18,2) DEFAULT 0 COMMENT '匯兌差額',
    loss_flag VARCHAR(3) DEFAULT 'N' COMMENT 'Y=匯兌損失',
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_bu_loan (bu_no, loan_id),
    INDEX idx_bu_acct (bu_no, acct_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='銀行貸款明細表';

-- MGM_KPI_desc: KPI 門檻定義表
CREATE TABLE IF NOT EXISTS MGM_KPI_desc (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    bu_no VARCHAR(20) NOT NULL,
    KPI_id VARCHAR(50) NOT NULL,
    KPI_name VARCHAR(100) DEFAULT NULL,
    KPI1 DECIMAL(18,4) DEFAULT 0 COMMENT '下限',
    KPI2 DECIMAL(18,4) DEFAULT 0 COMMENT '上限',
    unit VARCHAR(20) DEFAULT NULL,
    pct_type VARCHAR(5) DEFAULT NULL COMMENT 'asc/desc 判定方向',
    KPI_value DECIMAL(18,4) DEFAULT 0 COMMENT '當前值',
    KPI_color VARCHAR(10) DEFAULT NULL COMMENT 'RED/YELLOW/GREEN',
    remark TEXT DEFAULT NULL,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_bu_kpi (bu_no, KPI_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='KPI 門檻定義表';

-- MGM_finance_summary: 財務摘要/報表主表 (200+ 欄位)
CREATE TABLE IF NOT EXISTS MGM_finance_summary (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    bu_no VARCHAR(20) NOT NULL,
    YYYY_MM VARCHAR(10) NOT NULL COMMENT '年月 2026/09',
    YYYY VARCHAR(10) DEFAULT NULL,
    MM VARCHAR(5) DEFAULT NULL,
    flag VARCHAR(10) DEFAULT NULL,
    
    -- === 資產類 (流動資產) ===
    cash_amt DECIMAL(18,2) DEFAULT 0 COMMENT '現金',
    deposite_amt DECIMAL(18,2) DEFAULT 0 COMMENT '銀行存款',
    interest_amt DECIMAL(18,2) DEFAULT 0 COMMENT '應收利息',
    AR_amt DECIMAL(18,2) DEFAULT 0 COMMENT '應收帳款',
    AR_bill_amt DECIMAL(18,2) DEFAULT 0 COMMENT '應收票據',
    AR_debet_amt DECIMAL(18,2) DEFAULT 0 COMMENT '應收借項',
    AR_temp_amt DECIMAL(18,2) DEFAULT 0 COMMENT '暫收款',
    AR_affiliate_amt DECIMAL(18,2) DEFAULT 0 COMMENT '關係人應收',
    AR_other_amt DECIMAL(18,2) DEFAULT 0 COMMENT '其他應收',
    AR_dividend_amt DECIMAL(18,2) DEFAULT 0 COMMENT '應收股利',
    
    -- === 存貨類 ===
    stock_P_amt DECIMAL(18,2) DEFAULT 0 COMMENT '製成品存貨',
    stock_M_amt DECIMAL(18,2) DEFAULT 0 COMMENT '原料存貨',
    stock_S_amt DECIMAL(18,2) DEFAULT 0 COMMENT '副料存貨',
    stock_transit_amt DECIMAL(18,2) DEFAULT 0 COMMENT '在途存貨',
    stock_value_amt DECIMAL(18,2) DEFAULT 0 COMMENT '存貨價值合計',
    WIP_M_amt DECIMAL(18,2) DEFAULT 0 COMMENT '在製品-材料',
    WIP_labor_amt DECIMAL(18,2) DEFAULT 0 COMMENT '在製品-人工',
    WIP_EXP_amt DECIMAL(18,2) DEFAULT 0 COMMENT '在製品-費用',
    reserve_loss_amt DECIMAL(18,2) DEFAULT 0 COMMENT '備抵損失(減項)',
    
    -- === 預付類 ===
    prepay_EXP_amt DECIMAL(18,2) DEFAULT 0 COMMENT '預付設備',
    prepay_goods_amt DECIMAL(18,2) DEFAULT 0 COMMENT '預付貨款',
    LQ_prepay_EQMT_amt DECIMAL(18,2) DEFAULT 0 COMMENT '流動預付設備',
    
    -- === 非流動資產 ===
    building_amt DECIMAL(18,2) DEFAULT 0 COMMENT '房屋及建築',
    acc_de_building DECIMAL(18,2) DEFAULT 0 COMMENT '房屋累計折舊',
    equipment_amt DECIMAL(18,2) DEFAULT 0 COMMENT '機器設備',
    acc_de_EQMT DECIMAL(18,2) DEFAULT 0 COMMENT '設備累計折舊',
    vehicle_amt DECIMAL(18,2) DEFAULT 0 COMMENT '運輸設備',
    acc_de_vehicle DECIMAL(18,2) DEFAULT 0 COMMENT '車輛累計折舊',
    office_amt DECIMAL(18,2) DEFAULT 0 COMMENT '辦公設備',
    acc_de_office DECIMAL(18,2) DEFAULT 0 COMMENT '辦公累計折舊',
    intangible_amt DECIMAL(18,2) DEFAULT 0 COMMENT '無形資產',
    
    -- === 資產總額 ===
    LQ_asset_amt DECIMAL(18,2) DEFAULT 0 COMMENT '流動資產合計',
    FX_asset_amt DECIMAL(18,2) DEFAULT 0 COMMENT '非流動資產合計',
    other_asset_amt DECIMAL(18,2) DEFAULT 0 COMMENT '其他資產',
    ttl_asset_amt DECIMAL(18,2) DEFAULT 0 COMMENT '資產總額',
    current_asset_amt DECIMAL(18,2) DEFAULT 0 COMMENT '流動資產小計',
    non_current_asset_amt DECIMAL(18,2) DEFAULT 0 COMMENT '非流動資產小計',
    
    -- === 流動負債 ===
    loan_amt DECIMAL(18,2) DEFAULT 0 COMMENT '短期借款',
    AP_amt DECIMAL(18,2) DEFAULT 0 COMMENT '應付帳款',
    AP_tax_amt DECIMAL(18,2) DEFAULT 0 COMMENT '應付稅費',
    AP_salary_amt DECIMAL(18,2) DEFAULT 0 COMMENT '應付薪資',
    AP_other_amt DECIMAL(18,2) DEFAULT 0 COMMENT '其他應付',
    deposit_liab_amt DECIMAL(18,2) DEFAULT 0 COMMENT '預收款項',
    
    -- === 長期負債 ===
    LT_loan_amt DECIMAL(18,2) DEFAULT 0 COMMENT '長期借款',
    LT_debet_amt DECIMAL(18,2) DEFAULT 0 COMMENT '長期負債合計',
    
    -- === 負債總額 ===
    LQ_debet_amt DECIMAL(18,2) DEFAULT 0 COMMENT '流動負債合計',
    debet_amt DECIMAL(18,2) DEFAULT 0 COMMENT '負債總額',
    
    -- === 股東權益 ===
    captial_stock DECIMAL(18,2) DEFAULT 0 COMMENT '股本',
    captial_reserve DECIMAL(18,2) DEFAULT 0 COMMENT '資本公積',
    legal_reserve DECIMAL(18,2) DEFAULT 0 COMMENT '法定盈餘公積',
    accumulated_amt DECIMAL(18,2) DEFAULT 0 COMMENT '累積盈餘',
    current_PL_amt DECIMAL(18,2) DEFAULT 0 COMMENT '本期損益',
    stockholder_amt DECIMAL(18,2) DEFAULT 0 COMMENT '股東權益合計',
    ttl_debet_amt DECIMAL(18,2) DEFAULT 0 COMMENT '負債及權益總額',
    current_debet_amt DECIMAL(18,2) DEFAULT 0 COMMENT '流動負債小計',
    long_term_debet_amt DECIMAL(18,2) DEFAULT 0 COMMENT '長期負債小計',
    
    -- === 損益類 (收入) ===
    sale_amt DECIMAL(18,2) DEFAULT 0 COMMENT '銷貨收入',
    sale_cost_amt DECIMAL(18,2) DEFAULT 0 COMMENT '銷貨成本',
    sale_discount_amt DECIMAL(18,2) DEFAULT 0 COMMENT '銷貨折扣',
    net_sale_amt DECIMAL(18,2) DEFAULT 0 COMMENT '銷貨淨額',
    
    -- === 損益類 (費用) ===
    sale_exp_amt DECIMAL(18,2) DEFAULT 0 COMMENT '銷售費用',
    MGM_EXP_amt DECIMAL(18,2) DEFAULT 0 COMMENT '管理費用',
    finance_EXP_amt DECIMAL(18,2) DEFAULT 0 COMMENT '財務費用',
    operation_EXP_amt DECIMAL(18,2) DEFAULT 0 COMMENT '營業費用合計',
    
    -- === 損益類 (其他) ===
    BIZ_other_INC_amt DECIMAL(18,2) DEFAULT 0 COMMENT '營業外收入',
    others_INC_amt DECIMAL(18,2) DEFAULT 0 COMMENT '其他收入',
    others_cost_amt DECIMAL(18,2) DEFAULT 0 COMMENT '其他支出',
    INVEST_profit_amt DECIMAL(18,2) DEFAULT 0 COMMENT '投資收益',
    AR_subsidy_amt DECIMAL(18,2) DEFAULT 0 COMMENT '補貼收入',
    
    -- === 損益計算鏈 ===
    BIZ_major_margin_amt DECIMAL(18,2) DEFAULT 0 COMMENT '營業毛利=sale-cost-VAT',
    BIZ_margin_amt DECIMAL(18,2) DEFAULT 0 COMMENT '營業利益',
    operation_profit_amt DECIMAL(18,2) DEFAULT 0 COMMENT '營業利潤',
    pretax_profit_amt DECIMAL(18,2) DEFAULT 0 COMMENT '稅前淨利',
    net_profit_amt DECIMAL(18,2) DEFAULT 0 COMMENT '淨利',
    sale_profit DECIMAL(18,2) DEFAULT 0 COMMENT '銷貨利潤',
    retained_income_amt DECIMAL(18,2) DEFAULT 0 COMMENT '保留盈餘',
    
    -- === 稅務 ===
    VAT_rate DECIMAL(10,4) DEFAULT 0 COMMENT '增值稅率',
    VAT_amt DECIMAL(18,2) DEFAULT 0 COMMENT '增值稅額',
    free_tax_sale_amt DECIMAL(18,2) DEFAULT 0 COMMENT '免稅銷售',
    on_tax_sale_amt DECIMAL(18,2) DEFAULT 0 COMMENT '應稅銷售',
    on_tax_goods_amt DECIMAL(18,2) DEFAULT 0 COMMENT '應稅貨物',
    on_tax_service_amt DECIMAL(18,2) DEFAULT 0 COMMENT '應稅勞務',
    po_tax_out_amt DECIMAL(18,2) DEFAULT 0 COMMENT '進項稅額',
    AP_tax_deduct_amt DECIMAL(18,2) DEFAULT 0 COMMENT '應付稅抵扣',
    addon_tax_amt DECIMAL(18,2) DEFAULT 0 COMMENT '附加稅',
    ttl_tax_simple_amt DECIMAL(18,2) DEFAULT 0 COMMENT '稅額合計',
    sale_tax_amt DECIMAL(18,2) DEFAULT 0 COMMENT '銷項稅額',
    
    -- === 現金流量 ===
    cash_begin_amt DECIMAL(18,2) DEFAULT 0 COMMENT '期初現金',
    cash_operation_in DECIMAL(18,2) DEFAULT 0 COMMENT '營業活動現金流入',
    cash_operation_out DECIMAL(18,2) DEFAULT 0 COMMENT '營業活動現金流出',
    cash_invest_in DECIMAL(18,2) DEFAULT 0 COMMENT '投資活動現金流入',
    cash_invest_out DECIMAL(18,2) DEFAULT 0 COMMENT '投資活動現金流出',
    cash_finance_in DECIMAL(18,2) DEFAULT 0 COMMENT '籌資活動現金流入',
    cash_finance_out DECIMAL(18,2) DEFAULT 0 COMMENT '籌資活動現金流出',
    cash_end_amt DECIMAL(18,2) DEFAULT 0 COMMENT '期末現金',
    
    -- === 風險模型 ===
    -- Z-Score 5 個變數
    Z_X1 DECIMAL(18,4) DEFAULT 0 COMMENT '(流動資產-流動負債)/總資產',
    Z_X2 DECIMAL(18,4) DEFAULT 0 COMMENT '保留盈餘/總資產',
    Z_X3 DECIMAL(18,4) DEFAULT 0 COMMENT '營業利潤/總資產',
    Z_X4 DECIMAL(18,4) DEFAULT 0 COMMENT '(股本+特別股)/總負債',
    Z_X5 DECIMAL(18,4) DEFAULT 0 COMMENT '銷貨收入/總資產',
    
    Z_score DECIMAL(18,4) DEFAULT 0 COMMENT 'Z-Score',
    Z2_score DECIMAL(18,4) DEFAULT 0 COMMENT 'Z2-Score(私人公司)',
    Z3_score DECIMAL(18,4) DEFAULT 0 COMMENT 'Z3-Score(非製造業)',
    
    -- BZ 破產概率模型
    BZ_X1 DECIMAL(18,4) DEFAULT 0,
    BZ_X2 DECIMAL(18,4) DEFAULT 0,
    BZ_X3 DECIMAL(18,4) DEFAULT 0,
    BZ_X4 DECIMAL(18,4) DEFAULT 0,
    BZ_X5 DECIMAL(18,4) DEFAULT 0,
    BZ_model DECIMAL(18,4) DEFAULT 0 COMMENT 'BZ 破產概率',
    
    -- JZ 營運能力模型
    JZ_ZA DECIMAL(18,4) DEFAULT 0,
    JZ_ZB DECIMAL(18,4) DEFAULT 0,
    JZ_ZC DECIMAL(18,4) DEFAULT 0,
    JZ_ZD DECIMAL(18,4) DEFAULT 0,
    JZ_model DECIMAL(18,4) DEFAULT 0 COMMENT 'JZ 營運能力',
    
    -- Wolf 模型
    wall_mode VARCHAR(20) DEFAULT NULL COMMENT 'Wolf 模型結果',
    
    -- KPI 燈號
    risk_color VARCHAR(10) DEFAULT NULL COMMENT '風險燈號 RED/YELLOW/GREEN',
    
    -- === 比率分析 ===
    current_ratio DECIMAL(18,4) DEFAULT 0 COMMENT '流動比率',
    quick_ratio DECIMAL(18,4) DEFAULT 0 COMMENT '速動比率',
    debt_ratio DECIMAL(18,4) DEFAULT 0 COMMENT '負債比率',
    ROI DECIMAL(18,4) DEFAULT 0 COMMENT '投資報酬率',
    ROE DECIMAL(18,4) DEFAULT 0 COMMENT '股東權益報酬率',
    ROA DECIMAL(18,4) DEFAULT 0 COMMENT '資產報酬率',
    gross_margin DECIMAL(18,4) DEFAULT 0 COMMENT '毛利率',
    net_margin DECIMAL(18,4) DEFAULT 0 COMMENT '淨利率',
    asset_turnover DECIMAL(18,4) DEFAULT 0 COMMENT '資產週轉率',
    inventory_turnover DECIMAL(18,4) DEFAULT 0 COMMENT '存貨週轉率',
    receivable_turnover DECIMAL(18,4) DEFAULT 0 COMMENT '應收帳款週轉率',
    IRR DECIMAL(18,4) DEFAULT 0 COMMENT '內部報酬率',
    
    -- === 人事 ===
    employee_cnt INT DEFAULT 0 COMMENT '員工人數',
    salary_amt DECIMAL(18,2) DEFAULT 0 COMMENT '薪資總額',
    avg_salary DECIMAL(18,2) DEFAULT 0 COMMENT '平均薪資',
    
    -- === 其他 ===
    exchange_rate DECIMAL(18,6) DEFAULT 1 COMMENT '當前匯率',
    batch_id VARCHAR(50) DEFAULT NULL COMMENT '最後更新批次',
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_bu_ym (bu_no, YYYY_MM),
    INDEX idx_bu_type (bu_no, flag),
    UNIQUE KEY uk_bu_ym (bu_no, YYYY_MM)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='財務摘要主表(200+欄位)';

-- ==================== 7 張支援表 ====================

-- pay_detail: 付款明細表
CREATE TABLE IF NOT EXISTS pay_detail (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    bu_no VARCHAR(20) NOT NULL,
    supplier_name VARCHAR(100) DEFAULT NULL,
    finance_type VARCHAR(50) DEFAULT NULL COMMENT '費用類型',
    should_date DATE DEFAULT NULL COMMENT '應付日期',
    invoice_date DATE DEFAULT NULL COMMENT '發票日期',
    amount DECIMAL(18,2) DEFAULT 0,
    currency_ab VARCHAR(10) DEFAULT NULL,
    invoice_num VARCHAR(50) DEFAULT NULL,
    pay_date DATE DEFAULT NULL COMMENT '付款日期 NULL=未付款',
    expense_content TEXT DEFAULT NULL,
    remark TEXT DEFAULT NULL,
    entry_date DATE DEFAULT NULL,
    data_year VARCHAR(10) DEFAULT NULL,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_bu_pay (bu_no, invoice_num),
    INDEX idx_bu_supplier (bu_no, supplier_name),
    INDEX idx_bu_date (bu_no, should_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='付款明細表';

-- check_detail: 票據/支票明細表
CREATE TABLE IF NOT EXISTS check_detail (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    bu_no VARCHAR(20) NOT NULL,
    check_type VARCHAR(20) DEFAULT NULL COMMENT '現金支票/轉帳支票',
    check_num VARCHAR(50) NOT NULL,
    company_id VARCHAR(50) DEFAULT NULL,
    check_date DATE DEFAULT NULL COMMENT '開票日',
    due_date DATE DEFAULT NULL COMMENT '到期日',
    amount DECIMAL(18,2) DEFAULT 0,
    to_company VARCHAR(200) DEFAULT NULL COMMENT '受票單位',
    bank_acct VARCHAR(50) DEFAULT NULL,
    status VARCHAR(20) DEFAULT '未兌現' COMMENT '未兌現/已兌現/作廢',
    remark TEXT DEFAULT NULL,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_bu_check (bu_no, check_num),
    INDEX idx_bu_date (bu_no, check_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='票據明細表';

-- branch_detail: 分公司表
CREATE TABLE IF NOT EXISTS branch_detail (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    bu_no VARCHAR(20) NOT NULL,
    branch_id VARCHAR(50) NOT NULL,
    branch_name VARCHAR(100) DEFAULT NULL,
    branch_address VARCHAR(300) DEFAULT NULL,
    branch_phone VARCHAR(50) DEFAULT NULL,
    manager VARCHAR(50) DEFAULT NULL,
    inuse_flag VARCHAR(10) DEFAULT 'USE',
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_bu_branch (bu_no, branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='分公司表';

-- relation_detail: 往來對象表
CREATE TABLE IF NOT EXISTS relation_detail (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    bu_no VARCHAR(20) NOT NULL,
    relation_id VARCHAR(50) NOT NULL,
    relation_name VARCHAR(100) DEFAULT NULL,
    relation_type VARCHAR(30) DEFAULT NULL COMMENT '客戶/供應商/關係人',
    contact_person VARCHAR(50) DEFAULT NULL,
    contact_phone VARCHAR(50) DEFAULT NULL,
    address VARCHAR(300) DEFAULT NULL,
    tax_id VARCHAR(30) DEFAULT NULL COMMENT '統一編號/稅號',
    inuse_flag VARCHAR(10) DEFAULT 'USE',
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_bu_relation (bu_no, relation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='往來對象表';

-- transit_price: 在途價格表
CREATE TABLE IF NOT EXISTS transit_price (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    bu_no VARCHAR(20) NOT NULL,
    xitems VARCHAR(100) NOT NULL COMMENT '物料編號',
    item_name VARCHAR(200) DEFAULT NULL,
    qty DECIMAL(18,4) DEFAULT 0,
    unit_price DECIMAL(18,6) DEFAULT 0,
    exchange_rate DECIMAL(18,6) DEFAULT 1,
    transit_amt DECIMAL(18,2) DEFAULT 0 COMMENT '在途金額',
    vessel_name VARCHAR(100) DEFAULT NULL COMMENT '船名',
    ETD_date DATE DEFAULT NULL COMMENT '預計啟運',
    ETA_date DATE DEFAULT NULL COMMENT '預計到港',
    po_id VARCHAR(50) DEFAULT NULL,
    remark TEXT DEFAULT NULL,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_bu_item (bu_no, xitems)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='在途價格表';

-- forecast_detail: 預測明細表
CREATE TABLE IF NOT EXISTS forecast_detail (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    bu_no VARCHAR(20) NOT NULL,
    YYYY_MM VARCHAR(10) NOT NULL,
    forecast_type VARCHAR(30) DEFAULT NULL COMMENT '銷售/採購/現金',
    forecast_amt DECIMAL(18,2) DEFAULT 0,
    actual_amt DECIMAL(18,2) DEFAULT 0,
    diff_amt DECIMAL(18,2) DEFAULT 0,
    remark TEXT DEFAULT NULL,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_bu_ym_type (bu_no, YYYY_MM, forecast_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='預測明細表';

-- monthly_items: 月度項目表
CREATE TABLE IF NOT EXISTS monthly_items (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    bu_no VARCHAR(20) NOT NULL,
    YYYY_MM VARCHAR(10) NOT NULL,
    item_type VARCHAR(30) DEFAULT NULL COMMENT '租金/水電/薪資/保險',
    item_name VARCHAR(100) DEFAULT NULL,
    item_amt DECIMAL(18,2) DEFAULT 0,
    pay_date DATE DEFAULT NULL,
    DB_CR VARCHAR(3) DEFAULT NULL,
    remark TEXT DEFAULT NULL,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_bu_ym (bu_no, YYYY_MM)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='月度項目表';

-- ==================== 關聯資料表 (ERP 模擬) ====================

-- ERMM_erp_SO: 銷售訂單 (AR 來源)
CREATE TABLE IF NOT EXISTS ERMM_erp_SO (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    bu_no VARCHAR(20) NOT NULL,
    so_nbr VARCHAR(50) DEFAULT NULL,
    client_id VARCHAR(50) DEFAULT NULL,
    client_name VARCHAR(200) DEFAULT NULL,
    xitems VARCHAR(100) DEFAULT NULL,
    so_date DATE DEFAULT NULL,
    so_qty DECIMAL(18,4) DEFAULT 0,
    dn_qty DECIMAL(18,4) DEFAULT 0 COMMENT '交貨數量',
    unit_price DECIMAL(18,6) DEFAULT 0,
    YYYY VARCHAR(10) DEFAULT NULL,
    MM VARCHAR(5) DEFAULT NULL,
    YYYY_MM VARCHAR(10) DEFAULT NULL,
    status VARCHAR(20) DEFAULT NULL,
    remark TEXT DEFAULT NULL,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_bu (bu_no),
    INDEX idx_bu_ym (bu_no, YYYY_MM),
    INDEX idx_so_nbr (bu_no, so_nbr)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='銷售訂單(AR來源)';

-- ermm_erp_po: 採購訂單 (AP 來源)
CREATE TABLE IF NOT EXISTS ermm_erp_po (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    bu_no VARCHAR(20) NOT NULL,
    po_id VARCHAR(50) DEFAULT NULL,
    supplier_name VARCHAR(200) DEFAULT NULL,
    xitems VARCHAR(100) DEFAULT NULL,
    po_date DATE DEFAULT NULL,
    po_qty DECIMAL(18,4) DEFAULT 0,
    unit_price DECIMAL(18,6) DEFAULT 0,
    unit_price_local DECIMAL(18,6) DEFAULT 0,
    exchange_rate DECIMAL(18,6) DEFAULT 1,
    po_amount DECIMAL(18,2) DEFAULT 0,
    po_amount_local DECIMAL(18,2) DEFAULT 0,
    vat_amt DECIMAL(18,2) DEFAULT 0,
    YYYY VARCHAR(10) DEFAULT NULL,
    MM VARCHAR(5) DEFAULT NULL,
    YYYY_MM VARCHAR(10) DEFAULT NULL,
    po_status VARCHAR(20) DEFAULT '未審核',
    po_sub_status VARCHAR(20) DEFAULT '未交付',
    supplier_type VARCHAR(30) DEFAULT NULL,
    inventory_qty DECIMAL(18,4) DEFAULT 0,
    qty_balance_approved DECIMAL(18,4) DEFAULT 0,
    qty_balance_closed DECIMAL(18,4) DEFAULT 0,
    close_batch_id VARCHAR(50) DEFAULT NULL,
    deliver_ontime VARCHAR(5) DEFAULT 'Y',
    batch_id VARCHAR(50) DEFAULT NULL,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_bu (bu_no),
    INDEX idx_bu_ym (bu_no, YYYY_MM),
    INDEX idx_po_id (bu_no, po_id),
    INDEX idx_status (po_status, po_sub_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='採購訂單(AP來源)';

-- ERMM_temp_po: PO 暫存表 (ERP 同步用)
CREATE TABLE IF NOT EXISTS ERMM_temp_po (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    bu_no VARCHAR(20) NOT NULL,
    po_id VARCHAR(50) DEFAULT NULL,
    supplier_name VARCHAR(200) DEFAULT NULL,
    xitems VARCHAR(100) DEFAULT NULL,
    po_date DATE DEFAULT NULL,
    po_qty DECIMAL(18,4) DEFAULT 0,
    unit_price DECIMAL(18,6) DEFAULT 0,
    exchange_rate DECIMAL(18,6) DEFAULT 1,
    po_amount DECIMAL(18,2) DEFAULT 0,
    vat_amt DECIMAL(18,2) DEFAULT 0,
    batch_id VARCHAR(50) DEFAULT NULL,
    sync_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_bu_batch (bu_no, batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='PO暫存表';

-- e2_xitems_daily_status: 每日庫存狀態
CREATE TABLE IF NOT EXISTS e2_xitems_daily_status (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    bu_no VARCHAR(20) NOT NULL,
    xitems VARCHAR(100) DEFAULT NULL,
    item_name VARCHAR(200) DEFAULT NULL,
    qty_balance DECIMAL(18,4) DEFAULT 0,
    unit_price DECIMAL(18,6) DEFAULT 0,
    exchange_rate DECIMAL(18,6) DEFAULT 1,
    stock_value DECIMAL(18,2) DEFAULT 0 COMMENT 'stock_value=price×qty×FX',
    ageing_days INT DEFAULT 0,
    ageing_category VARCHAR(30) DEFAULT NULL,
    reduce_percentage DECIMAL(10,4) DEFAULT 0 COMMENT '減值率%',
    current_value DECIMAL(18,2) DEFAULT 0 COMMENT 'current_value=stock_value×(1-reduce%)',
    current_lose DECIMAL(18,2) DEFAULT 0 COMMENT 'current_lose=stock_value×reduce%',
    stock_date DATE DEFAULT NULL,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_bu_item (bu_no, xitems),
    INDEX idx_stock_date (stock_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='每日庫存狀態';

-- e2_xitems_daily_status_chart: 庫存彙總圖表來源
CREATE TABLE IF NOT EXISTS e2_xitems_daily_status_chart (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    bu_no VARCHAR(20) NOT NULL,
    stock_date DATE DEFAULT NULL,
    reduce_percentage DECIMAL(10,4) DEFAULT 0,
    stock_value_total DECIMAL(18,2) DEFAULT 0,
    current_value_total DECIMAL(18,2) DEFAULT 0,
    current_lose_total DECIMAL(18,2) DEFAULT 0,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_bu_date (bu_no, stock_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='庫存彙總';

-- MGM_production_details: 生產明細表
CREATE TABLE IF NOT EXISTS MGM_production_details (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    bu_no VARCHAR(20) NOT NULL,
    wk_date DATE DEFAULT NULL,
    xitems VARCHAR(100) DEFAULT NULL,
    customer_name VARCHAR(200) DEFAULT NULL,
    so_nbr VARCHAR(50) DEFAULT NULL,
    batch_qty DECIMAL(18,4) DEFAULT 0,
    df_qty DECIMAL(18,4) DEFAULT 0 COMMENT '不良數量',
    qc_type VARCHAR(100) DEFAULT NULL,
    YYYY_MM VARCHAR(10) DEFAULT NULL,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_bu (bu_no),
    INDEX idx_bu_date (bu_no, wk_date),
    INDEX idx_bu_ym (bu_no, YYYY_MM)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='生產明細表';

-- ERMM_erp_so_DN: SO 交貨單 DN
CREATE TABLE IF NOT EXISTS ERMM_erp_so_DN (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    bu_no VARCHAR(20) NOT NULL,
    so_nbr VARCHAR(50) DEFAULT NULL,
    xitems VARCHAR(100) DEFAULT NULL,
    client_name VARCHAR(200) DEFAULT NULL,
    DN_date DATE DEFAULT NULL,
    DN_qty DECIMAL(18,4) DEFAULT 0,
    so_qty DECIMAL(18,4) DEFAULT 0,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_bu_so (bu_no, so_nbr),
    INDEX idx_bu_date (bu_no, DN_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='SO交貨單';

-- BH_MGM_TX_detail: 交易明細表
CREATE TABLE IF NOT EXISTS BH_MGM_TX_detail (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    bu_no VARCHAR(20) NOT NULL,
    event_type VARCHAR(30) DEFAULT NULL COMMENT '銷售出庫/採購入庫',
    xitems VARCHAR(100) DEFAULT NULL,
    so_nbr VARCHAR(50) DEFAULT NULL,
    client_id VARCHAR(50) DEFAULT NULL,
    wk_date DATE DEFAULT NULL,
    qty DECIMAL(18,4) DEFAULT 0,
    unit_price DECIMAL(18,6) DEFAULT 0,
    amt DECIMAL(18,2) DEFAULT 0,
    YYYY_MM VARCHAR(10) DEFAULT NULL,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_bu (bu_no),
    INDEX idx_bu_ym (bu_no, YYYY_MM),
    INDEX idx_event (bu_no, event_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='交易明細表';

-- ERMM_erp_documents: 文件管理表
CREATE TABLE IF NOT EXISTS ERMM_erp_documents (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    bu_no VARCHAR(20) NOT NULL,
    doc_type VARCHAR(30) DEFAULT NULL COMMENT '銀行貸款/採購合約/其他',
    xitems VARCHAR(100) DEFAULT NULL COMMENT '貸款ID/PO編號',
    doc_name VARCHAR(200) DEFAULT NULL,
    doc_path VARCHAR(500) DEFAULT NULL,
    upload_user VARCHAR(50) DEFAULT NULL,
    upload_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    remark TEXT DEFAULT NULL,
    INDEX idx_bu_doc (bu_no, doc_type, xitems)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='文件管理表';

SET FOREIGN_KEY_CHECKS = 1;
