# ERMM 財務模組 — 離線匯入操作手冊

> 版本：v2.0 | 更新日期：2026-09-03 | 適用資料：2024/09 ~ 2025/12

---

## 一、快速開始（5 步）

```
步驟 1 → 打開 Excel 模板：database/finance_data_template.xlsx
步驟 2 → 在各 Sheet 的第 3 行起貼上你的資料（保留 Row 2 的欄位代碼！）
步驟 3 → 存檔（另存新檔也可以，路徑記住）
步驟 4 → 在 e:\finance 目錄執行：
          node database/import_excel.js "你的檔案路徑.xlsx"
步驟 5 → 到系統「批次管線」頁點「一鍵執行全部」重算三大報表 & 風險指標
```

**匯入腳本特性：**

| 功能 | 說明 |
|------|------|
| 自動比對 | Row 2 的欄位代碼 → DB 真實欄位，未知欄位自動跳過 |
| 自動派生 | wk_date 自動拆出 YYYY / MM / YYYY_MM；YYYY_MM 反向補 YYYY / MM |
| 日期清洗 | `0000-00-00`、Excel 0 日期（1900-01-01）自動轉 null |
| UPSERT | `INSERT ... ON DUPLICATE KEY UPDATE`，重複主鍵自動覆蓋（可更新既有資料） |
| 事務安全 | 每張表一個事務，失敗自動回滾，不會半匯入 |
| 必填檢查 | 缺必填欄位的行自動跳過並顯示統計 |
| 進度報告 | 每張表顯示匯入筆數 / 跳過筆數 / 錯誤筆數 |

---

## 二、公司別代碼（bu_no）

| 代碼 | 中文名稱 | 英文名稱 |
|------|---------|---------|
| HM | 鴻明 | Hong Ming |
| HN | 鴻南 | Hong Nan |
| SZ | 深圳廠 | Shenzhen |

---

## 三、模板結構

每張資料表 Sheet 的結構固定（**勿改 Row 1 / Row 2**）：

```
Row 1: 標題說明（淺藍文字，凍結）— 不要改
Row 2: 欄位代碼（深藍底白字，與 DB 欄位名一致）— 匯入腳本靠這一行識別
Row 3+: 你的資料（從第 3 行開始填）
```

**模板包含 9 個 Sheet：**

| Sheet | DB 表 | 必填欄位 | 用途 |
|-------|-------|---------|------|
| `說明_README` | — | — | 本手冊的 Excel 版 |
| `01_財務摘要_summary` | MGM_finance_summary | bu_no, YYYY_MM | **核心樞紐表**，所有報表基礎 |
| `02_現金日記帳_cash` | MGM_casher_details | bu_no, num_vman, wk_date, DB_CR, sub_amt | 現金收支 |
| `03_發票明細_invoice` | MGM_invoice_details | bu_no, TX_type, invoice_no, wk_date, client_id, sub_amt | 進銷項發票 |
| `04_付款明細_pay` | pay_detail | bu_no, supplier_name, finance_type, should_date, amount | 應付付款 |
| `05_應收應付_arap` | ermm_arap_detail | bu_no, YYYY, YYYY_MM | 月底 AR/AP 彙總 |
| `06_銀行貸款_bank` | mgm_bank_loan_details | bu_no, loan_id, loan_amt, begin_date, end_date | 銀行存貸款 |
| `07_票據管理_check` | check_detail | bu_no, check_num, check_date, due_date, amount | 支票票據 |
| `08_財務預測_forecast` | forecast_detail | bu_no, YYYY_MM, forecast_type, forecast_amt | 銷售/採購/現金預測 |

---

## 四、各表欄位詳細說明

### 4.1 財務摘要（MGM_finance_summary）— 核心樞紐

> 這張表有 **200+ 欄位**，模板只列出常用的 30 個。其餘欄位（折舊、Z-Score 風險模型、ROE/ROA 等 KPI）由系統批次管線自動計算，**不需要手動填**。

