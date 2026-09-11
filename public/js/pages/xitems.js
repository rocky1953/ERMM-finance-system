/**
 * 每日庫存狀態 e2_xitems_daily_status CRUD
 * ageing_days × reduce_percentage → 自動算 current_value / current_lose
 */
registerPage('xitems', async (c) => {
    const ageingOpts = [
        { value: '',  label: t('sys.all') },
        { value: 'A 正常',     label: t('xi.aging_A') },
        { value: 'B 31-90天',  label: t('xi.aging_B') },
        { value: 'C 91-180天', label: t('xi.aging_C') },
        { value: 'D 超過180天', label: t('xi.aging_D') }
    ];
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <label>${t('topbar.bu')}：<select id="xiBU" onchange="loadXitems()"><option value="">${t('sys.all')}</option>
                    <option>HM</option><option>HN</option><option>SZ</option></select></label>
                <label>${t('xi.aging_label')}：<select id="xiAge" onchange="loadXitems()">
                    ${ageingOpts.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
                </select></label>
                <button class="btn btn-primary" onclick="XitemsForm.open()">➕ ${t('xi.add')}</button>
                <button class="btn btn-warning" onclick="recalcXitems()">🔄 ${t('xi.recalc')}</button>
                <button class="btn btn-success" onclick="loadXitems()">🔄</button>
            </div>
            <div id="xitemsTable">${t('loading')}</div>
        </div>
    `;
    document.getElementById('xiBU').value = State.bu_no;
    loadXitems();
});

async function loadXitems() {
    const el = document.getElementById('xitemsTable');
    try {
        const res = await API.get(`/api/xitems?bu_no=${document.getElementById('xiBU').value}&ageing_category=${encodeURIComponent(document.getElementById('xiAge').value)}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = `<p style="color:#95a5a6;text-align:center;padding:40px;">📦 ${t('xi.no_data')}</p>`; return; }
        const totals = rows.reduce((a,r) => { a.stock += Number(r.stock_value||0); a.cur += Number(r.current_value||0); a.lose += Number(r.current_lose||0); return a; }, {stock:0,cur:0,lose:0});
        el.innerHTML = `
            <div style="padding:12px;margin-bottom:12px;background:#f4f6f7;border-radius:6px;display:flex;gap:20px;">
                <span><b>${t('xi.stat.count')}:</b> ${rows.length}</span>
                <span><b>${t('xi.stat.orig')}:</b> ${UI.fmt(totals.stock)}</span>
                <span style="color:#27ae60"><b>${t('xi.stat.after')}:</b> ${UI.fmt(totals.cur)}</span>
                <span style="color:#e74c3c"><b>${t('xi.stat.lose')}:</b> ${UI.fmt(totals.lose)}</span>
            </div>
            <table class="data-table">
            <thead><tr>
                <th>${t('xi.col.bu')}</th><th>${t('xi.col.xitems')}</th><th>${t('xi.col.name')}</th><th>${t('xi.col.qty')}</th><th>${t('xi.col.price')}</th><th>${t('xi.col.rate')}</th>
                <th>${t('xi.col.orig')}</th><th>${t('xi.col.ageing')}</th><th>${t('xi.col.discount')}</th><th>${t('xi.col.disc_amt')}</th><th>${t('xi.col.gain')}</th><th>${t('xi.col.action')}</th>
            </tr></thead>
            <tbody>${rows.map(r => {
                const lose = Number(r.current_lose||0);
                const labelAgeing = r.ageing_days
                    ? `${r.ageing_days}${t('xi.aging_days')} <small>(${I18N.statusLabel('xi_aging_map', r.ageing_category || '') || r.ageing_category || '-'})</small>`
                    : '-';
                return `
                <tr>
                    <td>${r.bu_no}</td><td>${r.xitems||'-'}</td><td>${r.item_name||'-'}</td>
                    <td class="num">${UI.fmt(r.qty_balance, 4)}</td><td class="num">${UI.fmt(r.unit_price, 6)}</td>
                    <td class="num">${UI.fmt(r.exchange_rate, 4)}</td>
                    <td class="num">${UI.fmt(r.stock_value)}</td>
                    <td>${labelAgeing}</td>
                    <td class="num" style="color:${lose>0?'#e74c3c':'#27ae60'}">${r.reduce_percentage||0}%</td>
                    <td class="num">${UI.fmt(r.current_value)}</td>
                    <td class="num" style="color:${lose>0?'#e74c3c':'#27ae60'}">${UI.fmt(lose)}</td>
                    <td>
                        <button class="btn btn-sm" onclick="XitemsForm.open(${r.uid})">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delXitems(${r.uid})">🗑</button>
                    </td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

const XitemsForm = {
    open(uid) {
        if (uid) API.get(`/api/xitems/${uid}`).then(r => this._render(r.data)).catch(e => UI.toast(e.message,'error'));
        else this._render({ bu_no: State.bu_no, exchange_rate: 1 });
    },
    _render(d) {
        const isEdit = !!d.uid;
        const ageingOpts = [
            { value: '', label: t('xi.aging_autogen') },
            { value: 'A 正常',     label: t('xi.aging_A') },
            { value: 'B 31-90天',  label: t('xi.aging_B') },
            { value: 'C 91-180天', label: t('xi.aging_C') },
            { value: 'D 超過180天', label: t('xi.aging_D') }
        ];
        UI.modal((isEdit ? t('modal.edit_po') : t('xi.add')), `
            <div class="form-row">
                <div class="form-group"><label>${t('xi.col.bu')}</label><select id="xi_fbu"><option>HM</option><option>HN</option><option>SZ</option></select></div>
                <div class="form-group"><label>${t('xi.col.xitems')}</label><input id="xi_fx" value="${d.xitems||''}"></div>
                <div class="form-group"><label>${t('xi.form.date_label')}</label><input type="date" id="xi_fdate" value="${d.stock_date||''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group" style="flex:1"><label>${t('xi.col.name')}</label><input id="xi_fn" value="${d.item_name||''}" style="width:100%"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('xi.col.qty')}</label><input type="number" step="0.0001" id="xi_fq" value="${d.qty_balance||0}"></div>
                <div class="form-group"><label>${t('xi.col.price')}</label><input type="number" step="0.000001" id="xi_fup" value="${d.unit_price||0}"></div>
                <div class="form-group"><label>${t('tp.col.rate')}</label><input type="number" step="0.0001" id="xi_frate" value="${d.exchange_rate||1}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('xi.aging_days_label')}</label><input type="number" id="xi_fage" value="${d.ageing_days||0}"></div>
                <div class="form-group"><label>${t('xi.reduce_pct_label')}</label><input type="number" step="0.01" id="xi_freduce" value="${d.reduce_percentage||0}"></div>
                <div class="form-group"><label>${t('xi.aging_label')}</label>
                    <select id="xi_fcat">
                        ${ageingOpts.map(o => `<option value="${o.value}" ${o.value === (d.ageing_category||'') ? 'selected' : ''}>${o.label}</option>`).join('')}
                    </select></div>
            </div>
            <div style="padding:8px 12px;background:#eafaf1;border-radius:6px;color:#1e8449;font-size:0.85em;">
                💡 ${t('xi.hint_formula')}
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">${t('xi.btn.cancel')}</button><button class="btn btn-primary" onclick="XitemsForm.save(${d.uid||0})">${t('xi.btn.save')}</button>`);
        if (d.bu_no) document.getElementById('xi_fbu').value = d.bu_no;
        if (d.ageing_category) document.getElementById('xi_fcat').value = d.ageing_category;
    },
    async save(uid) {
        const body = {
            bu_no: document.getElementById('xi_fbu').value,
            xitems: document.getElementById('xi_fx').value,
            item_name: document.getElementById('xi_fn').value,
            qty_balance: Number(document.getElementById('xi_fq').value)||0,
            unit_price: Number(document.getElementById('xi_fup').value)||0,
            exchange_rate: Number(document.getElementById('xi_frate').value)||1,
            ageing_days: Number(document.getElementById('xi_fage').value)||0,
            reduce_percentage: Number(document.getElementById('xi_freduce').value)||0,
            ageing_category: document.getElementById('xi_fcat').value || null,
            stock_date: document.getElementById('xi_fdate').value || null,
        };
        try {
            if (uid) await API.put(`/api/xitems/${uid}`, body); else await API.post('/api/xitems', body);
            UI.toast(uid ? t('po.msg.updated') : t('po.msg.added'), 'success'); UI.closeModal(); loadXitems();
        } catch(e) { UI.toast(e.message,'error'); }
    }
};
async function delXitems(uid) {
    if (!confirm(t('confirm_delete'))) return;
    try { await API.del(`/api/xitems/${uid}`); UI.toast(t('xi.msg.deleted'),'success'); loadXitems(); }
    catch(e) { UI.toast(e.message,'error'); }
}
async function recalcXitems() {
    try {
        const res = await API.post('/api/xitems/recalc', { bu_no: State.bu_no });
        UI.toast(res.message || `${t('xi.msg.recalc')} (${res.data?.updated||0})`, 'success'); loadXitems();
    } catch(e) { UI.toast(e.message,'error'); }
}
