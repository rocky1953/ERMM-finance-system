/**
 * 生成 2023~2025 年度「投资与资本配置决策」测试资料（CEO-03）
 *
 * 写入表：
 *   investment_budget    年度资本预算（GROUP/HM/HN/SZ）
 *   investment_project   投资项目主档（2023~2025 每年 6 个，覆盖全部类别与状态）
 *   investment_cashflow  分年度计划现金流（含爬坡曲线）与已完成/实施中项目的实际值
 *
 * 资料设计：
 *   - 2023 项目多为已完成，另有暂缓/否决各 1 个
 *   - 2024 项目为已完成/实施中/已批准，其中 HN 已批准投资略超预算，用于演示超支预警
 *   - 2025 项目为实施中/已批准/审批中/草拟/否决，当年仅记录 1 年实际值
 *   - 实际现金流围绕计划值上下浮动，便于投后偏差分析
 *
 * 用法：
 *   node scripts/seed_investment_demo.js          仅当 2023~2025 无项目时写入
 *   node scripts/seed_investment_demo.js --force  覆盖 2023~2025 已有项目与预算
 */
const { pool } = require('../config/db');

const YEARS = ['2023', '2024', '2025'];

const round2 = (v) => Math.round(Number(v) * 100) / 100;

// 年度资本预算（元）
const BUDGETS = {
    2023: { GROUP: 30000000, HM: 15000000, HN: 10000000, SZ: 8000000 },
    2024: { GROUP: 40000000, HM: 18000000, HN: 12000000, SZ: 10000000 },
    2025: { GROUP: 50000000, HM: 22000000, HN: 15000000, SZ: 12000000 }
};

// 计划现金流爬坡系数（按年度序号）
const RAMP = [0.80, 0.95, 1.05, 1.00, 0.98, 0.95, 0.92, 0.90];

/**
 * 项目清单
 * actualYears: 已产生实际值的年数；actualFactors: 各年实际/计划比率
 */
