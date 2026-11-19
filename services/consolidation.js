/**
 * 合併報表多幣種折算引擎
 * 
 * 設計原則：
 * - 集團本位幣 = RMB（可從 cams_system_codes.GROUP_CONFIG.BASE_CURRENCY 讀，DB 無配置則 fallback RMB）
 * - 每家公司本位幣從 cams_system_codes(COMPANY_CURRENCY) 讀；DB 無配置時三家 HM/HN/SZ 均視為 RMB
 * - 匯率一律用 rate_to_twd，所有公司折算到 base_currency 再加總
 * - 損益表/現金流量表用平均匯率（AVG）
 * - 資產負債表用期末匯率（END，若無 END 則 fallback AVG）
 * - 折算差異寫 consol_translation_diff，合併快照寫 consol_snapshot
 */
const { pool } = require('../config/db');

const r2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

// ================================================
// 匯率讀取與公司本位幣配置（cache 10s 避免每請求重複讀）
// ================================================
let _cache = { at: 0, baseCurrency: null, companyCurrency: null, rates: null };
async function reloadConfig(YYYY_MM) {
    if (_cache.at && Date.now() - _cache.at < 10000) return _cache;
    _cache.at = Date.now();

    const [grp] = await pool.execute(
        "SELECT value_description FROM cams_system_codes WHERE code_type='GROUP_CONFIG' AND code_value='BASE_CURRENCY'"
    );
    _cache.baseCurrency = (grp[0]?.value_description || 'RMB').trim().toUpperCase();

    const [bu] = await pool.execute(
        "SELECT code_value, value_description FROM cams_system_codes WHERE code_type='COMPANY_CURRENCY'"
    );
    _cache.companyCurrency = {};
    for (const b of bu) {
        // value_description 优先用纯币别代码（前端 codeTable.COMPANY_CURRENCY 已改为 listbox 存代码）；
        // 若无纯代码则从描述末尾兜底提取（兼容历史数据 "華南合併實業 人民幣" 格式）
        const pure = (b.value_description || '').trim().toUpperCase();
        if (/^(USD|EUR|RMB|CNY|JPY|GBP|HKD|AUD|CAD|CHF|SGD|KRW|TWD|INR|MYR|THB|IDR|PHP|NZD|SEK|NOK)$/.test(pure)) {
            _cache.companyCurrency[b.code_value] = pure === 'CNY' ? 'RMB' : pure;
        } else {
            const m = (b.value_description || '').match(/(RMB|CNY|TWD|HKD|USD|EUR|JPY|GBP|AUD|CAD|CHF|SGD|KRW|INR|MYR|THB|IDR|PHP|NZD|SEK|NOK)$/i);
            if (m) _cache.companyCurrency[b.code_value] = m[1].toUpperCase() === 'CNY' ? 'RMB' : m[1].toUpperCase();
        }
    }
    // 保底：DB 無配置時三家公司全部視為 RMB（實際帳戶均以人民幣入帳，無多幣折算需求）
    _cache.companyCurrency.HM = _cache.companyCurrency.HM || 'RMB';
    _cache.companyCurrency.HN = _cache.companyCurrency.HN || 'RMB';
    _cache.companyCurrency.SZ = _cache.companyCurrency.SZ || 'RMB';

    const [rateRows] = await pool.execute(
        "SELECT currency, rate_to_twd, rate_type FROM consol_exchange_rate WHERE YYYY_MM=?",
        [YYYY_MM]
    );
    _cache.rates = {};
    for (const r of rateRows) {
        if (!_cache.rates[r.currency]) _cache.rates[r.currency] = {};
        _cache.rates[r.currency][r.rate_type || 'AVG'] = Number(r.rate_to_twd);
    }
    return _cache;
}

// ================================================
// 單幣折算：amount * fromRate / toRate
// 所有匯率都是 rate_to_twd，所以 from→to 只需除法
// ================================================
function translate(amount, fromCurrency, toCurrency, rates, rateType) {
    if (!amount || !fromCurrency) return Number(amount || 0);
    if (fromCurrency === toCurrency) return Number(amount);

    const fallbackType = rateType === 'END' ? 'AVG' : 'AVG';
    const fromRate = rates[fromCurrency]?.[rateType] || rates[fromCurrency]?.[fallbackType] || 0;
    const toRate   = rates[toCurrency]?.[rateType]   || rates[toCurrency]?.[fallbackType]   || 0;

    if (!fromRate || !toRate) return Number(amount); // 缺匯率就不折算，保守返回原值

    // 都是 rate_to_twd，所以 fromCurrency 換 toCurrency = amount * fromRate / toRate
    return Number(amount) * fromRate / toRate;
}

