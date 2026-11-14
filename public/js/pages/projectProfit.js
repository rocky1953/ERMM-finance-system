/**
 * 项目损益（COO-02）
 * 项目组合概览 · 单项目月度损益 · 年度预算 · 成本归集 · 收入确认（含出货自动引入）
 */
const PP_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] || zh);
const PP_ESC = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const PP_MONEY = (v) => (v === null || v === undefined || isNaN(v)) ? '-'
    : Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PP_RATIO = (v, unit = '%') => (v === null || v === undefined || isNaN(v)) ? '-'
    : Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + unit;

const PP_COST_TYPES = [
    { v: 'MATERIAL', zh: '材料', tw: '材料', en: 'Material' },
    { v: 'LABOR', zh: '人工', tw: '人工', en: 'Labor' },
    { v: 'OUTSOURCE', zh: '委外', tw: '委外', en: 'Outsourcing' },
    { v: 'TRAVEL', zh: '差旅', tw: '差旅', en: 'Travel' },
    { v: 'OTHER', zh: '其他', tw: '其他', en: 'Other' }
];
const ppCostType = (v) => {
    const t = PP_COST_TYPES.find(x => x.v === v);
    return t ? PP_L(t.zh, t.tw, t.en) : (v || '-');
};
const PP_STATUS = {
    idle: { zh: '无数据', tw: '無資料', en: 'No data', color: '#94a3b8' },
    active: { zh: '进行中', tw: '進行中', en: 'In progress', color: '#2563eb' },
    over: { zh: '成本超预算', tw: '成本超預算', en: 'Over budget', color: '#dc2626' },
    done: { zh: '收入已达标', tw: '收入已達標', en: 'Target reached', color: '#16a34a' }
};

