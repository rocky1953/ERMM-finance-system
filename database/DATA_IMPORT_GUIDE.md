# ERMM 財務模組 — 資料導入總指南（Online 線上 / Offline 離線）

> 版本：v1.0 ｜ 更新日期：2026-09-11
> 適用：ERMM 財務模組（Node.js + Express + MySQL 8）
> 配套文件：財務 8 表的離線 Excel 欄位細節見 [OFFLINE_IMPORT_GUIDE.md](./OFFLINE_IMPORT_GUIDE.md)

---

## 0. 一句話總覽

```
第三方系統（ERP/銀行/財務/稅務）
        │
        ├── 連線可用 ──► 【Online】瀏覽器頁面錄入 或 HTTP API 寫入 或 批次管線同步
        │
        └── 實體檔案交接 ──► 【Offline】Excel 模板匯入 / ERP 批次交接檔 / SQL 備份還原
                                          │
                                          ▼
                         匯入後一律執行「批次管線一鍵重算」→ 勾稽核驗
```

**三條導入通道怎麼選：**

| 通道 | 适用場景 | 是否需服務運行 | 可否大批量 | 說明 |
|------|---------|:---:|:---:|------|
| A. 線上頁面 / API | 日常即時錄入、零星維護、程式對接 | ✅ 需要 | 逐筆／可迴圈 | 瀏覽器各頁面「新增」，或對 `/api/*` 下 POST |
| B. 線上批次管線 | 第三方 ERP 每月 PO/SO/庫存整批同步 | ✅ 需要 | ✅ 大量 | 資料先落「暫存區」，再跑 Step1~7 |
| C. 離線檔案匯入 | 初次建帳、月結批量、外網隔離、停機維護 | ❌ 不需 Express | ✅ 大量 | Excel（`import_excel.js`）或 SQL，直連 MySQL |

---

## 1. 環境準備

### 1.1 軟體需求

| 軟體 | 版本 | 用途 |
|------|------|------|
| Node.js | 18+（建議 20 LTS） | 跑服務與離線匯入腳本 |
| MySQL | 8.x，字集 `utf8mb4` | 資料庫 `ERMM_db` |
| 瀏覽器 | Chrome / Edge 最新版 | 線上操作 |
| Excel | 可開啟 .xlsx | 離線填報 |

安裝依賴（僅首次）：

```powershell
cd e:\finance
npm.cmd install
```

### 1.2 環境設定檔 `.env`（位於 `e:\finance\.env`）

| 鍵 | 說明 | 本機(離線)範例 | 線上範例 |
|----|------|--------------|---------|
| `PORT` | Express 監聽埠 | 3008 | 3008（或對外 80/443 反代） |
| `DB_HOST` | MySQL 位址 | `127.0.0.1` | 內網/雲 DB 位址，如 `10.0.0.20` |
| `DB_PORT` | MySQL 埠 | 3306 | 3306 |
| `DB_USER` | DB 帳號 | `root` | 受限帳號（建議只授該庫權限） |
| `DB_PASSWORD` | DB 密碼 | （見現有 .env） | 強密碼，勿入版控 |
| `DB_NAME` | 資料庫名 | `ERMM_db` | `ERMM_db` |
| `JWT_SECRET` | 登入簽章用 | 任意長隨機字串 | 線上務必換成高強度隨機值 |

> 維護兩套設定，切換時覆蓋 `.env` 後**重啟服務**即可：
>
> ```powershell
> # 離線（本機 DB）
> Copy-Item .env.offline .env -Force
> # 線上（遠端 DB）
> Copy-Item .env.online  .env -Force
> ```

### 1.3 啟動 / 停止 / 驗證

```powershell
# 啟動（背景運行）
cd e:\finance
node app.js

# 驗證（另一個終端機）
Invoke-RestMethod http://localhost:3008/api/health -UseBasicParsing
# 看到 success=true 即正常
```

停止：在運行視窗按 `Ctrl+C`；若是背景任務，用連接埠找 PID 終止：

```powershell
netstat -ano | findstr ':3008' | findstr LISTENING
taskkill /F /PID <查到的PID>
```

