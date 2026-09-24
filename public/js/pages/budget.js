/**
 * 預算編制頁面
 * 預算 vs 實際比較、差異分析、年度預算彙總
 */
registerPage('budget', async (c) => {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h2 style="margin:0;font-size:20px;">預算編制與執行 <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">預算 vs 實際差異分析</small></h2>
            <div>
                <select id="bdBu" onchange="loadBudget()" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                    <option value="HM">HM</option><option value="SZ">SZ</option><option value="HN">HN</option>
                </select>
                <select id="bdYear" onchange="loadBudget()" style="padding:7px;border:1px solid #ddd;border-radius:6px;margin-left:6px;">
                    <option value="2025">2025</option><option value="2024">2024</option>
                </select>
            </div>
        </div>
        <div id="bdSummary">${t('loading')}</div>
        <div class="card" style="margin-top:16px;"><div class="card-title">年度預算執行進度</div><div id="bdChart">${t('loading')}</div></div>
        <div class="card" style="margin-top:16px;"><div class="card-title">各科目預算 vs 實際</div><div id="bdTable">${t('loading')}</div></div>
    `;
    document.getElementById('bdBu').value = State.bu_no;
    await loadBudget();
});

async function loadBudget() {
    const bu = document.getElementById('bdBu').value;
    const yr = document.getElementById('bdYear').value;
    State.bu_no = bu;
    try {
        const [sumRes, progRes, detRes] = await Promise.all([
            API.get(`/api/budget/summary?bu_no=${bu}&YYYY=${yr}`),
            API.get(`/api/budget/monthly-progress?bu_no=${bu}&YYYY=${yr}`),
            API.get(`/api/budget/detail?bu_no=${bu}&YYYY=${yr}`)
        ]);

        // 摘要卡
        const sum = sumRes.data || [];
        const totalBudget = sum.reduce((s, r) => s + (r.account_code === '4100' ? r.total_budget : 0), 0);
        const totalActual = sum.reduce((s, r) => s + (r.account_code === '4100' ? r.total_actual : 0), 0);
        document.getElementById('bdSummary').innerHTML = `
            <div class="kpi-grid">
                <div class="kpi-card blue"><div class="kpi-label">年度預算（營收）</div><div class="kpi-value">${UI.fmt(totalBudget)}</div><div class="kpi-sub">${yr} 年度</div></div>
                <div class="kpi-card green"><div class="kpi-label">累計實際（營收）</div><div class="kpi-value">${UI.fmt(totalActual)}</div><div class="kpi-sub">達成率 ${totalBudget>0?(totalActual/totalBudget*100).toFixed(1):0}%</div></div>
                <div class="kpi-card ${totalActual>=totalBudget?'green':'yellow'}"><div class="kpi-label">差異金額</div><div class="kpi-value" style="color:${totalActual>=totalBudget?'#27ae60':'#f39c12'}">${totalActual>=totalBudget?'+':''}${UI.fmt(totalActual-totalBudget)}</div><div class="kpi-sub">${totalActual>=totalBudget?'超過預算':'未達預算'}</div></div>
                <div class="kpi-card blue"><div class="kpi-label">預算科目數</div><div class="kpi-value">${sum.length}</div><div class="kpi-sub">個會計科目</div></div>
            </div>`;

        // 進度圖
        const prog = progRes.data || [];
        document.getElementById('bdChart').innerHTML = '<canvas id="bdCanvas" height="80"></canvas>';
        new Chart(document.getElementById('bdCanvas'), {
            type: 'bar',
            data: {
                labels: prog.map(p => p.YYYY_MM.substring(5)),
                datasets: [
                    { label: '預算', data: prog.map(p => p.month_budget), backgroundColor: 'rgba(37,99,235,0.5)' },
                    { label: '實際', data: prog.map(p => p.month_actual), backgroundColor: 'rgba(39,174,96,0.7)' }
                ]
            },
            options: {
                responsive: true,
                plugins: { tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${UI.fmt(ctx.parsed.y)}` } } },
                scales: { y: { ticks: { callback: (v) => UI.fmt(v) } } }
            }
        });

        // 明細表
        const det = detRes.data || [];
        document.getElementById('bdTable').innerHTML = det.length === 0 ? UI.empty('📋', '暫無預算資料') : `
            <table class="data-table">
                <thead><tr><th>科目代碼</th><th>科目名稱</th><th class="num">預算金額</th><th class="num">實際金額</th><th class="num">差異金額</th><th class="num">差異率</th></tr></thead>
                <tbody>${det.map(r => {
                    const diff = Number(r.diff_amt || 0);
                    const diffPct = Number(r.diff_pct || 0);
                    const color = diff >= 0 ? (r.account_code === '4100' ? '#27ae60' : '#e74c3c') : (r.account_code === '4100' ? '#e74c3c' : '#27ae60');
                    return `<tr>
                        <td>${r.account_code}</td>
                        <td><b>${r.account_name}</b></td>
                        <td class="num">${UI.fmt(r.budget_amt)}</td>
                        <td class="num">${UI.fmt(r.actual_amt)}</td>
                        <td class="num" style="color:${color}">${diff>=0?'+':''}${UI.fmt(diff)}</td>
                        <td class="num" style="color:${color}">${diffPct>=0?'+':''}${UI.fmt(diffPct,1)}%</td>
                    </tr>`;
                }).join('')}</tbody>
            </table>`;
    } catch (e) {
        document.getElementById('bdSummary').innerHTML = `<p style="color:#e74c3c">${e.message}</p>`;
    }
}
