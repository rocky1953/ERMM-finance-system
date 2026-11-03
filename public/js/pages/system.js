/**
 * 系统设定页面（码表 CRUD + KPI）
 */
registerPage('system', async (c) => {
    const _mgr = Auth.isManager();
    c.innerHTML = `
        <div class="card">
            <div class="card-title">🔧 ${t('sys.codes')}</div>
            <div class="toolbar">
                ${_mgr ? `<button class="btn btn-primary" onclick="CodeForm.open()">➕ ${t('sys.add_code')}</button>` : ''}
                <button class="btn btn-success" onclick="loadCodes()">🔄 ${t('refresh')}</button>
                <div class="spacer"></div>
                <select id="codeType" onchange="loadCodes()" style="padding:6px;border:1px solid #ddd;border-radius:6px;">
                    <option value="">${t('sys.all')}</option>
                    <option value="CURRENCY">${t('sys.currency')}</option>
                    <option value="BUSINESS_ID">${t('sys.business')}</option>
                    <option value="AGEING_STOCK">${t('sys.ageing')}</option>
                    <option value="BATCH_CONTROL">${t('sys.batch_ctrl')}</option>
                </select>
            </div>
            <div id="codeTable">${t('loading')}</div>
        </div>
        <div class="card">
            <div class="card-title">🎯 ${t('sys.kpi')}</div>
            <div class="toolbar">
                ${_mgr ? `<button class="btn btn-warning" onclick="kpiLight()">🔔 ${t('sys.kpi_light')}</button>
                <button class="btn btn-primary" onclick="KpiForm.open()">➕ ${t('kpi.add')}</button>` : ''}
                <button class="btn btn-success" onclick="loadSysKPI()">🔄 ${t('refresh')}</button>
            </div>
            <div id="kpiTable" style="margin-top:15px">${t('loading')}</div>
        </div>

        <div class="card">
            <div class="card-title">🤖 ${t('sys.llm_title') || 'API Key 管理'}</div>
            <div class="toolbar">
                ${_mgr ? `<button class="btn btn-primary" onclick="LLMForm.open()">➕ ${t('sys.llm_add') || '新增服務商'}</button>
                <button class="btn btn-danger" onclick="LLMForm.syncEnv()">🔄 ${t('sys.llm_sync_env') || '從 .env 匯入'}</button>` : ''}
                <button class="btn btn-success" onclick="loadLLMProviders()">🔄 ${t('refresh')}</button>
            </div>
            <div id="llmTable" style="margin-top:15px">${t('loading')}</div>
            <div id="llmHint" style="margin-top:12px;padding:10px 14px;background:#f8f9fa;border-left:4px solid #3498db;border-radius:4px;font-size:12px;color:#7f8c8d;">
                💡 ${t('sys.llm_hint') || '提示：設定「預設」後，AI 問答、智能診斷、戰情看板等所有 LLM 功能都會自動使用該服務商。'}
            </div>
        </div>
    `;
    loadCodes();
    loadSysKPI();
    loadLLMProviders();
});

