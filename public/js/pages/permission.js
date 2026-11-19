/**
 * 功能模块使用权限管理
 * 表格：行=模块，列=一般/操作员/管理员，支持列头全选/反选
 */
const PERM_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] ?? zh);

// 81 个模块码 → 英文显示名（与 nav 字典对齐；缺 key 时兜底）
const PERM_MOD_EN = {
    dashboard: 'Dashboard', actions: 'KPI Actions', alerts: 'Alert Center',
    drilldown: 'Drill-down', cashForecast: 'Cash Forecast', mgmtAccounting: 'Mgmt Accounting',
    budget: 'Budget', consolidation: 'Consolidation', aiqa: 'AI Q&A', scenario: 'Scenario',
    warRoom: 'War Room', benchmark: 'Industry Benchmark', rollingBudget: 'Rolling Budget',
    po: 'Purchase Order', profitAnalysis: 'Profit Analysis', inventoryTurnover: 'Inventory Turnover',
    so: 'Sales Order', preorder: 'Pre-order', boardPack: 'Board Pack', dn: 'Delivery Note',
    projectProfit: 'Project P&L', tempPo: 'Temp PO', approvals: 'Approval Center',
    salesCredit: 'Sales Credit & Returns', expense: 'Expense Claims', payRequest: 'Payment Request',
    closing: 'Period Close', prRequest: 'Purchase Request', poMatch: 'PO 3-Way Match',
    cash: 'Cash Journal', invoice: 'Invoice Management', pay: 'Payment Management',
    check: 'Check Management', bank: 'Bank Management', arMatch: 'AR Write-off',
    arap: 'AR/AP', arSmart: 'AR Smart Analysis', dataQuality: 'Data Quality',
    codeTable: 'Code Table', dailyReport: 'Daily Report', dailyReportUnfinished: 'Unfinished Reports',
    audit: 'Operation Audit', summary: 'Financial Summary', llmAudit: 'AI Governance',
    report: 'Management Reports', risk: 'Risk Analysis', forecast: 'Forecast Analysis',
    trend: 'Trend Analysis', monthly: 'Monthly Close Summary', bep: 'Break-even',
    account: 'Account Management', finance: 'Finance Overview', tax: 'Tax Filing',
    xitems: 'Item Management', yg001: 'KPI Query 1', yg002: 'KPI Query 2',
    yg003: 'KPI Query 3', yg004: 'KPI Query 4', batch: 'Batch Management',
    integration: 'System Integration', system: 'System Settings', user: 'User Management',
    kpi: 'KPI Settings', branch: 'Company Management', relation: 'Counterparties',
    contracts: 'Contract Master', docArchitecture: 'System Architecture',
    docExecutive: 'Executive Briefing', permission: 'Permissions', docDataModel: 'Data Model',
    docManualCeo: 'CEO Manual', docManualCfo: 'CFO Manual', docManualCto: 'CTO Manual',
    fxExposure: 'FX Exposure & Hedging', docManualCoo: 'COO Manual',
    taxPlanning: 'Tax Planning & Risk', strategy: 'Strategic Goals & BSC',
    cashLiquidity: 'Cash & Liquidity', investment: 'Investment & Capital',
    taxCompliance: 'Tax & Compliance', hrEfficiency: 'Org Efficiency'
};

// 8 个分组 → 英文
const PERM_GROUP_EN = {
    '仪表板': 'Dashboard', '经营决策': 'Decision-Making', 'ERP 原始单据': 'ERP Source Documents',
    '日常作业': 'Daily Operations', '财务分析': 'Financial Analysis', '财务预警': 'Financial Alerts',
    '系统主档': 'System Master Data', '系统文件': 'System Documents'
};

const PERM_ROLE = {
    general: PERM_L('一般', '一般', 'General'),
    operator: PERM_L('操作員', '操作員', 'Operator'),
    admin: PERM_L('管理員', '管理員', 'Administrator')
};

function modLabel(code, name) {
    if (I18N.lang === 'en') {
        const k = 'nav.' + code;
        const tv = t(k);
        if (tv && tv !== k) return tv;
        return PERM_MOD_EN[code] || name;
    }
    return name;
}
function groupLabel(g) { return I18N.lang === 'en' ? (PERM_GROUP_EN[g] || g) : g; }
function roleLabel(r) { return PERM_ROLE[r] || r; }