---

## 2. 全量資料清單（29 張表，按來源分類）

> 「推薦通道」：**API**＝線上介面／HTTP；**管線**＝批次 Step1~7 產出；**Excel**＝離線模板；**SQL**＝備份還原／直接匯入。
> 標 ✅「需重算」者，匯入後要跑批次管線，報表數字才會更新。

### 2.1 第三方 ERP 原始單據（來源：外部 ERP／貿易／倉儲系統）

| 表 | 中文名 | 對應頁面 | 進入方式 | 匯入通道 | 需重算 |
|----|--------|---------|---------|---------|:---:|
| `ermm_temp_po` | PO 暫存（第三方 PO 落地區） | tempPo | 第三方採購單 | 頁面/API/管線 Excel | →Step1 |
| `ermm_erp_po` | 正式採購單 PO | po | Step1 產出，勿直接灌 | 管線 Step1 | ✅ |
| `ERMM_erp_SO` | 銷售訂單 SO | so | 第三方銷售單 | 頁面/API/管線 Excel | ✅ |
| `ERMM_erp_so_DN` | 送貨／交貨單 DN | dn | 第三方出貨單 | 頁面/API | — |
| `ERMM_erp_documents` | ERP 單據文件 | （附件） | 第三方單據文件 | API/SQL | — |
| `e2_xitems_daily_status` | 庫存日狀態 | xitems | 第三方倉存 | 頁面/API/管線 Excel | ✅ Step5 |
| `e2_xitems_daily_status_chart` | 庫存圖表彙總 | xitems | Step5 產出 | 管線 Step5 | — |
| `mgm_production_details` | 生產明細 | （生產） | 第三方生產報表 | SQL | — |
| `transit_price` | 轉撥計價 | （關係人） | 第三方/管理 | API/SQL | — |

### 2.2 財務核心 8 表（來源：財務／銀行／稅務，離線模板已完整支援）

| 表 | 中文名 | 頁面 | 線上通道 | 離線 Excel Sheet | 需重算 |
|----|--------|------|---------|-----------------|:---:|
| `MGM_finance_summary` | 財務摘要（核心樞紐，200+欄） | summary | API | `01_財務摘要_summary` | ✅ Step7 |
| `MGM_casher_details` | 現金日記帳 | cash | API | `02_現金日記帳_cash` | ✅ |
| `MGM_invoice_details` | 發票明細（進銷項） | invoice | API/genAR/genAP | `03_發票明細_invoice` | ✅ Step6 |
| `pay_detail` | 付款明細 | pay | API | `04_付款明細_pay` | ✅ |
| `ERMM_arap_detail` | 應收應付月底彙總 | arap | API/recalc | `05_應收應付_arap` | 可 Step6 產出 |
| `mgm_bank_loan_details` | 銀行存貸款 | bank | API/recalc | `06_銀行貸款_bank` | — |
| `check_detail` | 票據／支票 | check | API/clear | `07_票據管理_check` | — |
| `forecast_detail` | 財務預測 | forecast | API | `08_財務預測_forecast` | — |

### 2.3 主資料／月結（來源：管理帳，需先建檔）

| 表 | 中文名 | 頁面 | 通道 |
|----|--------|------|------|
| `branch_detail` | 公司／分行主檔 | branch | 頁面/API |
| `relation_detail` | 往來對象／關係人 | relation | 頁面/API |
| `MGM_account_details` | 會計科目主檔 | account | 頁面/API |
| `monthly_items` | 月結項目 | monthly | 頁面/API |

### 2.4 系統設定／使用者／KPI

| 表 | 中文名 | 頁面 | 通道 |
|----|--------|------|------|
| `cams_system_codes` | 系統碼表（庫存帳齡、狀態等） | system | 頁面/API/管線 Excel |
| `MGM_KPI_desc` | KPI 指標定義 | system/kpi | 頁面/API |
| `cams_xuser` | 系統使用者 | user | 頁面/API |
| `leader_user` | 主管使用者 | user | API/SQL |
| `login_user_record` | 登入記錄 | （系統產生） | 不需匯入 |
| `cams_batch_control` | 批次執行控制記錄 | batch | 管線自動寫入 |

