# -*- coding: utf-8 -*-
"""
生成面向高级主管（CEO / CTO / CFO）的 ERMM 系统价值报告（Word 格式）
内容：各角色困扰 + 解决方案 + 系统亮点
"""
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn

doc = Document()

# ===== 全局样式 =====
style = doc.styles['Normal']
style.font.name = '微软雅黑'
style.font.size = Pt(11)
style.element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')

def set_cell_bg(cell, color_hex):
    """设置单元格背景色"""
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.makeelement(qn('w:shd'), {
        qn('w:fill'): color_hex,
        qn('w:val'): 'clear',
    })
    tc_pr.append(shd)

def add_heading(text, level=1, color='1A3C5E'):
    h = doc.add_heading(text, level=level)
    for run in h.runs:
        run.font.color.rgb = RGBColor.from_string(color)
        run.font.name = '微软雅黑'
        run.element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
    return h

def add_para(text, bold=False, size=11, color=None, align=None):
    p = doc.add_paragraph()
    if align:
        p.alignment = align
    run = p.add_run(text)
    run.font.name = '微软雅黑'
    run.element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
    run.font.size = Pt(size)
    run.bold = bold
    if color:
        run.font.color.rgb = RGBColor.from_string(color)
    return p

def add_table(headers, rows, header_color='1A3C5E', col_widths=None):
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.style = 'Table Grid'
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    # 表头
    for i, h in enumerate(headers):
        cell = table.rows[0].cells[i]
        cell.text = ''
        p = cell.paragraphs[0]
        run = p.add_run(h)
        run.bold = True
        run.font.color.rgb = RGBColor.from_string('FFFFFF')
        run.font.name = '微软雅黑'
        run.element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
        run.font.size = Pt(11)
        set_cell_bg(cell, header_color)
    # 数据行
    for ri, row in enumerate(rows):
        for ci, val in enumerate(row):
            cell = table.rows[ri + 1].cells[ci]
            cell.text = ''
            p = cell.paragraphs[0]
            run = p.add_run(str(val))
            run.font.name = '微软雅黑'
            run.element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
            run.font.size = Pt(10)
    if col_widths:
        for i, w in enumerate(col_widths):
            for cell in table.columns[i].cells:
                cell.width = Cm(w)
    return table

# ===== 封面 =====
title = doc.add_paragraph()
title.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = title.add_run('ERMM 企业经营管理系统')
run.font.size = Pt(28)
run.bold = True
run.font.color.rgb = RGBColor.from_string('1A3C5E')
run.font.name = '微软雅黑'
run.element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')

subtitle = doc.add_paragraph()
subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = subtitle.add_run('面向高级主管的价值报告')
run.font.size = Pt(20)
run.font.color.rgb = RGBColor.from_string('2E86C1')
run.font.name = '微软雅黑'
run.element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')

doc.add_paragraph()
info = doc.add_paragraph()
info.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = info.add_run('受众：CEO（首席执行官）· CTO（首席技术官）· CFO（首席财务官）')
run.font.size = Pt(12)
run.font.color.rgb = RGBColor.from_string('566573')
run.font.name = '微软雅黑'
run.element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')

date_p = doc.add_paragraph()
date_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = date_p.add_run('版本：v3.0 ｜ 日期：2026-10-15')
run.font.size = Pt(11)
run.font.color.rgb = RGBColor.from_string('7F8C8D')
run.font.name = '微软雅黑'
run.element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')

doc.add_page_break()

# ===== 一、执行摘要 =====
add_heading('一、执行摘要', level=1)
add_para(
    'ERMM 是一套覆盖「人力绩效管理 + 财务入账报税 + 现金流预测 + 第三方资料整合」'
    '的一体化企业经营管理平台。它将过去分散在 Excel、邮件、纸质单据中的经营数据，'
    '整合为即时、透明、可追溯的数据资产，让管理层从「凭感觉决策」升级为「凭数据决策」。',
    size=12
)
add_para('核心价值主张：', bold=True)
add_para('• 对 CEO：一眼看清公司经营全貌，风险提前预警，绩效用数据说话。', color='1A3C5E')
add_para('• 对 CFO：入账报税勾稽全链路可追溯，现金水位可预测，年度报表一键导出。', color='1A3C5E')
add_para('• 对 CTO：架构清晰、权限分级、事务安全、测试覆盖、可扩展可维护。', color='1A3C5E')

doc.add_page_break()

# ===== 二、CEO 视角 =====
add_heading('二、CEO 视角：经营全貌与风险预警', level=1)

