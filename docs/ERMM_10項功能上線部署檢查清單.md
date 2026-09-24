# ERMM 10 項新功能 — 上線部署檢查清單

> **對應文件**：ERMM_10項功能上線驗收報告.md  
> **建立日期**：2026-09-23  
> **適用環境**：Windows / Node.js / MySQL / Express  
> **服務位址**：http://localhost:3008

---

## 使用說明

本清單按部署順序分為 7 個階段，每項旁標註 `[ ]` 供逐一勾選。**所有項目必須全部勾選後方可上線。**

---

## Phase 1：環境前置檢查

### 1.1 基礎環境

| # | 檢查項目 | 預期狀態 | 命令 | 勾選 |
|---|---------|---------|------|------|
| 1.1 | Node.js 版本 >= v18 | v18.20.8+ | `node -v` | [ ] |
| 1.2 | MySQL 服務運行中 | Running | `Get-Service mysql*` | [ ] |
| 1.3 | 連接埠 3008 未被佔用 | LISTENING 為空 | `netstat -ano \| findstr :3008` | [ ] |
| 1.4 | 專案目錄 e:\finance 存在 | 目錄可存取 | `Test-Path e:\finance` | [ ] |

### 1.2 依賴套件

| # | 檢查項目 | 預期狀態 | 命令 | 勾選 |
|---|---------|---------|------|------|
| 1.5 | node_modules 已安裝 | 目錄存在 | `Test-Path e:\finance\node_modules` | [ ] |
| 1.6 | express 已安裝 | ^5.2.1 | `node -e "require('express'); console.log('OK')"` | [ ] |
| 1.7 | mysql2 已安裝 | ^3.24.3 | `node -e "require('mysql2'); console.log('OK')"` | [ ] |
| 1.8 | jsonwebtoken 已安裝 | ^9.0.3 | `node -e "require('jsonwebtoken'); console.log('OK')"` | [ ] |
| 1.9 | bcryptjs 已安裝 | ^3.0.3 | `node -e "require('bcryptjs'); console.log('OK')"` | [ ] |
| 1.10 | dotenv 已安裝 | ^17.4.2 | `node -e "require('dotenv'); console.log('OK')"` | [ ] |

---

## Phase 2：資料庫部署

### 2.1 連線驗證

| # | 檢查項目 | 預期狀態 | 命令 | 勾選 |
|---|---------|---------|------|------|
| 2.1 | .env 檔案存在 | 含 DB_HOST/DB_USER/DB_PASSWORD/DB_NAME | `Test-Path e:\finance\.env` | [ ] |
| 2.2 | 資料庫連線成功 | 輸出 `✅ 資料庫連線成功` | `node -e "const {testConnection}=require('./config/db'); testConnection().then(r=>process.exit(r?0:1))"` | [ ] |

### 2.2 遷移腳本執行

> **執行順序**：必須按下方編號順序執行，不可跳過。

| # | 腳本 | 用途 | 預期輸出 | 執行命令 | 勾選 |
|---|------|------|---------|---------|------|
| 2.3 | `add_new_features_tables.js` | 建立 action_task / alert_rule / alert_log + 種子資料 | `✅ 新功能資料表建立完成` | `node database/add_new_features_tables.js` | [ ] |
| 2.4 | `add_p1p2_tables.js` | 建立 budget / budget_detail / mgmt_dept / mgmt_dept_pl + 種子資料 | `✅ P1/P2 資料表建立完成` | `node database/add_p1p2_tables.js` | [ ] |
| 2.5 | `add_efficiency_data.js` | 補充 mgm_finance_summary 的 employee_cnt / salary_amt / avg_salary（2024-2025，HM/SZ/HN 共 72 筆） | `✅ 更新完成: 72 筆` | `node database/add_efficiency_data.js` | [ ] |

### 2.3 資料表存在性驗證

| # | 表名 | 驗證 SQL | 預期結果 | 勾選 |
|---|------|---------|---------|------|
| 2.5 | `action_task` | `SELECT COUNT(*) FROM action_task` | >= 7 筆 | [ ] |
| 2.6 | `alert_rule` | `SELECT COUNT(*) FROM alert_rule` | >= 5 筆 | [ ] |
| 2.7 | `alert_log` | `SELECT COUNT(*) FROM alert_log` | >= 4 筆 | [ ] |
| 2.8 | `budget` | `SELECT COUNT(*) FROM budget` | = 3 筆 | [ ] |
| 2.9 | `budget_detail` | `SELECT COUNT(*) FROM budget_detail` | >= 180 筆 | [ ] |
| 2.10 | `mgmt_dept` | `SELECT COUNT(*) FROM mgmt_dept` | >= 11 筆 | [ ] |
| 2.11 | `mgmt_dept_pl` | `SELECT COUNT(*) FROM mgmt_dept_pl` | >= 55 筆 | [ ] |

