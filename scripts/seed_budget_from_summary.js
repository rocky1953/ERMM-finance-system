/**
 * 按财务汇总（mgm_finance_summary，RMB 口径）重新生成 2023~2025 年预算
 *
 * 规则：
 * 1. 公司：HM/HN/SZ；年度：2023/2024/2025；科目：4100/5100/6100/6200/6300
 * 2. 预算金额 = 财务汇总当月实际金额（预算与实际同源，达成率 100%）
 * 3. 历史年度预算统一置为 approved，币别 RMB
 * 4. budget_detail 按 (budget_uid, account_code, YYYY_MM) 幂等 upsert，可重复执行
 *
 * 用法：node scripts/seed_budget_from_summary.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const BUS = ['HM', 'HN', 'SZ'];
const YEARS = ['2023', '2024', '2025'];
const ACCOUNTS = [
    { code: '4100', name: '销售收入', field: 'sale_amt' },
    { code: '5100', name: '销售成本', field: 'sale_cost_amt' },
    { code: '6100', name: '销售费用', field: 'sale_exp_amt' },
    { code: '6200', name: '管理费用', field: 'MGM_EXP_amt' },
    { code: '6300', name: '财务费用', field: 'finance_EXP_amt' }
];

const n = (v) => Number(v || 0);

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
            for (const year of YEARS) {
                const [sumRows] = await conn.execute(
                    `SELECT YYYY_MM, sale_amt, sale_cost_amt, sale_exp_amt, MGM_EXP_amt, finance_EXP_amt
                     FROM mgm_finance_summary
                     WHERE bu_no=? AND YYYY_MM LIKE ?
                     ORDER BY YYYY_MM`,
                    [bu, `${year}%`]
                );
                if (!sumRows.length) {
                    console.log(`⚠ ${bu} ${year} 无财务汇总数据，跳过`);
                    continue;
                }

                const name = `${bu} ${year}年度营业预算（按财务汇总）`;
                const [exist] = await conn.execute(
                    'SELECT uid FROM budget WHERE bu_no=? AND YYYY=?',
                    [bu, year]
                );

                let budgetUid;
                if (exist.length) {
                    budgetUid = exist[0].uid;
                    await conn.execute(
                        `UPDATE budget SET budget_name=?, currency='RMB', status='approved',
                            submitted_by='SYSTEM', submitted_at=NOW(), approved_by='SYSTEM', approved_at=NOW(),
                            reject_reason=NULL, remark='按财务汇总 RMB 实际数重新生成'
                         WHERE uid=?`,
                        [name, budgetUid]
                    );
                } else {
                    const [ins] = await conn.execute(
                        `INSERT INTO budget
                            (bu_no, YYYY, budget_name, currency, status, created_by,
                             submitted_by, submitted_at, approved_by, approved_at, remark)
                         VALUES (?,?,?,'RMB','approved','SYSTEM','SYSTEM',NOW(),'SYSTEM',NOW(),
                                 '按财务汇总 RMB 实际数重新生成')`,
                        [bu, year, name]
                    );
                    budgetUid = ins.insertId;
                }

                let rows = 0;
                let saleBudget = 0;
                for (const s of sumRows) {
                    for (const a of ACCOUNTS) {
                        const amt = n(s[a.field]);
                        if (a.code === '4100') saleBudget += amt;
                        await conn.execute(
                            `INSERT INTO budget_detail
                                (budget_uid, bu_no, account_code, account_name, YYYY_MM, budget_amt, actual_amt)
                             VALUES (?,?,?,?,?,?,?)
                             ON DUPLICATE KEY UPDATE bu_no=VALUES(bu_no), account_name=VALUES(account_name),
                                budget_amt=VALUES(budget_amt), actual_amt=VALUES(actual_amt)`,
                            [budgetUid, bu, a.code, a.name, s.YYYY_MM, amt, amt]
                        );
                        rows++;
                    }
                }

                console.log(`✔ ${bu} ${year}: uid=${budgetUid}, 月份=${sumRows.length}, 明细=${rows}, 营收预算=${saleBudget.toFixed(2)}`);
            }
        }

        await conn.commit();
        console.log('\n✅ 2023~2025 年预算已按财务汇总重新生成');
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
