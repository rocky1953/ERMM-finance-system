/**
 * 项目损益服务（COO-02）
 *
 * 口径：
 *   项目收入 = project_revenue 已确认收入（手工确认 / 由出货收入自动引入）
 *   项目成本 = project_cost 归集成本（材料/人工/委外/差旅/其他）
 *   项目毛利 = 收入 - 成本
 *   预算达成 = 年初至今收入(成本) / 年度收入(成本)预算
 *
 * 自动引入收入复用 CFO-06 的项目维度口径（出货数量 × 单价，按客户-项目映射归集），
 * 保证「多维盈利分析-项目」「项目损益」两处数字一致。
 */

const { pool } = require('../config/db');
const { loadBaseRows } = require('./profit');

const COST_TYPES = {
    MATERIAL: '材料',
    LABOR: '人工',
    OUTSOURCE: '委外',
    TRAVEL: '差旅',
    OTHER: '其他'
};

const n = (v) => (v === null || v === undefined || isNaN(v)) ? 0 : Number(v);
const r2 = (v) => Math.round(n(v) * 100) / 100;

function nowMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function latestMonth() {
    const [rows] = await pool.execute(`
        SELECT MAX(ym) AS ym FROM (
            SELECT MAX(YYYY_MM) AS ym FROM project_revenue
            UNION ALL SELECT MAX(YYYY_MM) AS ym FROM project_cost
        ) t`);
    return (rows[0] && rows[0].ym) || nowMonth();
}

/** 项目主档 */
async function listProjects() {
    const [rows] = await pool.execute(`
        SELECT customer_id, customer_name, project_id, project_name
        FROM mgm_customer_projects
        WHERE COALESCE(status,'active')='active'
        ORDER BY customer_name, project_id`);
    return rows;
}

async function projectNameMap() {
    const rows = await listProjects();
    const map = {};
    rows.forEach(r => { map[r.project_id] = { project_name: r.project_name, customer_name: r.customer_name }; });
    return map;
}

/** 收入聚合：本月 + 年初至今 */
async function sumByProject(table, field, bu_no, ym, year) {
    const cond = ['YYYY_MM LIKE ?'];
    const params = [ym, `${year}%`];
    if (bu_no && bu_no !== 'GROUP') { cond.push('bu_no=?'); params.push(bu_no); }
    const [rows] = await pool.execute(`
        SELECT project_id,
               SUM(CASE WHEN YYYY_MM=? THEN ${field} ELSE 0 END) AS month_amt,
               SUM(${field}) AS ytd_amt
        FROM ${table}
        WHERE ${cond.join(' AND ')}
        GROUP BY project_id`, params);
    const map = {};
    rows.forEach(r => { map[r.project_id] = { month: r2(r.month_amt), ytd: r2(r.ytd_amt) }; });
    return map;
}

/** 年度数据覆盖：哪些月份有收入/成本记录，用于提示 YTD 是否覆盖全年 */
async function monthCoverage(year, bu_no) {
    const y = Number(year);
    const buCond = (bu_no && bu_no !== 'GROUP') ? ' AND bu_no=?' : '';
    const p1 = [`${y}%`];
    const p2 = [`${y}%`];
    if (buCond) { p1.push(bu_no); p2.push(bu_no); }
    const [revRows] = await pool.execute(
        `SELECT DISTINCT YYYY_MM FROM project_revenue WHERE YYYY_MM LIKE ?${buCond}`, p1);
    const [costRows] = await pool.execute(
        `SELECT DISTINCT YYYY_MM FROM project_cost WHERE YYYY_MM LIKE ?${buCond}`, p2);
    const revenueMonths = revRows.map(r => r.YYYY_MM).sort();
    const costMonths = costRows.map(r => r.YYYY_MM).sort();
    const months = Array.from(new Set([...revenueMonths, ...costMonths])).sort();
    const now = new Date();
    let expected = 12;
    if (y === now.getFullYear()) expected = now.getMonth() + 1;
    else if (y > now.getFullYear()) expected = 0;
    return {
        revenue_months: revenueMonths,
        cost_months: costMonths,
        months,
        revenue_without_cost: revenueMonths.filter(m => !costMonths.includes(m)),
        expected_months: expected,
        incomplete: months.length < expected
    };
}

