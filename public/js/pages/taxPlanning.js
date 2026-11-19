/**
 * CFO-07 税务筹划与税务风险页面
 * 税负测算、优惠适用登记、税务风险清单
 */
function taxEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const TP_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] ?? zh);

const TP_CATEGORY = { CIT: TP_L('企业所得税', '企業所得稅', 'Corporate Income Tax'), VAT: TP_L('增值税', '增值稅', 'VAT'), SURCHARGE: TP_L('附加税费', '附加稅費', 'Surcharges') };
const TP_TAXPAYER = { 1: TP_L('一般纳税人', '一般納稅人', 'General Taxpayer'), 2: TP_L('小规模纳税人', '小規模納稅人', 'Small-scale Taxpayer') };
const TP_SOURCE = { AUTO: TP_L('自动判定', '自動判定', 'Auto'), MANUAL: TP_L('人工登记', '人工登記', 'Manual') };

registerPage('taxPlanning', async (c) => {
    const bu = ['HM', 'HN', 'SZ'].includes(State.bu_no) ? State.bu_no : 'HM';
    TaxPlan.bu = bu;
    // 初次載入依「畫面最上方」全域年度
    TaxPlan.year = String(State.year());
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
            <h2 style="margin:0;font-size:20px;">${TP_L('税务筹划/风险', '稅務籌劃/風險', 'Tax Planning / Risk')} <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">${TP_L('：金额单位 RMB', '：金額單位 RMB', ': Amounts in RMB')}</small></h2>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <select id="tpBu" class="form-control" style="width:90px;" onchange="TaxPlan.reload()">
                    <option value="HM">HM</option><option value="HN">HN</option><option value="SZ">SZ</option>
                </select>
                <input id="tpYear" type="number" min="2000" max="2100" class="form-control" style="width:110px;" onchange="TaxPlan.reload()">
                <button class="btn btn-warning" onclick="TaxPlan.scan()">${TP_L('⚠️ 生成风险预警', '⚠️ 產生風險預警', '⚠️ Generate Risk Alerts')}</button>
                <button class="btn btn-success" onclick="TaxPlan.load()">${TP_L('刷新', '重新整理', 'Refresh')}</button>
            </div>
        </div>
        <div id="tpKpi" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:14px;"></div>
        <div id="tpRisk"></div>
        <div class="card" style="margin-bottom:14px;">
            <div class="card-title">${TP_L('税收优惠适用', '稅收優惠適用', 'Tax Incentives Applied')}</div>
            <div id="tpPolicyTable">${t('loading')}</div>
        </div>
        <div class="card" style="margin-bottom:14px;">
            <div class="card-title">${TP_L('税负测算（按月）', '稅負測算（按月）', 'Tax Burden (Monthly)')}</div>
            <div id="tpTrendTable">${t('loading')}</div>
        </div>
        <div class="card">
            <div class="card-title">${TP_L('增值税申报明细', '增值稅申報明細', 'VAT Filing Details')}</div>
            <div id="tpVatTable">${t('loading')}</div>
        </div>
    `;
    document.getElementById('tpBu').value = bu;
    document.getElementById('tpYear').value = TaxPlan.year;
    await TaxPlan.load();
});

const TaxPlan = {
    bu: 'HM',
    year: '',
    data: null,

    async reload() {
        this.bu = document.getElementById('tpBu').value;
        const y = String(document.getElementById('tpYear').value || '').trim();
        this.year = /^\d{4}$/.test(y) ? y : '';
        await this.load();
    },

    async load() {
        try {
            let url = `/api/tax-planning/overview?bu_no=${encodeURIComponent(this.bu)}`;
            if (this.year) url += `&YYYY=${encodeURIComponent(this.year)}`;
            const res = await API.get(url);
            this.data = res.data;
            this.year = res.data.YYYY;
            const yi = document.getElementById('tpYear');
            if (yi && !yi.value) yi.value = this.year;
            this.render();
        } catch (e) {
            const box = document.getElementById('tpPolicyTable');
            if (box) box.innerHTML = `<p style="color:#e74c3c">${taxEsc(e.message)}</p>`;
        }
    },

    render() {
        const d = this.data;
        const tot = d.totals || {};
        const cards = [
            [TP_L('增值税负率', '增值稅負率', 'VAT Burden'), `${UI.fmt(tot.vat_burden)} %`, Number(tot.vat_burden) < 3 ? '#e74c3c' : '#27ae60'],
            [TP_L('所得税负率', '所得稅負率', 'Income Tax Burden'), `${UI.fmt(tot.cit_burden)} %`, Number(tot.cit_burden) < 1 ? '#e74c3c' : '#27ae60'],
            [TP_L('综合税负率', '綜合稅負率', 'Composite Tax Burden'), `${UI.fmt(tot.composite_burden)} %`, '#2980b9'],
            [TP_L('年纳税总额', '年納稅總額', 'Total Tax Paid'), `¥ ${UI.fmt(tot.total_tax)}`, '#8e44ad'],
            [TP_L('风险提示', '風險提示', 'Risk Alerts'), `${(d.risks || []).length} ${TP_L('项', '項', 'items')}`, (d.risks || []).length ? '#e74c3c' : '#27ae60']
        ];
        document.getElementById('tpKpi').innerHTML = cards.map(([label, val, color]) => `
            <div class="card" style="margin:0;padding:14px;">
                <div style="font-size:12px;color:#7f8c8d;">${label}</div>
                <div style="font-size:22px;font-weight:700;color:${color};margin-top:4px;">${val}</div>
            </div>`).join('');

        this.renderRisks();
        this.renderPolicies();
        this.renderTrend();
        this.renderVat();
    },

    renderRisks() {
        const rows = this.data.risks || [];
        const el = document.getElementById('tpRisk');
        if (!rows.length) {
            el.innerHTML = `<div style="background:#eafaf1;border-left:4px solid #27ae60;padding:10px 12px;border-radius:6px;margin-bottom:12px;font-size:13px;">${TP_L('✅ 未发现税务风险项', '✅ 未發現稅務風險項', '✅ No tax risk items found')}</div>`;
            return;
        }
        el.innerHTML = rows.map(r => `
            <div style="background:${r.level === 'danger' ? '#fdecea' : '#fff8e1'};border-left:4px solid ${r.level === 'danger' ? '#e74c3c' : '#f39c12'};padding:10px 12px;border-radius:6px;margin-bottom:8px;font-size:13px;">
                <div style="font-weight:600;">${r.level === 'danger' ? '🔴' : '🟡'} ${taxEsc(r.kpi_name)}（${taxEsc(r.code)}）</div>
                <div style="margin-top:4px;">${taxEsc(r.message)}</div>
                <div style="margin-top:4px;color:#7f8c8d;font-size:12px;">${TP_L('建议：', '建議：', 'Suggestion: ')}${taxEsc(r.suggestion)}</div>
            </div>`).join('');
    },

    renderPolicies() {
        const rows = this.data.preferences || [];
        const el = document.getElementById('tpPolicyTable');
        if (!rows.length) { el.innerHTML = UI.empty('🧾', TP_L('暂无优惠适用数据', '暫無優惠適用資料', 'No incentive data yet')); return; }
        const applicableTag = (v) => {
            if (v === null || v === undefined) return `<span style="color:#95a5a6;">${TP_L('待人工确认', '待人工確認', 'Pending Review')}</span>`;
            return Number(v) === 1
                ? `<span style="color:#27ae60;font-weight:600;">${TP_L('适用', '適用', 'Applicable')}</span>`
                : `<span style="color:#95a5a6;">${TP_L('不适用', '不適用', 'Not Applicable')}</span>`;
        };
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#f8f9fa;">
                    <th style="padding:8px;border:1px solid #eee;text-align:left;">${TP_L('优惠政策', '優惠政策', 'Policy')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${TP_L('类别', '類別', 'Category')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:left;">${TP_L('政策说明', '政策說明', 'Description')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${TP_L('自动判定', '自動判定', 'Auto')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${TP_L('适用结论', '適用結論', 'Conclusion')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${TP_L('预计节税', '預計節稅', 'Est. Saving')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${TP_L('来源', '來源', 'Source')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${TP_L('备注', '備註', 'Note')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${TP_L('操作', '操作', 'Actions')}</th>
                </tr></thead>
                <tbody>
                    ${rows.map(r => `<tr style="${Number(r.status) === 0 ? 'opacity:.55;' : ''}">
                        <td style="padding:8px;border:1px solid #eee;font-weight:600;">${taxEsc(r.policy_name)}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:center;">${TP_CATEGORY[r.category] || taxEsc(r.category || '-')}</td>
                        <td style="padding:8px;border:1px solid #eee;color:#7f8c8d;max-width:320px;">${taxEsc(r.policy_desc)}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:center;">${applicableTag(r.auto_applicable)}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:center;">${applicableTag(r.applicable)}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:right;">¥ ${UI.fmt(r.est_benefit)}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:center;">${TP_SOURCE[r.source] || r.source}</td>
                        <td style="padding:8px;border:1px solid #eee;color:#7f8c8d;">${taxEsc(r.note || '')}</td>
                        <td style="padding:8px;border:1px solid #eee;white-space:nowrap;">
                            <button class="btn btn-sm btn-outline" onclick="TaxPlan.editPolicy('${taxEsc(r.policy_code)}')">${TP_L('编辑', '編輯', 'Edit')}</button>
                            ${r.uid && r.source === 'MANUAL'
                                ? `<button class="btn btn-sm btn-danger" onclick="TaxPlan.resetPolicy(${r.uid})">${TP_L('恢复自动', '恢復自動', 'Reset to Auto')}</button>`
                                : ''}
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
    },

    renderTrend() {
        const rows = this.data.monthly || [];
        const el = document.getElementById('tpTrendTable');
        if (!rows.length) { el.innerHTML = UI.empty('📊', TP_L('暂无税负数据', '暫無稅負資料', 'No tax burden data')); return; }
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#f8f9fa;">
                    <th style="padding:8px;border:1px solid #eee;">${TP_L('月份', '月份', 'Month')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${TP_L('财务销售收入', '財務銷售收入', 'Revenue (Fin.)')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${TP_L('增值税申报销售额', '增值稅申報銷售額', 'VAT-Taxed Sales')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${TP_L('应纳增值税', '應納增值稅', 'VAT Payable')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${TP_L('附加税费', '附加稅費', 'Surcharges')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${TP_L('当月纳税合计', '當月納稅合計', 'Monthly Tax Total')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${TP_L('税负率', '稅負率', 'Tax Burden')}</th>
                </tr></thead>
                <tbody>
                    ${rows.map(r => `<tr>
                        <td style="padding:8px;border:1px solid #eee;">${taxEsc(r.month)}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:right;">${UI.fmt(r.sales_amt)}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:right;">${UI.fmt(r.vat_sales)}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:right;">${UI.fmt(r.vat_payable)}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:right;">${UI.fmt(r.surcharges)}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:right;font-weight:600;">${UI.fmt(r.total_tax)}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:right;">${UI.fmt(r.burden)} %</td>
                    </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
    },

    renderVat() {
        const rows = this.data.vat_declarations || [];
        const el = document.getElementById('tpVatTable');
        if (!rows.length) { el.innerHTML = UI.empty('📄', TP_L('本年度暂无增值税申报记录', '本年度暫無增值稅申報記錄', 'No VAT filing records this year')); return; }
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#f8f9fa;">
                    <th style="padding:8px;border:1px solid #eee;">${TP_L('税款所属期', '稅款所屬期', 'Tax Period')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${TP_L('纳税人类型', '納稅人類型', 'Taxpayer Type')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${TP_L('销售额', '銷售額', 'Sales')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${TP_L('销项税额', '銷項稅額', 'Output VAT')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${TP_L('进项税额', '進項稅額', 'Input VAT')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${TP_L('应纳增值税', '應納增值稅', 'VAT Payable')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${TP_L('附加税费', '附加稅費', 'Surcharges')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${TP_L('状态', '狀態', 'Status')}</th>
                </tr></thead>
                <tbody>
                    ${rows.map(r => `<tr>
                        <td style="padding:8px;border:1px solid #eee;">${taxEsc(r.tax_period)}</td>
                        <td style="padding:8px;border:1px solid #eee;">${TP_TAXPAYER[r.taxpayer_type] || r.taxpayer_type || '-'}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:right;">${UI.fmt(r.total_sales_amt)}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:right;">${UI.fmt(r.total_output_tax)}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:right;">${UI.fmt(r.total_input_tax)}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:right;font-weight:600;">${UI.fmt(r.tax_payable)}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:right;">${UI.fmt(r.surcharges)}</td>
                        <td style="padding:8px;border:1px solid #eee;">${taxEsc(r.status || '-')}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
    },

    editPolicy(code) {
        const p = (this.data.preferences || []).find(x => x.policy_code === code);
        if (!p) return;
        const applicableVal = p.source === 'MANUAL'
            ? String(Number(p.applicable) === 1 ? 1 : 0) : '';
        UI.modal(TP_L('优惠适用登记', '優惠適用登記', 'Incentive Registration'), `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;min-width:460px;">
                <div style="grid-column:1 / span 2;">
                    <label class="form-label">${TP_L('优惠政策', '優惠政策', 'Policy')}</label>
                    <input class="form-control" value="${taxEsc(p.policy_name)}" disabled>
                </div>
                <div>
                    <label class="form-label">${TP_L('适用结论', '適用結論', 'Conclusion')}</label>
                    <select id="tp_applicable" class="form-control">
                        <option value="" ${applicableVal === '' ? 'selected' : ''}>${TP_L('自动判定', '自動判定', 'Auto')}</option>
                        <option value="1" ${applicableVal === '1' ? 'selected' : ''}>${TP_L('适用', '適用', 'Applicable')}</option>
                        <option value="0" ${applicableVal === '0' ? 'selected' : ''}>${TP_L('不适用', '不適用', 'Not Applicable')}</option>
                    </select>
                </div>
                <div>
                    <label class="form-label">${TP_L('预计节税（RMB）', '預計節稅（RMB）', 'Est. Saving (RMB)')}</label>
                    <input id="tp_benefit" type="number" step="0.01" class="form-control" value="${p.est_benefit || 0}">
                </div>
                <div>
                    <label class="form-label">${TP_L('状态', '狀態', 'Status')}</label>
                    <select id="tp_status" class="form-control">
                        <option value="1" ${Number(p.status) !== 0 ? 'selected' : ''}>${TP_L('启用', '啟用', 'Enabled')}</option>
                        <option value="0" ${Number(p.status) === 0 ? 'selected' : ''}>${TP_L('停用', '停用', 'Disabled')}</option>
                    </select>
                </div>
                <div>
                    <label class="form-label">${TP_L('自动判定结果', '自動判定結果', 'Auto Result')}</label>
                    <input class="form-control" value="${p.auto_applicable === null || p.auto_applicable === undefined ? TP_L('待人工确认', '待人工確認', 'Pending Review') : (Number(p.auto_applicable) === 1 ? TP_L('适用', '適用', 'Applicable') : TP_L('不适用', '不適用', 'Not Applicable'))}" disabled>
                </div>
                <div style="grid-column:1 / span 2;">
                    <label class="form-label">${TP_L('备注', '備註', 'Note')}</label>
                    <input id="tp_note" class="form-control" value="${taxEsc(p.note || '')}">
                </div>
            </div>`,
            `<button class="btn btn-outline" onclick="UI.closeModal()">${TP_L('取消', '取消', 'Cancel')}</button>
             <button class="btn btn-primary" onclick="TaxPlan.savePolicy('${taxEsc(code)}')">${TP_L('保存', '儲存', 'Save')}</button>`);
    },

    async savePolicy(code) {
        const body = {
            bu_no: this.bu, YYYY: this.year, policy_code: code,
            applicable: document.getElementById('tp_applicable').value,
            est_benefit: document.getElementById('tp_benefit').value,
            status: document.getElementById('tp_status').value,
            note: document.getElementById('tp_note').value
        };
        try {
            await API.post('/api/tax-planning/preferences', body);
            UI.closeModal(); UI.toast(TP_L('已保存', '已儲存', 'Saved'), 'success');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async resetPolicy(uid) {
        if (!confirm(TP_L('确认删除人工登记，恢复系统自动判定？', '確認刪除人工登記，恢復系統自動判定？', 'Delete manual entry and restore auto judgment?'))) return;
        try {
            await API.del(`/api/tax-planning/preferences/${uid}`);
            UI.toast(TP_L('已恢复自动判定', '已恢復自動判定', 'Auto judgment restored'), 'success');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async scan() {
        try {
            const res = await API.post('/api/tax-planning/scan', { bu_no: this.bu, YYYY: this.year });
            const d = res.data || {};
            UI.toast(d.created ? `${TP_L('已生成', '已產生', 'Generated')} ${d.created} ${TP_L('条税务风险预警', '條稅務風險預警', 'tax risk alerts')}` : (res.message || TP_L('当前无新增风险', '當前無新增風險', 'No new risks')), d.created ? 'warning' : 'info');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};
