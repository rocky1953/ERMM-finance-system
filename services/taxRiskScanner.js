/**
 * 税务筹划与税务风险扫描（CFO-07）
 *
 * 数据来源：
 * 1. 增值税申报：vat_declarations（按税款所属期取最新一笔）
 * 2. 企业所得税汇算：cit_annual_settlements（按年度取最新一笔）
 * 3. 财务收入：mgm_finance_summary（销货收入 sale_amt）
 *
 * 风险规则：
 *   TAX_VAT_BURDEN_LOW     增值税负率低于 3%
 *   TAX_VAT_CREDIT_LONG    连续 3 个月应纳税额≤0（长期留抵）
 *   TAX_REV_MISMATCH       申报销售额与财务收入差异超过 10%
 *   TAX_CIT_BURDEN_LOW     企业所得税负率低于 1%
 *   TAX_MISSING_DECLARATION 有销售收入但缺少增值税申报
 *   TAX_SURCHARGE_MISMATCH 附加税与应纳增值税不匹配
 *
 * 预警写入 alert_log，dedup_key = TAX|规则|公司|年度，24 小时内同键去重。
 */
const { pool } = require('../config/db');

const BUS = ['HM', 'HN', 'SZ'];

const n = (v) => Number(v || 0);
const r2 = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.round((x + Number.EPSILON) * 100) / 100 : 0;
};
const pct = (part, base) => (base > 0 ? r2((Number(part) * 100) / Number(base)) : 0);

// 优惠政策目录（未登记时按自动判定结果展示）
const POLICY_CATALOG = [
    {
        policy_code: 'SMALL_LOW_PROFIT',
        policy_name: '小型微利企业所得税优惠',
        category: 'CIT',
        policy_desc: '年应纳税所得额不超过 300 万元，减按 25% 计入应纳税所得额、按 20% 税率缴纳（实际税负 5%）'
    },
    {
        policy_code: 'HIGH_TECH',
        policy_name: '高新技术企业 15% 优惠税率',
        category: 'CIT',
        policy_desc: '经认定的高新技术企业，企业所得税减按 15% 征收'
    },
    {
        policy_code: 'RND_SUPER_DEDUCT',
        policy_name: '研发费用加计扣除 100%',
        category: 'CIT',
        policy_desc: '符合条件的研发费用未形成无形资产的，按实际发生额 100% 加计扣除'
    },
    {
        policy_code: 'VAT_SMALL_EXEMPT',
        policy_name: '小规模纳税人月销售额 10 万元以下免征增值税',
        category: 'VAT',
        policy_desc: '小规模纳税人月销售额不超过 10 万元（季度 30 万元）免征增值税'
    },
    {
        policy_code: 'SIX_TAX_HALF',
        policy_name: '六税两费减半征收',
        category: 'SURCHARGE',
        policy_desc: '增值税小规模纳税人、小型微利企业减半征收城建税、教育费附加、地方教育附加'
    }
];

const RISK_SUGGESTIONS = {
    TAX_VAT_BURDEN_LOW: '复核销项与进项匹配、是否存在未开票收入或进项长期留抵，评估税负异常原因。',
    TAX_VAT_CREDIT_LONG: '评估留抵形成原因，符合条件的可申请留抵退税，或检视进项发票与销售确认节奏。',
    TAX_REV_MISMATCH: '核对未开票收入、视同销售、跨期确认及发票作废红冲，确保申报口径一致。',
    TAX_CIT_BURDEN_LOW: '检视成本费用列支凭证与纳税调整项，确认所得税优惠适用是否准确。',
    TAX_MISSING_DECLARATION: '补申报或确认申报归属，避免逾期申报滞纳金与罚款。',
    TAX_SURCHARGE_MISMATCH: '核对城建税 7%、教育费附加 3%、地方教育附加 2% 的计提与减免政策。'
};

function normalizeMonth(v) {
    const s = String(v || '').replace('/', '-');
    return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : null;
}

async function latestYear(bu_no) {
    const [rows] = await pool.execute(
        'SELECT MAX(YYYY) AS y FROM mgm_finance_summary WHERE bu_no=?', [bu_no]);
    const y = rows[0]?.y ? String(rows[0].y).slice(0, 4) : '';
    return /^\d{4}$/.test(y) ? y : String(new Date().getFullYear());
}

// 同一税款所属期可能有多笔草稿，取最新一笔
function pickLatestByPeriod(rows) {
    const map = new Map();
    for (const row of rows) {
        const key = String(row.tax_period || '');
        const prev = map.get(key);
        if (!prev || new Date(row.create_time) >= new Date(prev.create_time)) map.set(key, row);
    }
    return [...map.values()].sort((a, b) => String(a.tax_period).localeCompare(String(b.tax_period)));
}

