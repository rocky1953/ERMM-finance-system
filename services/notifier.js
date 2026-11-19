/**
 * CTO-07 統一消息通知服務
 *
 * 統一發送出口：不管是 KPI 觸發、審計告警、還是業務事件，
 * 都調 notifier.send({ event_type, event_cat, title, body, level, bu_no, data })
 * 內部自動匹配 cams_notif_subscription 規則 → 查渠道 → 發送。
 *
 * 渠道支持：
 *   - EMAIL  (nodemailer，已裝)
 *   - LARK_WEBHOOK / WXWORK_WEBHOOK (HTTP POST，Node 內置 fetch)
 *
 * 設計：
 *   1. send() 是異步不阻塞主鏈路（fire-and-forget）
 *   2. 先寫 alert_log 隊列（notify_status=PENDING），再異步發送
 *   3. 發送後更新 alert_log（notify_status=SENT/FAILED）
 *   4. 每個渠道獨立 try/catch，一個渠道失敗不影響其他
 */
const { pool } = require('../config/db');

// Node 18+ 內置 fetch，不需要 axios
const fetchImpl = typeof fetch !== 'undefined' ? fetch : null;

// ================ 配置讀取 ================

async function loadChannel(channelCode) {
    const [rows] = await pool.execute(
        'SELECT * FROM cams_notif_channel WHERE channel_code=? AND inuse_flag=1',
        [channelCode]
    );
    if (!rows[0]) return null;
    const ch = rows[0];
    try { ch.config = typeof ch.config === 'string' ? JSON.parse(ch.config) : ch.config; } catch {}
    return ch;
}

async function matchSubscriptions(event) {
    // event = { event_type, event_cat, bu_no, role_filter? }
    // 返回匹配的 channel_code 列表（去重 + 按 priority 排序）
    const [rows] = await pool.execute(
        `SELECT s.channel_code, s.priority, c.*
         FROM cams_notif_subscription s
         JOIN cams_notif_channel c ON c.channel_code=s.channel_code AND c.inuse_flag=1
         WHERE s.inuse_flag=1
           AND (s.event_type=? OR s.event_type='*')
           AND (s.event_cat=?   OR s.event_cat='*')
           AND (s.bu_no=?       OR s.bu_no='*')
         ORDER BY s.priority ASC`,
        [event.event_type, event.event_cat || '*', event.bu_no || '*']
    );
    // 去重
    const seen = new Set();
    const out = [];
    for (const r of rows) {
        if (!seen.has(r.channel_code)) {
            seen.add(r.channel_code);
            try { r.config = typeof r.config === 'string' ? JSON.parse(r.config) : r.config; } catch {}
            out.push(r);
        }
    }
    return out;
}

// ================ 發送實現 ================

async function sendEmail(ch, title, body, toEmails) {
    const cfg = ch.config || {};
    if (!cfg.host || !cfg.user || !cfg.pass) {
        throw new Error(`Email 渠道 ${ch.channel_code} 未配置 SMTP`);
    }
    // nodemailer 已裝
    let nodemailer;
    try { nodemailer = require('nodemailer'); } catch { throw new Error('nodemailer 未安裝'); }

    const transporter = nodemailer.createTransport({
        host: cfg.host, port: Number(cfg.port) || 587, secure: Number(cfg.secure) === 1,
        auth: { user: cfg.user, pass: cfg.pass },
    });
    await transporter.sendMail({
        from: cfg.from || cfg.user,
        to: (toEmails || []).join(','),
        subject: title,
        text: body,
    });
}

async function sendLarkWebhook(ch, title, body) {
    const cfg = ch.config || {};
    if (!cfg.webhook_url) throw new Error(`Lark 渠道 ${ch.channel_code} 未配置 webhook_url`);
    if (!fetchImpl) throw new Error('Node 版本不支持 fetch');

    const payload = {
        msg_type: 'interactive',
        card: {
            header: { title: { tag: 'plain_text', content: title }, template: 'red' },
            elements: [{
                tag: 'div', text: { tag: 'plain_text', content: body }
            }, {
                tag: 'note', elements: [{ tag: 'plain_text', content: 'ERMM 財務監控系統自動警報' }]
            }]
        }
    };

    const resp = await fetchImpl(cfg.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`Lark webhook HTTP ${resp.status}: ${t.substring(0, 200)}`);
    }
}

async function sendWxWorkWebhook(ch, title, body) {
    const cfg = ch.config || {};
    if (!cfg.webhook_url) throw new Error(`WxWork 渠道 ${ch.channel_code} 未配置 webhook_url`);
    if (!fetchImpl) throw new Error('Node 版本不支持 fetch');

    const payload = {
        msgtype: 'markdown',
        markdown: { content: `### ${title}\n\n${body}\n\n> ERMM 財務監控系統自動警報` }
    };

    const resp = await fetchImpl(cfg.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`WxWork webhook HTTP ${resp.status}: ${t.substring(0, 200)}`);
    }
}

