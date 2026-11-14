﻿﻿﻿﻿/**
 * 采购申请页面
 */
const PrRequestPage = {
    tab: 'mine',  // mine | todo | all
    rows: [],
    suppliers: [],

    async load() {
        const el = document.getElementById('pageContent');
        if (!el) return;
        if (!Auth.isLoggedIn()) { Auth.showLogin(); return; }
        if (!this.suppliers.length) {
            try { this.suppliers = (await API.get('/api/pr-request/suppliers')).data || []; }
            catch(e) {}
        }
        this.renderTabs();
        try {
            if (this.tab === 'todo' && typeof ApprovalPage !== 'undefined') {
                ApprovalPage.tab = 'todo';
                return ApprovalPage.load();
            }
            const scope = this.tab === 'all' ? 'all' : 'mine';
            const res = await API.get(`/api/pr-request?scope=${scope}`);
            this.rows = res.data || [];
            this.renderTable();
        } catch (e) {
            el.innerHTML = `<div style="padding:20px;color:#e74c3c;">${e.message}</div>`;
        }
    },

    renderTabs() {
        const mine = APP_L('我的采购申请', '我的採購申請', 'My PRs');
        const todo = APP_L('待我审批', '待我審批', 'My Approvals');
        const all  = APP_L('全部单据', '全部單據', 'All');
        const tabs = [
            {k:'mine', label:mine},
            {k:'todo', label:todo},
        ];
        if (Auth.isAdmin() || Auth.isManager()) tabs.push({k:'all', label:all});

        document.getElementById('pageTitle').textContent = APP_L('采购申请', '採購申請', 'Purchase Request');
        document.getElementById('pageContent').innerHTML = `
            <div class="page-header">
                <div class="tabs">
                    ${tabs.map(t => `<div class="tab-item ${this.tab===t.k?'active':''}" onclick="PrRequestPage.switchTab('${t.k}')">${t.label}</div>`).join('')}
                </div>
                <div class="page-actions">
                    <button class="btn btn-primary" onclick="PrRequestPage.openForm()">
                        + ${APP_L('新建采购申请', '新建採購申請', 'New PR')}
                    </button>
                </div>
            </div>
            <div id="prBody"></div>
        `;
        const tabsEl = document.querySelector('#pageContent .tabs');
        if (tabsEl && typeof bindTabs === 'function') bindTabs(tabsEl);
    },

    switchTab(t) { this.tab = t; this.load(); },

    renderTable() {
        const el = document.getElementById('prBody');
        if (!el) return;
        if (!this.rows.length) {
            el.innerHTML = `<div style="padding:30px;text-align:center;color:#999;">${APP_L('暂无采购申请', '暫無採購申請', 'No purchase requests')}</div>`;
            return;
        }
        const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table">
                <thead><tr>
                    <th>${APP_L('单号', '單號', 'PR No.')}</th>
                    <th>${APP_L('供应商', '供應商', 'Supplier')}</th>
                    <th>${APP_L('类型', '類型', 'Type')}</th>
                    <th style="text-align:right;">${APP_L('金额', '金額', 'Amount')}</th>
                    <th>${APP_L('状态', '狀態', 'Status')}</th>
                    <th>${APP_L('审批中', '審批中', 'Waiting')}</th>
                    <th>${APP_L('需求日', '需求日', 'Need By')}</th>
                    <th>${APP_L('操作', '操作', 'Actions')}</th>
                </tr></thead>
                <tbody>
                ${this.rows.map(r => `
                <tr>
                    <td><b>${esc(r.pr_no)}</b></td>
                    <td>${esc(r.supplier_name)}</td>
                    <td>${this.typeLabel(r.pr_type)}</td>
                    <td style="text-align:right;">${UI.fmt(r.total_amount)}</td>
                    <td>${this.statusBadge(r.status)}</td>
                    <td>${(r.waiting_for&&r.waiting_for.length)?r.waiting_for.join('、'):'-'}</td>
                    <td>${esc(String(r.need_by_date||'').slice(0,10))}</td>
                    <td>
                        <button class="btn btn-ghost" onclick="PrRequestPage.detail(${r.id})">${t('view')||'查看'}</button>
                        ${(r.status==='DRAFT'||r.status==='REJECTED')&&r.applicant_id===Auth.getUser().user_id?`<button class="btn btn-ghost" onclick="PrRequestPage.openForm(${r.id})">${APP_L('编辑','編輯','Edit')}</button>`:''}
                        ${r.status==='DRAFT'&&r.applicant_id===Auth.getUser().user_id?`<button class="btn btn-danger" onclick="PrRequestPage.del(${r.id})">${APP_L('删除','刪除','Del')}</button>`:''}
                        ${r.status==='DRAFT'&&r.applicant_id===Auth.getUser().user_id?`<button class="btn btn-primary" onclick="PrRequestPage.submit(${r.id})">${APP_L('提交','提交','Submit')}</button>`:''}
                        ${r.status==='APPROVED'&&!r.po_uid?`<button class="btn btn-primary" onclick="PrRequestPage.genPO(${r.id})">${APP_L('生成 PO','生成 PO','Gen PO')}</button>`:''}
                        ${r.status==='PENDING'&&r.applicant_id===Auth.getUser().user_id?`<button class="btn btn-ghost" onclick="PrRequestPage.cancel(${r.id})">${APP_L('撤回','撤回','Cancel')}</button>`:''}
                    </td>
                </tr>`).join('')}
                </tbody>
            </table></div>
        `;
    },

    typeLabel(t) {
        return ({ MATERIAL:APP_L('物料','物料','Material'), SERVICE:APP_L('服務','服務','Service'), ASSET:APP_L('資產','資產','Asset'), OTHER:APP_L('其他','其他','Other') })[t] || t;
    },
    statusLabel(s) {
        return ({ DRAFT:APP_L('草稿','草稿','Draft'), PENDING:APP_L('審批中','審批中','Pending'), APPROVED:APP_L('已通過','已通過','Approved'), PO_CREATED:APP_L('已建 PO','已建 PO','PO Created'), REJECTED:APP_L('已駁回','已駁回','Rejected'), CANCELLED:APP_L('已撤回','已撤回','Cancelled') })[s] || s;
    },
    statusBadge(s) {
        const cls = { PENDING:'bg-warning', APPROVED:'bg-success', PO_CREATED:'bg-info', REJECTED:'bg-danger', CANCELLED:'bg-danger' }[s] || '';
        return `<span class="badge ${cls}">${this.statusLabel(s)}</span>`;
    },

    async openForm(id) {
        const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
        let d = null;
        if (id) {
            try { d = (await API.get(`/api/pr-request/${id}`)).data; }
            catch(e) { return UI.toast(e.message, 'error'); }
        }
        const form = d || { bu_no:'HM', pr_type:'MATERIAL', currency:'TWD', items:[{}] };
        const types = ['MATERIAL','SERVICE','ASSET','OTHER'];
        const typeSel = types.map(v => `<option value="${v}" ${form.pr_type===v?'selected':''}>${this.typeLabel(v)}</option>`).join('');
        const supSel = `<option value="">${APP_L('请选择供应商','請選擇供應商','Select Supplier')}</option>` +
            this.suppliers.map(s => `<option value="${s.relation_id}" data-name="${esc(s.relation_name)}" ${form.supplier_id===s.relation_id?'selected':''}>${esc(s.relation_id)} - ${esc(s.relation_name)}</option>`).join('');

        const rows = (form.items || [{}]).map((it,i) => `
            <tr>
                <td>${i+1}</td>
                <td><input class="form-input" style="width:120px;" placeholder="料件号" value="${esc(it.xitems||'')}" data-k="xitems"></td>
                <td><input class="form-input" style="min-width:180px;" placeholder="${APP_L('品名/规格','品名/規格','Item/Spec')}" value="${esc(it.item_name||'')}" data-k="item_name"></td>
                <td><input type="number" step="0.0001" class="form-input" style="width:100px;text-align:right;" value="${it.qty||''}" data-k="qty"></td>
                <td><input class="form-input" style="width:60px;" value="${esc(it.unit||'')}" data-k="unit"></td>
                <td><input type="number" step="0.01" class="form-input" style="width:110px;text-align:right;" value="${it.unit_price||''}" data-k="unit_price"></td>
                <td><button class="btn btn-ghost" onclick="this.closest('tr').remove();PrRequestPage.recalc()">✕</button></td>
            </tr>`).join('');

        UI.modal(
            (id ? APP_L('编辑采购申请','編輯採購申請','Edit PR') : APP_L('新建采购申请','新建採購申請','New PR')),
            `
            <div class="form-grid">
                <div><label>${APP_L('供应商','供應商','Supplier')}</label><select id="f_sup" class="form-input" onchange="PrRequestPage.onSupChange()">${supSel}</select></div>
                <div><label>${APP_L('类型','類型','Type')}</label><select id="f_type" class="form-input">${typeSel}</select></div>
                <div><label>${t('topbar.bu')||APP_L('公司','公司','BU')}</label><select id="f_bu" class="form-input">${['HM','HN','SZ'].map(v=>`<option ${form.bu_no===v?'selected':''}>${v}</option>`).join('')}</select></div>
                <div><label>${APP_L('需求日期','需求日期','Need By')}</label><input id="f_need" type="date" class="form-input" value="${esc(form.need_by_date||'')}"></div>
                <div class="col-2"><label>${APP_L('用途说明','用途說明','Purpose')}</label><input id="f_purpose" class="form-input" value="${esc(form.purpose||'')}" placeholder="${APP_L('请说明采购用途','請說明採購用途','Purpose')}"></div>
            </div>

            <h4 style="margin-top:18px;">${APP_L('采购明细','採購明細','PR Items')}
                <button class="btn btn-ghost" onclick="PrRequestPage.addRow()" style="margin-left:8px;">+ ${APP_L('新增','新增','Add')}</button>
                <span id="prTotal" style="float:right;color:#e74c3c;font-weight:700;">${UI.fmt(form.total_amount||0)}</span>
            </h4>
            <div style="overflow-x:auto;">
            <table class="data-table">
                <thead><tr>
                    <th>#</th><th>料件號</th><th>${APP_L('品名/规格','品名/規格','Item')}</th>
                    <th>${APP_L('数量','數量','Qty')}</th><th>${APP_L('单位','單位','Unit')}</th>
                    <th>${APP_L('单价','單價','Price')}</th><th></th>
                </tr></thead><tbody id="prRows">${rows}</tbody>
            </table></div>
            `,
            `<button class="btn btn-ghost" onclick="UI.closeModal()">${APP_L('取消','取消','Cancel')}</button>
             <button class="btn btn-primary" onclick="PrRequestPage.save(${id||0})">${APP_L('保存','保存','Save')}</button>`
        );
        document.querySelectorAll('#prRows input[data-k="unit_price"], #prRows input[data-k="qty"]').forEach(inp => inp.addEventListener('input', () => PrRequestPage.recalc()));
        PrRequestPage.recalc();
    },

    onSupChange() {
        const sel = document.getElementById('f_sup');
        const name = sel.selectedOptions[0].dataset.name || '';
        // save selected supplier name somewhere for use in save()
        this._supName = name;
    },

    addRow() {
        const tbody = document.getElementById('prRows');
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${tbody.rows.length + 1}</td>
            <td><input class="form-input" style="width:120px;" data-k="xitems"></td>
            <td><input class="form-input" style="min-width:180px;" data-k="item_name"></td>
            <td><input type="number" step="0.0001" class="form-input" style="width:100px;text-align:right;" data-k="qty"></td>
            <td><input class="form-input" style="width:60px;" data-k="unit"></td>
            <td><input type="number" step="0.01" class="form-input" style="width:110px;text-align:right;" data-k="unit_price"></td>
            <td><button class="btn btn-ghost" onclick="this.closest('tr').remove();PrRequestPage.recalc()">✕</button></td>
        `;
        tbody.appendChild(tr);
        tr.querySelectorAll('input[data-k]').forEach(inp => inp.addEventListener('input', () => PrRequestPage.recalc()));
    },

    recalc() {
        const rows = document.querySelectorAll('#prRows tr');
        let total = 0;
        rows.forEach(tr => {
            const qty = Number(tr.querySelector('[data-k="qty"]').value) || 0;
            const up = Number(tr.querySelector('[data-k="unit_price"]').value) || 0;
            total += qty * up;
        });
        const el = document.getElementById('prTotal');
        if (el) el.textContent = UI.fmt(total);
    },

    async save(id) {
        const f = (sel) => document.querySelector(sel).value;
        const supSel = document.getElementById('f_sup');
        const supName = supSel.selectedOptions[0].dataset.name || this._supName || '';
        const rows = document.querySelectorAll('#prRows tr');
        const items = [];
        for (const tr of rows) {
            const it = {};
            tr.querySelectorAll('input[data-k]').forEach(inp => { it[inp.dataset.k] = inp.value; });
            if (it.item_name || it.qty) {
                it.qty = Number(it.qty) || 0;
                it.unit_price = Number(it.unit_price) || 0;
                items.push(it);
            }
        }
        if (!items.length) return UI.toast(APP_L('至少一条明细','至少一條明細','At least one item'), 'error');
        const body = {
            bu_no: f('#f_bu'), supplier_id: supSel.value, supplier_name: supName,
            pr_type: f('#f_type'), purpose: f('#f_purpose'), need_by_date: f('#f_need'), items
        };
        try {
            const res = id ? await API.put(`/api/pr-request/${id}`, body) : await API.post('/api/pr-request', body);
            UI.toast(res.message || 'OK', 'success');
            UI.closeModal();
            this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async submit(id) {
        try {
            const res = await API.post(`/api/pr-request/${id}/submit`, {});
            UI.toast(res.message, 'success');
            this.load();
            if (typeof refreshApprovalBadge === 'function') refreshApprovalBadge();
        } catch (e) { UI.toast(e.message, 'error'); }
    },
    async cancel(id) {
        if (!confirm(APP_L('确认撤回？','確認撤回？','Confirm?'))) return;
        try {
            await API.post(`/api/workflow/instances/${id}/cancel`, {});
            UI.toast(APP_L('已撤回','已撤回','Withdrawn'), 'success');
            this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },
    async del(id) {
        if (!confirm(APP_L('确认删除？','確認刪除？','Confirm?'))) return;
        try { await API.del(`/api/pr-request/${id}`); UI.toast(APP_L('已删除','已刪除','Deleted'), 'success'); this.load(); }
        catch (e) { UI.toast(e.message, 'error'); }
    },
    async genPO(id) {
        if (!confirm(APP_L('审批通过后生成 PO？','已通過審批並生成 PO？','Generate PO from approved PR?'))) return;
        try {
            const res = await API.post(`/api/pr-request/${id}/generate-po`, {});
            UI.toast(res.message, 'success');
            this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async detail(id) {
        const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
        try {
            const d = (await API.get(`/api/pr-request/${id}`)).data;
            const items = (d.items || []).map((it,i) => `
                <tr>
                    <td>${i+1}</td>
                    <td>${esc(it.xitems||'-')}</td>
                    <td>${esc(it.item_name||'-')}</td>
                    <td style="text-align:right;">${UI.fmt(it.qty)} ${esc(it.unit||'')}</td>
                    <td style="text-align:right;">${UI.fmt(it.unit_price)}</td>
                    <td style="text-align:right;">${UI.fmt(it.amount)}</td>
                </tr>`).join('');
            UI.modal(
                `${esc(d.pr_no)} - ${esc(d.supplier_name)}`,
                `
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px 24px;margin-bottom:16px;">
                    <div><b>${APP_L('供应商','供應商','Supplier')}：</b>${esc(d.supplier_name)}</div>
                    <div><b>${APP_L('类型','類型','Type')}：</b>${this.typeLabel(d.pr_type)}</div>
                    <div><b>${t('topbar.bu')}：</b>${esc(d.bu_no)}</div>
                    <div><b>${APP_L('状态','狀態','Status')}：</b>${this.statusBadge(d.status)}</div>
                    <div><b>${APP_L('需求日','需求日','Need By')}：</b>${esc(String(d.need_by_date||'').slice(0,10))}</div>
                    <div>${d.po_uid?`<b>PO：</b><a href="javascript:void(0)" onclick="UI.toast('PO UID=${d.po_uid}','info')">${esc(d.po_id)}</a>`:''}</div>
                </div>
                ${d.purpose?`<p><b>${APP_L('用途','用途','Purpose')}：</b>${esc(d.purpose)}</p>`:''}
                <h4 style="margin-top:16px;">${APP_L('明细','明細','Items')}　<b style="float:right;color:#e74c3c;">${UI.fmt(d.total_amount)}</b></h4>
                <table class="data-table"><thead><tr>
                    <th>#</th><th>料件號</th><th>${APP_L('品名','品名','Item')}</th>
                    <th>${APP_L('数量','數量','Qty')}</th><th>${APP_L('单价','單價','Price')}</th><th>${APP_L('金额','金額','Amount')}</th>
                </tr></thead><tbody>${items}</tbody></table>
                `,
                `<button class="btn btn-ghost" onclick="UI.closeModal()">${APP_L('关闭','關閉','Close')}</button>
                 ${d.status==='APPROVED'&&!d.po_uid?`<button class="btn btn-primary" onclick="UI.closeModal();PrRequestPage.genPO(${d.id})">${APP_L('生成 PO','生成 PO','Gen PO')}</button>`:''}
                 ${d._canEdit?`<button class="btn btn-primary" onclick="UI.closeModal();PrRequestPage.openForm(${d.id})">${APP_L('编辑','編輯','Edit')}</button>`:''}`
            );
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};

registerPage('prRequest', () => PrRequestPage.load());
