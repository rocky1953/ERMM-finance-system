/**
 * PO 暫存 ermm_temp_po CRUD
 */
registerPage('tempPo', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <label>${t('topbar.bu')}：<select id="tpBU" onchange="loadTempPo()"><option value="">${t('sys.all')}</option>
                    <option>HM</option><option>HN</option><option>SZ</option></select></label>
                <label>${t('tp.form.batch')}：<input id="tpBatch" onchange="loadTempPo()" placeholder="batch_id"></label>
                <button class="btn btn-primary" onclick="TempPoForm.open()">➕ ${t('tp.add')}</button>
                <button class="btn btn-warning" onclick="batchStep1()">▶ ${t('tp.run_step1')}</button>
                <button class="btn btn-success" onclick="loadTempPo()">🔄</button>
            </div>
            <div id="tempPoTable">${t('loading')}</div>
        </div>
    `;
    document.getElementById('tpBU').value = State.bu_no;
    loadTempPo();
});

async function loadTempPo() {
    const el = document.getElementById('tempPoTable');
    try {
        const res = await API.get(`/api/temp-po?bu_no=${document.getElementById('tpBU').value}&batch_id=${document.getElementById('tpBatch').value}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = `<p style="color:#95a5a6;text-align:center;padding:40px;">📥 ${t('tp.no_data')}</p>`; return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>${t('tp.col.bu')}</th><th>${t('tp.col.po_id')}</th><th>${t('tp.col.supplier')}</th><th>${t('tp.col.xitems')}</th>
                <th>${t('tp.col.date')}</th><th>${t('tp.col.qty')}</th><th>${t('tp.col.price')}</th><th>${t('tp.col.rate')}</th>
                <th>${t('tp.col.amount')}</th><th>${t('tp.col.vat')}</th><th>${t('tp.col.batch')}</th><th>${t('tp.col.action')}</th>
            </tr></thead>
            <tbody>${rows.map(r => `
                <tr>
                    <td>${r.bu_no}</td><td>${r.po_id||'-'}</td><td>${r.supplier_name||'-'}</td>
                    <td>${r.xitems||'-'}</td><td>${r.po_date||'-'}</td>
                    <td class="num">${UI.fmt(r.po_qty, 4)}</td><td class="num">${UI.fmt(r.unit_price, 6)}</td>
                    <td class="num">${UI.fmt(r.exchange_rate, 4)}</td><td class="num">${UI.fmt(r.po_amount)}</td>
                    <td class="num">${UI.fmt(r.vat_amt)}</td><td>${r.batch_id||'-'}</td>
                    <td>
                        <button class="btn btn-sm" onclick="TempPoForm.open(${r.uid})">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delTempPo(${r.uid})">🗑</button>
                    </td>
                </tr>`).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

const TempPoForm = {
    open(uid) {
        if (uid) API.get(`/api/temp-po/${uid}`).then(r => this._render(r.data)).catch(e => UI.toast(e.message,'error'));
        else this._render({ bu_no: State.bu_no, exchange_rate: 1 });
    },
    _render(d) {
        const isEdit = !!d.uid;
        UI.modal((isEdit ? t('modal.edit_po') : t('po.form.title_new')), `
            <div class="form-row">
                <div class="form-group"><label>${t('tp.form.bu')}</label><select id="tp_fbu"><option>HM</option><option>HN</option><option>SZ</option></select></div>
                <div class="form-group"><label>${t('tp.col.po_id')}</label><input id="tp_fid" value="${d.po_id||''}"></div>
                <div class="form-group"><label>${t('tp.form.batch')}</label><input id="tp_fbat" value="${d.batch_id||''}" placeholder="auto or Bxxxx"></div>
            </div>
            <div class="form-row">
                <div class="form-group" style="flex:1"><label>${t('tp.col.supplier')}</label><input id="tp_fsup" value="${d.supplier_name||''}" style="width:100%"></div>
                <div class="form-group"><label>${t('tp.col.xitems')}</label><input id="tp_fx" value="${d.xitems||''}"></div>
                <div class="form-group"><label>${t('tp.col.date')}</label><input type="date" id="tp_fd" value="${d.po_date||''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('tp.col.qty')}</label><input type="number" step="0.0001" id="tp_fqty" value="${d.po_qty||0}"></div>
                <div class="form-group"><label>${t('tp.col.price')}</label><input type="number" step="0.000001" id="tp_fup" value="${d.unit_price||0}"></div>
                <div class="form-group"><label>${t('tp.col.rate')}</label><input type="number" step="0.0001" id="tp_frate" value="${d.exchange_rate||1}"></div>
                <div class="form-group"><label>${t('tp.col.vat')}</label><input type="number" step="0.01" id="tp_fvat" value="${d.vat_amt||0}"></div>
            </div>
            <div style="padding:8px 12px;background:#fef9e7;border-radius:6px;color:#7d6608;font-size:0.85em;">
                💡 ${t('tp.hint_auto_amount')}
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">${t('tp.btn.cancel')}</button><button class="btn btn-primary" onclick="TempPoForm.save(${d.uid||0})">${t('tp.btn.save')}</button>`);
        if (d.bu_no) document.getElementById('tp_fbu').value = d.bu_no;
    },
    async save(uid) {
        const body = {
            bu_no: document.getElementById('tp_fbu').value,
            po_id: document.getElementById('tp_fid').value,
            batch_id: document.getElementById('tp_fbat').value || null,
            supplier_name: document.getElementById('tp_fsup').value,
            xitems: document.getElementById('tp_fx').value,
            po_date: document.getElementById('tp_fd').value || null,
            po_qty: Number(document.getElementById('tp_fqty').value)||0,
            unit_price: Number(document.getElementById('tp_fup').value)||0,
            exchange_rate: Number(document.getElementById('tp_frate').value)||1,
            vat_amt: Number(document.getElementById('tp_fvat').value)||0,
        };
        try {
            if (uid) await API.put(`/api/temp-po/${uid}`, body); else await API.post('/api/temp-po', body);
            UI.toast(uid ? t('po.msg.updated') : t('po.msg.added'), 'success'); UI.closeModal(); loadTempPo();
        } catch(e) { UI.toast(e.message,'error'); }
    }
};

async function delTempPo(uid) {
    if (!confirm(t('confirm_delete'))) return;
    try { await API.del(`/api/temp-po/${uid}`); UI.toast(t('tp.msg.deleted'),'success'); loadTempPo(); }
    catch(e) { UI.toast(e.message,'error'); }
}
async function batchStep1() {
    try {
        const res = await API.post('/api/batch/step1', { bu_no: State.bu_no });
        UI.toast(`${t('tp.msg.synced')} (${res.data?.inserted||0})`, 'success'); loadTempPo();
    } catch(e) { UI.toast(e.message,'error'); }
}
