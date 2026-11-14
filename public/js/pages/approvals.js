/**
 * 审批中心
 *  - 待我审批（跨业务类型）
 *  - 流程设定（管理员）
 */
const APP_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] || zh);

function appEsc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const ApprovalPage = {
    tab: 'todo',
    pending: [],
    mine: [],
    processes: [],

    renderTabs() {
        const tabs = [
            ['todo', APP_L('待我审批', '待我審批', 'My Approvals')],
            ['mine', APP_L('我提交的', '我提交的', 'Submitted by Me')]
        ];
        if (Auth.isAdmin()) tabs.push(['process', APP_L('流程设定', '流程設定', 'Workflow Settings')]);
        const el = document.getElementById('appTabs');
        if (el) el.innerHTML = tabs.map(([k, label]) =>
            `<div class="tab ${this.tab === k ? 'active' : ''}" onclick="ApprovalPage.switchTab('${k}')">${label}</div>`
        ).join('');
    },

    switchTab(tab) {
        this.tab = tab;
        this.renderTabs();
        this.load();
    },

    async load() {
        this.renderTabs();
        const el = document.getElementById('appBody');
        if (!el) return;
        el.innerHTML = `<div style="padding:20px;color:#7f8c8d;">${t('loading')}</div>`;
        try {
            if (this.tab === 'process') {
                const res = await API.get('/api/workflow/processes');
                this.processes = res.data || [];
                this.renderProcesses();
            } else if (this.tab === 'mine') {
                const res = await API.get('/api/workflow/mine');
                this.mine = res.data || [];
                this.renderMine();
            } else {
                const res = await API.get('/api/workflow/pending');
                this.pending = res.data || [];
                this.renderPending();
            }
            if (typeof refreshApprovalBadge === 'function') refreshApprovalBadge();
        } catch (e) {
            el.innerHTML = `<div style="padding:20px;color:#e74c3c;">${appEsc(e.message)}</div>`;
        }
    },

    renderPending() {
        const el = document.getElementById('appBody');
        if (!el) return;
        if (!this.pending.length) {
            el.innerHTML = UI.empty('✅', APP_L('暂无待审批事项', '暫無待審批事項', 'No pending approvals'));
            return;
        }
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table">
                <thead><tr>
                    <th>${APP_L('类型', '類型', 'Type')}</th>
                    <th>${APP_L('事由', '事由', 'Title')}</th>
                    <th>${APP_L('申请人', '申請人', 'Applicant')}</th>
                    <th>${APP_L('金额', '金額', 'Amount')}</th>
                    <th>${APP_L('当前步骤', '當前步驟', 'Current Step')}</th>
                    <th>${APP_L('提交时间', '提交時間', 'Submitted')}</th>
                    <th>${APP_L('操作', '操作', 'Actions')}</th>
                </tr></thead>
                <tbody>
                ${this.pending.map(r => `<tr>
                    <td>${appEsc(this.typeLabel(r.business_type))}</td>
                    <td><b>${appEsc(r.title || '')}</b><br><small style="color:#7f8c8d;">#${r.business_id}</small></td>
                    <td>${appEsc(r.applicant_name || r.applicant_id)}</td>
                    <td style="text-align:right;">${UI.fmt(r.amount)}</td>
                    <td>${appEsc(r.step_name || '')} (${r.step_no}/${r.total_steps})</td>
                    <td style="white-space:nowrap;">${r.task_time ? appEsc(String(r.task_time).substring(0, 16).replace('T', ' ')) : '-'}</td>
                    <td><button class="btn btn-primary" onclick="ApprovalPage.openTask(${r.task_id}, ${r.instance_id}, '${appEsc(r.business_type)}', ${r.business_id})">${APP_L('审批', '審批', 'Review')}</button></td>
                </tr>`).join('')}
                </tbody>
            </table></div>`;
    },

    renderMine() {
        const el = document.getElementById('appBody');
        if (!el) return;
        if (!this.mine.length) {
            el.innerHTML = UI.empty('📄', APP_L('尚未提交任何单据', '尚未提交任何單據', 'No submissions yet'));
            return;
        }
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table">
                <thead><tr>
                    <th>${APP_L('类型', '類型', 'Type')}</th>
                    <th>${APP_L('事由', '事由', 'Title')}</th>
                    <th>${APP_L('金额', '金額', 'Amount')}</th>
                    <th>${APP_L('状态', '狀態', 'Status')}</th>
                    <th>${APP_L('当前步骤', '當前步驟', 'Current Step')}</th>
                    <th>${APP_L('当前审批人', '當前審批人', 'Current Approver')}</th>
                    <th>${APP_L('提交时间', '提交時間', 'Submitted')}</th>
                    <th>${APP_L('操作', '操作', 'Actions')}</th>
                </tr></thead>
                <tbody>
                ${this.mine.map(r => `<tr>
                    <td>${appEsc(this.typeLabel(r.business_type))}</td>
                    <td><b>${appEsc(r.title || '')}</b><br><small style="color:#7f8c8d;">#${r.business_id}</small></td>
                    <td style="text-align:right;">${UI.fmt(r.amount)}</td>
                    <td>${this.statusBadge(r)}</td>
                    <td>${r.status === 'PENDING' ? `${r.current_step}/${r.total_steps}` : '-'}</td>
                    <td>${appEsc(r.current_approvers || '-')}</td>
                    <td style="white-space:nowrap;">${appEsc(String(r.create_time || '').substring(0, 16).replace('T', ' '))}</td>
                    <td><button class="btn btn-ghost" onclick="ApprovalPage.openInstance(${r.id}, '${appEsc(r.business_type)}', ${r.business_id})">${APP_L('查看', '查看', 'View')}</button></td>
                </tr>`).join('')}
                </tbody>
            </table></div>`;
    },

    wfStatus(r) {
        return (r.business_type === 'EXPENSE' && r.business_status) ? r.business_status : r.status;
    },

    statusLabel(s) {
        return {
            DRAFT: APP_L('草稿', '草稿', 'Draft'),
            PENDING: APP_L('审批中', '審批中', 'Pending'),
            APPROVED: APP_L('已通过', '已通過', 'Approved'),
            REJECTED: APP_L('已驳回', '已駁回', 'Rejected'),
            CANCELLED: APP_L('已撤回', '已撤回', 'Withdrawn'),
            PAID: APP_L('已付款', '已付款', 'Paid')
        }[s] || s;
    },

    statusBadge(r) {
        const s = this.wfStatus(r);
        const cls = { PENDING: 'bg-warning', APPROVED: 'bg-success', PAID: 'bg-info', REJECTED: 'bg-danger', CANCELLED: 'bg-danger' }[s] || '';
        return `<span class="badge ${cls}">${this.statusLabel(s)}</span>`;
    },

    async openInstance(instanceId, businessType, businessId) {
        if (businessType === 'EXPENSE' && typeof ExpensePage !== 'undefined') {
            return ExpensePage.detail(businessId);
        }
        try {
            const res = await API.get(`/api/workflow/instances/${instanceId}`);
            const wf = res.data;
            const logs = (wf.logs || []).map(l =>
                `<div style="padding:4px 0;border-bottom:1px dashed #eee;">${appEsc(String(l.create_time || '').substring(0, 16).replace('T', ' '))}　${appEsc(l.operator_name || l.operator_id || 'system')}　${appEsc(l.action)}　${appEsc(l.comment || '')}</div>`
            ).join('');
            UI.modal(APP_L('审批详情', '審批詳情', 'Approval Detail'), `
                <p><b>${APP_L('事由', '事由', 'Title')}：</b>${appEsc(wf.title || '')}</p>
                <p><b>${APP_L('申请人', '申請人', 'Applicant')}：</b>${appEsc(wf.applicant_id)}　
                   <b>${APP_L('金额', '金額', 'Amount')}：</b>${UI.fmt(wf.amount)}</p>
                <div style="margin-top:10px;">${logs || t('no_data')}</div>
            `, `<button class="btn btn-ghost" onclick="UI.closeModal()">${t('cancel')}</button>`);
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    typeLabel(t) {
        return {
            EXPENSE: APP_L('费用报销', '費用報銷', 'Expense')
        }[t] || t;
    },

    async openTask(taskId, instanceId, businessType, businessId) {
        // 费用报销复用报销详情，直接显示明细与审批按钮
        if (businessType === 'EXPENSE' && typeof ExpensePage !== 'undefined') {
            return ExpensePage.detail(businessId, taskId);
        }
        try {
            const res = await API.get(`/api/workflow/instances/${instanceId}`);
            const wf = res.data;
            const logs = (wf.logs || []).map(l =>
                `<div style="padding:4px 0;border-bottom:1px dashed #eee;">${appEsc(String(l.create_time || '').substring(0, 16).replace('T', ' '))}　${appEsc(l.operator_name || l.operator_id || 'system')}　${appEsc(l.action)}　${appEsc(l.comment || '')}</div>`
            ).join('');
            UI.modal(APP_L('审批详情', '審批詳情', 'Approval Detail'), `
                <p><b>${APP_L('事由', '事由', 'Title')}：</b>${appEsc(wf.title || '')}</p>
                <p><b>${APP_L('申请人', '申請人', 'Applicant')}：</b>${appEsc(wf.applicant_id)}　
                   <b>${APP_L('金额', '金額', 'Amount')}：</b>${UI.fmt(wf.amount)}</p>
                <div style="margin-top:10px;">${logs || t('no_data')}</div>
            `, `<textarea id="appComment" rows="2" placeholder="${APP_L('审批意见（可选）', '審批意見（可選）', 'Comment (optional)')}"
                    style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;margin-bottom:10px;"></textarea>
                <button class="btn btn-danger" onclick="ApprovalPage.act(${taskId},'reject')">${APP_L('驳回', '駁回', 'Reject')}</button>
                <button class="btn btn-primary" onclick="ApprovalPage.act(${taskId},'approve')">${APP_L('同意', '同意', 'Approve')}</button>`);
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async act(taskId, action) {
        const comment = document.getElementById('appComment')?.value || '';
        if (action === 'reject' && !comment.trim()) {
            UI.toast(APP_L('驳回时请填写意见', '駁回時請填寫意見', 'Please provide a reason'), 'error');
            return;
        }
        try {
            await API.post(`/api/workflow/tasks/${taskId}/action`, { action, comment });
            UI.toast(action === 'approve' ? APP_L('已通过', '已通過', 'Approved') : APP_L('已驳回', '已駁回', 'Rejected'), 'success');
            UI.closeModal();
            if (typeof refreshApprovalBadge === 'function') refreshApprovalBadge();
            this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    renderProcesses() {
        const el = document.getElementById('appBody');
        if (!el) return;
        if (!this.processes.length) {
            el.innerHTML = UI.empty('⚙️', APP_L('尚未配置审批流程', '尚未配置審批流程', 'No workflows configured'));
            return;
        }
        el.innerHTML = `
            <table class="data-table">
                <thead><tr>
                    <th>${APP_L('流程名称', '流程名稱', 'Name')}</th>
                    <th>${APP_L('业务类型', '業務類型', 'Business')}</th>
                    <th>${APP_L('步骤', '步驟', 'Steps')}</th>
                    <th>${APP_L('状态', '狀態', 'Status')}</th>
                    <th>${APP_L('操作', '操作', 'Actions')}</th>
                </tr></thead>
                <tbody>
                ${this.processes.map(p => {
                    const steps = this.parseSteps(p.steps_json);
                    return `<tr>
                        <td>${appEsc(p.proc_name)}<br><small style="color:#7f8c8d;">${appEsc(p.proc_code)}</small></td>
                        <td>${appEsc(this.typeLabel(p.business_type))}</td>
                        <td>${steps.map((s, i) => `${i + 1}. ${appEsc(s.step_name)}（${appEsc(this.approverLabel(s.approver_type))}）`).join('<br>')}</td>
                        <td>${p.enabled ? `<span class="badge bg-success">${APP_L('启用', '啟用', 'Enabled')}</span>` : `<span class="badge bg-danger">${APP_L('停用', '停用', 'Disabled')}</span>`}</td>
                        <td><button class="btn btn-ghost" onclick="ApprovalPage.editProcess(${p.id})">${APP_L('编辑', '編輯', 'Edit')}</button></td>
                    </tr>`;
                }).join('')}
                </tbody>
            </table>`;
    },

    parseSteps(v) {
        try { return typeof v === 'string' ? JSON.parse(v) : (v || []); }
        catch (e) { return []; }
    },

    approverLabel(t) {
        return {
            dept_manager: APP_L('部门主管', '部門主管', 'Dept Manager'),
            admin: APP_L('管理员/财务', '管理員/財務', 'Admin/Finance'),
            user: APP_L('指定人员', '指定人員', 'Specific User')
        }[t] || t;
    },

    editProcess(id) {
        const p = this.processes.find(x => Number(x.id) === Number(id));
        if (!p) return;
        const steps = this.parseSteps(p.steps_json);
        UI.modal(APP_L('编辑审批流程', '編輯審批流程', 'Edit Workflow'), `
            <div style="margin-bottom:10px;"><label>${APP_L('流程名称', '流程名稱', 'Name')}</label>
                <input id="wfName" value="${appEsc(p.proc_name)}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;"></div>
            <div style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
                <b>${APP_L('审批步骤', '審批步驟', 'Steps')}</b>
                <label style="font-size:0.85em;"><input type="checkbox" id="wfEnabled" ${p.enabled ? 'checked' : ''}> ${APP_L('启用', '啟用', 'Enabled')}</label>
            </div>
            <div id="wfSteps"></div>
            <button class="btn btn-ghost" style="margin-top:8px;" onclick="ApprovalPage.addStep()">＋ ${APP_L('新增步骤', '新增步驟', 'Add Step')}</button>
        `, `<button class="btn btn-ghost" onclick="UI.closeModal()">${t('cancel')}</button>
            <button class="btn btn-primary" onclick="ApprovalPage.saveProcess(${p.id})">${t('save')}</button>`);
        const box = document.getElementById('wfSteps');
        steps.forEach(s => this.addStep(s));
        if (!steps.length) this.addStep();
    },

    addStep(step) {
        const box = document.getElementById('wfSteps');
        if (!box) return;
        const div = document.createElement('div');
        div.className = 'wf-step-row';
        div.style.cssText = 'display:grid;grid-template-columns:1fr 140px 150px 34px;gap:6px;margin-bottom:6px;';
        div.innerHTML = `
            <input class="wf-step-name" placeholder="${APP_L('步骤名称', '步驟名稱', 'Step name')}" value="${appEsc(step?.step_name || '')}" style="padding:6px;border:1px solid #ddd;border-radius:5px;">
            <select class="wf-step-type" onchange="ApprovalPage.toggleValue(this)" style="padding:6px;border:1px solid #ddd;border-radius:5px;">
                <option value="dept_manager">${APP_L('部门主管', '部門主管', 'Dept Manager')}</option>
                <option value="admin">${APP_L('管理员/财务', '管理員/財務', 'Admin/Finance')}</option>
                <option value="user">${APP_L('指定人员', '指定人員', 'Specific User')}</option>
            </select>
            <input class="wf-step-value" placeholder="${APP_L('账号', '帳號', 'User ID')}" value="${appEsc(step?.approver_value || '')}" style="padding:6px;border:1px solid #ddd;border-radius:5px;">
            <button class="btn btn-ghost" onclick="this.parentElement.remove()" style="padding:2px 6px;">✕</button>`;
        box.appendChild(div);
        div.querySelector('.wf-step-type').value = step?.approver_type || 'admin';
        this.toggleValue(div.querySelector('.wf-step-type'));
    },

    toggleValue(sel) {
        const row = sel.closest('.wf-step-row');
        const val = row?.querySelector('.wf-step-value');
        if (val) val.style.display = sel.value === 'user' ? '' : 'none';
    },

    async saveProcess(id) {
        const name = document.getElementById('wfName')?.value.trim();
        if (!name) { UI.toast(APP_L('请填写流程名称', '請填寫流程名稱', 'Name is required'), 'error'); return; }
        const steps = [...document.querySelectorAll('.wf-step-row')].map((row, i) => ({
            step_no: i + 1,
            step_name: row.querySelector('.wf-step-name').value.trim(),
            approver_type: row.querySelector('.wf-step-type').value,
            approver_value: row.querySelector('.wf-step-value').value.trim() || null
        }));
        if (!steps.length) { UI.toast(APP_L('至少需要一个步骤', '至少需要一個步驟', 'At least one step'), 'error'); return; }
        try {
            await API.put(`/api/workflow/processes/${id}`, {
                proc_name: name,
                steps,
                enabled: document.getElementById('wfEnabled')?.checked
            });
            UI.toast(t('saved'), 'success');
            UI.closeModal();
            this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};

registerPage('approvals', async (c) => {
    c.innerHTML = `
        <div class="toolbar">
            <h2 style="margin:0;font-size:20px;">${APP_L('审批中心', '審批中心', 'Approval Center')}
                <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">${APP_L('跨模块待办与流程设定', '跨模組待辦與流程設定', 'Cross-module inbox and workflow settings')}</small>
            </h2>
            <div class="spacer"></div>
            <button class="btn btn-ghost" onclick="ApprovalPage.load()">${t('refresh')}</button>
        </div>
        <div class="tabs" id="appTabs"></div>
        <div id="appBody"></div>`;
    ApprovalPage.renderTabs();
    await ApprovalPage.load();
});
