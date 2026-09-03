/**
 * 擴展 mgm_casher_details（現金日記賬）從 2024/11 外推到 2024/12 ~ 2025/12
 * 每個 BU 每個 amt_type 從 2024/11 複製金額，按月 7% 複利成長
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASS || 'ld68315711',
        database: process.env.DB_NAME || 'ERMM_db',
        multipleStatements: true
    });

    const BUS = ['HM', 'HN', 'SZ'];
    const BASE_MONTH = '2024/11';
    const GROWTH = 1.07;

    // 生成目標月份
    function genMonths(from, to) {
        const [fy, fm] = from.split('/').map(Number);
        const [ty, tm] = to.split('/').map(Number);
        const list = [];
        let y = fy, m = fm;
        while (y < ty || (y === ty && m <= tm)) {
            list.push(`${y}/${String(m).padStart(2,'0')}`);
            m++; if (m > 12) { m = 1; y++; }
        }
        return list;
    }
    const targets = genMonths('2024/12', '2025/12');
    console.log(`要生成 ${targets.length} 個月的現金日記賬`);

    for (const bu_no of BUS) {
        // 讀取 2024/11 基準現金账
        const [baseRows] = await pool.execute(
            'SELECT * FROM MGM_casher_details WHERE bu_no=? AND YYYY_MM=?',
            [bu_no, BASE_MONTH]
        );
        if (baseRows.length === 0) { console.error(`找不到 ${bu_no} ${BASE_MONTH} 現金账`); continue; }

        for (let i = 0; i < targets.length; i++) {
            const ym = targets[i];
            const factor = Math.pow(GROWTH, i + 1);
            const [yyyy, mm] = ym.split('/').map(Number);

            // 檢查是否已存在
            const [exist] = await pool.execute(
                'SELECT uid FROM MGM_casher_details WHERE bu_no=? AND YYYY_MM=? LIMIT 1',
                [bu_no, ym]
            );
            if (exist.length > 0) { console.log(`  [跳過] ${bu_no} ${ym} 已存在`); continue; }

            let cnt = 0;
            for (const b of baseRows) {
                const day = Math.max(1, Math.min(28, parseInt(String(b.wk_date).slice(-2)) || 15));
                const wk_date = `${yyyy}-${String(mm).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                const sub_amt = Math.round(Number(b.sub_amt || 0) * factor * 100) / 100;
                const newNum = `${b.num_vman.replace(BASE_MONTH.replace('/',''), ym.replace('/',''))}`;

                await pool.execute(`
                    INSERT INTO MGM_casher_details
                    (bu_no, amt_type, client_id, num_vman, sub_amt, DB_CR,
                     YYYY, MM, YYYY_MM, wk_date, bank_acct, remark)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                `, [
                    bu_no, b.amt_type, b.client_id, newNum, sub_amt, b.DB_CR,
                    String(yyyy), String(mm), ym, wk_date, b.bank_acct, b.remark
                ]);
                cnt++;
            }
            console.log(`  [OK] casher ${bu_no} ${ym}: ${cnt} 筆`);
        }
    }

    // 平衡驗證：每 BU 每月 DR 總和 vs summary AR_amt；CR 總和 vs summary AP_amt
    console.log('\n===== 驗證 =====');
    const [rows] = await pool.execute(`
        SELECT bu_no, YYYY_MM,
               SUM(CASE WHEN DB_CR='DR' THEN sub_amt ELSE 0 END) AS dr_total,
               SUM(CASE WHEN DB_CR='CR' THEN sub_amt ELSE 0 END) AS cr_total,
               COUNT(*) cnt
        FROM MGM_casher_details
        WHERE YYYY_MM>='2024/09' AND YYYY_MM<='2025/12'
        GROUP BY bu_no, YYYY_MM
        ORDER BY bu_no, YYYY_MM
    `);
    let ok = true;
    for (const r of rows) {
        const [sm] = await pool.execute(
            'SELECT AR_amt, AP_amt FROM MGM_finance_summary WHERE bu_no=? AND YYYY_MM=?',
            [r.bu_no, r.YYYY_MM]
        );
        if (sm.length > 0) {
            const arDiff = Math.abs(Number(r.dr_total || 0) - Number(sm[0].AR_amt || 0));
            const apDiff = Math.abs(Number(r.cr_total || 0) - Number(sm[0].AP_amt || 0));
            const mark = (arDiff < r.dr_total * 0.1) ? '✓' : '✗';
            if (arDiff >= r.dr_total * 0.1) ok = false;
            console.log(`  ${mark} ${r.bu_no} ${r.YYYY_MM}: DR=${r.dr_total} (AR=${sm[0].AR_amt})  CR=${r.cr_total} (AP=${sm[0].AP_amt})  cnt=${r.cnt}`);
        }
    }
    console.log(`\n共 ${rows.length} 個月現金日记账記錄`);

    await pool.end();
    console.log('\n完成！');
}

main().catch(err => { console.error(err); process.exit(1); });
