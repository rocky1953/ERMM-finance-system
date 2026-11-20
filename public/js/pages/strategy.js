/**
 * CEO-01 战略目标与平衡计分卡页面
 * 公司→部门→个人目标贯通、四维度记分卡、偏差分析与 KPI 自动同步
 */
function bscEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const BSC_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] ?? zh);

const BSC_LEVELS = { COMPANY: BSC_L('公司级', '公司級', 'Company'), DEPARTMENT: BSC_L('部门级', '部門級', 'Department'), PERSONAL: BSC_L('个人级', '個人級', 'Personal') };
const BSC_PERSPECTIVES = {
    FINANCIAL: BSC_L('财务维度', '財務維度', 'Financial'), CUSTOMER: BSC_L('客户维度', '客戶維度', 'Customer'),
    PROCESS: BSC_L('内部流程', '內部流程', 'Internal Process'), LEARNING: BSC_L('学习成长', '學習成長', 'Learning & Growth')
};
const BSC_DIRECTIONS = { UP: BSC_L('正向（越大越好）', '正向（越大越好）', 'Higher is better'), DOWN: BSC_L('逆向（越小越好）', '逆向（越小越好）', 'Lower is better') };
const BSC_STATUS = {
    ON_TRACK: { label: BSC_L('达标', '達標', 'On Track'), color: '#27ae60' },
    WARNING: { label: BSC_L('预警', '預警', 'Warning'), color: '#f39c12' },
    LAGGING: { label: BSC_L('落后', '落後', 'Lagging'), color: '#e74c3c' },
    PENDING: { label: BSC_L('未录入', '未錄入', 'Not Entered'), color: '#95a5a6' }
};
const BSC_KPI_IDS = [
    'net_profit_margin', 'roe', 'roa', 'gross_profit', 'current_ratio', 'quick_ratio',
    'debt_ratio', 'ar_turn', 'ar_days', 'inventory_turn', 'total_asset_turn',
    'cash_ratio', 'cash_conv_days', 'sale_growth', 'profit_growth'
];

