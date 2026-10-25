/**
 * 電子化報稅算稅引擎 Service 層
 *
 * 模組：
 *   VAT — 增值稅及附加稅（一般納稅人 / 小規模納稅人）
 *   CIT — 企業所得稅年度匯算清繳
 *   IIT — 個人所得稅工資薪金代扣代繳
 *
 * 業務規則來源：OpenAPI 規範 x-business-rules
 *   VAT_R01  Output_Tax = SUM(Sales_Detail.sales_amt * tax_rate)
 *   VAT_R02  Tax_Payable = Total_Output - Total_Input - Previous_Credit
 *   VAT_R03  Surcharges = Tax_Payable * {0.07, 0.03, 0.02}
 *   CIT_R01  Taxable_Income = Revenue - Cost - TaxFree + AdjInc - AdjDec
 *   CIT_R02  Tax_Payable = Taxable_Income * TaxRate - Exemptions - Credits
 *   CIT_R03  RefundOrSupplement = Tax_Payable - AccumPrepaid - Withheld
 *   IIT_R01  Cumulative_Income = SUM(historical) + current_month
 *   IIT_R02  Cumulative_Deduction = 5000 * month_number + special_additional
 *   IIT_R03  Current_Tax = (Cumulative_Income - Cumulative_Deduction) * Rate - QuickDeduction - CumulativePaid
 */

const crypto = require('crypto');
const { pool } = require('../config/db');

// ============ 工具函式 ============
function uuid() {
    return crypto.randomUUID();
}
function round2(v) {
    return Math.round(Number(v || 0) * 100) / 100;
}
/**
 * 根據稅款所屬期 (YYYYMM) 算出 YYYY/MM，並給出「上一期」的 YYYYMM
 */
function parsePeriod(yyyymm) {
    const y = yyyymm.substring(0, 4);
    const m = parseInt(yyyymm.substring(4, 6), 10);
    return { year: y, month: m };
}
function prevPeriod(yyyymm) {
    const { year, month } = parsePeriod(yyyymm);
    const d = new Date(year, month - 2, 1); // month-2 因為 JS Date month 0 起
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}
/**
 * 查詢稅款所屬期的「月序」(1..12) — 年度匯算用 / IIT 累計用
 */
function monthSeq(yyyymm) {
    return parseInt(yyyymm.substring(4, 6), 10);
}

/**
 * 依申報週期展開稅款所屬期
 *   MONTHLY   → 單月
 *   QUARTERLY → 該季 3 個月（taxPeriod 需為季末月）
 * 回傳 { start, end, months[], prev }，prev 為上一申報期（季報取上季末月）
 */
function periodRange(taxPeriod, filingCycle) {
    const { year, month } = parsePeriod(taxPeriod);
    if (filingCycle !== 'QUARTERLY') {
        return {
            start: taxPeriod,
            end: taxPeriod,
            months: [taxPeriod],
            prev: prevPeriod(taxPeriod)
        };
    }
    const startMonth = Math.floor((month - 1) / 3) * 3 + 1;
    const months = [0, 1, 2].map(i =>
        `${year}${String(startMonth + i).padStart(2, '0')}`);
    return {
        start: months[0],
        end: months[2],
        months,
        prev: prevPeriod(months[0])
    };
}

// 小規模納稅人按季申報免征標準（現行政策：季度銷售額 30 萬元以下免征增值稅）
const SMALL_SCALE_QUARTER_EXEMPT = 300000;

// ============ 個人所得稅 超額累進稅率表（綜合所得年度） ============
// 年度應納稅所得額區間 → 稅率 / 速算扣除數
const IIT_TAX_BRACKETS = [
    { max: 36000,      rate: 0.03, quick: 0 },
    { max: 144000,     rate: 0.10, quick: 2520 },
    { max: 300000,     rate: 0.20, quick: 16920 },
    { max: 420000,     rate: 0.25, quick: 31920 },
    { max: 660000,     rate: 0.30, quick: 52920 },
    { max: 960000,     rate: 0.35, quick: 85920 },
    { max: Infinity,    rate: 0.45, quick: 181920 }
];
function lookupIitBracket(taxableIncome) {
    for (const b of IIT_TAX_BRACKETS) {
        if (taxableIncome <= b.max) return { rate: b.rate, quickDeduction: b.quick };
    }
    return { rate: 0.45, quickDeduction: 181920 };
}

// ============ 年終獎單獨計稅 月度稅率表 ============
// 年度應納稅所得額 ÷ 12 → 適用月度稅率與速算扣除數
const BONUS_MONTHLY_BRACKETS = [
    { max: 3000,   rate: 0.03, quick: 0 },
    { max: 12000,  rate: 0.10, quick: 210 },
    { max: 25000,  rate: 0.20, quick: 1410 },
    { max: 35000,  rate: 0.25, quick: 2660 },
    { max: 55000,  rate: 0.30, quick: 4410 },
    { max: 80000,  rate: 0.35, quick: 7160 },
    { max: Infinity, rate: 0.45, quick: 15160 }
];
function lookupBonusBracket(monthlyIncome) {
    for (const b of BONUS_MONTHLY_BRACKETS) {
        if (monthlyIncome <= b.max) return { rate: b.rate, quickDeduction: b.quick };
    }
    return { rate: 0.45, quickDeduction: 15160 };
}