async function loadVatDeclarations(bu_no, YYYY) {
    const [rows] = await pool.execute(
        `SELECT * FROM vat_declarations
          WHERE bu_no=? AND tax_period LIKE ?
          ORDER BY tax_period, create_time DESC`,
        [bu_no, `${YYYY}%`]);
    return pickLatestByPeriod(rows);
}

async function loadCitSettlement(bu_no, YYYY) {
    const [rows] = await pool.execute(
        `SELECT * FROM cit_annual_settlements
          WHERE bu_no=? AND tax_year=?
          ORDER BY create_time DESC LIMIT 1`,
        [bu_no, YYYY]);
    return rows[0] || null;
}

async function loadFinanceYear(bu_no, YYYY) {
    const [rows] = await pool.execute(
        `SELECT COALESCE(SUM(sale_amt),0) AS revenue,
                COALESCE(SUM(pretax_profit_amt),0) AS pretax_profit
           FROM mgm_finance_summary WHERE bu_no=? AND YYYY=?`,
        [bu_no, YYYY]);
    return {
        revenue: r2(rows[0]?.revenue),
        pretax_profit: r2(rows[0]?.pretax_profit)
    };
}

async function loadFinanceMonthly(bu_no, YYYY) {
    const [rows] = await pool.execute(
        `SELECT YYYY_MM, COALESCE(SUM(sale_amt),0) AS revenue
           FROM mgm_finance_summary WHERE bu_no=? AND YYYY=?
          GROUP BY YYYY_MM ORDER BY YYYY_MM`,
        [bu_no, YYYY]);
    return rows
        .map(r => ({ month: normalizeMonth(r.YYYY_MM), revenue: r2(r.revenue) }))
        .filter(r => r.month);
}

function surchargeOf(v) {
    return r2(n(v.urban_maintenance) + n(v.education_surcharge) + n(v.local_education_surcharge));
}

/**
 * 汇总某公司某年度的税务事实与税负指标
 */
async function loadTaxFacts(bu_no, YYYY) {
    const bu = String(bu_no || 'HM').toUpperCase();
    const year = /^\d{4}$/.test(String(YYYY || '')) ? String(YYYY) : await latestYear(bu);

    const [vat, cit, finance, financeMonthly] = await Promise.all([
        loadVatDeclarations(bu, year),
        loadCitSettlement(bu, year),
        loadFinanceYear(bu, year),
        loadFinanceMonthly(bu, year)
    ]);

    const vatPayable = r2(vat.reduce((s, v) => s + n(v.tax_payable), 0));
    const surcharges = r2(vat.reduce((s, v) => s + surchargeOf(v), 0));
    const vatSales = r2(vat.reduce((s, v) => s + n(v.total_sales_amt), 0));
    const citPayable = r2(cit ? n(cit.tax_payable) : 0);
    const citTaxable = r2(cit ? n(cit.taxable_income) : 0);
    const revenue = r2(finance.revenue || (cit ? n(cit.total_revenue) : 0));
    const totalTax = r2(vatPayable + surcharges + citPayable);

    // 月度趋势：合并财务收入与增值税申报
    const monthMap = new Map();
    const ensure = (month) => {
        if (!monthMap.has(month)) {
            monthMap.set(month, {
                month, sales_amt: 0, vat_sales: 0, vat_payable: 0,
                surcharges: 0, total_tax: 0, burden: 0
            });
        }
        return monthMap.get(month);
    };
    for (const f of financeMonthly) {
        ensure(f.month).sales_amt = f.revenue;
    }
    for (const v of vat) {
        const month = `${year}-${String(v.tax_period).slice(4, 6)}`;
        const row = ensure(month);
        row.vat_sales = r2(row.vat_sales + n(v.total_sales_amt));
        row.vat_payable = r2(row.vat_payable + n(v.tax_payable));
        row.surcharges = r2(row.surcharges + surchargeOf(v));
        if (!row.sales_amt) row.sales_amt = r2(n(v.total_sales_amt));
    }
    const monthly = [...monthMap.values()]
        .sort((a, b) => a.month.localeCompare(b.month))
        .map(r => {
            r.total_tax = r2(r.vat_payable + r.surcharges);
            r.burden = pct(r.total_tax, r.sales_amt || r.vat_sales);
            return r;
        });

    return {
        bu_no: bu,
        YYYY: year,
        finance,
        cit,
        vat,
        monthly,
        totals: {
            revenue,
            vat_sales: vatSales,
            vat_payable: vatPayable,
            surcharges,
            cit_payable: citPayable,
            cit_taxable_income: citTaxable,
            total_tax: totalTax,
            vat_burden: pct(vatPayable, revenue || vatSales),
            cit_burden: pct(citPayable, revenue),
            composite_burden: pct(totalTax, revenue)
        }
    };
}

