/**
 * 日报 2005 年测试资料 + 目标设定生成脚本
 *   对象：U0001(黃惠君/人事部)、U0002(李靜怡/採購部)、U0003(王佩珊/採購部)
 *   范围：2005-01-01 ~ 2005-12-31，含每日主表+明细
 *   附加：daily_report_target 月度目标（每人每月 1 条）
 *   bu_no：统一 HM
 *
 * 执行：node database/seed_daily_report_2005.js
 * 幂等：先 DELETE 三人 2005 年资料再重灌
 */
const { pool } = require('../config/db');

const EMPLOYEES = [
    { user_id: 'U0001', user_name: '黃惠君', depart_id: '人事部', bu_no: 'HM',
      // 每人月度目标（2005 全年 12 个月）
      target_hours: 176, max_delays: 4, max_unresolved: 3, min_work_ratio: 75 },
    { user_id: 'U0002', user_name: '李靜怡', depart_id: '採購部', bu_no: 'HM',
      target_hours: 184, max_delays: 5, max_unresolved: 4, min_work_ratio: 70 },
    { user_id: 'U0003', user_name: '王佩珊', depart_id: '採購部', bu_no: 'HM',
      target_hours: 176, max_delays: 4, max_unresolved: 3, min_work_ratio: 72 }
];

const WK_TYPES = ['日常工作', '职业发展', '财务状况', '健康', '娱乐休闲', '家庭', '朋友圈', '个人成长', '自我实现'];
const LIFE_TYPES = WK_TYPES.slice(1);

const WORK_BY_DEPT = {
    '人事部': [
        '招募面談安排', '新進人員教育訓練', '薪資計算與核對', '績效面談',
        '員工關係處理', '考勤資料彙整', '勞健保申辦作業', '教育訓練規劃',
        '招募履歷篩選', '離職面談與交接', '人事資料維護', '薪酬調整評估'
    ],
    '採購部': [
        '供應商詢比價', '採購單開立', '物料驗收確認', '交期追蹤',
        '合約條款審核', '存貨盤點作業', '供應商評鑑', '採購系統資料維護',
        '緊急採購處理', '付款資料核對', '供應商異常處理', '採購報表彙編'
    ]
};
const LIFE_WORK = {
    '职业发展': ['線上課程進修', '專業證書準備', '產業趨勢研究'],
    '财务状况': ['個人理財規劃', '投資組合檢視', '記帳與支出分析'],
    '健康':     ['晨間慢跑', '健身房重訓', '瑜伽伸展'],
    '娱乐休闲': ['閱讀書籍', '音樂欣賞', '電影觀賞'],
    '家庭':     ['陪伴家人用餐', '家庭活動安排', '親子互動'],
    '朋友圈':   ['朋友聯繫', '社交聚餐', '群組訊息回覆'],
    '个人成长': ['日記撰寫', '每週目標反思', '心智圖筆記'],
    '自我实现': ['志工服務', '部落格經營', '創作練習']
};
const CLIENTS = ['台積電', '鴻海精密', '廣達電腦', '國泰金控', '中信金控', '聯發科', '台塑集團', '富邦金控'];
const ITEMS = ['ERP-2005', 'HR-2005', 'FIN-AUDIT', 'PUR-2005', 'BSC-2005', 'IT-2005', 'PROJ-001', 'PROJ-002'];
const DELAY_REASONS = ['等待主管審核中', '跨部門協調進度落後', '廠商回覆延遲', '系統異常暫停', '前置作業未完成', '資料待確認'];
const UNRESOLVED = ['待主管決策', '跨部門共識待建立', '法務意見待釐清', '預算待確認', '供應商尚未回覆', '後續規劃未定案'];

function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function randInt(rng, min, max) { return Math.floor(rng() * (max - min + 1)) + min; }
function fmtDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function isWeekend(d) { const w = d.getDay(); return w === 0 || w === 6; }
function fromMinutes(min) { return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }

