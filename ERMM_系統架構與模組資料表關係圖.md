# ERMM 財務模組管理系統 — 模組資料表關係圖

> **版本**: v1.1 | **更新日期**: 2026-11-05 | **Migration**: 001–019

---

## 一、資料表總覽

| Migration | 表數 | 說明 | 狀態 |
|-----------|------|------|------|
| 001 | 3 | ERP 原始單據（PO/SO） | ✅ |
| 002 | 8 | **財務核心（mgm_finance_summary 為中心）** | ✅ |
| 003 | 8 | ERP 主檔 + 日結 | ✅ |
| 004 | 6 | 系統設定 + 使用者 + KPI 定義 | ✅ |
| 005 | 3 | ERP 交易明細 + 生產 + 轉運價 | ✅ |
| 006 | 5 | 稅務申報（VAT/CIT/IIT） | ✅ |
| 007 | 4 | 稅務調整 + 薪資 | ✅ |
| 008 | 1 | VAT 季報（增量） | ✅ |
| 009 | 2 | IIT 獎金（增量） | ✅ |
| 010 | 1 | CIT 營收成本 Override | ✅ |
| 011 | 4 | ERP 製造四表（MO/Routing/工時） | ✅ |
| 012 | 1 | 使用者 admin 字串改 Yes/No | ✅ |
| 013 | 1 | **同業標竿 industry_benchmark** | ✅ |
| 014 | 1 | **LLM provider is_default** | ✅ |
| 015 | 1 | **AI 知識庫 ermm_knowledge** | ✅ |
| 016 | + | AI 知識庫擴充 | ✅ |
| 017 | 1 | **每日 AI 摘要 daily_ai_summary** | ✅ |
| 018 | + | AI 知識庫再次擴充（41 條） | ✅ |
| 019 | 1 | **RAG 未命中日誌 ermm_kb_miss_log** | ✅ |
| **合計** | **~55 張** | | |

---

## 二、核心實體關係圖（ER Diagram）

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              ERMM_db 核心關係圖                                       │
│                                                                                     │
│                            ┌──────────────┐                                         │
│                            │   branch_     │                                        │
│                            │  detail       │                                        │
│                            │  公司別(HM/SZ/HN)│                                     │
│                            └──────┬───────┘                                         │
│                                   │ 1:N (bu_no)                                      │
│                                   ▼                                                  │
│ ┌────────────┐    ┌─────────────────────────────────────────────────────────┐       │
│ │ cams_xuser  │───▶│               mgm_finance_summary                      │       │
│ │ 使用者管理   │    │  ──────────────────────────────────────                │       │
│ └────────────┘    │  ⭐ 中心表 · 月度財務彙總                              │       │
│                    │  bu_no · YYYY_MM · sale_amt · cost_amt                  │       │
│ ┌────────────┐    │  AR_amt · AP_amt · ttl_asset_amt · debet_amt            │       │
│ │ mgm_kpi_    │    │  captial_stock · retained_amt · Z_score · ROE          │       │
│ │ desc KPI定義 │    │  風險評估 → routes/risk.js 直接讀                         │       │
│ └────────────┘    └────────────────┬────────────────────────────────────────┘       │
│                                    │                                                 │
│                    ┌───────────────┼───────────────────┐                            │
│                    ▼               ▼                   ▼                            │
│          ┌─────────────────┐ ┌──────────────────┐ ┌──────────────────┐               │
│          │mgm_invoice_     │ │mgm_casher_        │ │mgm_bank_loan_    │               │
│          │details 發票明細  │ │details 現金日記    │ │details 銀行貸款   │               │
│          │TX_type=AR → AR  │ │ 現金/銀行/票據流   │ │ 本金/利息/到期日  │               │
│          │TX_type=AP → AP  │ │                   │ │                  │               │
│          └────────┬────────┘ └──────────────────┘ └──────────────────┘               │
│                   │                                                                   │
│          ┌────────┴──────────────────┐                                               │
│          ▼                           ▼                                                │
│   ┌───────────────┐          ┌──────────────┐                                         │
│   │ermm_arap_     │          │forecast_     │                                         │
│   │detail AR/AP   │          │detail 預測    │                                         │
│   │月彙總表       │          │sales/cost    │                                         │
│   └───────────────┘          │/profit 逐月  │                                         │
│                               └──────────────┘                                         │
│                                                                                       │
│ ════════════════════════ 智能化新增表 ════════════════════════                          │
│                                                                                       │
│   ┌────────────────────┐  ┌────────────────────┐  ┌─────────────────────────┐       │
│   │  ermm_knowledge     │  │ daily_ai_summary    │  │ ermm_kb_miss_log         │       │
│   │  AI 問答知識庫      │  │ 每日 AI 執行摘要    │  │ RAG 未命中查詢日誌        │       │
│   │  41 條 / 6 分類     │  │ 自動/手動觸發 LLM   │  │ 用於知識庫擴充            │       │
│   │  FULLTEXT 索引     │  │ Prompt → DeepSeek   │  │                         │       │
│   └────────────────────┘  └────────────────────┘  └─────────────────────────┘       │
│                                                                                       │
│   ┌────────────────────┐                                                             │
│   │  industry_benchmark │                                                             │
│   │  同業標竿           │                                                             │
│   │  KPI × 年度 × 產業  │                                                             │
│   └────────────────────┘                                                             │
│                                                                                       │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 三、模組 × 資料表 對照表

