# ERMM 工作日報模組 P2–P5 功能需求

> 對照《產品 Roadmap：從績效對標到 ERP 整合的四階段演進》盤點產出
> 盤點日期：2026-09-30
> 適用版本：ERMM-finance-system（Express 5 + mysql2 + 原生 JS SPA + Chart.js，埠 3008）

---

## 一、現況盤點

### 1.1 已上線功能（P0–P2 主線）

| 階段 | 功能 | 狀態 | 主要資產 |
|---|---|---|---|
| P0 | 月度簽核鎖定（逐人/一鍵）、解鎖留痕 | ✅ | `daily_report_lock`、`POST /lock`、`/unlock` |
| P0 | 修改審計日誌（CREATE/UPDATE/DELETE/LOCK/UNLOCK 同交易） | ✅ | `daily_report_audit_log`、`GET /audit-logs` |
| P0 | 鎖定後禁改禁刪（HTTP 423） | ✅ | routes/dailyReport.js 攔截點 |
| P1 | 提交及時率看板（應交/實交/遲交/缺交，及時率顏色分級） | ✅ | `GET /timeliness` |
| P1 | 月度績效彙總（工時/延誤/未解/工作占比 + 目標達成率） | ✅ | `GET /monthly-summary` |
| P1 | 目標設定（目標工時/延誤上限/未解上限/工作占比下限） | ✅ | `daily_report_target`、`GET/POST /targets` |
| P2 | 人效儀表盤（人均產值/工時、部門對比、6 月趨勢、ERP 交叉驗證） | ✅ | `GET /efficiency-dashboard`、`daily_report_erp_xref` |
| P2 | 月度經營+人效報告（自動生成、SMTP 郵件推送、送達回執） | ✅ | `GET /monthly-business-report`、`POST /push`、`daily_report_mgmt_report`、`utils/mailer.js` |
| 基礎 | 站內預警中心（財務 KPI 規則預警、通知已讀） | ✅ | `alert_rule`、`alert_log`、`routes/alert.js` |

### 1.2 Roadmap 差距矩陣

| Roadmap 項目 | 現況 | 差距說明 |
|---|---|---|
| **P2 年度績效自動生成** | ❌ 未做 | 僅有月度彙總，無年度聚合、年度等第、年度報告匯出 |
| **P2 部門橫向對比** | ⚠️ 部分 | 人效儀表盤僅有「工時」維度部門表，缺績效維度排名/雷達圖 |
| **P2 績效分佈圖** | ❌ 未做 | 無 S/A/B/C 等第分佈、直方圖、箱線圖 |
| **P2 OKR 連結** | ❌ 未做 | `daily_report_target` 僅工時閾值，無目標-關鍵結果關聯 |
| **P3 預測下月工時與延誤趨勢** | ❌ 未做 | `routes/forecast.js` 是財務三表預測（Sales/Cost/Cash Flow），與工時無關 |
| **P3 異常檢測自動告警** | ⚠️ 基礎具備 | `alert_rule/alert_log` 為財務 KPI 設計，無日報域規則（連續未交、工時異常等）與排程觸發 |
| **P4 員工手機補卡** | ❌ 未做 | 僅一處 `@media(max-width:768px)` 基礎樣式，無移動端操作頁 |
| **P4 主管手機審核** | ❌ 未做 | 簽核鎖定僅桌面 UI |
| **P4 即時推送通知** | ⚠️ 部分 | 已有 SMTP 郵件（非即時）+ 站內 alert_log；無 Line/企微/瀏覽器 Push |
| **P5 工時同步 ERP 成本模組** | ❌ 未做 | `daily_report_erp_xref` 僅單向統計比對，不回寫 ERP |
| **P5 與加班/請假系統連動** | ❌ 未做 | 系統無加班單、請假單、考勤資料表 |

### 1.3 實施優先序建議

```
P2 補齊（年度績效/分佈圖/OKR）  ← 銜接現有 P1/P2，成本最低、管理價值立即顯現
        ↓
P3 預測分析                     ← 依賴 2025 全年日報資料（已具備）
        ↓
P4 手機端 + 即時推送            ← 依賴 P3 告警；補卡/審核是高頻行動場景
        ↓
P5 ERP 整合                     ← 依賴外部 ERP 成本模組與考勤系統介面，需跨系統協作
```

---

