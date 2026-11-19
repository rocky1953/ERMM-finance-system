/**
 * CFO-09 资金与流动性管理
 *
 * GET    /api/cash-liquidity/overview?bu_no=&YYYY_MM=   头寸、流动性比率、资金计划、贷款到期、待付款、预警、集团资金池
 * GET    /api/cash-liquidity/plans?bu_no=&plan_month=    资金计划明细
 * POST   /api/cash-liquidity/plans                       新增计划项
 * PUT    /api/cash-liquidity/plans/:uid                  编辑计划项
 * DELETE /api/cash-liquidity/plans/:uid                  删除计划项
 * POST   /api/cash-liquidity/scan                        扫描流动性风险并写入 alert_log
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const {
    BUS, DIRECTIONS, ITEM_TYPES,
    normalizeMonth, latestMonth, buildOverview, scanBuLiquidity
} = require('../services/cashLiquidity');

const n = (v) => Number(v || 0);
const r2 = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.round((x + Number.EPSILON) * 100) / 100 : 0;
};

function parseBu(v, dft = 'HM') {
    const s = String(v || dft).trim().toUpperCase();
    return BUS.includes(s) ? s : null;
}

function pickStr(v, max) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return null;
    return s.slice(0, max);
}

/**
 * 校验并整理资金计划项字段；partial=true 时仅处理传入字段
 */
function readPlanItem(body, partial) {
    const out = {};
    if (body.item_type !== undefined) {
        const t = String(body.item_type).trim().toUpperCase();
        if (!ITEM_TYPES[t]) return { error: '计划项类型无效' };
        out.item_type = t;
        out.direction = ITEM_TYPES[t].direction;
    } else if (!partial) {
        return { error: '计划项类型不能为空' };
    }

    if (body.direction !== undefined && out.direction === undefined) {
        const d = String(body.direction).trim().toUpperCase();
        if (!DIRECTIONS.includes(d)) return { error: '方向仅支持 IN/OUT' };
        out.direction = d;
    }

    if (body.plan_month !== undefined) {
        const m = normalizeMonth(body.plan_month);
        if (!m) return { error: '计划月份格式应为 YYYY-MM' };
        out.plan_month = m;
    } else if (!partial) {
        return { error: '计划月份不能为空' };
    }

    if (body.item_name !== undefined) {
        const v = pickStr(body.item_name, 100);
        if (!v) return { error: '计划项名称不能为空' };
        out.item_name = v;
    } else if (!partial) {
        return { error: '计划项名称不能为空' };
    }

    if (body.plan_amount !== undefined) {
        const a = Number(body.plan_amount === '' ? 0 : body.plan_amount);
        if (!Number.isFinite(a) || a < 0) return { error: '计划金额应为非负数字' };
        out.plan_amount = r2(a);
    } else if (!partial) {
        out.plan_amount = 0;
    }

    if (body.actual_amount !== undefined) {
        const a = Number(body.actual_amount === '' ? 0 : body.actual_amount);
        if (!Number.isFinite(a) || a < 0) return { error: '实际金额应为非负数字' };
        out.actual_amount = r2(a);
    } else if (!partial) {
        out.actual_amount = 0;
    }

    if (body.note !== undefined) out.note = pickStr(body.note, 500);
    return { value: out };
}

// 总览
router.get('/overview', async (req, res) => {
    try {
        const bu = parseBu(req.query.bu_no);
        if (!bu) return fail(res, '公司别仅支持 HM/HN/SZ');
        const month = normalizeMonth(req.query.YYYY_MM) || await latestMonth(bu);
        ok(res, await buildOverview(bu, month));
    } catch (err) { fail500(res, err); }
});

// 计划明细
router.get('/plans', async (req, res) => {
    try {
        const bu = parseBu(req.query.bu_no);
        if (!bu) return fail(res, '公司别仅支持 HM/HN/SZ');
        const month = normalizeMonth(req.query.plan_month) || await latestMonth(bu);
        const [rows] = await pool.execute(
            `SELECT * FROM cash_plan_item WHERE bu_no=? AND plan_month=?
              ORDER BY direction DESC, item_type, uid`, [bu, month]);
        ok(res, { bu_no: bu, plan_month: month, rows });
    } catch (err) { fail500(res, err); }
});

