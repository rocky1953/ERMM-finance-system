/**
 * 電子化報稅 — 測試與申報頁面（VAT / CIT / IIT）
 *
 * 對應後端：/api/tax/*
 * 操作流程：選模組 → 填參數 → 算稅 → 畫面核對計算式 → 提交申報 → 取得稅局受理號
 */
const TAX_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] ?? zh);
// 表單預設期間：依「畫面最上方」全域年月
function taxYmCompact() {
    const ym = State.YYYY_MM || '';
    return /^\d{4}-\d{2}$/.test(ym) ? ym.replace('-', '') : '202512';
}
function taxYmDash() {
    return (State.YYYY_MM && /^\d{4}-\d{2}$/.test(State.YYYY_MM)) ? State.YYYY_MM : '2025-12';
}

registerPage('tax', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <button class="btn btn-primary" id="taxTab_vat" onclick="TaxUI.switchTab('vat')">${TAX_L('增值税申报', '增值稅申報', 'VAT Filing')}</button>
                <button class="btn" id="taxTab_cit" onclick="TaxUI.switchTab('cit')">${TAX_L('企业所得税汇算', '企業所得稅匯算', 'CIT Annual Settlement')}</button>
                <button class="btn" id="taxTab_iit" onclick="TaxUI.switchTab('iit')">${TAX_L('个人所得税扣缴', '個人所得稅扣繳', 'IIT Withholding')}</button>
                <button class="btn" id="taxTab_input" onclick="TaxUI.switchTab('input')">${TAX_L('基础资料录入', '基礎資料錄入', 'Base Data Entry')}</button>
                <div class="spacer"></div>
                <button class="btn btn-success" onclick="TaxUI.selfCheck()">🧪 ${TAX_L('自检异常用例', '自檢異常用例', 'Self-Check Cases')}</button>
            </div>
            <p style="color:#888;font-size:12px;margin:0 0 12px;">
                ${TAX_L('演示数据位于账套 <b>SZ</b>、期间 <b>202512</b>。若算税结果全为 0，请调整账套或期间。', '示範資料位於帳套 <b>SZ</b>、期間 <b>202512</b>。若算稅結果全為 0，請調整帳套或期間。', 'Demo data uses ledger <b>SZ</b>, period <b>202512</b>. If the tax result is all 0, adjust the ledger or period.')}
            </p>
            <div id="taxForm"></div>
            <div id="taxResult"></div>
            <div id="taxSelfCheck"></div>
        </div>`;
    TaxUI.switchTab('vat');
});

const TaxUI = {
    tab: 'vat',
    draft: {},

    switchTab(tab) {
        this.tab = tab;
        this.draft = {};
        ['vat', 'cit', 'iit', 'input'].forEach(k => {
            const b = document.getElementById('taxTab_' + k);
            if (b) b.className = k === tab ? 'btn btn-primary' : 'btn';
        });
        document.getElementById('taxResult').innerHTML = '';
        document.getElementById('taxSelfCheck').innerHTML = '';
        document.getElementById('taxForm').innerHTML = this['form_' + tab]();
        if (tab === 'vat') this.onVatCycleChange();
        if (tab === 'input') {
            this.loadVatInput();
            this.loadCitInput();
            this.loadPayroll();
            this.loadBonus();
        }
    },

    // ---------- 表單 ----------
    form_vat() {
        return `
            <div class="form-row">
                <div class="form-group"><label>${TAX_L('税款所属期 (YYYYMM)', '稅款所屬期 (YYYYMM)', 'Tax Period (YYYYMM)')}</label>
                    <input id="vatPeriod" value="${taxYmCompact()}" placeholder="${TAX_L('例：202512', '例：202512', 'e.g. 202512')}"></div>
                <div class="form-group"><label>${TAX_L('纳税人类型', '納稅人類型', 'Taxpayer Type')}</label>
                    <select id="vatType" onchange="TaxUI.onVatTypeChange()">
                        <option value="1">${TAX_L('1 - 一般纳税人', '1 - 一般納稅人', '1 - General Taxpayer')}</option>
                        <option value="2">${TAX_L('2 - 小规模纳税人', '2 - 小規模納稅人', '2 - Small-scale Taxpayer')}</option>
                    </select></div>
                <div class="form-group"><label>${TAX_L('申报周期', '申報週期', 'Filing Cycle')}</label>
                    <select id="vatCycle" onchange="TaxUI.onVatCycleChange()">
                        <option value="MONTHLY">${TAX_L('按月申报', '按月申報', 'Monthly')}</option>
                        <option value="QUARTERLY">${TAX_L('按季申报', '按季申報', 'Quarterly')}</option>
                    </select></div>
                <div class="form-group"><label>${TAX_L('账套 bu_no', '帳套 bu_no', 'Ledger bu_no')}</label>
                    <input id="vatBu" value="${State.bu_no || 'SZ'}"></div>
            </div>
            <p id="vatCycleHint" style="font-size:12px;color:#888;margin:0 0 10px;"></p>
            <button class="btn btn-primary" onclick="TaxUI.calcVat()">▶ ${TAX_L('开始算税', '開始算稅', 'Calculate Tax')}</button>`;
    },

    // 小規模納稅人預設按季申報；一般納稅人只能按月
    onVatTypeChange() {
        const type = val('vatType');
        const cycle = document.getElementById('vatCycle');
        if (type === '2') {
            cycle.value = 'QUARTERLY';
        } else {
            cycle.value = 'MONTHLY';
        }
        this.onVatCycleChange();
    },

    onVatCycleChange() {
        const cycle = val('vatCycle');
        const hint = document.getElementById('vatCycleHint');
        const isSmall = val('vatType') === '2';
        if (cycle === 'QUARTERLY') {
            // 季報所屬期取季末月（03/06/09/12）
            const p = val('vatPeriod');
            if (/^\d{6}$/.test(p)) {
                const month = Number(p.slice(4));
                const endMonth = Math.ceil(month / 3) * 3;
                setVal('vatPeriod', p.slice(0, 4) + String(endMonth).padStart(2, '0'));
            }
            hint.innerHTML = TAX_L('按季申报：系统将汇总该季度 3 个月的发票，所属期自动取季末月。', '按季申報：系統將彙總該季度 3 個月的發票，所屬期自動取季末月。', 'Quarterly: the system aggregates 3 months of invoices in the quarter; the period auto-sets to the quarter-end month.')
                + (isSmall ? TAX_L('季度销售额未超过 30 万元时免征增值税。', '季度銷售額未超過 30 萬元時免徵增值稅。', 'VAT is exempt when quarterly sales do not exceed CNY 300,000.') : '');
        } else {
            hint.textContent = TAX_L('按月申报：仅汇总所属期当月发票。', '按月申報：僅彙總所屬期當月發票。', 'Monthly: only invoices of the current period are aggregated.');
        }
    },

    form_cit() {
        return `
            <div class="form-row">
                <div class="form-group"><label>${TAX_L('纳税年度 (YYYY)', '納稅年度 (YYYY)', 'Tax Year (YYYY)')}</label>
                    <input id="citYear" value="${State.year()}" placeholder="${TAX_L('例：2025', '例：2025', 'e.g. 2025')}"></div>
                <div class="form-group"><label>${TAX_L('统一社会信用代码', '統一社會信用代碼', 'Unified Social Credit Code')}</label>
                    <input id="citIdNo" value="9144030071526726X1"></div>
                <div class="form-group"><label>${TAX_L('账套 bu_no', '帳套 bu_no', 'Ledger bu_no')}</label>
                    <input id="citBu" value="${State.bu_no || 'SZ'}"></div>
                <div class="form-group"><label>${TAX_L('纳税调整', '納稅調整', 'Tax Adjustment')}</label>
                    <select id="citAdj"><option value="1">${TAX_L('纳入', '納入', 'Include')}</option><option value="0">${TAX_L('不纳入', '不納入', 'Exclude')}</option></select></div>
            </div>
            <button class="btn btn-primary" onclick="TaxUI.calcCit()">▶ ${TAX_L('开始算税', '開始算稅', 'Calculate Tax')}</button>`;
    },

    form_iit() {
        return `
            <div class="form-row">
                <div class="form-group"><label>${TAX_L('税款所属期 (YYYYMM)', '稅款所屬期 (YYYYMM)', 'Tax Period (YYYYMM)')}</label>
                    <input id="iitPeriod" value="${taxYmCompact()}" placeholder="${TAX_L('例：202512', '例：202512', 'e.g. 202512')}"></div>
                <div class="form-group"><label>${TAX_L('所得类型', '所得類型', 'Income Type')}</label>
                    <select id="iitType">
                        <option value="SALARY">${TAX_L('工资薪金', '工資薪金', 'Salary')}</option>
                        <option value="LABOR_REMUNERATION">${TAX_L('劳务报酬', '勞務報酬', 'Labor Remuneration')}</option>
                        <option value="REMUNERATION_FOR_WRITING">${TAX_L('稿酬所得', '稿酬所得', 'Author Remuneration')}</option>
                    </select></div>
                <div class="form-group"><label>${TAX_L('账套 bu_no', '帳套 bu_no', 'Ledger bu_no')}</label>
                    <input id="iitBu" value="${State.bu_no || 'SZ'}"></div>
                <div class="form-group"><label>${TAX_L('指定员工（可选）', '指定員工（可選）', 'Specific Employees (Optional)')}</label>
                    <input id="iitEmps" placeholder="${TAX_L('逗号分隔，空白=全部', '逗號分隔，空白=全部', 'Comma-separated, blank = all')}"></div>
            </div>
            <button class="btn btn-primary" onclick="TaxUI.calcIit()">▶ ${TAX_L('开始算税', '開始算稅', 'Calculate Tax')}</button>

            <hr style="margin:18px 0;border:none;border-top:1px dashed #ddd;">
            <div style="padding:14px;background:#f8fafc;border:1px solid #e8edf3;border-radius:8px;">
                <h4 style="margin:0 0 6px;color:#336;">🎁 ${TAX_L('年终奖（全年一次性奖金）计算', '年終獎（全年一次性獎金）計算', 'Annual Bonus (One-time) Calculation')}</h4>
                <p style="font-size:12px;color:#666;margin:0 0 10px;">
                    ${TAX_L('税法允许选择「单独计税」（奖金 ÷ 12 找月度税率）或「合并计税」（并入综合所得）。请先在「基础资料录入 → 年终奖录入」区块填写每位员工的奖金金额，再回到此处选择计税方式。', '稅法允許選擇「單獨計稅」（獎金 ÷ 12 找月度稅率）或「合併計稅」（併入綜合所得）。請先在「基礎資料錄入 → 年終獎錄入」區塊填寫每位員工的獎金金額，再回到此處選擇計稅方式。', 'Tax law allows Separate taxation (bonus ÷ 12 for the monthly rate) or Combined taxation (merged into comprehensive income). First enter each employee bonus in Base Data Entry → Annual Bonus, then choose the method here.')}
                </p>
                <div class="form-row">
                    <div class="form-group"><label>${TAX_L('纳税年度 (YYYY)', '納稅年度 (YYYY)', 'Tax Year (YYYY)')}</label>
                        <input id="bonusYear" value="${State.year()}"></div>
                    <div class="form-group"><label>${TAX_L('账套 bu_no', '帳套 bu_no', 'Ledger bu_no')}</label>
                        <input id="bonusBu" value="${State.bu_no || 'SZ'}"></div>
                    <div class="form-group"><label>${TAX_L('计税方式', '計稅方式', 'Tax Method')}</label>
                        <select id="bonusMethod">
                            <option value="SEPARATE">${TAX_L('单独计税（推荐：奖金 ÷ 12 找月度税率）', '單獨計稅（推薦：獎金 ÷ 12 找月度稅率）', 'Separate (bonus ÷ 12 monthly rate, recommended)')}</option>
                            <option value="COMBINED">${TAX_L('合并计税（并入综合所得，累计预扣）', '合併計稅（併入綜合所得，累計預扣）', 'Combined (merged into income, cumulative withholding)')}</option>
                        </select></div>
                    <div class="form-group"><label>${TAX_L('指定员工（可选）', '指定員工（可選）', 'Specific Employees (Optional)')}</label>
                        <input id="bonusEmps" placeholder="${TAX_L('逗号分隔，空白=全部', '逗號分隔，空白=全部', 'Comma-separated, blank = all')}"></div>
                </div>
                <button class="btn btn-success" onclick="TaxUI.calcBonus()">💰 ${TAX_L('试算年终奖税额', '試算年終獎稅額', 'Calculate Bonus Tax')}</button>
            </div>`;
    },

    form_input() {
        return `
            <div style="padding:14px;border:1px solid #eee;border-radius:8px;margin-bottom:16px;">
                <h4 style="margin:0 0 4px;">① ${TAX_L('增值税调整', '增值稅調整', 'VAT Adjustment')}</h4>
                <p style="font-size:12px;color:#888;margin:0 0 10px;">
                    ${TAX_L('自动取数：销项／进项税额来自发票明细（mgm_invoice_details）。此处仅录入无法自动取得的人工调整。', '自動取數：銷項／進項稅額來自發票明細（mgm_invoice_details）。此處僅錄入無法自動取得的人工調整。', 'Auto source: output/input VAT comes from invoice details (mgm_invoice_details). Only manual adjustments that cannot be auto-fetched are entered here.')}
                </p>
                <div class="form-row">
                    <div class="form-group"><label>${TAX_L('税款所属期', '稅款所屬期', 'Tax Period')}</label><input id="inVatPeriod" value="${taxYmCompact()}"></div>
                    <div class="form-group"><label>${TAX_L('申报周期', '申報週期', 'Filing Cycle')}</label>
                        <select id="inVatCycle">
                            <option value="MONTHLY">${TAX_L('按月申报', '按月申報', 'Monthly')}</option>
                            <option value="QUARTERLY">${TAX_L('按季申报', '按季申報', 'Quarterly')}</option>
                        </select></div>
                    <div class="form-group"><label>${TAX_L('纳税人类型', '納稅人類型', 'Taxpayer Type')}</label>
                        <select id="inVatType">
                            <option value="1">${TAX_L('1 - 一般纳税人', '1 - 一般納稅人', '1 - General Taxpayer')}</option>
                            <option value="2">${TAX_L('2 - 小规模纳税人', '2 - 小規模納稅人', '2 - Small-scale Taxpayer')}</option>
                        </select></div>
                    <div class="form-group"><label>${TAX_L('账套 bu_no', '帳套 bu_no', 'Ledger bu_no')}</label><input id="inVatBu" value="${State.bu_no || 'SZ'}"></div>
                    <div class="form-group"><label>${TAX_L('进项税额转出', '進項稅額轉出', 'Input VAT Transfer-out')}</label><input id="inVatTransfer" value="0"></div>
                    <div class="form-group"><label>${TAX_L('上期留抵（留空=自动）', '上期留抵（留空=自動）', 'Prior Credit (blank = auto)')}</label><input id="inVatCredit" placeholder="${TAX_L('自动计算', '自動計算', 'Auto')}"></div>
                </div>
                <button class="btn btn-primary" onclick="TaxUI.saveVatInput()">💾 ${TAX_L('保存调整', '儲存調整', 'Save Adjustment')}</button>
                <button class="btn" onclick="TaxUI.loadReconcile()">📋 ${TAX_L('展开发票勾对清单', '展開發票勾對清單', 'Invoice Reconciliation List')}</button>
                <div id="inVatMsg" style="font-size:12px;color:#27ae60;margin-top:8px;"></div>
                <div id="inVatRecon"></div>
            </div>

            <div style="padding:14px;border:1px solid #eee;border-radius:8px;margin-bottom:16px;">
                <h4 style="margin:0 0 4px;">② ${TAX_L('企业所得税汇算参数', '企業所得稅匯算參數', 'CIT Settlement Parameters')}</h4>
                <p style="font-size:12px;color:#888;margin:0 0 10px;">
                    ${TAX_L('自动取数：收入／成本来自财报（mgm_finance_summary）。若财报与税务口径差异大，可勾选下方覆盖。', '自動取數：收入／成本來自財報（mgm_finance_summary）。若財報與稅務口徑差異大，可勾選下方覆蓋。', 'Auto source: revenue/cost comes from financials (mgm_finance_summary). If financial vs tax basis differs greatly, use the overrides below.')}
                </p>
                <div class="form-row">
                    <div class="form-group"><label>${TAX_L('纳税年度', '納稅年度', 'Tax Year')}</label><input id="inCitYear" value="${State.year()}"></div>
                    <div class="form-group"><label>${TAX_L('账套 bu_no', '帳套 bu_no', 'Ledger bu_no')}</label><input id="inCitBu" value="${State.bu_no || 'SZ'}"></div>
                    <div class="form-group"><label>${TAX_L('适用税率（0.25=25%）', '適用稅率（0.25=25%）', 'Tax Rate (0.25=25%)')}</label><input id="inCitRate" value="0.25"></div>
                    <div class="form-group"><label>${TAX_L('累计已预缴', '累計已預繳', 'Accumulated Prepaid')}</label><input id="inCitPaid" value="0"></div>
                    <div class="form-group"><label>${TAX_L('境外已缴（可抵免）', '境外已繳（可抵免）', 'Foreign Tax Paid (Creditable)')}</label><input id="inCitWithheld" value="0"></div>
                </div>

                <div style="margin:14px 0 6px;padding:10px;background:#fff8f0;border:1px dashed #e5b47c;border-radius:6px;">
                    <div style="font-size:13px;font-weight:600;color:#8a5a10;margin-bottom:6px;">💰 ${TAX_L('收入 / 成本人工覆盖（留空=自动取财报）', '收入 / 成本人工覆蓋（留空=自動取財報）', 'Manual Revenue / Cost Override (blank = auto from financials)')}</div>
                    <div style="font-size:12px;color:#888;margin-bottom:8px;" id="citAutoHint">${TAX_L('自动载入中…', '自動載入中…', 'Loading…')}</div>
                    <div class="form-row">
                        <div class="form-group"><label>${TAX_L('营业收入覆盖', '營業收入覆蓋', 'Revenue Override')}</label>
                            <input id="inCitRevOverride" placeholder="${TAX_L('留空=用财报自动值', '留空=用財報自動值', 'Blank = financial auto value')}"></div>
                        <div class="form-group"><label>${TAX_L('营业成本覆盖', '營業成本覆蓋', 'Cost Override')}</label>
                            <input id="inCitCostOverride" placeholder="${TAX_L('留空=用财报自动值', '留空=用財報自動值', 'Blank = financial auto value')}"></div>
                        <div class="form-group" style="flex:1;"><label>${TAX_L('覆盖原因', '覆蓋原因', 'Override Reason')}</label>
                            <input id="inCitOverrideReason" placeholder="${TAX_L('审计轨迹，可选', '審計軌跡，可選', 'Audit trail, optional')}"></div>
                    </div>
                </div>
                <div style="margin:10px 0 6px;font-size:13px;color:#555;">${TAX_L('纳税调整明细', '納稅調整明細', 'Tax Adjustment Details')}</div>
                <div id="citAdjRows"></div>
                <div style="margin-top:8px;">
                    <button class="btn" onclick="TaxUI.addCitAdj()">＋ ${TAX_L('新增调整项', '新增調整項', 'Add Item')}</button>
                    <button class="btn btn-primary" onclick="TaxUI.saveCitInput()">💾 ${TAX_L('保存汇算参数', '儲存匯算參數', 'Save Settlement Parameters')}</button>
                </div>
                <div id="inCitMsg" style="font-size:12px;color:#27ae60;margin-top:8px;"></div>
            </div>

            <div style="padding:14px;border:1px solid #eee;border-radius:8px;">
                <h4 style="margin:0 0 4px;">③ ${TAX_L('工资及个税扣除明细', '工資及個稅扣除明細', 'Payroll & IIT Deduction Details')}</h4>
                <p style="font-size:12px;color:#888;margin:0 0 10px;">
                    ${TAX_L('自动取数：无薪资表时系统以财报平均工资估算。欲按真实名单计税，请逐人录入本期收入与扣除。', '自動取數：無薪資表時系統以財報平均工資估算。欲按真實名單計稅，請逐人錄入本期收入與扣除。', 'Auto source: without a payroll table the system estimates by average salary from financials. For per-person taxation, enter income and deductions for each employee.')}
                </p>
                <div class="form-row">
                    <div class="form-group"><label>${TAX_L('所属期 (YYYY-MM)', '所屬期 (YYYY-MM)', 'Period (YYYY-MM)')}</label><input id="inPayPeriod" value="${taxYmDash()}"></div>
                    <div class="form-group"><label>${TAX_L('账套 bu_no', '帳套 bu_no', 'Ledger bu_no')}</label><input id="inPayBu" value="${State.bu_no || 'SZ'}"></div>
                    <div class="form-group"><label>${TAX_L('员工编号', '員工編號', 'Employee ID')}</label><input id="inPayEmp" placeholder="${TAX_L('例：U0001', '例：U0001', 'e.g. U0001')}"></div>
                    <div class="form-group"><label>${TAX_L('姓名', '姓名', 'Name')}</label><input id="inPayName"></div>
                    <div class="form-group"><label>${TAX_L('应发工资', '應發工資', 'Gross Salary')}</label><input id="inPayGross" value="0"></div>
                    <div class="form-group"><label>${TAX_L('三险一金', '三險一金', 'Social Insurance')}</label><input id="inPaySocial" value="0"></div>
                    <div class="form-group"><label>${TAX_L('专项附加扣除', '專項附加扣除', 'Special Deductions')}</label><input id="inPaySpecial" value="0"></div>
                    <div class="form-group"><label>${TAX_L('其他扣除', '其他扣除', 'Other Deductions')}</label><input id="inPayOther" value="0"></div>
                </div>
                <button class="btn btn-primary" onclick="TaxUI.savePayroll()">💾 ${TAX_L('保存此员工', '儲存此員工', 'Save Employee')}</button>
                <div id="inPayMsg" style="font-size:12px;color:#27ae60;margin-top:8px;"></div>
                <div id="payList" style="margin-top:12px;"></div>
            </div>

            <div style="padding:14px;border:1px solid #eee;border-radius:8px;margin-top:16px;">
                <h4 style="margin:0 0 4px;">④ ${TAX_L('年终奖（全年一次性奖金）录入', '年終獎（全年一次性獎金）錄入', 'Annual Bonus (One-time) Entry')}</h4>
                <p style="font-size:12px;color:#888;margin:0 0 10px;">
                    ${TAX_L('每位员工录入一条年终奖，并选择 <b>单独计税</b> 或 <b>合并计税</b>。单独计税按「奖金 ÷ 12 找月度税率表」计算；合并计税并入综合所得。', '每位員工錄入一條年終獎，並選擇 <b>單獨計稅</b> 或 <b>合併計稅</b>。單獨計稅按「獎金 ÷ 12 找月度稅率表」計算；合併計稅併入綜合所得。', 'Enter one annual bonus per employee and choose <b>Separate</b> or <b>Combined</b> taxation. Separate: monthly rate table via bonus ÷ 12; Combined: merged into comprehensive income.')}
                </p>
                <div class="form-row">
                    <div class="form-group"><label>${TAX_L('纳税年度', '納稅年度', 'Tax Year')}</label><input id="inBonusYear" value="${State.year()}"></div>
                    <div class="form-group"><label>${TAX_L('账套 bu_no', '帳套 bu_no', 'Ledger bu_no')}</label><input id="inBonusBu" value="${State.bu_no || 'SZ'}"></div>
                    <div class="form-group"><label>${TAX_L('员工编号', '員工編號', 'Employee ID')}</label><input id="inBonusEmp" placeholder="${TAX_L('例：U0001', '例：U0001', 'e.g. U0001')}"></div>
                    <div class="form-group"><label>${TAX_L('姓名', '姓名', 'Name')}</label><input id="inBonusName"></div>
                    <div class="form-group"><label>${TAX_L('奖金金额', '獎金金額', 'Bonus Amount')}</label><input id="inBonusAmount" value="0"></div>
                    <div class="form-group"><label>${TAX_L('计税方式', '計稅方式', 'Tax Method')}</label>
                        <select id="inBonusMethod">
                            <option value="SEPARATE">${TAX_L('单独计税（月度税率）', '單獨計稅（月度稅率）', 'Separate (monthly rate)')}</option>
                            <option value="COMBINED">${TAX_L('合并计税（并入综合所得）', '合併計稅（併入綜合所得）', 'Combined (merged into income)')}</option>
                        </select></div>
                    <div class="form-group" style="flex:1;"><label>${TAX_L('备注', '備註', 'Remark')}</label><input id="inBonusRemark" placeholder="${TAX_L('可选', '可選', 'Optional')}"></div>
                </div>
                <button class="btn btn-primary" onclick="TaxUI.saveBonus()">💾 ${TAX_L('保存年终奖', '儲存年終獎', 'Save Bonus')}</button>
                <button class="btn" onclick="TaxUI.loadBonus()">🔄 ${TAX_L('重新载入', '重新載入', 'Reload')}</button>
                <div id="inBonusMsg" style="font-size:12px;color:#27ae60;margin-top:8px;"></div>
                <div id="bonusList" style="margin-top:12px;"></div>
            </div>`;
    },

    // ---------- 算稅 ----------
    async calcVat() {
        const body = {
            taxPeriod: val('vatPeriod'),
            taxpayerType: Number(val('vatType')),
            filingCycle: val('vatCycle') || 'MONTHLY',
            bu_no: val('vatBu')
        };
        try {
            const res = await API.post('/api/tax/vat/calculate', body);
            this.draft = res.data || {};
            this.draft._params = body;   // 留存查詢參數供明細鑽取
            document.getElementById('taxResult').innerHTML = this.renderVat(this.draft);
            UI.toast(res.message || TAX_L('算税完成', '算稅完成', 'Tax calculated'), 'success');
        } catch (e) {
            document.getElementById('taxResult').innerHTML =
                `<p style="color:#e74c3c;margin-top:12px;">✘ ${esc(e.message)}</p>`;
        }
    },

    async calcCit() {
        const body = {
            taxYear: val('citYear'),
            taxpayerIdentNo: val('citIdNo'),
            includeAdjustments: val('citAdj') === '1',
            bu_no: val('citBu')
        };
        try {
            const res = await API.post('/api/tax/cit/calculate', body);
            this.draft = res.data || {};
            document.getElementById('taxResult').innerHTML = this.renderCit(this.draft);
            UI.toast(res.message || TAX_L('算税完成', '算稅完成', 'Tax calculated'), 'success');
        } catch (e) {
            document.getElementById('taxResult').innerHTML =
                `<p style="color:#e74c3c;margin-top:12px;">✘ ${esc(e.message)}</p>`;
        }
    },

    async calcIit() {
        const emps = val('iitEmps').split(',').map(s => s.trim()).filter(Boolean);
        const body = {
            taxPeriod: val('iitPeriod'),
            incomeType: val('iitType'),
            bu_no: val('iitBu')
        };
        if (emps.length) body.employeeIds = emps;
        try {
            const res = await API.post('/api/tax/iit/calculate', body);
            this.draft = res.data || {};
            document.getElementById('taxResult').innerHTML = this.renderIit(this.draft);
            UI.toast(res.message || TAX_L('算税完成', '算稅完成', 'Tax calculated'), 'success');
        } catch (e) {
            document.getElementById('taxResult').innerHTML =
                `<p style="color:#e74c3c;margin-top:12px;">✘ ${esc(e.message)}</p>`;
        }
    },

    async calcBonus() {
        const emps = val('bonusEmps').split(',').map(s => s.trim()).filter(Boolean);
        const body = {
            bu_no: val('bonusBu'),
            taxYear: val('bonusYear'),
            taxMethod: val('bonusMethod')
        };
        if (emps.length) body.employeeIds = emps;
        try {
            const res = await API.post('/api/tax/iit/bonus/calculate', body);
            this.draft = res.data || {};
            document.getElementById('taxResult').innerHTML = this.renderBonus(this.draft);
            UI.toast(res.message || TAX_L('年终奖试算完成', '年終獎試算完成', 'Bonus tax calculated'), 'success');
        } catch (e) {
            document.getElementById('taxResult').innerHTML =
                `<p style="color:#e74c3c;margin-top:12px;">✘ ${esc(e.message)}</p>`;
        }
    },

    // ---------- 結果畫面 ----------
    renderVat(d) {
        const s = d.surcharges || {};
        const calcPayable = round2(d.totalOutputTax - d.totalInputTax - (d.prevPeriodCredit || 0));
        const okPayable = near(calcPayable, d.taxPayable);
        const okUrban = near(round2(d.taxPayable * 0.07), s.urbanMaintenance);
        const okEdu = near(round2(d.taxPayable * 0.03), s.educationSurcharge);
        const okLocal = near(round2(d.taxPayable * 0.02), s.localEducationSurcharge);
        const allOk = okPayable && okUrban && okEdu && okLocal;

        return `
            <div style="margin-top:16px;padding:16px;background:#fafafa;border:1px solid #eee;border-radius:8px;">
                <h4 style="margin:0 0 6px;">${TAX_L('算税结果', '算稅結果', 'Tax Calculation Result')} <span style="font-size:12px;color:#888;">${TAX_L('申报单号：', '申報單號：', 'Declaration No.: ')}${esc(d.declarationId || '-')}</span></h4>
                <div style="font-size:12px;color:#666;margin-bottom:10px;">
                    ${TAX_L('申报周期：', '申報週期：', 'Filing Cycle: ')}<b>${d.filingCycle === 'QUARTERLY' ? TAX_L('按季申报', '按季申報', 'Quarterly') : TAX_L('按月申报', '按月申報', 'Monthly')}</b>
                    ${d.periodStart && d.periodEnd && d.periodStart !== d.periodEnd
                        ? `　${TAX_L('税款所属期：', '稅款所屬期：', 'Tax Period: ')}<b>${esc(d.periodStart)} ~ ${esc(d.periodEnd)}</b>` : ''}
                </div>
                ${d.taxExempt ? `<div style="padding:10px;border-radius:6px;background:#eef4ff;color:#2c5fa8;font-size:12px;margin-bottom:10px;">
                    ⓘ ${esc(d.exemptReason || TAX_L('本期免征增值税', '本期免徵增值稅', 'VAT exempt this period'))}</div>` : ''}
                <table class="data-table">
                    <tbody>
                        ${rowLink(TAX_L('销售额合计', '銷售額合計', 'Total Sales'), money(d.totalSalesAmt), "TaxUI.showVatDetail('sales')")}
                        ${rowLink(TAX_L('销项税额', '銷項稅額', 'Output VAT'), money(d.totalOutputTax), "TaxUI.showVatDetail('sales')")}
                        ${Number(d.inputTaxTransferOut || 0) > 0 ? row(TAX_L('进项税额转出', '進項稅額轉出', 'Input VAT Transfer-out'), money(d.inputTaxTransferOut)) : ''}
                        ${rowLink(TAX_L('进项税额（可抵扣）', '進項稅額（可抵扣）', 'Input VAT (Deductible)'), money(d.totalInputTax), "TaxUI.showVatDetail('purchase')")}
                        ${rowLink(TAX_L('上期留抵税额', '上期留抵稅額', 'Prior Period Credit'), money(d.prevPeriodCredit), "TaxUI.showVatDetail('credit')")}
                        ${row(TAX_L('应纳税额', '應納稅額', 'VAT Payable'), money(d.taxPayable), true)}
                        ${row(TAX_L('城建税 (7%)', '城建稅 (7%)', 'Urban Maintenance Tax (7%)'), money(s.urbanMaintenance))}
                        ${row(TAX_L('教育费附加 (3%)', '教育費附加 (3%)', 'Education Surcharge (3%)'), money(s.educationSurcharge))}
                        ${row(TAX_L('地方教育附加 (2%)', '地方教育附加 (2%)', 'Local Education Surcharge (2%)'), money(s.localEducationSurcharge))}
                        ${row(TAX_L('税负合计', '稅負合計', 'Total Tax Burden'), money(round2(Number(d.taxPayable) + Number(s.urbanMaintenance || 0)
                            + Number(s.educationSurcharge || 0) + Number(s.localEducationSurcharge || 0))), true)}
                    </tbody>
                </table>

                <div style="margin-top:12px;padding:12px;border-radius:8px;background:${allOk ? '#eef9f0' : '#fdecec'};">
                    <b>${allOk ? TAX_L('✔ 计算式核对通过', '✔ 計算式核對通過', '✔ Formula check passed') : TAX_L('✘ 计算式核对失败', '✘ 計算式核對失敗', '✘ Formula check failed')}</b>
                    <div style="font-size:12px;margin-top:6px;">
                        ${TAX_L('VAT_R02 应纳税额', 'VAT_R02 應納稅額', 'VAT_R02 VAT Payable')} = ${money(d.totalOutputTax)} − ${money(d.totalInputTax)} − ${money(d.prevPeriodCredit)} = <b>${money(calcPayable)}</b> ${okPayable ? '✔' : '✘'}<br>
                        ${TAX_L('VAT_R03 城建', 'VAT_R03 城建', 'VAT_R03 Urban')} = ${money(d.taxPayable)} × 7% = ${money(round2(d.taxPayable * 0.07))} ${okUrban ? '✔' : '✘'}；
                        ${TAX_L('教育', '教育', 'Education')} = ${money(round2(d.taxPayable * 0.03))} ${okEdu ? '✔' : '✘'}；
                        ${TAX_L('地方教育', '地方教育', 'Local Education')} = ${money(round2(d.taxPayable * 0.02))} ${okLocal ? '✔' : '✘'}
                    </div>
                </div>

                <div style="margin-top:12px;">
                    <button class="btn btn-primary" onclick="TaxUI.submitVat()">📤 ${TAX_L('提交税局申报', '提交稅局申報', 'Submit to Tax Bureau')}</button>
                </div>
                <div id="taxReceipt"></div>
            </div>`;
    },

    // ---------- VAT 欄位明細鑽取 ----------
    // kind: sales(銷項發票) / purchase(進項發票) / credit(上期留抵說明)
    async showVatDetail(kind) {
        const p = (this.draft && this.draft._params) || {};
        if (!p.taxPeriod) return UI.toast(TAX_L('请先算税', '請先算稅', 'Please calculate tax first'), 'error');
        UI.modal(TAX_L('载入中…', '載入中…', 'Loading…'), `<div style="text-align:center;padding:24px;color:#888;">${TAX_L('读取明细资料…', '讀取明細資料…', 'Loading details…')}</div>`);
        try {
            const res = await API.get('/api/tax/vat/reconcile?bu_no=' +
                encodeURIComponent(p.bu_no) + '&taxPeriod=' + encodeURIComponent(p.taxPeriod) +
                '&filingCycle=' + (p.filingCycle || 'MONTHLY') +
                '&taxpayerType=' + (p.taxpayerType || 1));
            const d = res.data || {};
            const all = d.invoices || [];

            if (kind === 'credit') {
                // 上期留抵：顯示來源說明（人工覆蓋 or 上期結轉）
                let overrideInfo = null;
                try {
                    const r2 = await API.get('/api/tax/inputs/vat?bu_no=' +
                        encodeURIComponent(p.bu_no) + '&taxPeriod=' + encodeURIComponent(p.taxPeriod));
                    overrideInfo = r2.data || {};
                } catch (e) { /* 無人工調整記錄 */ }
                const ov = overrideInfo && overrideInfo.prev_credit_override != null
                    ? `<tr><td style="color:#666;">${TAX_L('人工覆盖值', '人工覆蓋值', 'Manual Override')}</td><td class="num"><b>${money(overrideInfo.prev_credit_override)}</b>${TAX_L('（基础资料录入 → 增值税调整）', '（基礎資料錄入 → 增值稅調整）', ' (Base Data Entry → VAT Adjustment)')}</td></tr>`
                    : `<tr><td style="color:#666;">${TAX_L('人工覆盖值', '人工覆蓋值', 'Manual Override')}</td><td>${TAX_L('未设定（系统自动由上期应纳税额 &lt; 0 结转）', '未設定（系統自動由上期應納稅額 &lt; 0 結轉）', 'Not set (auto carried forward when prior payable &lt; 0)')}</td></tr>`;
                UI.modal(TAX_L('上期留抵税额 · 来源说明', '上期留抵稅額 · 來源說明', 'Prior Period Credit · Source'), `
                    <p style="font-size:13px;color:#555;line-height:1.8;">
                        ${TAX_L('本期留抵税额', '本期留抵稅額', 'Current credit')} <b>${money(this.draft.prevPeriodCredit)}</b>${TAX_L(' 的取数逻辑：<br>① 若「基础资料录入 → 增值税调整」有填写上期留抵覆盖值，优先采用；<br>② 否则自动查找上一申报期间的申报表，其「应纳税额」若为负数（进项大于销项），差额即结转为本期留抵。', ' 的取數邏輯：<br>① 若「基礎資料錄入 → 增值稅調整」有填寫上期留抵覆蓋值，優先採用；<br>② 否則自動查找上一申報期間的申報表，其「應納稅額」若為負數（進項大於銷項），差額即結轉為本期留抵。', ' derivation logic:<br>1. If a prior-credit override is set in Base Data Entry → VAT Adjustment, it takes precedence;<br>2. Otherwise the system looks up the previous filing; if its VAT payable is negative (input exceeds output), the difference carries forward as this period credit.')}
                    </p>
                    <table class="data-table"><tbody>${ov}
                        <tr><td style="color:#666;">${TAX_L('本期采用值', '本期採用值', 'Value Applied')}</td><td class="num"><b>${money(this.draft.prevPeriodCredit)}</b></td></tr>
                    </tbody></table>`, '');
                return;
            }

            const isSales = kind === 'sales';
            const rows = all.filter(r => (r.TX_type === 'AR') === isSales);
            const smallScale = String(p.taxpayerType) === '2';   // 小規模納稅人：按徵收率計稅、進項不可抵扣
            // 小規模：銷項按徵收率重算展示（與算稅引擎同口徑，稅率源自 TAX_TYPE/IIT 碼表）
            const levyRate = smallScale
                ? (Number(this.draft.totalSalesAmt) > 0
                    ? Number(this.draft.totalOutputTax) / Number(this.draft.totalSalesAmt) : 0.03)
                : 0;
            const levyPct = (levyRate * 100).toFixed(levyRate * 100 % 1 === 0 ? 0 : 2);
            const dispTax = (r) => {
                if (!isSales && smallScale) return 0;                       // 進項不可抵扣
                if (smallScale) return Number(r.sub_amt || 0) * levyRate;   // 銷項按徵收率
                return Number(r.VAT_amt || 0);
            };
            const sumAmt = round2(rows.reduce((s, r) => s + Number(r.sub_amt || 0), 0));
            // 合計稅額以算稅結果為準（官方口徑），避免逐行四捨五入造成尾差
            const sumTax = smallScale
                ? (isSales ? Number(this.draft.totalOutputTax || 0) : 0)
                : round2(rows.reduce((s, r) => s + Number(r.VAT_amt || 0), 0));
            const title = isSales ? TAX_L('销项发票明细（销售额 / 销项税额）', '銷項發票明細（銷售額 / 銷項稅額）', 'Output Invoice Details (Sales / Output VAT)') : TAX_L('进项发票明细（可抵扣进项税额）', '進項發票明細（可抵扣進項稅額）', 'Input Invoice Details (Deductible Input VAT)');
            const note = smallScale
                ? (isSales
                    ? `<div style="font-size:12px;color:#b45309;background:#fef3c7;border-radius:6px;padding:8px 10px;margin-bottom:8px;">⚠ ${TAX_L('小规模纳税人：销项按 <b>', '小規模納稅人：銷項按 <b>', 'Small-scale taxpayer: output taxed at <b>')}${levyPct}% ${TAX_L('征收率</b>计税（不适用一般纳税人税率），下表税额栏为按征收率试算值，合计以算税结果为准。', '徵收率</b>計稅（不適用一般納稅人稅率），下表稅額欄為按徵收率試算值，合計以算稅結果為準。', 'levy rate</b>; general taxpayer rates do not apply; tax column below shows levy-rate estimates; totals follow the tax result.')}</div>`
                    : `<div style="font-size:12px;color:#b45309;background:#fef3c7;border-radius:6px;padding:8px 10px;margin-bottom:8px;">⚠ ${TAX_L('小规模纳税人：<b>进项税额不可抵扣</b>，下表税额栏以 0 展示。', '小規模納稅人：<b>進項稅額不可抵扣</b>，下表稅額欄以 0 展示。', 'Small-scale taxpayer: <b>input VAT is not deductible</b>; tax column below shows 0.')}</div>`)
                : '';
            const body = rows.length ? `
                ${note}
                <div style="font-size:12px;color:#666;margin-bottom:8px;">
                    ${TAX_L('所属期间：', '所屬期間：', 'Periods: ')}<b>${esc((d.periods || []).join(', ') || p.taxPeriod)}</b>${TAX_L('　共 ', '　共 ', '　Total: ')}<b>${rows.length}</b>${TAX_L(' 张', ' 張', ' invoices')}
                </div>
                <div style="max-height:340px;overflow:auto;">
                    <table class="data-table">
                        <thead><tr><th>${TAX_L('发票号', '發票號', 'Invoice No.')}</th><th>${TAX_L('日期', '日期', 'Date')}</th><th>${TAX_L('对方单位', '對方單位', 'Counterparty')}</th><th class="num">${TAX_L('不含税金额', '不含稅金額', 'Net Amount')}</th><th class="num">${TAX_L('税率', '稅率', 'Tax Rate')}</th><th class="num">${TAX_L('税额', '稅額', 'Tax Amount')}</th></tr></thead>
                        <tbody>${rows.map(r => `<tr>
                            <td>${esc(r.invoice_no || '-')}</td>
                            <td>${esc(String(r.invoice_date || r.YMD || '-').substring(0, 10))}</td>
                            <td>${esc(r.cust_name || r.supplier_name || r.counterparty || '-')}</td>
                            <td class="num">${money(r.sub_amt)}</td>
                            <td class="num">${smallScale ? (isSales ? `${levyPct}%${TAX_L('（征收率）', '（徵收率）', ' (levy rate)')}` : TAX_L('不可抵扣', '不可抵扣', 'Not deductible')) : esc(r.tax_rate)}</td>
                            <td class="num">${money(dispTax(r))}</td>
                        </tr>`).join('')}</tbody>
                        <tfoot><tr style="font-weight:700;background:#eaf2f8;">
                            <td colspan="3">${TAX_L('合计', '合計', 'Total')}</td>
                            <td class="num">${money(sumAmt)}</td><td></td>
                            <td class="num">${money(sumTax)}</td>
                        </tr></tfoot>
                    </table>
                </div>` : `<p style="color:#888;padding:16px 0;">${TAX_L('本期间无', '本期間無', 'No ')}${isSales ? TAX_L('销项', '銷項', 'output') : TAX_L('进项', '進項', 'input')}${TAX_L('发票资料', '發票資料', ' invoice data in this period')}</p>`;
            UI.modal(title, body, '');
        } catch (e) {
            UI.modal(TAX_L('明细载入失败', '明細載入失敗', 'Failed to Load Details'), `<p style="color:#e74c3c;">✘ ${esc(e.message)}</p>`, '');
        }
    },

    renderCit(d) {
        const expected = round2(Number(d.totalRevenue) - Number(d.totalCost));
        const diff = round2(Number(d.taxableIncome) - expected);
        const overrideHint = d.isOverridden
            ? `<div style="padding:8px;border-radius:6px;background:#fff8f0;color:#8a5a10;font-size:12px;margin-bottom:8px;">
                   ⚠ ${TAX_L('本次计算使用了<b>人工覆盖的收入/成本</b>（而非财报自动汇总值）', '本次計算使用了<b>人工覆蓋的收入/成本</b>（而非財報自動匯總值）', 'This calculation used <b>manually overridden revenue/cost</b> (not financial auto values)')}</div>`
            : '';
        return `
            <div style="margin-top:16px;padding:16px;background:#fafafa;border:1px solid #eee;border-radius:8px;">
                <h4 style="margin:0 0 6px;">${TAX_L('汇算结果', '匯算結果', 'CIT Settlement Result')} <span style="font-size:12px;color:#888;">${TAX_L('汇算单号：', '匯算單號：', 'Settlement No.: ')}${esc(d.settlementId || '-')}</span></h4>
                ${overrideHint}
                <table class="data-table">
                    <tbody>
                        ${row(TAX_L('收入总额', '收入總額', 'Total Revenue'), money(d.totalRevenue))}
                        ${row(TAX_L('成本费用', '成本費用', 'Cost & Expenses'), money(d.totalCost))}
                        ${row(TAX_L('纳税调整后所得', '納稅調整後所得', 'Adjusted Taxable Income'), money(d.taxableIncome), true)}
                        ${row(TAX_L('应纳所得税额', '應納所得稅額', 'CIT Payable'), money(d.taxPayable), true)}
                        ${row(TAX_L('累计已预缴', '累計已預繳', 'Accumulated Prepaid'), money(d.accumPrepaidTax))}
                        ${row(TAX_L('补(退)税额', '補(退)稅額', 'Supplement / Refund'), money(d.refundOrSupplement), true)}
                    </tbody>
                </table>
                <div style="margin-top:12px;padding:12px;border-radius:8px;background:#fff8e6;font-size:12px;">
                    CIT_R01 ${TAX_L('参考核对：收入', '參考核對：收入', 'Check: revenue')} ${money(d.totalRevenue)} − ${TAX_L('成本', '成本', 'cost')} ${money(d.totalCost)} = ${money(expected)}${TAX_L('，实际纳税调整后所得', '，實際納稅調整後所得', ', actual adjusted income')} ${money(d.taxableIncome)}${TAX_L('，差额', '，差額', ', difference')} ${money(diff)}
                    ${near(diff, 0) ? TAX_L('（无调整）', '（無調整）', '(no adjustment)') : TAX_L('（含纳税调整，属正常）', '（含納稅調整，屬正常）', '(with adjustments, normal)')}
                </div>
                <div style="margin-top:12px;">
                    <button class="btn btn-primary" onclick="TaxUI.submitCit()">📤 ${TAX_L('提交税局申报', '提交稅局申報', 'Submit to Tax Bureau')}</button>
                </div>
                <div id="taxReceipt"></div>
            </div>`;
    },

    renderIit(d) {
        const rows = (d.employeeDetails || []);
        return `
            <div style="margin-top:16px;padding:16px;background:#fafafa;border:1px solid #eee;border-radius:8px;">
                <h4 style="margin:0 0 12px;">${TAX_L('扣缴结果', '扣繳結果', 'IIT Withholding Result')} <span style="font-size:12px;color:#888;">${TAX_L('批次号：', '批次號：', 'Batch No.: ')}${esc(d.withholdingBatchId || '-')}</span></h4>
                <table class="data-table">
                    <tbody>
                        ${row(TAX_L('员工人数', '員工人數', 'Employees'), d.totalEmployees || 0)}
                        ${row(TAX_L('代扣税额合计', '代扣稅額合計', 'Total Withheld Tax'), money(d.totalWithheldTax), true)}
                    </tbody>
                </table>
                ${rows.length ? `
                    <div style="max-height:320px;overflow:auto;margin-top:12px;">
                        <table class="data-table">
                            <thead><tr><th>${TAX_L('员工编号', '員工編號', 'Employee ID')}</th><th>${TAX_L('累计收入', '累計收入', 'Cumulative Income')}</th><th>${TAX_L('累计扣除', '累計扣除', 'Cumulative Deductions')}</th><th>${TAX_L('本期税额', '本期稅額', 'Current Period Tax')}</th></tr></thead>
                            <tbody>${rows.slice(0, 100).map(e => `<tr>
                                <td>${esc(e.employeeId)}</td>
                                <td class="num">${money(e.cumulativeIncome)}</td>
                                <td class="num">${money(e.cumulativeDeduction)}</td>
                                <td class="num">${money(e.currentPeriodTax)}</td>
                            </tr>`).join('')}</tbody>
                        </table>
                    </div>
                    ${rows.length > 100 ? `<p style="font-size:12px;color:#888;">${TAX_L('仅显示前 100 笔，共', '僅顯示前 100 筆，共', 'Showing first 100 of')} ${rows.length} ${TAX_L('笔', '筆', '')}</p>` : ''}
                ` : `<p style="color:#888;">${TAX_L('无扣缴明细', '無扣繳明細', 'No withholding details')}</p>`}
                <div style="margin-top:12px;">
                    <button class="btn btn-primary" onclick="TaxUI.submitIit()">📤 ${TAX_L('提交扣缴申报', '提交扣繳申報', 'Submit Withholding Filing')}</button>
                </div>
                <div id="taxReceipt"></div>
            </div>`;
    },

    renderBonus(d) {
        const rows = (d.employeeDetails || []);
        const methodLabel = d.taxMethod === 'SEPARATE'
            ? TAX_L('单独计税（奖金 ÷ 12 → 月度税率表）', '單獨計稅（獎金 ÷ 12 → 月度稅率表）', 'Separate (bonus ÷ 12 → monthly rate table)')
            : TAX_L('合并计税（并入综合所得）', '合併計稅（併入綜合所得）', 'Combined (merged into comprehensive income)');
        // 反算驗證
        let calcOk = true, mismatch = '';
        let expectedTotal = 0;
        for (const r of rows) {
            const monthly = Number(r.bonusAmount || 0) / 12;
            // 手查表：用前端靜態月度稅率表
            const brackets = [
                [3000, 0.03, 0], [12000, 0.10, 210], [25000, 0.20, 1410],
                [35000, 0.25, 2660], [55000, 0.30, 4410], [80000, 0.35, 7160],
                [Infinity, 0.45, 15160]
            ];
            const [, rate, quick] = brackets.find(([m]) => monthly <= m);
            const expTax = round2(Number(r.bonusAmount) * rate - quick);
            expectedTotal += expTax;
            if (!near(expTax, Number(r.bonusTax))) {
                calcOk = false;
                mismatch = `${r.employeeId}: expect ${money(expTax)} got ${money(r.bonusTax)}`;
            }
        }
        return `
            <div style="margin-top:16px;padding:16px;background:#fff8f0;border:1px solid #f3d8a5;border-radius:8px;">
                <h4 style="margin:0 0 6px;">🎁 ${TAX_L('年终奖试算结果', '年終獎試算結果', 'Annual Bonus Trial Result')}
                    <span style="font-size:12px;color:#888;">${TAX_L('批次号：', '批次號：', 'Batch No.: ')}${esc(d.bonusBatchId || '-')}</span>
                </h4>
                <div style="font-size:12px;color:#666;margin-bottom:10px;">
                    ${TAX_L('计税方式：', '計稅方式：', 'Tax Method: ')}<b>${methodLabel}</b>
                    ${d.employeeDetails.length === 0 ? TAX_L('（年度内无该方式的年终奖录入，请先到基础资料录入区填写）', '（年度內無該方式的年終獎錄入，請先到基礎資料錄入區填寫）', '(No bonus entries of this method this year; enter them in Base Data Entry first)') : ''}
                </div>
                <table class="data-table">
                    <tbody>
                        ${row(TAX_L('员工人数', '員工人數', 'Employees'), d.employeeDetails.length)}
                        ${row(TAX_L('奖金总额', '獎金總額', 'Total Bonus'), money(d.totalBonus))}
                        ${row(TAX_L('应扣税额合计', '應扣稅額合計', 'Total Tax Withheld'), money(d.totalWithheldTax), true)}
                    </tbody>
                </table>

                ${rows.length ? `
                    <div style="max-height:320px;overflow:auto;margin-top:12px;">
                        <table class="data-table">
                            <thead><tr>
                                <th>${TAX_L('员工编号', '員工編號', 'Employee ID')}</th><th>${TAX_L('姓名', '姓名', 'Name')}</th>
                                <th class="num">${TAX_L('奖金', '獎金', 'Bonus')}</th>
                                <th class="num">÷12</th>
                                <th class="num">${TAX_L('税率', '稅率', 'Rate')}</th><th class="num">${TAX_L('速扣', '速扣', 'Quick Ded.')}</th>
                                <th class="num">${TAX_L('应扣税额', '應扣稅額', 'Tax Withheld')}</th>
                            </tr></thead>
                            <tbody>${rows.map(e => `<tr>
                                <td>${esc(e.employeeId)}</td>
                                <td>${esc(e.employeeName || '-')}</td>
                                <td class="num">${money(e.bonusAmount)}</td>
                                <td class="num">${money(e.monthlyReference)}</td>
                                <td class="num">${(e.applicableTaxRate * 100).toFixed(0)}%</td>
                                <td class="num">${money(e.quickDeduction)}</td>
                                <td class="num" style="font-weight:600;">${money(e.bonusTax)}</td>
                            </tr>`).join('')}</tbody>
                        </table>
                    </div>` : ''}

                ${rows.length ? `
                    <div style="margin-top:12px;padding:12px;border-radius:8px;background:${calcOk ? '#eef9f0' : '#fdecec'};">
                        <b>${calcOk ? TAX_L('✔ 税额反算核对通过', '✔ 稅額反算核對通過', '✔ Reverse check passed') : TAX_L('✘ 税额反算核对失败', '✘ 稅額反算核對失敗', '✘ Reverse check failed')}</b>
                        <div style="font-size:12px;margin-top:6px;">
                            ${TAX_L('逐笔手查表验证：奖金 ÷ 12 → 月度税率 → 奖金 × 税率 − 速算扣除数<br>', '逐筆手查表驗證：獎金 ÷ 12 → 月度稅率 → 獎金 × 稅率 − 速算扣除數<br>', 'Row-by-row manual verification: bonus ÷ 12 → monthly rate → bonus × rate − quick deduction<br>')}
                            ${TAX_L('合计', '合計', 'Manual total')} <b>${money(expectedTotal)}</b> vs ${TAX_L('系统计算', '系統計算', 'system calculated')} <b>${money(d.totalWithheldTax)}</b>
                            ${calcOk ? TAX_L('✔ 一致', '✔ 一致', '✔ Match') : `<br><span style="color:#c00;">${TAX_L('差异: ', '差異: ', 'Diff: ')}${mismatch}</span>`}
                        </div>
                    </div>` : ''}

                <div style="margin-top:12px;">
                    <button class="btn btn-primary" onclick="TaxUI.submitBonus()">📤 ${TAX_L('提交年终奖扣缴', '提交年終獎扣繳', 'Submit Bonus Withholding')}</button>
                </div>
                <div id="taxReceipt"></div>
            </div>`;
    },

    async submitBonus() {
        if (!this.draft.bonusBatchId) return UI.toast(TAX_L('请先试算年终奖', '請先試算年終獎', 'Please calculate the bonus first'), 'error');
        await this._submit('/api/tax/iit/submit', { withholdingBatchId: this.draft.bonusBatchId });
    },

    // ---------- 提交 ----------
    async submitVat() {
        if (!this.draft.declarationId) return UI.toast(TAX_L('请先算税', '請先算稅', 'Please calculate tax first'), 'error');
        await this._submit('/api/tax/vat/' + this.draft.declarationId + '/submit', {});
    },
    async submitCit() {
        if (!this.draft.settlementId) return UI.toast(TAX_L('请先算税', '請先算稅', 'Please calculate tax first'), 'error');
        await this._submit('/api/tax/cit/submit', { settlementId: this.draft.settlementId });
    },
    async submitIit() {
        if (!this.draft.withholdingBatchId) return UI.toast(TAX_L('请先算税', '請先算稅', 'Please calculate tax first'), 'error');
        await this._submit('/api/tax/iit/submit', { withholdingBatchId: this.draft.withholdingBatchId });
    },

    async _submit(url, extra) {
        const u = Auth.getUser() || {};
        try {
            const res = await API.post(url, { ...extra, operatorId: u.user_id || 'WEB_UI' });
            const r = res.data || {};
            document.getElementById('taxReceipt').innerHTML = `
                <div style="margin-top:12px;padding:12px;border-radius:8px;background:#eef9f0;">
                    <b>${TAX_L('✔ 申报已提交', '✔ 申報已提交', '✔ Filing Submitted')}</b>
                    <div style="font-size:12px;margin-top:6px;">
                        ${TAX_L('税局受理号：', '稅局受理號：', 'Tax bureau receipt no.: ')}<b>${esc(r.taxBureauReceiptNo || '-')}</b><br>
                        ${TAX_L('提交时间：', '提交時間：', 'Submitted at: ')}${esc(r.submitTime || '-')}　${TAX_L('状态：', '狀態：', 'Status: ')}${esc(r.status || '-')}<br>
                        ${TAX_L('缴款期限：', '繳款期限：', 'Payment deadline: ')}${esc(r.paymentDeadline || '-')}
                    </div>
                </div>`;
            UI.toast(TAX_L('提交成功', '提交成功', 'Submitted successfully'), 'success');
        } catch (e) {
            document.getElementById('taxReceipt').innerHTML =
                `<p style="color:#e74c3c;margin-top:12px;">✘ ${esc(e.message)}</p>`;
        }
    },

    // ---------- 基礎資料錄入 ----------
    async loadVatInput() {
        try {
            const res = await API.get('/api/tax/inputs/vat?bu_no=' +
                encodeURIComponent(val('inVatBu')) + '&taxPeriod=' + val('inVatPeriod'));
            const d = res.data || {};
            setVal('inVatTransfer', d.input_tax_transfer_out != null ? d.input_tax_transfer_out : 0);
            setVal('inVatCredit', d.prev_credit_override == null ? '' : d.prev_credit_override);
        } catch (e) { /* 尚未錄入，保持預設值 */ }
    },

    async saveVatInput() {
        const msg = document.getElementById('inVatMsg');
        try {
            const res = await API.put('/api/tax/inputs/vat', {
                bu_no: val('inVatBu'),
                taxPeriod: val('inVatPeriod'),
                inputTaxTransferOut: Number(val('inVatTransfer') || 0),
                prevCreditOverride: val('inVatCredit') === '' ? null : Number(val('inVatCredit')),
                operatorId: opId()
            });
            msg.textContent = '✔ ' + res.message;
            UI.toast(TAX_L('增值税调整已保存', '增值稅調整已儲存', 'VAT adjustment saved'), 'success');
        } catch (e) {
            msg.innerHTML = `<span style="color:#e74c3c">✘ ${esc(e.message)}</span>`;
        }
    },

    async loadReconcile() {
        const box = document.getElementById('inVatRecon');
        box.innerHTML = '<p style="font-size:12px;color:#888;margin-top:8px;">' + TAX_L('载入中…', '載入中…', 'Loading…') + '</p>';
        try {
            const res = await API.get('/api/tax/vat/reconcile?bu_no=' +
                encodeURIComponent(val('inVatBu')) + '&taxPeriod=' + val('inVatPeriod') +
                '&filingCycle=' + (val('inVatCycle') || 'MONTHLY') +
                '&taxpayerType=' + (val('inVatType') || '1'));
            const d = res.data || {};
            const rows = d.invoices || [];
            box.innerHTML = `
                <div style="display:flex;gap:24px;font-size:12px;margin-top:10px;color:#555;">
                    <span>${TAX_L('所属月：', '所屬月：', 'Period: ')}<b>${(d.periods || []).join(', ')}</b></span>
                    <span>${TAX_L('销项 AR：', '銷項 AR：', 'Output AR: ')}<b>${d.sales.count}</b>${TAX_L(' 张，金额 ', ' 張，金額 ', ' invoices, amount ')}<b>${money(d.sales.amount)}</b>${TAX_L('，税额 ', '，稅額 ', ', tax ')}<b>${money(d.sales.outputTax)}</b></span>
                    <span>${TAX_L('进项 AP：', '進項 AP：', 'Input AP: ')}<b>${d.purchase.count}</b>${TAX_L(' 张，金额 ', ' 張，金額 ', ' invoices, amount ')}<b>${money(d.purchase.amount)}</b>${TAX_L('，税额 ', '，稅額 ', ', tax ')}<b>${money(d.purchase.invoiceTax)}</b>${d.taxpayerType === 2 ? TAX_L('（不抵扣）', '（不抵扣）', ' (non-deductible)') : ''}</span>
                </div>
                <div style="max-height:280px;overflow:auto;margin-top:8px;">
                    <table class="data-table">
                        <thead><tr><th>${TAX_L('类型', '類型', 'Type')}</th><th>${TAX_L('发票号', '發票號', 'Invoice No.')}</th><th>${TAX_L('不含税金额', '不含稅金額', 'Net Amount')}</th><th>${TAX_L('税率', '稅率', 'Tax Rate')}</th><th>${TAX_L('税额', '稅額', 'Tax Amount')}</th></tr></thead>
                        <tbody>${rows.map(r => `<tr>
                            <td>${r.TX_type === 'AR' ? TAX_L('销项', '銷項', 'Output') : TAX_L('进项', '進項', 'Input')}</td>
                            <td>${esc(r.invoice_no || '-')}</td>
                            <td class="num">${money(r.sub_amt)}</td>
                            <td class="num">${esc(r.tax_rate)}</td>
                            <td class="num">${money(r.VAT_amt)}</td>
                        </tr>`).join('')}</tbody>
                    </table>
                </div>`;
        } catch (e) {
            box.innerHTML = `<p style="color:#e74c3c;font-size:12px;margin-top:8px;">✘ ${esc(e.message)}</p>`;
        }
    },

    async loadCitInput() {
        try {
            const res = await API.get('/api/tax/inputs/cit?bu_no=' +
                encodeURIComponent(val('inCitBu')) + '&taxYear=' + val('inCitYear'));
            const d = res.data || {};
            setVal('inCitRate', d.taxRate != null ? d.taxRate : 0.25);
            setVal('inCitPaid', d.accumPrepaidTax != null ? d.accumPrepaidTax : 0);
            setVal('inCitWithheld', d.withheldTax != null ? d.withheldTax : 0);
            setVal('inCitRevOverride', d.revenueOverride != null ? d.revenueOverride : '');
            setVal('inCitCostOverride', d.costOverride != null ? d.costOverride : '');
            setVal('inCitOverrideReason', d.overrideReason || '');
            const hint = document.getElementById('citAutoHint');
            if (hint) {
                hint.innerHTML = '📊 ' + TAX_L('财报自动值：营业收入 ', '財報自動值：營業收入 ', 'Financial auto values: revenue ') + '<b>' + money(d.autoRevenue) +
                    '</b> / ' + TAX_L('营业成本 ', '營業成本 ', 'cost ') + '<b>' + money(d.autoCost) + '</b>';
            }
            document.getElementById('citAdjRows').innerHTML = '';
            (d.adjustments || []).forEach(a => this.addCitAdj(a.adjustment_type, a.amount, a.remark));
        } catch (e) { /* 尚未錄入，保持預設值 */ }
    },

    addCitAdj(type = 'ADJ_INCREASE', amount = 0, remark = '') {
        const box = document.getElementById('citAdjRows');
        if (!box) return;
        const div = document.createElement('div');
        div.className = 'adj-row';
        div.style.cssText = 'display:flex;gap:8px;margin-bottom:6px;align-items:center;';
        div.innerHTML = `
            <select class="adj-type" style="padding:5px;border:1px solid #ddd;border-radius:6px;">
                <option value="TAX_FREE_INCOME">${TAX_L('免税收入', '免稅收入', 'Tax-free Income')}</option>
                <option value="ADJ_INCREASE">${TAX_L('纳税调整增加', '納稅調整增加', 'Adjustment Increase')}</option>
                <option value="ADJ_DECREASE">${TAX_L('纳税调整减少', '納稅調整減少', 'Adjustment Decrease')}</option>
                <option value="TAX_EXEMPTION">${TAX_L('减免所得税额', '減免所得稅額', 'CIT Reduction')}</option>
                <option value="TAX_CREDIT">${TAX_L('抵免所得税额', '抵免所得稅額', 'CIT Credit')}</option>
            </select>
            <input class="adj-amt" type="number" value="${Number(amount) || 0}"
                   style="width:140px;padding:5px;border:1px solid #ddd;border-radius:6px;">
            <input class="adj-remark" placeholder="${TAX_L('说明', '說明', 'Description')}" value="${esc(remark || '')}"
                   style="flex:1;padding:5px;border:1px solid #ddd;border-radius:6px;">
            <button class="btn btn-danger btn-sm" onclick="this.parentNode.remove()">${TAX_L('删除', '刪除', 'Delete')}</button>`;
        box.appendChild(div);
        div.querySelector('.adj-type').value = type;
    },

    async saveCitInput() {
        const msg = document.getElementById('inCitMsg');
        const rows = Array.from(document.querySelectorAll('#citAdjRows .adj-row')).map(el => ({
            type: el.querySelector('.adj-type').value,
            amount: Number(el.querySelector('.adj-amt').value || 0),
            remark: el.querySelector('.adj-remark').value || null
        })).filter(r => r.amount !== 0);

        // override 字段：留空 = null（清除覆蓋，回到財報）
        const revOvRaw = val('inCitRevOverride');
        const costOvRaw = val('inCitCostOverride');
        const revOverride = revOvRaw === '' ? null : Number(revOvRaw);
        const costOverride = costOvRaw === '' ? null : Number(costOvRaw);

        try {
            const res = await API.put('/api/tax/inputs/cit', {
                bu_no: val('inCitBu'),
                taxYear: val('inCitYear'),
                taxRate: Number(val('inCitRate')),
                accumPrepaidTax: Number(val('inCitPaid') || 0),
                withheldTax: Number(val('inCitWithheld') || 0),
                revenueOverride: revOverride,
                costOverride: costOverride,
                overrideReason: val('inCitOverrideReason') || null,
                adjustments: rows,
                operatorId: opId()
            });
            const d = res.data || {};
            const parts = [TAX_L('✔ 汇算参数已保存', '✔ 匯算參數已儲存', '✔ Settlement parameters saved')];
            if (d.revenueOverride != null || d.costOverride != null) {
                parts.push(TAX_L('（已启用人工覆盖）', '（已啟用人工覆蓋）', '(Manual override enabled)'));
            } else {
                parts.push(TAX_L('（使用财报自动值）', '（使用財報自動值）', '(Using financial auto values)'));
            }
            msg.textContent = parts.join('');
            UI.toast(TAX_L('汇算参数已保存', '匯算參數已儲存', 'Settlement parameters saved'), 'success');
        } catch (e) {
            msg.innerHTML = `<span style="color:#e74c3c">✘ ${esc(e.message)}</span>`;
        }
    },

    async loadPayroll() {
        const box = document.getElementById('payList');
        if (!box) return;
        try {
            const res = await API.get('/api/tax/inputs/iit?bu_no=' +
                encodeURIComponent(val('inPayBu')) + '&taxPeriod=' +
                val('inPayPeriod').replace(/-/g, ''));
            const rows = res.data || [];
            if (!rows.length) {
                box.innerHTML = '<p style="font-size:12px;color:#888;">' + TAX_L('本期尚无薪资录入（系统将以财报平均工资估算）', '本期尚無薪資錄入（系統將以財報平均工資估算）', 'No payroll entries this period (the system will estimate by average salary from financials)') + '</p>';
                return;
            }
            box.innerHTML = `<table class="data-table">
                <thead><tr><th>${TAX_L('员工', '員工', 'Employee')}</th><th>${TAX_L('姓名', '姓名', 'Name')}</th><th>${TAX_L('应发工资', '應發工資', 'Gross Salary')}</th><th>${TAX_L('三险一金', '三險一金', 'Social Insurance')}</th><th>${TAX_L('专项附加', '專項附加', 'Special Ded.')}</th><th>${TAX_L('其他扣除', '其他扣除', 'Other Ded.')}</th><th>${TAX_L('操作', '操作', 'Actions')}</th></tr></thead>
                <tbody>${rows.map(r => `<tr>
                    <td>${esc(r.employee_id)}</td>
                    <td>${esc(r.employee_name || '-')}</td>
                    <td class="num">${money(r.gross_salary)}</td>
                    <td class="num">${money(r.social_insurance)}</td>
                    <td class="num">${money(r.special_deduction)}</td>
                    <td class="num">${money(r.other_deduction)}</td>
                    <td><button class="btn btn-danger btn-sm" onclick="TaxUI.delPayroll(${r.id})">${TAX_L('删除', '刪除', 'Delete')}</button></td>
                </tr>`).join('')}</tbody></table>`;
        } catch (e) {
            box.innerHTML = `<p style="color:#e74c3c;font-size:12px;">✘ ${esc(e.message)}</p>`;
        }
    },

    async savePayroll() {
        const msg = document.getElementById('inPayMsg');
        try {
            const res = await API.post('/api/tax/inputs/iit', {
                bu_no: val('inPayBu'),
                YYYY_MM: val('inPayPeriod'),
                employeeId: val('inPayEmp'),
                employeeName: val('inPayName'),
                grossSalary: Number(val('inPayGross') || 0),
                socialInsurance: Number(val('inPaySocial') || 0),
                specialDeduction: Number(val('inPaySpecial') || 0),
                otherDeduction: Number(val('inPayOther') || 0)
            });
            msg.textContent = '✔ ' + res.message;
            UI.toast(TAX_L('薪资明细已保存', '薪資明細已儲存', 'Payroll details saved'), 'success');
            this.loadPayroll();
        } catch (e) {
            msg.innerHTML = `<span style="color:#e74c3c">✘ ${esc(e.message)}</span>`;
        }
    },

    async delPayroll(id) {
        if (!confirm(TAX_L('确定删除该员工本期薪资明细？', '確定刪除該員工本期薪資明細？', 'Delete this payroll entry?'))) return;
        try {
            await API.del('/api/tax/inputs/iit/' + id + '?bu_no=' + encodeURIComponent(val('inPayBu')));
            UI.toast(TAX_L('已删除', '已刪除', 'Deleted'), 'success');
            this.loadPayroll();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async loadBonus() {
        const box = document.getElementById('bonusList');
        if (!box) return;
        try {
            const res = await API.get('/api/tax/inputs/bonus?bu_no=' +
                encodeURIComponent(val('inBonusBu')) + '&taxYear=' + val('inBonusYear'));
            const rows = res.data || [];
            if (!rows.length) {
                box.innerHTML = '<p style="font-size:12px;color:#888;">' + TAX_L('本年度尚未录入年终奖', '本年度尚未錄入年終獎', 'No annual bonus entries for this year') + '</p>';
                return;
            }
            box.innerHTML = `<table class="data-table">
                <thead><tr><th>${TAX_L('员工', '員工', 'Employee')}</th><th>${TAX_L('姓名', '姓名', 'Name')}</th><th class="num">${TAX_L('奖金', '獎金', 'Bonus')}</th><th>${TAX_L('计税方式', '計稅方式', 'Tax Method')}</th><th>${TAX_L('备注', '備註', 'Remark')}</th><th>${TAX_L('操作', '操作', 'Actions')}</th></tr></thead>
                <tbody>${rows.map(r => `<tr>
                    <td>${esc(r.employee_id)}</td>
                    <td>${esc(r.employee_name || '-')}</td>
                    <td class="num">${money(r.bonus_amount)}</td>
                    <td>${r.tax_method === 'SEPARATE' ? `<span style="color:#c67200;">${TAX_L('单独计税', '單獨計稅', 'Separate')}</span>` : `<span style="color:#2c5fa8;">${TAX_L('合并计税', '合併計稅', 'Combined')}</span>`}</td>
                    <td style="font-size:12px;color:#888;">${esc(r.remark || '')}</td>
                    <td><button class="btn btn-danger btn-sm" onclick="TaxUI.delBonus(${r.id})">${TAX_L('删除', '刪除', 'Delete')}</button></td>
                </tr>`).join('')}</tbody></table>`;
        } catch (e) {
            box.innerHTML = `<p style="color:#e74c3c;font-size:12px;">✘ ${esc(e.message)}</p>`;
        }
    },

    async saveBonus() {
        const msg = document.getElementById('inBonusMsg');
        if (!val('inBonusEmp')) { msg.innerHTML = `<span style="color:#c00;">${TAX_L('请填写员工编号', '請填寫員工編號', 'Employee ID is required')}</span>`; return; }
        try {
            const res = await API.post('/api/tax/inputs/bonus', {
                bu_no: val('inBonusBu'),
                taxYear: val('inBonusYear'),
                employee_id: val('inBonusEmp'),
                employee_name: val('inBonusName') || null,
                bonus_amount: Number(val('inBonusAmount') || 0),
                tax_method: val('inBonusMethod'),
                remark: val('inBonusRemark') || null
            });
            msg.textContent = '✔ ' + res.message;
            UI.toast(TAX_L('年终奖已保存', '年終獎已儲存', 'Annual bonus saved'), 'success');
            this.loadBonus();
        } catch (e) {
            msg.innerHTML = `<span style="color:#e74c3c;">✘ ${esc(e.message)}</span>`;
        }
    },

    async delBonus(id) {
        if (!confirm(TAX_L('确定删除该员工的年终奖录入？', '確定刪除該員工的年終獎錄入？', 'Delete this annual bonus entry?'))) return;
        try {
            await API.del('/api/tax/inputs/bonus/' + id);
            UI.toast(TAX_L('已删除', '已刪除', 'Deleted'), 'success');
            this.loadBonus();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ---------- 異常用例自檢 ----------
    async selfCheck() {
        const box = document.getElementById('taxSelfCheck');
        box.innerHTML = '<p style="color:#888;margin-top:12px;">' + TAX_L('执行中…', '執行中…', 'Running…') + '</p>';
        const cases = [
            [TAX_L('缺 taxPeriod', '缺 taxPeriod', 'Missing taxPeriod'), '/vat/calculate', { taxpayerType: 1 }, 400],
            [TAX_L('taxPeriod 格式错误', 'taxPeriod 格式錯誤', 'Invalid taxPeriod format'), '/vat/calculate', { taxPeriod: '2025', taxpayerType: 1 }, 400],
            [TAX_L('taxpayerType 越界', 'taxpayerType 越界', 'taxpayerType out of range'), '/vat/calculate', { taxPeriod: '202512', taxpayerType: 3 }, 400],
            [TAX_L('缺 bu_no', '缺 bu_no', 'Missing bu_no'), '/vat/calculate', { taxPeriod: '202512', taxpayerType: 1 }, 400],
            [TAX_L('提交不存在的 ID', '提交不存在的 ID', 'Submit non-existent ID'), '/vat/not-exist/submit', { operatorId: 'SELF_CHK' }, 404]
        ];
        const out = [];
        for (const [name, path, body, expect] of cases) {
            const r = await rawPost(path, body);
            const ok = r.status === expect;
            out.push(`<tr>
                <td>${esc(name)}</td>
                <td>${expect}</td>
                <td>${r.status}</td>
                <td style="color:${ok ? '#27ae60' : '#e74c3c'};font-weight:600;">${ok ? 'PASS' : 'FAIL'}</td>
                <td style="font-size:12px;color:#888;">${esc((r.data && r.data.message) || '')}</td>
            </tr>`);
        }
        const pass = out.length;
        box.innerHTML = `
            <div style="margin-top:16px;padding:16px;background:#fafafa;border:1px solid #eee;border-radius:8px;">
                <h4 style="margin:0 0 12px;">${TAX_L('异常用例自检（共', '異常用例自檢（共', 'Self-Check Cases (')} ${pass} ${TAX_L('项）', '項）', ')')}</h4>
                <table class="data-table">
                    <thead><tr><th>${TAX_L('用例', '用例', 'Case')}</th><th>${TAX_L('期望码', '期望碼', 'Expected')}</th><th>${TAX_L('实际码', '實際碼', 'Actual')}</th><th>${TAX_L('结论', '結論', 'Result')}</th><th>${TAX_L('回应信息', '回應訊息', 'Response')}</th></tr></thead>
                    <tbody>${out.join('')}</tbody>
                </table>
            </div>`;
    }
};

// ---------- 工具 ----------
function val(id) {
    const el = document.getElementById(id);
    return el ? String(el.value).trim() : '';
}
function setVal(id, v) {
    const el = document.getElementById(id);
    if (el) el.value = (v === null || v === undefined) ? '' : v;
}
function opId() {
    const u = Auth.getUser() || {};
    return u.user_id || 'WEB_UI';
}
function money(x) {
    const v = Number(x || 0);
    return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function round2(x) { return Math.round((Number(x) + Number.EPSILON) * 100) / 100; }
function near(a, b) { return Math.abs(Number(a) - Number(b)) <= 0.01; }
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
    ));
}
function row(label, value, strong) {
    return `<tr><td style="width:220px;color:#666;">${esc(label)}</td>
        <td class="num" style="${strong ? 'font-weight:700;color:#2c3e50;' : ''}">${value}</td></tr>`;
}
// 可點擊列：點擊後彈出該欄位的明細內容
function rowLink(label, value, onclick) {
    return `<tr style="cursor:pointer;" onclick="${onclick}" title="${TAX_L('点击查看明细', '點擊查看明細', 'Click to view details')}"
        onmouseover="this.style.background='#eef4ff'" onmouseout="this.style.background=''">
        <td style="width:220px;color:#2563eb;">🔍 ${esc(label)}</td>
        <td class="num" style="color:#2563eb;">${value}</td></tr>`;
}
async function rawPost(path, body) {
    const res = await fetch('/api/tax' + path, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + Auth.getToken()
        },
        body: JSON.stringify(body)
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* 非 JSON 回應 */ }
    return { status: res.status, data };
}
