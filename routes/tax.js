/**
 * 電子化報稅模組路由（統一前置）
 *
 * 三大子模組（依 OpenAPI 規範掛載於 /api/tax 下）：
 *   POST /api/tax/vat/calculate                 → 增值稅算稅引擎
 *   POST /api/tax/vat/:declarationId/submit     → 增值稅提交申報
 *   POST /api/tax/cit/calculate                 → 企業所得稅年度匯算算稅
 *   POST /api/tax/cit/submit                    → 企業所得稅提交申報
 *   POST /api/tax/iit/calculate                 → 個人所得稅算稅引擎
 *   POST /api/tax/iit/submit                    → 個人所得稅扣繳申報
 *
 * 外加：
 *   GET  /api/tax/vat/:declarationId            → 查詢增值稅草稿
 *   GET  /api/tax/cit/:settlementId            → 查詢企業所得稅草稿
 *   GET  /api/tax/iit/:batchId                  → 查詢 IIT 批次 / 明細
 */
const express = require('express');
const router = express.Router();
const { ok, fail, fail500, n } = require('../utils/response');
const { VAT, CIT, IIT, Submit, getVatTaxRates, getCitTaxRate } = require('../services/taxService');
const { pool } = require('../config/db');

function resolveBuNo(reqBody, reqQuery) {
    return reqBody?.bu_no || reqQuery?.bu_no || null; // 不猜測，交由 service 層校驗
}
function resolveOperatorId(req) {
    // 優先請求 body；其次從 JWT user_id 取
    return req.body?.operatorId || req.user?.user_id || null;
}

// =====================================================================
// 1. 增值稅
// =====================================================================

/** POST /vat/calculate */
router.post('/vat/calculate', async (req, res) => {
    try {
        const d = req.body || {};
        if (!d.taxPeriod || !/^\d{6}$/.test(d.taxPeriod)) {
            return fail(res, 'taxPeriod 必填，格式 YYYYMM');
        }
        if (!d.taxpayerType || ![1, 2].includes(d.taxpayerType)) {
            return fail(res, 'taxpayerType 必填，1=一般納稅人 / 2=小規模納稅人');
        }
        const filingCycle = d.filingCycle || 'MONTHLY';
        if (!['MONTHLY', 'QUARTERLY'].includes(filingCycle)) {
            return fail(res, 'filingCycle 只能是 MONTHLY 或 QUARTERLY');
        }
        const result = await VAT.calculate({
            taxPeriod: d.taxPeriod,
            taxpayerType: d.taxpayerType,
            filingCycle,
            erpSyncToken: d.erpSyncToken,
            bu_no: resolveBuNo(d, req.query)
        });
        if (result.validationErrors && result.validationErrors.length > 0) {
            // 有業務校驗失敗時仍回 400 + errors
            return fail(res, JSON.stringify(result.validationErrors.join('; ')), 400);
        }
        ok(res, result, '增值稅算稅完成');
    } catch (err) { fail500(res, err); }
});

/** POST /vat/:declarationId/submit */
router.post('/vat/:declarationId/submit', async (req, res) => {
    try {
        const { declarationId } = req.params;
        const d = req.body || {};
        if (!d.operatorId) return fail(res, 'operatorId 必填');

        const draft = await VAT.getDraft(declarationId);
        if (!draft) return fail(res, `找不到申報草稿 ${declarationId}`, 404);
        if (draft.status === 'SUBMITTED') return fail(res, '該申報已提交，不可重複提交', 400);

        // 關聯 operator / 電子簽章
        await pool.execute(
            `UPDATE vat_declarations SET operator_id=?, digital_signature=? WHERE declaration_id=?`,
            [d.operatorId, d.digitalSignature || null, declarationId]
        );

        const receipt = await Submit.submit({
            module: 'VAT',
            bizId: declarationId,
            operatorId: d.operatorId,
            digitalSignature: d.digitalSignature,
            pool
        });
        ok(res, receipt, '增值稅申報已提交');
    } catch (err) { fail500(res, err); }
});

