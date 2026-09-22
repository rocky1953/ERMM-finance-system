/**
 * JWT 認證中介層
 *
 * 流程：
 *   前端登入成功後取得 token，之後所有 /api/* 請求帶：
 *     Authorization: Bearer <token>
 *   本中介層驗證簽章與有效期，通過後把 req.user = { user_id } 交給後續路由。
 *
 * 排除：/api/auth/login、/api/health
 * 測試環境（NODE_ENV=test）自動放行，既有整合測試不需帶 token。
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'ermm_finance_secret_key_2026';
const TOKEN_EXPIRES = '8h'; // 登入有效期 8 小時

function signToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRES });
}

function authRequired(req, res, next) {
    // 測試環境放行（Jest 整合測試直接打 API）
    if (process.env.NODE_ENV === 'test') return next();

    // 白名單
    if (req.path === '/auth/login' || req.path === '/health') return next();

    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) {
        return res.status(401).json({
            success: false, code: 'NO_TOKEN', message: '尚未登入，請先登入系統'
        });
    }
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        const code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
        return res.status(401).json({
            success: false, code,
            message: code === 'TOKEN_EXPIRED' ? '登入已過期，請重新登入' : '登入驗證無效，請重新登入'
        });
    }
}

// 管理員權限中介層：必須在 authRequired 之後使用（依賴 req.user）
// cams_xuser.admin 值為「管理員」或「普通者」
// 測試環境（NODE_ENV=test）自動放行，既有整合測試不需帶 token
function requireAdmin(req, res, next) {
    if (process.env.NODE_ENV === 'test') return next();
    if (req.user && req.user.admin === '管理員') return next();
    return res.status(403).json({
        success: false, code: 'FORBIDDEN',
        message: '你的權限不足，無法進入該功能'
    });
}

module.exports = { authRequired, requireAdmin, signToken, JWT_SECRET };
