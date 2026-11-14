/**
 * 董事会 / 投资人报告包路由（CEO-02）
 *
 *   GET    /api/board-pack/data           预览报告包数据（六区块）
 *   POST   /api/board-pack/generate       生成并留存快照（board_pack）
 *   GET    /api/board-pack/history        报告包生成记录
 *   GET    /api/board-pack/history/:uid   单笔记录 + 按原参数重算的数据
 *   DELETE /api/board-pack/history/:uid   删除记录
 *   GET    /api/board-pack/export/pdf     导出 PDF
 *   GET    /api/board-pack/export/pptx    导出 PPTX
 */

const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const PptxGenJS = require('pptxgenjs');
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const { buildBoardPack } = require('../services/boardPack');

const PDF_FONT = 'C:/Windows/Fonts/msyh.ttc';
const PDF_FONT_BOLD = 'C:/Windows/Fonts/msyhbd.ttc';

const NAVY = '#1e3a5f';
const BLUE = '#2563eb';
const GRAY = '#475569';
const LIGHT = '#f1f5f9';

const num = (v) => (v === null || v === undefined || isNaN(v)) ? null : Number(v);
const money = (v) => num(v) === null ? '-' : num(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ratio = (v, unit = '%') => num(v) === null ? '-' : `${num(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${unit}`;
const buText = (bu) => (!bu || bu === 'GROUP') ? '集团' : bu;
const levelText = (lv) => lv === 'critical' ? '严重' : lv === 'warning' ? '关注' : '提示';

function periodLabel(pack) {
    return pack.period === 'quarter' ? `${pack.period_label} 季度` : `${pack.period_label} 月度`;
}

function packTitle(pack) {
    return `${buText(pack.bu_no)} ${periodLabel(pack)} 董事会报告包`;
}

function attachment(res, filename) {
    const ascii = filename.replace(/[^\x20-\x7e]/g, '_');
    res.setHeader('Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(filename)}; filename="${ascii}"`);
}

async function loadPack(req) {
    return buildBoardPack({
        bu_no: req.query.bu_no || 'GROUP',
        YYYY_MM: req.query.YYYY_MM || undefined,
        period: req.query.period === 'quarter' ? 'quarter' : 'month'
    });
}

// ===================== 数据接口 =====================

router.get('/data', async (req, res) => {
    try {
        const pack = await loadPack(req);
        if (pack.empty) return fail(res, '所选期间没有财务数据', 404);
        ok(res, pack);
    } catch (e) { fail500(res, e); }
});

router.post('/generate', async (req, res) => {
    try {
        const body = req.body || {};
        const pack = await buildBoardPack({
            bu_no: body.bu_no || 'GROUP',
            YYYY_MM: body.YYYY_MM || undefined,
            period: body.period === 'quarter' ? 'quarter' : 'month'
        });
        if (pack.empty) return fail(res, '所选期间没有财务数据', 404);

        const title = body.title || packTitle(pack);
        const [r] = await pool.execute(
            `INSERT INTO board_pack (bu_no, YYYY_MM, period_type, title, summary, generated_by)
             VALUES (?,?,?,?,?,?)`,
            [pack.bu_no, pack.YYYY_MM, pack.period, title, JSON.stringify(pack.summary), req.user && req.user.user_id || null]
        );
        ok(res, { uid: r.insertId, title, pack }, '报告包已生成');
    } catch (e) { fail500(res, e); }
});

router.get('/history', async (req, res) => {
    try {
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
        const buNo = req.query.bu_no;
        const params = [];
        let where = '';
        if (buNo) { where = 'WHERE bu_no=?'; params.push(buNo); }
        const [rows] = await pool.execute(
            `SELECT uid, bu_no, YYYY_MM, period_type, title, summary, generated_by, created_at
             FROM board_pack ${where}
             ORDER BY uid DESC LIMIT ${limit}`, params);
        ok(res, rows.map(r => {
            let summary = [];
            try { summary = JSON.parse(r.summary || '[]'); } catch (e) { summary = []; }
            return Object.assign({}, r, { summary });
        }));
    } catch (e) { fail500(res, e); }
});

router.get('/history/:uid', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT uid, bu_no, YYYY_MM, period_type, title, summary, generated_by, created_at
             FROM board_pack WHERE uid=? LIMIT 1`, [req.params.uid]);
        if (!rows.length) return fail(res, '报告包记录不存在', 404);
        const rec = rows[0];
        const pack = await buildBoardPack({
            bu_no: rec.bu_no, YYYY_MM: rec.YYYY_MM, period: rec.period_type
        });
        ok(res, { record: rec, pack });
    } catch (e) { fail500(res, e); }
});

router.delete('/history/:uid', async (req, res) => {
    try {
        const [r] = await pool.execute('DELETE FROM board_pack WHERE uid=?', [req.params.uid]);
        if (!r.affectedRows) return fail(res, '报告包记录不存在', 404);
        ok(res, { uid: Number(req.params.uid) }, '已删除');
    } catch (e) { fail500(res, e); }
});

// ===================== PDF 导出 =====================

function pdfFooter(doc, pack) {
    const mb = doc.page.margins.bottom;
    const y0 = doc.y, x0 = doc.x;
    doc.page.margins.bottom = 0; // 放开下边界，避免页脚文字触发自动分页（否则 pageAdded 递归）
    doc.font('cjk').fontSize(8).fillColor('#94a3b8')
        .text(`ERMM 董事会报告包 · ${buText(pack.bu_no)} ${pack.period_label}`, 50, 806,
            { width: 495, align: 'center', lineBreak: false });
    doc.page.margins.bottom = mb;
    doc.x = x0; doc.y = y0;
    doc.fillColor('#1e293b');
}

function pdfTable(doc, header, rows, widths) {
    const M = 50, PAD = 5, SIZE = 8.5;
    const total = widths.reduce((a, b) => a + b, 0);

    const drawRow = (cells, opts) => {
        let h = 0;
        cells.forEach((c, i) => {
            h = Math.max(h, doc.font(opts.bold ? 'cjkb' : 'cjk').fontSize(SIZE)
                .heightOfString(String(c === null || c === undefined ? '' : c), { width: widths[i] - PAD * 2, lineGap: 1 }));
        });
        h += 8;
        if (doc.y + h > 790) doc.addPage();
        const y = doc.y;
        doc.rect(M, y, total, h).fill(opts.fill);
        doc.rect(M, y, total, h).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
        let x = M;
        cells.forEach((c, i) => {
            doc.font(opts.bold ? 'cjkb' : 'cjk').fontSize(SIZE).fillColor(opts.color)
                .text(String(c === null || c === undefined ? '' : c), x + PAD, y + 4,
                    { width: widths[i] - PAD * 2, lineGap: 1, align: i === 0 ? 'left' : 'right' });
            x += widths[i];
        });
        doc.x = M;
        doc.y = y + h;
    };

    drawRow(header, { bold: true, color: '#ffffff', fill: NAVY });
    rows.forEach((r, i) => drawRow(r, { bold: false, color: '#1e293b', fill: i % 2 ? '#ffffff' : LIGHT }));
    doc.moveDown(0.6);
}

function pdfHeading(doc, text) {
    if (doc.y + 46 > 780) doc.addPage();
    doc.moveDown(0.5);
    doc.font('cjkb').fontSize(13).fillColor(NAVY).text(text, 50, doc.y, { width: 495 });
    doc.moveTo(50, doc.y + 3).lineTo(545, doc.y + 3).lineWidth(1).strokeColor(BLUE).stroke();
    doc.moveDown(0.6);
    doc.x = 50;
}

function pdfBullet(doc, text, color) {
    if (doc.y + 24 > 790) doc.addPage();
    doc.font('cjk').fontSize(10).fillColor(color || '#1e293b')
        .text(`▪  ${text}`, 56, doc.y, { width: 484, lineGap: 3 });
    doc.x = 50;
    doc.moveDown(0.2);
}

function buildPdf(pack, res) {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 50, right: 50 } });
    doc.registerFont('cjk', PDF_FONT, 'MicrosoftYaHei');
    doc.registerFont('cjkb', PDF_FONT_BOLD, 'MicrosoftYaHei-Bold');
    doc.info.Title = packTitle(pack);
    doc.info.Author = 'ERMM Finance';
    res.setHeader('Content-Type', 'application/pdf');
    attachment(res, `${packTitle(pack)}.pdf`);
    doc.pipe(res);
    doc.on('pageAdded', () => pdfFooter(doc, pack));

    const s = pack.sections || {};
    const income = s.income || {};
    const ytd = s.income_ytd || {};
    const ly = s.income_ly || null;
    const bal = s.balance || {};
    const balPrev = s.balance_prev || {};
    const cf = s.cashflow || {};

    // ===== 封面 =====
    doc.rect(0, 0, 595.28, 250).fill(NAVY);
    doc.font('cjkb').fontSize(26).fillColor('#ffffff').text('董事会 / 投资人报告包', 50, 92, { width: 495 });
    doc.font('cjk').fontSize(14).fillColor('#bfdbfe')
        .text(`${buText(pack.bu_no)} · ${periodLabel(pack)}`, 50, 145, { width: 495 });
    doc.font('cjk').fontSize(10).fillColor('#cbd5e1')
        .text(`币别：人民币（元）    生成时间：${new Date(pack.generated_at).toLocaleString('zh-CN')}`, 50, 180, { width: 495 });
    doc.fillColor('#1e293b');
    doc.y = 280;

    pdfHeading(doc, '一、经营摘要');
    (pack.summary || []).forEach(line => pdfBullet(doc, line));

    pdfHeading(doc, '二、损益表（单位：元）');
    pdfTable(doc, ['项目', '本期', '年初至今', ly ? '去年同期' : '—'], [
        ['营业收入', money(income.sale), money(ytd.sale), ly ? money(ly.sale) : '-'],
        ['营业成本', money(income.cost), money(ytd.cost), ly ? money(ly.cost) : '-'],
        ['毛利', money(income.gross_profit), money(ytd.gross_profit), ly ? money(ly.gross_profit) : '-'],
        ['毛利率', ratio(income.gross_margin), ratio(ytd.gross_margin), ly ? ratio(ly.gross_margin) : '-'],
        ['销售费用', money(income.sale_exp), money(ytd.sale_exp), ly ? money(ly.sale_exp) : '-'],
        ['管理费用', money(income.mgmt_exp), money(ytd.mgmt_exp), ly ? money(ly.mgmt_exp) : '-'],
        ['财务费用', money(income.finance_exp), money(ytd.finance_exp), ly ? money(ly.finance_exp) : '-'],
        ['营业利润', money(income.operation_profit), money(ytd.operation_profit), ly ? money(ly.operation_profit) : '-'],
        ['税前利润', money(income.pretax_profit), money(ytd.pretax_profit), ly ? money(ly.pretax_profit) : '-'],
        ['净利润', money(income.net_profit), money(ytd.net_profit), ly ? money(ly.net_profit) : '-'],
        ['净利率', ratio(income.net_margin), ratio(ytd.net_margin), ly ? ratio(ly.net_margin) : '-']
    ], [135, 120, 120, 120]);

    pdfHeading(doc, '三、资产负债表（单位：元）');
    pdfTable(doc, ['项目', '期末', '上期'], [
        ['货币资金', money(bal.cash), money(balPrev.cash)],
        ['银行存款', money(bal.deposit), money(balPrev.deposit)],
        ['应收账款', money(bal.ar), money(balPrev.ar)],
        ['存货', money(bal.inventory), money(balPrev.inventory)],
        ['流动资产合计', money(bal.current_asset), money(balPrev.current_asset)],
        ['资产总计', money(bal.total_asset), money(balPrev.total_asset)],
        ['应付账款', money(bal.ap), money(balPrev.ap)],
        ['短期借款', money(bal.short_loan), money(balPrev.short_loan)],
        ['长期借款', money(bal.long_loan), money(balPrev.long_loan)],
        ['流动负债合计', money(bal.current_liab), money(balPrev.current_liab)],
        ['负债合计', money(bal.total_liab), money(balPrev.total_liab)],
        ['所有者权益', money(bal.equity), money(balPrev.equity)],
        ['资产负债率', ratio(bal.debt_ratio), ratio(balPrev.debt_ratio)],
        ['流动比率', ratio(bal.current_ratio, '倍'), ratio(balPrev.current_ratio, '倍')]
    ], [215, 140, 140]);

    pdfHeading(doc, '四、现金流量表（单位：元）');
    pdfTable(doc, ['项目', '本期金额'], [
        ['期初现金及存款', money(cf.begin)],
        ['经营活动现金流入', money(cf.operation_in)],
        ['经营活动现金流出', money(cf.operation_out)],
        ['经营活动净现金流', money(cf.operation_net)],
        ['投资活动现金流入', money(cf.invest_in)],
        ['投资活动现金流出', money(cf.invest_out)],
        ['投资活动净现金流', money(cf.invest_net)],
        ['筹资活动现金流入', money(cf.finance_in)],
        ['筹资活动现金流出', money(cf.finance_out)],
        ['筹资活动净现金流', money(cf.finance_net)],
        ['本期现金净变动', money(cf.net_change)],
        ['期末现金及存款', money(cf.end)]
    ], [300, 195]);

    pdfHeading(doc, '五、核心 KPI');
    const targets = s.targets || [];
    const kpiRows = (s.kpis || []).map(k => {
        const row = [k.label, k.value === null ? '-' : ratio(k.value, ''),
            k.yoy === null || k.yoy === undefined ? '-' : ratio(k.yoy), k.unit || ''];
        if (targets.length) {
            const tg = targets.find(t => t.kpi_code === k.code);
            row.splice(3, 0, tg ? ratio(tg.target, '') : '-');
        }
        return row;
    });
    pdfTable(doc, targets.length ? ['指标', '本期', '同比 / 变动', '年度目标', '单位'] : ['指标', '本期', '同比 / 变动', '单位'],
        kpiRows, targets.length ? [155, 115, 105, 80, 40] : [175, 130, 120, 70]);

    pdfHeading(doc, '六、风险预警');
    if (!(s.risks || []).length) {
        pdfBullet(doc, '本期未识别到重大财务风险');
    } else {
        pdfTable(doc, ['等级', '范畴', '事项', '说明'],
            s.risks.map(r => [levelText(r.level), r.area, r.title, r.detail]),
            [50, 55, 100, 290]);
    }

    pdfHeading(doc, '七、重大事项');
    if (!(s.events || []).length) {
        pdfBullet(doc, '本期无重大事项');
    } else {
        s.events.slice(0, 8).forEach(e => pdfBullet(doc, `【${levelText(e.level)}】${e.title}${e.bu_no ? '（' + e.bu_no + '）' : ''}：${e.message || ''}`));
    }

    if ((s.bu_compare || []).length) {
        pdfHeading(doc, '八、各公司经营对比（单位：元）');
        pdfTable(doc, ['公司', '营业收入', '净利润', '毛利率', '净利率', '资产负债率', '现金及存款'],
            s.bu_compare.map(b => [
                b.bu_no, money(b.revenue), money(b.net_profit), ratio(b.gross_margin),
                ratio(b.net_margin), ratio(b.debt_ratio), money(b.cash)
            ]), [58, 88, 82, 62, 62, 68, 75]);
    }

    pdfFooter(doc, pack);
    doc.end();
}

router.get('/export/pdf', async (req, res) => {
    try {
        const pack = await loadPack(req);
        if (pack.empty) return fail(res, '所选期间没有财务数据', 404);
        buildPdf(pack, res);
    } catch (e) {
        if (res.headersSent) return res.end();
        fail500(res, e);
    }
});

// ===================== PPTX 导出 =====================

const PPT_NAVY = '1E3A5F';
const PPT_BLUE = '2563EB';
const PPT_GRAY = '475569';
const PPT_LIGHT = 'F5F7FA';

function pptTable(rows, opts = {}) {
    return rows.map((r, ri) => r.map((c, ci) => ({
        text: String(c === null || c === undefined ? '' : c),
        options: ri === 0
            ? { bold: true, color: 'FFFFFF', fill: { color: PPT_NAVY }, fontSize: opts.headSize || 11, align: ci === 0 ? 'left' : 'center' }
            : { color: '1E293B', fill: { color: ri % 2 ? 'FFFFFF' : 'F1F5F9' }, fontSize: opts.size || 10, align: ci === 0 ? 'left' : 'center' }
    })));
}

function pptContentSlide(pptx, title) {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addShape('rect', { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: PPT_BLUE } });
    slide.addText(title, { x: 0.7, y: 0.4, w: 12.2, h: 0.9, fontSize: 24, bold: true, color: PPT_NAVY, fontFace: 'Microsoft YaHei' });
    slide.addShape('line', { x: 0.7, y: 1.35, w: 11.9, h: 0, line: { color: 'E2E8F0', width: 1 } });
    return slide;
}

async function buildPptx(pack, res) {
    const s = pack.sections || {};
    const income = s.income || {};
    const ytd = s.income_ytd || {};
    const ly = s.income_ly || null;
    const bal = s.balance || {};
    const balPrev = s.balance_prev || {};
    const cf = s.cashflow || {};
    const targets = s.targets || [];

    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'W169', width: 13.33, height: 7.5 });
    pptx.layout = 'W169';

    // 封面
    const cover = pptx.addSlide();
    cover.background = { color: PPT_NAVY };
    cover.addText('董事会 / 投资人报告包', { x: 0.8, y: 2.1, w: 11.7, h: 1.2, fontSize: 36, bold: true, color: 'FFFFFF', fontFace: 'Microsoft YaHei' });
    cover.addText(`${buText(pack.bu_no)} · ${periodLabel(pack)}`, { x: 0.8, y: 3.35, w: 11.7, h: 0.7, fontSize: 20, color: 'BFDBFE', fontFace: 'Microsoft YaHei' });
    cover.addText(`生成时间：${new Date(pack.generated_at).toLocaleString('zh-CN')}　|　币别：人民币（元）`, { x: 0.8, y: 4.1, w: 11.7, h: 0.5, fontSize: 13, color: '93C5FD', fontFace: 'Microsoft YaHei' });

    // 经营摘要
    const s2 = pptContentSlide(pptx, '一、经营摘要');
    s2.addText((pack.summary || []).map(t => ({ text: t, options: { bullet: { code: '25AA' }, fontSize: 15, color: '1E293B', paraSpaceAfter: 12 } })),
        { x: 0.9, y: 1.7, w: 11.6, h: 5.2, fontFace: 'Microsoft YaHei', lineSpacing: 28 });

    // 损益表
    const s3 = pptContentSlide(pptx, '二、损益表（单位：元）');
    s3.addTable(pptTable([
        ['项目', '本期', '年初至今', ly ? '去年同期' : '—'],
        ['营业收入', money(income.sale), money(ytd.sale), ly ? money(ly.sale) : '-'],
        ['营业成本', money(income.cost), money(ytd.cost), ly ? money(ly.cost) : '-'],
        ['毛利', money(income.gross_profit), money(ytd.gross_profit), ly ? money(ly.gross_profit) : '-'],
        ['毛利率', ratio(income.gross_margin), ratio(ytd.gross_margin), ly ? ratio(ly.gross_margin) : '-'],
        ['期间费用', money(num(income.sale_exp) + num(income.mgmt_exp) + num(income.finance_exp)),
            money(num(ytd.sale_exp) + num(ytd.mgmt_exp) + num(ytd.finance_exp)),
            ly ? money(num(ly.sale_exp) + num(ly.mgmt_exp) + num(ly.finance_exp)) : '-'],
        ['营业利润', money(income.operation_profit), money(ytd.operation_profit), ly ? money(ly.operation_profit) : '-'],
        ['税前利润', money(income.pretax_profit), money(ytd.pretax_profit), ly ? money(ly.pretax_profit) : '-'],
        ['净利润', money(income.net_profit), money(ytd.net_profit), ly ? money(ly.net_profit) : '-'],
        ['净利率', ratio(income.net_margin), ratio(ytd.net_margin), ly ? ratio(ly.net_margin) : '-']
    ]), { x: 0.7, y: 1.7, w: 11.9, fontFace: 'Microsoft YaHei', valign: 'middle', border: { pt: 0.5, color: 'CBD5E1' }, autoPage: false });

    // 资产负债表
    const s4 = pptContentSlide(pptx, '三、资产负债表（单位：元）');
    s4.addTable(pptTable([
        ['项目', '期末', '上期'],
        ['货币资金', money(bal.cash), money(balPrev.cash)],
        ['应收账款', money(bal.ar), money(balPrev.ar)],
        ['存货', money(bal.inventory), money(balPrev.inventory)],
        ['资产总计', money(bal.total_asset), money(balPrev.total_asset)],
        ['负债合计', money(bal.total_liab), money(balPrev.total_liab)],
        ['所有者权益', money(bal.equity), money(balPrev.equity)],
        ['资产负债率', ratio(bal.debt_ratio), ratio(balPrev.debt_ratio)],
        ['流动比率', ratio(bal.current_ratio, '倍'), ratio(balPrev.current_ratio, '倍')],
        ['净借款', money(bal.net_debt), money(balPrev.net_debt)]
    ]), { x: 0.7, y: 1.7, w: 11.9, fontFace: 'Microsoft YaHei', valign: 'middle', border: { pt: 0.5, color: 'CBD5E1' }, autoPage: false });

    // 现金流量表
    const s5 = pptContentSlide(pptx, '四、现金流量表（单位：元）');
    s5.addTable(pptTable([
        ['项目', '本期金额'],
        ['期初现金及存款', money(cf.begin)],
        ['经营活动净现金流', money(cf.operation_net)],
        ['投资活动净现金流', money(cf.invest_net)],
        ['筹资活动净现金流', money(cf.finance_net)],
        ['本期现金净变动', money(cf.net_change)],
        ['期末现金及存款', money(cf.end)]
    ]), { x: 0.7, y: 1.7, w: 7.6, fontFace: 'Microsoft YaHei', valign: 'middle', border: { pt: 0.5, color: 'CBD5E1' }, autoPage: false });

    s5.addText('现金流结构', { x: 8.7, y: 1.75, w: 3.9, h: 0.4, fontSize: 14, bold: true, color: PPT_NAVY, fontFace: 'Microsoft YaHei' });
    s5.addText([
        { text: `经营活动：流入 ${money(cf.operation_in)} / 流出 ${money(cf.operation_out)}\n`, options: { fontSize: 12, color: '1E293B' } },
        { text: `投资活动：流入 ${money(cf.invest_in)} / 流出 ${money(cf.invest_out)}\n`, options: { fontSize: 12, color: '1E293B' } },
        { text: `筹资活动：流入 ${money(cf.finance_in)} / 流出 ${money(cf.finance_out)}\n`, options: { fontSize: 12, color: '1E293B' } },
        { text: `经营现金流${num(cf.operation_net) < 0 ? '为负，需关注获现能力' : '为正，主业获现正常'}`, options: { fontSize: 12, bold: true, color: num(cf.operation_net) < 0 ? 'DC2626' : '16A34A' } }
    ], { x: 8.7, y: 2.25, w: 3.9, h: 4.4, fontFace: 'Microsoft YaHei', lineSpacing: 26 });

    // 核心 KPI
    const s6 = pptContentSlide(pptx, '五、核心 KPI');
    const kpiRows = [targets.length ? ['指标', '本期', '同比 / 变动', '年度目标', '单位'] : ['指标', '本期', '同比 / 变动', '单位']];
    (s.kpis || []).forEach(k => {
        const tg = targets.find(t => t.kpi_code === k.code);
        const row = [k.label, k.value === null ? '-' : ratio(k.value, ''),
            k.yoy === null || k.yoy === undefined ? '-' : ratio(k.yoy), k.unit || ''];
        if (targets.length) row.splice(3, 0, tg ? ratio(tg.target, '') : '-');
        kpiRows.push(row);
    });
    s6.addTable(pptTable(kpiRows, { size: 10.5 }), { x: 0.7, y: 1.7, w: 11.9, fontFace: 'Microsoft YaHei', valign: 'middle', border: { pt: 0.5, color: 'CBD5E1' }, autoPage: false });

    // 风险预警
    const s7 = pptContentSlide(pptx, '六、风险预警');
    const risks = s.risks || [];
    if (!risks.length) {
        s7.addText('本期未识别到重大财务风险', { x: 0.9, y: 1.8, w: 11.6, h: 0.6, fontSize: 16, color: PPT_GRAY, fontFace: 'Microsoft YaHei' });
    } else {
        s7.addTable(pptTable([['等级', '范畴', '事项', '说明']].concat(
            risks.map(r => [levelText(r.level), r.area, r.title, r.detail])), { size: 9.5 }),
            { x: 0.7, y: 1.7, w: 11.9, fontFace: 'Microsoft YaHei', valign: 'middle', border: { pt: 0.5, color: 'CBD5E1' }, autoPage: false });
    }

    // 重大事项
    const s8 = pptContentSlide(pptx, '七、重大事项');
    const events = (s.events || []).slice(0, 8);
    if (!events.length) {
        s8.addText('本期无重大事项', { x: 0.9, y: 1.8, w: 11.6, h: 0.6, fontSize: 16, color: PPT_GRAY, fontFace: 'Microsoft YaHei' });
    } else {
        s8.addText(events.map(e => ({
            text: `【${levelText(e.level)}】${e.title}${e.bu_no ? '（' + e.bu_no + '）' : ''}：${e.message || ''}`,
            options: { bullet: { code: '25AA' }, fontSize: 13, color: '1E293B', paraSpaceAfter: 8 }
        })), { x: 0.9, y: 1.7, w: 11.6, h: 5.3, fontFace: 'Microsoft YaHei', lineSpacing: 24 });
    }

    // BU 对比
    if ((s.bu_compare || []).length) {
        const s9 = pptContentSlide(pptx, '八、各公司经营对比（单位：元）');
        s9.addTable(pptTable([['公司', '营业收入', '净利润', '毛利率', '净利率', '资产负债率', '现金及存款']].concat(
            s.bu_compare.map(b => [b.bu_no, money(b.revenue), money(b.net_profit), ratio(b.gross_margin),
                ratio(b.net_margin), ratio(b.debt_ratio), money(b.cash)])), { size: 10 }),
            { x: 0.7, y: 1.7, w: 11.9, fontFace: 'Microsoft YaHei', valign: 'middle', border: { pt: 0.5, color: 'CBD5E1' }, autoPage: false });
    }

    const buf = await pptx.write({ outputType: 'nodebuffer' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    attachment(res, `${packTitle(pack)}.pptx`);
    res.end(buf);
}

router.get('/export/pptx', async (req, res) => {
    try {
        const pack = await loadPack(req);
        if (pack.empty) return fail(res, '所选期间没有财务数据', 404);
        await buildPptx(pack, res);
    } catch (e) {
        if (res.headersSent) return res.end();
        fail500(res, e);
    }
});

module.exports = router;
