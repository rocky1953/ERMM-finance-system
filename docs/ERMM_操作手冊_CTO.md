> 适用角色：CTO / IT 负责人 / 系统管理员｜适用版本：v4.0（2026-11-16）
> 系统地址：http://localhost:3008 ｜部署形态：单机 Node.js + MySQL 8
> 本手册聚焦「系统在你手上怎么跑、怎么管、怎么排障」，业务口径请参考 CFO 手册。
> 本版新增：**CTO-02 细粒度按钮权限（55 按钮三角色 allow 矩阵 + middleware/perms.js readScope + requireButton）、CTO-03 全量操作审计（routes/audit.js + AI 自动串接）、CTO-04 备份灾备（7 步批次管线 + MySQL 72 迁移可回放）、CTO-05 合同主档（Migration 057 ermm_contract 28 栏 + routes/contracts.js 9 端点 + 前端页面）、CTO-06 指标中心（Migration 056 cams_metric_def 23 指标 7 类别 + services/metricCenter.js）、CTO-07 消息通知（services/notifier.js Email/Lark/企微 webhook 三通道）、CTO-08 CI/CD（.github/workflows/ci.yml MySQL 8 service + Jest 17 测试 52+ 点 + .env.example）、CTO-09 AI 治理（Migration 058 ermm_ai_audit + cams_ai_model_pricing 10 模型计价 + cams_ai_rate_limit + services/llmAudit.js + routes/llmAudit.js 10 端点 + 前端 6 页签 Dashboard）**。本次补充：**模块级 API 守门（`middleware/moduleGuard.js`，69 条 API 前缀映射 + 60 秒缓存 + 403 `MODULE_DENIED`）** 与 **Migration 059（补登合同主档 / 功能权限 / 操作审计 / AI 治理 4 个遗漏模块，模块总数 81）**。

# 一、你的角色定位

CTO 在系统中的职责是**保可用、保安全、保可维护**：

1. **保可用**：服务在跑、批次在跑、页面能打开。
2. **保安全**：账号权限、JWT 认证、敏感操作可控。
3. **保可维护**：架构文档、数据表关系、变更可追溯。

---

# 二、技术栈与部署（事实）

| 项 | 值 |
|---|---|
| 运行时 | Node.js v18.20.8（Windows） |
| Web 框架 | Express 5 |
| 数据库 | MySQL 8，库名 `ermm_db`，**152 张表** |
| 端口 | 3008 |
| 认证 | JWT，令牌存 `localStorage.ermm_token`，全站 401 统一拦截 |
| 前端 | 原生 HTML/CSS/JS + `registerPage()` 页面注册，无框架（**68 个已注册页面**） |
| LLM | DeepSeek（预设），配置表 `llm_config`，统一走 `utils/llmClient.js → getDefaultProvider(pool)`（**returnMeta 模式**统一 token/成本追踪） |
| 路由 | **74 个路由模块**（75 条 `app.use` 挂载），新增合同主档 / 指标中心 / 审计 / AI 治理 |
| 审批流 | `services/workflow.js`（`submitWorkflow()`），表 `wf_process / wf_instance / wf_task / wf_log` |
| 静态资源 | `public/`（`express.static`，`etag:false`） |
| 文档路由 | `/docs/architecture`、`/docs/executive`、`/docs/data-model`、`/docs/manual-ceo|cfo|cto|coo`（`Cache-Control: no-store`） |
| 迁移 | **72 个**（001~059 + 回滚脚本），全部幂等、支持 `--dry-run / --rollback` |
| 测试 | Jest **17 个测试文件**，52+ 测试点，`.github/workflows/ci.yml` push 即自动回归 |
| 按钮权限 | `cams_permission_button` **55 按钮三角色 allow 矩阵**，`middleware/perms.js` `readScope` + `requireButton` 双重拦截 |
| 模块守门 | `middleware/moduleGuard.js` 挂在 `authRequired` 之后，69 条 API 前缀映射 `cams_module_permission`，无权限返回 403 `MODULE_DENIED`；缓存 60 秒 |

## 2.1 启动 / 停止 / 健康检查

```powershell
# 启动（项目根目录）
cd e:\finance
node app.js

# 健康检查
Invoke-WebRequest http://localhost:3008/api/health -UseBasicParsing

# 查看占用端口进程
Get-NetTCPConnection -LocalPort 3008 -State Listen

# 停止
Stop-Process -Id <PID> -Force
```

- 启动后应看到：数据库连接成功、排程器已注册（告警 09:30/16:30、整合每分钟 tick）。
- `/api/health` 返回 `{"success":true,...}` 即为正常。
- 生产部署建议 PM2 守护：`pm2 start app.js --name ermm`，`pm2 logs ermm` 看日志。

