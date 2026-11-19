/**
 * CEO-03 投资与资本配置决策
 *
 * 1. 项目量化评估：NPV、IRR、静态/动态回收期、获利指数 PI、ROI
 * 2. 敏感性分析：折现率 ±2pp、年现金流 ±10%、初始投资 ±10% 对 NPV 的影响
 * 3. 资本配置：年度资本预算 vs 已批准投资，按公司别/类别汇总，按 PI 排序给出优先级
 * 4. 投后跟踪：计划 vs 实际现金流偏差
 */
const { pool } = require('../config/db');

const BUS = ['GROUP', 'HM', 'HN', 'SZ'];
const CATEGORIES = {
    CAPACITY: '产能扩张', EQUIPMENT: '设备购置', RD: '研发投入',
    IT: '信息化', MA: '并购投资', OTHER: '其他'
};
const STATUSES = {
    DRAFT: '草拟', REVIEW: '审批中', APPROVED: '已批准', IN_PROGRESS: '实施中',
    COMPLETED: '已完成', ON_HOLD: '暂缓', REJECTED: '已否决'
};
// 计入资本已配置的状态
const COMMITTED = ['APPROVED', 'IN_PROGRESS', 'COMPLETED'];
// 仍在决策管道中的状态
const PIPELINE = ['DRAFT', 'REVIEW'];

const n = (v) => Number(v || 0);
const r2 = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.round((x + Number.EPSILON) * 100) / 100 : 0;
};
const r4 = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.round((x + Number.EPSILON) * 10000) / 10000 : 0;
};

// ============ 财务函数 ============
// flows[0] 为期初投入（负数），flows[t] 为第 t 年净现金流
function npvOf(ratePct, flows) {
    const r = Number(ratePct) / 100;
    let v = 0;
    for (let t = 0; t < flows.length; t++) v += Number(flows[t] || 0) / Math.pow(1 + r, t);
    return v;
}

function irrOf(flows) {
    if (!flows.length) return null;
    if (npvOf(0, flows) === 0) return 0;
    let lo = -0.9;
    let hi = 10;
    let fLo = npvOf(lo * 100, flows);
    let fHi = npvOf(hi * 100, flows);
    if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;
    for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2;
        const fMid = npvOf(mid * 100, flows);
        if (fLo * fMid <= 0) { hi = mid; fHi = fMid; } else { lo = mid; fLo = fMid; }
    }
    return ((lo + hi) / 2) * 100;
}

// 回收期：累计现金流由负转正所需年数（含小数）
function paybackOf(flows, ratePct) {
    const r = Number(ratePct) / 100;
    let cum = 0;
    for (let t = 0; t < flows.length; t++) {
        const cf = t === 0 ? Number(flows[0] || 0) : Number(flows[t] || 0) / Math.pow(1 + r, t);
        const prev = cum;
        cum += cf;
        if (t > 0 && prev < 0 && cum >= 0) {
            const ratio = Math.abs(prev) / (Math.abs(prev) + cum);
            return r2(t - 1 + ratio);
        }
    }
    return null;
}

/**
 * 项目指标；cfs 为 investment_cashflow 行，field 指定取计划或实际值
 */
function metricsOf(project, cfs, field = 'planned_amount') {
    const horizon = Math.max(1, Number(project.horizon_years) || (cfs.length || 1));
    const annual = {};
    for (const c of cfs) annual[Number(c.year_index)] = n(c[field]);

    const flows = [-n(project.initial_investment)];
    let totalInflow = 0;
    for (let y = 1; y <= horizon; y++) {
        let v = Number(annual[y] || 0);
        if (y === horizon) v += n(project.salvage_value);
        flows.push(v);
        totalInflow += v;
    }

    const rate = n(project.discount_rate);
    const npv = npvOf(rate, flows);
    const irr = irrOf(flows);
    const pvInflow = flows.slice(1).reduce((s, v, i) => s + v / Math.pow(1 + rate / 100, i + 1), 0);
    const initial = n(project.initial_investment);
    const pi = initial > 0 ? pvInflow / initial : null;
    const roi = initial > 0 ? ((totalInflow - initial) / initial) * 100 : null;

    return {
        horizon_years: horizon,
        flows,
        initial_investment: r2(initial),
        total_inflow: r2(totalInflow),
        npv: r2(npv),
        irr: irr === null ? null : r2(irr),
        payback: paybackOf(flows, 0),
        discounted_payback: paybackOf(flows, rate),
        pi: pi === null ? null : r2(pi),
        roi: roi === null ? null : r2(roi)
    };
}

