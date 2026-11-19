/**
 * CTO-04 数据库备份 / 恢复脚本
 *
 * 依赖：mysqldump / mysql 命令行客户端（MySQL Server 自带）
 *   Windows 常见位置：C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe
 *
 * 用法：
 *   node scripts/backup.js backup [--type AUTO|MANUAL] [--remark "手动说明"]
 *   node scripts/backup.js restore  <文件名>
 *   node scripts/backup.js list
 *   node scripts/backup.js prune    # 强制执行保留策略
 *
 * 保留策略（GFS）：
 *   - 最近 7 天：每天一份
 *   - 最近 4 周（28 天之外、180 天之内）：每周一份（周一）
 *   - 超过 180 天：每月一份（每月 1 号）
 *   - 恢复点永远保留（restored_from_id 非空的那一份）
 *
 * 备份目录：backups/（项目根目录下）
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { pool } = require('../config/db');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const DB = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    name: process.env.DB_NAME || 'ERMM_db'
};

// 确保目录存在
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

/** 探测 mysqldump 可执行路径（支持 MYSQL_BIN 为目录或完整文件路径） */
function findMysqlBin() {
    const dirs = [
        process.env.MYSQL_BIN,                                   // 目录或完整路径
        process.env.MYSQLDUMP_PATH,                              // 目录或完整路径
        process.env.MYSQL_HOME && path.join(process.env.MYSQL_HOME, 'bin'),
        '/usr/local/mysql/bin',                                  // Linux 常见位置
        '/usr/bin',
        '/usr/local/bin',
        path.join('C:', 'Program Files', 'MySQL', 'MySQL Server 8.3', 'bin'),
        path.join('C:', 'Program Files', 'MySQL', 'MySQL Server 8.0', 'bin'),
        path.join('C:', 'Program Files', 'MySQL', 'MySQL Server 5.7', 'bin'),
        path.join('C:', 'Program Files (x86)', 'MySQL', 'MySQL Server 8.3', 'bin'),
        path.join('C:', 'Program Files (x86)', 'MySQL', 'MySQL Server 8.0', 'bin')
    ].filter(Boolean);

    const candidates = [];
    for (const item of dirs) {
        // 用户可能直接给到可执行文件
        if (/mysqldump(\.exe)?$/i.test(item)) candidates.push(item);
        else candidates.push(path.join(item, 'mysqldump'));
    }
    candidates.push('mysqldump');                                 // PATH

    for (const dump of candidates) {
        const mysql = dump === 'mysqldump'
            ? 'mysql'
            : path.join(path.dirname(dump), 'mysql');
        try {
            execSync(`"${dump}" --version`, { stdio: 'ignore' });
            return { dump, mysql };
        } catch (e) { /* 继续找 */ }
    }
    throw new Error(
        '找不到 mysqldump，请执行 apt-get install -y mysql-client-8.0，' +
        '或在 .env 设置 MYSQL_BIN=/usr/local/mysql/bin');
}

