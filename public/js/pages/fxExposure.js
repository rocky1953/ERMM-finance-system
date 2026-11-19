/**
 * CFO-08 汇率敞口与对冲页面
 * 基础币别 RMB：原币金额 × 折算汇率 = 折合 RMB
 */
function fxEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 三语标签：依当前界面语言取字（zh-CN / zh-TW / en）
const FX_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] ?? zh);

const FX_TYPE_LABELS = {
    AR: ['应收', '應收', 'Receivable'],
    AP: ['应付', '應付', 'Payable'],
    LOAN: ['借款', '借款', 'Loan'],
    CASH: ['现金', '現金', 'Cash'],
    OTHER: ['其他', '其他', 'Other']
};
const FX_SOURCE_LABELS = {
    MANUAL: ['手工', '手工', 'Manual'],
    PAYABLE: ['应付同步', '應付同步', 'Payable sync'],
    LOAN: ['贷款同步', '貸款同步', 'Loan sync']
};
const HEDGE_TYPE_LABELS = {
    FORWARD: ['远期', '遠期', 'Forward'],
    SWAP: ['互换', '互換', 'Swap'],
    OPTION: ['期权', '期權', 'Option'],
    OTHER: ['其他', '其他', 'Other']
};
const HEDGE_STATUS_LABELS = {
    ACTIVE: ['有效', '有效', 'Active'],
    SETTLED: ['已交割', '已交割', 'Settled'],
    CANCELLED: ['已取消', '已取消', 'Cancelled']
};

function fxLabel(map, key) {
    const v = map[key];
    if (!v) return key || '-';
    return FX_L(v[0], v[1], v[2]);
}

function fxOptions(map, current) {
    return Object.entries(map).map(([k, v]) =>
        `<option value="${k}" ${current === k ? 'selected' : ''}>${FX_L(v[0], v[1], v[2])}</option>`).join('');
}
const FX_CCYS = ['RMB', 'USD', 'EUR', 'JPY', 'HKD', 'TWD'];

