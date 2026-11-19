# 測試用例：CEO-05 組織人效分析 / CFO-01 借支核銷 / CFO-02 付款排程·回單·核銷

| 項目 | 內容 |
| --- | --- |
| 版本 | v1.0（2026-11-15） |
| 對應功能 | CEO-05 組織人效分析、CFO-01 費用報銷（借支/預支）、CFO-02 資金與付款審批（排程/回單/AR·AP 核銷） |
| 測試類型 | 接口整合測試（Jest + Supertest，直連 ERMM_db）＋ 手工驗收用例 |
| 自動化檔案 | `test/hrEfficiency.test.js`、`test/expenseAdvance.test.js`、`test/payRequestFlow.test.js` |
| 執行方式 | `npx jest test/hrEfficiency.test.js test/expenseAdvance.test.js test/payRequestFlow.test.js --forceExit` |

## 1. 測試環境與前置條件

1. MySQL `ERMM_db` 可連線，`.env` 的 `DB_*` 正確；已執行 `migrations/047_hr_payment_advance.sql`。
2. `NODE_ENV=test` 時認證中介層放行：未帶 token 預設為管理員 `rocky`；帶 `Authorization: Bearer <token>` 時以 token 身分執行。
3. 需要用到的既有資料：
   - `mgm_finance_summary` 有 `HM/HN/SZ` 的 2025-10 ~ 2025-12 資料。
   - `cams_xuser` 存在管理員 `rocky` 與至少一名非管理員帳號。
   - `wf_process` 存在 `business_type='ADVANCE'` 且 `enabled=1` 的流程。
4. 測試資料隔離：
   - 人效編制使用 `period='2099-01' / '2099-02'`，部門名 `自動化測試部`。
   - 付款核銷使用 `bu_no='TEST'`、`YYYY_MM='2099-01'` 的專用發票。
   - 每個測試檔在 `afterAll` 清理自己建立的資料。

## 2. 用例編號規則

`模組-序號`：`HR-xx`（CEO-05）、`ADV-xx`（CFO-01 借支）、`PAY-xx`（CFO-02 付款）。優先級：P0 主流程、P1 重要分支、P2 邊界/提示。

## 3. CEO-05 組織人效分析

| 編號 | 優先級 | 前置條件 | 測試步驟 | 預期結果 | 自動化 |
| --- | --- | --- | --- | --- | --- |
| HR-01 | P0 | HM 有 2025-12 財務摘要 | `GET /api/hr-efficiency/overview?bu_no=HM&YYYY_MM=2025-12` | 200；`data.bu_no=HM`、`period=2025-12`；`kpi.employee_cnt` 等於 `mgm_finance_summary` 實際值 | 是 |
| HR-02 | P0 | 同上 | 檢查 `kpi` 欄位 | 含 `plan_headcount / headcount_gap / headcount_rate / per_capita_output / per_capita_salary / labor_cost_rate / total_hours / per_capita_hours` | 是 |
| HR-03 | P0 | 同 HR-01 | 檢查 `departments` | 陣列非空；每項含 `depart_name / plan_headcount / actual_headcount / headcount_gap / headcount_rate / total_hours / per_capita_hours / timeliness_rate / work_ratio` | 是 |
| HR-04 | P0 | 同 HR-01 | 檢查 `trend` | 長度 6，末月等於 `period`，欄位含 `output / per_capita_output / salary_amt / labor_cost_rate` | 是 |
| HR-05 | P1 | 不帶月份 | `GET /api/hr-efficiency/overview?bu_no=HM` | 200；`period` 為 `mgm_finance_summary` 該 BU 最新月份 | 是 |
| HR-06 | P2 | — | `GET /api/hr-efficiency/overview?bu_no=XX` | 400，訊息「公司别仅支持 HM/HN/SZ」 | 是 |
| HR-07 | P1 | 非主管 token | `GET /api/hr-efficiency/overview?bu_no=HM` | 403，訊息含「权限不足」 | 是 |
| HR-08 | P1 | — | `GET /api/hr-efficiency/headcount-plans?bu_no=HM&period=2025-12` | 200；`rows` 至少 7 個部門（演示編制） | 是 |
| HR-09 | P0 | 2099-01 無資料 | `POST /api/hr-efficiency/headcount-plans`（計畫 5 人） | 200；返回記錄 `plan_headcount=5` | 是 |
| HR-10 | P1 | HR-09 之後 | 再次 `POST` 同 BU/月份/部門，計畫改 6 人 | 200；仍只有 1 筆，`plan_headcount=6`（覆蓋） | 是 |
| HR-11 | P1 | HR-10 之後 | `PUT /headcount-plans/:uid` 設 `actual_headcount=3` | 200；返回 `actual_headcount=3` | 是 |
| HR-12 | P1 | HR-09 之後 | `POST /headcount-plans/copy`（2099-01 → 2099-02） | 200；`copied≥1` | 是 |
| HR-13 | P2 | HR-12 之後 | 再次複製相同來源→目標 | 200；`copied=0`、`skipped≥1` | 是 |
| HR-14 | P2 | — | `POST /headcount-plans/copy` 來源月份無資料 | 400，訊息含「无编制数据可复制」 | 是 |
| HR-15 | P1 | — | `DELETE /headcount-plans/:uid`，再刪同一筆 | 第一次 200；第二次 404 | 是 |
| HR-16 | P2 | — | `POST /headcount-plans` 傳 `plan_headcount=-1` 或 `period='2099/1'` | 400（非負整數 / 月份格式） | 是 |
| HR-17 | P0 | 頁面已登入管理員 | 打開「組織人效分析」，切換 BU/月份 | KPI 卡、部門表、趨勢表、目標貫通皆渲染，無 JS 錯誤 | 手工 |
| HR-18 | P1 | 頁面 | 新增/編輯/刪除部門編制、複製上月編制 | 操作後列表即時刷新，數值正確 | 手工 |