| 欄位代碼 | 中文名 | 型別 | 必填 | 說明 | 範例 |
|----------|-------|------|:----:|------|------|
| bu_no | 公司別 | text | ✅ | HM / HN / SZ | HM |
| YYYY_MM | 年月 | text | ✅ | YYYY/MM | 2024/12 |
| cash_amt | 現金 | decimal | | 庫存現金 | 200000 |
| deposite_amt | 銀行存款 | decimal | | | 5000000 |
| interest_amt | 應收利息 | decimal | | | 50000 |
| AR_amt | 應收帳款 | decimal | | | 4391280 |
| stock_P_amt | 製成品存貨 | decimal | | | 1563904 |
| stock_M_amt | 原料存貨 | decimal | | | 2146368 |
| equipment_amt | 機器設備原值 | decimal | | | 12519000 |
| acc_de_EQMT | 設備累計折舊 | decimal | | | 6259500 |
| building_amt | 房屋建築原值 | decimal | | | 8200000 |
| intangible_amt | 無形資產 | decimal | | | 642000 |
| loan_amt | 短期借款 | decimal | | | 4770571 |
| AP_amt | 應付帳款 | decimal | | | 1449122 |
| AP_tax_amt | 應付稅費 | decimal | | | 1431375 |
| LT_loan_amt | 長期借款 | decimal | | | 2650317 |
| captial_stock | 股本 | decimal | | | 5000000 |
| captial_reserve | 資本公積 | decimal | | | 500000 |
| legal_reserve | 法定盈餘公積 | decimal | | | 0 |
| accumulated_amt | 累積盈餘 | decimal | | | 12410147 |
| sale_amt | 銷貨收入 | decimal | ✅ | 當月銷售總額 | 14637600 |
| sale_cost_amt | 銷貨成本 | decimal | ✅ | COGS | 8050680 |
| sale_exp_amt | 銷售費用 | decimal | | 廣告/運費 | 292752 |
| MGM_EXP_amt | 管理費用 | decimal | | 薪資/辦公 | 439128 |
| finance_EXP_amt | 財務費用 | decimal | | 利息支出 | 238529 |
| BIZ_major_margin_amt | 營業毛利 | decimal | | sale-cost-VAT | 4684032 |
| BIZ_margin_amt | 營業利益 | decimal | | 毛利-費用 | 3859999 |
| operation_profit_amt | 營業利潤 | decimal | | | 3983863 |
| net_profit_amt | 淨利 | decimal | ✅ | 稅後淨利 | 2080975 |
| VAT_rate | 增值稅率% | decimal | | 百分比數字 | 13 |

**資料平衡驗證（重要！）**

匯入後可在前端「三大報表」頁確認：
```
資產總額（ttl_asset_amt） = 負債總額（ttl_debet_amt） + 股東權益（stockholder_amt）
股東權益（stockholder_amt）= captial_stock + captial_reserve + legal_reserve + accumulated_amt + current_PL_amt
```

---

### 4.2 現金日記帳（MGM_casher_details）

| 欄位代碼 | 中文名 | 型別 | 必填 | 說明 | 範例 |
|----------|-------|------|:----:|------|------|
| bu_no | 公司別 | text | ✅ | | HM |
| num_vman | 憑證號 | text | ✅ | **唯一不可重複** | CVHM202412001 |
| wk_date | 日期 | date | ✅ | YYYY-MM-DD | 2024-12-25 |
| amt_type | 收支類型 | text | ✅ | 銷貨收入/原料採購/工資/房租水電/差旅費/廣告費/設備維修/利息收入/匯兌收益/應收款收回 | 銷貨收入 |
| DB_CR | 借貸別 | text | ✅ | **DR = 收款（資產增加）** / **CR = 付款（負債增加）** | DR |
| sub_amt | 金額 | decimal | ✅ | 正數 | 881862 |
| bank_acct | 銀行帳號 | text | | | HK0012 |
| remark | 備註 | text | | | 12月銷貨 |

