-- 027 功能模块使用权限矩阵
-- 三角色：一般(general) / 操作员(operator) / 管理员(admin)
-- 每行一个模块，三个 tinyint(1) 列表示各角色是否可使用
-- 默认全部勾选（向后兼容，admin 硬编码拥有全部权限）

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS cams_module_permission (
  module_code     varchar(50)     NOT NULL COMMENT '對應 index.html 的 data-page',
  module_name     varchar(100)    NOT NULL COMMENT '模組中文名稱',
  module_group    varchar(50)     NOT NULL COMMENT '所屬分組（對應 nav-group-title）',
  allow_general   tinyint(1)      NOT NULL DEFAULT 1 COMMENT '一般',
  allow_operator  tinyint(1)      NOT NULL DEFAULT 1 COMMENT '操作員',
  allow_admin     tinyint(1)      NOT NULL DEFAULT 1 COMMENT '管理員',
  sort_order      int             NOT NULL DEFAULT 0,
  update_time     datetime        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (module_code),
  KEY idx_group (module_group)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='功能模組使用權限矩陣';

-- ===== 种子数据：7 分组 50+ 模块 =====
-- 格式: (module_code, module_name, module_group, general, operator, admin, sort)
INSERT INTO cams_module_permission (module_code, module_name, module_group, allow_general, allow_operator, allow_admin, sort_order) VALUES
-- --- 仪表板 ---
('dashboard',           '仪表板',     '仪表板',   1, 1, 1,  1),

-- --- 经营决策 ---
('actions',             'KPI 动作',   '经营决策', 1, 1, 1,  2),
('alerts',              '预警中心',   '经营决策', 1, 1, 1,  3),
('drilldown',           'KPI 穿透',   '经营决策', 1, 1, 1,  4),
('cashForecast',        '现金预测',   '经营决策', 1, 1, 1,  5),
('mgmtAccounting',      '管理会计',   '经营决策', 1, 1, 1,  6),
('budget',              '预算管理',   '经营决策', 0, 1, 1,  7),
('consolidation',       '合并报表',   '经营决策', 0, 1, 1,  8),
('aiqa',                'AI 问答',    '经营决策', 1, 1, 1,  9),
('scenario',            '情景模拟',   '经营决策', 0, 1, 1, 10),
('warRoom',             '作战室',     '经营决策', 0, 0, 1, 11),
('benchmark',           '标杆对标',   '经营决策', 0, 1, 1, 12),

-- --- ERP 原始单据 ---
('po',                  '采购订单',   'ERP 原始单据', 1, 1, 1, 13),
('so',                  '销售订单',   'ERP 原始单据', 1, 1, 1, 14),
('preorder',            '预购单',     'ERP 原始单据', 1, 1, 1, 15),
('dn',                  '出货单',     'ERP 原始单据', 1, 1, 1, 16),
('tempPo',              '临时 PO',    'ERP 原始单据', 1, 1, 1, 17),

-- --- 日常作业 · 工作日报 ---
('approvals',           '审批待办',   '日常作业', 1, 1, 1, 18),
('expense',             '费用报销',   '日常作业', 1, 1, 1, 19),
('payRequest',          '付款申请',   '日常作业', 1, 1, 1, 20),
('closing',             '关账管理',   '日常作业', 0, 1, 1, 21),
('prRequest',           '采购申请',   '日常作业', 1, 1, 1, 22),
('poMatch',             'PO 三单匹配','日常作业', 0, 1, 1, 23),
('cash',                '现金日记',   '日常作业', 0, 1, 1, 24),
('invoice',             '发票管理',   '日常作业', 1, 1, 1, 25),
('pay',                 '付款管理',   '日常作业', 0, 1, 1, 26),
('check',               '支票管理',   '日常作业', 0, 1, 1, 27),
('bank',                '银行管理',   '日常作业', 0, 0, 1, 28),
('arMatch',             '收款核销',   '日常作业', 0, 1, 1, 29),
('arap',                '应收应付',   '日常作业', 0, 1, 1, 30),
('arSmart',             'AR 智能分析','日常作业', 0, 1, 1, 31),
('dataQuality',         '数据质量',   '日常作业', 0, 1, 1, 32),
('codeTable',           '码表管理',   '日常作业', 0, 0, 1, 33),
('dailyReport',         '工作日报',   '日常作业', 1, 1, 1, 34),
('dailyReportUnfinished','未结日报',   '日常作业', 1, 1, 1, 35),

-- --- 财务分析 · 税务申报 ---
('summary',             '财务汇总',   '财务分析', 0, 1, 1, 36),
('report',              '管理报表',   '财务分析', 0, 1, 1, 37),
('risk',                '风险分析',   '财务分析', 0, 1, 1, 38),
('forecast',            '预测分析',   '财务分析', 0, 1, 1, 39),
('trend',               '趋势分析',   '财务分析', 0, 1, 1, 40),
('monthly',             '月结汇总',   '财务分析', 0, 1, 1, 41),
('bep',                 '盈亏平衡',   '财务分析', 0, 1, 1, 42),
('account',             '账户管理',   '财务分析', 0, 1, 1, 43),
('finance',             '财务总览',   '财务分析', 0, 1, 1, 44),
('tax',                 '税务申报',   '财务分析', 0, 1, 1, 45),
('xitems',              '料件管理',   '财务分析', 1, 1, 1, 46),

-- --- 财务预警 / KPI 查询 ---
('yg001',               'KPI 查询 1', '财务预警', 1, 1, 1, 47),
('yg002',               'KPI 查询 2', '财务预警', 1, 1, 1, 48),
('yg003',               'KPI 查询 3', '财务预警', 1, 1, 1, 49),
('yg004',               'KPI 查询 4', '财务预警', 1, 1, 1, 50),

-- --- 系统 · 主档管理 ---
('batch',               '批次管理',   '系统主档', 0, 0, 1, 51),
('integration',         '系统集成',   '系统主档', 0, 0, 1, 52),
('system',              '系统设置',   '系统主档', 0, 0, 1, 53),
('user',                '用户管理',   '系统主档', 0, 0, 1, 54),
('kpi',                 'KPI 设置',   '系统主档', 0, 0, 1, 55),
('branch',              '公司管理',   '系统主档', 0, 0, 1, 56),
('relation',            '往来单位',   '系统主档', 0, 1, 1, 57),

-- --- 系统文件 ---
('docArchitecture',     '系统架构图', '系统文件', 1, 1, 1, 58),
('docExecutive',        '高管简报',   '系统文件', 0, 1, 1, 59),
('docDataModel',        '数据模型',   '系统文件', 1, 1, 1, 60),
('docManualCeo',        'CEO 手册',   '系统文件', 1, 1, 1, 61),
('docManualCfo',        'CFO 手册',   '系统文件', 1, 1, 1, 62)
ON DUPLICATE KEY UPDATE
  module_name=VALUES(module_name),
  module_group=VALUES(module_group),
  sort_order=VALUES(sort_order);

-- schema_migrations
INSERT INTO schema_migrations (version, applied_at, description) VALUES
('027_module_permission', NOW(), '功能模組使用權限矩陣（一般/操作員/管理員 三角色）')
ON DUPLICATE KEY UPDATE applied_at=NOW();

SELECT '✅ 027 功能模块权限矩阵 迁移完成' AS result, (SELECT COUNT(*) FROM cams_module_permission) AS modules_loaded;
