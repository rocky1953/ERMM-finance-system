# M3 里程碑功能需求：異常檢測自動告警 → 工時延誤趨勢預測

> 對照《ERMM 工作日報模組 P2–P5 功能需求》第三章 P3-1 / P3-2 展開
> 盤點日期：2026-10-01
> 適用版本：ERMM-finance-system（Express 5 + mysql2 + 原生 JS SPA + Chart.js，埠 3008，DB ermm_db）
> 實作順序：**先做 P3-2 異常告警（M3-A），再做 P3-1 趨勢預測（M3-B）**
> 原因：告警掃描需要的人員/部門月度量與 M1/M2 口徑完全相同；先把掃描引擎與通知鏈路做穩，預測面板與郵件整合即可直接複用

---

## 一、里程碑目標與量化價值

| 目標 | 量化基準 |
|---|---|
| 把「連續未交、工時異常、延誤累積」從主管人工發現變成系統每日兩掃 | 09:30 / 16:30 自動執行，無人工介入 |
| 同一異常不重複騷擾（防騷擾） | 同 dedup_key 在冷卻時數內只通知一次；danger 升級不受冷卻攔截 |
| 提前一個月識別工時超載/輕載、延誤升高風險 | 以 2025/03–08 回測 2025/09，HOURS MAPE ≤ 25% |
| 預測附 80% 信賴區間，資料不足誠實標示 | 歷史未滿 3 個月者回傳 `insufficient_data`，不給假精確 |
| 通知渠道本期只做「站內通知 + 電子郵件」 | Line/企微/Web Push 明列為 M5 範圍，本里程碑不做 |

---

## 二、術語與口徑約定（單一真相源）

1. **工作日（workday）**：M3 階段指週一至週五，**不考量節假日**（尚無請假/考勤表，M6 接入 `hr_attendance_event` 後再扣假日）。
2. **活躍人員（active users）**：某 BU 下，近 56 天內在 `daily_report` 有過 `status1='USE'` 日報的人，聯集 `cams_xuser.inuse_flag='USE'` 且有該 BU 日報歷史的帳號。**不**以 `cams_xuser` 全表掃描（該表無 bu_no 欄位，多 BU 會誤判）。
3. **月度量口徑**（與 M1 月度彙總完全一致，複用 SQL 模式）：
   - `total_hours` = SUM(`daily_report_detail.use_time`)
   - `work_hours` = SUM(use_time WHERE wk_type='日常工作')
   - `delay_cnt` = COUNT(DISTINCT CASE WHEN projects1 非空 THEN report_date END)
   - `unresolved_cnt` = COUNT(DISTINCT CASE WHEN projects2 非空 THEN report_date END)
   - `late`（遲交）= DATE(create_time) > report_date
   - 部門欄位 = `daily_report.depart_id`，空值歸「未分類」
4. **應交日**：工作日且非未來日；09:30 掃描當天算應交（上班後仍未交即缺交 1 天）。
5. **目標基準**：`daily_report_target`（target_hours / max_delays / max_unresolved / min_work_ratio）。
6. **月份格式**：API 收 YYYY/MM，沿用 dailyReport.js 的 `parseYM()` 相容 YYYY-MM、YYYYMM；儲存統一 `YYYY/MM`。
7. **級別**：`NORMAL`（正常）/ `WARN`（黃色警告）/ `DANGER`（紅色危險）；既有 `alert_log.level` 存小寫 `warning`/`danger`，M3 寫入時做映射。
8. **BU 清單**：取 `SELECT DISTINCT bu_no FROM daily_report WHERE report_date >= CURDATE() - INTERVAL 90 DAY`，空表時退回 `['HM']`。
9. 常數集中在各 service 頂部（預設掃描時刻、視窗月數、閾值），與 M1/M2 的 `ANNUAL` 常量模式一致。

---

## 三、現有資產盤點（複用，不重造）

