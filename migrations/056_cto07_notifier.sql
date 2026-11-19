-- ============================================================
-- CTO-07 消息通知統一服務
-- ------------------------------------------------------------
-- 現況：alert_log 只有 channel 字段（inapp/email/...），
--       kpiAlertScanner 只寫 DB 不真發送（notify_status='SKIPPED'）。
-- 方案：
--   1. cams_notif_channel — 渠道配置（Email SMTP / 飛書 Webhook / 企微 Webhook / Slack）
--   2. cams_notif_subscription — 訂閱規則（誰訂閱哪些事件）
--   3. alert_log 擴展 notify_status（PENDING/SENT/FAILED/INAPP）+ 發送時間 + 錯誤
--   4. services/notifier.js — 統一發送入口（先寫隊列，再異步發送）
-- ============================================================

-- 1. 渠道配置
CREATE TABLE IF NOT EXISTS cams_notif_channel (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    channel_code    VARCHAR(40) NOT NULL COMMENT 'EMAIL/LARK_WEBHOOK/WXWORK_WEBHOOK/SLACK',
    channel_name    VARCHAR(80) NOT NULL COMMENT '顯示名稱',
    channel_type    VARCHAR(30) NOT NULL COMMENT 'email/webhook',
    config          JSON NOT NULL COMMENT 'SMTP 配置 或 Webhook URL',
    -- config 結構範例：
    --   Email: { host, port, secure, user, pass, from }
    --   Lark:  { webhook_url, secret, at_users, at_all }
    --   WxWork:{ webhook_url, at_users }
    scope_bus       JSON DEFAULT NULL COMMENT '此渠道覆蓋哪些 bu_no（null=所有）',
    inuse_flag      TINYINT DEFAULT 1,
    last_test_at    DATETIME DEFAULT NULL,
    last_test_ok    TINYINT DEFAULT NULL,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_code (channel_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CTO-07 通知渠道配置';

-- 2. 訂閱規則（誰訂閱哪些事件，發到哪個渠道）
CREATE TABLE IF NOT EXISTS cams_notif_subscription (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    event_type      VARCHAR(40) NOT NULL COMMENT 'ALERT/KPI_TRIGGER/AUDIT/SYSTEM/CUSTOM',
    event_cat       VARCHAR(40) DEFAULT '*' COMMENT '警報類別/審計模組',
    bu_no           VARCHAR(10) DEFAULT '*' COMMENT '公司範圍',
    role_filter     VARCHAR(20) DEFAULT '*' COMMENT '角色過濾 admin/operator/general/*',
    user_filter     JSON DEFAULT NULL COMMENT '指定 userId 列表（精準投放）',
    channel_code    VARCHAR(40) NOT NULL COMMENT '發往哪個渠道',
    priority        INT DEFAULT 50 COMMENT '優先級，數字越小越先發',
    inuse_flag      TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_event (event_type, event_cat),
    INDEX idx_bu (bu_no),
    KEY idx_channel (channel_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CTO-07 通知訂閱規則';

-- 3. alert_log 擴展（加發送狀態）
-- 檢查已存在字段避免重複
-- ALTER TABLE alert_log ADD COLUMN notify_status ENUM('PENDING','SENT','FAILED','INAPP','SKIPPED') DEFAULT 'SKIPPED';
-- ALTER TABLE alert_log ADD COLUMN notify_channels VARCHAR(200) DEFAULT NULL COMMENT '實際發送的渠道列表 JSON';
-- ALTER TABLE alert_log ADD COLUMN notify_error VARCHAR(500) DEFAULT NULL;
-- ALTER TABLE alert_log ADD COLUMN notify_sent_at DATETIME DEFAULT NULL;

-- 4. 預設渠道（從環境變數讀，config 先設空，notifier.js 啟動時用 env 覆蓋）
INSERT INTO cams_notif_channel (channel_code, channel_name, channel_type, config, scope_bus) VALUES
('EMAIL_DEFAULT',   '預設 Email',   'email',   JSON_OBJECT('host','','port',587,'secure',0,'user','','pass','','from',''),  NULL),
('LARK_DEFAULT',    '飛書群機器人',  'webhook', JSON_OBJECT('webhook_url','','secret','','at_all',0,'at_users',JSON_ARRAY()),   NULL),
('WXWORK_DEFAULT',  '企微群機器人',  'webhook', JSON_OBJECT('webhook_url','','at_users',JSON_ARRAY()),                         NULL)
ON DUPLICATE KEY UPDATE channel_name=VALUES(channel_name), update_time=NOW();

-- 5. 預設訂閱規則
INSERT INTO cams_notif_subscription (event_type, event_cat, bu_no, role_filter, channel_code, priority, inuse_flag) VALUES
('ALERT',    '*', '*', 'admin',    'LARK_DEFAULT',   10, 1),
('ALERT',    '*', '*', 'operator', 'LARK_DEFAULT',   20, 1),
('ALERT',    '*', '*', 'admin',    'EMAIL_DEFAULT',  30, 1),
('AUDIT',    'CRITICAL', '*', 'admin',   'LARK_DEFAULT',   5,  1),
('KPI_TRIGGER', 'FINANCE', '*', 'admin', 'EMAIL_DEFAULT',  15, 1),
('KPI_TRIGGER', 'FINANCE', '*', 'operator','EMAIL_DEFAULT', 25, 1)
ON DUPLICATE KEY UPDATE update_time=NOW();