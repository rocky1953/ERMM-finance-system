/**
 * CTO-04 监控 & 备份 API（管理员权限）
 *
 * 接口列表：
 *   GET  /api/monitor/backups           列出最近 50 条备份记录
 *   POST /api/monitor/backups/trigger  手动触发备份 { remark?: string }
 *   POST /api/monitor/backups/restore  从指定备份恢复 { id: number | fileName: string }
 *   POST /api/monitor/backups/prune    强制执行 GFS 保留策略清理
 *   GET  /api/monitor/health           系统健康状态（DB / 磁盘 / 最近备份）
 *   GET  /api/monitor/metrics/summary  今日接口指标汇总（method+path → 次数 / avg_ms / p95_ms / 4xx / 5xx）
 *   GET  /api/monitor/metrics/slow     慢请求 Top 20（duration_ms desc）
 *   GET  /api/monitor/metrics/errors    最近 50 条错误级请求
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { requireAdmin } = require('../middleware/auth');

// 所有 monitor 路由都要求管理员
router.use(requireAdmin);

// ======= 备份管理 =======

router.get('/backups', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, backup_type, file_name, file_size, status, started_at, finished_at,
                    duration_ms, error_message, remark, restored_from_id
             FROM backup_log
             ORDER BY started_at DESC
             LIMIT 100`
        );
        res.json({ success: true, data: rows });
    } catch (e) { res.status(500).json({ success: false, message: e.message, traceId: req.traceId }); }
});

router.post('/backups/trigger', async (req, res) => {
    try {
        const { doBackup } = require('../scripts/backup');
        const result = await doBackup({
            type: req.body.type || 'MANUAL',
            remark: req.body.remark || '',
            triggeredBy: (req.user && req.user.user_id) ? String(req.user.user_id) : null
        });
        if (result.status === 'SUCCESS') {
            res.json({ success: true, data: result, message: '备份成功' });
        } else {
            res.status(500).json({ success: false, message: `备份失败：${result.error}` });
        }
    } catch (e) {
        res.status(500).json({ success: false, message: e.message, traceId: req.traceId });
    }
});

router.post('/backups/restore', async (req, res) => {
    try {
        const { id, fileName } = req.body;
        const target = id != null ? id : fileName;
        if (target == null) {
            return res.status(400).json({ success: false, message: '需提供 id 或 fileName' });
        }
        const { restore } = require('../scripts/backup');
        const result = await restore(target);
        res.json({ success: true, data: result });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message, traceId: req.traceId });
    }
});

router.post('/backups/prune', async (req, res) => {
    try {
        const { prune } = require('../scripts/backup');
        const removed = await prune();
        res.json({ success: true, data: { removedCount: removed.length, removed } });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ======= 系统健康 =======

router.get('/health', async (req, res) => {
    try {
        // DB 连接检测
        const [dbOk] = await pool.execute('SELECT 1 AS ok');

        // 最近备份
        const [recent] = await pool.query(
            `SELECT started_at, status, file_size, duration_ms
             FROM backup_log WHERE status='SUCCESS'
             ORDER BY started_at DESC LIMIT 1`
        );

        // 备份目录磁盘空间（Windows 上用 fs 粗略估算）
        const fs = require('fs');
        const path = require('path');
        const backupDir = path.join(__dirname, '..', 'backups');
        let totalBackups = 0, totalSize = 0;
        if (fs.existsSync(backupDir)) {
            const files = fs.readdirSync(backupDir);
            for (const f of files) {
                try {
                    const stat = fs.statSync(path.join(backupDir, f));
                    totalSize += stat.size;
                    if (stat.isFile()) totalBackups++;
                } catch (e) { /* 忽略 */ }
            }
        }

        // 今日 API 调用概况
        const ymd = (() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`; })();
        const [[todayStat]] = await pool.query(
            `SELECT COUNT(*) cnt, SUM(CASE WHEN status_code>=500 THEN 1 ELSE 0 END) errs
             FROM api_metric WHERE created_ymd=?`,
            [ymd]
        );

        res.json({
            success: true,
            data: {
                database: dbOk[0] && dbOk[0].ok ? 'UP' : 'DOWN',
                databaseLatencyMs: null,  // 可后续用 SELECT ... FORMAT(now(6)-...) 估算
                latestBackup: recent[0] || null,
                backupDir: { count: totalBackups, totalSizeBytes: totalSize },
                apiToday: { calls: todayStat.cnt || 0, serverErrors: todayStat.errs || 0 },
                serverTime: new Date().toISOString(),
                uptimeSec: Math.floor(process.uptime())
            }
        });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ======= API 指标 =======

router.get('/metrics/summary', async (req, res) => {
    try {
        const ymd = req.query.ymd || (() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`; })();
        const [rows] = await pool.query(
            `SELECT method, path,
                    COUNT(*) AS calls,
                    ROUND(AVG(duration_ms), 1) AS avg_ms,
                    MAX(duration_ms) AS max_ms,
                    SUM(CASE WHEN status_code>=500 THEN 1 ELSE 0 END) AS s5xx,
                    SUM(CASE WHEN status_code>=400 AND status_code<500 THEN 1 ELSE 0 END) AS s4xx,
                    SUM(CASE WHEN status_code<400 THEN 1 ELSE 0 END) AS s2xx
             FROM api_metric WHERE created_ymd=?
             GROUP BY method, path
             ORDER BY calls DESC
             LIMIT 200`,
            [ymd]
        );
        res.json({ success: true, data: { ymd, rows } });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/metrics/slow', async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 20, 100);
        const [rows] = await pool.query(
            `SELECT id, trace_id, method, path, status_code, duration_ms,
                    user_id, created_at
             FROM api_metric
             ORDER BY duration_ms DESC
             LIMIT ${limit}`
        );
        res.json({ success: true, data: rows });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/metrics/errors', async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const [rows] = await pool.query(
            `SELECT id, trace_id, method, path, status_code, duration_ms,
                    error_message, user_id, created_at
             FROM api_error
             ORDER BY created_at DESC
             LIMIT ${limit}`
        );
        res.json({ success: true, data: rows });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ======= CTO-03 操作审计 =======