## 2.2 依赖与目录结构

```
app.js            # 入口：中间件、路由挂载、文档路由、排程启动
middleware/perms.js# CTO-02 细粒度按钮权限：readScope + requireButton
middleware/moduleGuard.js# 模块级 API 守门：/api 前缀表 + cams_module_permission + 60 秒缓存
routes/*.js       # 74 个路由模块（按业务域，新增 audit / contracts / llmAudit 等）
services/*.js     # 32 个业务服务（新增 metricCenter.js / notifier.js / llmAudit.js）
utils/llmClient.js# LLM 服务商选择（必须统一走这里，returnMeta 模式）
scheduler/*.js    # 告警与整合排程
migrations/*.sql  # 72 个迁移（001~059 + 回滚脚本）+ run_all.sql
public/           # 前端页面（68 个注册页面，新增合同主档 / AI 治理 Dashboard）与静态资源
docs/             # 架构、数据表、手册（md + 生成后的 html）
scripts/          # generate_docs_html.js 文档生成器
test/             # Jest 回归测试（17 个测试文件，52+ 测试点）
.github/workflows/ci.yml # CTO-08 CI/CD：MySQL 8 service + npm test
.env.example      # CTO-08 统一环境变量模板
```

## 2.3 经营分析模块（2026-11 新增）

| 模块 | 前端页面 | API | 迁移 | 关键表 |
|---|---|---|---|---|
| 多维盈利 | `public/js/pages/profitAnalysis.js` | `/api/profit` | 030 | 读 `mgm_finance_summary`、`ermm_erp_so`、`ermm_erp_po` |
| 滚动预算 | `public/js/pages/rollingBudget.js` | `/api/rolling-budget` | 031 | `rolling_budget_assumption`（假设） |
| 库存周转 | `public/js/pages/inventoryTurnover.js` | `/api/inventory-turnover` | 032 | `inv_slow_moving_action`（处理单）、`e2_xitems_daily_status`（库龄快照） |

- 三个模块均在 `app.js` 以 `app.use('/api/xxx', routes)` 挂载，需登录（`authRequired`）后访问。
- 库存周转新增码表 `INV_DISPOSAL_TYPE`（6 种处置方式），权限行 `inventoryTurnover`（经营决策组，一般员工不可用）。
- 库存周转接口清单：`GET /overview|/aging|/slow-moving|/replenishment|/snapshots|/actions`，`POST/PUT/DELETE /actions`。
- 数据口径：周转率取 `mgm_finance_summary` 近 12 个月销售成本 ÷ 平均存货价值；库龄取 `e2_xitems_daily_status` 快照，默认选料件行数最多的最近日期；需求取 SO 交货量，缺失时以 PO 采购量近似。

## 2.4 费用 / 付款 / 审批 / 组织模块（2026-11 新增）

| 模块 | 前端页面 | API 前缀 | 服务 / 迁移 | 关键表 |
|---|---|---|---|---|
| 费用报销 | `pages/expense.js` | `/api/expense` | 021 / 047 | `exp_report` / `exp_report_item` |
| 借支与核销 | `pages/expense.js`（借支页签） | `/api/expense/advances/*` | 047 | `exp_advance` / `exp_advance_settle` |
| 付款申请 / 排程 / 回单 / 核销 | `pages/payRequest.js` | `/api/pay-request` | 022 / 026 | `pay_request` / `pay_request_item` / `pay_writeoff` |
| 审批中心 | `pages/approvals.js` | `/api/workflow` | `services/workflow.js` | `wf_process` / `wf_instance` / `wf_task` / `wf_log` |
| 组织人效 | `pages/hrEfficiency.js` | `/api/hr-efficiency` | `services/hrEfficiency.js` | `hr_headcount_plan` |
| 战略 BSC | `pages/strategy.js` | `/api/strategy` | `services/bsc.js` | `bsc_objective` / `bsc_progress` |
| 董事会报告包 | `pages/boardPack.js` | `/api/board-pack` | `services/boardPack.js` | `board_pack` |
| 项目损益 | `pages/projectProfit.js` | `/api/project-profit` | `services/projectProfit.js` | `project_budget` / `project_cost` / `project_revenue` / `project_customer_map` |
| 销售信用 | `pages/soCredit.js` | `/api/so-credit` | `services/soCredit.js` | `sales_credit_limit` / `sales_return` |

- **审批流为通用引擎**：新业务接入只需在提交处调用 `submitWorkflow(conn, { businessType, businessId, title, amount, applicantId, dept, buNo })`，并在 `wf_process` 建一条对应 `business_type` 的流程定义；无需新增流程表或改引擎代码。
- **权限登记**：以上模块均在 `cams_module_permission` 建行（`module_code` 与 `index.html` 的 `data-page` 一致），后端以 `Auth.canAccess(page)` 二次校验。
- **只读边界**：人效 / 战略 / 董事会 / 项目损益 / 销售信用以汇总与配置为主，不回写账务；费用与付款写各自业务表 + `wf_*`。

