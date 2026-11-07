/**
 * 仪表板页面
 */
/**
 * 图表数据标签插件：柱状图标数值、环形图标占比
 */
const chartDataLabelPlugin = {
    id: 'dataLabel',
    afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        const ds = chart.data.datasets[0];
        if (!ds) return;
        const fmtShort = (v) => {
            const n = Number(v) || 0;
            if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + '亿';
            if (Math.abs(n) >= 1e4) return Math.round(n / 1e4) + '万';
            return n.toFixed(0);
        };

        if (chart.config.type === 'bar') {
            const meta = chart.getDatasetMeta(0);
            ctx.save();
            ctx.font = '10px "PingFang SC", "Microsoft YaHei", sans-serif';
            ctx.fillStyle = '#52525B';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            meta.data.forEach((bar, i) => {
                const v = Number(ds.data[i] || 0);
                if (!v) return;
                ctx.fillText(fmtShort(v), bar.x, bar.y - 4);
            });
            ctx.restore();
        } else if (chart.config.type === 'doughnut') {
            const total = ds.data.reduce((a, b) => a + (Number(b) || 0), 0);
            if (total <= 0) return;
            const meta = chart.getDatasetMeta(0);
            ctx.save();
            ctx.font = '600 11px "PingFang SC", "Microsoft YaHei", sans-serif';
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            meta.data.forEach((arc, i) => {
                const span = Math.abs(arc.endAngle - arc.startAngle);
                if (span < 0.3) return; // 过小扇区放不下文字，由 tooltip 展示
                const pct = (Number(ds.data[i] || 0) / total) * 100;
                const angle = (arc.startAngle + arc.endAngle) / 2;
                const r = (arc.innerRadius + arc.outerRadius) / 2;
                ctx.fillText(pct.toFixed(1) + '%', arc.x + Math.cos(angle) * r, arc.y + Math.sin(angle) * r);
            });
            ctx.restore();
        }
    }
};

