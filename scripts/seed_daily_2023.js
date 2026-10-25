/**
 * 修复 daily_report + detail 关联
 * 策略：先 INSERT 日报（让自增 id 生成），再用该 id 写 detail.ruid
 */
const { pool } = require('../config/db');

let seed = 20230101;
function rnd() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
function rint(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
const pad2 = n => String(n).padStart(2, '0');

const DEPTS = ['采购部', '财务部', '人事部', '营业部', '研发部', '生产部'];
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

const WK_TYPES = ['日常工作', '会议沟通', '客户拜访', '学习训练', '行政事务'];
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

async function run() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ===== 0. 清理旧 2023 =====
    const [d_del] = await conn.execute("DELETE FROM daily_report_detail WHERE report_date LIKE '2023%'");
    const [r_del] = await conn.execute("DELETE FROM daily_report WHERE report_date LIKE '2023%'");
    console.log(`✓ 清理旧日报 ${r_del.affectedRows} 行, 明细 ${d_del.affectedRows} 行`);

    let ridCount = 0;
    let didCount = 0;

    for (const [bu, users] of Object.entries(BU_USERS)) {
      for (const user of users) {
        for (let m = 1; m <= 12; m++) {
          const ym = `2023-${pad2(m)}`;
          const days = workdaysOfMonth(2023, m);

          for (const dd of days) {
            const report_date = `2023-${pad2(m)}-${dd}`;
            if (rnd() < 0.18) continue;

            // 日报主表（让自增 id 生成）
            const projects1 = pick(DELAY_REASONS);
            const projects2 = pick(UNRESOLVED);
            const [ins] = await conn.execute(`
              INSERT INTO daily_report (bu_no, depart_id, user_id, user_name, report_date, projects1, projects2, status1, YYYY, YYYY_MM)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'USE', 2023, ?)
            `, [bu, user.depart, user.user_id, user.user_name, report_date, projects1, projects2, ym]);
            const reportId = ins.insertId;  // ← 自增 id
            ridCount++;

            // 明细：用 reportId 写入 ruid
            const detailCount = rint(3, 5);
            const totalHours = 8 + rnd() * 1.5;
            let fromH = 9;
            const usedProjs = new Set();

            for (let i = 0; i < detailCount; i++) {
              const frac = 1 / detailCount;
              const hours = i === detailCount - 1
                ? Math.round((totalHours - (detailCount - 1) * totalHours * frac) * 100) / 100
                : Math.round(totalHours * frac * 100) / 100;

              const from = fmtTime(fromH);
              const toH = Math.min(fromH + Math.ceil(hours), 18);
              const to = fmtTime(toH);

              const wkType = rnd() < 0.6 ? '日常工作' : pick(WK_TYPES.filter(w => w !== '日常工作'));
              let proj;
              do { proj = pick(PROJECTS_COMMON); } while (usedProjs.has(proj) && usedProjs.size < PROJECTS_COMMON.length);
              usedProjs.add(proj);

              await conn.execute(`
                INSERT INTO daily_report_detail (
                  bu_no, depart_id, user_id, user_name, report_date,
                  from_time, to_time, use_time, projects, wk_type,
                  YYYY_MM, YYYY, ruid, create_time, update_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2023, ?, NOW(), NOW())
              `, [bu, user.depart, user.user_id, user.user_name, report_date,
                  from, to, hours, proj, wkType, ym, reportId]);
              didCount++;

              fromH = toH;
              if (fromH >= 18) break;
            }
          }

          if (m === 1 || m === 6 || m === 12) {
            console.log(`  ${bu} ${user.user_name} ${ym}: ${days.length}工作日`);
          }
        }
      }
    }

    await conn.commit();
    console.log(`\n✓ 写入完成：日报 ${ridCount} 行, 明细 ${didCount} 行`);

    // 验证
    const [sum] = await conn.execute(`
      SELECT d.bu_no, COUNT(DISTINCT d.report_date) AS days, COUNT(DISTINCT d.user_id) AS u, SUM(dt.use_time) AS total_h
        FROM daily_report d LEFT JOIN daily_report_detail dt ON dt.ruid = d.id
        WHERE d.YYYY_MM = '2023-06' AND d.status1='USE'
        GROUP BY d.bu_no`);
    console.log('\n  2023-06 月度汇总验证:');
    sum.forEach(r => console.log(`    ${r.bu_no}: ${r.days}天, ${r.u}人, ${Math.round(Number(r.total_h)||0)}h`));

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
