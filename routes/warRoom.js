/**
 * 戰情聯動看板路由
 *  - PO → SO → DN → 回款 漏斗
 *  - 跨 BU 訂單 / 庫存 / 現金流 即時卡片
 * 資料來源：ermm_erp_po, ermm_erp_so, ermm_erp_so_dn,
 *          mgm_invoice_details, mgm_finance_summary
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');

// 工具：安全取數值
const num = (v) => (v === null || v === undefined || isNaN(v)) ? 0 : Number(v);

// ============ 漏斗明細鑽取（點擊漏斗 bar 顯示該階段明細） ============
router.get('/funnel-detail', async (req, res) => {
    try {
        const { bu_no, YYYY_MM, stage } = req.query;
        if (!bu_no) return fail(res, '需要 bu_no');
        if (!['PO', 'SO', 'DN', 'AR'].includes(stage)) return fail(res, 'stage 須為 PO/SO/DN/AR');

        const ym = YYYY_MM || null;
        const ymCond = ym ? 'AND YYYY_MM=?' : '';
        const ymParam = ym ? [ym] : [];
        let rows = [];

        if (stage === 'PO') {
            [rows] = await pool.execute(`
                SELECT po_id, supplier_name, xitems, po_qty, unit_price_local,
                       po_amount_local, po_date, po_status
                FROM ermm_erp_po
                WHERE bu_no=? ${ymCond}
                ORDER BY po_amount_local DESC LIMIT 300
            `, [bu_no, ...ymParam]);
        } else if (stage === 'SO') {
            [rows] = await pool.execute(`
                SELECT so_nbr, client_id, xitems, so_qty, unit_price,
                       (so_qty * unit_price) AS amt, YYYY_MM
                FROM ermm_erp_so
                WHERE bu_no=? ${ymCond}
                ORDER BY amt DESC LIMIT 300
            `, [bu_no, ...ymParam]);
        } else if (stage === 'DN') {
            // DN 無金額欄位：DN 的 so_nbr 與 invoice 的 order_id 同編號體系（SO+BU 前綴），
            // 用該訂單 AR 發票金額 × (DN_qty / so_qty) 分攤推估
            [rows] = await pool.execute(`
                SELECT d.DN_date, d.so_nbr, d.client_name, d.xitems,
                       d.DN_qty, d.so_qty,
                       (d.DN_qty / NULLIF(d.so_qty, 0) * COALESCE(inv.inv_amt, 0)) AS est_amt
                FROM ermm_erp_so_dn d
                LEFT JOIN (
                    SELECT bu_no, order_id, SUM(sub_amt) AS inv_amt
                    FROM mgm_invoice_details WHERE TX_type='AR'
                    GROUP BY bu_no, order_id
                ) inv ON inv.bu_no = d.bu_no AND inv.order_id = d.so_nbr
                WHERE d.bu_no=? ${ym ? `AND DATE_FORMAT(d.DN_date,'%Y-%m')=?` : ''}
                ORDER BY est_amt DESC LIMIT 300
            `, [bu_no, ...ymParam]);
        } else if (stage === 'AR') {
            [rows] = await pool.execute(`
                SELECT invoice_no, order_id, client_id, sub_amt, payment,
                       wk_date, ageing_days
                FROM mgm_invoice_details
                WHERE bu_no=? ${ymCond} AND TX_type='AR'
                ORDER BY sub_amt DESC LIMIT 300
            `, [bu_no, ...ymParam]);
        }

        ok(res, rows.map(r => {
            const o = {};
            Object.keys(r).forEach(k => {
                o[k] = (r[k] instanceof Date) ? r[k].toISOString().slice(0, 10) : r[k];
            });
            return o;
        }));
    } catch (err) { fail500(res, err); }
});

// ============ 戰情總覽 ============
router.get('/overview', async (req, res) => {
    try {
        const { bu_no, YYYY_MM } = req.query;
        if (!bu_no) return fail(res, '需要 bu_no');

        // 目前月份；若未傳 YYYY_MM 取最新一期
        let ym = YYYY_MM;
        if (!ym) {
            const [r] = await pool.execute(
                `SELECT YYYY_MM FROM mgm_finance_summary WHERE bu_no=? ORDER BY YYYY_MM DESC LIMIT 1`,
                [bu_no]
            );
            ym = r[0] ? r[0].YYYY_MM : null;
        }

        const ymCond = ym ? 'AND YYYY_MM=?' : '';
        const ymParam = ym ? [ym] : [];

        // ---- 1. PO ----
        const [poRows] = await pool.execute(`
            SELECT
                COUNT(*) AS po_cnt,
                COALESCE(SUM(po_amount_local),0) AS po_amt,
                COALESCE(SUM(po_qty),0) AS po_qty,
                SUM(CASE WHEN deliver_ontime='N' THEN 1 ELSE 0 END) AS late_cnt
            FROM ermm_erp_po
            WHERE bu_no=? ${ymCond}
        `, [bu_no, ...ymParam]);
        const po = poRows[0];

        // ---- 2. SO ----
        const [soRows] = await pool.execute(`
            SELECT
                COUNT(*) AS so_cnt,
                COALESCE(SUM(so_qty * unit_price),0) AS so_amt,
                COALESCE(SUM(so_qty),0) AS so_qty,
                COALESCE(SUM(dn_qty),0) AS dn_qty
            FROM ermm_erp_so
            WHERE bu_no=? ${ymCond}
        `, [bu_no, ...ymParam]);
        const so = soRows[0];

        // ---- 3. DN（交貨單） ----
        const [dnRows] = await pool.execute(`
            SELECT COUNT(*) AS dn_cnt, COALESCE(SUM(DN_qty),0) AS dn_qty
            FROM ermm_erp_so_dn
            WHERE bu_no=?
              ${ym ? `AND DATE_FORMAT(DN_date,'%Y-%m')=?` : ''}
        `, [bu_no, ...ymParam]);
        const dn = dnRows[0];

        // ---- 4. 回款（應收沖銷 = 從 invoice 取 AR 類已收款） ----
        // 這裡用 mgm_invoice_details 的 AR 金額當作應收，回款用 summary 的 AR 變動推估
        // 精準起見取 invoice AR 總額（代表本期應收），作為漏斗終點「應收」
        const [arRows] = await pool.execute(`
            SELECT COALESCE(SUM(CASE WHEN TX_type='AR' THEN sub_amt ELSE 0 END),0) AS ar_amt
            FROM mgm_invoice_details
            WHERE bu_no=? ${ymCond}
        `, [bu_no, ...ymParam]);
        const arAmt = num(arRows[0] && arRows[0].ar_amt);

        // ---- 5. 財務摘要（現金 / 庫存 / 應收） ----
        let fin = null;
        if (ym) {
            const [finRows] = await pool.execute(`
                SELECT cash_amt, deposite_amt, AR_amt, stock_value_amt,
                       stock_P_amt, stock_M_amt, AP_amt, loan_amt,
                       sale_amt, net_sale_amt
                FROM mgm_finance_summary
                WHERE bu_no=? AND YYYY_MM=?
                LIMIT 1
            `, [bu_no, ym]);
            if (finRows[0]) fin = finRows[0];
        }

        // ---- 6. 跨 BU 卡片（所有有資料的 BU） ----
        const [buRows] = await pool.execute(`
            SELECT DISTINCT bu_no FROM mgm_finance_summary ORDER BY bu_no
        `);
        const buList = buRows.map(r => r.bu_no).filter(Boolean);

        const crossBU = [];
        for (const bu of buList) {
            const [poR] = await pool.execute(`
                SELECT COALESCE(SUM(po_amount_local),0) AS po_amt,
                       COUNT(*) AS po_cnt
                FROM ermm_erp_po WHERE bu_no=? ${ymCond}
            `, [bu, ...ymParam]);
            const [soR] = await pool.execute(`
                SELECT COALESCE(SUM(so_qty * unit_price),0) AS so_amt,
                       COUNT(*) AS so_cnt
                FROM ermm_erp_so WHERE bu_no=? ${ymCond}
            `, [bu, ...ymParam]);
            const [finR] = await pool.execute(`
                SELECT cash_amt, deposite_amt, AR_amt, AP_amt, stock_value_amt, loan_amt, sale_amt
                FROM mgm_finance_summary WHERE bu_no=? ${ym ? 'AND YYYY_MM=?' : ''} ORDER BY YYYY_MM DESC LIMIT 1
            `, [bu, ...ymParam]);
            const f = finR[0] || {};
            const cash = num(f.cash_amt) + num(f.deposite_amt);
            crossBU.push({
                bu_no: bu,
                po_amt: num(poR[0].po_amt),
                po_cnt: num(poR[0].po_cnt),
                so_amt: num(soR[0].so_amt),
                so_cnt: num(soR[0].so_cnt),
                cash: cash,
                ar: num(f.AR_amt),
                ap: num(f.AP_amt),
                inventory: num(f.stock_value_amt),
                loan: num(f.loan_amt),
                sale_amt: num(f.sale_amt)
            });
        }

        // ---- 7. 指標計算 ----
        const soAmt = num(so.so_amt);
        const poAmt = num(po.po_amt);
        const poQty = num(po.po_qty);
        const soQty = num(so.so_qty);
        const soDnQty = num(so.dn_qty);
        const fulfillRate = soQty > 0 ? (soDnQty / soQty * 100) : 0;
        const onTimeRate = num(po.po_cnt) > 0
            ? ((num(po.po_cnt) - num(po.late_cnt)) / num(po.po_cnt) * 100)
            : 100;
        const cashAmt = fin ? (num(fin.cash_amt) + num(fin.deposite_amt)) : 0;

        // 漏斗：PO 金額 → SO 金額 → DN 數量折算金額 → 回款(AR)
        // DN 無金額欄位，用 SO 單價均攤推估：so_amt * (dn_qty / so_qty)
        const dnEstAmt = soQty > 0 ? (soAmt * soDnQty / soQty) : 0;

        ok(res, {
            bu_no,
            YYYY_MM: ym,
            funnel: [
                { stage: 'PO', label_tw: '採購金額', label_cn: '采购金额', label_en: 'Purchase', value: poAmt, qty: poQty, unit: '元' },
                { stage: 'SO', label_tw: '銷售訂單', label_cn: '销售订单', label_en: 'Sales Order', value: soAmt, qty: soQty, unit: '元' },
                { stage: 'DN', label_tw: '交貨出庫', label_cn: '交货出库', label_en: 'Delivery', value: dnEstAmt, qty: num(dn.dn_qty), unit: '元' },
                { stage: 'AR', label_tw: '應收(回款)', label_cn: '应收(回款)', label_en: 'Receivable', value: arAmt, qty: 0, unit: '元' }
            ],
            metrics: {
                po_cnt: num(po.po_cnt),
                so_cnt: num(so.so_cnt),
                dn_cnt: num(dn.dn_cnt),
                fulfill_rate: Math.round(fulfillRate * 10) / 10,
                on_time_rate: Math.round(onTimeRate * 10) / 10,
                cash: cashAmt,
                inventory: fin ? num(fin.stock_value_amt) : 0,
                ar: fin ? num(fin.AR_amt) : 0,
                ap: fin ? num(fin.AP_amt) : 0
            },
            cross_bu: crossBU
        });
    } catch (err) { fail500(res, err); }
});

module.exports = router;