### 2.5 加工產出／門檻（一般不由第三方匯入）

| 表 | 中文名 | 產生方式 |
|----|--------|---------|
| `BH_MGM_tx_detail` | 交易明細彙總 | 批次加工產出 |
| `mgm_bep_threshold` | BEP 損益平衡門檻（CW397 基準） | BEP 頁「儲存門檻」在線維護（`POST /api/bep/save`） |

> **建表來源**：28 張標準表見 [schema.sql](./schema.sql) 與 [migrations/](../migrations/)；`mgm_bep_threshold` 由 [create_bep.js](./create_bep.js)／[extend_bep_fixed.js](./extend_bep_fixed.js) 建立。

### 2.6 公司別代碼（跨表共用，必須一致）

| `bu_no` | 名稱 |
|:---:|------|
| HM | 鴻明 Hong Ming |
| HN | 鴻南 Hong Nan |
| SZ | 深圳廠 Shenzhen |

---

## 3. 【Online A】線上頁面 / HTTP API 導入

> 前提：服務已啟動（`node app.js`），可連到 `http://<主機>:3008`。
> 目前版本 API **未強制 Token**（CORS 全開），僅 `/api/system/login` 為登入；線上對外部署時請於網路層（防火牆/VPN/反代）限制存取。

### 3.1 方式一：瀏覽器頁面逐筆（最簡單，適合零星資料）

1. 打開 `http://<主機>:3008`，右上角選公司別／年月。
2. 由左側選單進入對應頁面（採購單、銷售訂單、現金、發票、庫存、銀行…）。
3. 點 **＋新增** 填表 → **存檔**。所有寫入即時進 MySQL，**不需重啟服務**。
4. BEP 門檻：進入「損益平衡分析」，載入後直接改數值 → **儲存門檻**。

### 3.2 方式二：HTTP API 批量（適合程式對接／批量 JSON）

所有清單資源遵循一致風格：`GET /api/<資源>` 查詢、`POST /api/<資源>` 新增、`PUT /api/<資源>/:uid` 更新、`DELETE /api/<資源>/:uid` 刪除。

**PowerShell 範例（新增一筆現金日記帳）：**

```powershell
$body = @{
  bu_no   = 'HM'
  num_vman= 'CVHM202501001'
  wk_date = '2025-01-15'
  amt_type= '銷貨收入'
  DB_CR   = 'DR'
  sub_amt = 881862
} | ConvertTo-Json

Invoke-RestMethod -Uri 'http://localhost:3008/api/cash' -Method Post `
  -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

**批量迴圈（讀 JSON 陣列逐筆 POST）：**

```powershell
$rows = Get-Content 'cash_rows.json' -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($r in $rows) {
  Invoke-RestMethod 'http://localhost:3008/api/cash' -Method Post `
    -ContentType 'application/json; charset=utf-8' `
    -Body ([System.Text.Encoding]::UTF8.GetBytes(($r | ConvertTo-Json)))
}
```

> 中文 Body 請一律用 `UTF8.GetBytes(...)` 傳送，避免 PowerShell 預設編碼把中文變亂碼。

**主要寫入端點一覽：**

| 資源 | 端點前綴 | 特殊動作 |
|------|---------|---------|
| PO 暫存 | `/api/temp-po` | `DELETE /batch/:batch_id` 清批次 |
| 採購單 | `/api/po` | — |
| 銷售單 | `/api/so` | — |
| 送貨單 | `/api/dn` | — |
| 庫存 | `/api/xitems` | `POST /recalc` 重算減值 |
| 現金 | `/api/cash` | — |
| 發票 | `/api/invoice` | `POST /genAR`、`POST /genAP` 產生 AR/AP |
| 付款 | `/api/pay` | `POST /:uid/pay` 註記付款 |
| 票據 | `/api/check` | `POST /:uid/clear` 兌現 |
| 銀行 | `/api/bank` | `POST /recalc` |
| 應收應付 | `/api/arap` | `POST /recalc` |
| 財務摘要 | `/api/summary` | `POST /calcPL`、`POST /addon` |
| 預測 | `/api/forecast` | — |
| 主檔 | `/api/branch` `/api/relation` `/api/account` `/api/monthly` | — |
| 系統碼/KPI | `/api/system/codes`、`/api/system/kpi` | — |
| 使用者 | `/api/user` | `PUT /:user_id/permissions` |
| BEP 門檻 | `/api/bep/save` | — |
| 風險/KPI 試算 | `/api/risk/calc`、`/api/kpi-query/calc` | 計算類，不落原始資料 |

