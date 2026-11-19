/**
 * 合并报表页面
 * 集团合并损益表 / 资产负债表 / 现金流量表 / 内部交易冲销
 */
const CS_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] ?? zh);

registerPage('consolidation', async (c) => {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h2 style="margin:0;font-size:20px;">${CS_L('合并报表', '合併報表', 'Consolidation')} <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">${CS_L('集团多公司合并财务报表（基础币别 RMB）', '集團多公司合併財務報表（基礎幣別 RMB）', 'Group multi-company consolidated statements (base currency RMB)')}</small></h2>
            <div>
                <input type="month" id="csMonth" onchange="loadConsol()" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                <button class="btn btn-success" onclick="loadConsol()" style="margin-left:6px;">🔄</button>
            </div>
        </div>
        <div id="csOverview">${t('loading')}</div>
        <div class="card" style="margin-top:16px;">
            <div class="card-title">
                ${CS_L('合并财务报表', '合併財務報表', 'Consolidated Financial Statements')}
                <div style="float:right;">
                    <button class="btn btn-sm btn-primary" onclick="switchTab('income')" id="tabIncome">${CS_L('损益表', '損益表', 'Income Statement')}</button>
                    <button class="btn btn-sm btn-outline" onclick="switchTab('bs')" id="tabBS" style="margin-left:4px;">${CS_L('资产负债表', '資產負債表', 'Balance Sheet')}</button>
                    <button class="btn btn-sm btn-outline" onclick="switchTab('cf')" id="tabCF" style="margin-left:4px;">${CS_L('现金流量表', '現金流量表', 'Cash Flow Statement')}</button>
                </div>
            </div>
            <div id="csContent">${t('loading')}</div>
        </div>
        <div class="card" id="csElimCard" style="margin-top:16px;display:none;">
            <div class="card-title">${CS_L('抵消分录与合并口径', '抵銷分錄與合併口徑', 'Elimination Entries & Consolidation Basis')}</div>
            <div id="csElim"></div>
        </div>
    `;
    document.getElementById('csMonth').value = State.YYYY_MM;
    window._csTab = 'income';
    await loadConsol();
});

function switchTab(tab) {
    window._csTab = tab;
    const map = { income: 'tabIncome', bs: 'tabBS', cf: 'tabCF' };
    for (const [k, id] of Object.entries(map)) {
        const el = document.getElementById(id);
        if (el) el.className = k === tab ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
    }
    loadConsol();
}

async function loadConsol() {
    const mm = document.getElementById('csMonth').value;
    if (!mm) return;
    try {
        const ovRes = await API.get(`/api/consolidation/overview?YYYY_MM=${mm}`);
        renderConsolKpi(ovRes.data, mm);

        if (window._csTab === 'income') {
            const res = await API.get(`/api/consolidation/income?YYYY_MM=${mm}`);
            renderIncome(res.data);
            renderElimPanel(res.data);
        } else if (window._csTab === 'bs') {
            const res = await API.get(`/api/consolidation/balance-sheet?YYYY_MM=${mm}`);
            renderBalanceSheet(res.data);
            renderElimPanel(res.data);
        } else {
            const res = await API.get(`/api/consolidation/cash-flow?YYYY_MM=${mm}`);
            renderCashFlow(res.data);
            document.getElementById('csElimCard').style.display = 'none';
        }
    } catch (e) {
        document.getElementById('csContent').innerHTML = `<p style="color:#e74c3c">${e.message}</p>`;
        document.getElementById('csElimCard').style.display = 'none';
    }
}

function renderConsolKpi(data, mm) {
    const g = data.group_total || {};
    const b = data.before || {};
    const adj = data.adjustment || {};
    const el = document.getElementById('csOverview');
    if (!data.group_total) { el.innerHTML = UI.empty('📋', CS_L('该期无资料', '該期無資料', 'No data for this period')); return; }
    const sign = v => Number(v) >= 0 ? '#27ae60' : '#e74c3c';
    const fmtAdj = v => Number(v) ? `<span style="color:${sign(v)}">${UI.fmt(v)}</span>` : '-';
    el.innerHTML = `
        <div class="kpi-grid">
            <div class="kpi-card blue">
                <div class="kpi-label">${CS_L('集团合并营收', '集團合併營收', 'Group Consolidated Revenue')}</div>
                <div class="kpi-value">${UI.fmt(g.total_sale)}</div>
                <div class="kpi-sub">${CS_L('抵消前', '抵銷前', 'Before elimination')} ${UI.fmt(b.total_sale)}${CS_L('，调整', '，調整', ', adj.')} ${fmtAdj(adj.sale)}</div>
            </div>
            <div class="kpi-card ${g.total_profit >= 0 ? 'green' : 'red'}">
                <div class="kpi-label">${CS_L('合并净利', '合併淨利', 'Consolidated Net Profit')}</div>
                <div class="kpi-value">${UI.fmt(g.total_profit)}</div>
                <div class="kpi-sub">${CS_L('净利率', '淨利率', 'Net margin')} ${UI.fmt(g.profit_margin, 1)}%${CS_L('，调整', '，調整', ', adj.')} ${fmtAdj(adj.profit)}</div>
            </div>
            <div class="kpi-card blue">
                <div class="kpi-label">${CS_L('集团总资产', '集團總資產', 'Group Total Assets')}</div>
                <div class="kpi-value">${UI.fmt(g.total_asset)}</div>
                <div class="kpi-sub">${CS_L('负债比', '負債比', 'Debt ratio')} ${UI.fmt(g.debt_ratio, 1)}%${CS_L('，调整', '，調整', ', adj.')} ${fmtAdj(adj.asset)}</div>
            </div>
            <div class="kpi-card ${g.roe >= 8 ? 'green' : 'red'}">
                <div class="kpi-label">${CS_L('集团', '集團', 'Group')} ROE</div>
                <div class="kpi-value">${UI.fmt(g.roe, 1)}%</div>
                <div class="kpi-sub">${CS_L('股东权益', '股東權益', 'Equity')} ${UI.fmt(g.total_equity)}${CS_L('，', '，', ', ')}${mm}</div>
            </div>
        </div>`;
}

function csAdjCell(v) {
    const n = Number(v || 0);
    if (!n) return '<td class="num">-</td>';
    return `<td class="num" style="color:${n >= 0 ? '#27ae60' : '#e74c3c'}">${UI.fmt(n)}</td>`;
}

function renderIncome(data) {
    const b = data.before, a = data.consolidated;
    const companies = data.companies || [];
    const el = document.getElementById('csContent');
    if (!a) { el.innerHTML = UI.empty('📋', CS_L('该期无资料', '該期無資料', 'No data for this period')); return; }

    const rows = [
        ['销售收入', '銷售收入', 'Sales Revenue', c => Number(c.sale_amt), b.sale_amt, a.sale_amt, false],
        ['销售成本', '銷售成本', 'Cost of Sales', c => Number(c.sale_cost_amt), b.sale_cost_amt, a.sale_cost_amt, false],
        ['毛利', '毛利', 'Gross Profit', c => Number(c.sale_amt) - Number(c.sale_cost_amt), b.gross_profit, a.gross_profit, true],
        ['营业费用', '營業費用', 'Operating Expenses', c => Number(c.sale_exp_amt) + Number(c.MGM_EXP_amt) + Number(c.finance_EXP_amt), Number(b.sale_exp_amt) + Number(b.MGM_EXP_amt) + Number(b.finance_EXP_amt), Number(a.sale_exp_amt) + Number(a.MGM_EXP_amt) + Number(a.finance_EXP_amt), false],
        ['营业利益', '營業利益', 'Operating Profit', c => Number(c.operation_profit_amt), b.operation_profit_amt, a.operation_profit_amt, true],
        ['税前净利', '稅前淨利', 'Pre-tax Profit', c => Number(c.pretax_profit_amt), b.pretax_profit_amt, a.pretax_profit_amt, true],
        ['税后净利', '稅後淨利', 'Net Profit', c => Number(c.net_profit_amt), b.net_profit_amt, a.net_profit_amt, true]
    ];

    const body = rows.map(([label, tw, en, pick, beforeV, afterV, strong]) => {
        const adj = Number(afterV) - Number(beforeV);
        const profitStyle = (label === '营业利益' || label === '税前净利' || label === '税后净利')
            ? `color:${Number(afterV) >= 0 ? '#27ae60' : '#e74c3c'};` : '';
        return `<tr>
            <td>${strong ? `<b>${CS_L(label, tw, en)}</b>` : CS_L(label, tw, en)}</td>
            ${companies.map(c => `<td class="num">${UI.fmt(pick(c))}</td>`).join('')}
            <td class="num">${UI.fmt(beforeV)}</td>
            ${csAdjCell(adj)}
            <td class="num" style="${strong ? 'font-weight:700;' : ''}${profitStyle}background:#eef2ff;">${UI.fmt(afterV)}</td>
        </tr>`;
    }).join('');

    const adj = data.adjustment || {};
    el.innerHTML = `
        <table class="data-table">
            <thead><tr>
                <th>${CS_L('项目', '項目', 'Item')}</th>${companies.map(c => `<th class="num">${c.bu_no}</th>`).join('')}
                <th class="num">${CS_L('抵消前合计', '抵銷前合計', 'Pre-elim. Total')}</th><th class="num">${CS_L('抵消调整', '抵銷調整', 'Elimination Adj.')}</th><th class="num" style="background:#eef2ff;">${CS_L('合并后', '合併後', 'Consolidated')}</th>
            </tr></thead>
            <tbody>${body}</tbody>
        </table>
        <div style="font-size:12px;color:#7f8c8d;line-height:1.8;margin-top:10px;">
            ${CS_L('抵消调整：内部销售', '抵銷調整：內部銷售', 'Elimination adj.: internal sales')} <b style="color:#e74c3c">-${UI.fmt(adj.internal_sale)}</b>
            ${CS_L('（同步冲减成本', '（同步沖減成本', ' (with cost reduced by ')} ${UI.fmt(adj.internal_sale_cost)}${CS_L('）；内部股利', '）；內部股利', '); internal dividends')} <b style="color:#e74c3c">-${UI.fmt(adj.dividend_income)}</b>${CS_L('；其他内部收益', '；其他內部收益', '; other internal income')} <b style="color:#e74c3c">-${UI.fmt(adj.other_income)}</b>${CS_L('。', '。', '. ')}
            ${CS_L('各公司列为抵消前金额。', '各公司列為抵銷前金額。', 'Company columns show pre-elimination amounts.')}
        </div>`;
}

function renderBalanceSheet(data) {
    const b = data.before, a = data.consolidated;
    const companies = data.companies || [];
    const el = document.getElementById('csContent');
    if (!a) { el.innerHTML = UI.empty('📋', CS_L('该期无资料', '該期無資料', 'No data for this period')); return; }

    const rows = [
        ['现金及约当现金', '現金及約當現金', 'Cash & Cash Equivalents', c => Number(c.cash_amt) + Number(c.deposite_amt), b.cash_amt + b.deposite_amt, a.cash_amt + a.deposite_amt, false],
        ['应收账款', '應收帳款', 'Accounts Receivable', c => Number(c.AR_amt), b.AR_amt, a.AR_amt, false],
        ['其他应收', '其他應收', 'Other Receivables', c => Number(c.AR_other_amt), b.AR_other_amt, a.AR_other_amt, false],
        ['应收股利', '應收股利', 'Dividends Receivable', c => Number(c.AR_dividend_amt), b.AR_dividend_amt, a.AR_dividend_amt, false],
        ['存货', '存貨', 'Inventory', c => Number(c.stock_P_amt) + Number(c.stock_M_amt) + Number(c.stock_S_amt), b.inventory, a.inventory, false],
        ['资产总计', '資產總計', 'Total Assets', c => Number(c.ttl_asset_amt), b.ttl_asset_amt, a.ttl_asset_amt, true],
        ['应付账款', '應付帳款', 'Accounts Payable', c => Number(c.AP_amt), b.AP_amt, a.AP_amt, false],
        ['短期借款', '短期借款', 'Short-term Loans', c => Number(c.loan_amt), b.loan_amt, a.loan_amt, false],
        ['长期借款', '長期借款', 'Long-term Loans', c => Number(c.LT_loan_amt), b.LT_loan_amt, a.LT_loan_amt, false],
        ['负债总计', '負債總計', 'Total Liabilities', c => Number(c.ttl_debet_amt), b.ttl_debet_amt, a.ttl_debet_amt, true],
        ['股本', '股本', 'Share Capital', c => Number(c.captial_stock), b.captial_stock, a.captial_stock, false],
        ['股东权益总计', '股東權益總計', 'Total Equity', c => Number(c.stockholder_amt), b.stockholder_amt, a.stockholder_amt, true]
    ];

    const body = rows.map(([label, tw, en, pick, beforeV, afterV, strong]) =>
        `<tr>
            <td>${strong ? `<b>${CS_L(label, tw, en)}</b>` : CS_L(label, tw, en)}</td>
            ${companies.map(c => `<td class="num">${UI.fmt(pick(c))}</td>`).join('')}
            <td class="num">${UI.fmt(beforeV)}</td>
            ${csAdjCell(Number(afterV) - Number(beforeV))}
            <td class="num" style="${strong ? 'font-weight:700;' : ''}background:#eef2ff;">${UI.fmt(afterV)}</td>
        </tr>`).join('');

    const adj = data.adjustment || {};
    const check = Number(a.balance_check || 0);
    const checkOk = Math.abs(check) < 0.01;
    el.innerHTML = `
        <table class="data-table">
            <thead><tr>
                <th>${CS_L('项目', '項目', 'Item')}</th>${companies.map(c => `<th class="num">${c.bu_no}</th>`).join('')}
                <th class="num">${CS_L('抵消前合计', '抵銷前合計', 'Pre-elim. Total')}</th><th class="num">${CS_L('抵消调整', '抵銷調整', 'Elimination Adj.')}</th><th class="num" style="background:#eef2ff;">${CS_L('合并后', '合併後', 'Consolidated')}</th>
            </tr></thead>
            <tbody>${body}</tbody>
        </table>
        <div style="font-size:12px;color:#7f8c8d;line-height:1.8;margin-top:10px;">
            ${CS_L('抵消调整：内部往来', '抵銷調整：內部往來', 'Elimination adj.: intercompany')} <b style="color:#e74c3c">-${UI.fmt(adj.intercompany)}</b>${CS_L('（冲减应收与应付）；', '（沖減應收與應付）；', ' (AR/AP offset); ')}
            ${CS_L('内部借款', '內部借款', 'internal loans')} <b style="color:#e74c3c">-${UI.fmt(adj.loan)}</b>${CS_L('（冲减短期借款与其他应收）；', '（沖減短期借款與其他應收）；', ' (short-term loans & other receivables offset); ')}
            ${CS_L('内部股利', '內部股利', 'internal dividends')} <b style="color:#e74c3c">-${UI.fmt(adj.dividend)}</b>${CS_L('（冲减应收股利与股东权益）。', '（沖減應收股利與股東權益）。', ' (dividends receivable & equity offset).')}
        </div>
        <div style="font-size:12px;margin-top:6px;color:${checkOk ? '#27ae60' : '#e74c3c'};">
            ${CS_L('勾稽检查：资产 - 负债 - 股东权益 =', '勾稽檢查：資產 - 負債 - 股東權益 =', 'Check: Assets - Liabilities - Equity =')} ${UI.fmt(check)} ${checkOk ? CS_L('✅ 平衡', '✅ 平衡', '✅ Balanced') : CS_L('⚠️ 不平衡，请核对抵消分录', '⚠️ 不平衡，請核對抵銷分錄', '⚠️ Unbalanced, please review elimination entries')}
        </div>`;
}

function renderCashFlow(data) {
    const c = data.consolidated || {};
    const companies = data.companies || [];
    const el = document.getElementById('csContent');
    const warn = data.warnings || [];
    const note = warn.length
        ? `<div style="background:#fff8e1;border-left:3px solid #f39c12;padding:8px 12px;margin-bottom:12px;font-size:12px;color:#8a6d3b;">${warn.map(w => `• ${I18N.fixAlert(w)}`).join('<br>')}</div>`
        : '';

    const rows = [
        ['期初现金', '期初現金', 'Beginning Cash', 'cash_begin_amt', false],
        ['经营活动现金流入', '經營活動現金流入', 'Operating Cash Inflow', 'cash_operation_in', false],
        ['经营活动现金流出', '經營活動現金流出', 'Operating Cash Outflow', 'cash_operation_out', false],
        ['经营活动净额', '經營活動淨額', 'Operating Net', 'operating_net', true],
        ['投资活动现金流入', '投資活動現金流入', 'Investing Cash Inflow', 'cash_invest_in', false],
        ['投资活动现金流出', '投資活動現金流出', 'Investing Cash Outflow', 'cash_invest_out', false],
        ['投资活动净额', '投資活動淨額', 'Investing Net', 'invest_net', true],
        ['筹资活动现金流入', '籌資活動現金流入', 'Financing Cash Inflow', 'cash_finance_in', false],
        ['筹资活动现金流出', '籌資活動現金流出', 'Financing Cash Outflow', 'cash_finance_out', false],
        ['筹资活动净额', '籌資活動淨額', 'Financing Net', 'finance_net', true],
        ['现金净变动', '現金淨變動', 'Net Cash Change', 'net_change', true],
        ['期末现金', '期末現金', 'Ending Cash', 'cash_end_amt', false],
        ['期末－期初差异', '期末－期初差異', 'End vs. Begin Diff', 'balance_change', false]
    ];

    const perCompany = (row, key, strong) => companies.map(co => {
        let v;
        if (key === 'operating_net') v = Number(co.cash_operation_in) - Number(co.cash_operation_out);
        else if (key === 'invest_net') v = Number(co.cash_invest_in) - Number(co.cash_invest_out);
        else if (key === 'finance_net') v = Number(co.cash_finance_in) - Number(co.cash_finance_out);
        else if (key === 'net_change') v = (Number(co.cash_operation_in) - Number(co.cash_operation_out)) + (Number(co.cash_invest_in) - Number(co.cash_invest_out)) + (Number(co.cash_finance_in) - Number(co.cash_finance_out));
        else if (key === 'balance_change') v = Number(co.cash_end_amt) - Number(co.cash_begin_amt);
        else v = Number(co[key]);
        const color = (strong && v < 0) ? '#e74c3c' : '';
        return `<td class="num" style="color:${color}">${UI.fmt(v)}</td>`;
    }).join('');

    const body = rows.map(([label, tw, en, key, strong]) => {
        const v = Number(c[key] || 0);
        const color = (strong && v < 0) ? '#e74c3c' : '';
        return `<tr>
            <td>${strong ? `<b>${CS_L(label, tw, en)}</b>` : CS_L(label, tw, en)}</td>
            ${perCompany(null, key, strong)}
            <td class="num" style="${strong ? 'font-weight:700;' : ''}color:${color};background:#eef2ff;">${UI.fmt(v)}</td>
        </tr>`;
    }).join('');

    const diff = Number(c.reconcile_diff || 0);
    el.innerHTML = `
        ${note}
        <table class="data-table">
            <thead><tr><th>${CS_L('项目', '項目', 'Item')}</th>${companies.map(co => `<th class="num">${co.bu_no}</th>`).join('')}<th class="num" style="background:#eef2ff;">${CS_L('合并', '合併', 'Consolidated')}</th></tr></thead>
            <tbody>${body}</tbody>
        </table>
        <div style="font-size:12px;margin-top:8px;color:${Math.abs(diff) < 0.01 ? '#27ae60' : '#e74c3c'};">
            ${CS_L('勾稽检查：经营+投资+筹资净额 -（期末－期初现金）=', '勾稽檢查：經營+投資+籌資淨額 -（期末－期初現金）=', 'Check: Operating + Investing + Financing net - (Ending - Beginning cash) =')} ${UI.fmt(diff)}
            ${Math.abs(diff) < 0.01 ? '✅' : '⚠️'}
        </div>
        <div style="font-size:12px;color:#7f8c8d;line-height:1.8;margin-top:6px;">
            ${CS_L(`口径：金额直接采用资料库数值，一律以 RMB 列示，不做汇率折算；依据现金日记账交易类型归类；利息收入计入投资活动，利息支出计入筹资活动，其余计入经营活动；期初现金自首个有数据月份起累计。`, `口徑：金額直接採用資料庫數值，一律以 RMB 列示，不做匯率折算；依據現金日記帳交易類型歸類；利息收入計入投資活動，利息支出計入籌資活動，其餘計入經營活動；期初現金自首個有資料月份起累計。`, `Basis: amounts are taken directly from database values and always shown in RMB without FX conversion; classified by cash journal transaction type; interest income under investing activities, interest expense under financing activities, the rest under operating activities; beginning cash accumulates from the first month with data.`)}
        </div>`;
}

function renderElimPanel(data) {
    const card = document.getElementById('csElimCard');
    const el = document.getElementById('csElim');
    const entries = data.elimination_entries || [];
    const warnings = data.warnings || [];
    if (!entries.length && !warnings.length) { card.style.display = 'none'; return; }
    card.style.display = '';

    let html = '';
    if (warnings.length) {
        html += `<div style="background:#fff8e1;border-left:3px solid #f39c12;padding:8px 12px;margin-bottom:12px;font-size:12px;color:#8a6d3b;">
            <b>${CS_L('口径提示', '口徑提示', 'Basis Notes')}</b><br>${warnings.map(w => `• ${I18N.fixAlert(w)}`).join('<br>')}
        </div>`;
    }
    if (entries.length) {
        html += `<table class="data-table">
            <thead><tr><th>${CS_L('类型', '類型', 'Type')}</th><th>${CS_L('交易方', '交易方', 'Counterparty')}</th><th>${CS_L('币别', '幣別', 'Currency')}</th><th class="num">${CS_L('金额（RMB）', '金額（RMB）', 'Amount (RMB)')}</th><th>${CS_L('状态', '狀態', 'Status')}</th><th>${CS_L('来源', '來源', 'Source')}</th><th>${CS_L('备注', '備註', 'Remark')}</th></tr></thead>
            <tbody>${entries.map(e => `<tr>
                <td>${e.entry_type_label || e.entry_type}</td>
                <td>${e.bu_no_from} → ${e.bu_no_to}</td>
                <td>${e.currency}</td>
                <td class="num">${UI.fmt(e.amount_rmb)}</td>
                <td>${e.is_confirmed ? CS_L('已确认', '已確認', 'Confirmed') : `<span style="color:#e67e22">${CS_L('未确认', '未確認', 'Unconfirmed')}</span>`}</td>
                <td>${e.source || '-'}</td>
                <td>${e.remark || '-'}</td>
            </tr>`).join('')}</tbody>
        </table>`;
    }
    html += `<div style="font-size:12px;color:#7f8c8d;line-height:1.8;margin-top:10px;">
        ${CS_L(`合并口径：基础报表取自财务汇总，金额一律视为 RMB，不做汇率折算；仅纳入 HM/HN/SZ，排除虚拟公司 LTN；仅已确认抵消分录计入合并结果。
        内部销售同时冲减收入与成本（假设内部销售商品已全部对外销售，期末无未实现利润）；
        AR/AP 按同一内部往来余额冲销，两者同时存在时按 AR 金额冲销避免重复；
        内部借款冲减短期借款与其他应收；内部股利冲减应收股利与股东权益。
        长期股权投资与子公司权益的抵消尚未纳入，需另行补充分录。`, `合併口徑：基礎報表取自財務彙總，金額一律視為 RMB，不做匯率折算；僅納入 HM/HN/SZ，排除虛擬公司 LTN；僅已確認抵銷分錄計入合併結果。
        內部銷售同時沖減收入與成本（假設內部銷售商品已全部對外銷售，期末無未實現利潤）；
        AR/AP 按同一內部往來餘額沖銷，兩者同時存在時按 AR 金額沖銷避免重複；
        內部借款沖減短期借款與其他應收；內部股利沖減應收股利與股東權益。
        長期股權投資與子公司權益的抵銷尚未納入，需另行補充分錄。`, `Consolidation basis: base statements are taken from the financial summary, amounts always treated as RMB without FX conversion; only HM/HN/SZ included, virtual company LTN excluded; only confirmed elimination entries are consolidated.
        Internal sales reduce both revenue and cost (assuming internally sold goods are fully sold externally, no unrealized profit at period end);
        AR/AP are offset by the same intercompany balance; when both exist, the AR amount is used to avoid double counting;
        internal loans reduce short-term loans and other receivables; internal dividends reduce dividends receivable and equity.
        Elimination of long-term equity investment against subsidiary equity is not yet included; additional entries are required.`)}
    </div>`;
    el.innerHTML = html;
}
