/**
 * 销售履约与信用（COO-03）
 * 信用额度 · 销售退货 · 履约风险
 */
const SC_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] || zh);

const SalesCreditPage = {
    tab: 'credit',        // credit | returns | risks
    rows: [],
    summary: null,
    returns: [],
    soOptions: [],
    risks: null,

    async load() {
        if (!Auth.isLoggedIn()) { Auth.showLogin(); return; }
        document.getElementById('pageTitle').textContent = SC_L('销售履约与信用', '銷售履約與信用', 'Sales Credit & Fulfillment');
        this.renderTabs();
        await this.loadCurrentTab();
    },

    renderTabs() {
        const tabs = [
            { k: 'credit',  label: SC_L('信用额度', '信用額度', 'Credit Limits') },
            { k: 'returns', label: SC_L('销售退货', '銷售退貨', 'Sales Returns') },
            { k: 'risks',   label: SC_L('履约风险', '履約風險', 'Risk Watch') },
        ];
        const btn = this.tab === 'returns'
            ? `<button class="btn btn-primary" onclick="SalesCreditPage.openReturnForm()">+ ${SC_L('登记退货', '登記退貨', 'New Return')}</button>`
            : '';
        document.getElementById('pageContent').innerHTML = `
            <div class="page-header">
                <div class="tabs">
                    ${tabs.map(t => `<div class="tab-item ${this.tab===t.k?'active':''}" onclick="SalesCreditPage.switchTab('${t.k}')">${t.label}</div>`).join('')}
                </div>
                <div class="page-actions">${btn}</div>
            </div>
            <div id="scBody"></div>
        `;
        const tabsEl = document.querySelector('#pageContent .tabs');
        if (tabsEl && typeof bindTabs === 'function') bindTabs(tabsEl);
    },

    switchTab(t) { this.tab = t; this.renderTabs(); this.loadCurrentTab(); },

    async loadCurrentTab() {
        const el = document.getElementById('scBody');
        el.innerHTML = `<div style="padding:40px;text-align:center;color:#999;">⏳</div>`;
        try {
            if (this.tab === 'credit') await this.loadCreditTab();
            else if (this.tab === 'returns') await this.loadReturnsTab();
            else await this.loadRisksTab();
        } catch (e) {
            el.innerHTML = `<div style="padding:20px;color:#e74c3c;">${e.message}</div>`;
        }
    },

    // ======== Tab 1: 信用额度 ========
    async loadCreditTab() {
        const [limRes, sumRes] = await Promise.all([
            API.get(`/api/so-credit/limits?bu_no=${State.bu_no}`),
            API.get(`/api/so-credit/summary?bu_no=${State.bu_no}`),
        ]);
        this.rows = limRes.data || [];
        this.summary = sumRes.data || {};
        this.renderCreditTab();
    },

    renderCreditTab() {
        const s = this.summary || {};
        const el = document.getElementById('scBody');
        const card = (label, val, sub, color) => `
            <div style="flex:1;min-width:150px;border:1px solid #e2e8f0;border-left:4px solid ${color};border-radius:8px;padding:12px">
                <div style="font-size:12px;color:#64748b">${label}</div>
                <div style="font-size:19px;font-weight:700;margin:4px 0;color:${color}">${val}</div>
                <div style="font-size:11px;color:#94a3b8">${sub || ''}</div>
            </div>`;

        const bar = (r) => {
            if (!r.has_limit) return `<span style="color:#94a3b8">—</span>`;
            const pct = Math.min(100, Math.max(0, r.usage_rate));
            const col = r.over_limit ? '#dc2626' : (pct >= 80 ? '#f59e0b' : '#10b981');
            return `<div style="display:flex;align-items:center;gap:6px">
                <div style="flex:1;height:6px;background:#e2e8f0;border-radius:3px;min-width:50px">
                    <div style="width:${pct}%;height:6px;background:${col};border-radius:3px"></div>
                </div>
                <span style="font-size:12px;color:${col};min-width:42px;text-align:right">${r.usage_rate}%</span>
            </div>`;
        };

        el.innerHTML = `
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
                ${card(SC_L('客户数', '客戶數', 'Clients'), s.client_cnt ?? 0, `${s.with_limit_cnt || 0} ${SC_L('已设额度', '已設額度', 'with limit')}`, '#3b82f6')}
                ${card(SC_L('总额度', '總額度', 'Total Limit'), UI.fmt(s.total_limit), `${SC_L('已用', '已用', 'used')} ${UI.fmt(s.total_used)}`, '#8b5cf6')}
                ${card(SC_L('超限客户', '超限客戶', 'Over Limit'), s.over_limit_cnt ?? 0, `${s.frozen_cnt || 0} ${SC_L('冻结', '凍結', 'frozen')}`, '#dc2626')}
                ${card(SC_L('逾期金额', '逾期金額', 'Overdue'), UI.fmt(s.overdue_amt), `${s.overdue_cnt || 0} ${SC_L('个客户', '個客戶', 'clients')}`, '#f59e0b')}
                ${card(SC_L('已出货未开票', '已出貨未開票', 'Shipped Not Invoiced'), UI.fmt(s.no_invoice_amt), '', '#0ea5e9')}
                ${card(SC_L('待处理退货', '待處理退貨', 'Pending Returns'), s.returns?.pending_cnt ?? 0, UI.fmt(s.returns?.pending_amt), '#64748b')}
            </div>
            <div style="overflow-x:auto;">
            <table class="data-table">
                <thead><tr>
                    <th>${SC_L('客户', '客戶', 'Client')}</th>
                    <th style="text-align:right;">${SC_L('信用额度', '信用額度', 'Limit')}</th>
                    <th style="text-align:right;">${SC_L('已用额度', '已用額度', 'Used')}</th>
                    <th style="text-align:right;">${SC_L('可用额度', '可用額度', 'Available')}</th>
                    <th style="min-width:130px;">${SC_L('使用率', '使用率', 'Usage')}</th>
                    <th style="text-align:center;">${SC_L('账期', '帳期', 'Terms')}</th>
                    <th style="text-align:center;">${SC_L('状态', '狀態', 'Status')}</th>
                    <th style="text-align:right;">${SC_L('逾期金额', '逾期金額', 'Overdue')}</th>
                    <th>${SC_L('操作', '操作', 'Actions')}</th>
                </tr></thead>
                <tbody>
                ${this.rows.map(r => `
                    <tr>
                        <td><b>${r.client_id}</b></td>
                        <td class="num">${r.has_limit ? UI.fmt(r.credit_limit) : `<span style="color:#94a3b8">${SC_L('未设额度', '未設額度', 'Not set')}</span>`}</td>
                        <td class="num">${UI.fmt(r.used)}</td>
                        <td class="num" style="color:${r.over_limit ? '#dc2626' : (r.has_limit ? '#166534' : '#94a3b8')};font-weight:600">
                            ${r.has_limit ? UI.fmt(r.available) : '—'}</td>
                        <td>${bar(r)}</td>
                        <td class="text-center">${r.credit_days}d</td>
                        <td class="text-center">${this.creditBadge(r)}</td>
                        <td class="num" style="color:${r.overdue_amt > 0 ? '#dc2626' : '#94a3b8'}">${UI.fmt(r.overdue_amt)}</td>
                        <td><button class="btn btn-ghost btn-sm" onclick="SalesCreditPage.openLimitForm('${String(r.client_id).replace(/'/g, "\\'")}')">${SC_L('设置额度', '設定額度', 'Set Limit')}</button></td>
                    </tr>`).join('') || `<tr><td colspan="9" style="text-align:center;color:#999">${SC_L('暂无客户数据', '暫無客戶資料', 'No clients')}</td></tr>`}
                </tbody>
            </table></div>
        `;
    },

    creditBadge(r) {
        if (!r.has_limit) return `<span style="padding:2px 8px;border-radius:10px;background:#e2e8f0;color:#475569;font-size:12px">${SC_L('未设额度', '未設額度', 'No Limit')}</span>`;
        if (r.status === 'HOLD') return `<span style="padding:2px 8px;border-radius:10px;background:#e0e7ff;color:#3730a3;font-size:12px">${SC_L('冻结', '凍結', 'Frozen')}</span>`;
        if (r.over_limit) return `<span style="padding:2px 8px;border-radius:10px;background:#fee2e2;color:#991b1b;font-size:12px">${SC_L('超限', '超限', 'Over')}</span>`;
        return `<span style="padding:2px 8px;border-radius:10px;background:#dcfce7;color:#166534;font-size:12px">${SC_L('正常', '正常', 'Active')}</span>`;
    },

    openLimitForm(clientId) {
        const r = this.rows.find(x => x.client_id === clientId) || { client_id: clientId };
        UI.modal(`${SC_L('设置信用额度', '設定信用額度', 'Set Credit Limit')} — ${clientId}`, `
            <div class="form-grid">
                <div><label>${SC_L('信用额度', '信用額度', 'Credit Limit')}</label>
                    <input id="sc_limit" type="number" step="0.01" class="form-input" value="${r.credit_limit || 0}"></div>
                <div><label>${SC_L('账期（天）', '帳期（天）', 'Credit Days')}</label>
                    <input id="sc_days" type="number" class="form-input" value="${r.credit_days || 30}"></div>
                <div><label>${SC_L('状态', '狀態', 'Status')}</label>
                    <select id="sc_status" class="form-input">
                        <option value="USE" ${r.status !== 'HOLD' ? 'selected' : ''}>${SC_L('启用', '啟用', 'Active')}</option>
                        <option value="HOLD" ${r.status === 'HOLD' ? 'selected' : ''}>${SC_L('冻结（禁止下单）', '凍結（禁止下單）', 'Frozen (block orders)')}</option>
                    </select></div>
                <div class="col-2"><label>${SC_L('备注', '備註', 'Remark')}</label>
                    <input id="sc_remark" class="form-input" value="${r.remark || ''}"></div>
                <div class="col-2" style="font-size:12px;color:#64748b">
                    ${SC_L('当前已用', '目前已用', 'Currently used')}: <b>${UI.fmt(r.used || 0)}</b>
                    · ${SC_L('未收应收', '未收應收', 'Unpaid AR')} ${UI.fmt(r.unpaid || 0)}
                    · ${SC_L('已出货未开票', '已出貨未開票', 'Shipped not invoiced')} ${UI.fmt(r.shipped_no_invoice || 0)}
                    · ${SC_L('已核准退货', '已核准退貨', 'Approved returns')} ${UI.fmt(r.returns || 0)}
                </div>
            </div>
        `, `<button class="btn btn-ghost" onclick="UI.closeModal()">${SC_L('取消', '取消', 'Cancel')}</button>
            <button class="btn btn-primary" onclick="SalesCreditPage.saveLimit('${String(clientId).replace(/'/g, "\\'")}')">${SC_L('保存', '保存', 'Save')}</button>`);
    },

    async saveLimit(clientId) {
        const body = {
            bu_no: State.bu_no,
            client_name: clientId,
            credit_limit: Number(document.getElementById('sc_limit').value) || 0,
            credit_days: Number(document.getElementById('sc_days').value) || 30,
            status: document.getElementById('sc_status').value,
            remark: document.getElementById('sc_remark').value,
        };
        try {
            await API.put(`/api/so-credit/limits/${encodeURIComponent(clientId)}`, body);
            UI.toast(SC_L('信用额度已保存', '信用額度已保存', 'Credit limit saved'), 'success');
            UI.closeModal();
            await this.loadCreditTab();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ======== Tab 2: 销售退货 ========
    async loadReturnsTab() {
        const res = await API.get(`/api/so-credit/returns?bu_no=${State.bu_no}&limit=300`);
        this.returns = res.data || [];
        this.renderReturnsTab();
    },

    reasonLabel(t) {
        return {
            QUALITY: SC_L('质量问题', '質量問題', 'Quality'),
            SPEC: SC_L('规格不符', '規格不符', 'Spec mismatch'),
            OVERSUPPLY: SC_L('超交退回', '超交退回', 'Oversupply'),
            LATE: SC_L('交期延误', '交期延誤', 'Late delivery'),
            OTHER: SC_L('其他', '其他', 'Other')
        }[t] || t;
    },

    returnBadge(st) {
        const map = {
            PENDING: ['#fef3c7', '#92400e', SC_L('待处理', '待處理', 'Pending')],
            APPROVED: ['#dcfce7', '#166534', SC_L('已核准', '已核准', 'Approved')],
            CLOSED: ['#e2e8f0', '#475569', SC_L('已冲销', '已沖銷', 'Closed')],
            REJECTED: ['#fee2e2', '#991b1b', SC_L('已驳回', '已駁回', 'Rejected')]
        }[st] || ['#e2e8f0', '#475569', st];
        return `<span style="padding:2px 8px;border-radius:10px;background:${map[0]};color:${map[1]};font-size:12px">${map[2]}</span>`;
    },

    renderReturnsTab() {
        const el = document.getElementById('scBody');
        const canMgr = Auth.isManager();
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table">
                <thead><tr>
                    <th>${SC_L('退货单号', '退貨單號', 'Return No.')}</th>
                    <th>${SC_L('日期', '日期', 'Date')}</th>
                    <th>SO</th>
                    <th>${SC_L('客户', '客戶', 'Client')}</th>
                    <th>${SC_L('料件', '料件', 'Item')}</th>
                    <th style="text-align:right;">${SC_L('数量', '數量', 'Qty')}</th>
                    <th style="text-align:right;">${SC_L('单价', '單價', 'Price')}</th>
                    <th style="text-align:right;">${SC_L('金额', '金額', 'Amount')}</th>
                    <th>${SC_L('原因', '原因', 'Reason')}</th>
                    <th>${SC_L('状态', '狀態', 'Status')}</th>
                    <th>${SC_L('操作', '操作', 'Actions')}</th>
                </tr></thead>
                <tbody>
                ${this.returns.map(r => `
                    <tr>
                        <td><b>${r.return_no}</b></td>
                        <td>${String(r.return_date || '').slice(0, 10)}</td>
                        <td>${r.so_nbr || '-'}</td>
                        <td>${r.client_name || r.client_id || '-'}</td>
                        <td>${r.xitems || '-'}</td>
                        <td class="num">${UI.fmt(r.return_qty, 4)}</td>
                        <td class="num">${UI.fmt(r.unit_price, 4)}</td>
                        <td class="num negative">${UI.fmt(r.return_amount)}</td>
                        <td>${this.reasonLabel(r.reason_type)}</td>
                        <td>${this.returnBadge(r.status)}${r.handle_reason ? `<div style="font-size:11px;color:#94a3b8">${r.handle_reason}</div>` : ''}</td>
                        <td style="white-space:nowrap;">
                            ${r.status === 'PENDING' && canMgr ? `
                                <button class="btn btn-success btn-sm" onclick="SalesCreditPage.returnAction(${r.uid},'APPROVED')">${SC_L('核准', '核准', 'Approve')}</button>
                                <button class="btn btn-danger btn-sm" onclick="SalesCreditPage.returnAction(${r.uid},'REJECTED')">${SC_L('驳回', '駁回', 'Reject')}</button>` : ''}
                            ${r.status === 'APPROVED' && canMgr ? `
                                <button class="btn btn-ghost btn-sm" onclick="SalesCreditPage.returnAction(${r.uid},'CLOSED')">${SC_L('冲销', '沖銷', 'Close')}</button>` : ''}
                        </td>
                    </tr>`).join('') || `<tr><td colspan="11" style="text-align:center;color:#999">${SC_L('暂无退货单', '暫無退貨單', 'No returns')}</td></tr>`}
                </tbody>
            </table></div>
        `;
    },

    async openReturnForm() {
        const res = await API.get(`/api/so?bu_no=${State.bu_no}&limit=300`).catch(() => ({ data: [] }));
        this.soOptions = res.data || [];
        const opts = this.soOptions.map(s =>
            `<option value="${s.so_nbr}" data-client="${s.client_id || ''}" data-cname="${s.client_name || ''}" data-item="${s.xitems || ''}" data-price="${s.unit_price || 0}">${s.so_nbr} · ${s.client_name || s.client_id || ''} · ${UI.fmt(Number(s.so_qty || 0) * Number(s.unit_price || 0))}</option>`
        ).join('');

        UI.modal(SC_L('登记销售退货', '登記銷售退貨', 'New Sales Return'), `
            <div class="form-grid">
                <div class="col-2"><label>${SC_L('关联销售订单', '關聯銷售訂單', 'Sales Order')}</label>
                    <select id="sr_so" class="form-input" onchange="SalesCreditPage.onSoPick()">
                        <option value="">${SC_L('不关联（仅登记）', '不關聯（僅登記）', 'No link')}</option>${opts}
                    </select></div>
                <div><label>${SC_L('客户编号', '客戶編號', 'Client ID')}</label><input id="sr_cid" class="form-input"></div>
                <div><label>${SC_L('客户名称', '客戶名稱', 'Client Name')}</label><input id="sr_cname" class="form-input"></div>
                <div><label>${SC_L('料件', '料件', 'Item')}</label><input id="sr_item" class="form-input"></div>
                <div><label>${SC_L('退货日期', '退貨日期', 'Return Date')}</label>
                    <input id="sr_date" type="date" class="form-input" value="${new Date().toISOString().slice(0, 10)}"></div>
                <div><label>${SC_L('退货数量', '退貨數量', 'Qty')} *</label>
                    <input id="sr_qty" type="number" step="0.0001" class="form-input" oninput="SalesCreditPage.recalcReturnAmt()"></div>
                <div><label>${SC_L('单价', '單價', 'Unit Price')}</label>
                    <input id="sr_price" type="number" step="0.0001" class="form-input" oninput="SalesCreditPage.recalcReturnAmt()"></div>
                <div><label>${SC_L('退货金额', '退貨金額', 'Amount')}</label>
                    <input id="sr_amt" class="form-input" readonly style="background:#f5f5f5"></div>
                <div><label>${SC_L('退货原因', '退貨原因', 'Reason')}</label>
                    <select id="sr_reason" class="form-input">
                        <option value="QUALITY">${this.reasonLabel('QUALITY')}</option>
                        <option value="SPEC">${this.reasonLabel('SPEC')}</option>
                        <option value="OVERSUPPLY">${this.reasonLabel('OVERSUPPLY')}</option>
                        <option value="LATE">${this.reasonLabel('LATE')}</option>
                        <option value="OTHER">${this.reasonLabel('OTHER')}</option>
                    </select></div>
                <div class="col-2"><label>${SC_L('备注', '備註', 'Remark')}</label><input id="sr_remark" class="form-input"></div>
            </div>
        `, `<button class="btn btn-ghost" onclick="UI.closeModal()">${SC_L('取消', '取消', 'Cancel')}</button>
            <button class="btn btn-primary" onclick="SalesCreditPage.saveReturn()">${SC_L('保存', '保存', 'Save')}</button>`);
    },

    onSoPick() {
        const sel = document.getElementById('sr_so');
        const opt = sel.selectedOptions[0];
        if (!opt || !opt.value) return;
        document.getElementById('sr_cid').value = opt.dataset.client || '';
        document.getElementById('sr_cname').value = opt.dataset.cname || '';
        document.getElementById('sr_item').value = opt.dataset.item || '';
        document.getElementById('sr_price').value = opt.dataset.price || 0;
        this.recalcReturnAmt();
    },

    recalcReturnAmt() {
        const qty = Number(document.getElementById('sr_qty').value) || 0;
        const price = Number(document.getElementById('sr_price').value) || 0;
        document.getElementById('sr_amt').value = (qty * price).toFixed(2);
    },

    async saveReturn() {
        const body = {
            bu_no: State.bu_no,
            so_nbr: document.getElementById('sr_so').value || null,
            client_id: document.getElementById('sr_cid').value || null,
            client_name: document.getElementById('sr_cname').value || null,
            xitems: document.getElementById('sr_item').value || null,
            return_date: document.getElementById('sr_date').value,
            return_qty: Number(document.getElementById('sr_qty').value) || 0,
            unit_price: Number(document.getElementById('sr_price').value) || 0,
            reason_type: document.getElementById('sr_reason').value,
            remark: document.getElementById('sr_remark').value,
        };
        try {
            const r = await API.post('/api/so-credit/returns', body);
            UI.toast(`${SC_L('退货单已登记', '退貨單已登記', 'Return created')}: ${r.data.return_no}`, 'success');
            UI.closeModal();
            await this.loadReturnsTab();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async returnAction(uid, status) {
        const label = { APPROVED: SC_L('核准', '核准', 'approve'), REJECTED: SC_L('驳回', '駁回', 'reject'), CLOSED: SC_L('冲销', '沖銷', 'close') }[status];
        let reason = '';
        if (status !== 'APPROVED') {
            reason = prompt(SC_L('请输入处理原因', '請輸入處理原因', 'Enter reason'));
            if (!reason) return;
        }
        if (!confirm(`${SC_L('确认', '確認', 'Confirm')} ${label}?`)) return;
        try {
            await API.post(`/api/so-credit/returns/${uid}/status`, { status, reason });
            UI.toast(SC_L('状态已更新', '狀態已更新', 'Status updated'), 'success');
            await this.loadReturnsTab();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ======== Tab 3: 履约风险 ========
    async loadRisksTab() {
        const res = await API.get(`/api/so-credit/risks?bu_no=${State.bu_no}&limit=20`);
        this.risks = res.data || {};
        this.renderRisksTab();
    },

    renderRisksTab() {
        const d = this.risks || {};
        const c = d.counts || {};
        const el = document.getElementById('scBody');
        const section = (title, color, rows, cols) => `
            <h4 style="margin:18px 0 8px;color:${color}">${title}</h4>
            ${rows.length ? `<div style="overflow-x:auto;"><table class="data-table"><thead><tr>
                ${cols.map(x => `<th>${x}</th>`).join('')}
            </tr></thead><tbody>${rows.join('')}</tbody></table></div>`
            : `<p style="color:#94a3b8;font-size:13px">${SC_L('暂无数据', '暫無資料', 'No data')}</p>`}`;

        const over = (d.over_limit || []).map(r => `<tr>
            <td><b>${r.client_id}</b></td>
            <td class="num">${UI.fmt(r.credit_limit)}</td>
            <td class="num">${UI.fmt(r.used)}</td>
            <td class="num negative">${UI.fmt(r.over_amount)}</td>
            <td class="num">${r.usage_rate}%</td></tr>`);

        const overdue = (d.overdue || []).map(r => `<tr>
            <td><b>${r.client_id}</b></td>
            <td class="num">${UI.fmt(r.unpaid)}</td>
            <td class="num negative">${UI.fmt(r.overdue_amt)}</td>
            <td class="text-center">${r.overdue_cnt}</td>
            <td class="text-center">${r.credit_days}d</td></tr>`);

        const noInv = (d.no_invoice || []).map(r => `<tr>
            <td><b>${r.client_id}</b></td>
            <td class="num">${UI.fmt(r.shipped_no_invoice)}</td>
            <td class="num">${UI.fmt(r.used)}</td>
            <td>${this.creditBadge(r)}</td></tr>`);

        const pending = (d.pending_returns || []).map(r => `<tr>
            <td><b>${r.return_no}</b></td>
            <td>${String(r.return_date || '').slice(0, 10)}</td>
            <td>${r.client_name || r.client_id || '-'}</td>
            <td class="num">${UI.fmt(r.return_amount)}</td>
            <td>${this.reasonLabel(r.reason_type)}</td></tr>`);

        el.innerHTML = `
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:6px">
                <div style="flex:1;min-width:150px;border:1px solid #e2e8f0;border-left:4px solid #dc2626;border-radius:8px;padding:12px">
                    <div style="font-size:12px;color:#64748b">${SC_L('超限客户', '超限客戶', 'Over Limit')}</div>
                    <div style="font-size:22px;font-weight:700;color:#dc2626">${c.over_limit || 0}</div></div>
                <div style="flex:1;min-width:150px;border:1px solid #e2e8f0;border-left:4px solid #f59e0b;border-radius:8px;padding:12px">
                    <div style="font-size:12px;color:#64748b">${SC_L('逾期客户', '逾期客戶', 'Overdue')}</div>
                    <div style="font-size:22px;font-weight:700;color:#f59e0b">${c.overdue || 0}</div></div>
                <div style="flex:1;min-width:150px;border:1px solid #e2e8f0;border-left:4px solid #0ea5e9;border-radius:8px;padding:12px">
                    <div style="font-size:12px;color:#64748b">${SC_L('已出货未开票客户', '已出貨未開票客戶', 'Shipped Not Invoiced')}</div>
                    <div style="font-size:22px;font-weight:700;color:#0ea5e9">${c.no_invoice || 0}</div></div>
                <div style="flex:1;min-width:150px;border:1px solid #e2e8f0;border-left:4px solid #64748b;border-radius:8px;padding:12px">
                    <div style="font-size:12px;color:#64748b">${SC_L('待处理退货', '待處理退貨', 'Pending Returns')}</div>
                    <div style="font-size:22px;font-weight:700;color:#64748b">${c.pending_returns || 0}</div></div>
            </div>
            ${section(SC_L('① 信用超限客户', '① 信用超限客戶', '1. Over-limit clients'), '#dc2626', over,
                [SC_L('客户', '客戶', 'Client'), SC_L('额度', '額度', 'Limit'), SC_L('已用', '已用', 'Used'), SC_L('超额', '超額', 'Over'), SC_L('使用率', '使用率', 'Usage')])}
            ${section(SC_L('② 逾期未收款', '② 逾期未收款', '2. Overdue receivables'), '#f59e0b', overdue,
                [SC_L('客户', '客戶', 'Client'), SC_L('未收金额', '未收金額', 'Unpaid'), SC_L('逾期金额', '逾期金額', 'Overdue'), SC_L('逾期笔数', '逾期筆數', 'Invoices'), SC_L('账期', '帳期', 'Terms')])}
            ${section(SC_L('③ 已出货未开票', '③ 已出貨未開票', '3. Shipped not invoiced'), '#0ea5e9', noInv,
                [SC_L('客户', '客戶', 'Client'), SC_L('未开票金额', '未開票金額', 'Not invoiced'), SC_L('已用额度', '已用額度', 'Used'), SC_L('状态', '狀態', 'Status')])}
            ${section(SC_L('④ 待处理退货', '④ 待處理退貨', '4. Pending returns'), '#64748b', pending,
                [SC_L('退货单号', '退貨單號', 'Return No.'), SC_L('日期', '日期', 'Date'), SC_L('客户', '客戶', 'Client'), SC_L('金额', '金額', 'Amount'), SC_L('原因', '原因', 'Reason')])}
        `;
    }
};

registerPage('salesCredit', async () => { await SalesCreditPage.load(); });
