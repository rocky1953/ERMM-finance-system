/**
 * CTO-09 AI 治理 Dashboard
 *
 * 五個頁籤：
 *   1. 審計日誌 — 完整 LLM 呼叫記錄（篩選 + 分頁）
 *   2. 統計概覽 — 卡片 + 趨勢圖 + 週同比
 *   3. 成本分析 — 按 provider / model / bu 聚合
 *   4. 用戶排行 — TOP 20 活躍用戶
 *   5. 治理配置 — 模型計價 + 速率限制（admin 可編輯）
 */

const LLA_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] ?? zh);

const LlmAuditPage = {
    tab: 'logs',       // logs | overview | cost | users | pricing | limits
    queryForm: {},
    rows: [],
    total: 0,
    page: 1,
    pageSize: 50,
    stats: null,
    trend: [],
    costData: [],
    users: [],
    pricing: [],
    limits: [],

    /* ======== 入口 ======== */

    async load() {
        if (!Auth.isLoggedIn()) { Auth.showLogin(); return; }
        document.getElementById('pageTitle').textContent = LLA_L('🤖 AI 治理', '🤖 AI 治理', '🤖 AI Governance');
        this.render();
        await this.loadCurrentTab();
    },

    render() {
        const el = document.getElementById('pageContent');
        el.innerHTML = `
            <style>
                .ai-tabs { display:flex; gap:0; border-bottom:2px solid #ecf0f1; margin-bottom:16px; flex-wrap:wrap; }
                .ai-tabs .tab { padding:10px 20px; cursor:pointer; font-weight:600; color:#7f8c8d;
                    border-bottom:3px solid transparent; margin-bottom:-2px; user-select:none; white-space:nowrap; }
                .ai-tabs .tab:hover { color:#2c3e50; }
                .ai-tabs .tab.active { color:#2563eb; border-bottom-color:#2563eb; }
                .ai-kpi-row { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:18px; }
                .ai-kpi-box { padding:14px 16px; border-radius:8px; color:#fff; box-shadow:0 2px 6px rgba(0,0,0,0.08); }
                .ai-kpi-box .label { font-size:12px; opacity:.9; margin-bottom:4px; }
                .ai-kpi-box .value { font-size:22px; font-weight:700; font-family:monospace; }
                .ai-kpi-box .delta { font-size:11px; margin-top:4px; opacity:.85; }
                .ai-filters { display:flex; flex-wrap:wrap; gap:10px; align-items:center; padding:14px; background:#f8f9fa; border-radius:6px; margin-bottom:14px; }
                .ai-table { width:100%; border-collapse:collapse; font-size:13px; }
                .ai-table th, .ai-table td { padding:8px 10px; border-bottom:1px solid #ecf0f1; text-align:left; vertical-align:top; }
                .ai-table th { background:#f8f9fa; font-weight:600; color:#2c3e50; position:sticky; top:0; }
                .ai-table tbody tr:hover { background:#f0f7ff; }
                .ai-badge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600; }
                .ai-badge.SUCCESS { background:#d1fae5; color:#065f46; }
                .ai-badge.FAIL    { background:#fee2e2; color:#991b1b; }
                .ai-badge.TIMEOUT { background:#fef3c7; color:#92400e; }
                .ai-trend { display:flex; align-items:flex-end; gap:2px; height:120px; padding:10px 0; border-bottom:1px solid #ecf0f1; margin-bottom:10px; }
                .ai-trend .bar { flex:1; background:linear-gradient(to top,#60a5fa,#2563eb); border-radius:3px 3px 0 0; position:relative; min-height:2px; }
                .ai-trend .bar:hover::after { content:attr(title); position:absolute; bottom:100%; left:50%; transform:translateX(-50%);
                    background:#1e293b; color:#fff; padding:3px 6px; border-radius:3px; font-size:11px; white-space:nowrap; z-index:10; }
                .ai-edit-input { width:80px; padding:4px 6px; border:1px solid #d1d5db; border-radius:4px; font-size:12px; }
                .ai-edit-input:focus { outline:none; border-color:#2563eb; }
                .btn-save { padding:4px 10px; background:#2563eb; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:12px; }
                .btn-save:hover { background:#1d4ed8; }
                .btn-del  { padding:4px 10px; background:#dc2626; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:12px; }
                .btn-del:hover  { background:#b91c1c; }
                .pager { display:flex; gap:8px; align-items:center; justify-content:flex-end; margin-top:12px; font-size:13px; color:#7f8c8d; }
                .pager button { padding:4px 10px; border:1px solid #d1d5db; background:#fff; border-radius:4px; cursor:pointer; }
                .pager button:hover:not(:disabled) { background:#f0f7ff; border-color:#2563eb; }
                .pager button:disabled { opacity:.5; cursor:not-allowed; }
                .mono { font-family:monospace; font-size:12px; }
                .truncate { max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:help; }
            </style>

            <div class="ai-tabs" id="aiTabs">
                <div class="tab ${this.tab==='overview'?'active':''}" onclick="LlmAuditPage.switchTab('overview')">${LLA_L('📊 统计概览', '📊 統計概覽', '📊 Statistics Overview')}</div>
                <div class="tab ${this.tab==='logs'?'active':''}"       onclick="LlmAuditPage.switchTab('logs')">${LLA_L('📋 审计日志', '📋 審計日誌', '📋 Audit Logs')}</div>
                <div class="tab ${this.tab==='cost'?'active':''}"      onclick="LlmAuditPage.switchTab('cost')">${LLA_L('💰 成本分析', '💰 成本分析', '💰 Cost Analysis')}</div>
                <div class="tab ${this.tab==='users'?'active':''}"    onclick="LlmAuditPage.switchTab('users')">${LLA_L('👥 用户排行', '👥 用戶排行', '👥 User Ranking')}</div>
                <div class="tab ${this.tab==='pricing'?'active':''}"  onclick="LlmAuditPage.switchTab('pricing')">${LLA_L('🧾 模型计价', '🧾 模型計價', '🧾 Model Pricing')}</div>
                <div class="tab ${this.tab==='limits'?'active':''}"   onclick="LlmAuditPage.switchTab('limits')">${LLA_L('🛡️ 速率限制', '🛡️ 速率限制', '🛡️ Rate Limits')}</div>
            </div>

            <div id="aiTabContent"></div>
        `;
        document.querySelectorAll('#aiTabs .tab').forEach((t, i) => {
            t.onclick = () => LlmAuditPage.switchTab(['overview','logs','cost','users','pricing','limits'][i]);
        });
    },

    async switchTab(tab) {
        this.tab = tab;
        this.render();
        await this.loadCurrentTab();
    },

    async loadCurrentTab() {
        try {
            switch (this.tab) {
                case 'overview': await this.loadOverview(); break;
                case 'logs':     await this.loadLogs(); break;
                case 'cost':     await this.loadCost(); break;
                case 'users':    await this.loadUsers(); break;
                case 'pricing':  await this.loadPricing(); break;
                case 'limits':   await this.loadLimits(); break;
            }
        } catch (e) {
            document.getElementById('aiTabContent').innerHTML = `<div class="card" style="padding:40px;text-align:center;color:#e74c3c;">${LLA_L('载入失败：', '載入失敗：', 'Load failed: ')}${e.message}</div>`;
        }
    },

    /* ======== 1. 統計概覽 ======== */

    async loadOverview() {
        const { data } = await API.get('/api/llm-audit/stats');
        this.stats = data.cards;
        this.trend = data.trend || [];
        const comp = data.comparison || {};

        const s = this.stats || {};
        const successRate = s.total_calls > 0 ? (s.success_calls / s.total_calls * 100).toFixed(1) : '0.0';
        const costPrev = Number(comp.cost_prev7d || 0);
        const costLast = Number(comp.cost_last7d || 0);
        const costDelta = costPrev > 0 ? ((costLast - costPrev) / costPrev * 100).toFixed(1) : null;
        const tokensPrev = Number(comp.tokens_prev7d || 0);
        const tokensLast = Number(comp.tokens_last7d || 0);
        const tokensDelta = tokensPrev > 0 ? ((tokensLast - tokensPrev) / tokensPrev * 100).toFixed(1) : null;

        const maxCost = Math.max(...this.trend.map(d => Number(d.cost || 0)), 1);
        const maxCalls = Math.max(...this.trend.map(d => Number(d.calls || 0)), 1);

        document.getElementById('aiTabContent').innerHTML = `
            <div class="ai-kpi-row">
                <div class="ai-kpi-box" style="background:linear-gradient(135deg,#3b82f6,#1d4ed8);">
                    <div class="label">${LLA_L('总呼叫次数', '總呼叫次數', 'Total Calls')}</div>
                    <div class="value">${Number(s.total_calls || 0).toLocaleString()}</div>
                    <div class="delta">${Number(s.unique_users || 0).toLocaleString()} ${LLA_L('位用户 · ', '位用戶 · ', 'users · ')}${s.providers_used || 0} ${LLA_L('家服务商', '家服務商', 'providers')}</div>
                </div>
                <div class="ai-kpi-box" style="background:linear-gradient(135deg,#10b981,#059669);">
                    <div class="label">${LLA_L('成功率', '成功率', 'Success Rate')}</div>
                    <div class="value">${successRate}%</div>
                    <div class="delta">${LLA_L('成功', '成功', 'Success')} ${s.success_calls || 0} · ${LLA_L('失败', '失敗', 'Failed')} ${s.fail_calls || 0} · ${LLA_L('逾时', '逾時', 'Timeout')} ${s.timeout_calls || 0}</div>
                </div>
                <div class="ai-kpi-box" style="background:linear-gradient(135deg,#f59e0b,#d97706);">
                    <div class="label">${LLA_L('总成本 (USD)', '總成本 (USD)', 'Total Cost (USD)')}</div>
                    <div class="value">$${Number(s.total_cost_usd || 0).toFixed(4)}</div>
                    <div class="delta">
                        ${costDelta !== null
                            ? `${LLA_L('相较前 7 日：', '相較前 7 日：', 'vs. prev. 7 days: ')}${costDelta >= 0 ? '↑' : '↓'} ${Math.abs(costDelta)}%`
                            : LLA_L('（无前周对比）', '（無前週對比）', '(no prior-week comparison)')}
                    </div>
                </div>
                <div class="ai-kpi-box" style="background:linear-gradient(135deg,#8b5cf6,#6d28d9);">
                    <div class="label">${LLA_L('Token 使用量', 'Token 使用量', 'Token Usage')}</div>
                    <div class="value">${Number(s.total_tokens || 0).toLocaleString()}</div>
                    <div class="delta">
                        ${tokensDelta !== null
                            ? `${LLA_L('相较前 7 日：', '相較前 7 日：', 'vs. prev. 7 days: ')}${tokensDelta >= 0 ? '↑' : '↓'} ${Math.abs(tokensDelta)}%`
                            : ''}
                    </div>
                </div>
                <div class="ai-kpi-box" style="background:linear-gradient(135deg,#ec4899,#db2777);">
                    <div class="label">${LLA_L('平均延迟', '平均延遲', 'Avg Latency')}</div>
                    <div class="value">${Math.round(Number(s.avg_latency_ms || 0))} ms</div>
                    <div class="delta">${LLA_L('峰值', '峰值', 'Peak')} ${Math.round(Number(s.max_latency_ms || 0))} ms</div>
                </div>
            </div>

            <div class="card" style="margin-bottom:14px;">
                <div style="font-weight:600;margin-bottom:8px;">${LLA_L('📈 近 30 日成本趋势 (USD)', '📈 近 30 日成本趨勢 (USD)', '📈 30-Day Cost Trend (USD)')}</div>
                <div class="ai-trend">
                    ${this.trend.map(d => {
                        const h = (Number(d.cost || 0) / maxCost * 100).toFixed(1);
                        return `<div class="bar" style="height:${Math.max(h,2)}%" title="${d.day}: $${Number(d.cost||0).toFixed(4)} · ${d.calls} ${LLA_L('次', '次', 'calls')}"></div>`;
                    }).reverse().join('')}
                </div>
                <div style="display:flex;justify-content:space-between;font-size:11px;color:#95a5a6;">
                    <span>${this.trend[this.trend.length-1]?.day || '-'}</span>
                    <span>${this.trend[0]?.day || '-'}</span>
                </div>
            </div>

            <div class="card">
                <div style="font-weight:600;margin-bottom:8px;">${LLA_L('📊 每日明细', '📊 每日明細', '📊 Daily Details')}</div>
                <table class="ai-table">
                    <thead><tr><th>${LLA_L('日期', '日期', 'Date')}</th><th>${LLA_L('呼叫次数', '呼叫次數', 'Calls')}</th><th>Tokens</th><th>${LLA_L('成本 (USD)', '成本 (USD)', 'Cost (USD)')}</th><th>${LLA_L('平均延迟 (ms)', '平均延遲 (ms)', 'Avg Latency (ms)')}</th></tr></thead>
                    <tbody>
                        ${this.trend.map(d => `
                            <tr>
                                <td>${d.day}</td>
                                <td class="mono">${d.calls}</td>
                                <td class="mono">${Number(d.tokens).toLocaleString()}</td>
                                <td class="mono">$${Number(d.cost).toFixed(4)}</td>
                                <td class="mono">${Math.round(Number(d.avg_lat))}</td>
                            </tr>
                        `).join('') || '<tr><td colspan="5" style="text-align:center;color:#95a5a6;padding:30px;">' + LLA_L('暂无资料', '暫無資料', 'No data') + '</td></tr>'}
                    </tbody>
                </table>
            </div>
        `;
    },

    /* ======== 2. 審計日誌 ======== */

    async loadLogs() {
        const qs = new URLSearchParams({ ...this.queryForm, page: this.page, limit: this.pageSize });
        const { data } = await API.get(`/api/llm-audit/list?${qs.toString()}`);
        this.rows = data.rows || [];
        this.total = data.total || 0;
        this.renderLogs();
    },

    renderLogs() {
        const el = document.getElementById('aiTabContent');
        el.innerHTML = `
            <div class="ai-filters">
                <input class="form-control" placeholder="${LLA_L('搜索问题/回答...', '搜尋問題/回答...', 'Search question/answer...')}"
                    value="${this.queryForm.q || ''}" id="fQ"/>
                <select class="form-control" id="fStatus">
                    <option value="">${LLA_L('全部状态', '全部狀態', 'All Statuses')}</option>
                    <option value="SUCCESS" ${this.queryForm.status==='SUCCESS'?'selected':''}>${LLA_L('✅ 成功', '✅ 成功', '✅ Success')}</option>
                    <option value="FAIL"    ${this.queryForm.status==='FAIL'?'selected':''}>${LLA_L('❌ 失败', '❌ 失敗', '❌ Failed')}</option>
                    <option value="TIMEOUT" ${this.queryForm.status==='TIMEOUT'?'selected':''}>${LLA_L('⏱️ 逾时', '⏱️ 逾時', '⏱️ Timeout')}</option>
                </select>
                <select class="form-control" id="fProvider">
                    <option value="">${LLA_L('全部服务商', '全部服務商', 'All Providers')}</option>
                    ${['openai','kimi','deepseek','doubao','aliyun','zhipu','ollama']
                        .map(p => `<option value="${p}" ${this.queryForm.provider===p?'selected':''}>${p}</option>`).join('')}
                </select>
                <input class="form-control" placeholder="${LLA_L('公司码 (HM/HN/SZ)', '公司碼 (HM/HN/SZ)', 'Company (HM/HN/SZ)')}"
                    value="${this.queryForm.bu_no || ''}" id="fBu" style="width:110px;"/>
                <input type="date" class="form-control" id="fFrom" value="${this.queryForm.date_from || ''}"/>
                <input type="date" class="form-control" id="fTo"   value="${this.queryForm.date_to || ''}"/>
                <button class="btn-primary" onclick="LlmAuditPage.applyLogsFilter()">${LLA_L('🔍 查询', '🔍 查詢', '🔍 Search')}</button>
                <button class="btn-secondary" onclick="LlmAuditPage.resetLogsFilter()">${LLA_L('重置', '重置', 'Reset')}</button>
            </div>

            <div class="card">
                <table class="ai-table">
                    <thead>
                        <tr>
                            <th>${LLA_L('时间', '時間', 'Time')}</th><th>${LLA_L('公司', '公司', 'Company')}</th><th>${LLA_L('用户', '用戶', 'User')}</th><th>${LLA_L('服务商/模型', '服務商/模型', 'Provider/Model')}</th>
                            <th>${LLA_L('问题', '問題', 'Question')}</th><th>Token</th><th>${LLA_L('延迟', '延遲', 'Latency')}</th><th>${LLA_L('成本', '成本', 'Cost')}</th><th>${LLA_L('状态', '狀態', 'Status')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.rows.map(r => `
                            <tr>
                                <td class="mono">${(r.created_at||'').replace('T',' ').slice(0,19)}</td>
                                <td>${r.bu_no}</td>
                                <td>${r.xuser_id}</td>
                                <td><b>${r.provider}</b><br><span style="color:#7f8c8d;font-size:11px;">${r.model}</span></td>
                                <td class="truncate" title="${(r.user_prompt||'').replace(/"/g,'&quot;')}">${r.user_prompt || '-'}</td>
                                <td class="mono">${Number(r.total_tokens||0).toLocaleString()}</td>
                                <td class="mono">${r.latency_ms}ms</td>
                                <td class="mono">$${Number(r.cost_usd||0).toFixed(4)}</td>
                                <td><span class="ai-badge ${r.status}">${r.status}</span></td>
                            </tr>
                        `).join('') || '<tr><td colspan="9" style="text-align:center;color:#95a5a6;padding:40px;">' + LLA_L('暂无审计记录（开始使用 AI 问答后自动产生）', '暫無審計記錄（開始使用 AI 問答後自動產生）', 'No audit records (generated automatically once AI Q&A is used)') + '</td></tr>'}
                    </tbody>
                </table>

                <div class="pager">
                    ${LLA_L('共', '共', 'Total')} <b>${this.total}</b> ${LLA_L('笔', '筆', 'records')}
                    <button ${this.page<=1?'disabled':''} onclick="LlmAuditPage.goPage(${this.page-1})">${LLA_L('上一页', '上一頁', 'Prev')}</button>
                    <span>${this.page} / ${Math.max(1,Math.ceil(this.total/this.pageSize))}</span>
                    <button ${this.page*this.pageSize>=this.total?'disabled':''} onclick="LlmAuditPage.goPage(${this.page+1})">${LLA_L('下一页', '下一頁', 'Next')}</button>
                </div>
            </div>
        `;
    },

    applyLogsFilter() {
        this.queryForm = {
            q: document.getElementById('fQ').value.trim(),
            status: document.getElementById('fStatus').value,
            provider: document.getElementById('fProvider').value,
            bu_no: document.getElementById('fBu').value.trim().toUpperCase(),
            date_from: document.getElementById('fFrom').value,
            date_to: document.getElementById('fTo').value,
        };
        this.page = 1;
        this.loadLogs();
    },

    resetLogsFilter() {
        this.queryForm = {}; this.page = 1; this.loadLogs();
    },

    goPage(p) { this.page = p; this.loadLogs(); },

    /* ======== 3. 成本分析 ======== */

    async loadCost() {
        const { data } = await API.get('/api/llm-audit/cost?group_by=provider');
        const { data: m } = await API.get('/api/llm-audit/cost?group_by=model');
        const { data: b } = await API.get('/api/llm-audit/cost?group_by=bu_no');
        this.costData = { provider: data, model: m, bu: b };

        const el = document.getElementById('aiTabContent');
        const renderCostTable = (title, rows) => `
            <div class="card" style="margin-bottom:14px;">
                <div style="font-weight:600;margin-bottom:8px;">💰 ${title}</div>
                <table class="ai-table">
                    <thead><tr><th>${LLA_L('维度', '維度', 'Dimension')}</th><th>${LLA_L('呼叫次数', '呼叫次數', 'Calls')}</th><th>Tokens</th><th>${LLA_L('成本 (USD)', '成本 (USD)', 'Cost (USD)')}</th><th>${LLA_L('平均延迟', '平均延遲', 'Avg Latency')}</th></tr></thead>
                    <tbody>
                        ${rows.map(r => `
                            <tr>
                                <td><b>${r.dim}</b></td>
                                <td class="mono">${r.calls}</td>
                                <td class="mono">${Number(r.tokens).toLocaleString()}</td>
                                <td class="mono">$${Number(r.cost_usd).toFixed(4)}</td>
                                <td class="mono">${Math.round(Number(r.avg_latency))}ms</td>
                            </tr>
                        `).join('') || '<tr><td colspan="5" style="text-align:center;color:#95a5a6;padding:30px;">' + LLA_L('暂无资料', '暫無資料', 'No data') + '</td></tr>'}
                    </tbody>
                </table>
            </div>
        `;
        el.innerHTML = renderCostTable(LLA_L('按服务商', '按服務商', 'by Provider'), data) + renderCostTable(LLA_L('按模型', '按模型', 'by Model'), m) + renderCostTable(LLA_L('按公司别', '按公司別', 'by Company'), b);
    },

    /* ======== 4. 用戶排行 ======== */

    async loadUsers() {
        const { data } = await API.get('/api/llm-audit/users?limit=20');
        this.users = data;

        const el = document.getElementById('aiTabContent');
        el.innerHTML = `
            <div class="card">
                <div style="font-weight:600;margin-bottom:8px;">${LLA_L('👥 活跃用户 TOP 20（按成本排序）', '👥 活躍用戶 TOP 20（按成本排序）', '👥 Active Users TOP 20 (by cost)')}</div>
                <table class="ai-table">
                    <thead><tr><th>#</th><th>${LLA_L('用户', '用戶', 'User')}</th><th>${LLA_L('公司', '公司', 'Company')}</th><th>${LLA_L('呼叫', '呼叫', 'Calls')}</th><th>Tokens</th><th>${LLA_L('成本 (USD)', '成本 (USD)', 'Cost (USD)')}</th><th>${LLA_L('平均延迟', '平均延遲', 'Avg Latency')}</th><th>${LLA_L('最后呼叫', '最後呼叫', 'Last Call')}</th></tr></thead>
                    <tbody>
                        ${this.users.map((r, i) => `
                            <tr>
                                <td style="color:#7f8c8d;">${i+1}</td>
                                <td><b>${r.xuser_id}</b><br><span style="color:#7f8c8d;font-size:11px;">${r.xuser_name || ''}</span></td>
                                <td>${r.bu_no}</td>
                                <td class="mono">${r.calls}</td>
                                <td class="mono">${Number(r.tokens).toLocaleString()}</td>
                                <td class="mono">$${Number(r.cost_usd).toFixed(4)}</td>
                                <td class="mono">${Math.round(Number(r.avg_latency))}ms</td>
                                <td class="mono">${(r.last_call||'').replace('T',' ').slice(0,16)}</td>
                            </tr>
                        `).join('') || '<tr><td colspan="8" style="text-align:center;color:#95a5a6;padding:30px;">' + LLA_L('暂无资料', '暫無資料', 'No data') + '</td></tr>'}
                    </tbody>
                </table>
            </div>
        `;
    },

    /* ======== 5. 模型計價 ======== */

    async loadPricing() {
        const { data } = await API.get('/api/llm-audit/pricing');
        this.pricing = data;
        const canEdit = Auth.isAdmin();

        const el = document.getElementById('aiTabContent');
        el.innerHTML = `
            <div class="card">
                <div style="font-weight:600;margin-bottom:8px;">${LLA_L('🧾 模型计价（USD / 1K tokens）', '🧾 模型計價（USD / 1K tokens）', '🧾 Model Pricing (USD / 1K tokens)')}
                    ${canEdit ? '<span style="font-size:11px;color:#7f8c8d;margin-left:8px;">' + LLA_L('💡 点击数值可直接编辑', '💡 點擊數值可直接編輯', '💡 Click a value to edit') + '</span>' : '<span style="font-size:11px;color:#e74c3c;margin-left:8px;">' + LLA_L('🔒 仅管理员可编辑', '🔒 僅管理員可編輯', '🔒 Admin only') + '</span>'}
                </div>
                <table class="ai-table">
                    <thead><tr><th>UID</th><th>Provider</th><th>Model</th><th>Input $/1K</th><th>Output $/1K</th><th>${LLA_L('操作', '操作', 'Actions')}</th></tr></thead>
                    <tbody>
                        ${this.pricing.map(r => `
                            <tr data-uid="${r.uid}">
                                <td class="mono">${r.uid}</td>
                                <td><b>${r.provider}</b></td>
                                <td>${r.model}</td>
                                <td>
                                    ${canEdit
                                        ? `<input class="ai-edit-input" id="pIn_${r.uid}" value="${r.input_cost_per_1k}"/>`
                                        : `<span class="mono">${r.input_cost_per_1k}</span>`}
                                </td>
                                <td>
                                    ${canEdit
                                        ? `<input class="ai-edit-input" id="pOut_${r.uid}" value="${r.output_cost_per_1k}"/>`
                                        : `<span class="mono">${r.output_cost_per_1k}</span>`}
                                </td>
                                <td>${canEdit ? `<button class="btn-save" onclick="LlmAuditPage.savePricing(${r.uid})">${LLA_L('💾 存', '💾 存', '💾 Save')}</button>` : '-'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },

    async savePricing(uid) {
        const inp = document.getElementById(`pIn_${uid}`).value;
        const out = document.getElementById(`pOut_${uid}`).value;
        const { ok, message } = await API.put(`/api/llm-audit/pricing/${uid}`, {
            input_cost_per_1k: Number(inp), output_cost_per_1k: Number(out)
        });
        if (ok) { this.loadPricing(); toast(LLA_L('✅ 计价已更新', '✅ 計價已更新', '✅ Pricing updated'), 'success'); }
        else toast('❌ ' + (message || LLA_L('更新失败', '更新失敗', 'Update failed')), 'error');
    },

    /* ======== 6. 速率限制 ======== */

    async loadLimits() {
        const { data } = await API.get('/api/llm-audit/limits');
        this.limits = data;
        const canEdit = Auth.isAdmin();

        const el = document.getElementById('aiTabContent');
        el.innerHTML = `
            <div class="card">
                <div style="font-weight:600;margin-bottom:8px;">${LLA_L('🛡️ 每级别每日配额', '🛡️ 每級別每日配額', '🛡️ Daily Quota per Level')}
                    ${canEdit ? '<span style="font-size:11px;color:#7f8c8d;margin-left:8px;">' + LLA_L('💡 点击数值可直接编辑', '💡 點擊數值可直接編輯', '💡 Click a value to edit') + '</span>' : '<span style="font-size:11px;color:#e74c3c;margin-left:8px;">' + LLA_L('🔒 仅管理员可编辑', '🔒 僅管理員可編輯', '🔒 Admin only') + '</span>'}
                </div>
                <table class="ai-table">
                    <thead><tr><th>UID</th><th>Scope</th><th>Key</th><th>${LLA_L('Token 上限', 'Token 上限', 'Token Limit')}</th><th>${LLA_L('呼叫次数', '呼叫次數', 'Calls')}</th><th>${LLA_L('成本上限 (USD)', '成本上限 (USD)', 'Cost Limit (USD)')}</th><th>${LLA_L('状态', '狀態', 'Status')}</th><th>${LLA_L('操作', '操作', 'Actions')}</th></tr></thead>
                    <tbody>
                        ${this.limits.map(r => `
                            <tr data-uid="${r.uid}">
                                <td class="mono">${r.uid}</td>
                                <td>${r.scope}</td>
                                <td><b>${r.scope_key}</b></td>
                                <td>${canEdit
                                    ? `<input class="ai-edit-input" id="lTok_${r.uid}" value="${r.daily_token_limit}" style="width:100px;"/>`
                                    : `<span class="mono">${Number(r.daily_token_limit).toLocaleString()}</span>`}</td>
                                <td>${canEdit
                                    ? `<input class="ai-edit-input" id="lCall_${r.uid}" value="${r.daily_call_limit}" style="width:80px;"/>`
                                    : `<span class="mono">${r.daily_call_limit}</span>`}</td>
                                <td>${canEdit
                                    ? `<input class="ai-edit-input" id="lCost_${r.uid}" value="${r.cost_limit_usd}" style="width:90px;"/>`
                                    : `<span class="mono">$${r.cost_limit_usd}</span>`}</td>
                                <td>
                                    <span class="ai-badge ${r.status==='USE'?'SUCCESS':'FAIL'}">${r.status}</span>
                                </td>
                                <td>${canEdit ? `<button class="btn-save" onclick="LlmAuditPage.saveLimit(${r.uid})">${LLA_L('💾 存', '💾 存', '💾 Save')}</button>` : '-'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <div style="margin-top:10px;font-size:11px;color:#95a5a6;">
                    ${LLA_L('💡 配额检查为 fail-open：即使超出限制也不会挡业务，仅在审计日志标记告警', '💡 配額檢查為 fail-open：即使超出限制也不會擋業務，僅在審計日誌標記告警', '💡 Quota checks are fail-open: exceeding limits never blocks business, only flags a warning in audit logs')}
                </div>
            </div>
        `;
    },

    async saveLimit(uid) {
        const body = {
            daily_token_limit: Number(document.getElementById(`lTok_${uid}`).value),
            daily_call_limit: Number(document.getElementById(`lCall_${uid}`).value),
            cost_limit_usd: Number(document.getElementById(`lCost_${uid}`).value),
        };
        const { ok, message } = await API.put(`/api/llm-audit/limits/${uid}`, body);
        if (ok) { this.loadLimits(); toast(LLA_L('✅ 配额已更新', '✅ 配額已更新', '✅ Quota updated'), 'success'); }
        else toast('❌ ' + (message || LLA_L('更新失败', '更新失敗', 'Update failed')), 'error');
    },
};

registerPage('llmAudit', () => LlmAuditPage.load());
