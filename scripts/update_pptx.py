"""
更新 ERMM_高管價值簡報_PPTX — 將 CTO-02~CTO-09 交付事實寫入對應 slides
"""
import copy, shutil
from pptx import Presentation
from pptx.util import Pt
from pptx.enum.text import PP_ALIGN

SRC = r'e:\finance\docs\ERMM_高管價值簡報_CEO_CFO_COO_CTO.pptx'
DST = r'e:\finance\docs\ERMM_高管價值簡報_CEO_CFO_COO_CTO.pptx'

shutil.copy2(SRC, SRC + '.bak')  # 備份

prs = Presentation(SRC)
updates = [0]  # 計數器

def replace_text_in_slide(slide, old, new):
    """在整個 slide 裡查找並替換文字（保留 paragraph 格式）"""
    found = False
    for shape in slide.shapes:
        if shape.has_text_frame:
            for para in shape.text_frame.paragraphs:
                for run in para.runs:
                    if old in run.text:
                        run.text = run.text.replace(old, new)
                        found = True
                # 有時只有 paragraph 沒有 runs
                if not para.runs and old in para.text:
                    # 需要在 paragraph 裡插入 run
                    pass
        if shape.has_table:
            tbl = shape.table
            for row in tbl.rows:
                for cell in row.cells:
                    for para in cell.text_frame.paragraphs:
                        for run in para.runs:
                            if old in run.text:
                                run.text = run.text.replace(old, new)
                                found = True
    if found:
        updates[0] += 1
        print(f'  ✅ 替換 "{old[:30]}..." → "{new[:30]}..."')
    return found


# ============================================================
# Slide 2: 系統總覽數字事實
# ============================================================
s2 = prs.slides[1]
print('=== Slide 2 系統總覽 ===')
replace_text_in_slide(s2, '60 个前端入口 / 8 个菜单分组', '78 个功能模组 · 68 个前端页面 / 8 个菜单分组')
replace_text_in_slide(s2, '64 个 API 路由 · 89 张资料表', '74 个 API 路由 · 142 张资料表 · 58 个迁移脚本')
replace_text_in_slide(s2, '46 个已注册页面支持简/繁/英切换', '68 个已注册页面支持简/繁/英切换')
replace_text_in_slide(s2, '41 条知识库 / 6 分类', '41 条知识库 / 6 分类；AI 治理层 10 种模型计价 + 完整审计')
# 新增一行 CTO 基礎設施
for shape in s2.shapes:
    if shape.has_text_frame:
        for para in shape.text_frame.paragraphs:
            for run in para.runs:
                if 'AI 智能层 5 大能力' in run.text:
                    # 在這個 paragraph 後面加一個新的 paragraph
                    tf = shape.text_frame
                    new_para = tf.add_paragraph()
                    new_para.text = 'CTO 基础设施 8 项已交付：细粒度权限 55 按钮三角色矩阵 + 全量操作审计 + 合同主档 28 栏 9 端点 + 指标中心 23 指标统一口径 + 三通道消息通知（Email/Lark/企微）+ GitHub Actions CI/CD + AI 治理完整审计/成本/速率限制 + 52 单元测试 0 失败'
                    for r in new_para.runs:
                        r.font.size = Pt(14)
                    updates[0] += 1
                    print('  ✅ 新增 CTO 基础设施 paragraph')

# ============================================================
# Slide 29: CTO 价值 1 — 架构
# ============================================================
s29 = prs.slides[28]
print('=== Slide 29 CTO 价值 1 ===')
replace_text_in_slide(s29, '64 个路由模块化（按业务域分 7 组', '74 个路由模块化（按业务域分 8 组')
replace_text_in_slide(s29, '6 个前端入口"', '68 个前端页面"')

