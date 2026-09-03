/**
 * ERMM Excel 離線匯入工具 v2
 * 用法: node import_excel.js <xlsx_path>
 *
 * 模板結構（每 Sheet）:
 *   Row 1: 標題 (文字說明，跳過)
 *   Row 2: 欄位代碼 (必須與 DB 欄位名一致)
 *   Row 3+: 資料
 *
 * 匯入方式: INSERT ... ON DUPLICATE KEY UPDATE
 *   - 主鍵/唯一鍵重複時自動覆蓋，可用於更新既有資料
 *   - 日期自動轉 YYYY-MM-DD
 *   - YYYY / MM / YYYY_MM 自動從 wk_date 或 YYYY_MM 欄位推導
 */
require('dotenv').config();
const ExcelJS = require('exceljs');
const mysql = require('mysql2/promise');
const path = require('path');

const DB_NAME = process.env.DB_NAME || 'ERMM_db';

// Sheet 名稱 → DB 表對應表
const SHEET_TABLE = {
    '01_財務摘要_summary':   'MGM_finance_summary',
    '02_現金日記帳_cash':   'MGM_casher_details',
    '03_發票明細_invoice':  'MGM_invoice_details',
    '04_付款明細_pay':      'pay_detail',
    '05_應收應付_arap':     'ermm_arap_detail',
    '06_銀行貸款_bank':     'mgm_bank_loan_details',
    '07_票據管理_check':    'check_detail',
    '08_財務預測_forecast': 'forecast_detail',
};

// 必填欄位檢查
const REQUIRED = {
    'MGM_finance_summary':    ['bu_no', 'YYYY_MM'],
    'MGM_casher_details':     ['bu_no', 'num_vman', 'wk_date', 'DB_CR', 'sub_amt'],
    'MGM_invoice_details':    ['bu_no', 'TX_type', 'invoice_no', 'wk_date', 'client_id', 'sub_amt'],
    'pay_detail':             ['bu_no', 'supplier_name', 'finance_type', 'should_date', 'amount'],
    'ermm_arap_detail':       ['bu_no', 'YYYY_MM'],
    'mgm_bank_loan_details':  ['bu_no', 'loan_id', 'loan_amt', 'begin_date', 'end_date'],
    'check_detail':           ['bu_no', 'check_num', 'check_date', 'due_date', 'amount'],
    'forecast_detail':        ['bu_no', 'YYYY_MM', 'forecast_type', 'forecast_amt'],
};

// 自動派生欄位 (wk_date 拆 YYYY/MM)
function derive(row) {
    const r = { ...row };
    // 日期格式正規化 + 清洗 0000-00-00
    for (const k of Object.keys(r)) {
        const v = r[k];
        if (v instanceof Date) {
            if (isNaN(v.getTime()) || v.getFullYear() < 1900) r[k] = null;
            else r[k] = v.toISOString().substring(0, 10);
        } else if (typeof v === 'string') {
            if (/^0{4}-0{2}-0{2}/.test(v)) r[k] = null;
            else if (/^\d{4}-\d{1,2}-\d{1,2}/.test(v)) r[k] = v.split('T')[0];
        }
        // Excel 数字 0 保留，空白→null
        if (r[k] === '') r[k] = null;
    }
    // 從 wk_date 推 YYYY/MM
    if (r.wk_date && !r.YYYY_MM) {
        const d = String(r.wk_date);
        const [y, m] = d.split('-');
        if (y && m) r.YYYY_MM = `${y}/${m}`;
    }
    if (r.YYYY_MM && !r.YYYY) r.YYYY = String(r.YYYY_MM).split('/')[0];
    if (r.YYYY_MM && !r.MM)   r.MM   = String(r.YYYY_MM).split('/')[1];
    if (r.should_date && !r.entry_date) r.entry_date = r.should_date;
    return r;
}