registerPage('strategy', async (c) => {
    Strategy.bu = 'GROUP';
    Strategy.year = String(State.year());
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
            <h2 style="margin:0;font-size:20px;">${BSC_L('战略目标/平衡计分卡', '戰略目標/平衡計分卡', 'Strategic Objectives / BSC')} <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">${BSC_L('：· 公司→部门→个人', '：· 公司→部門→個人', ': · Company→Dept→Individual')}</small></h2>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <select id="bscBu" class="form-control" style="width:100px;" onchange="Strategy.reload()">
                    <option value="ALL">${BSC_L('全部范围', '全部範圍', 'All Scopes')}</option>
                    <option value="GROUP">${BSC_L('集团', '集團', 'Group')}</option>
                    <option value="HM">HM</option><option value="HN">HN</option><option value="SZ">SZ</option>
                </select>
                <input id="bscYear" type="number" min="2000" max="2100" class="form-control" style="width:110px;" onchange="Strategy.reload()">
                <button class="btn btn-outline" onclick="Strategy.sync()">${BSC_L('🔄 同步 KPI', '🔄 同步 KPI', '🔄 Sync KPI')}</button>
                <button class="btn btn-outline" onclick="Strategy.scanAlerts()">${BSC_L('🔔 扫描预警', '🔔 掃描預警', '🔔 Scan Alerts')}</button>
                <button class="btn btn-primary" onclick="Strategy.editObjective()">${BSC_L('+ 新增目标', '+ 新增目標', '+ New Objective')}</button>
                <button class="btn btn-success" onclick="Strategy.load()">${BSC_L('刷新', '重新整理', 'Refresh')}</button>
            </div>
        </div>
        <div id="bscKpi" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:14px;"></div>
        <div id="bscPerspectives" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:14px;"></div>
        <div id="bscDeviation"></div>
        <div class="card" style="margin-bottom:14px;">
            <div class="card-title">${BSC_L('目标记分卡', '目標記分卡', 'Objective Scorecard')}</div>
            <div id="bscTable">${t('loading')}</div>
        </div>
        <div class="card" style="margin-bottom:14px;">
            <div class="card-title">${BSC_L('目标层级（公司 → 部门 → 个人）', '目標層級（公司 → 部門 → 個人）', 'Objective Hierarchy (Company → Dept → Individual)')}</div>
            <div id="bscTree">${t('loading')}</div>
        </div>
        <div class="card">
            <div class="card-title">${BSC_L('范围得分对比', '範圍得分對比', 'Score by Scope')}</div>
            <div id="bscBuTable">${t('loading')}</div>
        </div>
    `;
    document.getElementById('bscBu').value = Strategy.bu;
    document.getElementById('bscYear').value = Strategy.year;
    await Strategy.load();
});

const Strategy = {
    bu: 'GROUP',
    year: String(State.year()),
    data: null,

    async reload() {
        const buEl = document.getElementById('bscBu');
        const yEl = document.getElementById('bscYear');
        this.bu = buEl ? buEl.value : 'GROUP';
        const y = yEl ? String(yEl.value || '').trim() : '';
        if (/^\d{4}$/.test(y)) this.year = y;
        await this.load();
    },

    async load() {
        const box = document.getElementById('bscTable');
        if (box) box.innerHTML = t('loading');
        try {
            let url = `/api/strategy/overview?YYYY=${encodeURIComponent(this.year)}`;
            if (this.bu && this.bu !== 'ALL') url += `&bu_no=${encodeURIComponent(this.bu)}`;
            const res = await API.get(url);
            this.data = res.data;
            this.year = res.data.YYYY;
            const yEl = document.getElementById('bscYear');
            if (yEl) yEl.value = this.year;
            this.render();
        } catch (e) {
            if (box) box.innerHTML = `<p style="color:#e74c3c">${bscEsc(e.message)}</p>`;
        }
    },

    render() {
        this.renderKpis();
        this.renderPerspectives();
        this.renderDeviations();
        this.renderTable();
        this.renderTree();
        this.renderBuTable();
    },

    statusHtml(status) {
        const s = BSC_STATUS[status] || BSC_STATUS.PENDING;
        return `<span style="color:${s.color};font-weight:600;">● ${s.label}</span>`;
    },

    renderKpis() {
        const total = this.data.total || {};
        const cards = [
            [BSC_L('总分（加权达成率）', '總分（加權達成率）', 'Total (Weighted Achievement)'), total.achievement == null ? '-' : `${UI.fmt(total.achievement, 1)} %`, '#2c3e50'],
            [BSC_L('权重合计', '權重合計', 'Total Weight'), `${UI.fmt(total.weight, 1)} %`, Number(total.weight) === 100 ? '#27ae60' : '#e67e22'],
            [BSC_L('目标数', '目標數', 'Objectives'), `${total.count || 0} ${BSC_L('项', '項', 'items')}`, '#2980b9'],
            [BSC_L('达标', '達標', 'On Track'), `${total.on_track || 0} ${BSC_L('项', '項', 'items')}`, '#27ae60'],
            [BSC_L('预警', '預警', 'Warning'), `${total.warning || 0} ${BSC_L('项', '項', 'items')}`, '#f39c12'],
            [BSC_L('落后', '落後', 'Lagging'), `${total.lagging || 0} ${BSC_L('项', '項', 'items')}`, '#e74c3c'],
            [BSC_L('未录入', '未錄入', 'Not Entered'), `${total.pending || 0} ${BSC_L('项', '項', 'items')}`, '#95a5a6']
        ];
        document.getElementById('bscKpi').innerHTML = cards.map(([label, val, color]) => `
            <div class="card" style="margin:0;padding:14px;">
                <div style="font-size:12px;color:#7f8c8d;">${label}</div>
                <div style="font-size:22px;font-weight:700;color:${color};margin-top:4px;">${val}</div>
            </div>`).join('');
    },

    renderPerspectives() {
        const el = document.getElementById('bscPerspectives');
        const list = this.data.perspectives || [];
        el.innerHTML = list.map(p => {
            const color = p.achievement == null ? '#95a5a6'
                : (p.achievement >= 100 ? '#27ae60' : (p.achievement >= 80 ? '#f39c12' : '#e74c3c'));
            return `<div class="card" style="margin:0;padding:14px;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div style="font-size:13px;font-weight:600;">${BSC_PERSPECTIVES[p.key] || p.key}</div>
                    <div style="font-size:12px;color:#7f8c8d;">${p.count} ${BSC_L('项', '項', 'items')} · ${BSC_L('权重', '權重', 'Weight')} ${UI.fmt(p.weight, 0)}%</div>
                </div>
                <div style="font-size:24px;font-weight:700;color:${color};margin-top:6px;">
                    ${p.achievement == null ? '-' : UI.fmt(p.achievement, 1)}<span style="font-size:13px;"> %</span>
                </div>
                <div style="font-size:12px;color:#7f8c8d;margin-top:2px;">${BSC_L('得分', '得分', 'Score')} ${UI.fmt(p.score, 1)}</div>
            </div>`;
        }).join('');
    },

    renderDeviations() {
        const rows = this.data.deviations || [];
        const el = document.getElementById('bscDeviation');
        if (!rows.length) {
            el.innerHTML = `<div style="background:#eafaf1;border-left:4px solid #27ae60;padding:10px 12px;border-radius:6px;margin-bottom:12px;font-size:13px;">${BSC_L('✅ 当前无偏差目标（无未达标项）', '✅ 當前無偏差目標（無未達標項）', '✅ No deviating objectives (none below target)')}</div>`;
            return;
        }
        el.innerHTML = `
            <div class="card" style="margin-bottom:14px;">
                <div class="card-title">${BSC_L('偏差分析（未达标 TOP', '偏差分析（未達標 TOP', 'Deviation Analysis (Below Target TOP')} ${rows.length}${BSC_L('）', '）', ')')}</div>
                <div style="overflow-x:auto;">
                <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead><tr style="background:#f8f9fa;">
                        <th style="padding:8px;border:1px solid #eee;">${BSC_L('目标', '目標', 'Objective')}</th>
                        <th style="padding:8px;border:1px solid #eee;">${BSC_L('维度', '維度', 'Perspective')}</th>
                        <th style="padding:8px;border:1px solid #eee;">${BSC_L('层级', '層級', 'Level')}</th>
                        <th style="padding:8px;border:1px solid #eee;text-align:right;">${BSC_L('目标值', '目標值', 'Target')}</th>
                        <th style="padding:8px;border:1px solid #eee;text-align:right;">${BSC_L('最新实际', '最新實際', 'Latest Actual')}</th>
                        <th style="padding:8px;border:1px solid #eee;text-align:right;">${BSC_L('缺口', '缺口', 'Gap')}</th>
                        <th style="padding:8px;border:1px solid #eee;text-align:right;">${BSC_L('达成率', '達成率', 'Achievement')}</th>
                        <th style="padding:8px;border:1px solid #eee;">${BSC_L('状态', '狀態', 'Status')}</th>
                    </tr></thead>
                    <tbody>
                        ${rows.map(r => `<tr>
                            <td style="padding:8px;border:1px solid #eee;">${bscEsc(r.objective_name)}</td>
                            <td style="padding:8px;border:1px solid #eee;">${BSC_PERSPECTIVES[r.perspective] || r.perspective}</td>
                            <td style="padding:8px;border:1px solid #eee;">${BSC_LEVELS[r.level] || r.level}</td>
                            <td style="padding:8px;border:1px solid #eee;text-align:right;">${UI.fmt(r.target_value)} ${bscEsc(r.unit || '')}</td>
                            <td style="padding:8px;border:1px solid #eee;text-align:right;">${UI.fmt(r.actual_value)} ${bscEsc(r.unit || '')}</td>
                            <td style="padding:8px;border:1px solid #eee;text-align:right;color:#e74c3c;">${UI.fmt(r.gap)}</td>
                            <td style="padding:8px;border:1px solid #eee;text-align:right;font-weight:600;">${UI.fmt(r.achievement, 1)} %</td>
                            <td style="padding:8px;border:1px solid #eee;">${this.statusHtml(r.status)}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
                </div>
            </div>`;
    },

    renderTable() {
        const rows = this.data.objectives || [];
        const el = document.getElementById('bscTable');
        if (!rows.length) {
            el.innerHTML = UI.empty('🎯', BSC_L('当前范围尚无战略目标，可点击「新增目标」建立公司级目标', '當前範圍尚無戰略目標，可點擊「新增目標」建立公司級目標', 'No strategic objectives in current scope; click "New Objective" to add a company-level objective'));
            return;
        }
        const cell = 'padding:8px;border:1px solid #eee;';
        const sections = Object.keys(BSC_PERSPECTIVES).map(key => {
            const list = rows.filter(r => r.perspective === key);
            if (!list.length) return '';
            return `
                <tr><td colspan="14" style="padding:8px;border:1px solid #eee;background:#f4f6f8;font-weight:600;">
                    ${BSC_PERSPECTIVES[key]}${BSC_L(`（${list.length} 项）`, `（${list.length} 項）`, ` (${list.length} items)`)}
                </td></tr>
                ${list.map(r => `<tr>
                    <td style="${cell}">${BSC_LEVELS[r.level] || r.level}</td>
                    <td style="${cell}">${bscEsc(r.bu_no)}</td>
                    <td style="${cell}">
                        <div style="font-weight:600;">${bscEsc(r.objective_name)}</div>
                        ${r.scope_name || r.owner_id ? `<div style="font-size:12px;color:#7f8c8d;">${bscEsc(r.scope_name || '')}${r.owner_id ? ' · ' + bscEsc(r.owner_id) : ''}</div>` : ''}
                    </td>
                    <td style="${cell}">${bscEsc(r.metric_name || '-')}${r.kpi_id ? `<div style="font-size:11px;color:#8e44ad;">KPI: ${bscEsc(r.kpi_id)}</div>` : ''}</td>
                    <td style="${cell}text-align:right;">${UI.fmt(r.weight, 1)} %</td>
                    <td style="${cell}text-align:right;">${UI.fmt(r.baseline_value)}</td>
                    <td style="${cell}text-align:right;">${UI.fmt(r.target_value)} ${bscEsc(r.unit || '')}</td>
                    <td style="${cell}text-align:right;font-weight:600;">${r.actual_value == null ? '-' : UI.fmt(r.actual_value)} ${r.actual_value == null ? '' : bscEsc(r.unit || '')}</td>
                    <td style="${cell}color:#7f8c8d;">${bscEsc(r.period || '-')}</td>
                    <td style="${cell}text-align:right;">${r.achievement == null ? '-' : UI.fmt(r.achievement, 1) + ' %'}</td>
                    <td style="${cell}text-align:right;">${UI.fmt(r.score, 1)}</td>
                    <td style="${cell}">${this.statusHtml(r.status)}</td>
                    <td style="${cell}text-align:right;color:${r.gap == null ? '#7f8c8d' : (r.gap >= 0 ? '#27ae60' : '#e74c3c')};">
                        ${r.gap == null ? '-' : (r.gap > 0 ? '+' : '') + UI.fmt(r.gap)}
                    </td>
                    <td style="${cell}white-space:nowrap;">
                        <button class="btn btn-sm btn-outline" onclick="Strategy.editProgress(${r.objective_id})">${BSC_L('进度', '進度', 'Progress')}</button>
                        <button class="btn btn-sm btn-outline" onclick="Strategy.editObjective(${r.objective_id})">${BSC_L('编辑', '編輯', 'Edit')}</button>
                        <button class="btn btn-sm btn-danger" onclick="Strategy.delObjective(${r.objective_id})">${BSC_L('删除', '刪除', 'Delete')}</button>
                    </td>
                </tr>`).join('')}`;
        }).join('');

        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#f8f9fa;">
                    <th style="padding:8px;border:1px solid #eee;">${BSC_L('层级', '層級', 'Level')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${BSC_L('范围', '範圍', 'Scope')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${BSC_L('目标', '目標', 'Objective')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${BSC_L('指标', '指標', 'Metric')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${BSC_L('权重', '權重', 'Weight')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${BSC_L('基线', '基線', 'Baseline')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${BSC_L('目标值', '目標值', 'Target')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${BSC_L('最新实际', '最新實際', 'Latest Actual')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${BSC_L('期间', '期間', 'Period')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${BSC_L('达成率', '達成率', 'Achievement')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${BSC_L('得分', '得分', 'Score')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${BSC_L('状态', '狀態', 'Status')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${BSC_L('偏差', '偏差', 'Deviation')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${BSC_L('操作', '操作', 'Actions')}</th>
                </tr></thead>
                <tbody>${sections}</tbody>
            </table>
            </div>`;
    },

    renderTree() {
        const nodes = this.data.tree || [];
        const el = document.getElementById('bscTree');
        if (!nodes.length) { el.innerHTML = UI.empty('🌳', BSC_L('尚无目标层级，建立目标后可通过「上级目标」串联公司→部门→个人', '尚無目標層級，建立目標後可透過「上級目標」串聯公司→部門→個人', 'No hierarchy yet; link Company→Dept→Individual via "Parent Objective" after creating objectives')); return; }

        const levelBadge = (lv) => {
            const map = {
                COMPANY: ['#2980b9', '#eaf2f8'],
                DEPARTMENT: ['#8e44ad', '#f4ecf7'],
                PERSONAL: ['#16a085', '#e8f8f5']
            };
            const m = map[lv] || ['#7f8c8d', '#f4f6f8'];
            return `<span style="font-size:11px;padding:1px 6px;border-radius:10px;color:${m[0]};background:${m[1]};">${BSC_LEVELS[lv] || lv}</span>`;
        };
        const rowOf = (node, depth) => `
            <div style="padding:8px 10px;border-bottom:1px solid #f1f1f1;display:flex;gap:10px;align-items:center;padding-left:${12 + depth * 24}px;">
                <span style="color:#bdc3c7;">${depth ? '└' : '▣'}</span>
                ${levelBadge(node.level)}
                <span style="font-weight:600;flex:1;">${bscEsc(node.objective_name)}</span>
                <span style="font-size:12px;color:#7f8c8d;">${bscEsc(node.metric_name || '')}</span>
                <span style="font-size:12px;color:#7f8c8d;">${BSC_L('权重', '權重', 'Weight')} ${UI.fmt(node.weight, 1)}%</span>
                <span style="font-size:12px;">${this.statusHtml(node.status)}</span>
                <span style="font-size:13px;font-weight:700;min-width:64px;text-align:right;color:${node.achievement == null ? '#95a5a6' : (node.achievement >= 100 ? '#27ae60' : (node.achievement >= 80 ? '#f39c12' : '#e74c3c'))};">
                    ${node.achievement == null ? '-' : UI.fmt(node.achievement, 1) + ' %'}
                </span>
            </div>
            ${(node.children || []).map(ch => rowOf(ch, depth + 1)).join('')}`;

        el.innerHTML = `<div>${nodes.map(nd => rowOf(nd, 0)).join('')}</div>`;
    },

    renderBuTable() {
        const rows = (this.data.bu_scores || []).filter(r => r.count > 0);
        const el = document.getElementById('bscBuTable');
        if (!rows.length) { el.innerHTML = UI.empty('🏢', BSC_L('尚无数据', '尚無資料', 'No data')); return; }
        const cell = 'padding:8px;border:1px solid #eee;';
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#f8f9fa;">
                    <th style="padding:8px;border:1px solid #eee;">${BSC_L('范围', '範圍', 'Scope')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${BSC_L('目标数', '目標數', 'Objectives')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${BSC_L('权重', '權重', 'Weight')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${BSC_L('得分', '得分', 'Score')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${BSC_L('达成率', '達成率', 'Achievement')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:center;">${BSC_L('达标', '達標', 'On Track')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:center;">${BSC_L('预警', '預警', 'Warning')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:center;">${BSC_L('落后', '落後', 'Lagging')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:center;">${BSC_L('未录入', '未錄入', 'Not Entered')}</th>
                </tr></thead>
                <tbody>
                    ${rows.map(r => `<tr>
                        <td style="${cell}font-weight:600;">${r.bu_no}</td>
                        <td style="${cell}text-align:right;">${r.count}</td>
                        <td style="${cell}text-align:right;">${UI.fmt(r.weight, 1)} %</td>
                        <td style="${cell}text-align:right;">${UI.fmt(r.score, 1)}</td>
                        <td style="${cell}text-align:right;font-weight:600;">${r.achievement == null ? '-' : UI.fmt(r.achievement, 1) + ' %'}</td>
                        <td style="${cell}text-align:center;color:#27ae60;">${r.on_track}</td>
                        <td style="${cell}text-align:center;color:#f39c12;">${r.warning}</td>
                        <td style="${cell}text-align:center;color:#e74c3c;">${r.lagging}</td>
                        <td style="${cell}text-align:center;color:#95a5a6;">${r.pending}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
    },

    // ===== 目标编辑 =====
    editObjective(id) {
        const list = (this.data && this.data.objectives) || [];
        const it = id ? list.find(x => x.objective_id === id) : null;
        const v = (k, dft = '') => it && it[k] != null ? it[k] : dft;
        const opts = (map, cur) => Object.entries(map).map(([k, label]) =>
            `<option value="${k}" ${String(cur) === k ? 'selected' : ''}>${label}</option>`).join('');
        const buOpts = ['GROUP'].concat(['HM', 'HN', 'SZ'])
            .map(b => `<option value="${b}" ${String(v('bu_no', 'GROUP')) === b ? 'selected' : ''}>${b}</option>`).join('');
        const parentOpts = [`<option value="">${BSC_L('（无，作为顶级目标）', '（無，作為頂級目標）', '(None, top-level objective)')}</option>`].concat(
            list.filter(x => x.objective_id !== id)
                .map(x => `<option value="${x.objective_id}" ${Number(v('parent_id')) === x.objective_id ? 'selected' : ''}>[${BSC_LEVELS[x.level] || x.level}] ${bscEsc(x.objective_name)}</option>`)
        ).join('');

        UI.modal(it ? BSC_L('编辑战略目标', '編輯戰略目標', 'Edit Objective') : BSC_L('新增战略目标', '新增戰略目標', 'New Objective'), `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;min-width:560px;">
                <div><label class="form-label">${BSC_L('年度', '年度', 'Year')}</label><input id="bscFYear" type="number" min="2000" max="2100" class="form-control" value="${v('fiscal_year', this.year)}"></div>
                <div><label class="form-label">${BSC_L('层级', '層級', 'Level')}</label><select id="bscFLevel" class="form-control">${opts(BSC_LEVELS, v('level', 'COMPANY'))}</select></div>
                <div><label class="form-label">${BSC_L('范围（GROUP=集团）', '範圍（GROUP=集團）', 'Scope (GROUP=Group)')}</label><select id="bscFBu" class="form-control">${buOpts}</select></div>
                <div><label class="form-label">${BSC_L('维度', '維度', 'Perspective')}</label><select id="bscFPersp" class="form-control">${opts(BSC_PERSPECTIVES, v('perspective', 'FINANCIAL'))}</select></div>
                <div style="grid-column:1 / span 2;"><label class="form-label">${BSC_L('目标名称', '目標名稱', 'Objective Name')}</label><input id="bscFName" class="form-control" value="${bscEsc(v('objective_name'))}"></div>
                <div><label class="form-label">${BSC_L('衡量指标', '衡量指標', 'Metric')}</label><input id="bscFMetric" class="form-control" value="${bscEsc(v('metric_name'))}"></div>
                <div><label class="form-label">${BSC_L('单位', '單位', 'Unit')}</label><input id="bscFUnit" class="form-control" placeholder="${BSC_L('如 % / 万元 / 天', '如 % / 萬元 / 天', 'e.g. % / 10k CNY / days')}" value="${bscEsc(v('unit'))}"></div>
                <div><label class="form-label">${BSC_L('指标方向', '指標方向', 'Direction')}</label><select id="bscFDir" class="form-control">${opts(BSC_DIRECTIONS, v('metric_direction', 'UP'))}</select></div>
                <div><label class="form-label">${BSC_L('权重（%）', '權重（%）', 'Weight (%)')}</label><input id="bscFWeight" type="number" step="0.01" min="0" max="100" class="form-control" value="${v('weight', '')}"></div>
                <div><label class="form-label">${BSC_L('基线值', '基線值', 'Baseline')}</label><input id="bscFBase" type="number" step="0.01" class="form-control" value="${v('baseline_value', '')}"></div>
                <div><label class="form-label">${BSC_L('目标值', '目標值', 'Target')}</label><input id="bscFTarget" type="number" step="0.01" class="form-control" value="${v('target_value', '')}"></div>
                <div><label class="form-label">${BSC_L('KPI 编码（可自动同步）', 'KPI 編碼（可自動同步）', 'KPI Code (auto-sync)')}</label>
                    <input id="bscFKpi" class="form-control" list="bscKpiList" placeholder="${BSC_L('留空=仅手工录入', '留空=僅手工錄入', 'Empty = manual entry only')}" value="${bscEsc(v('kpi_id'))}">
                    <datalist id="bscKpiList">${BSC_KPI_IDS.map(k => `<option value="${k}"></option>`).join('')}</datalist>
                </div>
                <div><label class="form-label">${BSC_L('归属部门/个人', '歸屬部門/個人', 'Dept/Owner')}</label><input id="bscFScope" class="form-control" value="${bscEsc(v('scope_name'))}"></div>
                <div><label class="form-label">${BSC_L('责任人', '責任人', 'Owner')}</label><input id="bscFOwner" class="form-control" value="${bscEsc(v('owner_id'))}"></div>
                <div><label class="form-label">${BSC_L('上级目标', '上級目標', 'Parent Objective')}</label><select id="bscFParent" class="form-control">${parentOpts}</select></div>
                <div style="grid-column:1 / span 2;"><label class="form-label">${BSC_L('备注', '備註', 'Remark')}</label><input id="bscFRmk" class="form-control" value="${bscEsc(v('remark'))}"></div>
            </div>`,
            `<button class="btn btn-outline" onclick="UI.closeModal()">${BSC_L('取消', '取消', 'Cancel')}</button>
             <button class="btn btn-primary" onclick="Strategy.saveObjective(${id || 0})">${BSC_L('保存', '儲存', 'Save')}</button>`);
    },

    async saveObjective(id) {
        const body = {
            fiscal_year: document.getElementById('bscFYear').value,
            level: document.getElementById('bscFLevel').value,
            bu_no: document.getElementById('bscFBu').value,
            perspective: document.getElementById('bscFPersp').value,
            objective_name: document.getElementById('bscFName').value,
            metric_name: document.getElementById('bscFMetric').value,
            unit: document.getElementById('bscFUnit').value,
            metric_direction: document.getElementById('bscFDir').value,
            weight: document.getElementById('bscFWeight').value,
            baseline_value: document.getElementById('bscFBase').value,
            target_value: document.getElementById('bscFTarget').value,
            kpi_id: document.getElementById('bscFKpi').value,
            scope_name: document.getElementById('bscFScope').value,
            owner_id: document.getElementById('bscFOwner').value,
            parent_id: document.getElementById('bscFParent').value,
            remark: document.getElementById('bscFRmk').value
        };
        try {
            if (id) await API.put(`/api/strategy/objectives/${id}`, body);
            else await API.post('/api/strategy/objectives', body);
            UI.closeModal(); UI.toast(BSC_L('已保存', '已儲存', 'Saved'), 'success');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async delObjective(id) {
        if (!confirm(BSC_L('确认删除该目标？其下级目标将上提为顶级目标。', '確認刪除該目標？其下級目標將上提為頂級目標。', 'Delete this objective? Its child objectives will be promoted to top level.'))) return;
        try {
            await API.del(`/api/strategy/objectives/${id}`);
            UI.toast(BSC_L('已删除', '已刪除', 'Deleted'), 'success');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ===== 进度录入 =====
    editProgress(id) {
        const list = (this.data && this.data.objectives) || [];
        const it = list.find(x => x.objective_id === id);
        if (!it) return;
        const dftPeriod = `${it.fiscal_year}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        const curPeriod = it.period || dftPeriod;
        UI.modal(`${BSC_L('录入进度', '錄入進度', 'Update Progress')} · ${bscEsc(it.objective_name)}`, `
            <div style="min-width:460px;">
                <div style="background:#f4f6f8;padding:8px 10px;border-radius:6px;font-size:12px;color:#5d6d7e;margin-bottom:10px;">
                    ${BSC_L('指标：', '指標：', 'Metric: ')}${bscEsc(it.metric_name || '-')} · ${BSC_L('方向：', '方向：', 'Direction: ')}${BSC_DIRECTIONS[it.metric_direction] || it.metric_direction}
                    · ${BSC_L('基线：', '基線：', 'Baseline: ')}${UI.fmt(it.baseline_value)} · ${BSC_L('目标：', '目標：', 'Target: ')}${UI.fmt(it.target_value)} ${bscEsc(it.unit || '')}
                    · ${BSC_L('权重：', '權重：', 'Weight: ')}${UI.fmt(it.weight, 1)}%
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <div><label class="form-label">${BSC_L('期间', '期間', 'Period')}</label><input id="bscPPeriod" type="month" class="form-control" value="${curPeriod}"></div>
                    <div><label class="form-label">${BSC_L('实际值', '實際值', 'Actual')}</label><input id="bscPActual" type="number" step="0.01" class="form-control" value="${it.actual_value == null ? '' : it.actual_value}"></div>
                    <div style="grid-column:1 / span 2;"><label class="form-label">${BSC_L('备注', '備註', 'Remark')}</label><input id="bscPNote" class="form-control" value="${bscEsc(it.note || '')}"></div>
                </div>
                <div id="bscPHistory" style="margin-top:10px;font-size:12px;color:#7f8c8d;">${t('loading')}</div>
            </div>`,
            `<button class="btn btn-outline" onclick="UI.closeModal()">${BSC_L('取消', '取消', 'Cancel')}</button>
             <button class="btn btn-primary" onclick="Strategy.saveProgress(${id})">${BSC_L('保存', '儲存', 'Save')}</button>`);
        this.loadProgressHistory(id);
    },

    async loadProgressHistory(id) {
        const el = document.getElementById('bscPHistory');
        if (!el) return;
        try {
            const res = await API.get(`/api/strategy/objectives/${id}/progress`);
            const rows = (res.data && res.data.rows) || [];
            if (!rows.length) { el.innerHTML = BSC_L('暂无历史进度', '暫無歷史進度', 'No progress history'); return; }
            el.innerHTML = `
                <div style="margin-bottom:4px;font-weight:600;color:#5d6d7e;">${BSC_L('历史进度', '歷史進度', 'Progress History')}</div>
                <div style="max-height:180px;overflow:auto;">
                <table style="width:100%;border-collapse:collapse;">
                    <thead><tr style="background:#f8f9fa;">
                        <th style="padding:4px 6px;border:1px solid #eee;text-align:left;">${BSC_L('期间', '期間', 'Period')}</th>
                        <th style="padding:4px 6px;border:1px solid #eee;text-align:right;">${BSC_L('实际值', '實際值', 'Actual')}</th>
                        <th style="padding:4px 6px;border:1px solid #eee;text-align:right;">${BSC_L('达成率', '達成率', 'Achievement')}</th>
                        <th style="padding:4px 6px;border:1px solid #eee;text-align:left;">${BSC_L('来源', '來源', 'Source')}</th>
                    </tr></thead>
                    <tbody>
                        ${rows.slice().reverse().map(p => `<tr>
                            <td style="padding:4px 6px;border:1px solid #eee;">${bscEsc(p.period)}</td>
                            <td style="padding:4px 6px;border:1px solid #eee;text-align:right;">${UI.fmt(p.actual_value)}</td>
                            <td style="padding:4px 6px;border:1px solid #eee;text-align:right;">${p.achievement == null ? '-' : UI.fmt(p.achievement, 1) + ' %'}</td>
                            <td style="padding:4px 6px;border:1px solid #eee;">${p.source === 'KPI' ? BSC_L('指标中心', '指標中心', 'KPI Center') : BSC_L('手工', '手工', 'Manual')}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
                </div>`;
        } catch (e) {
            el.innerHTML = `<span style="color:#e74c3c">${bscEsc(e.message)}</span>`;
        }
    },

    async saveProgress(id) {
        const body = {
            period: document.getElementById('bscPPeriod').value,
            actual_value: document.getElementById('bscPActual').value,
            note: document.getElementById('bscPNote').value
        };
        try {
            await API.post(`/api/strategy/objectives/${id}/progress`, body);
            UI.closeModal(); UI.toast(BSC_L('进度已保存', '進度已儲存', 'Progress saved'), 'success');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async sync() {
        try {
            const res = await API.post('/api/strategy/sync', {
                YYYY: this.year,
                bu_no: this.bu === 'ALL' ? '' : this.bu
            });
            const d = res.data || {};
            UI.toast(`${BSC_L('同步完成：成功', '同步完成：成功', 'Sync completed: ')} ${d.synced || 0} ${BSC_L('项，跳过', '項，跳過', 'synced,')} ${d.skipped || 0} ${BSC_L('项', '項', 'skipped')}`, d.synced ? 'success' : 'info');
            if ((d.warnings || []).length) UI.toast(d.warnings.slice(0, 3).join(BSC_L('；', '；', '; ')), 'info');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async scanAlerts() {
        try {
            const res = await API.post('/api/strategy/alerts/scan', {
                YYYY: this.year,
                bu_no: this.bu === 'ALL' ? '' : this.bu
            });
            const d = res.data || {};
            const msg = d.triggered
                ? BSC_L(`已生成 ${d.triggered} 条目标偏差预警`, `已產生 ${d.triggered} 條目標偏差預警`, `${d.triggered} deviation alert(s) created`)
                : BSC_L('未发现新的目标偏差', '未發現新的目標偏差', 'No new target deviations');
            UI.toast(msg, d.triggered ? 'success' : 'info');
            if (d.suppressed) {
                UI.toast(BSC_L(`${d.suppressed} 条处于冷却期，已跳过`, `${d.suppressed} 條處於冷卻期，已跳過`, `${d.suppressed} suppressed by cooldown`), 'info');
            }
            if (d.triggered) await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};
