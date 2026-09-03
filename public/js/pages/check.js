/**
 * 票據管理頁面
 */
registerPage('check', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <button class="btn btn-primary" onclick="ChkForm.open()">➕ ${t('chk.add')}</button>
                <button class="btn btn-success" onclick="loadChk()">🔄 ${t('refresh')}</button>
                <div class="spacer"></div>
                <select id="chkStatus" onchange="loadChk()" style="padding:6px;border:1px solid #ddd;border-radius:6px;">
                    <option value="">${t('chk.all')}</option>
                    <option value="未兌現">${t('chk.uncleared')}</option>
                    <option value="已兌現">${t('chk.cleared')}</option>
                </select>
            </div>
            <div id="chkTable">${t('loading')}</div>
        </div>
    `;
    loadChk();
});

async function loadChk() {
    const el = document.getElementById('chkTable');
    try {
        const res = await API.get(`/api/check?bu_no=${State.bu_no}&YYYY_MM=${State.YYYY_MM}`);
        let rows = res.data || [];
        const filter = document.getElementById('chkStatus')?.value;
        if (filter) rows = rows.filter(r => r.status === filter);
        if (rows.length === 0) { el.innerHTML = UI.empty('📝', t('chk.no_data')); return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr><th>${t('chk.no')}</th><th>${t('chk.type')}</th><th>${t('chk.issue_date')}</th><th>${t('chk.due_date')}</th><th>${t('chk.amount')}</th><th>${t('chk.payee')}</th><th>${t('chk.status')}</th><th>${t('delete')}</th></tr></thead>
            <tbody>${rows.map(r => {
                const isCleared = r.status === '已兌現';
                return `<tr>
                <td>${r.check_num || '-'}</td>
                <td>${r.check_type || '-'}</td>
                <td>${UI.fmtDate(r.check_date)}</td>
                <td>${UI.fmtDate(r.due_date)}</td>
                <td class="num">${UI.fmt(r.amount)}</td>
                <td>${r.to_company || '-'}</td>
                <td>${isCleared ? '<span style="color:#27ae60;font-weight:bold">'+t('chk.cleared')+'</span>' : '<span style="color:#f39c12;font-weight:bold">'+t('chk.uncleared')+'</span>'}</td>
                <td>
                    ${!isCleared ? `<button class="btn btn-success btn-sm" onclick="clearChk(${r.uid})">${t('chk.clear')}</button>` : ''}
                    <button class="btn btn-danger btn-sm" onclick="delChk(${r.uid})">${t('delete')}</button>
                </td>
            </tr>`;
            }).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

const ChkForm = {
    open() {
        UI.modal(t('chk.add'), `
            <div class="form-row">
                <div class="form-group"><label>${t('chk.type')}</label><select id="cf_type"><option>轉帳支票</option><option>現金支票</option><option>本票</option></select></div>
                <div class="form-group"><label>${t('chk.no')}</label><input id="cf_num"></div>
                <div class="form-group"><label>${t('chk.amount')}</label><input type="number" id="cf_amt" value="0"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('chk.issue_date')}</label><input type="date" id="cf_date" value="${new Date().toISOString().substring(0,10)}"></div>
                <div class="form-group"><label>${t('chk.due_date')}</label><input type="date" id="cf_due"></div>
                <div class="form-group"><label>${t('chk.payee')}</label><input id="cf_to"></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">${t('cancel')}</button><button class="btn btn-primary" onclick="ChkForm.save()">${t('save')}</button>`);
    },
    async save() {
        const d = document.getElementById('cf_date').value;
        const body = {
            bu_no: State.bu_no,
            check_type: document.getElementById('cf_type').value,
            check_num: document.getElementById('cf_num').value,
            amount: Number(document.getElementById('cf_amt').value) || 0,
            check_date: d,
            due_date: document.getElementById('cf_due').value,
            to_company: document.getElementById('cf_to').value,
            status: '未兌現',
            remark: ''
        };
        try { await API.post('/api/check', body); UI.toast(t('chk.added'),'success'); UI.closeModal(); loadChk(); }
        catch(e) { UI.toast(e.message,'error'); }
    }
};

async function clearChk(uid) {
    if (!confirm(t('chk.cleared') + '?')) return;
    try {
        const res = await API.post(`/api/check/${uid}/clear`);
        if (res.success !== false) {
            UI.toast(t('chk.cleared_ok'),'success');
            loadChk();
        } else {
            UI.toast(res.message || t('load_failed'), 'error');
        }
    } catch(e) { UI.toast(e.message,'error'); }
}

async function delChk(uid) {
    if (!confirm(t('confirm_delete'))) return;
    try { await API.del(`/api/check/${uid}`); UI.toast(t('deleted'),'success'); loadChk(); }
    catch(e) { UI.toast(e.message,'error'); }
}
