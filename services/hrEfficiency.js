/**
 * CEO-05 组织人效分析
 *
 * 数据源：
 *   mgm_finance_summary  人数 / 薪资（bu_no + YYYY_MM）
 *   ermm_erp_so          产值 = SUM(so_qty*unit_price)
 *   mgm_invoice_details  开票额 = SUM(sub_amt)
 *   daily_report(+detail) 工时 / 部门 / 及时率
 *   hr_headcount_plan    部门编制计划
 *
 * 说明：ERP 订单与开票无部门字段，部门维度只统计工时类指标；
 *       产值类指标（人均产值、人工成本率）在 BU 层级计算。
 */
const { pool } = require('../config/db');

const BUS = ['HM', 'HN', 'SZ'];

function normalizeMonth(v) {
    const s = String(v || '').trim();
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? s : null;
}

function shiftMonth(ym, delta) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const r2 = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.round((x + Number.EPSILON) * 100) / 100 : 0;
};

/** 当月已过天数（用于日报及时率分母） */
function dueDaysOfMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    const now = new Date();
    const cy = now.getFullYear(), cm = now.getMonth() + 1;
    if (y < cy) return new Date(y, m, 0).getDate();
    if (y > cy) return 0;
    if (m < cm) return new Date(y, m, 0).getDate();
    if (m === cm) return now.getDate();
    return 0;
}

async function latestMonth(bu) {
    const [rows] = await pool.execute(
        'SELECT MAX(YYYY_MM) AS ym FROM mgm_finance_summary WHERE bu_no=?', [bu]);
    return (rows[0] && rows[0].ym) || new Date().toISOString().slice(0, 7);
}

async function loadDeptHours(bu, ym) {
    const [perUser] = await pool.execute(
        `SELECT d.user_id, MAX(d.depart_id) AS depart_id,
                COUNT(DISTINCT d.report_date) AS days,
                COUNT(DISTINCT CASE WHEN d.create_time IS NOT NULL AND DATE(d.create_time)>d.report_date THEN d.report_date END) AS late_days,
                ROUND(COALESCE(SUM(dt.use_time),0),2) AS total_hours,
                ROUND(COALESCE(SUM(CASE WHEN dt.wk_type='日常工作' THEN dt.use_time ELSE 0 END),0),2) AS work_hours
           FROM daily_report d
           LEFT JOIN daily_report_detail dt ON dt.ruid=d.id
          WHERE d.bu_no=? AND d.YYYY_MM=? AND d.status1='USE'
          GROUP BY d.user_id`, [bu, ym]);

    const dueDays = dueDaysOfMonth(ym);
    const agg = new Map();
    for (const u of perUser) {
        const dep = u.depart_id || '未分类';
        if (!agg.has(dep)) {
            agg.set(dep, { user_cnt: 0, total_hours: 0, work_hours: 0, on_time_days: 0, due_days: 0 });
        }
        const a = agg.get(dep);
        const days = Number(u.days) || 0;
        const late = Number(u.late_days) || 0;
        a.user_cnt += 1;
        a.total_hours += Number(u.total_hours) || 0;
        a.work_hours += Number(u.work_hours) || 0;
        a.on_time_days += Math.max(0, days - late);
        a.due_days += dueDays;
    }
    return agg;
}