### 2.4 跨公司資料覆蓋驗證

| # | 檢查項目 | 驗證 SQL | 預期結果 | 勾選 |
|---|---------|---------|---------|------|
| 2.12 | action_task 覆蓋 HM/SZ/HN | `SELECT bu_no, COUNT(*) FROM action_task GROUP BY bu_no` | 3 家公司均有資料 | [ ] |
| 2.13 | budget 覆蓋 HM/SZ/HN | `SELECT bu_no FROM budget` | 3 家公司 | [ ] |
| 2.14 | mgmt_dept 覆蓋 HM/SZ/HN | `SELECT bu_no, COUNT(*) FROM mgmt_dept GROUP BY bu_no` | 3 家公司 | [ ] |

---

## Phase 3：後端路由檢查

### 3.1 路由檔案存在性

| # | 路由檔案 | 對應功能 | 路徑 | 勾選 |
|---|---------|---------|------|------|
| 3.1 | diagnosis.js | F-01 異常診斷 | `routes/diagnosis.js` | [ ] |
| 3.2 | action.js | F-02 行動閉環 | `routes/action.js` | [ ] |
| 3.3 | alert.js | F-03 主動預警 | `routes/alert.js` | [ ] |
| 3.4 | analysis.js | F-04 多維下鑽 | `routes/analysis.js` | [ ] |
| 3.5 | cashForecast.js | F-05 現金預測 | `routes/cashForecast.js` | [ ] |
| 3.6 | mgmtAccounting.js | F-06 管理會計 | `routes/mgmtAccounting.js` | [ ] |
| 3.7 | consolidation.js | F-07 合併報表 | `routes/consolidation.js` | [ ] |
| 3.8 | budget.js | F-08 預算編制 | `routes/budget.js` | [ ] |
| 3.9 | aiqa.js | F-09 AI 問答 | `routes/aiqa.js` | [ ] |
| 3.10 | scenario.js | F-10 情景模擬 | `routes/scenario.js` | [ ] |

### 3.2 app.js 路由註冊驗證

| # | 註冊語句 | 行號 | 勾選 |
|---|---------|------|------|
| 3.11 | `app.use('/api/diagnosis', diagnosisRoutes)` | L106 | [ ] |
| 3.12 | `app.use('/api/action', actionRoutes)` | L102 | [ ] |
| 3.13 | `app.use('/api/alert', alertRoutes)` | L103 | [ ] |
| 3.14 | `app.use('/api/analysis', analysisRoutes)` | L104 | [ ] |
| 3.15 | `app.use('/api/cash-forecast', cashForecastRoutes)` | L105 | [ ] |
| 3.16 | `app.use('/api/mgmt-accounting', mgmtAccountingRoutes)` | L109 | [ ] |
| 3.17 | `app.use('/api/consolidation', consolidationRoutes)` | L108 | [ ] |
| 3.18 | `app.use('/api/budget', budgetRoutes)` | L107 | [ ] |
| 3.19 | `app.use('/api/aiqa', aiqaRoutes)` | L110 | [ ] |
| 3.20 | `app.use('/api/scenario', scenarioRoutes)` | L111 | [ ] |

### 3.3 require 語句驗證

| # | require 語句 | 行號 | 勾選 |
|---|------------|------|------|
| 3.21 | `const actionRoutes = require('./routes/action')` | L58 | [ ] |
| 3.22 | `const alertRoutes = require('./routes/alert')` | L59 | [ ] |
| 3.23 | `const analysisRoutes = require('./routes/analysis')` | L60 | [ ] |
| 3.24 | `const cashForecastRoutes = require('./routes/cashForecast')` | L61 | [ ] |
| 3.25 | `const diagnosisRoutes = require('./routes/diagnosis')` | L62 | [ ] |
| 3.26 | `const budgetRoutes = require('./routes/budget')` | L63 | [ ] |
| 3.27 | `const consolidationRoutes = require('./routes/consolidation')` | L64 | [ ] |
| 3.28 | `const mgmtAccountingRoutes = require('./routes/mgmtAccounting')` | L65 | [ ] |
| 3.29 | `const aiqaRoutes = require('./routes/aiqa')` | L66 | [ ] |
| 3.30 | `const scenarioRoutes = require('./routes/scenario')` | L67 | [ ] |

