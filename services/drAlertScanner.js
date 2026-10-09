/**
 * M3-A 日報異常掃描引擎
 *
 * 純邏輯服務：不依賴排程、不直接讀時鐘（asOf 可注入，便於測試）。
 * 規則：
 *   R1 DR_MISSING_DAYS    連續應交工作日未交（threshold 起報 warning，config.danger_days 升 danger）
 *   R2 DR_DAILY_HOURS     近 2 個工作日已交日報，當日工時 >max 或 <min（無日報不適用，歸 R1）
 *   R3 DR_MONTH_HOURS_DEV 月化工時偏離個人前 N 月均值 ±threshold（當月日序 >= min_eval_day 才評估）
 *   R4 DR_DELAY_OVER      當月延誤日數 > daily_report_target.max_delays
 *   R5 DR_MONTH_UNLOCKED  月末最後一日指定時刻後，當月有日報但未鎖定（BU 摘要一條）
 *
 * 去重：dedup_key = kpi_id|bu|scope_id|period；冷卻內重複 suppressed，
 *       warning → danger 允許升級再發。
 */
const { pool } = require('../config/db');
const { sendAlertMail } = require('../utils/mailer');

const ACTIVE_LOOKBACK_DAYS = 56;   // 活躍人員：近 56 天有 USE 日報（同時覆蓋 R2 逐日視窗）

// 經理級身份（與 routes/dailyReport.js 同口徑，繁簡歸一）
const MANAGER_TYPES = ['部門主管', '高階主管', '部門經理', '部门主管', '部门经理', '高阶主管', '高价主管'];
const ADMIN_MANAGER_VALUES = ['管理員', '管理员'];

// ============ 日期工具（本地時區，與日報 report_date 口徑一致） ============
function pad2(n) { return String(n).padStart(2, '0'); }
function fmtDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function fmtYM(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
function isWeekend(d) { const w = d.getDay(); return w === 0 || w === 6; }
function lastDayOfMonth(y, m1) { return new Date(y, m1, 0).getDate(); } // m1=1..12
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

// 前一個（或第 k 個）完整月 YYYY-MM，k=1 表 asOf 上月
function shiftYM(ym, k) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 - k, 1);
    return fmtYM(d);
}

// 規則 rule_config（mysql2 多數版本已自動 parse JSON，此處做容錯）
function parseConfig(rule) {
    let cfg = rule.rule_config;
    if (cfg == null) return {};
    if (typeof cfg === 'object') return cfg;
    try { return JSON.parse(cfg) || {}; } catch { return {}; }
}

// 近 N 個「工作日」日期陣列（含 asOf 當天，若當天為工作日），由近而遠
function recentWorkdays(asOf, n) {
    const out = [];
    let d = startOfDay(asOf);
    while (out.length < n) {
        if (!isWeekend(d)) out.push(d);
        d = addDays(d, -1);
    }
    return out;
}

// R1：由 asOf 往前數連續未交工作日（遇到週末跳過不中断，遇到有日報的工作日停止）
function consecutiveMissingWorkdays(dateSet, asOf) {
    let cnt = 0;
    let d = startOfDay(asOf);
    for (let guard = 0; guard < 400; guard++) {
        if (!isWeekend(d)) {
            if (dateSet.has(fmtDate(d))) break;
            cnt++;
        }
        d = addDays(d, -1);
    }
    return cnt;
}

const levelMap = { WARN: 'warning', DANGER: 'danger' };

// ============ 資料裝載 ============
// 回傳 rules: Map<kpi_id, rule>（僅 DAILY_REPORT + status=1）
async function loadEnabledRules() {
    const [rows] = await pool.execute(
        `SELECT * FROM alert_rule WHERE alert_domain='DAILY_REPORT' AND status=1`);
    const m = new Map();
    for (const r of rows) m.set(r.kpi_id, r);
    return m;
}