## 二、P2 補齊：績效對標

### P2-3 年度績效自動生成

**需求背景**
主管年終考核需逐月翻閱月度彙總，缺乏年度視角的自動結算與等第評定。

**功能範圍**
1. 年度績效結算：以 1–12 月 `daily_report_target` 達成率、及時率、平均工作占比為輸入，自動計算年度綜合得分。
2. 計分模型（權重可於系統代碼常量配置，後續可做規則表）：
   - 工時達成率 40%（12 個月平均）
   - 提交及時率 30%
   - 工作占比達標率 20%（達標月數/應交月數）
   - 延誤/未解扣分 10%（超出上限月數扣分）
3. 年度等第自動評定：S ≥ 95、A 85–94、B 70–84、C < 70（分數線可配置）。
4. 年度報告一頁式展示 + 匯出 Excel（沿用 ExcelJS 既有模式）。
5. 年度報告歸檔（與月度報告同一歸檔表複用或新增年度表）。

**資料表**

```sql
-- 年度績效結算（同人同年唯一，UPSERT）
CREATE TABLE daily_report_annual_review (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  bu_no VARCHAR(20) NOT NULL,
  yyyy CHAR(4) NOT NULL,
  user_id VARCHAR(50) NOT NULL,
  user_name VARCHAR(100) DEFAULT NULL,
  depart_id VARCHAR(50) DEFAULT NULL,
  score_hours DECIMAL(5,2) DEFAULT 0 COMMENT '工時達成得分',
  score_timeliness DECIMAL(5,2) DEFAULT 0,
  score_workratio DECIMAL(5,2) DEFAULT 0,
  score_penalty DECIMAL(5,2) DEFAULT 0,
  total_score DECIMAL(5,2) DEFAULT 0,
  grade CHAR(1) DEFAULT 'C' COMMENT 'S/A/B/C',
  months_submitted INT DEFAULT 0,
  months_locked INT DEFAULT 0,
  review_data JSON COMMENT '12個月明細快取',
  generated_by VARCHAR(50) DEFAULT NULL,
  generated_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_bu_user_year (bu_no, user_id, yyyy),
  INDEX idx_bu_year_grade (bu_no, yyyy, grade)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='年度績效自動結算';
```

**API**

| 方法 | 路徑 | 權限 | 說明 |
|---|---|---|---|
| GET | `/api/daily-report/annual-review?bu_no=&yyyy=` | isManager | 年度績效清單（分數/等第/12 月摘要） |
| POST | `/api/daily-report/annual-review/generate` | isSenior | 一鍵結算全年（批次 UPSERT） |
| GET | `/api/daily-report/annual-review/:id` | isManager | 單人年度詳情（逐月雷達/折線） |
| GET | `/api/daily-report/export/annual-review.xlsx` | isManager | Excel 匯出 |

**前端**
- 日報列表工具列新增「🏆 年度績效」按鈕（經理可見，沿用 `_mgr` 模式）。
- 年份選擇（沿用 `yearOptions()` 2001–2027）→ 查詢 → 等第顏色徽章（S 金/A 綠/B 橙/C 紅）+ 分數排序。
- 單人詳情：12 月達成率折線 + 四維雷達圖（Chart.js radar）。

**驗收標準**
- 一鍵結算後，U0001/U0002/U0003 三人 2025 年度均產出等第，分數與月度彙總口徑一致。
- 重複結算為 UPSERT，不產生重複列。
- 匯出 Excel 欄位與畫面一致，等第正確。

---

### P2-4 績效分佈圖

**需求背景**
管理層需要掌握整體績效結構（多少人 S/A/B/C）、部門間分佈差異，作為調薪/獎金包分配依據。

**功能範圍**
1. 全公司等第分佈甜甜圈圖（S/A/B/C 人數與占比）。
2. 分數直方圖（0–100，每 10 分一桶）。
3. 部門 × 等第堆疊長條圖（識別高分/低分部門）。
4. 點擊圖中任一區塊下鑽到人員清單（沿用柱圖 cursor pointer 慣例）。

**資料表**：無新增，資料來源為 `daily_report_annual_review`。

**API**：在年度績效清單回應中加 `distribution` 區塊（gradeCounts / histogram / deptGradeMatrix），避免多一次請求。

**驗收標準**
- 三張圖與清單人數加總一致；無資料年度顯示空狀態提示。

