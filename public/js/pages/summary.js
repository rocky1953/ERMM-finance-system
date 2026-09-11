/**
 * 財務摘要頁面
 */
registerPage('summary', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <button class="btn btn-primary" onclick="SumForm.open()">➕ ${t('sum.add')}</button>
                <button class="btn btn-success" onclick="SumForm.addon()">📋 ${t('sum.addon')}</button>
                <button class="btn btn-warning" onclick="calcPL()">🔢 ${t('sum.calcPL')}</button>
                <button class="btn btn-info" onclick="loadSummary()">🔄 ${t('refresh')}</button>
            </div>
            <div id="sumTable">${t('loading')}</div>
        </div>
        <div id="plResult"></div>
    `;
    loadSummary();
});

async function loadSummary() {
    const el = document.getElementById('sumTable');
    try {
        const res = await API.get(`/api/summary?bu_no=${State.bu_no}&YYYY=${State.YYYY_MM.split('/')[0]}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = UI.empty('📋', t('sum.no_data')); return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr><th>${t('sum.month')}</th><th>${t('sum.sale')}</th><th>${t('sum.cost')}</th><th>${t('sum.gross')}</th><th>${t('sum.op_income')}</th><th>${t('sum.net')}</th><th>${t('sum.total_asset')}</th><th>${t('sum.total_debt')}</th><th>${t('sum.equity')}</th><th>${t('po.col.action')}</th></tr></thead>
            <tbody>${rows.map(r => `<tr>
                <td>${r.YYYY_MM}</td>
                <td class="num">${UI.fmt(r.sale_amt)}</td>
                <td class="num">${UI.fmt(r.sale_cost_amt)}</td>
                <td class="num">${UI.fmt(r.BIZ_major_margin_amt)}</td>
                <td class="num">${UI.fmt(r.BIZ_margin_amt)}</td>
                <td class="num ${Number(r.net_profit_amt)>=0?'positive':'negative'}">${UI.fmt(r.net_profit_amt)}</td>
                <td class="num">${UI.fmt(r.ttl_asset_amt)}</td>
                <td class="num">${UI.fmt(r.ttl_debet_amt)}</td>
                <td class="num">${UI.fmt(r.stockholder_amt)}</td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="SumForm.edit(${r.uid})">✏️ ${t('edit')}</button>
                    <button class="btn btn-sm btn-danger" onclick="delSum(${r.uid})">🗑</button>
                </td>
            </tr>`).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

const SumForm = {
    open() {
        this._uid = null;
        UI.modal(t('sum.add'), `
            <div class="form-row">
                <div class="form-group"><label>${t('sum.month')} (YYYY/MM)</label><input id="sf_ym" value="${State.YYYY_MM}"></div>
                <div class="form-group"><label>${t('sum.sale')}</label><input type="number" id="sf_sale" value="0"></div>
                <div class="form-group"><label>${t('sum.cost')}</label><input type="number" id="sf_cost" value="0"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('sum.expense')}</label><input type="number" id="sf_exp" value="0"></div>
                <div class="form-group"><label>${t('sum.mgmt_exp')}</label><input type="number" id="sf_mgmt" value="0"></div>
                <div class="form-group"><label>${t('sum.fin_exp')}</label><input type="number" id="sf_fin" value="0"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('sum.cash')}</label><input type="number" id="sf_cash" value="0"></div>
                <div class="form-group"><label>${t('sum.deposit')}</label><input type="number" id="sf_dep" value="0"></div>
                <div class="form-group"><label>${t('sum.ar')}</label><input type="number" id="sf_ar" value="0"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('sum.ap')}</label><input type="number" id="sf_ap" value="0"></div>
                <div class="form-group"><label>${t('sum.loan')}</label><input type="number" id="sf_loan" value="0"></div>
                <div class="form-group"><label>${t('sum.stock_p')}</label><input type="number" id="sf_sp" value="0"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('sum.stock_m')}</label><input type="number" id="sf_sm" value="0"></div>
                <div class="form-group"><label>${t('sum.capital')}</label><input type="number" id="sf_cap" value="0"></div>
                <div class="form-group"><label>${t('sum.accumulated')}</label><input type="number" id="sf_acc" value="0"></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">${t('cancel')}</button><button class="btn btn-primary" onclick="SumForm.save()">${t('save')}</button>`);
    },
    async save() {
        const body = {
            bu_no: State.bu_no,
            YYYY_MM: document.getElementById('sf_ym').value,
            sale_amt: Number(document.getElementById('sf_sale').value) || 0,
            sale_cost_amt: Number(document.getElementById('sf_cost').value) || 0,
            sale_exp_amt: Number(document.getElementById('sf_exp').value) || 0,
            MGM_EXP_amt: Number(document.getElementById('sf_mgmt').value) || 0,
            finance_EXP_amt: Number(document.getElementById('sf_fin').value) || 0,
            cash_amt: Number(document.getElementById('sf_cash').value) || 0,
            deposite_amt: Number(document.getElementById('sf_dep').value) || 0,
            AR_amt: Number(document.getElementById('sf_ar').value) || 0,
            AP_amt: Number(document.getElementById('sf_ap').value) || 0,
            loan_amt: Number(document.getElementById('sf_loan').value) || 0,
            stock_P_amt: Number(document.getElementById('sf_sp').value) || 0,
            stock_M_amt: Number(document.getElementById('sf_sm').value) || 0,
            captial_stock: Number(document.getElementById('sf_cap').value) || 0,
            accumulated_amt: Number(document.getElementById('sf_acc').value) || 0,
            VAT_rate: 13
        };
        try {
            if (this._uid) {
                await API.put(`/api/summary/${this._uid}`, body);
                UI.toast(t('po.msg.updated'), 'success');
            } else {
                await API.post('/api/summary', body);
                UI.toast(t('sum.saved'),'success');
            }
            UI.closeModal();
            loadSummary();
        } catch(e) { UI.toast(e.message,'error'); }
    },
    async addon() {
        try {
            await API.post('/api/summary/addon', { bu_no: State.bu_no, YYYY: State.YYYY_MM.split('/')[0] });
            UI.toast(t('sum.addon_done'),'success');
            loadSummary();
        } catch(e) { UI.toast(e.message,'error'); }
    },
    async edit(uid) {
        try {
            const res = await API.get(`/api/summary/${uid}`);
            const r = res.data;
            this._uid = uid;
            this.open();
            setTimeout(() => {
                document.getElementById('sf_ym').value = r.YYYY_MM;
                document.getElementById('sf_sale').value = r.sale_amt || 0;
                document.getElementById('sf_cost').value = r.sale_cost_amt || 0;
                document.getElementById('sf_exp').value = r.sale_exp_amt || 0;
                document.getElementById('sf_mgmt').value = r.MGM_EXP_amt || 0;
                document.getElementById('sf_fin').value = r.finance_EXP_amt || 0;
                document.getElementById('sf_cash').value = r.cash_amt || 0;
                document.getElementById('sf_dep').value = r.deposite_amt || 0;
                document.getElementById('sf_ar').value = r.AR_amt || 0;
                document.getElementById('sf_ap').value = r.AP_amt || 0;
                document.getElementById('sf_loan').value = r.loan_amt || 0;
                document.getElementById('sf_sp').value = r.stock_P_amt || 0;
                document.getElementById('sf_sm').value = r.stock_M_amt || 0;
                document.getElementById('sf_cap').value = r.captial_stock || 0;
                document.getElementById('sf_acc').value = r.accumulated_amt || 0;
            }, 100);
        } catch(e) { UI.toast(e.message,'error'); }
    }
};

async function delSum(uid) {
    if (!confirm(t('confirm_delete'))) return;
    try { await API.del(`/api/summary/${uid}`); UI.toast(t('po.msg.deleted'),'success'); loadSummary(); }
    catch(e) { UI.toast(e.message,'error'); }
}

async function calcPL() {
    const el = document.getElementById('plResult');
    try {
        const res = await API.post('/api/summary/calcPL', { bu_no: State.bu_no, YYYY_MM: State.YYYY_MM });
        const d = res.data;
        el.innerHTML = `<div class="card">
            <div class="card-title">${t('sum.pl_result')} — ${d.YYYY_MM}</div>
            <div class="kpi-grid">
                <div class="kpi-card green"><div class="kpi-label">${t('sum.sale')}</div><div class="kpi-value">${UI.fmt(d.sale_amt)}</div></div>
                <div class="kpi-card red"><div class="kpi-label">${t('sum.sale_cost')}</div><div class="kpi-value">${UI.fmt(d.sale_cost_amt + d.VAT_amt)}</div></div>
                <div class="kpi-card green"><div class="kpi-label">${t('sum.gross')}</div><div class="kpi-value">${UI.fmt(d.BIZ_major_margin)}</div></div>
                <div class="kpi-card green"><div class="kpi-label">${t('sum.op_income')}</div><div class="kpi-value">${UI.fmt(d.BIZ_margin)}</div></div>
                <div class="kpi-card green"><div class="kpi-label">${t('sum.op_profit')}</div><div class="kpi-value">${UI.fmt(d.operation_profit)}</div></div>
                <div class="kpi-card ${d.net_profit>=0?'green':'red'}"><div class="kpi-label">${t('sum.net')}</div><div class="kpi-value ${d.net_profit>=0?'positive':'negative'}">${UI.fmt(d.net_profit)}</div></div>
            </div>
        </div>`;
        UI.toast(`${t('sum.calc_done')}: ${t('sum.net')}=${UI.fmt(d.net_profit)}`, 'success');
        loadSummary();
    } catch(e) { UI.toast(e.message,'error'); }
}
