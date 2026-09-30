/**
 * 将 2005 年 U0001/U0002/U0003 的日报资料整体平移为 2025 年
 *   daily_report: report_date, YYYY, YYYY_MM
 *   daily_report_detail: report_date, complete_time, actual_date, YYYY, YYYY_MM
 *   daily_report_target: YYYY_MM
 * 之后自动重算目标设定（以 2025 实际 × 系数）
 */
const { pool } = require('../config/db');

const UIDS = ['U0001', 'U0002', 'U0003'];
const OLD = '2005';
const NEW = '2025';
const placeholders = UIDS.map(() => '?').join(',');

async function run() {
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
        console.log('📋 转换前计数...');
        const [[r1]] = await conn.execute(`
            SELECT COUNT(*) AS cnt FROM daily_report d
            WHERE d.bu_no='HM' AND d.user_id IN (${placeholders}) AND d.YYYY=?`, [...UIDS, OLD]);
        const [[r2]] = await conn.execute(`
            SELECT COUNT(*) AS cnt FROM daily_report_detail d
            WHERE d.bu_no='HM' AND d.user_id IN (${placeholders}) AND d.YYYY=?`, [...UIDS, OLD]);
        const [[r3]] = await conn.execute(`
            SELECT COUNT(*) AS cnt FROM daily_report_target t
            WHERE t.bu_no='HM' AND t.user_id IN (${placeholders}) AND t.YYYY_MM LIKE ?`, [...UIDS, `${OLD}/%`]);
        console.log(`   daily_report: ${r1.cnt}, detail: ${r2.cnt}, target: ${r3.cnt}`);

        console.log('\n🗑️  先删除可能已存在的 2025 数据（幂等）...');
        await conn.execute(`DELETE FROM daily_report_detail WHERE bu_no='HM' AND user_id IN (${placeholders}) AND YYYY=?`, [...UIDS, NEW]);
        await conn.execute(`DELETE FROM daily_report WHERE bu_no='HM' AND user_id IN (${placeholders}) AND YYYY=?`, [...UIDS, NEW]);
        await conn.execute(`DELETE FROM daily_report_target WHERE bu_no='HM' AND user_id IN (${placeholders}) AND YYYY_MM LIKE ?`, [...UIDS, `${NEW}/%`]);

        console.log('🔄 转换 daily_report...');
        // report_date: '2005-01-03' -> '2025-01-03'
        await conn.execute(`UPDATE daily_report SET
            report_date = REPLACE(report_date, ?, ?),
            YYYY = ?,
            YYYY_MM = REPLACE(YYYY_MM, ?, ?)
            WHERE bu_no='HM' AND user_id IN (${placeholders}) AND YYYY=?`,
            [OLD, NEW, parseInt(NEW), OLD, NEW, ...UIDS, parseInt(OLD)]);

        console.log('🔄 转换 daily_report_detail...');
        await conn.execute(`UPDATE daily_report_detail SET
            report_date = REPLACE(report_date, ?, ?),
            actual_date = REPLACE(actual_date, ?, ?),
            complete_time = REPLACE(complete_time, ?, ?),
            YYYY = ?,
            YYYY_MM = REPLACE(YYYY_MM, ?, ?)
            WHERE bu_no='HM' AND user_id IN (${placeholders}) AND YYYY=?`,
            [OLD, NEW, OLD, NEW, OLD, NEW, parseInt(NEW), OLD, NEW, ...UIDS, parseInt(OLD)]);

        console.log('🔄 转换 daily_report_target...');
        await conn.execute(`UPDATE daily_report_target SET
            YYYY_MM = REPLACE(YYYY_MM, ?, ?)
            WHERE bu_no='HM' AND user_id IN (${placeholders}) AND YYYY_MM LIKE ?`,
            [OLD, NEW, ...UIDS, `${OLD}/%`]);

        await conn.commit();
        console.log('\n✅ 事务提交完成！');
    } catch (e) {
        await conn.rollback();
        console.error('❌ 回滚：', e.message);
        throw e;
    } finally { conn.release(); }

    // 验证
    const [[c1]] = await pool.execute(`SELECT COUNT(*) AS cnt FROM daily_report WHERE bu_no='HM' AND user_id IN (${placeholders}) AND YYYY=?`, [...UIDS, NEW]);
    const [[c2]] = await pool.execute(`SELECT COUNT(*) AS cnt FROM daily_report_detail WHERE bu_no='HM' AND user_id IN (${placeholders}) AND YYYY=?`, [...UIDS, NEW]);
    const [[c3]] = await pool.execute(`SELECT COUNT(*) AS cnt FROM daily_report_target WHERE bu_no='HM' AND user_id IN (${placeholders}) AND YYYY_MM LIKE ?`, [...UIDS, `${NEW}/%`]);
    console.log(`\n📊 转换后：daily_report=${c1.cnt}, detail=${c2.cnt}, target=${c3.cnt}`);

    // 快速样例
    const [s] = await pool.execute(`SELECT user_id, report_date, YYYY_MM FROM daily_report WHERE bu_no='HM' AND YYYY=2025 ORDER BY id LIMIT 5`);
    console.log('   样例:', s.map(x => `${x.user_id} ${x.report_date}`).join(', '));

    await pool.end();
}
run().catch(e => process.exit(1));
