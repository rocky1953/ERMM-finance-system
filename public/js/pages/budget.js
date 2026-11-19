/**
 * 预算编制页面
 * 预算编制录入（RMB）、审批流程、预算 vs 实际差异分析
 */
const BD_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] ?? zh);

const BUDGET_BUS = ['HM', 'HN', 'SZ'];
const BUDGET_YEARS = ['2026', '2025', '2024'];
const BUDGET_STATUS = {
    draft: { text: '草稿', tw: '草稿', en: 'Draft', color: '#f39c12' },
    submitted: { text: '已提交审批', tw: '已提交審批', en: 'Submitted for Approval', color: '#2563eb' },
    approved: { text: '已审批通过', tw: '已審批通過', en: 'Approved', color: '#27ae60' },
    rejected: { text: '已驳回', tw: '已駁回', en: 'Rejected', color: '#e74c3c' }
};
function bdActionLabel(a) {
    return {
        SUBMIT: BD_L('提交审批', '提交審批', 'Submit for Approval'),
        APPROVE: BD_L('审批通过', '審批通過', 'Approve'),
        REJECT: BD_L('驳回', '駁回', 'Reject')
    }[a] || a;
}

let bdHeader = null;      // 当前预算主表
let bdDetails = [];       // 预算明细
let bdLogs = [];          // 审批日志
let bdAccounts = [];      // 可录入科目

