/**
 * 使用者管理頁面
 * tab 1: cams_xuser 使用者 CRUD
 * tab 2: leader_user 權限編輯
 * tab 3: login_user_record 登入紀錄（唯讀 + 清除）
 */
registerPage('user', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div style="border-bottom:2px solid #ecf0f1;margin-bottom:16px;display:flex;gap:0;">
                <button class="btn" id="tabUsers" onclick="switchTab('users')" style="border-radius:6px 6px 0 0;border-bottom:none;background:#3498db;color:white;">👤 使用者</button>
                <button class="btn" id="tabPerms" onclick="switchTab('perms')" style="border-radius:6px 6px 0 0;border-bottom:none;background:transparent;color:#7f8c8d;">🔐 權限</button>
                <button class="btn" id="tabLogins" onclick="switchTab('logins')" style="border-radius:6px 6px 0 0;border-bottom:none;background:transparent;color:#7f8c8d;">📜 登入紀錄</button>
            </div>

            <div id="paneUsers">
                <div class="toolbar">
                    <label>狀態：<select id="ufFlag" onchange="loadUsers()"><option value="">全部</option>
                        <option value="USE">啟用</option><option value="STOP">停用</option></select></label>
                    <button class="btn btn-primary" onclick="UserForm.open()">➕ 新增使用者</button>
                    <button class="btn btn-success" onclick="loadUsers()">🔄</button>
                </div>
                <div id="userTable">載入中...</div>
            </div>

            <div id="panePerms" style="display:none;">
                <div class="toolbar">
                    <label>使用者：<select id="puUser" onchange="loadPerms()"></select></label>
                    <button class="btn btn-success" onclick="loadPerms()">🔄</button>
                    <button class="btn btn-primary" onclick="savePerms()">💾 存檔權限</button>
                </div>
                <div id="permsTable">載入中...</div>
            </div>

            <div id="paneLogins" style="display:none;">
                <div class="toolbar">
                    <label>使用者：<select id="luUser" onchange="loadLogins()"><option value="">全部</option></select></label>
                    <button class="btn btn-success" onclick="loadLogins()">🔄</button>
                </div>
                <div id="loginTable">載入中...</div>
            </div>
        </div>
    `;
    loadUsers();
});

function switchTab(name) {
    ['users','perms','logins'].forEach(n => {
        const btn = document.getElementById('tab' + n.charAt(0).toUpperCase() + n.slice(1));
        const pane = document.getElementById('pane' + n.charAt(0).toUpperCase() + n.slice(1));
        if (n === name) {
            btn.style.background = '#3498db'; btn.style.color = 'white'; btn.style.borderBottom = 'none';
            pane.style.display = 'block';
        } else {
            btn.style.background = 'transparent'; btn.style.color = '#7f8c8d';
            pane.style.display = 'none';
        }
    });
    if (name === 'perms') loadPerms();
    if (name === 'logins') loadLogins();
}

// ── Tab 1: 使用者 CRUD ──
async function loadUsers() {
    const el = document.getElementById('userTable');
    try {
        const res = await API.get(`/api/user?inuse_flag=${document.getElementById('ufFlag').value}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = '<p style="color:#95a5a6;text-align:center;padding:40px;">👤 尚無使用者</p>'; return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr><th>帳號</th><th>姓名</th><th>部門</th><th>狀態</th><th>建立時間</th><th>操作</th></tr></thead>
            <tbody>${rows.map(r => `
                <tr><td>${r.xuser_id}</td><td>${r.xuser_name||'-'}</td><td>${r.xuser_dept||'-'}</td>
                    <td>${r.inuse_flag==='USE' ? '<span style="color:#27ae60">● 啟用</span>' : '<span style="color:#95a5a6">○ 停用</span>'}</td>
                    <td>${r.create_time||'-'}</td>
                    <td>
                        <button class="btn btn-sm" onclick="UserForm.open(${r.id})">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delUser(${r.id},'${r.xuser_id}')">🗑</button>
                    </td></tr>`).join('')}</tbody>
        </table>`;
        // 同步填權限 tab 下拉
        const sel = document.getElementById('puUser');
        if (sel && sel.options.length <= 1) {
            sel.innerHTML = rows.map(r => `<option value="${r.xuser_id}">${r.xuser_id} — ${r.xuser_name||''}</option>`).join('');
        }
        const luSel = document.getElementById('luUser');
        if (luSel && luSel.options.length <= 1) {
            luSel.innerHTML = '<option value="">全部</option>' + rows.map(r => `<option value="${r.xuser_id}">${r.xuser_id}</option>`).join('');
        }
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

const UserForm = {
    open(id) {
        if (id) API.get(`/api/user/permissions`).then(async r => {
            const u = r.data.find(x => x.id === id || x.user_id === undefined);
            API.get(`/api/user/${id}`).catch(() => {
                // 用 permissions 裡找
            });
            this._render(u || { id });
        }).catch(e => UI.toast(e.message,'error'));
        else this._render({ inuse_flag: 'USE' });
    },
    async _render(d) {
        let u = d;
        if (d.id && !d.xuser_id) {
            try {
                const res = await API.get('/api/user');
                u = (res.data || []).find(x => x.id === d.id) || d;
            } catch(e) {}
        }
        const isEdit = !!u.id;
        UI.modal((isEdit ? '編輯' : '新增') + '使用者', `
            <div class="form-row">
                <div class="form-group"><label>帳號${isEdit?'(不可改)':''}</label>
                    <input id="uf_id" value="${u.xuser_id||''}" ${isEdit?'disabled':''}></div>
                <div class="form-group"><label>${isEdit?'新密碼(留空不變)':'密碼'}</label>
                    <input type="password" id="uf_pwd" placeholder="${isEdit?'• • • • • •':'必填'}"></div>
                <div class="form-group"><label>狀態</label>
                    <select id="uf_stat"><option value="USE">啟用</option><option value="STOP">停用</option></select></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>姓名</label><input id="uf_name" value="${u.xuser_name||''}"></div>
                <div class="form-group"><label>部門</label><input id="uf_dept" value="${u.xuser_dept||''}"></div>
                <div class="form-group"><label>客戶 ID</label><input id="uf_cid" value="${u.client_id||''}"></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">取消</button><button class="btn btn-primary" onclick="UserForm.save(${u.id||0})">存檔</button>`);
        if (u.inuse_flag) document.getElementById('uf_stat').value = u.inuse_flag;
    },
    async save(id) {
        const body = {
            xuser_id: document.getElementById('uf_id').value,
            xuser_password: document.getElementById('uf_pwd').value,
            xuser_name: document.getElementById('uf_name').value,
            xuser_dept: document.getElementById('uf_dept').value,
            client_id: document.getElementById('uf_cid').value,
            inuse_flag: document.getElementById('uf_stat').value,
        };
        try {
            if (id) {
                if (!body.xuser_password) delete body.xuser_password;
                await API.put(`/api/user/${id}`, body);
            } else {
                await API.post('/api/user', body);
            }
            UI.toast(id ? '已更新' : '已新增', 'success'); UI.closeModal(); loadUsers();
        } catch(e) { UI.toast(e.message,'error'); }
    }
};

