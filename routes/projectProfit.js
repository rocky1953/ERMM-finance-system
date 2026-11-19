/**
 * 项目损益路由（COO-02）
 *
 *   GET  /api/project-profit/projects
 *   GET  /api/project-profit/overview?bu_no&YYYY_MM
 *   GET  /api/project-profit/detail?project_id&year&bu_no
 *   GET/POST/DELETE /api/project-profit/budgets
 *   GET/POST/PUT/DELETE /api/project-profit/costs
 *   POST /api/project-profit/costs/sync      按出货成本自动引入
 *   GET/POST/PUT/DELETE /api/project-profit/revenues
 *   POST /api/project-profit/revenues/sync   从出货收入自动引入
 */

const express = require('express');
const router = express.Router();
const { ok, fail, fail500 } = require('../utils/response');
const svc = require('../services/projectProfit');
const audit = require('../services/audit');

const userId = (req) => (req.user && req.user.user_id) || null;

router.get('/projects', async (req, res) => {
    try { ok(res, await svc.listProjects()); } catch (e) { fail500(res, e); }
});

router.get('/overview', async (req, res) => {
    try {
        ok(res, await svc.overview({ bu_no: req.query.bu_no || '', YYYY_MM: req.query.YYYY_MM }));
    } catch (e) { fail500(res, e); }
});

router.get('/detail', async (req, res) => {
    try {
        ok(res, await svc.detail({
            project_id: req.query.project_id,
            year: req.query.year,
            bu_no: req.query.bu_no || ''
        }));
    } catch (e) { fail(res, e.message); }
});

// ===== 预算 =====
router.get('/budgets', async (req, res) => {
    try {
        ok(res, await svc.listBudgets({ year: req.query.year, bu_no: req.query.bu_no || '' }));
    } catch (e) { fail500(res, e); }
});

router.post('/budgets', async (req, res) => {
    try {
        const data = Object.assign({}, req.body, { update_by: userId(req) });
        const r = await svc.saveBudget(data);
        audit.log(req, {
            module: 'projectProfit', action: 'CREATE', businessType: 'PP-BUDGET',
            businessId: `${r.bu_no}/${r.project_id}/${r.year}`,
            summary: `保存项目预算 ${r.bu_no} ${r.project_id}(${r.project_name}) ${r.year} 收入¥${data.revenue_budget || 0} 成本¥${data.cost_budget || 0}`,
            after: { bu_no: r.bu_no, project_id: r.project_id, year: r.year, revenue_budget: data.revenue_budget, cost_budget: data.cost_budget }
        });
        ok(res, r, '预算已保存');
    } catch (e) { fail(res, e.message); }
});

router.delete('/budgets/:uid', async (req, res) => {
    try {
        // 先查旧值
        const { pool } = require('../config/db');
        const [oldRows] = await pool.execute('SELECT * FROM project_budget WHERE uid=?', [req.params.uid]);
        await svc.deleteBudget(req.params.uid);
        audit.log(req, {
            module: 'projectProfit', action: 'DELETE', businessType: 'PP-BUDGET',
            businessId: String(req.params.uid),
            summary: `删除项目预算 id=${req.params.uid} ${oldRows[0]?.bu_no || ''} ${oldRows[0]?.project_id || ''} ${oldRows[0]?.year || ''}`,
            before: oldRows[0]
        });
        ok(res, { uid: Number(req.params.uid) }, '已删除');
    } catch (e) { fail(res, e.message); }
});

// ===== 成本归集 =====
router.get('/costs', async (req, res) => {
    try {
        ok(res, await svc.listCosts({
            bu_no: req.query.bu_no || '',
            project_id: req.query.project_id || '',
            from: req.query.from || '',
            to: req.query.to || '',
            limit: req.query.limit
        }));
    } catch (e) { fail500(res, e); }
});

router.post('/costs', async (req, res) => {
    try {
        const data = Object.assign({}, req.body, { created_by: userId(req) });
        const r = await svc.createCost(data);
        audit.log(req, {
            module: 'projectProfit', action: 'CREATE', businessType: 'PP-COST',
            businessId: String(r.uid),
            summary: `归集项目成本 ${data.bu_no} ${data.project_id} ${data.YYYY_MM} ${data.cost_type || 'OTHER'} ¥${data.amount || 0}`,
            after: { uid: r.uid, bu_no: data.bu_no, project_id: data.project_id, YYYY_MM: data.YYYY_MM, cost_type: data.cost_type, amount: data.amount }
        });
        ok(res, r, '成本已归集');
    } catch (e) { fail(res, e.message); }
});

router.put('/costs/:uid', async (req, res) => {
    try {
        const { pool } = require('../config/db');
        const [oldRows] = await pool.execute('SELECT * FROM project_cost WHERE uid=?', [req.params.uid]);
        await svc.updateCost(req.params.uid, req.body || {});
        audit.log(req, {
            module: 'projectProfit', action: 'UPDATE', businessType: 'PP-COST',
            businessId: String(req.params.uid),
            summary: `修改项目成本 id=${req.params.uid} ${oldRows[0]?.bu_no || ''} ${oldRows[0]?.project_id || ''} 原¥${oldRows[0]?.amount || 0}`,
            before: oldRows[0]
        });
        ok(res, { uid: Number(req.params.uid) }, '成本已更新');
    } catch (e) { fail(res, e.message); }
});