registerPage('dashboard', async (c) => {
    const { bu_no, YYYY_MM } = State;

    c.className = 'dash-page';
    c.innerHTML = `
        <div class="kpi-grid" id="kpiGrid"><div class="empty-state"><div class="icon">⏳</div>${t('loading')}</div></div>
        <div class="dash-charts-row">
            <div class="card dash-chart-card">
                <div class="card-title">${t('dash.pl_chart')}<span class="dash-drill-hint">💡 ${t('dash.detail.hint')}</span></div>
                <div class="dash-chart-box"><canvas id="plChart"></canvas></div>
            </div>
            <div class="card dash-chart-card">
                <div class="card-title">${t('dash.bs_chart')}</div>
                <div class="dash-chart-box"><canvas id="bsChart"></canvas></div>
            </div>
        </div>
        <div class="card dash-risk-card">
            <div class="card-title">${t('dash.risk_panel')}</div>
            <div id="riskPanel">${t('loading')}</div>
        </div>
        <div class="card" style="margin-top:16px;border-left:4px solid #7c3aed;background:linear-gradient(135deg,#f5f3ff,#fff);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <div class="card-title" style="margin:0;">🤖 ${t('daily_summary.title') || 'AI 每日执行摘要'}
                    <span id="aiSumMeta" style="font-size:11px;color:#95a5a6;font-weight:normal;"></span>
                </div>
                <div style="display:flex;gap:8px;">
                    <button class="btn btn-sm btn-primary" id="aiSumGenBtn" onclick="genDailySummary()" style="background:#7c3aed;border:none;color:#fff;">⚡ ${t('daily_summary.generate') || '立即生成'}</button>
                    <button class="btn btn-sm" id="aiSumHistoryBtn" onclick="showDailySummaryHistory()">📋 ${t('daily_summary.history') || '历史'}</button>
                </div>
            </div>
            <div id="aiSummaryCard" style="min-height:120px;">
                <div style="text-align:center;color:#95a5a6;padding:30px;">⏳ ${t('loading')}</div>
            </div>
        </div>
    `;

    // ===== 弹窗共用基础设施（明细钻取 / Z-Score 说明）=====
    function ensureDashStyles() {
        if (document.getElementById('dashDetailStyle')) return;
        const st = document.createElement('style');
        st.id = 'dashDetailStyle';
        st.textContent = `
.dash-drill-hint{font-size:.72em;font-weight:400;color:#95a5a6;margin-left:10px;}
.dash-detail-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;z-index:9999;align-items:center;justify-content:center;}
.dash-detail-overlay.show{display:flex;}
.dash-detail-card{background:#fff;border-radius:12px;width:90%;max-width:860px;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.25);overflow:hidden;}
.dash-detail-header{display:flex;justify-content:space-between;align-items:center;padding:14px 20px;background:linear-gradient(135deg,#2c3e50,#34495e);color:#fff;}
.dash-detail-title{font-size:1.05em;font-weight:700;}
.dash-detail-close{background:none;border:none;color:#fff;font-size:1.3em;cursor:pointer;padding:0 4px;line-height:1;}
.dash-detail-close:hover{opacity:.7;}
.dash-detail-sub{padding:8px 20px;background:#f8f9fa;color:#7f8c8d;font-size:.88em;border-bottom:1px solid #ecf0f1;}
.dash-detail-body{padding:16px 20px;overflow-y:auto;flex:1;}
.dash-detail-footer{padding:12px 20px;border-top:1px solid #eee;text-align:right;background:#fafafa;}
.dash-detail-tablewrap{overflow-x:auto;}
.dash-detail-table{width:100%;border-collapse:collapse;font-size:.9em;}
.dash-detail-table th,.dash-detail-table td{padding:8px 10px;border-bottom:1px solid #ecf0f1;}
.dash-detail-table thead th{background:#f8f9fa;color:#2c3e50;font-weight:700;text-align:left;}
.dash-detail-table th.num,.dash-detail-table td.num{text-align:right;font-variant-numeric:tabular-nums;}
.dash-detail-table tbody tr:hover{background:#f4f8fc;}
.dash-detail-table tfoot td{font-weight:800;background:#eaf2f8;color:#1a5276;}
.dash-status{display:inline-block;padding:2px 10px;border-radius:10px;font-size:.82em;font-weight:600;}
.dash-status.paid{background:#d5f5e3;color:#1e8449;}
.dash-status.unpaid{background:#fdebd0;color:#b9770e;}
.kpi-card.clickable{cursor:pointer;transition:transform .15s,box-shadow .15s;}
.kpi-card.clickable:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,.12);}
.dash-z-intro{font-size:.9em;line-height:1.6;color:#566573;background:#f4f8fc;border-left:4px solid #2c3e50;padding:10px 14px;border-radius:6px;margin-bottom:14px;}
.dash-z-current{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:.95em;}
.dash-z-current.green{background:#eafaf1;border:1px solid #abebc6;}
.dash-z-current.yellow{background:#fef9e7;border:1px solid #f7dc6f;}
.dash-z-current.red{background:#fdedec;border:1px solid #f5b7b1;}
.dash-z-bignum{font-size:1.7em;font-weight:800;font-variant-numeric:tabular-nums;}
.dash-z-badge{padding:3px 14px;border-radius:12px;font-weight:700;font-size:.88em;color:#fff;}
.dash-z-badge.green{background:#27ae60;}
.dash-z-badge.yellow{background:#d4ac0d;}
.dash-z-badge.red{background:#c0392b;}
.dash-z-section{font-weight:700;color:#2c3e50;margin:16px 0 8px;font-size:.95em;}
.dash-z-formula{font-family:Consolas,Menlo,monospace;background:#f8f9fa;border:1px solid #ecf0f1;border-radius:6px;padding:10px 14px;font-size:.95em;color:#1a5276;overflow-x:auto;}
.dash-detail-table tr.zone-active td{font-weight:700;background:#eaf2f8;}
.dash-detail-table tr.zone-green td:first-child{border-left:4px solid #27ae60;}
.dash-detail-table tr.zone-yellow td:first-child{border-left:4px solid #d4ac0d;}
.dash-detail-table tr.zone-red td:first-child{border-left:4px solid #c0392b;}
.dash-z-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle;}
.dash-z-dot.green{background:#27ae60;}
.dash-z-dot.yellow{background:#d4ac0d;}
.dash-z-dot.red{background:#c0392b;}`;
        document.head.appendChild(st);
    }

    function buildDashModal(ovId, titleId, subId, bodyId) {
        ensureDashStyles();
        const ov = document.createElement('div');
        ov.id = ovId;
        ov.className = 'dash-detail-overlay';
        ov.innerHTML = `
            <div class="dash-detail-card">
                <div class="dash-detail-header">
                    <span class="dash-detail-title" id="${titleId}"></span>
                    <button type="button" class="dash-detail-close" data-close>✕</button>
                </div>
                <div class="dash-detail-sub" id="${subId}"></div>
                <div class="dash-detail-body" id="${bodyId}"></div>
                <div class="dash-detail-footer">
                    <button type="button" class="btn" data-close>${t('modal.close')}</button>
                </div>
            </div>`;
        c.appendChild(ov);
        const card = ov.firstElementChild;
        // 点击遮罩（卡片以外）关闭
        ov.addEventListener('click', (e) => { if (!card.contains(e.target)) ov.classList.remove('show'); });
        ov.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => ov.classList.remove('show')));
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ov.classList.remove('show'); });
        return ov;
    }

    // ===== 损益柱状图明细钻取弹窗（销货收入＝AR 销项发票／销货成本＝AP 进项发票）=====
    function ensureDashDetailModal() {
        let ov = document.getElementById('dashDetailOverlay');
        if (ov) return ov;
        ov = buildDashModal('dashDetailOverlay', 'dashDetailTitle', 'dashDetailSub', 'dashDetailBody');
        return ov;
    }

    // ===== Z-Score 风险等级说明弹窗 =====
    function openZDetail(r) {
        const zVal = Number(r.Z_score || 0);
        const zone = zVal >= 2.9 ? 'green' : (zVal >= 1.23 ? 'yellow' : 'red');
        const zoneLabel = zone === 'green' ? t('dash.safe') : (zone === 'yellow' ? t('dash.grey') : t('dash.bankrupt'));

        let ov = document.getElementById('dashZOverlay');
        if (!ov) ov = buildDashModal('dashZOverlay', 'dashZTitle', 'dashZSub', 'dashZBody');
        ov.querySelector('#dashZTitle').textContent = `📘 ${t('dash.zmodal.title')}`;
        ov.querySelector('#dashZSub').textContent = `${State.bu_no}  ·  ${State.YYYY_MM}`;

        const zones = [
            { key: 'green', range: 'Z ≥ 2.9', label: t('dash.safe'), desc: t('dash.zmodal.safe_desc') },
            { key: 'yellow', range: '1.23 ≤ Z < 2.9', label: t('dash.grey'), desc: t('dash.zmodal.grey_desc') },
            { key: 'red', range: 'Z < 1.23', label: t('dash.bankrupt'), desc: t('dash.zmodal.bankrupt_desc') }
        ];
        const vars = [
            { name: 'X1', weight: '1.2', desc: t('dash.zmodal.x1'), val: r.Z_X1 },
            { name: 'X2', weight: '1.4', desc: t('dash.zmodal.x2'), val: r.Z_X2 },
            { name: 'X3', weight: '3.3', desc: t('dash.zmodal.x3'), val: r.Z_X3 },
            { name: 'X4', weight: '0.6', desc: t('dash.zmodal.x4'), val: r.Z_X4 },
            { name: 'X5', weight: '0.999', desc: t('dash.zmodal.x5'), val: r.Z_X5 }
        ];
        const fmtV = (v) => (v === null || v === undefined || v === '') ? '-' : UI.fmt(v, 4);

        ov.querySelector('#dashZBody').innerHTML = `
            <div class="dash-z-intro">${t('dash.zmodal.intro')}</div>
            <div class="dash-z-current ${zone}">
                <span class="dash-z-bignum">Z = ${UI.fmt(zVal, 4)}</span>
                <span class="dash-z-badge ${zone}">${zoneLabel}</span>
                <span style="color:#7f8c8d;font-size:.88em;">${t('dash.zmodal.current')}</span>
            </div>
            <div class="dash-detail-tablewrap">
            <table class="dash-detail-table">
                <thead><tr>
                    <th>${t('dash.zmodal.col.zone')}</th>
                    <th>${t('dash.zmodal.col.range')}</th>
                    <th>${t('dash.zmodal.col.meaning')}</th>
                </tr></thead>
                <tbody>
                    ${zones.map(z => `
                        <tr class="zone-${z.key}${z.key === zone ? ' zone-active' : ''}">
                            <td><span class="dash-z-dot ${z.key}"></span>${z.label}</td>
                            <td>${z.range}</td>
                            <td>${z.desc}</td>
                        </tr>`).join('')}
                </tbody>
            </table>
            </div>
            <div class="dash-z-section">${t('dash.zmodal.formula')}</div>
            <div class="dash-z-formula">Z = 1.2·X1 + 1.4·X2 + 3.3·X3 + 0.6·X4 + 0.999·X5</div>
            <div class="dash-z-section">${t('dash.zmodal.vars')}</div>
            <div class="dash-detail-tablewrap">
            <table class="dash-detail-table">
                <thead><tr>
                    <th>${t('dash.zmodal.col.var')}</th>
                    <th>${t('dash.zmodal.col.weight')}</th>
                    <th>${t('dash.zmodal.col.meaning')}</th>
                    <th class="num">${t('dash.zmodal.col.value')}</th>
                </tr></thead>
                <tbody>
                    ${vars.map(v => `
                        <tr>
                            <td><strong>${v.name}</strong></td>
                            <td>${v.weight}</td>
                            <td>${v.desc}</td>
                            <td class="num">${fmtV(v.val)}</td>
                        </tr>`).join('')}
                </tbody>
            </table>
            </div>
            <div class="dash-z-section">${t('dash.zmodal.others')}</div>
            <div class="kpi-grid">
                <div class="kpi-card ${Number(r.Z2_score) >= 2.9 ? 'green' : (Number(r.Z2_score) >= 1.23 ? 'yellow' : 'red')}">
                    <div class="kpi-label">${t('risk.z2')}</div>
                    <div class="kpi-value">${UI.fmt(r.Z2_score, 4)}</div>
                </div>
                <div class="kpi-card ${Number(r.Z3_score) >= 2.6 ? 'green' : (Number(r.Z3_score) >= 1.1 ? 'yellow' : 'red')}">
                    <div class="kpi-label">${t('risk.z3')}</div>
                    <div class="kpi-value">${UI.fmt(r.Z3_score, 4)}</div>
                </div>
            </div>`;
        ov.classList.add('show');
    }

    async function openPLDetail(kind) {
        const isSale = kind === 'sale';
        const ov = ensureDashDetailModal();
        ov.querySelector('#dashDetailTitle').textContent = `📊 ${isSale ? t('dash.detail.sale_title') : t('dash.detail.cost_title')}`;
        ov.querySelector('#dashDetailSub').textContent = `${State.bu_no}  ·  ${State.YYYY_MM}`;
        const body = ov.querySelector('#dashDetailBody');
        body.innerHTML = `<div class="empty-state"><div class="icon">⏳</div>${t('loading')}</div>`;
        ov.classList.add('show');
        try {
            const q = `bu_no=${encodeURIComponent(State.bu_no)}&YYYY_MM=${encodeURIComponent(State.YYYY_MM)}&TX_type=${isSale ? 'AR' : 'AP'}`;
            const res = await API.get(`/api/invoice?${q}`);
            const rows = res.data || [];
            if (!rows.length) {
                body.innerHTML = UI.empty('📭', t('inv.no_data'));
                return;
            }
            const sumAmt = rows.reduce((acc, r) => acc + Number(r.amt || 0), 0);
            const sumTax = rows.reduce((acc, r) => acc + Number(r.tax_amt || 0), 0);
            const esc = (v) => (v == null || v === '' ? '-' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
            body.innerHTML = `
                <div class="dash-detail-tablewrap">
                <table class="dash-detail-table">
                    <thead><tr>
                        <th>${t('inv.date')}</th>
                        <th>${t('inv.no')}</th>
                        <th>${t('inv.customer')}</th>
                        <th class="num">${t('inv.amount')}</th>
                        <th class="num">${t('inv.tax')}</th>
                        <th>${t('inv.status')}</th>
                    </tr></thead>
                    <tbody>
                        ${rows.map(r => `
                            <tr>
                                <td>${UI.fmtDate(r.inv_date)}</td>
                                <td>${esc(r.inv_no)}</td>
                                <td>${esc(r.cust_name)}</td>
                                <td class="num">${UI.fmt(r.amt)}</td>
                                <td class="num">${UI.fmt(r.tax_amt)}</td>
                                <td><span class="dash-status ${r.status1 === 'paid' ? 'paid' : 'unpaid'}">${r.status1 === 'paid' ? t('pay.paid') : t('pay.unpaid')}</span></td>
                            </tr>`).join('')}
                    </tbody>
                    <tfoot><tr>
                        <td colspan="3">${t('bep.item.total_count').replace('{count}', rows.length)}</td>
                        <td class="num">${UI.fmt(sumAmt)}</td>
                        <td class="num">${UI.fmt(sumTax)}</td>
                        <td></td>
                    </tr></tfoot>
                </table>
                </div>`;
        } catch (err) {
            body.innerHTML = `<div class="empty-state"><div class="icon">❌</div><div>${t('load_failed')}: ${esc(err.message)}</div></div>`;
        }
    }

    try {
        const [summary, risk] = await Promise.allSettled([
            API.get(`/api/summary?bu_no=${bu_no}&YYYY_MM=${YYYY_MM}`),
            API.get(`/api/risk?bu_no=${bu_no}&YYYY_MM=${YYYY_MM}`)
        ]);

        let s = null;
        if (summary.status === 'fulfilled' && summary.value.data && summary.value.data.length > 0) {
            s = summary.value.data[0];
        }

        // KPI 卡片
        const kpi = document.getElementById('kpiGrid');
        if (s) {
            const netPL = Number(s.net_profit_amt || 0);
            const sale = Number(s.sale_amt || 0);
            const ttlAsset = Number(s.ttl_asset_amt || 0);
            const ttlDebet = Number(s.ttl_debet_amt || 0);
            const equity = Number(s.stockholder_amt || 0);
            kpi.innerHTML = `
                <div class="kpi-card ${netPL >= 0 ? 'green' : 'red'}">
                    <div class="kpi-label">${t('dash.net_pl')}</div>
                    <div class="kpi-value ${netPL >= 0 ? 'positive' : 'negative'}">${UI.fmt(netPL)}</div>
                    <div class="kpi-sub">${YYYY_MM}</div>
                </div>
                <div class="kpi-card green">
                    <div class="kpi-label">${t('dash.sale')}</div>
                    <div class="kpi-value">${UI.fmt(sale)}</div>
                    <div class="kpi-sub">${t('dash.gross_margin_pct')} ${sale > 0 ? UI.fmt(Number(s.BIZ_major_margin_amt || 0) / sale * 100, 1) : 0}%</div>
                </div>
                <div class="kpi-card green">
                    <div class="kpi-label">${t('dash.total_asset')}</div>
                    <div class="kpi-value">${UI.fmt(ttlAsset)}</div>
                    <div class="kpi-sub">${t('dash.debt_ratio')} ${ttlAsset > 0 ? UI.fmt(ttlDebet / ttlAsset * 100, 1) : 0}%</div>
                </div>
                <div class="kpi-card green">
                    <div class="kpi-label">${t('dash.equity')}</div>
                    <div class="kpi-value">${UI.fmt(equity)}</div>
                    <div class="kpi-sub">${t('dash.equity_ratio')} ${ttlAsset > 0 ? UI.fmt(equity / ttlAsset * 100, 1) : 0}%</div>
                </div>
            `;

            // 损益图
            const plData = [
                Number(s.sale_amt || 0),
                Number(s.sale_cost_amt || 0),
                Number(s.BIZ_major_margin_amt || 0),
                Number(s.BIZ_margin_amt || 0),
                Number(s.operation_profit_amt || 0),
                Number(s.net_profit_amt || 0)
            ];
            new Chart(document.getElementById('plChart'), {
                type: 'bar',
                plugins: [chartDataLabelPlugin],
                data: {
                    labels: [t('dash.sale'), t('sum.cost'), t('sum.gross'), t('sum.op_income'), t('sum.op_profit'), t('sum.net')],
                    datasets: [{ data: plData, backgroundColor: ['#3498db','#e74c3c','#27ae60','#f39c12','#9b59b6','#1abc9c'] }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: { padding: { top: 18 } },
                    plugins: { legend: { display: false } },
                    scales: { y: { beginAtZero: true } },
                    // 仅销货收入(0)、销货成本(1) 可点击钻取
                    onHover: (evt, elements) => {
                        evt.native.target.style.cursor = elements.length && elements[0].index <= 1 ? 'pointer' : 'default';
                    },
                    onClick: (evt, elements) => {
                        if (!elements.length) return;
                        const idx = elements[0].index;
                        if (idx === 0) openPLDetail('sale');
                        else if (idx === 1) openPLDetail('cost');
                    }
                }
            });

            // 资产负债图
            new Chart(document.getElementById('bsChart'), {
                type: 'doughnut',
                plugins: [chartDataLabelPlugin],
                data: {
                    labels: [t('rpt.current_assets'), t('rpt.non_current_assets'), t('rpt.current_liab'), t('rpt.long_liab'), t('rpt.equity')],
                    datasets: [{
                        data: [
                            Number(s.current_asset_amt || 0),
                            Number(s.non_current_asset_amt || 0),
                            Number(s.current_debet_amt || 0),
                            Number(s.long_term_debet_amt || 0),
                            Number(s.stockholder_amt || 0)
                        ],
                        backgroundColor: ['#3498db','#2c5f8d','#e74c3c','#c0392b','#27ae60']
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'right',
                            // 鼠标移到图例时清空残留 tooltip，避免显示上一段弧的标签
                            onHover: (evt, item, legend) => {
                                const chart = legend.chart;
                                if (chart.tooltip && chart.tooltip.getActiveElements().length) {
                                    chart.tooltip.setActiveElements([], { x: 0, y: 0 });
                                    chart.update('none');
                                }
                            }
                        }
                    }
                }
            });
        } else {
            kpi.innerHTML = UI.empty('📭', `${YYYY_MM} ${t('dash.no_summary')}`);
        }

        // 风险面板
        const rp = document.getElementById('riskPanel');
        if (risk.status === 'fulfilled' && risk.value.data && risk.value.data.length > 0) {
            const r = risk.value.data[0];
            const zVal = Number(r.Z_score || 0);
            // 直接由 Z 值重算判定（与弹窗 openZDetail 逻辑一致），不依赖可能过时的 DB risk_color / wall_mode
            const zZone = zVal >= 2.9 ? 'green' : (zVal >= 1.23 ? 'yellow' : 'red');
            const zZoneLabel = zZone === 'green' ? t('dash.safe') : (zZone === 'yellow' ? t('dash.grey') : t('dash.bankrupt'));
            // 流动比率: >=1.5 安全, >=1 灰色, <1 破产区
            const cr = Number(r.current_ratio || 0);
            const crZone = cr >= 1.5 ? 'green' : (cr >= 1 ? 'yellow' : 'red');
            const crLabel = cr >= 1.5 ? t('dash.safe') : (cr >= 1 ? t('dash.grey') : t('dash.bankrupt'));
            // 负债比: <=50 安全, <=70 灰色, >70 破产区
            const dr = Number(r.debt_ratio || 0);
            const drZone = dr <= 50 ? 'green' : (dr <= 70 ? 'yellow' : 'red');
            const drLabel = dr <= 50 ? t('dash.safe') : (dr <= 70 ? t('dash.grey') : t('dash.bankrupt'));
            // ROE: >=0 安全, <0 破产区
            const roe = Number(r.ROE || 0);
            const roeZone = roe >= 0 ? 'green' : 'red';
            const roeLabel = roe >= 0 ? t('dash.safe') : t('dash.bankrupt');
            const hint = `<span style="font-size:.75em;font-weight:400;opacity:.75;">👆 ${t('dash.zmodal.hint')}</span>`;
            rp.innerHTML = `
                <div class="kpi-grid">
                    <div class="kpi-card ${zZone} clickable" id="zScoreCard" title="${t('dash.zmodal.hint')}">
                        <div class="kpi-label">${t('dash.z_score')} ${hint}</div>
                        <div class="kpi-value">${UI.fmt(zVal, 4)}</div>
                        <div class="kpi-badge ${zZone}">${zZoneLabel}</div>
                    </div>
                    <div class="kpi-card ${crZone} clickable" id="crCard" title="${t('dash.zmodal.hint')}">
                        <div class="kpi-label">${t('dash.current_ratio')} ${hint}</div>
                        <div class="kpi-value">${UI.fmt(r.current_ratio, 4)}</div>
                        <div class="kpi-badge ${crZone}">${crLabel}</div>
                        <div class="kpi-sub">${t('dash.quick_ratio')} ${UI.fmt(r.quick_ratio, 4)} ${crZone !== 'green' ? `· <a href="#" onclick="event.stopPropagation();Diagnosis.open('current_ratio')" style="color:#2563eb;">🔍 ${t('dash.diagnose')}</a>` : ''}</div>
                    </div>
                    <div class="kpi-card ${drZone} clickable" id="drCard" title="${t('dash.zmodal.hint')}">
                        <div class="kpi-label">${t('dash.debt_ratio_label')} ${hint}</div>
                        <div class="kpi-value">${UI.fmt(r.debt_ratio, 1)}%</div>
                        <div class="kpi-badge ${drZone}">${drLabel}</div>
                        <div class="kpi-sub">${drZone !== 'green' ? `<a href="#" onclick="event.stopPropagation();Diagnosis.open('debt_ratio')" style="color:#2563eb;">🔍 ${t('dash.anomaly_diagnose')}</a>` : ''}</div>
                    </div>
                    <div class="kpi-card ${roeZone} clickable" id="roeCard" title="${t('dash.zmodal.hint')}">
                        <div class="kpi-label">${t('dash.roe')} ${hint}</div>
                        <div class="kpi-value">${UI.fmt(r.ROE, 2)}%</div>
                        <div class="kpi-badge ${roeZone}">${roeLabel}</div>
                        <div class="kpi-sub">${t('dash.roa')} ${UI.fmt(r.ROA, 2)}% ${roeZone !== 'green' ? `· <a href="#" onclick="event.stopPropagation();Diagnosis.open('roe')" style="color:#2563eb;">🔍 ${t('dash.diagnose')}</a>` : ''}</div>
                    </div>
                </div>
            `;
            // 四张风险灯号卡片皆可点击查看风险等级说明
            const zCard = document.getElementById('zScoreCard');
            if (zCard) zCard.addEventListener('click', () => openZDetail(r));
            const bindHelp = (id, key) => {
                const el = document.getElementById(id);
                // RiskHelp 定义于 risk.js（全域词法作用域，const 不挂 window，故用 typeof 判断）
                if (el && typeof RiskHelp !== 'undefined') el.addEventListener('click', () => RiskHelp.open(key, r));
            };
            bindHelp('crCard', 'cr');
            bindHelp('drCard', 'dr');
            bindHelp('roeCard', 'roe');
        } else {
            rp.innerHTML = UI.empty('⚠️', t('dash.no_risk'));
        }
    } catch (err) {
        c.innerHTML = `<div class="card"><p style="color:#e74c3c">❌ ${t('load_failed')}: ${err.message}</p><p style="margin-top:10px"><button class="btn btn-primary" onclick="navigate('dashboard')">${t('refresh')}</button></p></div>`;
    }

    // === C-1 每日 AI 摘要 ===
    try { loadDailySummary(); } catch (e) { console.warn('[daily-summary] 加载失败:', e.message); }
});

