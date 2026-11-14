/**
 * PO 三单匹配工作台
 * 收货登记 · 三单匹配 · 匹配汇总
 */
const PoMatchPage = {
    tab: 'grn',           // grn | match | summary
    // GRN 缓存
    poOptions: [],         // PO 下拉
    grnList: [],           // 收货单列表
    grnEditing: null,      // 正在编辑的 GRN

    // 匹配缓存
    matchRows: [],
    summaryData: null,
    matchMonth: '',        // 当前筛选月份
    matchBU: '',

    // ======== 入口 ========
    async load() {
        if (!Auth.isLoggedIn()) { Auth.showLogin(); return; }
        document.getElementById('pageTitle').textContent = APP_L('PO 三单匹配', 'PO 三單匹配', 'PO 3-Way Match');
        this.renderTabs();
        await this.loadCurrentTab();
    },

    renderTabs() {
        const tabs = [
            { k: 'grn',     label: APP_L('收货登记', '收貨登記', 'Goods Receipt') },
            { k: 'match',   label: APP_L('三单匹配', '三單匹配', 'Run Match') },
            { k: 'summary', label: APP_L('匹配汇总', '匹配匯總', 'Summary') },
        ];
        document.getElementById('pageContent').innerHTML = `
            <div class="page-header">
                <div class="tabs">
                    ${tabs.map(t => `<div class="tab-item ${this.tab===t.k?'active':''}" onclick="PoMatchPage.switchTab('${t.k}')">${t.label}</div>`).join('')}
                </div>
                <div class="page-actions">
                    ${this.tab==='grn' ? `<button class="btn btn-primary" onclick="PoMatchPage.openGrnForm()">+ ${APP_L('登记收货', '登記收貨', 'New GRN')}</button>` : ''}
                    ${this.tab==='match' ? `<button class="btn btn-primary" onclick="PoMatchPage.runMatch()">⚡ ${APP_L('执行匹配', '執行匹配', 'Run Match')}</button>` : ''}
                </div>
            </div>
            <div id="pmBody"></div>
        `;
        const tabsEl = document.querySelector('#pageContent .tabs');
        if (tabsEl && typeof bindTabs === 'function') bindTabs(tabsEl);
    },

    switchTab(t) { this.tab = t; this.renderTabs(); this.loadCurrentTab(); },

    async loadCurrentTab() {
        try {
            if (this.tab === 'grn') await this.loadGrnTab();
            else if (this.tab === 'match') await this.loadMatchTab();
            else if (this.tab === 'summary') await this.loadSummaryTab();
        } catch (e) {
            document.getElementById('pmBody').innerHTML = `<div style="padding:20px;color:#e74c3c;">${e.message}</div>`;
        }
    },

    // ======== Tab 1: 收货登记 ========
    async loadGrnTab() {
        const el = document.getElementById('pmBody');
        el.innerHTML = `<div style="padding:40px;text-align:center;color:#999;">⏳</div>`;

        // 并行拉 PO 下拉 + GRN 列表
        const [poRes, grnRes] = await Promise.all([
            API.get('/api/po-grn/po-options').catch(() => ({ data: [] })),
            API.get('/api/po-grn').catch(() => ({ data: [] })),
        ]);
        this.poOptions = poRes.data || [];
        this.grnList = grnRes.data || [];
        this.renderGrnTab();
    },

    renderGrnTab() {
        const el = document.getElementById('pmBody');
        if (!this.grnList.length) {
            el.innerHTML = `<div style="padding:30px;text-align:center;color:#999;">${APP_L('暂无收货登记，点击右上角"+登记收货"', '暫無收貨登記，點擊右上角"+登記收貨"', 'No GRN yet. Click "+ New GRN"')}</div>`;
            return;
        }
        const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table">
                <thead><tr>
                    <th>${APP_L('单号', '單號', 'PO No.')}</th>
                    <th>${APP_L('公司', '公司', 'BU')}</th>
                    <th>${APP_L('料件', '料件', 'Item')}</th>
                    <th>${APP_L('供应商', '供應商', 'Supplier')}</th>
                    <th style="text-align:right;">${APP_L('数量', '數量', 'Qty')}</th>
                    <th style="text-align:right;">${APP_L('单价', '單價', 'Price')}</th>
                    <th style="text-align:right;">${APP_L('金额', '金額', 'Amount')}</th>
                    <th>${APP_L('收货日期', '收貨日期', 'GRN Date')}</th>
                    <th>${APP_L('操作', '操作', 'Actions')}</th>
                </tr></thead>
                <tbody>
                ${this.grnList.map(g => `
                <tr>
                    <td><b>${esc(g.po_id)}</b></td>
                    <td>${esc(g.bu_no)}</td>
                    <td>${esc(g.xitems)}</td>
                    <td>${esc(g.supplier_name)}</td>
                    <td style="text-align:right;">${UI.fmt(g.grn_qty, 4)}</td>
                    <td style="text-align:right;">${UI.fmt(g.unit_price, 4)}</td>
                    <td style="text-align:right;color:#e74c3c;font-weight:600;">${UI.fmt(g.grn_amount)}</td>
                    <td>${esc(String(g.grn_date||'').slice(0,10))}</td>
                    <td>
                        <button class="btn btn-ghost" onclick="PoMatchPage.openGrnForm(${g.uid})">${APP_L('编辑','編輯','Edit')}</button>
                        <button class="btn btn-danger" onclick="PoMatchPage.delGrn(${g.uid})">${APP_L('删除','刪除','Del')}</button>
                    </td>
                </tr>`).join('')}
                </tbody>
            </table></div>
        `;
    },

    // 打开 GRN 表单（新增或编辑）
    async openGrnForm(uid) {
        const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
        let d = null;
        if (uid) {
            try { d = (await API.get(`/api/po-grn/${uid}`)).data; }
            catch(e) { return UI.toast(e.message, 'error'); }
        }
        // 确保 PO 下拉有数据（随顶部公司别切换重新载入）
        if (!this.poOptions.length || this._poBu !== State.bu_no) {
            try {
                const r = await API.get(`/api/po-grn/po-options?bu_no=${encodeURIComponent(State.bu_no || '')}`);
                this.poOptions = r.data || [];
                this._poBu = State.bu_no;
            } catch(e) {}
        }
        const form = d || { bu_no: State.bu_no || '', po_uid:'', xitems:'', supplier_name:'', unit_price:0, grn_qty:0, grn_amount:0, grn_date: new Date().toISOString().slice(0,10) };
        const poSel = `<option value="">${APP_L('请选择 PO','請選擇 PO','Select PO')}</option>` +
            this.poOptions.map(p => {
                const selected = form.po_uid == p.uid ? 'selected' : '';
                return `<option value="${p.uid}" data-bu="${esc(p.bu_no || State.bu_no || '')}" data-item="${esc(p.xitems||'')}" data-sup="${esc(p.supplier_name||'')}" data-price="${p.unit_price||p.unit_price_local||0}" ${selected}>${esc(p.po_id)} · ${esc(p.bu_no || State.bu_no || '')} · ${esc(p.xitems||'')} · ${UI.fmt(p.po_amount_local||p.amount||0)}</option>`;
            }).join('');

        UI.modal(
            uid ? APP_L('编辑收货单','編輯收貨單','Edit GRN') : APP_L('登记收货','登記收貨單','New GRN'),
            `
            <div class="form-grid">
                <div class="col-2">
                    <label>${APP_L('采购单 PO','採購單 PO','PO')} *</label>
                    <select id="f_po" class="form-input" onchange="PoMatchPage.onPoChange()">${poSel}</select>
                </div>
                <div><label>${APP_L('公司','公司','BU')}</label><input id="f_bu" class="form-input" readonly value="${esc(form.bu_no||'')}"></div>
                <div><label>${APP_L('料件','料件','Item')}</label><input id="f_item" class="form-input" readonly value="${esc(form.xitems||'')}"></div>
                <div><label>${APP_L('供应商','供應商','Supplier')}</label><input id="f_sup" class="form-input" readonly value="${esc(form.supplier_name||'')}"></div>
                <div><label>${APP_L('收货日期','收貨日期','GRN Date')} *</label><input id="f_date" type="date" class="form-input" value="${esc(form.grn_date||'')}"></div>
                <div><label>${APP_L('数量','數量','Qty')} *</label><input id="f_qty" type="number" step="0.0001" class="form-input" value="${form.grn_qty||''}" oninput="PoMatchPage.recalcAmt()"></div>
                <div><label>${APP_L('单价','單價','Unit Price')} *</label><input id="f_price" type="number" step="0.0001" class="form-input" value="${form.unit_price||''}" oninput="PoMatchPage.recalcAmt()"></div>
                <div><label>${APP_L('金额','金額','Amount')}</label><input id="f_amt" type="number" step="0.01" class="form-input" value="${form.grn_amount||''}" readonly style="background:#f5f5f5;"></div>
            </div>
            `,
            `<button class="btn btn-ghost" onclick="UI.closeModal()">${APP_L('取消','取消','Cancel')}</button>
             <button class="btn btn-primary" onclick="PoMatchPage.saveGrn(${uid||0})">${APP_L('保存','保存','Save')}</button>`
        );
        if (form.po_uid) this._poChanged = true; // 编辑模式不触发 change
    },

    // PO 下拉联动 → 自动带出 bu_no/xitems/supplier/unit_price
    onPoChange() {
        if (this._poChanged) { this._poChanged = false; return; }
        const sel = document.getElementById('f_po');
        const opt = sel.selectedOptions[0];
        if (!opt || !opt.value) return;
        document.getElementById('f_bu').value = opt.dataset.bu || State.bu_no || '';
        document.getElementById('f_item').value = opt.dataset.item || '';
        document.getElementById('f_sup').value = opt.dataset.sup || '';
        const price = Number(opt.dataset.price) || 0;
        document.getElementById('f_price').value = price;
        this.recalcAmt();
    },

    recalcAmt() {
        const qty = Number(document.getElementById('f_qty').value) || 0;
        const price = Number(document.getElementById('f_price').value) || 0;
        document.getElementById('f_amt').value = (qty * price).toFixed(2);
    },

    async saveGrn(uid) {
        const f = (id) => document.getElementById(id);
        const poSel = f('f_po');
        const poOpt = poSel.selectedOptions[0];
        if (!poSel.value) return UI.toast(APP_L('请选择 PO','請選擇 PO','Select PO first'), 'error');
        const qty = Number(f('f_qty').value);
        const price = Number(f('f_price').value);
        if (!qty || qty <= 0) return UI.toast(APP_L('数量必须大于 0','數量必須大於 0','Qty > 0 required'), 'error');
        const body = {
            po_uid: Number(poSel.value),
            po_id: poOpt.textContent.split('·')[0].trim(),
            bu_no: f('f_bu').value,
            xitems: f('f_item').value,
            supplier_name: f('f_sup').value,
            grn_date: f('f_date').value,
            grn_qty: qty,
            unit_price: price,
            grn_amount: Number(f('f_amt').value) || qty * price,
        };
        try {
            const res = uid ? await API.put(`/api/po-grn/${uid}`, body) : await API.post('/api/po-grn', body);
            UI.toast(res.message || APP_L('已保存','已保存','Saved'), 'success');
            UI.closeModal();
            await this.loadGrnTab();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async delGrn(uid) {
        if (!confirm(APP_L('确认删除收货单？','確認刪除收貨單？','Delete GRN?'))) return;
        try { await API.del(`/api/po-grn/${uid}`); UI.toast(APP_L('已删除','已刪除','Deleted'), 'success'); await this.loadGrnTab(); }
        catch (e) { UI.toast(e.message, 'error'); }
    },

    // ======== Tab 2: 三单匹配 ========
    async loadMatchTab() {
        const el = document.getElementById('pmBody');
        // 默认用本月
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
                <button class="btn btn-ghost" onclick="PoMatchPage.searchMatch()">${APP_L('查询','查詢','Query')}</button>
                <span style="color:#999;">${APP_L('先"执行匹配"生成结果，再查询','先"執行匹配"生成結果，再查詢','Click "Run Match" first')}</span>
            </div>
        `;
        await this.queryMatchResults();
    },

    async runMatch() {
        const f = (id) => document.getElementById(id);
        const month = f('m_month').value;
        const bu = f('m_bu').value;
        if (!month) return UI.toast(APP_L('请选择月份','請選擇月份','Select month'), 'error');
        try {
            UI.toast(APP_L('匹配中…','匹配中…','Matching…'), 'info');
            const res = await API.post('/api/po-match/run', { YYYY_MM: month, bu_no: bu });
            UI.toast(APP_L('匹配完成','匹配完成','Done'), 'success');
            this.matchMonth = month;
            this.matchBU = bu;
            await this.queryMatchResults();
            // 刷新汇总缓存
            try { this.summaryData = (await API.get(`/api/po-match/summary?YYYY_MM=${month}`)).data; } catch(e){}
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    searchMatch() {
        const f = (id) => document.getElementById(id);
        this.matchMonth = f('m_month').value;
        this.matchBU = f('m_bu').value;
        this.queryMatchResults();
    },

    async queryMatchResults() {
        const el = document.getElementById('pmBody');
        el.innerHTML += `<div id="m_list" style="margin-top:12px;"></div>`;
        const list = document.getElementById('m_list');
        list.innerHTML = `<div style="padding:40px;text-align:center;color:#999;">⏳</div>`;

        const qs = new URLSearchParams({});
        if (this.matchMonth) qs.set('YYYY_MM', this.matchMonth);
        if (this.matchBU) qs.set('bu_no', this.matchBU);
        try {
            const res = await API.get(`/api/po-match/results?${qs.toString()}`);
            this.matchRows = res.data || [];
            this.renderMatchList();
        } catch (e) {
            list.innerHTML = `<div style="padding:20px;color:#e74c3c;">${e.message}</div>`;
        }
    },

    renderMatchList() {
        const list = document.getElementById('m_list');
        const rows = this.matchRows;
        if (!rows.length) {
            list.innerHTML = `<div style="padding:30px;text-align:center;color:#999;">${APP_L('暂无匹配结果，请先"执行匹配"','暫無匹配結果，請先"執行匹配"','No results yet. Click Run Match.')}</div>`;
            return;
        }
        const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
        const statusMap = {
            MATCHED:   { label: APP_L('已匹配','已匹配','Matched'),        cls: 'bg-success' },
            UNMATCHED: { label: APP_L('未匹配','未匹配','Unmatched'),      cls: 'bg-warning' },
            EXCESS:    { label: APP_L('发票过量','發票過量','Excess Inv'), cls: 'bg-info' },
            NO_GRN:    { label: APP_L('缺收货单','缺收貨單','No GRN'),     cls: 'bg-danger' },
            DIFF_QTY:  { label: APP_L('数量差异','數量差異','Diff Qty'),   cls: 'bg-danger' },
            DIFF_AMT:  { label: APP_L('金额差异','金額差異','Diff Amt'),   cls: 'bg-danger' },
            PARTIAL:   { label: APP_L('部分匹配','部分匹配','Partial'),    cls: 'bg-danger' },
        };
        const handleMap = {
            PENDING:  { label: APP_L('待处理','待處理','Pending'),  cls: 'bg-warning' },
            HOLD:     { label: APP_L('挂起','掛起','Hold'),        cls: 'bg-info' },
            ACCEPTED: { label: APP_L('接受差异','接受差異','Accepted'), cls: 'bg-success' },
            REJECTED: { label: APP_L('已退回','已退回','Rejected'), cls: 'bg-danger' },
        };
        list.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table">
                <thead><tr>
                    <th>${APP_L('PO 号','PO 號','PO No.')}</th>
                    <th>${APP_L('料件','料件','Item')}</th>
                    <th>${APP_L('公司','公司','BU')}</th>
                    <th>${APP_L('供应商','供應商','Supplier')}</th>
                    <th>${APP_L('发票号','發票號','Invoice No.')}</th>
                    <th style="text-align:right;">${APP_L('PO 金额','PO 金額','PO Amt')}</th>
                    <th style="text-align:right;">${APP_L('GRN 金额','GRN 金額','GRN Amt')}</th>
                    <th style="text-align:right;">${APP_L('发票金额','發票金額','Inv Amt')}</th>
                    <th style="text-align:right;">${APP_L('差异率','差異率','Diff %')}</th>
                    <th>${APP_L('匹配状态','匹配狀態','Match')}</th>
                    <th>${APP_L('处置','處置','Handling')}</th>
                    <th>${APP_L('操作','操作','Actions')}</th>
                </tr></thead>
                <tbody>
                ${rows.map(r => {
                    const st = statusMap[r.match_status] || { label: r.match_status, cls: '' };
                    const hd = handleMap[r.handle_status || 'PENDING'] || { label: r.handle_status, cls: '' };
                    const rate = Number(r.diff_rate || 0);
                    return `
                <tr>
                    <td><b>${esc(r.po_id)}</b></td>
                    <td>${esc(r.xitems)}</td>
                    <td>${esc(r.bu_no)}</td>
                    <td>${esc(r.supplier_name)}</td>
                    <td>${esc(r.invoice_no)}</td>
                    <td style="text-align:right;">${UI.fmt(r.po_amount)}</td>
                    <td style="text-align:right;">${UI.fmt(r.grn_amount)}</td>
                    <td style="text-align:right;">${UI.fmt(r.invoice_amount)}</td>
                    <td style="text-align:right;color:${Math.abs(rate) > 5 ? '#c0392b' : '#666'}">${rate ? rate.toFixed(2) + '%' : '-'}</td>
                    <td><span class="badge ${st.cls}">${st.label}</span>${r.ap_settled?'<span class="badge bg-info" style="margin-left:4px;">'+APP_L('已核销','已核銷','Settled')+'</span>':''}</td>
                    <td><span class="badge ${hd.cls}">${hd.label}</span>${r.handle_reason ? `<div style="font-size:11px;color:#888;max-width:160px;">${esc(r.handle_reason)}</div>` : ''}</td>
                    <td>
                        ${r.match_status==='MATCHED' && !r.ap_settled ? `<button class="btn btn-primary" onclick="PoMatchPage.settle(${r.id})">💳 ${APP_L('生成应付款','生成應付款','Gen Pay')}</button>` : ''}
                        ${!r.ap_settled && r.match_status!=='MATCHED' ? `<button class="btn btn-ghost" onclick="PoMatchPage.handle(${r.id}, '${r.match_status}', '${esc(r.supplier_name)}')">${APP_L('差异处置','差異處置','Handle')}</button>` : ''}
                        ${!r.ap_settled ? `<button class="btn btn-ghost" onclick="PoMatchPage.confirmManual(${r.id})">${APP_L('手动确认','手動確認','Manual')}</button>` : ''}
                    </td>
                </tr>`;
                }).join('')}
                </tbody>
            </table></div>
            <div style="margin-top:12px;color:#888;font-size:12px;">
                ${APP_L('容差：数量 0.001，金额 0.02 或差异率 5%；发票无数量字段时以金额为主要判据','容差：數量 0.001，金額 0.02 或差異率 5%；發票無數量欄位時以金額為主要判據','Tol: qty 0.001, amt 0.02 or rate 5%; amount is primary when invoice has no qty')}
            </div>
        `;
    },

    // 差异处置：挂起 / 接受差异 / 退回
    async handle(id, matchStatus, supplier) {
        const reason = prompt(
            APP_L(
                `请填写处置原因（记录 ${matchStatus} / ${supplier || ''}）：\n输入后选择处置方式`,
                `請填寫處置原因（記錄 ${matchStatus} / ${supplier || ''}）：`,
                `Enter handling reason for ${matchStatus} / ${supplier || ''}:`
            )
        );
        if (reason === null) return;
        const val = (reason || '').trim();
        if (!val) return UI.toast(APP_L('请填写处置原因','請填寫處置原因','Reason required'), 'error');

        const choice = prompt(
            APP_L('处置方式：1=挂起  2=接受差异  3=退回处理','處置方式：1=掛起  2=接受差異  3=退回處理','Action: 1=Hold 2=Accept 3=Reject'),
            '1'
        );
        if (choice === null) return;
        const map = { '1': 'HOLD', '2': 'ACCEPTED', '3': 'REJECTED' };
        const handle_status = map[String(choice).trim()];
        if (!handle_status) return UI.toast(APP_L('处置方式无效','處置方式無效','Invalid action'), 'error');

        try {
            await API.post(`/api/po-match/results/${id}/handle`, { handle_status, reason: val });
            UI.toast(APP_L('处置已保存','處置已保存','Saved'), 'success');
            await this.queryMatchResults();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async confirmManual(id) {
        const options = [
            ['MATCHED',   APP_L('标记为已匹配','標記為已匹配','Mark Matched')],
            ['UNMATCHED', APP_L('标记为未匹配','標記為未匹配','Mark Unmatched')],
            ['EXCESS',    APP_L('标记为发票过量','標記為發票過量','Mark Excess')],
        ];
        const pick = prompt(APP_L('输入状态代码','輸入狀態代碼','Enter status code') + ':\n' + options.map(o => `${o[0]} - ${o[1]}`).join('\n'), 'MATCHED');
        if (!pick) return;
        try {
            const res = await API.post(`/api/po-match/results/${id}/confirm`, { match_status: pick });
            UI.toast(res.message || APP_L('已更新','已更新','Updated'), 'success');
            await this.queryMatchResults();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async settle(id) {
        if (!confirm(APP_L('确认生成应付款（pay_detail）？','確認生成應付款（pay_detail）？','Generate payable (pay_detail)?'))) return;
        try {
            const res = await API.post(`/api/po-match/results/${id}/settle`, {});
            UI.toast(res.message || APP_L('已生成','已生成','Done'), 'success');
            await this.queryMatchResults();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ======== Tab 3: 匹配汇总 ========
    async loadSummaryTab() {
        const el = document.getElementById('pmBody');
        el.innerHTML = `
            <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap;">
                <label>${APP_L('月份','月份','YYYY-MM')}</label>
                <input id="s_month" type="month" class="form-input" value="${this.matchMonth}" style="width:140px;" onchange="PoMatchPage.loadSummaryTab()">
            </div>
        `;
        const month = document.getElementById('s_month').value || this.matchMonth;
        if (month) this.matchMonth = month;
        try {
            const res = await API.get(`/api/po-match/summary${month?`?YYYY_MM=${month}`:''}`);
            this.summaryData = res.data || { by_status: [], overall: {} };
            this.renderSummary();
        } catch (e) {
            el.innerHTML += `<div style="padding:20px;color:#e74c3c;">${e.message}</div>`;
        }
    },

    renderSummary() {
        const el = document.getElementById('pmBody');
        const { by_status = [], overall = {} } = this.summaryData;
        const statusColors = { MATCHED:'#27ae60', UNMATCHED:'#f39c12', EXCESS:'#3498db', DIFF_QTY:'#c0392b', DIFF_AMT:'#c0392b', PARTIAL:'#c0392b' };
        const statusLabels = {
            MATCHED: APP_L('已匹配','已匹配','Matched'),
            UNMATCHED: APP_L('未匹配','未匹配','Unmatched'),
            EXCESS: APP_L('发票过量','發票過量','Excess Inv'),
            DIFF_QTY: APP_L('数量差异','數量差異','Diff Qty'),
            DIFF_AMT: APP_L('金额差异','金額差異','Diff Amt'),
            PARTIAL: APP_L('部分匹配','部分匹配','Partial'),
        };
        const cards = by_status.map(s => `
            <div class="card" style="flex:1;min-width:180px;border-left:4px solid ${statusColors[s.match_status]||'#999'};">
                <div style="color:#888;font-size:12px;">${statusLabels[s.match_status]||s.match_status}</div>
                <div style="font-size:28px;font-weight:700;color:${statusColors[s.match_status]||'#333'};">${s.cnt || 0}</div>
                <div style="color:#555;font-size:13px;">
                    ${APP_L('PO','PO','PO')} ${UI.fmt(s.po_total)} ·
                    ${APP_L('GRN','GRN','GRN')} ${UI.fmt(s.grn_total)} ·
                    ${APP_L('發票','發票','INV')} ${UI.fmt(s.inv_total)}
                </div>
            </div>
        `).join('') || `<div style="padding:30px;text-align:center;color:#999;">${APP_L('暂无数据','暫無資料','No data')}</div>`;

        el.innerHTML += `
            <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px;">
                ${cards}
            </div>
            <div class="card" style="padding:20px;">
                <h4 style="margin:0 0 16px 0;">${APP_L('合计','合計','Overall')}</h4>
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;">
                    <div>
                        <div style="color:#888;font-size:12px;">${APP_L('总单数','總單數','Total')}</div>
                        <div style="font-size:22px;font-weight:700;">${overall.total || 0}</div>
                    </div>
                    <div>
                        <div style="color:#888;font-size:12px;">${APP_L('已匹配','已匹配','Matched')}</div>
                        <div style="font-size:22px;font-weight:700;color:#27ae60;">${overall.matched || 0}</div>
                    </div>
                    <div>
                        <div style="color:#888;font-size:12px;">${APP_L('PO 总额','PO 總額','PO Total')}</div>
                        <div style="font-size:22px;font-weight:700;color:#e74c3c;">${UI.fmt(overall.po_amt || 0)}</div>
                    </div>
                    <div>
                        <div style="color:#888;font-size:12px;">${APP_L('发票总额','發票總額','Inv Total')}</div>
                        <div style="font-size:22px;font-weight:700;color:#e74c3c;">${UI.fmt(overall.inv_amt || 0)}</div>
                    </div>
                </div>
            </div>
        `;
    },
};

registerPage('poMatch', () => PoMatchPage.load());