---

## Phase 4：前端頁面檢查

### 4.1 頁面檔案存在性

| # | 頁面檔案 | 對應功能 | 路徑 | 勾選 |
|---|---------|---------|------|------|
| 4.1 | dashboard.js | F-01 異常診斷（嵌入） | `public/js/pages/dashboard.js` | [ ] |
| 4.2 | actions.js | F-02 行動閉環 | `public/js/pages/actions.js` | [ ] |
| 4.3 | alerts.js | F-03 主動預警 | `public/js/pages/alerts.js` | [ ] |
| 4.4 | drilldown.js | F-04 多維下鑽 | `public/js/pages/drilldown.js` | [ ] |
| 4.5 | cashForecast.js | F-05 現金預測 | `public/js/pages/cashForecast.js` | [ ] |
| 4.6 | mgmtAccounting.js | F-06 管理會計 | `public/js/pages/mgmtAccounting.js` | [ ] |
| 4.7 | consolidation.js | F-07 合併報表 | `public/js/pages/consolidation.js` | [ ] |
| 4.8 | budget.js | F-08 預算編制 | `public/js/pages/budget.js` | [ ] |
| 4.9 | aiqa.js | F-09 AI 問答 | `public/js/pages/aiqa.js` | [ ] |
| 4.10 | scenario.js | F-10 情景模擬 | `public/js/pages/scenario.js` | [ ] |

### 4.2 index.html script 引入

| # | script 標籤 | 行號 | 勾選 |
|---|------------|------|------|
| 4.11 | `<script src="/js/pages/actions.js"></script>` | L244 | [ ] |
| 4.12 | `<script src="/js/pages/alerts.js"></script>` | L245 | [ ] |
| 4.13 | `<script src="/js/pages/drilldown.js"></script>` | L246 | [ ] |
| 4.14 | `<script src="/js/pages/cashForecast.js"></script>` | L247 | [ ] |
| 4.15 | `<script src="/js/pages/mgmtAccounting.js"></script>` | L248 | [ ] |
| 4.16 | `<script src="/js/pages/budget.js"></script>` | L249 | [ ] |
| 4.17 | `<script src="/js/pages/consolidation.js"></script>` | L250 | [ ] |
| 4.18 | `<script src="/js/pages/aiqa.js"></script>` | L251 | [ ] |
| 4.19 | `<script src="/js/pages/scenario.js"></script>` | L252 | [ ] |

### 4.3 側邊欄選單

| # | 選單項 | data-page | 勾選 |
|---|--------|-----------|------|
| 4.20 | 行動追蹤 | actions | [ ] |
| 4.21 | 預警中心 | alerts | [ ] |
| 4.22 | 多維下鑽 | drilldown | [ ] |
| 4.23 | 現金預測 | cashForecast | [ ] |
| 4.24 | 管理會計 | mgmtAccounting | [ ] |
| 4.25 | 預算編制 | budget | [ ] |
| 4.26 | 合併報表 | consolidation | [ ] |
| 4.27 | AI 問答 | aiqa | [ ] |
| 4.28 | 情景模擬 | scenario | [ ] |

### 4.4 國際化翻譯

| # | 翻譯鍵 | zh-TW | zh-CN | en | 勾選 |
|---|--------|-------|-------|-----|------|
| 4.29 | `page.actions` / `nav.actions` | 行動追蹤 | 行动追踪 | Actions | [ ] |
| 4.30 | `page.alerts` / `nav.alerts` | 預警中心 | 预警中心 | Alerts | [ ] |
| 4.31 | `page.drilldown` / `nav.drilldown` | 多維下鑽 | 多维下钻 | Drill-down | [ ] |
| 4.32 | `page.cashForecast` / `nav.cashForecast` | 現金預測 | 现金预测 | Cash Forecast | [ ] |
| 4.33 | `page.mgmtAccounting` / `nav.mgmtAccounting` | 管理會計 | 管理会计 | Mgmt Accounting | [ ] |
| 4.34 | `page.budget` / `nav.budget` | 預算編制 | 预算编制 | Budget | [ ] |
| 4.35 | `page.consolidation` / `nav.consolidation` | 合併報表 | 合并报表 | Consolidation | [ ] |
| 4.36 | `page.aiqa` / `nav.aiqa` | AI 財務問答 | AI 财务问答 | AI Q&A | [ ] |
| 4.37 | `page.scenario` / `nav.scenario` | 財務情景模擬 | 财务情景模拟 | Scenario | [ ] |

