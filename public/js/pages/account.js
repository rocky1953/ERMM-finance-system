/**
 * 帳戶明細 mgm_account_details CRUD
 */
registerPage('account', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <label>公司別：<select id="aBU" onchange="loadAccount()"><option value="">全部</option>
                    <option>HM</option><option>HN</option><option>SZ</option></select></label>
                <label>年月：<input type="month" id="aYM" onchange="loadAccount()"></label>
                <button class="btn btn-primary" onclick="AccountForm.open()">➕ 新增</button>
                <button class="btn btn-success" onclick="loadAccount()">🔄</button>
            </div>
            <div id="accountTable">載入中...</div>
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
        if (rows.length === 0) { el.innerHTML = '<p style="color:#95a5a6;text-align:center;padding:40px;">💰 尚無帳戶明細</p>'; return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>公司別</th><th>年月</th><th>類型</th><th>大類</th><th>子科目</th>
                <th>名稱</th><th>金額</th><th>DR/CR</th><th>備註</th><th>操作</th>
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
        UI.modal((isEdit ? '編輯' : '新增') + '帳戶明細', `
            <div class="form-row">
                <div class="form-group"><label>公司別</label><select id="af_bu"><option>HM</option><option>HN</option><option>SZ</option></select></div>
                <div class="form-group"><label>年月</label><input type="month" id="af_ym" value="${(d.YYYY_MM||'').replace('/','-')}"></div>
                <div class="form-group"><label>帳戶類型</label><input id="af_type" value="${d.acct_type||''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>科目大類</label><input id="af_grp" value="${d.group_id||''}"></div>
                <div class="form-group"><label>子科目</label><input id="af_sub" value="${d.sub_group||''}"></div>
                <div class="form-group"><label>DR/CR</label><select id="af_dc"><option value="DR">DR</option><option value="CR">CR</option></select></div>
            </div>
            <div class="form-row">
                <div class="form-group" style="flex:1"><label>名稱</label><input id="af_name" value="${d.acct_name||''}" style="width:100%"></div>
                <div class="form-group"><label>金額</label><input type="number" id="af_amt" value="${d.sub_amt||0}" step="0.01"></div>
            </div>
            <div class="form-row">
                <div class="form-group" style="flex:1"><label>備註</label><input id="af_remark" value="${d.remark||''}" style="width:100%"></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">取消</button><button class="btn btn-primary" onclick="AccountForm.save(${d.uid||0})">存檔</button>`);
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
            UI.toast(uid ? '已更新' : '已新增', 'success'); UI.closeModal(); loadAccount();
        } catch(e) { UI.toast(e.message,'error'); }
    }
};
async function delAccount(uid) {
    if (!confirm('確定刪除？')) return;
    try { await API.del(`/api/account/${uid}`); UI.toast('已刪除','success'); loadAccount(); }
    catch(e) { UI.toast(e.message,'error'); }
}
