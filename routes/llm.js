/**
 * LLM API Key 管理路由（v2）
 *  - DB 為唯一真源；PROVIDERS 僅作為前端下拉預設模板
 *  - GET    /api/llm/providers        列出所有（key 脫敏）
 *  - POST   /api/llm/providers        新增一個服務商（任意 provider id，非硬編碼）
 *  - PUT    /api/llm/:provider         更新 key / model / status / is_default
 *  - DELETE /api/llm/:provider         刪除（預設 provider 不能刪，先設別家為預設）
 *  - POST   /api/llm/test              連線測試
 *  - POST   /api/llm/:provider/default 設為預設（其他全部 is_default=0）
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const { chatCompletion, maskKey, sanitizeKey, PROVIDERS } = require('../utils/llmClient');

// ======= 校驗函數 =======
function validateProviderId(id) {
    if (!id) return 'Provider ID 不可為空';
    if (typeof id !== 'string') return 'Provider ID 格式錯誤';
    const v = id.trim().toLowerCase();
    if (v.length < 2) return 'Provider ID 至少 2 個字元';
    if (v.length > 32) return 'Provider ID 最多 32 個字元';
    if (!/^[a-z][a-z0-9_-]+$/.test(v)) return 'Provider ID 只能是小寫字母、數字、底線、連字號，且以字母開頭';
    return null;
}

function validateBaseUrl(url) {
    if (!url) return 'Base URL 不可為空';
    const v = url.trim();
    if (!/^https?:\/\//.test(v)) return 'Base URL 必須以 http:// 或 https:// 開頭';
    try { new URL(v); } catch { return 'Base URL 不是合法的網址'; }
    return null;
}

function validateApiKey(key) {
    if (!key) return null;  // 空 Key 在新增時也可以接受（之後填）
    const v = String(key).trim();
    if (v.length < 8) return 'API Key 至少 8 個字元';
    if (v.length > 512) return 'API Key 過長（上限 512）';
    if (/[^\x20-\x7E]/.test(v)) return 'API Key 不可含中文、全形符號或控制字元';
    // 至少含一個字母 + 一個數字（或特殊字元）
    if (!/[A-Za-z]/.test(v)) return 'API Key 至少含一個字母';
    if (!/[0-9]/.test(v) && !/[!@#$%^&*_+=:./\-]/.test(v)) return 'API Key 至少含一個數字或符號';
    return null;
}

function validateModel(model) {
    if (!model) return null;
    const v = String(model).trim();
    if (v.length > 64) return 'Model 名稱過長（上限 64）';
    if (/[<>]/.test(v)) return 'Model 名稱不可含 < 或 >';
    return null;
}

function validateProviderName(name) {
    if (!name || !String(name).trim()) return '顯示名稱不可為空';
    if (String(name).trim().length > 64) return '顯示名稱最多 64 個字元';
    return null;
}

// ======= 內建服務商模板（供前端下拉）=======
// 前端新增時若 provider id 命中這裡，base_url / model 自動預填；
// 若未命中（如「豆包」「阿里百煉」自定義名），前端會讓使用者自行輸入
const BUILTIN_TEMPLATES = {
    openai:       { provider_name: 'OpenAI',         base_url: 'https://api.openai.com/v1',          model: 'gpt-4o-mini' },
    kimi:         { provider_name: 'Kimi (Moonshot)', base_url: 'https://api.moonshot.cn/v1',         model: 'kimi-k2.6' },
    deepseek:     { provider_name: 'DeepSeek',        base_url: 'https://api.deepseek.com/v1',        model: 'deepseek-chat' },
    doubao:       { provider_name: '豆包 (Volcengine)', base_url: 'https://ark.cn-beijing.volces.com/api/v3', model: 'ep-xxx' },
    aliyun:       { provider_name: '阿里百煉 (DashScope)', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    zhipu:        { provider_name: '智譜 AI (Zhipu)', base_url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    siliconflow:  { provider_name: 'SiliconFlow',     base_url: 'https://api.siliconflow.cn/v1',      model: 'Qwen/Qwen2.5-7B-Instruct' },
    ollama:       { provider_name: 'Ollama (本地)',    base_url: 'http://localhost:11434/v1',          model: 'llama3' },
};
// 合併舊 PROVIDERS，導出給前端模板用
const ALL_TEMPLATES = { ...BUILTIN_TEMPLATES, ...PROVIDERS };

// ======= 列出 =======
router.get('/providers', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT provider, provider_name, api_key, base_url, model, status, is_default, updated_at FROM llm_config ORDER BY is_default DESC, uid'
        );
        const list = rows.map(r => ({
            provider: r.provider,
            provider_name: r.provider_name,
            base_url: r.base_url,
            model: r.model,
            status: r.status,
            is_default: !!r.is_default,
            updated_at: r.updated_at,
            api_key_masked: maskKey(r.api_key),
            configured: !!r.api_key,
        }));
        ok(res, { list, templates: ALL_TEMPLATES });
    } catch (err) { fail500(res, err); }
});

// ======= 新增 =======
router.post('/providers', async (req, res) => {
    try {
        const { provider, provider_name, api_key, base_url, model } = req.body || {};

        // ===== 校驗 =====
        const pidErr = validateProviderId(provider);
        if (pidErr) return fail(res, pidErr);
        const nameErr = validateProviderName(provider_name);
        if (nameErr) return fail(res, nameErr);
        const urlErr  = validateBaseUrl(base_url || '');
        if (urlErr)  return fail(res, urlErr);
        const keyErr  = validateApiKey(api_key);
        if (keyErr)  return fail(res, keyErr);
        const modErr  = validateModel(model);
        if (modErr)  return fail(res, modErr);

        const [exist] = await pool.execute('SELECT uid FROM llm_config WHERE provider=?', [provider.trim().toLowerCase()]);
        if (exist.length) return fail(res, '此 provider 已存在，請改用更新');

        // 用模板預填 base_url / model
        const tpl = ALL_TEMPLATES[provider];
        const finalBase  = (base_url || (tpl && tpl.base_url) || '').trim();
        const finalModel = (model    || (tpl && tpl.model)    || '').trim();
        const finalKey   = sanitizeKey(api_key || '');
        if (finalKey && /[^\x20-\x7E]/.test(finalKey)) {
            return fail(res, 'API Key 含中文或全形符號');
        }

        await pool.execute(
            `INSERT INTO llm_config (provider, provider_name, api_key, base_url, model, status, is_default, updated_by)
             VALUES (?,?,?,?,?,?,?,?)`,
            [provider, provider_name, finalKey, finalBase, finalModel, 'USE', 0, (req.user && req.user.user_id) || null]
        );
        ok(res, { provider }, '新增成功');
    } catch (err) { fail500(res, err); }
});

// ======= 更新 =======
router.put('/:provider', async (req, res) => {
    try {
        const provider = String(req.params.provider || '').toLowerCase();
        const pidErr = validateProviderId(provider);
        if (pidErr) return fail(res, pidErr);

        const [exist] = await pool.execute('SELECT uid, api_key FROM llm_config WHERE provider=?', [provider]);
        if (exist.length === 0) return fail(res, 'llm_config 無此服務商記錄');

        const { api_key, model, status, base_url } = req.body;

        // ===== 校驗 =====
        let newKey = exist[0].api_key;
        if (typeof api_key === 'string' && api_key.trim()) {
            if (api_key.includes('****')) return fail(res, 'API Key 未變更，請輸入完整新 Key');
            const keyErr = validateApiKey(api_key);
            if (keyErr) return fail(res, keyErr);
            newKey = sanitizeKey(api_key);
        }
        const modErr = validateModel(model);
        if (modErr) return fail(res, modErr);
        if (typeof base_url === 'string' && base_url.trim()) {
            const urlErr = validateBaseUrl(base_url.trim());
            if (urlErr) return fail(res, urlErr);
        }
        if (status && !['USE', 'NOUSE'].includes(status)) return fail(res, 'status 只能是 USE 或 NOUSE');

        if (/[^\x20-\x7E]/.test(newKey)) {
            return fail(res, 'API Key 含中文或全形符號');
        }

        const sets = ['api_key=?', 'updated_by=?'];
        const args = [newKey, (req.user && req.user.user_id) || null];
        if (typeof model === 'string' && model.trim())    { sets.push('model=?');  args.push(model.trim()); }
        if (typeof base_url === 'string' && base_url.trim()) { sets.push('base_url=?'); args.push(base_url.trim()); }
        if (status === 'USE' || status === 'NOUSE')        { sets.push('status=?'); args.push(status); }
        args.push(exist[0].uid);

        await pool.execute(`UPDATE llm_config SET ${sets.join(',')} WHERE uid=?`, args);
        ok(res, { provider, configured: !!newKey }, '儲存成功');
    } catch (err) { fail500(res, err); }
});

// ======= 設為預設（其他全部 is_default=0）=======
router.post('/:provider/default', async (req, res) => {
    try {
        const provider = String(req.params.provider || '').toLowerCase();
        const pidErr = validateProviderId(provider);
        if (pidErr) return fail(res, pidErr);

        const [rows] = await pool.execute('SELECT uid, api_key, status FROM llm_config WHERE provider=?', [provider]);
        if (rows.length === 0) return fail(res, '無此服務商');
        const cfg = rows[0];
        if (!cfg.api_key) return fail(res, '此服務商尚未設定 API Key，不能設為預設');
        if (cfg.status === 'NOUSE') return fail(res, '此服務商狀態為 NOUSE，不能設為預設');

        await pool.execute('UPDATE llm_config SET is_default=0');
        await pool.execute('UPDATE llm_config SET is_default=1 WHERE provider=?', [provider]);
        ok(res, { provider }, '已設為預設');
    } catch (err) { fail500(res, err); }
});

// ======= 刪除 =======
router.delete('/:provider', async (req, res) => {
    try {
        const provider = String(req.params.provider || '').toLowerCase();
        const [exist] = await pool.execute('SELECT uid, is_default FROM llm_config WHERE provider=?', [provider]);
        if (exist.length === 0) return fail(res, '無此服務商');
        if (exist[0].is_default) return fail(res, '預設服務商不能刪，請先設別家為預設');
        await pool.execute('DELETE FROM llm_config WHERE provider=?', [provider]);
        ok(res, {}, '已刪除');
    } catch (err) { fail500(res, err); }
});

// ======= 連線測試 =======
router.post('/test', async (req, res) => {
    try {
        const provider = String(req.body.provider || '').toLowerCase();
        const [rows] = await pool.execute('SELECT * FROM llm_config WHERE provider=?', [provider]);
        if (rows.length === 0) return fail(res, 'llm_config 無此服務商記錄');
        const cfg = rows[0];

        // 彈窗中臨時輸入的新 Key 優先；淨化首尾全形標點
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
    } catch (err) { fail(res, err.message || '連線失敗'); }
});

module.exports = router;
