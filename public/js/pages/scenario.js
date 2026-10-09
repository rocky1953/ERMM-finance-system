/**
 * 财务情景模拟页面
 * 乐观/基准/悲观 三情景参数设定，模拟对关键财务指标的冲击
 */
registerPage('scenario', async (c) => {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h2 style="margin:0;font-size:20px;">财务情景模拟 <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">假设性情景对关键指标的冲击分析</small></h2>
            <div>
                <select id="scBu" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                    <option value="HM">HM</option><option value="SZ">SZ</option><option value="HN">HN</option>
                </select>
                <input type="month" id="scMonth" style="padding:7px;border:1px solid #ddd;border-radius:6px;margin-left:6px;">
                <button class="btn btn-primary" onclick="Scenario.run()" style="margin-left:6px;">▶ 执行模拟</button>
            </div>
        </div>

        <div class="card" style="margin-bottom:16px;">
            <div class="card-title">情景参数设定</div>
            <table class="data-table">
                <thead>
                    <tr>
                        <th>参数</th>
                        <th style="background:#d4edda;color:#155724;">🟢 乐观</th>
                        <th style="background:#fff3cd;color:#856404;">🟡 基准</th>
                        <th style="background:#f8d7da;color:#721c24;">🔴 悲观</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><b>营收成长率</b> (%)</td>
                        <td><input type="number" id="opt_rev" value="15" class="num-input" style="width:80px;"></td>
                        <td><input type="number" id="base_rev" value="5" class="num-input" style="width:80px;"></td>
                        <td><input type="number" id="pes_rev" value="-10" class="num-input" style="width:80px;"></td>
                    </tr>
                    <tr>
                        <td><b>成本变动率</b> (%)</td>
                        <td><input type="number" id="opt_cost" value="5" class="num-input" style="width:80px;"></td>
                        <td><input type="number" id="base_cost" value="5" class="num-input" style="width:80px;"></td>
                        <td><input type="number" id="pes_cost" value="8" class="num-input" style="width:80px;"></td>
                    </tr>
                    <tr>
                        <td><b>费用率</b> (% of 营收，留白=依营收比例)</td>
                        <td><input type="number" id="opt_exp" value="18" class="num-input" style="width:80px;" placeholder="auto"></td>
                        <td><input type="number" id="base_exp" class="num-input" style="width:80px;" placeholder="auto"></td>
                        <td><input type="number" id="pes_exp" value="25" class="num-input" style="width:80px;" placeholder="auto"></td>
                    </tr>
                    <tr>
                        <td><b>应收天数变动</b> (天)</td>
                        <td><input type="number" id="opt_ar" value="-10" class="num-input" style="width:80px;"></td>
                        <td><input type="number" id="base_ar" value="0" class="num-input" style="width:80px;"></td>
                        <td><input type="number" id="pes_ar" value="15" class="num-input" style="width:80px;"></td>
                    </tr>
                    <tr>
                        <td><b>借款变动率</b> (%)</td>
                        <td><input type="number" id="opt_loan" value="-20" class="num-input" style="width:80px;"></td>
                        <td><input type="number" id="base_loan" value="0" class="num-input" style="width:80px;"></td>
                        <td><input type="number" id="pes_loan" value="10" class="num-input" style="width:80px;"></td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div id="scResult">${UI.empty('📊', '请设定参数后点击“执行模拟”')}</div>
    `;
    document.getElementById('scBu').value = State.bu_no;
    document.getElementById('scMonth').value = '2025-12';

    // 注入数字输入框样式
    const style = document.createElement('style');
    style.textContent = '.num-input{padding:5px 8px;border:1px solid #ddd;border-radius:5px;text-align:right;}';
    document.head.appendChild(style);
});

const Scenario = {
    async run() {
        const bu = document.getElementById('scBu').value;
        const mm = document.getElementById('scMonth').value;
        State.bu_no = bu;
        if (!mm) { UI.toast('请选择月份', 'error'); return; }

        const num = (id) => { const v = document.getElementById(id).value; return v === '' ? null : Number(v); };
        const scenarios = {
            optimistic: { revenueGrowth: num('opt_rev'), costGrowth: num('opt_cost'), expenseRate: num('opt_exp'), arDaysChange: num('opt_ar'), loanChange: num('opt_loan') },
            base: { revenueGrowth: num('base_rev'), costGrowth: num('base_cost'), expenseRate: num('base_exp'), arDaysChange: num('base_ar'), loanChange: num('base_loan') },
            pessimistic: { revenueGrowth: num('pes_rev'), costGrowth: num('pes_cost'), expenseRate: num('pes_exp'), arDaysChange: num('pes_ar'), loanChange: num('pes_loan') }
        };

        document.getElementById('scResult').innerHTML = '<div style="text-align:center;padding:30px;color:#999;">模拟计算中...</div>';
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
                <div class="card-title">模拟结果对比 — ${d.base_period}</div>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>指标</th>
                            <th class="num">实际值</th>
                            <th class="num" style="color:#27ae60;">🟢 乐观</th>
                            <th class="num" style="color:#f39c12;">🟡 基准</th>
                            <th class="num" style="color:#e74c3c;">🔴 悲观</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${row('营业收入', 'revenue')}
                        ${row('销售成本', 'cost')}
                        ${row('毛利', 'gross_profit')}
                        ${row('毛利率', 'gross_margin', '%', v=>UI.fmt(v,2))}
                        ${row('营业费用', 'operating_expense')}
                        ${row('营业利益', 'operating_profit')}
                        ${row('税后净利', 'net_profit')}
                        ${row('净利率', 'net_margin', '%', v=>UI.fmt(v,2))}
                        ${row('应收账款', 'accounts_receivable')}
                        ${row('现金余额', 'cash')}
                        ${row('资产总额', 'total_asset')}
                        ${row('负债总额', 'total_debt')}
                        ${row('负债比率', 'debt_ratio', '%', v=>UI.fmt(v,2))}
                        ${row('ROE', 'roe', '%', v=>UI.fmt(v,2))}
                    </tbody>
                </table>
            </div>

            <div class="card" style="margin-top:16px;">
                <div class="card-title">情景对比图（净利 / 毛利率 / 负债比）</div>
                <canvas id="scChart" height="100"></canvas>
            </div>

            <div class="card" style="margin-top:16px;">
                <div class="card-title">决策建议</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
                    <div style="background:#d4edda;padding:14px;border-radius:8px;">
                        <div style="font-weight:700;color:#155724;margin-bottom:6px;">🟢 乐观情景</div>
                        <div style="font-size:12px;color:#155724;line-height:1.6;">
                            净利 ${UI.fmt(o.net_profit)}，较实际 ${o.net_profit>=a.net_profit?'+':''}${UI.fmt(o.net_profit-a.net_profit)}<br>
                            ${o.debt_ratio < a.debt_ratio ? '负债比下降，财务结构改善' : '需关注负债水准'}
                        </div>
                    </div>
                    <div style="background:#fff3cd;padding:14px;border-radius:8px;">
                        <div style="font-weight:700;color:#856404;margin-bottom:6px;">🟡 基准情景</div>
                        <div style="font-size:12px;color:#856404;line-height:1.6;">
                            净利 ${UI.fmt(b.net_profit)}，较实际 ${b.net_profit>=a.net_profit?'+':''}${UI.fmt(b.net_profit-a.net_profit)}<br>
                            维持现有经营假设下的预期结果
                        </div>
                    </div>
                    <div style="background:#f8d7da;padding:14px;border-radius:8px;">
                        <div style="font-weight:700;color:#721c24;margin-bottom:6px;">🔴 悲观情景</div>
                        <div style="font-size:12px;color:#721c24;line-height:1.6;">
                            净利 ${UI.fmt(p.net_profit)}，较实际 ${p.net_profit>=a.net_profit?'+':''}${UI.fmt(p.net_profit-a.net_profit)}<br>
                            ${p.net_profit < 0 ? '⚠️ 可能亏损，需启动降本措施' : p.debt_ratio > 70 ? '⚠️ 负债比超过 70%，财务风险升高' : '需严控成本与费用'}
                        </div>
                    </div>
                </div>
            </div>
        `;

        // 绘制对比图
        setTimeout(() => {
            const ctx = document.getElementById('scChart');
            if (!ctx) return;
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: ['实际', '乐观', '基准', '悲观'],
                    datasets: [
                        { label: '净利', data: [a.net_profit, o.net_profit, b.net_profit, p.net_profit], backgroundColor: ['#95a5a6','#27ae60','#f39c12','#e74c3c'] },
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
