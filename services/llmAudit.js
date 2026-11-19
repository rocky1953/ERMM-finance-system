/**
 * CTO-09 AI 治理服務
 *
 * 功能：
 *   1. auditCall(chatResult, meta) — 記錄每次 LLM 呼叫到 ermm_ai_audit + ermm_ai_records
 *   2. calcCost(provider, model, prompt_tokens, completion_tokens) — 從 cams_ai_model_pricing 查價
 *   3. checkRateLimit(scope, key, tokenCount) — 檢查是否超配額（每日 token / 次數 / 成本）
 *   4. auditMiddleware(req, res, next) — Express middleware，自動把 user 信息寫入 res.locals.aiAudit
 */
const { pool } = require('../config/db');

/**
 * 計算一次 LLM 呼叫的成本（USD）
 * 找不到對應價格 → 回 0（安全值，避免 blocker）
 */
async function calcCost(provider, model, promptTokens, completionTokens) {
    try {
        const [rows] = await pool.execute(
            `SELECT input_cost_per_1k, output_cost_per_1k
             FROM cams_ai_model_pricing
             WHERE provider=? AND model=?`,
            [provider || '', model || '']
        );
        if (!rows.length) return 0;
        const p = rows[0];
        const inputCost = (Number(promptTokens) || 0) / 1000 * Number(p.input_cost_per_1k || 0);
        const outputCost = (Number(completionTokens) || 0) / 1000 * Number(p.output_cost_per_1k || 0);
        return Math.round((inputCost + outputCost) * 1000000) / 1000000; // 6 位小數
    } catch { return 0; }
}

/**
 * 檢查速率限制
 * @param {string} scope  'user' | 'bu' | 'global'
 * @param {string} key    xuser_id / bu_no / '*'
 * @param {object} usage  { tokens, calls, cost_usd } 本次預算
 * @returns {Promise<{allowed:boolean, reason?:string, current?:object, limit?:object}>}
 */
async function checkRateLimit(scope, key, usage = {}) {
    try {
        // 查限制配置
        const [rules] = await pool.execute(
            `SELECT * FROM cams_ai_rate_limit
             WHERE scope=? AND (scope_key=? OR scope_key='*') AND status='USE'
             ORDER BY CASE WHEN scope_key='*' THEN 1 ELSE 0 END, scope_key`,
            [scope, key]
        );

        // 今天已用多少
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayStr = todayStart.toISOString().slice(0, 19).replace('T', ' ');

        const [used] = await pool.execute(
            `SELECT COALESCE(SUM(total_tokens),0) as tokens,
                    COUNT(*) as calls,
                    COALESCE(SUM(cost_usd),0) as cost
             FROM ermm_ai_audit
             WHERE ${scope === 'user' ? 'xuser_id' : 'bu_no'}=?
               AND created_at >= ?`,
            [key, todayStr]
        );

        for (const rule of rules) {
            const curTokens = Number(used[0].tokens) + (usage.tokens || 0);
            const curCalls = Number(used[0].calls) + 1;
            const curCost  = Number(used[0].cost) + (usage.cost_usd || 0);

            if (rule.daily_token_limit && curTokens > rule.daily_token_limit) {
                return { allowed: false, reason: '今日 token 配額已用完', limit: rule };
            }
            if (rule.daily_call_limit && curCalls > rule.daily_call_limit) {
                return { allowed: false, reason: '今日呼叫次數已用完', limit: rule };
            }
            if (rule.cost_limit_usd && curCost > rule.cost_limit_usd) {
                return { allowed: false, reason: '今日成本上限已用完', limit: rule };
            }
        }
        return { allowed: true, current: used[0] };
    } catch (e) {
        // 出錯時放行（fail-open，不擋正常業務）
        return { allowed: true };
    }
}

/**
 * 記錄一次 LLM 呼叫（寫 ermm_ai_audit + ermm_ai_records）
 * @param {object} data  {
 *   bu_no, xuser_id, xuser_name, conversation_id,
 *   provider, model, endpoint, system_prompt, user_prompt, assistant_reply,
 *   prompt_tokens, completion_tokens, total_tokens,
 *   latency_ms, cost_usd, status, error_msg, ip_address
 * }
 */
async function auditCall(data) {
    // 先算成本（若未提供）
    let cost = Number(data.cost_usd) || 0;
    if (!cost && data.provider && data.model) {
        cost = await calcCost(data.provider, data.model, data.prompt_tokens, data.completion_tokens);
    }

    const safe = (s, max) => {
        if (!s) return '';
        const str = String(s);
        return str.length > max ? str.slice(0, max) + '...[truncated]' : str;
    };

    try {
        // 寫主要審計表
        await pool.execute(
            `INSERT INTO ermm_ai_audit
                (bu_no, xuser_id, xuser_name, conversation_id,
                 provider, model, endpoint, system_prompt, user_prompt, assistant_reply,
                 prompt_tokens, completion_tokens, total_tokens,
                 latency_ms, cost_usd, status, error_msg, ip_address)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
                data.bu_no || '',
                data.xuser_id || '',
                data.xuser_name || '',
                data.conversation_id || null,
                data.provider || '',
                data.model || '',
                data.endpoint || 'unknown',
                safe(data.system_prompt, 2000),
                safe(data.user_prompt, 2000),
                safe(data.assistant_reply, 8000),
                data.prompt_tokens || 0,
                data.completion_tokens || 0,
                data.total_tokens || 0,
                data.latency_ms || 0,
                cost,
                data.status || 'SUCCESS',
                data.error_msg ? safe(data.error_msg, 500) : null,
                data.ip_address || null,
            ]
        );

        // 同步寫舊表（向後兼容）
        try {
            await pool.execute(
                `INSERT INTO ermm_ai_records
                    (bu_no, xuser_id, xuser_name, ai_records, remark,
                     provider, model, total_tokens, latency_ms, cost_usd, status)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
                [
                    data.bu_no || '',
                    data.xuser_id || '',
                    data.xuser_name || '',
                    JSON.stringify({
                        question: data.user_prompt ? safe(data.user_prompt, 500) : '',
                        answer: data.assistant_reply ? safe(data.assistant_reply, 2000) : '',
                    }),
                    `${data.provider}/${data.model}`,
                    data.provider || null,
                    data.model || null,
                    data.total_tokens || 0,
                    data.latency_ms || 0,
                    cost,
                    data.status || 'SUCCESS',
                ]
            );
        } catch { /* 舊表可能缺欄位，忽略 */ }

        return true;
    } catch (e) {
        console.error('[llmAudit] auditCall failed:', e.message);
        return false;
    }
}

/**
 * Express middleware：把當前用戶信息塞進 res.locals.aiCtx
 * 讓下游 route handler 在 chatCompletion 之後調用 auditCall
 */
function auditMiddleware(req, res, next) {
    res.locals.aiCtx = {
        bu_no: req.user?.bu_no || req.user?.client_id || '',
        xuser_id: req.user?.user_id || '',
        xuser_name: req.user?.xuser_name || req.user?.user_id || '',
        ip_address: req.ip || req.connection?.remoteAddress || null,
    };
    next();
}

module.exports = {
    calcCost,
    checkRateLimit,
    auditCall,
    auditMiddleware,
};
