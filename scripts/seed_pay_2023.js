/**
 * 补全 pay_detail 2023 年度付款明细（2 BU × 12 月 × 6 条/月 ≈ 144 条）
 *
 * 结构（完全对齐现有 2024/2025 样本）：
 *   原料款 × 3（钢材供应商A、塑胶原料B、电子零组件C）— 从 summary.sale_cost_amt 反推
 *   税金   × 1（国家税务局）— VAT 应纳税额
 *   劳保   × 1（劳动社会保障局）— 工资 × 社保比例
 *   房租   × 1（房租管理公司）— 固定 + 年成长
 */
const { pool } = require('../config/db');

// LCG 随机
let seed = 20231001;
function rnd() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
const pad2 = n => String(n).padStart(2, '0');

const SUPPLIERS_RAW = ['钢材供应商A', '塑胶原料B', '电子零组件C'];
const VAT_RATE = 0.13;
const SOCIAL_RATIO = 0.4;   // 社保/公积金 ≈ 工资的 40%
const BASE_RENT = { HM: 80000, SZ: 50000 };  // 月度房租基数

async function run() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ===== 0. 清理旧 2023 =====
    const [del] = await conn.execute("DELETE FROM pay_detail WHERE pay_date LIKE '2023%' OR should_date LIKE '2023%' OR data_year='2023'");
    console.log(`✓ 清理 ${del.affectedRows} 行旧 2023 pay_detail`);

    // ===== 1. 读取 summary 2023 取数 =====
    const [sum] = await pool.execute(
      "SELECT bu_no, YYYY_MM, sale_amt, sale_cost_amt, salary_amt FROM mgm_finance_summary WHERE YYYY_MM LIKE '2023-%' ORDER BY bu_no, YYYY_MM");
    const sumMap = {};
    sum.forEach(r => { sumMap[r.bu_no + '|' + r.YYYY_MM] = r; });
    console.log(`✓ 读取 summary ${sum.length} 行`);

    let count = 0;

    for (const bu of ['HM', 'SZ']) {
      for (let m = 1; m <= 12; m++) {
        const ym = `2023-${pad2(m)}`;
        const row = sumMap[bu + '|' + ym];
        const sale = row ? Number(row.sale_amt || 0) : 0;
        const cost = row ? Number(row.sale_cost_amt || 0) : 0;
        const salary = row ? Number(row.salary_amt || 0) : 0;

        const y = 2023;
        const should_day = 25;   // 约定付款日
        const inv_day = 10;      // 发票日

        // === 原料款 3 条 ===
        // 原料成本 ≈ cost × 70%（其余 30% 是人工 + 制造费用）
        const rawTotal = Math.round(cost * 0.7);
        // 3 家供应商按比例分配（微随机）
        const ratios = [0.38 + rnd() * 0.06, 0.32 + rnd() * 0.06, 0.30 + rnd() * 0.06];
        const rsum = ratios.reduce((a, b) => a + b, 0);
        const normed = ratios.map(r => r / rsum);
        const amounts = [
          Math.round(rawTotal * normed[0]),
          Math.round(rawTotal * normed[1]),
          rawTotal - Math.round(rawTotal * normed[0]) - Math.round(rawTotal * normed[1]),
        ];

        for (let i = 0; i < 3; i++) {
          const amt = amounts[i];
          const inv = `${bu}R${y}${pad2(m)}${pad2(i+1)}`;
          const should = `${y}-${pad2(m)}-${pad2(should_day)}`;
          const invDate = `${y}-${pad2(m)}-${pad2(inv_day)}`;
          // 70% 当月付，30% 次月付
          const isPaid = rnd() < 0.7;
          const pay_m = isPaid ? m : (m === 12 ? 1 : m + 1);
          const pay_y = isPaid ? y : (m === 12 ? 2024 : y);
          const payDate = isPaid ? `${pay_y}-${pad2(pay_m)}-${pad2(28)}` : null;

          await conn.execute(`
            INSERT INTO pay_detail (bu_no, supplier_name, finance_type, should_date, invoice_date,
              amount, currency_ab, invoice_num, pay_date, expense_content, remark, entry_date, data_year, create_time, update_time)
            VALUES (?, ?, '原料款', ?, ?, ?, 'RMB', ?, ?, '原料款', ?, ?, '2023', NOW(), NOW())
          `, [bu, SUPPLIERS_RAW[i], should, invDate, amt, inv, payDate, SUPPLIERS_RAW[i], invDate]);
          count++;
        }

        // === 税金 1 条 ===
        const vatOut = Math.round(sale * VAT_RATE);
        const vatIn  = Math.round(cost * VAT_RATE);
        const vatPay = Math.max(0, vatOut - vatIn);
        const invTax = `INV${bu}${y}${pad2(m)}TAX`;
        const shouldTax = `${y}-${pad2(m)}-${pad2(15)}`;    // 税金每月 15 日前
        const invDateTax = `${y}-${pad2(m)}-${pad2(inv_day)}`;
        const payDateTax = `${y}-${pad2(m)}-${pad2(12)}`;

        await conn.execute(`
          INSERT INTO pay_detail (bu_no, supplier_name, finance_type, should_date, invoice_date,
            amount, currency_ab, invoice_num, pay_date, expense_content, remark, entry_date, data_year, create_time, update_time)
          VALUES (?, '国家税务局', '税金', ?, ?, ?, 'RMB', ?, ?, '税金', '国家税务局', ?, '2023', NOW(), NOW())
        `, [bu, shouldTax, invDateTax, vatPay, invTax, payDateTax, invDateTax]);
        count++;

        // === 劳保 1 条 ===
        const socialPay = Math.round(salary * SOCIAL_RATIO);
        const invSocial = `INV${bu}${y}${pad2(m)}SOC`;
        const shouldSocial = `${y}-${pad2(m)}-${pad2(25)}`;
        const invDateSocial = `${y}-${pad2(m)}-${pad2(inv_day)}`;
        const payDateSocial = `${y}-${pad2(m)}-${pad2(20)}`;

        await conn.execute(`
          INSERT INTO pay_detail (bu_no, supplier_name, finance_type, should_date, invoice_date,
            amount, currency_ab, invoice_num, pay_date, expense_content, remark, entry_date, data_year, create_time, update_time)
          VALUES (?, '劳动社会保障局', '劳保', ?, ?, ?, 'RMB', ?, ?, '劳保', '劳动社会保障局', ?, '2023', NOW(), NOW())
        `, [bu, shouldSocial, invDateSocial, socialPay, invSocial, payDateSocial, invDateSocial]);
        count++;

        // === 房租 1 条 ===
        // 每月固定 + 年度 5% 涨幅（从 7 月起）
        const rentBase = BASE_RENT[bu];
        const rentMult = m <= 6 ? 1 : 1 + (m - 6) * 0.01;   // 下半年每月涨 1%
        const rentPay = Math.round(rentBase * rentMult);
        const invRent = `INV${bu}${y}${pad2(m)}RENT`;
        const shouldRent = `${y}-${pad2(m)}-${pad2(5)}`;   // 房租月初付
        const invDateRent = `${y}-${pad2(m)}-${pad2(1)}`;
        const payDateRent = `${y}-${pad2(m)}-${pad2(3)}`;

        await conn.execute(`
          INSERT INTO pay_detail (bu_no, supplier_name, finance_type, should_date, invoice_date,
            amount, currency_ab, invoice_num, pay_date, expense_content, remark, entry_date, data_year, create_time, update_time)
          VALUES (?, '房租管理公司', '房租', ?, ?, ?, 'RMB', ?, ?, '房租', '房租管理公司', ?, '2023', NOW(), NOW())
        `, [bu, shouldRent, invDateRent, rentPay, invRent, payDateRent, invDateRent]);
        count++;

        if (m === 1 || m === 6 || m === 12) {
          console.log(`  ${bu} ${ym}: raw=${rawTotal.toLocaleString()} vat=${vatPay.toLocaleString()} social=${socialPay.toLocaleString()} rent=${rentPay.toLocaleString()}`);
        }
      }
    }

    await conn.commit();
    console.log(`\n✓ 写入完成：${count} 条付款明细`);

    // 验证
    const [cnt] = await conn.execute(`
      SELECT bu_no, finance_type, COUNT(*) AS n, SUM(amount) AS t
        FROM pay_detail WHERE data_year='2023' GROUP BY bu_no, finance_type ORDER BY bu_no, finance_type`);
    console.log('\n=== 2023 pay_detail 汇总 ===');
    cnt.forEach(r => console.log(`  ${r.bu_no} ${r.finance_type}: ${r.n}笔 / ${Number(r.t).toLocaleString()}元`));

    const [total] = await conn.execute("SELECT COUNT(*) AS n, SUM(amount) AS t FROM pay_detail WHERE data_year='2023'");
    console.log(`\n  总计: ${total[0].n}笔 / ${Number(total[0].t).toLocaleString()}元`);

  } catch (err) {
    console.error('❌ 失败:', err.message);
    await conn.rollback();
    process.exit(1);
  } finally {
    conn.release();
    await pool.end();
  }
}

run();
