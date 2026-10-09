/**
 * 修复 fin_voucher_entry.voucher_id 与 fin_voucher.voucher_id 的关联
 *
 * 原因：Excel 导入 fin_voucher 时 voucher_id 自增，实际值与 Excel 预设值不同。
 *       fin_voucher_entry 导入时 voucher_id 不匹配。
 *
 * 修复策略：以 ruid 为桥梁，将 fin_voucher_entry.voucher_id 更新为
 *           fin_voucher 中同 ruid 的实际 voucher_id。
 *
 * 用法：node scripts/fix_entry_voucher_link.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../config/db');

async function main() {
    console.log('════════════════════════════════════════');
    console.log('  修复 fin_voucher_entry.voucher_id 关联');
    console.log('════════════════════════════════════════\n');

    // 1. 读取 fin_voucher 的 ruid → voucher_id 映射
    const [vouchers] = await pool.execute(
        "SELECT voucher_id, ruid, voucher_no FROM fin_voucher WHERE YYYY_MM LIKE '2026-%'"
    );
    console.log(`凭证主表: ${vouchers.length} 张 (voucher_id ${Math.min(...vouchers.map(v=>v.voucher_id))}~${Math.max(...vouchers.map(v=>v.voucher_id))})`);

    const ruidToVid = new Map();
    for (const v of vouchers) ruidToVid.set(v.ruid, v.voucher_id);

    // 2. 读取现有分录
    const [entries] = await pool.execute(
        "SELECT entry_id, voucher_id, ruid FROM fin_voucher_entry WHERE ruid LIKE 'R%2026%'"
    );
    console.log(`现有分录: ${entries.length} 条 (voucher_id ${Math.min(...entries.map(e=>e.voucher_id))}~${Math.max(...entries.map(e=>e.voucher_id))})`);

    // 3. 逐条修复
    let fixed = 0;
    let notFound = 0;
    let already = 0;

    for (const e of entries) {
        const correctVid = ruidToVid.get(e.ruid);
        if (!correctVid) {
            notFound++;
            continue;
        }
        if (e.voucher_id === correctVid) {
            already++;
            continue;
        }
        await pool.execute(
            'UPDATE fin_voucher_entry SET voucher_id=? WHERE entry_id=?',
            [correctVid, e.entry_id]
        );
        fixed++;
    }

    console.log(`\n修复结果:`);
    console.log(`  ✅ 已修复: ${fixed} 条`);
    console.log(`  ⏭  已正确: ${already} 条`);
    console.log(`  ❌ 未匹配: ${notFound} 条 (ruid 在凭证主表中找不到)`);

    // 4. 对于未匹配的分录，说明它们的 ruid 在 fin_voucher 中不存在
    //    需要从 Excel 重新导入这些分录对应的凭证
    if (notFound > 0) {
        console.log(`\n⚠️ 有 ${notFound} 条分录的 ruid 在 fin_voucher 中找不到对应凭证`);
        console.log('   这些分录可能来自不同的数据源，需要单独处理。');

        // 列出未匹配的 ruid
        const unmatched = entries.filter(e => !ruidToVid.has(e.ruid)).map(e => e.ruid);
        const sample = unmatched.slice(0, 5);
        console.log(`   未匹配 ruid 样本: ${sample.join(', ')}${unmatched.length > 5 ? ' ...' : ''}`);
    }

    // 5. 验证修复结果
    console.log('\n════════════════════════════════════════');
    console.log('  修复后验证');
    console.log('════════════════════════════════════════\n');

    const [orphan] = await pool.execute(
        `SELECT COUNT(*) AS cnt FROM fin_voucher_entry e
         WHERE e.ruid LIKE 'R%2026%'
         AND NOT EXISTS (SELECT 1 FROM fin_voucher v WHERE v.voucher_id = e.voucher_id)`
    );
    console.log(`分录→凭证关联: ${orphan[0].cnt === 0 ? '✅ 全部匹配' : `❌ ${orphan[0].cnt} 条仍不匹配`}`);

    const [noEntries] = await pool.execute(
        `SELECT COUNT(*) AS cnt FROM fin_voucher v
         WHERE v.YYYY_MM LIKE '2026-%'
         AND NOT EXISTS (SELECT 1 FROM fin_voucher_entry e WHERE e.voucher_id = v.voucher_id)`
    );
    console.log(`凭证→分录关联: ${noEntries[0].cnt === 0 ? '✅ 全部有分录' : `❌ ${noEntries[0].cnt} 张凭证无分录`}`);

    // 6. 重新检查金额一致性
    const [mismatch] = await pool.execute(
        `SELECT COUNT(*) AS cnt FROM (
            SELECT v.voucher_id, v.total_debit AS vd, v.total_credit AS vc,
                   IFNULL(SUM(e.debit),0) AS ed, IFNULL(SUM(e.credit),0) AS ec
            FROM fin_voucher v
            LEFT JOIN fin_voucher_entry e ON e.voucher_id = v.voucher_id
            WHERE v.YYYY_MM LIKE '2026-%'
            GROUP BY v.voucher_id
            HAVING ABS(vd - ed) > 0.01 OR ABS(vc - ec) > 0.01
        ) t`
    );
    console.log(`凭证金额=分录金额: ${mismatch[0].cnt === 0 ? '✅ 全部一致' : `❌ ${mismatch[0].cnt} 张不一致`}`);

    process.exit(0);
}

main().catch(e => {
    console.error('❌ 修复失败:', e.message);
    process.exit(1);
});
