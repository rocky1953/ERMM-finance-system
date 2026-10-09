/**
 * M3 異常告警 + 工時/延誤趨勢預測 — 整合測試（文件第八章 18 例 + 1 回測）
 *
 * M3-A（10 例）：規則 API 權限/不可變欄位/審計、R1~R5 掃描、冷卻去重與升級、as_of 注入
 * M3-B（8 例）：forecastSeries 純算法、資料不足/UPSERT、整數區間、風險分級、API 權限、郵件 HTML
 * 回測：HM 2025/03–08 訓練預測 09，HOURS MAPE 平均 ≤ 25%
 *
 * 為避免測試對真實經理發信，beforeAll 將 5 條規則 notify_channel 暫改 'inapp'，afterAll 還原。
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const { request, app, pool } = require('./setup');
const fc = require('../services/drForecast');
const scanner = require('../services/drAlertScanner');
const { buildReportHtml } = require('../utils/mailer');

const BU = 'TEST';
const DEPT = '測試部';
const MGR = 'TEST_DR_MGR';   // 管理員 → isManager + isSenior
const SUP = 'TEST_DR_SUP';   // 部門主管 → isManager、非 isSenior
const EMP = 'TEST_DR_EMP';   // 一般員工
const RULES = '/api/alert/daily-rules';
const SCAN = '/api/alert/daily-scan/run';
const FC_API = '/api/daily-report/efficiency-forecast';

// ============ 建表（冪等；含 M3 新欄位完整結構） ============
async function ensureTables() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS daily_report (
            id INT AUTO_INCREMENT PRIMARY KEY,
            bu_no VARCHAR(10) NOT NULL,
            depart_id VARCHAR(100) DEFAULT NULL,
            user_id VARCHAR(50) NOT NULL,
            user_name VARCHAR(100) DEFAULT '',
            report_date CHAR(10) NOT NULL,
            projects1 VARCHAR(500) DEFAULT NULL,
            projects2 VARCHAR(500) DEFAULT NULL,
            status1 CHAR(10) NOT NULL DEFAULT 'USE',
            YYYY INT DEFAULT NULL,
            YYYY_MM CHAR(7) DEFAULT NULL,
            ruid INT DEFAULT NULL,
            create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_bu_user_date (bu_no, user_id, report_date),
            INDEX idx_bu_ym (bu_no, YYYY_MM)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS daily_report_detail (
            id INT AUTO_INCREMENT PRIMARY KEY,
            bu_no VARCHAR(10) NOT NULL,
            depart_id VARCHAR(100) DEFAULT NULL,
            user_id VARCHAR(50) NOT NULL,
            user_name VARCHAR(100) DEFAULT '',
            report_date CHAR(10) NOT NULL,
            from_time CHAR(5) DEFAULT NULL,
            to_time CHAR(5) DEFAULT NULL,
            use_time DECIMAL(10,2) DEFAULT 0.00,
            projects VARCHAR(500) DEFAULT NULL,
            wk_type VARCHAR(20) DEFAULT NULL,
            YYYY_MM CHAR(7) DEFAULT NULL,
            complete_time DATETIME DEFAULT NULL,
            YYYY INT DEFAULT NULL,
            ruid INT DEFAULT NULL,
            actual_date CHAR(10) DEFAULT NULL,
            client_id VARCHAR(50) DEFAULT NULL,
            items_id VARCHAR(50) DEFAULT NULL,
            INDEX idx_ruid (ruid), INDEX idx_bu_ym (bu_no, YYYY_MM)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS daily_report_target (
            id INT AUTO_INCREMENT PRIMARY KEY,
            bu_no VARCHAR(10) NOT NULL,
            user_id VARCHAR(50) NOT NULL,
            YYYY_MM CHAR(7) NOT NULL,
            target_hours DECIMAL(8,2) DEFAULT NULL,
            max_delays INT DEFAULT NULL,
            max_unresolved INT DEFAULT NULL,
            min_work_ratio INT DEFAULT NULL,
            set_by VARCHAR(50) NOT NULL,
            set_by_name VARCHAR(100) DEFAULT '',
            set_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            remark VARCHAR(500) DEFAULT NULL,
            UNIQUE KEY uk_bu_user_ym (bu_no, user_id, YYYY_MM)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS daily_report_lock (
            id INT AUTO_INCREMENT PRIMARY KEY,
            bu_no VARCHAR(10) NOT NULL,
            user_id VARCHAR(50) NOT NULL,
            YYYY_MM CHAR(7) NOT NULL,
            lock_status CHAR(10) NOT NULL DEFAULT 'LOCKED',
            locked_by VARCHAR(50) NOT NULL,
            locked_by_name VARCHAR(100) DEFAULT '',
            locked_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            unlocked_by VARCHAR(50) DEFAULT NULL,
            unlocked_by_name VARCHAR(100) DEFAULT NULL,
            unlocked_time DATETIME DEFAULT NULL,
            unlock_reason VARCHAR(500) DEFAULT NULL,
            UNIQUE KEY uk_bu_user_ym (bu_no, user_id, YYYY_MM)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS daily_report_audit_log (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            bu_no VARCHAR(10) NOT NULL,
            ruid INT DEFAULT NULL,
            report_date CHAR(10) DEFAULT NULL,
            target_user_id VARCHAR(50) NOT NULL,
            target_user_name VARCHAR(100) DEFAULT '',
            YYYY_MM CHAR(7) DEFAULT NULL,
            action VARCHAR(20) NOT NULL,
            operator_id VARCHAR(50) NOT NULL,
            operator_name VARCHAR(100) DEFAULT '',
            operator_ip VARCHAR(64) DEFAULT '',
            old_data JSON DEFAULT NULL,
            new_data JSON DEFAULT NULL,
            remark VARCHAR(500) DEFAULT NULL,
            created_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_action (action)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS alert_rule (
            uid INT AUTO_INCREMENT PRIMARY KEY,
            rule_name VARCHAR(100) NOT NULL,
            bu_no VARCHAR(10) DEFAULT NULL,
            kpi_id VARCHAR(50) NOT NULL,
            cond VARCHAR(10) NOT NULL DEFAULT 'lt',
            threshold DECIMAL(18,4) NOT NULL DEFAULT 0,
            notify_channel VARCHAR(200) DEFAULT 'email',
            notify_user VARCHAR(200) DEFAULT NULL,
            cooldown_hours INT DEFAULT 24,
            status TINYINT DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            alert_domain VARCHAR(20) NOT NULL DEFAULT 'FINANCE',
            scope_type VARCHAR(10) DEFAULT NULL,
            rule_config JSON DEFAULT NULL,
            INDEX idx_domain_status (alert_domain, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS alert_log (
            uid INT AUTO_INCREMENT PRIMARY KEY,
            rule_id INT DEFAULT NULL,
            bu_no VARCHAR(10) DEFAULT NULL,
            kpi_id VARCHAR(50) DEFAULT NULL,
            kpi_name VARCHAR(100) DEFAULT NULL,
            current_value DECIMAL(18,4) DEFAULT NULL,
            threshold DECIMAL(18,4) DEFAULT NULL,
            level VARCHAR(20) DEFAULT 'warning',
            title VARCHAR(200) DEFAULT NULL,
            message TEXT,
            suggestion TEXT,
            channel VARCHAR(50) DEFAULT 'email',
            is_read TINYINT DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            alert_domain VARCHAR(20) NOT NULL DEFAULT 'FINANCE',
            scope_type VARCHAR(50) DEFAULT NULL,
            scope_id VARCHAR(50) DEFAULT NULL,
            scope_name VARCHAR(100) DEFAULT NULL,
            dedup_key VARCHAR(160) DEFAULT NULL,
            notify_status VARCHAR(10) NOT NULL DEFAULT 'NONE',
            INDEX idx_dedup_time (dedup_key, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS daily_report_forecast_log (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            bu_no VARCHAR(20) NOT NULL,
            target_ym CHAR(7) NOT NULL,
            scope_type VARCHAR(10) NOT NULL,
            scope_id VARCHAR(50) NOT NULL,
            scope_name VARCHAR(100) DEFAULT NULL,
            metric VARCHAR(20) NOT NULL,
            forecast_val DECIMAL(12,2) NOT NULL,
            lower_bound DECIMAL(12,2) DEFAULT NULL,
            upper_bound DECIMAL(12,2) DEFAULT NULL,
            risk_level VARCHAR(10) DEFAULT 'NORMAL',
            risk_dir VARCHAR(10) DEFAULT NULL,
            algo VARCHAR(20) DEFAULT 'WMA_LR',
            history_n INT DEFAULT 0,
            generated_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uk_target_scope_metric (bu_no, target_ym, scope_type, scope_id, metric)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}

// ============ 資料種子工具 ============
async function seedReport(o) {
    const ym = o.date.slice(0, 7).replace('-', '/');
    const y = Number(o.date.slice(0, 4));
    const [r] = await pool.execute(`
        INSERT INTO daily_report
            (bu_no, depart_id, user_id, user_name, report_date, projects1, projects2, status1, YYYY, YYYY_MM)
        VALUES (?,?,?,?,?,?,?,?,?,?)
    `, [o.bu, o.dept, o.uid, o.uname, o.date, o.p1 || null, o.p2 || null, 'USE', y, ym]);
    const id = r.insertId;
    await pool.execute('UPDATE daily_report SET ruid=? WHERE id=?', [id, id]);
    for (const d of o.details || []) {
        await pool.execute(`
            INSERT INTO daily_report_detail
                (bu_no, depart_id, user_id, user_name, report_date,
                 from_time, to_time, use_time, projects, wk_type,
                 YYYY_MM, complete_time, YYYY, ruid, actual_date, client_id, items_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),?,?,?,?,?)
        `, [o.bu, o.dept, o.uid, o.uname, o.date,
            d.from || '09:00', d.to || '18:00', d.hours, d.projects || '日常工作', d.wk || '日常工作',
            ym, y, id, o.date, null, null]);
    }
    return id;
}

// 單月聚合種子：hours 一筆 15 日明細；delays/unresolved 用不同 report_date 製造 distinct day
async function seedMonth(uid, uname, ym, hours, delays = 0, unresolved = 0) {
    const [yy, mm] = ym.split('/');
    const d = (day) => `${yy}-${mm}-${String(day).padStart(2, '0')}`;
    await seedReport({
        bu: BU, dept: DEPT, uid, uname, date: d(15),
        p1: delays >= 1 ? '延誤事項' : null,
        p2: unresolved >= 1 ? '未解事項' : null,
        details: hours > 0 ? [{ hours }] : []
    });
    if (delays >= 2) await seedReport({ bu: BU, dept: DEPT, uid, uname, date: d(16), p1: '延誤二' });
    if (delays >= 3) await seedReport({ bu: BU, dept: DEPT, uid, uname, date: d(17), p1: '延誤三' });
    if (unresolved >= 2) await seedReport({ bu: BU, dept: DEPT, uid, uname, date: d(18), p2: '未解二' });
    if (unresolved >= 3) await seedReport({ bu: BU, dept: DEPT, uid, uname, date: d(19), p2: '未解三' });
}

async function clearData() {
    for (const t of ['daily_report_forecast_log', 'daily_report_audit_log', 'daily_report_lock',
        'daily_report_target', 'daily_report_detail', 'daily_report']) {
        await pool.execute(`DELETE FROM ${t} WHERE bu_no=?`, [BU]);
    }
    await pool.execute(`DELETE FROM alert_log WHERE bu_no=?`, [BU]);
}

async function seedTarget(uid, ym, patch = {}) {
    await pool.execute(`
        INSERT INTO daily_report_target
            (bu_no, user_id, YYYY_MM, target_hours, max_delays, max_unresolved, set_by, set_by_name)
        VALUES (?,?,?,?,?,?,?,?)
    `, [BU, uid, ym,
        patch.target_hours ?? null,
        patch.max_delays ?? null,
        patch.max_unresolved ?? null,
        MGR, '王經理']);
}

const as = (uid) => ({
    get: (url) => request(app).get(url).set('x-test-user', uid),
    post: (url, body) => request(app).post(url).set('x-test-user', uid).send(body || {}),
    put: (url, body) => request(app).put(url).set('x-test-user', uid).send(body || {})
});

async function runScan(asOf) {
    const res = await as(MGR).post(SCAN, { bu_no: BU, as_of: asOf });
    expect(res.status).toBe(200);
    return res.body.data;
}
const createdKpis = (rep, kpi, scopeId) =>
    rep.created.filter(c => c.kpi_id === kpi && (!scopeId || c.scope_id === scopeId));

// ============ 全局固定 ============
let ruleSnapshot = [];

beforeAll(async () => {
    await ensureTables();
    await clearData();
    await pool.execute('DELETE FROM cams_xuser WHERE xuser_id IN (?,?,?)', [MGR, EMP, SUP]);
    await pool.execute(`
        INSERT INTO cams_xuser
            (xuser_id, xuser_password, xuser_name, xuser_dept, client_id, inuse_flag, admin, email, tel_no, xuser_type)
        VALUES (?,?,?,?,?,?,?,?,?,?)
    `, [MGR, 'x', '王經理', DEPT, null, 'USE', '管理員', null, null, '部門經理']);
    await pool.execute(`
        INSERT INTO cams_xuser
            (xuser_id, xuser_password, xuser_name, xuser_dept, client_id, inuse_flag, admin, email, tel_no, xuser_type)
        VALUES (?,?,?,?,?,?,?,?,?,?)
    `, [EMP, 'x', '李員工', DEPT, null, 'USE', '普通者', null, null, '一般員工']);
    await pool.execute(`
        INSERT INTO cams_xuser
            (xuser_id, xuser_password, xuser_name, xuser_dept, client_id, inuse_flag, admin, email, tel_no, xuser_type)
        VALUES (?,?,?,?,?,?,?,?,?,?)
    `, [SUP, 'x', '張主管', DEPT, null, 'USE', '普通者', null, null, '部門主管']);

    // 快照 5 條日報規則，測試期間暫關 email 通道（避免對真實經理發信）
    const [rules] = await pool.execute(
        `SELECT uid, threshold, cooldown_hours, status, notify_channel, rule_config
           FROM alert_rule WHERE alert_domain='DAILY_REPORT'`);
    ruleSnapshot = rules;
    expect(rules.length).toBe(5);
    await pool.execute(
        `UPDATE alert_rule SET notify_channel='inapp' WHERE alert_domain='DAILY_REPORT'`);
});

afterAll(async () => {
    // 還原規則
    for (const r of ruleSnapshot) {
        const cfg = typeof r.rule_config === 'object'
            ? JSON.stringify(r.rule_config) : r.rule_config;
        await pool.execute(
            `UPDATE alert_rule SET threshold=?, cooldown_hours=?, status=?, notify_channel=?, rule_config=?
              WHERE uid=?`,
            [r.threshold, r.cooldown_hours, r.status, r.notify_channel, cfg, r.uid]);
    }
    await clearData();
    await pool.execute('DELETE FROM cams_xuser WHERE xuser_id IN (?,?,?)', [MGR, EMP, SUP]);
});

// ============================================================
// M3-A 掃描引擎與 API（文件 1–10 例）
// ============================================================
describe('M3-A 日報異常掃描', () => {
    beforeEach(clearData);

    test('1. 規則列表權限、SUP 取 5 條；PUT 改閾值成功且留 ALERT_RULE_UPD 審計', async () => {
        const denied = await as(EMP).get(RULES);
        expect(denied.status).toBe(403);

        const list = await as(SUP).get(RULES);
        expect(list.status).toBe(200);
        expect(list.body.data).toHaveLength(5);
        const r3 = list.body.data.find(r => r.kpi_id === 'DR_MONTH_HOURS_DEV');
        expect(r3).toBeTruthy();

        const upd = await as(SUP).put(`${RULES}/${r3.uid}`, { threshold: 0.4 });
        expect(upd.status).toBe(200);

        const [audits] = await pool.execute(
            `SELECT COUNT(*) AS c FROM daily_report_audit_log
              WHERE action='ALERT_RULE_UPD' AND operator_id=?
                AND target_user_id=? AND created_time >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)`,
            [SUP, `RULE:${r3.uid}`]);
        expect(Number(audits[0].c)).toBeGreaterThanOrEqual(1);

        const [rows] = await pool.execute(`SELECT threshold FROM alert_rule WHERE uid=?`, [r3.uid]);
        expect(Number(rows[0].threshold)).toBe(0.4);
    });

    test('2. PUT 帶 kpi_id / alert_domain 不可變欄位被拒 400', async () => {
        const list = await as(MGR).get(RULES);
        const uid = list.body.data[0].uid;
        expect((await as(SUP).put(`${RULES}/${uid}`, { kpi_id: 'X' })).status).toBe(400);
        expect((await as(SUP).put(`${RULES}/${uid}`, { alert_domain: 'FINANCE' })).status).toBe(400);
        expect((await as(SUP).put(`${RULES}/${uid}`, { cond: 'lt' })).status).toBe(400);
    });

    test('3. 注入週一 as_of：連續 4 工作日未交 R1 warning；連續 6 日 danger', async () => {
        // 2099-03-02 為週一；EMP 最後日報 2/24(二) → 缺 2/25,26,27,3/2 共 4 日；SUP 最後 2/20(五) → 6 日
        await seedReport({ bu: BU, dept: DEPT, uid: EMP, uname: '李員工',
            date: '2099-02-24', details: [{ hours: 8 }] });
        await seedReport({ bu: BU, dept: DEPT, uid: SUP, uname: '張主管',
            date: '2099-02-20', details: [{ hours: 8 }] });

        const rep = await runScan('2099-03-02 10:00');
        const emp = createdKpis(rep, 'DR_MISSING_DAYS', EMP);
        const sup = createdKpis(rep, 'DR_MISSING_DAYS', SUP);
        expect(emp).toHaveLength(1);
        expect(emp[0].level).toBe('warning');
        expect(sup).toHaveLength(1);
        expect(sup[0].level).toBe('danger');
    });

    test('4. 同 as_of 重掃冷卻 suppressed；warning 後達 danger 天數可升級再發', async () => {
        await seedReport({ bu: BU, dept: DEPT, uid: EMP, uname: '李員工',
            date: '2099-02-24', details: [{ hours: 8 }] });

        const first = await runScan('2099-03-02 10:00');
        expect(createdKpis(first, 'DR_MISSING_DAYS', EMP)).toHaveLength(1);

        const second = await runScan('2099-03-02 10:00');
        expect(createdKpis(second, 'DR_MISSING_DAYS', EMP)).toHaveLength(0);
        expect(second.suppressed).toBeGreaterThanOrEqual(1);

        // 最後日報改為 2/20 → 同一 ym 週期缺 6 日（danger），同 dedup_key 允許 warning→danger 升級
        await pool.execute(`DELETE FROM daily_report_detail WHERE bu_no=? AND user_id=?`, [BU, EMP]);
        await pool.execute(`DELETE FROM daily_report WHERE bu_no=? AND user_id=?`, [BU, EMP]);
        await seedReport({ bu: BU, dept: DEPT, uid: EMP, uname: '李員工',
            date: '2099-02-20', details: [{ hours: 8 }] });

        const upgraded = await runScan('2099-03-02 10:00');
        const got = createdKpis(upgraded, 'DR_MISSING_DAYS', EMP);
        expect(got).toHaveLength(1);
        expect(got[0].level).toBe('danger');
    });

    test('5. 週末不計入連續未交工作日（跨週驗證）', () => {
        // 2099-03-02 週一；最後日報 2/24(二) → 跳過 2/28(六)、3/1(日)，只計 4 個工作日
        const set = new Set(['2099-02-24']);
        expect(scanner.consecutiveMissingWorkdays(set, new Date(2099, 2, 2))).toBe(4);
        // 2/27(五) 有交 → 僅 3/2(一) 1 日
        expect(scanner.consecutiveMissingWorkdays(new Set(['2099-02-27']), new Date(2099, 2, 2))).toBe(1);
        // 週三 as_of 回溯：2/27 有交，3/2、3/3、3/4 缺 → 3 日
        expect(scanner.consecutiveMissingWorkdays(new Set(['2099-02-27']), new Date(2099, 2, 4))).toBe(3);
        // 當天已交 → 0
        expect(scanner.consecutiveMissingWorkdays(new Set(['2099-03-02']), new Date(2099, 2, 2))).toBe(0);
    });

    test('6. 前一工作日工時 15.5h → R2 warning；無日報者 R2 不觸發', async () => {
        await seedReport({ bu: BU, dept: DEPT, uid: EMP, uname: '李員工',
            date: '2099-03-02', details: [{ hours: 15.5 }] });   // 週一偏高
        await seedReport({ bu: BU, dept: DEPT, uid: EMP, uname: '李員工',
            date: '2099-03-03', details: [{ hours: 8 }] });      // 週二正常
        await seedReport({ bu: BU, dept: DEPT, uid: SUP, uname: '張主管',
            date: '2099-02-27', details: [{ hours: 8 }] });      // 近 2 工作日無日報

        const rep = await runScan('2099-03-03 10:00');
        const r2 = createdKpis(rep, 'DR_DAILY_HOURS');
        expect(r2).toHaveLength(1);
        expect(r2[0].scope_id).toBe(EMP);
        const [dbRow] = await pool.execute(
            `SELECT current_value, title FROM alert_log WHERE bu_no=? AND kpi_id='DR_DAILY_HOURS'`, [BU]);
        expect(Number(dbRow[0].current_value)).toBe(15.5);
        expect(dbRow[0].title).toContain('偏高');
        // SUP 不應有 R2 告警
        expect(createdKpis(rep, 'DR_DAILY_HOURS', SUP)).toHaveLength(0);
    });

    test('7. 第 10 日起月化工時偏離 6 月均值 +35% → R3 warning OVER；第 9 日不評估', async () => {
        // 前 6 完整月每月 100h
        for (const ym of ['2098/09', '2098/10', '2098/11', '2098/12', '2099/01', '2099/02']) {
            const [yy, mm] = ym.split('/');
            await seedReport({ bu: BU, dept: DEPT, uid: EMP, uname: '李員工',
                date: `${yy}-${mm}-15`, details: [{ hours: 100 }] });
        }
        // 3/3–3/6、3/9、3/10 六個工作日各 8h = 48h，月化 48/10*31=148.8h（+48.8%）
        for (const day of ['03', '04', '05', '06', '09', '10']) {
            await seedReport({ bu: BU, dept: DEPT, uid: EMP, uname: '李員工',
                date: `2099-03-${day}`, details: [{ hours: 8 }] });
        }

        // 第 9 日不評估（3/9 視窗內尚無 3/9、3/10 日報）
        const early = await runScan('2099-03-09 10:00');
        expect(createdKpis(early, 'DR_MONTH_HOURS_DEV', EMP)).toHaveLength(0);

        const rep = await runScan('2099-03-10 10:00');
        expect(createdKpis(rep, 'DR_MONTH_HOURS_DEV', EMP)).toHaveLength(1);
        const [rows] = await pool.execute(
            `SELECT title, message FROM alert_log WHERE bu_no=? AND kpi_id='DR_MONTH_HOURS_DEV'`, [BU]);
        expect(rows[0].title).toContain('超載');
        expect(rows[0].message).toContain('48.8%');
    });

    test('8. delay_cnt 超 target.max_delays → R4 danger；無 target 計 skipped_no_target 且無告警', async () => {
        await seedTarget(EMP, '2099/03', { max_delays: 1 });
        // EMP 3/4、3/5 兩日通報延誤；其他工作日正常補齊避免 R1
        await seedReport({ bu: BU, dept: DEPT, uid: EMP, uname: '李員工',
            date: '2099-03-04', p1: '延誤一', details: [{ hours: 8 }] });
        await seedReport({ bu: BU, dept: DEPT, uid: EMP, uname: '李員工',
            date: '2099-03-05', p1: '延誤二', details: [{ hours: 8 }] });
        for (const day of ['06', '09', '10']) {
            await seedReport({ bu: BU, dept: DEPT, uid: EMP, uname: '李員工',
                date: `2099-03-${day}`, details: [{ hours: 8 }] });
        }
        // SUP 活躍但無目標
        for (const day of ['09', '10']) {
            await seedReport({ bu: BU, dept: DEPT, uid: SUP, uname: '張主管',
                date: `2099-03-${day}`, details: [{ hours: 8 }] });
        }

        const rep = await runScan('2099-03-10 10:00');
        const r4 = createdKpis(rep, 'DR_DELAY_OVER');
        expect(r4).toHaveLength(1);
        expect(r4[0].scope_id).toBe(EMP);
        expect(r4[0].level).toBe('danger');
        expect(createdKpis(rep, 'DR_DELAY_OVER', SUP)).toHaveLength(0);
        expect(rep.skipped_no_target).toBeGreaterThanOrEqual(1);
    });

    test('9. 月末 16:00 後 3 人有日報僅 1 人鎖定 → 1 條 BU 摘要含 2 位姓名；重掃 suppressed', async () => {
        for (const [uid, uname] of [[EMP, '李員工'], [SUP, '張主管'], [MGR, '王經理']]) {
            await seedReport({ bu: BU, dept: DEPT, uid, uname,
                date: '2099-04-29', details: [{ hours: 8 }] });
        }
        await pool.execute(
            `INSERT INTO daily_report_lock (bu_no, user_id, YYYY_MM, lock_status, locked_by, locked_by_name)
             VALUES (?,?,'2099/04','LOCKED',?,?)`,
            [BU, EMP, MGR, '王經理']);

        const rep = await runScan('2099-04-30 16:30');
        const r5 = createdKpis(rep, 'DR_MONTH_UNLOCKED');
        expect(r5).toHaveLength(1);
        expect(r5[0].scope_type).toBe('BU');
        const [rows] = await pool.execute(
            `SELECT message FROM alert_log WHERE bu_no=? AND kpi_id='DR_MONTH_UNLOCKED'`, [BU]);
        expect(rows[0].message).toContain('張主管');
        expect(rows[0].message).toContain('王經理');
        expect(rows[0].message).not.toContain('李員工');

        const again = await runScan('2099-04-30 16:30');
        expect(createdKpis(again, 'DR_MONTH_UNLOCKED')).toHaveLength(0);
        expect(again.suppressed).toBeGreaterThanOrEqual(1);
    });

    test('10. 手動掃描 EMP 403、as_of 格式 400；MGR 回彙總結構且 errors 為空；logs 支援 domain 過濾', async () => {
        expect((await as(EMP).post(SCAN, { bu_no: BU, as_of: '2099-03-02 10:00' })).status).toBe(403);
        expect((await as(MGR).post(SCAN, { bu_no: BU, as_of: 'bad-format' })).status).toBe(400);
        expect((await as(MGR).post(SCAN, { bu_no: BU, as_of: '2099/03/02 10:00' })).status).toBe(400);

        await seedReport({ bu: BU, dept: DEPT, uid: EMP, uname: '李員工',
            date: '2099-02-24', details: [{ hours: 8 }] });
        const rep = await runScan('2099-03-02 10:00');
        expect(Array.isArray(rep.errors)).toBe(true);
        expect(rep.errors).toHaveLength(0);
        expect(rep.bu_no).toBe(BU);
        expect(rep.created.length).toBeGreaterThanOrEqual(1);

        const logs = await as(SUP).get('/api/alert/logs?bu_no=TEST&domain=DAILY_REPORT&limit=100');
        expect(logs.status).toBe(200);
        expect(logs.body.data.length).toBeGreaterThanOrEqual(1);
        expect(logs.body.data.every(r => r.alert_domain === 'DAILY_REPORT')).toBe(true);
    });
});

// ============================================================
// M3-B 趨勢預測（文件 11–18 例 + 回測）
// ============================================================
describe('M3-B 工時/延誤趨勢預測', () => {
    beforeEach(clearData);

    test('11. forecastSeries：WMA/LR/混合與手算一致，σ 與 80% 區間寬度正確；平坦序列 σ=0', () => {
        const vals = [100, 102, 104, 106, 108, 110];
        const wma = fc.wmaForecast(vals);          // 2240/21
        const lr = fc.lrForecast(vals);            // 斜率 2，t=7 → 112
        expect(wma).toBeCloseTo(106.6667, 3);
        expect(lr).toBeCloseTo(112, 6);

        const mix = fc.forecastSeries(vals, 'WMA_LR');
        expect(mix.n).toBe(6);
        expect(mix.forecast).toBeCloseTo(0.5 * wma + 0.5 * lr, 6);
        expect(mix.forecast).toBeCloseTo(109.3333, 3);
        expect(fc.forecastSeries(vals, 'WMA').forecast).toBeCloseTo(wma, 6);
        expect(fc.forecastSeries(vals, 'LR').forecast).toBeCloseTo(lr, 6);
        // 區間寬度 = 2·z·σ·√(1+1/n)
        const width = mix.upper - mix.lower;
        expect(width).toBeCloseTo(2 * 1.282 * mix.sigma * Math.sqrt(1 + 1 / 6), 5);
        expect(mix.sigma).toBeGreaterThan(0);

        const flat = fc.forecastSeries([8, 8, 8, 8, 8, 8]);
        expect(flat.sigma).toBe(0);
        expect(flat.forecast).toBe(8);
        expect(flat.lower).toBe(8);
        expect(flat.upper).toBe(8);

        expect(fc.forecastSeries([8, 9])).toBeNull();   // n<3
    });

    test('12. 歷史僅 2 月 → insufficient 不寫 log；補滿 6 月正常出值', async () => {
        await seedMonth(EMP, '李員工', '2099/01', 100);
        await seedMonth(EMP, '李員工', '2099/02', 100);
        const short = await fc.forecastBu(BU, '2099/07', { persist: true });
        expect(short.insufficient.some(x =>
            x.scope_id === EMP && x.metric === 'HOURS' && x.history_n === 2)).toBe(true);
        const [[cnt1]] = await pool.query(
            `SELECT COUNT(*) c FROM daily_report_forecast_log WHERE bu_no=? AND target_ym='2099/07'`, [BU]);
        expect(Number(cnt1.c)).toBe(0);

        for (const ym of ['2099/03', '2099/04', '2099/05', '2099/06']) {
            await seedMonth(EMP, '李員工', ym, 100);
        }
        const full = await fc.forecastBu(BU, '2099/07', { persist: true });
        const row = full.rows.find(r => r.scope_type === 'USER' && r.scope_id === EMP && r.metric === 'HOURS');
        expect(row).toBeTruthy();
        expect(row.history_n).toBe(6);
        expect(row.forecast_val).toBe(100);
        expect(row.risk_level).toBe('NORMAL');
        expect(full.insufficient.some(x => x.scope_id === EMP)).toBe(false);
    });

    test('13. DELAYS 預測與區間為非負整數（floor/ceil），HOURS 為 1 位小數且下限 ≥0', async () => {
        const delays = [2, 1, 3, 0, 2, 1];
        const months6 = ['2099/01', '2099/02', '2099/03', '2099/04', '2099/05', '2099/06'];
        for (let i = 0; i < months6.length; i++) {
            await seedMonth(EMP, '李員工', months6[i], 120, delays[i], i % 2);
        }
        const res = await fc.forecastBu(BU, '2099/07', { persist: false });
        const d = res.rows.find(r => r.metric === 'DELAYS' && r.scope_type === 'USER');
        const h = res.rows.find(r => r.metric === 'HOURS' && r.scope_type === 'USER');
        for (const v of [d.forecast_val, d.lower_bound, d.upper_bound]) {
            expect(Number.isInteger(Number(v))).toBe(true);
            expect(Number(v)).toBeGreaterThanOrEqual(0);
        }
        expect(d.upper_bound).toBeGreaterThanOrEqual(d.lower_bound);
        expect(Number(h.lower_bound)).toBeGreaterThanOrEqual(0);
        expect(Math.round(Number(h.forecast_val) * 10)).toBeCloseTo(Number(h.forecast_val) * 10, 6);
    });

    test('14. 風險分級：超 base 30% DANGER/OVER；低 25% WARN/UNDER；delay ≥ target DANGER', () => {
        expect(fc.gradeRisk('HOURS', 140, 135, 145, 100, 100)).toMatchObject({ risk_level: 'DANGER', risk_dir: 'OVER' });
        expect(fc.gradeRisk('HOURS', 55, 50, 60, 100, 100)).toMatchObject({ risk_level: 'DANGER', risk_dir: 'UNDER' });
        expect(fc.gradeRisk('HOURS', 78, 72, 85, 100, 100)).toMatchObject({ risk_level: 'WARN', risk_dir: 'UNDER' });
        expect(fc.gradeRisk('HOURS', 118, 112, 124, 100, 100)).toMatchObject({ risk_level: 'WARN', risk_dir: 'OVER' });
        expect(fc.gradeRisk('HOURS', 100, 99, 101, 100, 100)).toMatchObject({ risk_level: 'NORMAL', risk_dir: null });
        expect(fc.gradeRisk('DELAYS', 3, 3, 4, 2, 1.5)).toMatchObject({ risk_level: 'DANGER' });
        expect(fc.gradeRisk('UNRESOLVED', 1, 1, 1, 0, 0)).toMatchObject({ risk_level: 'DANGER' });
    });

    test('15. TEST BU 平滑 6 月預測第 7 月：GET 含 history/forecast，再 GET 走 UPSERT 列數不增', async () => {
        const months = ['2025/03', '2025/04', '2025/05', '2025/06', '2025/07', '2025/08'];
        for (const ym of months) await seedMonth(EMP, '李員工', ym, 160);
        await seedTarget(EMP, '2025/09', { target_hours: 160, max_delays: 0, max_unresolved: 0 });

        const denied = await as(EMP).get(`${FC_API}?bu_no=${BU}&target_ym=2025/09&scope=USER&metric=HOURS`);
        expect(denied.status).toBe(403);
        const badMetric = await as(SUP).get(`${FC_API}?bu_no=${BU}&target_ym=2025/09&scope=USER&metric=PER_CAPITA_HOURS`);
        expect(badMetric.status).toBe(400);

        const url = `${FC_API}?bu_no=${BU}&target_ym=2025/09&scope=USER&metric=HOURS`;
        const r1 = await as(SUP).get(url);
        expect(r1.status).toBe(200);
        const row = r1.body.data.rows[0];
        expect(row.scope_id).toBe(EMP);
        expect(row.history).toHaveLength(6);
        expect(row.forecast_val).toBe(160);
        expect(row.risk_level).toBe('NORMAL');

        const [[c1]] = await pool.query(
            `SELECT COUNT(*) c FROM daily_report_forecast_log
              WHERE bu_no=? AND target_ym='2025/09' AND scope_type='USER' AND scope_id=? AND metric='HOURS'`,
            [BU, EMP]);
        await as(SUP).get(url);
        const [[c2]] = await pool.query(
            `SELECT COUNT(*) c FROM daily_report_forecast_log
              WHERE bu_no=? AND target_ym='2025/09' AND scope_type='USER' AND scope_id=? AND metric='HOURS'`,
            [BU, EMP]);
        expect(Number(c1.c)).toBe(1);
        expect(Number(c2.c)).toBe(1);
    });

    test('16. 全量重算僅 isSenior：SUP 403、MGR 回傳 upserted/insufficient/danger/warn 計數', async () => {
        for (const uid of [EMP, SUP]) {
            const name = uid === EMP ? '李員工' : '張主管';
            for (const ym of ['2025/03', '2025/04', '2025/05', '2025/06', '2025/07', '2025/08']) {
                await seedMonth(uid, name, ym, 160);
            }
            await seedTarget(uid, '2025/09', { target_hours: 160, max_delays: 0, max_unresolved: 0 });
        }
        const direct = await fc.runAll(BU, '2025/09');
        // 2 位 USER × 3 指標 + 1 部門 × 4 指標 = 10 列
        expect(direct.upserted).toBe(10);
        expect(direct.insufficient).toBe(0);
        expect(typeof direct.danger).toBe('number');
        expect(typeof direct.warn).toBe('number');

        expect((await as(SUP).post(`${FC_API}/run`, { bu_no: BU, target_ym: '2025/09' })).status).toBe(403);
        const r = await as(MGR).post(`${FC_API}/run`, { bu_no: BU, target_ym: '2025/09' });
        expect(r.status).toBe(200);
        expect(r.body.data.upserted).toBe(10);
    });

    test('17. 非法 target_ym 回 400（GET 與 POST/run）', async () => {
        expect((await as(SUP).get(`${FC_API}?bu_no=${BU}&target_ym=abc`)).status).toBe(400);
        expect((await as(MGR).post(`${FC_API}/run`, { bu_no: BU, target_ym: '2025/9/1' })).status).toBe(400);
    });

    test('18. 月度報告 HTML：有風險含「下月預警」區塊；無風險含正常句；error 不顯示', () => {
        const base = { bu_no: BU, period: '2099/08', generated_at: new Date().toISOString() };
        const riskHtml = buildReportHtml({
            ...base,
            forecast: {
                target_ym: '2025/09',
                risks: [{
                    scope_type: 'USER', scope_name: '李員工', metric: 'HOURS',
                    risk_level: 'DANGER', risk_dir: 'OVER',
                    forecast_val: 201.5, lower_bound: 180, upper_bound: 223
                }]
            }
        });
        expect(riskHtml).toContain('下月預警');
        expect(riskHtml).toContain('201.5');
        expect(riskHtml).toContain('李員工');

        const okHtml = buildReportHtml({ ...base, forecast: { target_ym: '2025/09', risks: [] } });
        expect(okHtml).toContain('下月預警');
        expect(okHtml).toContain('正常範圍');

        const errHtml = buildReportHtml({ ...base, forecast: { target_ym: null, risks: [], error: 'x' } });
        expect(errHtml).not.toContain('下月預警');
    });

    test('19. 回測：HM 2025/03–08 訓練預測 09，完整資料人員 HOURS MAPE 平均 ≤ 25%', async () => {
        const months = ['2025/03', '2025/04', '2025/05', '2025/06', '2025/07', '2025/08'];
        const ph = months.map(() => '?').join(',');
        const [rows] = await pool.execute(
            `SELECT d.user_id, MAX(d.user_name) n, d.YYYY_MM ym,
                    ROUND(COALESCE(SUM(dt.use_time),0),2) h
               FROM daily_report d LEFT JOIN daily_report_detail dt ON dt.ruid=d.id
              WHERE d.bu_no='HM' AND d.status1='USE'
                AND (d.YYYY_MM IN (${ph}) OR d.YYYY_MM='2025/09')
              GROUP BY d.user_id, d.YYYY_MM`, months);
        const m = {};
        for (const r of rows) {
            if (!m[r.user_id]) m[r.user_id] = { n: r.n, v: {} };
            m[r.user_id].v[r.ym] = Number(r.h);
        }
        const apes = [];
        for (const [, x] of Object.entries(m)) {
            const train = months.map(z => x.v[z]);
            const actual = x.v['2025/09'];
            if (train.some(v => v == null) || actual == null) continue;
            const f = fc.forecastSeries(train, 'WMA_LR');
            apes.push({ name: x.n, actual, forecast: f.forecast, mape: Math.abs(f.forecast - actual) / actual });
        }
        expect(apes.length).toBeGreaterThanOrEqual(1);
        const avg = apes.reduce((s, x) => s + x.mape, 0) / apes.length;
        console.log('[M3 backtest]', apes.map(x => `${x.name} ${(x.mape * 100).toFixed(1)}%`).join(', '),
            `avg=${(avg * 100).toFixed(1)}%`);
        expect(avg).toBeLessThanOrEqual(0.25);
    });
});
