/**
 * ERMM 前端核心框架
 */

// ===== 登入驗證模組 =====
const TOKEN_KEY = 'ermm_token';
const USER_KEY = 'ermm_user';
const Auth = {
    getToken() { return localStorage.getItem(TOKEN_KEY) || ''; },
    isLoggedIn() { return !!this.getToken(); },

    // 讀取登入 session（user_id / user_name / admin）
    getUser() {
        try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
        catch (e) { return null; }
    },
    // 是否為管理員（cams_xuser.admin === '管理員'）
    isAdmin() {
        const u = this.getUser();
        return !!(u && u.admin === '管理員');
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
        if (!el) return;
        try {
            const u = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
            el.textContent = u ? (u.user_name || u.user_id || '') : '';
        } catch (e) { el.textContent = ''; }
    },

    async login(user_id, password) {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id, password })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.message || '登入失敗');
        }
        localStorage.setItem(TOKEN_KEY, data.data.token);
        localStorage.setItem(USER_KEY, JSON.stringify(data.data.user));
        this.enterApp(data.data.user);
    },

    // 收到 401 時呼叫：清除過期 token 並回到登入畫面
    handle401() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        this.showLogin();
    },

    async logout() {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
        } catch (e) { /* 無狀態登出，失敗也照樣清除本地狀態 */ }
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        this.showLogin();
    },

    // 啟動時檢查既有 token 是否仍有效
    async init() {
        this.renderUser();
        if (!this.getToken()) { this.showLogin(); return; }
        try {
            const res = await fetch('/api/auth/me');
            if (!res.ok) throw new Error('token invalid');
            // 以資料庫最新資料同步本地 session（含 admin 身分）
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

// ===== 全域 fetch 注入 JWT（涵蓋所有頁面直接呼叫 fetch 的場景）=====
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
            // 登入請求本身的 401 交給表單處理，其餘 401 → 登入逾時
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
            // 帶 JWT 的檔案下載（fetch blob），避免 window.open 無法帶 Authorization
            const res = await fetch(u);
            if (res.status === 401) { Auth.handle401(); throw new Error('未登入或登入已過期'); }
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

// ===== 頁面管理 =====
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

// ===== 全局状态 =====
const State = {
    bu_no: 'HM',
    YYYY_MM: new Date().getFullYear() + '/' + String(new Date().getMonth() + 1).padStart(2, '0')
};