add_heading('2.1 CEO 的核心困扰', level=2, color='C0392B')
add_table(
    ['困扰', '具体表现', '业务影响'],
    [
        ['员工到底有没有在做事？', '日报凭良心填，月底才汇总，主管看不到每日明细', '绩效会议无有效数据，奖惩靠印象'],
        ['奖惩没有依据', '迟交、缺交、未解案件责任人模糊', '留不住优秀员工，淘汰不了不合格员工'],
        ['目标与实际脱节', '部门目标靠 Excel 维护，更新不及时', '不知道谁达标、谁超标、谁落后'],
        ['跨部门协调无法追踪', '采购延迟→生产停线，只看到结果看不到过程', '问题反复发生，无法根因改善'],
        ['月底缺报才发现', '月底才发现有人连续多日未交日报', '为时已晚，无法及时补救'],
        ['现金水位无法预判', '不知道未来 13 周现金余额', '无法提前安排融资或付款，安全水位靠拍脑袋'],
        ['经营数据滞后', '看到的总是上个月的状况', '决策总是慢半拍'],
    ],
    header_color='C0392B',
    col_widths=[4, 6, 5]
)

add_heading('2.2 ERMM 解决方案', level=2, color='27AE60')
add_table(
    ['CEO 困扰', 'ERMM 解决方案', '效果'],
    [
        ['员工到底有没有在做事？', '📊 提交及时率看板（准时/迟交/缺交天数 + 及时率%）', '一眼看到谁在混、谁在冲'],
        ['奖惩没有依据', '📋 月度绩效汇总（工时/工作占比/延误/未解 + 目标达成率）', '数据说话，不是感觉说话'],
        ['目标与实际脱节', '🎯 按月逐人设定目标（4 维度+备注理由），保存即生效', '目标透明，达成率实时可见'],
        ['跨部门协调无法追踪', '日报明细标记「待主管审核/跨部门协调」状态', '延误案件即时可见，可追责'],
        ['月底缺报才发现', '🔔 日报告警引擎（连续3天黄、5天红，自动发邮件）', '问题在发生早期就被拦截'],
        ['现金水位无法预判', '💰 13 周现金预测 + 安全水位设定，跌破自动标红', '提前安排融资/付款，避免断链'],
        ['经营数据滞后', '员工提交瞬间主管可见；凭证入账即时联动报税勾稽', '看到的是「现在」，不是「上个月」'],
    ],
    header_color='27AE60',
    col_widths=[4, 7, 4]
)

add_heading('2.3 CEO 眼中的系统亮点', level=2, color='F39C12')
highlights_ceo = [
    ('即时透明', '员工提交日报的瞬间，主管就能看到；凭证一入账，报税/勾稽自动关联'),
    ('风险预警', '连续未交日报、工时异常、延误积压、现金跌破安全线，系统自动预警并邮件通知'),
    ('数据驱动决策', '绩效达成率、目标对比、现金预测曲线，全部可视化，一眼看清经营状况'),
    ('全链路可追溯', 'RUID 贯穿入账→报税→勾稽，任何一笔数据异常都能追溯到源头'),
    ('一键报表', '年度纳税明细表、月度绩效汇总、经营摘要，一键生成并导出'),
]
for title, desc in highlights_ceo:
    p = doc.add_paragraph()
    run = p.add_run(f'★ {title}：')
    run.bold = True
    run.font.color.rgb = RGBColor.from_string('F39C12')
    run.font.name = '微软雅黑'
    run.element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
    run.font.size = Pt(11)
    run2 = p.add_run(desc)
    run2.font.name = '微软雅黑'
    run2.element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
    run2.font.size = Pt(11)

doc.add_page_break()

# ===== 三、CFO 视角 =====
add_heading('三、CFO 视角：财务合规与现金流', level=1)

add_heading('3.1 CFO 的核心困扰', level=2, color='C0392B')
add_table(
    ['困扰', '具体表现', '业务影响'],
    [
        ['入账报税对账全靠 Excel', '凭证、报税表、勾稽关系散落不同 Excel', '数据不一致、追溯困难、月底关账加班'],
        ['凭证编号混乱', '手工编号，查一笔账翻好几本 Excel', '审计效率低，出错难定位'],
        ['报税算税易错', '从凭证手动摘数、算税、填表', '容易出错，税务风险高'],
        ['勾稽对账费时', '凭证表和报税表手动 VLOOKUP', '差异要找半天，关账压力大'],
        ['年度纳税报表难出', '老板要全年纳税数据，要翻 12 个月报税单手工加总', '耗时耗力，容易出错'],
        ['现金水位无法预判', '不知道未来几周现金够不够', '无法提前安排融资或延迟付款'],
        ['第三方数据导入难', '外部 Excel 数据导入要手工逐笔录入', '效率低、易出错、无法批量处理'],
        ['批次作业无法自动化', 'PO→库存→AR/AP→财务摘要全靠人工跑', '月底关账周期长，人力成本高'],
    ],
    header_color='C0392B',
    col_widths=[4, 6, 5]
)

