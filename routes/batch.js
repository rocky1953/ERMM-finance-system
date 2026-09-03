/**
 * 7 步批次管線路由
 * Step1 erp2ermm_po → Step2 proc_po → Step3 proc_supplier → Step4 proc_xitems_link_lawbook
 * → Step5 cal_daily_stock_balance → Step6 batch_ARAP_upd → Step7 batch_finance_summary
 *
 * 參數統一：所有 step 只需要 { bu_no }，batch_id 自動生成
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');

// 工具：把 undefined 轉 null（mysql2 不吃 undefined）
function sanitizeParams(arr) {
    return arr.map(v => (v === undefined ? null : v));
}

// 啟動批次 → 取得 batch_id（保留給舊前端）
router.post('/start', async (req, res) => {
    try {
        const batch_id = 'B' + Date.now();
        await pool.execute(
            "INSERT IGNORE INTO cams_batch_control (batch_id, step_name, seq_SQL, process_status) VALUES (?,?,0,'00')",
            sanitizeParams([batch_id, 'START'])
        ).catch(() => {});
        ok(res, { batch_id, bu_no: req.body.bu_no }, '批次已啟動');
    } catch (err) { fail500(res, err); }
});

// ===== Step 1: erp2ermm_po (PO 同步) =====
router.post('/step1', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { bu_no } = req.body;
        const batch_id = req.body.batch_id || ('B' + Date.now());
        if (!bu_no) return fail(res, '需要 bu_no');
        await conn.beginTransaction();

        const [src] = await conn.execute(
            'SELECT COUNT(*) AS cnt FROM ERMM_temp_po WHERE bu_no=?',
            sanitizeParams([bu_no])
        );
        if (!src[0].cnt) {
            await conn.commit();
            return ok(res, { row_count: 0 }, 'Step1 跳過（temp_po 無資料）');
        }

        const [resRows] = await conn.execute(`
            INSERT INTO ermm_erp_po
                (bu_no, po_id, supplier_name, xitems, po_date, po_qty,
                 unit_price, exchange_rate, po_amount, vat_amt,
                 YYYY, MM, YYYY_MM, po_status, po_sub_status, batch_id)
            SELECT bu_no, po_id, supplier_name, xitems, po_date, po_qty,
                   unit_price, exchange_rate, po_amount, vat_amt,
                   YEAR(po_date), LPAD(MONTH(po_date),2,'0'),
                   CONCAT(YEAR(po_date),'/',LPAD(MONTH(po_date),2,'0')),
                   '審核通過', '交付完成', ?
            FROM ERMM_temp_po WHERE bu_no=?
            ON DUPLICATE KEY UPDATE
                unit_price=VALUES(unit_price),
                po_amount=VALUES(po_amount),
                vat_amt=VALUES(vat_amt)
        `, sanitizeParams([batch_id, bu_no]));

        await conn.commit();
        ok(res, { row_count: resRows.affectedRows }, `Step1 PO 同步完成 (${resRows.affectedRows} 筆)`);
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally { conn.release(); }
});

// ===== Step 2: proc_po (PO 加工計算) =====
router.post('/step2', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { bu_no } = req.body;
        if (!bu_no) return fail(res, '需要 bu_no');
        await conn.beginTransaction();

        // 取得匯率
        const [fx] = await conn.execute(
            "SELECT code_value, value_number1 FROM cams_system_codes WHERE code_type='CURRENCY' AND inuse_flag='USE'"
        ).catch(() => [[{ code_value: 'RMB', value_number1: 1 }]]);
        const fxMap = {};
        (fx || []).forEach(r => fxMap[r.code_value] = Number(r.value_number1 || 1));

        const [pos] = await conn.execute(
            'SELECT uid, unit_price, exchange_rate, po_amount FROM ermm_erp_po WHERE bu_no=?',
            sanitizeParams([bu_no])
        );
        let updated = 0;
        for (const po of pos) {
            const fx = fxMap['RMB'] || Number(po.exchange_rate || 1);
            const unit_price_local = Number(po.unit_price || 0) * fx;
            const po_amount_local = Number(po.po_amount || 0) * fx;
            await conn.execute(
                'UPDATE ermm_erp_po SET unit_price_local=?, po_amount_local=? WHERE uid=?',
                sanitizeParams([unit_price_local, po_amount_local, po.uid])
            );
            updated++;
        }

        await conn.commit();
        ok(res, { po_count: pos.length, updated }, `Step2 PO 加工完成 (${updated} 筆)`);
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally { conn.release(); }
});

// ===== Step 3: proc_supplier (供應商彙算) =====
router.post('/step3', async (req, res) => {
    try {
        const { bu_no } = req.body;
        if (!bu_no) return fail(res, '需要 bu_no');
        const [rows] = await pool.execute(`
            SELECT supplier_name,
                   COUNT(*) AS times_po,
                   ROUND(SUM(po_amount),2) AS total_po
            FROM ermm_erp_po WHERE bu_no=?
            GROUP BY supplier_name
            ORDER BY total_po DESC
            LIMIT 20
        `, sanitizeParams([bu_no]));
        ok(res, rows, `Step3 供應商彙算完成 (${rows.length} 家)`);
    } catch (err) { fail500(res, err); }
});

// ===== Step 4: proc_xitems_link_lawbook (物料法規綁定 - 簡化) =====
router.post('/step4', async (req, res) => {
    try {
        ok(res, { skipped: true }, 'Step4 物料法規綁定 (簡化版 - 跳過)');
    } catch (err) { fail500(res, err); }
});

// ===== Step 5: cal_daily_stock_balance (庫存結算) =====
router.post('/step5', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { bu_no } = req.body;
        if (!bu_no) return fail(res, '需要 bu_no');
        await conn.beginTransaction();

        // 取得減值率
        let ageing = [];
        try {
            const [a] = await conn.execute(
                "SELECT code_value, value_number1 FROM cams_system_codes WHERE code_type='AGEING_STOCK'"
            );
            ageing = a;
        } catch {}
        const reduceMap = {};
        ageing.forEach(a => { reduceMap[a.code_value] = Number(a.value_number1 || 0); });

        // 若無庫存資料，跳過
        const [items] = await conn.execute(
            'SELECT uid, xitems, qty_balance, unit_price, exchange_rate, ageing_days FROM e2_xitems_daily_status WHERE bu_no=?',
            sanitizeParams([bu_no])
        );
        if (!items.length) {
            await conn.commit();
            return ok(res, { item_count: 0 }, 'Step5 跳過（e2_xitems_daily_status 無資料）');
        }

        for (const it of items) {
            const fx = Number(it.exchange_rate || 1);
            const qty = Number(it.qty_balance || 0);
            const price = Number(it.unit_price || 0);
            const stock_value = Math.round(price * qty * fx);

            const days = Number(it.ageing_days || 0);
            let reduce_pct = 0;
            if (days > 365)  reduce_pct = reduceMap['365天以上'] || 50;
            else if (days > 180) reduce_pct = reduceMap['181-365天'] || 30;
            else if (days > 90)  reduce_pct = reduceMap['91-180天'] || 15;
            else if (days > 30)  reduce_pct = reduceMap['31-90天'] || 5;

            const current_value = Math.round(stock_value * (1 - reduce_pct / 100));
            const current_lose  = Math.round(stock_value * (reduce_pct / 100));

            await conn.execute(`
                UPDATE e2_xitems_daily_status
                   SET stock_value=?, reduce_percentage=?, current_value=?, current_lose=?
                 WHERE uid=?
            `, sanitizeParams([stock_value, reduce_pct, current_value, current_lose, it.uid]));
        }

        const today = new Date().toISOString().slice(0, 10);
        const [sum] = await conn.execute(`
            SELECT SUM(stock_value) AS total_sv,
                   SUM(current_value) AS total_cv,
                   SUM(current_lose) AS total_cl
              FROM e2_xitems_daily_status WHERE bu_no=?
        `, sanitizeParams([bu_no]));

        await conn.execute(`
            INSERT INTO e2_xitems_daily_status_chart
                (bu_no, stock_date, stock_value_total, current_value_total, current_lose_total)
            VALUES (?,?,?,?,?)
            ON DUPLICATE KEY UPDATE
                stock_value_total=VALUES(stock_value_total),
                current_value_total=VALUES(current_value_total),
                current_lose_total=VALUES(current_lose_total)
        `, sanitizeParams([bu_no, today,
            sum[0].total_sv || 0, sum[0].total_cv || 0, sum[0].total_cl || 0]));

        await conn.commit();
        ok(res, {
            item_count: items.length,
            total_stock_value: sum[0].total_sv || 0,
            total_current_value: sum[0].total_cv || 0
        }, `Step5 庫存結算完成 (${items.length} 項)`);
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally { conn.release(); }
});

// ===== Step 6: batch_ARAP_upd (AR/AP 彙算) =====
router.post('/step6', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { bu_no } = req.body;
        if (!bu_no) return fail(res, '需要 bu_no');
        await conn.beginTransaction();

        // AR = Σ(unit_price × dn_qty) FROM SO
        // 先試 SO 表（若有資料），若沒資料就從發票 AR 線路推算
        let arapAR = 0;
        try {
            const [soAR] = await conn.execute(`
                SELECT SUBSTRING(ym,1,4) AS YYYY, ym AS YYYY_MM,
                       ROUND(SUM(unit_price * dn_qty),2) AS AR_amt
                  FROM (
                    SELECT COALESCE(YYYY_MM, DATE_FORMAT(so_date,'%Y/%m')) AS ym,
                           unit_price, dn_qty
                      FROM ERMM_erp_SO WHERE bu_no=? AND dn_qty > 0
                  ) t
                 GROUP BY ym
            `, sanitizeParams([bu_no]));
            // 逐筆 upsert 到 ERMM_ARAP_detail（保留另一欄位既有值）
            for (const row of soAR) {
                await conn.execute(`
                    INSERT INTO ERMM_ARAP_detail (bu_no, YYYY, YYYY_MM, AR_amt, AP_amt, update_time)
                    VALUES (?,?,?,?,0,NOW())
                    ON DUPLICATE KEY UPDATE
                        AR_amt=VALUES(AR_amt), update_time=NOW()
                `, sanitizeParams([bu_no, row.YYYY, row.YYYY_MM, row.AR_amt]));
                arapAR += Number(row.AR_amt || 0);
            }
        } catch (e) {
            console.warn(`[step6] SO AR 錯誤(試著從發票 AR 推): ${e.message}`);
        }

        // 若 SO 表沒貢獻（全空或失敗），從發票 AR 線路推算
        if (arapAR === 0) {
            try {
                const [invAR] = await conn.execute(`
                    SELECT COALESCE(YYYY_MM, DATE_FORMAT(wk_date,'%Y/%m')) AS ym,
                           ROUND(SUM(sub_amt),2) AS AR_amt
                      FROM MGM_invoice_details
                     WHERE bu_no=? AND TX_type='AR'
                     GROUP BY ym
                `, sanitizeParams([bu_no]));
                for (const row of invAR) {
                    await conn.execute(`
                        INSERT INTO ERMM_ARAP_detail (bu_no, YYYY, YYYY_MM, AR_amt, AP_amt, update_time)
                        VALUES (?,?,?,?,0,NOW())
                        ON DUPLICATE KEY UPDATE AR_amt=VALUES(AR_amt), update_time=NOW()
                    `, sanitizeParams([bu_no, row.ym.substring(0,4), row.ym, row.AR_amt]));
                }
            } catch {}
        }

        // AP = Σ(po_amount + vat_amt) FROM PO（已加工）
        // 先算 PO，若沒資料再從發票 AP 推算
        let arapAP = 0;
        const [poAP] = await conn.execute(`
            SELECT COALESCE(YYYY_MM, DATE_FORMAT(po_date,'%Y/%m')) AS ym,
                   ROUND(SUM(po_amount + vat_amt),2) AS AP_amt
              FROM ermm_erp_po
             WHERE bu_no=? AND po_status='審核通過' AND po_sub_status='交付完成'
             GROUP BY ym
        `, sanitizeParams([bu_no]));
        for (const row of poAP) {
            await conn.execute(`
                INSERT INTO ERMM_ARAP_detail (bu_no, YYYY, YYYY_MM, AR_amt, AP_amt, update_time)
                VALUES (?,?,?,0,?,NOW())
                ON DUPLICATE KEY UPDATE
                    AP_amt=VALUES(AP_amt), update_time=NOW()
            `, sanitizeParams([bu_no, row.ym.substring(0,4), row.ym, row.AP_amt]));
            arapAP += Number(row.AP_amt || 0);
        }

        // 若 PO 沒貢獻，從發票 AP 推算
        if (arapAP === 0) {
            try {
                const [invAP] = await conn.execute(`
                    SELECT COALESCE(YYYY_MM, DATE_FORMAT(wk_date,'%Y/%m')) AS ym,
                           ROUND(SUM(sub_amt),2) AS AP_amt
                      FROM MGM_invoice_details
                     WHERE bu_no=? AND TX_type='AP'
                     GROUP BY ym
                `, sanitizeParams([bu_no]));
                for (const row of invAP) {
                    await conn.execute(`
                        INSERT INTO ERMM_ARAP_detail (bu_no, YYYY, YYYY_MM, AR_amt, AP_amt, update_time)
                        VALUES (?,?,?,0,?,NOW())
                        ON DUPLICATE KEY UPDATE AP_amt=VALUES(AP_amt), update_time=NOW()
                    `, sanitizeParams([bu_no, row.ym.substring(0,4), row.ym, row.AP_amt]));
                }
            } catch {}
        }

        await conn.execute('UPDATE ERMM_ARAP_detail SET AR_amt=0 WHERE bu_no=? AND AR_amt IS NULL', sanitizeParams([bu_no]));
        await conn.execute('UPDATE ERMM_ARAP_detail SET AP_amt=0 WHERE bu_no=? AND AP_amt IS NULL', sanitizeParams([bu_no]));

        await conn.commit();
        const [rows] = await conn.execute(
            'SELECT COUNT(*) AS cnt FROM ERMM_ARAP_detail WHERE bu_no=?',
            sanitizeParams([bu_no])
        );
        ok(res, { row_count: rows[0].cnt }, `Step6 AR/AP 彙算完成 (${rows[0].cnt} 筆月份)`);
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally { conn.release(); }
});

// ===== Step 7: batch_finance_summary (財務摘要重算) =====
router.post('/step7', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { bu_no } = req.body;
        if (!bu_no) return fail(res, '需要 bu_no');
        await conn.beginTransaction();

        // 從 ARAP 讀取所有月份
        const [arap] = await conn.execute(
            'SELECT YYYY_MM, AR_amt, AP_amt FROM ERMM_ARAP_detail WHERE bu_no=?',
            sanitizeParams([bu_no])
        );

        let updated = 0;
        for (const a of arap) {
            // 發票彙總（同時支援 YYYY_MM 和 wk_date）
            const [inv] = await conn.execute(`
                SELECT TX_type, SUM(sub_amt) AS total
                  FROM MGM_invoice_details
                 WHERE bu_no=?
                   AND (YYYY_MM=? OR DATE_FORMAT(wk_date,'%Y/%m')=?)
                 GROUP BY TX_type
            `, sanitizeParams([bu_no, a.YYYY_MM, a.YYYY_MM]));
            const invMap = {};
            inv.forEach(i => invMap[i.TX_type] = Number(i.total || 0));

            // 現金日記彙總（同時支援 YYYY_MM 和 wk_date）
            const [cashRows] = await conn.execute(`
                SELECT DB_CR, SUM(sub_amt) AS total
                  FROM MGM_casher_details
                 WHERE bu_no=?
                   AND (YYYY_MM=? OR DATE_FORMAT(wk_date,'%Y/%m')=?)
                 GROUP BY DB_CR
            `, sanitizeParams([bu_no, a.YYYY_MM, a.YYYY_MM]));
            const cashMap = {};
            cashRows.forEach(c => cashMap[c.DB_CR] = Number(c.total || 0));

            // 庫存價值
            let stockSum = [{ sv: 0, cl: 0 }];
            try {
                const [s] = await conn.execute(`
                    SELECT SUM(stock_value) AS sv, SUM(current_lose) AS cl
                      FROM e2_xitems_daily_status WHERE bu_no=?
                `, sanitizeParams([bu_no]));
                stockSum = s.length ? s : stockSum;
            } catch {}

            const AR = Number(a.AR_amt || 0);
            const AP = Number(a.AP_amt || 0);
            const cash_in  = cashMap['DR'] || 0;
            const cash_out = cashMap['CR'] || 0;
            const cashNet  = cash_in - cash_out;
            const stock     = Number(stockSum[0].sv || 0);
            const reserve   = Number(stockSum[0].cl || 0);
            const AR_inv = invMap['AR'] || 0;
            const AP_inv = invMap['AP'] || 0;

            await conn.execute(`
                UPDATE MGM_finance_summary SET
                    AR_amt       = ?,
                    AP_amt       = ?,
                    AR_bill_amt  = ?,
                    AP_tax_amt   = ?,
                    cash_amt     = ?,
                    stock_P_amt  = ?,
                    stock_M_amt  = ?,
                    stock_S_amt  = ?,
                    reserve_loss_amt = ?,
                    VAT_amt     = GREATEST(?,0) - GREATEST(?,0),
                    ttl_asset_amt = cash_amt + COALESCE(deposite_amt,0) + AR_amt + AR_bill_amt
                                  + stock_P_amt + stock_M_amt + stock_S_amt - reserve_loss_amt,
                    batch_id     = 'step7'
                WHERE bu_no=? AND YYYY_MM=?
            `, sanitizeParams([
                AR, AP, AR_inv, AP_inv,
                cashNet,
                Math.round(stock * 0.5),
                Math.round(stock * 0.3),
                Math.round(stock * 0.2),
                reserve,
                AR_inv, AP_inv,
                bu_no, a.YYYY_MM
            ]));
            updated++;
        }

        await conn.commit();
        ok(res, { updated_months: updated }, `Step7 財務摘要重算完成 (${updated} 月份)`);
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally { conn.release(); }
});

// ===== 一鍵執行全部 7 步（真實執行） =====
router.post('/runAll', async (req, res) => {
    const bu_no = req.body?.bu_no;
    if (!bu_no) return fail(res, '需要 bu_no');

    const steps = [
        { id: 1, name: 'PO 同步',       path: '/api/batch/step1' },
        { id: 2, name: 'PO 加工',       path: '/api/batch/step2' },
        { id: 3, name: '供應商彙算',    path: '/api/batch/step3' },
        { id: 4, name: '物料法規',      path: '/api/batch/step4' },
        { id: 5, name: '庫存結算',      path: '/api/batch/step5' },
        { id: 6, name: 'AR/AP 彙算',    path: '/api/batch/step6' },
        { id: 7, name: '財務摘要重算',  path: '/api/batch/step7' },
    ];

    const results = {};
    for (const s of steps) {
        results[`step${s.id}`] = '⏳ 執行中...';
        try {
            // 直接調用 route handler 對應的邏輯
            const mock = { body: { bu_no, ...req.body } };
            // 用 HTTP 內部請求方式執行最簡單
            const http = require('http');
            await new Promise((resolve, reject) => {
                const body = JSON.stringify({ bu_no });
                const opts = {
                    hostname: 'localhost', port: req.app.get('port') || 3008,
                    path: s.path, method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
                };
                const r = http.request(opts, res => {
                    let d = '';
                    res.on('data', c => d += c);
                    res.on('end', () => {
                        try {
                            const j = JSON.parse(d);
                            resolve({ status: res.statusCode, data: j });
                        } catch { resolve({ status: res.statusCode, data: d }); }
                    });
                });
                r.on('error', reject);
                r.write(body);
                r.end();
            }).then(r => {
                if (r.status === 200 && r.data.success !== false) {
                    results[`step${s.id}`] = `✅ ${s.name} — ${r.data.message || 'OK'}`;
                } else {
                    results[`step${s.id}`] = `❌ ${s.name} — ${r.data.message || 'failed'}`;
                }
            }).catch(e => {
                results[`step${s.id}`] = `❌ ${s.name} — ${e.message}`;
            });
        } catch (e) {
            results[`step${s.id}`] = `❌ ${s.name} — ${e.message}`;
        }
    }

    const allOk = Object.values(results).every(v => v.startsWith('✅'));
    ok(res, { bu_no, steps: results, all_ok: allOk },
        allOk ? '全部 7 步執行完成 ✅' : '部分步驟失敗，請查看詳情');
});

module.exports = router;