## 4. CFO-01 費用報銷：借支與核銷

| 編號 | 優先級 | 前置條件 | 測試步驟 | 預期結果 | 自動化 |
| --- | --- | --- | --- | --- | --- |
| ADV-01 | P2 | — | `POST /api/expense/advances`，`title` 為空 | 400，訊息「借支事由必填」 | 是 |
| ADV-02 | P2 | — | `POST`，`amount=0` | 400，訊息「借支金额必须大于 0」 | 是 |
| ADV-03 | P2 | — | `POST`，`advance_type='XXX'` | 200；類型被正規化為 `GENERAL` | 是 |
| ADV-04 | P0 | — | `POST`，事由「自動化測試借支」、金額 1000 | 200；返回 `id`、`advance_no` 符合 `JK+8碼日期+4碼序號` | 是 |
| ADV-05 | P1 | ADV-04 | `GET /advances?scope=mine` | 200；包含該單，`status=DRAFT`、`amount=1000`、`balance=1000` | 是 |
| ADV-06 | P1 | ADV-04 | `PUT /advances/:id` 改金額 800 | 200；詳情 `amount=800`、`balance=800` | 是 |
| ADV-07 | P1 | ADV-06 | `POST /advances/:id/submit` | 200；`status=PENDING`；`approvers` 非空；DB `wf_instance_id` 已寫入 | 是 |
| ADV-08 | P2 | ADV-07 | `PUT /advances/:id` | 400，訊息「当前状态不可编辑」 | 是 |
| ADV-09 | P2 | ADV-07 | `DELETE /advances/:id` | 400，訊息「只有草稿可以删除」 | 是 |
| ADV-10 | P2 | ADV-07 | `POST /advances/:id/pay` | 400，訊息「只有审批通过的借支单可以拨付」 | 是 |
| ADV-11 | P2 | ADV-07 | `POST /advances/:id/settle` | 400，訊息「借支尚未拨付，不能核销」 | 是 |
| ADV-12 | P0 | ADV-07，DB 將狀態置為 APPROVED | `POST /advances/:id/pay` | 200；詳情 `status=PAID`、`paid_date` 非空 | 是 |
| ADV-13 | P0 | ADV-12 | `POST /advances/:id/settle`，`amount=1300`（>餘額） | 400，訊息含「超过未核销余额」 | 是 |
| ADV-14 | P0 | ADV-12 | `POST /settle`，`amount=300` | 200；`balance=500`、`settled_amount=300`、`status=PAID` | 是 |
| ADV-15 | P0 | ADV-14 | `POST /settle`，`amount=500` | 200；`balance=0`、`status=SETTLED` | 是 |
| ADV-16 | P2 | ADV-15 | 已結清後再 `POST /settle`，`amount=100` | 400（超過餘額 0） | 是 |
| ADV-17 | P1 | ADV-12 | 以非管理員 token `POST /pay` | 403，訊息含「只有管理员」 | 是 |
| ADV-18 | P1 | ADV-12 | 以非管理員且非主管 token `POST /settle` | 403，訊息含「只有财务或主管」 | 是 |
| ADV-19 | P1 | ADV-04 同批新建草稿 | `DELETE /advances/:id`（草稿） | 200；詳情 404 | 是 |
| ADV-20 | P2 | ADV-04 | 以他人 token `GET /advances/:id` | 403，訊息「无权查看该借支单」 | 是 |
| ADV-21 | P1 | 頁面 | 借支管理頁簽：新建→提交→撥付→核銷 | 狀態徽章依序 DRAFT→PENDING→PAID→SETTLED，餘額同步 | 手工 |
| ADV-22 | P1 | 頁面 | 核銷時關聯報銷單 | 只能選同申請人且金額足夠的報銷單，核銷後報銷單與借支餘額同步 | 手工 |

