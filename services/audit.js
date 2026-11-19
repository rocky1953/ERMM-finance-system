/**
 * CTO-03 统一审计服务
 *
 * 设计原则（吸取经验）：
 *   1. **单一事实源** —— 所有写操作最终都写这一个 audit_event 表
 *   2. **不阻塞主链路** —— fire-and-forget，批量 flush（与 metrics 中间件同架构）
 *   3. **双轨并行** —— 业务路由显式调用 audit.log() 写详细信息；
 *      兜底中间件 middleware/audit.js 自动捕获未显式记录的写请求，只记 path+method
 *   4. **可开关** —— 读 audit_setting 表；关闭模块立即生效，无需重启
 *   5. **不关闭 pool** —— 本模块是 express 进程的生命周期服务，不能调用 pool.end()
 *
 * 用法（路由内）：
 *   const audit = require('../services/audit');
 *   await audit.log(req, {
 *       module: 'expense', action: 'CREATE',
 *       businessType: 'BX', businessId: report.report_no,
 *       summary: `新建报销单 ${report.report_no} ${report.title} ¥${report.total_amount}`,
 *       before: null, after: report
 *   });
 *
 *   // 也可以传纯函数，服务内部 await：
 *   audit.log(req, { ... });   // 不 await 也不会丢，fire-and-forget
 */
const { pool } = require('../config/db');

// ======= 批量缓冲（与 middleware/metrics.js 同策略） =======
const BUFFER_MS = 80;
const MAX_BUFFER = 150;
let buffer = [];
let flushTimer = null;

// ======= 审计开关缓存（60s 刷新一次，避免每次写请求都查询 setting 表） =======
let moduleEnabledCache = null;
let moduleCacheAt = 0;
const CACHE_TTL_MS = 60_000;

function ymd(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

async function loadModuleSettings(force = false) {
    const now = Date.now();
    if (!force && moduleEnabledCache && (now - moduleCacheAt) < CACHE_TTL_MS) return moduleEnabledCache;
    try {
        const [rows] = await pool.query('SELECT module, enabled, capture_detail FROM audit_setting');
        const m = {};
        for (const r of rows) m[r.module] = { enabled: !!r.enabled, capture_detail: !!r.capture_detail };
        moduleEnabledCache = m;
        moduleCacheAt = now;
        return m;
    } catch (e) {
        console.warn('[audit] load settings failed:', e.message);
        return {};
    }
}

function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        drainBuffer();
    }, BUFFER_MS);
}

async function drainBuffer() {
    if (buffer.length === 0) return;
    const rows = buffer.splice(0);
    try {
        const placeholders = rows.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
        const flat = rows.flat();
        await pool.query(
            `INSERT INTO audit_event (trace_id, module, action, business_type, business_id,
                summary, detail, user_id, user_name, bu_no, ip, user_agent,
                created_at, created_ymd) VALUES ${placeholders}`,
            flat
        );
    } catch (e) {
        // 只输出到 stderr，绝不抛到业务链路
        console.error('[audit] flush failed:', e.message, 'rows=', rows.length);
    }
}

// 进程退出前强制刷
process.on('beforeExit', () => { drainBuffer(); });
process.on('SIGINT', () => { drainBuffer(); process.exit(0); });

