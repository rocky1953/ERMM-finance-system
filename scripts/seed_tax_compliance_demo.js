/**
 * CFO-10 税务与合规管理 2023~2025 测试资料
 *
 * 写入：
 *   1. tax_filing_task     纳税申报日历：45 项/公司/年（HM/HN/SZ × 3 年 = 405 项）
 *   2. tax_compliance_item 合规事项：8 项/公司/年（共 72 项）
 *   3. tax_regulation      法规政策：2023/2024 各 3 条、2025 4 条（共 10 条）
 *
 * 场景设计：
 *   - 2023：申报全部按期完成（少量免申报），合规事项全部完成，法规全部落实 → A
 *   - 2024：少数申报迟报，个别事项未完成/豁免，法规全部落实 → A/B
 *   - 2025：存在逾期申报与逾期事项，法规有待评估/评估中 → B/C
 *
 * 用法：
 *   node scripts/seed_tax_compliance_demo.js            # 已有数据时提示
 *   node scripts/seed_tax_compliance_demo.js --force    # 覆盖 2023~2025 种子数据
 */
const { pool } = require('../config/db');
const { buildOverview } = require('../services/taxCompliance');

let seed = 20231115;
function rnd() {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
}
const rand = (min, max) => min + rnd() * (max - min);
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const pad2 = (v) => String(v).padStart(2, '0');
const addDays = (day, days) => {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
};

const YEARS = ['2023', '2024', '2025'];
const BUS = ['HM', 'HN', 'SZ'];
const OWNER = { HM: 'U0006', HN: 'U0030', SZ: 'U0005' };   // 各公司财务部
const SCALE = { HM: 1, HN: 0.72, SZ: 0.55 };               // 业务规模系数

/** 下月 15 日 */
function nextMonthDue(year, month) {
    const y = month === 12 ? Number(year) + 1 : Number(year);
    const m = month === 12 ? 1 : month + 1;
    return `${y}-${pad2(m)}-15`;
}

/** 与线上「生成申报日历」一致的标准任务清单 */
function scheduleOf(year) {
    const list = [];
    for (let m = 1; m <= 12; m++) {
        const period = `${year}-${pad2(m)}`;
        const due = nextMonthDue(year, m);
        list.push({ period, tax_type: 'VAT', cycle: 'MONTHLY', due });
        list.push({ period, tax_type: 'SURCHARGE', cycle: 'MONTHLY', due });
        list.push({ period, tax_type: 'IIT', cycle: 'MONTHLY', due });
    }
    for (const q of [3, 6, 9, 12]) {
        const period = `${year}-${pad2(q)}`;
        const due = nextMonthDue(year, q);
        list.push({ period, tax_type: 'CIT', cycle: 'QUARTERLY', due });
        list.push({ period, tax_type: 'STAMP_DUTY', cycle: 'QUARTERLY', due });
    }
    list.push({ period: `${year}-12`, tax_type: 'CIT', cycle: 'ANNUAL', due: `${Number(year) + 1}-05-31` });
    return list;
}

/** 逾期任务（未申报，逾期由截止日推导） */
function isOverdue(bu, year, t) {
    if (year !== '2025') return false;
    if (bu === 'HN' && t.period === '2025-11' && (t.tax_type === 'VAT' || t.tax_type === 'SURCHARGE')) return true;
    if (bu === 'SZ' && t.period === '2025-11' && t.tax_type === 'VAT') return true;
    return false;
}

/** 迟报任务（已申报但晚于截止日） */
function isLate(bu, year, t) {
    if (year === '2024') {
        return (t.tax_type === 'VAT' && t.period === '2024-05')
            || (t.tax_type === 'CIT' && t.period === '2024-06' && t.cycle === 'QUARTERLY');
    }
    if (year === '2025') {
        return (t.tax_type === 'VAT' && t.period === '2025-03')
            || (t.tax_type === 'IIT' && t.period === '2025-04')
            || (t.tax_type === 'SURCHARGE' && t.period === '2025-08');
    }
    return false;
}

/** 免申报任务 */
function isExempt(bu, year, t) {
    if (t.tax_type !== 'STAMP_DUTY') return false;
    if (year === '2023') return (bu === 'HM' && t.period === '2023-03') || (bu === 'SZ' && t.period === '2023-09');
    if (year === '2024') return (bu === 'SZ' && t.period === '2024-03') || (bu === 'HN' && t.period === '2024-09');
    return false;
}

