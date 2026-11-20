/**
 * CEO-01 战略目标与平衡计分卡
 *
 * GET    /api/strategy/overview            年度总览（目标评分、四维度、偏差、层级树、分公司得分）
 * GET    /api/strategy/objectives          目标清单（可按年度/公司/层级/维度筛选）
 * POST   /api/strategy/objectives          新增目标
 * PUT    /api/strategy/objectives/:id      编辑目标
 * DELETE /api/strategy/objectives/:id      删除目标（下级目标自动上提）
 * GET    /api/strategy/objectives/:id/progress   目标进度历史
 * POST   /api/strategy/objectives/:id/progress   录入月度实际值（同期间覆盖）
 * POST   /api/strategy/sync               从指标中心同步实际值
 * POST   /api/strategy/alerts/scan        扫描目标偏差并生成预警（CEO-01）
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const audit = require('../services/audit');
const { perms, readScope } = require('../middleware/perms');
const {
    BUS, LEVELS, PERSPECTIVES, DIRECTIONS,
    achievementOf, statusOf, buildOverview, buildRows,
    latestYear, loadObjectives, loadLatestProgress, saveProgress, syncKpis
} = require('../services/bsc');
const { scanTargets } = require('../services/bscAlertScanner');

const n = (v) => Number(v || 0);
const r2 = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.round((x + Number.EPSILON) * 100) / 100 : 0;
};

function parseYear(v, fallback) {
    const s = String(v || '').trim();
    return /^\d{4}$/.test(s) ? s : fallback;
}

function normalizeBu(v) {
    const s = String(v || '').trim().toUpperCase();
    if (!s) return 'GROUP';
    return (s === 'GROUP' || BUS.includes(s)) ? s : null;
}

function pickStr(v, max) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return null;
    return s.slice(0, max);
}

function toNum(v) {
    if (v === '' || v === null || v === undefined) return 0;
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
}

/**
 * 从请求体整理目标字段；partial=true 时缺省字段返回 undefined（不更新）
 */
function readObjective(body, partial) {
    const out = {};
    const put = (key, value) => { if (!partial || value !== undefined) out[key] = value; };

    if (body.fiscal_year !== undefined) {
        const y = String(body.fiscal_year).trim();
        if (!/^\d{4}$/.test(y)) return { error: '年度格式应为 YYYY' };
        out.fiscal_year = y;
    } else if (!partial) {
        out.fiscal_year = String(new Date().getFullYear());
    }

    if (body.level !== undefined) {
        const v = String(body.level).trim().toUpperCase();
        if (!LEVELS.includes(v)) return { error: '目标层级仅支持 COMPANY/DEPARTMENT/PERSONAL' };
        out.level = v;
    } else if (!partial) {
        out.level = 'COMPANY';
    }

    if (body.bu_no !== undefined) {
        const v = normalizeBu(body.bu_no);
        if (!v) return { error: '公司别仅支持 GROUP/HM/HN/SZ' };
        out.bu_no = v;
    } else if (!partial) {
        out.bu_no = 'GROUP';
    }

    if (body.perspective !== undefined) {
        const v = String(body.perspective).trim().toUpperCase();
        if (!PERSPECTIVES.includes(v)) return { error: '维度仅支持 FINANCIAL/CUSTOMER/PROCESS/LEARNING' };
        out.perspective = v;
    } else if (!partial) {
        out.perspective = 'FINANCIAL';
    }

    if (body.objective_name !== undefined) {
        const v = pickStr(body.objective_name, 150);
        if (!v) return { error: '目标名称不能为空' };
        out.objective_name = v;
    } else if (!partial) {
        return { error: '目标名称不能为空' };
    }

    if (body.metric_direction !== undefined) {
        const v = String(body.metric_direction).trim().toUpperCase();
        if (!DIRECTIONS.includes(v)) return { error: '指标方向仅支持 UP/DOWN' };
        out.metric_direction = v;
    } else if (!partial) {
        out.metric_direction = 'UP';
    }

    if (body.weight !== undefined) {
        const w = toNum(body.weight);
        if (w < 0 || w > 100) return { error: '权重应在 0~100 之间' };
        out.weight = r2(w);
    } else if (!partial) {
        out.weight = 0;
    }

    if (body.baseline_value !== undefined) out.baseline_value = toNum(body.baseline_value);
    else if (!partial) out.baseline_value = 0;

    if (body.target_value !== undefined) out.target_value = toNum(body.target_value);
    else if (!partial) out.target_value = 0;

    if (body.metric_name !== undefined) out.metric_name = pickStr(body.metric_name, 100);
    if (body.unit !== undefined) out.unit = pickStr(body.unit, 20);
    if (body.kpi_id !== undefined) out.kpi_id = pickStr(body.kpi_id, 50);
    if (body.scope_name !== undefined) out.scope_name = pickStr(body.scope_name, 100);
    if (body.owner_id !== undefined) out.owner_id = pickStr(body.owner_id, 50);
    if (body.remark !== undefined) out.remark = pickStr(body.remark, 500);
    if (body.status !== undefined) out.status = Number(body.status) === 0 ? 0 : 1;

    if (body.parent_id !== undefined) {
        const p = body.parent_id === '' || body.parent_id === null ? null : Number(body.parent_id);
        if (p !== null && !Number.isInteger(p)) return { error: '上级目标参数无效' };
        out.parent_id = p;
    }

    return { value: out };
}

