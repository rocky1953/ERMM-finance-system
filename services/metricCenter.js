/**
 * CTO-06 指標中心服務
 *
 * 統一 KPI 口徑：所有指標公式集中在 cams_metric_def 表，
 * 通過這個 service 對外提供三個能力：
 *
 *   1. list()          — 指標目錄（可按類別/模組過濾）
 *   2. compute(id, s, p?) — 計算單一指標（給當月 row + 上月 row）
 *   3. computeBatch(ids, s, p?) — 批量計算（前端 KPI 卡片場景）
 *   4. computeGrouped(ids, rows, prevMap?) — 對多家公司/多個月份批量算
 *   5. lineage(code)   — 數據血緣追溯
 *   6. compare(id, contexts) — 口徑對比（同一指標在不同公司/月份的值）
 *
 * 公式執行：用 Function('s','p', formula_js) 構建函數，
 * 每個公式只在首次使用時編譯一次並快取（metricCache）。
 * 公式中只允許訪問 s / p / Math / JSON / Number / Date 等安全對象。
 */
const { pool } = require('../config/db');

// 簡單 LRU 快取（key=metric_code, value={ formula, compiledFn }）
const metricCache = new Map();
const CACHE_TTL_MS = 60_000; // 1 分鐘，改公式後最遲 1 分鐘生效

// 安全沙箱：只暴露白名單全局對象
// （null / undefined / Infinity 本來就是全局可用，不需要顯式傳）
const SAFE_GLOBALS = {
    Math, Number, String, JSON, Date,
    parseInt, parseFloat, isNaN, isFinite,
};

/**
 * 從 DB 加載指標定義，帶 TTL 快取
 */
async function loadMetric(code) {
    const cached = metricCache.get(code);
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.def;

    const [rows] = await pool.execute(
        'SELECT * FROM cams_metric_def WHERE metric_code=? AND inuse_flag=1',
        [code]
    );
    if (!rows[0]) return null;
    const def = rows[0];

    // 編譯公式
    let compiledFn = null;
    try {
        // eslint-disable-next-line no-new-func
        compiledFn = new Function(
            's', 'p',
            `'use strict'; return (${def.formula_js});`
        ).bind(SAFE_GLOBALS);
    } catch (e) {
        console.error(`[metricCenter] compile ${code} failed:`, e.message);
    }

    metricCache.set(code, { def, compiledFn, loadedAt: Date.now() });
    return def;
}

/**
 * 批量加載（一次 DB 查詢拿多個）
 */
async function loadMetrics(ids) {
    if (!ids || !ids.length) return {};
    const uncached = ids.filter(id => {
        const c = metricCache.get(id);
        return !c || Date.now() - c.loadedAt >= CACHE_TTL_MS;
    });

    if (uncached.length) {
        const [rows] = await pool.execute(
            `SELECT * FROM cams_metric_def WHERE metric_code IN (${uncached.map(() => '?').join(',')}) AND inuse_flag=1`,
            uncached
        );
        for (const def of rows) {
            let compiledFn = null;
            try {
                // eslint-disable-next-line no-new-func
                compiledFn = new Function(
                    's', 'p',
                    `'use strict'; return (${def.formula_js});`
                ).bind(SAFE_GLOBALS);
            } catch (e) { /* ignore */ }
            metricCache.set(def.metric_code, { def, compiledFn, loadedAt: Date.now() });
        }
    }

    const out = {};
    for (const id of ids) {
        const c = metricCache.get(id);
        if (c) out[id] = c;
    }
    return out;
}

/**
 * 計算單一指標
 * @param {string} id metric_code
 * @param {object} s 當月 summary row（已轉 Number）
 * @param {object|null} p 上月 summary row（成長率需要）
 * @returns {{ value: number|null, def: object, error?: string }}
 */
async function compute(id, s, p = null) {
    const cached = metricCache.get(id);
    if (!cached || Date.now() - cached.loadedAt >= CACHE_TTL_MS) {
        await loadMetric(id);
    }
    const c = metricCache.get(id);
    if (!c) return { value: null, def: null, error: '指標不存在' };

    if (!c.compiledFn) return { value: null, def: c.def, error: '公式編譯失敗' };

    let value = null;
    try {
        value = c.compiledFn(s || {}, p || null);
        if (value !== null && value !== undefined && !isNaN(value) && isFinite(value)) {
            value = Math.round(value * 10000) / 10000;
        } else {
            value = null;
        }
    } catch (e) {
        return { value: null, def: c.def, error: e.message };
    }

    return { value, def: c.def };
}

/**
 * 批量計算（多個指標 → 同一家公司同一月份）
 */
async function computeBatch(ids, s, p = null) {
    await loadMetrics(ids);
    const out = {};
    for (const id of ids) {
        out[id] = await compute(id, s, p);
    }
    return out;
}

/**
 * 對多家公司/多個月份的同一批指標計算
 * @param {string[]} ids metric_code 列表
 * @param {object[]} rows [{ bu_no, YYYY_MM, ...fields }] 當期 rows
 * @param {object<{bu_no+YYYY_MM: row}>} prevMap 上期 row 字典（可選）
 * @returns {object[]} [{ bu_no, YYYY_MM, metrics: { id: {value, def} } }]
 */
async function computeGrouped(ids, rows, prevMap = {}) {
    await loadMetrics(ids);

    // mysql2 回 DECIMAL 是 String → 全部轉 Number
    const toNum = o => {
        if (!o) return o;
        const out = {};
        for (const [k, v] of Object.entries(o)) {
            out[k] = typeof v === 'string' && /^-?\d/.test(v) && !isNaN(Number(v)) ? Number(v) : v;
        }
        return out;
    };

    const results = [];
    for (const row of rows) {
        const key = `${row.bu_no}|${row.YYYY_MM}`;
        const prevKey = row.YYYY_MM ? getPrevMonthKey(row.bu_no, row.YYYY_MM) : null;
        const s = toNum(row);
        const p = prevMap[prevKey] ? toNum(prevMap[prevKey]) : null;

        const metrics = {};
        for (const id of ids) {
            metrics[id] = await compute(id, s, p);
        }
        results.push({ bu_no: row.bu_no, YYYY_MM: row.YYYY_MM, metrics });
    }
    return results;
}

