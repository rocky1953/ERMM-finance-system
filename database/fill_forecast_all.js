/**
 * 財務預測 forecast_detail 完整資料補全
 * 目標：HM / SZ / HN 三家公司，2024 和 2025 年度，1~12 月完整資料，
 *       涵蓋 Sales / Cost / Cash Flow 三種類型，共 3 × 2 × 12 × 3 = 216 筆
 * 策略：
 *   - 優先從 MGM_finance_summary 的 sale_amt / sale_cost_amt / net_profit_amt 取實際值
 *   - 預測值 = 實際值 × (0.85 ~ 1.15 浮動)
 *   - 若實際值不存在（某些月還沒錄），則用該公司該類型的年平均值作基底 + 季節性
 *   - diff_amt = forecast_amt - actual_amt（若無實際值則為 0）
 *
 * 用法：node database/fill_forecast_all.js
 */
const { pool } = require('../config/db');

const BU_NOS = ['HM', 'SZ', 'HN'];
const YEARS  = [2024, 2025];
const MONTHS = Array.from({length: 12}, (_, i) => String(i + 1).padStart(2, '0'));
const FC_TYPES = ['Sales', 'Cost', 'Cash Flow'];

// forecast_type → MGM_finance_summary 對應的實際值欄位
const ACTUAL_FIELD = {
    'Sales':     'sale_amt',
    'Cost':      'sale_cost_amt',
    'Cash Flow': 'net_profit_amt'
};

// 模擬時的季度性因子（1~12 月）：春夏季營運旺季偏高，年底結算月也高
const SEASON_FACTOR = [0.90, 0.88, 0.95, 1.00, 1.02, 1.05, 0.98, 1.00, 1.03, 1.05, 1.07, 1.10];

async function main() {
    console.log('🔄 財務預測資料補全開始...');

    // 1. 讀取全部已有的實際值
    const [actualRows] = await pool.execute(
        `SELECT bu_no, YYYY_MM, sale_amt, sale_cost_amt, net_profit_amt 
         FROM MGM_finance_summary 
         WHERE bu_no IN ('HM','SZ','HN') 
           AND (YYYY_MM LIKE '2024/%' OR YYYY_MM LIKE '2025/%')`
    );

    // 建立 Map 方便查詢
    const actualMap = {};  // key: `${bu_no}|${YYYY_MM}|${field}`, value: number
    actualRows.forEach(r => {
        Object.entries(ACTUAL_FIELD).forEach(([fcType, field]) => {
            const val = Number(r[field] || 0);
            actualMap[`${r.bu_no}|${r.YYYY_MM}|${field}`] = val;
        });
    });

    console.log(`   📋 已讀取 ${actualRows.length} 筆實際財務資料`);

    // 2. 為每家公司每種類型計算年平均值（無實際值時的 fallback 基底）
    const yearlyAvg = {};  // key: `${bu_no}|${year}|${field}`, value: number
    for (const bu of BU_NOS) {
        for (const year of YEARS) {
            for (const [fcType, field] of Object.entries(ACTUAL_FIELD)) {
                const vals = MONTHS.map(mm => {
                    const v = actualMap[`${bu}|${year}/${mm}|${field}`];
                    return v && v > 0 ? v : null;
                }).filter(v => v !== null);

                if (vals.length > 0) {
                    yearlyAvg[`${bu}|${year}|${field}`] = Math.round(
                        vals.reduce((a, b) => a + b, 0) / vals.length
                    );
                }
            }
        }
    }

    console.log(`   📊 年平均值計算完成`);

    // 3. 生成全部 216 筆資料
    const rows = [];
    const stats = { withActual: 0, simulated: 0, total: 0 };

    for (const bu of BU_NOS) {
        for (const year of YEARS) {
            for (const mm of MONTHS) {
                const ym = `${year}/${mm}`;
                const mIdx = parseInt(mm, 10) - 1;

                for (const fcType of FC_TYPES) {
                    const field = ACTUAL_FIELD[fcType];
                    let actual = actualMap[`${bu}|${ym}|${field}`] || 0;
                    let forecastAmt, diffAmt;

                    if (actual > 0) {
                        // 有實際值：預測 = 實際 × (0.85 ~ 1.15)
                        const factor = 0.85 + Math.random() * 0.3;
                        forecastAmt = Math.round(actual * factor);
                        diffAmt = forecastAmt - actual;
                        stats.withActual++;
                    } else {
                        // 無實際值：用年平均 + 季節性 + 隨機 ±10%
                        const avg = yearlyAvg[`${bu}|${year}|${field}`] || 1000000;
                        const seasonal = SEASON_FACTOR[mIdx];
                        const factor = 0.9 + Math.random() * 0.2;
                        forecastAmt = Math.round(avg * seasonal * factor);
                        diffAmt = 0;  // 無實際值時不記 diff
                        stats.simulated++;
                    }

                    rows.push([bu, ym, fcType, forecastAmt, diffAmt]);
                    stats.total++;
                }
            }
        }
    }

    console.log(`   📝 生成資料：${stats.withActual} 筆有實際值, ${stats.simulated} 筆模擬, 共 ${stats.total} 筆`);

    // 4. 批次寫入（UPSERT）
    const [r] = await pool.query(
        `INSERT INTO forecast_detail (bu_no, YYYY_MM, forecast_type, forecast_amt, diff_amt)
         VALUES ?
         ON DUPLICATE KEY UPDATE 
             forecast_amt = VALUES(forecast_amt),
             diff_amt     = VALUES(diff_amt)`,
        [rows]
    );

    console.log(`   ✅ 寫入完成，影響 ${r.affectedRows} 筆`);

    // 5. 驗證
    const [verify] = await pool.execute(
        `SELECT bu_no, forecast_type, COUNT(*) as cnt 
         FROM forecast_detail 
         WHERE bu_no IN ('HM','SZ','HN')
         GROUP BY bu_no, forecast_type
         ORDER BY bu_no, forecast_type`
    );
    console.log('\n📈 驗證結果（每組應 24 筆 = 2 年 × 12 月）:');
    console.table(verify);

    // 6. 抽樣顯示各公司 Sales 的預測 vs 實際
    for (const bu of BU_NOS) {
        for (const year of YEARS) {
            console.log(`\n  ${bu} / Sales / ${year}：`);
            const samples = rows
                .filter(([b, ym, t]) => b === bu && t === 'Sales' && ym.startsWith(`${year}/`))
                .map(([, ym, , fcAmt, diff]) => {
                    const actual = actualMap[`${bu}|${ym}|${ACTUAL_FIELD['Sales']}`] || 0;
                    return `    ${ym}: 預測 ${fcAmt.toLocaleString()} / 實際 ${actual.toLocaleString()} / diff ${diff.toLocaleString()}`;
                });
            samples.forEach(s => console.log(s));
        }
    }

    process.exit(0);
}

main().catch(err => {
    console.error('❌ 執行失敗:', err);
    console.error(err.stack);
    process.exit(1);
});
