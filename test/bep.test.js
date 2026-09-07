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

        // 用 bu_no='TEST' 避免污染 HM/HN/SZ 正式種子數據
        test('保存成功 - upsert', async () => {
            const res = await request(app)
                .post('/api/bep/save')
                .send({
                    bu_no: 'TEST', YYYY_MM: '2025/99',
                    consumable: 100, packaging: 50, processing: 0,
                    misc_purchase: 20, freight: 0, customs: 10,
                    service_part_comp: 5, variable_expense: 500,
                    fixed_cost: 10000, remark: 'jest-test'
                });
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();
            expect(res.body.data.saved).toBe(true);
            expect(res.body.data.data).toBeDefined();
            expect(res.body.data.data.uid).toBeDefined();
        });

        test('保存後查詢一致', async () => {
            const payload = {
                bu_no: 'TEST', YYYY_MM: '2025/99',
                consumable: 123, packaging: 456, processing: 789,
                misc_purchase: 111, freight: 222, customs: 333,
                service_part_comp: 444, variable_expense: 5000,
                fixed_cost: 99999
            };
            await request(app).post('/api/bep/save').send(payload);

            const d = (await request(app)
                .get('/api/bep/query')
                .query({ bu_no: 'TEST', YYYY_MM: '2025/99' })).body.data;

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
                .send({ bu_no: 'TEST' });
            expect(res.body.success).toBe(false);
        });
    });

    describe('多公司覆蓋測試（HM / HN / SZ × 2025 全年）', () => {

        test.each([
            ['HM', '2025/01'], ['HM', '2025/06'], ['HM', '2025/12'],
            ['HN', '2025/01'], ['HN', '2025/06'], ['HN', '2025/12'],
            ['SZ', '2025/01'], ['SZ', '2025/06'], ['SZ', '2025/12']
        ])('%s %s 公式鏈完整且數值合理', async (bu, ym) => {
            const d = (await request(app)
                .get('/api/bep/query')
                .query({ bu_no: bu, YYYY_MM: ym })).body.data;

            // 基本數值存在且為 number
            expect(typeof d.sale_amt).toBe('number');
            expect(typeof d.material).toBe('number');
            expect(typeof d.fixed_cost).toBe('number');

            // sale_amt > 0（種子資料保證）
            expect(d.sale_amt).toBeGreaterThan(0);

            // 固定成本 > 0
            expect(d.fixed_cost).toBeGreaterThan(0);

            // 公式鏈驗證
            const mat = d.consumable + d.packaging + d.processing
                      + d.misc_purchase + d.freight + d.customs + d.service_part_comp;
            expect(d.material).toBeCloseTo(mat, 2);
            expect(d.variable_cost).toBeCloseTo(d.material + d.variable_expense, 2);
            expect(d.contribution_margin).toBeCloseTo(d.sale_amt - d.variable_cost, 2);
            expect(d.cm_rate).toBeCloseTo(
                (d.contribution_margin / d.sale_amt) * 100, 4
            );
            if (d.cm_rate > 0) {
                expect(d.bep).toBeCloseTo(
                    d.fixed_cost / (d.cm_rate / 100), 2
                );
            }
            expect(d.gap).toBeCloseTo(d.sale_amt - d.bep, 2);

            // cm_rate 應該合理（10%~100% 之間）
            expect(d.cm_rate).toBeGreaterThan(10);
            expect(d.cm_rate).toBeLessThan(100);
        });

        test('HM 固定成本不隨月份變化（CW397 基準）', async () => {
            const m1 = (await request(app)
                .get('/api/bep/query')
                .query({ bu_no: 'HM', YYYY_MM: '2025/01' })).body.data;
            const m6 = (await request(app)
                .get('/api/bep/query')
                .query({ bu_no: 'HM', YYYY_MM: '2025/06' })).body.data;
            const m12 = (await request(app)
                .get('/api/bep/query')
                .query({ bu_no: 'HM', YYYY_MM: '2025/12' })).body.data;

            expect(m1.fixed_cost).toBeCloseTo(m6.fixed_cost, 2);
            expect(m6.fixed_cost).toBeCloseTo(m12.fixed_cost, 2);
            expect(m12.fixed_cost).toBe(14040578.64);  // CW397 原值
        });

        test('各公司固定成本差異合理（HM > SZ > HN 約 60% > HN 約 35%）', async () => {
            const hm = (await request(app)
                .get('/api/bep/query')
                .query({ bu_no: 'HM', YYYY_MM: '2025/12' })).body.data;
            const sz = (await request(app)
                .get('/api/bep/query')
                .query({ bu_no: 'SZ', YYYY_MM: '2025/12' })).body.data;
            const hn = (await request(app)
                .get('/api/bep/query')
                .query({ bu_no: 'HN', YYYY_MM: '2025/12' })).body.data;

            expect(hm.fixed_cost).toBeGreaterThan(sz.fixed_cost);
            expect(sz.fixed_cost).toBeGreaterThan(hn.fixed_cost);
            // SZ ≈ HM * 60%，容許 ±1%
            expect(sz.fixed_cost).toBeGreaterThan(hm.fixed_cost * 0.58);
            expect(sz.fixed_cost).toBeLessThan(hm.fixed_cost * 0.62);
            // HN ≈ HM * 35%
            expect(hn.fixed_cost).toBeGreaterThan(hm.fixed_cost * 0.33);
            expect(hn.fixed_cost).toBeLessThan(hm.fixed_cost * 0.37);
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
