/**
 * 為 YG004 新增的 3 個預測模型（營運資產、沃爾比重、A值）插入 KPI 門檻定義
 * 讓前端「目標值」欄位可點擊編輯（與 Z/BZ 模型一致）
 *
 * 執行：node database/seed_kpi_new_models.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const NEW_KPIS = [
    // 營運資產模型 (desc = 值高越好)
    { KPI_id: 'oa_working_asset', KPI_name: '營運資產額',         KPI1: 0,    KPI2: 0,    unit: '元', pct_type: 'desc' },
    { KPI_id: 'oa_cover_cl',      KPI_name: '營運資產/流動負債',  KPI1: 0.5,  KPI2: 1.0,  unit: '',   pct_type: 'desc' },
    { KPI_id: 'oa_wc_ratio',      KPI_name: '營運資本比率',      KPI1: 0.1,  KPI2: 0.3,  unit: '',   pct_type: 'desc' },
    { KPI_id: 'oa_equity_debt',   KPI_name: '淨值/負債總額',      KPI1: 0.5,  KPI2: 1.0,  unit: '',   pct_type: 'desc' },
    // 沃爾比重模型
    { KPI_id: 'wall_score',       KPI_name: '沃爾綜合評分(滿分100)', KPI1: 80,   KPI2: 100,  unit: '分', pct_type: 'desc' },
    { KPI_id: 'wall_de',          KPI_name: '淨值/負債(標準1.50)',  KPI1: 1.0,  KPI2: 1.5,  unit: '',   pct_type: 'desc' },
    { KPI_id: 'wall_af',          KPI_name: '總資產/固定資產(標準2.50)', KPI1: 1.5, KPI2: 2.5, unit: '', pct_type: 'desc' },
    { KPI_id: 'wall_se',          KPI_name: '銷售額/淨值(標準3.00)', KPI1: 2.0, KPI2: 3.0,  unit: '',   pct_type: 'desc' },
    // A值模型 (asc = 值高越危險)
    { KPI_id: 'a_total',          KPI_name: 'A值-總分(>25高風險)',  KPI1: 18,   KPI2: 25,   unit: '分', pct_type: 'asc' },
    { KPI_id: 'a_deficiency',     KPI_name: '管理缺陷代理分(0~43)', KPI1: 10,   KPI2: 20,   unit: '分', pct_type: 'asc' },
    { KPI_id: 'a_accounting',     KPI_name: '會計錯誤代理分(0~15)', KPI1: 5,    KPI2: 10,   unit: '分', pct_type: 'asc' },
    { KPI_id: 'a_symptom',        KPI_name: '破產徵兆代理分(0~42)', KPI1: 10,   KPI2: 20,   unit: '分', pct_type: 'asc' },
];

const BUs = ['HM', 'HN', 'SZ'];

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST, port: +process.env.DB_PORT,
        user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME
    });

    let inserted = 0, skipped = 0;
    for (const bu of BUs) {
        for (const k of NEW_KPIS) {
            // 先檢查是否已存在
            const [ex] = await conn.execute(
                'SELECT uid FROM mgm_kpi_desc WHERE bu_no=? AND KPI_id=?',
                [bu, k.KPI_id]
            );
            if (ex.length > 0) {
                // 已存在 → 更新門檻值
                await conn.execute(
                    'UPDATE mgm_kpi_desc SET KPI_name=?, KPI1=?, KPI2=?, unit=?, pct_type=? WHERE uid=?',
                    [k.KPI_name, k.KPI1, k.KPI2, k.unit, k.pct_type, ex[0].uid]
                );
                skipped++;
            } else {
                await conn.execute(
                    `INSERT INTO mgm_kpi_desc (bu_no, KPI_id, KPI_name, KPI1, KPI2, unit, pct_type)
                     VALUES (?,?,?,?,?,?,?)`,
                    [bu, k.KPI_id, k.KPI_name, k.KPI1, k.KPI2, k.unit, k.pct_type]
                );
                inserted++;
            }
        }
    }

    console.log(`✅ 完成：新增 ${inserted} 筆，更新 ${skipped} 筆（3 公司 × 12 指標 = 36 筆）`);

    // 驗證
    const [rows] = await conn.execute(
        "SELECT bu_no, KPI_id, KPI_name, KPI1, KPI2, pct_type, uid FROM mgm_kpi_desc WHERE KPI_id IN ('oa_working_asset','oa_cover_cl','oa_wc_ratio','oa_equity_debt','wall_score','wall_de','wall_af','wall_se','a_total','a_deficiency','a_accounting','a_symptom') ORDER BY bu_no, KPI_id"
    );
    console.table(rows);

    await conn.end();
})();
