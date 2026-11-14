/**
 * 戰情聯動看板
 * PO → SO → DN → 回款 漏斗 + 跨 BU 即時卡片 + 集團駕駛艙（目標/排名/對標/重大事項）
 */
const WRL = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] || zh);

const WR_KPI = {
    revenue: ['营业收入', '營業收入', 'Revenue'],
    net_profit: ['净利润', '淨利潤', 'Net Profit'],
    gross_margin: ['毛利率', '毛利率', 'Gross Margin'],
    inventory_turn: ['存货周转率', '存貨週轉率', 'Inventory Turns'],
    ar_days: ['应收天数', '應收天數', 'AR Days']
};
const WR_RANK = Object.assign({}, WR_KPI, {
    cash: ['现金余额', '現金餘額', 'Cash']
});
const WR_BENCH = {
    gross_profit: ['毛利率', '毛利率', 'Gross Margin'],
    net_profit_margin: ['净利率', '淨利率', 'Net Margin'],
    inventory_turn: ['存货周转率', '存貨週轉率', 'Inventory Turns'],
    ar_days: ['应收天数', '應收天數', 'AR Days'],
    roe: ['净资产收益率', '淨資產收益率', 'ROE'],
    debt_ratio: ['负债比率', '負債比率', 'Debt Ratio']
};
const wrLabel = (map, code) => {
    const v = map[code];
    return v ? WRL(v[0], v[1], v[2]) : code;
};

