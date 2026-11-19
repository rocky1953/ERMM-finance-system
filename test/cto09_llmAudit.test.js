/**
 * CTO-09 AI 治理 — 後端測試
 *
 * 分兩大部分：
 *   A. services/llmAudit.js 單元測試（calcCost / checkRateLimit / auditCall）
 *   B. routes/llmAudit.js 集成測試（supertest 打真實 API）
 *
 * 測試資料策略：
 *   - 在 beforeAll 先寫幾條 ermm_ai_audit 假資料（跨 provider/status 分佈）
 *   - 測試後在 afterAll 清理（但不調 pool.end）
 */
const { request, app, pool } = require('./setup');

const ADMIN = { user_id: 'rocky', password: '68315711' };
const GENERAL = { user_id: 'U0003', password: '123456' };

let adminToken, generalToken;
const TEST_UIDS = [];  // 追蹤插入的測試審計 uid

/* ============================================================
 *  A. services/llmAudit.js 單元測試
 * ============================================================ */

describe('CTO-09 services/llmAudit', () => {
    let llmAudit;
    beforeAll(() => {
        llmAudit = require('../services/llmAudit');
    });

    describe('calcCost() — 從 cams_ai_model_pricing 查價計算 USD 成本', () => {
        test('已知價格的模型：openai/gpt-4o 有正確計價', async () => {
            const [dbP] = await pool.execute(
                "SELECT input_cost_per_1k, output_cost_per_1k FROM cams_ai_model_pricing WHERE provider='openai' AND model='gpt-4o'"
            );
            const calc = await llmAudit.calcCost('openai', 'gpt-4o', 1000, 500);
            const expected = 1000/1000 * Number(dbP[0].input_cost_per_1k)
                           + 500/1000 * Number(dbP[0].output_cost_per_1k);
            expect(calc).toBeGreaterThan(0);
            expect(Math.abs(calc - expected)).toBeLessThan(0.0001);
        });

        test('deepseek-chat 廉價模型', async () => {
            const cost = await llmAudit.calcCost('deepseek', 'deepseek-chat', 1000, 1000);
            expect(cost).toBeGreaterThan(0);
            // 2 倍數字：2 * 0.00027 + 2 * 0.00110 = 0.00274
            expect(Number(cost.toFixed(5))).toBeCloseTo(0.00274, 5);
        });

        test('未知 provider → 安全回傳 0（不 block）', async () => {
            const cost = await llmAudit.calcCost('unknown-provider', 'unknown-model', 1000, 1000);
            expect(cost).toBe(0);
        });

        test('ollama 本地模型 → 計價為 0', async () => {
            const cost = await llmAudit.calcCost('ollama', 'llama3', 10000, 5000);
            expect(cost).toBe(0);
        });

        test('token 為 0 → 成本 0', async () => {
            const cost = await llmAudit.calcCost('openai', 'gpt-4o', 0, 0);
            expect(cost).toBe(0);
        });

        test('provider/model 缺失 → 安全回傳 0', async () => {
            const cost = await llmAudit.calcCost(null, null, 100, 100);
            expect(cost).toBe(0);
        });
    });

    describe('checkRateLimit() — 每日配額檢查（fail-open）', () => {
        test('global 配額存在 → 正常返回 allowed:true', async () => {
            const result = await llmAudit.checkRateLimit('global', '*', { tokens: 1000, cost_usd: 0.01 });
            expect(result.allowed).toBe(true);
        });

        test('bu=HM 配額存在 → 正常返回 allowed:true', async () => {
            const result = await llmAudit.checkRateLimit('bu', 'HM', { tokens: 5000 });
            expect(result.allowed).toBe(true);
        });

        test('scope_key 無對應配置（如 bu=XX）→ 仍 allowed（fail-open）', async () => {
            const result = await llmAudit.checkRateLimit('bu', 'NONEXISTENT', { tokens: 100000 });
            expect(result.allowed).toBe(true);
        });
    });

    describe('auditCall() — 寫入審計表', () => {
        test('成功寫入 + 回傳 true', async () => {
            const ok = await llmAudit.auditCall({
                bu_no: 'HM',
                xuser_id: 'rocky',
                xuser_name: 'Rocky Chen',
                provider: 'openai',
                model: 'gpt-4o-mini',
                endpoint: 'aiqa',
                system_prompt: 'You are helpful',
                user_prompt: '測試問題',
                assistant_reply: '測試回答',
                prompt_tokens: 50,
                completion_tokens: 30,
                total_tokens: 80,
                latency_ms: 1234,
                cost_usd: 0.0001,
                status: 'SUCCESS',
                ip_address: '127.0.0.1',
            });
            expect(ok).toBe(true);

            // 驗證真的寫進 ermm_ai_audit
            const [rows] = await pool.execute(
                "SELECT uid FROM ermm_ai_audit WHERE xuser_id='rocky' AND user_prompt='測試問題' ORDER BY uid DESC LIMIT 1"
            );
            expect(rows.length).toBeGreaterThan(0);
            TEST_UIDS.push(rows[0].uid);
        });

        test('審計包含自動計算成本（未提供 cost_usd 時查價）', async () => {
            const ok = await llmAudit.auditCall({
                bu_no: 'HM',
                xuser_id: 'rocky',
                provider: 'openai',
                model: 'gpt-4o',
                total_tokens: 1500,
                prompt_tokens: 1000,
                completion_tokens: 500,
                status: 'SUCCESS',
            });
            expect(ok).toBe(true);

            const [rows] = await pool.execute(
                "SELECT uid, cost_usd FROM ermm_ai_audit WHERE xuser_id='rocky' AND provider='openai' AND model='gpt-4o' ORDER BY uid DESC LIMIT 1"
            );
            expect(rows[0].cost_usd).toBeGreaterThan(0);
            TEST_UIDS.push(rows[0].uid);
        });

        test('長字串自動截斷', async () => {
            const longPrompt = 'A'.repeat(5000);
            const longReply = 'B'.repeat(10000);
            await llmAudit.auditCall({
                bu_no: 'HN',
                xuser_id: 'truncate_test',
                user_prompt: longPrompt,
                assistant_reply: longReply,
                provider: 'deepseek',
                model: 'deepseek-chat',
                status: 'SUCCESS',
            });
            const [rows] = await pool.execute(
                "SELECT user_prompt, assistant_reply FROM ermm_ai_audit WHERE xuser_id='truncate_test' ORDER BY uid DESC LIMIT 1"
            );
            expect(rows[0].user_prompt.length).toBeLessThanOrEqual(2000 + 20);
            expect(rows[0].assistant_reply.length).toBeLessThanOrEqual(8000 + 20);
        });
    });
});

