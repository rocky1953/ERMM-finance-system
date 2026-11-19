/**
 * CTO-05 合同主檔 API 測試
 *
 * 驗證：
 *   1. CRUD 全鏈路
 *   2. stats 端點（含 dataScope）
 *   3. po-options 端點
 *   4. 詳情 + JSON payment_terms 解析
 *   5. 權限注入（admin 能刪，general 不能）
 */
const { request, app, pool } = require('./setup');

const ADMIN = { user_id: 'rocky', password: '68315711' };
const GENERAL = { user_id: 'U0001', password: '123456' };

let adminToken, generalToken;
let testContractUid;

beforeAll(async () => {
    const a = await request(app).post('/api/auth/login').send(ADMIN);
    adminToken = a.body.data.token;
    const g = await request(app).post('/api/auth/login').send(GENERAL);
    generalToken = g.body.data.token;
});

describe('CTO-05 合同主檔 /api/contracts', () => {

    test('types 端點返回合同類型 + 狀態', async () => {
        const res = await request(app)
            .get('/api/contracts/types')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data.types)).toBe(true);
        expect(Array.isArray(res.body.data.statuses)).toBe(true);
        expect(res.body.data.statuses).toContain('ACTIVE');
    });

    test('列表 — admin 看到所有公司', async () => {
        const res = await request(app)
            .get('/api/contracts/')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data.length).toBeGreaterThanOrEqual(10); // migration 057 種了 10 條
    });

    test('stats 端點 — 正常返回 breakdown + expiring_90d', async () => {
        const res = await request(app)
            .get('/api/contracts/stats')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        const d = res.body.data;
        expect(Array.isArray(d.breakdown)).toBe(true);
        expect(typeof d.expiring_90d).toBe('number');
    });

    test('po-options — 返回 PO 列表（HM bu_no 有結果）', async () => {
        const res = await request(app)
            .get('/api/contracts/po-options?bu_no=HM')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data.length).toBeGreaterThan(0);
    });

    describe('CRUD', () => {

        test('POST 新增合同', async () => {
            const res = await request(app)
                .post('/api/contracts/')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    bu_no: 'HM',
                    contract_no: 'C-TEST-' + Date.now(),
                    contract_name: 'Jest 測試合同',
                    contract_type: '採購',
                    contract_cat: 'PO對應',
                    partner_name: 'JestSupplier',
                    partner_type: 'SUPPLIER',
                    contract_amount: 123456.78,
                    currency: 'CNY',
                    contract_basis: 'Fixed',
                    sign_date: '2026-01-01',
                    effective_date: '2026-01-01',
                    expire_date: '2027-01-01',
                    settlement_type: 'TT',
                    payment_terms: [{ step: 1, pct: 30, trigger: '簽訂' },
                                    { step: 2, pct: 70, trigger: '驗收' }],
                    contract_status: 'ACTIVE',
                });
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            testContractUid = res.body.data.uid;
            expect(testContractUid).toBeDefined();
        });

        test('GET 詳情 + JSON 解析', async () => {
            expect(testContractUid).toBeDefined();
            const res = await request(app)
                .get(`/api/contracts/${testContractUid}`)
                .set('Authorization', `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
            expect(res.body.data.payment_terms).toBeInstanceOf(Array);
        });

        test('PUT 更新合同', async () => {
            const res = await request(app)
                .put(`/api/contracts/${testContractUid}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ contract_name: 'Jest 測試合同 - 已更新' });
            expect(res.status).toBe(200);
        });

        test('DELETE 刪除（邏輯）', async () => {
            const res = await request(app)
                .delete(`/api/contracts/${testContractUid}`)
                .set('Authorization', `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
            expect(res.body.message).toContain('已刪除');
        });

        test('general 不能 DELETE → 403', async () => {
            // 先找一條存在的合同
            const listRes = await request(app)
                .get('/api/contracts/')
                .set('Authorization', `Bearer ${adminToken}`);
            const uid = listRes.body.data[0].uid;
            const res = await request(app)
                .delete(`/api/contracts/${uid}`)
                .set('Authorization', `Bearer ${generalToken}`);
            // general 沒有 DELETE 按鈕 → 403
            expect([403, 401]).toContain(res.status);
        });
    });

    test('不存在的 uid → 404', async () => {
        const res = await request(app)
            .get('/api/contracts/99999999')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(404);
    });
});