/**
 * 项目组合概览
 * 仅展示「本年有预算 / 年初至今有收入或成本」的项目，避免 100+ 空项目干扰
 */
async function overview({ bu_no = '', YYYY_MM } = {}) {
    const ym = YYYY_MM ? String(YYYY_MM).slice(0, 7) : await latestMonth();
    const year = Number(ym.slice(0, 4));

    const bcond = ['year=?'];
    const bparams = [year];
    if (bu_no && bu_no !== 'GROUP') { bcond.push('bu_no=?'); bparams.push(bu_no); }
    const [budgets] = await pool.execute(
        `SELECT bu_no, project_id, project_name, revenue_budget, cost_budget
         FROM project_budget WHERE ${bcond.join(' AND ')}`, bparams);
    const budgetMap = {};
    budgets.forEach(b => {
        if (!budgetMap[b.project_id]) {
            budgetMap[b.project_id] = { project_id: b.project_id, project_name: b.project_name, revenue_budget: 0, cost_budget: 0 };
        }
        budgetMap[b.project_id].revenue_budget = r2(Number(budgetMap[b.project_id].revenue_budget) + Number(b.revenue_budget));
        budgetMap[b.project_id].cost_budget = r2(Number(budgetMap[b.project_id].cost_budget) + Number(b.cost_budget));
    });

    const [revMap, costMap, names] = await Promise.all([
        sumByProject('project_revenue', 'revenue_amt', bu_no, ym, year),
        sumByProject('project_cost', 'amount', bu_no, ym, year),
        projectNameMap()
    ]);

    const ids = new Set([...Object.keys(budgetMap), ...Object.keys(revMap), ...Object.keys(costMap)]);
    const rows = Array.from(ids).map(pid => {
        const b = budgetMap[pid] || {};
        const rev = revMap[pid] || { month: 0, ytd: 0 };
        const cost = costMap[pid] || { month: 0, ytd: 0 };
        const profitYtd = r2(rev.ytd - cost.ytd);
        const profitMonth = r2(rev.month - cost.month);
        const revBudget = r2(b.revenue_budget);
        const costBudget = r2(b.cost_budget);
        const costUsage = costBudget > 0 ? r2(cost.ytd / costBudget * 100) : null;
        // 有收入但无成本视为「成本未归集」，毛利率不可用，避免显示 100% 误导
        const costMissing = rev.ytd > 0 && cost.ytd === 0;
        let status = 'idle';
        if (rev.ytd || cost.ytd) status = 'active';
        if (revBudget > 0 && rev.ytd >= revBudget) status = 'done';
        // 成本超支优先展示，避免被「收入已达标」掩盖
        if (costBudget > 0 && cost.ytd > costBudget) status = 'over';
        return {
            project_id: pid,
            project_name: (names[pid] && names[pid].project_name) || b.project_name || pid,
            customer_name: (names[pid] && names[pid].customer_name) || '',
            revenue_budget: revBudget,
            cost_budget: costBudget,
            revenue_month: rev.month,
            revenue_ytd: rev.ytd,
            cost_month: cost.month,
            cost_ytd: cost.ytd,
            profit_month: profitMonth,
            profit_ytd: profitYtd,
            margin_ytd: rev.ytd > 0 && !costMissing ? r2(profitYtd / rev.ytd * 100) : null,
            rev_usage: revBudget > 0 ? r2(rev.ytd / revBudget * 100) : null,
            cost_usage: costUsage,
            cost_missing: costMissing,
            status
        };
    }).sort((a, b) => b.revenue_ytd - a.revenue_ytd || b.cost_ytd - a.cost_ytd);

    const totals = rows.reduce((t, r) => {
        t.revenue_budget += r.revenue_budget;
        t.cost_budget += r.cost_budget;
        t.revenue_month += r.revenue_month;
        t.revenue_ytd += r.revenue_ytd;
        t.cost_month += r.cost_month;
        t.cost_ytd += r.cost_ytd;
        t.profit_ytd += r.profit_ytd;
        return t;
    }, { revenue_budget: 0, cost_budget: 0, revenue_month: 0, revenue_ytd: 0, cost_month: 0, cost_ytd: 0, profit_ytd: 0 });
    Object.keys(totals).forEach(k => { totals[k] = r2(totals[k]); });
    totals.profit_month = r2(totals.revenue_month - totals.cost_month);
    totals.cost_missing = totals.revenue_ytd > 0 && totals.cost_ytd === 0;
    totals.margin_ytd = totals.revenue_ytd > 0 && !totals.cost_missing
        ? r2(totals.profit_ytd / totals.revenue_ytd * 100) : null;
    totals.rev_usage = totals.revenue_budget > 0 ? r2(totals.revenue_ytd / totals.revenue_budget * 100) : null;
    totals.cost_usage = totals.cost_budget > 0 ? r2(totals.cost_ytd / totals.cost_budget * 100) : null;

    return {
        bu_no: bu_no || 'GROUP', YYYY_MM: ym, year,
        totals,
        counts: {
            total: rows.length,
            active: rows.filter(r => r.status === 'active' || r.status === 'over' || r.status === 'done').length,
            over_budget: rows.filter(r => r.status === 'over').length,
            no_budget: rows.filter(r => !r.revenue_budget && !r.cost_budget).length
        },
        rows,
        coverage: await monthCoverage(year, bu_no)
    };
}

