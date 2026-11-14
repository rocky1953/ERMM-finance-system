/**
 * 收款核销匹配服务
 * 匹配对象：AR Invoice (mgm_invoice_details TX_type='AR') ← Receipt (receipt_detail)
 * 匹配键：invoice_uid (一條 receipt 對一張發票)
 */

// 金额容差（绝对值）
const AMT_TOL = 0.02;

function calcStatus(invoiceAmt, receiptAmt, priorPayment) {
    const paidTotal = Number(priorPayment || 0) + Number(receiptAmt || 0);
    const hasReceipt = receiptAmt > 0;

    if (!hasReceipt && Number(priorPayment || 0) === 0) return 'UNPAID';     // 完全未收
    if (Math.abs(paidTotal - invoiceAmt) <= AMT_TOL) return 'PAID_FULL';     // 容差内 → 全额
    if (paidTotal > invoiceAmt + AMT_TOL) return 'OVER_PAID';                // 收款超额
    return 'PARTIAL';                                                        // 部分收款
}

/**
 * 执行收款核销匹配
 */
async function runMatch(conn, { YYYY_MM, bu_no } = {}) {
    // 1. 只清未 settle 的行；已 settle 保留
    let delSql = 'DELETE FROM ar_match_result WHERE (receipt_settled=0 OR receipt_settled IS NULL)';
    const delParams = [];
    if (YYYY_MM) { delSql += ' AND YYYY_MM=?'; delParams.push(YYYY_MM); }
    if (bu_no) { delSql += ' AND bu_no=?'; delParams.push(bu_no); }
    await conn.execute(delSql, delParams);

    // 2. 聚合 AR 发票
    let invFilter = `i.TX_type='AR' AND i.sub_amt > 0`;
    const invParams = [];
    if (YYYY_MM) { invFilter += ' AND i.YYYY_MM=?'; invParams.push(YYYY_MM); }
    if (bu_no) { invFilter += ' AND i.bu_no=?'; invParams.push(bu_no); }

    const [invs] = await conn.execute(`
        SELECT i.uid AS invoice_uid, i.invoice_no, i.order_id, i.client_id, i.bu_no,
               i.sub_amt, i.payment AS prior_payment, i.pay_date, i.DB_CR,
               i.VAT_amt, i.wk_date, i.YYYY_MM
        FROM mgm_invoice_details i
        WHERE ${invFilter}
        ORDER BY i.uid
    `, invParams);

    // 3. 聚合 receipt（按 invoice_uid 汇总一张发票的所有收款）
    const [rcpts] = await conn.execute(`
        SELECT invoice_uid, bu_no,
               SUM(receipt_amt) AS receipt_amt,
               MIN(receipt_date) AS first_rcpt_date,
               MAX(receipt_date) AS last_rcpt_date,
               COUNT(*) AS rcpt_count
        FROM receipt_detail
        WHERE invoice_uid IS NOT NULL
        GROUP BY invoice_uid, bu_no
    `);
    const rcptMap = {};
    for (const r of rcpts) rcptMap[r.invoice_uid] = r;

    // 4. 已 settle 的 invoice_uid 集合 → 跳过重建
    const [settled] = await conn.execute(
        'SELECT DISTINCT invoice_uid FROM ar_match_result WHERE receipt_settled=1'
    );
    const settledSet = new Set(settled.map(s => s.invoice_uid));

    // 5. 组合
    const results = [];
    for (const inv of invs) {
        if (settledSet.has(inv.invoice_uid)) continue;

        const rc = rcptMap[inv.invoice_uid] || {};
        const invoiceAmt = Number(inv.sub_amt || 0);
        const priorPayment = Number(inv.prior_payment || 0);
        const receiptAmt = Number(rc.receipt_amt || 0);
        const unpaidAmt = invoiceAmt - priorPayment;

        const status = calcStatus(invoiceAmt, receiptAmt, priorPayment);
        const diffAmt = (receiptAmt + priorPayment) - invoiceAmt;

        results.push({
            YYYY_MM: inv.YYYY_MM || '',
            bu_no: inv.bu_no,
            invoice_uid: inv.invoice_uid,
            invoice_no: inv.invoice_no,
            receipt_uid: rc.invoice_uid ? (rc.rcpt_count === 1 ? null : null) : null, // receipt 聚合, 无单一 uid
            client_id: inv.client_id,
            order_id: inv.order_id,
            invoice_amt: invoiceAmt,
            receipt_amt: receiptAmt,
            prior_payment: priorPayment,
            unpaid_amt: unpaidAmt,
            vat_amount: Number(inv.VAT_amt || 0),
            match_status: status,
            diff_amount: diffAmt,
            auto_matched: 1,
            create_time: new Date()
        });
    }

    // 6. 写入
    let paidFull = 0, partial = 0, unpaid = 0, overPaid = 0;
    for (const r of results) {
        await conn.execute(`
            INSERT INTO ar_match_result
                (YYYY_MM, bu_no, invoice_uid, invoice_no, receipt_uid,
                 client_id, order_id, invoice_amt, receipt_amt, prior_payment, unpaid_amt, vat_amount,
                 match_status, diff_amount, auto_matched, create_time)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, NOW())`,
            [r.YYYY_MM, r.bu_no, r.invoice_uid, r.invoice_no, r.receipt_uid,
             r.client_id, r.order_id, r.invoice_amt, r.receipt_amt, r.prior_payment, r.unpaid_amt, r.vat_amount,
             r.match_status, r.diff_amount, r.auto_matched]
        );
        if (r.match_status === 'PAID_FULL') paidFull++;
        else if (r.match_status === 'PARTIAL') partial++;
        else if (r.match_status === 'OVER_PAID') overPaid++;
        else unpaid++;
    }
    return { total: results.length, paid_full: paidFull, partial, unpaid, over_paid: overPaid };
}

module.exports = { runMatch, calcStatus };
