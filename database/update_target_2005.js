/**
 * 重新调整 2005 年 U0001/U0002/U0003 的目标设定
 *   目标工时 = 实际 × 系数，让达成率有高有低
 *   延误/未解上限 = 实际值 ± 浮动
 */
const { pool } = require('../config/db');

// 每个人每月的配置
// hrs: 工时系数（实际 * hrs = 目标）
// delay: 延误上限, unres: 未解上限, wr: 工作占比下限
// remark: 说明
const GOAL_CONFIG = {
    'U0001|2005/01': { hrs: 1.05, delay: 22, unres: 28, wr: 60, remark: '年初忙年終結算' },
    'U0001|2005/02': { hrs: 0.90, delay: 12, unres: 10, wr: 80, remark: '春節後補進度' },
    'U0001|2005/03': { hrs: 0.95, delay: 18, unres: 22, wr: 70, remark: '招募旺季' },
    'U0001|2005/04': { hrs: 1.00, delay: 28, unres: 18, wr: 72, remark: '績效月' },
    'U0001|2005/05': { hrs: 0.85, delay: 10, unres: 10, wr: 75, remark: '目標偏易-激勵達標' },
    'U0001|2005/06': { hrs: 1.00, delay: 14, unres: 25, wr: 70, remark: '補強進度' },
    'U0001|2005/07': { hrs: 1.15, delay: 22, unres: 26, wr: 75, remark: '高標挑戰月' },
    'U0001|2005/08': { hrs: 1.10, delay: 6,  unres: 11, wr: 65, remark: '教育訓練減少' },
    'U0001|2005/09': { hrs: 0.95, delay: 25, unres: 9,  wr: 78, remark: '教育訓練季' },
    'U0001|2005/10': { hrs: 1.05, delay: 26, unres: 22, wr: 62, remark: '招募活動' },
    'U0001|2005/11': { hrs: 0.90, delay: 5,  unres: 15, wr: 70, remark: '目標偏易-激勵' },
    'U0001|2005/12': { hrs: 1.00, delay: 20, unres: 16, wr: 75, remark: '年終收尾' },

    'U0002|2005/01': { hrs: 0.90, delay: 10, unres: 13, wr: 62, remark: '採購淡季' },
    'U0002|2005/02': { hrs: 0.90, delay: 5,  unres: 11, wr: 68, remark: '春節後恢復' },
    'U0002|2005/03': { hrs: 0.95, delay: 12, unres: 8,  wr: 66, remark: '原物料漲價' },
    'U0002|2005/04': { hrs: 1.05, delay: 12, unres: 25, wr: 78, remark: '採購旺季' },
    'U0002|2005/05': { hrs: 1.00, delay: 22, unres: 12, wr: 64, remark: '趕交期' },
    'U0002|2005/06': { hrs: 1.00, delay: 8,  unres: 18, wr: 73, remark: '採購結算' },
    'U0002|2005/07': { hrs: 1.10, delay: 10, unres: 14, wr: 72, remark: '高標挑戰' },
    'U0002|2005/08': { hrs: 1.05, delay: 22, unres: 16, wr: 68, remark: '廠商異常多' },
    'U0002|2005/09': { hrs: 0.95, delay: 15, unres: 20, wr: 72, remark: '易達標月份' },
    'U0002|2005/10': { hrs: 0.90, delay: 20, unres: 11, wr: 75, remark: '供應商評鑑' },
    'U0002|2005/11': { hrs: 0.88, delay: 15, unres: 8,  wr: 73, remark: '超額達標月' },
    'U0002|2005/12': { hrs: 1.00, delay: 22, unres: 11, wr: 78, remark: '年終採購' },

    'U0003|2005/01': { hrs: 1.00, delay: 15, unres: 10, wr: 70, remark: '年初採購計畫' },
    'U0003|2005/02': { hrs: 1.00, delay: 11, unres: 15, wr: 60, remark: '目標偏難' },
    'U0003|2005/03': { hrs: 0.90, delay: 10, unres: 0,  wr: 60, remark: '激勵達標' },
    'U0003|2005/04': { hrs: 1.05, delay: 11, unres: 12, wr: 68, remark: '高標月' },
    'U0003|2005/05': { hrs: 1.00, delay: 28, unres: 20, wr: 70, remark: '交期壓力大' },
    'U0003|2005/06': { hrs: 0.85, delay: 10, unres: 11, wr: 73, remark: '超額達標月' },
    'U0003|2005/07': { hrs: 0.95, delay: 11, unres: 7,  wr: 72, remark: '採購淡季' },
    'U0003|2005/08': { hrs: 1.05, delay: 25, unres: 6,  wr: 70, remark: '目標偏難' },
    'U0003|2005/09': { hrs: 1.00, delay: 24, unres: 21, wr: 66, remark: '廠商異常多' },
    'U0003|2005/10': { hrs: 1.05, delay: 26, unres: 13, wr: 70, remark: '挑戰目標' },
    'U0003|2005/11': { hrs: 1.00, delay: 16, unres: 11, wr: 68, remark: '進收尾階段' },
    'U0003|2005/12': { hrs: 0.95, delay: 18, unres: 5,  wr: 74, remark: '年終整理' }
};

const ACTUAL = {};

async function run() {
    const [rows] = await pool.execute(`
        SELECT d.user_id, d.YYYY_MM AS ym,
               ROUND(SUM(dt.use_time), 1) AS total_hours
          FROM daily_report d
          LEFT JOIN daily_report_detail dt ON dt.ruid = d.id
         WHERE d.bu_no='HM' AND d.YYYY=2005 AND d.user_id IN ('U0001','U0002','U0003')
           AND d.status1='USE'
         GROUP BY d.user_id, d.YYYY_MM
    `);
    for (const r of rows) ACTUAL[`${r.user_id}|${r.ym}`] = r.total_hours;

    console.log('🗑️  清除 2005 旧目标...');
    await pool.execute(
        `DELETE FROM daily_report_target WHERE bu_no='HM' AND user_id IN ('U0001','U0002','U0003') AND YYYY_MM LIKE '2005/%'`
    );

    let ok = 0, skip = 0;
    for (const [key, cfg] of Object.entries(GOAL_CONFIG)) {
        const [uid, ym] = key.split('|');
        const actual = ACTUAL[key];
        if (!actual) { skip++; continue; }
        const targetHrs = Math.round(actual * cfg.hrs);
        await pool.execute(`
            INSERT INTO daily_report_target
                (bu_no, user_id, YYYY_MM, target_hours, max_delays, max_unresolved, min_work_ratio, set_by, set_by_name, remark)
             VALUES (?,?,?,?,?,?,?,?,?,?)
        `, ['HM', uid, ym, targetHrs, cfg.delay, cfg.unres, cfg.wr, 'mgr_戴濤', '戴濤', cfg.remark]);
        const rate = (actual / targetHrs * 100).toFixed(0);
        const tag = rate >= 100 ? 'OK' : rate >= 85 ? '==' : '!!';
        console.log(`  ${tag} ${uid} ${ym}: actual ${actual}h -> target ${targetHrs}h (${rate}%) delay<=${cfg.delay} unres<=${cfg.unres}`);
        ok++;
    }
    console.log(`\nDone: ${ok} updated, ${skip} skipped`);
    await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
