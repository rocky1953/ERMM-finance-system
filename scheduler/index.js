/**
 * M3-A 日報異常告警排程器（零新依賴）
 *
 * 以分鐘級 setInterval 跳動，依「YYYY-MM-DD HH:mm」鍵比對排程並防同日重複觸發：
 *   - 每工作日 09:30 / 16:30：對所有活躍 BU 執行 R1–R5 掃描
 *   - 每月最後一日 16:00：全量掃描（R5 月底未鎖定成立）
 *
 * 前提：pm2 單實例運行；多實例/多機需自行加分散式鎖（本版不做）。
 * 僅在 require.main 直接啟動且 NODE_ENV!=='test' 時由 app.js 呼叫 startScheduler()。
 */
const { scanAll } = require('../services/drAlertScanner');
const { startIntgScheduler } = require('../services/intgScheduler');

const SCAN_TIMES = ['09:30', '16:30'];  // 工作日掃描時刻
const MONTH_END_TIME = '16:00';         // 月末最後一日額外掃描時刻

let timer = null;
let running = false;
const firedKeys = new Set();             // 已觸發鍵（重啟清空，可接受）

function pad2(n) { return String(n).padStart(2, '0'); }
function isWeekend(d) { const w = d.getDay(); return w === 0 || w === 6; }
function isLastDayOfMonth(d) {
    return d.getDate() === new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
function hhmm(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function dateKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

// 回傳當下應執行的排程鍵陣列（空陣列表示這分鐘無排程）
function dueKeys(now) {
    const keys = [];
    const hm = hhmm(now);
    if (!isWeekend(now) && SCAN_TIMES.includes(hm)) {
        keys.push(`scan|${dateKey(now)}|${hm}`);
    }
    if (isLastDayOfMonth(now) && hm === MONTH_END_TIME) {
        keys.push(`monthEnd|${dateKey(now)}`);
    }
    return keys;
}

async function tick() {
    if (running) return;              // 跨 tick 重入保護
    const now = new Date();
    const keys = dueKeys(now);
    const due = keys.filter(k => !firedKeys.has(k));
    if (due.length === 0) return;
    due.forEach(k => firedKeys.add(k));

    running = true;
    try {
        console.log(`[scheduler] 觸發日報告警掃描: ${due.join(', ')} @ ${now.toISOString()}`);
        const r = await scanAll({ asOf: now });
        const total = r.bus.reduce((s, b) => s + (b.created || []).length, 0);
        const errs = r.bus.reduce((s, b) => s + (b.errors || []).length, 0);
        console.log(`[scheduler] 掃描完成: ${r.bus.length} 個 BU，新增告警 ${total} 條，錯誤 ${errs} 條`);
    } catch (e) {
        console.error('[scheduler] 掃描失敗:', e.message);
    } finally {
        running = false;
    }
}

function startScheduler() {
    if (timer) return timer;
    timer = setInterval(() => { tick().catch(e => console.error('[scheduler] tick 錯誤:', e.message)); }, 60 * 1000);
    // 不讓 timer 阻止進程退出
    if (typeof timer.unref === 'function') timer.unref();
    const now = new Date();
    const next = [];
    for (let i = 0; i < 24 * 60; i++) {
        const d = new Date(now.getTime() + i * 60000);
        if (dueKeys(d).length > 0) { next.push(`${dateKey(d)} ${hhmm(d)}`); break; }
    }
    console.log(`⏰ 日報告警排程器已啟動（工作日 ${SCAN_TIMES.join('/')}，月末 ${MONTH_END_TIME}）；下次掃描：${next[0] || '—'}`);
    // 第三方資料整合批次作業（daily HH:MM / every Nm）
    startIntgScheduler();
    return timer;
}

function stopScheduler() {
    if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { startScheduler, stopScheduler, dueKeys, tick };
