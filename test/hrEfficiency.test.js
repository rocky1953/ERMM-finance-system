/**
 * CEO-05 組織人效分析 — 接口整合測試
 *
 * 對應測試用例：docs/測試用例_CEO-05_CFO-01_CFO-02.md 的 HR-01 ~ HR-16
 * 策略：直連 ERMM_db，人效總覽用既有 2025-12 資料做只讀校驗；
 *      編制 CRUD 使用 period=2099-01/2099-02 的專用資料，測試後清理。
 */
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../app');
const { pool } = require('../config/db');
const { signToken } = require('../middleware/auth');

const PERIOD_A = '2099-01';
const PERIOD_B = '2099-02';
const DEPT = '自動化測試部';

let plainToken = null;
let planUid = null;

beforeAll(async () => {
    const [rows] = await pool.execute(
        "SELECT xuser_id FROM cams_xuser WHERE inuse_flag='USE' AND admin<>'Yes' LIMIT 1"
    );
    if (rows.length) plainToken = signToken({ user_id: rows[0].xuser_id, admin: 'No' });
});

afterAll(async () => {
    await pool.execute(
        'DELETE FROM hr_headcount_plan WHERE period IN (?,?) AND depart_name=?',
        [PERIOD_A, PERIOD_B, DEPT]
    );
    // 注意：不調 pool.end() — 全域共用 pool，關了會影響其他測試套件
});

describe('CEO-05 人效總覽', () => {
    test('HR-01/02/03/04 指定月份回傳 KPI、部門與 6 個月趨勢', async () => {
        const [fin] = await pool.execute(
            "SELECT employee_cnt FROM mgm_finance_summary WHERE bu_no='HM' AND YYYY_MM='2025-12' LIMIT 1"
        );
        expect(fin.length).toBe(1);

        const res = await request(app)
            .get('/api/hr-efficiency/overview')
            .query({ bu_no: 'HM', YYYY_MM: '2025-12' });

        expect(res.status).toBe(200);
        const d = res.body.data;
        expect(d.bu_no).toBe('HM');
        expect(d.period).toBe('2025-12');
        expect(d.kpi.employee_cnt).toBe(Number(fin[0].employee_cnt));

        ['plan_headcount', 'headcount_gap', 'headcount_rate', 'per_capita_output',
            'per_capita_salary', 'labor_cost_rate', 'total_hours', 'per_capita_hours']
            .forEach(k => expect(d.kpi).toHaveProperty(k));

        expect(Array.isArray(d.departments)).toBe(true);
        expect(d.departments.length).toBeGreaterThan(0);
        ['depart_name', 'plan_headcount', 'actual_headcount', 'headcount_rate',
            'total_hours', 'per_capita_hours', 'timeliness_rate', 'work_ratio']
            .forEach(k => expect(d.departments[0]).toHaveProperty(k));

        expect(Array.isArray(d.trend)).toBe(true);
        expect(d.trend).toHaveLength(6);
        expect(d.trend[5].period).toBe('2025-12');
        ['output', 'per_capita_output', 'salary_amt', 'labor_cost_rate']
            .forEach(k => expect(d.trend[5]).toHaveProperty(k));
    });

    test('HR-05 未帶月份時預設最新月份', async () => {
        const [[latest]] = await pool.execute(
            "SELECT MAX(YYYY_MM) AS ym FROM mgm_finance_summary WHERE bu_no='HN'"
        );
        const res = await request(app).get('/api/hr-efficiency/overview').query({ bu_no: 'HN' });
        expect(res.status).toBe(200);
        expect(res.body.data.period).toBe(latest.ym);
    });

    test('HR-06 非法公司別回 400', async () => {
        const res = await request(app).get('/api/hr-efficiency/overview').query({ bu_no: 'XX' });
        expect(res.status).toBe(400);
        expect(res.body.message).toContain('公司别仅支持');
    });

    test('HR-07 非主管無權查看總覽', async () => {
        if (!plainToken) return;
        const res = await request(app)
            .get('/api/hr-efficiency/overview')
            .query({ bu_no: 'HM' })
            .set('Authorization', `Bearer ${plainToken}`);
        expect(res.status).toBe(403);
        expect(res.body.message).toContain('权限不足');
    });
});