// =====================================================================
// 模組一：VAT 增值稅
// =====================================================================
const VAT = {
    /**
     * 算稅引擎
     * @param {{taxPeriod:string, taxpayerType:number, erpSyncToken?:string, bu_no?:string}} req
     * @returns {Promise<{declarationId:string, totalSalesAmt:number, totalOutputTax:number,
     *                   totalInputTax:number, taxPayable:number, validationErrors:string[]}>}
     */
    async calculate(req) {
        const errors = [];
        const { taxPeriod, taxpayerType, erpSyncToken } = req;
        const filingCycle = req.filingCycle === 'QUARTERLY' ? 'QUARTERLY' : 'MONTHLY';

        // ---- 基本欄位校驗 ----
        if (!/^\d{6}$/.test(taxPeriod)) errors.push('taxPeriod 必須是 6 位數 YYYYMM');
        if (![1, 2].includes(taxpayerType)) errors.push('taxpayerType 必須是 1 或 2');
        if (taxpayerType === 1 && filingCycle === 'QUARTERLY') {
            errors.push('一般納稅人應按月申報，不支援按季申報');
        }
        if (/^\d{6}$/.test(taxPeriod) && filingCycle === 'QUARTERLY') {
            const month = monthSeq(taxPeriod);
            if (month % 3 !== 0) errors.push('按季申報的 taxPeriod 必須是季度末月（03/06/09/12）');
        }
        if (errors.length > 0) {
            return this._emptyResult(taxPeriod, taxpayerType, errors, filingCycle);
        }

        const buNo = req.bu_no || this._inferBuNo();
        if (!buNo) errors.push('無法確定 bu_no，請在請求中提供 bu_no 或登入上下文中有對應 BU');
        if (errors.length > 0) {
            return this._emptyResult(taxPeriod, taxpayerType, errors, filingCycle);
        }

        // ---- 稅款所屬期範圍 ----
        const range = periodRange(taxPeriod, filingCycle);

        // ---- 拉取發票明細 ----
        //   銷項：TX_type = 'AR'；進項：TX_type = 'AP'
        //   註：DB 內 YYYY_MM 存在 'YYYY-MM' 與 'YYYY/MM' 兩種格式，兩種都查以兼容
        const periodVariants = [];
        for (const ym of range.months) {
            periodVariants.push(`${ym.substring(0, 4)}/${ym.substring(4, 6)}`);
            periodVariants.push(`${ym.substring(0, 4)}-${ym.substring(4, 6)}`);
        }
        const ph = periodVariants.map(() => '?').join(',');

        const [salesRows] = await pool.execute(
            `SELECT sub_amt, tax_rate, VAT_amt
               FROM mgm_invoice_details
              WHERE bu_no=? AND TX_type='AR' AND YYYY_MM IN (${ph})`,
            [buNo, ...periodVariants]
        );
        const [inputRows] = await pool.execute(
            `SELECT sub_amt, tax_rate, VAT_amt
               FROM mgm_invoice_details
              WHERE bu_no=? AND TX_type='AP' AND YYYY_MM IN (${ph})`,
            [buNo, ...periodVariants]
        );

        // ---- VAT_R01: 銷項稅額 ----
        //  一般納稅人 = SUM(sub_amt * tax_rate)；小規模 = SUM(sub_amt * 0.03)
        //  註：DB 內 tax_rate 以百分數儲存（13 代表 13%），大於 1 時需除以 100
        const isSmall = taxpayerType === 2;
        let totalSales = 0, outputTax = 0;
        for (const r of salesRows) {
            let rate = Number(r.tax_rate || 0);
            if (rate > 1) rate = rate / 100;
            if (isSmall) rate = 0.03;
            totalSales += Number(r.sub_amt || 0);
            outputTax += Number(r.sub_amt || 0) * rate;
        }
        let inputTax = 0;
        for (const r of inputRows) {
            inputTax += Number(r.VAT_amt || 0);
        }

        // ---- 人工調整：進項稅額轉出 / 上期留抵覆蓋 ----
        //  資料來源：稅務錄入頁（tax_vat_adjustments），每帳套每期一筆
        const [adjRows] = await pool.execute(
            `SELECT input_tax_transfer_out, prev_credit_override
               FROM tax_vat_adjustments WHERE bu_no=? AND tax_period=?`,
            [buNo, taxPeriod]
        );
        const adj = adjRows[0] || {};
        const transferOut = isSmall ? 0 : round2(Number(adj.input_tax_transfer_out || 0));

        // 小規模納稅人：不得抵扣進項，inputTax = 0
        if (isSmall) {
            inputTax = 0;
        } else {
            // 可抵扣進項 = 發票進項稅額 − 進項轉出
            inputTax = Math.max(0, round2(inputTax - transferOut));
        }

        // ---- 上期留抵稅額 ----
        //  季報取上季末月的申報草稿（如 202512 → 202509）
        const prevYM = range.prev;
        const prevSlash = `${prevYM.substring(0, 4)}/${prevYM.substring(4, 6)}`;
        const [prevRow] = await pool.execute(
            `SELECT tax_payable FROM vat_declarations
              WHERE bu_no=? AND tax_period=? AND status IN ('CALCULATED','SUBMITTED')
              ORDER BY create_time DESC LIMIT 1`,
            [buNo, prevYM]
        );
        // 若上期應納稅額為負，代表留抵
        const prevCreditCalc = prevRow.length > 0
            ? Math.max(0, -Number(prevRow[0].tax_payable || 0))
            : 0;
        // 人工覆蓋優先（例如上期為紙本申報、系統內無草稿）
        const hasOverride = adj.prev_credit_override !== null && adj.prev_credit_override !== undefined;
        const prevCredit = hasOverride
            ? round2(Number(adj.prev_credit_override))
            : prevCreditCalc;

        // ---- VAT_R02: 應納稅額 ----
        //  小規模按季申報：季度銷售額未達免征標準時，免徵增值稅，應納稅額為 0
        let taxExempt = false;
        let exemptReason = null;
        if (isSmall && filingCycle === 'QUARTERLY'
            && round2(totalSales) <= SMALL_SCALE_QUARTER_EXEMPT) {
            taxExempt = true;
            exemptReason = `季度銷售額 ${round2(totalSales)} 未超過免征標準 `
                + `${SMALL_SCALE_QUARTER_EXEMPT}，免徵增值稅`;
        }

        let taxPayable;
        if (taxExempt) {
            // 免稅銷售額不產生銷項稅額
            outputTax = 0;
            taxPayable = 0;
        } else if (isSmall) {
            // 小規模：簡易征收，不可為負
            taxPayable = Math.max(0, round2(outputTax));
        } else {
            taxPayable = round2(outputTax - inputTax - prevCredit);
        }

        // ---- VAT_R03: 附加稅 ----
        const urban = round2(taxPayable * 0.07);
        const edu = round2(taxPayable * 0.03);
        const localEdu = round2(taxPayable * 0.02);

        // ---- 寫入草稿 ----
        const declarationId = uuid();
        await pool.execute(
            `INSERT INTO vat_declarations
                (declaration_id, bu_no, tax_period, filing_cycle, period_start, period_end,
                 taxpayer_type, erp_sync_token,
                 total_sales_amt, total_output_tax, total_input_tax, input_tax_transfer_out,
                 prev_period_credit, tax_payable, tax_exempt,
                 urban_maintenance, education_surcharge, local_education_surcharge,
                 status, validation_errors)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'CALCULATED',?)`,
            [declarationId, buNo, taxPeriod, filingCycle, range.start, range.end,
             taxpayerType, erpSyncToken || null,
             round2(totalSales), round2(outputTax), round2(inputTax), transferOut,
             round2(prevCredit), round2(taxPayable), taxExempt ? 1 : 0,
             urban, edu, localEdu,
             JSON.stringify(errors)]
        );

        return {
            declarationId,
            filingCycle,
            periodStart: range.start,
            periodEnd: range.end,
            periodMonths: range.months,
            totalSalesAmt: round2(totalSales),
            totalOutputTax: round2(outputTax),
            totalInputTax: round2(inputTax),
            inputTaxTransferOut: transferOut,
            prevPeriodCredit: round2(prevCredit),
            taxPayable: round2(taxPayable),
            taxExempt,
            exemptReason,
            surcharges: {
                urbanMaintenance: urban,
                educationSurcharge: edu,
                localEducationSurcharge: localEdu
            },
            validationErrors: errors
        };
    },

    _inferBuNo() {
        // 測試/獨立呼叫時 fallback，後續可改成 JWT 上下文
        return null;
    },

    _emptyResult(taxPeriod, taxpayerType, errors, filingCycle = 'MONTHLY') {
        return {
            declarationId: null,
            filingCycle,
            periodStart: null,
            periodEnd: null,
            periodMonths: [],
            totalSalesAmt: 0,
            totalOutputTax: 0,
            totalInputTax: 0,
            taxPayable: 0,
            taxExempt: false,
            exemptReason: null,
            surcharges: { urbanMaintenance: 0, educationSurcharge: 0, localEducationSurcharge: 0 },
            validationErrors: errors
        };
    },

    /** 查詢草稿 */
    async getDraft(declarationId) {
        const [rows] = await pool.execute(
            'SELECT * FROM vat_declarations WHERE declaration_id=?',
            [declarationId]
        );
        return rows[0] || null;
    }
};

