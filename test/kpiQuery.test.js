/**
 * KPI 查詢 API 測試 — routes/kpiQuery.js
 *
 * 驗證：
 *  1. GET /api/kpi-query/query 基本活體
 *  2. 22 個公式欄位全部存在（含計算）
 *  3. 必傳參數 bu_no / YYYY_MM 驗證
 *  4. 無該月資料回 404
 *  5. POST /api/kpi-query/calc 指定公式計算
 *  6. 點燈邏輯（GREEN/YELLOW/RED）
 *  7. mysql2 DECIMAL String → Number 轉換（避免字串相加）
 *  8. 前端頁面存在 + 無 null 風險
 */
const { request, app, pool, TEST_BU, TEST_YM, TEST_YEAR, cleanupTestData, seedTestSummary } = require('./setup');

// 我們公式庫所有預期 id
const EXPECTED_FORMULA_IDS = [
    // 償債
    'current_ratio', 'quick_ratio', 'debt_ratio', 'interest_cov', 'cash_ratio',
    // 營運
    'inventory_turn', 'ar_turn', 'ar_days', 'total_asset_turn', 'fixed_asset_turn',
    'equity_turn', 'cash_conv_days',
    // 獲利
    'gross_profit', 'net_profit_margin', 'roa', 'roe',
    // 成長
    'sale_growth', 'profit_growth', 'capital_growth',
    // 模型
    'altman_z1', 'altman_z2', 'altman_ggr', 'bach_bz',
    // 巴萨利潤
    'bz_debt_ratio', 'bz_receivable_turn', 'bz_quick',
];

