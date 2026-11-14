/**
 * 多维盈利分析（CFO-06）
 * 客户 / 产品 / 渠道 / 项目
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const { getDimension, getDetails, getSummary } = require('../services/profit');

const CHANNELS = ['DIRECT', 'DEALER', 'EXPORT', 'GROUP', 'OTHER'];

router.get('/summary', async (req, res) => {
    try {
        const { bu_no, YYYY_MM, YYYY } = req.query;
        if (!bu_no) return fail(res, '需要 bu_no', 400);
        ok(res, await getSummary(bu_no, YYYY_MM, YYYY));
    } catch (err) { fail500(res, err); }
});

router.get('/dimension', async (req, res) => {
    try {
        const { bu_no, YYYY_MM, YYYY, dim } = req.query;
        if (!bu_no) return fail(res, '需要 bu_no', 400);
        if (!dim) return fail(res, '需要 dim（customer/product/channel/project）', 400);
        ok(res, await getDimension(bu_no, YYYY_MM, dim, YYYY));
    } catch (err) {
        if (/维度非法/.test(err.message)) return fail(res, err.message, 400);
        fail500(res, err);
    }
});

router.get('/details', async (req, res) => {
    try {
        const { bu_no, YYYY_MM, YYYY, dim, key } = req.query;
        if (!bu_no || !dim || key == null || key === '') return fail(res, '需要 bu_no、dim、key', 400);
        ok(res, await getDetails(bu_no, YYYY_MM, dim, key, YYYY));
    } catch (err) {
        if (/维度非法/.test(err.message)) return fail(res, err.message, 400);
        fail500(res, err);
    }
});

// ===== 渠道映射覆盖 =====
router.put('/channel', async (req, res) => {
    try {
        const { bu_no, client_id, channel_code } = req.body;
        if (!bu_no || !client_id) return fail(res, '需要 bu_no 与 client_id', 400);
        if (!CHANNELS.includes(channel_code)) return fail(res, '渠道代码非法', 400);
        await pool.execute(`
            INSERT INTO sales_channel_map (bu_no, client_id, channel_code, update_by)
            VALUES (?,?,?,?)
            ON DUPLICATE KEY UPDATE channel_code=VALUES(channel_code), update_by=VALUES(update_by)`,
            [bu_no, client_id, channel_code, req.user ? req.user.user_id : null]);
        ok(res, { client_id, channel_code }, '渠道映射已保存');
    } catch (err) { fail500(res, err); }
});

router.delete('/channel/:client_id', async (req, res) => {
    try {
        const { bu_no } = req.query;
        if (!bu_no) return fail(res, '需要 bu_no', 400);
        await pool.execute('DELETE FROM sales_channel_map WHERE bu_no=? AND client_id=?',
            [bu_no, req.params.client_id]);
        ok(res, null, '已恢复默认渠道规则');
    } catch (err) { fail500(res, err); }
});

// ===== 料件成本率覆盖（无标准成本时按售价×成本率估算）=====
router.get('/cost-rates', async (req, res) => {
    try {
        const { bu_no } = req.query;
        if (!bu_no) return fail(res, '需要 bu_no', 400);
        const [rows] = await pool.execute(
            `SELECT xitems, cost_rate, update_by, update_time
             FROM profit_cost_rate WHERE bu_no=? ORDER BY xitems`, [bu_no]);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.put('/cost-rate', async (req, res) => {
    try {
        const { bu_no, xitems, cost_rate } = req.body;
        if (!bu_no || !xitems) return fail(res, '需要 bu_no 与 xitems', 400);
        const rate = Number(cost_rate);
        if (!(rate > 0 && rate < 1)) return fail(res, '成本率需在 0~1 之间', 400);
        await pool.execute(`
            INSERT INTO profit_cost_rate (bu_no, xitems, cost_rate, update_by)
            VALUES (?,?,?,?)
            ON DUPLICATE KEY UPDATE cost_rate=VALUES(cost_rate), update_by=VALUES(update_by)`,
            [bu_no, xitems, rate, req.user ? req.user.user_id : null]);
        ok(res, { xitems, cost_rate: rate }, '成本率已保存');
    } catch (err) { fail500(res, err); }
});

router.delete('/cost-rate/:xitems', async (req, res) => {
    try {
        const { bu_no } = req.query;
        if (!bu_no) return fail(res, '需要 bu_no', 400);
        await pool.execute('DELETE FROM profit_cost_rate WHERE bu_no=? AND xitems=?',
            [bu_no, req.params.xitems]);
        ok(res, null, '已清除成本率，恢复标准成本/公司成本率口径');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