registerPage('budget', async (c) => {
    const buOptions = BUDGET_BUS.map(v => `<option value="${v}">${v}</option>`).join('');
    // 年度下拉：預設選「畫面最上方」的全域年度，並保留既有資料年度可選
    const gy = String(State.year());
    const yrOptions = [...new Set([gy, ...BUDGET_YEARS])]
        .sort((a, b) => Number(b) - Number(a))
        .map(v => `<option value="${v}">${v}</option>`).join('');
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h2 style="margin:0;font-size:20px;">${BD_L('预算编制与执行', '預算編制與執行', 'Budget Planning & Execution')} <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">${BD_L('编制录入 · 审批 · 预算 vs 实际', '編制錄入 · 審批 · 預算 vs 實際', 'Entry · Approval · Budget vs Actual')}</small></h2>
            <div>
                <select id="bdBu" onchange="loadBudget()" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                    ${buOptions}
                </select>
                <select id="bdYear" onchange="loadBudget()" style="padding:7px;border:1px solid #ddd;border-radius:6px;margin-left:6px;">
                    ${yrOptions}
                </select>
            </div>
        </div>
        <div id="bdSummary">${t('loading')}</div>
        <div class="card" style="margin-top:16px;">
            <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
                <span>${BD_L('预算编制录入（币别：RMB）', '預算編制錄入（幣別：RMB）', 'Budget Entry (Currency: RMB)')} <span id="bdStatusTag"></span></span>
                <span id="bdActions"></span>
            </div>
            <div id="bdEntry">${t('loading')}</div>
            <div id="bdLog" style="margin-top:14px;"></div>
        </div>
        <div class="card" style="margin-top:16px;"><div class="card-title">${BD_L('年度预算执行进度', '年度預算執行進度', 'Annual Budget Progress')}</div><div id="bdChart">${t('loading')}</div></div>
        <div class="card" style="margin-top:16px;"><div class="card-title">${BD_L('各科目预算 vs 实际', '各科目預算 vs 實際', 'Budget vs Actual by Account')}</div><div id="bdTable">${t('loading')}</div></div>
    `;
    document.getElementById('bdBu').value = BUDGET_BUS.includes(State.bu_no) ? State.bu_no : 'HM';
    document.getElementById('bdYear').value = gy;
    await loadBudget();
});

async function loadBudget() {
    const bu = document.getElementById('bdBu').value;
    const yr = document.getElementById('bdYear').value;
    State.bu_no = bu;
    try {
        const [sumRes, progRes, detRes, headRes] = await Promise.all([
            API.get(`/api/budget/summary?bu_no=${bu}&YYYY=${yr}`),
            API.get(`/api/budget/monthly-progress?bu_no=${bu}&YYYY=${yr}`),
            API.get(`/api/budget/detail?bu_no=${bu}&YYYY=${yr}`),
            API.get(`/api/budget/header?bu_no=${bu}&YYYY=${yr}`)
        ]);

        const head = headRes.data || {};
        bdHeader = head.budget || null;
        bdDetails = head.details || [];
        bdLogs = head.logs || [];
        bdAccounts = head.accounts || [];
        bdAccounts = bdAccounts.length ? bdAccounts : [
            { code: '4100', name: BD_L('销售收入', '銷售收入', 'Sales Revenue') },
            { code: '5100', name: BD_L('销售成本', '銷售成本', 'Cost of Sales') },
            { code: '6100', name: BD_L('销售费用', '銷售費用', 'Selling Expenses') },
            { code: '6200', name: BD_L('管理费用', '管理費用', 'G&A Expenses') },
            { code: '6300', name: BD_L('财务费用', '財務費用', 'Finance Expenses') }
        ];

        renderBudgetStatus();
        renderBudgetEntry();
        renderBudgetLog();

        // 摘要卡
        const sum = sumRes.data || [];
        const totalBudget = sum.reduce((s, r) => s + (r.account_code === '4100' ? r.total_budget : 0), 0);
        const totalActual = sum.reduce((s, r) => s + (r.account_code === '4100' ? r.total_actual : 0), 0);
        document.getElementById('bdSummary').innerHTML = `
            <div class="kpi-grid">
                <div class="kpi-card blue"><div class="kpi-label">${BD_L('年度预算（营收）', '年度預算（營收）', 'Annual Budget (Revenue)')}</div><div class="kpi-value">${UI.fmt(totalBudget)}</div><div class="kpi-sub">${bu} · ${yr} ${BD_L('年度', '年度', 'FY')} · RMB</div></div>
                <div class="kpi-card green"><div class="kpi-label">${BD_L('累计实际（营收）', '累計實際（營收）', 'Actual to Date (Revenue)')}</div><div class="kpi-value">${UI.fmt(totalActual)}</div><div class="kpi-sub">${BD_L('达成率', '達成率', 'Achievement')} ${totalBudget>0?(totalActual/totalBudget*100).toFixed(1):0}%</div></div>
                <div class="kpi-card ${totalActual>=totalBudget?'green':'yellow'}"><div class="kpi-label">${BD_L('差异金额', '差異金額', 'Variance')}</div><div class="kpi-value" style="color:${totalActual>=totalBudget?'#27ae60':'#f39c12'}">${totalActual>=totalBudget?'+':''}${UI.fmt(totalActual-totalBudget)}</div><div class="kpi-sub">${totalActual>=totalBudget?BD_L('超过预算', '超過預算', 'Over budget'):BD_L('未达预算', '未達預算', 'Under budget')}</div></div>
                <div class="kpi-card blue"><div class="kpi-label">${BD_L('预算科目数', '預算科目數', 'Budget Accounts')}</div><div class="kpi-value">${sum.length}</div><div class="kpi-sub">${BD_L('个会计科目', '個會計科目', 'accounts')}</div></div>
            </div>`;

        // 进度图
        const prog = progRes.data || [];
        document.getElementById('bdChart').innerHTML = '<canvas id="bdCanvas" height="80"></canvas>';
        new Chart(document.getElementById('bdCanvas'), {
            type: 'bar',
            data: {
                labels: prog.map(p => p.YYYY_MM.substring(5)),
                datasets: [
                    { label: BD_L('预算', '預算', 'Budget'), data: prog.map(p => p.month_budget), backgroundColor: 'rgba(37,99,235,0.5)' },
                    { label: BD_L('实际', '實際', 'Actual'), data: prog.map(p => p.month_actual), backgroundColor: 'rgba(39,174,96,0.7)' }
                ]
            },
            options: {
                responsive: true,
                plugins: { tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${UI.fmt(ctx.parsed.y)}` } } },
                scales: { y: { ticks: { callback: (v) => UI.fmt(v) } } }
            }
        });

        // 明细表
        const det = detRes.data || [];
        document.getElementById('bdTable').innerHTML = det.length === 0 ? UI.empty('📋', BD_L('暂无预算资料', '暫無預算資料', 'No budget data')) : `
            <table class="data-table">
                <thead><tr><th>${BD_L('科目代码', '科目代碼', 'Account Code')}</th><th>${BD_L('科目名称', '科目名稱', 'Account Name')}</th><th class="num">${BD_L('预算金额', '預算金額', 'Budget')}</th><th class="num">${BD_L('实际金额', '實際金額', 'Actual')}</th><th class="num">${BD_L('差异金额', '差異金額', 'Variance')}</th><th class="num">${BD_L('差异率', '差異率', 'Variance %')}</th></tr></thead>
                <tbody>${det.map(r => {
                    const diff = Number(r.diff_amt || 0);
                    const diffPct = Number(r.diff_pct || 0);
                    const color = diff >= 0 ? (r.account_code === '4100' ? '#27ae60' : '#e74c3c') : (r.account_code === '4100' ? '#e74c3c' : '#27ae60');
                    return `<tr>
                        <td>${r.account_code}</td>
                        <td><b>${r.account_name}</b></td>
                        <td class="num">${UI.fmt(r.budget_amt)}</td>
                        <td class="num">${UI.fmt(r.actual_amt)}</td>
                        <td class="num" style="color:${color}">${diff>=0?'+':''}${UI.fmt(diff)}</td>
                        <td class="num" style="color:${color}">${diffPct>=0?'+':''}${UI.fmt(diffPct,1)}%</td>
                    </tr>`;
                }).join('')}</tbody>
            </table>`;
    } catch (e) {
        document.getElementById('bdSummary').innerHTML = `<p style="color:#e74c3c">${e.message}</p>`;
    }
}

