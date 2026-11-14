/**
 * 功能模块使用权限 (cams_module_permission)
 * 三角色：一般 / 操作员 / 管理员
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');

// ===== 获取所有模块权限矩阵（含分组）=====
router.get('/matrix', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT * FROM cams_module_permission ORDER BY sort_order, module_code'
        );
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ===== 按分组聚合 =====
router.get('/groups', async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT module_group, COUNT(*) cnt,
                   SUM(allow_general) general_cnt,
                   SUM(allow_operator) operator_cnt,
                   SUM(allow_admin) admin_cnt
            FROM cams_module_permission
            GROUP BY module_group
            ORDER BY MIN(sort_order)
        `);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ===== 更新单个模块的角色权限 =====
// body: { allow_general: 0/1, allow_operator: 0/1, allow_admin: 0/1 }
router.post('/module/:module_code', async (req, res) => {
    try {
        const { allow_general, allow_operator, allow_admin } = req.body;
        const updates = [];
        const values = [];
        if (typeof allow_general === 'number' || typeof allow_general === 'boolean') {
            updates.push('allow_general=?'); values.push(allow_general ? 1 : 0);
        }
        if (typeof allow_operator === 'number' || typeof allow_operator === 'boolean') {
            updates.push('allow_operator=?'); values.push(allow_operator ? 1 : 0);
        }
        if (typeof allow_admin === 'number' || typeof allow_admin === 'boolean') {
            updates.push('allow_admin=?'); values.push(allow_admin ? 1 : 0);
        }
        if (!updates.length) return fail(res, '无更新字段', 400);
        values.push(req.params.module_code);
        const [r] = await pool.execute(
            `UPDATE cams_module_permission SET ${updates.join(',')}, update_time=NOW() WHERE module_code=?`,
            values
        );
        if (r.affectedRows === 0) return fail(res, '模块不存在', 404);
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

// ===== 批量更新（列头全选/反选场景）=====
// body: { role: 'general'|'operator'|'admin', enabled: 0|1, module_codes: [...] }
//   或 { role: 'general', enabled: 1, group_code: '经营决策' }
router.post('/batch', async (req, res) => {
    try {
        const { role, enabled, module_codes, group_code } = req.body;
        const roleMap = { general: 'allow_general', operator: 'allow_operator', admin: 'allow_admin' };
        const col = roleMap[role];
        if (!col) return fail(res, 'role 无效，需为 general/operator/admin', 400);
        const val = enabled ? 1 : 0;

        if (Array.isArray(module_codes) && module_codes.length) {
            const placeholders = module_codes.map(() => '?').join(',');
            await pool.execute(
                `UPDATE cams_module_permission SET ${col}=?, update_time=NOW() WHERE module_code IN (${placeholders})`,
                [val, ...module_codes]
            );
            ok(res, null, `已更新 ${module_codes.length} 个模块`);
        } else if (group_code) {
            const [r] = await pool.execute(
                `UPDATE cams_module_permission SET ${col}=?, update_time=NOW() WHERE module_group=?`,
                [val, group_code]
            );
            ok(res, null, `已更新分组「${group_code}」${r.affectedRows} 个模块`);
        } else {
            return fail(res, '需提供 module_codes 或 group_code', 400);
        }
    } catch (err) { fail500(res, err); }
});

// ===== 根据用户 ID 获取允许的模块码列表（登录时调用）=====
router.get('/user/:user_id', async (req, res) => {
    try {
        const [[u]] = await pool.execute(
            'SELECT admin, xuser_type FROM cams_xuser WHERE xuser_id=? LIMIT 1',
            [req.params.user_id]
        );
        if (!u) return fail(res, '用户不存在', 404);

        // 判断角色
        const isAdmin = (u.admin === 'Yes');
        const isOperator = /主管|經理|经理/.test(u.xuser_type || '');
        // admin 硬编码全权限，无需查表
        let roleCol = 'allow_general';
        if (isAdmin) roleCol = 'allow_admin';
        else if (isOperator) roleCol = 'allow_operator';

        const [rows] = await pool.execute(
            `SELECT module_code FROM cams_module_permission WHERE ${roleCol}=1`
        );
        ok(res, {
            role: isAdmin ? 'admin' : (isOperator ? 'operator' : 'general'),
            is_admin: isAdmin,
            permissions: rows.map(r => r.module_code)
        });
    } catch (err) { fail500(res, err); }
});

module.exports = router;
