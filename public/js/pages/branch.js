/**
 * 分公司 branch_detail CRUD
 */
registerPage('branch', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <label>公司別：<select id="brBU" onchange="loadBranch()"><option value="">全部</option>
                    <option value="HM">HM</option><option value="HN">HN</option><option value="SZ">SZ</option></select></label>
                <label>狀態：<select id="brFlag" onchange="loadBranch()"><option value="">全部</option>
                    <option value="USE">啟用</option><option value="STOP">停用</option></select></label>
                <button class="btn btn-primary" onclick="BranchForm.open()">➕ 新增分公司</button>
                <button class="btn btn-success" onclick="loadBranch()">🔄</button>
            </div>
            <div id="branchTable">載入中...</div>
        </div>
    `;
    document.getElementById('brBU').value = State.bu_no;
    loadBranch();
});

async function loadBranch() {
    const el = document.getElementById('branchTable');
    try {
        const bu = document.getElementById('brBU').value;
        const flag = document.getElementById('brFlag').value;
        const res = await API.get(`/api/branch?bu_no=${bu}&inuse_flag=${flag}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = '<p style="color:#95a5a6;text-align:center;padding:40px;">🏢 尚無分公司資料</p>'; return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>公司別</th><th>分公司 ID</th><th>名稱</th><th>地址</th>
                <th>電話</th><th>主管</th><th>狀態</th><th>操作</th>
            </tr></thead>
            <tbody>${rows.map(r => `
                <tr>
                    <td>${r.bu_no}</td><td>${r.branch_id}</td><td>${r.branch_name||'-'}</td>
                    <td>${r.branch_address||'-'}</td><td>${r.branch_phone||'-'}</td>
                    <td>${r.manager||'-'}</td>
                    <td>${r.inuse_flag==='USE' ? '<span style="color:#27ae60">● 啟用</span>' : '<span style="color:#95a5a6">○ 停用</span>'}</td>
                    <td>
                        <button class="btn btn-sm" onclick="BranchForm.open(${r.uid})">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delBranch(${r.uid})">🗑</button>
                    </td>
                </tr>
            `).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

const BranchForm = {
    open(uid) {
        if (uid) {
            API.get(`/api/branch/${uid}`).then(res => this._render(res.data))
               .catch(e => UI.toast(e.message,'error'));
        } else {
            this._render({ bu_no: State.bu_no, inuse_flag: 'USE' });
        }
    },
    _render(d) {
        const isEdit = !!d.uid;
        UI.modal((isEdit ? '編輯' : '新增') + '分公司', `
            <div class="form-row">
                <div class="form-group"><label>公司別</label>
                    <select id="bf_bu"><option>HM</option><option>HN</option><option>SZ</option></select></div>
                <div class="form-group"><label>分公司 ID</label><input id="bf_id" value="${d.branch_id||''}"></div>
                <div class="form-group"><label>狀態</label>
                    <select id="bf_flag"><option value="USE">啟用</option><option value="STOP">停用</option></select></div>
            </div>
            <div class="form-row">
                <div class="form-group" style="flex:1"><label>名稱</label><input id="bf_name" value="${d.branch_name||''}"></div>
                <div class="form-group"><label>電話</label><input id="bf_phone" value="${d.branch_phone||''}"></div>
                <div class="form-group"><label>主管</label><input id="bf_mgr" value="${d.manager||''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group" style="flex:1"><label>地址</label><input id="bf_addr" value="${d.branch_address||''}" style="width:100%"></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">取消</button><button class="btn btn-primary" onclick="BranchForm.save(${d.uid||0})">存檔</button>`);
        if (d.bu_no) document.getElementById('bf_bu').value = d.bu_no;
        if (d.inuse_flag) document.getElementById('bf_flag').value = d.inuse_flag;
    },
    async save(uid) {
        const body = {
            bu_no: document.getElementById('bf_bu').value,
            branch_id: document.getElementById('bf_id').value,
            branch_name: document.getElementById('bf_name').value,
            branch_address: document.getElementById('bf_addr').value,
            branch_phone: document.getElementById('bf_phone').value,
            manager: document.getElementById('bf_mgr').value,
            inuse_flag: document.getElementById('bf_flag').value,
        };
        try {
            if (uid) await API.put(`/api/branch/${uid}`, body);
            else await API.post('/api/branch', body);
            UI.toast(uid ? '已更新' : '已新增', 'success');
            UI.closeModal(); loadBranch();
        } catch(e) { UI.toast(e.message,'error'); }
    }
};

async function delBranch(uid) {
    if (!confirm('確定刪除此分公司？')) return;
    try { await API.del(`/api/branch/${uid}`); UI.toast('已刪除','success'); loadBranch(); }
    catch(e) { UI.toast(e.message,'error'); }
}
