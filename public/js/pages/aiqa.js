/**
 * AI 問答頁面
 * 兩種模式：
 *   1. 未勾選 LLM：規則引擎自然語言查詢 ermm_db
 *   2. 勾選 LLM：Kimi / DeepSeek 依財務資料上下文回答
 */
registerPage('aiqa', async (c) => {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h2 style="margin:0;font-size:20px;">🤖 ${t('page.aiqa')} <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">${t('aiqa.subtitle')}</small></h2>
            <div>
                <select id="aiBu" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                    <option value="HM">HM</option><option value="SZ">SZ</option><option value="HN">HN</option>
                </select>
                <input type="month" id="aiMonth" style="padding:7px;border:1px solid #ddd;border-radius:6px;margin-left:6px;" title="${t('aiqa.month')}">
            </div>
        </div>
        <div class="card" style="background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;">
            <div style="display:flex;gap:10px;">
                <input type="text" id="aiInput" placeholder="${t('aiqa.placeholder')}" style="flex:1;padding:12px 16px;border:none;border-radius:10px;font-size:14px;" onkeydown="if(event.key==='Enter')AIQA.ask()">
                <button id="aiAskBtn" class="btn btn-success" onclick="AIQA.ask()" style="padding:12px 24px;">${t('aiqa.query')}</button>
            </div>
            <div style="margin-top:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <label style="background:rgba(255,255,255,0.18);padding:6px 14px;border-radius:20px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:6px;user-select:none;">
                    <input type="checkbox" id="aiUseLLM" onchange="AIQA.toggleLLM()"> 🧠 ${t('llm.toggle')}
                </label>
                <select id="aiProvider" style="display:none;padding:6px 10px;border-radius:6px;border:none;font-size:13px;">
                    <option value="kimi">Kimi</option>
                    <option value="deepseek">DeepSeek</option>
                </select>
                <button type="button" id="aiKeyBtn" class="btn btn-sm" style="display:none;background:rgba(255,255,255,0.18);color:#fff;border:1px solid rgba(255,255,255,0.5);" onclick="LLMKeyMgr.open()">⚙️ ${t('llm.key_mgr')}</button>
                <span id="aiLLMStatus" style="font-size:12px;color:rgba(255,255,255,0.9);"></span>
            </div>
            <div id="aiSuggest" style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;"></div>
        </div>
        <div class="card" style="margin-top:16px;min-height:300px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div class="card-title" style="margin:0;">${t('aiqa.chat_log')}</div>
                <button type="button" class="btn btn-sm" onclick="AIRecords.open()">📋 ${t('airecords.title')}</button>
            </div>
            <div id="aiChat" style="max-height:500px;overflow-y:auto;margin-top:10px;">
                <div style="text-align:center;color:#95a5a6;padding:40px;">
                    <div style="font-size:3em;margin-bottom:10px;">💬</div>
                    <div>${t('aiqa.welcome')}</div>
                </div>
            </div>
        </div>
    `;
    document.getElementById('aiBu').value = State.bu_no;
    const defMonth = State.YYYY_MM ? State.YYYY_MM.replace('/', '-') : '2025-07';
    document.getElementById('aiMonth').value = defMonth;
    loadSuggestions();
    LLMKeyMgr.refreshStatus();
});

async function loadSuggestions() {
    try {
        const lang = (typeof I18N !== 'undefined' && I18N.lang) ? I18N.lang : 'zh-TW';
        const res = await API.get(`/api/aiqa/suggestions?lang=${encodeURIComponent(lang)}`);
        const el = document.getElementById('aiSuggest');
        const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        el.innerHTML = (res.data || []).map(s =>
            `<span data-sg="${esc(s)}" style="background:rgba(255,255,255,0.2);padding:5px 12px;border-radius:15px;font-size:12px;cursor:pointer;" onclick="AIQA.fillSuggestion(this)">${esc(s)}</span>`
        ).join('');
    } catch (e) { /* ignore */ }
}

const AIQA = {
    // 點擊建議問題：填入輸入框並立即提問
    fillSuggestion(el) {
        document.getElementById('aiInput').value = el.dataset.sg || '';
        this.ask();
    },

    // 勾選 LLM 後顯示模型選擇 + Key 管理按鈕
    toggleLLM() {
        const useLLM = document.getElementById('aiUseLLM').checked;
        document.getElementById('aiProvider').style.display = useLLM ? '' : 'none';
        document.getElementById('aiKeyBtn').style.display = useLLM ? '' : 'none';
        this.renderStatus();
    },

    // 顯示當前選擇模型的 Key 設定狀態
    renderStatus() {
        const el = document.getElementById('aiLLMStatus');
        if (!el) return;
        const useLLM = document.getElementById('aiUseLLM').checked;
        if (!useLLM) { el.textContent = t('llm.mode_rule'); return; }
        const pvd = document.getElementById('aiProvider').value;
        const cfg = (LLMKeyMgr.configs || []).find(x => x.provider === pvd);
        if (!cfg) { el.textContent = ''; return; }
        el.textContent = `${cfg.provider_name}：${cfg.configured ? '✅ ' + t('llm.configured') : '⚠️ ' + t('llm.not_configured')}`;
    },

    async ask() {
        const input = document.getElementById('aiInput');
        const q = input.value.trim();
        if (!q) return;
        const bu = document.getElementById('aiBu').value;
        // 讀取月份並標準化為 YYYY/MM 格式
        const mRaw = document.getElementById('aiMonth').value;
        let mm = null;
        if (mRaw) {
            // 支援 YYYY-MM, YYYY/MM, YYYYMM 三種格式
            const m = mRaw.match(/^(\d{4})[-/]?(\d{1,2})/);
            if (m) mm = `${m[1]}/${m[2].padStart(2, '0')}`;
        }
        const useLLM = document.getElementById('aiUseLLM').checked;
        const provider = document.getElementById('aiProvider').value;
        State.bu_no = bu;

        const chat = document.getElementById('aiChat');
        const askBtn = document.getElementById('aiAskBtn');
        // 使用者訊息
        chat.innerHTML += `<div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
            <div style="background:#2563eb;color:#fff;padding:10px 14px;border-radius:12px 12px 2px 12px;max-width:70%;">${q}</div>
        </div>`;
        input.value = '';
        chat.scrollTop = chat.scrollHeight;

        // LLM 模式顯示思考中佔位
        let thinkingEl = null;
        if (useLLM) {
            askBtn.disabled = true;
            chat.innerHTML += `<div id="aiThinking" style="display:flex;margin-bottom:12px;">
                <div style="background:#f5f3ff;color:#7c3aed;padding:12px 16px;border-radius:12px 12px 12px 2px;font-size:13px;">🧠 ${t('llm.thinking')}</div>
            </div>`;
            thinkingEl = document.getElementById('aiThinking');
            chat.scrollTop = chat.scrollHeight;
        }

        // AI 回覆
        try {
            const res = await API.post('/api/aiqa/ask', {
                question: q, bu_no: bu, YYYY_MM: mm,
                useLLM: useLLM, provider: provider,
                lang: (typeof I18N !== 'undefined' && I18N.lang) ? I18N.lang : 'zh-TW',
                xuser_name: (Auth.getUser() && Auth.getUser().user_name) || ''
            });
            if (thinkingEl) thinkingEl.remove();
            const a = res.data;
            const color = a.metric === 'llm' ? '#7c3aed'
                : (a.metric && (a.metric.includes('margin') || a.metric.includes('ratio') || a.metric.includes('roe'))) ? '#2563eb' : '#667eea';
            // LLM 回答可能含換行，使用 pre-wrap 保留格式
            const answerStyle = a.metric === 'llm' ? 'white-space:pre-wrap;line-height:1.7;' : '';
            chat.innerHTML += `<div style="display:flex;margin-bottom:12px;">
                <div style="background:#f1f5f9;padding:12px 16px;border-radius:12px 12px 12px 2px;max-width:80%;">
                    <div style="font-size:15px;font-weight:700;margin-bottom:8px;color:${color};${answerStyle}">${a.metric === 'llm' ? '🧠 ' : '📊 '}${a.answer}</div>
                    ${a.detail ? `<div style="font-size:13px;color:#555;margin-bottom:8px;line-height:1.6;">${a.detail}</div>` : ''}
                    ${a.suggestion ? `<div style="font-size:12px;color:#2980b9;background:#eaf2f8;padding:6px 10px;border-radius:6px;">💡 ${a.suggestion}</div>` : ''}
                </div>
            </div>`;
        } catch (e) {
            if (thinkingEl) thinkingEl.remove();
            chat.innerHTML += `<div style="display:flex;margin-bottom:12px;">
                <div style="background:#fef2f2;color:#e74c3c;padding:12px 16px;border-radius:12px;">❌ ${e.message}</div>
            </div>`;
        } finally {
            askBtn.disabled = false;
        }
        chat.scrollTop = chat.scrollHeight;
    }
};

// ====== LLM API Key 管理 ======
const LLMKeyMgr = {
    configs: [],

    // 頁面載入時拉取服務商設定狀態
    async refreshStatus() {
        try {
            const res = await API.get('/api/llm/providers');
            this.configs = res.data || [];
            AIQA.renderStatus();
        } catch (e) { /* ignore */ }
    },

    async open() {
        await this.refreshStatus();
        const isAdmin = Auth.isAdmin();
        const rows = this.configs.map(c => `
            <tr>
                <td><b>${c.provider_name}</b></td>
                <td><input type="text" id="llm_model_${c.provider}" value="${c.model || ''}" style="width:150px;" ${isAdmin ? '' : 'disabled'}></td>
                <td>
                    <input type="password" id="llm_key_${c.provider}" placeholder="${t('llm.key_placeholder').replace('{mask}', c.api_key_masked || '****')}" style="width:220px;" ${isAdmin ? '' : 'disabled'} autocomplete="new-password">
                </td>
                <td>
                    <select id="llm_status_${c.provider}" ${isAdmin ? '' : 'disabled'}>
                        <option value="USE" ${c.status === 'USE' ? 'selected' : ''}>USE</option>
                        <option value="NOUSE" ${c.status !== 'USE' ? 'selected' : ''}>NOUSE</option>
                    </select>
                </td>
                <td style="white-space:nowrap;">
                    ${isAdmin ? `<button class="btn btn-primary btn-sm" onclick="LLMKeyMgr.save('${c.provider}')">${t('llm.save')}</button>` : ''}
                    <button class="btn btn-sm" onclick="LLMKeyMgr.test('${c.provider}')">${t('llm.test')}</button>
                </td>
            </tr>`).join('');

        UI.modal(t('llm.title'), `
            <div style="font-size:12px;color:#7f8c8d;margin-bottom:10px;">
                ${isAdmin ? '🔑 ' : '🔒 '}${t('llm.hint')}
            </div>
            <table class="data-table" style="font-size:13px;">
                <thead><tr>
                    <th>${t('llm.col.provider')}</th><th>${t('llm.model')}</th>
                    <th>${t('llm.api_key')}</th><th>${t('llm.status')}</th><th>${t('llm.col.action')}</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <div style="font-size:12px;color:#95a5a6;margin-top:8px;">
                Kimi: https://platform.moonshot.cn ｜ DeepSeek: https://platform.deepseek.com
            </div>
        `, `<button class="btn" onclick="UI.closeModal()">${t('llm.close')}</button>`);
    },

    async save(provider) {
        try {
            const api_key = document.getElementById(`llm_key_${provider}`).value.trim();
            const model = document.getElementById(`llm_model_${provider}`).value.trim();
            const status = document.getElementById(`llm_status_${provider}`).value;
            const res = await API.put(`/api/llm/${provider}`, { api_key, model, status });
            UI.toast(res.message || t('llm.saved'), 'success');
            await this.refreshStatus();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async test(provider) {
        try {
            // 彈窗中若有臨時輸入新 Key 一併帶入測試
            const keyEl = document.getElementById(`llm_key_${provider}`);
            const api_key = keyEl ? keyEl.value.trim() : '';
            UI.toast(t('llm.testing'), 'info');
            const res = await API.post('/api/llm/test', { provider, api_key });
            UI.toast(`${t('llm.test_ok')}：${(res.data && res.data.reply) || 'OK'}`, 'success');
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};

// ====== AI 對談記錄查詢 ======
const AIRecords = {
    page: 1,
    pageSize: 10,

    async open() {
        UI.modal(`📋 ${t('airecords.title')}`, `
            <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;">
                <select id="airBu" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;">
                    <option value="">${t('airecords.all_bu')}</option>
                    <option value="HM">HM</option><option value="SZ">SZ</option><option value="HN">HN</option>
                </select>
                <input type="text" id="airKw" placeholder="${t('airecords.kw_ph')}" style="flex:1;min-width:180px;padding:6px 10px;border:1px solid #ddd;border-radius:6px;" onkeydown="if(event.key==='Enter')AIRecords.search()">
                <button class="btn btn-primary btn-sm" onclick="AIRecords.search()">🔍 ${t('airecords.search')}</button>
            </div>
            <div id="airList" style="max-height:55vh;overflow-y:auto;">
                <div style="text-align:center;color:#95a5a6;padding:30px;">${t('airecords.loading')}</div>
            </div>
            <div id="airPager" style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:13px;"></div>
        `, `<button class="btn" onclick="UI.closeModal()">${t('llm.close')}</button>`);
        // 加寬彈窗
        const m = document.querySelector('#modalOverlay .modal');
        if (m) { m.style.width = '820px'; m.style.maxWidth = '94vw'; }
        document.getElementById('airBu').value = State.bu_no || '';
        this.page = 1;
        await this.load();
    },

    search() { this.page = 1; this.load(); },

    async load() {
        const listEl = document.getElementById('airList');
        const bu = document.getElementById('airBu').value;
        const kw = document.getElementById('airKw').value.trim();
        try {
            const qs = new URLSearchParams({ page: this.page, pageSize: this.pageSize });
            if (bu) qs.set('bu_no', bu);
            if (kw) qs.set('keyword', kw);
            const res = await API.get(`/api/aiqa/records?${qs.toString()}`);
            const { list, total, page } = res.data;
            if (!list.length) {
                listEl.innerHTML = `<div style="text-align:center;color:#95a5a6;padding:30px;">${t('airecords.empty')}</div>`;
            } else {
                const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                listEl.innerHTML = list.map(r => `
                    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;margin-bottom:10px;">
                        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#7f8c8d;margin-bottom:6px;flex-wrap:wrap;">
                            <span>🕒 ${esc(r.created_time)} ｜ ${esc(r.bu_no)} ｜ 👤 ${esc(r.xuser_name || r.xuser_id)}</span>
                            <button class="btn btn-sm" style="padding:2px 10px;" onclick="AIRecords.copy(${r.uid})">📄 ${t('airecords.copy')}</button>
                        </div>
                        <div style="background:#eff6ff;color:#1e40af;padding:6px 10px;border-radius:6px;font-size:13px;font-weight:600;margin-bottom:6px;">Q：${esc(r.question)}</div>
                        <div style="background:#f8fafc;padding:8px 10px;border-radius:6px;font-size:13px;color:#334155;white-space:pre-wrap;max-height:200px;overflow-y:auto;line-height:1.6;">${esc(r.answer)}</div>
                        ${r.remark ? `<div style="font-size:11px;color:#95a5a6;margin-top:6px;">${esc(r.remark)}</div>` : ''}
                    </div>`).join('');
            }
            const totalPages = Math.max(1, Math.ceil(total / this.pageSize));
            document.getElementById('airPager').innerHTML = `
                <span>${t('airecords.total')}：${total}</span>
                <span style="display:flex;gap:8px;align-items:center;">
                    <button class="btn btn-sm" ${page <= 1 ? 'disabled' : ''} onclick="AIRecords.go(${page - 1})">‹ ${t('airecords.prev')}</button>
                    ${page} / ${totalPages}
                    <button class="btn btn-sm" ${page >= totalPages ? 'disabled' : ''} onclick="AIRecords.go(${page + 1})">${t('airecords.next')} ›</button>
                </span>`;
            // 快取當前頁資料供複製使用
            this._cache = {};
            (list || []).forEach(r => { this._cache[r.uid] = r; });
        } catch (e) {
            listEl.innerHTML = `<div style="color:#e74c3c;padding:20px;">❌ ${e.message}</div>`;
        }
    },

    go(p) { this.page = p; this.load(); },

    async copy(uid) {
        const r = this._cache && this._cache[uid];
        if (!r) return;
        const text = `[${r.created_time}] ${r.bu_no} · ${r.xuser_name || r.xuser_id}\n`
            + `Q：${r.question}\nA：${r.answer}` + (r.remark ? `\n（${r.remark}）` : '');
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                const ta = document.createElement('textarea');
                ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta); ta.select();
                document.execCommand('copy'); document.body.removeChild(ta);
            }
            UI.toast(t('airecords.copied'), 'success');
        } catch (e) { UI.toast(t('airecords.copy_fail'), 'error'); }
    }
};
