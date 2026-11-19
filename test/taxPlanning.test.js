/**
 * CFO-07 税务筹划与税务风险 单元测试
 *
 * 覆盖：
 *  1. judgePolicies        优惠自动判定与节税测算
 *  2. buildPolicyRows      自动判定 + 人工登记合并
 *  3. buildRisks           6 类税务风险规则与去重键
 *  4. loadTaxFacts         申报数据去重、税负指标与月度趋势
 *  5. scanBuTax            预警写库、24h 去重、异常处理
 *  6. scanAllTax           三家公司循环
 *
 * 采用 mock pool，不依赖真实数据库与启动服务。
 */
jest.mock('../config/db', () => ({ pool: { execute: jest.fn() } }));

const { pool } = require('../config/db');
const {
    POLICY_CATALOG,
    judgePolicies,
    buildPolicyRows,
    buildRisks,
    loadTaxFacts,
    scanBuTax,
    scanAllTax,
    latestYear
} = require('../services/taxRiskScanner');

// ============ 测试数据工厂 ============

function vatRow(over = {}) {
    return {
        tax_period: '202501',
        taxpayer_type: 1,
        total_sales_amt: 10000,
        total_output_tax: 1300,
        total_input_tax: 900,
        tax_payable: 400,
        prev_period_credit: 0,
        urban_maintenance: 28,
        education_surcharge: 12,
        local_education_surcharge: 8,
        status: 'SUBMITTED',
        create_time: '2025-02-01 10:00:00',
        ...over
    };
}

/** 基准事实：各项规则均不触发 */
function baseFacts(over = {}) {
    return {
        bu_no: 'HM',
        YYYY: '2025',
        finance: { revenue: 10000, pretax_profit: 1000 },
        cit: { tax_payable: 200, taxable_income: 1000, total_revenue: 10000 },
        vat: [vatRow()],
        monthly: [{ month: '2025-01', sales_amt: 10000, vat_sales: 10000, vat_payable: 400, surcharges: 48, total_tax: 448, burden: 4.48 }],
        totals: {
            revenue: 10000,
            vat_sales: 10000,
            vat_payable: 400,
            surcharges: 48,
            cit_payable: 200,
            cit_taxable_income: 1000,
            total_tax: 648,
            vat_burden: 4,
            cit_burden: 2,
            composite_burden: 6.48
        },
        ...over
    };
}

function mockPool({ vat = [], cit = [], finance = [{ revenue: 0, pretax_profit: 0 }], monthly = [], prefs = [], dup = [], insertId = 1 } = {}) {
    pool.execute.mockImplementation(async (sql) => {
        if (sql.includes('MAX(YYYY)')) return [[{ y: '2025' }]];
        if (sql.includes('FROM vat_declarations')) return [vat];
        if (sql.includes('FROM cit_annual_settlements')) return [cit];
        if (sql.includes('FROM mgm_finance_summary') && sql.includes('GROUP BY')) return [monthly];
        if (sql.includes('FROM mgm_finance_summary')) return [finance];
        if (sql.includes('FROM tax_preference')) return [prefs];
        if (sql.includes('SELECT uid FROM alert_log')) return [dup];
        if (sql.includes('INSERT INTO alert_log')) return [{ insertId }];
        return [[]];
    });
}

beforeEach(() => {
    jest.clearAllMocks();
});

// ============ 1. judgePolicies ============

describe('judgePolicies 优惠自动判定', () => {
    test('小型微利企业：应纳税所得额 100 万 → 适用，节税 20 万', () => {
        const facts = baseFacts({
            cit: { taxable_income: 1000000, tax_payable: 50000 }
        });
        const r = judgePolicies(facts);
        expect(r.SMALL_LOW_PROFIT.applicable).toBe(true);
        expect(r.SMALL_LOW_PROFIT.benefit).toBe(200000);
    });

    test('应纳税所得额超过 300 万 → 不适用且无节税', () => {
        const facts = baseFacts({
            cit: { taxable_income: 5000000, tax_payable: 1250000 }
        });
        const r = judgePolicies(facts);
        expect(r.SMALL_LOW_PROFIT.applicable).toBe(false);
        expect(r.SMALL_LOW_PROFIT.benefit).toBe(0);
    });

    test('高新与研发加计无法自动判定 → applicable 为 null', () => {
        const r = judgePolicies(baseFacts());
        expect(r.HIGH_TECH.applicable).toBeNull();
        expect(r.RND_SUPER_DEDUCT.applicable).toBeNull();
    });

    test('小规模月销售额≤10 万 → 增值税免征，节税按 3% 估算', () => {
        const facts = baseFacts({
            vat: [vatRow({ taxpayer_type: 2, total_sales_amt: 50000, tax_payable: 0 })]
        });
        const r = judgePolicies(facts);
        expect(r.VAT_SMALL_EXEMPT.applicable).toBe(true);
        expect(r.VAT_SMALL_EXEMPT.benefit).toBe(1500);
    });

    test('小规模月销售额超过 10 万 → 不适用免征', () => {
        const facts = baseFacts({
            vat: [vatRow({ taxpayer_type: 2, total_sales_amt: 150000, tax_payable: 4500 })]
        });
        expect(judgePolicies(facts).VAT_SMALL_EXEMPT.applicable).toBe(false);
    });

    test('六税两费减半：适用小型微利时按附加税 50% 估算', () => {
        const facts = baseFacts({
            cit: { taxable_income: 1000000, tax_payable: 50000 },
            totals: { ...baseFacts().totals, surcharges: 1000 }
        });
        const r = judgePolicies(facts);
        expect(r.SIX_TAX_HALF.applicable).toBe(true);
        expect(r.SIX_TAX_HALF.benefit).toBe(500);
    });
});

