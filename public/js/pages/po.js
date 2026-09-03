/**
 * 採購單 PO 頁面
 */
registerPage('po', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <button class="btn btn-primary" onclick="POForm.open()">➕ 新增採購單</button>
                <button class="btn btn-success" onclick="loadPO()">🔄 刷新</button>
            </div>
            <div id="poTable">載入中...</div>
        </div>
    `;
    loadPO();
});

async function loadPO() {
    const el = document.getElementById('poTable');
    try {
        const res = await API.get(`/api/po?bu_no=${State.bu_no}&YYYY_MM=${State.YYYY_MM}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = UI.empty('🛒', '尚無採購單資料'); return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>PO 編號</th><th>日期</th><th>供應商</th><th>物料</th>
                <th>數量</th><th>單價</th><th>總額</th><th>本地幣</th>
                <th>狀態</th><th>交付</th>
                <th style="width:140px">操作</th>
            </tr></thead>
            <tbody>${rows.map(r => `
                <tr>
                    <td><b>${r.po_id || '-'}</b></td>
                    <td>${r.po_date || '-'}</td>
                    <td>${r.supplier_name || '-'}</td>
                    <td>${r.xitems || '-'}</td>
                    <td class="num">${UI.fmt(r.po_qty)}</td>
                    <td class="num">${UI.fmt(r.unit_price, 2)}</td>
                    <td class="num">${UI.fmt(r.po_amount)}</td>
                    <td class="num">${UI.fmt(r.po_amount_local)}</td>
                    <td><span style="padding:2px 8px;border-radius:10px;background:#dbeafe;color:#1e40af;font-size:12px">${r.po_status || '未審核'}</span></td>
                    <td>${r.po_sub_status || '-'}</td>
                    <td>
                        <button class="btn btn-primary btn-sm" onclick='editPO(${JSON.stringify(r)})'>✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delPO(${r.uid})">🗑</button>
                    </td>
                </tr>
            `).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

function editPO(r) {
    POForm._uid = r.uid;
    POForm.open(r);
}

const POForm = {
    _uid: null,
    open(d) {
        d = d || {};
        UI.modal(this._uid ? `✏️ 編輯 PO ${d.po_id || ''}` : '➕ 新增採購單', `
            <div class="form-row">
                <div class="form-group"><label>PO 編號</label><input id="po_fid" value="${d.po_id || ''}"></div>
                <div class="form-group"><label>日期</label><input type="date" id="po_fdate" value="${(d.po_date || '').substring(0,10)}"></div>
                <div class="form-group"><label>供應商</label><input id="po_fsup" value="${d.supplier_name || ''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>物料</label><input id="po_fmat" value="${d.xitems || ''}"></div>
                <div class="form-group"><label>數量</label><input type="number" id="po_fqty" value="${d.po_qty || 0}"></div>
                <div class="form-group"><label>單價(原幣)</label><input type="number" id="po_fup" value="${d.unit_price || 0}" step="0.0001"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>匯率</label><input type="number" id="po_frate" value="${d.exchange_rate || 1}" step="0.0001"></div>
                <div class="form-group"><label>稅額</label><input type="number" id="po_fvat" value="${d.vat_amt || 0}"></div>
                <div class="form-group"><label>狀態</label>
                    <select id="po_fstat">
                        ${['未審核','審核通過','已取消'].map(s=>`<option ${s===(d.po_status||'未審核')?'selected':''}>${s}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>交付狀態</label>
                    <select id="po_fsub">
                        ${['未交付','部分交付','交付完成'].map(s=>`<option ${s===(d.po_sub_status||'未交付')?'selected':''}>${s}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group"><label>供應商類型</label><input id="po_fsuptype" value="${d.supplier_type || ''}"></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="POForm.save()">💾 保存</button>`);
    },
    async save() {
        const body = {
            bu_no: State.bu_no,
            po_id: document.getElementById('po_fid').value,
            supplier_name: document.getElementById('po_fsup').value,
            xitems: document.getElementById('po_fmat').value,
            po_date: document.getElementById('po_fdate').value || null,
            po_qty: Number(document.getElementById('po_fqty').value) || 0,
            unit_price: Number(document.getElementById('po_fup').value) || 0,
            exchange_rate: Number(document.getElementById('po_frate').value) || 1,
            vat_amt: Number(document.getElementById('po_fvat').value) || 0,
            po_status: document.getElementById('po_fstat').value,
            po_sub_status: document.getElementById('po_fsub').value,
            supplier_type: document.getElementById('po_fsuptype').value,
        };
        try {
            if (this._uid) {
                await API.put(`/api/po/${this._uid}`, body);
                UI.toast('已更新', 'success');
            } else {
                await API.post('/api/po', body);
                UI.toast('已新增採購單', 'success');
            }
            UI.closeModal();
            this._uid = null;
            loadPO();
        } catch(e) { UI.toast(e.message, 'error'); }
    }
};

async function delPO(uid) {
    if (!confirm('確定刪除此採購單？')) return;
    try { await API.del(`/api/po/${uid}`); UI.toast('已刪除','success'); loadPO(); }
    catch(e) { UI.toast(e.message,'error'); }
}