const ProjectProfitPage = {
    bu: State.bu_no || 'GROUP',
    ym: State.YYYY_MM,
    tab: 'overview',
    year: String(State.YYYY_MM || new Date().getFullYear()).slice(0, 4),
    projects: [],
    overview: null,
    detailProject: '',

    tabs: [
        { k: 'overview', zh: '项目概览', tw: '專案概覽', en: 'Overview', color: '#2563eb', tint: '#eff6ff' },
        { k: 'detail', zh: '项目损益', tw: '專案損益', en: 'Project P&L', color: '#0891b2', tint: '#ecfeff' },
        { k: 'budget', zh: '年度预算', tw: '年度預算', en: 'Budget', color: '#d97706', tint: '#fffbeb' },
        { k: 'cost', zh: '成本归集', tw: '成本歸集', en: 'Costs', color: '#7c3aed', tint: '#f5f3ff' },
        { k: 'revenue', zh: '收入确认', tw: '收入確認', en: 'Revenue', color: '#16a34a', tint: '#f0fdf4' }
    ],

    async load() {
        if (!Auth.isLoggedIn()) { Auth.showLogin(); return; }
        if (!Auth.canAccess('projectProfit')) {
            document.getElementById('pageContent').innerHTML = UI.empty('🔒', PP_L('无权限访问该模块', '無權限存取該模組', 'No permission to access this module'));
            return;
        }
        // LTN 为虚拟公司，本页不参与展示与录入
        if (this.bu === 'LTN') this.bu = 'GROUP';
        const page = document.getElementById('pageContent');
        const buHtml = await CodeHelper.buSel({
            includeAll: true, allValue: 'GROUP',
            allLabel: PP_L('全部公司', '全部公司', 'All BUs'),
            selected: this.bu
        });
        try {
            const res = await API.get('/api/project-profit/projects');
            this.projects = res.data || [];
        } catch (e) { this.projects = []; }

        page.innerHTML = `
            <div class="page-header">
                <div id="ppTabs" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${this.tabHtml()}</div>
                <div class="page-actions">
                    <select id="ppBu" class="form-input" style="width:110px" onchange="ProjectProfitPage.setBu(this.value)">${buHtml}</select>
                    <input type="month" id="ppMonth" class="form-input" style="width:150px" onchange="ProjectProfitPage.setMonth(this.value)">
                    <button class="btn btn-ghost" style="color:#0369a1;border-color:#bae6fd;background:#f0f9ff" onclick="ProjectProfitPage.showManual()">📖 ${PP_L('操作说明', '操作說明', 'Guide')}</button>
                    <button class="btn btn-ghost" onclick="ProjectProfitPage.loadCurrent()">🔄 ${PP_L('刷新', '重新整理', 'Refresh')}</button>
                </div>
            </div>
            <div id="ppBody"><div style="padding:40px;text-align:center;color:#999">⏳</div></div>
        `;
        const buSel = document.getElementById('ppBu');
        Array.from(buSel.options).filter(o => o.value === 'LTN').forEach(o => o.remove());
        buSel.value = this.bu;
        document.getElementById('ppMonth').value = this.ym;
        await this.loadCurrent();
    },

    switchTab(t) {
        this.tab = t;
        const bar = document.getElementById('ppTabs');
        if (bar) bar.innerHTML = this.tabHtml();
        this.loadCurrent();
    },

    /** 页签按钮：每个功能使用独立颜色，选中为实色、未选中为浅底 */
    tabHtml() {
        return this.tabs.map(t => {
            const active = this.tab === t.k;
            return `<div onclick="ProjectProfitPage.switchTab('${t.k}')" style="padding:7px 16px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;user-select:none;transition:all .15s;border:1px solid ${active ? t.color : t.color + '66'};background:${active ? t.color : t.tint};color:${active ? '#fff' : t.color};box-shadow:${active ? '0 2px 8px ' + t.color + '40' : 'none'}">${PP_L(t.zh, t.tw, t.en)}</div>`;
        }).join('');
    },

    /** 操作说明：弹窗内嵌完整操作手册 */
    showManual() {
        UI.modal(
            PP_L('项目损益 · 操作说明', '專案損益 · 操作說明', 'Project P&L · Guide'),
            `<iframe src="/docs/project-profit-manual.html?v=20261114" style="width:100%;height:68vh;border:1px solid #e2e8f0;border-radius:8px;background:#fff;display:block"></iframe>`,
            `<button class="btn btn-primary" onclick="UI.closeModal()">${PP_L('关闭', '關閉', 'Close')}</button>`
        );
    },

    // 本页支持「全部公司」，但不回写全局 State.bu_no，避免影响其他模块
    setBu(v) { this.bu = v || 'GROUP'; this.loadCurrent(); },
    setMonth(v) {
        this.ym = v;
        this.year = String(v).slice(0, 4);
        this.loadCurrent();
    },

    projectOptions(selected, includeAll) {
        const opts = this.projects.map(p =>
            `<option value="${PP_ESC(p.project_id)}" ${p.project_id === selected ? 'selected' : ''}>${PP_ESC(p.project_id)} · ${PP_ESC(p.project_name)}</option>`
        ).join('');
        return includeAll ? `<option value="">${PP_L('全部项目', '全部專案', 'All projects')}</option>${opts}` : opts;
    },

    typeOptions(selected) {
        return PP_COST_TYPES.map(t =>
            `<option value="${t.v}" ${t.v === selected ? 'selected' : ''}>${PP_L(t.zh, t.tw, t.en)}</option>`
        ).join('');
    },

    /** 具体公司别下拉（用于手工录入/预算，不含「全部公司」） */
    buOptions(selected) {
        const sel = document.getElementById('ppBu');
        if (!sel) return '';
        return Array.from(sel.options)
            .filter(o => o.value && o.value !== 'GROUP')
            .map(o => `<option value="${PP_ESC(o.value)}" ${o.value === selected ? 'selected' : ''}>${PP_ESC(o.textContent)}</option>`)
            .join('');
    },

    defaultBu() {
        if (this.bu && this.bu !== 'GROUP') return this.bu;
        return (State.bu_no && State.bu_no !== 'GROUP') ? State.bu_no : '';
    },

    card(label, value, sub, color) {
        return `<div style="flex:1;min-width:160px;border:1px solid #e2e8f0;border-left:4px solid ${color};border-radius:8px;padding:12px;background:#fff">
            <div style="font-size:12px;color:#64748b">${label}</div>
            <div style="font-size:18px;font-weight:700;margin:4px 0;color:${color}">${value}</div>
            <div style="font-size:11px;color:#94a3b8">${sub || ''}</div>
        </div>`;
    },

    table(head, rows) {
        return `<div style="overflow-x:auto"><table class="data-table">
            <thead><tr>${head.map((h, i) => `<th style="${i === 0 ? '' : 'text-align:right;'}">${h}</th>`).join('')}</tr></thead>
            <tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td style="${i === 0 ? '' : 'text-align:right;'}">${c}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>`;
    },

    async loadCurrent() {
        const el = document.getElementById('ppBody');
        if (!el) return;
        el.innerHTML = `<div style="padding:40px;text-align:center;color:#999">⏳</div>`;
        try {
            if (this.tab === 'overview') await this.loadOverview();
            else if (this.tab === 'detail') await this.loadDetail();
            else if (this.tab === 'budget') await this.loadBudget();
            else if (this.tab === 'cost') await this.loadCost();
            else await this.loadRevenue();
        } catch (e) {
            el.innerHTML = `<div class="card" style="color:#dc2626">${PP_ESC(e.message)}</div>`;
        }
    },

    // ===== 概览 =====
    async loadOverview() {
        const res = await API.get(`/api/project-profit/overview?bu_no=${encodeURIComponent(this.bu || 'GROUP')}&YYYY_MM=${encodeURIComponent(this.ym || '')}`);
        this.overview = res.data;
        const d = this.overview, t = d.totals, c = d.counts;
        const marginSub = t.cost_missing
            ? `<span style="color:#d97706">${PP_L('成本未归集', '成本未歸集', 'Cost not collected')}</span>`
            : PP_L('毛利率 ', '毛利率 ', 'Margin ') + PP_RATIO(t.margin_ytd);
        const costWarn = t.cost_missing
            ? `<div class="card" style="border-left:4px solid #d97706;color:#92400e;margin-bottom:12px;font-size:13px">
                ⚠ ${PP_L('收入已确认但成本尚未归集，毛利率暂不可用；可在「成本归集」执行从出货自动引入。', '收入已確認但成本尚未歸集，毛利率暫不可用；可在「成本歸集」執行從出貨自動引入。', 'Revenue recognized but no cost collected — margin unavailable. Use "Auto-import cost from shipments" in Costs.')}
            </div>` : '';
        const cov = d.coverage || {};
        const covMonths = (cov.months || []).join('、');
        let covTip = '';
        if (!t.cost_missing && (cov.revenue_without_cost || []).length) {
            covTip = `<div class="card" style="border-left:4px solid #d97706;color:#92400e;margin-bottom:12px;font-size:13px">
                ⚠ ${PP_L(`以下月份仅有收入、未归集成本：${cov.revenue_without_cost.join('、')}，对应月份毛利率不可用。`, `以下月份僅有收入、未歸集成本：${cov.revenue_without_cost.join('、')}，對應月份毛利率不可用。`, `Cost missing for months with revenue: ${cov.revenue_without_cost.join(', ')}.`)}
            </div>`;
        } else if (!t.cost_missing && cov.incomplete && covMonths) {
            covTip = `<div class="card" style="border-left:4px solid #94a3b8;color:#475569;margin-bottom:12px;font-size:13px">
                ℹ ${PP_L(`数据覆盖：${covMonths}（共 ${cov.months.length} 个月），YTD 指标为已归集月份合计。`, `資料覆蓋：${covMonths}（共 ${cov.months.length} 個月），YTD 指標為已歸集月份合計。`, `Data coverage: ${covMonths} (${cov.months.length} months); YTD reflects collected months only.`)}
            </div>`;
        }
        const cards = `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
            ${this.card(PP_L('年度收入预算', '年度收入預算', 'Revenue Budget'), PP_MONEY(t.revenue_budget), PP_L('达成 ', '達成 ', 'Achieved ') + PP_RATIO(t.rev_usage), '#2563eb')}
            ${this.card(PP_L('年度成本预算', '年度成本預算', 'Cost Budget'), PP_MONEY(t.cost_budget), PP_L('使用 ', '使用 ', 'Used ') + PP_RATIO(t.cost_usage), '#d97706')}
            ${this.card(PP_L('年初至今收入', '年初至今收入', 'YTD Revenue'), PP_MONEY(t.revenue_ytd), PP_L('本月 ', '本月 ', 'This month ') + PP_MONEY(t.revenue_month), '#0891b2')}
            ${this.card(PP_L('年初至今成本', '年初至今成本', 'YTD Cost'), PP_MONEY(t.cost_ytd), PP_L('本月 ', '本月 ', 'This month ') + PP_MONEY(t.cost_month), '#7c3aed')}
            ${this.card(PP_L('年初至今毛利', '年初至今毛利', 'YTD Profit'), t.cost_missing ? '—' : PP_MONEY(t.profit_ytd), marginSub, t.cost_missing ? '#94a3b8' : (Number(t.profit_ytd) < 0 ? '#dc2626' : '#16a34a'))}
            ${this.card(PP_L('超预算项目', '超預算專案', 'Over Budget'), String(c.over_budget), PP_L('项目总数 ', '專案總數 ', 'Total ') + c.total + (c.no_budget ? PP_L(' · 无预算 ', ' · 無預算 ', ' · No budget ') + c.no_budget : ''), c.over_budget ? '#dc2626' : '#16a34a')}
        </div>`;

        const rows = d.rows.map(r => {
            const st = PP_STATUS[r.status] || PP_STATUS.idle;
            return [
                `<b>${PP_ESC(r.project_id)}</b><div style="font-size:11px;color:#94a3b8">${PP_ESC(r.project_name)}</div>`,
                `<div style="text-align:left">${PP_ESC(r.customer_name || '-')}</div>`,
                PP_MONEY(r.revenue_budget), PP_MONEY(r.revenue_ytd), PP_RATIO(r.rev_usage),
                PP_MONEY(r.cost_budget), PP_MONEY(r.cost_ytd), PP_RATIO(r.cost_usage),
                PP_MONEY(r.revenue_month), PP_MONEY(r.cost_month),
                r.cost_missing
                    ? '<span style="color:#94a3b8">—</span>'
                    : `<span style="color:${Number(r.profit_ytd) < 0 ? '#dc2626' : '#16a34a'}">${PP_MONEY(r.profit_ytd)}</span>`,
                r.cost_missing
                    ? `<span style="color:#d97706">${PP_L('未归集', '未歸集', 'Not collected')}</span>`
                    : PP_RATIO(r.margin_ytd),
                `<span style="color:${st.color}">${PP_L(st.zh, st.tw, st.en)}</span>`,
                `<button class="btn btn-ghost" style="padding:2px 8px;font-size:12px" onclick="ProjectProfitPage.openDetail('${PP_ESC(r.project_id)}')">${PP_L('明细', '明細', 'Detail')}</button>`
            ];
        });
        document.getElementById('ppBody').innerHTML = costWarn + covTip + cards + (rows.length ? this.table([
            PP_L('项目', '專案', 'Project'), PP_L('客户', '客戶', 'Customer'),
            PP_L('年收入预算', '年收入預算', 'Rev. Budget'), PP_L('YTD 收入', 'YTD 收入', 'YTD Rev.'), PP_L('收入达成', '收入達成', 'Rev. %'),
            PP_L('年成本预算', '年成本預算', 'Cost Budget'), PP_L('YTD 成本', 'YTD 成本', 'YTD Cost'), PP_L('成本使用', '成本使用', 'Cost %'),
            PP_L('本月收入', '本月收入', 'Rev. (M)'), PP_L('本月成本', '本月成本', 'Cost (M)'),
            PP_L('YTD 毛利', 'YTD 毛利', 'YTD Profit'), PP_L('毛利率', '毛利率', 'Margin'),
            PP_L('状态', '狀態', 'Status'), PP_L('操作', '操作', 'Actions')
        ], rows) : UI.empty('📋', PP_L('该年度暂无项目预算或收支数据', '該年度暫無專案預算或收支資料', 'No project budget or actuals for this year')));
    },

    openDetail(projectId) {
        this.detailProject = projectId;
        this.switchTab('detail');
    },

    // ===== 项目损益明细 =====
    async loadDetail() {
        const body = document.getElementById('ppBody');
        const pid = this.detailProject || (this.overview && this.overview.rows[0] && this.overview.rows[0].project_id) || (this.projects[0] && this.projects[0].project_id) || '';
        this.detailProject = pid;
        body.innerHTML = `
            <div class="card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
                <select id="ppDetailProj" class="form-input" style="width:320px" onchange="ProjectProfitPage.detailProject=this.value;ProjectProfitPage.loadDetail()">
                    ${this.projectOptions(pid, false)}
                </select>
                <input type="number" id="ppDetailYear" class="form-input" style="width:110px" value="${this.year}" onchange="ProjectProfitPage.year=this.value;ProjectProfitPage.loadDetail()">
                <span style="font-size:12px;color:#94a3b8">${PP_L('按自然年查看 12 个月损益', '按自然年查看 12 個月損益', '12-month P&L by calendar year')}</span>
            </div>
            <div id="ppDetailBody"><div style="padding:30px;text-align:center;color:#999">⏳</div></div>
        `;
        if (!pid) {
            document.getElementById('ppDetailBody').innerHTML = UI.empty('📋', PP_L('暂无项目主档', '暫無專案主檔', 'No project master data'));
            return;
        }
        const res = await API.get(`/api/project-profit/detail?project_id=${encodeURIComponent(pid)}&year=${encodeURIComponent(this.year)}&bu_no=${encodeURIComponent(this.bu || 'GROUP')}`);
        const d = res.data, t = d.totals, b = d.budget;
        const cards = `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
            ${this.card(PP_L('项目收入', '專案收入', 'Revenue'), PP_MONEY(t.revenue), PP_L('预算 ', '預算 ', 'Budget ') + PP_MONEY(b.revenue_budget), '#2563eb')}
            ${this.card(PP_L('项目成本', '專案成本', 'Cost'), PP_MONEY(t.cost), PP_L('预算 ', '預算 ', 'Budget ') + PP_MONEY(b.cost_budget), '#d97706')}
            ${this.card(PP_L('项目毛利', '專案毛利', 'Profit'), t.cost_missing ? '—' : PP_MONEY(t.profit), t.cost_missing
                ? `<span style="color:#d97706">${PP_L('成本未归集', '成本未歸集', 'Cost not collected')}</span>`
                : PP_L('毛利率 ', '毛利率 ', 'Margin ') + PP_RATIO(t.margin), t.cost_missing ? '#94a3b8' : (Number(t.profit) < 0 ? '#dc2626' : '#16a34a'))}
            ${this.card(PP_L('收入达成', '收入達成', 'Rev. Achieved'), PP_RATIO(t.rev_usage), '', '#0891b2')}
            ${this.card(PP_L('成本使用', '成本使用', 'Cost Used'), PP_RATIO(t.cost_usage), '', '#7c3aed')}
        </div>`;
        const rows = d.months.map(m => {
            if (m.future) {
                return [m.YYYY_MM, '—', '—', '—', '—', '—', '—', '—'];
            }
            return [
                m.YYYY_MM, PP_MONEY(m.revenue), PP_MONEY(m.cost),
                m.cost_missing
                    ? '—'
                    : `<span style="color:${Number(m.profit) < 0 ? '#dc2626' : '#16a34a'}">${PP_MONEY(m.profit)}</span>`,
                m.cost_missing
                    ? `<span style="color:#d97706">${PP_L('未归集', '未歸集', 'Not collected')}</span>`
                    : PP_RATIO(m.margin),
                PP_MONEY(m.cum_revenue), PP_MONEY(m.cum_cost),
                m.cost_missing ? '—' : PP_MONEY(m.cum_profit)
            ];
        });
        const scopeLabel = d.bu_no === 'GROUP' ? PP_L('全部公司', '全部公司', 'All BUs') : d.bu_no;
        document.getElementById('ppDetailBody').innerHTML = `
            <div style="font-size:13px;color:#475569;margin-bottom:10px">${PP_ESC(d.project_name)} · ${PP_ESC(d.customer_name || '-')} · ${d.year} · ${PP_ESC(scopeLabel)}</div>
            ${cards}${this.table([
                PP_L('月份', '月份', 'Month'), PP_L('收入', '收入', 'Revenue'), PP_L('成本', '成本', 'Cost'),
                PP_L('毛利', '毛利', 'Profit'), PP_L('毛利率', '毛利率', 'Margin'),
                PP_L('累计收入', '累計收入', 'Cum. Revenue'), PP_L('累计成本', '累計成本', 'Cum. Cost'), PP_L('累计毛利', '累計毛利', 'Cum. Profit')
            ], rows)}`;
    },

    // ===== 预算 =====
    async loadBudget() {
        const res = await API.get(`/api/project-profit/budgets?year=${encodeURIComponent(this.year)}&bu_no=${encodeURIComponent(this.bu || 'GROUP')}`);
        this._budgetMap = {};
        const rows = (res.data || []).map(r => {
            this._budgetMap[r.uid] = r;
            return [
                PP_ESC(r.bu_no || '-'),
                `<b>${PP_ESC(r.project_id)}</b><div style="font-size:11px;color:#94a3b8">${PP_ESC(r.project_name)}</div>`,
                PP_ESC(r.customer_name || '-'),
                PP_MONEY(r.revenue_budget), PP_MONEY(r.cost_budget),
                PP_ESC(r.update_by || '-'),
                `<button class="btn btn-ghost" style="padding:2px 8px;font-size:12px" onclick="ProjectProfitPage.budgetModal(${r.uid})">${PP_L('编辑', '編輯', 'Edit')}</button>
                 <button class="btn btn-ghost" style="padding:2px 8px;font-size:12px" onclick="ProjectProfitPage.deleteBudget(${r.uid})">${PP_L('删除', '刪除', 'Delete')}</button>`
            ];
        });
        document.getElementById('ppBody').innerHTML = `
            <div class="card" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
                <input type="number" id="ppBudgetYear" class="form-input" style="width:110px" value="${this.year}" onchange="ProjectProfitPage.year=this.value;ProjectProfitPage.loadBudget()">
                <button class="btn btn-primary" onclick="ProjectProfitPage.budgetModal()">➕ ${PP_L('新增/维护预算', '新增/維護預算', 'Add Budget')}</button>
                <span style="font-size:12px;color:#94a3b8">${PP_L('同一公司别下同一项目同一年度仅保留一条预算，重复保存即覆盖', '同一公司別下同一專案同一年度僅保留一條預算，重複儲存即覆蓋', 'One budget per BU per project per year; saving again overwrites')}</span>
            </div>
            <div id="ppBudgetBody">${rows.length ? this.table([
                PP_L('公司别', '公司別', 'BU'), PP_L('项目', '專案', 'Project'), PP_L('客户', '客戶', 'Customer'),
                PP_L('年度收入预算', '年度收入預算', 'Revenue Budget'), PP_L('年度成本预算', '年度成本預算', 'Cost Budget'),
                PP_L('维护人', '維護人', 'Updated By'), PP_L('操作', '操作', 'Actions')
            ], rows) : UI.empty('📋', PP_L('该年度尚无预算', '該年度尚無預算', 'No budget for this year'))}</div>`;
    },

    budgetModal(uid) {
        const rec = (uid && this._budgetMap && this._budgetMap[uid]) || null;
        const projectId = rec ? rec.project_id : '';
        UI.modal(
            rec ? PP_L('编辑项目预算', '編輯專案預算', 'Edit Project Budget') : PP_L('新增项目预算', '新增專案預算', 'New Project Budget'),
            `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                <label>${PP_L('公司别', '公司別', 'BU')}<select id="ppbBu" class="form-input" ${rec ? 'disabled' : ''}>${this.buOptions(rec ? rec.bu_no : this.defaultBu())}</select></label>
                <label>${PP_L('项目', '專案', 'Project')}<select id="ppbProj" class="form-input" ${rec ? 'disabled' : ''}>${this.projectOptions(projectId, false)}</select></label>
                <label>${PP_L('年度', '年度', 'Year')}<input type="number" id="ppbYear" class="form-input" value="${rec ? rec.year : this.year}" ${rec ? 'disabled' : ''}></label>
                <label>${PP_L('年度收入预算', '年度收入預算', 'Revenue Budget')}<input type="number" id="ppbRev" class="form-input" value="${rec ? rec.revenue_budget : 0}"></label>
                <label>${PP_L('年度成本预算', '年度成本預算', 'Cost Budget')}<input type="number" id="ppbCost" class="form-input" value="${rec ? rec.cost_budget : 0}"></label>
            </div>`,
            `<button class="btn btn-ghost" onclick="UI.closeModal()">${PP_L('取消', '取消', 'Cancel')}</button>
             <button class="btn btn-primary" onclick="ProjectProfitPage.saveBudget()">${PP_L('保存', '儲存', 'Save')}</button>`
        );
    },

    async saveBudget() {
        const pidEl = document.getElementById('ppbProj');
        const yEl = document.getElementById('ppbYear');
        const data = {
            bu_no: document.getElementById('ppbBu').value,
            project_id: pidEl.value,
            year: Number(yEl.value),
            revenue_budget: Number(document.getElementById('ppbRev').value) || 0,
            cost_budget: Number(document.getElementById('ppbCost').value) || 0
        };
        if (!data.project_id) return UI.toast(PP_L('请选择项目', '請選擇專案', 'Select a project'), 'error');
        try {
            await API.post('/api/project-profit/budgets', data);
            UI.closeModal();
            UI.toast(PP_L('预算已保存', '預算已儲存', 'Budget saved'), 'success');
            this.applySavedScope(data.bu_no, { year: data.year });
            this.loadBudget();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async deleteBudget(uid) {
        if (!confirm(PP_L('确定删除该预算？', '確定刪除該預算？', 'Delete this budget?'))) return;
        try {
            await API.del(`/api/project-profit/budgets/${uid}`);
            UI.toast(PP_L('已删除', '已刪除', 'Deleted'), 'success');
            this.loadBudget();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ===== 成本归集 =====
    async loadCost() {
        const from = document.getElementById('ppCostFrom') ? document.getElementById('ppCostFrom').value : `${this.year}-01`;
        const to = document.getElementById('ppCostTo') ? document.getElementById('ppCostTo').value : `${this.year}-12`;
        const pid = document.getElementById('ppCostProj') ? document.getElementById('ppCostProj').value : '';
        const q = `bu_no=${encodeURIComponent(this.bu === 'GROUP' ? '' : (this.bu || ''))}&project_id=${encodeURIComponent(pid)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
        const res = await API.get(`/api/project-profit/costs?${q}`);
        const rows = (res.data || []).map(r => [
            r.YYYY_MM, PP_ESC(r.bu_no || '-'),
            `<b>${PP_ESC(r.project_id)}</b><div style="font-size:11px;color:#94a3b8">${PP_ESC(r.project_name)}</div>`,
            ppCostType(r.cost_type), PP_MONEY(r.amount),
            r.ref_no === 'COST-SYNC'
                ? `<span style="color:#0891b2">${PP_L('出货自动', '出貨自動', 'Auto')}</span>`
                : `<span style="color:#475569">${PP_L('手工归集', '手工歸集', 'Manual')}</span>`,
            PP_ESC(r.ref_no || '-'), PP_ESC(r.remark || '-'),
            PP_ESC(r.created_by === 'system' ? PP_L('系统', '系統', 'System') : (r.created_by || '-')),
            `<button class="btn btn-ghost" style="padding:2px 8px;font-size:12px" onclick="ProjectProfitPage.deleteCost(${r.uid})">${PP_L('删除', '刪除', 'Delete')}</button>`
        ]);
        document.getElementById('ppBody').innerHTML = `
            <div class="card" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
                <select id="ppCostProj" class="form-input" style="width:260px">${this.projectOptions(pid, true)}</select>
                <input type="month" id="ppCostFrom" class="form-input" style="width:150px" value="${from}">
                <input type="month" id="ppCostTo" class="form-input" style="width:150px" value="${to}">
                <button class="btn btn-ghost" onclick="ProjectProfitPage.year=document.getElementById('ppCostFrom').value.slice(0,4);ProjectProfitPage.loadCost()">🔍 ${PP_L('查询', '查詢', 'Search')}</button>
                <button class="btn btn-primary" onclick="ProjectProfitPage.costModal()">➕ ${PP_L('归集成本', '歸集成本', 'Add Cost')}</button>
                <button class="btn btn-ghost" onclick="ProjectProfitPage.syncCost()">⬇ ${PP_L('从出货自动引入当月成本', '從出貨自動引入當月成本', 'Auto-import cost from shipments')}</button>
            </div>
            <div id="ppCostBody">${rows.length ? this.table([
                PP_L('月份', '月份', 'Month'), PP_L('公司别', '公司別', 'BU'), PP_L('项目', '專案', 'Project'), PP_L('成本类型', '成本類型', 'Type'),
                PP_L('金额', '金額', 'Amount'), PP_L('来源', '來源', 'Source'), PP_L('单据号', '單據號', 'Ref.'), PP_L('备注', '備註', 'Remark'),
                PP_L('录入人', '錄入人', 'By'), PP_L('操作', '操作', 'Actions')
            ], rows) : UI.empty('📋', PP_L('查询区间内无成本记录', '查詢區間內無成本記錄', 'No cost records in range'))}</div>`;
    },

    costModal() {
        const fromEl = document.getElementById('ppCostFrom');
        const ym = (fromEl && fromEl.value) || this.ym || `${this.year}-01`;
        UI.modal(
            PP_L('归集项目成本', '歸集專案成本', 'Collect Project Cost'),
            `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                <label>${PP_L('公司别', '公司別', 'BU')}<select id="ppcBu" class="form-input">${this.buOptions(this.defaultBu())}</select></label>
                <label>${PP_L('项目', '專案', 'Project')}<select id="ppcProj" class="form-input">${this.projectOptions(this.detailProject, false)}</select></label>
                <label>${PP_L('归属月份', '歸屬月份', 'Month')}<input type="month" id="ppcYm" class="form-input" value="${ym}"></label>
                <label>${PP_L('成本类型', '成本類型', 'Cost Type')}<select id="ppcType" class="form-input">${this.typeOptions('MATERIAL')}</select></label>
                <label>${PP_L('金额', '金額', 'Amount')}<input type="number" id="ppcAmt" class="form-input" value="0"></label>
                <label>${PP_L('单据号', '單據號', 'Ref. No.')}<input id="ppcRef" class="form-input" placeholder="${PP_L('可选', '可選', 'Optional')}"></label>
                <label>${PP_L('备注', '備註', 'Remark')}<input id="ppcRemark" class="form-input"></label>
            </div>`,
            `<button class="btn btn-ghost" onclick="UI.closeModal()">${PP_L('取消', '取消', 'Cancel')}</button>
             <button class="btn btn-primary" onclick="ProjectProfitPage.saveCost()">${PP_L('保存', '儲存', 'Save')}</button>`
        );
    },

    async saveCost() {
        const data = {
            bu_no: document.getElementById('ppcBu').value,
            project_id: document.getElementById('ppcProj').value,
            YYYY_MM: document.getElementById('ppcYm').value,
            cost_type: document.getElementById('ppcType').value,
            amount: Number(document.getElementById('ppcAmt').value) || 0,
            ref_no: document.getElementById('ppcRef').value,
            remark: document.getElementById('ppcRemark').value
        };
        try {
            await API.post('/api/project-profit/costs', data);
            UI.closeModal();
            UI.toast(PP_L('成本已归集', '成本已歸集', 'Cost recorded'), 'success');
            this.applySavedScope(data.bu_no, { fromId: 'ppCostFrom', toId: 'ppCostTo', ym: data.YYYY_MM });
            this.loadCost();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async deleteCost(uid) {
        if (!confirm(PP_L('确定删除该成本记录？', '確定刪除該成本記錄？', 'Delete this cost record?'))) return;
        try {
            await API.del(`/api/project-profit/costs/${uid}`);
            UI.toast(PP_L('已删除', '已刪除', 'Deleted'), 'success');
            this.loadCost();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    /** 同步后把查询区间扩到包含目标月份，确保新数据可见 */
    expandRange(fromId, toId, ym) {
        const f = document.getElementById(fromId), t = document.getElementById(toId);
        if (f && f.value && ym < f.value) f.value = ym;
        if (t && t.value && ym > t.value) t.value = ym;
    },

    /** 保存后确保新记录在当前筛选条件下可见 */
    applySavedScope(buNo, opt = {}) {
        if (buNo && buNo !== 'GROUP' && this.bu !== 'GROUP' && buNo !== this.bu) {
            this.bu = buNo;
            const sel = document.getElementById('ppBu');
            if (sel) sel.value = buNo;
        }
        if (opt.ym && opt.fromId && opt.toId) this.expandRange(opt.fromId, opt.toId, opt.ym);
        if (opt.year && Number(opt.year) !== Number(this.year)) {
            this.year = Number(opt.year);
            const yEl = document.getElementById('ppBudgetYear');
            if (yEl) yEl.value = this.year;
        }
    },

    async syncCost() {
        const ym = this.ym;
        if (!ym) return UI.toast(PP_L('请选择月份', '請選擇月份', 'Select a month'), 'error');
        if (!confirm(PP_L(`将按出货成本重新生成 ${ym} 的「自动引入」项目成本记录，是否继续？`, `將按出貨成本重新產生 ${ym} 的「自動引入」專案成本記錄，是否繼續？`, `Regenerate auto-imported cost for ${ym}?`))) return;
        try {
            const res = await API.post('/api/project-profit/costs/sync', { bu_no: this.bu, YYYY_MM: ym });
            UI.toast(res.message || PP_L('已同步', '已同步', 'Synced'), 'success');
            this.expandRange('ppCostFrom', 'ppCostTo', ym);
            this.loadCost();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ===== 收入确认 =====
    async loadRevenue() {
        const from = document.getElementById('ppRevFrom') ? document.getElementById('ppRevFrom').value : `${this.year}-01`;
        const to = document.getElementById('ppRevTo') ? document.getElementById('ppRevTo').value : `${this.year}-12`;
        const pid = document.getElementById('ppRevProj') ? document.getElementById('ppRevProj').value : '';
        const q = `bu_no=${encodeURIComponent(this.bu === 'GROUP' ? '' : (this.bu || ''))}&project_id=${encodeURIComponent(pid)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
        const res = await API.get(`/api/project-profit/revenues?${q}`);
        const rows = (res.data || []).map(r => [
            r.YYYY_MM, PP_ESC(r.bu_no || '-'),
            `<b>${PP_ESC(r.project_id)}</b><div style="font-size:11px;color:#94a3b8">${PP_ESC(r.project_name)}</div>`,
            PP_MONEY(r.revenue_amt),
            r.confirm_type === 'auto'
                ? `<span style="color:#0891b2">${PP_L('出货自动', '出貨自動', 'Auto')}</span>`
                : `<span style="color:#475569">${PP_L('手工确认', '手工確認', 'Manual')}</span>`,
            PP_ESC(r.ref_no || '-'), PP_ESC(r.remark || '-'),
            `<button class="btn btn-ghost" style="padding:2px 8px;font-size:12px" onclick="ProjectProfitPage.deleteRevenue(${r.uid})">${PP_L('删除', '刪除', 'Delete')}</button>`
        ]);
        document.getElementById('ppBody').innerHTML = `
            <div class="card" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
                <select id="ppRevProj" class="form-input" style="width:260px">${this.projectOptions(pid, true)}</select>
                <input type="month" id="ppRevFrom" class="form-input" style="width:150px" value="${from}">
                <input type="month" id="ppRevTo" class="form-input" style="width:150px" value="${to}">
                <button class="btn btn-ghost" onclick="ProjectProfitPage.year=document.getElementById('ppRevFrom').value.slice(0,4);ProjectProfitPage.loadRevenue()">🔍 ${PP_L('查询', '查詢', 'Search')}</button>
                <button class="btn btn-primary" onclick="ProjectProfitPage.revenueModal()">➕ ${PP_L('确认收入', '確認收入', 'Add Revenue')}</button>
                <button class="btn btn-ghost" onclick="ProjectProfitPage.syncRevenue()">⬇ ${PP_L('从出货自动引入当月收入', '從出貨自動引入當月收入', 'Auto-import from shipments')}</button>
            </div>
            <div id="ppRevBody">${rows.length ? this.table([
                PP_L('月份', '月份', 'Month'), PP_L('公司别', '公司別', 'BU'), PP_L('项目', '專案', 'Project'), PP_L('确认收入', '確認收入', 'Revenue'),
                PP_L('来源', '來源', 'Source'), PP_L('单据号', '單據號', 'Ref.'), PP_L('备注', '備註', 'Remark'),
                PP_L('操作', '操作', 'Actions')
            ], rows) : UI.empty('📋', PP_L('查询区间内无收入记录', '查詢區間內無收入記錄', 'No revenue records in range'))}</div>`;
    },

    revenueModal() {
        const fromEl = document.getElementById('ppRevFrom');
        const ym = (fromEl && fromEl.value) || this.ym || `${this.year}-01`;
        UI.modal(
            PP_L('确认项目收入', '確認專案收入', 'Recognize Project Revenue'),
            `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                <label>${PP_L('公司别', '公司別', 'BU')}<select id="pprBu" class="form-input">${this.buOptions(this.defaultBu())}</select></label>
                <label>${PP_L('项目', '專案', 'Project')}<select id="pprProj" class="form-input">${this.projectOptions(this.detailProject, false)}</select></label>
                <label>${PP_L('归属月份', '歸屬月份', 'Month')}<input type="month" id="pprYm" class="form-input" value="${ym}"></label>
                <label>${PP_L('确认收入', '確認收入', 'Revenue')}<input type="number" id="pprAmt" class="form-input" value="0"></label>
                <label>${PP_L('单据号', '單據號', 'Ref. No.')}<input id="pprRef" class="form-input" placeholder="${PP_L('可选', '可選', 'Optional')}"></label>
                <label style="grid-column:1/3">${PP_L('备注', '備註', 'Remark')}<input id="pprRemark" class="form-input"></label>
            </div>`,
            `<button class="btn btn-ghost" onclick="UI.closeModal()">${PP_L('取消', '取消', 'Cancel')}</button>
             <button class="btn btn-primary" onclick="ProjectProfitPage.saveRevenue()">${PP_L('保存', '儲存', 'Save')}</button>`
        );
    },

    async saveRevenue() {
        const data = {
            bu_no: document.getElementById('pprBu').value,
            project_id: document.getElementById('pprProj').value,
            YYYY_MM: document.getElementById('pprYm').value,
            revenue_amt: Number(document.getElementById('pprAmt').value) || 0,
            ref_no: document.getElementById('pprRef').value,
            remark: document.getElementById('pprRemark').value
        };
        try {
            await API.post('/api/project-profit/revenues', data);
            UI.closeModal();
            UI.toast(PP_L('收入已确认', '收入已確認', 'Revenue recorded'), 'success');
            this.applySavedScope(data.bu_no, { fromId: 'ppRevFrom', toId: 'ppRevTo', ym: data.YYYY_MM });
            this.loadRevenue();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async deleteRevenue(uid) {
        if (!confirm(PP_L('确定删除该收入记录？', '確定刪除該收入記錄？', 'Delete this revenue record?'))) return;
        try {
            await API.del(`/api/project-profit/revenues/${uid}`);
            UI.toast(PP_L('已删除', '已刪除', 'Deleted'), 'success');
            this.loadRevenue();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async syncRevenue() {
        const ym = this.ym;
        if (!ym) return UI.toast(PP_L('请选择月份', '請選擇月份', 'Select a month'), 'error');
        if (!confirm(PP_L(`将按出货收入重新生成 ${ym} 的「自动引入」项目收入记录，是否继续？`, `將按出貨收入重新產生 ${ym} 的「自動引入」專案收入記錄，是否繼續？`, `Regenerate auto-imported revenue for ${ym}?`))) return;
        try {
            const res = await API.post('/api/project-profit/revenues/sync', { bu_no: this.bu, YYYY_MM: ym });
            UI.toast(res.message || PP_L('已同步', '已同步', 'Synced'), 'success');
            this.expandRange('ppRevFrom', 'ppRevTo', ym);
            this.loadRevenue();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};

registerPage('projectProfit', async () => {
    await ProjectProfitPage.load();
});
