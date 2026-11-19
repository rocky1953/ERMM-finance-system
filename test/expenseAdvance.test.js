/**
 * CFO-01 費用報銷：借支 / 預支與核銷 — 接口整合測試
 *
 * 對應測試用例：docs/測試用例_CEO-05_CFO-01_CFO-02.md 的 ADV-01 ~ ADV-20
 * 說明：提交後需主管→財務審批，測試以 DB 直接改狀態模擬「審批通過」，
 *      再驗證撥付、部分核銷、全額核銷與權限。
 */
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../app');
const { pool } = require('../config/db');
const { signToken } = require('../middleware/auth');

const TITLE = '自動化測試借支';

let plainToken = null;
let advId = null;
let draftId = null;

async function cleanupAdvance(id) {
    if (!id) return;
    const [wf] = await pool.execute(
        "SELECT id FROM wf_instance WHERE business_type='ADVANCE' AND business_id=?", [id]
    );
    for (const w of wf) {
        await pool.execute('DELETE FROM wf_log WHERE instance_id=?', [w.id]);
        await pool.execute('DELETE FROM wf_task WHERE instance_id=?', [w.id]);
        await pool.execute('DELETE FROM wf_instance WHERE id=?', [w.id]);
    }
    await pool.execute('DELETE FROM exp_advance_settle WHERE advance_id=?', [id]);
    await pool.execute('DELETE FROM exp_advance WHERE id=?', [id]);
}

beforeAll(async () => {
    const [rows] = await pool.execute(
        "SELECT xuser_id FROM cams_xuser WHERE inuse_flag='USE' AND admin<>'Yes' LIMIT 1"
    );
    if (rows.length) plainToken = signToken({ user_id: rows[0].xuser_id, admin: 'No' });
});

afterAll(async () => {
    await cleanupAdvance(advId);
    await cleanupAdvance(draftId);
    await pool.execute('DELETE FROM exp_advance WHERE title=?', [TITLE]);
    // 注意：不調 pool.end() — 全域共用 pool，關了會影響其他測試套件
});

describe('CFO-01 借支建單與校驗', () => {
    test('ADV-01/02 事由必填、金額須大於 0', async () => {
        const noTitle = await request(app).post('/api/expense/advances').send({ amount: 100 });
        expect(noTitle.status).toBe(400);
        expect(noTitle.body.message).toContain('借支事由必填');

        const zero = await request(app).post('/api/expense/advances').send({ title: TITLE, amount: 0 });
        expect(zero.status).toBe(400);
        expect(zero.body.message).toContain('必须大于 0');
    });

    test('ADV-04 建立借支單並生成 JK 單號', async () => {
        const res = await request(app).post('/api/expense/advances').send({
            title: TITLE, amount: 1000, advance_type: 'TRAVEL',
            bu_no: 'HM', expected_return_date: '2099-03-31', remark: '自動化測試'
        });
        expect(res.status).toBe(200);
        expect(res.body.data.advance_no).toMatch(/^JK\d{8}\d{4}$/);
        advId = res.body.data.id;
    });

    test('ADV-03 非法借支類型回退為 GENERAL', async () => {
        const res = await request(app).post('/api/expense/advances').send({
            title: TITLE, amount: 100, advance_type: 'XXX'
        });
        expect(res.status).toBe(200);
        draftId = res.body.data.id;

        const [rows] = await pool.execute('SELECT advance_type FROM exp_advance WHERE id=?', [draftId]);
        expect(rows[0].advance_type).toBe('GENERAL');
    });

    test('ADV-05 我的借支清單包含該單', async () => {
        const res = await request(app).get('/api/expense/advances').query({ scope: 'mine' });
        expect(res.status).toBe(200);
        const row = res.body.data.find(a => a.id === advId);
        expect(row).toBeTruthy();
        expect(row.status).toBe('DRAFT');
        expect(Number(row.amount)).toBe(1000);
        expect(Number(row.balance)).toBe(1000);
    });

    test('ADV-06 草稿可編輯金額且同步餘額', async () => {
        const res = await request(app).put(`/api/expense/advances/${advId}`).send({
            title: TITLE, amount: 800, advance_type: 'TRAVEL', bu_no: 'HM'
        });
        expect(res.status).toBe(200);

        const detail = await request(app).get(`/api/expense/advances/${advId}`);
        expect(detail.status).toBe(200);
        expect(Number(detail.body.data.amount)).toBe(800);
        expect(Number(detail.body.data.balance)).toBe(800);
    });
});

