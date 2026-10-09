/**
 * M3 異常告警 + 工時延誤預測 — 建表脚本（幂等，可重複執行）
 *   1. alert_rule / alert_log 既有財務預警表擴欄（alert_domain/rule_config/dedup_key…）
 *      — 若表不存在則以完整結構建立（含新欄位），已存在則冪等 ALTER 補欄位與索引
 *   2. 5 條日報域內建規則種子（DR_MISSING_DAYS / DR_DAILY_HOURS / DR_MONTH_HOURS_DEV /
 *      DR_DELAY_OVER / DR_MONTH_UNLOCKED），僅在不存在時插入
 *   3. daily_report_forecast_log 工時延誤預測結果表
 *
 * 執行：node database/add_dr_forecast_alert.js
 */
const { pool } = require('../config/db');

async function columnExists(table, col) {
    const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1`,
        [table, col]);
    return rows.length > 0;
}

async function indexExists(table, idx) {
    const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? LIMIT 1`,
        [table, idx]);
    return rows.length > 0;
}

async function addColumnIfMissing(table, col, ddl) {
    if (await columnExists(table, col)) {
        console.log(`ℹ️  ${table}.${col} 已存在，跳過`);
        return;
    }
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    console.log(`✅ ${table}.${col} 欄位已新增`);
}

async function addIndexIfMissing(table, idx, ddl) {
    if (await indexExists(table, idx)) {
        console.log(`ℹ️  ${table} 索引 ${idx} 已存在，跳過`);
        return;
    }
    await pool.query(`ALTER TABLE ${table} ADD ${ddl}`);
    console.log(`✅ ${table} 索引 ${idx} 已建立`);
}

// 5 條日報域內建規則種子
const DR_RULES = [
    {
        rule_name: '連續未交日報', kpi_id: 'DR_MISSING_DAYS',
        cond: 'gte', threshold: 3, scope_type: 'USER', cooldown: 12,
        rule_config: { danger_days: 5 }
    },
    {
        rule_name: '單日工時異常', kpi_id: 'DR_DAILY_HOURS',
        cond: 'out_range', threshold: 14, scope_type: 'USER', cooldown: 24,
        rule_config: { min_hours: 2, max_hours: 14 }
    },
    {
        rule_name: '月度工時偏離', kpi_id: 'DR_MONTH_HOURS_DEV',
        cond: 'dev_pct', threshold: 0.30, scope_type: 'USER', cooldown: 48,
        rule_config: { window_months: 6, min_eval_day: 10 }
    },
    {
        rule_name: '延誤筆數超限', kpi_id: 'DR_DELAY_OVER',
        cond: 'gt_target', threshold: 0, scope_type: 'USER', cooldown: 24,
        rule_config: { target_field: 'max_delays' }
    },
    {
        rule_name: '月底未鎖定提醒', kpi_id: 'DR_MONTH_UNLOCKED',
        cond: 'month_end', threshold: 16, scope_type: 'BU', cooldown: 4,
        rule_config: { hour: 16 }
    }
];

