/**
 * PO 三单匹配服务（CFO-04）
 * 匹配对象：ermm_erp_po ← po_grn ← mgm_invoice_details (TX_type='AP')
 *
 * 关联优先级：
 *   1. 发票 order_id = PO po_id（精确）
 *   2. 供应商名称完全一致 + 同月份
 *   3. 供应商名称互相包含 + 同月份 + 金额差异率在容差内
 * 无法关联的发票计入 EXCESS（有票无单），无法关联的 PO 计入 UNMATCHED。
 */

const QTY_TOL_DEFAULT = 0.001;   // 数量绝对容差
const AMT_TOL_DEFAULT = 0.02;    // 金额绝对容差
const AMT_RATE_TOL_DEFAULT = 5;  // 金额差异率容差（%）

function calcStatus(poQty, grnQty, invQty, poAmt, grnAmt, invAmt, opts) {
    const { qtyTol, amtTol, amtRateTol } = opts;
    const hasPo = poQty > 0 || poAmt > 0;
    const hasGrn = grnQty > 0 || grnAmt > 0;
    const hasInv = invAmt > 0;

    if (!hasPo && !hasInv) return 'UNMATCHED';
    if (!hasPo && hasInv) return 'EXCESS';          // 有发票无 PO
    if (hasPo && !hasGrn && !hasInv) return 'UNMATCHED'; // 未收货未开票
    if (hasPo && hasGrn && !hasInv) return 'PARTIAL';    // 已收货未开票
    if (hasPo && grnQty === 0 && grnAmt === 0 && hasInv) return 'NO_GRN'; // 有 PO 有票无收货

    // 三单齐全：数量以 GRN 为实际值；发票有数量时校验数量，否则只校验金额
    const qtyOk = invQty === 0 ? true : Math.abs(grnQty - invQty) <= qtyTol;
    const amtDiff = Math.abs(grnAmt - invAmt);
    const rate = grnAmt > 0 ? (amtDiff / grnAmt) * 100 : 0;
    const amtOk = amtDiff <= amtTol || rate <= amtRateTol;

    if (qtyOk && amtOk) return 'MATCHED';
    if (!qtyOk && amtOk) return 'DIFF_QTY';
    if (qtyOk && !amtOk) return 'DIFF_AMT';
    return 'PARTIAL';
}

function normName(s) {
    return String(s || '').replace(/[\s（）()]/g, '').toLowerCase();
}

/**
 * 执行三单匹配（重建指定范围）
 * @param {Object} conn
 * @param {Object} opts { YYYY_MM, bu_no, qtyTol, amtTol, amtRateTol }
 */
