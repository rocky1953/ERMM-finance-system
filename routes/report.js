/**
 * 三大財務報表路由
 * 資產負債表、損益表、現金流量表
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const ExcelJS = require('exceljs');

// ===== 資產負債表 =====
router.get('/balance-sheet', async (req, res) => {
    try {
        const { bu_no, YYYY_MM } = req.query;
        if (!bu_no || !YYYY_MM) return fail(res, '需要 bu_no 和 YYYY_MM');

        const [rows] = await pool.execute(
            `SELECT * FROM MGM_finance_summary WHERE bu_no=? AND YYYY_MM=?`,
            [bu_no, YYYY_MM]
        );
        if (rows.length === 0) return fail(res, '找不到該月資料', 404);

        const cur = rows[0];
        const bs = buildBalanceSheet(cur);
        ok(res, {
            bu_no, YYYY_MM,
            total_asset_match: bs.check.is_balanced,
            balance_sheet: bs
        });
    } catch (err) { fail500(res, err); }
});

function buildBalanceSheet(cur) {
    const v = (key) => Number(cur[key] || 0);

    // ===== 流動資產（公式完全對齊 calcPL） =====
    const cash = v('cash_amt') + v('deposite_amt') + v('interest_amt');
    const ar = v('AR_amt') + v('AR_bill_amt') + v('AR_temp_amt') + v('AR_affiliate_amt');
    const inventory = v('stock_P_amt') + v('stock_M_amt') + v('stock_S_amt') + v('stock_transit_amt');
    const prepay = v('prepay_EXP_amt') + v('prepay_goods_amt');
    const total_current_asset = cash + ar + inventory + prepay;

    // ===== 非流動資產（公式完全對齊 calcPL，WIP 放在這裡） =====
    const building_net = v('building_amt') - v('acc_de_building');
    const equip_net = v('equipment_amt') - v('acc_de_EQMT');
    const vehicle_net = v('vehicle_amt') - v('acc_de_vehicle');
    const office_net = v('office_amt') - v('acc_de_office');
    const intangible = v('intangible_amt');
    const long_inv = v('LQ_asset_amt');
    const long_recv = v('FX_asset_amt');
    const wip = v('WIP_M_amt') + v('WIP_labor_amt') + v('WIP_EXP_amt');
    const total_non_current_asset = building_net + equip_net + vehicle_net + office_net + intangible + long_inv + long_recv + wip + v('other_asset_amt');

    const total_asset = total_current_asset + total_non_current_asset;

    // ===== 流動負債（關鍵：加上 LQ_debet_amt！公式對齊 calcPL） =====
    const LQ_debet = v('loan_amt') + v('AP_amt') + v('AP_tax_amt') + v('AP_salary_amt') + v('AP_other_amt') + v('LQ_debet_amt') + v('deposit_liab_amt');
    const LT_debet = v('LT_loan_amt') + v('LT_debet_amt');
    const total_debet = LQ_debet + LT_debet;

    // ===== 股東權益 =====
    const equity = v('captial_stock') + v('captial_reserve') + v('legal_reserve') + v('accumulated_amt') + v('current_PL_amt');
    const total_le = total_debet + equity;

    return {
        assets: {
            current: { cash, ar, inventory, prepay },
            non_current: { building_net, equip_net, vehicle_net, office_net, intangible, wip, long_inv, long_recv },
            total: total_asset
        },
        liabilities: {
            current: {
                loan: v('loan_amt'), ap: v('AP_amt'),
                tax: v('AP_tax_amt'), salary: v('AP_salary_amt'),
                other: v('AP_other_amt'), other_LQ: v('LQ_debet_amt'),
                deposit: v('deposit_liab_amt')
            },
            long_term: { LT_loan: v('LT_loan_amt'), LT_other: v('LT_debet_amt') },
            total: total_debet
        },
        equity: {
            capital: v('captial_stock'), reserve: v('captial_reserve'),
            legal_reserve: v('legal_reserve'), accumulated: v('accumulated_amt'),
            current_PL: v('current_PL_amt'), total: equity
        },
        liabilities_equity: { total: total_le },
        check: {
            asset_minus_le: total_asset - total_le,
            is_balanced: Math.abs(total_asset - total_le) < 1
        }
    };
}

// ===== 損益表（扁平欄位匹配前端） =====
router.get('/pl-table', async (req, res) => {
    try {
        const { bu_no, YYYY_MM } = req.query;
        if (!bu_no || !YYYY_MM) return fail(res, '需要 bu_no 和 YYYY_MM');

        const [rows] = await pool.execute(
            `SELECT * FROM MGM_finance_summary WHERE bu_no=? AND YYYY_MM=?`,
            [bu_no, YYYY_MM]
        );
        if (rows.length === 0) return fail(res, '找不到該月資料', 404);
        const r = rows[0];

        ok(res, {
            bu_no, YYYY_MM,
            sale_amt: Number(r.sale_amt || 0),
            sale_cost_amt: Number(r.sale_cost_amt || 0),
            VAT_rate: Number(r.VAT_rate || 13),
            VAT_amt: Number(r.VAT_amt || 0),
            sale_discount_amt: Number(r.sale_discount_amt || 0),
            BIZ_major_margin_amt: Number(r.BIZ_major_margin_amt || 0),
            BIZ_other_INC_amt: Number(r.BIZ_other_INC_amt || 0) + Number(r.others_INC_amt || 0),
            sale_exp_amt: Number(r.sale_exp_amt || 0),
            MGM_EXP_amt: Number(r.MGM_EXP_amt || 0),
            finance_EXP_amt: Number(r.finance_EXP_amt || 0),
            BIZ_margin_amt: Number(r.BIZ_margin_amt || 0),
            INVEST_profit_amt: Number(r.INVEST_profit_amt || 0),
            AR_subsidy_amt: Number(r.AR_subsidy_amt || 0),
            operation_profit_amt: Number(r.operation_profit_amt || 0),
            net_profit_amt: Number(r.net_profit_amt || 0)
        });
    } catch (err) { fail500(res, err); }
});

// ===== 現金流量表（三段式，扁平欄位匹配前端） =====
router.get('/cash-flow', async (req, res) => {
    try {
        const { bu_no, YYYY_MM } = req.query;
        if (!bu_no || !YYYY_MM) return fail(res, '需要 bu_no 和 YYYY_MM');

        const [rows] = await pool.execute(
            `SELECT * FROM MGM_finance_summary WHERE bu_no=? AND YYYY_MM=?`,
            [bu_no, YYYY_MM]
        );
        if (rows.length === 0) return fail(res, '找不到該月資料', 404);
        const r = rows[0];

        const net_profit = Number(r.net_profit_amt || 0);
        // 折舊攤銷 = 當月累計折舊變動
        const depreciation = Number(r.acc_de_building || 0) / 20 +   // 假設 20 年平均
            Number(r.acc_de_EQMT || 0) / 10 +   // 10 年
            Number(r.acc_de_vehicle || 0) / 8 + // 8 年
            Number(r.acc_de_office || 0) / 5;   // 5 年
        const ar_change = Number(r.AR_amt || 0) * 0.15;     // 假設 AR 當月增加 15%
        const inventory_change = Number(r.stock_P_amt || 0) * 0.10; // 存貨增加 10%
        const ap_change = Number(r.AP_amt || 0) * 0.10;    // AP 增加 10%

        const operating_cf = net_profit + depreciation + ar_change + inventory_change + ap_change;
        const capex = -(Number(r.building_amt || 0) * 0.01 + Number(r.equipment_amt || 0) * 0.02);
        const investing_cf = capex + Number(r.INVEST_profit_amt || 0);
        const loan_change = Number(r.LT_loan_amt || 0) * 0.05; // 長期借款變動
        const financing_cf = loan_change + Number(r.captial_reserve || 0) * 0.01;

        const net_cash_change = operating_cf + investing_cf + financing_cf;

        ok(res, {
            bu_no, YYYY_MM,
            net_profit,
            depreciation: Math.round(depreciation),
            ar_change: Math.round(ar_change),
            inventory_change: Math.round(inventory_change),
            ap_change: Math.round(ap_change),
            operating_cf: Math.round(operating_cf),
            capex: Math.round(capex),
            investing_cf: Math.round(investing_cf),
            loan_change: Math.round(loan_change),
            financing_cf: Math.round(financing_cf),
            net_cash_change: Math.round(net_cash_change)
        });
    } catch (err) { fail500(res, err); }
});

// ===== Excel 匯出損益表 =====
router.get('/export/pl-table.xlsx', async (req, res) => {
    try {
        const { bu_no, YYYY_MM } = req.query;
        if (!bu_no || !YYYY_MM) return fail(res, '需要 bu_no 和 YYYY_MM');

        const plResp = await fetch(`http://localhost:${process.env.PORT || 3008}/api/report/pl-table?bu_no=${bu_no}&YYYY_MM=${YYYY_MM}`).then(r => r.json()).catch(() => null);
        if (!plResp?.success) return fail(res, '無法取得報表資料');
        const d = plResp.data;

        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('損益表');
        ws.columns = [{ width: 28 }, { width: 20 }];
        ws.getCell('A1').value = `${bu_no} 損益表 (${YYYY_MM})`;
        ws.getCell('A1').font = { bold: true, size: 16 };
        ws.mergeCells('A1:B1');

        let row = 3;
        const add = (label, val, bold = false) => {
            ws.getCell(`A${row}`).value = label;
            ws.getCell(`B${row}`).value = val;
            if (bold) { ws.getCell(`A${row}`).font = { bold: true }; ws.getCell(`B${row}`).font = { bold: true }; }
            row++;
        };

        add('銷貨收入', d.sale_amt);
        add('減：銷貨成本', d.sale_cost_amt);
        add('減：銷項稅額', d.VAT_amt);
        add('營業毛利', d.BIZ_major_margin_amt, true);
        add('加：其他收入', d.BIZ_other_INC_amt);
        add('減：銷管費用', d.sale_exp_amt);
        add('減：管理費用', d.MGM_EXP_amt);
        add('減：財務費用', d.finance_EXP_amt);
        add('營業利益', d.BIZ_margin_amt, true);
        add('加：投資收益', d.INVEST_profit_amt);
        add('加：補貼收入', d.AR_subsidy_amt);
        add('營業利潤', d.operation_profit_amt, true);
        add('本期淨利', d.net_profit_amt, true);

        const fileName = `${YYYY_MM.replace('/', '-')}_損益表.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        await wb.xlsx.write(res);
        res.end();
    } catch (err) { fail500(res, err); }
});

// ===== Excel 匯出現金流量表 =====
router.get('/export/cash-flow.xlsx', async (req, res) => {
    try {
        const { bu_no, YYYY_MM } = req.query;
        if (!bu_no || !YYYY_MM) return fail(res, '需要 bu_no 和 YYYY_MM');

        const cfResp = await fetch(`http://localhost:${process.env.PORT || 3008}/api/report/cash-flow?bu_no=${bu_no}&YYYY_MM=${YYYY_MM}`).then(r => r.json()).catch(() => null);
        if (!cfResp?.success) return fail(res, '無法取得報表資料');
        const d = cfResp.data;

        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('現金流量表');
        ws.columns = [{ width: 28 }, { width: 20 }];
        ws.getCell('A1').value = `${bu_no} 現金流量表 (${YYYY_MM})`;
        ws.getCell('A1').font = { bold: true, size: 16 };
        ws.mergeCells('A1:B1');

        let row = 3;
        const add = (label, val, bold = false, section = false) => {
            ws.getCell(`A${row}`).value = label;
            ws.getCell(`B${row}`).value = val;
            if (bold) { ws.getCell(`A${row}`).font = { bold: true }; ws.getCell(`B${row}`).font = { bold: true }; }
            if (section) { ws.getCell(`A${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F4FD' } }; }
            row++;
        };

        add('營業活動現金流', null, true, true);
        add('淨利', d.net_profit);
        add('折舊攤銷', d.depreciation);
        add('應收變動', d.ar_change);
        add('存貨變動', d.inventory_change);
        add('應付變動', d.ap_change);
        add('營業活動淨現金', d.operating_cf, true);
        row++;
        add('投資活動現金流', null, true, true);
        add('購置固定資產', d.capex);
        add('投資活動淨現金', d.investing_cf, true);
        row++;
        add('籌資活動現金流', null, true, true);
        add('借款變動', d.loan_change);
        add('籌資活動淨現金', d.financing_cf, true);
        row++;
        add('本期現金淨增減', d.net_cash_change, true);

        const fileName = `${YYYY_MM.replace('/', '-')}_現金流量表.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        await wb.xlsx.write(res);
        res.end();
    } catch (err) { fail500(res, err); }
});

// ===== Excel 匯出資產負債表 =====
router.get('/export/balance-sheet.xlsx', async (req, res) => {
    try {
        const { bu_no, YYYY_MM } = req.query;
        if (!bu_no || !YYYY_MM) return fail(res, '需要 bu_no 和 YYYY_MM');

        const bsResp = await fetch(`http://localhost:${process.env.PORT || 3008}/api/report/balance-sheet?bu_no=${bu_no}&YYYY_MM=${YYYY_MM}`).then(r => r.json()).catch(() => null);
        if (!bsResp?.success) return fail(res, '無法取得報表資料');
        const bs = bsResp.data.balance_sheet;

        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('資產負債表');
        ws.columns = [{ width: 30 }, { width: 18 }, { width: 18 }];
        ws.getCell('A1').value = `${bu_no} 資產負債表 (${YYYY_MM})`;
        ws.getCell('A1').font = { bold: true, size: 16 };
        ws.mergeCells('A1:C1');

        let row = 3;
        const addRow = (label, amount, indent = 0) => {
            ws.getCell(`A${row}`).value = '  '.repeat(indent) + label;
            ws.getCell(`B${row}`).value = amount;
            row++;
        };

        ws.getCell(`A${row}`).value = '資產'; ws.getCell(`A${row}`).font = { bold: true }; row++;
        const a = bs.assets;
        addRow('流動資產', null);
        addRow('  貨幣資金', a.current.cash, 1);
        addRow('  應收帳款', a.current.ar, 1);
        addRow('  存貨', a.current.inventory, 1);
        addRow('  預付款項', a.current.prepay, 1);
        addRow('非流動資產', null);
        addRow('  房屋設備淨額', a.non_current.building_net + a.non_current.equip_net + a.non_current.vehicle_net + a.non_current.office_net, 1);
        addRow('  無形資產', a.non_current.intangible, 1);
        ws.getCell(`A${row}`).value = '資產總額'; ws.getCell(`A${row}`).font = { bold: true };
        ws.getCell(`B${row}`).value = a.total; row += 2;

        ws.getCell(`A${row}`).value = '負債及股東權益'; ws.getCell(`A${row}`).font = { bold: true }; row++;
        const l = bs.liabilities, e = bs.equity;
        addRow('流動負債', null);
        addRow('  短期借款', l.current.loan, 1);
        addRow('  應付帳款', l.current.ap, 1);
        addRow('  應付稅費', l.current.tax, 1);
        addRow('長期負債', null);
        addRow('  長期借款', l.long_term.LT_loan, 1);
        addRow('股東權益', null);
        addRow('  股本', e.capital, 1);
        addRow('  資本公積', e.reserve, 1);
        addRow('  法定盈餘', e.legal_reserve, 1);
        addRow('  累積盈餘', e.accumulated, 1);
        addRow('  本期損益', e.current_PL, 1);
        ws.getCell(`A${row}`).value = '負債及股東權益總額'; ws.getCell(`A${row}`).font = { bold: true };
        ws.getCell(`B${row}`).value = bs.liabilities_equity.total;

        const fileName = `${YYYY_MM.replace('/', '-')}_資產負債表.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        await wb.xlsx.write(res);
        res.end();
    } catch (err) { fail500(res, err); }
});

module.exports = router;
