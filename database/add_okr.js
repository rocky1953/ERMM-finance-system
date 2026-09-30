/**
 * M2 OKR 連結 — 建表脚本（幂等）
 *   daily_report_okr      月度 Objective（同人同月唯一）
 *   daily_report_okr_kr   Key Results（1 個 O 對應 1~5 條 KR）
 *   daily_report_annual_review 補充 okr_bonus 欄位（年度 OKR 加分，上限 +5）
 *
 * KR 完成率 = (actual-start)/(target-start)，截斷 0~120%，依權重加權
 *
 * 執行：node database/add_okr.js
 */
const { pool } = require('../config/db');

async function columnExists(table, col) {
    const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1`,
        [table, col]);
    return rows.length > 0;
}

async function run() {
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS daily_report_okr (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            bu_no VARCHAR(20) NOT NULL,
            user_id VARCHAR(50) NOT NULL,
            YYYY_MM CHAR(7) NOT NULL,
            objective VARCHAR(300) NOT NULL COMMENT 'O：本月目標',
            status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE/CLOSED',
            set_by VARCHAR(50) DEFAULT NULL,
            set_by_name VARCHAR(100) DEFAULT NULL,
            set_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_bu_user_ym (bu_no, user_id, YYYY_MM),
            INDEX idx_bu_ym (bu_no, YYYY_MM)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='月度OKR目標'
    `);
    console.log('✅ daily_report_okr 已建立');

    await pool.execute(`
        CREATE TABLE IF NOT EXISTS daily_report_okr_kr (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            okr_id BIGINT NOT NULL,
            bu_no VARCHAR(20) NOT NULL,
            user_id VARCHAR(50) NOT NULL,
            YYYY_MM CHAR(7) NOT NULL,
            seq INT DEFAULT 1 COMMENT '同O下序號',
            content VARCHAR(300) NOT NULL COMMENT '關鍵結果描述',
            start_val DECIMAL(18,2) DEFAULT 0,
            target_val DECIMAL(18,2) NOT NULL DEFAULT 0,
            actual_val DECIMAL(18,2) DEFAULT 0,
            unit VARCHAR(20) DEFAULT NULL,
            weight INT DEFAULT 100 COMMENT '權重（同O下加總100）',
            INDEX idx_okr (okr_id),
            INDEX idx_bu_user_ym (bu_no, user_id, YYYY_MM)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='OKR關鍵結果'
    `);
    console.log('✅ daily_report_okr_kr 已建立');

    // 年度績效表補 okr_bonus（冪等 ALTER）
    if (!(await columnExists('daily_report_annual_review', 'okr_bonus'))) {
        await pool.query(`ALTER TABLE daily_report_annual_review
                          ADD COLUMN okr_bonus DECIMAL(5,2) DEFAULT 0 COMMENT 'OKR加分(0-5)' AFTER score_penalty`);
        console.log('✅ daily_report_annual_review.okr_bonus 欄位已新增');
    } else {
        console.log('ℹ️  okr_bonus 欄位已存在，跳過');
    }

    await pool.end();
}
run().catch(e => { console.error(e); process.exit(1); });
