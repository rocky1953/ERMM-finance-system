/**
 * 將 2024/11 的資料按月 7% 複利成長，外推到 2024/12 ~ 2025/12
 * 四張表：mgm_finance_summary, mgm_invoice_details, pay_detail, ermm_arap_detail
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASS || 'ld68315711',
        database: process.env.DB_NAME || 'ERMM_db',
        multipleStatements: true
    });

    const BUS = ['HM', 'HN', 'SZ'];
    const START_BASE_MONTH = '2024/11';     // 從這月復製並外推
    const TARGET_START = '2024/12';         // 第一個要生成的月份
    const TARGET_END = '2025/12';           // 最後一個月份
    const GROWTH = 1.07;                    // 每月成長率

    // 生成月份列表
    function genMonths(from, to) {
        const [fy, fm] = from.split('/').map(Number);
        const [ty, tm] = to.split('/').map(Number);
        const list = [];
        let y = fy, m = fm;
        while (y < ty || (y === ty && m <= tm)) {
            list.push(`${y}/${String(m).padStart(2, '0')}`);
            m++;
            if (m > 12) { m = 1; y++; }
        }
        return list;
    }
    const targetMonths = genMonths(TARGET_START, TARGET_END);
    console.log(`要生成的月份: ${targetMonths.length} 個月 (${TARGET_START} ~ ${TARGET_END})`);

    for (const bu_no of BUS) {
        console.log(`\n===== BU: ${bu_no} =====`);

        // 1. 讀取 2024/11 基準 summary
        const [baseRows] = await pool.execute(
            'SELECT * FROM MGM_finance_summary WHERE bu_no=? AND YYYY_MM=?',
            [bu_no, START_BASE_MONTH]
        );
        if (baseRows.length === 0) { console.error(`找不到 ${bu_no} ${START_BASE_MONTH} 的 summary`); continue; }
        const base = baseRows[0];

        // 固定欄位（不成長）
        const FIXED_FIELDS = ['bu_no', 'flag', 'captial_stock', 'captial_reserve', 'legal_reserve',
                              'VAT_rate', 'batch_id', 'Z_X1', 'Z_X2', 'Z_X3', 'Z_X4', 'Z_X5',
                              'employee_cnt', 'exchange_rate'];

        // 2. 生成每個月的 summary
        for (let i = 0; i < targetMonths.length; i++) {
            const ym = targetMonths[i];
            const factor = Math.pow(GROWTH, i + 1);  // 第 1 個月 (2024/12) = 1.07^1

            // 先檢查是否已存在
            const [exist] = await pool.execute(
                'SELECT uid FROM MGM_finance_summary WHERE bu_no=? AND YYYY_MM=?',
                [bu_no, ym]
            );
            if (exist.length > 0) { console.log(`  [跳過] summary ${bu_no} ${ym} 已存在`); continue; }

            const [yyyy, mm] = ym.split('/');
            const row = { ...base };
            row.bu_no = bu_no;
            row.YYYY_MM = ym;
            row.YYYY = yyyy;
            row.MM = mm;

            // 金額欄位全部乘以 factor（除了固定欄位和已計算的欄位）
            for (const k of Object.keys(row)) {
                if (FIXED_FIELDS.includes(k)) continue;
                if (['uid', 'YYYY', 'MM', 'YYYY_MM', 'flag', 'create_time', 'update_time'].includes(k)) continue;
                if (typeof row[k] === 'number' && row[k] !== 0) {
                    row[k] = Math.round(row[k] * factor * 100) / 100;
                } else if (typeof row[k] === 'string' && /^\d/.test(row[k]) && !isNaN(Number(row[k]))) {
                    const n = Number(row[k]);
                    if (n !== 0) row[k] = String(Math.round(n * factor * 100) / 100);
                }
            }

            // 確保 A = L + E：accumulated_amt = assets - liabilities - 股本 - 資本公積 - current_PL
            const totalAsset = Number(row.ttl_asset_amt || 0);
            const totalDebet = Number(row.ttl_debet_amt || 0);
            const equityCap = Number(row.captial_stock || 0) + Number(row.captial_reserve || 0) + Number(row.legal_reserve || 0);
            const currentPL = Number(row.current_PL_amt || 0);
            row.accumulated_amt = Math.round((totalAsset - totalDebet - equityCap - currentPL) * 100) / 100;
            row.stockholder_amt = Math.round((totalAsset - totalDebet) * 100) / 100;
            // retained_income 跟 accumulated 同步
            row.retained_income_amt = row.accumulated_amt;

            // 用參數化 INSERT — 動態生成 SQL
            const cols = Object.keys(row).filter(k => k !== 'uid' && k !== 'create_time' && k !== 'update_time');
            const placeholders = cols.map(() => '?').join(',');
            const sql = `INSERT INTO MGM_finance_summary (${cols.join(',')}) VALUES (${placeholders})`;
            const vals = cols.map(c => {
                const v = row[c];
                return (v === null || v === undefined) ? null : v;
            });

            await pool.execute(sql, vals);
            console.log(`  [OK] summary ${bu_no} ${ym} sale=${row.sale_amt} net_profit=${row.net_profit_amt}`);
        }

        // 3. 發票明細：從 2024/11 複製，改日期和金額
        for (let i = 0; i < targetMonths.length; i++) {
            const ym = targetMonths[i];
            const factor = Math.pow(GROWTH, i + 1);
            const [yyyy, mm] = ym.split('/').map(Number);

            const [existInv] = await pool.execute(
                'SELECT uid FROM MGM_invoice_details WHERE bu_no=? AND YYYY_MM=? LIMIT 1',
                [bu_no, ym]
            );
            if (existInv.length > 0) continue;

            const [baseInvs] = await pool.execute(
                'SELECT * FROM MGM_invoice_details WHERE bu_no=? AND YYYY_MM=?',
                [bu_no, START_BASE_MONTH]
            );

            let insertCount = 0;
            for (const inv of baseInvs) {
                const day = Math.max(1, Math.min(28, parseInt(String(inv.wk_date).slice(-2)) || 15));
                const wk_date = `${yyyy}-${String(mm).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                const payDateDay = Math.max(1, Math.min(28, parseInt(String(inv.pay_date || inv.wk_date).slice(-2)) || 20));
                const pay_date = `${yyyy}-${String(mm).padStart(2,'0')}-${String(payDateDay).padStart(2,'0')}`;

                // 生成新發票號碼
                const seq = String(inv.uid).padStart(3, '0');
                const newInvNo = `${inv.TX_type}${bu_no}${yyyy}${String(mm).padStart(2,'0')}${seq}`;

                const sub_amt = Math.round(Number(inv.sub_amt || 0) * factor * 100) / 100;
                const VAT_amt = Math.round(Number(inv.VAT_amt || 0) * factor * 100) / 100;
                const payment = Math.round(Number(inv.payment || 0) * factor * 100) / 100;

                await pool.execute(`
                    INSERT INTO MGM_invoice_details
                    (bu_no, TX_type, order_id, client_id, invoice_no, sub_amt, tax_type, tax_rate,
                     VAT_amt, wk_date, pay_date, payment, ageing_days, DB_CR, YYYY_MM, remark)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                `, [
                    bu_no, inv.TX_type, inv.order_id, inv.client_id, newInvNo,
                    sub_amt, inv.tax_type, inv.tax_rate, VAT_amt,
                    wk_date, pay_date, payment,
                    inv.ageing_days, inv.DB_CR, ym, inv.remark
                ]);
                insertCount++;
            }
            if (insertCount > 0) console.log(`  [OK] invoice ${bu_no} ${ym}: 新增 ${insertCount} 張`);
        }

        // 4. 付款明細：從 2024/11 複製，改日期和金額
        for (let i = 0; i < targetMonths.length; i++) {
            const ym = targetMonths[i];
            const factor = Math.pow(GROWTH, i + 1);
            const [yyyy, mm] = ym.split('/').map(Number);

            // pay_detail 沒有 YYYY_MM 欄位，用 should_date 判斷
            const [existPay] = await pool.execute(`
                SELECT uid FROM pay_detail WHERE bu_no=? AND DATE_FORMAT(should_date,'%Y/%m')=? LIMIT 1
            `, [bu_no, ym]);
            if (existPay.length > 0) continue;

            const [basePays] = await pool.execute(`
                SELECT * FROM pay_detail WHERE bu_no=? AND DATE_FORMAT(should_date,'%Y/%m')=?
            `, [bu_no, START_BASE_MONTH]);

            let insertCount = 0;
            for (const p of basePays) {
                const day = Math.max(1, Math.min(28, parseInt(String(p.should_date).slice(-2)) || 25));
                const should_date = `${yyyy}-${String(mm).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                const invDateDay = Math.max(1, Math.min(28, parseInt(String(p.invoice_date || p.should_date).slice(-2)) || 10));
                const invoice_date = `${yyyy}-${String(mm).padStart(2,'0')}-${String(invDateDay).padStart(2,'0')}`;
                const payDateDay = Math.max(1, Math.min(28, parseInt(String(p.pay_date || '').slice(-2)) || 0));
                const pay_date = p.pay_date ? `${yyyy}-${String(mm).padStart(2,'0')}-${String(payDateDay).padStart(2,'0')}` : null;

                const newInvNum = p.invoice_num ? p.invoice_num.replace(/2024|2025/g, String(yyyy)) : null;
                const amount = Math.round(Number(p.amount || 0) * factor * 100) / 100;

                await pool.execute(`
                    INSERT INTO pay_detail
                    (bu_no, supplier_name, finance_type, should_date, invoice_date, amount, currency_ab,
                     invoice_num, pay_date, expense_content, remark, entry_date, data_year)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                `, [
                    bu_no, p.supplier_name, p.finance_type, should_date, invoice_date,
                    amount, p.currency_ab, newInvNum, pay_date,
                    p.expense_content, p.remark, invoice_date, String(yyyy)
                ]);
                insertCount++;
            }
            if (insertCount > 0) console.log(`  [OK] pay ${bu_no} ${ym}: 新增 ${insertCount} 筆`);
        }

        // 5. ARAP 彙總：直接從新的 summary 寫 AR_amt / AP_amt
        for (let i = 0; i < targetMonths.length; i++) {
            const ym = targetMonths[i];
            const factor = Math.pow(GROWTH, i + 1);
            const [yyyy] = ym.split('/');

            const [existARAP] = await pool.execute(
                'SELECT uid FROM ERMM_ARAP_detail WHERE bu_no=? AND YYYY_MM=?',
                [bu_no, ym]
            );
            if (existARAP.length > 0) continue;

            const ar_amt = Math.round(Number(base.AR_amt || 0) * factor * 100) / 100;
            const ap_amt = Math.round(Number(base.AP_amt || 0) * factor * 100) / 100;
            const ar_ageing = Math.round(ar_amt * 0.3 * 100) / 100;
            const ap_ageing = Math.round(ap_amt * 0.3 * 100) / 100;

            await pool.execute(`
                INSERT INTO ERMM_ARAP_detail (bu_no, YYYY, YYYY_MM, AR_amt, AP_amt, AR_ageing, AP_ageing, batch_id)
                VALUES (?,?,?,?,?,?,?,?)
            `, [bu_no, yyyy, ym, ar_amt, ap_amt, ar_ageing, ap_ageing, 'EXTEND']);

            console.log(`  [OK] arap ${bu_no} ${ym}: AR=${ar_amt} AP=${ap_amt}`);
        }
    }

    console.log('\n===== 完成！=====');
    await pool.end();
}

main().catch(err => { console.error('ERROR:', err); process.exit(1); });
