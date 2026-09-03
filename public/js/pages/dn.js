/**
 * SO 交貨單 ermm_erp_so_dn CRUD
 */
registerPage('dn', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <label>公司別：<select id="dnBU" onchange="loadDN()"><option value="">全部</option>
                    <option>HM</option><option>HN</option><option>SZ</option></select></label>
                <label>SO 編號：<input id="dnSO" onchange="loadDN()"></label>
                <button class="btn btn-primary" onclick="DNForm.open()">➕ 新增交貨單</button>
                <button class="btn btn-success" onclick="loadDN()">🔄</button>
            </div>
            <div id="dnTable">載入中...</div>
        </div>
    `;
    document.getElementById('dnBU').value = State.bu_no;
    loadDN();
});
async function loadDN() {
    const el = document.getElementById('dnTable');
    try {
        const res = await API.get(`/api/dn?bu_no=${document.getElementById('dnBU').value}&so_nbr=${document.getElementById('dnSO').value}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = '<p style="color:#95a5a6;text-align:center;padding:40px;">🚚 尚無交貨單</p>'; return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>公司別</th><th>SO 編號</th><th>物料</th><th>客戶</th>
                <th>交貨日</th><th>交貨數</th><th>SO 數</th><th>操作</th>
            </tr></thead>
            <tbody>${rows.map(r => `
                <tr>
                    <td>${r.bu_no}</td><td>${r.so_nbr||'-'}</td><td>${r.xitems||'-'}</td>
                    <td>${r.client_name||'-'}</td><td>${r.DN_date||'-'}</td>
                    <td class="num">${UI.fmt(r.DN_qty)}</td><td class="num">${UI.fmt(r.so_qty)}</td>
                    <td>
                        <button class="btn btn-sm" onclick="DNForm.open(${r.uid})">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delDN(${r.uid})">🗑</button>
                    </td>
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
        UI.modal((isEdit ? '編輯' : '新增') + '交貨單', `
            <div class="form-row">
                <div class="form-group"><label>公司別</label><select id="df_bu"><option>HM</option><option>HN</option><option>SZ</option></select></div>
                <div class="form-group"><label>SO 編號</label><input id="df_so" value="${d.so_nbr||''}"></div>
                <div class="form-group"><label>交貨日</label><input type="date" id="df_date" value="${d.DN_date||''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>物料</label><input id="df_x" value="${d.xitems||''}"></div>
                <div class="form-group" style="flex:1"><label>客戶</label><input id="df_cl" value="${d.client_name||''}" style="width:100%"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>交貨數</label><input type="number" id="df_dq" step="0.0001" value="${d.DN_qty||0}"></div>
                <div class="form-group"><label>SO 數</label><input type="number" id="df_sq" step="0.0001" value="${d.so_qty||0}"></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">取消</button><button class="btn btn-primary" onclick="DNForm.save(${d.uid||0})">存檔</button>`);
        if (d.bu_no) document.getElementById('df_bu').value = d.bu_no;
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
            UI.toast(uid ? '已更新' : '已新增', 'success'); UI.closeModal(); loadDN();
        } catch(e) { UI.toast(e.message,'error'); }
    }
};
async function delDN(uid) {
    if (!confirm('確定刪除？')) return;
    try { await API.del(`/api/dn/${uid}`); UI.toast('已刪除','success'); loadDN(); }
    catch(e) { UI.toast(e.message,'error'); }
}
