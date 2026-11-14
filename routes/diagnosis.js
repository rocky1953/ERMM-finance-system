/**
 * 異常自動診斷路由
 * 當 KPI 指標異常時，自動分析 Top3 拖累原因（公司別 / 月份 / 科目貢獻度）
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const { chatCompletion, getDefaultProvider } = require('../utils/llmClient');

// 指標口徑設定（對應 mgm_finance_summary 欄位）
const KPI_DEF = {
    gross_profit: {
        name: '銷售毛利率',
        formula: (s) => s.sale_amt > 0 ? (s.sale_amt - s.sale_cost_amt) / s.sale_amt * 100 : 0,
        threshold: 25, unit: '%',
        formulaText: '(銷售收入 − 銷售成本) / 銷售收入 × 100%'
    },
    net_profit_margin: {
        name: '銷售淨利率',
        formula: (s) => s.sale_amt > 0 ? (s.net_profit_amt || 0) / s.sale_amt * 100 : 0,
        threshold: 8, unit: '%',
        formulaText: '淨利潤 / 銷售收入 × 100%'
    },
    current_ratio: {
        name: '流動比率',
        formula: (s) => (s.current_asset_amt || 0) / Math.max(1, s.current_debet_amt || s.AP_amt || 1),
        threshold: 1.5, unit: '',
        formulaText: '流動資產 / 流動負債'
    },
    debt_ratio: {
        name: '負債比率',
        formula: (s) => {
            const debt = s.ttl_debet_amt || (s.loan_amt || 0) + (s.AP_amt || 0) + (s.LT_loan_amt || 0);
            return debt * 100 / Math.max(1, s.ttl_asset_amt || 1);
        },
        threshold: 70, unit: '%', inverse: true,
        formulaText: '總負債 / 總資產 × 100%'
    },
    ar_turn: {
        name: '應收帳款周轉率',
        formula: (s) => (s.sale_amt || 0) / Math.max(1, s.AR_amt || 1),
        threshold: 4, unit: '',
        formulaText: '銷售收入 / 應收帳款'
    },
    roe: {
        name: '權益報酬率 ROE',
        formula: (s) => {
            const eq = s.stockholder_amt || (s.captial_stock || 0) + (s.captial_reserve || 0) + (s.accumulated_amt || 0);
            return (s.sale_exp_amt || 0) * 100 / Math.max(1, eq);
        },
        threshold: 8, unit: '%',
        formulaText: '淨利 / 股東權益 × 100%'
    },
    // ===== 風險預警頁其餘指標 =====
    z_score: {
        name: 'Z-Score (Altman)', formula: (s) => Number(s.Z_score || 0), threshold: 1.23, unit: '',
        formulaText: '1.2X1 + 1.4X2 + 3.3X3 + 0.6X4 + 1.0X5'
    },
    z2_score: {
        name: 'Z2-Score (私人公司)', formula: (s) => Number(s.Z2_score || 0), threshold: 1.23, unit: '',
        formulaText: '0.717X1 + 0.847X2 + 3.107X3 + 0.420X4 + 0.998X5'
    },
    z3_score: {
        name: 'Z3-Score (非製造業)', formula: (s) => Number(s.Z3_score || 0), threshold: 1.1, unit: '',
        formulaText: '6.56X1 + 3.26X2 + 6.72X3 + 1.05X4'
    },
    bz_model: {
        name: 'BZ 破產概率', formula: (s) => Number(s.BZ_model || 0), threshold: 0, unit: '',
        formulaText: 'BZ 破產概率模型（負值代表高風險）'
    },
    jz_model: {
        name: 'JZ 營運能力', formula: (s) => Number(s.JZ_model || 0), threshold: 0, unit: '',
        formulaText: 'JZ 營運能力模型（負值代表高風險）'
    },
    revenue_yoy: {
        name: '營收同比', formula: (s, ly) => Number(ly || 0) > 0 ? (Number(s.sale_amt || 0) - Number(ly)) / Number(ly) * 100 : 0,
        threshold: 0, unit: '%',
        formulaText: '(本月營收 − 去年同月營收) / 去年同月營收 × 100%'
    },
    interest_cover: {
        name: '利息保障倍數',
        formula: (s) => Number(s.finance_EXP_amt || 0) > 0 ? Number(s.operation_profit_amt || 0) / Number(s.finance_EXP_amt) : 0,
        threshold: 1.5, unit: '',
        formulaText: '營業利潤 / 財務費用'
    },
    ar_days: {
        name: '應收週轉天數',
        formula: (s) => Number(s.sale_amt || 0) > 0 ? Number(s.AR_amt || 0) / Number(s.sale_amt) * 30 : 0,
        threshold: 60, unit: '天', inverse: true,
        formulaText: '應收帳款 / 銷售收入 × 30 天'
    },
    inv_days: {
        name: '存貨週轉天數',
        formula: (s) => Number(s.sale_cost_amt || 0) > 0 ? Number(s.stock_value_amt || 0) / Number(s.sale_cost_amt) * 30 : 0,
        threshold: 60, unit: '天', inverse: true,
        formulaText: '存貨 / 銷售成本 × 30 天'
    },
    cash_quality: {
        name: '淨利現金含量',
        formula: (s) => {
            const ocf = Number(s.cash_operation_in || 0) - Number(s.cash_operation_out || 0);
            return Number(s.net_profit_amt || 0) !== 0 ? ocf / Number(s.net_profit_amt) : 0;
        },
        threshold: 0, unit: '', inverse: true,
        formulaText: '經營現金流淨額 / 淨利潤'
    }
};

// 異常診斷：回傳 Top3 原因
router.get('/kpi', async (req, res) => {
    try {
        const { bu_no, YYYY_MM, kpi_id, lang } = req.query;
        if (!bu_no || !YYYY_MM || !kpi_id) return fail(res, '需要 bu_no, YYYY_MM, kpi_id');
        const result = await runDiagnosis(bu_no, YYYY_MM, kpi_id, lang);
        ok(res, result);
    } catch (err) { fail500(res, err); }
});

// 內部：執行指標診斷（規則引擎），供 /kpi 與 /ai-attribution 共用
async function runDiagnosis(bu_no, YYYY_MM, kpi_id, lang = 'zh-TW') {
    const def = KPI_DEF[kpi_id];
    if (!def) throw new Error(`不支援的指標: ${kpi_id}`);

    const [curRows] = await pool.execute(
        'SELECT * FROM mgm_finance_summary WHERE bu_no=? AND YYYY_MM=?', [bu_no, YYYY_MM]
    );
    if (curRows.length === 0) throw new Error('該月摘要不存在');
    const cur = curRows[0];
    const lyCur = await getLastYearSale(bu_no, YYYY_MM);
    const curVal = def.formula(cur, lyCur);

    const dt = new Date(YYYY_MM + '-01');
    dt.setMonth(dt.getMonth() - 1);
    const prevYM = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    const [prevRows] = await pool.execute(
        'SELECT * FROM mgm_finance_summary WHERE bu_no=? AND YYYY_MM=?', [bu_no, prevYM]
    );
    const prev = prevRows[0] || null;
    const lyPrev = prev ? await getLastYearSale(bu_no, prevYM) : null;
    const prevVal = prev ? def.formula(prev, lyPrev) : null;
    const change = prevVal !== null ? Math.round((curVal - prevVal) * 100) / 100 : null;

    const isAnomaly = def.inverse ? curVal > def.threshold : curVal < def.threshold;

    const reasons = generateReasons(kpi_id, cur, prev, change, lang);
    const kpiName = (KPI_NAME[kpi_id] && KPI_NAME[kpi_id][lang]) || def.name;
    const unit = def.unit === '天' && lang === 'en' ? 'd' : def.unit;
    return {
        kpi_id, kpi_name: kpiName,
        current_value: Math.round(curVal * 100) / 100,
        threshold: def.threshold,
        unit,
        prev_value: prevVal !== null ? Math.round(prevVal * 100) / 100 : null,
        change,
        is_anomaly: isAnomaly,
        level: !isAnomaly ? 'normal' : (Math.abs(change || 0) > 5 ? 'danger' : 'warning'),
        formula: def.formulaText || '',
        top_reasons: reasons,
        _cur: cur, _prev: prev
    };
}

// 去年同月銷售額（營收同比用）
async function getLastYearSale(bu_no, YYYY_MM) {
    const y = Number(String(YYYY_MM).slice(0, 4)) - 1;
    const ym = `${y}${String(YYYY_MM).slice(4)}`;
    const [rows] = await pool.execute(
        'SELECT sale_amt FROM mgm_finance_summary WHERE bu_no=? AND YYYY_MM=?', [bu_no, ym]
    );
    return rows.length ? Number(rows[0].sale_amt || 0) : null;
}

// AI 智能歸因：把規則引擎的 Top3 原因與財務上下文交給 LLM，輸出自然語言根因解釋與建議
router.post('/ai-attribution', async (req, res) => {
    try {
        const { bu_no, YYYY_MM, kpi_id, lang } = req.body;
        if (!bu_no || !YYYY_MM || !kpi_id) return fail(res, '需要 bu_no, YYYY_MM, kpi_id');

        // 1. 規則引擎診斷
        const d = await runDiagnosis(bu_no, YYYY_MM, kpi_id, lang);
        const cur = d._cur;

        // 2. 取得預設 LLM（is_default=1 優先，否則第一個 USE 狀態）
        const cfg = await getDefaultProvider(pool);
        if (!cfg) return fail(res, '尚未設定任何 LLM 服務商的 API Key，請至「系統設定 → API Key 管理」設定');

        // 3. 依使用者介面語言決定 LLM 回覆語言
        const langMap = {
            'zh-TW': { name: '繁體中文', rootLabel: '根因解釋（200~400 字）', sugLabel: '改進建議（以「建議1：」「建議2：」「建議3：」開頭，每條 1~2 句）' },
            'zh-CN': { name: '简体中文', rootLabel: '根因解释（200~400 字）', sugLabel: '改进建议（以「建议1：」「建议2：」「建议3：」开头，每条 1~2 句）' },
            'en':    { name: 'English', rootLabel: 'Root cause explanation (200~400 words)', sugLabel: 'Improvement suggestions (start each with "Suggestion 1:", "Suggestion 2:", "Suggestion 3:")' }
        };
        const lm = langMap[lang] || langMap['zh-TW'];

        // 4. 組裝上下文
        const num = (v) => Number(v || 0);
        const ctx = {
            公司別: bu_no, 期間: YYYY_MM,
            指標: d.kpi_name,
            指標口徑: d.formula || '-',
            當期值: `${d.current_value}${d.unit}`,
            門檻: `${d.threshold}${d.unit}`,
            上期值: d.prev_value !== null ? `${d.prev_value}${d.unit}` : '無',
            變動: d.change !== null ? `${d.change > 0 ? '+' : ''}${d.change}${d.unit}` : '無',
            是否異常: d.is_anomaly ? '是' : '否',
            銷售收入: num(cur.sale_amt).toFixed(0),
            銷售成本: num(cur.sale_cost_amt).toFixed(0),
            毛利: (num(cur.sale_amt) - num(cur.sale_cost_amt)).toFixed(0),
            淨利: num(cur.net_profit_amt).toFixed(0),
            應收帳款: num(cur.AR_amt).toFixed(0),
            銀行借款: num(cur.loan_amt).toFixed(0),
            總資產: num(cur.ttl_asset_amt).toFixed(0),
            總負債: num(cur.ttl_debet_amt).toFixed(0),
            股東權益: num(cur.stockholder_amt).toFixed(0),
            Z因子: `X1=${num(cur.Z_X1).toFixed(4)}, X2=${num(cur.Z_X2).toFixed(4)}, X3=${num(cur.Z_X3).toFixed(4)}, X4=${num(cur.Z_X4).toFixed(4)}, X5=${num(cur.Z_X5).toFixed(4)}`,
            JZ因子: `ZA=${num(cur.JZ_ZA).toFixed(4)}, ZB=${num(cur.JZ_ZB).toFixed(4)}, ZC=${num(cur.JZ_ZC).toFixed(4)}, ZD=${num(cur.JZ_ZD).toFixed(4)}`,
            Top3拖累原因: d.top_reasons.map(r => `${r.rank}. [${r.dim}] ${r.desc}（影響：${r.impact}；建議：${r.suggestion}）`)
        };

        // 5. 呼叫 LLM
        const messages = [
            { role: 'system', content: `你是一位資深財務分析顧問。請依據提供的財務資料與規則引擎分析出的 Top3 拖累原因，用自然語言說明該指標異常的「根因」，並給出 3 條可執行的改進建議。請以${lm.name}回答，結構清晰，避免空泛。` },
            { role: 'user', content: `財務資料與診斷結果：\n${JSON.stringify(ctx, null, 2)}\n\n請輸出：\n1. ${lm.rootLabel}\n2. ${lm.sugLabel}` }
        ];
        const content = await chatCompletion(
            { base_url: cfg.base_url, api_key: cfg.api_key, model: cfg.model },
            messages,
            { temperature: 0.3, max_tokens: 2048, timeout: 60000 }
        );

        // 5. 解析建議（若模型有按格式輸出）
        const suggestionMatches = content.match(/(?:建議|建议|Suggestion)\s*[1-3][：:]\s*.+/g);
        const suggestions = suggestionMatches
            ? suggestionMatches.map(s => s.replace(/^(?:建議|建议|Suggestion)\s*[1-3][：:]\s*/, '').trim())
            : [];

        ok(res, {
            explanation: content,
            suggestions,
            provider: cfg.provider_name,
            model: cfg.model
        });
    } catch (err) {
        if (err.message && err.message.includes('API Key')) return fail(res, err.message);
        fail500(res, err);
    }
});

