/**
 * ERMM 前端核心框架
 */

// ===== 登入验证模组 =====
const TOKEN_KEY = 'ermm_token';
const USER_KEY = 'ermm_user';
const Auth = {
    getToken() { return localStorage.getItem(TOKEN_KEY) || ''; },
    isLoggedIn() { return !!this.getToken(); },

    // 读取登入 session（user_id / user_name / admin）
    getUser() {
        try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
        catch (e) { return null; }
    },
    // 使用者類別归一化：繁/简/历史错别字统一为简体，供权限判断使用
    _normRole(s) {
        return String(s || '')
            .replace(/部門|部门/g, '部门')
            .replace(/經理|经理/g, '经理')
            .replace(/高階|高阶|高价/g, '高阶')
            .replace(/員工|员工/g, '员工')
            .trim();
    },
    // 是否为管理员（cams_xuser.admin === 'Yes'，migration 012 起統一 Yes/No）
    isAdmin() {
        const u = this.getUser();
        return !!(u && String(u.admin || '').trim() === 'Yes');
    },
    // 是否为部门主管／部门经理／高阶主管（可操作 CRUD 功能模组）
    isManager() {
        const u = this.getUser();
        const t = this._normRole(u && u.user_type);
        return !!(u && (t === '部门主管' || t === '部门经理' || t === '高阶主管'));
    },

    showLogin() {
        document.body.classList.add('locked');
        const err = document.getElementById('loginError');
        if (err) err.textContent = '';
        const uid = document.getElementById('loginUserId');
        if (uid) uid.focus();
    },

    enterApp(user) {
        if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
        document.body.classList.remove('locked');
        this.renderUser();
        if (typeof currentPage === 'undefined' || !currentPage) currentPage = 'dashboard';
        navigate(currentPage || 'dashboard');
    },

    renderUser() {
        const el = document.getElementById('currentUser');
        if (el) {
            try {
                const u = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
                el.textContent = u ? (u.user_name || u.user_id || '') : '';
            } catch (e) { el.textContent = ''; }
        }
        this.applyNavPermissions();
    },

    // 「使用者管理」与「系统文件」整组菜单仅管理员可见
    applyNavPermissions() {
        const admin = this.isAdmin();
        const show = (el, visible) => { if (el) el.style.display = visible ? '' : 'none'; };
        show(document.querySelector('#sidebar .nav-item[data-page="user"]'), admin);
        const docsItem = document.querySelector('#sidebar .nav-item[data-page="docArchitecture"]');
        if (docsItem) show(docsItem.parentElement, admin);
    },

    async login(user_id, password) {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id, password })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.message || '登入失败');
        }
        localStorage.setItem(TOKEN_KEY, data.data.token);
        localStorage.setItem(USER_KEY, JSON.stringify(data.data.user));
        this.enterApp(data.data.user);
    },

    // 收到 401 时呼叫：清除过期 token 并回到登入画面
    handle401() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        this.showLogin();
    },

    async logout() {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
        } catch (e) { /* 无状态登出，失败也照样清除本地状态 */ }
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        this.showLogin();
    },

    // 启动时检查既有 token 是否仍有效
    async init() {
        this.renderUser();
        if (!this.getToken()) { this.showLogin(); return; }
        try {
            const res = await fetch('/api/auth/me');
            if (!res.ok) throw new Error('token invalid');
            // 以数据库最新资料同步本地 session（含 admin 身份）
            const j = await res.json();
            if (j && j.success && j.data) {
                localStorage.setItem(USER_KEY, JSON.stringify(j.data));
                this.renderUser();
            }
            document.body.classList.remove('locked');
            navigate(currentPage || 'dashboard');
        } catch (e) {
            this.handle401();
        }
    }
};

