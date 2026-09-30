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
const { sendMgmtReport, getRecipients } = require('../utils/mailer');

// 时间类别（生命平衡轮）固定 9 项，顺序即图表展示顺序
const WK_TYPES = ['日常工作', '职业发展', '财务状况', '健康', '娱乐休闲', '家庭', '朋友圈', '个人成长', '自我实现'];
// 生命平衡轮八大模块（生活类）
const LIFE_TYPES = WK_TYPES.slice(1);
// 经理级身份：兼容繁简体（部門主管/部门主管、高階主管/高阶主管、部門經理/部门经理）及历史错别字
const MANAGER_TYPES = ['部門主管', '高階主管', '部門經理', '部门主管', '部门经理', '高阶主管', '高价主管'];
const ADMIN_MANAGER_VALUES = ['管理員', '管理员'];
// 经理身份归一化：先做简→繁关键映射，再判断，避免 DB 中简繁体混杂导致漏判
function isManagerRole(admin, xuserType) {
    const norm = (s) => String(s || '')
        .replace(/部门/g, '部門').replace(/经理/g, '經理').replace(/高阶/g, '高階')
        .replace(/管理员/g, '管理員').replace(/高价/g, '高階');
    return ADMIN_MANAGER_VALUES.includes(norm(admin)) || MANAGER_TYPES.includes(norm(xuserType));
}
// 高階权限：仅 管理员(管理員) 或 高階主管 —— 解锁等制衡性操作仅限此身份
function isSeniorRole(admin, xuserType) {
    const na = String(admin || '').replace(/管理员/g, '管理員');
    const nt = String(xuserType || '').replace(/高阶/g, '高階');
    return na === '管理員' || nt === '高階主管';
}

