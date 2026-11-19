/**
 * CEO-01 战略目标与平衡计分卡
 *
 * 设计要点：
 * 1. 目标分三级：公司（COMPANY）→ 部门（DEPARTMENT）→ 个人（PERSONAL），parent_id 串联。
 * 2. 目标按平衡计分卡四维度归类：财务 / 客户 / 内部流程 / 学习成长。
 * 3. 达成率按基线值与目标值线性折算，正/逆向指标方向不同；封顶 120% 防止单项刷分。
 * 4. 得分 = 达成率 × 权重 / 100；总分 = 各目标得分合计（权重合计为 100 时即加权达成率）。
 * 5. 实际值来源：手工录入（MANUAL）或指标中心同步（KPI，复用 kpiQuery.computeKpis）。
 */
const { pool } = require('../config/db');
const { computeKpis } = require('../routes/kpiQuery');

const BUS = ['HM', 'HN', 'SZ'];
const LEVELS = ['COMPANY', 'DEPARTMENT', 'PERSONAL'];
const PERSPECTIVES = ['FINANCIAL', 'CUSTOMER', 'PROCESS', 'LEARNING'];
const DIRECTIONS = ['UP', 'DOWN'];
const LEVEL_ORDER = { COMPANY: 0, DEPARTMENT: 1, PERSONAL: 2 };
const PERSPECTIVE_ORDER = { FINANCIAL: 0, CUSTOMER: 1, PROCESS: 2, LEARNING: 3 };

const n = (v) => Number(v || 0);
const r2 = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.round((x + Number.EPSILON) * 100) / 100 : 0;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * 达成率：正/逆向指标均折算为「基线 0% → 目标 100%」，封顶 120%
 * 正逆向指标的达成率统一符号，便于跨指标比较。
 */
function achievementOf(obj, actual) {
    if (actual === null || actual === undefined || actual === '') return null;
    const a = Number(actual);
    if (!Number.isFinite(a)) return null;
    const base = n(obj.baseline_value);
    const target = n(obj.target_value);
    const dir = String(obj.metric_direction || 'UP').toUpperCase();

    let ach;
    if (target === base) {
        ach = dir === 'DOWN' ? (a <= target ? 100 : 0) : (a >= target ? 100 : 0);
    } else if (dir === 'DOWN') {
        ach = ((base - a) / (base - target)) * 100;
    } else {
        ach = ((a - base) / (target - base)) * 100;
    }
    if (!Number.isFinite(ach)) return null;
    return clamp(r2(ach), 0, 120);
}

function statusOf(achievement) {
    if (achievement === null) return 'PENDING';
    if (achievement >= 100) return 'ON_TRACK';
    if (achievement >= 80) return 'WARNING';
    return 'LAGGING';
}

/**
 * 单个目标评分
 */
function scoreObjective(obj, actual, period) {
    const achievement = achievementOf(obj, actual);
    const weight = r2(obj.weight);
    const score = achievement === null ? 0 : r2((achievement * weight) / 100);
    const target = n(obj.target_value);
    const dir = String(obj.metric_direction || 'UP').toUpperCase();
    const actualValue = achievement === null ? null : Number(actual);
    // 偏差：正数=超额完成，负数=存在缺口（已按指标方向统一符号）
    const gap = actualValue === null ? null : r2(dir === 'DOWN' ? target - actualValue : actualValue - target);
    const gapPct = actualValue === null || target === 0 ? null : r2((gap / Math.abs(target)) * 100);
    return {
        actual_value: actualValue,
        period: period || null,
        achievement,
        score,
        weight,
        status: statusOf(achievement),
        gap,
        gap_pct: gapPct
    };
}

/**
 * 区间汇总（整体 / 单一维度 / 单一公司）
 */
function summarize(rows) {
    const weight = r2(rows.reduce((s, r) => s + r2(r.weight), 0));
    const score = r2(rows.reduce((s, r) => s + r2(r.score), 0));
    const achievement = weight > 0 ? r2((score * 100) / weight) : null;
    const counts = { ON_TRACK: 0, WARNING: 0, LAGGING: 0, PENDING: 0 };
    for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
    return {
        count: rows.length,
        weight,
        score,
        achievement,
        on_track: counts.ON_TRACK,
        warning: counts.WARNING,
        lagging: counts.LAGGING,
        pending: counts.PENDING
    };
}