// ======== C-1 每日 AI 摘要 全局函数 ========
async function loadDailySummary() {
    const card = document.getElementById('aiSummaryCard');
    const meta = document.getElementById('aiSumMeta');
    const btn = document.getElementById('aiSumGenBtn');
    if (!card) return;
    try {
        const res = await API.get('/api/daily-summary/latest');
        if (!res.data?.has_summary) {
            // 没历史 — 显示聚合快照 + 引导
            const agg = res.data?.aggregate;
            const html = agg ? renderAggregateTeaser(agg) : '';
            card.innerHTML = `<div style="padding:12px;">
                <div style="font-size:13px;color:#64748b;margin-bottom:10px;">${t('daily_summary.no_summary_hint') || '尚未生成摘要，点击按钮立即生成一份！'}</div>
                ${html}
            </div>`;
            meta.textContent = '';
            return;
        }
        const s = res.data;
        meta.textContent = `· ${s.summary_date} · ${s.provider || 'auto'} · ${s.duration_ms ? s.duration_ms + 'ms' : ''}`;
        // 渲染 alert badge + content（截断前 600 字，详情展开用历史）
        const alerts = s.alerts_json || [];
        let alertBadges = '';
        if (alerts.length > 0) {
            const colors = { danger: '#dc2626', warning: '#f59e0b' };
            alertBadges = alerts.slice(0, 3).map(a =>
                `<span style="background:${colors[a.level] || '#64748b'};color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;margin-right:4px;">${a.level === 'danger' ? '🔴' : '🟡'} ${a.bu || ''} ${a.msg}</span>`
            ).join('');
        }
        const contentHtml = (s.content || '').replace(/\n/g, '<br>').slice(0, 800);
        card.innerHTML = `<div style="padding:8px 12px;">
            ${alertBadges ? `<div style="margin-bottom:10px;">${alertBadges}</div>` : ''}
            <div style="font-weight:700;color:#1e1b4b;margin-bottom:8px;">${s.title}</div>
            <div style="font-size:13px;color:#475569;line-height:1.7;white-space:pre-wrap;">${contentHtml}${(s.content || '').length > 800 ? '…' : ''}</div>
            ${(s.content || '').length > 800 ? `<button class="btn btn-sm" style="margin-top:8px;" onclick="showDailySummaryHistory()">📖 ${t('daily_summary.read_full') || '查看完整摘要'}</button>` : ''}
        </div>`;
    } catch (e) {
        card.innerHTML = `<div style="padding:20px;text-align:center;color:#95a5a6;">⚠️ ${e.message}</div>`;
    }
}