## 2.5 其余业务模块（已上线，按需维护）

| 模块 | 页面 | API 前缀 | 关键表 | 说明 |
|---|---|---|---|---|
| 集团驾驶舱 / 战情室 | `warRoom.js` | `/api/war-room` | 复用各域表 | 三账套汇总驾驶舱，只读 |
| 月结关账 | `closing.js` | `/api/closing` | `closing_calendar` / `closing_task` / `closing_task_instance` | 关账任务清单 + 关账 / 反关账 |
| 外汇曝险 | `fxExposure.js` | `/api/fx` | `fx_exposure_item` / `fx_hedge` | 敞口与避险覆盖率，管理口径 |
| 资金流动性 | `cashLiquidity.js` | `/api/cash-liquidity` | `cash_plan_item` | 周 / 月现金计划与实际 |
| 投资管理 | `investment.js` | `/api/investment` | `investment_project` / `investment_budget` / `investment_cashflow` | 投资现金流与回收测算 |
| 税务筹划 | `taxPlanning.js` | `/api/tax-planning` | `tax_preference` / `vat_deductions` | 优惠适用与可抵扣项 |
| 税务合规 | `taxCompliance.js` | `/api/tax-compliance` | `tax_regulation` / `tax_compliance_item` / `tax_filing_task` | 法规 → 事项 → 任务 |
| 请购单 | `prRequest.js` | `/api/pr-request` | `pr_request` / `pr_request_item` | 部门请购与审批 |
| 到货单 | `poGrn.js` | `/api/po-grn` | `po_grn` | 收货登记（含批次） |
| 三单匹配 | `poMatch.js` | `/api/po-match` | `po_match_result` | PO / 到货 / 发票比对 |
| 收款与应收核销 | 由 `receipt` + `arMatch` 路由支撑（无独立页面） | `/api/receipt`、`/api/ar-match` | `receipt_detail` / `ar_match_result` | 收款登记与发票核销 |
| 模块权限 | `permission.js` | `/api/permission` | `cams_module_permission` | 页面级授权，前后端双校验 |
| 预算审批留痕 | `budget.js` | `/api/budget` | `budget_approval_log` | 预算版本提交 / 审批记录 |

> 维护提示：新增或调整模块时，同步更新本表与 `docs/ERMM_系統架構與模組資料表關係圖.md`，再跑 `node scripts/generate_docs_html.js`，避免文档与代码漂移。

## 2.6 CTO-05~CTO-09 新增模块（v4.0 交付）

| 项目 | 迁移 | 前端页面 | 路由 | 服务 / 中间件 | 关键表 / 文件 | 说明 |
|---|---|---|---|---|---|---|
| **CTO-02 细粒度按钮权限** | 051 | — | — | `middleware/perms.js`（`readScope` / `requireButton`） | `cams_permission_button`（55 按钮三角色 allow 矩阵） | 每个敏感按钮都有角色 + 范围双重拦截，前端隐藏 + 后端硬拦 |
| **CTO-03 全量操作审计** | 051 | — | `routes/audit.js` | — | `ermm_ai_audit` | 覆盖所有 CRUD + AI 智能操作，`GET /api/audit` 列表 / `/api/audit/stats` 统计 / `/api/audit/anomaly` AI 自动异常检测 |
| **CTO-04 备份灾备** | — | — | — | — | MySQL 72 迁移幂等可回放 | 7 步批次管线（已在 2.5 列）；所有迁移脚本支持 `--dry-run` / `--rollback` / 事务包裹 |
| **CTO-05 合同主档** | 057 | `pages/contracts.js` | `routes/contracts.js` 9 端点 | — | `ermm_contract`（28 栏：合同编号 / 甲方 / 乙方 / 金额 / 币种 / 签约日 / 到期日 / 状态 / 关联 PO 等） | 从 `ermm_erp_po` 自动种 10 笔示范；合同 → 采购 → 到货 → 发票 → 付款全链路可追溯 |
| **CTO-06 指标中心** | 056 | — | — | `services/metricCenter.js` | `cams_metric_def`（23 指标 7 类别） | 统一指标引擎，ROE、毛利率、DSI、DSO、DPO 等从此有了唯一口径；被仪表板 / 滚动预算 / 多维盈利统一调用 |
| **CTO-07 消息通知** | 055 | — | — | `services/notifier.js` | `cams_notif_channel` + `cams_notif_subscription` | Email / Lark / 企微 webhook 三通道统一入口；告警、审批、日报自动推送；用户可订阅 / 取消订阅通知类型 |
| **CTO-08 CI/CD** | — | — | — | Jest 测试套件 | `.github/workflows/ci.yml` + `.env.example` + `test/` 17 文件 | MySQL 8 service 容器 → npm ci → npm test（52+ 点）；`.env.example` 统一环境变量模板 |
| **CTO-09 AI 治理** | 058 | `pages/llmAudit.js`（6 页签 Dashboard） | `routes/llmAudit.js` 10 端点 | `services/llmAudit.js` + `utils/llmClient.js` returnMeta 模式 | `ermm_ai_audit` + `cams_ai_model_pricing`（10 模型计价）+ `cams_ai_rate_limit` | 全链路 AI 调用审计 + 成本追踪 + 模型限流 + 6 页签 Dashboard（概览 / 调用明细 / 成本统计 / 限流日志 / 模型计价 / 异常检测） |

