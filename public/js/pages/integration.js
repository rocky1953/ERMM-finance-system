/**
 * 第三方資料整合（Online / Batch）
 *  Tab1 📊 Excel 匯入：選表 → 上傳 xlsx → 欄位映射 → 預覽 → 寫入
 *  Tab2 🔌 SQL 線上整合：第三方資料源 → SELECT 預覽 → 映射 → 立即執行 / 存為批次作業
 *  Tab3 ⏰ 批次作業：作業清單 / 啟用停用 / 立即執行 / 編輯
 *  Tab4 🗄️ 資料源：第三方連線 CRUD + 連線測試
 *  Tab5 📜 執行日誌
 */
const Integration = {
    tab: 'excel',
    tables: [],
    colCache: {},
    sources: [],
    jobs: [],
    logs: [],

    // Excel 嚮導狀態
    xl: { fileName: '', base64: '', parsed: null, sheetName: '', targetTable: '', cols: [], mapping: {}, keys: [], writeMode: 'INSERT' },
    // SQL 主控台狀態
    sq: { sourceId: '', sql: '', result: null, targetTable: '', cols: [], mapping: {}, keys: [], writeMode: 'INSERT', editJobId: null },

    async render(el) {
        el.innerHTML = `
        <div style="margin-bottom:14px;">
            <div class="tabs" style="display:flex;gap:4px;border-bottom:2px solid #e2e8f0;flex-wrap:wrap;">
                ${this.tabBtns()}
            </div>
        </div>
        <div id="intgBody"></div>`;
        await this.ensureTables();
        this.renderTab();
    },

    tabBtns() {
        const tabs = [
            ['excel', '📊 Excel 导入'],
            ['sql', '🔌 SQL 线上整合'],
            ['batch', '⏰ 批次作业'],
            ['sources', '🗄️ 数据源'],
            ['logs', '📜 执行日志'],
        ];
        return tabs.map(([k, label]) => `
            <button onclick="Integration.switchTab('${k}')"
                style="padding:9px 18px;border:none;background:${this.tab === k ? '#1e3a5f' : 'transparent'};
                color:${this.tab === k ? '#fff' : '#475569'};border-radius:8px 8px 0 0;cursor:pointer;font-size:14px;font-weight:600;">
                ${label}</button>`).join('');
    },

    async switchTab(k) {
        this.tab = k;
        await this.render(document.getElementById('pageContent'));
    },

    async ensureTables() {
        if (this.tables.length) return;
        const res = (await API.get('/api/integration/tables')).data;
        this.tables = res;
    },

    async getCols(table) {
        if (!this.colCache[table]) {
            this.colCache[table] = (await API.get(`/api/integration/tables/${encodeURIComponent(table)}/columns`)).data;
        }
        return this.colCache[table];
    },

    tableOptions(sel) {
        return ['<option value="">— 请选择目标表 —</option>']
            .concat(this.tables.map(t => `<option value="${esc(t.name)}" ${t.name === sel ? 'selected' : ''}>${esc(t.name)}${t.comment ? '（' + esc(t.comment) + '）' : ''}</option>`)).join('');
    },

    renderTab() {
        const body = document.getElementById('intgBody');
        if (this.tab === 'excel') body.innerHTML = this.viewExcel();
        else if (this.tab === 'sql') { body.innerHTML = this.viewSql(); this.loadSources(); }
        else if (this.tab === 'batch') { body.innerHTML = '<div style="padding:30px;color:#94a3b8;">载入中…</div>'; this.loadJobs(); }
        else if (this.tab === 'sources') { body.innerHTML = '<div style="padding:30px;color:#94a3b8;">载入中…</div>'; this.loadSources(true); }
        else if (this.tab === 'logs') { body.innerHTML = '<div style="padding:30px;color:#94a3b8;">载入中…</div>'; this.loadLogs(); }
    },

    // ================= Tab1：Excel 匯入 =================
    viewExcel() {
        const x = this.xl;
        const sheetOpts = x.parsed ? x.parsed.sheets.map(s =>
            `<option value="${esc(s.name)}" ${s.name === x.sheetName ? 'selected' : ''}>${esc(s.name)}（${s.total_rows} 列）</option>`).join('') : '';
        return `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:18px;">
            <div style="display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;">
                <div><label style="font-size:12px;color:#64748b;">① 目标资料表</label>
                    <select id="xlTable" onchange="Integration.xlPickTable(this.value)" style="display:block;margin-top:4px;min-width:280px;padding:7px;border:1px solid #cbd5e1;border-radius:6px;">${this.tableOptions(x.targetTable)}</select>
                </div>
                <div><label style="font-size:12px;color:#64748b;">② 第三方 Excel 档（.xlsx，表头在第 1 列）</label>
                    <input type="file" id="xlFile" accept=".xlsx" onchange="Integration.xlPickFile(this)" style="display:block;margin-top:4px;font-size:13px;">
                </div>
                <div id="xlSheetWrap" style="${x.parsed ? '' : 'display:none;'}"><label style="font-size:12px;color:#64748b;">③ 工作表</label>
                    <select id="xlSheet" onchange="Integration.xlPickSheet(this.value)" style="display:block;margin-top:4px;padding:7px;border:1px solid #cbd5e1;border-radius:6px;min-width:200px;">${sheetOpts}</select>
                </div>
            </div>
            <div id="xlMapping"></div>
        </div>`;
    },

    async xlPickTable(name) {
        this.xl.targetTable = name;
        this.xl.cols = name ? await this.getCols(name) : [];
        if (name) this.autoMap('xl');
        this.renderTab();
    },

    xlPickFile(input) {
        const f = input.files[0];
        if (!f) return;
        if (f.size > 20 * 1024 * 1024) { UI.toast('档案超过 20MB', 'error'); return; }
        const reader = new FileReader();
        reader.onload = async () => {
            const b64 = reader.result.split(',')[1];
            this.xl.fileName = f.name;
            this.xl.base64 = b64;
            try {
                UI.toast('解析中…', 'info');
                const res = (await API.post('/api/integration/excel/parse', { file_base64: b64, file_name: f.name })).data;
                this.xl.parsed = res;
                this.xl.sheetName = res.sheets[0]?.name || '';
                this.autoMap('xl');
                this.renderTab();
                UI.toast(`解析成功：${res.sheets.length} 个工作表`, 'success');
            } catch (e) { UI.toast(e.message, 'error'); }
        };
        reader.readAsDataURL(f);
    },

    xlPickSheet(name) {
        this.xl.sheetName = name;
        this.autoMap('xl');
        const m = document.getElementById('xlMapping');
        if (m) m.innerHTML = this.mappingPanel('xl');
    },

    currentSheet() {
        const x = this.xl;
        return x.parsed ? x.parsed.sheets.find(s => s.name === x.sheetName) : null;
    },

    // 同名欄自動映射
    autoMap(kind) {
        const st = this[kind === 'xl' ? 'xl' : 'sq'];
        let srcHeaders = [];
        if (kind === 'xl') srcHeaders = (this.currentSheet()?.headers) || [];
        else srcHeaders = st.result?.columns || [];
        const mapping = {};
        const keys = [];
        for (const c of st.cols) {
            const hit = srcHeaders.find(h => h.toLowerCase() === c.name.toLowerCase());
            if (hit) mapping[c.name] = hit;
            if (c.columnKey === 'PRI') keys.push(c.name);
        }
        st.mapping = mapping;
        st.keys = keys;
    },

    // 欄位映射面板（Excel / SQL 共用）
    mappingPanel(kind) {
        const st = this[kind === 'xl' ? 'xl' : 'sq'];
        const srcHeaders = kind === 'xl' ? (this.currentSheet()?.headers || []) : (st.result?.columns || []);
        const previewRows = kind === 'xl' ? (this.currentSheet()?.preview || []) : (st.result?.rows || []).slice(0, 5);
        if (!st.cols.length) return '';
        if (kind === 'xl' && !this.currentSheet()) return '';
        if (kind === 'sq' && !st.result) return '';

        const rowsHtml = st.cols.map(c => {
            const sel = st.mapping[c.name] || '';
            const isKey = st.keys.includes(c.name);
            return `<tr>
                <td><b>${esc(c.name)}</b>${c.columnKey === 'PRI' ? ' <span class="tag" style="background:#fee2e2;color:#991b1b;">PK</span>' : c.columnKey === 'UNI' ? ' <span class="tag" style="background:#fef3c7;color:#92400e;">UK</span>' : ''}</td>
                <td style="color:#64748b;font-size:12px;">${esc(c.columnType)}${c.nullable === 'NO' ? ' NOT NULL' : ''}</td>
                <td>
                    <select onchange="Integration.setMap('${kind}','${esc(c.name)}',this.value)" style="padding:4px 8px;border:1px solid #cbd5e1;border-radius:5px;min-width:180px;">
                        <option value="">— 不导入 —</option>
                        ${srcHeaders.map(h => `<option value="${esc(h)}" ${h === sel ? 'selected' : ''}>${esc(h)}</option>`).join('')}
                    </select>
                </td>
                <td style="text-align:center;">
                    <input type="checkbox" ${isKey ? 'checked' : ''} onchange="Integration.toggleKey('${kind}','${esc(c.name)}',this.checked)">
                </td>
            </tr>`;
        }).join('');

        const previewHtml = previewRows.length ? `
            <div style="margin-top:14px;">
                <div style="font-weight:600;font-size:13px;margin-bottom:6px;">🔍 资料预览（前 ${previewRows.length} 列）</div>
                <div style="max-height:220px;overflow:auto;border:1px solid #e2e8f0;border-radius:6px;">
                <table class="data-table" style="width:100%;font-size:12px;">
                    <thead style="position:sticky;top:0;"><tr>${srcHeaders.slice(0, 12).map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
                    <tbody>${previewRows.map(r => `<tr>${srcHeaders.slice(0, 12).map(h => `<td>${esc(r[h])}</td>`).join('')}</tr>`).join('')}</tbody>
                </table></div>
                ${srcHeaders.length > 12 ? '<div style="font-size:11px;color:#94a3b8;margin-top:4px;">仅预览前 12 个栏位</div>' : ''}
            </div>` : '';

        return `
        <div style="margin-top:18px;border-top:2px dashed #e2e8f0;padding-top:16px;">
            <div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
                <label style="font-size:12px;color:#64748b;">④ 写入模式
                    <select id="${kind}WriteMode" onchange="Integration.setMode('${kind}',this.value)" style="margin-left:6px;padding:6px;border:1px solid #cbd5e1;border-radius:6px;">
                        <option value="INSERT" ${st.writeMode === 'INSERT' ? 'selected' : ''}>仅新增（INSERT）</option>
                        <option value="UPSERT" ${st.writeMode === 'UPSERT' ? 'selected' : ''}>新增或更新（UPSERT）</option>
                    </select>
                </label>
                <div style="font-size:12px;color:#94a3b8;">勾选「匹配键」用于判断新增/更新（建议用 PK/UK；无唯一约束时系统自动比对）</div>
            </div>
            <div style="max-height:300px;overflow:auto;border:1px solid #e2e8f0;border-radius:8px;">
            <table class="data-table" style="width:100%;font-size:13px;">
                <thead style="position:sticky;top:0;"><tr><th>目标栏位</th><th>类型</th><th>← 来源栏位（Excel/SQL）</th><th style="text-align:center;">匹配键</th></tr></thead>
                <tbody>${rowsHtml}</tbody>
            </table></div>
            ${previewHtml}
            <div style="margin-top:16px;text-align:right;">
                <button class="btn btn-primary" onclick="Integration.doImport()" ${kind === 'xl' ? '' : 'style="display:none;"'}>🚀 开始导入（${this.currentSheet()?.total_rows || 0} 列）</button>
            </div>
        </div>`;
    },

    setMap(kind, tgt, src) {
        const st = this[kind === 'xl' ? 'xl' : 'sq'];
        if (src) st.mapping[tgt] = src; else delete st.mapping[tgt];
    },
    toggleKey(kind, col, checked) {
        const st = this[kind === 'xl' ? 'xl' : 'sq'];
        st.keys = st.keys.filter(k => k !== col);
        if (checked) st.keys.push(col);
    },
    setMode(kind, v) { this[kind === 'xl' ? 'xl' : 'sq'].writeMode = v; },

    async doImport() {
        const x = this.xl;
        if (!x.targetTable) return UI.toast('请先选择目标表', 'error');
        if (!x.sheetName) return UI.toast('请先选择工作表', 'error');
        if (!Object.keys(x.mapping).length) return UI.toast('请至少映射一个栏位', 'error');
        if (x.writeMode === 'UPSERT' && !x.keys.length) return UI.toast('UPSERT 模式需勾选匹配键', 'error');
        if (!confirm(`确认将「${x.fileName} / ${x.sheetName}」写入 ${x.targetTable}？`)) return;
        try {
            UI.toast('导入中，档案越大请稍候…', 'info');
            const res = (await API.post('/api/integration/excel/import', {
                target_table: x.targetTable,
                file_base64: x.base64,
                file_name: x.fileName,
                sheet_name: x.sheetName,
                mapping: x.mapping,
                key_columns: x.keys,
                write_mode: x.writeMode,
            })).data;
            UI.modal('✅ 导入完成', `
                <div style="display:flex;gap:14px;flex-wrap:wrap;">
                    <div style="flex:1;min-width:120px;background:#f1f5f9;border-radius:8px;padding:14px;text-align:center;">
                        <div style="font-size:24px;font-weight:800;color:#1e3a5f;">${res.total_rows}</div><div style="font-size:12px;color:#64748b;">读取总列数</div></div>
                    <div style="flex:1;min-width:120px;background:#dcfce7;border-radius:8px;padding:14px;text-align:center;">
                        <div style="font-size:24px;font-weight:800;color:#166534;">${res.insert_rows}</div><div style="font-size:12px;color:#64748b;">新增</div></div>
                    <div style="flex:1;min-width:120px;background:#dbeafe;border-radius:8px;padding:14px;text-align:center;">
                        <div style="font-size:24px;font-weight:800;color:#1e40af;">${res.update_rows}</div><div style="font-size:12px;color:#64748b;">更新</div></div>
                    <div style="flex:1;min-width:120px;background:#fee2e2;border-radius:8px;padding:14px;text-align:center;">
                        <div style="font-size:24px;font-weight:800;color:#991b1b;">${res.error_rows}</div><div style="font-size:12px;color:#64748b;">失败</div></div>
                </div>
                ${(res.errors || []).length ? `<pre style="margin-top:12px;max-height:160px;overflow:auto;font-size:11px;">${esc(res.errors.join('\n'))}</pre>` : ''}
            `, `<button class="btn btn-outline" onclick="UI.closeModal()">关闭</button>
                <button class="btn btn-success" onclick="UI.closeModal();Integration.switchTab('logs')">查看日志</button>`);
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ================= Tab2：SQL 線上整合 =================
    viewSql() {
        const s = this.sq;
        const srcOpts = ['<option value="">— 选择数据源 —</option>']
            .concat(this.sources.map(x => `<option value="${x.id}" ${String(x.id) === String(s.sourceId) ? 'selected' : ''}>${esc(x.name)}（${esc(x.host)}/${esc(x.db_name)}）</option>`)).join('');
        return `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:18px;">
            <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
                <div style="flex:1;min-width:280px;"><label style="font-size:12px;color:#64748b;">① 第三方数据源</label>
                    <select id="sqSource" onchange="Integration.sq.sourceId=this.value" style="display:block;margin-top:4px;width:100%;padding:7px;border:1px solid #cbd5e1;border-radius:6px;">${srcOpts}</select>
                </div>
                <button class="btn btn-outline" onclick="Integration.openSourceForm()">🗄️ 管理数据源</button>
                <button class="btn btn-success" onclick="Integration.sqPreview()">🔍 测试读取（前 50 行）</button>
            </div>
            <div style="margin-top:12px;"><label style="font-size:12px;color:#64748b;">② 第三方查询 SQL（仅允许 SELECT）</label>
                <textarea id="sqSql" style="width:100%;margin-top:4px;height:110px;font-family:Consolas,monospace;font-size:13px;padding:10px;border:1px solid #cbd5e1;border-radius:6px;"
                    placeholder="SELECT customer_id AS uid, name, amt FROM erp.customer WHERE ...">${esc(s.sql)}</textarea>
            </div>
            <div style="margin-top:12px;"><label style="font-size:12px;color:#64748b;">③ 写入本地目标表</label>
                <select id="sqTable" onchange="Integration.sqPickTable(this.value)" style="display:block;margin-top:4px;min-width:320px;padding:7px;border:1px solid #cbd5e1;border-radius:6px;">${this.tableOptions(s.targetTable)}</select>
            </div>
            <div id="sqMapping"></div>
            <div id="sqActions" style="margin-top:16px;text-align:right;display:none;gap:8px;justify-content:flex-end;">
                <button class="btn btn-outline" onclick="Integration.openSaveBatch()">💾 存为批次作业</button>
                <button class="btn btn-primary" onclick="Integration.sqRun()">▶ 立即执行（Online）</button>
            </div>
        </div>`;
    },

    async sqPickTable(name) {
        this.sq.targetTable = name;
        this.sq.cols = name ? await this.getCols(name) : [];
        if (name && this.sq.result) this.autoMap('sq');
        this.refreshSqLower();
    },

    refreshSqLower() {
        const map = document.getElementById('sqMapping');
        const act = document.getElementById('sqActions');
        if (map) map.innerHTML = this.mappingPanel('sq');
        if (act) act.style.display = (this.sq.result && this.sq.cols.length) ? 'flex' : 'none';
    },

    async sqPreview() {
        const s = this.sq;
        s.sql = document.getElementById('sqSql').value;
        s.sourceId = document.getElementById('sqSource').value;
        if (!s.sourceId || !s.sql.trim()) return UI.toast('请选择数据源并输入 SQL', 'error');
        try {
            UI.toast('读取中…', 'info');
            const res = (await API.post('/api/integration/sources/query', { source_id: s.sourceId, sql: s.sql, limit: 50 })).data;
            if (!res.row_count) { UI.toast('查询无资料', 'info'); s.result = res; this.refreshSqLower(); return; }
            s.result = res;
            if (s.cols.length) this.autoMap('sq');
            this.refreshSqLower();
            UI.toast(`读取成功：${res.row_count} 行`, 'success');
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async sqRun() {
        const s = this.sq;
        if (!s.targetTable || !Object.keys(s.mapping).length) return UI.toast('请完成目标表与栏位映射', 'error');
        if (s.writeMode === 'UPSERT' && !s.keys.length) return UI.toast('UPSERT 模式需勾选匹配键', 'error');
        // 先存草稿作業（Online 也留作業設定，id 用於復用），再立即執行
        if (!confirm('确认立即执行资料整合写入？')) return;
        try {
            let jobId = s.editJobId;
            const payload = {
                name: s.editJobName || `Online_${s.targetTable}_${Date.now()}`,
                channel: 'SQL', source_id: Number(s.sourceId), source_sql: s.sql,
                target_table: s.targetTable, column_mapping: s.mapping,
                key_columns: s.keys, write_mode: s.writeMode, mode: 'ONLINE', enabled: false,
            };
            const r = jobId
                ? (await API.put(`/api/integration/jobs/${jobId}`, payload)).data
                : (await API.post('/api/integration/jobs', payload)).data;
            jobId = r.id;
            UI.toast('执行中…', 'info');
            const res = (await API.post(`/api/integration/jobs/${jobId}/run`)).data;
            this.showRunResult(res);
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    showRunResult(res) {
        UI.modal('✅ 执行完成', `
            <div style="display:flex;gap:14px;flex-wrap:wrap;">
                <div style="flex:1;min-width:120px;background:#f1f5f9;border-radius:8px;padding:14px;text-align:center;">
                    <div style="font-size:24px;font-weight:800;color:#1e3a5f;">${res.total_rows}</div><div style="font-size:12px;color:#64748b;">读取</div></div>
                <div style="flex:1;min-width:120px;background:#dcfce7;border-radius:8px;padding:14px;text-align:center;">
                    <div style="font-size:24px;font-weight:800;color:#166534;">${res.insert_rows}</div><div style="font-size:12px;color:#64748b;">新增</div></div>
                <div style="flex:1;min-width:120px;background:#dbeafe;border-radius:8px;padding:14px;text-align:center;">
                    <div style="font-size:24px;font-weight:800;color:#1e40af;">${res.update_rows}</div><div style="font-size:12px;color:#64748b;">更新</div></div>
                <div style="flex:1;min-width:120px;background:#fee2e2;border-radius:8px;padding:14px;text-align:center;">
                    <div style="font-size:24px;font-weight:800;color:#991b1b;">${res.error_rows}</div><div style="font-size:12px;color:#64748b;">失败</div></div>
            </div>
            ${(res.errors || []).length ? `<pre style="margin-top:12px;max-height:160px;overflow:auto;font-size:11px;">${esc(res.errors.join('\n'))}</pre>` : ''}
        `, `<button class="btn btn-outline" onclick="UI.closeModal()">关闭</button>
            <button class="btn btn-success" onclick="UI.closeModal();Integration.switchTab('logs')">查看日志</button>`);
    },

    // ================= Tab3：批次作業 =================
    async loadJobs() {
        this.jobs = (await API.get('/api/integration/jobs')).data;
        this.renderJobs();
    },
    renderJobs() {
        const body = document.getElementById('intgBody');
        const badge = (v, color) => `<span style="background:${color};color:#fff;padding:2px 9px;border-radius:10px;font-size:11px;">${v}</span>`;
        const stColor = { SUCCESS: '#27ae60', FAIL: '#e74c3c', RUNNING: '#3498db' };
        body.innerHTML = `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <div style="font-weight:700;">整合作业（Online 手动 / Batch 排程）</div>
                <div><button class="btn btn-outline" onclick="Integration.loadJobs()">🔄</button></div>
            </div>
            <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;font-size:13px;">
                <thead><tr><th>ID</th><th>作业名称</th><th>通道</th><th>数据源</th><th>目标表</th><th>模式</th><th>排程</th><th>启用</th><th>最后执行</th><th>最后状态</th><th>操作</th></tr></thead>
                <tbody>${this.jobs.map(j => `<tr>
                    <td>${j.id}</td>
                    <td><b>${esc(j.name)}</b></td>
                    <td>${j.channel === 'SQL' ? '🔌 SQL' : '📊 Excel'}</td>
                    <td>${esc(j.source_name || '—')}</td>
                    <td><code>${esc(j.target_table)}</code></td>
                    <td>${j.mode === 'BATCH' ? badge('BATCH', '#8b5cf6') : badge('ONLINE', '#64748b')}</td>
                    <td>${j.mode === 'BATCH' ? esc(j.schedule || '—') : '—'}</td>
                    <td>${j.enabled ? '✅' : '⛔'}</td>
                    <td style="font-size:11px;">${j.last_run_at ? esc(String(j.last_run_at).slice(0, 19)) : '—'}</td>
                    <td>${j.last_status ? badge(j.last_status, stColor[j.last_status] || '#999') : '—'}</td>
                    <td style="white-space:nowrap;">
                        ${j.channel === 'SQL' ? `<button class="btn btn-sm" style="padding:3px 9px;" onclick="Integration.jobRun(${j.id})">▶ 执行</button>` : ''}
                        ${j.channel === 'SQL' ? `<button class="btn btn-sm" style="padding:3px 9px;" onclick="Integration.jobEdit(${j.id})">✏️ 编辑</button>` : ''}
                        <button class="btn btn-sm" style="padding:3px 9px;" onclick="Integration.jobToggle(${j.id},${j.enabled ? 0 : 1})">${j.enabled ? '停用' : '启用'}</button>
                        <button class="btn btn-sm" style="padding:3px 9px;color:#e74c3c;" onclick="Integration.jobDel(${j.id})">删除</button>
                    </td>
                </tr>`).join('') || `<tr><td colspan="11" style="text-align:center;color:#94a3b8;padding:24px;">尚无作业，可至「SQL 线上整合」设定后「存为批次作业」</td></tr>`}</tbody>
            </table></div>
        </div>`;
    },

    async jobRun(id) {
        if (!confirm('立即执行此作业？')) return;
        try {
            const res = (await API.post(`/api/integration/jobs/${id}/run`)).data;
            this.showRunResult(res);
            this.loadJobs();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async jobEdit(id) {
        const j = this.jobs.find(x => x.id === id);
        if (!j) return;
        await this.switchTab('sql');
        await this.loadSources(false);
        this.sq = {
            sourceId: String(j.source_id || ''), sql: j.source_sql || '', result: null,
            targetTable: j.target_table, cols: [],
            mapping: j.column_mapping || {}, keys: (j.key_columns || '').split(',').filter(Boolean),
            writeMode: j.write_mode || 'INSERT', editJobId: j.id, editJobName: j.name,
            editMode: j.mode, editSchedule: j.schedule, editEnabled: j.enabled,
        };
        document.getElementById('sqSource').value = this.sq.sourceId;
        document.getElementById('sqSql').value = this.sq.sql;
        document.getElementById('sqTable').value = this.sq.targetTable;
        this.sq.cols = await this.getCols(j.target_table);
        // 無預覽結果時，用映射中已有的來源欄產生一個欄位集合，供面板顯示下拉
        const srcCols = [...new Set(Object.values(this.sq.mapping))];
        this.sq.result = { columns: srcCols, rows: [], row_count: 0 };
        this.refreshSqLower();
        UI.toast(`已载入作业 #${id}，可「测试读取」后再保存/执行`, 'info');
    },

    async jobToggle(id, enabled) {
        const j = this.jobs.find(x => x.id === id);
        try {
            await API.put(`/api/integration/jobs/${id}`, { ...j, column_mapping: j.column_mapping, key_columns: (j.key_columns || '').split(',').filter(Boolean), enabled: !!enabled });
            UI.toast(enabled ? '已启用' : '已停用', 'success');
            this.loadJobs();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async jobDel(id) {
        if (!confirm('确认删除此作业？')) return;
        await API.del(`/api/integration/jobs/${id}`);
        UI.toast('已删除', 'success');
        this.loadJobs();
    },

    openSaveBatch() {
        const s = this.sq;
        if (!s.sourceId || !s.targetTable) return UI.toast('请先完成数据源/SQL/目标表', 'error');
        UI.modal('💾 存为批次作业', `
            <div style="display:flex;flex-direction:column;gap:12px;">
                <div><label style="font-size:12px;color:#64748b;">作业名称</label>
                    <input id="batchName" class="input" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;" value="${esc(s.editJobName || ('Batch_' + s.targetTable))}"></div>
                <div><label style="font-size:12px;color:#64748b;">排程（daily HH:MM 每日定时；every Nm 每 N 分钟）</label>
                    <input id="batchSchedule" class="input" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;" placeholder="例如：daily 02:30 或 every 30m" value="${esc(s.editSchedule || 'daily 02:30')}"></div>
                <div style="font-size:12px;color:#94a3b8;">保存后于「批次作业」页启用即生效（排程器每分钟检查）。</div>
            </div>`,
            `<button class="btn btn-outline" onclick="UI.closeModal()">取消</button>
             <button class="btn btn-primary" onclick="Integration.saveBatch()">保存</button>`);
    },

    async saveBatch() {
        const s = this.sq;
        const name = document.getElementById('batchName').value.trim();
        const schedule = document.getElementById('batchSchedule').value.trim();
        if (!name || !schedule) return UI.toast('名称与排程必填', 'error');
        if (!/^(daily\s+\d{1,2}:\d{2}|every\s+\d+m)$/i.test(schedule)) return UI.toast('排程格式错误（daily HH:MM / every Nm）', 'error');
        const payload = {
            name, channel: 'SQL', source_id: Number(s.sourceId), source_sql: s.sql,
            target_table: s.targetTable, column_mapping: s.mapping, key_columns: s.keys,
            write_mode: s.writeMode, mode: 'BATCH', schedule, enabled: true,
        };
        try {
            if (s.editJobId) await API.put(`/api/integration/jobs/${s.editJobId}`, payload);
            else { const r = (await API.post('/api/integration/jobs', payload)).data; s.editJobId = r.id; }
            s.editJobName = name; s.editMode = 'BATCH'; s.editSchedule = schedule;
            UI.closeModal();
            UI.toast('批次作业已保存', 'success');
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ================= Tab4：資料源 =================
    async loadSources(render = false) {
        this.sources = (await API.get('/api/integration/sources')).data;
        if (this.tab === 'sql') {
            const sel = document.getElementById('sqSource');
            if (sel) sel.innerHTML = ['<option value="">— 选择数据源 —</option>']
                .concat(this.sources.map(x => `<option value="${x.id}">${esc(x.name)}（${esc(x.host)}/${esc(x.db_name)}）</option>`)).join('');
            if (this.sq.sourceId) sel.value = this.sq.sourceId;
        }
        if (render || this.tab === 'sources') this.renderSources();
    },

    renderSources() {
        const body = document.getElementById('intgBody');
        body.innerHTML = `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <div style="font-weight:700;">第三方数据源连线设定</div>
                <div><button class="btn btn-primary" onclick="Integration.openSourceForm()">➕ 新增数据源</button>
                     <button class="btn btn-outline" onclick="Integration.loadSources(true)">🔄</button></div>
            </div>
            <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;font-size:13px;">
                <thead><tr><th>ID</th><th>名称</th><th>类型</th><th>主机</th><th>Port</th><th>数据库</th><th>账号</th><th>密码</th><th>启用</th><th>备注</th><th>操作</th></tr></thead>
                <tbody>${this.sources.map(s => `<tr>
                    <td>${s.id}</td><td><b>${esc(s.name)}</b></td><td>${esc(s.db_type)}</td>
                    <td>${esc(s.host)}</td><td>${s.port}</td><td>${esc(s.db_name)}</td><td>${esc(s.db_user)}</td>
                    <td>${s.has_password ? '●●●●' : '—'}</td>
                    <td>${s.enabled ? '✅' : '⛔'}</td><td style="font-size:12px;color:#64748b;">${esc(s.remark || '')}</td>
                    <td style="white-space:nowrap;">
                        <button class="btn btn-sm" style="padding:3px 9px;" onclick="Integration.sourceTest(${s.id})">🔌 测试</button>
                        <button class="btn btn-sm" style="padding:3px 9px;" onclick='Integration.openSourceForm(${s.id})'>✏️</button>
                        <button class="btn btn-sm" style="padding:3px 9px;color:#e74c3c;" onclick="Integration.sourceDel(${s.id})">删除</button>
                    </td></tr>`).join('') || `<tr><td colspan="11" style="text-align:center;color:#94a3b8;padding:24px;">尚无数据源</td></tr>`}</tbody>
            </table></div>
        </div>`;
    },

    openSourceForm(id) {
        const s = id ? this.sources.find(x => x.id === id) : null;
        UI.modal(s ? '✏️ 编辑数据源' : '➕ 新增数据源', `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div><label style="font-size:12px;color:#64748b;">名称*</label>
                    <input id="srcName" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;" value="${esc(s?.name || '')}"></div>
                <div><label style="font-size:12px;color:#64748b;">数据库类型</label>
                    <select id="srcType" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;"><option value="mysql">MySQL</option></select></div>
                <div><label style="font-size:12px;color:#64748b;">主机*</label>
                    <input id="srcHost" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;" value="${esc(s?.host || '')}" placeholder="192.168.1.100"></div>
                <div><label style="font-size:12px;color:#64748b;">Port</label>
                    <input id="srcPort" type="number" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;" value="${s?.port || 3306}"></div>
                <div><label style="font-size:12px;color:#64748b;">数据库名*</label>
                    <input id="srcDb" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;" value="${esc(s?.db_name || '')}"></div>
                <div><label style="font-size:12px;color:#64748b;">字符集</label>
                    <input id="srcCharset" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;" value="${esc(s?.charset || 'utf8mb4')}"></div>
                <div><label style="font-size:12px;color:#64748b;">账号*</label>
                    <input id="srcUser" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;" value="${esc(s?.db_user || '')}"></div>
                <div><label style="font-size:12px;color:#64748b;">密码${s ? '（留空表示不修改）' : ''}</label>
                    <input id="srcPwd" type="password" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;" value=""></div>
                <div style="grid-column:1/3;"><label style="font-size:12px;color:#64748b;">备注</label>
                    <input id="srcRemark" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;" value="${esc(s?.remark || '')}"></div>
            </div>`,
            `<button class="btn btn-outline" onclick="UI.closeModal()">取消</button>
             <button class="btn btn-warning" onclick="Integration.sourceTestForm()">🔌 测试连线</button>
             <button class="btn btn-primary" onclick="Integration.sourceSave(${id || 0})">保存</button>`);
    },

    readSourceForm() {
        return {
            name: document.getElementById('srcName').value.trim(),
            db_type: document.getElementById('srcType').value,
            host: document.getElementById('srcHost').value.trim(),
            port: Number(document.getElementById('srcPort').value) || 3306,
            db_name: document.getElementById('srcDb').value.trim(),
            charset: document.getElementById('srcCharset').value.trim() || 'utf8mb4',
            db_user: document.getElementById('srcUser').value.trim(),
            db_password: document.getElementById('srcPwd').value,
            remark: document.getElementById('srcRemark').value.trim(),
        };
    },

    async sourceTestForm() {
        const b = this.readSourceForm();
        try {
            const r = (await API.post('/api/integration/sources-test', b)).data;
            UI.toast(`连线成功 ✅ MySQL ${r.version}`, 'success');
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async sourceTest(id) {
        try {
            const r = (await API.post(`/api/integration/sources/${id}/test`)).data;
            UI.toast(`连线成功 ✅ MySQL ${r.version}`, 'success');
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async sourceSave(id) {
        const b = this.readSourceForm();
        if (!b.name || !b.host || !b.db_name || !b.db_user) return UI.toast('名称/主机/数据库/账号必填', 'error');
        try {
            if (id) await API.put(`/api/integration/sources/${id}`, b);
            else await API.post('/api/integration/sources', b);
            UI.closeModal();
            UI.toast('已保存', 'success');
            this.loadSources(true);
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async sourceDel(id) {
        if (!confirm('确认删除此数据源？')) return;
        try {
            await API.del(`/api/integration/sources/${id}`);
            UI.toast('已删除', 'success');
            this.loadSources(true);
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ================= Tab5：日誌 =================
    async loadLogs() {
        this.logs = (await API.get('/api/integration/logs?limit=100')).data;
        this.renderLogs();
    },
    renderLogs() {
        const body = document.getElementById('intgBody');
        const c = { SUCCESS: '#27ae60', FAIL: '#e74c3c', RUNNING: '#3498db' };
        const ch = { SQL: '🔌 SQL', EXCEL: '📊 Excel' };
        body.innerHTML = `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <div style="font-weight:700;">最近 100 笔整合执行日志</div>
                <button class="btn btn-outline" onclick="Integration.loadLogs()">🔄</button>
            </div>
            <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;font-size:12px;">
                <thead><tr><th>ID</th><th>时间</th><th>作业</th><th>通道</th><th>触发</th><th>目标表</th><th>总数</th><th>新增</th><th>更新</th><th>失败</th><th>耗时</th><th>状态</th><th>错误/档案</th></tr></thead>
                <tbody>${this.logs.map(l => `<tr>
                    <td>${l.id}</td>
                    <td style="white-space:nowrap;">${esc(String(l.started_at).slice(0, 19))}</td>
                    <td>${esc(l.job_name)}</td>
                    <td>${ch[l.channel] || l.channel}</td>
                    <td>${l.run_type === 'SCHEDULED' ? '⏰ 排程' : l.run_type === 'MANUAL' ? '🖱️ 手动' : '📊 Excel'}</td>
                    <td><code>${esc(l.target_table)}</code></td>
                    <td>${l.total_rows}</td><td style="color:#166534;">${l.insert_rows}</td>
                    <td style="color:#1e40af;">${l.update_rows}</td>
                    <td style="color:${l.error_rows ? '#991b1b' : '#64748b'};font-weight:${l.error_rows ? 700 : 400};">${l.error_rows}</td>
                    <td>${l.duration_ms != null ? (l.duration_ms / 1000).toFixed(1) + 's' : '—'}</td>
                    <td><span style="background:${c[l.status] || '#999'};color:#fff;padding:2px 9px;border-radius:10px;font-size:11px;">${l.status}</span></td>
                    <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:${l.error_msg ? '#991b1b' : '#94a3b8'};" title="${esc(l.error_msg || '')}">${esc(l.error_msg || l.file_name || '')}</td>
                </tr>`).join('') || `<tr><td colspan="13" style="text-align:center;color:#94a3b8;padding:24px;">尚无日志</td></tr>`}</tbody>
            </table></div>
        </div>`;
    },
};

function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

registerPage('integration', (el) => Integration.render(el));
