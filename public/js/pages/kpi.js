/**
 * KPI 門檻定義頁面
 */
registerPage('kpi', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <label>${t('kpi.form.bu')}：<select id="kpiBU" onchange="loadKPI()"><option value="">${t('sys.all')}</option>
                    <option value="HM">HM</option><option value="HN">HN</option><option value="SZ">SZ</option></select></label>
                <label>${t('kpi.form.pct_type')}：<select id="kpiPct" onchange="loadKPI()"><option value="">${t('sys.all')}</option>
                    <option value="asc">asc（${t('kpiQuery.threshold_asc')}）</option><option value="desc">desc（${t('kpiQuery.threshold_desc')}）</option></select></label>
                <button class="btn btn-primary" onclick="KpiThresholdForm.open()">➕ ${t('kpi.add')}</button>
                <button class="btn btn-success" onclick="loadKPI()">🔄 ${t('kpi.recalc')}</button>
            </div>
            <div id="kpiTable">${t('loading')}</div>
        </div>
    `;
    document.getElementById('kpiBU').value = State.bu_no;
    loadKPI();
});

async function loadKPI() {
    const el = document.getElementById('kpiTable');
    try {
        const bu = document.getElementById('kpiBU').value;
        const pct = document.getElementById('kpiPct').value;
        const res = await API.get(`/api/kpi?bu_no=${bu}&pct_type=${pct}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = `<p style="color:#95a5a6;text-align:center;padding:40px;">🎯 ${t('kpi.title')} — ${t('sys.no_data')}</p>`; return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>${t('kpi.form.bu')}</th><th>KPI ID</th><th>${t('kpi.col.name')}</th><th>${t('kpi.form.threshold_low')}</th><th>${t('kpi.form.threshold_high')}</th><th>${t('kpi.col.unit')}</th>
                <th>${t('kpi.form.pct_type')}</th><th>${t('kpi.col.current')}</th><th>${t('kpi.col.color')}</th><th>${t('kpi.form.remark')}</th><th>${t('kpi.col.action')}</th>
            </tr></thead>
            <tbody>${rows.map(r => {
                const colorMap = { RED: '#e74c3c', YELLOW: '#f39c12', GREEN: '#27ae60' };
                const badge = r.KPI_color ? `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${colorMap[r.KPI_color]||'#ddd'};border:1px solid #ccc"></span> ${r.KPI_color}` : '-';
                return `<tr>
                    <td>${r.bu_no}</td><td>${r.KPI_id}</td><td>${r.KPI_name||'-'}</td>
                    <td class="num">${UI.fmt(r.KPI1)}</td><td class="num">${UI.fmt(r.KPI2)}</td>
                    <td>${r.unit||'-'}</td><td>${r.pct_type||'-'}</td>
                    <td class="num">${UI.fmt(r.KPI_value)}</td><td>${badge}</td>
                    <td>${r.remark||'-'}</td>
                    <td>
                        <button class="btn btn-sm" onclick="KpiThresholdForm.open(${r.uid})">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delKPI(${r.uid})">🗑</button>
                    </td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

const KpiThresholdForm = {
    open(uid, currentValue) {
        if (uid) {
            API.get(`/api/kpi/${uid}`).then(res => {
                const data = res.data;
                if (currentValue !== undefined && currentValue !== null) {
                    data.KPI_value = currentValue;
                }
                this._render(data);
            }).catch(e => UI.toast(e.message,'error'));
        } else {
            this._render({ bu_no: State.bu_no });
        }
    },
    _render(d) {
        const isEdit = !!d.uid;
        UI.modal(isEdit ? t('kpi.form.title_edit') : t('kpi.form.title_new'), `
            <div class="form-row">
                <div class="form-group"><label>${t('kpi.form.bu')}</label>
                    <select id="kf_bu"><option>HM</option><option>HN</option><option>SZ</option></select></div>
                <div class="form-group"><label>KPI ID</label><input id="kf_id" value="${d.KPI_id||''}"></div>
                <div class="form-group"><label>${t('kpi.form.name')}</label><input id="kf_name" value="${d.KPI_name||''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('kpi.form.threshold_low')} (KPI1)</label><input type="number" step="0.0001" id="kf_k1" value="${d.KPI1||0}"></div>
                <div class="form-group"><label>${t('kpi.form.threshold_high')} (KPI2)</label><input type="number" step="0.0001" id="kf_k2" value="${d.KPI2||0}"></div>
                <div class="form-group"><label>${t('kpi.form.unit')}</label><input id="kf_unit" value="${d.unit||''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('kpi.form.pct_type')}</label>
                    <select id="kf_pct"><option value="asc">asc（${t('kpiQuery.threshold_asc')}）</option><option value="desc">desc（${t('kpiQuery.threshold_desc')}）</option></select></div>
                <div class="form-group"><label>${t('kpi.col.current')} <span style="color:#888;font-size:11px;">(${t('sys.calc_live')})</span></label><input type="number" step="0.0001" id="kf_val" value="${d.KPI_value||0}" readonly style="background:#f4f6f7;color:#2980b9;font-weight:bold;"></div>
                <div class="form-group"><label>${t('kpi.col.color')}</label>
                    <select id="kf_color"><option value="">(${t('sys.auto')})</option><option value="GREEN">GREEN</option><option value="YELLOW">YELLOW</option><option value="RED">RED</option></select></div>
            </div>
            <div class="form-row">
                <div class="form-group" style="flex:1"><label>${t('kpi.form.remark')}</label><textarea id="kf_remark" rows="2" style="width:100%">${d.remark||''}</textarea></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">${t('kpi.btn.cancel')}</button><button class="btn btn-primary" onclick="KpiThresholdForm.save(${d.uid||0})">${t('kpi.btn.save')}</button>`);
        if (d.bu_no) document.getElementById('kf_bu').value = d.bu_no;
        if (d.pct_type) document.getElementById('kf_pct').value = d.pct_type;
        if (d.KPI_color) document.getElementById('kf_color').value = d.KPI_color;
    },
    async save(uid) {
        const body = {
            bu_no: document.getElementById('kf_bu').value,
            KPI_id: document.getElementById('kf_id').value,
            KPI_name: document.getElementById('kf_name').value,
            KPI1: Number(document.getElementById('kf_k1').value)||0,
            KPI2: Number(document.getElementById('kf_k2').value)||0,
            unit: document.getElementById('kf_unit').value,
            pct_type: document.getElementById('kf_pct').value,
            KPI_value: Number(document.getElementById('kf_val').value)||0,
            KPI_color: document.getElementById('kf_color').value,
            remark: document.getElementById('kf_remark').value,
        };
        try {
            if (uid) await API.put(`/api/kpi/${uid}`, body);
            else await API.post('/api/kpi', body);
            UI.toast(uid ? t('kpi.msg.updated') : t('kpi.msg.added'), 'success');
            UI.closeModal();
            if (window._onKpiSaved) window._onKpiSaved(body.KPI_id);
            else loadKPI();
        } catch(e) { UI.toast(e.message,'error'); }
    }
};

async function delKPI(uid) {
    if (!confirm(t('kpi.msg.confirm_delete'))) return;
    try { await API.del(`/api/kpi/${uid}`); UI.toast(t('kpi.msg.deleted'),'success'); loadKPI(); }
    catch(e) { UI.toast(e.message,'error'); }
}
