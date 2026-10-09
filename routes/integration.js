/**
 * 第三方資料整合路由
 *  - 本地表/欄位查詢（白名單來源）
 *  - 資料源 CRUD + 連線測試 + SQL 預覽
 *  - 整合作業 CRUD + 立即執行（Online）
 *  - Excel 解析（base64 上傳）/ 匯入
 *  - 執行日誌
 */
const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const integ = require('../services/dataIntegrator');

function actor(req) {
    return req.headers['x-test-user'] || req.user?.user_id || 'SYSTEM';
}

// ============ 本地表結構 ============
router.get('/tables', async (req, res) => {
    try {
        const rows = await integ.listLocalTables();
        ok(res, rows);
    } catch (e) { fail500(res, e); }
});

router.get('/tables/:name/columns', async (req, res) => {
    try {
        const cols = await integ.getTableColumns(req.params.name);
        if (!cols.length) return fail(res, '資料表不存在或無欄位', 404);
        ok(res, cols);
    } catch (e) { fail500(res, e); }
});

// ============ 資料源 ============
router.get('/sources', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, name, db_type, host, port, db_name, db_user,
                    (db_password IS NOT NULL AND db_password<>'') AS has_password,
                    charset, enabled, remark, created_at
             FROM intg_source ORDER BY id`);
        ok(res, rows);
    } catch (e) { fail500(res, e); }
});

router.post('/sources', async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.name || !b.host || !b.db_name || !b.db_user) return fail(res, '名稱/主機/資料庫/帳號必填');
        const [r] = await pool.query(
            `INSERT INTO intg_source (name, db_type, host, port, db_name, db_user, db_password, charset, enabled, remark, created_by)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [b.name, b.db_type || 'mysql', b.host, Number(b.port) || 3306, b.db_name, b.db_user,
             b.db_password ?? null, b.charset || 'utf8mb4', b.enabled === false ? 0 : 1, b.remark || null, actor(req)]);
        ok(res, { id: r.insertId });
    } catch (e) { fail500(res, e); }
});

router.put('/sources/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        const b = req.body || {};
        const [exist] = await pool.query('SELECT * FROM intg_source WHERE id=?', [id]);
        if (!exist.length) return fail(res, '資料源不存在', 404);
        const cur = exist[0];
        const password = (b.db_password === undefined || b.db_password === '') ? cur.db_password : b.db_password;
        await pool.query(
            `UPDATE intg_source SET name=?, db_type=?, host=?, port=?, db_name=?, db_user=?,
                db_password=?, charset=?, enabled=?, remark=? WHERE id=?`,
            [b.name || cur.name, b.db_type || cur.db_type, b.host || cur.host,
             Number(b.port) || cur.port, b.db_name || cur.db_name, b.db_user || cur.db_user,
             password, b.charset || cur.charset,
             b.enabled === undefined ? cur.enabled : (b.enabled ? 1 : 0),
             b.remark === undefined ? cur.remark : b.remark, id]);
        await integ.closeSourcePool(id);
        ok(res, { id });
    } catch (e) { fail500(res, e); }
});

router.delete('/sources/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        const [[job]] = await pool.query('SELECT COUNT(*) AS c FROM intg_job WHERE source_id=?', [id]);
        if (job.c > 0) return fail(res, `仍有 ${job.c} 個作業使用此資料源，無法刪除`);
        await pool.query('DELETE FROM intg_source WHERE id=?', [id]);
        await integ.closeSourcePool(id);
        ok(res, { id });
    } catch (e) { fail500(res, e); }
});

// 測試已保存的資料源
router.post('/sources/:id/test', async (req, res) => {
    try {
        const src = await integ.getSource(req.params.id);
        if (!src) return fail(res, '資料源不存在', 404);
        const r = await integ.testSource(src);
        ok(res, r);
    } catch (e) { fail(res, `連線失敗: ${e.message}`, 400); }
});

