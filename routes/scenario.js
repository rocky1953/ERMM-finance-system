/**
 * 財務情景模擬路由
 * 樂觀/基準/悲觀 三情景參數設定，模擬對關鍵財務指標的衝擊
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');

// 取得基期財務資料
async function getBaseData(bu_no, YYYY_MM) {
    const [rows] = await pool.execute(
        `SELECT sale_amt, sale_cost_amt, sale_exp_amt, MGM_EXP_amt, finance_EXP_amt,
                operation_EXP_amt, net_profit_amt, AR_amt, AP_amt, loan_amt, ttl_asset_amt,
                ttl_debet_amt, stockholder_amt, cash_amt, deposite_amt, employee_cnt, salary_amt
         FROM mgm_finance_summary WHERE bu_no=? AND YYYY_MM=?`,
        [bu_no, YYYY_MM]
    );
    return rows[0] || null;
}

// 單情景計算
function calcScenario(base, params) {
    const {
        revenueGrowth = 0,      // 營收成長率 %
        costGrowth = 0,         // 成本變動率 %
        expenseRate = null,     // 費用率（佔營收比 %），null 表示不變
        arDaysChange = 0,       // 應收天數變動（天）
        inventoryChange = 0,    // 存貨變動率 %
        loanChange = 0          // 借款變動率 %
    } = params;

    const sale = Number(base.sale_amt || 0);
    const cost = Number(base.sale_cost_amt || 0);
    const saleExp = Number(base.sale_exp_amt || 0);
    const mgmtExp = Number(base.MGM_EXP_amt || 0);
    const finExp = Number(base.finance_EXP_amt || 0);
    const opExp = saleExp + mgmtExp + finExp;
    const ar = Number(base.AR_amt || 0);
    const ap = Number(base.AP_amt || 0);
    const loan = Number(base.loan_amt || 0);
    const asset = Number(base.ttl_asset_amt || 0);
    const debt = Number(base.ttl_debet_amt || 0);
    const equity = Number(base.stockholder_amt || 0);
    const cash = Number(base.cash_amt || 0) + Number(base.deposite_amt || 0);

    // 營收 & 成本
    const newSale = sale * (1 + revenueGrowth / 100);
    const newCost = cost * (1 + costGrowth / 100);
    const grossProfit = newSale - newCost;

    // 費用：若指定費用率則用費用率，否則按營收比例
    let newOpExp;
    if (expenseRate !== null) {
        newOpExp = newSale * expenseRate / 100;
    } else {
        const baseExpRate = sale > 0 ? opExp / sale : 0;
        newOpExp = newSale * baseExpRate;
    }

    const opProfit = grossProfit - newOpExp;
    const netProfit = opProfit * 0.8; // 簡化稅後

    // 應收帳款（依天數變動調整）
    const newAR = ar * (1 + arDaysChange / 60);
    // 存貨
    const inventory = asset * 0.2; // 假設存貨佔資產 20%
    const newInventory = inventory * (1 + inventoryChange / 100);
    // 借款
    const newLoan = loan * (1 + loanChange / 100);

    // 現金衝擊：營收變動 - 成本變動 - 費用變動 + 應收變動 + 借款變動
    const cashDelta = (newSale - sale) - (newCost - cost) - (newOpExp - opExp) + (ar - newAR) + (newLoan - loan);
    const newCash = cash + cashDelta;

    // 資產 & 負債
    const newAsset = asset + (newAR - ar) + (newInventory - inventory) + (newCash - cash);
    const newDebt = debt + (newLoan - loan);
    const newEquity = equity + (netProfit - Number(base.net_profit_amt || 0));

    return {
        revenue: Math.round(newSale * 100) / 100,
        cost: Math.round(newCost * 100) / 100,
        gross_profit: Math.round(grossProfit * 100) / 100,
        gross_margin: newSale > 0 ? Math.round(grossProfit / newSale * 10000) / 100 : 0,
        operating_expense: Math.round(newOpExp * 100) / 100,
        operating_profit: Math.round(opProfit * 100) / 100,
        net_profit: Math.round(netProfit * 100) / 100,
        net_margin: newSale > 0 ? Math.round(netProfit / newSale * 10000) / 100 : 0,
        accounts_receivable: Math.round(newAR * 100) / 100,
        cash: Math.round(newCash * 100) / 100,
        total_asset: Math.round(newAsset * 100) / 100,
        total_debt: Math.round(newDebt * 100) / 100,
        debt_ratio: newAsset > 0 ? Math.round(newDebt / newAsset * 10000) / 100 : 0,
        roe: newEquity > 0 ? Math.round(netProfit / newEquity * 10000) / 100 : 0
    };
}

// 執行三情景模擬
router.post('/simulate', async (req, res) => {
    try {
        const { bu_no, YYYY_MM, scenarios } = req.body;
        if (!bu_no || !YYYY_MM) return fail(res, '需要 bu_no 與 YYYY_MM');

        const base = await getBaseData(bu_no, YYYY_MM);
        if (!base) return fail(res, `找不到 ${bu_no} ${YYYY_MM} 的財務資料`);

        // 基準值（原始資料）
        const baseResult = {
            revenue: Number(base.sale_amt),
            cost: Number(base.sale_cost_amt),
            gross_profit: Number(base.sale_amt) - Number(base.sale_cost_amt),
            gross_margin: Number(base.sale_amt) > 0 ? ((Number(base.sale_amt) - Number(base.sale_cost_amt)) / Number(base.sale_amt) * 100) : 0,
            operating_expense: Number(base.sale_exp_amt) + Number(base.MGM_EXP_amt) + Number(base.finance_EXP_amt),
            operating_profit: Number(base.BIZ_margin_amt || 0),
            net_profit: Number(base.net_profit_amt),
            net_margin: Number(base.sale_amt) > 0 ? (Number(base.net_profit_amt) / Number(base.sale_amt) * 100) : 0,
            accounts_receivable: Number(base.AR_amt),
            cash: Number(base.cash_amt) + Number(base.deposite_amt),
            total_asset: Number(base.ttl_asset_amt),
            total_debt: Number(base.ttl_debet_amt),
            debt_ratio: Number(base.ttl_asset_amt) > 0 ? (Number(base.ttl_debet_amt) / Number(base.ttl_asset_amt) * 100) : 0,
            roe: Number(base.stockholder_amt) > 0 ? (Number(base.net_profit_amt) / Number(base.stockholder_amt) * 100) : 0
        };

        // 三情景
        const sc = scenarios || {};
        const optimistic = calcScenario(base, sc.optimistic || { revenueGrowth: 15, costGrowth: 5, expenseRate: 18 });
        const baseCase = calcScenario(base, sc.base || { revenueGrowth: 5, costGrowth: 5, expenseRate: null });
        const pessimistic = calcScenario(base, sc.pessimistic || { revenueGrowth: -10, costGrowth: 8, expenseRate: 25 });

        ok(res, {
            base_period: `${bu_no} ${YYYY_MM}`,
            actual: baseResult,
            scenarios: { optimistic, base: baseCase, pessimistic }
        });
    } catch (err) { fail500(res, err); }
});

// 取得基期指標（供頁面預設顯示）
router.get('/base', async (req, res) => {
    try {
        const { bu_no, YYYY_MM } = req.query;
        if (!bu_no || !YYYY_MM) return fail(res, '需要 bu_no 與 YYYY_MM');
        const base = await getBaseData(bu_no, YYYY_MM);
        if (!base) return fail(res, '找不到財務資料');
        ok(res, {
            sale_amt: Number(base.sale_amt),
            sale_cost_amt: Number(base.sale_cost_amt),
            gross_margin: Number(base.sale_amt) > 0 ? ((Number(base.sale_amt) - Number(base.sale_cost_amt)) / Number(base.sale_amt) * 100) : 0,
            net_profit_amt: Number(base.net_profit_amt),
            net_margin: Number(base.sale_amt) > 0 ? (Number(base.net_profit_amt) / Number(base.sale_amt) * 100) : 0,
            op_expense_rate: Number(base.sale_amt) > 0 ? ((Number(base.sale_exp_amt) + Number(base.MGM_EXP_amt) + Number(base.finance_EXP_amt)) / Number(base.sale_amt) * 100) : 0,
            debt_ratio: Number(base.ttl_asset_amt) > 0 ? (Number(base.ttl_debet_amt) / Number(base.ttl_asset_amt) * 100) : 0,
            roe: Number(base.stockholder_amt) > 0 ? (Number(base.net_profit_amt) / Number(base.stockholder_amt) * 100) : 0
        });
    } catch (err) { fail500(res, err); }
});

module.exports = router;