/** GET /vat/reconcile?bu_no=&taxPeriod=&filingCycle=&taxpayerType= — 進銷項發票勾對清單 */
router.get('/vat/reconcile', async (req, res) => {
    try {
        const buNo = req.query.bu_no;
        const taxPeriod = String(req.query.taxPeriod || '');
        const filingCycle = req.query.filingCycle === 'QUARTERLY' ? 'QUARTERLY' : 'MONTHLY';
        const taxpayerType = Number(req.query.taxpayerType || 1);
        const isSmall = taxpayerType === 2;
        if (!buNo) return fail(res, 'bu_no 必填');
        if (!/^\d{6}$/.test(taxPeriod)) return fail(res, 'taxPeriod 必填，格式 YYYYMM');
        if (![1, 2].includes(taxpayerType)) return fail(res, 'taxpayerType 只能是 1 或 2');

        // 依申報週期展開所屬月（季報為該季 3 個月）
        const year = taxPeriod.slice(0, 4);
        const month = Number(taxPeriod.slice(4));
        const startMonth = filingCycle === 'QUARTERLY'
            ? Math.floor((month - 1) / 3) * 3 + 1 : month;
        const span = filingCycle === 'QUARTERLY' ? 3 : 1;
        const variants = [];
        const months = [];
        for (let i = 0; i < span; i++) {
            const ym = `${year}${String(startMonth + i).padStart(2, '0')}`;
            months.push(ym);
            variants.push(`${ym.slice(0, 4)}/${ym.slice(4)}`);
            variants.push(`${ym.slice(0, 4)}-${ym.slice(4)}`);
        }
        const ph = variants.map(() => '?').join(',');

        const [rows] = await pool.execute(
            `SELECT uid, TX_type, invoice_no, sub_amt, tax_rate, VAT_amt, YYYY_MM, remark
               FROM mgm_invoice_details
              WHERE bu_no=? AND YYYY_MM IN (${ph})
              ORDER BY TX_type, YYYY_MM, invoice_no`,
            [buNo, ...variants]
        );

        const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
        // 稅率來源：cams_system_codes.TAX_TYPE（CIT=一般納稅人、IIT=小型納稅人，取 value_number1）
        const vatRates = await getVatTaxRates();
        const summarize = (list, smallLevy) => {
            const total = r2(list.reduce((s, x) => s + Number(x.sub_amt || 0), 0));
            const rate = smallLevy ? vatRates.small : vatRates.general;
            return {
                count: list.length,
                amount: total,
                taxRate: smallLevy ? vatRates.smallPct : vatRates.generalPct,
                outputTax: r2(total * rate),
                invoiceTax: r2(list.reduce((s, x) => s + Number(x.VAT_amt || 0), 0))
            };
        };

        const ar = rows.filter(r => r.TX_type === 'AR');
        const ap = rows.filter(r => r.TX_type === 'AP');
        ok(res, {
            filingCycle,
            taxpayerType,
            periods: months,
            invoices: rows,
            sales: summarize(ar, isSmall),   // 銷項（AR）
            purchase: summarize(ap, false)   // 進項（AP）：小規模不得抵扣，僅作參考
        }, '發票勾對清單');
    } catch (err) { fail500(res, err); }
});

/** GET /vat/:declarationId 查詢草稿 */
router.get('/vat/:declarationId', async (req, res) => {
    try {
        const draft = await VAT.getDraft(req.params.declarationId);
        if (!draft) return fail(res, '找不到申報草稿', 404);
        ok(res, draft);
    } catch (err) { fail500(res, err); }
});

// =====================================================================
// 2. 企業所得稅年度匯算
// =====================================================================

/** POST /cit/calculate */
router.post('/cit/calculate', async (req, res) => {
    try {
        const d = req.body || {};
        if (!d.taxYear || !/^\d{4}$/.test(d.taxYear)) {
            return fail(res, 'taxYear 必填，格式 YYYY');
        }
        if (!d.taxpayerIdentNo) return fail(res, 'taxpayerIdentNo 必填');

        const result = await CIT.calculate({
            taxYear: d.taxYear,
            taxpayerIdentNo: d.taxpayerIdentNo,
            includeAdjustments: d.includeAdjustments !== false,
            bu_no: resolveBuNo(d, req.query)
        });
        if (result.validationErrors && result.validationErrors.length > 0) {
            return fail(res, JSON.stringify(result.validationErrors.join('; ')), 400);
        }
        ok(res, result, '年度匯算算稅完成');
    } catch (err) { fail500(res, err); }
});

