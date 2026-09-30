/**
 * P1-③ 目标设定与管理：建表脚本（幂等）
 *
 * daily_report_target: 主管为员工设定月度绩效目标
 *   - 目标工时(target_hours)、延误上限(max_delays)、未解上限(max_unresolved)、工作占比下限(min_work_ratio)
 *   - 唯一键: bu_no + user_id + YYYY_MM（同人同月仅一条，重复设定自动覆盖）
 *
 * 用法: node database/add_daily_report_target.js
 */
const { pool } = require('../config/db');

(async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS daily_report_target (
                id INT AUTO_INCREMENT PRIMARY KEY,
                bu_no VARCHAR(10) NOT NULL,
                user_id VARCHAR(50) NOT NULL,
                YYYY_MM CHAR(7) NOT NULL,
                target_hours DECIMAL(8,2) DEFAULT NULL COMMENT '月度目标工时',
                max_delays INT DEFAULT NULL COMMENT '延误笔数上限',
                max_unresolved INT DEFAULT NULL COMMENT '未解笔数上限',
                min_work_ratio INT DEFAULT NULL COMMENT '工作占比下限(%)',
                set_by VARCHAR(50) NOT NULL COMMENT '设定人ID',
                set_by_name VARCHAR(100) DEFAULT '' COMMENT '设定人姓名',
                set_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                remark VARCHAR(500) DEFAULT NULL COMMENT '备注',
                UNIQUE KEY uk_bu_user_ym (bu_no, user_id, YYYY_MM),
                INDEX idx_bu_ym (bu_no, YYYY_MM)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='日报绩效目标设定'
        `);
        console.log('✅ daily_report_target 表已就绪');

        process.exit(0);
    } catch (err) {
        console.error('❌ 建表失败:', err.message);
        process.exit(1);
    }
})();
