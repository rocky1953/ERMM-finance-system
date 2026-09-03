/**
 * 生成批次管線 7 步測試資料 Excel (2023/01)
 * 直接灌 DB 而不是走 import_excel.js（因為那些表不在原模板涵蓋範圍）
 * 輸出: database/batch_test_202301.xlsx
 */
const ExcelJS = require('exceljs');
const path = require('path');

const OUT = path.join(__dirname, 'batch_test_202301.xlsx');
const YM = '2023/01';
const YY = '2023';

// 3 BU 的測試資料倍率
const BU = [
  { bu_no: 'HM', mul: 1.0, desc: '鴻明' },
  { bu_no: 'HN', mul: 0.6, desc: '鴻南' },
  { bu_no: 'SZ', mul: 0.8, desc: '深圳廠' },
];

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ERMM Batch Test';
  wb.created = new Date();

  // ============================================================
  // Sheet 1: ERMM_temp_po — Step1 原始採購單（ERP 匯入暫存）
  // ============================================================
  const s1 = wb.addWorksheet('01_ERP_temp_po', { headerRowStyle: { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } } } });
  s1.columns = [
    { header: '公司別 bu_no', key: 'bu_no', width: 10 },
    { header: '採購單號 po_id', key: 'po_id', width: 18 },
    { header: '供應商 supplier_name', key: 'supplier_name', width: 22 },
    { header: '物料 xitems', key: 'xitems', width: 18 },
    { header: '採購日期 po_date', key: 'po_date', width: 14 },
    { header: '數量 po_qty', key: 'po_qty', width: 12 },
    { header: '單價(原幣) unit_price', key: 'unit_price', width: 16 },
    { header: '匯率 exchange_rate', key: 'exchange_rate', width: 14 },
    { header: '金額(原幣) po_amount', key: 'po_amount', width: 18 },
    { header: '稅額 vat_amt', key: 'vat_amt', width: 14 },
    { header: '批次 batch_id', key: 'batch_id', width: 16 },
  ];

  const suppliers = [
    { name: '中國鋼鐵', mat: '鋼板', price: 500, qty: 200 },
    { name: '台塑化學', mat: '塑膠粒', price: 80, qty: 1000 },
    { name: '香港電線', mat: '電線', price: 120, qty: 500 },
    { name: '五金供應商A', mat: '螺絲', price: 5, qty: 5000 },
    { name: '包材公司', mat: '紙箱', price: 15, qty: 2000 },
    { name: '日本零件商', mat: '軸承', price: 350, qty: 300 },
  ];

  let poSeq = 1;
  for (const b of BU) {
    for (const s of suppliers) {
      const qty = Math.round(s.qty * b.mul);
      const price = Math.round(s.price * b.mul * 100) / 100;
      const amount = Math.round(qty * price * 100) / 100;
      const vat = Math.round(amount * 0.13 * 100) / 100;
      const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0');
      s1.addRow({
        bu_no: b.bu_no,
        po_id: `PO2301${String(poSeq++).padStart(4, '0')}`,
        supplier_name: s.name,
        xitems: s.mat,
        po_date: new Date(2023, 0, parseInt(day)),
        po_qty: qty,
        unit_price: price,
        exchange_rate: s.name.includes('中國') || s.name.includes('台塑') || s.name.includes('日本') ? 1.0 : 1.0,
        po_amount: amount,
        vat_amt: vat,
        batch_id: `BATCH_202301`,
      });
    }
  }
  console.log(`  temp_po: ${s1.rowCount - 1} rows`);

  // ============================================================
  // Sheet 2: ERMM_erp_SO — Step6 銷售訂單（算 AR）
  // ============================================================
  const s2 = wb.addWorksheet('02_ERP_SO', { headerRowStyle: { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } } } });
  s2.columns = [
    { header: '公司別 bu_no', key: 'bu_no', width: 10 },
    { header: '訂單號 so_nbr', key: 'so_nbr', width: 18 },
    { header: '客戶 client_id', key: 'client_id', width: 18 },
    { header: '客戶名 client_name', key: 'client_name', width: 22 },
    { header: '物料 xitems', key: 'xitems', width: 14 },
    { header: '訂單日期 so_date', key: 'so_date', width: 14 },
    { header: '年度 YYYY', key: 'YYYY', width: 10 },
    { header: '月份 MM', key: 'MM', width: 10 },
    { header: '年月 YYYY_MM', key: 'YYYY_MM', width: 12 },
    { header: '出貨數 dn_qty', key: 'dn_qty', width: 12 },
    { header: '單價 unit_price', key: 'unit_price', width: 14 },
    { header: '狀態 status', key: 'status', width: 10 },
  ];

  const clients = [
    { id: 'C001', name: '和記黃埔', mat: '鋼製成品', price: 1200, qty: 300 },
    { id: 'C002', name: '長江實業', mat: '塑膠製品', price: 200, qty: 1500 },
    { id: 'C003', name: '新世界發展', mat: '電線組裝', price: 280, qty: 800 },
    { id: 'C004', name: '太古地產', mat: '五金套件', price: 45, qty: 8000 },
    { id: 'C005', name: '恆基兆業', mat: '精密組件', price: 800, qty: 400 },
  ];

  let soSeq = 1;
  for (const b of BU) {
    for (const c of clients) {
      const qty = Math.round(c.qty * b.mul);
      const price = Math.round(c.price * b.mul * 100) / 100;
      const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0');
      s2.addRow({
        bu_no: b.bu_no,
        so_nbr: `SO2301${String(soSeq++).padStart(4, '0')}`,
        client_id: c.id,
        client_name: c.name,
        xitems: c.mat,
        so_date: new Date(2023, 0, parseInt(day)),
        YYYY: '2023',
        MM: '01',
        YYYY_MM: YM,
        dn_qty: qty,
        unit_price: price,
        status: '已交付',
      });
    }
  }
  console.log(`  erp_SO: ${s2.rowCount - 1} rows`);

  // ============================================================
  // Sheet 3: e2_xitems_daily_status — Step5 庫存明細（算減值）
  // ============================================================
  const s3 = wb.addWorksheet('03_庫存明細_xitems', { headerRowStyle: { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } } } });
  s3.columns = [
    { header: '公司別 bu_no', key: 'bu_no', width: 10 },
    { header: '物料 xitems', key: 'xitems', width: 16 },
    { header: '物料名 item_name', key: 'item_name', width: 20 },
    { header: '結存 qty_balance', key: 'qty_balance', width: 14 },
    { header: '單價 unit_price', key: 'unit_price', width: 14 },
    { header: '匯率 exchange_rate', key: 'exchange_rate', width: 14 },
    { header: '陳齡天 ageing_days', key: 'ageing_days', width: 14 },
    { header: '庫存日期 stock_date', key: 'stock_date', width: 14 },
  ];

  // ageing 分佈: 正常(0-30天), 輕微(31-90), 顯著(91-180), 嚴重(181-365), 陳廢(>365)
  const stockItems = [
    { mat: '鋼板', name: '鍍鋅鋼板 2mm', price: 500, ageing: 15 },
    { mat: '塑膠粒', name: 'ABS 塑膠粒', price: 80, ageing: 45 },
    { mat: '電線', name: 'PVC 電線 2.5mm', price: 120, ageing: 120 },
    { mat: '螺絲', name: 'M8 不鏽鋼螺絲', price: 5, ageing: 200 },
    { mat: '紙箱', name: '5層瓦楞紙箱', price: 15, ageing: 400 },
    { mat: '軸承', name: 'SKF 軸承 6205', price: 350, ageing: 25 },
    { mat: '鋼製成品', name: '鋼結構組件', price: 1200, ageing: 60 },
    { mat: '塑膠製品', name: '塑膠外殼', price: 200, ageing: 150 },
    { mat: '精密組件', name: 'CNC 加工件', price: 800, ageing: 30 },
    { mat: '五金套件', name: '五金組裝包', price: 45, ageing: 95 },
  ];

  for (const b of BU) {
    for (const it of stockItems) {
      const qty = Math.round((300 + Math.random() * 2700) * b.mul);
      const price = Math.round(it.price * b.mul * 100) / 100;
      s3.addRow({
        bu_no: b.bu_no,
        xitems: it.mat,
        item_name: it.name,
        qty_balance: qty,
        unit_price: price,
        exchange_rate: 1.0,
        ageing_days: it.ageing,
        stock_date: new Date(2023, 0, 31),
      });
    }
  }
  console.log(`  xitems_daily: ${s3.rowCount - 1} rows`);

  // ============================================================
  // Sheet 4: cams_system_codes — Step2/5 系統參數
  // ============================================================
  const s4 = wb.addWorksheet('04_系統參數_codes', { headerRowStyle: { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } } } });
  s4.columns = [
    { header: '類型 code_type', key: 'code_type', width: 22 },
    { header: '代碼 code_value', key: 'code_value', width: 18 },
    { header: '數值 value_number1', key: 'value_number1', width: 16 },
    { header: '啟用 inuse_flag', key: 'inuse_flag', width: 14 },
    { header: '說明 remark', key: 'remark', width: 30 },
  ];

  const codes = [
    // 匯率 (Step 2 用)
    ['CURRENCY', 'HKD', 1.0, 'USE', '港幣基准'],
    ['CURRENCY', 'RMB', 1.08, 'USE', '人民幣匯率(2023/01)'],
    ['CURRENCY', 'USD', 7.82, 'USE', '美元匯率'],
    ['CURRENCY', 'EUR', 8.45, 'USE', '歐元匯率'],
    // 減值率 (Step 5 用)
    ['AGEING_STOCK', '31-90天', 5, 'USE', '庫存陳齡 31-90 天減值 5%'],
    ['AGEING_STOCK', '91-180天', 15, 'USE', '庫存陳齡 91-180 天減值 15%'],
    ['AGEING_STOCK', '181-365天', 30, 'USE', '庫存陳齡 181-365 天減值 30%'],
    ['AGEING_STOCK', '365天以上', 50, 'USE', '庫存陳齡超過 365 天減值 50%'],
  ];
  codes.forEach(c => s4.addRow({ code_type: c[0], code_value: c[1], value_number1: c[2], inuse_flag: c[3], remark: c[4] }));
  console.log(`  system_codes: ${s4.rowCount - 1} rows`);

  // ============================================================
  // Sheet 5: MGM_invoice_details — Step7 發票彙總
  // ============================================================
  const s5 = wb.addWorksheet('05_發票明細_invoice', { headerRowStyle: { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } } } });
  s5.columns = [
    { header: '公司別 bu_no', key: 'bu_no', width: 10 },
    { header: '類型 TX_type', key: 'TX_type', width: 10 },
    { header: '發票號 invoice_no', key: 'invoice_no', width: 18 },
    { header: '日期 wk_date', key: 'wk_date', width: 14 },
    { header: '年月 YYYY_MM', key: 'YYYY_MM', width: 12 },
    { header: '客戶/供應商 client_id', key: 'client_id', width: 20 },
    { header: '金額 sub_amt', key: 'sub_amt', width: 16 },
    { header: '稅額 VAT_amt', key: 'VAT_amt', width: 14 },
    { header: '稅率 tax_rate', key: 'tax_rate', width: 10 },
    { header: '付款日 pay_date', key: 'pay_date', width: 14 },
    { header: '已付 payment', key: 'payment', width: 14 },
  ];

  let invSeq = 1;
  for (const b of BU) {
    // AR (銷項)
    for (let i = 0; i < 4; i++) {
      const amt = Math.round((80000 + Math.random() * 120000) * b.mul);
      s5.addRow({
        bu_no: b.bu_no, TX_type: 'AR',
        invoice_no: `AR2301${String(invSeq++).padStart(4, '0')}`,
        wk_date: new Date(2023, 0, 10 + i * 4),
        YYYY_MM: YM,
        client_id: `客戶${String.fromCharCode(65 + i)}`,
        sub_amt: amt, VAT_amt: Math.round(amt * 0.13), tax_rate: 13,
        pay_date: i < 3 ? new Date(2023, 0, 28) : null,
        payment: i < 3 ? Math.round(amt * 1.13) : null,
      });
    }
    // AP (進項)
    for (let i = 0; i < 3; i++) {
      const amt = Math.round((50000 + Math.random() * 100000) * b.mul);
      s5.addRow({
        bu_no: b.bu_no, TX_type: 'AP',
        invoice_no: `AP2301${String(invSeq++).padStart(4, '0')}`,
        wk_date: new Date(2023, 0, 5 + i * 5),
        YYYY_MM: YM,
        client_id: `供應商${String.fromCharCode(88 + i)}`,
        sub_amt: amt, VAT_amt: Math.round(amt * 0.13), tax_rate: 13,
        pay_date: null, payment: null,
      });
    }
  }
  console.log(`  invoice: ${s5.rowCount - 1} rows`);

  // ============================================================
  // Sheet 6: MGM_casher_details — Step7 現金日記
  // ============================================================
  const s6 = wb.addWorksheet('06_現金日記_cash', { headerRowStyle: { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } } } });
  s6.columns = [
    { header: '公司別 bu_no', key: 'bu_no', width: 10 },
    { header: '憑證號 num_vman', key: 'num_vman', width: 18 },
    { header: '日期 wk_date', key: 'wk_date', width: 14 },
    { header: '年度 YYYY', key: 'YYYY', width: 10 },
    { header: '月份 MM', key: 'MM', width: 10 },
    { header: '年月 YYYY_MM', key: 'YYYY_MM', width: 12 },
    { header: '收支類型 amt_type', key: 'amt_type', width: 16 },
    { header: '借貸 DB_CR', key: 'DB_CR', width: 10 },
    { header: '金額 sub_amt', key: 'sub_amt', width: 16 },
    { header: '備註 remark', key: 'remark', width: 20 },
  ];

  let cvSeq = 1;
  for (const b of BU) {
    // 收入 DR (3-4 筆)
    const incomeEvents = [
      { type: '銷貨收入', amt: 200000 },
      { type: '應收款收回', amt: 150000 },
      { type: '利息收入', amt: 5000 },
      { type: '匯兌收益', amt: 3000 },
    ];
    for (const ev of incomeEvents) {
      s6.addRow({
        bu_no: b.bu_no, num_vman: `CV2301${String(cvSeq++).padStart(4, '0')}`,
        wk_date: new Date(2023, 0, 5 + Math.floor(Math.random() * 25)),
        YYYY: '2023', MM: '01', YYYY_MM: YM,
        amt_type: ev.type, DB_CR: 'DR',
        sub_amt: Math.round(ev.amt * b.mul), remark: '測試資料',
      });
    }
    // 支出 CR (4-5 筆)
    const expEvents = [
      { type: '原料採購', amt: 180000 },
      { type: '工資', amt: 120000 },
      { type: '房租水電', amt: 35000 },
      { type: '廣告費', amt: 20000 },
      { type: '利息支出', amt: 25000 },
    ];
    for (const ev of expEvents) {
      s6.addRow({
        bu_no: b.bu_no, num_vman: `CV2301${String(cvSeq++).padStart(4, '0')}`,
        wk_date: new Date(2023, 0, 3 + Math.floor(Math.random() * 27)),
        YYYY: '2023', MM: '01', YYYY_MM: YM,
        amt_type: ev.type, DB_CR: 'CR',
        sub_amt: Math.round(ev.amt * b.mul), remark: '測試資料',
      });
    }
  }
  console.log(`  cash: ${s6.rowCount - 1} rows`);

  // ============================================================
  // Sheet 7: MGM_finance_summary — Step7 目標表（先給初始值）
  // ============================================================
  const s7 = wb.addWorksheet('07_財務摘要_summary', { headerRowStyle: { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } } } });
  s7.columns = [
    { header: '公司別 bu_no', key: 'bu_no', width: 10 },
    { header: '年月 YYYY_MM', key: 'YYYY_MM', width: 12 },
    { header: '現金 cash_amt', key: 'cash_amt', width: 14 },
    { header: '銀行存款 deposite_amt', key: 'deposite_amt', width: 16 },
    { header: '應收利息 interest_amt', key: 'interest_amt', width: 14 },
    { header: '應收帳款 AR_amt', key: 'AR_amt', width: 16 },
    { header: '應收票據 AR_bill_amt', key: 'AR_bill_amt', width: 16 },
    { header: '製成品存貨 stock_P_amt', key: 'stock_P_amt', width: 18 },
    { header: '原料存貨 stock_M_amt', key: 'stock_M_amt', width: 16 },
    { header: '設備原值 equipment_amt', key: 'equipment_amt', width: 18 },
    { header: '累計折舊 acc_de_EQMT', key: 'acc_de_EQMT', width: 18 },
    { header: '房屋原值 building_amt', key: 'building_amt', width: 16 },
    { header: '短期借款 loan_amt', key: 'loan_amt', width: 16 },
    { header: '應付帳款 AP_amt', key: 'AP_amt', width: 16 },
    { header: '應付稅費 AP_tax_amt', key: 'AP_tax_amt', width: 16 },
    { header: '股本 captial_stock', key: 'captial_stock', width: 16 },
    { header: '資本公積 captial_reserve', key: 'captial_reserve', width: 16 },
    { header: '累積盈餘 accumulated_amt', key: 'accumulated_amt', width: 18 },
    { header: '銷貨收入 sale_amt', key: 'sale_amt', width: 16 },
    { header: '銷貨成本 sale_cost_amt', key: 'sale_cost_amt', width: 16 },
    { header: '營業毛利 BIZ_major_margin_amt', key: 'BIZ_major_margin_amt', width: 18 },
    { header: '淨利 net_profit_amt', key: 'net_profit_amt', width: 16 },
    { header: '增值稅 VAT_amt', key: 'VAT_amt', width: 14 },
  ];

  for (const b of BU) {
    const s = Math.round(10000000 * b.mul);
    s7.addRow({
      bu_no: b.bu_no, YYYY_MM: YM,
      cash_amt: Math.round(300000 * b.mul),
      deposite_amt: Math.round(4500000 * b.mul),
      interest_amt: Math.round(8000 * b.mul),
      AR_amt: null, // Step7 會回寫
      AR_bill_amt: null,
      stock_P_amt: null,
      stock_M_amt: null,
      equipment_amt: Math.round(12000000 * b.mul),
      acc_de_EQMT: Math.round(5500000 * b.mul),
      building_amt: Math.round(8000000 * b.mul),
      loan_amt: Math.round(4500000 * b.mul),
      AP_amt: null,
      AP_tax_amt: null,
      captial_stock: 5000000,
      captial_reserve: 500000,
      accumulated_amt: Math.round(8000000 * b.mul),
      sale_amt: Math.round(12000000 * b.mul),
      sale_cost_amt: Math.round(6500000 * b.mul),
      BIZ_major_margin_amt: Math.round(3500000 * b.mul),
      net_profit_amt: Math.round(1500000 * b.mul),
      VAT_amt: null,
    });
  }
  console.log(`  summary: ${s7.rowCount - 1} rows`);

  // 美化：每張表凍結標題列、加粗 Row2
  for (const ws of wb.worksheets) {
    ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 0 }];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    ws.getRow(1).height = 24;
  }

  await wb.xlsx.writeFile(OUT);
  console.log(`\n✅ Excel 已輸出: ${OUT}`);
  const fs = require('fs');
  const sz = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log(`   大小: ${sz} KB  |  Sheet 數: ${wb.worksheets.length}`);
}

main().catch(err => { console.error('❌', err); process.exit(1); });
