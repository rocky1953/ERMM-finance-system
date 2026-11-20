/**
 * CEO-01 目标偏差自动预警
 *
 * 扫描当年度启用目标的最近一期进度，达成率低于阈值（默认 80%）即视为偏差：
 * 1. 写入 alert_log（行业务看板「重大事项」会自动带出）
 * 2. 通过 CTO-07 notifier 按订阅规则外发（event_type=ALERT, event_cat=STRATEGY）
 * 3. 同一目标 + 期间在冷却期内只告警一次，避免重复轰炸
 *
 * 由 scheduler 每日 08:00 触发，也可由 /api/strategy/alerts/scan 手动触发。
 */
const { pool } = require('../config/db');
const notifier = require('./notifier');
const {
    latestYear, loadObjectives, loadLatestProgress, buildRows
} = require('./bsc');

const DEFAULT_THRESHOLD = 80;
const DEFAULT_COOLDOWN_HOURS = 72;

const PERSPECTIVE_SUGGESTION = {
    FINANCIAL: '复核收入、成本与费用结构，评估资源投入是否需要调整。',
    CUSTOMER: '检视客户结构、满意度与交付履约情况，制定改善行动。',
    PROCESS: '检视流程周期与瓶颈环节，明确责任人与完成时限。',
    LEARNING: '检视人员能力与培训计划，补足关键岗位能力缺口。'
};

const n = (v) => Number(v || 0);
const r2 = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.round((x + Number.EPSILON) * 100) / 100 : 0;
};

function fmtVal(v, unit) {
    if (v === null || v === undefined) return '-';
    const s = r2(v).toLocaleString('zh-CN');
    return unit ? `${s}${unit}` : s;
}

function clampInt(v, lo, hi, dft) {
    const x = Number(v);
    if (!Number.isFinite(x)) return dft;
    return Math.min(hi, Math.max(lo, Math.round(x)));
}

/**
 * 扫描目标偏差
 * @param {object} opts
 * @param {string} opts.YYYY            年度，缺省取最新年度
 * @param {number} opts.threshold       达成率阈值（%），默认 80
 * @param {number} opts.cooldownHours   同一目标冷却小时数，默认 72
 * @param {string} opts.bu_no           仅扫描指定公司（GROUP/HM/HN/SZ），缺省全部
 */
async function scanTargets({ YYYY, threshold, cooldownHours, bu_no } = {}) {
    const year = /^\d{4}$/.test(String(YYYY || '')) ? String(YYYY) : await latestYear();
    const limit = clampInt(threshold, 1, 120, DEFAULT_THRESHOLD);
    const cooldown = clampInt(cooldownHours, 1, 720, DEFAULT_COOLDOWN_HOURS);
    const bu = ['GROUP', 'HM', 'HN', 'SZ'].includes(String(bu_no || '').toUpperCase())
        ? String(bu_no).toUpperCase() : '';

    const result = {
        YYYY: year, threshold: limit, cooldown_hours: cooldown,
        scanned: 0, triggered: 0, suppressed: 0, created: [], errors: []
    };

    try {
        const [objectives, latestMap] = await Promise.all([
            loadObjectives(year, bu),
            loadLatestProgress(year)
        ]);
        const rows = buildRows(objectives, latestMap);
        result.scanned = rows.length;

        for (const row of rows) {
            if (row.achievement === null || row.achievement >= limit) continue;

            const period = row.period || year;
            const dedupKey = `BSC|${row.objective_id}|${period}`;
            const [dup] = await pool.execute(
                `SELECT uid FROM alert_log WHERE dedup_key=?
                  AND created_at >= DATE_SUB(NOW(), INTERVAL ${cooldown} HOUR) LIMIT 1`,
                [dedupKey]);
            if (dup.length) { result.suppressed++; continue; }

            const level = row.achievement < 60 ? 'danger' : 'warning';
            const buNo = row.bu_no || 'GROUP';
            const gapText = row.gap === null ? '' :
                `，缺口 ${fmtVal(Math.abs(row.gap), row.unit)}${row.gap_pct === null ? '' : `（${row.gap_pct}%）`}`;
            const title = `⚠️ 目标偏差预警：${row.objective_name}`;
            const message = `${buNo} ${period} 达成率 ${row.achievement}%（阈值 ${limit}%），`
                + `目标 ${fmtVal(row.target_value, row.unit)}，实际 ${fmtVal(row.actual_value, row.unit)}${gapText}`;
            const suggestion = PERSPECTIVE_SUGGESTION[row.perspective]
                || '请至战略目标页检视偏差原因并制定改善行动。';

            const [ins] = await pool.execute(
                `INSERT INTO alert_log
                    (rule_id, bu_no, kpi_id, kpi_name, current_value, threshold, level,
                     title, message, suggestion, channel, alert_domain, dedup_key, notify_status)
                 VALUES (0,?,?,?,?,?,?,?,?,?,'inapp','STRATEGY',?, 'PENDING')`,
                [buNo, row.kpi_id || null, row.metric_name || row.objective_name,
                 row.actual_value, limit, level, title, message, suggestion, dedupKey]);

            notifier.send({
                event_type: 'ALERT',
                event_cat: 'STRATEGY',
                title,
                body: `${message}\n建议：${suggestion}`,
                level: level === 'danger' ? 'HIGH' : 'MEDIUM',
                bu_no: buNo === 'GROUP' ? null : buNo,
                storeLog: false
            }).catch(e => console.error('[bscAlertScanner] notifier.send error:', e.message));

            result.triggered++;
            result.created.push({
                uid: ins.insertId,
                objective_id: row.objective_id,
                objective_name: row.objective_name,
                bu_no: buNo,
                perspective: row.perspective,
                period,
                achievement: row.achievement,
                target_value: row.target_value,
                actual_value: row.actual_value,
                gap: row.gap,
                level
            });
        }
    } catch (e) {
        result.errors.push(e.message);
    }

    return result;
}

module.exports = { scanTargets, DEFAULT_THRESHOLD, DEFAULT_COOLDOWN_HOURS };
