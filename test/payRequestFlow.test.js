/**
 * CFO-02 付款排程 / 銀行回單 / AR·AP 核銷 — 接口整合測試
 *
 * 對應測試用例：docs/測試用例_CEO-05_CFO-01_CFO-02.md 的 PAY-01 ~ PAY-19
 * 策略：使用 bu_no='TEST'、YYYY_MM='2099-01' 的專用發票，
 *      驗證排程、回單、核銷、撤銷核銷對 invoice.payment 的正反向回寫。
 */
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../app');
const { pool } = require('../config/db');
const { signToken } = require('../middleware/auth');

const BU = 'TEST';
const INVOICE_NO = 'TEST-INV-AUTO-001';
const PLAN_MONTH = '2099-02';

let plainToken = null;
let invoiceUid = null;
let reqId = null;
let draftReqId = null;
let firstWriteoffId = null;

beforeAll(async () => {
    const [rows] = await pool.execute(
        "SELECT xuser_id FROM cams_xuser WHERE inuse_flag='USE' AND admin<>'Yes' LIMIT 1"
    );
    if (rows.length) plainToken = signToken({ user_id: rows[0].xuser_id, admin: 'No' });

    await pool.execute('DELETE FROM mgm_invoice_details WHERE bu_no=? AND invoice_no=?', [BU, INVOICE_NO]);
    const [ins] = await pool.execute(
        `INSERT INTO mgm_invoice_details
            (bu_no, TX_type, order_id, client_id, invoice_no, sub_amt, tax_type, tax_rate,
             VAT_amt, wk_date, pay_date, payment, ageing_days, DB_CR, YYYY_MM, remark)
         VALUES (?,?,?,?,?,?,?,?,?,?,NULL,0,0,?,?,?)`,
        [BU, 'AP', 'TEST-ORD-001', '測試供應商', INVOICE_NO, 1000, 'VAT', 0.05,
            50, '2099-01-05', 'C', '2099-01', '自動化測試發票']
    );
    invoiceUid = ins.insertId;
});

afterAll(async () => {
    if (reqId) {
        await pool.execute('DELETE FROM pay_writeoff WHERE request_id=?', [reqId]);
        await pool.execute('DELETE FROM pay_request_item WHERE request_id=?', [reqId]);
        await pool.execute('DELETE FROM pay_request WHERE id=?', [reqId]);
    }
    if (draftReqId) {
        await pool.execute('DELETE FROM pay_request_item WHERE request_id=?', [draftReqId]);
        await pool.execute('DELETE FROM pay_request WHERE id=?', [draftReqId]);
    }
    if (invoiceUid) await pool.execute('DELETE FROM mgm_invoice_details WHERE uid=?', [invoiceUid]);
    // 注意：不調 pool.end() — 全域共用 pool，關了會影響其他測試套件
});

async function createPayRequest(amount, target = '測試供應商') {
    const res = await request(app).post('/api/pay-request').send({
        bu_no: BU, pay_type: 'SUPPLIER', pay_target: target, pay_method: 'BANK',
        currency: 'RMB', due_date: PLAN_MONTH + '-10', remark: '自動化測試',
        items: [{ supplier_name: target, invoice_num: INVOICE_NO, invoice_date: '2099-01-05', amount }]
    });
    expect(res.status).toBe(200);
    return res.body.data;
}

