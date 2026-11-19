/**
 * 财务情景模拟页面
 * 乐观/基准/悲观 三情景参数设定，模拟对关键财务指标的冲击
 */
const SC_EN_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] ?? zh);

registerPage('scenario', async (c) => {
    const _bu = await CodeHelper.buSel();
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h2 style="margin:0;font-size:20px;">${SC_EN_L('财务情景模拟', '財務情景模擬', 'Financial Scenario Simulation')} <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">${SC_EN_L('假设性情景对关键指标的冲击分析', '假設性情景對關鍵指標的衝擊分析', 'Impact analysis of hypothetical scenarios on key metrics')}</small></h2>
            <div>
                <select id="scBu" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                    ${_bu}
                </select>
                <input type="month" id="scMonth" style="padding:7px;border:1px solid #ddd;border-radius:6px;margin-left:6px;">
                <button class="btn btn-primary" onclick="Scenario.run()" style="margin-left:6px;">▶ ${SC_EN_L('执行模拟', '執行模擬', 'Run Simulation')}</button>
                <button class="btn" onclick="Scenario.save()" style="margin-left:6px;">💾 ${SC_EN_L('保存方案', '儲存方案', 'Save Scenario')}</button>
            </div>
        </div>

        <div class="card" style="margin-bottom:16px;">
            <div class="card-title">${SC_EN_L('已保存方案', '已儲存方案', 'Saved Scenarios')} <small id="scSavedCount" style="color:#7f8c8d;font-weight:normal;"></small></div>
            <div id="scSavedList"><div style="color:#999;font-size:13px;">${SC_EN_L('加载中...', '載入中...', 'Loading...')}</div></div>
        </div>

        <div class="card" style="margin-bottom:16px;">
            <div class="card-title">${SC_EN_L('情景参数设定', '情景參數設定', 'Scenario Parameters')}</div>
            <table class="data-table">
                <thead>
                    <tr>
                        <th>${SC_EN_L('参数', '參數', 'Parameter')}</th>
                        <th style="background:#d4edda;color:#155724;">${SC_EN_L('🟢 乐观', '🟢 樂觀', '🟢 Optimistic')}</th>
                        <th style="background:#fff3cd;color:#856404;">${SC_EN_L('🟡 基准', '🟡 基準', '🟡 Base')}</th>
                        <th style="background:#f8d7da;color:#721c24;">${SC_EN_L('🔴 悲观', '🔴 悲觀', '🔴 Pessimistic')}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><b>${SC_EN_L('营收成长率', '營收成長率', 'Revenue Growth')}</b> (%)</td>
                        <td><input type="number" id="opt_rev" value="15" class="num-input" style="width:80px;"></td>
                        <td><input type="number" id="base_rev" value="5" class="num-input" style="width:80px;"></td>
                        <td><input type="number" id="pes_rev" value="-10" class="num-input" style="width:80px;"></td>
                    </tr>
                    <tr>
                        <td><b>${SC_EN_L('成本变动率', '成本變動率', 'Cost Change')}</b> (%)</td>
                        <td><input type="number" id="opt_cost" value="5" class="num-input" style="width:80px;"></td>
                        <td><input type="number" id="base_cost" value="5" class="num-input" style="width:80px;"></td>
                        <td><input type="number" id="pes_cost" value="8" class="num-input" style="width:80px;"></td>
                    </tr>
                    <tr>
                        <td><b>${SC_EN_L('费用率', '費用率', 'Expense Rate')}</b> (${SC_EN_L('% of 营收，留白=依营收比例', '% of 營收，留白=依營收比例', '% of revenue; blank = proportional')})</td>
                        <td><input type="number" id="opt_exp" value="18" class="num-input" style="width:80px;" placeholder="auto"></td>
                        <td><input type="number" id="base_exp" class="num-input" style="width:80px;" placeholder="auto"></td>
                        <td><input type="number" id="pes_exp" value="25" class="num-input" style="width:80px;" placeholder="auto"></td>
                    </tr>
                    <tr>
                        <td><b>${SC_EN_L('应收天数变动', '應收天數變動', 'AR Days Change')}</b> (${SC_EN_L('天', '天', 'days')})</td>
                        <td><input type="number" id="opt_ar" value="-10" class="num-input" style="width:80px;"></td>
                        <td><input type="number" id="base_ar" value="0" class="num-input" style="width:80px;"></td>
                        <td><input type="number" id="pes_ar" value="15" class="num-input" style="width:80px;"></td>
                    </tr>
                    <tr>
                        <td><b>${SC_EN_L('借款变动率', '借款變動率', 'Loan Change')}</b> (%)</td>
                        <td><input type="number" id="opt_loan" value="-20" class="num-input" style="width:80px;"></td>
                        <td><input type="number" id="base_loan" value="0" class="num-input" style="width:80px;"></td>
                        <td><input type="number" id="pes_loan" value="10" class="num-input" style="width:80px;"></td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div id="scResult">${UI.empty('📊', SC_EN_L('请设定参数后点击“执行模拟”', '請設定參數後點擊「執行模擬」', 'Set parameters and click "Run Simulation"'))}</div>
    `;
    document.getElementById('scBu').value = State.bu_no;
    document.getElementById('scMonth').value = State.YYYY_MM;
    Scenario.refreshSaved();

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
        if (!mm) { UI.toast(SC_EN_L('请选择月份', '請選擇月份', 'Please select a month'), 'error'); return; }

        const num = (id) => { const v = document.getElementById(id).value; return v === '' ? null : Number(v); };
        const scenarios = {
            optimistic: { revenueGrowth: num('opt_rev'), costGrowth: num('opt_cost'), expenseRate: num('opt_exp'), arDaysChange: num('opt_ar'), loanChange: num('opt_loan') },
            base: { revenueGrowth: num('base_rev'), costGrowth: num('base_cost'), expenseRate: num('base_exp'), arDaysChange: num('base_ar'), loanChange: num('base_loan') },
            pessimistic: { revenueGrowth: num('pes_rev'), costGrowth: num('pes_cost'), expenseRate: num('pes_exp'), arDaysChange: num('pes_ar'), loanChange: num('pes_loan') }
        };

        document.getElementById('scResult').innerHTML = `<div style="text-align:center;padding:30px;color:#999;">${SC_EN_L('模拟计算中...', '模擬計算中...', 'Simulating...')}</div>`;
        try {
            const res = await API.post('/api/scenario/simulate', { bu_no: bu, YYYY_MM: mm, scenarios });
            Scenario.render(res.data);
        } catch (e) {
            document.getElementById('scResult').innerHTML = `<p style="color:#e74c3c">${e.message}</p>`;
        }
    },

    async save() {
        const bu = document.getElementById('scBu').value;
        const mm = document.getElementById('scMonth').value;
        if (!mm) { UI.toast(SC_EN_L('请选择月份', '請選擇月份', 'Please select a month'), 'error'); return; }
        const name = prompt(SC_EN_L('请输入方案名称：', '請輸入方案名稱：', 'Scenario name:'), `${SC_EN_L('方案', '方案', 'Scenario')} ${DateLocale.fmtDateTime(new Date())}`);
        if (!name) return;

        const num = (id) => { const v = document.getElementById(id).value; return v === '' ? null : Number(v); };
        const scenarios = {
            optimistic: { revenueGrowth: num('opt_rev'), costGrowth: num('opt_cost'), expenseRate: num('opt_exp'), arDaysChange: num('opt_ar'), loanChange: num('opt_loan') },
            base: { revenueGrowth: num('base_rev'), costGrowth: num('base_cost'), expenseRate: num('base_exp'), arDaysChange: num('base_ar'), loanChange: num('base_loan') },
            pessimistic: { revenueGrowth: num('pes_rev'), costGrowth: num('pes_cost'), expenseRate: num('pes_exp'), arDaysChange: num('pes_ar'), loanChange: num('pes_loan') }
        };
        try {
            const res = await API.post('/api/scenario/save', { bu_no: bu, YYYY_MM: mm, scenario_name: name.trim(), scenarios });
            UI.toast(`${SC_EN_L('方案「', '方案「', 'Scenario "')}${name}${SC_EN_L('」已保存', '」已儲存', '" saved')}`, 'success');
            Scenario.refreshSaved();
        } catch (e) {
            UI.toast(SC_EN_L('保存失败：', '儲存失敗：', 'Save failed: ') + e.message, 'error');
        }
    },

    async refreshSaved() {
        const bu = document.getElementById('scBu').value;
        const mm = document.getElementById('scMonth').value;
        const el = document.getElementById('scSavedList');
        const cnt = document.getElementById('scSavedCount');
        if (!mm) { el.innerHTML = `<div style="color:#999;font-size:13px;">${SC_EN_L('请选择月份', '請選擇月份', 'Please select a month')}</div>`; cnt.textContent = ''; return; }
        try {
            const res = await API.get(`/api/scenario/saved?bu_no=${bu}&YYYY_MM=${mm}`);
            const list = (res.data && res.data.list) || [];
            cnt.textContent = list.length ? `${SC_EN_L('（', '（', '(')}${list.length}${SC_EN_L('）', '）', ')')}` : '';
            if (list.length === 0) { el.innerHTML = `<div style="color:#999;font-size:13px;">${SC_EN_L('暂无已保存方案', '暫無已儲存方案', 'No saved scenarios')}</div>`; return; }
            el.innerHTML = list.map(r => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #eee;">
                    <div>
                        <div style="font-weight:600;">${r.scenario_name}</div>
                        <div style="font-size:12px;color:#7f8c8d;">${r.created_by_name || ''} · ${DateLocale.fmtDateTime(r.created_time)}</div>
                    </div>
                    <div>
                        <button class="btn" style="padding:4px 10px;font-size:12px;" onclick="Scenario.loadSaved(${r.uid})">${SC_EN_L('加载', '載入', 'Load')}</button>
                        <button class="btn" style="padding:4px 10px;font-size:12px;color:#e74c3c;" onclick="Scenario.deleteSaved(${r.uid})">${SC_EN_L('删除', '刪除', 'Delete')}</button>
                    </div>
                </div>`).join('');
        } catch (e) {
            el.innerHTML = `<div style="color:#e74c3c;font-size:13px;">${SC_EN_L('加载失败：', '載入失敗：', 'Load failed: ')}${e.message}</div>`;
        }
    },

    async loadSaved(uid) {
        try {
            const res = await API.get(`/api/scenario/saved/${uid}`);
            const d = res.data;
            const sc = d.scenarios || {};
            const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = (v === null || v === undefined) ? '' : v; };
            ['opt','base','pes'].forEach((p, i) => {
                const s = [sc.optimistic, sc.base, sc.pessimistic][i] || {};
                set(`${p}_rev`, s.revenueGrowth);
                set(`${p}_cost`, s.costGrowth);
                set(`${p}_exp`, s.expenseRate);
                set(`${p}_ar`, s.arDaysChange);
                set(`${p}_loan`, s.loanChange);
            });
            UI.toast(`${SC_EN_L('已加载方案「', '已載入方案「', 'Loaded scenario "')}${d.scenario_name}${SC_EN_L('」，正在重算...', '」，正在重算...', '" and recalculating...')}`, 'success');
            Scenario.run();
        } catch (e) {
            UI.toast(SC_EN_L('加载失败：', '載入失敗：', 'Load failed: ') + e.message, 'error');
        }
    },

    async deleteSaved(uid) {
        if (!confirm(SC_EN_L('确认删除此方案？', '確認刪除此方案？', 'Delete this scenario?'))) return;
        try {
            await API.del(`/api/scenario/saved/${uid}`);
            UI.toast(SC_EN_L('已删除', '已刪除', 'Deleted'), 'success');
            Scenario.refreshSaved();
        } catch (e) {
            UI.toast(SC_EN_L('删除失败：', '刪除失敗：', 'Delete failed: ') + e.message, 'error');
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
                <div class="card-title">${SC_EN_L('模拟结果对比', '模擬結果對比', 'Simulation Results Comparison')} — ${d.base_period}</div>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>${SC_EN_L('指标', '指標', 'Metric')}</th>
                            <th class="num">${SC_EN_L('实际值', '實際值', 'Actual')}</th>
                            <th class="num" style="color:#27ae60;">${SC_EN_L('🟢 乐观', '🟢 樂觀', '🟢 Optimistic')}</th>
                            <th class="num" style="color:#f39c12;">${SC_EN_L('🟡 基准', '🟡 基準', '🟡 Base')}</th>
                            <th class="num" style="color:#e74c3c;">${SC_EN_L('🔴 悲观', '🔴 悲觀', '🔴 Pessimistic')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${row(SC_EN_L('营业收入', '營業收入', 'Revenue'), 'revenue')}
                        ${row(SC_EN_L('销售成本', '銷售成本', 'Cost of Sales'), 'cost')}
                        ${row(SC_EN_L('毛利', '毛利', 'Gross Profit'), 'gross_profit')}
                        ${row(SC_EN_L('毛利率', '毛利率', 'Gross Margin'), 'gross_margin', '%', v=>UI.fmt(v,2))}
                        ${row(SC_EN_L('营业费用', '營業費用', 'Operating Expenses'), 'operating_expense')}
                        ${row(SC_EN_L('营业利益', '營業利益', 'Operating Profit'), 'operating_profit')}
                        ${row(SC_EN_L('税后净利', '稅後淨利', 'Net Profit'), 'net_profit')}
                        ${row(SC_EN_L('净利率', '淨利率', 'Net Margin'), 'net_margin', '%', v=>UI.fmt(v,2))}
                        ${row(SC_EN_L('应收账款', '應收帳款', 'Accounts Receivable'), 'accounts_receivable')}
                        ${row(SC_EN_L('现金余额', '現金餘額', 'Cash Balance'), 'cash')}
                        ${row(SC_EN_L('资产总额', '資產總額', 'Total Assets'), 'total_asset')}
                        ${row(SC_EN_L('负债总额', '負債總額', 'Total Liabilities'), 'total_debt')}
                        ${row(SC_EN_L('负债比率', '負債比率', 'Debt Ratio'), 'debt_ratio', '%', v=>UI.fmt(v,2))}
                        ${row('ROE', 'roe', '%', v=>UI.fmt(v,2))}
                    </tbody>
                </table>
            </div>

            <div class="card" style="margin-top:16px;">
                <div class="card-title">${SC_EN_L('情景对比图（净利 / 毛利率 / 负债比）', '情景對比圖（淨利 / 毛利率 / 負債比）', 'Scenario Comparison (Net Profit / Gross Margin / Debt Ratio)')}</div>
                <canvas id="scChart" height="100"></canvas>
            </div>

            <div class="card" style="margin-top:16px;">
                <div class="card-title">${SC_EN_L('决策建议', '決策建議', 'Decision Insights')}</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
                    <div style="background:#d4edda;padding:14px;border-radius:8px;">
                        <div style="font-weight:700;color:#155724;margin-bottom:6px;">${SC_EN_L('🟢 乐观情景', '🟢 樂觀情景', '🟢 Optimistic Scenario')}</div>
                        <div style="font-size:12px;color:#155724;line-height:1.6;">
                            ${SC_EN_L('净利', '淨利', 'Net profit')} ${UI.fmt(o.net_profit)}${SC_EN_L('，较实际', '，較實際', ' vs. actual')} ${o.net_profit>=a.net_profit?'+':''}${UI.fmt(o.net_profit-a.net_profit)}<br>
                            ${o.debt_ratio < a.debt_ratio ? SC_EN_L('负债比下降，财务结构改善', '負債比下降，財務結構改善', 'Debt ratio down, financial structure improved') : SC_EN_L('需关注负债水准', '需關注負債水準', 'Monitor debt level')}
                        </div>
                    </div>
                    <div style="background:#fff3cd;padding:14px;border-radius:8px;">
                        <div style="font-weight:700;color:#856404;margin-bottom:6px;">${SC_EN_L('🟡 基准情景', '🟡 基準情景', '🟡 Base Scenario')}</div>
                        <div style="font-size:12px;color:#856404;line-height:1.6;">
                            ${SC_EN_L('净利', '淨利', 'Net profit')} ${UI.fmt(b.net_profit)}${SC_EN_L('，较实际', '，較實際', ' vs. actual')} ${b.net_profit>=a.net_profit?'+':''}${UI.fmt(b.net_profit-a.net_profit)}<br>
                            ${SC_EN_L('维持现有经营假设下的预期结果', '維持現有經營假設下的預期結果', 'Expected outcome under current operating assumptions')}
                        </div>
                    </div>
                    <div style="background:#f8d7da;padding:14px;border-radius:8px;">
                        <div style="font-weight:700;color:#721c24;margin-bottom:6px;">${SC_EN_L('🔴 悲观情景', '🔴 悲觀情景', '🔴 Pessimistic Scenario')}</div>
                        <div style="font-size:12px;color:#721c24;line-height:1.6;">
                            ${SC_EN_L('净利', '淨利', 'Net profit')} ${UI.fmt(p.net_profit)}${SC_EN_L('，较实际', '，較實際', ' vs. actual')} ${p.net_profit>=a.net_profit?'+':''}${UI.fmt(p.net_profit-a.net_profit)}<br>
                            ${p.net_profit < 0 ? SC_EN_L('⚠️ 可能亏损，需启动降本措施', '⚠️ 可能虧損，需啟動降本措施', '⚠️ Possible loss; cost reduction needed') : p.debt_ratio > 70 ? SC_EN_L('⚠️ 负债比超过 70%，财务风险升高', '⚠️ 負債比超過 70%，財務風險升高', '⚠️ Debt ratio above 70%; elevated financial risk') : SC_EN_L('需严控成本与费用', '需嚴控成本與費用', 'Tightly control costs and expenses')}
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
                    labels: [SC_EN_L('实际', '實際', 'Actual'), SC_EN_L('乐观', '樂觀', 'Optimistic'), SC_EN_L('基准', '基準', 'Base'), SC_EN_L('悲观', '悲觀', 'Pessimistic')],
                    datasets: [
                        { label: SC_EN_L('净利', '淨利', 'Net Profit'), data: [a.net_profit, o.net_profit, b.net_profit, p.net_profit], backgroundColor: ['#95a5a6','#27ae60','#f39c12','#e74c3c'] },
                        { label: SC_EN_L('毛利率(%)', '毛利率(%)', 'Gross Margin (%)'), data: [a.gross_margin, o.gross_margin, b.gross_margin, p.gross_margin], backgroundColor: ['#bdc3c7','#2ecc71','#f1c40f','#e67e22'], type: 'line', borderColor: '#34495e', fill: false }
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