/** 构建审计行（不含 DB 写入） */
function buildRow(req, opts) {
    const now = new Date();
    const ua = req.headers['user-agent'] || '';
    const ip = (req.headers['x-forwarded-for'] || req.connection && req.connection.remoteAddress || '').split(',')[0].trim();
    const user = req.user || {};

    // detail 字段 JSON 化 + 敏感脱敏（CTO-03 基础版：金额字段替换为 ****）
    let detail = null;
    if (opts.detail !== undefined && opts.detail !== null) {
        try {
            detail = JSON.stringify(opts.detail);
        } catch (e) {
            detail = JSON.stringify({ error: 'detail-not-serializable', type: typeof opts.detail });
        }
    } else if (opts.before !== undefined || opts.after !== undefined) {
        const payload = {
            before: sanitize(opts.before),
            after: sanitize(opts.after),
            changed_fields: diffKeys(opts.before, opts.after)
        };
        try { detail = JSON.stringify(payload); } catch (e) { detail = null; }
    }

    return [
        (req.traceId || '').slice(0, 32) || null,
        String(opts.module || '').slice(0, 40) || null,
        String(opts.action || '').slice(0, 30) || null,
        String(opts.businessType || '').slice(0, 40) || null,
        opts.businessId != null ? String(opts.businessId).slice(0, 64) : null,
        opts.summary ? String(opts.summary).slice(0, 500) : null,
        detail,
        user.user_id ? String(user.user_id).slice(0, 64) : null,
        user.user_name ? String(user.user_name).slice(0, 64) : null,
        req.query && req.query.bu_no ? String(req.query.bu_no).slice(0, 5)
            : (req.body && req.body.bu_no ? String(req.body.bu_no).slice(0, 5) : null),
        ip.slice(0, 64) || null,
        ua.slice(0, 255) || null,
        now,
        ymd(now)
    ];
}

/** 敏感字段脱敏：金额/税额相关字段替换为 ****（CTO-03 剩余：前端展示时二次脱敏） */
const SENSITIVE_KEYS = new Set([
    'amount', 'amt', 'total', 'total_amount', 'amount_fx', 'amount_rmb', 'notional_fx',
    'tax', 'tax_amount', 'tax_rate', 'vat', 'withholding',
    'rate', 'price', 'unit_price', 'hedge_rate', 'rate_to_rmb',
    'balance', 'credit_limit', 'budget', 'budget_amount'
]);

function sanitize(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (SENSITIVE_KEYS.has(String(k).toLowerCase()) && typeof v === 'number') {
            out[k] = '****';
        } else if (v && typeof v === 'object' && !Array.isArray(v)) {
            out[k] = sanitize(v);
        } else {
            out[k] = v;
        }
    }
    return out;
}

/** 简单 diff：返回 before/after 的字段名交集 + 值变化 */
function diffKeys(before, after) {
    if (!before || !after) return null;
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const changed = [];
    for (const k of keys) {
        if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed.push(k);
    }
    return changed.slice(0, 30);  // 上限 30 个字段，避免过大
}

/**
 * 统一审计入口
 *
 * @param {object} req   Express 请求对象（用于取 user / traceId / ip / bu_no）
 * @param {object} opts
 *   - module         模块代码（必填）
 *   - action         CREATE / UPDATE / DELETE / SUBMIT / APPROVE / REJECT / LOCK / EXPORT / LOGIN 等
 *   - businessType   单据类型（可选，如 BX/JK/PK/PO）
 *   - businessId     单据 id 或单号（可选）
 *   - summary        一句话摘要（可选，中文）
 *   - detail         直接提供的 detail JSON 对象（优先于 before/after）
 *   - before / after 对象（自动 diff + 脱敏）
 *
 * 不抛异常；批量 flush 失败仅 stderr 输出。
 */
function log(req, opts) {
    // 先检查开关（异步加载，缓存 60s）
    loadModuleSettings().then((settings) => {
        const setting = settings[opts.module];
        if (setting && setting.enabled === false) return;  // 关闭则不写

        const row = buildRow(req, opts);
        buffer.push(row);

        if (buffer.length >= MAX_BUFFER) {
            clearTimeout(flushTimer);
            flushTimer = null;
            drainBuffer();
        } else {
            scheduleFlush();
        }
    }).catch(() => { /* load setting 失败时不阻塞审计写入 */ });
}

/** 兜底中间件用：纯 path-level 审计（无业务细节） */
function logBare(req, action, detailOverride) {
    const row = buildRow(req, {
        module: 'middleware',
        action: action.toUpperCase(),
        businessType: null,
        businessId: null,
        summary: `${req.method} ${req.path}`,
        detail: detailOverride || { path: req.path, method: req.method }
    });
    buffer.push(row);
    scheduleFlush();
}

module.exports = { log, logBare, flush: drainBuffer, reloadSettings: () => loadModuleSettings(true) };
