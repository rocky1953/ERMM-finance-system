/**
 * 滚动预算与三表联动（CFO-05）
 * 损益表 / 资产负债表 / 现金流量表 / 13 周现金 / 假设参数
 */
const RB_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] || zh);

const RollingBudgetPage = {
    bu: State.bu_no,
    tab: 'pl',        // pl | bs | cf | cash | assumption
    months: 12,
    data: null,
    cash: null,
    assumption: null,
    chart: null,

    docs: [
        { k: 'pl', zh: '损益表', tw: '損益表', en: 'P&L' },
        { k: 'bs', zh: '资产负债表', tw: '資產負債表', en: 'Balance Sheet' },
        { k: 'cf', zh: '现金流量表', tw: '現金流量表', en: 'Cash Flow' },
        { k: 'cash', zh: '13 周现金', tw: '13 週現金', en: '13-Week Cash' },
        { k: 'assumption', zh: '假设参数', tw: '假設參數', en: 'Assumptions' },
    ],

    async load() {
        if (!Auth.isLoggedIn()) { Auth.showLogin(); return; }
        document.getElementById('pageTitle').textContent = RB_L('滚动预算', '滾動預算', 'Rolling Budget');
        const _bu = await CodeHelper.buSel();
        document.getElementById('pageContent').innerHTML = `
            <div class="page-header">
                <div class="tabs">${this.docs.map(d => `<div class="tab-item ${this.tab === d.k ? 'active' : ''}" onclick="RollingBudgetPage.switchTab('${d.k}')">${RB_L(d.zh, d.tw, d.en)}</div>`).join('')}</div>
                <div class="page-actions">
                    <select id="rbBu" class="form-input" style="width:110px" onchange="RollingBudgetPage.setBu(this.value)">${_bu}</select>
                    <select id="rbMonths" class="form-input" style="width:110px" onchange="RollingBudgetPage.setMonths(this.value)">
                        ${[12, 18, 24].map(n => `<option value="${n}" ${this.months === n ? 'selected' : ''}>${n} ${RB_L('个月', '個月', 'months')}</option>`).join('')}
                    </select>
                    <button class="btn btn-ghost" onclick="RollingBudgetPage.loadCurrent()">🔄 ${RB_L('刷新', '重新整理', 'Refresh')}</button>
                </div>
            </div>
            <div id="rbBody"><div style="padding:40px;text-align:center;color:#999">⏳</div></div>
        `;
        document.getElementById('rbBu').value = this.bu;
        await this.loadCurrent();
    },

    switchTab(t) { this.tab = t; this.render(); },
    setBu(b) { this.bu = b; State.bu_no = b; this.loadCurrent(); },
    setMonths(n) { this.months = Number(n) || 12; this.loadCurrent(); },

    async loadCurrent() {
        const el = document.getElementById('rbBody');
        el.innerHTML = `<div style="padding:30px;text-align:center;color:#999">⏳</div>`;
        try {
            const [pRes, aRes] = await Promise.all([
                API.get(`/api/rolling-budget/projection?bu_no=${this.bu}&months=${this.months}`),
                API.get(`/api/rolling-budget/assumption?bu_no=${this.bu}`)
            ]);
            this.data = pRes.data || {};
            this.assumption = aRes.data || {};
            if (this.tab === 'cash') {
                const cRes = await API.get(`/api/rolling-budget/13w?bu_no=${this.bu}`);
                this.cash = cRes.data || {};
            }
            this.render();
        } catch (e) {
            el.innerHTML = `<div style="padding:20px;color:#e74c3c">${e.message}</div>`;
        }
    },

    fmt(v) {
        const n = Number(v || 0);
        return `<span style="color:${n < 0 ? '#dc2626' : 'inherit'}">${UI.fmt(n)}</span>`;
    },

    kpiCards() {
        const s = (this.data && this.data.summary) || {};
        const card = (label, val, sub, color) => `
            <div style="flex:1;min-width:150px;border:1px solid #e2e8f0;border-left:4px solid ${color};border-radius:8px;padding:12px">
                <div style="font-size:12px;color:#64748b">${label}</div>
                <div style="font-size:19px;font-weight:700;margin:4px 0;color:${color}">${val}</div>
                <div style="font-size:11px;color:#94a3b8">${sub || ''}</div>
            </div>`;
        return `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
            ${card(RB_L('预测期收入', '預測期收入', 'Forecast Revenue'), UI.fmt(s.total_revenue), `${s.start_month || '-'} ~ ${s.end_month || '-'}`, '#3b82f6')}
            ${card(RB_L('累计净利', '累計淨利', 'Cumulative Net Profit'), UI.fmt(s.total_net_profit), `${s.months || 0} ${RB_L('个月', '個月', 'months')}`, '#10b981')}
            ${card(RB_L('期末现金', '期末現金', 'Ending Cash'), UI.fmt(s.ending_cash), `${RB_L('期初', '期初', 'opening')} ${UI.fmt(s.opening_cash)}`, '#8b5cf6')}
            ${card(RB_L('最低现金余额', '最低現金餘額', 'Min Cash'), UI.fmt(s.min_cash), s.min_cash_month || '-', '#f59e0b')}
            ${card(RB_L('报表平衡差', '報表平衡差', 'Balance Diff'), UI.fmt(s.max_balance_diff), RB_L('资产=负债+权益', '資產=負債+權益', 'assets = liab + equity'), Math.abs(s.max_balance_diff || 0) < 1 ? '#0ea5e9' : '#dc2626')}
        </div>`;
    },

    monthlyTable(rows, label) {
        const months = this.data.months || [];
        const head = months.map(m => `<th style="text-align:right;min-width:92px">${m.YYYY_MM.slice(2)}</th>`).join('');
        const body = rows.map(r => {
            const cells = months.map(m => `<td class="num">${this.fmt(r.get(m))}</td>`).join('');
            const sum = months.reduce((s, m) => s + Number(r.get(m) || 0), 0);
            return `<tr style="${r.bold ? 'font-weight:700;background:#f8fafc' : ''}">
                <td style="white-space:nowrap">${r.label}</td>${cells}
                <td class="num" style="font-weight:600">${this.fmt(sum)}</td></tr>`;
        }).join('');
        return `
            <div class="card" style="margin-bottom:14px">
                <div class="card-title">${label}</div>
                <div style="overflow-x:auto"><table class="data-table">
                    <thead><tr><th style="min-width:130px">${RB_L('科目', '科目', 'Item')}</th>${head}<th style="text-align:right">${RB_L('合计', '合計', 'Total')}</th></tr></thead>
                    <tbody>${body || `<tr><td colspan="${months.length + 2}" style="text-align:center;color:#999">${RB_L('暂无数据', '暫無資料', 'No data')}</td></tr>`}</tbody>
                </table></div>
            </div>`;
    },

    renderPL() {
        const rows = [
            { label: RB_L('营业收入', '營業收入', 'Revenue'), get: m => m.revenue, bold: true },
            { label: RB_L('销售成本', '銷售成本', 'COGS'), get: m => m.cogs },
            { label: RB_L('毛利', '毛利', 'Gross Profit'), get: m => m.gross_profit, bold: true },
            { label: RB_L('销售费用', '銷售費用', 'Selling Exp'), get: m => m.sale_exp },
            { label: RB_L('管理费用', '管理費用', 'G&A Exp'), get: m => m.mgm_exp },
            { label: RB_L('财务费用', '財務費用', 'Finance Exp'), get: m => m.finance_exp },
            { label: RB_L('其他费用', '其他費用', 'Other Exp'), get: m => m.other_exp },
            { label: RB_L('息税前利润', '息稅前利潤', 'EBT'), get: m => m.ebt, bold: true },
            { label: RB_L('所得税', '所得稅', 'Tax'), get: m => m.tax },
            { label: RB_L('净利润', '淨利潤', 'Net Profit'), get: m => m.net_profit, bold: true },
        ];
        return this.monthlyTable(rows, RB_L('滚动损益表（预测）', '滾動損益表（預測）', 'Rolling P&L (Forecast)'));
    },

    renderBS() {
        const rows = [
            { label: RB_L('现金', '現金', 'Cash'), get: m => m.cash },
            { label: RB_L('应收账款', '應收帳款', 'AR'), get: m => m.ar },
            { label: RB_L('存货', '存貨', 'Inventory'), get: m => m.inventory },
            { label: RB_L('固定资产', '固定資產', 'Fixed Assets'), get: m => m.fixed_assets },
            { label: RB_L('资产合计', '資產合計', 'Total Assets'), get: m => m.assets, bold: true },
            { label: RB_L('应付账款', '應付帳款', 'AP'), get: m => m.ap },
            { label: RB_L('其他负债', '其他負債', 'Other Liabilities'), get: m => m.other_liab },
            { label: RB_L('负债合计', '負債合計', 'Total Liabilities'), get: m => m.liabilities, bold: true },
            { label: RB_L('股东权益', '股東權益', 'Equity'), get: m => m.equity },
            { label: RB_L('负债及权益合计', '負債及權益合計', 'Liab + Equity'), get: m => m.liabilities + m.equity, bold: true },
            { label: RB_L('平衡差额', '平衡差額', 'Balance Diff'), get: m => m.balance_diff },
        ];
        return this.monthlyTable(rows, RB_L('滚动资产负债表（预测）', '滾動資產負債表（預測）', 'Rolling Balance Sheet (Forecast)'));
    },

    renderCF() {
        const rows = [
            { label: RB_L('经营活动现金流', '經營活動現金流', 'Operating CF'), get: m => m.cf_operating, bold: true },
            { label: RB_L('投资活动现金流', '投資活動現金流', 'Investing CF'), get: m => m.cf_investing },
            { label: RB_L('筹资活动现金流', '籌資活動現金流', 'Financing CF'), get: m => m.cf_financing },
            { label: RB_L('净现金流', '淨現金流', 'Net Cash Flow'), get: m => m.cf_net, bold: true },
            { label: RB_L('期末现金', '期末現金', 'Ending Cash'), get: m => m.cash, bold: true },
        ];
        return this.monthlyTable(rows, RB_L('滚动现金流量表（预测）', '滾動現金流量表（預測）', 'Rolling Cash Flow (Forecast)'));
    },

    renderAssumption() {
        const a = this.assumption || {};
        const d = a.derived || {};
        const inp = (id, label, val, step, unit) => `
            <div class="col-2"><label>${label}</label>
                <div style="display:flex;align-items:center;gap:6px">
                    <input id="${id}" type="number" step="${step || 'any'}" class="form-input" value="${val ?? ''}">
                    <span style="font-size:12px;color:#64748b;white-space:nowrap">${unit || ''}</span>
                </div></div>`;
        return `
            <div class="card">
                <div class="card-title">${RB_L('滚动预算假设', '滾動預算假設', 'Rolling Budget Assumptions')}</div>
                <div style="font-size:12px;color:#64748b;margin-bottom:10px">
                    ${RB_L('基准月', '基準月', 'Base month')} <b>${a.base_month || '-'}</b> ·
                    ${RB_L('最新实际收入（近 3 月均值）', '最新實際收入（近 3 月均值）', 'Latest actual revenue (3-mo avg)')} <b>${UI.fmt(d.avg_revenue)}</b> ·
                    ${RB_L('期初现金', '期初現金', 'Opening cash')} <b>${UI.fmt(d.opening_cash)}</b>
                </div>
                <div class="form-grid">
                    ${inp('rb_base_month', RB_L('基准月（YYYY-MM）', '基準月（YYYY-MM）', 'Base month'), a.base_month, null, '')}
                    ${inp('rb_months', RB_L('预测期数', '預測期數', 'Months'), a.months, '1', RB_L('个月', '個月', 'months'))}
                    ${inp('rb_growth', RB_L('月收入增长率', '月收入增長率', 'Monthly revenue growth'), ((a.revenue_growth || 0) * 100).toFixed(2), '0.01', '%')}
                    ${inp('rb_cost', RB_L('销售成本率', '銷售成本率', 'Cost ratio'), ((a.cost_ratio || 0) * 100).toFixed(2), '0.01', '%')}
                    ${inp('rb_tax', RB_L('所得税率', '所得稅率', 'Tax rate'), ((a.tax_rate || 0) * 100).toFixed(2), '0.01', '%')}
                    ${inp('rb_ar', RB_L('应收账款天数', '應收帳款天數', 'AR days'), a.ar_days, '1', RB_L('天', '天', 'days'))}
                    ${inp('rb_ap', RB_L('应付账款天数', '應付帳款天數', 'AP days'), a.ap_days, '1', RB_L('天', '天', 'days'))}
                    ${inp('rb_inv', RB_L('存货周转天数', '存貨週轉天數', 'Inventory days'), a.inv_days, '1', RB_L('天', '天', 'days'))}
                    ${inp('rb_capex', RB_L('每月资本支出', '每月資本支出', 'Monthly capex'), a.capex_monthly, 'any', RB_L('元', '元', 'CNY'))}
                    ${inp('rb_loan', RB_L('每月还本', '每月還本', 'Monthly repayment'), a.loan_repay_monthly, 'any', RB_L('元', '元', 'CNY'))}
                </div>
                <div style="margin-top:14px">
                    <button class="btn btn-primary" onclick="RollingBudgetPage.saveAssumption()">${RB_L('保存假设并重算', '保存假設並重算', 'Save & Recalculate')}</button>
                    <span style="font-size:12px;color:#94a3b8;margin-left:10px">${RB_L('成本率、天数等留空时按最新实际自动推导', '成本率、天數等留空時按最新實際自動推導', 'Blank values are derived from latest actuals')}</span>
                </div>
            </div>`;
    },

    renderCash() {
        const c = this.cash || {};
        const weeks = c.weeks || [];
        const summary = `
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
                ${[['opening_cash', RB_L('期初现金', '期初現金', 'Opening Cash')],
                   ['ending_cash', RB_L('13 周期末现金', '13 週期末現金', 'Ending Cash (13W)')],
                   ['min_balance', RB_L('最低余额', '最低餘額', 'Min Balance')],
                   ['safe_level', RB_L('安全水位', '安全水位', 'Safe Level')]].map(([k, l]) => `
                    <div style="flex:1;min-width:140px;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px">
                        <div style="font-size:12px;color:#64748b">${l}</div>
                        <div style="font-size:17px;font-weight:700;margin-top:4px">${UI.fmt(c[k])}</div>
                    </div>`).join('')}
                <div style="flex:1;min-width:140px;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px">
                    <div style="font-size:12px;color:#64748b">${RB_L('低于安全水位周数', '低於安全水位週數', 'Weeks below safe')}</div>
                    <div style="font-size:17px;font-weight:700;margin-top:4px;color:${(c.below_safe_weeks || 0) > 0 ? '#dc2626' : '#10b981'}">${c.below_safe_weeks || 0}</div>
                </div>
            </div>`;
        const rows = weeks.map(w => `
            <tr>
                <td style="text-align:center">${w.week}</td>
                <td>${w.week_from}</td>
                <td class="num">${UI.fmt(w.inflow)}</td>
                <td class="num">${UI.fmt(w.outflow)}</td>
                <td class="num">${UI.fmt(w.capex)}</td>
                <td class="num">${UI.fmt(w.loan_repay)}</td>
                <td class="num" style="color:${w.net >= 0 ? '#166534' : '#dc2626'}">${UI.fmt(w.net)}</td>
                <td class="num">${UI.fmt(w.start_balance)}</td>
                <td class="num" style="font-weight:600">${UI.fmt(w.end_balance)}</td>
                <td>${w.is_safe ? '<span style="color:#10b981">●</span>' : '<span style="color:#dc2626">●</span>'}</td>
            </tr>`).join('');
        return `${summary}
            <div class="card" style="margin-bottom:14px">
                <div class="card-title">${RB_L('13 周滚动现金预测（由滚动预算摊分）', '13 週滾動現金預測（由滾動預算攤分）', '13-Week Rolling Cash (from rolling budget)')}
                    <button class="btn btn-ghost btn-sm" style="float:right" onclick="navigate('cashForecast')">${RB_L('查看现金预测', '查看現金預測', 'Cash Forecast')}</button>
                </div>
                <canvas id="rbCashChart" height="90"></canvas>
                <div style="overflow-x:auto;margin-top:10px"><table class="data-table">
                    <thead><tr>
                        <th>${RB_L('周', '週', 'Wk')}</th><th>${RB_L('起始日', '起始日', 'Week from')}</th>
                        <th style="text-align:right">${RB_L('流入', '流入', 'Inflow')}</th>
                        <th style="text-align:right">${RB_L('流出', '流出', 'Outflow')}</th>
                        <th style="text-align:right">${RB_L('资本支出', '資本支出', 'Capex')}</th>
                        <th style="text-align:right">${RB_L('还本', '還本', 'Repay')}</th>
                        <th style="text-align:right">${RB_L('净流量', '淨流量', 'Net')}</th>
                        <th style="text-align:right">${RB_L('期初', '期初', 'Opening')}</th>
                        <th style="text-align:right">${RB_L('期末', '期末', 'Ending')}</th>
                        <th>${RB_L('安全', '安全', 'Safe')}</th>
                    </tr></thead>
                    <tbody>${rows || `<tr><td colspan="10" style="text-align:center;color:#999">${RB_L('暂无数据', '暫無資料', 'No data')}</td></tr>`}</tbody>
                </table></div>
            </div>`;
    },

    render() {
        const el = document.getElementById('rbBody');
        if (!el) return;
        if (this.tab === 'cash' && !this.cash) { this.loadCurrent(); return; }
        let body = '';
        if (this.tab === 'pl') body = this.renderPL();
        else if (this.tab === 'bs') body = this.renderBS();
        else if (this.tab === 'cf') body = this.renderCF();
        else if (this.tab === 'cash') body = this.renderCash();
        else body = this.renderAssumption();
        el.innerHTML = this.kpiCards() + body;
        if (this.tab === 'cash') this.drawCashChart();
    },

    drawCashChart() {
        const canvas = document.getElementById('rbCashChart');
        if (!canvas || typeof Chart === 'undefined') return;
        if (this.chart) { try { this.chart.destroy(); } catch (e) { } }
        const weeks = (this.cash && this.cash.weeks) || [];
        const safe = (this.cash && this.cash.safe_level) || 0;
        this.chart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: weeks.map(w => 'W' + w.week),
                datasets: [
                    { label: RB_L('期末现金', '期末現金', 'Ending Cash'), data: weeks.map(w => w.end_balance), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.15)', fill: true, tension: 0.3 },
                    { label: RB_L('安全水位', '安全水位', 'Safe Level'), data: weeks.map(() => safe), borderColor: '#dc2626', borderDash: [6, 4], pointRadius: 0 }
                ]
            },
            options: {
                responsive: true,
                plugins: { tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${UI.fmt(ctx.parsed.y)}` } } },
                scales: { y: { ticks: { callback: v => UI.fmt(v) } } }
            }
        });
    },

    async saveAssumption() {
        const num = id => Number(document.getElementById(id).value);
        try {
            await API.put('/api/rolling-budget/assumption', {
                bu_no: this.bu,
                base_month: document.getElementById('rb_base_month').value || null,
                months: num('rb_months'),
                revenue_growth: num('rb_growth') / 100,
                cost_ratio: num('rb_cost') / 100,
                tax_rate: num('rb_tax') / 100,
                ar_days: num('rb_ar'),
                ap_days: num('rb_ap'),
                inv_days: num('rb_inv'),
                capex_monthly: num('rb_capex'),
                loan_repay_monthly: num('rb_loan')
            });
            UI.toast(RB_L('假设已保存', '假設已保存', 'Assumptions saved'), 'success');
            this.months = num('rb_months') || this.months;
            await this.loadCurrent();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};

registerPage('rollingBudget', async () => { await RollingBudgetPage.load(); });