// ============ 数据加载 ============
async function loadProjects(YYYY, buNo) {
    let sql = 'SELECT * FROM investment_project WHERE 1=1';
    const params = [];
    if (YYYY) { sql += ' AND fiscal_year=?'; params.push(YYYY); }
    if (buNo && buNo !== 'ALL') { sql += ' AND bu_no=?'; params.push(buNo); }
    sql += ' ORDER BY priority, project_id';
    const [rows] = await pool.execute(sql, params);
    return rows;
}

async function loadCashflows(projectIds) {
    if (!projectIds.length) return new Map();
    const ph = projectIds.map(() => '?').join(',');
    const [rows] = await pool.execute(
        `SELECT * FROM investment_cashflow WHERE project_id IN (${ph}) ORDER BY project_id, year_index`,
        projectIds);
    const map = new Map();
    for (const r of rows) {
        if (!map.has(r.project_id)) map.set(r.project_id, []);
        map.get(r.project_id).push(r);
    }
    return map;
}

async function loadBudgets(YYYY, buNo) {
    let sql = 'SELECT * FROM investment_budget WHERE fiscal_year=?';
    const params = [YYYY];
    if (buNo && buNo !== 'ALL') { sql += ' AND bu_no=?'; params.push(buNo); }
    const [rows] = await pool.execute(sql, params);
    return rows;
}

/**
 * 建立/补齐项目分年度现金流：缺失年度按等额年现金流生成，超出期限且无实际值的年度删除
 */
async function ensureCashflows(project) {
    const horizon = Math.max(1, n(project.horizon_years) || 1);
    const [rows] = await pool.execute(
        'SELECT year_index FROM investment_cashflow WHERE project_id=?', [project.project_id]);
    const exist = new Set(rows.map(r => Number(r.year_index)));
    const missing = [];
    for (let y = 1; y <= horizon; y++) if (!exist.has(y)) missing.push(y);
    if (missing.length) {
        const annual = n(project.annual_cashflow);
        const values = missing.map(() => '(?,?,?,?,?)');
        const params = [];
        for (const y of missing) {
            params.push(project.project_id, y, annual, 0, '系统按等额年现金流生成');
        }
        await pool.execute(
            `INSERT INTO investment_cashflow (project_id, year_index, planned_amount, actual_amount, note)
             VALUES ${values.join(',')}`, params);
    }
    await pool.execute(
        `DELETE FROM investment_cashflow
          WHERE project_id=? AND year_index>? AND actual_amount=0`, [project.project_id, horizon]);
}

