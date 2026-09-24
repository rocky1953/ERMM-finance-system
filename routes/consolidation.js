/**
 * 合併報表路由
 * 多公司合併資產負債表 / 損益表 / 內部交易沖銷
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');

// 合併損益表
router.get('/income', async (req, res) => {
    try {
        const { YYYY_MM } = req.query;
        if (!YYYY_MM) return fail(res, '需要 YYYY_MM');
        // 從各公司 finance_summary 彙總，扣除內部交易（AR_affiliate_amt 視為內部銷售）
        const [rows] = await pool.execute(`
            SELECT
                bu_no,
                sale_amt, sale_cost_amt, net_sale_amt,
                sale_exp_amt, MGM_EXP_amt, finance_EXP_amt, operation_EXP_amt,
                BIZ_major_margin_amt, BIZ_margin_amt, operation_profit_amt,
                pretax_profit_amt, net_profit_amt, AR_affiliate_amt
            FROM mgm_finance_summary
            WHERE YYYY_MM=?
            ORDER BY bu_no
        `, [YYYY_MM]);

        if (rows.length === 0) return ok(res, { companies: [], consolidated: null });

        // 合併：加總各公司，內部銷售沖銷
        const consolidated = rows.reduce((acc, r) => {
            acc.sale_amt += Number(r.sale_amt || 0);
            acc.sale_cost_amt += Number(r.sale_cost_amt || 0);
            acc.net_sale_amt += Number(r.net_sale_amt || 0);
            acc.sale_exp_amt += Number(r.sale_exp_amt || 0);
            acc.MGM_EXP_amt += Number(r.MGM_EXP_amt || 0);
            acc.finance_EXP_amt += Number(r.finance_EXP_amt || 0);
            acc.operation_EXP_amt += Number(r.operation_EXP_amt || 0);
            acc.BIZ_major_margin_amt += Number(r.BIZ_major_margin_amt || 0);
            acc.BIZ_margin_amt += Number(r.BIZ_margin_amt || 0);
            acc.operation_profit_amt += Number(r.operation_profit_amt || 0);
            acc.pretax_profit_amt += Number(r.pretax_profit_amt || 0);
            acc.net_profit_amt += Number(r.net_profit_amt || 0);
            acc.internal_sale += Number(r.AR_affiliate_amt || 0);
            return acc;
        }, {
            sale_amt: 0, sale_cost_amt: 0, net_sale_amt: 0,
            sale_exp_amt: 0, MGM_EXP_amt: 0, finance_EXP_amt: 0, operation_EXP_amt: 0,
            BIZ_major_margin_amt: 0, BIZ_margin_amt: 0, operation_profit_amt: 0,
            pretax_profit_amt: 0, net_profit_amt: 0, internal_sale: 0
        });

        // 內部銷售沖銷後的合併收入
        consolidated.consolidated_sale = consolidated.sale_amt - consolidated.internal_sale;
        consolidated.gross_profit = consolidated.sale_amt - consolidated.sale_cost_amt;
        consolidated.gross_margin = consolidated.sale_amt > 0 ? (consolidated.gross_profit / consolidated.sale_amt * 100) : 0;
        consolidated.net_margin = consolidated.sale_amt > 0 ? (consolidated.net_profit_amt / consolidated.sale_amt * 100) : 0;

        ok(res, { companies: rows, consolidated });
    } catch (err) { fail500(res, err); }
});

// 合併資產負債表
router.get('/balance-sheet', async (req, res) => {
    try {
        const { YYYY_MM } = req.query;
        if (!YYYY_MM) return fail(res, '需要 YYYY_MM');
        const [rows] = await pool.execute(`
            SELECT
                bu_no,
                cash_amt, deposite_amt, AR_amt, AR_affiliate_amt,
                stock_P_amt, stock_M_amt, stock_S_amt,
                current_asset_amt, ttl_asset_amt,
                AP_amt, loan_amt, LT_loan_amt, current_debet_amt, ttl_debet_amt,
                captial_stock, stockholder_amt
            FROM mgm_finance_summary
            WHERE YYYY_MM=?
            ORDER BY bu_no
        `, [YYYY_MM]);

        if (rows.length === 0) return ok(res, { companies: [], consolidated: null });

        const consolidated = rows.reduce((acc, r) => {
            acc.cash_amt += Number(r.cash_amt || 0);
            acc.deposite_amt += Number(r.deposite_amt || 0);
            acc.AR_amt += Number(r.AR_amt || 0);
            acc.internal_AR += Number(r.AR_affiliate_amt || 0);
            acc.inventory += Number(r.stock_P_amt || 0) + Number(r.stock_M_amt || 0) + Number(r.stock_S_amt || 0);
            acc.current_asset_amt += Number(r.current_asset_amt || 0);
            acc.ttl_asset_amt += Number(r.ttl_asset_amt || 0);
            acc.AP_amt += Number(r.AP_amt || 0);
            acc.loan_amt += Number(r.loan_amt || 0);
            acc.LT_loan_amt += Number(r.LT_loan_amt || 0);
            acc.current_debet_amt += Number(r.current_debet_amt || 0);
            acc.ttl_debet_amt += Number(r.ttl_debet_amt || 0);
            acc.captial_stock += Number(r.captial_stock || 0);
            acc.stockholder_amt += Number(r.stockholder_amt || 0);
            return acc;
        }, {
            cash_amt: 0, deposite_amt: 0, AR_amt: 0, internal_AR: 0, inventory: 0,
            current_asset_amt: 0, ttl_asset_amt: 0, AP_amt: 0, loan_amt: 0, LT_loan_amt: 0,
            current_debet_amt: 0, ttl_debet_amt: 0, captial_stock: 0, stockholder_amt: 0
        });

        // 內部往來沖銷
        consolidated.AR_net = consolidated.AR_amt - consolidated.internal_AR;
        consolidated.debt_ratio = consolidated.ttl_asset_amt > 0 ? (consolidated.ttl_debet_amt / consolidated.ttl_asset_amt * 100) : 0;
        consolidated.current_ratio = consolidated.current_debet_amt > 0 ? (consolidated.current_asset_amt / consolidated.current_debet_amt) : 0;

        ok(res, { companies: rows, consolidated });
    } catch (err) { fail500(res, err); }
});

// 集團整體概覽
router.get('/overview', async (req, res) => {
    try {
        const { YYYY_MM } = req.query;
        if (!YYYY_MM) return fail(res, '需要 YYYY_MM');
        const [rows] = await pool.execute(`
            SELECT bu_no, sale_amt, net_profit_amt, ttl_asset_amt, ttl_debet_amt, stockholder_amt
            FROM mgm_finance_summary WHERE YYYY_MM=? ORDER BY bu_no
        `, [YYYY_MM]);

        const total = rows.reduce((acc, r) => {
            acc.sale += Number(r.sale_amt || 0);
            acc.profit += Number(r.net_profit_amt || 0);
            acc.asset += Number(r.ttl_asset_amt || 0);
            acc.debt += Number(r.ttl_debet_amt || 0);
            acc.equity += Number(r.stockholder_amt || 0);
            return acc;
        }, { sale: 0, profit: 0, asset: 0, debt: 0, equity: 0 });

        ok(res, {
            companies: rows,
            group_total: {
                total_sale: total.sale,
                total_profit: total.profit,
                total_asset: total.asset,
                total_debt: total.debt,
                total_equity: total.equity,
                profit_margin: total.sale > 0 ? (total.profit / total.sale * 100) : 0,
                debt_ratio: total.asset > 0 ? (total.debt / total.asset * 100) : 0,
                roe: total.equity > 0 ? (total.profit / total.equity * 100) : 0
            }
        });
    } catch (err) { fail500(res, err); }
});

module.exports = router;
