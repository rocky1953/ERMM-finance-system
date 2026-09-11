/**
 * 系統設定頁面（碼表 CRUD + KPI）
 */
registerPage('system', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="card-title">🔧 ${t('sys.codes')}</div>
            <div class="toolbar">
                <button class="btn btn-primary" onclick="CodeForm.open()">➕ ${t('sys.add_code')}</button>
                <button class="btn btn-success" onclick="loadCodes()">🔄 ${t('refresh')}</button>
                <div class="spacer"></div>
                <select id="codeType" onchange="loadCodes()" style="padding:6px;border:1px solid #ddd;border-radius:6px;">
                    <option value="">${t('sys.all')}</option>
                    <option value="CURRENCY">${t('sys.currency')}</option>
                    <option value="BUSINESS_ID">${t('sys.business')}</option>
                    <option value="AGEING_STOCK">${t('sys.ageing')}</option>
                    <option value="BATCH_CONTROL">${t('sys.batch_ctrl')}</option>
                </select>
            </div>
            <div id="codeTable">${t('loading')}</div>
        </div>
        <div class="card">
            <div class="card-title">🎯 ${t('sys.kpi')}</div>
            <div class="toolbar">
                <button class="btn btn-warning" onclick="kpiLight()">🔔 ${t('sys.kpi_light')}</button>
                <button class="btn btn-primary" onclick="KpiForm.open()">➕ ${t('kpi.add')}</button>
                <button class="btn btn-success" onclick="loadSysKPI()">🔄 ${t('refresh')}</button>
            </div>
            <div id="kpiTable" style="margin-top:15px">${t('loading')}</div>
        </div>
    `;
    loadCodes();
    loadSysKPI();
});

// ============ 系統碼表 ============
async function loadCodes() {
    const el = document.getElementById('codeTable');
    if (!el) return;
    try {
        const tp = document.getElementById('codeType')?.value || '';
        let url = '/api/system/codes';
        if (tp) url += `?code_type=${tp}`;
        const res = await API.get(url);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = `<p style="color:#95a5a6;text-align:center;padding:40px;">📋 ${t('sys.no_codes')}</p>`; return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>${t('sys.type')}</th><th>${t('sys.code')}</th><th>${t('sys.name')}</th>
                <th>${t('sys.val1')}</th><th>${t('sys.val2')}</th><th>${t('sys.val3')}</th>
                <th>${t('system.col.sort')}</th><th>${t('system.col.status')}</th><th>${t('system.col.action')}</th>
            </tr></thead>
            <tbody>${rows.map(r => `
                <tr>
                    <td>${r.code_type||'-'}</td><td><b>${r.code_value||'-'}</b></td><td>${r.value_description||'-'}</td>
                    <td class="num">${UI.fmt(r.value_number1,4)}</td>
                    <td class="num">${UI.fmt(r.value_number2,4)}</td>
                    <td class="num">${UI.fmt(r.value_number3,4)}</td>
                    <td>${r.sort_order||0}</td>
                    <td>${r.inuse_flag==='USE'?'<span style="color:#27ae60">● '+t('system.status.active')+'</span>':'<span style="color:#e74c3c">○ '+t('system.status.inactive')+'</span>'}</td>
                    <td>
                        <button class="btn btn-sm" onclick="CodeForm.open(${r.id})">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delCode(${r.id})">🗑</button>
                    </td>
                </tr>`).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

const CodeForm = {
    async open(id) {
        let d = {};
        if (id) {
            try {
                const res = await API.get(`/api/system/codes/${id}`);
                d = res.data || {};
            } catch(e) { UI.toast(e.message,'error'); return; }
        }
        this._render(d, !!id);
    },
    _render(d, isEdit) {
        UI.modal((isEdit ? t('modal.edit') : t('modal.add')) + ' ' + t('sys.codes'), `
            <div class="form-row">
                <div class="form-group"><label>${t('sys.type')}</label>
                    <select id="cf_type">
                        <option>CURRENCY</option><option>BUSINESS_ID</option>
                        <option>AGEING_STOCK</option><option>BATCH_CONTROL</option>
                    </select></div>
                <div class="form-group"><label>${t('sys.code')}</label><input id="cf_val" value="${d.code_value||''}"></div>
                <div class="form-group"><label>${t('system.form.desc')}</label><input id="cf_desc" value="${d.value_description||''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('sys.val1')}</label><input type="number" step="0.0001" id="cf_n1" value="${d.value_number1||0}"></div>
                <div class="form-group"><label>${t('sys.val2')}</label><input type="number" step="0.0001" id="cf_n2" value="${d.value_number2||0}"></div>
                <div class="form-group"><label>${t('sys.val3')}</label><input type="number" step="0.0001" id="cf_n3" value="${d.value_number3||0}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('system.col.sort')}</label><input type="number" id="cf_sort" value="${d.sort_order||0}"></div>
                <div class="form-group"><label>${t('system.col.status')}</label>
                    <select id="cf_use"><option value="USE">${t('system.status.active')}</option><option value="NOUSE">${t('system.status.inactive')}</option></select></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">${t('cancel')}</button>
            <button class="btn btn-primary" onclick="CodeForm.save(${d.id||0})">${t('save')}</button>`);

        if (d.code_type) document.getElementById('cf_type').value = d.code_type;
        if (d.inuse_flag) document.getElementById('cf_use').value = d.inuse_flag;
    },
    async save(id) {
        const body = {
            code_type: document.getElementById('cf_type').value,
            code_value: document.getElementById('cf_val').value,
            value_description: document.getElementById('cf_desc').value,
            value_number1: Number(document.getElementById('cf_n1').value)||0,
            value_number2: Number(document.getElementById('cf_n2').value)||0,
            value_number3: Number(document.getElementById('cf_n3').value)||0,
            sort_order: Number(document.getElementById('cf_sort').value)||0,
            inuse_flag: document.getElementById('cf_use').value,
        };
        if (!body.code_value) { UI.toast(t('system.msg.code_empty'),'error'); return; }
        try {
            if (id) { await API.put(`/api/system/codes/${id}`, body); UI.toast(t('saved'),'success'); }
            else { await API.post('/api/system/codes', body); UI.toast(t('system.msg.added'),'success'); }
            UI.closeModal(); loadCodes();
        } catch(e) { UI.toast(e.message,'error'); }
    }
};

async function delCode(id) {
    if (!confirm(t('system.msg.confirm_del_code'))) return;
    try { await API.del(`/api/system/codes/${id}`); UI.toast(t('deleted'),'success'); loadCodes(); }
    catch(e) { UI.toast(e.message,'error'); }
}

// ============ KPI ============
async function loadSysKPI() {
    const el = document.getElementById('kpiTable');
    if (!el) return;
    try {
        const res = await API.get(`/api/system/kpi?bu_no=${State.bu_no}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = `<p style="color:#95a5a6;text-align:center;padding:40px;">🎯 ${t('sys.no_kpi')}</p>`; return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>${t('sys.business')}</th><th>${t('sys.kpi_id')}</th><th>${t('sys.kpi_name')}</th><th>${t('system.col.unit')}</th>
                <th>${t('sys.cur_val')}</th><th>${t('sys.low')}</th><th>${t('sys.high')}</th><th>${t('system.col.direction')}</th><th>${t('sys.light')}</th><th>${t('system.col.action')}</th>
            </tr></thead>
            <tbody>${rows.map(r => {
                const c = (r.KPI_color || '').toUpperCase();
                const dotColor = c === 'GREEN' ? '#27ae60' : c === 'RED' ? '#e74c3c' : '#f1c40f';
                return `
                <tr>
                    <td>${r.bu_no||'-'}</td><td>${r.KPI_id||'-'}</td><td>${r.KPI_name||'-'}</td>
                    <td>${r.unit||'-'}</td>
                    <td class="num">${UI.fmt(r.KPI_value,4)}</td>
                    <td class="num">${UI.fmt(r.KPI1,4)}</td>
                    <td class="num">${UI.fmt(r.KPI2,4)}</td>
                    <td>${r.pct_type==='desc'?'↓ '+t('system.kpi.high_better'):'↑ '+t('system.kpi.low_better')}</td>
                    <td><span style="color:${dotColor};font-size:1.2em;">●</span> ${c||'-'}</td>
                    <td>
                        <button class="btn btn-sm" onclick="KpiForm.open(${r.uid})">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delSysKPI(${r.uid})">🗑</button>
                    </td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

const KpiForm = {
    open(uid) {
        if (uid) {
            API.get(`/api/kpi/${uid}`).then(r => this._render(r.data, true))
                .catch(() => API.get(`/api/system/kpi?bu_no=${State.bu_no}`).then(r => {
                    const row = (r.data||[]).find(x => x.uid === uid);
                    if (row) this._render(row, true); else UI.toast(t('system.msg.not_found'),'error');
                }));
        } else {
            this._render({ bu_no: State.bu_no, KPI1: 0, KPI2: 0, pct_type: 'asc' }, false);
        }
    },
    _render(d, isEdit) {
        UI.modal((isEdit ? t('modal.edit') : t('modal.add')) + ' KPI', `
            <div class="form-row">
                <div class="form-group"><label>${t('sys.business')}</label>
                    <select id="kf_bu"><option>HM</option><option>HN</option><option>SZ</option></select></div>
                <div class="form-group"><label>${t('sys.kpi_id')}</label><input id="kf_id" value="${d.KPI_id||''}" ${isEdit?'disabled':''}></div>
                <div class="form-group"><label>${t('sys.kpi_name')}</label><input id="kf_name" value="${d.KPI_name||''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('system.col.unit')}</label><input id="kf_unit" value="${d.unit||''}" placeholder="${t('system.unit_placeholder')}"></div>
                <div class="form-group"><label>${t('system.col.direction')}</label>
                    <select id="kf_type"><option value="asc">↑ asc ${t('system.kpi.in_range')}</option>
                    <option value="desc">↓ desc ${t('system.kpi.high_better')}</option></select></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('sys.low')} KPI1</label><input type="number" step="0.0001" id="kf_low" value="${d.KPI1||0}"></div>
                <div class="form-group"><label>${t('sys.high')} KPI2</label><input type="number" step="0.0001" id="kf_high" value="${d.KPI2||0}"></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">${t('cancel')}</button>
            <button class="btn btn-primary" onclick="KpiForm.save(${d.uid||0})">${t('save')}</button>`);
        if (d.bu_no) document.getElementById('kf_bu').value = d.bu_no;
        if (d.pct_type) document.getElementById('kf_type').value = d.pct_type;
    },
    async save(uid) {
        const body = {
            bu_no: document.getElementById('kf_bu').value,
            KPI_id: document.getElementById('kf_id').value,
            KPI_name: document.getElementById('kf_name').value,
            unit: document.getElementById('kf_unit').value,
            pct_type: document.getElementById('kf_type').value,
            KPI1: Number(document.getElementById('kf_low').value)||0,
            KPI2: Number(document.getElementById('kf_high').value)||0,
        };
        if (!body.KPI_id) { UI.toast(t('system.msg.kpi_id_empty'),'error'); return; }
        try {
            // POST route 已用 ON DUPLICATE KEY UPDATE，新舊都走同一條
            await API.post('/api/system/kpi', body);
            UI.toast(isNaN(uid) ? t('system.msg.added') : t('saved'), 'success');
            UI.closeModal(); loadSysKPI();
        } catch(e) { UI.toast(e.message,'error'); }
    }
};

async function delSysKPI(uid) {
    if (!confirm(t('kpi.msg.confirm_delete'))) return;
    try { await API.del(`/api/kpi/${uid}`); UI.toast(t('deleted'),'success'); loadSysKPI(); }
    catch(e) { UI.toast(e.message,'error'); }
}

async function kpiLight() {
    try {
        const res = await API.post('/api/risk/kpi-light', { bu_no: State.bu_no });
        UI.toast(t('sys.kpi_updated') + ` (${res.data?.length || 0})`, 'success');
        loadSysKPI();
    } catch(e) { UI.toast(e.message,'error'); }
}
