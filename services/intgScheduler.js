/**
 * 第三方資料整合 · 批次排程器（零新依賴，分鐘級 setInterval）
 *
 * intg_job.schedule 支援格式：
 *   daily HH:MM   每日固定時刻，例如 daily 02:30
 *   every Nm      每 N 分鐘，例如 every 30m
 *
 * 防重複：同一排程觸發鍵在進程生命週期內只執行一次；作業狀態 RUNNING 時跳過。
 * 前提：pm2 單實例運行（與日報告警排程器相同約束）。
 */
const { pool } = require('../config/db');
const integ = require('./dataIntegrator');

let timer = null;
let ticking = false;
const firedKeys = new Set();
const runningJobs = new Set();

function pad2(n) { return String(n).padStart(2, '0'); }
function hhmm(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function dateKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

// 回傳此分鐘應觸發的鍵
function dueKey(job, now) {
    const sched = (job.schedule || '').trim();
    let m = /^daily\s+(\d{1,2}):(\d{2})$/i.exec(sched);
    if (m) {
        const hm = `${pad2(Number(m[1]))}:${m[2]}`;
        return hm === hhmm(now) ? `job${job.id}|daily|${dateKey(now)}|${hm}` : null;
    }
    m = /^every\s+(\d+)m$/i.exec(sched);
    if (m) {
        const n = Math.max(1, Number(m[1]));
        const slot = Math.floor((now.getHours() * 60 + now.getMinutes()) / n);
        const dayKey = dateKey(now);
        return `job${job.id}|every${n}m|${dayKey}|${slot}`;
    }
    return null;
}

async function tick() {
    if (ticking) return;
    ticking = true;
    try {
        const [jobs] = await pool.query(
            `SELECT id, name, schedule FROM intg_job
             WHERE enabled=1 AND mode='BATCH' AND schedule IS NOT NULL AND schedule<>''`);
        if (!jobs.length) return;
        const now = new Date();
        for (const job of jobs) {
            const key = dueKey(job, now);
            if (!key || firedKeys.has(key) || runningJobs.has(job.id)) continue;
            firedKeys.add(key);
            runningJobs.add(job.id);
            console.log(`[intg-scheduler] 觸發批次作業 #${job.id} ${job.name} @ ${now.toISOString()}`);
            integ.runJob(job.id, { runType: 'SCHEDULED', triggeredBy: 'SCHEDULER' })
                .then(r => console.log(`[intg-scheduler] 作業 #${job.id} 完成: 讀取 ${r.total_rows}，新增 ${r.insert_rows}，更新 ${r.update_rows}，失敗 ${r.error_rows}`))
                .catch(e => console.error(`[intg-scheduler] 作業 #${job.id} 失敗: ${e.message}`))
                .finally(() => runningJobs.delete(job.id));
        }
    } catch (e) {
        console.error('[intg-scheduler] tick 錯誤:', e.message);
    } finally {
        ticking = false;
    }
}

function startIntgScheduler() {
    if (timer) return timer;
    timer = setInterval(() => { tick(); }, 60 * 1000);
    if (typeof timer.unref === 'function') timer.unref();
    console.log('🔌 第三方資料整合批次排程器已啟動（每分鐘檢查 BATCH 作業）');
    return timer;
}

function stopIntgScheduler() {
    if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { startIntgScheduler, stopIntgScheduler, dueKey, tick };