---

### 4.3 發票明細（MGM_invoice_details）

| 欄位代碼 | 中文名 | 型別 | 必填 | 說明 | 範例 |
|----------|-------|------|:----:|------|------|
| bu_no | 公司別 | text | ✅ | | HM |
| TX_type | 發票類型 | text | ✅ | **AR = 銷項發票（應收）** / **AP = 進項發票（應付）** | AR |
| invoice_no | 發票號碼 | text | ✅ | | INV202412001 |
| wk_date | 發票日期 | date | ✅ | YYYY-MM-DD | 2024-12-15 |
| client_id | 客戶/供應商 | text | ✅ | | 客戶A |
| sub_amt | 金額（未稅） | decimal | ✅ | | 1061946 |
| VAT_amt | 稅額 | decimal | | | 138053 |
| tax_rate | 稅率% | decimal | | 百分比數字 | 13 |
| pay_date | 付款日期 | date | | **留空白 = 未收/未付** | 2024-12-28 |
| payment | 已付款額 | decimal | | | 1200000 |

---

### 4.4 付款明細（pay_detail）

| 欄位代碼 | 中文名 | 型別 | 必填 | 說明 | 範例 |
|----------|-------|------|:----:|------|------|
| bu_no | 公司別 | text | ✅ | | HM |
| supplier_name | 受款人 | text | ✅ | | 工資 / 房東張 |
| finance_type | 費用類型 | text | ✅ | 工資/原料採購/房租水電/差旅費/廣告費/設備維修 | 工資 |
| should_date | 應付日期 | date | ✅ | YYYY-MM-DD | 2024-12-31 |
| pay_date | 實付日期 | date | | **留空白 = 未付款** | 2024-12-20 |
| amount | 金額 | decimal | ✅ | | 306237 |
| currency_ab | 幣別 | text | | HKD / CNY / USD | HKD |
| invoice_num | 發票號 | text | | | |
| remark | 備註 | text | | | 12月薪資 |

---

### 4.5 應收應付彙總（ermm_arap_detail）

| 欄位代碼 | 中文名 | 型別 | 必填 | 說明 | 範例 |
|----------|-------|------|:----:|------|------|
| bu_no | 公司別 | text | ✅ | | HM |
| YYYY | 年度 | text | ✅ | 4 位數 | 2024 |
| YYYY_MM | 年月 | text | ✅ | YYYY/MM | 2024/12 |
| AR_amt | 應收帳款 | decimal | ✅ | 月底 AR 餘額 | 4391280 |
| AP_amt | 應付帳款 | decimal | ✅ | 月底 AP 餘額 | 1449122 |
| AR_ageing | 應收帳齡金額 | decimal | | 過期 90 天以上 | 200000 |
| AP_ageing | 應付帳齡金額 | decimal | | 過期 90 天以上 | 0 |

---

### 4.6 銀行貸款（mgm_bank_loan_details）

| 欄位代碼 | 中文名 | 型別 | 必填 | 說明 | 範例 |
|----------|-------|------|:----:|------|------|
| bu_no | 公司別 | text | ✅ | | HM |
| loan_id | 貸款編號 | text | ✅ | **唯一** | LOAN001 |
| bank_id | 銀行代碼 | text | | HSBC / BOC ... | HSBC |
| loan_type | 貸款類型 | text | | 信用貸款 / 抵押貸款 / 保證貸款 | 信用貸款 |
| loan_amt | 貸款金額 | decimal | ✅ | | 2000000 |
| pay_terms | 還款期數 | number | | 月 | 12 |
| terms_rate | 年利率% | decimal | | 5.25 = 5.25% | 5.25 |
| begin_date | 起借日期 | date | ✅ | YYYY-MM-DD | 2024-01-01 |
| end_date | 到期日期 | date | ✅ | | 2025-01-01 |
| payback_amt | 已還本金 | decimal | | 未還=0 | 500000 |
| status1 | 狀態 | text | | 使用中 / 已還清 | 使用中 |

