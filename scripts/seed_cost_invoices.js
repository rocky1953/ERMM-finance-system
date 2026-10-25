/**
 * 补齐进项发票明细（销货成本下钻弹窗数据源）
 *
 * 背景：
 *   仪表板 → 点击「销售成本」柱体 → 弹窗读取
 *   GET /api/invoice?bu_no=&YYYY_MM=&TX_type=AP
 *   mgm_invoice_details 中部分账套部分年份只有 AR（销项），没有 AP（进项），
 *   导致弹窗显示「尚无发票数据」；或有 AP 行但金额总额 ≠ 销售成本，
 *   下钻金额不一致。
 *
 * 本脚本：
 *   1. 以 mgm_finance_summary.sale_cost_amt 为该月销售成本目标值；
 *   2. 为每月生成 5 张进项发票，金额合计精确等于当月销售成本；
 *   3. 若该月已存在 AP 行，原地 UPDATE 复用 uid，不足则 INSERT，
 *      不删除任何既有记录。
 *
 * 用法：
 *   node scripts/seed_cost_invoices.js --year=2023 --year=2024 --dry-run
 *   node scripts/seed_cost_invoices.js --year=2024 --year=2025 --apply
 *   node scripts/seed_cost_invoices.js --year=2024 --bu=SZ --apply
 */
require('dotenv').config();
const { pool } = require('../config/db');

const APPLY = process.argv.includes('--apply');
const BU_FILTER = (process.argv.find(a => a.startsWith('--bu=')) || '').split('=')[1] || null;
const YEARS = process.argv
    .filter(a => a.startsWith('--year='))
    .map(a => a.split('=')[1])
    .filter(Boolean);

if (YEARS.length === 0) {
    console.error('必须指定 --year=YYYY，例如 --year=2024 --year=2025');
    process.exit(1);
}

const VENDORS = ['钢材供应商A', '塑胶原料B', '电子零组件C', '包装材料D', '能源供应E'];
// 金额拆分权重（合计 1.00），最后一张按差额兜底，保证分位精度下总额精确相等
const WEIGHTS = [0.18, 0.22, 0.24, 0.16, 0.20];
const DAYS = [3, 8, 12, 19, 26];
const TAX_RATE = 13.0;

/** 按权重把总金额（分）拆成 n 份，保证合计精确 */
function allocate(totalCents, weights) {
    const parts = weights.map(w => Math.round(totalCents * w));
    const used = parts.slice(0, -1).reduce((a, b) => a + b, 0);
    parts[parts.length - 1] = totalCents - used;
    return parts;
}

function pad3(n) { return String(n).padStart(3, '0'); }

