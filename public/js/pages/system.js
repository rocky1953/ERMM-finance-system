/**
 * 系統設定頁面（碼表 CRUD + KPI）
 */
registerPage('system', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="card-title">🔧 系統碼表管理</div>
            <div class="toolbar">
                <button class="btn btn-primary" onclick="CodeForm.open()">➕ 新增系統碼</button>
                <button class="btn btn-success" onclick="loadCodes()">🔄 刷新</button>
                <div class="spacer"></div>
                <select id="codeType" onchange="loadCodes()" style="padding:6px;border:1px solid #ddd;border-radius:6px;">
                    <option value="">全部類型</option>
                    <option value="CURRENCY">幣別匯率</option>
                    <option value="BUSINESS_ID">公司別</option>
                    <option value="AGEING_STOCK">庫存陳齡</option>
                    <option value="BATCH_CONTROL">批次控制</option>
                </select>
            </div>
            <div id="codeTable">載入中...</div>
        </div>
        <div class="card">
            <div class="card-title">🎯 KPI 指標管理</div>
            <div class="toolbar">
                <button class="btn btn-warning" onclick="kpiLight()">🔔 更新KPI燈号</button>
                <button class="btn btn-primary" onclick="KpiForm.open()">➕ 新增KPI</button>
                <button class="btn btn-success" onclick="loadKPI()">🔄 刷新</button>
            </div>
            <div id="kpiTable" style="margin-top:15px">載入中...</div>
        </div>
    `;
    loadCodes();
    loadKPI();
});

// ============ 系統碼表 ============
async function loadCodes() {
    const el = document.getElementById('codeTable');
    if (!el) return;
    try {
        const tp = document.getElementById('codeType')?.value || '';
        let url = '/api/system/codes';
        if (tp) url += `?code_type=${tp}`;
        const res = await API.get(url);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = '<p style="color:#95a5a6;text-align:center;padding:40px;">📋 尚無系統碼</p>'; return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>類型</th><th>代碼</th><th>名稱</th>
                <th>數值1</th><th>數值2</th><th>數值3</th>
                <th>排序</th><th>狀態</th><th>操作</th>
            </tr></thead>
            <tbody>${rows.map(r => `
                <tr>
                    <td>${r.code_type||'-'}</td><td><b>${r.code_value||'-'}</b></td><td>${r.value_description||'-'}</td>
                    <td class="num">${UI.fmt(r.value_number1,4)}</td>
                    <td class="num">${UI.fmt(r.value_number2,4)}</td>
                    <td class="num">${UI.fmt(r.value_number3,4)}</td>
                    <td>${r.sort_order||0}</td>
                    <td>${r.inuse_flag==='USE'?'<span style="color:#27ae60">● 啟用</span>':'<span style="color:#e74c3c">○ 停用</span>'}</td>
                    <td>
                        <button class="btn btn-sm" onclick="CodeForm.open(${r.id})">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delCode(${r.id})">🗑</button>
                    </td>
                </tr>`).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

const CodeForm = {
    async open(id) {
        let d = {};
        if (id) {
            try {
                const res = await API.get(`/api/system/codes/${id}`);
                d = res.data || {};
            } catch(e) { UI.toast(e.message,'error'); return; }
        }
        this._render(d, !!id);
    },
    _render(d, isEdit) {
        UI.modal((isEdit ? '編輯' : '新增') + ' 系統碼', `
            <div class="form-row">
                <div class="form-group"><label>類型</label>
                    <select id="cf_type">
                        <option>CURRENCY</option><option>BUSINESS_ID</option>
                        <option>AGEING_STOCK</option><option>BATCH_CONTROL</option>
                    </select></div>
                <div class="form-group"><label>代碼</label><input id="cf_val" value="${d.code_value||''}"></div>
                <div class="form-group"><label>說明</label><input id="cf_desc" value="${d.value_description||''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>數值 1</label><input type="number" step="0.0001" id="cf_n1" value="${d.value_number1||0}"></div>
                <div class="form-group"><label>數值 2</label><input type="number" step="0.0001" id="cf_n2" value="${d.value_number2||0}"></div>
                <div class="form-group"><label>數值 3</label><input type="number" step="0.0001" id="cf_n3" value="${d.value_number3||0}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>排序</label><input type="number" id="cf_sort" value="${d.sort_order||0}"></div>
                <div class="form-group"><label>狀態</label>
                    <select id="cf_use"><option value="USE">啟用</option><option value="NOUSE">停用</option></select></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="CodeForm.save(${d.id||0})">存檔</button>`);

        if (d.code_type) document.getElementById('cf_type').value = d.code_type;
        if (d.inuse_flag) document.getElementById('cf_use').value = d.inuse_flag;
    },
    async save(id) {
        const body = {
            code_type: document.getElementById('cf_type').value,
            code_value: document.getElementById('cf_val').value,
            value_description: document.getElementById('cf_desc').value,
            value_number1: Number(document.getElementById('cf_n1').value)||0,
            value_number2: Number(document.getElementById('cf_n2').value)||0,
            value_number3: Number(document.getElementById('cf_n3').value)||0,
            sort_order: Number(document.getElementById('cf_sort').value)||0,
            inuse_flag: document.getElementById('cf_use').value,
        };
        if (!body.code_value) { UI.toast('代碼不可為空','error'); return; }
        try {
            if (id) { await API.put(`/api/system/codes/${id}`, body); UI.toast('已更新','success'); }
            else { await API.post('/api/system/codes', body); UI.toast('已新增','success'); }
            UI.closeModal(); loadCodes();
        } catch(e) { UI.toast(e.message,'error'); }
    }
};

async function delCode(id) {
    if (!confirm('確定刪除此系統碼？')) return;
    try { await API.del(`/api/system/codes/${id}`); UI.toast('已刪除','success'); loadCodes(); }
    catch(e) { UI.toast(e.message,'error'); }
}

// ============ KPI ============
async function loadKPI() {
    const el = document.getElementById('kpiTable');
    if (!el) return;
    try {
        const res = await API.get(`/api/system/kpi?bu_no=${State.bu_no}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = '<p style="color:#95a5a6;text-align:center;padding:40px;">🎯 尚無 KPI 定義</p>'; return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>公司別</th><th>KPI ID</th><th>名稱</th><th>單位</th>
                <th>當前值</th><th>下限</th><th>上限</th><th>方向</th><th>燈號</th><th>操作</th>
            </tr></thead>
            <tbody>${rows.map(r => {
                const c = (r.KPI_color || '').toUpperCase();
                const dotColor = c === 'GREEN' ? '#27ae60' : c === 'RED' ? '#e74c3c' : '#f1c40f';
                return `
                <tr>
                    <td>${r.bu_no||'-'}</td><td>${r.KPI_id||'-'}</td><td>${r.KPI_name||'-'}</td>
                    <td>${r.unit||'-'}</td>
                    <td class="num">${UI.fmt(r.KPI_value,4)}</td>
                    <td class="num">${UI.fmt(r.KPI1,4)}</td>
                    <td class="num">${UI.fmt(r.KPI2,4)}</td>
                    <td>${r.pct_type==='desc'?'↓ 越高越好':'↑ 越低越好'}</td>
                    <td><span style="color:${dotColor};font-size:1.2em;">●</span> ${c||'-'}</td>
                    <td>
                        <button class="btn btn-sm" onclick="KpiForm.open(${r.uid})">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delKPI(${r.uid})">🗑</button>
                    </td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

const KpiForm = {
    open(uid) {
        if (uid) {
            API.get(`/api/kpi/${uid}`).then(r => this._render(r.data, true))
                .catch(() => API.get(`/api/system/kpi?bu_no=${State.bu_no}`).then(r => {
                    const row = (r.data||[]).find(x => x.uid === uid);
                    if (row) this._render(row, true); else UI.toast('記錄不存在','error');
                }));
        } else {
            this._render({ bu_no: State.bu_no, KPI1: 0, KPI2: 0, pct_type: 'asc' }, false);
        }
    },
    _render(d, isEdit) {
        UI.modal((isEdit ? '編輯' : '新增') + ' KPI', `
            <div class="form-row">
                <div class="form-group"><label>公司別</label>
                    <select id="kf_bu"><option>HM</option><option>HN</option><option>SZ</option></select></div>
                <div class="form-group"><label>KPI ID</label><input id="kf_id" value="${d.KPI_id||''}" ${isEdit?'disabled':''}></div>
                <div class="form-group"><label>KPI 名稱</label><input id="kf_name" value="${d.KPI_name||''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>單位</label><input id="kf_unit" value="${d.unit||''}" placeholder="%, 倍, HK$"></div>
                <div class="form-group"><label>判定方向</label>
                    <select id="kf_type"><option value="asc">↑ asc（在區間內為綠）</option>
                    <option value="desc">↓ desc（越高越好）</option></select></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>下限 KPI1</label><input type="number" step="0.0001" id="kf_low" value="${d.KPI1||0}"></div>
                <div class="form-group"><label>上限 KPI2</label><input type="number" step="0.0001" id="kf_high" value="${d.KPI2||0}"></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="KpiForm.save(${d.uid||0})">存檔</button>`);
        if (d.bu_no) document.getElementById('kf_bu').value = d.bu_no;
        if (d.pct_type) document.getElementById('kf_type').value = d.pct_type;
    },
    async save(uid) {
        const body = {
            bu_no: document.getElementById('kf_bu').value,
            KPI_id: document.getElementById('kf_id').value,
            KPI_name: document.getElementById('kf_name').value,
            unit: document.getElementById('kf_unit').value,
            pct_type: document.getElementById('kf_type').value,
            KPI1: Number(document.getElementById('kf_low').value)||0,
            KPI2: Number(document.getElementById('kf_high').value)||0,
        };
        if (!body.KPI_id) { UI.toast('KPI ID 不可為空','error'); return; }
        try {
            // POST route 已用 ON DUPLICATE KEY UPDATE，新舊都走同一條
            await API.post('/api/system/kpi', body);
            UI.toast(isNaN(uid) ? '已新增' : '已更新', 'success');
            UI.closeModal(); loadKPI();
        } catch(e) { UI.toast(e.message,'error'); }
    }
};

async function delKPI(uid) {
    if (!confirm('確定刪除此 KPI？')) return;
    try { await API.del(`/api/kpi/${uid}`); UI.toast('已刪除','success'); loadKPI(); }
    catch(e) { UI.toast(e.message,'error'); }
}

async function kpiLight() {
    try {
        const res = await API.post('/api/risk/kpi-light', { bu_no: State.bu_no });
        UI.toast(`KPI 燈號更新完成 (${res.data?.length || 0} 項)`, 'success');
        loadKPI();
    } catch(e) { UI.toast(e.message,'error'); }
}
