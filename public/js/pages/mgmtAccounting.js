/**
 * 管理会计页面
 * 部门损益、成本结构、人效分析
 */
const MA_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] ?? zh);

registerPage('mgmtAccounting', async (c) => {
    const _bu = await CodeHelper.buSel();
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h2 style="margin:0;font-size:20px;">${MA_L('管理会计', '管理會計', 'Management Accounting')} <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">${MA_L('部门损益 · 成本结构 · 人效分析', '部門損益 · 成本結構 · 人效分析', 'Department P&L · Cost Structure · Efficiency')}</small></h2>
            <div>
                <select id="maBu" onchange="loadMA()" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                    ${_bu}
                </select>
                <select id="maYear" onchange="loadMA()" style="padding:7px;border:1px solid #ddd;border-radius:6px;margin-left:6px;">
                    ${maYearOptions()}
                </select>
            </div>
        </div>
        <div class="card"><div class="card-title">${MA_L('部门损益汇总', '部門損益彙總', 'Department P&L Summary')}</div><div id="maDept">${t('loading')}</div></div>
        <div class="card" style="margin-top:16px;"><div class="card-title">${MA_L('成本结构分析', '成本結構分析', 'Cost Structure Analysis')}</div><div id="maCost">${t('loading')}</div></div>
        <div class="card" style="margin-top:16px;"><div class="card-title">${MA_L('人效分析', '人效分析', 'Workforce Efficiency')}</div><div id="maEff">${t('loading')}</div></div>
    `;
    document.getElementById('maBu').value = State.bu_no;
    document.getElementById('maYear').value = String(State.year());
    await loadMA();
});

// 年度下拉：預設選「畫面最上方」的全域年度，並保留 2023~2025 既有資料年度可選
function maYearOptions() {
    const gy = String(State.year());
    return [...new Set([gy, '2025', '2024', '2023'])]
        .sort((a, b) => Number(b) - Number(a))
        .map(y => `<option value="${y}">${y}</option>`).join('');
}

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

        // 部门损益
        const depts = deptRes.data || [];
        const maxProfit = Math.max(...depts.map(d => Math.abs(Number(d.total_profit || 0))), 1);
        document.getElementById('maDept').innerHTML = depts.length === 0 ? UI.empty('🏢', MA_L('暂无部门资料', '暫無部門資料', 'No department data')) : `
            <table class="data-table">
                <thead><tr><th>${MA_L('排名', '排名', 'Rank')}</th><th>${MA_L('部门', '部門', 'Department')}</th><th>${MA_L('类型', '類型', 'Type')}</th><th class="num">${MA_L('收入', '收入', 'Revenue')}</th><th class="num">${MA_L('利润', '利潤', 'Profit')}</th><th class="num">${MA_L('利润率', '利潤率', 'Margin')}</th><th class="num">${MA_L('人均利润', '人均利潤', 'Profit / Capita')}</th><th>${MA_L('贡献度', '貢獻度', 'Contribution')}</th></tr></thead>
                <tbody>${depts.map((d, i) => {
                    const noCls = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
                    const barW = Math.abs(Number(d.total_profit)) / maxProfit * 100;
                    return `<tr>
                        <td><span class="rank-no ${noCls}">${i+1}</span></td>
                        <td><b>${d.dept_name}</b><br><span style="font-size:11px;color:#95a5a6;">${d.manager || '-'} · ${Number(d.avg_headcount||0).toFixed(0)} ${MA_L('人', '人', 'people')}</span></td>
                        <td><span class="badge ${d.dept_type==='profit'?'bg-success':'bg-warning'}">${d.dept_type==='profit'?MA_L('利润中心', '利潤中心', 'Profit Center'):MA_L('成本中心', '成本中心', 'Cost Center')}</span></td>
                        <td class="num">${UI.fmt(d.total_revenue)}</td>
                        <td class="num" style="color:${Number(d.total_profit)>=0?'#27ae60':'#e74c3c'}">${UI.fmt(d.total_profit)}</td>
                        <td class="num">${UI.fmt(d.profit_margin,1)}%</td>
                        <td class="num">${UI.fmt(d.profit_per_person)}</td>
                        <td><div class="rank-bar"><div class="rank-bar-fg" style="width:${barW}%;background:${Number(d.total_profit)>=0?'#27ae60':'#e74c3c'};"></div></div></td>
                    </tr>`;
                }).join('')}</tbody>
            </table>`;

        // 成本结构
        const cost = costRes.data;
        if (cost && cost.items) {
            document.getElementById('maCost').innerHTML = `
                <div style="margin-bottom:12px;font-size:13px;color:#555;">${MA_L('总营收', '總營收', 'Total Revenue')} ${UI.fmt(cost.total_sale)} · ${MA_L('员工数', '員工數', 'Headcount')} ${cost.employee_cnt} ${MA_L('人', '人', 'people')}</div>
                <table class="data-table">
                    <thead><tr><th>${MA_L('成本项目', '成本項目', 'Cost Item')}</th><th class="num">${MA_L('金额', '金額', 'Amount')}</th><th class="num">${MA_L('占营收比', '佔營收比', '% of Revenue')}</th><th>${MA_L('结构', '結構', 'Structure')}</th></tr></thead>
                    <tbody>${cost.items.map(it => `<tr>
                        <td><b>${it.item}</b></td>
                        <td class="num">${UI.fmt(it.amount)}</td>
                        <td class="num">${UI.fmt(it.pct,1)}%</td>
                        <td><div class="rank-bar"><div class="rank-bar-fg" style="width:${Math.min(it.pct,100)}%;"></div></div></td>
                    </tr>`).join('')}</tbody>
                </table>`;
        } else {
            document.getElementById('maCost').innerHTML = UI.empty('💰', MA_L('暂无成本资料', '暫無成本資料', 'No cost data'));
        }

        // 人效分析
        const eff = effRes.data || [];
        document.getElementById('maEff').innerHTML = eff.length === 0 ? UI.empty('👥', MA_L('暂无人效资料', '暫無人效資料', 'No efficiency data')) : `
            <table class="data-table">
                <thead><tr><th>${MA_L('月份', '月份', 'Month')}</th><th class="num">${MA_L('员工人数', '員工人數', 'Headcount')}</th><th class="num">${MA_L('人均营收', '人均營收', 'Revenue / Capita')}</th><th class="num">${MA_L('人均净利', '人均淨利', 'Net Profit / Capita')}</th><th class="num">${MA_L('人均薪资', '人均薪資', 'Salary / Capita')}</th><th class="num">${MA_L('薪资报酬率', '薪資報酬率', 'Salary ROI')}</th></tr></thead>
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
