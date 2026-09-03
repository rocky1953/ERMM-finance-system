/**
 * 系統設定 API 測試 — system.js route
 *
 * 涵蓋：
 *  1. GET /api/system/codes              列表 + 篩選
 *  2. GET /api/system/codes/:id          單筆
 *  3. POST /api/system/codes             新增 + ON DUPLICATE
 *  4. PUT /api/system/codes/:id          更新（部分欄位）
 *  5. DELETE /api/system/codes/:id       刪除
 *  6. GET /api/system/kpi                KPI 列表
 *  7. POST /api/system/kpi               KPI 新增
 *  8. GET /api/kpi/:uid                  KPI 單筆
 *  9. POST /api/risk/kpi-light           燈號判定
 *
 * 修復回顧（regression 測試）：
 *  - 修復前：route 用錯 PK 欄位名（uid vs id）→ 404
 *  - 修復前：route 用錯描述欄位名（code_desc vs value_description）→ Unknown column
 *  - 修復後：全部走真實 schema 欄位名
 */
const { request, app, pool, TEST_BU, cleanupTestData } = require('./setup');

const TEST_CODE = {
    code_type: 'CURRENCY',
    code_value: 'XYZ',
    value_description: '測試幣別',
    value_number1: 9.9999, sort_order: 99, inuse_flag: 'USE'
};

const TEST_KPI = {
    bu_no: TEST_BU, KPI_id: 'TEST_K_001', KPI_name: '測試 KPI',
    unit: '%', pct_type: 'asc', KPI1: 1.0, KPI2: 5.0
};

let beforeAllRan = false;
let afterAllRan = false;

beforeAll(async () => {
    // 清理殘留
    await pool.execute('DELETE FROM cams_system_codes WHERE code_value=?', [TEST_CODE.code_value]);
    await cleanupTestData();
    beforeAllRan = true;
});

afterAll(async () => {
    if (afterAllRan) return;
    afterAllRan = true;
    await pool.execute('DELETE FROM cams_system_codes WHERE code_value=?', [TEST_CODE.code_value]);
    await cleanupTestData();
    await pool.end();
});

