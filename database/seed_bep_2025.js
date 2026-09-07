/**
 * BEP 損益平衡分析 - 正式測試資料種子腳本
 *
 * 基準來源: CW397 [2014/11] 損益平衡試算分析圖片 (HM 公司原始值)
 * 策略:
 *   1) 清除歷史垃圾數據
 *   2) HM 全年 12 個月用 CW397 原始值（期間成本結構月波動不大）
 *   3) HN / SZ 按各公司各月 sale_amt 相對 HM 2025/12 的比例縮放
 *      固定成本用公司級基准值（不隨月份大幅波動）
 *   4) 用 ON DUPLICATE KEY UPDATE 確保可重複執行
 *
 * 執行: node database/seed_bep_2025.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

// === HM 基準 (CW397 原圖) ===
// sale_amt 參考 = 32,966,679.60 (HM 2025/12)
const HM_BASE = {
    consumable:        1296206.36,
    packaging:          142720.31,
    processing:              500.00,   // 小額固定
    misc_purchase:       598049.55,
    freight:                 500.00,   // 小額固定
    customs:            361949.49,
    service_part_comp: 1102926.29,
    variable_expense:   3581202.00,
    fixed_cost:        14040578.64
};

// === 各公司固定成本基准 ===
// HN 規模約 42% → 固定成本約 35%（固定成本非線性）
// SZ 規模約 67% → 固定成本約 60%
const BU_FIXED_COST = {
    HM: HM_BASE.fixed_cost,
    HN: Math.round(HM_BASE.fixed_cost * 0.35 * 100) / 100,   // 4,914,202.52
    SZ: Math.round(HM_BASE.fixed_cost * 0.60 * 100) / 100    // 8,424,347.18
};

// === 浮動項目（按 sale_amt 比例縮放）基准 ===
// sale_amt 32,966,679.60 時的比例
const FLOAT_RATIOS = {
    consumable:        HM_BASE.consumable        / 32966679.60,   //  3.93%
    packaging:          HM_BASE.packaging        / 32966679.60,   //  0.43%
    misc_purchase:       HM_BASE.misc_purchase   / 32966679.60,   //  1.81%
    customs:            HM_BASE.customs          / 32966679.60,   //  1.10%
    service_part_comp:  HM_BASE.service_part_comp / 32966679.60,   //  3.35%
    variable_expense:   HM_BASE.variable_expense  / 32966679.60    // 10.86%
};

// 小額固定項目（加工費、運費）不隨銷售額變化
const SMALL_FIXED = {
    processing: 500,
    freight:     500
};

function round2(n) {
    return Math.round(Number(n) * 100) / 100;
}

// 根據 bu_no + sale_amt 生成完整 BEP 門檻
function genBEP(bu_no, sale_amt) {
    if (bu_no === 'HM') {
        // HM 直接用 CW397 原始值
        return { ...HM_BASE };
    }

    // HN / SZ 按比例縮放
    const sale = Number(sale_amt) || 0;
    return {
        consumable:        round2(sale * FLOAT_RATIOS.consumable),
        packaging:          round2(sale * FLOAT_RATIOS.packaging),
        processing:              SMALL_FIXED.processing,
        misc_purchase:       round2(sale * FLOAT_RATIOS.misc_purchase),
        freight:                 SMALL_FIXED.freight,
        customs:            round2(sale * FLOAT_RATIOS.customs),
        service_part_comp:  round2(sale * FLOAT_RATIOS.service_part_comp),
        variable_expense:   round2(sale * FLOAT_RATIOS.variable_expense),
        fixed_cost:                 BU_FIXED_COST[bu_no]
    };
}

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '3306'),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'ERMM_db',
        multipleStatements: false
    });

    console.log('=== BEP Seed 開始 ===\n');

    // Step 1: 清除垃圾數據（測試殘留 + 2026/09 無效月份）
    const [del] = await conn.execute(
        `DELETE FROM MGM_BEP_threshold
         WHERE YYYY_MM >= '2026/01' OR YYYY_MM < '2024/09'`
    );
    console.log(`Step 1 清除垃圾數據: 刪除 ${del.affectedRows} 筆 (2026年+2023年)`);

    // 把 2025/02 那筆垃圾（fx=25億）也清掉，之後重新用 HM 基準生成
    const [del2] = await conn.execute(
        `DELETE FROM MGM_BEP_threshold WHERE bu_no='HM' AND YYYY_MM='2025/02' AND fixed_cost > 100000000`
    );
    console.log(`Step 1b 清除 HM 2025/02 垃圾 fx>1億: 刪除 ${del2.affectedRows} 筆`);

    // Step 2: 取出所有有 sale_amt 的月份
    const [summary] = await conn.execute(
        `SELECT bu_no, YYYY_MM, sale_amt
         FROM MGM_finance_summary
         WHERE sale_amt > 0
         ORDER BY bu_no, YYYY_MM`
    );
    console.log(`\nStep 2 找出 sale_amt > 0 的記錄: ${summary.length} 筆`);

    // Step 3: 批量 upsert
    const upsertSql = `INSERT INTO MGM_BEP_threshold
        (bu_no, YYYY_MM, consumable, packaging, processing, misc_purchase,
         freight, customs, service_part_comp, variable_expense, fixed_cost, remark)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE
            consumable=VALUES(consumable), packaging=VALUES(packaging),
            processing=VALUES(processing), misc_purchase=VALUES(misc_purchase),
            freight=VALUES(freight), customs=VALUES(customs),
            service_part_comp=VALUES(service_part_comp),
            variable_expense=VALUES(variable_expense),
            fixed_cost=VALUES(fixed_cost), remark=VALUES(remark)`;

    let success = 0;
    for (const row of summary) {
        const bu = row.bu_no;
        const ym = row.YYYY_MM;
        const sale = Number(row.sale_amt);
        const bep = genBEP(bu, sale);

        await conn.execute(upsertSql, [
            bu, ym,
            bep.consumable, bep.packaging, bep.processing, bep.misc_purchase,
            bep.freight, bep.customs, bep.service_part_comp,
            bep.variable_expense, bep.fixed_cost,
            bu === 'HM' ? 'CW397基準' : '按銷售比例縮放'
        ]);
        success++;
        console.log(`  ✓ ${bu} ${ym} sale=${sale.toLocaleString()} fx=${bep.fixed_cost.toLocaleString()} mat=${(bep.consumable+bep.packaging+bep.processing+bep.misc_purchase+bep.freight+bep.customs+bep.service_part_comp).toLocaleString()}`);
    }

    // Step 4: 驗證結果
    const [verify] = await conn.execute(
        `SELECT t.bu_no, t.YYYY_MM, t.consumable, t.fixed_cost,
                s.sale_amt
         FROM MGM_BEP_threshold t
         LEFT JOIN MGM_finance_summary s
           ON t.bu_no=s.bu_no AND t.YYYY_MM=s.YYYY_MM
         ORDER BY t.bu_no, t.YYYY_MM`
    );
    console.log(`\nStep 4 驗證 — MGM_BEP_threshold 共 ${verify.length} 筆:`);
    for (const r of verify) {
        const mat = Number(r.consumable) > 0 ? 'OK' : '⚠️ 零';
        console.log(`  ${r.bu_no} ${r.YYYY_MM}  fx=${Number(r.fixed_cost).toLocaleString()}  sale=${Number(r.sale_amt||0).toLocaleString()}  ${mat}`);
    }

    await conn.end();
    console.log(`\n=== BEP Seed 完成: ${success} 筆 upsert ===`);
})().catch(e => console.error('SEED FAILED:', e.message));