// 现金流預測 AI 智能歸因：接收 Monte Carlo 結果，規則引擎給 Top3 拖累原因，LLM 出自然語言解釋
router.post('/cash-attribution', async (req, res) => {
    try {
        const { bu_no, lang, mc, stressRev = 0, stressCost = 0, safe_level = 0, point_summary } = req.body;
        if (!bu_no || !mc) return fail(res, '需要 bu_no 與 mc');

        const cfg = await getDefaultProvider(pool);
        if (!cfg) return fail(res, '尚未設定任何 LLM 服務商的 API Key，請至「系統設定 → API Key 管理」設定');

        // 規則引擎：Top3 拖累原因
        const reasons = cashTopReasons(mc, safe_level, stressRev, stressCost, point_summary, lang);

        const langMap = {
            'zh-TW': { name: '繁體中文', root: '根因解釋（200~300 字）', sug: '改進建議（以「建議1：」「建議2：」「建議3：」開頭，每條 1~2 句）' },
            'zh-CN': { name: '简体中文', root: '根因解释（200~300 字）', sug: '改进建议（以「建议1：」「建议2：」「建议3：」开头，每条 1~2 句）' },
            'en':    { name: 'English', root: 'Root cause (200~300 words)', sug: 'Suggestions (each starts with "Suggestion 1:", "Suggestion 2:", "Suggestion 3:")' }
        };
        const lm = langMap[lang] || langMap['zh-TW'];

        const ctx = {
            公司別: bu_no,
            is_anomaly: (mc.prob_all || 0) > 5,
            '整体风险概率_13周': `${(mc.prob_all || 0).toFixed(1)}%`,
            '4周内缺口概率': `${(mc.prob_4w || 0).toFixed(1)}%`,
            '8周内缺口概率': `${(mc.prob_8w || 0).toFixed(1)}%`,
            最高风险周: `W${mc.max_gap_week || '-'}（${(mc.max_gap_prob || 0).toFixed(1)}%）`,
            安全水位: `${Number(safe_level || 0).toFixed(0)}`,
            当前余额: point_summary ? Number(point_summary.current_balance || 0).toFixed(0) : '-',
            '13周最低余额_点估计': point_summary ? Number(point_summary.min_balance || 0).toFixed(0) : '-',
            AR周期_天: mc.ar_days,
            AP周期_天: mc.ap_days,
            压力测试: `收入下降 ${stressRev}% / 支出上升 ${stressCost}%`,
            'Top3拖累原因': reasons.map(r => `${r.rank}. [${r.dim}] ${r.desc}（影響：${r.impact}；建議：${r.suggestion}）`)
        };

        const messages = [
            { role: 'system', content: `你是資深財務分析顧問，專精現金流風險管理。請依據提供的 Monte Carlo 現金流預測結果與規則引擎的 Top3 拖累原因，用${lm.name}輸出：1) ${lm.root}，2) ${lm.sug}。結構清晰，避免空泛。` },
            { role: 'user', content: `現金流風險資料與診斷結果：\n${JSON.stringify(ctx, null, 2)}` }
        ];
        const content = await chatCompletion(
            { base_url: cfg.base_url, api_key: cfg.api_key, model: cfg.model },
            messages,
            { temperature: 0.3, max_tokens: 2048, timeout: 60000 }
        );

        const suggestionMatches = content.match(/(?:建議|建议|Suggestion)\s*[1-3][：:]\s*.+/g);
        const suggestions = suggestionMatches
            ? suggestionMatches.map(s => s.replace(/^(?:建議|建议|Suggestion)\s*[1-3][：:]\s*/, '').trim())
            : [];

        ok(res, { explanation: content, suggestions, top_reasons: reasons, provider: cfg.provider_name, model: cfg.model });
    } catch (err) {
        if (err.message && err.message.includes('API Key')) return fail(res, err.message);
        fail500(res, err);
    }
});