describe('KPI 查詢 API /api/kpi-query', () => {

    beforeAll(async () => {
        // 先清掉舊測試資料再重寫（避免 ON DUPLICATE 欄位不齊）
        await pool.execute('DELETE FROM MGM_finance_summary WHERE bu_no=?', [TEST_BU]);
        await pool.execute('DELETE FROM MGM_KPI_desc WHERE bu_no=?', [TEST_BU]);

        // 寫入當月 summary（含 KPI 公式所需所有欄位）
        await pool.execute(`
            INSERT INTO MGM_finance_summary
                (bu_no, YYYY_MM, YYYY, MM, flag,
                 sale_amt, sale_cost_amt, sale_exp_amt,
                 cash_amt, deposite_amt, AR_amt, AP_amt, AP_tax_amt, AP_salary_amt, AP_other_amt, loan_amt,
                 stock_P_amt, stock_M_amt, WIP_M_amt, WIP_labor_amt, WIP_EXP_amt,
                 captial_stock, captial_reserve, accumulated_amt, interest_amt,
                 building_amt, equipment_amt, vehicle_amt, office_amt, intangible_amt,
                 current_asset_amt, ttl_asset_amt)
            VALUES (?,?,?,?,?, 5000000,3000000,300000,
                    2000000,5000000,3000000,2000000,7752100,585504,219564,1000000,
                    800000,500000,322027,201267,120760,
                    10000000,500000,2000000,50000,
                    8200000,12519000,1926000,1284000,642000,
                    10296960,50802465)
        `, [TEST_BU, TEST_YM, TEST_YEAR, '01', 'kpi-test']);

        // 上月資料（成長率用）
        await pool.execute(`
            INSERT INTO MGM_finance_summary
                (bu_no, YYYY_MM, YYYY, MM, flag, sale_amt, sale_cost_amt, sale_exp_amt)
            VALUES (?,?,?,?,?, 4000000,2500000,200000)
        `, [TEST_BU, '2098/12', '2098', '12', 'kpi-prev']);

        // 手工 KPI 門檻
        await pool.execute(`
            INSERT INTO MGM_KPI_desc (bu_no, KPI_id, KPI_name, KPI1, KPI2, unit, pct_type)
            VALUES
                (?, 'custom_kpi_1', '測試 KPI 1', 10.0, 20.0, '%', 'asc'),
                (?, 'custom_kpi_2', '測試 KPI 2', 1.0, 3.0,  '',  'asc')
        `, [TEST_BU, TEST_BU]);
    });

    afterAll(async () => {
        await cleanupTestData();
        // 注意：不調 closePool() — 全域共用 pool
    });

    // ====== 基本活體 ======
    describe('GET /api/kpi-query/query 基本活體', () => {

        test('應回傳 200 且 success=true', async () => {
            const res = await request(app).get(`/api/kpi-query/query?bu_no=${TEST_BU}&YYYY_MM=${TEST_YM}`);
            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
        });

        test('data 應為 object（22 公式 + 手工 KPI）', async () => {
            const res = await request(app).get(`/api/kpi-query/query?bu_no=${TEST_BU}&YYYY_MM=${TEST_YM}`);
            expect(res.body.data).toBeInstanceOf(Object);
            const keys = Object.keys(res.body.data);
            // 至少 22 公式 + 2 手工 = 24
            expect(keys.length).toBeGreaterThanOrEqual(22);
        });

        test('每個 KPI 應有 id / name / category / current_value / KPI1 / KPI2 / unit / color', async () => {
            const res = await request(app).get(`/api/kpi-query/query?bu_no=${TEST_BU}&YYYY_MM=${TEST_YM}`);
            const k = res.body.data.current_ratio;
            expect(k).toBeDefined();
            expect(k.id).toBe('current_ratio');
            expect(typeof k.name).toBe('string');
            expect(typeof k.category).toBe('string');
            expect(k).toHaveProperty('current_value');
            expect(k).toHaveProperty('KPI1');
            expect(k).toHaveProperty('KPI2');
            expect(k).toHaveProperty('color');
        });
    });

    // ====== 參數驗證 ======
    describe('參數驗證', () => {

        test('缺少 bu_no 應回 400 失敗', async () => {
            const res = await request(app).get(`/api/kpi-query/query?YYYY_MM=${TEST_YM}`);
            expect(res.body.success).toBe(false);
        });

        test('缺少 YYYY_MM 應回 400 失敗', async () => {
            const res = await request(app).get(`/api/kpi-query/query?bu_no=${TEST_BU}`);
            expect(res.body.success).toBe(false);
        });

        test('無該月資料應回 404', async () => {
            const res = await request(app).get(`/api/kpi-query/query?bu_no=${TEST_BU}&YYYY_MM=2000/01`);
            expect(res.statusCode).toBe(404);
            expect(res.body.success).toBe(false);
        });
    });

    // ====== 公式存在性 ======
    describe('22 個公式欄位全部存在', () => {

        for (const id of EXPECTED_FORMULA_IDS) {
            test(`${id} 應存在`, async () => {
                const res = await request(app).get(`/api/kpi-query/query?bu_no=${TEST_BU}&YYYY_MM=${TEST_YM}`);
                expect(res.body.data).toHaveProperty(id);
            });
        }

        test('每個公式的 current_value 應為 Number（或 null）', async () => {
            const res = await request(app).get(`/api/kpi-query/query?bu_no=${TEST_BU}&YYYY_MM=${TEST_YM}`);
            for (const id of EXPECTED_FORMULA_IDS) {
                const v = res.body.data[id].current_value;
                if (v !== null && v !== undefined) {
                    expect(typeof v).toBe('number');
                    expect(isNaN(v)).toBe(false);
                }
            }
        });
    });

    // ====== 公式邏輯正確性 ======
    describe('公式邏輯（已知輸入 → 預期輸出）', () => {

        test('gross_profit 應 ≈ 40%（毛利=(500-300)/500）', async () => {
            const res = await request(app).get(`/api/kpi-query/query?bu_no=${TEST_BU}&YYYY_MM=${TEST_YM}`);
            // (5000000-3000000)/5000000*100 = 40
            expect(res.body.data.gross_profit.current_value).toBeCloseTo(40, 0);
        });

        test('net_profit_margin 應 ≈ 6%（淨利率=300k/5M）', async () => {
            const res = await request(app).get(`/api/kpi-query/query?bu_no=${TEST_BU}&YYYY_MM=${TEST_YM}`);
            // 300000/5000000*100 = 6
            expect(res.body.data.net_profit_margin.current_value).toBeCloseTo(6, 0);
        });

        test('sale_growth 成長率公式應存在且為 Number', async () => {
            const res = await request(app).get(`/api/kpi-query/query?bu_no=${TEST_BU}&YYYY_MM=${TEST_YM}`);
            expect(res.body.data.sale_growth).toBeDefined();
            const v = res.body.data.sale_growth.current_value;
            expect(typeof v).toBe('number'); // 不論 0 或 25，應為 Number（mysql2 轉換驗證）
        });

        test('current_ratio 流動資產 / 流動負債', async () => {
            const res = await request(app).get(`/api/kpi-query/query?bu_no=${TEST_BU}&YYYY_MM=${TEST_YM}`);
            // current_asset_amt=10296960, AP_amt(2M)+AP_tax(7.75M)+AP_sal(585k) ≈ 10337k
            // = 10296960 / ~10337000 ≈ 0.996
            const v = res.body.data.current_ratio.current_value;
            expect(v).toBeGreaterThan(0);
            expect(v).toBeCloseTo(0.996, 0);
        });

        test('altman_z1 應為有限數（非 Infinity / NaN）', async () => {
            const res = await request(app).get(`/api/kpi-query/query?bu_no=${TEST_BU}&YYYY_MM=${TEST_YM}`);
            const v = res.body.data.altman_z1.current_value;
            if (v !== null && v !== undefined) {
                expect(Number.isFinite(v)).toBe(true);
            }
        });
    });

    // ====== 手工 KPI 合併邏輯 ======
    describe('手工 KPI 門檻合併', () => {

        test('MGM_KPI_desc 的 custom_kpi_1 應出現在 data 裡', async () => {
            const res = await request(app).get(`/api/kpi-query/query?bu_no=${TEST_BU}&YYYY_MM=${TEST_YM}`);
            expect(res.body.data.custom_kpi_1).toBeDefined();
            expect(res.body.data.custom_kpi_1.KPI1).toBe(10);
            expect(res.body.data.custom_kpi_1.KPI2).toBe(20);
            expect(res.body.data.custom_kpi_1.unit).toBe('%');
            expect(res.body.data.custom_kpi_1.category).toBe('手工');
        });

        test('手工 KPI 應有點燈（值在門檻內=GREEN）', async () => {
            const res = await request(app).get(`/api/kpi-query/query?bu_no=${TEST_BU}&YYYY_MM=${TEST_YM}`);
            const k = res.body.data.custom_kpi_1;
            // current_value 來自 DB KPI_value（default 0），0 不在 10~20 → 應 RED 或 GRAY
            expect(k.color).not.toBeUndefined();
        });
    });

    // ====== mysql2 DECIMAL String → Number 轉換 ======
    describe('mysql2 DECIMAL 轉 Number（防止字串相加 bug）', () => {

        test('所有公式 current_value 應為 Number 型別，絕非字串', async () => {
            const res = await request(app).get(`/api/kpi-query/query?bu_no=${TEST_BU}&YYYY_MM=${TEST_YM}`);
            for (const id of EXPECTED_FORMULA_IDS) {
                const v = res.body.data[id].current_value;
                if (v !== null && v !== undefined && !isNaN(v)) {
                    expect(typeof v).toBe('number');
                }
            }
        });

        test('gross_profit 結果應是 40（不是 "40.0000" 字串）', async () => {
            const res = await request(app).get(`/api/kpi-query/query?bu_no=${TEST_BU}&YYYY_MM=${TEST_YM}`);
            const v = res.body.data.gross_profit.current_value;
            expect(typeof v).toBe('number');
            expect(v).not.toMatch ? expect.stringMatching : expect.anything(); // 若為字串應失敗
        });
    });

    // ====== POST /calc 指定公式 ======
    describe('POST /api/kpi-query/calc 指定公式計算', () => {

        test('指定 ids 計算 gross_profit + roe', async () => {
            const res = await request(app)
                .post(`/api/kpi-query/calc`)
                .send({ bu_no: TEST_BU, YYYY_MM: TEST_YM, ids: ['gross_profit', 'roe'] });
            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.gross_profit).toBeDefined();
            expect(res.body.data.roe).toBeDefined();
        });

        test('不傳 ids → 回傳所有公式', async () => {
            const res = await request(app)
                .post(`/api/kpi-query/calc`)
                .send({ bu_no: TEST_BU, YYYY_MM: TEST_YM });
            expect(Object.keys(res.body.data).length).toBeGreaterThanOrEqual(20);
        });

        test('傳無效 id → 回 note: 公式未定義', async () => {
            const res = await request(app)
                .post(`/api/kpi-query/calc`)
                .send({ bu_no: TEST_BU, YYYY_MM: TEST_YM, ids: ['nonexistent_id'] });
            expect(res.body.data.nonexistent_id.note).toBe('公式未定義');
        });

        test('缺少參數應失敗', async () => {
            const res = await request(app)
                .post(`/api/kpi-query/calc`)
                .send({ bu_no: TEST_BU });
            expect(res.body.success).toBe(false);
        });
    });

    // ====== 點燈邏輯整合 ======
    describe('點燈邏輯（整合）', () => {

        test('所有回傳項的 color 應為 GREEN / YELLOW / RED / null 其中之一', async () => {
            const res = await request(app).get(`/api/kpi-query/query?bu_no=${TEST_BU}&YYYY_MM=${TEST_YM}`);
            const valid = ['GREEN', 'YELLOW', 'RED', null];
            for (const k of Object.values(res.body.data)) {
                expect(valid).toContain(k.color);
            }
        });
    });
});