// 状态标签与操作按钮
function renderBudgetStatus() {
    const tag = document.getElementById('bdStatusTag');
    const bar = document.getElementById('bdActions');
    if (!tag || !bar) return;

    if (!bdHeader) {
        tag.innerHTML = `<span style="font-size:12px;color:#7f8c8d;">${BD_L('未建立', '未建立', 'Not Created')}</span>`;
        bar.innerHTML = `<button class="btn btn-primary" onclick="bdCreate()">${BD_L('创建预算草稿', '建立預算草稿', 'Create Budget Draft')}</button>`;
        return;
    }

    const st = BUDGET_STATUS[bdHeader.status] || { text: bdHeader.status, color: '#7f8c8d' };
    const reason = bdHeader.status === 'rejected' && bdHeader.reject_reason
        ? `<span style="font-size:12px;color:#e74c3c;margin-left:8px;">${BD_L('驳回原因：', '駁回原因：', 'Reject reason: ')}${bdHeader.reject_reason}</span>` : '';
    tag.innerHTML = `<span style="font-size:12px;color:#fff;background:${st.color};padding:2px 8px;border-radius:10px;">${BD_L(st.text, st.tw, st.en)}</span>${reason}`;

    const editable = ['draft', 'rejected'].includes(bdHeader.status);
    const btns = [];
    if (editable) {
        btns.push(`<button class="btn btn-primary" onclick="bdSave(false)">${BD_L('保存草稿', '儲存草稿', 'Save Draft')}</button>`);
        btns.push(`<button class="btn btn-ghost" onclick="bdSubmit()">${BD_L('提交审批', '提交審批', 'Submit for Approval')}</button>`);
    }
    if (bdHeader.status === 'submitted' && Auth.isAdmin()) {
        btns.push(`<button class="btn btn-primary" onclick="bdApprove()">${BD_L('审批通过', '審批通過', 'Approve')}</button>`);
        btns.push(`<button class="btn btn-ghost" style="color:#e74c3c;" onclick="bdReject()">${BD_L('驳回', '駁回', 'Reject')}</button>`);
    }
    if (bdHeader.status === 'submitted' && !Auth.isAdmin()) {
        btns.push(`<span style="font-size:12px;color:#7f8c8d;">${BD_L('等待管理员审批', '等待管理員審批', 'Awaiting admin approval')}</span>`);
    }
    if (bdHeader.status === 'approved') {
        btns.push(`<span style="font-size:12px;color:#7f8c8d;">${BD_L('已审批通过，不可修改', '已審批通過，不可修改', 'Approved; read-only')}</span>`);
    }
    bar.innerHTML = btns.join(' ');
}

