from pptx import Presentation
p = Presentation(r'e:\finance\docs\ERMM_高管價值簡報_CEO_CFO_COO_CTO.pptx')
print(f'=== 驗證 {len(p.slides)} slides ===')
keywords = [
    ('78 个功能模组', 'Slide 2 规模事实'),
    ('74 个 API 路由', 'Slide 2/29 路由数'),
    ('142 张资料表', 'Slide 2 资料表数'),
    ('58 个迁移', 'Slide 2 迁移数'),
    ('55 按钮', 'Slide 30/32 权限矩阵'),
    ('三角色', 'Slide 30 三角色 allow'),
    ('CTO-05 合同', 'Slide 32 合同主档'),
    ('CTO-06 指标', 'Slide 32 指标中心'),
    ('CTO-09 AI 治理', 'Slide 32 AI 治理'),
    ('fail-open', 'Slide 32 速率限制'),
    ('52 单元测试', 'Slide 2/32 CI/CD'),
    ('合同主档 28 栏', 'Slide 32 合同主档规格'),
    ('23 指标', 'Slide 32 指标中心规格'),
    ('CI/CD 自动化', 'Slide 38/39 量化速览'),
    ('风险控制', 'Slide 38 CTO 行'),
]
for kw, where in keywords:
    found = False
    for s in p.slides:
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
    mark = 'OK' if found else 'MISS'
    print(f'  [{mark}] "{kw}" ({where})')

# 關鍵 slides 內容預覽
print('\n=== 關鍵 Slide 內容預覽 ===')
for idx in [1, 28, 29, 31, 37, 38, 39]:
    s = p.slides[idx]
    print(f'\n--- Slide {idx+1} ---')
    for shape in s.shapes:
        txt = ''
        if shape.has_text_frame:
            txt = shape.text_frame.text.strip()[:100]
        if shape.has_table:
            tbl = shape.table
            txt = f'[TABLE {len(tbl.rows)}x{len(tbl.columns)}] CTO row: {tbl.rows[4].cells[4].text.strip()[:80] if len(tbl.rows)>4 else ""}'
        if txt:
            print(f'  {txt[:120]}')
