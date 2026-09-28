/**
 * 工作日报管理路由
 *   GET    /api/daily-report/meta               下拉资料(时间类别/部门/撰写人/客户/专案)
 *   GET    /api/daily-report                    日报列表(筛选+分页)
 *   GET    /api/daily-report/:id                日报主表+明细
 *   POST   /api/daily-report                    新增/覆盖(UPSERT, 同人同日唯一)
 *   DELETE /api/daily-report/:id                物理删除(主表+明细)
 *   POST   /api/daily-report/relink             更新连接资料(重算派生栏位)
 *   GET    /api/daily-report/analysis/*         时间分类/客户/平衡轮/未完成/延误明细/每月工时
 *
 * 权限：admin∈{管理員,管理员} 或 xuser_type∈{部門經理,高階主管,部门经理,高价主管} 为经理级，可查全部；
 *       一般员工仅能操作本人数据(服务端强制，忽略前端传入的 user_id)。
 * 测试环境(NODE_ENV=test)允许 x-test-user 头指定身份。
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, pagination, n } = require('../utils/response');

// 时间类别（生命平衡轮）固定 9 项，顺序即图表展示顺序
const WK_TYPES = ['日常工作', '职业发展', '财务状况', '健康', '娱乐休闲', '家庭', '朋友圈', '个人成长', '自我实现'];
// 生命平衡轮八大模块（生活类）
const LIFE_TYPES = WK_TYPES.slice(1);
// 经理级身份：生产库存繁体（部門主管/高階主管），兼容历史值与简体测试种子
const MANAGER_TYPES = ['部門主管', '高階主管', '部門經理', '部门主管', '部门经理', '高价主管'];
const ADMIN_MANAGER_VALUES = ['管理員', '管理员'];

const DAY_START_MIN = 8 * 60;   // 08:00
const DAY_END_MIN = 18 * 60;    // 18:00
const EDIT_WINDOW_DAYS = 7;

// ============ 工具函数 ============
function trimOrNull(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
}

function validHHmm(v) {
    return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

function hhmmToMin(v) {
    const [h, m] = v.split(':').map(Number);
    return h * 60 + m;
}

// 小时差，四舍五入 2 位小数
function diffHours(from, to) {
    return Math.round((hhmmToMin(to) - hhmmToMin(from)) / 60 * 100) / 100;
}

function validDateStr(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    return d <= new Date(y, m, 0).getDate(); // 本地日历校验，避免 UTC 偏移
}

function deriveYM(dateStr) {
    return { year: Number(dateStr.slice(0, 4)), ym: dateStr.slice(0, 7).replace('-', '/') };
}

// 0=同一天；>7 表示超出 7 天可编辑窗口
function daysFromToday(dateStr) {
    const target = new Date(dateStr + 'T00:00:00');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((target - today) / 86400000);
}

// 月份参数标准化：支持 2025/10、2025-10、202510、'10'(配 year)
function normalizeMonth(year, monthRaw) {
    let mm = null;
    if (monthRaw) {
        const s = String(monthRaw);
        const m = s.match(/^(?:\d{4}[-/]?)?(\d{1,2})$/);
        if (m) mm = String(Number(m[1])).padStart(2, '0');
    }
    if (!mm || Number(mm) < 1 || Number(mm) > 12) return null;
    return { mm, ym: `${year}/${mm}` };
}

// 解析当前登录身份（含经理级判定）
async function resolveActor(req) {
    let uid = req.user && req.user.user_id;
    if (!uid && process.env.NODE_ENV === 'test') {
        uid = req.headers['x-test-user'] || null;
    }
    if (!uid) return { error: 'NO_USER' };
    const [rows] = await pool.execute(
        `SELECT xuser_id, xuser_name, xuser_dept, xuser_type, admin, inuse_flag
           FROM cams_xuser WHERE xuser_id=? LIMIT 1`,
        [uid]
    );
    if (rows.length === 0) {
        // 测试环境允许不存在于 cams_xuser 的身份(预设为经理级，便于隔离测试)
        if (process.env.NODE_ENV === 'test') {
            return { user_id: uid, user_name: uid, xuser_dept: null, xuser_type: '部門主管', admin: '管理員', isManager: true };
        }
        return { error: 'NOT_FOUND' };
    }
    const u = rows[0];
    return {
        user_id: u.xuser_id,
        user_name: u.xuser_name || u.xuser_id,
        xuser_dept: u.xuser_dept || null,
        xuser_type: u.xuser_type || '一般員工',
        admin: u.admin || '普通者',
        isManager: ADMIN_MANAGER_VALUES.includes(u.admin) || MANAGER_TYPES.includes(u.xuser_type)
    };
}

// 范围解析：非经理一律强制本人；经理未指定撰写人时返回 null(全部人员)
function resolveTarget(actor, userParam) {
    if (actor.isManager) return userParam || null;
    return actor.user_id;
}

// ============ 下拉资料 ============
router.get('/meta', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);

        const [deptRows] = await pool.query(`
            SELECT DISTINCT dept FROM (
                SELECT xuser_dept AS dept FROM cams_xuser WHERE xuser_dept IS NOT NULL AND xuser_dept<>''
                UNION
                SELECT depart_id AS dept FROM daily_report WHERE depart_id IS NOT NULL AND depart_id<>''
            ) t ORDER BY dept
        `);
        const [writerRows] = await pool.query(`
            SELECT u.xuser_id AS user_id, u.xuser_name AS user_name, u.xuser_dept AS depart_id
              FROM cams_xuser u
             WHERE u.inuse_flag='USE'
            UNION
            SELECT r.user_id, r.user_name, r.depart_id
              FROM daily_report r
             WHERE NOT EXISTS (SELECT 1 FROM cams_xuser x WHERE x.xuser_id=r.user_id)
             ORDER BY user_id
        `);
        const [clientRows] = await pool.query(`
            SELECT DISTINCT client_id FROM daily_report_detail
             WHERE client_id IS NOT NULL AND client_id<>'' ORDER BY client_id
        `);
        const [itemsRows] = await pool.query(`
            SELECT DISTINCT items_id FROM daily_report_detail
             WHERE items_id IS NOT NULL AND items_id<>'' ORDER BY items_id
        `);

        ok(res, {
            wk_types: WK_TYPES,
            life_types: LIFE_TYPES,
            departments: deptRows.map(r => r.dept),
            writers: writerRows,
            clients: clientRows.map(r => r.client_id),
            items: itemsRows.map(r => r.items_id),
            me: { user_id: actor.user_id, user_name: actor.user_name, depart_id: actor.xuser_dept, isManager: actor.isManager }
        });
    } catch (err) { fail500(res, err); }
});

// ============ 日报列表 ============
router.get('/', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);

        const { page, pageSize, offset } = pagination(req);
        const bu = trimOrNull(req.query.bu_no) || 'HM';
        const where = ['r.bu_no=?'];
        const params = [bu];

        // 年度/月份筛选（月份依赖年度，拼成 YYYY_MM）
        let yearNum = null;
        if (trimOrNull(req.query.year)) {
            yearNum = Number(req.query.year);
            if (!Number.isInteger(yearNum)) return fail(res, '年度格式不正确', 400);
            where.push('r.YYYY=?'); params.push(yearNum);
        }
        if (trimOrNull(req.query.month)) {
            if (!yearNum) return fail(res, '依月份筛选时必须指定年度', 400);
            const mo = normalizeMonth(yearNum, req.query.month);
            if (!mo) return fail(res, '月份格式不正确', 400);
            where.push('r.YYYY_MM=?'); params.push(mo.ym);
        }
        if (trimOrNull(req.query.depart_id)) { where.push('r.depart_id=?'); params.push(trimOrNull(req.query.depart_id)); }
        const targetUser = resolveTarget(actor, trimOrNull(req.query.user_id));
        if (targetUser) { where.push('r.user_id=?'); params.push(targetUser); }
        if (trimOrNull(req.query.date_from)) { where.push('r.report_date>=?'); params.push(trimOrNull(req.query.date_from)); }
        if (trimOrNull(req.query.date_to)) { where.push('r.report_date<=?'); params.push(trimOrNull(req.query.date_to)); }
        if (trimOrNull(req.query.status1)) { where.push('r.status1=?'); params.push(trimOrNull(req.query.status1)); }

        const whereSql = where.join(' AND ');
        const [[{ total }]] = await pool.execute(
            `SELECT COUNT(*) AS total FROM daily_report r WHERE ${whereSql}`, params
        );

        const listParams = [...params, String(pageSize), String(offset)];
        const [rows] = await pool.execute(`
            SELECT r.id, r.bu_no, r.depart_id, r.user_id, r.user_name, r.report_date,
                   r.projects1, r.projects2, r.status1, r.YYYY, r.YYYY_MM, r.ruid,
                   r.create_time, r.update_time,
                   ROUND(COALESCE(d.total_hours,0),2) AS total_hours,
                   d.work_text
              FROM daily_report r
              LEFT JOIN (
                    SELECT ruid, SUM(use_time) AS total_hours,
                           GROUP_CONCAT(projects SEPARATOR '；') AS work_text
                      FROM daily_report_detail GROUP BY ruid
              ) d ON d.ruid = r.id
             WHERE ${whereSql}
             ORDER BY r.report_date DESC, r.id DESC
             LIMIT ? OFFSET ?
        `, listParams);

        ok(res, { list: rows, total: Number(total), page, pageSize });
    } catch (err) { fail500(res, err); }
});

// ============ 更新连接资料（重算派生栏位） ============
router.post('/relink', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);

        const b = req.body || {};
        const bu = trimOrNull(b.bu_no) || 'HM';
        const year = Number(b.year);
        const mo = normalizeMonth(year, b.month || b.YYYY_MM);
        if (!year || !mo) return fail(res, '年度/月份格式不正确', 400);

        const targetUser = resolveTarget(actor, trimOrNull(b.user_id));
        if (!targetUser) return fail(res, '请指定撰写人', 400);
        if (!actor.isManager && b.user_id && b.user_id !== actor.user_id) {
            return fail(res, '仅能更新本人的连接资料', 403);
        }

        // 依 report_date 锁定月份区间（不依赖可能已损坏的 YYYY_MM）
        const mmNum = Number(mo.mm);
        const dateFrom = `${year}-${mo.mm}-01`;
        const lastDay = new Date(year, mmNum, 0).getDate();
        const dateTo = `${year}-${mo.mm}-${String(lastDay).padStart(2, '0')}`;

        // 1) 明细派生栏位：YYYY / YYYY_MM / actual_date
        const [r1] = await pool.execute(`
            UPDATE daily_report_detail
               SET YYYY=?, YYYY_MM=?, actual_date=report_date
             WHERE bu_no=? AND user_id=? AND report_date BETWEEN ? AND ?
        `, [year, mo.ym, bu, targetUser, dateFrom, dateTo]);

        // 2) 主表派生栏位同步重算（列表/未完成/延误均以主表 YYYY_MM 过滤）
        const [r0] = await pool.execute(`
            UPDATE daily_report
               SET YYYY=?, YYYY_MM=?
             WHERE bu_no=? AND user_id=? AND report_date BETWEEN ? AND ?
        `, [year, mo.ym, bu, targetUser, dateFrom, dateTo]);

        // 3) ruid 关联：依 公司+人+日期 对齐主表
        const [r2] = await pool.execute(`
            UPDATE daily_report_detail d
              JOIN daily_report r
                ON r.bu_no=d.bu_no AND r.user_id=d.user_id AND r.report_date=d.report_date
               SET d.ruid=r.id
             WHERE d.bu_no=? AND d.user_id=? AND d.report_date BETWEEN ? AND ?
        `, [bu, targetUser, dateFrom, dateTo]);

        ok(res, { master_rows: r0.affectedRows, derived_rows: r1.affectedRows, relinked_rows: r2.affectedRows }, '连接资料已更新');
    } catch (err) { fail500(res, err); }
});

// ============ 单笔日报（主表+明细） ============
router.get('/:id', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        const id = Number(req.params.id);
        if (!id) return fail(res, 'id 不正确', 400);

        const [masters] = await pool.execute('SELECT * FROM daily_report WHERE id=? LIMIT 1', [id]);
        if (masters.length === 0) return fail(res, '日报不存在', 404);
        const master = masters[0];
        if (!actor.isManager && master.user_id !== actor.user_id) return fail(res, '权限不足', 403);

        const [details] = await pool.execute(
            'SELECT * FROM daily_report_detail WHERE ruid=? ORDER BY from_time, id', [id]
        );
        ok(res, { master, details });
    } catch (err) { fail500(res, err); }
});

// ============ 新增/覆盖日报（UPSERT 事务） ============
router.post('/', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);

        const b = req.body || {};
        const bu = trimOrNull(b.bu_no) || 'HM';
        const dateStr = trimOrNull(b.report_date);
        if (!dateStr || !validDateStr(dateStr)) return fail(res, '日报日期格式不正确(YYYY-MM-DD)', 400);

        const rawDetails = Array.isArray(b.details) ? b.details : [];
        if (rawDetails.length === 0) return fail(res, '至少填写一笔工作明细', 400);

        // 明细校验与规整
        const details = [];
        for (const row of rawDetails) {
            const projects = trimOrNull(row.projects);
            if (!projects) return fail(res, '每笔明细的主要工作项目不可为空', 400);
            const from = trimOrNull(row.from_time);
            const to = trimOrNull(row.to_time);
            if (!validHHmm(from) || !validHHmm(to)) return fail(res, '作业时间格式应为 HH:mm', 400);
            const fMin = hhmmToMin(from), tMin = hhmmToMin(to);
            if (fMin < DAY_START_MIN || tMin > DAY_END_MIN) return fail(res, '作业时间须在 08:00~18:00 之间', 400);
            if (tMin <= fMin) return fail(res, '结束时间必须晚于开始时间', 400);
            if ((tMin - fMin) < 30) return fail(res, '每一个工作时间不足半小时不允许单独记录', 400);
            const useTime = diffHours(from, to);
            const wk = WK_TYPES.includes(row.wk_type) ? row.wk_type : '日常工作';
            details.push({
                projects, from_time: from, to_time: to, use_time: useTime, wk_type: wk,
                client_id: trimOrNull(row.client_id), items_id: trimOrNull(row.items_id)
            });
        }

        const { year, ym } = deriveYM(dateStr);
        const withinWindow = Math.abs(daysFromToday(dateStr)) <= EDIT_WINDOW_DAYS;
        const reqP1 = trimOrNull(b.projects1);
        const reqP2 = trimOrNull(b.projects2);
        const status1 = b.status1 === 'NOUSE' ? 'NOUSE' : 'USE';
        // 超 7 天窗的新增强制 NULL；更新行在 SQL 中以 CASE 保留库内原值
        const p1 = withinWindow ? reqP1 : null;
        const p2 = withinWindow ? reqP2 : null;

        // 文案用：保存前是否已存在（非锁定，仅用于提示语，不参与正确性）
        const [pre] = await pool.execute(
            'SELECT id FROM daily_report WHERE bu_no=? AND user_id=? AND report_date=? LIMIT 1',
            [bu, actor.user_id, dateStr]
        );
        const existed = pre.length > 0;

        await conn.beginTransaction();

        // 原子 UPSERT，避免「先 SELECT 再 INSERT」并发下的竞态：
        //   唯一键冲突即转 UPDATE；超窗时 CASE 保留库内 projects1/2；
        //   LAST_INSERT_ID(id) 让 insertId 在更新场景也返回既有主键
        const withinFlag = withinWindow ? 1 : 0;
        const [ups] = await conn.execute(`
            INSERT INTO daily_report
                (bu_no, depart_id, user_id, user_name, report_date, projects1, projects2,
                 status1, YYYY, YYYY_MM, ruid)
            VALUES (?,?,?,?,?,?,?,?,?,?,NULL)
            ON DUPLICATE KEY UPDATE
                depart_id=VALUES(depart_id),
                user_name=VALUES(user_name),
                projects1=CASE WHEN ?=1 THEN VALUES(projects1) ELSE projects1 END,
                projects2=CASE WHEN ?=1 THEN VALUES(projects2) ELSE projects2 END,
                status1=VALUES(status1),
                YYYY=VALUES(YYYY),
                YYYY_MM=VALUES(YYYY_MM),
                id=LAST_INSERT_ID(id)
        `, [bu, n(actor.xuser_dept), actor.user_id, actor.user_name, dateStr,
            n(p1), n(p2), status1, year, ym, withinFlag, withinFlag]);
        const masterId = ups.insertId;
        await conn.execute('UPDATE daily_report SET ruid=? WHERE id=?', [masterId, masterId]);
        await conn.execute('DELETE FROM daily_report_detail WHERE ruid=?', [masterId]);

        // 批量写入明细（17 栏）
        const valuesSql = details.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
        const detailParams = [];
        const now = new Date();
        details.forEach(d => {
            detailParams.push(
                bu, n(actor.xuser_dept), actor.user_id, actor.user_name, dateStr,
                d.from_time, d.to_time, d.use_time, d.projects, d.wk_type,
                ym, now, year, masterId, dateStr, n(d.client_id), n(d.items_id)
            );
        });
        await conn.execute(`
            INSERT INTO daily_report_detail
                (bu_no, depart_id, user_id, user_name, report_date,
                 from_time, to_time, use_time, projects, wk_type,
                 YYYY_MM, complete_time, YYYY, ruid, actual_date, client_id, items_id)
            VALUES ${valuesSql}
        `, detailParams);

        await conn.commit();
        ok(res, { id: masterId, within_window: withinWindow }, existed ? '日报已覆盖更新' : '日报已新增');
    } catch (err) {
        try { await conn.rollback(); } catch (e) { /* 忽略回滚异常 */ }
        fail500(res, err);
    } finally {
        conn.release();
    }
});

