/**
 * ERMM 前端核心框架
 */

// ===== 登入验证模组 =====
const TOKEN_KEY = 'ermm_token';
const USER_KEY = 'ermm_user';
const PERM_KEY = 'ermm_permissions';  // 登录时注入的模块权限列表
const Auth = {
    getToken() { return localStorage.getItem(TOKEN_KEY) || ''; },
    isLoggedIn() { return !!this.getToken(); },

    // 读取登入 session（user_id / user_name / admin）
    getUser() {
        try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
        catch (e) { return null; }
    },
    // 权限列表（模块码数组）
    getPermissions() {
        try { return JSON.parse(localStorage.getItem(PERM_KEY) || '[]'); }
        catch (e) { return []; }
    },
    // 当前角色 (admin / operator / general)
    getRole() {
        return localStorage.getItem('ermm_role') || 'general';
    },
    // 是否有权访问指定模块（校验顺序：管理员 → 权限快取 → 角色兜底）
    canAccess(moduleCode) {
        if (!moduleCode) return false;
        if (this.isAdmin()) return true;            // 管理员硬编码全权限
        const raw = localStorage.getItem(PERM_KEY);
        // 无权限快取时不得默认放行（fail-closed），由 refreshPermissions() 补齐
        if (raw === null) return false;
        let perms = [];
        try { perms = JSON.parse(raw) || []; } catch (e) { perms = []; }
        if (!Array.isArray(perms)) return false;
        return perms.includes(moduleCode);
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
        const target = this.resolveStartPage(typeof currentPage === 'undefined' ? null : currentPage);
        currentPage = target;
        navigate(target);
        this._bindFocusRefresh();
        refreshApprovalBadge();
    },

    renderUser(enforceCurrent = false) {
        const el = document.getElementById('currentUser');
        if (el) {
            try {
                const u = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
                el.textContent = u ? (u.user_name || u.user_id || '') : '';
            } catch (e) { el.textContent = ''; }
        }
        this.applyNavPermissions(enforceCurrent);
    },

    // 根据权限矩阵自动隐藏 nav-item，并对整组隐藏空分组标题
    applyNavPermissions(enforceCurrent = false) {
        const can = (code) => this.canAccess(code);
        const show = (el, visible) => { if (el) el.style.display = visible ? '' : 'none'; };

        // 1. 遍历所有 nav-item[data-page] —— 自动隐藏
        const items = document.querySelectorAll('#sidebar .nav-item[data-page]');
        items.forEach(el => {
            const code = el.dataset.page;
            show(el, can(code));
        });

        // 2. 整组隐藏：nav-group-title 紧跟其后的 nav-item 全部被隐藏则标题也隐藏
        const groups = document.querySelectorAll('#sidebar .nav-group-title');
        groups.forEach((g, gi) => {
            // 该分组下所有 nav-item = 下一个 group 之前的 nav-item
            const nextGroup = groups[gi + 1];
            const range = document.createRange();
            range.setStartAfter(g);
            if (nextGroup) range.setEndBefore(nextGroup);
            else {
                // 最后一个 group —— 到 sidebar 末尾
                const sidebar = document.getElementById('sidebar');
                range.setEndAfter(sidebar.lastElementChild);
            }
            const nodes = Array.from(range.cloneContents().querySelectorAll('.nav-item[data-page]'));
            const visible = nodes.filter(n => n.style.display !== 'none');
            show(g, visible.length > 0);
        });

        // 3. 当前停留页面若已无权限（例如管理员刚调整矩阵），强制跳到有权限的首个页面
        const curEl = document.querySelector('#sidebar .nav-item.active[data-page]');
        if (curEl && !can(curEl.dataset.page)) {
            const denied = curEl.dataset.page;
            const fallback = this.resolveStartPage(null);
            if (enforceCurrent && fallback && fallback !== denied && Auth.isLoggedIn()) {
                console.warn(`当前页面 ${denied} 无权限，跳转到 ${fallback}`);
                if (typeof currentPage !== 'undefined') currentPage = fallback;
                navigate(fallback);
            }
        }
    },

    // 从服务端重新拉取当前使用者权限（登入角色/权限矩阵可能已被管理员调整）
    async refreshPermissions(force = false) {
        if (!this.isLoggedIn()) return;
        const now = Date.now();
        if (!force && now - (this._lastPermSync || 0) < 30000) return;  // 30 秒节流
        this._lastPermSync = now;
        try {
            const res = await fetch('/api/auth/me');
            if (!res.ok) return;
            const j = await res.json();
            if (!j || !j.success || !j.data) return;
            localStorage.setItem(USER_KEY, JSON.stringify(j.data));
            if (j.data.role) localStorage.setItem('ermm_role', j.data.role);
            if (Array.isArray(j.data.permissions)) {
                localStorage.setItem(PERM_KEY, JSON.stringify(j.data.permissions));
            }
            this.renderUser(true);   // 重新套用导航显隐，必要时强制离开无权限页面
        } catch (e) { /* 网络异常时保留既有权限，不阻断操作 */ }
    },

    // 视窗重新获得焦点时同步权限（避免管理员改完矩阵后需重新登入）
    _bindFocusRefresh() {
        if (this._focusBound) return;
        this._focusBound = true;
        window.addEventListener('focus', () => { this.refreshPermissions(); });
    },

    // 首页选择：优先保留当前页，否则仪表板，再否则侧栏第一个有权限的模块
    resolveStartPage(pref) {
        const ok = (p) => !!(p && this.canAccess(p) && typeof pages !== 'undefined' && pages[p]);
        if (ok(pref)) return pref;
        if (ok('dashboard')) return 'dashboard';
        const el = [...document.querySelectorAll('#sidebar .nav-item[data-page]')]
            .find(e => this.canAccess(e.dataset.page) && typeof pages !== 'undefined' && pages[e.dataset.page]);
        return el ? el.dataset.page : 'dashboard';
    },

    // 登录时并行查询权限矩阵
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
        localStorage.setItem('ermm_role', data.data.role || 'general');
        localStorage.setItem(PERM_KEY, JSON.stringify(data.data.permissions || []));
        this.enterApp(data.data.user);
    },

    // 收到 401 时呼叫：清除过期 token 并回到登入画面
    handle401() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(PERM_KEY);
        localStorage.removeItem('ermm_role');
        this.showLogin();
    },

    async logout() {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
        } catch (e) { /* 无状态登出，失败也照样清除本地状态 */ }
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(PERM_KEY);
        localStorage.removeItem('ermm_role');
        const badge = document.getElementById('approvalBadge');
        if (badge) badge.style.display = 'none';
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
                if (j.data.role) localStorage.setItem('ermm_role', j.data.role);
                if (Array.isArray(j.data.permissions)) {
                    localStorage.setItem(PERM_KEY, JSON.stringify(j.data.permissions));
                }
                this.renderUser();
            }
            document.body.classList.remove('locked');
            navigate(this.resolveStartPage(currentPage || 'dashboard'));
            refreshApprovalBadge();
            this._bindFocusRefresh();
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