## 5. CFO-02 付款審批：排程 / 銀行回單 / AR·AP 核銷

| 編號 | 優先級 | 前置條件 | 測試步驟 | 預期結果 | 自動化 |
| --- | --- | --- | --- | --- | --- |
| PAY-01 | P2 | — | `GET /api/pay-request/schedule` 以非主管 token | 403，訊息含「无权查看付款排程」 | 是 |
| PAY-02 | P2 | — | `PUT /:id/schedule`，`planned_pay_date='2099/02/10'` | 400，訊息「请填写有效的计划付款日」 | 是 |
| PAY-03 | P0 | 新建測試付款單（DRAFT，金額 1000） | `PUT /:id/schedule`，`planned_pay_date='2099-02-10'` | 200；詳情 `planned_pay_date=2099-02-10` | 是 |
| PAY-04 | P0 | PAY-03 | `GET /schedule?month=2099-02&bu_no=TEST` | 200；`summary.count=1`、`summary.amount=1000`；`rows[0].request_no` 正確 | 是 |
| PAY-05 | P1 | 專用 AP 發票（`sub_amt=1000,payment=0`） | `GET /writeoff-sources?source_type=AP&bu_no=TEST` | 200；包含該發票，`open_amount=1000` | 是 |
| PAY-06 | P2 | PAY-03 | `POST /:id/receipt` 不帶 `bank_receipt_no` | 400，訊息「银行回单号必填」 | 是 |
| PAY-07 | P2 | PAY-03（DRAFT） | `POST /:id/receipt` 帶完整回單資訊 | 400，訊息含「不可登记回单」 | 是 |
| PAY-08 | P2 | 付款單狀態 APPROVED | 以非管理員 token `POST /:id/receipt` | 403，訊息「只有财务管理员可以登记回单」 | 是 |
| PAY-09 | P0 | 付款單狀態 APPROVED | `POST /:id/receipt`（回單號 `BE-TEST-001`、金額 1000） | 200；詳情 `status=PAID`、`bank_receipt_no=BE-TEST-001`、`writeoff_status=UNWRITTEN` | 是 |
| PAY-10 | P2 | PAY-09（PAID） | `PUT /:id/schedule` | 400，訊息含「不可调整排程」 | 是 |
| PAY-11 | P2 | PAY-03（未付款） | `POST /:id/writeoff` | 400，訊息「只有已付款的单据可以核销」 | 是 |
| PAY-12 | P2 | PAY-09 | `POST /:id/writeoff`，`amount=1200`（超過付款金額） | 400，訊息含「核销合计不能超过付款金额」 | 是 |
| PAY-13 | P2 | PAY-09 | `POST /:id/writeoff`，`source_uid` 不存在 | 404，訊息「发票不存在」 | 是 |
| PAY-14 | P0 | PAY-09 | `POST /:id/writeoff`，`amount=400` | 200；`writeoff_status=PARTIAL`、`writeoff_total=400.00`；發票 `payment=400` | 是 |
| PAY-15 | P0 | PAY-14 | `GET /:id/writeoffs` | 200；`rows` 1 筆、`total=400.00` | 是 |
| PAY-16 | P0 | PAY-14 | 再 `POST /:id/writeoff`，`amount=600` | 200；`writeoff_status=WRITTEN`；發票 `payment=1000`、`pay_date` 非空 | 是 |
| PAY-17 | P1 | PAY-16 | `DELETE /:id/writeoff/:wid`（撤銷第一筆） | 200；`writeoff_total=600.00`、`writeoff_status=PARTIAL`；發票 `payment=600` | 是 |
| PAY-18 | P1 | PAY-16 | 以非管理員 token `DELETE /:id/writeoff/:wid` | 403，訊息「只有财务管理员可以撤销核销」 | 是 |
| PAY-19 | P2 | — | `DELETE /:id/writeoff/999999` | 404，訊息「核销记录不存在」 | 是 |
| PAY-20 | P1 | 頁面 | 付款申請列表：排程→登記回單→核銷→核銷明細 | 列表「計劃付款日/銀行回單/核銷」欄位同步；核銷明細可撤銷 | 手工 |
| PAY-21 | P1 | 頁面 | 切換「付款排程」頁簽並切換月份 | 四張匯總卡與明細表按月份正確統計 | 手工 |
| PAY-22 | P2 | 頁面 | 核銷時 AR/AP 來源下拉 | 僅列未付清發票，顯示未付金額；超額提交被攔截 | 手工 |

