/**
 * LLM 客戶端工具
 * Kimi(Moonshot) / DeepSeek 皆相容 OpenAI Chat Completions 協議，
 * 只需切換 base_url / model / api_key 即可，核心呼叫邏輯共用。
 * Node 18+ 內建全域 fetch。
 */

// 服務商預設值（資料庫 llm_config 為準，這裡作為 fallback）
const PROVIDERS = {
    kimi: {
        provider_name: 'Kimi (Moonshot)',
        base_url: 'https://api.moonshot.cn/v1',
        model: 'kimi-k2.6'
    },
    deepseek: {
        provider_name: 'DeepSeek',
        base_url: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat'
    }
};

/**
 * 淨化 API Key：移除首尾空白與常見誤貼的全形標點
 * （複製密鑰時常連同「」、。、（）等中文標點一起貼入，會導致 HTTP 標頭 ByteString 錯誤）
 */
function sanitizeKey(key) {
    return String(key || '')
        .trim()
        .replace(/^[\s"'「」『』（）()【】\[\]，,。.、；;：:]+/, '')
        .replace(/[\s"'「」『』（）()【】\[\]，,。.、；;：:]+$/, '');
}

/**
 * 呼叫 OpenAI 相容的 /chat/completions
 * @param {Object} cfg { base_url, api_key, model }
 * @param {Array} messages [{role:'system'|'user'|'assistant', content}]
 * @param {Object} opts { temperature, timeout }
 * @returns {Promise<string>} 模型回覆文字
 */
async function chatCompletion(cfg, messages, opts = {}) {
    const cleanKey = sanitizeKey(cfg.api_key);
    if (!cleanKey) throw new Error('LLM_API_KEY_MISSING');
    // HTTP 標頭只接受 Latin-1，Key 含中文/全形字元時提前給出可讀錯誤
    if (/[^\x20-\x7E]/.test(cleanKey)) {
        throw new Error('API Key 含中文或全形符號，請重新複製貼上（勿包含「」、。等標點）');
    }

    const temperatures = [opts.temperature != null ? opts.temperature : 0.3];
    let lastErr;
    for (let attempt = 0; attempt < temperatures.length + 1; attempt++) {
        const temperature = temperatures[attempt];
        try {
            return await doRequest(cfg, messages, cleanKey, temperature, opts);
        } catch (e) {
            lastErr = e;
            // Kimi K2 系列僅允許 temperature=1；自動以 1 重試一次（其餘錯誤直接拋出）
            if (attempt === 0 && /invalid temperature/i.test(e.message)) {
                temperatures.push(1);
                continue;
            }
            throw e;
        }
    }
    throw lastErr;
}

// 單次 HTTP 請求
async function doRequest(cfg, messages, cleanKey, temperature, opts = {}) {
    const timeout = opts.timeout || 60000;
    const base = String(cfg.base_url || '').replace(/\/+$/, '');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let resp;
    try {
        resp = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cleanKey}`
            },
            body: JSON.stringify({
                model: cfg.model,
                messages,
                temperature,
                max_tokens: opts.max_tokens || 1024
            }),
            signal: ctrl.signal
        });
    } catch (e) {
        if (e.name === 'AbortError') throw new Error('LLM 服務請求逾時（60 秒），請稍後重試');
        throw new Error(`無法連接 LLM 服務：${e.message}`);
    } finally {
        clearTimeout(timer);
    }

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        const msg = (data.error && (data.error.message || data.error.type)) || `HTTP ${resp.status}`;
        throw new Error(`LLM 回應錯誤：${msg}`);
    }
    const choice = data.choices && data.choices[0] && data.choices[0].message;
    let content = choice && choice.content;
    // 思考型模型可能只回 reasoning_content，兜底取用
    if (!content && choice && choice.reasoning_content) content = choice.reasoning_content;
    if (!content) throw new Error('LLM 未回傳有效內容');
    return String(content).trim();
}

// API Key 脫敏：sk-abc...wxyz → sk-****wxyz
function maskKey(key) {
    const k = String(key || '');
    if (!k) return '';
    if (k.length <= 8) return '****';
    return `${k.slice(0, 3)}****${k.slice(-4)}`;
}

module.exports = { PROVIDERS, chatCompletion, maskKey, sanitizeKey };