// =====================================================================
// 模組二：CIT 企業所得稅年度匯算
// =====================================================================
const CIT = {
    /**
     * @param {{taxYear:string, taxpayerIdentNo:string, includeAdjustments?:boolean, bu_no?:string}} req
     */
    async calculate(req) {
        const errors = [];
        const { taxYear, taxpayerIdentNo } = req;
        const includeAdj = req.includeAdjustments !== false;

        if (!/^\d{4}$/.test(taxYear)) errors.push('taxYear 必須是 4 位數 YYYY');
        if (!taxpayerIdentNo) errors.push('taxpayerIdentNo 必填');
        if (errors.length > 0) {
            return this._emptyResult(errors);
        }

        const buNo = req.bu_no || this._inferBuNo();
        if (!buNo) errors.push('無法確定 bu_no');
        if (errors.length > 0) return this._emptyResult(errors);

        // ---- 從 mgm_finance_summary 拉取年度數據 ----
        // 財報中 sale_amt/sale_cost_amt/sale_discount_amt/sale_exp_amt/MGM_EXP_amt
        // 按年度聚合（YYYY 欄位）
        const [rows] = await pool.execute(
            `SELECT
                COALESCE(SUM(sale_amt), 0)         AS total_revenue,
                COALESCE(SUM(sale_cost_amt), 0)    AS total_cost,
                COALESCE(SUM(sale_discount_amt), 0) AS sale_discount,
                COALESCE(SUM(sale_exp_amt), 0)     AS sale_exp,
                COALESCE(SUM(MGM_EXP_amt), 0)      AS mgm_exp,
                COALESCE(SUM(finance_EXP_amt), 0)  AS finance_exp,
                COALESCE(SUM(operation_profit_amt), 0) AS op_profit,
                COALESCE(SUM(pretax_profit_amt), 0)  AS pretax_profit
             FROM mgm_finance_summary
             WHERE bu_no=? AND YYYY=?`,
            [buNo, taxYear]
        );
        const r = rows[0] || {};

        const totalRevenue = round2(Number(r.total_revenue || 0));
        const totalCost = round2(Number(r.total_cost || 0));
        const saleDiscount = round2(Number(r.sale_discount || 0));

        // ---- 人工錄入：匯算參數與納稅調整明細 ----
        //  資料來源：稅務錄入頁（tax_cit_inputs / tax_cit_adjustments）
        const [cfgRows] = await pool.execute(
            `SELECT tax_rate, accum_prepaid_tax, withheld_tax,
                    revenue_override, cost_override, override_reason
               FROM tax_cit_inputs WHERE bu_no=? AND tax_year=?`,
            [buNo, taxYear]
        );
        const cfg = cfgRows[0] || {};

        // ---- 收入/成本人工覆蓋優先（migration 010） ----
        //  NULL 表示仍自動取 mgm_finance_summary；非 NULL 則覆蓋
        const isOverridden = cfg.revenue_override != null || cfg.cost_override != null;
        const effectiveRevenue = cfg.revenue_override != null
            ? round2(Number(cfg.revenue_override)) : totalRevenue;
        const effectiveCost = cfg.cost_override != null
            ? round2(Number(cfg.cost_override)) : totalCost;

        const [adjRows] = await pool.execute(
            `SELECT adjustment_type, COALESCE(SUM(amount),0) AS amt
               FROM tax_cit_adjustments WHERE bu_no=? AND tax_year=?
              GROUP BY adjustment_type`,
            [buNo, taxYear]
        );
        const adjMap = {};
        for (const a of adjRows) adjMap[a.adjustment_type] = Number(a.amt || 0);

        const taxFreeIncome     = round2(adjMap.TAX_FREE_INCOME || 0);
        const taxAdjustIncrease = includeAdj ? round2(adjMap.ADJ_INCREASE || 0) : 0;
        const taxAdjustDecrease = includeAdj ? round2(adjMap.ADJ_DECREASE || 0) : 0;

        // ---- CIT_R01: 應納稅所得額 ----
        // Taxable_Income = Revenue - Cost - TaxFree + AdjInc - AdjDec
        // 若人工覆蓋已啟用，則用 effectiveRevenue / effectiveCost 取代財報匯總值
        let taxableIncome = round2(effectiveRevenue - effectiveCost - taxFreeIncome + taxAdjustIncrease - taxAdjustDecrease);
        if (taxableIncome < 0) taxableIncome = 0;

        // ---- CIT_R02: 應納稅額 ----
        //  稅率由人工錄入（預設 25%）；減免 / 抵免取自調整明細
        const taxRate = (cfg.tax_rate !== undefined && cfg.tax_rate !== null)
            ? Number(cfg.tax_rate) : 0.25;
        const taxExemptions = round2(adjMap.TAX_EXEMPTION || 0);
        const taxCredits    = round2(adjMap.TAX_CREDIT || 0);
        const taxPayable = round2(Math.max(0, taxableIncome * taxRate - taxExemptions - taxCredits));

        // ---- CIT_R03: 補/退稅 ----
        // 累計預繳來源優先序：呼叫端明確提供 > 人工錄入 > 0。
        // 註：財報 AP_tax_amt 為「應付稅費總額」（含增值稅、個稅等），不可直接當作企業所得稅預繳額。
        const accumPrepaid = Number.isFinite(Number(req.accumPrepaidTax))
            ? Number(req.accumPrepaidTax)
            : round2(Number(cfg.accum_prepaid_tax || 0));
        const withheldTax = Number.isFinite(Number(req.withheldTax))
            ? Number(req.withheldTax)
            : round2(Number(cfg.withheld_tax || 0));
        const refundOrSupplement = round2(taxPayable - accumPrepaid - withheldTax);

        // ---- 寫入 ----
        const settlementId = uuid();
        await pool.execute(
            `INSERT INTO cit_annual_settlements
                (settlement_id, bu_no, tax_year, taxpayer_ident_no, include_adjustments,
                 is_overridden, total_revenue, total_cost, tax_free_income,
                 tax_adjust_increase, tax_adjust_decrease,
                 taxable_income, tax_rate,
                 tax_payable, tax_exemptions, tax_credits,
                 accum_prepaid_tax, withheld_tax, refund_or_supplement,
                 status)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'CALCULATED')`,
            [settlementId, buNo, taxYear, taxpayerIdentNo, includeAdj ? 1 : 0,
             isOverridden ? 1 : 0, effectiveRevenue, effectiveCost, taxFreeIncome,
             taxAdjustIncrease, taxAdjustDecrease,
             taxableIncome, taxRate,
             taxPayable, taxExemptions, taxCredits,
             round2(accumPrepaid), withheldTax, refundOrSupplement]
        );

        return {
            settlementId,
            totalRevenue: effectiveRevenue,
            totalCost: effectiveCost,
            taxableIncome,
            taxPayable,
            refundOrSupplement,
            accumPrepaidTax: round2(accumPrepaid),
            financeRevenue: totalRevenue,
            financeCost: totalCost,
            isOverridden,
            validationErrors: errors
        };
    },

    _inferBuNo() { return null; },
    _emptyResult(errors) {
        return { settlementId: null, totalRevenue: 0, totalCost: 0, taxableIncome: 0,
                 taxPayable: 0, refundOrSupplement: 0, validationErrors: errors };
    },
    async getDraft(settlementId) {
        const [rows] = await pool.execute(
            'SELECT * FROM cit_annual_settlements WHERE settlement_id=?', [settlementId]);
        return rows[0] || null;
    }
};

