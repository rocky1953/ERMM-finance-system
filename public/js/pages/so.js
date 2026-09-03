/**
 * 銷售訂單 SO 頁面
 */
registerPage('so', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <button class="btn btn-primary" onclick="SOForm.open()">➕ 新增銷售訂單</button>
                <button class="btn btn-success" onclick="loadSO()">🔄 刷新</button>
            </div>
            <div id="soTable">載入中...</div>
        </div>
    `;
    loadSO();
});

async function loadSO() {
    const el = document.getElementById('soTable');
    try {
        const res = await API.get(`/api/so?bu_no=${State.bu_no}&YYYY_MM=${State.YYYY_MM}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = UI.empty('📦', '尚無銷售訂單資料'); return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>SO 編號</th><th>日期</th><th>客戶</th><th>物料</th>
                <th>訂單數</th><th>出貨數</th><th>單價</th><th>金額</th>
                <th>狀態</th><th style="width:140px">操作</th>
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
                    <td><span style="padding:2px 8px;border-radius:10px;background:#dcfce7;color:#166534;font-size:12px">${r.status || '-'}</span></td>
                    <td>
                        <button class="btn btn-primary btn-sm" onclick='editSO(${JSON.stringify(r)})'>✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delSO(${r.uid})">🗑</button>
                    </td>
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
    open(d) {
        d = d || {};
        UI.modal(this._uid ? `✏️ 編輯 SO ${d.so_nbr || ''}` : '➕ 新增銷售訂單', `
            <div class="form-row">
                <div class="form-group"><label>SO 編號</label><input id="so_fid" value="${d.so_nbr || ''}"></div>
                <div class="form-group"><label>日期</label><input type="date" id="so_fdate" value="${(d.so_date || '').substring(0,10)}"></div>
                <div class="form-group"><label>客戶 ID</label><input id="so_fcid" value="${d.client_id || ''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>客戶名稱</label><input id="so_fcn" value="${d.client_name || ''}"></div>
                <div class="form-group"><label>物料</label><input id="so_fmat" value="${d.xitems || ''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>訂單數</label><input type="number" id="so_fqty" value="${d.so_qty || 0}"></div>
                <div class="form-group"><label>出貨數</label><input type="number" id="so_fdn" value="${d.dn_qty || 0}"></div>
                <div class="form-group"><label>單價</label><input type="number" id="so_fup" value="${d.unit_price || 0}" step="0.0001"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>狀態</label>
                    <select id="so_fstat">
                        ${['新單','已出貨','已交付','已取消'].map(s=>`<option ${s===(d.status||'新單')?'selected':''}>${s}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group"><label>備註</label><input id="so_frem" value="${(d.remark||'').substring(0,80)}"></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="SOForm.save()">💾 保存</button>`);
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
                UI.toast('已更新', 'success');
            } else {
                await API.post('/api/so', body);
                UI.toast('已新增銷售訂單', 'success');
            }
            UI.closeModal();
            this._uid = null;
            loadSO();
        } catch(e) { UI.toast(e.message, 'error'); }
    }
};

async function delSO(uid) {
    if (!confirm('確定刪除此銷售訂單？')) return;
    try { await API.del(`/api/so/${uid}`); UI.toast('已刪除','success'); loadSO(); }
    catch(e) { UI.toast(e.message,'error'); }
}
