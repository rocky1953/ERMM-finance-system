/**
 * 现金流量预测页面
 * 未来 13 周滚动预测（點估計 + Monte Carlo 概率分佈 + 壓力測試）
 */
registerPage('cashForecast', async (c) => {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
            <h2 style="margin:0;font-size:20px;">💧 ${t('cash.forecast_title') || '現金流量預測'}
                <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">${t('cash.forecast_sub') || '未來 13 週 · Monte Carlo 概率模擬'}</small>
            </h2>
            <div>
                <select id="cfBu" onchange="loadCashForecast()" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                    <option value="HM">HM</option><option value="SZ">SZ</option><option value="HN">HN</option>
                </select>
                <button class="btn btn-outline" onclick="openSafeLevelModal()" style="margin-left:6px;">⚙ ${t('cash.safe_level') || '安全水位'}</button>
                <button class="btn btn-success" onclick="loadCashForecast()" style="margin-left:6px;">🔄</button>
            </div>
        </div>

        <!-- 概率風險卡（Monte Carlo 專屬） -->
        <div id="cfProbCard" class="card" style="display:none;position:relative;">
            <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;">
                <span>🎲 ${t('cash.prob_title') || 'Monte Carlo 概率風險評估'}</span>
                <div style="display:flex;gap:12px;align-items:center;font-size:13px;">
                    <span style="color:#7f8c8d;">${t('cash.stress_test') || '壓力測試'}：</span>
                    <label style="display:flex;align-items:center;gap:4px;">
                        ${t('cash.revenue_drop') || '收入下降'}
                        <input type="range" id="stressRev" min="0" max="50" value="0" step="5" oninput="applyStress()" style="width:100px;">
                        <span id="stressRevVal" style="min-width:32px;font-weight:600;color:#e74c3c;">0%</span>
                    </label>
                    <label style="display:flex;align-items:center;gap:4px;">
                        ${t('cash.cost_rise') || '支出上升'}
                        <input type="range" id="stressCost" min="0" max="50" value="0" step="5" oninput="applyStress()" style="width:100px;">
                        <span id="stressCostVal" style="min-width:32px;font-weight:600;color:#f39c12;">0%</span>
                    </label>
                    <button class="btn btn-primary" onclick="cashAttribution()" style="padding:5px 12px;font-size:13px;white-space:nowrap;">🧠 ${t('cash.ai_attribution') || 'AI 智能归因'}</button>
                </div>
            </div>
            <div id="cfProbContent">${t('loading')}</div>
        </div>

        <!-- 點估計摘要 -->
        <div id="cfSummary">${t('loading')}</div>

        <!-- 圖表 -->
        <div class="card" style="margin-top:16px;">
            <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
                <span>${t('cash.chart_title') || '13 週現金水位曲線'}</span>
                <div style="font-size:12px;color:#7f8c8d;">
                    <label><input type="radio" name="cfMode" value="point" checked onchange="loadCashForecast()"> ${t('cash.mode_point') || '點估計'}</label>
                    <label style="margin-left:8px;"><input type="radio" name="cfMode" value="monte" onchange="loadCashForecast()"> ${t('cash.mode_mc') || 'Monte Carlo 概率帶'}</label>
                </div>
            </div>
            <div id="cfChart">${t('loading')}</div>
        </div>
    `;
    document.getElementById('cfBu').value = State.bu_no;
    await loadCashForecast();
});

let _mcData = null;   // 快取 Monte Carlo 結果

async function loadCashForecast() {
    const bu = document.getElementById('cfBu').value;
    State.bu_no = bu;
    const mode = document.querySelector('input[name="cfMode"]:checked')?.value || 'point';
    const stressRev = Number(document.getElementById('stressRev')?.value || 0);
    const stressCost = Number(document.getElementById('stressCost')?.value || 0);

    try {
        // 同時拉點估計 + Monte Carlo
        const [weeklyRes, mcRes] = await Promise.all([
            API.get(`/api/cash-forecast/weekly?bu_no=${bu}&weeks=13`).catch(() => ({ success: false })),
            API.get(`/api/cash-forecast/monte-carlo?bu_no=${bu}&weeks=13&sims=800`).catch(() => ({ success: false }))
        ]);

        // 點估計摘要卡
        const d = weeklyRes.data || {};
        renderPointSummary(d);

        // Monte Carlo
        const mc = mcRes.data;
        _mcData = mc;
        if (mc && mc.success !== false) {
            document.getElementById('cfProbCard').style.display = '';
            renderProbCard(mc, stressRev, stressCost);
        } else {
            document.getElementById('cfProbCard').style.display = 'none';
        }

        // 圖表
        if (mode === 'monte' && mc) renderMCChart(mc, stressRev, stressCost, d.safe_level);
        else renderPointChart(d);

    } catch (e) {
        document.getElementById('cfSummary').innerHTML = `<p style="color:#e74c3c">${e.message}</p>`;
        document.getElementById('cfChart').innerHTML = '';
    }
}

function renderPointSummary(d) {
    if (!d.weeks) { document.getElementById('cfSummary').innerHTML = ''; return; }
    document.getElementById('cfSummary').innerHTML = `
        <div class="kpi-grid">
            <div class="kpi-card blue"><div class="kpi-label">${t('cash.current_bal') || '當前現金餘額'}</div><div class="kpi-value">${UI.fmt(d.current_balance)}</div><div class="kpi-sub">${t('cash.safe') || '安全水位'} ${UI.fmt(d.safe_level)}</div></div>
            <div class="kpi-card green"><div class="kpi-label">${t('cash.inflow_13w') || '13 週預計流入'}</div><div class="kpi-value positive">${UI.fmt(d.total_inflow)}</div><div class="kpi-sub">${t('cash.ar_inflow') || '應收到期 + 其他'}</div></div>
            <div class="kpi-card red"><div class="kpi-label">${t('cash.outflow_13w') || '13 週預計流出'}</div><div class="kpi-value negative">${UI.fmt(d.total_outflow)}</div><div class="kpi-sub">${t('cash.ap_outflow') || '應付 + 貸款攤還'}</div></div>
            <div class="kpi-card ${d.min_balance < d.safe_level ? 'red' : 'green'}">
                <div class="kpi-label">${t('cash.min_bal') || '最低現金水位'}</div>
                <div class="kpi-value">${UI.fmt(d.min_balance)}</div>
                <div class="kpi-sub">${t('cash.week') || '第'} ${d.min_week} ${t('cash.week_warn') || '週'} ${d.min_balance < d.safe_level ? '⚠️' : '✅'}</div>
            </div>
        </div>`;
}

function renderProbCard(mc, stressRev = 0, stressCost = 0) {
    // 套用壓力測試調整
    const factorRev = (100 - stressRev) / 100;
    const factorCost = (100 + stressCost) / 100;

    // 壓力測試後的概率（線性近似）
    const adjustProb = (p, stressFactor) => Math.min(99, p * stressFactor);
    const stressFactor = factorCost / factorRev;

    const p4 = adjustProb(mc.prob_4w, stressFactor);
    const p8 = adjustProb(mc.prob_8w, stressFactor);
    const pAll = adjustProb(mc.prob_all, stressFactor);
    const maxProb = adjustProb(mc.max_gap_prob, stressFactor);

    // 壓力後 P10（與 MC 圖表同一 shift 模型）：收入下降/支出上升都讓每週淨流入惡化，
    // 效果隨週數累積（第 w 週偏移 = 週均流入/流出 × 壓力% × w），方向恒為不利（向下）
    const w13 = mc.weekly[12] || {};
    const wk13 = w13.week || 13;
    const shift13 = -(mc.ar_avg_weekly || 0) * (stressRev / 100) * wk13
                  - (mc.ap_avg_weekly || 0) * (stressCost / 100) * wk13;
    const worstStressed = (w13.p10 || 0) + shift13;

    const riskLevel = pAll >= 30 ? { color: '#e74c3c', bg: '#fdecea', label: t('cash.risk_high') || '高風險' }
                   : pAll >= 10 ? { color: '#f39c12', bg: '#fef9e7', label: t('cash.risk_mid') || '中風險' }
                   :              { color: '#27ae60', bg: '#eafaf1', label: t('cash.risk_low') || '低風險' };

    document.getElementById('cfProbContent').innerHTML = `
        <div class="kpi-grid" style="grid-template-columns:repeat(5,1fr);">
            <div class="kpi-card" style="background:${riskLevel.bg};border-left:4px solid ${riskLevel.color};">
                <div class="kpi-label" style="color:#555;">${t('cash.risk_level') || '整體風險等級'}</div>
                <div class="kpi-value" style="color:${riskLevel.color};">${riskLevel.label}</div>
                <div class="kpi-sub">${t('cash.within13w') || '13 週內現金缺口概率'}</div>
            </div>
            <div class="kpi-card ${p4 > 0 ? 'red' : 'green'}">
                <div class="kpi-label">${t('cash.within4w') || '4 週內缺口'}</div>
                <div class="kpi-value">${p4.toFixed(1)}%</div>
                <div class="kpi-sub">${t('cash.p10_bal') || 'P10 最差餘額'} ${UI.fmt(mc.weekly[3]?.p10 || 0)}</div>
            </div>
            <div class="kpi-card ${p8 > 0 ? 'red' : 'green'}">
                <div class="kpi-label">${t('cash.within8w') || '8 週內缺口'}</div>
                <div class="kpi-value">${p8.toFixed(1)}%</div>
                <div class="kpi-sub">${t('cash.p10_bal') || 'P10 最差餘額'} ${UI.fmt(mc.weekly[7]?.p10 || 0)}</div>
            </div>
            <div class="kpi-card ${maxProb > 0 ? 'red' : 'green'}">
                <div class="kpi-label">${t('cash.max_risk_week') || '最高風險週'}</div>
                <div class="kpi-value">W${mc.max_gap_week || '-'}</div>
                <div class="kpi-sub">${t('cash.below_safe') || '跌破安全線概率'} ${maxProb.toFixed(1)}%</div>
            </div>
            <div class="kpi-card blue">
                <div class="kpi-label">${t('cash.worst_case') || '最差情境（13週 P10）'}</div>
                <div class="kpi-value">${UI.fmt(worstStressed)}</div>
                <div class="kpi-sub">${(stressRev || stressCost) ? `${t('cash.worst_scenario') || '最差情境'} P10：${UI.fmt(w13.p10 || 0)}<br>` : ''}${t('cash.history') || '歷史參數'}：AR ${mc.ar_days}天 / AP ${mc.ap_days}天</div>
            </div>
        </div>`;
}

function renderPointChart(d) {
    if (!d.weeks) { document.getElementById('cfChart').innerHTML = ''; return; }
    document.getElementById('cfChart').innerHTML = '<canvas id="cfCanvas" height="120"></canvas>';
    const ctx = document.getElementById('cfCanvas').getContext('2d');
    const weeks = d.weeks;
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: weeks.map(w => `W${w.week}`),
            datasets: [{
                label: t('cash.point_forecast') || '點估計餘額',
                data: weeks.map(w => w.end_balance),
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37,99,235,0.12)',
                fill: true, tension: 0.3, borderWidth: 2.5,
                pointBackgroundColor: weeks.map(w => w.is_safe ? '#2563eb' : '#e74c3c'),
                pointRadius: weeks.map(w => w.is_safe ? 4 : 6)
            }, {
                label: t('cash.safe_level') || '安全水位',
                data: weeks.map(() => d.safe_level),
                borderColor: '#f39c12', borderDash: [6, 4],
                fill: false, pointRadius: 0, borderWidth: 1.5
            }]
        },
        options: chartOptions()
    });
}

function renderMCChart(mc, stressRev = 0, stressCost = 0, safeLevel) {
    // 壓力測試後的每週分位（物理模型：收入下降 → 週流入減少；支出上升 → 週流出增加；
    // 第 w 週餘額偏移 = 週均流入/流出 × 壓力% × w，隨週數累積且方向恒向下）
    const weeks = mc.weekly.map(w => {
        const shift = -(mc.ar_avg_weekly || 0) * (stressRev / 100) * w.week
                    - (mc.ap_avg_weekly || 0) * (stressCost / 100) * w.week;
        return {
            week: w.week,
            p10: w.p10 + shift,
            p25: w.p25 + shift,
            median: w.median + shift,
            p75: w.p75 + shift,
            p90: w.p90 + shift,
            p10_orig: w.p10
        };
    });

    document.getElementById('cfChart').innerHTML = '<canvas id="cfCanvas" height="140"></canvas>';
    const ctx = document.getElementById('cfCanvas').getContext('2d');

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: weeks.map(w => `W${w.week}`),
            datasets: [
                // P90 上界
                { label: 'P90', data: weeks.map(w => w.p90), borderColor: 'transparent', pointRadius: 0, fill: '+1', backgroundColor: 'rgba(37,99,235,0.10)', tension: 0.3 },
                // P75
                { label: 'P75', data: weeks.map(w => w.p75), borderColor: 'transparent', pointRadius: 0, fill: '+1', backgroundColor: 'rgba(37,99,235,0.15)', tension: 0.3 },
                // Median
                { label: t('cash.median_line') || '中位數（50%）', data: weeks.map(w => w.median), borderColor: '#2563eb', borderWidth: 2.5, pointRadius: 3, fill: false, tension: 0.3 },
                // P25
                { label: 'P25', data: weeks.map(w => w.p25), borderColor: 'transparent', pointRadius: 0, fill: '+1', backgroundColor: 'rgba(231,76,60,0.18)', tension: 0.3 },
                // P10 下界
                { label: 'P10', data: weeks.map(w => w.p10), borderColor: '#e74c3c', borderWidth: 1.5, borderDash: [4, 3], pointRadius: 2, fill: false, tension: 0.3 },
                // 安全水位
                { label: t('cash.safe_level') || '安全水位', data: weeks.map(() => safeLevel), borderColor: '#f39c12', borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5, fill: false }
            ]
        },
        options: chartOptions(true)
    });
}

function chartOptions(isMC = false) {
    return {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
            tooltip: {
                callbacks: {
                    label: (ctx) => {
                        const v = UI.fmt(ctx.parsed.y);
                        if (ctx.dataset.label === 'P90') return `P90 ${t('cash.best_scenario') || '最佳情境'}: ${v}`;
                        if (ctx.dataset.label === 'P10') return `P10 ${t('cash.worst_scenario') || '最差情境'}: ${v}`;
                        return `${ctx.dataset.label}: ${v}`;
                    }
                }
            },
            legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }
        },
        scales: {
            y: { beginAtZero: false, ticks: { callback: (v) => UI.fmt(v / 10000) + '萬' } }
        }
    };
}

function applyStress() {
    const rev = document.getElementById('stressRev');
    const cost = document.getElementById('stressCost');
    document.getElementById('stressRevVal').textContent = rev.value + '%';
    document.getElementById('stressCostVal').textContent = cost.value + '%';

    if (!_mcData) return;
    // 概率風險卡不論圖表模式（點估計/Monte Carlo）都即時更新
    renderProbCard(_mcData, Number(rev.value), Number(cost.value));
    // 僅 Monte Carlo 概率帶模式重繪壓力後曲線
    const mode = document.querySelector('input[name="cfMode"]:checked')?.value;
    if (mode === 'monte') {
        const bu = document.getElementById('cfBu').value;
        API.get(`/api/cash-forecast/weekly?bu_no=${bu}&weeks=13`).then(r => {
            renderMCChart(_mcData, Number(rev.value), Number(cost.value), r.data?.safe_level || 3000000);
        });
    }
}

// ===== AI 智能归因（现金流预测） =====
async function cashAttribution() {
    if (!_mcData) { alert(t('cash.need_mc') || '請先切換到 Monte Carlo 概率帶模式'); return; }
    const bu = document.getElementById('cfBu').value;
    const rev = document.getElementById('stressRev')?.value || 0;
    const cost = document.getElementById('stressCost')?.value || 0;
    const safeLevel = _mcData.weekly?.[0]?.safe_level || 3000000;

    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center;';
    const stressLabel = `${t('cash.stress_pressure') || '壓力'} ${t('cash.revenue_drop') || '收入下降'}-${rev}% / ${t('cash.cost_rise') || '支出上升'}+${cost}%`;
    mask.innerHTML = `<div style="background:#fff;border-radius:10px;width:720px;max-height:86vh;overflow:auto;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,0.2);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <h3 style="margin:0;font-size:16px;">🧠 ${t('cash.ai_attribution') || 'AI 智能归因'} <span style="font-size:12px;color:#7f8c8d;font-weight:normal;">${bu} · ${stressLabel}</span></h3>
            <button onclick="this.closest('.modal-mask').remove()" style="border:none;background:transparent;font-size:20px;cursor:pointer;">✕</button>
        </div>
        <div id="cfAttrBody" style="color:#7f8c8d;font-size:13px;">⏳ ${t('loading')}</div>
    </div>`;
    document.body.appendChild(mask);
    mask.addEventListener('click', (e) => { if (e.target === mask) mask.remove(); });

    try {
        const point = await API.get(`/api/cash-forecast/weekly?bu_no=${bu}&weeks=13`).then(r => r.data).catch(() => null);
        const res = await API.post('/api/diagnosis/cash-attribution', {
            bu_no: bu,
            lang: I18N._lang,
            mc: _mcData,
            stressRev: Number(rev),
            stressCost: Number(cost),
            safe_level: safeLevel,
            point_summary: point
        });
        const d = res.data;
        const body = document.getElementById('cfAttrBody');

        // 规则引擎 Top3
        const topHtml = (d.top_reasons || []).map(r => `
            <div style="margin-bottom:10px;padding:10px;border-left:3px solid #2563eb;background:#f0f7ff;border-radius:4px;">
                <b>#${r.rank} [${r.dim}]</b> ${r.dim !== r.desc ? r.desc : ''}<br>
                <span style="color:#e67e22;font-size:12px;">${r.impact}</span> ·
                <span style="color:#27ae60;font-size:12px;">💡 ${r.suggestion}</span>
            </div>
        `).join('');

        // LLM 建议（前 3 条匹配，无就切分 explanation）
        const suggestions = d.suggestions && d.suggestions.length ? d.suggestions : [];
        const suggHtml = suggestions.length
            ? suggestions.map((s, i) => `<div style="margin:4px 0;padding:8px;background:#f0fff4;border-left:3px solid #27ae60;border-radius:4px;">
                <b style="color:#27ae60;">${i + 1}.</b> ${s}</div>`).join('')
            : '';

        body.innerHTML = `
            <div style="margin-bottom:14px;"><b style="color:#2c3e50;">📋 ${t('cash.top_reasons') || 'Top3 拖累原因'}</b></div>
            ${topHtml}
            <div style="margin:18px 0 10px;"><b style="color:#2c3e50;">🤖 ${t('cash.ai_engine') || 'AI 根因解釋'}（${d.provider} · ${d.model}）</b></div>
            <div style="color:#2c3e50;line-height:1.75;white-space:pre-wrap;font-size:14px;background:#fafafa;padding:12px;border-radius:6px;">${d.explanation || ''}</div>
            ${suggHtml ? `<div style="margin:16px 0 8px;"><b style="color:#2c3e50;">💡 ${t('cash.suggestions') || '改進建議'}</b></div>${suggHtml}` : ''}
        `;
    } catch (e) {
        const body = document.getElementById('cfAttrBody');
        if (body) body.innerHTML = `<div style="color:#e74c3c;padding:10px;">❌ ${e.message || t('error')}</div>
            <div style="color:#7f8c8d;font-size:12px;margin-top:8px;">${t('cash.ai_setup_hint') || '請確認「系統設定 → API Key 管理」已設定 LLM 服務商（DeepSeek/Kimi）的 API Key'}</div>`;
    }
}

// ===== 安全水位設定（沿用舊功能） =====
async function openSafeLevelModal() {
    const bu = document.getElementById('cfBu').value;
    let cur = '';
    try {
        const res = await API.get(`/api/cash-forecast/safe-level?bu_no=${bu}`);
        cur = res.data?.safe_amount ?? '';
    } catch (e) { /* 無設定時保留空值 */ }
    UI.modal(t('cash.safe_level_title') || '⚙ 安全水位設定',
        `<div style="min-width:340px;">
            <div style="margin-bottom:10px;font-size:13px;color:#555;">公司别：<b>${bu}</b></div>
            <label style="display:block;font-size:13px;color:#555;margin-bottom:4px;">安全水位金额（元）</label>
            <input id="safeAmt" type="number" min="0" step="1" class="form-control" value="${cur}" placeholder="例：5000000">
            <div style="font-size:12px;color:#95a5a6;margin-top:6px;">
                ${t('cash.safe_hint') || '低于此金额的周次会标红警示。建议值：未来每周平均流出 × 3（约 3 周营运周转金）。'}
            </div>
         </div>`,
        `<button class="btn btn-outline" onclick="UI.closeModal()">${t('cancel')}</button>
         <button class="btn btn-primary" onclick="saveSafeLevel('${bu}')">${t('save')}</button>`);
}

async function saveSafeLevel(bu) {
    const amt = document.getElementById('safeAmt').value;
    if (amt === '' || Number(amt) < 0) { UI.toast(t('cash.invalid_amt') || '请输入有效的非负金额', 'error'); return; }
    try {
        await API.put('/api/cash-forecast/safe-level', { bu_no: bu, safe_amount: Number(amt) });
        UI.toast(t('cash.safe_saved') || '安全水位已储存', 'success');
        UI.closeModal();
        loadCashForecast();
    } catch (e) { UI.toast(e.message, 'error'); }
}
