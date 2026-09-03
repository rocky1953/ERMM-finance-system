/**
 * 修正 HM 2024/12（用完整 string→number fallback 逻辑）
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

    // 先 DELETE HM 2024/12 错误数据
    await pool.execute("DELETE FROM MGM_finance_summary WHERE bu_no='HM' AND YYYY_MM='2024/12'");

    const [baseRows] = await pool.execute(
        'SELECT * FROM MGM_finance_summary WHERE bu_no=? AND YYYY_MM=?',
        ['HM', '2024/11']
    );
    const base = baseRows[0];
    const factor = 1.07;

    const row = { ...base };
    row.bu_no = 'HM'; row.YYYY_MM = '2024/12'; row.YYYY = '2024'; row.MM = '12';

    const FIXED_FIELDS = ['bu_no', 'flag', 'captial_stock', 'captial_reserve', 'legal_reserve',
                          'VAT_rate', 'batch_id', 'Z_X1', 'Z_X2', 'Z_X3', 'Z_X4', 'Z_X5',
                          'employee_cnt', 'exchange_rate'];

    for (const k of Object.keys(row)) {
        if (FIXED_FIELDS.includes(k)) continue;
        if (['uid', 'YYYY', 'MM', 'YYYY_MM', 'flag', 'create_time', 'update_time'].includes(k)) continue;
        if (typeof row[k] === 'number' && row[k] !== 0) {
            row[k] = Math.round(row[k] * factor * 100) / 100;
        } else if (typeof row[k] === 'string' && /^-?\d/.test(row[k]) && !isNaN(Number(row[k]))) {
            const n = Number(row[k]);
            if (n !== 0) row[k] = Math.round(n * factor * 100) / 100;  // 统一转成 number
        }
    }

    // 確保 A = L + E
    const totalAsset = Number(row.ttl_asset_amt || 0);
    const totalDebet = Number(row.ttl_debet_amt || 0);
    const equityCap = Number(row.captial_stock || 0) + Number(row.captial_reserve || 0) + Number(row.legal_reserve || 0);
    const currentPL = Number(row.current_PL_amt || 0);
    row.accumulated_amt = Math.round((totalAsset - totalDebet - equityCap - currentPL) * 100) / 100;
    row.stockholder_amt = Math.round((totalAsset - totalDebet) * 100) / 100;
    row.retained_income_amt = row.accumulated_amt;

    const cols = Object.keys(row).filter(k => k !== 'uid' && k !== 'create_time' && k !== 'update_time');
    const placeholders = cols.map(() => '?').join(',');
    const sql = `INSERT INTO MGM_finance_summary (${cols.join(',')}) VALUES (${placeholders})`;
    const vals = cols.map(c => {
        const v = row[c];
        return (v === null || v === undefined) ? null : v;
    });

    await pool.execute(sql, vals);
    console.log(`[OK] HM 2024/12 summary sale=${row.sale_amt} (prev=13680000) net_profit=${row.net_profit_amt}`);
    console.log(`     asset=${row.ttl_asset_amt} debet=${row.ttl_debet_amt} equity=${equityCap + row.accumulated_amt + currentPL}`);

    await pool.end();
}
main().catch(err => { console.error(err); process.exit(1); });
