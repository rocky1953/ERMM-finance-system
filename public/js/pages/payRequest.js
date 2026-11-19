﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿/**
 * 付款申请页面
 * 复用审批流、审批中心、码表
 */
function prEsc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const PayRequestPage = {
    tab: 'mine',            // mine | todo | all | schedule
    rows: [],
    schedule: null,
    scheduleMonth: '',

    async load() {
        const el = document.getElementById('pageContent');
        if (!el) return;
        if (!Auth.isLoggedIn()) { Auth.showLogin(); return; }
        // todo 页复用审批中心；这里只渲染 mine / all
        this.renderTabs();
        try {
            if (this.tab === 'schedule') {
                const month = this.scheduleMonth || new Date().toISOString().slice(0, 7);
                this.scheduleMonth = month;
                const res = await API.get(`/api/pay-request/schedule?month=${month}`);
                this.schedule = res.data || { month, summary: {}, rows: [] };
                this.renderSchedule();
                return;
            }
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
        if (Auth.isAdmin() || Auth.isManager()) {
            tabs.push({k:'schedule', label:APP_L('付款排程', '付款排程', 'Payment Schedule')});
        }

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
                    <th>${APP_L('计划付款日', '計劃付款日', 'Planned Date')}</th>
                    <th>${APP_L('银行回单', '銀行回單', 'Bank Receipt')}</th>
                    <th>${APP_L('核销', '核銷', 'Write-off')}</th>
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
                    <td>${appEsc(String(r.planned_pay_date || r.due_date || '').substring(0,10))}</td>
                    <td>${appEsc(r.bank_receipt_no || '-')}</td>
                    <td>${this.writeoffBadge(r.writeoff_status)}</td>
                    <td style="white-space:nowrap;">
                        ${(this.tab === 'mine' || this.tab === 'all') ? `
                            <button class="btn btn-ghost" onclick="PayRequestPage.detail(${r.id})">${t('view') || '查看'}</button>
                            ${(r.status === 'DRAFT' || r.status === 'REJECTED') && r.applicant_id === Auth.getUser().user_id ? `<button class="btn btn-ghost" onclick="PayRequestPage.openForm(${r.id})">${APP_L('编辑', '編輯', 'Edit')}</button>` : ''}
                            ${r.status === 'DRAFT' && r.applicant_id === Auth.getUser().user_id ? `<button class="btn btn-danger" onclick="PayRequestPage.del(${r.id})">${APP_L('删除', '刪除', 'Delete')}</button>` : ''}
                            ${r.status === 'PENDING' && r.applicant_id === Auth.getUser().user_id ? `<button class="btn btn-ghost" onclick="PayRequestPage.submit(${r.id})">${APP_L('提交', '提交', 'Submit')}</button>` : ''}
                            ${r.status === 'PENDING' && r.applicant_id === Auth.getUser().user_id ? `<button class="btn btn-ghost" onclick="PayRequestPage.cancel(${r.id})">${APP_L('撤回', '撤回', 'Cancel')}</button>` : ''}
                            ${['DRAFT','PENDING','APPROVED'].includes(r.status) && this.canFinance() ? `<button class="btn btn-ghost" onclick="PayRequestPage.openSchedule(${r.id}, '${appEsc(r.planned_pay_date || '')}')">${APP_L('排程', '排程', 'Schedule')}</button>` : ''}
                            ${r.status === 'APPROVED' && Auth.isAdmin() ? `<button class="btn btn-primary" onclick="PayRequestPage.openReceipt(${r.id}, ${Number(r.total_amount) || 0})">${APP_L('登记回单', '登記回單', 'Receipt')}</button>` : ''}
                            ${r.status === 'APPROVED' && Auth.isAdmin() ? `<button class="btn btn-ghost" onclick="PayRequestPage.pay(${r.id})">${APP_L('标记付款', '標記付款', 'Mark Paid')}</button>` : ''}
                            ${r.status === 'PAID' && this.canFinance() ? `<button class="btn btn-primary" onclick="PayRequestPage.openWriteoff(${r.id}, ${Number(r.total_amount) || 0})">${APP_L('核销', '核銷', 'Write-off')}</button>` : ''}
                            ${r.status === 'PAID' && this.canFinance() ? `<button class="btn btn-ghost" onclick="PayRequestPage.viewWriteoffs(${r.id})">${APP_L('核销明细', '核銷明細', 'Write-offs')}</button>` : ''}
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
        const form = data || { pay_type:'SUPPLIER', pay_method:'BANK', bu_no:'HM', currency:'RMB', items:[{}] };
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
                <div><label>${APP_L('币种', '幣種', 'Currency')}</label><select id="f_currency" class="form-input">${['RMB','TWD','USD','EUR','JPY','HKD'].map(v=>`<option ${(form.currency||form.currency_ab||'RMB')===v?'selected':''}>${v}</option>`).join('')}</select></div>
                <div><label>${APP_L('预计付款日', '預計付款日', 'Due Date')}</label><input id="f_due_date" type="date" class="form-input" value="${appEsc(form.due_date||'')}"></div>
                <div class="col-2"><label>${APP_L('备注', '備註', 'Remark')}</label><input id="f_remark" class="form-input" value="${appEsc(form.remark||'')}"></div>
            </div>

            <h4 style="margin-top:18px;">${APP_L('付款明细', '付款明細', 'Payment Details')}
                <button class="btn btn-ghost" onclick="PayRequestPage.addRow()" style="margin-left:8px;">+ ${APP_L('新增行', '新增行', 'Add Row')}</button>
                <span id="prTotal" style="float:right;color:#e74c3c;font-weight:700;font-size:1.1em;">${UI.fmt(form.total_amount || 0)} ${appEsc(form.currency||'RMB')}</span>
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
    },

    // =====================================================================
    // CFO-02：付款排程 / 银行回单 / AR·AP 核销
    // =====================================================================
    canFinance() {
        return Auth.isAdmin() || Auth.isManager();
    },

    writeoffLabel(s) {
        return {
            UNWRITTEN: APP_L('未核销', '未核銷', 'Not written off'),
            PARTIAL: APP_L('部分核销', '部分核銷', 'Partial'),
            WRITTEN: APP_L('已核销', '已核銷', 'Written off')
        }[s || 'UNWRITTEN'] || (s || '-');
    },

    writeoffBadge(s) {
        const cls = { WRITTEN: 'bg-success', PARTIAL: 'bg-warning', UNWRITTEN: '' }[s || 'UNWRITTEN'] || '';
        return `<span class="badge ${cls}">${this.writeoffLabel(s)}</span>`;
    },

    renderSchedule() {
        const el = document.getElementById('payBody');
        if (!el) return;
        const s = this.schedule || { summary: {}, rows: [] };
        const sm = s.summary || {};
        const rows = s.rows || [];
        const kpi = [
            [APP_L('排程笔数', '排程筆數', 'Scheduled'), sm.count || 0],
            [APP_L('排程金额', '排程金額', 'Scheduled Amount'), UI.fmt(sm.amount || 0)],
            [APP_L('已付款', '已付款', 'Paid'), `${sm.paid_count || 0} / ${UI.fmt(sm.paid_amount || 0)}`],
            [APP_L('待付款', '待付款', 'Pending'), `${sm.pending_count || 0} / ${UI.fmt(sm.pending_amount || 0)}`]
        ];
        el.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                <label>${APP_L('排程月份', '排程月份', 'Month')}</label>
                <input type="month" class="form-input" style="width:170px;" value="${prEsc(s.month || this.scheduleMonth || '')}"
                       onchange="PayRequestPage.scheduleMonth=this.value;PayRequestPage.load()">
            </div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;">
                ${kpi.map(([label, val]) => `
                    <div class="card" style="padding:12px 14px;border:1px solid #e6e9ef;border-radius:8px;">
                        <div style="color:#7f8c8d;font-size:.85em;">${label}</div>
                        <div style="font-size:1.2em;font-weight:700;margin-top:4px;">${val}</div>
                    </div>`).join('')}
            </div>
            ${!rows.length
                ? (UI.empty ? UI.empty('📅', APP_L('本月暂无排程', '本月暫無排程', 'No scheduled payments')) : '')
                : `<div style="overflow-x:auto;"><table class="data-table">
                    <thead><tr>
                        <th>${APP_L('计划付款日', '計劃付款日', 'Planned Date')}</th>
                        <th>${APP_L('单号', '單號', 'No.')}</th>
                        <th>${APP_L('收款方', '收款方', 'Payee')}</th>
                        <th>${APP_L('金额', '金額', 'Amount')}</th>
                        <th>${APP_L('状态', '狀態', 'Status')}</th>
                        <th>${APP_L('回单号', '回單號', 'Receipt#')}</th>
                        <th>${APP_L('核销', '核銷', 'Write-off')}</th>
                        <th>${APP_L('操作', '操作', 'Actions')}</th>
                    </tr></thead>
                    <tbody>
                    ${rows.map(r => `<tr>
                        <td>${prEsc(String(r.planned_pay_date || '').slice(0, 10))}</td>
                        <td><b>${prEsc(r.request_no)}</b></td>
                        <td>${prEsc(r.pay_target || '')}</td>
                        <td style="text-align:right;">${UI.fmt(r.total_amount)} ${prEsc(r.currency || '')}</td>
                        <td>${this.statusBadge(r.status)}</td>
                        <td>${prEsc(r.bank_receipt_no || '-')}</td>
                        <td>${this.writeoffBadge(r.writeoff_status)}</td>
                        <td style="white-space:nowrap;">
                            <button class="btn btn-ghost" onclick="PayRequestPage.detail(${r.id})">${APP_L('查看', '查看', 'View')}</button>
                            ${r.status === 'APPROVED' && Auth.isAdmin() ? `<button class="btn btn-primary" onclick="PayRequestPage.openReceipt(${r.id}, ${Number(r.total_amount) || 0})">${APP_L('登记回单', '登記回單', 'Receipt')}</button>` : ''}
                        </td>
                    </tr>`).join('')}
                    </tbody>
                </table></div>`}
        `;
    },

    openSchedule(id, current) {
        const today = new Date().toISOString().slice(0, 10);
        const val = String(current || today).slice(0, 10);
        UI.modal(APP_L('设定付款排程', '設定付款排程', 'Payment Schedule'), `
            <div class="form-grid">
                <div><label>${APP_L('计划付款日', '計劃付款日', 'Planned Pay Date')}</label>
                    <input type="date" id="pr_planned" class="form-input" value="${prEsc(val)}"></div>
            </div>
            <p style="color:#7f8c8d;font-size:.85em;margin-top:10px;">
                ${APP_L('排程后该单据会出现在付款排程日历与月度汇总中。', '排程後該單據會出現在付款排程日曆與月度彙總中。', 'Scheduled requests appear in the monthly payment schedule.')}
            </p>
        `, `
            <button class="btn btn-ghost" onclick="UI.closeModal()">${APP_L('取消', '取消', 'Cancel')}</button>
            <button class="btn btn-primary" onclick="PayRequestPage.saveSchedule(${id})">${APP_L('保存', '保存', 'Save')}</button>
        `);
    },

    async saveSchedule(id) {
        const planned_pay_date = document.getElementById('pr_planned').value;
        if (!planned_pay_date) return UI.toast(APP_L('请选择计划付款日', '請選擇計劃付款日', 'Pick a planned date'), 'error');
        try {
            const res = await API.put(`/api/pay-request/${id}/schedule`, { planned_pay_date });
            UI.toast(res.message || 'OK', 'success');
            UI.closeModal();
            if (this.tab === 'schedule') this.scheduleMonth = planned_pay_date.slice(0, 7);
            this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    openReceipt(id, amount) {
        const today = new Date().toISOString().slice(0, 10);
        UI.modal(APP_L('登记银行回单', '登記銀行回單', 'Register Bank Receipt'), `
            <div class="form-grid">
                <div><label>${APP_L('银行回单号', '銀行回單號', 'Receipt No.')}</label>
                    <input id="pr_receipt_no" class="form-input" placeholder="${APP_L('银行流水号/回单编号', '銀行流水號/回單編號', 'Bank receipt no.')}"></div>
                <div><label>${APP_L('回单日期', '回單日期', 'Receipt Date')}</label>
                    <input type="date" id="pr_receipt_date" class="form-input" value="${prEsc(today)}"></div>
                <div><label>${APP_L('回单金额', '回單金額', 'Receipt Amount')}</label>
                    <input type="number" step="0.01" id="pr_receipt_amount" class="form-input" value="${(Number(amount) || 0).toFixed(2)}"></div>
                <div><label>${APP_L('付款银行', '付款銀行', 'Bank')}</label>
                    <input id="pr_receipt_bank" class="form-input" placeholder="${APP_L('开户行名称', '開戶行名稱', 'Bank name')}"></div>
            </div>
            <p style="color:#7f8c8d;font-size:.85em;margin-top:10px;">
                ${APP_L('登记回单后单据将标记为已付款，可继续做 AR/AP 核销。', '登記回單後單據將標記為已付款，可繼續做 AR/AP 核銷。', 'Registering a receipt marks the request as paid and enables AR/AP write-off.')}
            </p>
        `, `
            <button class="btn btn-ghost" onclick="UI.closeModal()">${APP_L('取消', '取消', 'Cancel')}</button>
            <button class="btn btn-primary" onclick="PayRequestPage.saveReceipt(${id})">${APP_L('确认登记', '確認登記', 'Confirm')}</button>
        `);
    },

    async saveReceipt(id) {
        const body = {
            bank_receipt_no: (document.getElementById('pr_receipt_no').value || '').trim(),
            receipt_date: document.getElementById('pr_receipt_date').value,
            receipt_amount: Number(document.getElementById('pr_receipt_amount').value) || 0,
            receipt_bank: (document.getElementById('pr_receipt_bank').value || '').trim()
        };
        if (!body.bank_receipt_no) return UI.toast(APP_L('请填写银行回单号', '請填寫銀行回單號', 'Receipt no. required'), 'error');
        try {
            const res = await API.post(`/api/pay-request/${id}/receipt`, body);
            UI.toast(res.message || 'OK', 'success');
            UI.closeModal();
            this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async openWriteoff(id, total) {
        let sources = [];
        let done = 0;
        try {
            const [ap, ar, wo] = await Promise.all([
                API.get('/api/pay-request/writeoff-sources?source_type=AP'),
                API.get('/api/pay-request/writeoff-sources?source_type=AR').catch(() => ({ data: [] })),
                API.get(`/api/pay-request/${id}/writeoffs`)
            ]);
            sources = [
                ...(ap.data || []).map(s => ({ ...s, source_type: 'AP' })),
                ...(ar.data || []).map(s => ({ ...s, source_type: 'AR' }))
            ];
            done = Number((wo.data || {}).total || 0);
        } catch (e) { return UI.toast(e.message, 'error'); }

        const remain = Math.max(0, Number(total) - done);
        const opt = (s) => `<option value="${s.uid}">[${s.source_type}] ${prEsc(s.invoice_no || s.uid)} | ${prEsc(s.client_id || '')} | ${APP_L('未付', '未付', 'Open')} ${UI.fmt(s.open_amount)}</option>`;
        const opts = sources.length
            ? sources.map(opt).join('')
            : `<option value="">${APP_L('暂无未付清的发票', '暫無未付清的發票', 'No open invoices')}</option>`;

        UI.modal(APP_L('AR/AP 核销', 'AR/AP 核銷', 'AR/AP Write-off'), `
            <div class="form-grid">
                <div class="col-2"><label>${APP_L('核销发票（来源）', '核銷發票（來源）', 'Invoice (source)')}</label>
                    <select id="pr_wo_source" class="form-input">${opts}</select></div>
                <div><label>${APP_L('核销金额', '核銷金額', 'Amount')}</label>
                    <input type="number" step="0.01" id="pr_wo_amount" class="form-input" value="${remain.toFixed(2)}"></div>
                <div><label>${APP_L('核销日期', '核銷日期', 'Date')}</label>
                    <input type="date" id="pr_wo_date" class="form-input" value="${prEsc(new Date().toISOString().slice(0, 10))}"></div>
                <div class="col-2"><label>${APP_L('备注', '備註', 'Note')}</label>
                    <input id="pr_wo_note" class="form-input"></div>
            </div>
            <p style="color:#7f8c8d;font-size:.85em;margin-top:10px;">
                ${APP_L('本单剩余可核销', '本單剩餘可核銷', 'Remaining on this request')}: <b>${UI.fmt(remain)}</b>
            </p>
        `, `
            <button class="btn btn-ghost" onclick="UI.closeModal()">${APP_L('取消', '取消', 'Cancel')}</button>
            <button class="btn btn-primary" onclick="PayRequestPage.saveWriteoff(${id})">${APP_L('确认核销', '確認核銷', 'Confirm')}</button>
        `);
    },

    async saveWriteoff(id) {
        const body = {
            source_uid: Number(document.getElementById('pr_wo_source').value),
            amount: Number(document.getElementById('pr_wo_amount').value),
            writeoff_date: document.getElementById('pr_wo_date').value,
            note: (document.getElementById('pr_wo_note').value || '').trim()
        };
        if (!body.source_uid) return UI.toast(APP_L('请选择核销发票', '請選擇核銷發票', 'Select an invoice'), 'error');
        if (!body.amount || body.amount <= 0) return UI.toast(APP_L('核销金额必须大于 0', '核銷金額必須大於 0', 'Amount must be > 0'), 'error');
        try {
            const res = await API.post(`/api/pay-request/${id}/writeoff`, body);
            UI.toast(res.message || 'OK', 'success');
            UI.closeModal();
            this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async viewWriteoffs(id) {
        try {
            const res = await API.get(`/api/pay-request/${id}/writeoffs`);
            const d = res.data || { rows: [], total: 0 };
            const rows = d.rows || [];
            const admin = Auth.isAdmin();
            UI.modal(APP_L('核销明细', '核銷明細', 'Write-off Details'), `
                ${!rows.length
                    ? `<p style="padding:20px;text-align:center;color:#999;">${APP_L('暂无核销记录', '暫無核銷記錄', 'No write-offs yet')}</p>`
                    : `<table class="data-table"><thead><tr>
                        <th>${APP_L('类型', '類型', 'Type')}</th>
                        <th>${APP_L('发票号', '發票號', 'Invoice#')}</th>
                        <th>${APP_L('往来方', '往來方', 'Counterparty')}</th>
                        <th>${APP_L('核销金额', '核銷金額', 'Amount')}</th>
                        <th>${APP_L('核销日期', '核銷日期', 'Date')}</th>
                        <th>${APP_L('操作人', '操作人', 'Operator')}</th>
                        <th></th>
                    </tr></thead><tbody>
                    ${rows.map(w => `<tr>
                        <td>${prEsc(w.source_type)}</td>
                        <td>${prEsc(w.invoice_no || '-')}</td>
                        <td>${prEsc(w.counterparty || '-')}</td>
                        <td style="text-align:right;">${UI.fmt(w.writeoff_amount)}</td>
                        <td>${prEsc(String(w.writeoff_date || '').slice(0, 10))}</td>
                        <td>${prEsc(w.operator_id || '-')}</td>
                        <td>${admin ? `<button class="btn btn-danger" onclick="PayRequestPage.delWriteoff(${id}, ${w.id})">${APP_L('撤销', '撤銷', 'Undo')}</button>` : ''}</td>
                    </tr>`).join('')}</tbody></table>`}
                <p style="margin-top:12px;text-align:right;">
                    <b>${APP_L('核销合计', '核銷合計', 'Total')}: ${UI.fmt(d.total)}</b>
                </p>
            `, `<button class="btn btn-ghost" onclick="UI.closeModal()">${APP_L('关闭', '關閉', 'Close')}</button>`);
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async delWriteoff(id, wid) {
        if (!confirm(APP_L('确认撤销该笔核销？将同步回退发票已付金额。', '確認撤銷該筆核銷？將同步回退發票已付金額。', 'Undo this write-off? The invoice paid amount will be reverted.'))) return;
        try {
            const res = await API.del(`/api/pay-request/${id}/writeoff/${wid}`);
            UI.toast(res.message || 'OK', 'success');
            UI.closeModal();
            this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};

registerPage('payRequest', () => PayRequestPage.load());
