/**
 * CEO-05 组织人效分析
 *
 * GET    /api/hr-efficiency/overview?bu_no=&YYYY_MM=   人效总览（KPI + 部门 + 趋势）
 * GET    /api/hr-efficiency/headcount-plans?bu_no=&period=  部门编制清单
 * POST   /api/hr-efficiency/headcount-plans            新增/覆盖编制项
 * PUT    /api/hr-efficiency/headcount-plans/:uid       编辑编制项
 * DELETE /api/hr-efficiency/headcount-plans/:uid       删除编制项
 * POST   /api/hr-efficiency/headcount-plans/copy       复制上月编制到目标月份
 *
 * 权限：管理员或主管（xuser_type 含主管/经理）
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const { BUS, normalizeMonth, buildOverview } = require('../services/hrEfficiency');
const audit = require('../services/audit');

const MANAGER_TYPES = ['部门主管', '部門主管', '部门经理', '部門經理', '高阶主管', '高階主管'];

async function resolveActor(req) {
    const userId = req.user && req.user.user_id;
    if (!userId) return { error: '未登入' };
    const [rows] = await pool.execute(
        'SELECT xuser_id, xuser_name, xuser_dept, admin, xuser_type FROM cams_xuser WHERE xuser_id=? LIMIT 1',
        [userId]
    );
    if (!rows.length) return { error: '使用者不存在' };
    const u = rows[0];
    const isAdmin = String(u.admin || '').trim() === 'Yes';
    const isManager = isAdmin || MANAGER_TYPES.includes(String(u.xuser_type || '').trim());
    return { user: u, isAdmin, isManager };
}

function parseBu(v, dft = 'HM') {
    const s = String(v || dft).trim().toUpperCase();
    return BUS.includes(s) ? s : null;
}

function r2(v) {
    const x = Number(v);
    return Number.isFinite(x) ? Math.round((x + Number.EPSILON) * 100) / 100 : 0;
}

function readPlan(body, partial) {
    const out = {};
    if (body.bu_no !== undefined || !partial) {
        const bu = parseBu(body.bu_no);
        if (!bu) return { error: '公司别仅支持 HM/HN/SZ' };
        out.bu_no = bu;
    }
    if (body.period !== undefined || !partial) {
        const p = normalizeMonth(body.period);
        if (!p) return { error: '编制月份格式应为 YYYY-MM' };
        out.period = p;
    }
    if (body.depart_name !== undefined || !partial) {
        const d = String(body.depart_name == null ? '' : body.depart_name).trim();
        if (!d) return { error: '部门名称不能为空' };
        out.depart_name = d.slice(0, 100);
    }
    if (body.plan_headcount !== undefined) {
        const n = Number(body.plan_headcount);
        if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return { error: '编制人数须为非负整数' };
        out.plan_headcount = n;
    } else if (!partial) {
        out.plan_headcount = 0;
    }
    if (body.actual_headcount !== undefined) {
        if (body.actual_headcount === null || body.actual_headcount === '') out.actual_headcount = null;
        else {
            const n = Number(body.actual_headcount);
            if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return { error: '实际人数须为非负整数' };
            out.actual_headcount = n;
        }
    }
    if (body.plan_labor_cost !== undefined) {
        const n = Number(body.plan_labor_cost);
        if (!Number.isFinite(n) || n < 0) return { error: '编制人工成本须为非负数' };
        out.plan_labor_cost = r2(n);
    }
    if (body.actual_labor_cost !== undefined) {
        const n = Number(body.actual_labor_cost);
        if (!Number.isFinite(n) || n < 0) return { error: '实际人工成本须为非负数' };
        out.actual_labor_cost = r2(n);
    }
    if (body.note !== undefined) {
        const s = String(body.note == null ? '' : body.note).trim();
        out.note = s ? s.slice(0, 300) : null;
    }
    return { value: out };
}

// 人效总览
router.get('/overview', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, actor.error, 403);
        if (!actor.isManager) return fail(res, '权限不足，仅主管可查看组织人效分析', 403);
        const bu = parseBu(req.query.bu_no);
        if (!bu) return fail(res, '公司别仅支持 HM/HN/SZ');
        ok(res, await buildOverview(bu, req.query.YYYY_MM));
    } catch (err) { fail500(res, err); }
});

// 编制清单
router.get('/headcount-plans', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, actor.error, 403);
        if (!actor.isManager) return fail(res, '权限不足，仅主管可维护部门编制', 403);
        const bu = parseBu(req.query.bu_no);
        if (!bu) return fail(res, '公司别仅支持 HM/HN/SZ');
        const period = normalizeMonth(req.query.period) || new Date().toISOString().slice(0, 7);
        const [rows] = await pool.execute(
            `SELECT * FROM hr_headcount_plan WHERE bu_no=? AND period=? ORDER BY depart_name`,
            [bu, period]
        );
        ok(res, { bu_no: bu, period, rows });
    } catch (err) { fail500(res, err); }
});

// 新增（同 公司+月份+部门 覆盖）
router.post('/headcount-plans', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, actor.error, 403);
        if (!actor.isManager) return fail(res, '权限不足', 403);
        const parsed = readPlan(req.body, false);
        if (parsed.error) return fail(res, parsed.error);
        const p = parsed.value;
        await pool.execute(
            `INSERT INTO hr_headcount_plan
               (bu_no, period, depart_name, plan_headcount, actual_headcount,
                plan_labor_cost, actual_labor_cost, note, updated_by)
             VALUES (?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
               plan_headcount=VALUES(plan_headcount),
               actual_headcount=VALUES(actual_headcount),
               plan_labor_cost=VALUES(plan_labor_cost),
               actual_labor_cost=VALUES(actual_labor_cost),
               note=VALUES(note),
               updated_by=VALUES(updated_by)`,
            [p.bu_no, p.period, p.depart_name, p.plan_headcount,
                p.actual_headcount === undefined ? null : p.actual_headcount,
                p.plan_labor_cost || 0, p.actual_labor_cost || 0,
                p.note === undefined ? null : p.note, actor.user.xuser_id]
        );
        const [rows] = await pool.execute(
            'SELECT * FROM hr_headcount_plan WHERE bu_no=? AND period=? AND depart_name=?',
            [p.bu_no, p.period, p.depart_name]
        );
        audit.log(req, {
            module: 'hrEfficiency', action: rows[0] ? 'UPDATE' : 'CREATE', businessType: 'HC-PLAN',
            businessId: `${p.bu_no}/${p.period}/${p.depart_name}`,
            summary: `${rows[0] ? '修改' : '新增'}编制 ${p.bu_no} ${p.period} ${p.depart_name} 计划${p.plan_headcount}人 成本¥${p.plan_labor_cost}`,
            after: rows[0]
        });
        ok(res, rows[0], '编制已保存');
    } catch (err) { fail500(res, err); }
});

// 复制：把 from_period 的编制复制到 to_period（已存在的部门不覆盖）
router.post('/headcount-plans/copy', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, actor.error, 403);
        if (!actor.isManager) return fail(res, '权限不足', 403);
        const bu = parseBu(req.body.bu_no);
        if (!bu) return fail(res, '公司别仅支持 HM/HN/SZ');
        const from = normalizeMonth(req.body.from_period);
        const to = normalizeMonth(req.body.to_period);
        if (!from || !to) return fail(res, '来源与目标月份格式应为 YYYY-MM');
        if (from === to) return fail(res, '来源与目标月份不能相同');

        const [src] = await pool.execute(
            'SELECT * FROM hr_headcount_plan WHERE bu_no=? AND period=?', [bu, from]);
        if (!src.length) return fail(res, `${from} 无编制数据可复制`, 400);

        const [exist] = await pool.execute(
            'SELECT depart_name FROM hr_headcount_plan WHERE bu_no=? AND period=?', [bu, to]);
        const existSet = new Set(exist.map(r => r.depart_name));
        const todo = src.filter(r => !existSet.has(r.depart_name));
        for (const r of todo) {
            await pool.execute(
                `INSERT INTO hr_headcount_plan
                   (bu_no, period, depart_name, plan_headcount, actual_headcount,
                    plan_labor_cost, actual_labor_cost, note, updated_by)
                 VALUES (?,?,?,?,?,?,?,?,?)`,
                [bu, to, r.depart_name, r.plan_headcount, null,
                    r.plan_labor_cost, 0, r.note, actor.user.xuser_id]
            );
        }
        audit.log(req, {
            module: 'hrEfficiency', action: 'CREATE', businessType: 'HC-COPY',
            businessId: `${bu}/${from}→${to}`,
            summary: `复制编制 ${bu} ${from} → ${to} 新增${todo.length}个部门（跳过${src.length - todo.length}个已存在）`
        });
        ok(res, { copied: todo.length, skipped: src.length - todo.length },
            `已复制 ${todo.length} 个部门编制`);
    } catch (err) { fail500(res, err); }
});

// 编辑
router.put('/headcount-plans/:uid', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, actor.error, 403);
        if (!actor.isManager) return fail(res, '权限不足', 403);
        const parsed = readPlan(req.body, true);
        if (parsed.error) return fail(res, parsed.error);
        const fields = parsed.value;
        const keys = Object.keys(fields);
        if (!keys.length) return fail(res, '没有可更新的字段');
        const sets = keys.map(k => `${k}=?`).join(', ');
        const params = keys.map(k => fields[k]);
        params.push(actor.user.xuser_id, req.params.uid);
        const [result] = await pool.execute(
            `UPDATE hr_headcount_plan SET ${sets}, updated_by=? WHERE uid=?`, params);
        if (!result.affectedRows) return fail(res, '编制记录不存在', 404);
        const [rows] = await pool.execute('SELECT * FROM hr_headcount_plan WHERE uid=?', [req.params.uid]);
        audit.log(req, {
            module: 'hrEfficiency', action: 'UPDATE', businessType: 'HC-PLAN',
            businessId: String(req.params.uid),
            summary: `编辑编制 id=${req.params.uid} 修改字段=[${keys.join(',')}]`,
            detail: { changed_fields: keys, values: fields }
        });
        ok(res, rows[0], '编制已更新');
    } catch (err) { fail500(res, err); }
});

// 删除
router.delete('/headcount-plans/:uid', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, actor.error, 403);
        if (!actor.isManager) return fail(res, '权限不足', 403);
        // 先查旧值
        const [oldRows] = await pool.execute('SELECT * FROM hr_headcount_plan WHERE uid=?', [req.params.uid]);
        const [result] = await pool.execute('DELETE FROM hr_headcount_plan WHERE uid=?', [req.params.uid]);
        if (!result.affectedRows) return fail(res, '编制记录不存在', 404);
        audit.log(req, {
            module: 'hrEfficiency', action: 'DELETE', businessType: 'HC-PLAN',
            businessId: String(req.params.uid),
            summary: `删除编制 id=${req.params.uid} ${oldRows[0]?.bu_no || ''} ${oldRows[0]?.period || ''} ${oldRows[0]?.depart_name || ''}`,
            before: oldRows[0]
        });
        ok(res, { uid: Number(req.params.uid) }, '编制已删除');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
