/**
 * SO 交货单 ermm_erp_so_dn CRUD
 */
registerPage('dn', async (c) => {
    const _mgr = Auth.isManager();
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <label>${t('sys.business')}：<select id="dnBU" onchange="loadDN()"><option value="">${t('sys.all')}</option>
                    <option>HM</option><option>HN</option><option>SZ</option></select></label>
                <label>${t('dn.so_nbr')}：<input id="dnSO" onchange="loadDN()"></label>
                ${_mgr ? `<button class="btn btn-primary" onclick="DNForm.open()">➕ ${t('dn.btn.add')}</button>` : ''}
                <button class="btn btn-success" onclick="loadDN()">🔄 ${t('refresh')}</button>
            </div>
            <div id="dnTable">${t('loading')}</div>
        </div>
    `;
    document.getElementById('dnBU').value = State.bu_no;
    loadDN();
});
async function loadDN() {
    const _mgr = Auth.isManager();
    const el = document.getElementById('dnTable');
    try {
        const res = await API.get(`/api/dn?bu_no=${document.getElementById('dnBU').value}&so_nbr=${document.getElementById('dnSO').value}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = `<p style="color:#95a5a6;text-align:center;padding:40px;">🚚 ${t('dn.no_data')}</p>`; return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>${t('sys.business')}</th><th>${t('dn.so_nbr')}</th><th>${t('po.col.xitems')}</th><th>${t('so.col.client')}</th>
                <th>${t('dn.th.dn_date')}</th><th>${t('dn.th.dn_qty')}</th><th>${t('dn.th.so_qty')}</th>${_mgr ? `<th>${t('system.col.action')}</th>` : ''}
            </tr></thead>
            <tbody>${rows.map(r => `
                <tr>
                    <td>${r.bu_no}</td><td>${r.so_nbr||'-'}</td><td>${r.xitems||'-'}</td>
                    <td>${r.client_name||'-'}</td><td>${r.DN_date||'-'}</td>
                    <td class="num">${UI.fmt(r.DN_qty)}</td><td class="num">${UI.fmt(r.so_qty)}</td>
                    ${_mgr ? `<td>
                        <button class="btn btn-sm" onclick="DNForm.open(${r.uid})">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delDN(${r.uid})">🗑</button>
                    </td>` : ''}
                </tr>`).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}
const DNForm = {
    open(uid) {
        if (uid) API.get(`/api/dn/${uid}`).then(r => this._render(r.data)).catch(e => UI.toast(e.message,'error'));
        else this._render({ bu_no: State.bu_no });
    },
    _render(d) {
        const isEdit = !!d.uid;
        UI.modal((isEdit ? t('modal.edit') : t('modal.add')) + t('dn.title'), `
            <div class="form-row">
                <div class="form-group"><label>${t('sys.business')}</label><select id="df_bu"><option>HM</option><option>HN</option><option>SZ</option></select></div>
                <div class="form-group"><label>${t('dn.so_nbr')}</label><input id="df_so" value="${d.so_nbr||''}"></div>
                <div class="form-group"><label>${t('dn.th.dn_date')}</label><input type="date" id="df_date" value="${d.DN_date||''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('po.col.xitems')}</label><input id="df_x" value="${d.xitems||''}"></div>
                <div class="form-group" style="flex:1;position:relative"><label>${t('so.col.client')}</label>
                    <input id="df_cl" value="${d.client_name||''}" style="width:100%" autocomplete="off" oninput="DNForm.onCustInput()">
                    <div id="dn_cust_list"></div>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('dn.th.dn_qty')}</label><input type="number" id="df_dq" step="0.0001" value="${d.DN_qty||0}"></div>
                <div class="form-group"><label>${t('dn.th.so_qty')}</label><input type="number" id="df_sq" step="0.0001" value="${d.so_qty||0}"></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">${t('cancel')}</button><button class="btn btn-primary" onclick="DNForm.save(${d.uid||0})">${t('save')}</button>`);
        if (d.bu_no) document.getElementById('df_bu').value = d.bu_no;
    },

    // 客戶 listbox：資料來源與銷售訂單一致（往來對象客戶 ∪ 專案主檔客戶）
    onCustInput() {
        clearTimeout(this._custTimer);
        this._custTimer = setTimeout(async () => {
            const q = document.getElementById('df_cl').value.trim();
            const list = document.getElementById('dn_cust_list');
            if (!q) { list.innerHTML = ''; return; }
            try {
                const res = await API.get(`/api/preorders/customers?q=${encodeURIComponent(q)}`);
                const rows = res.data || [];
                list.innerHTML = rows.length
                    ? `<div style="position:absolute;z-index:10050;left:0;right:0;max-height:220px;overflow-y:auto;background:#fff;border:1px solid #cbd5e1;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.15);margin-top:2px;">` +
                      rows.map(r => `<div style="padding:8px 12px;cursor:pointer;font-size:13px;display:flex;justify-content:space-between;gap:8px;"
                            onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background=''"
                            onclick="DNForm.pickCustomer('${(r.customer_name || '').replace(/'/g, "\\'")}')">
                            <span>${r.customer_name || ''}</span><span style="color:#94a3b8;font-size:12px;">${r.customer_id}</span>
                       </div>`).join('') + `</div>`
                    : '';
            } catch { list.innerHTML = ''; }
        }, 300);
    },

    // 選定客戶 → 帶出客戶名稱並關閉 listbox
    pickCustomer(customerName) {
        document.getElementById('df_cl').value = customerName;
        document.getElementById('dn_cust_list').innerHTML = '';
    },
    async save(uid) {
        const body = {
            bu_no: document.getElementById('df_bu').value,
            so_nbr: document.getElementById('df_so').value,
            xitems: document.getElementById('df_x').value,
            client_name: document.getElementById('df_cl').value,
            DN_date: document.getElementById('df_date').value || null,
            DN_qty: Number(document.getElementById('df_dq').value)||0,
            so_qty: Number(document.getElementById('df_sq').value)||0,
        };
        try {
            if (uid) await API.put(`/api/dn/${uid}`, body); else await API.post('/api/dn', body);
            UI.toast(uid ? t('saved') : t('dn.msg.added'), 'success'); UI.closeModal(); loadDN();
        } catch(e) { UI.toast(e.message,'error'); }
    }
};
async function delDN(uid) {
    if (!confirm(t('confirm_delete'))) return;
    try { await API.del(`/api/dn/${uid}`); UI.toast(t('deleted'),'success'); loadDN(); }
    catch(e) { UI.toast(e.message,'error'); }
}