// ============ 2. buildPolicyRows ============

describe('buildPolicyRows 优惠清单合并', () => {
    test('无人工登记 → 输出 5 条目录政策，来源 AUTO', () => {
        const rows = buildPolicyRows(baseFacts(), []);
        expect(rows).toHaveLength(POLICY_CATALOG.length);
        expect(rows.every(r => r.source === 'AUTO')).toBe(true);
        expect(rows.every(r => r.uid === null)).toBe(true);
        const small = rows.find(r => r.policy_code === 'SMALL_LOW_PROFIT');
        expect(small.applicable).toBe(small.auto_applicable);
        expect(small.est_benefit).toBe(200); // 1000 * 20%
    });

    test('人工登记适用 → 以人工为准，来源 MANUAL', () => {
        const overrides = [{
            uid: 7, policy_code: 'HIGH_TECH', applicable: 1,
            est_benefit: 12345.67, status: 1, note: '已取得高新证书'
        }];
        const row = buildPolicyRows(baseFacts(), overrides).find(r => r.policy_code === 'HIGH_TECH');
        expect(row.source).toBe('MANUAL');
        expect(row.applicable).toBe(true);
        expect(row.est_benefit).toBe(12345.67);
        expect(row.uid).toBe(7);
        expect(row.note).toBe('已取得高新证书');
    });

    test('人工登记 applicable=null → 仍按自动判定', () => {
        const overrides = [{
            uid: 8, policy_code: 'SMALL_LOW_PROFIT', applicable: null,
            est_benefit: 0, status: 1, note: null
        }];
        const row = buildPolicyRows(baseFacts(), overrides).find(r => r.policy_code === 'SMALL_LOW_PROFIT');
        expect(row.source).toBe('AUTO');
        expect(row.applicable).toBe(true);
        expect(row.est_benefit).toBe(200);
    });

    test('人工登记不适用并停用 → 保留结论与状态', () => {
        const overrides = [{
            uid: 9, policy_code: 'VAT_SMALL_EXEMPT', applicable: 0,
            est_benefit: 0, status: 0, note: '已转为一般纳税人'
        }];
        const row = buildPolicyRows(baseFacts(), overrides).find(r => r.policy_code === 'VAT_SMALL_EXEMPT');
        expect(row.applicable).toBe(false);
        expect(row.status).toBe(0);
    });

    test('未知政策的登记记录被忽略，不影响 5 条目录', () => {
        const rows = buildPolicyRows(baseFacts(), [{
            uid: 10, policy_code: 'UNKNOWN', applicable: 1, est_benefit: 1, status: 1, note: null
        }]);
        expect(rows).toHaveLength(POLICY_CATALOG.length);
    });
});

// ============ 3. buildRisks ============

