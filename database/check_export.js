/**
 * 檢查三個 Excel 匯出文件的數據完整性
 */
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const DIR = 'C:\\temp_check';
const TYPES = ['balance-sheet', 'pl-table', 'cash-flow'];

async function main() {
    for (const t of TYPES) {
        const f = path.join(DIR, `${t}.xlsx`);
        if (!fs.existsSync(f)) { console.log(`[跳過] ${t}.xlsx 不存在`); continue; }

        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(f);
        const ws = wb.worksheets[0];

        console.log(`\n========== ${t}.xlsx (工作表: ${ws.name}, ${ws.rowCount} 行) ==========`);

        // 打印每一行
        for (let rowIdx = 1; rowIdx <= ws.rowCount; rowIdx++) {
            const row = ws.getRow(rowIdx);
            const cells = [];
            for (let colIdx = 1; colIdx <= 3; colIdx++) {
                const cell = row.getCell(colIdx);
                const v = cell.value;
                if (v === null || v === undefined) cells.push('');
                else if (typeof v === 'object' && v.richText) cells.push(`[richtext]`);
                else if (typeof v === 'object') cells.push(JSON.stringify(v));
                else cells.push(String(v));
            }
            console.log(`  行${rowIdx}: ${cells.join(' | ')}`);
        }
    }

    console.log('\n===== 完整性對照：API vs Excel =====');

    // 打 API 取得真實資料
    for (const t of TYPES) {
        const apiUrl = `http://localhost:3008/api/report/${t}?bu_no=HM&YYYY_MM=2024/12`;
        try {
            const r = await fetch(apiUrl);
            const j = await r.json();
            console.log(`\n[${t}] API 實際返回:`);
            if (t === 'balance-sheet') {
                const d = j.data.balance_sheet;
                console.log(`  資產總額: ${d.assets.total}`);
                console.log(`  負債總額: ${d.liabilities.total}`);
                console.log(`  權益總額: ${d.equity.total}`);
                console.log(`  負債及權益: ${d.liabilities_equity.total}`);
                console.log(`  平衡: ${d.check.is_balanced}`);
                console.log(`  流動資產.cash: ${d.assets.current.cash}`);
                console.log(`  流動資產.ar: ${d.assets.current.ar}`);
                console.log(`  流動資產.inventory: ${d.assets.current.inventory}`);
                console.log(`  股本: ${d.equity.capital}`);
                console.log(`  資本公積: ${d.equity.reserve}`);
                console.log(`  累積盈餘: ${d.equity.accumulated}`);
                console.log(`  本期損益: ${d.equity.current_PL}`);
            } else if (t === 'pl-table') {
                const d = j.data;
                console.log(`  銷貨收入: ${d.sale_amt}`);
                console.log(`  銷貨成本: ${d.sale_cost_amt}`);
                console.log(`  銷項稅額: ${d.VAT_amt}`);
                console.log(`  營業毛利: ${d.BIZ_major_margin_amt}`);
                console.log(`  營業利益: ${d.BIZ_margin_amt}`);
                console.log(`  淨利: ${d.net_profit_amt}`);
            } else {
                const d = j.data;
                console.log(`  淨利: ${d.net_profit}`);
                console.log(`  折舊: ${d.depreciation}`);
                console.log(`  營運CF: ${d.operating_cf}`);
                console.log(`  投資CF: ${d.investing_cf}`);
                console.log(`  籌資CF: ${d.financing_cf}`);
                console.log(`  淨變動: ${d.net_cash_change}`);
            }
        } catch (e) {
            console.log(`  [錯誤] 調用 ${apiUrl} 失敗: ${e.message}`);
        }
    }
}

main().catch(console.error);
