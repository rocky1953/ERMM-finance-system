/**
 * 修正 mgm_kpi_desc 所有 KPI 的門檻值(KPI1/KPI2) + 判定方向(pct_type)
 * 根據 YG001~YG004 前端 YG_CONFIG + 正確財務公式
 * 執行：node database/fix_kpi_thresholds.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

// 正確的門檻（對應 YG_CONFIG 前端設定 + 財務理論）
const KPI_FIXES = {
    // ===== YG001 償債能力 =====
    current_ratio:    { KPI1: 2.0,  KPI2: 3.0,  pct_type: 'asc' },  // 流動比率 ≥2 健全
    quick_ratio:      { KPI1: 1.5,  KPI2: 3.0,  pct_type: 'asc' },  // 速動比率 ≥1.5 安全
    debt_ratio:       { KPI1: 50,   KPI2: 70,   pct_type: 'asc' }, // 負債比 <=50% 安全, 50-70% 注意, >70% 槓桿過高
    interest_cov:     { KPI1: 3.0,  KPI2: 10,   pct_type: 'asc' },  // 利息保障 ≥3 安全
    cash_ratio:       { KPI1: 10,   KPI2: 30,   pct_type: 'asc' },  // 現金比率 ≥20% 健全

    // ===== YG001 營運能力 =====
    inventory_turn:   { KPI1: 4,    KPI2: 12,   pct_type: 'asc' },  // 存貨周轉越高越好
    ar_turn:          { KPI1: 6,    KPI2: 20,   pct_type: 'asc' },  // 應收周轉越高越好
    ar_days:          { KPI1: 10,   KPI2: 60,   pct_type: 'desc' }, // 應收天數越少越好
    total_asset_turn: { KPI1: 0.5,  KPI2: 2.0,  pct_type: 'asc' },
    fixed_asset_turn: { KPI1: 0.5,  KPI2: 3.0,  pct_type: 'asc' },
    equity_turn:      { KPI1: 2,    KPI2: 5,    pct_type: 'asc' },
    cash_conv_days:   { KPI1: 0,    KPI2: 60,   pct_type: 'desc' },

    // ===== YG001 獲利能力 =====
    gross_profit:     { KPI1: 20,   KPI2: 45,   pct_type: 'asc' },  // 毛利率越高越好
    net_profit_margin:{ KPI1: 5,    KPI2: 20,   pct_type: 'asc' },  // 淨利率越高越好
    roa:              { KPI1: 3,    KPI2: 15,   pct_type: 'asc' },  // ROA 越高越好
    roe:              { KPI1: 8,    KPI2: 25,   pct_type: 'asc' },  // ROE 越高越好

    // ===== YG001 成長能力 =====
    sale_growth:      { KPI1: -10,  KPI2: 20,   pct_type: 'asc' },
    profit_growth:    { KPI1: -10,  KPI2: 25,   pct_type: 'asc' },
    capital_growth:   { KPI1: 1,    KPI2: 10,   pct_type: 'asc' },

    // ===== Z / BZ 模型 =====
    altman_z1:        { KPI1: 1.81, KPI2: 2.675, pct_type: 'asc' }, // Z1≥2.675 安全區
    altman_z2:        { KPI1: 1.1,  KPI2: 2.9,  pct_type: 'asc' },  // Z2≥2.9 安全區
    altman_ggr:       { KPI1: 1,    KPI2: 5,    pct_type: 'asc' },  // GGR≥5 優良
    bach_bz:          { KPI1: 0.5,  KPI2: 5,    pct_type: 'asc' },  // BZ≥5 健康

    // ===== 巴萨模型 =====
    bz_debt_ratio:    { KPI1: 2,    KPI2: 8,    pct_type: 'asc' },
    bz_receivable_turn:{KPI1: 1.5,  KPI2: 3.0,  pct_type: 'asc' },  // 流動比率
    bz_quick:         { KPI1: 0.8,  KPI2: 2.0,  pct_type: 'asc' },

    // ===== 營運資產模型（YG004 新增）=====
    oa_working_asset: { KPI1: 0,    KPI2: 0,    pct_type: 'desc' }, // 絕對金額，無固定門檻
    oa_cover_cl:      { KPI1: 0.5,  KPI2: 1.0,  pct_type: 'asc' },  // ≥1.0 安全
    oa_wc_ratio:      { KPI1: 0.1,  KPI2: 0.3,  pct_type: 'asc' },  // ≥30% 彈性足
    oa_equity_debt:   { KPI1: 0.5,  KPI2: 1.0,  pct_type: 'asc' },  // ≥1.0 穩健

    // ===== 沃爾比重模型 =====
    wall_score:       { KPI1: 80,   KPI2: 100,  pct_type: 'asc' },  // ≥100 優良
    wall_de:          { KPI1: 1.0,  KPI2: 1.5,  pct_type: 'asc' },
    wall_af:          { KPI1: 1.5,  KPI2: 2.5,  pct_type: 'asc' },
    wall_se:          { KPI1: 2.0,  KPI2: 3.0,  pct_type: 'asc' },

    // ===== A值模型（越高越危險 → asc）=====
    a_total:          { KPI1: 18,   KPI2: 25,   pct_type: 'desc' }, // ≤18 安全 (desc=值低=好)
    a_deficiency:     { KPI1: 10,   KPI2: 20,   pct_type: 'desc' }, // ≤10 安全
    a_accounting:     { KPI1: 5,    KPI2: 10,   pct_type: 'desc' }, // ≤5 安全
    a_symptom:        { KPI1: 10,   KPI2: 20,   pct_type: 'desc' }, // ≤10 安全
};

const BUs = ['HM', 'HN', 'SZ'];

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST, port: +process.env.DB_PORT,
        user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME
    });

    let updated = 0, inserted = 0, skipped = 0;
    for (const bu of BUs) {
        for (const [kpi_id, fix] of Object.entries(KPI_FIXES)) {
            const [rows] = await conn.execute(
                'SELECT uid FROM mgm_kpi_desc WHERE bu_no=? AND KPI_id=?', [bu, kpi_id]
            );
            if (rows.length > 0) {
                await conn.execute(
                    'UPDATE mgm_kpi_desc SET KPI1=?, KPI2=?, pct_type=? WHERE uid=?',
                    [fix.KPI1, fix.KPI2, fix.pct_type, rows[0].uid]
                );
                updated++;
            } else {
                await conn.execute(
                    'INSERT INTO mgm_kpi_desc (bu_no, KPI_id, KPI1, KPI2, pct_type) VALUES (?,?,?,?,?)',
                    [bu, kpi_id, fix.KPI1, fix.KPI2, fix.pct_type]
                );
                inserted++;
            }
        }
    }

    console.log(`✅ 完成：更新 ${updated} 筆，新增 ${inserted} 筆，跳過 ${skipped} 筆`);

    // 驗證
    const [all] = await conn.execute('SELECT bu_no,KPI_id,KPI1,KPI2,pct_type FROM mgm_kpi_desc WHERE bu_no=? AND KPI_id IN (?) ORDER BY KPI_id',
        ['HM', Object.keys(KPI_FIXES)]);
    console.table(all);

    await conn.end();
})();
