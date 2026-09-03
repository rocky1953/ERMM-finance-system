/**
 * ERMM API 測試設定 — Jest + Supertest
 *
 * 測試策略：
 *  - 對真實 MySQL (ERMM_db) 做整合測試 (Integration Test)
 *  - 測試前確保伺服器已啟動且 DB 已連線
 *  - 每個測試套件使用獨立的測試資料 (bu_no='TEST' / YYYY_MM='2099/01')
 *  - 測試後清理測試資料
 */
require('dotenv').config();
const request = require('supertest');
const app = require('../app');
const { pool } = require('../config/db');

// 測試用常數
const TEST_BU = 'TEST';
const TEST_YM = '2099/01';
const TEST_YEAR = '2099';

// 工具：清理測試資料
async function cleanupTestData() {
    const tables = [
        'MGM_bank_loan_details',
        'MGM_finance_summary',
        'forecast_detail',
        'MGM_KPI_desc',
        'MGM_casher_details',
        'pay_detail',
        'check_detail',
        'MGM_invoice_details'
    ];
    for (const t of tables) {
        try {
            await pool.execute(`DELETE FROM ${t} WHERE bu_no=?`, [TEST_BU]);
        } catch (e) { /* 表可能不存在，忽略 */ }
    }
}

// 工具：寫入測試摘要
async function seedTestSummary(overrides = {}) {
    await pool.execute(`
        INSERT INTO MGM_finance_summary (bu_no, YYYY_MM, YYYY, MM, flag, batch_id,
            sale_amt, sale_cost_amt, sale_exp_amt, MGM_EXP_amt, finance_EXP_amt,
            cash_amt, deposite_amt, AR_amt, AP_amt, loan_amt,
            stock_P_amt, stock_M_amt, captial_stock, captial_reserve, accumulated_amt,
            VAT_rate)
        VALUES (${Array(22).fill('?').join(',')})
        ON DUPLICATE KEY UPDATE
            sale_amt=VALUES(sale_amt), sale_cost_amt=VALUES(sale_cost_amt),
            sale_exp_amt=VALUES(sale_exp_amt), MGM_EXP_amt=VALUES(MGM_EXP_amt),
            finance_EXP_amt=VALUES(finance_EXP_amt), cash_amt=VALUES(cash_amt),
            deposite_amt=VALUES(deposite_amt), AR_amt=VALUES(AR_amt),
            AP_amt=VALUES(AP_amt), loan_amt=VALUES(loan_amt),
            stock_P_amt=VALUES(stock_P_amt), stock_M_amt=VALUES(stock_M_amt),
            captial_stock=VALUES(captial_stock), captial_reserve=VALUES(captial_reserve),
            accumulated_amt=VALUES(accumulated_amt), VAT_rate=VALUES(VAT_rate)
    `, [
        TEST_BU, TEST_YM, TEST_YEAR, '01', 'test', 'test',
        overrides.sale_amt ?? 5000000, overrides.sale_cost_amt ?? 3000000,
        overrides.sale_exp_amt ?? 300000, overrides.MGM_EXP_amt ?? 500000,
        overrides.finance_EXP_amt ?? 100000,
        overrides.cash_amt ?? 2000000, overrides.deposite_amt ?? 5000000,
        overrides.AR_amt ?? 3000000, overrides.AP_amt ?? 2000000,
        overrides.loan_amt ?? 1000000,
        overrides.stock_P_amt ?? 800000, overrides.stock_M_amt ?? 500000,
        overrides.captial_stock ?? 10000000, overrides.captial_reserve ?? 500000,
        overrides.accumulated_amt ?? 2000000,
        overrides.VAT_rate ?? 13
    ]);
}

module.exports = {
    request, app, pool,
    TEST_BU, TEST_YM, TEST_YEAR,
    cleanupTestData, seedTestSummary,
    closePool: async () => { await pool.end(); }
};
