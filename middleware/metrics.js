/**
 * Metrics 中间件：拦截每个 HTTP 请求写入 api_metric
 *
 * 设计原则：
 *   1. **fire-and-forget** —— 记录失败不阻塞主链路（try/catch + 忽略 reject）
 *   2. **最小字段** —— 只存必要列（method / path / status / ms / trace / user / created / ymd）
 *   3. **跳过自指与健康检查** —— 不记录 /api/metrics 自己和 /health
 *   4. **错误级另存 api_error** —— status >= 400 时额外存一份带堆栈的错误表
 *   5. **批量聚合** —— 累积 100ms 内的请求批量 INSERT，减少数据库往返
 */
const { pool } = require('../config/db');

// 批量写入缓冲
const BUFFER_MS = 100;
const MAX_BUFFER = 200;
let metricBuffer = [];
let errorBuffer = [];
let flushTimer = null;

function ymd(date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
}

async function flushMetrics() {
    if (metricBuffer.length === 0 && errorBuffer.length === 0) return;
    const mBatch = metricBuffer.splice(0);
    const eBatch = errorBuffer.splice(0);

    try {
        if (mBatch.length) {
            const rows = mBatch.map(r => [
                r.trace_id, r.method, r.path, r.status_code, r.duration_ms,
                r.user_id, r.created_at, r.created_ymd
            ]);
            await pool.query(
                `INSERT INTO api_metric (trace_id, method, path, status_code, duration_ms, user_id, created_at, created_ymd)
                 VALUES ${rows.map(() => '(?,?,?,?,?,?,?,?)').join(',')}`,
                rows.flat()
            );
        }
        if (eBatch.length) {
            const rows = eBatch.map(r => [
                r.trace_id, r.method, r.path, r.status_code, r.duration_ms,
                r.error_message, r.error_stack, r.user_id,
                r.request_body_snippet, r.response_snippet,
                r.created_at, r.created_ymd
            ]);
            await pool.query(
                `INSERT INTO api_error (trace_id, method, path, status_code, duration_ms,
                    error_message, error_stack, user_id, request_body_snippet, response_snippet,
                    created_at, created_ymd)
                 VALUES ${rows.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?)').join(',')}`,
                rows.flat()
            );
        }
    } catch (e) {
        // 记录失败只输出到 stderr，不抛到主链路
        console.error('[metrics] flush failed:', e.message);
    }
}

function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        flushMetrics();
    }, BUFFER_MS);
}

// 进程退出前强制刷一次
process.on('beforeExit', () => { flushMetrics(); });
process.on('SIGINT', () => { flushMetrics(); process.exit(0); });

function metrics(req, res, next) {
    const startNs = process.hrtime.bigint();
    const startAt = new Date();

    // 不记录自己 / 健康检查 / 静态文件
    const skipPath = req.path.startsWith('/api/metrics') ||
                     req.path === '/health' ||
                     req.path === '/api/health';

    // 只对真实 API 请求做记录（路由已匹配）
    res.on('finish', () => {
        if (skipPath) return;

        const durationMs = Number((process.hrtime.bigint() - startNs) / 1_000_000n);
        const statusCode = res.statusCode;

        const row = {
            trace_id: req.traceId,
            method: req.method.toUpperCase(),
            path: (req.path || '').slice(0, 255),
            status_code: statusCode,
            duration_ms: durationMs,
            user_id: req.user && req.user.user_id ? String(req.user.user_id).slice(0, 64) : null,
            created_at: startAt,
            created_ymd: ymd(startAt)
        };
        metricBuffer.push(row);

        // 错误级额外存详细错误表
        if (statusCode >= 400 && statusCode < 600) {
            const errRow = {
                ...row,
                error_message: (res.locals && res.locals.errorMessage) ? String(res.locals.errorMessage).slice(0, 1024) : null,
                error_stack: (res.locals && res.locals.errorStack) ? String(res.locals.errorStack).slice(0, 65535) : null,
                request_body_snippet: (req.body ? JSON.stringify(req.body) : '').slice(0, 2048),
                response_snippet: (res.locals && res.locals.responseBody) ? String(res.locals.responseBody).slice(0, 2048) : null
            };
            errorBuffer.push(errRow);
        }

        if (metricBuffer.length >= MAX_BUFFER || errorBuffer.length >= MAX_BUFFER) {
            clearTimeout(flushTimer);
            flushTimer = null;
            flushMetrics();
        } else {
            scheduleFlush();
        }
    });

    next();
}

module.exports = metrics;