各端點必填欄位 = 第 2 節對應表欄位，欄位名與 DB 相同；完整欄位清單見 [OFFLINE_IMPORT_GUIDE.md](./OFFLINE_IMPORT_GUIDE.md) 第 4 節與 [schema.sql](./schema.sql)。

### 3.3 方式三：第三方 ERP 批次管線（每月整批，推薦常規使用）

管線設計為「第三方 PO 先進暫存區 → 七步加工到報表」：

```
Step1 erp2ermm_po     暫存 PO → 正式 ermm_erp_po
Step2 proc_po         PO 本幣金額/單價加工（×匯率）
Step3 proc_supplier   供應商彙算
Step4 proc_xitems_..  物料法規綁定（簡化版跳過）
Step5 cal_daily_stock 庫存日結算、跌價
Step6 batch_ARAP_upd  AR/AP 彙算
Step7 finance_summary 財務摘要三大報表重算
```

**操作：**

1. 把第三方當月 PO 放進暫存：
   - 少量：tempPo 頁面「＋新增 PO 暫存」，或 `POST /api/temp-po`（帶 `batch_id`，如 `BATCH_202501`）；
   - 大量：用第 4.2 節的離線交接檔先把暫存灌好。
2. 進入「**批次管線**」頁（或直接呼叫）：

```powershell
# 一鍵跑完 7 步（服務需運行）
Invoke-RestMethod 'http://localhost:3008/api/batch/runAll' -Method Post -UseBasicParsing

# 或只跑某一步
Invoke-RestMethod 'http://localhost:3008/api/batch/step1' -Method Post -UseBasicParsing
```

3. 跑完於頁面查看每步狀態（`cams_batch_control` 記錄成功／失敗／錯誤訊息）。

---

## 4. 【Offline C】離線檔案導入（不經 Express，直連 MySQL）

> 前提：在**能連到目標 MySQL 的主機**上操作；需有本機 Node 環境或 mysql 客戶端。無外部網路亦可。

### 4.1 財務 8 表：通用 Excel 匯入器（最常用）

模板：[finance_data_template.xlsx](./finance_data_template.xlsx)，腳本：[import_excel.js](./import_excel.js)。

**五步操作：**

```
1. 打開 database/finance_data_template.xlsx
2. 在各 Sheet「第 3 行」起貼資料（嚴格保留 Row 1 標題、Row 2 欄位代碼）
3. 另存新檔，記住路徑
4. cd e:\finance ; node database/import_excel.js "你的檔案.xlsx"
5. 到「批次管線」頁點「一鍵執行全部」重算報表
```

特性：欄位自動對應（未知欄跳過）、日期清洗（`0000-00-00`/Excel 0 日期→null）、`YYYY_MM` 自動派生、**UPSERT**（重複主鍵覆蓋，可重跑）、每表獨立事務（失敗回滾）、逐表筆數統計。

> 8 個 Sheet 對應表、每欄必填與格式規範，**詳見 [OFFLINE_IMPORT_GUIDE.md](./OFFLINE_IMPORT_GUIDE.md)**（日期 `YYYY-MM-DD`、金額無千分位、年月 `YYYY/MM`、`DR/CR`、`AR/AP` 大寫等）。

重新生成含最新欄位的模板：

```powershell
node database/gen_excel_template.js
```

### 4.2 第三方 ERP 批次交接檔（7 Sheet 全鏈資料）

第三方若能提供**整批 ERP 交接 Excel**，標準 Sheet 結構如下（範例見 [batch_test_202301.xlsx](./batch_test_202301.xlsx)，載入範例見 [load_batch_test.js](./load_batch_test.js)）：

