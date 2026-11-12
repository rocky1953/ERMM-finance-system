/**
 * 電子化報稅 — 測試與申報頁面（VAT / CIT / IIT）
 *
 * 對應後端：/api/tax/*
 * 操作流程：選模組 → 填參數 → 算稅 → 畫面核對計算式 → 提交申報 → 取得稅局受理號
 */
registerPage('tax', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <button class="btn btn-primary" id="taxTab_vat" onclick="TaxUI.switchTab('vat')">增值稅申報</button>
                <button class="btn" id="taxTab_cit" onclick="TaxUI.switchTab('cit')">企業所得稅匯算</button>
                <button class="btn" id="taxTab_iit" onclick="TaxUI.switchTab('iit')">個人所得稅扣繳</button>
                <button class="btn" id="taxTab_input" onclick="TaxUI.switchTab('input')">基礎資料錄入</button>
                <div class="spacer"></div>
                <button class="btn btn-success" onclick="TaxUI.selfCheck()">🧪 自檢異常用例</button>
            </div>
            <p style="color:#888;font-size:12px;margin:0 0 12px;">
                示範資料位於帳套 <b>SZ</b>、期間 <b>202512</b>。若算稅結果全為 0，請調整帳套或期間。
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
                <div class="form-group"><label>稅款所屬期 (YYYYMM)</label>
                    <input id="vatPeriod" value="202512" placeholder="例：202512"></div>
                <div class="form-group"><label>納稅人類型</label>
                    <select id="vatType" onchange="TaxUI.onVatTypeChange()">
                        <option value="1">1 - 一般納稅人</option>
                        <option value="2">2 - 小規模納稅人</option>
                    </select></div>
                <div class="form-group"><label>申報週期</label>
                    <select id="vatCycle" onchange="TaxUI.onVatCycleChange()">
                        <option value="MONTHLY">按月申報</option>
                        <option value="QUARTERLY">按季申報</option>
                    </select></div>
                <div class="form-group"><label>帳套 bu_no</label>
                    <input id="vatBu" value="${State.bu_no || 'SZ'}"></div>
            </div>
            <p id="vatCycleHint" style="font-size:12px;color:#888;margin:0 0 10px;"></p>
            <button class="btn btn-primary" onclick="TaxUI.calcVat()">▶ 開始算稅</button>`;
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
            hint.innerHTML = '按季申報：系統將彙總該季度 3 個月的發票，所屬期自動取季末月。'
                + (isSmall ? '季度銷售額未超過 30 萬元時免徵增值稅。' : '');
        } else {
            hint.textContent = '按月申報：僅彙總所屬期當月發票。';
        }
    },

    form_cit() {
        return `
            <div class="form-row">
                <div class="form-group"><label>納稅年度 (YYYY)</label>
                    <input id="citYear" value="2025" placeholder="例：2025"></div>
                <div class="form-group"><label>統一社會信用代碼</label>
                    <input id="citIdNo" value="9144030071526726X1"></div>
                <div class="form-group"><label>帳套 bu_no</label>
                    <input id="citBu" value="${State.bu_no || 'SZ'}"></div>
                <div class="form-group"><label>納稅調整</label>
                    <select id="citAdj"><option value="1">納入</option><option value="0">不納入</option></select></div>
            </div>
            <button class="btn btn-primary" onclick="TaxUI.calcCit()">▶ 開始算稅</button>`;
    },

    form_iit() {
        return `
            <div class="form-row">
                <div class="form-group"><label>稅款所屬期 (YYYYMM)</label>
                    <input id="iitPeriod" value="202512" placeholder="例：202512"></div>
                <div class="form-group"><label>所得類型</label>
                    <select id="iitType">
                        <option value="SALARY">工資薪金</option>
                        <option value="LABOR_REMUNERATION">勞務報酬</option>
                        <option value="REMUNERATION_FOR_WRITING">稿酬所得</option>
                    </select></div>
                <div class="form-group"><label>帳套 bu_no</label>
                    <input id="iitBu" value="${State.bu_no || 'SZ'}"></div>
                <div class="form-group"><label>指定員工（可選）</label>
                    <input id="iitEmps" placeholder="逗號分隔，空白=全部"></div>
            </div>
            <button class="btn btn-primary" onclick="TaxUI.calcIit()">▶ 開始算稅</button>

            <hr style="margin:18px 0;border:none;border-top:1px dashed #ddd;">
            <div style="padding:14px;background:#f8fafc;border:1px solid #e8edf3;border-radius:8px;">
                <h4 style="margin:0 0 6px;color:#336;">🎁 年終獎（全年一次性獎金）計算</h4>
                <p style="font-size:12px;color:#666;margin:0 0 10px;">
                    稅法允許選擇「單獨計稅」（獎金 ÷ 12 找月度稅率）或「合併計稅」（併入綜合所得）。
                    請先在「基礎資料錄入 → 年終獎錄入」區塊填寫每位員工的獎金金額，再回到此處選擇計稅方式。
                </p>
                <div class="form-row">
                    <div class="form-group"><label>納稅年度 (YYYY)</label>
                        <input id="bonusYear" value="2025"></div>
                    <div class="form-group"><label>帳套 bu_no</label>
                        <input id="bonusBu" value="${State.bu_no || 'SZ'}"></div>
                    <div class="form-group"><label>計稅方式</label>
                        <select id="bonusMethod">
                            <option value="SEPARATE">單獨計稅（推薦：獎金 ÷ 12 找月度稅率）</option>
                            <option value="COMBINED">合併計稅（併入綜合所得，累計預扣）</option>
                        </select></div>
                    <div class="form-group"><label>指定員工（可選）</label>
                        <input id="bonusEmps" placeholder="逗號分隔，空白=全部"></div>
                </div>
                <button class="btn btn-success" onclick="TaxUI.calcBonus()">💰 試算年終獎稅額</button>
            </div>`;
    },

    form_input() {
        return `
            <div style="padding:14px;border:1px solid #eee;border-radius:8px;margin-bottom:16px;">
                <h4 style="margin:0 0 4px;">① 增值稅調整</h4>
                <p style="font-size:12px;color:#888;margin:0 0 10px;">
                    自動取數：銷項／進項稅額來自發票明細（mgm_invoice_details）。此處僅錄入無法自動取得的人工調整。
                </p>
                <div class="form-row">
                    <div class="form-group"><label>稅款所屬期</label><input id="inVatPeriod" value="202512"></div>
                    <div class="form-group"><label>申報週期</label>
                        <select id="inVatCycle">
                            <option value="MONTHLY">按月申報</option>
                            <option value="QUARTERLY">按季申報</option>
                        </select></div>
                    <div class="form-group"><label>納稅人類型</label>
                        <select id="inVatType">
                            <option value="1">1 - 一般納稅人</option>
                            <option value="2">2 - 小規模納稅人</option>
                        </select></div>
                    <div class="form-group"><label>帳套 bu_no</label><input id="inVatBu" value="${State.bu_no || 'SZ'}"></div>
                    <div class="form-group"><label>進項稅額轉出</label><input id="inVatTransfer" value="0"></div>
                    <div class="form-group"><label>上期留抵（留空=自動）</label><input id="inVatCredit" placeholder="自動計算"></div>
                </div>
                <button class="btn btn-primary" onclick="TaxUI.saveVatInput()">💾 儲存調整</button>
                <button class="btn" onclick="TaxUI.loadReconcile()">📋 展開發票勾對清單</button>
                <div id="inVatMsg" style="font-size:12px;color:#27ae60;margin-top:8px;"></div>
                <div id="inVatRecon"></div>
            </div>

            <div style="padding:14px;border:1px solid #eee;border-radius:8px;margin-bottom:16px;">
                <h4 style="margin:0 0 4px;">② 企業所得稅匯算參數</h4>
                <p style="font-size:12px;color:#888;margin:0 0 10px;">
                    自動取數：收入／成本來自財報（mgm_finance_summary）。若財報與稅務口徑差異大，可勾選下方覆蓋。
                </p>
                <div class="form-row">
                    <div class="form-group"><label>納稅年度</label><input id="inCitYear" value="2025"></div>
                    <div class="form-group"><label>帳套 bu_no</label><input id="inCitBu" value="${State.bu_no || 'SZ'}"></div>
                    <div class="form-group"><label>適用稅率（0.25=25%）</label><input id="inCitRate" value="0.25"></div>
                    <div class="form-group"><label>累計已預繳</label><input id="inCitPaid" value="0"></div>
                    <div class="form-group"><label>境外已繳（可抵免）</label><input id="inCitWithheld" value="0"></div>
                </div>

                <div style="margin:14px 0 6px;padding:10px;background:#fff8f0;border:1px dashed #e5b47c;border-radius:6px;">
                    <div style="font-size:13px;font-weight:600;color:#8a5a10;margin-bottom:6px;">💰 收入 / 成本人工覆蓋（留空=自動取財報）</div>
                    <div style="font-size:12px;color:#888;margin-bottom:8px;" id="citAutoHint">自動載入中…</div>
                    <div class="form-row">
                        <div class="form-group"><label>營業收入覆蓋</label>
                            <input id="inCitRevOverride" placeholder="留空=用財報自動值"></div>
                        <div class="form-group"><label>營業成本覆蓋</label>
                            <input id="inCitCostOverride" placeholder="留空=用財報自動值"></div>
                        <div class="form-group" style="flex:1;"><label>覆蓋原因</label>
                            <input id="inCitOverrideReason" placeholder="審計軌跡，可選"></div>
                    </div>
                </div>
                <div style="margin:10px 0 6px;font-size:13px;color:#555;">納稅調整明細</div>
                <div id="citAdjRows"></div>
                <div style="margin-top:8px;">
                    <button class="btn" onclick="TaxUI.addCitAdj()">＋ 新增調整項</button>
                    <button class="btn btn-primary" onclick="TaxUI.saveCitInput()">💾 儲存匯算參數</button>
                </div>
                <div id="inCitMsg" style="font-size:12px;color:#27ae60;margin-top:8px;"></div>
            </div>

            <div style="padding:14px;border:1px solid #eee;border-radius:8px;">
                <h4 style="margin:0 0 4px;">③ 工資及個稅扣除明細</h4>
                <p style="font-size:12px;color:#888;margin:0 0 10px;">
                    自動取數：無薪資表時系統以財報平均工資估算。欲按真實名單計稅，請逐人錄入本期收入與扣除。
                </p>
                <div class="form-row">
                    <div class="form-group"><label>所屬期 (YYYY-MM)</label><input id="inPayPeriod" value="2025-12"></div>
                    <div class="form-group"><label>帳套 bu_no</label><input id="inPayBu" value="${State.bu_no || 'SZ'}"></div>
                    <div class="form-group"><label>員工編號</label><input id="inPayEmp" placeholder="例：U0001"></div>
                    <div class="form-group"><label>姓名</label><input id="inPayName"></div>
                    <div class="form-group"><label>應發工資</label><input id="inPayGross" value="0"></div>
                    <div class="form-group"><label>三險一金</label><input id="inPaySocial" value="0"></div>
                    <div class="form-group"><label>專項附加扣除</label><input id="inPaySpecial" value="0"></div>
                    <div class="form-group"><label>其他扣除</label><input id="inPayOther" value="0"></div>
                </div>
                <button class="btn btn-primary" onclick="TaxUI.savePayroll()">💾 儲存此員工</button>
                <div id="inPayMsg" style="font-size:12px;color:#27ae60;margin-top:8px;"></div>
                <div id="payList" style="margin-top:12px;"></div>
            </div>

            <div style="padding:14px;border:1px solid #eee;border-radius:8px;margin-top:16px;">
                <h4 style="margin:0 0 4px;">④ 年終獎（全年一次性獎金）錄入</h4>
                <p style="font-size:12px;color:#888;margin:0 0 10px;">
                    每位員工錄入一條年終獎，並選擇 <b>單獨計稅</b> 或 <b>合併計稅</b>。
                    單獨計稅按「獎金 ÷ 12 找月度稅率表」計算；合併計稅併入綜合所得。
                </p>
                <div class="form-row">
                    <div class="form-group"><label>納稅年度</label><input id="inBonusYear" value="2025"></div>
                    <div class="form-group"><label>帳套 bu_no</label><input id="inBonusBu" value="${State.bu_no || 'SZ'}"></div>
                    <div class="form-group"><label>員工編號</label><input id="inBonusEmp" placeholder="例：U0001"></div>
                    <div class="form-group"><label>姓名</label><input id="inBonusName"></div>
                    <div class="form-group"><label>獎金金額</label><input id="inBonusAmount" value="0"></div>
                    <div class="form-group"><label>計稅方式</label>
                        <select id="inBonusMethod">
                            <option value="SEPARATE">單獨計稅（月度稅率）</option>
                            <option value="COMBINED">合併計稅（併入綜合所得）</option>
                        </select></div>
                    <div class="form-group" style="flex:1;"><label>備註</label><input id="inBonusRemark" placeholder="可選"></div>
                </div>
                <button class="btn btn-primary" onclick="TaxUI.saveBonus()">💾 儲存年終獎</button>
                <button class="btn" onclick="TaxUI.loadBonus()">🔄 重新載入</button>
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
            UI.toast(res.message || '算稅完成', 'success');
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
            UI.toast(res.message || '算稅完成', 'success');
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
            UI.toast(res.message || '算稅完成', 'success');
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
            UI.toast(res.message || '年終獎試算完成', 'success');
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
                <h4 style="margin:0 0 6px;">算稅結果 <span style="font-size:12px;color:#888;">申報單號：${esc(d.declarationId || '-')}</span></h4>
                <div style="font-size:12px;color:#666;margin-bottom:10px;">
                    申報週期：<b>${d.filingCycle === 'QUARTERLY' ? '按季申報' : '按月申報'}</b>
                    ${d.periodStart && d.periodEnd && d.periodStart !== d.periodEnd
                        ? `　稅款所屬期：<b>${esc(d.periodStart)} ~ ${esc(d.periodEnd)}</b>` : ''}
                </div>
                ${d.taxExempt ? `<div style="padding:10px;border-radius:6px;background:#eef4ff;color:#2c5fa8;font-size:12px;margin-bottom:10px;">
                    ⓘ ${esc(d.exemptReason || '本期免徵增值稅')}</div>` : ''}
                <table class="data-table">
                    <tbody>
                        ${rowLink('銷售額合計', money(d.totalSalesAmt), "TaxUI.showVatDetail('sales')")}
                        ${rowLink('銷項稅額', money(d.totalOutputTax), "TaxUI.showVatDetail('sales')")}
                        ${Number(d.inputTaxTransferOut || 0) > 0 ? row('進項稅額轉出', money(d.inputTaxTransferOut)) : ''}
                        ${rowLink('進項稅額（可抵扣）', money(d.totalInputTax), "TaxUI.showVatDetail('purchase')")}
                        ${rowLink('上期留抵稅額', money(d.prevPeriodCredit), "TaxUI.showVatDetail('credit')")}
                        ${row('應納稅額', money(d.taxPayable), true)}
                        ${row('城建稅 (7%)', money(s.urbanMaintenance))}
                        ${row('教育費附加 (3%)', money(s.educationSurcharge))}
                        ${row('地方教育附加 (2%)', money(s.localEducationSurcharge))}
                        ${row('稅負合計', money(round2(Number(d.taxPayable) + Number(s.urbanMaintenance || 0)
                            + Number(s.educationSurcharge || 0) + Number(s.localEducationSurcharge || 0))), true)}
                    </tbody>
                </table>

                <div style="margin-top:12px;padding:12px;border-radius:8px;background:${allOk ? '#eef9f0' : '#fdecec'};">
                    <b>${allOk ? '✔ 計算式核對通過' : '✘ 計算式核對失敗'}</b>
                    <div style="font-size:12px;margin-top:6px;">
                        VAT_R02 應納稅額 = ${money(d.totalOutputTax)} − ${money(d.totalInputTax)} − ${money(d.prevPeriodCredit)} = <b>${money(calcPayable)}</b> ${okPayable ? '✔' : '✘'}<br>
                        VAT_R03 城建 = ${money(d.taxPayable)} × 7% = ${money(round2(d.taxPayable * 0.07))} ${okUrban ? '✔' : '✘'}；
                        教育 = ${money(round2(d.taxPayable * 0.03))} ${okEdu ? '✔' : '✘'}；
                        地方教育 = ${money(round2(d.taxPayable * 0.02))} ${okLocal ? '✔' : '✘'}
                    </div>
                </div>

                <div style="margin-top:12px;">
                    <button class="btn btn-primary" onclick="TaxUI.submitVat()">📤 提交稅局申報</button>
                </div>
                <div id="taxReceipt"></div>
            </div>`;
    },

    // ---------- VAT 欄位明細鑽取 ----------
    // kind: sales(銷項發票) / purchase(進項發票) / credit(上期留抵說明)
    async showVatDetail(kind) {
        const p = (this.draft && this.draft._params) || {};
        if (!p.taxPeriod) return UI.toast('請先算稅', 'error');
        UI.modal('載入中…', '<div style="text-align:center;padding:24px;color:#888;">讀取明細資料…</div>');
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
                    ? `<tr><td style="color:#666;">人工覆蓋值</td><td class="num"><b>${money(overrideInfo.prev_credit_override)}</b>（基礎資料錄入 → 增值稅調整）</td></tr>`
                    : `<tr><td style="color:#666;">人工覆蓋值</td><td>未設定（系統自動由上期應納稅額 &lt; 0 結轉）</td></tr>`;
                UI.modal('上期留抵稅額 · 來源說明', `
                    <p style="font-size:13px;color:#555;line-height:1.8;">
                        本期留抵稅額 <b>${money(this.draft.prevPeriodCredit)}</b> 的取數邏輯：<br>
                        ① 若「基礎資料錄入 → 增值稅調整」有填寫上期留抵覆蓋值，優先採用；<br>
                        ② 否則自動查找上一申報期間的申報表，其「應納稅額」若為負數（進項大於銷項），
                        差額即結轉為本期留抵。
                    </p>
                    <table class="data-table"><tbody>${ov}
                        <tr><td style="color:#666;">本期採用值</td><td class="num"><b>${money(this.draft.prevPeriodCredit)}</b></td></tr>
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
            const title = isSales ? '銷項發票明細（銷售額 / 銷項稅額）' : '進項發票明細（可抵扣進項稅額）';
            const note = smallScale
                ? (isSales
                    ? `<div style="font-size:12px;color:#b45309;background:#fef3c7;border-radius:6px;padding:8px 10px;margin-bottom:8px;">⚠ 小規模納稅人：銷項按 <b>${levyPct}% 徵收率</b>計稅（不適用一般納稅人稅率），下表稅額欄為按徵收率試算值，合計以算稅結果為準。</div>`
                    : `<div style="font-size:12px;color:#b45309;background:#fef3c7;border-radius:6px;padding:8px 10px;margin-bottom:8px;">⚠ 小規模納稅人：<b>進項稅額不可抵扣</b>，下表稅額欄以 0 展示。</div>`)
                : '';
            const body = rows.length ? `
                ${note}
                <div style="font-size:12px;color:#666;margin-bottom:8px;">
                    所屬期間：<b>${esc((d.periods || []).join(', ') || p.taxPeriod)}</b>　共 <b>${rows.length}</b> 張
                </div>
                <div style="max-height:340px;overflow:auto;">
                    <table class="data-table">
                        <thead><tr><th>發票號</th><th>日期</th><th>對方單位</th><th class="num">不含稅金額</th><th class="num">稅率</th><th class="num">稅額</th></tr></thead>
                        <tbody>${rows.map(r => `<tr>
                            <td>${esc(r.invoice_no || '-')}</td>
                            <td>${esc(String(r.invoice_date || r.YMD || '-').substring(0, 10))}</td>
                            <td>${esc(r.cust_name || r.supplier_name || r.counterparty || '-')}</td>
                            <td class="num">${money(r.sub_amt)}</td>
                            <td class="num">${smallScale ? (isSales ? `${levyPct}%（徵收率）` : '不可抵扣') : esc(r.tax_rate)}</td>
                            <td class="num">${money(dispTax(r))}</td>
                        </tr>`).join('')}</tbody>
                        <tfoot><tr style="font-weight:700;background:#eaf2f8;">
                            <td colspan="3">合計</td>
                            <td class="num">${money(sumAmt)}</td><td></td>
                            <td class="num">${money(sumTax)}</td>
                        </tr></tfoot>
                    </table>
                </div>` : `<p style="color:#888;padding:16px 0;">本期間無${isSales ? '銷項' : '進項'}發票資料</p>`;
            UI.modal(title, body, '');
        } catch (e) {
            UI.modal('明細載入失敗', `<p style="color:#e74c3c;">✘ ${esc(e.message)}</p>`, '');
        }
    },

    renderCit(d) {
        const expected = round2(Number(d.totalRevenue) - Number(d.totalCost));
        const diff = round2(Number(d.taxableIncome) - expected);
        const overrideHint = d.isOverridden
            ? `<div style="padding:8px;border-radius:6px;background:#fff8f0;color:#8a5a10;font-size:12px;margin-bottom:8px;">
                   ⚠ 本次計算使用了<b>人工覆蓋的收入/成本</b>（而非財報自動匯總值）</div>`
            : '';
        return `
            <div style="margin-top:16px;padding:16px;background:#fafafa;border:1px solid #eee;border-radius:8px;">
                <h4 style="margin:0 0 6px;">匯算結果 <span style="font-size:12px;color:#888;">匯算單號：${esc(d.settlementId || '-')}</span></h4>
                ${overrideHint}
                <table class="data-table">
                    <tbody>
                        ${row('收入總額', money(d.totalRevenue))}
                        ${row('成本費用', money(d.totalCost))}
                        ${row('納稅調整後所得', money(d.taxableIncome), true)}
                        ${row('應納所得稅額', money(d.taxPayable), true)}
                        ${row('累計已預繳', money(d.accumPrepaidTax))}
                        ${row('補(退)稅額', money(d.refundOrSupplement), true)}
                    </tbody>
                </table>
                <div style="margin-top:12px;padding:12px;border-radius:8px;background:#fff8e6;font-size:12px;">
                    CIT_R01 參考核對：收入 ${money(d.totalRevenue)} − 成本 ${money(d.totalCost)} = ${money(expected)}，
                    實際納稅調整後所得 ${money(d.taxableIncome)}，差額 ${money(diff)}
                    ${near(diff, 0) ? '（無調整）' : '（含納稅調整，屬正常）'}
                </div>
                <div style="margin-top:12px;">
                    <button class="btn btn-primary" onclick="TaxUI.submitCit()">📤 提交稅局申報</button>
                </div>
                <div id="taxReceipt"></div>
            </div>`;
    },

    renderIit(d) {
        const rows = (d.employeeDetails || []);
        return `
            <div style="margin-top:16px;padding:16px;background:#fafafa;border:1px solid #eee;border-radius:8px;">
                <h4 style="margin:0 0 12px;">扣繳結果 <span style="font-size:12px;color:#888;">批次號：${esc(d.withholdingBatchId || '-')}</span></h4>
                <table class="data-table">
                    <tbody>
                        ${row('員工人數', d.totalEmployees || 0)}
                        ${row('代扣稅額合計', money(d.totalWithheldTax), true)}
                    </tbody>
                </table>
                ${rows.length ? `
                    <div style="max-height:320px;overflow:auto;margin-top:12px;">
                        <table class="data-table">
                            <thead><tr><th>員工編號</th><th>累計收入</th><th>累計扣除</th><th>本期稅額</th></tr></thead>
                            <tbody>${rows.slice(0, 100).map(e => `<tr>
                                <td>${esc(e.employeeId)}</td>
                                <td class="num">${money(e.cumulativeIncome)}</td>
                                <td class="num">${money(e.cumulativeDeduction)}</td>
                                <td class="num">${money(e.currentPeriodTax)}</td>
                            </tr>`).join('')}</tbody>
                        </table>
                    </div>
                    ${rows.length > 100 ? `<p style="font-size:12px;color:#888;">僅顯示前 100 筆，共 ${rows.length} 筆</p>` : ''}
                ` : '<p style="color:#888;">無扣繳明細</p>'}
                <div style="margin-top:12px;">
                    <button class="btn btn-primary" onclick="TaxUI.submitIit()">📤 提交扣繳申報</button>
                </div>
                <div id="taxReceipt"></div>
            </div>`;
    },

    renderBonus(d) {
        const rows = (d.employeeDetails || []);
        const methodLabel = d.taxMethod === 'SEPARATE'
            ? '單獨計稅（獎金 ÷ 12 → 月度稅率表）'
            : '合併計稅（併入綜合所得）';
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
                <h4 style="margin:0 0 6px;">🎁 年終獎試算結果
                    <span style="font-size:12px;color:#888;">批次號：${esc(d.bonusBatchId || '-')}</span>
                </h4>
                <div style="font-size:12px;color:#666;margin-bottom:10px;">
                    計稅方式：<b>${methodLabel}</b>
                    ${d.employeeDetails.length === 0 ? '（年度內無該方式的年終獎錄入，請先到基礎資料錄入區填寫）' : ''}
                </div>
                <table class="data-table">
                    <tbody>
                        ${row('員工人數', d.employeeDetails.length)}
                        ${row('獎金總額', money(d.totalBonus))}
                        ${row('應扣稅額合計', money(d.totalWithheldTax), true)}
                    </tbody>
                </table>

                ${rows.length ? `
                    <div style="max-height:320px;overflow:auto;margin-top:12px;">
                        <table class="data-table">
                            <thead><tr>
                                <th>員工編號</th><th>姓名</th>
                                <th class="num">獎金</th>
                                <th class="num">÷12</th>
                                <th class="num">稅率</th><th class="num">速扣</th>
                                <th class="num">應扣稅額</th>
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
                        <b>${calcOk ? '✔ 稅額反算核對通過' : '✘ 稅額反算核對失敗'}</b>
                        <div style="font-size:12px;margin-top:6px;">
                            逐筆手查表驗證：獎金 ÷ 12 → 月度稅率 → 獎金 × 稅率 − 速算扣除數<br>
                            合計 <b>${money(expectedTotal)}</b> vs 系統計算 <b>${money(d.totalWithheldTax)}</b>
                            ${calcOk ? '✔ 一致' : `<br><span style="color:#c00;">差異: ${mismatch}</span>`}
                        </div>
                    </div>` : ''}

                <div style="margin-top:12px;">
                    <button class="btn btn-primary" onclick="TaxUI.submitBonus()">📤 提交年終獎扣繳</button>
                </div>
                <div id="taxReceipt"></div>
            </div>`;
    },

    async submitBonus() {
        if (!this.draft.bonusBatchId) return UI.toast('請先試算年終獎', 'error');
        await this._submit('/api/tax/iit/submit', { withholdingBatchId: this.draft.bonusBatchId });
    },

    // ---------- 提交 ----------
    async submitVat() {
        if (!this.draft.declarationId) return UI.toast('請先算稅', 'error');
        await this._submit('/api/tax/vat/' + this.draft.declarationId + '/submit', {});
    },
    async submitCit() {
        if (!this.draft.settlementId) return UI.toast('請先算稅', 'error');
        await this._submit('/api/tax/cit/submit', { settlementId: this.draft.settlementId });
    },
    async submitIit() {
        if (!this.draft.withholdingBatchId) return UI.toast('請先算稅', 'error');
        await this._submit('/api/tax/iit/submit', { withholdingBatchId: this.draft.withholdingBatchId });
    },

    async _submit(url, extra) {
        const u = Auth.getUser() || {};
        try {
            const res = await API.post(url, { ...extra, operatorId: u.user_id || 'WEB_UI' });
            const r = res.data || {};
            document.getElementById('taxReceipt').innerHTML = `
                <div style="margin-top:12px;padding:12px;border-radius:8px;background:#eef9f0;">
                    <b>✔ 申報已提交</b>
                    <div style="font-size:12px;margin-top:6px;">
                        稅局受理號：<b>${esc(r.taxBureauReceiptNo || '-')}</b><br>
                        提交時間：${esc(r.submitTime || '-')}　狀態：${esc(r.status || '-')}<br>
                        繳款期限：${esc(r.paymentDeadline || '-')}
                    </div>
                </div>`;
            UI.toast('提交成功', 'success');
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
            UI.toast('增值稅調整已儲存', 'success');
        } catch (e) {
            msg.innerHTML = `<span style="color:#e74c3c">✘ ${esc(e.message)}</span>`;
        }
    },

    async loadReconcile() {
        const box = document.getElementById('inVatRecon');
        box.innerHTML = '<p style="font-size:12px;color:#888;margin-top:8px;">載入中…</p>';
        try {
            const res = await API.get('/api/tax/vat/reconcile?bu_no=' +
                encodeURIComponent(val('inVatBu')) + '&taxPeriod=' + val('inVatPeriod') +
                '&filingCycle=' + (val('inVatCycle') || 'MONTHLY') +
                '&taxpayerType=' + (val('inVatType') || '1'));
            const d = res.data || {};
            const rows = d.invoices || [];
            box.innerHTML = `
                <div style="display:flex;gap:24px;font-size:12px;margin-top:10px;color:#555;">
                    <span>所屬月：<b>${(d.periods || []).join(', ')}</b></span>
                    <span>銷項 AR：<b>${d.sales.count}</b> 張，金額 <b>${money(d.sales.amount)}</b>，稅額 <b>${money(d.sales.outputTax)}</b></span>
                    <span>進項 AP：<b>${d.purchase.count}</b> 張，金額 <b>${money(d.purchase.amount)}</b>，稅額 <b>${money(d.purchase.invoiceTax)}</b>${d.taxpayerType === 2 ? '（不抵扣）' : ''}</span>
                </div>
                <div style="max-height:280px;overflow:auto;margin-top:8px;">
                    <table class="data-table">
                        <thead><tr><th>類型</th><th>發票號</th><th>不含稅金額</th><th>稅率</th><th>稅額</th></tr></thead>
                        <tbody>${rows.map(r => `<tr>
                            <td>${r.TX_type === 'AR' ? '銷項' : '進項'}</td>
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
                hint.innerHTML = '📊 財報自動值：營業收入 <b>' + money(d.autoRevenue) +
                    '</b> / 營業成本 <b>' + money(d.autoCost) + '</b>';
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
                <option value="TAX_FREE_INCOME">免稅收入</option>
                <option value="ADJ_INCREASE">納稅調整增加</option>
                <option value="ADJ_DECREASE">納稅調整減少</option>
                <option value="TAX_EXEMPTION">減免所得稅額</option>
                <option value="TAX_CREDIT">抵免所得稅額</option>
            </select>
            <input class="adj-amt" type="number" value="${Number(amount) || 0}"
                   style="width:140px;padding:5px;border:1px solid #ddd;border-radius:6px;">
            <input class="adj-remark" placeholder="說明" value="${esc(remark || '')}"
                   style="flex:1;padding:5px;border:1px solid #ddd;border-radius:6px;">
            <button class="btn btn-danger btn-sm" onclick="this.parentNode.remove()">刪除</button>`;
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
            const parts = ['✔ 匯算參數已儲存'];
            if (d.revenueOverride != null || d.costOverride != null) {
                parts.push('（已啟用人工覆蓋）');
            } else {
                parts.push('（使用財報自動值）');
            }
            msg.textContent = parts.join('');
            UI.toast('匯算參數已儲存', 'success');
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
                box.innerHTML = '<p style="font-size:12px;color:#888;">本期尚無薪資錄入（系統將以財報平均工資估算）</p>';
                return;
            }
            box.innerHTML = `<table class="data-table">
                <thead><tr><th>員工</th><th>姓名</th><th>應發工資</th><th>三險一金</th><th>專項附加</th><th>其他扣除</th><th>操作</th></tr></thead>
                <tbody>${rows.map(r => `<tr>
                    <td>${esc(r.employee_id)}</td>
                    <td>${esc(r.employee_name || '-')}</td>
                    <td class="num">${money(r.gross_salary)}</td>
                    <td class="num">${money(r.social_insurance)}</td>
                    <td class="num">${money(r.special_deduction)}</td>
                    <td class="num">${money(r.other_deduction)}</td>
                    <td><button class="btn btn-danger btn-sm" onclick="TaxUI.delPayroll(${r.id})">刪除</button></td>
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
            UI.toast('薪資明細已儲存', 'success');
            this.loadPayroll();
        } catch (e) {
            msg.innerHTML = `<span style="color:#e74c3c">✘ ${esc(e.message)}</span>`;
        }
    },

    async delPayroll(id) {
        if (!confirm('確定刪除該員工本期薪資明細？')) return;
        try {
            await API.del('/api/tax/inputs/iit/' + id + '?bu_no=' + encodeURIComponent(val('inPayBu')));
            UI.toast('已刪除', 'success');
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
                box.innerHTML = '<p style="font-size:12px;color:#888;">本年度尚未錄入年終獎</p>';
                return;
            }
            box.innerHTML = `<table class="data-table">
                <thead><tr><th>員工</th><th>姓名</th><th class="num">獎金</th><th>計稅方式</th><th>備註</th><th>操作</th></tr></thead>
                <tbody>${rows.map(r => `<tr>
                    <td>${esc(r.employee_id)}</td>
                    <td>${esc(r.employee_name || '-')}</td>
                    <td class="num">${money(r.bonus_amount)}</td>
                    <td>${r.tax_method === 'SEPARATE' ? '<span style="color:#c67200;">單獨計稅</span>' : '<span style="color:#2c5fa8;">合併計稅</span>'}</td>
                    <td style="font-size:12px;color:#888;">${esc(r.remark || '')}</td>
                    <td><button class="btn btn-danger btn-sm" onclick="TaxUI.delBonus(${r.id})">刪除</button></td>
                </tr>`).join('')}</tbody></table>`;
        } catch (e) {
            box.innerHTML = `<p style="color:#e74c3c;font-size:12px;">✘ ${esc(e.message)}</p>`;
        }
    },

    async saveBonus() {
        const msg = document.getElementById('inBonusMsg');
        if (!val('inBonusEmp')) { msg.innerHTML = '<span style="color:#c00;">請填寫員工編號</span>'; return; }
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
            UI.toast('年終獎已儲存', 'success');
            this.loadBonus();
        } catch (e) {
            msg.innerHTML = `<span style="color:#e74c3c;">✘ ${esc(e.message)}</span>`;
        }
    },

    async delBonus(id) {
        if (!confirm('確定刪除該員工的年終獎錄入？')) return;
        try {
            await API.del('/api/tax/inputs/bonus/' + id);
            UI.toast('已刪除', 'success');
            this.loadBonus();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ---------- 異常用例自檢 ----------
    async selfCheck() {
        const box = document.getElementById('taxSelfCheck');
        box.innerHTML = '<p style="color:#888;margin-top:12px;">執行中…</p>';
        const cases = [
            ['缺 taxPeriod', '/vat/calculate', { taxpayerType: 1 }, 400],
            ['taxPeriod 格式錯誤', '/vat/calculate', { taxPeriod: '2025', taxpayerType: 1 }, 400],
            ['taxpayerType 越界', '/vat/calculate', { taxPeriod: '202512', taxpayerType: 3 }, 400],
            ['缺 bu_no', '/vat/calculate', { taxPeriod: '202512', taxpayerType: 1 }, 400],
            ['提交不存在的 ID', '/vat/not-exist/submit', { operatorId: 'SELF_CHK' }, 404]
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
                <h4 style="margin:0 0 12px;">異常用例自檢（共 ${pass} 項）</h4>
                <table class="data-table">
                    <thead><tr><th>用例</th><th>期望碼</th><th>實際碼</th><th>結論</th><th>回應訊息</th></tr></thead>
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
    return `<tr style="cursor:pointer;" onclick="${onclick}" title="點擊查看明細"
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
