/**
 * 認證路由
 *  POST /api/auth/login  { user_id, password } → { token, user }
 *  GET  /api/auth/me     驗證 token 並回傳當前使用者
 *  POST /api/auth/logout 無狀態 JWT，前端清除 token 即可（此端點保留對稱性）
 *
 * 驗證資料來源：cams_xuser 表（與「使用者管理」畫面同一張表）
 *   - xuser_id       使用者 ID（登入帳號）
 *   - xuser_name     使用者姓名
 *   - xuser_password SHA-256 hex 密碼（與 routes/user.js hashPwd 一致）
 *   - inuse_flag     USE=啟用 / NOUSE=停用
 *   - admin          管理員 / 普通者
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { pool } = require('../config/db');
const { ok, fail } = require('../utils/response');
const { signToken, authRequired } = require('../middleware/auth');

// 密碼雜湊規則必須與 routes/user.js 的 hashPwd 完全一致
function hashPwd(pwd) {
    return crypto.createHash('sha256').update(String(pwd)).digest('hex').toLowerCase();
}

// 登入
router.post('/login', async (req, res) => {
    try {
        const user_id = String(req.body.user_id || '').trim();
        const password = String(req.body.password || '');
        if (!user_id || !password) {
            return fail(res, '請輸入使用者 ID 與密碼', 400);
        }

        const [rows] = await pool.execute(
            'SELECT xuser_id, xuser_name, xuser_password, inuse_flag, admin FROM cams_xuser WHERE xuser_id=? LIMIT 1',
            [user_id]
        );

        // 相同的失敗訊息，避免透露帳號是否存在
        const invalidMsg = '使用者 ID 或密碼錯誤';
        if (rows.length === 0) return fail(res, invalidMsg, 401);

        const user = rows[0];
        if (user.inuse_flag && user.inuse_flag !== 'USE') {
            return fail(res, '此帳號已停用，請聯絡系統管理員', 403);
        }

        if (hashPwd(password) !== String(user.xuser_password || '').toLowerCase()) {
            return fail(res, invalidMsg, 401);
        }

        const token = signToken({ user_id: user.xuser_id, admin: user.admin || '普通者' });

        ok(res, {
            token,
            user: {
                user_id: user.xuser_id,
                user_name: user.xuser_name || user.xuser_id,
                admin: user.admin || '普通者'
            }
        }, '登入成功');
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: '登入服務異常，請稍後再試' });
    }
});

// 取得目前使用者（需帶有效 token）
router.get('/me', authRequired, async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT xuser_id, xuser_name, inuse_flag, admin FROM cams_xuser WHERE xuser_id=? LIMIT 1',
            [req.user.user_id]
        );
        if (rows.length === 0) return fail(res, '使用者不存在', 404);
        const u = rows[0];
        if (u.inuse_flag && u.inuse_flag !== 'USE') {
            return fail(res, '此帳號已停用', 403);
        }
        ok(res, {
            user_id: u.xuser_id,
            user_name: u.xuser_name || u.xuser_id,
            admin: u.admin || '普通者'
        });
    } catch (err) {
        res.status(500).json({ success: false, message: '服務異常' });
    }
});

// 登出（JWT 無狀態：主要由前端刪除本地 token）
router.post('/logout', authRequired, (req, res) => {
    ok(res, { logged_out: true }, '已登出');
});

module.exports = router;
