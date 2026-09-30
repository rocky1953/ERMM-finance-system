/**
 * 工作日报管理 API 整合测试 — routes/dailyReport.js
 *
 * 覆盖：
 *  - 建表幂等（beforeAll 执行建表 DDL）
 *  - GET /meta、GET / 列表筛选/分页
 *  - 一般员工/经理 数据权限隔离（x-test-user 头）
 *  - POST UPSERT 覆盖、派生字段、7 天窗规则、非法输入 400
 *  - DELETE 物理级联与 403
 *  - 六个分析接口数值正确性
 *  - POST /relink 重算
 *
 * 测试资料：bu_no='TEST'，固定分析数据放 2099/01、2099/02；
 *          7 天窗相关用例使用相对今天的动态日期。测试后自清，不关闭全局 pool。
 */
const { request, app, pool } = require('./setup');

const BU = 'TEST';
const MGR = 'TEST_DR_MGR';
const EMP = 'TEST_DR_EMP';
const DEPT = '测试部';

function fmtDate(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function ensureTables() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS daily_report (
            id INT AUTO_INCREMENT PRIMARY KEY,
            bu_no VARCHAR(10) NOT NULL,
            depart_id VARCHAR(100) DEFAULT NULL,
            user_id VARCHAR(50) NOT NULL,
            user_name VARCHAR(100) DEFAULT '',
            report_date CHAR(10) NOT NULL,
            projects1 VARCHAR(500) DEFAULT NULL,
            projects2 VARCHAR(500) DEFAULT NULL,
            status1 CHAR(10) NOT NULL DEFAULT 'USE',
            YYYY INT DEFAULT NULL,
            YYYY_MM CHAR(7) DEFAULT NULL,
            ruid INT DEFAULT NULL,
            create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_bu_user_date (bu_no, user_id, report_date),
            INDEX idx_user_ym (user_id, YYYY_MM), INDEX idx_bu_ym (bu_no, YYYY_MM), INDEX idx_ruid (ruid)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS daily_report_detail (
            id INT AUTO_INCREMENT PRIMARY KEY,
            bu_no VARCHAR(10) NOT NULL,
            depart_id VARCHAR(100) DEFAULT NULL,
            user_id VARCHAR(50) NOT NULL,
            user_name VARCHAR(100) DEFAULT '',
            report_date CHAR(10) NOT NULL,
            from_time CHAR(5) DEFAULT NULL,
            to_time CHAR(5) DEFAULT NULL,
            use_time DECIMAL(10,2) DEFAULT 0.00,
            projects VARCHAR(500) DEFAULT NULL,
            wk_type VARCHAR(20) DEFAULT NULL,
            YYYY_MM CHAR(7) DEFAULT NULL,
            complete_time DATETIME DEFAULT NULL,
            create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            YYYY INT DEFAULT NULL,
            ruid INT DEFAULT NULL,
            actual_date CHAR(10) DEFAULT NULL,
            client_id VARCHAR(50) DEFAULT NULL,
            items_id VARCHAR(50) DEFAULT NULL,
            INDEX idx_ruid (ruid), INDEX idx_user_ym (user_id, YYYY_MM), INDEX idx_bu_ym (bu_no, YYYY_MM)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}

async function seedReport(o) {
    const ym = o.date.slice(0, 7).replace('-', '/');
    const y = Number(o.date.slice(0, 4));
    const [r] = await pool.execute(`
        INSERT INTO daily_report
            (bu_no, depart_id, user_id, user_name, report_date, projects1, projects2, status1, YYYY, YYYY_MM)
        VALUES (?,?,?,?,?,?,?,?,?,?)
    `, [o.bu, o.dept, o.uid, o.uname, o.date, o.p1 || null, o.p2 || null, o.status || 'USE', y, ym]);
    const id = r.insertId;
    await pool.execute('UPDATE daily_report SET ruid=? WHERE id=?', [id, id]);
    for (const d of o.details || []) {
        await pool.execute(`
            INSERT INTO daily_report_detail
                (bu_no, depart_id, user_id, user_name, report_date,
                 from_time, to_time, use_time, projects, wk_type,
                 YYYY_MM, complete_time, YYYY, ruid, actual_date, client_id, items_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),?,?,?,?,?)
        `, [o.bu, o.dept, o.uid, o.uname, o.date,
            d.from, d.to, d.hours, d.projects, d.wk, ym, y, id, o.date, d.client || null, d.items || null]);
    }
    return id;
}

beforeAll(async () => {
    await ensureTables();
    await pool.execute('DELETE FROM daily_report_detail WHERE bu_no=?', [BU]);
    await pool.execute('DELETE FROM daily_report WHERE bu_no=?', [BU]);
    await pool.execute('DELETE FROM cams_xuser WHERE xuser_id IN (?,?)', [MGR, EMP]);

    await pool.execute(`
        INSERT INTO cams_xuser
            (xuser_id, xuser_password, xuser_name, xuser_dept, client_id, inuse_flag, admin, email, tel_no, xuser_type)
        VALUES (?,?,?,?,?,?,?,?,?,?)
    `, [MGR, 'x', '王经理', DEPT, null, 'USE', '管理员', null, null, '部门经理']);
    await pool.execute(`
        INSERT INTO cams_xuser
            (xuser_id, xuser_password, xuser_name, xuser_dept, client_id, inuse_flag, admin, email, tel_no, xuser_type)
        VALUES (?,?,?,?,?,?,?,?,?,?)
    `, [EMP, 'x', '李员工', DEPT, null, 'USE', '普通者', null, null, '一般员工']);

    // 固定分析数据 2099/01
    await seedReport({
        bu: BU, dept: DEPT, uid: EMP, uname: '李员工', date: '2099-01-05', p1: '延误一',
        details: [
            { from: '08:00', to: '10:00', hours: 2, projects: '日常事务', wk: '日常工作', client: '客户A' },
            { from: '10:00', to: '11:00', hours: 1, projects: '运动', wk: '健康', client: '' },
            { from: '11:00', to: '11:30', hours: 0.5, projects: '阅读', wk: '自我实现', client: '客户B' }
        ]
    });
    await seedReport({
        bu: BU, dept: DEPT, uid: EMP, uname: '李员工', date: '2099-01-06', p2: '未解二', details: []
    });
    // 2099/02 一笔（每月工时序列）
    await seedReport({
        bu: BU, dept: DEPT, uid: EMP, uname: '李员工', date: '2099-02-10',
        details: [{ from: '08:00', to: '11:00', hours: 3, projects: '二月工作', wk: '日常工作', client: '客户A' }]
    });
    // 经理 2099/01 一笔含延误
    await seedReport({
        bu: BU, dept: DEPT, uid: MGR, uname: '王经理', date: '2099-01-07', p1: '主管延误',
        details: [{ from: '08:00', to: '11:00', hours: 3, projects: '管理事务', wk: '日常工作', client: '客户A' }]
    });
});

afterAll(async () => {
    await pool.execute('DELETE FROM daily_report_detail WHERE bu_no=?', [BU]);
    await pool.execute('DELETE FROM daily_report WHERE bu_no=?', [BU]);
    await pool.execute('DELETE FROM cams_xuser WHERE xuser_id IN (?,?)', [MGR, EMP]);
    // 不关闭全局连接池（避免影响其他测试套件）
});

// supertest 的 .set() 须在 .get/.post 之后链用
const as = (uid) => ({
    get: (url) => request(app).get(url).set('x-test-user', uid),
    post: (url) => request(app).post(url).set('x-test-user', uid),
    delete: (url) => request(app).delete(url).set('x-test-user', uid)
});
const today = fmtDate(0);
const oldDate = fmtDate(-10);
const curYM = today.slice(0, 7).replace('-', '/');

// ============ meta ============
describe('GET /api/daily-report/meta', () => {
    test('回传 9 个时间类别/部门/撰写人', async () => {
        const res = await as(EMP).get('/api/daily-report/meta');
        expect(res.status).toBe(200);
        expect(res.body.data.wk_types).toHaveLength(9);
        expect(res.body.data.wk_types).toContain('自我实现');
        expect(res.body.data.departments).toContain(DEPT);
        expect(res.body.data.writers.some(w => w.user_id === EMP)).toBe(true);
        expect(res.body.data.me.user_id).toBe(EMP);
        expect(res.body.data.me.isManager).toBe(false);
    });
});

// ============ 保存/UPSERT/7 天规则 ============
describe('POST /api/daily-report', () => {
    let todayId;

    test('新增当日日报：派生 use_time/YYYY_MM/ruid/actual_date', async () => {
        const res = await as(EMP).post('/api/daily-report').send({
            bu_no: BU, report_date: today, projects1: '今日延误', projects2: '今日未解',
            details: [
                { from_time: '08:00', to_time: '09:30', projects: '工作a', wk_type: '日常工作' },
                { from_time: '09:30', to_time: '10:00', projects: '工作b', wk_type: '自我实现', client_id: '客户C', items_id: 'P1' }
            ]
        });
        expect(res.status).toBe(200);
        expect(res.body.data.within_window).toBe(true);
        todayId = res.body.data.id;

        const got = await as(EMP).get(`/api/daily-report/${todayId}`);
        expect(got.status).toBe(200);
        const m = got.body.data.master;
        expect(m.projects1).toBe('今日延误');
        expect(m.ruid).toBe(todayId);
        expect(String(m.YYYY)).toBe(today.slice(0, 4));
        expect(m.YYYY_MM).toBe(curYM);
        const ds = got.body.data.details;
        expect(ds).toHaveLength(2);
        expect(Number(ds[0].use_time)).toBe(1.5);
        expect(Number(ds[1].use_time)).toBe(0.5);
        expect(ds[1].ruid).toBe(todayId);
        expect(ds[1].actual_date).toBe(today);
        expect(ds[1].client_id).toBe('客户C');
        expect(ds[1].items_id).toBe('P1');
    });

    test('同日重复提交为覆盖：主表仍 1 行、明细整体替换', async () => {
        const res = await as(EMP).post('/api/daily-report').send({
            bu_no: BU, report_date: today,
            details: [{ from_time: '08:00', to_time: '08:30', projects: '替换后', wk_type: '健康' }]
        });
        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe(todayId);

        const [[{ cnt }]] = await pool.execute(
            'SELECT COUNT(*) AS cnt FROM daily_report WHERE bu_no=? AND user_id=? AND report_date=?',
            [BU, EMP, today]
        );
        expect(Number(cnt)).toBe(1);
        const got = await as(EMP).get(`/api/daily-report/${todayId}`);
        expect(got.body.data.details).toHaveLength(1);
        expect(got.body.data.details[0].projects).toBe('替换后');
        expect(got.body.data.details[0].wk_type).toBe('健康');
    });

    test('超过 7 天的新建：projects1/projects2 强制为 NULL', async () => {
        const res = await as(EMP).post('/api/daily-report').send({
            bu_no: BU, report_date: oldDate, projects1: '不应存入', projects2: '不应存入',
            details: [{ from_time: '08:00', to_time: '09:00', projects: '历史工作', wk_type: '日常工作' }]
        });
        expect(res.status).toBe(200);
        expect(res.body.data.within_window).toBe(false);
        const got = await as(EMP).get(`/api/daily-report/${res.body.data.id}`);
        expect(got.body.data.master.projects1).toBeNull();
        expect(got.body.data.master.projects2).toBeNull();
    });

    test('超过 7 天的更新：保留库内原值不被覆盖', async () => {
        // 先在窗口内造一份带内容的日报
        const d = fmtDate(-3);
        const create = await as(EMP).post('/api/daily-report').send({
            bu_no: BU, report_date: d, projects1: '窗口内延误', projects2: '窗口内未解',
            details: [{ from_time: '08:00', to_time: '09:00', projects: 'w', wk_type: '日常工作' }]
        });
        expect(create.status).toBe(200);
        // 移除上一用例在 oldDate 造的日报，再把本份日期直接改到 10 天前模拟「历史日报被再次提交」
        const [oldRows] = await pool.execute(
            'SELECT id FROM daily_report WHERE bu_no=? AND user_id=? AND report_date=?', [BU, EMP, oldDate]
        );
        for (const r of oldRows) {
            const del = await as(EMP).delete(`/api/daily-report/${r.id}`);
            expect(del.status).toBe(200);
        }
        await pool.execute('UPDATE daily_report SET report_date=? WHERE id=?', [oldDate, create.body.data.id]);
        await pool.execute('UPDATE daily_report_detail SET report_date=?, actual_date=? WHERE ruid=?',
            [oldDate, oldDate, create.body.data.id]);

        // 再次提交（传新内容，应被忽略而保留原值）
        const upd = await as(EMP).post('/api/daily-report').send({
            bu_no: BU, report_date: oldDate, projects1: '篡改尝试', projects2: '篡改尝试2',
            details: [{ from_time: '09:00', to_time: '10:00', projects: 'w2', wk_type: '日常工作' }]
        });
        expect(upd.status).toBe(200);
        expect(upd.body.data.id).toBe(create.body.data.id);
        const got = await as(EMP).get(`/api/daily-report/${create.body.data.id}`);
        expect(got.body.data.master.projects1).toBe('窗口内延误');
        expect(got.body.data.master.projects2).toBe('窗口内未解');
    });

    test.each([
        ['结束早于开始', { from_time: '09:00', to_time: '08:00', projects: 'x' }],
        ['早于 08:00', { from_time: '07:00', to_time: '08:30', projects: 'x' }],
        ['晚于 23:30', { from_time: '23:00', to_time: '23:45', projects: 'x' }],
        ['工作项目为空', { from_time: '08:00', to_time: '08:30', projects: '  ' }]
    ])('非法明细 → 400（%s）', async (_name, detail) => {
        const res = await as(EMP).post('/api/daily-report').send({
            bu_no: BU, report_date: fmtDate(-9), details: [detail]
        });
        expect(res.status).toBe(400);
    });

    test('空明细/错误日期 → 400', async () => {
        const r1 = await as(EMP).post('/api/daily-report').send({ bu_no: BU, report_date: today, details: [] });
        expect(r1.status).toBe(400);
        const r2 = await as(EMP).post('/api/daily-report').send({
            bu_no: BU, report_date: '2025-13-40',
            details: [{ from_time: '08:00', to_time: '09:00', projects: 'x' }]
        });
        expect(r2.status).toBe(400);
    });

    test('并发双击同日保存：原子 UPSERT 仅产生一笔主表', async () => {
        const d = fmtDate(1); // 明天，在 7 天窗内
        const payload = {
            bu_no: BU, report_date: d, projects1: '并发延误', projects2: '',
            details: [{ from_time: '08:00', to_time: '08:30', projects: '并发工作', wk_type: '日常工作' }]
        };
        const [a, b] = await Promise.all([
            as(EMP).post('/api/daily-report').send(payload),
            as(EMP).post('/api/daily-report').send(payload)
        ]);
        expect(a.status).toBe(200);
        expect(b.status).toBe(200);
        expect(a.body.data.id).toBe(b.body.data.id);
        const [rows] = await pool.execute(
            'SELECT COUNT(*) c FROM daily_report WHERE bu_no=? AND user_id=? AND report_date=?',
            [BU, EMP, d]
        );
        expect(Number(rows[0].c)).toBe(1);
        const [dets] = await pool.execute(
            'SELECT COUNT(*) c FROM daily_report_detail WHERE bu_no=? AND user_id=? AND report_date=?',
            [BU, EMP, d]
        );
        expect(Number(dets[0].c)).toBe(1);
    });
});

// ============ 列表筛选/分页/权限 ============
describe('GET /api/daily-report 列表与权限', () => {
    test('员工只能看到本人数据（忽略传入他人 user_id）', async () => {
        const res = await as(EMP).get(`/api/daily-report?bu_no=${BU}&user_id=${MGR}`);
        expect(res.status).toBe(200);
        expect(res.body.data.list.length).toBeGreaterThan(0);
        expect(res.body.data.list.every(r => r.user_id === EMP)).toBe(true);
    });

    test('经理可查全部并按部门/人员/年份筛选', async () => {
        const all = await as(MGR).get(`/api/daily-report?bu_no=${BU}`);
        expect(all.body.data.list.some(r => r.user_id === MGR)).toBe(true);
        expect(all.body.data.list.some(r => r.user_id === EMP)).toBe(true);

        const emp2099 = await as(MGR).get(`/api/daily-report?bu_no=${BU}&year=2099&user_id=${EMP}`);
        expect(emp2099.status).toBe(200);
        expect(emp2099.body.data.list.every(r => r.user_id === EMP && Number(r.YYYY) === 2099)).toBe(true);
        expect(emp2099.body.data.total).toBeGreaterThanOrEqual(3);

        const dept = await as(MGR).get(`/api/daily-report?bu_no=${BU}&depart_id=${encodeURIComponent(DEPT)}`);
        expect(dept.body.data.list.every(r => r.depart_id === DEPT)).toBe(true);
    });

    test('日期区间/状态筛选生效，时数为明细合计', async () => {
        const range = await as(MGR).get(`/api/daily-report?bu_no=${BU}&date_from=2099-01-01&date_to=2099-01-31`);
        expect(range.body.data.list.every(r => r.report_date >= '2099-01-01' && r.report_date <= '2099-01-31')).toBe(true);

        const rowEmp = range.body.data.list.find(r => r.report_date === '2099-01-05' && r.user_id === EMP);
        expect(rowEmp).toBeTruthy();
        expect(Number(rowEmp.total_hours)).toBe(3.5);
        expect(rowEmp.work_text).toContain('日常事务');
        expect(rowEmp.projects1).toBe('延误一');

        const useOnly = await as(MGR).get(`/api/daily-report?bu_no=${BU}&status1=USE`);
        expect(useOnly.body.data.list.every(r => r.status1 === 'USE')).toBe(true);
    });

    test('分页参数正确', async () => {
        const res = await as(MGR).get(`/api/daily-report?bu_no=${BU}&page=1&pageSize=2`);
        expect(res.body.data.list).toHaveLength(2);
        expect(res.body.data.page).toBe(1);
        expect(res.body.data.pageSize).toBe(2);
        expect(res.body.data.total).toBeGreaterThanOrEqual(5);
    });

    test('月份筛选按主表 YYYY_MM 生效；缺年度/非法年月 → 400', async () => {
        const m1 = await as(MGR).get(`/api/daily-report?bu_no=${BU}&year=2099&month=01&user_id=${EMP}`);
        expect(m1.status).toBe(200);
        expect(m1.body.data.total).toBe(2);
        expect(m1.body.data.list.every(r => r.YYYY_MM === '2099/01')).toBe(true);

        const m2 = await as(MGR).get(`/api/daily-report?bu_no=${BU}&year=2099&month=2&user_id=${EMP}`);
        expect(m2.body.data.total).toBe(1);
        expect(m2.body.data.list[0].YYYY_MM).toBe('2099/02');

        const badYear = await as(MGR).get(`/api/daily-report?bu_no=${BU}&year=abc`);
        expect(badYear.status).toBe(400);
        const noYear = await as(MGR).get(`/api/daily-report?bu_no=${BU}&month=01`);
        expect(noYear.status).toBe(400);
        const badMonth = await as(MGR).get(`/api/daily-report?bu_no=${BU}&year=2099&month=13`);
        expect(badMonth.status).toBe(400);
    });
});

// ============ 越权 403 / 删除级联 ============
describe('权限与删除', () => {
    test('员工读取/删除经理日报 → 403', async () => {
        const [mgrRows] = await pool.execute(
            'SELECT id FROM daily_report WHERE bu_no=? AND user_id=? LIMIT 1', [BU, MGR]
        );
        const mgrId = mgrRows[0].id;
        const g = await as(EMP).get(`/api/daily-report/${mgrId}`);
        expect(g.status).toBe(403);
        const d = await as(EMP).delete(`/api/daily-report/${mgrId}`);
        expect(d.status).toBe(403);
    });

    test('经理可删除任意日报；删除后主从皆无', async () => {
        // 删除员工在 oldDate(10 天前) 的历史日报，不影响 2099 分析数据
        const [rows] = await pool.execute(
            'SELECT id FROM daily_report WHERE bu_no=? AND user_id=? AND report_date=? LIMIT 1',
            [BU, EMP, oldDate]
        );
        const id = rows[0].id;
        const del = await as(MGR).delete(`/api/daily-report/${id}`);
        expect(del.status).toBe(200);
        const [[m]] = await pool.execute('SELECT COUNT(*) c FROM daily_report WHERE id=?', [id]);
        const [[d]] = await pool.execute('SELECT COUNT(*) c FROM daily_report_detail WHERE ruid=?', [id]);
        expect(Number(m.c)).toBe(0);
        expect(Number(d.c)).toBe(0);
    });
});

// ============ 分析接口 ============
describe('分析接口', () => {
    test('时间分类：员工强制本人；经理可带部门汇总', async () => {
        const emp = await as(EMP).get(`/api/daily-report/analysis/time-category?bu_no=${BU}&year=2099&month=1&user_id=${MGR}`);
        expect(emp.status).toBe(200);
        expect(emp.body.data).toHaveLength(9);
        const map = Object.fromEntries(emp.body.data.map(r => [r.wk_type, Number(r.hours)]));
        expect(map['日常工作']).toBe(2);   // 员工本人 2h（经理 3h 被忽略）
        expect(map['健康']).toBe(1);
        expect(map['自我实现']).toBe(0.5);

        const mgr = await as(MGR).get(`/api/daily-report/analysis/time-category?bu_no=${BU}&year=2099&month=01&depart_id=${encodeURIComponent(DEPT)}`);
        const m2 = Object.fromEntries(mgr.body.data.map(r => [r.wk_type, Number(r.hours)]));
        expect(m2['日常工作']).toBe(5);   // 员工 2 + 经理 3
    });

    test('客户类别：分组占比与总小时', async () => {
        const res = await as(EMP).get(`/api/daily-report/analysis/client?bu_no=${BU}&year=2099&month=1`);
        expect(res.status).toBe(200);
        const m = Object.fromEntries(res.body.data.list.map(r => [r.client_id, Number(r.hours)]));
        expect(m['客户A']).toBe(2);
        expect(m['客户B']).toBe(0.5);
        expect(m['']).toBe(1);
        expect(res.body.data.total_hours).toBe(3.5);
    });

    test('生命平衡轮：工作/生活小时', async () => {
        const res = await as(EMP).get(`/api/daily-report/analysis/balance-wheel?bu_no=${BU}&year=2099&month=1`);
        expect(res.status).toBe(200);
        expect(res.body.data.wheel).toHaveLength(8);
        expect(res.body.data.work_hours).toBe(2);
        expect(res.body.data.life_hours).toBe(1.5);
    });

    test('未完成笔数：仅计 projects1/2 非空日报', async () => {
        const res = await as(MGR).get(`/api/daily-report/analysis/unfinished?bu_no=${BU}&year=2099&month=1&depart_id=${encodeURIComponent(DEPT)}`);
        expect(res.status).toBe(200);
        const emp = res.body.data.find(r => r.user_id === EMP);
        const mgr = res.body.data.find(r => r.user_id === MGR);
        expect(emp.unfinished_cnt).toBe(2);
        expect(mgr.unfinished_cnt).toBe(1);
    });

    test('延误明细分页；NOUSE 口径默认与未完成笔数一致', async () => {
        const p1 = await as(MGR).get(`/api/daily-report/analysis/delays?bu_no=${BU}&year=2099&month=1&user_id=${EMP}&page=1&pageSize=1`);
        expect(p1.status).toBe(200);
        expect(p1.body.data.list).toHaveLength(1);
        expect(p1.body.data.total).toBe(2);
        const p2 = await as(MGR).get(`/api/daily-report/analysis/delays?bu_no=${BU}&year=2099&month=1&user_id=${EMP}&page=2&pageSize=1`);
        expect(p2.body.data.list).toHaveLength(1);
        expect(p2.body.data.list[0].user_id).toBe(EMP);

        // 其中一笔作废后：默认（USE）与显式 NOUSE 各 1 笔，测完恢复
        await pool.execute(
            "UPDATE daily_report SET status1='NOUSE' WHERE bu_no=? AND user_id=? AND report_date='2099-01-06'",
            [BU, EMP]
        );
        try {
            const useOnly = await as(MGR).get(`/api/daily-report/analysis/delays?bu_no=${BU}&year=2099&month=1&user_id=${EMP}`);
            expect(useOnly.body.data.total).toBe(1);
            expect(useOnly.body.data.list[0].projects1).toBe('延误一');
            const noOnly = await as(MGR).get(`/api/daily-report/analysis/delays?bu_no=${BU}&year=2099&month=1&user_id=${EMP}&status1=NOUSE`);
            expect(noOnly.body.data.total).toBe(1);
            expect(noOnly.body.data.list[0].projects2).toBe('未解二');
        } finally {
            await pool.execute(
                "UPDATE daily_report SET status1='USE' WHERE bu_no=? AND user_id=? AND report_date='2099-01-06'",
                [BU, EMP]
            );
        }
    });

    test('每月工作小时：12 个月序列，可按类别过滤', async () => {
        const res = await as(EMP).get(`/api/daily-report/analysis/monthly-hours?bu_no=${BU}&year=2099`);
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(12);
        expect(res.body.data[0].label).toBe('99-01');
        expect(Number(res.body.data[0].hours)).toBe(3.5);
        expect(Number(res.body.data[1].hours)).toBe(3);

        const byType = await as(EMP).get(`/api/daily-report/analysis/monthly-hours?bu_no=${BU}&year=2099&timeByType=1&wk_type=${encodeURIComponent('日常工作')}`);
        expect(Number(byType.body.data[0].hours)).toBe(2);
        expect(Number(byType.body.data[1].hours)).toBe(3);
    });
});

// ============ 更新连接资料 ============
describe('POST /api/daily-report/relink', () => {
    test('重算损坏的 YYYY_MM/ruid（含主表派生栏位）', async () => {
        await pool.execute(
            "UPDATE daily_report_detail SET YYYY_MM='2098/12', ruid=NULL WHERE bu_no=? AND user_id=? AND report_date='2099-01-05'",
            [BU, EMP]
        );
        await pool.execute(
            "UPDATE daily_report SET YYYY=NULL, YYYY_MM='2098/12' WHERE bu_no=? AND user_id=? AND report_date='2099-01-05'",
            [BU, EMP]
        );
        const res = await as(EMP).post('/api/daily-report/relink').send({ bu_no: BU, year: 2099, month: 1, user_id: EMP });
        expect(res.status).toBe(200);
        expect(res.body.data.master_rows).toBeGreaterThanOrEqual(1);
        expect(res.body.data.derived_rows).toBeGreaterThanOrEqual(3);
        expect(res.body.data.relinked_rows).toBeGreaterThanOrEqual(3);

        const [rows] = await pool.execute(
            "SELECT YYYY_MM, ruid, actual_date FROM daily_report_detail WHERE bu_no=? AND user_id=? AND report_date='2099-01-05'",
            [BU, EMP]
        );
        const [masters] = await pool.execute(
            'SELECT id FROM daily_report WHERE bu_no=? AND user_id=? AND report_date=?',
            [BU, EMP, '2099-01-05']
        );
        expect(rows).toHaveLength(3);
        expect(rows.every(r => r.YYYY_MM === '2099/01' && r.actual_date === '2099-01-05')).toBe(true);
        expect(rows.every(r => r.ruid === masters[0].id)).toBe(true);

        // 主表 YYYY/YYYY_MM 必须同步修复，否则列表/未完成/延误按月过滤会丢资料
        const [[masterRow]] = await pool.execute(
            'SELECT YYYY, YYYY_MM FROM daily_report WHERE id=?', [masters[0].id]
        );
        expect(Number(masterRow.YYYY)).toBe(2099);
        expect(masterRow.YYYY_MM).toBe('2099/01');
    });

    test('员工不可更新他人资料 → 403', async () => {
        const res = await as(EMP).post('/api/daily-report/relink').send({ bu_no: BU, year: 2099, month: 1, user_id: MGR });
        expect(res.status).toBe(403);
    });
});