async function sendViaChannel(ch, title, body, extra = {}) {
    const ct = (ch.channel_type || '').toLowerCase();
    const cc = (ch.channel_code || '').toUpperCase();

    // 根據 channel_type 或 channel_code 前綴決定發送方式
    if (ct === 'email' || cc.startsWith('EMAIL')) {
        return await sendEmail(ch, title, body, extra.toEmails || []);
    } else if (cc.startsWith('LARK') || cc.includes('LARK') || cc.includes('FEISHU')) {
        return await sendLarkWebhook(ch, title, body);
    } else if (cc.startsWith('WXWORK') || cc.includes('WXWORK') || cc.includes('WECOM')) {
        return await sendWxWorkWebhook(ch, title, body);
    } else if (ct === 'webhook') {
        // 通用 webhook — 先嘗試 Lark 格式，不行再 WxWork 格式
        try { return await sendLarkWebhook(ch, title, body); } catch { /* fallthrough */ }
        return await sendWxWorkWebhook(ch, title, body);
    }
    throw new Error(`未知渠道: ${ch.channel_code} (type=${ct})`);
}

// ================ 主入口 ================

/**
 * 統一發送入口
 * @param {object} event
 *   - event_type: 'ALERT' | 'KPI_TRIGGER' | 'AUDIT' | 'SYSTEM' | 'CUSTOM'
 *   - event_cat:  如 'FINANCE' | 'DAILY_REPORT' | 'CRITICAL'
 *   - title:      標題（email subject / Lark header）
 *   - body:       正文
 *   - level:      'HIGH' | 'MEDIUM' | 'LOW'
 *   - bu_no:      公司範圍（決定匹配哪些訂閱）
 *   - toEmails:   （可選）指定收件人 email 列表，覆蓋渠道配置
 *   - storeLog:   true → 寫 alert_log 隊列再發；false → 只發不存（系統事件）
 */
async function send(event) {
    const { event_type = 'CUSTOM', event_cat, title, body, level = 'MEDIUM',
            bu_no, toEmails = null, storeLog = true } = event;

    if (!title) throw new Error('通知缺少 title');

    // 1. 匹配訂閱
    const channels = await matchSubscriptions({ event_type, event_cat, bu_no });
    if (!channels.length) {
        console.log(`[notifier] 無匹配訂閱: event=${event_type}/${event_cat || '*'} bu=${bu_no || '*'}`);
        return { sent: 0, skipped: true, reason: 'no_subscription' };
    }

    // 2. 寫隊列（先寫 DB，確保不丟）
    let logId = null;
    if (storeLog) {
        const [ins] = await pool.execute(
            `INSERT INTO alert_log
                (rule_id, bu_no, kpi_id, kpi_name, current_value, threshold, level,
                 title, message, suggestion, channel, alert_domain, dedup_key, notify_status)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'PENDING')`,
            [0, bu_no || null, null, event_cat || event_type, null, null, level,
             title, body, null, channels.map(c => c.channel_code).join(','),
             event_cat || event_type,
             `${event_type}|${event_cat || ''}|${bu_no || ''}|${Date.now()}`]
        );
        logId = ins.insertId;
    }

    // 3. 異步發送（不阻塞主鏈路）
    const results = [];
    const sentChannels = [];
    let firstError = null;

    for (const ch of channels) {
        try {
            await sendViaChannel(ch, title, body, { toEmails });
            results.push({ channel: ch.channel_code, ok: true });
            sentChannels.push(ch.channel_code);
        } catch (e) {
            firstError = firstError || e.message;
            results.push({ channel: ch.channel_code, ok: false, error: e.message });
            console.error(`[notifier] ${ch.channel_code} 發送失敗:`, e.message);
        }
    }

    // 4. 更新 alert_log
    if (logId) {
        const status = sentChannels.length > 0 ? 'SENT' : 'FAILED';
        await pool.execute(
            `UPDATE alert_log SET
                notify_status=?, notify_channels=?, notify_error=?,
                notify_sent_at=NOW()
             WHERE uid=?`,
            [status,
             sentChannels.length ? JSON.stringify(sentChannels) : null,
             firstError ? firstError.substring(0, 500) : null,
             logId]
        );
    }

    return {
        log_id: logId,
        sent: sentChannels.length,
        failed: channels.length - sentChannels.length,
        channels: results
    };
}

/**
 * 立即發送（非異步，供測試/API 調用）
 * 其實 send 本身已是 await 的，這個別名更清晰
 */
function sendNow(event) { return send(event); }

/**
 * 測試渠道連通性
 */
async function testChannel(channelCode) {
    const ch = await loadChannel(channelCode);
    if (!ch) return { ok: false, error: '渠道不存在或未啟用' };
    try {
        await sendViaChannel(ch,
            '[ERMM CTO-07] 渠道測試消息',
            `發送時間：${new Date().toISOString()}\n渠道碼：${channelCode}\n如果你看到這條消息，說明 CTO-07 通知通道正常。`);
        await pool.execute(
            'UPDATE cams_notif_channel SET last_test_at=NOW(), last_test_ok=1 WHERE channel_code=?',
            [channelCode]);
        return { ok: true, channel_code: channelCode };
    } catch (e) {
        await pool.execute(
            'UPDATE cams_notif_channel SET last_test_at=NOW(), last_test_ok=0 WHERE channel_code=?',
            [channelCode]);
        return { ok: false, channel_code: channelCode, error: e.message };
    }
}

module.exports = { send, sendNow, testChannel, matchSubscriptions, loadChannel };
