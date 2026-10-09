/**
 * 2026 H1 凭证导入数据校验报告
 *
 * 校验项目：
 *   1. fin_account_subject — 科目数量、类别分布
 *   2. fin_voucher        — 凭证数量、按 BU/月份分布、状态分布、借贷平衡
 *   3. fin_voucher_entry   — 分录数量、借贷平衡、科目引用一致性
 *   4. 跨表一致性          — 分录 voucher_id 是否都能在 fin_voucher 找到
 *   5. RUID 唯一性         — fin_voucher.ruid 无重复
 *
 * 用法：node scripts/validate_2026_h1_import.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../config/db');

function line(c = '─', n = 60) { return c.repeat(n); }

async function main() {
    console.log(line('═'));
    console.log('  2026 H1 凭证导入数据校验报告');
    console.log('  生成时间:', new Date().toLocaleString('zh-CN'));
    console.log(line('═'));

    // ===== 1. 会计科目 =====
    console.log('\n📋 1. 会计科目 (fin_account_subject)');
    console.log(line());

    const [subCount] = await pool.execute('SELECT COUNT(*) AS cnt FROM fin_account_subject');
    console.log(`   总科目数: ${subCount[0].cnt}`);

    const [subType] = await pool.execute(
        "SELECT subject_type, COUNT(*) AS cnt, GROUP_CONCAT(subject_code ORDER BY subject_code SEPARATOR ', ') AS codes FROM fin_account_subject GROUP BY subject_type ORDER BY subject_type"
    );
    for (const r of subType) {
        console.log(`   ${r.subject_type}: ${r.cnt} 个科目 [${r.codes}]`);
    }

    const [subActive] = await pool.execute('SELECT COUNT(*) AS cnt FROM fin_account_subject WHERE is_active=1');
    console.log(`   启用状态: ${subActive[0].cnt} 个`);

    // ===== 2. 凭证主表 =====
    console.log('\n📋 2. 凭证主表 (fin_voucher)');
    console.log(line());

    const [vchCount] = await pool.execute(
        "SELECT COUNT(*) AS cnt FROM fin_voucher WHERE YYYY_MM LIKE '2026-%'"
    );
    console.log(`   2026 年凭证总数: ${vchCount[0].cnt}`);

    // 按 BU 分布
    const [vchBU] = await pool.execute(
        "SELECT bu_no, COUNT(*) AS cnt, SUM(total_debit) AS total_debit, SUM(total_credit) AS total_credit FROM fin_voucher WHERE YYYY_MM LIKE '2026-%' GROUP BY bu_no ORDER BY bu_no"
    );
    console.log('   按公司别分布:');
    for (const r of vchBU) {
        console.log(`     ${r.bu_no}: ${r.cnt} 张凭证 | 借方合计 ${Number(r.total_debit).toLocaleString('en-US',{minimumFractionDigits:2})} | 贷方合计 ${Number(r.total_credit).toLocaleString('en-US',{minimumFractionDigits:2})}`);
    }

    // 按月份分布
    const [vchMonth] = await pool.execute(
        "SELECT YYYY_MM, COUNT(*) AS cnt, SUM(total_debit) AS total_dr FROM fin_voucher WHERE YYYY_MM LIKE '2026-%' GROUP BY YYYY_MM ORDER BY YYYY_MM"
    );
    console.log('   按月份分布:');
    for (const r of vchMonth) {
        console.log(`     ${r.YYYY_MM}: ${r.cnt} 张 | 借方合计 ${Number(r.total_dr).toLocaleString('en-US',{minimumFractionDigits:2})}`);
    }

    // 按状态分布
    const [vchStatus] = await pool.execute(
        "SELECT status, COUNT(*) AS cnt FROM fin_voucher WHERE YYYY_MM LIKE '2026-%' GROUP BY status"
    );
    console.log('   按状态分布:');
    for (const r of vchStatus) {
        console.log(`     ${r.status}: ${r.cnt} 张`);
    }

    // 借贷平衡检查
    const [vchBal] = await pool.execute(
        "SELECT COUNT(*) AS unbalanced FROM fin_voucher WHERE YYYY_MM LIKE '2026-%' AND ABS(total_debit - total_credit) > 0.01"
    );
    console.log(`   借贷平衡检查: ${vchBal[0].unbalanced === 0 ? '✅ 全部平衡' : `❌ ${vchBal[0].unbalanced} 张不平衡`}`);

    // ===== 3. 凭证分录 =====
    console.log('\n📋 3. 凭证分录 (fin_voucher_entry)');
    console.log(line());

    const [entryCount] = await pool.execute(
        "SELECT COUNT(*) AS cnt FROM fin_voucher_entry WHERE ruid LIKE 'R%2026%'"
    );
    console.log(`   2026 年分录总数: ${entryCount[0].cnt}`);

    const [entrySum] = await pool.execute(
        "SELECT SUM(debit) AS total_dr, SUM(credit) AS total_cr FROM fin_voucher_entry WHERE ruid LIKE 'R%2026%'"
    );
    const totalDr = Number(entrySum[0].total_dr || 0);
    const totalCr = Number(entrySum[0].total_cr || 0);
    console.log(`   借方合计: ${totalDr.toLocaleString('en-US',{minimumFractionDigits:2})}`);
    console.log(`   贷方合计: ${totalCr.toLocaleString('en-US',{minimumFractionDigits:2})}`);
    console.log(`   借贷差额: ${(totalDr - totalCr).toFixed(2)} ${Math.abs(totalDr - totalCr) < 0.01 ? '✅ 平衡' : '❌ 不平衡'}`);

    // 分录按科目分布
    const [entrySubj] = await pool.execute(
        "SELECT subject_code, subject_name, COUNT(*) AS cnt, SUM(debit) AS dr, SUM(credit) AS cr FROM fin_voucher_entry WHERE ruid LIKE 'R%2026%' GROUP BY subject_code, subject_name ORDER BY subject_code"
    );
    console.log('   按科目分布:');
    for (const r of entrySubj) {
        console.log(`     ${r.subject_code} ${r.subject_name}: ${r.cnt} 笔 | 借 ${Number(r.dr||0).toLocaleString('en-US',{minimumFractionDigits:2})} | 贷 ${Number(r.cr||0).toLocaleString('en-US',{minimumFractionDigits:2})}`);
    }

    // ===== 4. 跨表一致性 =====
    console.log('\n📋 4. 跨表一致性检查');
    console.log(line());

    // 分录的 voucher_id 是否都在 fin_voucher 中存在
    const [orphanEntries] = await pool.execute(
        `SELECT COUNT(*) AS cnt FROM fin_voucher_entry e
         WHERE e.ruid LIKE 'R%2026%'
         AND NOT EXISTS (SELECT 1 FROM fin_voucher v WHERE v.voucher_id = e.voucher_id)`
    );
    console.log(`   分录→凭证关联: ${orphanEntries[0].cnt === 0 ? '✅ 全部匹配' : `❌ ${orphanEntries[0].cnt} 条分录找不到对应凭证`}`);

    // 凭证的 ruid 是否在分录中都有对应
    const [orphanVouchers] = await pool.execute(
        `SELECT COUNT(*) AS cnt FROM fin_voucher v
         WHERE v.YYYY_MM LIKE '2026-%'
         AND NOT EXISTS (SELECT 1 FROM fin_voucher_entry e WHERE e.voucher_id = v.voucher_id)`
    );
    console.log(`   凭证→分录关联: ${orphanVouchers[0].cnt === 0 ? '✅ 全部有分录' : `❌ ${orphanVouchers[0].cnt} 张凭证无分录`}`);

    // RUID 唯一性
    const [dupRuid] = await pool.execute(
        "SELECT ruid, COUNT(*) AS cnt FROM fin_voucher WHERE YYYY_MM LIKE '2026-%' GROUP BY ruid HAVING cnt > 1"
    );
    console.log(`   RUID 唯一性: ${dupRuid.length === 0 ? '✅ 无重复' : `❌ ${dupRuid.length} 个重复 RUID`}`);

    // 每张凭证的分录借贷是否与主表总额一致
    const [mismatch] = await pool.execute(
        `SELECT v.voucher_no, v.total_debit AS vd, v.total_credit AS vc,
                IFNULL(SUM(e.debit),0) AS ed, IFNULL(SUM(e.credit),0) AS ec
         FROM fin_voucher v
         LEFT JOIN fin_voucher_entry e ON e.voucher_id = v.voucher_id
         WHERE v.YYYY_MM LIKE '2026-%'
         GROUP BY v.voucher_id
         HAVING ABS(vd - ed) > 0.01 OR ABS(vc - ec) > 0.01`
    );
    console.log(`   凭证金额=分录金额: ${mismatch.length === 0 ? '✅ 全部一致' : `❌ ${mismatch.length} 张不一致`}`);

    // ===== 5. 汇总 =====
    console.log('\n' + line('═'));
    console.log('  校验汇总');
    console.log(line('═'));
    console.log(`  会计科目:  ${subCount[0].cnt} 个`);
    console.log(`  凭证主表:  ${vchCount[0].cnt} 张 (2026 H1)`);
    console.log(`  凭证分录:  ${entryCount[0].cnt} 条`);
    console.log(`  借方合计:  ${totalDr.toLocaleString('en-US',{minimumFractionDigits:2})}`);
    console.log(`  贷方合计:  ${totalCr.toLocaleString('en-US',{minimumFractionDigits:2})}`);
    console.log(`  跨表一致:  ${orphanEntries[0].cnt === 0 && orphanVouchers[0].cnt === 0 ? '✅' : '❌'}`);
    console.log(`  RUID 唯一:  ${dupRuid.length === 0 ? '✅' : '❌'}`);
    console.log(`  借贷平衡:  ${vchBal[0].unbalanced === 0 && Math.abs(totalDr - totalCr) < 0.01 ? '✅' : '❌'}`);
    console.log(`  金额一致:  ${mismatch.length === 0 ? '✅' : '❌'}`);
    console.log(line('═'));

    process.exit(0);
}

main().catch(e => {
    console.error('❌ 校验失败:', e.message);
    process.exit(1);
});
