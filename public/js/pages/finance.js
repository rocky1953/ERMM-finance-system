/**
 * 财务入账 / 报税 / 勾稽对账
 * 对应 docs/财务核心业务流程图.md
 */
registerPage('finance', async (c) => {
    c.innerHTML = `
        <div class="card" style="padding:16px;">
            <div style="display:flex;gap:8px;margin-bottom:14px;border-bottom:2px solid #eee;">
                <button class="tab-btn active" data-tab="voucher" onclick="Finance.switchTab('voucher')">📒 会计入账</button>
                <button class="tab-btn" data-tab="tax" onclick="Finance.switchTab('tax')">🧾 报税申报</button>
                <button class="tab-btn" data-tab="recon" onclick="Finance.switchTab('recon')">🔗 勾稽对账</button>
            </div>
            <div id="financeBody">载入中…</div>
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
                <label>BU：<select id="fvBU"><option>HM</option><option>HN</option><option>SZ</option></select></label>
                <label>期间：<input type="month" id="fvYM"></label>
                <label>状态：<select id="fvStatus"><option value="">全部</option>
                    <option>DRAFT</option><option>SUBMITTED</option><option>APPROVED</option><option>REJECTED</option><option>POSTED</option></select></label>
                <button class="btn btn-primary" onclick="Finance.openVoucherForm()">➕ 新增凭证</button>
                <button class="btn btn-success" onclick="Finance.renderVouchers(document.getElementById('financeBody'))">🔄</button>
            </div>
            <div id="fvList">载入中…</div>
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
            if (!rows.length) { el.innerHTML = `<p style="color:#95a5a6;padding:30px;text-align:center;">📒 尚无凭证</p>`; return; }
            const statusBadge = s => ({DRAFT:'#95a5a6',SUBMITTED:'#f39c12',APPROVED:'#3498db',REJECTED:'#e74c3c',POSTED:'#27ae60'}[s]||'#999');
            el.innerHTML = `<table class="data-table">
                <thead><tr><th>凭证号</th><th>RUID</th><th>日期</th><th>摘要</th><th>借方</th><th>贷方</th><th>状态</th><th>操作</th></tr></thead>
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
        const btns = [`<button class="btn btn-sm btn-outline" onclick="Finance.viewVoucher(${r.voucher_id})">检视</button>`];
        if (r.status === 'DRAFT' || r.status === 'REJECTED')
            btns.push(`<button class="btn btn-sm btn-primary" onclick="Finance.actVoucher(${r.voucher_id},'submit')">提交</button>`);
        if (r.status === 'SUBMITTED') {
            btns.push(`<button class="btn btn-sm btn-success" onclick="Finance.actVoucher(${r.voucher_id},'approve')">通过</button>`);
            btns.push(`<button class="btn btn-sm btn-outline" onclick="Finance.rejectVoucher(${r.voucher_id})">驳回</button>`);
        }
        if (r.status === 'APPROVED')
            btns.push(`<button class="btn btn-sm btn-success" onclick="Finance.actVoucher(${r.voucher_id},'post')">过帐</button>`);
        return btns.join(' ');
    },

    async viewVoucher(id) {
        try {
            const r = (await API.get(`/api/finance/vouchers/${id}`)).data;
            const entries = r.entries || [];
            UI.modal(`凭证 ${r.voucher_no}`,
                `<div style="min-width:820px;">
                    <div style="margin-bottom:8px;"><b>RUID：</b>${esc(r.ruid)} ｜ <b>期间：</b>${esc(r.YYYY_MM)} ｜ <b>状态：</b>${r.status}</div>
                    <div style="margin-bottom:8px;"><b>摘要：</b>${esc(r.summary||'')}</div>
                    <table class="data-table" style="width:100%;table-layout:auto;"><thead><tr><th style="width:30%;">科目</th><th style="width:18%;">借方</th><th style="width:18%;">贷方</th><th>摘要</th></tr></thead>
                    <tbody>${entries.map(e => `<tr><td>${esc(e.subject_name||e.subject_code)}</td><td style="text-align:right;">${UI.fmt(e.debit,2)}</td><td style="text-align:right;">${UI.fmt(e.credit,2)}</td><td>${esc(e.summary||'')}</td></tr>`).join('')}</tbody></table>
                    <div style="margin-top:8px;text-align:right;font-weight:600;">合计：借 ${UI.fmt(r.total_debit,2)} / 贷 ${UI.fmt(r.total_credit,2)}</div>
                </div>`,
                `<button class="btn btn-outline" onclick="UI.closeModal()">关闭</button>`);
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
        UI.modal('新增会计凭证',
            `<div style="min-width:680px;">
                <div style="display:grid;grid-template-columns:1fr 1fr 2fr;gap:10px;margin-bottom:10px;">
                    <div><label style="font-size:12px;">BU</label><input id="vf_bu" class="form-control" value="${d.bu_no}" readonly></div>
                    <div><label style="font-size:12px;">日期</label><input id="vf_date" type="date" class="form-control" value="${d.voucher_date}"></div>
                    <div><label style="font-size:12px;">摘要</label><input id="vf_summary" class="form-control" value="${esc(d.summary)}" placeholder="业务摘要"></div>
                </div>
                <table class="data-table" id="vfEntries">
                    <thead><tr><th>科目</th><th>借方</th><th>贷方</th><th>摘要</th><th></th></tr></thead>
                    <tbody>${d.entries.map((e, i) => `<tr>
                        <td><select class="form-control" onchange="Finance.setEntry(${i},'subject_code',this.value)">
                            <option value="">请选择</option>${opts.replace(`value="${e.subject_code}"`,`value="${e.subject_code}" selected`)}</select></td>
                        <td><input type="number" step="0.01" class="form-control" value="${e.debit||''}" onchange="Finance.setEntry(${i},'debit',this.value)"></td>
                        <td><input type="number" step="0.01" class="form-control" value="${e.credit||''}" onchange="Finance.setEntry(${i},'credit',this.value)"></td>
                        <td><input class="form-control" value="${esc(e.summary||'')}" onchange="Finance.setEntry(${i},'summary',this.value)"></td>
                        <td><button class="btn btn-sm btn-outline" onclick="Finance.delEntry(${i})">删</button></td>
                    </tr>`).join('')}</tbody>
                </table>
                <div style="margin-top:8px;display:flex;gap:10px;">
                    <button class="btn btn-outline" onclick="Finance.addEntry()">➕ 增列</button>
                    <span style="margin-left:auto;font-weight:600;">借贷差额：<span id="vfDiff" style="color:#e74c3c;">0.00</span></span>
                </div>
            </div>`,
            `<button class="btn btn-outline" onclick="UI.closeModal()">取消</button>
             <button class="btn btn-primary" onclick="Finance.saveVoucher()">储存草稿</button>`);
        this.calcDiff();
    },

    setEntry(i, k, v) { this._vDraft.entries[i][k] = k === 'summary' ? v : (k === 'subject_code' ? v : Number(v)); this.calcDiff(); },
    addEntry() { this._vDraft.entries.push({ subject_code: '', debit: 0, credit: 0, summary: '' }); this.renderVoucherForm(); },
    delEntry(i) { if (this._vDraft.entries.length <= 2) { UI.toast('至少保留 2 条分录', 'error'); return; } this._vDraft.entries.splice(i, 1); this.renderVoucherForm(); },

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
        if (valid.length < 2) { UI.toast('至少 2 条有效分录', 'error'); return; }
        d.entries = valid;
        const td = d.entries.reduce((s, e) => s + Number(e.debit || 0), 0);
        const tc = d.entries.reduce((s, e) => s + Number(e.credit || 0), 0);
        if (Math.abs(td - tc) > 0.01) { UI.toast(`借贷不平衡：差 ${(td-tc).toFixed(2)}`, 'error'); return; }
        try {
            await API.post('/api/finance/vouchers', d);
            UI.toast('凭证已建立', 'success');
            UI.closeModal();
            this.loadVouchers();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async actVoucher(id, act) {
        try {
            await API.post(`/api/finance/vouchers/${id}/${act}`);
            UI.toast('操作成功', 'success');
            this.loadVouchers();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async rejectVoucher(id) {
        const reason = prompt('驳回原因：');
        if (reason == null) return;
        try {
            await API.post(`/api/finance/vouchers/${id}/reject`, { reason });
            UI.toast('已驳回', 'success');
            this.loadVouchers();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ============ 报税 ============
    async renderTax(el) {
        el.innerHTML = `
            <div class="toolbar" style="gap:8px;margin-bottom:10px;">
                <label>BU：<select id="ftBU"><option>HM</option><option>HN</option><option>SZ</option></select></label>
                <label>期间：<input type="month" id="ftYM"></label>
                <label>税种：<select id="ftType"><option value="">全部</option>
                    <option value="VAT">增值税</option><option value="IT">企业所得税</option><option value="ST">印花税</option></select></label>
                <button class="btn btn-primary" onclick="Finance.openTaxForm()">➕ 新增申报</button>
                <button class="btn btn-warning" onclick="Finance.genTaxDetail()">📊 生成报税明细表</button>
                <button class="btn btn-success" onclick="Finance.renderTax(document.getElementById('financeBody'))">🔄</button>
            </div>
            <div id="ftList">载入中…</div>
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
            const nameMap = { VAT: '增值税', IT: '企业所得税', ST: '印花税' };
            const badge = s => ({DRAFT:'#95a5a6',CALCULATED:'#3498db',APPROVED:'#f39c12',FILED:'#27ae60',REJECTED:'#e74c3c'}[s]||'#999');
            if (!rows.length) { el.innerHTML = `<p style="color:#95a5a6;padding:30px;text-align:center;">🧾 尚无申报表</p>`; return; }
            el.innerHTML = `<table class="data-table">
                <thead><tr><th>税种</th><th>期间</th><th>RUID</th><th>应税金额</th><th>税额</th><th>状态</th><th>回执号</th><th>操作</th></tr></thead>
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
        const b = [`<button class="btn btn-sm btn-outline" onclick="Finance.viewTax(${r.return_id})">检视</button>`];
        if (r.status === 'CALCULATED') b.push(`<button class="btn btn-sm btn-success" onclick="Finance.actTax(${r.return_id},'approve')">审核</button>`);
        if (r.status === 'APPROVED') b.push(`<button class="btn btn-sm btn-primary" onclick="Finance.actTax(${r.return_id},'file')">申报</button>`);
        return b.join(' ');
    },

    async viewTax(id) {
        try {
            const r = (await API.get(`/api/finance/tax-returns/${id}`)).data;
            UI.modal(`申报表 ${r.tax_name} ${r.tax_period}`,
                `<div style="min-width:500px;">
                    <div style="margin-bottom:6px;"><b>RUID：</b>${esc(r.ruid)}</div>
                    <div style="margin-bottom:6px;"><b>税种：</b>${r.tax_name} ｜ <b>期间：</b>${r.tax_period} ｜ <b>状态：</b>${r.status}</div>
                    <table class="data-table"><thead><tr><th>项目</th><th>应税金额</th><th>税率</th><th>税额</th></tr></thead>
                    <tbody>${(r.items||[]).map(i => `<tr><td>${esc(i.item_name||'')}</td><td style="text-align:right;">${UI.fmt(i.taxable_amount,2)}</td><td style="text-align:right;">${(Number(i.tax_rate)*100).toFixed(2)}%</td><td style="text-align:right;">${UI.fmt(i.tax_amount,2)}</td></tr>`).join('')}</tbody></table>
                    <div style="margin-top:8px;text-align:right;font-weight:600;">合计税额：${UI.fmt(r.tax_amount,2)}</div>
                    ${r.receipt_no ? `<div style="margin-top:6px;color:#27ae60;">✅ 税务回执：${esc(r.receipt_no)}</div>` : ''}
                </div>`,
                `<button class="btn btn-outline" onclick="UI.closeModal()">关闭</button>`);
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    openTaxForm() {
        const bu = document.getElementById('ftBU')?.value || State.bu_no;
        const ym = document.getElementById('ftYM')?.value || State.YYYY_MM;
        UI.modal('新增纳税申报',
            `<div style="min-width:400px;">
                <div style="margin-bottom:10px;"><label style="font-size:12px;">BU</label><input id="tf_bu" class="form-control" value="${bu}" readonly></div>
                <div style="margin-bottom:10px;"><label style="font-size:12px;">期间</label><input id="tf_period" class="form-control" value="${ym}" readonly></div>
                <div style="margin-bottom:10px;"><label style="font-size:12px;">税种</label>
                    <select id="tf_type" class="form-control" onchange="Finance.showTaxHint()">
                        <option value="VAT">增值税（13%）</option>
                        <option value="IT">企业所得税（25%）</option>
                        <option value="ST">印花税（0.03%）</option>
                    </select>
                </div>
                <div style="margin-bottom:10px;"><label style="font-size:12px;">应税金额</label><input id="tf_amt" type="number" step="0.01" class="form-control" placeholder="请输入应税金额"></div>
                <div id="tf_preview" style="background:#f8f9fa;padding:10px;border-radius:6px;font-size:13px;">预览税额：—</div>
                <div style="margin-top:6px;font-size:12px;color:#888;">系统将自动产生 RUID 并关联该期间已过帐的入账记录。</div>
            </div>`,
            `<button class="btn btn-outline" onclick="UI.closeModal()">取消</button>
             <button class="btn btn-primary" onclick="Finance.saveTax()">建立申报</button>`);
        document.getElementById('tf_amt').oninput = () => this.showTaxHint();
    },

    showTaxHint() {
        const rate = { VAT: 0.13, IT: 0.25, ST: 0.0003 }[document.getElementById('tf_type').value];
        const amt = Number(document.getElementById('tf_amt').value || 0);
        document.getElementById('tf_preview').textContent = `预览税额：${amt} × ${(rate*100).toFixed(2)}% = ${(amt*rate).toFixed(2)}`;
    },

    async saveTax() {
        const bu = document.getElementById('tf_bu').value;
        const period = document.getElementById('tf_period').value;
        const tax_type = document.getElementById('tf_type').value;
        const amt = Number(document.getElementById('tf_amt').value);
        if (!amt || amt <= 0) { UI.toast('请输入应税金额', 'error'); return; }
        try {
            const r = (await API.post('/api/finance/tax-returns', { bu_no: bu, tax_period: period, tax_type, items: [{ taxable_amount: amt }] })).data;
            UI.toast(`申报表已建立，税额 ${UI.fmt(r.tax_amount,2)}，关联 ${r.linked_vouchers} 笔入账`, 'success');
            UI.closeModal();
            this.loadTax();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async actTax(id, act) {
        try {
            const r = (await API.post(`/api/finance/tax-returns/${id}/${act}`)).data;
            UI.toast(act === 'file' ? `申报成功，回执：${r.receipt_no}` : '审核通过', 'success');
            this.loadTax();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ============ 报税明细表（年度彙總 + 匯出） ============
    async genTaxDetail() {
        const bu = document.getElementById('ftBU').value;
        const ym = document.getElementById('ftYM').value;
        const year = (ym || new Date().toISOString().slice(0, 7)).slice(0, 4);
        try {
            UI.modal('📊 报税明细表', '<div style="text-align:center;padding:30px;color:#888;">生成中…</div>', '');
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
                <div style="font-size:12px;color:#64748b;">${esc(t.tax_name)}（${t.count} 笔）</div>
                <div style="font-size:15px;font-weight:700;color:#1e3a5f;margin-top:2px;">${UI.fmt(t.tax,2)}</div>
                <div style="font-size:11px;color:#94a3b8;">应税 ${UI.fmt(t.taxable,2)}</div>
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
            : `<tr><td colspan="9" style="text-align:center;color:#95a5a6;padding:20px;">该年度尚无报税资料</td></tr>`;

        UI.modal(`📊 ${d.bu_no} ${d.year} 年度报税明细表`,
            `<div style="min-width:880px;">
                <div style="display:flex;gap:10px;margin-bottom:12px;">
                    ${typeCards || '<div style="color:#95a5a6;">无资料</div>'}
                    <div style="flex:1;background:#1e3a5f;color:#fff;border-radius:8px;padding:10px 12px;">
                        <div style="font-size:12px;opacity:.8;">全年税额合计（${d.return_count} 笔）</div>
                        <div style="font-size:18px;font-weight:700;margin-top:2px;">${UI.fmt(d.summary.total_tax,2)}</div>
                        <div style="font-size:11px;opacity:.7;">应税合计 ${UI.fmt(d.summary.total_taxable,2)}</div>
                    </div>
                </div>
                <div style="max-height:46vh;overflow:auto;border:1px solid #e2e8f0;border-radius:6px;">
                    <table class="data-table" style="width:100%;">
                        <thead style="position:sticky;top:0;z-index:1;"><tr>
                            <th>期间</th><th>税种</th><th>项目</th><th>RUID</th><th style="text-align:right;">应税金额</th>
                            <th style="text-align:right;">税率</th><th style="text-align:right;">税额</th><th>状态</th><th>回执号</th>
                        </tr></thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
                <div style="margin-top:6px;font-size:11px;color:#94a3b8;">生成时间：${d.generated_at.replace('T',' ').slice(0,19)}</div>
            </div>`,
            `<button class="btn btn-outline" onclick="UI.closeModal()">关闭</button>
             <button class="btn btn-success" onclick="Finance.exportTaxDetailCsv()">📥 导出 CSV（Excel）</button>`);
    },

    exportTaxDetailCsv() {
        const d = this._taxDetail;
        if (!d || !d.details.length) { UI.toast('无资料可导出', 'error'); return; }
        const escCsv = v => {
            const s = String(v ?? '');
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines = [
            [`${d.bu_no} ${d.year} 年度报税明细表`],
            ['生成时间', d.generated_at.replace('T',' ').slice(0,19)],
            [],
            ['期间','税种','项目','RUID','应税金额','税率','税额','状态','回执号'],
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
            lines.push([`${t.tax_name} 小计（${t.count} 笔）`, '', '', '', t.taxable.toFixed(2), '', t.tax.toFixed(2)]);
        }
        lines.push(['全年合计', '', '', '', d.summary.total_taxable.toFixed(2), '', d.summary.total_tax.toFixed(2)]);
        const csv = '\uFEFF' + lines.map(r => r.map(escCsv).join(',')).join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `报税明细表_${d.bu_no}_${d.year}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        UI.toast('已导出 CSV', 'success');
    },

    // ============ 勾稽对账 ============
    async renderRecon(el) {
        el.innerHTML = `
            <div class="toolbar" style="gap:8px;margin-bottom:10px;">
                <label>BU：<select id="frBU"><option>HM</option><option>HN</option><option>SZ</option></select></label>
                <label>期间：<input type="month" id="frYM"></label>
                <button class="btn btn-warning" onclick="Finance.runRecon()">▶ 执行勾稽</button>
                <button class="btn btn-success" onclick="Finance.loadRecon()">🔄</button>
            </div>
            <div id="frList">选择期间后点“执行勾稽”</div>
        `;
        document.getElementById('frBU').value = State.bu_no;
        document.getElementById('frYM').value = State.YYYY_MM || new Date().toISOString().slice(0, 7);
    },

    async runRecon() {
        const bu = document.getElementById('frBU').value;
        const period = document.getElementById('frYM').value;
        try {
            const r = (await API.post('/api/finance/reconciliation/run', { bu_no: bu, period })).data;
            UI.toast(`勾稽完成：匹配 ${r.matched} / 金额差异 ${r.amount_diff} / 未匹配 ${r.unmatched}`, r.unmatched || r.amount_diff ? 'warning' : 'success');
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
            if (!rows.length) { el.innerHTML = `<p style="color:#95a5a6;padding:30px;text-align:center;">🔗 尚无勾稽记录，请先执行勾稽</p>`; return; }
            el.innerHTML = `<table class="data-table">
                <thead><tr><th>入账 RUID</th><th>报税 RUID</th><th>入账金额</th><th>报税金额</th><th>差异</th><th>状态</th><th>操作</th></tr></thead>
                <tbody>${rows.map(r => `<tr>
                    <td style="font-size:12px;">${esc(r.voucher_ruid||'—')}</td>
                    <td style="font-size:12px;">${esc(r.tax_ruid||'—')}</td>
                    <td style="text-align:right;">${UI.fmt(r.voucher_amount,2)}</td>
                    <td style="text-align:right;">${UI.fmt(r.tax_amount,2)}</td>
                    <td style="text-align:right;color:${Math.abs(r.diff_amount)>0.01?'#e74c3c':'#27ae60'};">${UI.fmt(r.diff_amount,2)}</td>
                    <td><span style="background:${badge(r.match_status)};color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;">${r.match_status}</span></td>
                    <td>${r.match_status !== 'MATCHED' && r.match_status !== 'HANDLED' ? `<button class="btn btn-sm btn-outline" onclick="Finance.handleRecon(${r.recon_id})">处理</button>` : ''}</td>
                </tr>`).join('')}</tbody></table>`;
        } catch (e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
    },

    async handleRecon(id) {
        const remark = prompt('处理说明：');
        if (remark == null) return;
        try {
            await API.post(`/api/finance/reconciliation/${id}/handle`, { remark });
            UI.toast('已标记处理', 'success');
            this.loadRecon();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};
