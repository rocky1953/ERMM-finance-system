/**
 * 码表内存缓存
 * 所有业务模块应通过此模块获取 cams_system_codes 数据，而非自行硬编码常量。
 *
 * 使用：
 *   const codeCache = require('../services/codeCache');
 *   const WK_TYPES = await codeCache.values('WK_TYPE', ['日常工作', ...]);
 *   const isMgr = await codeCache.includes('USER_ROLE', userType);   // 含 admin 已由调用方判断
 *
 * 缓存策略：首次调用读库，TTL=1 小时，写操作后可 invalidate 指定 type。
 */
const { pool } = require('../config/db');

const cache = {};         // { code_type: { list: [...], ts: Date.now() } }
const TTL_MS = 60 * 60 * 1000;

async function _load(code_type, fallback) {
    try {
        const [rows] = await pool.execute(
            `SELECT code_value, value_description, value_number1, value_number2, value_number3,
                    value_alpha1, value_alpha2, sort_order
               FROM cams_system_codes
              WHERE code_type=? AND (inuse_flag='USE' OR inuse_flag IS NULL OR inuse_flag='')
              ORDER BY COALESCE(sort_order, 0), code_value`,
            [code_type]
        );
        if (rows.length === 0) return fallback;
        return rows;
    } catch (e) {
        return fallback;
    }
}

function _valid(entry) {
    return entry && (Date.now() - entry.ts) < TTL_MS;
}

/** 原始对象数组 */
async function list(code_type, fallback = []) {
    const entry = cache[code_type];
    if (_valid(entry)) return entry.list;
    const rows = await _load(code_type, fallback);
    cache[code_type] = { list: rows, ts: Date.now() };
    return rows;
}

/** 仅 code_value 字符串数组 */
async function values(code_type, fallback = []) {
    const arr = await list(code_type, fallback.map(v => ({ code_value: v })));
    return arr.map(r => r.code_value);
}

/** code_type 下是否包含某值（大小写不敏感 trim 后比对） */
async function includes(code_type, value, fallbackArr = []) {
    if (!value) return false;
    const vals = await values(code_type, fallbackArr);
    const v = String(value).trim();
    return vals.some(x => String(x).trim() === v);
}

function invalidate(code_type) {
    if (code_type) delete cache[code_type];
    else Object.keys(cache).forEach(k => delete cache[k]);
}

module.exports = { list, values, includes, invalidate };
