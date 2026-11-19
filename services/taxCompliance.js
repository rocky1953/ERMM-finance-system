/**
 * CFO-10 税务与合规管理
 *
 * 数据来源：
 * 1. tax_filing_task：纳税申报日历（VAT/CIT/IIT/附加税费/印花税），逾期由截止日推导
 * 2. tax_compliance_item：合规事项清单（发票、合同备案、税务档案、关联交易、优惠备案、登记变更）
 * 3. tax_regulation：法规政策库（集团统一，记录影响评估与落实状态）
 * 4. 合规评分 = 申报及时率 40% + 合规事项完成率 40% + 法规落实率 20%
 * 5. 预警写入 alert_log，dedup_key = TAXC|规则|公司|年度
 */
const { pool } = require('../config/db');

const BUS = ['GROUP', 'HM', 'HN', 'SZ'];
const COMPANY_BUS = ['HM', 'HN', 'SZ'];

const TAX_TYPES = {
    VAT: '增值税',
    SURCHARGE: '附加税费',
    IIT: '个人所得税',
    CIT: '企业所得税',
    STAMP_DUTY: '印花税',
    OTHER: '其他税种'
};
const FILING_CYCLES = { MONTHLY: '月度', QUARTERLY: '季度', ANNUAL: '年度' };
const FILING_STATUS = { PENDING: '待申报', FILED: '已申报', EXEMPT: '免申报', OVERDUE: '逾期' };

const ITEM_CATEGORIES = {
    INVOICE: '发票管理',
    CONTRACT: '合同与备案',
    ARCHIVE: '税务档案',
    RELATED_PARTY: '关联交易/转让定价',
    PREFERENCE: '税收优惠备案',
    REGISTRATION: '税务登记/变更',
    OTHER: '其他'
};
const ITEM_FREQUENCIES = { MONTHLY: '月度', QUARTERLY: '季度', ANNUAL: '年度', EVENT: '按事项' };
const ITEM_STATUS = { NOT_STARTED: '未开始', IN_PROGRESS: '进行中', DONE: '已完成', WAIVED: '已豁免' };
const RISK_LEVELS = { HIGH: '高', MEDIUM: '中', LOW: '低' };

const REG_CATEGORIES = { CIT: '企业所得税', VAT: '增值税', IIT: '个人所得税', OTHER: '其他' };
const REG_STATUS = { NEW: '待评估', ASSESSING: '评估中', IMPLEMENTED: '已落实', ARCHIVED: '已归档' };

const WEIGHTS = { filing: 0.4, item: 0.4, regulation: 0.2 };
const DUE_SOON_DAYS = 7;
const UPCOMING_DAYS = 30;

const n = (v) => Number(v || 0);
const r2 = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.round((x + Number.EPSILON) * 100) / 100 : 0;
};
const pad2 = (v) => String(v).padStart(2, '0');
const dstr = (v) => (v ? String(v).slice(0, 10) : null);

