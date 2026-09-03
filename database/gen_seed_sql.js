/**
 * 產生種子資料 SQL 檔案
 * 獨立執行：node database/gen_seed_sql.js
 * 輸出：database/seed_data.sql
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const MONTHS = [
    { YYYY_MM: '2024/09', YYYY: '2024', MM: '09', days: 30 },
    { YYYY_MM: '2024/10', YYYY: '2024', MM: '10', days: 31 },
    { YYYY_MM: '2024/11', YYYY: '2024', MM: '11', days: 30 },
];
const BUS = ['HM', 'SZ', 'HN'];
const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function esc(v) {
    if (v === null || v === undefined || (typeof v === 'number' && isNaN(v))) return 'NULL';
    if (typeof v === 'number') return v;
    return "'" + String(v).replace(/'/g, "''") + "'";
}

function buildSummary(bu, ym, monthIdx) {
    const baseSale = { HM: 12000000, SZ: 8000000, HN: 5000000 }[bu];
    const growth = 1 + monthIdx * 0.07;
    const sale = Math.round(baseSale * growth);              // 含稅銷售額
    const costRate = 0.55;
    const saleExpRate = 0.08;
    const mgmtExpRate = 0.06;
    const finExpRate = 0.02;

    // === 損益表 ===
    const saleCost = Math.round(sale * costRate);            // 銷貨成本
    const vatRate = 13;
    const vat = Math.round(sale / 1.13 * 0.13);              // 銷項稅額（正數）
    const bizMajorMargin = sale - saleCost - vat;            // 營業毛利
    const saleExp = Math.round(sale * saleExpRate);          // 銷售費用
    const mgmtExp = Math.round(sale * mgmtExpRate);           // 管理費用
    const otherInc = Math.round(sale * 0.01);                 // 營業外收入
    const bizMargin = bizMajorMargin + otherInc - saleExp - mgmtExp; // 營業利益
    const finExp = Math.round(sale * finExpRate);             // 財務費用
    const investProfit = Math.round(sale * 0.02);             // 投資收益
    const subsidy = Math.round(sale * 0.015);                 // 補貼收入
    const opProfit = bizMargin + investProfit + subsidy - finExp;   // 稅前淨利
    const tax = Math.round(opProfit * 0.15);                  // 所得稅 15%
    const netProfit = opProfit - tax;                          // 稅後淨利

    // === 存貨（資產） ===
    const stockP = Math.round(saleCost * 0.20);              // 原料
    const stockM = Math.round(saleCost * 0.15);              // 半成品
    const stockS = Math.round(saleCost * 0.05);              // 成品
    const stockValue = stockP + stockM + stockS;
    const WIP_M = Math.round(saleCost * 0.04);               // 在製品
    const WIP_labor = Math.round(saleCost * 0.025);
    const WIP_EXP = Math.round(saleCost * 0.015);

    // === 流動資產 ===
    const ar = Math.round(sale * 0.30);                       // 應收帳款
    const arBill = Math.round(sale * 0.05);                   // 應收票據
    const arTemp = Math.round(sale * 0.02);                   // 應收暫付款
    const deposit = Math.round(sale * 0.10);                  // 銀行存款
    const prepayExp = Math.round(sale * 0.03);               // 預付費用
    const prepayGoods = Math.round(saleCost * 0.05);         // 預付貨款
    let cash = Math.max(Math.round(sale * 0.12), 500000);  // 庫存現金（後續可能調整）

    const lqAsset = cash + deposit + ar + arBill + arTemp + stockValue
                  + WIP_M + WIP_labor + WIP_EXP + prepayExp + prepayGoods;

    // === 固定資產（淨額） ===
    const buildingCost = Math.round(baseSale * 0.8);
    const accDeBuilding = Math.round(buildingCost * 0.3);
    const equipmentCost = Math.round(baseSale * 0.5);
    const accDeEqmt = Math.round(equipmentCost * 0.4);
    const vehicleCost = Math.round(baseSale * 0.15);
    const accDeVehicle = Math.round(vehicleCost * 0.5);
    const officeCost = Math.round(baseSale * 0.1);
    const accDeOffice = Math.round(officeCost * 0.6);
    const intangible = Math.round(baseSale * 0.05);

    const fxAsset = (buildingCost - accDeBuilding) + (equipmentCost - accDeEqmt)
                  + (vehicleCost - accDeVehicle) + (officeCost - accDeOffice) + intangible;

    const ttlAsset = lqAsset + fxAsset;

    // === 負債 ===
    const ap = Math.round(saleCost * 0.18);                   // 應付帳款
    const apTax = Math.round(vat * 0.85);                     // 應付稅金
    const apSalary = Math.round(sale * 0.04);                 // 應付工資
    const apOther = Math.round(sale * 0.015);                 // 其他應付款
    const loan = Math.round(ttlAsset * 0.18);                  // 短期借款
    const ltLoan = Math.round(ttlAsset * 0.10);               // 長期借款

    const lqDebet = ap + apTax + apSalary + apOther + loan;
    const ltDebet = ltLoan;
    const debetAmt = lqDebet + ltDebet;

    // === 權益 ===
    const capital = { HM: 5000000, SZ: 3000000, HN: 2000000 }[bu];
    const capitalReserve = Math.round(capital * 0.1);
    // 累積盈虧（之前月份的淨利累積，正數）
    const accumulatedPrev = monthIdx === 0 ? 0 : Math.round(baseSale * (1 + (monthIdx-1) * 0.07) * 0.05 * (monthIdx));
    // 本月淨利
    const currentPL = netProfit;
    const retainedEarnings = accumulatedPrev + currentPL;       // 保留盈餘 = 累積 + 本月

    const stockholder = capital + capitalReserve + retainedEarnings;

    // === 強制資產 = 負債 + 權益（調整現金） ===
    const ttlLiabEquity = debetAmt + stockholder;
    if (ttlAsset !== ttlLiabEquity) {
        cash += (ttlLiabEquity - ttlAsset);    // 用現金調整
    }
    const finalLqAsset = cash + deposit + ar + arBill + arTemp + stockValue
                       + WIP_M + WIP_labor + WIP_EXP + prepayExp + prepayGoods;
    const finalTtlAsset = finalLqAsset + fxAsset;

    return {
        bu_no: bu, YYYY_MM: ym.YYYY_MM, YYYY: ym.YYYY, MM: ym.MM,
        sale_amt: sale, sale_cost_amt: saleCost, VAT_amt: vat, VAT_rate: vatRate,
        BIZ_major_margin_amt: bizMajorMargin, BIZ_margin_amt: bizMargin,
        BIZ_other_INC_amt: otherInc, sale_exp_amt: saleExp, MGM_EXP_amt: mgmtExp,
        finance_EXP_amt: finExp, INVEST_profit_amt: investProfit, AR_subsidy_amt: subsidy,
        operation_profit_amt: opProfit, net_profit_amt: netProfit,
        cash_amt: cash, deposite_amt: deposit, AR_amt: ar, AR_bill_amt: arBill, AR_temp_amt: arTemp,
        stock_P_amt: stockP, stock_M_amt: stockM, stock_S_amt: stockS, stock_value_amt: stockValue,
        WIP_M_amt: WIP_M, WIP_labor_amt: WIP_labor, WIP_EXP_amt: WIP_EXP,
        prepay_EXP_amt: prepayExp, prepay_goods_amt: prepayGoods,
        building_amt: buildingCost, acc_de_building: accDeBuilding,
        equipment_amt: equipmentCost, acc_de_EQMT: accDeEqmt,
        vehicle_amt: vehicleCost, acc_de_vehicle: accDeVehicle,
        office_amt: officeCost, acc_de_office: accDeOffice,
        intangible_amt: intangible,
        LQ_asset_amt: finalLqAsset, FX_asset_amt: fxAsset, ttl_asset_amt: finalTtlAsset,
        loan_amt: loan, AP_amt: ap, AP_tax_amt: apTax, AP_salary_amt: apSalary, AP_other_amt: apOther,
        LT_loan_amt: ltLoan, LT_debet_amt: ltDebet,
        LQ_debet_amt: lqDebet, debet_amt: debetAmt, ttl_debet_amt: debetAmt,
        captial_stock: capital, captial_reserve: capitalReserve,
        accumulated_amt: accumulatedPrev, retained_income_amt: retainedEarnings,
        current_PL_amt: currentPL, stockholder_amt: stockholder
    };
}

function insertSQL(table, obj) {
    const cols = Object.keys(obj).map(c => '`' + c + '`').join(',');
    const vals = Object.values(obj).map(esc).join(',');
    return `INSERT INTO \`${table}\` (${cols}) VALUES (${vals});`;
}

async function main() {
    let sql = '';
    sql += `-- =============================================================\n`;
    sql += `-- ERMM 財務模組 - 種子資料 SQL\n`;
    sql += `-- 日期範圍: 2024/09/01 ~ 2024/11/30\n`;
    sql += `-- 公司別: HM, SZ, HN\n`;
    sql += `-- 共 9 張表, 約 400 筆資料\n`;
    sql += `-- =============================================================\n\n`;
    sql += `USE ERMM_db;\n\n`;
    sql += `SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n`;

    // === 1. 清理 ===
    sql += `-- === 清理舊資料 ===\n`;
    for (const t of ['forecast_detail','pay_detail','check_detail','ERMM_ARAP_detail',
                    'MGM_bank_loan_details','MGM_invoice_details','MGM_casher_details',
                    'MGM_finance_summary','MGM_KPI_desc']) {
        sql += `DELETE FROM ${t} WHERE bu_no IN ('HM','SZ','HN');\n`;
    }
    sql += `\n`;

    // === 2. 財務摘要 ===
    sql += `-- === 財務摘要 (MGM_finance_summary) ===\n`;
    for (const bu of BUS) {
        for (let i = 0; i < MONTHS.length; i++) {
            sql += insertSQL('MGM_finance_summary', buildSummary(bu, MONTHS[i], i)) + '\n';
        }
    }
    sql += `\n`;

    // === 3. 發票 ===
    sql += `-- === 發票明細 (MGM_invoice_details) ===\n`;
    const custs = ['華東經銷商','華南經銷商','出口日本','出口歐洲','香港總公司'];
    const sups = ['鋼材供應商A','塑膠原料B','電子零組件C','包裝材料D','能源供應E'];
    for (const bu of BUS) {
        for (const ym of MONTHS) {
            const s = buildSummary(bu, ym, MONTHS.indexOf(ym));
            for (let i = 0; i < 8 + rnd(0,2); i++) {
                const amt = Math.round(s.sale_amt * (0.04 + Math.random()*0.10) / 10000) * 10000;
                const date = `${ym.YYYY}-${ym.MM}-${String(rnd(1,ym.days)).padStart(2,'0')}`;
                sql += insertSQL('MGM_invoice_details', {
                    bu_no: bu, TX_type: 'AR', order_id: `SO${bu}${ym.YYYY}${ym.MM}${String(rnd(1,20)).padStart(3,'0')}`,
                    client_id: custs[rnd(0,custs.length-1)], invoice_no: `AR${bu}${ym.YYYY}${ym.MM}${String(i+1).padStart(3,'0')}`,
                    sub_amt: amt, tax_type: 'VAT', tax_rate: 13, VAT_amt: Math.round(amt*13/113),
                    wk_date: date, pay_date: Math.random() > 0.4 ? date : null, payment: Math.round(amt*(0.5+Math.random()*0.5)),
                    ageing_days: Math.max(0, Math.floor((new Date() - new Date(date)) / 86400000)),
                    DB_CR: 'CR', YYYY_MM: ym.YYYY_MM, remark: '銷貨發票'
                }) + '\n';
            }
            for (let i = 0; i < 5 + rnd(0,2); i++) {
                const amt = Math.round(s.sale_cost_amt * (0.05 + Math.random()*0.10) / 10000) * 10000;
                const date = `${ym.YYYY}-${ym.MM}-${String(rnd(1,ym.days)).padStart(2,'0')}`;
                sql += insertSQL('MGM_invoice_details', {
                    bu_no: bu, TX_type: 'AP', order_id: `PO${bu}${ym.YYYY}${ym.MM}${String(rnd(1,15)).padStart(3,'0')}`,
                    client_id: sups[rnd(0,sups.length-1)], invoice_no: `AP${bu}${ym.YYYY}${ym.MM}${String(i+1).padStart(3,'0')}`,
                    sub_amt: amt, tax_type: 'VAT', tax_rate: 13, VAT_amt: Math.round(amt*13/113),
                    wk_date: date, pay_date: Math.random() > 0.3 ? date : null, payment: Math.round(amt*(0.3+Math.random()*0.5)),
                    ageing_days: Math.max(0, Math.floor((new Date() - new Date(date)) / 86400000)),
                    DB_CR: 'DR', YYYY_MM: ym.YYYY_MM, remark: '進貨發票'
                }) + '\n';
            }
        }
    }
    sql += `\n`;

    // === 4. 現金 ===
    sql += `-- === 現金日記帳 (MGM_casher_details) ===\n`;
    const cashIn = [['銷貨收入','現金',0.06],['應收款收回','銀行',0.12],['匯兌收益','銀行',0.008],['利息收入','銀行',0.005]];
    const cashOut = [['原料採購','銀行',0.08],['工資','銀行',0.05],['房租水電','銀行',0.025],['差旅費','現金',0.012],['廣告費','銀行',0.015],['設備維修','銀行',0.01]];
    for (const bu of BUS) {
        for (const ym of MONTHS) {
            const s = buildSummary(bu, ym, MONTHS.indexOf(ym));
            let seq = 1;
            for (const [name, client, factor] of cashIn) {
                const amt = Math.round(s.sale_amt * factor * (0.8 + Math.random()*0.4));
                const date = `${ym.YYYY}-${ym.MM}-${String(rnd(1,ym.days)).padStart(2,'0')}`;
                sql += insertSQL('MGM_casher_details', {
                    bu_no: bu, amt_type: name, client_id: client,
                    num_vman: `CV${bu}${ym.YYYY}${ym.MM}${String(seq++).padStart(2,'0')}`,
                    sub_amt: amt, DB_CR: 'DR', YYYY: ym.YYYY, MM: ym.MM,
                    YYYY_MM: ym.YYYY_MM, wk_date: date, remark: name
                }) + '\n';
            }
            for (const [name, client, factor] of cashOut) {
                const base = ['原料採購','工資','房租水電'].includes(name) ? s.sale_cost_amt : s.sale_amt;
                const amt = Math.round(base * factor * (0.8 + Math.random()*0.4));
                const date = `${ym.YYYY}-${ym.MM}-${String(rnd(1,ym.days)).padStart(2,'0')}`;
                sql += insertSQL('MGM_casher_details', {
                    bu_no: bu, amt_type: name, client_id: client,
                    num_vman: `CV${bu}${ym.YYYY}${ym.MM}${String(seq++).padStart(2,'0')}`,
                    sub_amt: amt, DB_CR: 'CR', YYYY: ym.YYYY, MM: ym.MM,
                    YYYY_MM: ym.YYYY_MM, wk_date: date, remark: name
                }) + '\n';
            }
        }
    }
    sql += `\n`;

    // === 5. AR/AP 彙總 ===
    sql += `-- === AR/AP 彙總 (ERMM_ARAP_detail) ===\n`;
    for (const bu of BUS) {
        for (const ym of MONTHS) {
            const s = buildSummary(bu, ym, MONTHS.indexOf(ym));
            sql += insertSQL('ERMM_ARAP_detail', {
                bu_no: bu, YYYY: ym.YYYY, YYYY_MM: ym.YYYY_MM,
                AR_amt: Math.round(s.AR_amt/3), AP_amt: Math.round(s.AP_amt/3),
                AR_ageing: Math.round(s.AR_amt/10), AP_ageing: Math.round(s.AP_amt/10), batch_id: 'MANUAL'
            }) + '\n';
        }
    }
    sql += `\n`;

    // === 6. 付款 ===
    sql += `-- === 付款明細 (pay_detail) ===\n`;
    const payItems = [
        ['國家稅務局','稅金',0.013],['勞動社會保障局','勞保',0.01],['房租管理公司','房租',0.008],
        ['鋼材供應商A','原料款',0.045],['塑膠原料B','原料款',0.03],['電子零組件C','原料款',0.025]
    ];
    for (const bu of BUS) {
        for (const ym of MONTHS) {
            const s = buildSummary(bu, ym, MONTHS.indexOf(ym));
            for (let i = 0; i < payItems.length; i++) {
                const [sup, finance, factor] = payItems[i];
                const amt = Math.round(s.sale_amt * factor / 1000) * 1000;
                const invDate = `${ym.YYYY}-${ym.MM}-${String(rnd(1,10)).padStart(2,'0')}`;
                const paid = i % 3 === 0;
                sql += insertSQL('pay_detail', {
                    bu_no: bu, supplier_name: sup, finance_type: finance,
                    should_date: `${ym.YYYY}-${ym.MM}-25`, invoice_date: invDate,
                    amount: amt, currency_ab: 'RMB',
                    invoice_num: `INV${bu}${ym.YYYY}${ym.MM}${String(i+1).padStart(2,'0')}`,
                    pay_date: paid ? `${ym.YYYY}-${ym.MM}-${String(rnd(15,ym.days)).padStart(2,'0')}` : null,
                    expense_content: finance, remark: sup, entry_date: invDate, data_year: ym.YYYY
                }) + '\n';
            }
        }
    }
    sql += `\n`;

    // === 7. 票據 ===
    sql += `-- === 票據 (check_detail) ===\n`;
    const banks = ['中國工商銀行','中國建設銀行','中國農業銀行','交通銀行'];
    const payeeList = ['供應商甲','供應商乙','房東','稅務局','設備商'];
    for (const bu of BUS) {
        let seq = 1;
        for (const ym of MONTHS) {
            const s = buildSummary(bu, ym, MONTHS.indexOf(ym));
            const chkCount = 2 + rnd(0,2);
            for (let i = 0; i < chkCount; i++) {
                const amt = Math.round(s.sale_amt * (0.012 + Math.random()*0.025) / 1000) * 1000;
                const issueDay = rnd(3, 20);
                const dueDay = issueDay + rnd(15, 45);
                const realDueDay = Math.min(dueDay > ym.days ? dueDay - ym.days : dueDay, 28);
                const dueMonth = dueDay > ym.days ? (Number(ym.MM) % 12 + 1) : Number(ym.MM);
                const issue = `${ym.YYYY}-${ym.MM}-${String(issueDay).padStart(2,'0')}`;
                const due = `${ym.YYYY}-${String(dueMonth).padStart(2,'0')}-${String(realDueDay).padStart(2,'0')}`;
                const baseProb = MONTHS.indexOf(ym) === 0 ? 0.7 : (MONTHS.indexOf(ym) === 1 ? 0.5 : 0.3);
                sql += insertSQL('check_detail', {
                    bu_no: bu, check_type: ['轉帳支票','現金支票','本票'][i%3],
                    check_num: `CHK${bu}${ym.YYYY}${ym.MM}${String(seq++).padStart(4,'0')}`,
                    company_id: `COMP${bu}${rnd(1,5)}`, check_date: issue, due_date: due,
                    amount: amt, to_company: payeeList[rnd(0,payeeList.length-1)],
                    bank_acct: banks[rnd(0,3)],
                    status: Math.random() < baseProb ? '已兌現' : '未兌現', remark: '採購付款'
                }) + '\n';
            }
        }
    }
    sql += `\n`;

    // === 8. 貸款 ===
    sql += `-- === 銀行貸款 (MGM_bank_loan_details) ===\n`;
    for (const bu of BUS) {
        const s0 = buildSummary(bu, MONTHS[0], 0);
        const loans = [
            { loan_id: `LN${bu}2023A`, bank: banks[0], type: '短期借款', terms: 12, rate: 4.35, amt: Math.round(s0.loan_amt*0.4), rate2: 1, begin: '2024-01-15' },
            { loan_id: `LN${bu}2023B`, bank: banks[1], type: '短期借款', terms: 24, rate: 4.75, amt: Math.round(s0.loan_amt*0.35), rate2: 1, begin: '2024-03-01' },
            { loan_id: `LN${bu}2023C`, bank: banks[2], type: '遠期外匯', terms: 18, rate: 3.5, amt: Math.round(s0.loan_amt*0.25), rate2: 4.8, begin: '2024-05-20' },
        ];
        for (const l of loans) {
            const diff = Math.round(l.amt * (1 - l.rate2));
            sql += insertSQL('MGM_bank_loan_details', {
                bu_no: bu, YYYY: '2024', acct_no: `ACCT${bu}${rnd(100,999)}`,
                type1: '貸款', acct_amt: l.amt, unit: 'RMB',
                loan_id: l.loan_id, bank_id: l.bank, branch_id: '總行',
                loan_type: l.type, pay_terms: l.terms, terms_rate: 0, interest_rate: l.rate,
                begin_date: l.begin, end_date: '2025-12-31',
                pay_days: rnd(1,30), payback_amt: 0, loan_amt: l.amt,
                exchange_rate: l.rate2, last_paydate: '2024-08-01', next_paydate: '2024-09-01',
                status1: 'Active', loan_desc: `${l.type} - ${l.bank}`,
                diff_amt: diff, loss_flag: l.rate2 !== 1 && diff < 0 ? 'Y' : 'N'
            }) + '\n';
        }
    }
    sql += `\n`;

    // === 9. 預測 ===
    sql += `-- === 財務預測 (forecast_detail) ===\n`;
    for (const bu of BUS) {
        for (const ym of MONTHS) {
            const s = buildSummary(bu, ym, MONTHS.indexOf(ym));
            for (const [type, f] of [['銷售',1],['採購',0.55],['現金',0.12]]) {
                const forecast = Math.round(s.sale_amt * f * (0.92 + Math.random()*0.16));
                const actual = Math.round(s.sale_amt * f * (0.97 + Math.random()*0.08));
                sql += insertSQL('forecast_detail', {
                    bu_no: bu, YYYY_MM: ym.YYYY_MM, forecast_type: type,
                    forecast_amt: forecast, actual_amt: actual,
                    diff_amt: actual - forecast, remark: `${type}預測vs實際`
                }) + '\n';
            }
        }
    }
    sql += `\n`;

    // === 10. KPI ===
    sql += `-- === KPI 門檻 (MGM_KPI_desc) ===\n`;
    for (const bu of BUS) {
        const s = buildSummary(bu, MONTHS[2], 2);
        const totalAsset = Math.max(s.ttl_asset_amt, 1);
        const currentAsset = Math.max(s.LQ_asset_amt, 1);
        const currentDebet = Math.max(s.LQ_debet_amt, 1);
        const kpis = [
            ['K01','流動比率', Number((currentAsset/currentDebet).toFixed(4)), 1.5, 3.0, ''],
            ['K02','速動比率', Number(((currentAsset-s.stock_value_amt)/currentDebet).toFixed(4)), 0.8, 2.0, ''],
            ['K03','負債比', Number((s.debet_amt/totalAsset*100).toFixed(4)), 20, 60, '%'],
            ['K04','ROE', Number((s.net_profit_amt/Math.max(s.stockholder_amt,1)*100).toFixed(4)), 5, 20, '%'],
            ['K05','ROA', Number((s.net_profit_amt/totalAsset*100).toFixed(4)), 3, 12, '%'],
            ['K06','毛利率', Number((s.BIZ_major_margin_amt/Math.max(s.sale_amt,1)*100).toFixed(4)), 15, 45, '%'],
            ['K07','淨利率', Number((s.net_profit_amt/Math.max(s.sale_amt,1)*100).toFixed(4)), 5, 20, '%'],
            ['K08','借款比率', Number((s.loan_amt/totalAsset*100).toFixed(4)), 0, 25, '%'],
        ];
        for (const [id, name, val, low, high, unit] of kpis) {
            let color = 'YELLOW';
            if (val >= low && val <= high) color = 'GREEN';
            else if (val < low*0.7 || val > high*1.3) color = 'RED';
            sql += insertSQL('MGM_KPI_desc', {
                bu_no: bu, KPI_id: id, KPI_name: name,
                KPI1: low, KPI2: high, unit: unit, pct_type: 'asc',
                KPI_value: val, KPI_color: color, remark: `${name} 評估指標`
            }) + '\n';
        }
    }

    sql += `\nSET FOREIGN_KEY_CHECKS = 1;\n`;
    sql += `-- === 完成 ===\n`;

    const outPath = path.join(__dirname, 'seed_data.sql');
    fs.writeFileSync(outPath, sql, 'utf8');
    const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1);
    console.log(`✅ SQL 已生成: ${outPath} (${sizeKB} KB)`);

    // 显示统计
    const tables = sql.match(/INSERT INTO `(\w+)`/g) || [];
    const counts = {};
    for (const m of tables) {
        const t = m.match(/`(\w+)`/)[1];
        counts[t] = (counts[t] || 0) + 1;
    }
    console.log('\n📊 筆數統計:');
    for (const [t, c] of Object.entries(counts)) console.log(`  ${t.padEnd(30)} ${c}`);
    console.log(`  ${'合計'.padEnd(30)} ${tables.length}`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
