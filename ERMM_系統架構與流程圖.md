# ERMM 財務模組管理系統 — 架構與流程圖

> **版本**: v1.1 | **更新日期**: 2026-11-05 | **最後部署**: Commit `46c383e`

---

## 一、技術棧總覽

| 層 | 技術 | 說明 |
|----|------|------|
| **前端** | 原生 HTML5 + CSS3 + ES6+ | 無框架（React/Vue），輕量 SPA |
| **後端** | Node.js 18 + Express 4.x | RESTful API，48 個路由模組 |
| **資料庫** | MySQL 8.x (InnoDB, utf8mb4) | 40+ 張資料表，批次管線 7 步驟 |
| **驗證** | JWT (HS256) | `localStorage.ermm_token` + Bearer Token |
| **LLM** | DeepSeek API（可切換 Kimi） | `utils/llmClient.js` 統一 Provider 管理 |
| **RAG** | MySQL FULLTEXT + n-gram 滑窗 | 無向量資料庫，輕量檢索 |
| **圖表** | Chart.js 4.4.1 | 本地 vendor 目錄 + CDN fallback |
| **部署** | PM2 (ecosystem.config.js) | Linux 一鍵腳本 `deploy_ubuntu.sh` |

---

## 二、系統架構圖

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        ERMM 系統架構 (v1.1)                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  使用者瀏覽器 (Chrome/Edge)                                     │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │    │
│  │  │  HTML/CSS/JS  │  │ Chart.js 圖表 │  │ 46 個 SPA 頁面模組    │ │    │
│  │  │  index.html   │  │ vendor/ 目錄  │  │ pages/*.js           │ │    │
│  │  └──────────────┘  └──────────────┘  └───────────────────────┘ │    │
│  │         ↕ HTTPS / RESTful / JWT Bearer Token                     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              ↓                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Express.js 後端 (:3008)                                        │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │    │
│  │  │ Auth 中間件    │  │ 回應統一格式   │  │ 全域 401 → 強制登出  │ │    │
│  │  │ verifyToken() │  │ ok()/fail()  │  │ handle401()          │ │    │
│  │  └──────────────┘  └──────────────┘  └───────────────────────┘ │    │
│  │                                                                 │    │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌─────────────────┐ │    │
│  │  │ 批次管線   │ │ 風險計算   │ │ LLM 客戶端 │ │ 診斷/預測引擎   │ │    │
│  │  │ Step1-7   │ │ Z-score   │ │ 多 Provider│ │ KPI 归因/蒙特卡 │ │    │
│  │  └───────────┘ └───────────┘ └───────────┘ └─────────────────┘ │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              ↓                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  MySQL 8.x 資料庫 (ERMM_db)                                    │    │
│  │  40+ 張資料表 · 19 個 Migration · 批次管線自動建置                │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              ↕                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  DeepSeek / Kimi LLM API（智能問答 / AI 摘要 / 智能归因）         │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 三、API 模組地圖（48 個路由）

### 🧠 智能化模組 (Top 5) — 2026-11 新增

| API 路由 | 後端檔案 | 前端頁面 | 功能 |
|----------|---------|---------|------|
| `/api/aiqa/*` | `routes/aiqa.js` | `pages/aiqa.js` | **T-1 AI 智能問答 + RAG**（提問/建議/知識庫/對話歷史） |
| `/api/daily-summary/*` | `routes/dailySummary.js` | Dashboard 內嵌 | **C-1 每日 AI 執行摘要**（生成/最新/歷史/聚合） |
| `/api/data-quality/*` | `routes/dataQuality.js` | `pages/dataQuality.js` | **T-3 數據質量自動掃描**（7 大類 20+ 項檢查） |
| `/api/ar-smart/*` | `routes/arSmart.js` | `pages/arSmart.js` | **O-3 AR 智能催收排序**（催收評分/總覽） |
| `/api/cash-forecast/monte-carlo` | `routes/cashMonteCarlo.js` | Dashboard | **F-3 現金流概率預測**（蒙特卡洛 5000 次） |
| `/api/diagnosis/*` | `routes/diagnosis.js` | Dashboard 彈窗 | KPI 異常診斷 + LLM 智能归因 |
| `/api/llm/*` | `routes/llm.js` | `pages/system.js` | LLM 服務商管理（DeepSeek/Kimi 可切換） |

### 📊 核心財務模組

| API 路由 | 後端檔案 | 前端頁面 | 功能 |
|----------|---------|---------|------|
| `/api/summary/*` | `routes/summary.js` | `pages/summary.js` | 財務摘要（Dashboard 核心資料源） |
| `/api/report/*` | `routes/report.js` | `pages/report.js` | 三大報表：資產負債表/損益表/現金流量表 |
| `/api/forecast/*` | `routes/forecast.js` | `pages/forecast.js` | 趨勢預測（銷售/成本/利潤走勢） |
| `/api/risk/*` | `routes/risk.js` | `pages/risk.js` | 風險預警掃描（Altman Z-score 多維計算） |
| `/api/bep/*` | `routes/bep.js` | `pages/bep.js` | 損益平衡分析（單品/線上/月度） |
| `/api/budget/*` | `routes/budget.js` | `pages/budget.js` | 預算編制（預算/明細/彙總/達成進度） |
| `/api/scenario/*` | `routes/scenario.js` | `pages/scenario.js` | 情景模擬（What-if 儲存/載入/模擬） |
| `/api/mgmt-accounting/*` | `routes/mgmtAccounting.js` | `pages/mgmtAccounting.js` | 管理會計（部門損益/科目明細） |
| `/api/consolidation/*` | `routes/consolidation.js` | `pages/consolidation.js` | 合併報表（集團損益/資產負債表） |
| `/api/cash-forecast/*` | `routes/cashForecast.js` | `pages/cashForecast.js` | 現金預測（週別現金水位 + 蒙特卡洛模擬） |
| `/api/analysis/*` | `routes/analysis.js` | Dashboard 下鑽 | 分析下鑽（產品/客戶/部門三維度） |

### 💡 稅務模組

| API 路由 | 後端檔案 | 前端頁面 | 功能 |
|----------|---------|---------|------|
| `/api/finance/*` | `routes/finance.js` | `pages/finance.js` | 會計科目/憑證/勾稽核對/稅務申報全流程 |
| `/api/tax/*` | `routes/tax.js` | `pages/tax.js` | VAT/CIT/IIT 三大報稅模組（20+ API） |

### 📋 日常作業模組

| API 路由 | 後端檔案 | 前端頁面 | 功能 |
|----------|---------|---------|------|
| `/api/arap/*` | `routes/arap.js` | `pages/arap.js` | 應收應付（AR 催收/AP 對帳） |
| `/api/invoice/*` | `routes/invoice.js` | `pages/invoice.js` | 發票管理 |
| `/api/cash/*` | `routes/cash.js` | `pages/cash.js` | 現金日記帳 |
| `/api/pay/*` | `routes/pay.js` | `pages/pay.js` | 付款明細 |
| `/api/check/*` | `routes/check.js` | `pages/check.js` | 票據管理 |
| `/api/bank/*` | `routes/bank.js` | `pages/bank.js` | 銀行貸款（CRUD + 重算） |
| `/api/po/*` | `routes/po.js` | `pages/po.js` | 採購單 |
| `/api/so/*` | `routes/so.js` | `pages/so.js` | 銷售訂單 |
| `/api/dn/*` | `routes/dn.js` | `pages/dn.js` | SO 交貨單 |
| `/api/temp-po/*` | `routes/tempPo.js` | `pages/tempPo.js` | PO 暫存 |
| `/api/xitems/*` | `routes/xitems.js` | `pages/xitems.js` | 存貨管理 |

### ⚙️ 系統與基礎設施

| API 路由 | 後端檔案 | 前端頁面 | 功能 |
|----------|---------|---------|------|
| `/api/auth/*` | `routes/auth.js` | 登入頁面 | 認證（JWT 登入/登出/驗證） |
| `/api/system/*` | `routes/system.js` | `pages/system.js` | 系統設定值/字典/KPI/批次控制 |
| `/api/user/*` | `routes/user.js` | `pages/user.js` | 使用者管理 |
| `/api/branch/*` | `routes/branch.js` | `pages/branch.js` | 分公司/公司別管理 |
| `/api/relation/*` | `routes/relation.js` | `pages/relation.js` | 往來對象（客戶/供應商） |
| `/api/batch-ctrl/*` | `routes/batchCtrl.js` | `pages/batch.js` | 批次管線狀態查詢 |
| `/api/batch/*` | `routes/batch.js` | `pages/batch.js` | 批次執行（Step1-7 + runAll） |
| `/api/integration/*` | `routes/integration.js` | `pages/integration.js` | ERP 第三方資料整合日誌 |

### 🔍 預警與 KPI

| API 路由 | 後端檔案 | 前端頁面 | 功能 |
|----------|---------|---------|------|
| `/api/alert/*` | `routes/alert.js` | `pages/alerts.js` | 預警規則/日誌/每日掃描 |
| `/api/kpi/*` | `routes/kpi.js` | `pages/kpi.js` | KPI 門檻設定 |
| `/api/kpi-query/*` | `routes/kpiQuery.js` | `pages/kpiQuery.js` | KPI 異常診斷/預測模型 |
| `/api/benchmark/*` | `routes/benchmark.js` | `pages/benchmark.js` | 同業標竿維護 |
| `/api/monthly/*` | `routes/monthly.js` | `pages/monthly.js` | 月度項目管理 |
| `/api/action/*` | `routes/action.js` | `pages/actions.js` | 行動追蹤 |
| `/api/daily-report/*` | `routes/dailyReport.js` | `pages/dailyReport.js` | 月報/人效/年度績效/部門橫向對比 |
| `/api/war-room/*` | `routes/warRoom.js` | `pages/warRoom.js` | 戰情看板 |
| `/api/account/*` | `routes/account.js` | `pages/account.js` | 帳戶明細 |

---

## 四、資料流程圖

### 4.1 批次管線（7 步驟自動化）

```
ERP 原始資料
    │
    ▼
┌──────────────────────────────────────────────────────────────────┐
│  批次管線 /api/batch/runAll                                      │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Step1  讀取 ERP PO/SO 明細                    (ermm_erp_po)    │
│    ↓                                                             │
│  Step2  讀取 ERP 交貨單                          (ermm_erp_so_dn)│
│    ↓                                                             │
│  Step3  讀取 ERP 生產工單                        (ermm_erp_mo)   │
│    ↓                                                             │
│  Step4  計算發票/AR/AP 明細                      (mgm_invoice_details)│
│    ↓                                                             │
│  Step5  彙總現金/銀行/票據變動                    (mgm_casher_details)│
│    ↓                                                             │
│  Step6  計算銀行貸款利息                          (mgm_bank_loan_details)│
│    ↓                                                             │
│  Step7  寫入財務摘要 + 計算 Z-score 風險值        (mgm_finance_summary)│
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
    │
    ▼
   完成！前端 Dashboard/三大報表/風險預警 全部讀 mgm_finance_summary
```

### 4.2 AI 智能問答流程（T-1 RAG）

```
使用者提問："HM 今年毛利率怎麼樣？"
    │
    ▼
/api/aiqa/ask
    │
    ├── 1. 詞彙切分 → 抽出 ["HM", "毛利率", "今年", "2025"]
    │
    ├── 2. RAG 檢索（輕量）
    │      ├── n-gram 2-4 滑窗 + OR 聚合 LIKE
    │      ├── ermm_knowledge (FULLTEXT INDEX)
    │      └── ermm_kb_miss_log (未命中寫入)
    │
    ├── 3. 財務資料補強
    │      └── mgm_finance_summary（毛利率 = (sale - cost) / sale）
    │
    └── 4. LLM 生成回答
           └── POST DeepSeek API（getDefaultProvider 統一）
                │
                ▼
           自然語言回答 + 引用知識條目
```

### 4.3 AR 智能催收排序（O-3）

```
/api/ar-smart/collections?bu_no=HM
    │
    ├── 1. 查詢 mgm_invoice_details WHERE TX_type='AR'
    │      （每筆發票 = 一筆應收賬款）
    │
    ├── 2. 五維度加權評分
    │      ├── 賬齡天數 × 40%  （越舊越高分）
    │      ├── 逾期天數 × 30%  （逾期越多越高分）
    │      ├── 金額規模 × 15%  （金額越大越高分）
    │      ├── 風險綜合   × 10%  （客戶 Z-score 反向映射）
    │      └── 單筆佔比   ×  5%  （佔 AR 總額比例）
    │
    └── 3. 輸出分級
           ├── ≥70 分 🔴 緊急催收
           ├── 50~70 🟠 高優先
           ├── 30~50 🟡 常規追蹤
           └── <30  🟢 正常
```

### 4.4 數據質量掃描（T-3）

```
/api/data-quality/scan  （毫秒級返回，無需異步）
    │
    ├── 1. Z_score 未計算       → 掃描 mgm_finance_summary WHERE Z_score IS NULL
    ├── 2. 重複記錄              → 逐表 COUNT GROUP BY HAVING > 1
    ├── 3. 金額異常              → sale_amt / stock_value_amt / ...
    ├── 4. 逾期 forecast         → forecast_detail WHERE forecast_month < 當月
    ├── 5. AR 對賬差異           → SUM(AR_amt) vs SUM(invoice AR)
    ├── 6. 稅務表 vs 摘要不一致  → VAT declarations vs finance_summary
    └── 7. 表級健康度            → 8 張核心表 COUNT / HAS 缺失欄位 / 索引
```

### 4.5 每日 AI 執行摘要（C-1）

```
觸發方式：自動 (batch runAll 後) / 手動 (Dashboard "⚡立即生成") / API
    │
    ▼
POST /api/daily-summary/generate
    │
    ├── 1. 彙總財務快照相關資料
    │      ├── mgm_finance_summary（當月 + 去年同期 YoY）
    │      ├── forecast_detail（當月 vs 預測）
    │      └── mgm_invoice_details（AR 催收水位）
    │
    ├── 2. LLM 分析（DeepSeek，6-10 秒）
    │      ├── Prompt：財務快照 + YoY 對比 + 風險評分 + 同業位置
    │      └── 輸出：標題 + 自然語言摘要 + 異常條目 + 行動建議
    │
    └── 3. 存入 daily_ai_summary
           └── Dashboard 讀 latest TOP 1 展示
```

---

## 五、前端頁面註冊機制

```javascript
// app.js 全域註冊函式
function registerPage(pageId, asyncFn) {
    pages[pageId] = asyncFn;
}

// 各頁面模組（pages/*.js）
registerPage('arSmart', async (container) => {
    // container = <div id="pageContent">
    container.innerHTML = `...`;
    await fetchData();
});

// 側邊欄點擊（index.html）
<div class="nav-item" data-page="arSmart" onclick="navigate('arSmart')">
    🎯 AR 智能催收
</div>

// navigate() 內部流程
function navigate(pageId) {
    if (!Auth.isLoggedIn()) return;  // 🔒 未登入攔截
    pages[pageId](document.getElementById('pageContent'));
}
```

---

## 六、認證流程

```
POST /api/auth/login  { user_id, password }
    │
    ▼
routes/auth.js → 驗證使用者 → 簽發 JWT
    │
    ▼
localStorage.setItem('ermm_token', token)   ← 統一 Key！
localStorage.setItem('ermm_user', JSON.stringify(user))
    │
    ▼
所有 API request fetch:
    headers: { Authorization: 'Bearer ' + Auth.getToken() }
    │
    ▼
Auth.getToken() = localStorage.getItem('ermm_token')  ← 統一讀取！

失敗（401）→ fetch wrapper → Auth.handle401()
    → localStorage.removeItem('ermm_token')
    → 顯示登入畫面（body.classList.add('locked')）
```

---

## 七、部署與維運

| 專案 | 說明 |
|------|------|
| 啟動 | `node app.js` 或 `pm2 start ecosystem.config.js` |
| 埠號 | 3008 |
| 資料庫 | `ERMM_db`（`migrations/run_all.sql` 一鍵建置） |
| 使用者 | 預設 `rocky / 68315711`（admin: Yes） |
| PM2 腳本 | `deploy_ubuntu.sh`（Linux 一鍵部署） |
| 日誌 | `pm2 logs ermm-finance` |
| 健康檢查 | `GET /api/health` |

---

## 八、API 回應格式（統一）

```json
// 成功
{ "success": true, "code": 200, "data": { ... } }

// 失敗
{ "success": false, "message": "錯誤說明" }

// 401 未授權 → 全域 fetch wrapper 自動觸發 handle401()
```

---

*文件產生時間：2026-11-05 | 基於 85 個 Commit + 40 個 Migration + 48 個 API 路由*
