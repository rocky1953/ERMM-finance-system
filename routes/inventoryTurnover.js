/**
 * 库存周转、库龄与呆滞（COO-05）
 * GET    /overview      周转概览（库龄结构 + 周转率/天数 + 呆滞汇总）
 * GET    /aging         库龄结构与料件明细
 * GET    /slow-moving   呆滞清单
 * GET    /replenishment 补货建议
 * GET    /snapshots     可用库龄快照日期
 * GET    /actions       呆滞处理单
 * POST   /actions       下发处理
 * PUT    /actions/:uid  更新处理单
 * DELETE /actions/:uid  删除处理单
 */
const express = require('express');
const router = express.Router();
const { ok, fail, fail500 } = require('../utils/response');
const svc = require('../services/inventoryTurnover');

function needBu(req, res) {
    const bu_no = req.query.bu_no || (req.body && req.body.bu_no);
    if (!bu_no) { fail(res, '需要 bu_no', 400); return null; }
    return bu_no;
}

router.get('/snapshots', async (req, res) => {
    try {
        const bu_no = needBu(req, res); if (!bu_no) return;
        ok(res, await svc.getSnapshotDates(bu_no));
    } catch (err) { fail500(res, err); }
});

router.get('/overview', async (req, res) => {
    try {
        const bu_no = needBu(req, res); if (!bu_no) return;
        ok(res, await svc.getOverview(bu_no, { stock_date: req.query.stock_date }));
    } catch (err) { fail500(res, err); }
});

router.get('/aging', async (req, res) => {
    try {
        const bu_no = needBu(req, res); if (!bu_no) return;
        ok(res, await svc.getAging(bu_no, req.query.stock_date));
    } catch (err) { fail500(res, err); }
});

router.get('/slow-moving', async (req, res) => {
    try {
        const bu_no = needBu(req, res); if (!bu_no) return;
        ok(res, await svc.getSlowMoving(bu_no, req.query.stock_date));
    } catch (err) { fail500(res, err); }
});

router.get('/replenishment', async (req, res) => {
    try {
        const bu_no = needBu(req, res); if (!bu_no) return;
        ok(res, await svc.getReplenishment(bu_no, req.query.stock_date, req.query));
    } catch (err) { fail500(res, err); }
});

router.get('/actions', async (req, res) => {
    try {
        const bu_no = needBu(req, res); if (!bu_no) return;
        ok(res, await svc.listActions(bu_no, req.query.status));
    } catch (err) { fail500(res, err); }
});

router.post('/actions', async (req, res) => {
    try {
        const data = await svc.createAction(req.body || {}, req.user ? req.user.user_id : null);
        ok(res, data, '呆滞处理单已下发');
    } catch (err) {
        if (err.status === 400) return fail(res, err.message, 400);
        fail500(res, err);
    }
});

router.put('/actions/:uid', async (req, res) => {
    try {
        ok(res, await svc.updateAction(req.params.uid, req.body || {}), '处理单已更新');
    } catch (err) {
        if (err.status === 400) return fail(res, err.message, 400);
        fail500(res, err);
    }
});

router.delete('/actions/:uid', async (req, res) => {
    try {
        ok(res, await svc.deleteAction(req.params.uid), '处理单已删除');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