/** POST /cit/submit  — body 帶 settlementId / operatorId / digitalSignature */
router.post('/cit/submit', async (req, res) => {
    try {
        const d = req.body || {};
        if (!d.settlementId) return fail(res, 'settlementId 必填');
        if (!d.operatorId) return fail(res, 'operatorId 必填');

        const draft = await CIT.getDraft(d.settlementId);
        if (!draft) return fail(res, `找不到年度匯算 ${d.settlementId}`, 404);
        if (draft.status === 'SUBMITTED') return fail(res, '該申報已提交，不可重複提交', 400);

        await pool.execute(
            `UPDATE cit_annual_settlements SET operator_id=?, digital_signature=? WHERE settlement_id=?`,
            [d.operatorId, d.digitalSignature || null, d.settlementId]
        );

        const receipt = await Submit.submit({
            module: 'CIT',
            bizId: d.settlementId,
            operatorId: d.operatorId,
            digitalSignature: d.digitalSignature,
            pool
        });
        ok(res, receipt, '企業所得稅年度匯算已提交');
    } catch (err) { fail500(res, err); }
});

/** GET /cit/:settlementId */
router.get('/cit/:settlementId', async (req, res) => {
    try {
        const draft = await CIT.getDraft(req.params.settlementId);
        if (!draft) return fail(res, '找不到年度匯算單', 404);
        ok(res, draft);
    } catch (err) { fail500(res, err); }
});

// =====================================================================
// 3. 個人所得稅代扣代繳
// =====================================================================

/** POST /iit/calculate */
router.post('/iit/calculate', async (req, res) => {
    try {
        const d = req.body || {};
        if (!d.taxPeriod || !/^\d{6}$/.test(d.taxPeriod)) {
            return fail(res, 'taxPeriod 必填，格式 YYYYMM');
        }
        if (!d.incomeType || !['SALARY', 'LABOR_REMUNERATION', 'REMUNERATION_FOR_WRITING'].includes(d.incomeType)) {
            return fail(res, 'incomeType 必須是 SALARY / LABOR_REMUNERATION / REMUNERATION_FOR_WRITING');
        }
        const result = await IIT.calculate({
            taxPeriod: d.taxPeriod,
            incomeType: d.incomeType,
            employeeIds: d.employeeIds,
            bu_no: resolveBuNo(d, req.query)
        });
        if (result.validationErrors && result.validationErrors.length > 0) {
            return fail(res, JSON.stringify(result.validationErrors.join('; ')), 400);
        }
        ok(res, result, '個人所得稅算稅完成');
    } catch (err) { fail500(res, err); }
});

/** POST /iit/submit */
router.post('/iit/submit', async (req, res) => {
    try {
        const d = req.body || {};
        if (!d.withholdingBatchId) return fail(res, 'withholdingBatchId 必填');
        if (!d.operatorId) return fail(res, 'operatorId 必填');

        const batch = await IIT.getBatch(d.withholdingBatchId);
        if (!batch) return fail(res, `找不到批次 ${d.withholdingBatchId}`, 404);
        if (batch.status === 'SUBMITTED') return fail(res, '該批次已提交', 400);

        const receipt = await Submit.submit({
            module: 'IIT',
            bizId: d.withholdingBatchId,
            operatorId: d.operatorId,
            pool
        });
        ok(res, receipt, '個人所得稅扣繳申報已提交');
    } catch (err) { fail500(res, err); }
});

/** GET /iit/:batchId */
router.get('/iit/:batchId', async (req, res) => {
    try {
        const batch = await IIT.getBatch(req.params.batchId);
        if (!batch) return fail(res, '找不到 IIT 批次', 404);
        const details = await IIT.getDetails(req.params.batchId);
        ok(res, { ...batch, employeeDetails: details });
    } catch (err) { fail500(res, err); }
});

// =====================================================================
// 3b. 年終獎（YEAR_END_BONUS）— 單獨計稅 / 合併計稅
// =====================================================================

