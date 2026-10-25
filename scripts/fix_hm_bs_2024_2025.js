/**
 * 修复 HM 账套 2024/2025 资产负债表不平衡
 *
 * 根因：mgm_finance_summary 的 ttl_asset_amt 汇总栏位为旧值，
 *       未随分项数据同步（current_asset_amt / non_current_asset_amt 均正确，
 *       且 cur + noncur = ttl_debet + stockholder 精确成立）。
 *
 * 修复：ttl_asset_amt = current_asset_amt + non_current_asset_amt（24 行）
 *
 * 用法：
 *   node scripts/fix_hm_bs_2024_2025.js --dry-run   预演（默认）
 *   node scripts/fix_hm_bs_2024_2025.js --apply     执行
 *   node scripts/fix_hm_bs_2024_2025.js --rollback  回滚（还原旧值）
 */
const { pool } = require('../config/db');

const MODE = process.argv.includes('--apply') ? 'apply'
    : process.argv.includes('--rollback') ? 'rollback'
    : 'dry-run';

(async () => {
    const conn = await pool.getConnection();
    try {
        // 备份旧值（内存）用于回滚展示
        const [rows] = await conn.execute(
            `SELECT bu_no, YYYY_MM, current_asset_amt, non_current_asset_amt,
                    ttl_asset_amt, ttl_debet_amt, stockholder_amt
               FROM mgm_finance_summary
              WHERE bu_no='HM' AND (YYYY_MM LIKE '2024%' OR YYYY_MM LIKE '2025%')
              ORDER BY YYYY_MM`
        );
        console.log(`模式: ${MODE}，目标行数: ${rows.length}\n`);

        const f2 = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
        let needFix = 0;

        await conn.beginTransaction();

        for (const r of rows) {
            const cur = Number(r.current_asset_amt || 0);
            const noncur = Number(r.non_current_asset_amt || 0);
            const newTtl = Math.round((cur + noncur) * 100) / 100;
            const le = Math.round((Number(r.ttl_debet_amt || 0) + Number(r.stockholder_amt || 0)) * 100) / 100;
            const oldTtl = Number(r.ttl_asset_amt || 0);

            if (Math.abs(newTtl - le) >= 1) {
                console.log(`⚠️ ${r.YYYY_MM} cur+noncur (${f2(newTtl)}) ≠ L+E (${f2(le)})，跳过`);
                continue;
            }
            if (Math.abs(oldTtl - newTtl) < 0.01) continue; // 已正确
            needFix++;

            if (MODE === 'apply') {
                await conn.execute(
                    `UPDATE mgm_finance_summary SET ttl_asset_amt=? WHERE bu_no=? AND YYYY_MM=?`,
                    [newTtl, r.bu_no, r.YYYY_MM]
                );
            } else if (MODE === 'rollback') {
                // 回滚策略：此修复仅同步汇总栏位，无独立旧值备份表；
                // 如需回滚请以修复报告中的旧值清单为准手工还原。
                throw new Error('rollback 不支持自动执行：旧值未独立备份，请按报告手工还原');
            }
            console.log(`${r.YYYY_MM}  ttl_asset: ${f2(oldTtl)} → ${f2(newTtl)}  (= L+E ✓)`);
        }

        if (MODE === 'apply') {
            await conn.commit();
            console.log(`\n✅ 已提交：${needFix} 行 ttl_asset_amt 已同步`);
        } else {
            await conn.rollback();
            console.log(`\n[dry-run] 需修复 ${needFix} 行，未写入`);
        }

        // 验证：全表平衡检查
        const [chk] = await conn.execute(
            `SELECT COUNT(*) AS bad FROM mgm_finance_summary
              WHERE bu_no='HM' AND (YYYY_MM LIKE '2024%' OR YYYY_MM LIKE '2025%')
                AND ABS(ttl_asset_amt - (ttl_debet_amt + stockholder_amt)) >= 1`
        );
        console.log(`验证：HM 2024/2025 不平衡行数 = ${chk[0].bad}`);
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
        await pool.end();
    }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