async function run() {
    const year = 2005;
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);

    console.log(`🗓️  开始生成 ${year} 全年日报：${EMPLOYEES.map(e => e.user_id).join(',')}`);

    const masters = [], details = [];
    for (const emp of EMPLOYEES) {
        const workPool = WORK_BY_DEPT[emp.depart_id] || WORK_BY_DEPT['人事部'];
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = fmtDate(d);
            const seed = hashStr(`${emp.user_id}|${dateStr}|${year}`);
            const rng = makeRng(seed);
            const ymd = dateStr.slice(0, 7).replace('-', '/');
            const weekend = isWeekend(d);
            // 周末 15% 提交、工作日 92% 提交
            if (rng() > (weekend ? 0.15 : 0.92)) continue;

            const hasDelay = rng() < 0.22;
            const hasUnresolved = rng() < 0.18;
            const isNouse = rng() < 0.02;

            const master = {
                bu_no: emp.bu_no, depart_id: emp.depart_id,
                user_id: emp.user_id, user_name: emp.user_name,
                report_date: dateStr,
                projects1: hasDelay ? pick(rng, DELAY_REASONS) : null,
                projects2: hasUnresolved ? pick(rng, UNRESOLVED) : null,
                status1: isNouse ? 'NOUSE' : 'USE',
                YYYY: year, YYYY_MM: ymd, ruid: null
            };
            masters.push(master);

            const rowCount = weekend ? randInt(rng, 1, 2) : randInt(rng, 3, 5);
            let curMin = 8 * 60;
            for (let i = 0; i < rowCount; i++) {
                if (curMin >= 18 * 60) break;
                const durMin = randInt(rng, 1, 4) * 30;
                const toMin = Math.min(curMin + durMin, 18 * 60);
                if (toMin <= curMin) break;
                const isWork = rng() < (weekend ? 0.45 : 0.72);
                const wk_type = isWork ? '日常工作' : pick(rng, LIFE_TYPES);
                const projects = isWork ? pick(rng, workPool) : pick(rng, LIFE_WORK[wk_type]);
                details.push({
                    bu_no: emp.bu_no, depart_id: emp.depart_id,
                    user_id: emp.user_id, user_name: emp.user_name,
                    report_date: dateStr,
                    from_time: fromMinutes(curMin),
                    to_time: fromMinutes(toMin),
                    use_time: Math.round((toMin - curMin) / 60 * 100) / 100,
                    projects, wk_type, YYYY_MM: ymd,
                    complete_time: `${dateStr} ${fromMinutes(toMin)}:00`,
                    YYYY: year, ruid: null, actual_date: dateStr,
                    client_id: (weekend ? rng() < 0.1 : rng() < 0.5) ? pick(rng, CLIENTS) : null,
                    items_id: rng() < 0.35 ? pick(rng, ITEMS) : null
                });
                curMin = toMin;
            }
        }
    }

    console.log(`📥 预生成：主表 ${masters.length} 笔，明细 ${details.length} 笔`);

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // 清理
        for (const emp of EMPLOYEES) {
            await conn.execute('DELETE FROM daily_report_detail WHERE bu_no=? AND user_id=? AND YYYY=?', [emp.bu_no, emp.user_id, year]);
            await conn.execute('DELETE FROM daily_report WHERE bu_no=? AND user_id=? AND YYYY=?', [emp.bu_no, emp.user_id, year]);
            await conn.execute('DELETE FROM daily_report_target WHERE bu_no=? AND user_id=? AND YYYY_MM LIKE ?', [emp.bu_no, emp.user_id, `${year}/%`]);
        }

        // 主表批量 INSERT
        const mStmt = await conn.prepare(
            `INSERT INTO daily_report
                (bu_no, depart_id, user_id, user_name, report_date, projects1, projects2, status1, YYYY, YYYY_MM)
             VALUES (?,?,?,?,?,?,?,?,?,?)`
        );
        let insertedIds = [];
        for (const m of masters) {
            const [res] = await mStmt.execute([m.bu_no, m.depart_id, m.user_id, m.user_name,
                m.report_date, m.projects1, m.projects2, m.status1, m.YYYY, m.YYYY_MM]);
            insertedIds.push(res.insertId);
        }
        await mStmt.close();

        // 回填 ruid + 写明细
        const masterWithRuid = masters.map((m, i) => ({ ...m, id: insertedIds[i] }));
        const dStmt = await conn.prepare(
            `INSERT INTO daily_report_detail
                (bu_no, depart_id, user_id, user_name, report_date, from_time, to_time, use_time,
                 projects, wk_type, YYYY_MM, complete_time, YYYY, ruid, actual_date, client_id, items_id)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        );
        const masterMap = new Map(masterWithRuid.map(m => [`${m.user_id}|${m.report_date}`, m.id]));
        for (const d of details) {
            const ruid = masterMap.get(`${d.user_id}|${d.report_date}`);
            if (ruid == null) continue;
            await dStmt.execute([d.bu_no, d.depart_id, d.user_id, d.user_name, d.report_date,
                d.from_time, d.to_time, d.use_time, d.projects, d.wk_type, d.YYYY_MM,
                d.complete_time, d.YYYY, ruid, d.actual_date, d.client_id, d.items_id]);
        }
        await dStmt.close();

        // 生成 daily_report_target（2005 年 12 个月 × 3 人 = 36 条）
        const tStmt = await conn.prepare(
            `INSERT INTO daily_report_target
                (bu_no, user_id, YYYY_MM, target_hours, max_delays, max_unresolved, min_work_ratio, set_by, set_by_name, remark)
             VALUES (?,?,?,?,?,?,?,?,?,?)`
        );
        for (const emp of EMPLOYEES) {
            for (let mm = 1; mm <= 12; mm++) {
                const ym = `${year}/${String(mm).padStart(2, '0')}`;
                await tStmt.execute([
                    emp.bu_no, emp.user_id, ym,
                    emp.target_hours, emp.max_delays, emp.max_unresolved, emp.min_work_ratio,
                    'seed_script', '系統匯入', `${year}年度預設目標 - ${emp.depart_id}`
                ]);
            }
        }
        await tStmt.close();

        await conn.commit();
        console.log(`✅ ${year} 年資料寫入完成！`);
        console.log(`   主表 daily_report：${masters.length} 笔`);
        console.log(`   明细 daily_report_detail：${details.length} 笔`);
        console.log(`   目标 daily_report_target：${EMPLOYEES.length * 12} 笔（3 人 × 12 月）`);
    } catch (err) {
        await conn.rollback();
        console.error('❌ 写入失败，已回滚：', err.message);
        throw err;
    } finally {
        conn.release();
    }

    // 验证查询
    const [verify] = await pool.execute(`
        SELECT user_id, COUNT(*) AS days,
               ROUND(SUM(detail_cnt), 0) AS detail_total,
               ROUND(SUM(CASE WHEN wk_type='日常工作' THEN use_time ELSE 0 END), 1) AS work_hours,
               ROUND(SUM(use_time), 1) AS total_hours
          FROM daily_report d
          LEFT JOIN (SELECT ruid, COUNT(*) AS detail_cnt,
                           SUM(CASE WHEN wk_type='日常工作' THEN use_time ELSE 0 END) AS wk_work,
                           SUM(use_time) AS use_time,
                           wk_type
                      FROM daily_report_detail GROUP BY ruid, wk_type) dt ON dt.ruid = d.id
         WHERE d.bu_no='HM' AND d.YYYY=2005 AND d.user_id IN ('U0001','U0002','U0003')
           AND d.status1='USE'
         GROUP BY d.user_id
         ORDER BY d.user_id
    `);
    // 上面 GROUP BY 子查询写法不够准确，改用简化验证
    const [v2] = await pool.execute(`
        SELECT d.user_id, COUNT(DISTINCT d.report_date) AS days,
               ROUND(SUM(dt.use_time), 1) AS total_hours,
               ROUND(SUM(CASE WHEN dt.wk_type='日常工作' THEN dt.use_time ELSE 0 END), 1) AS work_hours
          FROM daily_report d
          LEFT JOIN daily_report_detail dt ON dt.ruid = d.id
         WHERE d.bu_no='HM' AND d.YYYY=2005 AND d.user_id IN ('U0001','U0002','U0003')
           AND d.status1='USE'
         GROUP BY d.user_id
         ORDER BY d.user_id
    `);
    console.log('\n📊 验证（USE 状态）：');
    for (const r of v2) {
        const workRatio = r.total_hours > 0 ? (r.work_hours / r.total_hours * 100).toFixed(1) : '0.0';
        console.log(`   ${r.user_id}: ${r.days} 天, 总工时 ${r.total_hours}h, 工作占比 ${workRatio}%`);
    }

    const [targetCnt] = await pool.execute(`
        SELECT user_id, COUNT(*) AS cnt FROM daily_report_target
         WHERE bu_no='HM' AND user_id IN ('U0001','U0002','U0003') GROUP BY user_id
    `);
    console.log(`\n🎯 目标设定：`);
    for (const r of targetCnt) console.log(`   ${r.user_id}: ${r.cnt} 个月`);
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