registerPage('fxExposure', async (c) => {
    const bu = ['HM', 'HN', 'SZ'].includes(State.bu_no) ? State.bu_no : 'HM';
    Fx.bu = bu;
    // 初次載入依「畫面最上方」全域年月
    Fx.month = (State.YYYY_MM && /^\d{4}-\d{2}$/.test(State.YYYY_MM)) ? State.YYYY_MM : '';
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
            <h2 style="margin:0;font-size:20px;">${FX_L('汇率敞口/对冲', '匯率敞口/對沖', 'FX Exposure & Hedging')} <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">： ${FX_L('基础币别 RMB', '基礎幣別 RMB', 'Base currency RMB')}</small></h2>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <select id="fxBu" class="form-control" style="width:90px;" onchange="Fx.reload()">
                    <option value="HM">HM</option><option value="HN">HN</option><option value="SZ">SZ</option>
                </select>
                <input id="fxMonth" type="month" class="form-control" style="width:150px;" onchange="Fx.reload()">
                <button class="btn btn-outline" onclick="Fx.sync()">🔄 ${FX_L('同步敞口', '同步敞口', 'Sync Exposure')}</button>
                <button class="btn btn-warning" onclick="Fx.scan()">⚠️ ${FX_L('生成风险预警', '產生風險預警', 'Generate Risk Alerts')}</button>
                <button class="btn btn-success" onclick="Fx.load()">${FX_L('刷新', '重新整理', 'Refresh')}</button>
            </div>
        </div>
        <div id="fxKpi" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:14px;"></div>
        <div id="fxRisk"></div>
        <div class="card" style="margin-bottom:14px;">
            <div class="card-title">${FX_L('币别敞口汇总', '幣別敞口彙總', 'Exposure by Currency')}</div>
            <div id="fxCcyTable">${t('loading')}</div>
        </div>
        <div class="card" style="margin-bottom:14px;">
            <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
                <span>${FX_L('敞口明细', '敞口明細', 'Exposure Details')}</span>
                <button class="btn btn-sm btn-primary" onclick="Fx.editItem()">+ ${FX_L('新增敞口', '新增敞口', 'New Exposure')}</button>
            </div>
            <div id="fxItemTable">${t('loading')}</div>
        </div>
        <div class="card">
            <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
                <span>${FX_L('对冲合约', '對沖合約', 'Hedge Contracts')}</span>
                <button class="btn btn-sm btn-primary" onclick="Fx.editHedge()">+ ${FX_L('新增对冲', '新增對沖', 'New Hedge')}</button>
            </div>
            <div id="fxHedgeTable">${t('loading')}</div>
        </div>
    `;
    document.getElementById('fxBu').value = bu;
    if (Fx.month) document.getElementById('fxMonth').value = Fx.month;
    await Fx.load();
});

const Fx = {
    bu: 'HM',
    month: '',
    data: null,

    async reload() {
        this.bu = document.getElementById('fxBu').value;
        const m = document.getElementById('fxMonth').value;
        this.month = m || '';
        await this.load();
    },

    async load() {
        const box = document.getElementById('fxCcyTable');
        if (box) box.innerHTML = t('loading');
        try {
            let url = `/api/fx/overview?bu_no=${encodeURIComponent(this.bu)}`;
            if (this.month) url += `&YYYY_MM=${encodeURIComponent(this.month)}`;
            const res = await API.get(url);
            this.data = res.data;
            this.month = res.data.YYYY_MM;
            const mi = document.getElementById('fxMonth');
            if (mi && !mi.value) mi.value = this.month;
            this.render();
        } catch (e) {
            if (box) box.innerHTML = `<p style="color:#e74c3c">${fxEsc(e.message)}</p>`;
        }
    },

    render() {
        const d = this.data;
        const tot = d.totals || {};
        const cards = [
            [FX_L('敞口总额', '敞口總額', 'Gross Exposure'), `¥ ${UI.fmt(tot.gross_exposure)}`, '#2c3e50'],
            [FX_L('净敞口', '淨敞口', 'Net Exposure'), `¥ ${UI.fmt(tot.net_exposure)}`, Number(tot.net_exposure) >= 0 ? '#e67e22' : '#2980b9'],
            [FX_L('已对冲', '已對沖', 'Hedged'), `¥ ${UI.fmt(tot.hedged_amount)}`, '#8e44ad'],
            [FX_L('覆盖率', '覆蓋率', 'Coverage'), `${UI.fmt(tot.coverage)} %`, Number(tot.coverage) >= d.limits.min_coverage ? '#27ae60' : '#e74c3c'],
            [FX_L('风险提示', '風險提示', 'Risk Alerts'),
                I18N.lang === 'en' ? `${(d.risks || []).length}` : `${(d.risks || []).length} ${FX_L('项', '項', '')}`,
                (d.risks || []).length ? '#e74c3c' : '#27ae60']
        ];
        document.getElementById('fxKpi').innerHTML = cards.map(([label, val, color]) => `
            <div class="card" style="margin:0;padding:14px;">
                <div style="font-size:12px;color:#7f8c8d;">${label}</div>
                <div style="font-size:22px;font-weight:700;color:${color};margin-top:4px;">${val}</div>
            </div>`).join('');

        const riskHtml = [];
        if ((d.risks || []).length) {
            riskHtml.push((d.risks || []).map(r => `
                <div style="background:${r.level === 'danger' ? '#fdecea' : '#fff8e1'};border-left:4px solid ${r.level === 'danger' ? '#e74c3c' : '#f39c12'};padding:10px 12px;border-radius:6px;margin-bottom:8px;font-size:13px;">
                    ${r.level === 'danger' ? '🔴' : '🟡'} ${fxEsc(I18N.fixAlert(r.message))}
                </div>`).join(''));
        }
        if ((d.warnings || []).length) {
            riskHtml.push(`<div style="background:#f4f6f8;padding:10px 12px;border-radius:6px;font-size:12px;color:#7f8c8d;">
                ⓘ ${(d.warnings || []).map(w => fxEsc(I18N.fixAlert(w))).join(I18N.lang === 'en' ? '; ' : '；')}</div>`);
        }
        document.getElementById('fxRisk').innerHTML = riskHtml.join('');

        this.renderCurrencies();
        this.renderItems();
        this.renderHedges();
    },

    renderCurrencies() {
        const d = this.data;
        const rows = d.currencies || [];
        const el = document.getElementById('fxCcyTable');
        if (!rows.length) { el.innerHTML = UI.empty('🌐', FX_L('尚无敞口数据，可点击「同步敞口」或「新增敞口」', '尚無敞口資料，可點擊「同步敞口」或「新增敞口」', 'No exposure data. Use "Sync Exposure" or "New Exposure".')); return; }
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#f8f9fa;">
                    <th style="padding:8px;border:1px solid #eee;">${FX_L('币别', '幣別', 'Currency')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${FX_L('折算汇率', '折算匯率', 'Rate')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${FX_L('应收', '應收', 'Receivable')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${FX_L('应付', '應付', 'Payable')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${FX_L('借款', '借款', 'Loan')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${FX_L('现金', '現金', 'Cash')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${FX_L('其他', '其他', 'Other')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${FX_L('净敞口', '淨敞口', 'Net')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${FX_L('已对冲', '已對沖', 'Hedged')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${FX_L('对冲后净敞口', '對沖後淨敞口', 'Net after Hedge')}</th>
                </tr></thead>
                <tbody>
                    ${rows.map(r => {
                        const rate = d.rate_source && d.rate_source[r.currency];
                        return `<tr>
                            <td style="padding:8px;border:1px solid #eee;font-weight:600;">${fxEsc(r.currency)}</td>
                            <td style="padding:8px;border:1px solid #eee;text-align:right;color:#7f8c8d;">${rate ? UI.fmt(rate.rate, 6) : '-'}</td>
                            <td style="padding:8px;border:1px solid #eee;text-align:right;">${UI.fmt(r.AR)}</td>
                            <td style="padding:8px;border:1px solid #eee;text-align:right;">${UI.fmt(r.AP)}</td>
                            <td style="padding:8px;border:1px solid #eee;text-align:right;">${UI.fmt(r.LOAN)}</td>
                            <td style="padding:8px;border:1px solid #eee;text-align:right;">${UI.fmt(r.CASH)}</td>
                            <td style="padding:8px;border:1px solid #eee;text-align:right;">${UI.fmt(r.OTHER)}</td>
                            <td style="padding:8px;border:1px solid #eee;text-align:right;font-weight:600;color:${r.net >= 0 ? '#e67e22' : '#2980b9'};">${UI.fmt(r.net)}</td>
                            <td style="padding:8px;border:1px solid #eee;text-align:right;">${UI.fmt(r.hedge)}</td>
                            <td style="padding:8px;border:1px solid #eee;text-align:right;font-weight:600;">${UI.fmt(r.net_after_hedge)}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
            </div>`;
    },

    renderItems() {
        const rows = this.data.items || [];
        const el = document.getElementById('fxItemTable');
        if (!rows.length) { el.innerHTML = UI.empty('📄', FX_L('尚无敞口明细', '尚無敞口明細', 'No exposure details')); return; }
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#f8f9fa;">
                    <th style="padding:8px;border:1px solid #eee;">${FX_L('类型', '類型', 'Type')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${FX_L('币别', '幣別', 'Currency')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${FX_L('原币金额', '原幣金額', 'Amount (FX)')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${FX_L('汇率', '匯率', 'Rate')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${FX_L('折合 RMB', '折合 RMB', 'Amount (RMB)')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${FX_L('交易对手', '交易對手', 'Counterparty')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${FX_L('到期日', '到期日', 'Due Date')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${FX_L('来源', '來源', 'Source')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${FX_L('备注', '備註', 'Remark')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${FX_L('操作', '操作', 'Actions')}</th>
                </tr></thead>
                <tbody>
                    ${rows.map(r => `<tr>
                        <td style="padding:8px;border:1px solid #eee;">${fxLabel(FX_TYPE_LABELS, r.exposure_type)}</td>
                        <td style="padding:8px;border:1px solid #eee;">${fxEsc(r.currency)}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:right;">${UI.fmt(r.amount_fx)}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:right;color:#7f8c8d;">${UI.fmt(r.rate_to_rmb, 6)}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:right;font-weight:600;">${UI.fmt(r.amount_rmb)}</td>
                        <td style="padding:8px;border:1px solid #eee;">${fxEsc(r.counterparty || '-')}</td>
                        <td style="padding:8px;border:1px solid #eee;">${UI.fmtDate(r.due_date)}</td>
                        <td style="padding:8px;border:1px solid #eee;">${fxLabel(FX_SOURCE_LABELS, r.source)}</td>
                        <td style="padding:8px;border:1px solid #eee;color:#7f8c8d;">${fxEsc(r.remark || '')}</td>
                        <td style="padding:8px;border:1px solid #eee;white-space:nowrap;">
                            <button class="btn btn-sm btn-outline" onclick="Fx.editItem(${r.uid})">${FX_L('编辑', '編輯', 'Edit')}</button>
                            <button class="btn btn-sm btn-danger" onclick="Fx.delItem(${r.uid})">${FX_L('删除', '刪除', 'Delete')}</button>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
    },

    renderHedges() {
        const rows = this.data.hedges || [];
        const el = document.getElementById('fxHedgeTable');
        if (!rows.length) { el.innerHTML = UI.empty('🛡️', FX_L('尚无对冲合约', '尚無對沖合約', 'No hedge contracts')); return; }
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#f8f9fa;">
                    <th style="padding:8px;border:1px solid #eee;">${FX_L('类型', '類型', 'Type')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${FX_L('币别', '幣別', 'Currency')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${FX_L('名义本金', '名義本金', 'Notional')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${FX_L('折合 RMB', '折合 RMB', 'Amount (RMB)')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${FX_L('锁定汇率', '鎖定匯率', 'Hedge Rate')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${FX_L('到期日', '到期日', 'Maturity')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${FX_L('状态', '狀態', 'Status')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${FX_L('对手', '對手', 'Counterparty')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${FX_L('操作', '操作', 'Actions')}</th>
                </tr></thead>
                <tbody>
                    ${rows.map(r => `<tr>
                        <td style="padding:8px;border:1px solid #eee;">${fxLabel(HEDGE_TYPE_LABELS, r.hedge_type)}</td>
                        <td style="padding:8px;border:1px solid #eee;">${fxEsc(r.currency)}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:right;">${UI.fmt(r.notional_fx)}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:right;font-weight:600;">${UI.fmt(r.amount_rmb)}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:right;">${r.hedge_rate == null ? '-' : UI.fmt(r.hedge_rate, 6)}</td>
                        <td style="padding:8px;border:1px solid #eee;">${UI.fmtDate(r.maturity_date)}</td>
                        <td style="padding:8px;border:1px solid #eee;">${fxLabel(HEDGE_STATUS_LABELS, r.status)}</td>
                        <td style="padding:8px;border:1px solid #eee;">${fxEsc(r.counterparty || '-')}</td>
                        <td style="padding:8px;border:1px solid #eee;white-space:nowrap;">
                            <button class="btn btn-sm btn-outline" onclick="Fx.editHedge(${r.uid})">${FX_L('编辑', '編輯', 'Edit')}</button>
                            <button class="btn btn-sm btn-danger" onclick="Fx.delHedge(${r.uid})">${FX_L('删除', '刪除', 'Delete')}</button>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
    },

    editItem(uid) {
        const it = uid ? (this.data.items || []).find(x => x.uid === uid) : null;
        const v = (k, dft = '') => it && it[k] != null ? it[k] : dft;
        const ccyOpts = FX_CCYS.map(c => `<option value="${c}" ${v('currency', 'USD') === c ? 'selected' : ''}>${c}</option>`).join('');
        UI.modal(it ? FX_L('编辑敞口明细', '編輯敞口明細', 'Edit Exposure') : FX_L('新增敞口明细', '新增敞口明細', 'New Exposure'), `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;min-width:480px;">
                <div><label class="form-label">${FX_L('类型', '類型', 'Type')}</label><select id="fx_type" class="form-control">${fxOptions(FX_TYPE_LABELS, v('exposure_type', 'AP'))}</select></div>
                <div><label class="form-label">${FX_L('币别', '幣別', 'Currency')}</label><select id="fx_ccy" class="form-control">${ccyOpts}</select></div>
                <div><label class="form-label">${FX_L('原币金额', '原幣金額', 'Amount (FX)')}</label><input id="fx_amt" type="number" step="0.01" class="form-control" value="${v('amount_fx', '')}"></div>
                <div><label class="form-label">${FX_L('折算汇率（留空自动）', '折算匯率（留空自動）', 'Rate (blank = auto)')}</label><input id="fx_rate" type="number" step="0.000001" class="form-control" value="${v('rate_to_rmb', '')}"></div>
                <div><label class="form-label">${FX_L('交易对手', '交易對手', 'Counterparty')}</label><input id="fx_cp" class="form-control" value="${fxEsc(v('counterparty'))}"></div>
                <div><label class="form-label">${FX_L('到期日', '到期日', 'Due Date')}</label><input id="fx_due" type="date" class="form-control" value="${v('due_date') ? String(v('due_date')).substring(0, 10) : ''}"></div>
                <div style="grid-column:1 / span 2;"><label class="form-label">${FX_L('备注', '備註', 'Remark')}</label><input id="fx_rmk" class="form-control" value="${fxEsc(v('remark'))}"></div>
            </div>`,
            `<button class="btn btn-outline" onclick="UI.closeModal()">${FX_L('取消', '取消', 'Cancel')}</button>
             <button class="btn btn-primary" onclick="Fx.saveItem(${uid || 0})">${FX_L('保存', '儲存', 'Save')}</button>`);
    },

    async saveItem(uid) {
        const body = {
            bu_no: this.bu, YYYY_MM: this.month,
            exposure_type: document.getElementById('fx_type').value,
            currency: document.getElementById('fx_ccy').value,
            amount_fx: document.getElementById('fx_amt').value,
            rate_to_rmb: document.getElementById('fx_rate').value,
            counterparty: document.getElementById('fx_cp').value,
            due_date: document.getElementById('fx_due').value,
            remark: document.getElementById('fx_rmk').value
        };
        try {
            if (uid) await API.put(`/api/fx/items/${uid}`, body);
            else await API.post('/api/fx/items', body);
            UI.closeModal(); UI.toast(FX_L('已保存', '已儲存', 'Saved'), 'success');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async delItem(uid) {
        if (!confirm(FX_L('确认删除该敞口明细？', '確認刪除該敞口明細？', 'Delete this exposure detail?'))) return;
        try {
            await API.del(`/api/fx/items/${uid}`);
            UI.toast(FX_L('已删除', '已刪除', 'Deleted'), 'success');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    editHedge(uid) {
        const it = uid ? (this.data.hedges || []).find(x => x.uid === uid) : null;
        const v = (k, dft = '') => it && it[k] != null ? it[k] : dft;
        const ccyOpts = FX_CCYS.map(c => `<option value="${c}" ${v('currency', 'USD') === c ? 'selected' : ''}>${c}</option>`).join('');
        UI.modal(it ? FX_L('编辑对冲合约', '編輯對沖合約', 'Edit Hedge') : FX_L('新增对冲合约', '新增對沖合約', 'New Hedge'), `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;min-width:480px;">
                <div><label class="form-label">${FX_L('类型', '類型', 'Type')}</label><select id="fh_type" class="form-control">${fxOptions(HEDGE_TYPE_LABELS, v('hedge_type', 'FORWARD'))}</select></div>
                <div><label class="form-label">${FX_L('币别', '幣別', 'Currency')}</label><select id="fh_ccy" class="form-control">${ccyOpts}</select></div>
                <div><label class="form-label">${FX_L('名义本金', '名義本金', 'Notional')}</label><input id="fh_amt" type="number" step="0.01" class="form-control" value="${v('notional_fx', '')}"></div>
                <div><label class="form-label">${FX_L('折算汇率（留空自动）', '折算匯率（留空自動）', 'Rate (blank = auto)')}</label><input id="fh_rate" type="number" step="0.000001" class="form-control" value="${v('rate_to_rmb', '')}"></div>
                <div><label class="form-label">${FX_L('锁定汇率', '鎖定匯率', 'Hedge Rate')}</label><input id="fh_hrate" type="number" step="0.000001" class="form-control" value="${v('hedge_rate', '')}"></div>
                <div><label class="form-label">${FX_L('到期日', '到期日', 'Maturity')}</label><input id="fh_due" type="date" class="form-control" value="${v('maturity_date') ? String(v('maturity_date')).substring(0, 10) : ''}"></div>
                <div><label class="form-label">${FX_L('交易对手', '交易對手', 'Counterparty')}</label><input id="fh_cp" class="form-control" value="${fxEsc(v('counterparty'))}"></div>
                <div><label class="form-label">${FX_L('状态', '狀態', 'Status')}</label><select id="fh_status" class="form-control">${fxOptions(HEDGE_STATUS_LABELS, v('status', 'ACTIVE'))}</select></div>
                <div style="grid-column:1 / span 2;"><label class="form-label">${FX_L('备注', '備註', 'Remark')}</label><input id="fh_rmk" class="form-control" value="${fxEsc(v('remark'))}"></div>
            </div>`,
            `<button class="btn btn-outline" onclick="UI.closeModal()">${FX_L('取消', '取消', 'Cancel')}</button>
             <button class="btn btn-primary" onclick="Fx.saveHedge(${uid || 0})">${FX_L('保存', '儲存', 'Save')}</button>`);
    },

    async saveHedge(uid) {
        const body = {
            bu_no: this.bu, YYYY_MM: this.month,
            hedge_type: document.getElementById('fh_type').value,
            currency: document.getElementById('fh_ccy').value,
            notional_fx: document.getElementById('fh_amt').value,
            rate_to_rmb: document.getElementById('fh_rate').value,
            hedge_rate: document.getElementById('fh_hrate').value,
            maturity_date: document.getElementById('fh_due').value,
            counterparty: document.getElementById('fh_cp').value,
            status: document.getElementById('fh_status').value,
            remark: document.getElementById('fh_rmk').value
        };
        try {
            if (uid) await API.put(`/api/fx/hedges/${uid}`, body);
            else await API.post('/api/fx/hedges', body);
            UI.closeModal(); UI.toast(FX_L('已保存', '已儲存', 'Saved'), 'success');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async delHedge(uid) {
        if (!confirm(FX_L('确认删除该对冲合约？', '確認刪除該對沖合約？', 'Delete this hedge contract?'))) return;
        try {
            await API.del(`/api/fx/hedges/${uid}`);
            UI.toast(FX_L('已删除', '已刪除', 'Deleted'), 'success');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async sync() {
        try {
            const res = await API.post('/api/fx/sync', { bu_no: this.bu, YYYY_MM: this.month });
            const d = res.data || {};
            UI.toast(I18N.lang === 'en'
                ? `Sync done: ${d.created || 0} created (payable ${d.payable || 0} / loan ${d.loan || 0})`
                : FX_L(`同步完成：新增 ${d.created || 0} 条（应付 ${d.payable || 0} / 贷款 ${d.loan || 0}）`,
                    `同步完成：新增 ${d.created || 0} 條（應付 ${d.payable || 0} / 貸款 ${d.loan || 0}）`, ''), 'success');
            if ((d.warnings || []).length) UI.toast(d.warnings.map(w => I18N.fixAlert(w)).join(I18N.lang === 'en' ? '; ' : '；'), 'info');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async scan() {
        try {
            const res = await API.post('/api/fx/scan', { bu_no: this.bu, YYYY_MM: this.month });
            const d = res.data || {};
            UI.toast(d.created
                ? (I18N.lang === 'en' ? `${d.created} FX risk alert(s) generated`
                    : FX_L(`已生成 ${d.created} 条汇率风险预警`, `已產生 ${d.created} 條匯率風險預警`, ''))
                : (I18N.fixAlert(d.message) || FX_L('当前无风险项', '目前無風險項', 'No risk items')), d.created ? 'warning' : 'info');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};