### 模組 1：財務核心（Read by 幾乎所有頁面）

| API 路由 | 讀取的資料表 | 寫入的資料表 | 說明 |
|----------|------------|------------|------|
| `/api/summary/*` | `mgm_finance_summary` | — | Dashboard 核心 |
| `/api/report/*` | `mgm_finance_summary`, `forecast_detail` | — | 三大報表計算 |
| `/api/risk/*` | `mgm_finance_summary` | — | Altman Z-score / 多維風險 |
| `/api/forecast/*` | `forecast_detail`, `mgm_finance_summary` | `forecast_detail` | 趨勢預測 |
| `/api/cash-forecast/*` | `mgm_casher_details`, `mgm_finance_summary` | — | 現金水位 + 蒙特卡洛 |
| `/api/consolidation/*` | `mgm_finance_summary` | — | 集團合併報表 |
| `/api/bep/*` | `mgm_finance_summary` | — | 損益平衡點計算 |

**⭐ 核心表 `mgm_finance_summary` 欄位速覽**

```
主鍵: uid
關鍵欄位: bu_no, YYYY_MM, flag
資產類: cash_amt, deposite_amt, AR_amt, AR_bill_amt, stock_P_amt, stock_M_amt,
        ttl_asset_amt, current_asset_amt, non_current_asset_amt
負債類: AP_amt, loan_amt, LT_loan_amt, debet_amt, LQ_debet_amt
權益類: captial_stock, captial_reserve, accumulated_amt, retained_amt
損益類: sale_amt, sale_cost_amt, sale_exp_amt, sale_profit_amt, net_profit_amt
風險類: Z_score (Altman 5 公式), working_capital, AR_turn, debt_ratio
其他:   全部折舊/攤銷/估價備抵項目...
```

---

### 模組 2：ERP 原始單據

| 資料表 | 說明 | Migration |
|--------|------|-----------|
| `ermm_temp_po` | PO 暫存（草稿） | 001 |
| `ermm_erp_po` | PO 正式採購單 | 001 |
| `ermm_erp_so` | SO 銷售訂單 | 001 |
| `ermm_erp_so_dn` | SO 交貨單 | 003 |
| `ermm_erp_documents` | ERP 文件索引 | 003 |
| `bh_mgm_tx_detail` | ERP 交易明細（發票/收付款） | 005 |
| `mgm_production_details` | ERP 生產明細 | 005 |
| `ermm_erp_mo` | 製造工單 | 011 |
| `ermm_erp_mo_component` | 工單 BOM 組件 | 011 |
| `ermm_erp_routing` | 製程途程 | 011 |
| `ermm_erp_work_report` | 工時回報 | 011 |

---

### 模組 3：日常作業

