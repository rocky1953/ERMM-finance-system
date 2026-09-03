/**
 * 往來對象 relation_detail CRUD（客戶 / 供應商 / 關係人主檔）
 */
registerPage('relation', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <label>公司別：<select id="relBU" onchange="loadRelation()"><option value="">全部</option>
                    <option value="HM">HM</option><option value="HN">HN</option><option value="SZ">SZ</option></select></label>
                <label>類型：<select id="relType" onchange="loadRelation()"><option value="">全部</option>
                    <option value="客戶">客戶</option><option value="供應商">供應商</option><option value="關係人">關係人</option></select></label>
                <label>狀態：<select id="relFlag" onchange="loadRelation()"><option value="">全部</option>
                    <option value="USE">啟用</option><option value="STOP">停用</option></label>
                <button class="btn btn-primary" onclick="RelationForm.open()">➕ 新增往來對象</button>
                <button class="btn btn-success" onclick="loadRelation()">🔄</button>
            </div>
            <div id="relationTable">載入中...</div>
        </div>
    `;
    document.getElementById('relBU').value = State.bu_no;
    loadRelation();
});

async function loadRelation() {
    const el = document.getElementById('relationTable');
    try {
        const bu = document.getElementById('relBU').value;
        const type = document.getElementById('relType').value;
        const flag = document.getElementById('relFlag').value;
        const res = await API.get(`/api/relation?bu_no=${bu}&relation_type=${encodeURIComponent(type)}&inuse_flag=${flag}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = '<p style="color:#95a5a6;text-align:center;padding:40px;">👥 尚無往來對象</p>'; return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>公司別</th><th>類型</th><th>編號</th><th>名稱</th>
                <th>聯絡人</th><th>電話</th><th>稅號</th><th>狀態</th><th>操作</th>
            </tr></thead>
            <tbody>${rows.map(r => `
                <tr>
                    <td>${r.bu_no}</td>
                    <td><span style="padding:2px 8px;border-radius:10px;font-size:0.8em;background:${
                        r.relation_type==='客戶' ? '#e8f6f3' : r.relation_type==='供應商' ? '#fef5e7' : '#f4ecf7'
                    };color:#333">${r.relation_type||'-'}</span></td>
                    <td>${r.relation_id}</td><td>${r.relation_name||'-'}</td>
                    <td>${r.contact_person||'-'}</td><td>${r.contact_phone||'-'}</td>
                    <td>${r.tax_id||'-'}</td>
                    <td>${r.inuse_flag==='USE' ? '<span style="color:#27ae60">●</span>' : '<span style="color:#95a5a6">○</span>'}</td>
                    <td>
                        <button class="btn btn-sm" onclick="RelationForm.open(${r.uid})">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delRelation(${r.uid})">🗑</button>
                    </td>
                </tr>
            `).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

const RelationForm = {
    open(uid) {
        if (uid) {
            API.get(`/api/relation/${uid}`).then(res => this._render(res.data))
               .catch(e => UI.toast(e.message,'error'));
        } else {
            this._render({ bu_no: State.bu_no, inuse_flag: 'USE', relation_type: '供應商' });
        }
    },
    _render(d) {
        const isEdit = !!d.uid;
        UI.modal((isEdit ? '編輯' : '新增') + '往來對象', `
            <div class="form-row">
                <div class="form-group"><label>公司別</label>
                    <select id="rf_bu"><option>HM</option><option>HN</option><option>SZ</option></select></div>
                <div class="form-group"><label>類型</label>
                    <select id="rf_type"><option>客戶</option><option>供應商</option><option>關係人</option></select></div>
                <div class="form-group"><label>狀態</label>
                    <select id="rf_flag"><option value="USE">啟用</option><option value="STOP">停用</option></select></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>編號</label><input id="rf_id" value="${d.relation_id||''}"></div>
                <div class="form-group" style="flex:1"><label>名稱</label><input id="rf_name" value="${d.relation_name||''}" style="width:100%"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>聯絡人</label><input id="rf_ctc" value="${d.contact_person||''}"></div>
                <div class="form-group"><label>電話</label><input id="rf_phone" value="${d.contact_phone||''}"></div>
                <div class="form-group"><label>稅號</label><input id="rf_tax" value="${d.tax_id||''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group" style="flex:1"><label>地址</label><input id="rf_addr" value="${d.address||''}" style="width:100%"></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">取消</button><button class="btn btn-primary" onclick="RelationForm.save(${d.uid||0})">存檔</button>`);
        if (d.bu_no) document.getElementById('rf_bu').value = d.bu_no;
        if (d.relation_type) document.getElementById('rf_type').value = d.relation_type;
        if (d.inuse_flag) document.getElementById('rf_flag').value = d.inuse_flag;
    },
    async save(uid) {
        const body = {
            bu_no: document.getElementById('rf_bu').value,
            relation_type: document.getElementById('rf_type').value,
            relation_id: document.getElementById('rf_id').value,
            relation_name: document.getElementById('rf_name').value,
            contact_person: document.getElementById('rf_ctc').value,
            contact_phone: document.getElementById('rf_phone').value,
            address: document.getElementById('rf_addr').value,
            tax_id: document.getElementById('rf_tax').value,
            inuse_flag: document.getElementById('rf_flag').value,
        };
        try {
            if (uid) await API.put(`/api/relation/${uid}`, body);
            else await API.post('/api/relation', body);
            UI.toast(uid ? '已更新' : '已新增', 'success');
            UI.closeModal(); loadRelation();
        } catch(e) { UI.toast(e.message,'error'); }
    }
};

async function delRelation(uid) {
    if (!confirm('確定刪除此往來對象？')) return;
    try { await API.del(`/api/relation/${uid}`); UI.toast('已刪除','success'); loadRelation(); }
    catch(e) { UI.toast(e.message,'error'); }
}