describe('buildRisks 税务风险规则', () => {
    test('基准数据无风险', () => {
        expect(buildRisks(baseFacts())).toEqual([]);
    });

    test('增值税负率低于 3% → TAX_VAT_BURDEN_LOW', () => {
        const facts = baseFacts({ totals: { ...baseFacts().totals, vat_burden: 2 } });
        const r = buildRisks(facts);
        expect(r.map(x => x.code)).toContain('TAX_VAT_BURDEN_LOW');
        const item = r.find(x => x.code === 'TAX_VAT_BURDEN_LOW');
        expect(item.level).toBe('warning');
        expect(item.threshold).toBe(3);
        expect(item.dedup_key).toBe('TAX|TAX_VAT_BURDEN_LOW|HM|2025');
    });

    test('连续 3 期应纳税额≤0 → TAX_VAT_CREDIT_LONG', () => {
        const vat = ['202503', '202504', '202505'].map(p => vatRow({
            tax_period: p, tax_payable: 0, urban_maintenance: 0,
            education_surcharge: 0, local_education_surcharge: 0
        }));
        const facts = baseFacts({ vat, totals: { ...baseFacts().totals, vat_burden: 5 } });
        expect(buildRisks(facts).map(x => x.code)).toContain('TAX_VAT_CREDIT_LONG');
    });

    test('仅 2 期留抵 → 不触发长期留抵', () => {
        const vat = ['202504', '202505'].map(p => vatRow({
            tax_period: p, tax_payable: 0, urban_maintenance: 0,
            education_surcharge: 0, local_education_surcharge: 0
        }));
        const facts = baseFacts({ vat, totals: { ...baseFacts().totals, vat_burden: 5 } });
        expect(buildRisks(facts).map(x => x.code)).not.toContain('TAX_VAT_CREDIT_LONG');
    });

    test('申报销售额与财务收入差异超过 10% → TAX_REV_MISMATCH', () => {
        const facts = baseFacts({ totals: { ...baseFacts().totals, vat_sales: 20000, revenue: 10000 } });
        const item = buildRisks(facts).find(x => x.code === 'TAX_REV_MISMATCH');
        expect(item).toBeDefined();
        expect(item.current_value).toBe(100);
    });

    test('差异未超过 10% → 不触发收入差异', () => {
        const facts = baseFacts({ totals: { ...baseFacts().totals, vat_sales: 10800, revenue: 10000 } });
        expect(buildRisks(facts).map(x => x.code)).not.toContain('TAX_REV_MISMATCH');
    });

    test('企业所得税负率低于 1% → TAX_CIT_BURDEN_LOW', () => {
        const facts = baseFacts({ totals: { ...baseFacts().totals, cit_burden: 0.5 } });
        expect(buildRisks(facts).map(x => x.code)).toContain('TAX_CIT_BURDEN_LOW');
    });

    test('有销售收入但缺申报 → TAX_MISSING_DECLARATION，达 3 个月为 danger', () => {
        const facts = baseFacts({
            vat: [],
            monthly: [
                { month: '2025-01', sales_amt: 1000 },
                { month: '2025-02', sales_amt: 1000 },
                { month: '2025-03', sales_amt: 1000 }
            ],
            totals: { ...baseFacts().totals, vat_payable: 0, vat_sales: 0 }
        });
        const item = buildRisks(facts).find(x => x.code === 'TAX_MISSING_DECLARATION');
        expect(item).toBeDefined();
        expect(item.level).toBe('danger');
        expect(item.current_value).toBe(3);
    });

    test('附加税与应纳增值税不匹配 → TAX_SURCHARGE_MISMATCH', () => {
        const facts = baseFacts({
            vat: [vatRow({
                tax_payable: 1000, urban_maintenance: 5,
                education_surcharge: 3, local_education_surcharge: 2
            })],
            totals: { ...baseFacts().totals, vat_burden: 10 }
        });
        expect(buildRisks(facts).map(x => x.code)).toContain('TAX_SURCHARGE_MISMATCH');
    });

    test('附加税在 6%~12% 合理区间 → 不触发', () => {
        const facts = baseFacts({
            vat: [vatRow({
                tax_payable: 1000, urban_maintenance: 60,
                education_surcharge: 30, local_education_surcharge: 20
            })],
            totals: { ...baseFacts().totals, vat_burden: 10 }
        });
        expect(buildRisks(facts).map(x => x.code)).not.toContain('TAX_SURCHARGE_MISMATCH');
    });
});

// ============ 4. loadTaxFacts ============

