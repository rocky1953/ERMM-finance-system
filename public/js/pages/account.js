/**
 * 帳戶明細 mgm_account_details CRUD
 */
registerPage('account', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <label>${t('sys.business')}：<select id="aBU" onchange="loadAccount()"><option value="">${t('sys.all')}</option>
                    <option>HM</option><option>HN</option><option>SZ</option></select></label>
                <label>${t('monthly.ym')}：<input type="month" id="aYM" onchange="loadAccount()"></label>
                <button class="btn btn-primary" onclick="AccountForm.open()">➕ ${t('account.btn.add')}</button>
                <button class="btn btn-success" onclick="loadAccount()">🔄 ${t('refresh')}</button>
            </div>
            <div id="accountTable">${t('loading')}</div>
        </div>
    `;
    document.getElementById('aBU').value = State.bu_no;
    if (State.YYYY_MM) document.getElementById('aYM').value = State.YYYY_MM.replace('/', '-');
    loadAccount();
});
async function loadAccount() {
    const el = document.getElementById('accountTable');
    try {
        const res = await API.get(`/api/account?bu_no=${document.getElementById('aBU').value}&YYYY_MM=${document.getElementById('aYM').value.replace('-','/')}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = `<p style="color:#95a5a6;text-align:center;padding:40px;">💰 ${t('account.no_data')}</p>`; return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>${t('sys.business')}</th><th>${t('monthly.ym')}</th><th>${t('account.th.type')}</th><th>${t('account.th.group')}</th><th>${t('account.th.sub_group')}</th>
                <th>${t('account.th.name')}</th><th>${t('monthly.th.amount')}</th><th>${t('monthly.th.drcr')}</th><th>${t('monthly.th.remark')}</th><th>${t('system.col.action')}</th>
            </tr></thead>
            <tbody>${rows.map(r => `
                <tr>
                    <td>${r.bu_no}</td><td>${r.YYYY_MM||'-'}</td><td>${r.acct_type||'-'}</td>
                    <td>${r.group_id||'-'}</td><td>${r.sub_group||'-'}</td>
                    <td>${r.acct_name||'-'}</td><td class="num">${UI.fmt(r.sub_amt)}</td>
                    <td>${r.DB_CR||'-'}</td><td>${r.remark||'-'}</td>
                    <td>
                        <button class="btn btn-sm" onclick="AccountForm.open(${r.uid})">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delAccount(${r.uid})">🗑</button>
                    </td>
                </tr>`).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}
const AccountForm = {
    open(uid) {
        if (uid) API.get(`/api/account/${uid}`).then(r => this._render(r.data)).catch(e => UI.toast(e.message,'error'));
        else this._render({ bu_no: State.bu_no });
    },
    _render(d) {
        const isEdit = !!d.uid;
        UI.modal((isEdit ? t('modal.edit') : t('modal.add')) + t('account.title'), `
            <div class="form-row">
                <div class="form-group"><label>${t('sys.business')}</label><select id="af_bu"><option>HM</option><option>HN</option><option>SZ</option></select></div>
                <div class="form-group"><label>${t('monthly.ym')}</label><input type="month" id="af_ym" value="${(d.YYYY_MM||'').replace('/','-')}"></div>
                <div class="form-group"><label>${t('account.th.type')}</label><input id="af_type" value="${d.acct_type||''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('account.th.group')}</label><input id="af_grp" value="${d.group_id||''}"></div>
                <div class="form-group"><label>${t('account.th.sub_group')}</label><input id="af_sub" value="${d.sub_group||''}"></div>
                <div class="form-group"><label>${t('monthly.th.drcr')}</label><select id="af_dc"><option value="DR">DR</option><option value="CR">CR</option></select></div>
            </div>
            <div class="form-row">
                <div class="form-group" style="flex:1"><label>${t('account.th.name')}</label><input id="af_name" value="${d.acct_name||''}" style="width:100%"></div>
                <div class="form-group"><label>${t('monthly.th.amount')}</label><input type="number" id="af_amt" value="${d.sub_amt||0}" step="0.01"></div>
            </div>
            <div class="form-row">
                <div class="form-group" style="flex:1"><label>${t('monthly.th.remark')}</label><input id="af_remark" value="${d.remark||''}" style="width:100%"></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">${t('cancel')}</button><button class="btn btn-primary" onclick="AccountForm.save(${d.uid||0})">${t('save')}</button>`);
        if (d.bu_no) document.getElementById('af_bu').value = d.bu_no;
        if (d.DB_CR) document.getElementById('af_dc').value = d.DB_CR;
    },
    async save(uid) {
        const body = {
            bu_no: document.getElementById('af_bu').value,
            YYYY_MM: document.getElementById('af_ym').value.replace('-','/'),
            acct_type: document.getElementById('af_type').value,
            group_id: document.getElementById('af_grp').value,
            sub_group: document.getElementById('af_sub').value,
            acct_name: document.getElementById('af_name').value,
            sub_amt: Number(document.getElementById('af_amt').value)||0,
            DB_CR: document.getElementById('af_dc').value,
            remark: document.getElementById('af_remark').value,
        };
        try {
            if (uid) await API.put(`/api/account/${uid}`, body); else await API.post('/api/account', body);
            UI.toast(uid ? t('saved') : t('account.msg.added'), 'success'); UI.closeModal(); loadAccount();
        } catch(e) { UI.toast(e.message,'error'); }
    }
};
async function delAccount(uid) {
    if (!confirm(t('confirm_delete'))) return;
    try { await API.del(`/api/account/${uid}`); UI.toast(t('deleted'),'success'); loadAccount(); }
    catch(e) { UI.toast(e.message,'error'); }
}