// 活躍人員 + 近 ACTIVE_LOOKBACK_DAYS 逐日資料
// 回傳 Map<user_id, { user_name, depart_id, days: Map<'YYYY-MM-DD', {hours, delay}> }>
async function loadDailyWindow(bu, asOf) {
    const from = fmtDate(addDays(startOfDay(asOf), -ACTIVE_LOOKBACK_DAYS));
    const to = fmtDate(startOfDay(asOf));
    const [rows] = await pool.execute(
        `SELECT d.user_id,
                MAX(d.user_name) AS user_name,
                MAX(d.depart_id) AS depart_id,
                d.report_date AS report_date,
                ROUND(COALESCE(SUM(dt.use_time), 0), 2) AS hours,
                MAX(CASE WHEN d.projects1 IS NOT NULL AND d.projects1<>'' THEN 1 ELSE 0 END) AS has_delay
           FROM daily_report d
           LEFT JOIN daily_report_detail dt ON dt.ruid = d.id
          WHERE d.bu_no=? AND d.status1='USE' AND d.report_date BETWEEN ? AND ?
          GROUP BY d.user_id, d.report_date`,
        [bu, from, to]);
    const users = new Map();
    for (const r of rows) {
        if (!users.has(r.user_id)) {
            users.set(r.user_id, {
                user_id: r.user_id, user_name: r.user_name || r.user_id,
                depart_id: r.depart_id || '未分類',
                days: new Map()
            });
        }
        const u = users.get(r.user_id);
        u.days.set(r.report_date, { hours: Number(r.hours) || 0, delay: Number(r.has_delay) || 0 });
        // 以最近一筆部門/姓名為準（Map 走 SQL 分組順序，再用後續覆蓋）
        if (r.depart_id) u.depart_id = r.depart_id;
        if (r.user_name) u.user_name = r.user_name;
    }
    return users;
}

// 前 N 個完整月每人月總工時：Map<user_id, Map<YYYY_MM, hours>>
async function loadMonthlyHours(bu, months) {
    const ph = months.map(() => '?').join(',');
    const [rows] = await pool.execute(
        `SELECT d.user_id, d.YYYY_MM AS ym,
                ROUND(COALESCE(SUM(dt.use_time), 0), 2) AS hours
           FROM daily_report d
           LEFT JOIN daily_report_detail dt ON dt.ruid = d.id
          WHERE d.bu_no=? AND d.status1='USE' AND d.YYYY_MM IN (${ph})
          GROUP BY d.user_id, d.YYYY_MM`,
        [bu, ...months]);
    const m = new Map();
    for (const r of rows) {
        if (!m.has(r.user_id)) m.set(r.user_id, new Map());
        m.get(r.user_id).set(r.ym, Number(r.hours) || 0);
    }
    return m;
}

// 當月目標：Map<user_id, target row>
async function loadTargets(bu, ym) {
    const [rows] = await pool.execute(
        `SELECT user_id, target_hours, max_delays, max_unresolved, min_work_ratio
           FROM daily_report_target WHERE bu_no=? AND YYYY_MM=?`,
        [bu, ym]);
    return new Map(rows.map(r => [r.user_id, r]));
}

// 當月已鎖定人員集合
async function loadLockedUsers(bu, ym) {
    const [rows] = await pool.execute(
        `SELECT DISTINCT user_id FROM daily_report_lock
          WHERE bu_no=? AND YYYY_MM=? AND lock_status='LOCKED'`,
        [bu, ym]);
    return new Set(rows.map(r => r.user_id));
}

// 經理級收件人 email
async function loadManagerEmails() {
    const [rows] = await pool.execute(
        `SELECT DISTINCT email FROM cams_xuser
          WHERE email IS NOT NULL AND email<>''
            AND (admin IN (?,?) OR xuser_type IN (${MANAGER_TYPES.map(() => '?').join(',')}))`,
        [...ADMIN_MANAGER_VALUES, ...MANAGER_TYPES]);
    return rows.map(r => r.email).filter(Boolean);
}