// ================================================
// 折算一整行的財務數據（僅金額字段，非金額字段原樣保留）
// ================================================
const FINANCIAL_AMOUNT_FIELDS = [
    'sale_amt', 'sale_cost_amt', 'net_sale_amt',
    'sale_exp_amt', 'MGM_EXP_amt', 'finance_EXP_amt', 'operation_EXP_amt',
    'BIZ_major_margin_amt', 'BIZ_margin_amt', 'operation_profit_amt',
    'pretax_profit_amt', 'net_profit_amt', 'INVEST_profit_amt', 'others_INC_amt', 'others_cost_amt',
    'AR_affiliate_amt', 'AR_amt', 'AR_other_amt', 'AR_dividend_amt',
    'cash_amt', 'deposite_amt',
    'stock_P_amt', 'stock_M_amt', 'stock_S_amt', 'current_asset_amt', 'ttl_asset_amt',
    'AP_amt', 'loan_amt', 'LT_loan_amt', 'current_debet_amt', 'ttl_debet_amt',
    'captial_stock', 'accumulated_amt', 'stockholder_amt',
    // 現金流量
    'cash_begin_amt', 'cash_end_amt',
    'cash_operation_in', 'cash_operation_out',
    'cash_invest_in', 'cash_invest_out',
    'cash_finance_in', 'cash_finance_out'
];

function translateRow(row, fromCurrency, toCurrency, rates, rateType) {
    const out = { ...row };
    for (const f of FINANCIAL_AMOUNT_FIELDS) {
        if (row[f] !== undefined && row[f] !== null) {
            out[f] = r2(translate(row[f], fromCurrency, toCurrency, rates, rateType));
        }
    }
    out._translated = true;
    out._from_currency = fromCurrency;
    out._rate_type = rateType;
    return out;
}

// ================================================
// 批量折算：返回 { rows, rate_breakdown, base_currency, missing_rates }
// rate_breakdown 每家公司的匯率，用於前端展示
// ================================================
async function translateRows(YYYY_MM, rows, rateType) {
    const cfg = await reloadConfig(YYYY_MM);
    const { baseCurrency, companyCurrency, rates } = cfg;

    const missingRates = [];
    const rateBreakdown = {};
    const translated = rows.map(r => {
        const fromCur = companyCurrency[r.bu_no] || baseCurrency; // 找不到公司幣別就不折算
        const rate = rates[fromCur]?.[rateType] || rates[fromCur]?.['AVG'] || null;
        if (!rate && fromCur !== baseCurrency) {
            missingRates.push({ currency: fromCur, rateType, bu_no: r.bu_no });
        }
        rateBreakdown[r.bu_no] = { from_currency: fromCur, to_currency: baseCurrency, rate, rate_type: rateType };
        return translateRow(r, fromCur, baseCurrency, rates, rateType);
    });

    return { rows: translated, rateBreakdown, base_currency: baseCurrency, companyCurrency, missingRates };
}

// ================================================
// 計算折算差異：期末資產負債表折算 vs 期初資產負債表折算 vs 損益折算
// 差異累計到 consol_translation_diff
// ================================================
async function computeTranslationDiff(YYYY_MM, balanceRows, incomeRows) {
    const cfg = await reloadConfig(YYYY_MM);
    const { baseCurrency, companyCurrency, rates } = cfg;
    const prevMonth = getPrevMonth(YYYY_MM);

    const [prevRows] = await pool.execute(
        "SELECT bu_no, net_profit_amt, ttl_asset_amt, ttl_debet_amt, stockholder_amt FROM mgm_finance_summary WHERE YYYY_MM=? AND bu_no IN ('HM','HN','SZ')",
        [prevMonth]
    );

    const companyDiffs = [];
    let totalDiff = 0;

    for (const r of balanceRows) {
        const fromCur = companyCurrency[r.bu_no] || baseCurrency;
        if (fromCur === baseCurrency) continue; // 同幣別無差異

        const rateEnd = rates[fromCur]?.['END'] || rates[fromCur]?.['AVG'] || 0;
        const rateAvg = rates[fromCur]?.['AVG'] || 0;
        if (!rateEnd || !rateAvg) continue;

        const equityConverted = translate(r.ttl_asset_amt - r.ttl_debet_amt, fromCur, baseCurrency, rates, 'END');
        const incomeConverted = translate(r.net_profit_amt, fromCur, baseCurrency, rates, 'AVG');
        const assetConverted  = translate(r.ttl_asset_amt, fromCur, baseCurrency, rates, 'END');

        // 期末折算後股東權益 − 期初折算後股東權益（≈ 本期淨利折算後）的差額 = 折算差異
        const prev = prevRows.find(p => p.bu_no === r.bu_no);
        const prevEquity = prev
            ? translate(prev.ttl_asset_amt - prev.ttl_debet_amt, fromCur, baseCurrency, rates, 'END')
            : 0;
        const diff = r2(equityConverted - prevEquity - incomeConverted);
        totalDiff = r2(totalDiff + diff);

        companyDiffs.push({
            bu_no: r.bu_no, from_currency: fromCur, base_currency: baseCurrency,
            rate_end: rateEnd, rate_avg: rateAvg,
            equity_converted: r2(equityConverted),
            income_converted: r2(incomeConverted),
            asset_converted: r2(assetConverted),
            prev_equity_converted: r2(prevEquity),
            diff_amount: diff
        });
    }

    return { companyDiffs, totalDiff, base_currency: baseCurrency };
}

