/**
 * 應收應付頁面（真實 DB 結構：每月一行，AR_amt + AP_amt 兩欄）
 */
registerPage('arap', async (c) => {
    c.innerHTML = `
        <div class="kpi-grid">
            <div class="kpi-card green"><div class="kpi-label">${t('arap.ar')}</div><div class="kpi-value" id="arTotal">-</div></div>
            <div class="kpi-card red"><div class="kpi-label">${t('arap.ap')}</div><div class="kpi-value" id="apTotal">-</div></div>
            <div class="kpi-card"><div class="kpi-label">${t('arap.net')}</div><div class="kpi-value" id="netTotal">-</div></div>
        </div>
        <div class="card">
            <div class="toolbar">
                <button class="btn btn-primary" onclick="ARAPForm.open()">➕ ${t('arap.btn.add_month')}</button>
                <button class="btn btn-warning" onclick="recalcARAP()">📊 ${t('arap.recalc')}</button>
                <button class="btn btn-success" onclick="loadARAP()">🔄 ${t('refresh')}</button>
            </div>
            <div id="arapTable">${t('loading')}</div>
        </div>
    `;
    loadARAP();
});

async function loadARAP() {
    const el = document.getElementById('arapTable');
    try {
        const res = await API.get(`/api/arap/raw?bu_no=${State.bu_no}`);
        const rows = res.data || [];

        let arSum = 0, apSum = 0;
        rows.forEach(r => {
            arSum += Number(r.AR_amt || 0);
            apSum += Number(r.AP_amt || 0);
        });
        document.getElementById('arTotal').textContent = UI.fmt(arSum);
        document.getElementById('apTotal').textContent = UI.fmt(apSum);
        const net = arSum - apSum;
        const netEl = document.getElementById('netTotal');
        netEl.textContent = UI.fmt(net);
        netEl.className = 'kpi-value ' + (net >= 0 ? 'positive' : 'negative');

        if (rows.length === 0) { el.innerHTML = UI.empty('📐', t('arap.no_data')); return; }

        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>${t('arap.th.month')}</th>
                <th>${t('arap.th.ar')}</th><th>${t('arap.th.ar_ageing')}</th>
                <th>${t('arap.th.ap')}</th><th>${t('arap.th.ap_ageing')}</th>
                <th>${t('arap.th.update_time')}</th>
                <th style="width:140px">${t('arap.th.action')}</th>
            </tr></thead>
            <tbody>${rows.map(r => `
                <tr>
                    <td><b>${r.YYYY_MM}</b></td>
                    <td class="num positive">${UI.fmt(r.AR_amt)}</td>
                    <td class="num">${UI.fmt(r.AR_ageing)}</td>
                    <td class="num negative">${UI.fmt(r.AP_amt)}</td>
                    <td class="num">${UI.fmt(r.AP_ageing)}</td>
                    <td>${r.update_time ? r.update_time.substring(0,16).replace('T',' ') : '-'}</td>
                    <td>
                        <button class="btn btn-primary btn-sm" onclick='editARAP(${JSON.stringify(r)})'>✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delARAP(${r.uid})">🗑</button>
                    </td>
                </tr>
            `).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

function editARAP(r) {
    UI.modal(`✏️ ${t('modal.edit')} ${r.YYYY_MM}`, `
        <div class="form-row">
            <div class="form-group"><label>${t('arap.th.month')}</label><input id="arap_ym" value="${r.YYYY_MM}" readonly></div>
        </div>
        <div class="form-row">
            <div class="form-group"><label>${t('arap.th.ar')}</label><input type="number" id="arap_ar" value="${r.AR_amt || 0}"></div>
            <div class="form-group"><label>${t('arap.th.ap')}</label><input type="number" id="arap_ap" value="${r.AP_amt || 0}"></div>
        </div>
        <div class="form-row">
            <div class="form-group"><label>${t('arap.form.ar_ageing')}</label><input type="number" id="arap_age_ar" value="${r.AR_ageing || 0}"></div>
            <div class="form-group"><label>${t('arap.form.ap_ageing')}</label><input type="number" id="arap_age_ap" value="${r.AP_ageing || 0}"></div>
        </div>
    `, `<button class="btn" onclick="UI.closeModal()">${t('cancel')}</button>
        <button class="btn btn-primary" onclick="ARAPForm.save(${r.uid})">💾 ${t('save')}</button>`);
}

const ARAPForm = {
    open() {
        UI.modal('➕ ' + t('arap.btn.add_month'), `
            <div class="form-row">
                <div class="form-group"><label>${t('arap.form.month_fmt')}</label><input id="arap_ym" value="${State.YYYY_MM}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('arap.th.ar')}</label><input type="number" id="arap_ar" value="0"></div>
                <div class="form-group"><label>${t('arap.th.ap')}</label><input type="number" id="arap_ap" value="0"></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">${t('cancel')}</button>
            <button class="btn btn-primary" onclick="ARAPForm.save()">💾 ${t('save')}</button>`);
    },
    async save(uid) {
        const body = {
            bu_no: State.bu_no,
            YYYY_MM: document.getElementById('arap_ym').value,
            AR_amt: Number(document.getElementById('arap_ar').value) || 0,
            AP_amt: Number(document.getElementById('arap_ap').value) || 0,
            AR_ageing: Number(document.getElementById('arap_age_ar')?.value) || 0,
            AP_ageing: Number(document.getElementById('arap_age_ap')?.value) || 0,
        };
        try {
            if (uid) {
                await API.put(`/api/arap/${uid}`, body);
                UI.toast(t('saved'), 'success');
            } else {
                await API.post('/api/arap', body);
                UI.toast(t('arap.msg.added'), 'success');
            }
            UI.closeModal();
            loadARAP();
        } catch(e) { UI.toast(e.message, 'error'); }
    }
};

async function delARAP(uid) {
    if (!confirm(t('arap.msg.confirm_del').replace('{uid}', uid))) return;
    try { await API.del(`/api/arap/${uid}`); UI.toast(t('deleted'),'success'); loadARAP(); }
    catch(e) { UI.toast(e.message,'error'); }
}

async function recalcARAP() {
    try {
        await API.post('/api/arap/recalc', { bu_no: State.bu_no });
        UI.toast(t('arap.recalc_done'), 'success');
        loadARAP();
    } catch(e) { UI.toast(e.message,'error'); }
}