// ============ 删除日报（物理删除主表+明细） ============
router.delete('/:id', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        const id = Number(req.params.id);
        if (!id) return fail(res, 'id 不正确', 400);

        const [masters] = await conn.execute('SELECT user_id FROM daily_report WHERE id=? LIMIT 1', [id]);
        if (masters.length === 0) return fail(res, '日报不存在', 404);
        if (!actor.isManager && masters[0].user_id !== actor.user_id) return fail(res, '权限不足，无法删除他人日报', 403);

        await conn.beginTransaction();
        await conn.execute('DELETE FROM daily_report_detail WHERE ruid=?', [id]);
        await conn.execute('DELETE FROM daily_report WHERE id=?', [id]);
        await conn.commit();
        ok(res, null, '日报已删除');
    } catch (err) {
        try { await conn.rollback(); } catch (e) { /* 忽略 */ }
        fail500(res, err);
    } finally {
        conn.release();
    }
});

// ============ 分析：时间分类 ============
router.get('/analysis/time-category', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        const q = req.query;
        const year = Number(q.year);
        const mo = normalizeMonth(year, q.month || q.YYYY_MM);
        if (!year || !mo) return fail(res, '年度/月份格式不正确', 400);

        const where = ['bu_no=?', 'YYYY_MM=?'];
        const params = [trimOrNull(q.bu_no) || 'HM', mo.ym];
        if (trimOrNull(q.depart_id)) { where.push('depart_id=?'); params.push(trimOrNull(q.depart_id)); }
        const target = resolveTarget(actor, trimOrNull(q.user_id));
        if (target) { where.push('user_id=?'); params.push(target); }

        const [rows] = await pool.execute(`
            SELECT wk_type, ROUND(SUM(use_time),2) AS hours
              FROM daily_report_detail
             WHERE ${where.join(' AND ')}
             GROUP BY wk_type
        `, params);
        const map = Object.fromEntries(rows.map(r => [r.wk_type, Number(r.hours)]));
        ok(res, WK_TYPES.map(k => ({ wk_type: k, hours: map[k] || 0 })));
    } catch (err) { fail500(res, err); }
});

