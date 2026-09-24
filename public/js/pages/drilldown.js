/**
 * 多維度下鑽分析頁面
 * 產品毛利排行 / 客戶貢獻度 / 部門費用分析
 */
registerPage('drilldown', async (c) => {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h2 style="margin:0;font-size:20px;">多維度下鑽分析 <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">找出吃利潤的產品、客戶、部門</small></h2>
            <div>
                <select id="ddBu" onchange="loadDrilldown()" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                    <option value="HM">HM</option><option value="SZ">SZ</option><option value="HN">HN</option>
                </select>
                <select id="ddTab" onchange="loadDrilldown()" style="padding:7px;border:1px solid #ddd;border-radius:6px;margin-left:6px;">
                    <option value="product">產品毛利</option>
                    <option value="customer">客戶貢獻</option>
                    <option value="department">部門費用</option>
                </select>
            </div>
        </div>
        <div class="card"><div id="drillContent">${t('loading')}</div></div>
    `;
    document.getElementById('ddBu').value = State.bu_no;
    await loadDrilldown();
});

async function loadDrilldown() {
    const el = document.getElementById('drillContent');
    const bu = document.getElementById('ddBu').value;
    const tab = document.getElementById('ddTab').value;
    State.bu_no = bu;
    try {
        const res = await API.get(`/api/analysis/${tab}?bu_no=${bu}&YYYY_MM=${State.YYYY_MM}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = UI.empty('🔍', '暫無資料'); return; }

        if (tab === 'product') {
            el.innerHTML = renderProduct(rows);
        } else if (tab === 'customer') {
            el.innerHTML = renderCustomer(rows);
        } else {
            el.innerHTML = renderDepartment(rows);
        }
    } catch (e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

function renderProduct(rows) {
    const maxProfit = Math.max(...rows.map(r => Math.abs(r.profit_amt || 0)), 1);
    return `<table class="data-table">
        <thead><tr><th>排名</th><th>產品名稱</th><th>毛利貢獻</th><th class="num">毛利率</th><th class="num">毛利額</th><th class="num">營收</th></tr></thead>
        <tbody>${rows.map((r, i) => {
            const noCls = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
            const barW = Math.abs(r.profit_amt) / maxProfit * 100;
            const barColor = r.profit_amt >= 0 ? '#27ae60' : '#e74c3c';
            return `<tr>
                <td><span class="rank-no ${noCls}">${i + 1}</span></td>
                <td><b>${r.product_name}</b><div style="font-size:11px;color:#95a5a6;">${r.order_cnt} 筆訂單</div></td>
                <td><div class="rank-bar"><div class="rank-bar-fg" style="width:${barW}%;background:${barColor};"></div></div></td>
                <td class="num" style="color:${r.profit_rate < 0 ? '#e74c3c' : '#27ae60'}">${UI.fmt(r.profit_rate, 1)}%</td>
                <td class="num" style="color:${r.profit_amt < 0 ? '#e74c3c' : ''}">${UI.fmt(r.profit_amt)}</td>
                <td class="num">${UI.fmt(r.sale_amt)}</td>
            </tr>`;
        }).join('')}</tbody></table>`;
}

function renderCustomer(rows) {
    const maxProfit = Math.max(...rows.map(r => Math.abs(r.profit_amt || 0)), 1);
    return `<table class="data-table">
        <thead><tr><th>排名</th><th>客戶</th><th>貢獻度</th><th class="num">毛利率</th><th class="num">毛利額</th><th class="num">營收</th></tr></thead>
        <tbody>${rows.map((r, i) => {
            const noCls = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
            const barW = Math.abs(r.profit_amt) / maxProfit * 100;
            const barColor = r.profit_amt >= 0 ? '#27ae60' : '#e74c3c';
            return `<tr>
                <td><span class="rank-no ${noCls}">${i + 1}</span></td>
                <td><b>${r.client_id}</b></td>
                <td><div class="rank-bar"><div class="rank-bar-fg" style="width:${barW}%;background:${barColor};"></div></div></td>
                <td class="num" style="color:${r.profit_rate < 0 ? '#e74c3c' : '#27ae60'}">${UI.fmt(r.profit_rate, 1)}%</td>
                <td class="num" style="color:${r.profit_amt < 0 ? '#e74c3c' : ''}">${UI.fmt(r.profit_amt)}</td>
                <td class="num">${UI.fmt(r.sale_amt)}</td>
            </tr>`;
        }).join('')}</tbody></table>`;
}

function renderDepartment(rows) {
    const maxExp = Math.max(...rows.map(r => Math.abs(r.expense || 0)), 1);
    return `<table class="data-table">
        <thead><tr><th>排名</th><th>部門</th><th>費用佔比</th><th class="num">費用額</th><th class="num">邊際利潤</th></tr></thead>
        <tbody>${rows.map((r, i) => {
            const noCls = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
            const barW = Math.abs(r.expense) / maxExp * 100;
            return `<tr>
                <td><span class="rank-no ${noCls}">${i + 1}</span></td>
                <td><b>${r.dept}</b></td>
                <td><div class="rank-bar"><div class="rank-bar-fg" style="width:${barW}%;"></div></div></td>
                <td class="num">${UI.fmt(r.expense)}</td>
                <td class="num" style="color:${r.profit < 0 ? '#e74c3c' : '#27ae60'}">${UI.fmt(r.profit)}</td>
            </tr>`;
        }).join('')}</tbody></table>`;
}
