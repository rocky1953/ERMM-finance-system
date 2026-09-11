/**
 * 5 套風險預警模型路由
 * Z-Score / Z2-Score / Z3-Score / BZ 破產概率 / JZ 營運能力
 * Wolf 模型 + KPI 燈號
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');

// ===== 計算全部風險模型 =====
router.post('/calc', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { bu_no, YYYY_MM } = req.body;
        if (!bu_no || !YYYY_MM) return fail(res, '需要 bu_no 和 YYYY_MM');

        await conn.beginTransaction();

        const [rows] = await conn.execute(
            'SELECT * FROM MGM_finance_summary WHERE bu_no=? AND YYYY_MM=?', [bu_no, YYYY_MM]
        );
        if (rows.length === 0) return fail(res, '該月摘要不存在');

        const r = rows[0];

        // ===== 5 個 Z-Score 變數 =====
        const ttl_asset = Number(r.ttl_asset_amt || 1) || 1;
        const ttl_debet = Number(r.ttl_debet_amt || r.debet_amt || 1) || 1;
        const equity = Number(r.stockholder_amt || 1) || 1;
        const sale = Number(r.sale_amt || 0);
        const current_asset = Number(r.current_asset_amt || Number(r.cash_amt || 0) + Number(r.deposite_amt || 0) + Number(r.AR_amt || 0) + Number(r.stock_P_amt || 0) + Number(r.stock_M_amt || 0));
        const current_debet = Number(r.current_debet_amt || Number(r.loan_amt || 0) + Number(r.AP_amt || 0) + Number(r.AP_tax_amt || 0) + Number(r.AP_salary_amt || 0));
        const WC = current_asset - current_debet;  // 營運資金
        const retained = Number(r.retained_income_amt || Number(r.accumulated_amt || 0) + Number(r.current_PL_amt || 0));
        const EBIT = Number(r.operation_profit_amt || 0);

        // Z-Score 5 變數
        const X1 = WC / ttl_asset;           // (流動資產-流動負債)/總資產
        const X2 = retained / ttl_asset;     // 保留盈餘/總資產
        const X3 = EBIT / ttl_asset;         // 營業利潤/總資產
        const X4 = equity / ttl_debet;        // 股東權益/總負債
        const X5 = sale / ttl_asset;         // 銷貨收入/總資產

        // Z-Score (Altman 原始公式 - 上市公司)
        const Z_score = 1.2 * X1 + 1.4 * X2 + 3.3 * X3 + 0.6 * X4 + 0.999 * X5;

        // Z2-Score (私人公司)
        const Z2_score = 0.717 * X1 + 0.847 * X2 + 3.107 * X3 + 0.420 * X4 + 0.998 * X5;

        // Z3-Score (非製造業，用 X2' = 保留盈餘/總資產)
        const X2_prime = X2;
        const X3_prime = X3;
        const Z3_score = 6.56 * X1 + 3.26 * X2_prime + 6.72 * X3_prime + 1.05 * X4;

        // BZ 破產概率模型 (簡化版)
        const BZ_X1 = X1;
        const BZ_X2 = X2;
        const BZ_X3 = X3;
        const BZ_X4 = X4;
        const BZ_X5 = X5;
        const BZ_model = BZ_X1 + BZ_X2 + BZ_X3 + BZ_X4 + BZ_X5;

        // JZ 營運能力模型
        const JZ_ZA = sale / ttl_asset;  // 資產週轉
        const JZ_ZB = sale / (current_asset || 1);  // 流動資產週轉
        const JZ_ZC = ttl_debet / ttl_asset;  // 負債比率
        const JZ_ZD = Number(r.net_profit_amt || 0) / ttl_asset;  // ROA
        const JZ_model = JZ_ZA + JZ_ZB - JZ_ZC - JZ_ZD;

        // Wolf 模型 (簡化)
        const wall_mode = Z_score >= 2.9 ? '安全' : (Z_score >= 1.23 ? '灰色' : '破產區');

        // 燈號判定: Z < 1.23 紅, 1.23 ≤ Z < 2.9 黃, Z ≥ 2.9 綠
        let risk_color = 'GREEN';
        if (Z_score < 1.23) risk_color = 'RED';
        else if (Z_score < 2.9) risk_color = 'YELLOW';

        // 比率分析
        const current_ratio = current_debet > 0 ? current_asset / current_debet : 0;
        const quick_ratio = current_debet > 0 ? (current_asset - Number(r.stock_P_amt || 0)) / current_debet : 0;
        const debt_ratio = ttl_asset > 0 ? ttl_debet / ttl_asset * 100 : 0;
        const ROI = ttl_asset > 0 ? Number(r.net_profit_amt || 0) / ttl_asset * 100 : 0;
        const ROA = ttl_asset > 0 ? Number(r.net_profit_amt || 0) / ttl_asset * 100 : 0;
        const ROE = equity > 0 ? Number(r.net_profit_amt || 0) / equity * 100 : 0;
        const gross_margin = sale > 0 ? (Number(r.BIZ_major_margin_amt || 0) / sale * 100) : 0;
        const net_margin = sale > 0 ? (Number(r.net_profit_amt || 0) / sale * 100) : 0;

        // 更新資料庫
        await conn.execute(`
            UPDATE MGM_finance_summary SET
                Z_X1=?, Z_X2=?, Z_X3=?, Z_X4=?, Z_X5=?,
                Z_score=?, Z2_score=?, Z3_score=?,
                BZ_X1=?, BZ_X2=?, BZ_X3=?, BZ_X4=?, BZ_X5=?, BZ_model=?,
                JZ_ZA=?, JZ_ZB=?, JZ_ZC=?, JZ_ZD=?, JZ_model=?,
                wall_mode=?, risk_color=?,
                current_ratio=?, quick_ratio=?, debt_ratio=?, ROI=?, ROE=?, ROA=?, gross_margin=?, net_margin=?,
                update_time=NOW()
            WHERE uid=?
        `, [X1, X2, X3, X4, X5,
            Z_score, Z2_score, Z3_score,
            BZ_X1, BZ_X2, BZ_X3, BZ_X4, BZ_X5, BZ_model,
            JZ_ZA, JZ_ZB, JZ_ZC, JZ_ZD, JZ_model,
            wall_mode, risk_color,
            current_ratio, quick_ratio, debt_ratio, ROI, ROE, ROA, gross_margin, net_margin,
            r.uid]);

        // 更新 KPI 當前值（燈號依 MGM_KPI_desc 門檻動態計算，與 kpiQuery 邏輯一致）
        // asc  = 值高=差 → val<=low GREEN, low<val<=high YELLOW, val>high RED
        // desc = 值低=差 → val>=high GREEN, low<=val<high YELLOW, val<low RED
        const kpiLight = (val, low, high, pct_type) => {
            if (val === null || val === undefined || isNaN(val)) return null;
            if ((!low && !high) || low === high) return null;
            const asc = pct_type !== 'desc';
            if (asc)  return val <= low ? 'GREEN' : (val > high ? 'RED' : 'YELLOW');
            return val >= high ? 'GREEN' : (val < low ? 'RED' : 'YELLOW');
        };
        const [kpiRows] = await conn.execute(
            "SELECT KPI_id, KPI1, KPI2, pct_type FROM MGM_KPI_desc WHERE bu_no=? AND KPI_id IN ('current_ratio','debt_ratio')",
            [bu_no]
        );
        const kpiMap = {};
        kpiRows.forEach(k => kpiMap[k.KPI_id] = k);

        await conn.execute(`
            INSERT INTO MGM_KPI_desc (bu_no, KPI_id, KPI_value, KPI_color)
            VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE KPI_value=VALUES(KPI_value), KPI_color=VALUES(KPI_color)
        `, [bu_no, 'Z_score', Z_score, risk_color]);

        const crKpi = kpiMap['current_ratio'] || {};
        await conn.execute(`
            INSERT INTO MGM_KPI_desc (bu_no, KPI_id, KPI_value, KPI_color)
            VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE KPI_value=VALUES(KPI_value), KPI_color=VALUES(KPI_color)
        `, [bu_no, 'current_ratio', current_ratio,
            kpiLight(current_ratio, Number(crKpi.KPI1 || 0), Number(crKpi.KPI2 || 0), crKpi.pct_type)]);

        // 負債比：KPI1=50, KPI2=70, pct_type='asc'（值越高越差）
        const drKpi = kpiMap['debt_ratio'] || { KPI1: 50, KPI2: 70, pct_type: 'asc' };
        await conn.execute(`
            INSERT INTO MGM_KPI_desc (bu_no, KPI_id, KPI_value, KPI_color)
            VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE KPI_value=VALUES(KPI_value), KPI_color=VALUES(KPI_color)
        `, [bu_no, 'debt_ratio', debt_ratio,
            kpiLight(debt_ratio, Number(drKpi.KPI1 || 50), Number(drKpi.KPI2 || 70), drKpi.pct_type || 'asc')]);

        await conn.commit();

        ok(res, {
            bu_no, YYYY_MM,
            variables: { X1, X2, X3, X4, X5 },
            Z_models: {
                Z_score: { value: Z_score.toFixed(4), threshold: '1.23 / 2.9', color: risk_color },
                Z2_score: Z2_score.toFixed(4),
                Z3_score: Z3_score.toFixed(4)
            },
            BZ_model: BZ_model.toFixed(4),
            JZ_model: JZ_model.toFixed(4),
            wall_mode,
            risk_color,
            ratios: {
                current_ratio: current_ratio.toFixed(4),
                quick_ratio: quick_ratio.toFixed(4),
                debt_ratio: debt_ratio.toFixed(2) + '%',
                ROI: ROI.toFixed(2) + '%',
                ROE: ROE.toFixed(2) + '%',
                ROA: ROA.toFixed(2) + '%',
                gross_margin: gross_margin.toFixed(2) + '%',
                net_margin: net_margin.toFixed(2) + '%'
            }
        }, '風險模型計算完成');

    } catch (err) {
        await conn.rollback();
        fail500(res, err);
    } finally {
        conn.release();
    }
});

// ===== 查詢風險結果 =====
router.get('/', async (req, res) => {
    try {
        const { bu_no, YYYY_MM } = req.query;
        let sql = 'SELECT uid, bu_no, YYYY_MM, Z_score, Z2_score, Z3_score, BZ_model, JZ_model, wall_mode, risk_color, Z_X1, Z_X2, Z_X3, Z_X4, Z_X5, BZ_X1, BZ_X2, BZ_X3, BZ_X4, BZ_X5, JZ_ZA, JZ_ZB, JZ_ZC, JZ_ZD, current_ratio, quick_ratio, debt_ratio, ROA, ROE, gross_margin, net_margin FROM MGM_finance_summary WHERE 1=1';
        const params = [];
        if (bu_no) { sql += ' AND bu_no=?'; params.push(bu_no); }
        if (YYYY_MM) { sql += ' AND YYYY_MM=?'; params.push(YYYY_MM); }
        sql += ' ORDER BY YYYY_MM DESC LIMIT 60';
        const [rows] = await pool.execute(sql, params);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

// ===== KPI 燈號判定 =====
router.post('/kpi-light', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { bu_no } = req.body;
        if (!bu_no) return fail(res, '需要 bu_no');

        // 讀取所有 KPI
        const [kpis] = await conn.execute('SELECT * FROM MGM_KPI_desc WHERE bu_no=?', [bu_no]);
        const results = [];

        for (const kpi of kpis) {
            const v = Number(kpi.KPI_value || 0);
            const low = Number(kpi.KPI1 || 0);
            const high = Number(kpi.KPI2 || 0);
            let color = 'YELLOW';

            if (kpi.pct_type === 'desc') {
                // 越高越好: value >= high GREEN, value < low RED
                color = v >= high ? 'GREEN' : (v < low ? 'RED' : 'YELLOW');
            } else {
                // asc / 預設: 在區間內 GREEN, 低於 RED
                color = v >= high ? 'GREEN' : (v < low ? 'RED' : 'YELLOW');
            }

            await conn.execute(
                'UPDATE MGM_KPI_desc SET KPI_color=? WHERE uid=?', [color, kpi.uid]
            );
            results.push({ KPI_id: kpi.KPI_id, KPI_name: kpi.KPI_name, value: v, low, high, color });
        }

        ok(res, results, `KPI 燈號更新完成 (${results.length} 項)`);
    } catch (err) { fail500(res, err); }
});

module.exports = router;
