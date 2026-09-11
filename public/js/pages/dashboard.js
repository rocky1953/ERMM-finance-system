/**
 * 儀表板頁面
 */
registerPage('dashboard', async (c) => {
    const { bu_no, YYYY_MM } = State;

    c.innerHTML = `
        <div class="kpi-grid" id="kpiGrid"><div class="empty-state"><div class="icon">⏳</div>${t('loading')}</div></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
            <div class="card">
                <div class="card-title">${t('dash.pl_chart')}<span class="dash-drill-hint">💡 ${t('dash.detail.hint')}</span></div>
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

    // ===== 彈窗共用基礎設施（明細鑽取 / Z-Score 說明）=====
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
        // 點擊遮罩（卡片以外）關閉
        ov.addEventListener('click', (e) => { if (!card.contains(e.target)) ov.classList.remove('show'); });
        ov.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => ov.classList.remove('show')));
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ov.classList.remove('show'); });
        return ov;
    }

    // ===== 損益柱狀圖明細鑽取彈窗（銷貨收入＝AR 銷項發票／銷貨成本＝AP 進項發票）=====
    function ensureDashDetailModal() {
        let ov = document.getElementById('dashDetailOverlay');
        if (ov) return ov;
        ov = buildDashModal('dashDetailOverlay', 'dashDetailTitle', 'dashDetailSub', 'dashDetailBody');
        return ov;
    }

    // ===== Z-Score 風險等級說明彈窗 =====
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
                options: {
                    responsive: true,
                    plugins: { legend: { display: false } },
                    scales: { y: { beginAtZero: true } },
                    // 僅銷貨收入(0)、銷貨成本(1) 可點擊鑽取
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
            // 直接由 Z 值重算判定（與彈窗 openZDetail 邏輯一致），不依賴可能過時的 DB risk_color / wall_mode
            const zZone = zVal >= 2.9 ? 'green' : (zVal >= 1.23 ? 'yellow' : 'red');
            const zZoneLabel = zZone === 'green' ? t('dash.safe') : (zZone === 'yellow' ? t('dash.grey') : t('dash.bankrupt'));
            rp.innerHTML = `
                <div class="kpi-grid">
                    <div class="kpi-card ${zZone} clickable" id="zScoreCard" title="${t('dash.zmodal.hint')}">
                        <div class="kpi-label">${t('dash.z_score')} <span style="font-size:.75em;font-weight:400;opacity:.75;">👆 ${t('dash.zmodal.hint')}</span></div>
                        <div class="kpi-value">${UI.fmt(zVal, 4)}</div>
                        <div class="kpi-badge ${zZone}">${zZoneLabel}</div>
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
            // 唯一入口：僅 Z-Score 卡片可點擊開啟說明彈窗
            const zCard = document.getElementById('zScoreCard');
            if (zCard) zCard.addEventListener('click', () => openZDetail(r));
        } else {
            rp.innerHTML = UI.empty('⚠️', t('dash.no_risk'));
        }
    } catch (err) {
        c.innerHTML = `<div class="card"><p style="color:#e74c3c">❌ ${t('load_failed')}: ${err.message}</p><p style="margin-top:10px"><button class="btn btn-primary" onclick="navigate('dashboard')">${t('refresh')}</button></p></div>`;
    }
});
