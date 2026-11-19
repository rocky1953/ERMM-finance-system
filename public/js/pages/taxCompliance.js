/**
 * CFO-10 税务与合规管理页面
 * 合规评分、纳税申报日历、合规事项清单、法规政策库与风险扫描
 */
function tcEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const TC_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] ?? zh);

const TC_BUS = ['GROUP', 'HM', 'HN', 'SZ'];
const TC_TAX_TYPES = {
    VAT: TC_L('增值税', '增值稅', 'VAT'), SURCHARGE: TC_L('附加税费', '附加稅費', 'Surcharges'), IIT: TC_L('个人所得税', '個人所得稅', 'Individual Income Tax'),
    CIT: TC_L('企业所得税', '企業所得稅', 'Corporate Income Tax'), STAMP_DUTY: TC_L('印花税', '印花稅', 'Stamp Duty'), OTHER: TC_L('其他税种', '其他稅種', 'Other Taxes')
};
const TC_CYCLES = { MONTHLY: TC_L('月度', '月度', 'Monthly'), QUARTERLY: TC_L('季度', '季度', 'Quarterly'), ANNUAL: TC_L('年度', '年度', 'Annual') };
const TC_FILING_STATUS = {
    PENDING: { label: TC_L('待申报', '待申報', 'Pending'), color: '#f39c12' },
    FILED: { label: TC_L('已申报', '已申報', 'Filed'), color: '#27ae60' },
    EXEMPT: { label: TC_L('免申报', '免申報', 'Exempt'), color: '#95a5a6' },
    OVERDUE: { label: TC_L('逾期', '逾期', 'Overdue'), color: '#e74c3c' }
};
const TC_CATEGORIES = {
    INVOICE: TC_L('发票管理', '發票管理', 'Invoice Management'), CONTRACT: TC_L('合同与备案', '合同與備案', 'Contract & Filing'), ARCHIVE: TC_L('税务档案', '稅務檔案', 'Tax Archive'),
    RELATED_PARTY: TC_L('关联交易/转让定价', '關聯交易/轉讓定價', 'Related-Party / TP'), PREFERENCE: TC_L('税收优惠备案', '稅收優惠備案', 'Incentive Filing'),
    REGISTRATION: TC_L('税务登记/变更', '稅務登記/變更', 'Tax Registration/Change'), OTHER: TC_L('其他', '其他', 'Other')
};
const TC_FREQUENCIES = { MONTHLY: TC_L('月度', '月度', 'Monthly'), QUARTERLY: TC_L('季度', '季度', 'Quarterly'), ANNUAL: TC_L('年度', '年度', 'Annual'), EVENT: TC_L('按事项', '按事項', 'Per Event') };
const TC_ITEM_STATUS = {
    NOT_STARTED: { label: TC_L('未开始', '未開始', 'Not Started'), color: '#95a5a6' },
    IN_PROGRESS: { label: TC_L('进行中', '進行中', 'In Progress'), color: '#2980b9' },
    DONE: { label: TC_L('已完成', '已完成', 'Done'), color: '#27ae60' },
    WAIVED: { label: TC_L('已豁免', '已豁免', 'Waived'), color: '#8e44ad' }
};
const TC_RISK = {
    HIGH: { label: TC_L('高', '高', 'High'), color: '#e74c3c' },
    MEDIUM: { label: TC_L('中', '中', 'Medium'), color: '#f39c12' },
    LOW: { label: TC_L('低', '低', 'Low'), color: '#27ae60' }
};
const TC_REG_CATEGORIES = { CIT: TC_L('企业所得税', '企業所得稅', 'Corporate Income Tax'), VAT: TC_L('增值税', '增值稅', 'VAT'), IIT: TC_L('个人所得税', '個人所得稅', 'Individual Income Tax'), OTHER: TC_L('其他', '其他', 'Other') };
const TC_REG_STATUS = {
    NEW: { label: TC_L('待评估', '待評估', 'To Assess'), color: '#f39c12' },
    ASSESSING: { label: TC_L('评估中', '評估中', 'Assessing'), color: '#2980b9' },
    IMPLEMENTED: { label: TC_L('已落实', '已落實', 'Implemented'), color: '#27ae60' },
    ARCHIVED: { label: TC_L('已归档', '已歸檔', 'Archived'), color: '#95a5a6' }
};

const TC_TH = 'padding:8px;border:1px solid #eee;text-align:left;white-space:nowrap;';
const TC_TD = 'padding:8px;border:1px solid #eee;';

