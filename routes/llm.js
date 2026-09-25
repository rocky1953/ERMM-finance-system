/**
 * LLM API Key 管理路由
 * GET  /api/llm/providers     列出服務商（Key 脫敏）
 * PUT  /api/llm/:provider     更新 Key / 模型 / 狀態（僅管理員）
 * POST /api/llm/test          連線測試（可用已存 Key 或彈窗中臨時輸入的 Key）
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const { requireAdmin } = require('../middleware/auth');
const { chatCompletion, maskKey, sanitizeKey, PROVIDERS } = require('../utils/llmClient');

// 列出全部服務商（API Key 脫敏）
router.get('/providers', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT provider, provider_name, api_key, base_url, model, status, updated_at FROM llm_config ORDER BY uid'
        );
        const list = rows.map(r => ({
            provider: r.provider,
            provider_name: r.provider_name,
            base_url: r.base_url,
            model: r.model,
            status: r.status,
            updated_at: r.updated_at,
            api_key_masked: maskKey(r.api_key),
            configured: !!r.api_key
        }));
        ok(res, list);
    } catch (err) { fail500(res, err); }
});

// 更新單一服務商設定（管理員）
router.put('/:provider', requireAdmin, async (req, res) => {
    try {
        const provider = String(req.params.provider || '').toLowerCase();
        if (!PROVIDERS[provider]) return fail(res, '不支援的 LLM 服務商');

        const { api_key, model, status } = req.body;
        const [exist] = await pool.execute(
            'SELECT uid, api_key FROM llm_config WHERE provider=?', [provider]
        );
        if (exist.length === 0) return fail(res, 'llm_config 無此服務商記錄，請先執行遷移腳本');

        // api_key 為空或含脫敏字串 **** 時視為不變更；否則淨化首尾空白與全形標點
        let newKey = exist[0].api_key;
        if (typeof api_key === 'string' && api_key.trim() && !api_key.includes('****')) {
            newKey = sanitizeKey(api_key);
            // 淨化後仍含非 ASCII（中文/全形字元出現在中間），拒絕儲存並明確提示
            if (/[^\x20-\x7E]/.test(newKey)) {
                return fail(res, 'API Key 含中文或全形符號，請重新複製貼上（勿包含「」、。等標點或空白）');
            }
        }
        const newModel = (model && String(model).trim()) || undefined;
        const newStatus = (status === 'USE' || status === 'NOUSE') ? status : undefined;
        const updater = (req.user && req.user.user_id) || null;

        await pool.execute(
            `UPDATE llm_config SET api_key=?,
                ${newModel ? 'model=?,' : ''}
                ${newStatus ? 'status=?,' : ''}
                updated_by=?
             WHERE uid=?`,
            [newKey, ...(newModel ? [newModel] : []), ...(newStatus ? [newStatus] : []), updater, exist[0].uid]
        );
        ok(res, { provider, configured: !!newKey }, '儲存成功');
    } catch (err) { fail500(res, err); }
});

// 連線測試
router.post('/test', async (req, res) => {
    try {
        const provider = String(req.body.provider || '').toLowerCase();
        if (!PROVIDERS[provider]) return fail(res, '不支援的 LLM 服務商');

        const [rows] = await pool.execute(
            'SELECT * FROM llm_config WHERE provider=?', [provider]
        );
        if (rows.length === 0) return fail(res, 'llm_config 無此服務商記錄');
        const cfg = rows[0];

        // 彈窗中臨時輸入的新 Key 優先（脫敏字串視為未輸入）；淨化首尾全形標點
        const tmpKey = sanitizeKey(req.body.api_key || '');
        const apiKey = (tmpKey && !tmpKey.includes('****')) ? tmpKey : sanitizeKey(cfg.api_key);
        if (!apiKey) return fail(res, '尚未設定 API Key，無法測試');

        const reply = await chatCompletion(
            { base_url: cfg.base_url, api_key: apiKey, model: (req.body.model || cfg.model) },
            [
                { role: 'system', content: '你是連線測試助手，只回覆「OK」兩個字。' },
                { role: 'user', content: 'ping' }
            ],
            { max_tokens: 100, timeout: 45000 }
        );
        ok(res, { provider, reply: reply.slice(0, 50) }, '連線成功');
    } catch (err) {
        fail(res, err.message || '連線失敗');
    }
});

module.exports = router;
