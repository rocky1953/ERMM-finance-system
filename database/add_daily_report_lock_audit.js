/**
 * 工作日报 P0：签核锁定 + 审计日志 建表脚本
 *   daily_report_lock        签核锁定表（员工×月份唯一，LOCKED/UNLOCKED 全程留痕）
 *   daily_report_audit_log   日报操作审计日志（CREATE/UPDATE/DELETE/LOCK/UNLOCK）
 *
 * 执行：node database/add_daily_report_lock_audit.js
 * 幂等：CREATE TABLE IF NOT EXISTS，可重复执行
 */
const { pool } = require('../config/db');

async function run() {
    try {
        // ===== 签核锁定表 =====
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS daily_report_lock (
                id INT AUTO_INCREMENT PRIMARY KEY COMMENT '自增主键',
                bu_no VARCHAR(10) NOT NULL COMMENT '公司别',
                user_id VARCHAR(50) NOT NULL COMMENT '日报撰写人帐号',
                YYYY_MM CHAR(7) NOT NULL COMMENT '锁定年月 YYYY/MM',
                lock_status CHAR(10) NOT NULL DEFAULT 'LOCKED' COMMENT '状态 LOCKED/UNLOCKED',
                locked_by VARCHAR(50) NOT NULL COMMENT '锁定人帐号',
                locked_by_name VARCHAR(100) DEFAULT '' COMMENT '锁定人姓名',
                locked_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '锁定时间',
                unlocked_by VARCHAR(50) DEFAULT NULL COMMENT '解锁人帐号(仅高階主管/管理员)',
                unlocked_by_name VARCHAR(100) DEFAULT NULL COMMENT '解锁人姓名',
                unlocked_time DATETIME DEFAULT NULL COMMENT '解锁时间',
                unlock_reason VARCHAR(500) DEFAULT NULL COMMENT '解锁原因',
                UNIQUE KEY uk_bu_user_ym (bu_no, user_id, YYYY_MM),
                INDEX idx_bu_ym (bu_no, YYYY_MM),
                INDEX idx_status (lock_status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='工作日报签核锁定表';
        `);
        console.log('✅ daily_report_lock 表已建立');

        // ===== 审计日志表 =====
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS daily_report_audit_log (
                id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '自增主键',
                bu_no VARCHAR(10) NOT NULL COMMENT '公司别',
                ruid INT DEFAULT NULL COMMENT '日报主表id(删除后保留)',
                report_date CHAR(10) DEFAULT NULL COMMENT '日报日期',
                target_user_id VARCHAR(50) NOT NULL COMMENT '日报归属人帐号',
                target_user_name VARCHAR(100) DEFAULT '' COMMENT '日报归属人姓名',
                YYYY_MM CHAR(7) DEFAULT NULL COMMENT '年月 YYYY/MM',
                action VARCHAR(20) NOT NULL COMMENT '动作 CREATE/UPDATE/DELETE/LOCK/UNLOCK',
                operator_id VARCHAR(50) NOT NULL COMMENT '操作人帐号',
                operator_name VARCHAR(100) DEFAULT '' COMMENT '操作人姓名',
                operator_ip VARCHAR(64) DEFAULT '' COMMENT '操作人IP',
                old_data JSON DEFAULT NULL COMMENT '变更前内容(JSON)',
                new_data JSON DEFAULT NULL COMMENT '变更后内容(JSON)',
                remark VARCHAR(500) DEFAULT NULL COMMENT '备注(解锁原因等)',
                created_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录时间',
                INDEX idx_bu_ym (bu_no, YYYY_MM),
                INDEX idx_target (target_user_id, YYYY_MM),
                INDEX idx_action (action),
                INDEX idx_created (created_time)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='工作日报操作审计日志';
        `);
        console.log('✅ daily_report_audit_log 表已建立');

        for (const t of ['daily_report_lock', 'daily_report_audit_log']) {
            const [cols] = await pool.query(`SHOW COLUMNS FROM ${t}`);
            console.log(`\n${t} 栏位结构：`);
            console.table(cols.map(c => ({ Field: c.Field, Type: c.Type, Null: c.Null, Key: c.Key, Default: c.Default })));
        }
    } catch (e) {
        console.error('❌ 迁移失败：', e.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

run();
