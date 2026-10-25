/**
 * 由 ERMM_使用者操作手冊.md 生成 PDF（两遍生成：先数页数，再盖「第 n / total 页」页脚）
 * 解析：# 标题 / > 引言 / - 要点（含缩进）/ 数字列表 / | 表格 / --- 分隔
 * 字体：微软雅黑（msyh.ttc / msyhbd.ttc）支持中文
 * 输出：docs/ERMM_使用者操作手冊.pdf
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const MD = path.join(__dirname, '..', 'docs', 'ERMM_使用者操作手冊.md');
const OUT = path.join(__dirname, '..', 'docs', 'ERMM_使用者操作手冊.pdf');

const NAVY = '#1e3a5f', BLUE = '#2563eb', GRAY = '#475569', LIGHT = '#f1f5f9';
const PAGE_W = 595.28, M = 50, USABLE = PAGE_W - M * 2;
const BOTTOM = 841.89 - 70;

const clean = (t) => t.replace(/\*\*/g, '').replace(/`/g, '').trim();
const lines = fs.readFileSync(MD, 'utf8').split(/\r?\n/);

let doc, pageNum, totalPages;

function stampFooter() {
    if (!totalPages) return;
    const mb = doc.page.margins.bottom, y0 = doc.y, x0 = doc.x;
    doc.page.margins.bottom = 0; // 放开下边界避免自动分页
    doc.font('cjk').fontSize(8).fillColor('#94a3b8')
        .text(`ERMM 使用者操作手冊 · 第 ${pageNum} / ${totalPages} 页`, M, 806, { width: USABLE, align: 'center', lineBreak: false });
    doc.page.margins.bottom = mb;
    doc.y = y0; doc.x = x0;      // 恢复光标，避免后续内容被推到页外
}
function ensureSpace(h) { if (doc.y + h > BOTTOM) doc.addPage(); }
function h1(t) { ensureSpace(46); doc.moveDown(0.6); doc.font('cjkb').fontSize(20).fillColor(NAVY).text(t); doc.moveTo(M, doc.y + 4).lineTo(M + USABLE, doc.y + 4).lineWidth(2).strokeColor(BLUE).stroke(); doc.moveDown(0.5); }
function h2(t) { ensureSpace(34); doc.moveDown(0.4); doc.font('cjkb').fontSize(15).fillColor(NAVY).text(t); doc.moveDown(0.2); }
function h3(t) { ensureSpace(26); doc.moveDown(0.2); doc.font('cjkb').fontSize(12.5).fillColor(BLUE).text(t); }
function para(t, opts = {}) {
    const size = opts.size || 10.5, color = opts.color || '#1e293b';
    ensureSpace(size * 2);
    doc.font(opts.bold ? 'cjkb' : 'cjk').fontSize(size).fillColor(color)
        .text(t, M + (opts.indent || 0), doc.y, { width: USABLE - (opts.indent || 0), lineGap: 3 });
    doc.x = M;
}
function bullet(t, level) {
    const mark = level === 0 ? '▪' : '–';
    para(`${mark}  ${t}`, { indent: level === 0 ? 0 : 18, size: level === 0 ? 10.5 : 10, color: level === 0 ? '#1e293b' : GRAY });
}
function table(rows) {
    if (!rows.length) return;
    const cols = rows[0].length;
    const colW = USABLE / cols;
    for (let ri = 0; ri < rows.length; ri++) {
        const r = rows[ri];
        let maxH = 0;
        for (const c of r) maxH = Math.max(maxH, doc.font('cjk').fontSize(9).heightOfString(c, { width: colW - 10, lineGap: 2 }));
        maxH += 8;
        ensureSpace(maxH + 2);
        const y = doc.y;
        doc.rect(M, y, USABLE, maxH).fill(ri === 0 ? NAVY : ri % 2 ? '#ffffff' : LIGHT);
        doc.rect(M, y, USABLE, maxH).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
        for (let ci = 0; ci < cols; ci++) {
            doc.font(ri === 0 ? 'cjkb' : 'cjk').fontSize(9)
                .fillColor(ri === 0 ? '#ffffff' : '#1e293b')
                .text(r[ci] || '', M + ci * colW + 5, y + 4, { width: colW - 10, lineGap: 2 });
        }
        doc.y = y + maxH;
        doc.x = M;
    }
    doc.moveDown(0.6);
}

function build(total, outPath) {
    totalPages = total;
    doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: M, right: M } });
    doc.pipe(fs.createWriteStream(outPath));
    doc.registerFont('cjk', 'C:/Windows/Fonts/msyh.ttc', 'MicrosoftYaHei');
    doc.registerFont('cjkb', 'C:/Windows/Fonts/msyhbd.ttc', 'MicrosoftYaHei-Bold');
    doc.info.Title = 'ERMM 使用者操作手冊';

    pageNum = 1;
    stampFooter();
    doc.on('pageAdded', () => { pageNum++; stampFooter(); });

    let tbl = [];
    const flushTable = () => { if (tbl.length > 1) table(tbl); tbl = []; };
    for (const l of lines) {
        const t = l.trim();
        if (/^\s*\|/.test(l)) {
            const cells = l.split('|').slice(1, -1).map(c => clean(c));
            if (cells.length && cells.every(c => /^:?-{2,}:?$/.test(c.replace(/\s/g, '')))) continue;
            tbl.push(cells);
            continue;
        }
        flushTable();
        if (!t) { doc.moveDown(0.3); continue; }
        if (t.startsWith('# ')) h1(clean(t.slice(2)));
        else if (t.startsWith('## ')) h2(clean(t.slice(3)));
        else if (t.startsWith('### ')) h3(clean(t.slice(4)));
        else if (t === '---') { ensureSpace(10); doc.moveDown(0.3); doc.moveTo(M, doc.y).lineTo(M + USABLE, doc.y).lineWidth(0.5).strokeColor('#e2e8f0').stroke(); doc.moveDown(0.3); }
        else if (t.startsWith('> ')) para(clean(t.slice(2)), { size: 9.5, color: GRAY });
        else if (/^(\s*)-\s+/.test(l)) {
            const indent = l.match(/^(\s*)-/)[1].length;
            bullet(clean(t.replace(/^-\s+/, '')), indent >= 2 ? 1 : 0);
        } else if (/^\d+\.\s+/.test(t)) bullet(clean(t), 0);
        else para(clean(t));
    }
    flushTable();
    doc.end();
    return new Promise(res => doc.on('end', () => res(pageNum)));
}

(async () => {
    const tmp = OUT + '.tmp.pdf';
    const total = await build(0, tmp);   // 第一遍：数页数
    await build(total, OUT);             // 第二遍：带总页数渲染
    fs.unlinkSync(tmp);
    console.log(`✅ 已生成 ${OUT}（${total} 页）`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
