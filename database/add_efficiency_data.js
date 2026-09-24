/**
 * 為 mgm_finance_summary 補充 2024-2025 人效相關欄位資料（v2）
 * 規則（v2 優化）：
 *   - 員工人數：年度基數 × 季度微調（不再逐月劇烈波動）
 *     HM: 2024基期 85 人, 2025基期 88 人（+3.5% 正常擴編）
 *     SZ: 2024基期 45 人, 2025基期 47 人
 *     HN: 2024基期 35 人, 2025基期 36 人
 *     每季依當季營收相對季目標做 ±5% 以內微調
 *   - 月平均薪資: 年度調薪 5%（2024→2025）
 *     HM: 2024 45K → 2025 47,250
 *     SZ: 2024 38K → 2025 39,900
 *     HN: 2024 35K → 2025 36,750
 *   - 薪資費用 = 員工人數 × 月平均薪資
 */
const { pool } = require('../config/db');

const CONFIG = {
    HM: {
        emp: { '2024': 85, '2025': 88 },
        salary: { '2024': 45000, '2025': 47250 }
    },
    SZ: {
        emp: { '2024': 45, '2025': 47 },
        salary: { '2024': 38000, '2025': 39900 }
    },
    HN: {
        emp: { '2024': 35, '2025': 36 },
        salary: { '2024': 35000, '2025': 36750 }
    }
};

(async () => {
    console.log('=== 補充人效資料 v2（平滑化）===\n');

    // 取得 2024-2025 全部財務資料
    const [rows] = await pool.execute(
        `SELECT bu_no, YYYY_MM, sale_amt 
         FROM mgm_finance_summary 
         WHERE bu_no IN ('HM','SZ','HN') 
           AND YYYY_MM >= '2024/01' AND YYYY_MM <= '2025/12'
         ORDER BY bu_no, YYYY_MM`
    );
    console.log(`找到 ${rows.length} 筆待更新資料`);

    // 計算每家公司每季平均營收（用於季內微調）
    const qAvg = {};  // qAvg[bu_no][YYYY-Q] = 季度平均營收
    const qMap = {};  // qMap[bu_no][YYYY_MM] = YYYY-Q
    for (const r of rows) {
        const [yyyy, mm] = r.YYYY_MM.split('/').map(Number);
        const q = Math.ceil(mm / 3);
        const key = `${yyyy}-Q${q}`;
        qMap[r.bu_no] = qMap[r.bu_no] || {};
        qMap[r.bu_no][r.YYYY_MM] = key;
        qAvg[r.bu_no] = qAvg[r.bu_no] || {};
        qAvg[r.bu_no][key] = qAvg[r.bu_no][key] || { sum: 0, cnt: 0 };
        qAvg[r.bu_no][key].sum += Number(r.sale_amt || 0);
        qAvg[r.bu_no][key].cnt++;
    }

    // 計算季度平均值
    for (const bu of Object.keys(qAvg)) {
        for (const qk of Object.keys(qAvg[bu])) {
            qAvg[bu][qk].avg = qAvg[bu][qk].sum / qAvg[bu][qk].cnt;
        }
    }

    // 2024 各季基線營收（用於比較 2025 同季成長）
    const baseline = {};
    for (const bu of Object.keys(qAvg)) {
        baseline[bu] = {};
        for (const qk of Object.keys(qAvg[bu])) {
            if (qk.startsWith('2024')) {
                baseline[bu][qk.replace('2024', '2025')] = qAvg[bu][qk].avg;
            }
        }
    }

    let updated = 0;
    for (const r of rows) {
        const cfg = CONFIG[r.bu_no];
        if (!cfg) continue;

        const [yyyy, mm] = r.YYYY_MM.split('/').map(Number);
        const year = String(yyyy);

        // 年度基數
        const baseEmp = cfg.emp[year];
        const avgSalary = cfg.salary[year];

        // 季度微調：當季營收相對 2024 同季變化 ±5% 以內
        const qKey = qMap[r.bu_no][r.YYYY_MM];
        let adjFactor = 1;
        if (qKey && qAvg[r.bu_no][qKey] && baseline[r.bu_no][qKey]) {
            const growth = (qAvg[r.bu_no][qKey].avg - baseline[r.bu_no][qKey]) / baseline[r.bu_no][qKey];
            adjFactor = 1 + Math.max(-0.05, Math.min(0.05, growth));
        }

        const empCount = Math.round(baseEmp * adjFactor);
        const salaryAmt = Math.round(empCount * avgSalary);

        await pool.execute(
            `UPDATE mgm_finance_summary 
             SET employee_cnt = ?, salary_amt = ?, avg_salary = ?
             WHERE bu_no = ? AND YYYY_MM = ?`,
            [empCount, salaryAmt, avgSalary, r.bu_no, r.YYYY_MM]
        );
        updated++;
    }

    console.log(`更新完成: ${updated} 筆`);

    // 驗證
    console.log('\n=== 各公司年度基數 ===');
    for (const bu of ['HM','SZ','HN']) {
        const c = CONFIG[bu];
        console.log(`  ${bu}: 2024 員工=${c.emp['2024']}人 薪=${c.salary['2024'].toLocaleString()}; 2025 員工=${c.emp['2025']}人 薪=${c.salary['2025'].toLocaleString()}`);
    }

    console.log('\n=== HM 2024/01-2025/12 趨勢 ===');
    const [trend] = await pool.execute(
        `SELECT YYYY_MM, employee_cnt, salary_amt, avg_salary FROM mgm_finance_summary 
         WHERE bu_no='HM' AND YYYY_MM>='2024/01' ORDER BY YYYY_MM`
    );
    trend.forEach(r => {
        console.log(`  ${r.YYYY_MM}: ${r.employee_cnt}人 / 薪=${Number(r.salary_amt).toLocaleString()} / 平均=${Number(r.avg_salary).toLocaleString()}`);
    });

    console.log('\n=== 2025 年終彙總 ===');
    const [yearly] = await pool.execute(
        `SELECT bu_no, ROUND(AVG(employee_cnt),0) AS avg_emp, 
                ROUND(SUM(salary_amt)/10000,1) AS salary_wan,
                ROUND(SUM(sale_amt)/AVG(employee_cnt)/10000,1) AS per_emp_wan
         FROM mgm_finance_summary WHERE YYYY_MM LIKE '2025%'
         GROUP BY bu_no`
    );
    yearly.forEach(r => {
        console.log(`  ${r.bu_no}: 平均員工=${r.avg_emp}人, 年薪資=${r.salary_wan}萬, 人均年營收=${r.per_emp_wan}萬`);
    });

    process.exit(0);
})();