// 現金流風險 Top3 拖累原因（規則引擎）
function cashTopReasons(mc, safe_level, stressRev, stressCost, point, lang = 'zh-TW') {
    const reasons = [];
    const w13 = mc.weekly && mc.weekly[12] ? mc.weekly[12] : {};
    const inflow = (mc.ar_avg_weekly || 0);
    const outflow = (mc.ap_avg_weekly || 0);
    const netWeekly = inflow - outflow;

    // 1) 周均淨流入（流入-流出）若為負，直接拉高 13 周概率
    if (netWeekly < 0) {
        reasons.push({
            rank: 1, dim: tr(lang, '週均淨現金流', '周均净现金流', 'Weekly Net Cash Flow'),
            desc: tr(lang,
                `週均流入 ${inflow.toFixed(0)} < 週均流出 ${outflow.toFixed(0)}，淨流出 ${(-netWeekly).toFixed(0)}`,
                `周均流入 ${inflow.toFixed(0)} < 周均流出 ${outflow.toFixed(0)}，净流出 ${(-netWeekly).toFixed(0)}`,
                `weekly inflow ${inflow.toFixed(0)} < outflow ${outflow.toFixed(0)}, net outflow ${(-netWeekly).toFixed(0)}`),
            impact: tr(lang, '13 週累計缺口風險', '13 周累计缺口风险', 'cumulative 13-week gap risk'),
            suggestion: tr(lang, '檢討應收週轉與延長付款條件', '检讨应收周转与延长付款条件', 'Speed up AR and extend AP terms')
        });
    } else if (outflow > inflow * 0.7) {
        reasons.push({
            rank: 1, dim: tr(lang, 'AP 週均流出', 'AP 周均流出', 'AP Weekly Outflow'),
            desc: tr(lang,
                `AP 週均流出 ${outflow.toFixed(0)}，佔 AR 週均流入 ${inflow.toFixed(0)} 的 ${(outflow/inflow*100).toFixed(0)}%`,
                `AP 周均流出 ${outflow.toFixed(0)}，占 AR 周均流入 ${inflow.toFixed(0)} 的 ${(outflow/inflow*100).toFixed(0)}%`,
                `AP outflow ${outflow.toFixed(0)} is ${(outflow/inflow*100).toFixed(0)}% of AR inflow ${inflow.toFixed(0)}`),
            impact: tr(lang, '現金水位上升慢', '现金水位上升慢', 'slow cash build-up'),
            suggestion: tr(lang, '與主要供應商協商延長付款天數', '与主要供应商协商延长付款天数', 'Negotiate longer terms with major suppliers')
        });
    }

    // 2) 安全線 vs 最低水位
    const minBal = point ? Number(point.min_balance || 0) : Number(w13.median || 0);
    if (minBal < Number(safe_level || 0)) {
        reasons.push({
            rank: 2, dim: tr(lang, '安全水位', '安全水位', 'Safe Level'),
            desc: tr(lang,
                `安全線 ${Number(safe_level||0).toFixed(0)} 高於預測最低水位 ${minBal.toFixed(0)}`,
                `安全线 ${Number(safe_level||0).toFixed(0)} 高于预测最低水位 ${minBal.toFixed(0)}`,
                `safe level ${Number(safe_level||0).toFixed(0)} above forecast min ${minBal.toFixed(0)}`),
            impact: tr(lang, '提高跌破安全線概率', '提高跌破安全线概率', 'raises below-safe probability'),
            suggestion: tr(lang, '檢討安全水位設定值的合理性', '检讨安全水位设定值的合理性', 'Review safe-level parameter')
        });
    } else if (Number(safe_level || 0) > 0 && minBal - Number(safe_level || 0) < Number(safe_level || 0) * 0.3) {
        reasons.push({
            rank: 2, dim: tr(lang, '安全水位邊緣', '安全水位边缘', 'Near Safe Level'),
            desc: tr(lang,
                `最低水位 ${minBal.toFixed(0)} 離安全線僅 ${(minBal-Number(safe_level||0)).toFixed(0)}（低於安全線 30%）`,
                `最低水位 ${minBal.toFixed(0)} 离安全线仅 ${(minBal-Number(safe_level||0)).toFixed(0)}（低于安全线 30%）`,
                `min bal ${minBal.toFixed(0)} is only ${(minBal-Number(safe_level||0)).toFixed(0)} above safe level`),
            impact: tr(lang, '輕微衝擊即跌破安全線', '轻微冲击即跌破安全线', 'small shocks push below safe level'),
            suggestion: tr(lang, '關注最高風險週 W' + (mc.max_gap_week || '-'), '关注最高风险周 W' + (mc.max_gap_week || '-'), 'Watch W' + (mc.max_gap_week || '-') + ' closely')
        });
    }

    // 3) 應收週期偏長
    if ((mc.ar_days || 0) > 60) {
        reasons.push({
            rank: 3, dim: tr(lang, '應收週轉天數', '应收周转天数', 'AR Days'),
            desc: tr(lang,
                `AR 平均 ${mc.ar_days} 天 > 60 天，現金回收慢`,
                `AR 平均 ${mc.ar_days} 天 > 60 天，现金回收慢`,
                `AR avg ${mc.ar_days}d > 60d, slow cash in`),
            impact: tr(lang, '流入節奏拖累現金水位', '流入节奏拖累现金水位', 'drags inflow rhythm'),
            suggestion: tr(lang, '加強逾期催收、檢討信用政策', '加强逾期催收、检讨信用政策', 'Strengthen collection and review credit policy')
        });
    } else if ((mc.ap_days || 0) < 45) {
        reasons.push({
            rank: 3, dim: tr(lang, '應付週轉天數', '应付周转天数', 'AP Days'),
            desc: tr(lang,
                `AP 平均 ${mc.ap_days} 天 < 45 天，付款偏快`,
                `AP 平均 ${mc.ap_days} 天 < 45 天，付款偏快`,
                `AP avg ${mc.ap_days}d < 45d, pays too fast`),
            impact: tr(lang, '縮短現金支付週期', '缩短现金支付周期', 'shortens cash payment cycle'),
            suggestion: tr(lang, '檢討付款條件', '检讨付款条件', 'Review payment terms')
        });
    }

    // 兜底：確保至少 3 條
    while (reasons.length < 3) {
        const rank = reasons.length + 1;
        const weeks = mc.max_gap_week || 13;
        reasons.push({
            rank,
            dim: tr(lang, '季度波動', '季度波动', 'Seasonality'),
            desc: tr(lang,
                `第 ${weeks} 週是最高風險週（${(mc.max_gap_prob || 0).toFixed(1)}%）`,
                `第 ${weeks} 周是最高风险周（${(mc.max_gap_prob || 0).toFixed(1)}%）`,
                `W${weeks} is the peak-risk week (${(mc.max_gap_prob || 0).toFixed(1)}%)`),
            impact: tr(lang, '集中壓力於關鍵時點', '集中压力于关键时点', 'focused risk at key timing'),
            suggestion: tr(lang, '提前安排周度資金計畫', '提前安排周度资金计划', 'Plan weekly funding in advance')
        });
    }
    return reasons.slice(0, 3);
}