// ============ 分析：客户类别 ============
router.get('/analysis/client', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        const q = req.query;
        const year = Number(q.year);
        const mo = normalizeMonth(year, q.month || q.YYYY_MM);
        if (!year || !mo) return fail(res, '年度/月份格式不正确', 400);

        const where = ['bu_no=?', 'YYYY_MM=?'];
        const params = [trimOrNull(q.bu_no) || 'HM', mo.ym];
        const target = resolveTarget(actor, trimOrNull(q.user_id));
        if (target) { where.push('user_id=?'); params.push(target); }

        const [rows] = await pool.execute(`
            SELECT client_id, ROUND(SUM(use_time),2) AS hours
              FROM daily_report_detail
             WHERE ${where.join(' AND ')}
             GROUP BY client_id
             ORDER BY hours DESC
        `, params);
        const list = rows.map(r => ({ client_id: r.client_id || '', hours: Number(r.hours) }));
        const total = Math.round(list.reduce((s, r) => s + r.hours, 0) * 100) / 100;
        ok(res, { list, total_hours: total });
    } catch (err) { fail500(res, err); }
});

// ============ 分析：生命平衡轮 ============
router.get('/analysis/balance-wheel', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        const q = req.query;
        const year = Number(q.year);
        const mo = normalizeMonth(year, q.month || q.YYYY_MM);
        if (!year || !mo) return fail(res, '年度/月份格式不正确', 400);

        const where = ['bu_no=?', 'YYYY_MM=?'];
        const params = [trimOrNull(q.bu_no) || 'HM', mo.ym];
        const target = resolveTarget(actor, trimOrNull(q.user_id));
        if (target) { where.push('user_id=?'); params.push(target); }

        const [rows] = await pool.execute(`
            SELECT wk_type, ROUND(SUM(use_time),2) AS hours
              FROM daily_report_detail
             WHERE ${where.join(' AND ')}
             GROUP BY wk_type
        `, params);
        const map = Object.fromEntries(rows.map(r => [r.wk_type, Number(r.hours)]));
        const wheel = LIFE_TYPES.map(k => ({ wk_type: k, hours: map[k] || 0 }));
        const workHours = map['日常工作'] || 0;
        const lifeHours = Math.round(wheel.reduce((s, r) => s + r.hours, 0) * 100) / 100;
        ok(res, { wheel, work_hours: workHours, life_hours: lifeHours,
                   total_hours: Math.round((workHours + lifeHours) * 100) / 100 });
    } catch (err) { fail500(res, err); }
});