/** GET /inputs/bonus?bu_no=&taxYear= */
router.get('/inputs/bonus', async (req, res) => {
    try {
        const { bu_no, taxYear } = req.query;
        if (!bu_no || !/^\d{4}$/.test(taxYear || '')) {
            return fail(res, 'bu_no 與 taxYear(YYYY) 必填');
        }
        const [rows] = await pool.execute(
            `SELECT id, employee_id, employee_name, bonus_amount, tax_method, remark
               FROM bonus_details WHERE bu_no=? AND tax_year=?
               ORDER BY tax_method, employee_id`,
            [bu_no, taxYear]
        );
        ok(res, rows, '年終獎錄入');
    } catch (err) { fail500(res, err); }
});

/** POST /inputs/bonus — 單條保存 */
router.post('/inputs/bonus', async (req, res) => {
    try {
        const { bu_no, taxYear, employee_id, employee_name, bonus_amount, tax_method, remark } = req.body || {};
        if (!bu_no || !/^\d{4}$/.test(taxYear || '')) return fail(res, 'bu_no/taxYear 必填');
        if (!employee_id) return fail(res, 'employee_id 必填');
        if (bonus_amount === undefined || bonus_amount < 0) return fail(res, 'bonus_amount 必須是非負數');
        const method = (tax_method === 'COMBINED' ? 'COMBINED' : 'SEPARATE');

        // upsert
        await pool.execute(
            `INSERT INTO bonus_details
                (bu_no, tax_year, employee_id, employee_name, bonus_amount, tax_method, remark)
             VALUES (?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
                employee_name=VALUES(employee_name),
                bonus_amount=VALUES(bonus_amount),
                tax_method=VALUES(tax_method),
                remark=VALUES(remark),
                update_time=CURRENT_TIMESTAMP`,
            [bu_no, taxYear, employee_id, employee_name || null,
             Number(bonus_amount), method, remark || null]
        );
        const [rows] = await pool.execute(
            `SELECT * FROM bonus_details
              WHERE bu_no=? AND tax_year=? AND employee_id=?`,
            [bu_no, taxYear, employee_id]);
        ok(res, rows[0], '年終獎已保存');
    } catch (err) { fail500(res, err); }
});

/** DELETE /inputs/bonus/:id */
router.delete('/inputs/bonus/:id', async (req, res) => {
    try {
        const [r] = await pool.execute('DELETE FROM bonus_details WHERE id=?', [req.params.id]);
        ok(res, { affectedRows: r.affectedRows }, r.affectedRows ? '已刪除' : '未找到');
    } catch (err) { fail500(res, err); }
});

/** POST /iit/bonus/calculate */
router.post('/iit/bonus/calculate', async (req, res) => {
    try {
        const { bu_no, taxYear, taxMethod, employeeIds } = req.body || {};
        const r = await IIT.calculateBonus({ bu_no, taxYear, taxMethod, employeeIds, pool });
        if (r.validationErrors.length > 0) return fail(res, r.validationErrors.join('; '), 400);
        ok(res, r, '年終獎計算完成');
    } catch (err) { fail500(res, err); }
});

// =====================================================================
// 4. 人工錄入（算稅引擎無法自動取數的欄位）
// =====================================================================

const codeCache = require('../services/codeCache');
let CIT_ADJ_TYPES = ['TAX_FREE_INCOME', 'ADJ_INCREASE', 'ADJ_DECREASE', 'TAX_EXEMPTION', 'TAX_CREDIT'];
(async () => { try { const v = await codeCache.values('CIT_ADJ_TYPE', CIT_ADJ_TYPES); if (v?.length) CIT_ADJ_TYPES = v; } catch {} })();

/** GET /inputs/vat?bu_no=&taxPeriod= */
router.get('/inputs/vat', async (req, res) => {
    try {
        const { bu_no, taxPeriod } = req.query;
        if (!bu_no) return fail(res, 'bu_no 必填');
        if (!/^\d{6}$/.test(taxPeriod || '')) return fail(res, 'taxPeriod 必填，格式 YYYYMM');
        const [rows] = await pool.execute(
            `SELECT input_tax_transfer_out, prev_credit_override, note
               FROM tax_vat_adjustments WHERE bu_no=? AND tax_period=?`,
            [bu_no, taxPeriod]
        );
        ok(res, rows[0] || { input_tax_transfer_out: 0, prev_credit_override: null, note: null }, '增值稅錄入資料');
    } catch (err) { fail500(res, err); }
});