/** 单项目 12 个月损益明细 */
async function detail({ project_id, year, bu_no = '' } = {}) {
    if (!project_id) throw new Error('需要 project_id');
    const y = Number(year) || new Date().getFullYear();
    const cond = ['YYYY_MM LIKE ?', 'project_id=?'];
    const params = [`${y}%`, project_id];
    if (bu_no && bu_no !== 'GROUP') { cond.push('bu_no=?'); params.push(bu_no); }
    const [revRows] = await pool.execute(
        `SELECT YYYY_MM, SUM(revenue_amt) amt FROM project_revenue WHERE ${cond.join(' AND ')} GROUP BY YYYY_MM`, params);
    const [costRows] = await pool.execute(
        `SELECT YYYY_MM, SUM(amount) amt FROM project_cost WHERE ${cond.join(' AND ')} GROUP BY YYYY_MM`, params);
    const bcond = ['project_id=?', 'year=?'];
    const bparams = [project_id, y];
    if (bu_no && bu_no !== 'GROUP') { bcond.push('bu_no=?'); bparams.push(bu_no); }
    // GROUP 视图按项目汇总各公司别预算
    const [budRows] = await pool.execute(
        `SELECT SUM(revenue_budget) AS revenue_budget, SUM(cost_budget) AS cost_budget
         FROM project_budget WHERE ${bcond.join(' AND ')}`, bparams);
    const names = await projectNameMap();

    const rev = {}, cost = {};
    revRows.forEach(r => { rev[r.YYYY_MM] = r2(r.amt); });
    costRows.forEach(r => { cost[r.YYYY_MM] = r2(r.amt); });

    let cumRev = 0, cumCost = 0;
    const now = new Date();
    const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const months = Array.from({ length: 12 }, (_, i) => {
        const ym = `${y}-${String(i + 1).padStart(2, '0')}`;
        const rv = rev[ym] || 0, ct = cost[ym] || 0;
        cumRev = r2(cumRev + rv); cumCost = r2(cumCost + ct);
        return {
            YYYY_MM: ym, revenue: rv, cost: ct,
            profit: r2(rv - ct),
            margin: rv > 0 && ct > 0 ? r2((rv - ct) / rv * 100) : null,
            cost_missing: rv > 0 && ct === 0,
            future: ym > curYm,
            cum_revenue: cumRev, cum_cost: cumCost, cum_profit: r2(cumRev - cumCost)
        };
    });
    const hasBud = budRows[0] && budRows[0].revenue_budget !== null;
    const budget = hasBud
        ? { revenue_budget: r2(budRows[0].revenue_budget), cost_budget: r2(budRows[0].cost_budget) }
        : { revenue_budget: 0, cost_budget: 0 };
    const totalRev = r2(cumRev), totalCost = r2(cumCost);
    return {
        project_id,
        project_name: (names[project_id] && names[project_id].project_name) || project_id,
        customer_name: (names[project_id] && names[project_id].customer_name) || '',
        year: y, bu_no: bu_no || 'GROUP',
        budget,
        totals: {
            revenue: totalRev, cost: totalCost, profit: r2(totalRev - totalCost),
            margin: totalRev > 0 && totalCost > 0 ? r2((totalRev - totalCost) / totalRev * 100) : null,
            cost_missing: totalRev > 0 && totalCost === 0,
            rev_usage: budget.revenue_budget > 0 ? r2(totalRev / budget.revenue_budget * 100) : null,
            cost_usage: budget.cost_budget > 0 ? r2(totalCost / budget.cost_budget * 100) : null
        },
        months
    };
}

