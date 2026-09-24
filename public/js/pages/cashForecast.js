/**
 * 現金流量預測頁面
 * 未來 13 週滾動預測
 */
registerPage('cashForecast', async (c) => {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h2 style="margin:0;font-size:20px;">現金流量預測 <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">未來 13 週滾動預測</small></h2>
            <div>
                <select id="cfBu" onchange="loadCashForecast()" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                    <option value="HM">HM</option><option value="SZ">SZ</option><option value="HN">HN</option>
                </select>
                <button class="btn btn-success" onclick="loadCashForecast()" style="margin-left:6px;">🔄</button>
            </div>
        </div>
        <div id="cfSummary">${t('loading')}</div>
        <div class="card" style="margin-top:16px;"><div class="card-title">13 週現金水位曲線</div><div id="cfChart">${t('loading')}</div></div>
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
                <div class="kpi-card blue"><div class="kpi-label">當前現金餘額</div><div class="kpi-value">${UI.fmt(d.current_balance)}</div><div class="kpi-sub">安全水位 ${UI.fmt(d.safe_level)}</div></div>
                <div class="kpi-card green"><div class="kpi-label">13 週預計流入</div><div class="kpi-value positive">${UI.fmt(d.total_inflow)}</div><div class="kpi-sub">應收到期 + 其他</div></div>
                <div class="kpi-card red"><div class="kpi-label">13 週預計流出</div><div class="kpi-value negative">${UI.fmt(d.total_outflow)}</div><div class="kpi-sub">應付 + 貸款攤還</div></div>
                <div class="kpi-card ${d.min_balance < d.safe_level ? 'red' : 'green'}">
                    <div class="kpi-label">最低現金水位</div>
                    <div class="kpi-value">${UI.fmt(d.min_balance)}</div>
                    <div class="kpi-sub">第 ${d.min_week} 週 ${d.min_balance < d.safe_level ? '⚠️ 低於安全值' : '✅ 安全'}</div>
                </div>
            </div>`;

        // Chart.js 折線圖
        document.getElementById('cfChart').innerHTML = '<canvas id="cfCanvas" height="100"></canvas>';
        const ctx = document.getElementById('cfCanvas').getContext('2d');
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: weeks.map(w => `W${w.week}`),
                datasets: [{
                    label: '預計現金餘額',
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
