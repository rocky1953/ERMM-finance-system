/**
 * 管理會計頁面
 * 部門損益、成本結構、人效分析
 */
registerPage('mgmtAccounting', async (c) => {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h2 style="margin:0;font-size:20px;">管理會計 <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">部門損益 · 成本結構 · 人效分析</small></h2>
            <div>
                <select id="maBu" onchange="loadMA()" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                    <option value="HM">HM</option><option value="SZ">SZ</option><option value="HN">HN</option>
                </select>
                <select id="maYear" onchange="loadMA()" style="padding:7px;border:1px solid #ddd;border-radius:6px;margin-left:6px;">
                    <option value="2025">2025</option><option value="2024">2024</option>
                </select>
            </div>
        </div>
        <div class="card"><div class="card-title">部門損益彙總</div><div id="maDept">${t('loading')}</div></div>
        <div class="card" style="margin-top:16px;"><div class="card-title">成本結構分析</div><div id="maCost">${t('loading')}</div></div>
        <div class="card" style="margin-top:16px;"><div class="card-title">人效分析</div><div id="maEff">${t('loading')}</div></div>
    `;
    document.getElementById('maBu').value = State.bu_no;
    await loadMA();
});

async function loadMA() {
    const bu = document.getElementById('maBu').value;
    const yr = document.getElementById('maYear').value;
    State.bu_no = bu;
    try {
        const [deptRes, costRes, effRes] = await Promise.all([
            API.get(`/api/mgmt-accounting/dept-summary?bu_no=${bu}&YYYY=${yr}`),
            API.get(`/api/mgmt-accounting/cost-structure?bu_no=${bu}`),
            API.get(`/api/mgmt-accounting/efficiency?bu_no=${bu}`)
        ]);

        // 部門損益
        const depts = deptRes.data || [];
        const maxProfit = Math.max(...depts.map(d => Math.abs(Number(d.total_profit || 0))), 1);
        document.getElementById('maDept').innerHTML = depts.length === 0 ? UI.empty('🏢', '暫無部門資料') : `
            <table class="data-table">
                <thead><tr><th>排名</th><th>部門</th><th>類型</th><th class="num">收入</th><th class="num">利潤</th><th class="num">利潤率</th><th class="num">人均利潤</th><th>貢獻度</th></tr></thead>
                <tbody>${depts.map((d, i) => {
                    const noCls = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
                    const barW = Math.abs(Number(d.total_profit)) / maxProfit * 100;
                    return `<tr>
                        <td><span class="rank-no ${noCls}">${i+1}</span></td>
                        <td><b>${d.dept_name}</b><br><span style="font-size:11px;color:#95a5a6;">${d.manager || '-'} · ${Number(d.avg_headcount||0).toFixed(0)}人</span></td>
                        <td><span class="badge ${d.dept_type==='profit'?'bg-success':'bg-warning'}">${d.dept_type==='profit'?'利潤中心':'成本中心'}</span></td>
                        <td class="num">${UI.fmt(d.total_revenue)}</td>
                        <td class="num" style="color:${Number(d.total_profit)>=0?'#27ae60':'#e74c3c'}">${UI.fmt(d.total_profit)}</td>
                        <td class="num">${UI.fmt(d.profit_margin,1)}%</td>
                        <td class="num">${UI.fmt(d.profit_per_person)}</td>
                        <td><div class="rank-bar"><div class="rank-bar-fg" style="width:${barW}%;background:${Number(d.total_profit)>=0?'#27ae60':'#e74c3c'};"></div></div></td>
                    </tr>`;
                }).join('')}</tbody>
            </table>`;

        // 成本結構
        const cost = costRes.data;
        if (cost && cost.items) {
            document.getElementById('maCost').innerHTML = `
                <div style="margin-bottom:12px;font-size:13px;color:#555;">總營收 ${UI.fmt(cost.total_sale)} · 員工數 ${cost.employee_cnt} 人</div>
                <table class="data-table">
                    <thead><tr><th>成本項目</th><th class="num">金額</th><th class="num">佔營收比</th><th>結構</th></tr></thead>
                    <tbody>${cost.items.map(it => `<tr>
                        <td><b>${it.item}</b></td>
                        <td class="num">${UI.fmt(it.amount)}</td>
                        <td class="num">${UI.fmt(it.pct,1)}%</td>
                        <td><div class="rank-bar"><div class="rank-bar-fg" style="width:${Math.min(it.pct,100)}%;"></div></div></td>
                    </tr>`).join('')}</tbody>
                </table>`;
        } else {
            document.getElementById('maCost').innerHTML = UI.empty('💰', '暫無成本資料');
        }

        // 人效分析
        const eff = effRes.data || [];
        document.getElementById('maEff').innerHTML = eff.length === 0 ? UI.empty('👥', '暫無人效資料') : `
            <table class="data-table">
                <thead><tr><th>月份</th><th class="num">員工人數</th><th class="num">人均營收</th><th class="num">人均淨利</th><th class="num">人均薪資</th><th class="num">薪資報酬率</th></tr></thead>
                <tbody>${eff.map(e => `<tr>
                    <td>${e.YYYY_MM}</td>
                    <td class="num">${e.employee_cnt || 0}</td>
                    <td class="num">${UI.fmt(e.sale_per_person)}</td>
                    <td class="num" style="color:${Number(e.profit_per_person)>=0?'#27ae60':'#e74c3c'}">${UI.fmt(e.profit_per_person)}</td>
                    <td class="num">${UI.fmt(e.salary_per_person)}</td>
                    <td class="num">${UI.fmt(e.profit_per_salary,2)}</td>
                </tr>`).join('')}</tbody>
            </table>`;
    } catch (e) {
        document.getElementById('maDept').innerHTML = `<p style="color:#e74c3c">${e.message}</p>`;
    }
}
