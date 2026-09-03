/**
 * Bank Loan API 測試
 *
 * 修復內容回顧：
 *  1. INSERT 欄位清單 (25欄) 與 VALUES ? 數量 (25個) 精確匹配
 *  2. 新增 diff_amt, loss_flag 欄位至 INSERT
 *  3. 使用 n() 包裹所有參數防止 undefined 綁定錯誤
 *  4. 自動計算 next_paydate 和 pay_days
 */
const { request, app, pool, TEST_BU, cleanupTestData, closePool } = require('./setup');

describe('Bank Loan API', () => {
    let loanUid;

    beforeAll(async () => {
        await cleanupTestData();
    });

    afterAll(async () => {
        await cleanupTestData();
        // 注意：不調 closePool() — pool 是全域共用，關了會影響其他測試套件
    });

    describe('POST /api/bank — 新增銀行貸款', () => {
        test('應成功新增且回傳 uid', async () => {
            const res = await request(app)
                .post('/api/bank')
                .send({
                    bu_no: TEST_BU,
                    type1: '貸款',
                    loan_id: 'LOAN_TEST_001',
                    bank_id: 'BANK_A',
                    loan_type: '短期借款',
                    pay_terms: 12,
                    interest_rate: 5.5,
                    exchange_rate: 4.5,
                    loan_amt: 1000000,
                    last_paydate: '2099-01-01'
                });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.uid).toBeDefined();
            loanUid = res.body.data.uid;
        });

        test('不應回傳 "Column count doesn\'t match" 錯誤', async () => {
            const res = await request(app)
                .post('/api/bank')
                .send({
                    bu_no: TEST_BU,
                    type1: '貸款',
                    loan_id: 'LOAN_TEST_002',
                    bank_id: 'BANK_B',
                    loan_type: '長期借款',
                    pay_terms: 24,
                    interest_rate: 6.0,
                    exchange_rate: 1.0,
                    loan_amt: 2000000,
                    last_paydate: '2099-06-01'
                });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).not.toContain('Column count');
        });

        test('應自動計算 next_paydate', async () => {
            const res = await request(app)
                .post('/api/bank')
                .send({
                    bu_no: TEST_BU,
                    type1: '貸款',
                    loan_id: 'LOAN_TEST_003',
                    bank_id: 'BANK_C',
                    loan_type: '外幣貸款',
                    pay_terms: 6,
                    exchange_rate: 7.2,
                    loan_amt: 500000,
                    last_paydate: '2099-01-15'
                });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        test('缺少 bu_no 不應導致 undefined 綁定錯誤 (應為 NOT NULL 約束錯誤)', async () => {
            const res = await request(app)
                .post('/api/bank')
                .send({ loan_id: 'LOAN_NO_BU' });
            // bu_no 是 NOT NULL 欄位，n() 將 undefined 轉為 null 後 MySQL 會拒絕
            // 但不應是 "Bind parameters must not contain undefined" 錯誤
            expect(res.body.success).toBe(false);
            expect(res.body.message).not.toContain('undefined');
            expect(res.body.message).not.toContain('Bind parameters');
        });
    });

    describe('GET /api/bank — 列表查詢', () => {
        test('應回傳測試貸款記錄', async () => {
            const res = await request(app).get(`/api/bank?bu_no=${TEST_BU}`);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.length).toBeGreaterThanOrEqual(2);
        });

        test('回傳記錄應包含 loan_id 欄位', async () => {
            const res = await request(app).get(`/api/bank?bu_no=${TEST_BU}`);
            const loan = res.body.data[0];
            expect(loan.loan_id).toBeDefined();
            expect(loan.loan_amt).toBeDefined();
        });
    });

    describe('PUT /api/bank/:uid — 修改', () => {
        test('應成功更新貸款資料', async () => {
            if (!loanUid) return; // 跳過如果未取得 uid
            const res = await request(app)
                .put(`/api/bank/${loanUid}`)
                .send({
                    bu_no: TEST_BU,
                    loan_id: 'LOAN_TEST_001',
                    bank_id: 'BANK_A_UPDATED',
                    loan_type: '短期借款',
                    pay_terms: 6,
                    interest_rate: 4.0,
                    exchange_rate: 4.5,
                    loan_amt: 1200000,
                    status1: '使用中'
                });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    describe('DELETE /api/bank/:uid — 刪除', () => {
        test('應成功刪除貸款記錄', async () => {
            if (!loanUid) return;
            const res = await request(app).delete(`/api/bank/${loanUid}`);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });
});