describe('System Codes CRUD', () => {
    let codeId;

    describe('GET /api/system/codes', () => {
        test('應回 200 + 陣列', async () => {
            const res = await request(app).get('/api/system/codes');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.data.length).toBeGreaterThan(0);
        });

        test('按 code_type 篩選', async () => {
            const res = await request(app).get('/api/system/codes?code_type=CURRENCY');
            expect(res.status).toBe(200);
            expect(res.body.data.every(r => r.code_type === 'CURRENCY')).toBe(true);
        });

        test('不存在的 type 回空陣列', async () => {
            const res = await request(app).get('/api/system/codes?code_type=DOES_NOT_EXIST');
            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
        });

        // ⚠️ Regression：修復前 route 用錯 code_desc（真實欄位是 value_description）
        test('欄位名必須是 value_description + PK 是 id', async () => {
            const res = await request(app).get('/api/system/codes');
            if (res.body.data.length > 0) {
                const row = res.body.data[0];
                expect(row).toHaveProperty('id');                    // PK
                expect(row).toHaveProperty('value_description');     // 描述
                expect(row).not.toHaveProperty('code_desc');         // ❌ 沒有這個欄位
            }
        });
    });

    describe('POST /api/system/codes', () => {
        test('應成功新增', async () => {
            const res = await request(app).post('/api/system/codes').send(TEST_CODE);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        test('重複 (type, value) 應 ON DUPLICATE UPDATE', async () => {
            const res = await request(app)
                .post('/api/system/codes')
                .send({ ...TEST_CODE, value_description: '說明已更新', value_number1: 8.8888 });
            expect(res.status).toBe(200);

            const [rows] = await pool.execute(
                'SELECT id, value_description, value_number1 FROM cams_system_codes WHERE code_type=? AND code_value=?',
                [TEST_CODE.code_type, TEST_CODE.code_value]
            );
            expect(rows).toHaveLength(1);  // 只有 1 筆（不是 INSERT 新 row）
            expect(rows[0].value_description).toBe('說明已更新');
            expect(Number(rows[0].value_number1)).toBeCloseTo(8.8888, 3);
            codeId = rows[0].id;
        });
    });

    describe('GET /api/system/codes/:id', () => {
        test('真實 id → 200', async () => {
            const res = await request(app).get(`/api/system/codes/${codeId}`);
            expect(res.status).toBe(200);
            expect(res.body.data.id).toBe(codeId);
        });

        test('不存在 id → 404', async () => {
            const res = await request(app).get('/api/system/codes/99999');
            expect(res.status).toBe(404);
        });
    });

    describe('PUT /api/system/codes/:id', () => {
        test('更新指定欄位', async () => {
            const res = await request(app)
                .put(`/api/system/codes/${codeId}`)
                .send({ value_number1: 1.2345, sort_order: 42 });
            expect(res.status).toBe(200);

            const [rows] = await pool.execute(
                'SELECT value_number1, sort_order FROM cams_system_codes WHERE id=?', [codeId]
            );
            expect(Number(rows[0].value_number1)).toBeCloseTo(1.2345, 3);
            expect(rows[0].sort_order).toBe(42);
        });

        test('部分欄位更新不覆蓋其他', async () => {
            await request(app).put(`/api/system/codes/${codeId}`).send({ inuse_flag: 'NOUSE' });
            const [rows] = await pool.execute(
                'SELECT value_number1, inuse_flag FROM cams_system_codes WHERE id=?', [codeId]
            );
            expect(Number(rows[0].value_number1)).toBeCloseTo(1.2345, 3);  // 保持
            expect(rows[0].inuse_flag).toBe('NOUSE');                        // 變了
        });
    });

    describe('DELETE /api/system/codes/:id', () => {
        test('應成功刪除', async () => {
            const res = await request(app).delete(`/api/system/codes/${codeId}`);
            expect(res.status).toBe(200);
            const [rows] = await pool.execute('SELECT * FROM cams_system_codes WHERE id=?', [codeId]);
            expect(rows).toHaveLength(0);
        });

        test('不存在 id 不崩潰', async () => {
            const res = await request(app).delete('/api/system/codes/99999');
            expect([200, 404]).toContain(res.status);
        });
    });
});

// ============ KPI ============
describe('KPI API (system + kpi + risk)', () => {
    let kpiUid;

    describe('GET /api/system/kpi', () => {
        test('依 bu_no 篩選 + 含新測試 KPI', async () => {
            await request(app).post('/api/system/kpi').send(TEST_KPI);
            const res = await request(app).get(`/api/system/kpi?bu_no=${TEST_BU}`);
            expect(res.status).toBe(200);
            const mine = res.body.data.find(r => r.KPI_id === 'TEST_K_001');
            expect(mine).toBeDefined();
            kpiUid = mine.uid;
        });
    });

    describe('GET /api/kpi/:uid', () => {
        test('真實 uid → 200 + bu_no 正確', async () => {
            const res = await request(app).get(`/api/kpi/${kpiUid}`);
            expect(res.status).toBe(200);
            expect(res.body.data.bu_no).toBe(TEST_BU);
        });

        test('不存在 uid → 404', async () => {
            const res = await request(app).get('/api/kpi/99999');
            expect(res.status).toBe(404);
        });
    });

    describe('POST /api/system/kpi — ON DUPLICATE', () => {
        test('重複 (bu_no, KPI_id) 更新不新增', async () => {
            await request(app).post('/api/system/kpi')
                .send({ ...TEST_KPI, KPI_name: 'KPI 名稱已更新' });
            const [rows] = await pool.execute(
                'SELECT uid, KPI_name FROM MGM_KPI_desc WHERE bu_no=? AND KPI_id=?',
                [TEST_BU, 'TEST_K_001']
            );
            expect(rows).toHaveLength(1);
            expect(rows[0].KPI_name).toBe('KPI 名稱已更新');
        });
    });

    describe('POST /api/risk/kpi-light', () => {
        test('回傳所有 KPI + 有燈號顏色', async () => {
            const res = await request(app)
                .post('/api/risk/kpi-light').send({ bu_no: TEST_BU });
            expect(res.status).toBe(200);
            expect(['GREEN','YELLOW','RED']).toContain(res.body.data[0].color);
        });

        test('缺 bu_no → 400', async () => {
            const res = await request(app).post('/api/risk/kpi-light').send({});
            expect(res.status).toBe(400);
        });
    });

    describe('DELETE /api/kpi/:uid', () => {
        test('刪除後 404', async () => {
            const res = await request(app).delete(`/api/kpi/${kpiUid}`);
            expect(res.status).toBe(200);
            const res2 = await request(app).get(`/api/kpi/${kpiUid}`);
            expect(res2.status).toBe(404);
        });
    });
});

// ============ Regression: 前端 null guard ============
describe('Frontend system.js — null guard regression', () => {
    test('loadCodes / loadKPI 必須有 null guard', () => {
        const src = require('fs').readFileSync('public/js/pages/system.js', 'utf8');
        // 每個 load 函數第一行就是 const el = ...; if (!el) return;
        expect(src).toMatch(/const el = document\.getElementById\('codeTable'\);\s*if \(!el\) return;/);
        expect(src).toMatch(/const el = document\.getElementById\('kpiTable'\);\s*if \(!el\) return;/);
    });

    test('CodeForm.open 必須是 async（先 fetch 再 render）', () => {
        const src = require('fs').readFileSync('public/js/pages/system.js', 'utf8');
        expect(src).toMatch(/async open\(id\)/);
    });

    test('UI.modal 呼叫必須在讀取 DOM value 之前', () => {
        const src = require('fs').readFileSync('public/js/pages/system.js', 'utf8');
        const renderMatch = src.match(/_render\([^)]+\) \{([\s\S]*?)^\s*\},/m);
        if (renderMatch) {
            const body = renderMatch[1];
            const modalIdx = body.indexOf('UI.modal(');
            const firstGetIdx = body.indexOf("document.getElementById('cf_type')");
            if (modalIdx >= 0 && firstGetIdx >= 0) {
                expect(modalIdx).toBeLessThan(firstGetIdx);
            }
        }
    });
});
