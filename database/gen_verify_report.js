/**
 * 批次管線 7 步導入後驗證報告生成器
 * 用法: node database/gen_verify_report.js [YYYY/MM]
 * 預設: 2023/01
 * 輸出: database/verify_report_YYYYMM.html
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const YYYY_MM = process.argv[2] || '2023/01';
const YYYY = YYYY_MM.split('/')[0];
const MM = YYYY_MM.split('/')[1];
const OUT = path.join(__dirname, `verify_report_${YYYY}${MM}.html`);

// 算該月最後一天（2/28 或 2/29 等）
const lastDayOfMonth = new Date(parseInt(YYYY), parseInt(MM), 0).getDate();
const STOCK_LAST_DAY = `${YYYY}-${MM.padStart(2,'0')}-${lastDayOfMonth}`;

const BU_LIST = ['HM', 'HN', 'SZ'];
const BU_NAME = { HM: '鴻明', HN: '鴻南', SZ: '深圳廠' };

const dbCfg = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
    database: process.env.DB_NAME || process.env.DB_DATABASE || 'ERMM_db',
};

function fmt(n, dec = 0) {
    if (n === null || n === undefined || isNaN(n)) return '<span style="color:#dc2626">NULL</span>';
    const v = Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const cls = n < 0 ? 'color:#dc2626' : (n === 0 ? 'color:#64748b' : 'color:#0f172a');
    return `<span style="${cls};font-variant-numeric:tabular-nums">${v}</span>`;
}

function check(cond, okText = '✅ 通過', failText = '❌ 失敗') {
    return cond ? `<span style="color:#059669;font-weight:700">${okText}</span>`
                : `<span style="color:#dc2626;font-weight:700">${failText}</span>`;
}

async function main() {
    const conn = await mysql.createConnection(dbCfg);

    const sections = [];
    const buResults = {};

    // =========================================================
    // 1. 資料來源彙總（所有 BU × 7 張表）
    // =========================================================
    const srcTables = [
        { name: '01_ERP_temp_po',          tbl: 'ERMM_temp_po',           dateCol: 'po_date',    seqCol: 'po_id',    filter: `po_id LIKE 'PO${YYYY}${MM}%'` },
        { name: '02_ERP_erp_po',           tbl: 'ermm_erp_po',            dateCol: 'po_date',    seqCol: 'po_id',    filter: `po_id LIKE 'PO${YYYY}${MM}%'` },
        { name: '03_ERP_erp_SO',           tbl: 'ERMM_erp_SO',            dateCol: 'so_date',    seqCol: 'so_nbr',   filter: `so_nbr LIKE 'SO${YYYY}${MM}%'` },
        { name: '04_庫存明細',             tbl: 'e2_xitems_daily_status', dateCol: 'stock_date', seqCol: 'uid',      filter: `stock_date='${STOCK_LAST_DAY}'` },
        { name: '05_發票明細',             tbl: 'MGM_invoice_details',     dateCol: 'wk_date',    seqCol: 'invoice_no', filter: `invoice_no REGEXP '^(AR|AP)${YYYY}${MM}'` },
        { name: '06_現金日記',             tbl: 'MGM_casher_details',      dateCol: 'wk_date',    seqCol: 'num_vman',  filter: `num_vman LIKE 'CV${YYYY}${MM}%'` },
        { name: '07_ARAP_detail',          tbl: 'ERMM_ARAP_detail',       dateCol: null,         seqCol: 'uid',      filter: `YYYY_MM='${YYYY_MM}'` },
        { name: '08_財務摘要(目標)',       tbl: 'MGM_finance_summary',     dateCol: null,         seqCol: 'uid',      filter: `YYYY_MM='${YYYY_MM}'` },
    ];

    let srcTableHtml = '';
    for (const t of srcTables) {
        const [rows] = await conn.execute(
            `SELECT bu_no, COUNT(*) cnt FROM ${t.tbl} WHERE ${t.filter} GROUP BY bu_no WITH ROLLUP`
        );
        const byBu = {};
        let total = 0;
        for (const r of rows) {
            if (r.bu_no) byBu[r.bu_no] = r.cnt;
            else total = r.cnt;
        }
        const cells = BU_LIST.map(b => byBu[b] || 0).map(c =>
            c === 0 ? `<td style="color:#dc2626;text-align:center">${c}</td>`
                    : `<td style="text-align:center">${c}</td>`
        ).join('');
        srcTableHtml += `<tr><td style="font-weight:600">${t.name}</td>${cells}<td style="font-weight:700;text-align:right">${total}</td></tr>`;
    }

    sections.push(`
    <h2 class="sec">一、資料來源彙總</h2>
    <p>匯入後各表在 <b>${YYYY_MM}</b> 期間的資料量（紅色 0 表示缺失，需要補）：</p>
    <table>
      <thead><tr><th>表名</th><th>HM</th><th>HN</th><th>SZ</th><th style="text-align:right">合計</th></tr></thead>
      <tbody>${srcTableHtml}</tbody>
    </table>`);

    // =========================================================
    // 2. YYYY_MM 回填檢查
    // =========================================================
    let ymCheckHtml = '';
    const ymTables = [
        { tbl: 'ERMM_erp_SO', filter: `so_nbr LIKE 'SO${YYYY}${MM}%'`, dateCol: 'so_date' },
        { tbl: 'MGM_invoice_details', filter: `invoice_no REGEXP '^(AR|AP)${YYYY}${MM}'`, dateCol: 'wk_date' },
        { tbl: 'MGM_casher_details', filter: `num_vman LIKE 'CV${YYYY}${MM}%'`, dateCol: 'wk_date' },
    ];
    for (const t of ymTables) {
        const [r] = await conn.execute(
            `SELECT COUNT(*) total, SUM(CASE WHEN YYYY_MM IS NOT NULL THEN 1 ELSE 0 END) has_ym
               FROM ${t.tbl} WHERE ${t.filter}`
        );
        const total = r[0].total, has = r[0].has_ym || 0;
        const pct = total > 0 ? Math.round(has / total * 100) : 0;
        const ok = pct === 100;
        ymCheckHtml += `<tr>
          <td><code>${t.tbl}</code></td>
          <td style="text-align:center">${total}</td>
          <td style="text-align:center">${has}</td>
          <td style="text-align:center">${pct}%</td>
          <td>${check(ok, 'YYYY_MM 完整回填', '⚠️ 有缺漏')}</td>
        </tr>`;
    }
    sections.push(`
    <h2 class="sec">二、YYYY_MM 回填檢查</h2>
    <p>批次管線 Step 6/7 依賴 <code>YYYY_MM</code> 欄位查詢。以下檢查確保所有新灌資料都有正確回填：</p>
    <table>
      <thead><tr><th>表名</th><th>總筆數</th><th>有 YYYY_MM</th><th>完整率</th><th>結果</th></tr></thead>
      <tbody>${ymCheckHtml}</tbody>
    </table>`);

    // =========================================================
    // 3. 3 BU × 核心財務欄位
    // =========================================================
    let sumHtml = '';
    for (const bu of BU_LIST) {
        const [rows] = await conn.execute(
            `SELECT * FROM MGM_finance_summary WHERE bu_no=? AND YYYY_MM=?`, [bu, YYYY_MM]
        );
        const r = rows[0];
        if (!r) {
            sumHtml += `<tr><td style="font-weight:700">${bu} (${BU_NAME[bu]})</td>
              <td colspan="10" style="text-align:center;color:#dc2626">❌ MGM_finance_summary 無此月份資料</td></tr>`;
            continue;
        }
        // 公式驗證
        const asset = Number(r.ttl_asset_amt || 0);
        const formula = Number(r.cash_amt || 0)
            + Number(r.deposite_amt || 0)
            + Number(r.AR_amt || 0)
            + Number(r.AR_bill_amt || 0)
            + Number(r.stock_P_amt || 0)
            + Number(r.stock_M_amt || 0)
            + Number(r.stock_S_amt || 0)
            - Number(r.reserve_loss_amt || 0);
        const diff = Math.abs(asset - formula);
        const balanced = diff < 1;

        // VAT 驗證
        const vatPayable = Number(r.VAT_amt || 0);
        const vatCalc = Number(r.AR_bill_amt || 0) - Number(r.AP_tax_amt || 0);
        const vatOk = Math.abs(vatPayable - vatCalc) < 1;

        buResults[bu] = { r, balanced, diff, vatOk, vatCalc };

        sumHtml += `
        <tr style="background:${balanced ? '#f0fdf4' : '#fef2f2'}">
          <td style="font-weight:700">${bu} (${BU_NAME[bu]})</td>
          <td>${fmt(r.AR_amt)}</td>
          <td>${fmt(r.AP_amt)}</td>
          <td>${fmt(r.cash_amt)}</td>
          <td>${fmt(Number(r.stock_P_amt||0)+Number(r.stock_M_amt||0)+Number(r.stock_S_amt||0))}</td>
          <td>${fmt(r.reserve_loss_amt)}</td>
          <td>${fmt(vatPayable)} ${vatOk ? '✅' : `<br><small style="color:#dc2626">公式=${fmt(vatCalc)}</small>`}</td>
          <td>${fmt(r.AR_bill_amt)}</td>
          <td>${fmt(r.AP_tax_amt)}</td>
          <td>${fmt(asset)}</td>
          <td>${check(balanced, '平衡 ✅', `差額 ${fmt(diff)} ❌`)}</td>
        </tr>`;
    }

    sections.push(`
    <h2 class="sec">三、3 BU 核心財務欄位</h2>
    <table>
      <thead><tr>
        <th>BU</th><th>AR 應收</th><th>AP 應付</th><th>現金淨額</th>
        <th>存貨</th><th>跌價損失</th><th>VAT 應繳</th>
        <th>AR 發票</th><th>AP 發票</th><th>資產總額</th><th>平衡</th>
      </tr></thead>
      <tbody>${sumHtml}</tbody>
    </table>
    <div class="call info" style="margin-top:12px">
      💡 資產平衡公式：<code>ttl_asset = cash + deposite + AR + AR_bill + stock_P + stock_M + stock_S − reserve_loss</code><br>
      VAT 應繳公式：<code>VAT_payable = AR_bill（銷項稅） − AP_tax（進項稅）</code>
    </div>`);

    // =========================================================
    // 4. 各步驟計算明細（HM 當範例）
    // =========================================================
    let detailHtml = '';
    const bu = 'HM';

    // Step 5 庫存減值
    const [stockRows] = await conn.execute(`
        SELECT xitems, qty_balance, unit_price, ageing_days,
               FORMAT(stock_value,0) sv, FORMAT(reduce_percentage,0) pct,
               FORMAT(current_value,0) cv, FORMAT(current_lose,0) lose
          FROM e2_xitems_daily_status
         WHERE bu_no=? AND stock_date='${STOCK_LAST_DAY}'
         ORDER BY ageing_days DESC
    `, [bu]);
    const stockTable = `<table>
      <thead><tr><th>物料</th><th>數量</th><th>單價</th><th>陳齡(天)</th><th>減值率</th><th>原價值</th><th>減值後</th><th>跌價損失</th></tr></thead>
      <tbody>${stockRows.map(r => `<tr>
        <td>${r.xitems}</td><td>${fmt(r.qty_balance)}</td><td>${fmt(r.unit_price,2)}</td>
        <td style="color:${r.ageing_days>180?'#dc2626':r.ageing_days>90?'#d97706':'#059669'}">${r.ageing_days}</td>
        <td>${r.pct}%</td><td style="text-align:right">${r.sv}</td>
        <td style="text-align:right">${r.cv}</td><td style="text-align:right;color:#dc2626">${r.lose}</td>
      </tr>`).join('')}</tbody>
    </table>`;

    // Step 6 ARAP 驗證
    const [arapRows] = await conn.execute(`
        SELECT YYYY_MM, FORMAT(AR_amt,0) AR, FORMAT(AP_amt,0) AP
          FROM ERMM_ARAP_detail WHERE bu_no=? AND YYYY_MM=?
    `, [bu, YYYY_MM]);
    const arap = arapRows[0] || {};

    // SO → AR 驗證
    const [soAR] = await conn.execute(`
        SELECT FORMAT(SUM(unit_price * dn_qty),0) so_total
          FROM ERMM_erp_SO WHERE bu_no=? AND YYYY_MM=?
    `, [bu, YYYY_MM]);
    // PO → AP 驗證
    const [poAP] = await conn.execute(`
        SELECT FORMAT(SUM(po_amount + vat_amt),0) po_total
          FROM ermm_erp_po WHERE bu_no=?
            AND YYYY_MM=? AND po_status='審核通過' AND po_sub_status='交付完成'
    `, [bu, YYYY_MM]);

    // Step 7 發票彙總驗證
    const [invSum] = await conn.execute(`
        SELECT TX_type, FORMAT(SUM(sub_amt),0) total, FORMAT(SUM(VAT_amt),0) vat
          FROM MGM_invoice_details WHERE bu_no=? AND YYYY_MM=?
         GROUP BY TX_type
    `, [bu, YYYY_MM]);
    const invMap = {};
    invSum.forEach(i => invMap[i.TX_type] = { total: i.total, vat: i.vat });

    // Step 7 現金流驗證
    const [cashSum] = await conn.execute(`
        SELECT DB_CR, FORMAT(SUM(sub_amt),0) total, COUNT(*) cnt
          FROM MGM_casher_details WHERE bu_no=? AND YYYY_MM=?
         GROUP BY DB_CR
    `, [bu, YYYY_MM]);
    const cashMap = {};
    cashSum.forEach(c => cashMap[c.DB_CR] = { total: c.total, cnt: c.cnt });

    detailHtml = `
    <h3>4.1 Step 5 庫存減值計算明細（${bu}）</h3>
    ${stockTable}

    <h3>4.2 Step 6 ARAP 彙算驗證（${bu}）</h3>
    <table>
      <thead><tr><th>驗證項目</th><th>SO 銷售→AR</th><th>PO 採購→AP</th><th>發票 AR/AP 備援</th></tr></thead>
      <tbody>
        <tr><td style="font-weight:600">來源彙總</td>
            <td style="text-align:right">${fmt(soAR[0].so_total)}</td>
            <td style="text-align:right">${fmt(poAP[0].po_total)}</td>
            <td style="text-align:right">${fmt(invMap['AR']?.total)} / ${fmt(invMap['AP']?.total)}</td></tr>
        <tr><td style="font-weight:600">寫入 ERMM_ARAP_detail</td>
            <td style="text-align:right;color:#059669">${fmt(arap.AR_amt || 0)}</td>
            <td style="text-align:right;color:#059669">${fmt(arap.AP_amt || 0)}</td>
            <td style="text-align:right">—</td></tr>
      </tbody>
    </table>

    <h3>4.3 Step 7 發票 / 現金彙總（${bu}）</h3>
    <table>
      <thead><tr><th>來源</th><th>方向</th><th>筆數</th><th>未稅金額</th><th>稅額</th></tr></thead>
      <tbody>
        <tr><td>發票明細</td><td style="color:#059669;font-weight:700">AR（銷項）</td>
            <td>${invSum.find(i=>i.TX_type==='AR')?.cnt || 0}</td>
            <td style="text-align:right">${invMap['AR']?.total || '—'}</td>
            <td style="text-align:right">${invMap['AR']?.vat || '—'}</td></tr>
        <tr><td>發票明細</td><td style="color:#dc2626;font-weight:700">AP（進項）</td>
            <td>${invSum.find(i=>i.TX_type==='AP')?.cnt || 0}</td>
            <td style="text-align:right">${invMap['AP']?.total || '—'}</td>
            <td style="text-align:right">${invMap['AP']?.vat || '—'}</td></tr>
        <tr><td>現金日記</td><td style="color:#059669;font-weight:700">DR（收入）</td>
            <td>${cashMap['DR']?.cnt || 0}</td>
            <td style="text-align:right">${cashMap['DR']?.total || '—'}</td>
            <td>—</td></tr>
        <tr><td>現金日記</td><td style="color:#dc2626;font-weight:700">CR（支出）</td>
            <td>${cashMap['CR']?.cnt || 0}</td>
            <td style="text-align:right">${cashMap['CR']?.total || '—'}</td>
            <td>—</td></tr>
        <tr style="background:#f0f9ff"><td colspan="3" style="text-align:right;font-weight:700">現金淨額 = DR − CR</td>
            <td colspan="2" style="text-align:right;font-weight:700">${fmt(Number(cashMap['DR']?.total || 0) - Number(cashMap['CR']?.total || 0))}</td></tr>
      </tbody>
    </table>`;

    sections.push(`
    <h2 class="sec">四、計算明細（以 ${bu} 為範例）</h2>
    ${detailHtml}`);

    // =========================================================
    // 5. 資料品質檢查
    // =========================================================
    let qcHtml = '';

    // 5a. 有 PO 但沒 PO 加工（unit_price_local 為 0）
    const [unprocd] = await conn.execute(`
        SELECT bu_no, COUNT(*) cnt FROM ermm_erp_po
         WHERE po_id LIKE 'PO${YYYY}${MM}%'
           AND (unit_price_local IS NULL OR unit_price_local=0)
         GROUP BY bu_no
    `);
    const unprocMap = {};
    unprocd.forEach(r => unprocMap[r.bu_no] = r.cnt);
    qcHtml += `<tr><td>Step 2 PO 未加工（unit_price_local=0）</td>
      ${BU_LIST.map(b => `<td>${check(!unprocMap[b], '0', unprocMap[b]+' 筆')}</td>`).join('')}</tr>`;

    // 5b. 有庫存但沒算減值
    const [noReduce] = await conn.execute(`
        SELECT bu_no, COUNT(*) cnt FROM e2_xitems_daily_status
         WHERE stock_date='${STOCK_LAST_DAY}'
           AND (stock_value IS NULL OR stock_value=0)
         GROUP BY bu_no
    `);
    const noReduceMap = {};
    noReduce.forEach(r => noReduceMap[r.bu_no] = r.cnt);
    qcHtml += `<tr><td>Step 5 庫存未算減值（stock_value=0）</td>
      ${BU_LIST.map(b => `<td>${check(!noReduceMap[b], '0', noReduceMap[b]+' 筆')}</td>`).join('')}</tr>`;

    // 5c. summary 有資料但核心欄位 NULL
    const [nullAR] = await conn.execute(`SELECT bu_no, COUNT(*) cnt FROM MGM_finance_summary WHERE YYYY_MM=? AND AR_amt IS NULL GROUP BY bu_no`, [YYYY_MM]);
    const nullARMap = {}; nullAR.forEach(r => nullARMap[r.bu_no] = r.cnt);
    qcHtml += `<tr><td>Step 7 summary AR 為 NULL</td>
      ${BU_LIST.map(b => `<td>${check(!nullARMap[b], '0', nullARMap[b]+' 筆')}</td>`).join('')}</tr>`;

    const [nullCash] = await conn.execute(`SELECT bu_no, COUNT(*) cnt FROM MGM_finance_summary WHERE YYYY_MM=? AND cash_amt IS NULL GROUP BY bu_no`, [YYYY_MM]);
    const nullCashMap = {}; nullCash.forEach(r => nullCashMap[r.bu_no] = r.cnt);
    qcHtml += `<tr><td>Step 7 summary cash 為 NULL</td>
      ${BU_LIST.map(b => `<td>${check(!nullCashMap[b], '0', nullCashMap[b]+' 筆')}</td>`).join('')}</tr>`;

    // 5d. ERMM_ARAP_detail UNIQUE KEY 檢查（不應有重複月份+BU）
    const [dups] = await conn.execute(`
        SELECT bu_no, COUNT(*) cnt FROM ERMM_ARAP_detail
         WHERE YYYY_MM=? GROUP BY bu_no, YYYY_MM HAVING cnt > 1
    `, [YYYY_MM]);
    const dupMap = {}; dups.forEach(r => dupMap[r.bu_no] = r.cnt);
    qcHtml += `<tr><td>ERMM_ARAP_detail 重複月份+BU</td>
      ${BU_LIST.map(b => `<td>${check(!dupMap[b], '0', dupMap[b]+' 筆重複')}</td>`).join('')}</tr>`;

    // 5e. 資產平衡檢查
    qcHtml += `<tr><td>資產平衡（asset = 公式）</td>
      ${BU_LIST.map(b => `<td>${check(buResults[b]?.balanced, '✅ 平衡', `❌ 差 ${fmt(buResults[b]?.diff)}`)}</td>`).join('')}</tr>`;

    qcHtml += `<tr><td>VAT 應繳 = 銷項 − 進項</td>
      ${BU_LIST.map(b => `<td>${check(buResults[b]?.vatOk, '✅ 一致', `❌`)}</td>`).join('')}</tr>`;

    sections.push(`
    <h2 class="sec">五、資料品質檢查（QC）</h2>
    <table>
      <thead><tr><th>檢查項目</th>${BU_LIST.map(b => `<th>${b} (${BU_NAME[b]})</th>`).join('')}</tr></thead>
      <tbody>${qcHtml}</tbody>
    </table>`);

    // =========================================================
    // 6. 執行指令回顧
    // =========================================================
    sections.push(`
    <h2 class="sec">六、執行指令回顧</h2>
    <pre><span class="cm"># 1. 生成測試 Excel (gen_batch_test_excel.js)</span>
<span class="kw">node</span> database/gen_batch_test_excel.js

<span class="cm"># 2. 灌進 DB + 自動回填 YYYY_MM (load_batch_test.js)</span>
<span class="kw">node</span> database/load_batch_test.js

<span class="cm"># 3. 前端批次管線頁，或 curl 測試</span>
<span class="kw">for</span> i <span class="kw">in</span> 1..7; <span class="kw">do</span>
  curl -X POST http://localhost:3008/api/batch/step$i \\
       -H "Content-Type: application/json" -d '{"bu_no":"HM"}'
<span class="kw">done</span>

<span class="cm"># 4. 生成本報告</span>
<span class="kw">node</span> database/gen_verify_report.js ${YYYY_MM}</pre>`);

    await conn.end();

    // =========================================================
    // 輸出 HTML
    // =========================================================
    const genTime = new Date().toLocaleString('zh-TW');
    const html = `<!DOCTYPE html>
<html lang="zh-TW"><head><meta charset="UTF-8">
<title>批次管線驗證報告 — ${YYYY_MM}</title>
<style>
  :root{--p:#1e40af;--ok:#059669;--warn:#d97706;--err:#dc2626;--bg:#f8fafc}
  body{margin:0;font-family:-apple-system,"PingFang TC","Microsoft JhengHei",sans-serif;background:var(--bg);color:#1e293b;line-height:1.7}
  .page{max-width:1100px;margin:0 auto;padding:40px 48px 80px;background:#fff;box-shadow:0 0 30px rgba(0,0,0,.08);min-height:100vh}
  .cover{background:linear-gradient(135deg,#1e40af,#0ea5e9);color:#fff;margin:-40px -48px 32px;padding:40px 48px;border-bottom:3px solid var(--p)}
  .cover h1{margin:0 0 8px;font-size:28px}
  .cover .sub{opacity:.92;font-size:14px}
  .cover .meta{margin-top:12px;font-size:12px;opacity:.8}
  .tag{display:inline-block;background:rgba(255,255,255,.2);padding:2px 10px;border-radius:12px;margin-right:6px;font-size:12px}
  h2{font-size:20px;color:var(--p);margin:36px 0 14px;padding-bottom:8px;border-bottom:2px solid #e2e8f0}
  h3{font-size:15px;color:#334155;margin:24px 0 10px}
  table{width:100%;border-collapse:collapse;font-size:13.5px;font-variant-numeric:tabular-nums}
  th,td{padding:9px 12px;text-align:left;border-bottom:1px solid #e2e8f0}
  th{background:linear-gradient(to bottom,#eff6ff,#dbeafe);color:var(--p);font-weight:700;border-bottom:2px solid var(--p);white-space:nowrap}
  tr:nth-child(even) td{background:#fafbfc}
  tr:hover td{background:#f8fafc}
  code{background:#f1f5f9;border:1px solid #cbd5e1;padding:1px 6px;border-radius:3px;font-size:12.5px;color:var(--p);font-family:"SF Mono","Consolas",monospace}
  pre{background:#0f172a;color:#e2e8f0;padding:16px 20px;border-radius:8px;overflow-x:auto;font-size:12.5px;font-family:"SF Mono","Consolas",monospace;border:1px solid #334155}
  pre .cm{color:#94a3b8;font-style:italic}pre .kw{color:#60a5fa}pre .str{color:#86efac}pre .num{color:#fbbf24}
  .call.info{background:#eff6ff;border-left:4px solid var(--p);color:#1e3a8a;padding:12px 16px;border-radius:8px;font-size:13px}
  @media print{body{background:#fff}.page{box-shadow:none;margin:0;padding:20px}.cover{margin:0;padding:20px}.page-break{page-break-before:always}}
</style></head><body><div class="page">
<div class="cover">
  <h1>📊 批次管線 7 步導入驗證報告</h1>
  <div class="sub">資料期間：<b>${YYYY_MM}</b> ・ BU：HM / HN / SZ ・ 批次管線：7 步</div>
  <div class="meta"><span class="tag">生成時間 ${genTime}</span><span class="tag">DB ERMM_db</span><span class="tag">MySQL 8.3</span><span class="tag">Node 18</span></div>
</div>
${sections.join('\n')}
<div style="margin-top:40px;padding-top:16px;border-top:1px solid #e2e8f0;text-align:center;color:#94a3b8;font-size:12px">
  ERMM Batch Pipeline Verification Report · 自動生成
</div>
</div></body></html>`;

    fs.writeFileSync(OUT, html, 'utf8');
    console.log(`✅ 驗證報告已輸出: ${OUT}`);
    console.log(`   大小: ${(fs.statSync(OUT).size/1024).toFixed(1)} KB`);
}

main().catch(err => { console.error('❌', err); process.exit(1); });