---

## Phase 5：服務啟動與 API 驗證

### 5.1 服務啟動

| # | 檢查項目 | 預期狀態 | 命令 | 勾選 |
|---|---------|---------|------|------|
| 5.1 | 停止舊服務（如有） | 無 node 進程 | `Get-Process node -ErrorAction SilentlyContinue \| Stop-Process -Force` | [ ] |
| 5.2 | 啟動服務 | 輸出 `✅ 資料庫連線成功` + `🚀 伺服器啟動於 port 3008` | `node app.js` | [ ] |
| 5.3 | 服務健康檢查 | HTTP 200 | `Invoke-WebRequest http://localhost:3008/api/health -UseBasicParsing` | [ ] |

### 5.2 登入驗證

| # | 檢查項目 | 預期狀態 | 命令 | 勾選 |
|---|---------|---------|------|------|
| 5.4 | 使用者登入取得 Token | `success: true` + 回傳 JWT token | `node -e "const http=require('http');...POST /api/auth/login"` | [ ] |

### 5.3 API 端點逐一驗證（22 項）

#### P0 緊急

| # | 功能 | 端點 | 方法 | 預期 | 勾選 |
|---|------|------|------|------|------|
| 5.5 | 異常診斷 | `/api/diagnosis/kpi?bu_no=HM&YYYY_MM=2025/12&kpi_id=gross_profit` | GET | 200 + success | [ ] |
| 5.6 | 行動閉環-列表 | `/api/action?bu_no=HM` | GET | 200 + 陣列 | [ ] |
| 5.7 | 行動閉環-統計 | `/api/action/stats/count?bu_no=HM` | GET | 200 + pending/doing/done | [ ] |
| 5.8 | 主動預警-通知 | `/api/alert/logs?bu_no=HM` | GET | 200 + 陣列 | [ ] |
| 5.9 | 主動預警-未讀數 | `/api/alert/logs/unread-count?bu_no=HM` | GET | 200 + count | [ ] |
| 5.10 | 主動預警-規則 | `/api/alert/rules` | GET | 200 + 陣列 | [ ] |

#### P1 重要

| # | 功能 | 端點 | 方法 | 預期 | 勾選 |
|---|------|------|------|------|------|
| 5.11 | 多維下鑽-產品 | `/api/analysis/product?bu_no=HM&YYYY_MM=2025/12` | GET | 200 + 陣列 | [ ] |
| 5.12 | 多維下鑽-客戶 | `/api/analysis/customer?bu_no=HM&YYYY_MM=2025/12` | GET | 200 + 陣列 | [ ] |
| 5.13 | 多維下鑽-部門 | `/api/analysis/department?bu_no=HM&YYYY_MM=2025/12` | GET | 200 + 陣列 | [ ] |
| 5.14 | 現金預測 | `/api/cash-forecast/weekly?bu_no=HM&weeks=13` | GET | 200 + 13 週資料 | [ ] |
| 5.15 | 管理會計-部門損益 | `/api/mgmt-accounting/dept-summary?bu_no=HM&YYYY=2025` | GET | 200 + 陣列 | [ ] |
| 5.16 | 管理會計-成本結構 | `/api/mgmt-accounting/cost-structure?bu_no=HM` | GET | 200 + 物件 | [ ] |
| 5.17 | 管理會計-人效 | `/api/mgmt-accounting/efficiency?bu_no=HM` | GET | 200 + 物件 | [ ] |

#### P2 優化

