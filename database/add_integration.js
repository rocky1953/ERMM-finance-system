/**
 * 第三方資料整合模組建表
 *   intg_source — 第三方資料源連線設定（MySQL）
 *   intg_job    — 整合作業（SQL 直連 / Excel，Online 手動 / Batch 排程）
 *   intg_log    — 每次執行日誌（讀取列數/新增/更新/失敗/耗時/錯誤）
 *
 * 冪等：CREATE TABLE IF NOT EXISTS，可重複執行
 * 用法：node database/add_integration.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../config/db');

async function main() {
    // 1) 第三方資料源
    await pool.query(`
        CREATE TABLE IF NOT EXISTS intg_source (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            name        VARCHAR(100) NOT NULL UNIQUE COMMENT '資料源名稱',
            db_type     VARCHAR(20)  NOT NULL DEFAULT 'mysql' COMMENT 'mysql（本版僅支援 MySQL）',
            host        VARCHAR(200) NOT NULL,
            port        INT          NOT NULL DEFAULT 3306,
            db_name     VARCHAR(100) NOT NULL,
            db_user     VARCHAR(100) NOT NULL,
            db_password VARCHAR(200) DEFAULT NULL COMMENT '注意：本版明文儲存，正式環境應加密',
            charset     VARCHAR(30)  DEFAULT 'utf8mb4',
            enabled     TINYINT(1)   NOT NULL DEFAULT 1,
            remark      VARCHAR(500) DEFAULT NULL,
            created_by  VARCHAR(50)  DEFAULT NULL,
            created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='第三方資料源連線設定';
    `);

    // 2) 整合作業
    await pool.query(`
        CREATE TABLE IF NOT EXISTS intg_job (
            id             INT AUTO_INCREMENT PRIMARY KEY,
            name           VARCHAR(100) NOT NULL COMMENT '作業名稱',
            channel        VARCHAR(10)  NOT NULL DEFAULT 'SQL' COMMENT 'SQL=SQL直連 / EXCEL=Excel匯入',
            source_id      INT DEFAULT NULL COMMENT 'SQL 通道之資料源（intg_source.id）',
            source_sql     MEDIUMTEXT DEFAULT NULL COMMENT '第三方查詢 SQL（SELECT 開頭）',
            target_table   VARCHAR(100) NOT NULL COMMENT '本地目標資料表',
            column_mapping JSON DEFAULT NULL COMMENT '欄位映射 {來源欄: 目標欄}；null=同名對應',
            key_columns    VARCHAR(500) DEFAULT NULL COMMENT 'UPSERT 匹配欄（逗號分隔，須為 PK/UK）',
            write_mode     VARCHAR(20)  NOT NULL DEFAULT 'INSERT' COMMENT 'INSERT=僅新增 / UPSERT=新增或更新',
            mode           VARCHAR(10)  NOT NULL DEFAULT 'ONLINE' COMMENT 'ONLINE=手動即時 / BATCH=排程批次',
            schedule       VARCHAR(50)  DEFAULT NULL COMMENT 'daily HH:MM / every Nm（每N分鐘）',
            enabled        TINYINT(1)   NOT NULL DEFAULT 1,
            last_run_at    DATETIME DEFAULT NULL,
            last_status    VARCHAR(20) DEFAULT NULL COMMENT 'SUCCESS/FAIL/RUNNING',
            remark         VARCHAR(500) DEFAULT NULL,
            created_by     VARCHAR(50) DEFAULT NULL,
            created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_source (source_id),
            INDEX idx_enabled (enabled, mode)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='第三方資料整合作業';
    `);

    // 3) 執行日誌
    await pool.query(`
        CREATE TABLE IF NOT EXISTS intg_log (
            id            BIGINT AUTO_INCREMENT PRIMARY KEY,
            job_id        INT DEFAULT NULL,
            job_name      VARCHAR(100) NOT NULL,
            channel       VARCHAR(10) NOT NULL COMMENT 'SQL / EXCEL',
            run_type      VARCHAR(10) NOT NULL COMMENT 'MANUAL=線上手動 / SCHEDULED=排程 / EXCEL=Excel匯入',
            source_name   VARCHAR(100) DEFAULT NULL,
            target_table  VARCHAR(100) NOT NULL,
            file_name     VARCHAR(300) DEFAULT NULL COMMENT 'Excel 檔名',
            total_rows    INT NOT NULL DEFAULT 0,
            insert_rows   INT NOT NULL DEFAULT 0,
            update_rows   INT NOT NULL DEFAULT 0,
            error_rows    INT NOT NULL DEFAULT 0,
            status        VARCHAR(20) NOT NULL DEFAULT 'RUNNING' COMMENT 'RUNNING/SUCCESS/FAIL',
            error_msg      MEDIUMTEXT DEFAULT NULL,
            triggered_by  VARCHAR(50) DEFAULT NULL,
            started_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            finished_at   DATETIME DEFAULT NULL,
            duration_ms   INT DEFAULT NULL,
            INDEX idx_job (job_id),
            INDEX idx_started (started_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='資料整合執行日誌';
    `);

    console.log('✅ intg_source / intg_job / intg_log 建表完成（冪等）');
    process.exit(0);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