// 12 月 × 科目录入表
function renderBudgetEntry() {
    const wrap = document.getElementById('bdEntry');
    const yr = document.getElementById('bdYear').value;
    if (!bdHeader) {
        wrap.innerHTML = `<p style="color:#7f8c8d;">${BD_L(`${yr} 年度尚未建立预算，请点击右上角「创建预算草稿」后录入各科目月度预算。`, `${yr} 年度尚未建立預算，請點擊右上角「建立預算草稿」後錄入各科目月度預算。`, `No budget for ${yr} yet. Click "Create Budget Draft" at the top right to enter monthly budgets for each account.`)}</p>`;
        return;
    }
    const editable = ['draft', 'rejected'].includes(bdHeader.status);
    const map = new Map(bdDetails.map(d => [`${d.YYYY_MM}|${d.account_code}`, Number(d.budget_amt || 0)]));
    const months = Array.from({ length: 12 }, (_, i) => `${yr}-${String(i + 1).padStart(2, '0')}`);
    const head = bdAccounts.map(a => `<th class="num">${a.name}<br><small style="color:#7f8c8d;">${a.code}</small></th>`).join('');
    const rows = months.map(mm => {
        const cells = bdAccounts.map(a => {
            const v = map.get(`${mm}|${a.code}`) || 0;
            return `<td class="num"><input type="number" class="bd-input" min="0" step="0.01"
                data-mm="${mm}" data-code="${a.code}" value="${v || ''}" ${editable ? '' : 'disabled'}
                oninput="bdUpdateTotal()" style="width:100%;padding:4px 6px;border:1px solid #ddd;border-radius:4px;text-align:right;${editable ? '' : 'background:#f5f5f5;'}"></td>`;
        }).join('');
        return `<tr><td><b>${mm}</b></td>${cells}<td class="num" id="bdTot_${mm}">0.00</td></tr>`;
    }).join('');
    wrap.innerHTML = `
        <div style="overflow-x:auto;">
            <table class="data-table">
                <thead><tr><th>${BD_L('月份', '月份', 'Month')}</th>${head}<th class="num">${BD_L('月合计', '月合計', 'Monthly Total')}</th></tr></thead>
                <tbody>${rows}</tbody>
                <tfoot><tr><td><b>${BD_L('年度合计', '年度合計', 'Annual Total')}</b></td>${bdAccounts.map(() => '<td></td>').join('')}<td class="num"><b id="bdTotAll">0.00</b></td></tr></tfoot>
            </table>
        </div>
        <p style="font-size:12px;color:#7f8c8d;margin-top:8px;">${BD_L('金额单位：RMB。', '金額單位：RMB。', 'Amount unit: RMB. ')}${editable ? BD_L('草稿/已驳回状态可编辑，保存后提交审批。', '草稿/已駁回狀態可編輯，儲存後提交審批。', 'Editable in Draft/Rejected status; submit for approval after saving.') : BD_L('当前状态不可编辑。', '當前狀態不可編輯。', 'Not editable in current status.')}</p>`;
    bdUpdateTotal();
}

function bdUpdateTotal() {
    const yr = document.getElementById('bdYear').value;
    let all = 0;
    for (let i = 1; i <= 12; i++) {
        const mm = `${yr}-${String(i).padStart(2, '0')}`;
        let sum = 0;
        document.querySelectorAll(`#bdEntry input[data-mm="${mm}"]`).forEach(inp => {
            const v = Number(inp.value);
            if (Number.isFinite(v)) sum += v;
        });
        const cell = document.getElementById(`bdTot_${mm}`);
        if (cell) cell.textContent = UI.fmt(sum);
        all += sum;
    }
    const allCell = document.getElementById('bdTotAll');
    if (allCell) allCell.textContent = UI.fmt(all);
}

function collectBudgetDetails() {
    const details = [];
    document.querySelectorAll('#bdEntry input[data-mm]').forEach(inp => {
        const raw = inp.value.trim();
        details.push({
            YYYY_MM: inp.dataset.mm,
            account_code: inp.dataset.code,
            budget_amt: raw === '' ? 0 : Number(raw)
        });
    });
    return details;
}

async function bdCreate() {
    const bu = document.getElementById('bdBu').value;
    const yr = document.getElementById('bdYear').value;
    if (!confirm(BD_L(`确定为 ${bu} 建立 ${yr} 年度预算草稿（币别 RMB）？`, `確定為 ${bu} 建立 ${yr} 年度預算草稿（幣別 RMB）？`, `Create a budget draft (RMB) for ${bu} FY ${yr}?`))) return;
    try {
        const r = await API.post('/api/budget', { bu_no: bu, YYYY: yr });
        UI.toast(r.message || BD_L('已创建预算草稿', '已建立預算草稿', 'Budget draft created'), 'success');
        await loadBudget();
    } catch (e) {
        UI.toast(e.message, 'error');
    }
}