---

### 4.7 票據管理（check_detail）

| 欄位代碼 | 中文名 | 型別 | 必填 | 說明 | 範例 |
|----------|-------|------|:----:|------|------|
| bu_no | 公司別 | text | ✅ | | HM |
| check_num | 票據號 | text | ✅ | **唯一** | CHK001 |
| check_type | 類型 | text | ✅ | 現金支票 / 轉帳支票 | 轉帳支票 |
| check_date | 開票日 | date | ✅ | | 2024-12-01 |
| due_date | 到期日 | date | ✅ | | 2024-12-15 |
| amount | 金額 | decimal | ✅ | | 500000 |
| to_company | 受票單位 | text | | | 供應商X |
| status | 狀態 | text | | 未兌現 / 已兌現 / 作廢 | 未兌現 |

---

### 4.8 財務預測（forecast_detail）

| 欄位代碼 | 中文名 | 型別 | 必填 | 說明 | 範例 |
|----------|-------|------|:----:|------|------|
| bu_no | 公司別 | text | ✅ | | HM |
| YYYY_MM | 年月 | text | ✅ | YYYY/MM | 2024/12 |
| forecast_type | 預測類型 | text | ✅ | 銷售 / 採購 / 現金 | 銷售 |
| forecast_amt | 預測金額 | decimal | ✅ | | 15000000 |
| actual_amt | 實際金額 | decimal | | 系統自動對比用 | 14637600 |

---

## 五、格式規範（重要！）

| 項目 | 規範 | ✅ 正確範例 | ❌ 錯誤範例 |
|------|------|-----------|-----------|
| 日期 | YYYY-MM-DD | `2024-12-15` | `2024/12/15`, `15/12/2024`, `2024年12月15日` |
| 金額 | 整數或小數，**無千分位/貨幣符號** | `652103`, `14637600` | `652,103`, `HK$ 652103`, `NT$652,103.00` |
| 公司別 | 英文大寫 | `HM` | `hm`, `HM公司`, `鴻明` |
| 年月 | YYYY/MM（斜線分隔） | `2024/12` | `2024-12`, `2024年12月`, `24/12` |
| DB_CR | 英文大寫 2 字元 | `DR`, `CR` | `Dr`, `dr`, `借方`, `貸方` |
| TX_type | 英文大寫 2 字元 | `AR`, `AP` | `Ar`, `銷項`, `進項` |
| 空值 | **留空白**（不要填 0 除非真的是 0） | 空白格 | `0`, `N/A`, `-`, `無`, `null` |
| 百分比 | 數字（不含 %） | `13`（= 13%） | `13%`, `0.13` |
| 幣別代碼 | 3 字母 | `HKD`, `CNY`, `USD` | `HK`, `港幣`, `人民幣` |
| 憑證號/發票號 | 字串，**不可重複** | `CVHM202412001` | 系統自動編碼 |

---

## 六、匯入順序建議

```
優先級 1  ←  01_財務摘要_summary（三大報表的基礎，最核心）
優先級 2  ←  02~08 日常作業表（順序任意，互不依賴）
優先級 3  ←  到系統「批次管線」頁面，點「一鍵執行全部」重算：
               · 折舊 / 累計折舊
               · Z-Score / BZ / JZ 風險模型
               · ROE / ROA / 毛利率 / 淨利率 / 資產週轉率
               · 營業活動 / 投資活動 / 籌資活動 現金流量
               · VAT 進項稅額 / 附加稅
```

---

## 七、常見錯誤 Q&A

### Q1：匯入後前端頁面全是「-」？
**A**：檢查該 Sheet 的 **Row 2 欄位代碼** 是否被你改過。欄位代碼必須與 DB 欄位名完全一致（如 `sale_amt`, `net_profit_amt`, `sub_amt`）。