add_heading('3.2 ERMM 解决方案', level=2, color='27AE60')
add_table(
    ['CFO 困扰', 'ERMM 解决方案', '效果'],
    [
        ['入账报税对账全靠 Excel', '📒 凭证 + 🧾 申报 + 🔗 勾稽，三大模块一体化', '数据一致、可追溯、关账提速'],
        ['凭证编号混乱', 'RUID 全局唯一编号，贯穿凭证→报税→勾稽', '一个 RUID 定位全链路'],
        ['报税算税易错', '自动关联已过账凭证，一键算税（13%/25%/0.03%）', '算税零差错，申报有回执'],
        ['勾稽对账费时', '一键执行勾稽，自动比 RUID、比金额，差异标红', '对账从几小时缩短到几分钟'],
        ['年度纳税报表难出', '📊 报税明细表年度汇总 + 一键导出 CSV', '一秒出全年纳税报表'],
        ['现金水位无法预判', '💰 13 周滚动预测 + 安全水位设定 + 跌破预警', '提前安排融资，避免现金断链'],
        ['第三方数据导入难', '🔌 第三方资料整合（Excel 导入 + SQL 直连）', '支持 Online/Batch 双模式，自动 UPSERT'],
        ['批次作业无法自动化', '7 步批次管线（PO→库存→AR/AP→财务摘要）', '一键跑完或逐步推进，月底关账自动化'],
    ],
    header_color='27AE60',
    col_widths=[4, 7, 4]
)

add_heading('3.3 CFO 眼中的系统亮点', level=2, color='F39C12')
highlights_cfo = [
    ('RUID 全链路追溯', '凭证→报税→勾稽统一编号，任一端异常都能追溯到源头'),
    ('借贷平衡硬校验', '借方≠贷方拒绝保存，从源头防止错账'),
    ('自动算税', '增值税 13%、企业所得税 25%、印花税 0.03%，输入金额自动算'),
    ('一键勾稽', '自动匹配凭证与报税 RUID，金额差异直接标红'),
    ('报税明细表导出', '年度汇总 + CSV 导出（带 BOM），Excel 打开不乱码'),
    ('13 周现金预测', '基于历史数据预测未来 13 周余额，跌破安全线自动预警'),
    ('第三方整合', 'Excel 导入 + SQL 直连第三方库，支持 UPSERT 幂等写入'),
    ('7 步批次管线', 'PO 暂存→正式 PO→汇率换算→供应商汇总→库存减值→AR/AP 汇算→财务摘要，一键自动化'),
]
for title, desc in highlights_cfo:
    p = doc.add_paragraph()
    run = p.add_run(f'★ {title}：')
    run.bold = True
    run.font.color.rgb = RGBColor.from_string('F39C12')
    run.font.name = '微软雅黑'
    run.element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
    run.font.size = Pt(11)
    run2 = p.add_run(desc)
    run2.font.name = '微软雅黑'
    run2.element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
    run2.font.size = Pt(11)

doc.add_page_break()

# ===== 四、CTO 视角 =====
add_heading('四、CTO 视角：技术架构与工程质量', level=1)

add_heading('4.1 CTO 的核心困扰', level=2, color='C0392B')
add_table(
    ['困扰', '具体表现', '业务影响'],
    [
        ['权限管理混乱', '不同角色能看什么、能改什么没有清晰边界', '数据安全风险，越权操作'],
        ['数据一致性差', 'Excel 多版本，谁改了什么不知道', '数据不可信，决策无依据'],
        ['审计无证据', '操作无日志，出了问题无法追责', '合规风险，无法通过审计'],
        ['前端绕过防护', '只靠前端控制，懂技术的可以绕过', '数据被篡改，安全漏洞'],
        ['第三方数据接入难', '外部系统数据导入要写定制脚本', '维护成本高，扩展性差'],
        ['批次作业不稳定', '人工跑脚本容易出错，无法自动化调度', '月底关账不稳定'],
        ['缺乏测试覆盖', '改动后不知道会不会影响其他功能', '上线风险高，回归测试成本大'],
        ['国际化支持差', '只有一种语言，海外分公司无法使用', '业务拓展受限'],
    ],
    header_color='C0392B',
    col_widths=[4, 6, 5]
)