// ============ 候選告警組裝 ============
function buildCandidates({ rules, users, monthHours, targets, locked, bu, asOf }) {
    const candidates = [];
    const stats = { insufficientHistory: 0 };
    const ym = fmtYM(asOf);
    const curY = asOf.getFullYear();
    const curM1 = asOf.getMonth() + 1;
    const monthDays = lastDayOfMonth(curY, curM1);
    const elapsedDays = asOf.getDate();
    const add = (c) => candidates.push(c);

    const r1 = rules.get('DR_MISSING_DAYS');
    const r2 = rules.get('DR_DAILY_HOURS');
    const r3 = rules.get('DR_MONTH_HOURS_DEV');
    const r4 = rules.get('DR_DELAY_OVER');
    const r5 = rules.get('DR_MONTH_UNLOCKED');

    const warnDays = r1 ? Math.max(1, Number(r1.threshold) || 3) : 3;
    const dangerDays = r1 ? Number(parseConfig(r1).danger_days) || 5 : 5;
    const cfg2 = r2 ? parseConfig(r2) : {};
    const maxH = Number(cfg2.max_hours ?? (r2 ? r2.threshold : 14)) || 14;
    const minH = Number(cfg2.min_hours ?? 2) || 2;
    const cfg3 = r3 ? parseConfig(r3) : {};
    const devPct = r3 ? Number(r3.threshold) || 0.3 : 0.3;
    const winMonths = Number(cfg3.window_months) || 6;
    const minEvalDay = Number(cfg3.min_eval_day) || 10;

    const last2 = recentWorkdays(asOf, 2).map(fmtDate);

    for (const [uid, u] of users) {
        const name = `${u.user_name}（${uid}）`;
        const dateSet = u.days;

        // ---- R1 連續未交 ----
        if (r1) {
            const miss = consecutiveMissingWorkdays(dateSet, asOf);
            if (miss >= warnDays) {
                const level = miss >= dangerDays ? 'DANGER' : 'WARN';
                add({
                    rule: r1, kpi_id: 'DR_MISSING_DAYS', level,
                    scope_type: 'USER', scope_id: uid, scope_name: name,
                    period: ym, current_value: miss, threshold_val: level === 'DANGER' ? dangerDays : warnDays,
                    title: `${level === 'DANGER' ? '🚨' : '🟡'} ${u.user_name} 已連續 ${miss} 個工作日未交日報`,
                    message: `截至 ${fmtDate(asOf)}，${name} 已連續 ${miss} 個應交工作日未繳交 USE 日報（門檻 ${warnDays} 天，danger ${dangerDays} 天）。`,
                    suggestion: '請主管儘速關切並提醒補交；若為請假，待 M6 考勤連動後自動排除。'
                });
            }
        }

        // ---- R2 單日工時異常（近 2 工作日，僅看已交） ----
        if (r2) {
            for (const ds of last2) {
                const day = dateSet.get(ds);
                if (!day) continue; // 無日報歸 R1
                if (day.hours > maxH) {
                    add({
                        rule: r2, kpi_id: 'DR_DAILY_HOURS', level: 'WARN',
                        scope_type: 'USER', scope_id: uid, scope_name: name,
                        period: `${ds}|HIGH`, current_value: day.hours, threshold_val: maxH,
                        title: `🟡 ${u.user_name} ${ds} 工時偏高 ${day.hours}h`,
                        message: `${name} ${ds} 申報工時 ${day.hours} 小時，高於上限 ${maxH} 小時，請留意負荷與填報正確性。`,
                        suggestion: '確認是否加班未記錄或時間重複登打；必要時協助分流工作。'
                    });
                } else if (day.hours < minH) {
                    add({
                        rule: r2, kpi_id: 'DR_DAILY_HOURS', level: 'WARN',
                        scope_type: 'USER', scope_id: uid, scope_name: name,
                        period: `${ds}|LOW`, current_value: day.hours, threshold_val: minH,
                        title: `🟡 ${u.user_name} ${ds} 工時偏低 ${day.hours}h`,
                        message: `${name} ${ds} 申報工時僅 ${day.hours} 小時，低於下限 ${minH} 小時。`,
                        suggestion: '確認是否有漏填項目或當日實際缺勤。'
                    });
                }
            }
        }

        // ---- R3 月度工時偏離 ----
        if (r3 && elapsedDays >= minEvalDay) {
            let mtd = 0;
            for (const [ds, v] of dateSet) {
                if (ds.slice(0, 7) === fmtDate(asOf).slice(0, 7)) mtd += v.hours;
            }
            const histMap = monthHours.get(uid);
            const histVals = [];
            for (let k = 1; k <= winMonths; k++) {
                const hv = histMap?.get(shiftYM(ym, k));
                if (hv != null) histVals.push(hv);
            }
            if (histVals.length >= 3) {
                const annualized = mtd / elapsedDays * monthDays;
                const mean = histVals.reduce((s, x) => s + x, 0) / histVals.length;
                if (mean > 0) {
                    const dev = (annualized - mean) / mean;
                    if (Math.abs(dev) >= devPct) {
                        const over = dev > 0;
                        add({
                            rule: r3, kpi_id: 'DR_MONTH_HOURS_DEV', level: 'WARN',
                            scope_type: 'USER', scope_id: uid, scope_name: name,
                            period: ym, current_value: Math.round(dev * 1000) / 10,
                            threshold_val: Math.round(devPct * 1000) / 10,
                            risk_dir: over ? 'OVER' : 'UNDER',
                            title: `🟡 ${u.user_name} 當月工時${over ? '超載' : '驟降'} ${Math.round(Math.abs(dev) * 1000) / 10}%`,
                            message: `${name} ${ym} 月化工時約 ${annualized.toFixed(1)}h，較前 ${histVals.length} 個月均值 ${mean.toFixed(1)}h ${over ? '高' : '低'} ${(Math.abs(dev) * 100).toFixed(1)}%（門檻 ±${(devPct * 100).toFixed(0)}%）。`,
                            suggestion: over ? '留意超載風險，提前調配人力。' : '關注是否工作量不足或有漏填。'
                        });
                    }
                }
            } else {
                stats.insufficientHistory++;
            }
        }

        // ---- R4 延誤筆數超限 ----
        if (r4) {
            const t = targets.get(uid);
            const maxDelays = t ? Number(t.max_delays) : null;
            if (maxDelays != null) {
                let delayCnt = 0;
                for (const [ds, v] of dateSet) {
                    if (ds.slice(0, 7) === fmtDate(asOf).slice(0, 7) && v.delay) delayCnt++;
                }
                if (delayCnt > maxDelays) {
                    add({
                        rule: r4, kpi_id: 'DR_DELAY_OVER', level: 'DANGER',
                        scope_type: 'USER', scope_id: uid, scope_name: name,
                        period: ym, current_value: delayCnt, threshold_val: maxDelays,
                        title: `🚨 ${u.user_name} 當月延誤 ${delayCnt} 筆超過上限 ${maxDelays}`,
                        message: `${name} ${ym} 已通報延誤事項 ${delayCnt} 日，超過目標上限 ${maxDelays}。`,
                        suggestion: '請主管檢視延誤原因並協助排除障礙，於月度鎖定會議追蹤。'
                    });
                }
            }
        }
    }

    // ---- R5 月底未鎖定（BU 摘要一條） ----
    if (r5) {
        const cfg5 = parseConfig(r5);
        const hour = Number(cfg5.hour ?? r5.threshold ?? 16) || 16;
        const isLastDay = asOf.getDate() === monthDays;
        const asOfMin = asOf.getHours() * 60 + asOf.getMinutes();
        if (isLastDay && asOfMin >= hour * 60) {
            const unlocked = [];
            for (const [uid, u] of users) {
                if (!locked.has(uid)) unlocked.push(u.user_name || uid);
            }
            if (unlocked.length > 0) {
                add({
                    rule: r5, kpi_id: 'DR_MONTH_UNLOCKED', level: 'WARN',
                    scope_type: 'BU', scope_id: bu, scope_name: bu,
                    period: `${ym}|MONTH_END`, current_value: unlocked.length, threshold_val: 0,
                    title: `🟡 ${bu} ${ym} 月底尚有 ${unlocked.length} 人未完成簽核鎖定`,
                    message: `${ym} 月末 ${hour}:00 提醒：${unlocked.join('、')} 尚未鎖定當月日報。`,
                    suggestion: '請主管於今日完成一鍵鎖定，確保月度績效結算口徑正確。'
                });
            }
        }
    }

    return { candidates, stats };
}

