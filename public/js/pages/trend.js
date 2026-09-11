/**
 * 年度趨勢分析頁面
 * 模式1：單年度 12 個月趨勢（折線圖）
 * 模式2：跨年度 3/5/10 年匯總對比（柱狀圖）
 */
registerPage('trend', async (c) => {
    const { bu_no } = State;

    c.innerHTML = `
        <div class="card" style="margin-bottom:16px">
            <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:center">
                <div style="display:flex;gap:8px">
                    <label style="font-weight:600">${t('trend.mode')}:</label>
                    <label><input type="radio" name="trendMode" value="monthly" checked> ${t('trend.mode_monthly')}</label>
                    <label><input type="radio" name="trendMode" value="yearly"> ${t('trend.mode_yearly')}</label>
                </div>
                <div id="monthlyYearBox" style="display:flex;gap:8px;align-items:center">
                    <label>${t('trend.year')}:</label>
                    <select id="trendYear" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px"></select>
                </div>
                <div id="yearlyRangeBox" style="display:none;gap:8px;align-items:center">
                    <label>${t('trend.range')}:</label>
                    <select id="trendYears" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px">
                        <option value="3">3 ${t('trend.years')}</option>
                        <option value="5" selected>5 ${t('trend.years')}</option>
                        <option value="10">10 ${t('trend.years')}</option>
                    </select>
                </div>
                <div style="display:flex;gap:8px;align-items:center">
                    <label>${t('trend.metric')}:</label>
                    <select id="trendMetric" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px">
                        <option value="sale_amt">${t('trend.sale')}</option>
                        <option value="net_profit_amt" selected>${t('trend.net_profit')}</option>
                        <option value="BIZ_major_margin_amt">${t('trend.gross_profit')}</option>
                        <option value="BIZ_margin_amt">${t('trend.op_profit')}</option>
                        <option value="ttl_asset_amt">${t('trend.total_asset')}</option>
                        <option value="equity">${t('trend.equity')}</option>
                    </select>
                </div>
                <button class="btn btn-primary" id="trendBtn">${t('refresh')}</button>
            </div>
        </div>
        <div id="trendSummary" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px"></div>
        <div class="card">
            <div class="card-title" id="trendChartTitle">${t('loading')}</div>
            <canvas id="trendChart" height="320"></canvas>
        </div>
    `;

    // 檢查有哪些年份
    const [yearResp] = await Promise.allSettled([
        API.get(`/api/summary?bu_no=${bu_no}&limit=200`)
    ]);
    const allRows = yearResp.status === 'fulfilled' ? (yearResp.value.data || []) : [];
    const years = [...new Set(allRows.map(r => String(r.YYYY)))].sort((a, b) => b.localeCompare(a));

    // 填充年份下拉
    const yearSel = document.getElementById('trendYear');
    years.forEach(y => {
        const opt = document.createElement('option');
        opt.value = y; opt.textContent = y + ' ' + t('trend.year');
        yearSel.appendChild(opt);
    });
    // 預設選最新年份
    if (years.length > 0) yearSel.value = years[0];

    // 模式切換
    document.querySelectorAll('input[name="trendMode"]').forEach(el => {
        el.addEventListener('change', () => {
            document.getElementById('monthlyYearBox').style.display = el.value === 'monthly' ? 'flex' : 'none';
            document.getElementById('yearlyRangeBox').style.display = el.value === 'yearly' ? 'flex' : 'none';
        });
    });

    let chart = null;

    async function render() {
        const mode = document.querySelector('input[name="trendMode"]:checked').value;
        const metric = document.getElementById('trendMetric').value;
        const metricLabel = document.getElementById('trendMetric').selectedOptions[0].text;

        const labels = [];
        const values = [];
        let summary = {};

        if (mode === 'monthly') {
            const year = yearSel.value;
            document.getElementById('trendChartTitle').textContent =
                `${bu_no} — ${year} ${t('trend.yearly_monthly')} ${metricLabel}`;

            // 用現有接口 /api/summary?bu_no=X&YYYY=Y
            const monthly = allRows
                .filter(r => String(r.YYYY) === year)
                .sort((a, b) => Number(a.MM) - Number(b.MM));

            const monthNames = [
                t('trend.month.1'), t('trend.month.2'), t('trend.month.3'), t('trend.month.4'),
                t('trend.month.5'), t('trend.month.6'), t('trend.month.7'), t('trend.month.8'),
                t('trend.month.9'), t('trend.month.10'), t('trend.month.11'), t('trend.month.12')
            ];
            for (let m = 1; m <= 12; m++) {
                const row = monthly.find(r => Number(r.MM) === m);
                labels.push(monthNames[m - 1]);
                const val = row ? Number(row[metric] || 0) : 0;
                values.push(val);
            }

            // 匯總統計
            const sum = values.reduce((a, b) => a + b, 0);
            const hasData = values.filter(v => v !== 0).length;
            summary = {
                total: sum,
                avg: hasData > 0 ? sum / hasData : 0,
                max: Math.max(...values),
                min: Math.min(...values.filter(v => v !== 0))
            };
        } else {
            const ny = document.getElementById('trendYears').value;
            document.getElementById('trendChartTitle').textContent =
                `${bu_no} — ${ny} ${t('trend.years')} ${metricLabel} ${t('trend.compare')}`;

            // 用 /api/summary/yearly 接口
            const res = await API.get(`/api/summary/yearly?bu_no=${bu_no}&years=${ny}`);
            const yearly = res.data || [];

            for (const row of yearly) {
                labels.push(String(row.YYYY));
                if (metric === 'equity') {
                    values.push(Number(row.equity_end || 0));
                } else {
                    values.push(Number(row[metric] || 0));
                }
            }

            // 匯總統計
            const sum = values.reduce((a, b) => a + b, 0);
            const hasData = values.filter(v => v !== 0).length;
            const growth = values.length >= 2 && values[0] !== 0
                ? ((values[values.length - 1] - values[0]) / Math.abs(values[0]) * 100)
                : 0;
            summary = {
                total: sum,
                avg: hasData > 0 ? sum / hasData : 0,
                max: Math.max(...values),
                growth: growth
            };
        }

        // 繪製卡片
        const sumDiv = document.getElementById('trendSummary');
        if (mode === 'monthly') {
            const min = summary.min || 0;
            sumDiv.innerHTML = `
                <div class="kpi-card green"><div class="kpi-label">${t('trend.total_year')}</div><div class="kpi-value">${UI.fmt(summary.total)}</div></div>
                <div class="kpi-card green"><div class="kpi-label">${t('trend.monthly_avg')}</div><div class="kpi-value">${UI.fmt(summary.avg)}</div></div>
                <div class="kpi-card green"><div class="kpi-label">${t('trend.monthly_max')}</div><div class="kpi-value">${UI.fmt(summary.max)}</div></div>
                <div class="kpi-card green"><div class="kpi-label">${t('trend.monthly_min')}</div><div class="kpi-value">${UI.fmt(min)}</div></div>
            `;
        } else {
            sumDiv.innerHTML = `
                <div class="kpi-card green"><div class="kpi-label">${t('trend.total_period')}</div><div class="kpi-value">${UI.fmt(summary.total)}</div></div>
                <div class="kpi-card green"><div class="kpi-label">${t('trend.yearly_avg')}</div><div class="kpi-value">${UI.fmt(summary.avg)}</div></div>
                <div class="kpi-card green"><div class="kpi-label">${t('trend.yearly_max')}</div><div class="kpi-value">${UI.fmt(summary.max)}</div></div>
                <div class="kpi-card ${summary.growth >= 0 ? 'green' : 'red'}"><div class="kpi-label">${t('trend.growth')}</div><div class="kpi-value ${summary.growth >= 0 ? 'positive' : 'negative'}">${UI.fmt(summary.growth, 1)}%</div></div>
            `;
        }

        // 銷毀舊圖
        if (chart) { chart.destroy(); chart = null; }

        const ctx = document.getElementById('trendChart').getContext('2d');
        const isMonthly = mode === 'monthly';

        chart = new Chart(ctx, {
            type: isMonthly ? 'line' : 'bar',
            data: {
                labels,
                datasets: [{
                    label: metricLabel,
                    data: values,
                    backgroundColor: isMonthly
                        ? 'rgba(52, 152, 219, 0.15)'
                        : ['#3498db','#27ae60','#e74c3c','#f39c12','#9b59b6','#1abc9c','#d35400','#34495e','#16a085','#c0392b'],
                    borderColor: '#3498db',
                    borderWidth: 2,
                    fill: isMonthly,
                    tension: 0.35,
                    pointRadius: 4,
                    pointHoverRadius: 7
                }]
            },
            options: {
                responsive: true,
                interaction: { intersect: false, mode: 'index' },
                plugins: {
                    legend: { display: true, position: 'top' },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${metricLabel}: ${UI.fmt(ctx.parsed.y)}`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: (v) => v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v.toLocaleString()
                        }
                    }
                }
            }
        });
    }

    document.getElementById('trendBtn').addEventListener('click', render);
    if (years.length > 0) render();
    else {
        document.getElementById('trendChartTitle').textContent = t('no_data');
    }
});
