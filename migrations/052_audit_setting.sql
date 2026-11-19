-- ============================================================================
-- 052 审计开关：audit_setting
-- ----------------------------------------------------------------------------
-- 按模块粒度开启/关闭审计，默认全部开启。
-- 管理员可在"系统管理 → 审计设置"页面随时切换，无需重启服务。
-- 中间件与服务层统一读此表，关闭后不再写 audit_event。
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_setting (
    module VARCHAR(40) PRIMARY KEY COMMENT '与 cams_module_permission.module_code 对齐',
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    capture_detail TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否记录 before/after 详细字段（关闭则只记路径）',
    remark VARCHAR(255) DEFAULT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='审计开关（按模块）';

-- 用已知业务模块初始化（其余模块审计默认由中间件兜底，不需要登记）
INSERT INTO audit_setting (module, enabled, capture_detail, remark) VALUES
('auth',           1, 0, '登录/登出记录'),
('expense',        1, 1, '费用报销 + 借支 + 核销'),
('payRequest',     1, 1, '付款申请 + 排程 + 回单 + 核销'),
('workflow',       1, 1, '审批中心 / 流程定义'),
('projectProfit',  1, 1, '项目损益（预算/成本/收入）'),
('boardPack',      1, 1, '董事会报告包（生成/导出）'),
('strategy',       1, 1, '战略目标 BSC'),
('soCredit',       1, 1, '销售信用 + 退货'),
('fx',             1, 1, '外汇敞口 + 对冲'),
('closing',        1, 1, '月结关账（关账/反关账）'),
('hrEfficiency',   1, 1, '组织人效 + 部门编制'),
('prRequest',      1, 1, '采购申请'),
('poGrn',          1, 1, '到货单'),
('poMatch',        1, 1, '三单匹配'),
('permission',     1, 1, '模块权限矩阵变更'),
('codeTable',      1, 1, '系统码表变更'),
('user',           1, 1, '用户管理（新增/禁用/改权限）'),
('backup',         1, 0, '备份触发/恢复/清理')
ON DUPLICATE KEY UPDATE remark=VALUES(remark);

INSERT INTO schema_migrations (version, applied_at, description) VALUES
('052_audit_setting', NOW(), 'CTO-03 审计开关：audit_setting')
ON DUPLICATE KEY UPDATE applied_at=NOW();