router.delete('/costs/:uid', async (req, res) => {
    try {
        const { pool } = require('../config/db');
        const [oldRows] = await pool.execute('SELECT * FROM project_cost WHERE uid=?', [req.params.uid]);
        await svc.deleteCost(req.params.uid);
        audit.log(req, {
            module: 'projectProfit', action: 'DELETE', businessType: 'PP-COST',
            businessId: String(req.params.uid),
            summary: `删除项目成本 id=${req.params.uid} ${oldRows[0]?.bu_no || ''} ${oldRows[0]?.project_id || ''} ${oldRows[0]?.YYYY_MM || ''} ¥${oldRows[0]?.amount || 0}`,
            before: oldRows[0]
        });
        ok(res, { uid: Number(req.params.uid) }, '已删除');
    } catch (e) { fail(res, e.message); }
});

router.post('/costs/sync', async (req, res) => {
    try {
        const body = req.body || {};
        const r = await svc.syncCost({ bu_no: body.bu_no || '', YYYY_MM: body.YYYY_MM });
        audit.log(req, {
            module: 'projectProfit', action: 'CREATE', businessType: 'PP-COST-SYNC',
            businessId: `sync/${r.YYYY_MM}/${r.bu_no}`,
            summary: `自动引入出货成本 ${r.YYYY_MM} ${r.bu_no} 共${r.inserted}条 总¥${r.total_cost}`,
            detail: { YYYY_MM: r.YYYY_MM, bu_no: r.bu_no, inserted: r.inserted, total_cost: r.total_cost, cost_ratio: r.cost_ratio }
        });
        ok(res, r, r.inserted ? `已自动引入 ${r.inserted} 个项目成本（${r.YYYY_MM}）` : `${r.YYYY_MM} 无可引入的出货成本`);
    } catch (e) { fail500(res, e); }
});

// ===== 收入确认 =====
router.get('/revenues', async (req, res) => {
    try {
        ok(res, await svc.listRevenues({
            bu_no: req.query.bu_no || '',
            project_id: req.query.project_id || '',
            from: req.query.from || '',
            to: req.query.to || '',
            limit: req.query.limit
        }));
    } catch (e) { fail500(res, e); }
});

router.post('/revenues', async (req, res) => {
    try {
        const data = Object.assign({}, req.body, { created_by: userId(req) });
        const r = await svc.createRevenue(data);
        audit.log(req, {
            module: 'projectProfit', action: 'CREATE', businessType: 'PP-REV',
            businessId: String(r.uid),
            summary: `确认项目收入 ${data.bu_no} ${data.project_id} ${data.YYYY_MM} ¥${data.revenue_amt || 0}`,
            after: { uid: r.uid, bu_no: data.bu_no, project_id: data.project_id, YYYY_MM: data.YYYY_MM, revenue_amt: data.revenue_amt }
        });
        ok(res, r, '收入已确认');
    } catch (e) { fail(res, e.message); }
});

router.put('/revenues/:uid', async (req, res) => {
    try {
        const { pool } = require('../config/db');
        const [oldRows] = await pool.execute('SELECT * FROM project_revenue WHERE uid=?', [req.params.uid]);
        await svc.updateRevenue(req.params.uid, req.body || {});
        audit.log(req, {
            module: 'projectProfit', action: 'UPDATE', businessType: 'PP-REV',
            businessId: String(req.params.uid),
            summary: `修改项目收入 id=${req.params.uid} ${oldRows[0]?.bu_no || ''} ${oldRows[0]?.project_id || ''} 原¥${oldRows[0]?.revenue_amt || 0}`,
            before: oldRows[0]
        });
        ok(res, { uid: Number(req.params.uid) }, '收入已更新');
    } catch (e) { fail(res, e.message); }
});

router.delete('/revenues/:uid', async (req, res) => {
    try {
        const { pool } = require('../config/db');
        const [oldRows] = await pool.execute('SELECT * FROM project_revenue WHERE uid=?', [req.params.uid]);
        await svc.deleteRevenue(req.params.uid);
        audit.log(req, {
            module: 'projectProfit', action: 'DELETE', businessType: 'PP-REV',
            businessId: String(req.params.uid),
            summary: `删除项目收入 id=${req.params.uid} ${oldRows[0]?.bu_no || ''} ${oldRows[0]?.project_id || ''} ${oldRows[0]?.YYYY_MM || ''} ¥${oldRows[0]?.revenue_amt || 0}`,
            before: oldRows[0]
        });
        ok(res, { uid: Number(req.params.uid) }, '已删除');
    } catch (e) { fail(res, e.message); }
});

router.post('/revenues/sync', async (req, res) => {
    try {
        const body = req.body || {};
        const r = await svc.syncRevenue({ bu_no: body.bu_no || '', YYYY_MM: body.YYYY_MM });
        audit.log(req, {
            module: 'projectProfit', action: 'CREATE', businessType: 'PP-REV-SYNC',
            businessId: `sync/${r.YYYY_MM}/${r.bu_no}`,
            summary: `自动引入出货收入 ${r.YYYY_MM} ${r.bu_no} 共${r.inserted}条 总¥${r.total_revenue}`,
            detail: { YYYY_MM: r.YYYY_MM, bu_no: r.bu_no, inserted: r.inserted, total_revenue: r.total_revenue }
        });
        ok(res, r, r.inserted ? `已自动引入 ${r.inserted} 个项目收入（${r.YYYY_MM}）` : `${r.YYYY_MM} 无可引入的出货收入`);
    } catch (e) { fail500(res, e); }
});

module.exports = router;
