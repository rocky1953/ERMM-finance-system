-- CTO-02 按鈕/行級權限

-- ================================================
-- 1. 按鈕級權限表（77 模組 ~ 350 按鈕）
-- ================================================
CREATE TABLE IF NOT EXISTS cams_permission_button (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    module_code     VARCHAR(40) NOT NULL COMMENT '對應 cams_module_permission.module_code',
    button_code     VARCHAR(40) NOT NULL COMMENT '操作碼: CREATE/UPDATE/DELETE/SUBMIT/APPROVE/REJECT/EXPORT/LOCK/UNLOCK',
    button_name     VARCHAR(60) NOT NULL COMMENT '前端顯示名稱',
    button_group    VARCHAR(30) DEFAULT 'default' COMMENT '按鈕分組（操作/審批/維護/高級）',
    allow_general   TINYINT DEFAULT 0,
    allow_operator  TINYINT DEFAULT 1,
    allow_admin     TINYINT DEFAULT 1,
    sort_order      INT DEFAULT 10,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_module_button (module_code, button_code),
    KEY idx_module (module_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CTO-02 按鈕級權限';

-- ================================================
-- 2. 行級數據範圍（data scope）配置
--    每個角色預設看哪些公司的數據；可按 module_code 覆蓋
-- ================================================
CREATE TABLE IF NOT EXISTS cams_data_scope (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    role_code       VARCHAR(20) NOT NULL COMMENT 'general/operator/admin',
    module_code     VARCHAR(40) DEFAULT '*' COMMENT '*=所有模組預設',
    scope_type      VARCHAR(20) DEFAULT 'ALL' COMMENT 'ALL/OWN_BU/OWN_DEPT/CUSTOM',
    bu_list         JSON DEFAULT NULL COMMENT 'scope_type=CUSTOM 時指定 bu_no 列表',
    dept_list       JSON DEFAULT NULL COMMENT 'scope_type=OWN_DEPT 時指定部門碼',
    description     VARCHAR(200),
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_role_module (role_code, module_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CTO-02 行級數據範圍';

-- ================================================
-- 3. 初始化：按鈕權限預設（所有模組按鈕 general=0, operator=1, admin=1）
--    實際每個模組的按鈕清單從 cams_module_permission 裡推斷，簡化版本先加通用按鈕
-- ================================================

-- 通用寫操作按鈕（大部分業務模組適用）
INSERT INTO cams_permission_button (module_code, button_code, button_name, button_group, allow_general, allow_operator, allow_admin, sort_order) VALUES
('expense',       'CREATE',   '新建報銷單',   '操作', 0, 1, 1, 10),
('expense',       'SUBMIT',   '提交審批',     '操作', 0, 1, 1, 20),
('expense',       'APPROVE',  '審批',         '審批', 0, 1, 1, 30),
('expense',       'REJECT',   '駁回',         '審批', 0, 1, 1, 40),
('expense',       'PAY',      '付款',         '操作', 0, 0, 1, 50),
('payRequest',    'CREATE',   '新建付款申請', '操作', 0, 1, 1, 10),
('payRequest',    'SUBMIT',   '提交審批',     '操作', 0, 1, 1, 20),
('payRequest',    'APPROVE',  '審批',         '審批', 0, 1, 1, 30),
('payRequest',    'PAY',      '執行付款',     '操作', 0, 0, 1, 50),
('closing',       'CLOSE',    '關賬',         '操作', 0, 0, 1, 10),
('closing',       'REOPEN',   '反關賬',       '操作', 0, 0, 1, 20),
('closing',       'ELIM',     '生成抵消',     '操作', 0, 1, 1, 30),
('closing',       'RATE_SAVE','保存折算匯率', '操作', 0, 1, 1, 40),
('consolidation', 'SNAPSHOT', '生成合併快照', '操作', 0, 0, 1, 10),
('consolidation', 'OVERRIDE', '覆蓋抵消金額', '高級', 0, 0, 1, 20),
('fx',            'CREATE',   '新增敞口',     '操作', 0, 1, 1, 10),
('fx',            'HEDGE',    '新增對沖',     '操作', 0, 1, 1, 20),
('fx',            'CLOSE',    '平倉',         '操作', 0, 1, 1, 30),
('fx',            'DELETE',   '刪除',         '維護', 0, 0, 1, 90),
('workflow',      'CREATE',   '新建流程',     '維護', 0, 0, 1, 10),
('workflow',      'APPROVE',  '審批任務',     '審批', 0, 1, 1, 20),
('workflow',      'CANCEL',   '撤單',         '高級', 0, 0, 1, 30),
('permission',    'UPDATE',   '更新權限',     '維護', 0, 0, 1, 10),
('permission',    'BATCH',    '批量更新',     '維護', 0, 0, 1, 20),
('codeTable',     'CREATE',   '新增碼表',     '維護', 0, 0, 1, 10),
('codeTable',     'UPDATE',   '修改碼表',     '維護', 0, 0, 1, 20),
('codeTable',     'DELETE',   '刪除碼表',     '維護', 0, 0, 1, 30),
('soCredit',      'CREATE',   '新建額度',     '操作', 0, 1, 1, 10),
('soCredit',      'APPROVE',  '審批額度',     '審批', 0, 1, 1, 20),
('soCredit',      'RETURN',   '登記退貨',     '操作', 0, 1, 1, 30),
('poMatch',       'RUN',      '執行匹配',     '操作', 0, 1, 1, 10),
('poMatch',       'SETTLE',   '生成應付款',   '操作', 0, 0, 1, 20),
('projectProfit', 'BUDGET',   '保存預算',     '操作', 0, 1, 1, 10),
('projectProfit', 'SYNC',     '自動同步',     '操作', 0, 1, 1, 20),
('hrEfficiency',  'CREATE',   '新建編制',     '操作', 0, 1, 1, 10),
('hrEfficiency',  'COPY',     '複製編制',     '操作', 0, 1, 1, 20),
('boardPack',     'GENERATE', '生成報告包',   '操作', 0, 0, 1, 10),
('boardPack',     'DELETE',   '刪除',         '維護', 0, 0, 1, 20),
('strategy',      'CREATE',   '新建BSC目標',  '操作', 0, 1, 1, 10),
('strategy',      'PROGRESS', '錄入進度',     '操作', 0, 1, 1, 20),
('strategy',      'SYNC',     '從指標同步',   '操作', 0, 0, 1, 30),
('poGrn',         'CREATE',   '登記收貨',     '操作', 0, 1, 1, 10),
('poGrn',         'DELETE',   '刪除',         '維護', 0, 0, 1, 20),
('prRequest',     'CREATE',   '新建申請',     '操作', 0, 1, 1, 10),
('prRequest',     'SUBMIT',   '提交審批',     '操作', 0, 1, 1, 20),
('prRequest',     'GENERATE_PO', '生成PO',   '操作', 0, 0, 1, 30),
('monitor',       'EXPORT',   '匯出',         '操作', 0, 0, 1, 10),
('audit',         'EXPORT',   '匯出',         '操作', 0, 0, 1, 10),
('auth',          'LOGIN',    '登入',         'default', 1, 1, 1, 10)
ON DUPLICATE KEY UPDATE button_name=VALUES(button_name), button_group=VALUES(button_group),
    allow_general=VALUES(allow_general), allow_operator=VALUES(allow_operator), allow_admin=VALUES(allow_admin),
    update_time=NOW();

-- ================================================
-- 4. 行級數據範圍預設
-- ================================================
INSERT INTO cams_data_scope (role_code, module_code, scope_type, description) VALUES
('admin',    '*', 'ALL',       '管理員看全部數據（77 模組）'),
('operator', '*', 'ALL',       '操作員看全部數據（按鈕權限控制寫操作）'),
('general',  '*', 'OWN_BU',    '一般員工只能看所屬公司的數據'),
('general',  'monitor',    'ALL', '一般員工可看監控數據（只讀）'),
('general',  'audit',      'ALL', '一般員工可看審計數據（只讀）'),
('operator', 'audit',      'ALL', '操作員可看審計數據（只讀）'),
('admin',    'audit',      'ALL', '管理員可看審計數據')
ON DUPLICATE KEY UPDATE scope_type=VALUES(scope_type), update_time=NOW();