---

### P2-5 OKR 連結

**需求背景**
現有目標設定只有工時閾值（管控視角），缺少「目標 + 關鍵結果」的承諾視角，無法回答「這月做的關鍵結果是什麼、完成多少」。

**功能範圍**
1. 目標設定頁新增「🎯 OKR」模式：每位員工每月 1 個 Objective + 1–5 條 Key Result。
2. KR 欄位：內容、起始值/目標值/完成值、單位、權重；自動計算完成率 0–120%。
3. 月度績效彙總頁展示 OKR 完成率，主管鎖定時一併檢視。
4. 年度績效將 OKR 平均完成率作為加分項（上限 +5 分，分數線仍可配置）。

**資料表**

```sql
CREATE TABLE daily_report_okr (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  bu_no VARCHAR(20) NOT NULL,
  user_id VARCHAR(50) NOT NULL,
  YYYY_MM CHAR(7) NOT NULL,
  objective VARCHAR(300) NOT NULL COMMENT 'O：本月目標',
  status VARCHAR(10) DEFAULT 'ACTIVE' COMMENT 'ACTIVE/CLOSED',
  set_by VARCHAR(50) DEFAULT NULL,
  set_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_bu_user_ym (bu_no, user_id, YYYY_MM)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='月度OKR目標';

CREATE TABLE daily_report_okr_kr (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  okr_id BIGINT NOT NULL,
  content VARCHAR(300) NOT NULL COMMENT '關鍵結果描述',
  start_val DECIMAL(18,2) DEFAULT 0,
  target_val DECIMAL(18,2) NOT NULL,
  actual_val DECIMAL(18,2) DEFAULT 0,
  unit VARCHAR(20) DEFAULT NULL,
  weight INT DEFAULT 100 COMMENT '權重(同O下加總100)',
  INDEX idx_okr (okr_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='OKR關鍵結果';
```

**API**：`GET/POST /okrs`（月度，支援整批 O+KR 提交 UPSERT）；月度彙總回應附 `okr_progress`。

**驗收標準**
- 可在目標設定頁切換「閾值模式 / OKR 模式」；儲存後重開資料正確回填。
- KR 完成率 = (actual−start)/(target−start)，截斷在 0–120%。

---

### P2-6 部門橫向對比增強

**功能範圍**
- 人效儀表盤部門區新增：人均產值、人均薪資、人事費用率（薪資/產值）、及時率四個指標。
- 新增部門雷達圖（工時、產值、及時率、OKR 完成率、工作占比，標準化 0–100）。
- 部門排名表可按任一指標點擊排序。

---

## 三、P3：預測分析

### P3-1 下月工時與延誤趨勢預測

**需求背景**
主管需提前識別「下個月哪些人/部門工時可能超載、延誤可能升高」，在月度鎖定會議前干預。

**功能範圍**
1. 以近 6 個月日報為訓練窗口，提供兩種演算法（後端切換）：
   - 基線版（先交付）：加權移動平均（近期月份權重高）+ 線性迴歸外推，SQL/JS 即可實作，無 ML 依賴。
   - 進階版（選配）：季節性調整（區分淡旺季月份）。
2. 預測對象：人均月工時、部門總工時、延誤筆數、未解筆數。
3. 輸出：預測值 + 80% 信賴區間（以歷史殘差標準差估算）+ 風險標記（預測值超標者標紅）。
4. 視覺化：歷史實際線（綠）+ 預測線（紫，沿用系統預測色 #9b59b6）+ 置信帶（rgba 0.1）。
5. 預測結果可附在月度經營報告郵件中（加一段「下月預警」區塊）。

**資料表**

```sql
CREATE TABLE daily_report_forecast_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  bu_no VARCHAR(20) NOT NULL,
  target_ym CHAR(7) NOT NULL COMMENT '被預測月份',
  scope_type VARCHAR(10) NOT NULL COMMENT 'USER/DEPT',
  scope_id VARCHAR(50) NOT NULL COMMENT 'user_id 或 depart_id',
  metric VARCHAR(20) NOT NULL COMMENT 'HOURS/DELAYS/UNRESOLVED',
  forecast_val DECIMAL(12,2) NOT NULL,
  lower_bound DECIMAL(12,2) DEFAULT NULL,
  upper_bound DECIMAL(12,2) DEFAULT NULL,
  risk_level VARCHAR(10) DEFAULT 'NORMAL' COMMENT 'NORMAL/WARN/DANGER',
  algo VARCHAR(20) DEFAULT 'WMA_LR',
  generated_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_target_scope_metric (bu_no, target_ym, scope_type, scope_id, metric)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='工時延誤預測結果';
```