// ============ 分析：工作未完成笔数（按人员） ============
router.get('/analysis/unfinished', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        const q = req.query;
        const year = Number(q.year);
        const mo = normalizeMonth(year, q.month || q.YYYY_MM);
        if (!year || !mo) return fail(res, '年度/月份格式不正确', 400);

        const where = ["bu_no=?", "YYYY_MM=?", "status1='USE'",
                       "(COALESCE(projects1,'')<>'' OR COALESCE(projects2,'')<>'')"];
        const params = [trimOrNull(q.bu_no) || 'HM', mo.ym];
        if (trimOrNull(q.depart_id)) { where.push('depart_id=?'); params.push(trimOrNull(q.depart_id)); }
        const target = resolveTarget(actor, trimOrNull(q.user_id));
        if (target) { where.push('user_id=?'); params.push(target); }

        const [rows] = await pool.execute(`
            SELECT user_id, MAX(user_name) AS user_name, MAX(depart_id) AS depart_id,
                   COUNT(*) AS unfinished_cnt
              FROM daily_report
             WHERE ${where.join(' AND ')}
             GROUP BY user_id
             ORDER BY unfinished_cnt DESC, user_id
        `, params);
        ok(res, rows.map(r => ({
            user_id: r.user_id, user_name: r.user_name, depart_id: r.depart_id,
            unfinished_cnt: Number(r.unfinished_cnt)
        })));
    } catch (err) { fail500(res, err); }
});

