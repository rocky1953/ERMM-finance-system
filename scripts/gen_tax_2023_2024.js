const { pool } = require('../config/db');
const fs = require('fs');

// RUID 生成
function ruid(prefix) {
    const now = new Date();
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    const ts = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const rand = Math.floor(Math.random() * 1e6).toString().padStart(6, '0');
    return `${prefix}${ts}${rand}`;
}

(async () => {
    // 清除 2023/2024 已有（如果重复跑）
    const [old] = await pool.execute(`
        DELETE FROM fin_tax_return_item WHERE return_id IN (
            SELECT return_id FROM fin_tax_return WHERE tax_period LIKE '2023%' OR tax_period LIKE '2024%'
        )`);
    const [old2] = await pool.execute(`DELETE FROM fin_tax_return WHERE tax_period LIKE '2023%' OR tax_period LIKE '2024%'`);
    const [old3] = await pool.execute(`DELETE FROM tax_cit_inputs WHERE tax_year IN ('2023','2024')`);
    console.log('CLEANED: returns=' + old2.affectedRows + ' items=' + old.affectedRows + ' cit_inputs=' + old3.affectedRows);

    const bus = ['HM', 'HN', 'SZ'];
    const years = ['2023', '2024'];
    let totalReturns = 0, totalItems = 0;

    // ========== 1) VAT 按月 ==========
    for (const bu of bus) {
        for (const yr of years) {
            for (let mo = 1; mo <= 12; mo++) {
                const period = `${yr}-${String(mo).padStart(2,'0')}`;
                const [inv] = await pool.execute(`
                    SELECT
                        COALESCE(SUM(CASE WHEN TX_type='AR' THEN sub_amt ELSE 0 END),0) AS sale,
                        COALESCE(SUM(CASE WHEN TX_type='AR' THEN VAT_amt ELSE 0 END),0) AS output_vat,
                        COALESCE(SUM(CASE WHEN TX_type='AP' THEN sub_amt ELSE 0 END),0) AS purchase,
                        COALESCE(SUM(CASE WHEN TX_type='AP' THEN VAT_amt ELSE 0 END),0) AS input_vat
                    FROM mgm_invoice_details
                     WHERE bu_no=? AND YYYY_MM=? AND tax_type='VAT'
                `, [bu, period]);
                const d = inv[0];
                if (Number(d.sale) === 0 && Number(d.output_vat) === 0) continue; // 无资料跳过

                const taxable = Number(d.sale);           // 应税销售额（不含税）
                const outputVat = Number(d.output_vat);
                const inputVat = Number(d.input_vat);
                const netVat = Math.max(0, outputVat - inputVat); // 应缴增值税

                const retRuid = ruid(`R${bu}`);
                const filedDate = `${period}-15 10:00:00`;
                const receiptNo = `RX${bu}${period.replace('-','')}${String(Math.floor(Math.random()*9000)+1000)}`;

                const [ins] = await pool.execute(`
                    INSERT INTO fin_tax_return
                        (bu_no, ruid, tax_type, tax_period, taxable_amount, tax_amount, status, filed_time, receipt_no, remark, create_time, update_time)
                    VALUES (?, ?, 'VAT', ?, ?, ?, 'FILED', ?, ?, ?, NOW(), NOW())
                `, [bu, retRuid, period, taxable, netVat, filedDate, receiptNo, `${period} 增值税申报`]);
                const returnId = ins.insertId;
                totalReturns++;

                // 明细：销项、进项、应缴
                const items = [
                    [returnId, ruid(`I${bu}`), '2221', '增值税-销项税额', taxable, 0.13, outputVat, ''],
                    [returnId, ruid(`I${bu}`), '2221', '增值税-进项税额（可抵扣）', Number(d.purchase), 0.13, inputVat, ''],
                    [returnId, ruid(`I${bu}`), '2221', '增值税-应纳税额', taxable, 0.13, netVat, '=销项-进项']
                ];
                for (const it of items) {
                    await pool.execute(`
                        INSERT INTO fin_tax_return_item
                            (return_id, ruid, subject_code, item_name, taxable_amount, tax_rate, tax_amount, remark)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `, it);
                    totalItems++;
                }

                // 申报回执
                await pool.execute(`
                    INSERT INTO tax_submit_receipts
                        (module, biz_id, tax_bureau_receipt_no, submit_time, status, payment_deadline, operator_id, raw_response)
                    VALUES ('VAT', ?, ?, ?, 'SUCCESS', DATE_ADD(?, INTERVAL 15 DAY), 'tax-bot', '{"ok":true}')
                `, [retRuid, receiptNo, filedDate, filedDate]);
            }
        }
    }

    // ========== 2) CIT 年度企业所得税 ==========
    for (const bu of bus) {
        for (const yr of years) {
            const [fs] = await pool.execute(`
                SELECT
                    COALESCE(SUM(sale_amt),0) sale,
                    COALESCE(SUM(BIZ_major_margin_amt),0) margin,
                    COALESCE(SUM(sale_exp_amt),0) sale_exp,
                    COALESCE(SUM(MGM_EXP_amt),0) mgm_exp,
                    COALESCE(SUM(finance_EXP_amt),0) fin_exp
                  FROM mgm_finance_summary
                 WHERE bu_no=? AND YYYY_MM LIKE ?
            `, [bu, yr + '%']);
            const f = fs[0];
            const revenue = Number(f.sale);
            const cost = revenue - Number(f.margin);   // 倒推销售成本 = 收入 - 毛利
            const expenses = Number(f.sale_exp) + Number(f.mgm_exp) + Number(f.fin_exp);
            const taxableIncome = Math.max(0, revenue - cost - expenses); // 应纳税所得额
            const taxRate = 0.25;
            const taxAmount = Number((taxableIncome * taxRate).toFixed(2));

            // tax_cit_inputs
            await pool.execute(`
                INSERT INTO tax_cit_inputs
                    (bu_no, tax_year, tax_rate, accum_prepaid_tax, withheld_tax, updated_by, create_time, update_time)
                VALUES (?, ?, ?, 0, 0, 'tax-bot', NOW(), NOW())
                ON DUPLICATE KEY UPDATE tax_rate=VALUES(tax_rate), update_time=NOW()
            `, [bu, yr, taxRate]);

            // 主 return（年度）
            const retRuid = ruid(`C${bu}`);
            const filedDate = `${yr}-05-31 16:00:00`;
            const receiptNo = `RCIT${bu}${yr}${String(Math.floor(Math.random()*9000)+1000)}`;

            const [ins] = await pool.execute(`
                INSERT INTO fin_tax_return
                    (bu_no, ruid, tax_type, tax_period, taxable_amount, tax_amount, status, filed_time, receipt_no, remark, create_time, update_time)
                VALUES (?, ?, 'CIT', ?, ?, ?, 'FILED', ?, ?, ?, NOW(), NOW())
            `, [bu, retRuid, yr, taxableIncome, taxAmount, filedDate, receiptNo, `${yr}年度企业所得税汇算清缴`]);
            const returnId = ins.insertId;
            totalReturns++;

            const items = [
                [returnId, ruid(`I${bu}`), '6001', '营业收入', revenue, 0, 0, ''],
                [returnId, ruid(`I${bu}`), '6401', '营业成本', cost, 0, 0, '倒推：收入-毛利'],
                [returnId, ruid(`I${bu}`), '6601', '期间费用', expenses, 0, 0, '销售+管理+财务'],
                [returnId, ruid(`I${bu}`), '2222', '应纳税所得额', taxableIncome, 0.25, taxAmount, '=(收入-成本-费用)×25%']
            ];
            for (const it of items) {
                await pool.execute(`
                    INSERT INTO fin_tax_return_item
                        (return_id, ruid, subject_code, item_name, taxable_amount, tax_rate, tax_amount, remark)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, it);
                totalItems++;
            }

            await pool.execute(`
                INSERT INTO tax_submit_receipts
                    (module, biz_id, tax_bureau_receipt_no, submit_time, status, payment_deadline, operator_id, raw_response)
                VALUES ('CIT', ?, ?, ?, 'SUCCESS', DATE_ADD(?, INTERVAL 30 DAY), 'tax-bot', '{"ok":true}')
            `, [retRuid, receiptNo, filedDate, filedDate]);
        }
    }

    console.log(`\n✅ DONE: returns=${totalReturns}, items=${totalItems}`);

    // 验证
    const [cnt] = await pool.execute(`SELECT tax_type, tax_period, COUNT(*) n FROM fin_tax_return WHERE tax_period LIKE '2023%' OR tax_period LIKE '2024%' GROUP BY tax_type, tax_period ORDER BY tax_type, tax_period`);
    console.log('VERIFY=' + JSON.stringify(cnt));

    await pool.end();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