// 总览
router.get('/overview', async (req, res) => {
    try {
        const year = parseYear(req.query.YYYY, await latestYear());
        const rawBu = String(req.query.bu_no || '').trim().toUpperCase();
        let bu = '';
        if (rawBu && rawBu !== 'ALL') {
            bu = normalizeBu(rawBu);
            if (!bu) return fail(res, '公司别仅支持 GROUP/HM/HN/SZ');
        }
        ok(res, await buildOverview(year, bu));
    } catch (err) { fail500(res, err); }
});

// 目标清单
router.get('/objectives', async (req, res) => {
    try {
        const year = parseYear(req.query.YYYY, await latestYear());
        let bu = '';
        if (req.query.bu_no) {
            bu = normalizeBu(req.query.bu_no);
            if (!bu) return fail(res, '公司别仅支持 GROUP/HM/HN/SZ');
        }
        const level = String(req.query.level || '').toUpperCase();
        const perspective = String(req.query.perspective || '').toUpperCase();

        const [objectives, latestMap] = await Promise.all([
            loadObjectives(year, bu),
            loadLatestProgress(year)
        ]);
        let rows = buildRows(objectives, latestMap);
        if (LEVELS.includes(level)) rows = rows.filter(r => r.level === level);
        if (PERSPECTIVES.includes(perspective)) rows = rows.filter(r => r.perspective === perspective);

        ok(res, { YYYY: year, bu_no: bu, rows });
    } catch (err) { fail500(res, err); }
});