async function main() {
    const xlsxPath = process.argv[2] || path.join(__dirname, 'finance_data_template.xlsx');
    const fs = require('fs');
    if (!fs.existsSync(xlsxPath)) {
        console.error(`❌ 找不到: ${xlsxPath}`);
        console.error(`用法: node import_excel.js <xlsx_path>`);
        process.exit(1);
    }

    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASS || 'ld68315711',
        database: DB_NAME,
        multipleStatements: true
    });

    // 預先取得每張表的 DB 欄位
    const tableCols = {};
    for (const tbl of Object.values(SHEET_TABLE)) {
        const [cols] = await pool.execute(
            'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',
            [DB_NAME, tbl]
        );
        tableCols[tbl] = new Set(cols.map(c => c.COLUMN_NAME));
    }

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(xlsxPath);
    console.log(`📂 讀取: ${xlsxPath}  (${wb.worksheets.length} sheet)`);
    console.log('─'.repeat(60));

    const summary = [];

    for (const ws of wb.worksheets) {
        const table = SHEET_TABLE[ws.name];
        if (!table) {
            console.log(`📄 跳過: ${ws.name}`);
            continue;
        }
        console.log(`\n▶ ${ws.name} → ${table}`);

        // Row 2 = 欄位代碼
        const headerCodes = [];
        for (let c = 1; c <= ws.columnCount; c++) {
            const v = String(ws.getCell(2, c).value || '').trim();
            headerCodes.push(v);
        }

        // 比對 headerCodes 與 DB 欄位
        const dbSet = tableCols[table];
        const validCodes = [];
        const skipCodes = [];
        for (const code of headerCodes) {
            if (!code) continue;
            if (dbSet.has(code)) validCodes.push(code);
            else skipCodes.push(code);
        }
        if (skipCodes.length > 0) {
            console.log(`  ⚠️  跳過 ${skipCodes.length} 個未知欄位: ${skipCodes.join(', ')}`);
        }

        if (validCodes.length === 0) {
            console.log(`  ❌ 沒有可對應的 DB 欄位，請檢查模板第 2 行`);
            continue;
        }

        // 開事務匯入
        const conn = await pool.getConnection();
        await conn.beginTransaction();
        let inserted = 0, skipped = 0, errors = 0;
        const reqs = REQUIRED[table] || [];

        try {
            for (let rowIdx = 3; rowIdx <= ws.rowCount; rowIdx++) {
                const raw = {};
                let hasAny = false;
                for (let colIdx = 0; colIdx < validCodes.length; colIdx++) {
                    const code = validCodes[colIdx];
                    const val = ws.getCell(rowIdx, colIdx + 1).value;
                    if (val === null || val === undefined || val === '') continue;
                    hasAny = true;
                    raw[code] = val;
                }
                if (!hasAny) continue; // 空行

                const row = derive(raw);

                // 必填檢查
                let missing = [];
                for (const r of reqs) {
                    if (row[r] === null || row[r] === undefined || row[r] === '') {
                        // 但 wk_date 缺了 YYYY_MM 也可以補
                        if (r === 'YYYY_MM' && row.wk_date) continue;
                        missing.push(r);
                    }
                }
                if (missing.length > 0) { skipped++; continue; }

                // 只保留 DB 有且非 null 的欄位
                const fields = validCodes.filter(c => row[c] !== null && row[c] !== undefined && row[c] !== '');
                if (fields.length === 0) { skipped++; continue; }

                const placeholders = fields.map(() => '?').join(',');
                const updates = fields.map(f => `${f}=VALUES(${f})`).join(',');
                const sql = `INSERT INTO ${table} (${fields.join(',')}) VALUES (${placeholders})
                             ON DUPLICATE KEY UPDATE ${updates}`;

                try {
                    await conn.execute(sql, fields.map(f => row[f]));
                    inserted++;
                } catch (e) {
                    errors++;
                    if (errors <= 3) console.log(`    ❌ Row ${rowIdx}: ${e.message}`);
                }
            }
            await conn.commit();
        } catch (e) {
            await conn.rollback();
            console.log(`  ❌ 匯入失敗，已回滾: ${e.message}`);
            errors++;
        } finally {
            conn.release();
        }

        const msg = `  ✅ ${inserted} 筆匯入`;
        const sk = skipped > 0 ? `  (跳過 ${skipped})` : '';
        const er = errors > 0 ? `  ❌ ${errors} 錯` : '';
        console.log(msg + sk + er);
        summary.push({ sheet: ws.name, table, inserted, skipped, errors });
    }

    console.log('\n' + '─'.repeat(60));
    console.log('📊 匯入統計');
    console.log('─'.repeat(60));
    let totalI = 0, totalS = 0, totalE = 0;
    for (const s of summary) {
        console.log(`  ${s.sheet.padEnd(30)}  ${String(s.inserted).padStart(4)} 筆  (跳過 ${s.skipped}, 錯 ${s.errors})`);
        totalI += s.inserted; totalS += s.skipped; totalE += s.errors;
    }
    console.log('─'.repeat(60));
    console.log(`  合計: ${totalI} 筆匯入 / ${totalS} 跳過 / ${totalE} 錯誤`);
    await pool.end();
    console.log('\n✅ 完成！請到系統「批次管線」執行重算。');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
