/**
 * seed_po_so_2025.js
 * 生成 2025 年 3 公司的採購單 PO + 銷售訂單 SO 測試資料
 * 
 * 關聯邏輯：
 *   SO 總金額 ≈ finance_summary.sale_amt × 0.85（訂單金額約為銷售額 85%）
 *   PO 總金額 ≈ casher_details 原料採購 × 1.05（原料成本 + 5% 雜項）
 * 
 * 命名規則：
 *   po_id  = "PO" + YYMM + 3碼序號  (PO2501001, PO2501002...)
 *   so_nbr = "SO" + YYMM + 3碼序號
 *   供應商 = ["供應商A","供應商B","供應商C","供應商D","供應商E"] 循環
 *   客戶   = ["客戶A","客戶B","客戶C","客戶D","客戶E","客戶F"] 循環
 *   xitems = PO: ["原料X","原料Y","原料Z","包裝材料","輔助配件"]
 *            SO: ["成品A","成品B","成品C","成品D","半成品A"]
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const SUPPLIERS = ['供應商A', '供應商B', '供應商C', '供應商D', '供應商E'];
const CLIENTS = ['客戶A', '客戶B', '客戶C', '客戶D', '客戶E', '客戶F'];
const PO_ITEMS = ['原料X', '原料Y', '原料Z', '包裝材料', '輔助配件'];
const SO_ITEMS = ['成品A', '成品B', '成品C', '成品D', '半成品A'];
const BATCH_ID = 'BATCH2025SEED';

function fmt(v) { return Number(v).toLocaleString(); }

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT||'3306'),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME
  });

  // 1. 先清空 2025 年的 PO/SO（避免與舊資料重複）
  console.log('🗑 清除 2025 年現有 PO/SO...');
  const [delSO] = await conn.execute("DELETE FROM ermm_erp_so WHERE YYYY_MM >= '2025/01' AND YYYY_MM <= '2025/12'");
  const [delPO] = await conn.execute("DELETE FROM ermm_erp_po WHERE YYYY_MM >= '2025/01' AND YYYY_MM <= '2025/12'");
  console.log('  清除 SO: ' + delSO.affectedRows + ' 筆, PO: ' + delPO.affectedRows + ' 筆');

  // 2. 讀取 finance_summary（sale_amt 基準）
  const [summary] = await conn.execute(`
    SELECT bu_no, YYYY_MM, sale_amt
    FROM MGM_finance_summary
    WHERE YYYY_MM >= '2025/01' AND YYYY_MM <= '2025/12'
    ORDER BY bu_no, YYYY_MM
  `);
  console.log('\n📈 finance_summary sale_amt 基準:');
  summary.forEach(r => console.log('  ' + r.bu_no + ' ' + r.YYYY_MM + ': ' + fmt(r.sale_amt)));

  // 3. 讀取 casher_details 原料採購金額（PO 基準）
  const [rawPO] = await conn.execute(`
    SELECT bu_no, YYYY_MM, SUM(sub_amt) as raw_po_amt
    FROM mgm_casher_details
    WHERE DB_CR='CR' AND amt_type='原料採購' AND YYYY_MM >= '2025/01'
    GROUP BY bu_no, YYYY_MM
    ORDER BY bu_no, YYYY_MM
  `);
  console.log('\n📦 casher 原料採購基準:');
  rawPO.forEach(r => console.log('  ' + r.bu_no + ' ' + r.YYYY_MM + ': ' + fmt(r.raw_po_amt)));

  // 建立 PO 基準字典
  const poBase = {};
  rawPO.forEach(r => { poBase[r.bu_no + '_' + r.YYYY_MM] = Number(r.raw_po_amt); });

  // 4. 生成 SO（銷售訂單）
  console.log('\n📝 生成 2025 SO...');
  let soCount = 0;
  for (const s of summary) {
    const bu = s.bu_no;
    const ym = s.YYYY_MM;
    const saleAmt = Number(s.sale_amt);
    const soTotal = Math.round(saleAmt * 0.85); // 訂單金額 = 銷售額 × 85%

    // 每個月 2-3 張 SO，按比例分配
    const numOrders = 2 + Math.floor(Math.random() * 2); // 2 或 3 張
    const baseAmount = Math.round(soTotal / numOrders);
    let remaining = soTotal;
    const year = ym.substring(0, 4);
    const month = ym.substring(5, 7);

    for (let i = 0; i < numOrders; i++) {
      const isLast = (i === numOrders - 1);
      const amt = isLast ? remaining : Math.round(baseAmount * (0.9 + Math.random() * 0.2));
      if (isLast) { remaining = amt; } else { remaining -= amt; }

      const qty = Math.round(amt / (50000 + Math.random() * 30000)); // 50K-80K 單價級距
      const unitPrice = qty > 0 ? Number((amt / qty).toFixed(2)) : 0;
      const clientIdx = (parseInt(month) - 1 + i) % CLIENTS.length;
      const itemIdx = (parseInt(month) - 1 + i) % SO_ITEMS.length;
      const day = 10 + i * 4 + Math.floor(Math.random() * 3);
      const soDate = `${year}-${month}-${String(day).padStart(2,'0')}`;
      const soNbr = 'SO' + year.substring(2) + month + String(i + 1).padStart(3, '0');
      const dnQty = qty > 0 ? Number((qty * (0.85 + Math.random() * 0.15)).toFixed(4)) : 0;

      const sql = `INSERT INTO ermm_erp_so
        (bu_no, so_nbr, client_id, client_name, xitems, so_date, so_qty, dn_qty,
         unit_price, YYYY, MM, YYYY_MM, status, create_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`;
      await conn.execute(sql, [
        bu, soNbr, CLIENTS[clientIdx], CLIENTS[clientIdx], SO_ITEMS[itemIdx],
        soDate, qty, dnQty, unitPrice,
        year, month, ym,
        dnQty >= qty * 0.95 ? '已交付' : (dnQty > 0 ? '部分交付' : '待交付')
      ]);
      soCount++;
    }
    console.log('  ✅ ' + bu + ' ' + ym + ': ' + numOrders + ' 張 SO, 總額=' + fmt(soTotal));
  }

  // 5. 生成 PO（採購單）
  console.log('\n📝 生成 2025 PO...');
  let poCount = 0;
  const buYearMonths = [];
  summary.forEach(s => {
    buYearMonths.push({ bu_no: s.bu_no, YYYY_MM: s.YYYY_MM });
  });

  for (const { bu_no: bu, YYYY_MM: ym } of buYearMonths) {
    const rawAmt = poBase[bu + '_' + ym] || 0;
    if (rawAmt <= 0) {
      console.log('  ⚠️ ' + bu + ' ' + ym + ': 無原料採購基準, 生成中...');
      continue;
    }
    const poTotal = Math.round(rawAmt * 1.05); // +5% 運費/稅
    const year = ym.substring(0, 4);
    const month = ym.substring(5, 7);

    const numOrders = 2 + Math.floor(Math.random() * 2);
    const baseAmount = Math.round(poTotal / numOrders);
    let remaining = poTotal;

    for (let i = 0; i < numOrders; i++) {
      const isLast = (i === numOrders - 1);
      const amt = isLast ? remaining : Math.round(baseAmount * (0.85 + Math.random() * 0.3));
      if (isLast) { remaining = amt; } else { remaining -= amt; }

      const qty = Math.round(amt / (30000 + Math.random() * 20000));
      const unitPrice = qty > 0 ? Number((amt / qty).toFixed(2)) : 0;
      const supplierIdx = (parseInt(month) - 1 + i) % SUPPLIERS.length;
      const itemIdx = (parseInt(month) - 1 + i) % PO_ITEMS.length;
      const day = 5 + i * 5 + Math.floor(Math.random() * 3);
      const poDate = `${year}-${month}-${String(day).padStart(2,'0')}`;
      const poId = 'PO' + year.substring(2) + month + String(i + 1).padStart(3, '0');
      const exchRate = 7.0 + Math.random() * 0.5;
      const vatAmt = Number((amt * 0.13).toFixed(2));
      const deliverOntime = Math.random() > 0.2 ? 'Y' : 'N';

      const sql = `INSERT INTO ermm_erp_po
        (bu_no, po_id, supplier_name, xitems, po_date, po_qty, unit_price,
         unit_price_local, exchange_rate, po_amount, po_amount_local, vat_amt,
         YYYY, MM, YYYY_MM, po_status, qty_balance_closed, deliver_ontime, batch_id, create_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`;
      await conn.execute(sql, [
        bu, poId, SUPPLIERS[supplierIdx], PO_ITEMS[itemIdx],
        poDate, qty, unitPrice,
        Number((unitPrice * exchRate).toFixed(2)), exchRate,
        amt, Number((amt * exchRate).toFixed(2)), vatAmt,
        year, month, ym,
        '已完成', qty, deliverOntime, BATCH_ID
      ]);
      poCount++;
    }
    console.log('  ✅ ' + bu + ' ' + ym + ': ' + numOrders + ' 張 PO, 總額=' + fmt(poTotal) + ' (原料採購=' + fmt(rawAmt) + ')');
  }

  // 6. 驗證
  console.log('\n=== 驗證 ===');
  const [verifySO] = await conn.execute(`
    SELECT YYYY_MM, COUNT(*) as cnt, SUM(unit_price * so_qty) as total
    FROM ermm_erp_so WHERE YYYY_MM >= '2025/01' GROUP BY YYYY_MM ORDER BY YYYY_MM
  `);
  console.log('SO 月度統計:');
  verifySO.forEach(r => console.log('  ' + r.YYYY_MM + ': ' + r.cnt + ' 張, 總額=' + fmt(r.total)));

  const [verifyPO] = await conn.execute(`
    SELECT YYYY_MM, COUNT(*) as cnt, SUM(po_amount) as total
    FROM ermm_erp_po WHERE YYYY_MM >= '2025/01' GROUP BY YYYY_MM ORDER BY YYYY_MM
  `);
  console.log('PO 月度統計:');
  verifyPO.forEach(r => console.log('  ' + r.YYYY_MM + ': ' + r.cnt + ' 張, 總額=' + fmt(r.total)));

  console.log('\n🎉 完成! 共生成 SO: ' + soCount + ' 張, PO: ' + poCount + ' 張');
  await conn.end();
})().catch(e => console.error('❌ ERROR:', e.message));