const PROJECTS = [
    // ===== 2023 =====
    {
        code: 'INV-2023-HM-01', name: 'HM 一号注塑产线自动化改造', bu: 'HM', category: 'CAPACITY', status: 'COMPLETED',
        start: '2023-02', horizon: 5, rate: 8, invest: 8000000, salvage: 600000, annual: 2400000,
        owner: 'U0008', dept: '生产部', priority: 1, actualYears: 3, actualFactors: [0.92, 1.06, 0.97]
    },
    {
        code: 'INV-2023-HN-01', name: 'HN 智能仓储一期', bu: 'HN', category: 'EQUIPMENT', status: 'COMPLETED',
        start: '2023-03', horizon: 5, rate: 9, invest: 5500000, salvage: 400000, annual: 1600000,
        owner: 'U0013', dept: '采购部', priority: 2, actualYears: 3, actualFactors: [1.02, 0.94, 1.08]
    },
    {
        code: 'INV-2023-SZ-01', name: 'SZ 财务共享系统导入', bu: 'SZ', category: 'IT', status: 'COMPLETED',
        start: '2023-04', horizon: 4, rate: 10, invest: 2200000, salvage: 0, annual: 800000,
        owner: 'U0023', dept: '资讯部', priority: 3, actualYears: 3, actualFactors: [0.88, 1.03, 1.12]
    },
    {
        code: 'INV-2023-GR-01', name: '集团研发中心一期', bu: 'GROUP', category: 'RD', status: 'COMPLETED',
        start: '2023-01', horizon: 6, rate: 8, invest: 12000000, salvage: 1500000, annual: 3200000,
        owner: 'rocky', dept: '研发中心', priority: 1, actualYears: 3, actualFactors: [0.95, 1.04, 1.10]
    },
    {
        code: 'INV-2023-HM-02', name: 'HM 老旧设备处置与更新', bu: 'HM', category: 'EQUIPMENT', status: 'ON_HOLD',
        start: '2023-06', horizon: 4, rate: 9, invest: 3000000, salvage: 200000, annual: 700000,
        owner: 'U0008', dept: '生产部', priority: 5, actualYears: 0, actualFactors: []
    },
    {
        code: 'INV-2023-SZ-02', name: 'SZ 海外市场拓展投入', bu: 'SZ', category: 'MA', status: 'REJECTED',
        start: '2023-09', horizon: 5, rate: 12, invest: 6000000, salvage: 0, annual: 1100000,
        owner: 'U0002', dept: '业务部', priority: 6, actualYears: 0, actualFactors: []
    },

    // ===== 2024 =====
    {
        code: 'INV-2024-HM-01', name: 'HM 二号产线扩建', bu: 'HM', category: 'CAPACITY', status: 'IN_PROGRESS',
        start: '2024-02', horizon: 6, rate: 8, invest: 10000000, salvage: 800000, annual: 3000000,
        owner: 'U0008', dept: '生产部', priority: 1, actualYears: 2, actualFactors: [0.90, 1.05]
    },
    {
        code: 'INV-2024-HN-01', name: 'HN 仓储自动化二期', bu: 'HN', category: 'EQUIPMENT', status: 'COMPLETED',
        start: '2024-03', horizon: 5, rate: 9, invest: 4500000, salvage: 350000, annual: 1450000,
        owner: 'U0013', dept: '采购部', priority: 2, actualYears: 2, actualFactors: [1.04, 0.98]
    },
    {
        code: 'INV-2024-SZ-01', name: 'SZ 数字化工厂试点', bu: 'SZ', category: 'IT', status: 'IN_PROGRESS',
        start: '2024-05', horizon: 4, rate: 10, invest: 3200000, salvage: 0, annual: 1150000,
        owner: 'U0023', dept: '资讯部', priority: 2, actualYears: 2, actualFactors: [0.93, 1.09]
    },
    {
        code: 'INV-2024-GR-01', name: '集团新能源材料研发', bu: 'GROUP', category: 'RD', status: 'APPROVED',
        start: '2024-07', horizon: 7, rate: 8, invest: 15000000, salvage: 2000000, annual: 3600000,
        owner: 'rocky', dept: '研发中心', priority: 1, actualYears: 0, actualFactors: []
    },
    {
        code: 'INV-2024-HM-02', name: 'HM 环保设备升级', bu: 'HM', category: 'EQUIPMENT', status: 'COMPLETED',
        start: '2024-04', horizon: 5, rate: 8, invest: 2800000, salvage: 150000, annual: 900000,
        owner: 'U0001', dept: '环安部', priority: 3, actualYears: 2, actualFactors: [0.97, 1.06]
    },
    {
        code: 'INV-2024-HN-02', name: 'HN 华东渠道并购', bu: 'HN', category: 'MA', status: 'APPROVED',
        start: '2024-10', horizon: 5, rate: 11, invest: 9000000, salvage: 600000, annual: 2300000,
        owner: 'U0012', dept: '业务部', priority: 4, actualYears: 0, actualFactors: []
    },

    // ===== 2025 =====
    {
        code: 'INV-2025-HM-01', name: 'HM 智能产线三期', bu: 'HM', category: 'CAPACITY', status: 'IN_PROGRESS',
        start: '2025-03', horizon: 5, rate: 8, invest: 12000000, salvage: 1000000, annual: 3800000,
        owner: 'U0008', dept: '生产部', priority: 1, actualYears: 1, actualFactors: [1.03]
    },
    {
        code: 'INV-2025-HN-01', name: 'HN 仓储机器人导入', bu: 'HN', category: 'EQUIPMENT', status: 'APPROVED',
        start: '2025-05', horizon: 4, rate: 9, invest: 5000000, salvage: 400000, annual: 1700000,
        owner: 'U0013', dept: '采购部', priority: 2, actualYears: 0, actualFactors: []
    },
    {
        code: 'INV-2025-SZ-01', name: 'SZ 供应链协同平台', bu: 'SZ', category: 'IT', status: 'REVIEW',
        start: '2025-06', horizon: 4, rate: 10, invest: 3500000, salvage: 0, annual: 1250000,
        owner: 'U0023', dept: '资讯部', priority: 3, actualYears: 0, actualFactors: []
    },
    {
        code: 'INV-2025-GR-01', name: '集团海外研发中心', bu: 'GROUP', category: 'RD', status: 'DRAFT',
        start: '2025-09', horizon: 8, rate: 9, invest: 20000000, salvage: 2500000, annual: 4500000,
        owner: 'rocky', dept: '研发中心', priority: 5, actualYears: 0, actualFactors: []
    },
    {
        code: 'INV-2025-HM-02', name: 'HM 节能改造项目', bu: 'HM', category: 'OTHER', status: 'IN_PROGRESS',
        start: '2025-04', horizon: 4, rate: 8, invest: 1800000, salvage: 100000, annual: 650000,
        owner: 'U0001', dept: '环安部', priority: 4, actualYears: 1, actualFactors: [1.08]
    },
    {
        code: 'INV-2025-SZ-02', name: 'SZ 跨境电商并购', bu: 'SZ', category: 'MA', status: 'REJECTED',
        start: '2025-08', horizon: 4, rate: 12, invest: 4000000, salvage: 0, annual: 750000,
        owner: 'U0002', dept: '业务部', priority: 6, actualYears: 0, actualFactors: []
    }
];

