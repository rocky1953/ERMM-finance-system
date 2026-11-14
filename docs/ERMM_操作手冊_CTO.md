> 适用角色：CTO / IT 负责人 / 系统管理员｜适用版本：v3.2（2026-11-05）
> 系统地址：http://localhost:3008 ｜部署形态：单机 Node.js + MySQL 8
> 本手册聚焦「系统在你手上怎么跑、怎么管、怎么排障」，业务口径请参考 CFO 手册。

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
| 数据库 | MySQL 8，库名 `ermm_db`，83 张表 |
| 端口 | 3008 |
| 认证 | JWT，令牌存 `localStorage.ermm_token`，全站 401 统一拦截 |
| 前端 | 原生 HTML/CSS/JS + `registerPage()` 页面注册，无框架 |
| LLM | DeepSeek（预设），配置表 `llm_config`，统一走 `utils/llmClient.js → getDefaultProvider(pool)` |
| 路由 | 48 个路由模块，挂载于 `/api/*` |
| 静态资源 | `public/`（`express.static`，`etag:false`） |
| 文档路由 | `/docs/architecture`、`/docs/executive`、`/docs/data-model`（`Cache-Control: no-store`） |

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
routes/*.js       # 64 个路由模块（按业务域，app.js 挂载 64 个 /api 前缀）
services/*.js     # 13 个业务服务（财务计算、税务算税、整合、滚动预算、库存周转）
utils/llmClient.js# LLM 服务商选择（必须统一走这里）
scheduler/*.js    # 告警与整合排程
migrations/*.sql  # 45 个迁移脚本（001~032，含子版本）+ run_all.sql
public/           # 前端页面（60 个页面脚本）与静态资源
docs/             # 架构、数据表、手册（md + 生成后的 html）
scripts/          # generate_docs_html.js 文档生成器
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

---

# 三、账号与权限管理（👤 使用者管理）

- **入口**：系统 · 主档管理 → **使用者管理**。
- **用户类型**：一般员工 / 部门主管 / 高阶主管 / 管理员。
- **管理员判定**：`cams_xuser.admin = 'Yes'`（系统内统一 Yes/No，migration 012 起）。
- **常见操作**：
  1. 新增用户 → 填写账号、姓名、部门、角色 → 保存。
  2. 调整角色 → 修改用户类型与管理員标记。
  3. 停用离职账号 → 状态置为停用（不要删除，保留审计痕迹）。
- **测试账号**：`rocky / 68315711`（管理员）、`S10049 / 68315711`（一般员工，用于验证权限拦截）。

> **权限设计原则**：前端只做**体验层拦截**（如「系统文件」菜单），真正的数据安全依赖后端 `authRequired` 的 JWT 校验。敏感接口必须在路由层再校验角色。

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

## 5.1 批次管线

- **入口**：系统 · 主档管理 → **批次管线**。
- **内容**：7 个步骤的数据加工（取数 → 校验 → 汇总 → 指标计算 → 落库）。
- **操作**：选择公司与月份 → 执行 → 查看每步状态与耗时 → 失败步骤可重跑。
- **排障**：若仪表板某月无数据，优先确认该月批次是否跑完；单步失败看日志定位。

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

# 七、AI 智能层（运维视角）

| 功能 | 端点 | 依赖 | 排障要点 |
|---|---|---|---|
| AI 问答 | `/api/aiqa/ask` | `ermm_knowledge` + LLM | 无回答先查 `llm_config` 预设；未命中查 `ermm_kb_miss_log` |
| 每日摘要 | `/api/daily-summary/*` | LLM + 财务表 | 卡片空白查 provider 与网络；历史在 `daily_ai_summary` |
| AR 催收 | `/api/ar-smart/*` | `mgm_invoice_details` | 清单空=无 AR 明细 |
| 质量扫描 | `/api/data-quality/scan` | 全库只读 | 超时=表量过大，检查索引 |
| 概率预测 | `/api/cash-forecast/monte-carlo` | 现金历史 | 无数据=期间未加工 |

- **LLM 配置**：`llm_config` 表，`is_default=1 AND status='USE'` 为当前生效服务商。**禁止**在其他路由自行写 SQL 查 provider，统一用 `getDefaultProvider(pool)`。
- **安全边界**：AI 层**只读**，不写账务表；写入仅限 `ermm_knowledge`、`ermm_kb_miss_log`、`daily_ai_summary`。

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
- **审计**：凭证、报税提交、批次执行、整合日志均留痕，可追溯。
- **备份**：MySQL 定期备份（建议每日 + 月结前各一次），迁移前必须备份。
- **敏感配置**：`llm_config.api_key`、第三方库连接信息不要写入前端或提交仓库。

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

---

# 十一、变更管理清单（上线前自检）

- [ ] 迁移脚本按序执行（001~032），`run_all.sql` 可一键建置
- [ ] 新增路由在 `app.js` 挂载 `/api/xxx`
- [ ] 新增页面在 `cams_module_permission` 登记 `module_code`，且与 `index.html` 的 `data-page` 一致
- [ ] 前端新页面使用 `registerPage()`，并在 `index.html` 加 `?v=` 缓存戳
- [ ] 新增页面文案补齐三语 i18n
- [ ] 敏感接口在路由层校验角色
- [ ] 改完跑 `node scripts/generate_docs_html.js` 同步文档
- [ ] 回归：登录、仪表板、三大报表、数据质量扫描、AI 问答
- [ ] 提交并推送 GitHub