// =====================================================================
// 模組三：IIT 個人所得稅
// =====================================================================
const IIT = {
    /**
     * @param {{taxPeriod:string, incomeType:string, employeeIds?:string[], bu_no?:string}} req
     *   incomeType: SALARY（工資薪金）/ LABOR_REMUNERATION（勞務）/ REMUNERATION_FOR_WRITING（稿酬）
     */
    async calculate(req) {
        const errors = [];
        const { taxPeriod, incomeType, employeeIds } = req;

        if (!/^\d{6}$/.test(taxPeriod)) errors.push('taxPeriod 必須是 YYYYMM');
        if (!['SALARY', 'LABOR_REMUNERATION', 'REMUNERATION_FOR_WRITING'].includes(incomeType)) {
            errors.push('incomeType 必須是 SALARY / LABOR_REMUNERATION / REMUNERATION_FOR_WRITING');
        }
        if (errors.length > 0) return this._emptyResult(errors);

        const buNo = req.bu_no || this._inferBuNo();
        if (!buNo) errors.push('無法確定 bu_no');
        if (errors.length > 0) return this._emptyResult(errors);

        const year = taxPeriod.substring(0, 4);
        const month = parseInt(taxPeriod.substring(4, 6), 10);

        // ---- 員工清單 ----
        //  優先序：薪資錄入（payroll_details）> 指定員工名單 > 財報平均估算
        const periodSlash = `${year}/${String(month).padStart(2, '0')}`;
        const [payRows] = await pool.execute(
            `SELECT employee_id, employee_name, gross_salary,
                    social_insurance, special_deduction, other_deduction
               FROM payroll_details
              WHERE bu_no=? AND YYYY_MM IN (?,?)`,
            [buNo, periodSlash, `${year}-${String(month).padStart(2, '0')}`]
        );
        const usePayroll = payRows.length > 0;

        let employees = [];
        if (usePayroll) {
            employees = payRows
                .filter(p => !employeeIds || employeeIds.length === 0 || employeeIds.includes(p.employee_id))
                .map(p => ({ xuser_id: p.employee_id, ...p }));
        } else if (employeeIds && employeeIds.length > 0) {
            const ph = employeeIds.map(() => '?').join(',');
            const [empRows] = await pool.execute(
                `SELECT * FROM cams_xuser WHERE xuser_id IN (${ph}) AND inuse_flag='USE'`,
                employeeIds
            );
            employees = empRows;
        } else {
            // 無薪資資料時，以財報平均工資估算（僅供試算）
            const [fs] = await pool.execute(
                `SELECT employee_cnt, salary_amt FROM mgm_finance_summary
                  WHERE bu_no=? AND YYYY=? AND MM=? LIMIT 1`,
                [buNo, year, String(month).padStart(2, '0')]
            );
            if (fs.length > 0) {
                const cnt = Number(fs[0].employee_cnt || 0);
                const avgSalary = cnt > 0 ? Number(fs[0].salary_amt || 0) / cnt : 0;
                for (let i = 1; i <= cnt; i++) {
                    employees.push({ xuser_id: `EMP-${String(i).padStart(4, '0')}`, avgMonthlySalary: round2(avgSalary) });
                }
            }
        }

        // ---- 寫批次主表 ----
        const batchId = uuid();
        await pool.execute(
            `INSERT INTO iit_withholding_batches
                (withholding_batch_id, bu_no, tax_period, income_type,
                 total_employees, total_withheld_tax)
             VALUES (?,?,?,?,0,0)`,
            [batchId, buNo, taxPeriod, incomeType]
        );

        // ---- 每位員工：累計稅額 ----
        const details = [];
        let totalWithheld = 0;

        for (const emp of employees) {
            const empId = emp.xuser_id || emp.employee_id;
            if (!empId) continue;

            // 當期收入：薪資錄入值優先，否則用平均工資（無資料時 8000 佔位）
            const currentIncome = usePayroll
                ? round2(Number(emp.gross_salary || 0))
                : round2(emp.avgMonthlySalary || 8000);

            // ---- IIT_R01: 累計收入 ----
            let cumulativeIncome;
            let cumulativeExtraDeduction = 0; // 三險一金 + 專項附加 + 其他（年度累計）
            if (usePayroll) {
                // 薪資明細已含當期，直接按年度累計匯總
                const [cum] = await pool.execute(
                    `SELECT COALESCE(SUM(gross_salary),0) AS inc,
                            COALESCE(SUM(social_insurance + special_deduction + other_deduction),0) AS ded
                       FROM payroll_details
                      WHERE bu_no=? AND employee_id=? AND LEFT(YYYY_MM,4)=?
                        AND CAST(SUBSTRING(REPLACE(YYYY_MM,'/','-'),6,2) AS UNSIGNED) <= ?`,
                    [buNo, empId, year, month]
                );
                cumulativeIncome = round2(Number(cum[0].inc || 0));
                cumulativeExtraDeduction = round2(Number(cum[0].ded || 0));
            } else {
                // 無歷史扣繳明細時，以「當期收入 × 月序」估算，與累計扣除同口徑
                // 註：mysql2 prepared statements 不支援 LIMIT 占位符，改用 query + 校驗後數字拼接
                const safeLimit = Math.max(0, Math.min(11, month - 1));
                const [hist] = await pool.query(
                    `SELECT current_period_income FROM iit_withholding_details
                      WHERE employee_id = ?
                      ORDER BY uid DESC LIMIT ${safeLimit}`,
                    [empId]
                );
                if (hist.length === 0) {
                    cumulativeIncome = round2(currentIncome * month);
                } else {
                    cumulativeIncome = hist.reduce((s, h) => s + Number(h.current_period_income || 0), 0) + currentIncome;
                }
            }

            // ---- IIT_R02: 累計扣除 ----
            // 基本扣除 5000 × 月數 + 三險一金 / 專項附加 / 其他扣除年度累計
            const basicDeduction = 5000 * month;
            const cumulativeDeduction = round2(basicDeduction + cumulativeExtraDeduction);

            // ---- IIT_R03: 本期應扣稅 ----
            const taxableCumulative = Math.max(0, cumulativeIncome - cumulativeDeduction);
            const { rate, quickDeduction } = lookupIitBracket(taxableCumulative);
            const totalTax = round2(taxableCumulative * rate - quickDeduction);

            // 累計已繳
            const [paid] = await pool.execute(
                `SELECT COALESCE(SUM(current_period_tax),0) AS paid
                   FROM iit_withholding_details WHERE employee_id=?`,
                [empId]
            );
            const cumulativePaid = Number(paid[0]?.paid || 0);
            const currentPeriodTax = round2(Math.max(0, totalTax - cumulativePaid));

            totalWithheld += currentPeriodTax;

            details.push([
                batchId, empId, buNo,
                currentIncome, round2(cumulativeIncome), round2(cumulativeDeduction),
                rate, quickDeduction, round2(cumulativePaid), currentPeriodTax
            ]);
        }

        // 寫明細（批量）
        if (details.length > 0) {
            const placeholders = details.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',');
            const flat = details.flat();
            await pool.execute(
                `INSERT INTO iit_withholding_details
                    (withholding_batch_id, employee_id, bu_no,
                     current_period_income, cumulative_income, cumulative_deduction,
                     applicable_tax_rate, quick_deduction, cumulative_paid_tax, current_period_tax)
                 VALUES ${placeholders}`,
                flat
            );
        }

        // 更新批次主表
        await pool.execute(
            `UPDATE iit_withholding_batches
                SET total_employees=?, total_withheld_tax=?, status='CALCULATED'
              WHERE withholding_batch_id=?`,
            [details.length, round2(totalWithheld), batchId]
        );

        return {
            withholdingBatchId: batchId,
            totalEmployees: details.length,
            totalWithheldTax: round2(totalWithheld),
            employeeDetails: details.map(d => ({
                employeeId: d[1],
                cumulativeIncome: d[4],
                cumulativeDeduction: d[5],
                currentPeriodTax: d[9]
            })),
            validationErrors: errors
        };
    },

    _inferBuNo() { return null; },
    _emptyResult(errors) {
        return { withholdingBatchId: null, totalEmployees: 0, totalWithheldTax: 0,
                 employeeDetails: [], validationErrors: errors };
    },
    async getBatch(batchId) {
        const [rows] = await pool.execute(
            'SELECT * FROM iit_withholding_batches WHERE withholding_batch_id=?', [batchId]);
        return rows[0] || null;
    },
    async getDetails(batchId) {
        const [rows] = await pool.execute(
            'SELECT * FROM iit_withholding_details WHERE withholding_batch_id=?', [batchId]);
        return rows;
    },

    /**
     * 年終獎計算（單獨計稅 vs 合併計稅）
     * @param {{bu_no:string, taxYear:string, taxMethod?:'SEPARATE'|'COMBINED', employeeIds?:string[]}} req
     * @returns {Promise<{bonusBatchId:string, taxMethod:string, totalBonus:number, totalWithheldTax:number,
     *                    employeeDetails:[{employeeId, employeeName, bonusAmount, monthlyReference,
     *                                      applicableTaxRate, quickDeduction, bonusTax,
     *                                      cumulativeIncome, cumulativeDeduction, annualWithheldTax,
     *                                      annualBonusCombinedTax, marginalBonusTax}]}>}
     *
     * 規則（按稅法）：
     *   SEPARATE — 獎金 ÷ 12 確定適用月度稅率，應扣稅 = 獎金 × 稅率 − 速算扣除數
     *   COMBINED — 獎金併入員工年度綜合所得：
     *              1) 讀取員工年度累計工資收入與累計扣除（5000×12 + 三險一金 + 專項附加 + 其他）
     *              2) 年終獎加總 → 年度累計收入' = 工資累計 + 獎金
     *              3) 年度應納稅額' = 年度累計收入' × 年度稅率 − 年度速扣
     *              4) 年終獎應補稅 = 年度應納稅額' − 已預扣稅額
     *              若結果為負（即原本已超扣），年終獎應補稅 = 0
     *
     * 注意：COMBINED 僅計算年終獎「邊際稅額」——在當年度既有工資預扣基礎上，
     *       因加入年終獎而新增的稅額。這才是年終獎真正應扣的稅。
     */
    async calculateBonus(req) {
        const errors = [];
        const { bu_no, taxYear } = req;
        const taxMethod = req.taxMethod === 'COMBINED' ? 'COMBINED' : 'SEPARATE';
        if (!bu_no) errors.push('bu_no 必填');
        if (!/^\d{4}$/.test(taxYear)) errors.push('taxYear 必填，格式 YYYY');
        if (errors.length > 0) {
            return this._emptyBonusResult(errors);
        }

        // 查詢指定納稅年度的全部獎金錄入（SEPARATE 與 COMBINED 都算，前端會顯示兩種結果對照）
        let allBonusRows;
        if (req.employeeIds?.length > 0) {
            const ph = req.employeeIds.map(() => '?').join(',');
            [allBonusRows] = await pool.execute(
                `SELECT id, employee_id, employee_name, bonus_amount, tax_method
                   FROM bonus_details
                  WHERE bu_no=? AND tax_year=? AND employee_id IN (${ph})`,
                [bu_no, taxYear, ...req.employeeIds]
            );
        } else {
            [allBonusRows] = await pool.execute(
                `SELECT id, employee_id, employee_name, bonus_amount, tax_method
                   FROM bonus_details
                  WHERE bu_no=? AND tax_year=?`,
                [bu_no, taxYear]
            );
        }

        // SEPARATE 與 COMBINED 都需要計算，讓前端對照兩種方式的稅額
        const details = [];
        let totalBonus = 0;
        let totalSeparateTax = 0;
        let totalCombinedTax = 0;

        for (const b of allBonusRows) {
            const amount = round2(Number(b.bonus_amount || 0));
            if (amount <= 0) continue;
            totalBonus = round2(totalBonus + amount);

            // ---- SEPARATE 路徑（月度稅率表） ----
            const monthly = amount / 12;
            const { rate: sepRate, quickDeduction: sepQuick } = lookupBonusBracket(monthly);
            const separateTax = round2(Math.max(0, amount * sepRate - sepQuick));
            totalSeparateTax = round2(totalSeparateTax + separateTax);

            // ---- COMBINED 路徑（年度稅率表 + 邊際稅額） ----
            // 讀取員工年度累計工資與累計扣除
            const yearSlash = `${taxYear}/%`;
            const yearDash  = `${taxYear}-%`;
            const [payrollCum] = await pool.execute(
                `SELECT COALESCE(SUM(gross_salary),0) AS cum_income,
                        COALESCE(SUM(social_insurance + special_deduction + other_deduction),0) AS cum_extra_ded
                   FROM payroll_details
                  WHERE bu_no=? AND employee_id=?
                    AND (YYYY_MM LIKE ? OR YYYY_MM LIKE ?)`,
                [bu_no, b.employee_id, yearSlash, yearDash]
            );
            let cumIncome = Number(payrollCum[0]?.cum_income || 0);
            let cumExtraDed = Number(payrollCum[0]?.cum_extra_ded || 0);
            let cumBasicDed = 5000 * 12; // 年度基本扣除
            let annualWithheldTax = 0;

            // 如果 payroll_details 沒有資料，退回讀取歷史預扣明細
            if (cumIncome === 0) {
                const [hist] = await pool.execute(
                    `SELECT SUM(current_period_income) AS cum_inc, SUM(current_period_tax) AS cum_paid
                       FROM iit_withholding_details
                      WHERE employee_id=?`,
                    [b.employee_id]
                );
                cumIncome = Number(hist[0]?.cum_inc || 0);
                annualWithheldTax = Number(hist[0]?.cum_paid || 0);
            } else {
                // 有 payroll 資料時，讀取已預扣稅額
                const [paidRows] = await pool.execute(
                    `SELECT SUM(current_period_tax) AS cum_paid
                       FROM iit_withholding_details
                      WHERE employee_id=? AND current_period_income > 0
                        AND withholding_batch_id IN (
                            SELECT withholding_batch_id FROM iit_withholding_batches
                             WHERE tax_period LIKE ? AND income_type='SALARY')`,
                    [b.employee_id, `${taxYear}%`]
                );
                annualWithheldTax = Number(paidRows[0]?.cum_paid || 0);
            }

            // 邊際稅額算法：加入獎金後的年度應納稅額 − 原本已納稅額
            const cumDeduction = round2(cumBasicDed + cumExtraDed);
            const taxableBefore = Math.max(0, cumIncome - cumDeduction);
            const { rate: annualRate, quickDeduction: annualQuick } = lookupIitBracket(taxableBefore);
            const annualTaxBefore = round2(taxableBefore * annualRate - annualQuick);

            const cumIncomeAfter = round2(cumIncome + amount);
            const taxableAfter = Math.max(0, cumIncomeAfter - cumDeduction);
            const { rate: rateAfter, quickDeduction: quickAfter } = lookupIitBracket(taxableAfter);
            const annualTaxAfter = round2(taxableAfter * rateAfter - quickAfter);

            // 年終獎應補稅 = 加入獎金後年度應納 − 原本年度應納（或已預扣，取大）
            // 用原本計算的 annualTaxBefore 而非 annualWithheldTax 更準確，
            // 因為 annualWithheldTax 可能因缺失數據而不准
            let combinedBonusTax = round2(Math.max(0, annualTaxAfter - annualTaxBefore));
            totalCombinedTax = round2(totalCombinedTax + combinedBonusTax);

            // 最後選擇 taxMethod 指定的路徑作為「應扣稅額」
            const finalBonusTax = taxMethod === 'COMBINED' ? combinedBonusTax : separateTax;

            details.push({
                employeeId: b.employee_id,
                employeeName: b.employee_name,
                bonusAmount: amount,
                // SEPARATE 展示
                monthlyReference: round2(monthly),
                applicableTaxRate: taxMethod === 'SEPARATE' ? sepRate : rateAfter,
                quickDeduction: taxMethod === 'SEPARATE' ? sepQuick : quickAfter,
                bonusTax: finalBonusTax,
                // COMBINED 對照數據
                cumulativeIncome: round2(cumIncome),
                cumulativeDeduction: round2(cumDeduction),
                annualWithheldTax: annualWithheldTax,
                annualBonusCombinedTax: combinedBonusTax,
                separateBonusTax: separateTax
            });
        }

        const finalTotalWithheldTax = taxMethod === 'COMBINED' ? totalCombinedTax : totalSeparateTax;

        // 寫入批次主表（與工資扣繳批次分開）
        const batchId = uuid();
        await pool.execute(
            `INSERT INTO iit_withholding_batches
                (withholding_batch_id, bu_no, tax_period, income_type, bonus_mode,
                 total_employees, total_withheld_tax)
             VALUES (?,?,?,?,?,?,?)`,
            [batchId, bu_no, `${taxYear}12`, 'YEAR_END_BONUS', taxMethod,
             details.length, finalTotalWithheldTax]
        );

        // 寫入明細
        if (details.length > 0) {
            const placeholders = details.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
            const flat = details.map(d => [
                batchId, d.employeeId, bu_no,
                0,                                         // current_period_income（工資，此處為 0）
                0, 0,                                      // cumulative_income / deduction（獨立計稅無累計概念）
                d.applicableTaxRate, d.quickDeduction,
                0,                                         // cumulative_paid_tax
                d.bonusAmount,                             // bonus_amount
                d.bonusTax, taxMethod,                     // bonus_tax / bonus_method
                d.bonusTax                                  // current_period_tax
            ]).flat();
            await pool.execute(
                `INSERT INTO iit_withholding_details
                    (withholding_batch_id, employee_id, bu_no,
                     current_period_income, cumulative_income, cumulative_deduction,
                     applicable_tax_rate, quick_deduction, cumulative_paid_tax,
                     bonus_amount, bonus_tax, bonus_method,
                     current_period_tax)
                 VALUES ${placeholders}`,
                flat
            );
        }

        return {
            bonusBatchId: batchId,
            taxMethod,
            totalBonus,
            totalWithheldTax: finalTotalWithheldTax,
            totalSeparateTax,
            totalCombinedTax,
            employeeDetails: details,
            validationErrors: errors
        };
    },

    _emptyBonusResult(errors) {
        return {
            bonusBatchId: null, taxMethod: 'SEPARATE',
            totalBonus: 0, totalWithheldTax: 0,
            employeeDetails: [], validationErrors: errors
        };
    }
};

