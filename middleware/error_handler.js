/**
 * 全局错误处理中间件（必须挂在所有路由之后）
 *
 * - 捕获所有 express next(err) 抛出的错误
 * - 返回统一 JSON 格式 { success:false, code, message, traceId }
 * - 把错误摘要塞进 res.locals，让 metrics 中间件能拿到写入 api_error
 */
function errorHandler(err, req, res, next) {
    // 给 metrics 中间件准备错误信息
    res.locals = res.locals || {};
    res.locals.errorMessage = err.message;
    res.locals.errorStack = err.stack;

    // 已知业务错误
    if (err.code === 'VALIDATION') {
        return res.status(400).json({
            success: false, code: 'VALIDATION',
            message: err.message, traceId: req.traceId
        });
    }
    if (err.code === 'NOT_FOUND') {
        return res.status(404).json({
            success: false, code: 'NOT_FOUND',
            message: err.message || '资源不存在', traceId: req.traceId
        });
    }
    if (err.code === 'FORBIDDEN') {
        return res.status(403).json({
            success: false, code: 'FORBIDDEN',
            message: err.message || '权限不足', traceId: req.traceId
        });
    }

    // 未知错误：生产环境只给通用消息，开发/测试环境带堆栈
    const status = err.status || 500;
    const isProd = process.env.NODE_ENV === 'production';
    return res.status(status).json({
        success: false,
        code: isProd ? 'INTERNAL_ERROR' : (err.code || 'INTERNAL_ERROR'),
        message: isProd ? '系统内部错误，请稍后重试' : err.message,
        traceId: req.traceId,
        stack: isProd ? undefined : err.stack
    });
}

// 未捕获异常：让进程继续活
process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', new Date().toISOString(), err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', new Date().toISOString(), reason && reason.message || reason);
});

module.exports = errorHandler;