/** PUT /inputs/vat  body: {bu_no, taxPeriod, inputTaxTransferOut, prevCreditOverride, note} */
router.put('/inputs/vat', async (req, res) => {
    try {
        const d = req.body || {};
        if (!d.bu_no) return fail(res, 'bu_no 必填');
        if (!/^\d{6}$/.test(d.taxPeriod || '')) return fail(res, 'taxPeriod 必填，格式 YYYYMM');
        const transferOut = Number(d.inputTaxTransferOut || 0);
        if (!Number.isFinite(transferOut) || transferOut < 0) return fail(res, '進項稅額轉出必須是非負數字');
        const override = (d.prevCreditOverride === '' || d.prevCreditOverride === null || d.prevCreditOverride === undefined)
            ? null : Number(d.prevCreditOverride);
        if (override !== null && (!Number.isFinite(override) || override < 0)) {
            return fail(res, '上期留抵覆蓋值必須是非負數字，或留空由系統計算');
        }

        await pool.execute(
            `INSERT INTO tax_vat_adjustments
                (bu_no, tax_period, input_tax_transfer_out, prev_credit_override, note, updated_by)
             VALUES (?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
                input_tax_transfer_out=VALUES(input_tax_transfer_out),
                prev_credit_override=VALUES(prev_credit_override),
                note=VALUES(note), updated_by=VALUES(updated_by)`,
            [d.bu_no, d.taxPeriod, transferOut, override, d.note || null,
             d.operatorId || req.user?.user_id || null]
        );
        ok(res, { bu_no: d.bu_no, taxPeriod: d.taxPeriod, inputTaxTransferOut: transferOut, prevCreditOverride: override }, '增值稅錄入已儲存');
    } catch (err) { fail500(res, err); }
});

/** GET /inputs/cit?bu_no=&taxYear= */
router.get('/inputs/cit', async (req, res) => {
    try {
        const { bu_no, taxYear } = req.query;
        if (!bu_no) return fail(res, 'bu_no 必填');
        if (!/^\d{4}$/.test(taxYear || '')) return fail(res, 'taxYear 必填，格式 YYYY');
        const [cfg] = await pool.execute(
            `SELECT tax_rate, accum_prepaid_tax, withheld_tax, note,
                    revenue_override, cost_override, override_reason
               FROM tax_cit_inputs WHERE bu_no=? AND tax_year=?`,
            [bu_no, taxYear]
        );
        const [adj] = await pool.execute(
            `SELECT id, adjustment_type, amount, remark
               FROM tax_cit_adjustments WHERE bu_no=? AND tax_year=? ORDER BY id`,
            [bu_no, taxYear]
        );
        // 財報自動值（讓前端顯示對照）
        const [fs] = await pool.execute(
            `SELECT COALESCE(SUM(sale_amt),0) AS sale_amt,
                    COALESCE(SUM(sale_cost_amt),0) AS cost_amt
               FROM mgm_finance_summary WHERE bu_no=? AND YYYY=?`,
            [bu_no, taxYear]
        );
        const codeCitRate = await getCitTaxRate();
        ok(res, {
            taxRate: codeCitRate != null ? codeCitRate : (cfg[0] ? Number(cfg[0].tax_rate) : 0.25),
            accumPrepaidTax: cfg[0] ? Number(cfg[0].accum_prepaid_tax) : 0,
            withheldTax: cfg[0] ? Number(cfg[0].withheld_tax) : 0,
            note: cfg[0] ? cfg[0].note : null,
            revenueOverride: cfg[0]?.revenue_override != null ? Number(cfg[0].revenue_override) : null,
            costOverride: cfg[0]?.cost_override != null ? Number(cfg[0].cost_override) : null,
            overrideReason: cfg[0]?.override_reason ?? null,
            autoRevenue: Number(fs[0]?.sale_amt || 0),
            autoCost:    Number(fs[0]?.cost_amt || 0),
            adjustments: adj
        }, '企業所得稅錄入資料');
    } catch (err) { fail500(res, err); }
});

