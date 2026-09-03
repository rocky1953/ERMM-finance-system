/**
 * 把 batch_test_202301.xlsx 的資料灌進 DB
 * 然後跑 7 步批次管線驗證
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const ExcelJS = require('exceljs');
const mysql = require('mysql2/promise');

const EXCEL = path.join(__dirname, 'batch_test_202301.xlsx');

// 根據 .env 讀 DB 設定
const dbCfg = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
    database: process.env.DB_NAME || process.env.DB_DATABASE || 'ERMM_db',
    multipleStatements: true,
};

// Sheet 名稱 → DB 表（與 Excel Sheet 名對應）
const SHEET_TABLE = {
    '01_ERP_temp_po': 'ERMM_temp_po',
    '02_ERP_SO': 'ERMM_erp_SO',
    '03_庫存明細_xitems': 'e2_xitems_daily_status',
    '04_系統參數_codes': 'cams_system_codes',
    '05_發票明細_invoice': 'MGM_invoice_details',
    '06_現金日記_cash': 'MGM_casher_details',
    '07_財務摘要_summary': 'MGM_finance_summary',
};

// 轉換 Excel Date → MySQL 格式
function cellToVal(v) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) {
        if (isNaN(v.getTime()) || v.getFullYear() < 1900) return null;
        return v.toISOString().substring(0, 10);
    }
    if (typeof v === 'object' && v.result !== undefined) {
        // ExcelJS formula cell
        const r = v.result;
        if (r instanceof Date) return r.toISOString().substring(0, 10);
        return r;
    }
    return v;
}

async function main() {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(EXCEL);
    const conn = await mysql.createConnection(dbCfg);
    console.log('✅ DB 連線成功\n');

    // 先清掉 2023/01 相關舊資料（避免重複）
    console.log('── 清除 2023/01 舊資料 ──');
    const cleans = [
        "DELETE FROM ERMM_temp_po WHERE po_id LIKE 'PO2301%'",
        "DELETE FROM ermm_erp_po WHERE po_id LIKE 'PO2301%'",
        "DELETE FROM ERMM_erp_SO WHERE so_nbr LIKE 'SO2301%'",
        "DELETE FROM e2_xitems_daily_status WHERE stock_date='2023-01-31'",
        "DELETE FROM cams_system_codes WHERE code_type IN ('CURRENCY','AGEING_STOCK')",
        "DELETE FROM MGM_invoice_details WHERE invoice_no LIKE '%2301%' AND invoice_no REGEXP '^(AR|AP)2301'",
        "DELETE FROM MGM_casher_details WHERE num_vman LIKE 'CV2301%'",
        "DELETE FROM MGM_finance_summary WHERE YYYY_MM='2023/01'",
        "DELETE FROM ERMM_ARAP_detail WHERE YYYY_MM='2023/01'",
    ];
    for (const q of cleans) {
        try { await conn.execute(q); } catch {}
    }

    // 逐 Sheet 灌資料
    console.log('\n── 灌資料 ──');
    for (const ws of wb.worksheets) {
        const table = SHEET_TABLE[ws.name];
        if (!table) { console.log(`  🚫 跳過 ${ws.name}`); continue; }

        // Row 1 = 欄位名，格式如 "公司別 bu_no" 取右半邊英文代碼
        let colNames = ws.getRow(1).values.slice(1).map(c => {
            const s = String(c || '').trim();
            const m = s.match(/(\b[a-zA-Z_][a-zA-Z0-9_]*\b)[\s]*$/);
            return m ? m[1] : s.replace(/[^a-zA-Z0-9_]/g, '_');
        });

        // 特殊表：把不存在的欄位名映射到 DB 實際欄位
        const COL_FIX = {
            'cams_system_codes': { 'remark': 'value_description' },
        };
        const fixMap = COL_FIX[table] || {};
        colNames = colNames.map(c => fixMap[c] || c);

        // 過濾掉 DB 不存在的欄位（動態查）
        const existingCols = await conn.execute(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME IN (${colNames.map(()=>'?').join(',')})`,
            [dbCfg.database, table, ...colNames]
        );
        const validSet = new Set(existingCols[0].map(r => r.COLUMN_NAME));
        const keepIdx = [];
        colNames = colNames.filter((c, i) => {
            if (validSet.has(c)) { keepIdx.push(i); return true; }
            return false;
        });
        if (keepIdx.length === 0) {
            console.log(`    ⚠️ 無有效欄位，跳過`); continue;
        }

        console.log(`    欄位: ${colNames.slice(0,5).join(',')}...`);
        const placeholders = colNames.map(() => '?').join(',');
        const colList = colNames.join(',');
        const sql = `INSERT INTO ${table} (${colList}) VALUES (${placeholders})`;

        let cnt = 0, errCnt = 0;
        for (let r = 2; r <= ws.rowCount; r++) {
            const row = ws.getRow(r).values.slice(1);
            // 只保留有效欄位位置 + 把 undefined 轉 null
            const params = keepIdx.map(i => {
                const v = row[i];
                if (v === undefined || v === null || v === '') return null;
                if (v instanceof Date) {
                    if (isNaN(v.getTime()) || v.getFullYear() < 1900) return null;
                    return v.toISOString().substring(0, 10);
                }
                if (typeof v === 'object' && v.result !== undefined) {
                    const r = v.result;
                    if (r instanceof Date) return r.toISOString().substring(0, 10);
                    return (r === undefined || r === null) ? null : r;
                }
                return v;
            });
            try {
                await conn.execute(sql, params);
                cnt++;
            } catch (e) {
                errCnt++;
                if (errCnt <= 2) console.log(`    ⚠️ Row${r}: ${e.message.substring(0, 120)}`);
            }
        }
        console.log(`  ${table.padEnd(32)} → ${cnt} 筆 (錯 ${errCnt})`);
    }

    // 7. MGM_finance_summary — 不需要回填，原本就有 YYYY_MM

    // ============================================================
    // 重點：所有新灌資料的 YYYY_MM / YYYY / MM 都是 NULL（Excel 沒這些欄位）
    //       根據對應的日期欄位自動回填
    // ============================================================
    console.log('\n── 自動回填 YYYY/MM/YYYY_MM ──');
    const backfills = [
        // 表, 日期欄位, 篩選條件（只更新這次灌的）
        { tbl: 'ERMM_temp_po',          date: 'po_date',  where: "po_id LIKE 'PO2301%'" },
        { tbl: 'ermm_erp_po',           date: 'po_date',  where: "po_id LIKE 'PO2301%'" },
        { tbl: 'ERMM_erp_SO',           date: 'so_date',  where: "so_nbr LIKE 'SO2301%'" },
        { tbl: 'MGM_invoice_details',   date: 'wk_date',  where: "invoice_no REGEXP '^(AR|AP)2301'" },
        { tbl: 'MGM_casher_details',    date: 'wk_date',  where: "num_vman LIKE 'CV2301%'" },
        { tbl: 'pay_detail',            date: 'should_date', where: "supplier_name IN ('工資','供應商A','供應商B') AND finance_type='工資'" },
        { tbl: 'ermm_arap_detail',      date: null,       where: "YYYY_MM='2023/01'" },
    ];

    for (const bf of backfills) {
        if (!bf.date) continue;
        const sql = `UPDATE ${bf.tbl}
                        SET YYYY = YEAR(${bf.date}),
                            MM   = LPAD(MONTH(${bf.date}),2,'0'),
                            YYYY_MM = CONCAT(YEAR(${bf.date}),'/',LPAD(MONTH(${bf.date}),2,'0'))
                      WHERE ${bf.where} AND ${bf.date} IS NOT NULL`;
        try {
            const [r] = await conn.execute(sql);
            console.log(`  ${bf.tbl.padEnd(28)} → ${r.affectedRows} 筆回填`);
        } catch (e) {
            console.log(`  ${bf.tbl.padEnd(28)} ⚠️ ${e.message.substring(0, 60)}`);
        }
    }

    await conn.end();
    console.log('\n✅ 資料灌完 + YYYY_MM 回填完成！');
}

main().catch(err => { console.error('❌', err); process.exit(1); });
