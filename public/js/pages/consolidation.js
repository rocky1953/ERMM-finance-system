/**
 * 合併報表頁面
 * 集團合併損益表 / 資產負債表 / 內部交易沖銷
 */
registerPage('consolidation', async (c) => {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h2 style="margin:0;font-size:20px;">合併報表 <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">集團多公司合併財務報表</small></h2>
            <div>
                <input type="month" id="csMonth" onchange="loadConsol()" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                <button class="btn btn-success" onclick="loadConsol()" style="margin-left:6px;">🔄</button>
            </div>
        </div>
        <div id="csOverview">${t('loading')}</div>
        <div class="card" style="margin-top:16px;">
            <div class="card-title">
                合併損益表
                <div style="float:right;">
                    <button class="btn btn-sm btn-primary" onclick="switchTab('income')" id="tabIncome">損益表</button>
                    <button class="btn btn-sm btn-outline" onclick="switchTab('bs')" id="tabBS">資產負債表</button>
                </div>
            </div>
            <div id="csContent">${t('loading')}</div>
        </div>
    `;
    document.getElementById('csMonth').value = '2025-12';
    window._csTab = 'income';
    await loadConsol();
});

function switchTab(tab) {
    window._csTab = tab;
    document.getElementById('tabIncome').className = tab === 'income' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
    document.getElementById('tabBS').className = tab === 'bs' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
    loadConsol();
}

async function loadConsol() {
    const mm = document.getElementById('csMonth').value.replace('-', '/');
    if (!mm) return;
    try {
        const ovRes = await API.get(`/api/consolidation/overview?YYYY_MM=${mm}`);
        const g = ovRes.data?.group_total || {};
        document.getElementById('csOverview').innerHTML = `
            <div class="kpi-grid">
                <div class="kpi-card blue"><div class="kpi-label">集團合併營收</div><div class="kpi-value">${UI.fmt(g.total_sale)}</div><div class="kpi-sub">${mm}</div></div>
                <div class="kpi-card ${g.total_profit>=0?'green':'red'}"><div class="kpi-label">合併淨利</div><div class="kpi-value">${UI.fmt(g.total_profit)}</div><div class="kpi-sub">淨利率 ${UI.fmt(g.profit_margin,1)}%</div></div>
                <div class="kpi-card blue"><div class="kpi-label">集團總資產</div><div class="kpi-value">${UI.fmt(g.total_asset)}</div><div class="kpi-sub">負債比 ${UI.fmt(g.debt_ratio,1)}%</div></div>
                <div class="kpi-card ${g.roe>=8?'green':'red'}"><div class="kpi-label">集團 ROE</div><div class="kpi-value">${UI.fmt(g.roe,1)}%</div><div class="kpi-sub">股東權益 ${UI.fmt(g.total_equity)}</div></div>
            </div>`;

        if (window._csTab === 'income') {
            const res = await API.get(`/api/consolidation/income?YYYY_MM=${mm}`);
            renderIncome(res.data);
        } else {
            const res = await API.get(`/api/consolidation/balance-sheet?YYYY_MM=${mm}`);
            renderBalanceSheet(res.data);
        }
    } catch (e) {
        document.getElementById('csContent').innerHTML = `<p style="color:#e74c3c">${e.message}</p>`;
    }
}

function renderIncome(data) {
    const cs = data.consolidated;
    const companies = data.companies || [];
    if (!cs) { document.getElementById('csContent').innerHTML = UI.empty('📋', '該期無資料'); return; }
    document.getElementById('csContent').innerHTML = `
        <table class="data-table">
            <thead><tr><th>項目</th>${companies.map(c => `<th class="num">${c.bu_no}</th>`).join('')}<th class="num" style="background:#eef2ff;">合併</th></tr></thead>
            <tbody>
                <tr><td><b>銷售收入</b></td>${companies.map(c => `<td class="num">${UI.fmt(c.sale_amt)}</td>`).join('')}<td class="num" style="font-weight:700;background:#eef2ff;">${UI.fmt(cs.sale_amt)}</td></tr>
                <tr><td>減：內部銷售沖銷</td>${companies.map(c => `<td class="num">${UI.fmt(c.AR_affiliate_amt)}</td>`).join('')}<td class="num" style="color:#e74c3c;background:#eef2ff;">-${UI.fmt(cs.internal_sale)}</td></tr>
                <tr><td><b>合併營收</b></td>${companies.map(() => '<td class="num">-</td>').join('')}<td class="num" style="font-weight:700;background:#eef2ff;">${UI.fmt(cs.consolidated_sale)}</td></tr>
                <tr><td>銷售成本</td>${companies.map(c => `<td class="num">${UI.fmt(c.sale_cost_amt)}</td>`).join('')}<td class="num" style="background:#eef2ff;">${UI.fmt(cs.sale_cost_amt)}</td></tr>
                <tr><td><b>毛利</b></td>${companies.map(c => `<td class="num">${UI.fmt(Number(c.sale_amt)-Number(c.sale_cost_amt))}</td>`).join('')}<td class="num" style="font-weight:700;background:#eef2ff;">${UI.fmt(cs.gross_profit)}</td></tr>
                <tr><td>營業費用</td>${companies.map(c => `<td class="num">${UI.fmt(Number(c.sale_exp_amt)+Number(c.MGM_EXP_amt)+Number(c.finance_EXP_amt))}</td>`).join('')}<td class="num" style="background:#eef2ff;">${UI.fmt(cs.sale_exp_amt+cs.MGM_EXP_amt+cs.finance_EXP_amt)}</td></tr>
                <tr><td><b>營業利益</b></td>${companies.map(c => `<td class="num">${UI.fmt(c.operation_profit_amt)}</td>`).join('')}<td class="num" style="font-weight:700;background:#eef2ff;">${UI.fmt(cs.operation_profit_amt)}</td></tr>
                <tr><td><b>稅後淨利</b></td>${companies.map(c => `<td class="num" style="color:${Number(c.net_profit_amt)>=0?'#27ae60':'#e74c3c'}">${UI.fmt(c.net_profit_amt)}</td>`).join('')}<td class="num" style="font-weight:700;color:${cs.net_profit_amt>=0?'#27ae60':'#e74c3c'};background:#eef2ff;">${UI.fmt(cs.net_profit_amt)}</td></tr>
            </tbody>
        </table>`;
}

function renderBalanceSheet(data) {
    const cs = data.consolidated;
    const companies = data.companies || [];
    if (!cs) { document.getElementById('csContent').innerHTML = UI.empty('📋', '該期無資料'); return; }
    document.getElementById('csContent').innerHTML = `
        <table class="data-table">
            <thead><tr><th>項目</th>${companies.map(c => `<th class="num">${c.bu_no}</th>`).join('')}<th class="num" style="background:#eef2ff;">合併</th></tr></thead>
            <tbody>
                <tr><td colspan="${companies.length+2}" style="background:#f8f9fa;font-weight:700;">資產</td></tr>
                <tr><td>現金及約當現金</td>${companies.map(c => `<td class="num">${UI.fmt(Number(c.cash_amt)+Number(c.deposite_amt))}</td>`).join('')}<td class="num" style="background:#eef2ff;">${UI.fmt(cs.cash_amt+cs.deposite_amt)}</td></tr>
                <tr><td>應收帳款（淨）</td>${companies.map(c => `<td class="num">${UI.fmt(c.AR_amt)}</td>`).join('')}<td class="num" style="background:#eef2ff;">${UI.fmt(cs.AR_net)}</td></tr>
                <tr><td>存貨</td>${companies.map(c => `<td class="num">${UI.fmt(Number(c.stock_P_amt)+Number(c.stock_M_amt)+Number(c.stock_S_amt))}</td>`).join('')}<td class="num" style="background:#eef2ff;">${UI.fmt(cs.inventory)}</td></tr>
                <tr><td><b>資產總計</b></td>${companies.map(c => `<td class="num">${UI.fmt(c.ttl_asset_amt)}</td>`).join('')}<td class="num" style="font-weight:700;background:#eef2ff;">${UI.fmt(cs.ttl_asset_amt)}</td></tr>
                <tr><td colspan="${companies.length+2}" style="background:#f8f9fa;font-weight:700;">負債</td></tr>
                <tr><td>應付帳款</td>${companies.map(c => `<td class="num">${UI.fmt(c.AP_amt)}</td>`).join('')}<td class="num" style="background:#eef2ff;">${UI.fmt(cs.AP_amt)}</td></tr>
                <tr><td>短期借款</td>${companies.map(c => `<td class="num">${UI.fmt(c.loan_amt)}</td>`).join('')}<td class="num" style="background:#eef2ff;">${UI.fmt(cs.loan_amt)}</td></tr>
                <tr><td>長期借款</td>${companies.map(c => `<td class="num">${UI.fmt(c.LT_loan_amt)}</td>`).join('')}<td class="num" style="background:#eef2ff;">${UI.fmt(cs.LT_loan_amt)}</td></tr>
                <tr><td><b>負債總計</b></td>${companies.map(c => `<td class="num">${UI.fmt(c.ttl_debet_amt)}</td>`).join('')}<td class="num" style="font-weight:700;background:#eef2ff;">${UI.fmt(cs.ttl_debet_amt)}</td></tr>
                <tr><td colspan="${companies.length+2}" style="background:#f8f9fa;font-weight:700;">權益</td></tr>
                <tr><td>股本</td>${companies.map(c => `<td class="num">${UI.fmt(c.captial_stock)}</td>`).join('')}<td class="num" style="background:#eef2ff;">${UI.fmt(cs.captial_stock)}</td></tr>
                <tr><td><b>股東權益總計</b></td>${companies.map(c => `<td class="num">${UI.fmt(c.stockholder_amt)}</td>`).join('')}<td class="num" style="font-weight:700;background:#eef2ff;">${UI.fmt(cs.stockholder_amt)}</td></tr>
            </tbody>
        </table>`;
}
