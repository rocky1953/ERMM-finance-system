/**
 * KPI 門檻定義頁面
 */
registerPage('kpi', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <label>公司別：<select id="kpiBU" onchange="loadKPI()"><option value="">全部</option>
                    <option value="HM">HM</option><option value="HN">HN</option><option value="SZ">SZ</option></select></label>
                <label>判定方向：<select id="kpiPct" onchange="loadKPI()"><option value="">全部</option>
                    <option value="asc">asc（值越高越差）</option><option value="desc">desc（值越低越差）</option></select></label>
                <button class="btn btn-primary" onclick="KpiThresholdForm.open()">➕ 新增 KPI</button>
                <button class="btn btn-success" onclick="loadKPI()">🔄 重新整理</button>
            </div>
            <div id="kpiTable">載入中...</div>
        </div>
    `;
    document.getElementById('kpiBU').value = State.bu_no;
    loadKPI();
});

async function loadKPI() {
    const el = document.getElementById('kpiTable');
    try {
        const bu = document.getElementById('kpiBU').value;
        const pct = document.getElementById('kpiPct').value;
        const res = await API.get(`/api/kpi?bu_no=${bu}&pct_type=${pct}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = '<p style="color:#95a5a6;text-align:center;padding:40px;">🎯 尚無 KPI 定義</p>'; return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>公司別</th><th>KPI ID</th><th>名稱</th><th>下限</th><th>上限</th><th>單位</th>
                <th>方向</th><th>當前值</th><th>顏色</th><th>備註</th><th>操作</th>
            </tr></thead>
            <tbody>${rows.map(r => {
                const colorMap = { RED: '#e74c3c', YELLOW: '#f39c12', GREEN: '#27ae60' };
                const badge = r.KPI_color ? `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${colorMap[r.KPI_color]||'#ddd'};border:1px solid #ccc"></span> ${r.KPI_color}` : '-';
                return `<tr>
                    <td>${r.bu_no}</td><td>${r.KPI_id}</td><td>${r.KPI_name||'-'}</td>
                    <td class="num">${UI.fmt(r.KPI1)}</td><td class="num">${UI.fmt(r.KPI2)}</td>
                    <td>${r.unit||'-'}</td><td>${r.pct_type||'-'}</td>
                    <td class="num">${UI.fmt(r.KPI_value)}</td><td>${badge}</td>
                    <td>${r.remark||'-'}</td>
                    <td>
                        <button class="btn btn-sm" onclick="KpiThresholdForm.open(${r.uid})">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delKPI(${r.uid})">🗑</button>
                    </td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

const KpiThresholdForm = {
    open(uid) {
        if (uid) {
            API.get(`/api/kpi/${uid}`).then(res => {
                this._render(res.data);
            }).catch(e => UI.toast(e.message,'error'));
        } else {
            this._render({ bu_no: State.bu_no });
        }
    },
    _render(d) {
        const isEdit = !!d.uid;
        UI.modal((isEdit ? '編輯' : '新增') + ' KPI 門檻', `
            <div class="form-row">
                <div class="form-group"><label>公司別</label>
                    <select id="kf_bu"><option>HM</option><option>HN</option><option>SZ</option></select></div>
                <div class="form-group"><label>KPI ID</label><input id="kf_id" value="${d.KPI_id||''}"></div>
                <div class="form-group"><label>KPI 名稱</label><input id="kf_name" value="${d.KPI_name||''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>下限 (KPI1)</label><input type="number" step="0.0001" id="kf_k1" value="${d.KPI1||0}"></div>
                <div class="form-group"><label>上限 (KPI2)</label><input type="number" step="0.0001" id="kf_k2" value="${d.KPI2||0}"></div>
                <div class="form-group"><label>單位</label><input id="kf_unit" value="${d.unit||''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>判定方向</label>
                    <select id="kf_pct"><option value="asc">asc（值高=差）</option><option value="desc">desc（值低=差）</option></select></div>
                <div class="form-group"><label>當前值</label><input type="number" step="0.0001" id="kf_val" value="${d.KPI_value||0}"></div>
                <div class="form-group"><label>顏色</label>
                    <select id="kf_color"><option value="">(自動)</option><option value="GREEN">GREEN</option><option value="YELLOW">YELLOW</option><option value="RED">RED</option></select></div>
            </div>
            <div class="form-row">
                <div class="form-group" style="flex:1"><label>備註</label><textarea id="kf_remark" rows="2" style="width:100%">${d.remark||''}</textarea></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">取消</button><button class="btn btn-primary" onclick="KpiThresholdForm.save(${d.uid||0})">存檔</button>`);
        if (d.bu_no) document.getElementById('kf_bu').value = d.bu_no;
        if (d.pct_type) document.getElementById('kf_pct').value = d.pct_type;
        if (d.KPI_color) document.getElementById('kf_color').value = d.KPI_color;
    },
    async save(uid) {
        const body = {
            bu_no: document.getElementById('kf_bu').value,
            KPI_id: document.getElementById('kf_id').value,
            KPI_name: document.getElementById('kf_name').value,
            KPI1: Number(document.getElementById('kf_k1').value)||0,
            KPI2: Number(document.getElementById('kf_k2').value)||0,
            unit: document.getElementById('kf_unit').value,
            pct_type: document.getElementById('kf_pct').value,
            KPI_value: Number(document.getElementById('kf_val').value)||0,
            KPI_color: document.getElementById('kf_color').value,
            remark: document.getElementById('kf_remark').value,
        };
        try {
            if (uid) await API.put(`/api/kpi/${uid}`, body);
            else await API.post('/api/kpi', body);
            UI.toast(uid ? '已更新' : '已新增', 'success');
            UI.closeModal();
            // 觸發全域回調（YG 頁面等可監聽存檔後自動刷新）
            if (window._onKpiSaved) window._onKpiSaved(body.KPI_id);
            else loadKPI();
        } catch(e) { UI.toast(e.message,'error'); }
    }
};

async function delKPI(uid) {
    if (!confirm('確定刪除此 KPI？')) return;
    try { await API.del(`/api/kpi/${uid}`); UI.toast('已刪除','success'); loadKPI(); }
    catch(e) { UI.toast(e.message,'error'); }
}