> **CTO-03 审计 API 与 CTO-09 AI 审计的区别**：CTO-03 审计是操作审计（谁对什么业务数据做了什么变更），CTO-09 AI 审计是 AI 调用审计（谁调用了哪个模型、花了多少 token、多少钱、限流了没）。两者写入同一张 `ermm_ai_audit` 表，由 `audit_type` 字段区分。

---

# 三、账号与权限管理（👤 使用者管理）

> 权限分三层：① **导航可见性**（`cams_module_permission`，页面「功能权限」，按一般 / 操作员 / 管理员 × **81 个模块**勾选；前端 `canAccess()` 为 **fail-closed**，无权限缓存即拒绝并隐藏菜单）② **模块级 API 守门**（`middleware/moduleGuard.js` 按 `/api` 第一段路径映射模块，无权限返回 403 `MODULE_DENIED`，见 9.1）③ **按钮级细粒度权限**（`cams_permission_button` **55 按钮**三角色 allow 矩阵，`middleware/perms.js`，见 3.1）。用户落到矩阵哪一列由**动作角色**（`cams_xuser.admin` / `xuser_type`）决定。模块矩阵说明见《使用者操作手册》附录 A。

- **入口**：系统 · 主档管理 → **使用者管理**。
- **用户类型**：一般员工 / 部门主管 / 高阶主管 / 管理员。
- **管理员判定**：`cams_xuser.admin = 'Yes'`（系统内统一 Yes/No，migration 012 起）。
- **常见操作**：
  1. 新增用户 → 填写账号、姓名、部门、角色 → 保存。
  2. 调整角色 → 修改用户类型与管理員标记。
  3. 停用离职账号 → 状态置为停用（不要删除，保留审计痕迹）。
- **测试账号**：`rocky / 68315711`（管理员）、`S10049 / 68315711`（一般员工，用于验证权限拦截）。

## 3.1 CTO-02 细粒度按钮权限（v4.0 新增）

除了模块级可见性，v4.0 引入 **55 个按钮级权限**，覆盖所有敏感操作（审批、过账、删除、付款、导出、批量处理）：

- **权限表**：`cams_permission_button`（三列：`button_code` / `role` / `allow`），每行是「某角色能不能按某个按钮」。
- **中间件**：`middleware/perms.js` 提供两个检查函数：
  - `readScope(conn, user)` — 检查用户是否有该模块的读取权限
  - `requireButton(buttonCode)` — 检查用户是否有该按钮的操作权限
- **拦截点**：在每个敏感路由挂载，例如付款接口 `router.post('/execute', perms.requireButton('pay_execute'), ...)`。
- **前端联动**：按钮按角色显示 / 隐藏（`data-btn="pay_execute"` + JS 检查）；后端二次校验硬防绕过。
- **排障**：
  - 用户说「按钮看不见」→ 查前端 JS 是否正确读了权限矩阵。
  - 用户说「按钮能点但报错 403」→ 查 `middleware/perms.js` 是否正确挂载在对应路由上。
  - 新增按钮 → 先在 `cams_permission_button` 建行，再在路由挂 `requireButton('new_code')`，最后前端加 `data-btn`。

> **权限设计原则**：前端只做**体验层拦截**（菜单隐藏、按钮显隐），真正的数据安全依赖后端 `authRequired` 的 JWT 校验 + `middleware/moduleGuard.js` 的**模块级守门**（直接调用 API 同样 403）+ `middleware/perms.js` 的按钮硬拦。敏感接口必须在路由层校验模块权限 + 按钮权限双重约束。

---

# 四、系统设定与主档（🔧）

| 模块 | 路径 | 说明 |
|---|---|---|
| 系统设定 | 系统 · 主档管理 → 系统设定 | 系统码、公司别、期间、参数 |
| 使用者管理 | 同上 | 账号与角色 |
| KPI 门槛 | 同上 | 红黄绿灯阈值（改后全站预警生效） |
| 分公司 | 同上 | HM / SZ / HN 账套与基本信息 |
| 往来对象 | 同上 | 客户/供应商主档 |

