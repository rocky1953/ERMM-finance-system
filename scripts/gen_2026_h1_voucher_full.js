/**
 * 生成 2026 年 1~6 月凭证导入资料（含会计科目映射表）
 *
 * 3 个 Sheet：
 *   Sheet 1「会计科目」  → 目标表 fin_account_subject（subject_code 为 PRI，UPSERT 键）
 *   Sheet 2「凭证主表」  → 目标表 fin_voucher（ruid 为 UNI，UPSERT 键）
 *   Sheet 3「凭证分录」  → 目标表 fin_voucher_entry（INSERT 模式，voucher_id + ruid 对应 Sheet2）
 *
 * 导入顺序：Sheet1 → Sheet2 → Sheet3（分录的 voucher_id 与 Sheet2 一致）
 *
 * 用法：node scripts/gen_2026_h1_voucher_full.js
 * 输出：e:\finance\exports\2026H1_凭证导入资料.xlsx
 */
const path = require('path');
const ExcelJS = require('exceljs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const OUT_DIR = path.join(__dirname, '..', 'exports');
const OUT_FILE = path.join(OUT_DIR, '2026H1_凭证导入资料.xlsx');

const YEAR = 2026;
const BUS = ['HM', 'SZ'];
const MONTHS = [1, 2, 3, 4, 5, 6];
const VOUCHER_ID_START = 20000;   // 起始 voucher_id（避免与既有冲突）

// ===== 会计科目映射表 =====
const SUBJECTS = [
    // 资产类（借方余额）
    { code: '1001', name: '库存现金',       type: '资产', parent: '',     dir: 'DR', remark: '库存现金' },
    { code: '1002', name: '银行存款',       type: '资产', parent: '',     dir: 'DR', remark: '银行存款' },
    { code: '1012', name: '其他货币资金',   type: '资产', parent: '',     dir: 'DR', remark: '其他货币资金' },
    { code: '1122', name: '应收账款',       type: '资产', parent: '',     dir: 'DR', remark: '应收账款' },
    { code: '1123', name: '预付账款',       type: '资产', parent: '',     dir: 'DR', remark: '预付账款' },
    { code: '1221', name: '其他应收款',     type: '资产', parent: '',     dir: 'DR', remark: '其他应收款' },
    { code: '1601', name: '固定资产',       type: '资产', parent: '',     dir: 'DR', remark: '固定资产原值' },
    { code: '1602', name: '累计折旧',       type: '资产', parent: '1601', dir: 'CR', remark: '固定资产累计折旧' },
    // 负债类（贷方余额）
    { code: '2202', name: '应付账款',       type: '负债', parent: '',     dir: 'CR', remark: '应付供应商款项' },
    { code: '2203', name: '预收账款',       type: '负债', parent: '',     dir: 'CR', remark: '预收客户款项' },
    { code: '2210', name: '应交税费',       type: '负债', parent: '',     dir: 'CR', remark: '应交税费' },
    { code: '2241', name: '其他应付款',     type: '负债', parent: '',     dir: 'CR', remark: '其他应付款' },
    // 权益类（贷方余额）
    { code: '4001', name: '实收资本',       type: '权益', parent: '',     dir: 'CR', remark: '实收资本' },
    { code: '4101', name: '盈余公积',       type: '权益', parent: '',     dir: 'CR', remark: '盈余公积' },
    { code: '4103', name: '本年利润',       type: '权益', parent: '',     dir: 'CR', remark: '本年利润' },
    // 收入类（贷方余额）
    { code: '5001', name: '主营业务收入',   type: '收入', parent: '',     dir: 'CR', remark: '主营业务收入' },
    { code: '5051', name: '其他业务收入',   type: '收入', parent: '',     dir: 'CR', remark: '其他业务收入' },
    { code: '5301', name: '营业外收入',     type: '收入', parent: '',     dir: 'CR', remark: '营业外收入' },
    // 费用/成本类（借方余额）
    { code: '6001', name: '主营业务成本',   type: '费用', parent: '',     dir: 'DR', remark: '主营业务成本' },
    { code: '6601', name: '销售费用',       type: '费用', parent: '',     dir: 'DR', remark: '销售费用' },
    { code: '6602', name: '管理费用',       type: '费用', parent: '',     dir: 'DR', remark: '管理费用' },
    { code: '6603', name: '财务费用',       type: '费用', parent: '',     dir: 'DR', remark: '财务费用' },
    { code: '6701', name: '营业外支出',     type: '费用', parent: '',     dir: 'DR', remark: '营业外支出' },
    { code: '6801', name: '所得税费用',     type: '费用', parent: '',     dir: 'DR', remark: '所得税费用' },
];

// 凭证类型模板（借方科目, 贷方科目, 摘要模板, 金额范围）
const VOUCHER_TEMPLATES = [
    { dr: '1002', cr: '5001', desc: '销售收款-银行入账',     min: 50000,  max: 300000 },
    { dr: '1122', cr: '5001', desc: '客户应收账款确认',       min: 30000,  max: 150000 },
    { dr: '6001', cr: '1122', desc: '结转销售成本',           min: 20000,  max: 100000 },
    { dr: '6602', cr: '1002', desc: '管理费用-办公支出',       min: 5000,   max: 30000  },
    { dr: '6601', cr: '1002', desc: '销售费用-推广支出',       min: 10000,  max: 50000  },
    { dr: '2202', cr: '1002', desc: '应付账款-供应商付款',     min: 30000,  max: 200000 },
    { dr: '2210', cr: '1002', desc: '税费缴纳',             min: 10000,  max: 80000  },
    { dr: '6603', cr: '1002', desc: '财务费用-手续费',         min: 500,    max: 5000   },
    { dr: '1002', cr: '2210', desc: '计提当月税费',           min: 8000,   max: 50000  },
    { dr: '5051', cr: '1002', desc: '其他业务收入-收款',       min: 3000,   max: 20000  },
];

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min, max) { return Math.round((Math.random() * (max - min) + min) * 100) / 100; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pad2(n) { return String(n).padStart(2, '0'); }

let ruidSeq = 300;
function genRUID(bu, m, d) {
    ruidSeq++;
    return `R${bu}${YEAR}${pad2(m)}${pad2(d)}${pad2(rand(9,18))}${pad2(rand(0,59))}${pad2(rand(0,59))}${ruidSeq}`;
}

// ===== 生成数据 =====
function genAll() {
    // Sheet 1: 会计科目
    const subjectRows = SUBJECTS.map(s => ({
        subject_code: s.code,
        subject_name: s.name,
        subject_type: s.type,
        parent_code: s.parent || null,
        balance_dir: s.dir,
        is_active: 1,
        remark: s.remark,
    }));

    // Sheet 2 & 3: 凭证主表 + 凭证分录
    const voucherRows = [];
    const entryRows = [];
    let vchId = VOUCHER_ID_START;
    let vchSeq = 1;

    for (const bu of BUS) {
        for (const m of MONTHS) {
            for (let i = 0; i < 10; i++) {
                const tmpl = pick(VOUCHER_TEMPLATES);
                const day = rand(1, 28);
                const amount = randFloat(tmpl.min, tmpl.max);
                const ym = `${YEAR}-${pad2(m)}`;
                const ymd = `${ym}-${pad2(day)}`;
                const ruid = genRUID(bu, m, day);
                const voucherNo = `V${bu}${YEAR}${pad2(m)}${pad2(day)}${String(vchSeq++).padStart(3,'0')}`;
                const vid = ++vchId;
                const summary = `${tmpl.desc} ${ym}`;
                const drSubj = SUBJECTS.find(s => s.code === tmpl.dr);
                const crSubj = SUBJECTS.find(s => s.code === tmpl.cr);

                // 凭证主表
                voucherRows.push({
                    voucher_id: vid,
                    bu_no: bu,
                    ruid: ruid,
                    voucher_no: voucherNo,
                    voucher_date: ymd,
                    YYYY_MM: ym,
                    summary: summary,
                    total_debit: amount,
                    total_credit: amount,
                    status: 'POSTED',
                    created_by: 'IMPORT',
                    remark: `${bu} ${ym} 第${i+1}笔 ${tmpl.desc}`,
                });

                // 凭证分录（2 条：借 + 贷）
                entryRows.push({
                    voucher_id: vid,
                    ruid: ruid,
                    subject_code: tmpl.dr,
                    subject_name: drSubj.name,
                    debit: amount,
                    credit: 0,
                    summary: summary,
                    source_doc: `DOC-${bu}-${ym}-${String(i+1).padStart(2,'0')}`,
                });
                entryRows.push({
                    voucher_id: vid,
                    ruid: ruid,
                    subject_code: tmpl.cr,
                    subject_name: crSubj.name,
                    debit: 0,
                    credit: amount,
                    summary: summary,
                    source_doc: `DOC-${bu}-${ym}-${String(i+1).padStart(2,'0')}`,
                });
            }
        }
    }

    return { subjectRows, voucherRows, entryRows };
}

// ===== 写 Excel =====
async function main() {
    const fs = require('fs');
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    const { subjectRows, voucherRows, entryRows } = genAll();

    const wb = new ExcelJS.Workbook();
    wb.creator = 'ERMM 测试资料生成器';
    wb.created = new Date();

    // --- Sheet 1: 会计科目 ---
    const ws1 = wb.addWorksheet('会计科目', { views: [{ state: 'frozen', ySplit: 1 }] });
    const sCols = ['subject_code', 'subject_name', 'subject_type', 'parent_code', 'balance_dir', 'is_active', 'remark'];
    ws1.columns = sCols.map(c => ({ header: c, key: c, width: 18 }));
    ws1.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    ws1.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    for (const r of subjectRows) ws1.addRow(r);

    // --- Sheet 2: 凭证主表 ---
    const ws2 = wb.addWorksheet('凭证主表', { views: [{ state: 'frozen', ySplit: 1 }] });
    const vCols = ['voucher_id', 'bu_no', 'ruid', 'voucher_no', 'voucher_date', 'YYYY_MM',
                   'summary', 'total_debit', 'total_credit', 'status', 'created_by', 'remark'];
    ws2.columns = vCols.map(c => ({ header: c, key: c, width: 20 }));
    ws2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    ws2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    for (const r of voucherRows) ws2.addRow(r);
    ws2.getColumn('total_debit').numFmt = '#,##0.00';
    ws2.getColumn('total_credit').numFmt = '#,##0.00';
    ws2.getColumn('voucher_date').numFmt = 'yyyy-mm-dd';

    // --- Sheet 3: 凭证分录 ---
    const ws3 = wb.addWorksheet('凭证分录', { views: [{ state: 'frozen', ySplit: 1 }] });
    const eCols = ['voucher_id', 'ruid', 'subject_code', 'subject_name', 'debit', 'credit', 'summary', 'source_doc'];
    ws3.columns = eCols.map(c => ({ header: c, key: c, width: 20 }));
    ws3.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    ws3.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    for (const r of entryRows) ws3.addRow(r);
    ws3.getColumn('debit').numFmt = '#,##0.00';
    ws3.getColumn('credit').numFmt = '#,##0.00';

    await wb.xlsx.writeFile(OUT_FILE);

    console.log('✅ Excel 文件已生成:', OUT_FILE);
    console.log('');
    console.log('   Sheet 1「会计科目」 → fin_account_subject');
    console.log(`     ${subjectRows.length} 行科目（资产8 + 负债4 + 权益3 + 收入3 + 费用6）`);
    console.log(`     UPSERT 键: subject_code (PRI)`);
    console.log('');
    console.log('   Sheet 2「凭证主表」 → fin_voucher');
    console.log(`     ${voucherRows.length} 行凭证（HM 60 + SZ 60，2026-01~06）`);
    console.log(`     UPSERT 键: ruid (UNI)`);
    console.log('');
    console.log('   Sheet 3「凭证分录」 → fin_voucher_entry');
    console.log(`     ${entryRows.length} 行分录（每张凭证 2 条：借+贷）`);
    console.log(`     voucher_id 与 Sheet 2 一致，导入时用 INSERT 模式`);
    console.log('');
    console.log('📋 导入顺序（重要）：');
    console.log('   1️⃣  先导 Sheet 1 → fin_account_subject（科目基础数据）');
    console.log('   2️⃣  再导 Sheet 2 → fin_voucher（凭证主表，选 ruid 为 UPSERT 键）');
    console.log('   3️⃣  最后导 Sheet 3 → fin_voucher_entry（分录，INSERT 模式）');
    console.log('');
    console.log('💡 测试 UPSERT：重复导入 Sheet 2，同 ruid 会走更新而非新增');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
