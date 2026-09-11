/**
 * ERMM 第三方資料表匯出 Excel 工具
 *
 * 功能：把每張需要從第三方匯入資料的資料表，轉換成 Excel 中的一個工作表（Sheet）
 *   - Sheet 名稱 = 資料表名稱
 *   - 第 1 行 = 欄位名稱
 *   - 第 2 行起 = 資料表全部資料
 *
 * 用法：
 *   node database/export_tables_to_excel.js                    # 匯出全部第三方資料表
 *   node database/export_tables_to_excel.js mgm_finance_summary # 僅匯出指定表
 *   node database/export_tables_to_excel.js --all               # 匯出所有非備份表
 *
 * 輸出：database/ERMM_第三方資料匯出_YYYYMMDD_HHmmss.xlsx
 */
require('dotenv').config();
const ExcelJS = require('exceljs');
const mysql = require('mysql2/promise');
const path = require('path');

// 排除清單：備份表、系統自動產出表、批次控制表（不需第三方匯入）
const EXCLUDE_PATTERNS = [
    /__bak/i,            // 備份表
    /^schema_migrations$/,
    /^cams_batch_control$/,
    /^login_user_record$/,
    /^e2_xitems_daily_status_chart$/,  // Step5 加工產出
    /^bh_mgm_tx_detail$/,              // 批次加工產出
];

// 需從第三方匯入的資料表清單（依 DATA_IMPORT_GUIDE.md）
// 若未指定命令列參數，則只匯出以下清單內的表
const THIRD_PARTY_TABLES = [
    // ERP 原始單據
    'ermm_temp_po',
    'ermm_erp_so',
    'ermm_erp_so_dn',
    'ermm_erp_documents',
    'e2_xitems_daily_status',
    'mgm_production_details',
    'transit_price',
    // 財務核心 8 表
    'mgm_finance_summary',
    'mgm_casher_details',
    'mgm_invoice_details',
    'pay_detail',
    'ermm_arap_detail',
    'mgm_bank_loan_details',
    'check_detail',
    'forecast_detail',
    // 主檔 / 系統碼 / KPI
    'branch_detail',
    'relation_detail',
    'mgm_account_details',
    'monthly_items',
    'cams_system_codes',
    'mgm_kpi_desc',
    'cams_xuser',
];

const TIMESTAMP = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14);
const OUT = path.join(__dirname, `ERMM_第三方資料匯出_${TIMESTAMP}.xlsx`);

/** 判斷表是否需排除 */
function isExcluded(tableName) {
    return EXCLUDE_PATTERNS.some(p => p.test(tableName));
}

/** Excel Sheet 名稱淨化（Excel 限制 31 字元，禁用 : \ / ? * [ ]） */
function sanitizeSheetName(name) {
    let s = name.replace(/[:\\/?*[\]]/g, '_');
    if (s.length > 31) s = s.slice(0, 31);
    return s;
}