// ============ 分析：日常报告延误明细（分页） ============
router.get('/analysis/delays', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        const q = req.query;
        const { page, pageSize, offset } = pagination(req);
        const year = Number(q.year);
        const mo = normalizeMonth(year, q.month || q.YYYY_MM);
        if (!year || !mo) return fail(res, '年度/月份格式不正确', 400);

        const where = ["bu_no=?", "YYYY_MM=?",
                       "(COALESCE(projects1,'')<>'' OR COALESCE(projects2,'')<>'')"];
        const params = [trimOrNull(q.bu_no) || 'HM', mo.ym];
        if (trimOrNull(q.depart_id)) { where.push('depart_id=?'); params.push(trimOrNull(q.depart_id)); }
        const target = resolveTarget(actor, trimOrNull(q.user_id));
        if (target) { where.push('user_id=?'); params.push(target); }
        // 与未完成笔数口径保持一致：默认仅计 USE 日报；显式传 status1 时从其约定
        const statusFilter = trimOrNull(q.status1) || 'USE';
        where.push('status1=?'); params.push(statusFilter);

        const whereSql = where.join(' AND ');
        const [[{ total }]] = await pool.execute(
            `SELECT COUNT(*) AS total FROM daily_report WHERE ${whereSql}`, params
        );
        const [rows] = await pool.execute(`
            SELECT id, report_date, projects1, projects2, user_id, user_name, depart_id, YYYY_MM
              FROM daily_report
             WHERE ${whereSql}
             ORDER BY report_date DESC, id DESC
             LIMIT ? OFFSET ?
        `, [...params, String(pageSize), String(offset)]);

        ok(res, { list: rows, total: Number(total), page, pageSize });
    } catch (err) { fail500(res, err); }
});