function renderAggregateTeaser(agg) {
    const g = agg.group_consolidated || {};
    const r = agg.risk_ranking || [];
    const a = (agg.alerts || []).slice(0, 3);
    let html = `<div style="background:#fff8f0;border:1px solid #fed7aa;border-radius:8px;padding:10px 14px;font-size:12px;">`;
    html += `<b>📊 ${g.period || ''} 快覽：</b> 合併營收 <b>${(+g.consolidated_sale).toLocaleString()}</b> · 淨利 <b>${(+g.consolidated_net_profit).toLocaleString()}</b> · 利潤率 ${g.profit_margin}`;
    if (a.length > 0) {
        html += `<br><b>⚠️ 風險：</b>`;
        a.forEach(x => html += `<span style="color:${x.level === 'danger' ? '#dc2626' : '#f59e0b'};margin-right:8px;">${x.bu}: ${x.msg}</span>`);
    }
    html += `</div>`;
    return html;
}

async function genDailySummary() {
    const btn = document.getElementById('aiSumGenBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 生成中...'; }
    try {
        const res = await API.post('/api/daily-summary/generate', { force: true, lang: (typeof I18N !== 'undefined' && I18N.lang) ? I18N.lang : 'zh-TW' });
        UI.toast(res.data.is_llm ? '✨ AI 摘要生成完成！' : '📊 规则引擎摘要生成完成', 'success');
        await loadDailySummary();
    } catch (e) {
        UI.toast('❌ ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '⚡ ' + (t('daily_summary.generate') || '立即生成'); }
    }
}

async function showDailySummaryHistory() {
    let list = [];
    try {
        const res = await API.get('/api/daily-summary/history?pageSize=5');
        list = res.data?.list || [];
    } catch (e) { UI.toast(e.message, 'error'); return; }

    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    let rows = list.map(r => `
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:10px;cursor:pointer;" onclick="viewDailySummary(${r.uid})">
            <div style="display:flex;justify-content:space-between;font-size:12px;color:#7f8c8d;margin-bottom:6px;">
                <span>🕒 ${esc(r.generated_time)} · ${esc(r.provider || 'auto')}${r.duration_ms ? ' · ' + r.duration_ms + 'ms' : ''}</span>
                <span style="background:#ede9fe;color:#6d28d9;padding:2px 8px;border-radius:10px;font-size:11px;">${esc(r.trigger_type)}</span>
            </div>
            <div style="font-weight:600;color:#1e1b4b;font-size:14px;">${esc(r.title)}</div>
        </div>`).join('');
    if (!rows) rows = `<div style="text-align:center;color:#95a5a6;padding:30px;">${t('daily_summary.no_history') || '暂无历史'}</div>`;

    UI.modal(t('daily_summary.title') + ' — ' + (t('daily_summary.history') || '历史'), `
        <div style="max-height:65vh;overflow-y:auto;">${rows}</div>
    `, `<button class="btn" onclick="UI.closeModal()">${t('close')}</button>`);
}

async function viewDailySummary(uid) {
    try {
        const all = await API.get('/api/daily-summary/history?pageSize=50');
        const item = (all.data?.list || []).find(x => x.uid === uid);
        if (!item) return;
        UI.closeModal();
        const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
        UI.modal(esc(item.title), `
            <div style="font-size:12px;color:#7f8c8d;margin-bottom:10px;">
                🕒 ${esc(item.generated_time)} · ${esc(item.provider)} · ${esc(item.trigger_type)}
            </div>
            <div style="white-space:pre-wrap;line-height:1.7;color:#334155;font-size:14px;max-height:60vh;overflow-y:auto;">${esc(item.title)}\n\n${esc(item.content)}</div>
        `, `<button class="btn" onclick="UI.closeModal()">${t('close')}</button>`);
    } catch (e) { UI.toast(e.message, 'error'); }
}
