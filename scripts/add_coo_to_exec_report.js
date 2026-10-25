/**
 * 在 ERMM_高级主管价值报告.docx 中插入 COO 章节
 * 做法：解包后的 word/document.xml 上做字符串级插入与重编号，
 *       样式模板从现有 CEO/CFO 章节运行时抽取，保证版式一致。
 */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'docs', '_docx_tmp');
const FILE = path.join(DIR, 'word', 'document.xml');
let x = fs.readFileSync(FILE, 'utf8');

const must = (s) => { if (!x.includes(s)) throw new Error('锚点缺失: ' + s); return s; };
const escXml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- 运行时抽取样式模板 ----------
function grabParagraph(anchorText) {
    const i = x.indexOf(anchorText);
    if (i < 0) throw new Error('模板锚点缺失: ' + anchorText);
    const pStart = x.lastIndexOf('<w:p>', i);   // 精确匹配段落起始，避免误中 <w:pPr>
    const pEnd = x.indexOf('</w:p>', i) + '</w:p>'.length;
    return x.slice(pStart, pEnd);
}
const h1Tpl = grabParagraph('四、CTO 视角');            // Heading1 段落
const h2Tpl = grabParagraph('4.1 CTO 的核心困扰');       // Heading2 段落
const starTpl = grabParagraph('★ 即时透明');             // ★ 亮点段落
const bulletTpl = grabParagraph('• 对 CFO');             // 核心价值 bullet
const scenarioTpl = grabParagraph('场景 7：');           // 场景段落

function fromTpl(tpl, oldText, newText) {
    if (!tpl.includes(oldText)) throw new Error('模板内无文本: ' + oldText);
    return tpl.replace(oldText, escXml(newText));
}
const H1 = t => fromTpl(h1Tpl, '四、CTO 视角：技术架构与工程质量', t);
const H2 = t => fromTpl(h2Tpl, '4.1 CTO 的核心困扰', t);

// ★ 段落：标题与说明在同一 w:p 内两个 run，直接整段重建较稳
function STAR(title, desc) {
    const rPr = '<w:rPr><w:rFonts w:ascii="微软雅黑" w:hAnsi="微软雅黑" w:eastAsia="微软雅黑"/><w:sz w:val="22"/></w:rPr>';
    const rPrB = '<w:rPr><w:rFonts w:ascii="微软雅黑" w:hAnsi="微软雅黑" w:eastAsia="微软雅黑"/><w:b/><w:sz w:val="22"/></w:rPr>';
    return `<w:p><w:r>${rPrB.replace('<w:b/>', '')}</w:r><w:r><w:rPr><w:rFonts w:ascii="微软雅黑" w:hAnsi="微软雅黑" w:eastAsia="微软雅黑"/><w:sz w:val="22"/></w:rPr><w:t>★ ${escXml(title)}：</w:t></w:r><w:r>${rPr}<w:t>${escXml(desc)}</w:t></w:r></w:p>`;
}

