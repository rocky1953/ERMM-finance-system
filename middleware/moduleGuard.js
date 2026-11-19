/**
 * 模組級 API 權限守門（與 cams_module_permission 矩陣對齊）
 *
 * 目的：前端導航隱藏只是體驗層，這裡在 API 層再擋一次，
 *       避免知道端點的人繞過前端直接呼叫無權限的模組。
 *
 * 判定順序：
 *   1. 測試環境（NODE_ENV=test）預設放行，可用 MODULE_GUARD_STRICT=1 強制開啟
 *   2. 未在 PREFIX_MODULE 中登記的前綴 → 僅要求登入（共用 / 內部 API）
 *   3. 管理員（cams_xuser.admin='Yes'）→ 全通過
 *   4. 依角色查 allow_general / allow_operator / allow_admin，未配置或為 0 → 403
 *
 * 快取：role:module → 60 秒，避免每個請求打一次 DB；
 *       管理員調整矩陣後最慢 60 秒生效（前端另有 30 秒節流的 /auth/me 同步）。
 */
const { pool } = require('../config/db');

const ROLE_COL = {
    admin: 'allow_admin',
    operator: 'allow_operator',
    general: 'allow_general'
};

// API 前綴（/api 之後的第一段）→ 模組代碼
// 未列出的前綴代表跨模組共用的 API，維持「登入即可用」
const PREFIX_MODULE = {
    system: 'system',
    arap: 'arap',
    invoice: 'invoice',
    cash: 'cash',
    bank: 'bank',
    pay: 'pay',
    check: 'check',
    summary: 'summary',
    report: 'report',
    risk: 'risk',
    forecast: 'forecast',
    po: 'po',
    so: 'so',
    'so-credit': 'salesCredit',
    profit: 'profitAnalysis',
    'rolling-budget': 'rollingBudget',
    'inventory-turnover': 'inventoryTurnover',
    'board-pack': 'boardPack',
    'project-profit': 'projectProfit',
    preorders: 'preorder',
    kpi: 'kpi',
    branch: 'branch',
    relation: 'relation',
    monthly: 'monthly',
    account: 'account',
    'batch-ctrl': 'batch',
    dn: 'dn',
    user: 'user',
    'temp-po': 'tempPo',
    xitems: 'xitems',
    benchmark: 'benchmark',
    bep: 'bep',
    action: 'actions',
    alert: 'alerts',
    analysis: 'drilldown',
    'cash-forecast': 'cashForecast',
    budget: 'budget',
    consolidation: 'consolidation',
    fx: 'fxExposure',
    closing: 'closing',
    'pr-request': 'prRequest',
    'po-grn': 'poMatch',
    'po-match': 'poMatch',
    receipt: 'arMatch',
    'ar-match': 'arMatch',
    permission: 'permission',
    contracts: 'contracts',
    'mgmt-accounting': 'mgmtAccounting',
    aiqa: 'aiqa',
    'ar-smart': 'arSmart',
    'data-quality': 'dataQuality',
    scenario: 'scenario',
    'llm-audit': 'llmAudit',
    'daily-report': 'dailyReport',
    finance: 'finance',
    integration: 'integration',
    tax: 'tax',
    'tax-planning': 'taxPlanning',
    'tax-compliance': 'taxCompliance',
    strategy: 'strategy',
    'cash-liquidity': 'cashLiquidity',
    investment: 'investment',
    'war-room': 'warRoom',
    expense: 'expense',
    'pay-request': 'payRequest',
    'hr-efficiency': 'hrEfficiency'
};

const TTL_MS = 60 * 1000;
const cache = new Map();   // `${role}:${module}` → { allow, ts }

async function moduleAllowed(role, moduleCode) {
    const key = `${role}:${moduleCode}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < TTL_MS) return hit.allow;

    const col = ROLE_COL[role] || 'allow_general';
    const [rows] = await pool.execute(
        `SELECT ${col} AS allowFlag FROM cams_module_permission WHERE module_code=? LIMIT 1`,
        [moduleCode]
    );
    const allow = !!(rows[0] && Number(rows[0].allowFlag) === 1);
    cache.set(key, { allow, ts: Date.now() });
    return allow;
}

function moduleGuard(req, res, next) {
    if (process.env.NODE_ENV === 'test' && process.env.MODULE_GUARD_STRICT !== '1') return next();

    const prefix = (req.path || '').split('/')[1] || '';
    const moduleCode = PREFIX_MODULE[prefix];
    if (!moduleCode) return next();               // 共用 / 內部 API，僅需登入

    if (!req.user) {
        return res.status(401).json({ success: false, code: 'NO_AUTH', message: '尚未登入' });
    }
    if (req.user.admin === 'Yes') return next();

    const role = req.user.role || 'general';
    moduleAllowed(role, moduleCode)
        .then(allow => {
            if (allow) return next();
            return res.status(403).json({
                success: false,
                code: 'MODULE_DENIED',
                module: moduleCode,
                message: '你的角色沒有此功能模組的存取權限'
            });
        })
        .catch(err => {
            res.status(500).json({ success: false, code: 'PERM_CHECK_ERR', message: err.message });
        });
}

module.exports = moduleGuard;
module.exports.PREFIX_MODULE = PREFIX_MODULE;
module.exports._clearCache = () => cache.clear();
