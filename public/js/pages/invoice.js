/**
 * 發票管理頁面
 */
registerPage('invoice', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <button class="btn btn-primary" onclick="InvForm.open()">➕ ${t('inv.add')}</button>
                <button class="btn btn-success" onclick="loadInv()">🔄 ${t('refresh')}</button>
                <div class="spacer"></div>
                <select id="invType" onchange="loadInv()" style="padding:6px;border:1px solid #ddd;border-radius:6px;">
                    <option value="">${t('inv.all')}</option>
                    <option value="AR">${t('inv.ar_inv')}</option>
                    <option value="AP">${t('inv.ap_inv')}</option>
                </select>
            </div>
            <div id="invTable">${t('loading')}</div>
        </div>
    `;
    loadInv();
});

async function loadInv() {
    const el = document.getElementById('invTable');
    try {
        const tp = document.getElementById('invType')?.value || '';
        let url = `/api/invoice?bu_no=${State.bu_no}&YYYY_MM=${State.YYYY_MM}`;
        if (tp) url += `&type1=${tp}`;
        const res = await API.get(url);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = UI.empty('🧾', t('inv.no_data')); return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr><th>${t('inv.date')}</th><th>${t('inv.no')}</th><th>${t('inv.type')}</th><th>${t('inv.customer')}</th><th>${t('inv.amount')}</th><th>${t('inv.tax')}</th><th>${t('inv.status')}</th><th>${t('delete')}</th></tr></thead>
            <tbody>${rows.map(r => `<tr>
                <td>${UI.fmtDate(r.inv_date)}</td>
                <td>${r.inv_no || '-'}</td>
                <td>${r.type1 === 'AR' ? t('inv.ar') : t('inv.ap')}</td>
                <td>${r.cust_name || r.supplier_name || '-'}</td>
                <td class="num">${UI.fmt(r.amt)}</td>
                <td class="num">${UI.fmt(r.tax_amt)}</td>
                <td>${r.status1 || '-'}</td>
                <td><button class="btn btn-danger btn-sm" onclick="delInv(${r.uid})">${t('delete')}</button></td>
            </tr>`).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

const InvForm = {
    open() {
        UI.modal(t('inv.add'), `
            <div class="form-row">
                <div class="form-group"><label>${t('inv.type')}</label><select id="if_type"><option value="AR">${t('inv.ar_inv')}</option><option value="AP">${t('inv.ap_inv')}</option></select></div>
                <div class="form-group"><label>${t('inv.no')}</label><input id="if_no"></div>
                <div class="form-group"><label>${t('inv.date')}</label><input type="date" id="if_date" value="${new Date().toISOString().substring(0,10)}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('inv.cust')}</label><input id="if_cust"></div>
                <div class="form-group"><label>${t('inv.amount')}</label><input type="number" id="if_amt" value="0"></div>
                <div class="form-group"><label>${t('inv.tax_rate')}</label><input type="number" id="if_tax" value="13"></div>
            </div>
            <div class="form-group"><label>Remark</label><input id="if_remark"></div>
        `, `<button class="btn" onclick="UI.closeModal()">${t('cancel')}</button><button class="btn btn-primary" onclick="InvForm.save()">${t('save')}</button>`);
    },
    async save() {
        const d = document.getElementById('if_date').value;
        const amt = Number(document.getElementById('if_amt').value) || 0;
        const taxRate = Number(document.getElementById('if_tax').value) || 0;
        const body = {
            bu_no: State.bu_no,
            type1: document.getElementById('if_type').value,
            inv_no: document.getElementById('if_no').value,
            inv_date: d,
            YYYY_MM: d.substring(0,7).replace('-','/'),
            cust_name: document.getElementById('if_cust').value,
            amt: amt,
            tax_amt: amt * taxRate / 100,
            remark: document.getElementById('if_remark').value,
            status1: t('inv.pending')
        };
        try {
            await API.post('/api/invoice', body);
            UI.toast(t('inv.added'), 'success');
            UI.closeModal();
            loadInv();
        } catch(e) { UI.toast(e.message, 'error'); }
    }
};

async function delInv(uid) {
    if (!confirm(t('confirm_delete'))) return;
    try { await API.del(`/api/invoice/${uid}`); UI.toast(t('deleted'), 'success'); loadInv(); }
    catch(e) { UI.toast(e.message, 'error'); }
}