function buildPerspectives(rows) {
    return PERSPECTIVES.map(key => ({
        key,
        ...summarize(rows.filter(r => r.perspective === key))
    }));
}

function buildDeviations(rows, limit = 10) {
    return rows
        .filter(r => r.achievement !== null && r.achievement < 100)
        .sort((a, b) => a.achievement - b.achievement || b.weight - a.weight)
        .slice(0, limit)
        .map(r => ({
            objective_id: r.objective_id,
            objective_name: r.objective_name,
            level: r.level,
            bu_no: r.bu_no,
            perspective: r.perspective,
            metric_name: r.metric_name,
            unit: r.unit,
            target_value: r.target_value,
            actual_value: r.actual_value,
            achievement: r.achievement,
            gap: r.gap,
            gap_pct: r.gap_pct,
            weight: r.weight,
            period: r.period,
            status: r.status
        }));
}

function buildBuScores(rows) {
    const buList = ['GROUP', ...BUS];
    return buList.map(bu => ({
        bu_no: bu,
        ...summarize(rows.filter(r => r.bu_no === bu))
    }));
}

/**
 * 公司 → 部门 → 个人 层级树
 */
function buildTree(rows) {
    const byId = new Map();
    for (const r of rows) {
        byId.set(r.objective_id, { ...r, children: [] });
    }
    const roots = [];
    for (const node of byId.values()) {
        const parent = node.parent_id ? byId.get(node.parent_id) : null;
        if (parent) parent.children.push(node);
        else roots.push(node);
    }
    const sortNodes = (list) => {
        list.sort((a, b) =>
            (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9)
            || (PERSPECTIVE_ORDER[a.perspective] ?? 9) - (PERSPECTIVE_ORDER[b.perspective] ?? 9)
            || a.objective_id - b.objective_id);
        list.forEach(x => sortNodes(x.children));
    };
    sortNodes(roots);
    return roots;
}

function sortRows(rows) {
    return rows.slice().sort((a, b) =>
        (PERSPECTIVE_ORDER[a.perspective] ?? 9) - (PERSPECTIVE_ORDER[b.perspective] ?? 9)
        || (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9)
        || (b.weight - a.weight)
        || a.objective_id - b.objective_id);
}

async function latestYear() {
    const [rows] = await pool.execute(
        'SELECT MAX(fiscal_year) AS y FROM bsc_objective');
    const y = rows[0]?.y ? String(rows[0].y).slice(0, 4) : '';
    return /^\d{4}$/.test(y) ? y : String(new Date().getFullYear());
}

async function availableYears() {
    const [rows] = await pool.execute(
        'SELECT DISTINCT fiscal_year FROM bsc_objective ORDER BY fiscal_year DESC');
    return rows.map(r => String(r.fiscal_year));
}

async function loadObjectives(YYYY, buNo) {
    let sql = 'SELECT * FROM bsc_objective WHERE fiscal_year=? AND status=1';
    const params = [YYYY];
    if (buNo) { sql += ' AND bu_no=?'; params.push(buNo); }
    const [rows] = await pool.execute(sql, params);
    return rows;
}

/**
 * 年度进度：每个目标取最新一期
 */
async function loadLatestProgress(YYYY) {
    const [rows] = await pool.execute(
        `SELECT * FROM bsc_progress WHERE period LIKE ? ORDER BY objective_id, period`,
        [`${YYYY}%`]);
    const map = new Map();
    for (const p of rows) map.set(p.objective_id, p);
    return map;
}

function buildRows(objectives, latestMap) {
    return objectives.map(o => {
        const p = latestMap.get(o.objective_id) || null;
        const scored = scoreObjective(o, p ? p.actual_value : null, p ? p.period : null);
        return {
            ...o,
            ...scored,
            weight: r2(o.weight),
            baseline_value: r2(o.baseline_value),
            target_value: r2(o.target_value),
            source: p ? p.source : null,
            note: p ? p.note : null
        };
    });
}