**变更注意**：KPI 门槛与公司别信息属于**全局参数**，一次修改影响所有用户与所有页面，变更前请备份并在测试账号验证。

---

# 五、批次管线与第三方整合（⚙️ / 🔌）

## 5.1 批次管线（CTO-04 7 步可回放）

- **入口**：系统 · 主档管理 → **批次管线**。
- **CTO-04 7 步管线**：
  1. **PO 同步** — 拉取 ERP 采购单
  2. **汇率换算** — 多币种折算本位币
  3. **供应商汇总** — 供应商维度聚合
  4. **库存减值** — 呆滞料评估减值损失
  5. **AR/AP 汇算** — 应收应付期末余额与核销
  6. **财务摘要重算** — 刷新 `mgm_finance_summary`
  7. **三大报表生成** — 资产负债表 / 损益表 / 现金流量表
- **幂等可回放**：每步脚本支持 `--dry-run`（预演）/ `--apply`（执行）/ `--rollback`（回滚），包裹在单一 MySQL 事务中；重复执行不会产生脏数据。
- **操作**：选择公司与月份 → 执行 → 查看每步状态与耗时 → 失败步骤可重跑（或 rollback 重来）。
- **灾备**：72 个迁移脚本全部遵循幂等模式（先 DELETE 本次生成再重建），生产环境操作前必须先 `--dry-run` 预演，确认受影响行数正确后再 `--apply`。
- **排障**：若仪表板某月无数据，优先确认该月批次是否跑完；单步失败看日志定位；迁移失败先 rollback 再查原因。

## 5.2 第三方资料整合

- **入口**：系统 · 主档管理 → **第三方资料整合**（5 个页签）。
- **内容**：数据源配置（`intg_source`）、作业定义（`intg_job`）、执行日志（`intg_log`）。
- **操作**：
  1. 配置数据源（第三方 MySQL 连接、只读账号）。
  2. 定义作业与映射（源表 → 目标表）。
  3. 手动触发或等待排程（每分钟 tick）。
  4. 在日志页签查看成功/失败条数与耗时。
- **安全**：第三方库使用**只读账号**；写入仅限本系统 `ermm_db`。

## 5.3 排程器

| 排程 | 时间 | 作用 |
|---|---|---|
| 日报告警 | 工作日 09:30 / 16:30 | 生成日报提醒与预警 |
| 月末告警 | 月末 16:00 | 月末结账提醒 |
| 整合批次 | 每分钟 tick | 检查待执行整合作业 |

---

# 六、数据质量管理（🛠️）

- **入口**：日常作业 → **数据质量扫描**。
- **用途**：不是你日常要看，而是**排障与上线前体检**：7 大类 20+ 项，39ms 返回。
- **典型场景**：
  - 用户报「报表数字不对」→ 先跑扫描，确认是数据问题还是口径问题。
  - 迁移/升级后 → 跑扫描确认表健康度（8 张核心表）。
  - 批次失败后 → 跑扫描确认数据完整性。

---

# 七、AI 智能层 + AI 治理驾驶舱（运维视角）

## 7.1 原有 5 大 AI 能力

| 功能 | 端点 | 依赖 | 排障要点 |
|---|---|---|---|
| AI 问答 | `/api/aiqa/ask` | `ermm_knowledge` + LLM | 无回答先查 `llm_config` 预设；未命中查 `ermm_kb_miss_log` |
| 每日摘要 | `/api/daily-summary/*` | LLM + 财务表 | 卡片空白查 provider 与网络；历史在 `daily_ai_summary` |
| AR 催收 | `/api/ar-smart/*` | `mgm_invoice_details` | 清单空=无 AR 明细 |
| 质量扫描 | `/api/data-quality/scan` | 全库只读 | 超时=表量过大，检查索引 |
| 概率预测 | `/api/cash-forecast/monte-carlo` | 现金历史 | 无数据=期间未加工 |

- **LLM 配置**：`llm_config` 表，`is_default=1 AND status='USE'` 为当前生效服务商。**禁止**在其他路由自行写 SQL 查 provider，统一用 `getDefaultProvider(pool)`。
- **AI 问答页唯读**：`pages/aiqa.js` 的服务商徽章（🧠 DeepSeek（预设））与 API Key 状态均为**唯读展示**，页面上不再有服务商下拉与「API Key 管理」按钮；`/api/aiqa/ask` 忽略前端传入的 `provider`，一律由 `getDefaultProvider(pool)` 取预设服务商，未配置则回 400 提示管理员前往「系统设定 → LLM 服务商管理」。
- **2026-11 修复**：知识库未命中分支引用了未定义变量 `query`（应为 `q`），触发 ReferenceError 使查询无回应；同批修正前端固定传 `provider='kimi'` 导致忽略预设服务商的问题。
- **安全边界**：AI 层**只读**，不写账务表；写入仅限 `ermm_knowledge`、`ermm_kb_miss_log`、`daily_ai_summary`。

