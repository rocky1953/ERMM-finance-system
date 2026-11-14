/**
 * 库存周转、库龄与呆滞（COO-05）
 * 周转概览 · 库龄结构 · 呆滞清单（可下发处理） · 补货建议 · 处理记录
 */
const IT_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] || zh);
const IT_ESC = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const InventoryTurnoverPage = {
    bu: State.bu_no,
    tab: 'overview',     // overview | aging | slow | replen | actions
    stock_date: '',
    dates: [],
    targetDays: 30,
    overview: null,
    aging: null,
    slow: null,
    replen: null,
    actions: [],
    chart: null,

    tabs: [
        { k: 'overview', zh: '周转概览', tw: '週轉概覽', en: 'Overview' },
        { k: 'aging', zh: '库龄结构', tw: '庫齡結構', en: 'Stock Aging' },
        { k: 'slow', zh: '呆滞清单', tw: '呆滯清單', en: 'Slow-moving' },
        { k: 'replen', zh: '补货建议', tw: '補貨建議', en: 'Replenishment' },
        { k: 'actions', zh: '处理记录', tw: '處理記錄', en: 'Disposals' },
    ],

    async load() {
        if (!Auth.isLoggedIn()) { Auth.showLogin(); return; }
        document.getElementById('pageTitle').textContent = IT_L('库存周转', '庫存週轉', 'Inventory Turnover');
        const buHtml = await CodeHelper.buSel({ selected: this.bu });
        document.getElementById('pageContent').innerHTML = `
            <div class="page-header">
                <div class="tabs">
                    ${this.tabs.map(t => `<div class="tab-item ${this.tab === t.k ? 'active' : ''}" onclick="InventoryTurnoverPage.switchTab('${t.k}')">${IT_L(t.zh, t.tw, t.en)}</div>`).join('')}
                </div>
                <div class="page-actions">
                    <select id="itBu" class="form-input" style="width:100px" onchange="InventoryTurnoverPage.setBu(this.value)">${buHtml}</select>
                    <select id="itDate" class="form-input" style="width:150px" onchange="InventoryTurnoverPage.setDate(this.value)"></select>
                    <button class="btn btn-ghost" onclick="InventoryTurnoverPage.loadCurrent()">🔄 ${IT_L('刷新', '重新整理', 'Refresh')}</button>
                </div>
            </div>
            <div id="itBody"><div style="padding:40px;text-align:center;color:#999">⏳</div></div>
        `;
        document.getElementById('itBu').value = this.bu;
        await this.loadCurrent();
    },

    switchTab(t) {
        this.tab = t;
        document.querySelectorAll('#pageContent .tab-item').forEach((el, i) => {
            el.classList.toggle('active', this.tabs[i] && this.tabs[i].k === t);
        });
        this.loadCurrent();
    },
    setBu(b) { this.bu = b; State.bu_no = b; this.stock_date = ''; this.loadCurrent(); },
    setDate(d) { this.stock_date = d; this.loadCurrent(); },
    setTarget(v) { this.targetDays = Number(v) || 30; this.loadCurrent(); },

    url(path) {
        return `/api/inventory-turnover/${path}?bu_no=${encodeURIComponent(this.bu)}` +
            (this.stock_date ? `&stock_date=${encodeURIComponent(this.stock_date)}` : '');
    },

    async loadCurrent() {
        const el = document.getElementById('itBody');
        el.innerHTML = `<div style="padding:40px;text-align:center;color:#999">⏳</div>`;
        try {
            if (this.tab === 'overview') {
                const res = await API.get(this.url('overview'));
                this.overview = res.data || {};
                this.dates = this.overview.dates || [];
                this.renderDateSelect();
                this.renderOverview();
            } else if (this.tab === 'aging') {
                const res = await API.get(this.url('aging'));
                this.aging = res.data || {};
                this.dates = this.aging.dates || this.dates;
                this.renderDateSelect();
                this.renderAging();
            } else if (this.tab === 'slow') {
                const res = await API.get(this.url('slow-moving'));
                this.slow = res.data || {};
                this.renderSlow();
            } else if (this.tab === 'replen') {
                const res = await API.get(this.url('replenishment') + `&target_days=${this.targetDays}`);
                this.replen = res.data || {};
                this.renderReplen();
            } else {
                const res = await API.get(`/api/inventory-turnover/actions?bu_no=${encodeURIComponent(this.bu)}`);
                this.actions = res.data || [];
                this.renderActions();
            }
        } catch (e) {
            el.innerHTML = `<div style="padding:20px;color:#e74c3c">${IT_ESC(e.message)}</div>`;
        }
    },

    renderDateSelect() {
        const sel = document.getElementById('itDate');
        if (!sel) return;
        const cur = this.stock_date || (this.overview && this.overview.stock_date) || (this.aging && this.aging.stock_date) || '';
        sel.innerHTML = this.dates.map(d =>
            `<option value="${d.stock_date}" ${d.stock_date === cur ? 'selected' : ''}>${IT_L('库龄快照', '庫齡快照', 'Snapshot')} ${d.stock_date}</option>`
        ).join('') || `<option value="">${IT_L('无快照', '無快照', 'No snapshot')}</option>`;
    },

    card(label, val, sub, color) {
        return `<div style="flex:1;min-width:150px;border:1px solid #e2e8f0;border-left:4px solid ${color};border-radius:8px;padding:12px">
            <div style="font-size:12px;color:#64748b">${label}</div>
            <div style="font-size:19px;font-weight:700;margin:4px 0;color:${color}">${val}</div>
            <div style="font-size:11px;color:#94a3b8">${sub || ''}</div>
        </div>`;
    },

    bucketLabel(key) {
        return {
            A: IT_L('0-30 天', '0-30 天', '0-30 d'),
            B: IT_L('31-90 天', '31-90 天', '31-90 d'),
            C: IT_L('91-180 天', '91-180 天', '91-180 d'),
            D: IT_L('超过 180 天', '超過 180 天', '>180 d')
        }[key] || key;
    },

    bucketColor(key) {
        return { A: '#10b981', B: '#3b82f6', C: '#f59e0b', D: '#dc2626' }[key] || '#64748b';
    },

    // ======== Tab 1: 周转概览 ========
    renderOverview() {
        const d = this.overview || {};
        const t = d.turnover || {};
        const a = d.aging || {};
        const s = d.slow || {};
        const act = d.actions || {};
        const totals = a.totals || {};
        const el = document.getElementById('itBody');

        el.innerHTML = `
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
                ${this.card(IT_L('库存金额', '庫存金額', 'Stock Value'), UI.fmt(totals.stock_value), `${IT_L('快照', '快照', 'Snapshot')} ${d.stock_date || '-'}`, '#3b82f6')}
                ${this.card(IT_L('存货周转率', '存貨週轉率', 'Turnover'), `${(t.turnover || 0).toFixed(2)} ${IT_L('次/年', '次/年', 'x/yr')}`, `${t.latest_month || '-'} ${IT_L('滚动 12 个月', '滾動 12 個月', 'TTM')}`, '#8b5cf6')}
                ${this.card(IT_L('周转天数 DSI', '週轉天數 DSI', 'Days Sales of Inventory'), `${t.dsi ?? 0} ${IT_L('天', '天', 'days')}`, `${IT_L('上年同期', '上年同期', 'prior')} ${t.prev_dsi ?? 0} ${IT_L('天', '天', 'd')}`, '#0ea5e9')}
                ${this.card(IT_L('呆滞金额', '呆滯金額', 'Slow-moving'), UI.fmt(s.stock_value), `${IT_L('占比', '占比', 'share')} ${((s.value_pct || 0) * 100).toFixed(1)}%`, '#dc2626')}
                ${this.card(IT_L('减值准备', '減值準備', 'Provision'), UI.fmt(totals.provision), `${IT_L('净额', '淨額', 'Net')} ${UI.fmt(totals.net_value)}`, '#f59e0b')}
                ${this.card(IT_L('待处理处理单', '待處理處理單', 'Pending Disposals'), act.pending ?? 0, `${IT_L('进行中', '進行中', 'doing')} ${act.doing ?? 0} · ${IT_L('已完成', '已完成', 'done')} ${act.done ?? 0}`, '#64748b')}
            </div>

            <div style="display:flex;gap:14px;flex-wrap:wrap">
                <div class="card" style="flex:2;min-width:420px">
                    <div class="card-title">${IT_L('库存金额与周转天数趋势', '庫存金額與週轉天數趨勢', 'Inventory Value & DSI Trend')}</div>
                    <canvas id="itTrendChart" height="120"></canvas>
                </div>
                <div class="card" style="flex:1;min-width:300px">
                    <div class="card-title">${IT_L('存货结构', '存貨結構', 'Inventory Mix')}（${t.latest_month || '-'}）</div>
                    ${this.structureRows(t.structure)}
                </div>
            </div>

            <div class="card" style="margin-top:14px">
                <div class="card-title">${IT_L('库龄结构', '庫齡結構', 'Stock Aging Structure')}（${d.stock_date || '-'}）</div>
                <table class="data-table">
                    <thead><tr>
                        <th>${IT_L('库龄区间', '庫齡區間', 'Aging Bucket')}</th>
                        <th style="text-align:right">${IT_L('料件数', '料件數', 'Items')}</th>
                        <th style="text-align:right">${IT_L('数量', '數量', 'Qty')}</th>
                        <th style="text-align:right">${IT_L('库存金额', '庫存金額', 'Value')}</th>
                        <th style="min-width:150px">${IT_L('金额占比', '金額占比', 'Share')}</th>
                        <th style="text-align:right">${IT_L('减值准备', '減值準備', 'Provision')}</th>
                        <th style="text-align:right">${IT_L('净额', '淨額', 'Net')}</th>
                    </tr></thead>
                    <tbody>
                    ${(a.buckets || []).map(b => `<tr>
                        <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${this.bucketColor(b.key)};margin-right:6px"></span>${this.bucketLabel(b.key)}</td>
                        <td class="num">${b.item_cnt}</td>
                        <td class="num">${UI.fmt(b.qty, 2)}</td>
                        <td class="num">${UI.fmt(b.stock_value)}</td>
                        <td>
                            <div style="display:flex;align-items:center;gap:6px">
                                <div style="flex:1;height:6px;background:#e2e8f0;border-radius:3px">
                                    <div style="width:${Math.min(100, (b.value_pct || 0) * 100)}%;height:6px;background:${this.bucketColor(b.key)};border-radius:3px"></div>
                                </div>
                                <span style="font-size:12px;color:#64748b;min-width:44px;text-align:right">${((b.value_pct || 0) * 100).toFixed(1)}%</span>
                            </div>
                        </td>
                        <td class="num">${UI.fmt(b.provision)}</td>
                        <td class="num">${UI.fmt(b.net_value)}</td>
                    </tr>`).join('') || `<tr><td colspan="7" style="text-align:center;color:#999">${IT_L('暂无库龄快照', '暫無庫齡快照', 'No aging snapshot')}</td></tr>`}
                    </tbody>
                </table>
            </div>
        `;
        this.drawTrendChart();
    },

    structureRows(st) {
        if (!st) return `<p style="color:#999;font-size:13px">${IT_L('暂无财务汇总数据', '暫無財務彙總資料', 'No finance summary')}</p>`;
        const rows = [
            [IT_L('成品', '成品', 'Finished'), st.finished, '#3b82f6'],
            [IT_L('原料', '原料', 'Material'), st.material, '#10b981'],
            [IT_L('副料', '副料', 'Auxiliary'), st.auxiliary, '#f59e0b'],
            [IT_L('在途', '在途', 'In Transit'), st.transit, '#8b5cf6'],
        ];
        const sum = rows.reduce((x, r) => x + Number(r[1] || 0), 0) || 1;
        return `<table class="data-table"><tbody>
            ${rows.map(r => `<tr>
                <td>${r[0]}</td>
                <td class="num">${UI.fmt(r[1])}</td>
                <td style="width:90px">
                    <div style="height:6px;background:#e2e8f0;border-radius:3px">
                        <div style="width:${Math.min(100, Number(r[1] || 0) / sum * 100)}%;height:6px;background:${r[2]};border-radius:3px"></div>
                    </div>
                </td>
            </tr>`).join('')}
            <tr style="font-weight:700;background:#f8fafc">
                <td>${IT_L('存货价值合计', '存貨價值合計', 'Total')}</td>
                <td class="num">${UI.fmt(st.total)}</td><td></td>
            </tr>
        </tbody></table>
        <div style="font-size:11px;color:#94a3b8;margin-top:8px">
            ${IT_L('销售成本 12 个月', '銷售成本 12 個月', 'COGS (TTM)')}: ${UI.fmt(this.overview?.turnover?.ttm_cogs)}
        </div>`;
    },

    drawTrendChart() {
        const canvas = document.getElementById('itTrendChart');
        if (!canvas || typeof Chart === 'undefined') return;
        if (this.chart) { try { this.chart.destroy(); } catch (e) { } }
        const trend = (this.overview && this.overview.turnover && this.overview.turnover.trend) || [];
        if (!trend.length) {
            canvas.parentElement.innerHTML += `<p style="color:#999;font-size:13px">${IT_L('暂无趋势数据', '暫無趨勢資料', 'No trend data')}</p>`;
            return;
        }
        this.chart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: trend.map(t => t.YYYY_MM),
                datasets: [
                    {
                        type: 'bar', label: IT_L('存货金额', '存貨金額', 'Inventory'),
                        data: trend.map(t => t.inventory),
                        backgroundColor: 'rgba(59,130,246,0.35)', borderColor: '#3b82f6',
                        borderWidth: 1, yAxisID: 'y', order: 2
                    },
                    {
                        type: 'line', label: IT_L('周转天数', '週轉天數', 'DSI'),
                        data: trend.map(t => t.dsi), borderColor: '#dc2626',
                        backgroundColor: '#dc2626', tension: 0.25, pointRadius: 3,
                        yAxisID: 'y1', order: 1
                    }
                ]
            },
            options: {
                responsive: true,
                plugins: { legend: { position: 'bottom' } },
                scales: {
                    y: { position: 'left', ticks: { callback: v => (Number(v) / 10000).toFixed(0) + '万' } },
                    y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: IT_L('天', '天', 'days') } }
                }
            }
        });
    },

    // ======== Tab 2: 库龄结构 ========
    renderAging() {
        const d = this.aging || {};
        const el = document.getElementById('itBody');
        const totals = d.totals || {};
        el.innerHTML = `
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
                ${this.card(IT_L('料件数', '料件數', 'Items'), totals.item_cnt ?? 0, `${IT_L('快照', '快照', 'Snapshot')} ${d.stock_date || '-'}`, '#3b82f6')}
                ${this.card(IT_L('库存金额', '庫存金額', 'Stock Value'), UI.fmt(totals.stock_value), '', '#8b5cf6')}
                ${this.card(IT_L('减值准备', '減值準備', 'Provision'), UI.fmt(totals.provision), `${IT_L('净额', '淨額', 'Net')} ${UI.fmt(totals.net_value)}`, '#f59e0b')}
                ${this.card(IT_L('超 90 天库存', '超 90 天庫存', '>90 Days'), UI.fmt(totals.slow_value), `${IT_L('占比', '占比', 'share')} ${totals.stock_value > 0 ? ((totals.slow_value / totals.stock_value) * 100).toFixed(1) : 0}%`, '#dc2626')}
            </div>
            <div style="overflow-x:auto">
            <table class="data-table">
                <thead><tr>
                    <th>${IT_L('料件', '料件', 'Item')}</th>
                    <th style="text-align:right">${IT_L('数量', '數量', 'Qty')}</th>
                    <th style="text-align:right">${IT_L('库存金额', '庫存金額', 'Value')}</th>
                    <th style="text-align:right">${IT_L('加权库龄', '加權庫齡', 'Avg Age')}</th>
                    <th style="text-align:right">${IT_L('最长库龄', '最長庫齡', 'Max Age')}</th>
                    <th>${IT_L('库龄区间', '庫齡區間', 'Bucket')}</th>
                    <th style="text-align:right">${IT_L('减值率', '減值率', 'Reduce %')}</th>
                    <th style="text-align:right">${IT_L('减值准备', '減值準備', 'Provision')}</th>
                    <th style="text-align:right">${IT_L('净额', '淨額', 'Net')}</th>
                    <th>${IT_L('操作', '操作', 'Actions')}</th>
                </tr></thead>
                <tbody>
                ${(d.items || []).map(it => `<tr>
                    <td><b>${IT_ESC(it.xitems)}</b></td>
                    <td class="num">${UI.fmt(it.qty, 2)}</td>
                    <td class="num">${UI.fmt(it.stock_value)}</td>
                    <td class="num">${it.avg_ageing} ${IT_L('天', '天', 'd')}</td>
                    <td class="num" style="color:${it.max_ageing > 180 ? '#dc2626' : (it.max_ageing > 90 ? '#f59e0b' : 'inherit')}">${it.max_ageing} ${IT_L('天', '天', 'd')}</td>
                    <td><span style="padding:2px 8px;border-radius:10px;font-size:12px;background:${this.bucketColor(it.bucket)}22;color:${this.bucketColor(it.bucket)}">${this.bucketLabel(it.bucket)}</span></td>
                    <td class="num">${(it.reduce_percentage || 0).toFixed(2)}%</td>
                    <td class="num">${UI.fmt(it.provision)}</td>
                    <td class="num">${UI.fmt(it.net_value)}</td>
                    <td>${it.max_ageing > 90
                        ? `<button class="btn btn-ghost btn-sm" onclick="InventoryTurnoverPage.openActionForm('${IT_ESC(it.xitems)}')">${IT_L('下发处理', '下發處理', 'Dispose')}</button>`
                        : `<span style="color:#94a3b8;font-size:12px">—</span>`}</td>
                </tr>`).join('') || `<tr><td colspan="10" style="text-align:center;color:#999">${IT_L('暂无库龄数据', '暫無庫齡資料', 'No aging data')}</td></tr>`}
                </tbody>
            </table></div>
        `;
    },

    // ======== Tab 3: 呆滞清单 ========
    renderSlow() {
        const d = this.slow || {};
        const s = d.summary || {};
        const el = document.getElementById('itBody');
        el.innerHTML = `
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
                ${this.card(IT_L('呆滞料件', '呆滯料件', 'Slow-moving Items'), s.count ?? 0, `${IT_L('严重', '嚴重', 'severe')} ${s.severe_cnt ?? 0}`, '#dc2626')}
                ${this.card(IT_L('呆滞金额', '呆滯金額', 'Slow-moving Value'), UI.fmt(s.stock_value), `${IT_L('占比', '占比', 'share')} ${((s.value_pct || 0) * 100).toFixed(1)}%`, '#f59e0b')}
                ${this.card(IT_L('可回收净额', '可回收淨額', 'Net Recoverable'), UI.fmt(s.net_value), `${IT_L('减值', '減值', 'provision')} ${UI.fmt(s.provision)}`, '#0ea5e9')}
                ${this.card(IT_L('已下发处理', '已下發處理', 'Dispatched'), `${s.issued_cnt ?? 0}/${s.count ?? 0}`, `${IT_L('快照', '快照', 'Snapshot')} ${d.stock_date || '-'}`, '#10b981')}
            </div>
            <div style="overflow-x:auto">
            <table class="data-table">
                <thead><tr>
                    <th>${IT_L('料件', '料件', 'Item')}</th>
                    <th style="text-align:right">${IT_L('库存金额', '庫存金額', 'Value')}</th>
                    <th style="text-align:right">${IT_L('净额', '淨額', 'Net')}</th>
                    <th style="text-align:center">${IT_L('最长库龄', '最長庫齡', 'Max Age')}</th>
                    <th style="text-align:right">${IT_L('近 12 月需求', '近 12 月需求', 'Demand 12M')}</th>
                    <th style="text-align:center">${IT_L('覆盖天数', '覆蓋天數', 'Coverage')}</th>
                    <th>${IT_L('判定原因', '判定原因', 'Reason')}</th>
                    <th>${IT_L('建议处置', '建議處置', 'Suggested')}</th>
                    <th>${IT_L('状态', '狀態', 'Status')}</th>
                    <th>${IT_L('操作', '操作', 'Actions')}</th>
                </tr></thead>
                <tbody>
                ${(d.items || []).map(it => `<tr>
                    <td><b>${IT_ESC(it.xitems)}</b>
                        <div style="font-size:11px;color:#94a3b8">${it.batch_cnt} ${IT_L('个批次', '個批次', 'batches')}</div></td>
                    <td class="num">${UI.fmt(it.stock_value)}</td>
                    <td class="num">${UI.fmt(it.net_value)}</td>
                    <td class="text-center" style="color:${it.severity === 'severe' ? '#dc2626' : '#f59e0b'};font-weight:600">${it.max_ageing} d</td>
                    <td class="num">${it.demand_qty_12m ? UI.fmt(it.demand_qty_12m, 2) : '—'}
                        ${it.demand_source ? `<div style="font-size:11px;color:#94a3b8">${it.demand_source}${it.demand_approx ? IT_L('（近似）', '（近似）', ' (approx)') : ''}</div>` : ''}</td>
                    <td class="text-center">${it.coverage_days == null ? `<span style="color:#94a3b8">${IT_L('无出库', '無出庫', 'none')}</span>` : `${it.coverage_days}${it.coverage_gt_9999 ? '+' : ''} d`}</td>
                    <td>${this.reasonLabel(it.reason)}</td>
                    <td>${this.suggestLabel(it.suggest_action)}</td>
                    <td>${this.actionBadge(it.action)}</td>
                    <td style="white-space:nowrap">
                        <button class="btn btn-ghost btn-sm" onclick="InventoryTurnoverPage.openActionForm('${IT_ESC(it.xitems)}')">
                            ${it.action ? IT_L('重新下发', '重新下發', 'Re-dispatch') : IT_L('下发处理', '下發處理', 'Dispose')}
                        </button>
                    </td>
                </tr>`).join('') || `<tr><td colspan="10" style="text-align:center;color:#999">${IT_L('当前无呆滞库存', '目前無呆滯庫存', 'No slow-moving stock')}</td></tr>`}
                </tbody>
            </table></div>
        `;
    },

    reasonLabel(r) {
        return {
            '库龄超过 180 天': IT_L('库龄超过 180 天', '庫齡超過 180 天', 'Ageing > 180 days'),
            '库龄 91-180 天': IT_L('库龄 91-180 天', '庫齡 91-180 天', 'Ageing 91-180 days'),
            '库存覆盖超过 180 天': IT_L('库存覆盖超过 180 天', '庫存覆蓋超過 180 天', 'Coverage > 180 days')
        }[r] || r;
    },

    replenNote(it, d) {
        if (it.suggest_type === 'REORDER') {
            return IT_L(`覆盖 ${it.coverage_days} 天，低于补货点 ${d.reorder_point_days} 天`,
                `覆蓋 ${it.coverage_days} 天，低於補貨點 ${d.reorder_point_days} 天`,
                `Coverage ${it.coverage_days} d < reorder point ${d.reorder_point_days} d`);
        }
        if (!it.avg_daily_out) {
            return IT_L('无近 12 个月出库，库龄偏高，建议暂缓采购',
                '無近 12 個月出庫，庫齡偏高，建議暫緩採購',
                'No outbound in 12M; hold purchasing');
        }
        return IT_L('库龄偏高，建议暂缓采购，先消化库存',
            '庫齡偏高，建議暫緩採購，先消化庫存',
            'High ageing; hold purchasing and consume stock');
    },

    suggestLabel(a) {
        const map = {
            '降价促销': ['#fee2e2', '#991b1b', IT_L('降价促销', '降價促銷', 'Discount')],
            '退货供应商': ['#e0e7ff', '#3730a3', IT_L('退货供应商', '退貨供應商', 'Return to vendor')],
            '报废核销': ['#f3e8ff', '#6b21a8', IT_L('报废核销', '報廢核銷', 'Scrap')],
            '转用在制品': ['#dcfce7', '#166534', IT_L('转用在制品', '轉用在製品', 'Reuse')],
            '暂停采购': ['#fef3c7', '#92400e', IT_L('暂停采购', '暫停採購', 'Hold purchase')],
            '调拨其他公司': ['#e0f2fe', '#075985', IT_L('调拨', '調撥', 'Transfer')]
        }[a] || ['#e2e8f0', '#475569', a];
        return `<span style="padding:2px 8px;border-radius:10px;font-size:12px;background:${map[0]};color:${map[1]}">${map[2]}</span>`;
    },

    actionBadge(a) {
        if (!a) return `<span style="color:#94a3b8;font-size:12px">${IT_L('未下发', '未下發', 'Not issued')}</span>`;
        const map = {
            pending: ['#fef3c7', '#92400e', IT_L('待处理', '待處理', 'Pending')],
            doing: ['#e0f2fe', '#075985', IT_L('进行中', '進行中', 'Doing')],
            done: ['#dcfce7', '#166534', IT_L('已完成', '已完成', 'Done')]
        }[a.status] || ['#e2e8f0', '#475569', a.status];
        return `<span style="padding:2px 8px;border-radius:10px;font-size:12px;background:${map[0]};color:${map[1]}">${map[2]}</span>
            <div style="font-size:11px;color:#94a3b8">${IT_ESC(a.action_type)}${a.owner ? ' · ' + IT_ESC(a.owner) : ''}</div>`;
    },

    // ======== Tab 4: 补货建议 ========
    renderReplen() {
        const d = this.replen || {};
        const b = d.bu_level || {};
        const c = d.counts || {};
        const el = document.getElementById('itBody');
        el.innerHTML = `
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;align-items:flex-end">
                <div style="display:flex;align-items:center;gap:8px">
                    <label style="font-size:13px;color:#64748b">${IT_L('目标覆盖天数', '目標覆蓋天數', 'Target Days')}</label>
                    <select id="itTarget" class="form-input" style="width:110px" onchange="InventoryTurnoverPage.setTarget(this.value)">
                        ${[15, 30, 45, 60, 90].map(n => `<option value="${n}" ${this.targetDays === n ? 'selected' : ''}>${n} ${IT_L('天', '天', 'd')}</option>`).join('')}
                    </select>
                </div>
                <div style="font-size:12px;color:#94a3b8">
                    ${IT_L('补货点', '補貨點', 'Reorder point')} = ${IT_L('交期', '交期', 'lead')} ${d.lead_days ?? 15} + ${IT_L('安全', '安全', 'safety')} ${d.safety_days ?? 30} = ${d.reorder_point_days ?? 45} ${IT_L('天', '天', 'days')}
                </div>
            </div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
                ${this.card(IT_L('当前库存金额', '目前庫存金額', 'Current Stock'), UI.fmt(b.current_value), `${IT_L('快照', '快照', 'Snapshot')} ${d.stock_date || '-'}`, '#3b82f6')}
                ${this.card(IT_L('目标库存金额', '目標庫存金額', 'Target Stock'), UI.fmt(b.target_value), `${IT_L('年销售成本', '年銷售成本', 'TTM COGS')} ${UI.fmt(b.ttm_cogs)}`, '#8b5cf6')}
                ${this.card(IT_L('建议补货金额', '建議補貨金額', 'Suggested Replenish'), UI.fmt(b.suggest_replenish_amt), (b.gap_amt || 0) > 0 ? IT_L('库存低于目标', '庫存低於目標', 'Below target') : `${IT_L('建议压降', '建議壓降', 'Suggested reduce')} ${UI.fmt(b.excess_amt)}`, (b.gap_amt || 0) > 0 ? '#dc2626' : '#10b981')}
                ${this.card(IT_L('需补货料件', '需補貨料件', 'Reorder Items'), c.reorder ?? 0, IT_L('低于补货点', '低於補貨點', 'below reorder point'), '#f59e0b')}
                ${this.card(IT_L('暂缓采购料件', '暫緩採購料件', 'Hold Items'), c.hold ?? 0, IT_L('超储 / 呆滞', '超儲 / 呆滯', 'overstock / slow'), '#64748b')}
            </div>
            <div style="overflow-x:auto">
            <table class="data-table">
                <thead><tr>
                    <th>${IT_L('料件', '料件', 'Item')}</th>
                    <th style="text-align:right">${IT_L('库存数量', '庫存數量', 'Stock Qty')}</th>
                    <th style="text-align:right">${IT_L('库存金额', '庫存金額', 'Value')}</th>
                    <th style="text-align:right">${IT_L('日均出库', '日均出庫', 'Daily Out')}</th>
                    <th style="text-align:center">${IT_L('覆盖天数', '覆蓋天數', 'Coverage')}</th>
                    <th>${IT_L('建议', '建議', 'Suggestion')}</th>
                    <th style="text-align:right">${IT_L('建议补货量', '建議補貨量', 'Suggest Qty')}</th>
                    <th style="text-align:center">${IT_L('紧急度', '緊急度', 'Urgency')}</th>
                    <th>${IT_L('说明', '說明', 'Note')}</th>
                </tr></thead>
                <tbody>
                ${(d.items || []).map(it => `<tr>
                    <td><b>${IT_ESC(it.xitems)}</b></td>
                    <td class="num">${UI.fmt(it.qty, 2)}</td>
                    <td class="num">${UI.fmt(it.stock_value)}</td>
                    <td class="num">${it.avg_daily_out ? UI.fmt(it.avg_daily_out, 3) : '—'}</td>
                    <td class="text-center">${it.coverage_days == null ? '—' : `${it.coverage_days}${it.coverage_gt_9999 ? '+' : ''} d`}</td>
                    <td>${it.suggest_type === 'REORDER'
                        ? `<span style="padding:2px 8px;border-radius:10px;font-size:12px;background:#fee2e2;color:#991b1b">${IT_L('建议补货', '建議補貨', 'Reorder')}</span>`
                        : `<span style="padding:2px 8px;border-radius:10px;font-size:12px;background:#e2e8f0;color:#475569">${IT_L('暂缓采购', '暫緩採購', 'Hold')}</span>`}</td>
                    <td class="num" style="font-weight:600">${it.suggest_type === 'REORDER' ? UI.fmt(it.suggest_qty, 2) : '—'}</td>
                    <td class="text-center">${this.urgencyBadge(it.urgency)}</td>
                    <td style="font-size:12px;color:#64748b">${IT_ESC(this.replenNote(it, d))}</td>
                </tr>`).join('') || `<tr><td colspan="9" style="text-align:center;color:#999">${IT_L('当前无补货建议', '目前無補貨建議', 'No replenishment suggestions')}</td></tr>`}
                </tbody>
            </table></div>
        `;
    },

    urgencyBadge(u) {
        const map = {
            high: ['#fee2e2', '#991b1b', IT_L('高', '高', 'High')],
            medium: ['#fef3c7', '#92400e', IT_L('中', '中', 'Medium')],
            low: ['#dcfce7', '#166534', IT_L('低', '低', 'Low')]
        }[u] || ['#e2e8f0', '#475569', u || '—'];
        return `<span style="padding:2px 8px;border-radius:10px;font-size:12px;background:${map[0]};color:${map[1]}">${map[2]}</span>`;
    },

    // ======== Tab 5: 处理记录 ========
    renderActions() {
        const el = document.getElementById('itBody');
        const statusBadge = (st) => ({
            pending: ['#fef3c7', '#92400e', IT_L('待处理', '待處理', 'Pending')],
            doing: ['#e0f2fe', '#075985', IT_L('进行中', '進行中', 'Doing')],
            done: ['#dcfce7', '#166534', IT_L('已完成', '已完成', 'Done')]
        }[st] || ['#e2e8f0', '#475569', st]);
        const prio = (p) => ({ high: IT_L('高', '高', 'High'), medium: IT_L('中', '中', 'Medium'), low: IT_L('低', '低', 'Low') }[p] || p);

        el.innerHTML = `
            <div class="card">
                <div class="card-title">${IT_L('呆滞处理单', '呆滯處理單', 'Slow-moving Disposal Orders')}（${this.actions.length}）</div>
                <div style="overflow-x:auto">
                <table class="data-table">
                    <thead><tr>
                        <th>#</th>
                        <th>${IT_L('料件', '料件', 'Item')}</th>
                        <th style="text-align:center">${IT_L('库龄', '庫齡', 'Age')}</th>
                        <th style="text-align:right">${IT_L('库存金额', '庫存金額', 'Value')}</th>
                        <th>${IT_L('处置方式', '處置方式', 'Action')}</th>
                        <th style="text-align:right">${IT_L('处置数量', '處置數量', 'Qty')}</th>
                        <th style="text-align:right">${IT_L('预计回收', '預計回收', 'Recover')}</th>
                        <th style="text-align:center">${IT_L('优先级', '優先級', 'Priority')}</th>
                        <th>${IT_L('责任人', '責任人', 'Owner')}</th>
                        <th style="text-align:center">${IT_L('时限', '時限', 'Due')}</th>
                        <th>${IT_L('状态', '狀態', 'Status')}</th>
                        <th>${IT_L('操作', '操作', 'Actions')}</th>
                    </tr></thead>
                    <tbody>
                    ${this.actions.map(a => {
                        const b = statusBadge(a.status);
                        return `<tr>
                            <td>${a.uid}</td>
                            <td><b>${IT_ESC(a.xitems)}</b>
                                <div style="font-size:11px;color:#94a3b8">${a.stock_date ? String(a.stock_date).slice(0, 10) : ''}</div></td>
                            <td class="text-center">${a.ageing_days} d</td>
                            <td class="num">${UI.fmt(a.stock_value)}</td>
                            <td>${IT_ESC(a.action_type)}</td>
                            <td class="num">${UI.fmt(a.action_qty, 2)}</td>
                            <td class="num">${UI.fmt(a.expect_recover_amt)}</td>
                            <td class="text-center">${prio(a.priority)}</td>
                            <td>${IT_ESC(a.owner || '—')}</td>
                            <td class="text-center">${a.due_date ? String(a.due_date).slice(0, 10) : '—'}</td>
                            <td><span style="padding:2px 8px;border-radius:10px;font-size:12px;background:${b[0]};color:${b[1]}">${b[2]}</span></td>
                            <td style="white-space:nowrap">
                                <select class="form-input" style="width:92px;padding:2px 4px;font-size:12px" onchange="InventoryTurnoverPage.setStatus(${a.uid}, this.value)">
                                    <option value="pending" ${a.status === 'pending' ? 'selected' : ''}>${IT_L('待处理', '待處理', 'Pending')}</option>
                                    <option value="doing" ${a.status === 'doing' ? 'selected' : ''}>${IT_L('进行中', '進行中', 'Doing')}</option>
                                    <option value="done" ${a.status === 'done' ? 'selected' : ''}>${IT_L('已完成', '已完成', 'Done')}</option>
                                </select>
                                <button class="btn btn-danger btn-sm" onclick="InventoryTurnoverPage.removeAction(${a.uid})">${IT_L('删除', '刪除', 'Delete')}</button>
                            </td>
                        </tr>`;
                    }).join('') || `<tr><td colspan="12" style="text-align:center;color:#999">${IT_L('暂无处理单，可在呆滞清单下发处理', '暫無處理單，可在呆滯清單下發處理', 'No disposal orders yet')}</td></tr>`}
                    </tbody>
                </table></div>
            </div>
        `;
    },

    findItem(xitems) {
        const pools = [this.slow?.items, this.aging?.items, this.replen?.items];
        for (const p of pools) {
            const it = (p || []).find(x => x.xitems === xitems);
            if (it) return it;
        }
        return null;
    },

    async openActionForm(xitems) {
        const it = this.findItem(xitems) || { xitems, stock_value: 0, max_ageing: 0, net_value: 0 };
        const types = await CodeHelper.values('INV_DISPOSAL_TYPE',
            ['降价促销', '退货供应商', '报废核销', '转用在制品', '暂停采购', '调拨其他公司']);
        const sugg = it.suggest_action || (it.max_ageing > 180 ? '降价促销' : '暂停采购');
        const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
        UI.modal(`${IT_L('下发呆滞处理', '下發呆滯處理', 'Dispatch Disposal')} — ${IT_ESC(xitems)}`, `
            <div class="form-grid">
                <div><label>${IT_L('库存金额', '庫存金額', 'Stock Value')}</label>
                    <input class="form-input" value="${UI.fmt(it.stock_value)}" readonly style="background:#f5f5f5"></div>
                <div><label>${IT_L('库龄（天）', '庫齡（天）', 'Ageing (days)')}</label>
                    <input class="form-input" value="${it.max_ageing || 0}" readonly style="background:#f5f5f5"></div>
                <div><label>${IT_L('处置方式', '處置方式', 'Action Type')} *</label>
                    <select id="ia_type" class="form-input">
                        ${types.map(t => `<option value="${IT_ESC(t)}" ${t === sugg ? 'selected' : ''}>${IT_ESC(t)}</option>`).join('')}
                    </select></div>
                <div><label>${IT_L('处置数量', '處置數量', 'Qty')}</label>
                    <input id="ia_qty" type="number" step="0.0001" class="form-input" value="${it.qty || 0}"></div>
                <div><label>${IT_L('预计回收金额', '預計回收金額', 'Recover Amount')}</label>
                    <input id="ia_recover" type="number" step="0.01" class="form-input" value="${it.net_value || it.stock_value || 0}"></div>
                <div><label>${IT_L('优先级', '優先級', 'Priority')}</label>
                    <select id="ia_priority" class="form-input">
                        <option value="high" ${it.severity === 'severe' ? 'selected' : ''}>${IT_L('高', '高', 'High')}</option>
                        <option value="medium" ${it.severity !== 'severe' ? 'selected' : ''}>${IT_L('中', '中', 'Medium')}</option>
                        <option value="low">${IT_L('低', '低', 'Low')}</option>
                    </select></div>
                <div><label>${IT_L('责任人', '責任人', 'Owner')}</label>
                    <input id="ia_owner" class="form-input" placeholder="${IT_L('如：仓库主管', '如：倉庫主管', 'e.g. warehouse lead')}"></div>
                <div><label>${IT_L('完成时限', '完成時限', 'Due Date')}</label>
                    <input id="ia_due" type="date" class="form-input" value="${due}"></div>
                <div class="col-2"><label>${IT_L('备注', '備註', 'Remark')}</label>
                    <input id="ia_remark" class="form-input"></div>
            </div>
        `, `<button class="btn btn-ghost" onclick="UI.closeModal()">${IT_L('取消', '取消', 'Cancel')}</button>
            <button class="btn btn-primary" onclick="InventoryTurnoverPage.saveAction('${IT_ESC(xitems)}')">${IT_L('确认下发', '確認下發', 'Dispatch')}</button>`);
    },

    async saveAction(xitems) {
        const body = {
            bu_no: this.bu,
            xitems,
            stock_date: this.slow?.stock_date || this.aging?.stock_date || this.stock_date || null,
            action_type: document.getElementById('ia_type').value,
            action_qty: Number(document.getElementById('ia_qty').value) || 0,
            expect_recover_amt: Number(document.getElementById('ia_recover').value) || 0,
            priority: document.getElementById('ia_priority').value,
            owner: document.getElementById('ia_owner').value || null,
            due_date: document.getElementById('ia_due').value || null,
            remark: document.getElementById('ia_remark').value || null
        };
        try {
            await API.post('/api/inventory-turnover/actions', body);
            UI.toast(IT_L('呆滞处理单已下发', '呆滯處理單已下發', 'Disposal order dispatched'), 'success');
            UI.closeModal();
            await this.loadCurrent();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async setStatus(uid, status) {
        try {
            await API.put(`/api/inventory-turnover/actions/${uid}`, { status });
            UI.toast(IT_L('状态已更新', '狀態已更新', 'Status updated'), 'success');
            await this.loadCurrent();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async removeAction(uid) {
        if (!confirm(IT_L('确认删除该处理单？', '確認刪除該處理單？', 'Delete this disposal order?'))) return;
        try {
            await API.del(`/api/inventory-turnover/actions/${uid}`);
            UI.toast(IT_L('已删除', '已刪除', 'Deleted'), 'success');
            await this.loadCurrent();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};

registerPage('inventoryTurnover', async () => { await InventoryTurnoverPage.load(); });
