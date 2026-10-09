/**
 * 生成 2026 年 1~6 月 fin_voucher 测试资料 Excel 文件
 *
 * 目的：测试「第三方资料整合」模块的 Excel 导入功能
 * 目标表：fin_voucher
 * 唯一键：ruid（UNI）→ 导入时选 ruid 作为 UPSERT 匹配键
 *
 * 用法：node scripts/gen_2026_h1_voucher_excel.js
 * 输出：e:\finance\exports\2026H1_凭证资料.xlsx
 */
const path = require('path');
const ExcelJS = require('exceljs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const OUT_DIR = path.join(__dirname, '..', 'exports');
const OUT_FILE = path.join(OUT_DIR, '2026H1_凭证资料.xlsx');

const YEAR = 2026;
const BUS = ['HM', 'SZ'];
const MONTHS = [1, 2, 3, 4, 5, 6];

// 会计科目
const SUBJECTS = [
    { code: '1001', name: '库存现金' },
    { code: '1002', name: '银行存款' },
    { code: '1122', name: '应收账款' },
    { code: '2202', name: '应付账款' },
    { code: '2210', name: '应交税费' },
    { code: '3001', name: '营业收入' },
    { code: '4001', name: '管理费用' },
    { code: '4003', name: '销售费用' },
    { code: '5001', name: '主营业务成本' },
    { code: '6601', name: '研发费用' },
];

// 凭证类型模板（借方科目, 贷方科目, 摘要模板, 金额范围）
const VOUCHER_TEMPLATES = [
    { dr: '1002', cr: '3001', desc: '销售收款-银行入账',           min: 50000,  max: 300000 },
    { dr: '1122', cr: '3001', desc: '客户应收账款确认',             min: 30000,  max: 150000 },
    { dr: '5001', cr: '1122', desc: '结转销售成本',                 min: 20000,  max: 100000 },
    { dr: '4001', cr: '1002', desc: '管理费用-办公支出',             min: 5000,   max: 30000  },
    { dr: '4003', cr: '1002', desc: '销售费用-推广支出',             min: 10000,  max: 50000  },
    { dr: '2202', cr: '1002', desc: '应付账款-供应商付款',           min: 30000,  max: 200000 },
    { dr: '2210', cr: '1002', desc: '税费缴纳',                     min: 10000,  max: 80000  },
    { dr: '6601', cr: '1002', desc: '研发费用-材料采购',             min: 15000,  max: 60000  },
    { dr: '1002', cr: '2210', desc: '计提当月税费',                 min: 8000,   max: 50000  },
    { dr: '1001', cr: '1002', desc: '现金存入银行',                 min: 5000,   max: 20000  },
];

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min, max) { return Math.round((Math.random() * (max - min) + min) * 100) / 100; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pad2(n) { return String(n).padStart(2, '0'); }

// 生成 RUID
let ruidSeq = 200;
function genRUID(bu) {
    ruidSeq++;
    const m = pad2(rand(1, 6));
    const d = pad2(rand(1, 28));
    const h = pad2(rand(9, 18));
    const mi = pad2(rand(0, 59));
    const s = pad2(rand(0, 59));
    return `R${bu}${YEAR}${m}${d}${h}${mi}${s}${ruidSeq}`;
}

function genVoucherRows() {
    const rows = [];
    let vchSeq = 1;

    for (const bu of BUS) {
        for (const m of MONTHS) {
            // 每月 10 张凭证
            for (let i = 0; i < 10; i++) {
                const tmpl = pick(VOUCHER_TEMPLATES);
                const day = rand(1, 28);
                const amount = randFloat(tmpl.min, tmpl.max);
                const ym = `${YEAR}-${pad2(m)}`;
                const ymd = `${ym}-${pad2(day)}`;
                const ruid = genRUID(bu);
                const voucherNo = `V${bu}${YEAR}${pad2(m)}${pad2(day)}${String(vchSeq++).padStart(3, '0')}`;

                rows.push({
                    bu_no: bu,
                    ruid: ruid,
                    voucher_no: voucherNo,
                    voucher_date: ymd,
                    YYYY_MM: ym,
                    summary: `${tmpl.desc} ${ym}`,
                    total_debit: amount,
                    total_credit: amount,
                    status: 'POSTED',
                    created_by: 'IMPORT',
                    remark: `${bu} ${ym} 第${i + 1}笔 ${tmpl.desc}`,
                });
            }
        }
    }
    return rows;
}

async function main() {
    const fs = require('fs');
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'ERMM 测试资料生成器';
    wb.created = new Date();

    const ws = wb.addWorksheet('凭证资料', { views: [{ state: 'frozen', ySplit: 1 }] });
    const cols = ['bu_no', 'ruid', 'voucher_no', 'voucher_date', 'YYYY_MM', 'summary',
                  'total_debit', 'total_credit', 'status', 'created_by', 'remark'];
    ws.columns = cols.map(c => ({ header: c, key: c, width: 20 }));

    // 表头样式
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    const rows = genVoucherRows();
    for (const r of rows) ws.addRow(r);

    // 数字格式
    ws.getColumn('total_debit').numFmt = '#,##0.00';
    ws.getColumn('total_credit').numFmt = '#,##0.00';
    ws.getColumn('voucher_date').numFmt = 'yyyy-mm-dd';

    await wb.xlsx.writeFile(OUT_FILE);

    console.log('✅ Excel 文件已生成:', OUT_FILE);
    console.log(`   工作表「凭证资料」: ${rows.length} 行`);
    console.log(`   目标表: fin_voucher`);
    console.log(`   公司别: HM + SZ，各 ${rows.length / 2} 行`);
    console.log(`   月份: 2026-01 ~ 2026-06`);
    console.log('');
    console.log('📋 导入步骤:');
    console.log('   1. 进入「第三方资料整合」→ Tab1「Excel 导入」');
    console.log('   2. 选目标表: fin_voucher');
    console.log('   3. 上传此 xlsx → 选 Sheet「凭证资料」');
    console.log('   4. 栏位自动映射（列名与表栏位同名）');
    console.log('   5. 匹配键选「ruid」（UNI 唯一键，用于 UPSERT）');
    console.log('   6. 预览确认 → 写入');
    console.log('   7. 重复导入可测试 UPSERT：同 ruid 走更新而非重复新增');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
