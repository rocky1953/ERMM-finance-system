/**
 * 由 ERMM_高管價值簡報_CEO_CFO_COO.md 大纲生成 PPTX
 * 规则：`---` 分页；`#` 标题；`- ` 要点（`  - ` 子要点）；`|` 表格；`>` 引言忽略
 * 输出：docs/ERMM_高管價值簡報_CEO_CFO_COO.pptx
 */
const fs = require('fs');
const path = require('path');
const PptxGenJS = require('pptxgenjs');

const MD = path.join(__dirname, '..', 'docs', 'ERMM_高管價值簡報_CEO_CFO_COO.md');
const OUT = path.join(__dirname, '..', 'docs', 'ERMM_高管價值簡報_CEO_CFO_COO.pptx');

const raw = fs.readFileSync(MD, 'utf8');
// 分页：按 --- 切，第一段（封面元信息 + 封面页）需再处理
const blocks = raw.split(/\r?\n---\r?\n/).map(s => s.trim()).filter(Boolean);

const clean = (t) => t.replace(/\*\*/g, '').replace(/`/g, '').trim();

const slides = [];
for (const b of blocks) {
    const lines = b.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('>'));
    const titleLine = lines.find(l => l.startsWith('# '));
    if (!titleLine) continue;
    const title = clean(titleLine.slice(2));
    const bullets = [];
    const tableRows = [];
    for (const l of lines) {
        if (l.startsWith('# ')) continue;
        if (/^\s*-\s+/.test(l)) {
            const indent = l.match(/^(\s*)-/)[1].length;
            bullets.push({ text: clean(l.replace(/^\s*-\s+/, '')), level: indent >= 2 ? 1 : 0 });
        } else if (/^\s*\|/.test(l)) {
            const cells = l.split('|').map(c => clean(c)).filter((c, i, a) => !(i === 0 || i === a.length - 1) || c !== '');
            if (cells.length && !cells.every(c => /^:?-{2,}:?$/.test(c.replace(/\s/g, '')))) tableRows.push(cells);
        } else if (l.trim()) {
            // 普通段落（如章节页痛点说明）
            bullets.push({ text: clean(l), level: 0 });
        }
    }
    slides.push({ title, bullets, table: tableRows.length > 1 ? tableRows : null });
}
// 跳过无要点且无表格的空页（如文档主标题块）
const valid = slides.filter(s => s.bullets.length || s.table);
slides.length = 0; slides.push(...valid);

const pptx = new PptxGenJS();
pptx.defineLayout({ name: 'W169', width: 13.33, height: 7.5 });
pptx.layout = 'W169';

const NAVY = '1E3A5F', BLUE = '2563EB', GRAY = '475569', LIGHT = 'F5F7FA';

slides.forEach((s, idx) => {
    const slide = pptx.addSlide();
    const isCover = idx === 0 || /封面/.test(s.title);
    const isSection = /视角：/.test(s.title);

    if (isCover) {
        slide.background = { color: NAVY };
        slide.addText(s.title, { x: 0.8, y: 2.2, w: 11.7, h: 1.2, fontSize: 36, bold: true, color: 'FFFFFF', fontFace: 'Microsoft YaHei' });
        slide.addText(s.bullets.map(b => b.text).join('\n'), { x: 0.8, y: 3.6, w: 11.7, h: 2.5, fontSize: 18, color: 'BFDBFE', lineSpacing: 34, fontFace: 'Microsoft YaHei' });
        return;
    }

    if (isSection) {
        slide.background = { color: LIGHT };
        slide.addShape('rect', { x: 0, y: 3.1, w: 13.33, h: 1.3, fill: { color: NAVY } });
        slide.addText(s.title, { x: 0.8, y: 3.28, w: 11.7, h: 0.9, fontSize: 30, bold: true, color: 'FFFFFF', fontFace: 'Microsoft YaHei' });
        slide.addText(s.bullets.map(b => b.text).join('\n'), { x: 0.8, y: 4.9, w: 11.7, h: 2.0, fontSize: 16, color: GRAY, lineSpacing: 28, fontFace: 'Microsoft YaHei' });
        return;
    }

    // 标准内容页
    slide.background = { color: 'FFFFFF' };
    slide.addShape('rect', { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: BLUE } });
    slide.addText(s.title, { x: 0.7, y: 0.4, w: 12.2, h: 0.9, fontSize: 24, bold: true, color: NAVY, fontFace: 'Microsoft YaHei' });
    slide.addShape('line', { x: 0.7, y: 1.35, w: 11.9, h: 0, line: { color: 'E2E8F0', width: 1 } });

    if (s.table) {
        const rows = s.table.map((r, ri) => r.map(c => ({
            text: c,
            options: ri === 0
                ? { bold: true, color: 'FFFFFF', fill: { color: NAVY }, fontSize: 13 }
                : { color: '1E293B', fill: { color: ri % 2 ? 'FFFFFF' : 'F1F5F9' }, fontSize: 12 }
        })));
        slide.addTable(rows, { x: 0.7, y: 1.7, w: 11.9, fontFace: 'Microsoft YaHei', valign: 'middle', border: { pt: 0.5, color: 'CBD5E1' }, autoPage: false });
        return;
    }

    const top = s.bullets.filter(b => b.level === 0);
    const runs = [];
    for (const b of s.bullets) {
        runs.push({
            text: b.text,
            options: {
                bullet: { code: b.level === 0 ? '25AA' : '2013', indent: 14 },
                indentLevel: b.level,
                fontSize: b.level === 0 ? 16 : 13.5,
                color: b.level === 0 ? '1E293B' : GRAY,
                paraSpaceAfter: b.level === 0 ? 12 : 4
            }
        });
    }
    const fsz = top.length > 5 ? 14 : 16;
    runs.forEach(r => { if (r.options.indentLevel === 0) r.options.fontSize = Math.min(r.options.fontSize, fsz + 2); });
    slide.addText(runs, { x: 0.9, y: 1.6, w: 11.6, h: 5.6, valign: 'top', fontFace: 'Microsoft YaHei', lineSpacing: 26 });

    slide.addText(`${idx + 1} / ${slides.length}`, { x: 12.3, y: 7.05, w: 0.9, h: 0.35, fontSize: 10, color: '94A3B8', align: 'right' });
});

pptx.writeFile({ fileName: OUT }).then(() => {
    console.log(`✅ 已生成 ${OUT}（${slides.length} 页）`);
}).catch(e => { console.error('❌', e.message); process.exit(1); });