// 冷卻/升級過濾，回 {passed, suppressed}
async function applyCooldown(candidates, bu, asOf) {
    const passed = [];
    let suppressed = 0;
    if (candidates.length === 0) return { passed, suppressed };

    const keys = [...new Set(candidates.map(c => c.dedupKey))];
    // 一次撈出各 dedup_key 在各自冷卻視窗內的最近一筆（取最寬 72h 再於 JS 過濾）
    const ph = keys.map(() => '?').join(',');
    const [rows] = await pool.execute(
        `SELECT dedup_key, level, created_at FROM alert_log
          WHERE bu_no=? AND dedup_key IN (${ph})
                AND created_at >= DATE_SUB(?, INTERVAL 72 HOUR)
          ORDER BY created_at DESC`,
        [bu, ...keys, asOf]);
    const latest = new Map();
    for (const r of rows) {
        if (!latest.has(r.dedup_key)) latest.set(r.dedup_key, r);
    }

    // mysql2 多數回 Date，部分設定回字串（'YYYY-MM-DD HH:mm:ss'）→ 統一解析
    const toDate = (v) => v instanceof Date ? v
        : new Date(String(v).replace(' ', 'T'));

    for (const c of candidates) {
        const cooldownH = Number(c.rule.cooldown_hours) || 24;
        const prev = latest.get(c.dedupKey);
        if (prev) {
            const ageH = (asOf - toDate(prev.created_at)) / 3600000;
            if (ageH < cooldownH) {
                // warning→danger 允許升級
                if (c.level === 'DANGER' && prev.level === 'warning') {
                    passed.push(c);
                } else {
                    suppressed++;
                }
                continue;
            }
        }
        passed.push(c);
    }
    return { passed, suppressed };
}