// ============ 敏感性分析 ============
function sensitivityOf(project, cfs) {
    const horizon = Math.max(1, n(project.horizon_years) || cfs.length || 1);
    const baseRate = n(project.discount_rate);
    const annual = {};
    for (const c of cfs) annual[Number(c.year_index)] = n(c.planned_amount);
    const annuals = [];
    for (let y = 1; y <= horizon; y++) annuals.push(Number(annual[y] || 0));
    const salvage = n(project.salvage_value);
    const initial = n(project.initial_investment);

    const calc = ({ rateShift = 0, cfFactor = 1, invFactor = 1 }) => {
        const flows = [-initial * invFactor];
        annuals.forEach((v, i) => {
            let x = v * cfFactor;
            if (i === annuals.length - 1) x += salvage;
            flows.push(x);
        });
        return r2(npvOf(baseRate + rateShift, flows));
    };

    const base = calc({});
    const rateLo = calc({ rateShift: -2 });
    const rateHi = calc({ rateShift: 2 });
    const cfLo = calc({ cfFactor: 0.9 });
    const cfHi = calc({ cfFactor: 1.1 });
    const invLo = calc({ invFactor: 1.1 });   // 投资超支 10%
    const invHi = calc({ invFactor: 0.9 });   // 投资节省 10%

    const matrix = {
        rate_axis: [r2(baseRate - 2), r2(baseRate), r2(baseRate + 2)],
        cf_axis: [-10, 0, 10],
        cells: []
    };
    for (const rs of [-2, 0, 2]) {
        const row = [];
        for (const cf of [-0.1, 0, 0.1]) {
            row.push(calc({ rateShift: rs, cfFactor: 1 + cf }));
        }
        matrix.cells.push(row);
    }

    return {
        base_npv: base,
        discount_rate: baseRate,
        tornado: [
            { factor: '折现率 ±2pp', low: rateLo, high: rateHi, swing: r2(Math.abs(rateHi - rateLo)) },
            { factor: '年现金流 ±10%', low: cfLo, high: cfHi, swing: r2(Math.abs(cfHi - cfLo)) },
            { factor: '初始投资 ±10%', low: invLo, high: invHi, swing: r2(Math.abs(invHi - invLo)) }
        ],
        matrix
    };
}

// ============ 组合与资本配置 ============
function buildRows(projects, cfMap) {
    return projects.map(p => {
        const cfs = cfMap.get(p.project_id) || [];
        const m = metricsOf(p, cfs);
        const actualRows = cfs.filter(c => n(c.actual_amount) !== 0);
        const plannedAll = cfs.reduce((s, c) => s + n(c.planned_amount), 0);
        const plannedTracked = actualRows.reduce((s, c) => s + n(c.planned_amount), 0);
        const actualTotal = cfs.reduce((s, c) => s + n(c.actual_amount), 0);
        return {
            ...p,
            initial_investment: r2(p.initial_investment),
            salvage_value: r2(p.salvage_value),
            annual_cashflow: r2(p.annual_cashflow),
            discount_rate: r2(p.discount_rate),
            category_name: CATEGORIES[p.category] || p.category,
            status_name: STATUSES[p.status] || p.status,
            metrics: m,
            npv: m.npv,
            irr: m.irr,
            payback: m.payback,
            discounted_payback: m.discounted_payback,
            pi: m.pi,
            roi: m.roi,
            post: {
                tracked: actualRows.length > 0,
                years_tracked: actualRows.length,
                planned_all: r2(plannedAll),
                planned_total: r2(plannedTracked),
                actual_total: r2(actualTotal),
                variance: r2(actualTotal - plannedTracked),
                variance_pct: plannedTracked ? r2(((actualTotal - plannedTracked) / Math.abs(plannedTracked)) * 100) : null
            }
        };
    });
}