async function main() {
    const args = process.argv.slice(2);
    const argTables = args.filter(a => !a.startsWith('--'));
    const exportAll = args.includes('--all');

    // 建立 MySQL 連線
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'ERMM_db',
        charset: 'utf8mb4',
        dateStrings: true,
    });

    // 取得所有表
    const [tableRows] = await conn.query('SHOW TABLES');
    const key = Object.keys(tableRows[0])[0];
    const allTables = tableRows.map(r => r[key]).filter(t => !isExcluded(t));

    // 決定要匯出的表
    let targetTables;
    if (argTables.length > 0) {
        targetTables = argTables.filter(t => allTables.includes(t));
        if (targetTables.length !== argTables.length) {
            const missing = argTables.filter(t => !allTables.includes(t));
            console.warn(`⚠️ 以下表不存在或已排除: ${missing.join(', ')}`);
        }
    } else if (exportAll) {
        targetTables = allTables;
    } else {
        targetTables = THIRD_PARTY_TABLES.filter(t => allTables.includes(t));
    }

    console.log(`📋 將匯出 ${targetTables.length} 張表：`);
    targetTables.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));

    const wb = new ExcelJS.Workbook();
    wb.creator = 'ERMM Finance Module';
    wb.created = new Date();

    // 封面說明 Sheet
    const cover = wb.addWorksheet('說明_README');
    cover.columns = [{ width: 18 }, { width: 70 }];
    cover.getCell('A1').value = 'ERMM 第三方資料表匯出';
    cover.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FF1A5276' } };
    cover.mergeCells('A1:B1');
    cover.getRow(1).height = 30;
    cover.addRow(['生成時間', new Date().toLocaleString('zh-TW')]);
    cover.addRow(['資料庫', process.env.DB_NAME || 'ERMM_db']);
    cover.addRow(['匯出表數', targetTables.length]);
    cover.addRow([]);
    cover.addRow(['格式說明', '每個工作表（Sheet）對應一張資料表：']);
    cover.addRow(['', '• Sheet 名稱 = 資料表名稱']);
    cover.addRow(['', '• 第 1 行 = 欄位名稱（與 DB 欄位名完全一致）']);
    cover.addRow(['', '• 第 2 行起 = 資料表全部資料']);
    cover.addRow([]);
    cover.addRow(['匯入方式', '本檔可直接用 import_excel.js 匯回（Sheet 名稱需對應資料表）']);
    cover.addRow([]);

    const headerStyle = {
        font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C3E50' } },
        alignment: { vertical: 'middle', horizontal: 'center' },
        border: {
            bottom: { style: 'thin', color: { argb: 'FF1A5276' } },
        },
    };

    let totalRows = 0;

    for (const tableName of targetTables) {
        // 取得欄位資訊
        const [columns] = await conn.query(`DESCRIBE \`${tableName}\``);
        const colNames = columns.map(c => c.Field);

        // 取得全部資料
        const [data] = await conn.query(`SELECT * FROM \`${tableName}\``);

        // 建立 Sheet
        const sheetName = sanitizeSheetName(tableName);
        const ws = wb.addWorksheet(sheetName, {
            views: [{ state: 'frozen', ySplit: 1 }],
        });

        // 第 1 行：欄位名稱
        const headerRow = ws.addRow(colNames);
        Object.entries(headerStyle).forEach(([k, v]) => {
            headerRow[k] = v;
        });
        ws.getRow(1).height = 22;

        // 第 2 行起：資料
        for (const row of data) {
            const values = colNames.map(col => {
                const v = row[col];
                // Buffer 轉 hex 字串（避免寫入失敗）
                if (Buffer.isBuffer(v)) return v.toString('hex');
                // Date 物件轉字串（dateStrings 已處理，保險起見）
                if (v instanceof Date) return v.toISOString().slice(0, 10);
                return v;
            });
            ws.addRow(values);
        }

        // 欄寬：依欄位名長度與資料最大長度動態調整
        ws.columns = colNames.map((col, i) => {
            let maxLen = col.length;
            for (const row of data) {
                const v = row[col];
                const len = v == null ? 4 : String(v).length;
                if (len > maxLen) maxLen = Math.min(len, 40);
            }
            return { width: Math.max(10, maxLen * 1.2 + 2) };
        });

        cover.addRow([sheetName, `${tableName}  —  ${data.length} 筆資料, ${colNames.length} 欄`]);
        totalRows += data.length;
        console.log(`   ✅ ${tableName} → Sheet「${sheetName}」: ${data.length} 筆, ${colNames.length} 欄`);
    }

    await conn.end();
    await wb.xlsx.writeFile(OUT);

    const fs = require('fs');
    const sizeKB = (fs.statSync(OUT).size / 1024).toFixed(1);
    console.log('');
    console.log(`✅ 匯出完成: ${OUT}`);
    console.log(`   共 ${targetTables.length} 個工作表, ${totalRows} 筆資料, 檔案大小 ${sizeKB} KB`);
}

main().catch(err => {
    console.error('❌ 匯出失敗:', err.message);
    process.exit(1);
});