// ============ 分析：每月工作小时（12 个月序列） ============
router.get('/analysis/monthly-hours', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        const q = req.query;
        const year = Number(q.year);
        if (!year) return fail(res, '年度格式不正确', 400);

        const where = ['bu_no=?', 'YYYY=?'];
        const params = [trimOrNull(q.bu_no) || 'HM', year];
        const target = resolveTarget(actor, trimOrNull(q.user_id));
        if (target) { where.push('user_id=?'); params.push(target); }
        // 「时间类别分析」勾选后依类别过滤
        if (q.timeByType === '1' || q.timeByType === 'true') {
            const wk = trimOrNull(q.wk_type);
            if (wk) { where.push('wk_type=?'); params.push(wk); }
        }

        const [rows] = await pool.execute(`
            SELECT YYYY_MM, ROUND(SUM(use_time),2) AS hours
              FROM daily_report_detail
             WHERE ${where.join(' AND ')}
             GROUP BY YYYY_MM
        `, params);
        const map = Object.fromEntries(rows.map(r => [r.YYYY_MM, Number(r.hours)]));
        const yy = String(year).slice(2);
        const list = Array.from({ length: 12 }, (_, i) => {
            const mm = String(i + 1).padStart(2, '0');
            return { label: `${yy}-${mm}`, YYYY_MM: `${year}/${mm}`, hours: map[`${year}/${mm}`] || 0 };
        });
        ok(res, list);
    } catch (err) { fail500(res, err); }
});

module.exports = router;
