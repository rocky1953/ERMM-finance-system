/**
 * CTO-06 指標中心路由
 *
 * 前端 / AI 問答 / 合併報表 / KPI 看板 都從這裡取指標，
 * 確保同一指碼算出的值三處一致。
 */
const express = require('express');
const router = express.Router();
const { ok, fail, fail500 } = require('../utils/response');
const metricCenter = require('../services/metricCenter');
const audit = require('../services/audit');
const { pool } = require('../config/db');

// ===== 1. 指標目錄（前端下拉 / 指標對話框）=====
router.get('/catalog', async (req, res) => {
    try {
        const { cat, group, q, table } = req.query;
        const rows = await metricCenter.list({ cat, group, q, table });
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ===== 2. 指標類別聚合 =====
router.get('/catalog/grouped', async (req, res) => {
    try {
        const rows = await metricCenter.list();
        const grouped = {};
        for (const r of rows) {
            const key = `${r.metric_cat} / ${r.metric_group}`;
            if (!grouped[key]) grouped[key] = { cat: r.metric_cat, group: r.metric_group, items: [] };
            grouped[key].items.push(r);
        }
        ok(res, Object.values(grouped));
    } catch (err) { fail500(res, err); }
});

// ===== 3. 單一指標計算 =====
// query: bu_no, YYYY_MM
// params: id = metric_code
router.get('/compute/:id', async (req, res) => {
    try {
        const { bu_no, YYYY_MM } = req.query;
        if (!bu_no || !YYYY_MM) return fail(res, '需要 bu_no + YYYY_MM');

        const [cur] = await pool.execute(
            'SELECT * FROM mgm_finance_summary WHERE bu_no=? AND YYYY_MM=?', [bu_no, YYYY_MM]);
        if (!cur[0]) return fail(res, '該月無數據', 404);

        // 上月（成長率需要）
        const [prev] = await pool.execute(
            `SELECT * FROM mgm_finance_summary WHERE bu_no=? AND YYYY_MM = DATE_FORMAT(DATE_SUB(STR_TO_DATE(?, '%Y-%m'), INTERVAL 1 MONTH), '%Y-%m')`,
            [bu_no, YYYY_MM]);

        const toNum = o => { const out = {}; for (const [k, v] of Object.entries(o)) out[k] = typeof v==='string' && /^-?\d/.test(v) && !isNaN(Number(v)) ? Number(v) : v; return out; };

        const result = await metricCenter.compute(req.params.id, toNum(cur[0]), prev[0] ? toNum(prev[0]) : null);
        ok(res, { metric_code: req.params.id, bu_no, YYYY_MM, ...result });
    } catch (err) { fail500(res, err); }
});

// ===== 4. 批量計算（指定多個指標 + 多家公司）=====
// body: { ids: ['roe','gross_margin',...], bu_nos: ['HM','HN','SZ'], YYYY_MM }
router.post('/compute-batch', async (req, res) => {
    try {
        const { ids, bu_nos, YYYY_MM } = req.body;
        if (!ids || !ids.length || !bu_nos || !bu_nos.length || !YYYY_MM)
            return fail(res, '需要 ids + bu_nos + YYYY_MM');

        const [rows] = await pool.execute(
            `SELECT * FROM mgm_finance_summary WHERE YYYY_MM=? AND bu_no IN (${bu_nos.map(()=>'?').join(',')})`,
            [YYYY_MM, ...bu_nos]);

        const results = await metricCenter.computeGrouped(ids, rows);
        ok(res, results);
    } catch (err) { fail500(res, err); }
});

// ===== 5. 合併層級指標（先加總多家公司折算後的數，再算比率）=====
// body: { ids: ['consol_gross_margin','consol_roe',...], bu_nos, YYYY_MM, rateType }
router.post('/compute-consolidated', async (req, res) => {
    try {
        const { ids, bu_nos, YYYY_MM, rateType = 'AVG' } = req.body;
        if (!ids || !bu_nos || !YYYY_MM) return fail(res, '缺少參數');

        // 先讀取 summary，調用 consolidation service 做折算
        const consolSrvc = require('../services/consolidation');
        const [rawRows] = await pool.execute(
            `SELECT * FROM mgm_finance_summary WHERE YYYY_MM=? AND bu_no IN (${bu_nos.map(()=>'?').join(',')})`,
            [YYYY_MM, ...bu_nos]);
        const { rows, base_currency, rateBreakdown } = await consolSrvc.translateRows(YYYY_MM, rawRows, rateType);

        // 上月
        const prevMM = new Date(YYYY_MM);
        prevMM.setMonth(prevMM.getMonth() - 1);
        const prevYYYY_MM = `${prevMM.getFullYear()}-${String(prevMM.getMonth()+1).padStart(2,'0')}`;
        const [prevRaw] = await pool.execute(
            `SELECT * FROM mgm_finance_summary WHERE YYYY_MM=? AND bu_no IN (${bu_nos.map(()=>'?').join(',')})`,
            [prevYYYY_MM, ...bu_nos]);
        const prevTranslated = prevRaw.length
            ? (await consolSrvc.translateRows(prevYYYY_MM, prevRaw, rateType)).rows : [];

        const batch = await metricCenter.computeConsolidated(ids, rows, prevTranslated);

        ok(res, {
            YYYY_MM, bu_nos, base_currency, rate_type: rateType, rate_breakdown: rateBreakdown,
            consolidated_rows: rows.map(r => ({ bu_no: r.bu_no, sale_amt: r.sale_amt, ttl_asset_amt: r.ttl_asset_amt, net_profit_amt: r.net_profit_amt })),
            metrics: batch
        });
    } catch (err) { fail500(res, err); }
});

// ===== 6. 數據血緣追溯 =====
router.get('/lineage/:id', async (req, res) => {
    try {
        const data = await metricCenter.lineage(req.params.id);
        ok(res, data);
    } catch (err) { fail500(res, err); }
});

// ===== 7. 口徑對比（管理員工具）=====
// 對比同一指標在兩種上下文（公司A vs 公司B / 不同月份 / 舊公式 vs 新公式）
// body: { metric_id, context_a: {bu_no, YYYY_MM}, context_b: {bu_no, YYYY_MM} }
router.post('/compare', async (req, res) => {
    try {
        const { metric_id, context_a, context_b } = req.body;
        if (!metric_id || !context_a || !context_b) return fail(res, '需要 metric_id + context_a + context_b');

        async function getVal(ctx) {
            const [rows] = await pool.execute(
                'SELECT * FROM mgm_finance_summary WHERE bu_no=? AND YYYY_MM=?',
                [ctx.bu_no, ctx.YYYY_MM]);
            if (!rows[0]) return null;
            const toN = o => { const out={}; for(const[k,v] of Object.entries(o)) out[k]=typeof v==='string'&&/^-?\d/.test(v)?Number(v):v; return out; };
            const { value } = await metricCenter.compute(metric_id, toN(rows[0]), null);
            return value;
        }

        const a = await getVal(context_a);
        const b = await getVal(context_b);
        const cmp = metricCenter.compareMetricValues(metric_id, a, b);

        ok(res, {
            metric_id,
            context_a: { ...context_a, value: a },
            context_b: { ...context_b, value: b },
            ...cmp
        });
    } catch (err) { fail500(res, err); }
});

// ===== 8. 管理員 CRUD：查 + 增 + 改 =====
router.get('/def/:id', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM cams_metric_def WHERE metric_code=?', [req.params.id]);
        if (!rows[0]) return fail(res, '指標不存在', 404);
        const r = rows[0];
        ok(res, { ...r, source_fields: r.source_fields ? JSON.parse(r.source_fields) : [] });
    } catch (err) { fail500(res, err); }
});

router.post('/def', async (req, res) => {
    try {
        const m = req.body;
        if (!m.metric_code || !m.metric_name || !m.formula_js) return fail(res, '缺少必要字段', 400);

        // 先驗證公式能編譯 + 執行
        try {
            // eslint-disable-next-line no-new-func
            const fn = new Function('s', 'p', `'use strict'; return (${m.formula_js});`);
            const test = fn({ sale_amt: 100, sale_cost_amt: 60 }, null);
            if (typeof test !== 'number' && test !== null && test !== undefined) {
                return fail(res, '公式返回值必須是數字或 null', 400);
            }
        } catch (e) {
            return fail(res, `公式語法錯: ${e.message}`, 400);
        }

        const [existing] = await pool.execute('SELECT id FROM cams_metric_def WHERE metric_code=?', [m.metric_code]);
        if (existing[0]) return fail(res, '指標碼已存在', 409);

        await pool.execute(
            `INSERT INTO cams_metric_def
             (metric_code, metric_name, metric_cat, metric_group, formula_js, formula_desc,
              unit, pct_type, source_table, source_fields, source_filter,
              benchmark_enabled, light_enabled, inuse_flag)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [m.metric_code, m.metric_name, m.metric_cat || '自訂', m.metric_group || '自訂',
             m.formula_js, m.formula_desc || '',
             m.unit || '', m.pct_type || 'desc', m.source_table || 'mgm_finance_summary',
             JSON.stringify(m.source_fields || []), m.source_filter || null,
             m.benchmark_enabled ?? 1, m.light_enabled ?? 1, m.inuse_flag ?? 1]);

        audit.log(req, { module: 'metricCenter', action: 'CREATE',
            businessType: 'METRIC-DEF', businessId: m.metric_code,
            summary: `新增指標 ${m.metric_code} (${m.metric_name})`,
            detail: m });

        ok(res, null, '已新增');
    } catch (err) { fail500(res, err); }
});

router.put('/def/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const m = req.body;
        const [old] = await pool.execute('SELECT * FROM cams_metric_def WHERE metric_code=?', [id]);
        if (!old[0]) return fail(res, '指標不存在', 404);

        // 公式改動才驗證
        if (m.formula_js && m.formula_js !== old[0].formula_js) {
            try {
                // eslint-disable-next-line no-new-func
                new Function('s', 'p', `'use strict'; return (${m.formula_js});`);
            } catch (e) {
                return fail(res, `公式語法錯: ${e.message}`, 400);
            }
        }

        const updates = [];
        const values = [];
        const fields = ['metric_name','metric_cat','metric_group','formula_js','formula_desc',
            'unit','pct_type','source_table','source_filter','benchmark_enabled','light_enabled','inuse_flag'];
        for (const f of fields) {
            if (m[f] !== undefined) { updates.push(`${f}=?`); values.push(m[f]); }
        }
        if (m.source_fields !== undefined) {
            updates.push('source_fields=?'); values.push(JSON.stringify(m.source_fields || []));
        }
        updates.push('version=version+1', 'update_time=NOW()');
        values.push(id);

        await pool.execute(`UPDATE cams_metric_def SET ${updates.join(',')} WHERE metric_code=?`, values);
        metricCenter.invalidateCache(id);

        audit.log(req, { module: 'metricCenter', action: 'UPDATE',
            businessType: 'METRIC-DEF', businessId: id,
            summary: `更新指標 ${id} (版本+1)`, before: old[0], after: m });

        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

// ===== 9. 快取失效（管理員改公式後手動清）=====
router.post('/invalidate', async (req, res) => {
    try {
        const { metric_code } = req.body;
        metricCenter.invalidateCache(metric_code);
        ok(res, null, metric_code ? `已清除 ${metric_code} 快取` : '已清除全部快取');
    } catch (err) { fail500(res, err); }
});

module.exports = router;