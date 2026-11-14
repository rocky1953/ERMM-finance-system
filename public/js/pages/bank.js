/**
 * 银行贷款页面
 */
registerPage('bank', async (c) => {
    const _mgr = Auth.isManager();
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                ${_mgr ? `<button class="btn btn-primary" onclick="BankForm.open()">➕ ${t('bank.add')}</button>
                <button class="btn btn-warning" onclick="recalcBank()">💱 ${t('bank.recalc')}</button>` : ''}
                <button class="btn btn-success" onclick="loadBank()">🔄 ${t('refresh')}</button>
            </div>
            <div id="bankTable">${t('loading')}</div>
        </div>
        <div class="card">
            <div class="toolbar">
                <button class="btn btn-primary" onclick="loadReconcile()">🔍 ${t('recon.title')}</button>
            </div>
            <div id="reconPanel">${t('loading')}</div>
        </div>
    `;
    loadBank();
    loadReconcile();
});

// CFO-09 银行对账（贷款 / 现金流水 / 付款明细 三方核对）
async function loadReconcile() {
    const el = document.getElementById('reconPanel');
    try {
        const [res, diffRes] = await Promise.all([
            API.get(`/api/bank/reconcile?bu_no=${State.bu_no}`),
            API.get(`/api/bank/reconcile/diff?bu_no=${State.bu_no}&limit=20`)
        ]);
        const d = res.data || {};
        const loan = d.bank_loan || {};
        const cash = d.cash_flow || {};
        const pay = d.pay_detail || {};
        const v = d.variance || {};
        const balanced = v.flag === 'OK';

        const unmatched = diffRes.data?.unmatched_payments || [];

        el.innerHTML = `
            <div class="kpi-grid">
                <div class="kpi-card"><div class="kpi-label">${t('recon.loan')}</div><div class="kpi-value">${UI.fmt(loan.outstanding)}</div></div>
                <div class="kpi-card green"><div class="kpi-label">${t('recon.cash_in')}</div><div class="kpi-value positive">${UI.fmt(cash.in)}</div></div>
                <div class="kpi-card red"><div class="kpi-label">${t('recon.cash_out')}</div><div class="kpi-value negative">${UI.fmt(cash.out)}</div></div>
                <div class="kpi-card"><div class="kpi-label">${t('recon.paid')}</div><div class="kpi-value">${UI.fmt(pay.total_paid)}</div></div>
                <div class="kpi-card ${balanced ? 'green' : 'red'}">
                    <div class="kpi-label">${t('recon.variance')}</div>
                    <div class="kpi-value ${balanced ? 'positive' : 'negative'}">${UI.fmt(v.paid_vs_cash_cr)}</div>
                    <div style="font-size:12px;margin-top:4px">${balanced ? '✅ ' + t('recon.balanced') : '⚠️ ' + t('recon.difference')}</div>
                </div>
            </div>
            <h4 style="margin:16px 0 8px">${t('recon.unmatched')} (${unmatched.length})</h4>
            ${unmatched.length ? `<table class="data-table">
                <thead><tr><th>${t('recon.supplier')}</th><th>${t('mp.date')}</th><th>${t('recon.pay_amt')}</th><th>${t('mp.status')}</th></tr></thead>
                <tbody>${unmatched.map(u => `
                    <tr>
                        <td>${u.supplier_name || '-'}</td>
                        <td>${u.pay_date ? String(u.pay_date).substring(0,10) : '-'}</td>
                        <td class="num negative">${UI.fmt(u.amount)}</td>
                        <td><span style="padding:2px 8px;border-radius:10px;background:#fee2e2;color:#991b1b;font-size:12px">${t('recon.difference')}</span></td>
                    </tr>`).join('')}</tbody>
            </table>` : UI.empty('✅', t('recon.balanced'))}
        `;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

async function loadBank() {
    const _mgr = Auth.isManager();
    const el = document.getElementById('bankTable');
    try {
        const res = await API.get(`/api/bank?bu_no=${State.bu_no}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = UI.empty('🏦', t('bank.no_data')); return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr><th>${t('bank.loan_id')}</th><th>${t('bank.bank')}</th><th>${t('bank.loan_type')}</th><th>${t('bank.loan_amt')}</th><th>${t('bank.exchange_rate')}</th><th>${t('bank.interest_rate')}</th><th>${t('bank.terms')}</th><th>${t('bank.fx_diff')}</th><th>${t('bank.status')}</th>${_mgr ? `<th>${t('delete')}</th>` : ''}</tr></thead>
            <tbody>${rows.map(r => {
                const diff = Number(r.diff_amt || 0);
                return `<tr>
                    <td>${r.loan_id || '-'}</td>
                    <td>${r.bank_id || '-'}</td>
                    <td>${r.loan_type || '-'}</td>
                    <td class="num">${UI.fmt(r.loan_amt)}</td>
                    <td class="num">${UI.fmt(r.exchange_rate, 4)}</td>
                    <td class="num">${UI.fmt(r.interest_rate, 2)}</td>
                    <td class="text-center">${r.pay_terms || '-'}</td>
                    <td class="num ${diff < 0 ? 'negative' : diff > 0 ? 'positive' : ''}">${diff !== 0 ? UI.fmt(diff) : '-'}</td>
                    <td>${tStatus(r.status1) || '-'}</td>
                    ${_mgr ? `<td><button class="btn btn-danger btn-sm" onclick="delBank(${r.uid})">${t('delete')}</button></td>` : ''}
                </tr>`;
            }).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

const BankForm = {
    async open() {
        const typeList = await CodeHelper.list('LOAN_TYPE', [
            { code_value: 'Short-term', value_description: '短期贷款' },
            { code_value: 'Long-term',  value_description: '长期贷款' },
            { code_value: 'FX Loan',    value_description: '外汇贷款' }
        ]);
        const typeSel = typeList.map(o => `<option value="${o.code_value}">${o.code_value}${o.value_description ? ' — ' + o.value_description : ''}</option>`).join('');
        UI.modal(t('bank.add'), `
            <div class="form-row">
                <div class="form-group"><label>${t('bank.loan_id')}</label><input id="bf_id" placeholder="LOAN001"></div>
                <div class="form-group"><label>${t('bank.bank')}</label><input id="bf_bank"></div>
                <div class="form-group"><label>${t('bank.loan_type')}</label><select id="bf_type">${typeSel}</select></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('bank.loan_amt')}</label><input type="number" id="bf_amt" value="0"></div>
                <div class="form-group"><label>${t('bank.exchange_rate')}</label><input type="number" id="bf_rate" value="1" step="0.0001"></div>
                <div class="form-group"><label>${t('bank.interest_rate')}</label><input type="number" id="bf_int" value="5" step="0.01"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('bank.terms')}</label><input type="number" id="bf_terms" value="12"></div>
                <div class="form-group"><label>Last Pay Date</label><input type="date" id="bf_last" value="${new Date().toISOString().substring(0,10)}"></div>
                <div class="form-group"><label>End Date</label><input type="date" id="bf_end"></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">${t('cancel')}</button><button class="btn btn-primary" onclick="BankForm.save()">${t('save')}</button>`);
    },
    async save() {
        const body = {
            bu_no: State.bu_no,
            type1: 'Loan',
            loan_id: document.getElementById('bf_id').value,
            bank_id: document.getElementById('bf_bank').value,
            loan_type: document.getElementById('bf_type').value,
            loan_amt: Number(document.getElementById('bf_amt').value) || 0,
            exchange_rate: Number(document.getElementById('bf_rate').value) || 1,
            interest_rate: Number(document.getElementById('bf_int').value) || 0,
            pay_terms: Number(document.getElementById('bf_terms').value) || 0,
            last_paydate: document.getElementById('bf_last').value,
            end_date: document.getElementById('bf_end').value,
            status1: 'Active'
        };
        try { await API.post('/api/bank', body); UI.toast(t('bank.added'),'success'); UI.closeModal(); loadBank(); }
        catch(e) { UI.toast(e.message,'error'); }
    }
};

async function recalcBank() {
    try {
        const res = await API.post('/api/bank/recalc', { bu_no: State.bu_no });
        UI.toast(`${t('bank.recalc_done')} (${res.data?.updated || 0})`, 'success');
        loadBank();
    } catch(e) { UI.toast(e.message,'error'); }
}

async function delBank(uid) {
    if (!confirm(t('confirm_delete'))) return;
    try { await API.del(`/api/bank/${uid}`); UI.toast(t('deleted'),'success'); loadBank(); }
    catch(e) { UI.toast(e.message,'error'); }
}
