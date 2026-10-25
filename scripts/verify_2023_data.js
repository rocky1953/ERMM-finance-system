/**
 * 验证 2023 测试资料：各表按月汇总金额 + 实际成长率 vs 目标成长率
 */
const { pool } = require('../config/db');
const pad2 = n => String(n).padStart(2, '0');

const RATES = ['—', 0.20, 0.10, 0.35, -0.15, 0.28, 0.15, 0.23, -0.10, 0.15, 0.42, 0.05];

const QUERIES = [
    { name: '采购明细 ermm_erp_po', sql: `SELECT YYYY_MM, ROUND(SUM(po_amount),2) v FROM ermm_erp_po WHERE YYYY_MM LIKE '2023-%' GROUP BY YYYY_MM` },
    { name: '销售明细 mgm_invoice_details(AR)', sql: `SELECT YYYY_MM, ROUND(SUM(sub_amt),2) v FROM mgm_invoice_details WHERE YYYY_MM LIKE '2023-%' AND TX_type='AR' GROUP BY YYYY_MM` },
    { name: '现金收入 mgm_casher(DR)', sql: `SELECT YYYY_MM, ROUND(SUM(CASE WHEN DB_CR IN ('DR','借') THEN sub_amt ELSE 0 END),2) v FROM mgm_casher_details WHERE YYYY_MM LIKE '2023-%' GROUP BY YYYY_MM` },
    { name: '现金支出 mgm_casher(CR)', sql: `SELECT YYYY_MM, ROUND(SUM(CASE WHEN DB_CR IN ('CR','贷') THEN sub_amt ELSE 0 END),2) v FROM mgm_casher_details WHERE YYYY_MM LIKE '2023-%' GROUP BY YYYY_MM` },
    { name: '应收 ermm_arap_detail(AR)', sql: `SELECT YYYY_MM, ROUND(SUM(AR_amt),2) v FROM ermm_arap_detail WHERE YYYY_MM LIKE '2023-%' GROUP BY YYYY_MM` },
    { name: '应付 ermm_arap_detail(AP)', sql: `SELECT YYYY_MM, ROUND(SUM(AP_amt),2) v FROM ermm_arap_detail WHERE YYYY_MM LIKE '2023-%' GROUP BY YYYY_MM` },
    { name: '订单价值 ermm_erp_so(qty×price)', sql: `SELECT YYYY_MM, ROUND(SUM(so_qty*unit_price),2) v FROM ermm_erp_so WHERE YYYY_MM LIKE '2023-%' GROUP BY YYYY_MM` },
    { name: '预测订单 forecast_detail(Sales)', sql: `SELECT YYYY_MM, ROUND(SUM(forecast_amt),2) v FROM forecast_detail WHERE YYYY_MM LIKE '2023-%' AND forecast_type='Sales' GROUP BY YYYY_MM` },
    { name: '库存价值 e2_xitems(stock_value)', sql: `SELECT DATE_FORMAT(stock_date,'%Y-%m') ym, ROUND(SUM(stock_value),2) v FROM e2_xitems_daily_status WHERE stock_date BETWEEN '2023-01-01' AND '2023-12-31' GROUP BY ym` },
    { name: '库存跌价 e2_xitems(current_lose)', sql: `SELECT DATE_FORMAT(stock_date,'%Y-%m') ym, ROUND(SUM(current_lose),2) v FROM e2_xitems_daily_status WHERE stock_date BETWEEN '2023-01-01' AND '2023-12-31' GROUP BY ym` },
    { name: '呆帐明细 mgm_account(呆帐损失)', sql: `SELECT YYYY_MM, ROUND(SUM(sub_amt),2) v FROM mgm_account_details WHERE YYYY_MM LIKE '2023-%' AND sub_group='呆帐损失' GROUP BY YYYY_MM` },
    { name: '出货价值 ermm_erp_so_dn(DN_qty×单价)', sql: `SELECT DATE_FORMAT(d.DN_date,'%Y-%m') ym, ROUND(SUM(d.DN_qty*s.unit_price),2) v FROM ermm_erp_so_dn d JOIN ermm_erp_so s ON s.so_nbr=d.so_nbr WHERE d.DN_date BETWEEN '2023-01-01' AND '2023-12-31' GROUP BY ym` },
];

async function main() {
    for (const { name, sql } of QUERIES) {
        const [rows] = await pool.execute(sql);
        const map = Object.fromEntries(rows.map(r => [r.ym || r.YYYY_MM, Number(r.v)]));
        const vals = Array.from({ length: 12 }, (_, i) => map[`2023-${pad2(i + 1)}`] || 0);
        console.log(`\n■ ${name}`);
        console.log('  月份:    ' + vals.map((_, i) => pad2(i + 1).padStart(12)).join(''));
        console.log('  金额:    ' + vals.map(v => v.toLocaleString('en-US', { maximumFractionDigits: 0 }).padStart(12)).join(''));
        const growth = vals.map((v, i) => i === 0 ? '—' : (vals[i - 1] ? ((v / vals[i - 1] - 1) * 100).toFixed(1) + '%' : 'n/a'));
        const target = RATES.map(r => r === '—' ? '—' : (r * 100).toFixed(0) + '%');
        console.log('  实际成长: ' + growth.map(g => g.padStart(12)).join(''));
        console.log('  目标成长: ' + target.map(t => t.padStart(12)).join(''));
        const okCount = growth.filter((g, i) => i > 0 && g !== 'n/a' && Math.abs(parseFloat(g) - RATES[i] * 100) < 0.5).length;
        console.log(`  ✅ 符合目标: ${okCount}/11 个月（误差<0.5%）`);
    }

    // 笔数统计
    const counts = [
        ['ermm_erp_po', `SELECT COUNT(*) c FROM ermm_erp_po WHERE YYYY_MM LIKE '2023-%'`],
        ['ermm_erp_so', `SELECT COUNT(*) c FROM ermm_erp_so WHERE YYYY_MM LIKE '2023-%'`],
        ['ermm_erp_so_dn', `SELECT COUNT(*) c FROM ermm_erp_so_dn WHERE DN_date BETWEEN '2023-01-01' AND '2023-12-31'`],
        ['mgm_invoice_details(AR)', `SELECT COUNT(*) c FROM mgm_invoice_details WHERE YYYY_MM LIKE '2023-%' AND TX_type='AR'`],
        ['mgm_casher_details', `SELECT COUNT(*) c FROM mgm_casher_details WHERE YYYY_MM LIKE '2023-%'`],
        ['ermm_arap_detail', `SELECT COUNT(*) c FROM ermm_arap_detail WHERE YYYY_MM LIKE '2023-%'`],
        ['forecast_detail', `SELECT COUNT(*) c FROM forecast_detail WHERE YYYY_MM LIKE '2023-%'`],
        ['e2_xitems_daily_status', `SELECT COUNT(*) c FROM e2_xitems_daily_status WHERE stock_date BETWEEN '2023-01-01' AND '2023-12-31'`],
        ['mgm_account_details(呆帐)', `SELECT COUNT(*) c FROM mgm_account_details WHERE YYYY_MM LIKE '2023-%' AND sub_group='呆帐损失'`],
    ];
    console.log('\n===== 笔数统计 =====');
    let total = 0;
    for (const [n, s] of counts) {
        const [[r]] = await pool.execute(s);
        total += r.c;
        console.log(`${n.padEnd(30)} ${r.c} 笔`);
    }
    console.log(`${'合计'.padEnd(28)} ${total} 笔`);
    await pool.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