/**
 * 按财务事实自动判定优惠适用与预计节税
 */
function judgePolicies(facts) {
    const taxable = n(facts.cit?.taxable_income);
    const smallLowProfit = taxable > 0 && taxable <= 3000000;
    const smallBenefit = smallLowProfit ? r2(taxable * 0.20) : 0;

    const vatSmallRows = facts.vat.filter(v =>
        Number(v.taxpayer_type) === 2
        && n(v.total_sales_amt) > 0
        && n(v.total_sales_amt) <= 100000);
    const vatExemptApplicable = vatSmallRows.length > 0;
    const vatExemptBenefit = r2(
        vatSmallRows.reduce((s, v) => s + n(v.total_sales_amt), 0) * 0.03);

    const sixApplicable = smallLowProfit;
    const sixBenefit = sixApplicable ? r2(n(facts.totals.surcharges) * 0.5) : 0;

    return {
        SMALL_LOW_PROFIT: { applicable: smallLowProfit, benefit: smallBenefit },
        HIGH_TECH: { applicable: null, benefit: 0 },
        RND_SUPER_DEDUCT: { applicable: null, benefit: 0 },
        VAT_SMALL_EXEMPT: { applicable: vatExemptApplicable, benefit: vatExemptBenefit },
        SIX_TAX_HALF: { applicable: sixApplicable, benefit: sixBenefit }
    };
}

/**
 * 合并「目录默认 + 人工登记」后的优惠清单
 * 人工登记的 applicable 非 NULL 时以人工为准；否则沿用自动判定。
 */
function buildPolicyRows(facts, overrides = []) {
    const auto = judgePolicies(facts);
    const map = new Map(overrides.map(r => [r.policy_code, r]));
    return POLICY_CATALOG.map(p => {
        const a = auto[p.policy_code] || { applicable: null, benefit: 0 };
        const o = map.get(p.policy_code);
        const manual = o && o.applicable !== null && o.applicable !== undefined;
        const applicable = manual ? Number(o.applicable) === 1 : a.applicable;
        return {
            ...p,
            uid: o ? o.uid : null,
            auto_applicable: a.applicable,
            applicable,
            source: manual ? 'MANUAL' : 'AUTO',
            est_benefit: manual ? r2(o.est_benefit) : r2(a.benefit),
            status: o ? Number(o.status) : 1,
            note: o ? o.note : null
        };
    });
}

/**
 * 生成税务风险项（不写库）
 */
