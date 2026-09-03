/**
 * 每日庫存狀態 e2_xitems_daily_status CRUD
 * 批次管線 Step5 用 ageing_days × reduce_percentage 算減值
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, n } = require('../utils/response');

// 自動計算減值欄位的 helper
function computeStock(row) {
    const qty = Number(row.qty_balance || 0);
    const up = Number(row.unit_price || 0);
    const rate = Number(row.exchange_rate || 1);
    const stock_value = Math.round(qty * up * rate * 100) / 100;
    const reduce_pct = Number(row.reduce_percentage || 0);
    const current_value = Math.round(stock_value * (1 - reduce_pct / 100) * 100) / 100;
    const current_lose = Math.round(stock_value * reduce_pct / 100 * 100) / 100;
    let category = row.ageing_category;
    if (!category && row.ageing_days != null) {
        const d = Number(row.ageing_days);
        if (d <= 30) category = 'A 正常';
        else if (d <= 90) category = 'B 31-90天';
        else if (d <= 180) category = 'C 91-180天';
        else category = 'D 超過180天';
    }
    return { stock_value, current_value, current_lose, ageing_category: category };
}

router.get('/', async (req, res) => {
    try {
        const { bu_no, ageing_category } = req.query;
        let sql = 'SELECT * FROM e2_xitems_daily_status WHERE 1=1';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (ageing_category) { sql += ' AND ageing_category=?'; params.push(ageing_category); }
        sql += ' ORDER BY bu_no, reduce_percentage DESC, xitems';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.get('/:uid', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM e2_xitems_daily_status WHERE uid=?', [req.params.uid]);
        if (rows.length === 0) return fail(res, '記錄不存在', 404);
        ok(res, rows[0]);
    } catch (err) { fail500(res, err); }
});

router.post('/', async (req, res) => {
    try {
        const d = req.body;
        const auto = computeStock(d);
        const [r] = await pool.execute(`
            INSERT INTO e2_xitems_daily_status (bu_no, xitems, item_name, qty_balance, unit_price, exchange_rate,
                stock_value, ageing_days, ageing_category, reduce_percentage, current_value, current_lose, stock_date)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        `, [
            n(d.bu_no), n(d.xitems), n(d.item_name),
            Number(d.qty_balance || 0), Number(d.unit_price || 0), Number(d.exchange_rate || 1),
            auto.stock_value, Number(d.ageing_days || 0), auto.ageing_category,
            Number(d.reduce_percentage || 0), auto.current_value, auto.current_lose,
            d.stock_date || null
        ]);
        ok(res, { uid: r.insertId }, '已新增庫存');
    } catch (err) { fail500(res, err); }
});

router.put('/:uid', async (req, res) => {
    try {
        const d = req.body;
        // 若改了 qty/up/FX/ageing/reduce 任一個，自動重算 stock_value / current_value / current_lose
        const recompute = ['qty_balance','unit_price','exchange_rate','ageing_days','reduce_percentage']
            .some(k => d[k] !== undefined);
        let updates = Object.keys(d).filter(k => k !== 'uid' && k !== 'create_time')
            .map(k => `${k}=?`).join(',');
        const values = Object.keys(d).filter(k => k !== 'uid' && k !== 'create_time')
            .map(k => d[k]);

        if (recompute) {
            // 先查目前值再合併計算
            const [cur] = await pool.execute('SELECT * FROM e2_xitems_daily_status WHERE uid=?', [req.params.uid]);
            if (cur.length) {
                const merged = { ...cur[0], ...d };
                const auto = computeStock(merged);
                ['stock_value','current_value','current_lose','ageing_category'].forEach(k => {
                    if (!updates.includes(k + '=?')) {
                        updates = (updates ? updates + ',' : '') + `${k}=?`;
                        values.push(auto[k]);
                    }
                });
            }
        }
        values.push(req.params.uid);
        await pool.execute(`UPDATE e2_xitems_daily_status SET ${updates} WHERE uid=?`, values);
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

router.delete('/:uid', async (req, res) => {
    try {
        await pool.execute('DELETE FROM e2_xitems_daily_status WHERE uid=?', [req.params.uid]);
        ok(res, null, '已刪除');
    } catch (err) { fail500(res, err); }
});

// 重算所有減值（批次 Step5 的前端快捷鈕）
router.post('/recalc', async (req, res) => {
    try {
        const { bu_no } = req.body;
        let where = 'WHERE 1=1';
        const params = [];
        if (bu_no) { where += ' AND bu_no=?'; params.push(bu_no); }
        const [rows] = await pool.execute(`SELECT uid, qty_balance, unit_price, exchange_rate, ageing_days, reduce_percentage FROM e2_xitems_daily_status ${where}`, params);
        let updated = 0;
        for (const row of rows) {
            const auto = computeStock(row);
            await pool.execute(`UPDATE e2_xitems_daily_status SET stock_value=?, current_value=?, current_lose=?, ageing_category=? WHERE uid=?`,
                [auto.stock_value, auto.current_value, auto.current_lose, auto.ageing_category, row.uid]);
            updated++;
        }
        ok(res, { updated }, `已重算 ${updated} 筆`);
    } catch (err) { fail500(res, err); }
});

module.exports = router;
