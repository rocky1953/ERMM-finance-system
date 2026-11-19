/**
 * 生成 2023~2025 年度战略目标 / 平衡计分卡测试资料（CEO-01）
 *
 * 写入表：
 *   bsc_objective  公司(GROUP) + 分公司(HM/HN/SZ) + 部门 + 个人 四级目标
 *   bsc_progress   每个目标 2023-01 ~ 2025-12 的月度实际值
 *
 * 资料设计：
 *   - 集团目标 8 项，四维度各 2 项，权重合计 100
 *   - 分公司目标每司 6 项，权重合计 100，财务/流程类挂接指标中心 kpi_id（毛利率、ROE、应收天数、存货周转、流动比率）
 *     基线/目标由该公司当年 12 月实际 KPI 反推，保证达成率落在可解释区间
 *   - 部门 4 项、个人 3 项，挂接上级集团/部门目标形成层级树
 *   - 年度达成率趋势：2023 约 84 → 2024 约 95 → 2025 约 101，每年保留少量落后项
 *
 * 用法：
 *   node scripts/seed_bsc_demo.js          仅当 2023~2025 无资料时写入
 *   node scripts/seed_bsc_demo.js --force  覆盖 2023~2025 已有资料
 */
const { pool } = require('../config/db');
const { computeKpis } = require('../routes/kpiQuery');

const YEARS = ['2023', '2024', '2025'];
const BUS = ['HM', 'HN', 'SZ'];
const BU_JITTER = { HM: 2, HN: -4, SZ: 0 };

let seed = 20231115;
function rnd() {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
}
const round4 = (v) => Math.round(Number(v) * 10000) / 10000;
const pad2 = (n) => String(n).padStart(2, '0');

// 由基线/目标/期望达成率反推期末实际值（正逆向指标公式一致：A=100 时实际=目标）
function actualFor(base, target, achievement) {
    return base + (target - base) * (achievement / 100);
}

// 月度序列：1 月自基线起步，12 月落于期末实际值，中间带季节噪声
function monthlySeries(base, final) {
    const span = final - base;
    const out = [];
    for (let i = 0; i < 12; i++) {
        const t = i / 11;
        const noise = span * 0.04 * (rnd() * 2 - 1) * Math.sin(Math.PI * t);
        let v = base + span * t + noise;
        if (base >= 0 && final >= 0) v = Math.max(0, v);
        out.push(round4(v));
    }
    out[11] = round4(final);
    return out;
}

// ============ 集团目标（GROUP / COMPANY） ============
const GROUP_DEFS = [
    {
        key: 'REV', perspective: 'FINANCIAL', name: '集团合并营业收入增长', metric: '合并营业收入', unit: '万元',
        dir: 'UP', weight: 18, owner: 'rocky',
        base: [2900, 3400, 6600], target: [3400, 6600, 7000], ach: [92, 100, 96]
    },
    {
        key: 'GM', perspective: 'FINANCIAL', name: '集团毛利率提升', metric: '销售毛利率', unit: '%',
        dir: 'UP', weight: 12, owner: 'rocky',
        base: [30, 33.5, 35.8], target: [34, 36, 38], ach: [103, 96, 102]
    },
    {
        key: 'RET', perspective: 'CUSTOMER', name: '战略客户留存', metric: '战略客户留存率', unit: '%',
        dir: 'UP', weight: 13, owner: 'U0012',
        base: [84, 89, 91.5], target: [90, 92, 94], ach: [84, 94, 101]
    },
    {
        key: 'SAT', perspective: 'CUSTOMER', name: '客户满意度提升', metric: '客户满意度', unit: '分',
        dir: 'UP', weight: 12, owner: 'U0012',
        base: [78, 84.5, 87.2], target: [86, 88, 90], ach: [82, 95, 100]
    },
    {
        key: 'OTD', perspective: 'PROCESS', name: '订单准时交付', metric: '订单准时交付率', unit: '%',
        dir: 'UP', weight: 10, owner: 'U0008',
        base: [88, 94, 94.8], target: [95, 96, 97], ach: [101, 97, 103]
    },
    {
        key: 'DEFECT', perspective: 'PROCESS', name: '质量不良率下降', metric: '质量不良率', unit: '%',
        dir: 'DOWN', weight: 10, owner: 'U0008',
        base: [2.4, 1.65, 1.38], target: [1.5, 1.3, 1.2], ach: [79, 92, 104]
    },
    {
        key: 'TALENT', perspective: 'LEARNING', name: '关键人才保留', metric: '关键人才保留率', unit: '%',
        dir: 'UP', weight: 12, owner: 'rocky',
        base: [82, 88.5, 91], target: [90, 92, 94], ach: [85, 93, 99]
    },
    {
        key: 'TRAIN', perspective: 'LEARNING', name: '人才培养投入', metric: '人均培训时数', unit: '小时',
        dir: 'UP', weight: 13, owner: 'rocky',
        base: [18, 28, 33], target: [30, 34, 38], ach: [76, 78, 105]
    }
];

