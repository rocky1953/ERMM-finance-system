/**
 * 同业标杆（industry_benchmark）管理 API
 * - GET  /api/benchmark/list       — 全部，可按 industry / year 过滤
 * - POST /api/benchmark/upsert     — 单条或批量 upsert
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');

// ===== list =====
router.get('/list', async (req, res) => {
    try {
        const { industry, year } = req.query;
        const where = []; const args = [];
        if (industry) { where.push('industry = ?'); args.push(industry); }
        if (year)     { where.push('year = ?');     args.push(Number(year)); }
        const sql = `SELECT uid, kpi_id, industry, year, p10, p25, median, p75, p90, note, updated_at
                     FROM industry_benchmark
                     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                     ORDER BY industry, year DESC, kpi_id`;
        const [rows] = await pool.execute(sql, args);
        // 所有 DECIMAL 转 Number
        rows.forEach(r => {
            ['p10','p25','median','p75','p90'].forEach(k => {
                if (r[k] !== null && r[k] !== undefined) r[k] = Number(r[k]);
            });
        });
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ===== industries & years（用于下拉）=====
router.get('/meta', async (req, res) => {
    try {
        const [inds] = await pool.execute('SELECT DISTINCT industry FROM industry_benchmark ORDER BY industry');
        const [yrs]  = await pool.execute('SELECT DISTINCT year FROM industry_benchmark ORDER BY year DESC');
        ok(res, {
            industries: inds.map(r => r.industry),
            years:      yrs.map(r => r.year),
        });
    } catch (err) { fail500(res, err); }
});

// ===== upsert（单条或数组）=====
router.post('/upsert', async (req, res) => {
    try {
        const body = req.body || {};
        const items = Array.isArray(body) ? body : [body];
        if (!items.length) return fail(res, 'no items');

        let okCount = 0;
        for (const it of items) {
            if (!it.kpi_id || !it.industry || !it.year) {
                return fail(res, `missing required fields in item ${JSON.stringify(it)}`);
            }
            await pool.execute(
                `INSERT INTO industry_benchmark (kpi_id, industry, year, p10, p25, median, p75, p90, note)
                 VALUES (?,?,?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE
                     p10=VALUES(p10), p25=VALUES(p25), median=VALUES(median),
                     p75=VALUES(p75), p90=VALUES(p90), note=VALUES(note)`,
                [
                    it.kpi_id, it.industry, Number(it.year),
                    it.p10    !== undefined && it.p10    !== null ? Number(it.p10)    : null,
                    it.p25    !== undefined && it.p25    !== null ? Number(it.p25)    : null,
                    it.median !== undefined && it.median !== null ? Number(it.median) : null,
                    it.p75    !== undefined && it.p75    !== null ? Number(it.p75)    : null,
                    it.p90    !== undefined && it.p90    !== null ? Number(it.p90)    : null,
                    it.note || null,
                ]
            );
            okCount++;
        }
        ok(res, { updated: okCount });
    } catch (err) { fail500(res, err); }
});

module.exports = router;
