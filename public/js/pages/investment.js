/**
 * CEO-03 投资与资本配置决策页面
 * 项目 NPV/IRR/回收期评估、敏感性分析、资本配置额度与优先级、投后跟踪
 */
function invEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 三语标签：依当前界面语言取字（zh-CN / zh-TW / en）
const INV_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] ?? zh);

const INV_CATEGORIES = {
    CAPACITY: ['产能扩张', '產能擴張', 'Capacity Expansion'],
    EQUIPMENT: ['设备购置', '設備購置', 'Equipment Purchase'],
    RD: ['研发投入', '研發投入', 'R&D Investment'],
    IT: ['信息化', '資訊化', 'IT Systems'],
    MA: ['并购投资', '併購投資', 'M&A Investment'],
    OTHER: ['其他', '其他', 'Other']
};
const INV_STATUS = {
    DRAFT: { label: ['草拟', '草擬', 'Draft'], color: '#95a5a6' },
    REVIEW: { label: ['审批中', '審批中', 'In Review'], color: '#f39c12' },
    APPROVED: { label: ['已批准', '已批准', 'Approved'], color: '#2980b9' },
    IN_PROGRESS: { label: ['实施中', '實施中', 'In Progress'], color: '#8e44ad' },
    COMPLETED: { label: ['已完成', '已完成', 'Completed'], color: '#27ae60' },
    ON_HOLD: { label: ['暂缓', '暫緩', 'On Hold'], color: '#a0522d' },
    REJECTED: { label: ['已否决', '已否決', 'Rejected'], color: '#e74c3c' }
};
const invMapLabels = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) =>
    [k, Array.isArray(v) ? INV_L(v[0], v[1], v[2]) : INV_L(v.label[0], v.label[1], v.label[2])]));