// ===== 预算 =====
async function listBudgets({ year, bu_no = '' } = {}) {
    const y = Number(year) || new Date().getFullYear();
    const cond = ['year=?'];
    const params = [y];
    if (bu_no && bu_no !== 'GROUP') { cond.push('bu_no=?'); params.push(bu_no); }
    const [rows] = await pool.execute(
        `SELECT uid, bu_no, project_id, project_name, year, revenue_budget, cost_budget, update_by, update_time
         FROM project_budget WHERE ${cond.join(' AND ')} ORDER BY bu_no, project_id`, params);
    const names = await projectNameMap();
    return rows.map(r => Object.assign({}, r, {
        customer_name: (names[r.project_id] && names[r.project_id].customer_name) || '',
        project_name: (names[r.project_id] && names[r.project_id].project_name) || r.project_name || r.project_id
    }));
}

async function saveBudget({ bu_no, project_id, project_name, year, revenue_budget, cost_budget, update_by } = {}) {
    if (!project_id) throw new Error('需要 project_id');
    const bu = requireBu(bu_no);
    const y = Number(year) || new Date().getFullYear();
    const names = await projectNameMap();
    const pname = project_name || (names[project_id] && names[project_id].project_name) || project_id;
    await pool.execute(`
        INSERT INTO project_budget (bu_no, project_id, project_name, year, revenue_budget, cost_budget, update_by)
        VALUES (?,?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE project_name=VALUES(project_name),
            revenue_budget=VALUES(revenue_budget), cost_budget=VALUES(cost_budget), update_by=VALUES(update_by)`,
        [bu, project_id, pname, y, r2(revenue_budget), r2(cost_budget), update_by || null]);
    return { bu_no: bu, project_id, year: y, project_name: pname };
}

async function deleteBudget(uid) {
    const [r] = await pool.execute('DELETE FROM project_budget WHERE uid=?', [uid]);
    if (!r.affectedRows) throw new Error('预算记录不存在');
}

