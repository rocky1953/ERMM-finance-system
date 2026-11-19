/**
 * 财务入账 / 报税 / 勾稽对账
 * 对应 docs/财务核心业务流程图.md
 */
const FIN_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] ?? zh);

registerPage('finance', async (c) => {
    const _bu = await CodeHelper.buSel();
    Finance._bu = _bu;
    c.innerHTML = `
        <div class="card" style="padding:16px;">
            <div style="display:flex;gap:8px;margin-bottom:14px;border-bottom:2px solid #eee;">
                <button class="tab-btn active" data-tab="voucher" onclick="Finance.switchTab('voucher')">📒 ${FIN_L('会计入账', '會計入帳', 'Accounting Entries')}</button>
                <button class="tab-btn" data-tab="tax" onclick="Finance.switchTab('tax')">🧾 ${FIN_L('报税申报', '報稅申報', 'Tax Filing')}</button>
                <button class="tab-btn" data-tab="recon" onclick="Finance.switchTab('recon')">🔗 ${FIN_L('勾稽对账', '勾稽對帳', 'Reconciliation')}</button>
            </div>
            <div id="financeBody">${FIN_L('载入中…', '載入中…', 'Loading…')}</div>
        </div>
    `;
    Finance.tab = 'voucher';
    Finance.subjects = (await API.get('/api/finance/subjects')).data || [];
    Finance.render();
});

