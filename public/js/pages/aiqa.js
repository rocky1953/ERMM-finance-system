/**
 * AI 問答頁面
 * 自然語言財務查詢助手
 */
registerPage('aiqa', async (c) => {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h2 style="margin:0;font-size:20px;">🤖 AI 財務問答 <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">用自然語言查詢財務數據</small></h2>
            <div>
                <select id="aiBu" onchange="" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                    <option value="HM">HM</option><option value="SZ">SZ</option><option value="HN">HN</option>
                </select>
                <input type="month" id="aiMonth" style="padding:7px;border:1px solid #ddd;border-radius:6px;margin-left:6px;" title="查詢月份">
            </div>
        </div>
        <div class="card" style="background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;">
            <div style="display:flex;gap:10px;">
                <input type="text" id="aiInput" placeholder="輸入您的財務問題，例如：本月毛利率是多少？" style="flex:1;padding:12px 16px;border:none;border-radius:10px;font-size:14px;" onkeydown="if(event.key==='Enter')AIQA.ask()">
                <button class="btn btn-success" onclick="AIQA.ask()" style="padding:12px 24px;">查詢</button>
            </div>
            <div id="aiSuggest" style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;"></div>
        </div>
        <div class="card" style="margin-top:16px;min-height:300px;">
            <div class="card-title">對話紀錄</div>
            <div id="aiChat" style="max-height:500px;overflow-y:auto;">
                <div style="text-align:center;color:#95a5a6;padding:40px;">
                    <div style="font-size:3em;margin-bottom:10px;">💬</div>
                    <div>您好！我是 ERMM 財務 AI 助手，請輸入問題或點擊下方建議問題</div>
                </div>
            </div>
        </div>
    `;
    document.getElementById('aiBu').value = State.bu_no;
    const defMonth = State.YYYY_MM ? State.YYYY_MM.replace('/', '-') : '2025-07';
    document.getElementById('aiMonth').value = defMonth;
    loadSuggestions();
});

async function loadSuggestions() {
    try {
        const res = await API.get('/api/aiqa/suggestions');
        const el = document.getElementById('aiSuggest');
        el.innerHTML = (res.data || []).map(s =>
            `<span style="background:rgba(255,255,255,0.2);padding:5px 12px;border-radius:15px;font-size:12px;cursor:pointer;" onclick="document.getElementById('aiInput').value='${s}';AIQA.ask()">${s}</span>`
        ).join('');
    } catch (e) { /* ignore */ }
}

const AIQA = {
    async ask() {
        const input = document.getElementById('aiInput');
        const q = input.value.trim();
        if (!q) return;
        const bu = document.getElementById('aiBu').value;
        // 讀取月份並標準化為 YYYY/MM 格式
        const mRaw = document.getElementById('aiMonth').value;
        let mm = null;
        if (mRaw) {
            // 支援 YYYY-MM, YYYY/MM, YYYYMM 三種格式
            const m = mRaw.match(/^(\d{4})[-/]?(\d{1,2})/);
            if (m) mm = `${m[1]}/${m[2].padStart(2, '0')}`;
        }
        State.bu_no = bu;

        const chat = document.getElementById('aiChat');
        // 使用者訊息
        chat.innerHTML += `<div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
            <div style="background:#2563eb;color:#fff;padding:10px 14px;border-radius:12px 12px 2px 12px;max-width:70%;">${q}</div>
        </div>`;
        input.value = '';
        chat.scrollTop = chat.scrollHeight;

        // AI 回覆
        try {
            const res = await API.post('/api/aiqa/ask', { question: q, bu_no: bu, YYYY_MM: mm });
            const a = res.data;
            const color = a.metric && (a.metric.includes('margin') || a.metric.includes('ratio') || a.metric.includes('roe')) ? '#2563eb' : '#667eea';
            chat.innerHTML += `<div style="display:flex;margin-bottom:12px;">
                <div style="background:#f1f5f9;padding:12px 16px;border-radius:12px 12px 12px 2px;max-width:80%;">
                    <div style="font-size:15px;font-weight:700;margin-bottom:8px;color:${color};">📊 ${a.answer}</div>
                    ${a.detail ? `<div style="font-size:13px;color:#555;margin-bottom:8px;line-height:1.6;">${a.detail}</div>` : ''}
                    ${a.suggestion ? `<div style="font-size:12px;color:#2980b9;background:#eaf2f8;padding:6px 10px;border-radius:6px;">💡 ${a.suggestion}</div>` : ''}
                </div>
            </div>`;
        } catch (e) {
            chat.innerHTML += `<div style="display:flex;margin-bottom:12px;">
                <div style="background:#fef2f2;color:#e74c3c;padding:12px 16px;border-radius:12px;">❌ ${e.message}</div>
            </div>`;
        }
        chat.scrollTop = chat.scrollHeight;
    }
};
