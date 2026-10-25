/**
 * 由 ERMM_使用者操作手冊.md 生成 PPTX 培训课件
 * 分页规则：每个 `# ` 或 `## ` 标题 = 一页；内容含 要点/编号步骤/表格/>引言
 * 输出：docs/ERMM_使用者操作手冊.pptx
 */
const fs = require('fs');
const path = require('path');
const PptxGenJS = require('pptxgenjs');

const MD = path.join(__dirname, '..', 'docs', 'ERMM_使用者操作手冊.md');
const OUT = path.join(__dirname, '..', 'docs', 'ERMM_使用者操作手冊.pptx');

const clean = (t) => t.replace(/\*\*/g, '').replace(/`/g, '').trim();
const lines = fs.readFileSync(MD, 'utf8').split(/\r?\n/);

// ===== 解析：按标题分页 =====
const slides = [];
let cur = null;
const push = () => { if (cur && (cur.bullets.length || cur.table)) slides.push(cur); };
for (const l of lines) {
    const t = l.trim();
    if (/^#{1,2}\s/.test(t)) {           // # / ## → 新页
        push();
        cur = { title: clean(t.replace(/^#{1,2}\s/, '')), bullets: [], table: null, h1: t.startsWith('# ') };
        continue;
    }
    if (!cur) continue;
    if (/^###\s/.test(t)) { cur.bullets.push({ text: clean(t.slice(4)), level: 0, bold: true }); continue; }
    if (/^\s*\|/.test(l)) {
        const cells = l.split('|').slice(1, -1).map(c => clean(c));
        if (cells.length && cells.every(c => /^:?-{2,}:?$/.test(c.replace(/\s/g, '')))) continue;
        if (!cur.table) cur.table = [];
        cur.table.push(cells);
        continue;
    }
    if (t.startsWith('> ')) { cur.bullets.push({ text: clean(t.slice(2)), level: 0, note: true }); continue; }
    if (/^(\s*)-\s+/.test(l)) {
        const indent = l.match(/^(\s*)-/)[1].length;
        cur.bullets.push({ text: clean(t.replace(/^-\s+/, '')), level: indent >= 2 ? 1 : 0 });
        continue;
    }
    if (/^\d+\.\s+/.test(t)) { cur.bullets.push({ text: clean(t), level: 1, step: true }); continue; }
    if (t && t !== '---') cur.bullets.push({ text: clean(t), level: 0 });
}
push();

const pptx = new PptxGenJS();
pptx.defineLayout({ name: 'W169', width: 13.33, height: 7.5 });
pptx.layout = 'W169';
const NAVY = '1E3A5F', BLUE = '2563EB', GRAY = '475569', LIGHT = 'F5F7FA', GREEN = '059669';

slides.forEach((s, idx) => {
    const slide = pptx.addSlide();
    const isCover = idx === 0;

    if (isCover) {
        slide.background = { color: NAVY };
        slide.addText(s.title, { x: 0.8, y: 2.4, w: 11.7, h: 1.2, fontSize: 34, bold: true, color: 'FFFFFF', fontFace: 'Microsoft YaHei' });
        slide.addText(s.bullets.map(b => b.text).join('\n'), { x: 0.8, y: 3.8, w: 11.7, h: 2.6, fontSize: 15, color: 'BFDBFE', lineSpacing: 28, fontFace: 'Microsoft YaHei' });
        return;
    }

    // 章节首页（# 一级标题）用深色横幅
    if (s.h1) {
        slide.background = { color: LIGHT };
        slide.addShape('rect', { x: 0, y: 2.9, w: 13.33, h: 1.2, fill: { color: NAVY } });
        slide.addText(s.title, { x: 0.8, y: 3.05, w: 11.7, h: 0.9, fontSize: 28, bold: true, color: 'FFFFFF', fontFace: 'Microsoft YaHei' });
        if (s.bullets.length) {
            slide.addText(s.bullets.map(b => ({ text: b.text, options: { bullet: { code: '25AA', indent: 14 }, fontSize: 15, color: GRAY, paraSpaceAfter: 10 } })),
                { x: 0.9, y: 4.5, w: 11.6, h: 2.6, valign: 'top', fontFace: 'Microsoft YaHei', lineSpacing: 24 });
        }
        return;
    }

    // 标准内容页
    slide.background = { color: 'FFFFFF' };
    slide.addShape('rect', { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: BLUE } });
    slide.addText(s.title, { x: 0.7, y: 0.35, w: 12.2, h: 0.8, fontSize: 22, bold: true, color: NAVY, fontFace: 'Microsoft YaHei' });
    slide.addShape('line', { x: 0.7, y: 1.2, w: 11.9, h: 0, line: { color: 'E2E8F0', width: 1 } });

    if (s.table && s.table.length > 1) {
        const rows = s.table.map((r, ri) => r.map(c => ({
            text: c,
            options: ri === 0
                ? { bold: true, color: 'FFFFFF', fill: { color: NAVY }, fontSize: 12 }
                : { color: '1E293B', fill: { color: ri % 2 ? 'FFFFFF' : 'F1F5F9' }, fontSize: 11 }
        })));
        slide.addTable(rows, { x: 0.7, y: 1.5, w: 11.9, fontFace: 'Microsoft YaHei', valign: 'middle', border: { pt: 0.5, color: 'CBD5E1' }, autoPage: false });
    }

    if (s.bullets.length) {
        const topCount = s.bullets.filter(b => b.level === 0).length;
        const baseSize = topCount > 6 ? 13 : 14.5;
        const y0 = s.table ? 1.5 + Math.min(s.table.length * 0.45, 4) : 1.5;
        const runs = s.bullets.map(b => ({
            text: b.text,
            options: {
                bullet: b.step ? { code: '2022', indent: 12 } : { code: b.level === 0 ? '25AA' : '2013', indent: 14 },
                indentLevel: b.level,
                fontSize: b.note ? 11.5 : (b.level === 0 ? baseSize : baseSize - 1.5),
                bold: !!b.bold,
                color: b.note ? GREEN : (b.level === 0 ? '1E293B' : GRAY),
                paraSpaceAfter: b.level === 0 ? 9 : 3
            }
        }));
        slide.addText(runs, { x: 0.9, y: y0, w: 11.6, h: 7.3 - y0, valign: 'top', fontFace: 'Microsoft YaHei', lineSpacing: 22 });
    }

    slide.addText(`${idx + 1} / ${slides.length}`, { x: 12.3, y: 7.05, w: 0.9, h: 0.35, fontSize: 10, color: '94A3B8', align: 'right' });
});

pptx.writeFile({ fileName: OUT }).then(() => {
    console.log(`✅ 已生成 ${OUT}（${slides.length} 页）`);
}).catch(e => { console.error('❌', e.message); process.exit(1); });