const PermissionPage = {
    matrix: [],

    async load() {
        if (!Auth.isLoggedIn()) { Auth.showLogin(); return; }
        document.getElementById('pageTitle').textContent = PERM_L('功能模块使用权限', '功能模組使用權限', 'Module Access Permissions');

        if (!Auth.isAdmin()) {
            document.getElementById('pageContent').innerHTML = `
                <div class="card" style="padding:40px;text-align:center;color:#e74c3c;">
                    ${PERM_L('⛔ 僅管理員可進入此頁面', '⛔ 僅管理員可進入此頁面', '⛔ Administrators only')}
                </div>`;
            return;
        }
        await this.loadMatrix();
    },

    async loadMatrix() {
        const el = document.getElementById('pageContent');
        el.innerHTML = `<div style="padding:40px;text-align:center;color:#999;">${PERM_L('⏳ 載入權限矩陣…', '⏳ 載入權限矩陣…', '⏳ Loading permission matrix…')}</div>`;
        try {
            const res = await API.get('/api/permission/matrix');
            this.matrix = res.data || [];
            this.render();
        } catch (e) {
            el.innerHTML = `<div class="card" style="padding:40px;color:#e74c3c;">${e.message}</div>`;
        }
    },

    render() {
        const el = document.getElementById('pageContent');
        // 按 module_group 分组
        const groups = {};
        for (const m of this.matrix) {
            if (!groups[m.module_group]) groups[m.module_group] = [];
            groups[m.module_group].push(m);
        }
        const groupNames = Object.keys(groups);

        // 表头带全选/反选按钮（用户要求）
        const header = `
            <div class="page-header">
                <div style="font-weight:700;font-size:18px;">${PERM_L('功能模組使用權限清單', '功能模組使用權限清單', 'Module Permission List')}</div>
                <div style="color:#888;font-size:13px;">
                    ${PERM_L('點擊各分組表頭的「☑/☐」按鈕可全選或全部取消該分組、該角色的模組權限，不影響其他分組', '點擊各分組表頭的「☑/☐」按鈕可全選或全部取消該分組、該角色的模組權限，不影響其他分組', 'Click the ☑/☐ buttons in each group header to toggle all modules for that group and role, without affecting other groups.')}
                </div>
            </div>
        `;

        // 列头全选/反选按钮（仅作用于当前分组的模块）
        const colHeader = (role, label, group) => `
            <div style="text-align:center;min-width:140px;">
                <div style="font-weight:600;">${label}</div>
                <div style="margin-top:4px;">
                    <button class="btn btn-ghost" style="padding:2px 8px;font-size:12px;"
                        onclick="PermissionPage.colToggle('${role}', true, '${group}')">☑ ${PERM_L('全選', '全選', 'Select All')}</button>
                    <button class="btn btn-ghost" style="padding:2px 8px;font-size:12px;"
                        onclick="PermissionPage.colToggle('${role}', false, '${group}')">☐ ${PERM_L('取消', '取消', 'Clear')}</button>
                </div>
            </div>
        `;

        // 分组渲染
        let body = '';
        for (const g of groupNames) {
            const rows = groups[g];
            const gid = 'grp_' + g.replace(/[^a-zA-Z0-9]/g, '_');
            const groupDisplay = groupLabel(g);

            // 分组级按钮
            body += `
            <div class="card" style="margin-bottom:20px;">
                <div style="padding:12px 16px;background:#f8f9fa;border-bottom:1px solid #eee;font-weight:700;display:flex;justify-content:space-between;align-items:center;">
                    <span>📁 ${groupDisplay} <span style="color:#888;font-weight:normal;font-size:13px;">(${rows.length} ${PERM_L('個模組', '個模組', 'modules')})</span></span>
                    <div>
                        <button class="btn btn-ghost" style="padding:2px 8px;font-size:12px;"
                            onclick="PermissionPage.groupToggle('${g}', 'general', true)">${roleLabel('general')} ${PERM_L('全部選', '全部選', 'All')}</button>
                        <button class="btn btn-ghost" style="padding:2px 8px;font-size:12px;"
                            onclick="PermissionPage.groupToggle('${g}', 'general', false)">${roleLabel('general')} ${PERM_L('取消', '取消', 'Clear')}</button>
                        <button class="btn btn-ghost" style="padding:2px 8px;font-size:12px;"
                            onclick="PermissionPage.groupToggle('${g}', 'operator', true)">${roleLabel('operator')} ${PERM_L('全部選', '全部選', 'All')}</button>
                        <button class="btn btn-ghost" style="padding:2px 8px;font-size:12px;"
                            onclick="PermissionPage.groupToggle('${g}', 'operator', false)">${roleLabel('operator')} ${PERM_L('取消', '取消', 'Clear')}</button>
                        <button class="btn btn-ghost" style="padding:2px 8px;font-size:12px;"
                            onclick="PermissionPage.groupToggle('${g}', 'admin', true)">${roleLabel('admin')} ${PERM_L('全部選', '全部選', 'All')}</button>
                        <button class="btn btn-ghost" style="padding:2px 8px;font-size:12px;"
                            onclick="PermissionPage.groupToggle('${g}', 'admin', false)">${roleLabel('admin')} ${PERM_L('取消', '取消', 'Clear')}</button>
                    </div>
                </div>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th style="width:200px;">${PERM_L('功能模組', '功能模組', 'Module')}</th>
                            <th style="width:150px;">${PERM_L('模組代碼', '模組代碼', 'Module Code')}</th>
                            <th>${colHeader('general', roleLabel('general'), g)}</th>
                            <th>${colHeader('operator', roleLabel('operator'), g)}</th>
                            <th>${colHeader('admin', roleLabel('admin'), g)}</th>
                        </tr>
                    </thead>
                    <tbody>
                    ${rows.map(r => `
                        <tr id="row_${r.module_code}">
                            <td style="font-weight:600;">${modLabel(r.module_code, r.module_name)}</td>
                            <td style="color:#888;font-family:monospace;">${r.module_code}</td>
                            ${['general','operator','admin'].map(r2 => `
                                <td style="text-align:center;">
                                    <input type="checkbox" id="chk_${r.module_code}_${r2}"
                                        ${r['allow_' + r2] ? 'checked' : ''}
                                        onchange="PermissionPage.saveOne('${r.module_code}','${r2}')"
                                        style="width:18px;height:18px;cursor:pointer;">
                                </td>
                            `).join('')}
                        </tr>
                    `).join('')}
                    </tbody>
                </table>
            </div>`;
        }

        el.innerHTML = header + body;
    },

    // 保存单个勾选
    async saveOne(code, role) {
        const colMap = { general: 'allow_general', operator: 'allow_operator', admin: 'allow_admin' };
        const el = document.getElementById('chk_' + code + '_' + role);
        const val = el.checked ? 1 : 0;
        try {
            await API.post('/api/permission/module/' + encodeURIComponent(code), { [colMap[role]]: val });
            // 本地 matrix 同步
            const row = this.matrix.find(x => x.module_code === code);
            if (row) row[colMap[role]] = val;
        } catch (e) {
            el.checked = !el.checked;  // 还原
            UI.toast(e.message, 'error');
        }
    },

    // 列头全选/反选（指定角色；有 group 时仅该分组，否则全部模块）
    async colToggle(role, enable, group) {
        const colMap = { general: 'allow_general', operator: 'allow_operator', admin: 'allow_admin' };
        const targets = group ? this.matrix.filter(m => m.module_group === group) : this.matrix.slice();
        const codes = targets.map(m => m.module_code);
        if (!codes.length) return;
        try {
            UI.toast(`${enable ? PERM_L('全選', '全選', 'Select All') : PERM_L('全部取消', '全部取消', 'Clear All')} ${codes.length} ${PERM_L('個模組', '個模組', 'modules')}${group ? `「${groupLabel(group)}」` : ''} → ${roleLabel(role)}`, 'info');
            await API.post('/api/permission/batch', { role, enabled: enable ? 1 : 0, module_codes: codes });
            // 本地更新（仅影响目标模块）
            targets.forEach(m => { m[colMap[role]] = enable ? 1 : 0; });
            // DOM 更新
            codes.forEach(c => {
                const el = document.getElementById('chk_' + c + '_' + role);
                if (el) el.checked = enable;
            });
            UI.toast(PERM_L('✅ 已更新', '✅ 已更新', '✅ Updated'), 'success');
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // 分组级批量
    async groupToggle(group, role, enable) {
        const colMap = { general: 'allow_general', operator: 'allow_operator', admin: 'allow_admin' };
        try {
            UI.toast(`${enable ? PERM_L('全選', '全選', 'Select All') : PERM_L('全部取消', '全部取消', 'Clear All')} 「${groupLabel(group)}」→ ${roleLabel(role)}`, 'info');
            await API.post('/api/permission/batch', { role, enabled: enable ? 1 : 0, group_code: group });
            // 本地更新
            this.matrix.forEach(m => {
                if (m.module_group === group) m[colMap[role]] = enable ? 1 : 0;
            });
            // DOM 更新
            this.matrix.forEach(m => {
                if (m.module_group === group) {
                    const el = document.getElementById('chk_' + m.module_code + '_' + role);
                    if (el) el.checked = enable;
                }
            });
            UI.toast(PERM_L('✅ 已更新', '✅ 已更新', '✅ Updated'), 'success');
        } catch (e) { UI.toast(e.message, 'error'); }
    },
};

registerPage('permission', () => PermissionPage.load());
