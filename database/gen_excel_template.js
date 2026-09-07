﻿﻿﻿/**
 * 生成 ERMM 系統離線匯入 Excel 模板 v2
 * 簡化結構: 每 Sheet = 標題行 + 欄位代碼行 + 樣例行
 * 這樣匯入腳本更容易定位
 */
const ExcelJS = require('exceljs');
const path = require('path');

const OUT = path.join(__dirname, 'finance_data_template.xlsx');

// sheets: [ sheetName, dbTable, [ [code, type, required, desc, example], ... ], [sampleRow, ...] ]
// type: text / number / decimal / date

const DATASHEETS = [
    {
        name: '01_財務摘要_summary',
        table: 'MGM_finance_summary',
        codes: [
            'bu_no','YYYY_MM','cash_amt','deposite_amt','interest_amt',
            'AR_amt','stock_P_amt','stock_M_amt','equipment_amt','acc_de_EQMT',
            'building_amt','intangible_amt','loan_amt','AP_amt','AP_tax_amt',
            'LT_loan_amt','captial_stock','captial_reserve','legal_reserve',
            'accumulated_amt','sale_amt','sale_cost_amt','sale_exp_amt',
            'MGM_EXP_amt','finance_EXP_amt','BIZ_major_margin_amt',
            'BIZ_margin_amt','operation_profit_amt','net_profit_amt','VAT_rate'
        ],
        desc: '核心樞紐表，所有報表的基礎資料',
        samples: [
            ['HM','2024/12',200000,5000000,50000,4391280,1563904,2146368,12519000,6259500,8200000,642000,4770571,1449122,1431375,2650317,5000000,500000,0,12410147,14637600,8050680,292752,439128,238529,4684032,3859999,3983863,2080975,13],
            ['HN','2024/12',50000,2000000,20000,1829700,600000,895000,5200000,2600000,3500000,200000,1500000,603801,57967,1000000,2000000,200000,0,5000000,4754160,2614788,95083,142625,77472,1523712,1259532,1315344,844304,13],
            ['SZ','2024/12',100000,3000000,30000,2927520,970000,1421626,7800000,3900000,5300000,350000,2500000,966082,92843,1500000,3000000,300000,0,7500000,7774920,4276206,155498,233248,126728,2498186,2062712,2173444,1412466,13],
        ]
    },
    {
        name: '02_現金日記帳_cash',
        table: 'MGM_casher_details',
        codes: ['bu_no','num_vman','wk_date','amt_type','DB_CR','sub_amt','bank_acct','remark'],
        desc: 'DB_CR: DR=收款 / CR=付款',
        samples: [
            ['HM','CVHM202412001','2024-12-25','銷貨收入','DR',881862,'HK0012','12月銷貨'],
            ['HM','CVHM202412002','2024-12-22','應收款收回','DR',1344704,'HK0012',''],
            ['HM','CVHM202412003','2024-12-20','原料採購','CR',652103,'HK0012',''],
            ['HM','CVHM202412004','2024-12-15','工資','CR',306237,'HK0012',''],
            ['HM','CVHM202412005','2024-12-10','房租水電','CR',210653,'HK0012',''],
            ['HN','CVHN202412001','2024-12-25','銷貨收入','DR',366061,'HK0012',''],
            ['HN','CVHN202412002','2024-12-20','工資','CR',162970,'HK0012',''],
            ['SZ','CVSZ202412001','2024-12-25','銷貨收入','DR',599439,'HK0012',''],
            ['SZ','CVSZ202412002','2024-12-20','工資','CR',295220,'HK0012',''],
        ]
    },
    {
        name: '03_發票明細_invoice',
        table: 'MGM_invoice_details',
        codes: ['bu_no','TX_type','invoice_no','wk_date','client_id','sub_amt','VAT_amt','tax_rate','pay_date','payment'],
        desc: 'TX_type: AR=銷項 / AP=進項',
        samples: [
            ['HM','AR','INV202412001','2024-12-15','客戶A',1061946,138053,13,'2024-12-28',1200000],
            ['HM','AR','INV202412002','2024-12-20','客戶B',353982,46018,13,'',''],
            ['HM','AP','INV202412003','2024-12-10','供應商X',672300,87400,13,'2024-12-20',759700],
            ['HN','AR','INV202412010','2024-12-18','客戶C',323947,42113,13,'',''],
            ['SZ','AR','INV202412020','2024-12-15','客戶D',527203,68536,13,'2024-12-30',400000],
        ]
    },
    {
        name: '04_付款明細_pay',
        table: 'pay_detail',
        codes: ['bu_no','supplier_name','finance_type','should_date','pay_date','amount','currency_ab','invoice_num','remark'],
        desc: 'pay_date 留空白=未付款',
        samples: [
            ['HM','工資','工資','2024-12-31','2024-12-20',306237,'HKD','','12月薪資'],
            ['HM','房東張','房租水電','2024-12-31','2024-12-25',210653,'HKD','',''],
            ['HM','原料商','原料採購','2024-12-20','2024-12-10',652103,'HKD','INV202412003',''],
            ['HN','工資','工資','2024-12-31','2024-12-22',162970,'HKD','',''],
            ['SZ','工資','工資','2024-12-31','2024-12-18',295220,'HKD','',''],
        ]
    },
    {
        name: '05_應收應付_arap',
        table: 'ermm_arap_detail',
        codes: ['bu_no','YYYY','YYYY_MM','AR_amt','AP_amt','AR_ageing','AP_ageing'],
        desc: '月底 AR/AP 彙總餘額',
        samples: [
            ['HM','2024','2024/12',4391280,1449122,200000,0],
            ['HN','2024','2024/12',1829700,603801,50000,0],
            ['SZ','2024','2024/12',2927520,966082,80000,0],
        ]
    },
    {
        name: '06_銀行貸款_bank',
        table: 'mgm_bank_loan_details',
        codes: ['bu_no','loan_id','bank_id','loan_type','loan_amt','pay_terms','terms_rate','begin_date','end_date','payback_amt','status1'],
        desc: 'status1: 使用中 / 已還清',
        samples: [
            ['HM','LOAN001','HSBC','信用貸款',2000000,12,5.25,'2024-01-01','2025-01-01',500000,'使用中'],
            ['HM','LOAN002','BOC','抵押貸款',5000000,36,4.75,'2024-06-01','2027-06-01',0,'使用中'],
            ['HN','LOAN003','HSBC','信用貸款',1000000,12,5.5,'2024-03-01','2025-03-01',300000,'使用中'],
        ]
    },
    {
        name: '07_票據管理_check',
        table: 'check_detail',
        codes: ['bu_no','check_num','check_type','check_date','due_date','amount','to_company','status'],
        desc: 'status: 未兌現 / 已兌現 / 作廢',
        samples: [
            ['HM','CHK001','轉帳支票','2024-12-01','2024-12-15',500000,'供應商X','未兌現'],
            ['HM','CHK002','現金支票','2024-12-10','2024-12-20',100000,'工資','已兌現'],
            ['HN','CHK003','轉帳支票','2024-12-05','2024-12-18',200000,'供應商Y','未兌現'],
        ]
    },
    {
        name: '08_財務預測_forecast',
        table: 'forecast_detail',
        codes: ['bu_no','YYYY_MM','forecast_type','forecast_amt','actual_amt'],
        desc: 'forecast_type: 銷售 / 採購 / 現金',
        samples: [
            ['HM','2024/12','銷售',15000000,14637600],
            ['HM','2024/12','採購',7000000,8050680],
            ['HM','2024/12','現金',10000000,9500000],
            ['HN','2024/12','銷售',5000000,4754160],
            ['SZ','2024/12','銷售',8000000,7774920],
        ]
    },
];