function amountOf(t, bu) {
    const s = SCALE[bu];
    switch (t.tax_type) {
        case 'VAT': return Math.round(rand(380000, 920000) * s);
        case 'SURCHARGE': return Math.round(rand(45000, 112000) * s);
        case 'IIT': return Math.round(rand(110000, 260000) * s);
        case 'CIT': return Math.round((t.cycle === 'ANNUAL' ? rand(1600000, 3600000) : rand(360000, 980000)) * s);
        case 'STAMP_DUTY': return Math.round(rand(18000, 72000) * s);
        default: return 0;
    }
}

function buildFilingRows(bu, year) {
    const rows = [];
    const list = scheduleOf(year);
    list.forEach((t, idx) => {
        const base = {
            bu_no: bu, tax_year: year, tax_period: t.period,
            tax_type: t.tax_type, filing_cycle: t.cycle, due_date: t.due, owner_id: OWNER[bu]
        };
        if (isOverdue(bu, year, t)) {
            rows.push({ ...base, status: 'PENDING', filed_date: null, tax_amount: 0, receipt_no: null });
            return;
        }
        if (isExempt(bu, year, t)) {
            rows.push({ ...base, status: 'EXEMPT', filed_date: null, tax_amount: 0, receipt_no: null });
            return;
        }
        const late = isLate(bu, year, t);
        const filed = late ? addDays(t.due, 2 + Math.floor(rnd() * 7)) : addDays(t.due, -(1 + Math.floor(rnd() * 5)));
        rows.push({
            ...base, status: 'FILED', filed_date: filed,
            tax_amount: amountOf(t, bu),
            receipt_no: `RCPT-${year}-${bu}-${pad2(idx + 1)}`
        });
    });
    return rows;
}

const ITEM_DEFS = [
    { category: 'INVOICE', name: '进项发票勾选确认', req: '每月 10 日前完成进项发票勾选与抵扣确认', freq: 'MONTHLY', risk: 'HIGH', due: '12-10' },
    { category: 'INVOICE', name: '销项发票作废/红冲复核', req: '季度末复核作废与红冲发票，留存审批记录', freq: 'QUARTERLY', risk: 'MEDIUM', due: '04-15' },
    { category: 'CONTRACT', name: '重大合同印花税申报', req: '金额 500 万以上合同按 0.03% 申报印花税', freq: 'EVENT', risk: 'MEDIUM', due: '11-30' },
    { category: 'ARCHIVE', name: '年度申报资料归档', req: '申报表、回执、完税凭证按年度归档保存 10 年', freq: 'ANNUAL', risk: 'MEDIUM', due: '12-31' },
    { category: 'RELATED_PARTY', name: '关联交易同期资料准备', req: '关联购销金额超阈值需准备本地文档', freq: 'ANNUAL', risk: 'HIGH', due: '05-31' },
    { category: 'PREFERENCE', name: '高新技术企业优惠备案', req: '复核高新资格与研发费用归集，完成优惠备案', freq: 'ANNUAL', risk: 'HIGH', due: '05-31' },
    { category: 'REGISTRATION', name: '税务登记信息核对', req: '核对财务负责人、地址、银行账户等登记信息', freq: 'ANNUAL', risk: 'LOW', due: '06-30' },
    { category: 'OTHER', name: '税务稽查问询响应', req: '稽查问询 10 个工作日内书面回复并归档', freq: 'EVENT', risk: 'HIGH', due: '09-30' }
];

const EVIDENCE = {
    INVOICE: '发票勾选/作废清单已归档',
    CONTRACT: '印花税申报表与回执已归档',
    ARCHIVE: '年度申报档案目录已归档',
    RELATED_PARTY: '同期资料本地文档已归档',
    PREFERENCE: '优惠备案回执已归档',
    REGISTRATION: '登记信息核对表已归档',
    OTHER: '问询回复函与证据清单已归档'
};

/** 各年各公司的合规事项状态安排 */
function itemStatus(bu, year, idx) {
    if (year === '2023') {
        if (bu === 'SZ' && idx === 5) return 'WAIVED';
        return 'DONE';
    }
    if (year === '2024') {
        if (bu === 'HN' && idx === 1) return 'IN_PROGRESS';
        if (bu === 'SZ' && idx === 5) return 'WAIVED';
        return 'DONE';
    }
    const plan = {
        HM: ['DONE', 'DONE', 'IN_PROGRESS', 'NOT_STARTED', 'IN_PROGRESS', 'DONE', 'DONE', 'NOT_STARTED'],
        HN: ['DONE', 'DONE', 'NOT_STARTED', 'IN_PROGRESS', 'NOT_STARTED', 'DONE', 'DONE', 'IN_PROGRESS'],
        SZ: ['DONE', 'DONE', 'DONE', 'IN_PROGRESS', 'NOT_STARTED', 'WAIVED', 'DONE', 'DONE']
    };
    return plan[bu][idx];
}