// ===== 审批待办角标（左侧「审批中心」） =====
async function refreshApprovalBadge() {
    const el = document.getElementById('approvalBadge');
    if (!el) return;
    if (!Auth.isLoggedIn()) { el.style.display = 'none'; return; }
    try {
        const res = await API.get('/api/workflow/summary');
        const total = Number((res.data && res.data.total) || 0);
        el.textContent = total > 99 ? '99+' : String(total);
        el.style.display = total > 0 ? '' : 'none';
    } catch (e) {
        el.style.display = 'none';
    }
}

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
    async open(kpi_id, autoAI = false) {
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
                ${autoAI ? `<div id="diagAiBox" style="margin-top:16px;border-top:1px dashed #ddd;padding-top:14px;text-align:center;">${t('diag.ai_analyzing')}</div>` : ''}
            `, `<button class="btn btn-ghost" onclick="UI.closeModal()">${t('diag.close')}</button>
                <button class="btn" onclick="Diagnosis.aiAttribution('${kpi_id}')" style="background:#6c5ce7;color:#fff;border-color:#6c5ce7;">🤖 ${t('diag.ai_attribution')}</button>
                <button class="btn btn-primary" onclick="UI.closeModal();navigate('actions')">${t('diag.create_action')}</button>`);
            if (autoAI) this.aiAttribution(kpi_id, true);
        } catch (e) {
            UI.modal(t('diag.diag_failed'), `<p style="color:#e74c3c">${e.message}</p>`, `<button class="btn btn-ghost" onclick="UI.closeModal()">${t('diag.close')}</button>`);
        }
    },

    // 红色指标一键诊断：打开异常诊断并自动执行 AI 智能归因
    async openWithAI(kpi_id) {
        return this.open(kpi_id, true);
    },

    async aiAttribution(kpi_id, inline = false) {
        const box = inline ? document.getElementById('diagAiBox') : null;
        if (inline) {
            if (box) box.innerHTML = `<div style="text-align:center;padding:16px;">${t('diag.ai_analyzing')}</div>`;
        } else {
            UI.modal(`🤖 ${kpi_id} ${t('diag.ai_attribution')}`, `<div style="text-align:center;padding:40px;">${t('diag.ai_analyzing')}</div>`, '');
        }
        try {
            const res = await API.post('/api/diagnosis/ai-attribution', {
                bu_no: State.bu_no, YYYY_MM: State.YYYY_MM, kpi_id, lang: I18N.lang
            });
            const d = res.data;
            const sugLabel = t('diag.suggestions');
            const sugHtml = (d.suggestions && d.suggestions.length)
                ? d.suggestions.map((s, i) => `<div style="background:#eaf2f8;padding:10px 12px;border-radius:6px;margin-bottom:8px;font-size:13px;"><b>${sugLabel} ${i + 1}：</b>${s}</div>`).join('')
                : `<div style="color:#999;font-size:13px;">${t('diag.no_suggestions')}</div>`;
            const body = `
                <div style="max-height:50vh;overflow-y:auto;">
                    <div style="background:#f8f9fa;padding:12px;border-radius:8px;margin-bottom:14px;border-left:4px solid #6c5ce7;">
                        <div style="white-space:pre-wrap;font-size:14px;line-height:1.7;color:#2c3e50;">${d.explanation}</div>
                    </div>
                    <div style="font-weight:700;margin-bottom:8px;">${t('diag.suggestions')}</div>
                    ${sugHtml}
                </div>
                <div style="font-size:11px;color:#95a5a6;margin-top:10px;">${t('diag.generated_by', { provider: d.provider, model: d.model })}</div>`;
            if (inline) {
                if (box) box.innerHTML = body;
            } else {
                UI.modal(`🤖 ${t('diag.ai_attribution')}`, body, `<button class="btn btn-ghost" onclick="UI.closeModal()">${t('diag.close')}</button>`);
            }
        } catch (e) {
            if (inline) {
                if (box) box.innerHTML = `<p style="color:#e74c3c;font-size:13px;">${t('diag.ai_failed')}：${e.message}</p>`;
            } else {
                UI.modal(t('diag.ai_failed'), `<p style="color:#e74c3c">${e.message}</p>`, `<button class="btn btn-ghost" onclick="UI.closeModal()">${t('diag.close')}</button>`);
            }
        }
    }
};

// ===== 页面管理 =====
const pages = {};
function registerPage(id, fn) { pages[id] = fn; }

async function navigate(pageId, params = {}) {
    const fn = pages[pageId];
    if (!fn) return;
    // 权限拦截：无权限时改跳有权限的首页
    if (typeof Auth !== 'undefined' && !Auth.canAccess(pageId)) {
        const fallback = Auth.resolveStartPage(null);
        UI.toast(I18N.lang === 'en' ? 'No permission to access this module'
            : (I18N.lang === 'zh-TW' ? '無權限存取此功能模組' : '无权限访问此功能模块'), 'error');
        if (fallback && fallback !== pageId) return navigate(fallback, params);
        return;
    }
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
    YYYY_MM: new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'),
    // 畫面最上方的全域年度（YYYY_MM 前 4 碼）；各頁面初次載入一律以此為準
    year() {
        const y = parseInt(String(this.YYYY_MM || '').slice(0, 4), 10);
        return isNaN(y) ? new Date().getFullYear() : y;
    },
    // 全域月份（YYYY_MM 後 2 碼，補零）
    mm() {
        const m = parseInt(String(this.YYYY_MM || '').slice(5, 7), 10);
        return isNaN(m) ? String(new Date().getMonth() + 1).padStart(2, '0') : String(m).padStart(2, '0');
    }
};

// ===== 語言感知日期格式化 + 原生日期輸入框顯示覆蓋 =====
// 原生 <input type="month/date"> 的顯示格式由瀏覽器/系統本地化決定，不隨頁面語言變化；
// 英文語系下以覆蓋層顯示英文格式（如 Nov 2026），中文語系維持原生顯示。
const DateLocale = {
    _lang() { return (typeof I18N !== 'undefined' && I18N.lang) || 'zh-CN'; },
    _intlLang() {
        const l = this._lang();
        return l === 'en' ? 'en-US' : (l === 'zh-TW' ? 'zh-TW' : 'zh-CN');
    },
    parseDate(v) {
        if (v == null || v === '') return null;
        if (v instanceof Date) return isNaN(v) ? null : v;
        const s = String(v);
        const m = s.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?/);
        if (m) return new Date(+m[1], +m[2] - 1, m[3] ? +m[3] : 1);
        const d = new Date(s);
        return isNaN(d) ? null : d;
    },
    // 年月：zh → 2026年11月，en → Nov 2026
    fmtYM(v) {
        const d = this.parseDate(v);
        if (!d) return '';
        try { return new Intl.DateTimeFormat(this._intlLang(), { year: 'numeric', month: 'short' }).format(d); }
        catch (e) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
    },
    // 日期：zh → 2026年11月19日，en → Nov 19, 2026
    fmtDate(v) {
        const d = this.parseDate(v);
        if (!d) return '-';
        try { return new Intl.DateTimeFormat(this._intlLang(), { year: 'numeric', month: 'short', day: 'numeric' }).format(d); }
        catch (e) { return String(v).substring(0, 10); }
    },
    // 日期時間
    fmtDateTime(v) {
        const d = this.parseDate(v);
        if (!d) return '-';
        try { return new Intl.DateTimeFormat(this._intlLang(), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d); }
        catch (e) { return String(v); }
    },
    // 時間
    fmtTime(v) {
        const d = this.parseDate(v) || new Date();
        try { return new Intl.DateTimeFormat(this._intlLang(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d); }
        catch (e) { return d.toLocaleTimeString(); }
    },
    _needOverlay() { return this._lang() === 'en'; },

    _ensureWrap(input) {
        if (input.parentElement && input.parentElement.classList.contains('di-wrap')) return input.parentElement;
        const wrap = document.createElement('span');
        wrap.className = 'di-wrap';
        const cs = getComputedStyle(input);
        wrap.style.cssText = 'position:relative;display:' + (cs.display === 'block' ? 'block' : 'inline-block') + ';';
        // 複製輸入框寬度，避免包一層後跑版
        const w = input.style.width || cs.width;
        if (w && w !== 'auto') wrap.style.width = w;
        else if (input.offsetWidth) wrap.style.width = input.offsetWidth + 'px';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
        const overlay = document.createElement('span');
        overlay.className = 'di-overlay';
        wrap.appendChild(overlay);
        return wrap;
    },
    _updateOne(input) {
        const wrap = this._ensureWrap(input);
        const overlay = wrap.querySelector('.di-overlay');
        if (!overlay) return;
        const type = input.type;
        const val = input.value;
        const cs = getComputedStyle(input);
        overlay.style.cssText = 'position:absolute;left:' + cs.paddingLeft + ';top:0;bottom:0;display:flex;align-items:center;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:' + cs.fontSize + ';font-family:' + cs.fontFamily + ';font-weight:' + cs.fontWeight + ';';
        if (val) {
            // 注意：英文模式 input 已被設為 color:transparent，覆蓋層不能繼承該透明色，否則文字看不見
            overlay.style.color = '#333';
            overlay.textContent = type === 'month' ? this.fmtYM(val) : this.fmtDate(val);
        } else {
            overlay.style.color = '#999';
            overlay.textContent = type === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD';
        }
    },
    _removeOverlay(input) {
        const wrap = input.parentElement;
        if (wrap && wrap.classList.contains('di-wrap')) {
            const parent = wrap.parentNode;
            while (wrap.firstChild) parent.insertBefore(wrap.firstChild, wrap);
            parent.removeChild(wrap);
        }
    },
    refreshAll() {
        const inputs = document.querySelectorAll('input[type="month"], input[type="date"]');
        inputs.forEach(input => {
            if (this._needOverlay()) {
                input.classList.add('di-en');
                try { this._updateOne(input); } catch (e) { /* ignore layout edge cases */ }
            } else {
                input.classList.remove('di-en');
                this._removeOverlay(input);
            }
        });
    },

    // ===== 自訂英文日期/月份彈層（取代瀏覽器原生中文彈出）=====
    _monthsShort: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
    _daysShort: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],
    _btnStyle: 'border:none;background:#f5f5f5;color:#333;padding:8px 6px;border-radius:4px;cursor:pointer;font-size:13px;',
    _navBtnStyle: 'border:none;background:none;color:#2980b9;cursor:pointer;font-size:18px;padding:0 8px;font-weight:bold;',
    _getPopup() {
        let p = document.getElementById('di-popup');
        if (!p) {
            p = document.createElement('div');
            p.id = 'di-popup';
            document.body.appendChild(p);
            const self = this;
            p.addEventListener('click', (e) => self._onPopupClick(e));
        }
        return p;
    },
    _closePopup() {
        const p = document.getElementById('di-popup');
        if (p) { p.style.display = 'none'; p._input = null; }
    },
    _positionPopup(input) {
        const p = this._getPopup();
        if (p.style.display === 'none') return;
        const r = input.getBoundingClientRect();
        const sx = window.scrollX, sy = window.scrollY;
        let top = r.bottom + sy + 4;
        const left = Math.max(8, Math.min(r.left + sx, sx + window.innerWidth - p.offsetWidth - 8));
        if (top + p.offsetHeight > sy + window.innerHeight - 8 && r.top + sy - p.offsetHeight - 4 > 0) {
            top = r.top + sy - p.offsetHeight - 4;
        }
        p.style.top = top + 'px';
        p.style.left = left + 'px';
    },
    _openPopup(input) {
        const p = this._getPopup();
        p._input = input;
        p.style.display = 'block';
        const cur = this.parseDate(input.value) || new Date();
        if (input.type === 'month') {
            p._year = cur.getFullYear();
            this._renderMonth(input);
        } else {
            p._year = cur.getFullYear(); p._month = cur.getMonth();
            this._renderDate(input);
        }
        this._positionPopup(input);
    },
    _renderMonth(input) {
        const p = this._getPopup();
        const cur = this.parseDate(input.value);
        const selY = cur ? cur.getFullYear() : null, selM = cur ? cur.getMonth() : null;
        let html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">'
            + '<button data-act="prev" style="' + this._navBtnStyle + '">‹</button>'
            + '<span style="font-weight:bold;font-size:14px;">' + p._year + '</span>'
            + '<button data-act="next" style="' + this._navBtnStyle + '">›</button>'
            + '</div>'
            + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;width:230px;">';
        for (let i = 0; i < 12; i++) {
            const sel = (selY === p._year && selM === i) ? 'background:#2980b9;color:#fff;' : '';
            html += '<button data-month="' + i + '" style="' + this._btnStyle + sel + '">' + this._monthsShort[i] + '</button>';
        }
        html += '</div><div style="display:flex;justify-content:space-between;margin-top:8px;border-top:1px solid #eee;padding-top:6px;">'
            + '<button data-act="clear" style="border:none;background:none;color:#2980b9;cursor:pointer;font-size:12px;">Clear</button>'
            + '<button data-act="today" style="border:none;background:none;color:#2980b9;cursor:pointer;font-size:12px;">This Month</button>'
            + '</div>';
        p.innerHTML = html;
        this._positionPopup(input);
    },
    _renderDate(input) {
        const p = this._getPopup();
        const y = p._year, m = p._month;
        const first = new Date(y, m, 1).getDay();
        const days = new Date(y, m + 1, 0).getDate();
        const cur = this.parseDate(input.value);
        const selY = cur ? cur.getFullYear() : null, selM = cur ? cur.getMonth() : null, selD = cur ? cur.getDate() : null;
        let html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">'
            + '<button data-act="prev" style="' + this._navBtnStyle + '">‹</button>'
            + '<span style="font-weight:bold;font-size:14px;">' + this._monthsShort[m] + ' ' + y + '</span>'
            + '<button data-act="next" style="' + this._navBtnStyle + '">›</button>'
            + '</div>'
            + '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;width:230px;">';
        this._daysShort.forEach(d => { html += '<div style="text-align:center;font-size:11px;color:#888;padding:4px 0;">' + d + '</div>'; });
        for (let i = 0; i < first; i++) html += '<div></div>';
        for (let d = 1; d <= days; d++) {
            const sel = (selY === y && selM === m && selD === d) ? 'background:#2980b9;color:#fff;' : '';
            html += '<button data-day="' + d + '" style="border:none;background:#f5f5f5;color:#333;padding:6px 0;border-radius:4px;cursor:pointer;font-size:12px;' + sel + '">' + d + '</button>';
        }
        html += '</div><div style="display:flex;justify-content:space-between;margin-top:6px;border-top:1px solid #eee;padding-top:6px;">'
            + '<button data-act="clear" style="border:none;background:none;color:#2980b9;cursor:pointer;font-size:12px;">Clear</button>'
            + '<button data-act="today" style="border:none;background:none;color:#2980b9;cursor:pointer;font-size:12px;">Today</button>'
            + '</div>';
        p.innerHTML = html;
        this._positionPopup(input);
    },
    _onPopupClick(e) {
        const btn = e.target.closest ? e.target.closest('button') : null;
        if (!btn) return;
        e.stopPropagation();
        const p = this._getPopup();
        const input = p._input;
        if (!input) return;
        const act = btn.getAttribute('data-act');
        if (act === 'prev') {
            if (input.type === 'month') { p._year--; this._renderMonth(input); }
            else { if (--p._month < 0) { p._month = 11; p._year--; } this._renderDate(input); }
            return;
        }
        if (act === 'next') {
            if (input.type === 'month') { p._year++; this._renderMonth(input); }
            else { if (++p._month > 11) { p._month = 0; p._year++; } this._renderDate(input); }
            return;
        }
        if (act === 'clear') { input.value = ''; input.dispatchEvent(new Event('change', { bubbles: true })); this._updateOne(input); this._closePopup(); return; }
        if (act === 'today') {
            const n = new Date();
            if (input.type === 'month') input.value = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0');
            else input.value = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
            input.dispatchEvent(new Event('change', { bubbles: true })); this._updateOne(input); this._closePopup(); return;
        }
        if (btn.hasAttribute('data-month')) {
            const m = +btn.getAttribute('data-month');
            input.value = p._year + '-' + String(m + 1).padStart(2, '0');
            input.dispatchEvent(new Event('change', { bubbles: true })); this._updateOne(input); this._closePopup(); return;
        }
        if (btn.hasAttribute('data-day')) {
            const d = +btn.getAttribute('data-day');
            input.value = p._year + '-' + String(p._month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
            input.dispatchEvent(new Event('change', { bubbles: true })); this._updateOne(input); this._closePopup(); return;
        }
    }
};

// 注入覆蓋層與彈層所需樣式（隱藏英文模式下原生輸入框的中文渲染值，保留日曆圖標；彈層全英文）
(function () {
    if (document.getElementById('di-en-style')) return;
    const style = document.createElement('style');
    style.id = 'di-en-style';
    style.textContent = [
        'input.di-en { color: transparent !important; caret-color: #333; }',
        'input.di-en::-webkit-datetime-edit, input.di-en::-webkit-datetime-edit-fields-wrapper { color: transparent !important; }',
        'input.di-en::-webkit-calendar-picker-indicator { cursor: pointer; opacity: 1; }',
        '.di-wrap { position: relative; }',
        '.di-overlay { position: absolute; pointer-events: none; }',
        '#di-popup { position: absolute; z-index: 99999; background: #fff; border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.2); padding: 10px; display: none; font-family: Arial, sans-serif; color: #333; }',
        '#di-popup button:hover { filter: brightness(0.95); }'
    ].join('\n');
    document.head.appendChild(style);
})();

// 監聽頁面動態渲染（切頁、開彈窗）與使用者選取日期，即時更新覆蓋層；
// 英文模式下以自訂彈層取代瀏覽器原生中文日期彈出。
(function () {
    let timer = null;
    const schedule = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => DateLocale.refreshAll(), 60);
    };
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('change', (e) => {
        const t = e.target;
        if (t && (t.type === 'month' || t.type === 'date')) DateLocale.refreshAll();
    }, true);
    document.addEventListener('input', (e) => {
        const t = e.target;
        if (t && (t.type === 'month' || t.type === 'date')) { try { DateLocale._updateOne(t); } catch (err) {} }
    }, true);
    window.addEventListener('resize', schedule);

    // 點擊英文日期輸入框 → 阻止原生彈出、開啟自訂英文彈層
    document.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.tagName === 'INPUT' && (t.type === 'month' || t.type === 'date') && t.classList.contains('di-en')) {
            e.preventDefault();
            e.stopPropagation();
            DateLocale._openPopup(t);
        }
    }, true);
    // 點彈層外部 / 按 Esc / 滾動 → 關閉彈層
    document.addEventListener('click', (e) => {
        const p = document.getElementById('di-popup');
        if (!p || p.style.display === 'none') return;
        if (p.contains(e.target)) return;
        if (e.target.classList && e.target.classList.contains('di-en')) return;
        DateLocale._closePopup();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') DateLocale._closePopup(); });
    window.addEventListener('scroll', () => DateLocale._closePopup(), true);
})();
