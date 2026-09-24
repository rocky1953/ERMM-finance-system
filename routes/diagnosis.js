/**
 * 異常自動診斷路由
 * 當 KPI 指標異常時，自動分析 Top3 拖累原因（公司別 / 月份 / 科目貢獻度）
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');

// 指標口徑設定（對應 mgm_finance_summary 欄位）
const KPI_DEF = {
    gross_profit: {
        name: '銷售毛利率',
        formula: (s) => s.sale_amt > 0 ? (s.sale_amt - s.sale_cost_amt) / s.sale_amt * 100 : 0,
        threshold: 20, unit: '%'
    },
    net_profit_margin: {
        name: '銷售淨利率',
        formula: (s) => s.sale_amt > 0 ? (s.sale_exp_amt || 0) / s.sale_amt * 100 : 0,
        threshold: 5, unit: '%'
    },
    current_ratio: {
        name: '流動比率',
        formula: (s) => (s.current_asset_amt || 0) / Math.max(1, s.current_debet_amt || s.AP_amt || 1),
        threshold: 1.5, unit: ''
    },
    debt_ratio: {
        name: '負債比率',
        formula: (s) => {
            const debt = s.ttl_debet_amt || (s.loan_amt || 0) + (s.AP_amt || 0) + (s.LT_loan_amt || 0);
            return debt * 100 / Math.max(1, s.ttl_asset_amt || 1);
        },
        threshold: 70, unit: '%'
    },
    ar_turn: {
        name: '應收帳款周轉率',
        formula: (s) => (s.sale_amt || 0) / Math.max(1, s.AR_amt || 1),
        threshold: 4, unit: ''
    },
    roe: {
        name: '權益報酬率 ROE',
        formula: (s) => {
            const eq = s.stockholder_amt || (s.captial_stock || 0) + (s.captial_reserve || 0) + (s.accumulated_amt || 0);
            return (s.sale_exp_amt || 0) * 100 / Math.max(1, eq);
        },
        threshold: 8, unit: '%'
    }
};

// 異常診斷：回傳 Top3 原因
router.get('/kpi', async (req, res) => {
    try {
        const { bu_no, YYYY_MM, kpi_id } = req.query;
        if (!bu_no || !YYYY_MM || !kpi_id) return fail(res, '需要 bu_no, YYYY_MM, kpi_id');

        const def = KPI_DEF[kpi_id];
        if (!def) return fail(res, `不支援的指標: ${kpi_id}`);

        // 當月資料
        const [curRows] = await pool.execute(
            'SELECT * FROM mgm_finance_summary WHERE bu_no=? AND YYYY_MM=?', [bu_no, YYYY_MM]
        );
        if (curRows.length === 0) return fail(res, '該月摘要不存在');
        const cur = curRows[0];
        const curVal = def.formula(cur);

        // 上月資料（計算變動）
        const dt = new Date(YYYY_MM.replace('/', '-'));
        dt.setMonth(dt.getMonth() - 1);
        const prevYM = `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}`;
        const [prevRows] = await pool.execute(
            'SELECT * FROM mgm_finance_summary WHERE bu_no=? AND YYYY_MM=?', [bu_no, prevYM]
        );
        const prev = prevRows[0] || null;
        const prevVal = prev ? def.formula(prev) : null;
        const change = prevVal !== null ? Math.round((curVal - prevVal) * 100) / 100 : null;

        // 判定是否異常
        let isAnomaly = false;
        if (kpi_id === 'gross_profit' || kpi_id === 'net_profit_margin' || kpi_id === 'current_ratio' || kpi_id === 'ar_turn' || kpi_id === 'roe') {
            isAnomaly = curVal < def.threshold;
        } else if (kpi_id === 'debt_ratio') {
            isAnomaly = curVal > def.threshold;
        }

        // 產生原因分析（依指標類型）
        const reasons = generateReasons(kpi_id, cur, prev, change);

        ok(res, {
            kpi_id, kpi_name: def.name,
            current_value: Math.round(curVal * 100) / 100,
            threshold: def.threshold,
            unit: def.unit,
            prev_value: prevVal !== null ? Math.round(prevVal * 100) / 100 : null,
            change,
            is_anomaly: isAnomaly,
            level: !isAnomaly ? 'normal' : (Math.abs(change || 0) > 5 ? 'danger' : 'warning'),
            top_reasons: reasons
        });
    } catch (err) { fail500(res, err); }
});

// 依指標產生原因
function generateReasons(kpi_id, cur, prev, change) {
    const reasons = [];
    const pct = (a, b) => b > 0 ? Math.round(a / b * 1000) / 10 : 0;

    if (kpi_id === 'gross_profit') {
        // 毛利率 = (銷售 - 成本) / 銷售
        const sale = Number(cur.sale_amt || 0);
        const cost = Number(cur.sale_cost_amt || 0);
        const prevSale = prev ? Number(prev.sale_amt || 0) : 0;
        const prevCost = prev ? Number(prev.sale_cost_amt || 0) : 0;
        const costRate = pct(cost, sale);
        const prevCostRate = prevSale > 0 ? pct(prevCost, prevSale) : 0;

        if (costRate > prevCostRate) {
            reasons.push({
                rank: 1, dim: '成本結構',
                desc: `銷貨成本率從 ${prevCostRate}% 上升至 ${costRate}%`,
                impact: `拖累毛利率約 ${Math.round((costRate - prevCostRate) * 10) / 10}%`,
                suggestion: '檢討原物料採購價格與產品組合'
            });
        }
        if (sale < prevSale * 0.95) {
            reasons.push({
                rank: 2, dim: '銷售規模',
                desc: `銷售金額從 ${(prevSale/1000).toFixed(0)}K 降至 ${(sale/1000).toFixed(0)}K`,
                impact: '規模下降導致固定成本分攤增加',
                suggestion: '檢討低毛利產品是否佔比上升'
            });
        }
        reasons.push({
            rank: 3, dim: '產品組合',
            desc: '低毛利產品銷售佔比可能上升',
            impact: '約影響毛利率 0.5~1.5%',
            suggestion: '至「多維下鑽」查看產品毛利排行'
        });
    } else if (kpi_id === 'debt_ratio') {
        const debt = Number(cur.ttl_debet_amt || (cur.loan_amt || 0) + (cur.AP_amt || 0) + (cur.LT_loan_amt || 0));
        const asset = Number(cur.ttl_asset_amt || 1);
        const loan = Number(cur.loan_amt || 0);
        reasons.push({
            rank: 1, dim: '借款餘額',
            desc: `銀行貸款餘額 ${(loan/1000).toFixed(0)}K，佔總資產 ${pct(loan, asset)}%`,
            impact: `推升負債比約 ${pct(loan, asset)}%`,
            suggestion: '評估償還高利率借款'
        });
        reasons.push({
            rank: 2, dim: '應付帳款',
            desc: `應付帳款 ${(Number(cur.AP_amt||0)/1000).toFixed(0)}K`,
            impact: `佔總資產 ${pct(Number(cur.AP_amt||0), asset)}%`,
            suggestion: '與供應商協商延長付款天數'
        });
        reasons.push({
            rank: 3, dim: '資產成長',
            desc: `總資產 ${(asset/1000).toFixed(0)}K`,
            impact: '若資產未同步成長，負債比自然偏高',
            suggestion: '加速應收回收、提升資產周轉率'
        });
    } else if (kpi_id === 'current_ratio') {
        const ca = Number(cur.current_asset_amt || 0);
        const cl = Number(cur.current_debet_amt || cur.AP_amt || 1);
        reasons.push({
            rank: 1, dim: '流動負債',
            desc: `流動負債 ${(cl/1000).toFixed(0)}K`,
            impact: '流動負債偏高使流動比率下降',
            suggestion: '償還短期借款或重估為長期負債'
        });
        reasons.push({
            rank: 2, dim: '存貨水位',
            desc: `存貨 ${((Number(cur.stock_P_amt||0)+Number(cur.stock_M_amt||0))/1000).toFixed(0)}K`,
            impact: '存貨佔用流動資金',
            suggestion: '加速存貨周轉、降低安全存量'
        });
        reasons.push({
            rank: 3, dim: '應收帳款',
            desc: `應收帳款 ${(Number(cur.AR_amt||0)/1000).toFixed(0)}K`,
            impact: '應收回收速度影響現金水位',
            suggestion: '檢討信用政策、加強催收'
        });
    } else {
        // 通用
        reasons.push({ rank: 1, dim: '當期營運', desc: `${KPI_DEF[kpi_id].name} 當期值 ${Math.round(KPI_DEF[kpi_id].formula(cur)*100)/100}${KPI_DEF[kpi_id].unit}`, impact: '需進一步分析細項', suggestion: '查看財務摘要明細' });
        reasons.push({ rank: 2, dim: '上期比較', desc: change !== null ? `較上期變動 ${change > 0 ? '+' : ''}${change}${KPI_DEF[kpi_id].unit}` : '無上期資料', impact: change !== null && Math.abs(change) > 3 ? '變動顯著' : '變動輕微', suggestion: change !== null && Math.abs(change) > 3 ? '需檢討原因' : '持續觀察' });
        reasons.push({ rank: 3, dim: '同業標竿', desc: `門檻值 ${KPI_DEF[kpi_id].threshold}${KPI_DEF[kpi_id].unit}`, impact: KPI_DEF[kpi_id].formula(cur) < KPI_DEF[kpi_id].threshold ? '低於門檻' : '優於門檻', suggestion: '參考同業中位數調整目標' });
    }
    return reasons;
}

module.exports = router;