function buildItemRows(bu, year) {
    return ITEM_DEFS.map((d, idx) => {
        const status = itemStatus(bu, year, idx);
        const due = `${year}-${d.due}`;
        const done = status === 'DONE';
        return {
            bu_no: bu, tax_year: year, category: d.category, item_name: d.name,
            requirement: d.req, frequency: d.freq, owner_dept: '财务部', owner_id: OWNER[bu],
            due_date: due,
            completed_date: done ? addDays(due, -(1 + Math.floor(rnd() * 15))) : null,
            status,
            risk_level: d.risk,
            evidence: done ? EVIDENCE[d.category] : (status === 'WAIVED' ? '不适用，已登记豁免说明' : null),
            note: status === 'WAIVED' ? '本公司不适用该优惠事项' : null
        };
    });
}

const REGULATIONS = [
    ['财税〔2023〕7号', '研发费用加计扣除比例提高至 100%', 'CIT', '财政部/税务总局', '2023-03-26', '2023-01-01', 'HIGH', 'IMPLEMENTED',
        '企业研发费用加计扣除比例由 75% 提高至 100% 并作为制度性安排长期实施。', '已更新研发辅助账与汇算清缴模板，完成 2023 年度申报适用。'],
    ['财税〔2023〕12号', '小微企业增值税减免政策延续', 'VAT', '财政部/税务总局', '2023-08-01', '2023-01-01', 'MEDIUM', 'IMPLEMENTED',
        '月销售额 10 万元以下小规模纳税人免征增值税政策延续至 2027 年底。', '已复核各公司销售额口径，确认适用免税月份并留存备案。'],
    ['国家税务总局公告2023年第14号', '个人所得税专项附加扣除标准提高', 'IIT', '国家税务总局', '2023-08-31', '2023-01-01', 'HIGH', 'IMPLEMENTED',
        '3 岁以下婴幼儿照护、子女教育、赡养老人专项附加扣除标准提高。', '已更新个税扣缴模板并完成员工信息补录。'],
    ['财税〔2024〕8号', '设备器具一次性扣除政策延续', 'CIT', '财政部/税务总局', '2024-03-20', '2024-01-01', 'MEDIUM', 'IMPLEMENTED',
        '新购设备器具单位价值 500 万元以下可一次性税前扣除。', '已在资产入账环节标记一次性扣除并留存台账。'],
    ['国家税务总局公告2024年第2号', '增值税发票全电化试点扩围', 'VAT', '国家税务总局', '2024-01-15', '2024-02-01', 'HIGH', 'IMPLEMENTED',
        '全面数字化电子发票开票与交付要求扩大试点范围。', '已切换全电发票开具流程并完成开票人员培训。'],
    ['财税〔2024〕12号', '先进制造业增值税加计抵减', 'VAT', '财政部/税务总局', '2024-06-28', '2024-01-01', 'HIGH', 'IMPLEMENTED',
        '先进制造业企业可按当期可抵扣进项税额加计 5% 抵减应纳增值税。', '已完成资格认定与加计抵减台账，按月申报享受。'],
    ['国家税务总局公告2025年第1号', '企业所得税年度申报表修订', 'CIT', '国家税务总局', '2025-01-08', '2025-01-01', 'HIGH', 'IMPLEMENTED',
        '年度申报表部分行次与填报说明修订，涉及研发费用与资产折旧。', '已更新申报底稿与系统取数口径，完成 2024 年度汇算。'],
    ['财税〔2025〕5号', '研发费用加计扣除比例提高至 120%', 'CIT', '财政部/税务总局', '2025-03-18', '2025-01-01', 'HIGH', 'ASSESSING',
        '重点领域企业研发费用加计扣除比例拟由 100% 提高至 120%。', '正在评估适用条件与研发项目归集范围，待正式口径明确后落实。'],
    ['国家税务总局公告2025年第9号', '平台经济涉税信息报送', 'OTHER', '国家税务总局', '2025-07-05', '2025-10-01', 'MEDIUM', 'NEW',
        '平台企业需按季度报送平台内经营者与从业人员涉税信息。', '需确认是否存在平台业务并评估报送义务。'],
    ['财税〔2025〕15号', '印花税征收管理事项公告', 'OTHER', '财政部/税务总局', '2025-09-12', '2025-10-01', 'LOW', 'IMPLEMENTED',
        '明确电子合同、框架合同等印花税计税依据与申报方式。', '已梳理合同清单并调整印花税申报口径。']
];

