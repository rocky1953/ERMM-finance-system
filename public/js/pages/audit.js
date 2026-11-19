/**
 * CTO-03 操作审计（管理员专属）
 * 三页签：日志查询 / 模块开关 / 今日汇总
 */

const AUD_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] ?? zh);

const AuditPage = {
    tab: 'logs',        // logs | setting | summary
    queryForm: null,    // { module, action, userId, q, limit }
    rows: [],
    total: 0,
    settings: [],
    summaryData: null,

    /* ---------- 入口 ---------- */

    async load() {
        if (!Auth.isLoggedIn()) { Auth.showLogin(); return; }
        if (!Auth.isAdmin()) {
            document.getElementById('pageContent').innerHTML = `
                <div class="card" style="padding:40px;text-align:center;color:#e74c3c;">
                    ${AUD_L('⛔ 仅管理员可访问此页面', '⛔ 僅管理員可存取此頁面', '⛔ Admin access only')}
                </div>`;
            return;
        }
        document.getElementById('pageTitle').textContent = AUD_L('操作审计', '操作審計', 'Operation Audit');
        this.render();
        await this.loadCurrentTab();
    },

    render() {
        const el = document.getElementById('pageContent');
        el.innerHTML = `
            <style>
                .audit-tabs { display:flex; gap:0; border-bottom:2px solid #ecf0f1; margin-bottom:16px; }
                .audit-tabs .tab {
                    padding:10px 20px; cursor:pointer; font-weight:600; color:#7f8c8d;
                    border-bottom:3px solid transparent; margin-bottom:-2px; user-select:none;
                }
                .audit-tabs .tab:hover { color:#2c3e50; }
                .audit-tabs .tab.active { color:#2563eb; border-bottom-color:#2563eb; }
                .audit-filters {
                    display:flex; flex-wrap:wrap; gap:10px; align-items:center;
                    padding:14px; background:#f8f9fa; border-radius:6px; margin-bottom:14px;
                }
                .audit-filters .form-control { width:auto; min-width:140px; }
                .switch { position:relative; display:inline-block; width:42px; height:22px; }
                .switch input { opacity:0; width:0; height:0; }
                .switch .slider {
                    position:absolute; cursor:pointer; inset:0;
                    background:#ccc; border-radius:22px; transition:.2s;
                }
                .switch .slider:before {
                    position:absolute; content:""; height:16px; width:16px; left:3px; bottom:3px;
                    background:#fff; border-radius:50%; transition:.2s;
                }
                .switch input:checked + .slider { background:#2563eb; }
                .switch input:checked + .slider:before { transform:translateX(20px); }
                .audit-bar {
                    display:flex; align-items:center; gap:10px; margin-bottom:6px; font-size:13px;
                }
                .audit-bar-label { width:220px; flex-shrink:0; color:#2c3e50; }
                .audit-bar-track {
                    flex:1; height:20px; background:#ecf0f1; border-radius:4px; position:relative;
                    overflow:hidden;
                }
                .audit-bar-fill {
                    height:100%; background:linear-gradient(90deg,#60a5fa,#2563eb);
                    border-radius:4px; display:flex; align-items:center; padding-left:6px;
                    color:#fff; font-size:11px; font-weight:600;
                }
                .audit-bar-value { width:50px; text-align:right; color:#7f8c8d; font-family:monospace; }
                .audit-kpi-row {
                    display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr));
                    gap:12px; margin-bottom:18px;
                }
                .audit-kpi-box {
                    padding:16px; border-radius:8px; color:#fff;
                    box-shadow:0 2px 6px rgba(0,0,0,0.08);
                }
                .audit-kpi-box .label { font-size:12px; opacity:.9; margin-bottom:6px; }
                .audit-kpi-box .value { font-size:28px; font-weight:700; font-family:monospace; }
            </style>

            <div class="page-header">
                <div style="font-weight:700;font-size:18px;">${AUD_L('🔐 操作审计', '🔐 操作審計', '🔐 Operation Audit')}
                    <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">${AUD_L('全系统操作追踪 · 模块开关 · 活动汇总', '全系統操作追蹤 · 模組開關 · 活動彙總', 'System-wide operation tracking · module switches · activity summary')}</small>
                </div>
            </div>

            <div class="audit-tabs">
                <div class="tab ${this.tab==='logs'?'active':''}"      onclick="AuditPage.switchTab('logs')">${AUD_L('📋 日志查询', '📋 日誌查詢', '📋 Log Search')}</div>
                <div class="tab ${this.tab==='setting'?'active':''}"  onclick="AuditPage.switchTab('setting')">${AUD_L('⚙️ 模块开关', '⚙️ 模組開關', '⚙️ Module Switches')}</div>
                <div class="tab ${this.tab==='summary'?'active':''}"  onclick="AuditPage.switchTab('summary')">${AUD_L('📊 今日汇总', '📊 今日彙總', '📊 Today Summary')}</div>
            </div>

            <div id="auditTabContent"></div>
        `;
    },

    async loadCurrentTab() {
        const host = document.getElementById('auditTabContent');
        if (this.tab === 'logs') {
            host.innerHTML = this._logsHTML();
            // 预填默认查询
            await this.queryLogs();
        } else if (this.tab === 'setting') {
            host.innerHTML = `<div style="padding:40px;color:#999;text-align:center;">${AUD_L('⏳ 加载模块开关…', '⏳ 載入模組開關…', '⏳ Loading module switches…')}</div>`;
            await this.loadSettings();
        } else {
            host.innerHTML = `<div style="padding:40px;color:#999;text-align:center;">${AUD_L('⏳ 加载今日活动…', '⏳ 載入今日活動…', '⏳ Loading today activity…')}</div>`;
            await this.loadSummary();
        }
    },

    switchTab(t) {
        if (this.tab === t) return;
        this.tab = t;
        this.render();
        this.loadCurrentTab();
    },

    /* ---------- Tab 1 : 日志查询 ---------- */

    _logsHTML() {
        const f = this.queryForm || {};
        const moduleSel = [
            '', 'expense','fxExposure','permission','user','permission','codeTable','invoice',
            'po','prRequest','payRequest','budget','forecast','dailyReport','kpi','bank','cash',
            'arap','tax','scenario','dashboard','auth','monitor','api','system'
        ].map(m => `<option value="${m}" ${f.module===m?'selected':''}>${m||AUD_L('(全部)', '(全部)', '(All)')}</option>`).join('');

        const actionSel = [
            '', 'CREATE','UPDATE','DELETE','SUBMIT','APPROVE','REJECT','LOCK','UNLOCK','EXPORT',
            'IMPORT','LOGIN','LOGOUT','VIEW','POST','PUT','PATCH','GET','DOWNLOAD','BACKUP','RESTORE','SYNC'
        ].map(a => `<option value="${a}" ${f.action===a?'selected':''}>${a||AUD_L('(全部)', '(全部)', '(All)')}</option>`).join('');

        return `
            <div class="audit-filters">
                <div style="display:flex;flex-direction:column;gap:2px;">
                    <small style="color:#7f8c8d;">${AUD_L('模块', '模組', 'Module')}</small>
                    <select id="qModule" class="form-control" style="min-width:140px;">${moduleSel}</select>
                </div>
                <div style="display:flex;flex-direction:column;gap:2px;">
                    <small style="color:#7f8c8d;">${AUD_L('动作', '動作', 'Action')}</small>
                    <select id="qAction" class="form-control" style="min-width:140px;">${actionSel}</select>
                </div>
                <div style="display:flex;flex-direction:column;gap:2px;">
                    <small style="color:#7f8c8d;">${AUD_L('操作人 ID', '操作人 ID', 'Operator ID')}</small>
                    <input id="qUserId" class="form-control" placeholder="${AUD_L('如 rocky', '如 rocky', 'e.g. rocky')}" value="${this._esc(f.userId||'')}" style="min-width:140px;">
                </div>
                <div style="display:flex;flex-direction:column;gap:2px;">
                    <small style="color:#7f8c8d;">${AUD_L('全文搜索', '全文搜尋', 'Full-text Search')}</small>
                    <input id="qFull" class="form-control" placeholder="${AUD_L('摘要 / 详情', '摘要 / 詳情', 'Summary / Detail')}" value="${this._esc(f.q||'')}" style="min-width:180px;">
                </div>
                <div style="display:flex;flex-direction:column;gap:2px;">
                    <small style="color:#7f8c8d;">Limit</small>
                    <input id="qLimit" class="form-control" type="number" min="1" max="500" value="${f.limit||100}" style="width:90px;">
                </div>
                <div style="margin-left:auto;display:flex;gap:8px;align-items:flex-end;">
                    <button class="btn btn-primary" onclick="AuditPage.queryLogs()">${AUD_L('🔍 查询', '🔍 查詢', '🔍 Search')}</button>
                    <button class="btn btn-outline" onclick="AuditPage.resetQuery()">${AUD_L('↺ 重置', '↺ 重置', '↺ Reset')}</button>
                </div>
            </div>
            <div id="auditLogsBody">
                <div style="text-align:center;padding:40px;color:#999;">${AUD_L('⏳ 准备查询…', '⏳ 準備查詢…', '⏳ Preparing query…')}</div>
            </div>
        `;
    },

    async queryLogs() {
        const host = document.getElementById('auditLogsBody');
        const moduleEl = document.getElementById('qModule');
        const actionEl = document.getElementById('qAction');
        const uidEl = document.getElementById('qUserId');
        const qEl = document.getElementById('qFull');
        const limitEl = document.getElementById('qLimit');

        const module = moduleEl ? moduleEl.value : '';
        const action = actionEl ? actionEl.value : '';
        const userId = uidEl ? uidEl.value.trim() : '';
        const q = qEl ? qEl.value.trim() : '';
        const limit = limitEl ? Math.min(Math.max(Number(limitEl.value)||100,1), 500) : 100;

        this.queryForm = { module, action, userId, q, limit };
        host.innerHTML = `<div style="text-align:center;padding:40px;color:#999;">${AUD_L('⏳ 查询中…', '⏳ 查詢中…', '⏳ Searching…')}</div>`;

        try {
            const params = new URLSearchParams();
            if (module)  params.set('module', module);
            if (action)  params.set('action', action);
            if (userId)  params.set('userId', userId);
            if (q)       params.set('q', q);
            params.set('limit', limit);

            const res = await API.get('/api/monitor/audit?' + params.toString());
            const d = res.data || {};
            this.rows = d.rows || [];
            this.total = d.total || 0;
            this._renderLogs();
        } catch (e) {
            host.innerHTML = `<div class="card" style="padding:20px;color:#e74c3c;">${e.message}</div>`;
        }
    },

    resetQuery() {
        this.queryForm = { module:'', action:'', userId:'', q:'', limit:100 };
        this.render();
        this.loadCurrentTab();
    },

    _renderLogs() {
        const host = document.getElementById('auditLogsBody');
        if (!this.rows.length) {
            host.innerHTML = `<div class="card" style="padding:40px;text-align:center;color:#7f8c8d;">
                ${AUD_L('📭 没有匹配的审计记录（总表共 ', '📭 沒有匹配的審計記錄（總表共 ', '📭 No matching audit records (table total ')}${this.total}${AUD_L(' 条）', ' 條）', ')')}</div>`;
            return;
        }
        host.innerHTML = `
            <div class="card">
                <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
                    <span>${AUD_L('📋 审计日志（本次 ', '📋 審計日誌（本次 ', '📋 Audit Logs (showing ')}${this.rows.length}${AUD_L(' / 共 ', ' / 共 ', ' of ')}${this.total}${AUD_L('）', '）', ')')}</span>
                    <button class="btn btn-outline" style="padding:4px 10px;font-size:12px;" onclick="AuditPage.exportLogs()">${AUD_L('⬇️ 导出 CSV', '⬇️ 匯出 CSV', '⬇️ Export CSV')}</button>
                </div>
                <div style="overflow-x:auto;">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th style="width:80px;">ID</th>
                                <th style="width:110px;">${AUD_L('模块', '模組', 'Module')}</th>
                                <th style="width:100px;">${AUD_L('动作', '動作', 'Action')}</th>
                                <th style="width:110px;">${AUD_L('单据类型', '單據類型', 'Doc Type')}</th>
                                <th style="width:160px;">${AUD_L('单据号', '單據號', 'Doc No.')}</th>
                                <th>${AUD_L('摘要', '摘要', 'Summary')}</th>
                                <th style="width:110px;">${AUD_L('操作人', '操作人', 'Operator')}</th>
                                <th style="width:70px;">${AUD_L('公司', '公司', 'Company')}</th>
                                <th style="width:130px;">IP</th>
                                <th style="width:170px;">${AUD_L('时间', '時間', 'Time')}</th>
                                <th style="width:80px;">${AUD_L('操作', '操作', 'Actions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this.rows.map(r => `
                                <tr>
                                    <td style="font-family:monospace;color:#7f8c8d;">${r.id}</td>
                                    <td><span class="audit-module-tag" style="display:inline-block;padding:2px 8px;background:#eaf2f8;color:#2980b9;border-radius:3px;font-size:12px;">${this._esc(r.module||'-')}</span></td>
                                    <td>${this._actionBadge(r.action)}</td>
                                    <td>${this._esc(r.business_type||'-')}</td>
                                    <td style="font-family:monospace;">${this._esc(r.business_id||'-')}</td>
                                    <td style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${this._esc(r.summary||'')}">${this._esc(r.summary||'-')}</td>
                                    <td>${this._esc(r.user_name||r.user_id||'-')}</td>
                                    <td>${this._esc(r.bu_no||'-')}</td>
                                    <td style="font-family:monospace;color:#7f8c8d;">${this._esc(r.ip||'-')}</td>
                                    <td style="font-family:monospace;color:#7f8c8d;">${this._esc(r.created_at||'-')}</td>
                                    <td>
                                        <button class="btn btn-ghost" style="padding:2px 8px;font-size:12px;" onclick="AuditPage.showDetail(${r.id})">${AUD_L('详情', '詳情', 'Detail')}</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    _actionBadge(a) {
        if (!a) return '-';
        const map = {
            CREATE: 'background:#d4edda;color:#155724;',
            UPDATE: 'background:#fff3cd;color:#856404;',
            DELETE: 'background:#f8d7da;color:#721c24;',
            SUBMIT: 'background:#cce5ff;color:#004085;',
            APPROVE:'background:#d4edda;color:#155724;',
            REJECT: 'background:#f8d7da;color:#721c24;',
            LOCK:   'background:#e2e3e5;color:#383d41;',
            EXPORT: 'background:#d1ecf1;color:#0c5460;',
            IMPORT: 'background:#d1ecf1;color:#0c5460;'
        };
        const style = map[a] || 'background:#ecf0f1;color:#2c3e50;';
        return `<span style="display:inline-block;padding:2px 8px;border-radius:3px;font-size:12px;font-weight:600;${style}">${this._esc(a)}</span>`;
    },

    async showDetail(id) {
        try {
            UI.modal(AUD_L('⏳ 加载中…', '⏳ 載入中…', '⏳ Loading…'), `<p style="text-align:center;">${AUD_L('正在抓取完整详情…', '正在抓取完整詳情…', 'Fetching full details…')}</p>`, '');
            const res = await API.get('/api/monitor/audit/' + id);
            const row = res.data || {};
            const detail = row.detail ? (typeof row.detail === 'string' ? row.detail : JSON.stringify(row.detail, null, 2)) : AUD_L('(无)', '(無)', '(none)');
            const basic = [
                ['ID', row.id],
                ['Trace', row.trace_id],
                [AUD_L('模块', '模組', 'Module'), row.module],
                [AUD_L('动作', '動作', 'Action'), row.action],
                [AUD_L('单据类型', '單據類型', 'Doc Type'), row.business_type],
                [AUD_L('单据号', '單據號', 'Doc No.'), row.business_id],
                [AUD_L('操作人', '操作人', 'Operator'), `${row.user_name||''} (${row.user_id})`],
                [AUD_L('公司', '公司', 'Company'), row.bu_no],
                ['IP', row.ip],
                [AUD_L('时间', '時間', 'Time'), row.created_at],
                [AUD_L('摘要', '摘要', 'Summary'), row.summary],
            ].map(([k,v]) => `<div style="display:flex;gap:12px;margin-bottom:4px;">
                <div style="width:90px;color:#7f8c8d;flex-shrink:0;">${k}</div>
                <div style="flex:1;font-family:monospace;word-break:break-all;">${this._esc(v==null?'-':v)}</div>
            </div>`).join('');
            UI.modal(`${AUD_L('📋 审计详情', '📋 審計詳情', '📋 Audit Detail')} #${id}`, `
                <div style="max-height:70vh;overflow-y:auto;">
                    ${basic}
                    <hr style="border:none;border-top:1px dashed #ddd;margin:12px 0;">
                    <div style="font-weight:700;margin-bottom:6px;">Detail JSON</div>
                    <pre style="background:#2c3e50;color:#ecf0f1;padding:12px;border-radius:6px;font-size:12px;max-height:320px;overflow:auto;margin:0;">${this._esc(detail)}</pre>
                </div>
            `, `<button class="btn btn-ghost" onclick="UI.closeModal()">${AUD_L('关闭', '關閉', 'Close')}</button>`);
        } catch (e) {
            UI.modal(AUD_L('加载失败', '載入失敗', 'Load Failed'), `<p style="color:#e74c3c;">${e.message}</p>`, `<button class="btn" onclick="UI.closeModal()">${AUD_L('关闭', '關閉', 'Close')}</button>`);
        }
    },

    exportLogs() {
        if (!this.rows.length) return;
        const headers = ['ID', AUD_L('模块', '模組', 'Module'), AUD_L('动作', '動作', 'Action'), AUD_L('单据类型', '單據類型', 'Doc Type'), AUD_L('单据号', '單據號', 'Doc No.'), AUD_L('摘要', '摘要', 'Summary'), AUD_L('操作人', '操作人', 'Operator'), AUD_L('公司', '公司', 'Company'), 'IP', AUD_L('时间', '時間', 'Time')];
        const rows = this.rows.map(r => [
            r.id, r.module, r.action, r.business_type, r.business_id,
            (r.summary||'').replace(/"/g,'""'),
            `${r.user_name||''}(${r.user_id||''})`, r.bu_no, r.ip, r.created_at
        ].map(v => `"${(v==null?'':String(v)).replace(/"/g,'""')}"`).join(','));
        const csv = '\ufeff' + [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `audit_${new Date().toISOString().slice(0,10)}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(a.href);
    },

    /* ---------- Tab 2 : 模块开关 ---------- */

    async loadSettings() {
        try {
            const res = await API.get('/api/monitor/audit/setting/all');
            this.settings = res.data || [];
            this._renderSettings();
        } catch (e) {
            document.getElementById('auditTabContent').innerHTML = `<div class="card" style="padding:20px;color:#e74c3c;">${e.message}</div>`;
        }
    },

    _renderSettings() {
        const host = document.getElementById('auditTabContent');
        const rows = this.settings.length ? this.settings : [];

        host.innerHTML = `
            <div class="card" style="margin-bottom:14px;">
                <div class="card-title">${AUD_L('⚙️ 模块开关管理', '⚙️ 模組開關管理', '⚙️ Module Switch Management')}
                    <small style="font-size:12px;color:#7f8c8d;font-weight:normal;">${AUD_L('切换后即时生效（同步刷新 audit 服务配置）', '切換後即時生效（同步刷新 audit 服務配置）', 'Takes effect immediately (syncs audit service config)')}</small>
                </div>
            </div>
            <div class="card">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th style="width:180px;">${AUD_L('模块 Module', '模組 Module', 'Module')}</th>
                            <th style="width:140px;">${AUD_L('启用开关', '啟用開關', 'Enabled')}</th>
                            <th style="width:140px;">${AUD_L('捕获 detail', '捕獲 detail', 'Capture detail')}</th>
                            <th>${AUD_L('备注 Remark', '備註 Remark', 'Remark')}</th>
                            <th style="width:80px;">${AUD_L('操作', '操作', 'Actions')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.length ? rows.map(s => `
                            <tr data-module="${this._esc(s.module)}">
                                <td><span style="font-weight:600;font-family:monospace;">${this._esc(s.module)}</span></td>
                                <td>
                                    <label class="switch">
                                        <input type="checkbox" class="swEnabled"
                                            ${s.enabled ? 'checked' : ''}
                                            onchange="AuditPage.saveSetting('${this._esc(s.module)}')">
                                        <span class="slider"></span>
                                    </label>
                                    <span style="margin-left:6px;color:${s.enabled?'#27ae60':'#95a5a6'};font-weight:600;">
                                        ${s.enabled ? 'ON' : 'OFF'}
                                    </span>
                                </td>
                                <td>
                                    <label class="switch">
                                        <input type="checkbox" class="swDetail"
                                            ${s.capture_detail ? 'checked' : ''}
                                            onchange="AuditPage.saveSetting('${this._esc(s.module)}')">
                                        <span class="slider"></span>
                                    </label>
                                    <span style="margin-left:6px;color:${s.capture_detail?'#27ae60':'#95a5a6'};font-weight:600;">
                                        ${s.capture_detail ? 'ON' : 'OFF'}
                                    </span>
                                </td>
                                <td><input class="form-control remarkInput" style="min-width:180px;"
                                    value="${this._esc(s.remark||'')}" placeholder="${AUD_L('可选备注', '可選備註', 'Optional remark')}"
                                    onchange="AuditPage.saveSetting('${this._esc(s.module)}')"></td>
                                <td><span style="color:#7f8c8d;font-size:12px;">${AUD_L('自动保存', '自動儲存', 'Auto-saved')}</span></td>
                            </tr>
                        `).join('') : `<tr><td colspan="5" style="text-align:center;color:#7f8c8d;padding:20px;">${AUD_L('尚无配置，系统将按默认策略运行', '尚無配置，系統將按預設策略運行', 'No configuration yet; the system runs with default policy')}</td></tr>`}
                    </tbody>
                </table>
            </div>
        `;
    },

    async saveSetting(module) {
        const row = document.querySelector(`tr[data-module="${module}"]`);
        if (!row) return;
        const enabledCb = row.querySelector('.swEnabled');
        const detailCb = row.querySelector('.swDetail');
        const remarkEl = row.querySelector('.remarkInput');
        const body = {
            enabled: !!(enabledCb && enabledCb.checked),
            capture_detail: !!(detailCb && detailCb.checked),
            remark: (remarkEl && remarkEl.value.trim()) || null
        };
        // 即时 UI 反馈：更新旁边的 ON/OFF 文字
        const rowNodes = row.querySelectorAll('span');
        rowNodes[1].textContent = body.enabled ? 'ON' : 'OFF';
        rowNodes[1].style.color = body.enabled ? '#27ae60' : '#95a5a6';
        rowNodes[4].textContent = body.capture_detail ? 'ON' : 'OFF';
        rowNodes[4].style.color = body.capture_detail ? '#27ae60' : '#95a5a6';

        try {
            await API.post('/api/monitor/audit/setting/' + encodeURIComponent(module), body);
            UI.toast(`${AUD_L('✅ 已保存 ', '✅ 已儲存 ', '✅ Saved ')}${module}`, 'success');
        } catch (e) {
            UI.toast(`❌ ${e.message}`, 'error');
            // 还原
            await this.loadSettings();
        }
    },

    /* ---------- Tab 3 : 今日汇总 ---------- */

    async loadSummary() {
        const host = document.getElementById('auditTabContent');
        host.innerHTML = `<div style="padding:40px;color:#999;text-align:center;">${AUD_L('⏳ 加载今日活动…', '⏳ 載入今日活動…', '⏳ Loading today activity…')}</div>`;
        try {
            const res = await API.get('/api/monitor/audit/activity/summary');
            this.summaryData = res.data || {};
            this._renderSummary();
        } catch (e) {
            host.innerHTML = `<div class="card" style="padding:20px;color:#e74c3c;">${e.message}</div>`;
        }
    },

    _renderSummary() {
        const host = document.getElementById('auditTabContent');
        const d = this.summaryData || {};
        const ymd = d.ymd || new Date().toISOString().slice(0,10).replace(/-/g,'');
        const byModule = d.byModule || [];
        const topUsers = d.topUsers || [];
        const bizChanges = d.bizChanges || 0;
        const totalOps = byModule.reduce((s, r) => s + Number(r.cnt||0), 0);

        const maxCnt = byModule.length ? Math.max(...byModule.map(r => Number(r.cnt||0))) : 0;
        const bars = byModule.map(r => {
            const pct = maxCnt ? (Number(r.cnt||0) / maxCnt * 100) : 0;
            return `
                <div class="audit-bar">
                    <div class="audit-bar-label">${this._esc(r.module||'-')} · ${this._esc(r.action||'-')}</div>
                    <div class="audit-bar-track">
                        <div class="audit-bar-fill" style="width:${Math.max(pct,2)}%;">${Math.round(pct*10)/10>30?r.cnt:''}</div>
                    </div>
                    <div class="audit-bar-value">${r.cnt}</div>
                </div>
            `;
        }).join('');

        const userRows = topUsers.length ? topUsers.map((u,i) => `
            <tr>
                <td style="width:40px;font-weight:700;color:${i===0?'#e74c3c':i===1?'#f39c12':i===2?'#3498db':'#7f8c8d'};">#${i+1}</td>
                <td>${this._esc(u.user_name||u.user_id||'-')}</td>
                <td style="font-family:monospace;color:#7f8c8d;">${this._esc(u.user_id||'-')}</td>
                <td style="text-align:right;font-family:monospace;font-weight:700;">${u.cnt}</td>
            </tr>
        `).join('') : `<tr><td colspan="4" style="text-align:center;color:#7f8c8d;padding:20px;">${AUD_L('今日暂无操作', '今日暫無操作', 'No operations today')}</td></tr>`;

        host.innerHTML = `
            <div class="audit-kpi-row">
                <div class="audit-kpi-box" style="background:linear-gradient(135deg,#667eea,#764ba2);">
                    <div class="label">${AUD_L('📝 业务变动数', '📝 業務變動數', '📝 Business Changes')}</div>
                    <div class="value">${this._fmtN(bizChanges)}</div>
                </div>
                <div class="audit-kpi-box" style="background:linear-gradient(135deg,#11998e,#38ef7d);">
                    <div class="label">${AUD_L('🔧 总操作次数', '🔧 總操作次數', '🔧 Total Operations')}</div>
                    <div class="value">${this._fmtN(totalOps)}</div>
                </div>
                <div class="audit-kpi-box" style="background:linear-gradient(135deg,#f093fb,#f5576c);">
                    <div class="label">${AUD_L('👤 参与操作人数', '👤 參與操作人數', '👤 Active Operators')}</div>
                    <div class="value">${this._fmtN(topUsers.length)}</div>
                </div>
                <div class="audit-kpi-box" style="background:linear-gradient(135deg,#4facfe,#00f2fe);">
                    <div class="label">${AUD_L('📅 日期', '📅 日期', '📅 Date')}</div>
                    <div class="value" style="font-size:20px;">${ymd.slice(0,4)}-${ymd.slice(4,6)}-${ymd.slice(6,8)}</div>
                </div>
            </div>

            <div class="card" style="margin-bottom:14px;">
                <div class="card-title">📊 ${AUD_L('按模块/动作分布', '按模組/動作分佈', 'Distribution by Module/Action')} ${topUsers.length?'':AUD_L('（今日暂无数据）', '（今日暫無資料）', '(no data today)')}</div>
                <div style="padding:6px 0;">${bars || `<div style="color:#7f8c8d;text-align:center;padding:20px;">${AUD_L('今日暂无操作', '今日暫無操作', 'No operations today')}</div>`}</div>
            </div>

            <div class="card">
                <div class="card-title">${AUD_L('🏆 Top 10 操作人', '🏆 Top 10 操作人', '🏆 Top 10 Operators')}</div>
                <table class="data-table">
                    <thead>
                        <tr><th>#</th><th>${AUD_L('姓名', '姓名', 'Name')}</th><th>${AUD_L('工号', '工號', 'Emp ID')}</th><th style="text-align:right;">${AUD_L('次数', '次數', 'Count')}</th></tr>
                    </thead>
                    <tbody>${userRows}</tbody>
                </table>
            </div>
        `;
    },

    /* ---------- 工具 ---------- */

    _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
    _fmtN(n) {
        return Number(n||0).toLocaleString('zh-TW');
    }
};

window.AuditPage = AuditPage;
registerPage('audit', () => AuditPage.load());