// ===== 成本 =====
async function listCosts({ bu_no = '', project_id = '', from = '', to = '', limit = 200 } = {}) {
    const cond = [];
    const params = [];
    if (bu_no && bu_no !== 'GROUP') { cond.push('bu_no=?'); params.push(bu_no); }
    if (project_id) { cond.push('project_id=?'); params.push(project_id); }
    if (from) { cond.push('YYYY_MM>=?'); params.push(from); }
    if (to) { cond.push('YYYY_MM<=?'); params.push(to); }
    const [rows] = await pool.execute(`
        SELECT uid, bu_no, project_id, YYYY_MM, cost_type, amount, ref_no, remark, created_by, created_at
        FROM project_cost ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
        ORDER BY YYYY_MM DESC, uid DESC LIMIT ${Math.min(500, Number(limit) || 200)}`, params);
    const names = await projectNameMap();
    return rows.map(r => Object.assign({}, r, {
        project_name: (names[r.project_id] && names[r.project_id].project_name) || r.project_id,
        cost_type_name: COST_TYPES[r.cost_type] || r.cost_type
    }));
}

/** 手工录入必须归属到具体公司别，不允许挂到「全部公司」 */
function requireBu(bu_no) {
    if (!bu_no || bu_no === 'GROUP') throw new Error('请选择公司别');
    return bu_no;
}

async function createCost(d) {
    if (!d || !d.project_id) throw new Error('需要 project_id');
    if (!d.YYYY_MM) throw new Error('需要 YYYY_MM');
    const bu = requireBu(d.bu_no);
    if (!(Number(d.amount) > 0)) throw new Error('金额必须大于 0');
    const [r] = await pool.execute(`
        INSERT INTO project_cost (bu_no, project_id, YYYY_MM, cost_type, amount, ref_no, remark, created_by)
        VALUES (?,?,?,?,?,?,?,?)`,
        [bu, d.project_id, String(d.YYYY_MM).slice(0, 7),
            COST_TYPES[d.cost_type] ? d.cost_type : 'OTHER', r2(d.amount),
            d.ref_no || null, d.remark || null, d.created_by || null]);
    return { uid: r.insertId };
}

async function updateCost(uid, d) {
    const bu = requireBu(d.bu_no);
    const [r] = await pool.execute(`
        UPDATE project_cost SET bu_no=?, project_id=?, YYYY_MM=?, cost_type=?, amount=?, ref_no=?, remark=?
        WHERE uid=?`,
        [bu, d.project_id, String(d.YYYY_MM).slice(0, 7),
            COST_TYPES[d.cost_type] ? d.cost_type : 'OTHER', r2(d.amount),
            d.ref_no || null, d.remark || null, uid]);
    if (!r.affectedRows) throw new Error('成本记录不存在');
}

async function deleteCost(uid) {
    const [r] = await pool.execute('DELETE FROM project_cost WHERE uid=?', [uid]);
    if (!r.affectedRows) throw new Error('成本记录不存在');
}

// ===== 收入 =====
async function listRevenues({ bu_no = '', project_id = '', from = '', to = '', limit = 200 } = {}) {
    const cond = [];
    const params = [];
    if (bu_no && bu_no !== 'GROUP') { cond.push('bu_no=?'); params.push(bu_no); }
    if (project_id) { cond.push('project_id=?'); params.push(project_id); }
    if (from) { cond.push('YYYY_MM>=?'); params.push(from); }
    if (to) { cond.push('YYYY_MM<=?'); params.push(to); }
    const [rows] = await pool.execute(`
        SELECT uid, bu_no, project_id, YYYY_MM, revenue_amt, confirm_type, ref_no, remark, created_by, created_at
        FROM project_revenue ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
        ORDER BY YYYY_MM DESC, uid DESC LIMIT ${Math.min(500, Number(limit) || 200)}`, params);
    const names = await projectNameMap();
    return rows.map(r => Object.assign({}, r, {
        project_name: (names[r.project_id] && names[r.project_id].project_name) || r.project_id
    }));
}

