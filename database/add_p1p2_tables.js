/**
 * P1/P2 功能資料表遷移腳本
 * 建立 budget / budget_detail 預算表 + 管理會計部門資料
 * 執行：node database/add_p1p2_tables.js
 */
const { pool } = require('../config/db');

async function run() {
    try {
        // 1. budget 預算主表（年度預算）
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS budget (
                uid INT AUTO_INCREMENT PRIMARY KEY,
                bu_no VARCHAR(10) NOT NULL,
                YYYY VARCHAR(4) NOT NULL,
                budget_name VARCHAR(100) NOT NULL,
                status VARCHAR(20) DEFAULT 'draft',
                created_by VARCHAR(50),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_bu_year (bu_no, YYYY)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        console.log('✅ budget 表已建立');

        // 2. budget_detail 預算明細表（依科目/月份）
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS budget_detail (
                uid INT AUTO_INCREMENT PRIMARY KEY,
                budget_uid INT NOT NULL,
                bu_no VARCHAR(10) NOT NULL,
                account_code VARCHAR(30) NOT NULL,
                account_name VARCHAR(100) NOT NULL,
                YYYY_MM VARCHAR(7) NOT NULL,
                budget_amt DECIMAL(18,2) DEFAULT 0,
                actual_amt DECIMAL(18,2) DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_budget (budget_uid),
                INDEX idx_bu_acct (bu_no, account_code)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        console.log('✅ budget_detail 表已建立');

        // 3. mgmt_dept 管理會計部門表
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS mgmt_dept (
                uid INT AUTO_INCREMENT PRIMARY KEY,
                bu_no VARCHAR(10) NOT NULL,
                dept_code VARCHAR(20) NOT NULL,
                dept_name VARCHAR(50) NOT NULL,
                dept_type VARCHAR(20) DEFAULT 'cost',
                manager VARCHAR(50),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uk_bu_dept (bu_no, dept_code)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        console.log('✅ mgmt_dept 表已建立');

        // 4. mgmt_dept_pl 部門損益表
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS mgmt_dept_pl (
                uid INT AUTO_INCREMENT PRIMARY KEY,
                bu_no VARCHAR(10) NOT NULL,
                dept_code VARCHAR(20) NOT NULL,
                YYYY_MM VARCHAR(7) NOT NULL,
                revenue_amt DECIMAL(18,2) DEFAULT 0,
                cost_amt DECIMAL(18,2) DEFAULT 0,
                expense_amt DECIMAL(18,2) DEFAULT 0,
                profit_amt DECIMAL(18,2) DEFAULT 0,
                headcount INT DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uk_bu_dept_mm (bu_no, dept_code, YYYY_MM)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        console.log('✅ mgmt_dept_pl 表已建立');

        // 5. 種子資料：部門
        const [deptCnt] = await pool.execute('SELECT COUNT(*) AS c FROM mgmt_dept');
        if (deptCnt[0].c === 0) {
            await pool.execute(`
                INSERT INTO mgmt_dept (bu_no, dept_code, dept_name, dept_type, manager) VALUES
                ('HM','D001','生產部','cost','王廠長'),
                ('HM','D002','業務部','profit','林業務'),
                ('HM','D003','管理部','cost','張管理'),
                ('HM','D004','財務部','cost','李財務'),
                ('HM','D005','研發部','cost','陳研發'),
                ('SZ','D001','生產部','cost','趙廠長'),
                ('SZ','D002','業務部','profit','錢業務'),
                ('SZ','D003','管理部','cost','孫管理'),
                ('HN','D001','生產部','cost','周廠長'),
                ('HN','D002','業務部','profit','吳業務'),
                ('HN','D003','管理部','cost','鄭管理')
            `);
            console.log('✅ 部門種子資料已載入 (11 筆)');
        }

        // 6. 種子資料：部門損益（從 finance_summary 拆分模擬）
        const [plCnt] = await pool.execute('SELECT COUNT(*) AS c FROM mgmt_dept_pl');
        if (plCnt[0].c === 0) {
            const months = ['2025/08','2025/09','2025/10','2025/11','2025/12'];
            const buDepts = {
                HM: ['D001','D002','D003','D004','D005'],
                SZ: ['D001','D002','D003'],
                HN: ['D001','D002','D003']
            };
            const inserts = [];
            for (const [bu, depts] of Object.entries(buDepts)) {
                for (const mm of months) {
                    for (const dept of depts) {
                        const isProfit = dept === 'D002';
                        const revenue = isProfit ? Math.round(Math.random() * 5000 + 3000) : 0;
                        const cost = isProfit ? Math.round(revenue * (0.5 + Math.random() * 0.3)) : 0;
                        const expense = Math.round(Math.random() * 800 + 200);
                        const profit = revenue - cost - expense;
                        const hc = dept === 'D001' ? 30 + Math.floor(Math.random()*10) : dept === 'D002' ? 10 + Math.floor(Math.random()*5) : 5 + Math.floor(Math.random()*3);
                        inserts.push(`('${bu}','${dept}','${mm}',${revenue},${cost},${expense},${profit},${hc})`);
                    }
                }
            }
            await pool.execute(`INSERT INTO mgmt_dept_pl (bu_no, dept_code, YYYY_MM, revenue_amt, cost_amt, expense_amt, profit_amt, headcount) VALUES ${inserts.join(',')}`);
            console.log(`✅ 部門損益種子資料已載入 (${inserts.length} 筆)`);
        }

        // 7. 種子資料：2025 年度預算
        const [budCnt] = await pool.execute('SELECT COUNT(*) AS c FROM budget');
        if (budCnt[0].c === 0) {
            await pool.execute(`
                INSERT INTO budget (bu_no, YYYY, budget_name, status, created_by) VALUES
                ('HM','2025','2025年度營業預算','approved','admin'),
                ('SZ','2025','2025年度營業預算','approved','admin'),
                ('HN','2025','2025年度營業預算','draft','admin')
            `);
            const budgets = await pool.execute('SELECT uid, bu_no FROM budget WHERE YYYY=2025');
            const accounts = [
                {code:'4100', name:'銷售收入'}, {code:'5100', name:'銷售成本'},
                {code:'6100', name:'銷售費用'}, {code:'6200', name:'管理費用'},
                {code:'6300', name:'財務費用'}
            ];
            const detailInserts = [];
            for (const b of budgets[0]) {
                for (const acct of accounts) {
                    for (let m = 1; m <= 12; m++) {
                        const mm = `2025/${String(m).padStart(2,'0')}`;
                        const isRevenue = acct.code === '4100';
                        const base = isRevenue ? 8000 : (acct.code === '5100' ? 5000 : 1000);
                        const budgetAmt = Math.round(base * (0.9 + Math.random() * 0.2));
                        const actualAmt = Math.round(budgetAmt * (0.85 + Math.random() * 0.3));
                        detailInserts.push(`(${b.uid},'${b.bu_no}','${acct.code}','${acct.name}','${mm}',${budgetAmt},${actualAmt})`);
                    }
                }
            }
            await pool.execute(`INSERT INTO budget_detail (budget_uid, bu_no, account_code, account_name, YYYY_MM, budget_amt, actual_amt) VALUES ${detailInserts.join(',')}`);
            console.log(`✅ 預算種子資料已載入 (${detailInserts.length} 筆明細)`);
        }

        console.log('\n🎉 P1/P2 功能資料表與種子資料設定完成！');
        process.exit(0);
    } catch (err) {
        console.error('❌ 遷移失敗:', err.message);
        process.exit(1);
    }
}

run();
