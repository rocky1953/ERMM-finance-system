/**
 * 銷售預估訂單頁面（含客戶→專案自動帶出 listbox）
 */
/**
 * 比較圖數據標籤插件（柱頂顯示金額）
 */
const preCmpLabelPlugin = {
    id: 'preCmpLabel',
    afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        const fmt = (v) => {
            const n = Number(v) || 0;
            const lang = (typeof I18N !== 'undefined' && I18N.lang) || 'zh-TW';
            if (lang === 'en') {
                if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
                if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
                if (Math.abs(n) >= 1e3) return Math.round(n / 1e3) + 'K';
                return n.toFixed(0);
            }
            const yi = lang === 'zh-TW' ? '億' : '亿';
            const wan = lang === 'zh-TW' ? '萬' : '万';
            if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + yi;
            if (Math.abs(n) >= 1e4) return Math.round(n / 1e4) + wan;
            return n.toFixed(0);
        };
        ctx.save();
        ctx.font = '10px "PingFang SC","Microsoft YaHei",sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        chart.data.datasets.forEach((ds, di) => {
            if (ds.type === 'line') return;
            const meta = chart.getDatasetMeta(di);
            ctx.fillStyle = ds.labelColor || '#52525B';
            meta.data.forEach((bar, i) => {
                const v = Number(ds.data[i] || 0);
                if (!v) return;
                ctx.fillText(fmt(v), bar.x, bar.y - 3);
            });
        });
        ctx.restore();
    }
};

registerPage('preorder', async (c) => {
    c.innerHTML = `
        <div class="card" style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
                <div class="card-title" style="margin:0;">📊 ${t('cmp.title')}</div>
                <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;" id="cmpYearTabs">
                    <span style="font-size:11px;color:#7f8c8d;">${t('cmp.start_year')}</span>
                    <select id="cmpStartYear" class="cmp-year-sel" onchange="CmpChart.onRangeChange()">
                        ${Array.from({ length: 11 }, (_, i) => 2020 + i)
                            .map(y => `<option value="${y}"${y === 2023 ? ' selected' : ''}>${y}</option>`).join('')}
                    </select>
                    <span style="font-size:11px;color:#7f8c8d;">${t('cmp.end_year')}</span>
                    <select id="cmpEndYear" class="cmp-year-sel" onchange="CmpChart.onRangeChange()">
                        ${Array.from({ length: 11 }, (_, i) => 2020 + i)
                            .map(y => `<option value="${y}"${y === 2025 ? ' selected' : ''}>${y}</option>`).join('')}
                    </select>
                    <span id="cmpRange" style="font-size:12px;font-weight:700;color:#1a3c5e;margin-left:4px;">2023~2025</span>
                </div>
            </div>
            <div id="cmpViewBar" style="display:none;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:12px;">
                <button class="btn btn-sm" onclick="CmpChart.backToYears()">← ${t('cmp.back_years')}</button>
                <span id="cmpViewTitle" style="font-weight:700;color:#2c3e50;"></span>
            </div>
            <div class="cmp-box"><canvas id="cmpChart"></canvas></div>
            <div class="cmp-summary" id="cmpSummary"></div>
            <div style="font-size:11px;color:#94a3b8;margin-top:4px;">💡 ${t('cmp.click_hint')}</div>
            <div id="cmpDetail" style="display:none;margin-top:12px;"></div>
        </div>
        <div class="card">
            <div class="toolbar" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                <button class="btn btn-primary" onclick="PreorderForm.open()">➕ ${t('pre.add')}</button>
                <button class="btn btn-success" onclick="loadPreorders()">🔄 ${t('pre.refresh')}</button>
                <select id="preYear" onchange="loadPreorders()" style="margin-left:auto;">
                    <option value="">${t('pre.all_year')}</option>
                    <option>2023</option><option>2024</option><option>2025</option><option>2026</option>
                </select>
                <select id="preStatus" onchange="loadPreorders()">
                    <option value="">${t('pre.all_status')}</option>
                    <option value="draft">${t('pre.status.draft')}</option>
                    <option value="confirmed">${t('pre.status.confirmed')}</option>
                    <option value="won">${t('pre.status.won')}</option>
                    <option value="lost">${t('pre.status.lost')}</option>
                    <option value="cancelled">${t('pre.status.cancelled')}</option>
                </select>
            </div>
            <div id="preTable">${t('loading')}</div>
        </div>
        <style>
        .pre-custwrap{position:relative;}
        .pre-listbox{position:absolute;z-index:10050;left:0;right:0;max-height:220px;overflow-y:auto;background:#fff;border:1px solid #cbd5e1;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.15);margin-top:2px;}
        .pre-listbox .opt{padding:8px 12px;cursor:pointer;font-size:13px;display:flex;justify-content:space-between;gap:8px;}
        .pre-listbox .opt:hover,.pre-listbox .opt.active{background:#eff6ff;}
        .pre-listbox .opt .cid{color:#94a3b8;font-size:12px;}
        .cmp-tab{background:#fff;border:1px solid #cbd5e1;color:#475569;}
        .cmp-tab.active{background:#1a3c5e;border-color:#1a3c5e;color:#fff;}
        .cmp-year-sel{padding:4px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;background:#fff;color:#2c3e50;outline:none;}
        .cmp-year-sel:focus{border-color:#1a3c5e;}
        .cmp-box{position:relative;width:100%;height:280px;min-width:0;}
        .cmp-box canvas{display:block;}
        .cmp-summary{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:6px;font-size:11px;line-height:1.3;color:#7f8c8d;}
        .cmp-summary span{display:inline-flex;align-items:center;gap:4px;white-space:nowrap;}
        .cmp-summary i{display:inline-block;width:9px;height:9px;border-radius:2px;}
        .cmp-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}
        @media (max-width:900px){.cmp-detail-grid{grid-template-columns:minmax(0,1fr);}}
        .cmp-detail-head{display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:700;color:#2c3e50;margin-bottom:6px;}
        .cmp-detail-wrap{max-height:280px;overflow:auto;border:1px solid #ecf0f1;border-radius:8px;}
        .cmp-detail-wrap table{margin:0;font-size:12px;min-width:100%;}
        .cmp-detail-wrap table th,.cmp-detail-wrap table td{white-space:nowrap;padding:6px 8px;}
        .cmp-detail-wrap thead th{position:sticky;top:0;background:#f8f9fa;z-index:1;}
        </style>
    `;
    loadPreorders();
    // 延遲至腳本定義完成後再初始化圖表（避免自動導航時 CmpChart 尚未定義）
    setTimeout(() => CmpChart.init(), 0);
});

