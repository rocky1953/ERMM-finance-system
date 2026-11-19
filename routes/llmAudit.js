/**
 * CTO-09 AI 治理 — 管理後台 API
 *
 * 注意：所有靜態路徑必須在參數路徑 /:uid 之前，否則 Express 會把 "limits"/"pricing" 當 uid
 *
 * 端點：
 *   GET    /api/llm-audit/list      — 審計列表（篩選 + 分頁）
 *   GET    /api/llm-audit/stats     — 統計卡片 + 趨勢圖
 *   GET    /api/llm-audit/cost      — 成本分析（按 provider/model/bu）
 *   GET    /api/llm-audit/users     — 用戶排行榜（TOP 20）
 *   GET    /api/llm-audit/limits    — 速率限制配置
 *   PUT    /api/llm-audit/limits/:uid  — 更新限制
 *   GET    /api/llm-audit/pricing   — 模型計價表
 *   PUT    /api/llm-audit/pricing/:uid — 更新計價
 *   GET    /api/llm-audit/:uid      — 單條審計詳情
 *   DELETE /api/llm-audit/:uid      — 清理（只限 admin）
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const { perms, readScope } = require('../middleware/perms');

// ============ 列表 ============
router.get('/list', readScope('llmAudit'), async (req, res) => {
    try {
        const { page = 1, limit = 50, bu_no, xuser_id, provider, model, status,
                date_from, date_to, endpoint, q } = req.query;
        const L = Math.min(Math.max(Number(limit) || 50, 1), 200);
        const OFF = (Math.max(Number(page) || 1, 1) - 1) * L;

        let sql = `FROM ermm_ai_audit WHERE 1=1`;
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no.toUpperCase()); }
        if (xuser_id) { sql += ' AND xuser_id LIKE ?'; params.push(`%${xuser_id}%`); }
        if (provider) { sql += ' AND provider=?'; params.push(provider.toLowerCase()); }
        if (model) { sql += ' AND model LIKE ?'; params.push(`%${model}%`); }
        if (status) { sql += ' AND status=?'; params.push(status); }
        if (endpoint) { sql += ' AND endpoint=?'; params.push(endpoint); }
        if (date_from) { sql += ' AND created_at >= ?'; params.push(date_from); }
        if (date_to) { sql += ' AND created_at <= ?'; params.push(date_to + ' 23:59:59'); }
        if (q) {
            sql += ' AND (user_prompt LIKE ? OR assistant_reply LIKE ? OR error_msg LIKE ?)';
            params.push(`%${q}%`, `%${q}%`, `%${q}%`);
        }

        const [[cnt]] = await pool.execute(`SELECT COUNT(*) total ${sql}`, params);
        const [rows] = await pool.execute(
            `SELECT uid, bu_no, xuser_id, xuser_name, conversation_id,
                    provider, model, endpoint, status,
                    prompt_tokens, completion_tokens, total_tokens,
                    latency_ms, cost_usd, created_at
             ${sql} ORDER BY created_at DESC LIMIT ${L} OFFSET ${OFF}`,
            params
        );
        ok(res, { rows, total: cnt.total, page: Number(page), limit: L });
    } catch (err) { fail500(res, err); }
});

// ============ 統計 ============
router.get('/stats', readScope('llmAudit'), async (req, res) => {
    try {
        const { date_from, date_to, bu_no } = req.query;
        let dateSql = '1=1', params = [];
        if (date_from) { dateSql += ' AND created_at >= ?'; params.push(date_from); }
        if (date_to)   { dateSql += ' AND created_at <= ?'; params.push(date_to + ' 23:59:59'); }
        if (bu_no)     { dateSql += ' AND bu_no=?'; params.push(bu_no.toUpperCase()); }

        const [cards] = await pool.execute(`
            SELECT COUNT(*) as total_calls,
                   SUM(CASE WHEN status='SUCCESS' THEN 1 ELSE 0 END) as success_calls,
                   SUM(CASE WHEN status='FAIL'   THEN 1 ELSE 0 END) as fail_calls,
                   SUM(CASE WHEN status='TIMEOUT' THEN 1 ELSE 0 END) as timeout_calls,
                   COALESCE(SUM(prompt_tokens),0) as prompt_tokens,
                   COALESCE(SUM(completion_tokens),0) as completion_tokens,
                   COALESCE(SUM(total_tokens),0) as total_tokens,
                   COALESCE(SUM(cost_usd),0) as total_cost_usd,
                   COALESCE(AVG(latency_ms),0) as avg_latency_ms,
                   COALESCE(MAX(latency_ms),0) as max_latency_ms,
                   COUNT(DISTINCT xuser_id) as unique_users,
                   COUNT(DISTINCT provider) as providers_used
            FROM ermm_ai_audit WHERE ${dateSql}
        `, params);

        const [trend] = await pool.execute(`
            SELECT DATE(created_at) as day,
                   COUNT(*) as calls,
                   COALESCE(SUM(total_tokens),0) as tokens,
                   COALESCE(SUM(cost_usd),0) as cost,
                   COALESCE(AVG(latency_ms),0) as avg_lat
            FROM ermm_ai_audit WHERE ${dateSql}
            GROUP BY DATE(created_at) ORDER BY day DESC LIMIT 30
        `, params);

        const [comparison] = await pool.execute(`
            SELECT
              COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                               THEN cost_usd ELSE 0 END),0) as cost_last7d,
              COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
                                 AND created_at <  DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                               THEN cost_usd ELSE 0 END),0) as cost_prev7d,
              COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                               THEN total_tokens ELSE 0 END),0) as tokens_last7d,
              COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
                                 AND created_at <  DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                               THEN total_tokens ELSE 0 END),0) as tokens_prev7d
            FROM ermm_ai_audit WHERE ${dateSql}
        `, params);

        ok(res, { cards: cards[0], trend, comparison: comparison[0] });
    } catch (err) { fail500(res, err); }
});

// ============ 成本分析 ============
router.get('/cost', readScope('llmAudit'), async (req, res) => {
    try {
        const { group_by = 'provider', date_from, date_to, bu_no } = req.query;
        const validGroups = ['provider', 'model', 'bu_no', 'xuser_id'];
        const gb = validGroups.includes(group_by) ? group_by : 'provider';

        let dateSql = '1=1', params = [];
        if (date_from) { dateSql += ' AND created_at >= ?'; params.push(date_from); }
        if (date_to)   { dateSql += ' AND created_at <= ?'; params.push(date_to + ' 23:59:59'); }
        if (bu_no)     { dateSql += ' AND bu_no=?'; params.push(bu_no.toUpperCase()); }

        const [rows] = await pool.execute(`
            SELECT ${gb} as dim,
                   COUNT(*) as calls,
                   COALESCE(SUM(total_tokens),0) as tokens,
                   COALESCE(SUM(cost_usd),0) as cost_usd,
                   COALESCE(AVG(latency_ms),0) as avg_latency
            FROM ermm_ai_audit WHERE ${dateSql}
            GROUP BY ${gb} ORDER BY cost_usd DESC LIMIT 20
        `, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ============ 用戶排行榜 ============
router.get('/users', readScope('llmAudit'), async (req, res) => {
    try {
        const { date_from, date_to, bu_no, limit = 20 } = req.query;
        const L = Math.min(Number(limit) || 20, 100);

        let dateSql = '1=1', params = [];
        if (date_from) { dateSql += ' AND created_at >= ?'; params.push(date_from); }
        if (date_to)   { dateSql += ' AND created_at <= ?'; params.push(date_to + ' 23:59:59'); }
        if (bu_no)     { dateSql += ' AND bu_no=?'; params.push(bu_no.toUpperCase()); }

        const [rows] = await pool.execute(`
            SELECT xuser_id,
                   MAX(xuser_name) as xuser_name,
                   MAX(bu_no) as bu_no,
                   COUNT(*) as calls,
                   COALESCE(SUM(total_tokens),0) as tokens,
                   COALESCE(SUM(cost_usd),0) as cost_usd,
                   COALESCE(AVG(latency_ms),0) as avg_latency,
                   MAX(created_at) as last_call
            FROM ermm_ai_audit WHERE ${dateSql}
            GROUP BY xuser_id ORDER BY cost_usd DESC LIMIT ${L}
        `, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ============ 速率限制配置（靜態路徑在 :uid 之前）============
router.get('/limits', readScope('llmAudit'), async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT * FROM cams_ai_rate_limit ORDER BY scope, scope_key'
        );
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.put('/limits/:uid', perms('llmAudit', 'CONFIG'), async (req, res) => {
    try {
        const { daily_token_limit, daily_call_limit, cost_limit_usd, status } = req.body;
        const sets = [], args = [];
        if (daily_token_limit != null) { sets.push('daily_token_limit=?'); args.push(daily_token_limit); }
        if (daily_call_limit  != null) { sets.push('daily_call_limit=?');  args.push(daily_call_limit); }
        if (cost_limit_usd    != null) { sets.push('cost_limit_usd=?');    args.push(cost_limit_usd); }
        if (status && ['USE','NOUSE'].includes(status)) { sets.push('status=?'); args.push(status); }
        if (!sets.length) return fail(res, '無更新欄位');
        args.push(req.params.uid);
        const [r] = await pool.execute(
            `UPDATE cams_ai_rate_limit SET ${sets.join(',')} WHERE uid=?`, args
        );
        ok(res, { affected: r.affectedRows });
    } catch (err) { fail500(res, err); }
});

// ============ 模型計價（靜態路徑在 :uid 之前）============
router.get('/pricing', readScope('llmAudit'), async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT * FROM cams_ai_model_pricing ORDER BY provider, model'
        );
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.put('/pricing/:uid', perms('llmAudit', 'CONFIG'), async (req, res) => {
    try {
        const { input_cost_per_1k, output_cost_per_1k } = req.body;
        const sets = [], args = [];
        if (input_cost_per_1k  != null) { sets.push('input_cost_per_1k=?');  args.push(input_cost_per_1k); }
        if (output_cost_per_1k != null) { sets.push('output_cost_per_1k=?'); args.push(output_cost_per_1k); }
        if (!sets.length) return fail(res, '無更新欄位');
        args.push(req.params.uid);
        const [r] = await pool.execute(
            `UPDATE cams_ai_model_pricing SET ${sets.join(',')} WHERE uid=?`, args
        );
        ok(res, { affected: r.affectedRows });
    } catch (err) { fail500(res, err); }
});

// ============ 審計詳情 + 清理（參數路徑放最後）============
router.get('/:uid', readScope('llmAudit'), async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT * FROM ermm_ai_audit WHERE uid=?', [req.params.uid]
        );
        if (!rows.length) return fail(res, '記錄不存在', 404);
        ok(res, rows[0]);
    } catch (err) { fail500(res, err); }
});

router.delete('/:uid', perms('llmAudit', 'CONFIG'), async (req, res) => {
    try {
        const [r] = await pool.execute('DELETE FROM ermm_ai_audit WHERE uid=?', [req.params.uid]);
        ok(res, { affected: r.affectedRows }, '已清理');
    } catch (err) { fail500(res, err); }
});

module.exports = router;
