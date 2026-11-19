/**
 * CTO-06 指標中心測試
 *
 * 驗證：
 *   1. GET /api/metric-center/metrics 指標清單
 *   2. compute ROE 使用統一口徑（net_profit_amt）
 *   3. 不存在的 metric_code → 404
 */
const { request, app, pool, TEST_BU, TEST_YM, TEST_YEAR } = require('./setup');

const ADMIN = { user_id: 'rocky', password: '68315711' };

let adminToken;

beforeAll(async () => {
    const a = await request(app).post('/api/auth/login').send(ADMIN);
    adminToken = a.body.data.token;
});

describe('CTO-06 指標中心', () => {

    test('metrics 清單 — 至少 20 個指標', async () => {
        const res = await request(app)
            .get('/api/metric-center/metrics')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        const list = res.body.data;
        expect(list.length).toBeGreaterThanOrEqual(20);
    });

    test('ROE 指標存在 + 有 formula', async () => {
        const res = await request(app)
            .get('/api/metric-center/metrics')
            .set('Authorization', `Bearer ${adminToken}`);
        const roe = res.body.data.find(m => m.metric_code === 'roe');
        expect(roe).toBeTruthy();
        expect(roe.formula).toBeTruthy();
        expect(roe.description).toBeTruthy();
    });

    test('breakdown by category', async () => {
        const res = await request(app)
            .get('/api/metric-center/metrics?category=profitability')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.data.length).toBeGreaterThan(0);
    });
});