async function createRevenue(d) {
    if (!d || !d.project_id) throw new Error('需要 project_id');
    if (!d.YYYY_MM) throw new Error('需要 YYYY_MM');
    const bu = requireBu(d.bu_no);
    if (!(Number(d.revenue_amt) > 0)) throw new Error('金额必须大于 0');
    const [r] = await pool.execute(`
        INSERT INTO project_revenue (bu_no, project_id, YYYY_MM, revenue_amt, confirm_type, ref_no, remark, created_by)
        VALUES (?,?,?,?,'manual',?,?,?)`,
        [bu, d.project_id, String(d.YYYY_MM).slice(0, 7), r2(d.revenue_amt),
            d.ref_no || null, d.remark || null, d.created_by || null]);
    return { uid: r.insertId };
}

async function updateRevenue(uid, d) {
    const bu = requireBu(d.bu_no);
    const [r] = await pool.execute(`
        UPDATE project_revenue SET bu_no=?, project_id=?, YYYY_MM=?, revenue_amt=?, ref_no=?, remark=?
        WHERE uid=?`,
        [bu, d.project_id, String(d.YYYY_MM).slice(0, 7), r2(d.revenue_amt),
            d.ref_no || null, d.remark || null, uid]);
    if (!r.affectedRows) throw new Error('收入记录不存在');
}

async function deleteRevenue(uid) {
    const [r] = await pool.execute('DELETE FROM project_revenue WHERE uid=?', [uid]);
    if (!r.affectedRows) throw new Error('收入记录不存在');
}

/** 前端「全部公司」传入的 GROUP 不作为实际公司过滤 */
const scopeBu = (bu) => (bu && bu !== 'GROUP' ? bu : '');

/** 按「公司别 + 项目」汇总出货口径的收入与成本 */
async function sumShipmentByBuProject(bu_no, ym) {
    const base = await loadBaseRows(scopeBu(bu_no), ym);
    const map = new Map();
    for (const r of base.rows) {
        if (r.project_id === 'UNASSIGNED') continue;
        const key = `${r.bu_no}|${r.project_id}`;
        if (!map.has(key)) map.set(key, { bu_no: r.bu_no, project_id: r.project_id, revenue: 0, cost: 0 });
        const a = map.get(key);
        a.revenue += Number(r.revenue);
        a.cost += Number(r.cost);
    }
    return {
        rows: Array.from(map.values()),
        cost_ratio: base.cost_ratio,
        cost_ratio_source: base.cost_ratio_source,
        std_cost_coverage: base.std_cost_coverage
    };
}

/** 从出货收入自动引入当月项目收入（复用 CFO-06 项目维度） */
async function syncRevenue({ bu_no = '', YYYY_MM } = {}) {
    const ym = YYYY_MM ? String(YYYY_MM).slice(0, 7) : nowMonth();
    const scope = scopeBu(bu_no);
    const agg = await sumShipmentByBuProject(scope, ym);
    const rows = agg.rows.filter(r => r.revenue > 0);
    if (scope) {
        await pool.execute(
            `DELETE FROM project_revenue WHERE YYYY_MM=? AND confirm_type='auto' AND bu_no=?`, [ym, scope]);
    } else {
        await pool.execute(
            `DELETE FROM project_revenue WHERE YYYY_MM=? AND confirm_type='auto'`, [ym]);
    }
    let inserted = 0;
    for (const r of rows) {
        await pool.execute(`
            INSERT INTO project_revenue (bu_no, project_id, YYYY_MM, revenue_amt, confirm_type, ref_no, remark, created_by)
            VALUES (?,?,?,?,'auto',?,?,?)`,
            [r.bu_no, r.project_id, ym, r2(r.revenue), 'SO-SYNC', '出货收入自动引入', 'system']);
        inserted++;
    }
    return { YYYY_MM: ym, bu_no: scope || 'GROUP', inserted, total_revenue: r2(rows.reduce((s, r) => s + r.revenue, 0)) };
}

/**
 * 按「公司别 + 项目」汇总出货成本
 * GROUP 同步时逐公司别加载，各自取本公司的料件标准成本 / 成本率，避免跨公司别混合成本价
 */