## 7.2 CTO-09 AI 治理驾驶舱（v4.0 新增）

- **前端页面**：`pages/llmAudit.js` — 6 页签 Dashboard（概览 / 调用明细 / 成本统计 / 限流日志 / 模型计价 / 异常检测）。
- **后端端点**：`routes/llmAudit.js` 共 10 端点：

| 端点 | 说明 |
|---|---|
| `GET /api/llm-audit/overview` | 总览卡片（调用次数 / 总成本 / 平均响应 / 限流次数） |
| `GET /api/llm-audit/calls` | 调用明细（支持按日期 / 用户 / 模型 / 业务场景筛选） |
| `GET /api/llm-audit/costs` | 成本统计（按模型 / 业务 / 时间维度聚合） |
| `GET /api/llm-audit/rate-limits` | 限流日志 |
| `GET /api/llm-audit/models` | 模型计价配置 |
| `PUT /api/llm-audit/models/:id` | 更新模型单价 |
| `GET /api/llm-audit/anomalies` | AI 自动异常检测结果 |
| `GET /api/llm-audit/rules` | 限流规则配置 |
| `PUT /api/llm-audit/rules/:id` | 更新限流阈值 |
| `POST /api/llm-audit/anomalies/handle` | 标记异常处理 |

- **核心机制**：
  - `utils/llmClient.js` **returnMeta 模式**：所有 LLM 调用返回 `{ text: '...', meta: { tokens: 1500, cost_usd: 0.005, latency_ms: 820, model: 'deepseek-chat' } }`，meta 自动落库 `ermm_ai_audit`。
  - `services/llmAudit.js`：定时聚合成本、检测异常（token 暴增 / 响应变慢 / 非业务时段调用）。
  - `cams_ai_model_pricing`：10 模型计价（DeepSeek Chat / Reasoner / Moonshot / GPT-4o-mini / Claude Haiku 等）。
  - `cams_ai_rate_limit`：按用户 / 接口 / 时段配置 QPS 和日调用上限。

## 7.3 CTO-06 指标中心 & CTO-07 消息通知

- **CTO-06 指标中心**（`services/metricCenter.js` + `cams_metric_def` 23 指标 7 类别）：被仪表板 / 滚动预算 / 多维盈利 / 库存周转统一调用；ROE、毛利率、DSI、DSO、DPO 等关键指标从此有了唯一计算口径。**注意**：新增指标先在 `cams_metric_def` 建行，再在 `metricCenter.js` 实现计算函数。
- **CTO-07 消息通知**（`services/notifier.js`）：Email / Lark / 企微 webhook 三通道统一入口；告警、审批、日报自动推送。**排障**：通知没收到 → 查 `cams_notif_subscription` 是否有对应用户 + 查 `cams_notif_channel` 通道是否配置正确 + 查 webhook / SMTP 凭证。

---

# 八、文档维护（系统文件）

- **入口**：侧边栏最下方「系统文件」（仅管理员可见可用）：
  - 🗺️ 系统架构与流程图 → `/docs/architecture`
  - 📊 高管价值简报 → `/docs/executive`
  - 🗄️ 模块数据表关系图 → `/docs/data-model`
  - 👔💰🛠🚚 四角色操作手册 → `/docs/manual-ceo` 等
- **更新流程**：
  1. 修改 `docs/*.md`。
  2. 执行 `node scripts/generate_docs_html.js`（同时生成 `docs/` 与 `public/` 两份 HTML）。
  3. 重启服务（如需）→ 浏览器 `Ctrl+Shift+R` 验证。
- **非管理员点击**会弹出「你的权限不能使用这个模块功能」——这是前端 `openDocPage()` 的权限拦截。

---

# 九、安全与合规