router.get('/audit', async (req, res) => {
    try {
        const { module, action, businessType, businessId, userId, startYmd, endYmd, q, limit } = req.query;
        const L = Math.min(Number(limit) || 100, 500);
        const where = [];
        const args = [];
        if (module) { where.push('module = ?'); args.push(module); }
        if (action) { where.push('action = ?'); args.push(action); }
        if (businessType) { where.push('business_type = ?'); args.push(businessType); }
        if (businessId) { where.push('business_id = ?'); args.push(businessId); }
        if (userId) { where.push('user_id = ?'); args.push(userId); }
        if (startYmd) { where.push('created_ymd >= ?'); args.push(startYmd); }
        if (endYmd) { where.push('created_ymd <= ?'); args.push(endYmd); }
        if (q) { where.push('(summary LIKE ? OR detail LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
        const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const [[total]] = await pool.query(`SELECT COUNT(*) c FROM audit_event ${whereClause}`, args);
        const [rows] = await pool.query(
            `SELECT id, trace_id, module, action, business_type, business_id,
                    summary, user_id, user_name, bu_no, ip, created_at
             FROM audit_event ${whereClause}
             ORDER BY id DESC LIMIT ${L}`,
            args
        );
        res.json({ success: true, data: { total: total.c, rows } });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/audit/:id', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM audit_event WHERE id=?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ success: false, message: '审计记录不存在' });
        res.json({ success: true, data: rows[0] });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/audit/setting/all', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM audit_setting ORDER BY module');
        res.json({ success: true, data: rows });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/audit/setting/:module', async (req, res) => {
    try {
        const { enabled, capture_detail, remark } = req.body;
        await pool.query(
            `INSERT INTO audit_setting (module, enabled, capture_detail, remark) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE enabled=VALUES(enabled), capture_detail=VALUES(capture_detail), remark=VALUES(remark)`,
            [req.params.module, enabled ? 1 : 0, capture_detail ? 1 : 0, remark || null]
        );
        // 让下一次写请求立即生效（跳过 60s 缓存）
        const { reloadSettings } = require('../services/audit');
        reloadSettings();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/audit/activity/summary', async (req, res) => {
    try {
        const ymd = req.query.ymd || (() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`; })();
        const [byModule] = await pool.query(
            `SELECT module, action, COUNT(*) cnt
             FROM audit_event WHERE created_ymd=?
             GROUP BY module, action ORDER BY cnt DESC LIMIT 100`, [ymd]
        );
        const [topUsers] = await pool.query(
            `SELECT user_id, user_name, COUNT(*) cnt
             FROM audit_event WHERE created_ymd=?
             GROUP BY user_id, user_name ORDER BY cnt DESC LIMIT 10`, [ymd]
        );
        const [bizChanges] = await pool.query(
            `SELECT COUNT(*) cnt FROM audit_event WHERE created_ymd=?
             AND (action IN ('CREATE','UPDATE','DELETE','SUBMIT','APPROVE','REJECT','LOCK','EXPORT')
                  OR action IN ('POST','PUT','PATCH','DELETE'))`,
            [ymd]
        );
        res.json({ success: true, data: { ymd, byModule, topUsers, bizChanges: bizChanges[0].cnt || 0 } });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;