// 測試尚未儲存的連線設定
router.post('/sources-test', async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.host || !b.db_name || !b.db_user) return fail(res, '主機/資料庫/帳號必填');
        const tmp = {
            id: `tmp_${Date.now()}`,
            host: b.host, port: Number(b.port) || 3306, db_name: b.db_name,
            db_user: b.db_user, db_password: b.db_password || '', charset: b.charset || 'utf8mb4',
        };
        const r = await integ.testSource(tmp);
        await integ.closeSourcePool(tmp.id);
        ok(res, r);
    } catch (e) { fail(res, `連線失敗: ${e.message}`, 400); }
});

// SQL 預覽（前 N 行），僅 SELECT
router.post('/sources/query', async (req, res) => {
    try {
        const { source_id: sourceId, sql, limit } = req.body || {};
        if (!sourceId || !sql) return fail(res, 'source_id 與 sql 必填');
        const src = await integ.getSource(sourceId);
        if (!src) return fail(res, '資料源不存在', 404);
        const rows = await integ.querySource(src, sql, Math.min(Number(limit) || 50, 500));
        ok(res, { columns: rows.length ? Object.keys(rows[0]) : [], rows, row_count: rows.length });
    } catch (e) { fail(res, `查詢失敗: ${e.message}`, 400); }
});

// ============ 整合作業 ============
router.get('/jobs', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT j.*, s.name AS source_name
             FROM intg_job j LEFT JOIN intg_source s ON s.id=j.source_id
             ORDER BY j.id DESC`);
        ok(res, rows);
    } catch (e) { fail500(res, e); }
});

router.post('/jobs', async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.name || !b.target_table) return fail(res, '作業名稱與目標表必填');
        const [r] = await pool.query(
            `INSERT INTO intg_job (name, channel, source_id, source_sql, target_table, column_mapping,
                key_columns, write_mode, mode, schedule, enabled, remark, created_by)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [b.name, b.channel || 'SQL', b.source_id || null, b.source_sql || null, b.target_table,
             b.column_mapping ? JSON.stringify(b.column_mapping) : null,
             (b.key_columns || []).join ? (b.key_columns || []).join(',') : (b.key_columns || null),
             b.write_mode || 'INSERT', b.mode || 'ONLINE', b.schedule || null,
             b.enabled === false ? 0 : 1, b.remark || null, actor(req)]);
        ok(res, { id: r.insertId });
    } catch (e) { fail500(res, e); }
});

router.put('/jobs/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        const [exist] = await pool.query('SELECT * FROM intg_job WHERE id=?', [id]);
        if (!exist.length) return fail(res, '作業不存在', 404);
        const b = req.body || {};
        await pool.query(
            `UPDATE intg_job SET name=?, channel=?, source_id=?, source_sql=?, target_table=?,
                column_mapping=?, key_columns=?, write_mode=?, mode=?, schedule=?, enabled=?, remark=?
             WHERE id=?`,
            [b.name || '未命名作業', b.channel || 'SQL', b.source_id || null, b.source_sql || null,
             b.target_table,
             b.column_mapping ? JSON.stringify(b.column_mapping) : null,
             Array.isArray(b.key_columns) ? b.key_columns.join(',') : (b.key_columns || ''),
             b.write_mode || 'INSERT', b.mode || 'ONLINE', b.schedule || null,
             b.enabled === false ? 0 : 1, b.remark || null, id]);
        ok(res, { id });
    } catch (e) { fail500(res, e); }
});

router.delete('/jobs/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM intg_job WHERE id=?', [Number(req.params.id)]);
        ok(res, { id: Number(req.params.id) });
    } catch (e) { fail500(res, e); }
});

// 立即執行（Online 手動）
router.post('/jobs/:id/run', async (req, res) => {
    try {
        const r = await integ.runJob(Number(req.params.id), { runType: 'MANUAL', triggeredBy: actor(req) });
        ok(res, r);
    } catch (e) { fail(res, `執行失敗: ${e.message}`, 400); }
});

// ============ Excel 解析與匯入 ============
// 將 ExcelJS cell 轉為純值
function cellValue(cell) {
    const v = cell.value;
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v;
    if (typeof v === 'object') {
        if (v.text !== undefined) return v.text;                 // 超連結/富文字
        if (v.result !== undefined) return v.result;             // 公式
        if (v.richText) return v.richText.map(t => t.text).join('');
        if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('');
        return String(v);
    }
    return v;
}

