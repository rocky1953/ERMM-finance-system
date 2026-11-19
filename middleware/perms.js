/**
 * CTO-02 路由級權限注入助手
 *
 * 用法：在路由文件頂部加一行
 *   const { perms, readScope } = require('../middleware/perms');
 *
 *   router.post('/close', perms('closing','CLOSE'), async (req,res)=>{...})
 *   router.get('/list', readScope('budget'), async (req,res)=>{...})
 *
 * perms(module, op)    → [injectDataScope + requireButton] 寫操作防護
 * readScope(module)    → [injectDataScope] 讀操作加數據範圍
 * applyScope(sql, params, req) → 對已查詢的 SQL 追加 bu_no IN (...)
 *
 * module 碼對應 cams_permission_button.module_code：
 *   closing, expense, payRequest, fx, soCredit, workflow,
 *   codeTable, permission, poMatch, prRequest, projectProfit,
 *   hrEfficiency, boardPack, strategy, poGrn, arap, budget, action,
 *   inventoryTurnover, profit, mgmtAccounting
 *
 * button op 碼對應 cams_permission_button.button_code：
 *   CREATE, SUBMIT, APPROVE, REJECT, PAY, CLOSE, REOPEN,
 *   DELETE, LOCK, UNLOCK, EXPORT, OVERRIDE, CALCULATE, SYNC
 */
const auth = require('./auth');

const { requireButton, injectDataScope } = auth;

/**
 * 寫操作防護：先注入數據範圍，再攔按鈕權限
 * 返回 middleware 數組，直接當路由第二個參數用
 */
function perms(moduleCode, buttonCode) {
    return [injectDataScope(moduleCode), requireButton(moduleCode, buttonCode)];
}

/**
 * 讀操作：只注入數據範圍
 */
function readScope(moduleCode) {
    return [injectDataScope(moduleCode)];
}

module.exports = { perms, readScope, applyScope: auth.applyDataScope, injectDataScope, requireButton };
