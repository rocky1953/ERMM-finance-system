/**
 * MGM_finance_summary 財務摘要路由 (200+ 欄位核心樞紐)
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500, n } = require('../utils/response');

// 列表
router.get('/', async (req, res) => {
    try {
        const { bu_no, YYYY, YYYY_MM, limit } = req.query;
        let sql = 'SELECT uid, bu_no, YYYY_MM, YYYY, MM, flag, cash_amt, deposite_amt, AR_amt, stock_P_amt, stock_M_amt, stock_S_amt, ttl_asset_amt, AP_amt, loan_amt, debet_amt, captial_stock, captial_reserve, legal_reserve, accumulated_amt, current_PL_amt, stockholder_amt, ttl_debet_amt, sale_amt, sale_cost_amt, VAT_amt, sale_exp_amt, MGM_EXP_amt, finance_EXP_amt, BIZ_major_margin_amt, BIZ_margin_amt, operation_profit_amt, pretax_profit_amt, net_profit_amt, VAT_rate, Z_score, risk_color, create_time, update_time FROM MGM_finance_summary WHERE 1=1';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (YYYY) { sql += ' AND YYYY=?'; params.push(YYYY); }
        if (YYYY_MM) { sql += ' AND YYYY_MM=?'; params.push(YYYY_MM); }
        sql += ' ORDER BY YYYY_MM DESC LIMIT ' + (limit || 50);
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// 年度匯總（多年對比用）
router.get('/yearly', async (req, res) => {
    try {
        const { bu_no, years } = req.query;
        if (!bu_no) return fail(res, '需要 bu_no');
        const n = parseInt(years || '5');
        const [ys] = await pool.execute(
            'SELECT DISTINCT YYYY FROM MGM_finance_summary WHERE bu_no=? ORDER BY YYYY DESC LIMIT ' + Math.min(n, 10),
            [bu_no]
        );
        const yearList = ys.map(r => r.YYYY).reverse();
        if (yearList.length === 0) return ok(res, []);

        const [rows] = await pool.execute(`
            SELECT YYYY,
                   SUM(sale_amt) AS sale_amt,
                   SUM(sale_cost_amt) AS sale_cost_amt,
                   SUM(BIZ_major_margin_amt) AS BIZ_major_margin_amt,
                   SUM(BIZ_margin_amt) AS BIZ_margin_amt,
                   SUM(net_profit_amt) AS net_profit_amt,
                   SUM(operation_profit_amt) AS operation_profit_amt,
                   MAX(ttl_asset_amt) AS ttl_asset_end,
                   MAX(stockholder_amt) AS equity_end,
                   COUNT(*) AS months
            FROM MGM_finance_summary
            WHERE bu_no=? AND YYYY IN (${yearList.map(() => '?').join(',')})
            GROUP BY YYYY
            ORDER BY YYYY ASC
        `, [bu_no, ...yearList]);

        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// 單筆詳細
router.get('/:uid', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT * FROM MGM_finance_summary WHERE uid=?', [req.params.uid]
        );
        if (rows.length === 0) return fail(res, '記錄不存在', 404);
        ok(res, rows[0]);
    } catch (err) { fail500(res, err); }
});

// 新增
router.post('/', async (req, res) => {
    try {
        const d = req.body;
        // 從 YYYY_MM 自動解析 YYYY/MM
        let YYYY = d.YYYY, MM = d.MM;
        if (d.YYYY_MM && !YYYY) { YYYY = d.YYYY_MM.split('/')[0]; }
        if (d.YYYY_MM && !MM) { MM = d.YYYY_MM.split('/')[1]; }
        await pool.execute(`
            INSERT INTO MGM_finance_summary (bu_no, YYYY_MM, YYYY, MM, flag, cash_amt, deposite_amt,
               AR_amt, stock_P_amt, stock_M_amt, stock_S_amt, ttl_asset_amt, AP_amt, loan_amt,
               debet_amt, captial_stock, captial_reserve, legal_reserve, accumulated_amt,
               current_PL_amt, stockholder_amt, ttl_debet_amt, sale_amt, sale_cost_amt, VAT_amt,
               sale_exp_amt, MGM_EXP_amt, finance_EXP_amt, net_profit_amt, VAT_rate, batch_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON DUPLICATE KEY UPDATE
               cash_amt=VALUES(cash_amt), deposite_amt=VALUES(deposite_amt),
               AR_amt=VALUES(AR_amt), stock_P_amt=VALUES(stock_P_amt),
               stock_M_amt=VALUES(stock_M_amt), stock_S_amt=VALUES(stock_S_amt),
               ttl_asset_amt=VALUES(ttl_asset_amt), AP_amt=VALUES(AP_amt),
               loan_amt=VALUES(loan_amt), debet_amt=VALUES(debet_amt),
               captial_stock=VALUES(captial_stock),
               captial_reserve=VALUES(captial_reserve),
               legal_reserve=VALUES(legal_reserve),
               accumulated_amt=VALUES(accumulated_amt),
               current_PL_amt=VALUES(current_PL_amt),
               stockholder_amt=VALUES(stockholder_amt),
               ttl_debet_amt=VALUES(ttl_debet_amt), sale_amt=VALUES(sale_amt),
               sale_cost_amt=VALUES(sale_cost_amt), VAT_amt=VALUES(VAT_amt),
               sale_exp_amt=VALUES(sale_exp_amt),
               MGM_EXP_amt=VALUES(MGM_EXP_amt),
               finance_EXP_amt=VALUES(finance_EXP_amt),
               net_profit_amt=VALUES(net_profit_amt),
               VAT_rate=VALUES(VAT_rate), flag=VALUES(flag), update_time=NOW()
        `, [n(d.bu_no), n(d.YYYY_MM), n(YYYY), n(MM), n(d.flag || ''),
            n(d.cash_amt || 0), n(d.deposite_amt || 0), n(d.AR_amt || 0),
            n(d.stock_P_amt || 0), n(d.stock_M_amt || 0), n(d.stock_S_amt || 0),
            n(d.ttl_asset_amt || 0), n(d.AP_amt || 0), n(d.loan_amt || 0),
            n(d.debet_amt || 0), n(d.captial_stock || 0), n(d.captial_reserve || 0),
            n(d.legal_reserve || 0), n(d.accumulated_amt || 0), n(d.current_PL_amt || 0),
            n(d.stockholder_amt || 0), n(d.ttl_debet_amt || 0), n(d.sale_amt || 0),
            n(d.sale_cost_amt || 0), n(d.VAT_amt || 0), n(d.sale_exp_amt || 0),
            n(d.MGM_EXP_amt || 0), n(d.finance_EXP_amt || 0), n(d.net_profit_amt || 0),
            n(d.VAT_rate || 13), n(d.batch_id || '')]);
        ok(res, null, '摘要已保存');
    } catch (err) { fail500(res, err); }
});

// 修改
router.put('/:uid', async (req, res) => {
    try {
        const d = req.body;
        // 動態組 SET
        const updates = Object.keys(d).filter(k => k !== 'uid' && k !== 'create_time')
            .map(k => `${k}=?`).join(',');
        const values = Object.keys(d).filter(k => k !== 'uid' && k !== 'create_time')
            .map(k => d[k]);
        values.push(req.params.uid);
        await pool.execute(`UPDATE MGM_finance_summary SET ${updates} WHERE uid=?`, values);
        ok(res, null, '已更新');
    } catch (err) { fail500(res, err); }
});

// 刪除
router.delete('/:uid', async (req, res) => {
    try {
        await pool.execute('DELETE FROM MGM_finance_summary WHERE uid=?', [req.params.uid]);
        ok(res, null, '已刪除');
    } catch (err) { fail500(res, err); }
});

// 預建當年度 12 個月 (addon)
router.post('/addon', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { bu_no, YYYY } = req.body;
        if (!bu_no) return fail(res, '需要 bu_no');
        const year = YYYY || new Date().getFullYear();
        await conn.beginTransaction();

        for (let m = 1; m <= 12; m++) {
            const mm = String(m).padStart(2, '0');
            const ym = `${year}/${mm}`;
            await conn.execute(`
                INSERT IGNORE INTO MGM_finance_summary (bu_no, YYYY_MM, YYYY, MM, flag, batch_id)
                VALUES (?,?,?,?,?,?)
            `, [bu_no, ym, String(year), mm, '', 'addon']);
        }

        // NULL 歸零
        await conn.execute(
            'UPDATE MGM_finance_summary SET cash_amt=0, AR_amt=0, ttl_asset_amt=0, AP_amt=0, debet_amt=0, sale_amt=0, net_profit_amt=0 WHERE bu_no=? AND YYYY=? AND cash_amt IS NULL',
            [bu_no, year]
        );

        await conn.commit();
        ok(res, null, `已預建 ${year} 年 12 個月摘要記錄`);
    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally {
        conn.release();
    }
});

// 損益計算鏈
router.post('/calcPL', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { bu_no, YYYY_MM } = req.body;
        if (!bu_no || !YYYY_MM) return fail(res, '需要 bu_no 和 YYYY_MM');

        // 取得 VAT_rate
        const [vatRows] = await conn.execute(
            "SELECT value_number3 FROM cams_system_codes WHERE code_type='BUSINESS_ID' AND code_value=?",
            [bu_no]
        );
        const VAT_rate = vatRows[0]?.value_number3 || 13;

        // 讀取當月資料
        const [rows] = await conn.execute(
            'SELECT * FROM MGM_finance_summary WHERE bu_no=? AND YYYY_MM=?', [bu_no, YYYY_MM]
        );
        if (rows.length === 0) return fail(res, '該月摘要不存在，請先執行 /summary/addon');

        const r = rows[0];
        const sale_amt = Number(r.sale_amt || 0);
        const sale_cost_amt = Number(r.sale_cost_amt || 0);
        const sale_exp_amt = Number(r.sale_exp_amt || 0);
        const MGM_EXP_amt = Number(r.MGM_EXP_amt || 0);
        const finance_EXP_amt = Number(r.finance_EXP_amt || 0);
        const BIZ_other_INC = Number(r.BIZ_other_INC_amt || 0);
        const INVEST_profit = Number(r.INVEST_profit_amt || 0);
        const AR_subsidy = Number(r.AR_subsidy_amt || 0);
        const others_INC = Number(r.others_INC_amt || 0);
        const others_cost = Number(r.others_cost_amt || 0);

        // 損益鏈 4 步
        const VAT_amt = sale_amt * (VAT_rate / 100);
        const BIZ_major_margin = sale_amt - sale_cost_amt - VAT_amt;  // 營業毛利
        const BIZ_margin = BIZ_major_margin + BIZ_other_INC - sale_exp_amt - MGM_EXP_amt - finance_EXP_amt;  // 營業利益
        const operation_profit = BIZ_margin + INVEST_profit + AR_subsidy + others_INC - others_cost;  // 營業利潤
        const pretax_profit = operation_profit;  // 稅前淨利
        const net_profit = pretax_profit - VAT_amt;  // 淨利

        // ===== 資產負債表匯總 =====
        const current_asset = Number(r.cash_amt || 0) + Number(r.deposite_amt || 0) + Number(r.AR_amt || 0) +
            Number(r.AR_bill_amt || 0) + Number(r.AR_temp_amt || 0) + Number(r.AR_affiliate_amt || 0) +
            Number(r.stock_P_amt || 0) + Number(r.stock_M_amt || 0) + Number(r.stock_S_amt || 0) +
            Number(r.stock_transit_amt || 0) + Number(r.prepay_EXP_amt || 0) + Number(r.prepay_goods_amt || 0);
        const non_current_asset = Number(r.building_amt || 0) - Number(r.acc_de_building || 0) +
            Number(r.equipment_amt || 0) - Number(r.acc_de_EQMT || 0) +
            Number(r.vehicle_amt || 0) - Number(r.acc_de_vehicle || 0) +
            Number(r.office_amt || 0) - Number(r.acc_de_office || 0) +
            Number(r.intangible_amt || 0) + Number(r.LQ_asset_amt || 0) + Number(r.FX_asset_amt || 0) +
            Number(r.other_asset_amt || 0) + Number(r.WIP_M_amt || 0) + Number(r.WIP_labor_amt || 0) +
            Number(r.WIP_EXP_amt || 0);
        const ttl_asset = current_asset + non_current_asset;

        const current_debet = Number(r.loan_amt || 0) + Number(r.AP_amt || 0) + Number(r.AP_tax_amt || 0) +
            Number(r.AP_salary_amt || 0) + Number(r.AP_other_amt || 0) + Number(r.LQ_debet_amt || 0) +
            Number(r.deposit_liab_amt || 0);
        const long_term_debet = Number(r.LT_loan_amt || 0) + Number(r.LT_debet_amt || 0);
        const ttl_debet = current_debet + long_term_debet;

        const equity = Number(r.captial_stock || 0) + Number(r.captial_reserve || 0) +
            Number(r.legal_reserve || 0) + Number(r.accumulated_amt || 0) + net_profit;

        await conn.execute(`
            UPDATE MGM_finance_summary SET
                VAT_rate=?, VAT_amt=?, BIZ_major_margin_amt=?, BIZ_margin_amt=?,
                operation_profit_amt=?, pretax_profit_amt=?, net_profit_amt=?,
                current_PL_amt=?,
                ttl_asset_amt=?, ttl_debet_amt=?, stockholder_amt=?,
                current_asset_amt=?, non_current_asset_amt=?,
                current_debet_amt=?, long_term_debet_amt=?,
                update_time=NOW()
            WHERE uid=?
        `, [VAT_rate, VAT_amt, BIZ_major_margin, BIZ_margin, operation_profit, pretax_profit, net_profit, net_profit,
            ttl_asset, ttl_debet, equity,
            current_asset, non_current_asset,
            current_debet, long_term_debet,
            r.uid]);

        ok(res, {
            bu_no, YYYY_MM, VAT_rate,
            sale_amt, sale_cost_amt, VAT_amt,
            BIZ_major_margin, BIZ_margin, operation_profit, pretax_profit, net_profit
        }, `損益計算完成: 淨利=${net_profit.toFixed(2)}`);
    } catch (err) { fail500(res, err); }
});

module.exports = router;
