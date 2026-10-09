/**
 * 生成 2026 年 1~6 月测试资料 Excel 文件
 *
 * 目的：测试「第三方资料整合」模块的 Excel 导入功能
 *
 * 生成 3 个 Sheet（可分别导入到对应本地表）：
 *   Sheet 1: 现金流明细   → 目标表 mgm_casher_details
 *   Sheet 2: 凭证分录     → 目标表 fin_voucher_entry
 *   Sheet 3: 报税明细     → 目标表 fin_tax_return_item
 *
 * 列名与本地表栏位同名，导入时可自动映射。
 * 自增主键栏位（uid / entry_id / item_id）不含，由数据库自动生成。
 *
 * 用法：node scripts/gen_2026_h1_excel.js
 * 输出：e:\finance\exports\2026H1_测试资料.xlsx
 */
const path = require('path');
const ExcelJS = require('exceljs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const OUT_DIR = path.join(__dirname, '..', 'exports');
const OUT_FILE = path.join(OUT_DIR, '2026H1_测试资料.xlsx');

// ===== 基础设定 =====
const BUS = ['HM', 'SZ'];                         // 公司别
const MONTHS = [1, 2, 3, 4, 5, 6];                // 2026 年 1~6 月
const YEAR = 2026;

// 会计科目（与 fin_account_subject 对应）
const SUBJECTS = [
    { code: '1001', name: '库存现金',     type: '资产',  dr: true  },
    { code: '1002', name: '银行存款',     type: '资产',  dr: true  },
    { code: '1122', name: '应收账款',     type: '资产',  dr: true  },
    { code: '2202', name: '应付账款',     type: '负债',  dr: false },
    { code: '3001', name: '营业收入',     type: '收入',  dr: false },
    { code: '4001', name: '管理费用',     type: '费用',  dr: true  },
    { code: '4003', name: '销售费用',     type: '费用',  dr: true  },
    { code: '5001', name: '主营业务成本', type: '费用',  dr: true  },
    { code: '2210', name: '应交税费',     type: '负债',  dr: false },
];

// 税种
const TAX_TYPES = [
    { type: 'VAT', name: '增值税',       rate: 0.13 },
    { type: 'IT',  name: '企业所得税',   rate: 0.25 },
    { type: 'ST',  name: '印花税',       rate: 0.003 },
];

// 现金流类型
const CASH_TYPES = [
    { amt_type: '销售收款',  db_cr: '借',  min: 50000,  max: 200000 },
    { amt_type: '采购付款',  db_cr: '贷',  min: 30000,  max: 150000 },
    { amt_type: '工资发放',  db_cr: '贷',  min: 20000,  max: 80000  },
    { amt_type: '税费缴纳',  db_cr: '贷',  min: 10000,  max: 50000  },
    { amt_type: '其他收入',  db_cr: '借',  min: 5000,   max: 30000  },
    { amt_type: '其他支出',  db_cr: '贷',  min: 3000,   max: 20000  },
];

// 银行账号
const BANK_ACCTS = { HM: '6222021234567890', SZ: '6222029876543210' };

// 随机数
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min, max) { return Math.round((Math.random() * (max - min) + min) * 100) / 100; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pad2(n) { return String(n).padStart(2, '0'); }

// 生成 RUID（与系统格式一致）
let ruidSeq = 100;
function genRUID(bu, bizType) {
    ruidSeq++;
    return `R${bu}${YEAR}${pad2(rand(1,6))}${pad2(rand(1,28))}${pad2(rand(0,23))}${pad2(rand(0,59))}${pad2(rand(0,59))}${ruidSeq}`;
}

// ===== Sheet 1: 现金流明细（mgm_casher_details） =====
function genCashFlowRows() {
    const rows = [];
    let numVmanSeq = 1;
    for (const bu of BUS) {
        for (const m of MONTHS) {
            const days = new Date(YEAR, m, 0).getDate();
            for (let d = 1; d <= days; d++) {
                // 每天 1~3 笔
                const count = rand(1, 3);
                for (let i = 0; i < count; i++) {
                    const ct = pick(CASH_TYPES);
                    const ym = `${YEAR}-${pad2(m)}`;
                    const ymd = `${ym}-${pad2(d)}`;
                    rows.push({
                        bu_no: bu,
                        amt_type: ct.amt_type,
                        client_id: pick(['C001', 'C002', 'C003', 'S001', 'S002', '']),
                        num_vman: `CF${bu}${YEAR}${pad2(m)}${pad2(d)}${pad2(numVmanSeq++)}`,
                        sub_amt: randFloat(ct.min, ct.max),
                        DB_CR: ct.db_cr,
                        YYYY: String(YEAR),
                        MM: pad2(m),
                        YYYY_MM: ym,
                        wk_date: ymd,
                        bank_acct: BANK_ACCTS[bu],
                        remark: `${ct.amt_type} - ${ymd}`,
                    });
                }
            }
        }
    }
    return rows;
}

// ===== Sheet 2: 凭证分录（fin_voucher_entry） =====
function genVoucherEntryRows() {
    const rows = [];
    let vchId = 10000;   // 起始 voucher_id（避免与既有冲突）
    for (const bu of BUS) {
        for (const m of MONTHS) {
            // 每月 8 张凭证
            for (let v = 0; v < 8; v++) {
                const voucherId = ++vchId;
                const ruid = genRUID(bu, 'VOUCHER');
                const day = rand(1, 28);
                const ym = `${YEAR}-${pad2(m)}`;
                // 每张凭证 2 条分录（借 + 贷）
                const subjA = pick(SUBJECTS.filter(s => s.dr));
                const subjB = pick(SUBJECTS.filter(s => !s.dr));
                const amount = randFloat(10000, 200000);
                const summary = `${subjA.name}-${subjB.name}-${ym}月度交易`;

                rows.push({
                    voucher_id: voucherId,
                    ruid: ruid,
                    subject_code: subjA.code,
                    subject_name: subjA.name,
                    debit: amount,
                    credit: 0,
                    summary: summary,
                    source_doc: `DOC-${bu}-${ym}/${pad2(v + 1)}`,
                });
                rows.push({
                    voucher_id: voucherId,
                    ruid: ruid,
                    subject_code: subjB.code,
                    subject_name: subjB.name,
                    debit: 0,
                    credit: amount,
                    summary: summary,
                    source_doc: `DOC-${bu}-${ym}/${pad2(v + 1)}`,
                });
            }
        }
    }
    return rows;
}

// ===== Sheet 3: 报税明细（fin_tax_return_item） =====
function genTaxReturnItemRows() {
    const rows = [];
    let returnId = 5000;  // 起始 return_id
    for (const bu of BUS) {
        for (const m of MONTHS) {
            const ruid = genRUID(bu, 'TAX');
            const retId = ++returnId;
            // 每月 3 种税各 1 条
            for (const t of TAX_TYPES) {
                const taxable = randFloat(100000, 800000);
                const tax = Math.round(taxable * t.rate * 100) / 100;
                const subj = SUBJECTS.find(s => s.code === '2210');
                rows.push({
                    return_id: retId,
                    ruid: ruid,
                    subject_code: subj.code,
                    item_name: `${t.name}-${YEAR}年${pad2(m)}月`,
                    taxable_amount: taxable,
                    tax_rate: t.rate,
                    tax_amount: tax,
                    remark: `${bu} ${YEAR}-${pad2(m)} ${t.type}`,
                });
            }
        }
    }
    return rows;
}

// ===== 生成 Excel =====
async function main() {
    const fs = require('fs');
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'ERMM 测试资料生成器';
    wb.created = new Date();

    // --- Sheet 1: 现金流明细 ---
    const ws1 = wb.addWorksheet('现金流明细', { views: [{ state: 'frozen', ySplit: 1 }] });
    const cashRows = genCashFlowRows();
    const cashCols = ['bu_no', 'amt_type', 'client_id', 'num_vman', 'sub_amt', 'DB_CR', 'YYYY', 'MM', 'YYYY_MM', 'wk_date', 'bank_acct', 'remark'];
    ws1.columns = cashCols.map(c => ({ header: c, key: c, width: 16 }));
    ws1.getRow(1).font = { bold: true };
    ws1.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    ws1.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    for (const r of cashRows) ws1.addRow(r);
    // 数字列格式
    ws1.getColumn('sub_amt').numFmt = '#,##0.00';
    ws1.getColumn('wk_date').numFmt = 'yyyy-mm-dd';

    // --- Sheet 2: 凭证分录 ---
    const ws2 = wb.addWorksheet('凭证分录', { views: [{ state: 'frozen', ySplit: 1 }] });
    const vchCols = ['voucher_id', 'ruid', 'subject_code', 'subject_name', 'debit', 'credit', 'summary', 'source_doc'];
    ws2.columns = vchCols.map(c => ({ header: c, key: c, width: 18 }));
    ws2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    ws2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    const vchRows = genVoucherEntryRows();
    for (const r of vchRows) ws2.addRow(r);
    ws2.getColumn('debit').numFmt = '#,##0.00';
    ws2.getColumn('credit').numFmt = '#,##0.00';

    // --- Sheet 3: 报税明细 ---
    const ws3 = wb.addWorksheet('报税明细', { views: [{ state: 'frozen', ySplit: 1 }] });
    const taxCols = ['return_id', 'ruid', 'subject_code', 'item_name', 'taxable_amount', 'tax_rate', 'tax_amount', 'remark'];
    ws3.columns = taxCols.map(c => ({ header: c, key: c, width: 20 }));
    ws3.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    ws3.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    const taxRows = genTaxReturnItemRows();
    for (const r of taxRows) ws3.addRow(r);
    ws3.getColumn('taxable_amount').numFmt = '#,##0.00';
    ws3.getColumn('tax_rate').numFmt = '0.0000';
    ws3.getColumn('tax_amount').numFmt = '#,##0.00';

    await wb.xlsx.writeFile(OUT_FILE);

    console.log('✅ Excel 文件已生成:', OUT_FILE);
    console.log(`   Sheet 1「现金流明细」: ${cashRows.length} 行 (目标表: mgm_casher_details)`);
    console.log(`   Sheet 2「凭证分录」  : ${vchRows.length} 行 (目标表: fin_voucher_entry)`);
    console.log(`   Sheet 3「报税明细」  : ${taxRows.length} 行 (目标表: fin_tax_return_item)`);
    console.log('');
    console.log('📋 测试步骤:');
    console.log('   1. 启动系统: node app.js');
    console.log('   2. 进入「第三方资料整合」页面');
    console.log('   3. Tab1「Excel 导入」→ 选目标表 → 上传此 xlsx → 选 Sheet → 栏位自动映射 → 预览 → 写入');
    console.log('   4. 分别导入 3 个 Sheet 到对应目标表，测试不同表的导入流程');
    console.log('   5. Tab5「执行日志」查看导入结果（新增/更新/失败行数）');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
