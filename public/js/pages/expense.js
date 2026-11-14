/**
 * 费用报销页面
 *  - 我的报销 / 待我审批 / 全部报销
 *  - 报销单与明细编辑、提交审批、撤回、付款
 */
const EXPENSE_TYPES_FALLBACK = [
    { code_value: 'TRAVEL', value_description: '差旅费' },
    { code_value: 'TRANSPORT', value_description: '交通费' },
    { code_value: 'ENTERTAIN', value_description: '业务招待费' },
    { code_value: 'OFFICE', value_description: '办公费' },
    { code_value: 'OTHER', value_description: '其他费用' }
];

const EXP_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] || zh);

function expEsc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function expToday() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function expStatusLabel(s) {
    return {
        DRAFT: EXP_L('草稿', '草稿', 'Draft'),
        PENDING: EXP_L('审批中', '審批中', 'Pending'),
        APPROVED: EXP_L('已通过', '已通過', 'Approved'),
        REJECTED: EXP_L('已驳回', '已駁回', 'Rejected'),
        PAID: EXP_L('已付款', '已付款', 'Paid'),
        CANCELLED: EXP_L('已撤回', '已撤回', 'Cancelled')
    }[s] || s;
}

function expStatusBadge(s) {
    const cls = {
        DRAFT: 'bg-info', PENDING: 'bg-warning', APPROVED: 'bg-success',
        REJECTED: 'bg-danger', PAID: 'bg-success', CANCELLED: 'bg-danger'
    }[s] || 'bg-info';
    return `<span class="badge ${cls}">${expStatusLabel(s)}</span>`;
}

function expTypeLabel(code) {
    return {
        TRAVEL: EXP_L('差旅费', '差旅費', 'Travel'),
        TRANSPORT: EXP_L('交通费', '交通費', 'Transport'),
        ENTERTAIN: EXP_L('业务招待费', '業務招待費', 'Entertainment'),
        OFFICE: EXP_L('办公费', '辦公費', 'Office'),
        OTHER: EXP_L('其他费用', '其他費用', 'Other')
    }[code] || code || '-';
}

