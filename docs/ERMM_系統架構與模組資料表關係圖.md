# ERMM 财务模组 · 系统架构图与模块-资料表关系图

> 基于代码事实抽取（routes/*.js、database/add_*.js、public/index.html 菜单、public/js/pages/*.js）
> 生成日期：2026-10-06｜更新日期：2026-11-12（第三方整合 5 Tab、码表驱动与三语 i18n 更新）

---

## 一、系统整体架构图（分层架构）

![ERMM 分层架构图](/diagrams/01-architecture-layers.svg)

> 图 1：四层架构（接入层 / 前端层 / 服务层 / 数据层）。PNG 版见 [01-architecture-layers.png](/diagrams/01-architecture-layers.png)

```mermaid
flowchart TB
    subgraph CLIENT["① 客户端层"]
        Browser["浏览器 (Chrome/Edge)<br/>HTTP + JWT"]
    end

    subgraph FRONTEND["② 前端 SPA 层 (public/)"]
        Index["index.html 入口<br/>+ 侧边栏菜单 (50 个入口 / 8 个分组)"]
        App["app.js<br/>路由/导航/弹窗/通用 UI"]
        I18n["i18n.js<br/>简/繁/英 三语"]
        Pages["pages/*.js (50 个功能入口)<br/>dashboard / dailyReport / finance / tax / integration<br/>aiqa / arSmart / dataQuality / cashForecast / ..."]
        Chart["Chart.js 图表引擎"]
    end

    subgraph GATEWAY["③ API 网关层 (app.js)"]
        Auth["/api/auth<br/>登录/登出/JWT"]
        AuthReq["authRequired 中间件<br/>JWT 校验 + 权限"]
        Static["静态资源服务<br/>public/"]
    end

    subgraph SERVICE["④ 业务服务层 (routes/*.js · 50 个路由)"]
        direction LR
        S1["📊 绩效闭环<br/>dailyReport"]
        S2["🔔 预警引擎<br/>alert"]
        S3["📈 趋势预测<br/>forecast"]
        S4["📒 财务核心<br/>finance"]
        S5["💰 现金预测<br/>cashForecast"]
        S6["🧾 财务核算<br/>cash/invoice/pay/check/bank/account"]
        S7["📋 预算/管会/合并<br/>budget/mgmtAccounting/consolidation"]
        S8["🤖 AI 能力<br/>aiqa/dailySummary/llm/diagnosis<br/>arSmart/dataQuality/scenario"]
        S9["📦 业务单据<br/>po/so/dn/tempPo"]
        S10["⚙️ 系统支撑<br/>system/user/batch/kpi/action"]
        S11["🔌 第三方资料整合<br/>integration"]
        S12["🧮 电子化报税<br/>tax"]
    end

    subgraph DATA["⑤ 数据层 (MySQL 8 · ermm_db)"]
        direction TB
        CoreT["核心交易表<br/>daily_report / fin_voucher / fin_tax_return / ..."]
        AuditT["审计与配置表<br/>daily_report_audit_log / alert_rule / llm_config / ..."]
        BaseT["基础资料表<br/>cams_xuser / mgm_account_details / mgmt_dept / ..."]
        Ledger["fin_ruid_ledger<br/>RUID 全链路主台账"]
        IntgT["第三方整合表<br/>intg_source / intg_job / intg_log"]
        TaxT["税务申报表<br/>vat_declarations / cit_annual_settlements / iit_withholding_*"]
        TaxIn["税务录入表<br/>tax_vat_adjustments / tax_cit_inputs / payroll_details / bonus_details"]
        AiT["AI 知识库与摘要表<br/>ermm_knowledge / ermm_kb_miss_log / daily_ai_summary / ermm_ai_records"]
    end

    subgraph EXTERNAL["⑥ 外部/支撑"]
        LLM["LLM 服务<br/>(AI 问答/诊断)"]
        Mailer["邮件服务<br/>nodemailer 告警通知"]
        Scheduler["node-cron 排程器<br/>工作日 09:30/16:30 告警扫描"]
        ThirdPartyDB["第三方数据库<br/>(MySQL 连线池缓存)"]
        ExcelFile["Excel 文件<br/>(ExcelJS 解析/导入)"]
        IntgSched["整合排程器<br/>(setInterval 分钟级)"]
    end

    Browser --> Index
    Index --> App --> Pages --> Chart
    App --> Auth --> AuthReq
    AuthReq --> S1 & S2 & S3 & S4 & S5 & S6 & S7 & S8 & S9 & S10 & S11 & S12
    S1 --> CoreT & AuditT
    S2 --> AuditT & Scheduler --> Mailer
    S3 --> CoreT
    S4 --> Ledger & CoreT
    S5 --> CoreT
    S6 --> CoreT
    S7 --> CoreT
    S8 --> LLM & CoreT & AiT & BaseT
    S9 --> CoreT
    S10 --> BaseT & AuditT
    S11 --> IntgT & CoreT
    S11 --> ThirdPartyDB & ExcelFile & IntgSched
    S12 --> TaxT & TaxIn & CoreT
    Ledger --> CoreT

    style CLIENT fill:#e3f2fd,stroke:#1976d2
    style FRONTEND fill:#e8f5e9,stroke:#388e3c
    style GATEWAY fill:#fff3e0,stroke:#f57c00
    style SERVICE fill:#fce4ec,stroke:#c2185b
    style DATA fill:#f3e5f5,stroke:#7b1fa2
    style EXTERNAL fill:#efebe9,stroke:#5d4037
```

---

## 二、模块 → 路由 → 前端页 → 资料表 关系总表

> 每张表归属于「主要操作模块」；跨模块共用表在说明列标注。

| # | 功能模块 | API 路由 | 前端页面 | 主要资料表 | 说明 |
|---|---|---|---|---|---|
| 1 | **认证授权** | `/api/auth` | login | `cams_xuser` `login_user_record` `leader_user` | JWT 签发、登录日志 |
| 2 | **系统管理** | `/api/system` `/api/codes` | system / codeTable | `cams_system_codes` `schema_migrations` | 系统码维护（下拉/公司/税率/汇率）、迁移版本；缓存 TTL 1 小时 |
| 3 | **用户管理** | `/api/user` | user | `cams_xuser` | 用户/部门/角色维护 |
| 4 | **工作日报表** | `/api/daily-report` | dailyReport | `daily_report` `daily_report_detail` `daily_report_lock` `daily_report_audit_log` `daily_report_target` `daily_report_okr` `daily_report_okr_kr` `daily_report_erp_xref` `daily_report_mgmt_report` `daily_report_annual_review` `cams_xuser` | **核心模块**：日报主表+10 张支撑表 |
| 5 | **未完成分析** | `/api/daily-report` | dailyReportUnfinished | `daily_report` `daily_report_detail` | 基于日报明细统计延误/未解 |
| 6 | **预警通知** | `/api/alert` | alerts | `alert_rule` `alert_log` | 5 条内置告警规则 + 告警记录 |
| 7 | **趋势预测** | `/api/forecast` | trend | `daily_report_forecast_log` `daily_report` | WMA+LR 混合预测，结果落库 |
| 8 | **行动追踪** | `/api/action` | actions | `action_task` | 行动项追踪 |
| 9 | **财务入账/报税/勾稽** | `/api/finance` | finance | `fin_ruid_ledger` `fin_account_subject` `fin_voucher` `fin_voucher_entry` `fin_tax_return` `fin_tax_return_item` `fin_reconciliation` | **RUID 全链路**：7 张表 |
| 9a | **报税明细表（年度汇总+导出）** | `/api/finance/tax-detail` | finance（报税 Tab） | `fin_tax_return` `fin_tax_return_item` | **只读聚合**：JOIN 报税主表+明细，年度汇总，支持 CSV 导出，无新增表 |
| 10 | **现金流量预测** | `/api/cash-forecast` | cashForecast | `mgm_casher_details` `mgm_cash_safe_level` | 13 周预测 + 安全水位 |
| 11 | **现金日记账** | `/api/cash` | cash | `mgm_casher_details` | 与现金预测共用 casher 表 |
| 12 | **应收应付** | `/api/arap` | arap | `ermm_arap_detail` `ermm_erp_so` `ermm_erp_po` | 关联 SO/PO 自动产生 AR/AP |
| 13 | **发票管理** | `/api/invoice` | invoice | `mgm_invoice_details` | 销项/进项发票 |
| 14 | **付款明细** | `/api/pay` | pay | `pay_detail` | 付款流水 |
| 15 | **票据管理** | `/api/check` | check | `check_detail` | 应收/应付票据 |
| 16 | **银行贷款** | `/api/bank` | bank | `mgm_bank_loan_details` | 贷款本金/利息 |
| 17 | **会计科目** | `/api/account` | account | `mgm_account_details` `MGM_account_details` | 科目余额（与 finance.fin_account_subject 互补） |
| 18 | **预算编制** | `/api/budget` | budget | `budget` `budget_detail` | 预算主表+明细 |
| 19 | **管理会计** | `/api/mgmt-accounting` | mgmtAccounting | `mgmt_dept` `mgmt_dept_pl` | 部门损益 |
| 20 | **合并报表** | `/api/consolidation` | consolidation | `mgm_finance_summary` `mgmt_dept_pl` | 多 BU 合并 |
| 21 | **财务摘要** | `/api/summary` | summary | `mgm_finance_summary` | 月度财务摘要 |
| 22 | **三大报表** | `/api/report` | report | `mgm_finance_summary` | 资产负债/利润/现金流量 |
| 23 | **风险预警** | `/api/risk` | risk | `mgm_finance_summary` `ermm_arap_detail` | 财务风险指标 |
| 24 | **财务预测** | `/api/forecast` | forecast | `forecast_detail` | 财务数据预测 |
| 25 | **年度趋势** | `/api/forecast` | trend | `mgm_finance_summary` `forecast_detail` | 年度趋势图表 |
| 26 | **月度报表** | `/api/monthly` | monthly | `monthly_items` | 月度项目 |
| 27 | **损益平衡** | `/api/bep` | bep | `mgm_bep_threshold` | BEP 阈值 |
| 28 | **AI 问答** | `/api/aiqa` | aiqa | `ermm_ai_records` `ermm_knowledge` `ermm_kb_miss_log` `llm_config` `mgm_finance_summary` `budget_detail` `mgmt_dept_pl` | **RAG**：n-gram 检索知识库 + LLM 作答；未命中写日志 |
| 29 | **情景模拟** | `/api/scenario` | scenario | `budget_detail` `mgm_finance_summary` `ermm_scenario_saved` | 多情景测算；方案可命名保存/回看 |
| 30 | **异常诊断** | `/api/diagnosis` | (内嵌) | `mgm_finance_summary` `mgm_kpi_desc` | KPI 异常自动诊断 |
| 31 | **采购单 PO** | `/api/po` | po | `ermm_erp_po` | 采购订单 |
| 32 | **销售订单 SO / 预估订单** | `/api/so` `/api/preorders` | so / preorder | `ermm_erp_so` `mgm_preorder_lists` `mgm_customer_projects` | 销售订单 + 销售预估订单；客户/项目下拉取自 `mgm_customer_projects` |
| 33 | **送货单 DN** | `/api/dn` | dn | `ERMM_erp_so_DN` `ermm_erp_so` | 送货通知 |
| 34 | **PO 暂存** | `/api/temp-po` | tempPo | `ermm_temp_po` | PO 暂存草稿 |
| 35 | **分公司** | `/api/branch` | branch | `branch_detail` | 分公司资料 |
| 36 | **往来关系** | `/api/relation` | relation | `relation_detail` | 客户/供应商关系 |
| 37 | **批次管控** | `/api/batch` `/api/batch-ctrl` | batch | `cams_batch_control` | 批次控制 |
| 38 | **KPI 管理** | `/api/kpi` `/api/kpi-query` | kpi | `mgm_kpi_desc` `mgm_finance_summary` | KPI 定义与查询 |
| 39 | **多维下钻** | `/api/kpi-query` | drilldown | `mgm_finance_summary` `ermm_erp_so` `mgm_invoice_details` | 多维度数据下钻 |
| 40 | **存货管理** | `/api/xitems` | xitems | `e2_xitems_daily_status` `e2_xitems_daily_status_chart` | 存货日状态 |
| 41 | **仪表板** | `/api/summary` `/api/invoice` `/api/risk` | dashboard | `mgm_finance_summary` `mgm_invoice_details` `ermm_arap_detail` | **下钻钻取**：点击销售成本/收入柱体 → 弹窗显示当月 AR/AP 发票明细 |
| 42 | **第三方资料整合** | `/api/integration` | integration | `intg_source` `intg_job` `intg_log` `intg_demo_src` `intg_demo_tgt` + 任意本地目标表 | **5 Tab 操作台**：Excel 导入（模板动态生成）/ SQL 线上整合 / 批次作业（失败重试）/ 数据源 / 执行日志（筛选 + CSV 导出）；Online 即时 / Batch 排程；栏位映射 + UPSERT + 栏位白名单 |
| **43** | **电子化报税** | `/api/tax` | tax | `vat_declarations` `cit_annual_settlements` `iit_withholding_batches` `iit_withholding_details` `tax_submit_receipts` `tax_vat_adjustments` `tax_cit_inputs` `tax_cit_adjustments` `payroll_details` `bonus_details` `mgm_invoice_details` `mgm_finance_summary` `cams_system_codes` | **VAT/CIT/IIT 三税种**：算税→核对→提交→落库；支持按月/按季申报、年终奖单独计税、CIT 收入成本人工覆盖；VAT/CIT 税率读取码表 `TAX_TYPE` |
| 44 | **AR 智能催收** | `/api/ar-smart` | arSmart | `mgm_invoice_details` `ermm_arap_detail` `mgm_finance_summary` | **只读评分**：账龄40+逾期30+金额15+风险10+占比5 → 四级灯号排序 |
| 45 | **数据质量扫描** | `/api/data-quality` | dataQuality | 全库只读（7 大类 20+ 项检核） | 一键体检；**只扫描不自动修复** |
| 46 | **每日 AI 执行摘要** | `/api/daily-summary` | dashboard（摘要卡片） | `daily_ai_summary` `mgm_finance_summary` `alert_log` `mgm_casher_details` | LLM 生成自然语言摘要并落库，支持历史回看 |
| 47 | **现金流概率预测** | `/api/cash-forecast/monte-carlo` | cashForecast（概率模式） | `mgm_casher_details` `mgm_cash_safe_level` | **Monte Carlo** 5000 次模拟 → P10/P50/P90 与负现金概率 |
| 48 | **战情看板** | `/api/war-room` | warRoom | `mgm_finance_summary` `mgm_invoice_details` `ermm_arap_detail` | 高管实时经营看板 |
| 49 | **系统文件** | 静态 `/docs/architecture` `/docs/data-model` | 新标签页 HTML | 无（纯文档，不落库） | **仅 admin='Yes'** 可打开，非管理员前端拦截提示 |

---

## 三、核心模块资料表关系图（ER 图）

![ERMM 核心数据表 ER 关系图](/diagrams/04-data-model-er.svg)

> 图 2：发票明细 → 月度汇总 → KPI / AI 记录的核心外键链路。PNG 版见 [04-data-model-er.png](/diagrams/04-data-model-er.png)

### 3.1 工作日报表模块（P0/P1 核心）

```mermaid
erDiagram
    cams_xuser ||--o{ daily_report : "提交日报"
    daily_report ||--o{ daily_report_detail : "1:N 工时明细"
    daily_report ||--o{ daily_report_lock : "1:1 签核锁定"
    daily_report ||--o{ daily_report_audit_log : "1:N 审计日志"
    daily_report ||--o{ daily_report_erp_xref : "1:N ERP 对照"
    cams_xuser ||--o{ daily_report_target : "按月设定目标"
    cams_xuser ||--o{ daily_report_okr : "按月 OKR"
    daily_report_okr ||--o{ daily_report_okr_kr : "1:N KR"
    daily_report ||--o{ daily_report_mgmt_report : "1:N 管理报表"
    cams_xuser ||--o{ daily_report_annual_review : "年度评鉴"

    daily_report {
        bigint id PK
        varchar bu_no
        varchar user_id FK
        varchar YYYY_MM
        date work_date
        varchar ruid UK
        varchar depart_id
        text projects
        varchar status
    }
    daily_report_detail {
        bigint id PK
        varchar ruid FK
        time from_time
        time to_time
        varchar items_id
        varchar client_id
        decimal work_hours
        varchar work_text
    }
    daily_report_lock {
        bigint id PK
        varchar bu_no
        varchar user_id FK
        varchar YYYY_MM
        tinyint locked
        varchar locked_by
        datetime locked_time
    }
    daily_report_audit_log {
        bigint id PK
        varchar action
        varchar operator_id FK
        varchar owner_id
        varchar ip
        json old_value
        json new_value
        datetime create_time
    }
    daily_report_target {
        bigint id PK
        varchar bu_no
        varchar user_id FK
        varchar YYYY_MM
        decimal target_hours
        int delay_limit
        int unresolved_limit
        decimal work_ratio_min
    }
```

---

### 3.2 预警与预测模块（M3）

```mermaid
erDiagram
    alert_rule ||--o{ alert_log : "1:N 触发记录"
    alert_rule }o--|| cams_xuser : "责任人"
    alert_log }o--|| cams_xuser : "被告警人"
    cams_xuser ||--o{ daily_report_forecast_log : "预测记录"

    alert_rule {
        int uid PK
        varchar alert_domain
        varchar rule_code
        varchar rule_name
        decimal threshold
        int cooldown_hours
        tinyint enabled
    }
    alert_log {
        bigint id PK
        varchar bu_no
        varchar user_id FK
        varchar rule_code FK
        varchar alert_level
        varchar message
        tinyint is_read
        datetime create_time
    }
    daily_report_forecast_log {
        bigint id PK
        varchar bu_no
        varchar user_id FK
        varchar target_month
        varchar metric
        decimal forecast_value
        decimal lower_80
        decimal upper_80
        varchar risk_level
        varchar algo
    }
```

---

### 3.3 财务入账 / 报税 / 勾稽模块（RUID 全链路）

> `fin_ruid_ledger` 为全链路中樞，凭证、报税、勾稽均通过 RUID 回指主台账。

```mermaid
erDiagram
    fin_account_subject ||--o{ fin_voucher_entry : "科目被引用"
    fin_voucher ||--o{ fin_voucher_entry : "1:N 分录"
    fin_voucher ||--|| fin_ruid_ledger : "RUID 主台账"
    fin_tax_return ||--o{ fin_tax_return_item : "1:N 申报明细"
    fin_tax_return ||--|| fin_ruid_ledger : "RUID 主台账"
    fin_reconciliation }o--|| fin_voucher : "入账 RUID"
    fin_reconciliation }o--o| fin_tax_return : "报税 RUID"

    fin_ruid_ledger {
        varchar ruid PK
        varchar bu_no
        varchar biz_type
        varchar source_id
        decimal amount
        varchar remark
    }
    fin_voucher {
        bigint voucher_id PK
        varchar bu_no
        varchar ruid FK
        varchar voucher_no UK
        date voucher_date
        varchar YYYY_MM
        varchar summary
        decimal total_debit
        decimal total_credit
        varchar status
    }
    fin_voucher_entry {
        bigint entry_id PK
        bigint voucher_id FK
        varchar ruid FK
        varchar subject_code FK
        decimal debit
        decimal credit
        varchar summary
    }
    fin_tax_return {
        bigint return_id PK
        varchar bu_no
        varchar ruid FK
        varchar tax_type
        varchar tax_period
        decimal taxable_amount
        decimal tax_amount
        varchar status
        varchar receipt_no
    }
    fin_tax_return_item {
        bigint item_id PK
        bigint return_id FK
        varchar ruid FK
        varchar item_name
        decimal taxable_amount
        decimal tax_rate
        decimal tax_amount
    }
    fin_reconciliation {
        bigint recon_id PK
        varchar bu_no
        varchar period
        varchar voucher_ruid FK
        varchar tax_ruid FK
        decimal voucher_amount
        decimal tax_amount
        decimal diff_amount
        varchar match_status
        tinyint handled
    }
```

---

### 3.4 报税明细表模块（年度汇总 + CSV 导出）

> **模块性质**：只读聚合查询 + 前端导出，**不新增资料表**，复用 `fin_tax_return` 与 `fin_tax_return_item`。

#### 3.4.1 数据流

```mermaid
flowchart LR
    U["用户选 BU + 年度"] --> A["GET /api/finance/tax-detail<br/>?bu_no=HM&year=2025"]
    A --> SQL["SQL: fin_tax_return r<br/>LEFT JOIN fin_tax_return_item i<br/>ON i.return_id = r.return_id<br/>WHERE r.bu_no=? AND r.tax_period LIKE '2025-%'"]
    SQL --> AGG["后端聚合:<br/>• 按 return_id 去重算各税种应税/税额小计<br/>• 按 tax_type 汇总<br/>• 全年应税合计 / 全年税额合计"]
    AGG --> UI["前端弹窗:<br/>税种汇总卡片 + 明细表 9 列"]
    UI --> EXP["📥 导出 CSV<br/>(带 BOM, Excel 不乱码)"]
```

#### 3.4.2 SQL 关联口径（来自 routes/finance.js L251-318）

```sql
SELECT r.return_id, r.ruid, r.tax_type, r.tax_period, r.status,
       r.taxable_amount AS return_taxable, r.tax_amount   AS return_tax,
       r.receipt_no, r.filed_time,
       i.item_name, i.subject_code,
       i.taxable_amount AS item_taxable, i.tax_rate, i.tax_amount AS item_tax
FROM fin_tax_return r
LEFT JOIN fin_tax_return_item i ON i.return_id = r.return_id
WHERE r.bu_no = ? AND r.tax_period LIKE '2025-%'
ORDER BY r.tax_period, r.return_id, i.item_id;
```

| 关联项 | 说明 |
|---|---|
| 主表 | `fin_tax_return`（r）— 每笔申报 1 行 |
| 子表 | `fin_tax_return_item`（i）— 每笔申报 N 条明细 |
| JOIN 键 | `i.return_id = r.return_id`（LEFT JOIN，无明细的申报也保留） |
| 期间过滤 | `r.tax_period LIKE '{year}-%'`（精确到年） |
| 排序 | 期间 → return_id → item_id |

#### 3.4.3 字段级数据字典（API 返回结构）

**顶层返回对象**：

| 字段 | 类型 | 来源 | 说明 |
|---|---|---|---|
| `bu_no` | string | 请求参数 | 公司别 |
| `year` | string | 请求参数 | 年度（如 2025） |
| `generated_at` | string(ISO) | 后端 `new Date()` | 生成时间戳 |
| `return_count` | int | `returnsMap.size` | 该年度申报表笔数（去重） |
| `item_count` | int | `details.length` | 明细行数 |
| `summary.by_type` | object | 按 `tax_type` 聚合 | 各税种小计 |
| `summary.total_taxable` | decimal | Σ return_taxable（按 return_id 去重） | 全年应税合计 |
| `summary.total_tax` | decimal | Σ return_tax（按 return_id 去重） | 全年税额合计 |

**`summary.by_type.{tax_type}` 子对象**：

| 字段 | 类型 | 计算方式 | 说明 |
|---|---|---|---|
| `tax_name` | string | 映射表 `{VAT:'增值税', IT:'企业所得税', ST:'印花税'}` | 税种中文名 |
| `taxable` | decimal | Σ `fin_tax_return.taxable_amount`（同税种） | 该税种应税合计 |
| `tax` | decimal | Σ `fin_tax_return.tax_amount`（同税种） | 该税种税额合计 |
| `count` | int | 该税种申报表行数 | 笔数 |

**`details[]` 数组元素**（每行对应一条 `fin_tax_return_item`，无明细时用主表值兜底）：

| 字段 | 类型 | 取值来源 | 说明 |
|---|---|---|---|
| `return_id` | bigint | `r.return_id` | 申报表主键 |
| `ruid` | varchar | `r.ruid` | 报税 RUID（关联 fin_ruid_ledger） |
| `tax_type` | varchar | `r.tax_type` | 税种代码 VAT/IT/ST |
| `tax_name` | string | 映射表 | 税种中文名 |
| `tax_period` | varchar | `r.tax_period` | 课税期间（如 2025-01） |
| `status` | varchar | `r.status` | CALCULATED/APPROVED/FILED |
| `receipt_no` | varchar | `r.receipt_no` | 税务回执号（FILED 后有值） |
| `filed_time` | datetime | `r.filed_time` | 申报时间 |
| `subject_code` | varchar | `i.subject_code` | 明细科目代码（可空） |
| `item_name` | varchar | `i.item_name` | 明细项目名 |
| `taxable_amount` | decimal | `COALESCE(i.taxable_amount, r.taxable_amount, 0)` | 应税金额（明细优先，无明细取主表） |
| `tax_rate` | decimal | `i.tax_rate` | 税率（如 0.13） |
| `tax_amount` | decimal | `COALESCE(i.tax_amount, r.tax_amount, 0)` | 税额（明细优先） |

**⚠️ 关键计算规则**（避免多明细行重复计算全年合计）：
- 全年应税/税额合计 = 按 `return_id` 去重后再 Σ，**不是**直接 SUM 所有明细行（一张申报若有 N 条明细，直接 SUM 会重复 N 次主表金额）。
- 实现：用 `Map<return_id, {taxable, tax, type}>` 去重后再聚合。

#### 3.4.4 页面字段映射表（弹窗明细表 9 列）

| 页面列 | 对应 API 字段 | 显示格式 |
|---|---|---|
| 期间 | `tax_period` | 原值（2025-01） |
| 税种 | `tax_name` | 中文名 |
| 项目 | `item_name` | 空值显示 `—` |
| RUID | `ruid` | 11px 灰色字体 |
| 应税金额 | `taxable_amount` | `UI.fmt(x, 2)` 右对齐 |
| 税率 | `tax_rate` | `(rate×100).toFixed(2) + '%'` 右对齐 |
| 税额 | `tax_amount` | `UI.fmt(x, 2)` 右对齐，加粗 |
| 状态 | `status` | 彩色徽章（FILED 绿/CALCULATED 蓝/APPROVED 橙） |
| 回执号 | `receipt_no` | 空值显示 `—` |

#### 3.4.5 CSV 导出格式

| 项目 | 内容 |
|---|---|
| 文件名 | `报税明细表_{bu_no}_{year}.csv`（如 `报税明细表_HM_2025.csv`） |
| 编码 | UTF-8 + BOM（`\uFEFF`），Excel 打开不乱码 |
| 换行 | `\r\n`（Windows 兼容） |
| 转义 | 含逗号/引号/换行的字段用双引号包裹，内部引号转义为 `""` |
| 内容结构 | 标题行 → 生成时间 → 空行 → 表头（9 列）→ 全部明细行 → 空行 → 各税种小计 → 全年合计 |

---

### 3.5 现金流模块

```mermaid
erDiagram
    mgm_casher_details ||--o| mgm_cash_safe_level : "BU 安全水位"

    mgm_casher_details {
        bigint uid PK
        varchar bu_no
        date vdate
        varchar num_vman
        varchar DB_CR
        decimal sub_amt
        varchar acct_hint
    }
    mgm_cash_safe_level {
        varchar bu_no PK
        decimal safe_amount
        varchar set_by
        datetime set_time
        varchar remark
    }
```

---

### 3.6 预算 / 管理会计 / 合并模块

```mermaid
erDiagram
    budget ||--o{ budget_detail : "1:N 预算明细"
    mgmt_dept ||--o{ mgmt_dept_pl : "1:N 部门损益"

    budget {
        bigint id PK
        varchar bu_no
        varchar YYYY_MM
        varchar version
    }
    budget_detail {
        bigint id PK
        bigint budget_id FK
        varchar account_name
        decimal budget_amt
        decimal actual_amt
    }
    mgmt_dept {
        int id PK
        varchar bu_no
        varchar dept_code
        varchar dept_name
        varchar dept_type
        varchar manager
    }
    mgmt_dept_pl {
        bigint id PK
        varchar bu_no
        varchar dept_code FK
        varchar YYYY_MM
        decimal revenue_amt
        decimal cost_amt
        decimal profit_amt
    }
```

---

### 3.7 业务单据模块（PO/SO/DN）

```mermaid
erDiagram
    ermm_erp_so ||--o{ ERMM_erp_so_DN : "1:N 送货单"
    ermm_erp_so ||--o{ ermm_arap_detail : "产生应收"
    ermm_erp_po ||--o{ ermm_arap_detail : "产生应付"

    ermm_erp_so {
        bigint id PK
        varchar bu_no
        varchar so_no
        date so_date
        varchar YYYY_MM
        decimal so_qty
        decimal unit_price
    }
    ermm_erp_po {
        bigint id PK
        varchar bu_no
        varchar po_no
        date po_date
        decimal po_qty
        decimal unit_price
    }
    ermm_arap_detail {
        bigint uid PK
        varchar bu_no
        varchar YYYY_MM
        varchar ar_ap
        decimal ar_amt
        decimal ap_amt
    }
```

---

### 3.8 批次管线模块（7 步 ERP 数据加工 · PO→库存→AR/AP→财务摘要）

> **模块性质**：跨表批次加工管线，将 PO 暂存 → 正式 PO → 汇率换算 → 供应商汇总 → 库存减值 → AR/AP 汇算 → 财务摘要，共 7 步串联执行。支持「🚀 执行全部步骤」一键跑完或「逐步进行」逐步推进；内置「📖 操作说明」弹窗展示每步目的与要点。

#### 3.8.1 涉及资料表

| 步骤 | 说明 | 输入表 | 输出表 |
|---|---|---|---|
| Step 1 | PO 暂存 → 正式 PO | `ermm_temp_po` | `ermm_erp_po` |
| Step 2 | PO 本币金额换算 | `ermm_erp_po` + 系统码表汇率 | `ermm_erp_po`（更新本币字段） |
| Step 3 | 供应商采购汇总 | `ermm_erp_po` | 前 20 大供应商统计 |
| Step 4 | 物料法规绑定（简化版跳过） | — | — |
| Step 5 | 库存价值结算与呆滞减值 | `e2_xitems_daily_status` | `e2_xitems_daily_status`（更新减值率/现值） |
| Step 6 | 应收/应付账款汇算 | `ermm_erp_so` + `ermm_erp_po` + 发票备援 | `ermm_arap_detail` |
| Step 7 | 财务摘要重算 | `ermm_arap_detail` + 收支汇总 | `mgm_finance_summary` |

#### 3.8.2 管线数据流

```mermaid
flowchart LR
    subgraph STAGE1["Step 1-2 PO 加工"]
        TEMP["ermm_temp_po<br/>PO 暂存"] -->|"Step1: UPSERT"| PO["ermm_erp_po<br/>正式采购"]
        PO -->|"Step2: 汇率换算"| PO2["ermm_erp_po<br/>含本币金额"]
    end

    subgraph STAGE2["Step 3-5 汇总与减值"]
        PO2 -->|"Step3: 供应商汇总"| SUP["Top20 供应商采购统计"]
        INV["e2_xitems_daily_status<br/>库存"] -->|"Step5: 呆滞减值"| INV2["库存现值+减值损失"]
    end

    subgraph STAGE3["Step 6-7 AR/AP 与摘要"]
        SO["ermm_erp_so<br/>销售订单"] -->|"Step6: AR/AP 汇算"| ARAP["ermm_arap_detail"]
        PO2 -->|"Step6: AP"| ARAP
        ARAP -->|"Step7: 财务摘要重算"| FS["mgm_finance_summary"]
    end

    style STAGE1 fill:#e3f2fd,stroke:#1976d2
    style STAGE2 fill:#e8f5e9,stroke:#388e3c
    style STAGE3 fill:#fce4ec,stroke:#c2185b
```

#### 3.8.3 API 端点（routes/batch.js）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/batch/step1` | PO 暂存 → 正式 PO |
| POST | `/api/batch/step2` | PO 汇率换算 |
| POST | `/api/batch/step3` | 供应商采购汇总 |
| POST | `/api/batch/step4` | 物料法规绑定（跳过） |
| POST | `/api/batch/step5` | 库存减值 |
| POST | `/api/batch/step6` | AR/AP 汇算 |
| POST | `/api/batch/step7` | 财务摘要重算 |

#### 3.8.4 前端增强

| 功能 | 实现 |
|---|---|
| **逐步进行** | `_currentStep` 计数器，每次成功执行后自增，按钮文字动态显示「逐步进行 (Step N)」，7 步完成后变为 ✅ 并禁用 |
| **🚀 执行全部** | `runAllBatch()` 循环 1→7，任一步失败则中断并提示 |
| **📖 操作说明** | `BatchHelp.open()` 弹窗，表格展示 7 个步骤的「操作目的」+「功能要点」，三语 i18n |
| **执行日志** | 深色终端风格面板，实时输出每步结果（成功绿 / 失败红 / 警告黄） |
| **步骤状态** | 圆形徽章（pending 灰 / active 蓝 / done 绿 / error 红） |

#### 3.8.5 关键技术要点

| 要点 | 说明 |
|---|---|
| **UPSERT 幂等** | Step 1 用 `ON DUPLICATE KEY UPDATE`，同 PO 单号重跑会更新单价/金额/税额 |
| **汇率来源** | Step 2 读取系统码表 `cams_system_codes` CURRENCY 类别，支持多币种 |
| **减值分级** | Step 5 按库龄天数套用 AGEING_STOCK 减值率（31/91/181/365 天分级） |
| **AR/AP 备援** | Step 6 主路径从 SO 出货/PO 交付汇算，无资料时改从发票 `mgm_invoice_details` 推算 |
| **前端状态记忆** | 页面加载时重置 `_currentStep=1`，执行全部完成后设为 8，切换页面重新进入会重置 |

---

### 3.9 第三方资料整合模块（Excel 导入 / SQL 直连 · Online + Batch）

> **模块性质**：支持从 Excel 文件导入或 SQL 直连第三方数据库，将资料写入本地任意目标表；支持 Online 即时执行与 Batch 排程自动执行。前端为 **5 Tab 操作台**（Excel 导入 / SQL 线上整合 / 批次作业 / 数据源 / 执行日志，三语），支持按目标表动态生成 Excel 模板、日志筛选与 CSV 导出、失败作业一键重试。引擎统一走 `services/dataIntegrator.js`，核心包含栏位白名单、类型转换、UPSERT（先查存在键→拆分 INSERT/UPDATE）。

#### 3.9.1 资料表 ER 图

```mermaid
erDiagram
    intg_source ||--o{ intg_job : "1:N 整合作业"
    intg_job ||--o{ intg_log : "1:N 执行日志"
    intg_job }o--o| intg_source : "SQL 通道数据源"

    intg_source {
        int id PK
        varchar name UK
        varchar db_type
        varchar host
        int port
        varchar db_name
        varchar db_user
        varchar db_password
        varchar charset
        tinyint enabled
        varchar remark
    }
    intg_job {
        int id PK
        varchar name
        varchar channel
        int source_id FK
        mediumtext source_sql
        varchar target_table
        json column_mapping
        varchar key_columns
        varchar write_mode
        varchar mode
        varchar schedule
        tinyint enabled
        datetime last_run_at
        varchar last_status
    }
    intg_log {
        bigint id PK
        int job_id FK
        varchar job_name
        varchar channel
        varchar run_type
        varchar source_name
        varchar target_table
        varchar file_name
        int total_rows
        int insert_rows
        int update_rows
        int error_rows
        varchar status
        mediumtext error_msg
        varchar triggered_by
        datetime started_at
        datetime finished_at
        int duration_ms
    }
```

#### 3.9.2 整合引擎数据流

```mermaid
flowchart TB
    subgraph SRC["数据来源（双通道）"]
        EXCEL["📊 Excel 文件<br/>前端上传 base64<br/>后端 ExcelJS 解析"]
        SQLDB["🗄️ 第三方数据库<br/>SQL 直连查询<br/>(仅 SELECT)"]
    end

    subgraph ENGINE["整合引擎 services/dataIntegrator.js"]
        MAP["栏位映射<br/>同名自动 / 手动下拉"]
        WHITE["栏位白名单<br/>information_schema.COLUMNS"]
        COERCE["类型转换<br/>日期/数字/JSON/字串"]
        UPSERT["UPSERT 写入<br/>先查存在键 → 拆分 INSERT/UPDATE"]
    end

    subgraph TGT["本地目标表"]
        LOCAL["任意本地表<br/>(ermm_db 内)"]
    end

    subgraph LOG["执行日志"]
        INTGLOG["intg_log<br/>读取/新增/更新/失败/耗时"]
    end

    EXCEL --> MAP
    SQLDB --> MAP
    MAP --> WHITE --> COERCE --> UPSERT --> LOCAL
    UPSERT --> INTGLOG

    subgraph TRIG["触发方式"]
        ONLINE["Online 手动执行<br/>POST /jobs/:id/run"]
        BATCH["Batch 排程执行<br/>setInterval 分钟级<br/>daily HH:MM / every Nm"]
    end

    ONLINE --> ENGINE
    BATCH --> ENGINE

    style SRC fill:#e3f2fd,stroke:#1976d2
    style ENGINE fill:#e8f5e9,stroke:#388e3c
    style TGT fill:#f3e5f5,stroke:#7b1fa2
    style LOG fill:#fff3e0,stroke:#f57c00
    style TRIG fill:#fce4ec,stroke:#c2185b
```

#### 3.9.3 API 端点清单（routes/integration.js）

| 分组 | 方法 | 路径 | 说明 |
|---|---|---|---|
| 本地表结构 | GET | `/api/integration/tables` | 列出本地所有表 |
| 本地表结构 | GET | `/api/integration/tables/:name/columns` | 查询指定表的栏位定义 |
| 本地表结构 | GET | `/api/integration/tables/:name/keys` | 查询唯一键（UPSERT 预设匹配键） |
| 模板 | GET | `/api/integration/templates` | 下载全表 Excel 导入模板 |
| 模板 | GET | `/api/integration/templates/:table` | 按目标表下载模板（优先总模板对应 Sheet，否则按栏位动态生成） |
| 数据源 | GET | `/api/integration/sources` | 列出所有第三方数据源 |
| 数据源 | POST | `/api/integration/sources` | 新建数据源连线 |
| 数据源 | PUT | `/api/integration/sources/:id` | 更新数据源 |
| 数据源 | DELETE | `/api/integration/sources/:id` | 删除数据源（含关闭连线池） |
| 数据源 | POST | `/api/integration/sources/:id/test` | 测试已存数据源连线 |
| 数据源 | POST | `/api/integration/sources-test` | 测试未存数据源连线（预检） |
| 数据源 | POST | `/api/integration/sources/query` | SQL 预览（前 100 行） |
| 作业 | GET | `/api/integration/jobs` | 列出所有整合作业 |
| 作业 | POST | `/api/integration/jobs` | 新建作业 |
| 作业 | PUT | `/api/integration/jobs/:id` | 更新作业 |
| 作业 | DELETE | `/api/integration/jobs/:id` | 删除作业 |
| 作业 | POST | `/api/integration/jobs/:id/run` | 立即执行作业（Online；失败作业一键重试复用此端点） |
| Excel | POST | `/api/integration/excel/parse` | Excel base64 解析（预览前 5 行 + total_rows） |
| Excel | POST | `/api/integration/excel/import` | Excel 导入写入本地表 |
| 日志 | GET | `/api/integration/logs` | 查询执行日志（`status` / `channel` / `job_id` / `limit` 筛选；前端支持导出 CSV） |

#### 3.9.4 前端 5 Tab 页面结构

| Tab | 标题 | 功能 |
|---|---|---|
| 1 | 📊 Excel 导入 | 选目标表 → 下载表头模板（全表 / 本表动态生成）→ 上传 .xlsx（≤20MB）→ 解析 Sheet → 栏位映射（同名自动匹配）→ 预览 → INSERT / UPSERT 写入 |
| 2 | 🔌 SQL 线上整合 | 选数据源 → 输入单条 SELECT → 测试读取（强制 LIMIT，前端默认 50 行）→ 栏位映射 → 立即执行 / 存为批次作业 |
| 3 | ⏰ 批次作业 | 作业列表 → 启用/停用 → 编辑 → 立即执行 → 失败作业一键重试 |
| 4 | 🗄️ 数据源 | 数据源 CRUD → 连线测试 → 删除时释放连接池 |
| 5 | 📜 执行日志 | 最近 100 条 → 按状态 / 通道筛选 → 导出 CSV（UTF-8 BOM） |

#### 3.9.5 关键技术要点

| 要点 | 说明 |
|---|---|
| **Excel 模板** | `/templates/:table` 优先从总模板抽出对应 Sheet；无对应 Sheet 时按 `information_schema` 栏位动态生成 xlsx 表头 |
| **栏位白名单** | 从 `information_schema.COLUMNS` 读取目标表全部栏位，只允许映射到存在的栏（防注入） |
| **类型转换** | Excel serial 日期 → JS Date → 日期字串；千分位数字 → Number；空字串 → NULL；JSON 字串 → 对象 |
| **UPSERT 策略** | 统一走「先 SELECT 已存在键 → 拆分 INSERT / UPDATE」，避免 MySQL `ON DUPLICATE KEY` 的 affectedRows 在「值未变」时为 0 导致统计偏差 |
| **SQL 安全** | 仅允许单 SELECT（正则校验 `^\s*select`）、禁多语句（`/;\s*\S/`）、包成子查询加 LIMIT |
| **批次大小** | BATCH_SIZE=200，大批量资料分批写入 |
| **排程器** | 零依赖分钟级 `setInterval`，支持 `daily HH:MM` / `every Nm`，防重入（`ticking` 标志 + `runningJobs` Set） + 防重复触发（`firedKeys` Set） |
| **连接池缓存** | 第三方连接池按 `sourceId` 缓存于 `sourcePools` Map，复用连线避免反复握手 |

---

### 3.10 电子化报税模块（VAT / CIT / IIT）

> **模块性质**：企业三大税种电子化申报，统一走 `/api/tax` 路由。支持增值税（按月/按季）、企业所得税年度汇算、个人所得税代扣代缴（含年终奖单独计税）。

#### 3.10.1 资料表 ER 图

```mermaid
erDiagram
    mgm_invoice_details ||--o{ vat_declarations : "销项/进项取数"
    mgm_finance_summary ||--o{ cit_annual_settlements : "年度收入成本取数"
    mgm_finance_summary ||--o{ iit_withholding_batches : "薪资估算取数"
    payroll_details ||--o{ iit_withholding_details : "优先真实薪资"
    bonus_details ||--o{ iit_withholding_details : "年终奖单独计税"
    tax_cit_inputs ||--o{ cit_annual_settlements : "税率/预缴/覆盖"
    tax_cit_adjustments ||--o{ cit_annual_settlements : "逐笔调增调减"
    tax_vat_adjustments ||--o{ vat_declarations : "进项转出/留抵覆盖"
    vat_declarations ||--o{ tax_submit_receipts : "提交落库"
    cit_annual_settlements ||--o{ tax_submit_receipts : "提交落库"
    iit_withholding_batches ||--o{ tax_submit_receipts : "提交落库"
    iit_withholding_batches ||--o{ iit_withholding_details : "1:N 员工明细"

    vat_declarations {
        varchar declaration_id PK
        varchar bu_no
        varchar tax_period
        varchar filing_cycle
        date period_start
        date period_end
        int taxpayer_type
        decimal total_sales_amt
        decimal total_output_tax
        decimal total_input_tax
        decimal prev_credit
        decimal current_credit
        tinyint tax_exempt
        decimal tax_payable
        varchar status
        varchar operator_id
    }
    cit_annual_settlements {
        varchar settlement_id PK
        varchar bu_no
        varchar tax_year
        decimal total_revenue
        decimal total_cost
        decimal tax_free_income
        decimal tax_adjust_increase
        decimal tax_adjust_decrease
        decimal taxable_income
        decimal tax_rate
        decimal tax_payable
        decimal accum_prepaid_tax
        decimal withheld_tax
        decimal refund_or_supplement
        tinyint is_overridden
        varchar status
    }
    iit_withholding_batches {
        varchar batch_id PK
        varchar bu_no
        varchar tax_period
        varchar income_type
        varchar bonus_mode
        int total_employees
        decimal total_withheld_tax
        varchar status
    }
    iit_withholding_details {
        bigint id PK
        varchar batch_id FK
        varchar employee_id
        decimal cumulative_income
        decimal cumulative_deduction
        decimal taxable_income
        decimal applicable_tax_rate
        decimal quick_deduction
        decimal current_period_tax
        decimal bonus_amount
        decimal bonus_tax
        varchar bonus_method
    }
    tax_submit_receipts {
        bigint id PK
        varchar module
        varchar biz_id
        varchar tax_bureau_receipt_no
        datetime submit_time
        varchar status
        date payment_deadline
        varchar operator_id
        json raw_response
    }
    tax_vat_adjustments {
        bigint id PK
        varchar bu_no
        varchar tax_period
        varchar filing_cycle
        decimal input_tax_transfer_out
        decimal prev_credit_override
        varchar remark
    }
    tax_cit_inputs {
        bigint id PK
        varchar bu_no
        varchar tax_year
        decimal tax_rate
        decimal accum_prepaid_tax
        decimal withheld_tax
        decimal revenue_override
        decimal cost_override
        varchar override_reason
    }
    tax_cit_adjustments {
        bigint id PK
        varchar bu_no
        varchar tax_year
        varchar adj_type
        decimal amount
        varchar remark
    }
    payroll_details {
        bigint id PK
        varchar bu_no
        varchar tax_period
        varchar employee_id
        varchar employee_name
        decimal gross_salary
        decimal social_insurance
        decimal special_additional
        decimal other_deduction
    }
    bonus_details {
        bigint id PK
        varchar bu_no
        varchar tax_year
        varchar employee_id
        varchar employee_name
        decimal bonus_amount
        varchar tax_method
        varchar remark
    }
```

#### 3.10.2 核心计算规则

| 税种 | 规则编号 | 公式 | 取数来源 |
|---|---|---|---|
| **VAT 一般纳税人按月** | VAT_R02 | 应纳税 = 销项 − 进项(抵扣后) − 上期留抵 | `mgm_invoice_details` 按月汇总 |
| **VAT 小规模按季** | VAT_R01 | 应纳税 = Σ(三个月销售额) × 3% | `mgm_invoice_details` 按季展开 |
| **VAT 免征** | — | 季销售额 ≤ 300,000 且为小规模 → 免税 | 代码常量 |
| **CIT** | CIT_R01 | 应纳税所得额 = 收入 − 成本 − 免税 + 调增 − 调减 | `mgm_finance_summary` 年度汇总，支持 `tax_cit_inputs` 覆盖 |
| **IIT 工资薪金** | IIT_R01 | 累计预扣：累计应纳税所得额 × 税率 − 速算扣除 − 已预扣 | 优先 `payroll_details`，无则 `mgm_finance_summary` 平均工资估算 |
| **IIT 年终奖单独计税** | BONUS_SEP | 奖金 ÷ 12 找月度税率 → 奖金 × 税率 − 速算扣除 | `bonus_details` |
| **IIT 年终奖合并计税** | BONUS_COM | 加入年度累计后重算 → 边际税额 | `bonus_details` + `payroll_details` |

#### 3.10.3 API 端点清单（routes/tax.js）

| 分组 | 方法 | 路径 | 说明 |
|---|---|---|---|
| VAT | POST | `/api/tax/vat/calculate` | 增值税算税（支持按月/按季） |
| VAT | POST | `/api/tax/vat/:id/submit` | 增值税申报提交 |
| CIT | POST | `/api/tax/cit/calculate` | 企业所得税年度汇算 |
| CIT | POST | `/api/tax/cit/submit` | 企业所得税提交 |
| IIT | POST | `/api/tax/iit/calculate` | 个人所得税月度扣缴算税 |
| IIT | POST | `/api/tax/iit/submit` | 个人所得税扣缴提交 |
| IIT | POST | `/api/tax/iit/bonus/calculate` | 年终奖单独计税试算 |
| 录入 | GET/PUT | `/api/tax/inputs/cit` | CIT 参数（税率/预缴/覆盖） |
| 录入 | GET/PUT | `/api/tax/inputs/vat` | VAT 调整（进项转出/留抵） |
| 录入 | GET/POST/DELETE | `/api/tax/inputs/payroll` | 薪资及个税扣除 |
| 录入 | GET/POST/DELETE | `/api/tax/inputs/bonus` | 年终奖录入 |
| 勾对 | GET | `/api/tax/invoice-check` | 发票勾对清单 |

#### 3.10.4 前端页面结构（public/js/pages/tax.js）

| Tab | 标题 | 功能 |
|---|---|---|
| 1 | 增值税申报 | 选周期(月/季) → 选纳税人类型 → 算税 → 核对计算式 → 提交 |
| 2 | 企业所得税汇算 | 选年度 → 算税 → 显示收入/成本/调整/应补退 → 提交 |
| 3 | 个人所得税扣缴 | 选期间/所得类型 → 算税 → 显示员工明细 → 提交 |
| 4 | 基础资料录入 | ① VAT 调整 ② CIT 参数（含收入/成本覆盖）③ 薪资录入 ④ 年终奖录入 |

---

### 3.11 智能化模块（AI 层 · RAG / 摘要 / 催收 / 质检 / 概率预测）

> **模块性质**：**只读分析层**。自有表仅 3 张（`ermm_knowledge`、`ermm_kb_miss_log`、`daily_ai_summary`），复用 `llm_config` 与 `ermm_ai_records`；其余分析数据全部从既有业务表**只读取数**，不回写账务。
> 设计原则：轻量 RAG（MySQL FULLTEXT + n-gram 关键词），**不引入向量数据库与 LLM 编排框架**。

#### 3.11.1 资料表 ER 图

```mermaid
erDiagram
    ermm_knowledge ||--o{ ermm_kb_miss_log : "未命中时记录 query"
    llm_config ||--o{ daily_ai_summary : "provider/model"
    llm_config ||--o{ ermm_ai_records : "对话模型"
    mgm_finance_summary ||--o{ daily_ai_summary : "取数(只读)"

    ermm_knowledge {
        int uid PK
        varchar title
        text content
        varchar category "tax/budget/annual/policy/benchmark/other"
        varchar bu_no "HM/SZ/HN/ALL"
        varchar year
        varchar YYYY_MM
        varchar source
        varchar tags
        int importance "1-5 检索加权"
        tinyint is_active
        datetime create_time
    }

    ermm_kb_miss_log {
        int uid PK
        varchar query "原始查询"
        varchar bu_no
        tinyint use_llm
        int hit_count
        varchar search_words "n-gram + split 切词"
        varchar lang
        varchar session_id
        varchar client_ip
        varchar user_id
        datetime created_at
    }

    daily_ai_summary {
        int uid PK
        date summary_date
        datetime generated_time
        varchar period_label
        varchar source_modules
        varchar trigger_type "auto/manual/api"
        varchar provider
        varchar model
        json data_json "财务快照+YoY+现金水位+风险"
        varchar title
        text content
        json alerts_json
        json actions_json
        varchar xuser_id
    }

    llm_config {
        int uid PK
        varchar provider "deepseek/kimi"
        varchar provider_name
        text api_key
        varchar base_url
        varchar model
        varchar status "USE/STOP"
        tinyint is_default "1=预设使用"
    }
```

#### 3.11.2 迁移脚本

| 脚本 | 内容 |
|---|---|
| `013_industry_benchmark.sql` | 同业标杆表 `industry_benchmark`（benchmark 类知识取数源） |
| `014_llm_is_default.sql` | `llm_config` 新增 `is_default` + `provider` 字段放开硬编码 |
| `015_ermm_knowledge.sql` | 建 `ermm_knowledge` + 12 条种子知识 |
| `016_ermm_knowledge_expand.sql` | 知识库扩充（政策 / 税务 / 数据字典） |
| `017_daily_ai_summary.sql` | 建 `daily_ai_summary`（每日 AI 摘要） |
| `018_ermm_knowledge_expand_2.sql` | 知识库二次扩充（累计 41 条 / 6 分类） |
| `019_kb_miss_log.sql` | 建 `ermm_kb_miss_log`（RAG 未命中日志，驱动 KB 扩充） |

#### 3.11.3 API 端点清单

| 功能 | 方法 | 端点 | 说明 |
|---|---|---|---|
| AI 问答 | POST | `/api/aiqa/ask` | 提问 → 检索 → LLM → 回答 + 引用 |
| 建议问题 | GET | `/api/aiqa/suggestions` | 按当期数据动态生成 |
| 知识库查看 | GET | `/api/aiqa/knowledge` | 列出 `ermm_knowledge` 条目 |
| 会话记录 | GET | `/api/aiqa/records` | 历史会话列表 |
| 单会话 | GET | `/api/aiqa/conversation/:convId` | 多轮上下文 |
| 生成摘要 | POST | `/api/daily-summary/generate` | 聚合取数 → LLM → 落库 |
| 最新摘要 | GET | `/api/daily-summary/latest` | 仪表板卡片取数 |
| 摘要历史 | GET | `/api/daily-summary/history` | 按日期回看 |
| 摘要聚合 | GET | `/api/daily-summary/aggregate` | 结构化快照 |
| AR 催收清单 | GET | `/api/ar-smart/collections` | 评分排序后的明细 |
| 催收概览 | GET | `/api/ar-smart/overview` | 单公司分级汇总 |
| 三公司概览 | GET | `/api/ar-smart/overview-all` | HM/SZ/HN |
| 质量扫描 | GET | `/api/data-quality/scan` | 7 大类体检（约 39ms） |
| 表健康度 | GET | `/api/data-quality/health` | 8 张核心表 |
| 概率预测 | GET | `/api/cash-forecast/monte-carlo` | 5000 次模拟 |
| LLM 服务商 | GET | `/api/llm/providers` | 列出 `llm_config`（含预设） |

#### 3.11.4 核心规则

| 功能 | 规则 |
|---|---|
| **RAG 检索** | 查询切分为 n-gram 2~4 滑窗 + 停用词过滤 → `LIKE` **OR 聚合**（任意命中即可）→ 分类加权：tax×1.5 / data_dict×1.3 / policy×1.2 / benchmark×1.0 / annual×0.8 → Top-K 拼上下文；召回为 0 时写 `ermm_kb_miss_log` |
| **知识库规模** | 41 条 / 6 分类（annual 10 · policy 18 · tax 6 · benchmark 3 · data_dict 4） |
| **AR 评分** | `Score = 账龄天数×40 + 逾期天数×30 + 金额规模×15 + 风险综合×10 + 单笔占比×5`；数据源 `mgm_invoice_details WHERE TX_type='AR'`；≥70 紧急 / 50~70 高优先 / 30~50 常规 / <30 正常 |
| **数据质检** | finance_summary 6 项 · invoice 5 项 · bank_loan 3 项 · cash 1 项 · forecast 2 项 · reconcile 1 项 · 表健康度 8 张表；红=高风险、黄=提示 |
| **概率预测** | 13 周 × 5000 次抽样（按历史收付波动），输出 P10/P50/P90 区间与负现金概率 |
| **LLM 选型** | 统一走 `utils/llmClient.js → getDefaultProvider(pool)`，读 `llm_config` 中 `is_default=1 AND status='USE'` 的记录（当前为 DeepSeek） |

#### 3.11.5 权限与安全

| 项 | 说明 |
|---|---|
| 接口鉴权 | 全部 `/api/*` 经 `authRequired` 中间件校验 JWT |
| 只读性 | 智能层不 INSERT/UPDATE 账务表，仅写自己的知识库、摘要与日志表 |
| 系统文件菜单 | `/docs/architecture`、`/docs/data-model` 由前端 `openDocPage()` 校验 `admin='Yes'`，非管理员提示「你的权限不能使用这个模块功能」；静态文件本身未做服务端鉴权 |

---

## 四、RUID 全链路追溯图（财务核心）

```mermaid
flowchart LR
    A["📒 会计凭证<br/>fin_voucher"] -->|产生 RUID| R["🗂️ fin_ruid_ledger<br/>RUID 主台账"]
    A -->|分录| AE["fin_voucher_entry"]
    B["🧾 纳税申报<br/>fin_tax_return"] -->|产生 RUID| R
    B -->|明细| TI["fin_tax_return_item"]
    R -->|被勾稽引用| C["🔗 勾稽对账<br/>fin_reconciliation"]
    A -.->|voucher_ruid| C
    B -.->|tax_ruid| C

    style R fill:#ffeb3b,stroke:#f57f17,stroke-width:3px
    style A fill:#e3f2fd,stroke:#1976d2
    style B fill:#e8f5e9,stroke:#388e3c
    style C fill:#fce4ec,stroke:#c2185b
```

**追溯示例**：
- 已知报税回执号 `RXHM20250101` → 查 `fin_tax_return` 得 RUID → 查 `fin_ruid_ledger` 确认 → 查 `fin_reconciliation` 找到匹配的入账凭证 RUID → 查 `fin_voucher` + `fin_voucher_entry` 看到完整分录。

---

## 五、跨模块共用资料表

| 资料表 | 被哪些模块共用 |
|---|---|
| `cams_xuser` | 认证、用户、日报、预警、预测（几乎所有涉及"人"的模块） |
| `mgm_finance_summary` | 摘要、三大报表、风险、年度趋势、AI 问答、异常诊断、多维下钻、**电子化报税（CIT/IIT 取数）** |
| `mgm_casher_details` | 现金日记账、现金流量预测 |
| `ermm_erp_so` | 销售订单、应收应付、送货单、多维下钻、日报经营数据 |
| `ermm_erp_po` | 采购单、应收应付、PO 暂存、日报经营数据 |
| `mgm_invoice_details` | 发票、财务分析、多维下钻、日报经营数据、**仪表板下钻、电子化报税（VAT 取数）** |
| `budget_detail` | 预算编制、情景模拟、AI 问答 |
| `mgmt_dept_pl` | 管理会计、合并报表、AI 问答 |
| `mgmt_dept` | 管理会计、合并报表、日报部门维度 |
| `cams_system_codes` | **码表驱动**：公司切换（BUSINESS_ID）、下拉选项（WK_TYPE/USER_ROLE 等）、VAT/CIT 税率（TAX_TYPE）、汇率（CURRENCY）；服务端 `codeCache` 缓存 TTL 1 小时 |
| **任意本地表** | 第三方资料整合模块可通过栏位映射写入 `ermm_db` 内的任意目标表（按栏位白名单约束） |

---

## 六、技术栈汇总

| 层 | 技术 |
|---|---|
| 前端 | 原生 JavaScript SPA + Chart.js + 三语 i18n（简/繁/英） |
| 后端 | Node.js + Express 5 + mysql2（连接池） |
| 数据库 | MySQL 8 · `ermm_db` · utf8mb4 |
| 认证 | JWT（HS256）+ 权限分级中间件 |
| 排程 | node-cron（工作日 09:30/16:30 告警扫描，月末 16:00）+ setInterval 分钟级（第三方整合 Batch 作业） |
| 邮件 | nodemailer（告警通知） |
| Excel | ExcelJS（导入解析 + 导出 CSV 带 BOM） |
| AI | LLM API（aiqa / diagnosis 路由） |
| 税务 | 本地算税引擎（VAT/CIT/IIT）+ 模拟税局受理（`Submit.submit`） |
| 部署 | `node app.js`（端口 3008）/ 可 pm2 守护 |

---

## 七、资料表清单（共 85 张 · 2026-11-12 实测 `information_schema`）

> 85 张含 2 张第三方整合演示表 `intg_demo_src` / `intg_demo_tgt`，业务有效表 83 张。

| 模块域 | 表名 |
|---|---|
| **系统/基础** | cams_xuser, leader_user, login_user_record, cams_system_codes, cams_batch_control, schema_migrations, llm_config, ermm_users（遗留） |
| **日报绩效** | daily_report, daily_report_detail, daily_report_lock, daily_report_audit_log, daily_report_target, daily_report_okr, daily_report_okr_kr, daily_report_erp_xref, daily_report_mgmt_report, daily_report_annual_review |
| **预警预测** | alert_rule, alert_log, daily_report_forecast_log |
| **财务核心** | fin_ruid_ledger, fin_account_subject, fin_voucher, fin_voucher_entry, fin_tax_return, fin_tax_return_item, fin_reconciliation |
| **现金流** | mgm_casher_details, mgm_cash_safe_level |
| **财务核算** | mgm_account_details, mgm_invoice_details, pay_detail, check_detail, mgm_bank_loan_details, mgm_finance_summary, mgm_production_details, bh_mgm_tx_detail |
| **预算管会** | budget, budget_detail, mgmt_dept, mgmt_dept_pl |
| **业务单据** | ermm_erp_so, ermm_erp_po, ermm_temp_po, ermm_erp_so_dn, ermm_arap_detail, ermm_erp_documents, transit_price, mgm_preorder_lists, mgm_customer_projects, ermm_erp_mo, ermm_erp_mo_component, ermm_erp_routing, ermm_erp_work_report |
| **分析预测** | forecast_detail, monthly_items, mgm_bep_threshold, mgm_kpi_desc, ermm_scenario_saved |
| **第三方整合** | intg_source, intg_job, intg_log, intg_demo_src（演示）, intg_demo_tgt（演示） |
| **电子化报税** | vat_declarations, cit_annual_settlements, iit_withholding_batches, iit_withholding_details, tax_submit_receipts, tax_vat_adjustments, tax_cit_inputs, tax_cit_adjustments, payroll_details, bonus_details |
| **AI 智能层** | ermm_knowledge（41 条 / 6 分类）, ermm_kb_miss_log（RAG 未命中）, daily_ai_summary（每日摘要）, ermm_ai_records（对话）, industry_benchmark（同业标杆） |
| **其他** | e2_xitems_daily_status, e2_xitems_daily_status_chart, branch_detail, relation_detail, action_task |

> 备注：`ermm_erp_mo` / `ermm_erp_mo_component` / `ermm_erp_routing` / `ermm_erp_work_report` 为 ERP 工单/BOM/工艺/报工预留表，当前无业务数据；`ermm_users` 为旧表，登录与权限实际使用 `cams_xuser`。

---

## 八、数据覆盖状态（2026-10-24 更新）

### 8.1 账套 × 年份 覆盖矩阵

| 账套 | 2023 年 | 2024 年 | 2025 年 | 连续月数 |
|------|---------|---------|---------|---------|
| HM | ✅ 12 月 | ✅ 12 月 | ✅ 12 月 | 36 |
| SZ | ✅ 12 月 | ✅ 12 月 | ✅ 12 月 | 36 |
| HN | ✅ **12 月**（补齐后） | ✅ 12 月 | ✅ 12 月 | **36** |

### 8.2 2023 年销售成本明细对齐状态

| 账套 | 月份数 | 进项条数 | 金额合计 | 与销售成本吻合 |
|------|--------|---------|---------|--------------|
| HM | 12 | 60 | 56,602,982.00 | ✅ |
| SZ | 12 | 60 | 37,735,321.00 | ✅ |
| HN | 12 | 60 | 86,794,055.98 | ✅ |
| **合计** | **36** | **180** | **181,132,358.98** | **36/36 PASS** |

### 8.3 HN 2023 补齐摘要

- **补齐脚本**：[scripts/seed_hn_2023.js](file:///e:/finance/scripts/seed_hn_2023.js)（支持 `--dry-run` / `--apply` / `--rollback`）
- **验证脚本**：[scripts/verify_hn_2023.js](file:///e:/finance/scripts/verify_hn_2023.js)（12 月 × 7 项断言）
- **数据性质**：以 HN 2024 年同月为模板 ×0.9，保留季节性；非真实历史账
- **测试报告**：[docs/hn_2023_backfill_report_2026-10-23.md](file:///e:/finance/docs/hn_2023_backfill_report_2026-10-23.md)

---

> 本文件所有关系均来自代码事实（routes/*.js 的 SQL 语句、database/add_*.js 的 DDL、index.html 菜单），未作臆造。Mermaid 图可在 VS Code / GitHub 直接渲染。
> 2026-11-12 更新：① 路由模块数 48→**50**（新增 `/api/preorders`、`/api/codes`）；② 第三方整合补全 5 Tab（Excel 模板动态生成、唯一键查询、日志筛选/CSV 导出、失败重试）与 20 个 API 端点；③ 资料表清单 83→**85 张**（2026-11-12 实测，含 2 张整合演示表；补录 `mgm_preorder_lists` / `mgm_customer_projects` / `ermm_scenario_saved` / `ermm_erp_mo*` / `ermm_erp_routing` / `ermm_erp_work_report` / `ermm_users`）；④ 跨模块共用表新增 `cams_system_codes`（码表驱动下拉/公司/税率，缓存 TTL 1 小时）；⑤ 模块总表新增销售预估订单，情景模拟补充保存表。
> 2026-11-05 更新：① 新增 3.11 智能化模块（AI 层）：ermm_knowledge / ermm_kb_miss_log / daily_ai_summary / llm_config 四表 ER 图 + 7 个迁移脚本 + 16 个 API 端点 + 核心规则（RAG 检索加权 / AR 评分 / 7 类质检 / Monte Carlo）；② 模块总表新增 #44~#49（AR 智能催收 / 数据质量扫描 / 每日 AI 摘要 / 现金流概率预测 / 战情看板 / 系统文件）；③ 资料表清单 74→**83 张**（2026-11-05 实测 information_schema），新增 AI 智能层表域；④ 架构图更新为 48 个路由、50 个前端入口（8 个菜单分组）、数据层新增 AI 知识库与摘要表；⑤ 更新 #28 AI 问答为完整 RAG 取数链路。
> 2026-10-24 更新：① 新增电子化报税模块（3.10 节，含 VAT/CIT/IIT 三税种 + 10 张资料表 ER 图）；② 更新模块总表（42 个模块，新增 #43 电子化报税）；③ 更新资料表清单（80+ 张，新增税务申报表域）；④ 新增第八章「数据覆盖状态」（HN 2023 补齐后三账套 36 个月全对齐）；⑤ 更新架构图（服务层 42 个路由，数据层新增税务申报表与税务录入表）。
> 2026-10-15 更新：① 新增 3.8 批次管线模块（7 步 ERP 加工管线）含数据流 ER 图 + API + 前端增强说明；② 月份格式统一 YYYY/MM → YYYY-MM（SQL 示例 + 字段字典 + 页面映射表）；③ 修正章节编号重复（原两个 3.5）；④ 日记账收入/支出兼容中文「借/贷」判断（routes/cash.js）；⑤ 批次管线前端增强（逐步进行自动推进 + 操作说明弹窗）。
> 2026-10-09 更新：补充第三方资料整合模块（3.9 节 · intg_source / intg_job / intg_log）。
