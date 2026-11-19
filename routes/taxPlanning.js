/**
 * CFO-07 税务筹划与税务风险
 *
 * GET  /api/tax-planning/overview     税负指标、月度趋势、优惠清单、风险项
 * GET  /api/tax-planning/preferences  优惠适用登记（目录 + 人工登记合并）
 * POST /api/tax-planning/preferences  登记/覆盖优惠适用（applicable 留空 = 自动判定）
 * PUT  /api/tax-planning/preferences/:uid
 * DELETE /api/tax-planning/preferences/:uid  删除登记，恢复自动判定
 * POST /api/tax-planning/scan         扫描税务风险并写入 alert_log
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const {
    POLICY_CATALOG, BUS, latestYear, loadTaxFacts,
    buildPolicyRows, buildRisks, getOverrides, scanBuTax
} = require('../services/taxRiskScanner');

const n = (v) => Number(v || 0);
const r2 = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.round((x + Number.EPSILON) * 100) / 100 : 0;
};

function parseYear(v, fallback) {
    const s = String(v || '').trim();
    return /^\d{4}$/.test(s) ? s : fallback;
}

async function resolveYear(bu, v) {
    return parseYear(v, await latestYear(bu));
}

async function buildOverview(bu, year) {
    const facts = await loadTaxFacts(bu, year);
    const overrides = await getOverrides(bu, facts.YYYY);
    return {
        bu_no: facts.bu_no,
        YYYY: facts.YYYY,
        totals: facts.totals,
        finance: facts.finance,
        cit: facts.cit,
        monthly: facts.monthly,
        vat_declarations: facts.vat.map(v => ({
            tax_period: v.tax_period,
            taxpayer_type: v.taxpayer_type,
            total_sales_amt: r2(v.total_sales_amt),
            total_output_tax: r2(v.total_output_tax),
            total_input_tax: r2(v.total_input_tax),
            tax_payable: r2(v.tax_payable),
            surcharges: r2(n(v.urban_maintenance) + n(v.education_surcharge) + n(v.local_education_surcharge)),
            status: v.status
        })),
        preferences: buildPolicyRows(facts, overrides),
        risks: buildRisks(facts)
    };
}

// 总览
router.get('/overview', async (req, res) => {
    try {
        const bu = String(req.query.bu_no || 'HM').toUpperCase();
        if (!BUS.includes(bu)) return fail(res, '公司别仅支持 HM/HN/SZ');
        const year = await resolveYear(bu, req.query.YYYY);
        ok(res, await buildOverview(bu, year));
    } catch (err) { fail500(res, err); }
});

// 优惠适用清单
router.get('/preferences', async (req, res) => {
    try {
        const bu = String(req.query.bu_no || 'HM').toUpperCase();
        if (!BUS.includes(bu)) return fail(res, '公司别仅支持 HM/HN/SZ');
        const year = await resolveYear(bu, req.query.YYYY);
        const facts = await loadTaxFacts(bu, year);
        const overrides = await getOverrides(bu, facts.YYYY);
        ok(res, { bu_no: bu, YYYY: facts.YYYY, rows: buildPolicyRows(facts, overrides) });
    } catch (err) { fail500(res, err); }
});

// 登记/覆盖
router.post('/preferences', async (req, res) => {
    try {
        const bu = String(req.body.bu_no || '').toUpperCase();
        if (!BUS.includes(bu)) return fail(res, '公司别仅支持 HM/HN/SZ');
        const year = await resolveYear(bu, req.body.YYYY);
        const code = String(req.body.policy_code || '').trim();
        const policy = POLICY_CATALOG.find(p => p.policy_code === code);
        if (!policy) return fail(res, '优惠政策代码无效');

        let applicable = null;
        if (req.body.applicable !== '' && req.body.applicable !== undefined && req.body.applicable !== null) {
            applicable = Number(req.body.applicable) === 1 ? 1 : 0;
        }
        const estBenefit = r2(req.body.est_benefit);
        const status = req.body.status === undefined || req.body.status === '' || req.body.status === null
            ? 1 : (Number(req.body.status) === 0 ? 0 : 1);
        const note = req.body.note || null;
        const operator = req.user?.user_id || req.body.operator_id || null;

        await pool.execute(
            `INSERT INTO tax_preference
                (bu_no, tax_year, policy_code, policy_name, category, applicable,
                 est_benefit, status, note, updated_by)
             VALUES (?,?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
                policy_name=VALUES(policy_name), category=VALUES(category),
                applicable=VALUES(applicable), est_benefit=VALUES(est_benefit),
                status=VALUES(status), note=VALUES(note), updated_by=VALUES(updated_by)`,
            [bu, year, code, policy.policy_name, policy.category, applicable,
             estBenefit, status, note, operator]);

        const [rows] = await pool.execute(
            'SELECT * FROM tax_preference WHERE bu_no=? AND tax_year=? AND policy_code=?',
            [bu, year, code]);
        ok(res, rows[0], '优惠适用已登记');
    } catch (err) { fail500(res, err); }
});

// 更新登记
router.put('/preferences/:uid', async (req, res) => {
    try {
        const uid = Number(req.params.uid);
        if (!uid) return fail(res, '参数无效');
        const [rows] = await pool.execute('SELECT * FROM tax_preference WHERE uid=?', [uid]);
        if (!rows.length) return fail(res, '登记记录不存在', 404);
        const cur = rows[0];

        let applicable = cur.applicable;
        if ('applicable' in req.body) {
            applicable = req.body.applicable === '' || req.body.applicable === null || req.body.applicable === undefined
                ? null : (Number(req.body.applicable) === 1 ? 1 : 0);
        }
        const estBenefit = 'est_benefit' in req.body ? r2(req.body.est_benefit) : r2(cur.est_benefit);
        const status = 'status' in req.body ? (Number(req.body.status) === 0 ? 0 : 1) : cur.status;
        const note = 'note' in req.body ? (req.body.note || null) : cur.note;
        const operator = req.user?.user_id || req.body.operator_id || null;

        await pool.execute(
            `UPDATE tax_preference
                SET applicable=?, est_benefit=?, status=?, note=?, updated_by=?
              WHERE uid=?`,
            [applicable, estBenefit, status, note, operator, uid]);
        const [after] = await pool.execute('SELECT * FROM tax_preference WHERE uid=?', [uid]);
        ok(res, after[0], '登记已更新');
    } catch (err) { fail500(res, err); }
});

// 删除登记（恢复自动判定）
router.delete('/preferences/:uid', async (req, res) => {
    try {
        const uid = Number(req.params.uid);
        if (!uid) return fail(res, '参数无效');
        await pool.execute('DELETE FROM tax_preference WHERE uid=?', [uid]);
        ok(res, { uid }, '已删除，恢复自动判定');
    } catch (err) { fail500(res, err); }
});

// 风险扫描
router.post('/scan', async (req, res) => {
    try {
        const bu = String(req.body.bu_no || 'HM').toUpperCase();
        if (!BUS.includes(bu)) return fail(res, '公司别仅支持 HM/HN/SZ');
        const year = await resolveYear(bu, req.body.YYYY);
        const r = await scanBuTax(bu, { YYYY: year });
        ok(res, {
            bu_no: r.bu_no,
            YYYY: r.YYYY,
            scanned: r.scanned,
            created: r.created.length,
            suppressed: r.suppressed,
            risks: r.risks,
            errors: r.errors
        }, r.created.length ? `已生成 ${r.created.length} 条税务风险预警` : '当前无新增税务风险预警');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
