/**
 * 收款核销工作台 (AR Match)
 * 收款登记 · 三单匹配 · 匹配汇总
 */
const ArMatchPage = {
    tab: 'receipt',
    invoiceOptions: [],
    receiptList: [],
    matchRows: [],
    summaryData: null,
    matchMonth: '',
    matchBU: '',

    // ======== 入口 ========
    async load() {
        if (!Auth.isLoggedIn()) { Auth.showLogin(); return; }
        document.getElementById('pageTitle').textContent = APP_L('收款核销', '收款核銷', 'AR Receipt Match');
        this.renderTabs();
        await this.loadCurrentTab();
    },

    renderTabs() {
        const tabs = [
            { k: 'receipt', label: APP_L('收款登记', '收款登記', 'Receipt Register') },
            { k: 'match',   label: APP_L('三单匹配', '三單匹配', 'Run Match') },
            { k: 'summary', label: APP_L('匹配汇总', '匹配匯總', 'Summary') },
        ];
        document.getElementById('pageContent').innerHTML = `
            <div class="page-header">
                <div class="tabs">
                    ${tabs.map(t => `<div class="tab-item ${this.tab===t.k?'active':''}" onclick="ArMatchPage.switchTab('${t.k}')">${t.label}</div>`).join('')}
                </div>
                <div class="page-actions">
                    ${this.tab==='receipt' ? `<button class="btn btn-primary" onclick="ArMatchPage.openReceiptForm()">+ ${APP_L('登记收款', '登記收款', 'New Receipt')}</button>` : ''}
                    ${this.tab==='match'   ? `<button class="btn btn-primary" onclick="ArMatchPage.runMatch()">⚡ ${APP_L('执行匹配', '執行匹配', 'Run Match')}</button>` : ''}
                </div>
            </div>
            <div id="arBody"></div>
        `;
        const tabsEl = document.querySelector('#pageContent .tabs');
        if (tabsEl && typeof bindTabs === 'function') bindTabs(tabsEl);
    },

    switchTab(t) { this.tab = t; this.renderTabs(); this.loadCurrentTab(); },

    async loadCurrentTab() {
        try {
            if (this.tab === 'receipt') await this.loadReceiptTab();
            else if (this.tab === 'match') await this.loadMatchTab();
            else if (this.tab === 'summary') await this.loadSummaryTab();
        } catch (e) {
            document.getElementById('arBody').innerHTML = `<div style="padding:20px;color:#e74c3c;">${e.message}</div>`;
        }
    },

    // ======== Tab 1: 收款登记 ========
    async loadReceiptTab() {
        const el = document.getElementById('arBody');
        el.innerHTML = `<div style="padding:40px;text-align:center;color:#999;">⏳</div>`;

        const [rcptRes, invRes] = await Promise.all([
            API.get('/api/receipt').catch(() => ({ data: [] })),
            API.get('/api/receipt/invoice-options').catch(() => ({ data: [] })),
        ]);
        this.receiptList = rcptRes.data || [];
        this.invoiceOptions = invRes.data || [];
        this.renderReceiptTab();
    },

    renderReceiptTab() {
        const el = document.getElementById('arBody');
        if (!this.receiptList.length) {
            el.innerHTML = `<div style="padding:30px;text-align:center;color:#999;">${APP_L('暂无收款登记，点击右上角"+登记收款"', '暫無收款登記', 'No receipts yet')}</div>`;
            return;
        }
        const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table">
                <thead><tr>
                    <th>${APP_L('公司','公司','BU')}</th>
                    <th>${APP_L('发票号','發票號','Invoice')}</th>
                    <th>${APP_L('客户','客戶','Client')}</th>
                    <th style="text-align:right;">${APP_L('发票金额','發票金額','Invoice Amt')}</th>
                    <th style="text-align:right;">${APP_L('未结','未結','Unpaid')}</th>
                    <th style="text-align:right;color:#e67e22;">${APP_L('本次收款','本次收款','Receipt')}</th>
                    <th>${APP_L('收款日期','收款日期','Receipt Date')}</th>
                    <th>${APP_L('操作','操作','Actions')}</th>
                </tr></thead>
                <tbody>
                ${this.receiptList.map(r => {
                    const invTotal = Number(r.inv_amt || 0);
                    const invUnpaid = Number(r.inv_unpaid ?? (invTotal - (r.inv_paid || 0)));
                    return `
                <tr>
                    <td>${esc(r.bu_no)}</td>
                    <td><b>${esc(r.invoice_no)}</b></td>
                    <td>${esc(r.client_id)}</td>
                    <td style="text-align:right;">${UI.fmt(invTotal)}</td>
                    <td style="text-align:right;color:#c0392b;">${UI.fmt(invUnpaid)}</td>
                    <td style="text-align:right;color:#27ae60;font-weight:600;">${UI.fmt(r.receipt_amt)}</td>
                    <td>${esc(String(r.receipt_date||'').slice(0,10))}</td>
                    <td>
                        <button class="btn btn-ghost" onclick="ArMatchPage.openReceiptForm(${r.uid})">${APP_L('编辑','編輯','Edit')}</button>
                        <button class="btn btn-danger" onclick="ArMatchPage.delReceipt(${r.uid})">${APP_L('删除','刪除','Del')}</button>
                    </td>
                </tr>`;
                }).join('')}
                </tbody>
            </table></div>
        `;
    },

    async openReceiptForm(uid) {
        const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
        let d = null;
        if (uid) {
            try { d = (await API.get(`/api/receipt/${uid}`)).data; }
            catch(e) { return UI.toast(e.message, 'error'); }
        }
        if (!this.invoiceOptions.length) {
            try { this.invoiceOptions = (await API.get('/api/receipt/invoice-options')).data || []; } catch(e) {}
        }

        const form = d || { bu_no:'', receipt_date: new Date().toISOString().slice(0,10), receipt_amt: 0 };
        const invSel = `<option value="">${APP_L('请选择未结 AR 发票','請選擇未結 AR 發票','Select unpaid AR invoice')}</option>` +
            this.invoiceOptions.map(i => {
                const selected = form.invoice_uid === i.uid ? 'selected' : '';
                return `<option value="${i.uid}" data-bu="${esc(i.bu_no)}" data-client="${esc(i.client_id)}" data-amount="${i.sub_amt}" data-unpaid="${i.unpaid}" ${selected}>
                    ${esc(i.invoice_no)} · ${esc(i.bu_no)} · ${esc(i.client_id)} · ${APP_L('未結','未結','Unpaid')} ${UI.fmt(i.unpaid)}</option>`;
            }).join('');

        UI.modal(
            uid ? APP_L('编辑收款','編輯收款','Edit Receipt') : APP_L('登记收款','登記收款','New Receipt'),
            `
            <div class="form-grid">
                <div class="col-2">
                    <label>${APP_L('AR 发票（未结）','AR 發票（未結）','Unpaid AR Invoice')} *</label>
                    <select id="f_inv" class="form-input" onchange="ArMatchPage.onInvChange()">${invSel}</select>
                </div>
                <div><label>${APP_L('公司','公司','BU')}</label><input id="f_bu" class="form-input" readonly value="${esc(form.bu_no||'')}"></div>
                <div><label>${APP_L('客户','客戶','Client')}</label><input id="f_client" class="form-input" readonly value="${esc(form.client_id||'')}"></div>
                <div><label>${APP_L('收款日期','收款日期','Receipt Date')} *</label><input id="f_date" type="date" class="form-input" value="${esc(form.receipt_date||'')}"></div>
                <div><label>${APP_L('收款金额','收款金額','Receipt Amt')} *</label><input id="f_amt" type="number" step="0.01" class="form-input" value="${form.receipt_amt||''}"></div>
                <div class="col-2"><label>${APP_L('银行/备注','銀行/備註','Bank / Remark')}</label><input id="f_bank" class="form-input" value="${esc(form.bank_name||'')}" placeholder="${APP_L('如：华南银行活期存款','如：華南銀行活期存款','e.g. Cathay Bank Current')}"></div>
            </div>
            `,
            `<button class="btn btn-ghost" onclick="UI.closeModal()">${APP_L('取消','取消','Cancel')}</button>
             <button class="btn btn-primary" onclick="ArMatchPage.saveReceipt(${uid||0})">${APP_L('保存','保存','Save')}</button>`
        );
        this._formEdit = !!uid;
    },

    onInvChange() {
        const sel = document.getElementById('f_inv');
        const opt = sel.selectedOptions[0];
        if (!opt || !opt.value) return;
        document.getElementById('f_bu').value = opt.dataset.bu || '';
        document.getElementById('f_client').value = opt.dataset.client || '';
        // 默认收款金额 = 未结金额（刚好收齐）；编辑时不动
        if (!this._formEdit) {
            document.getElementById('f_amt').value = opt.dataset.unpaid || '';
        }
    },

    async saveReceipt(uid) {
        const f = (id) => document.getElementById(id);
        const invSel = f('f_inv');
        const invOpt = invSel.selectedOptions[0];
        if (!invSel.value) return UI.toast(APP_L('请选择发票','請選擇發票','Select invoice'), 'error');
        const amt = Number(f('f_amt').value);
        if (!amt || amt <= 0) return UI.toast(APP_L('收款金额必须大于 0','收款金額必須大於 0','Amount > 0'), 'error');
        const body = {
            invoice_uid: Number(invSel.value),
            bu_no: f('f_bu').value,
            client_id: f('f_client').value,
            invoice_no: invOpt.textContent.split('·')[0].trim(),
            receipt_date: f('f_date').value,
            receipt_amt: amt,
            bank_name: f('f_bank').value,
        };
        try {
            const res = uid ? await API.put(`/api/receipt/${uid}`, body) : await API.post('/api/receipt', body);
            UI.toast(res.message || APP_L('已保存','已保存','Saved'), 'success');
            UI.closeModal();
            await this.loadReceiptTab();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async delReceipt(uid) {
        if (!confirm(APP_L('确认删除？（已核销不可删）','確認刪除？已核銷不可刪','Confirm? Settled ones protected.'))) return;
        try { await API.del(`/api/receipt/${uid}`); UI.toast(APP_L('已删除','已刪除','Deleted'), 'success'); await this.loadReceiptTab(); }
        catch (e) { UI.toast(e.message, 'error'); }
    },

    // ======== Tab 2: 三单匹配 ========
    async loadMatchTab() {
        const el = document.getElementById('arBody');
        if (!this.matchMonth) this.matchMonth = new Date().toISOString().slice(0,7);
        el.innerHTML = `
            <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap;">
                <label>${APP_L('月份','月份','YYYY-MM')}</label>
                <input id="m_month" type="month" class="form-input" value="${this.matchMonth}" style="width:140px;">
                <label>${APP_L('公司','公司','BU')}</label>
                <select id="m_bu" class="form-input" style="width:90px;">
                    <option value="">${APP_L('全部','全部','All')}</option>
                    ${['HM','HN','SZ'].map(v => `<option ${this.matchBU===v?'selected':''}>${v}</option>`).join('')}
                </select>
                <button class="btn btn-ghost" onclick="ArMatchPage.searchMatch()">${APP_L('查询','查詢','Query')}</button>
                <span style="color:#999;">${APP_L('先"执行匹配"生成结果','先"執行匹配"生成結果','Click Run Match first')}</span>
            </div>
            <div id="m_list"></div>
        `;
        await this.queryMatchResults();
    },

    async runMatch() {
        const f = (id) => document.getElementById(id);
        const month = f('m_month').value;
        const bu = f('m_bu').value;
        try {
            UI.toast(APP_L('匹配中…','匹配中…','Matching…'), 'info');
            const res = await API.post('/api/ar-match/run', { YYYY_MM: month || undefined, bu_no: bu || undefined });
            UI.toast(res.message || APP_L('匹配完成','匹配完成','Done'), 'success');
            this.matchMonth = month; this.matchBU = bu;
            await this.queryMatchResults();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    searchMatch() {
        const f = (id) => document.getElementById(id);
        this.matchMonth = f('m_month').value;
        this.matchBU = f('m_bu').value;
        this.queryMatchResults();
    },

    async queryMatchResults() {
        const list = document.getElementById('m_list');
        if (!list) return;
        list.innerHTML = `<div style="padding:40px;text-align:center;color:#999;">⏳</div>`;
        const qs = new URLSearchParams({});
        if (this.matchMonth) qs.set('YYYY_MM', this.matchMonth);
        if (this.matchBU) qs.set('bu_no', this.matchBU);
        try {
            const res = await API.get(`/api/ar-match/results?${qs.toString()}`);
            this.matchRows = res.data || [];
            this.renderMatchList();
        } catch (e) {
            list.innerHTML = `<div style="padding:20px;color:#e74c3c;">${e.message}</div>`;
        }
    },

    renderMatchList() {
        const list = document.getElementById('m_list');
        if (!this.matchRows.length) {
            list.innerHTML = `<div style="padding:30px;text-align:center;color:#999;">${APP_L('暂无匹配结果','暫無匹配結果','No results')}</div>`;
            return;
        }
        const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
        const statusMap = {
            PAID_FULL:  { label: APP_L('已全额收','已全額收','Paid Full'),    cls: 'bg-success' },
            PARTIAL:    { label: APP_L('部分收款','部分收款','Partial'),       cls: 'bg-warning' },
            UNPAID:     { label: APP_L('未收款','未收款','Unpaid'),          cls: '' },
            OVER_PAID:  { label: APP_L('收款超额','收款超額','Over Paid'),   cls: 'bg-danger' },
        };
        list.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table">
                <thead><tr>
                    <th>${APP_L('发票号','發票號','Invoice')}</th>
                    <th>${APP_L('客户','客戶','Client')}</th>
                    <th>${APP_L('公司','公司','BU')}</th>
                    <th style="text-align:right;">${APP_L('发票金额','發票金額','Invoice')}</th>
                    <th style="text-align:right;color:#27ae60;">${APP_L('本次收款','本次收款','Receipt')}</th>
                    <th style="text-align:right;">${APP_L('先前已收','先前已收','Prior Paid')}</th>
                    <th style="text-align:right;color:#c0392b;">${APP_L('未结','未結','Unpaid')}</th>
                    <th>${APP_L('状态','狀態','Status')}</th>
                    <th>${APP_L('操作','操作','Actions')}</th>
                </tr></thead>
                <tbody>
                ${this.matchRows.map(r => {
                    const st = statusMap[r.match_status] || { label: r.match_status, cls: '' };
                    const totalPaid = Number(r.prior_payment||0) + Number(r.receipt_amt||0);
                    return `
                <tr>
                    <td><b>${esc(r.invoice_no)}</b></td>
                    <td>${esc(r.client_id)}</td>
                    <td>${esc(r.bu_no)}</td>
                    <td style="text-align:right;">${UI.fmt(r.invoice_amt)}</td>
                    <td style="text-align:right;color:#27ae60;font-weight:600;">${UI.fmt(r.receipt_amt)}</td>
                    <td style="text-align:right;">${UI.fmt(r.prior_payment)}</td>
                    <td style="text-align:right;color:${r.unpaid_amt>0?'#c0392b':'#27ae60'};">${UI.fmt(r.unpaid_amt)}</td>
                    <td>
                        <span class="badge ${st.cls}">${st.label}</span>
                        ${r.receipt_settled ? '<span class="badge bg-info" style="margin-left:4px;">'+APP_L('已核销','已核銷','Settled')+'</span>' : ''}
                    </td>
                    <td>
                        ${r.match_status==='PAID_FULL' && !r.receipt_settled && r.receipt_amt>0 ?
                            `<button class="btn btn-primary" onclick="ArMatchPage.settle(${r.id})">💳 ${APP_L('核销','核銷','Settle')}</button>` : ''}
                        ${!r.receipt_settled ?
                            `<button class="btn btn-ghost" onclick="ArMatchPage.confirmManual(${r.id})">${APP_L('手动','手動','Manual')}</button>` : ''}
                    </td>
                </tr>`;
                }).join('')}
                </tbody>
            </table></div>
        `;
    },

    async confirmManual(id) {
        const codes = [['UNPAID', APP_L('未收款','未收款','Unpaid')], ['PARTIAL', APP_L('部分收款','部分收款','Partial')], ['PAID_FULL', APP_L('已全额收','已全額收','Paid Full')]];
        const pick = prompt(APP_L('输入状态代码','輸入狀態代碼','Enter code')+':\n'+codes.map(c=>`${c[0]} - ${c[1]}`).join('\n'), 'PAID_FULL');
        if (!pick) return;
        try {
            const res = await API.post(`/api/ar-match/results/${id}/confirm`, { match_status: pick });
            UI.toast(res.message || APP_L('已更新','已更新','Updated'), 'success');
            await this.queryMatchResults();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async settle(id) {
        if (!confirm(APP_L('确认核销？（回写发票已收金额）','確認核銷？回寫發票已收金額','Confirm settle? Update invoice payment.'))) return;
        try {
            const res = await API.post(`/api/ar-match/results/${id}/settle`, {});
            UI.toast(res.message || APP_L('已核销','已核銷','Done'), 'success');
            await this.queryMatchResults();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ======== Tab 3: 匹配汇总 ========
    async loadSummaryTab() {
        const el = document.getElementById('arBody');
        el.innerHTML = `
            <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap;">
                <label>${APP_L('月份','月份','YYYY-MM')}</label>
                <input id="s_month" type="month" class="form-input" value="${this.matchMonth}" style="width:140px;" onchange="ArMatchPage.loadSummaryTab()">
            </div>
        `;
        const month = document.getElementById('s_month').value || this.matchMonth;
        if (month) this.matchMonth = month;
        try {
            const res = await API.get(`/api/ar-match/summary${month?`?YYYY_MM=${month}`:''}`);
            this.summaryData = res.data || { by_status: [], overall: {} };
            this.renderSummary();
        } catch (e) {
            el.innerHTML += `<div style="padding:20px;color:#e74c3c;">${e.message}</div>`;
        }
    },

    renderSummary() {
        const el = document.getElementById('arBody');
        const { by_status = [], overall = {} } = this.summaryData;
        const statusColors = { PAID_FULL:'#27ae60', PARTIAL:'#f39c12', UNPAID:'#95a5a6', OVER_PAID:'#c0392b' };
        const statusLabels = {
            PAID_FULL: APP_L('已全额收','已全額收','Paid Full'),
            PARTIAL:   APP_L('部分收款','部分收款','Partial'),
            UNPAID:    APP_L('未收款','未收款','Unpaid'),
            OVER_PAID: APP_L('收款超额','收款超額','Over Paid'),
        };
        const cards = by_status.map(s => `
            <div class="card" style="flex:1;min-width:180px;border-left:4px solid ${statusColors[s.match_status]||'#999'};">
                <div style="color:#888;font-size:12px;">${statusLabels[s.match_status]||s.match_status}</div>
                <div style="font-size:28px;font-weight:700;color:${statusColors[s.match_status]||'#333'};">${s.cnt||0}</div>
                <div style="color:#555;font-size:13px;">
                    ${APP_L('发票','發票','Inv')} ${UI.fmt(s.inv_total)} ·
                    ${APP_L('已登收款','已登收款','Rcpt')} ${UI.fmt(s.rcpt_total)} ·
                    ${APP_L('未结','未結','Unpaid')} ${UI.fmt(s.unpaid_total)}
                </div>
            </div>
        `).join('') || `<div style="padding:30px;text-align:center;color:#999;">${APP_L('暂无数据','暫無資料','No data')}</div>`;

        el.innerHTML += `
            <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px;">${cards}</div>
            <div class="card" style="padding:20px;">
                <h4 style="margin:0 0 16px 0;">${APP_L('合计','合計','Overall')}</h4>
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;">
                    <div>
                        <div style="color:#888;font-size:12px;">${APP_L('总发票数','總發票數','Total')}</div>
                        <div style="font-size:22px;font-weight:700;">${overall.total||0}</div>
                    </div>
                    <div>
                        <div style="color:#888;font-size:12px;">${APP_L('已全额收','已全額收','Paid Full')}</div>
                        <div style="font-size:22px;font-weight:700;color:#27ae60;">${overall.paid_full||0}</div>
                    </div>
                    <div>
                        <div style="color:#888;font-size:12px;">${APP_L('发票总额','發票總額','Inv Total')}</div>
                        <div style="font-size:22px;font-weight:700;color:#e74c3c;">${UI.fmt(overall.inv_amt||0)}</div>
                    </div>
                    <div>
                        <div style="color:#888;font-size:12px;">${APP_L('已登收款','已登收款','Rcpt Total')}</div>
                        <div style="font-size:22px;font-weight:700;color:#27ae60;">${UI.fmt(overall.rcpt_amt||0)}</div>
                    </div>
                </div>
            </div>
        `;
    },
};

registerPage('arMatch', () => ArMatchPage.load());