**API**：`GET /efficiency-forecast?bu_no=&target_YYYY_MM=`（即時計算並快取）；`POST /efficiency-forecast/run`（高層手動重算）。

**驗收標準**
- 以 2025/03–08 預測 2025/09，預測值與實際值誤差 MAPE ≤ 25%（測試資料平滑，合理可達）。
- 信賴區間寬度隨樣本不足自動變寬；未滿 3 個月歷史者回傳 `insufficient_data`。

---

### P3-2 異常檢測自動告警

**需求背景**
異常（連續未交日報、工時暴增/驟降、延誤累積）目前靠主管人工發現，滯後且遺漏。

**功能範圍**
1. 複用並擴充現有 `alert_rule`（新增 `alert_domain='DAILY_REPORT'`、規則類型），內建規則：

| 規則 | 預設閾值 | 級別 |
|---|---|---|
| 連續未交日報 | ≥ 3 個工作日 | warning → ≥5 danger |
| 單日工時異常 | > 14h 或 < 2h | warning |
| 月度工時偏離 | 偏離個人 6 月均值 ±30% | warning |
| 延誤筆數超限 | > target.max_delays | danger |
| 月底未鎖定提醒 | 每月最後一天 16:00 未鎖定 | warning |

2. 排程引擎：新增 `scheduler/` 模組（node-cron 或 setInterval 兜底，服務啟動自載），每日 09:30 / 16:30 掃描。
3. 告警落地 `alert_log`（沿用現有表與通知中心 UI），冷卻時間沿用 `cooldown_hours` 防騷擾。
4. 通知通道：站內通知（現有）+ 電子郵件（複用 `utils/mailer.js`），後續 P4 接即時通道。
5. 規則管理 UI：規則清單可停用/改閾值（沿用系統代碼管理 CRUD 模式）。

**API**：`GET /alert/daily-rules`、`PUT /alert/daily-rules/:uid`、`POST /alert/daily-scan/run`（手動觸發測試）。

**驗收標準**
- 人造「U0001 連續 4 天無日報」資料，手動掃描後 alert_log 產出 warning 記錄且通知中心可見。
- 同日重複掃描受冷卻約束不重複發信。

---

## 四、P4：手機端

### P4-0 響應式移動框架（前置）

**需求背景**
現有桌面表格在 375px 寬度不可用；補卡/審核是典型手機場景。

**功能範圍**
1. 全站 CSS 響應式改造（表格於 <768px 轉卡片式、工具列換行、選單折疊為底部 Tab 或漢堡選單）。
2. 日報表單移動優化：時間半點 `<select>`（現有）加大觸控區、項目明細可摺疊。
3. 不自引入框架，沿用原生 JS；以 CSS + 容器 class 切換實作。

**驗收標準**：Chrome DevTools 375×667（iPhone SE）下，日報查詢/新增/儲存全流程可用，無橫向溢出。

---

### P4-1 員工手機補卡

**需求背景**
員工忘記當天填報，過後只能找主管事後處理；需自助補卡並受規則約束。

**功能範圍**
1. 手機端「＋補卡」入口：選擇日期 → 填寫與一般日報相同表單 → 提交為**補卡申請**。
2. 補卡規則：
   - 預設僅允許補最近 7 個日曆日（天數可配置）。
   - 該月已簽核鎖定者禁止補卡（回 423，沿用鎖定邏輯）。
   - 補卡須主管審核通過才寫入 `daily_report`。
3. 補卡申請獨立表與審核狀態機：PENDING → APPROVED / REJECTED。

**資料表**

```sql
CREATE TABLE daily_report_makeup (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  bu_no VARCHAR(20) NOT NULL,
  user_id VARCHAR(50) NOT NULL,
  report_date DATE NOT NULL,
  YYYY_MM CHAR(7) NOT NULL,
  payload JSON NOT NULL COMMENT '日報主表+明細完整內容',
  reason VARCHAR(300) NOT NULL COMMENT '補卡原因',
  status VARCHAR(10) DEFAULT 'PENDING' COMMENT 'PENDING/APPROVED/REJECTED',
  reviewer_id VARCHAR(50) DEFAULT NULL,
  review_time DATETIME DEFAULT NULL,
  review_comment VARCHAR(300) DEFAULT NULL,
  created_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_bu_user_date (bu_no, user_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='手機補卡申請';
```

