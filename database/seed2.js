/**
 * 種子資料產生腳本 v2
 * 日期範圍: 2024/09/01 ~ 2024/11/30 (3個月)
 * 公司別: HM, SZ, HN 各一份
 * 完全對齊 schema.sql 實際欄位
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const MONTHS = [
    { YYYY_MM: '2024/09', YYYY: '2024', MM: '09', days: 30 },
    { YYYY_MM: '2024/10', YYYY: '2024', MM: '10', days: 31 },
    { YYYY_MM: '2024/11', YYYY: '2024', MM: '11', days: 30 },
];
const BUS = ['HM', 'SZ', 'HN'];
const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function buildSummary(bu, ym, monthIdx) {
    const baseSale = { HM: 12000000, SZ: 8000000, HN: 5000000 }[bu];
    const growth = 1 + monthIdx * 0.07;
    const sale = Math.round(baseSale * growth);
    const vatRate = 13;
    const costRate = 0.55;
    const saleExpRate = 0.08;
    const mgmtExpRate = 0.06;
    const finExpRate = 0.02;

    const saleCost = Math.round(sale * costRate);
    const vat = Math.round(sale * vatRate / 113 * 100);
    const bizMajorMargin = sale - saleCost - vat;
    const saleExp = Math.round(sale * saleExpRate);
    const mgmtExp = Math.round(sale * mgmtExpRate);
    const otherInc = Math.round(sale * 0.01);
    const bizMargin = bizMajorMargin + otherInc - saleExp - mgmtExp;
    const finExp = Math.round(sale * finExpRate);
    const investProfit = Math.round(sale * 0.02);
    const subsidy = Math.round(sale * 0.015);
    const opProfit = bizMargin + investProfit + subsidy - finExp;
    const netProfit = Math.round(opProfit * 0.85);

    // 存貨
    const stockP = Math.round(saleCost * 0.20);
    const stockM = Math.round(saleCost * 0.15);
    const stockS = Math.round(saleCost * 0.05);
    const stockValue = stockP + stockM + stockS;
    const WIP_M = Math.round(saleCost * 0.05);
    const WIP_labor = Math.round(saleCost * 0.03);
    const WIP_EXP = Math.round(saleCost * 0.02);

    // 流動資產
    const ar = Math.round(sale * 0.30);
    const arBill = Math.round(sale * 0.05);
    const arTemp = Math.round(sale * 0.02);
    const deposit = Math.round(sale * 0.10);
    const prepayExp = Math.round(sale * 0.03);
    const prepayGoods = Math.round(saleCost * 0.05);
    const cash = Math.max(Math.round(sale * 0.15), 500000);

    const lqAsset = cash + deposit + ar + arBill + arTemp + stockValue + WIP_M + WIP_labor + WIP_EXP + prepayExp + prepayGoods;

    // 非流動資產
    const building = Math.round(baseSale * 0.8);
    const accDeBuilding = Math.round(building * 0.3);
    const equipment = Math.round(baseSale * 0.5);
    const accDeEqmt = Math.round(equipment * 0.4);
    const vehicle = Math.round(baseSale * 0.15);
    const accDeVehicle = Math.round(vehicle * 0.5);
    const office = Math.round(baseSale * 0.1);
    const accDeOffice = Math.round(office * 0.6);
    const intangible = Math.round(baseSale * 0.05);
    const fxAsset = (building - accDeBuilding) + (equipment - accDeEqmt) + (vehicle - accDeVehicle) + (office - accDeOffice) + intangible;

    const ttlAsset = lqAsset + fxAsset;

    // 負債
    const ap = Math.round(saleCost * 0.22);
    const apTax = Math.round(vat * 0.9);
    const apSalary = Math.round(sale * 0.05);
    const apOther = Math.round(sale * 0.02);
    const loan = Math.round(ttlAsset * 0.18);
    const ltLoan = Math.round(ttlAsset * 0.10);
    const lqDebet = ap + apTax + apSalary + apOther + loan;
    const ltDebet = ltLoan;
    const debetAmt = lqDebet + ltDebet;

    // 權益
    const capital = { HM: 5000000, SZ: 3000000, HN: 2000000 }[bu];
    const capitalReserve = Math.round(capital * 0.1);
    const accumulated = Math.round(netProfit * 0.3 * (monthIdx + 1));
    const retained = accumulated + Math.round(netProfit * 0.5);
    const stockholder = capital + capitalReserve + retained + netProfit;
    const ttlDebetAmt = debetAmt + stockholder;

    return {
        bu_no: bu, YYYY_MM: ym.YYYY_MM, YYYY: ym.YYYY, MM: ym.MM,
        sale_amt: sale, sale_cost_amt: saleCost, VAT_amt: vat, VAT_rate: vatRate,
        BIZ_major_margin_amt: bizMajorMargin,
        BIZ_margin_amt: bizMargin,
        BIZ_other_INC_amt: otherInc,
        sale_exp_amt: saleExp, MGM_EXP_amt: mgmtExp, finance_EXP_amt: finExp,
        INVEST_profit_amt: investProfit, AR_subsidy_amt: subsidy,
        operation_profit_amt: opProfit, net_profit_amt: netProfit,
        // 資產
        cash_amt: cash, deposite_amt: deposit,
        AR_amt: ar, AR_bill_amt: arBill, AR_temp_amt: arTemp,
        stock_P_amt: stockP, stock_M_amt: stockM, stock_S_amt: stockS, stock_value_amt: stockValue,
        WIP_M_amt: WIP_M, WIP_labor_amt: WIP_labor, WIP_EXP_amt: WIP_EXP,
        prepay_EXP_amt: prepayExp, prepay_goods_amt: prepayGoods,
        building_amt: building, acc_de_building: accDeBuilding,
        equipment_amt: equipment, acc_de_EQMT: accDeEqmt,
        vehicle_amt: vehicle, acc_de_vehicle: accDeVehicle,
        office_amt: office, acc_de_office: accDeOffice,
        intangible_amt: intangible,
        LQ_asset_amt: lqAsset, FX_asset_amt: fxAsset, ttl_asset_amt: ttlAsset,
        // 負債
        loan_amt: loan, AP_amt: ap, AP_tax_amt: apTax, AP_salary_amt: apSalary, AP_other_amt: apOther,
        LT_loan_amt: ltLoan, LT_debet_amt: ltDebet,
        LQ_debet_amt: lqDebet, debet_amt: debetAmt, ttl_debet_amt: ttlDebetAmt,
        // 權益
        captial_stock: capital, captial_reserve: capitalReserve,
        accumulated_amt: accumulated, retained_income_amt: retained,
        current_PL_amt: netProfit, stockholder_amt: stockholder
    };
}

async function main() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST, port: process.env.DB_PORT,
        user: process.env.DB_USER, password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME, waitForConnections: true,
        connectionLimit: 10, charset: 'utf8mb4', multipleStatements: true
    });
    console.log('✅ 連線成功');

    // === 0. 清理 ===
    console.log('🧹 清理舊資料...');
    const tables = ['forecast_detail','pay_detail','check_detail','ERMM_ARAP_detail',
                    'MGM_bank_loan_details','MGM_invoice_details','MGM_casher_details',
                    'MGM_finance_summary','MGM_KPI_desc','BH_MGM_TX_detail'];
    for (const t of tables) {
        try { await pool.execute(`DELETE FROM ${t} WHERE bu_no IN (?,?,?)`, BUS); } catch(e) {}
    }
    console.log('✅ 清理完成');

    // === 1. 財務摘要 (每月 1 筆) ===
    console.log('\n📋 寫入財務摘要 (3 BU x 3 月 = 9 筆)...');
    for (const bu of BUS) {
        for (let i = 0; i < MONTHS.length; i++) {
            const s = buildSummary(bu, MONTHS[i], i);
            const cols = Object.keys(s).join(',');
            const ph = Object.keys(s).map(() => '?').join(',');
            await pool.execute(
                `INSERT INTO MGM_finance_summary (${cols}) VALUES (${ph})
                 ON DUPLICATE KEY UPDATE ${cols.split(',').map(c=>c+'=VALUES('+c+')').join(',')}`,
                Object.values(s)
            );
        }
    }

    // === 2. 發票明細 (AR/AP) ===
    console.log('🧾 寫入發票明細...');
    const custs = ['華東經銷商','華南經銷商','出口日本','出口歐洲','香港總公司'];
    const sups = ['鋼材供應商A','塑膠原料B','電子零組件C','包裝材料D','能源供應E'];
    let invCnt = 0;
    for (const bu of BUS) {
        for (const ym of MONTHS) {
            const s = buildSummary(bu, ym, MONTHS.indexOf(ym));
            // AR ~ 8-10 張/月
            const arCount = 8 + rnd(0,2);
            for (let i = 0; i < arCount; i++) {
                const amt = Math.round(s.sale_amt * (0.04 + Math.random()*0.10) / 10000) * 10000;
                const date = `${ym.YYYY}-${ym.MM}-${String(rnd(1,ym.days)).padStart(2,'0')}`;
                const invNo = `AR${bu}${ym.YYYY}${ym.MM}${String(i+1).padStart(3,'0')}`;
                const daysSince = Math.floor((new Date() - new Date(date)) / 86400000);
                const payment = Math.round(amt * (0.3 + Math.random() * 0.6));
                await pool.execute(
                    `INSERT INTO MGM_invoice_details (bu_no, TX_type, order_id, client_id, invoice_no, sub_amt, tax_type, tax_rate, VAT_amt, wk_date, pay_date, payment, ageing_days, DB_CR, YYYY_MM, remark)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                    [bu, 'AR', `SO${bu}${ym.YYYY}${ym.MM}${String(rnd(1,20)).padStart(3,'0')}`,
                     custs[rnd(0,custs.length-1)], invNo, amt, 'VAT', 13, Math.round(amt*13/113),
                     date, payment >= amt ? date : null, payment, Math.max(0, daysSince), 'CR', ym.YYYY_MM, '銷貨發票']
                );
                invCnt++;
            }
            // AP ~ 5-7 張/月
            const apCount = 5 + rnd(0,2);
            for (let i = 0; i < apCount; i++) {
                const amt = Math.round(s.sale_cost_amt * (0.05 + Math.random()*0.10) / 10000) * 10000;
                const date = `${ym.YYYY}-${ym.MM}-${String(rnd(1,ym.days)).padStart(2,'0')}`;
                const invNo = `AP${bu}${ym.YYYY}${ym.MM}${String(i+1).padStart(3,'0')}`;
                const daysSince = Math.floor((new Date() - new Date(date)) / 86400000);
                const payment = Math.round(amt * (0.2 + Math.random() * 0.5));
                await pool.execute(
                    `INSERT INTO MGM_invoice_details (bu_no, TX_type, order_id, client_id, invoice_no, sub_amt, tax_type, tax_rate, VAT_amt, wk_date, pay_date, payment, ageing_days, DB_CR, YYYY_MM, remark)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                    [bu, 'AP', `PO${bu}${ym.YYYY}${ym.MM}${String(rnd(1,15)).padStart(3,'0')}`,
                     sups[rnd(0,sups.length-1)], invNo, amt, 'VAT', 13, Math.round(amt*13/113),
                     date, payment >= amt ? date : null, payment, Math.max(0, daysSince), 'DR', ym.YYYY_MM, '進貨發票']
                );
                invCnt++;
            }
        }
    }
    console.log(`✅ 發票 ${invCnt} 筆`);

    // === 3. 現金日記帳 ===
    console.log('💵 寫入現金日記帳...');
    const cashInTypes = [['銷貨收入','現金'],['應收款收回','銀行'],['匯兌收益','銀行'],['利息收入','銀行']];
    const cashOutTypes = [['原料採購','銀行'],['工資','銀行'],['房租水電','銀行'],['差旅費','現金'],['廣告費','銀行'],['設備維修','銀行']];
    let cashCnt = 0;
    for (const bu of BUS) {
        for (const ym of MONTHS) {
            const s = buildSummary(bu, ym, MONTHS.indexOf(ym));
            // 收入 DR
            for (let k = 0; k < cashInTypes.length; k++) {
                const factor = [0.06, 0.12, 0.008, 0.005][k];
                const amt = Math.round(s.sale_amt * factor * (0.8 + Math.random()*0.4));
                const date = `${ym.YYYY}-${ym.MM}-${String(rnd(1,ym.days)).padStart(2,'0')}`;
                await pool.execute(
                    `INSERT INTO MGM_casher_details (bu_no, amt_type, client_id, num_vman, sub_amt, DB_CR, YYYY, MM, YYYY_MM, wk_date, remark)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
                    [bu, cashInTypes[k][0], cashInTypes[k][1], `CV${bu}${ym.YYYY}${ym.MM}${String(k+1).padStart(2,'0')}`,
                     amt, 'DR', ym.YYYY, ym.MM, ym.YYYY_MM, date, cashInTypes[k][0]]
                );
                cashCnt++;
            }
            // 支出 CR
            for (let k = 0; k < cashOutTypes.length; k++) {
                const factor = [0.08, 0.05, 0.025, 0.012, 0.015, 0.01][k];
                const base = k < 3 ? s.sale_cost_amt : s.sale_amt;
                const amt = Math.round(base * factor * (0.8 + Math.random()*0.4));
                const date = `${ym.YYYY}-${ym.MM}-${String(rnd(1,ym.days)).padStart(2,'0')}`;
                await pool.execute(
                    `INSERT INTO MGM_casher_details (bu_no, amt_type, client_id, num_vman, sub_amt, DB_CR, YYYY, MM, YYYY_MM, wk_date, remark)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
                    [bu, cashOutTypes[k][0], cashOutTypes[k][1], `CV${bu}${ym.YYYY}${ym.MM}${String(k+10).padStart(2,'0')}`,
                     amt, 'CR', ym.YYYY, ym.MM, ym.YYYY_MM, date, cashOutTypes[k][0]]
                );
                cashCnt++;
            }
        }
    }
    console.log(`✅ 現金 ${cashCnt} 筆`);

    // === 4. AR/AP 彙總 (每月 1 筆) ===
    console.log('📐 寫入 AR/AP 彙總...');
    let arapCnt = 0;
    for (const bu of BUS) {
        for (const ym of MONTHS) {
            const s = buildSummary(bu, ym, MONTHS.indexOf(ym));
            await pool.execute(
                `INSERT INTO ERMM_ARAP_detail (bu_no, YYYY, YYYY_MM, AR_amt, AP_amt, AR_ageing, AP_ageing, batch_id)
                 VALUES (?,?,?,?,?,?,?,?)`,
                [bu, ym.YYYY, ym.YYYY_MM, Math.round(s.AR_amt/3), Math.round(s.AP_amt/3),
                 Math.round(s.AR_amt/10), Math.round(s.AP_amt/10), 'MANUAL']
            );
            arapCnt++;
        }
    }
    console.log(`✅ AR/AP ${arapCnt} 筆`);

    // === 5. 付款明細 ===
    console.log('💳 寫入付款明細...');
    const payItems = [
        { supplier: '國家稅務局', finance: '稅金', factor: 0.013, currency: 'RMB' },
        { supplier: '勞動社會保障局', finance: '勞保', factor: 0.01, currency: 'RMB' },
        { supplier: '房租管理公司', finance: '房租', factor: 0.008, currency: 'RMB' },
        { supplier: '鋼材供應商A', finance: '原料款', factor: 0.045, currency: 'RMB' },
        { supplier: '塑膠原料B', finance: '原料款', factor: 0.03, currency: 'RMB' },
        { supplier: '電子零組件C', finance: '原料款', factor: 0.025, currency: 'RMB' },
    ];
    let payCnt = 0;
    for (const bu of BUS) {
        for (const ym of MONTHS) {
            const s = buildSummary(bu, ym, MONTHS.indexOf(ym));
            for (let i = 0; i < payItems.length; i++) {
                const item = payItems[i];
                const amt = Math.round(s.sale_amt * item.factor / 1000) * 1000;
                const invDate = `${ym.YYYY}-${ym.MM}-${String(rnd(1,10)).padStart(2,'0')}`;
                const shouldDate = `${ym.YYYY}-${ym.MM}-25`;
                const paid = i % 3 === 0;
                const payDate = paid ? `${ym.YYYY}-${ym.MM}-${String(rnd(15,ym.days)).padStart(2,'0')}` : null;
                await pool.execute(
                    `INSERT INTO pay_detail (bu_no, supplier_name, finance_type, should_date, invoice_date, amount, currency_ab, invoice_num, pay_date, expense_content, remark, entry_date, data_year)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                    [bu, item.supplier, item.finance, shouldDate, invDate, amt, item.currency,
                     `INV${bu}${ym.YYYY}${ym.MM}${String(i+1).padStart(2,'0')}`,
                     payDate, item.finance, item.supplier, invDate, ym.YYYY]
                );
                payCnt++;
            }
        }
    }
    console.log(`✅ 付款 ${payCnt} 筆`);

    // === 6. 票據 ===
    console.log('📝 寫入票據...');
    const banks = ['中國工商銀行','中國建設銀行','中國農業銀行','交通銀行'];
    const payeeList = ['供應商甲','供應商乙','房東','稅務局','設備商'];
    let chkCnt = 0;
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
                const dueYear = dueDay > ym.days && Number(ym.MM) === 12 ? ym.YYYY : ym.YYYY;
                const issue = `${ym.YYYY}-${ym.MM}-${String(issueDay).padStart(2,'0')}`;
                const due = `${dueYear}-${String(dueMonth).padStart(2,'0')}-${String(realDueDay).padStart(2,'0')}`;
                // 越近的月份越可能已兌現
                const baseProb = MONTHS.indexOf(ym) === 0 ? 0.7 : (MONTHS.indexOf(ym) === 1 ? 0.5 : 0.3);
                const status = Math.random() < baseProb ? '已兌現' : '未兌現';
                await pool.execute(
                    `INSERT INTO check_detail (bu_no, check_type, check_num, company_id, check_date, due_date, amount, to_company, bank_acct, status, remark)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
                    [bu, i===0?'轉帳支票':(i===1?'現金支票':'本票'),
                     `CHK${bu}${ym.YYYY}${ym.MM}${String(seq++).padStart(4,'0')}`,
                     `COMP${bu}${rnd(1,5)}`, issue, due, amt,
                     payeeList[rnd(0,payeeList.length-1)], banks[rnd(0,3)], status, '採購付款']
                );
                chkCnt++;
            }
        }
    }
    console.log(`✅ 票據 ${chkCnt} 筆`);

    // === 7. 銀行貸款 ===
    console.log('🏦 寫入銀行貸款...');
    let loanCnt = 0;
    for (const bu of BUS) {
        const s0 = buildSummary(bu, MONTHS[0], 0);
        const loans = [
            { loan_id: `LN${bu}2023A`, bank: banks[0], type: '短期借款', terms: 12, rate: 4.35, amt: Math.round(s0.loan_amt*0.4), rate2: 1, begin: '2024-01-15' },
            { loan_id: `LN${bu}2023B`, bank: banks[1], type: '短期借款', terms: 24, rate: 4.75, amt: Math.round(s0.loan_amt*0.35), rate2: 1, begin: '2024-03-01' },
            { loan_id: `LN${bu}2023C`, bank: banks[2], type: '遠期外匯', terms: 18, rate: 3.5, amt: Math.round(s0.loan_amt*0.25), rate2: 4.8, begin: '2024-05-20' },
        ];
        for (const l of loans) {
            const diff = Math.round(l.amt * (1 - l.rate2));
            await pool.execute(
                `INSERT INTO MGM_bank_loan_details (bu_no, YYYY, acct_no, type1, acct_amt, unit, loan_id, bank_id, branch_id, loan_type, pay_terms, terms_rate, interest_rate, begin_date, end_date, pay_days, payback_amt, loan_amt, exchange_rate, last_paydate, next_paydate, status1, loan_desc, diff_amt, loss_flag)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [bu, '2024', `ACCT${bu}${rnd(100,999)}`, '貸款', l.amt, 'RMB', l.loan_id, l.bank, '總行', l.type, l.terms, 0, l.rate,
                 l.begin, '2025-12-31', rnd(1,30), 0, l.amt, l.rate2, '2024-08-01', '2024-09-01', 'Active',
                 `${l.type} - ${l.bank}`, diff, l.rate2 !== 1 && diff < 0 ? 'Y' : 'N']
            );
            loanCnt++;
        }
    }
    console.log(`✅ 貸款 ${loanCnt} 筆`);

    // === 8. 財務預測 (每月一筆 forecast + actual) ===
    console.log('🔮 寫入預測明細...');
    let fcCnt = 0;
    for (const bu of BUS) {
        for (const ym of MONTHS) {
            const s = buildSummary(bu, ym, MONTHS.indexOf(ym));
            for (const [type, f] of [['銷售', 1], ['採購', 0.55], ['現金', 0.12]]) {
                const forecast = Math.round(s.sale_amt * f * (0.92 + Math.random()*0.16));
                const actual = Math.round(s.sale_amt * f * (0.97 + Math.random()*0.08));
                await pool.execute(
                    `INSERT INTO forecast_detail (bu_no, YYYY_MM, forecast_type, forecast_amt, actual_amt, diff_amt, remark)
                     VALUES (?,?,?,?,?,?,?)`,
                    [bu, ym.YYYY_MM, type, forecast, actual, actual - forecast, `${type}預測vs實際`]
                );
                fcCnt++;
            }
        }
    }
    console.log(`✅ 預測 ${fcCnt} 筆`);

    // === 9. KPI 門檻 + 當前值 ===
    console.log('🔔 寫入 KPI...');
    let kpiCnt = 0;
    for (const bu of BUS) {
        const s = buildSummary(bu, MONTHS[2], 2);
        const totalAsset = Math.max(s.ttl_asset_amt, 1);
        const currentAsset = Math.max(s.LQ_asset_amt, 1);
        const currentDebet = Math.max(s.LQ_debet_amt, 1);
        const loanAmt = Math.max(s.loan_amt, 1);

        const currentRatio = Number((currentAsset / currentDebet).toFixed(4));
        const quickRatio = Number(((currentAsset - Math.max(s.stock_value_amt, 0)) / currentDebet).toFixed(4));
        const debtRatio = Number((s.debet_amt / totalAsset * 100).toFixed(4));
        const ROE = Number((s.net_profit_amt / Math.max(s.stockholder_amt, 1) * 100).toFixed(4));
        const ROA = Number((s.net_profit_amt / totalAsset * 100).toFixed(4));
        const grossMargin = Number((s.BIZ_major_margin_amt / Math.max(s.sale_amt, 1) * 100).toFixed(4));
        const netMargin = Number((s.net_profit_amt / Math.max(s.sale_amt, 1) * 100).toFixed(4));
        const loanRatio = Number((loanAmt / totalAsset * 100).toFixed(4));

        const kpis = [
            { id: 'K01', name: '流動比率', v: currentRatio,  low: 1.5,   high: 3.0,  unit: '' },
            { id: 'K02', name: '速動比率', v: quickRatio,    low: 0.8,   high: 2.0,  unit: '' },
            { id: 'K03', name: '負債比',   v: debtRatio,     low: 50,    high: 70,   unit: '%' },
            { id: 'K04', name: 'ROE',     v: ROE,          low: 5,     high: 20,   unit: '%' },
            { id: 'K05', name: 'ROA',     v: ROA,          low: 3,     high: 12,   unit: '%' },
            { id: 'K06', name: '毛利率',   v: grossMargin,   low: 15,    high: 45,   unit: '%' },
            { id: 'K07', name: '淨利率',   v: netMargin,     low: 5,     high: 20,   unit: '%' },
            { id: 'K08', name: '借款比率', v: loanRatio,     low: 0,     high: 25,   unit: '%' },
        ];
        for (const k of kpis) {
            let color = 'YELLOW';
            if (k.v >= k.low && k.v <= k.high) color = 'GREEN';
            else if (k.v < k.low * 0.7 || k.v > k.high * 1.3) color = 'RED';
            await pool.execute(
                `INSERT INTO MGM_KPI_desc (bu_no, KPI_id, KPI_name, KPI1, KPI2, unit, pct_type, KPI_value, KPI_color, remark)
                 VALUES (?,?,?,?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE KPI1=VALUES(KPI1), KPI2=VALUES(KPI2), KPI_value=VALUES(KPI_value), KPI_color=VALUES(KPI_color)`,
                [bu, k.id, k.name, k.low, k.high, k.unit, 'asc', k.v, color, `${k.name} 評估指標`]
            );
            kpiCnt++;
        }
    }
    console.log(`✅ KPI ${kpiCnt} 筆`);

    console.log('\n🎉 全部完成！驗證中...');
    const counts = {};
    for (const t of ['MGM_finance_summary','MGM_invoice_details','MGM_casher_details','ERMM_ARAP_detail',
                     'pay_detail','check_detail','MGM_bank_loan_details','forecast_detail','MGM_KPI_desc']) {
        const [r] = await pool.execute(`SELECT COUNT(*) as cnt FROM ${t} WHERE bu_no IN (?,?,?)`, BUS);
        counts[t] = r[0].cnt;
    }
    console.table(counts);
    await pool.end();
}

main().catch(e => { console.error('❌ 錯誤:', e.message); console.error(e.stack); process.exit(1); });
