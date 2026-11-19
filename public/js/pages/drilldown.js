/**
 * 多维度下钻分析页面
 * 产品毛利排行 / 客户贡献度 / 部门费用分析
 */
const DD_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] ?? zh);
registerPage('drilldown', async (c) => {
    const _bu = await CodeHelper.buSel();
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h2 style="margin:0;font-size:20px;">${DD_L('多维度下钻分析','多維度下鑽分析','Multi-dimensional Drill-down')} <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">${DD_L('找出吃利润的产品、客户、部门','找出吃利潤的產品、客戶、部門','Find products, customers & departments driving profit')}</small></h2>
            <div>
                <select id="ddBu" onchange="loadDrilldown()" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                    ${_bu}
                </select>
                <select id="ddTab" onchange="loadDrilldown()" style="padding:7px;border:1px solid #ddd;border-radius:6px;margin-left:6px;">
                    <option value="product">${DD_L('产品毛利','產品毛利','Product Margin')}</option>
                    <option value="customer">${DD_L('客户贡献','客戶貢獻','Customer Contribution')}</option>
                    <option value="department">${DD_L('部门费用','部門費用','Department Expense')}</option>
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
        if (rows.length === 0) { el.innerHTML = UI.empty('🔍', DD_L('暂无资料','暫無資料','No data')); return; }

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
    return `<div style="font-size:12px;color:#7f8c8d;margin-bottom:8px;background:#f8f9fa;border-left:3px solid #3498db;padding:6px 10px;border-radius:4px;">
        ℹ ${DD_L('毛利额＝品项销售额 × 当月财务月结实际毛利率（取自损益表 BIZ 主要毛利）。ERP 尚无工单/BOM 资料，无法按品项精确归集材料成本，故为分摊估算。','毛利額＝品項銷售額 × 當月財務月結實際毛利率（取自損益表 BIZ 主要毛利）。ERP 尚無工單/BOM 資料，無法按品項精確歸集材料成本，故為分攤估算。','Gross margin = item sales x actual monthly close gross margin (P&L BIZ main gross margin). ERP has no work order/BOM data, so material cost cannot be precisely allocated by item; this is an allocation estimate.')}</div>
    <table class="data-table">
        <thead><tr><th>${DD_L('排名','排名','Rank')}</th><th>${DD_L('产品名称','產品名稱','Product')}</th><th>${DD_L('毛利贡献','毛利貢獻','Margin Contribution')}</th><th class="num">${DD_L('毛利率','毛利率','Margin %')}</th><th class="num">${DD_L('毛利额','毛利額','Margin Amount')}</th><th class="num">${DD_L('营收','營收','Revenue')}</th></tr></thead>
        <tbody>${rows.map((r, i) => {
            const noCls = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
            const barW = Math.abs(r.profit_amt) / maxProfit * 100;
            return `<tr>
                <td><span class="rank-no ${noCls}">${i + 1}</span></td>
                <td><b>${r.product_name}</b><div style="font-size:11px;color:#95a5a6;">${r.order_cnt} ${DD_L('笔订单','筆訂單','orders')}</div></td>
                <td><div class="rank-bar"><div class="rank-bar-fg" style="width:${barW}%;background:#27ae60;"></div></div></td>
                <td class="num" style="color:#27ae60">${Number(r.profit_rate || 0).toFixed(1)}%</td>
                <td class="num">${UI.fmt(r.profit_amt)}</td>
                <td class="num">${UI.fmt(r.sale_amt)}</td>
            </tr>`;
        }).join('')}</tbody></table>`;
}

function renderCustomer(rows) {
    const maxSale = Math.max(...rows.map(r => Number(r.sale_amt || 0)), 1);
    const total = rows.reduce((s, r) => s + Number(r.sale_amt || 0), 0);
    const orders = rows.reduce((s, r) => s + Number(r.order_cnt || 0), 0);
    const profit = rows.reduce((s, r) => s + Number(r.profit_amt || 0), 0);
    const totalRate = total > 0 ? (profit / total * 100) : 0;
    return `<div style="font-size:12px;color:#7f8c8d;margin-bottom:8px;background:#f8f9fa;border-left:3px solid #2563eb;padding:6px 10px;border-radius:4px;">
        ℹ ${DD_L('毛利率取自当月财务月结实际值（损益表 BIZ 主要毛利 ÷ 营收），ERP 尚无 BOM 资料，客户毛利为分摊估算。','毛利率取自當月財務月結實際值（損益表 BIZ 主要毛利 ÷ 營收），ERP 尚無 BOM 資料，客戶毛利為分攤估算。','Gross margin uses the actual monthly close value (P&L BIZ main gross margin / revenue). ERP has no BOM data, so customer gross margin is an allocation estimate.')}</div>
    <table class="data-table">
        <thead><tr><th>${DD_L('排名','排名','Rank')}</th><th>${DD_L('客户','客戶','Customer')}</th><th>${DD_L('销售贡献度','銷售貢獻度','Sales Contribution')}</th><th class="num">${DD_L('占比','佔比','Share')}</th><th class="num">${DD_L('毛利率','毛利率','Margin %')}</th><th class="num">${DD_L('订单数','訂單數','Orders')}</th><th class="num">${DD_L('销售额','銷售額','Revenue')}</th></tr></thead>
        <tbody>${rows.map((r, i) => {
            const noCls = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
            const barW = Number(r.sale_amt || 0) / maxSale * 100;
            return `<tr>
                <td><span class="rank-no ${noCls}">${i + 1}</span></td>
                <td><b>${r.client_id}</b></td>
                <td><div class="rank-bar"><div class="rank-bar-fg" style="width:${barW}%;background:#2563eb;"></div></div></td>
                <td class="num">${Number(r.contribution_pct || 0).toFixed(1)}%</td>
                <td class="num" style="color:#27ae60">${Number(r.profit_rate || 0).toFixed(1)}%</td>
                <td class="num">${r.order_cnt}</td>
                <td class="num">${UI.fmt(r.sale_amt)}</td>
            </tr>`;
        }).join('')}</tbody>
        <tfoot><tr><td colspan="3" style="text-align:right;"><b>${DD_L('合计','合計','Total')}（${rows.length} ${DD_L('家客户','家客戶','customers')}）</b></td>
            <td class="num"><b>100.0%</b></td><td class="num"><b>${totalRate.toFixed(1)}%</b></td><td class="num"><b>${orders}</b></td><td class="num"><b>${UI.fmt(total)}</b></td></tr></tfoot>
    </table>`;
}

function renderDepartment(rows) {
    const maxExp = Math.max(...rows.map(r => Math.abs(r.expense || 0)), 1);
    return `<table class="data-table">
        <thead><tr><th>${DD_L('排名','排名','Rank')}</th><th>${DD_L('部门','部門','Department')}</th><th>${DD_L('费用占比','費用佔比','Expense Share')}</th><th class="num">${DD_L('费用额','費用額','Expense Amount')}</th><th class="num">${DD_L('边际利润','邊際利潤','Marginal Profit')}</th></tr></thead>
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