| 資料表 | 說明 | Migration | API |
|--------|------|-----------|-----|
| `mgm_invoice_details` | **發票明細**（AR/AP 分 TX_type） | 002 | `/api/invoice/*` |
| `mgm_casher_details` | **現金日記**（現金/銀行/票據） | 002 | `/api/cash/*` |
| `ermm_arap_detail` | AR/AP 月彙總表 | 002 | `/api/arap/*` |
| `pay_detail` | 付款明細 | 002 | `/api/pay/*` |
| `check_detail` | 票據管理（支票/匯票） | 002 | `/api/check/*` |
| `mgm_bank_loan_details` | 銀行貸款 | 002 | `/api/bank/*` |
| `forecast_detail` | **預測明細**（逐月銷售/成本） | 002 | `/api/forecast/*` |
| `mgm_account_details` | 帳戶明細 | 003 | `/api/account/*` |
| `transit_price` | 轉運價/移轉計價 | 005 | 內部使用 |

---

### 模組 4：系統與設定

| 資料表 | 說明 | Migration |
|--------|------|-----------|
| `cams_system_codes` | **系統字典**（公司別/幣別/KPI 代碼） | 003 |
| `branch_detail` | 公司別/分公司 | 004 |
| `cams_batch_control` | **批次控制**（步驟狀態追蹤） | 004 |
| `cams_xuser` | 使用者帳號（JWT 驗證用） | 004 |
| `leader_user` | 主管層級 | 004 |
| `login_user_record` | 登入記錄 | 004 |
| `mgm_kpi_desc` | **KPI 定義**（用於 diagnosis 模組） | 004 |
| `e2_xitems_daily_status` | 存貨日結狀態 | 003 |
| `e2_xitems_daily_status_chart` | 存貨狀態圖表 | 003 |
| `monthly_items` | 月度項目管理 | 003 |
| `relation_detail` | 往來對象（客戶/供應商） | 003 |

---

### 模組 5：稅務

| 資料表 | 說明 | Migration |
|--------|------|-----------|
| `vat_declarations` | **VAT 增值稅申報** | 006 |
| `cit_annual_settlements` | **CIT 企業所得稅年結** | 006 |
| `iit_withholding_batches` | **IIT 工資稅批次** | 006 |
| `iit_withholding_details` | IIT 工資稅明細 | 006 |
| `tax_submit_receipts` | 稅務遞交通知收據 | 006 |
| `tax_vat_adjustments` | VAT 調整 | 007 |
| `tax_cit_inputs` | CIT 輸入資料 | 007 |
| `tax_cit_adjustments` | CIT 調整 | 007 |
| `payroll_details` | 薪資明細 | 007 |
| `bonus_details` | 年終獎金稅 | 009 |

---

### 模組 6：智能化新增（Top 5）

#### 📚 AI 知識庫（RAG 數據源）
```
ermm_knowledge
├── 41 條知識 / 6 分類
├── category: annual(10) / policy(18) / tax(6) / benchmark(3) / data_dict(4)
├── bu_no: HM / SZ / HN / ALL
├── FULLTEXT INDEX (title + content + tags)
└── importance 權重 1-5

ermm_kb_miss_log
└── 每次 RAG 未命中 → 自動寫入 → 用於知識庫擴充
```

#### 🤖 每日 AI 摘要
```
daily_ai_summary
├── summary_date: 覆蓋的財務期間
├── data_json: 聚合的財務快照相關結構化資料
├── title: LLM 生成的標題
├── content: LLM 自然語言摘要正文
├── alerts_json: LLM 標記的異常條目
├── actions_json: LLM 建議的行動項
├── provider / model / duration_ms: LLM 元數據
└── is_active: 軟刪除
```

#### 🎯 同業標竿
```
industry_benchmark
├── bu_no × kpi_id × year
├── benchmark_value: 同業中位數
├── bu_value: 本公司實際值
├── gap_pct: 差距百分比
└── source: 資料來源
```

---

## 四、模組 2 模組 數據流依賴圖