// ============ LLM API Key 管理 ============
async function loadLLMProviders() {
    const _mgr = Auth.isManager();
    const el = document.getElementById('llmTable');
    try {
        const res = await API.get('/api/llm/providers');
        const { list, templates } = res.data;
        window._llmTemplates = templates;

        if (list.length === 0) {
            el.innerHTML = `<p style="color:#95a5a6;text-align:center;padding:40px;">🤖 ${t('sys.no_llm') || '尚未設定任何 LLM 服務商，請點右上方「新增服務商」按鈕'}</p>`;
            return;
        }
        el.innerHTML = `<table class="data-table" style="width:100%;border-collapse:collapse;">
            <thead><tr style="background:#f8f9fa;">
                <th style="padding:10px;text-align:left;">${t('sys.llm_name') || '服務商'}</th>
                <th style="padding:10px;text-align:left;">Provider ID</th>
                <th style="padding:10px;text-align:left;">API Key</th>
                <th style="padding:10px;text-align:left;">Model</th>
                <th style="padding:10px;text-align:left;">Base URL</th>
                <th style="padding:10px;text-align:center;">${t('sys.llm_default') || '預設'}</th>
                <th style="padding:10px;text-align:center;">${t('sys.llm_status') || '狀態'}</th>
                <th style="padding:10px;text-align:center;">${t('actions') || '操作'}</th>
            </tr></thead><tbody>
            ${list.map(p => `
                <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:10px;font-weight:500;">${p.provider_name}</td>
                    <td style="padding:10px;"><code style="font-size:12px;">${p.provider}</code></td>
                    <td style="padding:10px;font-family:monospace;font-size:12px;${p.configured?'color:#27ae60;':'color:#e74c3c;'}">${p.configured ? p.api_key_masked : '— ' + (t('sys.llm_not_set') || '未設定')}</td>
                    <td style="padding:10px;font-size:12px;">${p.model || '—'}</td>
                    <td style="padding:10px;font-size:11px;color:#7f8c8d;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.base_url || '—'}</td>
                    <td style="padding:10px;text-align:center;">
                        ${p.is_default
                            ? '<span style="background:#27ae60;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;">★ 預設</span>'
                            : `<button class="btn" style="padding:2px 10px;font-size:11px;" onclick="LLMForm.setDefault('${p.provider}')">${t('sys.llm_make_default') || '設為預設'}</button>`}
                    </td>
                    <td style="padding:10px;text-align:center;">
                        ${p.status === 'USE'
                            ? '<span style="color:#27ae60;">● USE</span>'
                            : '<span style="color:#bdc3c7;">○ NOUSE</span>'}
                    </td>
                    <td style="padding:10px;text-align:center;white-space:nowrap;">
                        <button class="btn" style="padding:2px 8px;font-size:11px;" onclick="LLMForm.test('${p.provider}')">🧪 ${t('sys.llm_test') || '測試'}</button>
                        <button class="btn" style="padding:2px 8px;font-size:11px;" onclick="LLMForm.open('${p.provider}')">✏️ ${t('edit') || '編輯'}</button>
                        ${_mgr && !p.is_default ? `<button class="btn btn-danger" style="padding:2px 8px;font-size:11px;" onclick="LLMForm.remove('${p.provider}')">🗑️ ${t('del') || '刪除'}</button>` : ''}
                    </td>
                </tr>
            `).join('')}
            </tbody></table>`;
    } catch (err) {
        el.innerHTML = `<div class="alert alert-danger">${t('error') || '錯誤'}: ${err.message}</div>`;
    }
}