// 新增
router.post('/objectives', async (req, res) => {
    try {
        const parsed = readObjective(req.body, false);
        if (parsed.error) return fail(res, parsed.error);
        const o = parsed.value;

        if (o.parent_id) {
            const [p] = await pool.execute(
                'SELECT objective_id, fiscal_year FROM bsc_objective WHERE objective_id=?',
                [o.parent_id]);
            if (!p.length) return fail(res, '上级目标不存在');
            if (String(p[0].fiscal_year) !== o.fiscal_year) return fail(res, '上级目标须与当前目标同一年度');
        }

        const [result] = await pool.execute(
            `INSERT INTO bsc_objective
                (fiscal_year, level, bu_no, perspective, objective_name, metric_name, unit,
                 metric_direction, baseline_value, target_value, weight, kpi_id,
                 scope_name, owner_id, parent_id, status, remark)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [o.fiscal_year, o.level, o.bu_no, o.perspective, o.objective_name,
             o.metric_name || null, o.unit || null, o.metric_direction,
             o.baseline_value, o.target_value, o.weight, o.kpi_id || null,
             o.scope_name || null, o.owner_id || null, o.parent_id || null,
             o.status === undefined ? 1 : o.status, o.remark || null]);

        const [rows] = await pool.execute(
            'SELECT * FROM bsc_objective WHERE objective_id=?', [result.insertId]);
        audit.log(req, {
            module: 'strategy', action: 'CREATE', businessType: 'BSC-OBJ',
            businessId: String(result.insertId),
            summary: `创建BSC目标 ${o.fiscal_year} ${o.bu_no || 'GROUP'} ${o.perspective || ''} "${o.objective_name}" 目标值=${o.target_value}`,
            after: rows[0]
        });
        ok(res, rows[0], '目标已创建');
    } catch (err) { fail500(res, err); }
});

// 编辑
router.put('/objectives/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!id) return fail(res, '参数无效');
        const [cur] = await pool.execute('SELECT * FROM bsc_objective WHERE objective_id=?', [id]);
        if (!cur.length) return fail(res, '目标不存在', 404);

        const parsed = readObjective(req.body, true);
        if (parsed.error) return fail(res, parsed.error);
        const o = parsed.value;

        if (o.parent_id) {
            if (o.parent_id === id) return fail(res, '上级目标不能是自己');
            const [p] = await pool.execute(
                'SELECT objective_id, fiscal_year FROM bsc_objective WHERE objective_id=?',
                [o.parent_id]);
            if (!p.length) return fail(res, '上级目标不存在');
            const year = o.fiscal_year || String(cur[0].fiscal_year);
            if (String(p[0].fiscal_year) !== year) return fail(res, '上级目标须与当前目标同一年度');
        }

        const merged = { ...cur[0], ...o };
        await pool.execute(
            `UPDATE bsc_objective SET
                fiscal_year=?, level=?, bu_no=?, perspective=?, objective_name=?,
                metric_name=?, unit=?, metric_direction=?, baseline_value=?, target_value=?,
                weight=?, kpi_id=?, scope_name=?, owner_id=?, parent_id=?, status=?, remark=?
              WHERE objective_id=?`,
            [merged.fiscal_year, merged.level, merged.bu_no, merged.perspective,
             merged.objective_name, merged.metric_name || null, merged.unit || null,
             merged.metric_direction, toNum(merged.baseline_value), toNum(merged.target_value),
             r2(merged.weight), merged.kpi_id || null, merged.scope_name || null,
             merged.owner_id || null, merged.parent_id || null,
             Number(merged.status) === 0 ? 0 : 1, merged.remark || null, id]);

        const [rows] = await pool.execute('SELECT * FROM bsc_objective WHERE objective_id=?', [id]);
        audit.log(req, {
            module: 'strategy', action: 'UPDATE', businessType: 'BSC-OBJ',
            businessId: String(id),
            summary: `编辑BSC目标 id=${id} "${cur[0]?.objective_name || ''}" ${o.objective_name !== undefined ? '→ ' + o.objective_name : ''}`,
            before: cur[0],
            after: rows[0]
        });
        ok(res, rows[0], '目标已更新');
    } catch (err) { fail500(res, err); }
});

// 删除（下级目标上提为顶级）
router.delete('/objectives/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!id) return fail(res, '参数无效');
        const [rows] = await pool.execute('SELECT objective_id FROM bsc_objective WHERE objective_id=?', [id]);
        if (!rows.length) return fail(res, '目标不存在', 404);
        // 先查完整快照
        const [full] = await pool.execute('SELECT * FROM bsc_objective WHERE objective_id=?', [id]);

        await pool.execute('UPDATE bsc_objective SET parent_id=NULL WHERE parent_id=?', [id]);
        await pool.execute('DELETE FROM bsc_progress WHERE objective_id=?', [id]);
        await pool.execute('DELETE FROM bsc_objective WHERE objective_id=?', [id]);

        audit.log(req, {
            module: 'strategy', action: 'DELETE', businessType: 'BSC-OBJ',
            businessId: String(id),
            summary: `删除BSC目标 id=${id} "${full[0]?.objective_name || ''}" ${full[0]?.fiscal_year || ''} ${full[0]?.bu_no || ''}`,
            before: full[0]
        });
        ok(res, { objective_id: id }, '目标已删除');
    } catch (err) { fail500(res, err); }
});

// 进度历史
router.get('/objectives/:id/progress', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!id) return fail(res, '参数无效');
        const [obj] = await pool.execute('SELECT * FROM bsc_objective WHERE objective_id=?', [id]);
        if (!obj.length) return fail(res, '目标不存在', 404);

        const [rows] = await pool.execute(
            'SELECT * FROM bsc_progress WHERE objective_id=? ORDER BY period', [id]);
        const o = obj[0];
        ok(res, {
            objective_id: id,
            objective_name: o.objective_name,
            rows: rows.map(p => {
                const achievement = achievementOf(o, p.actual_value);
                return {
                    ...p,
                    actual_value: r2(p.actual_value),
                    achievement,
                    status: statusOf(achievement)
                };
            })
        });
    } catch (err) { fail500(res, err); }
});

// 录入进度（同目标同期间覆盖）
router.post('/objectives/:id/progress', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!id) return fail(res, '参数无效');
        const [obj] = await pool.execute('SELECT * FROM bsc_objective WHERE objective_id=?', [id]);
        if (!obj.length) return fail(res, '目标不存在', 404);

        const now = new Date();
        const dftPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const period = String(req.body.period || dftPeriod).trim();
        if (!/^\d{4}-\d{2}$/.test(period)) return fail(res, '期间格式应为 YYYY-MM');
        if (!/^\d{4}$/.test(period.slice(0, 4)) || Number(period.slice(5, 7)) < 1 || Number(period.slice(5, 7)) > 12) {
            return fail(res, '期间格式应为 YYYY-MM');
        }

        const rawActual = req.body.actual_value;
        if (rawActual === '' || rawActual === null || rawActual === undefined) return fail(res, '请填写实际值');
        const actual = Number(rawActual);
        if (!Number.isFinite(actual)) return fail(res, '实际值应为数字');

        const note = pickStr(req.body.note, 500);
        const operator = req.user?.user_id || req.body.operator_id || null;
        await saveProgress(id, period, r2(actual), 'MANUAL', note, operator);

        const [rows] = await pool.execute(
            'SELECT * FROM bsc_progress WHERE objective_id=? AND period=?', [id, period]);
        const achievement = achievementOf(obj[0], rows[0].actual_value);

        audit.log(req, {
            module: 'strategy', action: 'UPDATE', businessType: 'BSC-PROGRESS',
            businessId: `${id}/${period}`,
            summary: `录入BSC进度 目标id=${id}(${obj[0]?.objective_name || ''}) ${period} 实际=${actual} 达成率=${achievement}%`,
            detail: { objective_id: id, period, actual_value: actual, target_value: obj[0]?.target_value, achievement }
        });

        ok(res, {
            ...rows[0],
            actual_value: r2(rows[0].actual_value),
            achievement,
            status: statusOf(achievement)
        }, '进度已保存');
    } catch (err) { fail500(res, err); }
});

// 指标中心同步
router.post('/sync', perms('strategy','SYNC'), async (req, res) => {
    try {
        const year = parseYear(req.body.YYYY, await latestYear());
        const rawBu = String(req.body.bu_no || '').trim().toUpperCase();
        let bu = '';
        if (rawBu && rawBu !== 'GROUP' && rawBu !== 'ALL') {
            if (!BUS.includes(rawBu)) return fail(res, '公司别仅支持 GROUP/HM/HN/SZ');
            bu = rawBu;
        }
        const r = await syncKpis(year, bu);
        audit.log(req, {
            module: 'strategy', action: 'CREATE', businessType: 'BSC-SYNC',
            businessId: `sync/${year}/${bu || 'GROUP'}`,
            summary: `从指标中心同步BSC目标实际值 ${year} ${bu || 'GROUP'} 共${r.synced}条`,
            detail: { YYYY: year, bu_no: bu || 'GROUP', synced: r.synced, failed: r.failed || 0 }
        });
        ok(res, r, r.synced
            ? `已从指标中心同步 ${r.synced} 个目标实际值`
            : '没有可同步的目标（需挂接指标中心 KPI 且公司有财务数据）');
    } catch (err) { fail500(res, err); }
});

// 目标偏差预警扫描（CEO-01）
router.post('/alerts/scan', perms('strategy','SYNC'), async (req, res) => {
    try {
        const year = parseYear(req.body.YYYY, await latestYear());
        const r = await scanTargets({
            YYYY: year,
            threshold: req.body.threshold,
            cooldownHours: req.body.cooldown_hours,
            bu_no: req.body.bu_no
        });
        audit.log(req, {
            module: 'strategy', action: 'CREATE', businessType: 'BSC-ALERT',
            businessId: `scan/${year}`,
            summary: `扫描BSC目标偏差 ${year}：扫描${r.scanned}项，新增预警${r.triggered}条，冷却抑制${r.suppressed}条`,
            detail: { YYYY: year, threshold: r.threshold, triggered: r.triggered, suppressed: r.suppressed }
        });
        ok(res, r, r.triggered
            ? `已生成 ${r.triggered} 条目标偏差预警`
            : '未发现新的目标偏差（可能均在阈值内或处于冷却期）');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
