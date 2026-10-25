# ERMM 系统架构图与相关联流程图

> 基于代码事实抽取（app.js / routes/*.js / services/*.js / scheduler/*.js / public/js/pages/*.js）
> 生成日期：2026-10-20 ｜ 更新日期：2026-10-24 ｜ 适用版本：v3.1（含财务模块 + 第三方整合 + 批次管线 + 电子化报税）

---

## 一、整体系统架构图

```mermaid
flowchart TB
    subgraph CLIENT["🖥️ 客户端层"]
        BROWSER["浏览器 SPA<br/>原生 JS + Chart.js + i18n 三语"]
        EXCEL_USER["Excel 文件<br/>(用户提供)"]
    end

    subgraph GATEWAY["🚪 接入层"]
        EXPRESS["Express 5 路由<br/>42 个路由模块"]
        AUTH["JWT 认证中间件<br/>authRequired"]
        PERM["权限分级<br/>员工/部门主管/高阶主管/管理员"]
    end

    subgraph SERVICE["⚙️ 业务服务层"]
        direction LR
        subgraph HR["绩效与人效"]
            S1["日报服务<br/>dailyReport"]
            S2["签核锁定<br/>dailyLock"]
            S3["审计日志<br/>auditLog"]
            S4["告警引擎<br/>drAlertScanner (5规则)"]
            S5["趋势预测<br/>forecast (WMA+LR)"]
        end
        subgraph FIN["财务核心"]
            S6["会计入账<br/>voucher + RUID"]
            S7["纳税申报<br/>taxReturn"]
            S8["勾稽对账<br/>reconciliation"]
            S9["报税明细表<br/>tax-detail + CSV"]
        end
        subgraph CASH["资金与现金"]
            S10["现金日记账<br/>cash"]
            S11["13周现金预测<br/>cashForecast"]
            S12["安全水位<br/>cashSafeLevel"]
        end
        subgraph ERP["ERP 批次"]
            S13["7步批次管线<br/>batch step1~7"]
            S14["PO暂存<br/>tempPo"]
        end
        subgraph INTG["第三方整合"]
            S15["整合引擎<br/>dataIntegrator<br/>(Excel/SQL 双通道)"]
            S16["批次排程器<br/>intgScheduler<br/>(daily/every Nm)"]
        end
        subgraph TAX["电子化报税"]
            S17["算税引擎<br/>taxService<br/>VAT/CIT/IIT"]
            S18["提交受理<br/>(本地模拟回执)"]
        end
    end

    subgraph DATA["🗄️ 数据层 (MySQL 8 · ermm_db · 74 表)"]
        DB_HR["daily_report*<br/>alert_* / forecast_log"]
        DB_FIN["fin_voucher / fin_tax_return<br/>fin_reconciliation<br/>fin_ruid_ledger"]
        DB_CASH["mgm_casher_details<br/>mgm_cash_safe_level"]
        DB_ERP["ermm_erp_po / ermm_erp_so<br/>ermm_temp_po / ermm_arap_detail<br/>e2_xitems_daily_status"]
        DB_INTG["intg_source<br/>intg_job / intg_log"]
        DB_TAX["vat_declarations<br/>cit_annual_settlements<br/>iit_withholding_*<br/>tax_submit_receipts<br/>tax_*_adjustments / tax_cit_inputs<br/>payroll_details / bonus_details"]
    end

    subgraph EXTERNAL["🌐 外部系统"]
        EXT_DB["第三方 MySQL 数据库"]
        EXT_MAIL["SMTP 邮件服务"]
    end

    BROWSER -->|HTTP/JWT| EXPRESS
    EXCEL_USER -->|上传 xlsx| EXPRESS
    EXPRESS --> AUTH --> PERM
    PERM --> HR & FIN & CASH & ERP & INTG & TAX

    S1 & S2 & S3 & S4 & S5 --> DB_HR
    S6 & S7 & S8 & S9 --> DB_FIN
    S10 & S11 & S12 --> DB_CASH
    S13 & S14 --> DB_ERP
    S15 & S16 --> DB_INTG
    S17 & S18 --> DB_TAX
    S17 -->|取数| DB_FIN
    S17 -->|取数| DB_ERP
    S15 -->|SQL 只读| EXT_DB
    S15 -->|UPSERT 写入| DATA
    S4 -->|告警通知| EXT_MAIL

    style CLIENT fill:#e3f2fd,stroke:#1976d2
    style GATEWAY fill:#fff3e0,stroke:#f57c00
    style SERVICE fill:#e8f5e9,stroke:#388e3c
    style DATA fill:#fce4ec,stroke:#c2185b
    style EXTERNAL fill:#f3e5f5,stroke:#7b1fa2
```

---

## 二、财务核心业务流程图（RUID 全链路）

```mermaid
flowchart LR
    subgraph STEP1["① 会计入账"]
        A1["原始凭证录入"] --> A2["借贷平衡校验<br/>借≠贷 拒绝保存"]
        A2 --> A3["生成 RUID<br/>R+BU+时间戳+3位随机"]
        A3 --> A4["fin_voucher +<br/>fin_voucher_entry"]
        A4 --> A5{"状态机"}
        A5 -->|DRAFT→SUBMITTED| A6["提交审核"]
        A6 -->|APPROVED| A7["审核通过"]
        A6 -->|REJECTED| A8["驳回(可重提)"]
        A7 -->|POSTED| A9["正式过账"]
    end

    subgraph STEP2["② 纳税申报"]
        B1["读取已过账凭证<br/>(同期间 RUID)"] --> B2["税目识别<br/>VAT 13% / IT 25% / ST 0.03%"]
        B2 --> B3["自动算税"]
        B3 --> B4["fin_tax_return +<br/>fin_tax_return_item"]
        B4 --> B5{"状态流转"}
        B5 -->|CALCULATED→APPROVED| B6["审核"]
        B6 -->|FILED| B7["申报完成<br/>生成回执号"]
    end

    subgraph STEP3["③ 勾稽对账"]
        C1["执行勾稽"] --> C2{"RUID 双台账比对"}
        C2 -->|金额一致| C3["MATCHED ✅"]
        C2 -->|金额不符| C4["AMOUNT_DIFF ⚠️ 标红"]
        C2 -->|单边存在| C5["UNMATCHED ⚠️ 预警"]
        C4 & C5 --> C6["人工处理 → HANDLED"]
        C3 & C6 --> C7["fin_reconciliation"]
    end

    A9 -->|"RUID 关联"| B1
    B7 -->|"RUID 关联"| C1
    A3 -.->|"写入主台账"| RUID_T["fin_ruid_ledger<br/>全链路中枢"]
    B4 -.->|"写入主台账"| RUID_T
    C7 -.->|"勾稽结果回写"| RUID_T

    style STEP1 fill:#e3f2fd,stroke:#1976d2
    style STEP2 fill:#e8f5e9,stroke:#388e3c
    style STEP3 fill:#fce4ec,stroke:#c2185b
```

---

## 三、电子化报税流程图（VAT / CIT / IIT）

```mermaid
flowchart TB
    subgraph SRC["① 取数层（自动 + 人工覆盖）"]
        INV["mgm_invoice_details<br/>销项/进项发票"]
        FS["mgm_finance_summary<br/>年度财报汇总"]
        VAT_ADJ["tax_vat_adjustments<br/>进项转出/留抵覆盖"]
        CIT_IN["tax_cit_inputs +<br/>tax_cit_adjustments<br/>收入/成本人工覆盖"]
        PAYROLL["payroll_details<br/>月度薪资"]
        BONUS["bonus_details<br/>年终奖(SEPARATE/COMBINED)"]
    end

    subgraph CALC["② 算税引擎 taxService"]
        VAT_C["VAT 增值税<br/>一般纳税人 13% 按月<br/>小规模 3% 按季(阈值30万)"]
        CIT_C["CIT 企业所得税<br/>25% 年度汇算<br/>弥补亏损/调整项"]
        IIT_C["IIT 个人所得税<br/>累计预扣 7 级累进<br/>年终奖单独/并入双通道"]
    end

    subgraph DECL["③ 申报落库"]
        VAT_D["vat_declarations"]
        CIT_D["cit_annual_settlements"]
        IIT_D["iit_withholding_batches +<br/>iit_withholding_details"]
    end

    subgraph SUBMIT["④ 提交税局（本地模拟受理）"]
        SIM["Submit.submit()<br/>受理号 TAX-{module}-{时间戳}-{随机}<br/>status 硬编码 SUCCESS"]
        RCPT["tax_submit_receipts<br/>回执落库"]
    end

    INV & VAT_ADJ --> VAT_C --> VAT_D
    FS & CIT_IN --> CIT_C --> CIT_D
    PAYROLL & BONUS --> IIT_C --> IIT_D
    VAT_D & CIT_D & IIT_D --> SIM --> RCPT

    style SRC fill:#e3f2fd,stroke:#1976d2
    style CALC fill:#e8f5e9,stroke:#388e3c
    style DECL fill:#fce4ec,stroke:#c2185b
    style SUBMIT fill:#fff3e0,stroke:#f57c00
```

> ⚠️ 提交链路为**本地模拟受理**：无真实税局 API 请求，受理号本地拼装、状态硬编码 `SUCCESS`。
> API 共 17 个端点：`/api/tax/vat/*`(4)、`/api/tax/cit/*`(3)、`/api/tax/iit/*`(4+年终奖)、`/api/tax/inputs/*`(6)；前端 4 个 Tab（VAT / CIT / IIT / 录入维护）。

---

## 四、日报绩效闭环流程图

```mermaid
flowchart TB
    EMP["👤 员工"] -->|"提交日报（7天编辑天窗）"| DR["daily_report +<br/>daily_report_detail"]

    DR --> KPI1["📊 及时率看板<br/>准时/迟交/缺交 → 及时率%"]
    DR --> KPI2["📋 月度绩效汇总<br/>工时/工作占比/延误/未解"]
    KPI2 --> CMP{"与目标对比<br/>daily_report_target"}
    CMP -->|🟢 达标| OK["绿: 正常"]
    CMP -->|🟠 接近| WARN["橙: 关注"]
    CMP -->|🔴 超标| BAD["红: 介入"]

    DR --> SCAN["🔔 告警引擎 drAlertScanner<br/>工作日 09:30/16:30 自动扫描"]
    SCAN --> R1["R1 连续未交<br/>3天黄/5天红"]
    SCAN --> R2["R2 工时异常<br/>＞12h每日 或 ＞60h每周"]
    SCAN --> R3["R3 未解压积"]
    SCAN --> R4["R4 延误压积"]
    SCAN --> R5["R5 工作占比过低"]
    R1 & R2 & R3 & R4 & R5 --> COOL["冷却去重 12h"]
    COOL --> MAIL["📧 邮件通知主管"]

    DR --> FC["📈 趋势预测 forecast<br/>WMA+LR 混合算法<br/>80% 置信区间"]
    FC --> RISK{"风险分级"}
    RISK --> RISK1["🟢 低"]
    RISK --> RISK2["🟡 中"]
    RISK --> RISK3["🔴 高 → 提前干预"]

    MGR["👔 部门主管"] -->|签核锁定| LOCK["daily_report_lock<br/>锁后 HTTP 423 硬拦"]
    LOCK -.->|"高阶主管解锁（必填原因）"| AUDIT["daily_report_audit_log<br/>人/IP/时间/旧新值快照"]
    DR -.->|任何增删改| AUDIT
```

---

## 五、7 步批次管线流程图

```mermaid
flowchart LR
    TEMP["ermm_temp_po<br/>PO 暂存"] --> S1
    subgraph PIPE["批次管线（可一键全部 / 逐步进行）"]
        S1["Step1 PO同步<br/>UPSERT"] --> S2["Step2 汇率换算<br/>本币金额"]
        S2 --> S3["Step3 供应商汇总<br/>Top20"]
        S3 --> S4["Step4 物料法规<br/>(简化版跳过)"]
        S4 --> S5["Step5 库存减值<br/>31/91/181/365天分级"]
        S5 --> S6["Step6 AR/AP 汇算<br/>SO出货/PO交付<br/>发票备援"]
        S6 --> S7["Step7 财务摘要重算"]
    end

    S1 --> PO["ermm_erp_po"]
    S2 --> PO
    S5 --> INV["e2_xitems_daily_status"]
    S6 --> ARAP["ermm_arap_detail"]
    S7 --> FS["mgm_finance_summary"]

    style PIPE fill:#e3f2fd,stroke:#1976d2
```

---

## 六、第三方资料整合流程图

```mermaid
flowchart TB
    subgraph SRC["数据来源（双通道）"]
        CH1["📊 Excel 通道<br/>前端上传 xlsx → base64<br/>后端 ExcelJS 解析"]
        CH2["🔌 SQL 通道<br/>直连第三方 MySQL<br/>只读 SELECT + LIMIT"]
    end

    CH1 --> MAP["栏位映射<br/>同名自动匹配 + 手动调整"]
    CH2 --> MAP
    MAP --> WL["栏位白名单校验<br/>information_schema.COLUMNS"]
    WL --> COERCE["类型转换<br/>Excel日期/千分位/空值→NULL"]
    COERCE --> UPSERT["统一 UPSERT<br/>先查存在键 → 拆分 INSERT/UPDATE<br/>批次 200 行"]

    UPSERT --> TARGET["🎯 ermm_db 任意目标表"]
    UPSERT --> LOG["📜 intg_log 执行日志<br/>新增/更新/失败行数"]

    subgraph BATCH["Batch 模式"]
        JOB["intg_job 作业配置<br/>schedule: daily HH:MM / every Nm"]
        SCH["intgScheduler 每分钟 tick<br/>防重入 ticking + runningJobs + firedKeys"]
        JOB --> SCH
    end

    SCH -->|到点触发| CH2

    POOL["连接池缓存<br/>sourcePools Map (按sourceId)"] -.-> CH2

    style SRC fill:#e3f2fd,stroke:#1976d2
    style BATCH fill:#fff3e0,stroke:#f57c00
```

---

## 七、现金预测流程图

```mermaid
flowchart LR
    JNL["mgm_casher_details<br/>现金日记账(借=收/贷=支)"] --> AGG["按周聚合<br/>历史流入/流出"]
    AGG --> F13["13周滚动预测<br/>预计现金余额曲线"]
    SAFE["mgm_cash_safe_level<br/>安全水位设定<br/>(默认: 周均流出×3, 下限300万)"] --> LINE["安全水位线"]
    F13 --> CMP{"逐周比对"}
    LINE --> CMP
    CMP -->|余额 ≥ 水位| GREEN["🟢 正常"]
    CMP -->|余额 < 水位| RED["🔴 标红预警<br/>最低水位卡转红<br/>⚠️ 低于安全值"]
```

---

## 八、部署架构

```mermaid
flowchart LR
    USER["👥 用户浏览器"] -->|HTTP :3008| NODE["Node.js<br/>node app.js"]
    subgraph NODE_PROC["同一进程内"]
        NODE --> EXP["Express 路由 ×42"]
        NODE --> SCH1["日报告警排程<br/>09:30/16:30/月末16:00"]
        NODE --> SCH2["整合批次排程<br/>每分钟 tick"]
    end
    EXP -->|mysql2 连接池<br/>limit 20| MYSQL[("MySQL 8<br/>ermm_db")]
    SCH1 & SCH2 --> MYSQL

    style NODE_PROC fill:#e8f5e9,stroke:#388e3c
```

---

## 九、模块间依赖关系总图

```mermaid
flowchart TB
    subgraph MOD["41 个前端页面模块"]
        P_DR["日报/绩效/签核/审计/告警/预测"]
        P_FIN["财务入账/报税/勾稽/报税明细"]
        P_CASH["日记账/现金预测/安全水位"]
        P_ERP["PO暂存/批次管线"]
        P_INTG["第三方整合(5 Tab)"]
        P_TAX["电子化报税(4 Tab)<br/>VAT/CIT/IIT/录入维护"]
        P_SYS["系统管理/用户/系统码"]
    end

    P_FIN -->|"RUID 贯穿"| P_FIN
    P_ERP -->|"ermm_erp_po 供数"| P_FIN
    P_FIN -->|"发票/财报取数"| P_TAX
    P_INTG -->|"UPSERT 写入"| P_DR & P_FIN & P_CASH & P_ERP
    P_SYS -->|"权限/汇率/参数"| P_DR & P_FIN & P_CASH & P_ERP & P_TAX

    style MOD fill:#e3f2fd,stroke:#1976d2
```

---

> **说明**：以上 9 张图均可在 VS Code（Mermaid 插件）/ GitHub / Typora 直接渲染。
> 与 [ERMM_系統架構與模組資料表關係圖.md](ERMM_系統架構與模組資料表關係圖.md) 互补：本文侧重**运行时流程**，该文档侧重**资料表结构关系**。

---

> **更新日志**
> - 2026-10-24：① 新增第三章「电子化报税流程图」（VAT/CIT/IIT 算税 → 落库 → 本地模拟提交）；② 架构图服务层新增 TAX 子域、数据层新增 DB_TAX（10 张税务表）；③ 路由数 41→42、资料表 68+→74、前端页面 40→41；④ 模块依赖图新增电子化报税节点。
> - 2026-10-20：初版（v3.0，8 张流程图）。