**API**：`POST /makeups`（員工提交）、`GET /makeups`（本人看自己/主管看全部）、`POST /makeups/:id/approve|reject`（主管）。
審核通過時於**同一交易**寫入 daily_report + audit_log（action=MAKEUP_APPROVE）。

**驗收標準**
- 員工補卡後列表出現待審；主管核准後當天日報可查，駁回則不寫入並通知申請人。
- 鎖定月補卡回 423；超過補卡天數回 400。

---

### P4-2 主管手機審核

**功能範圍**
1. 移動端「待辦」頁簽：待審補卡、待鎖定月份、未解異常告警，數字角標。
2. 補卡審核卡片：左右滑或按鈕核准/駁回（駁回必填原因，沿用解鎖留痕原則）。
3. 手機一鍵鎖定當月（復用 `/lock`，僅切換 UI）。

**驗收標準**：375px 寬度下 3 步內完成補卡核准。

---

### P4-3 即時推送通知

**需求背景**
郵件不即時；審核、告警需要分鐘級送達。

**功能範圍（按成本由低到高，建議分期）**
1. **站內通知角標輪詢**：複用 `GET /api/alert/logs/unread-count`，前端 60s 輪詢（零成本，先做）。
2. **瀏覽器 Web Push**：Service Worker + VAPID，員工在公司電腦/手機瀏覽器授權後接收。
3. **企業通道 Webhook**：Line Notify / 企業微信機器人 / 飞书（依公司使用選擇一個），於 `utils/` 新增 notifier，介面與 mailer 對齊（`sendXxx(payload) → {success, message}`）。
4. 通道表：`daily_report_mgmt_report` 模式擴充為通用 `notification_log`（channel/recipient/delivered/error_msg），告警與審核結果共用。

**驗收標準**
- 主管核准補卡後，申請人於 1 分鐘內收到所選通道通知，notification_log 有送達回執。

---

## 五、P5：ERP 整合

### P5-1 工時同步 ERP 成本模組

**需求背景**
ERP 成本結算需要實際工時投入；目前 `daily_report_erp_xref` 只做筆數交叉驗證，不回寫。

**功能範圍**
1. 雙向同步（日報 → ERP 成本）：
   - 匯出/推送工時分錄：依 xref 映射將部門/專案工時彙總為成本模組可接收格式（API 或 CSV 交換檔，待確認 ERP 端介面）。
   - 同步時點：每月簽核鎖定後自動觸發（鎖定狀態是資料正確性閘門）。
2. 同步狀態追蹤：每批同步記錄 sync_batch（月份、筆數、狀態、ERP 回傳單號、錯誤訊息、重試次數）。
3. 反向核對：ERP 回傳成本歸集結果後，比對差異並於交叉驗證頁顯示「工時已結轉成本」狀態。

**資料表**

```sql
CREATE TABLE daily_report_cost_sync (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  bu_no VARCHAR(20) NOT NULL,
  YYYY_MM CHAR(7) NOT NULL,
  depart_id VARCHAR(50) DEFAULT NULL,
  total_hours DECIMAL(10,2) NOT NULL,
  erp_doc_no VARCHAR(60) DEFAULT NULL COMMENT 'ERP 成本單號',
  status VARCHAR(15) DEFAULT 'PENDING' COMMENT 'PENDING/SYNCED/FAILED',
  error_msg VARCHAR(500) DEFAULT NULL,
  retry_cnt INT DEFAULT 0,
  synced_by VARCHAR(50) DEFAULT NULL,
  synced_time DATETIME DEFAULT NULL,
  created_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_bu_ym_dept (bu_no, YYYY_MM, depart_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='工時同步ERP成本批次';
```

**驗收標準**
- 鎖定後觸發同步，ERP 測試端收到正確部門工時；失敗可重試且不重複入帳（以唯一鍵+ERP 單號冪等）。

**外部依賴**：需 ERP 團隊提供成本模組 API 規格或 CSV 交換規範。

