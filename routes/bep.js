/**
 * BEP 損益平衡點分析路由
 *
 * 公式:
 *   材料     = 消耗品 + 包裝費 + 加工費 + 雜項購置 + 運費 + 進出口費用 + 服務零件與賠償
 *   變動成本 = 材料 + 變動費用
 *   邊際貢獻   = 銷售金額 - 變動成本
 *   邊際貢獻率 = 邊際貢獻 / 銷售金額 * 100
 *   損益平衡點 = 固定成本 / (邊際貢獻率 / 100)    [邊際貢獻率 > 0]
 *   不足訂單   = 銷售金額 - 損益平衡點
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, n } = require('../utils/response');

// 參考: mysql2 DECIMAL 回傳 string, 用 n() 轉 number
function toNum(v) {
  const num = Number(v);
  return isNaN(num) ? 0 : num;
}

function calcBEP(sale_amt, db) {
  const s = toNum(sale_amt);
  const consumable = toNum(db.consumable);
  const packaging = toNum(db.packaging);
  const processing = toNum(db.processing);
  const misc_purchase = toNum(db.misc_purchase);
  const freight = toNum(db.freight);
  const customs = toNum(db.customs);
  const service_part_comp = toNum(db.service_part_comp);
  const variable_expense = toNum(db.variable_expense);
  const fixed_cost = toNum(db.fixed_cost);

  const material = consumable + packaging + processing + misc_purchase
                 + freight + customs + service_part_comp;
  const variable_cost = material + variable_expense;
  const contribution_margin = s - variable_cost;
  const cm_rate = s > 0 ? (contribution_margin / s) * 100 : 0;
  const bep = cm_rate > 0 ? fixed_cost / (cm_rate / 100) : 0;
  const gap = s - bep;

  return {
    sale_amt: s,
    consumable, packaging, processing, misc_purchase,
    freight, customs, service_part_comp,
    variable_expense, fixed_cost,
    material, variable_cost, contribution_margin,
    cm_rate, bep, gap
  };
}

// 查詢 / 即時計算
router.get('/query', async (req, res) => {
  try {
    const { bu_no, YYYY_MM } = req.query;
    if (!bu_no || !YYYY_MM) return fail(res, '需要 bu_no 與 YYYY_MM');

    // 1. DB 可編輯欄位（先查，後續 fallback 可能覆蓋）
    let [bepRows] = await pool.execute(
      'SELECT * FROM MGM_BEP_threshold WHERE bu_no=? AND YYYY_MM=? LIMIT 1',
      [bu_no, YYYY_MM]
    );

    // 2. 銷售金額（自 MGM_finance_summary）— 若指定月份無資料則 fallback 最新
    let sale_amt = 0;
    let usedYM = YYYY_MM;
    const [sum] = await pool.execute(
        'SELECT sale_amt FROM MGM_finance_summary WHERE bu_no=? AND YYYY_MM=? LIMIT 1',
        [bu_no, YYYY_MM]
    );
    if (sum.length === 0) {
        const [latest] = await pool.execute(
            'SELECT YYYY_MM, sale_amt FROM MGM_finance_summary WHERE bu_no=? ORDER BY YYYY_MM DESC LIMIT 1',
            [bu_no]
        );
        if (latest.length > 0) {
            usedYM = latest[0].YYYY_MM;
            sale_amt = latest[0].sale_amt ?? 0;
            // 若指定月份的 BEP 門檻不存在，用最新月份的
            if (bepRows.length === 0) {
                const [bepLatest] = await pool.execute(
                    'SELECT * FROM MGM_BEP_threshold WHERE bu_no=? AND YYYY_MM=? LIMIT 1',
                    [bu_no, usedYM]
                );
                if (bepLatest.length > 0) bepRows = bepLatest;
            }
        }
    } else {
        sale_amt = sum[0].sale_amt ?? 0;
    }

    const db = bepRows[0] || {
      consumable: 0, packaging: 0, processing: 0, misc_purchase: 0,
      freight: 0, customs: 0, service_part_comp: 0,
      variable_expense: 0, fixed_cost: 0
    };

    const result = calcBEP(sale_amt, db);
    result.uid = db.uid || null;
    result.bu_no = bu_no;
    result.YYYY_MM = YYYY_MM;

    ok(res, result);
  } catch (err) { fail500(res, err); }
});

// 保存可編輯欄位（按 bu_no + YYYY_MM upsert）
router.post('/save', async (req, res) => {
  try {
    const {
      bu_no, YYYY_MM,
      consumable, packaging, processing, misc_purchase,
      freight, customs, service_part_comp,
      variable_expense, fixed_cost, remark
    } = req.body;
    if (!bu_no || !YYYY_MM) return fail(res, '需要 bu_no 與 YYYY_MM');

    await pool.execute(
      `INSERT INTO MGM_BEP_threshold
       (bu_no, YYYY_MM, consumable, packaging, processing, misc_purchase,
        freight, customs, service_part_comp, variable_expense, fixed_cost, remark)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         consumable=VALUES(consumable), packaging=VALUES(packaging),
         processing=VALUES(processing), misc_purchase=VALUES(misc_purchase),
         freight=VALUES(freight), customs=VALUES(customs),
         service_part_comp=VALUES(service_part_comp),
         variable_expense=VALUES(variable_expense),
         fixed_cost=VALUES(fixed_cost), remark=VALUES(remark)`,
      [bu_no, YYYY_MM,
       n(consumable), n(packaging), n(processing), n(misc_purchase),
       n(freight), n(customs), n(service_part_comp),
       n(variable_expense), n(fixed_cost), remark || null]
    );

    // 保存後重算回傳最新結果
    const [sum] = await pool.execute(
      'SELECT sale_amt FROM MGM_finance_summary WHERE bu_no=? AND YYYY_MM=? LIMIT 1',
      [bu_no, YYYY_MM]
    );
    const sale_amt = sum[0]?.sale_amt ?? 0;
    const [br] = await pool.execute(
      'SELECT * FROM MGM_BEP_threshold WHERE bu_no=? AND YYYY_MM=? LIMIT 1',
      [bu_no, YYYY_MM]
    );
    const result = calcBEP(sale_amt, br[0]);
    result.uid = br[0]?.uid || null;
    result.bu_no = bu_no;
    result.YYYY_MM = YYYY_MM;

    ok(res, { saved: true, data: result });
  } catch (err) { fail500(res, err); }
});

module.exports = router;
