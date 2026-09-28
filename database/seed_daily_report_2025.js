/**
 * 工作日报 2025 全年测试资料生成脚本
 *   对象：ermm_db.cams_xuser 中 3 名启用员工（U0001/U0002/U0006）
 *   范围：2025-01-01 ~ 2025-12-31 共 365 天，每人每天一笔主表 + 多笔明细
 *   表：daily_report（主表）、daily_report_detail（明细，ruid 关联主表 id）
 *
 * 设计原则：
 *   - 使用确定性种子（mulberry32），同参数重跑结果一致
 *   - 工作内容依部门（人事部/採購部/財務部）产生，含 9 大时间类别
 *   - 时间 08:00~18:00、30 分钟为最小单位，use_time 由 from/to 计算
 *   - YYYY / YYYY_MM / actual_date / ruid 完整关联
 *   - 部分日期有 projects1（延误）/ projects2（未解），少量 status1=NOUSE
 *
 * 执行：node database/seed_daily_report_2025.js
 * 幂等：先 DELETE 目标 3 人 2025 年资料再重灌（不影响其他年份/人员）
 */
const { pool } = require('../config/db');

// ============ 选定员工 ============
const EMPLOYEES = [
    { user_id: 'U0001', user_name: '黃惠君', depart_id: '人事部',   bu_no: 'HM' },
    { user_id: 'U0002', user_name: '李靜怡', depart_id: '採購部',   bu_no: 'SZ' },
    { user_id: 'U0006', user_name: '趙淑芬', depart_id: '財務部',   bu_no: 'HM' }
];

// ============ 时间类别 ============
const WK_TYPES = ['日常工作', '职业发展', '财务状况', '健康', '娱乐休闲', '家庭', '朋友圈', '个人成长', '自我实现'];
const LIFE_TYPES = WK_TYPES.slice(1);

// ============ 各部门工作内容池 ============
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
    ],
    '財務部': [
        '會計傳票製作', '帳務核對與調整', '財務報表編製', '預算編列',
        '應收帳款處理', '應付帳款處理', '稅務申報準備', '成本分析',
        '審計資料準備', '資金排程規劃', '費用核銷審核', '財務系統維護'
    ]
};

// ============ 生活类内容池 ============
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
const ITEMS = ['ERP-2025', 'HR-2025', 'FIN-AUDIT', 'PUR-2025', 'BSC-2025', 'IT-2025', 'PROJ-001', 'PROJ-002'];

const DELAY_REASONS = [
    '等待主管審核中', '跨部門協調進度落後', '廠商回覆延遲',
    '系統異常暫停', '前置作業未完成', '資料待確認'
];
const UNRESOLVED = [
    '待主管決策', '跨部門共識待建立', '法務意見待釐清',
    '預算待確認', '供應商尚未回覆', '後續規劃未定案'
];

// ============ 确定性随机数（mulberry32） ============
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

// ============ 日期工具 ============
function fmtDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isWeekend(d) { const w = d.getDay(); return w === 0 || w === 6; }

