/**
 * 多维盈利分析（CFO-06）
 * 客户 / 产品 / 渠道 / 项目
 */
const PA_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] || zh);

const ProfitAnalysisPage = {
    dim: 'customer',      // customer | product | channel | project
    range: 'month',       // month | year
    month: State.YYYY_MM, // YYYY-MM
    summary: null,
    data: null,
    costRates: {},        // xitems -> cost_rate

    docs: [
        { k: 'customer', zh: '客户', tw: '客戶', en: 'Customer' },
        { k: 'product', zh: '产品', tw: '產品', en: 'Product' },
        { k: 'channel', zh: '渠道', tw: '渠道', en: 'Channel' },
        { k: 'project', zh: '项目', tw: '專案', en: 'Project' },
    ],

    async load() {
        if (!Auth.isLoggedIn()) { Auth.showLogin(); return; }
        document.getElementById('pageTitle').textContent = PA_L('多维盈利分析', '多維盈利分析', 'Multi-dimension Profitability');
        this.renderShell();
        await this.loadCurrent();
    },

    renderShell() {
        const tabs = this.docs.map(d => `<div class="tab-item ${this.dim === d.k ? 'active' : ''}" onclick="ProfitAnalysisPage.switchDim('${d.k}')">${PA_L(d.zh, d.tw, d.en)}</div>`).join('');
        document.getElementById('pageContent').innerHTML = `
            <div class="page-header">
                <div class="tabs">${tabs}</div>
                <div class="page-actions">
                    <div class="tabs" style="margin:0;">
                        <div class="tab-item ${this.range === 'month' ? 'active' : ''}" onclick="ProfitAnalysisPage.setRange('month')">${PA_L('本月', '本月', 'This Month')}</div>
                        <div class="tab-item ${this.range === 'year' ? 'active' : ''}" onclick="ProfitAnalysisPage.setRange('year')">${PA_L('全年', '全年', 'Full Year')}</div>
                    </div>
                    ${this.range === 'month'
                        ? `<input type="month" class="form-input" style="width:140px" value="${this.month}" onchange="ProfitAnalysisPage.setMonth(this.value)">`
                        : `<span style="font-size:13px;color:#475569">${this.month.slice(0, 4)} ${PA_L('年', '年', 'FY')}</span>`}
                    <button class="btn btn-ghost" onclick="ProfitAnalysisPage.loadCurrent()">🔄 ${PA_L('刷新', '重新整理', 'Refresh')}</button>
                </div>
            </div>
            <div id="paBody"><div style="padding:40px;text-align:center;color:#999">⏳</div></div>
        `;
        const tabsEl = document.querySelector('#pageContent .tabs');
        if (tabsEl && typeof bindTabs === 'function') bindTabs(tabsEl);
    },

    switchDim(d) { this.dim = d; this.renderShell(); this.loadCurrent(false); },
    setRange(r) { this.range = r; this.renderShell(); this.loadCurrent(false); },
    setMonth(m) { if (!m) return; this.month = m; this.loadCurrent(false); },

    query() {
        return this.range === 'month' ? `&YYYY_MM=${this.month}` : `&YYYY=${this.month.slice(0, 4)}`;
    },

    async loadCurrent(autoFix = true) {
        const el = document.getElementById('paBody');
        el.innerHTML = `<div style="padding:30px;text-align:center;color:#999">⏳</div>`;
        try {
            const reqs = [
                API.get(`/api/profit/summary?bu_no=${State.bu_no}${this.query()}`),
                API.get(`/api/profit/dimension?bu_no=${State.bu_no}&dim=${this.dim}${this.query()}`)
            ];
            if (this.dim === 'product') reqs.push(API.get(`/api/profit/cost-rates?bu_no=${State.bu_no}`));
            const [sumRes, dimRes, rateRes] = await Promise.all(reqs);
            this.summary = sumRes.data || {};
            this.data = dimRes.data || { rows: [], totals: {} };
            this.costRates = {};
            ((rateRes && rateRes.data) || []).forEach(r => { this.costRates[r.xitems] = Number(r.cost_rate); });
            if (autoFix && this.range === 'month' && !(this.data.totals?.line_cnt > 0)
                && this.summary.latest_month && this.summary.latest_month !== this.month) {
                this.month = this.summary.latest_month;
                this.renderShell();
                return this.loadCurrent(false);
            }
            this.render();
        } catch (e) {
            el.innerHTML = `<div style="padding:20px;color:#e74c3c">${e.message}</div>`;
        }
    },

    render() {
        const el = document.getElementById('paBody');
        const t = this.data.totals || {};
        const s = this.summary || {};
        const rows = this.data.rows || [];
        const card = (label, val, sub, color) => `
            <div style="flex:1;min-width:150px;border:1px solid #e2e8f0;border-left:4px solid ${color};border-radius:8px;padding:12px">
                <div style="font-size:12px;color:#64748b">${label}</div>
                <div style="font-size:19px;font-weight:700;margin:4px 0;color:${color}">${val}</div>
                <div style="font-size:11px;color:#94a3b8">${sub || ''}</div>
            </div>`;

        const pctBar = (pct) => {
            const w = Math.min(100, Math.max(0, Number(pct) || 0));
            return `<div style="display:flex;align-items:center;gap:6px">
                <div style="flex:1;height:6px;background:#e2e8f0;border-radius:3px;min-width:46px">
                    <div style="width:${w}%;height:6px;background:#3b82f6;border-radius:3px"></div></div>
                <span style="font-size:12px;color:#64748b;min-width:44px;text-align:right">${pct}%</span></div>`;
        };

        const isChannel = this.dim === 'channel';
        const nameLabel = PA_L('名称', '名稱', 'Name');

        el.innerHTML = `
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
                ${card(PA_L('营业收入', '營業收入', 'Revenue'), UI.fmt(t.revenue), `${t.line_cnt || 0} ${PA_L('明细行', '明細行', 'lines')}`, '#3b82f6')}
                ${card(PA_L('销售成本', '銷售成本', 'COGS'), UI.fmt(t.cost), PA_L('标准成本优先', '標準成本優先', 'std cost first'), '#f59e0b')}
                ${card(PA_L('毛利', '毛利', 'Gross Profit'), UI.fmt(t.profit), `${PA_L('已出货口径', '已出貨口徑', 'delivered basis')}`, '#10b981')}
                ${card(PA_L('毛利率', '毛利率', 'Margin'), `${t.margin ?? 0}%`, `${rows.length} ${PA_L('个维度值', '個維度值', 'dimension values')}`, t.margin >= 0 ? '#8b5cf6' : '#dc2626')}
                ${card(PA_L('标准成本覆盖', '標準成本覆蓋', 'Std Cost Coverage'), `${s.std_cost_coverage ?? 0}%`, PA_L('其余按成本率估算', '其餘按成本率估算', 'rest estimated'), '#0ea5e9')}
                ${card(PA_L('成本率覆盖', '成本率覆蓋', 'Cost-rate Coverage'), `${s.cost_rate_coverage ?? 0}%`, PA_L('标准成本+料件成本率', '標準成本+料件成本率', 'std + item rate'), '#14b8a6')}
            </div>
            <div style="font-size:12px;color:#64748b;margin-bottom:10px">
                ${PA_L('成本口径', '成本口徑', 'Cost basis')}: ${s.cost_ratio_source || '-'}
                · ${PA_L('公司成本率', '公司成本率', 'Company cost ratio')} ${s.cost_ratio ?? '-'}%
                · ${PA_L('收入按已出货数量计算', '收入按已出貨數量計算', 'Revenue on delivered qty')}
            </div>
            <div style="overflow-x:auto;">
            <table class="data-table">
                <thead><tr>
                    <th style="width:56px;text-align:center;">#</th>
                    <th>${nameLabel}</th>
                    <th style="text-align:right;">${PA_L('收入', '收入', 'Revenue')}</th>
                    <th style="text-align:right;">${PA_L('成本', '成本', 'Cost')}</th>
                    <th style="text-align:right;">${PA_L('毛利', '毛利', 'Profit')}</th>
                    <th style="text-align:right;">${PA_L('毛利率', '毛利率', 'Margin')}</th>
                    <th style="min-width:130px;">${PA_L('收入占比', '收入占比', 'Revenue Share')}</th>
                    <th style="text-align:right;">${PA_L('订单行', '訂單行', 'Lines')}</th>
                    <th>${PA_L('操作', '操作', 'Actions')}</th>
                </tr></thead>
                <tbody>
                ${rows.map(r => `
                    <tr>
                        <td style="text-align:center;color:#94a3b8">${r.rank}</td>
                        <td>${isChannel ? this.channelBadge(r.key, r.name) : `<b>${r.name}</b>${this.dim === 'product' && this.costRates[r.key] != null ? `<span style="margin-left:6px;font-size:11px;color:#0f766e">${PA_L('成本率', '成本率', 'rate')} ${(this.costRates[r.key] * 100).toFixed(1)}%</span>` : ''}`}</td>
                        <td class="num">${UI.fmt(r.revenue)}</td>
                        <td class="num">${UI.fmt(r.cost)}</td>
                        <td class="num" style="color:${r.profit >= 0 ? '#166534' : '#dc2626'};font-weight:600">${UI.fmt(r.profit)}</td>
                        <td class="num" style="color:${r.margin >= 0 ? '#166534' : '#dc2626'}">${r.margin}%</td>
                        <td>${pctBar(r.revenue_share)}</td>
                        <td class="num">${r.order_cnt}</td>
                        <td style="white-space:nowrap;">
                            <button class="btn btn-ghost btn-sm" onclick="ProfitAnalysisPage.openDetails('${String(r.key).replace(/'/g, "\\'")}')">🔍 ${PA_L('下钻', '下鑽', 'Drill')}</button>
                            ${this.dim === 'customer' ? `<button class="btn btn-ghost btn-sm" onclick="ProfitAnalysisPage.openChannelForm('${String(r.key).replace(/'/g, "\\'")}','${String(r.name).replace(/'/g, "\\'")}')">${PA_L('改渠道', '改渠道', 'Channel')}</button>` : ''}
                            ${this.dim === 'product' ? `<button class="btn btn-ghost btn-sm" onclick="ProfitAnalysisPage.openCostRateForm('${String(r.key).replace(/'/g, "\\'")}','${String(r.name).replace(/'/g, "\\'")}')">${PA_L('设成本率', '設成本率', 'Cost Rate')}</button>` : ''}
                        </td>
                    </tr>`).join('') || `<tr><td colspan="9" style="text-align:center;color:#999">${PA_L('暂无数据', '暫無資料', 'No data')}</td></tr>`}
                </tbody>
            </table></div>
        `;
    },

    channelBadge(code, name) {
        const color = { DIRECT: ['#dbeafe', '#1e40af'], DEALER: ['#dcfce7', '#166534'], EXPORT: ['#fef3c7', '#92400e'], GROUP: ['#ede9fe', '#5b21b6'], OTHER: ['#e2e8f0', '#475569'] }[code] || ['#e2e8f0', '#475569'];
        return `<span style="padding:2px 8px;border-radius:10px;background:${color[0]};color:${color[1]};font-size:12px">${name}</span>`;
    },

    async openDetails(key) {
        try {
            const res = await API.get(`/api/profit/details?bu_no=${State.bu_no}&dim=${this.dim}&key=${encodeURIComponent(key)}${this.query()}`);
            const d = res.data || {};
            const rows = d.rows || [];
            UI.modal(`${PA_L('盈利下钻', '盈利下鑽', 'Profit Drill')} — ${key}`, `
                <div style="font-size:13px;color:#475569;margin-bottom:8px">
                    ${PA_L('收入', '收入', 'Revenue')} <b>${UI.fmt(d.totals?.revenue)}</b> ·
                    ${PA_L('成本', '成本', 'Cost')} <b>${UI.fmt(d.totals?.cost)}</b> ·
                    ${PA_L('毛利', '毛利', 'Profit')} <b>${UI.fmt(d.totals?.profit)}</b> ·
                    ${rows.length} ${PA_L('行', '行', 'lines')}
                </div>
                <div style="max-height:55vh;overflow:auto;">
                <table class="data-table">
                    <thead><tr>
                        <th>SO</th><th>${PA_L('日期', '日期', 'Date')}</th><th>${PA_L('客户', '客戶', 'Client')}</th>
                        <th>${PA_L('料件', '料件', 'Item')}</th><th style="text-align:right;">${PA_L('数量', '數量', 'Qty')}</th>
                        <th style="text-align:right;">${PA_L('单价', '單價', 'Price')}</th>
                        <th style="text-align:right;">${PA_L('单位成本', '單位成本', 'Unit Cost')}</th>
                        <th style="text-align:right;">${PA_L('收入', '收入', 'Revenue')}</th>
                        <th style="text-align:right;">${PA_L('毛利', '毛利', 'Profit')}</th>
                        <th style="text-align:right;">${PA_L('毛利率', '毛利率', 'Margin')}</th>
                    </tr></thead>
                    <tbody>${rows.map(r => `
                        <tr>
                            <td>${r.so_nbr || '-'}</td>
                            <td>${String(r.so_date || '').slice(0, 10)}</td>
                            <td>${r.client_name || r.client_id || '-'}</td>
                            <td>${r.xitems}</td>
                            <td class="num">${UI.fmt(r.qty, 2)}</td>
                            <td class="num">${UI.fmt(r.unit_price, 2)}</td>
                            <td class="num">${UI.fmt(r.unit_cost, 2)}${r.cost_source === 'RATIO' ? ' *' : ''}</td>
                            <td class="num">${UI.fmt(r.revenue)}</td>
                            <td class="num" style="color:${r.profit >= 0 ? '#166534' : '#dc2626'}">${UI.fmt(r.profit)}</td>
                            <td class="num">${r.margin}%</td>
                        </tr>`).join('') || `<tr><td colspan="10" style="text-align:center;color:#999">${PA_L('暂无数据', '暫無資料', 'No data')}</td></tr>`}
                    </tbody>
                </table></div>
                <div style="font-size:11px;color:#94a3b8;margin-top:6px">* ${PA_L('单位成本按公司成本率估算', '單位成本按公司成本率估算', 'Unit cost estimated by company cost ratio')}</div>
            `, `<button class="btn btn-ghost" onclick="UI.closeModal()">${PA_L('关闭', '關閉', 'Close')}</button>`);
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    openChannelForm(clientId, clientName) {
        const opts = [
            ['DIRECT', PA_L('直营', '直營', 'Direct')],
            ['DEALER', PA_L('经销', '經銷', 'Dealer')],
            ['EXPORT', PA_L('外销', '外銷', 'Export')],
            ['GROUP', PA_L('集团内', '集團內', 'Intra-group')],
            ['OTHER', PA_L('其他', '其他', 'Other')]
        ].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
        UI.modal(`${PA_L('设置渠道', '設定渠道', 'Set Channel')} — ${clientName || clientId}`, `
            <div class="form-grid">
                <div class="col-2"><label>${PA_L('销售渠道', '銷售渠道', 'Sales Channel')}</label>
                    <select id="pa_channel" class="form-input">${opts}</select></div>
                <div class="col-2" style="font-size:12px;color:#64748b">
                    ${PA_L('未设置时按客户名称自动归类：出口→外销、经销商→经销、总公司/集团→集团内，其余为直营。', '未設定時按客戶名稱自動歸類：出口→外銷、經銷商→經銷、總公司/集團→集團內，其餘為直營。', 'Default rules by client name: export / dealer / group / direct.')}
                </div>
            </div>
        `, `<button class="btn btn-ghost" onclick="UI.closeModal()">${PA_L('取消', '取消', 'Cancel')}</button>
            <button class="btn btn-primary" onclick="ProfitAnalysisPage.saveChannel('${String(clientId).replace(/'/g, "\\'")}')">${PA_L('保存', '保存', 'Save')}</button>`);
    },

    async saveChannel(clientId) {
        try {
            await API.put('/api/profit/channel', {
                bu_no: State.bu_no,
                client_id: clientId,
                channel_code: document.getElementById('pa_channel').value
            });
            UI.toast(PA_L('渠道已更新', '渠道已更新', 'Channel updated'), 'success');
            UI.closeModal();
            await this.loadCurrent();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    openCostRateForm(xitems, name) {
        const cur = this.costRates[xitems];
        const ratio = this.summary?.cost_ratio ?? '-';
        UI.modal(`${PA_L('设置料件成本率', '設定料件成本率', 'Set Item Cost Rate')} — ${name}`, `
            <div class="form-grid">
                <div class="col-2"><label>${PA_L('成本率（0~1）', '成本率（0~1）', 'Cost rate (0-1)')}</label>
                    <input id="pa_rate" type="number" min="0.01" max="0.99" step="0.01" class="form-input"
                           value="${cur != null ? cur : ''}" placeholder="0.70">
                </div>
                <div class="col-2" style="font-size:12px;color:#64748b">
                    ${PA_L(`该料件无采购标准成本时，单位成本 = 销售单价 × 成本率；留空或清除则回退公司成本率 ${ratio}%。`,
                        `該料件無採購標準成本時，單位成本 = 銷售單價 × 成本率；留空或清除則回退公司成本率 ${ratio}%。`,
                        `Without std cost, unit cost = price × rate; clear to fall back to company ratio ${ratio}%.`)}
                </div>
            </div>
        `, `<button class="btn btn-ghost" onclick="UI.closeModal()">${PA_L('取消', '取消', 'Cancel')}</button>
            ${cur != null ? `<button class="btn btn-danger" onclick="ProfitAnalysisPage.clearCostRate('${String(xitems).replace(/'/g, "\\'")}')">${PA_L('清除', '清除', 'Clear')}</button>` : ''}
            <button class="btn btn-primary" onclick="ProfitAnalysisPage.saveCostRate('${String(xitems).replace(/'/g, "\\'")}')">${PA_L('保存', '保存', 'Save')}</button>`);
    },

    async saveCostRate(xitems) {
        const v = Number(document.getElementById('pa_rate').value);
        if (!(v > 0 && v < 1)) return UI.toast(PA_L('成本率需在 0~1 之间', '成本率需在 0~1 之間', 'Cost rate must be between 0 and 1'), 'error');
        try {
            await API.put('/api/profit/cost-rate', { bu_no: State.bu_no, xitems, cost_rate: v });
            UI.toast(PA_L('成本率已保存', '成本率已保存', 'Cost rate saved'), 'success');
            UI.closeModal();
            await this.loadCurrent();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async clearCostRate(xitems) {
        try {
            await API.del(`/api/profit/cost-rate/${encodeURIComponent(xitems)}?bu_no=${State.bu_no}`);
            UI.toast(PA_L('已清除成本率', '已清除成本率', 'Cost rate cleared'), 'success');
            UI.closeModal();
            await this.loadCurrent();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};

registerPage('profitAnalysis', async () => { await ProfitAnalysisPage.load(); });
