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

// 歷史趨勢（供子彈窗顯示 12 個月趨勢圖）
// GET /api/bep/history?bu_no=HM&year=2025
router.get('/history', async (req, res) => {
  try {
    const { bu_no, year } = req.query;
    if (!bu_no) return fail(res, '需要 bu_no');

    // 若沒指定年份，取該公司最新年份
    let targetYear = year;
    if (!targetYear) {
      const [latest] = await pool.execute(
        'SELECT YYYY_MM FROM MGM_BEP_threshold WHERE bu_no=? ORDER BY YYYY_MM DESC LIMIT 1',
        [bu_no]
      );
      if (latest.length === 0) return ok(res, { months: [] });
      targetYear = latest[0].YYYY_MM.substring(0, 4);
    }

    // 取該公司指定年份所有月份（BEP threshold JOIN finance_summary）
    const [rows] = await pool.execute(
      `SELECT t.YYYY_MM, t.consumable, t.packaging, t.processing, t.misc_purchase,
              t.freight, t.customs, t.service_part_comp,
              t.variable_expense, t.fixed_cost,
              s.sale_amt
       FROM MGM_BEP_threshold t
       LEFT JOIN MGM_finance_summary s
         ON t.bu_no=s.bu_no AND t.YYYY_MM=s.YYYY_MM
       WHERE t.bu_no=? AND t.YYYY_MM LIKE ?
       ORDER BY t.YYYY_MM`,
      [bu_no, targetYear + '%']
    );

    const months = rows.map(r => {
      const consumable = toNum(r.consumable);
      const packaging = toNum(r.packaging);
      const processing = toNum(r.processing);
      const misc_purchase = toNum(r.misc_purchase);
      const freight = toNum(r.freight);
      const customs = toNum(r.customs);
      const service_part_comp = toNum(r.service_part_comp);
      const material = consumable + packaging + processing + misc_purchase
                     + freight + customs + service_part_comp;
      const variable_expense = toNum(r.variable_expense);
      const variable_cost = material + variable_expense;
      const fixed_cost = toNum(r.fixed_cost);
      const sale_amt = toNum(r.sale_amt);
      const cm = sale_amt - variable_cost;
      const cm_rate = sale_amt > 0 ? (cm / sale_amt) * 100 : 0;
      const bep = cm_rate > 0 ? fixed_cost / (cm_rate / 100) : 0;
      return {
        YYYY_MM: r.YYYY_MM,
        sale_amt, consumable, packaging, processing, misc_purchase,
        freight, customs, service_part_comp, material,
        variable_expense, variable_cost, fixed_cost,
        contribution_margin: cm, cm_rate, bep, gap: sale_amt - bep
      };
    });

    ok(res, { bu_no, year: targetYear, months });
  } catch (err) { fail500(res, err); }
});

// === BEP 項目 → casher_details amt_type 映射 ===
// 說明：mgm_casher_details 只有以下 amt_type：
//   CR(支出): 原料採購 / 工資 / 房租水電 / 廣告費 / 差旅費 / 設備維修 / 利息支出
//   DR(收入): 銷貨收入 / 應收款收回 / 匯兌收益 / 利息收入
// BEP 的變動成本項目與 casher_details 無法完全一對一對應，
// 這裡是財務語義上最合理的映射。
const BEP_ITEM_MAP = {
  // 變動成本項（CR 支出類）
  consumable:       { amt_types: ['原料採購'],                        label: '消耗品 → 原料採購' },
  packaging:        { amt_types: ['廣告費'],                          label: '包裝費 → 廣告費' },
  processing:       { amt_types: [],                                  label: '加工費（無對應交易類型，固定基準值）' },
  misc_purchase:     { amt_types: ['設備維修'],                        label: '雜項購置 → 設備維修' },
  freight:           { amt_types: [],                                  label: '運費（無對應交易類型，固定基準值）' },
  customs:           { amt_types: [],                                  label: '進出口費用（無對應交易類型，固定基準值）' },
  service_part_comp: { amt_types: [],                                  label: '服務零件與賠償（無對應交易類型，固定基準值）' },
  variable_expense:  { amt_types: ['差旅費'],                          label: '變動費用 → 差旅費' },
  material_sum:      { amt_types: ['原料採購','廣告費','設備維修'],    label: '材料合計 → 原料採購+廣告費+設備維修' },
  variable_cost:     { amt_types: ['原料採購','廣告費','設備維修','差旅費'], label: '變動成本總計 → 全部變動支出' },
  // 固定成本（CR 支出類，固定支出）
  fixed_cost:        { amt_types: ['工資','房租水電','利息支出'],       label: '固定成本 → 工資+房租水電+利息支出' },
  // 收入類
  sale_amt:          { amt_types: ['銷貨收入','應收款收回','匯兌收益','利息收入'], label: '銷售金額 → 全部收入（DR）' }
};

// 交易明細
// GET /api/bep/detail?bu_no=HM&YYYY_MM=2025/02&item_key=consumable
router.get('/detail', async (req, res) => {
  try {
    const { bu_no, YYYY_MM, item_key } = req.query;
    if (!bu_no || !YYYY_MM || !item_key) return fail(res, '需要 bu_no / YYYY_MM / item_key');

    const mapping = BEP_ITEM_MAP[item_key];
    if (!mapping) return fail(res, '未知的 item_key: ' + item_key);

    const amtTypes = mapping.amt_types;

    // 若沒有對應 amt_type，回傳空記錄並提示
    if (amtTypes.length === 0) {
      ok(res, {
        item_key,
        label: mapping.label,
        mapped_amt_types: [],
        no_mapping: true,
        reason: mapping.label,
        records: []
      });
      return;
    }

    // 查 mgm_casher_details
    const placeholders = amtTypes.map(() => '?').join(',');
    const [rows] = await pool.execute(
      `SELECT uid, wk_date, num_vman, amt_type, DB_CR, sub_amt,
              bank_acct, remark
       FROM mgm_casher_details
       WHERE bu_no=? AND YYYY_MM=? AND amt_type IN (${placeholders})
       ORDER BY wk_date, num_vman`,
      [bu_no, YYYY_MM, ...amtTypes]
    );

    // 計算累計餘額（按 DB_CR：DR 加、CR 減）
    let balance = 0;
    const records = rows.map(r => {
      const amt = toNum(r.sub_amt);
      if (r.DB_CR === 'DR') balance += amt;
      else balance -= amt;
      return {
        uid: r.uid,
        wk_date: r.wk_date ? new Date(r.wk_date).toISOString().substring(0, 10) : null,
        num_vman: r.num_vman,
        amt_type: r.amt_type,
        DB_CR: r.DB_CR,
        debit: r.DB_CR === 'DR' ? amt : 0,
        credit: r.DB_CR === 'CR' ? amt : 0,
        bank_acct: r.bank_acct,
        remark: r.remark,
        balance: Number(balance.toFixed(2))
      };
    });

    ok(res, {
      item_key,
      label: mapping.label,
      mapped_amt_types: amtTypes,
      no_mapping: false,
      records,
      summary: {
        count: records.length,
        total_debit: records.reduce((s, r) => s + r.debit, 0),
        total_credit: records.reduce((s, r) => s + r.credit, 0),
        final_balance: Number(balance.toFixed(2))
      }
    });
  } catch (err) { fail500(res, err); }
});

module.exports = router;