const ExpensePage = {
    tab: 'mine',
    rows: [],

    renderTabs() {
        const tabs = [
            ['mine', EXP_L('我的报销', '我的報銷', 'My Claims')],
            ['todo', EXP_L('待我审批', '待我審批', 'My Approvals')]
        ];
        if (Auth.isAdmin() || Auth.isManager()) tabs.push(['all', EXP_L('全部报销', '全部報銷', 'All Claims')]);
        const el = document.getElementById('expTabs');
        if (el) el.innerHTML = tabs.map(([k, label]) =>
            `<div class="tab ${this.tab === k ? 'active' : ''}" onclick="ExpensePage.switchTab('${k}')">${label}</div>`
        ).join('');
    },

    switchTab(tab) {
        this.tab = tab;
        this.renderTabs();
        this.load();
    },

    async load() {
        this.renderTabs();
        const el = document.getElementById('expList');
        if (!el) return;
        el.innerHTML = `<div style="padding:20px;color:#7f8c8d;">${t('loading')}</div>`;
        try {
            if (this.tab === 'todo') {
                const res = await API.get('/api/workflow/pending?business_type=EXPENSE');
                this.rows = res.data || [];
                this.renderTodo();
            } else {
                const scope = this.tab === 'all' ? 'all' : 'mine';
                const res = await API.get(`/api/expense?scope=${scope}`);
                this.rows = res.data || [];
                this.renderTable();
            }
            if (typeof refreshApprovalBadge === 'function') refreshApprovalBadge();
        } catch (e) {
            el.innerHTML = `<div style="padding:20px;color:#e74c3c;">${expEsc(e.message)}</div>`;
        }
    },

    renderTable() {
        const el = document.getElementById('expList');
        if (!el) return;
        if (!this.rows.length) {
            el.innerHTML = UI.empty('🧾', EXP_L('暂无报销单', '暫無報銷單', 'No claims'));
            return;
        }
        const me = Auth.getUser()?.user_id;
        const admin = Auth.isAdmin();
        const showApplicant = this.tab === 'all';
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table">
                <thead><tr>
                    <th>${EXP_L('单号', '單號', 'No.')}</th>
                    <th>${EXP_L('事由', '事由', 'Title')}</th>
                    <th>${EXP_L('类型', '類型', 'Type')}</th>
                    ${showApplicant ? `<th>${EXP_L('申请人', '申請人', 'Applicant')}</th>` : ''}
                    <th>${EXP_L('金额', '金額', 'Amount')}</th>
                    <th>${EXP_L('状态', '狀態', 'Status')}</th>
                    <th>${EXP_L('提交时间', '提交時間', 'Submitted')}</th>
                    <th>${EXP_L('操作', '操作', 'Actions')}</th>
                </tr></thead>
                <tbody>
                ${this.rows.map(r => {
                    const owner = String(r.applicant_id) === String(me);
                    const acts = [`<button class="btn btn-ghost" onclick="ExpensePage.detail(${r.id})">${EXP_L('查看', '查看', 'View')}</button>`];
                    if (owner && ['DRAFT', 'REJECTED'].includes(r.status)) {
                        acts.push(`<button class="btn btn-ghost" onclick="ExpensePage.openForm(${r.id})">${EXP_L('编辑', '編輯', 'Edit')}</button>`);
                        acts.push(`<button class="btn btn-primary" onclick="ExpensePage.submit(${r.id})">${EXP_L('提交审批', '提交審批', 'Submit')}</button>`);
                    }
                    if (owner && r.status === 'PENDING') {
                        acts.push(`<button class="btn btn-ghost" onclick="ExpensePage.cancel(${r.id})">${EXP_L('撤回', '撤回', 'Withdraw')}</button>`);
                    }
                    if (admin && r.status === 'APPROVED') {
                        acts.push(`<button class="btn btn-primary" onclick="ExpensePage.pay(${r.id})">${EXP_L('标记付款', '標記付款', 'Mark Paid')}</button>`);
                    }
                    return `<tr>
                        <td style="white-space:nowrap;">${expEsc(r.report_no || ('#' + r.id))}</td>
                        <td>${expEsc(r.title)}</td>
                        <td>${expEsc(expTypeLabel(r.expense_type))}</td>
                        ${showApplicant ? `<td>${expEsc(r.applicant_name || r.applicant_id)}</td>` : ''}
                        <td style="text-align:right;white-space:nowrap;">${UI.fmt(r.total_amount)}</td>
                        <td>${expStatusBadge(r.status)}</td>
                        <td style="white-space:nowrap;">${r.submit_time ? expEsc(String(r.submit_time).substring(0, 16).replace('T', ' ')) : '-'}</td>
                        <td style="white-space:nowrap;">${acts.join(' ')}</td>
                    </tr>`;
                }).join('')}
                </tbody>
            </table></div>`;
    },

    renderTodo() {
        const el = document.getElementById('expList');
        if (!el) return;
        if (!this.rows.length) {
            el.innerHTML = UI.empty('✅', EXP_L('暂无待审批事项', '暫無待審批事項', 'No pending approvals'));
            return;
        }
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table">
                <thead><tr>
                    <th>${EXP_L('单号/事由', '單號/事由', 'Claim')}</th>
                    <th>${EXP_L('申请人', '申請人', 'Applicant')}</th>
                    <th>${EXP_L('金额', '金額', 'Amount')}</th>
                    <th>${EXP_L('当前步骤', '當前步驟', 'Current Step')}</th>
                    <th>${EXP_L('提交时间', '提交時間', 'Submitted')}</th>
                    <th>${EXP_L('操作', '操作', 'Actions')}</th>
                </tr></thead>
                <tbody>
                ${this.rows.map(r => `<tr>
                    <td><b>${expEsc(r.title || '')}</b><br><small style="color:#7f8c8d;">#${r.business_id}</small></td>
                    <td>${expEsc(r.applicant_name || r.applicant_id)}</td>
                    <td style="text-align:right;">${UI.fmt(r.amount)}</td>
                    <td>${expEsc(r.step_name || '')} (${r.step_no}/${r.total_steps})</td>
                    <td style="white-space:nowrap;">${r.submit_time ? expEsc(String(r.submit_time).substring(0, 16).replace('T', ' ')) : '-'}</td>
                    <td><button class="btn btn-primary" onclick="ExpensePage.detail(${r.business_id}, ${r.task_id})">${EXP_L('审批', '審批', 'Review')}</button></td>
                </tr>`).join('')}
                </tbody>
            </table></div>`;
    },

    async detail(id, taskId) {
        try {
            const res = await API.get(`/api/expense/${id}`);
            const r = res.data;
            const me = Auth.getUser()?.user_id;
            const owner = String(r.applicant_id) === String(me);
            const admin = Auth.isAdmin();
            const wf = r.workflow;
            const items = (r.items || []).map(it => `<tr>
                <td>${expEsc(it.expense_date || '-')}</td>
                <td>${expEsc(expTypeLabel(it.category))}</td>
                <td>${expEsc(it.description || '-')}</td>
                <td style="text-align:right;">${UI.fmt(it.amount)}</td>
                <td>${expEsc(it.invoice_no || '-')}</td>
                <td style="text-align:right;">${UI.fmt(it.tax_amount)}</td>
            </tr>`).join('');
            const logs = (wf?.logs || []).map(l => `<div style="display:flex;gap:8px;padding:5px 0;border-bottom:1px dashed #eee;">
                <span style="min-width:120px;color:#7f8c8d;">${expEsc(String(l.create_time || '').substring(0, 16).replace('T', ' '))}</span>
                <span style="min-width:110px;font-weight:600;">${expEsc(l.operator_name || l.operator_id || 'system')}</span>
                <span style="min-width:80px;">${expEsc(this.actionLabel(l.action))}</span>
                <span style="color:#7f8c8d;">${expEsc(l.comment || '')}</span>
            </div>`).join('');

            let footer = `<button class="btn btn-ghost" onclick="UI.closeModal()">${t('cancel')}</button>`;
            if (taskId) {
                footer = `<textarea id="expComment" rows="2" placeholder="${EXP_L('审批意见（可选）', '審批意見（可選）', 'Comment (optional)')}"
                    style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;margin-bottom:10px;"></textarea>
                    <button class="btn btn-danger" onclick="ExpensePage.act(${taskId},'reject')">${EXP_L('驳回', '駁回', 'Reject')}</button>
                    <button class="btn btn-primary" onclick="ExpensePage.act(${taskId},'approve')">${EXP_L('同意', '同意', 'Approve')}</button>`;
            } else {
                if (owner && ['DRAFT', 'REJECTED'].includes(r.status)) {
                    footer += `<button class="btn btn-ghost" onclick="ExpensePage.openForm(${r.id})">${EXP_L('编辑', '編輯', 'Edit')}</button>
                        <button class="btn btn-primary" onclick="ExpensePage.submit(${r.id})">${EXP_L('提交审批', '提交審批', 'Submit')}</button>`;
                }
                if (owner && r.status === 'PENDING' && wf) {
                    footer += `<button class="btn btn-danger" onclick="ExpensePage.withdraw(${wf.id})">${EXP_L('撤回', '撤回', 'Withdraw')}</button>`;
                }
                if (admin && r.status === 'APPROVED') {
                    footer += `<button class="btn btn-primary" onclick="ExpensePage.pay(${r.id})">${EXP_L('标记付款', '標記付款', 'Mark Paid')}</button>`;
                }
            }

            UI.modal(`${expEsc(r.report_no || ('#' + r.id))} ${expStatusBadge(r.status)}`, `
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;font-size:0.9em;margin-bottom:12px;">
                    <div><b>${EXP_L('事由', '事由', 'Title')}：</b>${expEsc(r.title)}</div>
                    <div><b>${EXP_L('申请人', '申請人', 'Applicant')}：</b>${expEsc(r.applicant_name || r.applicant_id)}</div>
                    <div><b>${EXP_L('部门', '部門', 'Dept')}：</b>${expEsc(r.dept || '-')}</div>
                    <div><b>${EXP_L('公司', '公司', 'Company')}：</b>${expEsc(r.bu_no || '-')}</div>
                    <div><b>${EXP_L('类型', '類型', 'Type')}：</b>${expEsc(expTypeLabel(r.expense_type))}</div>
                    <div><b>${EXP_L('金额', '金額', 'Amount')}：</b>${UI.fmt(r.total_amount)}</div>
                    <div><b>${EXP_L('当前步骤', '當前步驟', 'Current Step')}：</b>${wf ? `${wf.current_step}/${wf.total_steps}` : '-'}</div>
                    <div><b>${EXP_L('备注', '備註', 'Remark')}：</b>${expEsc(r.remark || '-')}</div>
                </div>
                <table class="data-table" style="margin-bottom:14px;">
                    <thead><tr>
                        <th>${EXP_L('日期', '日期', 'Date')}</th><th>${EXP_L('类别', '類別', 'Category')}</th>
                        <th>${EXP_L('说明', '說明', 'Description')}</th><th>${EXP_L('金额', '金額', 'Amount')}</th>
                        <th>${EXP_L('发票号', '發票號', 'Invoice')}</th><th>${EXP_L('税额', '稅額', 'Tax')}</th>
                    </tr></thead>
                    <tbody>${items || `<tr><td colspan="6" style="text-align:center;">${t('no_data')}</td></tr>`}</tbody>
                </table>
                ${wf ? `<h4 style="margin:8px 0;">${EXP_L('审批轨迹', '審批軌跡', 'Approval History')}</h4>
                    <div style="max-height:180px;overflow:auto;font-size:0.85em;">${logs || `<span style="color:#7f8c8d;">${t('no_data')}</span>`}</div>` : ''}
            `, footer);
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    actionLabel(a) {
        return {
            SUBMIT: EXP_L('提交', '提交', 'Submitted'),
            APPROVE: EXP_L('通过', '通過', 'Approved'),
            REJECT: EXP_L('驳回', '駁回', 'Rejected'),
            CANCEL: EXP_L('撤回', '撤回', 'Withdrawn'),
            SKIP: EXP_L('跳过', '跳過', 'Skipped'),
            PAY: EXP_L('付款', '付款', 'Paid')
        }[a] || a;
    },

    async act(taskId, action) {
        const comment = document.getElementById('expComment')?.value || '';
        if (action === 'reject' && !comment.trim()) {
            UI.toast(EXP_L('驳回时请填写意见', '駁回時請填寫意見', 'Please provide a reason'), 'error');
            return;
        }
        try {
            await API.post(`/api/workflow/tasks/${taskId}/action`, { action, comment });
            UI.toast(action === 'approve' ? EXP_L('已通过', '已通過', 'Approved') : EXP_L('已驳回', '已駁回', 'Rejected'), 'success');
            UI.closeModal();
            this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async submit(id) {
        if (!confirm(EXP_L('确认提交审批？', '確認提交審批？', 'Submit for approval?'))) return;
        try {
            const res = await API.post(`/api/expense/${id}/submit`);
            UI.toast(res.message || EXP_L('已提交审批', '已提交審批', 'Submitted'), 'success');
            this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async cancel(id) {
        if (!confirm(EXP_L('确认撤回该报销单？', '確認撤回該報銷單？', 'Withdraw this claim?'))) return;
        try {
            const res = await API.get(`/api/expense/${id}`);
            const wf = res.data.workflow;
            if (!wf) throw new Error(EXP_L('找不到审批流程', '找不到審批流程', 'Workflow not found'));
            await API.post(`/api/workflow/instances/${wf.id}/cancel`);
            UI.toast(EXP_L('已撤回', '已撤回', 'Withdrawn'), 'success');
            this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async withdraw(instanceId) {
        if (!confirm(EXP_L('确认撤回该报销单？', '確認撤回該報銷單？', 'Withdraw this claim?'))) return;
        try {
            await API.post(`/api/workflow/instances/${instanceId}/cancel`);
            UI.toast(EXP_L('已撤回', '已撤回', 'Withdrawn'), 'success');
            UI.closeModal();
            this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async pay(id) {
        if (!confirm(EXP_L('确认已付款？', '確認已付款？', 'Mark as paid?'))) return;
        try {
            await API.post(`/api/expense/${id}/pay`);
            UI.toast(EXP_L('已标记付款', '已標記付款', 'Marked as paid'), 'success');
            UI.closeModal();
            this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async openForm(id) {
        let report = null;
        try {
            if (id) {
                const res = await API.get(`/api/expense/${id}`);
                report = res.data;
            }
        } catch (e) { UI.toast(e.message, 'error'); return; }

        const types = await CodeHelper.list('EXPENSE_TYPE', EXPENSE_TYPES_FALLBACK);
        const typeOpts = types.map(o =>
            `<option value="${expEsc(o.code_value)}" ${report && report.expense_type === o.code_value ? 'selected' : ''}>${expEsc(expTypeLabel(o.code_value) !== o.code_value ? expTypeLabel(o.code_value) : o.value_description)}</option>`
        ).join('');
        const buOpts = await CodeHelper.buSel({ selected: report?.bu_no || State.bu_no });
        const rows = (report?.items?.length ? report.items : [null]);
        UI.modal(id ? EXP_L('编辑报销单', '編輯報銷單', 'Edit Claim') : EXP_L('新建报销单', '新增報銷單', 'New Claim'), `
            <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;margin-bottom:12px;">
                <div><label>${EXP_L('报销事由', '報銷事由', 'Title')} *</label>
                    <input id="expTitle" value="${expEsc(report?.title || '')}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;"></div>
                <div><label>${EXP_L('费用类型', '費用類型', 'Type')}</label>
                    <select id="expType" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;">${typeOpts}</select></div>
                <div><label>${EXP_L('公司', '公司', 'Company')}</label>
                    <select id="expBU" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;">${buOpts}</select></div>
            </div>
            <div style="margin-bottom:10px;"><label>${EXP_L('备注', '備註', 'Remark')}</label>
                <input id="expRemark" value="${expEsc(report?.remark || '')}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;"></div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin:10px 0;">
                <b>${EXP_L('费用明细', '費用明細', 'Expense Items')}</b>
                <button class="btn btn-ghost" onclick="ExpensePage.addRow()">＋ ${EXP_L('新增明细', '新增明細', 'Add Item')}</button>
            </div>
            <div id="expItems" style="overflow-x:auto;"></div>
            <div style="text-align:right;margin-top:10px;font-size:1.05em;">
                ${EXP_L('合计', '合計', 'Total')}：<b id="expTotal">0.00</b>
            </div>
        `, `<button class="btn btn-ghost" onclick="UI.closeModal()">${t('cancel')}</button>
            <button class="btn btn-ghost" onclick="ExpensePage.save(${id || 0}, false)">${EXP_L('保存草稿', '儲存草稿', 'Save Draft')}</button>
            <button class="btn btn-primary" onclick="ExpensePage.save(${id || 0}, true)">${EXP_L('保存并提交', '儲存並提交', 'Save & Submit')}</button>`);

        rows.forEach(it => this.addRow(it, typeOpts));
    },

    addRow(item, typeOpts) {
        const box = document.getElementById('expItems');
        if (!box) return;
        if (!typeOpts) {
            typeOpts = [...box.querySelectorAll('.ei-cat')][0]?.innerHTML || '';
        }
        const div = document.createElement('div');
        div.className = 'exp-item-row';
        div.style.cssText = 'display:grid;grid-template-columns:120px 120px 1fr 100px 120px 90px 34px;gap:6px;margin-bottom:6px;align-items:center;';
        div.innerHTML = `
            <input type="date" class="ei-date" value="${expEsc(item?.expense_date ? String(item.expense_date).substring(0, 10) : expToday())}" style="padding:6px;border:1px solid #ddd;border-radius:5px;">
            <select class="ei-cat" style="padding:6px;border:1px solid #ddd;border-radius:5px;">${typeOpts}</select>
            <input class="ei-desc" placeholder="${EXP_L('说明', '說明', 'Description')}" value="${expEsc(item?.description || '')}" style="padding:6px;border:1px solid #ddd;border-radius:5px;">
            <input type="number" step="0.01" min="0" class="ei-amount" placeholder="0.00" value="${item?.amount != null ? item.amount : ''}" oninput="ExpensePage.calcTotal()" style="padding:6px;border:1px solid #ddd;border-radius:5px;text-align:right;">
            <input class="ei-invoice" placeholder="${EXP_L('发票号', '發票號', 'Invoice')}" value="${expEsc(item?.invoice_no || '')}" style="padding:6px;border:1px solid #ddd;border-radius:5px;">
            <input type="number" step="0.01" min="0" class="ei-tax" placeholder="${EXP_L('税额', '稅額', 'Tax')}" value="${item?.tax_amount != null ? item.tax_amount : ''}" style="padding:6px;border:1px solid #ddd;border-radius:5px;text-align:right;">
            <button class="btn btn-ghost" onclick="this.parentElement.remove();ExpensePage.calcTotal();" style="padding:2px 6px;">✕</button>`;
        box.appendChild(div);
        if (item?.category) div.querySelector('.ei-cat').value = item.category;
        this.calcTotal();
    },

    calcTotal() {
        const total = [...document.querySelectorAll('#expItems .ei-amount')]
            .reduce((s, el) => s + (Number(el.value) || 0), 0);
        const el = document.getElementById('expTotal');
        if (el) el.textContent = total.toFixed(2);
    },

    async save(id, submit) {
        const title = document.getElementById('expTitle')?.value.trim();
        if (!title) { UI.toast(EXP_L('请填写报销事由', '請填寫報銷事由', 'Title is required'), 'error'); return; }
        const items = [...document.querySelectorAll('#expItems .exp-item-row')].map(row => ({
            expense_date: row.querySelector('.ei-date').value || null,
            category: row.querySelector('.ei-cat').value || null,
            description: row.querySelector('.ei-desc').value || null,
            amount: Number(row.querySelector('.ei-amount').value) || 0,
            invoice_no: row.querySelector('.ei-invoice').value || null,
            tax_amount: Number(row.querySelector('.ei-tax').value) || 0
        })).filter(it => it.amount > 0 || it.description);
        if (!items.length || !items.some(it => it.amount > 0)) {
            UI.toast(EXP_L('请至少填写一条有效明细', '請至少填寫一條有效明細', 'Please add at least one valid item'), 'error');
            return;
        }
        const body = {
            title,
            expense_type: document.getElementById('expType')?.value,
            bu_no: document.getElementById('expBU')?.value,
            remark: document.getElementById('expRemark')?.value,
            items
        };
        try {
            let reportId = id;
            if (id) {
                await API.put(`/api/expense/${id}`, body);
            } else {
                const res = await API.post('/api/expense', body);
                reportId = res.data.id;
            }
            if (submit) {
                await API.post(`/api/expense/${reportId}/submit`);
                UI.toast(EXP_L('已提交审批', '已提交審批', 'Submitted'), 'success');
            } else {
                UI.toast(EXP_L('草稿已保存', '草稿已儲存', 'Draft saved'), 'success');
            }
            UI.closeModal();
            this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};

registerPage('expense', async (c) => {
    c.innerHTML = `
        <div class="toolbar">
            <h2 style="margin:0;font-size:20px;">${EXP_L('费用报销', '費用報銷', 'Expense Claims')}
                <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">${EXP_L('申请、审批与付款闭环', '申請、審批與付款閉環', 'Request, approve and pay')}</small>
            </h2>
            <div class="spacer"></div>
            <button class="btn btn-primary" onclick="ExpensePage.openForm()">＋ ${EXP_L('新建报销', '新增報銷', 'New Claim')}</button>
            <button class="btn btn-ghost" onclick="ExpensePage.load()">${t('refresh')}</button>
        </div>
        <div class="tabs" id="expTabs"></div>
        <div id="expList"></div>`;
    ExpensePage.renderTabs();
    await ExpensePage.load();
});
