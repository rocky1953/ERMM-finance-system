/**
 * 財務 KPI 查詢路由（YG001~YG004）
 *
 * 從 MGM_finance_summary 動態計算財務比率
 * 回傳格式：{ target, lower, upper, current, color, formula }
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');

// ===== 公式庫（使用 MGM_finance_summary 現成欄位）=====
// s = summary row, p = prev month row
// ★ 關鍵：current_debet_amt = 流動負債總額, ttl_debet_amt = 負債總額, stockholder_amt = 股東權益
const FORMULAS = {
    // ---------- 償債能力 (YG001) ----------
    current_ratio:   { name: '流動比率',       cat: '償債能力', f: s => s.current_asset_amt / Math.max(1, s.current_debet_amt || s.AP_amt) },
    quick_ratio:     { name: '速動比率',       cat: '償債能力', f: s => {
                        const inv = (s.stock_P_amt||0)+(s.stock_M_amt||0)+(s.WIP_M_amt||0)+(s.WIP_labor_amt||0)+(s.WIP_EXP_amt||0);
                        return (s.current_asset_amt - inv) / Math.max(1, s.current_debet_amt || s.AP_amt);
                      }},
    debt_ratio:      { name: '負債比率(%)',    cat: '償債能力', f: s => {
                        const debt = s.ttl_debet_amt !== undefined && s.ttl_debet_amt !== null ? s.ttl_debet_amt : (s.loan_amt||0) + (s.AP_amt||0) + (s.LT_loan_amt||0);
                        return debt * 100 / Math.max(1, s.ttl_asset_amt);
                      }},
    interest_cov:    { name: '利息保障倍數',   cat: '償債能力', f: s => {
                        const int = s.interest_amt || 0;
                        if (int <= 0) return null; // 無利息費用 → 無法計算，顯示 N/A
                        return ((s.sale_exp_amt||0) + int) / int;
                      }},
    cash_ratio:      { name: '現金比率(%)',    cat: '償債能力', f: s => {
                        const cl = s.current_debet_amt || s.AP_amt;
                        return (s.cash_amt + s.deposite_amt) * 100 / Math.max(1, cl);
                      }},

    // ---------- 營運能力 ----------
    inventory_turn:  { name: '存貨周轉率',     cat: '營運能力', f: s => {
                        const inv = (s.stock_P_amt||0)+(s.stock_M_amt||0)+(s.WIP_M_amt||0)+(s.WIP_labor_amt||0)+(s.WIP_EXP_amt||0)+(s.stock_transit_amt||0)+(s.stock_value_amt||0);
                        return s.sale_cost_amt / Math.max(1, inv);
                      }},
    ar_turn:         { name: '應收帳款周轉率', cat: '營運能力', f: s => s.sale_amt / Math.max(1, s.AR_amt) },
    ar_days:         { name: '應收帳款周轉天數', cat: '營運能力', f: s => 365 / Math.max(0.01, s.sale_amt / Math.max(1, s.AR_amt)) },
    total_asset_turn:{ name: '總資產周轉率',   cat: '營運能力', f: s => s.sale_amt / Math.max(1, s.ttl_asset_amt) },
    fixed_asset_turn:{ name: '固定資產周轉率', cat: '營運能力', f: s => {
                        const FA = (s.office_amt||0)+(s.building_amt||0)+(s.equipment_amt||0)+(s.vehicle_amt||0)+(s.intangible_amt||0);
                        return s.sale_amt / Math.max(1, FA);
                      }},
    equity_turn:     { name: '股東權益周轉率', cat: '營運能力', f: s => {
                        const eq = (s.stockholder_amt !== undefined && s.stockholder_amt !== null && s.stockholder_amt !== 0)
                                   ? s.stockholder_amt
                                   : (s.captial_stock||0) + (s.captial_reserve||0) + (s.accumulated_amt||0);
                        return s.sale_amt / Math.max(1, eq);
                      }},
    cash_conv_days:  { name: '現金周轉天數',   cat: '營運能力', f: s => {
                        const inv = (s.stock_P_amt||0)+(s.stock_M_amt||0)+(s.WIP_M_amt||0);
                        const itd = 365 / Math.max(0.01, s.sale_cost_amt / Math.max(1, inv));
                        const ard = 365 / Math.max(0.01, s.sale_amt / Math.max(1, s.AR_amt));
                        const apd = 365 / Math.max(0.01, s.sale_cost_amt / Math.max(1, s.AP_amt||1));
                        return itd + ard - apd;
                      }},

    // ---------- 獲利能力 ----------
    gross_profit:    { name: '銷售毛利率(%)',   cat: '獲利能力', f: s => (s.sale_amt - s.sale_cost_amt) * 100 / Math.max(1, s.sale_amt) },
    net_profit_margin:{name: '銷售淨利率(%)',   cat: '獲利能力', f: s => s.sale_exp_amt * 100 / Math.max(1, s.sale_amt) },
    roa:             { name: '資產報酬率ROA(%)', cat: '獲利能力', f: s => s.sale_exp_amt * 100 / Math.max(1, s.ttl_asset_amt) },
    roe:             { name: '權益報酬率ROE(%)', cat: '獲利能力', f: s => {
                        const eq = (s.stockholder_amt !== undefined && s.stockholder_amt !== null && s.stockholder_amt !== 0)
                                   ? s.stockholder_amt
                                   : (s.captial_stock||0) + (s.captial_reserve||0) + (s.accumulated_amt||0);
                        return s.sale_exp_amt * 100 / Math.max(1, eq);
                      }},

    // ---------- 成長能力 (YG001 右) ----------
    sale_growth:     { name: '銷售成長率(%)',   cat: '成長能力', f: (s, p) => p ? ((s.sale_amt - p.sale_amt) / Math.max(1, p.sale_amt)) * 100 : null },
    profit_growth:   { name: '淨利成長率(%)',   cat: '成長能力', f: (s, p) => p ? ((s.sale_exp_amt - p.sale_exp_amt) / Math.max(1, Math.abs(p.sale_exp_amt))) * 100 : null },
    capital_growth:  { name: '資本積累率(%)',   cat: '成長能力', f: (s, p) => p ? ((s.captial_stock - p.captial_stock) / Math.max(1, p.captial_stock)) * 100 : null },

    // ---------- Z / BZ 模型 (YG004) ----------
    altman_z1:       { name: 'Z1 值(上市公司)', cat: 'Z模型分析', f: s => {
                        const ta = s.ttl_asset_amt || 1;
                        const wc = s.current_asset_amt - (s.current_debet_amt || s.AP_amt);
                        const re = s.accumulated_amt || 0;
                        const ebit = (s.sale_exp_amt||0) + (s.interest_amt||0);
                        const eq = s.stockholder_amt || (s.captial_stock||0)+(s.captial_reserve||0)+(s.accumulated_amt||0);
                        const debt = s.ttl_debet_amt || (s.loan_amt||0)+(s.AP_amt||0)+(s.LT_loan_amt||0);
                        return (1.2*wc/ta + 1.4*re/ta + 3.3*ebit/ta + 0.6*eq/Math.max(1,debt) + 0.999*s.sale_amt/ta);
                      }},
    altman_z2:       { name: 'Z2 值(非上市)',   cat: 'Z模型分析', f: s => {
                        const ta = s.ttl_asset_amt || 1;
                        const wc = s.current_asset_amt - (s.current_debet_amt || s.AP_amt);
                        const re = s.accumulated_amt || 0;
                        const ebit = (s.sale_exp_amt||0) + (s.interest_amt||0);
                        const eq = s.stockholder_amt || (s.captial_stock||0)+(s.captial_reserve||0)+(s.accumulated_amt||0);
                        const debt = s.ttl_debet_amt || (s.loan_amt||0)+(s.AP_amt||0)+(s.LT_loan_amt||0);
                        return (6.56*wc/ta + 3.26*re/ta + 6.72*ebit/ta + 1.05*eq/Math.max(1,debt));
                      }},
    bach_bz:         { name: 'BZ 值(巴赫利)',   cat: 'BZ模型分析', f: s => {
                        const ta = s.ttl_asset_amt || 1;
                        const ebit = (s.sale_exp_amt||0) + (s.interest_amt||0);
                        return (ebit/ta) * (ebit/Math.max(1,s.sale_amt)) * 100;
                      }},
    altman_ggr:      { name: 'GGR 值',          cat: 'Z模型分析', f: s => {
                        const ta = s.ttl_asset_amt || 1;
                        const cl = s.current_debet_amt || s.AP_amt || 1;
                        return (3.2*((s.captial_stock||0)+(s.captial_reserve||0))/ta
                              + 1.1*s.current_asset_amt/cl
                              + 1.1*(s.sale_exp_amt||0)/ta);
                      }},

    // ---------- YG004 巴萨利润模型 ----------
    bz_debt_ratio:   { name: '(利潤總額+利息支出)/流動負債', cat: 'BZ巴萨利润', f: s => {
                        const cl = s.current_debet_amt || s.AP_amt || 1;
                        return ((s.sale_exp_amt||0) + (s.interest_amt||0)) * 100 / cl;
                      }},
    bz_receivable_turn:{name: '流動資產/流動負債 (流動比率)', cat: 'BZ巴萨利润', f: s => s.current_asset_amt / Math.max(1, s.current_debet_amt || s.AP_amt) },
    bz_quick:        { name: '(流動資產-存貨)/流動負債 (速動比率)', cat: 'BZ巴萨利润', f: s => {
                        const inv = (s.stock_P_amt||0)+(s.stock_M_amt||0)+(s.WIP_M_amt||0)+(s.WIP_labor_amt||0)+(s.WIP_EXP_amt||0);
                        return (s.current_asset_amt - inv) / Math.max(1, s.current_debet_amt || s.AP_amt);
                      }},

    // ---------- 營運資產模型 (YG004) ----------
    // 營運資產 = 營運資本 + 長期投資 = (流動資產 - 流動負債) + 長期投資
    oa_working_asset:{ name: '營運資產額',        cat: '營運資產模型', f: s =>
                        (s.current_asset_amt - Math.max(0, s.current_debet_amt||s.AP_amt)) + (s.LQ_asset_amt||0) },
    oa_cover_cl:     { name: '營運資產/流動負債', cat: '營運資產模型', f: s => {
                        const oa = (s.current_asset_amt - Math.max(0, s.current_debet_amt||s.AP_amt)) + (s.LQ_asset_amt||0);
                        return oa / Math.max(1, s.current_debet_amt||s.AP_amt);
                      }},
    oa_wc_ratio:     { name: '營運資本比率(營運資本/流動資產)', cat: '營運資產模型', f: s =>
                        (s.current_asset_amt - Math.max(0, s.current_debet_amt||s.AP_amt)) / Math.max(1, s.current_asset_amt) },
    oa_equity_debt:  { name: '淨值/負債總額',      cat: '營運資產模型', f: s => {
                        const eq = s.stockholder_amt || s.captial_stock + s.captial_reserve + s.accumulated_amt;
                        const debt = s.ttl_debet_amt || (s.loan_amt + s.AP_amt + (s.LT_loan_amt||0));
                        return eq / Math.max(1, debt);
                      }},

    // ---------- 沃爾比重模型 (Alexander Wall, YG004) ----------
    // 綜合評分 = Σ(實際比率/標準比率 × 權重)，滿分 100
    wall_score:      { name: '沃爾綜合評分(滿分100)', cat: '沃爾比重模型', f: s => {
                        const FA = s.office_amt + s.building_amt + s.equipment_amt + s.vehicle_amt;
                        const INV = s.stock_P_amt + s.stock_M_amt + s.WIP_M_amt;
                        const eq = s.stockholder_amt || s.captial_stock + s.captial_reserve + s.accumulated_amt;
                        const cl = s.current_debet_amt || s.AP_amt;
                        const debt = s.ttl_debet_amt || (s.loan_amt + s.AP_amt + (s.LT_loan_amt||0));
                        const items = [
                          { r: s.current_asset_amt/Math.max(1,cl),  std: 2.0, w: 25 }, // 流動比率
                          { r: eq/Math.max(1,debt),                 std: 1.5, w: 25 }, // 淨值/負債
                          { r: s.ttl_asset_amt/Math.max(1,FA),      std: 2.5, w: 15 }, // 資產/固定資產
                          { r: s.sale_cost_amt/Math.max(1,INV),     std: 8.0, w: 10 }, // 銷貨成本/存貨
                          { r: s.sale_amt/Math.max(1,s.AR_amt),     std: 6.0, w: 10 }, // 銷貨額/應收
                          { r: s.sale_amt/Math.max(1,FA),           std: 3.0, w: 10 }, // 銷貨額/固定資產
                          { r: s.sale_amt/Math.max(1,eq),           std: 3.0, w: 5  }, // 銷貨額/淨值
                        ];
                        return items.reduce((acc, it) => acc + Math.min(it.r, it.std*1.5)/it.std * it.w, 0);
                      }},
    wall_de:         { name: '沃爾組件-淨值/負債(標準1.50)', cat: '沃爾比重模型', f: s => {
                        const eq = s.stockholder_amt || s.captial_stock + s.captial_reserve + s.accumulated_amt;
                        const debt = s.ttl_debet_amt || (s.loan_amt + s.AP_amt + (s.LT_loan_amt||0));
                        return eq / Math.max(1, debt);
                      }},
    wall_af:         { name: '沃爾組件-總資產/固定資產(標準2.50)', cat: '沃爾比重模型', f: s => {
                        const FA = s.office_amt + s.building_amt + s.equipment_amt + s.vehicle_amt;
                        return s.ttl_asset_amt / Math.max(1, FA);
                      }},
    wall_se:         { name: '沃爾組件-銷售額/淨值(標準3.00)', cat: '沃爾比重模型', f: s => {
                        const eq = s.stockholder_amt || s.captial_stock + s.captial_reserve + s.accumulated_amt;
                        return s.sale_amt / Math.max(1, eq);
                      }},

    // ---------- A值模型 (Argenti A-score, YG004) ----------
    // 管理缺陷(0~43) + 會計錯誤(0~15) + 破產徵兆(0~42)；>25 高風險，18~25 警戒
    a_deficiency:    { name: 'A值-管理缺陷代理分(0~43)', cat: 'A值模型', f: (s, p) => {
                        const eq = s.stockholder_amt || s.captial_stock + s.captial_reserve + s.accumulated_amt;
                        const cl = s.current_debet_amt || s.AP_amt;
                        const debt = s.ttl_debet_amt || (s.loan_amt + s.AP_amt + (s.LT_loan_amt||0));
                        let score = 0;
                        if (eq/Math.max(1,debt) < 0.3) score += 10;                        // 槓桿過高
                        if (s.current_asset_amt/Math.max(1,cl) < 1.2) score += 8;          // 流動比率低
                        if ((s.interest_amt||0) > 0 && (s.sale_exp_amt + s.interest_amt)/Math.max(0.01,s.interest_amt) < 3) score += 9; // 利息保障不足
                        if (s.sale_exp_amt*100/Math.max(1,eq) < 5) score += 8;             // ROE<5%
                        if (p && p.sale_amt > 0 && (s.sale_amt - p.sale_amt)/p.sale_amt < -0.05) score += 8; // 銷售下滑>5%
                        return score;
                      }},
    a_accounting:    { name: 'A值-會計錯誤代理分(0~15)', cat: 'A值模型', f: s => {
                        const cl = s.current_debet_amt || s.AP_amt;
                        const INV = s.stock_P_amt + s.stock_M_amt + s.WIP_M_amt;
                        let score = 0;
                        if ((s.cash_amt + s.deposite_amt)/Math.max(1,cl)*100 < 5) score += 8;   // 現金比率<5%
                        if (365/Math.max(0.01, s.sale_amt/Math.max(1,s.AR_amt)) > 90) score += 7; // 應收天數>90
                        return score;
                      }},
    a_symptom:       { name: 'A值-破產徵兆代理分(0~42)', cat: 'A值模型', f: s => {
                        const cl = s.current_debet_amt || s.AP_amt;
                        let score = 0;
                        if ((s.operation_profit_amt || s.sale_exp_amt) < 0) score += 15;   // 營業虧損
                        if (s.current_asset_amt < cl) score += 12;                          // 營運資金為負
                        if ((s.Z2_score || 0) > 0 && s.Z2_score < 1.1) score += 15;        // Z2 落入破產區
                        return score;
                      }},
    a_total:         { name: 'A值-總分(>25高風險)', cat: 'A值模型', f: (s, p) => {
                        const eq = s.stockholder_amt || s.captial_stock + s.captial_reserve + s.accumulated_amt;
                        const cl = s.current_debet_amt || s.AP_amt;
                        const debt = s.ttl_debet_amt || (s.loan_amt + s.AP_amt + (s.LT_loan_amt||0));
                        let d = 0, a = 0, y = 0;
                        if (eq/Math.max(1,debt) < 0.3) d += 10;
                        if (s.current_asset_amt/Math.max(1,cl) < 1.2) d += 8;
                        if ((s.interest_amt||0) > 0 && (s.sale_exp_amt + s.interest_amt)/Math.max(0.01,s.interest_amt) < 3) d += 9;
                        if (s.sale_exp_amt*100/Math.max(1,eq) < 5) d += 8;
                        if (p && p.sale_amt > 0 && (s.sale_amt - p.sale_amt)/p.sale_amt < -0.05) d += 8;
                        const INV = s.stock_P_amt + s.stock_M_amt + s.WIP_M_amt;
                        if ((s.cash_amt + s.deposite_amt)/Math.max(1,cl)*100 < 5) a += 8;
                        if (365/Math.max(0.01, s.sale_amt/Math.max(1,s.AR_amt)) > 90) a += 7;
                        if ((s.operation_profit_amt || s.sale_exp_amt) < 0) y += 15;
                        if (s.current_asset_amt < cl) y += 12;
                        if ((s.Z2_score || 0) > 0 && s.Z2_score < 1.1) y += 15;
                        return d + a + y;
                      }},
};

/**
 * 點燈邏輯 — 依 DB 判定方向 pct_type
 *
 * asc  = 值高=差 (越大越壞)
 *   GREEN  val <= low           低於警戒線，安全
 *   YELLOW low < val <= high    進入警戒區，注意
 *   RED    val > high           嚴重超標
 *
 * desc = 值低=差 (越小越壞)
 *   GREEN  val >= high          高於理想線，安全
 *   YELLOW low <= val < high    接近警戒線
 *   RED    val < low            低於警戒線，嚴重
 *
 * 無門檻時 (low=0 && high=0) → 不點燈 (null)
 */