function summarize(rows) {
    const committed = rows.filter(r => COMMITTED.includes(r.status));
    const totalInvest = rows.reduce((s, r) => s + r.initial_investment, 0);
    const committedInvest = committed.reduce((s, r) => s + r.initial_investment, 0);
    const totalNpv = rows.reduce((s, r) => s + (r.npv || 0), 0);
    const weightedPayback = (() => {
        const valid = rows.filter(r => r.payback !== null && r.initial_investment > 0);
        const w = valid.reduce((s, r) => s + r.initial_investment, 0);
        if (!w) return null;
        return r2(valid.reduce((s, r) => s + r.payback * r.initial_investment, 0) / w);
    })();
    // 组合 IRR：以各项目第 0..maxHorizon 年现金流加总后再求 IRR
    const maxH = rows.reduce((m, r) => Math.max(m, r.metrics.horizon_years), 0);
    let portfolioIrr = null;
    if (maxH > 0 && rows.length) {
        const flows = [0];
        for (let y = 1; y <= maxH; y++) flows.push(0);
        for (const r of rows) {
            r.metrics.flows.forEach((v, i) => { flows[i] = (flows[i] || 0) + v; });
        }
        const v = irrOf(flows);
        portfolioIrr = v === null ? null : r2(v);
    }
    const byStatus = {};
    for (const key of Object.keys(STATUSES)) byStatus[key] = rows.filter(r => r.status === key).length;

    return {
        count: rows.length,
        total_investment: r2(totalInvest),
        committed_investment: r2(committedInvest),
        pipeline_investment: r2(rows.filter(r => PIPELINE.includes(r.status)).reduce((s, r) => s + r.initial_investment, 0)),
        total_npv: r2(totalNpv),
        portfolio_irr: portfolioIrr,
        avg_payback: weightedPayback,
        positive_npv: rows.filter(r => r.npv > 0).length,
        negative_npv: rows.filter(r => r.npv <= 0).length,
        by_status: byStatus
    };
}

function buildAllocation(rows, budgets) {
    const budgetMap = new Map(budgets.map(b => [b.bu_no, n(b.budget_amount)]));
    const mk = (key, label, list, budget) => {
        const approved = list.filter(r => COMMITTED.includes(r.status));
        const approvedAmt = approved.reduce((s, r) => s + r.initial_investment, 0);
        return {
            key, label,
            project_count: list.length,
            budget: budget === undefined ? null : r2(budget),
            approved_amount: r2(approvedAmt),
            pipeline_amount: r2(list.filter(r => PIPELINE.includes(r.status)).reduce((s, r) => s + r.initial_investment, 0)),
            npv: r2(list.reduce((s, r) => s + (r.npv || 0), 0)),
            usage_pct: budget ? r2((approvedAmt / budget) * 100) : null,
            remaining: budget === undefined ? null : r2(budget - approvedAmt)
        };
    };
    const byBu = [];
    for (const bu of BUS) {
        const list = rows.filter(r => r.bu_no === bu);
        if (!list.length && !budgetMap.has(bu)) continue;
        byBu.push(mk(bu, bu === 'GROUP' ? '集团' : bu, list, budgetMap.get(bu)));
    }
    const byCategory = Object.keys(CATEGORIES).map(k => {
        const list = rows.filter(r => r.category === k);
        return list.length ? mk(k, CATEGORIES[k], list) : null;
    }).filter(Boolean);

    return { by_bu: byBu, by_category: byCategory };
}

/**
 * 资本配置优先级：按 PI 排序，预算额度内标记可投放
 */
function buildRanking(rows, budgets) {
    const budgetTotal = budgets.reduce((s, b) => s + n(b.budget_amount), 0);
    const list = rows
        .filter(r => r.status !== 'REJECTED')
        .slice()
        .sort((a, b) => (b.pi || 0) - (a.pi || 0) || (b.npv || 0) - (a.npv || 0));

    let used = 0;
    return list.map(r => {
        const committed = COMMITTED.includes(r.status);
        if (committed) used += r.initial_investment;
        const affordable = committed || !budgetTotal || used + r.initial_investment <= budgetTotal;
        const recommend = r.npv > 0 && (r.pi || 0) >= 1 ? (affordable ? '优先投放' : '排队待额度') : '不建议投放';
        if (!committed && affordable && r.npv > 0 && (r.pi || 0) >= 1) used += r.initial_investment;
        return {
            project_id: r.project_id,
            project_name: r.project_name,
            bu_no: r.bu_no,
            category: r.category,
            category_name: r.category_name,
            status: r.status,
            initial_investment: r.initial_investment,
            npv: r.npv,
            irr: r.irr,
            payback: r.payback,
            pi: r.pi,
            recommend,
            affordable
        };
    });
}

