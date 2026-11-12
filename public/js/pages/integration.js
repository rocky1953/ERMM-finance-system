/**
 * 第三方資料整合（Online / Batch）
 *  Tab1 📊 Excel 匯入：選表 → 上傳 xlsx → 欄位映射 → 預覽 → 寫入
 *  Tab2 🔌 SQL 線上整合：第三方資料源 → SELECT 預覽 → 映射 → 立即執行 / 存為批次作業
 *  Tab3 ⏰ 批次作業：作業清單 / 啟用停用 / 立即執行 / 編輯
 *  Tab4 🗄️ 資料源：第三方連線 CRUD + 連線測試
 *  Tab5 📜 執行日誌：篩選 / 匯出
 */
const Integration = {
    tab: 'excel',
    tables: [],
    colCache: {},
    keyCache: {},
    sources: [],
    jobs: [],
    logs: [],
    logFilter: { status: '', channel: '' },

    // Excel 嚮導狀態
    xl: { fileName: '', base64: '', parsed: null, sheetName: '', targetTable: '', cols: [], mapping: {}, keys: [], writeMode: 'INSERT' },
    // SQL 主控台狀態
    sq: { sourceId: '', sql: '', limit: 50, result: null, targetTable: '', cols: [], mapping: {}, keys: [], writeMode: 'INSERT', editJobId: null },

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
            ['excel', t('integration.tab.excel')],
            ['sql', t('integration.tab.sql')],
            ['batch', t('integration.tab.batch')],
            ['sources', t('integration.tab.sources')],
            ['logs', t('integration.tab.logs')],
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

    async getKeys(table) {
        if (!this.keyCache[table]) {
            this.keyCache[table] = (await API.get(`/api/integration/tables/${encodeURIComponent(table)}/keys`)).data;
        }
        return this.keyCache[table];
    },

    // 選表後載入欄位與唯一鍵；UPSERT 預設採用業務唯一鍵（排除自增 uid）
    async pickTable(kind, name) {
        const st = this[kind === 'xl' ? 'xl' : 'sq'];
        st.targetTable = name;
        st.cols = name ? await this.getCols(name) : [];
        st.keys = name ? defaultKeys(st.cols, await this.getKeys(name)) : [];
        if (kind === 'xl') {
            if (name) this.autoMap('xl');
            this.renderTab();
        } else {
            if (name && st.result) this.autoMap('sq');
            this.refreshSqLower();
        }
    },

    tableOptions(sel) {
        return [`<option value="">${t('integration.selectTargetTable')}</option>`]
            .concat(this.tables.map(tb => `<option value="${esc(tb.name)}" ${tb.name === sel ? 'selected' : ''}>${esc(tb.name)}${tb.comment ? '（' + esc(tb.comment) + '）' : ''}</option>`)).join('');
    },

    renderTab() {
        const body = document.getElementById('intgBody');
        if (this.tab === 'excel') body.innerHTML = this.viewExcel();
        else if (this.tab === 'sql') { body.innerHTML = this.viewSql(); this.loadSources(); }
        else if (this.tab === 'batch') { body.innerHTML = `<div style="padding:30px;color:#94a3b8;">${t('integration.loading')}</div>`; this.loadJobs(); }
        else if (this.tab === 'sources') { body.innerHTML = `<div style="padding:30px;color:#94a3b8;">${t('integration.loading')}</div>`; this.loadSources(true); }
        else if (this.tab === 'logs') { body.innerHTML = `<div style="padding:30px;color:#94a3b8;">${t('integration.loading')}</div>`; this.loadLogs(); }
    },

    // ================= Tab1：Excel 匯入 =================
    viewExcel() {
        const x = this.xl;
        const sheetOpts = x.parsed ? x.parsed.sheets.map(s =>
            `<option value="${esc(s.name)}" ${s.name === x.sheetName ? 'selected' : ''}>${esc(t('integration.excel.sheetOpt', { name: s.name, rows: s.total_rows }))}</option>`).join('') : '';
        return `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:18px;">
            <div style="display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;">
                <div><label style="font-size:12px;color:#64748b;">${t('integration.excel.step1')}</label>
                    <select id="xlTable" onchange="Integration.xlPickTable(this.value)" style="display:block;margin-top:4px;min-width:280px;padding:7px;border:1px solid #cbd5e1;border-radius:6px;">${this.tableOptions(x.targetTable)}</select>
                </div>
                <div style="display:flex;gap:8px;">
                    <button class="btn btn-outline" onclick="Integration.downloadTemplate()">${t('integration.excel.allTemplates')}</button>
                    <button class="btn btn-outline" onclick="Integration.downloadTemplate(Integration.xl.targetTable)" ${x.targetTable ? '' : 'disabled'}>${t('integration.excel.tableTemplate')}</button>
                </div>
                <div><label style="font-size:12px;color:#64748b;">${t('integration.excel.step2')}</label>
                    <input type="file" id="xlFile" accept=".xlsx" onchange="Integration.xlPickFile(this)" style="display:block;margin-top:4px;font-size:13px;">
                </div>
                <div id="xlSheetWrap" style="${x.parsed ? '' : 'display:none;'}"><label style="font-size:12px;color:#64748b;">${t('integration.excel.step3')}</label>
                    <select id="xlSheet" onchange="Integration.xlPickSheet(this.value)" style="display:block;margin-top:4px;padding:7px;border:1px solid #cbd5e1;border-radius:6px;min-width:200px;">${sheetOpts}</select>
                </div>
            </div>
            <div style="margin-top:6px;font-size:12px;color:#94a3b8;">${t('integration.excel.tip')}</div>
            <div id="xlMapping">${this.mappingPanel('xl')}</div>
        </div>`;
    },

    async xlPickTable(name) {
        await this.pickTable('xl', name);
    },

    async downloadTemplate(table) {
        try {
            await API.download(table
                ? `/api/integration/templates/${encodeURIComponent(table)}`
                : '/api/integration/templates');
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    xlPickFile(input) {
        const f = input.files[0];
        if (!f) return;
        if (f.size > 20 * 1024 * 1024) { UI.toast(t('integration.excel.fileTooLarge'), 'error'); return; }
        const reader = new FileReader();
        reader.onload = async () => {
            const b64 = reader.result.split(',')[1];
            this.xl.fileName = f.name;
            this.xl.base64 = b64;
            try {
                UI.toast(t('integration.excel.parsing'), 'info');
                const res = (await API.post('/api/integration/excel/parse', { file_base64: b64, file_name: f.name })).data;
                this.xl.parsed = res;
                this.xl.sheetName = res.sheets[0]?.name || '';
                this.autoMap('xl');
                this.renderTab();
                UI.toast(t('integration.excel.parseOk', { n: res.sheets.length }), 'success');
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

    // 同名欄自動映射（支援「中文 * en」等雙語表頭），映射方向 {來源欄: 目標欄}
    autoMap(kind) {
        const st = this[kind === 'xl' ? 'xl' : 'sq'];
        const srcHeaders = kind === 'xl' ? (this.currentSheet()?.headers || []) : (st.result?.columns || []);
        const mapping = {};
        for (const c of st.cols) {
            const hit = srcHeaders.find(h => headerToColumn(h).toLowerCase() === c.name.toLowerCase());
            if (hit) mapping[hit] = c.name;
        }
        st.mapping = mapping;
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
            const sel = Object.keys(st.mapping).find(k => st.mapping[k] === c.name) || '';
            const isKey = st.keys.includes(c.name);
            const req = isRequired(c);
            return `<tr>
                <td><b>${esc(c.name)}</b>${c.columnKey === 'PRI' ? ' <span class="tag" style="background:#fee2e2;color:#991b1b;">PK</span>' : c.columnKey === 'UNI' ? ' <span class="tag" style="background:#fef3c7;color:#92400e;">UK</span>' : ''}</td>
                <td style="color:#64748b;font-size:12px;">${esc(c.comment || '')}${req ? ' <b style="color:#dc2626;">*</b>' : ''}</td>
                <td style="color:#64748b;font-size:12px;">${esc(c.columnType)}${c.nullable === 'NO' ? ' NOT NULL' : ''}</td>
                <td>
                    <select onchange="Integration.setMap('${kind}','${esc(c.name)}',this.value)" style="padding:4px 8px;border:1px solid #cbd5e1;border-radius:5px;min-width:180px;">
                        <option value="">${t('integration.map.noImport')}</option>
                        ${srcHeaders.map(h => `<option value="${esc(h)}" ${h === sel ? 'selected' : ''}>${esc(h)}</option>`).join('')}
                    </select>
                </td>
                <td style="text-align:center;">
                    <input type="checkbox" ${isKey ? 'checked' : ''} onchange="Integration.toggleKey('${kind}','${esc(c.name)}',this.checked)">
                </td>
            </tr>`;
        }).join('');

        const miss = missingRequired(st);
        const missHtml = miss.length
            ? `<div style="margin-top:12px;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:6px;padding:8px 12px;font-size:12px;">
                   ${esc(t('integration.map.requiredMissing', { cols: miss.map(m => m.name).join('、') }))}
               </div>`
            : '';

        const previewHtml = previewRows.length ? `
            <div style="margin-top:14px;">
                <div style="font-weight:600;font-size:13px;margin-bottom:6px;">${t('integration.map.preview', { n: previewRows.length })}</div>
                <div style="max-height:220px;overflow:auto;border:1px solid #e2e8f0;border-radius:6px;">
                <table class="data-table" style="width:100%;font-size:12px;">
                    <thead style="position:sticky;top:0;"><tr>${srcHeaders.slice(0, 12).map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
                    <tbody>${previewRows.map(r => `<tr>${srcHeaders.slice(0, 12).map(h => `<td>${esc(r[h])}</td>`).join('')}</tr>`).join('')}</tbody>
                </table></div>
                ${srcHeaders.length > 12 ? `<div style="font-size:11px;color:#94a3b8;margin-top:4px;">${t('integration.map.previewLimit')}</div>` : ''}
            </div>` : '';

        return `
        <div style="margin-top:18px;border-top:2px dashed #e2e8f0;padding-top:16px;">
            <div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
                <label style="font-size:12px;color:#64748b;">${t('integration.map.writeMode')}
                    <select id="${kind}WriteMode" onchange="Integration.setMode('${kind}',this.value)" style="margin-left:6px;padding:6px;border:1px solid #cbd5e1;border-radius:6px;">
                        <option value="INSERT" ${st.writeMode === 'INSERT' ? 'selected' : ''}>${t('integration.map.modeInsert')}</option>
                        <option value="UPSERT" ${st.writeMode === 'UPSERT' ? 'selected' : ''}>${t('integration.map.modeUpsert')}</option>
                    </select>
                </label>
                <div style="font-size:12px;color:#94a3b8;">${t('integration.map.keyHint')}</div>
            </div>
            <div style="max-height:300px;overflow:auto;border:1px solid #e2e8f0;border-radius:8px;">
            <table class="data-table" style="width:100%;font-size:13px;">
                <thead style="position:sticky;top:0;"><tr><th>${t('integration.map.targetColumn')}</th><th>${t('integration.map.columnComment')}</th><th>${t('integration.map.columnType')}</th><th>${t('integration.map.sourceColumn')}</th><th style="text-align:center;">${t('integration.map.matchKey')}</th></tr></thead>
                <tbody>${rowsHtml}</tbody>
            </table></div>
            ${missHtml}
            ${previewHtml}
            <div style="margin-top:16px;text-align:right;">
                <button class="btn btn-primary" onclick="Integration.doImport()" ${kind === 'xl' ? '' : 'style="display:none;"'}>${t('integration.excel.startImport', { n: this.currentSheet()?.total_rows || 0 })}</button>
            </div>
        </div>`;
    },

    setMap(kind, tgt, src) {
        const st = this[kind === 'xl' ? 'xl' : 'sq'];
        for (const k of Object.keys(st.mapping)) {
            if (st.mapping[k] === tgt) delete st.mapping[k];
        }
        if (src) st.mapping[src] = tgt;
    },
    toggleKey(kind, col, checked) {
        const st = this[kind === 'xl' ? 'xl' : 'sq'];
        st.keys = st.keys.filter(k => k !== col);
        if (checked) st.keys.push(col);
    },
    setMode(kind, v) { this[kind === 'xl' ? 'xl' : 'sq'].writeMode = v; },

    async doImport() {
        const x = this.xl;
        if (!x.targetTable) return UI.toast(t('integration.msg.selectTargetFirst'), 'error');
        if (!x.sheetName) return UI.toast(t('integration.msg.selectSheetFirst'), 'error');
        if (!Object.keys(x.mapping).length) return UI.toast(t('integration.msg.mapAtLeastOne'), 'error');
        const miss = missingRequired(x);
        if (miss.length) return UI.toast(t('integration.msg.missingRequired', { cols: miss.map(m => m.name).join('、') }), 'error');
        if (x.writeMode === 'UPSERT' && !x.keys.length) return UI.toast(t('integration.msg.upsertKeyRequired'), 'error');
        if (!confirm(t('integration.msg.confirmImport', { file: x.fileName, sheet: x.sheetName, table: x.targetTable }))) return;
        try {
            UI.toast(t('integration.excel.importing'), 'info');
            const res = (await API.post('/api/integration/excel/import', {
                target_table: x.targetTable,
                file_base64: x.base64,
                file_name: x.fileName,
                sheet_name: x.sheetName,
                mapping: x.mapping,
                key_columns: x.keys,
                write_mode: x.writeMode,
            })).data;
            UI.modal(t('integration.excel.done'), `
                <div style="display:flex;gap:14px;flex-wrap:wrap;">
                    <div style="flex:1;min-width:120px;background:#f1f5f9;border-radius:8px;padding:14px;text-align:center;">
                        <div style="font-size:24px;font-weight:800;color:#1e3a5f;">${res.total_rows}</div><div style="font-size:12px;color:#64748b;">${t('integration.excel.resultTotal')}</div></div>
                    <div style="flex:1;min-width:120px;background:#dcfce7;border-radius:8px;padding:14px;text-align:center;">
                        <div style="font-size:24px;font-weight:800;color:#166534;">${res.insert_rows}</div><div style="font-size:12px;color:#64748b;">${t('integration.result.insert')}</div></div>
                    <div style="flex:1;min-width:120px;background:#dbeafe;border-radius:8px;padding:14px;text-align:center;">
                        <div style="font-size:24px;font-weight:800;color:#1e40af;">${res.update_rows}</div><div style="font-size:12px;color:#64748b;">${t('integration.result.update')}</div></div>
                    <div style="flex:1;min-width:120px;background:#fee2e2;border-radius:8px;padding:14px;text-align:center;">
                        <div style="font-size:24px;font-weight:800;color:#991b1b;">${res.error_rows}</div><div style="font-size:12px;color:#64748b;">${t('integration.result.fail')}</div></div>
                </div>
                ${(res.errors || []).length ? `<pre style="margin-top:12px;max-height:160px;overflow:auto;font-size:11px;">${esc(res.errors.join('\n'))}</pre>` : ''}
            `, `<button class="btn btn-outline" onclick="UI.closeModal()">${t('integration.btn.close')}</button>
                <button class="btn btn-success" onclick="UI.closeModal();Integration.switchTab('logs')">${t('integration.btn.viewLogs')}</button>`);
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ================= Tab2：SQL 線上整合 =================
    viewSql() {
        const s = this.sq;
        const srcOpts = [`<option value="">${t('integration.sql.selectSource')}</option>`]
            .concat(this.sources.map(x => `<option value="${x.id}" ${String(x.id) === String(s.sourceId) ? 'selected' : ''}>${esc(x.name)}（${esc(x.host)}/${esc(x.db_name)}）</option>`)).join('');
        return `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:18px;">
            <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
                <div style="flex:1;min-width:280px;"><label style="font-size:12px;color:#64748b;">${t('integration.sql.step1')}</label>
                    <select id="sqSource" onchange="Integration.sq.sourceId=this.value" style="display:block;margin-top:4px;width:100%;padding:7px;border:1px solid #cbd5e1;border-radius:6px;">${srcOpts}</select>
                </div>
                <div><label style="font-size:12px;color:#64748b;">${t('integration.sql.rowLimit')}</label>
                    <select id="sqLimit" onchange="Integration.sq.limit=Number(this.value)" style="display:block;margin-top:4px;padding:7px;border:1px solid #cbd5e1;border-radius:6px;">
                        ${[50, 100, 200, 500].map(n => `<option value="${n}" ${s.limit === n ? 'selected' : ''}>${n}</option>`).join('')}
                    </select>
                </div>
                <button class="btn btn-outline" onclick="Integration.openSourceForm()">${t('integration.sql.manageSources')}</button>
                <button class="btn btn-success" onclick="Integration.sqPreview()">${t('integration.sql.testRead', { n: s.limit })}</button>
            </div>
            <div style="margin-top:12px;"><label style="font-size:12px;color:#64748b;">${t('integration.sql.step2')}</label>
                <textarea id="sqSql" style="width:100%;margin-top:4px;height:110px;font-family:Consolas,monospace;font-size:13px;padding:10px;border:1px solid #cbd5e1;border-radius:6px;"
                    placeholder="SELECT so_nbr, client_id, client_name, xitems, so_date, so_qty, unit_price FROM erp.sales_order WHERE ...">${esc(s.sql)}</textarea>
            </div>
            <div style="margin-top:12px;display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
                <div><label style="font-size:12px;color:#64748b;">${t('integration.sql.step3')}</label>
                    <select id="sqTable" onchange="Integration.sqPickTable(this.value)" style="display:block;margin-top:4px;min-width:320px;padding:7px;border:1px solid #cbd5e1;border-radius:6px;">${this.tableOptions(s.targetTable)}</select>
                </div>
                <button class="btn btn-outline" onclick="Integration.copyColumns()">${t('integration.sql.copyColumns')}</button>
            </div>
            <div style="margin-top:6px;font-size:12px;color:#94a3b8;">${t('integration.sql.tip')}</div>
            <div id="sqMapping"></div>
            <div id="sqActions" style="margin-top:16px;text-align:right;display:none;gap:8px;justify-content:flex-end;">
                <button class="btn btn-outline" onclick="Integration.openSaveBatch()">${t('integration.sql.saveBatch')}</button>
                <button class="btn btn-primary" onclick="Integration.sqRun()">${t('integration.sql.runNow')}</button>
            </div>
        </div>`;
    },

    async sqPickTable(name) {
        await this.pickTable('sq', name);
    },

    copyColumns() {
        const s = this.sq;
        if (!s.targetTable || !s.cols.length) return UI.toast(t('integration.msg.selectTargetFirst'), 'error');
        const text = s.cols
            .map(c => `${c.name}\t${c.comment || ''}\t${c.columnType}${isRequired(c) ? '\t' + t('integration.map.required') : ''}`)
            .join('\n');
        navigator.clipboard.writeText(text)
            .then(() => UI.toast(t('integration.msg.copyOk', { n: s.cols.length }), 'success'))
            .catch(() => UI.toast(t('integration.msg.copyFail'), 'error'));
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
        s.limit = Number(document.getElementById('sqLimit')?.value) || 50;
        if (!s.sourceId || !s.sql.trim()) return UI.toast(t('integration.msg.selectSourceSql'), 'error');
        try {
            UI.toast(t('integration.msg.reading'), 'info');
            const res = (await API.post('/api/integration/sources/query', { source_id: s.sourceId, sql: s.sql, limit: s.limit })).data;
            if (!res.row_count) { UI.toast(t('integration.msg.noData'), 'info'); s.result = res; this.refreshSqLower(); return; }
            s.result = res;
            if (s.cols.length) this.autoMap('sq');
            this.refreshSqLower();
            UI.toast(t('integration.msg.readOk', { n: res.row_count }), 'success');
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async sqRun() {
        const s = this.sq;
        if (!s.targetTable || !Object.keys(s.mapping).length) return UI.toast(t('integration.msg.mappingRequired'), 'error');
        const srcCols = new Set(s.result?.columns || []);
        const missingSrc = Object.keys(s.mapping).filter(k => !srcCols.has(k));
        if (missingSrc.length) return UI.toast(t('integration.msg.sourceMissing', { cols: missingSrc.join('、') }), 'error');
        const miss = missingRequired(s);
        if (miss.length) return UI.toast(t('integration.msg.missingRequired', { cols: miss.map(m => m.name).join('、') }), 'error');
        if (s.writeMode === 'UPSERT' && !s.keys.length) return UI.toast(t('integration.msg.upsertKeyRequired'), 'error');
        // 先存草稿作業（Online 也留作業設定，id 用於復用），再立即執行
        if (!confirm(t('integration.msg.confirmRun'))) return;
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
            UI.toast(t('integration.msg.running'), 'info');
            const res = (await API.post(`/api/integration/jobs/${jobId}/run`)).data;
            this.showRunResult(res);
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    showRunResult(res) {
        UI.modal(t('integration.run.done'), `
            <div style="display:flex;gap:14px;flex-wrap:wrap;">
                <div style="flex:1;min-width:120px;background:#f1f5f9;border-radius:8px;padding:14px;text-align:center;">
                    <div style="font-size:24px;font-weight:800;color:#1e3a5f;">${res.total_rows}</div><div style="font-size:12px;color:#64748b;">${t('integration.result.read')}</div></div>
                <div style="flex:1;min-width:120px;background:#dcfce7;border-radius:8px;padding:14px;text-align:center;">
                    <div style="font-size:24px;font-weight:800;color:#166534;">${res.insert_rows}</div><div style="font-size:12px;color:#64748b;">${t('integration.result.insert')}</div></div>
                <div style="flex:1;min-width:120px;background:#dbeafe;border-radius:8px;padding:14px;text-align:center;">
                    <div style="font-size:24px;font-weight:800;color:#1e40af;">${res.update_rows}</div><div style="font-size:12px;color:#64748b;">${t('integration.result.update')}</div></div>
                <div style="flex:1;min-width:120px;background:#fee2e2;border-radius:8px;padding:14px;text-align:center;">
                    <div style="font-size:24px;font-weight:800;color:#991b1b;">${res.error_rows}</div><div style="font-size:12px;color:#64748b;">${t('integration.result.fail')}</div></div>
            </div>
            ${(res.errors || []).length ? `<pre style="margin-top:12px;max-height:160px;overflow:auto;font-size:11px;">${esc(res.errors.join('\n'))}</pre>` : ''}
        `, `<button class="btn btn-outline" onclick="UI.closeModal()">${t('integration.btn.close')}</button>
            <button class="btn btn-success" onclick="UI.closeModal();Integration.switchTab('logs')">${t('integration.btn.viewLogs')}</button>`);
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
                <div style="font-weight:700;">${t('integration.batch.title')}</div>
                <div><button class="btn btn-outline" onclick="Integration.loadJobs()">${t('integration.btn.refresh')}</button></div>
            </div>
            <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;font-size:13px;">
                <thead><tr><th>ID</th><th>${t('integration.batch.jobName')}</th><th>${t('integration.batch.channel')}</th><th>${t('integration.batch.source')}</th><th>${t('integration.batch.targetTable')}</th><th>${t('integration.batch.mode')}</th><th>${t('integration.batch.schedule')}</th><th>${t('integration.batch.enabled')}</th><th>${t('integration.batch.lastRun')}</th><th>${t('integration.batch.lastStatus')}</th><th>${t('integration.batch.action')}</th></tr></thead>
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
                        ${j.channel === 'SQL' ? `<button class="btn btn-sm" style="padding:3px 9px;" onclick="Integration.jobRun(${j.id})">${t('integration.btn.run')}</button>` : ''}
                        ${j.channel === 'SQL' && j.last_status === 'FAIL' ? `<button class="btn btn-sm" style="padding:3px 9px;color:#b45309;" onclick="Integration.jobRun(${j.id})">${t('integration.btn.retry')}</button>` : ''}
                        ${j.channel === 'SQL' ? `<button class="btn btn-sm" style="padding:3px 9px;" onclick="Integration.jobEdit(${j.id})">${t('integration.btn.edit')}</button>` : ''}
                        <button class="btn btn-sm" style="padding:3px 9px;" onclick="Integration.jobToggle(${j.id},${j.enabled ? 0 : 1})">${j.enabled ? t('integration.btn.disable') : t('integration.btn.enable')}</button>
                        <button class="btn btn-sm" style="padding:3px 9px;color:#e74c3c;" onclick="Integration.jobDel(${j.id})">${t('delete')}</button>
                    </td>
                </tr>`).join('') || `<tr><td colspan="11" style="text-align:center;color:#94a3b8;padding:24px;">${t('integration.batch.empty')}</td></tr>`}</tbody>
            </table></div>
        </div>`;
    },

    async jobRun(id) {
        if (!confirm(t('integration.msg.confirmRunJob'))) return;
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
            sourceId: String(j.source_id || ''), sql: j.source_sql || '', limit: 50, result: null,
            targetTable: j.target_table, cols: [],
            mapping: {}, keys: (j.key_columns || '').split(',').filter(Boolean),
            writeMode: j.write_mode || 'INSERT', editJobId: j.id, editJobName: j.name,
            editMode: j.mode, editSchedule: j.schedule, editEnabled: j.enabled,
        };
        document.getElementById('sqSource').value = this.sq.sourceId;
        document.getElementById('sqSql').value = this.sq.sql;
        document.getElementById('sqTable').value = this.sq.targetTable;
        this.sq.cols = await this.getCols(j.target_table);
        const rawMapping = typeof j.column_mapping === 'string'
            ? (j.column_mapping ? JSON.parse(j.column_mapping) : {}) : (j.column_mapping || {});
        this.sq.mapping = normalizeMappingFE(rawMapping, this.sq.cols);
        // 無預覽結果時，用映射中已有的來源欄產生一個欄位集合，供面板顯示下拉
        const srcCols = [...new Set(Object.keys(this.sq.mapping))];
        this.sq.result = { columns: srcCols, rows: [], row_count: 0 };
        this.refreshSqLower();
        UI.toast(t('integration.msg.jobLoaded', { id }), 'info');
    },

    async jobToggle(id, enabled) {
        const j = this.jobs.find(x => x.id === id);
        try {
            await API.put(`/api/integration/jobs/${id}`, { ...j, column_mapping: j.column_mapping, key_columns: (j.key_columns || '').split(',').filter(Boolean), enabled: !!enabled });
            UI.toast(enabled ? t('integration.msg.enabled') : t('integration.msg.disabled'), 'success');
            this.loadJobs();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async jobDel(id) {
        if (!confirm(t('integration.msg.confirmDeleteJob'))) return;
        try {
            await API.del(`/api/integration/jobs/${id}`);
            UI.toast(t('integration.msg.deleted'), 'success');
            this.loadJobs();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    openSaveBatch() {
        const s = this.sq;
        if (!s.sourceId || !s.targetTable) return UI.toast(t('integration.msg.sourceTargetRequired'), 'error');
        UI.modal(t('integration.batch.saveTitle'), `
            <div style="display:flex;flex-direction:column;gap:12px;">
                <div><label style="font-size:12px;color:#64748b;">${t('integration.batch.jobName')}</label>
                    <input id="batchName" class="input" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;" value="${esc(s.editJobName || ('Batch_' + s.targetTable))}"></div>
                <div><label style="font-size:12px;color:#64748b;">${t('integration.batch.scheduleLabel')}</label>
                    <input id="batchSchedule" class="input" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;" placeholder="daily 02:30 / every 30m" value="${esc(s.editSchedule || 'daily 02:30')}"></div>
                <div style="font-size:12px;color:#94a3b8;">${t('integration.batch.scheduleHint')}</div>
            </div>`,
            `<button class="btn btn-outline" onclick="UI.closeModal()">${t('integration.btn.cancel')}</button>
             <button class="btn btn-primary" onclick="Integration.saveBatch()">${t('integration.btn.save')}</button>`);
    },

    async saveBatch() {
        const s = this.sq;
        const name = document.getElementById('batchName').value.trim();
        const schedule = document.getElementById('batchSchedule').value.trim();
        if (!name || !schedule) return UI.toast(t('integration.msg.nameScheduleRequired'), 'error');
        if (!/^(daily\s+\d{1,2}:\d{2}|every\s+\d+m)$/i.test(schedule)) return UI.toast(t('integration.msg.scheduleInvalid'), 'error');
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
            UI.toast(t('integration.msg.batchSaved'), 'success');
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ================= Tab4：資料源 =================
    async loadSources(render = false) {
        this.sources = (await API.get('/api/integration/sources')).data;
        if (this.tab === 'sql') {
            const sel = document.getElementById('sqSource');
            if (sel) sel.innerHTML = [`<option value="">${t('integration.sql.selectSource')}</option>`]
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
                <div style="font-weight:700;">${t('integration.src.title')}</div>
                <div><button class="btn btn-primary" onclick="Integration.openSourceForm()">${t('integration.src.add')}</button>
                     <button class="btn btn-outline" onclick="Integration.loadSources(true)">${t('integration.btn.refresh')}</button></div>
            </div>
            <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;font-size:13px;">
                <thead><tr><th>ID</th><th>${t('integration.src.colName')}</th><th>${t('integration.src.colType')}</th><th>${t('integration.src.colHost')}</th><th>Port</th><th>${t('integration.src.colDb')}</th><th>${t('integration.src.colUser')}</th><th>${t('integration.src.colPwd')}</th><th>${t('integration.src.colEnabled')}</th><th>${t('integration.src.colRemark')}</th><th>${t('integration.src.colAction')}</th></tr></thead>
                <tbody>${this.sources.map(s => `<tr>
                    <td>${s.id}</td><td><b>${esc(s.name)}</b></td><td>${esc(s.db_type)}</td>
                    <td>${esc(s.host)}</td><td>${s.port}</td><td>${esc(s.db_name)}</td><td>${esc(s.db_user)}</td>
                    <td>${s.has_password ? '●●●●' : '—'}</td>
                    <td>${s.enabled ? '✅' : '⛔'}</td><td style="font-size:12px;color:#64748b;">${esc(s.remark || '')}</td>
                    <td style="white-space:nowrap;">
                        <button class="btn btn-sm" style="padding:3px 9px;" onclick="Integration.sourceTest(${s.id})">${t('integration.src.test')}</button>
                        <button class="btn btn-sm" style="padding:3px 9px;" onclick='Integration.openSourceForm(${s.id})'>✏️</button>
                        <button class="btn btn-sm" style="padding:3px 9px;color:#e74c3c;" onclick="Integration.sourceDel(${s.id})">${t('delete')}</button>
                    </td></tr>`).join('') || `<tr><td colspan="11" style="text-align:center;color:#94a3b8;padding:24px;">${t('integration.src.empty')}</td></tr>`}</tbody>
            </table></div>
        </div>`;
    },

    openSourceForm(id) {
        const s = id ? this.sources.find(x => x.id === id) : null;
        UI.modal(s ? t('integration.src.editTitle') : t('integration.src.newTitle'), `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div><label style="font-size:12px;color:#64748b;">${t('integration.src.name')}</label>
                    <input id="srcName" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;" value="${esc(s?.name || '')}"></div>
                <div><label style="font-size:12px;color:#64748b;">${t('integration.src.dbType')}</label>
                    <select id="srcType" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;"><option value="mysql">MySQL</option></select></div>
                <div><label style="font-size:12px;color:#64748b;">${t('integration.src.host')}</label>
                    <input id="srcHost" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;" value="${esc(s?.host || '')}" placeholder="192.168.1.100"></div>
                <div><label style="font-size:12px;color:#64748b;">${t('integration.src.port')}</label>
                    <input id="srcPort" type="number" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;" value="${s?.port || 3306}"></div>
                <div><label style="font-size:12px;color:#64748b;">${t('integration.src.dbName')}</label>
                    <input id="srcDb" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;" value="${esc(s?.db_name || '')}"></div>
                <div><label style="font-size:12px;color:#64748b;">${t('integration.src.charset')}</label>
                    <input id="srcCharset" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;" value="${esc(s?.charset || 'utf8mb4')}"></div>
                <div><label style="font-size:12px;color:#64748b;">${t('integration.src.user')}</label>
                    <input id="srcUser" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;" value="${esc(s?.db_user || '')}"></div>
                <div><label style="font-size:12px;color:#64748b;">${s ? t('integration.src.passwordKeep') : t('integration.src.password')}</label>
                    <input id="srcPwd" type="password" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;" value=""></div>
                <div style="grid-column:1/3;"><label style="font-size:12px;color:#64748b;">${t('integration.src.remark')}</label>
                    <input id="srcRemark" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;" value="${esc(s?.remark || '')}"></div>
            </div>`,
            `<button class="btn btn-outline" onclick="UI.closeModal()">${t('integration.btn.cancel')}</button>
             <button class="btn btn-warning" onclick="Integration.sourceTestForm()">${t('integration.src.testConn')}</button>
             <button class="btn btn-primary" onclick="Integration.sourceSave(${id || 0})">${t('integration.btn.save')}</button>`);
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
            UI.toast(t('integration.msg.connOk', { v: r.version }), 'success');
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async sourceTest(id) {
        try {
            const r = (await API.post(`/api/integration/sources/${id}/test`)).data;
            UI.toast(t('integration.msg.connOk', { v: r.version }), 'success');
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async sourceSave(id) {
        const b = this.readSourceForm();
        if (!b.name || !b.host || !b.db_name || !b.db_user) return UI.toast(t('integration.msg.srcRequired'), 'error');
        try {
            if (id) await API.put(`/api/integration/sources/${id}`, b);
            else await API.post('/api/integration/sources', b);
            UI.closeModal();
            UI.toast(t('integration.msg.saved'), 'success');
            this.loadSources(true);
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async sourceDel(id) {
        if (!confirm(t('integration.msg.confirmDeleteSource'))) return;
        try {
            await API.del(`/api/integration/sources/${id}`);
            UI.toast(t('integration.msg.deleted'), 'success');
            this.loadSources(true);
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ================= Tab5：日誌 =================
    async loadLogs() {
        const q = new URLSearchParams({ limit: '100' });
        if (this.logFilter.status) q.set('status', this.logFilter.status);
        if (this.logFilter.channel) q.set('channel', this.logFilter.channel);
        this.logs = (await API.get('/api/integration/logs?' + q.toString())).data;
        this.renderLogs();
    },
    setLogFilter(key, value) {
        this.logFilter[key] = value;
        this.loadLogs();
    },
    exportLogs() {
        if (!this.logs.length) return UI.toast(t('integration.msg.noData'), 'info');
        const cols = [
            ['ID', l => l.id],
            [t('integration.logs.time'), l => l.started_at ? String(l.started_at).slice(0, 19) : ''],
            [t('integration.logs.job'), l => l.job_name],
            [t('integration.logs.channel'), l => l.channel],
            [t('integration.logs.trigger'), l => l.run_type],
            [t('integration.batch.targetTable'), l => l.target_table],
            [t('integration.logs.total'), l => l.total_rows],
            [t('integration.logs.insert'), l => l.insert_rows],
            [t('integration.logs.update'), l => l.update_rows],
            [t('integration.logs.fail'), l => l.error_rows],
            [t('integration.logs.duration'), l => l.duration_ms],
            [t('integration.logs.status'), l => l.status],
            [t('integration.logs.errorFile'), l => l.error_msg || l.file_name || ''],
        ];
        const lines = [cols.map(c => csvCell(c[0])).join(',')]
            .concat(this.logs.map(l => cols.map(c => csvCell(c[1](l))).join(',')));
        const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `integration_logs_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    },
    renderLogs() {
        const body = document.getElementById('intgBody');
        const c = { SUCCESS: '#27ae60', FAIL: '#e74c3c', RUNNING: '#3498db' };
        const ch = { SQL: '🔌 SQL', EXCEL: '📊 Excel' };
        const statusOpts = ['', 'SUCCESS', 'FAIL', 'RUNNING'].map(v =>
            `<option value="${v}" ${this.logFilter.status === v ? 'selected' : ''}>${v ? v : t('integration.logs.all')}</option>`).join('');
        const channelOpts = ['', 'SQL', 'EXCEL'].map(v =>
            `<option value="${v}" ${this.logFilter.channel === v ? 'selected' : ''}>${v ? v : t('integration.logs.all')}</option>`).join('');
        body.innerHTML = `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
                <div style="font-weight:700;">${t('integration.logs.title', { n: 100 })}</div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <select onchange="Integration.setLogFilter('status', this.value)" style="padding:6px;border:1px solid #cbd5e1;border-radius:6px;" title="${t('integration.logs.filterStatus')}">${statusOpts}</select>
                    <select onchange="Integration.setLogFilter('channel', this.value)" style="padding:6px;border:1px solid #cbd5e1;border-radius:6px;" title="${t('integration.logs.filterChannel')}">${channelOpts}</select>
                    <button class="btn btn-outline" onclick="Integration.exportLogs()">${t('integration.logs.export')}</button>
                    <button class="btn btn-outline" onclick="Integration.loadLogs()">${t('integration.btn.refresh')}</button>
                </div>
            </div>
            <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;font-size:12px;">
                <thead><tr><th>ID</th><th>${t('integration.logs.time')}</th><th>${t('integration.logs.job')}</th><th>${t('integration.logs.channel')}</th><th>${t('integration.logs.trigger')}</th><th>${t('integration.batch.targetTable')}</th><th>${t('integration.logs.total')}</th><th>${t('integration.logs.insert')}</th><th>${t('integration.logs.update')}</th><th>${t('integration.logs.fail')}</th><th>${t('integration.logs.duration')}</th><th>${t('integration.logs.status')}</th><th>${t('integration.logs.errorFile')}</th></tr></thead>
                <tbody>${this.logs.map(l => `<tr>
                    <td>${l.id}</td>
                    <td style="white-space:nowrap;">${esc(String(l.started_at).slice(0, 19))}</td>
                    <td>${esc(l.job_name)}</td>
                    <td>${ch[l.channel] || l.channel}</td>
                    <td>${l.run_type === 'SCHEDULED' ? t('integration.logs.runScheduled') : l.run_type === 'MANUAL' ? t('integration.logs.runManual') : t('integration.logs.runExcel')}</td>
                    <td><code>${esc(l.target_table)}</code></td>
                    <td>${l.total_rows}</td><td style="color:#166534;">${l.insert_rows}</td>
                    <td style="color:#1e40af;">${l.update_rows}</td>
                    <td style="color:${l.error_rows ? '#991b1b' : '#64748b'};font-weight:${l.error_rows ? 700 : 400};">${l.error_rows}</td>
                    <td>${l.duration_ms != null ? (l.duration_ms / 1000).toFixed(1) + 's' : '—'}</td>
                    <td><span style="background:${c[l.status] || '#999'};color:#fff;padding:2px 9px;border-radius:10px;font-size:11px;">${l.status}</span></td>
                    <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:${l.error_msg ? '#991b1b' : '#94a3b8'};" title="${esc(l.error_msg || '')}">${esc(l.error_msg || l.file_name || '')}</td>
                </tr>`).join('') || `<tr><td colspan="13" style="text-align:center;color:#94a3b8;padding:24px;">${t('integration.logs.empty')}</td></tr>`}</tbody>
            </table></div>
        </div>`;
    },
};

// 「中文 * en」「中文(en)」「en」→ en
function headerToColumn(h) {
    const s = String(h === null || h === undefined ? '' : h).trim();
    if (!s) return '';
    let m = s.match(/[（(]\s*([A-Za-z_][A-Za-z0-9_]*)\s*[)）]\s*$/);
    if (m) return m[1];
    m = s.match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/);
    return m ? m[1] : s;
}

// 必填：NOT NULL、非自增、無預設值
function isRequired(c) {
    return c.nullable === 'NO'
        && !String(c.extra || '').includes('auto_increment')
        && (c.dflt === null || c.dflt === undefined);
}

function missingRequired(st) {
    if (!st.cols.length) return [];
    const mapped = new Set(Object.values(st.mapping || {}));
    return st.cols.filter(c => isRequired(c) && !mapped.has(c.name));
}

// UPSERT 預設匹配鍵：優先非自增的唯一索引（複合鍵整組），否則用非自增主鍵
function defaultKeys(cols, uniqueKeys) {
    const auto = new Set(cols.filter(c => String(c.extra || '').includes('auto_increment')).map(c => c.name));
    const usable = (uniqueKeys || [])
        .map(k => k.columns || [])
        .filter(k => k.length && !k.includes('uid') && !k.every(n => auto.has(n)));
    if (usable.length) return usable[0];
    return cols.filter(c => c.columnKey === 'PRI' && !auto.has(c.name)).map(c => c.name);
}

// 前端映射方向統一 {來源欄: 目標欄}，兼容舊作業 {目標欄: 來源欄}
function normalizeMappingFE(mapping, cols) {
    const entries = Object.entries(mapping || {});
    if (!entries.length) return {};
    const targets = new Set((cols || []).map(c => c.name.toLowerCase()));
    const keysAreTargets = entries.every(([k]) => targets.has(String(k).toLowerCase()));
    const valsAreTargets = entries.every(([, v]) => targets.has(String(v).toLowerCase()));
    if (keysAreTargets && !valsAreTargets) {
        const out = {};
        for (const [k, v] of entries) out[String(v)] = k;
        return out;
    }
    return { ...mapping };
}

function csvCell(v) {
    const s = v === null || v === undefined ? '' : String(v);
    return '"' + s.replace(/"/g, '""') + '"';
}

function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

registerPage('integration', (el) => Integration.render(el));