// 依指標產生原因
// 多語言輔助：依 lang 回傳對應語系字串
function tr(lang, tw, cn, en) {
    if (lang === 'zh-CN') return cn;
    if (lang === 'en') return en;
    return tw;
}

// KPI 名稱多語系
const KPI_NAME = {
    gross_profit:   { 'zh-TW': '毛利率',       'zh-CN': '毛利率',     en: 'Gross Profit Margin' },
    net_profit_margin: { 'zh-TW': '淨利率',    'zh-CN': '净利率',     en: 'Net Profit Margin' },
    current_ratio:  { 'zh-TW': '流動比率',     'zh-CN': '流动比率',   en: 'Current Ratio' },
    debt_ratio:     { 'zh-TW': '負債比率',     'zh-CN': '负债比率',   en: 'Debt Ratio' },
    ar_turn:        { 'zh-TW': '應收週轉率',   'zh-CN': '应收周转率', en: 'AR Turnover' },
    roe:            { 'zh-TW': 'ROE 股東權益報酬率', 'zh-CN': 'ROE 股东权益报酬率', en: 'ROE (Return on Equity)' },
    z_score:        { 'zh-TW': 'Z-Score (Altman)', 'zh-CN': 'Z-Score (Altman)', en: 'Z-Score (Altman)' },
    z2_score:       { 'zh-TW': 'Z2-Score (私人公司)', 'zh-CN': 'Z2-Score (私人公司)', en: 'Z2-Score (Private Firm)' },
    z3_score:       { 'zh-TW': 'Z3-Score (非製造業)', 'zh-CN': 'Z3-Score (非制造业)', en: 'Z3-Score (Non-Manufacturing)' },
    bz_model:       { 'zh-TW': 'BZ 破產概率', 'zh-CN': 'BZ 破产概率', en: 'BZ Bankruptcy Probability' },
    jz_model:       { 'zh-TW': 'JZ 營運能力', 'zh-CN': 'JZ 营运能力', en: 'JZ Operating Capability' },
    revenue_yoy:    { 'zh-TW': '營收同比', 'zh-CN': '营收同比', en: 'Revenue YoY' },
    interest_cover: { 'zh-TW': '利息保障倍數', 'zh-CN': '利息保障倍数', en: 'Interest Coverage' },
    ar_days:        { 'zh-TW': '應收週轉天數', 'zh-CN': '应收周转天数', en: 'AR Days' },
    inv_days:       { 'zh-TW': '存貨週轉天數', 'zh-CN': '存货周转天数', en: 'Inventory Days' },
    cash_quality:   { 'zh-TW': '淨利現金含量', 'zh-CN': '净利现金含量', en: 'Cash Conversion' }
};