/** 服务器以 Asia/Shanghai 为准的当天日期 */
function todayStr() {
    return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function addDays(day, days) {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function gradeOf(score) {
    if (score == null) return { grade: '-', label: '无数据' };
    if (score >= 90) return { grade: 'A', label: '优秀' };
    if (score >= 80) return { grade: 'B', label: '良好' };
    if (score >= 70) return { grade: 'C', label: '待改进' };
    return { grade: 'D', label: '高风险' };
}

/** 逾期不看存储状态：未申报且已过截止日即为逾期 */
function effectiveFilingStatus(row, today) {
    if (row.status === 'FILED' || row.status === 'EXEMPT') return row.status;
    return row.due_date && dstr(row.due_date) < today ? 'OVERDUE' : 'PENDING';
}

function buildFilingRows(rows, today) {
    return rows.map(r => {
        const status = effectiveFilingStatus(r, today);
        const late = status === 'FILED' && r.filed_date && r.due_date
            && dstr(r.filed_date) > dstr(r.due_date);
        return {
            uid: r.uid,
            bu_no: r.bu_no,
            tax_year: r.tax_year,
            tax_period: r.tax_period,
            tax_type: r.tax_type,
            tax_type_name: TAX_TYPES[r.tax_type] || r.tax_type,
            filing_cycle: r.filing_cycle,
            cycle_name: FILING_CYCLES[r.filing_cycle] || r.filing_cycle,
            due_date: dstr(r.due_date),
            filed_date: dstr(r.filed_date),
            status,
            status_name: FILING_STATUS[status] || status,
            late,
            tax_amount: r2(r.tax_amount),
            receipt_no: r.receipt_no,
            owner_id: r.owner_id,
            note: r.note
        };
    });
}

function buildItemRows(rows, today) {
    return rows.map(r => {
        const status = r.status;
        const done = status === 'DONE' || status === 'WAIVED';
        const overdue = !done && r.due_date && dstr(r.due_date) < today;
        return {
            uid: r.uid,
            bu_no: r.bu_no,
            tax_year: r.tax_year,
            category: r.category,
            category_name: ITEM_CATEGORIES[r.category] || r.category,
            item_name: r.item_name,
            requirement: r.requirement,
            frequency: r.frequency,
            frequency_name: ITEM_FREQUENCIES[r.frequency] || r.frequency,
            owner_dept: r.owner_dept,
            owner_id: r.owner_id,
            due_date: dstr(r.due_date),
            completed_date: dstr(r.completed_date),
            status,
            status_name: ITEM_STATUS[status] || status,
            risk_level: r.risk_level,
            risk_name: RISK_LEVELS[r.risk_level] || r.risk_level,
            evidence: r.evidence,
            note: r.note,
            overdue
        };
    });
}

function buildRegRows(rows) {
    return rows.map(r => ({
        uid: r.uid,
        reg_code: r.reg_code,
        title: r.title,
        category: r.category,
        category_name: REG_CATEGORIES[r.category] || r.category,
        issue_org: r.issue_org,
        publish_date: dstr(r.publish_date),
        effective_date: dstr(r.effective_date),
        impact_level: r.impact_level,
        impact_name: RISK_LEVELS[r.impact_level] || r.impact_level,
        summary: r.summary,
        action_required: r.action_required,
        status: r.status,
        status_name: REG_STATUS[r.status] || r.status,
        owner_id: r.owner_id,
        note: r.note
    }));
}

async function loadFilings(year) {
    const [rows] = await pool.execute(
        `SELECT * FROM tax_filing_task WHERE tax_year=? ORDER BY due_date, tax_type`, [year]);
    return rows;
}

async function loadItems(year) {
    const [rows] = await pool.execute(
        `SELECT * FROM tax_compliance_item WHERE tax_year=?
          ORDER BY (due_date IS NULL), due_date, uid`, [year]);
    return rows;
}

async function loadRegulations(year) {
    const [rows] = await pool.execute(
        `SELECT * FROM tax_regulation
          WHERE status <> 'ARCHIVED'
            AND (YEAR(publish_date)=? OR YEAR(effective_date)=?)
          ORDER BY impact_level, COALESCE(effective_date, publish_date) DESC, uid DESC`,
        [year, year]);
    return rows;
}

/**
 * 计算一个范围（公司或全部）的合规评分、KPI、分类统计与预警
 */
function computeScope(bu, year, filings, items, regs, today) {
    const dueFilings = filings.filter(f => f.due_date && f.due_date <= today && f.status !== 'EXEMPT');
    const filedOnTime = dueFilings.filter(f => f.status === 'FILED' && f.filed_date && f.filed_date <= f.due_date);
    const lateFiled = filings.filter(f => f.late);
    const overdueFilings = dueFilings.filter(f => f.status === 'OVERDUE');
    const pendingFilings = filings.filter(f => f.status === 'PENDING');
    const dueSoon = pendingFilings.filter(f => f.due_date >= today && f.due_date <= addDays(today, DUE_SOON_DAYS));
    const upcoming = pendingFilings
        .filter(f => f.due_date >= today && f.due_date <= addDays(today, UPCOMING_DAYS))
        .sort((a, b) => a.due_date.localeCompare(b.due_date));

    const onTimeRate = dueFilings.length ? r2((filedOnTime.length / dueFilings.length) * 100) : null;

    const doneItems = items.filter(i => i.status === 'DONE');
    const waivedItems = items.filter(i => i.status === 'WAIVED');
    const overdueItems = items.filter(i => i.overdue);
    const highRiskOpen = items.filter(i => i.risk_level === 'HIGH' && !['DONE', 'WAIVED'].includes(i.status));
    const completionRate = items.length
        ? r2(((doneItems.length + waivedItems.length) / items.length) * 100) : null;

    const regImplemented = regs.filter(r => r.status === 'IMPLEMENTED');
    const regOpen = regs.filter(r => r.status === 'NEW' || r.status === 'ASSESSING');
    const regRate = regs.length ? r2((regImplemented.length / regs.length) * 100) : null;

    const parts = [];
    if (onTimeRate != null) parts.push({ w: WEIGHTS.filing, v: onTimeRate });
    if (completionRate != null) parts.push({ w: WEIGHTS.item, v: completionRate });
    if (regRate != null) parts.push({ w: WEIGHTS.regulation, v: regRate });
    const wSum = parts.reduce((s, p) => s + p.w, 0);
    // 无申报任务且无合规事项的公司不参与评分（法规为集团统一口径）
    const hasActivity = filings.length > 0 || items.length > 0;
    const score = hasActivity && wSum ? r2(parts.reduce((s, p) => s + p.w * p.v, 0) / wSum) : null;
    const g = gradeOf(score);

    const kpis = {
        filing_total: filings.length,
        filing_filed: filings.filter(f => f.status === 'FILED').length,
        filing_pending: pendingFilings.length,
        filing_overdue: overdueFilings.length,
        filing_due_soon: dueSoon.length,
        filing_late: lateFiled.length,
        tax_amount_total: r2(filings.filter(f => f.status === 'FILED').reduce((s, f) => s + n(f.tax_amount), 0)),
        on_time_rate: onTimeRate,
        item_total: items.length,
        item_done: doneItems.length,
        item_in_progress: items.filter(i => i.status === 'IN_PROGRESS').length,
        item_overdue: overdueItems.length,
        item_high_risk_open: highRiskOpen.length,
        completion_rate: completionRate,
        reg_total: regs.length,
        reg_open: regOpen.length,
        reg_implemented: regImplemented.length,
        reg_implement_rate: regRate
    };

    const alerts = [];
    if (!filings.length) {
        alerts.push({
            code: 'NO_FILING_CALENDAR', level: 'warning',
            message: `${bu === 'ALL' ? '全部范围' : bu} 尚未生成 ${year} 年度申报日历`,
            suggestion: '点击「生成申报日历」按标准税种与截止日批量建立任务。',
            metric: 0
        });
    }
    if (overdueFilings.length) {
        const first = overdueFilings[0];
        alerts.push({
            code: 'OVERDUE_FILING', level: 'danger',
            message: `${overdueFilings.length} 项申报逾期，最早为 ${first.tax_period || first.tax_year} ${first.tax_type_name}（截止 ${first.due_date}）`,
            suggestion: '立即补申报并登记回执号，评估滞纳金与罚款风险。',
            metric: overdueFilings.length
        });
    }
    if (dueSoon.length) {
        alerts.push({
            code: 'FILING_DUE_SOON', level: 'warning',
            message: `${DUE_SOON_DAYS} 天内有 ${dueSoon.length} 项申报到期`,
            suggestion: '提前完成算税与扣缴数据核对，避免逾期。',
            metric: dueSoon.length
        });
    }
    if (lateFiled.length) {
        alerts.push({
            code: 'LATE_FILING', level: 'warning',
            message: `有 ${lateFiled.length} 项申报迟于截止日完成`,
            suggestion: '复盘迟报原因，必要时向税务机关说明并留存证据。',
            metric: lateFiled.length
        });
    }
    if (overdueItems.length) {
        alerts.push({
            code: 'OVERDUE_COMPLIANCE', level: 'danger',
            message: `有 ${overdueItems.length} 项合规事项已逾期未完成`,
            suggestion: '明确责任人并按周跟踪，高风险事项优先处理。',
            metric: overdueItems.length
        });
    }
    if (highRiskOpen.length) {
        alerts.push({
            code: 'HIGH_RISK_OPEN', level: 'warning',
            message: `有 ${highRiskOpen.length} 项高风险合规事项仍未完成：${highRiskOpen.slice(0, 3).map(i => i.item_name).join('、')}`,
            suggestion: '优先补齐证据链，无法完成的登记豁免理由。',
            metric: highRiskOpen.length
        });
    }
    if (regOpen.length) {
        alerts.push({
            code: 'REG_ACTION_PENDING', level: 'warning',
            message: `有 ${regOpen.length} 项法规政策待评估或待落实`,
            suggestion: '评估对申报口径、发票与合同条款的影响并落实到责任人。',
            metric: regOpen.length
        });
    }

    const byTaxType = {};
    for (const f of filings) {
        if (!byTaxType[f.tax_type]) {
            byTaxType[f.tax_type] = { tax_type: f.tax_type, tax_type_name: f.tax_type_name, count: 0, filed: 0, overdue: 0, amount: 0 };
        }
        const t = byTaxType[f.tax_type];
        t.count += 1;
        if (f.status === 'FILED') { t.filed += 1; t.amount += n(f.tax_amount); }
        if (f.status === 'OVERDUE') t.overdue += 1;
    }

    const byCategory = {};
    for (const i of items) {
        if (!byCategory[i.category]) {
            byCategory[i.category] = { category: i.category, category_name: i.category_name, count: 0, done: 0, overdue: 0 };
        }
        const c = byCategory[i.category];
        c.count += 1;
        if (i.status === 'DONE' || i.status === 'WAIVED') c.done += 1;
        if (i.overdue) c.overdue += 1;
    }

    return {
        bu_no: bu,
        score: {
            value: score,
            grade: g.grade,
            grade_label: g.label,
            on_time_rate: onTimeRate,
            completion_rate: completionRate,
            reg_implement_rate: regRate,
            weights: WEIGHTS
        },
        kpis,
        alerts,
        upcomings: upcoming.slice(0, 20),
        by_tax_type: Object.values(byTaxType).map(v => ({ ...v, amount: r2(v.amount) })),
        by_category: Object.values(byCategory)
    };
}

async function buildOverview(bu, year) {
    const today = todayStr();
    const [filingRaw, itemRaw, regRaw] = await Promise.all([
        loadFilings(year), loadItems(year), loadRegulations(year)
    ]);
    const filings = buildFilingRows(filingRaw, today);
    const items = buildItemRows(itemRaw, today);
    const regs = buildRegRows(regRaw);

    const scopeFilings = bu === 'ALL' ? filings : filings.filter(f => f.bu_no === bu);
    const scopeItems = bu === 'ALL' ? items : items.filter(i => i.bu_no === bu);

    const scope = computeScope(bu, year, scopeFilings, scopeItems, regs, today);

    const compare = COMPANY_BUS.map(b => {
        const s = computeScope(
            b, year,
            filings.filter(f => f.bu_no === b),
            items.filter(i => i.bu_no === b),
            regs, today
        );
        return {
            bu_no: b,
            score: s.score.value,
            grade: s.score.grade,
            on_time_rate: s.kpis.on_time_rate,
            completion_rate: s.kpis.completion_rate,
            filing_overdue: s.kpis.filing_overdue,
            item_overdue: s.kpis.item_overdue,
            reg_open: s.kpis.reg_open
        };
    });

    return {
        YYYY: year,
        bu_no: bu,
        today,
        score: scope.score,
        kpis: scope.kpis,
        alerts: scope.alerts,
        upcomings: scope.upcomings,
        by_tax_type: scope.by_tax_type,
        by_category: scope.by_category,
        filings: scopeFilings,
        items: scopeItems,
        regulations: regs,
        compare
    };
}

/** 下月 15 日为申报截止日 */
function nextMonthDue(year, month) {
    const y = month === 12 ? year + 1 : year;
    const m = month === 12 ? 1 : month + 1;
    return `${y}-${pad2(m)}-15`;
}

/**
 * 按标准税种批量生成年度申报日历（已存在的任务不覆盖）
 */
async function generateFilings(bu, year) {
    const tasks = [];
    const add = (period, type, cycle, due) => tasks.push([bu, year, period, type, cycle, due]);

    for (let m = 1; m <= 12; m++) {
        const period = `${year}-${pad2(m)}`;
        const due = nextMonthDue(year, m);
        add(period, 'VAT', 'MONTHLY', due);
        add(period, 'SURCHARGE', 'MONTHLY', due);
        add(period, 'IIT', 'MONTHLY', due);
    }
    for (const q of [3, 6, 9, 12]) {
        const period = `${year}-${pad2(q)}`;
        const due = nextMonthDue(year, q);
        add(period, 'CIT', 'QUARTERLY', due);
        add(period, 'STAMP_DUTY', 'QUARTERLY', due);
    }
    add(`${year}-12`, 'CIT', 'ANNUAL', `${year + 1}-05-31`);

    let generated = 0;
    for (const t of tasks) {
        const [res] = await pool.execute(
            `INSERT IGNORE INTO tax_filing_task
                (bu_no, tax_year, tax_period, tax_type, filing_cycle, due_date, status)
             VALUES (?,?,?,?,?,?,'PENDING')`, t);
        generated += res.affectedRows || 0;
    }
    return { generated, existing: tasks.length - generated, total: tasks.length };
}

async function writeAlerts(bu, year, alerts) {
    const created = [];
    let suppressed = 0;
    for (const a of alerts) {
        const dedup = `TAXC|${a.code}|${bu}|${year}`;
        const [dup] = await pool.execute(
            `SELECT uid FROM alert_log WHERE dedup_key=?
              AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) LIMIT 1`, [dedup]);
        if (dup.length) { suppressed++; continue; }
        const [ins] = await pool.execute(
            `INSERT INTO alert_log
                (rule_id, bu_no, kpi_id, kpi_name, current_value, threshold, level,
                 title, message, suggestion, channel, alert_domain, dedup_key, notify_status)
             VALUES (NULL,?,?,?,?,?,?,?,?,?,?, 'FINANCE', ?, 'SKIPPED')`,
            [bu, 'TAX_COMPLIANCE', '税务合规', a.metric, null, a.level,
             `⚠️ ${bu} ${year} 税务合规预警`, a.message, a.suggestion,
             'inapp', dedup]);
        created.push({ uid: ins.insertId, code: a.code, level: a.level, message: a.message });
    }
    return { created, suppressed };
}

async function scanCompliance(bu, year) {
    const today = todayStr();
    const [filingRaw, itemRaw, regRaw] = await Promise.all([
        loadFilings(year), loadItems(year), loadRegulations(year)
    ]);
    const filings = buildFilingRows(filingRaw, today);
    const items = buildItemRows(itemRaw, today);
    const regs = buildRegRows(regRaw);

    const targets = bu === 'ALL' ? BUS : [bu];
    const result = { YYYY: year, bu_no: bu, scanned: 0, created: 0, suppressed: 0, alerts: [] };

    for (const b of targets) {
        const s = computeScope(
            b, year,
            filings.filter(f => f.bu_no === b),
            items.filter(i => i.bu_no === b),
            regs, today
        );
        result.scanned += s.alerts.length;
        const w = await writeAlerts(b, year, s.alerts);
        result.created += w.created.length;
        result.suppressed += w.suppressed;
        result.alerts.push(...w.created.map(a => ({ bu_no: b, ...a })));
    }
    return result;
}

module.exports = {
    BUS, COMPANY_BUS,
    TAX_TYPES, FILING_CYCLES, FILING_STATUS,
    ITEM_CATEGORIES, ITEM_FREQUENCIES, ITEM_STATUS, RISK_LEVELS,
    REG_CATEGORIES, REG_STATUS,
    todayStr, addDays,
    buildFilingRows, buildItemRows, buildRegRows,
    buildOverview, generateFilings, scanCompliance
};
