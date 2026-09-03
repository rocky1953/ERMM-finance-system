/**
 * 儀表板頁面
 */
registerPage('dashboard', async (c) => {
    const { bu_no, YYYY_MM } = State;

    c.innerHTML = `
        <div class="kpi-grid" id="kpiGrid"><div class="empty-state"><div class="icon">⏳</div>${t('loading')}</div></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
            <div class="card">
                <div class="card-title">${t('dash.pl_chart')}</div>
                <canvas id="plChart" height="200"></canvas>
            </div>
            <div class="card">
                <div class="card-title">${t('dash.bs_chart')}</div>
                <canvas id="bsChart" height="200"></canvas>
            </div>
        </div>
        <div class="card" style="margin-top:20px">
            <div class="card-title">${t('dash.risk_panel')}</div>
            <div id="riskPanel">${t('loading')}</div>
        </div>
    `;

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

            // 損益圖
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
                data: {
                    labels: [t('dash.sale'), t('sum.cost'), t('sum.gross'), t('sum.op_income'), t('sum.op_profit'), t('sum.net')],
                    datasets: [{ data: plData, backgroundColor: ['#3498db','#e74c3c','#27ae60','#f39c12','#9b59b6','#1abc9c'] }]
                },
                options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
            });

            // 資產負債圖
            new Chart(document.getElementById('bsChart'), {
                type: 'doughnut',
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
                options: { responsive: true, plugins: { legend: { position: 'right' } } }
            });
        } else {
            kpi.innerHTML = UI.empty('📭', `${YYYY_MM} ${t('dash.no_summary')}`);
        }

        // 風險面板
        const rp = document.getElementById('riskPanel');
        if (risk.status === 'fulfilled' && risk.value.data && risk.value.data.length > 0) {
            const r = risk.value.data[0];
            const zVal = Number(r.Z_score || 0);
            const zColor = r.risk_color || (zVal >= 2.9 ? 'GREEN' : (zVal >= 1.23 ? 'YELLOW' : 'RED'));
            rp.innerHTML = `
                <div class="kpi-grid">
                    <div class="kpi-card ${zColor.toLowerCase()}">
                        <div class="kpi-label">${t('dash.z_score')}</div>
                        <div class="kpi-value">${UI.fmt(zVal, 4)}</div>
                        <div class="kpi-badge ${zColor.toLowerCase()}">${r.wall_mode || (zColor === 'GREEN' ? t('dash.safe') : zColor === 'YELLOW' ? t('dash.grey') : t('dash.bankrupt'))}</div>
                    </div>
                    <div class="kpi-card ${Number(r.current_ratio) >= 1.5 ? 'green' : (Number(r.current_ratio) >= 1 ? 'yellow' : 'red')}">
                        <div class="kpi-label">${t('dash.current_ratio')}</div>
                        <div class="kpi-value">${UI.fmt(r.current_ratio, 4)}</div>
                        <div class="kpi-sub">${t('dash.quick_ratio')} ${UI.fmt(r.quick_ratio, 4)}</div>
                    </div>
                    <div class="kpi-card green">
                        <div class="kpi-label">${t('dash.debt_ratio_label')}</div>
                        <div class="kpi-value">${UI.fmt(r.debt_ratio, 1)}%</div>
                    </div>
                    <div class="kpi-card ${Number(r.ROE) >= 0 ? 'green' : 'red'}">
                        <div class="kpi-label">${t('dash.roe')}</div>
                        <div class="kpi-value">${UI.fmt(r.ROE, 2)}%</div>
                        <div class="kpi-sub">${t('dash.roa')} ${UI.fmt(r.ROA, 2)}%</div>
                    </div>
                </div>
            `;
        } else {
            rp.innerHTML = UI.empty('⚠️', t('dash.no_risk'));
        }
    } catch (err) {
        c.innerHTML = `<div class="card"><p style="color:#e74c3c">❌ ${t('load_failed')}: ${err.message}</p><p style="margin-top:10px"><button class="btn btn-primary" onclick="navigate('dashboard')">${t('refresh')}</button></p></div>`;
    }
});
