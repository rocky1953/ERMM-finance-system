/**
 * CFO-09 资金与流动性管理页面
 * 头寸与流动性比率、月度资金计划、集团资金池、短期偿债压力
 */
function clEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 三语标签：依当前界面语言取字（zh-CN / zh-TW / en）
const CL2_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] ?? zh);

const CASH_ITEM_TYPES = {
    SALES_COLLECTION: ['销售回款', '銷售回款', 'Sales Collection'],
    OTHER_INFLOW: ['其他流入', '其他流入', 'Other Inflow'],
    PURCHASE_PAYMENT: ['采购付款', '採購付款', 'Purchase Payment'],
    PAYROLL: ['薪酬支付', '薪酬支付', 'Payroll'],
    TAX: ['税费缴纳', '稅費繳納', 'Tax Payment'],
    CAPEX: ['资本支出', '資本支出', 'Capex'],
    LOAN_REPAY: ['还本付息', '還本付息', 'Loan Repayment'],
    OTHER_OUTFLOW: ['其他流出', '其他流出', 'Other Outflow']
};
const CASH_IN_TYPES = ['SALES_COLLECTION', 'OTHER_INFLOW'];
const clItemTypeLabel = (key) => {
    const v = CASH_ITEM_TYPES[key];
    return v ? CL2_L(v[0], v[1], v[2]) : (key || '-');
};