// ============ 主入口 ============
/**
 * 掃描單一 BU
 * @param {string} buNo
 * @param {{asOf?:Date}} opts  asOf 預設現在；測試可注入
 * @returns {Promise<object>} 掃描回報
 */
async function scanBu(buNo, { asOf = new Date() } = {}) {
    const report = {
        bu_no: buNo, as_of: asOf.toISOString(),
        created: [], suppressed: 0, skipped_no_target: 0,
        insufficient_history: 0, emailed: 0, email_failed: 0, errors: []
    };

    try {
        const rules = await loadEnabledRules();
        if (rules.size === 0) return report;

        const ym = fmtYM(asOf);
        const users = await loadDailyWindow(buNo, asOf);

        // R3 需要前 6 完整月
        const win = Number(parseConfig(rules.get('DR_MONTH_HOURS_DEV') || {}).window_months) || 6;
        const months = [];
        for (let k = 1; k <= win; k++) months.push(shiftYM(ym, k));
        const [monthHours, targets, locked] = await Promise.all([
            loadMonthlyHours(buNo, months),
            loadTargets(buNo, ym),
            loadLockedUsers(buNo, ym)
        ]);

        // 無目標列人數（R4 跳過口径，僅供回報）
        for (const uid of users.keys()) {
            const t = targets.get(uid);
            if (!t || Number(t.max_delays) == null) report.skipped_no_target++;
        }

        const { candidates: raw, stats } = buildCandidates({ rules, users, monthHours, targets, locked, bu: buNo, asOf });
        report.insufficient_history = stats.insufficientHistory;
        const withKey = raw.map(c => ({
            ...c,
            dedupKey: `${c.kpi_id}|${buNo}|${c.scope_id}|${c.period}`
        }));

        const { passed, suppressed } = await applyCooldown(withKey, buNo, asOf);
        report.suppressed = suppressed;

        // 落地 alert_log
        for (const c of passed) {
            try {
                const [r] = await pool.execute(
                    `INSERT INTO alert_log
                        (rule_id, bu_no, kpi_id, kpi_name, current_value, threshold, level,
                         title, message, suggestion, channel, is_read, created_at,
                         alert_domain, scope_type, scope_id, scope_name, dedup_key, notify_status)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'DAILY_REPORT',?,?,?,?,'NONE')`,
                    [c.rule.uid || null, buNo, c.kpi_id, c.rule.rule_name,
                     c.current_value == null ? null : c.current_value,
                     c.threshold_val == null ? null : c.threshold_val,
                     levelMap[c.level] || 'warning',
                     c.title, c.message, c.suggestion,
                     (c.rule.notify_channel || 'inapp,email'),
                     0, asOf,
                     c.scope_type, c.scope_id, c.scope_name, c.dedupKey]);
                c.inserted_uid = r.insertId;
                report.created.push({
                    uid: r.insertId, kpi_id: c.kpi_id, level: levelMap[c.level] || 'warning',
                    scope_type: c.scope_type, scope_id: c.scope_id, scope_name: c.scope_name,
                    title: c.title, dedup_key: c.dedupKey
                });
            } catch (e) {
                report.errors.push(`${c.kpi_id}/${c.scope_id}: ${e.message}`);
            }
        }

        // 電子郵件（同 BU 聚合成一封）
        if (passed.length > 0 && String(passed[0].rule.notify_channel || '').includes('email')) {
            try {
                const recipients = await loadManagerEmails();
                if (recipients.length === 0) {
                    await markNotify(passed, 'SKIPPED');
                } else {
                    const mail = await sendAlertMail({
                        bu_no: buNo, as_of: asOf,
                        items: passed.map(c => ({
                            level: levelMap[c.level] || 'warning',
                            scope_name: c.scope_name, title: c.title,
                            message: c.message, suggestion: c.suggestion
                        })),
                        recipients
                    });
                    const status = mail.success ? 'SENT' : /SMTP/.test(mail.message || '') ? 'SKIPPED' : 'FAILED';
                    await markNotify(passed, status);
                    if (mail.success) report.emailed = 1;
                    else if (status === 'FAILED') report.email_failed = 1;
                }
            } catch (e) {
                report.errors.push(`email: ${e.message}`);
                report.email_failed = 1;
            }
        }
    } catch (e) {
        report.errors.push(`scanBu: ${e.message}`);
        console.error('[drAlertScanner]', e);
    }

    return report;
}