// ===== 全域 fetch 注入 JWT（涵盖所有页面直接呼叫 fetch 的场景）=====
(function () {
    const origFetch = window.fetch.bind(window);
    window.fetch = function (input, init = {}) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const isApi = url.indexOf('/api/') === 0;
        if (isApi) {
            init.headers = new Headers(init.headers || {});
            const token = Auth.getToken();
            if (token && !init.headers.has('Authorization')) {
                init.headers.set('Authorization', 'Bearer ' + token);
            }
        }
        return origFetch(input, init).then(res => {
            // 登入请求本身的 401 交给表单处理，其余 401 → 登入逾时
            if (res.status === 401 && isApi && url.indexOf('/api/auth/login') === -1) {
                Auth.handle401();
            }
            return res;
        });
    };
})();

const API = (() => {
    const base = '';
    async function req(method, url, body) {
        const opts = { method, headers: { 'Content-Type': 'application/json' } };
        if (body) opts.body = JSON.stringify(body);
        const res = await fetch(base + url, opts);
        const data = await res.json();
        if (!res.ok && !data.success) throw new Error(data.message || `HTTP ${res.status}`);
        return data;
    }
    return {
        get: (u) => req('GET', u),
        post: (u, b) => req('POST', u, b),
        put: (u, b) => req('PUT', u, b),
        del: (u) => req('DELETE', u),
        download: async (u) => {
            // 带 JWT 的档案下载（fetch blob），避免 window.open 无法带 Authorization
            const res = await fetch(u);
            if (res.status === 401) { Auth.handle401(); throw new Error('未登入或登入已过期'); }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            let filename = u.split('/').pop() || 'download';
            const cd = res.headers.get('Content-Disposition') || '';
            const m = /filename\*?=(?:UTF-8'')?["']?([^;"']+)/i.exec(cd);
            if (m) filename = decodeURIComponent(m[1]);
            const blob = await res.blob();
            const objUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objUrl; a.download = filename;
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(objUrl);
        }
    };
})();

// ===== 码表通用读取器（带内存缓存，失败时回退到 fallback） =====
const CodeHelper = {
    _cache: {},           // { code_type: [{code_value, value_description, ...}] }
    _pending: {},         // 正在加载中的 Promise（防并发）

    /** 返回指定 code_type 的 active 码值数组，失败则返回 fallback */
    async list(codeType, fallback = []) {
        if (this._cache[codeType]) return this._cache[codeType];
        if (this._pending[codeType]) return this._pending[codeType];
        this._pending[codeType] = API.get(`/api/codes/active-values?code_type=${encodeURIComponent(codeType)}`)
            .then(res => {
                const arr = res.data || [];
                if (arr.length) this._cache[codeType] = arr;
                return arr.length ? arr : fallback;
            })
            .catch(() => fallback)
            .finally(() => { delete this._pending[codeType]; });
        return this._pending[codeType];
    },

    /** 直接返回字符串数组（仅 code_value），方便拼下拉 */
    async values(codeType, fallback = []) {
        const arr = await this.list(codeType, fallback);
        return arr.map(r => typeof r === 'string' ? r : r.code_value);
    },

    /** 刷新全部缓存（码表管理新增/删除后调用） */
    invalidate(codeType) {
        if (codeType) delete this._cache[codeType];
        else this._cache = {};
    },

    /**
     * 统一生成公司下拉 <option> HTML（BUSINESS_ID 码表）
     * options: { includeAll, allValue, allLabel, selected, fallback }
     *   includeAll=true → 首项追加「全部」（value=""）
     *   selected → 预先选中的值
     *   fallback → 码表加载失败时的硬编码兜底（默认 ['HM','HN','SZ']）
     * 返回 HTML 字符串，可直接放进模板字面量里 ${CodeHelper.buSel(...)}
     */
    async buSel({ includeAll = false, allValue = '', allLabel, selected = '', fallback = ['HM','HN','SZ'] } = {}) {
        const buList = await this.values('BUSINESS_ID', fallback);
        let html = buList.map(v =>
            `<option value="${v}" ${selected && v === selected ? 'selected' : ''}>${v}</option>`
        ).join('');
        if (includeAll) {
            const label = allLabel || (typeof t !== 'undefined' ? t('sys.all') : '全部');
            html = `<option value="${allValue}" ${selected === allValue ? 'selected' : ''}>${label}</option>` + html;
        }
        return html;
    }
};

const UI = {
    toast(msg, type = 'info') {
        const el = document.createElement('div');
        el.className = `toast-msg ${type}`;
        el.textContent = msg;
        document.getElementById('toast').appendChild(el);
        setTimeout(() => el.remove(), 3000);
    },
    modal(title, bodyHtml, footerHtml = '') {
        const ov = document.getElementById('modalOverlay');
        ov.innerHTML = `<div class="modal"><h3>${title}</h3>${bodyHtml}<div class="modal-footer">${footerHtml}</div></div>`;
        ov.classList.add('show');
        ov.onclick = (e) => { if (e.target === ov) ov.classList.remove('show'); };
    },
    closeModal() { document.getElementById('modalOverlay').classList.remove('show'); },
    fmt(n, dec = 2) {
        if (n == null || n === '') return '-';
        const v = Number(n);
        if (isNaN(v)) return n;
        return v.toLocaleString('zh-TW', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    },
    fmtDate(d) {
        if (!d) return '-';
        return String(d).substring(0, 10);
    },
    light(color) { return `<span class="light ${color || 'green'}"></span>`; },
    empty(icon = '📋', text = null) {
        return `<div class="empty-state"><div class="icon">${icon}</div><div>${text || t('no_data')}</div></div>`;
    }
};

// ===== 异常诊断（点击 KPI 红灯展开 Top3 原因）=====
const Diagnosis = {
    async open(kpi_id) {
        UI.modal(t('diag.loading_title'), `<div style="text-align:center;padding:30px;">${t('diag.analyzing')}</div>`, '');
        try {
            const res = await API.get(`/api/diagnosis/kpi?bu_no=${State.bu_no}&YYYY_MM=${State.YYYY_MM}&kpi_id=${kpi_id}&lang=${I18N.lang}`);
            const d = res.data;
            const lvlColor = d.level === 'danger' ? '#e74c3c' : d.level === 'warning' ? '#f39c12' : '#27ae60';
            const reasonsHtml = (d.top_reasons || []).map(r => `
                <div style="display:flex;gap:12px;padding:12px;border:1px solid #eee;border-radius:8px;margin-bottom:10px;background:#fafafa;">
                    <div style="width:30px;height:30px;border-radius:50%;background:${r.rank===1?'#e74c3c':r.rank===2?'#f39c12':'#3498db'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;">${r.rank}</div>
                    <div style="flex:1;">
                        <div style="font-weight:700;font-size:13px;margin-bottom:4px;">${r.dim}：${r.desc}</div>
                        <div style="font-size:12px;color:#555;margin-bottom:4px;">📊 ${t('diag.impact')}：${r.impact}</div>
                        <div style="font-size:12px;color:#2980b9;background:#eaf2f8;padding:5px 8px;border-radius:5px;">💡 ${r.suggestion}</div>
                    </div>
                </div>
            `).join('');
            UI.modal(`🔍 ${d.kpi_name} ${t('diag.anomaly_diag')}`, `
                <div style="margin-bottom:16px;">
                    <div style="font-size:12px;color:#7f8c8d;">${t('diag.current_value')}</div>
                    <div style="font-size:28px;font-weight:800;color:${lvlColor};">${d.current_value}${d.unit} 
                        <span style="font-size:14px;color:#95a5a6;">／ ${t('diag.threshold')} ${d.threshold}${d.unit}</span>
                    </div>
                    ${d.change !== null ? `<div style="font-size:13px;color:${d.change>=0?'#27ae60':'#e74c3c'};">${t('diag.vs_prev')} ${d.change>=0?'▲':'▼'} ${Math.abs(d.change)}${d.unit}</div>` : ''}
                </div>
                <div style="font-weight:700;margin-bottom:10px;">${t('diag.top3_reasons')}</div>
                ${reasonsHtml}
            `, `<button class="btn btn-ghost" onclick="UI.closeModal()">${t('diag.close')}</button>
                <button class="btn" onclick="Diagnosis.aiAttribution('${kpi_id}')" style="background:#6c5ce7;color:#fff;border-color:#6c5ce7;">🤖 ${t('diag.ai_attribution')}</button>
                <button class="btn btn-primary" onclick="UI.closeModal();navigate('actions')">${t('diag.create_action')}</button>`);
        } catch (e) {
            UI.modal(t('diag.diag_failed'), `<p style="color:#e74c3c">${e.message}</p>`, `<button class="btn btn-ghost" onclick="UI.closeModal()">${t('diag.close')}</button>`);
        }
    },

    async aiAttribution(kpi_id) {
        UI.modal(`🤖 ${kpi_id} ${t('diag.ai_attribution')}`, `<div style="text-align:center;padding:40px;">${t('diag.ai_analyzing')}</div>`, '');
        try {
            const res = await API.post('/api/diagnosis/ai-attribution', {
                bu_no: State.bu_no, YYYY_MM: State.YYYY_MM, kpi_id, lang: I18N.lang
            });
            const d = res.data;
            const sugLabel = t('diag.suggestions');
            const sugHtml = (d.suggestions && d.suggestions.length)
                ? d.suggestions.map((s, i) => `<div style="background:#eaf2f8;padding:10px 12px;border-radius:6px;margin-bottom:8px;font-size:13px;"><b>${sugLabel} ${i + 1}：</b>${s}</div>`).join('')
                : `<div style="color:#999;font-size:13px;">${t('diag.no_suggestions')}</div>`;
            UI.modal(`🤖 ${t('diag.ai_attribution')}`, `
                <div style="max-height:60vh;overflow-y:auto;">
                    <div style="background:#f8f9fa;padding:12px;border-radius:8px;margin-bottom:14px;border-left:4px solid #6c5ce7;">
                        <div style="white-space:pre-wrap;font-size:14px;line-height:1.7;color:#2c3e50;">${d.explanation}</div>
                    </div>
                    <div style="font-weight:700;margin-bottom:8px;">${t('diag.suggestions')}</div>
                    ${sugHtml}
                </div>
            `, `<div style="font-size:11px;color:#95a5a6;margin-right:auto;text-align:left;">${t('diag.generated_by', { provider: d.provider, model: d.model })}</div>
                <button class="btn btn-ghost" onclick="UI.closeModal()">${t('diag.close')}</button>`);
        } catch (e) {
            UI.modal(t('diag.ai_failed'), `<p style="color:#e74c3c">${e.message}</p>`, `<button class="btn btn-ghost" onclick="UI.closeModal()">${t('diag.close')}</button>`);
        }
    }
};

// ===== 页面管理 =====
const pages = {};
function registerPage(id, fn) { pages[id] = fn; }

async function navigate(pageId, params = {}) {
    const fn = pages[pageId];
    if (!fn) return;
    document.querySelectorAll('#sidebar .nav-item').forEach(el => el.classList.remove('active'));
    const navEl = document.querySelector(`#sidebar .nav-item[data-page="${pageId}"]`);
    if (navEl) navEl.classList.add('active');
    const container = document.getElementById('pageContent');
    container.innerHTML = `<div style="text-align:center;padding:40px;color:#999">${t('loading')}</div>`;
    try {
        await fn(container, params);
    } catch (err) {
        container.innerHTML = `<div class="card"><p style="color:#e74c3c">❌ ${t('load_failed')}: ${err.message}</p></div>`;
    }
}

// ===== 系统文件（仅管理员可打开）=====
function openDocPage(url) {
    if (!Auth.isLoggedIn()) return false;
    if (!Auth.isAdmin()) {
        UI.toast(t('docs.noPermission'), 'error');
        return false;
    }
    window.open(url, '_blank', 'noopener');
    return false;
}

// ===== 全局状态 =====
const State = {
    bu_no: 'HM',
    YYYY_MM: new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0')
};