// ============ 部门目标（GROUP / DEPARTMENT） ============
const DEPT_DEFS = [
    {
        key: 'FIN_DEPT', parentKey: 'GM', perspective: 'FINANCIAL', name: '资金成本率下降', metric: '综合资金成本率',
        unit: '%', dir: 'DOWN', weight: 100, scope: '财务部', owner: 'U0006',
        base: [3.2, 3.0, 2.8], target: [2.6, 2.5, 2.4], ach: [80, 90, 98]
    },
    {
        key: 'SALES_DEPT', parentKey: 'RET', perspective: 'CUSTOMER', name: '新客户开发', metric: '新客户开发数',
        unit: '家', dir: 'UP', weight: 100, scope: '业务部', owner: 'U0017',
        base: [45, 50, 55], target: [70, 75, 80], ach: [85, 95, 102]
    },
    {
        key: 'PROD_DEPT', parentKey: 'OTD', perspective: 'PROCESS', name: '生产良率提升', metric: '生产良率',
        unit: '%', dir: 'UP', weight: 100, scope: '生产部', owner: 'U0008',
        base: [92, 94, 95.5], target: [97, 97.5, 98], ach: [78, 92, 100]
    },
    {
        key: 'HR_DEPT', parentKey: 'TALENT', perspective: 'LEARNING', name: '关键岗位到岗', metric: '关键岗位到岗率',
        unit: '%', dir: 'UP', weight: 100, scope: '人资部', owner: 'U0001',
        base: [80, 85, 88], target: [95, 95, 96], ach: [82, 91, 99]
    }
];

// ============ 个人目标（GROUP / PERSONAL） ============
const PERSONAL_DEFS = [
    {
        key: 'P_FIN', parentKey: 'FIN_DEPT', perspective: 'FINANCIAL', name: '月度资金计划准确率', metric: '资金计划准确率',
        unit: '%', dir: 'UP', weight: 100, scope: '财务部-资金组', owner: 'rocky',
        base: [85, 88, 90], target: [95, 96, 97], ach: [84, 93, 101]
    },
    {
        key: 'P_SALES', parentKey: 'SALES_DEPT', perspective: 'CUSTOMER', name: '重点客户回款达成', metric: '回款达成率',
        unit: '%', dir: 'UP', weight: 100, scope: '业务部-大客户组', owner: 'U0012',
        base: [88, 90, 92], target: [96, 97, 98], ach: [86, 94, 100]
    },
    {
        key: 'P_PROD', parentKey: 'PROD_DEPT', perspective: 'PROCESS', name: '单位产品能耗下降', metric: '单位能耗指数',
        unit: '指数', dir: 'DOWN', weight: 100, scope: '生产部-车间', owner: 'U0008',
        base: [100, 96, 92], target: [90, 90, 88], ach: [80, 92, 101]
    }
];

// 分公司目标模板（kpi_id 挂接指标中心）
const BU_DEFS = [
    {
        perspective: 'FINANCIAL', name: '毛利率改善', metric: '销售毛利率', unit: '%',
        dir: 'UP', weight: 20, kpi_id: 'gross_profit', ach: [90, 98, 103]
    },
    {
        perspective: 'FINANCIAL', name: '股东权益报酬率提升', metric: 'ROE', unit: '%',
        dir: 'UP', weight: 15, kpi_id: 'roe', ach: [88, 97, 104]
    },
    {
        perspective: 'PROCESS', name: '应收账款回收加速', metric: '应收账款周转天数', unit: '天',
        dir: 'DOWN', weight: 20, kpi_id: 'ar_days', ach: [85, 96, 102]
    },
    {
        perspective: 'PROCESS', name: '存货周转改善', metric: '存货周转率', unit: '次',
        dir: 'UP', weight: 15, kpi_id: 'inventory_turn', ach: [87, 95, 101]
    },
    {
        perspective: 'FINANCIAL', name: '短期偿债能力维持', metric: '流动比率', unit: '倍',
        dir: 'UP', weight: 15, kpi_id: 'current_ratio', ach: [90, 99, 103]
    },
    {
        perspective: 'CUSTOMER', name: '客户满意度提升', metric: '客户满意度', unit: '分',
        dir: 'UP', weight: 15, base: [80, 86, 89], target: [90, 92, 94], ach: [83, 94, 100]
    }
];

