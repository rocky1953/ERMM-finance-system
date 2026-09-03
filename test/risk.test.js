/**
 * Risk API 測試
 *
 * 修復內容回顧：
 *  1. ttl_debet 欄位名從 debet_amt 改為 ttl_debet_amt (正確讀取)
 *  2. current_asset 改用 current_asset_amt (calcPL 計算的匯總值)
 *  3. current_debet 改用 current_debet_amt
 *  4. Z-Score 公式: Z = 1.2*X1 + 1.4*X2 + 3.3*X3 + 0.6*X4 + 0.999*X5
 *  5. 燈號判定: Z<1.23 RED, 1.23≤Z<2.9 YELLOW, Z≥2.9 GREEN
 */
const { request, app, TEST_BU, TEST_YM, cleanupTestData, seedTestSummary, closePool } = require('./setup');

describe('Risk API', () => {
    beforeAll(async () => {
        await cleanupTestData();
        // 寫入測試摘要 (含資產負債資料)
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
        // 先跑 calcPL 計算匯總值
        await request(app)
            .post('/api/summary/calcPL')
            .send({ bu_no: TEST_BU, YYYY_MM: TEST_YM });
    });

    afterAll(async () => {
        await cleanupTestData();
        await closePool();
    });

    describe('POST /api/risk/calc — 風險模型計算', () => {
        test('應成功計算並回傳 5 套模型', async () => {
            const res = await request(app)
                .post('/api/risk/calc')
                .send({ bu_no: TEST_BU, YYYY_MM: TEST_YM });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const d = res.body.data;
            expect(d.Z_models).toBeDefined();
            expect(d.Z_models.Z_score).toBeDefined();
            expect(d.Z_models.Z2_score).toBeDefined();
            expect(d.Z_models.Z3_score).toBeDefined();
            expect(d.BZ_model).toBeDefined();
            expect(d.JZ_model).toBeDefined();
        });

        // 修復 1: 正確讀取 ttl_debet_amt 而非 debet_amt
        test('Z-Score 值應在合理範圍 (0~10)，不應是百萬級異常值', async () => {
            const res = await request(app)
                .post('/api/risk/calc')
                .send({ bu_no: TEST_BU, YYYY_MM: TEST_YM });
            const z = Number(res.body.data.Z_models.Z_score.value);
            // 之前 bug: 讀錯欄位導致 Z = 7380000，修復後應在 0~10 之間
            expect(z).toBeGreaterThan(0);
            expect(z).toBeLessThan(20);
        });

        test('5 個 X 變數應全部有值且不為 NaN', async () => {
            const res = await request(app)
                .post('/api/risk/calc')
                .send({ bu_no: TEST_BU, YYYY_MM: TEST_YM });
            const v = res.body.data.variables;
            expect(v.X1).not.toBeNaN();
            expect(v.X2).not.toBeNaN();
            expect(v.X3).not.toBeNaN();
            expect(v.X4).not.toBeNaN();
            expect(v.X5).not.toBeNaN();
        });

        test('X1 (營運資金/總資產) 應為正值', async () => {
            const res = await request(app)
                .post('/api/risk/calc')
                .send({ bu_no: TEST_BU, YYYY_MM: TEST_YM });
            const x1 = res.body.data.variables.X1;
            // current_asset(11300000) - current_debet(3000000) = 8300000
            // ttl_asset = 11300000 → X1 = 8300000/11300000 ≈ 0.7345
            expect(x1).toBeGreaterThan(0.5);
            expect(x1).toBeLessThan(1.0);
        });

        test('X4 (股東權益/總負債) 應為正值', async () => {
            const res = await request(app)
                .post('/api/risk/calc')
                .send({ bu_no: TEST_BU, YYYY_MM: TEST_YM });
            const x4 = res.body.data.variables.X4;
            // equity(12300000) / ttl_debet(3000000) = 4.1
            expect(x4).toBeGreaterThan(1);
            expect(x4).toBeLessThan(10);
        });

        test('應回傳正確的風險燈號 (GREEN/YELLOW/RED)', async () => {
            const res = await request(app)
                .post('/api/risk/calc')
                .send({ bu_no: TEST_BU, YYYY_MM: TEST_YM });
            const color = res.body.data.risk_color;
            expect(['GREEN', 'YELLOW', 'RED']).toContain(color);
        });

        test('Z≥2.9 時應為 GREEN', async () => {
            const res = await request(app)
                .post('/api/risk/calc')
                .send({ bu_no: TEST_BU, YYYY_MM: TEST_YM });
            const z = Number(res.body.data.Z_models.Z_score.value);
            const color = res.body.data.risk_color;
            if (z >= 2.9) expect(color).toBe('GREEN');
            else if (z >= 1.23) expect(color).toBe('YELLOW');
            else expect(color).toBe('RED');
        });

        test('應回傳比率分析', async () => {
            const res = await request(app)
                .post('/api/risk/calc')
                .send({ bu_no: TEST_BU, YYYY_MM: TEST_YM });
            const r = res.body.data.ratios;
            expect(r.current_ratio).toBeDefined();
            expect(r.quick_ratio).toBeDefined();
            expect(r.debt_ratio).toBeDefined();
            expect(r.ROE).toBeDefined();
            expect(r.ROA).toBeDefined();
            expect(r.gross_margin).toBeDefined();
            expect(r.net_margin).toBeDefined();
        });

        test('流動比率應大於 1 (有足夠流動性)', async () => {
            const res = await request(app)
                .post('/api/risk/calc')
                .send({ bu_no: TEST_BU, YYYY_MM: TEST_YM });
            const cr = Number(res.body.data.ratios.current_ratio);
            // current_asset(11300000) / current_debet(3000000) ≈ 3.767
            expect(cr).toBeGreaterThan(1);
        });

        test('毛利率應為 27% (1350000/5000000)', async () => {
            const res = await request(app)
                .post('/api/risk/calc')
                .send({ bu_no: TEST_BU, YYYY_MM: TEST_YM });
            const gm = res.body.data.ratios.gross_margin;
            expect(gm).toContain('27.00%');
        });

        test('摘要不存在時應回傳失敗', async () => {
            const res = await request(app)
                .post('/api/risk/calc')
                .send({ bu_no: TEST_BU, YYYY_MM: '2099/99' });
            expect(res.body.success).toBe(false);
        });
    });

    describe('GET /api/risk — 查詢風險結果', () => {
        test('應回傳已計算的風險資料', async () => {
            const res = await request(app)
                .get(`/api/risk?bu_no=${TEST_BU}&YYYY_MM=${TEST_YM}`);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.length).toBeGreaterThanOrEqual(1);
        });

        test('回傳資料應包含 Z_score 欄位', async () => {
            const res = await request(app)
                .get(`/api/risk?bu_no=${TEST_BU}&YYYY_MM=${TEST_YM}`);
            expect(res.body.data[0].Z_score).toBeDefined();
        });
    });
});
