/**
 * 付款明細頁面
 */
registerPage('pay', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <button class="btn btn-primary" onclick="PayForm.open()">➕ ${t('pay.add')}</button>
                <button class="btn btn-success" onclick="loadPay()">🔄 ${t('refresh')}</button>
            </div>
            <div id="payTable">${t('loading')}</div>
        </div>
    `;
    loadPay();
});

async function loadPay() {
    const el = document.getElementById('payTable');
    try {
        const res = await API.get(`/api/pay?bu_no=${State.bu_no}&YYYY_MM=${State.YYYY_MM}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = UI.empty('💳', t('pay.no_data')); return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr><th>${t('pay.date')}</th><th>${t('pay.payee')}</th><th>${t('pay.amount')}</th><th>${t('pay.currency')}</th><th>${t('pay.method')}</th><th>${t('pay.status')}</th><th>${t('delete')}</th></tr></thead>
            <tbody>${rows.map(r => `<tr>
                <td>${UI.fmtDate(r.pay_date)}</td>
                <td>${r.payee || '-'}</td>
                <td class="num">${UI.fmt(r.amt)}</td>
                <td>${r.currency || 'RMB'}</td>
                <td>${r.pay_method || '-'}</td>
                <td>${r.status1 === 'paid' ? t('pay.paid') : t('pay.unpaid')}</td>
                <td>
                    ${r.status1 !== 'paid' ? `<button class="btn btn-success btn-sm" onclick="markPaid(${r.uid})">${t('pay.confirm_paid')}</button>` : ''}
                    <button class="btn btn-danger btn-sm" onclick="delPay(${r.uid})">${t('delete')}</button>
                </td>
            </tr>`).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

const PayForm = {
    open() {
        UI.modal(t('pay.add'), `
            <div class="form-row">
                <div class="form-group"><label>${t('pay.payee')}</label><input id="pf_payee"></div>
                <div class="form-group"><label>${t('pay.date')}</label><input type="date" id="pf_date" value="${new Date().toISOString().substring(0,10)}"></div>
                <div class="form-group"><label>${t('pay.amount')}</label><input type="number" id="pf_amt" value="0"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('pay.currency')}</label><select id="pf_cur"><option>RMB</option><option>USD</option><option>TWD</option><option>HKD</option></select></div>
                <div class="form-group"><label>${t('pay.method')}</label><select id="pf_method"><option>Bank Transfer</option><option>Check</option><option>Cash</option></select></div>
                <div class="form-group"><label>Remark</label><input id="pf_remark"></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">${t('cancel')}</button><button class="btn btn-primary" onclick="PayForm.save()">${t('save')}</button>`);
    },
    async save() {
        const d = document.getElementById('pf_date').value;
        const body = {
            bu_no: State.bu_no,
            pay_date: d,
            YYYY_MM: d.substring(0,7).replace('-','/'),
            payee: document.getElementById('pf_payee').value,
            amt: Number(document.getElementById('pf_amt').value) || 0,
            currency: document.getElementById('pf_cur').value,
            pay_method: document.getElementById('pf_method').value,
            remark: document.getElementById('pf_remark').value,
            status1: 'unpaid'
        };
        try { await API.post('/api/pay', body); UI.toast(t('pay.added'),'success'); UI.closeModal(); loadPay(); }
        catch(e) { UI.toast(e.message,'error'); }
    }
};

async function markPaid(uid) {
    try { await API.post(`/api/pay/${uid}/pay`); UI.toast(t('pay.paid_ok'),'success'); loadPay(); }
    catch(e) { UI.toast(e.message,'error'); }
}

async function delPay(uid) {
    if (!confirm(t('confirm_delete'))) return;
    try { await API.del(`/api/pay/${uid}`); UI.toast(t('deleted'),'success'); loadPay(); }
    catch(e) { UI.toast(e.message,'error'); }
}