async function main() {
    // YYYY_MM 是 'YYYY-MM' 格式，按前缀 OR 匹配
    const [rows] = await pool.query(
        `SELECT bu_no, YYYY_MM, sale_cost_amt
           FROM mgm_finance_summary
          WHERE (${YEARS.map(() => 'YYYY_MM LIKE ?').join(' OR ')})
            AND sale_cost_amt > 0
          ORDER BY bu_no, YYYY_MM`,
        YEARS.map(y => `${y}-%`)
    );

    const targets = rows.filter(r => !BU_FILTER || r.bu_no === BU_FILTER);
    console.log(`模式: ${APPLY ? 'APPLY（写库）' : 'DRY-RUN（只打印）'}`);
    console.log(`年份: ${YEARS.join(', ')}  账套: ${BU_FILTER || '全部（HM/SZ/HN 视数据存在与否自动覆盖）'}`);
    console.log(`目标月份: ${targets.length}\n`);

    let updCount = 0, insCount = 0;
    const report = [];

    for (const t of targets) {
        const bu = t.bu_no;
        const ym = t.YYYY_MM;
        const [y, m] = ym.split('-');
        const totalCents = Math.round(Number(t.sale_cost_amt) * 100);
        const parts = allocate(totalCents, WEIGHTS);

        const [exist] = await pool.query(
            `SELECT uid FROM mgm_invoice_details
              WHERE bu_no=? AND TX_type='AP' AND YYYY_MM=? ORDER BY uid`,
            [bu, ym]
        );

        const monthUpd = Math.min(exist.length, parts.length);
        const monthIns = Math.max(0, parts.length - exist.length);

        for (let i = 0; i < parts.length; i++) {
            const subAmt = parts[i] / 100;
            // tax_rate 在库中以百分数字面量存储（13 表示 13%），故需再除以 100
            const vatAmt = Math.round(parts[i] * TAX_RATE / 100) / 100;
            const wkDate = `${y}-${m}-${String(DAYS[i]).padStart(2, '0')}`;
            const invoiceNo = `AP${bu}${y}${m}${pad3(i + 1)}`;
            const orderId = `PO${bu}${y}${m}${pad3(i + 1)}`;

            if (!APPLY) continue;

            if (i < exist.length) {
                await pool.execute(
                    `UPDATE mgm_invoice_details
                        SET order_id=?, client_id=?, invoice_no=?, sub_amt=?, tax_type='VAT',
                            tax_rate=?, VAT_amt=?, wk_date=?, pay_date=NULL, payment=0,
                            ageing_days=DATEDIFF(CURDATE(), ?), DB_CR='DR', YYYY_MM=?, remark='进货发票'
                      WHERE uid=?`,
                    [orderId, VENDORS[i], invoiceNo, subAmt, TAX_RATE, vatAmt, wkDate, wkDate, ym, exist[i].uid]
                );
                updCount++;
            } else {
                await pool.execute(
                    `INSERT INTO mgm_invoice_details
                        (bu_no, TX_type, order_id, client_id, invoice_no, sub_amt, tax_type, tax_rate,
                         VAT_amt, wk_date, pay_date, payment, ageing_days, DB_CR, YYYY_MM, remark)
                     VALUES (?,?,?,?,?,?,?,?,?,?,NULL,0,DATEDIFF(CURDATE(), ?),'DR',?,'进货发票')`,
                    [bu, 'AP', orderId, VENDORS[i], invoiceNo, subAmt, 'VAT', TAX_RATE, vatAmt, wkDate, wkDate, ym]
                );
                insCount++;
            }
        }

        report.push({
            bu, ym,
            target: Number(t.sale_cost_amt),
            generated: parts.reduce((a, b) => a + b, 0) / 100,
            updated: monthUpd,
            inserted: monthIns,
            extraZeroed: Math.max(0, exist.length - parts.length)
        });

        // 把超过 5 张的多余行金额归零（不删除，保持 uid 稳定）
        if (APPLY && exist.length > parts.length) {
            for (const r of exist.slice(parts.length)) {
                await pool.execute(
                    `UPDATE mgm_invoice_details
                        SET sub_amt=0, VAT_amt=0, payment=0, remark='数据校正-冗余行清零'
                      WHERE uid=?`,
                    [r.uid]
                );
            }
        }
    }

    console.table(report);
    console.log(`\n合计：UPDATE ${updCount} 行，INSERT ${insCount} 行`);

    if (APPLY) {
        const [check] = await pool.query(
            `SELECT s.bu_no, s.YYYY_MM, s.sale_cost_amt,
                    COALESCE(SUM(i.sub_amt), 0) AS ap_sum,
                    COALESCE(SUM(i.VAT_amt), 0) AS vat_sum,
                    COUNT(i.uid) AS ap_cnt,
                    ROUND(s.sale_cost_amt - COALESCE(SUM(i.sub_amt), 0), 2) AS diff,
                    ROUND(COALESCE(SUM(i.VAT_amt), 0) - COALESCE(SUM(i.sub_amt), 0) * 0.13, 2) AS vat_diff
               FROM mgm_finance_summary s
               LEFT JOIN mgm_invoice_details i
                      ON i.bu_no = s.bu_no AND i.TX_type = 'AP' AND i.YYYY_MM = s.YYYY_MM
              WHERE (${YEARS.map(() => 's.YYYY_MM LIKE ?').join(' OR ')})
                AND s.sale_cost_amt > 0
                ${BU_FILTER ? 'AND s.bu_no = ?' : ''}
              GROUP BY s.bu_no, s.YYYY_MM, s.sale_cost_amt
              ORDER BY s.bu_no, s.YYYY_MM`,
            BU_FILTER ? [...YEARS.map(y => `${y}-%`), BU_FILTER] : YEARS.map(y => `${y}-%`)
        );
        console.log('\n=== 复核：每月进项发票合计 vs 销售成本 ===');
        console.table(check);
        const bad = check.filter(r => Math.abs(Number(r.diff)) > 0.001 || Math.abs(Number(r.vat_diff)) > 0.02);
        console.log(bad.length === 0
            ? '✅ 全部月份：进项合计 = 销售成本，税额 = 金额 × 13%'
            : `❌ 仍有 ${bad.length} 个月不一致`);
    }

    await pool.end();
}

main().catch(e => { console.error('ERR', e.message); process.exit(1); });
