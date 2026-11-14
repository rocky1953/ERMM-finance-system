/**
 * 董事会 / 投资人报告包（CEO-02）
 * 预览六大区块：经营摘要 · 三大报表 · 核心 KPI · 风险预警 · 重大事项 · BU 对比
 * 支持生成留存（board_pack）与 PDF / PPTX 导出
 */
const BP_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] || zh);
const BP_ESC = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const BP_MONEY = (v) => (v === null || v === undefined || isNaN(v)) ? '-'
    : Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BP_RATIO = (v, unit = '%') => (v === null || v === undefined || isNaN(v)) ? '-'
    : Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + unit;
const BP_BU = (bu) => (!bu || bu === 'GROUP') ? BP_L('集团', '集團', 'Group') : bu;
const BP_LEVEL = (lv) => lv === 'critical'
    ? { text: BP_L('严重', '嚴重', 'Critical'), color: '#dc2626', bg: '#fef2f2' }
    : lv === 'warning'
        ? { text: BP_L('关注', '關注', 'Watch'), color: '#d97706', bg: '#fffbeb' }
        : { text: BP_L('提示', '提示', 'Info'), color: '#2563eb', bg: '#eff6ff' };

const BoardPackPage = {
    bu: State.bu_no,
    ym: State.YYYY_MM,
    period: 'month',
    pack: null,

    async load() {
        if (!Auth.isLoggedIn()) { Auth.showLogin(); return; }
        if (!Auth.canAccess('boardPack')) {
            document.getElementById('pageContent').innerHTML = UI.empty('🔒', BP_L('无权限访问该模块', '無權限存取該模組', 'No permission to access this module'));
            return;
        }
        const page = document.getElementById('pageContent');
        const buHtml = await CodeHelper.buSel({
            includeAll: true, allValue: 'GROUP',
            allLabel: BP_L('集团（合并）', '集團（合併）', 'Group (Consolidated)'),
            selected: this.bu
        });
        page.innerHTML = `
            <div class="page-header">
                <div class="page-actions">
                    <select id="bpBu" class="form-input" style="width:150px">${buHtml}</select>
                    <input type="month" id="bpMonth" class="form-input" style="width:150px">
                    <select id="bpPeriod" class="form-input" style="width:110px">
                        <option value="month">${BP_L('月度', '月度', 'Monthly')}</option>
                        <option value="quarter">${BP_L('季度', '季度', 'Quarterly')}</option>
                    </select>
                    <button class="btn btn-primary" onclick="BoardPackPage.refresh()">🔄 ${BP_L('预览', '預覽', 'Preview')}</button>
                    <button class="btn btn-ghost" onclick="BoardPackPage.generate()">📑 ${BP_L('生成并留存', '產生並留存', 'Generate')}</button>
                    <button class="btn btn-ghost" onclick="BoardPackPage.exportFile('pdf')">⬇ PDF</button>
                    <button class="btn btn-ghost" onclick="BoardPackPage.exportFile('pptx')">⬇ PPTX</button>
                </div>
            </div>
            <div id="bpBody"><div style="padding:40px;text-align:center;color:#999">⏳</div></div>
            <div class="card" style="margin-top:18px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                    <h3 style="margin:0;font-size:15px">${BP_L('生成记录', '產生記錄', 'Generation History')}</h3>
                    <button class="btn btn-ghost" onclick="BoardPackPage.loadHistory()">🔄 ${BP_L('刷新', '重新整理', 'Refresh')}</button>
                </div>
                <div id="bpHistory"><div style="color:#999">⏳</div></div>
            </div>
        `;
        document.getElementById('bpBu').value = this.bu;
        document.getElementById('bpMonth').value = this.ym;
        document.getElementById('bpPeriod').value = this.period;
        await Promise.all([this.refresh(), this.loadHistory()]);
    },

    params() {
        const bu = document.getElementById('bpBu') ? document.getElementById('bpBu').value : this.bu;
        const ym = document.getElementById('bpMonth') ? document.getElementById('bpMonth').value : this.ym;
        const period = document.getElementById('bpPeriod') ? document.getElementById('bpPeriod').value : this.period;
        this.bu = bu; this.ym = ym; this.period = period;
        return { bu_no: bu || 'GROUP', YYYY_MM: ym, period };
    },

    query(obj) {
        return Object.keys(obj).filter(k => obj[k] !== undefined && obj[k] !== null && obj[k] !== '')
            .map(k => `${k}=${encodeURIComponent(obj[k])}`).join('&');
    },

    async refresh() {
        const p = this.params();
        const body = document.getElementById('bpBody');
        body.innerHTML = `<div style="padding:40px;text-align:center;color:#999">⏳</div>`;
        try {
            const res = await API.get(`/api/board-pack/data?${this.query(p)}`);
            this.pack = res.data;
            this.render(this.pack);
        } catch (e) {
            body.innerHTML = `<div class="card" style="color:#dc2626">${BP_ESC(e.message)}</div>`;
        }
    },

    card(label, value, sub, color) {
        return `<div style="flex:1;min-width:165px;border:1px solid #e2e8f0;border-left:4px solid ${color};border-radius:8px;padding:12px;background:#fff">
            <div style="font-size:12px;color:#64748b">${label}</div>
            <div style="font-size:19px;font-weight:700;margin:4px 0;color:${color}">${value}</div>
            <div style="font-size:11px;color:#94a3b8">${sub || ''}</div>
        </div>`;
    },

    table(head, rows) {
        return `<div style="overflow-x:auto"><table class="data-table">
            <thead><tr>${head.map((h, i) => `<th style="${i === 0 ? '' : 'text-align:right;'}">${h}</th>`).join('')}</tr></thead>
            <tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td style="${i === 0 ? '' : 'text-align:right;'}">${c}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>`;
    },

    section(title, inner) {
        return `<div class="card" style="margin-top:14px">
            <h3 style="margin:0 0 10px;font-size:15px;color:#1e3a5f">${title}</h3>${inner}
        </div>`;
    },

    render(pack) {
        const s = pack.sections || {};
        const inc = s.income || {}, ytd = s.income_ytd || {}, ly = s.income_ly;
        const bal = s.balance || {}, balPrev = s.balance_prev || {};
        const cf = s.cashflow || {};
        const risks = s.risks || [], events = s.events || [], kpis = s.kpis || [], targets = s.targets || [];

        const yoyText = (cur, prev) => {
            if (cur === null || cur === undefined || prev === null || prev === undefined || Number(prev) === 0) return '';
            const g = (Number(cur) - Number(prev)) / Math.abs(Number(prev)) * 100;
            return `<span style="color:${g >= 0 ? '#16a34a' : '#dc2626'}">${g >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(g * 100) / 100)}% ${BP_L('同比', '同比', 'YoY')}</span>`;
        };
        const riskCnt = risks.filter(r => r.level === 'critical').length;

        const cards = `<div style="display:flex;gap:12px;flex-wrap:wrap">
            ${this.card(BP_L('营业收入', '營業收入', 'Revenue'), BP_MONEY(inc.sale), yoyText(inc.sale, ly && ly.sale), '#2563eb')}
            ${this.card(BP_L('净利润', '淨利潤', 'Net Profit'), BP_MONEY(inc.net_profit), yoyText(inc.net_profit, ly && ly.net_profit), Number(inc.net_profit) < 0 ? '#dc2626' : '#16a34a')}
            ${this.card(BP_L('毛利率', '毛利率', 'Gross Margin'), BP_RATIO(inc.gross_margin), BP_L('净利率 ', '淨利率 ', 'Net margin ') + BP_RATIO(inc.net_margin), '#7c3aed')}
            ${this.card(BP_L('现金及存款', '現金及存款', 'Cash & Deposits'), BP_MONEY(bal.cash_total), BP_L('净借款 ', '淨借款 ', 'Net debt ') + BP_MONEY(bal.net_debt), '#0891b2')}
            ${this.card(BP_L('资产负债率', '資產負債率', 'Debt Ratio'), BP_RATIO(bal.debt_ratio), BP_L('流动比率 ', '流動比率 ', 'Current ratio ') + BP_RATIO(bal.current_ratio, '倍'), '#d97706')}
            ${this.card(BP_L('风险预警', '風險預警', 'Risk Alerts'), `${risks.length}`, riskCnt ? BP_L('其中严重 ', '其中嚴重 ', 'critical ') + riskCnt : BP_L('无严重项', '無嚴重項', 'no critical'), riskCnt ? '#dc2626' : '#16a34a')}
        </div>`;

        const summaryHtml = `<ol style="margin:0;padding-left:20px;line-height:1.9;font-size:13px;color:#334155">
            ${(pack.summary || []).map(l => `<li>${BP_ESC(l)}</li>`).join('')}
        </ol>`;

        const incomeRows = [
            [BP_L('营业收入', '營業收入', 'Revenue'), BP_MONEY(inc.sale), BP_MONEY(ytd.sale), ly ? BP_MONEY(ly.sale) : '-'],
            [BP_L('营业成本', '營業成本', 'Cost'), BP_MONEY(inc.cost), BP_MONEY(ytd.cost), ly ? BP_MONEY(ly.cost) : '-'],
            [BP_L('毛利', '毛利', 'Gross Profit'), BP_MONEY(inc.gross_profit), BP_MONEY(ytd.gross_profit), ly ? BP_MONEY(ly.gross_profit) : '-'],
            [BP_L('毛利率', '毛利率', 'Gross Margin'), BP_RATIO(inc.gross_margin), BP_RATIO(ytd.gross_margin), ly ? BP_RATIO(ly.gross_margin) : '-'],
            [BP_L('销售费用', '銷售費用', 'Selling Exp.'), BP_MONEY(inc.sale_exp), BP_MONEY(ytd.sale_exp), ly ? BP_MONEY(ly.sale_exp) : '-'],
            [BP_L('管理费用', '管理費用', 'G&A Exp.'), BP_MONEY(inc.mgmt_exp), BP_MONEY(ytd.mgmt_exp), ly ? BP_MONEY(ly.mgmt_exp) : '-'],
            [BP_L('财务费用', '財務費用', 'Finance Exp.'), BP_MONEY(inc.finance_exp), BP_MONEY(ytd.finance_exp), ly ? BP_MONEY(ly.finance_exp) : '-'],
            [BP_L('营业利润', '營業利潤', 'Operating Profit'), BP_MONEY(inc.operation_profit), BP_MONEY(ytd.operation_profit), ly ? BP_MONEY(ly.operation_profit) : '-'],
            [BP_L('税前利润', '稅前利潤', 'Pre-tax Profit'), BP_MONEY(inc.pretax_profit), BP_MONEY(ytd.pretax_profit), ly ? BP_MONEY(ly.pretax_profit) : '-'],
            [BP_L('净利润', '淨利潤', 'Net Profit'), BP_MONEY(inc.net_profit), BP_MONEY(ytd.net_profit), ly ? BP_MONEY(ly.net_profit) : '-'],
            [BP_L('净利率', '淨利率', 'Net Margin'), BP_RATIO(inc.net_margin), BP_RATIO(ytd.net_margin), ly ? BP_RATIO(ly.net_margin) : '-']
        ];
        const incomeTable = this.table(
            [BP_L('项目', '項目', 'Item'), BP_L('本期', '本期', 'Current'), BP_L('年初至今', '年初至今', 'YTD'), BP_L('去年同期', '去年同期', 'Last Year')],
            incomeRows.map((r, i) => r.map((c, ci) => (ci === 0 && i === 9) ? `<b>${c}</b>` : (ci === 0 && i === 10 ? `<b>${c}</b>` : c)))
        );

        const balanceRows = [
            [BP_L('货币资金', '貨幣資金', 'Cash'), BP_MONEY(bal.cash), BP_MONEY(balPrev.cash)],
            [BP_L('银行存款', '銀行存款', 'Bank Deposits'), BP_MONEY(bal.deposit), BP_MONEY(balPrev.deposit)],
            [BP_L('应收账款', '應收帳款', 'AR'), BP_MONEY(bal.ar), BP_MONEY(balPrev.ar)],
            [BP_L('存货', '存貨', 'Inventory'), BP_MONEY(bal.inventory), BP_MONEY(balPrev.inventory)],
            [BP_L('流动资产合计', '流動資產合計', 'Current Assets'), BP_MONEY(bal.current_asset), BP_MONEY(balPrev.current_asset)],
            [BP_L('资产总计', '資產總計', 'Total Assets'), BP_MONEY(bal.total_asset), BP_MONEY(balPrev.total_asset)],
            [BP_L('应付账款', '應付帳款', 'AP'), BP_MONEY(bal.ap), BP_MONEY(balPrev.ap)],
            [BP_L('短期借款', '短期借款', 'Short-term Loan'), BP_MONEY(bal.short_loan), BP_MONEY(balPrev.short_loan)],
            [BP_L('长期借款', '長期借款', 'Long-term Loan'), BP_MONEY(bal.long_loan), BP_MONEY(balPrev.long_loan)],
            [BP_L('流动负债合计', '流動負債合計', 'Current Liabilities'), BP_MONEY(bal.current_liab), BP_MONEY(balPrev.current_liab)],
            [BP_L('负债合计', '負債合計', 'Total Liabilities'), BP_MONEY(bal.total_liab), BP_MONEY(balPrev.total_liab)],
            [BP_L('所有者权益', '所有者權益', 'Equity'), BP_MONEY(bal.equity), BP_MONEY(balPrev.equity)],
            [BP_L('资产负债率', '資產負債率', 'Debt Ratio'), BP_RATIO(bal.debt_ratio), BP_RATIO(balPrev.debt_ratio)],
            [BP_L('流动比率', '流動比率', 'Current Ratio'), BP_RATIO(bal.current_ratio, '倍'), BP_RATIO(balPrev.current_ratio, '倍')]
        ];
        const balanceTable = this.table(
            [BP_L('项目', '項目', 'Item'), BP_L('期末', '期末', 'End'), BP_L('上期', '上期', 'Previous')],
            balanceRows
        );

        const cfRows = [
            [BP_L('期初现金及存款', '期初現金及存款', 'Beginning Cash'), BP_MONEY(cf.begin)],
            [BP_L('经营活动现金流入', '經營活動現金流入', 'Operating Inflow'), BP_MONEY(cf.operation_in)],
            [BP_L('经营活动现金流出', '經營活動現金流出', 'Operating Outflow'), BP_MONEY(cf.operation_out)],
            [BP_L('经营活动净现金流', '經營活動淨現金流', 'Operating Net'), BP_MONEY(cf.operation_net)],
            [BP_L('投资活动净现金流', '投資活動淨現金流', 'Investing Net'), BP_MONEY(cf.invest_net)],
            [BP_L('筹资活动净现金流', '籌資活動淨現金流', 'Financing Net'), BP_MONEY(cf.finance_net)],
            [BP_L('本期现金净变动', '本期現金淨變動', 'Net Cash Change'), BP_MONEY(cf.net_change)],
            [BP_L('期末现金及存款', '期末現金及存款', 'Ending Cash'), BP_MONEY(cf.end)]
        ];
        const cfTable = this.table([BP_L('项目', '項目', 'Item'), BP_L('本期金额', '本期金額', 'Amount')], cfRows);

        const kpiHead = [BP_L('指标', '指標', 'KPI'), BP_L('本期', '本期', 'Current'), BP_L('同比 / 变动', '同比 / 變動', 'YoY / Change')];
        if (targets.length) kpiHead.push(BP_L('年度目标', '年度目標', 'Annual Target'));
        kpiHead.push(BP_L('单位', '單位', 'Unit'));
        const kpiRows = kpis.map(k => {
            const row = [k.label, k.value === null ? '-' : BP_RATIO(k.value, ''),
                k.yoy === null || k.yoy === undefined ? '-' : BP_RATIO(k.yoy)];
            if (targets.length) {
                const tg = targets.find(t => t.kpi_code === k.code);
                row.push(tg ? BP_RATIO(tg.target, '') : '-');
            }
            row.push(k.unit || '');
            return row;
        });

        const riskHtml = !risks.length
            ? `<div style="color:#16a34a;font-size:13px">✅ ${BP_L('本期未识别到重大财务风险', '本期未識別到重大財務風險', 'No major financial risks identified')}</div>`
            : `<div style="overflow-x:auto"><table class="data-table">
                <thead><tr><th style="width:70px">${BP_L('等级', '等級', 'Level')}</th><th style="width:70px">${BP_L('范畴', '範疇', 'Area')}</th><th style="width:150px">${BP_L('事项', '事項', 'Issue')}</th><th>${BP_L('说明', '說明', 'Detail')}</th></tr></thead>
                <tbody>${risks.map(r => {
                    const lv = BP_LEVEL(r.level);
                    return `<tr>
                        <td><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;color:${lv.color};background:${lv.bg}">${lv.text}</span></td>
                        <td>${BP_ESC(r.area)}</td><td>${BP_ESC(r.title)}</td><td style="text-align:left">${BP_ESC(r.detail)}</td>
                    </tr>`;
                }).join('')}</tbody></table></div>`;

        const eventHtml = !events.length
            ? `<div style="color:#64748b;font-size:13px">${BP_L('本期无重大事项', '本期無重大事項', 'No major events')}</div>`
            : `<ul style="margin:0;padding-left:20px;line-height:1.9;font-size:13px;color:#334155">
                ${events.slice(0, 10).map(e => {
                    const lv = BP_LEVEL(e.level);
                    return `<li><span style="color:${lv.color};font-weight:600">【${lv.text}】</span>${BP_ESC(e.title)}${e.bu_no ? `（${BP_ESC(e.bu_no)}）` : ''}：${BP_ESC(e.message || '')}</li>`;
                }).join('')}
            </ul>`;

        const buRows = (s.bu_compare || []).map(b => [
            `<b>${BP_ESC(b.bu_no)}</b>`, BP_MONEY(b.revenue), BP_MONEY(b.net_profit),
            BP_RATIO(b.gross_margin), BP_RATIO(b.net_margin), BP_RATIO(b.debt_ratio), BP_MONEY(b.cash)
        ]);
        const buHtml = buRows.length ? this.table([
            BP_L('公司', '公司', 'BU'), BP_L('营业收入', '營業收入', 'Revenue'), BP_L('净利润', '淨利潤', 'Net Profit'),
            BP_L('毛利率', '毛利率', 'Gross Margin'), BP_L('净利率', '淨利率', 'Net Margin'),
            BP_L('资产负债率', '資產負債率', 'Debt Ratio'), BP_L('现金及存款', '現金及存款', 'Cash')
        ], buRows) : '';

        document.getElementById('bpBody').innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:12px">
                <h2 style="margin:0;font-size:19px;color:#1e3a5f">📑 ${BP_ESC(BP_BU(pack.bu_no))} · ${BP_ESC(pack.period === 'quarter' ? pack.period_label + BP_L(' 季度', ' 季度', ' Quarterly') : pack.YYYY_MM + BP_L(' 月度', ' 月度', ' Monthly'))}</h2>
                <div style="font-size:12px;color:#94a3b8">${BP_L('生成时间：', '產生時間：', 'Generated: ')}${new Date(pack.generated_at).toLocaleString('zh-CN')}</div>
            </div>
            ${cards}
            ${this.section('📝 ' + BP_L('经营摘要', '經營摘要', 'Executive Summary'), summaryHtml)}
            ${this.section('📊 ' + BP_L('损益表', '損益表', 'Income Statement') + BP_L('（单位：元）', '（單位：元）', ' (CNY)'), incomeTable)}
            ${this.section('🏦 ' + BP_L('资产负债表', '資產負債表', 'Balance Sheet') + BP_L('（单位：元）', '（單位：元）', ' (CNY)'), balanceTable)}
            ${this.section('💵 ' + BP_L('现金流量表', '現金流量表', 'Cash Flow Statement') + BP_L('（单位：元）', '（單位：元）', ' (CNY)'), cfTable)}
            ${this.section('🎯 ' + BP_L('核心 KPI', '核心 KPI', 'Core KPIs'), this.table(kpiHead, kpiRows))}
            ${this.section('⚠️ ' + BP_L('风险预警', '風險預警', 'Risk Alerts'), riskHtml)}
            ${this.section('📌 ' + BP_L('重大事项', '重大事項', 'Major Events'), eventHtml)}
            ${buHtml ? this.section('🏢 ' + BP_L('各公司经营对比', '各公司經營對比', 'BU Comparison') + BP_L('（单位：元）', '（單位：元）', ' (CNY)'), buHtml) : ''}
        `;
    },

    async generate() {
        const p = this.params();
        try {
            await API.post('/api/board-pack/generate', p);
            UI.toast(BP_L('报告包已生成并留存', '報告包已產生並留存', 'Board pack generated'), 'success');
            await Promise.all([this.refresh(), this.loadHistory()]);
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async exportFile(kind) {
        const p = this.params();
        try {
            UI.toast(BP_L('正在生成文件…', '正在產生檔案…', 'Generating file…'));
            await API.download(`/api/board-pack/export/${kind}?${this.query(p)}`);
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async loadHistory() {
        const el = document.getElementById('bpHistory');
        if (!el) return;
        try {
            const res = await API.get('/api/board-pack/history?limit=20');
            const rows = res.data || [];
            if (!rows.length) {
                el.innerHTML = `<div style="color:#94a3b8;font-size:13px">${BP_L('尚无生成记录', '尚無產生記錄', 'No records yet')}</div>`;
                return;
            }
            el.innerHTML = `<div style="overflow-x:auto"><table class="data-table">
                <thead><tr><th>${BP_L('标题', '標題', 'Title')}</th><th style="width:90px">${BP_L('公司', '公司', 'BU')}</th>
                    <th style="width:100px">${BP_L('期间', '期間', 'Period')}</th><th style="width:160px">${BP_L('生成时间', '產生時間', 'Generated')}</th>
                    <th style="width:110px">${BP_L('操作者', '操作者', 'By')}</th><th style="width:200px">${BP_L('操作', '操作', 'Actions')}</th></tr></thead>
                <tbody>${rows.map(r => `<tr>
                    <td>${BP_ESC(r.title)}</td><td>${BP_ESC(BP_BU(r.bu_no))}</td>
                    <td>${BP_ESC(r.period_type === 'quarter' ? r.YYYY_MM + ' Q' + Math.ceil(Number(String(r.YYYY_MM).slice(5, 7)) / 3) : r.YYYY_MM)}</td>
                    <td>${new Date(r.created_at).toLocaleString('zh-CN')}</td>
                    <td>${BP_ESC(r.generated_by || '-')}</td>
                    <td style="text-align:left">
                        <button class="btn btn-ghost" style="padding:2px 8px;font-size:12px" onclick="BoardPackPage.openHistory(${r.uid})">${BP_L('打开', '開啟', 'Open')}</button>
                        <button class="btn btn-ghost" style="padding:2px 8px;font-size:12px" onclick="BoardPackPage.deleteHistory(${r.uid})">${BP_L('删除', '刪除', 'Delete')}</button>
                    </td>
                </tr>`).join('')}</tbody></table></div>`;
        } catch (e) {
            el.innerHTML = `<div style="color:#dc2626;font-size:13px">${BP_ESC(e.message)}</div>`;
        }
    },

    async openHistory(uid) {
        try {
            const res = await API.get(`/api/board-pack/history/${uid}`);
            const rec = res.data.record;
            this.bu = rec.bu_no; this.ym = rec.YYYY_MM; this.period = rec.period_type;
            const buEl = document.getElementById('bpBu'), ymEl = document.getElementById('bpMonth'), pEl = document.getElementById('bpPeriod');
            if (buEl) buEl.value = rec.bu_no;
            if (ymEl) ymEl.value = rec.YYYY_MM;
            if (pEl) pEl.value = rec.period_type;
            this.pack = res.data.pack;
            this.render(this.pack);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async deleteHistory(uid) {
        if (!confirm(BP_L('确定删除该生成记录？', '確定刪除該產生記錄？', 'Delete this record?'))) return;
        try {
            await API.del(`/api/board-pack/history/${uid}`);
            UI.toast(BP_L('已删除', '已刪除', 'Deleted'), 'success');
            this.loadHistory();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};

registerPage('boardPack', async (c) => {
    await BoardPackPage.load();
});
