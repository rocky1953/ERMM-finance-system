/**
 * 銷售預估訂單頁面（含客戶→專案自動帶出 listbox）
 */
registerPage('preorder', async (c) => {
    c.innerHTML = `
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
        </style>
    `;
    loadPreorders();
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