| # | 功能 | 端點 | 方法 | 預期 | 勾選 |
|---|------|------|------|------|------|
| 5.18 | 合併報表-概覽 | `/api/consolidation/overview?YYYY_MM=2025/12` | GET | 200 + 物件 | [ ] |
| 5.19 | 合併報表-損益 | `/api/consolidation/income?YYYY_MM=2025/12` | GET | 200 + 物件 | [ ] |
| 5.20 | 合併報表-資產負債 | `/api/consolidation/balance-sheet?YYYY_MM=2025/12` | GET | 200 + 物件 | [ ] |
| 5.21 | 預算編制-彙總 | `/api/budget/summary?bu_no=HM&YYYY=2025` | GET | 200 + 物件 | [ ] |
| 5.22 | 預算編制-月度進度 | `/api/budget/monthly-progress?bu_no=HM&YYYY=2025` | GET | 200 + 陣列 | [ ] |
| 5.23 | AI 問答-建議 | `/api/aiqa/suggestions` | GET | 200 + 陣列 | [ ] |
| 5.24 | AI 問答-查詢 | `/api/aiqa/ask` | POST | 200 + answer | [ ] |
| 5.25 | 情景模擬 | `/api/scenario/simulate` | POST | 200 + scenarios | [ ] |

### 5.4 健壯性驗證

| # | 測試情境 | 端點 | 預期 | 勾選 |
|---|---------|------|------|------|
| 5.26 | 不傳 bu_no 查詢行動列表 | `GET /api/action`（無 query） | 200 + 全公司資料 | [ ] |
| 5.27 | 不傳 bu_no 查詢統計 | `GET /api/action/stats/count`（無 query） | 200 + 全公司統計 | [ ] |

---

## Phase 6：瀏覽器頁面驗證

| # | 頁面 | 導航方式 | 檢查重點 | 勾選 |
|---|------|---------|---------|------|
| 6.1 | Dashboard（含異常診斷） | `navigate('dashboard')` | KPI 卡片正常、紅燈有🔍連結、點擊彈窗顯示 Top3 | [ ] |
| 6.2 | 行動閉環 | `navigate('actions')` | 三欄 Kanban、新建任務、拖動狀態 | [ ] |
| 6.3 | 主動預警 | `navigate('alerts')` | 通知列表、未讀標記、一鍵已讀 | [ ] |
| 6.4 | 多維下鑽 | `navigate('drilldown')` | 三頁籤切換、排行榜、貢獻度長條圖 | [ ] |
| 6.5 | 現金預測 | `navigate('cashForecast')` | 4 張摘要卡、13 週折線圖、安全水位線 | [ ] |
| 6.6 | 管理會計 | `navigate('mgmtAccounting')` | 部門損益表、成本圓餅圖、人效指標 | [ ] |
| 6.7 | 預算編制 | `navigate('budget')` | 預算 vs 實際、差異分析、月度進度圖 | [ ] |
| 6.8 | 合併報表 | `navigate('consolidation')` | 合併損益、資產負債、內部交易沖銷 | [ ] |
| 6.9 | AI 問答 | `navigate('aiqa')` | 輸入問題、回覆答案、建議列表 | [ ] |
| 6.10 | 情景模擬 | `navigate('scenario')` | 三情景參數表、執行模擬、對比表+圖表 | [ ] |

### 6.1 控制台錯誤檢查

| # | 檢查項目 | 預期 | 勾選 |
|---|---------|------|------|
| 6.11 | 10 個頁面控制台無 Error | 無紅色錯誤訊息 | [ ] |
| 6.12 | 10 個頁面控制台無 404/500 網路請求 | 所有 API 回傳 200 | [ ] |

### 6.2 國際化切換

| # | 檢查項目 | 預期 | 勾選 |
|---|---------|------|------|
| 6.13 | 切換至簡體中文 | 所有標題/選單正確顯示 | [ ] |
| 6.14 | 切換至英文 | 所有標題/選單正確顯示 | [ ] |
| 6.15 | 切換回繁體中文 | 所有標題/選單正確顯示 | [ ] |

---

## Phase 7：上線後監控

### 7.1 上線首日監控

| # | 監控項目 | 頻率 | 預期 | 勾選 |
|---|---------|------|------|------|
| 7.1 | 服務進程存活 | 每 2 小時 | node 進程存在 | [ ] |
| 7.2 | API 錯誤率 | 每 2 小時 | < 1% | [ ] |
| 7.3 | 資料庫連線池 | 每 2 小時 | 連線數 < 20 | [ ] |
| 7.4 | 頁面載入時間 | 每 4 小時 | < 3 秒 | [ ] |

### 7.2 上線一週後檢查