async function sumCostByBuProject(bu_no, ym) {
    const scope = scopeBu(bu_no);
    let bus;
    if (scope) {
        bus = [scope];
    } else {
        const [rows] = await pool.execute(
            `SELECT DISTINCT bu_no FROM ermm_erp_so
             WHERE dn_qty>0 AND YYYY_MM=? AND bu_no IS NOT NULL ORDER BY bu_no`, [ym]);
        bus = rows.map(r => r.bu_no);
    }
    const map = new Map();
    const byBu = [];
    for (const b of bus) {
        const base = await loadBaseRows(b, ym);
        byBu.push({
            bu_no: b,
            cost_ratio: base.cost_ratio,
            cost_ratio_source: base.cost_ratio_source,
            std_cost_coverage: base.std_cost_coverage
        });
        for (const r of base.rows) {
            if (r.project_id === 'UNASSIGNED') continue;
            const key = `${r.bu_no}|${r.project_id}`;
            if (!map.has(key)) map.set(key, { bu_no: r.bu_no, project_id: r.project_id, cost: 0 });
            map.get(key).cost += Number(r.cost);
        }
    }
    return { rows: Array.from(map.values()), byBu };
}

/**
 * 从出货成本自动引入当月项目成本（复用 CFO-06 项目维度口径）
 * 口径：出货数量 × 单位成本（料件标准成本 / 料件成本率 / 公司销售成本率）
 * 自动记录以 ref_no='COST-SYNC' 标识；按实际公司别落库，重复同步先清除当月自动记录
 */
async function syncCost({ bu_no = '', YYYY_MM } = {}) {
    const ym = YYYY_MM ? String(YYYY_MM).slice(0, 7) : nowMonth();
    const scope = scopeBu(bu_no);
    const agg = await sumCostByBuProject(scope, ym);
    const rows = agg.rows.filter(r => r.cost > 0);
    const ratioOf = {};
    agg.byBu.forEach(b => { ratioOf[b.bu_no] = b.cost_ratio; });
    if (scope) {
        await pool.execute(
            `DELETE FROM project_cost WHERE YYYY_MM=? AND ref_no='COST-SYNC' AND bu_no=?`, [ym, scope]);
    } else {
        await pool.execute(`DELETE FROM project_cost WHERE YYYY_MM=? AND ref_no='COST-SYNC'`, [ym]);
    }
    let inserted = 0;
    for (const r of rows) {
        const ratio = ratioOf[r.bu_no];
        const remark = ratio == null ? '出货成本自动引入' : `出货成本自动引入 · 成本率 ${r2(ratio)}%`;
        await pool.execute(`
            INSERT INTO project_cost (bu_no, project_id, YYYY_MM, cost_type, amount, ref_no, remark, created_by)
            VALUES (?,?,?,'OTHER',?,?,?,?)`,
            [r.bu_no, r.project_id, ym, r2(r.cost), 'COST-SYNC', remark, 'system']);
        inserted++;
    }
    const single = agg.byBu.length === 1 ? agg.byBu[0] : null;
    return {
        YYYY_MM: ym, bu_no: scope || 'GROUP', inserted,
        total_cost: r2(rows.reduce((s, r) => s + r.cost, 0)),
        cost_ratio: single ? single.cost_ratio : null,
        cost_ratio_source: single ? single.cost_ratio_source : '按公司别成本率',
        std_cost_coverage: agg.byBu.length
            ? r2(agg.byBu.reduce((s, b) => s + b.std_cost_coverage, 0) / agg.byBu.length)
            : 0,
        by_bu: agg.byBu
    };
}

module.exports = {
    COST_TYPES,
    listProjects,
    overview,
    detail,
    listBudgets,
    saveBudget,
    deleteBudget,
    listCosts,
    createCost,
    updateCost,
    deleteCost,
    listRevenues,
    createRevenue,
    updateRevenue,
    deleteRevenue,
    syncRevenue,
    syncCost
};