/* ============================================================
 *  B. routes/llmAudit.js 集成測試（supertest + 真實 DB）
 * ============================================================ */

describe('CTO-09 routes/llmAudit', () => {

    beforeAll(async () => {
        const a = await request(app).post('/api/auth/login').send(ADMIN);
        adminToken = a.body.data.token;
        const g = await request(app).post('/api/auth/login').send(GENERAL);
        generalToken = g.body.data.token;

        // 先插入一些跨 provider/status 的假資料
        const seedSql = `
            INSERT INTO ermm_ai_audit
                (bu_no, xuser_id, xuser_name, conversation_id,
                 provider, model, endpoint, system_prompt, user_prompt, assistant_reply,
                 prompt_tokens, completion_tokens, total_tokens,
                 latency_ms, cost_usd, status, error_msg, ip_address)
            VALUES
                ('HM','rocky','Rocky Chen',NULL,'openai','gpt-4o-mini','aiqa','sys','q1','a1',50,30,80,1234,0.0001,'SUCCESS',NULL,'127.0.0.1'),
                ('HM','rocky','Rocky Chen',NULL,'deepseek','deepseek-chat','aiqa','sys','q2','a2',200,100,300,800,0.0008,'SUCCESS',NULL,'127.0.0.1'),
                ('HN','U0002','Alice',NULL,'kimi','kimi-k2.6','aiqa','sys','q3','',100,0,100,9999,0.0010,'FAIL','timeout','10.0.0.5'),
                ('HM','rocky','Rocky Chen',NULL,'ollama','llama3','test','sys','q4','a4',500,400,900,2345,0.0000,'SUCCESS',NULL,'127.0.0.1')
        `;
        try { await pool.execute(seedSql); } catch {}
    });

    afterAll(async () => {
        // 清理測試資料
        try {
            await pool.execute(
                "DELETE FROM ermm_ai_audit WHERE xuser_id IN ('truncate_test') " +
                "OR (cost_usd=0.0001 AND provider='openai' AND model='gpt-4o-mini') " +
                "OR (total_tokens=300 AND provider='deepseek')"
            );
        } catch {}
    });

    describe('GET /api/llm-audit/list', () => {
        test('admin 可讀取審計列表', async () => {
            const res = await request(app)
                .get('/api/llm-audit/list?limit=50')
                .set('Authorization', `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data.rows)).toBe(true);
            expect(typeof res.body.data.total).toBe('number');
        });

        test('分頁參數生效', async () => {
            const res = await request(app)
                .get('/api/llm-audit/list?page=1&limit=2')
                .set('Authorization', `Bearer ${adminToken}`);
            expect(res.body.data.rows.length).toBeLessThanOrEqual(2);
            expect(res.body.data.total).toBeGreaterThanOrEqual(res.body.data.rows.length);
        });

        test('按 provider 篩選', async () => {
            const res = await request(app)
                .get('/api/llm-audit/list?provider=openai&limit=50')
                .set('Authorization', `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
            if (res.body.data.rows.length > 0) {
                res.body.data.rows.forEach(r => {
                    expect(r.provider).toBe('openai');
                });
            }
        });

        test('按 status 篩選', async () => {
            const res = await request(app)
                .get('/api/llm-audit/list?status=FAIL&limit=50')
                .set('Authorization', `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
            if (res.body.data.rows.length > 0) {
                res.body.data.rows.forEach(r => expect(r.status).toBe('FAIL'));
            }
        });

        test('關鍵字搜尋（q 參數）', async () => {
            const res = await request(app)
                .get('/api/llm-audit/list?q=q1&limit=50')
                .set('Authorization', `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
        });

        test('未登入 → 401', async () => {
            const res = await request(app).get('/api/llm-audit/list');
            expect(res.status).toBe(401);
        });
    });

    describe('GET /api/llm-audit/stats', () => {
        test('返回 cards + trend + comparison', async () => {
            const res = await request(app)
                .get('/api/llm-audit/stats')
                .set('Authorization', `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
            const { cards, trend, comparison } = res.body.data;
            expect(typeof cards.total_calls).toBe('number');
            expect(Array.isArray(trend)).toBe(true);
            expect(typeof comparison).toBe('object');
            // 自鑑資料有 4 筆，至少應該有統計
            expect(cards.total_calls).toBeGreaterThanOrEqual(0);
        });

        test('cards 欄位完整', async () => {
            const res = await request(app)
                .get('/api/llm-audit/stats')
                .set('Authorization', `Bearer ${adminToken}`);
            const c = res.body.data.cards;
            expect('total_calls' in c).toBe(true);
            expect('success_calls' in c).toBe(true);
            expect('fail_calls' in c).toBe(true);
            expect('total_tokens' in c).toBe(true);
            expect('total_cost_usd' in c).toBe(true);
            expect('avg_latency_ms' in c).toBe(true);
            expect('unique_users' in c).toBe(true);
            expect('providers_used' in c).toBe(true);
        });
    });

    describe('GET /api/llm-audit/cost', () => {
        test('group_by=provider 返回聚合', async () => {
            const res = await request(app)
                .get('/api/llm-audit/cost?group_by=provider')
                .set('Authorization', `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(true);
            if (res.body.data.length > 0) {
                expect(res.body.data[0]).toHaveProperty('dim');
                expect(res.body.data[0]).toHaveProperty('cost_usd');
                expect(res.body.data[0]).toHaveProperty('tokens');
                expect(res.body.data[0]).toHaveProperty('calls');
            }
        });

        test('group_by=model', async () => {
            const res = await request(app)
                .get('/api/llm-audit/cost?group_by=model')
                .set('Authorization', `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
        });

        test('group_by=bu_no', async () => {
            const res = await request(app)
                .get('/api/llm-audit/cost?group_by=bu_no')
                .set('Authorization', `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/llm-audit/users', () => {
        test('返回用戶排行榜', async () => {
            const res = await request(app)
                .get('/api/llm-audit/users?limit=5')
                .set('Authorization', `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(true);
            // 自鑑有 rocky + U0002，至少 2 位
            expect(res.body.data.length).toBeGreaterThanOrEqual(2);
        });

        test('排行榜按 cost_usd 降序', async () => {
            const res = await request(app)
                .get('/api/llm-audit/users')
                .set('Authorization', `Bearer ${adminToken}`);
            const arr = res.body.data;
            for (let i = 1; i < arr.length; i++) {
                expect(Number(arr[i].cost_usd)).toBeLessThanOrEqual(Number(arr[i-1].cost_usd));
            }
        });
    });

    describe('GET /api/llm-audit/limits', () => {
        test('返回 4 條預設配額', async () => {
            const res = await request(app)
                .get('/api/llm-audit/limits')
                .set('Authorization', `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
            const rows = res.body.data;
            expect(rows.length).toBeGreaterThanOrEqual(4);
            // 必須有 global/*
            const globalRule = rows.find(r => r.scope === 'global' && r.scope_key === '*');
            expect(globalRule).toBeTruthy();
            expect(globalRule.daily_token_limit).toBeGreaterThan(0);
        });
    });

    describe('GET /api/llm-audit/pricing', () => {
        test('返回 10 種模型計價', async () => {
            const res = await request(app)
                .get('/api/llm-audit/pricing')
                .set('Authorization', `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
            const rows = res.body.data;
            expect(rows.length).toBeGreaterThanOrEqual(10);
            // 必須有 openai/gpt-4o
            const gpt4o = rows.find(r => r.provider === 'openai' && r.model === 'gpt-4o');
            expect(gpt4o).toBeTruthy();
            expect(Number(gpt4o.input_cost_per_1k)).toBeGreaterThan(0);
            expect(Number(gpt4o.output_cost_per_1k)).toBeGreaterThan(0);
        });
    });

    describe('PUT /api/llm-audit/pricing/:uid — 更新計價', () => {
        let pricingUid;
        const originalInput = 0.0050;

        beforeAll(async () => {
            const { data } = await request(app)
                .get('/api/llm-audit/pricing')
                .set('Authorization', `Bearer ${adminToken}`).then(r => r.body);
            // 找 openai/gpt-4o 的 uid（用原始 DB 查，不受 PUT 測試影響）
            const [dbRows] = await pool.execute(
                "SELECT uid, input_cost_per_1k, output_cost_per_1k FROM cams_ai_model_pricing WHERE provider='openai' AND model='gpt-4o'"
            );
            pricingUid = dbRows[0]?.uid;
            const origIn = Number(dbRows[0]?.input_cost_per_1k || 0);
            const origOut = Number(dbRows[0]?.output_cost_per_1k || 0);

            const { success } = await request(app)
                .put(`/api/llm-audit/pricing/${pricingUid}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ input_cost_per_1k: origIn + 0.0001, output_cost_per_1k: origOut + 0.0001 }).then(r => r.body);
            expect(success).toBe(true);

            // 復原
            await request(app)
                .put(`/api/llm-audit/pricing/${pricingUid}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ input_cost_per_1k: origIn, output_cost_per_1k: origOut });
        });

        test('general 無 CONFIG 權限 → 403', async () => {
            const res = await request(app)
                .put(`/api/llm-audit/pricing/${pricingUid}`)
                .set('Authorization', `Bearer ${generalToken}`)
                .send({ input_cost_per_1k: 0.9999, output_cost_per_1k: 0.9999 });
            // general 無 llmAudit.CONFIG 按鈕 → 403
            expect([401, 403]).toContain(res.status);
        });
    });

    describe('PUT /api/llm-audit/limits/:uid — 更新配額', () => {
        let limitUid;
        const originalLimit = 1000000;

        beforeAll(async () => {
            const { data } = await request(app)
                .get('/api/llm-audit/limits')
                .set('Authorization', `Bearer ${adminToken}`).then(r => r.body);
            const hm = data.find(r => r.scope === 'bu' && r.scope_key === 'HM');
            limitUid = hm?.uid;
        });

        test('admin 可更新配額', async () => {
            // 找 bu=HM 原始值
            const [dbRows] = await pool.execute(
                "SELECT uid, daily_token_limit FROM cams_ai_rate_limit WHERE scope='bu' AND scope_key='HM'"
            );
            const origLimit = dbRows[0].daily_token_limit;
            const uid = dbRows[0].uid;

            const { success } = await request(app)
                .put(`/api/llm-audit/limits/${uid}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ daily_token_limit: origLimit + 500000 });
            expect(success).toBe(true);

            // 驗證 + 復原
            const res = await request(app)
                .get('/api/llm-audit/limits')
                .set('Authorization', `Bearer ${adminToken}`);
            const hm = res.body.data.find(r => r.uid === uid);
            expect(hm.daily_token_limit).toBe(origLimit + 500000);

            await request(app)
                .put(`/api/llm-audit/limits/${uid}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ daily_token_limit: origLimit });
        });

        test('無效 status 值 → 應忽略或報錯', async () => {
            const res = await request(app)
                .put(`/api/llm-audit/limits/${limitUid}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ status: 'INVALID_VALUE' });
            // 要么返回 400/error，要么忽略該欄位但返回 200
            expect([200, 400, 422]).toContain(res.status);
        });
    });

    describe('GET /api/llm-audit/:uid — 單條詳情', () => {
        test('存在的 uid → 200 + 完整欄位', async () => {
            const listRes = await request(app)
                .get('/api/llm-audit/list?limit=1')
                .set('Authorization', `Bearer ${adminToken}`);
            const uid = listRes.body.data.rows[0]?.uid;
            if (!uid) return;

            const res = await request(app)
                .get(`/api/llm-audit/${uid}`)
                .set('Authorization', `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
            expect(res.body.data.uid).toBe(uid);
            expect(res.body.data.provider).toBeTruthy();
            expect(res.body.data.model).toBeTruthy();
        });

        test('不存在 uid → 404', async () => {
            const res = await request(app)
                .get('/api/llm-audit/99999999')
                .set('Authorization', `Bearer ${adminToken}`);
            expect(res.status).toBe(404);
        });
    });

    describe('權限：general 用戶', () => {
        test('general 可讀（readScope 擋數據範圍但不擋讀）', async () => {
            const res = await request(app)
                .get('/api/llm-audit/list')
                .set('Authorization', `Bearer ${generalToken}`);
            expect(res.status).toBe(200);
        });

        test('general 不能刪除（需 CONFIG 按鈕）', async () => {
            // 先找一個 uid
            const listRes = await request(app)
                .get('/api/llm-audit/list?limit=1')
                .set('Authorization', `Bearer ${adminToken}`);
            const uid = listRes.body.data.rows[0]?.uid;
            if (!uid) return;

            const res = await request(app)
                .delete(`/api/llm-audit/${uid}`)
                .set('Authorization', `Bearer ${generalToken}`);
            expect([401, 403]).toContain(res.status);
        });
    });
});