const WarRoom = {
    async load() {
        const bu = document.getElementById('wrBu').value;
        const ym = document.getElementById('wrMonth').value;
        const url = `/api/war-room/overview?bu_no=${bu}${ym ? '&YYYY_MM=' + ym : ''}`;
        const res = await API.get(url);
        return res.data;
    },

    async loadGroup() {
        const ym = document.getElementById('wrMonth').value;
        const res = await API.get(`/api/war-room/group${ym ? '?YYYY_MM=' + ym : ''}`);
        return res.data;
    },

    fmt(n) {
        const v = Number(n || 0);
        const lang = I18N.lang;
        if (lang === 'en') {
            if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(2) + 'B';
            if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
            if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K';
            return v.toLocaleString('en-US');
        }
        // zh-CN / zh-TW
        if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2) + ' 億';
        if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(1) + ' 萬';
        return v.toLocaleString();
    },

    stageLabel(s) {
        const lang = I18N.lang;
        if (lang === 'en') return s.label_en;
        if (lang === 'zh-CN') return s.label_cn;
        return s.label_tw;
    },

    render(d, g) {
        const box = document.getElementById('wrBody');
        if (!d || (!d.funnel && !d.cross_bu)) {
            box.innerHTML = `<div class="card"><p style="color:#999;">${t('warRoom.no_data')}</p></div>`;
            return;
        }

        // ===== 漏斗（點擊 bar 顯示該階段明細） =====
        const funnel = (d.funnel || []).map((s, i) => {
            const max = Math.max(...d.funnel.map(f => f.value || 0), 1);
            const pct = Math.max(4, (s.value / max) * 100);
            const colors = ['#3498db', '#2ecc71', '#f39c12', '#e74c3c'];
            return `
                <div style="margin-bottom:14px;">
                    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
                        <b>${this.stageLabel(s)}</b>
                        <span>${this.fmt(s.value)}${I18N.lang === 'en' ? '' : ' 元'}${s.qty ? (I18N.lang === 'en' ? ' (' + this.fmt(s.qty) + ' pcs)' : '（' + this.fmt(s.qty) + ' 件）') : ''}</span>
                    </div>
                    <div style="background:#eee;border-radius:6px;overflow:hidden;cursor:pointer;" title="${t('warRoom.click_detail') || '點擊查看明細'}" onclick="WarRoom.openFunnel('${s.stage}')">
                        <div style="width:${pct}%;background:${colors[i]};height:28px;border-radius:6px;display:flex;align-items:center;justify-content:flex-end;padding-right:10px;color:#fff;font-size:12px;font-weight:600;transition:width .4s;">
                            ${s.value > 0 ? '' : ''}
                        </div>
                    </div>
                </div>`;
        }).join('');

        // ===== 指標卡片 =====
        const m = d.metrics || {};
        const cards = [
            { k: 'warRoom.po_cnt', v: m.po_cnt, unit: '', color: '#3498db' },
            { k: 'warRoom.so_cnt', v: m.so_cnt, unit: '', color: '#2ecc71' },
            { k: 'warRoom.dn_cnt', v: m.dn_cnt, unit: '', color: '#f39c12' },
            { k: 'warRoom.fulfill_rate', v: m.fulfill_rate, unit: '%', color: '#9b59b6' },
            { k: 'warRoom.on_time_rate', v: m.on_time_rate, unit: '%', color: '#1abc9c' },
            { k: 'warRoom.cash', v: m.cash, unit: 'amt', color: '#27ae60' },
            { k: 'warRoom.inventory', v: m.inventory, unit: 'amt', color: '#e67e22' },
            { k: 'warRoom.ar', v: m.ar, unit: 'amt', color: '#e74c3c' },
            { k: 'warRoom.ap', v: m.ap, unit: 'amt', color: '#34495e' }
        ];
        const cardsHtml = cards.map(c => `
            <div class="card" style="padding:14px;margin:0;">
                <div style="font-size:12px;color:#7f8c8d;">${t(c.k)}</div>
                <div style="font-size:22px;font-weight:700;color:${c.color};margin-top:4px;">
                    ${c.unit === 'amt' ? this.fmt(c.v) : (c.unit === '%' ? Number(c.v).toFixed(1) + '%' : c.v)}
                </div>
            </div>
        `).join('');

        // ===== 跨 BU 表格 =====
        const cross = d.cross_bu || [];
        const crossHtml = cross.length ? `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>${t('warRoom.col_bu')}</th>
                        <th>${t('warRoom.col_po')}</th>
                        <th>${t('warRoom.col_so')}</th>
                        <th>${t('warRoom.col_sale')}</th>
                        <th>${t('warRoom.col_cash')}</th>
                        <th>${t('warRoom.col_ar')}</th>
                        <th>${t('warRoom.col_ap')}</th>
                        <th>${t('warRoom.col_inv')}</th>
                        <th>${t('warRoom.col_loan')}</th>
                    </tr>
                </thead>
                <tbody>
                    ${cross.map(r => `
                        <tr>
                            <td><b>${r.bu_no}</b></td>
                            <td>${this.fmt(r.po_amt)}</td>
                            <td>${this.fmt(r.so_amt)}</td>
                            <td>${this.fmt(r.sale_amt)}</td>
                            <td style="color:#27ae60;font-weight:600;">${this.fmt(r.cash)}</td>
                            <td style="color:#e74c3c;">${this.fmt(r.ar)}</td>
                            <td>${this.fmt(r.ap)}</td>
                            <td>${this.fmt(r.inventory)}</td>
                            <td>${this.fmt(r.loan)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        ` : `<div style="color:#999;">${t('warRoom.no_data')}</div>`;

        box.innerHTML = `
            <div class="card" style="margin-bottom:16px;">
                <div class="card-title">${t('warRoom.funnel')} <small style="color:#7f8c8d;font-weight:normal;">${d.YYYY_MM || ''}</small></div>
                ${funnel}
            </div>
            <div class="card" style="margin-bottom:16px;">
                <div class="card-title">${t('warRoom.metrics')}</div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;">
                    ${cardsHtml}
                </div>
            </div>
            <div class="card">
                <div class="card-title">${t('warRoom.cross_bu')}</div>
                ${crossHtml}
            </div>
            ${g ? this.renderGroup(g) : ''}
        `;
    },

    // ===== 集团驾驶舱增强（CEO-04） =====
    esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    valText(v, unit) {
        if (v === null || v === undefined || isNaN(v)) return '-';
        if (unit === '元') return this.fmt(v) + ' 元';
        if (unit === '%') return Number(v).toFixed(1) + '%';
        if (unit === '次/年') return Number(v).toFixed(2) + ' 次';
        if (unit === '天') return Number(v).toFixed(1) + ' 天';
        return String(v);
    },

    renderGroup(g) {
        return this.renderTargets(g) + this.renderRankings(g) + this.renderBenchmark(g) + this.renderEvents(g);
    },

    renderTargets(g) {
        const meta = {
            ahead: [WRL('领先', '領先', 'Ahead'), '#27ae60', '#e8f8f0'],
            ontrack: [WRL('正常', '正常', 'On Track'), '#2980b9', '#eaf4fb'],
            behind: [WRL('滞后', '落後', 'Behind'), '#e74c3c', '#fdecea'],
            na: [WRL('无目标', '無目標', 'No Target'), '#95a5a6', '#f4f6f7']
        };
        const body = (g.targets || []).map(b => b.rows.map((r, i) => {
            const sm = meta[r.status] || meta.na;
            const att = r.attainment === null ? '-' : Number(r.attainment).toFixed(1) + '%';
            const bar = r.attainment === null ? '' :
                `<div style="height:4px;background:#eef2f7;border-radius:2px;margin-top:4px;min-width:74px">
                    <div style="width:${Math.min(100, Math.max(0, r.attainment))}%;height:4px;border-radius:2px;background:${sm[1]}"></div>
                </div>`;
            return `<tr>
                ${i === 0 ? `<td rowspan="${b.rows.length}" style="vertical-align:top;"><b>${b.bu_no === 'GROUP' ? WRL('集团', '集團', 'Group') : b.bu_no}</b>${b.bu_no === 'GROUP' ? `<div style="font-size:11px;color:#95a5a6">${WRL('汇总', '彙總', 'Consolidated')}</div>` : ''}</td>` : ''}
                <td>${wrLabel(WR_KPI, r.kpi_code) || r.label}</td>
                <td class="num">${this.valText(r.target, r.unit)}</td>
                <td class="num">${this.valText(r.actual, r.unit)}</td>
                <td class="num"><b style="color:${sm[1]}">${att}</b>${bar}</td>
                <td><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;color:${sm[1]};background:${sm[2]}">${sm[0]}</span></td>
                <td><button class="btn btn-ghost" style="padding:2px 8px;font-size:12px"
                    onclick="WarRoom.editTarget('${b.bu_no}','${r.kpi_code}',${g.year},${r.target},'${wrLabel(WR_KPI, r.kpi_code)}','${r.unit}')">${WRL('调整', '調整', 'Edit')}</button></td>
            </tr>`;
        }).join('')).join('');

        return `
            <div class="card" style="margin-top:16px;">
                <div class="card-title">🎯 ${WRL('目标达成', '目標達成', 'Target Attainment')}
                    <small style="color:#7f8c8d;font-weight:normal;">FY${g.year} · ${WRL('截至', '截至', 'as of')} ${g.YYYY_MM} · ${WRL('时间进度', '時間進度', 'time progress')} ${g.time_progress}%</small>
                </div>
                <div style="overflow-x:auto"><table class="data-table">
                    <thead><tr>
                        <th>BU</th><th>${WRL('指标', '指標', 'KPI')}</th><th class="num">${WRL('年度目标', '年度目標', 'Annual Target')}</th><th class="num">${WRL('年初至今', '年初至今', 'YTD Actual')}</th>
                        <th class="num">${WRL('达成率', '達成率', 'Attainment')}</th><th>${WRL('状态', '狀態', 'Status')}</th><th>${WRL('操作', '操作', 'Action')}</th>
                    </tr></thead>
                    <tbody>${body}</tbody>
                </table></div>
                <div style="font-size:11px;color:#94a3b8;margin-top:8px;">${WRL(
                    '未维护目标时按上年实际自动推导（营收 +10%、净利 +15%、毛利率 +0.5pp、周转 +5%、应收天数 -5%），可点「调整」覆盖。',
                    '未維護目標時按上年實際自動推導（營收 +10%、淨利 +15%、毛利率 +0.5pp、週轉 +5%、應收天數 -5%），可點「調整」覆蓋。',
                    'Unsaved targets are derived from prior-year actuals (revenue +10%, net profit +15%, gross margin +0.5pp, turns +5%, AR days -5%). Click Edit to override.')}</div>
            </div>`;
    },

    renderRankings(g) {
        const unitOf = (u) => u === 'amt' ? '元' : u === 'turn' ? '次/年' : u === 'day' ? '天' : '%';
        const medal = ['🥇', '🥈', '🥉'];
        const cards = (g.rankings || []).map(rk => `
            <div style="border:1px solid #e8eef5;border-radius:8px;padding:10px 12px;">
                <div style="font-size:12px;color:#7f8c8d;margin-bottom:6px;">${wrLabel(WR_RANK, rk.key)}${rk.higher ? '' : WRL(' · 越低越好', ' · 越低越好', ' · lower is better')}</div>
                ${rk.rows.length ? rk.rows.map(r => `
                    <div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;border-bottom:1px dashed #f1f5f9;">
                        <span>${medal[r.rank - 1] || (r.rank + '.')} <b>${r.bu_no}</b></span>
                        <span>${this.valText(r.value, unitOf(rk.unit))}</span>
                    </div>`).join('') : `<div style="color:#999;font-size:12px;">${WRL('暂无数据', '暫無資料', 'No data')}</div>`}
            </div>`).join('');
        return `
            <div class="card" style="margin-top:16px;">
                <div class="card-title">🏆 ${WRL('BU 排名', 'BU 排名', 'BU Ranking')} <small style="color:#7f8c8d;font-weight:normal;">${g.YYYY_MM} ${WRL('年初至今', '年初至今', 'YTD')}</small></div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">${cards}</div>
            </div>`;
    },

    renderBenchmark(g) {
        const b = g.benchmark || {};
        const clamp = (v) => Math.min(100, Math.max(0, v));
        const rows = (b.rows || []).map(r => {
            const a = r.actual, min = Number(r.p10), max = Number(r.p90);
            const pct = (a !== null && max > min) ? clamp((a - min) / (max - min) * 100) : 50;
            const better = r.better === null ? null : r.better;
            const color = better === null ? '#95a5a6' : (better ? '#27ae60' : '#e74c3c');
            const text = better === null ? '-' : (better ? WRL('优于中位', '優於中位', 'Above median') : WRL('低于中位', '低於中位', 'Below median'));
            return `<tr>
                <td>${wrLabel(WR_BENCH, r.kpi_id) || r.label}</td>
                <td class="num"><b>${this.valText(a, r.unit)}</b></td>
                <td class="num">${this.valText(r.p25, r.unit)}</td>
                <td class="num">${this.valText(r.median, r.unit)}</td>
                <td class="num">${this.valText(r.p75, r.unit)}</td>
                <td style="min-width:140px;">
                    <div style="position:relative;height:6px;border-radius:3px;background:linear-gradient(90deg,#fde2e1,#fef3c7,#d1fae5);">
                        <div style="position:absolute;left:${pct}%;top:-4px;width:3px;height:14px;background:#2c3e50;border-radius:1px;"></div>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;"><span>P10</span><span>P90</span></div>
                </td>
                <td><span style="color:${color};font-weight:600;">${text}</span></td>
            </tr>`;
        }).join('');
        return `
            <div class="card" style="margin-top:16px;">
                <div class="card-title">📊 ${WRL('外部对标', '外部對標', 'Peer Benchmark')}
                    <small style="color:#7f8c8d;font-weight:normal;">${b.industry || ''} ${b.year || ''} ${WRL('同业分位', '同業分位', 'industry percentiles')}</small>
                </div>
                ${rows ? `<div style="overflow-x:auto"><table class="data-table">
                    <thead><tr><th>${WRL('指标', '指標', 'KPI')}</th><th class="num">${WRL('本公司', '本公司', 'Company')}</th><th class="num">P25</th><th class="num">${WRL('中位', '中位', 'Median')}</th>
                        <th class="num">P75</th><th>${WRL('同业区间', '同業區間', 'Peer Range')}</th><th>${WRL('评价', '評價', 'Verdict')}</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table></div>` : `<div style="color:#999;">${WRL('暂无同业标杆数据', '暫無同業標竿資料', 'No benchmark data')}</div>`}
                <div style="font-size:11px;color:#94a3b8;margin-top:8px;">${WRL(
                    '黑色刻度为本公司位置；ROE 为年初至今未年化口径。',
                    '黑色刻度為本公司位置；ROE 為年初至今未年化口徑。',
                    'The dark marker shows the company position; ROE is YTD and not annualized.')}</div>
            </div>`;
    },

    renderEvents(g) {
        const meta = {
            critical: [WRL('严重', '嚴重', 'Critical'), '#e74c3c'],
            danger: [WRL('严重', '嚴重', 'Critical'), '#e74c3c'],
            high: [WRL('严重', '嚴重', 'Critical'), '#e74c3c'],
            warning: [WRL('警告', '警告', 'Warning'), '#f39c12'],
            info: [WRL('提示', '提示', 'Info'), '#3498db']
        };
        const items = (g.events || []).map(e => {
            const m = meta[String(e.level || '').toLowerCase()] || meta.info;
            return `<div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px dashed #eef2f7;">
                <span style="width:8px;height:8px;border-radius:50%;background:${m[1]};margin-top:6px;flex:none;"></span>
                <div style="flex:1;">
                    <div style="font-size:13px;"><b>${this.esc(e.title)}</b>
                        <span style="font-size:11px;color:${m[1]};background:${m[1]}18;padding:1px 6px;border-radius:8px;margin-left:6px;">${m[0]}</span>
                        ${e.bu_no ? `<span style="font-size:11px;color:#64748b;margin-left:6px;">${e.bu_no}</span>` : ''}
                    </div>
                    <div style="font-size:12px;color:#7f8c8d;margin-top:2px;">${this.esc(e.message)}</div>
                </div>
                <div style="font-size:11px;color:#b0bec5;white-space:nowrap;">${e.created_at ? String(e.created_at).slice(0, 16) : ''}</div>
            </div>`;
        }).join('');
        return `
            <div class="card" style="margin-top:16px;">
                <div class="card-title">⚠️ ${WRL('重大事项', '重大事項', 'Key Issues')} <small style="color:#7f8c8d;font-weight:normal;">${WRL('告警与异常自动汇总', '告警與異常自動彙總', 'Alerts and exceptions')}</small></div>
                ${items || `<div style="color:#999;padding:6px 0;">${WRL('暂无重大事项', '暫無重大事項', 'No key issues')}</div>`}
            </div>`;
    },

    editTarget(bu, kpi, year, target, label, unit) {
        UI.modal(`🎯 ${WRL('调整年度目标', '調整年度目標', 'Edit Annual Target')}`, `
            <div class="form-row">
                <div class="form-group"><label>BU</label><input value="${bu === 'GROUP' ? WRL('集团（汇总）', '集團（彙總）', 'Group (consolidated)') : bu}" readonly></div>
                <div class="form-group"><label>${WRL('指标', '指標', 'KPI')}</label><input value="${label}" readonly></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${WRL('年度目标', '年度目標', 'Annual Target')}（${unit}）</label>
                    <input id="wrTargetVal" type="number" step="0.01" value="${target}"></div>
                <div class="form-group"><label>${WRL('年度', '年度', 'Year')}</label><input value="${year}" readonly></div>
            </div>
            <p style="font-size:12px;color:#7f8c8d;">${WRL(
                '未维护时按上年实际自动推导；保存后以维护值为准。',
                '未維護時按上年實際自動推導；儲存後以維護值為準。',
                'If not maintained, the target is derived from prior-year actuals; saved values take precedence.')}</p>
        `, `<button class="btn" onclick="UI.closeModal()">${t('cancel')}</button>
            <button class="btn btn-primary" onclick="WarRoom.saveTarget('${bu}','${kpi}',${year})">💾 ${t('save')}</button>`);
    },

    async saveTarget(bu, kpi, year) {
        const el = document.getElementById('wrTargetVal');
        const v = Number(el && el.value);
        if (!isFinite(v)) { UI.toast(WRL('请输入数字', '請輸入數字', 'Please enter a number'), 'error'); return; }
        try {
            await API.put('/api/war-room/targets', { bu_no: bu, kpi_code: kpi, year, target_value: v });
            UI.closeModal();
            UI.toast(WRL('年度目标已保存', '年度目標已儲存', 'Annual target saved'));
            this.refresh();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};

registerPage('warRoom', async (c) => {
    const _bu = await CodeHelper.buSel();
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
            <h2 style="margin:0;font-size:20px;">${t('warRoom.title')} <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">${t('warRoom.subtitle')}</small></h2>
            <div>
                <select id="wrBu" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                    ${_bu}
                </select>
                <input type="month" id="wrMonth" style="padding:7px;border:1px solid #ddd;border-radius:6px;margin-left:6px;">
                <button class="btn btn-primary" onclick="WarRoom.refresh()" style="margin-left:6px;">🔄 ${t('refresh')}</button>
            </div>
        </div>
        <div id="wrBody"><div style="text-align:center;padding:40px;color:#999;">${t('loading')}</div></div>
    `;
    document.getElementById('wrBu').value = State.bu_no;
    document.getElementById('wrMonth').value = State.YYYY_MM;
    WarRoom.refresh();
});

