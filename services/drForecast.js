/**
 * M3-B 工時與延誤趨勢預測（純 JS，無 ML 依賴）
 *
 * 演算法：
 *   WMA  加權移動平均（權重 i=1..n，越近越高）：f = Σ(i·y_i)/Σi
 *   LR   最小二乘線性回歸 y=a+b·t，外推 t=n+1
 *   混合 f = 0.5·WMA + 0.5·LR（algo 可切 WMA / LR）
 *   80% 信賴帶 band = 1.282·σ·√(1+1/n)，σ 由滾動一步提前殘差 RMS 估得
 *
 * 有效歷史月 ≥ 3 才預測，否則回 insufficient_data。
 */
const { pool } = require('../config/db');

const WINDOW_MONTHS = 6;
const MIN_HISTORY = 3;
const Z80 = 1.282;
const METRICS = ['HOURS', 'PER_CAPITA_HOURS', 'DELAYS', 'UNRESOLVED'];
const USER_METRICS = ['HOURS', 'DELAYS', 'UNRESOLVED'];
const INTEGER_METRICS = new Set(['DELAYS', 'UNRESOLVED']);

function pad2(n) { return String(n).padStart(2, '0'); }
function shiftYM(ym, k) {
    const [y, m] = ym.split('/').map(Number);
    const d = new Date(y, m - 1 - k, 1);
    return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}`;
}
function nextYM(ym) { return shiftYM(ym, -1); }
function round1(v) { return Math.round(v * 10) / 10; }

// 線性回歸：最小二乘配 y=a+b·t（t 起 1），回傳 t=n+1 預測
function lrForecast(vals) {
    const n = vals.length;
    if (n === 0) return null;
    if (n === 1) return vals[0];
    let st = 0, sy = 0;
    for (let i = 0; i < n; i++) { st += i + 1; sy += vals[i]; }
    const mt = st / n, my = sy / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
        num += (i + 1 - mt) * (vals[i] - my);
        den += (i + 1 - mt) ** 2;
    }
    const b = den === 0 ? 0 : num / den;
    const a = my - b * mt;
    return a + b * (n + 1);
}

function wmaForecast(vals) {
    const n = vals.length;
    if (n === 0) return null;
    let sw = 0, swv = 0;
    for (let i = 0; i < n; i++) { sw += i + 1; swv += (i + 1) * vals[i]; }
    return swv / sw;
}

// 滾動一步提前預測（用 1..t-1 預測 t），回各殘差
function rollingResiduals(vals, algo) {
    const res = [];
    for (let t = 2; t <= vals.length; t++) {
        const win = vals.slice(0, t - 1);
        let f;
        if (algo === 'WMA') f = wmaForecast(win);
        else if (algo === 'LR') f = win.length >= 2 ? lrForecast(win) : win[0];
        else f = 0.5 * wmaForecast(win) + 0.5 * (win.length >= 2 ? lrForecast(win) : win[0]);
        res.push(vals[t - 1] - f);
    }
    return res;
}

/**
 * 純函式：對單一序列做預測
 * @param {number[]} vals 由舊而新的歷史值
 * @param {string} algo WMA / LR / WMA_LR
 * @returns {{forecast,lower,upper,sigma,n}|null} n<3 回 null
 */
function forecastSeries(vals, algo = 'WMA_LR') {
    const n = vals.length;
    if (!vals || n < MIN_HISTORY) return null;
    const fw = wmaForecast(vals);
    const fl = lrForecast(vals);
    let f = algo === 'WMA' ? fw : algo === 'LR' ? fl : 0.5 * fw + 0.5 * fl;

    const resid = rollingResiduals(vals, algo);
    let sigma = 0;
    if (resid.length > 0) {
        sigma = Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / resid.length);
    }
    const band = Z80 * sigma * Math.sqrt(1 + 1 / n);
    return {
        forecast: f,
        lower: f - band,
        upper: f + band,
        sigma, n
    };
}

/**
 * 風險分級
 * @param {string} metric
 * @param {number} forecast
 * @param {number} lower
 * @param {number} upper
 * @param {number|null} base 目標基準（null 時用 histMean）
 * @param {number} histMean 訓練月均值
 */
function gradeRisk(metric, forecast, lower, upper, base, histMean) {
    const isHours = metric === 'HOURS' || metric === 'PER_CAPITA_HOURS';
    if (isHours) {
        const b = base > 0 ? base : (histMean > 0 ? histMean : null);
        if (!b) return { risk_level: 'NORMAL', risk_dir: null };
        if (upper >= 1.30 * b || lower <= 0.60 * b) {
            return { risk_level: 'DANGER', risk_dir: upper >= 1.30 * b ? 'OVER' : 'UNDER' };
        }
        if (upper >= 1.15 * b || lower <= 0.75 * b) {
            return { risk_level: 'WARN', risk_dir: upper >= 1.15 * b ? 'OVER' : 'UNDER' };
        }
        return { risk_level: 'NORMAL', risk_dir: null };
    }
    // 計數類：DELAYS / UNRESOLVED
    if (base != null) {
        if (forecast > base || base === 0 && forecast >= 1) {
            return { risk_level: 'DANGER', risk_dir: null };
        }
        if (forecast >= 0.8 * base && base > 0) {
            return { risk_level: 'WARN', risk_dir: null };
        }
        return { risk_level: 'NORMAL', risk_dir: null };
    }
    if (histMean > 0) {
        if (forecast >= 2 * histMean) return { risk_level: 'DANGER', risk_dir: null };
        if (forecast >= 1.5 * histMean) return { risk_level: 'WARN', risk_dir: null };
    }
    return { risk_level: 'NORMAL', risk_dir: null };
}

// 數值格式化（工時 1 位小時；計數非負整數）
function shapeMetric(metric, fc) {
    if (INTEGER_METRICS.has(metric)) {
        return {
            forecast_val: Math.max(0, Math.round(fc.forecast)),
            lower_bound: Math.max(0, Math.floor(fc.lower)),
            upper_bound: Math.max(0, Math.ceil(fc.upper))
        };
    }
    return {
        forecast_val: round1(fc.forecast),
        lower_bound: round1(Math.max(0, fc.lower)),
        upper_bound: round1(fc.upper)
    };
}

// ============ 資料裝載 ============
// 每人每月聚合（部門以「該月 daily_report 的 depart_id」歸屬）
// 回傳 Map<user_id, { name, monthly: Map<ym, {dept,hours,delays,unresolved}> }>
async function loadUserMonthly(bu, months) {
    const ph = months.map(() => '?').join(',');
    const [rows] = await pool.execute(
        `SELECT d.user_id,
                MAX(d.user_name) AS user_name,
                d.YYYY_MM AS ym,
                MAX(d.depart_id) AS depart_id,
                ROUND(COALESCE(SUM(dt.use_time), 0), 2) AS hours,
                COUNT(DISTINCT CASE WHEN d.projects1 IS NOT NULL AND d.projects1<>'' THEN d.report_date END) AS delays,
                COUNT(DISTINCT CASE WHEN d.projects2 IS NOT NULL AND d.projects2<>'' THEN d.report_date END) AS unresolved
           FROM daily_report d
           LEFT JOIN daily_report_detail dt ON dt.ruid = d.id
          WHERE d.bu_no=? AND d.status1='USE' AND d.YYYY_MM IN (${ph})
          GROUP BY d.user_id, d.YYYY_MM`,
        [bu, ...months]);
    const m = new Map();
    for (const r of rows) {
        if (!m.has(r.user_id)) m.set(r.user_id, { name: r.user_name || r.user_id, monthly: new Map() });
        m.get(r.user_id).monthly.set(r.ym, {
            dept: r.depart_id || '未分類',
            hours: Number(r.hours) || 0,
            delays: Number(r.delays) || 0,
            unresolved: Number(r.unresolved) || 0
        });
    }
    return m;
}

async function loadTargets(bu, ym) {
    const [rows] = await pool.execute(
        `SELECT user_id, target_hours, max_delays, max_unresolved
           FROM daily_report_target WHERE bu_no=? AND YYYY_MM=?`,
        [bu, ym]);
    return new Map(rows.map(r => [r.user_id, r]));
}

// 組裝單列結果（含風險）；資料不足回 null
function buildRow({ scopeType, scopeId, scopeName, metric, values, activeN, base, algo }) {
    const fc = forecastSeries(values, algo);
    if (!fc) return null;
    const shaped = shapeMetric(metric, fc);
    const histMean = values.reduce((s, x) => s + x, 0) / values.length;
    const risk = gradeRisk(metric, shaped.forecast_val, shaped.lower_bound, shaped.upper_bound, base, histMean);
    return {
        scope_type: scopeType, scope_id: scopeId, scope_name: scopeName, metric,
        ...shaped, ...risk, algo, history_n: activeN,
        history: INTEGER_METRICS.has(metric)
            ? values.map(v => Math.round(v))
            : values.map(v => round1(v))
    };
}

/**
 * 預測單一 BU
 * @returns {Promise<{bu_no,target_ym,algo,history_months,rows,insufficient}>}
 */
async function forecastBu(buNo, targetYm, { algo = 'WMA_LR', persist = true } = {}) {
    const months = [];
    for (let k = WINDOW_MONTHS; k >= 1; k--) months.push(shiftYM(targetYm, k));
    const [users, targets] = await Promise.all([
        loadUserMonthly(buNo, months),
        loadTargets(buNo, targetYm)
    ]);

    const rows = [];
    const insufficient = [];

    // ---- USER 範圍 ----
    for (const [uid, u] of users) {
        const activeMonths = months.filter(ym => u.monthly.has(ym));
        const series = (field) => months.map(ym => u.monthly.get(ym)?.[field] ?? 0);
        const tgt = targets.get(uid) || {};
        const spec = [
            { metric: 'HOURS', base: tgt.target_hours != null ? Number(tgt.target_hours) : null },
            { metric: 'DELAYS', base: tgt.max_delays != null ? Number(tgt.max_delays) : null },
            { metric: 'UNRESOLVED', base: tgt.max_unresolved != null ? Number(tgt.max_unresolved) : null }
        ];
        for (const s of spec) {
            if (activeMonths.length < MIN_HISTORY) {
                insufficient.push({ scope_type: 'USER', scope_id: uid, scope_name: u.name, metric: s.metric, history_n: activeMonths.length });
                continue;
            }
            const row = buildRow({
                scopeType: 'USER', scopeId: uid, scopeName: u.name, metric: s.metric,
                values: series(s.metric === 'UNRESOLVED' ? 'unresolved' : s.metric.toLowerCase()),
                activeN: activeMonths.length, base: s.base, algo
            });
            if (row) rows.push(row);
        }
    }

    // ---- DEPT 範圍（依「該月」部門歸屬聚合） ----
    const deptSet = new Set();
    for (const [, u] of users) for (const [, mo] of u.monthly) deptSet.add(mo.dept);

    // 目標月成員歸屬：取各人最後一個有效月的部門；目標基準為成員 target 加總
    const userLastDept = new Map();
    for (const [uid, u] of users) {
        let last = null;
        for (const ym of months) if (u.monthly.has(ym)) last = { ym, dept: u.monthly.get(ym).dept };
        if (last) userLastDept.set(uid, last.dept);
    }

    for (const dept of deptSet) {
        const deptHours = months.map(ym => {
            let s = 0, members = 0;
            for (const [, u] of users) {
                const mo = u.monthly.get(ym);
                if (mo && mo.dept === dept) { s += mo.hours; members++; }
            }
            return { v: s, members };
        });
        const deptDelays = months.map(ym => {
            let s = 0;
            for (const [, u] of users) {
                const mo = u.monthly.get(ym);
                if (mo && mo.dept === dept) s += mo.delays;
            }
            return s;
        });
        const deptUnresolved = months.map(ym => {
            let s = 0;
            for (const [, u] of users) {
                const mo = u.monthly.get(ym);
                if (mo && mo.dept === dept) s += mo.unresolved;
            }
            return s;
        });
        const activeN = deptHours.filter(x => x.members > 0).length;
        // 目標月在部成員
        const deptMembers = [...userLastDept.entries()].filter(([, d]) => d === dept).map(([uid]) => uid);
        let baseHours = 0, hasHoursTarget = false;
        let baseDelays = 0, hasDelaysTarget = false;
        let baseUnresolved = 0, hasUnresTarget = false;
        for (const uid of deptMembers) {
            const t = targets.get(uid);
            if (t) {
                if (t.target_hours != null) { baseHours += Number(t.target_hours); hasHoursTarget = true; }
                if (t.max_delays != null) { baseDelays += Number(t.max_delays); hasDelaysTarget = true; }
                if (t.max_unresolved != null) { baseUnresolved += Number(t.max_unresolved); hasUnresTarget = true; }
            }
        }

        if (activeN < MIN_HISTORY) {
            for (const metric of METRICS) {
                insufficient.push({ scope_type: 'DEPT', scope_id: dept, scope_name: dept, metric, history_n: activeN });
            }
            continue;
        }

        const hoursRow = buildRow({
            scopeType: 'DEPT', scopeId: dept, scopeName: dept, metric: 'HOURS',
            values: deptHours.map(x => x.v), activeN,
            base: hasHoursTarget ? baseHours : null, algo
        });
        if (hoursRow) rows.push(hoursRow);

        const capRow = buildRow({
            scopeType: 'DEPT', scopeId: dept, scopeName: dept, metric: 'PER_CAPITA_HOURS',
            values: deptHours.map(x => (x.members > 0 ? x.v / x.members : 0)), activeN,
            base: hasHoursTarget && deptMembers.length > 0 ? baseHours / deptMembers.length : null, algo
        });
        if (capRow) rows.push(capRow);

        const delayRow = buildRow({
            scopeType: 'DEPT', scopeId: dept, scopeName: dept, metric: 'DELAYS',
            values: deptDelays, activeN, base: hasDelaysTarget ? baseDelays : null, algo
        });
        if (delayRow) rows.push(delayRow);

        const unresRow = buildRow({
            scopeType: 'DEPT', scopeId: dept, scopeName: dept, metric: 'UNRESOLVED',
            values: deptUnresolved, activeN, base: hasUnresTarget ? baseUnresolved : null, algo
        });
        if (unresRow) rows.push(unresRow);
    }

    if (persist) await persistRows(buNo, targetYm, rows, algo);

    return { bu_no: buNo, target_ym: targetYm, algo, history_months: months, rows, insufficient };
}

async function persistRows(bu, targetYm, rows, algo) {
    for (const r of rows) {
        await pool.execute(
            `INSERT INTO daily_report_forecast_log
                (bu_no, target_ym, scope_type, scope_id, scope_name, metric,
                 forecast_val, lower_bound, upper_bound, risk_level, risk_dir, algo, history_n, generated_time)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())
             ON DUPLICATE KEY UPDATE
                scope_name=VALUES(scope_name), forecast_val=VALUES(forecast_val),
                lower_bound=VALUES(lower_bound), upper_bound=VALUES(upper_bound),
                risk_level=VALUES(risk_level), risk_dir=VALUES(risk_dir),
                algo=VALUES(algo), history_n=VALUES(history_n), generated_time=NOW()`,
            [bu, targetYm, r.scope_type, r.scope_id, r.scope_name, r.metric,
             r.forecast_val, r.lower_bound, r.upper_bound, r.risk_level,
             r.risk_dir || null, algo, r.history_n]);
    }
}

/**
 * 全量重算（isSenior 排程/手動用）
 */
async function runAll(buNo, targetYm, { algo = 'WMA_LR' } = {}) {
    const r = await forecastBu(buNo, targetYm, { algo, persist: true });
    return {
        bu_no: buNo, target_ym: targetYm,
        upserted: r.rows.length,
        insufficient: r.insufficient.length,
        danger: r.rows.filter(x => x.risk_level === 'DANGER').length,
        warn: r.rows.filter(x => x.risk_level === 'WARN').length
    };
}

module.exports = {
    forecastBu, runAll, forecastSeries, gradeRisk, lrForecast, wmaForecast,
    shiftYM, nextYM, WINDOW_MONTHS, MIN_HISTORY, METRICS, USER_METRICS
};