async function buildOverview(bu, rawMonth) {
    const ym = normalizeMonth(rawMonth) || await latestMonth(bu);

    const [[finRows], [soRows], [invRows], [hrsRows], [planRows]] = await Promise.all([
        pool.execute(
            `SELECT employee_cnt, salary_amt, avg_salary FROM mgm_finance_summary
              WHERE bu_no=? AND YYYY_MM=? LIMIT 1`, [bu, ym]),
        pool.execute(
            `SELECT COALESCE(ROUND(SUM(so_qty*unit_price),2),0) AS output
               FROM ermm_erp_so WHERE bu_no=? AND YYYY_MM=?`, [bu, ym]),
        pool.execute(
            `SELECT COALESCE(ROUND(SUM(sub_amt),2),0) AS invoice_amt
               FROM mgm_invoice_details WHERE bu_no=? AND YYYY_MM=?`, [bu, ym]),
        pool.execute(
            `SELECT ROUND(COALESCE(SUM(dt.use_time),0),2) AS total_hours,
                    COUNT(DISTINCT d.user_id) AS report_user_cnt
               FROM daily_report d
               LEFT JOIN daily_report_detail dt ON dt.ruid=d.id
              WHERE d.bu_no=? AND d.YYYY_MM=? AND d.status1='USE'`, [bu, ym]),
        pool.execute(
            `SELECT * FROM hr_headcount_plan WHERE bu_no=? AND period=? ORDER BY depart_name`, [bu, ym])
    ]);

    const fin = finRows[0] || {};
    const employeeCnt = Number(fin.employee_cnt) || 0;
    const salaryTotal = Number(fin.salary_amt) || 0;
    const output = Number(soRows[0] && soRows[0].output) || 0;
    const invoiceAmt = Number(invRows[0] && invRows[0].invoice_amt) || 0;
    const totalHours = Number(hrsRows[0] && hrsRows[0].total_hours) || 0;
    const reportUserCnt = Number(hrsRows[0] && hrsRows[0].report_user_cnt) || 0;

    const planHeadcount = planRows.reduce((s, p) => s + Number(p.plan_headcount || 0), 0);
    const planLaborCost = planRows.reduce((s, p) => s + Number(p.plan_labor_cost || 0), 0);

    // 部门维度：日报工时 + 编制 + 人员主档实际人数
    const hoursAgg = await loadDeptHours(bu, ym);
    const [deptUsers] = await pool.execute(
        `SELECT TRIM(xuser_dept) AS dept, COUNT(*) AS cnt FROM cams_xuser
          WHERE inuse_flag='USE' AND xuser_dept IS NOT NULL AND TRIM(xuser_dept)<>''
          GROUP BY TRIM(xuser_dept)`);
    const userCntMap = new Map(deptUsers.map(r => [r.dept, Number(r.cnt) || 0]));
    const planMap = new Map(planRows.map(p => [p.depart_name, p]));
    const deptNames = new Set([...hoursAgg.keys(), ...planMap.keys()]);
    const departments = [...deptNames].map(dep => {
        const h = hoursAgg.get(dep) || { user_cnt: 0, total_hours: 0, work_hours: 0, on_time_days: 0, due_days: 0 };
        const p = planMap.get(dep) || {};
        const plan = Number(p.plan_headcount || 0);
        const actual = p.actual_headcount != null ? Number(p.actual_headcount)
            : (userCntMap.has(dep) ? userCntMap.get(dep) : null);
        const useCnt = actual != null ? actual : h.user_cnt;
        return {
            depart_name: dep,
            plan_headcount: plan,
            actual_headcount: actual,
            report_user_cnt: h.user_cnt,
            headcount_gap: plan > 0 ? useCnt - plan : null,
            headcount_rate: plan > 0 ? r2(useCnt / plan * 100) : null,
            plan_labor_cost: r2(p.plan_labor_cost || 0),
            total_hours: r2(h.total_hours),
            per_capita_hours: useCnt > 0 ? r2(h.total_hours / useCnt) : 0,
            output_share: totalHours > 0 ? r2(h.total_hours / totalHours * 100) : 0,
            timeliness_rate: h.due_days > 0 ? r2(h.on_time_days / h.due_days * 100) : 0,
            work_ratio: h.total_hours > 0 ? r2(h.work_hours / h.total_hours * 100) : 0,
            note: p.note || null,
            uid: p.uid || null
        };
    }).sort((a, b) => (b.total_hours - a.total_hours) || (b.plan_headcount - a.plan_headcount));

    // 近 6 个月趋势
    const months = [];
    for (let i = 5; i >= 0; i--) months.push(shiftMonth(ym, -i));
    const ph = months.map(() => '?').join(',');
    const [tSo, tFin, tPlan] = await Promise.all([
        pool.execute(
            `SELECT YYYY_MM, COALESCE(ROUND(SUM(so_qty*unit_price),2),0) AS output
               FROM ermm_erp_so WHERE bu_no=? AND YYYY_MM IN (${ph}) GROUP BY YYYY_MM`,
            [bu, ...months]),
        pool.execute(
            `SELECT YYYY_MM, employee_cnt, salary_amt FROM mgm_finance_summary
              WHERE bu_no=? AND YYYY_MM IN (${ph})`,
            [bu, ...months]),
        pool.execute(
            `SELECT period, SUM(plan_headcount) AS plan_headcount, SUM(plan_labor_cost) AS plan_labor_cost
               FROM hr_headcount_plan WHERE bu_no=? AND period IN (${ph}) GROUP BY period`,
            [bu, ...months])
    ]);
    const soMap = Object.fromEntries(tSo[0].map(r => [r.YYYY_MM, Number(r.output) || 0]));
    const finMap = Object.fromEntries(tFin[0].map(r => [r.YYYY_MM, r]));
    const planMp = Object.fromEntries(tPlan[0].map(r => [r.period, r]));
    const trend = months.map(m => {
        const f = finMap[m] || {};
        const cnt = Number(f.employee_cnt) || 0;
        const sal = Number(f.salary_amt) || 0;
        const out = soMap[m] || 0;
        const pl = planMp[m] || {};
        return {
            period: m,
            employee_cnt: cnt,
            salary_amt: r2(sal),
            output: r2(out),
            per_capita_output: cnt > 0 ? Math.round(out / cnt) : 0,
            per_capita_salary: cnt > 0 ? Math.round(sal / cnt) : 0,
            labor_cost_rate: out > 0 ? r2(sal / out * 100) : null,
            plan_headcount: Number(pl.plan_headcount || 0),
            plan_labor_cost: r2(pl.plan_labor_cost || 0)
        };
    });

    return {
        bu_no: bu,
        period: ym,
        kpi: {
            employee_cnt: employeeCnt,
            plan_headcount: planHeadcount,
            headcount_gap: planHeadcount > 0 ? employeeCnt - planHeadcount : null,
            headcount_rate: planHeadcount > 0 ? r2(employeeCnt / planHeadcount * 100) : null,
            report_user_cnt: reportUserCnt,
            total_output: r2(output),
            invoice_amt: r2(invoiceAmt),
            per_capita_output: employeeCnt > 0 ? Math.round(output / employeeCnt) : 0,
            salary_total: r2(salaryTotal),
            per_capita_salary: employeeCnt > 0 ? Math.round(salaryTotal / employeeCnt) : 0,
            labor_cost_rate: output > 0 ? r2(salaryTotal / output * 100) : null,
            plan_labor_cost: r2(planLaborCost),
            total_hours: r2(totalHours),
            per_capita_hours: employeeCnt > 0 ? r2(totalHours / employeeCnt) : 0
        },
        departments,
        trend
    };
}

module.exports = {
    BUS,
    normalizeMonth,
    shiftMonth,
    latestMonth,
    buildOverview
};