function buildRisks(facts) {
    const risks = [];
    const t = facts.totals;
    const push = (code, level, current_value, threshold, message, kpi_name) => {
        risks.push({
            code,
            kpi_id: code,
            kpi_name: kpi_name || code,
            level,
            current_value,
            threshold,
            message,
            suggestion: RISK_SUGGESTIONS[code] || '请复核税务申报数据与优惠政策适用情况。',
            dedup_key: `TAX|${code}|${facts.bu_no}|${facts.YYYY}`
        });
    };

    // 1. 增值税负率偏低
    if (facts.vat.length && t.revenue > 0 && t.vat_burden < 3) {
        push('TAX_VAT_BURDEN_LOW', 'warning', t.vat_burden, 3,
            `增值税负率 ${t.vat_burden}% 低于参考下限 3%（销售额 ${r2(t.revenue)}，应纳增值税 ${t.vat_payable}）`,
            '增值税负率');
    }

    // 2. 长期留抵（最近连续 3 期应纳税额≤0 且有留抵）
    const recent = facts.vat.slice(-3);
    if (recent.length === 3) {
        const allCredit = recent.every(v => n(v.tax_payable) <= 0);
        if (allCredit) {
            push('TAX_VAT_CREDIT_LONG', 'warning', recent.length, 3,
                `连续 ${recent.length} 期增值税应纳税额≤0，存在长期留抵（${recent.map(v => v.tax_period).join('、')}）`,
                '增值税留抵');
        }
    }

    // 3. 申报销售额与财务收入差异
    if (t.revenue > 0 && facts.vat.length) {
        const diff = Math.abs(t.vat_sales - t.revenue);
        const diffPct = pct(diff, t.revenue);
        if (diffPct > 10) {
            push('TAX_REV_MISMATCH', 'warning', diffPct, 10,
                `增值税申报销售额 ${t.vat_sales} 与财务收入 ${t.revenue} 差异 ${diffPct}%，超过 10%`,
                '申报销售额差异');
        }
    }

    // 4. 企业所得税负率偏低
    if (facts.cit && t.revenue > 0 && t.cit_burden < 1) {
        push('TAX_CIT_BURDEN_LOW', 'warning', t.cit_burden, 1,
            `企业所得税负率 ${t.cit_burden}% 低于 1%（应纳税所得额 ${t.cit_taxable_income}，应纳所得税 ${t.cit_payable}）`,
            '企业所得税负率');
    }

    // 5. 有收入但缺少增值税申报
    const declared = new Set(facts.vat.map(v => String(v.tax_period)));
    const missing = facts.monthly
        .filter(m => n(m.sales_amt) > 0 && !declared.has(`${facts.YYYY}${m.month.slice(5, 7)}`))
        .map(m => m.month);
    if (missing.length) {
        push('TAX_MISSING_DECLARATION', missing.length >= 3 ? 'danger' : 'warning', missing.length, 1,
            `以下月份有销售收入但缺少增值税申报：${missing.join('、')}`,
            '增值税申报完整性');
    }

    // 6. 附加税与应纳增值税不匹配（正常区间 6%~12%，六税两费减半后为 6%）
    for (const v of facts.vat) {
        const payable = n(v.tax_payable);
        if (payable <= 0) continue;
        const actual = surchargeOf(v);
        const min = r2(payable * 0.06);
        const max = r2(payable * 0.12);
        if (actual < min * 0.95 - 0.01 || actual > max * 1.05 + 0.01) {
            push('TAX_SURCHARGE_MISMATCH', 'warning', actual, r2(payable * 0.12),
                `${v.tax_period} 附加税 ${actual} 与应纳增值税 ${payable} 不匹配（合理区间 ${min}~${max}）`,
                '附加税匹配');
            break;
        }
    }

    return risks;
}

async function getOverrides(bu_no, YYYY) {
    const [rows] = await pool.execute(
        'SELECT * FROM tax_preference WHERE bu_no=? AND tax_year=? ORDER BY policy_code',
        [bu_no, YYYY]);
    return rows;
}

async function writeRiskAlerts(bu_no, YYYY, risks) {
    const result = { created: [], suppressed: 0 };
    for (const risk of risks) {
        const [dup] = await pool.execute(
            `SELECT uid FROM alert_log WHERE dedup_key=?
              AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) LIMIT 1`,
            [risk.dedup_key]);
        if (dup.length) { result.suppressed++; continue; }

        const title = `⚠️ ${bu_no} ${YYYY} ${risk.kpi_name}风险`;
        const [ins] = await pool.execute(
            `INSERT INTO alert_log
                (rule_id, bu_no, kpi_id, kpi_name, current_value, threshold, level,
                 title, message, suggestion, channel, alert_domain, dedup_key, notify_status)
             VALUES (NULL,?,?,?,?,?,?,?,?,?,?, 'FINANCE', ?, 'SKIPPED')`,
            [bu_no, risk.kpi_id, risk.kpi_name, n(risk.current_value), n(risk.threshold),
             risk.level, title, risk.message, risk.suggestion, 'inapp', risk.dedup_key]);
        result.created.push({ uid: ins.insertId, code: risk.code, level: risk.level, message: risk.message });
    }
    return result;
}

async function scanBuTax(bu_no, { YYYY } = {}) {
    const bu = String(bu_no || 'HM').toUpperCase();
    const result = {
        bu_no: bu, YYYY: null, scanned: 0, created: [], suppressed: 0, risks: [], errors: []
    };
    try {
        const facts = await loadTaxFacts(bu, YYYY);
        result.YYYY = facts.YYYY;
        const risks = buildRisks(facts);
        result.risks = risks;
        result.scanned = risks.length;
        const w = await writeRiskAlerts(bu, facts.YYYY, risks);
        result.created = w.created;
        result.suppressed = w.suppressed;
    } catch (e) {
        result.errors.push(e.message);
    }
    return result;
}

async function scanAllTax({ YYYY } = {}) {
    const bus = [];
    for (const bu of BUS) bus.push(await scanBuTax(bu, { YYYY }));
    return { bus, total_created: bus.reduce((s, b) => s + b.created.length, 0) };
}

module.exports = {
    POLICY_CATALOG,
    BUS,
    latestYear,
    loadTaxFacts,
    judgePolicies,
    buildPolicyRows,
    buildRisks,
    getOverrides,
    scanBuTax,
    scanAllTax
};
