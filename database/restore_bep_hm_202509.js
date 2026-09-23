/**
 * 恢復 HM 2025/09 被「保存門檻」bug 覆蓋為全 0 的門檻值
 * 資料來源：HM 2025/08（同一基準，2025 年各月標準值一致）
 */
const { pool } = require('../config/db');
(async () => {
  const [src] = await pool.execute(
    `SELECT * FROM mgm_bep_threshold WHERE bu_no='HM' AND YYYY_MM='2025/08' LIMIT 1`
  );
  if (!src.length) throw new Error('source 2025/08 not found');
  const s = src[0];

  await pool.execute(
    `UPDATE mgm_bep_threshold SET
       consumable=?, packaging=?, processing=?, misc_purchase=?,
       freight=?, customs=?, service_part_comp=?, variable_expense=?,
       fixed_salary=?, fixed_rent=?, fixed_interest=?, fixed_cost=?,
       remark=?
     WHERE bu_no='HM' AND YYYY_MM='2025/09'`,
    [s.consumable, s.packaging, s.processing, s.misc_purchase,
     s.freight, s.customs, s.service_part_comp, s.variable_expense,
     s.fixed_salary, s.fixed_rent, s.fixed_interest, s.fixed_cost,
     'CW397基準（2026-09-16 自 2025/08 恢復）']
  );

  const [chk] = await pool.execute(
    `SELECT YYYY_MM, consumable, packaging, processing, misc_purchase,
            freight, customs, service_part_comp, variable_expense,
            fixed_salary, fixed_rent, fixed_interest, fixed_cost,
            (COALESCE(consumable,0)+COALESCE(packaging,0)+COALESCE(processing,0)
             +COALESCE(misc_purchase,0)+COALESCE(freight,0)+COALESCE(customs,0)
             +COALESCE(service_part_comp,0)+COALESCE(variable_expense,0)
             +COALESCE(fixed_cost,0)) AS total_cost
     FROM mgm_bep_threshold WHERE bu_no='HM' AND YYYY_MM='2025/09'`
  );
  console.log('restored:', JSON.stringify(chk[0], null, 1));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
