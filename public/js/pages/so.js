/**
 * 銷售訂單 SO 頁面
 */
registerPage('so', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <button class="btn btn-primary" onclick="SOForm.open()">➕ ${t('so.add')}</button>
                <button class="btn btn-success" onclick="loadSO()">🔄 ${t('so.refresh')}</button>
            </div>
            <div id="soTable">${t('loading')}</div>
        </div>
    `;
    loadSO();
});

async function loadSO() {
    const el = document.getElementById('soTable');
    try {
        const res = await API.get(`/api/so?bu_no=${State.bu_no}&YYYY_MM=${State.YYYY_MM}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = UI.empty('📦', t('so.no_data')); return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>${t('so.col.so_nbr')}</th><th>${t('so.col.date')}</th><th>${t('so.col.client')}</th><th>${t('so.col.xitems')}</th>
                <th>${t('so.col.qty')}</th><th>${t('so.col.dn')}</th><th>${t('so.col.price')}</th><th>${t('so.col.amount')}</th>
                <th>${t('so.col.status')}</th><th style="width:140px">${t('so.col.action')}</th>
            </tr></thead>
            <tbody>${rows.map(r => {
                const total = Number(r.dn_qty || 0) * Number(r.unit_price || 0);
                return `<tr>
                    <td><b>${r.so_nbr || '-'}</b></td>
                    <td>${r.so_date || '-'}</td>
                    <td>${r.client_name || r.client_id || '-'}</td>
                    <td>${r.xitems || '-'}</td>
                    <td class="num">${UI.fmt(r.so_qty)}</td>
                    <td class="num">${UI.fmt(r.dn_qty)}</td>
                    <td class="num">${UI.fmt(r.unit_price, 2)}</td>
                    <td class="num positive">${UI.fmt(total)}</td>
                    <td><span style="padding:2px 8px;border-radius:10px;background:#dcfce7;color:#166534;font-size:12px">${I18N.statusLabel('so_status', r.status || '新單')}</span></td>
                    <td>
                        <button class="btn btn-primary btn-sm" onclick='editSO(${JSON.stringify(r)})'>✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delSO(${r.uid})">🗑</button>
                    </td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

function editSO(r) {
    SOForm._uid = r.uid;
    SOForm.open(r);
}

const SOForm = {
    _uid: null,
    open(d) {
        d = d || {};
        const opts = I18N.statusOptions('so_status');
        const cur = d.status || '新單';

        UI.modal(this._uid ? `✏️ ${t('so.form.title_edit')} ${d.so_nbr || ''}` : `➕ ${t('so.form.title_new')}`, `
            <div class="form-row">
                <div class="form-group"><label>${t('so.form.so_nbr')}</label><input id="so_fid" value="${d.so_nbr || ''}"></div>
                <div class="form-group"><label>${t('so.form.date')}</label><input type="date" id="so_fdate" value="${(d.so_date || '').substring(0,10)}"></div>
                <div class="form-group"><label>${t('so.form.client_id')}</label><input id="so_fcid" value="${d.client_id || ''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('so.form.client_name')}</label><input id="so_fcn" value="${d.client_name || ''}"></div>
                <div class="form-group"><label>${t('so.form.xitems')}</label><input id="so_fmat" value="${d.xitems || ''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('so.form.qty')}</label><input type="number" id="so_fqty" value="${d.so_qty || 0}"></div>
                <div class="form-group"><label>${t('so.form.dn')}</label><input type="number" id="so_fdn" value="${d.dn_qty || 0}"></div>
                <div class="form-group"><label>${t('so.form.price')}</label><input type="number" id="so_fup" value="${d.unit_price || 0}" step="0.0001"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('so.form.status')}</label>
                    <select id="so_fstat">
                        ${opts.map(o => `<option value="${o.value}" ${o.value === cur ? 'selected' : ''}>${o.label}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group"><label>${t('so.form.remark')}</label><input id="so_frem" value="${(d.remark||'').substring(0,80)}"></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">${t('so.btn.cancel')}</button>
            <button class="btn btn-primary" onclick="SOForm.save()">💾 ${t('so.btn.save')}</button>`);
    },
    async save() {
        const body = {
            bu_no: State.bu_no,
            so_nbr: document.getElementById('so_fid').value,
            client_id: document.getElementById('so_fcid').value,
            client_name: document.getElementById('so_fcn').value,
            xitems: document.getElementById('so_fmat').value,
            so_date: document.getElementById('so_fdate').value || null,
            so_qty: Number(document.getElementById('so_fqty').value) || 0,
            dn_qty: Number(document.getElementById('so_fdn').value) || 0,
            unit_price: Number(document.getElementById('so_fup').value) || 0,
            status: document.getElementById('so_fstat').value,
            remark: document.getElementById('so_frem').value,
        };
        try {
            if (this._uid) {
                await API.put(`/api/so/${this._uid}`, body);
                UI.toast(t('so.msg.updated'), 'success');
            } else {
                await API.post('/api/so', body);
                UI.toast(t('so.msg.added'), 'success');
            }
            UI.closeModal();
            this._uid = null;
            loadSO();
        } catch(e) { UI.toast(e.message, 'error'); }
    }
};

async function delSO(uid) {
    if (!confirm(t('so.msg.confirm_delete'))) return;
    try { await API.del(`/api/so/${uid}`); UI.toast(t('so.msg.deleted'),'success'); loadSO(); }
    catch(e) { UI.toast(e.message,'error'); }
}
