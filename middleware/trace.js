/**
 * Trace 中间件：为每个请求生成 traceId
 *
 * - 来源优先级：X-Trace-Id 头（上游传来）→ 生成新 UUID
 * - 挂到 req.traceId，写入响应头 X-Trace-Id，便于前后端联动排错
 * - 错误堆栈里也带 traceId
 */
const crypto = require('crypto');

function trace(req, res, next) {
    const fromHeader = (req.headers['x-trace-id'] || '').trim();
    req.traceId = fromHeader || crypto.randomBytes(8).toString('hex');
    res.setHeader('X-Trace-Id', req.traceId);
    next();
}

module.exports = trace;
