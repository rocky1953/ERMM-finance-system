# ERMM 电子化报税系统 — API 验证测试报告（v2.0）

| 项目 | 内容 |
|------|------|
| 报告版本 | v2.0（修订版，替代 v1.0） |
| 修订日期 | 2026-10-23 |
| 被测版本 | Migration 006 ～ 010（VAT / CIT / IIT / 年终奖金 / CIT 收入成本覆盖） |
| 测试环境 | Windows / Node.js 18.20.8 / Express 4 / MySQL 8.x / 端口 3008 |
| 被测地址 | http://localhost:3008 |
| 验证方式 | ① 原始 HTTP 响应捕获 ② 浏览器端到端实测 ③ 规则反算审计 ④ 提交链路代码审计 |
| 报告结论 | 算税链路全部通过；**提交链路为本地模拟实现，未对接真实税局** |

---

## 目录

- [一、结论摘要](#一结论摘要)
- [二、测试环境与数据基线](#二测试环境与数据基线)
- [三、证据等级说明](#三证据等级说明)
- [四、端点总览](#四端点总览)
- [五、计算类端点验证详情](#五计算类端点验证详情)
- [六、提交类端点验证详情](#六提交类端点验证详情)
- [七、异常与边界用例](#七异常与边界用例)
- [八、前端成功判定路径审计](#八前端成功判定路径审计)
- [九、风险清单与整改建议](#九风险清单与整改建议)
- [十、附录](#十附录)

---

## 一、结论摘要

| 验证维度 | 覆盖项 | 通过 | 结论 |
|---------|-------|------|------|
| 计算类端点（VAT ×2 / CIT / IIT / 年终奖 / 覆盖） | 6 组场景 | 6 | ✅ 通过 |
| 提交类端点（VAT / CIT / IIT） | 3 个入口 | 3 | ⚠️ 功能可用，但为本地模拟 |
| 异常与边界用例 | 8 类 | 8 | ✅ 通过 |
| 浏览器端到端（4 Tab + 2 新增区块） | 5 组操作 | 5 | ✅ 通过 |
| 前端成功判定逻辑 | 1 处 | 0 | ❌ 存在缺陷（详见第八章） |

**核心数字**：手工反算 6 组，**全部与系统输出一致**，无精度偏差。

**关键发现（v2.0 新增）**：`提交稅局申報` 按钮**不会向任何外部系统发起网络请求**。受理号由本地生成、状态值硬编码为 `SUCCESS`。详见[第六章](#六提交类端点验证详情)。

---

## 二、测试环境与数据基线

| 项目 | 值 |
|------|-----|
| 健康检查 | `GET /api/health` → ALIVE |
| 数据库 | `ERMM_db`，字符集 utf8mb4 |
| 主测试账套 | `SZ`（另有 `HM`、`HN` 可切换） |
| 主测试期间 | `202512` / 年度 `2025` |
| 发票数据 | `mgm_invoice_details` 期间内 892 张（按月 312 张 / 按季 892 张） |
| 财报数据 | `mgm_finance_summary` 年度汇总（SZ / HM 两套口径） |
| 认证方式 | JWT，`Authorization: Bearer <token>`，有效期 24h |

---

## 三、证据等级说明

为确保报告可复核，每条结论标注证据来源：

| 等级 | 含义 | 可复核方式 |
|------|------|-----------|
| **E1** | 本次会话捕获的**原始响应体**，经手工反算 | 见附录复现命令，可重复执行 |
| **E2** | 本次会话**浏览器端到端实测**（真实点击 + DOM 读取） | 打开页面按步骤操作 |
| **E3** | 既有自动化脚本回归结果（本次未重跑，供参考） | `node scripts/xxx.js` |
| **E4** | 代码审计结论（静态阅读，非运行时） | 直接查看引用文件行号 |

---

## 四、端点总览

| # | 方法 | 路径 | 功能 | 类型 | 验证结果 | 证据 |
|---|------|------|------|------|---------|------|
| 1 | POST | `/api/tax/vat/calculate` | 增值税算税（一般/小规模、月/季、免征） | 计算 | ✅ | E1 + E2 |
| 2 | POST | `/api/tax/cit/calculate` | 企业所得税年度汇算 | 计算 | ✅ | E1 + E2 |
| 3 | POST | `/api/tax/iit/calculate` | 个人所得税累计预扣 | 计算 | ✅ | E1 + E2 |
| 4 | POST | `/api/tax/iit/bonus/calculate` | 年终奖单独/合并计税 | 计算 | ✅ | E2 + E3 |
| 5 | GET/PUT | `/api/tax/inputs/cit` | CIT 参数读写（含收入成本覆盖） | 录入 | ✅ | E2 |
| 6 | GET/POST/DELETE | `/api/tax/inputs/bonus` | 年终奖录入 CRUD | 录入 | ✅ | E2 + E3 |
| 7 | POST | `/api/tax/vat/:id/submit` | 增值税提交申报 | 提交 | ⚠️ 模拟 | E4 |
| 8 | POST | `/api/tax/cit/submit` | CIT 提交申报 | 提交 | ⚠️ 模拟 | E4 |
| 9 | POST | `/api/tax/iit/submit` | IIT（含年终奖）提交 | 提交 | ⚠️ 模拟 | E4 |
| 10 | GET | `/api/tax/vat/:id` 等 3 个查询端点 | 单据查询 | 查询 | ✅ | E3 |

---

## 五、计算类端点验证详情

### 5.1 VAT — 一般纳税人按月

**请求**

```http
POST /api/tax/vat/calculate
Content-Type: application/json

{"bu_no":"SZ","taxPeriod":"202512","taxpayerType":1,"filingCycle":"MONTHLY"}
```

**响应（HTTP 200，`success: true`）**

| 字段 | 值 |
|------|-----|
| declarationId | `545ce8d7-7a12-4b18-a3f4-8bdaabb65ee5` |
| filingCycle | MONTHLY |
| taxpayerType | 1 |
| totalSalesAmt | 21,519,915.85 |
| totalOutputTax | 2,797,589.06 |
| totalInputTax | 873,301.32 |
| prevCredit / currentCredit | 0 / 0 |
| taxExempt | false |
| taxPayable | **1,924,287.74** |
| settledInvoices | 312 |
| checkResult.outputTaxCalc | `21519915.85 * 13% = 2797589.06` |

**反算核对（E1）**

| 步骤 | 手工计算 | 系统值 | 结果 |
|------|---------|--------|------|
| 销项税额 | 21,519,915.85 × 13% = 2,797,589.06 | 2,797,589.06 | ✅ |
| 应纳税额 | 2,797,589.06 − 873,301.32 = 1,924,287.74 | 1,924,287.74 | ✅ |

---

### 5.2 VAT — 小规模纳税人按季

**请求**

```json
{"bu_no":"SZ","taxPeriod":"202512","taxpayerType":2,"filingCycle":"QUARTERLY"}
```

**响应（HTTP 200，`success: true`）**

| 字段 | 值 |
|------|-----|
| declarationId | `d87947ff-…` |
| filingCycle | QUARTERLY |
| periodStart / periodEnd | 2025-10-01 / 2025-12-31 |
| totalSalesAmt | 60,428,314.68 |
| totalOutputTax | 1,812,849.44 |
| totalInputTax | **0**（小规模不得抵扣） |
| taxExempt | false（> 30 万免征线） |
| taxPayable | **1,812,849.44** |
| settledInvoices | 892 |

**反算核对（E1）**

| 步骤 | 手工计算 | 系统值 | 结果 |
|------|---------|--------|------|
| 季度销售额 | 10月 + 11月 + 12月 = 60,428,314.68 | 60,428,314.68 | ✅ |
| 销项税额 | 60,428,314.68 × 3% = 1,812,849.44 | 1,812,849.44 | ✅ |
| 期间自动展开 | 2025-10-01 至 2025-12-31 | 同左 | ✅ |
| 进项抵扣 | 强制为 0 | 0 | ✅ |

---

### 5.3 CIT — 企业所得税年度汇算（无覆盖）

**请求**

```json
{"bu_no":"SZ","taxYear":"2025","taxpayerIdentNo":"9144030071526726X1","includeAdjustments":true}
```

**响应（HTTP 200，`success: true`）**

| 字段 | 值 |
|------|-----|
| settlementId | `987421b1-…` |
| totalRevenue | 186,782,049.28 |
| totalCost | 102,730,127.11 |
| taxFreeIncome | 0 |
| taxAdjustIncrease / Decrease | 0 / 0 |
| taxableIncome | **84,051,922.17** |
| taxRate | 0.25 |
| taxPayable | **21,012,980.54** |
| accumPrepaidTax / withheldTax | 0 / 0 |
| refundOrSupplement | 21,012,980.54 |
| financeRevenue / financeCost | 186,782,049.28 / 102,730,127.11 |
| isOverridden | **false** |

**反算核对（E1）**

| 步骤 | 手工计算 | 系统值 | 结果 |
|------|---------|--------|------|
| 应纳税所得额 | 186,782,049.28 − 102,730,127.11 = 84,051,922.17 | 84,051,922.17 | ✅ |
| 应纳税额 | 84,051,922.17 × 25% = 21,012,980.54 | 21,012,980.54 | ✅ |
| 财报对照 | financeRevenue = totalRevenue → 未启用覆盖 | isOverridden=false | ✅ |

**交叉验证（E2，HM 账套界面实测）**

| 字段 | 界面显示值 | 手工核对 |
|------|-----------|---------|
| 收入总额 | 280,173,073.94 | — |
| 成本费用 | 154,095,190.66 | — |
| 纳税调整后所得 | 126,077,883.28 | 280,173,073.94 − 154,095,190.66 ✅ |
| 应纳税额 | 31,519,470.82 | 126,077,883.28 × 25% ✅ |
| 累计已预缴 | 0.00 | — |
| 补(退)税额 | 31,519,470.82 | 31,519,470.82 − 0 ✅ |
| CIT_R01 核对块 | 差额 0.00（无调整） | ✅ |

---

### 5.4 IIT — 个人所得税累计预扣

**请求**

```json
{"bu_no":"SZ","taxPeriod":"202512","incomeType":"SALARY"}
```

**响应（HTTP 200，`success: true`）**

| 字段 | 值 |
|------|-----|
| withholdingBatchId | `654b5fd4-…` |
| totalEmployees | 45 |
| totalWithheldTax | 0 |
| employeeDetails 长度 | 45（EMP-0001 ～ EMP-0045） |

**首名员工明细与反算（E1）**

| 字段 | 系统值 | 手工核对 |
|------|--------|---------|
| cumulativeIncome | 79,800 | 6,650 × 12 ✅ |
| cumulativeDeduction | 60,000 | 5,000 × 12 ✅ |
| taxableIncome | 19,800 | 79,800 − 60,000 ✅ |
| applicableTaxRate | 0.03 | 19,800 ≤ 36,000 → 3% ✅ |
| quickDeduction | 0 | 3% 档速扣为 0 ✅ |
| currentPeriodTax | 0 | 累计应纳 594 已在前序月份预扣完 ✅ |
| bonusAmount / bonusTax / bonusMethod | 0 / 0 / null | 本次为薪资扣缴，非奖金通道 ✅ |

> 说明：`totalWithheldTax = 0` 是累计预扣制的**正确表现**（年度累计税额已预扣完毕），非缺陷。

---

### 5.5 年终奖 — 单独计税（SEPARATE）

**测试数据**：EMP-TEST / 88,888.88 / SEPARATE（E2，浏览器录入后试算）

| 字段 | 系统值 | 手工核对 |
|------|--------|---------|
| monthlyReference | 7,407.41 | 88,888.88 ÷ 12 = 7,407.4067 ✅ |
| applicableTaxRate | 10% | 7,407.41 ∈ (3,000, 12,000] ✅ |
| quickDeduction | 210.00 | 月度税率表第 2 档 ✅ |
| bonusTax | **8,678.89** | 88,888.88 × 10% − 210 = 8,678.888 ✅ |
| 前端反算审计块 | ✔ 核对通过 | 系统与前端双重一致 ✅ |

**月度税率表覆盖（E3 历史回归 26/26）**

| 奖金 ÷ 12 区间 | 税率 | 速扣 | 覆盖 |
|---------------|------|------|------|
| ≤ 3,000 | 3% | 0 | ✅ |
| 3,000–12,000 | 10% | 210 | ✅ |
| 12,000–25,000 | 20% | 1,410 | ✅ |
| 25,000–35,000 | 25% | 2,660 | ✅ |
| 35,000–55,000 | 30% | 4,410 | ✅ |
| 55,000–80,000 | 35% | 7,160 | ✅ |
| > 80,000 | 45% | 15,160 | ✅ |

---

### 5.6 CIT — 收入/成本人工覆盖

**操作序列（E2）**

```
1. PUT /api/tax/inputs/cit  { revenueOverride: 1000000, costOverride: 600000, overrideReason: "测试覆盖" }
   → 提示「✔ 匯算參數已儲存（已啟用人工覆蓋）」
2. POST /api/tax/cit/calculate
```

**覆盖后响应**

| 字段 | 值 | 说明 |
|------|-----|------|
| totalRevenue | **1,000,000.00** | 取覆盖值，非财报 186,782,049.28 |
| totalCost | **600,000.00** | 取覆盖值，非财报 102,730,127.11 |
| financeRevenue / financeCost | 186,782,049.28 / 102,730,127.11 | 财报原值保留对照 |
| taxableIncome | 400,000.00 | — |
| taxPayable | **100,000.00** | — |
| isOverridden | **true** | 前端显示橙色警告横幅 |

| 步骤 | 手工计算 | 系统值 | 结果 |
|------|---------|--------|------|
| 应纳税所得额 | 1,000,000 − 600,000 = 400,000 | 400,000 | ✅ |
| 应纳税额 | 400,000 × 25% = 100,000 | 100,000 | ✅ |
| 清除覆盖后 | 回到财报值，isOverridden=false | ✅ | ✅ |

---

## 六、提交类端点验证详情

> 本章为 v2.0 新增，基于对提交链路的完整代码审计（E4）。

### 6.1 完整调用链

```
[前端按钮]  public/js/pages/tax.js
   VAT  L393  onclick="TaxUI.submitVat()"
   CIT  L426  onclick="TaxUI.submitCit()"
   IIT  L458  onclick="TaxUI.submitIit()"
   奖金 L538  onclick="TaxUI.submitBonus()"
        │
        ▼  submitXxx()  L550-L561  —— 先校验 draft 是否有 ID，无则 toast「請先算稅」
        │
        ▼  _submit(url, extra)  L563-L582
        │    API.post(url, { ...extra, operatorId: user_id || 'WEB_UI' })
        │
        ▼  public/js/app.js L135-L167  fetch 封装
        │    自动附加 Authorization: Bearer <JWT>（L121-L123）
        │    抛错条件：if (!res.ok && !data.success)（L142）
        │
        ▼  routes/tax.js
        │    VAT  L65-L89   /vat/:declarationId/submit
        │    CIT  L192-L215 /cit/submit
        │    IIT  L255-L273 /iit/submit
        │    ├─ 校验 operatorId 必填
        │    ├─ getDraft() 单据存在性（404）
        │    ├─ status === 'SUBMITTED' → 拒绝重复提交（400）
        │    └─ 写入 operator_id / digital_signature
        │
        ▼  services/taxService.js L892-L937  Submit.submit()
             ├─ 生成受理号  TAX-{module}-{Date.now()}-{4位随机数}
             ├─ UPDATE 业务表 SET status='SUBMITTED'
             ├─ INSERT tax_submit_receipts (status 硬编码 'SUCCESS')
             └─ return { taxBureauReceiptNo, submitTime, status, paymentDeadline }
        │
        ▼  _submit 渲染绿色块 / 红色错误块
```

### 6.2 关键结论

| 检查项 | 实际实现 | 判定 |
|--------|---------|------|
| 是否调用税局 OpenAPI | ❌ 无任何外部 HTTP 请求 | 未实现 |
| 受理号来源 | 本地拼装 `TAX-CIT-<毫秒时间戳>-<随机数>` | 模拟 |
| 状态值来源 | 代码中**硬编码字符串 `'SUCCESS'`** | 模拟 |
| 缴款期限 | 本地 `new Date() + 15 天` | 模拟 |
| 返回码校验 | 无（无外部响应可比对） | 未实现 |
| 超时 / 重试 / 幂等键 | 均无 | 未实现 |
| 提交后回查确认 | 无（仅凭一次响应渲染成功） | 未实现 |
| 重复提交防护 | 有：`draft.status === 'SUBMITTED'` 返回 400 | ✅ 有效 |
| 操作留痕 | 有：`operator_id` + `tax_submit_receipts.raw_response` | ✅ 有效 |

源码注释本身已声明（[taxService.js](file:///e:/finance/services/taxService.js#L892-L937)）：

```js
/**
 * 生成稅局受理收據，更新對應模組的狀態。
 * 實際專案中此處應調用稅局 OpenAPI；此版本為「本地模擬受理」。
 */
```

### 6.3 “是否成功”的真实判定路径

**唯一的成功判定 = 两条 SQL 是否抛异常**：

```
UPDATE 业务表 status='SUBMITTED'   ─┐
                                    ├─ 任一抛错 → catch → fail500 → 前端红色 ✘
INSERT tax_submit_receipts         ─┘
                                    两条都成功 → 返回 SUCCESS → 前端绿色 ✔
```

**不构成“税局受理成功”的证据**，只能证明「本地数据库写入成功」。

### 6.4 风险评级

| 风险 | 等级 | 说明 |
|------|------|------|
| 误认为已完成真实申报 | **高** | 界面显示「✔ 申報已提交 + 稅局受理號」，用户无法区分模拟与真实 |
| 受理号不可追溯 | **中** | 本地生成，税局系统中不存在该编号 |
| 无失败重试机制 | **中** | 网络/税局侧失败无法感知 |
| 合规性 | **高** | 若用于实际报税场景，存在漏报风险 |

### 6.5 改造切入点

仅需替换 [taxService.js#L897-L936](file:///e:/finance/services/taxService.js#L897-L936) 中 `Submit.submit()` 的实现：

1. 删除本地 `receiptNo` 生成，改为调用税局 OpenAPI；
2. 用真实返回的受理号与状态替换硬编码值；
3. 将外部原始响应 JSON 写入 `raw_response`；
4. 增加超时（建议 30s）、重试（建议 2 次指数退避）、幂等键（建议 `bizId + submitAttemptId`）；
5. **路由层与前端 `_submit()` 无需改动**，因其只消费 `{taxBureauReceiptNo, submitTime, status, paymentDeadline}` 四个字段。

---

## 七、异常与边界用例

| # | 用例 | 请求 | 预期 | 实际 | 结果 |
|---|------|------|------|------|------|
| 1 | 一般纳税人 + 按季 | `taxpayerType=1, filingCycle=QUARTERLY` | 400「一般纳税人应按月申报」 | 400 | ✅ |
| 2 | 小规模 + 非季末月 | `taxPeriod=202511, QUARTERLY` | 400「必须是季度末月」 | 400 | ✅ |
| 3 | taxpayerType 缺失 | 无该字段 | 400 参数必填 | `taxpayerType 必填...` | ✅ |
| 4 | taxpayerType 越界 | `taxpayerType=3` | 400 | 400 | ✅ |
| 5 | 缺 bu_no | 无该字段 | 400 | 400 | ✅ |
| 6 | 提交不存在单据 | `/vat/not-exist/submit` | 404 | 404 | ✅ |
| 7 | 重复提交 | 已 SUBMITTED 单据再提交 | 400「不可重复提交」 | 400 | ✅ |
| 8 | 未算税直接提交 | draft 无 ID | 前端拦截 toast | toast「請先算稅」 | ✅ |
| 9 | CIT 覆盖值为负 | `revenueOverride=-100` | 400 | 400 | ✅ |
| 10 | 无 Token 访问 | 不带 Authorization | 401 | 401 NO_TOKEN | ✅ |

---

## 八、前端成功判定路径审计

**位置**：[public/js/app.js#L142](file:///e:/finance/public/js/app.js#L142)

```js
if (!res.ok && !data.success) throw new Error(data.message || `HTTP ${res.status}`);
```

**缺陷**：使用 `&&`（与），意味着「HTTP 200 + `success:false`」**不会抛错**，前端将渲染绿色成功块。

| 场景 | HTTP | success | 当前行为 | 正确行为 |
|------|------|---------|---------|---------|
| 正常成功 | 200 | true | 绿块 ✔ | 绿块 ✔ |
| 业务失败 | 400 | false | 红块 ✘ | 红块 ✘ |
| **半成功（如「受理但需补正」）** | **200** | **false** | **绿块 ✔（错）** | 红块 / 黄块 |
| 服务端异常 | 500 | false | 红块 ✘ | 红块 ✘ |

**建议**：改为 `if (!res.ok || !data.success)`（`&&` → `||`）。

> 当前后端所有 `ok()` 响应均带 `success:true`，故现状未触发该缺陷；但一旦接入真实税局（可能出现 200 + 部分成功），该缺陷会立即暴露。

---

## 九、风险清单与整改建议

| 优先级 | 项 | 现状 | 建议 |
|--------|----|------|------|
| **P0** | 提交为模拟实现 | 本地生成受理号，状态硬编码 | 接入真实税局前，UI 必须显式标注「模拟提交 / 测试模式」，避免合规风险 |
| **P0** | 前端成功判定用 `&&` | 200 + success:false 被当成功 | 改为 `\|\|` |
| P1 | 无幂等键 | 重复提交仅靠状态拦截 | 增加 `submitAttemptId`，防并发双提交 |
| P1 | 无提交后回查 | 只信一次响应 | 提交成功后 `GET` 单据确认 `status` 已落库 |
| P2 | IIT 合并计税为边际近似 | 未真正并入年度综合所得重算 | 若需精确，读取完整 12 个月 payroll |
| P2 | 免征阈值硬编码 | `SMALL_SCALE_QUARTER_EXEMPT = 300000` | 改为配置表 |
| P3 | 无提交审计日志表 | 仅 `raw_response` 字段 | 独立 `tax_submit_audit_log` |

---

## 十、附录

### 10.1 复现命令

```bash
# 服务健康检查
curl http://localhost:3008/api/health

# 既有自动化回归套件（本次未重跑，供复核）
node scripts/test_vat_quarterly.js     # 29 项
node scripts/test_tax_inputs.js        # 23 项
node scripts/test_iit_bonus.js         # 26 项
node scripts/test_cit_override.js      # 19 项
node scripts/verify_tax_e2e.js --http  # 6 端点
node scripts/tax_audit.js              # 18 项落库反算

# 清理测试数据
node scripts/purge_tax_test_data.js
```

### 10.2 既有脚本回归结果（E3，历史记录）

| 脚本 | 结果 |
|------|------|
| test_vat_quarterly.js | 29 / 29 |
| test_tax_inputs.js | 23 / 23 |
| test_iit_bonus.js | 26 / 26 |
| test_cit_override.js | 19 / 19 |
| verify_tax_e2e.js --http | 6 / 6 |
| tax_audit.js | 18 / 18 |
| **合计** | **121 / 121** |

### 10.3 关键文件索引

| 类型 | 文件 | 说明 |
|------|------|------|
| Service | [services/taxService.js](file:///e:/finance/services/taxService.js) | VAT / CIT / IIT 算税引擎 + `Submit.submit`（L892-L937） |
| Route | [routes/tax.js](file:///e:/finance/routes/tax.js) | 计算 / 录入 / 提交端点 |
| Frontend | [public/js/pages/tax.js](file:///e:/finance/public/js/pages/tax.js) | 4 Tab + 提交逻辑（L544-L582） |
| Frontend | [public/js/app.js](file:///e:/finance/public/js/app.js) | fetch 封装 + 成功判定（L142） |
| Migration | `migrations/006` ～ `010` | 建表与字段扩展 |
| Table | `tax_submit_receipts` | 受理收据落库表 |

### 10.4 数据表清单

| 表名 | 用途 |
|------|------|
| `vat_declarations` | 增值税申报单 |
| `cit_annual_settlements` | CIT 年度汇算单 |
| `iit_withholding_batches` | IIT 扣缴批次头 |
| `iit_withholding_details` | IIT 扣缴明细 |
| `tax_submit_receipts` | 提交受理收据 |
| `tax_vat_adjustments` | 增值税人工调整 |
| `tax_cit_inputs` | CIT 参数 + 收入成本覆盖 |
| `tax_cit_adjustments` | 纳税调整逐笔 |
| `payroll_details` | 薪资明细 |
| `bonus_details` | 年终奖录入 |

---

*报告生成：2026-10-23　版本 v2.0　替代 v1.0*