add_heading('4.2 ERMM 解决方案', level=2, color='27AE60')
add_table(
    ['CTO 困扰', 'ERMM 解决方案', '效果'],
    [
        ['权限管理混乱', '四级权限：员工/部门主管/高阶主管/管理员，每个功能都有权限检查', '职责清晰，越权自动拦截'],
        ['数据一致性差', 'MySQL 事务保证，RUID 全链路关联', '数据一致，任一端可追溯'],
        ['审计无证据', '📜 审计日志：操作人/IP/时间/旧值新值快照，权限分级查看', '每次操作留痕，审计一秒定位'],
        ['前端绕过防护', '后端每个写操作都重复校验，HTTP 423 硬拦锁定数据', '前端绕过也写不进去'],
        ['第三方数据接入难', '🔌 第三方整合引擎：Excel 解析 + SQL 直连 + 栏位白名单 + 类型转换', '通用化方案，免定制开发'],
        ['批次作业不稳定', '7 步批次管线 + 排程器（daily/every Nm），防重入防重复触发', '自动化调度，稳定可靠'],
        ['缺乏测试覆盖', 'Jest 自动化测试，E2E 验证脚本，每次改动全量回归', '上线有信心，回归成本低'],
        ['国际化支持差', '界面三语切换（简中/繁中/English），i18n 统一管理', '支持多地区使用'],
    ],
    header_color='27AE60',
    col_widths=[4, 7, 4]
)

add_heading('4.3 CTO 眼中的系统亮点', level=2, color='F39C12')
highlights_cto = [
    ('清晰的三层架构', '前端 SPA（原生 JS + Chart.js）→ Express 5 + mysql2 → MySQL 8'),
    ('四级权限体系', '每个 API 都有权限中间件，前后端双重校验'),
    ('事务一致性', '审计日志与业务操作在同一事务，回滚一起回滚'),
    ('RUID 全链路', '凭证→报税→勾稽统一编号，数据血缘清晰'),
    ('栏位白名单防注入', '第三方整合从 information_schema 读取栏位，只允许映射存在的栏'),
    ('SQL 安全', '仅允许单 SELECT、禁多语句、包成子查询加 LIMIT'),
    ('UPSERT 幂等', '先查存在键→拆分 INSERT/UPDATE，计数以业务语义为准'),
    ('连接池缓存', '第三方数据源连接池按 sourceId 缓存，避免重复创建'),
    ('批次排程器', '零依赖分钟级 setInterval，支持 daily HH:MM / every Nm，防重入'),
    ('E2E 测试', '完整端到端验证脚本，覆盖 Excel 导入、SQL 直连、UPSERT、日志'),
    ('三语国际化', 'i18n.js 统一管理，简中/繁中/English 一键切换'),
]
for title, desc in highlights_cto:
    p = doc.add_paragraph()
    run = p.add_run(f'★ {title}：')
    run.bold = True
    run.font.color.rgb = RGBColor.from_string('F39C12')
    run.font.name = '微软雅黑'
    run.element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
    run.font.size = Pt(11)
    run2 = p.add_run(desc)
    run2.font.name = '微软雅黑'
    run2.element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
    run2.font.size = Pt(11)

doc.add_page_break()

# ===== 五、功能矩阵总览 =====
add_heading('五、功能矩阵总览', level=1)
add_table(
    ['模块', '核心功能', '主要受益角色'],
    [
        ['绩效闭环', '提交及时率 / 月度绩效汇总 / 目标设定', 'CEO、部门主管'],
        ['签核稽核', '签核锁定 / 审计日志 / 锁定只读保护', 'CEO、高阶主管、稽核'],
        ['智能预警', '日报告警引擎（5 规则）/ 趋势预测 / 邮件通知', 'CEO、部门主管'],
        ['财务核心', '会计凭证 / 纳税申报 / 勾稽对账', 'CFO、财务人员'],
        ['报税明细', '年度汇总 / CSV 导出（带 BOM）', 'CFO、管理层'],
        ['现金流', '13 周预测 / 安全水位 / 跌破预警', 'CEO、CFO'],
        ['第三方整合', 'Excel 导入 / SQL 直连 / 批次排程', 'CFO、IT'],
        ['批次管线', '7 步 ERP 加工（PO→库存→AR/AP→摘要）', 'CFO、IT'],
    ],
    header_color='1A3C5E',
    col_widths=[3, 7, 4]
)

doc.add_page_break()

