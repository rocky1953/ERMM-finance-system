/**
 * 滚动预算与三表联动（CFO-05）
 * GET  /assumption   读取滚动预算假设
 * PUT  /assumption   保存假设
 * GET  /projection   12 个月滚动预测 + 三表联动
 * GET  /13w          13 周滚动现金预测
 */
const express = require('express');
const router = express.Router();
const { ok, fail, fail500 } = require('../utils/response');
const { getAssumption, saveAssumption, project, cash13w } = require('../services/rollingBudget');

router.get('/assumption', async (req, res) => {
    try {
        const { bu_no } = req.query;
        if (!bu_no) return fail(res, '需要 bu_no', 400);
        ok(res, await getAssumption(bu_no));
    } catch (err) { fail500(res, err); }
});

router.put('/assumption', async (req, res) => {
    try {
        const { bu_no } = req.body || {};
        if (!bu_no) return fail(res, '需要 bu_no', 400);
        const data = await saveAssumption(bu_no, req.body, req.user ? req.user.user_id : null);
        ok(res, data, '滚动预算假设已保存');
    } catch (err) { fail500(res, err); }
});

router.get('/projection', async (req, res) => {
    try {
        const { bu_no, months } = req.query;
        if (!bu_no) return fail(res, '需要 bu_no', 400);
        ok(res, await project(bu_no, { months }));
    } catch (err) { fail500(res, err); }
});

router.get('/13w', async (req, res) => {
    try {
        const { bu_no } = req.query;
        if (!bu_no) return fail(res, '需要 bu_no', 400);
        ok(res, await cash13w(bu_no));
    } catch (err) { fail500(res, err); }
});

module.exports = router;