registerPage('taxCompliance', async (c) => {
    TaxCompliance.year = String(State.year());
    TaxCompliance.bu = 'ALL';
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
            <h2 style="margin:0;font-size:20px;">${TC_L('税务与合规管理', '稅務與合規管理', 'Tax & Compliance')} <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">${TC_L('：· 申报日历 · 合规事项 · 法规库', '：· 申報日曆 · 合規事項 · 法規庫', ': · Filing Calendar · Compliance Items · Regulations')}</small></h2>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <select id="tcBu" class="form-control" style="width:110px;" onchange="TaxCompliance.reload()">
                    <option value="ALL">${TC_L('全部范围', '全部範圍', 'All Scopes')}</option>
                    <option value="GROUP">${TC_L('集团', '集團', 'Group')}</option>
                    <option value="HM">HM</option><option value="HN">HN</option><option value="SZ">SZ</option>
                </select>
                <input id="tcYear" type="number" min="2000" max="2100" class="form-control" style="width:110px;" onchange="TaxCompliance.reload()">
                <button class="btn btn-outline" onclick="TaxCompliance.openGenerate()">${TC_L('📅 生成申报日历', '📅 產生申報日曆', '📅 Generate Filing Calendar')}</button>
                <button class="btn btn-primary" onclick="TaxCompliance.editFiling()">${TC_L('+ 申报任务', '+ 申報任務', '+ Filing Task')}</button>
                <button class="btn btn-outline" onclick="TaxCompliance.editItem()">${TC_L('+ 合规事项', '+ 合規事項', '+ Compliance Item')}</button>
                <button class="btn btn-outline" onclick="TaxCompliance.editReg()">${TC_L('+ 法规', '+ 法規', '+ Regulation')}</button>
                <button class="btn btn-ghost" onclick="TaxCompliance.scan()">${TC_L('🛡️ 扫描合规风险', '🛡️ 掃描合規風險', '🛡️ Scan Compliance Risks')}</button>
                <button class="btn btn-success" onclick="TaxCompliance.load()">${TC_L('刷新', '重新整理', 'Refresh')}</button>
            </div>
        </div>
        <div id="tcKpi" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:14px;"></div>
        <div id="tcAlerts"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
            <div class="card" style="margin:0;">
                <div class="card-title">${TC_L('申报待办（未来 30 天）', '申報待辦（未來 30 天）', 'Filings Due (Next 30 Days)')}</div>
                <div id="tcUpcoming">${t('loading')}</div>
            </div>
            <div class="card" style="margin:0;">
                <div class="card-title">${TC_L('分公司合规对比', '分公司合規對比', 'Branch Compliance Comparison')}</div>
                <div id="tcCompare">${t('loading')}</div>
            </div>
        </div>
        <div class="card" style="margin-bottom:14px;">
            <div class="card-title">${TC_L('纳税申报日历', '納稅申報日曆', 'Tax Filing Calendar')}</div>
            <div id="tcFilings">${t('loading')}</div>
        </div>
        <div class="card" style="margin-bottom:14px;">
            <div class="card-title">${TC_L('合规事项清单', '合規事項清單', 'Compliance Items')}</div>
            <div id="tcItems">${t('loading')}</div>
        </div>
        <div class="card">
            <div class="card-title">${TC_L('法规政策动态', '法規政策動態', 'Regulation Updates')}</div>
            <div id="tcRegs">${t('loading')}</div>
        </div>
    `;
    document.getElementById('tcBu').value = TaxCompliance.bu;
    document.getElementById('tcYear').value = TaxCompliance.year;
    await TaxCompliance.load();
});

const TaxCompliance = {
    year: String(State.year()),
    bu: 'ALL',
    data: null,

    async reload() {
        const buEl = document.getElementById('tcBu');
        const yEl = document.getElementById('tcYear');
        this.bu = buEl ? buEl.value : 'ALL';
        const y = yEl ? String(yEl.value || '').trim() : '';
        if (/^\d{4}$/.test(y)) this.year = y;
        await this.load();
    },

    async load() {
        const box = document.getElementById('tcFilings');
        if (box) box.innerHTML = t('loading');
        try {
            const res = await API.get(`/api/tax-compliance/overview?bu_no=${encodeURIComponent(this.bu)}&YYYY=${encodeURIComponent(this.year)}`);
            this.data = res.data;
            this.year = res.data.YYYY;
            const yEl = document.getElementById('tcYear');
            if (yEl) yEl.value = this.year;
            this.render();
        } catch (e) {
            if (box) box.innerHTML = `<p style="color:#e74c3c">${tcEsc(e.message)}</p>`;
        }
    },

    render() {
        this.renderKpis();
        this.renderAlerts();
        this.renderUpcoming();
        this.renderCompare();
        this.renderFilings();
        this.renderItems();
        this.renderRegs();
    },

    pct(v) { return v == null ? '-' : `${UI.fmt(v, 1)} %`; },

    badge(text, color) {
        return `<span style="color:${color};font-weight:600;">● ${tcEsc(text)}</span>`;
    },

    filingStatus(f) {
        const s = TC_FILING_STATUS[f.status] || { label: f.status, color: '#95a5a6' };
        if (f.late) return `<span style="color:#e67e22;font-weight:600;">● ${tcEsc(s.label)}${TC_L('（迟报）', '（遲報）', ' (late)')}</span>`;
        return this.badge(s.label, s.color);
    },

    renderKpis() {
        const d = this.data;
        const s = d.score || {};
        const k = d.kpis || {};
        const scoreColor = s.value == null ? '#95a5a6'
            : (s.value >= 90 ? '#27ae60' : s.value >= 80 ? '#2980b9' : s.value >= 70 ? '#f39c12' : '#e74c3c');
        const cards = [
            [TC_L('合规评分', '合規評分', 'Compliance Score'), s.value == null ? '-' : UI.fmt(s.value, 1), s.grade && s.grade !== '-' ? `${TC_L('等级', '等級', 'Grade')} ${s.grade} · ${s.grade_label}` : TC_L('无数据', '無資料', 'No data'), scoreColor],
            [TC_L('申报及时率', '申報及時率', 'On-time Filing Rate'), this.pct(k.on_time_rate), `${TC_L('已申报', '已申報', 'Filed')} ${k.filing_filed || 0} / ${k.filing_total || 0} ${TC_L('项', '項', 'items')}`, '#2980b9'],
            [TC_L('逾期申报', '逾期申報', 'Overdue Filings'), `${k.filing_overdue || 0} ${TC_L('项', '項', 'items')}`, `${TC_L('7 天内到期', '7 天內到期', 'Due in 7 days:')} ${k.filing_due_soon || 0}${TC_L(' 项', ' 項', '')}`, (k.filing_overdue ? '#e74c3c' : '#27ae60')],
            [TC_L('合规事项完成率', '合規事項完成率', 'Item Completion Rate'), this.pct(k.completion_rate), `${TC_L('已完成', '已完成', 'Done')} ${k.item_done || 0} / ${k.item_total || 0} ${TC_L('项', '項', 'items')}`, '#8e44ad'],
            [TC_L('逾期事项', '逾期事項', 'Overdue Items'), `${k.item_overdue || 0} ${TC_L('项', '項', 'items')}`, `${TC_L('高风险未完成', '高風險未完成', 'High-risk open:')} ${k.item_high_risk_open || 0}${TC_L(' 项', ' 項', '')}`, (k.item_overdue ? '#e74c3c' : '#27ae60')],
            [TC_L('法规落实率', '法規落實率', 'Regulation Implementation'), this.pct(k.reg_implement_rate), `${TC_L('已落实', '已落實', 'Implemented')} ${k.reg_implemented || 0} / ${k.reg_total || 0} ${TC_L('项', '項', 'items')}`, '#16a085']
        ];
        document.getElementById('tcKpi').innerHTML = cards.map(([label, val, sub, color]) => `
            <div class="card" style="margin:0;padding:14px;">
                <div style="font-size:12px;color:#7f8c8d;">${label}</div>
                <div style="font-size:22px;font-weight:700;color:${color};margin-top:4px;">${val}</div>
                <div style="font-size:12px;color:#95a5a6;margin-top:2px;">${sub}</div>
            </div>`).join('');
    },

    renderAlerts() {
        const list = this.data.alerts || [];
        const el = document.getElementById('tcAlerts');
        if (!list.length) {
            el.innerHTML = `<div style="background:#eafaf1;border-left:4px solid #27ae60;padding:10px 12px;border-radius:6px;margin-bottom:12px;font-size:13px;">${TC_L('✅ 当前范围无合规预警', '✅ 當前範圍無合規預警', '✅ No compliance alerts in current scope')}</div>`;
            return;
        }
        el.innerHTML = list.map(a => {
            const color = a.level === 'danger' ? '#e74c3c' : '#f39c12';
            const bg = a.level === 'danger' ? '#fdedec' : '#fef5e7';
            return `<div style="background:${bg};border-left:4px solid ${color};padding:10px 12px;border-radius:6px;margin-bottom:8px;">
                <div style="font-size:13px;font-weight:600;color:${color};">${tcEsc(I18N.fixAlert(a.message))}</div>
                <div style="font-size:12px;color:#555;margin-top:2px;">💡 ${tcEsc(I18N.fixAlert(a.suggestion || ''))}</div>
            </div>`;
        }).join('');
    },

    renderUpcoming() {
        const el = document.getElementById('tcUpcoming');
        const rows = this.data.upcomings || [];
        if (!rows.length) {
            el.innerHTML = `<div style="padding:14px;font-size:13px;color:#27ae60;">${TC_L('✅ 未来 30 天无待申报任务', '✅ 未來 30 天無待申報任務', '✅ No filings due in next 30 days')}</div>`;
            return;
        }
        el.innerHTML = `
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#f8f9fa;">
                    <th style="${TC_TH}">${TC_L('所属期', '所屬期', 'Period')}</th>
                    <th style="${TC_TH}">${TC_L('税种', '稅種', 'Tax Type')}</th>
                    <th style="${TC_TH}">${TC_L('截止日', '截止日', 'Due Date')}</th>
                    <th style="${TC_TH}">${TC_L('责任人', '責任人', 'Owner')}</th>
                </tr></thead>
                <tbody>
                    ${rows.slice(0, 8).map(f => `<tr>
                        <td style="${TC_TD}">${tcEsc(f.tax_period || '-')}</td>
                        <td style="${TC_TD}">${tcEsc(f.tax_type_name)}${f.bu_no ? ` · ${tcEsc(f.bu_no)}` : ''}</td>
                        <td style="${TC_TD}">${UI.fmtDate(f.due_date)}</td>
                        <td style="${TC_TD}">${tcEsc(f.owner_id || '-')}</td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
    },

    renderCompare() {
        const el = document.getElementById('tcCompare');
        const rows = this.data.compare || [];
        const gradeColor = (g) => g === 'A' ? '#27ae60' : g === 'B' ? '#2980b9' : g === 'C' ? '#f39c12' : g === 'D' ? '#e74c3c' : '#95a5a6';
        el.innerHTML = `
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#f8f9fa;">
                    <th style="${TC_TH}">${TC_L('公司', '公司', 'Company')}</th>
                    <th style="${TC_TH}">${TC_L('评分', '評分', 'Score')}</th>
                    <th style="${TC_TH}">${TC_L('等级', '等級', 'Grade')}</th>
                    <th style="${TC_TH}">${TC_L('及时率', '及時率', 'On-time')}</th>
                    <th style="${TC_TH}">${TC_L('完成率', '完成率', 'Completion')}</th>
                    <th style="${TC_TH}">${TC_L('逾期', '逾期', 'Overdue')}</th>
                </tr></thead>
                <tbody>
                    ${rows.map(r => `<tr>
                        <td style="${TC_TD}">${tcEsc(r.bu_no)}</td>
                        <td style="${TC_TD}">${r.score == null ? '-' : UI.fmt(r.score, 1)}</td>
                        <td style="${TC_TD};color:${gradeColor(r.grade)};font-weight:600;">${tcEsc(r.grade)}</td>
                        <td style="${TC_TD}">${this.pct(r.on_time_rate)}</td>
                        <td style="${TC_TD}">${this.pct(r.completion_rate)}</td>
                        <td style="${TC_TD};color:${(r.filing_overdue + r.item_overdue) ? '#e74c3c' : '#27ae60'};">${r.filing_overdue} / ${r.item_overdue}</td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
    },

    renderFilings() {
        const el = document.getElementById('tcFilings');
        const rows = this.data.filings || [];
        if (!rows.length) {
            el.innerHTML = UI.empty('📅', TC_L('本年度尚无申报任务，可点击「生成申报日历」批量建立', '本年度尚無申報任務，可點擊「產生申報日曆」批量建立', 'No filing tasks this year; click "Generate Filing Calendar" to create in batch'));
            return;
        }
        const showBu = this.bu === 'ALL' || this.bu === 'GROUP';
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#f8f9fa;">
                    ${showBu ? `<th style="${TC_TH}">${TC_L('公司', '公司', 'Company')}</th>` : ''}
                    <th style="${TC_TH}">${TC_L('所属期', '所屬期', 'Period')}</th>
                    <th style="${TC_TH}">${TC_L('税种', '稅種', 'Tax Type')}</th>
                    <th style="${TC_TH}">${TC_L('周期', '週期', 'Cycle')}</th>
                    <th style="${TC_TH}">${TC_L('截止日', '截止日', 'Due Date')}</th>
                    <th style="${TC_TH}">${TC_L('申报日', '申報日', 'Filed On')}</th>
                    <th style="${TC_TH}">${TC_L('状态', '狀態', 'Status')}</th>
                    <th style="${TC_TH};text-align:right;">${TC_L('税额', '稅額', 'Tax Amt')}</th>
                    <th style="${TC_TH}">${TC_L('回执号', '回執號', 'Receipt No.')}</th>
                    <th style="${TC_TH}">${TC_L('负责人', '負責人', 'Owner')}</th>
                    <th style="${TC_TH}">${TC_L('操作', '操作', 'Actions')}</th>
                </tr></thead>
                <tbody>
                    ${rows.map(f => `<tr>
                        ${showBu ? `<td style="${TC_TD}">${tcEsc(f.bu_no)}</td>` : ''}
                        <td style="${TC_TD}">${tcEsc(f.tax_period || '-')}</td>
                        <td style="${TC_TD}">${tcEsc(f.tax_type_name)}</td>
                        <td style="${TC_TD}">${tcEsc(f.cycle_name)}</td>
                        <td style="${TC_TD}">${UI.fmtDate(f.due_date)}</td>
                        <td style="${TC_TD}">${f.filed_date ? UI.fmtDate(f.filed_date) : '-'}</td>
                        <td style="${TC_TD}">${this.filingStatus(f)}</td>
                        <td style="${TC_TD};text-align:right;">${UI.fmt(f.tax_amount)}</td>
                        <td style="${TC_TD}">${tcEsc(f.receipt_no || '-')}</td>
                        <td style="${TC_TD}">${tcEsc(f.owner_id || '-')}</td>
                        <td style="${TC_TD};white-space:nowrap;">
                            <button class="btn btn-ghost" style="padding:2px 6px;" onclick="TaxCompliance.editFiling(${f.uid})">✏️</button>
                            <button class="btn btn-ghost" style="padding:2px 6px;" onclick="TaxCompliance.delFiling(${f.uid})">🗑️</button>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
    },

    renderItems() {
        const el = document.getElementById('tcItems');
        const rows = this.data.items || [];
        if (!rows.length) {
            el.innerHTML = UI.empty('📋', TC_L('本年度尚无合规事项，可点击「+ 合规事项」建立', '本年度尚無合規事項，可點擊「+ 合規事項」建立', 'No compliance items this year; click "+ Compliance Item" to add'));
            return;
        }
        const showBu = this.bu === 'ALL' || this.bu === 'GROUP';
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#f8f9fa;">
                    ${showBu ? `<th style="${TC_TH}">${TC_L('公司', '公司', 'Company')}</th>` : ''}
                    <th style="${TC_TH}">${TC_L('合规事项', '合規事項', 'Item')}</th>
                    <th style="${TC_TH}">${TC_L('分类', '分類', 'Category')}</th>
                    <th style="${TC_TH}">${TC_L('频率', '頻率', 'Frequency')}</th>
                    <th style="${TC_TH}">${TC_L('责任人', '責任人', 'Owner')}</th>
                    <th style="${TC_TH}">${TC_L('完成期限', '完成期限', 'Deadline')}</th>
                    <th style="${TC_TH}">${TC_L('状态', '狀態', 'Status')}</th>
                    <th style="${TC_TH}">${TC_L('风险', '風險', 'Risk')}</th>
                    <th style="${TC_TH}">${TC_L('操作', '操作', 'Actions')}</th>
                </tr></thead>
                <tbody>
                    ${rows.map(i => {
                        const st = TC_ITEM_STATUS[i.status] || { label: i.status, color: '#95a5a6' };
                        const rk = TC_RISK[i.risk_level] || { label: i.risk_level, color: '#95a5a6' };
                        return `<tr>
                            ${showBu ? `<td style="${TC_TD}">${tcEsc(i.bu_no)}</td>` : ''}
                            <td style="${TC_TD}">${tcEsc(i.item_name)}${i.requirement ? `<div style="font-size:11px;color:#95a5a6;">${tcEsc(i.requirement)}</div>` : ''}</td>
                            <td style="${TC_TD}">${tcEsc(i.category_name)}</td>
                            <td style="${TC_TD}">${tcEsc(i.frequency_name)}</td>
                            <td style="${TC_TD}">${tcEsc(i.owner_id || i.owner_dept || '-')}</td>
                            <td style="${TC_TD};color:${i.overdue ? '#e74c3c' : '#333'};">${i.due_date ? UI.fmtDate(i.due_date) : '-'}${i.overdue ? ' ⚠️' : ''}</td>
                            <td style="${TC_TD}">${this.badge(st.label, st.color)}</td>
                            <td style="${TC_TD}">${this.badge(rk.label, rk.color)}</td>
                            <td style="${TC_TD};white-space:nowrap;">
                                <button class="btn btn-ghost" style="padding:2px 6px;" onclick="TaxCompliance.editItem(${i.uid})">✏️</button>
                                <button class="btn btn-ghost" style="padding:2px 6px;" onclick="TaxCompliance.delItem(${i.uid})">🗑️</button>
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
            </div>`;
    },

    renderRegs() {
        const el = document.getElementById('tcRegs');
        const rows = this.data.regulations || [];
        if (!rows.length) {
            el.innerHTML = UI.empty('📜', TC_L('本年度尚无法规记录，可点击「+ 法规」登记', '本年度尚無法規記錄，可點擊「+ 法規」登記', 'No regulations this year; click "+ Regulation" to add'));
            return;
        }
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#f8f9fa;">
                    <th style="${TC_TH}">${TC_L('法规/政策', '法規/政策', 'Regulation/Policy')}</th>
                    <th style="${TC_TH}">${TC_L('类别', '類別', 'Category')}</th>
                    <th style="${TC_TH}">${TC_L('发文机关', '發文機關', 'Issuing Body')}</th>
                    <th style="${TC_TH}">${TC_L('生效日', '生效日', 'Effective Date')}</th>
                    <th style="${TC_TH}">${TC_L('影响', '影響', 'Impact')}</th>
                    <th style="${TC_TH}">${TC_L('状态', '狀態', 'Status')}</th>
                    <th style="${TC_TH}">${TC_L('落实行动', '落實行動', 'Action')}</th>
                    <th style="${TC_TH}">${TC_L('操作', '操作', 'Actions')}</th>
                </tr></thead>
                <tbody>
                    ${rows.map(r => {
                        const st = TC_REG_STATUS[r.status] || { label: r.status, color: '#95a5a6' };
                        const im = TC_RISK[r.impact_level] || { label: r.impact_level, color: '#95a5a6' };
                        return `<tr>
                            <td style="${TC_TD}">${tcEsc(r.title)}${r.reg_code ? `<div style="font-size:11px;color:#95a5a6;">${tcEsc(r.reg_code)}</div>` : ''}</td>
                            <td style="${TC_TD}">${tcEsc(r.category_name)}</td>
                            <td style="${TC_TD}">${tcEsc(r.issue_org || '-')}</td>
                            <td style="${TC_TD}">${r.effective_date ? UI.fmtDate(r.effective_date) : '-'}</td>
                            <td style="${TC_TD}">${this.badge(im.label, im.color)}</td>
                            <td style="${TC_TD}">${this.badge(st.label, st.color)}</td>
                            <td style="${TC_TD};max-width:240px;">${tcEsc(r.action_required || '-')}</td>
                            <td style="${TC_TD};white-space:nowrap;">
                                <button class="btn btn-ghost" style="padding:2px 6px;" onclick="TaxCompliance.editReg(${r.uid})">✏️</button>
                                <button class="btn btn-ghost" style="padding:2px 6px;" onclick="TaxCompliance.delReg(${r.uid})">🗑️</button>
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
            </div>`;
    },

    // ============ 申报任务 ============
    editFiling(uid) {
        const row = uid ? (this.data.filings || []).find(f => f.uid === uid) : null;
        const bu = row ? row.bu_no : (this.bu === 'ALL' || this.bu === 'GROUP' ? 'HM' : this.bu);
        UI.modal(row ? TC_L('编辑申报任务', '編輯申報任務', 'Edit Filing Task') : TC_L('新增申报任务', '新增申報任務', 'New Filing Task'), `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <label>${TC_L('公司别', '公司別', 'Company')}<select id="tcFBu" class="form-control">${TC_BUS.map(b => `<option value="${b}" ${b === bu ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
                <label>${TC_L('纳税年度', '納稅年度', 'Tax Year')}<input id="tcFYear" class="form-control" value="${row ? row.tax_year : this.year}"></label>
                <label>${TC_L('所属期', '所屬期', 'Period')}<input id="tcFPeriod" type="month" class="form-control" value="${row ? row.tax_period : `${this.year}-12`}"></label>
                <label>${TC_L('税种', '稅種', 'Tax Type')}<select id="tcFType" class="form-control">${Object.entries(TC_TAX_TYPES).map(([k, v]) => `<option value="${k}" ${row && row.tax_type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
                <label>${TC_L('申报周期', '申報週期', 'Filing Cycle')}<select id="tcFCycle" class="form-control">${Object.entries(TC_CYCLES).map(([k, v]) => `<option value="${k}" ${row && row.filing_cycle === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
                <label>${TC_L('截止日', '截止日', 'Due Date')}<input id="tcFDue" type="date" class="form-control" value="${row ? row.due_date : `${this.year}-12-15`}"></label>
                <label>${TC_L('申报状态', '申報狀態', 'Filing Status')}<select id="tcFStatus" class="form-control">
                    <option value="PENDING" ${!row || row.status === 'PENDING' ? 'selected' : ''}>${TC_L('待申报', '待申報', 'Pending')}</option>
                    <option value="FILED" ${row && row.status === 'FILED' ? 'selected' : ''}>${TC_L('已申报', '已申報', 'Filed')}</option>
                    <option value="EXEMPT" ${row && row.status === 'EXEMPT' ? 'selected' : ''}>${TC_L('免申报', '免申報', 'Exempt')}</option>
                </select></label>
                <label>${TC_L('实际申报日', '實際申報日', 'Actual Filed Date')}<input id="tcFFiled" type="date" class="form-control" value="${row && row.filed_date ? row.filed_date : ''}"></label>
                <label>${TC_L('申报税额', '申報稅額', 'Tax Amount')}<input id="tcFAmount" type="number" step="0.01" class="form-control" value="${row ? row.tax_amount : 0}"></label>
                <label>${TC_L('回执号', '回執號', 'Receipt No.')}<input id="tcFReceipt" class="form-control" value="${row ? tcEsc(row.receipt_no || '') : ''}"></label>
                <label>${TC_L('负责人', '負責人', 'Owner')}<input id="tcFOwner" class="form-control" value="${row ? tcEsc(row.owner_id || '') : ''}"></label>
                <label>${TC_L('备注', '備註', 'Note')}<input id="tcFNote" class="form-control" value="${row ? tcEsc(row.note || '') : ''}"></label>
            </div>
        `, `<button class="btn btn-outline" onclick="UI.closeModal()">${TC_L('取消', '取消', 'Cancel')}</button>
            <button class="btn btn-primary" onclick="TaxCompliance.saveFiling(${row ? row.uid : 'null'})">${TC_L('保存', '儲存', 'Save')}</button>`);
    },

    async saveFiling(uid) {
        const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
        const body = {
            bu_no: val('tcFBu'),
            tax_year: val('tcFYear'),
            tax_period: val('tcFPeriod'),
            tax_type: val('tcFType'),
            filing_cycle: val('tcFCycle'),
            due_date: val('tcFDue'),
            status: val('tcFStatus'),
            filed_date: val('tcFFiled') || null,
            tax_amount: val('tcFAmount') || 0,
            receipt_no: val('tcFReceipt'),
            owner_id: val('tcFOwner'),
            note: val('tcFNote')
        };
        try {
            if (uid) await API.put(`/api/tax-compliance/filing-tasks/${uid}`, body);
            else await API.post('/api/tax-compliance/filing-tasks', body);
            UI.closeModal(); UI.toast(TC_L('已保存', '已儲存', 'Saved'), 'success');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async delFiling(uid) {
        if (!confirm(TC_L('确认删除该申报任务？', '確認刪除該申報任務？', 'Delete this filing task?'))) return;
        try {
            await API.del(`/api/tax-compliance/filing-tasks/${uid}`);
            UI.toast(TC_L('已删除', '已刪除', 'Deleted'), 'success');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    openGenerate() {
        const bu = this.bu === 'ALL' || this.bu === 'GROUP' ? 'HM' : this.bu;
        UI.modal(TC_L('生成申报日历', '產生申報日曆', 'Generate Filing Calendar'), `
            <p style="font-size:13px;color:#555;margin-top:0;">${TC_L('按标准税种（增值税、附加税费、个税、企业所得税、印花税）与法定截止日批量生成年度任务，已存在的任务不会覆盖。', '按標準稅種（增值稅、附加稅費、個稅、企業所得稅、印花稅）與法定截止日批量產生年度任務，已存在的任務不會覆蓋。', 'Batch-generate annual tasks by standard tax types (VAT, surcharges, IIT, CIT, stamp duty) and statutory deadlines. Existing tasks are not overwritten.')}</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <label>${TC_L('公司别', '公司別', 'Company')}<select id="tcGBu" class="form-control">
                    <option value="HM" ${bu === 'HM' ? 'selected' : ''}>HM</option>
                    <option value="HN" ${bu === 'HN' ? 'selected' : ''}>HN</option>
                    <option value="SZ" ${bu === 'SZ' ? 'selected' : ''}>SZ</option>
                </select></label>
                <label>${TC_L('纳税年度', '納稅年度', 'Tax Year')}<input id="tcGYear" class="form-control" value="${this.year}"></label>
            </div>
        `, `<button class="btn btn-outline" onclick="UI.closeModal()">${TC_L('取消', '取消', 'Cancel')}</button>
            <button class="btn btn-primary" onclick="TaxCompliance.doGenerate()">${TC_L('生成', '產生', 'Generate')}</button>`);
    },

    async doGenerate() {
        const bu = document.getElementById('tcGBu').value;
        const year = document.getElementById('tcGYear').value.trim();
        try {
            const res = await API.post('/api/tax-compliance/filing-tasks/generate', { bu_no: bu, YYYY: year });
            UI.closeModal();
            UI.toast(res.message || `${TC_L('已生成', '已產生', 'Generated')} ${res.data.generated} ${TC_L('项', '項', 'items')}`, 'success');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ============ 合规事项 ============
    editItem(uid) {
        const row = uid ? (this.data.items || []).find(i => i.uid === uid) : null;
        const bu = row ? row.bu_no : (this.bu === 'ALL' || this.bu === 'GROUP' ? 'HM' : this.bu);
        const opt = (map, cur) => Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v.label || v}</option>`).join('');
        UI.modal(row ? TC_L('编辑合规事项', '編輯合規事項', 'Edit Compliance Item') : TC_L('新增合规事项', '新增合規事項', 'New Compliance Item'), `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <label>${TC_L('公司别', '公司別', 'Company')}<select id="tcIBu" class="form-control">${TC_BUS.map(b => `<option value="${b}" ${b === bu ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
                <label>${TC_L('纳税年度', '納稅年度', 'Tax Year')}<input id="tcIYear" class="form-control" value="${row ? row.tax_year : this.year}"></label>
                <label>${TC_L('分类', '分類', 'Category')}<select id="tcICat" class="form-control">${opt(TC_CATEGORIES, row ? row.category : 'INVOICE')}</select></label>
                <label>${TC_L('频率', '頻率', 'Frequency')}<select id="tcIFreq" class="form-control">${opt(TC_FREQUENCIES, row ? row.frequency : 'MONTHLY')}</select></label>
                <label style="grid-column:1/3;">${TC_L('事项名称', '事項名稱', 'Item Name')}<input id="tcIName" class="form-control" value="${row ? tcEsc(row.item_name) : ''}"></label>
                <label style="grid-column:1/3;">${TC_L('合规要求', '合規要求', 'Requirement')}<input id="tcIReq" class="form-control" value="${row ? tcEsc(row.requirement || '') : ''}"></label>
                <label>${TC_L('责任部门', '責任部門', 'Responsible Dept')}<input id="tcIDept" class="form-control" value="${row ? tcEsc(row.owner_dept || '') : ''}"></label>
                <label>${TC_L('责任人', '責任人', 'Owner')}<input id="tcIOwner" class="form-control" value="${row ? tcEsc(row.owner_id || '') : ''}"></label>
                <label>${TC_L('完成期限', '完成期限', 'Deadline')}<input id="tcIDue" type="date" class="form-control" value="${row ? (row.due_date || '') : ''}"></label>
                <label>${TC_L('实际完成日', '實際完成日', 'Actual Completion')}<input id="tcIDone" type="date" class="form-control" value="${row && row.completed_date ? row.completed_date : ''}"></label>
                <label>${TC_L('状态', '狀態', 'Status')}<select id="tcIStatus" class="form-control">${opt({ NOT_STARTED: TC_L('未开始', '未開始', 'Not Started'), IN_PROGRESS: TC_L('进行中', '進行中', 'In Progress'), DONE: TC_L('已完成', '已完成', 'Done'), WAIVED: TC_L('已豁免', '已豁免', 'Waived') }, row ? row.status : 'NOT_STARTED')}</select></label>
                <label>${TC_L('风险等级', '風險等級', 'Risk Level')}<select id="tcIRisk" class="form-control">${opt({ HIGH: TC_L('高', '高', 'High'), MEDIUM: TC_L('中', '中', 'Medium'), LOW: TC_L('低', '低', 'Low') }, row ? row.risk_level : 'MEDIUM')}</select></label>
                <label style="grid-column:1/3;">${TC_L('留档/证据', '留檔/證據', 'Evidence')}<input id="tcIEvidence" class="form-control" value="${row ? tcEsc(row.evidence || '') : ''}"></label>
                <label style="grid-column:1/3;">${TC_L('备注', '備註', 'Note')}<input id="tcINote" class="form-control" value="${row ? tcEsc(row.note || '') : ''}"></label>
            </div>
        `, `<button class="btn btn-outline" onclick="UI.closeModal()">${TC_L('取消', '取消', 'Cancel')}</button>
            <button class="btn btn-primary" onclick="TaxCompliance.saveItem(${row ? row.uid : 'null'})">${TC_L('保存', '儲存', 'Save')}</button>`);
    },

    async saveItem(uid) {
        const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
        const body = {
            bu_no: val('tcIBu'),
            tax_year: val('tcIYear'),
            category: val('tcICat'),
            frequency: val('tcIFreq'),
            item_name: val('tcIName'),
            requirement: val('tcIReq'),
            owner_dept: val('tcIDept'),
            owner_id: val('tcIOwner'),
            due_date: val('tcIDue') || null,
            completed_date: val('tcIDone') || null,
            status: val('tcIStatus'),
            risk_level: val('tcIRisk'),
            evidence: val('tcIEvidence'),
            note: val('tcINote')
        };
        try {
            if (uid) await API.put(`/api/tax-compliance/compliance-items/${uid}`, body);
            else await API.post('/api/tax-compliance/compliance-items', body);
            UI.closeModal(); UI.toast(TC_L('已保存', '已儲存', 'Saved'), 'success');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async delItem(uid) {
        if (!confirm(TC_L('确认删除该合规事项？', '確認刪除該合規事項？', 'Delete this compliance item?'))) return;
        try {
            await API.del(`/api/tax-compliance/compliance-items/${uid}`);
            UI.toast(TC_L('已删除', '已刪除', 'Deleted'), 'success');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ============ 法规库 ============
    editReg(uid) {
        const row = uid ? (this.data.regulations || []).find(r => r.uid === uid) : null;
        const opt = (map, cur) => Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v.label || v}</option>`).join('');
        UI.modal(row ? TC_L('编辑法规', '編輯法規', 'Edit Regulation') : TC_L('新增法规', '新增法規', 'New Regulation'), `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <label>${TC_L('法规文号', '法規文號', 'Reg. No.')}<input id="tcRCode" class="form-control" value="${row ? tcEsc(row.reg_code || '') : ''}"></label>
                <label>${TC_L('类别', '類別', 'Category')}<select id="tcRCat" class="form-control">${opt(TC_REG_CATEGORIES, row ? row.category : 'OTHER')}</select></label>
                <label style="grid-column:1/3;">${TC_L('法规名称', '法規名稱', 'Regulation Name')}<input id="tcRTitle" class="form-control" value="${row ? tcEsc(row.title) : ''}"></label>
                <label>${TC_L('发文机关', '發文機關', 'Issuing Body')}<input id="tcROrg" class="form-control" value="${row ? tcEsc(row.issue_org || '') : ''}"></label>
                <label>${TC_L('影响等级', '影響等級', 'Impact Level')}<select id="tcRImpact" class="form-control">${opt({ HIGH: TC_L('高', '高', 'High'), MEDIUM: TC_L('中', '中', 'Medium'), LOW: TC_L('低', '低', 'Low') }, row ? row.impact_level : 'MEDIUM')}</select></label>
                <label>${TC_L('发布日期', '發布日期', 'Published')}<input id="tcRPublish" type="date" class="form-control" value="${row && row.publish_date ? row.publish_date : ''}"></label>
                <label>${TC_L('生效日期', '生效日期', 'Effective Date')}<input id="tcREffective" type="date" class="form-control" value="${row && row.effective_date ? row.effective_date : ''}"></label>
                <label>${TC_L('落实状态', '落實狀態', 'Implementation Status')}<select id="tcRStatus" class="form-control">${opt({ NEW: TC_L('待评估', '待評估', 'To Assess'), ASSESSING: TC_L('评估中', '評估中', 'Assessing'), IMPLEMENTED: TC_L('已落实', '已落實', 'Implemented'), ARCHIVED: TC_L('已归档', '已歸檔', 'Archived') }, row ? row.status : 'NEW')}</select></label>
                <label>${TC_L('跟进人', '跟進人', 'Follow-up Owner')}<input id="tcROwner" class="form-control" value="${row ? tcEsc(row.owner_id || '') : ''}"></label>
                <label style="grid-column:1/3;">${TC_L('需采取的行动', '需採取的行動', 'Required Action')}<input id="tcRAction" class="form-control" value="${row ? tcEsc(row.action_required || '') : ''}"></label>
                <label style="grid-column:1/3;">${TC_L('要点摘要', '要點摘要', 'Summary')}<textarea id="tcRSummary" class="form-control" rows="3">${row ? tcEsc(row.summary || '') : ''}</textarea></label>
            </div>
        `, `<button class="btn btn-outline" onclick="UI.closeModal()">${TC_L('取消', '取消', 'Cancel')}</button>
            <button class="btn btn-primary" onclick="TaxCompliance.saveReg(${row ? row.uid : 'null'})">${TC_L('保存', '儲存', 'Save')}</button>`);
    },

    async saveReg(uid) {
        const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
        const body = {
            reg_code: val('tcRCode'),
            category: val('tcRCat'),
            title: val('tcRTitle'),
            issue_org: val('tcROrg'),
            impact_level: val('tcRImpact'),
            publish_date: val('tcRPublish') || null,
            effective_date: val('tcREffective') || null,
            status: val('tcRStatus'),
            owner_id: val('tcROwner'),
            action_required: val('tcRAction'),
            summary: document.getElementById('tcRSummary') ? document.getElementById('tcRSummary').value : ''
        };
        try {
            if (uid) await API.put(`/api/tax-compliance/regulations/${uid}`, body);
            else await API.post('/api/tax-compliance/regulations', body);
            UI.closeModal(); UI.toast(TC_L('已保存', '已儲存', 'Saved'), 'success');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async delReg(uid) {
        if (!confirm(TC_L('确认删除该法规记录？', '確認刪除該法規記錄？', 'Delete this regulation record?'))) return;
        try {
            await API.del(`/api/tax-compliance/regulations/${uid}`);
            UI.toast(TC_L('已删除', '已刪除', 'Deleted'), 'success');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ============ 风险扫描 ============
    async scan() {
        try {
            const res = await API.post('/api/tax-compliance/scan', { bu_no: this.bu, YYYY: this.year });
            UI.toast(res.message || TC_L('扫描完成', '掃描完成', 'Scan completed'), 'success');
            await this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};
