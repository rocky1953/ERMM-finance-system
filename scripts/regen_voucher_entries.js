/**
 * 重新生成 fin_voucher_entry 分录数据
 *
 * 原因：数据库中 194 条旧分录的 ruid 与 fin_voucher 不匹配，
 *       导致凭证→分录关联断裂。
 *
 * 修复步骤：
 *   1. 删除所有 ruid LIKE 'R%2026%' 的旧分录
 *   2. 从 fin_voucher 读取 120 张凭证（含 ruid、voucher_id、total_debit、summary）
 *   3. 为每张凭证生成 2 条分录（借+贷），金额 = 凭证总额
 *   4. 插入新分录
 *   5. 验证一致性
 *
 * 用法：node scripts/regen_voucher_entries.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../config/db');

// 科目模板：根据凭证摘要关键词匹配借/贷科目
const ENTRY_TEMPLATES = [
    { kw: '销售收款', dr: '1002', cr: '5001' },
    { kw: '应收账款', dr: '1122', cr: '5001' },
    { kw: '销售成本', dr: '6001', cr: '1122' },
    { kw: '管理费用', dr: '6602', cr: '1002' },
    { kw: '销售费用', dr: '6601', cr: '1002' },
    { kw: '应付账款', dr: '2202', cr: '1002' },
    { kw: '税费缴纳', dr: '2210', cr: '1002' },
    { kw: '财务费用', dr: '6603', cr: '1002' },
    { kw: '计提',     dr: '1002', cr: '2210' },
    { kw: '其他业务', dr: '1002', cr: '5051' },
    { kw: '现金存入', dr: '1002', cr: '1001' },
];

const SUBJECT_NAMES = {
    '1001': '库存现金', '1002': '银行存款', '1122': '应收账款',
    '2202': '应付账款', '2210': '应交税费', '5001': '主营业务收入',
    '5051': '其他业务收入', '6001': '主营业务成本',
    '6601': '销售费用', '6602': '管理费用', '6603': '财务费用',
};

function matchTemplate(summary) {
    for (const t of ENTRY_TEMPLATES) {
        if (summary.includes(t.kw)) return t;
    }
    return { dr: '1002', cr: '5001' };  // 默认
}

async function main() {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // 1. 删除旧分录
        const [del] = await conn.execute("DELETE FROM fin_voucher_entry WHERE ruid LIKE 'R%2026%'");
        console.log(`🗑  删除旧分录: ${del.affectedRows} 条`);

        // 2. 读取凭证
        const [vouchers] = await conn.execute(
            "SELECT voucher_id, ruid, voucher_no, voucher_date, YYYY_MM, summary, total_debit, total_credit FROM fin_voucher WHERE YYYY_MM LIKE '2026-%' ORDER BY voucher_id"
        );
        console.log(`📋 读取凭证: ${vouchers.length} 张`);

        // 3. 为每张凭证生成 2 条分录
        let inserted = 0;
        for (const v of vouchers) {
            const tmpl = matchTemplate(v.summary || '');
            const drName = SUBJECT_NAMES[tmpl.dr] || tmpl.dr;
            const crName = SUBJECT_NAMES[tmpl.cr] || tmpl.cr;

            // 借方分录
            await conn.execute(
                `INSERT INTO fin_voucher_entry (voucher_id, ruid, subject_code, subject_name, debit, credit, summary, source_doc)
                 VALUES (?,?,?,?,?,?,?,?)`,
                [v.voucher_id, v.ruid, tmpl.dr, drName, v.total_debit, 0, v.summary, `DOC-${v.voucher_no}`]
            );
            inserted++;

            // 贷方分录
            await conn.execute(
                `INSERT INTO fin_voucher_entry (voucher_id, ruid, subject_code, subject_name, debit, credit, summary, source_doc)
                 VALUES (?,?,?,?,?,?,?,?)`,
                [v.voucher_id, v.ruid, tmpl.cr, crName, 0, v.total_credit, v.summary, `DOC-${v.voucher_no}`]
            );
            inserted++;
        }

        await conn.commit();
        console.log(`✅ 插入新分录: ${inserted} 条\n`);

        // 4. 验证
        console.log('════════════════════════════════════════');
        console.log('  修复后数据校验');
        console.log('════════════════════════════════════════\n');

        // 分录总数
        const [cnt] = await pool.execute("SELECT COUNT(*) AS cnt FROM fin_voucher_entry WHERE ruid LIKE 'R%2026%'");
        console.log(`分录总数: ${cnt[0].cnt} 条`);

        // 借贷平衡
        const [bal] = await pool.execute(
            "SELECT SUM(debit) AS dr, SUM(credit) AS cr FROM fin_voucher_entry WHERE ruid LIKE 'R%2026%'"
        );
        const dr = Number(bal[0].dr || 0);
        const cr = Number(bal[0].cr || 0);
        console.log(`借方合计: ${dr.toLocaleString('en-US', {minimumFractionDigits:2})}`);
        console.log(`贷方合计: ${cr.toLocaleString('en-US', {minimumFractionDigits:2})}`);
        console.log(`借贷平衡: ${Math.abs(dr - cr) < 0.01 ? '✅' : '❌'}`);

        // 跨表关联
        const [orphan] = await pool.execute(
            `SELECT COUNT(*) AS cnt FROM fin_voucher_entry e
             WHERE e.ruid LIKE 'R%2026%'
             AND NOT EXISTS (SELECT 1 FROM fin_voucher v WHERE v.voucher_id = e.voucher_id)`
        );
        console.log(`分录→凭证关联: ${orphan[0].cnt === 0 ? '✅ 全部匹配' : `❌ ${orphan[0].cnt} 条不匹配`}`);

        const [noEntries] = await pool.execute(
            `SELECT COUNT(*) AS cnt FROM fin_voucher v
             WHERE v.YYYY_MM LIKE '2026-%'
             AND NOT EXISTS (SELECT 1 FROM fin_voucher_entry e WHERE e.voucher_id = v.voucher_id)`
        );
        console.log(`凭证→分录关联: ${noEntries[0].cnt === 0 ? '✅ 全部有分录' : `❌ ${noEntries[0].cnt} 张无分录`}`);

        // 金额一致
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

        // RUID 唯一
        const [dup] = await pool.execute(
            "SELECT ruid, COUNT(*) AS cnt FROM fin_voucher WHERE YYYY_MM LIKE '2026-%' GROUP BY ruid HAVING cnt > 1"
        );
        console.log(`RUID 唯一性: ${dup.length === 0 ? '✅ 无重复' : `❌ ${dup.length} 个重复`}`);

        // 按科目分布
        const [subj] = await pool.execute(
            "SELECT subject_code, subject_name, COUNT(*) AS cnt, SUM(debit) AS dr, SUM(credit) AS cr FROM fin_voucher_entry WHERE ruid LIKE 'R%2026%' GROUP BY subject_code, subject_name ORDER BY subject_code"
        );
        console.log('\n按科目分布:');
        for (const r of subj) {
            console.log(`  ${r.subject_code} ${r.subject_name}: ${r.cnt} 笔 | 借 ${Number(r.dr||0).toLocaleString('en-US',{minimumFractionDigits:2})} | 贷 ${Number(r.cr||0).toLocaleString('en-US',{minimumFractionDigits:2})}`);
        }

        // 按月份分布
        const [month] = await pool.execute(
            `SELECT v.YYYY_MM, COUNT(*) AS cnt, SUM(e.debit) AS dr
             FROM fin_voucher_entry e
             JOIN fin_voucher v ON v.voucher_id = e.voucher_id
             WHERE e.ruid LIKE 'R%2026%'
             GROUP BY v.YYYY_MM ORDER BY v.YYYY_MM`
        );
        console.log('\n按月份分布:');
        for (const r of month) {
            console.log(`  ${r.YYYY_MM}: ${r.cnt} 条分录 | 借方 ${Number(r.dr||0).toLocaleString('en-US',{minimumFractionDigits:2})}`);
        }

        console.log('\n════════════════════════════════════════');
        console.log('  ✅ 修复完成');
        console.log('════════════════════════════════════════');

    } catch (e) {
        await conn.rollback();
        console.error('❌ 修复失败:', e.message);
    } finally {
        conn.release();
        process.exit(0);
    }
}

main();
