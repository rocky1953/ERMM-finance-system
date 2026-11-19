/**
 * JWT 認證中介層 + CTO-02 角色/按鈕/數據範圍擴展
 *
 * 擴展後 req.user 結構：
 *   { user_id, admin, xuser_type, bu_no, xuser_dept, role }
 *
 * role 判斷：
 *   admin    — cams_xuser.admin = 'Yes'
 *   operator — xuser_type 含 "主管/經理/经理" 或 admin = 'Operator'
 *   general  — 其餘
 *
 * 數據範圍（data scope）：
 *   透過 cams_data_scope 表配置。auth middleware 讀取後寫入
 *   req.dataScope = { scope_type, scope_bus, scope_depts }
 *   業務路由按需拼接 WHERE 條件。
 */
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'ermm_finance_secret_key_2026';
const TOKEN_EXPIRES = '8h';

// 角色判斷（從 cams_xuser 記錄推斷）
function resolveRole(xuser) {
    if (!xuser) return 'general';
    if (xuser.admin === 'Yes') return 'admin';
    if (xuser.admin === 'Operator') return 'operator';
    if (/主管|經理|经理|總經理|总经理/.test(xuser.xuser_type || '')) return 'operator';
    return 'general';
}

function signToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRES });
}

/**
 * 用 JWT 解出 user_id，然後查 cams_xuser 補全完整用户信息。
 * 這樣後續所有 middleware/路由都有統一的 req.user 結構。
 */
async function hydrateUser(userId) {
    const [rows] = await pool.execute(
        `SELECT xuser_id, admin, xuser_type, client_id, xuser_dept, xuser_name
         FROM cams_xuser WHERE xuser_id=? LIMIT 1`,
        [userId]
    );
    const u = rows[0] || {};
    const role = resolveRole(u);

    // 查 data scope
    let scopeType = 'OWN_BU';
    let scopeBus = null;
    let scopeDepts = null;
    try {
        const [scopes] = await pool.execute(
            `SELECT scope_type, bu_list, dept_list FROM cams_data_scope
             WHERE role_code=? AND (module_code='*' OR module_code=?)
             ORDER BY module_code='*' LIMIT 1`,
            [role, '*']   // '*' = 全局預設，模組級覆蓋後續可擴展
        );
        if (scopes[0]) {
            scopeType = scopes[0].scope_type;
            scopeBus = scopes[0].bu_list ? JSON.parse(scopes[0].bu_list) : null;
            scopeDepts = scopes[0].dept_list ? JSON.parse(scopes[0].dept_list) : null;
        }
    } catch (e) { /* data_scope 表不存在時 fallback */ }

    return {
        user_id: userId,
        admin: u.admin || 'No',
        xuser_type: u.xuser_type || '',
        bu_no: u.client_id || '',
        xuser_dept: u.xuser_dept || '',
        xuser_name: u.xuser_name || '',
        role,
        // data scope 預計算
        dataScope: {
            type: scopeType,
            allowedBus:
                scopeType === 'ALL' ? null :
                scopeType === 'OWN_BU' ? (u.client_id ? [u.client_id] : []) :
                scopeType === 'OWN_DEPT' ? [] :
                scopeBus,
            allowedDept: scopeDepts
        }
    };
}

/**
 * 主认证 middleware：JWT → hydrateUser → req.user 完整結構
 */
async function authRequired(req, res, next) {
    // 白名單
    if (req.path === '/auth/login' || req.path === '/health') return next();

    // 測試環境
    if (process.env.NODE_ENV === 'test') {
        const header = req.headers.authorization || '';
        let uid = process.env.TEST_USER_ID || 'rocky';
        if (header.startsWith('Bearer ')) {
            try { const p = jwt.verify(header.slice(7).trim(), JWT_SECRET); uid = p.user_id; } catch (e) { /* ignore */ }
        }
        req.user = await hydrateUser(uid);
        if (!req.user.role) req.user.role = 'admin';
        return next();
    }

    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) {
        return res.status(401).json({ success: false, code: 'NO_TOKEN', message: '尚未登入，請先登入系統' });
    }
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        req.user = await hydrateUser(payload.user_id);
        next();
    } catch (err) {
        const code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
        return res.status(401).json({ success: false, code,
            message: code === 'TOKEN_EXPIRED' ? '登入已過期，請重新登入' : '登入驗證無效，請重新登入' });
    }
}

/**
 * 管理員權限：admin='Yes'
 */
function requireAdmin(req, res, next) {
    if (process.env.NODE_ENV === 'test') return next();
    if (req.user && req.user.admin === 'Yes') return next();
    return res.status(403).json({ success: false, code: 'FORBIDDEN', message: '你的權限不足，無法進入該功能' });
}

/**
 * 按鈕權限：檢查當前角色對 module_code 的 button_code 是否允許
 * 用法：router.post('/xxx', requireButton('closing', 'CLOSE'), ...)
 */