// 审计动作常量
const AUDIT = { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE', LOCK: 'LOCK', UNLOCK: 'UNLOCK' };

// 取客户端真实 IP（Nginx 反代场景优先 X-Forwarded-For 首段）
function clientIp(req) {
    const xff = req.headers && req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim().slice(0, 63);
    return (req.ip || (req.socket && req.socket.remoteAddress) || '').slice(0, 63);
}

// 查询某员工某月是否处于 LOCKED 状态（executor 可为 pool 或事务连接）
async function findActiveLock(executor, bu, userId, ym) {
    const [rows] = await executor.execute(
        `SELECT * FROM daily_report_lock
          WHERE bu_no=? AND user_id=? AND YYYY_MM=? AND lock_status='LOCKED' LIMIT 1`,
        [bu, userId, ym]
    );
    return rows.length > 0 ? rows[0] : null;
}

// 写入审计日志（须在业务事务内调用，随事务一起提交/回滚）
async function writeAudit(conn, o) {
    await conn.execute(`
        INSERT INTO daily_report_audit_log
            (bu_no, ruid, report_date, target_user_id, target_user_name, YYYY_MM,
             action, operator_id, operator_name, operator_ip, old_data, new_data, remark)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
        o.bu_no, o.ruid == null ? null : o.ruid, o.report_date || null,
        o.target_user_id, o.target_user_name || '', o.ym || null,
        o.action, o.operator_id, o.operator_name || '', o.operator_ip || '',
        o.old_data ? JSON.stringify(o.old_data) : null,
        o.new_data ? JSON.stringify(o.new_data) : null,
        o.remark || null
    ]);
}

const DAY_START_MIN = 8 * 60;   // 08:00
const DAY_END_MIN = 23 * 60 + 30; // 23:30
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
            return { user_id: uid, user_name: uid, xuser_dept: null, xuser_type: '部門主管', admin: '管理員', isManager: true, isSenior: true };
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
        isManager: isManagerRole(u.admin, u.xuser_type),
        isSenior: isSeniorRole(u.admin, u.xuser_type)
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
            me: { user_id: actor.user_id, user_name: actor.user_name, depart_id: actor.xuser_dept, isManager: actor.isManager, isSenior: actor.isSenior }
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
            SELECT r.id, r.bu_no, r.depart_id, r.user_id,
                   COALESCE(u.xuser_name, r.user_name) AS user_name,
                   r.report_date,
                   r.projects1, r.projects2, r.status1, r.YYYY, r.YYYY_MM, r.ruid,
                   r.create_time, r.update_time,
                   ROUND(COALESCE(d.total_hours,0),2) AS total_hours,
                   d.work_text,
                   CASE WHEN lk.id IS NULL THEN 0 ELSE 1 END AS locked,
                   lk.locked_by_name, lk.locked_time
              FROM daily_report r
              LEFT JOIN cams_xuser u ON u.xuser_id = r.user_id
              LEFT JOIN daily_report_lock lk
                ON lk.bu_no=r.bu_no AND lk.user_id=r.user_id AND lk.YYYY_MM=r.YYYY_MM AND lk.lock_status='LOCKED'
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

// ============ 签核锁定：宽松解析 YYYY/MM、YYYY-MM ============
function parseYM(s) {
    const m = /^(\d{4})[-/](\d{1,2})$/.exec(String(s || '').trim());
    if (!m) return null;
    const mm = String(Number(m[2])).padStart(2, '0');
    if (Number(mm) < 1 || Number(mm) > 12) return null;
    return { year: Number(m[1]), mm, ym: `${m[1]}/${mm}` };
}

// ============ 签核锁定（经理：单人 user_id 或整批 batch=当月有日报者） ============
router.post('/lock', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        if (!actor.isManager) return fail(res, '仅部門主管/高階主管可执行签核锁定', 403);

        const b = req.body || {};
        const bu = trimOrNull(b.bu_no) || 'HM';
        const mo = parseYM(b.YYYY_MM || b.month);
        if (!mo) return fail(res, '月份格式不正确(YYYY/MM)', 400);
        const wantUser = trimOrNull(b.user_id);
        const wantUsers = Array.isArray(b.user_ids)
            ? [...new Set(b.user_ids.map(trimOrNull).filter(Boolean))] : [];
        const isBatch = !wantUser && wantUsers.length === 0 && !!b.batch;
        if (!wantUser && wantUsers.length === 0 && !isBatch) return fail(res, '请指定撰写人或使用整批锁定', 400);

        // 锁定对象：单人 / 指定多人 或 当月有日报(USE)的全部撰写人
        let targets = [];
        const wantList = wantUser ? [wantUser] : wantUsers;
        if (wantList.length > 0) {
            for (const uid of wantList) {
                const [urows] = await pool.execute(
                    'SELECT xuser_name FROM cams_xuser WHERE xuser_id=? LIMIT 1', [uid]);
                targets.push({ user_id: uid, user_name: urows[0] ? urows[0].xuser_name : uid });
            }
        } else {
            const [rrows] = await pool.execute(
                `SELECT DISTINCT user_id FROM daily_report
                  WHERE bu_no=? AND YYYY_MM=? AND status1='USE' ORDER BY user_id`,
                [bu, mo.ym]);
            for (const r of rrows) {
                const [urows] = await pool.execute(
                    'SELECT xuser_name FROM cams_xuser WHERE xuser_id=? LIMIT 1', [r.user_id]);
                targets.push({ user_id: r.user_id, user_name: urows[0] ? urows[0].xuser_name : r.user_id });
            }
        }
        if (targets.length === 0) return fail(res, '该月份尚无任何日报可锁定', 400);

        await conn.beginTransaction();
        let locked = 0, skipped = 0;
        const lockedTargets = [];
        for (const t of targets) {
            const exist = await findActiveLock(conn, bu, t.user_id, mo.ym);
            if (exist) { skipped++; continue; }
            await conn.execute(`
                INSERT INTO daily_report_lock
                    (bu_no, user_id, YYYY_MM, lock_status, locked_by, locked_by_name, locked_time)
                VALUES (?,?,?,'LOCKED',?,?,NOW())
                ON DUPLICATE KEY UPDATE
                    lock_status='LOCKED', locked_by=VALUES(locked_by),
                    locked_by_name=VALUES(locked_by_name), locked_time=NOW(),
                    unlocked_by=NULL, unlocked_by_name=NULL, unlocked_time=NULL, unlock_reason=NULL
            `, [bu, t.user_id, mo.ym, actor.user_id, actor.user_name]);
            await writeAudit(conn, {
                bu_no: bu, target_user_id: t.user_id, target_user_name: t.user_name, ym: mo.ym,
                action: AUDIT.LOCK, operator_id: actor.user_id, operator_name: actor.user_name,
                operator_ip: clientIp(req),
                new_data: { bu_no: bu, user_id: t.user_id, YYYY_MM: mo.ym, lock_status: 'LOCKED' }
            });
            locked++;
            lockedTargets.push(t);
        }
        await conn.commit();
        ok(res, { locked, skipped, targets: lockedTargets },
            `已锁定 ${locked} 人${skipped ? `，跳过(已锁定) ${skipped} 人` : ''}`);
    } catch (err) {
        try { await conn.rollback(); } catch (e) { /* 忽略 */ }
        fail500(res, err);
    } finally {
        conn.release();
    }
});

// ============ 解锁（仅高階主管/管理员，必须填原因） ============
router.post('/unlock', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        if (!actor.isSenior) return fail(res, '解锁权限仅限高階主管/管理员', 403);

        const b = req.body || {};
        const bu = trimOrNull(b.bu_no) || 'HM';
        const mo = parseYM(b.YYYY_MM || b.month);
        if (!mo) return fail(res, '月份格式不正确(YYYY/MM)', 400);
        const wantUser = trimOrNull(b.user_id);
        const reason = trimOrNull(b.reason);
        if (!wantUser) return fail(res, '请指定要解锁的撰写人', 400);
        if (!reason) return fail(res, '请填写解锁原因（将永久留痕）', 400);

        await conn.beginTransaction();
        const [cur] = await conn.execute(
            `SELECT * FROM daily_report_lock
              WHERE bu_no=? AND user_id=? AND YYYY_MM=? FOR UPDATE`,
            [bu, wantUser, mo.ym]);
        if (cur.length === 0 || cur[0].lock_status !== 'LOCKED') {
            await conn.rollback();
            return fail(res, '该员工当月未处于锁定状态', 400);
        }
        const lockRow = cur[0];
        const [urows] = await pool.execute(
            'SELECT xuser_name FROM cams_xuser WHERE xuser_id=? LIMIT 1', [wantUser]);
        const targetName = urows[0] ? urows[0].xuser_name : wantUser;

        await conn.execute(`
            UPDATE daily_report_lock
               SET lock_status='UNLOCKED', unlocked_by=?, unlocked_by_name=?,
                   unlocked_time=NOW(), unlock_reason=?
             WHERE id=?
        `, [actor.user_id, actor.user_name, reason.slice(0, 500), lockRow.id]);
        await writeAudit(conn, {
            bu_no: bu, target_user_id: wantUser, target_user_name: targetName, ym: mo.ym,
            action: AUDIT.UNLOCK, operator_id: actor.user_id, operator_name: actor.user_name,
            operator_ip: clientIp(req),
            old_data: lockRow, remark: reason.slice(0, 500),
            new_data: { bu_no: bu, user_id: wantUser, YYYY_MM: mo.ym, lock_status: 'UNLOCKED' }
        });
        await conn.commit();
        ok(res, { user_id: wantUser, YYYY_MM: mo.ym }, `已解锁 ${targetName} ${mo.ym} 的日报`);
    } catch (err) {
        try { await conn.rollback(); } catch (e) { /* 忽略 */ }
        fail500(res, err);
    } finally {
        conn.release();
    }
});

// ============ 锁定状态查询（签核面板数据源） ============
router.get('/locks', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        const q = req.query;
        const bu = trimOrNull(q.bu_no) || 'HM';
        const mo = parseYM(q.YYYY_MM || q.month);
        if (!mo) return fail(res, '月份格式不正确(YYYY/MM)', 400);

        // 员工仅能查本人；经理可查全部
        const onlySelf = actor.isManager ? trimOrNull(q.user_id) : actor.user_id;

        const params = [bu, mo.ym, bu, mo.ym, bu, mo.ym, bu, mo.ym, bu, mo.ym];
        let selfWhere = '';
        if (onlySelf) { selfWhere = 'WHERE base.user_id=?'; params.push(onlySelf); }

        const [rows] = await pool.execute(`
            SELECT base.user_id,
                   COALESCE(u.xuser_name, rn.user_name) AS user_name,
                   COALESCE(u.xuser_dept, rn.depart_id) AS depart_id,
                   COUNT(DISTINCT r.id) AS report_cnt,
                   ROUND(COALESCE(SUM(d.use_time),0),2) AS hours,
                   COUNT(DISTINCT CASE WHEN r.projects1 IS NOT NULL AND r.projects1<>'' THEN r.id END) AS delays,
                   COUNT(DISTINCT CASE WHEN r.projects2 IS NOT NULL AND r.projects2<>'' THEN r.id END) AS unresolved,
                   l.lock_status, l.locked_by, l.locked_by_name, l.locked_time,
                   l.unlocked_by, l.unlocked_by_name, l.unlocked_time, l.unlock_reason
              FROM (
                    SELECT DISTINCT user_id FROM daily_report
                     WHERE bu_no=? AND YYYY_MM=? AND status1='USE'
                    UNION
                    SELECT user_id FROM daily_report_lock WHERE bu_no=? AND YYYY_MM=?
              ) base
              LEFT JOIN cams_xuser u ON u.xuser_id = base.user_id
              LEFT JOIN daily_report r
                ON r.bu_no=? AND r.YYYY_MM=? AND r.user_id=base.user_id AND r.status1='USE'
              LEFT JOIN daily_report_detail d ON d.ruid = r.id
              LEFT JOIN daily_report_lock l
                ON l.bu_no=? AND l.YYYY_MM=? AND l.user_id=base.user_id
              LEFT JOIN (
                    SELECT user_id, MAX(user_name) AS user_name, MAX(depart_id) AS depart_id
                      FROM daily_report WHERE bu_no=? AND YYYY_MM=? GROUP BY user_id
              ) rn ON rn.user_id = base.user_id
              ${selfWhere}
             GROUP BY base.user_id, u.xuser_name, rn.user_name, u.xuser_dept, rn.depart_id,
                      l.lock_status, l.locked_by, l.locked_by_name, l.locked_time,
                      l.unlocked_by, l.unlocked_by_name, l.unlocked_time, l.unlock_reason
             ORDER BY l.lock_status IS NULL, base.user_id
        `, params);
        ok(res, rows.map(r => ({
            ...r,
            report_cnt: Number(r.report_cnt), hours: Number(r.hours),
            delays: Number(r.delays), unresolved: Number(r.unresolved),
            locked: r.lock_status === 'LOCKED'
        })));
    } catch (err) { fail500(res, err); }
});

// ============ 审计日志查询（高管全部/部门主管本部门/员工仅本人） ============
router.get('/audit-logs', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        const q = req.query;
        const bu = trimOrNull(q.bu_no) || 'HM';
        const where = ['a.bu_no=?'];
        const params = [bu];

        if (trimOrNull(q.YYYY_MM || q.month)) {
            const mo = parseYM(q.YYYY_MM || q.month);
            if (!mo) return fail(res, '月份格式不正确(YYYY/MM)', 400);
            where.push('a.YYYY_MM=?'); params.push(mo.ym);
        }
        if (trimOrNull(q.action)) { where.push('a.action=?'); params.push(trimOrNull(q.action)); }

        if (!actor.isManager) {
            // 一般员工仅能查自己被操作的记录
            where.push('a.target_user_id=?'); params.push(actor.user_id);
        } else if (!actor.isSenior && actor.xuser_dept) {
            // 部门主管限本部门（按归属人当前部门）
            where.push('tu.xuser_dept=?'); params.push(actor.xuser_dept);
        }
        if (actor.isManager && trimOrNull(q.user_id)) {
            where.push('a.target_user_id=?'); params.push(trimOrNull(q.user_id));
        }

        const page = Math.max(1, Number(q.page) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 20));
        const offset = (page - 1) * pageSize;
        const whereSql = where.join(' AND ');

        const [[{ total }]] = await pool.execute(
            `SELECT COUNT(*) AS total FROM daily_report_audit_log a
             LEFT JOIN cams_xuser tu ON tu.xuser_id=a.target_user_id
             WHERE ${whereSql}`, params);
        const [rows] = await pool.execute(`
            SELECT a.id, a.ruid, a.report_date, a.target_user_id, a.target_user_name,
                   a.YYYY_MM, a.action, a.operator_id, a.operator_name, a.operator_ip,
                   a.old_data, a.new_data, a.remark, a.created_time
              FROM daily_report_audit_log a
              LEFT JOIN cams_xuser tu ON tu.xuser_id=a.target_user_id
             WHERE ${whereSql}
             ORDER BY a.id DESC
             LIMIT ? OFFSET ?
        `, [...params, String(pageSize), String(offset)]);
        ok(res, { list: rows, total: Number(total), page, pageSize });
    } catch (err) { fail500(res, err); }
});

// ============ P1-① 提交及时率看板 ============
router.get('/timeliness', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        const q = req.query;
        const bu = trimOrNull(q.bu_no) || 'HM';
        const mo = parseYM(q.YYYY_MM) || normalizeMonth(Number(q.year), q.month) || (() => {
            const d = new Date();
            return { ym: `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}` };
        })();
        const [y, m] = mo.ym.split('/').map(Number);

        // 计算应交天数（当月已过去的日历日，含今日）
        const now = new Date();
        const isCurMonth = (now.getFullYear() === y && (now.getMonth() + 1) === m);
        const lastDayOfMonth = new Date(y, m, 0).getDate();
        const today = isCurMonth ? now.getDate() : lastDayOfMonth;
        const dueDays = today; // 简化：每日均须交，含周末（工厂排班）

        // 拉取各人提交统计
        let where = ['bu_no=?', 'YYYY_MM=?', "status1='USE'"];
        let params = [bu, mo.ym];
        const target = resolveTarget(actor, trimOrNull(q.user_id));
        if (target) { where.push('user_id=?'); params.push(target); }
        const dept = trimOrNull(q.depart_id);
        if (dept) { where.push('depart_id=?'); params.push(dept); }

        const [rows] = await pool.execute(`
            SELECT user_id,
                   MAX(user_name) AS user_name,
                   MAX(depart_id) AS depart_id,
                   COUNT(DISTINCT report_date) AS submitted,
                   SUM(CASE WHEN create_time IS NOT NULL AND DATE(create_time) > report_date THEN 1 ELSE 0 END) AS late
              FROM daily_report
             WHERE ${where.join(' AND ')}
             GROUP BY user_id
             ORDER BY user_id
        `, params);

        const list = rows.map(r => {
            const submitted = Number(r.submitted);
            const late = Number(r.late) || 0;
            const missing = Math.max(0, dueDays - submitted);
            const onTime = Math.max(0, submitted - late);
            const rate = dueDays > 0 ? Math.round(onTime / dueDays * 1000) / 10 : 0;
            return {
                user_id: r.user_id,
                user_name: r.user_name || r.user_id,
                depart_id: r.depart_id || '',
                due: dueDays,
                submitted,
                on_time: onTime,
                late,
                missing,
                rate
            };
        });

        // 附加无日报但有锁定记录的人（极端情况）
        if (!target) {
            const [lockOnly] = await pool.execute(`
                SELECT DISTINCT user_id FROM daily_report_lock
                  WHERE bu_no=? AND YYYY_MM=? AND lock_status='LOCKED'
                    AND user_id NOT IN (SELECT user_id FROM daily_report WHERE bu_no=? AND YYYY_MM=?)
            `, [bu, mo.ym, bu, mo.ym]);
            for (const lo of lockOnly) {
                if (!list.find(x => x.user_id === lo.user_id)) {
                    list.push({ user_id: lo.user_id, user_name: lo.user_id, depart_id: '',
                        due: dueDays, submitted: 0, on_time: 0, late: 0, missing: dueDays, rate: 0 });
                }
            }
        }

        ok(res, list);
    } catch (err) { fail500(res, err); }
});

// ============ P1-② 月度绩效自动汇总 ============
router.get('/monthly-summary', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        const q = req.query;
        const bu = trimOrNull(q.bu_no) || 'HM';
        const mo = parseYM(q.YYYY_MM) || normalizeMonth(Number(q.year), q.month) || (() => {
            const d = new Date();
            return { ym: `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}` };
        })();

        let where = ['d.bu_no=?', 'd.YYYY_MM=?', "d.status1='USE'"];
        let params = [bu, mo.ym];
        const target = resolveTarget(actor, trimOrNull(q.user_id));
        if (target) { where.push('d.user_id=?'); params.push(target); }
        const dept = trimOrNull(q.depart_id);
        if (dept) { where.push('d.depart_id=?'); params.push(dept); }

        const [rows] = await pool.execute(`
            SELECT d.user_id,
                   MAX(d.user_name) AS user_name,
                   MAX(d.depart_id) AS depart_id,
                   COUNT(DISTINCT d.report_date) AS report_days,
                   COUNT(dt.id) AS detail_cnt,
                   ROUND(SUM(dt.use_time), 2) AS total_hours,
                   SUM(CASE WHEN d.projects1 IS NOT NULL AND d.projects1<>'' THEN 1 ELSE 0 END) AS delay_cnt,
                   SUM(CASE WHEN d.projects2 IS NOT NULL AND d.projects2<>'' THEN 1 ELSE 0 END) AS unresolved_cnt,
                   ROUND(SUM(CASE WHEN dt.wk_type='日常工作' THEN dt.use_time ELSE 0 END), 2) AS work_hours,
                   ROUND(SUM(CASE WHEN dt.wk_type!='日常工作' THEN dt.use_time ELSE 0 END), 2) AS life_hours
              FROM daily_report d
              LEFT JOIN daily_report_detail dt ON dt.ruid = d.id
             WHERE ${where.join(' AND ')}
             GROUP BY d.user_id
             ORDER BY d.user_id
        `, params);

        const list = rows.map(r => {
            const total = Number(r.total_hours) || 0;
            const work = Number(r.work_hours) || 0;
            const life = Number(r.life_hours) || 0;
            return {
                user_id: r.user_id,
                user_name: r.user_name || r.user_id,
                depart_id: r.depart_id || '',
                YYYY_MM: mo.ym,
                report_days: Number(r.report_days) || 0,
                detail_cnt: Number(r.detail_cnt) || 0,
                total_hours: total,
                delay_cnt: Number(r.delay_cnt) || 0,
                unresolved_cnt: Number(r.unresolved_cnt) || 0,
                work_hours: work,
                life_hours: life,
                work_ratio: total > 0 ? Math.round(work / total * 1000) / 10 : 0,
                life_ratio: total > 0 ? Math.round(life / total * 1000) / 10 : 0,
                avg_hours: Number(r.report_days) > 0 ? Math.round(total / Number(r.report_days) * 100) / 100 : 0
            };
        });

        // LEFT JOIN daily_report_target 取目标值
        if (list.length > 0) {
            const userIds = list.map(x => x.user_id);
            const placeholders = userIds.map(() => '?').join(',');
            const [targets] = await pool.execute(
                `SELECT user_id, target_hours, max_delays, max_unresolved, min_work_ratio, remark
                   FROM daily_report_target
                  WHERE bu_no=? AND YYYY_MM=? AND user_id IN (${placeholders})`,
                [bu, mo.ym, ...userIds]
            );
            const tMap = Object.fromEntries(targets.map(t => [t.user_id, t]));
            for (const item of list) {
                const t = tMap[item.user_id];
                if (t) {
                    item.target_hours = Number(t.target_hours) || null;
                    item.max_delays = Number(t.max_delays) || null;
                    item.max_unresolved = Number(t.max_unresolved) || null;
                    item.min_work_ratio = Number(t.min_work_ratio) || null;
                    item.target_remark = t.remark || '';
                    // 达成率
                    item.hours_achieve = item.target_hours ? Math.round(total_safe(item.total_hours) / item.target_hours * 1000) / 10 : null;
                    item.delay_over = item.max_delays != null ? Math.max(0, item.delay_cnt - item.max_delays) : null;
                    item.unresolved_over = item.max_unresolved != null ? Math.max(0, item.unresolved_cnt - item.max_unresolved) : null;
                }
            }
        }

        ok(res, list);
    } catch (err) { fail500(res, err); }
});

function total_safe(v) { return Number(v) || 0; }

// ============ P1-③ 目标设定与管理 ============
router.get('/targets', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        if (!actor.isManager) return fail(res, '权限不足，仅主管可设定目标', 403);
        const q = req.query;
        const bu = trimOrNull(q.bu_no) || 'HM';
        const mo = parseYM(q.YYYY_MM) || normalizeMonth(Number(q.year), q.month) || (() => {
            const d = new Date();
            return { ym: `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}` };
        })();

        const where = ['bu_no=?', 'YYYY_MM=?'];
        const params = [bu, mo.ym];
        const dept = trimOrNull(q.depart_id);
        if (dept) { where.push('depart_id=?'); params.push(dept); }

        const [rows] = await pool.execute(`
            SELECT t.*, u.xuser_name AS target_name, u.xuser_dept AS target_dept
              FROM daily_report_target t
              LEFT JOIN cams_xuser u ON u.xuser_id = t.user_id
             WHERE ${where.join(' AND ')}
             ORDER BY t.user_id
        `, params);

        ok(res, rows.map(r => ({
            id: r.id,
            user_id: r.user_id,
            user_name: r.target_name || r.user_id,
            depart_id: r.target_dept || '',
            YYYY_MM: r.YYYY_MM,
            target_hours: r.target_hours != null ? Number(r.target_hours) : null,
            max_delays: r.max_delays != null ? Number(r.max_delays) : null,
            max_unresolved: r.max_unresolved != null ? Number(r.max_unresolved) : null,
            min_work_ratio: r.min_work_ratio != null ? Number(r.min_work_ratio) : null,
            set_by: r.set_by,
            set_by_name: r.set_by_name,
            set_time: r.set_time,
            remark: r.remark || ''
        })));
    } catch (err) { fail500(res, err); }
});

router.post('/targets', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        if (!actor.isManager) return fail(res, '权限不足，仅主管可设定目标', 403);
        const b = req.body || {};
        const bu = trimOrNull(b.bu_no) || 'HM';
        const mo = parseYM(b.YYYY_MM);
        if (!mo) return fail(res, 'YYYY_MM 格式不正确（如 2025/10）', 400);

        const targets = Array.isArray(b.targets) ? b.targets : (b.user_id ? [b] : []);
        if (targets.length === 0) return fail(res, '请指定目标人员（targets 数组或 user_id）', 400);

        let upserted = 0;
        for (const t of targets) {
            const uid = trimOrNull(t.user_id);
            if (!uid) continue;
            const th = t.target_hours != null && t.target_hours !== '' ? Number(t.target_hours) : null;
            const md = t.max_delays != null && t.max_delays !== '' ? Number(t.max_delays) : null;
            const mu = t.max_unresolved != null && t.max_unresolved !== '' ? Number(t.max_unresolved) : null;
            const mw = t.min_work_ratio != null && t.min_work_ratio !== '' ? Number(t.min_work_ratio) : null;
            const remark = trimOrNull(t.remark) || null;

            await pool.execute(`
                INSERT INTO daily_report_target
                    (bu_no, user_id, YYYY_MM, target_hours, max_delays, max_unresolved, min_work_ratio, set_by, set_by_name, remark)
                VALUES (?,?,?,?,?,?,?,?,?,?)
                ON DUPLICATE KEY UPDATE
                    target_hours=VALUES(target_hours),
                    max_delays=VALUES(max_delays),
                    max_unresolved=VALUES(max_unresolved),
                    min_work_ratio=VALUES(min_work_ratio),
                    set_by=VALUES(set_by),
                    set_by_name=VALUES(set_by_name),
                    remark=VALUES(remark)
            `, [bu, uid, mo.ym, th, md, mu, mw, actor.user_id, actor.user_name, remark]);
            upserted++;
        }

        ok(res, { upserted }, `目标设定完成（${upserted} 人）`);
    } catch (err) { fail500(res, err); }
});

router.delete('/targets/:id', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        if (!actor.isManager) return fail(res, '权限不足，仅主管可删除目标', 403);
        const id = Number(req.params.id);
        if (!id) return fail(res, 'id 不正确', 400);
        await pool.execute('DELETE FROM daily_report_target WHERE id=?', [id]);
        ok(res, { id }, '目标已删除');
    } catch (err) { fail500(res, err); }
});

// ============ P2-① 高管人效仪表盘 ============
router.get('/efficiency-dashboard', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        if (!actor.isManager) return fail(res, '权限不足，仅主管可查看人效仪表盘', 403);
        const bu = trimOrNull(req.query.bu_no) || 'HM';
        const mo = parseYM(req.query.YYYY_MM) || (() => {
            const d = new Date(); return { ym: `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}` };
        })();
        const ym = mo.ym;

        // 1) 当月经营数据（产值 + 薪资 + 员工数）
        const [fin] = await pool.execute(
            `SELECT employee_cnt, salary_amt, avg_salary FROM mgm_finance_summary
              WHERE bu_no=? AND YYYY_MM=? LIMIT 1`, [bu, ym]);
        const empCnt = Number(fin[0]?.employee_cnt) || 84;
        const salaryTotal = Number(fin[0]?.salary_amt) || 0;

        const [so] = await pool.execute(
            `SELECT COALESCE(ROUND(SUM(so_qty*unit_price),2),0) AS output
               FROM ermm_erp_so WHERE bu_no=? AND YYYY_MM=?`, [bu, ym]);
        const totalOutput = Number(so[0]?.output) || 0;

        const [inv] = await pool.execute(
            `SELECT COALESCE(ROUND(SUM(sub_amt),2),0) AS invoice_amt
               FROM mgm_invoice_details WHERE bu_no=? AND YYYY_MM=?`, [bu, ym]);

        // 2) 当月日报工时汇总
        const [hrs] = await pool.execute(
            `SELECT ROUND(COALESCE(SUM(dt.use_time),0),2) AS total_hours,
                    COUNT(DISTINCT d.user_id) AS report_user_cnt
               FROM daily_report d
               LEFT JOIN daily_report_detail dt ON dt.ruid = d.id
              WHERE d.bu_no=? AND d.YYYY_MM=? AND d.status1='USE'`, [bu, ym]);
        const totalHours = Number(hrs[0]?.total_hours) || 0;

        // 3) 部门维度
        const [depts] = await pool.execute(
            `SELECT d.depart_id,
                    COUNT(DISTINCT d.user_id) AS emp_cnt,
                    ROUND(COALESCE(SUM(dt.use_time),0),2) AS total_hours
               FROM daily_report d
               LEFT JOIN daily_report_detail dt ON dt.ruid = d.id
              WHERE d.bu_no=? AND d.YYYY_MM=? AND d.status1='USE'
              GROUP BY d.depart_id ORDER BY total_hours DESC`, [bu, ym]);

        const deptRows = depts.map(d => {
            const ec = Number(d.emp_cnt) || 1;
            const th = Number(d.total_hours) || 0;
            return {
                depart_id: d.depart_id || '未分類',
                emp_cnt: ec,
                total_hours: th,
                per_capita_hours: Math.round(th / ec * 100) / 100,
                output_share: totalHours > 0 ? Math.round(th / totalHours * 1000) / 10 : 0
            };
        });

        // 4) 近 6 个月趋势
        const [y0, m0] = ym.split('/').map(Number);
        const trendMonths = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(y0, m0 - 1 - i, 1);
            trendMonths.push(`${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`);
        }
        const ph = trendMonths.map(() => '?').join(',');
        const [trendSo] = await pool.execute(
            `SELECT YYYY_MM, COALESCE(ROUND(SUM(so_qty*unit_price),2),0) AS output
               FROM ermm_erp_so WHERE bu_no=? AND YYYY_MM IN (${ph}) GROUP BY YYYY_MM`,
            [bu, ...trendMonths]);
        const soMap = Object.fromEntries(trendSo.map(r => [r.YYYY_MM, Number(r.output)]));
        const [trendHr] = await pool.execute(
            `SELECT d.YYYY_MM, COALESCE(ROUND(SUM(dt.use_time),2),0) AS total_hours
               FROM daily_report d
               LEFT JOIN daily_report_detail dt ON dt.ruid = d.id
              WHERE d.bu_no=? AND d.YYYY_MM IN (${ph}) AND d.status1='USE'
              GROUP BY d.YYYY_MM`, [bu, ...trendMonths]);
        const hrMap = Object.fromEntries(trendHr.map(r => [r.YYYY_MM, Number(r.total_hours)]));
        const trend = trendMonths.map(m => {
            const out = soMap[m] || 0;
            const th = hrMap[m] || 0;
            return {
                YYYY_MM: m,
                output: out,
                total_hours: th,
                per_capita_output: empCnt > 0 ? Math.round(out / empCnt) : 0,
                per_capita_hours: empCnt > 0 ? Math.round(th / empCnt * 100) / 100 : 0
            };
        });

        // 5) 交叉验证：日报 items_id ↔ ERP 单据
        const [xref] = await pool.execute(
            `SELECT items_id, erp_doc_type, erp_ref_field FROM daily_report_erp_xref WHERE bu_no=?`, [bu]);
        const xrefMap = new Map(xref.map(x => [x.items_id, x]));

        const [items] = await pool.execute(
            `SELECT dt.items_id, COUNT(*) AS report_cnt
               FROM daily_report_detail dt
               JOIN daily_report d ON d.id = dt.ruid
              WHERE d.bu_no=? AND d.YYYY_MM=? AND d.status1='USE' AND dt.items_id IS NOT NULL
              GROUP BY dt.items_id ORDER BY report_cnt DESC`, [bu, ym]);

        let reportItemCnt = 0, matchedCnt = 0;
        const itemRows = [];
        for (const it of items) {
            reportItemCnt += Number(it.report_cnt);
            const mapping = xrefMap.get(it.items_id);
            let erpDocCnt = 0;
            if (mapping) {
                const tbl = mapping.erp_doc_type === 'SO' ? 'ermm_erp_so'
                          : mapping.erp_doc_type === 'PO' ? 'ermm_erp_po'
                          : 'mgm_invoice_details';
                try {
                    const [[c]] = await pool.execute(
                        `SELECT COUNT(*) AS cnt FROM ${tbl} WHERE bu_no=? AND YYYY_MM=?`,
                        [bu, ym]);
                    erpDocCnt = Number(c.cnt);
                } catch (e) { /* PO 表无 YYYY_MM 字段时用 po_date 兜底 */
                    if (mapping.erp_doc_type === 'PO') {
                        const [[c2]] = await pool.execute(
                            `SELECT COUNT(*) AS cnt FROM ermm_erp_po WHERE bu_no=? AND DATE_FORMAT(po_date,'%Y/%m')=?`,
                            [bu, ym]);
                        erpDocCnt = Number(c2.cnt);
                    }
                }
                matchedCnt += Number(it.report_cnt);
            }
            itemRows.push({
                items_id: it.items_id,
                report_cnt: Number(it.report_cnt),
                erp_doc_cnt: erpDocCnt,
                matched: !!mapping,
                erp_doc_type: mapping?.erp_doc_type || null
            });
        }

        ok(res, {
            period: ym,
            kpi: {
                total_output: totalOutput,
                invoice_amt: Number(inv[0]?.invoice_amt) || 0,
                total_hours: totalHours,
                employee_cnt: empCnt,
                report_user_cnt: Number(hrs[0]?.report_user_cnt) || 0,
                per_capita_output: empCnt > 0 ? Math.round(totalOutput / empCnt) : 0,
                per_capita_hours: empCnt > 0 ? Math.round(totalHours / empCnt * 100) / 100 : 0,
                salary_total: salaryTotal,
                per_capita_salary: empCnt > 0 ? Math.round(salaryTotal / empCnt) : 0
            },
            departments: deptRows,
            trend,
            crossValidation: {
                report_item_cnt: reportItemCnt,
                matched_cnt: matchedCnt,
                unmatched_cnt: reportItemCnt - matchedCnt,
                match_rate: reportItemCnt > 0 ? Math.round(matchedCnt / reportItemCnt * 1000) / 10 : 0,
                items: itemRows
            }
        });
    } catch (err) { fail500(res, err); }
});

// ============ P2-② 月度经营+人效报告 ============
// 提取为可复用函数，供 GET 查看与 POST 推送共用
async function buildMgmtReport(bu, ym) {
    // 经营数据
    const [fin] = await pool.execute(
        `SELECT employee_cnt, salary_amt, avg_salary FROM mgm_finance_summary WHERE bu_no=? AND YYYY_MM=?`, [bu, ym]);
    const [so] = await pool.execute(
        `SELECT COALESCE(ROUND(SUM(so_qty*unit_price),2),0) AS output, COUNT(*) AS so_cnt FROM ermm_erp_so WHERE bu_no=? AND YYYY_MM=?`, [bu, ym]);
    const [inv] = await pool.execute(
        `SELECT COALESCE(ROUND(SUM(sub_amt),2),0) AS invoice_amt, COUNT(*) AS inv_cnt FROM mgm_invoice_details WHERE bu_no=? AND YYYY_MM=?`, [bu, ym]);
    const [po] = await pool.execute(
        `SELECT COALESCE(ROUND(SUM(po_qty*unit_price),2),0) AS po_amt, COUNT(*) AS po_cnt FROM ermm_erp_po WHERE bu_no=? AND DATE_FORMAT(po_date,'%Y/%m')=?`, [bu, ym]);

    const empCnt = Number(fin[0]?.employee_cnt) || 84;
    const salaryTotal = Number(fin[0]?.salary_amt) || 0;
    const output = Number(so[0]?.output) || 0;
    const invoiceAmt = Number(inv[0]?.invoice_amt) || 0;
    const poAmt = Number(po[0]?.po_amt) || 0;

    // 人效汇总
    const [eff] = await pool.execute(
        `SELECT COUNT(DISTINCT d.user_id) AS report_users,
                COUNT(DISTINCT d.report_date) AS report_days,
                ROUND(COALESCE(SUM(dt.use_time),0),2) AS total_hours,
                ROUND(COALESCE(SUM(CASE WHEN dt.wk_type='日常工作' THEN dt.use_time ELSE 0 END),0),2) AS work_hours
           FROM daily_report d
           LEFT JOIN daily_report_detail dt ON dt.ruid = d.id
          WHERE d.bu_no=? AND d.YYYY_MM=? AND d.status1='USE'`, [bu, ym]);

    // 部门表现
    const [depts] = await pool.execute(
        `SELECT d.depart_id,
                COUNT(DISTINCT d.user_id) AS emp_cnt,
                ROUND(COALESCE(SUM(dt.use_time),0),2) AS total_hours
           FROM daily_report d
           LEFT JOIN daily_report_detail dt ON dt.ruid = d.id
          WHERE d.bu_no=? AND d.YYYY_MM=? AND d.status1='USE'
          GROUP BY d.depart_id ORDER BY total_hours DESC`, [bu, ym]);

    // Top / Bottom 员工（按总工时）
    const [users] = await pool.execute(
        `SELECT d.user_id, MAX(d.user_name) AS user_name, MAX(d.depart_id) AS depart_id,
                ROUND(COALESCE(SUM(dt.use_time),0),2) AS total_hours
           FROM daily_report d
           LEFT JOIN daily_report_detail dt ON dt.ruid = d.id
          WHERE d.bu_no=? AND d.YYYY_MM=? AND d.status1='USE'
          GROUP BY d.user_id ORDER BY total_hours DESC`, [bu, ym]);
    const top5 = users.slice(0, 5);
    const bottom5 = users.slice(-5).reverse();

    // 上月对比（产值环比）
    const [y0, m0] = ym.split('/').map(Number);
    const prev = new Date(y0, m0 - 2, 1);
    const prevYm = `${prev.getFullYear()}/${String(prev.getMonth() + 1).padStart(2, '0')}`;
    const [prevSo] = await pool.execute(
        `SELECT COALESCE(ROUND(SUM(so_qty*unit_price),2),0) AS output FROM ermm_erp_so WHERE bu_no=? AND YYYY_MM=?`, [bu, prevYm]);
    const prevOutput = Number(prevSo[0]?.output) || 0;
    const outputMom = prevOutput > 0 ? Math.round((output - prevOutput) / prevOutput * 1000) / 10 : null;

    const totalHours = Number(eff[0]?.total_hours) || 0;
    const workHours = Number(eff[0]?.work_hours) || 0;

    return {
        period: ym,
        bu_no: bu,
        business: {
            output, output_mom: outputMom,
            invoice_amt: invoiceAmt, invoice_cnt: Number(inv[0]?.inv_cnt) || 0,
            po_amt: poAmt, po_cnt: Number(po[0]?.po_cnt) || 0,
            so_cnt: Number(so[0]?.so_cnt) || 0
        },
        hr: {
            employee_cnt: empCnt,
            salary_total: salaryTotal,
            avg_salary: empCnt > 0 ? Math.round(salaryTotal / empCnt) : 0
        },
        efficiency: {
            report_users: Number(eff[0]?.report_users) || 0,
            report_days: Number(eff[0]?.report_days) || 0,
            total_hours: totalHours,
            work_hours: workHours,
            work_ratio: totalHours > 0 ? Math.round(workHours / totalHours * 1000) / 10 : 0,
            per_capita_output: empCnt > 0 ? Math.round(output / empCnt) : 0,
            per_capita_hours: empCnt > 0 ? Math.round(totalHours / empCnt * 100) / 100 : 0
        },
        departments: depts.map(d => ({
            depart_id: d.depart_id || '未分類',
            emp_cnt: Number(d.emp_cnt) || 0,
            total_hours: Number(d.total_hours) || 0
        })),
        top_performers: top5,
        bottom_performers: bottom5,
        generated_at: new Date().toISOString()
    };
}

router.get('/monthly-business-report', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        if (!actor.isSenior) return fail(res, '权限不足，仅高階主管可查看经营报告', 403);
        const bu = trimOrNull(req.query.bu_no) || 'HM';
        const mo = parseYM(req.query.YYYY_MM) || (() => {
            const d = new Date(); return { ym: `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}` };
        })();
        const ym = mo.ym;

        const report = await buildMgmtReport(bu, ym);
        ok(res, report);
    } catch (err) { fail500(res, err); }
});

// ============ P2-② 推送月度报告（發送郵件 + 落庫送達回執） ============
router.post('/monthly-business-report/push', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        if (!actor.isSenior) return fail(res, '权限不足，仅高階主管可推送报告', 403);
        const bu = trimOrNull(req.body?.bu_no) || 'HM';
        const mo = parseYM(req.body?.YYYY_MM);
        if (!mo) return fail(res, 'YYYY_MM 格式不正确（YYYY/MM）', 400);
        const ym = mo.ym;

        // 1) 產生完整報告（與 GET 一致）
        const report = await buildMgmtReport(bu, ym);
        const reportData = JSON.stringify(report);

        // 2) 發送郵件給高管
        const recipients = getRecipients();
        const mailResult = await sendMgmtReport(report);

        // 3) 落庫送達回執
        const status = mailResult.success ? 'PUSHED' : 'FAILED';
        const deliveredTime = mailResult.success ? 'NOW()' : 'NULL';
        const errorMsg = mailResult.success ? null : (mailResult.message || '').slice(0, 500);
        const recipientsStr = recipients.join(',');

        const [exist] = await pool.execute(`SELECT id FROM daily_report_mgmt_report WHERE bu_no=? AND YYYY_MM=?`, [bu, ym]);
        if (exist.length > 0) {
            await pool.execute(
                `UPDATE daily_report_mgmt_report
                    SET report_data=?, pushed_by=?, pushed_by_name=?, pushed_time=NOW(),
                        status=?, recipients=?, delivered_time=${deliveredTime}, error_msg=?
                  WHERE id=?`,
                [reportData, actor.user_id, actor.user_name, status, recipientsStr, errorMsg, exist[0].id]);
        } else {
            await pool.execute(
                `INSERT INTO daily_report_mgmt_report
                    (bu_no, YYYY_MM, report_data, pushed_by, pushed_by_name, pushed_time, status, recipients, delivered_time, error_msg)
                 VALUES (?,?,?,?,?,NOW(),?,?,${deliveredTime},?)`,
                [bu, ym, reportData, actor.user_id, actor.user_name, status, recipientsStr, errorMsg]);
        }

        const result = {
            bu_no: bu, YYYY_MM: ym, status,
            pushed_by: actor.user_name,
            pushed_time: new Date().toISOString(),
            recipients: recipients,
            delivered: mailResult.success,
            message: mailResult.message
        };
        if (mailResult.success) {
            ok(res, result, `報告已推送给 ${recipients.length} 位高管`);
        } else {
            ok(res, result, `報告已存檔，但郵件發送失敗：${mailResult.message}`);
        }
    } catch (err) { fail500(res, err); }
});

// ============ P2-② 高管報告收件箱（推送歷史） ============
router.get('/mgmt-reports', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        if (!actor.isSenior) return fail(res, '权限不足，仅高階主管可查看推送记录', 403);
        const bu = trimOrNull(req.query.bu_no) || 'HM';
        const [rows] = await pool.execute(
            `SELECT id, bu_no, YYYY_MM, status, pushed_by, pushed_by_name,
                    pushed_time, recipients, delivered_time, error_msg,
                    JSON_EXTRACT(report_data, '$.business.output') AS output,
                    JSON_EXTRACT(report_data, '$.hr.employee_cnt') AS employee_cnt,
                    JSON_EXTRACT(report_data, '$.efficiency.per_capita_output') AS per_capita_output
               FROM daily_report_mgmt_report
              WHERE bu_no=?
              ORDER BY YYYY_MM DESC LIMIT 24`, [bu]);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ============ P2-② 查看單筆推送報告詳情 ============
router.get('/mgmt-reports/:id', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        if (!actor.isSenior) return fail(res, '权限不足，仅高階主管可查看', 403);
        const id = Number(req.params.id);
        if (!id) return fail(res, 'id 不正确', 400);
        const [rows] = await pool.execute(
            `SELECT * FROM daily_report_mgmt_report WHERE id=? LIMIT 1`, [id]);
        if (rows.length === 0) return fail(res, '报告不存在', 404);
        const r = rows[0];
        try { r.report_data = JSON.parse(r.report_data); } catch (e) { /* keep raw */ }
        ok(res, r);
    } catch (err) { fail500(res, err); }
});

// ============ 单笔日报（主表+明细） ============
router.get('/:id', async (req, res) => {
    try {
        const actor = await resolveActor(req);
        if (actor.error) return fail(res, '使用者不存在或未登入', 403);
        const id = Number(req.params.id);
        if (!id) return fail(res, 'id 不正确', 400);

        const [masters] = await pool.execute(
            `SELECT r.*, COALESCE(u.xuser_name, r.user_name) AS user_name
               FROM daily_report r
               LEFT JOIN cams_xuser u ON u.xuser_id = r.user_id
              WHERE r.id=? LIMIT 1`, [id]);
        if (masters.length === 0) return fail(res, '日报不存在', 404);
        const master = masters[0];
        if (!actor.isManager && master.user_id !== actor.user_id) return fail(res, '权限不足', 403);

        const [details] = await pool.execute(
            'SELECT * FROM daily_report_detail WHERE ruid=? ORDER BY from_time, id', [id]
        );
        const lock = await findActiveLock(pool, master.bu_no, master.user_id, master.YYYY_MM);
        ok(res, {
            master, details,
            locked: !!lock,
            lock: lock ? {
                locked_by: lock.locked_by, locked_by_name: lock.locked_by_name,
                locked_time: lock.locked_time
            } : null
        });
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
            if (fMin < DAY_START_MIN || tMin > DAY_END_MIN) return fail(res, '作业时间须在 08:00~23:30 之间', 400);
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
        // 签核锁定拦截：该员工该月已锁定即禁止任何新增/覆盖（连接由 finally 统一释放）
        const activeLock = await findActiveLock(pool, bu, actor.user_id, ym);
        if (activeLock) return fail(res, '该月日报已签核锁定，请联系高階主管解锁后再修改', 423);
        const withinWindow = Math.abs(daysFromToday(dateStr)) <= EDIT_WINDOW_DAYS;
        const reqP1 = trimOrNull(b.projects1);
        const reqP2 = trimOrNull(b.projects2);
        const status1 = b.status1 === 'NOUSE' ? 'NOUSE' : 'USE';
        // 超 7 天窗的新增强制 NULL；更新行在 SQL 中以 CASE 保留库内原值
        const p1 = withinWindow ? reqP1 : null;
        const p2 = withinWindow ? reqP2 : null;

        await conn.beginTransaction();

        // 保存前旧值（审计用，事务内读取保证一致性）
        const [oldMasters] = await conn.execute(
            'SELECT * FROM daily_report WHERE bu_no=? AND user_id=? AND report_date=? LIMIT 1',
            [bu, actor.user_id, dateStr]
        );
        const oldMaster = oldMasters[0] || null;
        let oldDetails = [];
        if (oldMaster) {
            const [od] = await conn.execute(
                'SELECT * FROM daily_report_detail WHERE ruid=? ORDER BY from_time, id', [oldMaster.id]);
            oldDetails = od;
        }
        const existed = !!oldMaster;

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

        // 审计日志（CREATE/UPDATE），与业务同一事务，杜绝「改了没记」
        const effectiveP1 = withinWindow ? p1 : (oldMaster ? oldMaster.projects1 : p1);
        const effectiveP2 = withinWindow ? p2 : (oldMaster ? oldMaster.projects2 : p2);
        await writeAudit(conn, {
            bu_no: bu, ruid: masterId, report_date: dateStr,
            target_user_id: actor.user_id, target_user_name: actor.user_name, ym,
            action: existed ? AUDIT.UPDATE : AUDIT.CREATE,
            operator_id: actor.user_id, operator_name: actor.user_name,
            operator_ip: clientIp(req),
            old_data: existed ? { master: oldMaster, details: oldDetails } : null,
            new_data: {
                master: {
                    bu_no: bu, depart_id: actor.xuser_dept, user_id: actor.user_id,
                    report_date: dateStr, projects1: effectiveP1, projects2: effectiveP2,
                    status1, YYYY_MM: ym
                },
                details
            }
        });

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

        const [masters] = await conn.execute('SELECT * FROM daily_report WHERE id=? LIMIT 1', [id]);
        if (masters.length === 0) return fail(res, '日报不存在', 404);
        const masterRow = masters[0];
        if (!actor.isManager && masterRow.user_id !== actor.user_id) return fail(res, '权限不足，无法删除他人日报', 403);

        // 签核锁定拦截：任何人（含经理）删除已锁定月日报均须先解锁
        const delLock = await findActiveLock(conn, masterRow.bu_no, masterRow.user_id, masterRow.YYYY_MM);
        if (delLock) return fail(res, '该月日报已签核锁定，请联系高階主管解锁后再删除', 423);

        await conn.beginTransaction();
        const [oldDetails] = await conn.execute(
            'SELECT * FROM daily_report_detail WHERE ruid=? ORDER BY from_time, id', [id]);
        await writeAudit(conn, {
            bu_no: masterRow.bu_no, ruid: id, report_date: masterRow.report_date,
            target_user_id: masterRow.user_id,
            target_user_name: masterRow.user_name, ym: masterRow.YYYY_MM,
            action: AUDIT.DELETE,
            operator_id: actor.user_id, operator_name: actor.user_name,
            operator_ip: clientIp(req),
            old_data: { master: masterRow, details: oldDetails }, new_data: null
        });
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
            SELECT r.user_id, MAX(COALESCE(u.xuser_name, r.user_name)) AS user_name, MAX(r.depart_id) AS depart_id,
                   COUNT(*) AS unfinished_cnt
              FROM daily_report r
              LEFT JOIN cams_xuser u ON u.xuser_id = r.user_id
             WHERE ${where.join(' AND ')}
             GROUP BY r.user_id
             ORDER BY unfinished_cnt DESC, r.user_id
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
            SELECT r.id, r.report_date, r.projects1, r.projects2, r.user_id,
                   COALESCE(u.xuser_name, r.user_name) AS user_name, r.depart_id, r.YYYY_MM
              FROM daily_report r
              LEFT JOIN cams_xuser u ON u.xuser_id = r.user_id
             WHERE ${whereSql}
             ORDER BY r.report_date DESC, r.id DESC
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

// ============ 分析：某月明细（点击月柱后展开，可选 wk_type 过滤） ============
router.get('/analysis/monthly-detail', async (req, res) => {
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
        const wk = trimOrNull(q.wk_type);
        if (wk) { where.push('wk_type=?'); params.push(wk); }

        const [rows] = await pool.execute(`
            SELECT id, report_date, from_time, to_time, use_time, projects,
                   wk_type, client_id, items_id
              FROM daily_report_detail
             WHERE ${where.join(' AND ')}
             ORDER BY report_date ASC, from_time ASC, id ASC
        `, params);
        ok(res, rows.map(r => ({
            id: r.id,
            report_date: r.report_date,
            from_time: r.from_time,
            to_time: r.to_time,
            use_time: Number(r.use_time) || 0,
            projects: r.projects,
            wk_type: r.wk_type,
            client_id: r.client_id,
            items_id: r.items_id
        })));
    } catch (err) { fail500(res, err); }
});

module.exports = router;
