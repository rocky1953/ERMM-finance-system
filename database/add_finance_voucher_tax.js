/**
 * 財務入帳 / 報稅 / 勾稽對帳 — 冪等遷移
 *   1. fin_ruid_ledger        RUID 主台帳（貫通入帳、報稅、勾稽）
 *   2. fin_account_subject    會計科目表
 *   3. fin_voucher            會計憑證（頭）
 *   4. fin_voucher_entry      憑證分錄（明細）
 *   5. fin_tax_return         納稅申報表（頭）
 *   6. fin_tax_return_item    申報明細
 *   7. fin_reconciliation     入帳與報稅勾稽對帳
 *
 * 執行：node database/add_finance_voucher_tax.js
 */
const { pool } = require('../config/db');

async function tableExists(name) {
    const [r] = await pool.execute(
        `SELECT COUNT(*) c FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?`, [name]);
    return r[0].c > 0;
}

async function columnExists(table, col) {
    const [r] = await pool.execute(
        `SELECT COUNT(*) c FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?`, [table, col]);
    return r[0].c > 0;
}

async function addColumnIfMissing(table, col, def) {
    if (!(await columnExists(table, col))) {
        await pool.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
}

async function run() {
    // 1. RUID 主台帳
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS fin_ruid_ledger (
            ruid VARCHAR(40) NOT NULL,
            bu_no VARCHAR(20) NOT NULL,
            biz_type VARCHAR(20) NOT NULL COMMENT 'VOUCHER 入帳 / TAX 報稅',
            source_id VARCHAR(50) DEFAULT NULL COMMENT '來源單號(憑證號/申報號)',
            amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
            status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
            create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            remark VARCHAR(500) DEFAULT NULL,
            PRIMARY KEY (ruid),
            KEY idx_bu_type (bu_no, biz_type),
            KEY idx_source (source_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RUID 全鏈路主台帳'
    `);

    // 2. 會計科目表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS fin_account_subject (
            subject_code VARCHAR(20) NOT NULL,
            subject_name VARCHAR(100) NOT NULL,
            subject_type VARCHAR(20) NOT NULL COMMENT '資產/負債/權益/收入/費用',
            parent_code VARCHAR(20) DEFAULT NULL,
            balance_dir VARCHAR(3) NOT NULL DEFAULT 'DR' COMMENT 'DR 借方/CR 貸方',
            is_active TINYINT NOT NULL DEFAULT 1,
            remark VARCHAR(300) DEFAULT NULL,
            PRIMARY KEY (subject_code),
            KEY idx_type (subject_type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='會計科目表'
    `);

    // 3. 會計憑證（頭）
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS fin_voucher (
            voucher_id BIGINT NOT NULL AUTO_INCREMENT,
            bu_no VARCHAR(20) NOT NULL,
            ruid VARCHAR(40) NOT NULL,
            voucher_no VARCHAR(50) NOT NULL,
            voucher_date DATE NOT NULL,
            YYYY_MM VARCHAR(10) NOT NULL,
            summary VARCHAR(500) DEFAULT NULL,
            total_debit DECIMAL(18,2) NOT NULL DEFAULT 0.00,
            total_credit DECIMAL(18,2) NOT NULL DEFAULT 0.00,
            status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT/SUBMITTED/APPROVED/REJECTED/POSTED',
            created_by VARCHAR(50) DEFAULT NULL,
            approved_by VARCHAR(50) DEFAULT NULL,
            approved_time DATETIME DEFAULT NULL,
            posted_time DATETIME DEFAULT NULL,
            reject_reason VARCHAR(500) DEFAULT NULL,
            remark VARCHAR(500) DEFAULT NULL,
            create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (voucher_id),
            UNIQUE KEY uk_ruid (ruid),
            KEY idx_bu_period (bu_no, YYYY_MM),
            KEY idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='會計憑證'
    `);

    // 4. 憑證分錄
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS fin_voucher_entry (
            entry_id BIGINT NOT NULL AUTO_INCREMENT,
            voucher_id BIGINT NOT NULL,
            ruid VARCHAR(40) NOT NULL,
            subject_code VARCHAR(20) NOT NULL,
            subject_name VARCHAR(100) DEFAULT NULL,
            debit DECIMAL(18,2) NOT NULL DEFAULT 0.00,
            credit DECIMAL(18,2) NOT NULL DEFAULT 0.00,
            summary VARCHAR(300) DEFAULT NULL,
            source_doc VARCHAR(100) DEFAULT NULL COMMENT '來源單據:發票號/銀行回單號',
            PRIMARY KEY (entry_id),
            KEY idx_voucher (voucher_id),
            KEY idx_ruid (ruid),
            KEY idx_subject (subject_code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='會計憑證分錄'
    `);

    // 5. 納稅申報表（頭）
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS fin_tax_return (
            return_id BIGINT NOT NULL AUTO_INCREMENT,
            bu_no VARCHAR(20) NOT NULL,
            ruid VARCHAR(40) NOT NULL,
            tax_type VARCHAR(30) NOT NULL COMMENT 'VAT 增值稅/IT 企業所得稅/ST 印花稅/others',
            tax_period VARCHAR(10) NOT NULL COMMENT 'YYYY-MM',
            taxable_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
            tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
            status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT/CALCULATED/SUBMITTED/APPROVED/FILED/REJECTED',
            filed_time DATETIME DEFAULT NULL,
            receipt_no VARCHAR(100) DEFAULT NULL COMMENT '稅務回執號',
            remark VARCHAR(500) DEFAULT NULL,
            create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (return_id),
            UNIQUE KEY uk_ruid (ruid),
            KEY idx_bu_period (bu_no, tax_period),
            KEY idx_type (tax_type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='納稅申報表'
    `);

    // 6. 申報明細
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS fin_tax_return_item (
            item_id BIGINT NOT NULL AUTO_INCREMENT,
            return_id BIGINT NOT NULL,
            ruid VARCHAR(40) NOT NULL,
            subject_code VARCHAR(20) DEFAULT NULL,
            item_name VARCHAR(200) DEFAULT NULL,
            taxable_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
            tax_rate DECIMAL(10,4) NOT NULL DEFAULT 0.0000,
            tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
            remark VARCHAR(300) DEFAULT NULL,
            PRIMARY KEY (item_id),
            KEY idx_return (return_id),
            KEY idx_ruid (ruid)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='納稅申報明細'
    `);

    // 7. 勾稽對帳
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS fin_reconciliation (
            recon_id BIGINT NOT NULL AUTO_INCREMENT,
            bu_no VARCHAR(20) NOT NULL,
            period VARCHAR(10) NOT NULL COMMENT 'YYYY-MM',
            voucher_ruid VARCHAR(40) DEFAULT NULL,
            tax_ruid VARCHAR(40) DEFAULT NULL,
            voucher_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
            tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
            diff_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
            match_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' COMMENT 'MATCHED/UNMATCHED/AMOUNT_DIFF/HANDLED',
            handled TINYINT NOT NULL DEFAULT 0,
            remark VARCHAR(500) DEFAULT NULL,
            create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (recon_id),
            KEY idx_bu_period (bu_no, period),
            KEY idx_status (match_status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='入帳與報稅勾稽對帳'
    `);

    // 種子：常用會計科目
    const subjects = [
        ['1001', '庫存現金', '資產', null, 'DR'],
        ['1002', '銀行存款', '資產', null, 'DR'],
        ['1122', '應收帳款', '資產', null, 'DR'],
        ['1403', '原材料', '資產', null, 'DR'],
        ['1405', '庫存商品', '資產', null, 'DR'],
        ['1601', '固定資產', '資產', null, 'DR'],
        ['2202', '應付帳款', '負債', null, 'CR'],
        ['2221', '應交稅費', '負債', null, 'CR'],
        ['2211', '應付職工薪酬', '負債', null, 'CR'],
        ['4001', '實收資本', '權益', null, 'CR'],
        ['4101', '盈餘公積', '權益', null, 'CR'],
        ['6001', '主營業務收入', '收入', null, 'CR'],
        ['6051', '其他業務收入', '收入', null, 'CR'],
        ['6401', '主營業務成本', '費用', null, 'DR'],
        ['6601', '銷售費用', '費用', null, 'DR'],
        ['6602', '管理費用', '費用', null, 'DR'],
        ['6603', '財務費用', '費用', null, 'DR'],
        ['6801', '所得稅費用', '費用', null, 'DR']
    ];
    for (const [code, name, type, parent, dir] of subjects) {
        await pool.execute(
            `INSERT IGNORE INTO fin_account_subject (subject_code, subject_name, subject_type, parent_code, balance_dir) VALUES (?,?,?,?,?)`,
            [code, name, type, parent, dir]);
    }

    console.log('✅ 財務入帳/報稅/勾稽 相關表與科目種子已就緒');
    await pool.end();
}

run().catch(e => { console.error('❌ 失敗：', e.message); process.exit(1); });
