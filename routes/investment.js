/**
 * CEO-03 投资与资本配置决策
 *
 * GET    /api/investment/overview?YYYY=&bu_no=   组合总览：汇总、资本配置、优先级、预警、投后跟踪、项目清单
 * GET    /api/investment/projects?YYYY=&bu_no=&status=   项目清单（含评估指标）
 * GET    /api/investment/projects/:id             项目详情（含现金流、指标、敏感性）
 * POST   /api/investment/projects                 新增项目
 * PUT    /api/investment/projects/:id             编辑项目
 * DELETE /api/investment/projects/:id             删除项目
 * PUT    /api/investment/projects/:id/cashflows   批量保存分年度计划/实际现金流
 * GET    /api/investment/budgets?YYYY=            年度资本预算
 * POST   /api/investment/budgets                  新增/更新预算（同年度同公司覆盖）
 * DELETE /api/investment/budgets/:uid             删除预算
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const {
    BUS, CATEGORIES, STATUSES,
    buildRows, buildOverview, projectDetail,
    loadProjects, loadCashflows, ensureCashflows,
    loadBudgets
} = require('../services/investment');

const n = (v) => Number(v || 0);
const r2 = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.round((x + Number.EPSILON) * 100) / 100 : 0;
};

function parseYear(v) {
    const s = String(v || '').trim();
    return /^\d{4}$/.test(s) ? s : null;
}

function normalizeBu(v, dft = 'GROUP') {
    const s = String(v || dft).trim().toUpperCase();
    return BUS.includes(s) ? s : null;
}

function pickStr(v, max) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return null;
    return s.slice(0, max);
}

async function defaultYear() {
    const [rows] = await pool.execute('SELECT MAX(fiscal_year) AS y FROM investment_project');
    return rows[0]?.y ? String(rows[0].y).slice(0, 4) : String(new Date().getFullYear());
}

function readProject(body, partial) {
    const out = {};
    const put = (key, value) => { if (!partial || value !== undefined) out[key] = value; };

    if (body.project_name !== undefined) {
        const v = pickStr(body.project_name, 150);
        if (!v) return { error: '项目名称不能为空' };
        out.project_name = v;
    } else if (!partial) {
        return { error: '项目名称不能为空' };
    }

    if (body.fiscal_year !== undefined) {
        const y = parseYear(body.fiscal_year);
        if (!y) return { error: '年度格式应为 YYYY' };
        out.fiscal_year = y;
    } else if (!partial) {
        out.fiscal_year = String(new Date().getFullYear());
    }

    if (body.bu_no !== undefined) {
        const v = normalizeBu(body.bu_no);
        if (!v) return { error: '公司别仅支持 GROUP/HM/HN/SZ' };
        out.bu_no = v;
    } else if (!partial) {
        out.bu_no = 'GROUP';
    }

    if (body.category !== undefined) {
        const v = String(body.category).trim().toUpperCase();
        if (!CATEGORIES[v]) return { error: '投资类别无效' };
        out.category = v;
    } else if (!partial) {
        out.category = 'OTHER';
    }

    if (body.status !== undefined) {
        const v = String(body.status).trim().toUpperCase();
        if (!STATUSES[v]) return { error: '项目状态无效' };
        out.status = v;
    } else if (!partial) {
        out.status = 'DRAFT';
    }

    if (body.horizon_years !== undefined) {
        const h = Math.round(n(body.horizon_years));
        if (h < 1 || h > 30) return { error: '现金流年数应在 1~30 之间' };
        out.horizon_years = h;
    } else if (!partial) {
        out.horizon_years = 5;
    }

    if (body.discount_rate !== undefined) {
        const d = n(body.discount_rate);
        if (d < 0 || d > 100) return { error: '折现率应在 0~100 之间' };
        out.discount_rate = r2(d);
    } else if (!partial) {
        out.discount_rate = 8;
    }

    if (body.initial_investment !== undefined) {
        const v = n(body.initial_investment);
        if (v < 0) return { error: '初始投资额不能为负' };
        out.initial_investment = r2(v);
    } else if (!partial) {
        out.initial_investment = 0;
    }

    if (body.salvage_value !== undefined) {
        const v = n(body.salvage_value);
        if (v < 0) return { error: '残值不能为负' };
        out.salvage_value = r2(v);
    } else if (!partial) {
        out.salvage_value = 0;
    }

    if (body.annual_cashflow !== undefined) out.annual_cashflow = r2(n(body.annual_cashflow));
    else if (!partial) out.annual_cashflow = 0;

    if (body.start_month !== undefined) {
        const s = pickStr(body.start_month, 7);
        if (s && !/^\d{4}-\d{2}$/.test(s)) return { error: '开工月份格式应为 YYYY-MM' };
        out.start_month = s;
    }
    if (body.project_code !== undefined) out.project_code = pickStr(body.project_code, 32);
    if (body.priority !== undefined) out.priority = Math.round(n(body.priority));
    if (body.owner_id !== undefined) out.owner_id = pickStr(body.owner_id, 50);
    if (body.department !== undefined) out.department = pickStr(body.department, 100);
    if (body.remark !== undefined) out.remark = pickStr(body.remark, 500);

    return { value: out };
}

// 组合总览
router.get('/overview', async (req, res) => {
    try {
        const year = parseYear(req.query.YYYY) || await defaultYear();
        const rawBu = String(req.query.bu_no || '').trim().toUpperCase();
        let bu = '';
        if (rawBu && rawBu !== 'ALL') {
            bu = normalizeBu(rawBu);
            if (!bu) return fail(res, '公司别仅支持 GROUP/HM/HN/SZ');
        }
        ok(res, await buildOverview(year, bu));
    } catch (err) { fail500(res, err); }
});

// 项目清单
router.get('/projects', async (req, res) => {
    try {
        const year = parseYear(req.query.YYYY);
        const rawBu = String(req.query.bu_no || '').trim().toUpperCase();
        let bu = '';
        if (rawBu && rawBu !== 'ALL') {
            bu = normalizeBu(rawBu);
            if (!bu) return fail(res, '公司别仅支持 GROUP/HM/HN/SZ');
        }
        let projects = await loadProjects(year, bu);
        const status = String(req.query.status || '').trim().toUpperCase();
        if (STATUSES[status]) projects = projects.filter(p => p.status === status);
        const cfMap = await loadCashflows(projects.map(p => p.project_id));
        ok(res, buildRows(projects, cfMap));
    } catch (err) { fail500(res, err); }
});

// 项目详情
router.get('/projects/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!id) return fail(res, '参数无效');
        const data = await projectDetail(id);
        if (!data) return fail(res, '项目不存在', 404);
        ok(res, data);
    } catch (err) { fail500(res, err); }
});

// 新增项目
router.post('/projects', async (req, res) => {
    try {
        const parsed = readProject(req.body, false);
        if (parsed.error) return fail(res, parsed.error);
        const o = parsed.value;

        const [result] = await pool.execute(
            `INSERT INTO investment_project
                (project_code, project_name, bu_no, category, fiscal_year, start_month,
                 horizon_years, discount_rate, initial_investment, salvage_value,
                 annual_cashflow, status, priority, owner_id, department, remark)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [o.project_code || null, o.project_name, o.bu_no, o.category, o.fiscal_year,
             o.start_month || null, o.horizon_years, o.discount_rate, o.initial_investment,
             o.salvage_value, o.annual_cashflow, o.status, o.priority || 0,
             o.owner_id || null, o.department || null, o.remark || null]);

        const [rows] = await pool.execute(
            'SELECT * FROM investment_project WHERE project_id=?', [result.insertId]);
        await ensureCashflows(rows[0]);
        const data = await projectDetail(result.insertId);
        ok(res, data, '项目已创建');
    } catch (err) { fail500(res, err); }
});

// 编辑项目
router.put('/projects/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!id) return fail(res, '参数无效');
        const [cur] = await pool.execute('SELECT * FROM investment_project WHERE project_id=?', [id]);
        if (!cur.length) return fail(res, '项目不存在', 404);

        const parsed = readProject(req.body, true);
        if (parsed.error) return fail(res, parsed.error);
        const m = { ...cur[0], ...parsed.value };

        await pool.execute(
            `UPDATE investment_project SET
                project_code=?, project_name=?, bu_no=?, category=?, fiscal_year=?, start_month=?,
                horizon_years=?, discount_rate=?, initial_investment=?, salvage_value=?,
                annual_cashflow=?, status=?, priority=?, owner_id=?, department=?, remark=?
              WHERE project_id=?`,
            [m.project_code || null, m.project_name, m.bu_no, m.category, m.fiscal_year,
             m.start_month || null, m.horizon_years, r2(m.discount_rate), r2(m.initial_investment),
             r2(m.salvage_value), r2(m.annual_cashflow), m.status, Number(m.priority) || 0,
             m.owner_id || null, m.department || null, m.remark || null, id]);

        await ensureCashflows({ ...m, project_id: id });
        const data = await projectDetail(id);
        ok(res, data, '项目已更新');
    } catch (err) { fail500(res, err); }
});

// 删除项目
router.delete('/projects/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!id) return fail(res, '参数无效');
        const [cur] = await pool.execute(
            'SELECT project_id FROM investment_project WHERE project_id=?', [id]);
        if (!cur.length) return fail(res, '项目不存在', 404);
        await pool.execute('DELETE FROM investment_project WHERE project_id=?', [id]);
        ok(res, { project_id: id }, '项目已删除');
    } catch (err) { fail500(res, err); }
});

// 保存分年度现金流
router.put('/projects/:id/cashflows', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!id) return fail(res, '参数无效');
        const [cur] = await pool.execute(
            'SELECT * FROM investment_project WHERE project_id=?', [id]);
        if (!cur.length) return fail(res, '项目不存在', 404);

        const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
        if (!rows.length) return fail(res, '请提供现金流明细');
        const horizon = Math.max(1, n(cur[0].horizon_years) || rows.length);

        for (const r of rows) {
            const y = Math.round(n(r.year_index));
            if (y < 1 || y > horizon) continue;
            await pool.execute(
                `INSERT INTO investment_cashflow
                    (project_id, year_index, planned_amount, actual_amount, note)
                 VALUES (?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE
                    planned_amount=VALUES(planned_amount), actual_amount=VALUES(actual_amount),
                    note=VALUES(note)`,
                [id, y, r2(n(r.planned_amount)), r2(n(r.actual_amount)), pickStr(r.note, 200)]);
        }
        const data = await projectDetail(id);
        ok(res, data, '现金流已保存');
    } catch (err) { fail500(res, err); }
});

// 年度资本预算
router.get('/budgets', async (req, res) => {
    try {
        const year = parseYear(req.query.YYYY) || await defaultYear();
        const rows = await loadBudgets(year);
        const map = new Map(rows.map(r => [r.bu_no, r]));
        ok(res, BUS.map(bu => {
            const r = map.get(bu);
            return {
                uid: r ? r.uid : null,
                fiscal_year: year,
                bu_no: bu,
                budget_amount: r ? r2(r.budget_amount) : 0,
                note: r ? r.note : null
            };
        }));
    } catch (err) { fail500(res, err); }
});

// 新增/更新预算
router.post('/budgets', async (req, res) => {
    try {
        const year = parseYear(req.body.fiscal_year);
        if (!year) return fail(res, '年度格式应为 YYYY');
        const bu = normalizeBu(req.body.bu_no);
        if (!bu) return fail(res, '公司别仅支持 GROUP/HM/HN/SZ');
        const amount = n(req.body.budget_amount);
        if (amount < 0) return fail(res, '预算金额不能为负');

        await pool.execute(
            `INSERT INTO investment_budget (fiscal_year, bu_no, budget_amount, note)
             VALUES (?,?,?,?)
             ON DUPLICATE KEY UPDATE budget_amount=VALUES(budget_amount), note=VALUES(note)`,
            [year, bu, r2(amount), pickStr(req.body.note, 200)]);

        const rows = await loadBudgets(year);
        ok(res, rows, '预算已保存');
    } catch (err) { fail500(res, err); }
});

// 删除预算
router.delete('/budgets/:uid', async (req, res) => {
    try {
        const uid = Number(req.params.uid);
        if (!uid) return fail(res, '参数无效');
        const [cur] = await pool.execute('SELECT uid FROM investment_budget WHERE uid=?', [uid]);
        if (!cur.length) return fail(res, '预算不存在', 404);
        await pool.execute('DELETE FROM investment_budget WHERE uid=?', [uid]);
        ok(res, { uid }, '预算已删除');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