| # | 檢查項目 | 預期 | 勾選 |
|---|---------|------|------|
| 7.5 | 收集使用者反饋 | 無嚴重問題 | [ ] |
| 7.6 | 預警通知是否正常觸發 | alert_log 有新增紀錄 | [ ] |
| 7.7 | 行動任務流程是否正常使用 | action_task 有狀態變更 | [ ] |
| 7.8 | 評估是否需實現已知限制的優化項 | 產出優化排程 | [ ] |

---

## 簽核區

| 角色 | 姓名 | 日期 | 簽核 |
|------|------|------|------|
| 開發負責人 | | | [ ] |
| 測試負責人 | | | [ ] |
| 系統管理員 | | | [ ] |
| 業務負責人 | | | [ ] |

---

## 附錄：快速驗證腳本

以下腳本可一次性驗證全部 22 個 API 端點：

```bash
# 1. 啟動服務
node app.js

# 2. 執行 API 全量測試（需先登入取得 Token）
node -e "
const http=require('http');
function req(method,path,body,token){return new Promise((resolve,reject)=>{const data=body?JSON.stringify(body):null;const headers={};if(data){headers['Content-Type']='application/json';headers['Content-Length']=Buffer.byteLength(data);}if(token)headers['Authorization']='Bearer '+token;const r=http.request({hostname:'localhost',port:3008,path,method,headers},res=>{let buf='';res.on('data',c=>buf+=c);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(buf)});}catch(e){resolve({status:res.statusCode,body:buf});}});});r.on('error',reject);if(data)r.write(data);r.end();});}
(async()=>{const login=await req('POST','/api/auth/login',{user_id:'U0001',password:'test123'});const token=login.body.data.token;const tests=[['GET','/api/diagnosis/kpi?bu_no=HM&YYYY_MM=2025/12&kpi_id=gross_profit'],['GET','/api/action?bu_no=HM'],['GET','/api/action/stats/count?bu_no=HM'],['GET','/api/alert/logs?bu_no=HM'],['GET','/api/alert/logs/unread-count?bu_no=HM'],['GET','/api/alert/rules'],['GET','/api/analysis/product?bu_no=HM&YYYY_MM=2025/12'],['GET','/api/analysis/customer?bu_no=HM&YYYY_MM=2025/12'],['GET','/api/analysis/department?bu_no=HM&YYYY_MM=2025/12'],['GET','/api/cash-forecast/weekly?bu_no=HM&weeks=13'],['GET','/api/mgmt-accounting/dept-summary?bu_no=HM&YYYY=2025'],['GET','/api/mgmt-accounting/cost-structure?bu_no=HM'],['GET','/api/mgmt-accounting/efficiency?bu_no=HM'],['GET','/api/consolidation/overview?YYYY_MM=2025/12'],['GET','/api/consolidation/income?YYYY_MM=2025/12'],['GET','/api/consolidation/balance-sheet?YYYY_MM=2025/12'],['GET','/api/budget/summary?bu_no=HM&YYYY=2025'],['GET','/api/budget/monthly-progress?bu_no=HM&YYYY=2025'],['GET','/api/aiqa/suggestions'],['POST','/api/aiqa/ask',{question:'毛利率',bu_no:'HM'}],['POST','/api/scenario/simulate',{bu_no:'HM',YYYY_MM:'2025/12',scenarios:{}}]];let pass=0,fail=0;for(const[m,p,b]of tests){const r=await req(m,p,b,token);const ok=r.status===200&&r.body.success;if(ok)pass++;else fail++;console.log((ok?'✅':'❌')+' '+m+' '+p);}console.log('\n結果: '+pass+' 通過 / '+fail+' 失敗 / 共 '+tests.length);process.exit(fail>0?1:0);})();
"
```

---

## 附錄：回滾計畫

若上線後發現嚴重問題需回滾：

| 步驟 | 操作 | 命令 |
|------|------|------|
| 1 | 停止服務 | `Get-Process node \| Stop-Process -Force` |
| 2 | 還原 app.js（移除 10 行路由註冊） | git checkout 或手動移除 L58-67, L102-111 |
| 3 | 還原 index.html（移除 9 個 script + 9 個選單項） | git checkout 或手動移除 L244-252 |
| 4 | 還原 i18n.js（移除 9 鍵 × 3 語翻譯） | git checkout |
| 5 | 資料表可保留（不影響原有功能） | — |
| 6 | 重啟服務 | `node app.js` |
| 7 | 驗證原有功能正常 | 瀏覽器測試 dashboard 等頁面 |