### Q2：現金日記賬「收入/支出/餘額」全是 `-`？
**A**：檢查 `DB_CR` 欄位是否正確填 `DR` / `CR`（英文大寫 2 字元），以及 `sub_amt` 是否有正數值。

### Q3：資產負債表顯示「不平衡」？
**A**：檢查 01_財務摘要的資料平衡：
```
資產總額 = 負債總額 + 股東權益
stockholder_amt = captial_stock + captial_reserve + legal_reserve + accumulated_amt + current_PL_amt
```
系統批次管線重算會自動幫你校正。

### Q4：匯入腳本報 `Unknown column 'XXX'`？
**A**：你的 Row 2 欄位代碼與 DB 欄位名不對。請打開 **database/schema.sql** 比對欄位名，或直接用模板的 Row 2（已驗證）。

### Q5：如何更新既有資料？
**A**：匯入腳本使用 `INSERT ... ON DUPLICATE KEY UPDATE`，重複主鍵自動覆蓋。你只要匯入相同 bu_no + YYYY_MM 的資料即可更新。

### Q6：匯入的日期變成 `1900-01-01` 或 `0000-00-00`？
**A**：Excel 把 `0` 視為日期 `1900-01-01`。模板裡空日期欄位已留空白，匯入腳本也會自動清洗這兩種異常日期。**請不要在日期欄位填 0。**

### Q7：同一批資料可以重複匯入嗎？
**A**：可以。腳本有 `ON DUPLICATE KEY UPDATE`，重複執行不會造成重複資料。但建議每次匯入前先備份 DB。

### Q8：匯入後要重新啟動 Express 嗎？
**A**：**不需要**。MySQL 匯入是直接寫 DB，Express 讀 DB 時直接拿到新資料。刷新瀏覽器即可。

### Q9：想清空某張表再重匯？
```bash
# MySQL 命令列
TRUNCATE TABLE MGM_casher_details;   # 換成你的表名
# 然後再跑匯入腳本
node database/import_excel.js your.xlsx
```

### Q10：範例資料（模板裡的 36 筆）會不會影響既有資料？
**A**：會。`MGM_casher_details` / `MGM_invoice_details` 等表用 `num_vman` / `invoice_no` 當唯一鍵，模板裡的憑證號/發票號如果和你既有資料重複會被覆蓋。**建議匯入前先 TRUNCATE 對應表。**

---

## 八、命令參考

```bash
# ===== 匯入 =====
node database/import_excel.js database/finance_data_template.xlsx
node database/import_excel.js "C:\你的路徑\my_data.xlsx"

# ===== 重新生成模板（已含最新 DB 欄位） =====
node database/gen_excel_template.js

# ===== 備份 DB =====
mysqldump -uroot -pld68315711 ERMM_db > backup.sql

# ===== 恢復 DB =====
mysql -uroot -pld68315711 ERMM_db < backup.sql

# ===== 查詢某張表有多少資料 =====
mysql -uroot -pld68315711 ERMM_db -e "SELECT COUNT(*) FROM MGM_finance_summary WHERE bu_no='HM';"

# ===== 查詢某 BU 某月份資料 =====
mysql -uroot -pld68315711 ERMM_db -e "SELECT * FROM MGM_casher_details WHERE bu_no='HM' AND YYYY_MM='2024/12';"
```

---

## 九、檔案位置

| 檔案 | 路徑 |
|------|------|
| Excel 模板 | `e:\finance\database\finance_data_template.xlsx` |
| 匯入腳本 | `e:\finance\database\import_excel.js` |
| 模板生成腳本 | `e:\finance\database\gen_excel_template.js` |
| DB Schema | `e:\finance\database\schema.sql` |
| 本手冊 | `e:\finance\database\OFFLINE_IMPORT_GUIDE.md` |

---

**匯入完成後，記得到前端「批次管線」頁點「一鍵執行全部」重算三大報表與風險指標！**
