/**
 * 功能模块使用权限 (cams_module_permission)
 * 三角色：一般 / 操作员 / 管理员
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const audit = require('../services/audit');

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
        // 先查旧值（审计需要 before 快照）
        const [oldRows] = await pool.execute(
            'SELECT * FROM cams_module_permission WHERE module_code=?', [req.params.module_code]
        );
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

        // === 显式审计 ===
        const after = {
            allow_general: allow_general ?? oldRows[0]?.allow_general,
            allow_operator: allow_operator ?? oldRows[0]?.allow_operator,
            allow_admin: allow_admin ?? oldRows[0]?.allow_admin
        };
        audit.log(req, {
            module: 'permission',
            action: 'UPDATE',
            businessType: 'PERM-MATRIX',
            businessId: req.params.module_code,
            summary: `更新模块权限 ${req.params.module_code}: general=${after.allow_general} operator=${after.allow_operator} admin=${after.allow_admin}`,
            before: oldRows[0],
            after
        });

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
        const roleLabel = { general: '一般', operator: '操作员', admin: '管理员' };
        const col = roleMap[role];
        if (!col) return fail(res, 'role 无效，需为 general/operator/admin', 400);
        const val = enabled ? 1 : 0;

        let count = 0;
        let targetDesc = '';
        if (Array.isArray(module_codes) && module_codes.length) {
            const placeholders = module_codes.map(() => '?').join(',');
            await pool.execute(
                `UPDATE cams_module_permission SET ${col}=?, update_time=NOW() WHERE module_code IN (${placeholders})`,
                [val, ...module_codes]
            );
            count = module_codes.length;
            targetDesc = `模块[${module_codes.join(',')}]`;
        } else if (group_code) {
            const [r] = await pool.execute(
                `UPDATE cams_module_permission SET ${col}=?, update_time=NOW() WHERE module_group=?`,
                [val, group_code]
            );
            count = r.affectedRows;
            targetDesc = `分组「${group_code}」`;
        } else {
            return fail(res, '需提供 module_codes 或 group_code', 400);
        }

        // === 显式审计 ===
        audit.log(req, {
            module: 'permission',
            action: 'UPDATE',
            businessType: 'PERM-BATCH',
            businessId: `batch-${role}`,
            summary: `批量更新权限 ${roleLabel[role]}→${enabled ? '启用' : '禁用'} ${targetDesc} 共${count}个模块`,
            detail: { role, enabled, count, module_codes: module_codes || null, group_code: group_code || null }
        });

        ok(res, null, module_codes?.length ? `已更新 ${module_codes.length} 个模块` : `已更新分组「${group_code}」${count} 个模块`);
    } catch (err) { fail500(res, err); }
});

// ===== 按鈕權限矩陣（全量）=====
router.get('/button/matrix', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT b.*, p.module_name, p.module_group
             FROM cams_permission_button b
             LEFT JOIN cams_module_permission p ON p.module_code=b.module_code
             ORDER BY p.sort_order, b.module_code, b.sort_order`
        );
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ===== 按模組查按鈕權限 =====
router.get('/button/module/:module_code', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT * FROM cams_permission_button WHERE module_code=? ORDER BY sort_order`,
            [req.params.module_code]
        );
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ===== 更新單個按鈕的角色權限 =====
// body: { allow_general, allow_operator, allow_admin }
router.post('/button/:module_code/:button_code', async (req, res) => {
    try {
        const { allow_general, allow_operator, allow_admin } = req.body;
        const { module_code, button_code } = req.params;

        const [oldRows] = await pool.execute(
            'SELECT * FROM cams_permission_button WHERE module_code=? AND button_code=?',
            [module_code, button_code]
        );
        if (!oldRows[0]) return fail(res, '按鈕不存在', 404);

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
        if (!updates.length) return fail(res, '無更新字段', 400);

        values.push(module_code, button_code);
        await pool.execute(
            `UPDATE cams_permission_button SET ${updates.join(',')}, update_time=NOW()
             WHERE module_code=? AND button_code=?`, values);

        audit.log(req, {
            module: 'permission', action: 'UPDATE',
            businessType: 'PERM-BUTTON', businessId: `${module_code}.${button_code}`,
            summary: `更新按鈕權限 ${module_code}/${button_code}`,
            before: oldRows[0], after: req.body
        });
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

// ===== 獲取當前登入用戶的按鈕權限（前端初始化調用）=====
// 返回 { module_code: { button_code: true/false } } 供前端 v-permission 指令使用
router.get('/user-buttons', async (req, res) => {
    try {
        const role = req.user?.role || 'general';
        const roleCol = role === 'admin' ? 'allow_admin' : role === 'operator' ? 'allow_operator' : 'allow_general';

        const [rows] = await pool.execute(
            `SELECT module_code, button_code, button_name, ${roleCol} as allowFlag
             FROM cams_permission_button
             ORDER BY module_code, sort_order`
        );

        // 轉成前端好⽤的 dict 結構
        const dict = {};
        for (const r of rows) {
            if (!dict[r.module_code]) dict[r.module_code] = {};
            dict[r.module_code][r.button_code] = {
                allow: r.allowFlag === 1,
                name: r.button_name
            };
        }

        ok(res, {
            role,
            bu_no: req.user?.bu_no || '',
            data_scope: req.user?.dataScope || null,
            buttons: dict
        });
    } catch (err) { fail500(res, err); }
});

// ===== 行級數據範圍配置 =====
router.get('/data-scope', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT s.*, m.module_name, m.module_group
             FROM cams_data_scope s
             LEFT JOIN cams_module_permission m ON m.module_code=s.module_code
             ORDER BY s.role_code,
                      CASE WHEN s.module_code='*' THEN 0 ELSE 1 END,
                      s.module_code`
        );
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ===== 更新/新增行級數據範圍 =====
// body: { role_code, module_code, scope_type, bu_list, dept_list, description }
router.post('/data-scope', async (req, res) => {
    try {
        const { role_code, module_code = '*', scope_type = 'ALL', bu_list, dept_list, description } = req.body;
        if (!role_code) return fail(res, '缺少 role_code', 400);
        const validRoles = ['admin', 'operator', 'general'];
        if (!validRoles.includes(role_code)) return fail(res, 'role_code 需為 admin/operator/general', 400);

        const [oldRows] = await pool.execute(
            'SELECT * FROM cams_data_scope WHERE role_code=? AND module_code=?',
            [role_code, module_code]
        );

        const buJson = bu_list ? JSON.stringify(bu_list) : null;
        const deptJson = dept_list ? JSON.stringify(dept_list) : null;

        if (oldRows[0]) {
            await pool.execute(
                `UPDATE cams_data_scope SET scope_type=?, bu_list=?, dept_list=?, description=?, update_time=NOW()
                 WHERE role_code=? AND module_code=?`,
                [scope_type, buJson, deptJson, description || '', role_code, module_code]
            );
        } else {
            await pool.execute(
                `INSERT INTO cams_data_scope (role_code, module_code, scope_type, bu_list, dept_list, description)
                 VALUES (?,?,?,?,?,?)`,
                [role_code, module_code, scope_type, buJson, deptJson, description || '']
            );
        }

        audit.log(req, {
            module: 'permission', action: oldRows[0] ? 'UPDATE' : 'CREATE',
            businessType: 'PERM-DATA-SCOPE', businessId: `${role_code}.${module_code}`,
            summary: `數據範圍 ${role_code}/${module_code} → ${scope_type}`,
            before: oldRows[0] || null,
            after: { role_code, module_code, scope_type, bu_list, dept_list, description }
        });
        ok(res, null, oldRows[0] ? '已更新' : '已新增');
    } catch (err) { fail500(res, err); }
});

// ===== 根據用戶 ID 獲取允許的模組碼列表（登錄時調用）=====
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