registerPage('cashLiquidity', async (c) => {
    const bu = ['HM', 'HN', 'SZ'].includes(State.bu_no) ? State.bu_no : 'HM';
    CashLiq.bu = bu;
    // 初次載入依「畫面最上方」全域年月
    CashLiq.month = (State.YYYY_MM && /^\d{4}-\d{2}$/.test(State.YYYY_MM)) ? State.YYYY_MM : '';
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
            <h2 style="margin:0;font-size:20px;">${CL2_L('资金与流动性管理', '資金與流動性管理', 'Cash & Liquidity Management')} <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">${CL2_L('：金额单位 RMB', '：金額單位 RMB', ': Amounts in RMB')}</small></h2>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <select id="clBu" class="form-control" style="width:90px;" onchange="CashLiq.reload()">
                    <option value="HM">HM</option><option value="HN">HN</option><option value="SZ">SZ</option>
                </select>
                <input id="clMonth" type="month" class="form-control" style="width:150px;" onchange="CashLiq.reload()">
                <button class="btn btn-warning" onclick="CashLiq.scan()">⚠️ ${CL2_L('扫描流动性风险', '掃描流動性風險', 'Scan Liquidity Risk')}</button>
                <button class="btn btn-primary" onclick="CashLiq.editPlanItem()">+ ${CL2_L('新增计划项', '新增計劃項', 'New Plan Item')}</button>
                <button class="btn btn-success" onclick="CashLiq.load()">${CL2_L('刷新', '重新整理', 'Refresh')}</button>
            </div>
        </div>
        <div id="clKpi" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:12px;margin-bottom:14px;"></div>
        <div id="clAlerts"></div>
        <div class="card" style="margin-bottom:14px;">
            <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
                <span>${CL2_L('月度资金计划', '月度資金計劃', 'Monthly Cash Plan')}</span>
                <button class="btn btn-sm btn-primary" onclick="CashLiq.editPlanItem()">+ ${CL2_L('新增计划项', '新增計劃項', 'New Plan Item')}</button>
            </div>
            <div id="clPlanSummary" style="margin-bottom:10px;"></div>
            <div id="clPlanTable">${t('loading')}</div>
        </div>
        <div class="card" style="margin-bottom:14px;">
            <div class="card-title">${CL2_L('集团资金池', '集團資金池', 'Group Cash Pool')}</div>
            <div id="clGroupTable">${t('loading')}</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px;">
            <div class="card" style="margin:0;">
                <div class="card-title">${CL2_L('90 天内到期贷款', '90 天內到期貸款', 'Loans Due within 90 Days')}</div>
                <div id="clLoanTable">${t('loading')}</div>
            </div>
            <div class="card" style="margin:0;">
                <div class="card-title">${CL2_L('30 天内待付款', '30 天內待付款', 'Payables Due within 30 Days')}</div>
                <div id="clPendingTable">${t('loading')}</div>
            </div>
        </div>
    `;
    document.getElementById('clBu').value = bu;
    if (CashLiq.month) document.getElementById('clMonth').value = CashLiq.month;
    await CashLiq.load();
});

const CashLiq = {
    bu: 'HM',
    month: '',
    data: null,

    async reload() {
        this.bu = document.getElementById('clBu').value;
        this.month = String(document.getElementById('clMonth').value || '').trim();
        await this.load();
    },

    async load() {
        const box = document.getElementById('clPlanTable');
        if (box) box.innerHTML = t('loading');
        try {
            let url = `/api/cash-liquidity/overview?bu_no=${encodeURIComponent(this.bu)}`;
            if (this.month) url += `&YYYY_MM=${encodeURIComponent(this.month)}`;
            const res = await API.get(url);
            this.data = res.data;
            this.month = res.data.YYYY_MM;
            const mi = document.getElementById('clMonth');
            if (mi && !mi.value) mi.value = this.month;
            this.render();
        } catch (e) {
            if (box) box.innerHTML = `<p style="color:#e74c3c">${clEsc(e.message)}</p>`;
        }
    },

    render() {
        this.renderKpis();
        this.renderAlerts();
        this.renderPlan();
        this.renderGroup();
        this.renderLoans();
        this.renderPending();
    },

    renderKpis() {
        const d = this.data;
        const p = d.position;
        const el = document.getElementById('clKpi');
        if (!p) {
            el.innerHTML = `<div class="card" style="margin:0;padding:14px;grid-column:1 / -1;color:#e74c3c;">
                ${CL2_L('暂无财务摘要数据', '暫無財務摘要數據', 'No financial summary data')}${(d.warnings || []).length ? CL2_L('：', ':', ': ') + clEsc(I18N.fixAlert(d.warnings[0])) : ''}</div>`;
            return;
        }
        const safe = d.safe || {};
        const planSummary = (d.plan && d.plan.summary) || {};
        const cards = [
            [CL2_L('现金及存款', '現金及存款', 'Cash & Deposits'), `¥ ${UI.fmt(p.cash)}`, '#2c3e50'],
            [CL2_L('安全水位', '安全水位', 'Safety Level'), `¥ ${UI.fmt(safe.amount)}${safe.source === 'HEURISTIC' ? ' *' : ''}`, '#7f8c8d'],
            [CL2_L('可动用盈余', '可動用盈餘', 'Available Surplus'), `¥ ${UI.fmt(p.surplus)}`, p.surplus >= 0 ? '#27ae60' : '#e74c3c'],
            [CL2_L('流动比率', '流動比率', 'Current Ratio'), p.current_ratio == null ? '-' : UI.fmt(p.current_ratio, 2), p.current_ratio == null || p.current_ratio >= 1 ? '#27ae60' : '#e74c3c'],
            [CL2_L('速动比率', '速動比率', 'Quick Ratio'), p.quick_ratio == null ? '-' : UI.fmt(p.quick_ratio, 2), p.quick_ratio == null || p.quick_ratio >= 1 ? '#27ae60' : '#e67e22'],
            [CL2_L('现金比率', '現金比率', 'Cash Ratio'), p.cash_ratio == null ? '-' : UI.fmt(p.cash_ratio, 2), p.cash_ratio == null || p.cash_ratio >= 0.2 ? '#27ae60' : '#e74c3c'],
            [CL2_L('现金覆盖月数', '現金覆蓋月數', 'Cash Cover (Months)'), p.cash_cover_months == null ? '-' : `${UI.fmt(p.cash_cover_months, 1)} ${CL2_L('个月', '個月', 'months')}`, '#2980b9'],
            [CL2_L('计划期末余额', '計劃期末餘額', 'Planned Closing Balance'), `¥ ${UI.fmt(planSummary.closing_plan)}`, Number(planSummary.closing_plan) >= Number(safe.amount) ? '#27ae60' : '#e74c3c']
        ];
        el.innerHTML = cards.map(([label, val, color]) => `
            <div class="card" style="margin:0;padding:14px;">
                <div style="font-size:12px;color:#7f8c8d;">${label}</div>
                <div style="font-size:20px;font-weight:700;color:${color};margin-top:4px;">${val}</div>
            </div>`).join('');
    },

    renderAlerts() {
        const d = this.data;
        const rows = d.alerts || [];
        const el = document.getElementById('clAlerts');
        const html = [];
        if ((d.warnings || []).length) {
            html.push(`<div style="background:#f4f6f8;padding:10px 12px;border-radius:6px;font-size:12px;color:#7f8c8d;margin-bottom:8px;">
                ⓘ ${d.warnings.map(w => clEsc(I18N.fixAlert(w))).join(I18N.lang === 'en' ? '; ' : '；')}</div>`);
        }
        if (rows.length) {
            html.push(rows.map(a => `
                <div style="background:${a.level === 'danger' ? '#fdecea' : '#fff8e1'};border-left:4px solid ${a.level === 'danger' ? '#e74c3c' : '#f39c12'};padding:10px 12px;border-radius:6px;margin-bottom:8px;font-size:13px;">
                    <div>${a.level === 'danger' ? '🔴' : '🟡'} ${clEsc(I18N.fixAlert(a.message))}</div>
                    <div style="font-size:12px;color:#7f8c8d;margin-top:3px;">${CL2_L('建议：', '建議：', 'Suggestion: ')}${clEsc(I18N.fixAlert(a.suggestion))}</div>
                </div>`).join(''));
        } else if (d.position) {
            html.push(`<div style="background:#eafaf1;border-left:4px solid #27ae60;padding:10px 12px;border-radius:6px;margin-bottom:12px;font-size:13px;">✅ ${CL2_L('流动性指标正常，未触发风险规则', '流動性指標正常，未觸發風險規則', 'Liquidity ratios normal; no risk rules triggered')}</div>`);
        }
        el.innerHTML = html.join('');
    },

    renderPlan() {
        const d = this.data;
        const plan = d.plan || { items: [], summary: {} };
        const s = plan.summary || {};
        const summaryEl = document.getElementById('clPlanSummary');
        const safe = Number((d.safe || {}).amount || 0);
        const items = [
            [CL2_L('期初现金', '期初現金', 'Opening Cash'), s.opening_cash, '#2c3e50'],
            [CL2_L('计划流入', '計劃流入', 'Planned Inflow'), s.plan_in, '#27ae60'],
            [CL2_L('计划流出', '計劃流出', 'Planned Outflow'), s.plan_out, '#e74c3c'],
            [CL2_L('计划净流量', '計劃淨流量', 'Planned Net Flow'), s.plan_net, s.plan_net >= 0 ? '#27ae60' : '#e74c3c'],
            [CL2_L('计划期末', '計劃期末', 'Planned Closing'), s.closing_plan, Number(s.closing_plan) >= safe ? '#27ae60' : '#e74c3c'],
            [CL2_L('实际净流量', '實際淨流量', 'Actual Net Flow'), s.actual_net_cash, s.actual_net_cash == null ? '#95a5a6' : (s.actual_net_cash >= 0 ? '#27ae60' : '#e74c3c')],
            [CL2_L('计划偏差', '計劃偏差', 'Plan Variance'), s.variance, s.variance == null ? '#95a5a6' : (s.variance >= 0 ? '#27ae60' : '#e67e22')]
        ];
        summaryEl.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;background:#f8f9fa;padding:10px 12px;border-radius:6px;">
                ${items.map(([label, val, color]) => `
                    <div>
                        <div style="font-size:12px;color:#7f8c8d;">${label}</div>
                        <div style="font-size:15px;font-weight:600;color:${color};">${val == null ? '-' : '¥ ' + UI.fmt(val)}</div>
                    </div>`).join('')}
            </div>`;

        const rows = plan.items || [];
        const el = document.getElementById('clPlanTable');
        if (!rows.length) {
            el.innerHTML = UI.empty('💵', `${plan.month || ''} ${CL2_L('尚无资金计划项，点击「新增计划项」开始编制', '尚無資金計劃項，點擊「新增計劃項」開始編制', 'no cash plan items yet. Click "New Plan Item" to start')}`);
            return;
        }
        const cell = 'padding:8px;border:1px solid #eee;';
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#f8f9fa;">
                    <th style="padding:8px;border:1px solid #eee;">${CL2_L('方向', '方向', 'Direction')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${CL2_L('类型', '類型', 'Type')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${CL2_L('计划项', '計劃項', 'Plan Item')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${CL2_L('计划金额', '計劃金額', 'Planned')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${CL2_L('实际金额', '實際金額', 'Actual')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${CL2_L('差异', '差異', 'Diff')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${CL2_L('备注', '備註', 'Note')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${CL2_L('操作', '操作', 'Actions')}</th>
                </tr></thead>
                <tbody>
                    ${rows.map(r => {
                        const diff = r.actual_amount - r.plan_amount;
                        const diffColor = diff === 0 ? '#7f8c8d' : (r.direction === 'IN' ? (diff >= 0 ? '#27ae60' : '#e74c3c') : (diff <= 0 ? '#27ae60' : '#e67e22'));
                        return `<tr>
                            <td style="${cell}"><span style="color:${r.direction === 'IN' ? '#27ae60' : '#e74c3c'};font-weight:600;">${r.direction === 'IN' ? CL2_L('流入', '流入', 'Inflow') : CL2_L('流出', '流出', 'Outflow')}</span></td>
                            <td style="${cell}">${clItemTypeLabel(r.item_type)}</td>
                            <td style="${cell}">${clEsc(r.item_name)}</td>
                            <td style="${cell}text-align:right;">${UI.fmt(r.plan_amount)}</td>
                            <td style="${cell}text-align:right;">${UI.fmt(r.actual_amount)}</td>
                            <td style="${cell}text-align:right;color:${diffColor};">${diff > 0 ? '+' : ''}${UI.fmt(diff)}</td>
                            <td style="${cell}color:#7f8c8d;">${clEsc(r.note || '')}</td>
                            <td style="${cell}white-space:nowrap;">
                                <button class="btn btn-sm btn-outline" onclick="CashLiq.editPlanItem(${r.uid})">${CL2_L('编辑', '編輯', 'Edit')}</button>
                                <button class="btn btn-sm btn-danger" onclick="CashLiq.delPlanItem(${r.uid})">${CL2_L('删除', '刪除', 'Delete')}</button>
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
            </div>`;
    },

    renderGroup() {
        const g = (this.data && this.data.group) || { rows: [], totals: {}, transfers: [] };
        const el = document.getElementById('clGroupTable');
        if (!(g.rows || []).length) { el.innerHTML = UI.empty('🏦', CL2_L('尚无集团头寸数据', '尚無集團頭寸數據', 'No group position data')); return; }
        const cell = 'padding:8px;border:1px solid #eee;';
        const transfers = (g.transfers || []).length
            ? (g.transfers || []).map(t => `<span style="display:inline-block;background:#eaf2f8;color:#2980b9;border-radius:12px;padding:2px 10px;margin:2px 4px 2px 0;font-size:12px;">
                    ${clEsc(t.from)} → ${clEsc(t.to)}：¥ ${UI.fmt(t.amount)}</span>`).join('')
            : `<span style="color:#7f8c8d;font-size:12px;">${CL2_L('各公司均无资金缺口，无需调剂', '各公司均無資金缺口，無需調劑', 'No funding gaps across companies; no transfers needed')}</span>`;

        el.innerHTML = `
            <div style="overflow-x:auto;margin-bottom:10px;">
            <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#f8f9fa;">
                    <th style="padding:8px;border:1px solid #eee;">${CL2_L('公司', '公司', 'BU')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${CL2_L('数据月份', '數據月份', 'Data Month')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${CL2_L('现金及存款', '現金及存款', 'Cash & Deposits')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${CL2_L('安全水位', '安全水位', 'Safety Level')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${CL2_L('盈余 / 缺口', '盈餘 / 缺口', 'Surplus / Gap')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${CL2_L('流动比率', '流動比率', 'Current Ratio')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${CL2_L('计划期末', '計劃期末', 'Planned Closing')}</th>
                </tr></thead>
                <tbody>
                    ${(g.rows || []).map(r => `<tr${r.bu_no === this.bu ? ' style="background:#fcfcf7;"' : ''}>
                        <td style="${cell}font-weight:600;">${clEsc(r.bu_no)}</td>
                        <td style="${cell}color:#7f8c8d;">${clEsc(r.actual_month || '-')}</td>
                        <td style="${cell}text-align:right;">${UI.fmt(r.cash)}</td>
                        <td style="${cell}text-align:right;">${UI.fmt(r.safe)}</td>
                        <td style="${cell}text-align:right;font-weight:600;color:${r.surplus >= 0 ? '#27ae60' : '#e74c3c'};">${r.surplus >= 0 ? '+' : ''}${UI.fmt(r.surplus)}</td>
                        <td style="${cell}text-align:right;">${r.current_ratio == null ? '-' : UI.fmt(r.current_ratio, 2)}</td>
                        <td style="${cell}text-align:right;">${UI.fmt(r.closing_plan)}</td>
                    </tr>`).join('')}
                    <tr style="background:#f8f9fa;font-weight:600;">
                        <td style="${cell}">${CL2_L('合计', '合計', 'Total')}</td>
                        <td style="${cell}"></td>
                        <td style="${cell}text-align:right;">${UI.fmt((g.totals || {}).cash)}</td>
                        <td style="${cell}text-align:right;">${UI.fmt((g.totals || {}).safe)}</td>
                        <td style="${cell}text-align:right;">
                            <span style="color:#27ae60;">+${UI.fmt((g.totals || {}).surplus)}</span> /
                            <span style="color:#e74c3c;">-${UI.fmt((g.totals || {}).gap)}</span>
                        </td>
                        <td style="${cell}"></td>
                        <td style="${cell}"></td>
                    </tr>
                </tbody>
            </table>
            </div>
            <div style="font-size:12px;color:#7f8c8d;margin-bottom:4px;">${CL2_L('内部调剂建议', '內部調劑建議', 'Internal Transfer Suggestions')}</div>
            <div>${transfers}</div>`;
    },

    renderLoans() {
        const d = this.data;
        const loans = d.loans || { items: [], total: 0, due_30: 0 };
        const el = document.getElementById('clLoanTable');
        const rows = loans.items || [];
        if (!rows.length) { el.innerHTML = UI.empty('🏦', CL2_L(`${loans.days || 90} 天内无到期贷款`, `${loans.days || 90} 天內無到期貸款`, `No loans due within ${loans.days || 90} days`)); return; }
        const cell = 'padding:8px;border:1px solid #eee;';
        el.innerHTML = `
            <div style="font-size:12px;color:#7f8c8d;margin-bottom:6px;">
                ${CL2_L(`合计 ${UI.fmt(loans.total)} 元，其中 30 天内 ${UI.fmt(loans.due_30)} 元`, `合計 ${UI.fmt(loans.total)} 元，其中 30 天內 ${UI.fmt(loans.due_30)} 元`, `Total ${UI.fmt(loans.total)}; due within 30 days: ${UI.fmt(loans.due_30)}`)}
            </div>
            <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#f8f9fa;">
                    <th style="padding:8px;border:1px solid #eee;">${CL2_L('贷款编号', '貸款編號', 'Loan No.')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${CL2_L('银行', '銀行', 'Bank')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${CL2_L('剩余本金', '剩餘本金', 'Remaining Principal')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${CL2_L('到期日', '到期日', 'Maturity')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${CL2_L('剩余天数', '剩餘天數', 'Days to Due')}</th>
                </tr></thead>
                <tbody>
                    ${rows.map(r => `<tr>
                        <td style="${cell}">${clEsc(r.loan_id || '-')}</td>
                        <td style="${cell}">${clEsc(r.bank_id || '-')}</td>
                        <td style="${cell}text-align:right;">${UI.fmt(r.remaining)}</td>
                        <td style="${cell}">${UI.fmtDate(r.end_date)}</td>
                        <td style="${cell}text-align:right;color:${r.days_to_due <= 30 ? '#e74c3c' : '#e67e22'};">${r.days_to_due}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
    },

    renderPending() {
        const d = this.data;
        const pending = d.pending_payments || { items: [], count: 0, amount: 0 };
        const el = document.getElementById('clPendingTable');
        const rows = pending.items || [];
        if (!rows.length) {
            el.innerHTML = UI.empty('📄', CL2_L(`${pending.days || 30} 天内无待付款`, `${pending.days || 30} 天內無待付款`, `No payables due within ${pending.days || 30} days`));
            return;
        }
        const cell = 'padding:8px;border:1px solid #eee;';
        el.innerHTML = `
            <div style="font-size:12px;color:#7f8c8d;margin-bottom:6px;">
                ${CL2_L(`共 ${pending.count} 笔，合计 ${UI.fmt(pending.amount)} 元`, `共 ${pending.count} 筆，合計 ${UI.fmt(pending.amount)} 元`, `${pending.count} items, total ${UI.fmt(pending.amount)}`)}
            </div>
            <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#f8f9fa;">
                    <th style="padding:8px;border:1px solid #eee;">${CL2_L('单号', '單號', 'Doc No.')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${CL2_L('收款方', '收款方', 'Payee')}</th>
                    <th style="padding:8px;border:1px solid #eee;text-align:right;">${CL2_L('金额', '金額', 'Amount')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${CL2_L('预计付款日', '預計付款日', 'Expected Pay Date')}</th>
                    <th style="padding:8px;border:1px solid #eee;">${CL2_L('状态', '狀態', 'Status')}</th>
                </tr></thead>
                <tbody>
                    ${rows.map(r => `<tr>
                        <td style="${cell}">${clEsc(r.request_no || r.id)}</td>
                        <td style="${cell}">${clEsc(r.pay_target || '-')}</td>
                        <td style="${cell}text-align:right;">${UI.fmt(r.amount)}</td>
                        <td style="${cell}">${UI.fmtDate(r.due_date)}</td>
                        <td style="${cell}">${clEsc(r.status || '-')}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
    },

    // ===== 资金计划项编辑 =====
    editPlanItem(uid) {
        const plan = (this.data && this.data.plan) || { items: [] };
        const it = uid ? (plan.items || []).find(x => x.uid === uid) : null;
        const v = (k, dft = '') => it && it[k] != null ? it[k] : dft;
        const typeOpts = Object.entries(CASH_ITEM_TYPES).map(([k, label]) =>
            `<option value="${k}" ${String(v('item_type', 'SALES_COLLECTION')) === k ? 'selected' : ''}>${CASH_IN_TYPES.includes(k) ? CL2_L('流入', '流入', 'Inflow') : CL2_L('流出', '流出', 'Outflow')} · ${CL2_L(label[0], label[1], label[2])}</option>`).join('');

        UI.modal(it ? CL2_L('编辑资金计划项', '編輯資金計劃項', 'Edit Cash Plan Item') : `${CL2_L('新增资金计划项', '新增資金計劃項', 'New Cash Plan Item')} · ${plan.month || this.month}`, `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;min-width:480px;">
                <div><label class="form-label">${CL2_L('计划月份', '計劃月份', 'Plan Month')}</label><input id="clPlanMonth" type="month" class="form-control" value="${plan.month || this.month}"></div>
                <div><label class="form-label">${CL2_L('类型', '類型', 'Type')}</label><select id="clPlanType" class="form-control">${typeOpts}</select></div>
                <div style="grid-column:1 / span 2;"><label class="form-label">${CL2_L('计划项名称', '計劃項名稱', 'Plan Item Name')}</label><input id="clPlanName" class="form-control" value="${clEsc(v('item_name'))}"></div>
                <div><label class="form-label">${CL2_L('计划金额', '計劃金額', 'Planned Amount')}</label><input id="clPlanAmount" type="number" step="0.01" min="0" class="form-control" value="${v('plan_amount', '')}"></div>
                <div><label class="form-label">${CL2_L('实际金额', '實際金額', 'Actual Amount')}</label><input id="clPlanActual" type="number" step="0.01" min="0" class="form-control" value="${v('actual_amount', '')}"></div>
                <div style="grid-column:1 / span 2;"><label class="form-label">${CL2_L('备注', '備註', 'Note')}</label><input id="clPlanNote" class="form-control" value="${clEsc(v('note'))}"></div>
            </div>`,
            `<button class="btn btn-outline" onclick="UI.closeModal()">${CL2_L('取消', '取消', 'Cancel')}</button>
             <button class="btn btn-primary" onclick="CashLiq.savePlanItem(${uid || 0})">${CL2_L('保存', '儲存', 'Save')}</button>`);
    },

    async savePlanItem(uid) {
        const body = {
            bu_no: this.bu,
            plan_month: document.getElementById('clPlanMonth').value,
            item_type: document.getElementById('clPlanType').value,
            item_name: document.getElementById('clPlanName').value,
            plan_amount: document.getElementById('clPlanAmount').value,
            actual_amount: document.getElementById('clPlanActual').value,
            note: document.getElementById('clPlanNote').value
        };
        try {
            if (uid) await API.put(`/api/cash-liquidity/plans/${uid}`, body);
            else await API.post('/api/cash-liquidity/plans', body);
            UI.closeModal(); UI.toast(CL2_L('已保存', '已儲存', 'Saved'), 'success');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async delPlanItem(uid) {
        if (!confirm(CL2_L('确认删除该资金计划项？', '確認刪除該資金計劃項？', 'Delete this cash plan item?'))) return;
        try {
            await API.del(`/api/cash-liquidity/plans/${uid}`);
            UI.toast(CL2_L('已删除', '已刪除', 'Deleted'), 'success');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async scan() {
        try {
            const res = await API.post('/api/cash-liquidity/scan', {
                bu_no: this.bu,
                YYYY_MM: this.month
            });
            const d = res.data || {};
            UI.toast(d.new_alerts
                ? CL2_L(`已生成 ${d.new_alerts} 条流动性风险预警`, `已產生 ${d.new_alerts} 條流動性風險預警`, `${d.new_alerts} liquidity risk alert(s) generated`)
                : (d.suppressed ? CL2_L('风险项均已预警（24 小时内去重）', '風險項均已預警（24 小時內去重）', 'All risk items already alerted (deduped within 24h)') : CL2_L('当前无流动性风险项', '目前無流動性風險項', 'No liquidity risk items currently')),
                d.new_alerts ? 'warning' : 'info');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};
