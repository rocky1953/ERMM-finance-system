/**
 * 补齐 HN 账套 2023 年 1~12 月数据
 *
 * 背景：
 *   HN 账套在 mgm_finance_summary / mgm_invoice_details 等表中从 2024-01 才开始有数据，
 *   2023 年整年缺失（仅 2023-01 残留 3 条字段不全的孤儿进项）。
 *   导致仪表板选择「HN + 2023 年」时曲线断裂、销售成本柱体无法下钻。
 *
 * 做法（以 HN 2024 年同月为模板，金额 ×SCALE，比率列保持不变以维持财务结构）：
 *   1. 每月生成 1 行 mgm_finance_summary；
 *   2. 每月生成 5 条进项发票，合计 = 销售成本；
 *   3. 每月生成 5 条销项发票，合计 = 营业收入；
 *   4. 其他账套、其他年份不受影响。
 *
 * 用法：
 *   node scripts/seed_hn_2023.js --dry-run
 *   node scripts/seed_hn_2023.js --apply
 *   node scripts/seed_hn_2023.js --rollback
 */
require('dotenv').config();
const { pool } = require('../config/db');

const MODE = process.argv.includes('--apply') ? 'apply'
    : process.argv.includes('--rollback') ? 'rollback'
        : 'dry-run';

const BU = 'HN';
const YEAR = '2023';
const TEMPLATE_YEAR = '2024';
const SCALE = 0.9;

const AR_CUSTOMERS = ['华东经销商', '出口欧洲', '华南经销商', '出口日本', '香港总公司'];
const AP_VENDORS = ['钢材供应商A', '塑胶原料B', '电子零组件C', '包装材料D', '能源供应E'];
const WEIGHTS = [0.18, 0.22, 0.24, 0.16, 0.20];
const AR_DAYS = [5, 10, 15, 20, 25];
const AP_DAYS = [3, 8, 12, 19, 26];

const EXTRA_SCALE_COLS = ['captial_stock', 'captial_reserve', 'legal_reserve', 'accumulated_amt', 'retained_income_amt'];
const isMoneyCol = (c) => /_amt$/.test(c) || EXTRA_SCALE_COLS.includes(c);

// 2023-01 原有 3 条孤儿进项（回滚时还原）
const ORIGINAL_AP = [
    { uid: 855, order_id: null, client_id: '供应商X', invoice_no: 'AP23010012', sub_amt: 63144.00, tax_type: null, tax_rate: 13.0000, VAT_amt: 8209.00, wk_date: '2023-01-04', payment: null, ageing_days: 0, DB_CR: null, remark: null },
    { uid: 856, order_id: null, client_id: '供应商Y', invoice_no: 'AP23010013', sub_amt: 57172.00, tax_type: null, tax_rate: 13.0000, VAT_amt: 7432.00, wk_date: '2023-01-09', payment: null, ageing_days: 0, DB_CR: null, remark: null },
    { uid: 857, order_id: null, client_id: '供应商Z', invoice_no: 'AP23010014', sub_amt: 77263.00, tax_type: null, tax_rate: 13.0000, VAT_amt: 10044.00, wk_date: '2023-01-14', payment: null, ageing_days: 0, DB_CR: null, remark: null }
];

function allocate(totalCents, weights) {
    const parts = weights.map(w => Math.round(totalCents * w));
    const used = parts.slice(0, -1).reduce((a, b) => a + b, 0);
    parts[parts.length - 1] = totalCents - used;
    return parts;
}

const pad = (n) => String(n).padStart(2, '0');

async function rollback(conn) {
    const [d1] = await conn.execute(
        `DELETE FROM mgm_finance_summary WHERE bu_no=? AND YYYY_MM LIKE ?`, [BU, `${YEAR}-%`]);
    const [d2] = await conn.execute(
        `DELETE FROM mgm_invoice_details WHERE bu_no=? AND YYYY_MM LIKE ?
            AND (invoice_no LIKE 'ARHN2023%' OR invoice_no LIKE 'APHN2023%')`,
        [BU, `${YEAR}-%`]);
    for (const o of ORIGINAL_AP) {
        await conn.execute(
            `UPDATE mgm_invoice_details
                SET order_id=?, client_id=?, invoice_no=?, sub_amt=?, tax_type=?, tax_rate=?, VAT_amt=?,
                    wk_date=?, pay_date=NULL, payment=?, ageing_days=?, DB_CR=?, remark=?
              WHERE uid=?`,
            [o.order_id, o.client_id, o.invoice_no, o.sub_amt, o.tax_type, o.tax_rate, o.VAT_amt,
            o.wk_date, o.payment, o.ageing_days, o.DB_CR, o.remark, o.uid]);
    }
    console.log(`回滚：summary ${d1.affectedRows} 行，删除发票 ${d2.affectedRows} 行，还原 3 条原始进项`);
}