WarRoom.refresh = async function () {
    State.bu_no = document.getElementById('wrBu').value;
    const box = document.getElementById('wrBody');
    box.innerHTML = `<div style="text-align:center;padding:40px;color:#999;">${t('loading')}</div>`;
    try {
        const g = await WarRoom.loadGroup().catch(() => null);
        const monthEl = document.getElementById('wrMonth');
        if (g && g.YYYY_MM && monthEl.value !== g.YYYY_MM) monthEl.value = g.YYYY_MM;
        const d = await WarRoom.load();
        WarRoom.render(d, g);
    } catch (e) {
        box.innerHTML = `<div class="card"><p style="color:#e74c3c">❌ ${t('load_failed')}: ${e.message}</p></div>`;
    }
};

// ===== 漏斗明細鑽取彈窗 =====
WarRoom._funnelMeta = {
    PO: {
        title: () => t('warRoom.funnel_po') || '採購金額',
        cols: [
            { k: 'po_id', label: WRL('采购单号', '採購單號', 'PO No.') },
            { k: 'supplier_name', label: WRL('供应商', '供應商', 'Supplier'), wide: true },
            { k: 'xitems', label: WRL('品项', '品項', 'Item') },
            { k: 'po_qty', label: WRL('数量', '數量', 'Qty'), num: true, qty: true },
            { k: 'unit_price_local', label: WRL('单价', '單價', 'Unit Price'), num: true, money: true },
            { k: 'po_amount_local', label: WRL('金额', '金額', 'Amount'), num: true, money: true, sum: true },
            { k: 'po_date', label: WRL('日期', '日期', 'Date') },
            { k: 'po_status', label: WRL('状态', '狀態', 'Status') }
        ]
    },
    SO: {
        title: () => t('warRoom.funnel_so') || '銷售訂單',
        cols: [
            { k: 'so_nbr', label: WRL('订单号', '訂單號', 'Order No.') },
            { k: 'client_id', label: WRL('客户', '客戶', 'Customer'), wide: true },
            { k: 'xitems', label: WRL('品项', '品項', 'Item') },
            { k: 'so_qty', label: WRL('数量', '數量', 'Qty'), num: true, qty: true },
            { k: 'unit_price', label: WRL('单价', '單價', 'Unit Price'), num: true, money: true },
            { k: 'amt', label: WRL('金额', '金額', 'Amount'), num: true, money: true, sum: true }
        ]
    },
    DN: {
        title: () => t('warRoom.funnel_dn') || '交貨出庫',
        cols: [
            { k: 'DN_date', label: WRL('出货日期', '出貨日期', 'Ship Date') },
            { k: 'so_nbr', label: WRL('订单号', '訂單號', 'Order No.') },
            { k: 'client_name', label: WRL('客户', '客戶', 'Customer'), wide: true },
            { k: 'xitems', label: WRL('品项', '品項', 'Item') },
            { k: 'DN_qty', label: WRL('出库数量', '出庫數量', 'DN Qty'), num: true, qty: true, sum: true },
            { k: 'so_qty', label: WRL('订单数量', '訂單數量', 'Order Qty'), num: true, qty: true },
            { k: 'est_amt', label: WRL('推估金额', '推估金額', 'Est. Amount'), num: true, money: true, sum: true }
        ]
    },
    AR: {
        title: () => t('warRoom.funnel_ar') || '應收(回款)',
        cols: [
            { k: 'invoice_no', label: WRL('发票号', '發票號', 'Invoice No.') },
            { k: 'order_id', label: WRL('订单号', '訂單號', 'Order No.') },
            { k: 'client_id', label: WRL('客户', '客戶', 'Customer'), wide: true },
            { k: 'sub_amt', label: WRL('发票金额', '發票金額', 'Invoice Amount'), num: true, money: true, sum: true },
            { k: 'payment', label: WRL('已收款', '已收款', 'Collected'), num: true, money: true, sum: true },
            { k: 'wk_date', label: WRL('开票日期', '開票日期', 'Invoice Date') },
            { k: 'ageing_days', label: WRL('账龄(天)', '帳齡(天)', 'Ageing (days)'), num: true }
        ]
    }
};

