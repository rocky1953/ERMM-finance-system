/**
 * 存貨重估（方案 2）
 *
 * 問題：存貨長期偏高（HM 固定在 7,374 萬，而月銷貨成本僅約 550 萬），
 *       導致資產虛高、平衡項(累積盈餘)虛高、ROE 被嚴重稀釋。
 *
 * 做法：以「月銷貨成本 × 2.5 個月」為合理存貨水位，僅下調不下調高；
 *       存貨四項（原料/在製/成品/在途）按比例縮放，再重算資產與權益，
 *       維持 資產 = 負債 + 權益。
 *
 * 用法：
 *   node scripts/revalue_inventory.js            預演
 *   node scripts/revalue_inventory.js --apply    執行
 */
const { pool } = require('../config/db');

const APPLY = process.argv.includes('--apply');
const MONTHS_OF_COGS = 2.5;   // 合理存貨週轉：2.5 個月
const v = (r, k) => Number(r[k] || 0);
const f2 = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
    const [rows] = await pool.query(
        `SELECT * FROM mgm_finance_summary WHERE YYYY_MM >= '2023-01' ORDER BY bu_no, YYYY_MM`
    );
    console.log(`模式：${APPLY ? 'APPLY（寫入）' : 'DRY-RUN（預演）'}｜週轉基準：${MONTHS_OF_COGS} 個月\n`);

    // 各公司有效 COGS 平均值（COGS=0 的月份以此代替）
    const cogsByBu = {};
    for (const r of rows) {
        const c = v(r, 'sale_cost_amt');
        if (c > 0) (cogsByBu[r.bu_no] = cogsByBu[r.bu_no] || []).push(c);
    }
    const avgCogs = {};
    for (const [bu, arr] of Object.entries(cogsByBu)) avgCogs[bu] = arr.reduce((a, b) => a + b, 0) / arr.length;
    console.log('各公司平均月銷貨成本：', Object.fromEntries(Object.entries(avgCogs).map(([k, n]) => [k, f2(n)])));

    const conn = APPLY ? await pool.getConnection() : null;
    if (conn) await conn.beginTransaction();

    const stats = {};
    let changed = 0;
    try {
        for (const r of rows) {
            const cogs = v(r, 'sale_cost_amt') > 0 ? v(r, 'sale_cost_amt') : (avgCogs[r.bu_no] || 0);
            const target = cogs * MONTHS_OF_COGS;

            const parts = ['stock_P_amt', 'stock_M_amt', 'stock_S_amt', 'stock_transit_amt'];
            const oldInv = parts.reduce((a, k) => a + v(r, k), 0);
            const newInvVals = {};
            let newInv = oldInv;
            if (target > 0 && oldInv > target) {
                const scale = target / oldInv;
                parts.forEach(k => { newInvVals[k] = v(r, k) * scale; });
                newInv = parts.reduce((a, k) => a + newInvVals[k], 0);
            } else {
                parts.forEach(k => { newInvVals[k] = v(r, k); });
            }

            // 重算資產
            const cash = v(r, 'cash_amt') + v(r, 'deposite_amt') + v(r, 'interest_amt');
            const ar = v(r, 'AR_amt') + v(r, 'AR_bill_amt') + v(r, 'AR_temp_amt') + v(r, 'AR_affiliate_amt');
            const prepay = v(r, 'prepay_EXP_amt') + v(r, 'prepay_goods_amt');
            const current_asset = cash + ar + newInv + prepay;
            const non_current_asset =
                (v(r, 'building_amt') - v(r, 'acc_de_building')) +
                (v(r, 'equipment_amt') - v(r, 'acc_de_EQMT')) +
                (v(r, 'vehicle_amt') - v(r, 'acc_de_vehicle')) +
                (v(r, 'office_amt') - v(r, 'acc_de_office')) +
                v(r, 'intangible_amt') + v(r, 'LQ_asset_amt') + v(r, 'FX_asset_amt') +
                v(r, 'WIP_M_amt') + v(r, 'WIP_labor_amt') + v(r, 'WIP_EXP_amt') +
                v(r, 'other_asset_amt');
            const ttl_asset = current_asset + non_current_asset;

            const ttl_debet = v(r, 'current_debet_amt') + v(r, 'long_term_debet_amt');
            const other_equity = v(r, 'captial_stock') + v(r, 'captial_reserve') + v(r, 'legal_reserve') + v(r, 'current_PL_amt');
            const accumulated = ttl_asset - ttl_debet - other_equity;
            const equity = other_equity + accumulated;

            const y = String(r.YYYY_MM).slice(0, 4);
            const key = `${r.bu_no}/${y}`;
            stats[key] = stats[key] || { n: 0, oldInv: 0, newInv: 0 };
            stats[key].n++; stats[key].oldInv += oldInv; stats[key].newInv += newInv;

            const didChange = Math.abs(newInv - oldInv) >= 1;
            if (didChange) changed++;

            if (APPLY) {
                await conn.execute(
                    `UPDATE mgm_finance_summary SET
                        stock_P_amt=?, stock_M_amt=?, stock_S_amt=?, stock_transit_amt=?,
                        ttl_asset_amt=?, current_asset_amt=?, non_current_asset_amt=?,
                        accumulated_amt=?, stockholder_amt=?, ttl_debet_amt=?,
                        update_time=NOW()
                     WHERE uid=?`,
                    [newInvVals.stock_P_amt, newInvVals.stock_M_amt, newInvVals.stock_S_amt, newInvVals.stock_transit_amt,
                        ttl_asset, current_asset, non_current_asset, accumulated, equity, ttl_debet, r.uid]
                );
            }
        }
        if (conn) await conn.commit();
    } catch (e) {
        if (conn) await conn.rollback();
        throw e;
    } finally {
        if (conn) conn.release();
    }

    console.log('\n存貨重估彙總（平均每期）：');
    for (const [k, s] of Object.entries(stats)) {
        console.log(`  ${k}: 存貨 ${f2(s.oldInv / s.n)} → ${f2(s.newInv / s.n)}`);
    }
    console.log(`\n${APPLY ? '✅ 已更新' : '預演變更'} ${APPLY ? changed : changed} 筆`);

    if (APPLY) {
        const [chk] = await pool.query(
            `SELECT SUM(ABS(ttl_asset_amt - (ttl_debet_amt + stockholder_amt)) >= 1) AS bad,
                    COUNT(*) AS total, MAX(ABS(ttl_asset_amt - (ttl_debet_amt + stockholder_amt))) AS max_diff
               FROM mgm_finance_summary WHERE YYYY_MM >= '2023-01'`
        );
        console.log(`平衡驗證：不平衡 ${chk[0].bad} / ${chk[0].total} 筆，最大差額 ${chk[0].max_diff}`);
    }
    process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
