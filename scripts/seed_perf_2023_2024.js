/**
 * 补全 2023 + 2024 绩效资料
 *
 * 2023 已有的：daily_report + detail + summary + forecast_detail
 * 2023 缺的：  daily_report_target + daily_report_annual_review
 *
 * 2024 已有的：summary(3BU) + forecast_detail(forecast_amt only)
 * 2024 缺的：  forecast_detail.actual_amt + daily_report + detail + target + annual_review
 *
 * 执行顺序：
 *   Step 1: 2024 forecast_detail.actual_amt（从 forecast_amt + 偏差推算）
 *   Step 2: 2024 daily_report + detail（复用 seed_daily_2023 逻辑，2BU）
 *   Step 3: 2023 + 2024 daily_report_target（每人每月目标）
 *   Step 4: 2023 + 2024 daily_report_annual_review（一键结算，从 daily_report + target 计算）
 */
const { pool } = require('../config/db');

let seed = 20240101;
function rnd() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
const pad2 = n => String(n).padStart(2, '0');

const BU_USERS = {
  HM: [
    { user_id: 'U0001', user_name: '黄惠君', depart: '财务部' },
    { user_id: 'U0003', user_name: '王佩珊', depart: '采购部' },
    { user_id: 'U0007', user_name: '孙铭轩', depart: '研发部' },
    { user_id: 'U0008', user_name: '徐志强', depart: '生产部' },
    { user_id: 'U0012', user_name: '王建宏', depart: '营业部' },
  ],
  SZ: [
    { user_id: 'U0002', user_name: '李静怡', depart: '采购部' },
    { user_id: 'U0005', user_name: '杨雅婷', depart: '财务部' },
    { user_id: 'U0009', user_name: '黄志强', depart: '生产部' },
    { user_id: 'U0013', user_name: '黄伟豪', depart: '研发部' },
    { user_id: 'U0016', user_name: '李俊杰', depart: '营业部' },
  ],
};

const WORK_TYPES = ['日常工作', '会议沟通', '客户拜访', '学习训练', '行政事务'];
const PROJECTS_COMMON = ['单据审核', '报表编制', '会议记录', '客户对接', '内部沟通', '系统操作', '数据整理', '方案设计'];
const DELAY_REASONS = [null, null, null, null, '前置作业未完成', '客户资料延迟', '系统故障', '跨部门协调中', null];
const UNRESOLVED = [null, null, null, null, '供应商待回复', '客户待确认', '预算待审批', null];

function workdaysOfMonth(year, m) {
  const days = [];
  const last = new Date(year, m, 0).getDate();
  for (let d = 1; d <= last; d++) {
    const dt = new Date(year, m - 1, d);
    const w = dt.getDay();
    if (w !== 0 && w !== 6) days.push(pad2(d));
  }
  return days;
}
function fmtTime(h) { return pad2(h) + ':00'; }

async function step1_fill_forecast_actual(conn) {
  console.log('\n=== Step 1: 2024 forecast_detail.actual_amt ===');
  const [fd] = await conn.execute(
    "SELECT bu_no, YYYY_MM, forecast_amt, actual_amt FROM forecast_detail WHERE YYYY_MM LIKE '2024-%' AND forecast_type='Sales'");
  let cnt = 0;
  for (const r of fd) {
    if (Number(r.actual_amt || 0) > 0) continue;
    const forecast = Number(r.forecast_amt || 0);
    const dev = (rnd() - 0.48) * 0.12;   // -6% ~ +6% 偏差
    const actual = Math.round(forecast * (1 + dev));
    await conn.execute("UPDATE forecast_detail SET actual_amt=? WHERE uid IN (SELECT uid FROM (SELECT uid FROM forecast_detail WHERE bu_no=? AND YYYY_MM=? AND forecast_type='Sales') x)",
      [actual, r.bu_no, r.YYYY_MM]);
    cnt++;
  }
  console.log(`  ✓ 更新 ${cnt} 行 actual_amt`);
}

