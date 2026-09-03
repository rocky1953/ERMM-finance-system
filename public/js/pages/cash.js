/**
 * 現金日記帳頁面
 */
registerPage('cash', async (c) => {
    const { bu_no } = State;
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <button class="btn btn-primary" onclick="CashForm.open()">➕ ${t('cash.add')}</button>
                <button class="btn btn-success" onclick="loadCash()">🔄 ${t('refresh')}</button>
                <div class="spacer"></div>
                <input type="month" id="cashMonth" value="${State.YYYY_MM.replace('/','-')}" onchange="loadCash()" style="padding:6px;border:1px solid #ddd;border-radius:6px;">
            </div>
            <div id="cashTable">${t('loading')}</div>
        </div>
        <div class="card">
            <div class="card-title">${t('cash.summary')}</div>
            <div id="cashSummary">${t('loading')}</div>
        </div>
    `;
    loadCash();
    loadCashSummary();
});

async function loadCash() {
    const el = document.getElementById('cashTable');
    try {
        const ym = document.getElementById('cashMonth')?.value.replace('-', '/') || State.YYYY_MM;
        const res = await API.get(`/api/cash?bu_no=${State.bu_no}&YYYY_MM=${ym}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = UI.empty('💵', t('cash.no_records')); return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr><th>${t('cash.date')}</th><th>${t('cash.voucher')}</th><th>${t('cash.remark')}</th><th>${t('cash.income')}</th><th>${t('cash.expense')}</th><th>${t('cash.balance')}</th><th>${t('delete')}</th></tr></thead>
            <tbody>${rows.map(r => `<tr>
                <td>${UI.fmtDate(r.wk_date)}</td>
                <td>${r.num_vman || '-'}</td>
                <td>${r.remark || r.acct_desc || '-'}</td>
                <td class="num positive">${Number(r.in_amt)>0 ? UI.fmt(r.in_amt):''}</td>
                <td class="num negative">${Number(r.out_amt)>0 ? UI.fmt(r.out_amt):''}</td>
                <td class="num">${UI.fmt(r.balance_amt)}</td>
                <td><button class="btn btn-danger btn-sm" onclick="delCash(${r.uid})">${t('delete')}</button></td>
            </tr>`).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

async function loadCashSummary() {
    const el = document.getElementById('cashSummary');
    try {
        const res = await API.get(`/api/cash/summary?bu_no=${State.bu_no}&YYYY_MM=${State.YYYY_MM}`);
        const d = res.data || {};
        el.innerHTML = `<div class="kpi-grid">
            <div class="kpi-card green"><div class="kpi-label">${t('cash.total_in')}</div><div class="kpi-value positive">${UI.fmt(d.total_in || 0)}</div></div>
            <div class="kpi-card red"><div class="kpi-label">${t('cash.total_out')}</div><div class="kpi-value negative">${UI.fmt(d.total_out || 0)}</div></div>
            <div class="kpi-card ${Number(d.net)>=0?'green':'red'}"><div class="kpi-label">${t('cash.net')}</div><div class="kpi-value">${UI.fmt(d.net || 0)}</div></div>
            <div class="kpi-card green"><div class="kpi-label">${t('cash.end_balance')}</div><div class="kpi-value">${UI.fmt(d.balance || 0)}</div></div>
        </div>`;
    } catch(e) { el.innerHTML = `<p style="color:#7f8c8d">${e.message}</p>`; }
}

const CashForm = {
    open() {
        UI.modal(t('cash.add'), `
            <div class="form-row">
                <div class="form-group"><label>${t('topbar.bu')}</label><input id="cf_bu" value="${State.bu_no}" readonly></div>
                <div class="form-group"><label>${t('cash.voucher')}</label><input id="cf_num" placeholder="auto / manual"></div>
                <div class="form-group"><label>${t('cash.date')}</label><input type="date" id="cf_date" value="${new Date().toISOString().substring(0,10)}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('cash.remark')}</label><input id="cf_remark"></div>
                <div class="form-group"><label>${t('cash.income')}</label><input type="number" id="cf_in" value="0"></div>
                <div class="form-group"><label>${t('cash.expense')}</label><input type="number" id="cf_out" value="0"></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">${t('cancel')}</button><button class="btn btn-primary" onclick="CashForm.save()">${t('save')}</button>`);
    },
    async save() {
        const wk = document.getElementById('cf_date').value;
        const body = {
            bu_no: State.bu_no,
            num_vman: document.getElementById('cf_num').value,
            wk_date: wk,
            wk_YYYY: wk.substring(0,4),
            wk_MM: wk.substring(5,7),
            YYYY_MM: wk.substring(0,7).replace('-','/'),
            in_amt: Number(document.getElementById('cf_in').value) || 0,
            out_amt: Number(document.getElementById('cf_out').value) || 0,
            remark: document.getElementById('cf_remark').value
        };
        try {
            await API.post('/api/cash', body);
            UI.toast(t('cash.added'), 'success');
            UI.closeModal();
            loadCash();
            loadCashSummary();
        } catch(e) { UI.toast(e.message, 'error'); }
    }
};

async function delCash(uid) {
    if (!confirm(t('confirm_delete'))) return;
    try { await API.del(`/api/cash/${uid}`); UI.toast(t('deleted'), 'success'); loadCash(); loadCashSummary(); }
    catch(e) { UI.toast(e.message, 'error'); }
}
