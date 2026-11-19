/**
 * CTO-03 兜底审计中间件
 *
 * 职责：**自动捕获所有写请求（POST / PUT / DELETE / PATCH）**，写入 audit_event。
 *
 * 为什么叫"兜底"：
 *   业务路由应该在成功处理后显式调用 `services/audit.log()` 写入详细信息
 *   （单据号 / 业务类型 / before / after / diff）。
 *   这个中间件负责**那些没显式记录的**写请求，只记 path + method + user_id。
 *   这样每个模块至少有一层可追溯，避免"完全不知道谁改了什么"。
 *
 * 不记录：
 *   - OPTIONS / GET / HEAD / 纯读取操作
 *   - /api/health（健康检查，避免审计表被刷）
 *   - 非 2xx/3xx 响应（成功才写，失败不造垃圾数据）
 *
 * 审计格式：
 *   module = 'middleware'（与显式记录的模块代码区分）
 *   action = HTTP 方法（小写）
 *   summary = `${method} ${path}`
 *   detail = { path, method, query_keys, body_keys }
 */
const audit = require('../services/audit');

const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
const SKIP_PREFIXES = ['/api/health'];  // 不跳过 /api/monitor —— 监控路由本身也是被审计对象

function auditBare(req, res, next) {
    if (!WRITE_METHODS.has(req.method)) return next();
    for (const p of SKIP_PREFIXES) if (req.path.startsWith(p)) return next();

    // 等待响应结束，确保写操作是否成功可知
    res.on('finish', () => {
        const sc = res.statusCode;
        if (sc >= 400) return;               // 只记成功的写操作

        audit.logBare(req, req.method, {
            path: req.path,
            query_keys: Object.keys(req.query || {}),
            body_keys: req.body ? Object.keys(req.body).slice(0, 20) : null
        });
    });

    next();
}

module.exports = auditBare;