// ---------- 表格生成（TableGrid，与现有一致）----------
const HEAD_FILL_PAIN = 'C0392B';   // 困扰表红头
const HEAD_FILL_SOL = (() => {     // 解决方案表头色（运行时抽取 2.2 表）
    const i = x.indexOf('2.2 ERMM 解决方案');
    const m = x.slice(i, i + 4000).match(/w:shd w:fill="([0-9A-Fa-f]{6})"/);
    return m ? m[1] : '1A3C5E';
})();
const GRID = '<w:tblGrid><w:gridCol w:w="2880"/><w:gridCol w:w="2880"/><w:gridCol w:w="2880"/></w:tblGrid>';
const WIDTHS = [2268, 3402, 2835];
function cell(text, w, header, fill) {
    const shd = header ? `<w:shd w:fill="${fill}" w:val="clear"/>` : '';
    const rPr = header
        ? '<w:rPr><w:rFonts w:ascii="微软雅黑" w:hAnsi="微软雅黑" w:eastAsia="微软雅黑"/><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="22"/></w:rPr>'
        : '<w:rPr><w:rFonts w:ascii="微软雅黑" w:hAnsi="微软雅黑" w:eastAsia="微软雅黑"/><w:sz w:val="22"/></w:rPr>';
    return `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${w}"/>${shd}</w:tcPr><w:p><w:r/><w:r>${rPr}<w:t>${escXml(text)}</w:t></w:r></w:p></w:tc>`;
}
function table(fill, rows) {
    const trs = rows.map((r, ri) =>
        `<w:tr>${r.map((c, ci) => cell(c, WIDTHS[ci], ri === 0, fill)).join('')}</w:tr>`).join('');
    return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:type="auto" w:w="0"/><w:jc w:val="center"/><w:tblLook w:firstColumn="1" w:firstRow="1" w:lastColumn="0" w:lastRow="0" w:noHBand="0" w:noVBand="1" w:val="04A0"/></w:tblPr>${GRID}${trs}</w:tbl>`;
}
const PAGEBREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

// ---------- COO 章节内容 ----------
const cooPain = table(HEAD_FILL_PAIN, [
    ['困扰', '具体表现', '业务影响'],
    ['月底关账靠人工跑脚本', 'PO→库存→AR/AP→财务摘要全靠人工逐步执行', '关账周期 3 天，人力成本高、易出错'],
    ['第三方数据手工录入', '供应商/客户 Excel 对账单逐笔人工录入', '1000 行要 2 天，错漏率高'],
    ['员工工时黑箱', '谁在忙、谁在闲，没有每日数据', '人力调配凭感觉，忙闲不均'],
    ['异常发现滞后', '延误、缺交月底汇总才知道', '问题扩大后才介入，补救成本高'],
    ['跨部门协作无追踪', '采购延迟影响生产，只看到结果看不到过程', '问题反复发生，无法根因改善'],
    ['系统各自为政', 'ERP、Excel、邮件数据互不相通', '同一份数据多处维护，口径不一'],
]);
const cooSol = table(HEAD_FILL_SOL, [
    ['COO 困扰', 'ERMM 解决方案', '效果'],
    ['月底关账靠人工跑脚本', '⚙️ 7 步批次管线一键执行（PO→汇率→供应商汇总→库存减值→AR/AP→财务摘要）', '关账从 3 天缩短到 30 分钟'],
    ['第三方数据手工录入', '🔌 Excel 导入 + SQL 直连，栏位自动映射、UPSERT 幂等写入', '1000 行 30 秒完成，零错漏'],
    ['员工工时黑箱', '📊 日报工时/案件逐日可见，月度汇总自动产出', '人力调配有据可依，忙闲可视'],
    ['异常发现滞后', '🔔 预警引擎 5 规则每日两次扫描，黄/红灯自动邮件通知', '问题在发生早期被拦截'],
    ['跨部门协作无追踪', '日报标记「待主管审核/跨部门协调」状态，延误案件逐笔可追', '责任清晰，协同提速'],
    ['系统各自为政', '一体化平台 + 批次排程自动加工，业务→财务→税务同源', '单一数据源，报表口径统一'],
]);
const cooStars = [
    STAR('批次管线自动化', '7 步一键跑完 + 防重入排程，月底关账从 3 天缩到 30 分钟'),
    STAR('数据整合零人工', 'Excel/SQL 双通道，栏位白名单 + UPSERT 幂等，跑批日志逐条可查'),
    STAR('人效透明化', '提交及时率、工时、延误/未解案件，部门排行榜一目了然'),
    STAR('异常前置介入', '连续未交 3 天黄灯、5 天红灯，邮件直达主管，不等月底'),
    STAR('单一数据源', '业务单据→财务摘要→纳税申报同源联动，报表不再各说各话'),
].join('');
const cooSection =
    PAGEBREAK +
    H1('四、COO 视角：运营效率与流程自动化') +
    H2('4.1 COO 的核心困扰') + cooPain +
    H2('4.2 ERMM 解决方案') + cooSol +
    H2('4.3 COO 眼中的系统亮点') + cooStars;

// ---------- 1) 既有章节重编号（先大后小避免级联）----------
const renums = [
    ['八、一句话总结', '九、一句话总结'],
    ['七、典型使用场景', '八、典型使用场景'],
    ['六、技术架构', '七、技术架构'],
    ['五、功能矩阵总览', '六、功能矩阵总览'],
    ['四、CTO 视角：技术架构与工程质量', '五、CTO 视角：技术架构与工程质量'],
    ['4.1 CTO 的核心困扰', '5.1 CTO 的核心困扰'],
    ['4.3 CTO 眼中的系统亮点', '5.3 CTO 眼中的系统亮点'],
];
// 4.2 ERMM 解决方案 → 5.2（2.2/3.2 不受影响，串唯一）
renums.push(['4.2 ERMM 解决方案', '5.2 ERMM 解决方案']);
for (const [a, b] of renums) { must(a); x = x.split(a).join(b); }

// ---------- 2) 受众 / 版本 / 核心价值 ----------
x = x.split(must('受众：CEO（首席执行官）· CTO（首席技术官）· CFO（首席财务官）'))
     .join('受众：CEO（首席执行官）· CFO（首席财务官）· COO（首席运营官）· CTO（首席技术官）');
x = x.split(must('版本：v3.0 ｜ 日期：2026-10-15')).join('版本：v3.1 ｜ 日期：2026-10-25');
// 执行摘要核心主张：CFO bullet 后加 COO bullet
const cooBullet = fromTpl(bulletTpl, /CFO/.test(bulletTpl) ? bulletTpl.match(/<w:t>([^<]*)<\/w:t>/)[1] : '', '• 对 COO：批次管线一键跑、第三方数据自动整合，关账与运营效率翻倍。');
{
    const i = x.indexOf(must('• 对 CFO'));
    const end = x.indexOf('</w:p>', i) + '</w:p>'.length;
    x = x.slice(0, end) + cooBullet + x.slice(end);
}

// ---------- 3) 插入 COO 章节（在原 CTO 章节分页符之前）----------
{
    const i = x.indexOf(must('五、CTO 视角'));
    const pb = x.lastIndexOf(PAGEBREAK, i);
    if (pb < 0) throw new Error('找不到 CTO 前分页符');
    x = x.slice(0, pb) + cooSection + x.slice(pb);
}

// ---------- 4) 功能矩阵：COO 加入受益角色 ----------
x = x.split('CFO、IT').join('COO、CFO、IT');   // 第三方整合 + 批次管线两行

// ---------- 5) 新增场景 8（COO），插在「八、典型使用场景」章末 → 即「九、一句话总结」前 ----------
{
    const sc = fromTpl(scenarioTpl, scenarioTpl.match(/<w:t>([^<]*)<\/w:t>/)[1],
        '场景 8：月底关账当天开经营检讨会（COO）\n月底关账日 → IT 进入「批次管线」点「执行全部步骤」→ 7 步 30 分钟跑完 → COO 当天拿到财务摘要召开经营检讨会，不再等 3 天。');
    const i = x.indexOf(must('九、一句话总结'));
    const hStart = x.lastIndexOf('<w:p><w:pPr><w:pStyle w:val="Heading1"', i);
    if (hStart < 0) throw new Error('找不到总结章标题');
    x = x.slice(0, hStart) + sc + x.slice(hStart);
}

// ---------- 6) 结尾一句话 ----------
x = x.split(must('CEO 看清全貌 ｜ CFO 管好钱财 ｜ CTO 稳住架构'))
     .join('CEO 看清全貌 ｜ CFO 管好钱财 ｜ COO 理顺运营 ｜ CTO 稳住架构');

fs.writeFileSync(FILE, x, 'utf8');
console.log('✅ document.xml 已更新（COO 章节插入 + 重编号完成）');