| Sheet | 寫入表 | 內容 |
|-------|--------|------|
| `01_ERP_temp_po` | `ermm_temp_po` | 第三方 PO（之後跑 Step1） |
| `02_ERP_SO` | `ERMM_erp_SO` | 銷售訂單 |
| `03_庫存明細_xitems` | `e2_xitems_daily_status` | 庫存日狀態（跑 Step5） |
| `04_系統參數_codes` | `cams_system_codes` | 系統碼表 |
| `05_發票明細_invoice` | `MGM_invoice_details` | 進銷項發票 |
| `06_現金日記_cash` | `MGM_casher_details` | 現金收支 |
| `07_財務摘要_summary` | `MGM_finance_summary` | 財務摘要 |

**注意：** `load_batch_test.js` 是為 `202301` 批次客製的一次性腳本（含該批次的舊資料清除條件）。導入新批次時：

1. 複製一份並修改頂部 `EXCEL` 檔名與「清除舊資料」清單裡的單號前綴（如 `PO2501%`、`SO2501%`）；
2. 或把其中 5、7（發票/現金/摘要）改用 4.1 通用匯入器，僅保留 1~4 的 ERP 表；
3. 執行後**必跑** `/api/batch/runAll`（或在服務啟動後於頁面觸發）。

> 經驗提醒：交接檔的 Sheet 名需與腳本 `SHEET_TABLE` 完全一致；Row 1/Row 2 慣例同 4.1。建議第三方每次用同一模板輸出，避免欄位漂移。

### 4.3 SQL 方式（整庫初始化／搬遷／備份還原）

```powershell
# 初次建表（在 mysql 已建立 ERMM_db 之後）
mysql -uroot -p ERMM_db -e "source e:/finance/migrations/run_all.sql"
# 或整包 schema
mysql -uroot -p ERMM_db < e:\finance\database\schema.sql

# 整庫備份（離線交接最稳）
mysqldump -uroot -p --default-character-set=utf8mb4 ERMM_db > ERMM_db_20250115.sql

# 整庫還原（到目標主機）
mysql -uroot -p --default-character-set=utf8mb4 ERMM_db < ERMM_db_20250115.sql

# 只清某表重匯
mysql -uroot -p ERMM_db -e "TRUNCATE TABLE MGM_casher_details;"
```

---

## 5. 標準作業流程（SOP）

### 5.1 全新環境初始化（離線建帳）

```
1. 裝 Node.js / MySQL 8；建立 ERMM_db（utf8mb4）
2. 設定 e:\finance\.env（DB_HOST=127.0.0.1…）；npm.cmd install
3. 建表：mysql < migrations/run_all.sql（+ create_bep.js 建門檻表，若需要 BEP）
4. 建主檔：公司/關係人/科目/系統碼（頁面或交接檔 Sheet 04）
5. 匯財務 8 表：node database/import_excel.js <模板.xlsx>
6. ERP 單據：灌入 temp_po / SO / 庫存（交接檔或 API）
7. 啟動服務 node app.js → 批次管線「一鍵執行全部」
8. 勾稽核驗（第 6 節）→ 完成
```

### 5.2 每月例行（線上常規）

```
1. 第三方產出當月交接資料（PO/SO/庫存/發票/現金）
   ├─ 可連線：API 直接寫入 / temp_po 暫存
   └─ 隔離環境：Excel 交接檔 → import_excel.js（或交接檔腳本）
2. 批次管線 runAll（Step1~7）
3. BEP 頁檢查/維護當月門檻並儲存
4. 勾稽核驗 + 前端三大報表抽檢
```

### 5.3 線上 ⇄ 離線 搬移

```
來源主機：mysqldump 整庫匯出 .sql
目標主機：裝 Node/MySQL → 建庫 → 還原 .sql → 放程式碼 → 改 .env 的 DB_HOST → node app.js
```

---

## 6. 匯入後重算與驗證（必做）

1. **重算**：`POST /api/batch/runAll`（或頁面一鍵），確認 7 步皆成功。
2. **BEP 勾稽核查**（材料各項／變動費用／固定成本 明細合計＝門檻值）：

