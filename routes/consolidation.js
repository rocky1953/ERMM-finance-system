/**
 * 合併報表路由
 * 多公司合併資產負債表 / 損益表 / 現金流量表 / 內部交易沖銷
 *
 * 計算口徑：
 * 1. 基礎報表取自 mgm_finance_summary，金額一律視為 RMB，不做任何匯率換算；
 *    僅納入 HM/HN/SZ，排除虛擬公司 LTN。
 * 2. 僅將 consol_elimination_entry 中「已確認」的分錄計入合併結果；未確認分錄僅列出並提示。
 * 3. 抵消分錄金額同樣直接按 RMB 計入，不再按幣別或匯率折算。
 * 4. SALE：沖減內部銷售收入，同時等額沖減銷售成本（假設內部銷售商品已全部對外銷售，
 *    期末無未實現利潤；若實際有存貨未實現利潤，需另行調整存貨與利潤）。
 * 5. AR/AP：沖減內部應收與應付；兩類同時存在時按 AR 金額沖銷，避免重複。
 * 6. LOAN：沖減短期借款（借款人）與其他應收（出借人）。
 * 7. DIVIDEND：沖減投資收益（損益）及應收股利與股東權益（資產負債）。
 * 8. OTHER：作為其他內部收益，沖減營業外收入及淨利。
 * 9. 尚未處理長期股權投資與子公司權益的抵消（分錄類型未涵蓋），報表會提示。
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const consolSrvc = require('../services/consolidation');

const COMPANIES = ['HM', 'HN', 'SZ'];
const ENTRY_TYPES = ['SALE', 'AR', 'AP', 'LOAN', 'DIVIDEND', 'OTHER'];
const ENTRY_LABELS = {
    SALE: '內部銷售',
    AR: '內部應收',
    AP: '內部應付',
    LOAN: '內部借款',
    DIVIDEND: '內部股利',
    OTHER: '其他內部交易'
};

const n = (v) => Number(v || 0);
const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const BASE_CURRENCY = 'RMB';

// 讀取合併基礎資料：財務匯總（先折算到集團本位幣）+ 抵消分錄
async function loadConsolInput(YYYY_MM, rateType = 'AVG') {
    const [rows] = await pool.execute(`
        SELECT
            bu_no, sale_amt, sale_cost_amt, net_sale_amt,
            sale_exp_amt, MGM_EXP_amt, finance_EXP_amt, operation_EXP_amt,
            BIZ_major_margin_amt, BIZ_margin_amt, operation_profit_amt,
            pretax_profit_amt, net_profit_amt, INVEST_profit_amt, others_INC_amt, others_cost_amt,
            AR_affiliate_amt, cash_amt, deposite_amt, AR_amt, AR_other_amt, AR_dividend_amt,
            stock_P_amt, stock_M_amt, stock_S_amt, current_asset_amt, ttl_asset_amt,
            AP_amt, loan_amt, LT_loan_amt, current_debet_amt, ttl_debet_amt,
            captial_stock, accumulated_amt, stockholder_amt
        FROM mgm_finance_summary
        WHERE YYYY_MM=? AND bu_no IN ('HM','HN','SZ')
        ORDER BY bu_no
    `, [YYYY_MM]);

    const [entryRows] = await pool.execute(`
        SELECT id, YYYY_MM, bu_no_from, bu_no_to, entry_type, amount,
               currency, is_confirmed, remark, source
        FROM consol_elimination_entry
        WHERE YYYY_MM=?
        ORDER BY entry_type, id
    `, [YYYY_MM]);

    // === 多幣折算 ===
    const { rows: translated, rateBreakdown, base_currency, missingRates }
        = await consolSrvc.translateRows(YYYY_MM, rows, rateType);

    if (missingRates.length) {
        // 匯率缺失只影響非本位幣公司，標記 warning 但不阻塞
    }

    const warnings = [];
    const warningSet = new Set();
    const addWarning = (msg) => {
        if (!warningSet.has(msg)) { warningSet.add(msg); warnings.push(msg); }
    };

    if (missingRates.length > 0) {
        addWarning(`缺少以下公司/幣別匯率，未折算直接相加：${missingRates.map(r=>`${r.bu_no}(${r.currency})`).join(', ')}`);
    }
    const nonBase = Object.entries(rateBreakdown).filter(([k,v]) => v.from_currency !== base_currency && v.rate);
    if (nonBase.length > 0) {
        addWarning(`已按 ${rateType === 'END' ? '期末匯率' : '平均匯率'} 折算以下公司到 ${base_currency}：${nonBase.map(([k,v])=>`${k} ${v.from_currency}→${base_currency}=${v.rate}`).join(', ')}`);
    }

    const entries = entryRows.map(e => ({
        id: e.id,
        YYYY_MM: e.YYYY_MM,
        bu_no_from: e.bu_no_from,
        bu_no_to: e.bu_no_to,
        entry_type: e.entry_type,
        entry_type_label: ENTRY_LABELS[e.entry_type] || e.entry_type,
        amount: n(e.amount),
        currency: e.currency || 'RMB',
        amount_translated: r2(n(e.amount)), // 抵消分錄金額視為集團本位幣已確認
        is_confirmed: Number(e.is_confirmed) === 1,
        remark: e.remark || '',
        source: e.source || ''
    }));

    const unconfirmed = entries.filter(e => !e.is_confirmed).length;
    if (unconfirmed > 0) addWarning(`本期有 ${unconfirmed} 條未確認抵消分錄，未計入合併結果`);

    const summary = {};
    for (const t of ENTRY_TYPES) summary[t] = 0;
    for (const e of entries) {
        if (!e.is_confirmed) continue;
        if (summary[e.entry_type] === undefined) summary[e.entry_type] = 0;
        summary[e.entry_type] = r2(summary[e.entry_type] + e.amount_translated);
    }

    if (entries.some(e => e.is_confirmed && e.source === 'AUTO_INTERNAL_SALE')) {
        addWarning('自動生成的內部銷售沖銷取自關係人應收餘額（AR_affiliate_amt），並非實際內部銷售額，請核對後確認');
    }
    if (summary.AR > 0 && summary.AP > 0) {
        addWarning('本期同時存在 AR 與 AP 抵消分錄，為避免重複沖銷，資產負債表按 AR 金額沖銷');
    }
    if (summary.DIVIDEND > 0 || summary.LOAN > 0) {
        addWarning('長期股權投資與子公司權益的抵消尚未納入（分錄類型未涵蓋），股東權益僅作股利層面調整');
    }

    return { rows: translated, entries, summary, warnings, base_currency, rateBreakdown, missingRates };
}

function emptyIncome() {
    return {
        sale_amt: 0, sale_cost_amt: 0, net_sale_amt: 0,
        sale_exp_amt: 0, MGM_EXP_amt: 0, finance_EXP_amt: 0, operation_EXP_amt: 0,
        BIZ_major_margin_amt: 0, BIZ_margin_amt: 0, operation_profit_amt: 0,
        pretax_profit_amt: 0, net_profit_amt: 0, INVEST_profit_amt: 0,
        others_INC_amt: 0, AR_affiliate_amt: 0
    };
}

function buildIncome(rows, summary, addWarning) {
    const before = emptyIncome();
    for (const r of rows) {
        for (const k of Object.keys(before)) before[k] = r2(before[k] + n(r[k]));
    }

    const internalSale = summary.SALE || 0;
    const dividendIncome = summary.DIVIDEND || 0;
    const otherIncome = summary.OTHER || 0;
    const costElim = Math.min(internalSale, before.sale_cost_amt);
    if (internalSale > before.sale_cost_amt) {
        addWarning('內部銷售沖銷金額大於合併銷售成本，成本僅沖減至 0，請核對抵消分錄');
    }

    const after = { ...before };
    after.sale_amt = r2(before.sale_amt - internalSale);
    after.net_sale_amt = r2(before.net_sale_amt - internalSale);
    after.sale_cost_amt = r2(before.sale_cost_amt - costElim);
    after.INVEST_profit_amt = r2(before.INVEST_profit_amt - dividendIncome);
    after.others_INC_amt = r2(before.others_INC_amt - otherIncome);
    const plAdjust = r2(dividendIncome + otherIncome);
    after.operation_profit_amt = r2(before.operation_profit_amt - plAdjust);
    after.pretax_profit_amt = r2(before.pretax_profit_amt - plAdjust);
    after.net_profit_amt = r2(before.net_profit_amt - plAdjust);
    after.BIZ_major_margin_amt = r2(before.BIZ_major_margin_amt - internalSale + costElim);
    after.BIZ_margin_amt = before.BIZ_margin_amt;

    const decorate = (o) => {
        o.gross_profit = r2(o.sale_amt - o.sale_cost_amt);
        o.gross_margin = o.sale_amt > 0 ? r2(o.gross_profit / o.sale_amt * 100) : 0;
        o.net_margin = o.sale_amt > 0 ? r2(o.net_profit_amt / o.sale_amt * 100) : 0;
        return o;
    };
    decorate(before);
    decorate(after);

    after.internal_sale = internalSale;
    after.consolidated_sale = after.sale_amt;

    const adjustment = {
        internal_sale: internalSale,
        internal_sale_cost: costElim,
        dividend_income: dividendIncome,
        other_income: otherIncome,
        profit: r2(plAdjust)
    };

    return { before, after, adjustment };
}

function emptyBalance() {
    return {
        cash_amt: 0, deposite_amt: 0, AR_amt: 0, AR_other_amt: 0, AR_dividend_amt: 0,
        inventory: 0, current_asset_amt: 0, ttl_asset_amt: 0,
        AP_amt: 0, loan_amt: 0, LT_loan_amt: 0, current_debet_amt: 0, ttl_debet_amt: 0,
        captial_stock: 0, accumulated_amt: 0, stockholder_amt: 0
    };
}

function buildBalanceSheet(rows, summary, addWarning) {
    const before = emptyBalance();
    for (const r of rows) {
        before.cash_amt = r2(before.cash_amt + n(r.cash_amt));
        before.deposite_amt = r2(before.deposite_amt + n(r.deposite_amt));
        before.AR_amt = r2(before.AR_amt + n(r.AR_amt));
        before.AR_other_amt = r2(before.AR_other_amt + n(r.AR_other_amt));
        before.AR_dividend_amt = r2(before.AR_dividend_amt + n(r.AR_dividend_amt));
        before.inventory = r2(before.inventory + n(r.stock_P_amt) + n(r.stock_M_amt) + n(r.stock_S_amt));
        before.current_asset_amt = r2(before.current_asset_amt + n(r.current_asset_amt));
        before.ttl_asset_amt = r2(before.ttl_asset_amt + n(r.ttl_asset_amt));
        before.AP_amt = r2(before.AP_amt + n(r.AP_amt));
        before.loan_amt = r2(before.loan_amt + n(r.loan_amt));
        before.LT_loan_amt = r2(before.LT_loan_amt + n(r.LT_loan_amt));
        before.current_debet_amt = r2(before.current_debet_amt + n(r.current_debet_amt));
        before.ttl_debet_amt = r2(before.ttl_debet_amt + n(r.ttl_debet_amt));
        before.captial_stock = r2(before.captial_stock + n(r.captial_stock));
        before.accumulated_amt = r2(before.accumulated_amt + n(r.accumulated_amt));
        before.stockholder_amt = r2(before.stockholder_amt + n(r.stockholder_amt));
    }

    const balanceElim = summary.AR > 0 ? summary.AR : summary.AP || 0;
    const loanElim = summary.LOAN || 0;
    const dividendElim = summary.DIVIDEND || 0;

    if (balanceElim > before.AR_amt) addWarning('內部往來沖銷金額大於合併應收帳款，應收帳款將出現負數，請核對抵消分錄');
    if (balanceElim > before.AP_amt) addWarning('內部往來沖銷金額大於合併應付帳款，應付帳款將出現負數，請核對抵消分錄');

    const after = { ...before };
    after.AR_amt = r2(before.AR_amt - balanceElim);
    after.AP_amt = r2(before.AP_amt - balanceElim);
    after.current_asset_amt = r2(before.current_asset_amt - balanceElim - loanElim - dividendElim);
    after.current_debet_amt = r2(before.current_debet_amt - balanceElim - loanElim);
    after.ttl_asset_amt = r2(before.ttl_asset_amt - balanceElim - loanElim - dividendElim);
    after.ttl_debet_amt = r2(before.ttl_debet_amt - balanceElim - loanElim);
    after.loan_amt = r2(before.loan_amt - loanElim);
    after.AR_other_amt = r2(before.AR_other_amt - loanElim);
    after.AR_dividend_amt = r2(before.AR_dividend_amt - dividendElim);
    after.accumulated_amt = r2(before.accumulated_amt - dividendElim);
    after.stockholder_amt = r2(before.stockholder_amt - dividendElim);

    const decorate = (o) => {
        o.balance_check = r2(o.ttl_asset_amt - o.ttl_debet_amt - o.stockholder_amt);
        o.debt_ratio = o.ttl_asset_amt > 0 ? r2(o.ttl_debet_amt / o.ttl_asset_amt * 100) : 0;
        o.current_ratio = o.current_debet_amt > 0 ? r2(o.current_asset_amt / o.current_debet_amt) : 0;
        return o;
    };
    decorate(before);
    decorate(after);

    after.internal_AR = balanceElim;
    after.AR_net = after.AR_amt;
    after.balance_elim = balanceElim;
    after.loan_elim = loanElim;
    after.dividend_elim = dividendElim;

    const adjustment = {
        intercompany: balanceElim,
        loan: loanElim,
        dividend: dividendElim,
        total_asset: r2(-(balanceElim + loanElim + dividendElim)),
        total_debt: r2(-(balanceElim + loanElim)),
        total_equity: -dividendElim
    };

    return { before, after, adjustment };
}

// 合併損益表（損益用平均匯率折算）
router.get('/income', async (req, res) => {
    try {
        const { YYYY_MM } = req.query;
        if (!YYYY_MM) return fail(res, '需要 YYYY_MM');

        const { rows, entries, summary, warnings, base_currency, rateBreakdown } = await loadConsolInput(YYYY_MM, 'AVG');
        if (rows.length === 0) {
            return ok(res, {
                YYYY_MM, base_currency, companies: [],
                before: null, adjustment: null, consolidated: null,
                elimination_summary: summary, elimination_entries: entries,
                rate_breakdown: rateBreakdown, warnings
            });
        }

        const { before, after, adjustment } = buildIncome(rows, summary, (m) => {
            if (!warnings.includes(m)) warnings.push(m);
        });

        ok(res, {
            YYYY_MM,
            base_currency,
            companies: rows,
            before,
            adjustment,
            consolidated: after,
            elimination_summary: summary,
            elimination_entries: entries,
            rate_breakdown: rateBreakdown,
            warnings
        });
    } catch (err) { fail500(res, err); }
});

// 合併資產負債表（資產負債用期末匯率折算）
router.get('/balance-sheet', async (req, res) => {
    try {
        const { YYYY_MM } = req.query;
        if (!YYYY_MM) return fail(res, '需要 YYYY_MM');

        const { rows, entries, summary, warnings, base_currency, rateBreakdown } = await loadConsolInput(YYYY_MM, 'END');
        if (rows.length === 0) {
            return ok(res, {
                YYYY_MM, base_currency, companies: [],
                before: null, adjustment: null, consolidated: null,
                elimination_summary: summary, elimination_entries: entries,
                rate_breakdown: rateBreakdown, warnings
            });
        }

        const { before, after, adjustment } = buildBalanceSheet(rows, summary, (m) => {
            if (!warnings.includes(m)) warnings.push(m);
        });

        ok(res, {
            YYYY_MM,
            base_currency,
            companies: rows,
            before,
            adjustment,
            consolidated: after,
            elimination_summary: summary,
            elimination_entries: entries,
            rate_breakdown: rateBreakdown,
            warnings
        });
    } catch (err) { fail500(res, err); }
});

// 合併現金流量表（現金流用平均匯率折算）
router.get('/cash-flow', async (req, res) => {
    try {
        const { YYYY_MM } = req.query;
        if (!YYYY_MM) return fail(res, '需要 YYYY_MM');

        const [rawRows] = await pool.execute(`
            SELECT bu_no, cash_begin_amt, cash_end_amt,
                   cash_operation_in, cash_operation_out,
                   cash_invest_in, cash_invest_out,
                   cash_finance_in, cash_finance_out
            FROM mgm_finance_summary
            WHERE YYYY_MM=? AND bu_no IN ('HM','HN','SZ')
            ORDER BY bu_no
        `, [YYYY_MM]);

        const { summary, warnings, base_currency, rateBreakdown } = await loadConsolInput(YYYY_MM, 'AVG');
        const { rows: translatedRows } = await consolSrvc.translateRows(YYYY_MM, rawRows, 'AVG');
        const rows = translatedRows;

        const empty = {
            cash_begin_amt: 0, cash_operation_in: 0, cash_operation_out: 0,
            cash_invest_in: 0, cash_invest_out: 0, cash_finance_in: 0, cash_finance_out: 0,
            cash_end_amt: 0
        };
        const total = { ...empty };
        for (const r of rows) {
            for (const k of Object.keys(empty)) total[k] = r2(total[k] + n(r[k]));
        }
        total.operating_net = r2(total.cash_operation_in - total.cash_operation_out);
        total.invest_net = r2(total.cash_invest_in - total.cash_invest_out);
        total.finance_net = r2(total.cash_finance_in - total.cash_finance_out);
        total.net_change = r2(total.operating_net + total.invest_net + total.finance_net);
        total.balance_change = r2(total.cash_end_amt - total.cash_begin_amt);
        total.reconcile_diff = r2(total.net_change - total.balance_change);

        const detailAvailable = total.cash_operation_in || total.cash_operation_out
            || total.cash_invest_in || total.cash_invest_out
            || total.cash_finance_in || total.cash_finance_out
            || total.cash_begin_amt || total.cash_end_amt;
        if (!detailAvailable) {
            warnings.push('財務匯總未提供現金流量拆分數據（現金流入/流出欄位為 0），現金流量表暫無有效數據');
        } else if (Math.abs(total.reconcile_diff) > 0.01) {
            warnings.push(`現金流量淨變動與期末－期初現金差異 ${total.reconcile_diff}，請核對現金流量分類`);
        }
        if ((summary.SALE || summary.AR || summary.AP || summary.LOAN) > 0) {
            warnings.push('內部銷售/往來/借款的現金流未按項目抵消，現金流量表為各公司彙總數');
        }

        ok(res, {
            YYYY_MM,
            base_currency,
            companies: rows,
            consolidated: total,
            data_available: !!detailAvailable,
            rate_breakdown: rateBreakdown,
            warnings
        });
    } catch (err) { fail500(res, err); }
});

// 集團整體概覽（概覽用平均匯率折算，與損益表一致）
router.get('/overview', async (req, res) => {
    try {
        const { YYYY_MM } = req.query;
        if (!YYYY_MM) return fail(res, '需要 YYYY_MM');

        const { rows, summary, warnings, base_currency, rateBreakdown } = await loadConsolInput(YYYY_MM, 'AVG');
        const income = rows.length
            ? buildIncome(rows, summary, (m) => { if (!warnings.includes(m)) warnings.push(m); })
            : null;
        const balance = rows.length
            ? buildBalanceSheet(rows, summary, (m) => { if (!warnings.includes(m)) warnings.push(m); })
            : null;

        const after = {
            sale: income ? income.after.sale_amt : 0,
            profit: income ? income.after.net_profit_amt : 0,
            asset: balance ? balance.after.ttl_asset_amt : 0,
            debt: balance ? balance.after.ttl_debet_amt : 0,
            equity: balance ? balance.after.stockholder_amt : 0
        };
        const before = {
            sale: income ? income.before.sale_amt : 0,
            profit: income ? income.before.net_profit_amt : 0,
            asset: balance ? balance.before.ttl_asset_amt : 0,
            debt: balance ? balance.before.ttl_debet_amt : 0,
            equity: balance ? balance.before.stockholder_amt : 0
        };

        ok(res, {
            YYYY_MM,
            base_currency,
            companies: rows,
            before: {
                total_sale: before.sale,
                total_profit: before.profit,
                total_asset: before.asset,
                total_debt: before.debt,
                total_equity: before.equity
            },
            group_total: {
                total_sale: after.sale,
                total_profit: after.profit,
                total_asset: after.asset,
                total_debt: after.debt,
                total_equity: after.equity,
                profit_margin: after.sale > 0 ? r2(after.profit / after.sale * 100) : 0,
                debt_ratio: after.asset > 0 ? r2(after.debt / after.asset * 100) : 0,
                roe: after.equity > 0 ? r2(after.profit / after.equity * 100) : 0
            },
            adjustment: {
                sale: r2(after.sale - before.sale),
                profit: r2(after.profit - before.profit),
                asset: r2(after.asset - before.asset),
                debt: r2(after.debt - before.debt),
                equity: r2(after.equity - before.equity)
            },
            elimination_summary: summary,
            rate_breakdown: rateBreakdown,
            warnings
        });
    } catch (err) { fail500(res, err); }
});

// ================================================
// 折算差異查詢
// ================================================
router.get('/translation-diff', async (req, res) => {
    try {
        const { YYYY_MM } = req.query;
        if (!YYYY_MM) return fail(res, '需要 YYYY_MM');
        const [rows] = await pool.execute(
            "SELECT * FROM consol_translation_diff WHERE YYYY_MM=? ORDER BY bu_no", [YYYY_MM]
        );
        const totalDiff = rows.reduce((s, r) => s + Number(r.diff_amount || 0), 0);
        ok(res, { YYYY_MM, rows, total_diff: r2(totalDiff) });
    } catch (err) { fail500(res, err); }
});

// ================================================
// 合併報表快照明細（董事會報告包追溯用）
// ================================================
router.post('/snapshot', async (req, res) => {
    try {
        const { YYYY_MM, snapshot_type, board_pack_id } = req.body;
        if (!YYYY_MM || !snapshot_type) return fail(res, '需要 YYYY_MM + snapshot_type(PnL/BalanceSheet/CashFlow/Overview)');

        // 重新拉一遍合併數據並存快照
        let rateType = snapshot_type === 'BalanceSheet' ? 'END' : 'AVG';
        const { rows, summary, warnings, base_currency } = await loadConsolInput(YYYY_MM, rateType);
        let elimTotal = Object.values(summary).reduce((s, v) => s + Number(v || 0), 0);

        let data = null;
        if (snapshot_type === 'PnL') {
            data = buildIncome(rows, summary, () => {});
        } else if (snapshot_type === 'BalanceSheet') {
            data = buildBalanceSheet(rows, summary, () => {});
        } else if (snapshot_type === 'Overview') {
            const inc = rows.length ? buildIncome(rows, summary, () => {}) : null;
            const bal = rows.length ? buildBalanceSheet(rows, summary, () => {}) : null;
            data = { income: inc, balance: bal };
        } else if (snapshot_type === 'CashFlow') {
            data = { note: 'CashFlow snapshot see /consolidation/cash-flow endpoint' };
        }

        // 折算差異：直接用原始 DB 行（未折算），由 consolSrvc 內部 translate
        let translDiff = 0;
        try {
            const [rawRows] = await pool.execute(
                "SELECT bu_no, sale_amt, net_profit_amt, ttl_asset_amt, ttl_debet_amt FROM mgm_finance_summary WHERE YYYY_MM=? AND bu_no IN ('HM','HN','SZ')",
                [YYYY_MM]
            );
            if (rawRows.length) {
                const td = await consolSrvc.computeTranslationDiff(YYYY_MM, rawRows, rawRows);
                translDiff = td.totalDiff;
                await consolSrvc.saveTranslationDiff(YYYY_MM, td.companyDiffs);
            }
        } catch(e) { /* 折算差異非阻塞 */ }

        const id = await consolSrvc.saveSnapshot({
            YYYY_MM, snapshot_type, base_currency,
            data_json: data, elim_total: elimTotal, transl_diff: translDiff,
            generated_by: req.user?.user_id || 'system', board_pack_id
        });

        ok(res, { snapshot_id: id, YYYY_MM, snapshot_type, base_currency, warnings }, '快照明細已保存');
    } catch (err) { fail500(res, err); }
});