async function main() {
    const force = process.argv.includes('--force');
    const [exist] = await pool.execute(
        `SELECT COUNT(*) AS c FROM investment_project WHERE fiscal_year IN ('2023','2024','2025')`);
    const existing = Number(exist[0].c);
    if (existing > 0 && !force) {
        console.log(`⚠️  2023~2025 已有 ${existing} 个投资项目，如需覆盖请执行：node scripts/seed_investment_demo.js --force`);
        process.exit(1);
    }
    if (existing > 0) {
        await pool.execute(`DELETE FROM investment_project WHERE fiscal_year IN ('2023','2024','2025')`);
        await pool.execute(`DELETE FROM investment_budget WHERE fiscal_year IN ('2023','2024','2025')`);
        console.log(`🧹 已清理 2023~2025 旧资料（项目 ${existing} 个）`);
    }

    console.log('📌 开始生成 2023~2025 投资与资本配置测试资料 ...');

    let budgetCount = 0;
    let cfCount = 0;

    for (const year of YEARS) {
        // 资本预算
        for (const [bu, amount] of Object.entries(BUDGETS[year])) {
            await pool.execute(
                `INSERT INTO investment_budget (fiscal_year, bu_no, budget_amount, note)
                 VALUES (?,?,?,?)
                 ON DUPLICATE KEY UPDATE budget_amount=VALUES(budget_amount), note=VALUES(note)`,
                [year, bu, amount, `FY${year} 演示预算`]);
            budgetCount++;
        }

        const list = PROJECTS.filter(p => p.code.includes(`-${year}-`));
        for (const p of list) {
            const [r] = await pool.execute(
                `INSERT INTO investment_project
                    (project_code, project_name, bu_no, category, fiscal_year, start_month,
                     horizon_years, discount_rate, initial_investment, salvage_value,
                     annual_cashflow, status, priority, owner_id, department, remark)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [p.code, p.name, p.bu, p.category, year, p.start, p.horizon, p.rate,
                 p.invest, p.salvage, p.annual, p.status, p.priority, p.owner, p.dept,
                 `FY${year} 投资与资本配置演示数据`]);
            const pid = r.insertId;

            const values = [];
            const params = [];
            for (let y = 1; y <= p.horizon; y++) {
                const planned = round2(p.annual * (RAMP[y - 1] || 0.9));
                const factor = p.actualYears >= y ? (p.actualFactors[y - 1] || 1) : 0;
                const actual = factor ? round2(planned * factor) : 0;
                values.push('(?,?,?,?,?)');
                params.push(pid, y, planned, actual, factor ? '演示实际值' : null);
            }
            await pool.execute(
                `INSERT INTO investment_cashflow (project_id, year_index, planned_amount, actual_amount, note)
                 VALUES ${values.join(',')}`, params);
            cfCount += p.horizon;
        }
        console.log(`✅ ${year}：项目 ${list.length} 个，现金流 ${list.reduce((s, p) => s + p.horizon, 0)} 笔`);
    }

    // 结果核对
    const [chk] = await pool.execute(
        `SELECT o.fiscal_year,
                COUNT(DISTINCT o.project_id) AS projects,
                SUM(CASE WHEN o.status IN ('APPROVED','IN_PROGRESS','COMPLETED') THEN 1 ELSE 0 END) AS committed_cnt,
                SUM(o.initial_investment) AS invest,
                SUM(CASE WHEN o.status IN ('APPROVED','IN_PROGRESS','COMPLETED') THEN o.initial_investment ELSE 0 END) AS committed,
                (SELECT SUM(b.budget_amount) FROM investment_budget b WHERE b.fiscal_year=o.fiscal_year) AS budget
           FROM investment_project o
          WHERE o.fiscal_year IN ('2023','2024','2025')
          GROUP BY o.fiscal_year ORDER BY o.fiscal_year`);
    console.log('\n=== 写入结果 ===');
    for (const r of chk) {
        console.log(`${r.fiscal_year}：项目 ${r.projects} 个（已配置 ${r.committed_cnt} 个），投资合计 ${round2(r.invest)}，已批准 ${round2(r.committed)}，预算合计 ${round2(r.budget)}`);
    }
    console.log(`预算 ${budgetCount} 笔，现金流 ${cfCount} 笔`);
    console.log('\n🎉 2023~2025 投资与资本配置测试资料生成完成');
    process.exit(0);
}

main().catch((e) => { console.error('❌ 生成失败:', e); process.exit(1); });