const BU_OWNER = { HM: 'U0006', HN: 'U0030', SZ: 'U0002' };
const FALLBACK_KPI = {
    gross_profit: 30, roe: 3, ar_days: 120, inventory_turn: 1, current_ratio: 1.8
};

// 由实际 KPI 值 + 期望达成率反推基线 / 目标
function deriveFromActual(dir, actual, achievement) {
    const x = Number(actual);
    if (!Number.isFinite(x) || x === 0) return null;
    const base = dir === 'DOWN' ? x * 1.15 : x * 0.9;
    const target = base + (x - base) * (100 / achievement);
    return { base, target };
}

async function insertObjective(o) {
    const [r] = await pool.execute(
        `INSERT INTO bsc_objective
            (fiscal_year, level, bu_no, perspective, objective_name, metric_name, unit,
             metric_direction, baseline_value, target_value, weight, kpi_id,
             scope_name, owner_id, parent_id, status, remark)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`,
        [o.fiscal_year, o.level, o.bu_no, o.perspective, o.objective_name,
         o.metric_name || null, o.unit || null, o.metric_direction,
         round4(o.baseline_value), round4(o.target_value), o.weight, o.kpi_id || null,
         o.scope_name || null, o.owner_id || null, o.parent_id || null, o.remark]);
    return r.insertId;
}

async function insertProgressBatch(rows) {
    if (!rows.length) return 0;
    const CHUNK = 200;
    let total = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
        const part = rows.slice(i, i + CHUNK);
        const placeholders = part.map(() => '(?,?,?,?,?,?)').join(',');
        const params = [];
        for (const r of part) {
            params.push(r.objective_id, r.period, r.actual_value, 'MANUAL', r.note, 'seed');
        }
        const [res] = await pool.execute(
            `INSERT INTO bsc_progress (objective_id, period, actual_value, source, note, created_by)
             VALUES ${placeholders}
             ON DUPLICATE KEY UPDATE
                actual_value=VALUES(actual_value), source=VALUES(source),
                note=VALUES(note), created_by=VALUES(created_by)`,
            params);
        total += res.affectedRows;
    }
    return total;
}

