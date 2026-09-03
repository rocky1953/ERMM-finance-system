/**
 * 統一 API 回應格式
 */
function ok(res, data, msg = '成功') {
    res.json({ success: true, message: msg, data });
}

function fail(res, message = '錯誤', code = 400) {
    res.status(code).json({ success: false, message });
}

function fail500(res, err) {
    console.error('SQL Error:', err);
    res.status(500).json({
        success: false,
        message: err.message || 'Internal Server Error'
    });
}

/**
 * 分頁參數解析
 */
function pagination(req) {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, parseInt(req.query.pageSize) || 20);
    return { page, pageSize, offset: (page - 1) * pageSize };
}

/**
 * 將 undefined 轉為 null (mysql2 需要)
 */
function n(v) {
    return v === undefined ? null : v;
}

/**
 * 將物件的值用 n() 全部清理
 */
function clean(obj) {
    return Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k, n(v)])
    );
}

module.exports = { ok, fail, fail500, pagination, n, clean };