function buildAlerts(rows, budgets, summary) {
    const alerts = [];
    const budgetByBu = new Map(budgets.map(b => [b.bu_no, n(b.budget_amount)]));
    for (const [bu, budget] of budgetByBu) {
        if (budget <= 0) continue;
        const approved = rows.filter(r => r.bu_no === bu && COMMITTED.includes(r.status))
            .reduce((s, r) => s + r.initial_investment, 0);
        if (approved > budget) {
            alerts.push({
                code: 'BUDGET_OVERRUN', level: 'danger',
                message: `${bu} 已批准投资 ${r2(approved)} 元，超出年度资本预算 ${r2(budget)} 元（超支 ${r2(approved - budget)} 元）`,
                suggestion: '复核项目排序，暂缓低 PI 项目或追加预算额度。'
            });
        }
    }
    const negApproved = rows.filter(r => COMMITTED.includes(r.status) && r.npv <= 0);
    if (negApproved.length) {
        alerts.push({
            code: 'NEGATIVE_NPV_APPROVED', level: 'warning',
            message: `有 ${negApproved.length} 个已批准/实施项目 NPV 为负：${negApproved.slice(0, 3).map(r => r.project_name).join('、')}`,
            suggestion: '重新评估现金流假设与折现率，必要时调整投资节奏或终止。'
        });
    }
    if (summary.total_npv < 0 && rows.length) {
        alerts.push({
            code: 'PORTFOLIO_NPV_NEGATIVE', level: 'danger',
            message: `投资组合整体 NPV 为负（${summary.total_npv} 元），资本投入未创造增量价值`,
            suggestion: '压缩低回报项目，把额度转向 PI 较高的项目。'
        });
    }
    return alerts;
}

async function buildOverview(YYYY, buNo) {
    const projects = await loadProjects(YYYY, buNo);
    const cfMap = await loadCashflows(projects.map(p => p.project_id));
    const rows = buildRows(projects, cfMap);
    const budgets = await loadBudgets(YYYY, buNo);
    const summary = summarize(rows);
    const budgetTotal = r2(budgets.reduce((s, b) => s + n(b.budget_amount), 0));
    return {
        YYYY,
        bu_no: buNo || 'ALL',
        budgets: budgets.map(b => ({ ...b, budget_amount: r2(b.budget_amount) })),
        budget_total: budgetTotal,
        budget_usage_pct: budgetTotal ? r2((summary.committed_investment / budgetTotal) * 100) : null,
        summary,
        allocation: buildAllocation(rows, budgets),
        ranking: buildRanking(rows, budgets),
        alerts: buildAlerts(rows, budgets, summary),
        post_tracking: rows.filter(r => r.post.tracked)
            .map(r => ({
                project_id: r.project_id,
                project_name: r.project_name,
                bu_no: r.bu_no,
                status: r.status,
                planned_total: r.post.planned_total,
                actual_total: r.post.actual_total,
                variance: r.post.variance,
                variance_pct: r.post.variance_pct
            })),
        projects: rows
    };
}

async function projectDetail(id) {
    const [rows] = await pool.execute('SELECT * FROM investment_project WHERE project_id=?', [id]);
    if (!rows.length) return null;
    const project = rows[0];
    const [cfs] = await pool.execute(
        'SELECT * FROM investment_cashflow WHERE project_id=? ORDER BY year_index', [id]);
    const [row] = buildRows([project], new Map([[project.project_id, cfs]]));
    return {
        project: row,
        cashflows: cfs.map(c => ({
            ...c,
            planned_amount: r2(c.planned_amount),
            actual_amount: r2(c.actual_amount)
        })),
        metrics: row.metrics,
        sensitivity: sensitivityOf(project, cfs)
    };
}

module.exports = {
    BUS, CATEGORIES, STATUSES, COMMITTED, PIPELINE,
    npvOf, irrOf, paybackOf, metricsOf, sensitivityOf,
    ensureCashflows, buildRows, buildOverview, projectDetail,
    loadProjects, loadCashflows, loadBudgets
};