function lightColor(val, low, high, pct_type) {
    if (val === null || val === undefined || isNaN(val)) return null;
    if ((!low && !high) || low === high) return null;
    const asc = pct_type !== 'desc'; // asc 或 undefined 都當 asc

    if (asc) {
        // 值高=差 → 值越低越綠
        if (val <= low)               return 'GREEN';
        if (val > high)               return 'RED';
        return 'YELLOW';
    } else {
        // 值低=差 → 值越高越綠
        if (val >= high)              return 'GREEN';
        if (val < low)                return 'RED';
        return 'YELLOW';
    }
}

// ===== 動態計算 KPI query =====
router.get('/query', async (req, res) => {
    try {
        const { bu_no, YYYY_MM, page } = req.query;
        if (!bu_no || !YYYY_MM) return fail(res, '缺少 bu_no 或 YYYY_MM');

        // 取當月 summary
        const [cur] = await pool.execute(
            'SELECT * FROM MGM_finance_summary WHERE bu_no=? AND YYYY_MM=?', [bu_no, YYYY_MM]
        );
        if (cur.length === 0) return fail(res, '該月無財務摘要資料', 404);

        // 取上月（成長率用）
        const [prev] = await pool.execute(
            `SELECT * FROM MGM_finance_summary WHERE bu_no=? AND YYYY_MM = DATE_FORMAT(DATE_SUB(STR_TO_DATE(?, '%Y/%m'), INTERVAL 1 MONTH), '%Y/%m')`,
            [bu_no, YYYY_MM]
        );

        // 取 KPI 門檻
        const [kpis] = await pool.execute('SELECT * FROM MGM_KPI_desc WHERE bu_no=?', [bu_no]);
        const kpiMap = {};
        kpis.forEach(k => kpiMap[k.KPI_id] = k);

        // mysql2 回 DECIMAL 是 String，全部轉 Number（數字欄位）
        const toNum = o => { const out = {}; for (const [k, v] of Object.entries(o)) out[k] = typeof v === 'string' && /^\d/.test(v) ? Number(v) : v; return out; };
        const s = toNum(cur[0]);
        const p = prev.length ? toNum(prev[0]) : null;
        const results = {};

        for (const [id, def] of Object.entries(FORMULAS)) {
            let val = null;
            try {
                val = def.f(s, p);
                if (val !== null && val !== undefined && !isNaN(val) && isFinite(val)) {
                    val = Math.round(val * 10000) / 10000;
                } else {
                    val = null;
                }
            } catch (e) { val = null; }
            results[id] = {
                id, name: def.name, category: def.cat,
                current_value: val,
                KPI1: 0, KPI2: 0, unit: '', color: null
            };
        }

        // 合併 MGM_KPI_desc 的門檻（DB id 已改成公式同名，直接 merge）
        for (const [id, kpi] of Object.entries(kpiMap)) {
            if (results[id]) {
                results[id].uid  = kpi.uid;   // 給前端點目標值時知道調哪筆
                results[id].KPI1 = Number(kpi.KPI1 || 0);
                results[id].KPI2 = Number(kpi.KPI2 || 0);
                results[id].unit = kpi.unit || results[id].unit;
                results[id].pct_type = kpi.pct_type || results[id].pct_type;
                // color 每次重算（依 current_value + pct_type），不用 DB 存的 static 值
                results[id].color = lightColor(
                    results[id].current_value,
                    results[id].KPI1, results[id].KPI2,
                    results[id].pct_type
                );
                if (kpi.KPI_name) results[id].name = kpi.KPI_name;
            } else {
                // 純手工 KPI（DB 有但公式庫沒有）
                results[id] = {
                    id, name: kpi.KPI_name || id,
                    category: '手工', current_value: Number(kpi.KPI_value || 0),
                    KPI1: Number(kpi.KPI1 || 0), KPI2: Number(kpi.KPI2 || 0),
                    unit: kpi.unit || '', color: kpi.KPI_color,
                    pct_type: kpi.pct_type
                };
            }
        }

        ok(res, results);
    } catch (err) { fail500(res, err); }
});

// ===== 快速查詢：指定 KPI id 列表 =====
router.post('/calc', async (req, res) => {
    try {
        const { bu_no, YYYY_MM, ids } = req.body;
        if (!bu_no || !YYYY_MM) return fail(res, '缺少 bu_no 或 YYYY_MM');

        const [cur] = await pool.execute(
            'SELECT * FROM MGM_finance_summary WHERE bu_no=? AND YYYY_MM=?', [bu_no, YYYY_MM]
        );
        if (cur.length === 0) return fail(res, '該月無資料', 404);

        const s = cur[0];
        const out = {};
        const idList = (ids && ids.length > 0) ? ids : Object.keys(FORMULAS);

        for (const id of idList) {
            if (FORMULAS[id]) {
                out[id] = { id, value: Math.round(FORMULAS[id].f(s) * 10000) / 10000 };
            } else {
                out[id] = { id, value: null, note: '公式未定義' };
            }
        }
        ok(res, out);
    } catch (err) { fail500(res, err); }
});

module.exports = router;