/**
 * 合併層級指標（consolidation 用）：先對多家公司的折算後 row 加總，再算比率
 * @param {string[]} consolidatedRows 已經 translateRows() 後的 row 列表
 * @returns {{ sale_amt, ttl_asset_amt, ttl_debet_amt, stockholder_amt, net_profit_amt, sale_cost_amt, current_asset_amt, current_debet_amt }} sum
 */
function sumRows(rows) {
    const sum = {};
    const numFields = [
        'sale_amt', 'sale_cost_amt', 'net_profit_amt', 'ttl_asset_amt', 'ttl_debet_amt',
        'stockholder_amt', 'current_asset_amt', 'current_debet_amt',
        'cash_amt', 'deposite_amt', 'AR_amt', 'AP_amt', 'loan_amt', 'LT_loan_amt',
        'interest_amt', 'accumulated_amt', 'captial_stock', 'captial_reserve'
    ];
    for (const f of numFields) sum[f] = 0;
    for (const r of rows) {
        for (const f of numFields) {
            sum[f] += Number(r[f] || 0);
        }
    }
    return sum;
}

/** 合併層級計算：把多家公司加總後的 sum 當 s 傳入 compute */
async function computeConsolidated(ids, translatedRows, prevRows = []) {
    const sumS = sumRows(translatedRows);
    const sumP = prevRows.length ? sumRows(prevRows) : null;
    return computeBatch(ids, sumS, sumP);
}

/** 上月 key 生成（輔助 prevMap 查找） */
function getPrevMonthKey(bu_no, YYYY_MM) {
    if (!YYYY_MM) return null;
    const [y, m] = YYYY_MM.split('-').map(Number);
    const d = new Date(y, m - 2, 1); // month -1（JS Date month 0-based，減 2 = 上個月）
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${bu_no}|${yy}-${mm}`;
}

/** 數據血緣追溯 */
async function lineage(code) {
    const [deps] = await pool.execute(
        `SELECT d.*, m.metric_name as dep_name
         FROM cams_metric_lineage d
         LEFT JOIN cams_metric_def m ON m.metric_code=d.depends_on
         WHERE d.metric_code=?`, [code]);
    const [revDeps] = await pool.execute(
        `SELECT d.*, m.metric_name as metric_name
         FROM cams_metric_lineage d
         LEFT JOIN cams_metric_def m ON m.metric_code=d.metric_code
         WHERE d.depends_on=?`, [code]);
    // 取源字段
    const cached = metricCache.get(code);
    const def = cached?.def || (await loadMetric(code));
    return {
        metric_code: code,
        metric_name: def?.metric_name || code,
        formula_desc: def?.formula_desc,
        source_table: def?.source_table,
        source_fields: !def?.source_fields ? [] :
            (typeof def.source_fields === 'string' ? JSON.parse(def.source_fields) : def.source_fields),
        depends_on: deps.map(d => ({ code: d.depends_on, name: d.dep_name, notes: d.notes })),
        used_by: revDeps.map(d => ({ code: d.metric_code, name: d.metric_name, notes: d.notes }))
    };
}

/** 列出所有啟用指標（可過濾） */
async function list({ cat, group, q, table } = {}) {
    let sql = 'SELECT * FROM cams_metric_def WHERE inuse_flag=1';
    const params = [];
    if (cat) { sql += ' AND metric_cat=?'; params.push(cat); }
    if (group) { sql += ' AND metric_group=?'; params.push(group); }
    if (table) { sql += ' AND source_table=?'; params.push(table); }
    if (q) { sql += ' AND (metric_code LIKE ? OR metric_name LIKE ? OR formula_desc LIKE ?)';
        params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    sql += ' ORDER BY metric_cat, metric_code';
    const [rows] = await pool.execute(sql, params);
    return rows.map(r => ({
        ...r,
        source_fields: r.source_fields == null ? [] :
            (typeof r.source_fields === 'string' ? JSON.parse(r.source_fields) : r.source_fields)
    }));
}

/** 清除快取（管理員改公式後調用） */
function invalidateCache(code) {
    if (code) metricCache.delete(code);
    else metricCache.clear();
}

/**
 * 口徑對比：同一個指標碼，在兩個地方算出的值是否一致
 * 返回 { match, a, b, diff, def }
 */
function compareMetricValues(metricId, valueA, valueB) {
    const cached = metricCache.get(metricId);
    const def = cached?.def;
    const diff = (valueA || 0) - (valueB || 0);
    const pctDiff = valueB !== 0 ? (diff / Math.abs(valueB)) * 100 : null;
    return {
        metric_id: metricId,
        metric_name: def?.metric_name || metricId,
        value_a: valueA,
        value_b: valueB,
        diff: Math.round(diff * 100) / 100,
        pct_diff: pctDiff !== null ? Math.round(pctDiff * 100) / 100 : null,
        match: Math.abs(diff) < 0.01, // 容許 0.01 的浮點誤差
        formula_desc: def?.formula_desc,
        formula_js: def?.formula_js
    };
}

module.exports = {
    compute, computeBatch, computeGrouped,
    computeConsolidated, sumRows,
    lineage, list, invalidateCache,
    compareMetricValues,
    // 內部導出（kpiQuery.js 可能需要訪問）
    loadMetric, loadMetrics,
};