- **认证**：所有 `/api/*` 经 `authRequired`；令牌失效返回 401，前端统一跳登录页并清除 `ermm_token`。
- **密码策略**：用户密码入库前加密；管理员账号单独管理，不共用。
- **模块级 API 守门**：`middleware/moduleGuard.js` 对 69 条 `/api` 前缀查 `cams_module_permission`，非管理员无权限返回 403 `MODULE_DENIED`；跨模块共用 API（workflow / codes 等）仅需登录。详见 9.1。
- **CTO-02 细粒度按钮权限**：`middleware/perms.js` 在敏感路由（付款 / 审批 / 删除 / 过账）挂载 `requireButton()`，55 按钮三角色 allow 矩阵（`cams_permission_button`）控制。
- **CTO-03 全量操作审计**：`routes/audit.js` 审计 API 覆盖所有 CRUD + AI 智能操作，写入 `ermm_ai_audit`；`GET /api/audit` 查列表、`/api/audit/stats` 看统计、`/api/audit/anomaly` AI 自动异常检测。高管驾驶舱可实时看谁在做什么、做了什么变更。
- **CTO-09 AI 调用审计**：所有 LLM 调用通过 `utils/llmClient.js returnMeta 模式` 自动落库，含 token 数 / 成本 / 延迟 / 模型 / 业务场景；`cams_ai_rate_limit` 限流防滥用。
- **备份与灾备（CTO-04）**：MySQL 定期备份（建议每日 + 月结前各一次）；72 个迁移脚本全部幂等，支持 `--dry-run` / `--apply` / `--rollback`；生产操作前必须 dry-run 预演。
- **敏感配置**：`llm_config.api_key`、第三方库连接信息、Lark / 企微 webhook URL 不要写入前端或提交仓库，放 `.env`（参考 `.env.example`）。
- **CTO-08 CI/CD**：`.github/workflows/ci.yml` 在 push 时自动启动 MySQL 8 service 容器 → npm ci → npm test（17 文件 52+ 点），红灯必须修复才能合入 main。

## 9.1 权限三层与模块级 API 守门（middleware/moduleGuard.js）

| 层级 | 控制什么 | 实现位置 | 说明 |
|---|---|---|---|
| ① 导航隐藏 | 左侧菜单是否出现、页面能否打开 | `public/js/app.js` `Auth.canAccess()` | **fail-closed**：无权限缓存一律拒绝；当前页失去权限时自动跳转到第一个有权限的页面 |
| ② 模块 API 守门 | 直接呼叫 `/api/xxx` 是否放行 | `middleware/moduleGuard.js`（`app.js` 挂在 `authRequired` 之后） | 按 `/api` 第一段路径映射模块（69 条），查 `cams_module_permission` 角色列，无权限 403 |
| ③ 按钮权限 | 审批 / 过账 / 删除 / 付款等敏感动作 | `middleware/perms.js` + `cams_permission_button`（55 按钮） | 前端隐藏 + 后端 `requireButton()` 硬拦 |

**判定顺序**：

1. `NODE_ENV=test` 且未设 `MODULE_GUARD_STRICT=1` → 直接放行（回归测试用）。
2. `/api` 后第一段路径未在 `PREFIX_MODULE` 登记 → 视为跨模块共用 / 内部 API，仅要求登录。
3. 未登录（无 `req.user`）→ 401 `NO_AUTH`。
4. `cams_xuser.admin = 'Yes'` → 全部通过。
5. 依角色（admin / operator / general）查 `allow_admin` / `allow_operator` / `allow_general`，未登记或为 0 → 403。

**共用 API 白名单（仅需登录）**：`workflow`、`codes`、`kpi-query`、`metric-center`、`notifier`、`llm`、`diagnosis`、`daily-summary`、`batch`、`monitor`。

**403 响应示例**：

```json
{
  "success": false,
  "code": "MODULE_DENIED",
  "module": "contracts",
  "message": "你的角色沒有此功能模組的存取權限"
}
```

**缓存与开关**：

- 权限判定按 `role:module` 缓存 **60 秒**，管理员改完矩阵最慢 60 秒生效；前端 `refreshPermissions()` 另有 30 秒节流，并在窗口重新获得焦点时自动同步 `/api/auth/me`，用户不必重新登录。
- 测试环境默认放行；需强制验证守门逻辑时设 `MODULE_GUARD_STRICT=1`。
- 前端「看不到菜单」+ 后端「直接调 API 也被挡」构成双保险：改前端 JS 或手工 curl 均无法绕过。
- 登出 / 401 时前端会清除 `ermm_permissions` 与 `ermm_role`，避免残留旧权限缓存。

---

# 十、常见故障排查表

