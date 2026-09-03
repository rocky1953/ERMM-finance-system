/**
 * 三大財務報表頁面
 */
registerPage('report', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="tabs">
                <div class="tab active" onclick="switchReportTab(this,'bs')">${t('rpt.bs')}</div>
                <div class="tab" onclick="switchReportTab(this,'pl')">${t('rpt.pl')}</div>
                <div class="tab" onclick="switchReportTab(this,'cf')">${t('rpt.cf')}</div>
            </div>
            <div class="toolbar">
                <button class="btn btn-success" onclick="loadReport()">🔄 ${t('refresh')}</button>
                <button class="btn btn-primary" onclick="exportReport()">📊 ${t('rpt.export')}</button>
            </div>
            <div id="reportContent">${t('loading')}</div>
        </div>
    `;
    loadReport();
});

let currentReportTab = 'bs';

function switchReportTab(el, tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    currentReportTab = tab;
    loadReport();
}

async function loadReport() {
    const el = document.getElementById('reportContent');
    const { bu_no, YYYY_MM } = State;
    try {
        if (currentReportTab === 'bs') {
            const res = await API.get(`/api/report/balance-sheet?bu_no=${bu_no}&YYYY_MM=${YYYY_MM}`);
            const d = res.data;
            const bs = d.balance_sheet;
            el.innerHTML = `
                <h3 style="text-align:center;margin-bottom:5px">${bu_no} — ${t('rpt.bs')}</h3>
                <p style="text-align:center;color:#7f8c8d;margin-bottom:15px">${YYYY_MM}</p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:30px">
                    <div>
                        <h4 style="color:#2c5f8d;border-bottom:2px solid #2c5f8d;padding-bottom:5px;margin-bottom:10px">${t('rpt.assets')}</h4>
                        <table class="data-table">
                            <tr><td>${t('rpt.current_assets')}</td><td class="num">${UI.fmt(bs.assets.current.cash + bs.assets.current.ar + bs.assets.current.inventory + bs.assets.current.prepay)}</td></tr>
                            <tr><td style="padding-left:20px">${t('rpt.cash')}</td><td class="num">${UI.fmt(bs.assets.current.cash)}</td></tr>
                            <tr><td style="padding-left:20px">${t('rpt.ar')}</td><td class="num">${UI.fmt(bs.assets.current.ar)}</td></tr>
                            <tr><td style="padding-left:20px">${t('rpt.inventory')}</td><td class="num">${UI.fmt(bs.assets.current.inventory)}</td></tr>
                            <tr><td style="padding-left:20px">${t('rpt.prepay')}</td><td class="num">${UI.fmt(bs.assets.current.prepay)}</td></tr>
                            <tr><td>${t('rpt.non_current_assets')}</td><td class="num">${UI.fmt(bs.assets.non_current.building_net + bs.assets.non_current.equip_net + bs.assets.non_current.vehicle_net + bs.assets.non_current.office_net + bs.assets.non_current.intangible)}</td></tr>
                            <tr style="font-weight:bold;background:#e8f4fd"><td>${t('rpt.total_assets')}</td><td class="num">${UI.fmt(bs.assets.total)}</td></tr>
                        </table>
                    </div>
                    <div>
                        <h4 style="color:#e74c3c;border-bottom:2px solid #e74c3c;padding-bottom:5px;margin-bottom:10px">${t('rpt.liab_equity')}</h4>
                        <table class="data-table">
                            <tr><td>${t('rpt.current_liab')}</td><td class="num">${UI.fmt(bs.liabilities.current.loan + bs.liabilities.current.ap + bs.liabilities.current.tax + bs.liabilities.current.salary + bs.liabilities.current.other)}</td></tr>
                            <tr><td style="padding-left:20px">${t('rpt.short_loan')}</td><td class="num">${UI.fmt(bs.liabilities.current.loan)}</td></tr>
                            <tr><td style="padding-left:20px">${t('rpt.ap')}</td><td class="num">${UI.fmt(bs.liabilities.current.ap)}</td></tr>
                            <tr><td>${t('rpt.long_liab')}</td><td class="num">${UI.fmt(bs.liabilities.long_term.LT_loan)}</td></tr>
                            <tr><td>${t('rpt.equity')}</td><td class="num">${UI.fmt(bs.equity.total)}</td></tr>
                            <tr><td style="padding-left:20px">${t('rpt.capital')}</td><td class="num">${UI.fmt(bs.equity.capital)}</td></tr>
                            <tr><td style="padding-left:20px">${t('rpt.reserve')}</td><td class="num">${UI.fmt(bs.equity.reserve)}</td></tr>
                            <tr><td style="padding-left:20px">${t('rpt.accumulated')}</td><td class="num">${UI.fmt(bs.equity.accumulated)}</td></tr>
                            <tr><td style="padding-left:20px">${t('rpt.current_pl')}</td><td class="num">${UI.fmt(bs.equity.current_PL)}</td></tr>
                            <tr style="font-weight:bold;background:#fde8e8"><td>${t('rpt.total_le')}</td><td class="num">${UI.fmt(bs.liabilities_equity.total)}</td></tr>
                        </table>
                    </div>
                </div>
                <div style="margin-top:15px;text-align:center">
                    <span class="kpi-badge ${bs.check.is_balanced ? 'green' : 'red'}">${bs.check.is_balanced ? '✅ '+t('rpt.balanced') : '❌ '+t('rpt.not_balanced')}</span>
                    <span style="margin-left:10px;color:#7f8c8d">${t('rpt.diff')}: ${UI.fmt(bs.check.asset_minus_le)}</span>
                </div>
            `;
        } else if (currentReportTab === 'pl') {
            const res = await API.get(`/api/report/pl-table?bu_no=${bu_no}&YYYY_MM=${YYYY_MM}`);
            const d = res.data || {};
            el.innerHTML = `
                <h3 style="text-align:center;margin-bottom:5px">${bu_no} — ${t('rpt.pl')}</h3>
                <p style="text-align:center;color:#7f8c8d;margin-bottom:15px">${YYYY_MM}</p>
                <table class="data-table">
                    <tr><td>${t('rpt.sale_income')}</td><td class="num">${UI.fmt(d.sale_amt)}</td></tr>
                    <tr><td>${t('rpt.less_cost')}</td><td class="num">${UI.fmt(d.sale_cost_amt)}</td></tr>
                    <tr><td>${t('rpt.less_vat')}</td><td class="num">${UI.fmt(d.VAT_amt)}</td></tr>
                    <tr style="font-weight:bold"><td>${t('rpt.gross_margin')}</td><td class="num">${UI.fmt(d.BIZ_major_margin_amt)}</td></tr>
                    <tr><td>${t('rpt.add_other')}</td><td class="num">${UI.fmt(d.BIZ_other_INC_amt)}</td></tr>
                    <tr><td>${t('rpt.less_exp')}</td><td class="num">${UI.fmt(d.sale_exp_amt)}</td></tr>
                    <tr><td>${t('rpt.less_mgmt')}</td><td class="num">${UI.fmt(d.MGM_EXP_amt)}</td></tr>
                    <tr><td>${t('rpt.less_fin')}</td><td class="num">${UI.fmt(d.finance_EXP_amt)}</td></tr>
                    <tr style="font-weight:bold"><td>${t('rpt.op_income')}</td><td class="num">${UI.fmt(d.BIZ_margin_amt)}</td></tr>
                    <tr><td>${t('rpt.add_invest')}</td><td class="num">${UI.fmt(d.INVEST_profit_amt)}</td></tr>
                    <tr><td>${t('rpt.add_subsidy')}</td><td class="num">${UI.fmt(d.AR_subsidy_amt)}</td></tr>
                    <tr style="font-weight:bold"><td>${t('rpt.op_profit')}</td><td class="num">${UI.fmt(d.operation_profit_amt)}</td></tr>
                    <tr style="font-weight:bold;background:#e8f4fd"><td>${t('rpt.net_profit')}</td><td class="num ${Number(d.net_profit_amt)>=0?'positive':'negative'}">${UI.fmt(d.net_profit_amt)}</td></tr>
                </table>
            `;
        } else {
            const res = await API.get(`/api/report/cash-flow?bu_no=${bu_no}&YYYY_MM=${YYYY_MM}`);
            const d = res.data || {};
            el.innerHTML = `
                <h3 style="text-align:center;margin-bottom:5px">${bu_no} — ${t('rpt.cf')}</h3>
                <p style="text-align:center;color:#7f8c8d;margin-bottom:15px">${YYYY_MM}</p>
                <table class="data-table">
                    <tr style="background:#e8f4fd"><td colspan="2"><b>${t('rpt.operating_cf')}</b></td></tr>
                    <tr><td>${t('rpt.net_income')}</td><td class="num">${UI.fmt(d.net_profit)}</td></tr>
                    <tr><td>${t('rpt.dep_amort')}</td><td class="num">${UI.fmt(d.depreciation)}</td></tr>
                    <tr><td>${t('rpt.ar_change')}</td><td class="num">${UI.fmt(d.ar_change)}</td></tr>
                    <tr><td>${t('rpt.inv_change')}</td><td class="num">${UI.fmt(d.inventory_change)}</td></tr>
                    <tr><td>${t('rpt.ap_change')}</td><td class="num">${UI.fmt(d.ap_change)}</td></tr>
                    <tr style="font-weight:bold"><td>${t('rpt.op_net_cf')}</td><td class="num">${UI.fmt(d.operating_cf)}</td></tr>
                    <tr style="background:#fde8e8"><td colspan="2"><b>${t('rpt.investing_cf')}</b></td></tr>
                    <tr><td>${t('rpt.capex')}</td><td class="num">${UI.fmt(d.capex)}</td></tr>
                    <tr style="font-weight:bold"><td>${t('rpt.inv_net_cf')}</td><td class="num">${UI.fmt(d.investing_cf)}</td></tr>
                    <tr style="background:#fef3e8"><td colspan="2"><b>${t('rpt.financing_cf')}</b></td></tr>
                    <tr><td>${t('rpt.loan_change')}</td><td class="num">${UI.fmt(d.loan_change)}</td></tr>
                    <tr style="font-weight:bold"><td>${t('rpt.fin_net_cf')}</td><td class="num">${UI.fmt(d.financing_cf)}</td></tr>
                    <tr style="font-weight:bold;background:#d5f5e3"><td>${t('rpt.net_cash_change')}</td><td class="num">${UI.fmt(d.net_cash_change)}</td></tr>
                </table>
            `;
        }
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

function exportReport() {
    const type = currentReportTab === 'bs' ? 'balance-sheet' : currentReportTab === 'pl' ? 'pl-table' : 'cash-flow';
    window.open(`/api/report/export/${type}.xlsx?bu_no=${State.bu_no}&YYYY_MM=${State.YYYY_MM}`, '_blank');
}