window.LLMForm = {
    // ===== 前端校驗規則（與後端對齊）=====
    _validateField(field, value) {
        const v = String(value == null ? '' : value).trim();
        switch (field) {
            case 'provider': {
                if (!v) return t('sys.llm_pid_required') || '請選擇或輸入 Provider ID';
                if (v.length < 2) return 'Provider ID 至少 2 個字元';
                if (v.length > 32) return 'Provider ID 最多 32 個字元';
                if (!/^[a-zA-Z][a-zA-Z0-9_-]+$/.test(v)) return 'Provider ID 只能是字母、數字、底線、連字號，且以字母開頭';
                return null;
            }
            case 'name': {
                if (!v) return t('sys.llm_name_required') || '請輸入顯示名稱';
                if (v.length > 64) return '顯示名稱最多 64 個字元';
                return null;
            }
            case 'base_url': {
                if (!v) return 'Base URL 不可為空';
                if (!/^https?:\/\//i.test(v)) return 'Base URL 必須以 http:// 或 https:// 開頭';
                try { new URL(v); } catch { return 'Base URL 不是合法的網址'; }
                return null;
            }
            case 'model': {
                if (v.length > 64) return 'Model 名稱過長（上限 64）';
                if (/[<>]/.test(v)) return 'Model 名稱不可含 < 或 >';
                return null;
            }
            case 'api_key': {
                if (!v) return null;  // 空 Key 可接受
                if (v.length < 8) return 'API Key 至少 8 個字元';
                if (v.length > 512) return 'API Key 過長（上限 512）';
                if (/[^\x20-\x7E]/.test(v)) return 'API Key 不可含中文、全形符號或控制字元';
                if (!/[A-Za-z]/.test(v)) return 'API Key 至少含一個字母';
                return null;
            }
        }
        return null;
    },

    // 內聯顯示錯誤
    _showError(elId, msg) {
        const input = document.getElementById(elId);
        if (!input) return;
        input.style.borderColor = msg ? '#e74c3c' : '#ddd';
        let hint = input.parentElement.querySelector('.llm-field-error');
        if (msg) {
            if (!hint) {
                hint = document.createElement('div');
                hint.className = 'llm-field-error';
                hint.style.cssText = 'color:#e74c3c;font-size:11px;margin-top:2px;';
                input.parentElement.appendChild(hint);
            }
            hint.textContent = '⚠ ' + msg;
        } else if (hint) {
            hint.remove();
        }
        return !msg;  // 回傳 isOk
    },

    // 打開彈窗
    open(provider) {
        const templates = window._llmTemplates || {};
        const isEdit = !!provider;
        const tplOpts = Object.entries(templates).map(([k, v]) =>
            `<option value="${k}" ${provider===k?'selected':''}>${k} — ${v.provider_name || k}</option>`
        ).join('');

        UI.modal.show({
            title: isEdit ? (t('sys.llm_edit') || '編輯 LLM 服務商') : (t('sys.llm_add') || '新增 LLM 服務商'),
            body: `
                <div style="display:flex;flex-direction:column;gap:10px;">
                    <div>
                        <label style="font-weight:500;">Provider ID <span style="color:#e74c3c;">*</span></label>
                        ${isEdit
                            ? `<input id="llm_f_provider" value="${provider}" disabled style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;background:#f5f5f5;">`
                            : `<select id="llm_f_provider" onchange="LLMForm._applyTpl(this.value)" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;">
                                <option value="">${t('sys.llm_custom') || '— 自訂 ID —'}</option>
                                ${tplOpts}
                              </select>`}
                        ${!isEdit ? `<input id="llm_f_provider_custom" placeholder="${t('sys.llm_custom_ph') || '或輸入自訂 provider id（如 my-llm）'}" style="width:100%;padding:6px;margin-top:4px;border:1px dashed #bbb;border-radius:4px;font-size:12px;">` : ''}
                    </div>
                    <div>
                        <label style="font-weight:500;">${t('sys.llm_name') || '顯示名稱'} <span style="color:#e74c3c;">*</span></label>
                        <input id="llm_f_name" placeholder="例如：豆包 (Volcengine)" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;">
                    </div>
                    <div>
                        <label style="font-weight:500;">API Key</label>
                        <input id="llm_f_key" type="password" placeholder="${t('sys.llm_key_ph') || '輸入後自動脫敏顯示'}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;">
                        <div style="font-size:11px;color:#999;margin-top:2px;">${t('sys.llm_key_blank') || '留空=不變更；編輯模式下顯示為脫敏值'}</div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        <div>
                            <label style="font-weight:500;">Model</label>
                            <input id="llm_f_model" placeholder="gpt-4o-mini / kimi-k2.6 / ..." style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;">
                        </div>
                        <div>
                            <label style="font-weight:500;">${t('sys.llm_base') || 'Base URL'}</label>
                            <input id="llm_f_base" placeholder="https://api.openai.com/v1" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;">
                        </div>
                    </div>
                </div>
            `,
            buttons: [
                { label: t('cancel') || '取消', cls: 'btn', action: () => UI.modal.hide() },
                { label: t('save') || '儲存', cls: 'btn btn-primary', id: 'llm_save_btn', action: () => LLMForm._save(provider) },
            ]
        });

        // 即時校驗綁定（blur + input）
        setTimeout(() => {
            const bindValidate = (elId, field) => {
                const el = document.getElementById(elId);
                if (!el) return;
                const run = () => {
                    const isOk = LLMForm._showError(elId, LLMForm._validateField(field, el.value));
                    LLMForm._updateSaveBtn();
                    return isOk;
                };
                el.addEventListener('blur', run);
                el.addEventListener('input', run);
            };
            if (!isEdit) bindValidate('llm_f_provider_custom', 'provider');
            bindValidate('llm_f_name', 'name');
            bindValidate('llm_f_key', 'api_key');
            bindValidate('llm_f_model', 'model');
            bindValidate('llm_f_base', 'base_url');

            // 下拉選擇 provider 時也觸發 provider 校驗
            const sel = document.getElementById('llm_f_provider');
            if (sel) {
                sel.addEventListener('change', () => LLMForm._updateSaveBtn());
            }
        }, 50);

        // 編輯模式：載入既有資料
        if (isEdit) {
            API.get('/api/llm/providers').then(res => {
                const p = res.data.list.find(x => x.provider === provider);
                if (p) {
                    document.getElementById('llm_f_name').value = p.provider_name;
                    document.getElementById('llm_f_model').value = p.model || '';
                    document.getElementById('llm_f_base').value = p.base_url || '';
                    setTimeout(() => LLMForm._updateSaveBtn(), 0);
                }
            });
        }
    },

    // 保存按鈕：全部必填字段通過才 enable
    _updateSaveBtn() {
        const btn = document.getElementById('llm_save_btn');
        if (!btn) return;
        // 檢查必填
        const providerSel = document.getElementById('llm_f_provider');
        const providerCustom = document.getElementById('llm_f_provider_custom');
        const providerVal = (providerSel && providerSel.value) || (providerCustom && providerCustom.value) || '';
        const nameVal = (document.getElementById('llm_f_name') || {}).value || '';
        const baseVal = (document.getElementById('llm_f_base') || {}).value || '';

        const checks = [
            LLMForm._validateField('provider', providerVal),
            LLMForm._validateField('name', nameVal),
            LLMForm._validateField('base_url', baseVal),
        ];
        const allOk = checks.every(e => e === null);
        btn.disabled = !allOk;
        btn.style.opacity = allOk ? '1' : '0.5';
        btn.style.cursor = allOk ? 'pointer' : 'not-allowed';
    },

    // 選模板 → 自動預填
    _applyTpl(id) {
        if (!id) return;
        const tpl = (window._llmTemplates || {})[id];
        if (!tpl) return;
        const name = document.getElementById('llm_f_name');
        const model = document.getElementById('llm_f_model');
        const base = document.getElementById('llm_f_base');
        if (!name.value) name.value = tpl.provider_name || id;
        if (!model.value && tpl.model) model.value = tpl.model;
        if (!base.value && tpl.base_url) base.value = tpl.base_url;
        // 預填後即時校驗
        LLMForm._updateSaveBtn();
    },

    async _save(provider) {
        const isEdit = !!provider;
        const providerSel = document.getElementById('llm_f_provider');
        const providerCustom = document.getElementById('llm_f_provider_custom');
        const pid = isEdit ? provider
            : ((providerSel && providerSel.value) || (providerCustom && providerCustom.value)).trim();
        const nameEl = document.getElementById('llm_f_name');
        const keyEl = document.getElementById('llm_f_key');
        const modelEl = document.getElementById('llm_f_model');
        const baseEl = document.getElementById('llm_f_base');
        const name = nameEl.value.trim();
        const key  = keyEl.value.trim();
        const model = modelEl.value.trim();
        const base  = baseEl.value.trim();

        // 最後一次校驗（避免绕过前端）
        const allChecks = [
            { eid: isEdit ? null : (providerSel && providerSel.value ? 'llm_f_provider' : 'llm_f_provider_custom'),
              field: 'provider', val: pid },
            { eid: 'llm_f_name', field: 'name', val: name },
            { eid: 'llm_f_base', field: 'base_url', val: base },
            { eid: 'llm_f_model', field: 'model', val: model },
            { eid: 'llm_f_key', field: 'api_key', val: key },
        ];
        let firstErr = null;
        for (const c of allChecks) {
            const err = LLMForm._validateField(c.field, c.val);
            if (err) {
                if (c.eid) LLMForm._showError(c.eid, err);
                if (!firstErr) firstErr = err;
            }
        }
        if (firstErr) {
            UI.toast('❌ ' + firstErr, 'error');
            return;
        }

        const payload = { provider: pid.toLowerCase(), provider_name: name, api_key: key, model, base_url: base };
        const res = isEdit
            ? await API.put('/api/llm/' + pid.toLowerCase(), { api_key: key, model, base_url: base })
            : await API.post('/api/llm/providers', payload);

        if (res.success) {
            UI.modal.hide();
            UI.toast('✅ ' + (t('saved') || '儲存成功'), 'success');
            loadLLMProviders();
        } else {
            UI.toast('❌ ' + res.message, 'error');
        }
    },

    async setDefault(provider) {
        // 前端預檢查：該 provider 是否已填 api_key 且狀態為 USE
        const res = await API.get('/api/llm/providers');
        const p = res.data.list.find(x => x.provider === provider);
        if (!p) { UI.toast('❌ 找不到此服務商', 'error'); return; }
        if (!p.configured) {
            UI.toast('❌ 此服務商尚未設定 API Key，不能設為預設', 'error');
            return;
        }
        if (p.status !== 'USE') {
            UI.toast('❌ 此服務商狀態非 USE，不能設為預設', 'error');
            return;
        }
        if (!confirm(`${t('sys.llm_confirm_default') || '確定將「'}${p.provider_name}${t('sys.llm_confirm_default2') || '」設為預設 LLM？'}`)) return;
        const r = await API.post(`/api/llm/${provider}/default`);
        if (r.success) { UI.toast('✅ ' + (t('sys.llm_default_ok') || '已設為預設'), 'success'); loadLLMProviders(); }
        else UI.toast('❌ ' + r.message, 'error');
    },

    async remove(provider) {
        const res = await API.get('/api/llm/providers');
        const p = res.data.list.find(x => x.provider === provider);
        if (!p) return;
        if (p.is_default) {
            UI.toast('❌ 預設服務商不能刪除，請先設別家為預設', 'error');
            return;
        }
        if (!confirm(`${t('sys.llm_confirm_del') || '確定刪除「'}${p.provider_name}${t('sys.llm_confirm_del2') || '」？此動作無法復原。'}`)) return;
        const r = await API.delete(`/api/llm/${provider}`);
        if (r.success) { UI.toast('✅ ' + (t('deleted') || '已刪除'), 'success'); loadLLMProviders(); }
        else UI.toast('❌ ' + r.message, 'error');
    },

    async test(provider) {
        const res = await API.get('/api/llm/providers');
        const p = res.data.list.find(x => x.provider === provider);
        if (!p) return;
        if (!p.configured) {
            UI.toast('❌ 此服務商尚未設定 API Key，無法測試', 'error');
            return;
        }
        UI.toast('🧪 ' + (t('sys.llm_testing') || '連線測試中...'), 'info');
        const r = await API.post('/api/llm/test', { provider });
        if (r.success) UI.toast('✅ ' + (t('sys.llm_test_ok') || '連線成功') + `：${r.data.reply}`, 'success');
        else UI.toast('❌ ' + r.message, 'error');
    },

    // 從 .env 匯入
    async syncEnv() {
        UI.modal.show({
            title: t('sys.llm_env_title') || '從 .env 匯入 LLM 設定',
            body: `<p style="color:#7f8c8d;">${t('sys.llm_env_hint') || '請在 .env 內以 <code>LLM_{PROVIDER}_KEY</code> / <code>LLM_{PROVIDER}_BASE</code> / <code>LLM_{PROVIDER}_MODEL</code> 格式設定，例如：'}</p>
<pre style="background:#2c3e50;color:#ecf0f1;padding:12px;border-radius:6px;font-size:12px;overflow-x:auto;">LLM_KIMI_KEY=sk-xxx
LLM_KIMI_MODEL=kimi-k2.6
LLM_DOUBAO_KEY=ark-xxx</pre>
<p style="font-size:11px;color:#95a5a6;margin-top:8px;">${t('sys.llm_env_contact') || '（此功能需後端支援，請聯絡系統管理員）'}</p>`,
            buttons: [{ label: t('close') || '關閉', cls: 'btn', action: () => UI.modal.hide() }]
        });
    }
};

// ============ 系统码表 ============
async function loadCodes() {
    const _mgr = Auth.isManager();
    const el = document.getElementById('codeTable');
    try {
        const type = document.getElementById('codeType').value;
        const res = await API.get(`/api/system/codes?code_type=${encodeURIComponent(type)}&bu_no=${State.bu_no}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = `<p style="color:#95a5a6;text-align:center;padding:40px;">📋 ${t('sys.no_codes')}</p>`; return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>${t('sys.type')}</th><th>${t('sys.code')}</th><th>${t('sys.name')}</th>
                <th>${t('sys.val1')}</th><th>${t('sys.val2')}</th><th>${t('sys.val3')}</th>
                <th>${t('system.col.sort')}</th><th>${t('system.col.status')}</th>${_mgr ? `<th>${t('system.col.action')}</th>` : ''}
            </tr></thead>
            <tbody>${rows.map(r => `
                <tr>
                    <td>${r.code_type||'-'}</td><td><b>${r.code_value||'-'}</b></td><td>${r.value_description||'-'}</td>
                    <td class="num">${UI.fmt(r.value_number1,4)}</td>
                    <td class="num">${UI.fmt(r.value_number2,4)}</td>
                    <td class="num">${UI.fmt(r.value_number3,4)}</td>
                    <td>${r.sort_order||0}</td>
                    <td>${r.inuse_flag==='USE'?'<span style="color:#27ae60">● '+t('system.status.active')+'</span>':'<span style="color:#e74c3c">○ '+t('system.status.inactive')+'</span>'}</td>
                    ${_mgr ? `<td>
                        <button class="btn btn-sm" onclick="CodeForm.open(${r.id})">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delCode(${r.id})">🗑</button>
                    </td>` : ''}
                </tr>`).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

const CodeForm = {
    async open(id) {
        let d = {};
        if (id) {
            try {
                const res = await API.get(`/api/system/codes/${id}`);
                d = res.data || {};
            } catch(e) { UI.toast(e.message,'error'); return; }
        }
        this._render(d, !!id);
    },
    _render(d, isEdit) {
        UI.modal((isEdit ? t('modal.edit') : t('modal.add')) + ' ' + t('sys.codes'), `
            <div class="form-row">
                <div class="form-group"><label>${t('sys.type')}</label>
                    <select id="cf_type">
                        <option>CURRENCY</option><option>BUSINESS_ID</option>
                        <option>AGEING_STOCK</option><option>BATCH_CONTROL</option>
                    </select></div>
                <div class="form-group"><label>${t('sys.code')}</label><input id="cf_val" value="${d.code_value||''}"></div>
                <div class="form-group"><label>${t('system.form.desc')}</label><input id="cf_desc" value="${d.value_description||''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('sys.val1')}</label><input type="number" step="0.0001" id="cf_n1" value="${d.value_number1||0}"></div>
                <div class="form-group"><label>${t('sys.val2')}</label><input type="number" step="0.0001" id="cf_n2" value="${d.value_number2||0}"></div>
                <div class="form-group"><label>${t('sys.val3')}</label><input type="number" step="0.0001" id="cf_n3" value="${d.value_number3||0}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('system.col.sort')}</label><input type="number" id="cf_sort" value="${d.sort_order||0}"></div>
                <div class="form-group"><label>${t('system.col.status')}</label>
                    <select id="cf_use"><option value="USE">${t('system.status.active')}</option><option value="NOUSE">${t('system.status.inactive')}</option></select></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">${t('cancel')}</button>
            <button class="btn btn-primary" onclick="CodeForm.save(${d.id||0})">${t('save')}</button>`);

        if (d.code_type) document.getElementById('cf_type').value = d.code_type;
        if (d.inuse_flag) document.getElementById('cf_use').value = d.inuse_flag;
    },
    async save(id) {
        const body = {
            code_type: document.getElementById('cf_type').value,
            code_value: document.getElementById('cf_val').value,
            value_description: document.getElementById('cf_desc').value,
            value_number1: Number(document.getElementById('cf_n1').value)||0,
            value_number2: Number(document.getElementById('cf_n2').value)||0,
            value_number3: Number(document.getElementById('cf_n3').value)||0,
            sort_order: Number(document.getElementById('cf_sort').value)||0,
            inuse_flag: document.getElementById('cf_use').value,
        };
        if (!body.code_value) { UI.toast(t('system.msg.code_empty'),'error'); return; }
        try {
            if (id) { await API.put(`/api/system/codes/${id}`, body); UI.toast(t('saved'),'success'); }
            else { await API.post('/api/system/codes', body); UI.toast(t('system.msg.added'),'success'); }
            UI.closeModal(); loadCodes();
        } catch(e) { UI.toast(e.message,'error'); }
    }
};

async function delCode(id) {
    if (!confirm(t('system.msg.confirm_del_code'))) return;
    try { await API.del(`/api/system/codes/${id}`); UI.toast(t('deleted'),'success'); loadCodes(); }
    catch(e) { UI.toast(e.message,'error'); }
}

// ============ KPI ============
async function loadSysKPI() {
    const _mgr = Auth.isManager();
    const el = document.getElementById('kpiTable');
    try {
        const res = await API.get('/api/system/kpi');
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = `<p style="color:#95a5a6;text-align:center;padding:40px;">🎯 ${t('sys.no_kpi')}</p>`; return; }
        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>${t('sys.business')}</th><th>${t('sys.kpi_id')}</th><th>${t('sys.kpi_name')}</th><th>${t('system.col.unit')}</th>
                <th>${t('sys.cur_val')}</th><th>${t('sys.low')}</th><th>${t('sys.high')}</th><th>${t('system.col.direction')}</th><th>${t('sys.light')}</th>${_mgr ? `<th>${t('system.col.action')}</th>` : ''}
            </tr></thead>
            <tbody>${rows.map(r => {
                const c = (r.KPI_color || '').toUpperCase();
                const dotColor = c === 'GREEN' ? '#27ae60' : c === 'RED' ? '#e74c3c' : '#f1c40f';
                return `
                <tr>
                    <td>${r.bu_no||'-'}</td><td>${r.KPI_id||'-'}</td><td>${r.KPI_name||'-'}</td>
                    <td>${r.unit||'-'}</td>
                    <td class="num">${UI.fmt(r.KPI_value,4)}</td>
                    <td class="num">${UI.fmt(r.KPI1,4)}</td>
                    <td class="num">${UI.fmt(r.KPI2,4)}</td>
                    <td>${r.pct_type==='desc'?'↓ '+t('system.kpi.high_better'):'↑ '+t('system.kpi.low_better')}</td>
                    <td><span style="color:${dotColor};font-size:1.2em;">●</span> ${c||'-'}</td>
                    ${_mgr ? `<td>
                        <button class="btn btn-sm" onclick="KpiForm.open(${r.uid})">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="delSysKPI(${r.uid})">🗑</button>
                    </td>` : ''}
                </tr>`;
            }).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

const KpiForm = {
    open(uid) {
        if (uid) {
            API.get(`/api/kpi/${uid}`).then(r => this._render(r.data, true))
                .catch(() => API.get(`/api/system/kpi?bu_no=${State.bu_no}`).then(r => {
                    const row = (r.data||[]).find(x => x.uid === uid);
                    if (row) this._render(row, true); else UI.toast(t('system.msg.not_found'),'error');
                }));
        } else {
            this._render({ bu_no: State.bu_no, KPI1: 0, KPI2: 0, pct_type: 'asc' }, false);
        }
    },
    _render(d, isEdit) {
        UI.modal((isEdit ? t('modal.edit') : t('modal.add')) + ' KPI', `
            <div class="form-row">
                <div class="form-group"><label>${t('sys.business')}</label>
                    <select id="kf_bu"><option>HM</option><option>HN</option><option>SZ</option></select></div>
                <div class="form-group"><label>${t('sys.kpi_id')}</label><input id="kf_id" value="${d.KPI_id||''}" ${isEdit?'disabled':''}></div>
                <div class="form-group"><label>${t('sys.kpi_name')}</label><input id="kf_name" value="${d.KPI_name||''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('system.col.unit')}</label><input id="kf_unit" value="${d.unit||''}" placeholder="${t('system.unit_placeholder')}"></div>
                <div class="form-group"><label>${t('system.col.direction')}</label>
                    <select id="kf_type"><option value="asc">↑ asc ${t('system.kpi.in_range')}</option>
                    <option value="desc">↓ desc ${t('system.kpi.high_better')}</option></select></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${t('sys.low')} KPI1</label><input type="number" step="0.0001" id="kf_low" value="${d.KPI1||0}"></div>
                <div class="form-group"><label>${t('sys.high')} KPI2</label><input type="number" step="0.0001" id="kf_high" value="${d.KPI2||0}"></div>
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">${t('cancel')}</button>
            <button class="btn btn-primary" onclick="KpiForm.save(${d.uid||0})">${t('save')}</button>`);
        if (d.bu_no) document.getElementById('kf_bu').value = d.bu_no;
        if (d.pct_type) document.getElementById('kf_type').value = d.pct_type;
    },
    async save(uid) {
        const body = {
            bu_no: document.getElementById('kf_bu').value,
            KPI_id: document.getElementById('kf_id').value,
            KPI_name: document.getElementById('kf_name').value,
            unit: document.getElementById('kf_unit').value,
            pct_type: document.getElementById('kf_type').value,
            KPI1: Number(document.getElementById('kf_low').value)||0,
            KPI2: Number(document.getElementById('kf_high').value)||0,
        };
        if (!body.KPI_id) { UI.toast(t('system.msg.kpi_id_empty'),'error'); return; }
        try {
            // POST route 已用 ON DUPLICATE KEY UPDATE，新旧都走同一条
            await API.post('/api/system/kpi', body);
            UI.toast(isNaN(uid) ? t('system.msg.added') : t('saved'), 'success');
            UI.closeModal(); loadSysKPI();
        } catch(e) { UI.toast(e.message,'error'); }
    }
};

async function delSysKPI(uid) {
    if (!confirm(t('kpi.msg.confirm_delete'))) return;
    try { await API.del(`/api/kpi/${uid}`); UI.toast(t('deleted'),'success'); loadSysKPI(); }
    catch(e) { UI.toast(e.message,'error'); }
}

async function kpiLight() {
    try {
        const res = await API.post('/api/risk/kpi-light', { bu_no: State.bu_no });
        UI.toast(t('sys.kpi_updated') + ` (${res.data?.length || 0})`, 'success');
        loadSysKPI();
    } catch(e) { UI.toast(e.message,'error'); }
}
