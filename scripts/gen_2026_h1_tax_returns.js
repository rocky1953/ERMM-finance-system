/**
 * 生成 2026 年 1~6 月报税申报资料
 *
 * 基于已导入的 fin_voucher + fin_voucher_entry 数据，
 * 按月计算增值税、企业所得税、印花税，写入 fin_tax_return + fin_tax_return_item。
 *
 * 税种规则（与 routes/finance.js TAX_RULES 一致）：
 *   VAT 增值税     税率 13%    应税基础：销售收入（科目 5001+5051）
 *   IT  企业所得税  税率 25%    应税基础：利润（收入-成本-费用）
 *   ST  印花税      税率 0.03%  应税基础：采购+销售合同金额
 *
 * 状态：FILED（已申报），含回执号
 *
 * 用法：node scripts/gen_2026_h1_tax_returns.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../config/db');

const YEAR = 2026;
const MONTHS = [1, 2, 3, 4, 5, 6];
const BUS = ['HM', 'SZ'];

const TAX_RULES = {
    VAT: { name: '增值税',       rate: 0.13,   code: '2210' },
    IT:  { name: '企业所得税',   rate: 0.25,   code: '6801' },
    ST:  { name: '印花税',       rate: 0.0003, code: '2210' },
};

function pad2(n) { return String(n).padStart(2, '0'); }

let ruidSeq = 400;
function genRUID(bu, m) {
    ruidSeq++;
    return `R${bu}${YEAR}${pad2(m)}${pad2(1)}${pad2(9)}${pad2(0)}${pad2(0)}${ruidSeq}`;
}

async function main() {
    const conn = await pool.getConnection();
    let totalReturns = 0;
    let totalItems = 0;

    try {
        await conn.beginTransaction();

        // 清除旧的 2026 年报税资料
        const [oldItems] = await conn.execute("DELETE FROM fin_tax_return_item WHERE ruid LIKE 'R%2026%'");
        const [oldReturns] = await conn.execute("DELETE FROM fin_tax_return WHERE tax_period LIKE '2026-%'");
        console.log(`🗑 清除旧资料: 申报表 ${oldReturns.affectedRows} 条, 明细 ${oldItems.affectedRows} 条\n`);

        for (const bu of BUS) {
            for (const m of MONTHS) {
                const ym = `${YEAR}-${pad2(m)}`;

                // 1. 从凭证分录读取当月各项金额
                const [entries] = await conn.execute(
                    `SELECT e.subject_code, e.subject_name, SUM(e.debit) AS dr, SUM(e.credit) AS cr
                     FROM fin_voucher_entry e
                     JOIN fin_voucher v ON v.voucher_id = e.voucher_id
                     WHERE v.bu_no=? AND v.YYYY_MM=? AND v.status='POSTED'
                     GROUP BY e.subject_code, e.subject_name`,
                    [bu, ym]
                );

                // 汇总金额
                let revenue = 0;      // 收入（贷方）
                let cost = 0;         // 成本（借方）
                let expense = 0;      // 费用（借方）
                let purchase = 0;     // 采购金额
                let sales = 0;        // 销售金额

                for (const e of entries) {
                    const code = e.subject_code;
                    const dr = Number(e.dr || 0);
                    const cr = Number(e.cr || 0);
                    if (code === '5001' || code === '5051') {
                        revenue += cr;
                        sales += cr;
                    }
                    if (code === '6001') cost += dr;
                    if (['6601','6602','6603'].includes(code)) expense += dr;
                    if (code === '2202') purchase += dr;  // 应付账款借方 = 采购
                }

                const profit = revenue - cost - expense;
                const contractAmt = sales + purchase;

                // 2. 生成 3 种税的申报表
                const taxData = [
                    {
                        type: 'VAT',
                        taxable: Math.round(revenue * 100) / 100,
                        tax: Math.round(revenue * TAX_RULES.VAT.rate * 100) / 100,
                        itemName: `${TAX_RULES.VAT.name}-${YEAR}年${pad2(m)}月`,
                    },
                    {
                        type: 'IT',
                        taxable: Math.round(profit * 100) / 100,
                        tax: Math.round(profit * TAX_RULES.IT.rate * 100) / 100,
                        itemName: `${TAX_RULES.IT.name}-${YEAR}年${pad2(m)}月`,
                    },
                    {
                        type: 'ST',
                        taxable: Math.round(contractAmt * 100) / 100,
                        tax: Math.round(contractAmt * TAX_RULES.ST.rate * 100) / 100,
                        itemName: `${TAX_RULES.ST.name}-${YEAR}年${pad2(m)}月`,
                    },
                ];

                for (const td of taxData) {
                    if (td.taxable <= 0) continue;  // 无应税基础则跳过

                    const rule = TAX_RULES[td.type];
                    const ruid = genRUID(bu, m);
                    const receiptNo = `RCPT-${bu}-${td.type}-${YEAR}${pad2(m)}${String(Math.floor(Math.random()*900)+100)}`;

                    // 插入申报表
                    const [r] = await conn.execute(
                        `INSERT INTO fin_tax_return (bu_no, ruid, tax_type, tax_period, taxable_amount, tax_amount, status, filed_time, receipt_no, remark)
                         VALUES (?,?,?,?,?,?, 'FILED', NOW(), ?, ?)`,
                        [bu, ruid, td.type, ym, td.taxable, td.tax, receiptNo, `${rule.name} ${bu} ${ym}`]
                    );
                    const rid = r.insertId;
                    totalReturns++;

                    // 插入明细
                    await conn.execute(
                        `INSERT INTO fin_tax_return_item (return_id, ruid, subject_code, item_name, taxable_amount, tax_rate, tax_amount, remark)
                         VALUES (?,?,?,?,?,?,?,?)`,
                        [rid, ruid, rule.code, td.itemName, td.taxable, rule.rate, td.tax, `${bu} ${ym} ${rule.name}`]
                    );
                    totalItems++;

                    console.log(`  ${bu} ${ym} ${rule.name}: 应税 ${td.taxable.toLocaleString('en-US',{minimumFractionDigits:2})} | 税率 ${(rule.rate*100).toFixed(2)}% | 税额 ${td.tax.toLocaleString('en-US',{minimumFractionDigits:2})} | 回执 ${receiptNo}`);
                }
            }
        }

        await conn.commit();

        // 汇总
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`  ✅ 报税资料生成完成`);
        console.log(`${'═'.repeat(60)}`);
        console.log(`  申报表: ${totalReturns} 条 (fin_tax_return)`);
        console.log(`  明细:   ${totalItems} 条 (fin_tax_return_item)`);
        console.log(`  状态:   全部 FILED（已申报）`);

        // 校验
        const [v] = await pool.execute("SELECT tax_type, COUNT(*) AS cnt, SUM(taxable_amount) AS taxable, SUM(tax_amount) AS tax FROM fin_tax_return WHERE tax_period LIKE '2026-%' GROUP BY tax_type");
        console.log(`\n按税种汇总:`);
        for (const r of v) {
            console.log(`  ${r.tax_type}: ${r.cnt} 份 | 应税 ${Number(r.taxable).toLocaleString('en-US',{minimumFractionDigits:2})} | 税额 ${Number(r.tax).toLocaleString('en-US',{minimumFractionDigits:2})}`);
        }

        const [bu] = await pool.execute("SELECT bu_no, COUNT(*) AS cnt FROM fin_tax_return WHERE tax_period LIKE '2026-%' GROUP BY bu_no");
        console.log(`\n按公司别汇总:`);
        for (const r of bu) {
            console.log(`  ${r.bu_no}: ${r.cnt} 份`);
        }

        const [mm] = await pool.execute("SELECT tax_period, COUNT(*) AS cnt FROM fin_tax_return WHERE tax_period LIKE '2026-%' GROUP BY tax_period ORDER BY tax_period");
        console.log(`\n按月份汇总:`);
        for (const r of mm) {
            console.log(`  ${r.tax_period}: ${r.cnt} 份`);
        }

    } catch (e) {
        await conn.rollback();
        console.error('❌ 生成失败:', e.message);
    } finally {
        conn.release();
        process.exit(0);
    }
}

main();