function nowFmt(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function escapePassword(pwd) {
    // PowerShell/CMD 特殊字符转义（反斜杠和引号）
    return pwd ? pwd.replace(/\\/g, '\\\\').replace(/"/g, '\\"') : '';
}

/** 执行 mysqldump 备份 */
async function doBackup({ type = 'MANUAL', remark = '', triggeredBy = null } = {}) {
    const bin = findMysqlBin();
    const fileName = `${DB.name}_${nowFmt()}_${type.toLowerCase()}.sql`;
    const filePath = path.join(BACKUP_DIR, fileName);
    const startedAt = new Date();

    // 先插一条 RUNNING 记录
    const [result] = await pool.query(
        `INSERT INTO backup_log (backup_type, file_name, file_path, status, started_at, remark, triggered_by)
         VALUES (?, ?, ?, 'RUNNING', ?, ?, ?)`,
        [type, fileName, filePath, startedAt, remark, triggeredBy]
    );
    const logId = result.insertId;

    const dumpArgs = [
        '--host', DB.host,
        '--port', String(DB.port),
        '--user', DB.user,
        `--password=${DB.password}`,
        '--single-transaction',   // InnoDB 一致快照，不锁表
        '--no-tablespaces',       // 避免需要 PROCESS 权限（MySQL 8 常见报错）
        '--routines',             // 存储过程
        '--triggers',
        '--events',
        '--set-gtid-purged=OFF',
        '--databases', DB.name
    ];

    return new Promise((resolve) => {
        const child = spawn(bin.dump, dumpArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        const out = fs.createWriteStream(filePath);
        const errChunks = [];

        child.stdout.pipe(out);
        child.stderr.on('data', (c) => errChunks.push(c));

        child.on('close', async (code) => {
            const finishedAt = new Date();
            const durationMs = finishedAt - startedAt;
            let errorMsg = errChunks.join('').trim();
            if (errorMsg && errorMsg.startsWith('mysqldump: [Warning] Using a password')) {
                errorMsg = errorMsg.replace(/mysqldump: \[Warning\] Using a password.*\n?/g, '').trim();
            }

            let status, fileSize = null;
            if (code === 0 && !errorMsg) {
                try { fileSize = fs.statSync(filePath).size; } catch (e) { /* 文件未生成 */ }
                if (fileSize && fileSize > 0) {
                    status = 'SUCCESS';
                } else {
                    status = 'FAILED';
                    errorMsg = '备份文件为空';
                }
            } else {
                status = 'FAILED';
                if (!errorMsg) errorMsg = `mysqldump 退出码 ${code}`;
            }

            await pool.query(
                `UPDATE backup_log SET status=?, file_size=?, finished_at=?, duration_ms=?, error_message=? WHERE id=?`,
                [status, fileSize, finishedAt, durationMs, errorMsg.slice(0, 1024), logId]
            );

            // 成功后执行保留策略
            if (status === 'SUCCESS') {
                try { await prune(); } catch (e) { console.warn('[prune]', e.message); }
            }

            resolve({ id: logId, fileName, filePath, fileSize, status, durationMs, error: errorMsg || null });
        });

        // 防止进程立即退出把子进程干掉
        child.on('error', async (e) => {
            await pool.query(
                `UPDATE backup_log SET status='FAILED', finished_at=?, error_message=? WHERE id=?`,
                [new Date(), e.message.slice(0, 1024), logId]
            );
            resolve({ id: logId, status: 'FAILED', error: e.message });
        });
    });
}

/** GFS 保留策略 */
async function prune() {
    const [rows] = await pool.query(
        `SELECT id, file_path, file_size, status, started_at, restored_from_id
         FROM backup_log
         WHERE file_path IS NOT NULL AND status IN ('SUCCESS','RESTORED')`
    );

    const now = new Date();
    const keep = new Set();

    for (const r of rows) {
        if (r.restored_from_id) { keep.add(r.id); continue; } // 恢复点永远保留

        const d = (r.started_at instanceof Date) ? r.started_at : new Date(r.started_at);
        if (isNaN(d.getTime())) { keep.add(r.id); continue; } // 日期坏的就别删

        const ageDays = (now - d) / 86_400_000;

        if (ageDays <= 7) { keep.add(r.id); continue; }
        if (ageDays <= 180) {
            // 周保留：周一（getDay()=1）
            if (d.getDay() === 1) keep.add(r.id);
        } else {
            // 月保留：每月 1 号
            if (d.getDate() === 1) keep.add(r.id);
        }
    }

    const removed = [];
    for (const r of rows) {
        if (keep.has(r.id)) continue;
        // 真正没被任何恢复过的才删（安全网）
        const [used] = await pool.query('SELECT COUNT(*) c FROM backup_log WHERE restored_from_id=?', [r.id]);
        if (used[0].c > 0) { keep.add(r.id); continue; }

        try { if (r.file_path && fs.existsSync(r.file_path)) fs.unlinkSync(r.file_path); } catch (e) { /* 删不掉就算了 */ }
        await pool.query(`UPDATE backup_log SET status='DELETED' WHERE id=?`, [r.id]);
        removed.push(r.file_name || r.file_path);
    }
    console.log(`[prune] removed ${removed.length} old backups`);
    return removed;
}

/** 恢复：先存恢复点快照，再 mysql 导入 */
async function restore(fileNameOrId) {
    // 先找目标
    let target;
    if (/^\d+$/.test(String(fileNameOrId))) {
        const [rows] = await pool.query('SELECT * FROM backup_log WHERE id=?', [Number(fileNameOrId)]);
        target = rows[0];
    } else {
        const [rows] = await pool.query('SELECT * FROM backup_log WHERE file_name=?', [fileNameOrId]);
        target = rows[0];
    }
    if (!target) throw new Error(`找不到备份：${fileNameOrId}`);
    if (!fs.existsSync(target.file_path)) throw new Error(`备份文件不存在：${target.file_path}`);

    // 1. 先存恢复点快照（MANUAL，remark 标记为恢复前）
    const snap = await doBackup({ type: 'MANUAL', remark: `恢复前自动快照（恢复自 ${target.file_name}）`, triggeredBy: 'RESTORE_PRE_SNAPSHOT' });
    console.log(`[restore] pre-snapshot: ${snap.fileName}`);

    // 2. 执行 mysql 导入
    const bin = findMysqlBin();
    return new Promise((resolve, reject) => {
        const child = spawn(bin.mysql, [
            '--host', DB.host,
            '--port', String(DB.port),
            '--user', DB.user,
            `--password=${DB.password}`,
            DB.name
        ], { stdio: ['pipe', 'pipe', 'pipe'] });

        fs.createReadStream(target.file_path).pipe(child.stdin);
        const errBuf = [];
        child.stderr.on('data', (c) => errBuf.push(c));

        child.on('close', async (code) => {
            const stderr = errBuf.join('').trim()
                .replace(/mysql: \[Warning\] Using a password.*\n?/g, '');

            if (code === 0 && !stderr) {
                await pool.query(
                    `INSERT INTO backup_log (backup_type, file_name, file_path, status, started_at, finished_at, duration_ms, remark, restored_from_id)
                     VALUES ('RESTORE', ?, ?, 'RESTORED', NOW(), NOW(), 0, ?, ?)`,
                    [target.file_name, target.file_path, `恢复自 ${target.file_name}`, target.id]
                );
                await pool.query('UPDATE backup_log SET status=\'RESTORED\' WHERE id=?', [target.id]);
                resolve({ success: true, restoredFrom: target.file_name, preSnapshot: snap.fileName });
            } else {
                reject(new Error(`恢复失败：${stderr || `mysql 退出码 ${code}`}`));
            }
        });
        child.on('error', reject);
    });
}

async function listBackups() {
    const [rows] = await pool.query(
        `SELECT id, backup_type, file_name, file_path, file_size, status,
                started_at, finished_at, duration_ms, restored_from_id, remark
         FROM backup_log ORDER BY started_at DESC LIMIT 50`
    );
    console.log('='.repeat(100));
    console.log('ID  类型    状态    文件                             大小      开始时间             备注');
    console.log('-' .repeat(100));
    for (const r of rows) {
        const size = r.file_size ? `${(r.file_size / 1024).toFixed(1)} KB` : '-';
        const restoreHint = r.restored_from_id ? `← restored from #${r.restored_from_id}` : '';
        console.log(`${String(r.id).padEnd(4)} ${r.backup_type.padEnd(7)} ${r.status.padEnd(7)} ${String(r.file_name).slice(0, 30).padEnd(30)} ${size.padEnd(10)} ${String(r.started_at).slice(0, 19).replace('T', ' ').padEnd(20)} ${r.remark || restoreHint || ''}`);
    }
    return rows;
}

// CLI 入口
(async () => {
    const args = process.argv.slice(2);
    const cmd = args[0];

    try {
        if (cmd === 'backup') {
            const type = args.includes('--type=AUTO') ? 'AUTO' : 'MANUAL';
            const remark = args.find(a => a.startsWith('--remark='));
            const result = await doBackup({ type, remark: remark ? remark.slice(9) : '' });
            const sizeKB = result.fileSize ? (result.fileSize / 1024).toFixed(1) : '0';
            if (result.status === 'SUCCESS') {
                console.log(`✅ 备份成功 #${result.id}：${result.fileName} (${sizeKB} KB, ${result.durationMs}ms)`);
            } else {
                console.error(`❌ 备份失败：${result.error}`);
                process.exit(1);
            }
        } else if (cmd === 'restore') {
            const target = args[1];
            if (!target) { console.error('用法：node scripts/backup.js restore <文件名 或 backup_log.id>'); process.exit(1); }
            const result = await restore(target);
            console.log(`✅ 恢复成功：${result.restoredFrom}（恢复前快照：${result.preSnapshot}）`);
        } else if (cmd === 'list') {
            await listBackups();
        } else if (cmd === 'prune') {
            await prune();
            console.log('✅ 保留策略执行完毕');
        } else if (!cmd || cmd === '--help') {
            console.log(`CTO-04 备份恢复
  node scripts/backup.js backup         # 手动备份
  node scripts/backup.js backup --type=AUTO --remark "..."
  node scripts/backup.js restore <文件名|id>
  node scripts/backup.js list           # 最近 50 条
  node scripts/backup.js prune           # 保留策略清理`);
        } else {
            console.error(`未知命令：${cmd}`);
            process.exit(1);
        }
    } catch (e) {
        console.error('❌', e.message);
        process.exit(1);
    }
    // 关闭连接池，否则进程会一直挂住（会让部署脚本卡死）
    try { await pool.end(); } catch (_) { /* 忽略关闭异常 */ }
})();

module.exports = { doBackup, restore, listBackups, prune, findMysqlBin };
