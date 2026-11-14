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
        ok(res, await svc.saveBudget(data), '预算已保存');
    } catch (e) { fail(res, e.message); }
});

router.delete('/budgets/:uid', async (req, res) => {
    try {
        await svc.deleteBudget(req.params.uid);
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
        ok(res, await svc.createCost(data), '成本已归集');
    } catch (e) { fail(res, e.message); }
});

router.put('/costs/:uid', async (req, res) => {
    try {
        await svc.updateCost(req.params.uid, req.body || {});
        ok(res, { uid: Number(req.params.uid) }, '成本已更新');
    } catch (e) { fail(res, e.message); }
});

router.delete('/costs/:uid', async (req, res) => {
    try {
        await svc.deleteCost(req.params.uid);
        ok(res, { uid: Number(req.params.uid) }, '已删除');
    } catch (e) { fail(res, e.message); }
});

router.post('/costs/sync', async (req, res) => {
    try {
        const body = req.body || {};
        const r = await svc.syncCost({ bu_no: body.bu_no || '', YYYY_MM: body.YYYY_MM });
        ok(res, r, r.inserted ? `已自动引入 ${r.inserted} 个项目成本` : '当月无可引入的出货成本');
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
        ok(res, await svc.createRevenue(data), '收入已确认');
    } catch (e) { fail(res, e.message); }
});

router.put('/revenues/:uid', async (req, res) => {
    try {
        await svc.updateRevenue(req.params.uid, req.body || {});
        ok(res, { uid: Number(req.params.uid) }, '收入已更新');
    } catch (e) { fail(res, e.message); }
});

router.delete('/revenues/:uid', async (req, res) => {
    try {
        await svc.deleteRevenue(req.params.uid);
        ok(res, { uid: Number(req.params.uid) }, '已删除');
    } catch (e) { fail(res, e.message); }
});

router.post('/revenues/sync', async (req, res) => {
    try {
        const body = req.body || {};
        const r = await svc.syncRevenue({ bu_no: body.bu_no || '', YYYY_MM: body.YYYY_MM });
        ok(res, r, r.inserted ? `已自动引入 ${r.inserted} 个项目收入` : '当月无可引入的出货收入');
    } catch (e) { fail500(res, e); }
});

module.exports = router;