/** PUT /inputs/cit  body: {bu_no, taxYear, taxRate, accumPrepaidTax, withheldTax, note,
 *                           revenueOverride?, costOverride?, overrideReason?, adjustments[]} */
router.put('/inputs/cit', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const d = req.body || {};
        if (!d.bu_no) return fail(res, 'bu_no 必填');
        if (!/^\d{4}$/.test(d.taxYear || '')) return fail(res, 'taxYear 必填，格式 YYYY');

        const taxRate = Number(d.taxRate);
        if (!Number.isFinite(taxRate) || taxRate <= 0 || taxRate > 1) {
            return fail(res, 'taxRate 必須是 0~1 的小數（0.25 表示 25%）');
        }
        const accum = Number(d.accumPrepaidTax || 0);
        const withheld = Number(d.withheldTax || 0);
        if (!Number.isFinite(accum) || accum < 0) return fail(res, '累計預繳必須是非負數字');
        if (!Number.isFinite(withheld) || withheld < 0) return fail(res, '境外已繳必須是非負數字');

        // revenueOverride / costOverride: 非空才覆蓋；undefined 留空 = 清除
        // 前端會用 null 表示「不覆蓋」，用 undefined 表示「沿用舊值」
        let revOverride, costOverride, overrideReason;
        if (d.revenueOverride !== undefined) {
            revOverride = d.revenueOverride == null || d.revenueOverride === ''
                ? null : Number(d.revenueOverride);
            if (revOverride != null && (!Number.isFinite(revOverride) || revOverride < 0)) {
                return fail(res, '收入覆蓋必須是非負數字或留空');
            }
        } else {
            revOverride = undefined; // 保留原值
        }
        if (d.costOverride !== undefined) {
            costOverride = d.costOverride == null || d.costOverride === ''
                ? null : Number(d.costOverride);
            if (costOverride != null && (!Number.isFinite(costOverride) || costOverride < 0)) {
                return fail(res, '成本覆蓋必須是非負數字或留空');
            }
        } else {
            costOverride = undefined;
        }
        overrideReason = d.overrideReason !== undefined ? (d.overrideReason || null) : undefined;

        const list = Array.isArray(d.adjustments) ? d.adjustments : [];
        for (const a of list) {
            if (!CIT_ADJ_TYPES.includes(a.type)) {
                return fail(res, `調整類型不合法：${a.type}`);
            }
            if (!Number.isFinite(Number(a.amount))) return fail(res, '調整金額必須是數字');
        }

        await conn.beginTransaction();

        // 先查舊值，若前端沒傳 override 字段則沿用
        const [oldRows] = await conn.execute(
            `SELECT revenue_override, cost_override, override_reason FROM tax_cit_inputs
              WHERE bu_no=? AND tax_year=?`, [d.bu_no, d.taxYear]);
        const old = oldRows[0] || {};
        const finalRev = revOverride !== undefined ? revOverride : old.revenue_override ?? null;
        const finalCost = costOverride !== undefined ? costOverride : old.cost_override ?? null;
        const finalReason = overrideReason !== undefined ? overrideReason : old.override_reason ?? null;

        await conn.execute(
            `INSERT INTO tax_cit_inputs
                (bu_no, tax_year, tax_rate, accum_prepaid_tax, withheld_tax,
                 revenue_override, cost_override, override_reason,
                 note, updated_by)
             VALUES (?,?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
                tax_rate=VALUES(tax_rate), accum_prepaid_tax=VALUES(accum_prepaid_tax),
                withheld_tax=VALUES(withheld_tax),
                revenue_override=VALUES(revenue_override),
                cost_override=VALUES(cost_override),
                override_reason=VALUES(override_reason),
                note=VALUES(note), updated_by=VALUES(updated_by)`,
            [d.bu_no, d.taxYear, taxRate, accum, withheld,
             finalRev, finalCost, finalReason,
             d.note || null, d.operatorId || req.user?.user_id || null]
        );
        await conn.execute('DELETE FROM tax_cit_adjustments WHERE bu_no=? AND tax_year=?', [d.bu_no, d.taxYear]);
        for (const a of list) {
            await conn.execute(
                `INSERT INTO tax_cit_adjustments (bu_no, tax_year, adjustment_type, amount, remark, updated_by)
                 VALUES (?,?,?,?,?,?)`,
                [d.bu_no, d.taxYear, a.type, Number(a.amount), a.remark || null,
                 d.operatorId || req.user?.user_id || null]
            );
        }
        await conn.commit();
        ok(res, { bu_no: d.bu_no, taxYear: d.taxYear, taxRate, accumPrepaidTax: accum, withheldTax: withheld,
                  revenueOverride: finalRev, costOverride: finalCost,
                  overrideReason: finalReason, adjustments: list }, '企業所得稅錄入已儲存');
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally {
        conn.release();
    }
});