# ============================================================
# Slide 30: CTO 价值 2 — 安全與權限
# ============================================================
s30 = prs.slides[29]
print('=== Slide 30 CTO 价值 2 ===')
for shape in s30.shapes:
    if shape.has_text_frame:
        for para in shape.text_frame.paragraphs:
            for run in para.runs:
                if '四级权限：员工 / 部门主管 / 高阶主管 / 管理员' in run.text:
                    run.text = '细粒度权限三角色矩阵：一般员工 / 操作员 / 高阶主管（admin=Yes/Operator/No 三级）· cams_permission_button 55 按钮 × 3 角色 allow 矩阵 · middleware/perms.js 自动注入 readScope 数据行级过滤 + requireButton 按钮级拦截'
                    updates[0] += 1
                    print('  ✅ 權限體系更新為細粒度按鈕 + 數據行級')
                if '审计日志：敏感操作（签核解锁、资料增删改）记录人/IP/时间/新旧值快照' in run.text:
                    run.text = '全量操作审计：routes/audit.js 10 端点覆盖全模块（查询/分頁/匯出/詳情）· CTO-09 AI 審計自動串接（每次 LLM 呼叫落库 ermm_ai_audit · 10 種模型計價自動算 cost_usd · fail-open 速率限制）'
                    updates[0] += 1
                    print('  ✅ 審計更新為全量操作 + AI 審計串接')

# ============================================================
# Slide 32: CTO 价值 4 — AI 就緒與可觀測性
# ============================================================
s32 = prs.slides[31]
print('=== Slide 32 CTO 价值 4 ===')
for shape in s32.shapes:
    if shape.has_text_frame:
        for para in shape.text_frame.paragraphs:
            for run in para.runs:
                if '排程器、批次管线、整合作业全程日志' in run.text:
                    run.text = 'CTO-05 合同主档：Migration 057 ermm_contract 28 栏 · 9 API 端点 · 前端 4 页签 Dashboard（列表/统计/创建/编辑）· 从 ermm_erp_po 自动种 10 笔示范 · 合同价格差异自动标红与三单匹配联动'
                    updates[0] += 1
                    print('  ✅ 合同主檔項目插入')
                if '三语 i18n（简/繁/英） 架构支持跨区域扩展' in run.text:
                    run.text = 'CTO-06 指标中心：Migration 056 cams_metric_def 23 指标 · 7 类别 · services/metricCenter.js 统一计算引擎 · ROE 统一口径（net_profit_amt 替代 sale_exp_amt）· HM 2025-12 ROE 从 0.54% 校准至 2.57%'
                    updates[0] += 1
                    print('  ✅ 指標中心項目插入')
                if '系统文件内置：架构图 + 数据表关系图 + 使用者操作手册' in run.text:
                    run.text = 'CTO-07 消息通知 + CTO-08 CI/CD：cams_notif_channel 3 默认（Email/Lark/企微 webhook）· cams_notif_subscription 6 规则 · services/notifier.js 统一入口 · kpiAlertScanner 自动触发；GitHub Actions CI（MySQL 8 service + Jest 17 test files 52+ points + Codecov + 30 天 artifact）'
                    updates[0] += 1
                    print('  ✅ 通知 + CI/CD 項目插入')
                if '管理收益：AI 层「只读分析、不回写账务」的设计原则保证数据安全' in run.text:
                    run.text = 'CTO-09 AI 治理完整落地：ermm_ai_audit 每次 LLM 呼叫全量落库（provider/model/tokens/latency/cost_usd）· cams_ai_model_pricing 10 种模型 USD/1K tokens 计价 · cams_ai_rate_limit global + bu 四档 fail-open 配额 · services/llmAudit.js auditCall + calcCost + checkRateLimit 三函数 · routes/llmAudit.js 10 管理端点 · 前端 6 页签 Dashboard（概览/审计/成本/排行/计价/限流）'
                    updates[0] += 1
                    print('  ✅ AI 治理項目插入')