describe('CEO-05 部門編制 CRUD', () => {
    test('HR-08 讀取 2025-12 演示編制', async () => {
        const res = await request(app)
            .get('/api/hr-efficiency/headcount-plans')
            .query({ bu_no: 'HM', period: '2025-12' });
        expect(res.status).toBe(200);
        expect(res.body.data.rows.length).toBeGreaterThanOrEqual(7);
    });

    test('HR-09/10 新增後重複提交為覆蓋', async () => {
        const first = await request(app).post('/api/hr-efficiency/headcount-plans').send({
            bu_no: 'HM', period: PERIOD_A, depart_name: DEPT,
            plan_headcount: 5, plan_labor_cost: 100000, note: '自動化測試'
        });
        expect(first.status).toBe(200);
        expect(Number(first.body.data.plan_headcount)).toBe(5);
        planUid = first.body.data.uid;

        const second = await request(app).post('/api/hr-efficiency/headcount-plans').send({
            bu_no: 'HM', period: PERIOD_A, depart_name: DEPT,
            plan_headcount: 6, plan_labor_cost: 120000, note: '覆蓋測試'
        });
        expect(second.status).toBe(200);
        expect(Number(second.body.data.plan_headcount)).toBe(6);

        const [rows] = await pool.execute(
            'SELECT * FROM hr_headcount_plan WHERE bu_no=? AND period=? AND depart_name=?',
            ['HM', PERIOD_A, DEPT]
        );
        expect(rows).toHaveLength(1);
    });

    test('HR-11 編輯實際人數', async () => {
        const res = await request(app)
            .put(`/api/hr-efficiency/headcount-plans/${planUid}`)
            .send({ actual_headcount: 3 });
        expect(res.status).toBe(200);
        expect(Number(res.body.data.actual_headcount)).toBe(3);
    });

    test('HR-12/13 複製編制：首次複製、再次全部略過', async () => {
        const first = await request(app).post('/api/hr-efficiency/headcount-plans/copy').send({
            bu_no: 'HM', from_period: PERIOD_A, to_period: PERIOD_B
        });
        expect(first.status).toBe(200);
        expect(first.body.data.copied).toBeGreaterThanOrEqual(1);

        const again = await request(app).post('/api/hr-efficiency/headcount-plans/copy').send({
            bu_no: 'HM', from_period: PERIOD_A, to_period: PERIOD_B
        });
        expect(again.status).toBe(200);
        expect(again.body.data.copied).toBe(0);
        expect(again.body.data.skipped).toBeGreaterThanOrEqual(1);
    });

    test('HR-14 來源月份無資料時提示', async () => {
        const res = await request(app).post('/api/hr-efficiency/headcount-plans/copy').send({
            bu_no: 'HN', from_period: '2099-08', to_period: '2099-09'
        });
        expect(res.status).toBe(400);
        expect(res.body.message).toContain('无编制数据可复制');
    });

    test('HR-16 參數校驗：負數編制與錯誤月份格式', async () => {
        const badNum = await request(app).post('/api/hr-efficiency/headcount-plans').send({
            bu_no: 'HM', period: PERIOD_A, depart_name: DEPT, plan_headcount: -1
        });
        expect(badNum.status).toBe(400);

        const badPeriod = await request(app).post('/api/hr-efficiency/headcount-plans').send({
            bu_no: 'HM', period: '2099/1', depart_name: DEPT, plan_headcount: 1
        });
        expect(badPeriod.status).toBe(400);
    });

    test('HR-15 刪除後再刪回 404', async () => {
        const del = await request(app).delete(`/api/hr-efficiency/headcount-plans/${planUid}`);
        expect(del.status).toBe(200);

        const again = await request(app).delete(`/api/hr-efficiency/headcount-plans/${planUid}`);
        expect(again.status).toBe(404);
    });
});
