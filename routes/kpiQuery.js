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
const FORMULAS = {
    // ---------- 償債能力 (YG001) ----------
    current_ratio:   { name: '流動比率',       cat: '償債能力', f: s => s.current_asset_amt / Math.max(1, s.AP_amt + s.AP_tax_amt + s.AP_salary_amt) },
    quick_ratio:     { name: '速動比率',       cat: '償債能力', f: s => (s.current_asset_amt - s.stock_P_amt - s.stock_M_amt - s.WIP_M_amt - s.WIP_labor_amt - s.WIP_EXP_amt) / Math.max(1, s.AP_amt) },
    debt_ratio:      { name: '負債比率(%)',    cat: '償債能力', f: s => (s.loan_amt + s.AP_amt + s.AP_tax_amt + s.AP_salary_amt + s.AP_other_amt) * 100 / Math.max(1, s.ttl_asset_amt) },
    interest_cov:    { name: '利息保障倍數',   cat: '償債能力', f: s => (s.sale_exp_amt + s.interest_amt) / Math.max(0.01, s.interest_amt) },
    cash_ratio:      { name: '現金比率(%)',    cat: '償債能力', f: s => (s.cash_amt + s.deposite_amt) * 100 / Math.max(1, s.AP_amt) },

    // ---------- 營運能力 ----------
    inventory_turn:  { name: '存貨周轉率',     cat: '營運能力', f: s => s.sale_cost_amt / Math.max(1, s.stock_P_amt + s.stock_M_amt + s.WIP_M_amt + s.WIP_labor_amt + s.WIP_EXP_amt + s.stock_transit_amt + s.stock_value_amt) },
    ar_turn:         { name: '應收帳款周轉率', cat: '營運能力', f: s => s.sale_amt / Math.max(1, s.AR_amt) },
    ar_days:         { name: '應收帳款周轉天數', cat: '營運能力', f: s => 365 / Math.max(0.01, s.sale_amt / Math.max(1, s.AR_amt)) },
    total_asset_turn:{ name: '總資產周轉率',   cat: '營運能力', f: s => s.sale_amt / Math.max(1, s.ttl_asset_amt) },
    fixed_asset_turn:{ name: '固定資產周轉率', cat: '營運能力', f: s => s.sale_amt / Math.max(1, s.office_amt + s.building_amt + s.equipment_amt + s.vehicle_amt + s.intangible_amt) },
    equity_turn:     { name: '股東權益周轉率', cat: '營運能力', f: s => s.sale_amt / Math.max(1, s.equity_amt || s.captial_stock + s.captial_reserve + s.accumulated_amt) },
    cash_conv_days:  { name: '現金周轉天數',   cat: '營運能力', f: s => {
                        const itd = 365 / Math.max(0.01, s.sale_cost_amt / Math.max(1, s.stock_P_amt + s.stock_M_amt + s.WIP_M_amt));
                        const ard = 365 / Math.max(0.01, s.sale_amt / Math.max(1, s.AR_amt));
                        const apd = 365 / Math.max(0.01, s.sale_cost_amt / Math.max(1, s.AP_amt));
                        return itd + ard - apd;
                      }},

    // ---------- 獲利能力 ----------
    gross_profit:    { name: '銷售毛利率(%)',   cat: '獲利能力', f: s => (s.sale_amt - s.sale_cost_amt) * 100 / Math.max(1, s.sale_amt) },
    net_profit_margin:{name: '銷售淨利率(%)',   cat: '獲利能力', f: s => s.sale_exp_amt * 100 / Math.max(1, s.sale_amt) },
    roa:             { name: '資產報酬率ROA(%)', cat: '獲利能力', f: s => s.sale_exp_amt * 100 / Math.max(1, s.ttl_asset_amt) },
    roe:             { name: '權益報酬率ROE(%)', cat: '獲利能力', f: s => s.sale_exp_amt * 100 / Math.max(1, s.equity_amt || s.captial_stock + s.captial_reserve + s.accumulated_amt) },

    // ---------- 成長能力 (YG001 右) ----------
    sale_growth:     { name: '銷售成長率(%)',   cat: '成長能力', f: (s, p) => p ? ((s.sale_amt - p.sale_amt) / Math.max(1, p.sale_amt)) * 100 : 0 },
    profit_growth:   { name: '淨利成長率(%)',   cat: '成長能力', f: (s, p) => p ? ((s.sale_exp_amt - p.sale_exp_amt) / Math.max(1, Math.abs(p.sale_exp_amt))) * 100 : 0 },
    capital_growth:  { name: '資本積累率(%)',   cat: '成長能力', f: (s, p) => p ? ((s.captial_stock - p.captial_stock) / Math.max(1, p.captial_stock)) * 100 : 0 },

    // ---------- Z / BZ 模型 (YG004) ----------
    altman_z1:       { name: 'Z1 值(上市公司)', cat: 'Z模型分析', f: s => {
                        const ta = s.ttl_asset_amt || 1;
                        const wc = s.current_asset_amt - s.AP_amt;
                        const re = s.accumulated_amt;
                        const ebit = s.sale_exp_amt + s.interest_amt;
                        return (1.2*wc/ta + 1.4*re/ta + 3.3*ebit/ta + 0.6*(s.equity_amt||s.captial_stock+s.captial_reserve+s.accumulated_amt)/Math.max(1,s.loan_amt) + 0.999*s.sale_amt/ta);
                      }},
    altman_z2:       { name: 'Z2 值(非上市)',   cat: 'Z模型分析', f: s => {
                        const ta = s.ttl_asset_amt || 1;
                        const wc = s.current_asset_amt - s.AP_amt;
                        const re = s.accumulated_amt;
                        const ebit = s.sale_exp_amt + s.interest_amt;
                        return (6.56*wc/ta + 3.26*re/ta + 6.72*ebit/ta + 1.05*(s.equity_amt||s.captial_stock+s.captial_reserve+s.accumulated_amt)/Math.max(1,s.loan_amt));
                      }},
    bach_bz:         { name: 'BZ 值(巴赫利)',   cat: 'BZ模型分析', f: s => {
                        const ta = s.ttl_asset_amt || 1;
                        return ((s.sale_exp_amt+s.interest_amt)/ta) * ((s.sale_exp_amt+s.interest_amt)/Math.max(1,s.sale_amt)) * 100;
                      }},
    altman_ggr:      { name: 'GGR 值',          cat: 'Z模型分析', f: s => {
                        const ta = s.ttl_asset_amt || 1;
                        return (3.2*(s.captial_stock+s.captial_reserve)/ta + 1.1*s.current_asset_amt/Math.max(1,s.AP_amt) + 1.1*(s.sale_exp_amt||0)/ta);
                      }},

    // ---------- YG004 巴萨利润模型 ----------
    bz_debt_ratio:   { name: '(利潤總額+折舊+攤銷+利息支出)/流動負債', cat: 'BZ巴萨利润', f: s => (s.sale_exp_amt + (s.interest_amt||0)) * 100 / Math.max(1, s.AP_amt) },
    bz_receivable_turn:{name: '流動資產/流動負債 (流動比率)', cat: 'BZ巴萨利润', f: s => s.current_asset_amt / Math.max(1, s.AP_amt) },
    bz_quick:        { name: '(流動資產-存貨)/流動負債 (速動比率)', cat: 'BZ巴萨利润', f: s => (s.current_asset_amt - s.stock_P_amt - s.stock_M_amt - s.WIP_M_amt - s.WIP_labor_amt - s.WIP_EXP_amt) / Math.max(1, s.AP_amt) },
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