/** GET /inputs/iit?bu_no=&taxPeriod= — 薪資及扣除明細 */
router.get('/inputs/iit', async (req, res) => {
    try {
        const { bu_no, taxPeriod } = req.query;
        if (!bu_no) return fail(res, 'bu_no 必填');
        if (!/^\d{6}$/.test(taxPeriod || '')) return fail(res, 'taxPeriod 必填，格式 YYYYMM');
        const slash = `${taxPeriod.slice(0, 4)}/${taxPeriod.slice(4)}`;
        const dash = `${taxPeriod.slice(0, 4)}-${taxPeriod.slice(4)}`;
        const [rows] = await pool.execute(
            `SELECT id, YYYY_MM, employee_id, employee_name, gross_salary,
                    social_insurance, special_deduction, other_deduction, remark
               FROM payroll_details
              WHERE bu_no=? AND YYYY_MM IN (?,?)
              ORDER BY employee_id`,
            [bu_no, slash, dash]
        );
        ok(res, rows, '薪資錄入明細');
    } catch (err) { fail500(res, err); }
});

/** POST /inputs/iit — 單筆新增/更新（依 bu_no + 期間 + 員工唯一） */
router.post('/inputs/iit', async (req, res) => {
    try {
        const d = req.body || {};
        if (!d.bu_no) return fail(res, 'bu_no 必填');
        if (!/^\d{4}[-/]\d{2}$/.test(d.YYYY_MM || '')) return fail(res, 'YYYY_MM 必填，格式 YYYY-MM');
        if (!d.employeeId) return fail(res, 'employeeId 必填');

        const nums = {
            gross: Number(d.grossSalary || 0),
            social: Number(d.socialInsurance || 0),
            special: Number(d.specialDeduction || 0),
            other: Number(d.otherDeduction || 0)
        };
        for (const [k, v] of Object.entries(nums)) {
            if (!Number.isFinite(v) || v < 0) return fail(res, `${k} 必須是非負數字`);
        }

        const period = d.YYYY_MM.replace('/', '-');
        await pool.execute(
            `INSERT INTO payroll_details
                (bu_no, YYYY_MM, employee_id, employee_name, gross_salary,
                 social_insurance, special_deduction, other_deduction, remark)
             VALUES (?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
                employee_name=VALUES(employee_name), gross_salary=VALUES(gross_salary),
                social_insurance=VALUES(social_insurance),
                special_deduction=VALUES(special_deduction),
                other_deduction=VALUES(other_deduction), remark=VALUES(remark)`,
            [d.bu_no, period, d.employeeId, d.employeeName || null,
             nums.gross, nums.social, nums.special, nums.other, d.remark || null]
        );
        ok(res, { bu_no: d.bu_no, YYYY_MM: period, employeeId: d.employeeId, ...nums }, '薪資明細已儲存');
    } catch (err) { fail500(res, err); }
});

/** DELETE /inputs/iit/:id?bu_no= */
router.delete('/inputs/iit/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) return fail(res, 'id 不合法');
        const buNo = req.query.bu_no;
        const [r] = buNo
            ? await pool.execute('DELETE FROM payroll_details WHERE id=? AND bu_no=?', [id, buNo])
            : await pool.execute('DELETE FROM payroll_details WHERE id=?', [id]);
        if (r.affectedRows === 0) return fail(res, '找不到該筆薪資明細', 404);
        ok(res, { id }, '薪資明細已刪除');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