registerPage('investment', async (c) => {
    Investment.year = String(State.year());
    Investment.bu = 'ALL';
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
            <h2 style="margin:0;font-size:20px;">${INV_L('投资与资本配置', '投資與資本配置', 'Investment & Capital Allocation')} <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">${INV_L('：· NPV/IRR · 资本配置', '：· NPV/IRR · 資本配置', ': · NPV/IRR · Capital Allocation')}</small></h2>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <select id="invBu" class="form-control" style="width:110px;" onchange="Investment.reload()">
                    <option value="ALL">${INV_L('全部范围', '全部範圍', 'All Scopes')}</option>
                    <option value="GROUP">${INV_L('集团', '集團', 'Group')}</option>
                    <option value="HM">HM</option><option value="HN">HN</option><option value="SZ">SZ</option>
                </select>
                <input id="invYear" type="number" min="2000" max="2100" class="form-control" style="width:110px;" onchange="Investment.reload()">
                <button class="btn btn-outline" onclick="Investment.editBudgets()">💰 ${INV_L('资本预算', '資本預算', 'Capital Budget')}</button>
                <button class="btn btn-primary" onclick="Investment.editProject()">+ ${INV_L('新增项目', '新增專案', 'New Project')}</button>
                <button class="btn btn-success" onclick="Investment.load()">${INV_L('刷新', '重新整理', 'Refresh')}</button>
            </div>
        </div>
        <div id="invKpi" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:14px;"></div>
        <div id="invAlerts"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
            <div class="card" style="margin:0;">
                <div class="card-title">${INV_L('资本配置 · 按公司别', '資本配置 · 按公司別', 'Capital Allocation · By Company')}</div>
                <div id="invAllocBu">${t('loading')}</div>
            </div>
            <div class="card" style="margin:0;">
                <div class="card-title">${INV_L('资本配置 · 按投资类别', '資本配置 · 按投資類別', 'Capital Allocation · By Category')}</div>
                <div id="invAllocCat">${t('loading')}</div>
            </div>
        </div>
        <div class="card" style="margin-bottom:14px;">
            <div class="card-title">${INV_L('资本配置优先级（按获利指数 PI 排序）', '資本配置優先級（按獲利指數 PI 排序）', 'Allocation Priority (sorted by PI)')}</div>
            <div id="invRanking">${t('loading')}</div>
        </div>
        <div class="card" style="margin-bottom:14px;">
            <div class="card-title">${INV_L('投资项目清单', '投資專案清單', 'Investment Projects')}</div>
            <div id="invTable">${t('loading')}</div>
        </div>
        <div class="card">
            <div class="card-title">${INV_L('投后跟踪（计划 vs 实际现金流）', '投後追蹤（計劃 vs 實際現金流）', 'Post Tracking (Plan vs Actual Cashflow)')}</div>
            <div id="invPost">${t('loading')}</div>
        </div>
    `;
    document.getElementById('invBu').value = Investment.bu;
    document.getElementById('invYear').value = Investment.year;
    await Investment.load();
});

const Investment = {
    year: String(State.year()),
    bu: 'ALL',
    data: null,

    async reload() {
        const buEl = document.getElementById('invBu');
        const yEl = document.getElementById('invYear');
        this.bu = buEl ? buEl.value : 'ALL';
        const y = yEl ? String(yEl.value || '').trim() : '';
        if (/^\d{4}$/.test(y)) this.year = y;
        await this.load();
    },

    async load() {
        const box = document.getElementById('invTable');
        if (box) box.innerHTML = t('loading');
        try {
            let url = `/api/investment/overview?YYYY=${encodeURIComponent(this.year)}`;
            if (this.bu && this.bu !== 'ALL') url += `&bu_no=${encodeURIComponent(this.bu)}`;
            const res = await API.get(url);
            this.data = res.data;
            this.year = res.data.YYYY;
            const yEl = document.getElementById('invYear');
            if (yEl) yEl.value = this.year;
            this.render();
        } catch (e) {
            if (box) box.innerHTML = `<p style="color:#e74c3c">${invEsc(e.message)}</p>`;
        }
    },

    render() {
        this.renderKpis();
        this.renderAlerts();
        this.renderAllocation();
        this.renderRanking();
        this.renderTable();
        this.renderPost();
    },

    statusHtml(status) {
        const s = INV_STATUS[status] || { label: [status, status, status], color: '#95a5a6' };
        return `<span style="color:${s.color};font-weight:600;">● ${INV_L(s.label[0], s.label[1], s.label[2])}</span>`;
    },

    pct(v, dft = '-') {
        return v == null ? dft : `${UI.fmt(v, 2)} %`;
    },

    renderKpis() {
        const s = this.data.summary || {};
        const usage = this.data.budget_usage_pct;
        const cards = [
            [INV_L('项目数', '專案數', 'Projects'), `${s.count || 0} ${INV_L('项', '項', 'items')}`, '#2980b9'],
            [INV_L('投资总额', '投資總額', 'Total Investment'), `¥ ${UI.fmt(s.total_investment)}`, '#2c3e50'],
            [INV_L('已批准投资', '已批准投資', 'Approved Investment'), `¥ ${UI.fmt(s.committed_investment)}`, '#8e44ad'],
            [INV_L('组合 NPV', '組合 NPV', 'Portfolio NPV'), `¥ ${UI.fmt(s.total_npv)}`, s.total_npv >= 0 ? '#27ae60' : '#e74c3c'],
            [INV_L('组合 IRR', '組合 IRR', 'Portfolio IRR'), this.pct(s.portfolio_irr), '#16a085'],
            [INV_L('加权回收期', '加權回收期', 'Weighted Payback'), s.avg_payback == null ? '-' : `${UI.fmt(s.avg_payback, 2)} ${INV_L('年', '年', 'yrs')}`, '#e67e22'],
            [INV_L('预算使用率', '預算使用率', 'Budget Usage'), usage == null ? INV_L('未设预算', '未設預算', 'No budget set') : `${UI.fmt(usage, 1)} %`, usage != null && usage > 100 ? '#e74c3c' : '#2980b9'],
            [INV_L('正 NPV 项目', '正 NPV 專案', 'NPV-positive Projects'), `${s.positive_npv || 0} ${INV_L('项', '項', 'items')}`, '#27ae60']
        ];
        document.getElementById('invKpi').innerHTML = cards.map(([label, val, color]) => `
            <div class="card" style="margin:0;padding:14px;">
                <div style="font-size:12px;color:#7f8c8d;">${label}</div>
                <div style="font-size:20px;font-weight:700;color:${color};margin-top:4px;">${val}</div>
            </div>`).join('');
    },

    renderAlerts() {
        const alerts = this.data.alerts || [];
        const el = document.getElementById('invAlerts');
        if (!alerts.length) {
            el.innerHTML = `<div style="background:#eafaf1;border-left:4px solid #27ae60;padding:10px 12px;border-radius:6px;margin-bottom:14px;font-size:13px;">✅ ${INV_L('资本配置与项目回报当前无异常', '資本配置與專案回報目前無異常', 'No anomalies in capital allocation or project returns')}</div>`;
            return;
        }
        el.innerHTML = alerts.map(a => `
            <div style="background:${a.level === 'danger' ? '#fdecea' : '#fef5e7'};border-left:4px solid ${a.level === 'danger' ? '#e74c3c' : '#f39c12'};padding:10px 12px;border-radius:6px;margin-bottom:10px;font-size:13px;">
                <div style="font-weight:600;">${a.level === 'danger' ? '🚨' : '🟡'} ${invEsc(a.message)}</div>
                <div style="color:#7f8c8d;margin-top:2px;">${INV_L('建议：', '建議：', 'Suggestion: ')}${invEsc(a.suggestion || '')}</div>
            </div>`).join('');
    },

    renderAllocation() {
        const cell = 'padding:8px;border:1px solid #eee;';
        const block = (rows, dimLabel) => {
            if (!rows.length) return UI.empty('🏢', INV_L('尚无配置数据', '尚無配置數據', 'No allocation data'));
            return `
                <div style="overflow-x:auto;">
                <table class="data-table" style="width:100%;border-collapse:collapse;font-size:12.5px;">
                    <thead><tr style="background:#f8f9fa;">
                        <th style="${cell}text-align:left;">${dimLabel}</th>
                        <th style="${cell}text-align:right;">${INV_L('项目数', '專案數', 'Projects')}</th>
                        <th style="${cell}text-align:right;">${INV_L('预算', '預算', 'Budget')}</th>
                        <th style="${cell}text-align:right;">${INV_L('已批准', '已批准', 'Approved')}</th>
                        <th style="${cell}text-align:right;">${INV_L('管道中', '管道中', 'Pipeline')}</th>
                        <th style="${cell}text-align:right;">NPV</th>
                        <th style="${cell}text-align:right;">${INV_L('使用率', '使用率', 'Usage')}</th>
                    </tr></thead>
                    <tbody>
                        ${rows.map(r => {
                            const over = r.usage_pct != null && r.usage_pct > 100;
                            return `<tr>
                                <td style="${cell}font-weight:600;">${invEsc(r.label)}</td>
                                <td style="${cell}text-align:right;">${r.project_count}</td>
                                <td style="${cell}text-align:right;">${r.budget == null ? '-' : UI.fmt(r.budget)}</td>
                                <td style="${cell}text-align:right;">${UI.fmt(r.approved_amount)}</td>
                                <td style="${cell}text-align:right;color:#7f8c8d;">${UI.fmt(r.pipeline_amount)}</td>
                                <td style="${cell}text-align:right;color:${r.npv >= 0 ? '#27ae60' : '#e74c3c'};">${UI.fmt(r.npv)}</td>
                                <td style="${cell}text-align:right;font-weight:600;color:${over ? '#e74c3c' : '#2980b9'};">${r.usage_pct == null ? '-' : UI.fmt(r.usage_pct, 1) + ' %'}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
                </div>`;
        };
        const alloc = this.data.allocation || { by_bu: [], by_category: [] };
        document.getElementById('invAllocBu').innerHTML = block(alloc.by_bu, INV_L('公司别', '公司別', 'Company'));
        document.getElementById('invAllocCat').innerHTML = block(alloc.by_category, INV_L('投资类别', '投資類別', 'Category'));
    },

    renderRanking() {
        const rows = this.data.ranking || [];
        const el = document.getElementById('invRanking');
        if (!rows.length) { el.innerHTML = UI.empty('📊', INV_L('暂无投资项目，点击「新增项目」建立投资计划', '暫無投資專案，點擊「新增專案」建立投資計劃', 'No investment projects yet. Click "New Project" to create one')); return; }
        const cell = 'padding:8px;border:1px solid #eee;';
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#f8f9fa;">
                    <th style="${cell}">${INV_L('排名', '排名', 'Rank')}</th>
                    <th style="${cell}">${INV_L('项目', '專案', 'Project')}</th>
                    <th style="${cell}">${INV_L('公司 / 类别', '公司 / 類別', 'Company / Category')}</th>
                    <th style="${cell}text-align:right;">${INV_L('投资额', '投資額', 'Investment')}</th>
                    <th style="${cell}text-align:right;">NPV</th>
                    <th style="${cell}text-align:right;">IRR</th>
                    <th style="${cell}text-align:right;">${INV_L('回收期', '回收期', 'Payback')}</th>
                    <th style="${cell}text-align:right;">PI</th>
                    <th style="${cell}">${INV_L('配置建议', '配置建議', 'Recommendation')}</th>
                    <th style="${cell}">${INV_L('状态', '狀態', 'Status')}</th>
                </tr></thead>
                <tbody>
                    ${rows.map((r, i) => {
                        const color = r.recommend === '优先投放' ? '#27ae60'
                            : (r.recommend === '排队待额度' ? '#f39c12' : '#e74c3c');
                        return `<tr>
                            <td style="${cell}text-align:center;font-weight:700;">${i + 1}</td>
                            <td style="${cell}">${invEsc(r.project_name)}</td>
                            <td style="${cell}">${invEsc(r.bu_no)} · ${invEsc(r.category_name)}</td>
                            <td style="${cell}text-align:right;">${UI.fmt(r.initial_investment)}</td>
                            <td style="${cell}text-align:right;color:${r.npv >= 0 ? '#27ae60' : '#e74c3c'};">${UI.fmt(r.npv)}</td>
                            <td style="${cell}text-align:right;">${this.pct(r.irr)}</td>
                            <td style="${cell}text-align:right;">${r.payback == null ? INV_L('未回收', '未回收', 'Not recovered') : UI.fmt(r.payback, 2) + ' ' + INV_L('年', '年', 'yrs')}</td>
                            <td style="${cell}text-align:right;">${r.pi == null ? '-' : UI.fmt(r.pi, 2)}</td>
                            <td style="${cell}color:${color};font-weight:600;">${invEsc(r.recommend)}</td>
                            <td style="${cell}">${this.statusHtml(r.status)}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
            </div>`;
    },

    renderTable() {
        const rows = this.data.projects || [];
        const el = document.getElementById('invTable');
        if (!rows.length) {
            el.innerHTML = UI.empty('💼', INV_L('当前范围尚无投资项目，点击「新增项目」建立评估', '當前範圍尚無投資專案，點擊「新增專案」建立評估', 'No investment projects in this scope. Click "New Project" to add one'));
            return;
        }
        const cell = 'padding:8px;border:1px solid #eee;';
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#f8f9fa;">
                    <th style="${cell}">${INV_L('项目', '專案', 'Project')}</th>
                    <th style="${cell}">${INV_L('公司 / 类别', '公司 / 類別', 'Company / Category')}</th>
                    <th style="${cell}text-align:right;">${INV_L('投资额', '投資額', 'Investment')}</th>
                    <th style="${cell}text-align:right;">${INV_L('折现率', '折現率', 'Discount Rate')}</th>
                    <th style="${cell}text-align:right;">NPV</th>
                    <th style="${cell}text-align:right;">IRR</th>
                    <th style="${cell}text-align:right;">${INV_L('回收期', '回收期', 'Payback')}</th>
                    <th style="${cell}text-align:right;">PI</th>
                    <th style="${cell}">${INV_L('状态', '狀態', 'Status')}</th>
                    <th style="${cell}">${INV_L('投后偏差', '投後偏差', 'Post Variance')}</th>
                    <th style="${cell}">${INV_L('操作', '操作', 'Actions')}</th>
                </tr></thead>
                <tbody>
                    ${rows.map(r => `<tr>
                        <td style="${cell}">
                            <div style="font-weight:600;">${invEsc(r.project_name)}</div>
                            <div style="font-size:11.5px;color:#7f8c8d;">${invEsc(r.project_code || ('P' + r.project_id))} · ${r.horizon_years} ${INV_L('年', '年', 'yrs')} · ${INV_L('负责人', '負責人', 'Owner')} ${invEsc(r.owner_id || '-')}</div>
                        </td>
                        <td style="${cell}">${invEsc(r.bu_no)} · ${invEsc(r.category_name)}</td>
                        <td style="${cell}text-align:right;">${UI.fmt(r.initial_investment)}</td>
                        <td style="${cell}text-align:right;">${UI.fmt(r.discount_rate, 2)} %</td>
                        <td style="${cell}text-align:right;font-weight:600;color:${r.npv >= 0 ? '#27ae60' : '#e74c3c'};">${UI.fmt(r.npv)}</td>
                        <td style="${cell}text-align:right;">${this.pct(r.irr)}</td>
                        <td style="${cell}text-align:right;">${r.payback == null ? INV_L('未回收', '未回收', 'Not recovered') : UI.fmt(r.payback, 2) + ' ' + INV_L('年', '年', 'yrs')}</td>
                        <td style="${cell}text-align:right;">${r.pi == null ? '-' : UI.fmt(r.pi, 2)}</td>
                        <td style="${cell}">${this.statusHtml(r.status)}</td>
                        <td style="${cell}text-align:right;color:${r.post.variance == null ? '#7f8c8d' : (r.post.variance >= 0 ? '#27ae60' : '#e74c3c')};">
                            ${r.post.tracked ? `${UI.fmt(r.post.variance)}（${this.pct(r.post.variance_pct)}）` : '-'}
                        </td>
                        <td style="${cell}white-space:nowrap;">
                            <button class="btn btn-sm btn-outline" onclick="Investment.openDetail(${r.project_id})">${INV_L('详情', '詳情', 'Detail')}</button>
                            <button class="btn btn-sm btn-outline" onclick="Investment.editProject(${r.project_id})">${INV_L('编辑', '編輯', 'Edit')}</button>
                            <button class="btn btn-sm btn-danger" onclick="Investment.delProject(${r.project_id})">${INV_L('删除', '刪除', 'Delete')}</button>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
    },

    renderPost() {
        const rows = this.data.post_tracking || [];
        const el = document.getElementById('invPost');
        if (!rows.length) {
            el.innerHTML = UI.empty('📈', INV_L('尚无投后实际数据；在项目详情中录入实际现金流后即可对比', '尚無投後實際數據；在專案詳情中錄入實際現金流後即可對比', 'No post-tracking actuals yet; enter actual cashflows in project detail to compare'));
            return;
        }
        const cell = 'padding:8px;border:1px solid #eee;';
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#f8f9fa;">
                    <th style="${cell}">${INV_L('项目', '專案', 'Project')}</th>
                    <th style="${cell}">${INV_L('公司', '公司', 'Company')}</th>
                    <th style="${cell}">${INV_L('状态', '狀態', 'Status')}</th>
                    <th style="${cell}text-align:right;">${INV_L('计划现金流合计', '計劃現金流合計', 'Planned Cashflow')}</th>
                    <th style="${cell}text-align:right;">${INV_L('实际现金流合计', '實際現金流合計', 'Actual Cashflow')}</th>
                    <th style="${cell}text-align:right;">${INV_L('偏差', '偏差', 'Variance')}</th>
                    <th style="${cell}text-align:right;">${INV_L('偏差率', '偏差率', 'Variance %')}</th>
                </tr></thead>
                <tbody>
                    ${rows.map(r => `<tr>
                        <td style="${cell}">${invEsc(r.project_name)}</td>
                        <td style="${cell}">${invEsc(r.bu_no)}</td>
                        <td style="${cell}">${this.statusHtml(r.status)}</td>
                        <td style="${cell}text-align:right;">${UI.fmt(r.planned_total)}</td>
                        <td style="${cell}text-align:right;">${UI.fmt(r.actual_total)}</td>
                        <td style="${cell}text-align:right;font-weight:600;color:${r.variance >= 0 ? '#27ae60' : '#e74c3c'};">${UI.fmt(r.variance)}</td>
                        <td style="${cell}text-align:right;">${this.pct(r.variance_pct)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
    },

    // ===== 项目编辑 =====
    editProject(id) {
        const list = (this.data && this.data.projects) || [];
        const it = id ? list.find(x => x.project_id === id) : null;
        const v = (k, dft = '') => it && it[k] != null ? it[k] : dft;
        const options = (map, cur) => Object.entries(map).map(([k, label]) =>
            `<option value="${k}" ${String(cur) === k ? 'selected' : ''}>${label}</option>`).join('');
        const buOpts = ['GROUP', 'HM', 'HN', 'SZ'].map(b =>
            `<option value="${b}" ${String(v('bu_no', 'GROUP')) === b ? 'selected' : ''}>${b}</option>`).join('');

        UI.modal(it ? INV_L('编辑投资项目', '編輯投資專案', 'Edit Investment Project') : INV_L('新增投资项目', '新增投資專案', 'New Investment Project'), `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;min-width:620px;">
                <div style="grid-column:1 / span 2;"><label class="form-label">${INV_L('项目名称', '專案名稱', 'Project Name')}</label><input id="invFName" class="form-control" value="${invEsc(v('project_name'))}"></div>
                <div><label class="form-label">${INV_L('项目编号', '專案編號', 'Project Code')}</label><input id="invFCode" class="form-control" placeholder="${INV_L('可留空', '可留空', 'Optional')}" value="${invEsc(v('project_code'))}"></div>
                <div><label class="form-label">${INV_L('立项年度', '立項年度', 'Fiscal Year')}</label><input id="invFYear" type="number" min="2000" max="2100" class="form-control" value="${v('fiscal_year', this.year)}"></div>
                <div><label class="form-label">${INV_L('公司别', '公司別', 'Company')}</label><select id="invFBu" class="form-control">${buOpts}</select></div>
                <div><label class="form-label">${INV_L('投资类别', '投資類別', 'Investment Category')}</label><select id="invFCat" class="form-control">${options(invMapLabels(INV_CATEGORIES), v('category', 'OTHER'))}</select></div>
                <div><label class="form-label">${INV_L('项目状态', '專案狀態', 'Project Status')}</label><select id="invFStatus" class="form-control">${options(invMapLabels(INV_STATUS), v('status', 'DRAFT'))}</select></div>
                <div><label class="form-label">${INV_L('预计开工（YYYY-MM）', '預計開工（YYYY-MM）', 'Start Month (YYYY-MM)')}</label><input id="invFStart" type="month" class="form-control" value="${invEsc(v('start_month'))}"></div>
                <div><label class="form-label">${INV_L('初始投资额（元）', '初始投資額（元）', 'Initial Investment (CNY)')}</label><input id="invFInit" type="number" step="0.01" class="form-control" value="${v('initial_investment', '')}"></div>
                <div><label class="form-label">${INV_L('现金流年数', '現金流年數', 'Cashflow Years')}</label><input id="invFHorizon" type="number" min="1" max="30" class="form-control" value="${v('horizon_years', 5)}"></div>
                <div><label class="form-label">${INV_L('折现率（%）', '折現率（%）', 'Discount Rate (%)')}</label><input id="invFRate" type="number" step="0.01" class="form-control" value="${v('discount_rate', 8)}"></div>
                <div><label class="form-label">${INV_L('期末残值（元）', '期末殘值（元）', 'Salvage Value (CNY)')}</label><input id="invFSalvage" type="number" step="0.01" class="form-control" value="${v('salvage_value', 0)}"></div>
                <div><label class="form-label">${INV_L('等额年净现金流（元）', '等額年淨現金流（元）', 'Annual Net Cashflow (CNY)')}</label><input id="invFAnnual" type="number" step="0.01" class="form-control" value="${v('annual_cashflow', '')}"></div>
                <div><label class="form-label">${INV_L('责任部门', '責任部門', 'Department')}</label><input id="invFDept" class="form-control" value="${invEsc(v('department'))}"></div>
                <div><label class="form-label">${INV_L('负责人', '負責人', 'Owner')}</label><input id="invFOwner" class="form-control" value="${invEsc(v('owner_id'))}"></div>
                <div><label class="form-label">${INV_L('决策优先级（越小越前）', '決策優先級（越小越前）', 'Priority (lower = earlier)')}</label><input id="invFPriority" type="number" class="form-control" value="${v('priority', 0)}"></div>
                <div style="grid-column:1 / span 2;"><label class="form-label">${INV_L('备注', '備註', 'Remark')}</label><input id="invFRmk" class="form-control" value="${invEsc(v('remark'))}"></div>
                <div style="grid-column:1 / span 2;font-size:12px;color:#7f8c8d;">${INV_L('提示：保存后系统按「等额年净现金流」自动生成各年度计划现金流，可在「详情」中逐年调整并录入实际值。', '提示：儲存後系統按「等額年淨現金流」自動產生各年度計劃現金流，可在「詳情」中逐年調整並錄入實際值。', 'Tip: On save, annual planned cashflows are generated from the equal annual net cashflow; adjust year by year and enter actuals in "Detail".')}</div>
            </div>`,
            `<button class="btn btn-outline" onclick="UI.closeModal()">${INV_L('取消', '取消', 'Cancel')}</button>
             <button class="btn btn-primary" onclick="Investment.saveProject(${id || 0})">${INV_L('保存', '儲存', 'Save')}</button>`);
    },

    async saveProject(id) {
        const body = {
            project_name: document.getElementById('invFName').value,
            project_code: document.getElementById('invFCode').value,
            fiscal_year: document.getElementById('invFYear').value,
            bu_no: document.getElementById('invFBu').value,
            category: document.getElementById('invFCat').value,
            status: document.getElementById('invFStatus').value,
            start_month: document.getElementById('invFStart').value,
            initial_investment: document.getElementById('invFInit').value,
            horizon_years: document.getElementById('invFHorizon').value,
            discount_rate: document.getElementById('invFRate').value,
            salvage_value: document.getElementById('invFSalvage').value,
            annual_cashflow: document.getElementById('invFAnnual').value,
            department: document.getElementById('invFDept').value,
            owner_id: document.getElementById('invFOwner').value,
            priority: document.getElementById('invFPriority').value,
            remark: document.getElementById('invFRmk').value
        };
        try {
            if (id) await API.put(`/api/investment/projects/${id}`, body);
            else await API.post('/api/investment/projects', body);
            UI.closeModal(); UI.toast(INV_L('已保存', '已儲存', 'Saved'), 'success');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async delProject(id) {
        if (!confirm(INV_L('确认删除该投资项目？其现金流明细将一并删除。', '確認刪除該投資專案？其現金流明細將一併刪除。', 'Delete this investment project? Its cashflow details will be removed as well.'))) return;
        try {
            await API.del(`/api/investment/projects/${id}`);
            UI.toast(INV_L('已删除', '已刪除', 'Deleted'), 'success');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ===== 项目详情：现金流 + 敏感性 =====
    async openDetail(id) {
        try {
            const res = await API.get(`/api/investment/projects/${id}`);
            this.detail = res.data;
            this.renderDetail();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    renderDetail() {
        const d = this.detail;
        const p = d.project;
        const m = d.metrics;
        const s = d.sensitivity;
        const cell = 'padding:6px 8px;border:1px solid #eee;';
        const rowHtml = d.cashflows.map(c => `
            <tr>
                <td style="${cell}text-align:center;">${INV_L(`第 ${c.year_index} 年`, `第 ${c.year_index} 年`, `Year ${c.year_index}`)}</td>
                <td style="${cell}"><input class="form-control" data-cf="planned" data-year="${c.year_index}" type="number" step="0.01" value="${c.planned_amount}" style="padding:4px 6px;"></td>
                <td style="${cell}"><input class="form-control" data-cf="actual" data-year="${c.year_index}" type="number" step="0.01" value="${c.actual_amount}" style="padding:4px 6px;"></td>
                <td style="${cell}text-align:right;color:${c.actual_amount >= c.planned_amount ? '#27ae60' : '#e74c3c'};">${UI.fmt(c.actual_amount - c.planned_amount)}</td>
            </tr>`).join('');

        const matrixHtml = `
            <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
                <thead><tr style="background:#f8f9fa;">
                    <th style="${cell}">${INV_L('折现率 \\ 现金流', '折現率 \\ 現金流', 'Rate \\ Cashflow')}</th>
                    ${s.matrix.cf_axis.map(cf => `<th style="${cell}text-align:right;">${cf > 0 ? '+' : ''}${cf}%</th>`).join('')}
                </tr></thead>
                <tbody>
                    ${s.matrix.cells.map((row, i) => `<tr>
                        <td style="${cell}font-weight:600;">${s.matrix.rate_axis[i]} %</td>
                        ${row.map(v => `<td style="${cell}text-align:right;color:${v >= 0 ? '#27ae60' : '#e74c3c'};">${UI.fmt(v)}</td>`).join('')}
                    </tr>`).join('')}
                </tbody>
            </table>`;

        const tornadoHtml = `
            <table style="width:100%;border-collapse:collapse;font-size:12.5px;margin-top:8px;">
                <thead><tr style="background:#f8f9fa;">
                    <th style="${cell}">${INV_L('敏感因子', '敏感因子', 'Factor')}</th>
                    <th style="${cell}text-align:right;">${INV_L('不利情形 NPV', '不利情形 NPV', 'Downside NPV')}</th>
                    <th style="${cell}text-align:right;">${INV_L('有利情形 NPV', '有利情形 NPV', 'Upside NPV')}</th>
                    <th style="${cell}text-align:right;">${INV_L('影响幅度', '影響幅度', 'Impact')}</th>
                </tr></thead>
                <tbody>
                    ${s.tornado.map(t => `<tr>
                        <td style="${cell}">${invEsc(t.factor)}</td>
                        <td style="${cell}text-align:right;">${UI.fmt(Math.min(t.low, t.high))}</td>
                        <td style="${cell}text-align:right;">${UI.fmt(Math.max(t.low, t.high))}</td>
                        <td style="${cell}text-align:right;font-weight:600;">${UI.fmt(t.swing)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>`;

        UI.modal(`${INV_L('投资项目详情', '投資專案詳情', 'Investment Project Detail')} · ${invEsc(p.project_name)}`, `
            <div style="min-width:760px;max-height:72vh;overflow:auto;">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:12px;">
                    ${[
                        [INV_L('投资额', '投資額', 'Investment'), `¥ ${UI.fmt(m.initial_investment)}`],
                        ['NPV', `¥ ${UI.fmt(m.npv)}`],
                        ['IRR', this.pct(m.irr)],
                        [INV_L('回收期', '回收期', 'Payback'), m.payback == null ? INV_L('未回收', '未回收', 'Not recovered') : `${UI.fmt(m.payback, 2)} ${INV_L('年', '年', 'yrs')}`],
                        [INV_L('动态回收期', '動態回收期', 'Discounted Payback'), m.discounted_payback == null ? INV_L('未回收', '未回收', 'Not recovered') : `${UI.fmt(m.discounted_payback, 2)} ${INV_L('年', '年', 'yrs')}`],
                        [INV_L('获利指数 PI', '獲利指數 PI', 'Profitability Index (PI)'), m.pi == null ? '-' : UI.fmt(m.pi, 2)],
                        ['ROI', this.pct(m.roi)]
                    ].map(([k, v]) => `
                        <div style="background:#f8f9fa;border-radius:6px;padding:8px 10px;">
                            <div style="font-size:11.5px;color:#7f8c8d;">${k}</div>
                            <div style="font-size:15px;font-weight:700;">${v}</div>
                        </div>`).join('')}
                </div>
                <div style="font-size:12.5px;color:#5d6d7e;margin-bottom:8px;">
                    ${invEsc(p.bu_no)} · ${invEsc(p.category_name)} · ${invEsc(p.status_name)} · ${INV_L('折现率', '折現率', 'Discount rate')} ${UI.fmt(p.discount_rate, 2)}% · ${INV_L('期限', '期限', 'Horizon')} ${p.horizon_years} ${INV_L('年', '年', 'yrs')} · ${INV_L('负责人', '負責人', 'Owner')} ${invEsc(p.owner_id || '-')}
                </div>

                <div style="font-weight:600;margin:10px 0 6px;">${INV_L('分年度现金流（可编辑）', '分年度現金流（可編輯）', 'Annual Cashflows (editable)')}</div>
                <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
                    <thead><tr style="background:#f8f9fa;">
                        <th style="${cell}">${INV_L('年度', '年度', 'Year')}</th>
                        <th style="${cell}">${INV_L('计划净现金流', '計劃淨現金流', 'Planned Net CF')}</th>
                        <th style="${cell}">${INV_L('实际净现金流', '實際淨現金流', 'Actual Net CF')}</th>
                        <th style="${cell}text-align:right;">${INV_L('偏差', '偏差', 'Variance')}</th>
                    </tr></thead>
                    <tbody>${rowHtml}</tbody>
                </table>

                <div style="font-weight:600;margin:14px 0 6px;">${INV_L('敏感性分析 · NPV 矩阵（折现率 × 现金流）', '敏感性分析 · NPV 矩陣（折現率 × 現金流）', 'Sensitivity · NPV Matrix (Rate × Cashflow)')}</div>
                ${matrixHtml}
                <div style="font-weight:600;margin:12px 0 0;">${INV_L('单因子敏感度', '單因子敏感度', 'Single-factor Sensitivity')}</div>
                ${tornadoHtml}
            </div>`,
            `<button class="btn btn-outline" onclick="UI.closeModal()">${INV_L('关闭', '關閉', 'Close')}</button>
             <button class="btn btn-primary" onclick="Investment.saveCashflows(${p.project_id})">${INV_L('保存现金流', '儲存現金流', 'Save Cashflows')}</button>`);
    },

    async saveCashflows(id) {
        const inputs = Array.from(document.querySelectorAll('[data-cf="planned"]'));
        const rows = inputs.map(inp => {
            const y = Number(inp.getAttribute('data-year'));
            const actualEl = document.querySelector(`[data-cf="actual"][data-year="${y}"]`);
            return {
                year_index: y,
                planned_amount: inp.value,
                actual_amount: actualEl ? actualEl.value : 0
            };
        });
        try {
            await API.put(`/api/investment/projects/${id}/cashflows`, { rows });
            UI.toast(INV_L('现金流已保存', '現金流已儲存', 'Cashflows saved'), 'success');
            await this.openDetail(id);
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ===== 资本预算 =====
    async editBudgets() {
        let rows = [];
        try {
            const res = await API.get(`/api/investment/budgets?YYYY=${encodeURIComponent(this.year)}`);
            rows = res.data || [];
        } catch (e) { UI.toast(e.message, 'error'); return; }

        const input = (r) => `
            <div style="display:grid;grid-template-columns:110px 1fr;gap:10px;align-items:center;margin-bottom:8px;">
                <div style="font-weight:600;">${r.bu_no === 'GROUP' ? INV_L('集团', '集團', 'Group') : r.bu_no}</div>
                <input id="invBudget_${r.bu_no}" type="number" step="0.01" min="0" class="form-control" value="${r.budget_amount || 0}">
            </div>`;

        UI.modal(`${INV_L('年度资本预算', '年度資本預算', 'Annual Capital Budget')} · ${this.year}`, `
            <div style="min-width:420px;">
                <div style="font-size:12.5px;color:#7f8c8d;margin-bottom:10px;">${INV_L('预算用于对比各公司别已批准投资额，超出时页面会提示超支预警。', '預算用於對比各公司別已批准投資額，超出時頁面會提示超支預警。', 'Budgets are compared against approved investment per company; overruns trigger a warning on the page.')}</div>
                ${rows.map(input).join('')}
            </div>`,
            `<button class="btn btn-outline" onclick="UI.closeModal()">${INV_L('取消', '取消', 'Cancel')}</button>
             <button class="btn btn-primary" onclick="Investment.saveBudgets()">${INV_L('保存预算', '儲存預算', 'Save Budgets')}</button>`);
    },

    async saveBudgets() {
        try {
            for (const bu of ['GROUP', 'HM', 'HN', 'SZ']) {
                const el = document.getElementById(`invBudget_${bu}`);
                if (!el) continue;
                await API.post('/api/investment/budgets', {
                    fiscal_year: this.year,
                    bu_no: bu,
                    budget_amount: el.value
                });
            }
            UI.closeModal();
            UI.toast(INV_L('资本预算已保存', '資本預算已儲存', 'Capital budgets saved'), 'success');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};