describe('CFO-02 付款排程', () => {
    test('PAY-01 非主管無權查看排程', async () => {
        if (!plainToken) return;
        const res = await request(app).get('/api/pay-request/schedule')
            .set('Authorization', `Bearer ${plainToken}`);
        expect(res.status).toBe(403);
        expect(res.body.message).toContain('无权查看付款排程');
    });

    test('PAY-03 建立付款單並設定排程', async () => {
        const created = await createPayRequest(1000);
        reqId = created.id;
        expect(created.status).toBe('DRAFT');

        const res = await request(app).put(`/api/pay-request/${reqId}/schedule`)
            .send({ planned_pay_date: PLAN_MONTH + '-10' });
        expect(res.status).toBe(200);
        expect(res.body.data.planned_pay_date).toBe(PLAN_MONTH + '-10');

        const detail = await request(app).get(`/api/pay-request/${reqId}`);
        expect(String(detail.body.data.planned_pay_date).slice(0, 10)).toBe(PLAN_MONTH + '-10');
    });

    test('PAY-02 非法日期被拒', async () => {
        const res = await request(app).put(`/api/pay-request/${reqId}/schedule`)
            .send({ planned_pay_date: '2099/02/10' });
        expect(res.status).toBe(400);
        expect(res.body.message).toContain('请填写有效的计划付款日');
    });

    test('PAY-04 月度排程匯總', async () => {
        const res = await request(app).get('/api/pay-request/schedule')
            .query({ month: PLAN_MONTH, bu_no: BU });
        expect(res.status).toBe(200);
        expect(res.body.data.summary.count).toBe(1);
        expect(Number(res.body.data.summary.amount)).toBe(1000);
        expect(res.body.data.summary.pending_count).toBe(1);
        expect(res.body.data.rows[0].request_no).toBeTruthy();
    });
});

describe('CFO-02 銀行回單', () => {
    test('PAY-05 核銷來源僅列未付清發票', async () => {
        const res = await request(app).get('/api/pay-request/writeoff-sources')
            .query({ source_type: 'AP', bu_no: BU });
        expect(res.status).toBe(200);
        const row = res.body.data.find(r => r.uid === invoiceUid);
        expect(row).toBeTruthy();
        expect(Number(row.open_amount)).toBe(1000);
    });

    test('PAY-06/07 回單號必填、草稿不可登記', async () => {
        const noNo = await request(app).post(`/api/pay-request/${reqId}/receipt`).send({});
        expect(noNo.status).toBe(400);
        expect(noNo.body.message).toContain('银行回单号必填');

        const draft = await request(app).post(`/api/pay-request/${reqId}/receipt`).send({
            bank_receipt_no: 'BE-TEST-000', receipt_amount: 1000
        });
        expect(draft.status).toBe(400);
        expect(draft.body.message).toContain('不可登记回单');
    });

    test('PAY-08 非管理員不可登記回單', async () => {
        if (!plainToken) return;
        await pool.execute("UPDATE pay_request SET status='APPROVED' WHERE id=?", [reqId]);
        const res = await request(app).post(`/api/pay-request/${reqId}/receipt`)
            .set('Authorization', `Bearer ${plainToken}`)
            .send({ bank_receipt_no: 'BE-TEST-000', receipt_amount: 1000 });
        expect(res.status).toBe(403);
        expect(res.body.message).toContain('只有财务管理员');
    });

    test('PAY-09 登記回單後轉 PAID', async () => {
        const res = await request(app).post(`/api/pay-request/${reqId}/receipt`).send({
            bank_receipt_no: 'BE-TEST-001', receipt_date: PLAN_MONTH + '-10',
            receipt_amount: 1000, receipt_bank: '招商銀行'
        });
        expect(res.status).toBe(200);

        const detail = await request(app).get(`/api/pay-request/${reqId}`);
        expect(detail.body.data.status).toBe('PAID');
        expect(detail.body.data.bank_receipt_no).toBe('BE-TEST-001');
        expect(detail.body.data.writeoff_status).toBe('UNWRITTEN');
    });

    test('PAY-10 已付款不可再調整排程', async () => {
        const res = await request(app).put(`/api/pay-request/${reqId}/schedule`)
            .send({ planned_pay_date: PLAN_MONTH + '-20' });
        expect(res.status).toBe(400);
        expect(res.body.message).toContain('不可调整排程');
    });
});