async function main() {
    const force = process.argv.includes('--force');
    const [exist] = await pool.execute(
        `SELECT COUNT(*) AS c FROM bsc_objective WHERE fiscal_year IN ('2023','2024','2025')`);
    const existing = Number(exist[0].c);
    if (existing > 0 && !force) {
        console.log(`⚠️  2023~2025 已有 ${existing} 笔目标资料，如需覆盖请执行：node scripts/seed_bsc_demo.js --force`);
        process.exit(1);
    }
    if (existing > 0) {
        await pool.execute(
            `DELETE p FROM bsc_progress p
               JOIN bsc_objective o ON o.objective_id = p.objective_id
              WHERE o.fiscal_year IN ('2023','2024','2025')`);
        await pool.execute(
            `DELETE FROM bsc_objective WHERE fiscal_year IN ('2023','2024','2025')`);
        console.log(`🧹 已清理 2023~2025 旧资料（目标 ${existing} 笔）`);
    }

    console.log('📌 开始生成 2023~2025 战略目标 / 平衡计分卡测试资料 ...');

    for (const year of YEARS) {
        const yi = YEARS.indexOf(year);
        const parentIds = new Map();   // key -> objective_id
        const pending = [];            // { objective_id, series }
        let objCount = 0;

        // ---- 集团目标 ----
        for (const d of GROUP_DEFS) {
            const base = d.base[yi];
            const target = d.target[yi];
            const final = actualFor(base, target, d.ach[yi]);
            const id = await insertObjective({
                fiscal_year: year, level: 'COMPANY', bu_no: 'GROUP', perspective: d.perspective,
                objective_name: d.name, metric_name: d.metric, unit: d.unit,
                metric_direction: d.dir, baseline_value: base, target_value: target,
                weight: d.weight, owner_id: d.owner,
                remark: `FY${year} 集团战略目标（演示数据）`
            });
            parentIds.set(d.key, id);
            pending.push({ objective_id: id, series: monthlySeries(base, final) });
            objCount++;
        }

        // ---- 部门目标 ----
        for (const d of DEPT_DEFS) {
            const base = d.base[yi];
            const target = d.target[yi];
            const final = actualFor(base, target, d.ach[yi]);
            const id = await insertObjective({
                fiscal_year: year, level: 'DEPARTMENT', bu_no: 'GROUP', perspective: d.perspective,
                objective_name: d.name, metric_name: d.metric, unit: d.unit,
                metric_direction: d.dir, baseline_value: base, target_value: target,
                weight: d.weight, scope_name: d.scope, owner_id: d.owner,
                parent_id: parentIds.get(d.parentKey) || null,
                remark: `FY${year} ${d.scope}部门目标（演示数据）`
            });
            parentIds.set(d.key, id);
            pending.push({ objective_id: id, series: monthlySeries(base, final) });
            objCount++;
        }

        // ---- 个人目标 ----
        for (const d of PERSONAL_DEFS) {
            const base = d.base[yi];
            const target = d.target[yi];
            const final = actualFor(base, target, d.ach[yi]);
            const id = await insertObjective({
                fiscal_year: year, level: 'PERSONAL', bu_no: 'GROUP', perspective: d.perspective,
                objective_name: d.name, metric_name: d.metric, unit: d.unit,
                metric_direction: d.dir, baseline_value: base, target_value: target,
                weight: d.weight, scope_name: d.scope, owner_id: d.owner,
                parent_id: parentIds.get(d.parentKey) || null,
                remark: `FY${year} 个人目标（演示数据）`
            });
            pending.push({ objective_id: id, series: monthlySeries(base, final) });
            objCount++;
        }

        // ---- 分公司目标（挂接真实 KPI） ----
        for (const bu of BUS) {
            const kpis = await computeKpis(bu, `${year}-12`);
            const jitter = BU_JITTER[bu] || 0;
            for (const d of BU_DEFS) {
                let base, target;
                if (d.kpi_id) {
                    const raw = kpis && kpis[d.kpi_id] ? kpis[d.kpi_id].value : null;
                    const x = (raw === null || raw === undefined) ? FALLBACK_KPI[d.kpi_id] : Number(raw);
                    const ach = Math.max(40, Math.min(118, d.ach[yi] + jitter));
                    const derived = deriveFromActual(d.dir, x, ach);
                    if (!derived) continue;
                    base = derived.base;
                    target = derived.target;
                } else {
                    base = d.base[yi];
                    target = d.target[yi];
                }
                const final = d.kpi_id
                    ? (Number((kpis && kpis[d.kpi_id] && kpis[d.kpi_id].value) || FALLBACK_KPI[d.kpi_id]))
                    : actualFor(base, target, d.ach[yi] + jitter);
                const id = await insertObjective({
                    fiscal_year: year, level: 'COMPANY', bu_no: bu, perspective: d.perspective,
                    objective_name: `${bu} ${d.name}`, metric_name: d.metric, unit: d.unit,
                    metric_direction: d.dir, baseline_value: base, target_value: target,
                    weight: d.weight, kpi_id: d.kpi_id || null, owner_id: BU_OWNER[bu],
                    remark: `FY${year} ${bu} 分公司目标（演示数据）`
                });
                pending.push({ objective_id: id, series: monthlySeries(base, final) });
                objCount++;
            }
        }

        // ---- 月度进度 ----
        const progressRows = [];
        for (const p of pending) {
            for (let m = 0; m < 12; m++) {
                progressRows.push({
                    objective_id: p.objective_id,
                    period: `${year}-${pad2(m + 1)}`,
                    actual_value: p.series[m],
                    note: `FY${year} 演示数据（脚本生成）`
                });
            }
        }
        const written = await insertProgressBatch(progressRows);
        console.log(`✅ ${year}：目标 ${objCount} 笔，月度进度 ${written} 笔`);
    }

    // ---- 结果核对 ----
    const [chk] = await pool.execute(
        `SELECT o.fiscal_year, o.level, COUNT(DISTINCT o.objective_id) AS objs,
                COUNT(p.uid) AS progress
           FROM bsc_objective o
           LEFT JOIN bsc_progress p ON p.objective_id = o.objective_id
          WHERE o.fiscal_year IN ('2023','2024','2025')
          GROUP BY o.fiscal_year, o.level
          ORDER BY o.fiscal_year, o.level`);
    console.log('\n=== 写入结果 ===');
    for (const r of chk) {
        console.log(`${r.fiscal_year} ${r.level.padEnd(10)} 目标 ${r.objs} 笔，进度 ${r.progress} 笔`);
    }
    console.log('\n🎉 2023~2025 战略目标 / 平衡计分卡测试资料生成完成');
    process.exit(0);
}

main().catch((e) => { console.error('❌ 生成失败:', e); process.exit(1); });