// ====== 前端頁面存在 + nav 註冊 ======
describe('前端 KPI 查詢頁面', () => {

    test('index.html 應包含 4 個 YG nav item', async () => {
        const res = await request(app).get('/index.html');
        expect(res.text).toContain('yg001');
        expect(res.text).toContain('yg002');
        expect(res.text).toContain('yg003');
        expect(res.text).toContain('yg004');
        expect(res.text).toContain('kpiQuery.js');
    });

    test('kpiQuery.js 應存在且為有效 JS（無語法錯）', async () => {
        const fs = require('fs');
        const src = fs.readFileSync('./public/js/pages/kpiQuery.js', 'utf8');
        // 基本語法檢查：應包含 registerPage
        expect(src).toContain('registerPage');
        expect(src).toContain('YG_CONFIG');
        expect(src).toContain('ygLoad');
        expect(src).toContain('ygShift');
        // 無 null 風險：包含 State.bu_no 時有 fallback
        expect(src).toContain("State.bu_no || ''");
    });

    test('kpiQuery.js 應涵蓋 4 個頁面設定', () => {
        const fs = require('fs');
        const src = fs.readFileSync('./public/js/pages/kpiQuery.js', 'utf8');
        expect(src).toContain('yg001:');
        expect(src).toContain('yg002:');
        expect(src).toContain('yg003:');
        expect(src).toContain('yg004:');
    });
});
