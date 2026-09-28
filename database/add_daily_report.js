/**
 * 工作日报管理资料表迁移脚本
 *   daily_report        日报主表（一人一天一公司一份，UPSERT）
 *   daily_report_detail 日报明细表（多笔工作项目，ruid 关联主表 id）
 *
 * 执行：node database/add_daily_report.js
 * 幂等：CREATE TABLE IF NOT EXISTS，可重复执行
 */
const { pool } = require('../config/db');

async function run() {
    try {
        // ===== 日报主表 =====
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS daily_report (
                id INT AUTO_INCREMENT PRIMARY KEY COMMENT '自增主键',
                bu_no VARCHAR(10) NOT NULL COMMENT '公司别',
                depart_id VARCHAR(100) DEFAULT NULL COMMENT '部门编号/名称(cams_xuser.xuser_dept)',
                user_id VARCHAR(50) NOT NULL COMMENT '撰写人帐号(cams_xuser.xuser_id)',
                user_name VARCHAR(100) DEFAULT '' COMMENT '撰写人姓名',
                report_date CHAR(10) NOT NULL COMMENT '报告日期 YYYY-MM-DD',
                projects1 VARCHAR(500) DEFAULT NULL COMMENT '今天延误事项及原因',
                projects2 VARCHAR(500) DEFAULT NULL COMMENT '目前尚未解决的事项',
                status1 CHAR(10) NOT NULL DEFAULT 'USE' COMMENT '状态 USE/NOUSE(作废)',
                YYYY INT DEFAULT NULL COMMENT '年份',
                YYYY_MM CHAR(7) DEFAULT NULL COMMENT '年月 YYYY/MM',
                ruid INT DEFAULT NULL COMMENT '记录编号(=主表id,明细关联键)',
                create_time DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
                UNIQUE KEY uk_bu_user_date (bu_no, user_id, report_date),
                INDEX idx_user_ym (user_id, YYYY_MM),
                INDEX idx_bu_ym (bu_no, YYYY_MM),
                INDEX idx_ruid (ruid)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='工作日报主表';
        `);
        console.log('✅ daily_report 表已建立');

        // ===== 日报明细表 =====
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS daily_report_detail (
                id INT AUTO_INCREMENT PRIMARY KEY COMMENT '自增主键',
                bu_no VARCHAR(10) NOT NULL COMMENT '公司别',
                depart_id VARCHAR(100) DEFAULT NULL COMMENT '部门编号/名称',
                user_id VARCHAR(50) NOT NULL COMMENT '撰写人帐号',
                user_name VARCHAR(100) DEFAULT '' COMMENT '撰写人姓名',
                report_date CHAR(10) NOT NULL COMMENT '报告日期 YYYY-MM-DD',
                from_time CHAR(5) DEFAULT NULL COMMENT '作业开始时间 HH:mm',
                to_time CHAR(5) DEFAULT NULL COMMENT '作业结束时间 HH:mm',
                use_time DECIMAL(10,2) DEFAULT 0.00 COMMENT '使用时长(小时)',
                projects VARCHAR(500) DEFAULT NULL COMMENT '主要工作项目',
                wk_type VARCHAR(20) DEFAULT NULL COMMENT '时间类别(生命平衡轮分类)',
                YYYY_MM CHAR(7) DEFAULT NULL COMMENT '年月 YYYY/MM',
                complete_time DATETIME DEFAULT NULL COMMENT '完成时间',
                create_time DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
                YYYY INT DEFAULT NULL COMMENT '年份',
                ruid INT DEFAULT NULL COMMENT '记录编号(关联 daily_report.id)',
                actual_date CHAR(10) DEFAULT NULL COMMENT '实际日期 YYYY-MM-DD',
                client_id VARCHAR(50) DEFAULT NULL COMMENT '客户名称',
                items_id VARCHAR(50) DEFAULT NULL COMMENT '专案代码',
                INDEX idx_ruid (ruid),
                INDEX idx_user_ym (user_id, YYYY_MM),
                INDEX idx_bu_ym (bu_no, YYYY_MM)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='工作日报明细表';
        `);
        console.log('✅ daily_report_detail 表已建立');

        for (const t of ['daily_report', 'daily_report_detail']) {
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
