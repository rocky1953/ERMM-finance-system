/**
 * 第三方資料整合引擎
 *  - 第三方 MySQL 連線池快取 / 連線測試 / SQL 讀取
 *  - 本地目標表欄位白名單（information_schema）
 *  - 型別轉換 + 批次寫入（INSERT / UPSERT）
 *  - 作業執行（runJob）＋ Excel 列寫入（writeRows）
 *  - 全程寫入 intg_log
 */
const mysql = require('mysql2/promise');
const { pool } = require('../config/db');

const BATCH_SIZE = 200;
const IDENT_RE = /^[A-Za-z0-9_]+$/;

// ============ 第三方連線池快取 ============
const sourcePools = new Map();   // sourceId -> pool

async function closeSourcePool(sourceId) {
    const p = sourcePools.get(Number(sourceId));
    if (p) { try { await p.end(); } catch (_) {} sourcePools.delete(Number(sourceId)); }
}

async function getSourcePool(src) {
    const id = Number(src.id);
    if (sourcePools.has(id)) return sourcePools.get(id);
    const p = mysql.createPool({
        host: src.host,
        port: Number(src.port) || 3306,
        user: src.db_user,
        password: src.db_password || '',
        database: src.db_name,
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 0,
        charset: src.charset || 'utf8mb4',
        dateStrings: true,
        multipleStatements: false,
    });
    sourcePools.set(id, p);
    return p;
}

async function testSource(src) {
    const p = await getSourcePool(src);
    const conn = await p.getConnection();
    try {
        const [rows] = await conn.query('SELECT 1 AS test, VERSION() AS version');
        return { ok: true, version: rows[0] && rows[0].version };
    } finally {
        conn.release();
    }
}

// 執行第三方 SELECT（只允許單一 SELECT），回傳欄位與列
async function querySource(src, sql, limit = 100) {
    if (!/^\s*select/i.test(sql)) throw new Error('僅允許 SELECT 查詢');
    if (/;\s*\S/.test(sql.trim())) throw new Error('不允許多語句');
    const p = await getSourcePool(src);
    const q = `SELECT * FROM (${sql.replace(/;\s*$/, '')}) AS __intg_src__ LIMIT ${Number(limit)}`;
    const [rows] = await p.query(q);
    return rows;
}

// ============ 本地表結構 ============
async function getTableColumns(tableName) {
    if (!IDENT_RE.test(tableName)) throw new Error('資料表名稱不合法');
    const dbName = process.env.DB_NAME || 'ERMM_db';
    const [rows] = await pool.execute(
        `SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType,
                IS_NULLABLE AS nullable, COLUMN_KEY AS columnKey, COLUMN_DEFAULT AS dflt,
                EXTRA AS extra
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`,
        [dbName, tableName]
    );
    return rows;
}

async function listLocalTables() {
    const dbName = process.env.DB_NAME || 'ERMM_db';
    const [rows] = await pool.execute(
        `SELECT TABLE_NAME AS name, TABLE_COMMENT AS comment, TABLE_ROWS AS approxRows
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE'
         ORDER BY TABLE_NAME`, [dbName]
    );
    return rows;
}

