/**
 * 財務預測頁面
 */
registerPage('forecast', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <button class="btn btn-primary" onclick="FcForm.open()">➕ ${t('fc.add')}</button>
                <button class="btn btn-success" onclick="loadForecast();loadFcDetail();loadCompare()">🔄 ${t('refresh')}</button>
            </div>
            <div style="display:flex;gap:16px;margin-bottom:10px">
                <button class="btn btn-sm" id="tab-wide" onclick="switchFcTab('wide')">📊 年度寬表</button>
                <button class="btn btn-sm btn-outline" id="tab-detail" onclick="switchFcTab('detail')">📋 逐筆明細</button>
            </div>
            <div id="fcTable">${t('loading')}</div>
            <div id="fcDetail" style="display:none">${t('loading')}</div>
        </div>
        <div class="card">
            <div class="card-title">${t('fc.compare')}</div>
            <div id="fcCompare">${t('loading')}</div>
        </div>
    `;
    loadForecast();
    loadFcDetail();
    loadCompare();
});

function switchFcTab(tab) {
    document.getElementById('fcTable').style.display = tab === 'wide' ? '' : 'none';
    document.getElementById('fcDetail').style.display = tab === 'detail' ? '' : 'none';
    document.getElementById('tab-wide').className = 'btn btn-sm ' + (tab === 'wide' ? '' : 'btn-outline');
    document.getElementById('tab-detail').className = 'btn btn-sm ' + (tab === 'detail' ? '' : 'btn-outline');
}

async function loadFcDetail() {
    const el = document.getElementById('fcDetail');
    try {
        const year = State.YYYY_MM.split('/')[0];
        const res = await API.get(`/api/forecast/detail?bu_no=${State.bu_no}&year=${year}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = UI.empty('📋', '尚無預測明細'); return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>月份</th><th>預測類型</th><th>預測金額</th><th>差異</th><th>建立時間</th><th>操作</th>
            </tr></thead>
            <tbody>${rows.map(r => `
                <tr>
                    <td>${r.YYYY_MM}</td>
                    <td>${r.forecast_type}</td>
                    <td class="num">${UI.fmt(r.forecast_amt)}</td>
                    <td class="num ${Number(r.diff_amt||0)!=0?'negative':''}">${UI.fmt(r.diff_amt)}</td>
                    <td>${r.create_time ? r.create_time.substring(0,10) : '-'}</td>
                    <td>
                        <button class="btn btn-primary btn-sm" onclick='editFc(${JSON.stringify(r)})'>✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delFc(${r.uid})">🗑</button>
                    </td>
                </tr>
            `).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

function editFc(r) {
    UI.modal(`✏️ 編輯預測 ${r.YYYY_MM} - ${r.forecast_type}`, `
        <div class="form-row">
            <div class="form-group"><label>月份</label><input id="fc_edit_ym" value="${r.YYYY_MM}" readonly></div>
            <div class="form-group"><label>預測類型</label><input id="fc_edit_type" value="${r.forecast_type}" readonly></div>
        </div>
        <div class="form-row">
            <div class="form-group"><label>預測金額</label><input type="number" id="fc_edit_amt" value="${r.forecast_amt || 0}"></div>
            <div class="form-group"><label>差異</label><input type="number" id="fc_edit_diff" value="${r.diff_amt || 0}"></div>
        </div>
    `, `<button class="btn" onclick="UI.closeModal()">取消</button>
        <button class="btn btn-primary" onclick="saveFc(${r.uid})">💾 保存</button>`);
}

async function saveFc(uid) {
    const body = {
        forecast_amt: Number(document.getElementById('fc_edit_amt').value) || 0,
        diff_amt: Number(document.getElementById('fc_edit_diff').value) || 0,
    };
    try {
        await API.put(`/api/forecast/${uid}`, body);
        UI.toast('已更新', 'success');
        UI.closeModal();
        loadFcDetail();
    } catch(e) { UI.toast(e.message, 'error'); }
}

async function delFc(uid) {
    if (!confirm('確定刪除此筆預測？')) return;
    try { await API.del(`/api/forecast/${uid}`); UI.toast('已刪除','success'); loadFcDetail(); }
    catch(e) { UI.toast(e.message,'error'); }
}

async function loadForecast() {
    const el = document.getElementById('fcTable');
    try {
        const res = await API.get(`/api/forecast?bu_no=${State.bu_no}&year=${State.YYYY_MM.split('/')[0]}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = UI.empty('🔮', t('fc.no_data')); return; }
        const monthLabels = Array.from({length:12},(_,i)=>`${i+1}`);
        el.innerHTML = `<table class="data-table">
            <thead><tr><th>${t('fc.type')}</th>${monthLabels.map(m=>`<th>${m}</th>`).join('')}</tr></thead>
            <tbody>${rows.map(r => `<tr>
                <td>${r.forecast_type || '-'}</td>
                ${Array.from({length:12},(_,i)=>`<td class="num">${UI.fmt(r['M'+String(i+1).padStart(2,'0')])}</td>`).join('')}
            </tr>`).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

async function loadCompare() {
    const el = document.getElementById('fcCompare');
    try {
        const res = await API.get(`/api/forecast/compare?bu_no=${State.bu_no}&year=${State.YYYY_MM.split('/')[0]}`);
        const d = res.data;
        if (!d || !d.labels || d.labels.length === 0) { el.innerHTML = `<p style="color:#7f8c8d">${t('fc.need_both')}</p>`; return; }
        el.innerHTML = `<canvas id="fcChart" height="100"></canvas>`;
        new Chart(document.getElementById('fcChart'), {
            type: 'line',
            data: {
                labels: d.labels,
                datasets: [
                    { label: t('fc.forecast'), data: d.forecast, borderColor: '#3498db', backgroundColor: 'rgba(52,152,219,0.1)', fill: true },
                    { label: t('fc.actual'), data: d.actual, borderColor: '#27ae60', backgroundColor: 'rgba(39,174,96,0.1)', fill: true }
                ]
            },
            options: { responsive: true, plugins: { legend: { position: 'top' } } }
        });
    } catch(e) { el.innerHTML = `<p style="color:#7f8c8d">${e.message}</p>`; }
}

const FcForm = {
    open() {
        const months = Array.from({length:12},(_,i)=>`<div class="form-group"><label>${i+1}</label><input type="number" id="ff_m${i+1}" value="0"></div>`).join('');
        UI.modal(t('fc.add'), `
            <div class="form-row">
                <div class="form-group"><label>${t('fc.type')}</label><select id="ff_type"><option value="Sales">${t('fc.sale_fc')}</option><option value="Cost">${t('fc.cost_fc')}</option><option value="Cash Flow">${t('fc.cash_fc')}</option></select></div>
                <div class="form-group"><label>${t('fc.year')}</label><input id="ff_year" value="${State.YYYY_MM.split('/')[0]}"></div>
            </div>
            <div class="form-row">${months}</div>
        `, `<button class="btn" onclick="UI.closeModal()">${t('cancel')}</button><button class="btn btn-primary" onclick="FcForm.save()">${t('save')}</button>`);
    },
    async save() {
        const months = {};
        for (let i = 1; i <= 12; i++) months[String(i).padStart(2,'0')] = Number(document.getElementById(`ff_m${i}`).value) || 0;
        const body = {
            bu_no: State.bu_no,
            forecast_type: document.getElementById('ff_type').value,
            year: document.getElementById('ff_year').value,
            months
        };
        try { await API.post('/api/forecast', body); UI.toast(t('fc.saved'),'success'); UI.closeModal(); loadForecast(); loadCompare(); }
        catch(e) { UI.toast(e.message,'error'); }
    }
};