// ================================================
// 保存折算差異 + 累計
// ================================================
async function saveTranslationDiff(YYYY_MM, companyDiffs) {
    const prevMonth = getPrevMonth(YYYY_MM);
    for (const d of companyDiffs) {
        const [[prev]] = await pool.execute(
            "SELECT cumul_diff FROM consol_translation_diff WHERE YYYY_MM=? AND bu_no=?",
            [prevMonth, d.bu_no]
        );
        const prevCumul = Number(prev?.cumul_diff || 0);
        const cumulDiff = r2(prevCumul + d.diff_amount);
        await pool.execute(
            `INSERT INTO consol_translation_diff
             (YYYY_MM, bu_no, base_currency, equity_converted, income_converted, asset_converted,
              rate_end, rate_avg, diff_amount, cumul_diff)
             VALUES (?,?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
              equity_converted=VALUES(equity_converted),
              income_converted=VALUES(income_converted),
              asset_converted=VALUES(asset_converted),
              rate_end=VALUES(rate_end), rate_avg=VALUES(rate_avg),
              diff_amount=VALUES(diff_amount), cumul_diff=VALUES(cumul_diff)`,
            [YYYY_MM, d.bu_no, d.base_currency, d.equity_converted, d.income_converted,
             d.asset_converted, d.rate_end, d.rate_avg, d.diff_amount, cumulDiff]
        );
    }
}

// ================================================
// 合併報表快照明細（供董事會報告包追溯）
// ================================================
async function saveSnapshot({ YYYY_MM, snapshot_type, data_json, elim_total, transl_diff, generated_by, board_pack_id }) {
    const [existed] = await pool.execute(
        "SELECT MAX(version_no) v FROM consol_snapshot WHERE YYYY_MM=? AND snapshot_type=? AND bu_no='GROUP'",
        [YYYY_MM, snapshot_type]
    );
    const versionNo = (Number(existed[0]?.v) || 0) + 1;
    const cfg = await reloadConfig(YYYY_MM);

    const [r] = await pool.execute(
        `INSERT INTO consol_snapshot
         (YYYY_MM, snapshot_type, base_currency, bu_no, version_no, data_json, elim_total, transl_diff, generated_by, board_pack_id)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [YYYY_MM, snapshot_type, cfg.baseCurrency, 'GROUP', versionNo, JSON.stringify(data_json), elim_total || 0, transl_diff || 0, generated_by || 'system', board_pack_id || null]
    );
    return r.insertId;
}

// ================================================
// 抵消分錄自動匹配建議（從 fin_voucher 內部交易科目掃描）
// 規則：fin_voucher_entry 裡的內部科目，ruid 或 subject_name 對應某家公司
// ================================================
async function generateElimSuggestions(YYYY_MM) {
    const [[companies]] = await pool.execute(
        "SELECT code_value FROM cams_system_codes WHERE code_type='COMPANY_CURRENCY' ORDER BY sort_no"
    );
    const companyNos = Object.values(companies || {});
    if (!companyNos.length) return { count: 0, rows: [] };

    const [vouchers] = await pool.execute(
        `SELECT v.voucher_id, v.voucher_no, v.ruid, v.bu_no, v.voucher_date, e.entry_id, e.subject_code, e.subject_name, e.debit, e.credit, e.summary
         FROM fin_voucher v
         JOIN fin_voucher_entry e ON v.voucher_id = e.voucher_id
         WHERE v.YYYY_MM=? AND e.ruid REGEXP '^[A-Z][A-Z0-9]*$' AND (e.debit > 0 OR e.credit > 0)
         ORDER BY v.voucher_date, v.voucher_no`,
        [YYYY_MM]
    );

    const [[internalSubjects]] = await pool.execute(
        "SELECT code_value FROM cams_system_codes WHERE code_type='INTERNAL_SUBJECT'"
    );
    const internalTypes = Object.values(internalSubjects || {});

    const pairs = {};
    for (const v of vouchers) {
        // 簡化策略：如果同一憑證有兩家不同公司的 ruid，且金額方向相反，記為一對抵消
        const pairKey = v.voucher_id;
        if (!pairs[pairKey]) pairs[pairKey] = { from: [], to: [] };
        // 暫時只做標記，實際成對匹配由業務確認
    }

    // 寫入 consol_elim_suggest
    for (const [voucherId, pair] of Object.entries(pairs)) {
        // TODO: 真正的內部交易成對邏輯需要科目碼對照表，先只佔表
    }

    return { count: 0, rows: [] };
}

function getPrevMonth(YYYY_MM) {
    const [y, m] = YYYY_MM.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

module.exports = {
    reloadConfig,
    translate,
    translateRow,
    translateRows,
    computeTranslationDiff,
    saveTranslationDiff,
    saveSnapshot,
    generateElimSuggestions,
    r2
};