| 資產 | 位置 | M3 用法 |
|---|---|---|
| 預警規則表 | `alert_rule`（uid/rule_name/bu_no/kpi_id/cond/threshold/notify_channel/notify_user/cooldown_hours/status） | 加欄位後承載 5 條日報域規則 |
| 通知紀錄表 | `alert_log`（rule_id/bu_no/kpi_id/level/title/message/suggestion/channel/is_read/created_at） | 加欄位後承載去重鍵、對象、送達狀態 |
| 通知中心 UI | [alerts.js](file:///e:/finance/public/js/pages/alerts.js)（列表/已讀/全部已讀，🔴🟡🔵 級別） | 加「日報規則」頁籤 + 網域篩選 |
| 規則 CRUD API | [alert.js](file:///e:/finance/routes/alert.js) `GET/POST/PUT/DELETE /api/alert/rules` | 新增日報域專用查詢/更新端點，不動舊財務規則 |
| 郵件工具 | [mailer.js](file:///e:/finance/utils/mailer.js)（getTransporter 私有，僅匯出 sendMgmtReport） | 新增並匯出 `sendAlertMail()`；月度報告郵件加「下月預警」區塊 |
| 日報路由 | [dailyReport.js](file:///e:/finance/routes/dailyReport.js) | 新增 `/efficiency-forecast` 兩端點；月度報告 push 帶預警區塊 |
| 月度量 SQL 模式 | monthly-summary / efficiency-dashboard 的 perUser 聚合（LEFT JOIN detail 後 DISTINCT 計數） | 掃描引擎與預測歷史查詢直接沿用，避免明細筆數放大 |
| 簽核鎖定表 | `daily_report_lock`（bu_no+user_id+YYYY_MM 唯一，LOCKED/UNLOCKED） | 月底未鎖定規則的判定來源 |
| 審計日誌表 | `daily_report_audit_log`（action VARCHAR(20)、old_data/new_data JSON） | 規則修改留痕，action=`ALERT_RULE_UPD`（18 碼，符合欄位長度） |
| 排程器 | ❌ 不存在，無 node-cron 依賴 | 新增零依賴分鐘級 setInterval 排程器 |

---

## 四、M3-A：異常檢測自動告警（先做）

### 4.1 內建規則清單（5 條，種子可停用/調閾）

| # | 規則名稱 | kpi_id | 對象 | 觸發條件（以 as_of 為準） | 級別 | 預設冷卻 |
|---|---|---|---|---|---|---|
| R1 | 連續未交日報 | `DR_MISSING_DAYS` | USER | 截至掃描時刻，連續應交工作日無 `status1='USE'` 日報；threshold=3 起報 warning，連續 ≥ `config.danger_days`(=5) 升 danger | warning/danger | 12h |
| R2 | 單日工時異常 | `DR_DAILY_HOURS` | USER | 近 2 個工作日中**已交**日報，當日 SUM(use_time) > config.max_hours(14) 或 < config.min_hours(2)；**無日報不適用本規則**（歸 R1） | warning | 24h |
| R3 | 月度工時偏離 | `DR_MONTH_HOURS_DEV` | USER | 當月日期 ≥ config.min_eval_day(10) 才評估；月化工時 = 當月 MTD 總工時 ÷ 已過天數 × 當月天數；與前 6 個完整月個人月均偏離絕對值 ≥ threshold(30%)；超載與驟降在訊息中區分 | warning | 48h |
| R4 | 延誤筆數超限 | `DR_DELAY_OVER` | USER | 當月 MTD `delay_cnt` > 當月 `daily_report_target.max_delays`；當月無目標列則跳過（計入掃描回報 `skipped_no_target`，不視異常） | danger | 24h |
| R5 | 月底未鎖定提醒 | `DR_MONTH_UNLOCKED` | BU | as_of 為當月最後一個自然日且時刻 ≥ config.hour(16:00)；當月有日報但無 LOCKED 列者，**整個 BU 聚合成一條摘要告警**（內列所有人名），不逐人發信 | warning | 當日僅 1 次（4h） |

補充說明：
- R1 計算連續天數時遇到「未來日、週六日」停止；中斷日以實際有無 USE 日報判定（遲交後補會讓下次掃描自動癒合，不需手動關告警）。
- R2 上下限觸發後 dedup_key 帶方向（`…|HIGH` / `…|LOW`），同日同方向不重發，高/低可各發一條。
- R3 前 6 個完整月中少於 3 個月有資料者跳過（回報 `insufficient_history`），與預測的最低樣本要求一致。
- 規則寫入 `alert_rule`，**既有 5 條財務 KPI 規則網域維持 `FINANCE`，行為完全不變**。

### 4.2 資料表變更（冪等遷移腳本 `database/add_dr_forecast_alert.js`）

```sql
-- ① alert_rule 擴欄（欄位與索引均以 INFORMATION_SCHEMA/STATISTICS 判斷後執行，可重跑）
ALTER TABLE alert_rule
  ADD COLUMN alert_domain VARCHAR(20) NOT NULL DEFAULT 'FINANCE' COMMENT 'FINANCE/DAILY_REPORT',
  ADD COLUMN scope_type   VARCHAR(10) DEFAULT NULL COMMENT 'USER/DEPT/BU',
  ADD COLUMN rule_config  JSON DEFAULT NULL COMMENT '額外閾值，如 {"danger_days":5}';
CREATE INDEX idx_domain_status ON alert_rule (alert_domain, status);

-- ② alert_log 擴欄
ALTER TABLE alert_log
  ADD COLUMN alert_domain  VARCHAR(20) NOT NULL DEFAULT 'FINANCE',
  ADD COLUMN scope_type    VARCHAR(10) DEFAULT NULL,
  ADD COLUMN scope_id      VARCHAR(50) DEFAULT NULL COMMENT 'user_id/depart_id/bu_no',
  ADD COLUMN scope_name    VARCHAR(100) DEFAULT NULL,
  ADD COLUMN dedup_key     VARCHAR(160) DEFAULT NULL COMMENT '同鍵冷卻去重',
  ADD COLUMN notify_status VARCHAR(10) NOT NULL DEFAULT 'NONE' COMMENT 'NONE/SENT/SKIPPED/FAILED';
CREATE INDEX idx_domain_time ON alert_log (alert_domain, created_at);
CREATE INDEX idx_dedup_time ON alert_log (dedup_key, created_at);
```

種子資料（僅在該 domain+kpi_id 不存在時插入）：

```
DR_MISSING_DAYS     cond='gte'       threshold=3   config={"danger_days":5,"scan_times":["09:30","16:30"]}  scope=USER cooldown=12
DR_DAILY_HOURS      cond='out_range' threshold=14  config={"min_hours":2,"max_hours":14}                    scope=USER cooldown=24
DR_MONTH_HOURS_DEV  cond='dev_pct'   threshold=0.30 config={"window_months":6,"min_eval_day":10}            scope=USER cooldown=48
DR_DELAY_OVER       cond='gt_target' threshold=0   config={"target_field":"max_delays"}                    scope=USER cooldown=24
DR_MONTH_UNLOCKED   cond='month_end' threshold=16  config={"hour":16}                                     scope=BU   cooldown=4
```
五條 `notify_channel='inapp,email'`、`notify_user='manager'`、`bu_no=NULL`（全 BU 適用）、`status=1`。

**去重鍵規格**：`${kpi_id}|${bu_no}|${scope_id}|${period}`
- R1/R3/R4 period = 目標月 `YYYY/MM`；R2 period = 日期+方向 `YYYY-MM-DD|HIGH`；R5 period = `YYYY/MM|MONTH_END`。
- 冷卻判定：查 alert_log 同 dedup_key、`created_at >= as_of - INTERVAL cooldown_hours HOUR` 已有紀錄 → 跳過（計入回報 `suppressed`）；但若本次級別 danger 而最近一條為 warning → **允許升級再發一條**。

### 4.3 掃描引擎 `services/drAlertScanner.js`（新增）

純函式核心，**不直接碰時鐘與排程**，便於 Jest 注入時間：

```js
// 對外介面
async function scanBu(buNo, { asOf = new Date(), actor = null } = {})
// → { bu_no, as_of, created: [...alert_log columns], suppressed, skipped_no_target,
//     insufficient_history, emailed: n, email_failed: n }
```

單次掃描流程：
1. 取啟用中的 DAILY_REPORT 規則（`status=1`）；取活躍人員清單與其所屬部門。
2. 以單條 perUser SQL 一次拉齊掃描窗口所需資料（沿用 dashboard perUser 模式，另加逐日工時視圖用於 R2）：
   - 近 14 天每日 `{report_date, hours, has_delay, status1}`；
   - 當月 MTD：total_hours / delay_cnt / elapsed 天數；
   - 前 6 完整月：每月 total_hours；
   - 當月 target 列；當月 lock 列（R5）。
3. 逐規則逐人（R5 逐 BU）判定，產出候選告警 `{rule, level, scope, dedup_key, title, message, suggestion}`。
4. 冷卻/升級過濾；通過者 INSERT alert_log（domain/scope/dedup_key 齊全）。
5. 渠道投遞：
   - **站內**：INSERT 即送達（`notify_status='SENT'` 不適用站內，站內以紀錄存在為準）。
   - **電子郵件**：解析 `notify_user`（`manager` → cams_xuser 中 xuser_type 為「部門主管/高階主管」且 email 非空者；支援明確 user_id 清單），呼叫 `mailer.sendAlertMail()`；SMTP 未配置回 `SKIPPED`，發送失敗回 `FAILED` 且不影響站內紀錄與 HTTP 回應。
6. R5 與 R3 等 BU/摘要類訊息合併發送：同 BU 同次掃描的 email 告警聚合成一封信（標題 `【ERMM 日報告警】HM · 2026-10-01（3 項）`），避免一人一封信轟炸。

錯誤隔離：單條規則/單人查詢失敗不中斷整個 BU 掃描，錯誤收集到回報 `errors[]` 並 console.error。

### 4.4 排程器 `scheduler/index.js`（新增，零新依賴）

- 以 `setInterval(tick, 60_000)` 分鐘級跳動，每次 tick 用「YYYY-MM-DD HH:mm」字串比對排程表，並以當日 fired 標記防重入：

| 時刻（伺服器本地時間） | 動作 |
|---|---|
| 每工作日 09:30 | 對所有活躍 BU 執行 R1–R4（R5 不在月底日不成立，自然 skip） |
| 每工作日 16:30 | 同上（補捉下午補交/惡化） |
| 每月最後一日 16:00 | 全量掃描（R5 成立；其餘規則一併） |

- 單次掃描以 process-level 旗標避免跨 tick 重入；單 BU 失敗不影響其他 BU。
- **單實例前提**：pm2 以單實體運行（現況）；若未來改 cluster，需以資料列或 Redis 鎖選主（M3 不做，於限制章節聲明）。
- 在 [app.js](file:///e:/finance/app.js) `start()` 內、`require.main === module` 且 `NODE_ENV !== 'test'` 時啟動，啟動日誌列印下次掃描時刻。

### 4.5 API

| 方法 | 路徑 | 權限 | 說明 |
|---|---|---|---|
| GET | `/api/alert/daily-rules` | isManager | 回傳 5 條日報域規則（含 rule_config 解析後物件、現行中文說明） |
| PUT | `/api/alert/daily-rules/:uid` | isManager | 可改 threshold、rule_config、cooldown_hours、status、notify_channel；**kpi_id/cond/domain 不可改**；同交易寫 audit_log（action=`ALERT_RULE_UPD`，old/new JSON） |
| POST | `/api/alert/daily-scan/run` | isManager | 手動掃描；body `{bu_no?}`；回傳 scanBu() 完整結果（created/suppressed/skipped…）。測試環境（NODE_ENV=test）額外接受 `as_of:'YYYY-MM-DD HH:mm'` 注入，正式環境忽略此參數 |
| GET | `/api/alert/logs`（擴充） | 登入者 | 新增 query `domain=DAILY_REPORT` 過濾；其餘維持原樣，財務告警頁面不受影響 |

請求/回應範例：

```jsonc
// PUT /api/alert/daily-rules/8
{ "threshold": 4, "rule_config": {"danger_days": 6}, "status": 1 }
// → { "success": true, "data": {"msg":"已更新","uid":8} }

// POST /api/alert/daily-scan/run  { "bu_no": "HM" }
{ "success": true, "data": {
  "bu_no": "HM", "as_of": "2026-10-01 09:30:00",
  "created": [ {"kpi_id":"DR_MISSING_DAYS","scope_id":"U0002","level":"warning","dedup_key":"DR_MISSING_DAYS|HM|U0002|2026/10"} ],
  "suppressed": 2, "skipped_no_target": 1, "insufficient_history": 0,
  "emailed": 1, "email_failed": 0, "errors": []
}}
```

### 4.6 前端（通知中心擴展）

[alerts.js](file:///e:/finance/public/js/pages/alerts.js) 頂部加頁籤（非經理只看得到通知列表）：

1. **🔔 通知列表**（既有）：新增網域篩選（全部/財務/日報）；日報域卡片顯示對象徽章（如 `U0002 李靜怡`、部門色籤），R1 顯示連續天數、R3 顯示偏離 ±%。
2. **📋 日報告警規則**（isManager）：表格列出 5 條規則（名稱/觸發說明/閾值/冷卻/啟用開關），列內「編輯」開 modal：
   - R1 改連續天數與 danger 天數；R2 改上下限；R3 改偏離%/視窗月數/最早評估日；R4 無編輯項（閾值來自目標設定）僅檢視說明；R5 改提醒時刻。
   - 儲存走 PUT，成功 toast 並重新整理；停用開關即時切換。
3. **▶ 立即掃描**（isManager，規則頁右上角）：呼叫手動掃描，toast/結果卡顯示「新增 N 條、冷卻跳過 M、無目標跳過 K、郵件 X 成功 Y 失敗」。
4. 全部文案走 i18n（`alert.dr.*`、`alert.drrule.*`），使用者輸出仍經 esc()。

### 4.7 郵件模板

`mailer.sendAlertMail({ bu_no, as_of, items })`：一封 BU 彙總信，淺色 HTML（沿用月度報告信視覺），表格逐條列【級別圖示】對象 / 規則 / 現況值 / 建議；頁尾附系統連結。SMTP 缺失時不拋例外，回 `{success:false, message:'SMTP 未配置，郵件未發送'}`（與現有 sendMgmtReport 行為一致）。

---

## 五、M3-B：下月工時與延誤趨勢預測（後做）

### 5.1 預測對象與維度

| scope | metric | 說明 | 取整 |
|---|---|---|---|
| USER | `HOURS` | 個人下月總工時 | 1 位小時 |
| USER | `DELAYS` | 下月延誤日數（projects1 非空去重日數） | 非負整數 |
| USER | `UNRESOLVED` | 下月未解日數（projects2 非空去重日數） | 非負整數 |
| DEPT | `HOURS` | 部門下月總工時 | 1 位小時 |
| DEPT | `PER_CAPITA_HOURS` | 部門下月人均工時（HOURS÷在部人數） | 1 位小時 |
| DEPT | `DELAYS` / `UNRESOLVED` | 部門內人員合計 | 非負整數 |

訓練視窗：目標月前 6 個完整月（n=6）；**有效歷史月 ≥ 3 才預測**，否則該列標 `insufficient_data`。部門口徑以「該月 daily_report 中出現的 depart_id」歸屬人員（人員跨月調部門時各月歸屬原部門，不回溯改寫）。

### 5.2 演算法（純 JS，無 ML 依賴）

對單一序列 y₁…yₙ（yₙ 為最近月）：

1. **WMA 加權移動平均**：權重 i=1…n（越近越高）
   `f_wma = Σ(i·yᵢ) / Σi`
2. **LR 線性回歸外推**：最小二乘配 y = a + b·t，外推 t = n+1 得 `f_lr`。
3. **混合（預設 algo=`WMA_LR`）**：`f = 0.5·f_wma + 0.5·f_lr`；可依 query 切 `WMA` / `LR`。
4. **80% 信賴區間**：以訓練期各月「一步提前回溯預測」殘差計 σ：
   `band = 1.282 · σ · √(1 + 1/n)`（n 小時 √ 項自動變寬）；區間 = f ± band。
   - HOURS 下限截 0，保留 1 位小數；DELAYS/UNRESOLVED 上下限取非負整數（floor/ceil）。
5. **風險標記**：

| metric | 基準 base | WARN | DANGER |
|---|---|---|---|
| HOURS / PER_CAPITA_HOURS | 目標月 target_hours；無目標列取訓練月均值 | 上限 ≥ 1.15·base（超載）或下限 ≤ 0.75·base（輕載） | 上限 ≥ 1.30·base 或下限 ≤ 0.60·base |
| DELAYS / UNRESOLVED | 目標月 target.max_delays / max_unresolved | 預測 ≥ 0.8·base | 預測 ≥ base（整數時即 >base 視同超限） |
| DELAYS / UNRESOLVED（無目標列） | 訓練月均值 | 預測 ≥ 1.5·均值 | 預測 ≥ 2·均值 |

取兩側最嚴重級別；同為 WARN 時超載/輕載方向寫進 `risk_dir`（`OVER`/`UNDER`/null）。

### 5.3 資料表（新增，建表腳本同上冪等檔案）

```sql
CREATE TABLE IF NOT EXISTS daily_report_forecast_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  bu_no VARCHAR(20) NOT NULL,
  target_ym CHAR(7) NOT NULL COMMENT '被預測月份 YYYY/MM',
  scope_type VARCHAR(10) NOT NULL COMMENT 'USER/DEPT',
  scope_id VARCHAR(50) NOT NULL COMMENT 'user_id 或 depart_id',
  scope_name VARCHAR(100) DEFAULT NULL,
  metric VARCHAR(20) NOT NULL COMMENT 'HOURS/PER_CAPITA_HOURS/DELAYS/UNRESOLVED',
  forecast_val DECIMAL(12,2) NOT NULL,
  lower_bound DECIMAL(12,2) DEFAULT NULL,
  upper_bound DECIMAL(12,2) DEFAULT NULL,
  risk_level VARCHAR(10) DEFAULT 'NORMAL' COMMENT 'NORMAL/WARN/DANGER',
  risk_dir VARCHAR(10) DEFAULT NULL COMMENT 'OVER/UNDER',
  algo VARCHAR(20) DEFAULT 'WMA_LR',
  history_n INT DEFAULT 0 COMMENT '有效訓練月數',
  generated_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_target_scope_metric (bu_no, target_ym, scope_type, scope_id, metric),
  INDEX idx_bu_target (bu_no, target_ym, risk_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='工時延誤預測結果';
```

### 5.4 預測服務 `services/drForecast.js`（新增）

- `buildHistory(buNo, targetYm, {windowMonths=6})`：以 perUser 月聚合 SQL 取數（複用 §2 口徑），回傳 `Map<scopeId, {name, months:[{ym,hours,delays,unresolved}], target}>`。
- `forecastSeries(values, {algo})`：純函式，回 `{forecast, lower, upper, sigma, n}`，獨立可單測（固定數列驗證 WMA/LR/區間）。
- `forecastBu(buNo, targetYm, {algo='WMA_LR', persist=true})`：組裝 + 風險標記 + UPSERT 快取，回 M3-B 回應結構。

### 5.5 API（掛在 dailyReport 路由，靜態路由宣告在 `/:id` 之前）

| 方法 | 路徑 | 權限 | 說明 |
|---|---|---|---|
| GET | `/api/daily-report/efficiency-forecast` | isManager | query：`bu_no`、`target_ym`（預設下月）、`scope=USER\|DEPT`（預設 DEPT）、`metric`（可選，預設全部）、`algo`（預設 WMA_LR）。即時計算並 UPSERT 快取後回傳 |
| POST | `/api/daily-report/efficiency-forecast/run` | isSenior | body：`{bu_no?, target_ym?}`，全 scope×全 metric 批次重算，回 `{upserted, insufficient, danger, warn}` |

GET 回應：

```jsonc
{
  "bu_no": "HM", "target_ym": "2025/10", "algo": "WMA_LR",
  "history_months": ["2025/04","2025/05","2025/06","2025/07","2025/08","2025/09"],
  "rows": [{
    "scope_type": "DEPT", "scope_id": "採購部", "scope_name": "採購部",
    "metric": "HOURS", "forecast_val": 412.5, "lower_bound": 368.0, "upper_bound": 457.0,
    "risk_level": "NORMAL", "risk_dir": null, "history_n": 6,
    "history": [380.0, 392.5, 401.0, 405.5, 398.0, 410.0]
  }],
  "insufficient": [{"scope_type":"USER","scope_id":"U0099","metric":"HOURS","history_n":1}]
}
```

非法 ym 回 400；無日報 BU 回空 rows + 空 insufficient + HTTP 200。

### 5.6 前端（日報頁工具列新增「🔮 趨勢預測」，isManager 可見）

- 面板列：目標月（下月預設，年份沿用 `yearOptions()` 範圍）、範圍（部門/個人）、對象下拉（部門來自 /meta）、metric 頁籤（總工時/人均/延誤/未解）。
- 主圖（Chart.js line）：歷史實際綠線 `#27ae60`；預測月紫線 `#9b59b6` 虛線；80% 置信帶用上下邊界兩 dataset + fill，`rgba(155,89,182,0.1)`；最後一個歷史點與預測點接續。
- 下方表格：對象 / 預測值 / 80%區間 / 風險徽章（DANGER 紅、WARN 橙、NORMAL 綠）/ 方向（超載↑ 紅 / 輕載↓ 灰藍）；DANGER/WARN 列預設排序在前；`insufficient` 對象顯示灰色「資料不足（n 月）」。
- isSenior 另看到「⚙ 全量重算」按鈕；一般職員無入口（後端 403 雙保險）。
- 圖表實例 push `this.charts`，`destroyCharts()` 統一銷毀；i18n key `dr.fc.*`。

### 5.7 月度經營報告郵件整合

既有月度報告 push 流程中，產 report 物件時加掛：以**下一個月**為 target_ym 呼叫 `forecastBu(..., {persist:false})`，取 `risk_level≠NORMAL` 列，於 [mailer.js](file:///e:/finance/utils/mailer.js) `buildReportHtml()` 加紫色標題區塊「🔮 下月預警」：逐行列部門/對象、metric、預測值（含區間）、風險級別；無風險列時顯示「下月各項指標預測均於正常範圍」。預測服務失敗不影響報告發送（區塊降级為不顯示 + log）。

---

## 六、權限矩陣

| 操作 | 一般員工 | 部門主管 (isManager) | 高階/管理員 (isSenior) |
|---|---|---|---|
| 查看通知列表 / 已讀 | ✅ 全部既有入口 | ✅ | ✅ |
| 查看日報規則清單 | ❌ 403 | ✅ | ✅ |
| 修改規則 / 停用 | ❌ 403 | ✅（留審計） | ✅（留審計） |
| 手動觸發掃描 | ❌ 403 | ✅ | ✅ |
| 查看趨勢預測 | ❌ 403 | ✅ | ✅ |
| 全量重算預測快取 | ❌ 403 | ❌ 403 | ✅ |
| 掃描告警郵件收件 | — | ✅ 預設收件 | ✅ 預設收件 |

---

## 七、i18n 文案清單（繁/簡/英三語，新增於 i18n.js）

- `alert.tab.logs` / `alert.tab.dr_rules` / `alert.domain.FINANCE` / `alert.domain.DAILY_REPORT`
- `alert.dr.r1`~`alert.dr.r5`：規則名稱 + 觸發說明模板（含 {days}/{hours}/{pct} 佔位）
- `alert.dr.msg.*`：各規則 title/message/suggestion 模板（如「{name} 已連續 {n} 個工作日未交日報」）
- `alert.dr.scan_btn` / `alert.dr.scan_result`（新增/冷卻跳過/無目標/信失敗）
- `alert.drrule.edit_title` / 閾值欄位名（warning 天數、danger 天數、工時上下限、偏離%、視窗月數、最早評估日、提醒時刻、冷卻時數）
- `dr.fc.title` / `dr.fc.scope_dept` / `dr.fc.scope_user` / `dr.fc.metric.*` / `dr.fc.forecast` / `dr.fc.band80` / `dr.fc.risk.*` / `dr.fc.over` / `dr.fc.under` / `dr.fc.insufficient` / `dr.fc.rerun` / `dr.fc.mail_section`

---

## 八、Jest 測試計畫（新檔 `test/drM3.test.js`，--forceExit）

沿用既有 x-test-user（MGR=isSenior / SUP=isManager / EMP）、BU=`TEST` 模式，ensureTables 建預測表並對 alert 兩表做冪等 ALTER，beforeAll/afterAll 清理 `TEST` BU 的 alert 規則/紀錄與預測列。

**M3-A 掃描引擎與 API（10 例）**
1. EMP 取規則 403、SUP 可取 5 條；PUT 改閾值成功且 audit_log 留 `ALERT_RULE_UPD`。
2. PUT 改 kpi_id/domain 被拒 400。
3. 人造 U0001 連續 4 工作日無日報（注入 as_of 週一），R1 出 warning；連續 6 日出 danger。
4. 同 as_of 重掃 → suppressed，不重複發信；warning 後達 danger 天數可升級再發。
5. 週末不計入連續天數（跨週人造資料驗證）。
6. 前一日工時 15.5h → R2 warning；無日報者 R2 不觸發。
7. 當月第 10 日後月化工時偏離 6 月均值 +35% → R3 warning（方向 OVER）；第 9 日不評估。
8. delay_cnt 超 target.max_delays → R4 danger；無 target 列計 skipped_no_target 且無告警。
9. 注入 as_of 為月末 16:00，3 人有日報僅 1 人鎖定 → 1 條 BU 摘要告警且訊息含 2 位未鎖姓名；當日重掃 suppressed。
10. 手動掃描 EMP 403；MGR 掃描回彙總結構，errors 為空。

**M3-B 預測（8 例）**
11. 固定數列單元測 `forecastSeries`：WMA、LR、WMA_LR 值與手算一致；σ 與區間寬度正確。
12. 歷史 2 個月 → insufficient_data，不寫 forecast_log；歷史 6 月正常出值。
13. DELAYS 區間為非負整數（floor/ceil），HOURS 下限 ≥ 0。
14. 風險分級：超 base 30% → DANGER/OVER；低 80% → WARN/UNDER；delay 預測 ≥ target → DANGER。
15. 以 TEST BU 2025 連續 6 月平滑資料預測第 7 月，GET 回應含 history+forecast，再次 GET 為 UPSERT（同唯一鍵列數不增）。
16. run 全量重算僅 isSenior（SUP 403），回傳 upserted/insufficient 計數正確。
17. 非法 target_ym 回 400。
18. 月度報告郵件 HTML 在有風險列時含「下月預警/forecast」區塊、無風險時含正常範圍句（直接測 buildReportHtml，不真發信）。

**回測驗收（獨立斷言）**：HM BU 2025/03–08 訓練預測 2025/09，對有完整 6 月資料人員的 HOURS 計 MAPE 平均 ≤ 25%（測試種子平滑，合理可達；DELAYS/UNRESOLVED 只驗方向與區間合理性，不硬卡 MAPE）。

---

## 九、驗收標準（端到端，逐條可驗）

1. 服務啟動日誌出現排程器載入與下次掃描時刻；`NODE_ENV=test` 下排程器不啟動。
2. 執行遷移腳本可重複執行不報錯；alert 兩表新欄位存在；5 條日報規則僅插入一次。
3. 通知中心可切「日報」網域，只看日報告警；財務頁面資料零影響。
4. 人造連缺 4 天者，手動掃描後通知中心出現 🟡 卡片，含人名/天數/建議；再掃不重複；第 6 天升 🔴。
5. 規則停用後掃描不再產生該規則告警；修改閾值立即生效；每次修改審計日誌可查。
6. SMTP 已配置時主管收到 BU 彙總告警信；未配置時站內紀錄正常、掃描回報 emailed=0 不報錯。
7. 月末 16:00 掃描對未鎖定者產生 BU 摘要一條；非月末/上午時刻不產生。
8. 趨勢預測面板：選 2025/10 → 圖上 6 個月綠線 + 10 月紫點與置信帶；表格風險徽章/方向正確；資料不足者灰色標示。
9. 2025/09 HOURS 回測 MAPE ≤ 25%；重跑不生重複列（UPSERT）。
10. 月度報告 push 的郵件在有風險時含「🔮 下月預警」區塊，預測服務異常時報告仍正常發送。
11. 三語切換下所有新增文案均有翻譯；375px 不需适配（移動端為 M4），桌面 Chrome 無 console 錯誤。
12. 既有 dailyReport 測試 72/72 維持全綠，全量 jest 除已知無關失敗（system/kpiQuery）外無新增紅燈。

---

## 十、實作任務拆解（建議提交粒度）

| 順序 | 任務 | 新增/修改檔案 |
|---|---|---|
| 1 | 冪等遷移：alert 兩表 ALTER + 5 規則種子 + forecast_log 建表 | `database/add_dr_forecast_alert.js`（新） |
| 2 | 掃描服務（規則判定/去重/聚合）+ 單元可注入 as_of | `services/drAlertScanner.js`（新） |
| 3 | mailer 告警信 + alert 路由擴充（daily-rules / scan / domain 過濾）+ 審計 | `utils/mailer.js`、`routes/alert.js` |
| 4 | 排程器 + app.js 掛載 | `scheduler/index.js`（新）、`app.js` |
| 5 | 通知中心 UI：網域頁籤、規則管理 modal、立即掃描 | `public/js/pages/alerts.js` |
| 6 | 預測服務（純函式演算法 + 歷史查詢 + UPSERT） | `services/drForecast.js`（新） |
| 7 | 預測 API + 月度報告郵件區塊 | `routes/dailyReport.js`、`utils/mailer.js` |
| 8 | 預測面板 UI（圖+表+風險徽章） | `public/js/pages/dailyReport.js` |
| 9 | 三語 i18n | `public/js/i18n.js` |
| 10 | Jest 18 例 + HM 回測斷言 + 真實資料瀏覽器驗證 | `test/drM3.test.js`（新） |

---

## 十一、部署步驟

```powershell
# 本機驗證
node database/add_dr_forecast_alert.js
npx jest test/drM3.test.js --forceExit --testTimeout=20000
# 重啟服務（app.js 啟動時自動掛載排程器）
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
node app.js   # 或正式機：pm2 restart ermm-finance
```
正式機：`git pull origin main` → `node database/add_dr_forecast_alert.js` → `pm2 restart ermm-finance`。

---

## 十二、風險、限制與不做範圍

1. **工作日不含節假日**：連假後開工首日 R1 可能誤報；M6 接入考勤/請假表後於活躍判定與工作日曆一併扣除。
2. **單實例排程**：pm2 多實例或多機部署會重複掃描（雖有冷卻去重兜底）；水平擴展前需加分散式鎖。
3. **預測不是 ML**：WMA/LR 對趨勢轉折與脈衝無感知；文件與 UI 均標示「統計外推僅供參考」，演算法升級（季節性模型）保留 `algo` 欄位擴充但不在本期。
4. **樣本隱私**：R3/R2 使用個人歷史資料，僅主管/高階可見告警；通知中心對員工仍只顯示既有可見範圍（M3 不新增員工視圖）。
5. **不做（明確排除）**：Line/企業微信/Web Push 等即時通道（M5）；手機響應式（M4）；節假日/請假連動（M6）；預測結果 Excel 匯出（管理報表以月度報告郵件承載，若後續需要再補）。