```
                        ┌──────────────────────┐
                        │  批次管線 runAll()    │
                        │  Step1 → Step7       │
                        └──────────┬───────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
        ┌────────────────┐ ┌─────────────┐ ┌───────────────────┐
        │ mgm_finance_    │ │ mgm_invoice_ │ │ mgm_casher_        │
        │ summary  ⭐ 中心 │ │ details  AR/AP│ │ details  現金流     │
        └───────┬────────┘ └──────┬──────┘ └────────┬────────────┘
                │                  │                 │
    ┌───────────┼──────────┐       │                 │
    ▼           ▼          ▼       ▼                 ▼
  report      risk      forecast  ar-smart/         data-quality
  三大報表   風險預警   趨勢預測  arap             質量掃描
                              AR催收             全表健康度
    │           │          │       │                 │
    └───────────┴──────────┴───────┴─────────────────┘
                                    │
                                    ▼
                           ┌──────────────────────┐
                           │   AI 智能層（LLM）    │
                           │                      │
                           │  diagnosis/kpi       │ ← 讀 mgm_finance_summary
                           │  aiqa/ask (RAG)      │ ← 讀 ermm_knowledge
                           │  daily-summary       │ ← 讀 summary + forecast
                           │  ar-smart (評分)     │ ← 讀 mgm_invoice_details
                           └──────────────────────┘
```

---

## 五、外鍵 / 關聯規則

| 父表 | 子表 | 關聯欄位 | 說明 |
|------|------|---------|------|
| `branch_detail` | `mgm_finance_summary` | `bu_no` | 公司別 (HM/SZ/HN) |
| `cams_xuser` | `login_user_record` | `user_id` | 使用者登入記錄 |
| `mgm_kpi_desc` | `routes/diagnosis.js` | `kpi_id` | 異常診斷 KPI 定義 |
| `mgm_finance_summary` | `forecast_detail` | `bu_no, YYYY_MM` | 預測 vs 實際 |
| `mgm_finance_summary` | `mgm_invoice_details` | `bu_no` | 應收賬款 vs 發票 AR |
| `mgm_finance_summary` | `mgm_casher_details` | `bu_no` | 現金 vs 銀行存款 |
| `mgm_kpi_desc` | `industry_benchmark` | `kpi_id` | 同業標竿 KPI 對應 |
| `ermm_knowledge` | `ermm_kb_miss_log` | `category, bu_no` | RAG 未命中 → 知識庫擴充 |

---

## 六、索引策略

| 表 | 索引 | 目的 |
|----|------|------|
| `mgm_finance_summary` | `(bu_no, YYYY_MM)` | Dashboard / 報表 查詢主力 |
| `mgm_invoice_details` | `(bu_no, TX_type, ageing_days)` | AR 催收排序 / 風險評分 |
| `mgm_casher_details` | `(bu_no, YYYY_MM)` | 現金水位查詢 |
| `forecast_detail` | `(bu_no, metric, forecast_month)` | 預測 vs 實際 |
| `ermm_knowledge` | `FULLTEXT(title, content, tags)` | RAG 全文檢索 |
| `ermm_knowledge` | `(category), (bu_no), (year)` | 分類過濾 |
| `daily_ai_summary` | `(summary_date), (generated_time)` | Dashboard 取最新 |

---

## 七、遷移執行順序

```sql
-- run_all.sql 統一建置
SOURCE 001_po_so_tables.sql;              -- 3 表
SOURCE 002_finance_core_tables.sql;       -- 8 表 ⭐
SOURCE 003_erp_master_tables.sql;         -- 8 表
SOURCE 004_system_tables.sql;             -- 6 表
SOURCE 005_erp_detail_tables.sql;         -- 3 表
SOURCE 006_tax_tables.sql;                -- 5 表
SOURCE 007_tax_inputs.sql;                -- 4 表
SOURCE 008_vat_quarterly.sql;             -- 增量
SOURCE 009_iit_bonus.sql;                 -- 增量
SOURCE 010_cit_revenue_cost_override.sql;  -- 增量
SOURCE 011_erp_manufacturing_tables.sql;  -- 4 表
SOURCE 012_admin_yes_no.sql;              -- 結構調整
SOURCE 013_industry_benchmark.sql;        -- 1 表
SOURCE 014_llm_is_default.sql;            -- 結構調整
SOURCE 015_ermm_knowledge.sql;             -- 1 表
SOURCE 016_ermm_knowledge_expand.sql;      -- 數據擴充
SOURCE 017_daily_ai_summary.sql;          -- 1 表
SOURCE 018_ermm_knowledge_expand_2.sql;    -- 數據擴充
SOURCE 019_kb_miss_log.sql;               -- 1 表
```

**單次執行時間**: 約 30 秒（全部幂等，CREATE TABLE IF NOT EXISTS）

---

*文件產生時間：2026-11-05 | 基於 19 個 Migration + 55+ 張資料表 + 85 個 Commit*
