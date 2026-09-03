/**
 * Forecast API 測試
 *
 * 修復內容回顧：
 *  1. GET / 支援 year 參數 (LIKE '2099/%')
 *  2. GET / 回傳按 forecast_type 分組的 12 月寬表 (M01~M12)
 *  3. GET /compare 不再強制要求 forecast_type，預設 '銷售'
 *  4. GET /compare 回傳 { labels, forecast, actual } 格式供 Chart.js 使用
 *  5. POST / 使用 n() 包裹參數防止 undefined 綁定
 */
const { request, app, pool, TEST_BU, TEST_YEAR, cleanupTestData, closePool } = require('./setup');

describe('Forecast API', () => {
    const testMonths = {
        '01': 800000, '02': 750000, '03': 900000, '04': 850000,
        '05': 950000, '06': 1000000, '07': 1100000, '08': 1050000,
        '09': 1200000, '10': 1150000, '11': 1250000, '12': 1300000
    };

    beforeAll(async () => {
        await cleanupTestData();
        // 寫入 12 個月預測資料
        await request(app)
            .post('/api/forecast')
            .send({ bu_no: TEST_BU, forecast_type: '銷售', year: TEST_YEAR, months: testMonths });
    });

    afterAll(async () => {
        await cleanupTestData();
        await closePool();
    });

    // 修復 1: GET / 支援 year 參數
    describe('GET /api/forecast?year=2099', () => {
        test('應回傳 200 且 success=true', async () => {
            const res = await request(app).get(`/api/forecast?bu_no=${TEST_BU}&year=${TEST_YEAR}`);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        test('應按 forecast_type 分組回傳寬表', async () => {
            const res = await request(app).get(`/api/forecast?bu_no=${TEST_BU}&year=${TEST_YEAR}`);
            expect(res.body.data).toBeInstanceOf(Array);
            expect(res.body.data.length).toBeGreaterThanOrEqual(1);
            const row = res.body.data[0];
            expect(row.forecast_type).toBe('銷售');
        });

        test('寬表應包含 M01~M12 月份欄位', async () => {
            const res = await request(app).get(`/api/forecast?bu_no=${TEST_BU}&year=${TEST_YEAR}`);
            const row = res.body.data[0];
            expect(row.M01).toBe(800000);
            expect(row.M06).toBe(1000000);
            expect(row.M12).toBe(1300000);
        });
    });

    // 修復 2: POST / 使用 n() 防止 undefined
    describe('POST /api/forecast', () => {
        test('應成功寫入 12 個月預測', async () => {
            const res = await request(app)
                .post('/api/forecast')
                .send({
                    bu_no: TEST_BU,
                    forecast_type: '成本',
                    year: TEST_YEAR,
                    months: { '01': 500000, '02': 520000, '03': 540000 }
                });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toContain('已儲存');
        });

        test('缺少必要參數應回傳失敗', async () => {
            const res = await request(app)
                .post('/api/forecast')
                .send({ bu_no: TEST_BU });
            expect(res.body.success).toBe(false);
        });

        test('重複寫入應 ON DUPLICATE KEY UPDATE 而非報錯', async () => {
            // 先寫入
            await request(app)
                .post('/api/forecast')
                .send({
                    bu_no: TEST_BU,
                    forecast_type: '現金流',
                    year: TEST_YEAR,
                    months: { '01': 100000 }
                });
            // 再覆蓋
            const res2 = await request(app)
                .post('/api/forecast')
                .send({
                    bu_no: TEST_BU,
                    forecast_type: '現金流',
                    year: TEST_YEAR,
                    months: { '01': 200000 }
                });
            expect(res2.status).toBe(200);
            expect(res2.body.success).toBe(true);

            // 驗證值已更新
            const get = await request(app).get(`/api/forecast?bu_no=${TEST_BU}&year=${TEST_YEAR}&forecast_type=現金流`);
            expect(get.body.data[0].M01).toBe(200000);
        });
    });

    // 修復 3: GET /compare 不強制 forecast_type
    describe('GET /api/forecast/compare', () => {
        test('不傳 forecast_type 應正常回傳 (預設銷售)', async () => {
            const res = await request(app).get(`/api/forecast/compare?bu_no=${TEST_BU}&year=${TEST_YEAR}`);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        test('回傳 labels 陣列含 12 個月', async () => {
            const res = await request(app).get(`/api/forecast/compare?bu_no=${TEST_BU}&year=${TEST_YEAR}`);
            expect(res.body.data.labels).toBeInstanceOf(Array);
            expect(res.body.data.labels).toHaveLength(12);
            expect(res.body.data.labels[0]).toBe('1月');
            expect(res.body.data.labels[11]).toBe('12月');
        });

        test('回傳 forecast 和 actual 陣列各 12 個元素', async () => {
            const res = await request(app).get(`/api/forecast/compare?bu_no=${TEST_BU}&year=${TEST_YEAR}`);
            expect(res.body.data.forecast).toBeInstanceOf(Array);
            expect(res.body.data.forecast).toHaveLength(12);
            expect(res.body.data.actual).toBeInstanceOf(Array);
            expect(res.body.data.actual).toHaveLength(12);
        });

        test('forecast 陣列應與寫入的預測值一致', async () => {
            const res = await request(app).get(`/api/forecast/compare?bu_no=${TEST_BU}&year=${TEST_YEAR}`);
            expect(res.body.data.forecast[0]).toBe(800000);   // M01
            expect(res.body.data.forecast[5]).toBe(1000000);  // M06
            expect(res.body.data.forecast[11]).toBe(1300000); // M12
        });

        test('缺少 bu_no 和 year 應回傳失敗', async () => {
            const res = await request(app).get('/api/forecast/compare');
            expect(res.body.success).toBe(false);
        });
    });
});
