/**
 * 風險預警模型頁面
 */
registerPage('risk', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <button class="btn btn-warning" onclick="calcRisk()">⚠️ ${t('risk.calc')}</button>
                <button class="btn btn-success" onclick="loadRisk()">🔄 ${t('refresh')}</button>
            </div>
            <div id="riskContent">${t('loading')}</div>
        </div>
    `;
    loadRisk();
});

async function loadRisk() {
    const el = document.getElementById('riskContent');
    try {
        const res = await API.get(`/api/risk?bu_no=${State.bu_no}&YYYY_MM=${State.YYYY_MM}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = UI.empty('⚠️', t('risk.no_data')); return; }
        const r = rows[0];
        const zVal = Number(r.Z_score || 0);
        const zColor = (r.risk_color || '').toLowerCase();
        el.innerHTML = `
            <div class="kpi-grid">
                <div class="kpi-card ${zColor}">
                    <div class="kpi-label">${t('risk.z_score')}</div>
                    <div class="kpi-value">${UI.fmt(zVal, 4)}</div>
                    <div class="kpi-badge ${zColor}">${r.wall_mode || '-'}</div>
                    <div class="kpi-sub">${t('risk.threshold')}</div>
                </div>
                <div class="kpi-card ${Number(r.Z2_score)>=2.9?'green':Number(r.Z2_score)>=1.23?'yellow':'red'}">
                    <div class="kpi-label">${t('risk.z2')}</div>
                    <div class="kpi-value">${UI.fmt(r.Z2_score, 4)}</div>
                </div>
                <div class="kpi-card ${Number(r.Z3_score)>=2.6?'green':Number(r.Z3_score)>=1.1?'yellow':'red'}">
                    <div class="kpi-label">${t('risk.z3')}</div>
                    <div class="kpi-value">${UI.fmt(r.Z3_score, 4)}</div>
                </div>
                <div class="kpi-card ${Number(r.BZ_model)>=0?'green':'red'}">
                    <div class="kpi-label">${t('risk.bz')}</div>
                    <div class="kpi-value">${UI.fmt(r.BZ_model, 4)}</div>
                </div>
                <div class="kpi-card green">
                    <div class="kpi-label">${t('risk.jz')}</div>
                    <div class="kpi-value">${UI.fmt(r.JZ_model, 4)}</div>
                </div>
                <div class="kpi-card ${Number(r.current_ratio)>=1.5?'green':Number(r.current_ratio)>=1?'yellow':'red'}">
                    <div class="kpi-label">${t('risk.current_ratio')}</div>
                    <div class="kpi-value">${UI.fmt(r.current_ratio, 4)}</div>
                    <div class="kpi-sub">${t('risk.quick_ratio')} ${UI.fmt(r.quick_ratio, 4)}</div>
                </div>
                <div class="kpi-card ${Number(r.debt_ratio)<=50?'green':Number(r.debt_ratio)<=70?'yellow':'red'}">
                    <div class="kpi-label">${t('risk.debt_ratio')}</div>
                    <div class="kpi-value">${UI.fmt(r.debt_ratio, 1)}%</div>
                </div>
                <div class="kpi-card ${Number(r.ROE)>=0?'green':'red'}">
                    <div class="kpi-label">${t('risk.roe')}</div>
                    <div class="kpi-value">${UI.fmt(r.ROE, 2)}%</div>
                    <div class="kpi-sub">${t('risk.roa')} ${UI.fmt(r.ROA, 2)}%</div>
                </div>
            </div>
        `;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

async function calcRisk() {
    try {
        const res = await API.post('/api/risk/calc', { bu_no: State.bu_no, YYYY_MM: State.YYYY_MM });
        const d = res.data;
        UI.toast(`${t('risk.calc_done')}: Z=${d.Z_models.Z_score.value} (${d.risk_color})`, 'success');
        loadRisk();
    } catch(e) { UI.toast(e.message,'error'); }
}