async function markNotify(passed, status) {
    const ids = passed.map(c => c.inserted_uid).filter(Boolean);
    if (ids.length === 0) return;
    const ph = ids.map(() => '?').join(',');
    await pool.execute(`UPDATE alert_log SET notify_status=? WHERE uid IN (${ph})`, [status, ...ids]);
}

/**
 * 掃描所有活躍 BU（排程器呼叫）
 * BU 清單：近 90 天有日報的公司別
 */
async function scanAll({ asOf = new Date() } = {}) {
    const [rows] = await pool.execute(
        `SELECT DISTINCT bu_no FROM daily_report
          WHERE report_date >= DATE_SUB(?, INTERVAL 90 DAY) AND status1='USE'`,
        [fmtDate(asOf)]);
    let bus = rows.map(r => r.bu_no).filter(Boolean);
    if (bus.length === 0) bus = ['HM'];
    const results = [];
    for (const bu of bus) {
        // 單 BU 失敗不影響其他 BU
        results.push(await scanBu(bu, { asOf }));
    }
    return { as_of: asOf.toISOString(), bus: results };
}

module.exports = {
    scanBu, scanAll,
    // 匯出純函式供單元測試
    consecutiveMissingWorkdays, recentWorkdays, buildCandidates,
    shiftYM, parseConfig, fmtDate, fmtYM, isWeekend
};
