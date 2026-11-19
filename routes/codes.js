const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const audit = require('../services/audit');

// 列出所有 code_type（去重）
router.get('/types', async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT code_type, COUNT(*) cnt, MAX(CASE WHEN inuse_flag='USE' THEN 1 ELSE 0 END) has_active
              FROM cams_system_codes
             GROUP BY code_type
             ORDER BY code_type
        `);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// 列出指定 code_type 的所有 active 码值
router.get('/list', async (req, res) => {
    try {
        const { code_type, bu_no } = req.query;
        if (!code_type) return fail(res, '需要 code_type');
        const [rows] = await pool.execute(`
            SELECT id, code_type, code_value, value_description, value_number1, value_number2,
                   value_number3, value_alpha1, value_alpha2, inuse_flag, sort_order, create_time, update_time
              FROM cams_system_codes
             WHERE code_type=?
             ORDER BY COALESCE(sort_order, 0), code_value
        `, [code_type]);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// 通用获取（供 meta 接口用）：只要 active 的 code_value 数组
router.get('/active-values', async (req, res) => {
    try {
        const { code_type } = req.query;
        if (!code_type) return fail(res, '需要 code_type');
        const [rows] = await pool.execute(`
            SELECT code_value, value_description, value_number1, value_number2, value_number3, value_alpha1, value_alpha2, sort_order
              FROM cams_system_codes
             WHERE code_type=? AND (inuse_flag='USE' OR inuse_flag IS NULL OR inuse_flag='')
             ORDER BY COALESCE(sort_order, 0), code_value
        `, [code_type]);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// 新增
router.post('/', async (req, res) => {
    try {
        const b = req.body || {};
        const { code_type, code_value } = b;
        if (!code_type || !code_value) return fail(res, 'code_type 與 code_value 必填');

        // 同 type + value 唯一
        const [dup] = await pool.execute(
            `SELECT id FROM cams_system_codes WHERE code_type=? AND code_value=? LIMIT 1`,
            [code_type, code_value]);
        if (dup.length) return fail(res, `碼值已存在 (${code_type}/${code_value})`, 409);

        const [r] = await pool.execute(`
            INSERT INTO cams_system_codes
                (code_type, code_value, value_description, value_number1, value_number2, value_number3,
                 value_alpha1, value_alpha2, inuse_flag, sort_order, create_time, update_time)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `, [
            code_type, code_value,
            b.value_description ?? null,
            toDec(b.value_number1), toDec(b.value_number2), toDec(b.value_number3),
            b.value_alpha1 ?? null, b.value_alpha2 ?? null,
            b.inuse_flag ?? 'USE',
            b.sort_order ?? 99
        ]);
        audit.log(req, {
            module: 'codeTable', action: 'CREATE', businessType: 'CODE-TABLE',
            businessId: String(r.insertId),
            summary: `新增码表 ${code_type}/${code_value} ${b.value_description || ''}`,
            after: { id: r.insertId, code_type, code_value, value_description: b.value_description,
                     value_number1: toDec(b.value_number1), value_number2: toDec(b.value_number2),
                     value_number3: toDec(b.value_number3), inuse_flag: b.inuse_flag ?? 'USE', sort_order: b.sort_order ?? 99 }
        });
        ok(res, { id: r.insertId });
    } catch (err) { fail500(res, err); }
});

// 更新
router.put('/:id', async (req, res) => {
    try {
        const id = req.params.id;
        // 先查旧值
        const [oldRows] = await pool.execute('SELECT * FROM cams_system_codes WHERE id=?', [id]);
        if (!oldRows.length) return fail(res, '码表记录不存在', 404);

        const { code_value, value_description, value_number1, value_number2, value_number3,
                value_alpha1, value_alpha2, inuse_flag, sort_order } = req.body || {};
        const fields = []; const vals = [];
        if (code_value !== undefined) { fields.push('code_value=?'); vals.push(code_value); }
        if (value_description !== undefined) { fields.push('value_description=?'); vals.push(value_description); }
        if (value_number1 !== undefined) { fields.push('value_number1=?'); vals.push(toDec(value_number1)); }
        if (value_number2 !== undefined) { fields.push('value_number2=?'); vals.push(toDec(value_number2)); }
        if (value_number3 !== undefined) { fields.push('value_number3=?'); vals.push(toDec(value_number3)); }
        if (value_alpha1 !== undefined) { fields.push('value_alpha1=?'); vals.push(value_alpha1); }
        if (value_alpha2 !== undefined) { fields.push('value_alpha2=?'); vals.push(value_alpha2); }
        if (inuse_flag !== undefined) { fields.push('inuse_flag=?'); vals.push(inuse_flag); }
        if (sort_order !== undefined) { fields.push('sort_order=?'); vals.push(sort_order); }
        if (!fields.length) return fail(res, '无更新字段', 400);
        fields.push('update_time=NOW()');
        vals.push(id);
        const [r] = await pool.execute(`UPDATE cams_system_codes SET ${fields.join(',')} WHERE id=?`, vals);

        // === 显式审计 ===
        const old = oldRows[0];
        const after = {
            code_value: code_value ?? old.code_value,
            value_description: value_description ?? old.value_description,
            value_number1: value_number1 !== undefined ? toDec(value_number1) : old.value_number1,
            value_number2: value_number2 !== undefined ? toDec(value_number2) : old.value_number2,
            value_number3: value_number3 !== undefined ? toDec(value_number3) : old.value_number3,
            inuse_flag: inuse_flag ?? old.inuse_flag,
            sort_order: sort_order ?? old.sort_order
        };
        audit.log(req, {
            module: 'codeTable', action: 'UPDATE', businessType: 'CODE-TABLE',
            businessId: String(id),
            summary: `修改码表 ${old.code_type}/${old.code_value} → ${after.code_value}`,
            before: old,
            after
        });

        ok(res, { affected: r.affectedRows });
    } catch (err) { fail500(res, err); }
});

// 删除
router.delete('/:id', async (req, res) => {
    try {
        // 先查旧值
        const [oldRows] = await pool.execute('SELECT * FROM cams_system_codes WHERE id=?', [req.params.id]);
        await pool.execute(`DELETE FROM cams_system_codes WHERE id=?`, [req.params.id]);
        audit.log(req, {
            module: 'codeTable', action: 'DELETE', businessType: 'CODE-TABLE',
            businessId: String(req.params.id),
            summary: `删除码表 ${oldRows[0]?.code_type || ''}/${oldRows[0]?.code_value || req.params.id}`,
            before: oldRows[0]
        });
        ok(res, { affected: oldRows.length });
    } catch (err) { fail500(res, err); }
});

function toDec(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
}

module.exports = router;
