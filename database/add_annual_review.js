/**
 * M1 年度績效自動生成 — 建表脚本（幂等）
 *   daily_report_annual_review 年度績效結算（同人同年唯一，UPSERT）
 *
 * 計分模型（權重）：
 *   工時達成率 40% + 提交及時率 30% + 工作占比達標率 20% + 延誤/未解扣分 10%
 *   等第：S≥95 / A 85-94 / B 70-84 / C<70
 *
 * 執行：node database/add_annual_review.js
 */
const { pool } = require('../config/db');

async function run() {
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS daily_report_annual_review (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            bu_no VARCHAR(20) NOT NULL,
            yyyy CHAR(4) NOT NULL COMMENT '年度',
            user_id VARCHAR(50) NOT NULL,
            user_name VARCHAR(100) DEFAULT NULL,
            depart_id VARCHAR(50) DEFAULT NULL,
            score_hours DECIMAL(5,2) DEFAULT 0 COMMENT '工時達成得分(0-100)',
            score_timeliness DECIMAL(5,2) DEFAULT 0 COMMENT '及時率得分(0-100)',
            score_workratio DECIMAL(5,2) DEFAULT 0 COMMENT '工作占比達標得分(0-100)',
            score_penalty DECIMAL(5,2) DEFAULT 0 COMMENT '延誤/未解扣分後得分(0-100)',
            total_score DECIMAL(5,2) DEFAULT 0 COMMENT '年度綜合得分',
            grade CHAR(1) DEFAULT 'C' COMMENT '等第 S/A/B/C',
            avg_hours_achieve DECIMAL(6,2) DEFAULT NULL COMMENT '平均工時達成率%',
            annual_timeliness DECIMAL(5,2) DEFAULT 0 COMMENT '年度及時率%',
            months_submitted INT DEFAULT 0 COMMENT '有提交的月數',
            months_locked INT DEFAULT 0 COMMENT '已鎖定月數',
            over_months INT DEFAULT 0 COMMENT '延誤/未解超標月數',
            review_data JSON COMMENT '12個月明細快取',
            generated_by VARCHAR(50) DEFAULT NULL,
            generated_by_name VARCHAR(100) DEFAULT NULL,
            generated_time DATETIME DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_bu_user_year (bu_no, user_id, yyyy),
            INDEX idx_bu_year_grade (bu_no, yyyy, grade),
            INDEX idx_bu_dept (bu_no, depart_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='年度績效自動結算'
    `);
    console.log('✅ daily_report_annual_review 已建立');
    await pool.end();
}
run().catch(e => { console.error(e); process.exit(1); });