async function main() {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ERMM Finance Module';
    wb.created = new Date();

    // === 封面說明 ===
    const cover = wb.addWorksheet('說明_README');
    cover.columns = [{ width: 18 }, { width: 65 }];

    cover.getCell('A1').value = 'ERMM 財務模組 — 離線匯入操作手冊';
    cover.getCell('A1').font = { bold: true, size: 20, color: { argb: 'FF1A5276' } };
    cover.mergeCells('A1:B1');
    cover.getRow(1).height = 32;

    const sec = (label) => {
        const r = cover.addRow([label, '']);
        r.font = { bold: true, size: 13, color: { argb: 'FF1A5276' } };
        r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F8FF' } };
        return r;
    };

    cover.addRow([`版本`, 'v2.0']);
    cover.addRow([`更新日期`, new Date().toISOString().substring(0,10)]);
    cover.addRow([]);

    sec('【文件結構】');
    cover.addRow(['', '本檔共 9 個工作表，第 1 個為本說明頁：']);
    cover.addRow(['', '  01_財務摘要_summary — 核心樞紐表（必填，所有報表基礎）']);
    cover.addRow(['', '  02_現金日記帳_cash']);
    cover.addRow(['', '  03_發票明細_invoice']);
    cover.addRow(['', '  04_付款明細_pay']);
    cover.addRow(['', '  05_應收應付_arap']);
    cover.addRow(['', '  06_銀行貸款_bank']);
    cover.addRow(['', '  07_票據管理_check']);
    cover.addRow(['', '  08_財務預測_forecast']);
    cover.addRow([]);

    sec('【導入步驟】');
    cover.addRow(['1', '打開 finance_data_template.xlsx']);
    cover.addRow(['2', '依各 Sheet 的「欄位代碼」行對應的欄位，填入你的資料']);
    cover.addRow(['3', '保留第一行（欄位代碼）— 匯入腳本靠這一行識別']);
    cover.addRow(['4', '執行: node import_excel.js finance_data_template.xlsx']);
    cover.addRow(['5', '系統將自動比對欄位代碼 → DB 欄位，INSERT 或 ON DUPLICATE KEY UPDATE']);
    cover.addRow(['6', '匯入完成後，到系統「批次管線」頁面點「一鍵執行全部」重算損益/風險指標']);
    cover.addRow([]);

    sec('【公司別代碼 bu_no】');
    cover.addRow(['HM', '鴻明 Hong Ming']);
    cover.addRow(['HN', '鴻南 Hong Nan']);
    cover.addRow(['SZ', '深圳廠 Shenzhen']);
    cover.addRow([]);

    sec('【格式規範（重要！）】');
    cover.addRow(['日期', 'YYYY-MM-DD 格式（Excel 自動處理，不要手動加斜線）']);
    cover.addRow(['金額', '整數或小數皆可，不要加千分位逗號或 NT$ / HK$']);
    cover.addRow(['公司別', '英文大寫代碼：HM / HN / SZ']);
    cover.addRow(['年月', 'YYYY/MM（如 2024/12，用斜線分隔）']);
    cover.addRow(['DB_CR', '英文大寫：DR = 收款 / 資產增加，CR = 付款 / 負債增加']);
    cover.addRow(['TX_type', '英文大寫：AR = 銷項發票，AP = 進項發票']);
    cover.addRow(['空值', '留空白即可，不要填 0 除非真的是 0']);
    cover.addRow(['VAT_rate', '百分比數字，如 13 表示 13%']);
    cover.addRow([]);

    sec('【匯入順序建議】');
    cover.addRow(['', '1. 先匯 01_財務摘要（sale_amt / net_profit_amt / 資產負債欄位必填）']);
    cover.addRow(['', '2. 再匯 02~08 日常作業表']);
    cover.addRow(['', '3. 最後到系統批次管線重算全部']);
    cover.addRow([]);

    sec('【常見錯誤 Q&A】');
    cover.addRow(['Q1', '匯入後損益表全是 0？']);
    cover.addRow(['A', '檢查 01_財務摘要中 sale_amt / sale_cost_amt / net_profit_amt 三個欄位是否有值']);
    cover.addRow(['Q2', '現金日記賬顯示「-」？']);
    cover.addRow(['A', '檢查 DB_CR 是否正確填 DR / CR（英文大寫），sub_amt 是否有正數值']);
    cover.addRow(['Q3', '資產負債表不平衡？']);
    cover.addRow(['A', '資產總額 = 負債總額 + 股東權益；檢查 accumulated_amt + current_PL_amt + captial_stock + captial_reserve = stockholder_amt']);
    cover.addRow(['Q4', '匯入腳本報 Unknown column XXX？']);
    cover.addRow(['A', '你的 Excel 欄位代碼與 DB 欄位名不對，請對照 README 上的欄位清單']);
    cover.addRow(['Q5', '如何更新既有資料？']);
    cover.addRow(['A', '匯入腳本自動用 INSERT ... ON DUPLICATE KEY UPDATE，主鍵重複會覆蓋']);

    // === 資料表 Sheet ===
    for (const ds of DATASHEETS) {
        const ws = wb.addWorksheet(ds.name);

        // 第 1 行: 標題
        ws.mergeCells('A1:Z1');
        const title = ws.getCell('A1');
        title.value = `${ds.name.replace(/^\d+_/,'')} | DB 表: ${ds.table} | ${ds.desc}`;
        title.font = { bold: true, size: 13, color: { argb: 'FF1A5276' } };
        ws.getRow(1).height = 24;

        // 第 2 行: 欄位代碼 (匯入腳本識別用，勿改)
        const codeRow = ws.addRow(ds.codes);
        codeRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        codeRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C3E50' } };
        codeRow.alignment = { vertical: 'middle', horizontal: 'center' };
        ws.getRow(2).height = 22;

        // 第 3 行起: 樣例資料
        for (const sample of ds.samples) {
            const r = ws.addRow(sample);
            r.alignment = { vertical: 'middle' };
        }

        // 欄寬
        ws.columns = ds.codes.map((c, i) => ({ width: Math.max(12, c.length * 1.8) }));

        // 凍結前 2 行
        ws.views = [{ state: 'frozen', ySplit: 2 }];
    }

    await wb.xlsx.writeFile(OUT);
    console.log(`✅ 模板已生成: ${OUT}`);
    console.log(`   共 ${DATASHEETS.length + 1} 個 Sheet (含 README)`);
    const fs = require('fs');
    console.log(`   大小: ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`);
}

main().catch(err => { console.error(err); process.exit(1); });
