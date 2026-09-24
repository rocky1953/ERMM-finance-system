/**
 * 財務情景模擬頁面
 * 樂觀/基準/悲觀 三情景參數設定，模擬對關鍵財務指標的衝擊
 */
registerPage('scenario', async (c) => {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h2 style="margin:0;font-size:20px;">財務情景模擬 <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">假設性情景對關鍵指標的衝擊分析</small></h2>
            <div>
                <select id="scBu" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                    <option value="HM">HM</option><option value="SZ">SZ</option><option value="HN">HN</option>
                </select>
                <input type="month" id="scMonth" style="padding:7px;border:1px solid #ddd;border-radius:6px;margin-left:6px;">
                <button class="btn btn-primary" onclick="Scenario.run()" style="margin-left:6px;">▶ 執行模擬</button>
            </div>
        </div>

        <div class="card" style="margin-bottom:16px;">
            <div class="card-title">情景參數設定</div>
            <table class="data-table">
                <thead>
                    <tr>
                        <th>參數</th>
                        <th style="background:#d4edda;color:#155724;">🟢 樂觀</th>
                        <th style="background:#fff3cd;color:#856404;">🟡 基準</th>
                        <th style="background:#f8d7da;color:#721c24;">🔴 悲觀</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><b>營收成長率</b> (%)</td>
                        <td><input type="number" id="opt_rev" value="15" class="num-input" style="width:80px;"></td>
                        <td><input type="number" id="base_rev" value="5" class="num-input" style="width:80px;"></td>
                        <td><input type="number" id="pes_rev" value="-10" class="num-input" style="width:80px;"></td>
                    </tr>
                    <tr>
                        <td><b>成本變動率</b> (%)</td>
                        <td><input type="number" id="opt_cost" value="5" class="num-input" style="width:80px;"></td>
                        <td><input type="number" id="base_cost" value="5" class="num-input" style="width:80px;"></td>
                        <td><input type="number" id="pes_cost" value="8" class="num-input" style="width:80px;"></td>
                    </tr>
                    <tr>
                        <td><b>費用率</b> (% of 營收，留白=依營收比例)</td>
                        <td><input type="number" id="opt_exp" value="18" class="num-input" style="width:80px;" placeholder="auto"></td>
                        <td><input type="number" id="base_exp" class="num-input" style="width:80px;" placeholder="auto"></td>
                        <td><input type="number" id="pes_exp" value="25" class="num-input" style="width:80px;" placeholder="auto"></td>
                    </tr>
                    <tr>
                        <td><b>應收天數變動</b> (天)</td>
                        <td><input type="number" id="opt_ar" value="-10" class="num-input" style="width:80px;"></td>
                        <td><input type="number" id="base_ar" value="0" class="num-input" style="width:80px;"></td>
                        <td><input type="number" id="pes_ar" value="15" class="num-input" style="width:80px;"></td>
                    </tr>
                    <tr>
                        <td><b>借款變動率</b> (%)</td>
                        <td><input type="number" id="opt_loan" value="-20" class="num-input" style="width:80px;"></td>
                        <td><input type="number" id="base_loan" value="0" class="num-input" style="width:80px;"></td>
                        <td><input type="number" id="pes_loan" value="10" class="num-input" style="width:80px;"></td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div id="scResult">${UI.empty('📊', '請設定參數後點擊「執行模擬」')}</div>
    `;
    document.getElementById('scBu').value = State.bu_no;
    document.getElementById('scMonth').value = '2025-12';

    // 注入數字輸入框樣式
    const style = document.createElement('style');
    style.textContent = '.num-input{padding:5px 8px;border:1px solid #ddd;border-radius:5px;text-align:right;}';
    document.head.appendChild(style);
});

const Scenario = {
    async run() {
        const bu = document.getElementById('scBu').value;
        const mm = document.getElementById('scMonth').value.replace('-', '/');
        State.bu_no = bu;
        if (!mm) { UI.toast('請選擇月份', 'error'); return; }

        const num = (id) => { const v = document.getElementById(id).value; return v === '' ? null : Number(v); };
        const scenarios = {
            optimistic: { revenueGrowth: num('opt_rev'), costGrowth: num('opt_cost'), expenseRate: num('opt_exp'), arDaysChange: num('opt_ar'), loanChange: num('opt_loan') },
            base: { revenueGrowth: num('base_rev'), costGrowth: num('base_cost'), expenseRate: num('base_exp'), arDaysChange: num('base_ar'), loanChange: num('base_loan') },
            pessimistic: { revenueGrowth: num('pes_rev'), costGrowth: num('pes_cost'), expenseRate: num('pes_exp'), arDaysChange: num('pes_ar'), loanChange: num('pes_loan') }
        };

        document.getElementById('scResult').innerHTML = '<div style="text-align:center;padding:30px;color:#999;">模擬計算中...</div>';
        try {
            const res = await API.post('/api/scenario/simulate', { bu_no: bu, YYYY_MM: mm, scenarios });
            Scenario.render(res.data);
        } catch (e) {
            document.getElementById('scResult').innerHTML = `<p style="color:#e74c3c">${e.message}</p>`;
        }
    },

    render(d) {
        const a = d.actual;
        const o = d.scenarios.optimistic;
        const b = d.scenarios.base;
        const p = d.scenarios.pessimistic;

        const row = (label, field, unit='', fmt=(v)=>UI.fmt(v)) => `
            <tr>
                <td><b>${label}</b></td>
                <td class="num">${fmt(a[field])}${unit}</td>
                <td class="num" style="color:#27ae60;">${fmt(o[field])}${unit}</td>
                <td class="num" style="color:#f39c12;">${fmt(b[field])}${unit}</td>
                <td class="num" style="color:#e74c3c;">${fmt(p[field])}${unit}</td>
            </tr>`;

        document.getElementById('scResult').innerHTML = `
            <div class="card">
                <div class="card-title">模擬結果對比 — ${d.base_period}</div>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>指標</th>
                            <th class="num">實際值</th>
                            <th class="num" style="color:#27ae60;">🟢 樂觀</th>
                            <th class="num" style="color:#f39c12;">🟡 基準</th>
                            <th class="num" style="color:#e74c3c;">🔴 悲觀</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${row('營業收入', 'revenue')}
                        ${row('銷售成本', 'cost')}
                        ${row('毛利', 'gross_profit')}
                        ${row('毛利率', 'gross_margin', '%', v=>UI.fmt(v,2))}
                        ${row('營業費用', 'operating_expense')}
                        ${row('營業利益', 'operating_profit')}
                        ${row('稅後淨利', 'net_profit')}
                        ${row('淨利率', 'net_margin', '%', v=>UI.fmt(v,2))}
                        ${row('應收帳款', 'accounts_receivable')}
                        ${row('現金餘額', 'cash')}
                        ${row('資產總額', 'total_asset')}
                        ${row('負債總額', 'total_debt')}
                        ${row('負債比率', 'debt_ratio', '%', v=>UI.fmt(v,2))}
                        ${row('ROE', 'roe', '%', v=>UI.fmt(v,2))}
                    </tbody>
                </table>
            </div>

            <div class="card" style="margin-top:16px;">
                <div class="card-title">情景對比圖（淨利 / 毛利率 / 負債比）</div>
                <canvas id="scChart" height="100"></canvas>
            </div>

            <div class="card" style="margin-top:16px;">
                <div class="card-title">決策建議</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
                    <div style="background:#d4edda;padding:14px;border-radius:8px;">
                        <div style="font-weight:700;color:#155724;margin-bottom:6px;">🟢 樂觀情景</div>
                        <div style="font-size:12px;color:#155724;line-height:1.6;">
                            淨利 ${UI.fmt(o.net_profit)}，較實際 ${o.net_profit>=a.net_profit?'+':''}${UI.fmt(o.net_profit-a.net_profit)}<br>
                            ${o.debt_ratio < a.debt_ratio ? '負債比下降，財務結構改善' : '需關注負債水準'}
                        </div>
                    </div>
                    <div style="background:#fff3cd;padding:14px;border-radius:8px;">
                        <div style="font-weight:700;color:#856404;margin-bottom:6px;">🟡 基準情景</div>
                        <div style="font-size:12px;color:#856404;line-height:1.6;">
                            淨利 ${UI.fmt(b.net_profit)}，較實際 ${b.net_profit>=a.net_profit?'+':''}${UI.fmt(b.net_profit-a.net_profit)}<br>
                            維持現有經營假設下的預期結果
                        </div>
                    </div>
                    <div style="background:#f8d7da;padding:14px;border-radius:8px;">
                        <div style="font-weight:700;color:#721c24;margin-bottom:6px;">🔴 悲觀情景</div>
                        <div style="font-size:12px;color:#721c24;line-height:1.6;">
                            淨利 ${UI.fmt(p.net_profit)}，較實際 ${p.net_profit>=a.net_profit?'+':''}${UI.fmt(p.net_profit-a.net_profit)}<br>
                            ${p.net_profit < 0 ? '⚠️ 可能虧損，需啟動降本措施' : p.debt_ratio > 70 ? '⚠️ 負債比超過 70%，財務風險升高' : '需嚴控成本與費用'}
                        </div>
                    </div>
                </div>
            </div>
        `;

        // 繪製對比圖
        setTimeout(() => {
            const ctx = document.getElementById('scChart');
            if (!ctx) return;
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: ['實際', '樂觀', '基準', '悲觀'],
                    datasets: [
                        { label: '淨利', data: [a.net_profit, o.net_profit, b.net_profit, p.net_profit], backgroundColor: ['#95a5a6','#27ae60','#f39c12','#e74c3c'] },
                        { label: '毛利率(%)', data: [a.gross_margin, o.gross_margin, b.gross_margin, p.gross_margin], backgroundColor: ['#bdc3c7','#2ecc71','#f1c40f','#e67e22'], type: 'line', borderColor: '#34495e', fill: false }
                    ]
                },
                options: {
                    responsive: true,
                    plugins: { tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${UI.fmt(ctx.parsed.y)}` } } }
                }
            });
        }, 100);
    }
};
