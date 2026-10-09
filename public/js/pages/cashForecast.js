/**
 * 现金流量预测页面
 * 未来 13 周滚动预测
 */
registerPage('cashForecast', async (c) => {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h2 style="margin:0;font-size:20px;">现金流量预测 <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">未来 13 周滚动预测</small></h2>
            <div>
                <select id="cfBu" onchange="loadCashForecast()" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                    <option value="HM">HM</option><option value="SZ">SZ</option><option value="HN">HN</option>
                </select>
                <button class="btn btn-outline" onclick="openSafeLevelModal()" style="margin-left:6px;">⚙ 安全水位</button>
                <button class="btn btn-success" onclick="loadCashForecast()" style="margin-left:6px;">🔄</button>
            </div>
        </div>
        <div id="cfSummary">${t('loading')}</div>
        <div class="card" style="margin-top:16px;"><div class="card-title">13 周现金水位曲线</div><div id="cfChart">${t('loading')}</div></div>
    `;
    document.getElementById('cfBu').value = State.bu_no;
    await loadCashForecast();
});

async function loadCashForecast() {
    const bu = document.getElementById('cfBu').value;
    State.bu_no = bu;
    try {
        const res = await API.get(`/api/cash-forecast/weekly?bu_no=${bu}&weeks=13`);
        const d = res.data;
        const weeks = d.weeks || [];

        // 摘要卡
        document.getElementById('cfSummary').innerHTML = `
            <div class="kpi-grid">
                <div class="kpi-card blue"><div class="kpi-label">当前现金余额</div><div class="kpi-value">${UI.fmt(d.current_balance)}</div><div class="kpi-sub">安全水位 ${UI.fmt(d.safe_level)}</div></div>
                <div class="kpi-card green"><div class="kpi-label">13 周预计流入</div><div class="kpi-value positive">${UI.fmt(d.total_inflow)}</div><div class="kpi-sub">应收到期 + 其他</div></div>
                <div class="kpi-card red"><div class="kpi-label">13 周预计流出</div><div class="kpi-value negative">${UI.fmt(d.total_outflow)}</div><div class="kpi-sub">应付 + 贷款摊还</div></div>
                <div class="kpi-card ${d.min_balance < d.safe_level ? 'red' : 'green'}">
                    <div class="kpi-label">最低现金水位</div>
                    <div class="kpi-value">${UI.fmt(d.min_balance)}</div>
                    <div class="kpi-sub">第 ${d.min_week} 周 ${d.min_balance < d.safe_level ? '⚠️ 低于安全值' : '✅ 安全'}</div>
                </div>
            </div>`;

        // Chart.js 折线图
        document.getElementById('cfChart').innerHTML = '<canvas id="cfCanvas" height="100"></canvas>';
        const ctx = document.getElementById('cfCanvas').getContext('2d');
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: weeks.map(w => `W${w.week}`),
                datasets: [{
                    label: '预计现金余额',
                    data: weeks.map(w => w.end_balance),
                    borderColor: '#2563eb',
                    backgroundColor: 'rgba(37,99,235,0.1)',
                    fill: true, tension: 0.3, borderWidth: 2.5,
                    pointBackgroundColor: weeks.map(w => w.is_safe ? '#2563eb' : '#e74c3c'),
                    pointRadius: weeks.map(w => w.is_safe ? 4 : 6)
                }, {
                    label: '安全水位',
                    data: weeks.map(() => d.safe_level),
                    borderColor: '#f39c12',
                    borderDash: [6, 4],
                    fill: false, pointRadius: 0, borderWidth: 1.5
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${UI.fmt(ctx.parsed.y)}` } }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { callback: (v) => UI.fmt(v) } }
                }
            }
        });
    } catch (e) {
        document.getElementById('cfSummary').innerHTML = `<p style="color:#e74c3c">${e.message}</p>`;
        document.getElementById('cfChart').innerHTML = '';
    }
}

async function openSafeLevelModal() {
    const bu = document.getElementById('cfBu').value;
    let cur = '';
    try {
        const res = await API.get(`/api/cash-forecast/safe-level?bu_no=${bu}`);
        cur = res.data?.safe_amount ?? '';
    } catch (e) { /* 无设定时保留空值 */ }
    UI.modal('⚙ 安全水位设定',
        `<div style="min-width:340px;">
            <div style="margin-bottom:10px;font-size:13px;color:#555;">公司别：<b>${bu}</b></div>
            <label style="display:block;font-size:13px;color:#555;margin-bottom:4px;">安全水位金额（元）</label>
            <input id="safeAmt" type="number" min="0" step="1" class="form-control" value="${cur}" placeholder="例：5000000">
            <div style="font-size:12px;color:#95a5a6;margin-top:6px;">
                低于此金额的周次会标红警示。建议值：未来每周平均流出 × 3（约 3 周营运周转金）。
            </div>
         </div>`,
        `<button class="btn btn-outline" onclick="UI.closeModal()">取消</button>
         <button class="btn btn-primary" onclick="saveSafeLevel('${bu}')">储存</button>`);
}

async function saveSafeLevel(bu) {
    const amt = document.getElementById('safeAmt').value;
    if (amt === '' || Number(amt) < 0) { UI.toast('请输入有效的非负金额', 'error'); return; }
    try {
        await API.put('/api/cash-forecast/safe-level', { bu_no: bu, safe_amount: Number(amt) });
        UI.toast('安全水位已储存', 'success');
        UI.closeModal();
        loadCashForecast();
    } catch (e) { UI.toast(e.message, 'error'); }
}
