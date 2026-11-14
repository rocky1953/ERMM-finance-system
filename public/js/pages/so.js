/**
 * 销售订单 SO 页面
 */
registerPage('so', async (c) => {
    const _mgr = Auth.isManager();
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                ${_mgr ? `<button class="btn btn-primary" onclick="SOForm.open()">➕ ${t('so.add')}</button>` : ''}
                <button class="btn btn-success" onclick="loadSO()">🔄 ${t('so.refresh')}</button>
            </div>
            <div id="soTable">${t('loading')}</div>
        </div>
        <div class="card">
            <div class="toolbar">
                <button class="btn btn-primary" onclick="loadPipeline()">🔄 ${t('pipe.title')}</button>
            </div>
            <div id="pipePanel">${t('loading')}</div>
        </div>
    `;
    loadSO();
    loadPipeline();
});

// COO-02 销售闭环（SO → DN → AR → 收款）
async function loadPipeline() {
    const el = document.getElementById('pipePanel');
    try {
        const [sumRes, cliRes, excRes] = await Promise.all([
            API.get(`/api/so/pipeline/summary?bu_no=${State.bu_no}`),
            API.get(`/api/so/pipeline/clients?bu_no=${State.bu_no}`),
            API.get(`/api/so/pipeline/exceptions?bu_no=${State.bu_no}&limit=10`)
        ]);
        const s = sumRes.data || {};
        const stages = s.stages || [];
        const conv = s.conversion || {};
        const clients = cliRes.data?.clients || [];
        const noInv = excRes.data?.delivered_no_invoice?.rows || [];
        const noPay = excRes.data?.invoiced_no_payment?.rows || [];

        const stageColors = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981'];

        el.innerHTML = `
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
                ${stages.map((st, i) => `
                    <div style="flex:1;min-width:170px;border:1px solid #e2e8f0;border-left:4px solid ${stageColors[i]};border-radius:8px;padding:12px">
                        <div style="font-size:12px;color:#64748b">${i + 1}. ${t('pipe.' + st.code.toLowerCase())}</div>
                        <div style="font-size:20px;font-weight:700;margin:4px 0">${UI.fmt(st.amount)}</div>
                        <div style="font-size:12px;color:#94a3b8">${st.count} ${t('mp.count')}${st.unpaid != null ? ` · ${t('aging.unpaid')} ${UI.fmt(st.unpaid)}` : ''}</div>
                    </div>`).join('')}
            </div>
            <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;font-size:13px">
                <span>SO→DN ${t('pipe.rate')}: <b>${conv.so_to_dn}%</b></span>
                <span>DN→AR ${t('pipe.rate')}: <b>${conv.dn_to_ar}%</b></span>
                <span>AR ${t('pipe.rate')}: <b>${conv.ar_collect_rate}%</b></span>
            </div>

            <h4 style="margin:8px 0">${t('pipe.clients')}</h4>
            <table class="data-table">
                <thead><tr><th>${t('mp.party')}</th><th>${t('mp.count')}</th><th>${t('pipe.amount')}</th>
                    <th>${t('pipe.unpaid')}</th><th>${t('pipe.rate')}</th><th>${t('mp.status')}</th></tr></thead>
                <tbody>${clients.map(c => `
                    <tr>
                        <td><b>${c.client_id || '-'}</b>${c.client_name ? ' — ' + c.client_name : ''}</td>
                        <td class="text-center">${c.so_cnt}</td>
                        <td class="num">${UI.fmt(c.so_amt)}</td>
                        <td class="num negative">${UI.fmt(c.unpaid_amt)}</td>
                        <td class="num">${c.closed_rate}%</td>
                        <td>${pipeStatusBadge(c.status)}</td>
                    </tr>`).join('') || `<tr><td colspan="6">${t('no_data')}</td></tr>`}</tbody>
            </table>

            <h4 style="margin:20px 0 8px">⚠️ ${t('pipe.no_invoice')} (${excRes.data?.delivered_no_invoice?.count || 0})</h4>
            ${noInv.length ? `<table class="data-table">
                <thead><tr><th>SO</th><th>${t('mp.party')}</th><th>DN ${t('pipe.amount')}</th><th>${t('mp.date')}</th><th>${t('pipe.trace')}</th></tr></thead>
                <tbody>${noInv.map(r => `
                    <tr>
                        <td><b>${r.so_nbr}</b></td>
                        <td>${r.client_name || r.client_id}</td>
                        <td class="num">${UI.fmt(r.dn_amt)}</td>
                        <td>${r.so_date ? String(r.so_date).substring(0,10) : '-'}</td>
                        <td><button class="btn btn-sm" onclick="traceOrder('${r.so_nbr}')">🔍</button></td>
                    </tr>`).join('')}</tbody>
            </table>` : `<p style="color:#64748b">${t('no_data')}</p>`}

            <h4 style="margin:20px 0 8px">⚠️ ${t('pipe.no_payment')} (${excRes.data?.invoiced_no_payment?.count || 0})</h4>
            ${noPay.length ? `<table class="data-table">
                <thead><tr><th>${t('mp.party')}</th><th>${t('aging.detail')}</th><th>${t('pipe.unpaid')}</th><th>${t('pipe.overdue')}</th></tr></thead>
                <tbody>${noPay.map(r => `
                    <tr>
                        <td>${r.client_id}</td>
                        <td>${r.invoice_no}</td>
                        <td class="num negative">${UI.fmt(r.unpaid)}</td>
                        <td class="text-center" style="color:#dc2626">${r.overdue_days}</td>
                    </tr>`).join('')}</tbody>
            </table>` : `<p style="color:#64748b">${t('no_data')}</p>`}
        `;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

function pipeStatusBadge(status) {
    const map = {
        '已收款': ['#dcfce7', '#166534'],
        '部分收款': ['#fef3c7', '#92400e'],
        '未收款': ['#fee2e2', '#991b1b'],
        '未开票': ['#e2e8f0', '#475569']
    };
    const [bg, fg] = map[status] || ['#e2e8f0', '#475569'];
    return `<span style="padding:2px 8px;border-radius:10px;background:${bg};color:${fg};font-size:12px">${status}</span>`;
}

async function traceOrder(soNbr) {
    try {
        const res = await API.get(`/api/so/pipeline/order/${encodeURIComponent(soNbr)}`);
        const d = res.data || {};
        const so = d.so || {};
        const dnRows = (d.dn?.rows || []).map(x => `
            <tr><td>${x.so_nbr}</td><td>${x.DN_date ? String(x.DN_date).substring(0,10) : '-'}</td>
            <td class="num">${UI.fmt(x.DN_qty)}</td><td class="num">${UI.fmt(x.so_qty)}</td></tr>`).join('');
        const invRows = (d.invoice?.rows || []).map(x => `
            <tr><td>${x.invoice_no}</td><td>${UI.fmt(x.sub_amt)}</td>
            <td class="num">${UI.fmt(x.payment)}</td></tr>`).join('');

        UI.modal(`🔍 ${soNbr} — ${t('pipe.trace')}`, `
            <p style="margin-bottom:8px">
                ${t('mp.party')}: <b>${so.client_name || so.client_id || '-'}</b> ·
                ${t('mp.amount')}: <b>${UI.fmt(Number(so.so_qty||0) * Number(so.unit_price||0))}</b> ·
                ${t('mp.status')}: <b>${d.chain_status || '-'}</b>
            </p>
            <h4 style="margin:12px 0 6px">${t('pipe.dn')} (${d.dn?.count || 0})</h4>
            <table class="data-table"><thead><tr><th>SO</th><th>${t('mp.date')}</th><th>DN Qty</th><th>SO Qty</th></tr></thead>
                <tbody>${dnRows || `<tr><td colspan="4">${t('no_data')}</td></tr>`}</tbody></table>
            <h4 style="margin:12px 0 6px">${t('pipe.ar')} (${d.invoice?.count || 0})</h4>
            <table class="data-table"><thead><tr><th>${t('aging.detail')}</th><th>${t('aging.invoice_amt')}</th><th>${t('recon.pay_amt')}</th></tr></thead>
                <tbody>${invRows || `<tr><td colspan="3">${t('no_data')}</td></tr>`}</tbody></table>
        `, `<button class="btn" onclick="UI.closeModal()">${t('cancel')}</button>`);
    } catch(e) { UI.toast(e.message, 'error'); }
}

async function loadSO() {
    const _mgr = Auth.isManager();
    const el = document.getElementById('soTable');
    try {
        const res = await API.get(`/api/so?bu_no=${State.bu_no}&YYYY_MM=${State.YYYY_MM}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = UI.empty('📦', t('so.no_data')); return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>${t('so.col.so_nbr')}</th><th>${t('so.col.date')}</th><th>${t('so.col.client')}</th><th>${t('so.col.xitems')}</th>
                <th>${t('so.col.qty')}</th><th>${t('so.col.dn')}</th><th>${t('so.col.price')}</th><th>${t('so.col.amount')}</th>
                <th>${t('so.col.status')}</th>${_mgr ? `<th style="width:140px">${t('so.col.action')}</th>` : ''}
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
                    <td><span style="padding:2px 8px;border-radius:10px;background:#dcfce7;color:#166534;font-size:12px">${I18N.statusLabel('so_status', r.status || '新单')}</span></td>
                    ${_mgr ? `<td>
                        <button class="btn btn-primary btn-sm" onclick='editSO(${JSON.stringify(r)})'>✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delSO(${r.uid})">🗑</button>
                    </td>` : ''}
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
    _custCache: null, // 往來對象客戶快取（按 BU）
    _custTimer: null,
    open(d) {
        d = d || {};
        const opts = I18N.statusOptions('so_status');
        const cur = d.status || '新单';

        UI.modal(this._uid ? `✏️ ${t('so.form.title_edit')} ${d.so_nbr || ''}` : `➕ ${t('so.form.title_new')}`, `
            <div class="form-row">
                <div class="form-group"><label>${t('so.form.so_nbr')}</label><input id="so_fid" value="${d.so_nbr || ''}"></div>
                <div class="form-group"><label>${t('so.form.date')}</label><input type="date" id="so_fdate" value="${(d.so_date || '').substring(0,10)}"></div>
                <div class="form-group" style="position:relative"><label>${t('so.form.client_id')}</label>
                    <input id="so_fcid" value="${d.client_id || ''}" autocomplete="off" oninput="SOForm.onCustInput()">
                    <div id="so_cust_list"></div>
                </div>
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
        this.preloadCustomers();
    },

    // 客戶來源與預估訂單一致：往來對象客戶 ∪ 專案主檔客戶（/api/preorders/customers）
    async preloadCustomers() { /* 改為即時查詢，無需預載 */ },

    // 客戶 ID 輸入 → 300ms 防抖後查詢 listbox（含 CUST-xxx 與 HM/HN/SZ-Cxxx）
    onCustInput() {
        clearTimeout(this._custTimer);
        this._custTimer = setTimeout(async () => {
            const q = document.getElementById('so_fcid').value.trim();
            const list = document.getElementById('so_cust_list');
            if (!q) { list.innerHTML = ''; return; }
            try {
                const res = await API.get(`/api/preorders/customers?q=${encodeURIComponent(q)}`);
                const rows = res.data || [];
                list.innerHTML = rows.length
                    ? `<div style="position:absolute;z-index:10050;left:0;right:0;max-height:220px;overflow-y:auto;background:#fff;border:1px solid #cbd5e1;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.15);margin-top:2px;">` +
                      rows.map(r => `<div style="padding:8px 12px;cursor:pointer;font-size:13px;display:flex;justify-content:space-between;gap:8px;"
                            onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background=''"
                            onclick="SOForm.pickCustomer('${(r.customer_id || '').replace(/'/g, "\\'")}','${(r.customer_name || '').replace(/'/g, "\\'")}')">
                            <span>${r.customer_name || ''}</span><span style="color:#94a3b8;font-size:12px;">${r.customer_id}</span>
                       </div>`).join('') + `</div>`
                    : '';
            } catch { list.innerHTML = ''; }
        }, 300);
    },

    // 選定客戶 → 帶出客戶名稱並關閉 listbox
    pickCustomer(customerId, customerName) {
        document.getElementById('so_fcid').value = customerId;
        document.getElementById('so_fcn').value = customerName;
        document.getElementById('so_cust_list').innerHTML = '';
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
                try {
                    await API.post('/api/so', body);
                } catch (e) {
                    // COO-03 信用额度超限：管理员可强制放行
                    const forceTip = {
                        'zh-CN': '是否强制放行（管理员）？',
                        'zh-TW': '是否強制放行（管理員）？',
                        en: 'Force release as admin?'
                    }[I18N.lang] || '是否强制放行（管理员）？';
                    if (String(e.message).indexOf('信用') >= 0 && Auth.isAdmin() && confirm(`${e.message}\n\n${forceTip}`)) {
                        body.force = true;
                        await API.post('/api/so', body);
                    } else { throw e; }
                }
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