async function bdSave(silent = false) {
    if (!bdHeader) { UI.toast(BD_L('请先创建预算草稿', '請先建立預算草稿', 'Create a budget draft first'), 'error'); return false; }
    try {
        const r = await API.put(`/api/budget/${bdHeader.uid}/details`, { details: collectBudgetDetails() });
        if (!silent) UI.toast(r.message || BD_L('预算明细已保存', '預算明細已儲存', 'Budget details saved'), 'success');
        return true;
    } catch (e) {
        UI.toast(e.message, 'error');
        return false;
    }
}

async function bdSubmit() {
    if (!bdHeader) { UI.toast(BD_L('请先创建预算草稿', '請先建立預算草稿', 'Create a budget draft first'), 'error'); return; }
    if (!confirm(BD_L('确定保存并提交审批？提交后不可编辑。', '確定儲存並提交審批？提交後不可編輯。', 'Save and submit for approval? Not editable after submission.'))) return;
    if (!(await bdSave(true))) return;
    try {
        const r = await API.post(`/api/budget/${bdHeader.uid}/submit`);
        UI.toast(r.message || BD_L('已提交审批', '已提交審批', 'Submitted for approval'), 'success');
        await loadBudget();
    } catch (e) {
        UI.toast(e.message, 'error');
    }
}

async function bdApprove() {
    if (!bdHeader) return;
    if (!confirm(BD_L('确定审批通过该预算？', '確定審批通過該預算？', 'Approve this budget?'))) return;
    try {
        const r = await API.post(`/api/budget/${bdHeader.uid}/approve`);
        UI.toast(r.message || BD_L('审批通过', '審批通過', 'Approved'), 'success');
        await loadBudget();
    } catch (e) {
        UI.toast(e.message, 'error');
    }
}

function bdReject() {
    if (!bdHeader) return;
    UI.modal(BD_L('驳回预算', '駁回預算', 'Reject Budget'), `
        <p style="font-size:13px;color:#555;margin-bottom:8px;">${BD_L('请填写驳回原因，提交人可据此修改后重新提交。', '請填寫駁回原因，提交人可據此修改後重新提交。', 'Enter a rejection reason; the submitter can revise and resubmit.')}</p>
        <textarea id="bdRejectReason" rows="3" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;" placeholder="${BD_L('驳回原因（必填）', '駁回原因（必填）', 'Rejection reason (required)')}"></textarea>
    `, `
        <button class="btn btn-ghost" onclick="UI.closeModal()">${BD_L('取消', '取消', 'Cancel')}</button>
        <button class="btn btn-primary" onclick="bdRejectConfirm()">${BD_L('确认驳回', '確認駁回', 'Confirm Reject')}</button>
    `);
}

async function bdRejectConfirm() {
    const reason = (document.getElementById('bdRejectReason')?.value || '').trim();
    if (!reason) { UI.toast(BD_L('请填写驳回原因', '請填寫駁回原因', 'Enter a rejection reason'), 'error'); return; }
    try {
        const r = await API.post(`/api/budget/${bdHeader.uid}/reject`, { reason });
        UI.closeModal();
        UI.toast(r.message || BD_L('已驳回', '已駁回', 'Rejected'), 'success');
        await loadBudget();
    } catch (e) {
        UI.toast(e.message, 'error');
    }
}

function renderBudgetLog() {
    const el = document.getElementById('bdLog');
    if (!el) return;
    if (!bdLogs.length) { el.innerHTML = ''; return; }
    el.innerHTML = `
        <div style="font-size:13px;font-weight:700;margin-bottom:6px;">${BD_L('审批记录', '審批記錄', 'Approval Log')}</div>
        <table class="data-table">
            <thead><tr><th>${BD_L('时间', '時間', 'Time')}</th><th>${BD_L('动作', '動作', 'Action')}</th><th>${BD_L('操作人', '操作人', 'By')}</th><th>${BD_L('说明', '說明', 'Note')}</th></tr></thead>
            <tbody>${bdLogs.map(l => `
                <tr>
                    <td>${UI.fmtDate(l.create_time)}</td>
                    <td>${bdActionLabel(l.action)}</td>
                    <td>${l.actor || '-'}</td>
                    <td>${l.reason || '-'}</td>
                </tr>`).join('')}</tbody>
        </table>`;
}