function preStatusBadge(s) {
    const map = { draft: '#f1f5f9|#475569', confirmed: '#dbeafe|#1d4ed8', won: '#dcfce7|#166534', lost: '#fee2e2|#b91c1c', cancelled: '#e2e8f0|#64748b' };
    const [bg, fg] = (map[s] || map.draft).split('|');
    return `<span style="padding:2px 10px;border-radius:10px;background:${bg};color:${fg};font-size:12px">${t('pre.status.' + (s || 'draft'))}</span>`;
}

async function loadPreorders() {
    const el = document.getElementById('preTable');
    try {
        const year = document.getElementById('preYear')?.value || '';
        const status = document.getElementById('preStatus')?.value || '';
        const res = await API.get(`/api/preorders?year=${encodeURIComponent(year)}&status=${encodeURIComponent(status)}`);
        const rows = res.data || [];
        if (!rows.length) { el.innerHTML = UI.empty('📋', t('pre.no_data')); return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>${t('pre.col.id')}</th><th>${t('pre.col.date')}</th><th>${t('pre.col.user')}</th>
                <th>${t('pre.col.customer')}</th><th>${t('pre.col.project')}</th>
                <th class="num">${t('pre.col.amt')}</th><th>${t('pre.col.status')}</th><th>${t('pre.col.remark')}</th>
                <th style="width:110px">${t('pre.col.action')}</th>
            </tr></thead>
            <tbody>${rows.map(r => `<tr>
                <td><b>${r.preorder_Id}</b></td>
                <td>${(r.order_date || '').substring(0, 10)}</td>
                <td>${r.user_name || r.user_id || '-'}</td>
                <td>${r.customer_id}</td>
                <td>${r.project_id} ${r.project_name || ''}</td>
                <td class="num positive">${UI.fmt(r.order_amt)}</td>
                <td>${preStatusBadge(r.status)}</td>
                <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${(r.remark || '').replace(/"/g, '&quot;')}">${r.remark || ''}</td>
                <td>
                    <button class="btn btn-primary btn-sm" onclick='editPreorder(${JSON.stringify(r).replace(/'/g, "&#39;")})'>✏️</button>
                    <button class="btn btn-danger btn-sm" onclick="delPreorder(${r.uid})">🗑</button>
                </td>
            </tr>`).join('')}</tbody>
        </table>`;
    } catch (e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

function editPreorder(r) {
    PreorderForm._uid = r.uid;
    PreorderForm._preorderId = r.preorder_Id;
    PreorderForm.open(r);
}

const PreorderForm = {
    _uid: null,
    _preorderId: null,
    _custTimer: null,
    _custSelected: null,

    open(d) {
        d = d || {};
        this._custSelected = d.customer_id ? { customer_id: d.customer_id, customer_name: d.customer_id } : null;
        const statusOpts = ['draft', 'confirmed', 'won', 'lost', 'cancelled']
            .map(s => `<option value="${s}" ${d.status === s ? 'selected' : ''}>${t('pre.status.' + s)}</option>`).join('');
        UI.modal(this._uid ? `✏️ ${t('pre.form.title_edit')} ${this._preorderId || ''}` : `➕ ${t('pre.form.title_new')}`, `
            ${this._uid ? `<div class="form-row"><div class="form-group"><label>${t('pre.col.id')}</label><input value="${this._preorderId}" disabled></div></div>` : ''}
            <div class="form-row">
                <div class="form-group pre-custwrap">
                    <label>${t('pre.form.customer')}</label>
                    <input id="pre_fcust" autocomplete="off" placeholder="${t('pre.form.cust_hint')}"
                           value="${d.customer_id || ''}" oninput="PreorderForm.onCustInput()">
                    <div id="pre_cust_list"></div>
                </div>
                <div class="form-group">
                    <label>${t('pre.form.project')}</label>
                    <select id="pre_fproj" onchange="PreorderForm.onProjChange()">
                        <option value="">${t('pre.form.proj_hint')}</option>
                        ${d.project_id ? `<option value="${d.project_id}" data-pname="${(d.project_name || '').replace(/"/g, '&quot;')}" selected>${d.project_id} ${d.project_name || ''}</option>` : ''}
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('pre.form.amt')}</label><input type="number" id="pre_famt" value="${d.order_amt || 0}" step="0.01"></div>
                <div class="form-group"><label>${t('pre.form.date')}</label><input type="date" id="pre_fdate" value="${(d.order_date || '').substring(0, 10) || new Date().toISOString().slice(0, 10)}"></div>
                <div class="form-group"><label>${t('pre.form.status')}</label><select id="pre_fstat">${statusOpts}</select></div>
            </div>
            <div class="form-row">
                <div class="form-group" style="flex:1"><label>${t('pre.form.remark')}</label><input id="pre_frem" value="${(d.remark || '').replace(/"/g, '&quot;')}"></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">${t('so.btn.cancel')}</button>
            <button class="btn btn-primary" onclick="PreorderForm.save()">💾 ${t('so.btn.save')}</button>`);
        if (d.customer_id) this.loadProjects(d.customer_id, d.project_id);
    },

    // 客戶輸入 → 300ms 防抖後查詢 listbox
    onCustInput() {
        clearTimeout(this._custTimer);
        this._custSelected = null;
        const q = document.getElementById('pre_fcust').value.trim();
        const list = document.getElementById('pre_cust_list');
        if (q.length < 1) { list.innerHTML = ''; return; }
        this._custTimer = setTimeout(async () => {
            try {
                const res = await API.get(`/api/preorders/customers?q=${encodeURIComponent(q)}`);
                const rows = res.data || [];
                list.innerHTML = rows.length
                    ? `<div class="pre-listbox">${rows.map(r =>
                        `<div class="opt" onclick="PreorderForm.pickCustomer('${r.customer_id.replace(/'/g, "\\'")}')">
                            <span>${r.customer_name}</span><span class="cid">${r.customer_id}</span>
                        </div>`).join('')}</div>`
                    : `<div class="pre-listbox"><div class="opt" style="color:#94a3b8;cursor:default">${t('pre.no_cust')}</div></div>`;
            } catch { list.innerHTML = ''; }
        }, 300);
    },

    // 選定客戶 → 關閉 listbox 並載入該客戶專案
    async pickCustomer(customerId) {
        this._custSelected = { customer_id: customerId };
        document.getElementById('pre_fcust').value = customerId;
        document.getElementById('pre_cust_list').innerHTML = '';
        await this.loadProjects(customerId);
    },

    async loadProjects(customerId, selectedProjId) {
        const sel = document.getElementById('pre_fproj');
        sel.innerHTML = `<option value="">${t('loading')}…</option>`;
        try {
            const res = await API.get(`/api/preorders/customers/${encodeURIComponent(customerId)}/projects`);
            const rows = res.data || [];
            sel.innerHTML = `<option value="">${t('pre.form.proj_hint')}</option>` +
                rows.map(r => `<option value="${r.project_id}" data-pname="${(r.project_name || '').replace(/"/g, '&quot;')}"
                    ${r.project_id === selectedProjId ? 'selected' : ''}>${r.project_id} ${r.project_name}</option>`).join('');
        } catch {
            sel.innerHTML = `<option value="">${t('load_failed')}</option>`;
        }
    },

    onProjChange() { /* 專案名稱於儲存時由 data-pname 帶入 */ },

    async save() {
        const customerId = (this._custSelected && this._custSelected.customer_id)
            || document.getElementById('pre_fcust').value.trim();
        const projSel = document.getElementById('pre_fproj');
        const projOpt = projSel.options[projSel.selectedIndex];
        const body = {
            customer_id: customerId,
            project_id: projSel.value,
            project_name: projOpt ? (projOpt.dataset.pname || '') : '',
            order_amt: Number(document.getElementById('pre_famt').value) || 0,
            order_date: document.getElementById('pre_fdate').value || null,
            status: document.getElementById('pre_fstat').value,
            remark: document.getElementById('pre_frem').value
        };
        if (!body.customer_id || !body.project_id) { UI.toast(t('pre.form.need_cust_proj'), 'error'); return; }
        try {
            if (this._uid) {
                await API.put(`/api/preorders/${this._uid}`, body);
                UI.toast(t('so.msg.updated'), 'success');
            } else {
                const r = await API.post('/api/preorders', body);
                UI.toast(`${t('so.msg.added')} ${r.data && r.data.preorder_Id ? '(' + r.data.preorder_Id + ')' : ''}`, 'success');
            }
            UI.closeModal();
            this._uid = null; this._preorderId = null;
            loadPreorders();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};

async function delPreorder(uid) {
    if (!confirm(t('pre.confirm_del'))) return;
    try {
        await API.del(`/api/preorders/${uid}`);
        UI.toast(t('deleted'), 'success');
        loadPreorders();
    } catch (e) { UI.toast(e.message, 'error'); }
}

/* =====================================================================
 * 預估 vs 實際 比較分析圖
 * ===================================================================== */
const CmpChart = {
    chart: null,
    years: null,
    mode: 'years',    // years（年度对比）| months（单年月度）
    startYear: 2023,
    endYear: 2025,
    curYear: null,

    async init() {
        if (!document.getElementById('cmpChart')) return;
        try {
            await this.load();
        } catch (e) {
            const box = document.getElementById('cmpChart');
            if (box) box.parentElement.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`;
        }
    },

    async load() {
        const res = await API.get(`/api/preorders/comparison?yearFrom=${this.startYear}&yearTo=${this.endYear}`);
        this.years = (res.data && res.data.years) || [];
        const range = document.getElementById('cmpRange');
        if (range) range.textContent = `${this.startYear}~${this.endYear}`;
        this.render();
    },

    // 起始/結束年度變更 → 依所選區間重新查詢
    async onRangeChange() {
        let s = Number(document.getElementById('cmpStartYear').value);
        let e = Number(document.getElementById('cmpEndYear').value);
        // 起始不得大於結束；自動修正另一端
        if (s > e) {
            e = s;
            document.getElementById('cmpEndYear').value = String(e);
        }
        this.startYear = s;
        this.endYear = e;
        this.mode = 'years';
        this.curYear = null;
        this.hideDetail();
        try { await this.load(); } catch (err) { console.error(err); }
    },

    // 進入某年度的月度視圖
    enterYear(y) {
        this.mode = 'months';
        this.curYear = Number(y);
        this.hideDetail();
        this.render();
    },

    backToYears() {
        this.mode = 'years';
        this.curYear = null;
        this.hideDetail();
        this.render();
    },

    hideDetail() {
        const d = document.getElementById('cmpDetail');
        if (d) { d.style.display = 'none'; d.innerHTML = ''; }
    },

    monthLabels() {
        const lang = (typeof I18N !== 'undefined' && I18N.lang) || 'zh-TW';
        if (lang === 'en') return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return Array.from({ length: 12 }, (_, i) => (i + 1) + t('cmp.month_unit'));
    },

    render() {
        const canvas = document.getElementById('cmpChart');
        if (!canvas || !this.years || !this.years.length) return;
        if (this.chart) { this.chart.destroy(); this.chart = null; }

        const isMonths = this.mode === 'months';
        let labels, preData, actData;

        if (isMonths) {
            const yd = this.years.find(y => y.year === this.curYear) || this.years[0];
            labels = this.monthLabels().concat([t('cmp.year_total')]);
            preData = yd.months.map(m => m.preAmt).concat([yd.total.preAmt]);
            actData = yd.months.map(m => m.actAmt).concat([yd.total.actAmt]);
        } else {
            labels = this.years.map(y => String(y.year));
            preData = this.years.map(y => y.total.preAmt);
            actData = this.years.map(y => y.total.actAmt);
        }

        const preColor = '#3498db', actColor = '#27ae60';
        this.chart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: t('cmp.pre'), data: preData, backgroundColor: preColor, labelColor: '#1f6fa8', borderRadius: 3, maxBarThickness: 26 },
                    { label: t('cmp.act'), data: actData, backgroundColor: actColor, labelColor: '#1e8449', borderRadius: 3, maxBarThickness: 26 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 20 } },
                interaction: { mode: 'index', intersect: false },
                onClick: (evt, els) => this.onBarClick(els),
                onHover: (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
                plugins: {
                    legend: { position: 'top', labels: { boxWidth: 12, boxHeight: 12, font: { size: 11 }, usePointStyle: true } },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${UI.fmt(ctx.parsed.y)}`
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                    y: {
                        beginAtZero: true,
                        grid: { color: '#f1f5f9' },
                        ticks: {
                            font: { size: 10 },
                            callback: (v) => {
                                const lang = (typeof I18N !== 'undefined' && I18N.lang) || 'zh-TW';
                                if (lang === 'en') {
                                    if (Math.abs(v) >= 1e9) return (v / 1e9) + 'B';
                                    if (Math.abs(v) >= 1e6) return (v / 1e6) + 'M';
                                    if (Math.abs(v) >= 1e3) return (v / 1e3) + 'K';
                                    return v;
                                }
                                if (Math.abs(v) >= 1e8) return (v / 1e8) + (lang === 'zh-TW' ? '億' : '亿');
                                if (Math.abs(v) >= 1e4) return (v / 1e4) + (lang === 'zh-TW' ? '萬' : '万');
                                return v;
                            }
                        }
                    }
                }
            },
            plugins: [preCmpLabelPlugin]
        });

        // 視圖切換列（僅月度視圖顯示）
        const bar = document.getElementById('cmpViewBar');
        const title = document.getElementById('cmpViewTitle');
        if (bar && title) {
            bar.style.display = isMonths ? 'flex' : 'none';
            if (isMonths) title.textContent = `${this.curYear} ${t('cmp.month_view')}`;
        }

        // 摘要行：當前視圖的預估/實際合計與達成率
        const sum = document.getElementById('cmpSummary');
        if (sum) {
            let pre, act, scope;
            if (isMonths) {
                const yd = this.years.find(y => y.year === this.curYear) || this.years[0];
                pre = yd.total.preAmt; act = yd.total.actAmt; scope = String(yd.year);
            } else {
                pre = this.years.reduce((s, y) => s + y.total.preAmt, 0);
                act = this.years.reduce((s, y) => s + y.total.actAmt, 0);
                scope = `${this.startYear}~${this.endYear}`;
            }
            const rate = pre > 0 ? (act / pre * 100).toFixed(1) + '%' : '-';
            sum.innerHTML = `
                <span><i style="background:${preColor}"></i>${t('cmp.pre')}：${UI.fmt(pre)}</span>
                <span><i style="background:${actColor}"></i>${t('cmp.act')}：${UI.fmt(act)}</span>
                <span>${t('cmp.rate')}：<b style="color:${act >= pre ? '#1e8449' : '#c0392b'}">${rate}</b></span>
                <span>${scope}</span>`;
        }
    },

    onBarClick(els) {
        if (!els || !els.length) return;
        const i = els[0].index;
        // 年度視圖：點年度柱 → 進入該年月度視圖
        if (this.mode !== 'months') {
            const y = this.years[i];
            if (y) this.enterYear(y.year);
            return;
        }
        // 月度視圖：0~11 → 該月明細；12 → 全年明細
        if (i < 12) this.loadDetail(this.curYear, i + 1);
        else this.loadDetail(this.curYear, 0);
    },

    async loadDetail(year, month) {
        const box = document.getElementById('cmpDetail');
        if (!box) return;
        box.style.display = 'block';
        box.innerHTML = `<div style="padding:20px;text-align:center;color:#94a3b8">⏳ ${t('loading')}</div>`;
        try {
            const res = await API.get(`/api/preorders/comparison/detail?year=${year}&month=${month || ''}`);
            const d = res.data || {};
            const title = month
                ? `${year}-${String(month).padStart(2, '0')}`
                : `${year} ${t('cmp.whole_year')}`;
            const lang = (typeof I18N !== 'undefined' && I18N.lang) || 'zh-TW';
            const preRows = (d.preorders || []).map(r => `<tr>
                <td>${r.preorder_Id}</td>
                <td>${(r.order_date || '').substring(0, 10)}</td>
                <td>${r.user_name || r.user_id || '-'}</td>
                <td>${r.customer_id || '-'}</td>
                <td>${r.project_name || r.project_id || '-'}</td>
                <td class="num">${UI.fmt(r.order_amt)}</td>
                <td>${preStatusBadge(r.status)}</td>
            </tr>`).join('');
            const actRows = (d.actuals || []).map(r => `<tr>
                <td>${r.so_nbr}</td>
                <td>${(r.so_date || '').substring(0, 10)}</td>
                <td>${r.bu_no || '-'}</td>
                <td>${r.client_id || '-'}</td>
                <td>${r.client_name || '-'}</td>
                <td>${r.xitems || '-'}</td>
                <td class="num">${UI.fmt(r.amt)}</td>
            </tr>`).join('');

            box.innerHTML = `
                <div class="cmp-detail-grid">
                    <div>
                        <div class="cmp-detail-head">
                            <span style="color:#1f6fa8">🔵 ${t('cmp.pre_detail')} · ${title}</span>
                            <span>${(d.preorders || []).length} ${t('cmp.count')} / ${UI.fmt(d.preTotal)}</span>
                        </div>
                        <div class="cmp-detail-wrap">
                            <table class="data-table">
                                <thead><tr>
                                    <th>${t('pre.col.id')}</th><th>${t('pre.col.date')}</th><th>${t('pre.col.user')}</th>
                                    <th>${t('pre.col.customer')}</th><th>${t('pre.col.project')}</th>
                                    <th class="num">${t('pre.col.amt')}</th><th>${t('pre.col.status')}</th>
                                </tr></thead>
                                <tbody>${preRows || `<tr><td colspan="7" style="text-align:center;color:#94a3b8">${t('cmp.no_data')}</td></tr>`}</tbody>
                            </table>
                        </div>
                    </div>
                    <div>
                        <div class="cmp-detail-head">
                            <span style="color:#1e8449">🟢 ${t('cmp.act_detail')} · ${title}</span>
                            <span>${(d.actuals || []).length} ${t('cmp.count')} / ${UI.fmt(d.actTotal)}</span>
                        </div>
                        <div class="cmp-detail-wrap">
                            <table class="data-table">
                                <thead><tr>
                                    <th>${t('cmp.so_nbr')}</th><th>${t('pre.col.date')}</th><th>BU</th>
                                    <th>${t('cmp.client_id')}</th><th>${t('cmp.client_name')}</th>
                                    <th>${t('cmp.items')}</th><th class="num">${t('pre.col.amt')}</th>
                                </tr></thead>
                                <tbody>${actRows || `<tr><td colspan="7" style="text-align:center;color:#94a3b8">${t('cmp.no_data')}</td></tr>`}</tbody>
                            </table>
                        </div>
                    </div>
                </div>`;
        } catch (e) {
            box.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`;
        }
    }
};
