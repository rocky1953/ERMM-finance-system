SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(50) PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP, description VARCHAR(200)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ▶ 001 ERP PO/SO 原始單據表 (3 表)
SOURCE 001_po_so_tables.sql;

-- ▶ 002 財務核心 8 表 (8 表)
SOURCE 002_finance_core_tables.sql;

-- ▶ 003 ERP 主數據 8 表 (8 表)
SOURCE 003_erp_master_tables.sql;

-- ▶ 004 系統配置 6 表 (6 表)
SOURCE 004_system_tables.sql;

-- ▶ 005 ERP 明細 3 表 (3 表)
SOURCE 005_erp_detail_tables.sql;

-- ▶ 011 ERP 製造 4 表 (4 表)
SOURCE 011_erp_manufacturing_tables.sql;

-- ▶ 021 通用審批流 + 費用報銷 (6 表)
SOURCE 021_workflow_expense.sql;

-- ▶ 022 付款申請審批流 (2 表)
SOURCE 022_workflow_payment.sql;

-- ▶ 023 合併報表與關帳 (5 表)
SOURCE 023_consolidation_closing.sql;

-- ▶ 024 採購申請審批流 (2 表)
SOURCE 024_pr_workflow.sql;

-- ▶ 025 PO 三單匹配 (2 表)
SOURCE 025_po_match.sql;

-- ▶ 026 收貨匹配 (2 表)
SOURCE 026_receipt_match.sql;

-- ▶ 027 模組權限矩陣 (1 表)
SOURCE 027_module_permission.sql;

-- ▶ 028 PO 匹配增強 (擴充欄位)
SOURCE 028_po_match_enhance.sql;

-- ▶ 029 銷售信用與退貨 (2 表)
SOURCE 029_sales_credit_return.sql;

-- ▶ 030 多維盈利分析 (2 表)
SOURCE 030_profit_dimension.sql;

-- ▶ 031 滾動預算 (1 表)
SOURCE 031_rolling_budget.sql;

-- ▶ 032 庫存周轉 (1 表)
SOURCE 032_inventory_turnover.sql;

-- ▶ 033 集團經營目標 (1 表)
SOURCE 033_group_cockpit.sql;

-- ▶ 034 董事會報告包 (1 表)
SOURCE 034_board_pack.sql;

-- ▶ 035 專案損益 (3 表)
SOURCE 035_project_profit.sql;

-- ▶ 036 客戶專案映射 (1 表)
SOURCE 036_project_customer_map.sql;

-- ▶ 037 專案預算按公司別 (擴充欄位)
SOURCE 037_project_budget_bu.sql;

SET FOREIGN_KEY_CHECKS = 1;
SELECT * FROM schema_migrations ORDER BY version;