WarRoom.ensureFunnelModal = function () {
    if (!document.getElementById('wrFunnelStyle')) {
        const st = document.createElement('style');
        st.id = 'wrFunnelStyle';
        st.textContent = `
.wr-funnel-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;z-index:9999;align-items:center;justify-content:center;}
.wr-funnel-overlay.show{display:flex;}
.wr-funnel-card{background:#fff;border-radius:12px;width:90%;max-width:960px;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.25);overflow:hidden;}
.wr-funnel-header{display:flex;justify-content:space-between;align-items:center;padding:14px 20px;background:linear-gradient(135deg,#2c3e50,#34495e);color:#fff;}
.wr-funnel-title{font-size:1.05em;font-weight:700;}
.wr-funnel-close{background:none;border:none;color:#fff;font-size:1.3em;cursor:pointer;padding:0 4px;line-height:1;}
.wr-funnel-close:hover{opacity:.7;}
.wr-funnel-sub{padding:8px 20px;background:#f8f9fa;color:#7f8c8d;font-size:.88em;border-bottom:1px solid #ecf0f1;}
.wr-funnel-body{padding:16px 20px;overflow-y:auto;flex:1;}
.wr-funnel-footer{padding:12px 20px;border-top:1px solid #eee;text-align:right;background:#fafafa;}
.wr-funnel-table{width:100%;border-collapse:collapse;font-size:.9em;}
.wr-funnel-table th,.wr-funnel-table td{padding:8px 10px;border-bottom:1px solid #ecf0f1;}
.wr-funnel-table thead th{background:#f8f9fa;color:#2c3e50;font-weight:700;text-align:left;}
.wr-funnel-table th.num,.wr-funnel-table td.num{text-align:right;font-variant-numeric:tabular-nums;}
.wr-funnel-table tbody tr:hover{background:#f4f8fc;}
.wr-funnel-table tfoot td{font-weight:800;background:#eaf2f8;color:#1a5276;}`;
        document.head.appendChild(st);
    }
    let ov = document.getElementById('wrFunnelOverlay');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'wrFunnelOverlay';
    ov.className = 'wr-funnel-overlay';
    ov.innerHTML = `
        <div class="wr-funnel-card">
            <div class="wr-funnel-header">
                <span class="wr-funnel-title" id="wrFunnelTitle"></span>
                <button type="button" class="wr-funnel-close" data-close>✕</button>
            </div>
            <div class="wr-funnel-sub" id="wrFunnelSub"></div>
            <div class="wr-funnel-body" id="wrFunnelBody"></div>
            <div class="wr-funnel-footer">
                <button type="button" class="btn" data-close>${t('modal.close') || '關閉'}</button>
            </div>
        </div>`;
    document.body.appendChild(ov);
    const card = ov.firstElementChild;
    ov.addEventListener('click', (e) => { if (!card.contains(e.target)) ov.classList.remove('show'); });
    ov.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => ov.classList.remove('show')));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ov.classList.remove('show'); });
    return ov;
};