```powershell
node database/check_bep_reconcile_all.js
# 預期：勾稽不符 0、NULL 0、fixed_cost=三明細合計
```

3. **資產負債平衡**（summary 頁抽檢）：
   `資產總額 = 負債總額 + 股東權益`。
4. **中文狀態值不可改**：`po_status`、`po_sub_status`、`so.status`、庫存帳齡等 DB 存中文（如 `審核通過`、`交付完成`），後端 WHERE 依賴這些值，匯入時須照原狀，勿改成英文代碼。

---

## 7. 備份與回滾

- **匯入前備份**：`mysqldump` 整庫，或針對表備份（範例：`CREATE TABLE x_bak LIKE t; INSERT INTO x_bak SELECT * FROM t;`）。
- **UPSERT 可重跑**：財務 8 表與多數頁面保存採 `ON DUPLICATE KEY UPDATE`，重複匯入不會產生重複列，但會覆蓋同鍵舊值。
- **大批量先試跑**：建議先用測試公司或測試庫驗證，再正式匯入。

---

## 8. 常見問題

| 現象 | 原因 / 處理 |
|------|------------|
| 線上 API 連不上 | 確認服務已啟動、連接埠（預設 3008）開放；`/api/health` 自查 |
| 離線腳本連到錯的庫／密碼錯 | `.env` 用 `DB_PASSWORD`；`import_excel.js` 已相容 `DB_PASS`/`DB_PASSWORD`，確認 `.env` 在 `e:\finance` |
| 匯入後頁面全「-」 | Excel 動到 Row 2 欄位代碼；須與 DB 欄位名完全一致 |
| 日期變 `1900-01-01`/`0000-00-00` | 日期格勿填 0；腳本已自動清洗，空日期留白 |
| 金額欄位失敗 | 移除千分位與貨幣符號；百分比填純數字（13 表⽰ 13%） |
| 中文變亂碼 | API 用 `UTF8.GetBytes`；DB/連線字集須 `utf8mb4`；dump 加 `--default-character-set=utf8mb4` |
| 資產負債不平衡 | 檢查 summary 輸入平衡，再跑 runAll 由 Step7 校正 |
| 報表數字沒更新 | 原始表匯入後**忘記跑批次管線** |
| 重複匯入會不會髒 | 不會，UPSERT 覆蓋；但憑證號/發票號撞號會覆蓋舊資料，匯前先確認或備份 |
| 改了前端沒生效 | 靜態檔已設 no-cache，Ctrl+F5；改後端才需重啟 `node app.js` |
| 連接埠 3008 被佔用 | `netstat -ano | findstr :3008` 找 PID → `taskkill /F /PID` |

---

## 9. 關鍵檔案位置

| 用途 | 路徑 |
|------|------|
| 服務入口 / 路由裝配 | [app.js](../app.js) |
| DB 連線池 | [config/db.js](../config/db.js) |
| 環境設定 | `e:\finance\.env` |
| DB 結構 | [schema.sql](./schema.sql)、[migrations/](../migrations/) |
| 離線財務模板/匯入器 | [finance_data_template.xlsx](./finance_data_template.xlsx)、[import_excel.js](./import_excel.js) |
| 模板生成 | [gen_excel_template.js](./gen_excel_template.js) |
| ERP 批次交接範例 | [batch_test_202301.xlsx](./batch_test_202301.xlsx)、[load_batch_test.js](./load_batch_test.js) |
| 批次管線（7 步） | [routes/batch.js](../routes/batch.js)、頁面 batch |
| BEP 門檻建表/維護 | [create_bep.js](./create_bep.js)、`POST /api/bep/save` |
| 勾稽核查 | [check_bep_reconcile_all.js](./check_bep_reconcile_all.js) |
| 8 表欄位細節手冊 | [OFFLINE_IMPORT_GUIDE.md](./OFFLINE_IMPORT_GUIDE.md) |

---

**原則：原始資料不管走線上還是離線進來，最後都統一由「批次管線」重算到三大報表，並以勾稽核查收斂，確保數字一致、可重跑、可回滾。**
