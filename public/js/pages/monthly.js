/**
 * 月度項目 monthly_items CRUD
 */
registerPage('monthly', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <label>公司別：<select id="mBU" onchange="loadMonthly()"><option value="">全部</option>
                    <option>HM</option><option>HN</option><option>SZ</option></select></label>
                <label>年月：<input type="month" id="mYM" onchange="loadMonthly()"></label>
                <label>類型：<select id="mType" onchange="loadMonthly()"><option value="">全部</option>
                    <option>租金</option><option>水電</option><option>薪資</option><option>保險</option><option>其他</option></select></label>
                <button class="btn btn-primary" onclick="MonthlyForm.open()">➕ 新增</button>
                <button class="btn btn-success" onclick="loadMonthly()">🔄</button>
            </div>
            <div id="monthlyTable">載入中...</div>
        </div>
    `;
    document.getElementById('mBU').value = State.bu_no;
    if (State.YYYY_MM) document.getElementById('mYM').value = State.YYYY_MM.replace('/', '-');
    loadMonthly();
});

async function loadMonthly() {
    const el = document.getElementById('monthlyTable');
    try {
        const bu = document.getElementById('mBU').value;
        const ym = document.getElementById('mYM').value.replace('-','/');
        const type = document.getElementById('mType').value;
        const res = await API.get(`/api/monthly?bu_no=${bu}&YYYY_MM=${ym}&item_type=${encodeURIComponent(type)}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = '<p style="color:#95a5a6;text-align:center;padding:40px;">📅 尚無月度項目</p>'; return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>公司別</th><th>年月</th><th>類型</th><th>項目名稱</th>
                <th>金額</th><th>DR/CR</th><th>付款日</th><th>備註</th><th>操作</th>
            </tr></thead>
            <tbody>${rows.map(r => `
                <tr>
                    <td>${r.bu_no}</td><td>${r.YYYY_MM}</td><td>${r.item_type||'-'}</td>
                    <td>${r.item_name||'-'}</td><td class="num">${UI.fmt(r.item_amt)}</td>
                    <td style="color:${r.DB_CR==='DR'?'#27ae60':r.DB_CR==='CR'?'#e74c3c':'#95a5a6'}">${r.DB_CR||'-'}</td>
                    <td>${r.pay_date||'-'}</td><td>${r.remark||'-'}</td>
                    <td>
                        <button class="btn btn-sm" onclick="MonthlyForm.open(${r.uid})">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delMonthly(${r.uid})">🗑</button>
                    </td>
                </tr>`).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

const MonthlyForm = {
    open(uid) {
        if (uid) API.get(`/api/monthly/${uid}`).then(r => this._render(r.data)).catch(e => UI.toast(e.message,'error'));
        else this._render({ bu_no: State.bu_no, DB_CR: 'CR' });
    },
    _render(d) {
        const isEdit = !!d.uid;
        UI.modal((isEdit ? '編輯' : '新增') + '月度項目', `
            <div class="form-row">
                <div class="form-group"><label>公司別</label>
                    <select id="mf_bu"><option>HM</option><option>HN</option><option>SZ</option></select></div>
                <div class="form-group"><label>年月</label><input type="month" id="mf_ym" value="${(d.YYYY_MM||'').replace('/','-')}"></div>
                <div class="form-group"><label>類型</label>
                    <select id="mf_type"><option>租金</option><option>水電</option><option>薪資</option><option>保險</option><option>其他</option></select></div>
            </div>
            <div class="form-row">
                <div class="form-group" style="flex:1"><label>項目名稱</label><input id="mf_name" value="${d.item_name||''}" style="width:100%"></div>
                <div class="form-group"><label>金額</label><input type="number" id="mf_amt" value="${d.item_amt||0}" step="0.01"></div>
                <div class="form-group"><label>DR/CR</label><select id="mf_dc"><option value="DR">DR 收入</option><option value="CR">CR 支出</option></select></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>付款日</label><input type="date" id="mf_pay" value="${d.pay_date||''}"></div>
                <div class="form-group" style="flex:1"><label>備註</label><input id="mf_remark" value="${d.remark||''}" style="width:100%"></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">取消</button><button class="btn btn-primary" onclick="MonthlyForm.save(${d.uid||0})">存檔</button>`);
        if (d.bu_no) document.getElementById('mf_bu').value = d.bu_no;
        if (d.item_type) document.getElementById('mf_type').value = d.item_type;
        if (d.DB_CR) document.getElementById('mf_dc').value = d.DB_CR;
    },
    async save(uid) {
        const ym = document.getElementById('mf_ym').value.replace('-','/');
        const body = {
            bu_no: document.getElementById('mf_bu').value,
            YYYY_MM: ym,
            item_type: document.getElementById('mf_type').value,
            item_name: document.getElementById('mf_name').value,
            item_amt: Number(document.getElementById('mf_amt').value)||0,
            DB_CR: document.getElementById('mf_dc').value,
            pay_date: document.getElementById('mf_pay').value || null,
            remark: document.getElementById('mf_remark').value,
        };
        try {
            if (uid) await API.put(`/api/monthly/${uid}`, body); else await API.post('/api/monthly', body);
            UI.toast(uid ? '已更新' : '已新增', 'success');
            UI.closeModal(); loadMonthly();
        } catch(e) { UI.toast(e.message,'error'); }
    }
};
async function delMonthly(uid) {
    if (!confirm('確定刪除？')) return;
    try { await API.del(`/api/monthly/${uid}`); UI.toast('已刪除','success'); loadMonthly(); }
    catch(e) { UI.toast(e.message,'error'); }
}