# ============================================================
# Slide 38: 四高管對照總表 — 更新 CTO 行
# ============================================================
s38 = prs.slides[37]
print('=== Slide 38 四高管對照總表 ===')
if s38.shapes[0].has_table:
    tbl = s38.shapes[0].table
    for ri, row in enumerate(tbl.rows):
        cell0 = row.cells[0].text.strip()
        if cell0 == 'CTO':
            # 依次更新四個維度
            cells = list(row.cells)
            if len(cells) >= 5:
                # 核心收益
                cells[1].text = '架构可控 + 安全合规 + AI 治理 + 合同主档 + 指标中心'
                # 关键功能
                cells[2].text = '55 按钮三角色权限矩阵 · 全量操作审计 · 合同主档 28 栏 9 端点 · 指标中心 23 指标统一 ROE · 三通道消息通知 · 10 端点 AI 治理 Dashboard'
                # 效率提升
                cells[3].text = '新功能 三板斧快速落地；CI/CD 自动化 + 52 单元测试 0 失败；AI 治理成本自动算；合同价格差异自动标红'
                # 风险控制
                cells[4].text = '细粒度权限矩阵 + 全量审计 + 合同主档与 PO 关联；AI 治理 fail-open 速率限制；LLM 每次呼叫自动落库审计'
                updates[0] += 1
                print('  ✅ CTO 對照總表行更新')

# ============================================================
# Slide 39: 量化價值速覽 — 新增 CTO 項目
# ============================================================
s39 = prs.slides[38]
print('=== Slide 39 量化價值速覽 ===')
# 在最後一段（庫存治理）後面追加 CTO 交付事實
for shape in s39.shapes:
    if shape.has_text_frame:
        full_text = '\n'.join(p.text for p in shape.text_frame.paragraphs)
        if '库存治理' in full_text:
            # 找最後一個 paragraph 之後加
            tf = shape.text_frame
            new_para = tf.add_paragraph()
            new_para.text = 'CTO 基础设施工具化：权限矩阵 78 模组 × 55 按钮 × 3 角色；AI 治理 10 种模型自动算价 + 每次呼叫完整审计；CI/CD 17 测试文件 52+ 测试点 0 失败；合同主档与采购/三单匹配全链路打通'
            for r in new_para.runs:
                r.font.size = Pt(14)
            updates[0] += 1
            print('  ✅ 量化速覽新增 CTO 基礎設施')

# ============================================================
# Slide 40: 结尾 — 更新下一步
# ============================================================
s40 = prs.slides[39]
print('=== Slide 40 结尾 ===')
for shape in s40.shapes:
    if shape.has_text_frame:
        for para in shape.text_frame.paragraphs:
            for run in para.runs:
                if '下一步：真实税局对接' in run.text:
                    run.text = '下一步（v3.1 剩餘缺口）：CTO-10 移动端 PWA · COO-06 质量售后 · COO-07 分公司运营 · CEO-03 投资决策敏感性分析 · 真实税局对接 · 银行流水直连 · 合同→三单匹配全链路自动化 · 库存呆滞处置与减值联动'
                    updates[0] += 1
                    print('  ✅ 下一步更新')

# ============================================================
# 保存
# ============================================================
prs.save(DST)
print(f'\n保存到: {DST}')
print(f'共 {updates[0]} 處替換/新增')

# 驗證
prs2 = Presentation(DST)
print(f'\n驗證: {len(prs2.slides)} slides')
keywords = ['55 按钮', 'CTO-05 合同', 'CTO-09 AI 治理', '74 个 API', '142 张资料表', '23 指标', 'fail-open', '52 单元测试', '三角色']
for kw in keywords:
    found = False
    for s in prs2.slides:
        for shape in s.shapes:
            txt = ''
            if shape.has_text_frame:
                txt = shape.text_frame.text
            if shape.has_table:
                for row in shape.table.rows:
                    for cell in row.cells:
                        txt += cell.text
            if kw in txt:
                found = True
                break
        if found:
            break
    print(f'  {"✅" if found else "❌"} "{kw}"')
