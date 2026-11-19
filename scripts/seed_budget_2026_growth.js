/**
 * 按 10% 增长系数，以 2025 年财务汇总（RMB）为基数生成 2026 年预算
 *
 * 规则：
 * 1. 公司：HM/HN/SZ；科目：4100/5100/6100/6200/6300
 * 2. 2026 各月预算 = 2025 同月实际 × 1.10
 * 3. 2026 无实际数，actual_amt 置 0；预算保持 draft，供编制/审批流程使用
 * 4. budget_detail 按 (budget_uid, account_code, YYYY_MM) 幂等 upsert
 *
 * 用法：node scripts/seed_budget_2026_growth.js [增长率，默认 1.10]
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const BUS = ['HM', 'HN', 'SZ'];
const BASE_YEAR = '2025';
const TARGET_YEAR = '2026';
const GROWTH = Number(process.argv[2]) || 1.10;
const ACCOUNTS = [
    { code: '4100', name: '销售收入', field: 'sale_amt' },
    { code: '5100', name: '销售成本', field: 'sale_cost_amt' },
    { code: '6100', name: '销售费用', field: 'sale_exp_amt' },
    { code: '6200', name: '管理费用', field: 'MGM_EXP_amt' },
    { code: '6300', name: '财务费用', field: 'finance_EXP_amt' }
];

const n = (v) => Number(v || 0);
const grow = (v) => Math.round((n(v) * GROWTH + Number.EPSILON) * 100) / 100;

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'ERMM_db'
    });

    try {
        await conn.beginTransaction();

        for (const bu of BUS) {
            const [baseRows] = await conn.execute(
                `SELECT YYYY_MM, sale_amt, sale_cost_amt, sale_exp_amt, MGM_EXP_amt, finance_EXP_amt
                 FROM mgm_finance_summary
                 WHERE bu_no=? AND YYYY_MM LIKE ?
                 ORDER BY YYYY_MM`,
                [bu, `${BASE_YEAR}%`]
            );
            if (!baseRows.length) {
                console.log(`⚠ ${bu} ${BASE_YEAR} 无财务汇总数据，跳过`);
                continue;
            }

            const name = `${bu} ${TARGET_YEAR}年度营业预算（${BASE_YEAR}年增长${Math.round((GROWTH - 1) * 100)}%）`;
            const [exist] = await conn.execute(
                'SELECT uid FROM budget WHERE bu_no=? AND YYYY=?',
                [bu, TARGET_YEAR]
            );

            let budgetUid;
            if (exist.length) {
                budgetUid = exist[0].uid;
                await conn.execute(
                    `UPDATE budget SET budget_name=?, currency='RMB', status='draft',
                        submitted_by=NULL, submitted_at=NULL, approved_by=NULL, approved_at=NULL,
                        reject_reason=NULL, remark=?
                     WHERE uid=?`,
                    [name, `按 ${BASE_YEAR} 年数据增长 ${Math.round((GROWTH - 1) * 100)}% 生成`, budgetUid]
                );
            } else {
                const [ins] = await conn.execute(
                    `INSERT INTO budget
                        (bu_no, YYYY, budget_name, currency, status, created_by, remark)
                     VALUES (?,?,?,'RMB','draft','SYSTEM',?)`,
                    [bu, TARGET_YEAR, name, `按 ${BASE_YEAR} 年数据增长 ${Math.round((GROWTH - 1) * 100)}% 生成`]
                );
                budgetUid = ins.insertId;
            }

            let rows = 0;
            let saleBudget = 0;
            for (const s of baseRows) {
                const mm = s.YYYY_MM.slice(5, 7);
                const targetYm = `${TARGET_YEAR}-${mm}`;
                for (const a of ACCOUNTS) {
                    const amt = grow(s[a.field]);
                    if (a.code === '4100') saleBudget += amt;
                    await conn.execute(
                        `INSERT INTO budget_detail
                            (budget_uid, bu_no, account_code, account_name, YYYY_MM, budget_amt, actual_amt)
                         VALUES (?,?,?,?,?,?,0)
                         ON DUPLICATE KEY UPDATE bu_no=VALUES(bu_no), account_name=VALUES(account_name),
                            budget_amt=VALUES(budget_amt), actual_amt=0`,
                        [budgetUid, bu, a.code, a.name, targetYm, amt]
                    );
                    rows++;
                }
            }

            console.log(`✔ ${bu} ${TARGET_YEAR}: uid=${budgetUid}, 月份=${baseRows.length}, 明细=${rows}, 营收预算=${saleBudget.toFixed(2)}`);
        }

        await conn.commit();
        console.log(`\n✅ ${TARGET_YEAR} 年预算已按 ${Math.round((GROWTH - 1) * 100)}% 增长系数生成`);
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        await conn.end();
    }
})().catch(err => {
    console.error('✘ 执行失败:', err.message);
    process.exit(1);
});