/**
 * 年度总览
 */
async function buildOverview(YYYY, buNo) {
    const year = /^\d{4}$/.test(String(YYYY || '')) ? String(YYYY) : await latestYear();
    const [objectives, latestMap, years] = await Promise.all([
        loadObjectives(year, buNo || ''),
        loadLatestProgress(year),
        availableYears()
    ]);
    const rows = sortRows(buildRows(objectives, latestMap));

    return {
        YYYY: year,
        bu_no: buNo || '',
        years,
        objectives: rows,
        total: summarize(rows),
        perspectives: buildPerspectives(rows),
        bu_scores: buildBuScores(rows),
        deviations: buildDeviations(rows),
        tree: buildTree(rows)
    };
}

async function saveProgress(objectiveId, period, actualValue, source, note, user) {
    await pool.execute(
        `INSERT INTO bsc_progress (objective_id, period, actual_value, source, note, created_by)
         VALUES (?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
            actual_value=VALUES(actual_value), source=VALUES(source),
            note=VALUES(note), created_by=VALUES(created_by)`,
        [objectiveId, period, actualValue, source, note, user]);
}

/**
 * 从指标中心同步实际值
 * 仅处理挂在 HM/HN/SZ 且配置了 kpi_id 的目标，取该年度最新有财务数据的月份。
 */
async function syncKpis(YYYY, buNo) {
    const year = /^\d{4}$/.test(String(YYYY || '')) ? String(YYYY) : await latestYear();
    const bus = BUS.includes(buNo) ? [buNo] : BUS;

    const [objectives] = await pool.execute(
        `SELECT * FROM bsc_objective
          WHERE fiscal_year=? AND status=1 AND kpi_id IS NOT NULL AND kpi_id<>''
            AND bu_no IN (${bus.map(() => '?').join(',')})`,
        [year, ...bus]);

    const kpiCache = new Map();
    const monthMap = new Map();
    for (const bu of bus) {
        const [rows] = await pool.execute(
            `SELECT MAX(YYYY_MM) AS m FROM mgm_finance_summary WHERE bu_no=? AND YYYY=?`,
            [bu, year]);
        monthMap.set(bu, rows[0]?.m ? String(rows[0].m).slice(0, 7) : null);
    }

    const details = [];
    const warnings = [];
    let synced = 0;
    let skipped = 0;

    for (const obj of objectives) {
        const month = monthMap.get(obj.bu_no);
        if (!month) {
            skipped++;
            warnings.push(`${obj.bu_no} 无 ${year} 年财务数据，目标「${obj.objective_name}」未同步`);
            continue;
        }
        const cacheKey = `${obj.bu_no}|${month}`;
        if (!kpiCache.has(cacheKey)) {
            kpiCache.set(cacheKey, await computeKpis(obj.bu_no, month));
        }
        const kpis = kpiCache.get(cacheKey);
        const kpi = kpis ? kpis[obj.kpi_id] : null;
        if (!kpi || kpi.value === null || kpi.value === undefined) {
            skipped++;
            warnings.push(`${obj.bu_no} ${month} 指标 ${obj.kpi_id} 无有效值，目标「${obj.objective_name}」未同步`);
            continue;
        }
        await saveProgress(obj.objective_id, month, kpi.value,
            'KPI', `指标中心同步：${kpi.name || obj.kpi_id}`, 'system');
        synced++;
        details.push({
            objective_id: obj.objective_id,
            objective_name: obj.objective_name,
            bu_no: obj.bu_no,
            kpi_id: obj.kpi_id,
            period: month,
            value: r2(kpi.value)
        });
    }

    return { YYYY: year, synced, skipped, details, warnings };
}

module.exports = {
    BUS, LEVELS, PERSPECTIVES, DIRECTIONS,
    achievementOf, statusOf, scoreObjective, summarize,
    buildOverview, buildRows, buildDeviations, buildTree,
    latestYear, availableYears, loadObjectives, loadLatestProgress,
    saveProgress, syncKpis
};