async function step2_gen_daily_report(conn, year, growthSeed) {
  console.log(`\n=== Step 2: ${year} daily_report + detail ===`);
  seed = growthSeed;
  // 幂等清理
  const [d_del] = await conn.execute(`DELETE FROM daily_report_detail WHERE report_date LIKE '${year}%'`);
  const [r_del] = await conn.execute(`DELETE FROM daily_report WHERE report_date LIKE '${year}%'`);
  console.log(`  ✓ 清理 ${r_del.affectedRows} 日报 + ${d_del.affectedRows} 明细`);

  let rid = 0, did = 0;
  for (const [bu, users] of Object.entries(BU_USERS)) {
    for (const user of users) {
      for (let m = 1; m <= 12; m++) {
        const ym = `${year}-${pad2(m)}`;
        const days = workdaysOfMonth(year, m);
        for (const dd of days) {
          const report_date = `${year}-${pad2(m)}-${dd}`;
          if (rnd() < 0.18) continue;

          const projects1 = DELAY_REASONS[Math.floor(rnd() * DELAY_REASONS.length)];
          const projects2 = UNRESOLVED[Math.floor(rnd() * UNRESOLVED.length)];
          const [ins] = await conn.execute(
            "INSERT INTO daily_report (bu_no, depart_id, user_id, user_name, report_date, projects1, projects2, status1, YYYY, YYYY_MM) VALUES (?, ?, ?, ?, ?, ?, ?, 'USE', ?, ?)",
            [bu, user.depart, user.user_id, user.user_name, report_date, projects1, projects2, year, ym]);
          const reportId = ins.insertId;
          rid++;

          const dc = 3 + Math.floor(rnd() * 3);
          const totalH = 8 + rnd() * 1.5;
          let fromH = 9;
          const used = new Set();
          for (let i = 0; i < dc; i++) {
            const frac = 1 / dc;
            const hours = i === dc - 1 ? Math.round((totalH - (dc - 1) * totalH * frac) * 100) / 100 : Math.round(totalH * frac * 100) / 100;
            const from = fmtTime(fromH);
            const toH = Math.min(fromH + Math.ceil(hours), 18);
            const to = fmtTime(toH);
            const wkType = rnd() < 0.6 ? '日常工作' : WORK_TYPES.filter(w => w !== '日常工作')[Math.floor(rnd() * 4)];
            let proj; do { proj = PROJECTS_COMMON[Math.floor(rnd() * PROJECTS_COMMON.length)]; } while (used.has(proj) && used.size < PROJECTS_COMMON.length);
            used.add(proj);
            await conn.execute(
              "INSERT INTO daily_report_detail (bu_no, depart_id, user_id, user_name, report_date, from_time, to_time, use_time, projects, wk_type, YYYY_MM, YYYY, ruid, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())",
              [bu, user.depart, user.user_id, user.user_name, report_date, from, to, hours, proj, wkType, ym, year, reportId]);
            did++;
            fromH = toH;
            if (fromH >= 18) break;
          }
        }
      }
    }
  }
  console.log(`  ✓ 写入 ${rid} 日报 + ${did} 明细`);
  return { rid, did };
}

async function step3_gen_target(conn, year) {
  console.log(`\n=== Step 3: ${year} daily_report_target ===`);
  const [del] = await conn.execute("DELETE FROM daily_report_target WHERE YYYY_MM LIKE '" + year + "-%'");
  console.log(`  ✓ 清理 ${del.affectedRows} 行`);

  // 从实际日报统计每月每人工时，推算目标
  for (const [bu, users] of Object.entries(BU_USERS)) {
    for (const user of users) {
      for (let m = 1; m <= 12; m++) {
        const ym = `${year}-${pad2(m)}`;
        const [rows] = await conn.execute(`
          SELECT COUNT(DISTINCT d.report_date) AS days, SUM(dt.use_time) AS h
            FROM daily_report d LEFT JOIN daily_report_detail dt ON dt.ruid = d.id
            WHERE d.bu_no=? AND d.user_id=? AND d.YYYY_MM=? AND d.status1='USE'`,
          [bu, user.user_id, ym]);
        const row = rows[0];
        const days = row.days || 0;
        const totalH = Number(row.h || 0);
        const workdays = workdaysOfMonth(year, m).length;

        // 目标工时 ≈ 实际 × 0.95（略低于实际）
        const targetH = Math.round(Math.max(60, totalH * 0.95 + workdays * 0.5));
        const maxDelays = Math.max(5, Math.round(days * 0.15 + rnd() * 5));
        const maxUnres = Math.max(3, Math.round(days * 0.08 + rnd() * 4));
        const minWork = Math.max(60, Math.round(65 + rnd() * 15));

        await conn.execute(`
          INSERT INTO daily_report_target (bu_no, user_id, YYYY_MM, target_hours, max_delays, max_unresolved, min_work_ratio, set_by, set_by_name, set_time, remark)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'sys_gen', '系统生成', NOW(), '自动生成')
        `, [bu, user.user_id, ym, targetH, maxDelays, maxUnres, minWork]);
      }
    }
  }
  const [cnt] = await conn.execute("SELECT COUNT(*) AS n FROM daily_report_target WHERE YYYY_MM LIKE '" + year + "-%'");
  console.log(`  ✓ 写入 ${cnt[0].n} 行目标`);
}