function generateReasons(kpi_id, cur, prev, change, lang) {
    const reasons = [];
    const pct = (a, b) => b > 0 ? Math.round(a / b * 1000) / 10 : 0;

    if (kpi_id === 'gross_profit') {
        // 毛利率 = (銷售 - 成本) / 銷售
        const sale = Number(cur.sale_amt || 0);
        const cost = Number(cur.sale_cost_amt || 0);
        const prevSale = prev ? Number(prev.sale_amt || 0) : 0;
        const prevCost = prev ? Number(prev.sale_cost_amt || 0) : 0;
        const costRate = pct(cost, sale);
        const prevCostRate = prevSale > 0 ? pct(prevCost, prevSale) : 0;

        if (costRate > prevCostRate) {
            reasons.push({
                rank: 1, dim: tr(lang, '成本結構', '成本结构', 'Cost Structure'),
                desc: tr(lang,
                    `銷貨成本率從 ${prevCostRate}% 上升至 ${costRate}%`,
                    `销货成本率从 ${prevCostRate}% 上升至 ${costRate}%`,
                    `COGS ratio rose from ${prevCostRate}% to ${costRate}%`),
                impact: tr(lang,
                    `拖累毛利率約 ${Math.round((costRate - prevCostRate) * 10) / 10}%`,
                    `拖累毛利率约 ${Math.round((costRate - prevCostRate) * 10) / 10}%`,
                    `drags gross margin by ~${Math.round((costRate - prevCostRate) * 10) / 10}%`),
                suggestion: tr(lang, '檢討原物料採購價格與產品組合', '检讨原物料采购价格与产品组合', 'Review raw material pricing and product mix')
            });
        }
        if (sale < prevSale * 0.95) {
            reasons.push({
                rank: 2, dim: tr(lang, '銷售規模', '销售规模', 'Sales Scale'),
                desc: tr(lang,
                    `銷售金額從 ${(prevSale/1000).toFixed(0)}K 降至 ${(sale/1000).toFixed(0)}K`,
                    `销售金额从 ${(prevSale/1000).toFixed(0)}K 降至 ${(sale/1000).toFixed(0)}K`,
                    `Sales dropped from ${(prevSale/1000).toFixed(0)}K to ${(sale/1000).toFixed(0)}K`),
                impact: tr(lang, '規模下降導致固定成本分攤增加', '规模下降导致固定成本分摊增加', 'lower scale raises fixed-cost allocation'),
                suggestion: tr(lang, '檢討低毛利產品是否佔比上升', '检讨低毛利产品是否占比上升', 'Check whether low-margin products gained share')
            });
        }
        reasons.push({
            rank: 3, dim: tr(lang, '產品組合', '产品组合', 'Product Mix'),
            desc: tr(lang, '低毛利產品銷售佔比可能上升', '低毛利产品销售占比可能上升', 'Low-margin products may be gaining share'),
            impact: tr(lang, '約影響毛利率 0.5~1.5%', '约影响毛利率 0.5~1.5%', 'est. impact on gross margin: 0.5~1.5%'),
            suggestion: tr(lang, '至「多維下鑽」查看產品毛利排行', '至「多维下钻」查看产品毛利排行', 'Go to "Drill-down" for product margin ranking')
        });
    } else if (kpi_id === 'debt_ratio') {
        const debt = Number(cur.ttl_debet_amt || (cur.loan_amt || 0) + (cur.AP_amt || 0) + (cur.LT_loan_amt || 0));
        const asset = Number(cur.ttl_asset_amt || 1);
        const loan = Number(cur.loan_amt || 0);
        reasons.push({
            rank: 1, dim: tr(lang, '借款餘額', '借款余额', 'Loan Balance'),
            desc: tr(lang,
                `銀行貸款餘額 ${(loan/1000).toFixed(0)}K，佔總資產 ${pct(loan, asset)}%`,
                `银行贷款余额 ${(loan/1000).toFixed(0)}K，占总资产 ${pct(loan, asset)}%`,
                `Bank loan ${(loan/1000).toFixed(0)}K, ${pct(loan, asset)}% of total assets`),
            impact: tr(lang, `推升負債比約 ${pct(loan, asset)}%`, `推升负债比约 ${pct(loan, asset)}%`, `pushes debt ratio up by ~${pct(loan, asset)}%`),
            suggestion: tr(lang, '評估償還高利率借款', '评估偿还高利率借款', 'Consider repaying high-interest loans')
        });
        reasons.push({
            rank: 2, dim: tr(lang, '應付帳款', '应付帐款', 'Accounts Payable'),
            desc: tr(lang,
                `應付帳款 ${(Number(cur.AP_amt||0)/1000).toFixed(0)}K`,
                `应付帐款 ${(Number(cur.AP_amt||0)/1000).toFixed(0)}K`,
                `Accounts payable ${(Number(cur.AP_amt||0)/1000).toFixed(0)}K`),
            impact: tr(lang, `佔總資產 ${pct(Number(cur.AP_amt||0), asset)}%`, `占总资产 ${pct(Number(cur.AP_amt||0), asset)}%`, `${pct(Number(cur.AP_amt||0), asset)}% of total assets`),
            suggestion: tr(lang, '與供應商協商延長付款天數', '与供应商协商延长付款天数', 'Negotiate longer payment terms with suppliers')
        });
        reasons.push({
            rank: 3, dim: tr(lang, '資產成長', '资产成长', 'Asset Growth'),
            desc: tr(lang, `總資產 ${(asset/1000).toFixed(0)}K`, `总资产 ${(asset/1000).toFixed(0)}K`, `Total assets ${(asset/1000).toFixed(0)}K`),
            impact: tr(lang, '若資產未同步成長，負債比自然偏高', '若资产未同步成长，负债比自然偏高', 'if assets do not grow in tandem, debt ratio stays high'),
            suggestion: tr(lang, '加速應收回收、提升資產周轉率', '加速应收回收、提升资产周转率', 'Speed up AR collection and improve asset turnover')
        });
    } else if (kpi_id === 'current_ratio') {
        const ca = Number(cur.current_asset_amt || 0);
        const cl = Number(cur.current_debet_amt || cur.AP_amt || 1);
        reasons.push({
            rank: 1, dim: tr(lang, '流動負債', '流动负债', 'Current Liabilities'),
            desc: tr(lang, `流動負債 ${(cl/1000).toFixed(0)}K`, `流动负债 ${(cl/1000).toFixed(0)}K`, `Current liabilities ${(cl/1000).toFixed(0)}K`),
            impact: tr(lang, '流動負債偏高使流動比率下降', '流动负债偏高使流动比率下降', 'high current liabilities depress the current ratio'),
            suggestion: tr(lang, '償還短期借款或重估為長期負債', '偿还短期借款或重估为长期负债', 'Repay short-term loans or reclassify as long-term debt')
        });
        reasons.push({
            rank: 2, dim: tr(lang, '存貨水位', '存货水位', 'Inventory Level'),
            desc: tr(lang, `存貨 ${((Number(cur.stock_P_amt||0)+Number(cur.stock_M_amt||0))/1000).toFixed(0)}K`, `存货 ${((Number(cur.stock_P_amt||0)+Number(cur.stock_M_amt||0))/1000).toFixed(0)}K`, `Inventory ${((Number(cur.stock_P_amt||0)+Number(cur.stock_M_amt||0))/1000).toFixed(0)}K`),
            impact: tr(lang, '存貨佔用流動資金', '存货占用流动资金', 'inventory ties up working capital'),
            suggestion: tr(lang, '加速存貨周轉、降低安全存量', '加速存货周转、降低安全存量', 'Improve inventory turnover and lower safety stock')
        });
        reasons.push({
            rank: 3, dim: tr(lang, '應收帳款', '应收帐款', 'Accounts Receivable'),
            desc: tr(lang, `應收帳款 ${(Number(cur.AR_amt||0)/1000).toFixed(0)}K`, `应收帐款 ${(Number(cur.AR_amt||0)/1000).toFixed(0)}K`, `Accounts receivable ${(Number(cur.AR_amt||0)/1000).toFixed(0)}K`),
            impact: tr(lang, '應收回收速度影響現金水位', '应收回收速度影响现金水位', 'AR collection speed affects cash position'),
            suggestion: tr(lang, '檢討信用政策、加強催收', '检讨信用政策、加强催收', 'Review credit policy and strengthen collection')
        });
    } else {
        const def = KPI_DEF[kpi_id];
        const name = (KPI_NAME[kpi_id] && KPI_NAME[kpi_id][lang]) || def.name;
        const curVal = Math.round(def.formula(cur)*100)/100;
        reasons.push({ rank: 1, dim: tr(lang, '當期營運', '当期营运', 'Current Period'), desc: tr(lang, `${name} 當期值 ${curVal}${def.unit}`, `${name} 当期值 ${curVal}${def.unit}`, `${name} current value ${curVal}${def.unit}`), impact: tr(lang, '需進一步分析細項', '需进一步分析细项', 'needs further detail analysis'), suggestion: tr(lang, '查看財務摘要明細', '查看财务摘要明细', 'Check financial summary details') });
        reasons.push({ rank: 2, dim: tr(lang, '上期比較', '上期比较', 'vs. Previous Period'), desc: change !== null ? tr(lang, `較上期變動 ${change > 0 ? '+' : ''}${change}${def.unit}`, `较上期变动 ${change > 0 ? '+' : ''}${change}${def.unit}`, `change vs. previous ${change > 0 ? '+' : ''}${change}${def.unit}`) : tr(lang, '無上期資料', '无上期资料', 'no previous period data'), impact: change !== null && Math.abs(change) > 3 ? tr(lang, '變動顯著', '变动显著', 'significant change') : tr(lang, '變動輕微', '变动轻微', 'minor change'), suggestion: change !== null && Math.abs(change) > 3 ? tr(lang, '需檢討原因', '需检讨原因', 'review the cause') : tr(lang, '持續觀察', '持续观察', 'keep monitoring') });
        reasons.push({ rank: 3, dim: tr(lang, '同業標竿', '同业标杆', 'Industry Benchmark'), desc: tr(lang, `門檻值 ${def.threshold}${def.unit}`, `门槛值 ${def.threshold}${def.unit}`, `Threshold ${def.threshold}${def.unit}`), impact: def.formula(cur) < def.threshold ? tr(lang, '低於門檻', '低于门槛', 'below threshold') : tr(lang, '優於門檻', '优于门槛', 'above threshold'), suggestion: tr(lang, '參考同業中位數調整目標', '参考同业中位数调整目标', 'adjust targets using industry median') });
    }
    return reasons;
}

module.exports = router;
