/**
 * ERMM_db 種子資料 (Seed Data)
 * 系統碼表、公司別、匯率、KPI 門檻等初始化資料
 */
const { pool } = require('../config/db');

async function seed() {
    console.log('🌱 開始寫入種子資料...');
    const conn = await pool.getConnection();

    try {
        await conn.beginTransaction();

        // 1. cams_system_codes - CURRENCY 匯率
        await conn.query(`
            INSERT INTO cams_system_codes (code_type, code_value, value_description, value_number1, value_number3, inuse_flag) VALUES
            ('CURRENCY', 'TWD', '新台幣', 1.000000, 0, 'USE'),
            ('CURRENCY', 'USD', '美金', 32.500000, 0, 'USE'),
            ('CURRENCY', 'RMB', '人民幣', 4.500000, 0, 'USE'),
            ('CURRENCY', 'EUR', '歐元', 35.200000, 0, 'USE'),
            ('CURRENCY', 'JPY', '日圓', 0.210000, 0, 'USE'),
            ('CURRENCY', 'HKD', '港幣', 4.180000, 0, 'USE')
            ON DUPLICATE KEY UPDATE value_number1=VALUES(value_number1)
        `);

        // 2. cams_system_codes - BUSINESS_ID 公司別 + VAT 稅率
        await conn.query(`
            INSERT INTO cams_system_codes (code_type, code_value, value_description, value_number3, inuse_flag) VALUES
            ('BUSINESS_ID', 'HM', '鉑漢科技', 13.0, 'USE'),
            ('BUSINESS_ID', 'LD', '利騰科技', 13.0, 'USE'),
            ('BUSINESS_ID', 'MQ', 'MQ 公司', 13.0, 'USE'),
            ('BUSINESS_ID', 'JS', 'JS 公司', 13.0, 'USE'),
            ('BUSINESS_ID', 'VENTEC', 'Ventec', 13.0, 'USE'),
            ('BUSINESS_ID', 'ICHIA', 'Ichia', 13.0, 'USE'),
            ('BUSINESS_ID', 'GY', 'GY 公司', 9.0, 'USE'),
            ('BUSINESS_ID', 'DEFAULT', '預設', 13.0, 'USE')
            ON DUPLICATE KEY UPDATE value_number3=VALUES(value_number3)
        `);

        // 3. cams_system_codes - AGEING_STOCK 庫存老化減值率
        await conn.query(`
            INSERT INTO cams_system_codes (code_type, code_value, value_description, value_number1, inuse_flag) VALUES
            ('AGEING_STOCK', '0-30天', '庫存老化 0-30天', 0.0, 'USE'),
            ('AGEING_STOCK', '31-90天', '庫存老化 31-90天', 5.0, 'USE'),
            ('AGEING_STOCK', '91-180天', '庫存老化 91-180天', 15.0, 'USE'),
            ('AGEING_STOCK', '181-365天', '庫存老化 181-365天', 30.0, 'USE'),
            ('AGEING_STOCK', '365天以上', '庫存老化超過365天', 50.0, 'USE')
            ON DUPLICATE KEY UPDATE value_number1=VALUES(value_number1)
        `);

        // 4. cams_system_codes - BATCH_CONTROL 批次控制
        await conn.query(`
            INSERT INTO cams_system_codes (code_type, code_value, value_description, inuse_flag) VALUES
            ('BATCH_CONTROL', 'STEP1', 'erp2ermm_po', 'USE'),
            ('BATCH_CONTROL', 'STEP2', 'proc_po', 'USE'),
            ('BATCH_CONTROL', 'STEP3', 'proc_supplier', 'USE'),
            ('BATCH_CONTROL', 'STEP4', 'proc_xitems_link_lawbook', 'USE'),
            ('BATCH_CONTROL', 'STEP5', 'cal_daily_stock_balance', 'USE'),
            ('BATCH_CONTROL', 'STEP6', 'batch_ARAP_upd', 'USE'),
            ('BATCH_CONTROL', 'STEP7', 'batch_finance_summary', 'USE')
            ON DUPLICATE KEY UPDATE value_description=VALUES(value_description)
        `);

        // 5. 預設使用者
        await conn.query(`
            INSERT INTO cams_xuser (xuser_id, xuser_password, xuser_name) VALUES
            ('admin', 'admin', '系統管理員'),
            ('S10049', '68315711', '測試使用者')
            ON DUPLICATE KEY UPDATE xuser_name=VALUES(xuser_name)
        `);

        // 6. 權限設定
        await conn.query(`
            INSERT INTO leader_user (user_id, finance, class, procurement, sales, stock) VALUES
            ('admin', 'Y', '5', 'Y', 'Y', 'Y'),
            ('S10049', 'Y', '3', 'Y', 'Y', 'Y')
            ON DUPLICATE KEY UPDATE class=VALUES(class)
        `);

        // 7. MGM_KPI_desc 初始化 - Z-Score 門檻
        await conn.query(`
            INSERT INTO MGM_KPI_desc (bu_no, KPI_id, KPI_name, KPI1, KPI2, pct_type, unit) VALUES
            ('HM', 'Z_score', 'Z-Score 破產風險', 1.23, 2.90, 'asc', '分'),
            ('HM', 'current_ratio', '流動比率', 1.5, 3.0, 'asc', '%'),
            ('HM', 'quick_ratio', '速動比率', 1.0, 2.0, 'asc', '%'),
            ('HM', 'debt_ratio', '負債比率', 50, 70, 'asc', '%'),
            ('HM', 'ROA', '資產報酬率', 2, 10, 'asc', '%'),
            ('HM', 'ROE', '股東權益報酬率', 5, 20, 'asc', '%'),
            ('HM', 'gross_margin', '毛利率', 15, 40, 'asc', '%'),
            ('HM', 'net_margin', '淨利率', 5, 20, 'asc', '%'),
            ('HM', 'AR_ageing', '應收帳齡', 30, 90, 'desc', '天'),
            ('HM', 'AP_ageing', '應付帳齡', 30, 60, 'asc', '天')
            ON DUPLICATE KEY UPDATE KPI1=VALUES(KPI1), KPI2=VALUES(KPI2)
        `);

        // 對其他公司別複製 KPI 門檻
        const bus = ['LD', 'MQ', 'JS', 'VENTEC', 'ICHIA', 'GY'];
        for (const bu of bus) {
            await conn.query(`
                INSERT IGNORE INTO MGM_KPI_desc (bu_no, KPI_id, KPI_name, KPI1, KPI2, pct_type, unit)
                SELECT '${bu}', KPI_id, KPI_name, KPI1, KPI2, pct_type, unit FROM MGM_KPI_desc WHERE bu_no='HM'
            `);
        }

        await conn.commit();
        console.log('✅ 種子資料寫入成功!');

    } catch (err) {
        await conn.rollback();
        console.error('❌ 種子資料寫入失敗:', err.message);
        throw err;
    } finally {
        conn.release();
    }
}

// 匯出或直接執行
if (require.main === module) {
    seed().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

module.exports = seed;