router.post('/excel/parse', async (req, res) => {
    try {
        const { file_base64: b64, file_name: fileName } = req.body || {};
        if (!b64) return fail(res, '未收到檔案內容');
        const buf = Buffer.from(b64.replace(/^data:[^;]+;base64,/, ''), 'base64');
        if (buf.length > 20 * 1024 * 1024) return fail(res, '檔案過大（上限 20MB）');

        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);
        const sheets = [];
        wb.worksheets.forEach(ws => {
            const rows = [];
            let header = [];
            ws.eachRow({ includeEmpty: false }, (row, idx) => {
                const vals = [];
                row.eachCell({ includeEmpty: true }, (cell, col) => { vals[col - 1] = cellValue(cell); });
                if (idx === 1) {
                    header = vals.map(v => (v === null || v === undefined) ? '' : String(v).trim());
                } else if (rows.length < 5) {
                    const obj = {};
                    header.forEach((h, i) => { if (h) obj[h] = vals[i] === undefined ? '' : vals[i]; });
                    rows.push(obj);
                }
            });
            sheets.push({ name: ws.name, headers: header.filter(Boolean), preview: rows,
                          total_rows: Math.max(0, ws.actualRowCount - 1) });
        });
        ok(res, { file_name: fileName || 'upload.xlsx', sheets });
    } catch (e) { fail(res, `解析失敗: ${e.message}`, 400); }
});

// 解析活頁簿中指定 sheet 的全部資料列（表頭在第 1 列）
async function parseSheetRows(buf, sheetName) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets[0];
    if (!ws) throw new Error('找不到工作表');
    let header = [];
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row, idx) => {
        const vals = [];
        row.eachCell({ includeEmpty: true }, (cell, col) => { vals[col - 1] = cellValue(cell); });
        if (idx === 1) {
            header = vals.map(v => (v === null || v === undefined) ? '' : String(v).trim());
        } else {
            const obj = {};
            let hasVal = false;
            header.forEach((h, i) => {
                const v = vals[i] === undefined ? '' : vals[i];
                if (h) obj[h] = v;
                if (v !== '' && v !== null && v !== undefined) hasVal = true;
            });
            if (hasVal) rows.push(obj);
        }
    });
    return { sheet: ws.name, headers: header.filter(Boolean), rows };
}

router.post('/excel/import', async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.target_table || !b.mapping) return fail(res, 'target_table / mapping 必填');

        // 模式 A：帶檔案 base64，後端重新解析全量
        let rows = Array.isArray(b.rows) ? b.rows : null;
        let fileName = b.file_name || null;
        if (b.file_base64) {
            const buf = Buffer.from(b.file_base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
            if (buf.length > 20 * 1024 * 1024) return fail(res, '檔案過大（上限 20MB）');
            const parsed = await parseSheetRows(buf, b.sheet_name);
            rows = parsed.rows;
        }
        if (!rows || !rows.length) return fail(res, '沒有可匯入的資料列');
        const r = await integ.importRows(rows, {
            targetTable: b.target_table,
            mapping: b.mapping,
            keyColumns: b.key_columns || [],
            writeMode: b.write_mode || 'INSERT',
            fileName,
            triggeredBy: actor(req),
        });
        ok(res, r);
    } catch (e) { fail(res, `匯入失敗: ${e.message}`, 400); }
});

// ============ 執行日誌 ============
router.get('/logs', async (req, res) => {
    try {
        const { status, channel, job_id: jobId, limit } = req.query;
        const where = [];
        const p = [];
        if (status) { where.push('status=?'); p.push(status); }
        if (channel) { where.push('channel=?'); p.push(channel); }
        if (jobId) { where.push('job_id=?'); p.push(Number(jobId)); }
        const sql = `SELECT * FROM intg_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                     ORDER BY id DESC LIMIT ${Math.min(Number(limit) || 100, 500)}`;
        const [rows] = await pool.query(sql, p);
        ok(res, rows);
    } catch (e) { fail500(res, e); }
});

module.exports = router;