router.get('/snapshot', async (req, res) => {
    try {
        const { YYYY_MM, snapshot_type } = req.query;
        let sql = "SELECT id, YYYY_MM, snapshot_type, base_currency, bu_no, version_no, elim_total, transl_diff, generated_by, board_pack_id, is_final, create_time FROM consol_snapshot WHERE 1=1";
        const vals = [];
        if (YYYY_MM) { sql += " AND YYYY_MM=?"; vals.push(YYYY_MM); }
        if (snapshot_type) { sql += " AND snapshot_type=?"; vals.push(snapshot_type); }
        sql += " ORDER BY YYYY_MM DESC, snapshot_type, version_no DESC";
        const [rows] = await pool.execute(sql, vals);
        ok(res, { rows });
    } catch (err) { fail500(res, err); }
});

router.get('/snapshot/:id', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            "SELECT * FROM consol_snapshot WHERE id=?", [req.params.id]
        );
        if (!rows.length) return fail(res, '快照明細不存在', 404);
        ok(res, rows[0]);
    } catch (err) { fail500(res, err); }
});

// ================================================
// 抵消分錄自動匹配建議
// ================================================
router.get('/elim-suggestions', async (req, res) => {
    try {
        const { YYYY_MM } = req.query;
        if (!YYYY_MM) return fail(res, '需要 YYYY_MM');
        const [rows] = await pool.execute(
            "SELECT * FROM consol_elim_suggest WHERE YYYY_MM=? ORDER BY confidence DESC, amount DESC LIMIT 100",
            [YYYY_MM]
        );
        ok(res, { YYYY_MM, rows, total: rows.length });
    } catch (err) { fail500(res, err); }
});

router.post('/elim-suggestions/generate', async (req, res) => {
    try {
        const { YYYY_MM } = req.body;
        if (!YYYY_MM) return fail(res, '需要 YYYY_MM');
        const result = await consolSrvc.generateElimSuggestions(YYYY_MM);
        ok(res, { YYYY_MM, ...result }, '抵消建議生成完成');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
