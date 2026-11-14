﻿﻿﻿﻿/**
 * 付款申请页面
 * 复用审批流、审批中心、码表
 */
const PayRequestPage = {
    tab: 'mine',            // mine | todo | all
    rows: [],

    async load() {
        const el = document.getElementById('pageContent');
        if (!el) return;
        if (!Auth.isLoggedIn()) { Auth.showLogin(); return; }
        // todo 页复用审批中心；这里只渲染 mine / all
        this.renderTabs();
        try {
            const scope = this.tab === 'all' ? 'all' : 'mine';
            const res = await API.get(`/api/pay-request?scope=${scope}`);
            this.rows = res.data || [];
            this.renderTable();
        } catch (e) {
            el.innerHTML = `<div style="padding:20px;color:#e74c3c;">${UI.empty ? '' : ''}${appEsc(e.message)}</div>`;
        }
    },

    renderTabs() {
        const mine = APP_L('我的付款申请', '我的付款申請', 'My Payment Requests');
        const todo = APP_L('待我审批', '待我審批', 'My Approvals');
        const all  = APP_L('全部单据', '全部單據', 'All');
        const tabs = [
            {k:'mine', label:mine},
            {k:'todo', label:todo},
        ];
        if (Auth.isAdmin() || Auth.isManager()) tabs.push({k:'all', label:all});

        document.getElementById('pageTitle').textContent = APP_L('付款申请', '付款申請', 'Payment Request');
        document.getElementById('pageContent').innerHTML = `
            <div class="page-header">
                <div class="tabs">
                    ${tabs.map(t => `<div class="tab-item ${this.tab===t.k?'active':''}" onclick="PayRequestPage.switchTab('${t.k}')">${t.label}</div>`).join('')}
                </div>
                <div class="page-actions">
                    <button class="btn btn-primary" onclick="PayRequestPage.openForm()">
                        + ${APP_L('新建付款申请', '新建付款申請', 'New Payment Request')}
                    </button>
                </div>
            </div>
            <div id="payBody"></div>
        `;
        const tabsEl = document.querySelector('#pageContent .tabs');
        if (tabsEl && typeof bindTabs === 'function') bindTabs(tabsEl);
    },

    switchTab(tab) {
        this.tab = tab;
        if (tab === 'todo' && typeof ApprovalPage !== 'undefined') {
            ApprovalPage.tab = 'todo';
            return ApprovalPage.load();
        }
        this.load();
    },

    renderTable() {
        const el = document.getElementById('payBody');
        if (!el) return;
        if (!this.rows.length) {
            el.innerHTML = UI.empty ? UI.empty('💳', APP_L('暂无付款申请', '暫無付款申請', 'No payment requests yet')) : `<div style="padding:30px;text-align:center;color:#999;">${APP_L('暂无付款申请', '暫無付款申請', 'No payment requests yet')}</div>`;
            return;
        }
        const appEsc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table">
                <thead><tr>
                    <th>${APP_L('单号', '單號', 'No.')}</th>
                    <th>${APP_L('收款方', '收款方', 'Payee')}</th>
                    <th>${APP_L('类型', '類型', 'Type')}</th>
                    <th>${APP_L('金额', '金額', 'Amount')}</th>
                    <th>${APP_L('状态', '狀態', 'Status')}</th>
                    <th>${APP_L('当前审批', '當前審批', 'Current Approver')}</th>
                    <th>${APP_L('预计付款日', '預計付款日', 'Due Date')}</th>
                    <th>${APP_L('操作', '操作', 'Actions')}</th>
                </tr></thead>
                <tbody>
                ${this.rows.map(r => `
                <tr>
                    <td><b>${appEsc(r.request_no)}</b></td>
                    <td>${appEsc(r.pay_target || '')}</td>
                    <td>${this.payTypeLabel(r.pay_type)}</td>
                    <td style="text-align:right;">${UI.fmt(r.total_amount)} ${appEsc(r.currency || '')}</td>
                    <td>${this.statusBadge(r.status)}</td>
                    <td>${(r.waiting_for && r.waiting_for.length) ? r.waiting_for.map(id => this.userName(id)).join('、') : '-'}</td>
                    <td>${appEsc(String(r.due_date || '').substring(0,10))}</td>
                    <td>
                        ${(this.tab === 'mine' || this.tab === 'all') ? `
                            <button class="btn btn-ghost" onclick="PayRequestPage.detail(${r.id})">${t('view') || '查看'}</button>
                            ${(r.status === 'DRAFT' || r.status === 'REJECTED') && r.applicant_id === Auth.getUser().user_id ? `<button class="btn btn-ghost" onclick="PayRequestPage.openForm(${r.id})">${APP_L('编辑', '編輯', 'Edit')}</button>` : ''}
                            ${r.status === 'DRAFT' && r.applicant_id === Auth.getUser().user_id ? `<button class="btn btn-danger" onclick="PayRequestPage.del(${r.id})">${APP_L('删除', '刪除', 'Delete')}</button>` : ''}
                            ${r.status === 'PENDING' && r.applicant_id === Auth.getUser().user_id ? `<button class="btn btn-ghost" onclick="PayRequestPage.submit(${r.id})">${APP_L('提交', '提交', 'Submit')}</button>` : ''}
                            ${r.status === 'PENDING' && r.applicant_id === Auth.getUser().user_id ? `<button class="btn btn-ghost" onclick="PayRequestPage.cancel(${r.id})">${APP_L('撤回', '撤回', 'Cancel')}</button>` : ''}
                            ${r.status === 'APPROVED' && Auth.isAdmin() ? `<button class="btn btn-primary" onclick="PayRequestPage.pay(${r.id})">${APP_L('标记付款', '標記付款', 'Mark Paid')}</button>` : ''}
                        ` : ''}
                    </td>
                </tr>`).join('')}
                </tbody>
            </table></div>
        `;
    },

    userName(id) {
        const u = Auth.getUser();
        return (u && u.user_id === id) ? (u.user_name || id) : id;
    },
    payTypeLabel(t) {
        return ({ SALARY:APP_L('薪资','薪資','Salary'), TAX:APP_L('税金','稅金','Tax'), RENT:APP_L('房租','房租','Rent'), SUPPLIER:APP_L('供应商','供應商','Supplier'), OTHER:APP_L('其他','其他','Other') })[t] || t || '-';
    },
    statusLabel(s) {
        return ({ DRAFT:APP_L('草稿','草稿','Draft'), PENDING:APP_L('审批中','審批中','Pending'), APPROVED:APP_L('已通过','已通過','Approved'), REJECTED:APP_L('已驳回','已駁回','Rejected'), PAID:APP_L('已付款','已付款','Paid'), CANCELLED:APP_L('已撤回','已撤回','Withdrawn') })[s] || s;
    },
    statusBadge(s) {
        const cls = { PENDING:'bg-warning', APPROVED:'bg-success', PAID:'bg-info', REJECTED:'bg-danger', CANCELLED:'bg-danger' }[s] || '';
        return `<span class="badge ${cls}">${this.statusLabel(s)}</span>`;
    },

    async openForm(id) {
        const appEsc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
        let data = null;
        if (id) {
            try { data = (await API.get(`/api/pay-request/${id}`)).data; }
            catch(e) { return UI.toast(e.message, 'error'); }
        }
        const form = data || { pay_type:'SUPPLIER', pay_method:'BANK', bu_no:'HM', currency:'TWD', items:[{}] };
        const types = ['SALARY','TAX','RENT','SUPPLIER','OTHER'];
        const methods = ['BANK','TRANSFER','CASH','CHECK'];
        const typeSel = types.map(v => `<option value="${v}" ${form.pay_type===v?'selected':''}>${this.payTypeLabel(v)}</option>`).join('');
        const methodSel = methods.map(v => `<option value="${v}" ${form.pay_method===v?'selected':''}>${this.payTypeLabel(v)}</option>`).join('');

        const rows = (form.items || [{}]).map((it, i) => `
            <tr>
                <td>${i+1}</td>
                <td><input class="form-input" style="min-width:180px;" placeholder="${APP_L('收款方/供应商', '收款方/供應商', 'Payee/Supplier')}" value="${appEsc(it.supplier_name||'')}" data-k="supplier_name"></td>
                <td><input class="form-input" style="width:160px;" placeholder="${APP_L('发票号', '發票號', 'Invoice #')}" value="${appEsc(it.invoice_num||'')}" data-k="invoice_num"></td>
                <td><input type="date" class="form-input" style="width:140px;" value="${appEsc(it.invoice_date||'')}" data-k="invoice_date"></td>
                <td><input type="date" class="form-input" style="width:140px;" value="${appEsc(it.should_date||'')}" data-k="should_date"></td>
                <td><input type="number" step="0.01" class="form-input" style="width:130px;text-align:right;" placeholder="0.00" value="${it.amount||''}" data-k="amount"></td>
                <td><button class="btn btn-ghost" onclick="this.closest('tr').remove();PayRequestPage.recalc()">✕</button></td>
            </tr>`).join('');

        UI.modal(
            (id ? APP_L('编辑付款申请', '編輯付款申請', 'Edit Payment Request') : APP_L('新建付款申请', '新建付款申請', 'New Payment Request')),
            `
            <div class="form-grid">
                <div><label>${APP_L('付款类型', '付款類型', 'Pay Type')}</label><select id="f_pay_type" class="form-input">${typeSel}</select></div>
                <div><label>${APP_L('收款方', '收款方', 'Payee')}</label><input id="f_pay_target" class="form-input" placeholder="${APP_L('供应商/收款单位', '供應商/收款單位', 'Supplier/Payee')}" value="${appEsc(form.pay_target||'')}"></div>
                <div><label>${APP_L('付款方式', '付款方式', 'Method')}</label><select id="f_pay_method" class="form-input">${methodSel}</select></div>
                <div><label>${t('topbar.bu') || APP_L('公司', '公司', 'BU')}</label>
                    <select id="f_bu_no" class="form-input">${['HM','LD','MQ','JS','VENTEC','ICHIA','GY'].map(v=>`<option ${form.bu_no===v?'selected':''}>${v}</option>`).join('')}</select>
                </div>
                <div><label>${APP_L('币种', '幣種', 'Currency')}</label><select id="f_currency" class="form-input">${['TWD','USD','RMB','EUR','JPY','HKD'].map(v=>`<option ${(form.currency||form.currency_ab||'TWD')===v?'selected':''}>${v}</option>`).join('')}</select></div>
                <div><label>${APP_L('预计付款日', '預計付款日', 'Due Date')}</label><input id="f_due_date" type="date" class="form-input" value="${appEsc(form.due_date||'')}"></div>
                <div class="col-2"><label>${APP_L('备注', '備註', 'Remark')}</label><input id="f_remark" class="form-input" value="${appEsc(form.remark||'')}"></div>
            </div>

            <h4 style="margin-top:18px;">${APP_L('付款明细', '付款明細', 'Payment Details')}
                <button class="btn btn-ghost" onclick="PayRequestPage.addRow()" style="margin-left:8px;">+ ${APP_L('新增行', '新增行', 'Add Row')}</button>
                <span id="prTotal" style="float:right;color:#e74c3c;font-weight:700;font-size:1.1em;">${UI.fmt(form.total_amount || 0)} ${appEsc(form.currency||'TWD')}</span>
            </h4>
            <div style="overflow-x:auto;">
            <table class="data-table">
                <thead><tr>
                    <th>#</th><th>${APP_L('收款方', '收款方', 'Payee/Supplier')}</th><th>${APP_L('发票号', '發票號', 'Invoice #')}</th>
                    <th>${APP_L('发票日', '發票日', 'Invoice Date')}</th><th>${APP_L('到期日', '到期日', 'Due')}</th>
                    <th>${APP_L('金额', '金額', 'Amount')}</th><th></th>
                </tr></thead>
                <tbody id="prRows">${rows}</tbody>
            </table></div>
            `,
            `<button class="btn btn-ghost" onclick="UI.closeModal()">${APP_L('取消', '取消', 'Cancel')}</button>
             <button class="btn btn-primary" onclick="PayRequestPage.save(${id||0})">${APP_L('保存', '保存', 'Save')}</button>`
        );
        document.querySelectorAll('#prRows input[data-k="amount"]').forEach(inp => inp.addEventListener('input', () => PayRequestPage.recalc()));
    },

    addRow() {
        const tbody = document.getElementById('prRows');
        const idx = tbody.rows.length + 1;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${idx}</td>
            <td><input class="form-input" style="min-width:180px;" data-k="supplier_name"></td>
            <td><input class="form-input" style="width:160px;" data-k="invoice_num"></td>
            <td><input type="date" class="form-input" style="width:140px;" data-k="invoice_date"></td>
            <td><input type="date" class="form-input" style="width:140px;" data-k="should_date"></td>
            <td><input type="number" step="0.01" class="form-input" style="width:130px;text-align:right;" data-k="amount"></td>
            <td><button class="btn btn-ghost" onclick="this.closest('tr').remove();PayRequestPage.recalc()">✕</button></td>
        `;
        tbody.appendChild(tr);
        tr.querySelector('input[data-k="amount"]').addEventListener('input', () => PayRequestPage.recalc());
        PayRequestPage.recalc();
    },

    recalc() {
        const rows = document.querySelectorAll('#prRows tr');
        let total = 0;
        rows.forEach(tr => {
            const a = tr.querySelector('input[data-k="amount"]');
            total += Number(a && a.value) || 0;
        });
        const totalEl = document.getElementById('prTotal');
        if (totalEl) totalEl.textContent = UI.fmt(total);
    },

    async save(id) {
        const f = (sel) => document.querySelector(sel).value;
        const rows = document.querySelectorAll('#prRows tr');
        const items = [];
        for (const tr of rows) {
            const item = {};
            tr.querySelectorAll('input[data-k]').forEach(inp => { item[inp.dataset.k] = inp.value; });
            if (item.supplier_name || item.amount) {
                item.amount = Number(item.amount) || 0;
                items.push(item);
            }
        }
        if (!items.length) return UI.toast(APP_L('至少需一条明细', '至少需一條明細', 'At least one item required'), 'error');
        const body = {
            bu_no: f('#f_bu_no'), pay_type: f('#f_pay_type'), pay_target: f('#f_pay_target'),
            pay_method: f('#f_pay_method'), currency: f('#f_currency'),
            due_date: f('#f_due_date'), remark: f('#f_remark'), items
        };
        try {
            const res = id ? await API.put(`/api/pay-request/${id}`, body) : await API.post('/api/pay-request', body);
            UI.toast(res.message || 'OK', 'success');
            UI.closeModal();
            this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async submit(id) {
        try {
            const res = await API.post(`/api/pay-request/${id}/submit`, {});
            UI.toast(res.message, 'success');
            this.load();
            if (typeof refreshApprovalBadge === 'function') refreshApprovalBadge();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async cancel(id) {
        if (!confirm(APP_L('确认撤回？', '確認撤回？', 'Confirm withdraw?'))) return;
        try {
            await API.post(`/api/workflow/instances/${id}/cancel`, {});
            UI.toast(APP_L('已撤回', '已撤回', 'Withdrawn'), 'success');
            this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async del(id) {
        if (!confirm(APP_L('确认删除？', '確認刪除？', 'Confirm delete?'))) return;
        try { await API.del(`/api/pay-request/${id}`); UI.toast(APP_L('已删除', '已刪除', 'Deleted'), 'success'); this.load(); }
        catch (e) { UI.toast(e.message, 'error'); }
    },

    async pay(id) {
        try {
            await API.post(`/api/pay-request/${id}/pay`, {});
            UI.toast(APP_L('已标记付款', '已標記付款', 'Marked Paid'), 'success');
            this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async detail(id) {
        const appEsc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
        try {
            const d = (await API.get(`/api/pay-request/${id}`)).data;
            const items = (d.items || []).map((it, i) => `
                <tr>
                    <td>${i+1}</td>
                    <td>${appEsc(it.supplier_name||'-')}</td>
                    <td>${appEsc(it.invoice_num||'-')}</td>
                    <td>${appEsc(String(it.invoice_date||'').slice(0,10))}</td>
                    <td>${appEsc(String(it.should_date||'').slice(0,10))}</td>
                    <td style="text-align:right;">${UI.fmt(it.amount)}</td>
                </tr>`).join('');
            UI.modal(
                `${appEsc(d.request_no)} - ${appEsc(d.pay_target)}`,
                `
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px 24px;margin-bottom:16px;">
                    <div><b>${APP_L('付款类型', '付款類型', 'Type')}：</b>${this.payTypeLabel(d.pay_type)}</div>
                    <div><b>${APP_L('付款方式', '付款方式', 'Method')}：</b>${appEsc(d.pay_method||'-')}</div>
                    <div><b>${t('topbar.bu')}：</b>${appEsc(d.bu_no||'-')}</div>
                    <div><b>${APP_L('币种', '幣種', 'Currency')}：</b>${appEsc(d.currency||'-')}</div>
                    <div><b>${APP_L('预计付款日', '預計付款日', 'Due')}：</b>${appEsc(String(d.due_date||'').slice(0,10))}</div>
                    <div><b>${APP_L('状态', '狀態', 'Status')}：</b>${this.statusBadge(d.status)}</div>
                </div>
                <h4 style="margin-top:16px;">${APP_L('明细', '明細', 'Items')}　<b style="float:right;color:#e74c3c;">${UI.fmt(d.total_amount)} ${appEsc(d.currency||'')}</b></h4>
                <table class="data-table"><thead><tr>
                    <th>#</th><th>${APP_L('收款方', '收款方', 'Payee')}</th><th>${APP_L('发票号', '發票號', 'Inv#')}</th>
                    <th>${APP_L('发票日', '發票日', 'Inv Date')}</th><th>${APP_L('到期', '到期', 'Due')}</th><th>${APP_L('金额', '金額', 'Amount')}</th>
                </tr></thead><tbody>${items}</tbody></table>
                ${d.remark ? `<p style="margin-top:10px;"><b>${APP_L('备注', '備註', 'Remark')}：</b>${appEsc(d.remark)}</p>` : ''}
                `,
                `<button class="btn btn-ghost" onclick="UI.closeModal()">${t('close') || t('cancel') || APP_L('关闭', '關閉', 'Close')}</button>
                 ${d._canEdit ? `<button class="btn btn-primary" onclick="UI.closeModal();PayRequestPage.openForm(${d.id})">${APP_L('编辑', '編輯', 'Edit')}</button>` : ''}
                 ${d._canPay ? `<button class="btn btn-primary" onclick="UI.closeModal();PayRequestPage.pay(${d.id})">${APP_L('标记付款', '標記付款', 'Mark Paid')}</button>` : ''}`
            );
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};

registerPage('payRequest', () => PayRequestPage.load());