function requireButton(moduleCode, buttonCode) {
    return async (req, res, next) => {
        if (process.env.NODE_ENV === 'test') return next();
        if (!req.user) return res.status(401).json({ success: false, code: 'NO_AUTH', message: '尚未登入' });

        const role = req.user.role || resolveRole(req.user);
        const roleCol = role === 'admin' ? 'allow_admin' : role === 'operator' ? 'allow_operator' : 'allow_general';

        try {
            const [rows] = await pool.execute(
                `SELECT ${roleCol} as allowFlag FROM cams_permission_button
                 WHERE module_code=? AND button_code=? LIMIT 1`,
                [moduleCode, buttonCode]
            );
            // 沒配置按鈕 → 容許 admin/operator，general 禁止（保守策略）
            if (!rows[0]) {
                if (role === 'general') {
                    return res.status(403).json({ success: false, code: 'BUTTON_DENIED',
                        message: `你沒有權限執行 ${buttonCode} 操作` });
                }
                return next();
            }
            if (rows[0].allowFlag !== 1) {
                return res.status(403).json({ success: false, code: 'BUTTON_DENIED',
                    message: `你沒有權限執行 ${buttonCode} 操作` });
            }
            next();
        } catch (e) {
            res.status(500).json({ success: false, code: 'PERM_CHECK_ERR', message: e.message });
        }
    };
}

/**
 * 數據範圍注入：給 req.dataScope 寫入當前用戶可訪問的 bu_no 列表
 * 之後業務路由可以用 req.dataScope.allowedBus 拼接 WHERE 條件
 * 用法：router.get('/list', injectDataScope('consolidation'), ...)
 *   → 路由裡：WHERE bu_no IN (?) 傳 req.dataScope.allowedBus
 */
function injectDataScope(moduleCode) {
    return async (req, res, next) => {
        if (!req.user) return next();

        const role = req.user.role || resolveRole(req.user);

        // 優先查模組級覆蓋，fallback 到 '*' 全局預設
        try {
            const [rows] = await pool.execute(
                `SELECT scope_type, bu_list, dept_list FROM cams_data_scope
                 WHERE role_code=? AND (module_code=? OR module_code='*')
                 ORDER BY CASE WHEN module_code='*' THEN 1 ELSE 0 END, id ASC
                 LIMIT 1`,
                [role, moduleCode]
            );
            if (rows[0]) {
                let scope = rows[0].scope_type;
                let bus = rows[0].bu_list ? JSON.parse(rows[0].bu_list) : null;
                let depts = rows[0].dept_list ? JSON.parse(rows[0].dept_list) : null;

                if (scope === 'ALL') {
                    req.dataScope = { type: 'ALL', allowedBus: null, allowedDept: null };
                } else if (scope === 'OWN_BU') {
                    req.dataScope = { type: 'OWN_BU',
                        allowedBus: req.user.bu_no ? [req.user.bu_no] : [],
                        allowedDept: null };
                } else if (scope === 'OWN_DEPT') {
                    req.dataScope = { type: 'OWN_DEPT',
                        allowedBus: null,
                        allowedDept: req.user.xuser_dept ? [req.user.xuser_dept] : [] };
                } else if (scope === 'CUSTOM') {
                    req.dataScope = { type: 'CUSTOM',
                        allowedBus: bus, allowedDept: depts };
                }
                return next();
            }
        } catch (e) { /* fallback */ }

        // 沒有配置：admin/operator=ALL，general=OWN_BU
        if (role === 'admin' || role === 'operator') {
            req.dataScope = { type: 'ALL', allowedBus: null, allowedDept: null };
        } else {
            req.dataScope = { type: 'OWN_BU',
                allowedBus: req.user.bu_no ? [req.user.bu_no] : [], allowedDept: null };
        }
        next();
    };
}

/**
 * 行級過濾器：給定 SQL 查詢和 params，自動追加 WHERE bu_no IN (...) 條件
 * 只在查詢不含 bu_no 過濾時追加，避免重複
 * 用法：router.get('/list', injectDataScope('fx'), async (req,res)=>{
 *   let sql = "SELECT * FROM fx_exposure WHERE 1=1";
 *   let params = [];
 *   ({ sql, params } = applyDataScope(sql, params, req, 'bu_no'));
 *   const [rows] = await pool.execute(sql, params);
 * });
 */
function applyDataScope(sql, params, req, col = 'bu_no') {
    if (!req.dataScope) return { sql, params };
    if (req.dataScope.type === 'ALL' || req.dataScope.allowedBus === null) return { sql, params };

    const list = req.dataScope.allowedBus;
    if (!list.length) {
        // 空 = 沒數據權限 → 返回 1=0 讓查詢結果為空
        return { sql: sql + ' AND 1=0', params };
    }

    // 防止重複追加：查詢裡已有 bu_no IN 就不追加
    if (new RegExp(`\\b${col}\\s*(IN|=)`, 'i').test(sql)) return { sql, params };

    const ph = list.map(() => '?').join(',');
    return {
        sql: sql + ` AND ${col} IN (${ph})`,
        params: [...params, ...list]
    };
}

module.exports = {
    authRequired, requireAdmin, signToken, JWT_SECRET,
    resolveRole, hydrateUser, requireButton, injectDataScope, applyDataScope
};