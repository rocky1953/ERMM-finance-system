/**
 * Summary API 測試
 *
 * 修復內容回顧：
 *  1. INSERT 使用 n() 包裹參數防止 undefined 綁定錯誤
 *  2. ON DUPLICATE KEY UPDATE 擴展為更新所有數值欄位 (不只 flag)
 *  3. YYYY/MM 從 YYYY_MM 自動解析
 *  4. calcPL 新增資產負債表匯總計算 (ttl_asset, ttl_debet, stockholder_amt 等)
 */
const { request, app, pool, TEST_BU, TEST_YM, TEST_YEAR, cleanupTestData, seedTestSummary, closePool } = require('./setup');

describe('Summary API', () => {
    beforeAll(async () => {
        await cleanupTestData();
    });

    afterAll(async () => {
        await cleanupTestData();
        await closePool();
    });

    describe('POST /api/summary — 新增/更新摘要', () => {
        test('應成功寫入摘要且不報 undefined 綁定錯誤', async () => {
            const res = await request(app)
                .post('/api/summary')
                .send({
                    bu_no: TEST_BU,
                    YYYY_MM: TEST_YM,
                    sale_amt: 5000000,
                    sale_cost_amt: 3000000,
                    sale_exp_amt: 300000,
                    MGM_EXP_amt: 500000,
                    finance_EXP_amt: 100000,
                    cash_amt: 2000000,
                    deposite_amt: 5000000,
                    AR_amt: 3000000,
                    AP_amt: 2000000,
                    loan_amt: 1000000,
                    stock_P_amt: 800000,
                    stock_M_amt: 500000,
                    captial_stock: 10000000,
                    captial_reserve: 500000,
                    accumulated_amt: 2000000,
                    VAT_rate: 13
                });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).not.toContain('undefined');
        });

        test('YYYY/MM 應從 YYYY_MM 自動解析', async () => {
            // 寫入後查詢驗證 YYYY 和 MM 欄位
            const res = await request(app)
                .post('/api/summary')
                .send({
                    bu_no: TEST_BU,
                    YYYY_MM: '2099/02',
                    sale_amt: 6000000
                });
            expect(res.status).toBe(200);

            const [rows] = await pool.execute(
                'SELECT YYYY, MM FROM MGM_finance_summary WHERE bu_no=? AND YYYY_MM=?',
                [TEST_BU, '2099/02']
            );
            expect(rows[0].YYYY).toBe(TEST_YEAR);
            expect(rows[0].MM).toBe('02');
        });

        // 修復 2: ON DUPLICATE KEY UPDATE 更新所有數值
        test('重複寫入同月應更新數值而非保留舊值', async () => {
            // 先寫入 sale_amt=5000000
            await request(app)
                .post('/api/summary')
                .send({ bu_no: TEST_BU, YYYY_MM: '2099/03', sale_amt: 5000000, cash_amt: 100000 });

            // 再覆蓋 sale_amt=8000000
            const res2 = await request(app)
                .post('/api/summary')
                .send({ bu_no: TEST_BU, YYYY_MM: '2099/03', sale_amt: 8000000, cash_amt: 200000 });
            expect(res2.status).toBe(200);

            // 驗證 DB 中是最新的值
            const [rows] = await pool.execute(
                'SELECT sale_amt, cash_amt FROM MGM_finance_summary WHERE bu_no=? AND YYYY_MM=?',
                [TEST_BU, '2099/03']
            );
            expect(Number(rows[0].sale_amt)).toBe(8000000);
            expect(Number(rows[0].cash_amt)).toBe(200000);
        });
    });

    describe('POST /api/summary/addon — 預建12月', () => {
        test('應成功預建 12 個月摘要記錄', async () => {
            const res = await request(app)
                .post('/api/summary/addon')
                .send({ bu_no: TEST_BU, YYYY: '2098' });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toContain('12');

            const [rows] = await pool.execute(
                'SELECT COUNT(*) as cnt FROM MGM_finance_summary WHERE bu_no=? AND YYYY=?',
                [TEST_BU, '2098']
            );
            expect(Number(rows[0].cnt)).toBeGreaterThanOrEqual(12);
        });
    });

    describe('POST /api/summary/calcPL — 損益計算鏈', () => {
        beforeAll(async () => {
            // 確保測試月有資料
            await seedTestSummary({
                sale_amt: 5000000,
                sale_cost_amt: 3000000,
                sale_exp_amt: 300000,
                MGM_EXP_amt: 500000,
                finance_EXP_amt: 100000,
                cash_amt: 2000000,
                deposite_amt: 5000000,
                AR_amt: 3000000,
                AP_amt: 2000000,
                loan_amt: 1000000,
                stock_P_amt: 800000,
                stock_M_amt: 500000,
                captial_stock: 10000000,
                captial_reserve: 500000,
                accumulated_amt: 2000000,
                VAT_rate: 13
            });
        });

        test('應成功計算損益鏈 4 步', async () => {
            const res = await request(app)
                .post('/api/summary/calcPL')
                .send({ bu_no: TEST_BU, YYYY_MM: TEST_YM });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const d = res.body.data;
            // VAT_amt = 5000000 * 13% = 650000
            expect(d.VAT_amt).toBe(650000);
            // BIZ_major_margin = 5000000 - 3000000 - 650000 = 1350000
            expect(d.BIZ_major_margin).toBe(1350000);
            // BIZ_margin = 1350000 + 0 - 300000 - 500000 - 100000 = 450000
            expect(d.BIZ_margin).toBe(450000);
            // operation_profit = 450000 (無投資/補貼/其他)
            expect(d.operation_profit).toBe(450000);
            // net_profit = 450000 - 650000 = -200000
            expect(d.net_profit).toBe(-200000);
        });

        // 修復 4: calcPL 新增資產負債表匯總
        test('應計算並更新資產負債表匯總欄位', async () => {
            const res = await request(app)
                .post('/api/summary/calcPL')
                .send({ bu_no: TEST_BU, YYYY_MM: TEST_YM });
            expect(res.status).toBe(200);

            // 驗證 DB 中有匯總值
            const [rows] = await pool.execute(
                'SELECT ttl_asset_amt, ttl_debet_amt, stockholder_amt, current_asset_amt, current_debet_amt FROM MGM_finance_summary WHERE bu_no=? AND YYYY_MM=?',
                [TEST_BU, TEST_YM]
            );
            const r = rows[0];
            // current_asset = cash(2000000) + deposite(5000000) + AR(3000000) + stock_P(800000) + stock_M(500000) = 11300000
            expect(Number(r.current_asset_amt)).toBe(11300000);
            // current_debet = loan(1000000) + AP(2000000) = 3000000
            expect(Number(r.current_debet_amt)).toBe(3000000);
            // ttl_asset = current + non_current(0) = 11300000
            expect(Number(r.ttl_asset_amt)).toBe(11300000);
            // ttl_debet = current_debet + long_term(0) = 3000000
            expect(Number(r.ttl_debet_amt)).toBe(3000000);
            // stockholder = capital(10000000) + reserve(500000) + accumulated(2000000) + net_profit(-200000) = 12300000
            expect(Number(r.stockholder_amt)).toBe(12300000);
        });

        test('摘要不存在時應回傳失敗', async () => {
            const res = await request(app)
                .post('/api/summary/calcPL')
                .send({ bu_no: TEST_BU, YYYY_MM: '2099/99' });
            expect(res.body.success).toBe(false);
        });
    });

    describe('GET /api/summary — 列表查詢', () => {
        test('應回傳指定月份摘要', async () => {
            const res = await request(app)
                .get(`/api/summary?bu_no=${TEST_BU}&YYYY_MM=${TEST_YM}`);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.length).toBeGreaterThanOrEqual(1);
        });
    });
});