async function main() {
    const force = process.argv.includes('--force');
    console.log('📌 开始生成 2023~2025 税务与合规管理测试资料 ...');

    const [existing] = await pool.execute(
        `SELECT
            (SELECT COUNT(*) FROM tax_filing_task WHERE tax_year IN ('2023','2024','2025')) AS filings,
            (SELECT COUNT(*) FROM tax_compliance_item WHERE tax_year IN ('2023','2024','2025')) AS items,
            (SELECT COUNT(*) FROM tax_regulation WHERE reg_code IS NOT NULL) AS regs`);
    const counts = existing[0];
    if ((counts.filings > 0 || counts.items > 0) && !force) {
        console.log(`⚠️ 已存在 2023~2025 数据（申报 ${counts.filings} / 事项 ${counts.items}），如需覆盖请加 --force`);
        process.exit(1);
    }

    if (force) {
        const [d1] = await pool.execute("DELETE FROM tax_filing_task WHERE tax_year IN ('2023','2024','2025')");
        const [d2] = await pool.execute("DELETE FROM tax_compliance_item WHERE tax_year IN ('2023','2024','2025')");
        const codes = REGULATIONS.map(r => r[0]);
        const [d3] = await pool.execute(
            `DELETE FROM tax_regulation WHERE reg_code IN (${codes.map(() => '?').join(',')})`, codes);
        console.log(`🧹 清理旧数据：申报 ${d1.affectedRows}、事项 ${d2.affectedRows}、法规 ${d3.affectedRows}`);
    }

    let filingCount = 0;
    let itemCount = 0;
    for (const year of YEARS) {
        for (const bu of BUS) {
            const filings = buildFilingRows(bu, year);
            for (const f of filings) {
                await pool.execute(
                    `INSERT INTO tax_filing_task
                        (bu_no, tax_year, tax_period, tax_type, filing_cycle, due_date,
                         filed_date, status, tax_amount, receipt_no, owner_id)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
                    [f.bu_no, f.tax_year, f.tax_period, f.tax_type, f.filing_cycle, f.due_date,
                     f.filed_date, f.status, f.tax_amount, f.receipt_no, f.owner_id]);
                filingCount++;
            }

            const items = buildItemRows(bu, year);
            for (const it of items) {
                await pool.execute(
                    `INSERT INTO tax_compliance_item
                        (bu_no, tax_year, category, item_name, requirement, frequency,
                         owner_dept, owner_id, due_date, completed_date, status, risk_level, evidence, note)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                    [it.bu_no, it.tax_year, it.category, it.item_name, it.requirement, it.frequency,
                     it.owner_dept, it.owner_id, it.due_date, it.completed_date,
                     it.status, it.risk_level, it.evidence, it.note]);
                itemCount++;
            }
        }
    }

    for (const r of REGULATIONS) {
        await pool.execute(
            `INSERT INTO tax_regulation
                (reg_code, title, category, issue_org, publish_date, effective_date,
                 impact_level, status, summary, action_required, owner_id)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
                title=VALUES(title), category=VALUES(category), issue_org=VALUES(issue_org),
                publish_date=VALUES(publish_date), effective_date=VALUES(effective_date),
                impact_level=VALUES(impact_level), summary=VALUES(summary),
                action_required=VALUES(action_required), status=VALUES(status), owner_id=VALUES(owner_id)`,
            r.concat(['U0006']));
    }

    console.log(`\n✅ 写入：申报任务 ${filingCount} 项、合规事项 ${itemCount} 项、法规 ${REGULATIONS.length} 条`);

    console.log('\n=== 评分与数据核对 ===');
    for (const year of YEARS) {
        const ov = await buildOverview('ALL', year);
        console.log(`\n${year} 年度（全部范围）：评分 ${ov.score.value} / 等级 ${ov.score.grade}`);
        console.log(`  申报 ${ov.kpis.filing_total} 项，已申报 ${ov.kpis.filing_filed}，逾期 ${ov.kpis.filing_overdue}，迟报 ${ov.kpis.filing_late}，及时率 ${ov.kpis.on_time_rate}%`);
        console.log(`  事项 ${ov.kpis.item_total} 项，完成 ${ov.kpis.item_done}，逾期 ${ov.kpis.item_overdue}，完成率 ${ov.kpis.completion_rate}%`);
        console.log(`  法规 ${ov.kpis.reg_total} 条，已落实 ${ov.kpis.reg_implemented}，落实率 ${ov.kpis.reg_implement_rate}%`);
        console.log('  分公司：' + ov.compare.map(c => `${c.bu_no} ${c.score == null ? '-' : c.score}/${c.grade}`).join('  '));
        console.log('  预警：' + (ov.alerts.map(a => a.code).join(', ') || '无'));
    }

    console.log('\n🎉 2023~2025 税务与合规管理测试资料生成完成');
    await pool.end();
}

main().catch(async (e) => {
    console.error('❌ 生成失败:', e.message);
    try { await pool.end(); } catch (_) { /* ignore */ }
    process.exit(1);
});