async function run() {
    // ===== ① alert_rule：不存在則以完整結構建立；存在則補欄位 =====
    await pool.execute(`
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
            alert_domain VARCHAR(20) NOT NULL DEFAULT 'FINANCE' COMMENT 'FINANCE/DAILY_REPORT',
            scope_type VARCHAR(10) DEFAULT NULL COMMENT 'USER/DEPT/BU',
            rule_config JSON DEFAULT NULL COMMENT '額外閾值，如 {"danger_days":5}',
            INDEX idx_bu (bu_no),
            INDEX idx_domain_status (alert_domain, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await addColumnIfMissing('alert_rule', 'alert_domain',
        `alert_domain VARCHAR(20) NOT NULL DEFAULT 'FINANCE' COMMENT 'FINANCE/DAILY_REPORT'`);
    await addColumnIfMissing('alert_rule', 'scope_type',
        `scope_type VARCHAR(10) DEFAULT NULL COMMENT 'USER/DEPT/BU'`);
    await addColumnIfMissing('alert_rule', 'rule_config',
        `rule_config JSON DEFAULT NULL COMMENT '額外閾值'`);
    await addIndexIfMissing('alert_rule', 'idx_domain_status',
        `INDEX idx_domain_status (alert_domain, status)`);
    console.log('✅ alert_rule 就緒');

    // ===== ② alert_log：不存在則完整建立；存在則補欄位 =====
    await pool.execute(`
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
            scope_type VARCHAR(10) DEFAULT NULL,
            scope_id VARCHAR(50) DEFAULT NULL COMMENT 'user_id/depart_id/bu_no',
            scope_name VARCHAR(100) DEFAULT NULL,
            dedup_key VARCHAR(160) DEFAULT NULL COMMENT '同鍵冷卻去重',
            notify_status VARCHAR(10) NOT NULL DEFAULT 'NONE' COMMENT 'NONE/SENT/SKIPPED/FAILED',
            INDEX idx_bu_read (bu_no, is_read),
            INDEX idx_domain_time (alert_domain, created_at),
            INDEX idx_dedup_time (dedup_key, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await addColumnIfMissing('alert_log', 'alert_domain',
        `alert_domain VARCHAR(20) NOT NULL DEFAULT 'FINANCE'`);
    await addColumnIfMissing('alert_log', 'scope_type', `scope_type VARCHAR(10) DEFAULT NULL`);
    await addColumnIfMissing('alert_log', 'scope_id',
        `scope_id VARCHAR(50) DEFAULT NULL COMMENT 'user_id/depart_id/bu_no'`);
    await addColumnIfMissing('alert_log', 'scope_name', `scope_name VARCHAR(100) DEFAULT NULL`);
    await addColumnIfMissing('alert_log', 'dedup_key',
        `dedup_key VARCHAR(160) DEFAULT NULL COMMENT '同鍵冷卻去重'`);
    await addColumnIfMissing('alert_log', 'notify_status',
        `notify_status VARCHAR(10) NOT NULL DEFAULT 'NONE' COMMENT 'NONE/SENT/SKIPPED/FAILED'`);
    await addIndexIfMissing('alert_log', 'idx_domain_time',
        `INDEX idx_domain_time (alert_domain, created_at)`);
    await addIndexIfMissing('alert_log', 'idx_dedup_time',
        `INDEX idx_dedup_time (dedup_key, created_at)`);
    console.log('✅ alert_log 就緒');

    // ===== ③ 5 條日報域規則種子（domain+kpi_id 不存在才插） =====
    let seeded = 0;
    for (const r of DR_RULES) {
        const [exist] = await pool.execute(
            `SELECT uid FROM alert_rule WHERE alert_domain='DAILY_REPORT' AND kpi_id=? LIMIT 1`,
            [r.kpi_id]);
        if (exist.length > 0) continue;
        await pool.execute(
            `INSERT INTO alert_rule
                (rule_name, bu_no, kpi_id, cond, threshold, notify_channel, notify_user,
                 cooldown_hours, status, alert_domain, scope_type, rule_config)
             VALUES (?,NULL,?,?,?, 'inapp,email','manager', ?,1,'DAILY_REPORT',?,?)`,
            [r.rule_name, r.kpi_id, r.cond, r.threshold, r.cooldown,
             r.scope_type, JSON.stringify(r.rule_config)]);
        seeded++;
    }
    console.log(seeded > 0 ? `✅ 日報告警規則種子已載入 (${seeded} 筆)` : 'ℹ️  日報告警規則種子已存在，跳過');

    // ===== ④ 工時延誤預測結果表 =====
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS daily_report_forecast_log (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            bu_no VARCHAR(20) NOT NULL,
            target_ym CHAR(7) NOT NULL COMMENT '被預測月份 YYYY/MM',
            scope_type VARCHAR(10) NOT NULL COMMENT 'USER/DEPT',
            scope_id VARCHAR(50) NOT NULL COMMENT 'user_id 或 depart_id',
            scope_name VARCHAR(100) DEFAULT NULL,
            metric VARCHAR(20) NOT NULL COMMENT 'HOURS/PER_CAPITA_HOURS/DELAYS/UNRESOLVED',
            forecast_val DECIMAL(12,2) NOT NULL,
            lower_bound DECIMAL(12,2) DEFAULT NULL,
            upper_bound DECIMAL(12,2) DEFAULT NULL,
            risk_level VARCHAR(10) DEFAULT 'NORMAL' COMMENT 'NORMAL/WARN/DANGER',
            risk_dir VARCHAR(10) DEFAULT NULL COMMENT 'OVER/UNDER',
            algo VARCHAR(20) DEFAULT 'WMA_LR',
            history_n INT DEFAULT 0 COMMENT '有效訓練月數',
            generated_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uk_target_scope_metric (bu_no, target_ym, scope_type, scope_id, metric),
            INDEX idx_bu_target (bu_no, target_ym, risk_level)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='工時延誤預測結果'
    `);
    console.log('✅ daily_report_forecast_log 已建立');

    await pool.end();
}

run().catch(e => { console.error('❌ 遷移失敗：', e); process.exit(1); });
