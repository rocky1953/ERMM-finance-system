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

function startScheduler() {
    // 每日 02:00 自动备份
    if (cron) {
        cron.schedule('0 2 * * *', () => runAutoBackup());
        console.log('[scheduler] cron installed: daily 02:00 AUTO backup');
    } else {
        // 兜底：每 24h 跑一次
        setInterval(runAutoBackup, 24 * 60 * 60 * 1000);
        console.log('[scheduler] node-cron not available, fallback to 24h interval');
    }
}

module.exports = { startScheduler, runAutoBackup };