## 6. 接口清單（本次新增）

| 模組 | 方法 | 路徑 | 說明 |
| --- | --- | --- | --- |
| CEO-05 | GET | `/api/hr-efficiency/overview` | 人效總覽（KPI/部門/趨勢） |
| CEO-05 | GET/POST/PUT/DELETE | `/api/hr-efficiency/headcount-plans[/:uid]` | 部門編制 CRUD |
| CEO-05 | POST | `/api/hr-efficiency/headcount-plans/copy` | 複製上月編制 |
| CFO-01 | GET/POST/PUT/DELETE | `/api/expense/advances[/:id]` | 借支單 CRUD |
| CFO-01 | POST | `/api/expense/advances/:id/submit` | 提交審批 |
| CFO-01 | POST | `/api/expense/advances/:id/pay` | 撥付（管理員） |
| CFO-01 | POST | `/api/expense/advances/:id/settle` | 核銷（財務/主管） |
| CFO-02 | GET | `/api/pay-request/schedule` | 月度付款排程 |
| CFO-02 | GET | `/api/pay-request/writeoff-sources` | 可核銷 AR/AP 發票 |
| CFO-02 | PUT | `/api/pay-request/:id/schedule` | 設定/調整排程 |
| CFO-02 | POST | `/api/pay-request/:id/receipt` | 登記銀行回單（管理員） |
| CFO-02 | GET | `/api/pay-request/:id/writeoffs` | 核銷明細 |
| CFO-02 | POST | `/api/pay-request/:id/writeoff` | 新增核銷 |
| CFO-02 | DELETE | `/api/pay-request/:id/writeoff/:wid` | 撤銷核銷（管理員） |

## 7. 已知限制與注意事項

1. 人效「人均產值 / 人工成本率」只能在 BU 層級計算（ERP 訂單與開票無部門欄位），部門層級僅工時類指標。
2. 部門「實際人數」優先取 `hr_headcount_plan.actual_headcount`，為空時回退 `cams_xuser` 同部門在職人數，而非薪資表人數。
3. 付款核銷會即時回寫 `mgm_invoice_details.payment / pay_date`，撤銷核銷會反向回退；測試務必使用專用 `bu_no='TEST'` 發票。
4. 借支提交後需由部門主管→財務（管理員）審批；測試以 DB 直接改狀態模擬審批通過，正式流程請走審批中心。