# ===== 六、技术架构 =====
add_heading('六、技术架构', level=1)
add_para('前端 SPA（原生 JS + Chart.js）→ Express 5 + mysql2 → MySQL 8（ermm_db）', bold=True, size=12)
add_para('核心资料表（68+ 张）：', bold=True)
tables = [
    '绩效：daily_report / daily_report_detail / daily_report_lock / daily_report_audit_log / daily_report_target / alert_rule / alert_log',
    '财务：fin_ruid_ledger / fin_account_subject / fin_voucher / fin_voucher_entry / fin_tax_return / fin_tax_return_item / fin_reconciliation',
    '现金：mgm_casher_details / mgm_cash_safe_level',
    '业务：ermm_erp_so / ermm_erp_po / ermm_temp_po / ermm_arap_detail',
    '整合：intg_source / intg_job / intg_log',
]
for t in tables:
    p = doc.add_paragraph(style='List Bullet')
    run = p.add_run(t)
    run.font.name = '微软雅黑'
    run.element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
    run.font.size = Pt(10)

doc.add_page_break()

# ===== 七、使用场景实例 =====
add_heading('七、典型使用场景', level=1)

scenarios = [
    ('场景 1：月底绩效会议（CEO）',
     'CEO 打开系统 → 选 2026-09 → 看各部门及时率排行榜：人事部 96% 第一，采购部 72% 最后。'
     '点进采购部员工月度汇总 → 总工时达标但延误 17 笔、未解 23 笔超上限。'
     'CEO 对采购经理说：「工时不错，但问题处理进度落后，下个月目标把未解压到 15 笔以下。」'),
    ('场景 2：日报告警自动介入（部门主管）',
     '采购部主管周一收到邮件：「采购员 A 已连续 4 个工作日未交日报（黄色警告）」。'
     '主管立即找 A 谈话，A 承认在赶供应商对账忘了交。当天补交。'
     '如果等到月底，A 可能缺交 20+ 天。'),
    ('场景 3：月底关账一键勾稽（CFO）',
     '财务主管月底关账 → 进入「勾稽对账」→ 选 2026-09 → 点「执行勾稽」'
     '→ 系统返回：匹配 12 笔 / 未匹配 36 笔。未匹配的是收入/成本/费用凭证（正常口径差异）。'
     '主管确认后标记处理，关账完成。'),
    ('场景 4：年度纳税报表给老板（CFO）',
     '老板要 2026 年上半年纳税汇总 → 财务打开「报税申报」→ 期间选 2026-06'
     '→ 点「生成报税明细表」→ 弹窗显示上半年税额合计 → 点「导出 CSV」→ 发给老板。'),
    ('场景 5：现金安全水位预警（CEO）',
     'CEO 打开「现金流量预测」→ 看到 13 周预测曲线在第 8 周跌破橙色安全水位线'
     '→ 立即要求财务安排短期融资或延迟非必要付款，避免现金断链。'),
    ('场景 6：第三方数据批量导入（CFO/IT）',
     '供应商发来 Excel 对账单 → 进入「第三方资料整合」→ 选目标表 → 上传 Excel'
     '→ 栏位自动映射 → 预览 → 写入。1000 行数据 30 秒完成，UPSERT 避免重复。'),
    ('场景 7：批次管线一键关账（CFO/IT）',
     '月底关账日 → IT 进入「批次管线」→ 点「🚀 执行全部步骤」'
     '→ Step1 PO 同步 → Step2 汇率换算 → Step3 供应商汇总 → Step5 库存减值 → Step6 AR/AP 汇算 → Step7 财务摘要'
     '→ 7 步全部完成，关账从 3 天缩短到 30 分钟。'),
]
for title, desc in scenarios:
    add_heading(title, level=2, color='2E86C1')
    add_para(desc, size=11)

doc.add_page_break()

# ===== 八、一句话总结 =====
add_heading('八、一句话总结', level=1)
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = p.add_run(
    'ERMM 把「看不见、摸不着、查不到」的企业经营管理\n'
    '（人力绩效 + 财务入账报税 + 现金流 + 第三方整合）\n'
    '变成「即时、透明、可追溯」的数据驱动管理。'
)
run.font.size = Pt(16)
run.bold = True
run.font.color.rgb = RGBColor.from_string('1A3C5E')
run.font.name = '微软雅黑'
run.element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')

doc.add_paragraph()
p2 = doc.add_paragraph()
p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
run2 = p2.add_run('CEO 看清全貌 ｜ CFO 管好钱财 ｜ CTO 稳住架构')
run2.font.size = Pt(14)
run2.font.color.rgb = RGBColor.from_string('27AE60')
run2.bold = True
run2.font.name = '微软雅黑'
run2.element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')

# ===== 保存 =====
output_path = r'e:\finance\docs\ERMM_高级主管价值报告.docx'
doc.save(output_path)
print(f'文档已生成：{output_path}')
