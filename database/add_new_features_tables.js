/**
 * 新增功能資料表遷移腳本
 * 建立 action_task / alert_rule / alert_log 三張表與種子資料
 * 執行：node database/add_new_features_tables.js
 */
const { pool } = require('../config/db');

async function run() {
    try {
        // 1. action_task 行動任務表
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS action_task (
                uid INT AUTO_INCREMENT PRIMARY KEY,
                bu_no VARCHAR(10) NOT NULL,
                source_kpi VARCHAR(50) DEFAULT NULL,
                title VARCHAR(200) NOT NULL,
                description TEXT,
                assignee VARCHAR(50) DEFAULT NULL,
                due_date DATE DEFAULT NULL,
                target_value DECIMAL(18,2) DEFAULT NULL,
                current_value DECIMAL(18,2) DEFAULT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                progress INT DEFAULT 0,
                priority VARCHAR(20) DEFAULT 'medium',
                created_by VARCHAR(50) DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_bu_status (bu_no, status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        console.log('✅ action_task 表已建立');

        // 2. alert_rule 預警規則表
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS alert_rule (
                uid INT AUTO_INCREMENT PRIMARY KEY,
                rule_name VARCHAR(100) NOT NULL,
                bu_no VARCHAR(10) DEFAULT NULL,
                kpi_id VARCHAR(50) NOT NULL,
                cond VARCHAR(10) NOT NULL DEFAULT 'lt',
                threshold DECIMAL(18,4) NOT NULL,
                notify_channel VARCHAR(200) DEFAULT 'email',
                notify_user VARCHAR(200) DEFAULT NULL,
                cooldown_hours INT DEFAULT 24,
                status TINYINT DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_bu (bu_no)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        console.log('✅ alert_rule 表已建立');

        // 3. alert_log 通知紀錄表
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
                INDEX idx_bu_read (bu_no, is_read)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        console.log('✅ alert_log 表已建立');

        // 4. 種子資料：預警規則
        const [ruleCnt] = await pool.execute('SELECT COUNT(*) AS c FROM alert_rule');
        if (ruleCnt[0].c === 0) {
            await pool.execute(`
                INSERT INTO alert_rule (rule_name, bu_no, kpi_id, cond, threshold, notify_channel, notify_user, cooldown_hours, status) VALUES
                ('毛利率低於門檻', NULL, 'gross_profit', 'lt', 20, 'email,line', 'manager', 24, 1),
                ('淨利率低於門檻', NULL, 'net_profit_margin', 'lt', 5, 'email', 'manager', 24, 1),
                ('流動比率過低', NULL, 'current_ratio', 'lt', 1.5, 'email,sms', 'finance', 12, 1),
                ('負債比率過高', NULL, 'debt_ratio', 'gt', 70, 'email,line', 'finance', 24, 1),
                ('應收周轉率過低', NULL, 'ar_turn', 'lt', 4, 'email', 'finance', 48, 1)
            `);
            console.log('✅ 預警規則種子資料已載入 (5 筆)');
        }

        // 5. 種子資料：預警紀錄
        const [logCnt] = await pool.execute('SELECT COUNT(*) AS c FROM alert_log');
        if (logCnt[0].c === 0) {
            await pool.execute(`
                INSERT INTO alert_log (rule_id, bu_no, kpi_id, kpi_name, current_value, threshold, level, title, message, suggestion, channel, is_read) VALUES
                (1, 'HM', 'gross_profit', '銷售毛利率', 15.2, 20, 'danger', '🚨 毛利率跌破門檻', '當月銷售毛利率 15.2%，低於門檻 20%', '檢討原物料採購價格與產品組合，至多維下鑽查看產品毛利排行', 'email,line', 0),
                (3, 'HM', 'current_ratio', '流動比率', 1.2, 1.5, 'warning', '⚠️ 流動比率偏低', '流動比率 1.2，低於安全門檻 1.5', '加速應收帳款回收，償還短期借款', 'email,sms', 0),
                (4, 'SZ', 'debt_ratio', '負債比率', 78.5, 70, 'danger', '🚨 負債比率過高', '負債比率 78.5%，高於門檻 70%', '評估償還高利率借款，與銀行協商降息', 'email,line', 0),
                (5, 'HN', 'ar_turn', '應收帳款周轉率', 2.8, 4, 'warning', '⚠️ 應收周轉率下降', '應收帳款周轉率 2.8 次，低於門檻 4 次', '檢討信用政策，加強催收逾期帳款', 'email', 1)
            `);
            console.log('✅ 預警紀錄種子資料已載入 (4 筆)');
        }

        // 6. 種子資料：行動任務
        const [taskCnt] = await pool.execute('SELECT COUNT(*) AS c FROM action_task');
        if (taskCnt[0].c === 0) {
            await pool.execute(`
                INSERT INTO action_task (bu_no, source_kpi, title, description, assignee, due_date, status, progress, priority, created_by) VALUES
                ('HM', 'gross_profit', '檢討低毛利產品', '針對毛利率低於 10% 的產品進行成本分析與定價調整', '王小明', '2025-07-15', 'doing', 40, 'high', 'admin'),
                ('HM', 'current_ratio', '加速應收帳款回收', '盤點逾期 60 天以上應收帳款，訂定催收計畫', '李會計', '2025-07-20', 'pending', 0, 'high', 'admin'),
                ('HM', NULL, '與供應商協商付款條件', '爭取延長帳期至 60 天，降低現金流出壓力', '張採購', '2025-07-30', 'pending', 0, 'medium', 'admin'),
                ('SZ', 'debt_ratio', '償還高利率借款', '評估償還利率最高的銀行借款', '陳財務', '2025-08-10', 'doing', 20, 'high', 'admin'),
                ('HN', 'ar_turn', '修訂信用政策', '重新檢視客戶信用額度與付款天數', '林業務', '2025-08-05', 'pending', 0, 'medium', 'admin'),
                ('HM', 'gross_profit', '優化產品組合', '提高高毛利產品銷售佔比', '王小明', '2025-08-15', 'pending', 0, 'medium', 'admin'),
                ('HM', NULL, '建立庫存週轉追蹤機制', '每週檢視庫存天數，避免過度備貨', '李會計', '2025-07-01', 'done', 100, 'low', 'admin')
            `);
            console.log('✅ 行動任務種子資料已載入 (7 筆)');
        }

        console.log('\n🎉 所有新增功能資料表與種子資料設定完成！');
        process.exit(0);
    } catch (err) {
        console.error('❌ 遷移失敗:', err.message);
        process.exit(1);
    }
}

run();
