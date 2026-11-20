/**
 * CTO-04 调度器：每日凌晨自动备份
 *
 * 使用 node-cron（若可用）或 setInterval 兜底，每 24h 执行一次。
 * 生产部署建议用系统级 cron / 任务计划程序直接调 scripts/backup.js backup --type=AUTO
 * —— 这样即使 App 进程挂掉也能继续备份。本文件是备用方案。
 */
const fs = require('fs');
const path = require('path');

let cron;
try { cron = require('node-cron'); } catch (e) { cron = null; }

async function runAutoBackup() {
    const startTime = new Date();
    console.log(`[scheduler] auto-backup triggered ${startTime.toISOString()}`);
    try {
        const { doBackup } = require('./scripts/backup');
        const result = await doBackup({ type: 'AUTO', remark: '每日自动备份', triggeredBy: 'SCHEDULER' });
        if (result.status === 'SUCCESS') {
            console.log(`[scheduler] backup OK #${result.id} ${result.fileName} ${(result.fileSize / 1024).toFixed(1)}KB ${result.durationMs}ms`);
        } else {
            console.error(`[scheduler] backup FAILED: ${result.error}`);
        }
    } catch (e) {
        console.error('[scheduler] backup exception:', e.message);
    }
}

async function runBscAlertScan() {
    console.log(`[scheduler] BSC target deviation scan triggered ${new Date().toISOString()}`);
    try {
        const { scanTargets } = require('./services/bscAlertScanner');
        const r = await scanTargets();
        console.log(`[scheduler] BSC scan OK ${r.YYYY}: scanned=${r.scanned} triggered=${r.triggered} suppressed=${r.suppressed}`);
        if (r.errors && r.errors.length) console.error('[scheduler] BSC scan errors:', r.errors.join('; '));
    } catch (e) {
        console.error('[scheduler] BSC scan exception:', e.message);
    }
}

function startScheduler() {
    // 每日 02:00 自动备份
    if (cron) {
        cron.schedule('0 2 * * *', () => runAutoBackup());
        // 每日 08:00 目标偏差扫描（CEO-01）
        cron.schedule('0 8 * * *', () => runBscAlertScan());
        console.log('[scheduler] cron installed: daily 02:00 AUTO backup, 08:00 BSC scan');
    } else {
        // 兜底：每 24h 跑一次
        setInterval(runAutoBackup, 24 * 60 * 60 * 1000);
        setInterval(runBscAlertScan, 24 * 60 * 60 * 1000);
        console.log('[scheduler] node-cron not available, fallback to 24h interval');
    }
}

module.exports = { startScheduler, runAutoBackup, runBscAlertScan };