// 新增计划项
router.post('/plans', async (req, res) => {
    try {
        const bu = parseBu(req.body.bu_no);
        if (!bu) return fail(res, '公司别仅支持 HM/HN/SZ');
        const parsed = readPlanItem(req.body, false);
        if (parsed.error) return fail(res, parsed.error);
        const o = parsed.value;
        const operator = req.user?.user_id || req.body.operator_id || null;

        const [result] = await pool.execute(
            `INSERT INTO cash_plan_item
                (bu_no, plan_month, direction, item_type, item_name,
                 plan_amount, actual_amount, note, updated_by)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            [bu, o.plan_month, o.direction, o.item_type, o.item_name,
             o.plan_amount, o.actual_amount, o.note || null, operator]);

        const [rows] = await pool.execute(
            'SELECT * FROM cash_plan_item WHERE uid=?', [result.insertId]);
        ok(res, rows[0], '计划项已创建');
    } catch (err) { fail500(res, err); }
});

// 编辑计划项
router.put('/plans/:uid', async (req, res) => {
    try {
        const uid = Number(req.params.uid);
        if (!uid) return fail(res, '参数无效');
        const [cur] = await pool.execute('SELECT * FROM cash_plan_item WHERE uid=?', [uid]);
        if (!cur.length) return fail(res, '计划项不存在', 404);

        const parsed = readPlanItem(req.body, true);
        if (parsed.error) return fail(res, parsed.error);
        const merged = { ...cur[0], ...parsed.value };
        const operator = req.user?.user_id || req.body.operator_id || null;

        await pool.execute(
            `UPDATE cash_plan_item
                SET plan_month=?, direction=?, item_type=?, item_name=?,
                    plan_amount=?, actual_amount=?, note=?, updated_by=?
              WHERE uid=?`,
            [merged.plan_month, merged.direction, merged.item_type, merged.item_name,
             r2(merged.plan_amount), r2(merged.actual_amount), merged.note || null,
             operator, uid]);

        const [rows] = await pool.execute('SELECT * FROM cash_plan_item WHERE uid=?', [uid]);
        ok(res, rows[0], '计划项已更新');
    } catch (err) { fail500(res, err); }
});

// 删除计划项
router.delete('/plans/:uid', async (req, res) => {
    try {
        const uid = Number(req.params.uid);
        if (!uid) return fail(res, '参数无效');
        const [cur] = await pool.execute('SELECT uid FROM cash_plan_item WHERE uid=?', [uid]);
        if (!cur.length) return fail(res, '计划项不存在', 404);
        await pool.execute('DELETE FROM cash_plan_item WHERE uid=?', [uid]);
        ok(res, { uid }, '计划项已删除');
    } catch (err) { fail500(res, err); }
});

// 扫描流动性风险
router.post('/scan', async (req, res) => {
    try {
        const rawBu = String(req.body.bu_no || '').trim().toUpperCase();
        const month = normalizeMonth(req.body.YYYY_MM);
        const targets = (!rawBu || rawBu === 'ALL' || rawBu === 'GROUP') ? BUS : [parseBu(rawBu)];
        if (targets.some(b => !b)) return fail(res, '公司别仅支持 HM/HN/SZ');

        const results = [];
        for (const bu of targets) {
            results.push(await scanBuLiquidity(bu, month));
        }
        const created = results.reduce((s, r) => s + r.created.length, 0);
        const suppressed = results.reduce((s, r) => s + r.suppressed, 0);
        const scanned = results.reduce((s, r) => s + r.scanned, 0);
        ok(res, {
            scanned,
            created: created + suppressed,
            new_alerts: created,
            suppressed,
            results
        }, created ? `已生成 ${created} 条流动性风险预警` : '当前无新增流动性风险预警');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