describe('loadTaxFacts 税负汇总', () => {
    test('同一所属期取最新申报，并计算税负与月度趋势', async () => {
        mockPool({
            vat: [
                vatRow({ create_time: '2025-02-01 10:00:00', tax_payable: 999 }),
                vatRow({ create_time: '2025-03-01 10:00:00', tax_payable: 400 }),
                vatRow({
                    tax_period: '202502', tax_payable: 100, total_sales_amt: 5000,
                    urban_maintenance: 7, education_surcharge: 3, local_education_surcharge: 2,
                    create_time: '2025-03-05 10:00:00'
                })
            ],
            cit: [{ tax_payable: 1000, taxable_income: 4000000, total_revenue: 20000 }],
            finance: [{ revenue: 20000, pretax_profit: 2000 }],
            monthly: [
                { YYYY_MM: '2025/01', revenue: 12000 },
                { YYYY_MM: '2025-02', revenue: 8000 }
            ]
        });

        const f = await loadTaxFacts('HM', '2025');

        expect(f.vat).toHaveLength(2);
        expect(f.vat.every(v => Number(v.tax_payable) !== 999)).toBe(true);
        expect(f.totals.revenue).toBe(20000);
        expect(f.totals.vat_payable).toBe(500);
        expect(f.totals.surcharges).toBe(60);
        expect(f.totals.cit_payable).toBe(1000);
        expect(f.totals.total_tax).toBe(1560);
        expect(f.totals.vat_burden).toBe(2.5);
        expect(f.totals.cit_burden).toBe(5);
        expect(f.totals.composite_burden).toBe(7.8);

        expect(f.monthly).toHaveLength(2);
        const jan = f.monthly.find(m => m.month === '2025-01');
        expect(jan.sales_amt).toBe(12000);
        expect(jan.vat_payable).toBe(400);
        expect(jan.surcharges).toBe(48);
        expect(jan.total_tax).toBe(448);
        expect(jan.burden).toBe(3.73);

        const feb = f.monthly.find(m => m.month === '2025-02');
        expect(feb.sales_amt).toBe(8000);
        expect(feb.vat_payable).toBe(100);
        expect(feb.total_tax).toBe(112);
        expect(feb.burden).toBe(1.4);
    });

    test('财务无收入时以申报销售额为税负分母', async () => {
        mockPool({
            vat: [vatRow({ total_sales_amt: 10000, tax_payable: 400 })],
            finance: [{ revenue: 0, pretax_profit: 0 }],
            monthly: []
        });
        const f = await loadTaxFacts('HM', '2025');
        expect(f.totals.revenue).toBe(0);
        expect(f.totals.vat_burden).toBe(4);
        expect(f.totals.composite_burden).toBe(0);
    });
});

// ============ 5. latestYear ============

describe('latestYear 年度推断', () => {
    test('取财务汇总最大年份', async () => {
        mockPool();
        pool.execute.mockResolvedValueOnce([[{ y: '2024' }]]);
        await expect(latestYear('HM')).resolves.toBe('2024');
    });

    test('无数据时回退当前年度', async () => {
        pool.execute.mockResolvedValueOnce([[{ y: null }]]);
        const y = await latestYear('HM');
        expect(y).toMatch(/^\d{4}$/);
        expect(y).toBe(String(new Date().getFullYear()));
    });
});

// ============ 6. scanBuTax / scanAllTax ============

describe('scanBuTax 预警写库', () => {
    const riskVat = [vatRow({
        tax_payable: 1000, urban_maintenance: 5,
        education_surcharge: 3, local_education_surcharge: 2
    })];

    test('命中风险时写入 alert_log，dedup_key 正确', async () => {
        mockPool({
            vat: riskVat,
            finance: [{ revenue: 10000, pretax_profit: 1000 }],
            monthly: [{ YYYY_MM: '2025/01', revenue: 10000 }],
            insertId: 321
        });

        const r = await scanBuTax('HM', { YYYY: '2025' });

        expect(r.scanned).toBe(1);
        expect(r.created).toHaveLength(1);
        expect(r.created[0].uid).toBe(321);
        expect(r.suppressed).toBe(0);
        expect(r.errors).toEqual([]);

        const insertCall = pool.execute.mock.calls.find(c => String(c[0]).includes('INSERT INTO alert_log'));
        expect(insertCall).toBeDefined();
        expect(insertCall[1]).toContain('TAX|TAX_SURCHARGE_MISMATCH|HM|2025');
        expect(String(insertCall[0])).toContain('FINANCE');
    });

    test('24h 内同键已存在 → 跳过写库', async () => {
        mockPool({
            vat: riskVat,
            finance: [{ revenue: 10000, pretax_profit: 1000 }],
            monthly: [{ YYYY_MM: '2025/01', revenue: 10000 }],
            dup: [{ uid: 1 }]
        });

        const r = await scanBuTax('HM', { YYYY: '2025' });

        expect(r.scanned).toBe(1);
        expect(r.created).toHaveLength(0);
        expect(r.suppressed).toBe(1);
        expect(pool.execute.mock.calls.some(c => String(c[0]).includes('INSERT INTO alert_log'))).toBe(false);
    });

    test('查询异常时记录 errors，不抛出', async () => {
        pool.execute.mockRejectedValueOnce(new Error('db down'));
        const r = await scanBuTax('HM', { YYYY: '2025' });
        expect(r.scanned).toBe(0);
        expect(r.created).toEqual([]);
        expect(r.errors).toEqual(['db down']);
    });
});

describe('scanAllTax 多公司扫描', () => {
    test('依次扫描 HM/HN/SZ', async () => {
        mockPool({ vat: [], finance: [{ revenue: 0, pretax_profit: 0 }], monthly: [] });
        const r = await scanAllTax();
        expect(r.bus.map(b => b.bu_no)).toEqual(['HM', 'HN', 'SZ']);
        expect(r.total_created).toBe(0);
    });
});