// ============ 型別轉換 ============
function pad2(n) { return String(n).padStart(2, '0'); }
function fmtDateTime(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
function fmtDate(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function coerceValue(raw, dataType) {
    if (raw === null || raw === undefined || raw === '') return null;
    const dt = (dataType || '').toLowerCase();
    // 日期類型：ExcelJS 可能給 Date 物件 / 數字（serial）/ 字串
    if (dt === 'date' || dt === 'datetime' || dt === 'timestamp') {
        if (raw instanceof Date) return dt === 'date' ? fmtDate(raw) : fmtDateTime(raw);
        if (typeof raw === 'number') {
            // Excel serial 1900 系統
            const ms = Math.round((raw - 25569) * 86400 * 1000);
            const d = new Date(ms);
            return dt === 'date' ? fmtDate(d) : fmtDateTime(d);
        }
        return String(raw).trim().slice(0, 19);
    }
    if (['int', 'tinyint', 'smallint', 'mediumint', 'bigint', 'decimal', 'numeric', 'float', 'double'].some(t => dt.startsWith(t))) {
        if (typeof raw === 'number') return raw;
        const s = String(raw).replace(/[,，\s]/g, '');
        if (s === '') return null;
        const n = Number(s);
        if (Number.isNaN(n)) throw new Error(`無法轉為數字: ${raw}`);
        return n;
    }
    if (dt === 'json' && (typeof raw === 'object')) return JSON.stringify(raw);
    return String(raw).trim();
}

// 把一列來源資料依映射轉為「目標欄位 -> 值」
function mapRow(srcRow, mapping, targetCols) {
    const colMap = new Map(targetCols.map(c => [c.name, c]));
    const out = {};
    for (const [srcCol, tgtCol] of Object.entries(mapping || {})) {
        if (!tgtCol) continue;
        const col = colMap.get(tgtCol);
        if (!col) continue;  // 目標欄不存在，略過（白名單）
        out[tgtCol] = coerceValue(srcRow[srcCol], col.dataType);
    }
    return out;
}

// ============ 批次寫入 ============
/**
 * @param rows 已映射之列（{目標欄:值}[]）
 * @param opts {targetTable, keyColumns, writeMode}
 * @returns {insert_rows, update_rows, error_rows, errors}
 */
async function writeRows(rows, opts) {
    const { targetTable, keyColumns = [], writeMode = 'INSERT' } = opts;
    if (!rows.length) return { insert_rows: 0, update_rows: 0, error_rows: 0, errors: [] };

    const targetCols = await getTableColumns(targetTable);
    const colNames = new Set(targetCols.map(c => c.name));
    // 自動過濾掉不存在的欄
    const useCols = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(c => colNames.has(c));
    if (!useCols.length) throw new Error('沒有可寫入的有效欄位');

    // 自增欄若未提供值不可寫入（OK，MySQL 自行處理）；key 校驗
    const keys = keyColumns.filter(k => colNames.has(k));
    if (writeMode === 'UPSERT' && !keys.length) {
        throw new Error('UPSERT 模式必須指定至少一個存在的匹配鍵欄位');
    }
    const keyIsUnique = keys.every(k => {
        const c = targetCols.find(x => x.name === k);
        return c && (c.columnKey === 'PRI' || c.columnKey === 'UNI');
    });

    let insert_rows = 0, update_rows = 0, error_rows = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        try {
            if (writeMode === 'INSERT' || !keys.length) {
                insert_rows += await bulkInsert(targetTable, useCols, batch);
            } else {
                // 統一走「先查存在鍵 → 拆分 INSERT / UPDATE」，計數符合業務語義
                // （存在即記一筆更新，不受 MySQL「值未變 affectedRows=0」規則影響）
                const r = await bulkSelectSplitWrite(targetTable, useCols, keys, batch, targetCols, keyIsUnique);
                insert_rows += r.inserted;
                update_rows += r.updated;
            }
        } catch (e) {
            error_rows += batch.length;
            errors.push(`第 ${i + 1}~${i + batch.length} 列: ${e.message}`);
        }
    }
    return { insert_rows, update_rows, error_rows, errors: errors.slice(0, 20) };
}

function quoteCol(c) {
    if (!IDENT_RE.test(c)) throw new Error(`欄位名不合法: ${c}`);
    return '`' + c + '`';
}

async function bulkInsert(table, cols, batch) {
    const colSql = cols.map(quoteCol).join(',');
    const placeholders = batch.map(() => `(${cols.map(() => '?').join(',')})`).join(',');
    const vals = [];
    for (const r of batch) for (const c of cols) vals.push(r[c] === undefined ? null : r[c]);
    const [res] = await pool.query(
        `INSERT INTO ${quoteCol(table)} (${colSql}) VALUES ${placeholders}`, vals
    );
    return res.affectedRows || batch.length;
}

// ON DUPLICATE KEY UPDATE（鍵欄須有唯一約束）
async function bulkUpsertOnDuplicate(table, cols, keys, batch, targetCols) {
    const updCols = cols.filter(c => !keys.includes(c));
    // auto_increment 且未提供值時不參與更新（此處 useCols 只含有值欄，安全）
    const colSql = cols.map(quoteCol).join(',');
    const placeholders = batch.map(() => `(${cols.map(() => '?').join(',')})`).join(',');
    const updSql = updCols.length
        ? ' ON DUPLICATE KEY UPDATE ' + updCols.map(c => `${quoteCol(c)}=VALUES(${quoteCol(c)})`).join(',')
        : '';
    const vals = [];
    for (const r of batch) for (const c of cols) vals.push(r[c] === undefined ? null : r[c]);
    const [res] = await pool.query(
        `INSERT INTO ${quoteCol(table)} (${colSql}) VALUES ${placeholders}${updSql}`, vals
    );
    // affectedRows: 新增=1, 更新=2
    const affected = res.affectedRows || 0;
    const updated = Math.floor(affected / 2);
    const inserted = affected - updated * 2;
    return { inserted: Math.max(0, inserted), updated };
}

// 通用模式：先 SELECT 已存在鍵，再分拆 INSERT / UPDATE（不依賴唯一約束）
// keyIsUnique=true 時更新走 ON DUPLICATE KEY 多值寫入提速；計數一律以存在鍵集合為準
async function bulkSelectSplitWrite(table, cols, keys, batch, targetCols, keyIsUnique) {
    const existSet = new Set();
    const keyVals = [...new Set(batch.map(r => r[keys[0]]).filter(v => v !== undefined && v !== null))];
    if (keyVals.length) {
        const [exRows] = await pool.query(
            `SELECT ${keys.map(quoteCol).join(',')} FROM ${quoteCol(table)} WHERE ${quoteCol(keys[0])} IN (?)`,
            [keyVals]
        );
        for (const er of exRows) existSet.add(keys.map(k => String(er[k])).join('||'));
    }
    const toInsert = [], toUpdate = [];
    for (const r of batch) {
        const sig = keys.map(k => String(r[k])).join('||');
        (existSet.has(sig) ? toUpdate : toInsert).push(r);
    }
    let inserted = 0, updated = 0;
    if (toInsert.length) inserted = await bulkInsert(table, cols, toInsert);
    if (toUpdate.length) {
        const updCols = cols.filter(c => !keys.includes(c));
        if (updCols.length) {
            if (keyIsUnique) {
                // 單條多值 ON DUPLICATE KEY UPDATE（高效路徑）
                const placeholders = toUpdate.map(() => `(${cols.map(() => '?').join(',')})`).join(',');
                const vals = [];
                for (const r of toUpdate) for (const c of cols) vals.push(r[c] === undefined ? null : r[c]);
                await pool.query(
                    `INSERT INTO ${quoteCol(table)} (${cols.map(quoteCol).join(',')}) VALUES ${placeholders}
                     ON DUPLICATE KEY UPDATE ${updCols.map(c => `${quoteCol(c)}=VALUES(${quoteCol(c)})`).join(',')}`,
                    vals);
            } else {
                // 無唯一約束：逐列 UPDATE
                for (const r of toUpdate) {
                    const setSql = updCols.map(c => `${quoteCol(c)}=?`).join(',');
                    const whereSql = keys.map(c => `${quoteCol(c)}=?`).join(' AND ');
                    const vals = [...updCols.map(c => r[c] === undefined ? null : r[c]),
                                ...keys.map(c => r[c])];
                    await pool.query(`UPDATE ${quoteCol(table)} SET ${setSql} WHERE ${whereSql}`, vals);
                }
            }
        }
        updated = toUpdate.length;   // 業務語義：匹配到既有列即計一筆更新
    }
    return { inserted, updated };
}

// ============ 日誌包裝 ============
async function createLog(entry) {
    const [res] = await pool.query(
        `INSERT INTO intg_log (job_id, job_name, channel, run_type, source_name, target_table,
            file_name, total_rows, status, triggered_by, started_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,NOW())`,
        [entry.job_id || null, entry.job_name, entry.channel, entry.run_type,
         entry.source_name || null, entry.target_table, entry.file_name || null,
         entry.total_rows || 0, 'RUNNING', entry.triggered_by || null]
    );
    return res.insertId;
}

async function finishLog(logId, status, stats, errorMsg, startedAt) {
    const finished = new Date();
    const dur = startedAt ? finished.getTime() - startedAt.getTime() : null;
    await pool.query(
        `UPDATE intg_log SET status=?, total_rows=?, insert_rows=?, update_rows=?, error_rows=?,
            error_msg=?, finished_at=NOW(), duration_ms=? WHERE id=?`,
        [status, stats.total_rows || 0, stats.insert_rows || 0, stats.update_rows || 0,
         stats.error_rows || 0, errorMsg ? String(errorMsg).slice(0, 4000) : null, dur, logId]
    );
}

async function updateJobRun(jobId, status) {
    if (!jobId) return;
    await pool.query(
        `UPDATE intg_job SET last_run_at=NOW(), last_status=? WHERE id=?`, [status, jobId]
    );
}

// ============ 作業執行（SQL 通道） ============
async function getJob(jobId) {
    const [rows] = await pool.query('SELECT * FROM intg_job WHERE id=?', [jobId]);
    return rows[0] || null;
}

async function getSource(sourceId) {
    const [rows] = await pool.query('SELECT * FROM intg_source WHERE id=?', [Number(sourceId)]);
    return rows[0] || null;
}

async function runJob(jobId, opts = {}) {
    const runType = opts.runType || 'MANUAL';
    const job = await getJob(jobId);
    if (!job) throw new Error('作業不存在');
    if (job.channel !== 'SQL') throw new Error('該作業非 SQL 通道');
    const src = await getSource(job.source_id);
    if (!src) throw new Error('資料源不存在');

    const startedAt = new Date();
    const logId = await createLog({
        job_id: job.id, job_name: job.name, channel: 'SQL', run_type: runType,
        source_name: src.name, target_table: job.target_table, triggered_by: opts.triggeredBy,
    });

    try {
        const srcRows = await querySource(src, job.source_sql, 1000000);
        const targetCols = await getTableColumns(job.target_table);
        let mapping = job.column_mapping;
        if (typeof mapping === 'string') mapping = mapping ? JSON.parse(mapping) : null;
        if (!mapping) mapping = autoMapping(srcRows[0], targetCols);
        const mapped = srcRows.map(r => mapRow(r, mapping, targetCols));
        const stats = await writeRows(mapped, {
            targetTable: job.target_table,
            keyColumns: (job.key_columns || '').split(',').map(s => s.trim()).filter(Boolean),
            writeMode: job.write_mode,
        });
        stats.total_rows = srcRows.length;
        const ok = stats.error_rows === 0;
        await finishLog(logId, ok ? 'SUCCESS' : 'FAIL', stats,
            stats.errors.length ? stats.errors.join('\n') : null, startedAt);
        await updateJobRun(job.id, ok ? 'SUCCESS' : 'FAIL');
        return { logId, ...stats, total_rows: stats.total_rows };
    } catch (e) {
        await finishLog(logId, 'FAIL', { total_rows: 0 }, e.message, startedAt);
        await updateJobRun(job.id, 'FAIL');
        throw e;
    }
}

// 同名欄自動映射
function autoMapping(firstRow, targetCols) {
    const mapping = {};
    if (!firstRow) return mapping;
    const tgtNames = new Set(targetCols.map(c => c.name));
    for (const k of Object.keys(firstRow)) {
        if (tgtNames.has(k)) mapping[k] = k;
    }
    return mapping;
}

// ============ Excel 通道：直接寫入已解析列 ============
/**
 * @param parsedRows 前端/路由解析後的原始列陣列
 * @param opts {targetTable, mapping, keyColumns, writeMode, fileName, jobName, triggeredBy, jobId}
 */
async function importRows(parsedRows, opts) {
    const startedAt = new Date();
    const targetCols = await getTableColumns(opts.targetTable);
    const mapped = parsedRows.map(r => mapRow(r, opts.mapping, targetCols));
    const logId = await createLog({
        job_id: opts.jobId || null,
        job_name: opts.jobName || `Excel匯入:${opts.targetTable}`,
        channel: 'EXCEL', run_type: 'EXCEL',
        target_table: opts.targetTable, file_name: opts.fileName,
        triggered_by: opts.triggeredBy, total_rows: parsedRows.length,
    });
    try {
        const stats = await writeRows(mapped, {
            targetTable: opts.targetTable,
            keyColumns: opts.keyColumns || [],
            writeMode: opts.writeMode || 'INSERT',
        });
        stats.total_rows = parsedRows.length;
        const ok = stats.error_rows === 0;
        await finishLog(logId, ok ? 'SUCCESS' : 'FAIL', stats,
            stats.errors.length ? stats.errors.join('\n') : null, startedAt);
        if (opts.jobId) await updateJobRun(opts.jobId, ok ? 'SUCCESS' : 'FAIL');
        return { logId, ...stats, total_rows: stats.total_rows };
    } catch (e) {
        await finishLog(logId, 'FAIL', { total_rows: parsedRows.length }, e.message, startedAt);
        throw e;
    }
}

module.exports = {
    testSource, querySource, closeSourcePool,
    listLocalTables, getTableColumns,
    runJob, getJob, getSource,
    importRows, autoMapping, mapRow, coerceValue, writeRows,
};
