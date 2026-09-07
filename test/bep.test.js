/**
 * BEP 損益平衡分析 單元測試
 */
const request = require('supertest');
const app = require('../app');

describe('BEP /api/bep/*', () => {

    describe('GET /api/bep/query', () => {

        test('基本活體 - 成功回傳', async () => {
            const res = await request(app)
                .get('/api/bep/query')
                .query({ bu_no: 'HM', YYYY_MM: '2025/12' });
            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();
        });

        test('參數驗證 - 缺 bu_no 失敗', async () => {
            const res = await request(app)
                .get('/api/bep/query')
                .query({ YYYY_MM: '2025/12' });
            expect(res.body.success).toBe(false);
        });

        test('參數驗證 - 缺 YYYY_MM 失敗', async () => {
            const res = await request(app)
                .get('/api/bep/query')
                .query({ bu_no: 'HM' });
            expect(res.body.success).toBe(false);
        });

        test('回傳完整公式鏈欄位', async () => {
            const d = (await request(app)
                .get('/api/bep/query')
                .query({ bu_no: 'HM', YYYY_MM: '2025/12' })).body.data;

            expect(typeof d.sale_amt).toBe('number');
            expect(typeof d.consumable).toBe('number');
            expect(typeof d.packaging).toBe('number');
            expect(typeof d.processing).toBe('number');
            expect(typeof d.misc_purchase).toBe('number');
            expect(typeof d.freight).toBe('number');
            expect(typeof d.customs).toBe('number');
            expect(typeof d.service_part_comp).toBe('number');
            expect(typeof d.variable_expense).toBe('number');
            expect(typeof d.fixed_cost).toBe('number');
            expect(typeof d.material).toBe('number');
            expect(typeof d.variable_cost).toBe('number');
            expect(typeof d.contribution_margin).toBe('number');
            expect(typeof d.cm_rate).toBe('number');
            expect(typeof d.bep).toBe('number');
            expect(typeof d.gap).toBe('number');
        });

        test('公式鏈數值正確（手算驗證）', async () => {
            const d = (await request(app)
                .get('/api/bep/query')
                .query({ bu_no: 'HM', YYYY_MM: '2025/12' })).body.data;

            // 材料 = 7 項合計
            const mat = d.consumable + d.packaging + d.processing
                      + d.misc_purchase + d.freight + d.customs + d.service_part_comp;
            expect(d.material).toBeCloseTo(mat, 2);

            // 變動成本 = 材料 + 變動費用
            expect(d.variable_cost).toBeCloseTo(d.material + d.variable_expense, 2);

            // 邊際貢獻 = 銷售 - 變動成本
            expect(d.contribution_margin).toBeCloseTo(d.sale_amt - d.variable_cost, 2);

            // 邊際貢獻率 = 邊際貢獻 / 銷售 * 100
            if (d.sale_amt > 0) {
                expect(d.cm_rate).toBeCloseTo(
                    (d.contribution_margin / d.sale_amt) * 100, 4
                );
            }

            // 損益平衡點 = 固定成本 / (cm_rate/100)
            if (d.cm_rate > 0) {
                expect(d.bep).toBeCloseTo(
                    d.fixed_cost / (d.cm_rate / 100), 2
                );
            }

            // 不足訂單 = 銷售 - 損益平衡點
            expect(d.gap).toBeCloseTo(d.sale_amt - d.bep, 2);
        });

        test('HM 2025/12 實際值合理範圍', async () => {
            const d = (await request(app)
                .get('/api/bep/query')
                .query({ bu_no: 'HM', YYYY_MM: '2025/12' })).body.data;

            expect(d.sale_amt).toBeGreaterThan(0);
            expect(d.variable_cost).toBeGreaterThan(0);
            expect(d.fixed_cost).toBeGreaterThan(0);
            // cm_rate 應該在 10%~100% 之間（正常企業，變動成本低時會接近 100%）
            expect(d.cm_rate).toBeGreaterThan(10);
            expect(d.cm_rate).toBeLessThan(100);
        });
    });

    describe('POST /api/bep/save', () => {

        test('保存成功 - upsert', async () => {
            const res = await request(app)
                .post('/api/bep/save')
                .send({
                    bu_no: 'HM', YYYY_MM: '2025/12',
                    consumable: 100, packaging: 50, processing: 0,
                    misc_purchase: 20, freight: 0, customs: 10,
                    service_part_comp: 5, variable_expense: 500,
                    fixed_cost: 10000, remark: 'test'
                });
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();
            expect(res.body.data.saved).toBe(true);
            expect(res.body.data.data).toBeDefined();
            expect(res.body.data.data.uid).toBeDefined();
        });

        test('保存後查詢一致', async () => {
            const payload = {
                bu_no: 'HM', YYYY_MM: '2025/12',
                consumable: 123, packaging: 456, processing: 789,
                misc_purchase: 111, freight: 222, customs: 333,
                service_part_comp: 444, variable_expense: 5000,
                fixed_cost: 99999
            };
            await request(app).post('/api/bep/save').send(payload);

            const d = (await request(app)
                .get('/api/bep/query')
                .query({ bu_no: 'HM', YYYY_MM: '2025/12' })).body.data;

            expect(d.consumable).toBe(payload.consumable);
            expect(d.packaging).toBe(payload.packaging);
            expect(d.fixed_cost).toBe(payload.fixed_cost);
            // 公式仍正確
            expect(d.material).toBeCloseTo(
                payload.consumable + payload.packaging + payload.processing
              + payload.misc_purchase + payload.freight + payload.customs
              + payload.service_part_comp, 2
            );
        });

        test('缺參數失敗', async () => {
            const res = await request(app)
                .post('/api/bep/save')
                .send({ bu_no: 'HM' });
            expect(res.body.success).toBe(false);
        });
    });

    describe('邊界情況', () => {

        test('銷售額為 0 時 cm_rate 為 0、bep 為 0', async () => {
            // 用一個不存在的 bu_no，整個 finance_summary 都沒有資料，sale_amt 會是 0
            const d = (await request(app)
                .get('/api/bep/query')
                .query({ bu_no: 'ZZ', YYYY_MM: '1999/01' })).body.data;

            expect(d.sale_amt).toBe(0);
            expect(d.cm_rate).toBe(0);
            expect(d.bep).toBe(0);  // 防除零
        });
    });
});