async function main() {
    const conn = await pool.getConnection();
    try {
        if (MODE === 'rollback') { await rollback(conn); return; }

        const [tplAll] = await conn.query(
            `SELECT * FROM mgm_finance_summary WHERE bu_no=? AND YYYY_MM LIKE ? ORDER BY YYYY_MM`,
            [BU, `${TEMPLATE_YEAR}-%`]);
        if (!tplAll.length) throw new Error(`模板缺失：${BU} ${TEMPLATE_YEAR}`);
        const tplMap = {};
        tplAll.forEach(r => { tplMap[r.YYYY_MM] = r; });

        console.log(`模式: ${MODE}   账套: ${BU}   生成年份: ${YEAR}   模板年份: ${TEMPLATE_YEAR}   缩放: ×${SCALE}\n`);

        const plan = [];
        for (let m = 1; m <= 12; m++) {
            const mm = pad(m);
            const ym = `${YEAR}-${mm}`;
            const tpl = tplMap[`${TEMPLATE_YEAR}-${mm}`];
            if (!tpl) { console.log(`⚠ ${ym} 无模板，跳过`); continue; }

            const sale = Math.round(Number(tpl.sale_amt) * SCALE * 100) / 100;
            const cost = Math.round(Number(tpl.sale_cost_amt) * SCALE * 100) / 100;

            plan.push({
                ym, mm, tpl,
                sale, cost,
                saleParts: allocate(Math.round(sale * 100), WEIGHTS),
                costParts: allocate(Math.round(cost * 100), WEIGHTS)
            });
        }

        const summaryTable = plan.map(p => ({
            月份: p.ym, 营业收入: p.sale, 销售成本: p.cost,
            毛利率: `${((p.sale - p.cost) / p.sale * 100).toFixed(2)}%`
        }));
        console.table(summaryTable);
        const totalSale = plan.reduce((a, p) => a + p.sale, 0);
        const totalCost = plan.reduce((a, p) => a + p.cost, 0);
        console.log(`全年合计：营业收入 ${totalSale.toFixed(2)} / 销售成本 ${totalCost.toFixed(2)}\n`);

        if (MODE === 'dry-run') {
            console.log('DRY-RUN 结束，未写库。');
            return;
        }

        await conn.beginTransaction();
        let sCount = 0, apCount = 0, arCount = 0;

        for (const p of plan) {
            // 1) summary
            const tpl = p.tpl;
            const cols = Object.keys(tpl).filter(c => !['uid', 'create_time', 'update_time'].includes(c));
            const vals = cols.map(c => {
                if (c === 'bu_no') return BU;
                if (c === 'YYYY_MM') return p.ym;
                if (c === 'YYYY') return YEAR;
                if (c === 'MM') return p.mm;
                const v = tpl[c];
                if (v === null || v === undefined) return null;
                if (isMoneyCol(c) && !isNaN(Number(v))) return Math.round(Number(v) * SCALE * 100) / 100;
                return v;
            });

            const [exist] = await conn.query(
                `SELECT uid FROM mgm_finance_summary WHERE bu_no=? AND YYYY_MM=?`, [BU, p.ym]);
            if (exist.length) {
                await conn.execute(
                    `UPDATE mgm_finance_summary SET ${cols.map(c => `${c}=?`).join(',')} WHERE uid=?`,
                    [...vals, exist[0].uid]);
            } else {
                await conn.execute(
                    `INSERT INTO mgm_finance_summary (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
                    vals);
            }
            sCount++;

            // 2) 清掉该月已生成的发票，避免重复累积
            await conn.execute(
                `DELETE FROM mgm_invoice_details WHERE bu_no=? AND YYYY_MM=?
                    AND (invoice_no LIKE 'ARHN2023%' OR invoice_no LIKE 'APHN2023%')`,
                [BU, p.ym]);

            // 3) 进项 5 条
            for (let i = 0; i < p.costParts.length; i++) {
                const c = p.costParts[i];
                const amt = c / 100;
                const vat = Math.round(c * 13 / 100) / 100;
                const date = `${p.ym}-${pad(AP_DAYS[i])}`;
                const ageing = Math.round((new Date('2026-10-23') - new Date(date)) / 86400000);
                await conn.execute(
                    `INSERT INTO mgm_invoice_details
                        (bu_no, TX_type, order_id, client_id, invoice_no, sub_amt, tax_type, tax_rate,
                         VAT_amt, wk_date, pay_date, payment, ageing_days, DB_CR, YYYY_MM, remark)
                     VALUES (?,?,?,?,?,?,?,?,?,?,NULL,0,?,?,?,'进货发票')`,
                    [BU, 'AP', `PO${BU}${YEAR}${p.mm}00${i + 1}`, AP_VENDORS[i],
                    `AP${BU}${YEAR}${p.mm}00${i + 1}`, amt, 'VAT', 13.0, vat, date, ageing, 'DR', p.ym]);
                apCount++;
            }

            // 4) 销项 5 条
            for (let i = 0; i < p.saleParts.length; i++) {
                const c = p.saleParts[i];
                const amt = c / 100;
                const vat = Math.round(c * 13 / 100) / 100;
                const date = `${p.ym}-${pad(AR_DAYS[i])}`;
                const ageing = Math.round((new Date('2026-10-23') - new Date(date)) / 86400000);
                await conn.execute(
                    `INSERT INTO mgm_invoice_details
                        (bu_no, TX_type, order_id, client_id, invoice_no, sub_amt, tax_type, tax_rate,
                         VAT_amt, wk_date, pay_date, payment, ageing_days, DB_CR, YYYY_MM, remark)
                     VALUES (?,?,?,?,?,?,?,?,?,?,NULL,0,?,?,?,'销货发票')`,
                    [BU, 'AR', `SO${BU}${YEAR}${p.mm}00${i + 1}`, AR_CUSTOMERS[i],
                    `AR${BU}${YEAR}${p.mm}00${i + 1}`, amt, 'VAT', 13.0, vat, date, ageing, 'DR', p.ym]);
                arCount++;
            }
        }

        await conn.commit();
        console.log(`✅ 写入完成：summary ${sCount} 行，进项 ${apCount} 条，销项 ${arCount} 条`);
    } catch (e) {
        try { await conn.rollback(); } catch { }
        throw e;
    } finally {
        conn.release();
        await pool.end();
    }
}

main().catch(e => { console.error('ERR', e.message); process.exit(1); });
