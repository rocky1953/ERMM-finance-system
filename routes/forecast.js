/**
 * 預測明細路由 forecast_detail
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, n } = require('../utils/response');

// 逐筆明細（CRUD 用）
router.get('/detail', async (req, res) => {
    try {
        const { bu_no, YYYY_MM, forecast_type, year } = req.query;
        let sql = 'SELECT * FROM forecast_detail WHERE 1=1';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (YYYY_MM) { sql += ' AND YYYY_MM=?'; params.push(YYYY_MM); }
        if (year) { sql += ' AND YYYY_MM LIKE ?'; params.push(`${year}/%`); }
        if (forecast_type) { sql += ' AND forecast_type=?'; params.push(forecast_type); }
        sql += ' ORDER BY YYYY_MM, forecast_type';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.get('/', async (req, res) => {
    try {
        const { bu_no, YYYY_MM, forecast_type, year } = req.query;
        let sql = 'SELECT * FROM forecast_detail WHERE 1=1';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (YYYY_MM) { sql += ' AND YYYY_MM=?'; params.push(YYYY_MM); }
        if (year) { sql += ' AND YYYY_MM LIKE ?'; params.push(`${year}/%`); }
        if (forecast_type) { sql += ' AND forecast_type=?'; params.push(forecast_type); }
        sql += ' ORDER BY YYYY_MM DESC';
        const [rows] = await pool.execute(sql, params);
        // 按 forecast_type 分組，轉成 12 月寬表
        const grouped = {};
        rows.forEach(r => {
            if (!grouped[r.forecast_type]) grouped[r.forecast_type] = { forecast_type: r.forecast_type };
            const mm = r.YYYY_MM ? r.YYYY_MM.split('/')[1] : '';
            grouped[r.forecast_type]['M' + mm] = Number(r.forecast_amt || 0);
        });
        ok(res, Object.values(grouped));
    } catch (err) { fail500(res, err); }
});

// 批量新增/更新 12 個月預測
router.post('/', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { bu_no, forecast_type, year, months } = req.body;
        if (!bu_no || !forecast_type || !year || !months) return fail(res, '缺少必要參數');
        await conn.beginTransaction();

        // months 應該是 { '01': 100000, '02': 120000, ... } 格式
        for (const [mm, amt] of Object.entries(months)) {
            const ym = `${year}/${mm}`;
            await conn.execute(`
                INSERT INTO forecast_detail (bu_no, YYYY_MM, forecast_type, forecast_amt, diff_amt)
                VALUES (?,?,?,?,0) ON DUPLICATE KEY UPDATE forecast_amt=VALUES(forecast_amt)
            `, [n(bu_no), n(ym), n(forecast_type), n(amt)]);
        }

        await conn.commit();
        ok(res, null, `已儲存 ${Object.keys(months).length} 個月預測`);
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally {
        conn.release();
    }
});

// 修改單筆預測（按 uid）
router.put('/:uid', async (req, res) => {
    try {
        const d = req.body;
        const updates = Object.keys(d).filter(k => k !== 'uid' && k !== 'create_time')
            .map(k => `${k}=?`).join(',');
        const values = Object.keys(d).filter(k => k !== 'uid' && k !== 'create_time')
            .map(k => d[k]);
        values.push(req.params.uid);
        await pool.execute(`UPDATE forecast_detail SET ${updates} WHERE uid=?`, values);
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

// 刪除單筆
router.delete('/:uid', async (req, res) => {
    try {
        await pool.execute('DELETE FROM forecast_detail WHERE uid=?', [req.params.uid]);
        ok(res, null, '已刪除');
    } catch (err) { fail500(res, err); }
});

// 實際 vs 預測比較
router.get('/compare', async (req, res) => {
    try {
        const { bu_no, forecast_type, year } = req.query;
        if (!bu_no || !year) return fail(res, '缺少必要參數 bu_no, year');
        const fcType = forecast_type || '銷售';

        const [fc] = await pool.execute(
            'SELECT * FROM forecast_detail WHERE bu_no=? AND forecast_type=? AND YYYY_MM LIKE ? ORDER BY YYYY_MM',
            [bu_no, fcType, `${year}/%`]
        );

        // 從 MGM_finance_summary 取實際值
        const [actuals] = await pool.execute(
            'SELECT YYYY_MM, sale_amt FROM MGM_finance_summary WHERE bu_no=? AND YYYY_MM LIKE ? ORDER BY YYYY_MM',
            [bu_no, `${year}/%`]
        );
        const actualMap = {};
        actuals.forEach(a => actualMap[a.YYYY_MM] = Number(a.sale_amt || 0));

        const labels = [];
        const forecastData = [];
        const actualData = [];
        for (let m = 1; m <= 12; m++) {
            const mm = String(m).padStart(2, '0');
            const ym = `${year}/${mm}`;
            labels.push(`${m}月`);
            const fcRow = fc.find(f => f.YYYY_MM === ym);
            forecastData.push(fcRow ? Number(fcRow.forecast_amt || 0) : 0);
            actualData.push(actualMap[ym] || 0);
        }

        ok(res, { bu_no, forecast_type: fcType, year, labels, forecast: forecastData, actual: actualData });
    } catch (err) { fail500(res, err); }
});

module.exports = router;
