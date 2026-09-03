/**
 * 每日庫存狀態 e2_xitems_daily_status CRUD
 * ageing_days × reduce_percentage → 自動算 current_value / current_lose
 */
registerPage('xitems', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <label>公司別：<select id="xiBU" onchange="loadXitems()"><option value="">全部</option>
                    <option>HM</option><option>HN</option><option>SZ</option></select></label>
                <label>陳齡：<select id="xiAge" onchange="loadXitems()"><option value="">全部</option>
                    <option>A 正常</option><option>B 31-90天</option><option>C 91-180天</option><option>D 超過180天</option></select></label>
                <button class="btn btn-primary" onclick="XitemsForm.open()">➕ 新增庫存</button>
                <button class="btn btn-warning" onclick="recalcXitems()">🔄 重算減值</button>
                <button class="btn btn-success" onclick="loadXitems()">🔄</button>
            </div>
            <div id="xitemsTable">載入中...</div>
        </div>
    `;
    document.getElementById('xiBU').value = State.bu_no;
    loadXitems();
});

async function loadXitems() {
    const el = document.getElementById('xitemsTable');
    try {
        const res = await API.get(`/api/xitems?bu_no=${document.getElementById('xiBU').value}&ageing_category=${encodeURIComponent(document.getElementById('xiAge').value)}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = '<p style="color:#95a5a6;text-align:center;padding:40px;">📦 尚無庫存資料</p>'; return; }
        const totals = rows.reduce((a,r) => { a.stock += Number(r.stock_value||0); a.cur += Number(r.current_value||0); a.lose += Number(r.current_lose||0); return a; }, {stock:0,cur:0,lose:0});
        el.innerHTML = `
            <div style="padding:12px;margin-bottom:12px;background:#f4f6f7;border-radius:6px;display:flex;gap:20px;">
                <span><b>筆數:</b> ${rows.length}</span>
                <span><b>原值:</b> ${UI.fmt(totals.stock)}</span>
                <span style="color:#27ae60"><b>減值後:</b> ${UI.fmt(totals.cur)}</span>
                <span style="color:#e74c3c"><b>應提跌價:</b> ${UI.fmt(totals.lose)}</span>
            </div>
            <table class="data-table">
            <thead><tr>
                <th>公司別</th><th>物料</th><th>名稱</th><th>數量</th><th>單價</th><th>匯率</th>
                <th>原值</th><th>陳齡</th><th>減值率</th><th>減值後</th><th>應提跌價</th><th>操作</th>
            </tr></thead>
            <tbody>${rows.map(r => {
                const lose = Number(r.current_lose||0);
                return `
                <tr>
                    <td>${r.bu_no}</td><td>${r.xitems||'-'}</td><td>${r.item_name||'-'}</td>
                    <td class="num">${UI.fmt(r.qty_balance, 4)}</td><td class="num">${UI.fmt(r.unit_price, 6)}</td>
                    <td class="num">${UI.fmt(r.exchange_rate, 4)}</td>
                    <td class="num">${UI.fmt(r.stock_value)}</td>
                    <td>${r.ageing_days||0}天 <small>(${r.ageing_category||'-'})</small></td>
                    <td class="num" style="color:${lose>0?'#e74c3c':'#27ae60'}">${r.reduce_percentage||0}%</td>
                    <td class="num">${UI.fmt(r.current_value)}</td>
                    <td class="num" style="color:${lose>0?'#e74c3c':'#27ae60'}">${UI.fmt(lose)}</td>
                    <td>
                        <button class="btn btn-sm" onclick="XitemsForm.open(${r.uid})">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delXitems(${r.uid})">🗑</button>
                    </td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

const XitemsForm = {
    open(uid) {
        if (uid) API.get(`/api/xitems/${uid}`).then(r => this._render(r.data)).catch(e => UI.toast(e.message,'error'));
        else this._render({ bu_no: State.bu_no, exchange_rate: 1 });
    },
    _render(d) {
        const isEdit = !!d.uid;
        UI.modal((isEdit ? '編輯' : '新增') + '庫存', `
            <div class="form-row">
                <div class="form-group"><label>公司別</label><select id="xi_fbu"><option>HM</option><option>HN</option><option>SZ</option></select></div>
                <div class="form-group"><label>物料</label><input id="xi_fx" value="${d.xitems||''}"></div>
                <div class="form-group"><label>庫存日期</label><input type="date" id="xi_fdate" value="${d.stock_date||''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group" style="flex:1"><label>名稱</label><input id="xi_fn" value="${d.item_name||''}" style="width:100%"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>數量</label><input type="number" step="0.0001" id="xi_fq" value="${d.qty_balance||0}"></div>
                <div class="form-group"><label>單價</label><input type="number" step="0.000001" id="xi_fup" value="${d.unit_price||0}"></div>
                <div class="form-group"><label>匯率</label><input type="number" step="0.0001" id="xi_frate" value="${d.exchange_rate||1}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>陳齡天數</label><input type="number" id="xi_fage" value="${d.ageing_days||0}"></div>
                <div class="form-group"><label>減值率 %</label><input type="number" step="0.01" id="xi_freduce" value="${d.reduce_percentage||0}"></div>
                <div class="form-group"><label>陳齡類別</label>
                    <select id="xi_fcat">
                        <option value="">(自動依陳齡天數)</option>
                        <option>A 正常</option><option>B 31-90天</option><option>C 91-180天</option><option>D 超過180天</option>
                    </select></div>
            </div>
            <div style="padding:8px 12px;background:#eafaf1;border-radius:6px;color:#1e8449;font-size:0.85em;">
                💡 儲存後自動計算：原值=數量×單價×匯率，減值後=原值×(1-減值率%)，應提跌價=原值×減值率%
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">取消</button><button class="btn btn-primary" onclick="XitemsForm.save(${d.uid||0})">存檔</button>`);
        if (d.bu_no) document.getElementById('xi_fbu').value = d.bu_no;
        if (d.ageing_category) document.getElementById('xi_fcat').value = d.ageing_category;
    },
    async save(uid) {
        const body = {
            bu_no: document.getElementById('xi_fbu').value,
            xitems: document.getElementById('xi_fx').value,
            item_name: document.getElementById('xi_fn').value,
            qty_balance: Number(document.getElementById('xi_fq').value)||0,
            unit_price: Number(document.getElementById('xi_fup').value)||0,
            exchange_rate: Number(document.getElementById('xi_frate').value)||1,
            ageing_days: Number(document.getElementById('xi_fage').value)||0,
            reduce_percentage: Number(document.getElementById('xi_freduce').value)||0,
            ageing_category: document.getElementById('xi_fcat').value || null,
            stock_date: document.getElementById('xi_fdate').value || null,
        };
        try {
            if (uid) await API.put(`/api/xitems/${uid}`, body); else await API.post('/api/xitems', body);
            UI.toast(uid ? '已更新' : '已新增', 'success'); UI.closeModal(); loadXitems();
        } catch(e) { UI.toast(e.message,'error'); }
    }
};
async function delXitems(uid) {
    if (!confirm('確定刪除？')) return;
    try { await API.del(`/api/xitems/${uid}`); UI.toast('已刪除','success'); loadXitems(); }
    catch(e) { UI.toast(e.message,'error'); }
}
async function recalcXitems() {
    try {
        const res = await API.post('/api/xitems/recalc', { bu_no: State.bu_no });
        UI.toast(res.message || `已重算 ${res.data?.updated||0} 筆`, 'success'); loadXitems();
    } catch(e) { UI.toast(e.message,'error'); }
}