// ============ 时间工具 ============
function toMinutes(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function fromMinutes(min) { return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }

// ============ 主程序 ============
async function run() {
    const year = 2025;
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);

    console.log(`开始生成 ${year} 全年日报，员工 ${EMPLOYEES.map(e => e.user_id).join(',')}`);

    const masters = [];
    const details = [];

    for (const emp of EMPLOYEES) {
        const workPool = WORK_BY_DEPT[emp.depart_id] || WORK_BY_DEPT['人事部'];

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = fmtDate(d);
            const seed = hashStr(`${emp.user_id}|${dateStr}`);
            const rng = makeRng(seed);
            const ymd = dateStr.slice(0, 7).replace('-', '/');

            // 主表：延误/未解概率约 30%/25%，作废概率约 3%
            const hasDelay = rng() < 0.30;
            const hasUnresolved = rng() < 0.25;
            const isNouse = rng() < 0.03;
            const master = {
                bu_no: emp.bu_no,
                depart_id: emp.depart_id,
                user_id: emp.user_id,
                user_name: emp.user_name,
                report_date: dateStr,
                projects1: hasDelay ? pick(rng, DELAY_REASONS) : null,
                projects2: hasUnresolved ? pick(rng, UNRESOLVED) : null,
                status1: isNouse ? 'NOUSE' : 'USE',
                YYYY: year,
                YYYY_MM: ymd,
                ruid: null // 回填
            };
            masters.push(master);

            // 明细：工作日 4~6 笔，周末 1~3 笔
            const rowCount = isWeekend(d) ? randInt(rng, 1, 3) : randInt(rng, 4, 6);
            let curMin = 8 * 60; // 08:00
            for (let i = 0; i < rowCount; i++) {
                if (curMin >= 18 * 60) break;
                const durMin = (randInt(rng, 1, 4)) * 30; // 30/60/90/120 分钟
                const toMin = Math.min(curMin + durMin, 18 * 60);
                if (toMin <= curMin) break;

                // 70% 日常工作，其余随机生活类
                const isWork = rng() < 0.70;
                const wk_type = isWork ? '日常工作' : pick(rng, LIFE_TYPES);
                const projects = isWork ? pick(rng, workPool) : pick(rng, LIFE_WORK[wk_type]);

                // 客户/专案：60% 有客户，40% 有专案，周末较低
                const hasClient = isWeekend(d) ? rng() < 0.2 : rng() < 0.6;
                const hasItem = rng() < 0.4;

                details.push({
                    bu_no: emp.bu_no,
                    depart_id: emp.depart_id,
                    user_id: emp.user_id,
                    user_name: emp.user_name,
                    report_date: dateStr,
                    from_time: fromMinutes(curMin),
                    to_time: fromMinutes(toMin),
                    use_time: Math.round((toMin - curMin) / 60 * 100) / 100,
                    projects,
                    wk_type,
                    YYYY_MM: ymd,
                    complete_time: `${dateStr} ${fromMinutes(toMin)}:00`,
                    YYYY: year,
                    ruid: null, // 回填
                    actual_date: dateStr,
                    client_id: hasClient ? pick(rng, CLIENTS) : null,
                    items_id: hasItem ? pick(rng, ITEMS) : null
                });

                curMin = toMin;
            }
        }
    }

    console.log(`预生成：主表 ${masters.length} 笔，明细 ${details.length} 笔`);

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // 清理目标范围（幂等）
        for (const emp of EMPLOYEES) {
            await conn.execute(
                'DELETE FROM daily_report_detail WHERE bu_no=? AND user_id=? AND YYYY=?',
                [emp.bu_no, emp.user_id, year]
            );
            await conn.execute(
                'DELETE FROM daily_report WHERE bu_no=? AND user_id=? AND YYYY=?',
                [emp.bu_no, emp.user_id, year]
            );
        }

        // 批量插入主表（每批 200 笔）
        const BATCH = 200;
        for (let i = 0; i < masters.length; i += BATCH) {
            const batch = masters.slice(i, i + BATCH);
            const ph = batch.map(() => '(?,?,?,?,?,?,?,?,?,?,NULL)').join(',');
            const params = [];
            for (const m of batch) {
                params.push(m.bu_no, m.depart_id, m.user_id, m.user_name, m.report_date,
                    m.projects1, m.projects2, m.status1, m.YYYY, m.YYYY_MM);
            }
            await conn.execute(`
                INSERT INTO daily_report
                    (bu_no, depart_id, user_id, user_name, report_date, projects1, projects2, status1, YYYY, YYYY_MM, ruid)
                VALUES ${ph}
            `, params);
        }

        // 取回主表 id，建立 (bu_no,user_id,report_date) -> id 映射
        const [mRows] = await conn.execute(
            'SELECT id, bu_no, user_id, report_date FROM daily_report WHERE YYYY=?', [year]
        );
        const idMap = new Map();
        for (const r of mRows) {
            idMap.set(`${r.bu_no}|${r.user_id}|${r.report_date}`, r.id);
        }
        console.log(`已取得主表映射 ${idMap.size} 笔`);

        // 回填 master.ruid 与 detail.ruid
        for (const m of masters) {
            m.ruid = idMap.get(`${m.bu_no}|${m.user_id}|${m.report_date}`);
        }

        // 用临时表批量回填主表 ruid（= id）
        await conn.execute(`
            CREATE TEMPORARY TABLE tmp_dr_ruid (
                bu_no VARCHAR(10), user_id VARCHAR(50), report_date CHAR(10), new_ruid INT,
                PRIMARY KEY (bu_no, user_id, report_date)
            ) ENGINE=MEMORY
        `);
        const RB = 500;
        for (let i = 0; i < masters.length; i += RB) {
            const batch = masters.slice(i, i + RB);
            const ph = batch.map(() => '(?,?,?,?)').join(',');
            const params = [];
            for (const m of batch) params.push(m.bu_no, m.user_id, m.report_date, m.ruid);
            await conn.execute(
                `INSERT INTO tmp_dr_ruid (bu_no, user_id, report_date, new_ruid) VALUES ${ph}`,
                params
            );
        }
        const [ruidUpd] = await conn.execute(`
            UPDATE daily_report m
            JOIN tmp_dr_ruid t ON t.bu_no=m.bu_no AND t.user_id=m.user_id AND t.report_date=m.report_date
            SET m.ruid=t.new_ruid
            WHERE m.YYYY=?
        `, [year]);
        console.log(`主表 ruid 回填 ${ruidUpd.affectedRows} 笔`);
        await conn.execute('DROP TEMPORARY TABLE tmp_dr_ruid');

        // 回填 detail.ruid
        for (const d of details) {
            d.ruid = idMap.get(`${d.bu_no}|${d.user_id}|${d.report_date}`);
        }

        // 批量插入明细（每批 500 笔，17 栏）
        const DB = 500;
        let detInserted = 0;
        for (let i = 0; i < details.length; i += DB) {
            const batch = details.slice(i, i + DB);
            const ph = batch.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
            const params = [];
            for (const d of batch) {
                params.push(d.bu_no, d.depart_id, d.user_id, d.user_name, d.report_date,
                    d.from_time, d.to_time, d.use_time, d.projects, d.wk_type,
                    d.YYYY_MM, d.complete_time, d.YYYY, d.ruid, d.actual_date,
                    d.client_id, d.items_id);
            }
            await conn.execute(`
                INSERT INTO daily_report_detail
                    (bu_no, depart_id, user_id, user_name, report_date,
                     from_time, to_time, use_time, projects, wk_type,
                     YYYY_MM, complete_time, YYYY, ruid, actual_date, client_id, items_id)
                VALUES ${ph}
            `, params);
            detInserted += batch.length;
        }
        console.log(`已写入主表 ${masters.length} 笔、明细 ${detInserted} 笔`);

        // ============ 完整性校验 ============
        console.log('\n===== 完整性校验 =====');

        const checks = [];

        // 1. 主表笔数 = 3 * 365
        const [[{ c: masterCnt }]] = await conn.execute(
            `SELECT COUNT(*) c FROM daily_report WHERE YYYY=?`, [year]
        );
        checks.push(['主表笔数 = 1095', masterCnt === 1095, `实际 ${masterCnt}`]);

        // 2. 唯一键无重复
        const [[{ c: dupCnt }]] = await conn.execute(
            `SELECT COUNT(*) c FROM (
                SELECT bu_no, user_id, report_date, COUNT(*) n
                FROM daily_report WHERE YYYY=?
                GROUP BY bu_no, user_id, report_date HAVING n > 1
             ) t`, [year]
        );
        checks.push(['主表唯一键无重复', dupCnt === 0, `重复组 ${dupCnt}`]);

        // 3. 主表 ruid = id
        const [[{ c: ruidMismatch }]] = await conn.execute(
            `SELECT COUNT(*) c FROM daily_report WHERE YYYY=? AND (ruid IS NULL OR ruid<>id)`, [year]
        );
        checks.push(['主表 ruid = id', ruidMismatch === 0, `不符 ${ruidMismatch}`]);

        // 4. YYYY / YYYY_MM 与 report_date 一致
        const [[{ c: ymBad }]] = await conn.execute(
            `SELECT COUNT(*) c FROM daily_report WHERE YYYY=?
             AND (YYYY<>YEAR(report_date) OR YYYY_MM<>DATE_FORMAT(report_date,'%Y/%m'))`, [year]
        );
        checks.push(['主表 YYYY/YYYY_MM 与日期一致', ymBad === 0, `不符 ${ymBad}`]);

        // 5. 明细 ruid 全部指向有效主表（无孤儿）
        const [[{ c: orphan }]] = await conn.execute(
            `SELECT COUNT(*) c FROM daily_report_detail d
             LEFT JOIN daily_report m ON m.id=d.ruid
             WHERE d.YYYY=? AND m.id IS NULL`, [year]
        );
        checks.push(['明细无孤儿 ruid', orphan === 0, `孤儿 ${orphan}`]);

        // 6. 每个主表至少 1 笔明细
        const [[{ c: noDetail }]] = await conn.execute(
            `SELECT COUNT(*) c FROM (
                SELECT m.id FROM daily_report m
                LEFT JOIN daily_report_detail d ON d.ruid=m.id
                WHERE m.YYYY=? GROUP BY m.id HAVING COUNT(d.id)=0
             ) t`, [year]
        );
        checks.push(['每笔主表至少 1 笔明细', noDetail === 0, `缺明细 ${noDetail}`]);

        // 7. 明细 YYYY/YYYY_MM/actual_date 与主表一致
        const [[{ c: detYmBad }]] = await conn.execute(
            `SELECT COUNT(*) c FROM daily_report_detail d
             JOIN daily_report m ON m.id=d.ruid
             WHERE d.YYYY=? AND (d.YYYY<>m.YYYY OR d.YYYY_MM<>m.YYYY_MM OR d.actual_date<>m.report_date)`, [year]
        );
        checks.push(['明细派生栏位与主表一致', detYmBad === 0, `不符 ${detYmBad}`]);

        // 8. use_time = (to - from) 小时
        const [[{ c: timeBad }]] = await conn.execute(
            `SELECT COUNT(*) c FROM daily_report_detail
             WHERE YYYY=? AND use_time <> ROUND((TIME_TO_SEC(to_time)-TIME_TO_SEC(from_time))/3600, 2)`, [year]
        );
        checks.push(['use_time = (to-from) 小时', timeBad === 0, `不符 ${timeBad}`]);

        // 9. 时间范围 08:00~18:00 且 to > from
        const [[{ c: rangeBad }]] = await conn.execute(
            `SELECT COUNT(*) c FROM daily_report_detail
             WHERE YYYY=? AND (
                from_time < '08:00' OR to_time > '18:00' OR to_time <= from_time
             )`, [year]
        );
        checks.push(['时间在 08:00~18:00 且 to>from', rangeBad === 0, `不符 ${rangeBad}`]);

        // 10. 明细 bu_no/user_id/report_date 与主表一致
        const [[{ c: keyBad }]] = await conn.execute(
            `SELECT COUNT(*) c FROM daily_report_detail d
             JOIN daily_report m ON m.id=d.ruid
             WHERE d.YYYY=? AND (d.bu_no<>m.bu_no OR d.user_id<>m.user_id OR d.report_date<>m.report_date)`, [year]
        );
        checks.push(['明细 bu_no/user_id/report_date 与主表一致', keyBad === 0, `不符 ${keyBad}`]);

        // 11. wk_type 属于 9 类
        const [[{ c: wkBad }]] = await conn.execute(
            `SELECT COUNT(*) c FROM daily_report_detail
             WHERE YYYY=? AND wk_type NOT IN ('日常工作','职业发展','财务状况','健康','娱乐休闲','家庭','朋友圈','个人成长','自我实现')`, [year]
        );
        checks.push(['wk_type 均为 9 类之一', wkBad === 0, `不符 ${wkBad}`]);

        let allOk = true;
        for (const [name, ok, info] of checks) {
            console.log(`${ok ? '✅' : '❌'} ${name}：${info}`);
            if (!ok) allOk = false;
        }

        // 统计摘要
        const [[{ c: useCnt }]] = await conn.execute(
            `SELECT COUNT(*) c FROM daily_report WHERE YYYY=? AND status1='USE'`, [year]
        );
        const [[{ c: nouseCnt }]] = await conn.execute(
            `SELECT COUNT(*) c FROM daily_report WHERE YYYY=? AND status1='NOUSE'`, [year]
        );
        const [[{ c: delayCnt }]] = await conn.execute(
            `SELECT COUNT(*) c FROM daily_report WHERE YYYY=? AND projects1 IS NOT NULL`, [year]
        );
        const [[{ c: unresCnt }]] = await conn.execute(
            `SELECT COUNT(*) c FROM daily_report WHERE YYYY=? AND projects2 IS NOT NULL`, [year]
        );
        console.log(`\n统计：USE ${useCnt} / NOUSE ${nouseCnt} / 有延误 ${delayCnt} / 有未解 ${unresCnt}`);

        // 每人每月笔数
        const [monthly] = await conn.execute(
            `SELECT user_id, YYYY_MM, COUNT(*) n FROM daily_report WHERE YYYY=? GROUP BY user_id, YYYY_MM ORDER BY user_id, YYYY_MM`, [year]
        );
        console.log('\n每人每月笔数（应为每月天数）：');
        for (const r of monthly) console.log(`  ${r.user_id} ${r.YYYY_MM}: ${r.n}`);

        if (allOk) {
            await conn.commit();
            console.log('\n✅ 全部校验通过，事务已提交');
        } else {
            await conn.rollback();
            console.log('\n❌ 校验失败，事务已回滚');
            process.exitCode = 1;
        }
    } catch (e) {
        try { await conn.rollback(); } catch (_) { }
        console.error('❌ 执行失败：', e.message);
        process.exitCode = 1;
    } finally {
        conn.release();
        await pool.end();
    }
}

run();