async function step4_gen_annual_review(conn, year) {
  console.log(`\n=== Step 4: ${year} daily_report_annual_review ===`);
  await conn.execute("DELETE FROM daily_report_annual_review WHERE yyyy=?", [year]);
  console.log(`  ✓ 清理完成，开始循环...`);

  for (const [bu, users] of Object.entries(BU_USERS)) {
    console.log(`  BU=${bu}, users=${users.length}`);
    for (const user of users) {
      // 读取该用户 12 个月的汇总
      const [months] = await conn.execute(`
        SELECT d.YYYY_MM,
               COUNT(DISTINCT d.report_date) AS report_days,
               SUM(CASE WHEN d.projects1 IS NOT NULL THEN 1 ELSE 0 END) AS delay_cnt,
               SUM(CASE WHEN d.projects2 IS NOT NULL THEN 1 ELSE 0 END) AS unresolved_cnt,
               SUM(dt.use_time) AS total_hours,
               SUM(CASE WHEN dt.wk_type='日常工作' THEN dt.use_time ELSE 0 END) AS work_hours
          FROM daily_report d LEFT JOIN daily_report_detail dt ON dt.ruid = d.id
         WHERE d.bu_no=? AND d.user_id=? AND d.YYYY_MM LIKE ? AND d.status1='USE'
         GROUP BY d.YYYY_MM ORDER BY d.YYYY_MM`,
        [bu, user.user_id, `${year}-%`]);

      // 读取 12 个月的 target
      const [targets] = await conn.execute(
        "SELECT YYYY_MM, target_hours, max_delays, max_unresolved, min_work_ratio FROM daily_report_target WHERE bu_no=? AND user_id=? AND YYYY_MM LIKE ?",
        [bu, user.user_id, `${year}-%`]);
      const tgtMap = {};
      targets.forEach(t => { tgtMap[t.YYYY_MM] = t; });

      // 构建 months JSON 数组
      const monthData = [];
      let sumAchieve = 0, sumTimeliness = 0, nMonths = 0;
      let scoreHours = 0, scorePenalty = 100, okrBonus = 0;

      for (let m = 1; m <= 12; m++) {
        const ym = `${year}-${pad2(m)}`;
        const md = months.find(x => x.YYYY_MM === ym) || { report_days: 0, delay_cnt: 0, unresolved_cnt: 0, total_hours: 0, work_hours: 0 };
        const tgt = tgtMap[ym] || { target_hours: 160, max_delays: 15, max_unresolved: 10, min_work_ratio: 70 };
        const dueDays = workdaysOfMonth(year, m).length;
        const workRatio = Number(md.total_hours || 0) > 0 ? Math.round(Number(md.work_hours || 0) / Number(md.total_hours) * 100) : 0;
        const hoursAchieve = tgt.target_hours > 0 ? Math.round(Number(md.total_hours || 0) / tgt.target_hours * 1000) / 10 : 0;

        monthData.push({
          locked: false, YYYY_MM: ym.replace('-', '/'), due_days: dueDays,
          late_cnt: 0, delay_cnt: Number(md.delay_cnt || 0),
          max_delays: tgt.max_delays || 15, work_hours: Math.round(Number(md.work_hours || 0) * 10) / 10,
          work_ratio: workRatio, report_days: md.report_days || 0, total_hours: Math.round(Number(md.total_hours || 0) * 10) / 10,
          okr_progress: null, target_hours: tgt.target_hours || 160, hours_achieve: hoursAchieve,
          okr_objective: '', max_unresolved: tgt.max_unresolved || 10, min_work_ratio: tgt.min_work_ratio || 70,
          unresolved_cnt: Number(md.unresolved_cnt || 0),
        });

        if (md.report_days > 0) {
          sumAchieve += hoursAchieve;
          sumTimeliness += Math.max(0, 100 - (Number(md.delay_cnt || 0) / (tgt.max_delays || 15) * 30));
          nMonths++;
        }
      }

      const avgAchieve = nMonths > 0 ? Math.round(sumAchieve / nMonths * 10) / 10 : 0;
      const avgTimeliness = nMonths > 0 ? Math.round(sumTimeliness / nMonths * 10) / 10 : 0;

      // 评分
      const hoursScore = Math.min(100, avgAchieve * 0.98);   // 工时达成
      const timelinessScore = avgTimeliness;                  // 及时率
      const avgWorkRatio = nMonths > 0 ? Math.round(monthData.reduce((a, m) => a + m.work_ratio, 0) / nMonths * 10) / 10 : 0;
      const workRatioScore = Math.min(100, avgWorkRatio + 20);
      scoreHours = hoursScore;
      scorePenalty = Math.min(100, 100 - Math.max(0, timelinessScore - 70));
      const total = Math.round((hoursScore * 0.5 + timelinessScore * 0.25 + workRatioScore * 0.15 + 100 * 0.1) * 10) / 10;

      let grade;
      if (total >= 95) grade = 'S';
      else if (total >= 88) grade = 'A';
      else if (total >= 75) grade = 'B';
      else if (total >= 60) grade = 'C';
      else grade = 'D';

      try {
        console.log(`  结算中: ${bu}/${year}/${user.user_id} ${user.user_name} (${nMonths}月有数据)`);
        await conn.execute(`
          INSERT INTO daily_report_annual_review (bu_no, yyyy, user_id, user_name, depart_id,
            score_hours, score_timeliness, score_workratio, score_penalty, okr_bonus, total_score, grade,
            avg_hours_achieve, annual_timeliness, months_submitted, months_locked, over_months,
            review_data, generated_by, generated_by_name, generated_time)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 12, 0, 0, ?, 'sys_gen', '系统一键结算', NOW())
        `, [bu, year, user.user_id, user.user_name, user.depart,
            Math.round(hoursScore * 100) / 100, Math.round(timelinessScore * 100) / 100, Math.round(workRatioScore * 100) / 100,
            Math.round(scorePenalty * 100) / 100, total, grade,
            avgAchieve, avgTimeliness,
            JSON.stringify({ months: monthData, okr_avg_progress: null })]);
      } catch (ie) {
        console.error(`  ⚠ INSERT 失败 ${bu}/${year}/${user.user_id}:`, ie.message);
        throw ie;
      }
    }
  }

  const [cnt] = await conn.execute("SELECT COUNT(*) AS n FROM daily_report_annual_review WHERE yyyy=?", [year]);
  const [grades] = await conn.execute("SELECT grade, COUNT(*) AS n FROM daily_report_annual_review WHERE yyyy=? GROUP BY grade ORDER BY grade", [year]);
  console.log(`  ✓ 写入 ${cnt[0].n} 条结算`);
  console.log(`    等第分布: ${grades.map(g => `${g.grade}=${g.n}`).join(', ')}`);
}

async function run() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 2023：已有的 daily_report，补 target + annual_review
    await step3_gen_target(conn, 2023);
    await step4_gen_annual_review(conn, 2023);

    // 2024：先补 forecast actual + daily_report，再 target + annual_review
    await step1_fill_forecast_actual(conn);
    await step2_gen_daily_report(conn, 2024, 20240101);
    await step3_gen_target(conn, 2024);
    await step4_gen_annual_review(conn, 2024);

    await conn.commit();
    console.log('\n✅ 全部完成！');

  } catch (err) {
    console.error('❌ 失败:', err.message);
    await conn.rollback();
    process.exit(1);
  } finally {
    conn.release();
    await pool.end();
  }
}

run();