| 现象 | 排查顺序 |
|---|---|
| 页面打不开 | 端口 3008 是否监听 → `node app.js` 是否报错 → `/api/health` |
| 登录后被踢回登录页 | 浏览器 localStorage 是否有 `ermm_token` → 该接口是否 401 → 前端是否误读 `'token'` 而非 `Auth.getToken()` |
| 新页面点击无反应 | 浏览器缓存旧 JS → `Ctrl+Shift+R`；页面是否用 `registerPage()` 注册 |
| 某月数据缺失 | 该公司该月批次是否跑完 → 整合日志 → 数据质量扫描 |
| 报表数字异常 | 数据质量扫描 → 财务摘要 → 三大报表交叉核对 |
| AI 摘要/问答失败 | `llm_config` 预设 → 网络出向 → 日志 |
| 文档页面图表不显示 | `/vendor/mermaid.min.js` 是否 200 → 页面是否被缓存（文档路由已 no-store） |
| 数据库连接失败 | MySQL 服务 → 账号密码 → 连接数上限（pool limit 20） |
| 库存周转无库龄数据 | 该 BU 是否在 `e2_xitems_daily_status` 有快照 → 检查 `bu_no` 与 `stock_date` → 切换快照日期 |
| 呆滞处理单下发 400 | 必传 `bu_no`、`xitems`；检查 `INV_DISPOSAL_TYPE` 码表是否已执行迁移 032 |
| 库存周转页无权限/菜单不显示 | `cams_module_permission` 是否有 `inventoryTurnover` 行 → 用户角色是否允许 |
| 某功能菜单不显示 / 页面打不开 | ① `SELECT allow_general,allow_operator,allow_admin FROM cams_module_permission WHERE module_code='xxx'`（无行 → 执行 Migration 059 或补登记 `module_code`）② 该用户角色列是否为 1（角色按使用者类别判定，不是看身份 `Operator`）③ 浏览器 `ermm_permissions` 是否为旧缓存 → 重新登录或切回窗口等待 30 秒自动同步 |
| 呼叫 API 回 403 `MODULE_DENIED` | 响应 `module` 字段即模块代码 → 查 `cams_module_permission` 该行角色列 → 改矩阵后等 **60 秒**（moduleGuard 缓存）或重登 → 确认 `app.js` 的 `moduleGuard` 挂在 `authRequired` 之后、该路径前缀在 `PREFIX_MODULE` 中 → 测试环境需 `MODULE_GUARD_STRICT=1` 才强制生效 |
| 报销 / 付款提交无审批任务 | `wf_process` 无对应 `business_type` 或 `enabled=0` → 执行 021/022 迁移或补流程定义 |
| 审批待办看不到 | `wf_task` 的审批人是否指向当前用户 → 检查 `steps_json` 角色配置 |
| 借支核销 400 | 核销金额 > `exp_advance.balance`；或状态非 PAID → 先拨付再核销 |
| 付款申请标记付款失败 | 未填 `bank_receipt_no` / `receipt_date`；或状态非 APPROVED |
| 核销来源清单为空 | `mgm_invoice_details` 无 `sub_amt > payment` 的记录（该账套 / 期间已核完） |
| 组织人效页无数据 | `hr_headcount_plan` 无该 `bu_no + period` 编制 → 先新增或「复制上月」 |
| 董事会报告包导出为空 | 该月批次未跑完 / `mgm_finance_summary` 无数据 |

---

# 十一、变更管理清单（上线前自检）

- [ ] 迁移脚本按序执行（**001~059**，共 72 个脚本含回滚），`run_all.sql` 可一键建置；**生产前必须 `--dry-run` 预演**
- [ ] 新增路由在 `app.js` 挂载 `/api/xxx`
- [ ] 新增敏感路由挂载 `middleware/perms.js` 的 `requireButton('button_code')`
- [ ] 新增按钮先在 `cams_permission_button` 建行（三角色 allow 矩阵）
- [ ] 新增页面在 `cams_module_permission` 登记 `module_code`，且与 `index.html` 的 `data-page` 一致
- [ ] 新增 API 前缀（`/api/xxx`）若属单一模块，在 `middleware/moduleGuard.js` 的 `PREFIX_MODULE` 补映射；跨模块共用则确认属白名单语义（仅需登录）
- [ ] 新增模块后执行/补充迁移（参照 059 模板），确保「功能权限」页面可见且矩阵行存在
- [ ] 前端新页面使用 `registerPage()`，并在 `index.html` 加 `?v=` 缓存戳
- [ ] 新增页面文案补齐三语 i18n
- [ ] 新业务流程在 `wf_process` 建 `business_type` 定义，并确认 `submitWorkflow()` 已调用
- [ ] 敏感接口在路由层校验角色 + 按钮权限双重约束
- [ ] AI 调用必须走 `utils/llmClient.js`（returnMeta 模式），禁止自行调用 LLM SDK
- [ ] 消息通知走 `services/notifier.js`，禁止在业务代码直接调 webhook / SMTP
- [ ] 指标计算走 `services/metricCenter.js`，禁止在各模块自行写 ROE 公式
- [ ] 改完跑 `node scripts/generate_docs_html.js` 同步文档
- [ ] 回归：`npm test`（Jest）+ 登录、仪表板、三大报表、费用报销、付款申请、审批中心、数据质量扫描、AI 治理驾驶舱
- [ ] 推 GitHub 触发 CI：等 `Actions` 绿了才能合入 main
- [ ] 提交并推送 GitHub
