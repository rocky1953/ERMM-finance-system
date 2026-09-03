# Migrations

資料庫版本管理（MySQL 8.x / ERMM_db）。

## 執行順序

| Version | 檔案 | 表數 | 說明 |
|---------|------|------|------|
| 001 | [001_po_so_tables.sql](./001_po_so_tables.sql) | 3 | ERP PO/SO 原始單據表 |
| 002 | [002_finance_core_tables.sql](./002_finance_core_tables.sql) | 8 | 財務核心 8 表 |
| 003 | [003_erp_master_tables.sql](./003_erp_master_tables.sql) | 8 | ERP 主數據 8 表 |
| 004 | [004_system_tables.sql](./004_system_tables.sql) | 6 | 系統配置 6 表 |
| 005 | [005_erp_detail_tables.sql](./005_erp_detail_tables.sql) | 3 | ERP 明細 3 表 |

## 快速執行

```bash
# 全部（一次跑完所有 migration）
mysql -hlocalhost -uroot -p ERMM_db < run_all.sql

# 單獨某一組
mysql -hlocalhost -uroot -p ERMM_db < 002_finance_core_tables.sql

# 回滾（⚠️ 危險！會 DROP 所有表資料！）
mysql -hlocalhost -uroot -p ERMM_db < 002_finance_core_tables_rollback.sql

# 查版本
mysql -hlocalhost -uroot -p ERMM_db -e "SELECT * FROM schema_migrations ORDER BY version;"
```

## Migration 版本命名規則

每張表一個 version（確保單表回滾粒度）：

- `001_ermm_temp_po` → `ermm_temp_po`
- `001_ermm_erp_po` → `ermm_erp_po`
- `001_ermm_erp_so` → `ermm_erp_so`
- `002_mgm_finance_summary` → `mgm_finance_summary`
- `002_mgm_casher_details` → `mgm_casher_details`
- `002_mgm_invoice_details` → `mgm_invoice_details`
- `002_ermm_arap_detail` → `ermm_arap_detail`
- `002_pay_detail` → `pay_detail`
- `002_check_detail` → `check_detail`
- `002_mgm_bank_loan_details` → `mgm_bank_loan_details`
- `002_forecast_detail` → `forecast_detail`
- `003_cams_system_codes` → `cams_system_codes`
- `003_e2_xitems_daily_status` → `e2_xitems_daily_status`
- `003_e2_xitems_daily_status_chart` → `e2_xitems_daily_status_chart`
- `003_ermm_erp_documents` → `ermm_erp_documents`
- `003_ermm_erp_so_dn` → `ermm_erp_so_dn`
- `003_mgm_account_details` → `mgm_account_details`
- `003_monthly_items` → `monthly_items`
- `003_relation_detail` → `relation_detail`
- `004_branch_detail` → `branch_detail`
- `004_cams_batch_control` → `cams_batch_control`
- `004_cams_xuser` → `cams_xuser`
- `004_leader_user` → `leader_user`
- `004_login_user_record` → `login_user_record`
- `004_mgm_kpi_desc` → `mgm_kpi_desc`
- `005_bh_mgm_tx_detail` → `bh_mgm_tx_detail`
- `005_mgm_production_details` → `mgm_production_details`
- `005_transit_price` → `transit_price`

## 重複執行安全

所有 migration 使用 `CREATE TABLE IF NOT EXISTS` + `INSERT IGNORE INTO schema_migrations`，
可安全重複執行。若表已存在，會自動跳過。

## 生成腳本

```bash
# 重新從 DB 讀取 CREATE TABLE 生成 migration 套件
node database/generate_migrations.js       # 生成 + 自動執行
node database/generate_migrations.js --no-run  # 只生成檔案
```