---

### P5-2 與加班/請假系統連動

**需求背景**
日報工時需與考勤口徑對齊：請假日不應計缺交、加班工時應與加班單勾稽。

**功能範圍**
1. 請假/加班資料來源（二擇一，視 IT 條件）：
   - A. 對接 HR/考勤系統 API（建議）：每日排程拉取當月請假、加班記錄。
   - B. 系統內建輕量申請單：員工手機提交加班/請假，主管審核（P4 補卡同模式）。
2. 資料表（方案 B 或介接快取皆需要）：

```sql
CREATE TABLE hr_attendance_event (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  bu_no VARCHAR(20) NOT NULL,
  user_id VARCHAR(50) NOT NULL,
  event_date DATE NOT NULL,
  event_type VARCHAR(10) NOT NULL COMMENT 'LEAVE/OVERTIME',
  leave_type VARCHAR(20) DEFAULT NULL COMMENT '事假/病假/特休…',
  hours DECIMAL(6,2) DEFAULT 0,
  source VARCHAR(15) DEFAULT 'MANUAL' COMMENT 'MANUAL/HR_API',
  ext_doc_no VARCHAR(60) DEFAULT NULL COMMENT '外部系統單號',
  status VARCHAR(10) DEFAULT 'APPROVED',
  UNIQUE KEY uk_bu_user_date_type (bu_no, user_id, event_date, event_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='加班請假事件';
```

3. 連動規則：
   - 及時率看板：請假日自「應交天數」扣除；當日有請假紀錄者不計缺交。
   - 日報工時校驗：當日工時 + 加班時數合理性檢查（接入 P3-2 異常規則）。
   - 月度報告增「加班時數/請假時數」卡片。

**API**：`GET/POST /attendance`（查詢/手動錄入）、`POST /attendance/sync`（拉取 HR 系統）；及時率與異常檢測 SQL 改為 LEFT JOIN 請假日曆。

**驗收標準**
- U0001 某日掛請假，當日缺交標記消失，月度應交天數正確遞減。
- 加班單 3h 與當天日報工時同時存在時，異常檢測不誤報。

**外部依賴**：方案 A 需 HR 系統 API 帳號與文件。

---

## 六、跨階段共通約束（實作時統一遵守）

1. 表名全小寫（Ubuntu MySQL `lower_case_table_names=0` 相容性）。
2. 月份參數統一 `YYYY/MM`，後端 `parseYM()` 相容 `YYYY-MM`、`YYYYMM`。
3. 所有新增路由於 `app.js` 以 `app.use('/api/xxx', routes)` 註冊；靜態路由宣告在 `/:id` 之前。
4. 權限沿用 `isManager`（部門主管/高階主管）、`isSenior`（高階主管/管理員）二級判定，簡繁歸一化。
5. 前端：全域函式掛在 `DRApp` 下避免命名衝突；使用者輸入一律 `esc()`；按鈕事件用 data-* + addEventListener；i18n 三語 `t()`；Chart 實例進 `this.charts` 並於 `destroyCharts()` 清理。
6. 所有寫入操作（補卡核准、同步、結算）需留審計日誌，與業務同交易送出。
7. 數字顯示保留 2 位小數，走 `UI.fmt()`。
8. 每階段交付：建表脚本（冪等，含舊表 ALTER 補欄位）+ Jest 測試 + 三語文案 + Excel 匯出（管理報表類必備）。
9. 部署固定流程：`node database/xxx.js` → `git pull` → `pm2 restart ermm-finance`，本機埠 3008、DB ermm_db。

---

## 七、建議里程碑

| 里程碑 | 內容 | 依賴 |
|---|---|---|
| M1 | P2-3 年度績效 + P2-4 分佈圖 | 無，現有資料足夠 |
| M2 | P2-5 OKR + P2-6 部門對比增強 | M1 |
| M3 | P3-2 異常告警（先）→ P3-1 預測（後） | M3 告警排程為 M5 通知基礎 |
| M4 | P4-0 移動框架 → P4-1 補卡 → P4-2 手機審核 | 補卡審核表 |
| M5 | P4-3 即時推送（站內輪詢 → Webhook） | P3-2 |
| M6 | P5-2 加班請假連動（先內建後介接） | P4 移動端 |
| M7 | P5-1 ERP 成本同步 | ERP 團隊介面 |