// =====================================================================
// 通用：提交申報（模擬稅局受理）
// =====================================================================
const Submit = {
    /**
     * 生成稅局受理收據，更新對應模組的狀態。
     * 實際專案中此處應調用稅局 OpenAPI；此版本為「本地模擬受理」。
     */
    async submit({ module, bizId, operatorId, digitalSignature, pool }) {
        const receiptNo = `TAX-${module}-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
        const deadline = new Date();
        deadline.setDate(deadline.getDate() + 15); // 15 天內繳納

        // 更新業務單狀態
        const statusMap = {
            VAT: { table: 'vat_declarations',          idCol: 'declaration_id',  sigCol: 'digital_signature' },
            CIT: { table: 'cit_annual_settlements',    idCol: 'settlement_id',  sigCol: 'digital_signature' },
            IIT: { table: 'iit_withholding_batches',   idCol: 'withholding_batch_id', sigCol: null }
        };
        const cfg = statusMap[module];
        if (!cfg) throw new Error(`未知模組: ${module}`);

        const setClause = cfg.sigCol ? `${cfg.sigCol}=?, status='SUBMITTED', operator_id=?` : `status='SUBMITTED', operator_id=?`;
        const params = cfg.sigCol
            ? [digitalSignature || null, operatorId, bizId]
            : [operatorId, bizId];

        await pool.execute(
            `UPDATE ${cfg.table} SET ${setClause} WHERE ${cfg.idCol}=?`,
            params
        );

        // 寫受理收據
        await pool.execute(
            `INSERT INTO tax_submit_receipts
                (module, biz_id, tax_bureau_receipt_no, submit_time, status, payment_deadline,
                 operator_id, raw_response)
             VALUES (?,?,?,NOW(),'SUCCESS',?,?,?)`,
            [module, bizId, receiptNo, deadline, operatorId, JSON.stringify({ ok: true, receiptNo })]
        );

        return {
            taxBureauReceiptNo: receiptNo,
            submitTime: new Date().toISOString(),
            status: 'SUCCESS',
            paymentDeadline: deadline.toISOString().slice(0, 10)
        };
    }
};

module.exports = {
    VAT, CIT, IIT, Submit,
    // 測試 / 獨立調用所需工具
    _utils: { uuid, round2, prevPeriod, monthSeq, lookupIitBracket }
};