async function runMatch(conn, { YYYY_MM, bu_no, qtyTol, amtTol, amtRateTol } = {}) {
    const tol = {
        qtyTol: qtyTol != null ? Number(qtyTol) : QTY_TOL_DEFAULT,
        amtTol: amtTol != null ? Number(amtTol) : AMT_TOL_DEFAULT,
        amtRateTol: amtRateTol != null ? Number(amtRateTol) : AMT_RATE_TOL_DEFAULT
    };

    // 1. 清理旧结果：保留已核销、已处置的行
    let delSql = `DELETE FROM po_match_result
                  WHERE COALESCE(ap_settled,0)=0
                    AND handle_status='PENDING'`;
    const delParams = [];
    if (YYYY_MM) { delSql += ' AND YYYY_MM=?'; delParams.push(YYYY_MM); }
    if (bu_no) { delSql += ' AND bu_no=?'; delParams.push(bu_no); }
    await conn.execute(delSql, delParams);

    // 2. PO 聚合
    let poFilter = 'po.po_amount IS NOT NULL AND po.po_amount > 0';
    const poParams = [];
    if (YYYY_MM) { poFilter += ' AND po.YYYY_MM=?'; poParams.push(YYYY_MM); }
    if (bu_no) { poFilter += ' AND po.bu_no=?'; poParams.push(bu_no); }

    const [pos] = await conn.execute(`
        SELECT po.uid AS po_uid, po.po_id, po.bu_no, po.supplier_name, po.xitems,
               po.YYYY_MM,
               SUM(po.po_qty) AS po_qty, SUM(po.po_amount_local) AS po_amount,
               MAX(po.unit_price) AS unit_price
        FROM ermm_erp_po po
        WHERE ${poFilter}
        GROUP BY po.uid, po.po_id, po.bu_no, po.supplier_name, po.xitems, po.YYYY_MM
        ORDER BY po.po_id
    `, poParams);

    // 3. GRN 聚合（按 po_uid + xitems）
    const grnParams = [];
    let grnFilter = '1=1';
    if (bu_no) { grnFilter += ' AND bu_no=?'; grnParams.push(bu_no); }
    if (YYYY_MM) { grnFilter += ` AND DATE_FORMAT(grn_date,'%Y-%m')=?`; grnParams.push(YYYY_MM); }
    const [grns] = await conn.execute(`
        SELECT po_uid, bu_no, po_id, xitems,
               SUM(grn_qty) AS grn_qty, SUM(grn_amount) AS grn_amount
        FROM po_grn
        WHERE ${grnFilter}
        GROUP BY po_uid, bu_no, po_id, xitems
    `, grnParams);

    // 4. AP 发票聚合（不过滤借贷方向，历史数据存在 DR/CR/DB/NULL 混用）
    const invParams = [];
    let invFilter = "TX_type='AP' AND COALESCE(sub_amt,0) > 0";
    if (YYYY_MM) { invFilter += ' AND YYYY_MM=?'; invParams.push(YYYY_MM); }
    if (bu_no) { invFilter += ' AND bu_no=?'; invParams.push(bu_no); }
    const [invs] = await conn.execute(`
        SELECT uid, bu_no, order_id AS po_id, client_id AS supplier_name,
               invoice_no, wk_date, YYYY_MM,
               COALESCE(sub_amt,0) AS inv_amount, COALESCE(VAT_amt,0) AS vat_amount
        FROM mgm_invoice_details
        WHERE ${invFilter}
        ORDER BY wk_date
    `, invParams);

    // 5. 已固定的行（已核销或已处置）——不重建
    const [fixed] = await conn.execute(
        `SELECT DISTINCT bu_no, po_uid FROM po_match_result
         WHERE COALESCE(ap_settled,0)=1 OR handle_status<>'PENDING'`
    );
    const fixedSet = new Set(fixed.map(s => `${s.bu_no}|${s.po_uid}`));

    // 6. 建索引
    const grnMap = {};
    for (const g of grns) grnMap[`${g.bu_no}|${g.po_id}|${g.xitems}`] = g;

    const invByPoId = {};   // bu_no|po_id → 发票
    for (const i of invs) {
        if (i.po_id) invByPoId[`${i.bu_no}|${i.po_id}`] = i;
    }
    const invBySupplier = {}; // bu_no|supplier → [发票]
    for (const i of invs) {
        const k = `${i.bu_no}|${normName(i.supplier_name)}`;
        (invBySupplier[k] = invBySupplier[k] || []).push(i);
    }
    const invByMonth = {};    // bu_no|YYYY_MM → [发票]
    for (const i of invs) {
        const k = `${i.bu_no}|${i.YYYY_MM}`;
        (invByMonth[k] = invByMonth[k] || []).push(i);
    }

    const usedInvoice = new Set();
    const results = [];

    for (const po of pos) {
        if (fixedSet.has(`${po.bu_no}|${po.po_uid}`)) continue;

        const g = grnMap[`${po.bu_no}|${po.po_id}|${po.xitems}`] || {};
        const poQty = Number(po.po_qty || 0);
        const poAmt = Number(po.po_amount || 0);
        const grnQty = Number(g.grn_qty || 0);
        const grnAmt = Number(g.grn_amount || 0);

        // 发票关联：精确 po_id → 供应商同名 → 供应商模糊 + 金额容差
        let inv = invByPoId[`${po.bu_no}|${po.po_id}`];

        if (!inv) {
            const candidates = invBySupplier[`${po.bu_no}|${normName(po.supplier_name)}`] || [];
            inv = candidates.find(i => !usedInvoice.has(i.uid));
        }

        if (!inv) {
            const poN = normName(po.supplier_name);
            const pool_ = (invByMonth[`${po.bu_no}|${po.YYYY_MM}`] || [])
                .filter(i => !usedInvoice.has(i.uid));
            const related = pool_.filter(i => {
                const n = normName(i.supplier_name);
                if (!n || !poN) return false;
                return n.includes(poN) || poN.includes(n);
            });
            // 优先取金额最接近的发票；名称不完全相关时只在同月兜底
            inv = (related.length ? related : pool_)
                .sort((a, b) => Math.abs(Number(a.inv_amount) - poAmt) - Math.abs(Number(b.inv_amount) - poAmt))[0];
        }

        if (inv) usedInvoice.add(inv.uid);

        const invAmt = inv ? Number(inv.inv_amount || 0) : 0;
        const invQty = inv && po.unit_price > 0
            ? Math.round((invAmt / Number(po.unit_price)) * 10000) / 10000
            : 0;

        const status = calcStatus(poQty, grnQty, invQty, poAmt, grnAmt, invAmt, tol);
        const baseAmt = grnAmt > 0 ? grnAmt : poAmt;

        results.push({
            YYYY_MM: YYYY_MM || po.YYYY_MM || '',
            bu_no: po.bu_no,
            po_uid: po.po_uid,
            grn_uid: g.uid || null,
            invoice_uid: inv ? inv.uid : null,
            invoice_no: inv ? inv.invoice_no : null,
            invoice_date: inv ? inv.wk_date : null,
            xitems: po.xitems,
            supplier_name: po.supplier_name,
            po_qty: poQty,
            grn_qty: grnQty,
            invoice_qty: invQty,
            po_amount: poAmt,
            grn_amount: grnAmt,
            invoice_amount: invAmt,
            vat_amount: inv ? Number(inv.vat_amount || 0) : 0,
            match_status: status,
            diff_qty: invQty - grnQty,
            diff_amount: invAmt - grnAmt,
            diff_rate: baseAmt > 0 ? Math.round(((invAmt - grnAmt) / baseAmt) * 10000) / 100 : 0,
            auto_matched: 1
        });
    }

    // 7. 有票无单：未被任何 PO 使用的发票 → EXCESS 行
    const orphanInvoices = invs.filter(i => !usedInvoice.has(i.uid));
    for (const i of orphanInvoices) {
        results.push({
            YYYY_MM: YYYY_MM || i.YYYY_MM || '',
            bu_no: i.bu_no,
            po_uid: null,
            grn_uid: null,
            invoice_uid: i.uid,
            invoice_no: i.invoice_no,
            invoice_date: i.wk_date,
            xitems: null,
            supplier_name: i.supplier_name,
            po_qty: 0, grn_qty: 0, invoice_qty: 0,
            po_amount: 0, grn_amount: 0,
            invoice_amount: Number(i.inv_amount || 0),
            vat_amount: Number(i.vat_amount || 0),
            match_status: 'EXCESS',
            diff_qty: 0,
            diff_amount: Number(i.inv_amount || 0),
            diff_rate: 100,
            auto_matched: 1
        });
    }

    // 8. 写入
    let matched = 0, partial = 0, unmatched = 0, excess = 0;
    for (const r of results) {
        await conn.execute(`
            INSERT INTO po_match_result
                (YYYY_MM, bu_no, po_uid, grn_uid, invoice_uid, invoice_no, invoice_date,
                 xitems, supplier_name, po_qty, grn_qty, invoice_qty,
                 po_amount, grn_amount, invoice_amount, vat_amount,
                 match_status, diff_qty, diff_amount, diff_rate, auto_matched, handle_status)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'PENDING')`,
            [r.YYYY_MM, r.bu_no, r.po_uid, r.grn_uid, r.invoice_uid, r.invoice_no, r.invoice_date,
             r.xitems, r.supplier_name, r.po_qty, r.grn_qty, r.invoice_qty,
             r.po_amount, r.grn_amount, r.invoice_amount, r.vat_amount,
             r.match_status, r.diff_qty, r.diff_amount, r.diff_rate, r.auto_matched]
        );
        if (r.match_status === 'MATCHED') matched++;
        else if (r.match_status === 'UNMATCHED') unmatched++;
        else if (r.match_status === 'EXCESS') excess++;
        else partial++;
    }

    return {
        total: results.length,
        matched, partial, unmatched, excess,
        tolerance: tol,
        note: '已收货未开票计为 PARTIAL；有票无单计为 EXCESS'
    };
}

module.exports = { runMatch };