WarRoom.poStatusLabel = function (v) {
    const map = {
        '已完成': WRL('已完成', '已完成', 'Completed'),
        '完成': WRL('完成', '完成', 'Completed'),
        '审核通过': WRL('审核通过', '審核通過', 'Approved'),
        '已审核': WRL('已审核', '已審核', 'Approved'),
        '待审核': WRL('待审核', '待審核', 'Pending Approval'),
        '未审核': WRL('未审核', '未審核', 'Not Approved'),
        '部分入库': WRL('部分入库', '部分入庫', 'Partially Received'),
        '已入库': WRL('已入库', '已入庫', 'Received'),
        '已取消': WRL('已取消', '已取消', 'Cancelled'),
        '作废': WRL('作废', '作廢', 'Void')
    };
    return map[String(v).trim()] || v;
};

WarRoom.funnelNumFmt = function (v, kind) {
    const n = Number(v || 0);
    if (kind === 'money') return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (kind === 'qty') return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(1);
    return n.toLocaleString('en-US');
};

WarRoom.openFunnel = async function (stage) {
    const meta = this._funnelMeta[stage];
    if (!meta) return;
    const bu = document.getElementById('wrBu').value;
    const ym = document.getElementById('wrMonth').value;
    const ov = this.ensureFunnelModal();
    const body = ov.querySelector('#wrFunnelBody');
    ov.querySelector('#wrFunnelTitle').textContent = `📋 ${meta.title()} ${WRL('明細', '明細', 'Details')}`;
    ov.querySelector('#wrFunnelSub').textContent = `${bu}  ·  ${ym || WRL('全期間', '全期間', 'All periods')}`;
    const closeBtn = ov.querySelector('.wr-funnel-footer [data-close]');
    if (closeBtn) closeBtn.textContent = t('modal.close') || WRL('關閉', '關閉', 'Close');
    body.innerHTML = `<div style="text-align:center;padding:30px;color:#999;">${t('loading') || '載入中...'}</div>`;
    ov.classList.add('show');

    try {
        const res = await API.get(`/api/war-room/funnel-detail?bu_no=${bu}&YYYY_MM=${ym}&stage=${stage}`);
        const rows = res.data || [];
        if (rows.length === 0) {
            body.innerHTML = `<div style="text-align:center;padding:30px;color:#999;">${t('warRoom.no_data') || '暫無資料'}</div>`;
            return;
        }
        // 合計行（僅對標記 sum 的欄位）
        const sums = {};
        meta.cols.forEach(c => {
            if (c.sum) sums[c.k] = rows.reduce((s, r) => s + Number(r[c.k] || 0), 0);
        });
        body.innerHTML = `<div style="overflow-x:auto;"><table class="wr-funnel-table">
            <thead><tr>${meta.cols.map(c => `<th class="${c.num ? 'num' : ''}"${c.wide ? ' style="white-space:nowrap;min-width:110px;"' : ''}>${c.label}</th>`).join('')}</tr></thead>
            <tbody>${rows.map(r => `<tr>${meta.cols.map(c => {
                const v = r[c.k];
                let txt = (v === null || v === undefined || v === '') ? '-' : (c.num ? this.funnelNumFmt(v, c.money ? 'money' : 'qty') : String(v));
                if (c.k === 'po_status' && txt !== '-') txt = this.poStatusLabel(txt);
                return `<td class="${c.num ? 'num' : ''}"${c.wide ? ' style="white-space:nowrap;min-width:110px;"' : ''}>${txt}</td>`;
            }).join('')}</tr>`).join('')}</tbody>
            ${(() => {
                const firstSumIdx = meta.cols.findIndex(x => x.sum);
                if (firstSumIdx < 0) return '';
                // 首列以 colspan 合併到首個合計欄前，後續欄位才能與表頭嚴格對齊
                const cells = [];
                for (let i = 0; i < meta.cols.length; i++) {
                    if (i === 0) {
                        cells.push(`<td colspan="${firstSumIdx}"><b>${WRL('合計', '合計', 'Total')} (${rows.length} ${WRL('筆', '筆', 'rows')})</b></td>`);
                        i = firstSumIdx - 1;
                        continue;
                    }
                    const c = meta.cols[i];
                    cells.push(c.sum
                        ? `<td class="num"><b>${this.funnelNumFmt(sums[c.k], c.money ? 'money' : 'qty')}</b></td>`
                        : `<td></td>`);
                }
                return `<tfoot><tr>${cells.join('')}</tr></tfoot>`;
            })()}
        </table></div>`;

        // CSV 匯出按鈕
        let btn = ov.querySelector('.wr-funnel-export');
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-primary wr-funnel-export';
            ov.querySelector('.wr-funnel-footer').prepend(btn);
        }
        btn.textContent = `📥 ${t('export') || '匯出'}`;
        btn.onclick = () => WarRoom.exportFunnelCSV(meta, rows, `${stage}_${bu}_${ym || 'all'}`);
    } catch (e) {
        body.innerHTML = `<p style="color:#e74c3c">❌ ${e.message}</p>`;
    }
};

WarRoom.exportFunnelCSV = function (meta, rows, filename) {
    const esc = (s) => {
        let text = String(s === null || s === undefined ? '' : s);
        if (/^-?[0-9,]+(\.\d+)?$/.test(text)) text = text.replace(/,/g, '');
        if (/[",\n]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
        return text;
    };
    const lines = [meta.cols.map(c => c.label).join(',')];
    rows.forEach(r => lines.push(meta.cols.map(c => esc(c.k === 'po_status' ? this.poStatusLabel(r[c.k]) : r[c.k])).join(',')));
    // 合計
    const sums = meta.cols.filter(c => c.sum);
    if (sums.length) {
        lines.push(meta.cols.map(c => c === sums[0] ? WRL('合計', '合計', 'Total') : (c.sum ? esc(rows.reduce((s, r) => s + Number(r[c.k] || 0), 0)) : '')).join(','));
    }
    const csv = '\ufeff' + lines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.csv') ? filename : filename + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
};
