/**
 * 擴展 MGM_BEP_threshold：固定成本明細拆分
 *
 * 新增 3 個固定成本明細欄位（對應 mgm_casher_details 支出類型）：
 *   fixed_salary   工資
 *   fixed_rent     房租水電
 *   fixed_interest 利息支出
 *
 * 固定成本 fixed_cost = fixed_salary + fixed_rent + fixed_interest
 *
 * 回填策略（保留各列原 fixed_cost 總額不變，僅拆分結構）：
 *   1) 若該 bu/YYYY_MM 於 mgm_casher_details 有對應 CR 支出實際值，
 *      依實際比例分攤 fixed_cost
 *   2) 無實際資料時用預設比例 工資65% / 房租水電22% / 利息支出13%
 *   3) 尾差歸入工資，確保合計與原 fixed_cost 完全相等
 *
 * 執行: node database/extend_bep_fixed.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const FIXED_AMT_TYPES = ['工資', '房租水電', '利息支出'];
const FIELD_MAP = {
  '工資': 'fixed_salary',
  '房租水電': 'fixed_rent',
  '利息支出': 'fixed_interest'
};
// 預設分攤比例（無實際資料時）
const DEFAULT_RATIO = { fixed_salary: 0.65, fixed_rent: 0.22, fixed_interest: 0.13 };

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'ERMM_db',
    multipleStatements: true,
    charset: 'utf8mb4'
  });

  console.log('=== BEP 固定成本明細擴展開始 ===\n');

  // Step 1: 檢查欄位是否已存在，不存在則 ALTER TABLE
  const [cols] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'MGM_BEP_threshold'
       AND COLUMN_NAME IN ('fixed_salary','fixed_rent','fixed_interest')`,
    [process.env.DB_NAME || 'ERMM_db']
  );
  const existing = new Set(cols.map(c => c.COLUMN_NAME));

  const addCols = [
    ['fixed_salary', "ADD COLUMN fixed_salary DECIMAL(18,2) DEFAULT 0 COMMENT '固定成本-工資' AFTER variable_expense"],
    ['fixed_rent', "ADD COLUMN fixed_rent DECIMAL(18,2) DEFAULT 0 COMMENT '固定成本-房租水電' AFTER fixed_salary"],
    ['fixed_interest', "ADD COLUMN fixed_interest DECIMAL(18,2) DEFAULT 0 COMMENT '固定成本-利息支出' AFTER fixed_rent"]
  ];
  const toAdd = addCols.filter(([name]) => !existing.has(name)).map(([, sql]) => sql);
  if (toAdd.length > 0) {
    await pool.execute('ALTER TABLE MGM_BEP_threshold ' + toAdd.join(', '));
    console.log('Step 1 新增欄位:', toAdd.length, '個 →', toAdd.length === 3 ? 'fixed_salary/fixed_rent/fixed_interest' : '部分新增');
  } else {
    console.log('Step 1 欄位已存在，略過 ALTER TABLE');
  }

  // Step 2: 找出需要回填的列（fixed_cost > 0 且三個明細合計為 0/NULL）
  const [rows] = await pool.execute(
    `SELECT uid, bu_no, YYYY_MM, fixed_cost
     FROM MGM_BEP_threshold
     WHERE fixed_cost > 0
       AND IFNULL(fixed_salary,0) + IFNULL(fixed_rent,0) + IFNULL(fixed_interest,0) = 0`
  );
  console.log(`Step 2 需回填的列: ${rows.length} 筆\n`);

  let updated = 0;
  for (const r of rows) {
    const total = round2(r.fixed_cost);

    // 嘗試取得該 bu/月於 casher 的實際固定支出金額
    const placeholders = FIXED_AMT_TYPES.map(() => '?').join(',');
    const [cashRows] = await pool.execute(
      `SELECT amt_type, SUM(sub_amt) AS amt
       FROM mgm_casher_details
       WHERE bu_no=? AND YYYY_MM=? AND DB_CR='CR' AND amt_type IN (${placeholders})
       GROUP BY amt_type`,
      [r.bu_no, r.YYYY_MM, ...FIXED_AMT_TYPES]
    );
    const actual = { fixed_salary: 0, fixed_rent: 0, fixed_interest: 0 };
    let actualTotal = 0;
    for (const c of cashRows) {
      const field = FIELD_MAP[c.amt_type];
      if (field) { actual[field] = Number(c.amt) || 0; actualTotal += actual[field]; }
    }

    let salary, rent, interest;
    if (actualTotal > 0) {
      // 依實際比例分攤，但總額鎖定為原 fixed_cost
      salary = round2(total * (actual.fixed_salary / actualTotal));
      rent = round2(total * (actual.fixed_rent / actualTotal));
      interest = round2(total * (actual.fixed_interest / actualTotal));
    } else {
      salary = round2(total * DEFAULT_RATIO.fixed_salary);
      rent = round2(total * DEFAULT_RATIO.fixed_rent);
      interest = round2(total * DEFAULT_RATIO.fixed_interest);
    }
    // 尾差歸入工資，確保合計 == total
    salary = round2(total - rent - interest);

    await pool.execute(
      `UPDATE MGM_BEP_threshold
       SET fixed_salary=?, fixed_rent=?, fixed_interest=?
       WHERE uid=?`,
      [salary, rent, interest, r.uid]
    );
    updated++;
    if (updated <= 5 || updated === rows.length) {
      console.log(`  ✓ ${r.bu_no} ${r.YYYY_MM} fixed_cost=${total.toLocaleString()} → 工資=${salary.toLocaleString()} 房租水電=${rent.toLocaleString()} 利息=${interest.toLocaleString()}${actualTotal > 0 ? ' (依實際比例)' : ' (預設比例)'}`);
    }
  }

  // Step 3: 驗證合計一致
  const [verify] = await pool.execute(
    `SELECT bu_no, YYYY_MM, fixed_cost,
            IFNULL(fixed_salary,0) AS s, IFNULL(fixed_rent,0) AS r, IFNULL(fixed_interest,0) AS i
     FROM MGM_BEP_threshold
     ORDER BY bu_no, YYYY_MM`
  );
  let mismatch = 0;
  for (const v of verify) {
    const sum = round2(Number(v.s) + Number(v.r) + Number(v.i));
    if (Math.abs(sum - round2(v.fixed_cost)) > 0.01) {
      mismatch++;
      console.log(`  ✗ 合計不符 ${v.bu_no} ${v.YYYY_MM}: fixed_cost=${v.fixed_cost} 明細合計=${sum}`);
    }
  }
  console.log(`\nStep 3 驗證完成: 共 ${verify.length} 筆, 不符 ${mismatch} 筆`);

  await pool.end();
  console.log(`\n=== 擴展完成: 回填 ${updated} 筆 ===`);
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