async function delUser(id, uid) {
    if (!confirm(`確定刪除使用者 ${uid}？（會同步刪除權限紀錄）`)) return;
    try { await API.del(`/api/user/${id}`); UI.toast('已刪除','success'); loadUsers(); }
    catch(e) { UI.toast(e.message,'error'); }
}

// ── Tab 2: 權限編輯 ──
async function loadPerms() {
    const el = document.getElementById('permsTable');
    const uid = document.getElementById('puUser')?.value;
    try {
        const res = await API.get('/api/user/permissions');
        const rows = res.data || [];
        const row = uid ? rows.find(r => r.user_id === uid) : rows[0];
        if (!row) { el.innerHTML = '<p style="color:#95a5a6;text-align:center;padding:40px;">請先新增使用者</p>'; return; }
        document.getElementById('puUser').value = row.user_id;
        const perms = [
            ['procurement','採購'],['sales','銷售'],['production','生產'],['engineer','工程'],
            ['handbook','法規'],['wk_plan','工單'],['quality','品質'],['document','文件'],
            ['price','價格'],['stock','庫存'],['finance','財務'],['imex','進出口'],['others','其他']
        ];
        el.innerHTML = `<div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:16px;">
            <div><b>使用者:</b> ${row.xuser_id} (${row.xuser_name||''})</div>
            <div><b>管理等級:</b> <input type="number" id="pf_class" min="1" max="5" value="${row.class||1}" style="width:60px"></div>
            <div><label><input type="checkbox" id="pf_login" ${row.login==='Y'?'checked':''}> 允許登入</label></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;">
            ${perms.map(([k,label]) => `
                <label style="display:flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid #ecf0f1;border-radius:6px;cursor:pointer;">
                    <input type="checkbox" id="pf_${k}" ${row[k]==='Y'?'checked':''}>
                    <span>${label}</span>
                </label>`).join('')}
        </div>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

async function savePerms() {
    const uid = document.getElementById('puUser').value;
    if (!uid) { UI.toast('請選擇使用者','error'); return; }
    const fields = ['procurement','sales','production','engineer','handbook','wk_plan','quality',
                    'document','price','stock','finance','imex','others'];
    const body = {};
    fields.forEach(k => body[k] = document.getElementById('pf_'+k).checked ? 'Y' : 'N');
    body.class = Number(document.getElementById('pf_class').value) || 1;
    body.login = document.getElementById('pf_login').checked ? 'Y' : 'N';
    try { await API.put(`/api/user/${uid}/permissions`, body); UI.toast('權限已存檔','success'); }
    catch(e) { UI.toast(e.message,'error'); }
}

// ── Tab 3: 登入紀錄 ──
async function loadLogins() {
    const el = document.getElementById('loginTable');
    const uid = document.getElementById('luUser')?.value;
    try {
        const res = await API.get(`/api/user/logins?user_id=${uid}&limit=100`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = '<p style="color:#95a5a6;text-align:center;padding:40px;">📜 尚無登入紀錄</p>'; return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr><th>#</th><th>使用者</th><th>公司別</th><th>登入時間</th><th>登出</th><th>次數</th><th>頁面</th><th>操作</th></tr></thead>
            <tbody>${rows.map(r => `
                <tr><td>${r.id}</td><td>${r.user_id}</td><td>${r.bu_no||'-'}</td>
                    <td>${r.login_time||'-'}</td><td>${r.logoff_time||'-'}</td>
                    <td class="num">${r.use_cnt}</td><td>${r.xwebpage_id||'-'}</td>
                    <td><button class="btn btn-danger btn-sm" onclick="delLogin(${r.id})">🗑</button></td></tr>`).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}
async function delLogin(id) {
    if (!confirm('確定清除此紀錄？')) return;
    try { await API.del(`/api/user/logins/${id}`); UI.toast('已清除','success'); loadLogins(); }
    catch(e) { UI.toast(e.message,'error'); }
}