describe('CFO-02 AR/AP 核銷', () => {
    test('PAY-11 未付款單據不可核銷', async () => {
        const draft = await createPayRequest(500, '測試供應商-未付款');
        draftReqId = draft.id;
        const res = await request(app).post(`/api/pay-request/${draftReqId}/writeoff`)
            .send({ source_uid: invoiceUid, amount: 100 });
        expect(res.status).toBe(400);
        expect(res.body.message).toContain('只有已付款的单据可以核销');
    });

    test('PAY-12 超過付款金額被攔截', async () => {
        const res = await request(app).post(`/api/pay-request/${reqId}/writeoff`)
            .send({ source_uid: invoiceUid, amount: 1200 });
        expect(res.status).toBe(400);
        expect(res.body.message).toContain('核销合计不能超过付款金额');
    });

    test('PAY-13 來源發票不存在回 404', async () => {
        const res = await request(app).post(`/api/pay-request/${reqId}/writeoff`)
            .send({ source_uid: 99999999, amount: 10 });
        expect(res.status).toBe(404);
        expect(res.body.message).toContain('发票不存在');
    });

    test('PAY-14/15 部分核銷 400 並回寫發票', async () => {
        const res = await request(app).post(`/api/pay-request/${reqId}/writeoff`)
            .send({ source_uid: invoiceUid, amount: 400, writeoff_date: PLAN_MONTH + '-10' });
        expect(res.status).toBe(200);
        expect(res.body.data.writeoff_status).toBe('PARTIAL');
        expect(Number(res.body.data.writeoff_total)).toBe(400);

        const [inv] = await pool.execute('SELECT payment, pay_date FROM mgm_invoice_details WHERE uid=?', [invoiceUid]);
        expect(Number(inv[0].payment)).toBe(400);
        expect(inv[0].pay_date).toBeNull();

        const list = await request(app).get(`/api/pay-request/${reqId}/writeoffs`);
        expect(list.status).toBe(200);
        expect(list.body.data.rows).toHaveLength(1);
        expect(Number(list.body.data.total)).toBe(400);
        firstWriteoffId = list.body.data.rows[0].id;
    });

    test('PAY-16 核銷剩餘 600 後為 WRITTEN', async () => {
        const res = await request(app).post(`/api/pay-request/${reqId}/writeoff`)
            .send({ source_uid: invoiceUid, amount: 600, writeoff_date: PLAN_MONTH + '-11' });
        expect(res.status).toBe(200);
        expect(res.body.data.writeoff_status).toBe('WRITTEN');

        const [inv] = await pool.execute('SELECT payment, pay_date FROM mgm_invoice_details WHERE uid=?', [invoiceUid]);
        expect(Number(inv[0].payment)).toBe(1000);
        expect(inv[0].pay_date).toBeTruthy();
    });

    test('PAY-17 撤銷核銷回退發票已付金額', async () => {
        const res = await request(app).delete(`/api/pay-request/${reqId}/writeoff/${firstWriteoffId}`);
        expect(res.status).toBe(200);
        expect(res.body.data.writeoff_status).toBe('PARTIAL');
        expect(Number(res.body.data.writeoff_total)).toBe(600);

        const [inv] = await pool.execute('SELECT payment FROM mgm_invoice_details WHERE uid=?', [invoiceUid]);
        expect(Number(inv[0].payment)).toBe(600);
    });

    test('PAY-18 非管理員不可撤銷核銷', async () => {
        if (!plainToken) return;
        const list = await request(app).get(`/api/pay-request/${reqId}/writeoffs`);
        const wid = list.body.data.rows[0].id;
        const res = await request(app).delete(`/api/pay-request/${reqId}/writeoff/${wid}`)
            .set('Authorization', `Bearer ${plainToken}`);
        expect(res.status).toBe(403);
        expect(res.body.message).toContain('只有财务管理员');
    });

    test('PAY-19 撤銷不存在的核銷回 404', async () => {
        const res = await request(app).delete(`/api/pay-request/${reqId}/writeoff/99999999`);
        expect(res.status).toBe(404);
        expect(res.body.message).toContain('核销记录不存在');
    });
});