describe('CFO-01 借支審批與狀態機', () => {
    test('ADV-07 提交後轉 PENDING 並建立流程', async () => {
        const res = await request(app).post(`/api/expense/advances/${advId}/submit`).send({});
        expect(res.status).toBe(200);
        expect(['PENDING', 'APPROVED']).toContain(res.body.data.status);
        expect(res.body.data.instance_id).toBeTruthy();

        const [rows] = await pool.execute(
            'SELECT status, wf_instance_id FROM exp_advance WHERE id=?', [advId]
        );
        expect(['PENDING', 'APPROVED']).toContain(rows[0].status);
        expect(rows[0].wf_instance_id).toBeTruthy();
    });

    test('ADV-08/09 已提交不可編輯、不可刪除', async () => {
        const edit = await request(app).put(`/api/expense/advances/${advId}`)
            .send({ title: TITLE, amount: 900 });
        expect(edit.status).toBe(400);
        expect(edit.body.message).toContain('不可编辑');

        const del = await request(app).delete(`/api/expense/advances/${advId}`);
        expect(del.status).toBe(400);
        expect(del.body.message).toContain('只有草稿可以删除');
    });

    test('ADV-10/11 未審批不可撥付、未撥付不可核銷', async () => {
        if ((await currentStatus()) === 'PENDING') {
            const pay = await request(app).post(`/api/expense/advances/${advId}/pay`).send({});
            expect(pay.status).toBe(400);
            expect(pay.body.message).toContain('只有审批通过');

            const settle = await request(app).post(`/api/expense/advances/${advId}/settle`)
                .send({ amount: 100 });
            expect(settle.status).toBe(400);
            expect(settle.body.message).toContain('尚未拨付');
        }
    });

    test('ADV-12 審批通過後撥付', async () => {
        await pool.execute(
            "UPDATE exp_advance SET status='APPROVED', approve_time=NOW() WHERE id=?", [advId]
        );
        const res = await request(app).post(`/api/expense/advances/${advId}/pay`).send({});
        expect(res.status).toBe(200);

        const detail = await request(app).get(`/api/expense/advances/${advId}`);
        expect(detail.body.data.status).toBe('PAID');
        expect(detail.body.data.paid_date).toBeTruthy();
    });
});

describe('CFO-01 借支核銷', () => {
    test('ADV-13 超過未核銷餘額被攔截', async () => {
        const res = await request(app).post(`/api/expense/advances/${advId}/settle`)
            .send({ amount: 1300 });
        expect(res.status).toBe(400);
        expect(res.body.message).toContain('超过未核销余额');
    });

    test('ADV-14 部分核銷 300 後仍為 PAID', async () => {
        const res = await request(app).post(`/api/expense/advances/${advId}/settle`)
            .send({ amount: 300, note: '部分核銷' });
        expect(res.status).toBe(200);
        expect(Number(res.body.data.balance)).toBe(500);
        expect(Number(res.body.data.settled_amount)).toBe(300);

        const detail = await request(app).get(`/api/expense/advances/${advId}`);
        expect(detail.body.data.status).toBe('PAID');
    });

    test('ADV-15/16 核銷剩餘 500 結清，再核銷被拒', async () => {
        const res = await request(app).post(`/api/expense/advances/${advId}/settle`)
            .send({ amount: 500 });
        expect(res.status).toBe(200);
        expect(Number(res.body.data.balance)).toBe(0);

        const detail = await request(app).get(`/api/expense/advances/${advId}`);
        expect(detail.body.data.status).toBe('SETTLED');

        const again = await request(app).post(`/api/expense/advances/${advId}/settle`)
            .send({ amount: 100 });
        expect(again.status).toBe(400);

        const after = await request(app).get(`/api/expense/advances/${advId}`);
        expect(after.body.data.settles).toHaveLength(2);
    });

    test('ADV-17/18 非管理員不可撥付、非主管不可核銷', async () => {
        if (!plainToken) return;
        const pay = await request(app).post(`/api/expense/advances/${advId}/pay`)
            .set('Authorization', `Bearer ${plainToken}`).send({});
        expect(pay.status).toBe(403);
        expect(pay.body.message).toContain('只有管理员');

        const settle = await request(app).post(`/api/expense/advances/${advId}/settle`)
            .set('Authorization', `Bearer ${plainToken}`).send({ amount: 10 });
        expect(settle.status).toBe(403);
        expect(settle.body.message).toContain('只有财务或主管');
    });

    test('ADV-19 草稿可刪除', async () => {
        const del = await request(app).delete(`/api/expense/advances/${draftId}`);
        expect(del.status).toBe(200);
        const detail = await request(app).get(`/api/expense/advances/${draftId}`);
        expect(detail.status).toBe(404);
        draftId = null;
    });

    test('ADV-20 他人不可查看非本人借支', async () => {
        if (!plainToken) return;
        const res = await request(app).get(`/api/expense/advances/${advId}`)
            .set('Authorization', `Bearer ${plainToken}`);
        expect(res.status).toBe(403);
        expect(res.body.message).toContain('无权查看');
    });
});

async function currentStatus() {
    const [rows] = await pool.execute('SELECT status FROM exp_advance WHERE id=?', [advId]);
    return rows[0] && rows[0].status;
}