window.Finance = {
    tab: 'voucher',
    subjects: [],

    switchTab(t) {
        this.tab = t;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
        this.render();
    },

    async render() {
        const el = document.getElementById('financeBody');
        if (this.tab === 'voucher') return this.renderVouchers(el);
        if (this.tab === 'tax') return this.renderTax(el);
        return this.renderRecon(el);
    },

    // ============ 会计入账 ============
    async renderVouchers(el) {
        el.innerHTML = `
            <div class="toolbar" style="gap:8px;margin-bottom:10px;">
                <label>${FIN_L('BU：', 'BU：', 'BU: ')}<select id="fvBU">${this._bu||''}</select></label>
                <label>${FIN_L('期间：', '期間：', 'Period: ')}<input type="month" id="fvYM"></label>
                <label>${FIN_L('状态：', '狀態：', 'Status: ')}<select id="fvStatus"><option value="">${FIN_L('全部', '全部', 'All')}</option>
                    <option>DRAFT</option><option>SUBMITTED</option><option>APPROVED</option><option>REJECTED</option><option>POSTED</option></select></label>
                <button class="btn btn-primary" onclick="Finance.openVoucherForm()">➕ ${FIN_L('新增凭证', '新增憑證', 'New Voucher')}</button>
                <button class="btn btn-success" onclick="Finance.renderVouchers(document.getElementById('financeBody'))">🔄</button>
            </div>
            <div id="fvList">${FIN_L('载入中…', '載入中…', 'Loading…')}</div>
        `;
        document.getElementById('fvBU').value = State.bu_no;
        const ym = State.YYYY_MM || new Date().toISOString().slice(0, 7);
        document.getElementById('fvYM').value = ym;
        ['fvBU', 'fvYM', 'fvStatus'].forEach(id => document.getElementById(id).onchange = () => this.loadVouchers());
        this.loadVouchers();
    },

    async loadVouchers() {
        const el = document.getElementById('fvList');
        const bu = document.getElementById('fvBU').value;
        const ym = document.getElementById('fvYM').value;
        const st = document.getElementById('fvStatus').value;
        try {
            const res = await API.get(`/api/finance/vouchers?bu_no=${bu}&YYYY_MM=${ym}&status=${st}`);
            const rows = res.data || [];
            if (!rows.length) { el.innerHTML = `<p style="color:#95a5a6;padding:30px;text-align:center;">📒 ${FIN_L('尚无凭证', '尚無憑證', 'No vouchers yet')}</p>`; return; }
            const statusBadge = s => ({DRAFT:'#95a5a6',SUBMITTED:'#f39c12',APPROVED:'#3498db',REJECTED:'#e74c3c',POSTED:'#27ae60'}[s]||'#999');
            el.innerHTML = `<table class="data-table">
                <thead><tr><th>${FIN_L('凭证号', '憑證號', 'Voucher No.')}</th><th>RUID</th><th>${FIN_L('日期', '日期', 'Date')}</th><th>${FIN_L('摘要', '摘要', 'Summary')}</th><th>${FIN_L('借方', '借方', 'Debit')}</th><th>${FIN_L('贷方', '貸方', 'Credit')}</th><th>${FIN_L('状态', '狀態', 'Status')}</th><th>${FIN_L('操作', '操作', 'Actions')}</th></tr></thead>
                <tbody>${rows.map(r => `<tr>
                    <td>${esc(r.voucher_no)}</td>
                    <td style="font-size:12px;color:#888;">${esc(r.ruid)}</td>
                    <td>${r.voucher_date}</td>
                    <td>${esc(r.summary||'')}</td>
                    <td style="text-align:right;">${UI.fmt(r.total_debit,2)}</td>
                    <td style="text-align:right;">${UI.fmt(r.total_credit,2)}</td>
                    <td><span style="background:${statusBadge(r.status)};color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;">${r.status}</span></td>
                    <td>${this.voucherActions(r)}</td>
                </tr>`).join('')}</tbody></table>`;
        } catch (e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
    },

    voucherActions(r) {
        const btns = [`<button class="btn btn-sm btn-outline" onclick="Finance.viewVoucher(${r.voucher_id})">${FIN_L('检视', '檢視', 'View')}</button>`];
        if (r.status === 'DRAFT' || r.status === 'REJECTED')
            btns.push(`<button class="btn btn-sm btn-primary" onclick="Finance.actVoucher(${r.voucher_id},'submit')">${FIN_L('提交', '提交', 'Submit')}</button>`);
        if (r.status === 'SUBMITTED') {
            btns.push(`<button class="btn btn-sm btn-success" onclick="Finance.actVoucher(${r.voucher_id},'approve')">${FIN_L('通过', '通過', 'Approve')}</button>`);
            btns.push(`<button class="btn btn-sm btn-outline" onclick="Finance.rejectVoucher(${r.voucher_id})">${FIN_L('驳回', '駁回', 'Reject')}</button>`);
        }
        if (r.status === 'APPROVED')
            btns.push(`<button class="btn btn-sm btn-success" onclick="Finance.actVoucher(${r.voucher_id},'post')">${FIN_L('过帐', '過帳', 'Post')}</button>`);
        return btns.join(' ');
    },

    async viewVoucher(id) {
        try {
            const r = (await API.get(`/api/finance/vouchers/${id}`)).data;
            const entries = r.entries || [];
            UI.modal(`${FIN_L('凭证', '憑證', 'Voucher')} ${r.voucher_no}`,
                `<div style="min-width:820px;">
                    <div style="margin-bottom:8px;"><b>${FIN_L('RUID：', 'RUID：', 'RUID: ')}</b>${esc(r.ruid)} ｜ <b>${FIN_L('期间：', '期間：', 'Period: ')}</b>${esc(r.YYYY_MM)} ｜ <b>${FIN_L('状态：', '狀態：', 'Status: ')}</b>${r.status}</div>
                    <div style="margin-bottom:8px;"><b>${FIN_L('摘要：', '摘要：', 'Summary: ')}</b>${esc(r.summary||'')}</div>
                    <table class="data-table" style="width:100%;table-layout:auto;"><thead><tr><th style="width:30%;">${FIN_L('科目', '科目', 'Subject')}</th><th style="width:18%;">${FIN_L('借方', '借方', 'Debit')}</th><th style="width:18%;">${FIN_L('贷方', '貸方', 'Credit')}</th><th>${FIN_L('摘要', '摘要', 'Summary')}</th></tr></thead>
                    <tbody>${entries.map(e => `<tr><td>${esc(e.subject_name||e.subject_code)}</td><td style="text-align:right;">${UI.fmt(e.debit,2)}</td><td style="text-align:right;">${UI.fmt(e.credit,2)}</td><td>${esc(e.summary||'')}</td></tr>`).join('')}</tbody></table>
                    <div style="margin-top:8px;text-align:right;font-weight:600;">${FIN_L('合计：借', '合計：借', 'Total: Dr')} ${UI.fmt(r.total_debit,2)} / ${FIN_L('贷', '貸', 'Cr')} ${UI.fmt(r.total_credit,2)}</div>
                </div>`,
                `<button class="btn btn-outline" onclick="UI.closeModal()">${FIN_L('关闭', '關閉', 'Close')}</button>`);
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    openVoucherForm() {
        const bu = document.getElementById('fvBU')?.value || State.bu_no;
        const ym = document.getElementById('fvYM')?.value || State.YYYY_MM;
        this._vDraft = { bu_no: bu, voucher_date: new Date().toISOString().slice(0, 10), YYYY_MM: ym, summary: '', entries: [
            { subject_code: '', debit: 0, credit: 0, summary: '' },
            { subject_code: '', debit: 0, credit: 0, summary: '' }
        ]};
        this.renderVoucherForm();
    },

    renderVoucherForm() {
        const d = this._vDraft;
        const opts = this.subjects.map(s => `<option value="${s.subject_code}">${s.subject_code} ${s.subject_name}</option>`).join('');
        UI.modal(FIN_L('新增会计凭证', '新增會計憑證', 'New Accounting Voucher'),
            `<div style="min-width:680px;">
                <div style="display:grid;grid-template-columns:1fr 1fr 2fr;gap:10px;margin-bottom:10px;">
                    <div><label style="font-size:12px;">BU</label><input id="vf_bu" class="form-control" value="${d.bu_no}" readonly></div>
                    <div><label style="font-size:12px;">${FIN_L('日期', '日期', 'Date')}</label><input id="vf_date" type="date" class="form-control" value="${d.voucher_date}"></div>
                    <div><label style="font-size:12px;">${FIN_L('摘要', '摘要', 'Summary')}</label><input id="vf_summary" class="form-control" value="${esc(d.summary)}" placeholder="${FIN_L('业务摘要', '業務摘要', 'Business summary')}"></div>
                </div>
                <table class="data-table" id="vfEntries">
                    <thead><tr><th>${FIN_L('科目', '科目', 'Subject')}</th><th>${FIN_L('借方', '借方', 'Debit')}</th><th>${FIN_L('贷方', '貸方', 'Credit')}</th><th>${FIN_L('摘要', '摘要', 'Summary')}</th><th></th></tr></thead>
                    <tbody>${d.entries.map((e, i) => `<tr>
                        <td><select class="form-control" onchange="Finance.setEntry(${i},'subject_code',this.value)">
                            <option value="">${FIN_L('请选择', '請選擇', 'Select')}</option>${opts.replace(`value="${e.subject_code}"`,`value="${e.subject_code}" selected`)}</select></td>
                        <td><input type="number" step="0.01" class="form-control" value="${e.debit||''}" onchange="Finance.setEntry(${i},'debit',this.value)"></td>
                        <td><input type="number" step="0.01" class="form-control" value="${e.credit||''}" onchange="Finance.setEntry(${i},'credit',this.value)"></td>
                        <td><input class="form-control" value="${esc(e.summary||'')}" onchange="Finance.setEntry(${i},'summary',this.value)"></td>
                        <td><button class="btn btn-sm btn-outline" onclick="Finance.delEntry(${i})">${FIN_L('删', '刪', 'Del')}</button></td>
                    </tr>`).join('')}</tbody>
                </table>
                <div style="margin-top:8px;display:flex;gap:10px;">
                    <button class="btn btn-outline" onclick="Finance.addEntry()">➕ ${FIN_L('增列', '增列', 'Add Row')}</button>
                    <span style="margin-left:auto;font-weight:600;">${FIN_L('借贷差额：', '借貸差額：', 'Dr-Cr Difference: ')}<span id="vfDiff" style="color:#e74c3c;">0.00</span></span>
                </div>
            </div>`,
            `<button class="btn btn-outline" onclick="UI.closeModal()">${FIN_L('取消', '取消', 'Cancel')}</button>
             <button class="btn btn-primary" onclick="Finance.saveVoucher()">${FIN_L('储存草稿', '儲存草稿', 'Save Draft')}</button>`);
        this.calcDiff();
    },

    setEntry(i, k, v) { this._vDraft.entries[i][k] = k === 'summary' ? v : (k === 'subject_code' ? v : Number(v)); this.calcDiff(); },
    addEntry() { this._vDraft.entries.push({ subject_code: '', debit: 0, credit: 0, summary: '' }); this.renderVoucherForm(); },
    delEntry(i) { if (this._vDraft.entries.length <= 2) { UI.toast(FIN_L('至少保留 2 条分录', '至少保留 2 條分錄', 'At least 2 entries required'), 'error'); return; } this._vDraft.entries.splice(i, 1); this.renderVoucherForm(); },

    calcDiff() {
        const d = this._vDraft.entries;
        const td = d.reduce((s, e) => s + Number(e.debit || 0), 0);
        const tc = d.reduce((s, e) => s + Number(e.credit || 0), 0);
        const el = document.getElementById('vfDiff');
        if (el) { el.textContent = (td - tc).toFixed(2); el.style.color = Math.abs(td - tc) < 0.01 ? '#27ae60' : '#e74c3c'; }
    },

    async saveVoucher() {
        const d = this._vDraft;
        d.bu_no = document.getElementById('vf_bu').value;
        d.voucher_date = document.getElementById('vf_date').value;
        d.summary = document.getElementById('vf_summary').value;
        d.YYYY_MM = d.voucher_date.slice(0, 7);
        const valid = d.entries.filter(e => e.subject_code && (Number(e.debit) || Number(e.credit)));
        if (valid.length < 2) { UI.toast(FIN_L('至少 2 条有效分录', '至少 2 條有效分錄', 'At least 2 valid entries required'), 'error'); return; }
        d.entries = valid;
        const td = d.entries.reduce((s, e) => s + Number(e.debit || 0), 0);
        const tc = d.entries.reduce((s, e) => s + Number(e.credit || 0), 0);
        if (Math.abs(td - tc) > 0.01) { UI.toast(`${FIN_L('借贷不平衡：差', '借貸不平衡：差', 'Debit/Credit unbalanced, diff: ')} ${(td-tc).toFixed(2)}`, 'error'); return; }
        try {
            await API.post('/api/finance/vouchers', d);
            UI.toast(FIN_L('凭证已建立', '憑證已建立', 'Voucher created'), 'success');
            UI.closeModal();
            this.loadVouchers();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async actVoucher(id, act) {
        try {
            await API.post(`/api/finance/vouchers/${id}/${act}`);
            UI.toast(FIN_L('操作成功', '操作成功', 'Success'), 'success');
            this.loadVouchers();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async rejectVoucher(id) {
        const reason = prompt(FIN_L('驳回原因：', '駁回原因：', 'Rejection reason: '));
        if (reason == null) return;
        try {
            await API.post(`/api/finance/vouchers/${id}/reject`, { reason });
            UI.toast(FIN_L('已驳回', '已駁回', 'Rejected'), 'success');
            this.loadVouchers();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ============ 报税 ============
    async renderTax(el) {
        el.innerHTML = `
            <div class="toolbar" style="gap:8px;margin-bottom:10px;">
                <label>${FIN_L('BU：', 'BU：', 'BU: ')}<select id="ftBU">${this._bu||''}</select></label>
                <label>${FIN_L('期间：', '期間：', 'Period: ')}<input type="month" id="ftYM"></label>
                <label>${FIN_L('税种：', '稅種：', 'Tax Type: ')}<select id="ftType"><option value="">${FIN_L('全部', '全部', 'All')}</option>
                    <option value="VAT">${FIN_L('增值税', '增值稅', 'VAT')}</option><option value="IT">${FIN_L('企业所得税', '企業所得稅', 'CIT')}</option><option value="ST">${FIN_L('印花税', '印花稅', 'Stamp Duty')}</option></select></label>
                <button class="btn btn-primary" onclick="Finance.openTaxForm()">➕ ${FIN_L('新增申报', '新增申報', 'New Filing')}</button>
                <button class="btn btn-warning" onclick="Finance.genTaxDetail()">📊 ${FIN_L('生成报税明细表', '生成報稅明細表', 'Generate Tax Detail')}</button>
                <button class="btn btn-success" onclick="Finance.renderTax(document.getElementById('financeBody'))">🔄</button>
            </div>
            <div id="ftList">${FIN_L('载入中…', '載入中…', 'Loading…')}</div>
        `;
        document.getElementById('ftBU').value = State.bu_no;
        document.getElementById('ftYM').value = State.YYYY_MM || new Date().toISOString().slice(0, 7);
        ['ftBU', 'ftYM', 'ftType'].forEach(id => document.getElementById(id).onchange = () => this.loadTax());
        this.loadTax();
    },

    async loadTax() {
        const el = document.getElementById('ftList');
        const bu = document.getElementById('ftBU').value;
        const ym = document.getElementById('ftYM').value;
        const tp = document.getElementById('ftType').value;
        try {
            const res = await API.get(`/api/finance/tax-returns?bu_no=${bu}&tax_period=${ym}&tax_type=${tp}`);
            const rows = res.data || [];
            const nameMap = { VAT: FIN_L('增值税', '增值稅', 'VAT'), IT: FIN_L('企业所得税', '企業所得稅', 'CIT'), ST: FIN_L('印花税', '印花稅', 'Stamp Duty') };
            const badge = s => ({DRAFT:'#95a5a6',CALCULATED:'#3498db',APPROVED:'#f39c12',FILED:'#27ae60',REJECTED:'#e74c3c'}[s]||'#999');
            if (!rows.length) { el.innerHTML = `<p style="color:#95a5a6;padding:30px;text-align:center;">🧾 ${FIN_L('尚无申报表', '尚無申報表', 'No tax returns yet')}</p>`; return; }
            el.innerHTML = `<table class="data-table">
                <thead><tr><th>${FIN_L('税种', '稅種', 'Tax Type')}</th><th>${FIN_L('期间', '期間', 'Period')}</th><th>RUID</th><th>${FIN_L('应税金额', '應稅金額', 'Taxable Amount')}</th><th>${FIN_L('税额', '稅額', 'Tax')}</th><th>${FIN_L('状态', '狀態', 'Status')}</th><th>${FIN_L('回执号', '回執號', 'Receipt No.')}</th><th>${FIN_L('操作', '操作', 'Actions')}</th></tr></thead>
                <tbody>${rows.map(r => `<tr>
                    <td>${nameMap[r.tax_type]||r.tax_type}</td>
                    <td>${r.tax_period}</td>
                    <td style="font-size:12px;color:#888;">${esc(r.ruid)}</td>
                    <td style="text-align:right;">${UI.fmt(r.taxable_amount,2)}</td>
                    <td style="text-align:right;font-weight:600;">${UI.fmt(r.tax_amount,2)}</td>
                    <td><span style="background:${badge(r.status)};color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;">${r.status}</span></td>
                    <td>${esc(r.receipt_no||'')}</td>
                    <td>${this.taxActions(r)}</td>
                </tr>`).join('')}</tbody></table>`;
        } catch (e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
    },

    taxActions(r) {
        const b = [`<button class="btn btn-sm btn-outline" onclick="Finance.viewTax(${r.return_id})">${FIN_L('检视', '檢視', 'View')}</button>`];
        if (r.status === 'CALCULATED') b.push(`<button class="btn btn-sm btn-success" onclick="Finance.actTax(${r.return_id},'approve')">${FIN_L('审核', '審核', 'Approve')}</button>`);
        if (r.status === 'APPROVED') b.push(`<button class="btn btn-sm btn-primary" onclick="Finance.actTax(${r.return_id},'file')">${FIN_L('申报', '申報', 'File')}</button>`);
        return b.join(' ');
    },

    async viewTax(id) {
        try {
            const r = (await API.get(`/api/finance/tax-returns/${id}`)).data;
            UI.modal(`${FIN_L('申报表', '申報表', 'Tax Return')} ${r.tax_name} ${r.tax_period}`,
                `<div style="min-width:500px;">
                    <div style="margin-bottom:6px;"><b>${FIN_L('RUID：', 'RUID：', 'RUID: ')}</b>${esc(r.ruid)}</div>
                    <div style="margin-bottom:6px;"><b>${FIN_L('税种：', '稅種：', 'Tax Type: ')}</b>${r.tax_name} ｜ <b>${FIN_L('期间：', '期間：', 'Period: ')}</b>${r.tax_period} ｜ <b>${FIN_L('状态：', '狀態：', 'Status: ')}</b>${r.status}</div>
                    <table class="data-table"><thead><tr><th>${FIN_L('项目', '項目', 'Item')}</th><th>${FIN_L('应税金额', '應稅金額', 'Taxable Amount')}</th><th>${FIN_L('税率', '稅率', 'Tax Rate')}</th><th>${FIN_L('税额', '稅額', 'Tax')}</th></tr></thead>
                    <tbody>${(r.items||[]).map(i => `<tr><td>${esc(i.item_name||'')}</td><td style="text-align:right;">${UI.fmt(i.taxable_amount,2)}</td><td style="text-align:right;">${(Number(i.tax_rate)*100).toFixed(2)}%</td><td style="text-align:right;">${UI.fmt(i.tax_amount,2)}</td></tr>`).join('')}</tbody></table>
                    <div style="margin-top:8px;text-align:right;font-weight:600;">${FIN_L('合计税额：', '合計稅額：', 'Total tax: ')}${UI.fmt(r.tax_amount,2)}</div>
                    ${r.receipt_no ? `<div style="margin-top:6px;color:#27ae60;">✅ ${FIN_L('税务回执：', '稅務回執：', 'Tax receipt: ')}${esc(r.receipt_no)}</div>` : ''}
                </div>`,
                `<button class="btn btn-outline" onclick="UI.closeModal()">${FIN_L('关闭', '關閉', 'Close')}</button>`);
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    openTaxForm() {
        const bu = document.getElementById('ftBU')?.value || State.bu_no;
        const ym = document.getElementById('ftYM')?.value || State.YYYY_MM;
        UI.modal(FIN_L('新增纳税申报', '新增納稅申報', 'New Tax Filing'),
            `<div style="min-width:400px;">
                <div style="margin-bottom:10px;"><label style="font-size:12px;">BU</label><input id="tf_bu" class="form-control" value="${bu}" readonly></div>
                <div style="margin-bottom:10px;"><label style="font-size:12px;">${FIN_L('期间', '期間', 'Period')}</label><input id="tf_period" class="form-control" value="${ym}" readonly></div>
                <div style="margin-bottom:10px;"><label style="font-size:12px;">${FIN_L('税种', '稅種', 'Tax Type')}</label>
                    <select id="tf_type" class="form-control" onchange="Finance.showTaxHint()">
                        <option value="VAT">${FIN_L('增值税（13%）', '增值稅（13%）', 'VAT (13%)')}</option>
                        <option value="IT">${FIN_L('企业所得税（25%）', '企業所得稅（25%）', 'CIT (25%)')}</option>
                        <option value="ST">${FIN_L('印花税（0.03%）', '印花稅（0.03%）', 'Stamp Duty (0.03%)')}</option>
                    </select>
                </div>
                <div style="margin-bottom:10px;"><label style="font-size:12px;">${FIN_L('应税金额', '應稅金額', 'Taxable Amount')}</label><input id="tf_amt" type="number" step="0.01" class="form-control" placeholder="${FIN_L('请输入应税金额', '請輸入應稅金額', 'Enter taxable amount')}"></div>
                <div id="tf_preview" style="background:#f8f9fa;padding:10px;border-radius:6px;font-size:13px;">${FIN_L('预览税额：—', '預覽稅額：—', 'Tax preview: —')}</div>
                <div style="margin-top:6px;font-size:12px;color:#888;">${FIN_L('系统将自动产生 RUID 并关联该期间已过帐的入账记录。', '系統將自動產生 RUID 並關聯該期間已過帳的入帳記錄。', 'An RUID will be generated automatically and linked to posted vouchers of this period.')}</div>
            </div>`,
            `<button class="btn btn-outline" onclick="UI.closeModal()">${FIN_L('取消', '取消', 'Cancel')}</button>
             <button class="btn btn-primary" onclick="Finance.saveTax()">${FIN_L('建立申报', '建立申報', 'Create Filing')}</button>`);
        document.getElementById('tf_amt').oninput = () => this.showTaxHint();
    },

    showTaxHint() {
        const rate = { VAT: 0.13, IT: 0.25, ST: 0.0003 }[document.getElementById('tf_type').value];
        const amt = Number(document.getElementById('tf_amt').value || 0);
        document.getElementById('tf_preview').textContent = `${FIN_L('预览税额：', '預覽稅額：', 'Tax preview: ')}${amt} × ${(rate*100).toFixed(2)}% = ${(amt*rate).toFixed(2)}`;
    },

    async saveTax() {
        const bu = document.getElementById('tf_bu').value;
        const period = document.getElementById('tf_period').value;
        const tax_type = document.getElementById('tf_type').value;
        const amt = Number(document.getElementById('tf_amt').value);
        if (!amt || amt <= 0) { UI.toast(FIN_L('请输入应税金额', '請輸入應稅金額', 'Enter taxable amount'), 'error'); return; }
        try {
            const r = (await API.post('/api/finance/tax-returns', { bu_no: bu, tax_period: period, tax_type, items: [{ taxable_amount: amt }] })).data;
            UI.toast(`${FIN_L('申报表已建立，税额', '申報表已建立，稅額', 'Tax return created, tax ')} ${UI.fmt(r.tax_amount,2)}${FIN_L('，关联', '，關聯', ', linked to ')} ${r.linked_vouchers} ${FIN_L('笔入账', '筆入帳', 'entries')}`, 'success');
            UI.closeModal();
            this.loadTax();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async actTax(id, act) {
        try {
            const r = (await API.post(`/api/finance/tax-returns/${id}/${act}`)).data;
            UI.toast(act === 'file' ? `${FIN_L('申报成功，回执：', '申報成功，回執：', 'Filed successfully, receipt: ')}${r.receipt_no}` : FIN_L('审核通过', '審核通過', 'Approved'), 'success');
            this.loadTax();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ============ 报税明细表（年度彙總 + 匯出） ============
    async genTaxDetail() {
        const bu = document.getElementById('ftBU').value;
        const ym = document.getElementById('ftYM').value;
        const year = (ym || new Date().toISOString().slice(0, 7)).slice(0, 4);
        try {
            UI.modal(`📊 ${FIN_L('报税明细表', '報稅明細表', 'Tax Filing Detail')}`, `<div style="text-align:center;padding:30px;color:#888;">${FIN_L('生成中…', '生成中…', 'Generating…')}</div>`, '');
            const res = (await API.get(`/api/finance/tax-detail?bu_no=${bu}&year=${year}`)).data;
            this._taxDetail = res;
            this.renderTaxDetail();
        } catch (e) { UI.toast(e.message, 'error'); UI.closeModal(); }
    },

    renderTaxDetail() {
        const d = this._taxDetail;
        if (!d) return;
        const byType = d.summary.by_type || {};
        const typeCards = Object.values(byType).map(t => `
            <div style="flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;">
                <div style="font-size:12px;color:#64748b;">${esc(t.tax_name)}${FIN_L('（', '（', ' (')}${t.count}${FIN_L(' 笔）', ' 筆）', ' items)')}</div>
                <div style="font-size:15px;font-weight:700;color:#1e3a5f;margin-top:2px;">${UI.fmt(t.tax,2)}</div>
                <div style="font-size:11px;color:#94a3b8;">${FIN_L('应税', '應稅', 'Taxable')} ${UI.fmt(t.taxable,2)}</div>
            </div>`).join('');
        const badge = s => ({DRAFT:'#95a5a6',CALCULATED:'#3498db',APPROVED:'#f39c12',FILED:'#27ae60',REJECTED:'#e74c3c'}[s]||'#999');
        const rowsHtml = d.details.length
            ? d.details.map(x => `<tr>
                <td>${x.tax_period}</td>
                <td>${esc(x.tax_name)}</td>
                <td>${esc(x.item_name||'—')}</td>
                <td style="font-size:11px;color:#888;">${esc(x.ruid)}</td>
                <td style="text-align:right;">${UI.fmt(x.taxable_amount,2)}</td>
                <td style="text-align:right;">${(Number(x.tax_rate)*100).toFixed(2)}%</td>
                <td style="text-align:right;font-weight:600;">${UI.fmt(x.tax_amount,2)}</td>
                <td><span style="background:${badge(x.status)};color:#fff;padding:1px 7px;border-radius:10px;font-size:10px;">${x.status}</span></td>
                <td style="font-size:11px;">${esc(x.receipt_no||'—')}</td>
            </tr>`).join('')
            : `<tr><td colspan="9" style="text-align:center;color:#95a5a6;padding:20px;">${FIN_L('该年度尚无报税资料', '該年度尚無報稅資料', 'No tax filing data for this year')}</td></tr>`;

        UI.modal(`📊 ${d.bu_no} ${d.year} ${FIN_L('年度报税明细表', '年度報稅明細表', 'Annual Tax Filing Detail')}`,
            `<div style="min-width:880px;">
                <div style="display:flex;gap:10px;margin-bottom:12px;">
                    ${typeCards || `<div style="color:#95a5a6;">${FIN_L('无资料', '無資料', 'No data')}</div>`}
                    <div style="flex:1;background:#1e3a5f;color:#fff;border-radius:8px;padding:10px 12px;">
                        <div style="font-size:12px;opacity:.8;">${FIN_L('全年税额合计（', '全年稅額合計（', 'Annual tax total (')}${d.return_count}${FIN_L(' 笔）', ' 筆）', ' items)')}</div>
                        <div style="font-size:18px;font-weight:700;margin-top:2px;">${UI.fmt(d.summary.total_tax,2)}</div>
                        <div style="font-size:11px;opacity:.7;">${FIN_L('应税合计', '應稅合計', 'Taxable total')} ${UI.fmt(d.summary.total_taxable,2)}</div>
                    </div>
                </div>
                <div style="max-height:46vh;overflow:auto;border:1px solid #e2e8f0;border-radius:6px;">
                    <table class="data-table" style="width:100%;">
                        <thead style="position:sticky;top:0;z-index:1;"><tr>
                            <th>${FIN_L('期间', '期間', 'Period')}</th><th>${FIN_L('税种', '稅種', 'Tax Type')}</th><th>${FIN_L('项目', '項目', 'Item')}</th><th>RUID</th><th style="text-align:right;">${FIN_L('应税金额', '應稅金額', 'Taxable Amount')}</th>
                            <th style="text-align:right;">${FIN_L('税率', '稅率', 'Tax Rate')}</th><th style="text-align:right;">${FIN_L('税额', '稅額', 'Tax')}</th><th>${FIN_L('状态', '狀態', 'Status')}</th><th>${FIN_L('回执号', '回執號', 'Receipt No.')}</th>
                        </tr></thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
                <div style="margin-top:6px;font-size:11px;color:#94a3b8;">${FIN_L('生成时间：', '生成時間：', 'Generated at: ')}${d.generated_at.replace('T',' ').slice(0,19)}</div>
            </div>`,
            `<button class="btn btn-outline" onclick="UI.closeModal()">${FIN_L('关闭', '關閉', 'Close')}</button>
             <button class="btn btn-success" onclick="Finance.exportTaxDetailCsv()">📥 ${FIN_L('导出 CSV（Excel）', '匯出 CSV（Excel）', 'Export CSV (Excel)')}</button>`);
    },

    exportTaxDetailCsv() {
        const d = this._taxDetail;
        if (!d || !d.details.length) { UI.toast(FIN_L('无资料可导出', '無資料可匯出', 'No data to export'), 'error'); return; }
        const escCsv = v => {
            const s = String(v ?? '');
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines = [
            [`${d.bu_no} ${d.year} ${FIN_L('年度报税明细表', '年度報稅明細表', 'Annual Tax Filing Detail')}`],
            [FIN_L('生成时间', '生成時間', 'Generated at'), d.generated_at.replace('T',' ').slice(0,19)],
            [],
            [FIN_L('期间', '期間', 'Period'), FIN_L('税种', '稅種', 'Tax Type'), FIN_L('项目', '項目', 'Item'), 'RUID', FIN_L('应税金额', '應稅金額', 'Taxable Amount'), FIN_L('税率', '稅率', 'Tax Rate'), FIN_L('税额', '稅額', 'Tax'), FIN_L('状态', '狀態', 'Status'), FIN_L('回执号', '回執號', 'Receipt No.')],
        ];
        for (const x of d.details) {
            lines.push([
                x.tax_period, x.tax_name, x.item_name, x.ruid,
                x.taxable_amount.toFixed(2), (Number(x.tax_rate)*100).toFixed(2) + '%',
                x.tax_amount.toFixed(2), x.status, x.receipt_no,
            ]);
        }
        lines.push([]);
        for (const t of Object.values(d.summary.by_type || {})) {
            lines.push([`${t.tax_name} ${FIN_L('小计（', '小計（', 'Subtotal (')}${t.count}${FIN_L(' 笔）', ' 筆）', ' items)')}`, '', '', '', t.taxable.toFixed(2), '', t.tax.toFixed(2)]);
        }
        lines.push([FIN_L('全年合计', '全年合計', 'Annual Total'), '', '', '', d.summary.total_taxable.toFixed(2), '', d.summary.total_tax.toFixed(2)]);
        const csv = '\uFEFF' + lines.map(r => r.map(escCsv).join(',')).join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${FIN_L('报税明细表', '報稅明細表', 'TaxDetail')}_${d.bu_no}_${d.year}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        UI.toast(FIN_L('已导出 CSV', '已匯出 CSV', 'CSV exported'), 'success');
    },

    // ============ 勾稽对账 ============
    async renderRecon(el) {
        el.innerHTML = `
            <div class="toolbar" style="gap:8px;margin-bottom:10px;">
                <label>${FIN_L('BU：', 'BU：', 'BU: ')}<select id="frBU">${this._bu||''}</select></label>
                <label>${FIN_L('期间：', '期間：', 'Period: ')}<input type="month" id="frYM"></label>
                <button class="btn btn-warning" onclick="Finance.runRecon()">▶ ${FIN_L('执行勾稽', '執行勾稽', 'Run Reconciliation')}</button>
                <button class="btn btn-success" onclick="Finance.loadRecon()">🔄</button>
            </div>
            <div id="frList">${FIN_L('选择期间后点“执行勾稽”', '選擇期間後點「執行勾稽」', 'Select a period, then click "Run Reconciliation"')}</div>
        `;
        document.getElementById('frBU').value = State.bu_no;
        document.getElementById('frYM').value = State.YYYY_MM || new Date().toISOString().slice(0, 7);
    },

    async runRecon() {
        const bu = document.getElementById('frBU').value;
        const period = document.getElementById('frYM').value;
        try {
            const r = (await API.post('/api/finance/reconciliation/run', { bu_no: bu, period })).data;
            UI.toast(`${FIN_L('勾稽完成：匹配', '勾稽完成：匹配', 'Reconciliation done: matched')} ${r.matched} / ${FIN_L('金额差异', '金額差異', 'amount diff')} ${r.amount_diff} / ${FIN_L('未匹配', '未匹配', 'unmatched')} ${r.unmatched}`, r.unmatched || r.amount_diff ? 'warning' : 'success');
            this.loadRecon();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async loadRecon() {
        const el = document.getElementById('frList');
        const bu = document.getElementById('frBU').value;
        const period = document.getElementById('frYM').value;
        try {
            const res = await API.get(`/api/finance/reconciliation?bu_no=${bu}&period=${period}`);
            const rows = res.data || [];
            const badge = s => ({MATCHED:'#27ae60',AMOUNT_DIFF:'#f39c12',UNMATCHED:'#e74c3c',HANDLED:'#3498db'}[s]||'#999');
            if (!rows.length) { el.innerHTML = `<p style="color:#95a5a6;padding:30px;text-align:center;">🔗 ${FIN_L('尚无勾稽记录，请先执行勾稽', '尚無勾稽記錄，請先執行勾稽', 'No reconciliation records yet; run it first')}</p>`; return; }
            el.innerHTML = `<table class="data-table">
                <thead><tr><th>${FIN_L('入账 RUID', '入帳 RUID', 'Voucher RUID')}</th><th>${FIN_L('报税 RUID', '報稅 RUID', 'Tax RUID')}</th><th>${FIN_L('入账金额', '入帳金額', 'Voucher Amount')}</th><th>${FIN_L('报税金额', '報稅金額', 'Tax Amount')}</th><th>${FIN_L('差异', '差異', 'Diff')}</th><th>${FIN_L('状态', '狀態', 'Status')}</th><th>${FIN_L('操作', '操作', 'Actions')}</th></tr></thead>
                <tbody>${rows.map(r => `<tr>
                    <td style="font-size:12px;">${esc(r.voucher_ruid||'—')}</td>
                    <td style="font-size:12px;">${esc(r.tax_ruid||'—')}</td>
                    <td style="text-align:right;">${UI.fmt(r.voucher_amount,2)}</td>
                    <td style="text-align:right;">${UI.fmt(r.tax_amount,2)}</td>
                    <td style="text-align:right;color:${Math.abs(r.diff_amount)>0.01?'#e74c3c':'#27ae60'};">${UI.fmt(r.diff_amount,2)}</td>
                    <td><span style="background:${badge(r.match_status)};color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;">${r.match_status}</span></td>
                    <td>${r.match_status !== 'MATCHED' && r.match_status !== 'HANDLED' ? `<button class="btn btn-sm btn-outline" onclick="Finance.handleRecon(${r.recon_id})">${FIN_L('处理', '處理', 'Handle')}</button>` : ''}</td>
                </tr>`).join('')}</tbody></table>`;
        } catch (e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
    },

    async handleRecon(id) {
        const remark = prompt(FIN_L('处理说明：', '處理說明：', 'Handling note: '));
        if (remark == null) return;
        try {
            await API.post(`/api/finance/reconciliation/${id}/handle`, { remark });
            UI.toast(FIN_L('已标记处理', '已標記處理', 'Marked as handled'), 'success');
            this.loadRecon();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};
