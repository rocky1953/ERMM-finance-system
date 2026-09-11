/**
 * 採購單 PO 頁面
 */
registerPage('po', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <button class="btn btn-primary" onclick="POForm.open()">➕ ${t('po.add')}</button>
                <button class="btn btn-success" onclick="loadPO()">🔄 ${t('po.refresh')}</button>
            </div>
            <div id="poTable">${t('loading')}</div>
        </div>
    `;
    loadPO();
});

async function loadPO() {
    const el = document.getElementById('poTable');
    try {
        const res = await API.get(`/api/po?bu_no=${State.bu_no}&YYYY_MM=${State.YYYY_MM}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = UI.empty('🛒', t('po.no_data')); return; }

        const colTitleUnapproved = I18N.t('po.status.unapproved');
        const colSubUnpaid = I18N.t('po.sub.unpaid');

        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>${t('po.col.po_id')}</th><th>${t('po.col.date')}</th><th>${t('po.col.supplier')}</th><th>${t('po.col.xitems')}</th>
                <th>${t('po.col.qty')}</th><th>${t('po.col.price')}</th><th>${t('po.col.amount')}</th><th>${t('po.col.local')}</th>
                <th>${t('po.col.status')}</th><th>${t('po.col.sub_status')}</th>
                <th style="width:140px">${t('po.col.action')}</th>
            </tr></thead>
            <tbody>${rows.map(r => `
                <tr>
                    <td><b>${r.po_id || '-'}</b></td>
                    <td>${r.po_date || '-'}</td>
                    <td>${r.supplier_name || '-'}</td>
                    <td>${r.xitems || '-'}</td>
                    <td class="num">${UI.fmt(r.po_qty)}</td>
                    <td class="num">${UI.fmt(r.unit_price, 2)}</td>
                    <td class="num">${UI.fmt(r.po_amount)}</td>
                    <td class="num">${UI.fmt(r.po_amount_local)}</td>
                    <td><span style="padding:2px 8px;border-radius:10px;background:#dbeafe;color:#1e40af;font-size:12px">${I18N.statusLabel('po_status', r.po_status || '未審核')}</span></td>
                    <td>${I18N.statusLabel('po_sub_status', r.po_sub_status || '未交付')}</td>
                    <td>
                        <button class="btn btn-primary btn-sm" onclick='editPO(${JSON.stringify(r)})'>✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delPO(${r.uid})">🗑</button>
                    </td>
                </tr>
            `).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

function editPO(r) {
    POForm._uid = r.uid;
    POForm.open(r);
}

const POForm = {
    _uid: null,
    open(d) {
        d = d || {};
        const newStatusLabel = I18N.t('po.status.unapproved');
        const newSubLabel = I18N.t('po.sub.unpaid');

        const statusOpts = I18N.statusOptions('po_status');
        const subOpts = I18N.statusOptions('po_sub_status');
        const curStatus = d.po_status || '未審核';
        const curSub = d.po_sub_status || '未交付';

        UI.modal(this._uid ? `✏️ ${t('po.form.title_edit')} ${d.po_id || ''}` : `➕ ${t('po.form.title_new')}`, `
            <div class="form-row">
                <div class="form-group"><label>${t('po.form.po_id')}</label><input id="po_fid" value="${d.po_id || ''}"></div>
                <div class="form-group"><label>${t('po.form.date')}</label><input type="date" id="po_fdate" value="${(d.po_date || '').substring(0,10)}"></div>
                <div class="form-group"><label>${t('po.form.supplier')}</label><input id="po_fsup" value="${d.supplier_name || ''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('po.form.xitems')}</label><input id="po_fmat" value="${d.xitems || ''}"></div>
                <div class="form-group"><label>${t('po.form.qty')}</label><input type="number" id="po_fqty" value="${d.po_qty || 0}"></div>
                <div class="form-group"><label>${t('po.form.price')}</label><input type="number" id="po_fup" value="${d.unit_price || 0}" step="0.0001"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('po.form.rate')}</label><input type="number" id="po_frate" value="${d.exchange_rate || 1}" step="0.0001"></div>
                <div class="form-group"><label>${t('po.form.vat')}</label><input type="number" id="po_fvat" value="${d.vat_amt || 0}"></div>
                <div class="form-group"><label>${t('po.form.status')}</label>
                    <select id="po_fstat">
                        ${statusOpts.map(o => `<option value="${o.value}" ${o.value === curStatus ? 'selected' : ''}>${o.label}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('po.form.sub_status')}</label>
                    <select id="po_fsub">
                        ${subOpts.map(o => `<option value="${o.value}" ${o.value === curSub ? 'selected' : ''}>${o.label}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group"><label>${t('po.form.supplier_type')}</label><input id="po_fsuptype" value="${d.supplier_type || ''}"></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">${t('po.btn.cancel')}</button>
            <button class="btn btn-primary" onclick="POForm.save()">💾 ${t('po.btn.save')}</button>`);
    },
    async save() {
        const body = {
            bu_no: State.bu_no,
            po_id: document.getElementById('po_fid').value,
            supplier_name: document.getElementById('po_fsup').value,
            xitems: document.getElementById('po_fmat').value,
            po_date: document.getElementById('po_fdate').value || null,
            po_qty: Number(document.getElementById('po_fqty').value) || 0,
            unit_price: Number(document.getElementById('po_fup').value) || 0,
            exchange_rate: Number(document.getElementById('po_frate').value) || 1,
            vat_amt: Number(document.getElementById('po_fvat').value) || 0,
            po_status: document.getElementById('po_fstat').value,
            po_sub_status: document.getElementById('po_fsub').value,
            supplier_type: document.getElementById('po_fsuptype').value,
        };
        try {
            if (this._uid) {
                await API.put(`/api/po/${this._uid}`, body);
                UI.toast(t('po.msg.updated'), 'success');
            } else {
                await API.post('/api/po', body);
                UI.toast(t('po.msg.added'), 'success');
            }
            UI.closeModal();
            this._uid = null;
            loadPO();
        } catch(e) { UI.toast(e.message, 'error'); }
    }
};

async function delPO(uid) {
    if (!confirm(t('confirm_delete'))) return;
    try { await API.del(`/api/po/${uid}`); UI.toast(t('deleted'),'success'); loadPO(); }
    catch(e) { UI.toast(e.message,'error'); }
}
