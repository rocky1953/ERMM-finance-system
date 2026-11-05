/**
 * C-1 每日 AI 执行摘要路由
 *
 * 核心流程：
 *   1. 聚合 6 大模块结构化数据（财务快照 / YoY / 现金水位 / AR / Z-score / 同业）
 *   2. 拼成 JSON 上下文 → 调用 LLM（复用 askLLMRAG 的 buildRAGContext + chatCompletion）
 *   3. 解析 LLM 输出（JSON 格式要求）→ 存 daily_ai_summary 表
 *   4. 返回前端展示
 *
 * 接口：
 *   POST /api/daily-summary/generate  — 手动生成
 *   GET  /api/daily-summary/latest    — 取最新一条
 *   GET  /api/daily-summary/history   — 历史分页
 *   GET  /api/daily-summary/aggregate — 只拿聚合数据（不调 LLM）
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const { chatCompletion, getDefaultProvider } = require('../utils/llmClient');
const { normalizeLang } = require('./aiqa'); // 复用

const BU_INDUSTRY = { HM: '制造业', SZ: '制造业', HN: '批发零售业' };
const ALL_BU = ['HM', 'SZ', 'HN'];

// ===== 1. 聚合结构化数据 =====
async function buildAggregateData() {
    const result = {
        generated_at: new Date().toISOString().slice(0, 10),
        companies: {},
        group_consolidated: {},
        alerts: [], // 聚合阶段发现的风险点（不调 LLM 就能判定的）
        modules_included: []
    };

    // 模块 1: 财务快照
    const latestMonth = await getLatestMonth();
    for (const bu of ALL_BU) {
        result.companies[bu] = await buildCompanySnapshot(bu, latestMonth);
    }
    result.modules_included.push('snapshot');

    // 模块 2: YoY 异动
    const lastYearMonth = shiftYear(latestMonth, -1);
    for (const bu of ALL_BU) {
        result.companies[bu].yoy = await buildYoY(bu, latestMonth, lastYearMonth);
    }
    result.modules_included.push('yoy');

    // 模块 3: 现金安全水位
    for (const bu of ALL_BU) {
        result.companies[bu].cash_position = await buildCashPosition(bu);
    }
    result.modules_included.push('cash');

    // 模块 4: Z-score 风险
    const riskSorted = ALL_BU.map(bu => ({
        bu, Z_score: result.companies[bu].Z_score,
        flag: Number(result.companies[bu].Z_score) < 1.23 ? 'high_risk'
            : Number(result.companies[bu].Z_score) < 2.9 ? 'watch' : 'safe'
    })).sort((a, b) => a.Z_score - b.Z_score);
    result.risk_ranking = riskSorted;
    result.modules_included.push('risk');

    // 模块 5: 同业 benchmark 位置
    for (const bu of ALL_BU) {
        result.companies[bu].peer_position = await buildPeerPosition(bu, latestMonth);
    }
    result.modules_included.push('benchmark');

    // 模块 6: 集团合并
    const group = await buildGroupConsolidated(latestMonth);
    result.group_consolidated = group;
    result.modules_included.push('consolidated');

    // 聚合阶段自动发现的 alert（不依赖 LLM）
    for (const item of riskSorted) {
        if (item.flag === 'high_risk') {
            result.alerts.push({ type: 'Z_score', level: 'danger', bu: item.bu,
                msg: `Z_score=${Number(item.Z_score).toFixed(2)}，低于破产警戒线 1.23` });
        } else if (item.flag === 'watch') {
            result.alerts.push({ type: 'Z_score', level: 'warning', bu: item.bu,
                msg: `Z_score=${Number(item.Z_score).toFixed(2)}，处于灰色地带` });
        }
    }
    for (const bu of ALL_BU) {
        const cp = result.companies[bu].cash_position;
        if (cp && cp.ratio < 0.5) {
            result.alerts.push({ type: 'cash', level: 'danger', bu,
                msg: `现金仅安全水位 ${(cp.ratio*100).toFixed(1)}%` });
        } else if (cp && cp.ratio < 0.8) {
            result.alerts.push({ type: 'cash', level: 'warning', bu,
                msg: `现金低于安全水位 80%（ratio=${(cp.ratio*100).toFixed(1)}%）` });
        }
    }

    return result;
}

async function getLatestMonth() {
    const [[r]] = await pool.execute('SELECT MAX(YYYY_MM) AS m FROM mgm_finance_summary');
    return r.m;
}
function shiftYear(yyyymm, delta) {
    const [y, m] = yyyymm.split('-').map(Number);
    return `${y + delta}-${String(m).padStart(2, '0')}`;
}

async function buildCompanySnapshot(bu, yyyymm) {
    const [rows] = await pool.execute(
        `SELECT YYYY_MM, sale_amt, sale_cost_amt, net_profit_amt, Z_score,
                debt_ratio, current_ratio, gross_margin, net_margin,
                receivable_turnover, AR_amt, loan_amt,
                cash_amt, deposite_amt, ttl_asset_amt, ttl_debet_amt,
                stockholder_amt, employee_cnt
         FROM mgm_finance_summary WHERE bu_no=? AND YYYY_MM=?`,
        [bu, yyyymm]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
        bu_no: bu, period: r.YYYY_MM,
        sale: Number(r.sale_amt || 0).toFixed(2),
        gross_margin: Number(r.gross_margin || 0).toFixed(2),
        net_margin: Number(r.net_margin || 0).toFixed(2),
        net_profit: Number(r.net_profit_amt || 0).toFixed(2),
        Z_score: Number(r.Z_score || 0).toFixed(2),
        debt_ratio: Number(r.debt_ratio || 0).toFixed(2),
        current_ratio: Number(r.current_ratio || 0).toFixed(2),
        AR: Number(r.AR_amt || 0).toFixed(2),
        AR_turnover: Number(r.receivable_turnover || 0).toFixed(2),
        loan: Number(r.loan_amt || 0).toFixed(2),
        cash: (Number(r.cash_amt || 0) + Number(r.deposite_amt || 0)).toFixed(2),
        total_asset: Number(r.ttl_asset_amt || 0).toFixed(2),
        total_debt: Number(r.ttl_debet_amt || 0).toFixed(2),
        equity: Number(r.stockholder_amt || 0).toFixed(2),
        employee_cnt: Number(r.employee_cnt || 0)
    };
}

async function buildYoY(bu, currMonth, lastYearMonth) {
    const [rows] = await pool.execute(
        `SELECT YYYY_MM, sale_amt, net_profit_amt, gross_margin, Z_score, debt_ratio
         FROM mgm_finance_summary WHERE bu_no=? AND YYYY_MM IN (?, ?) ORDER BY YYYY_MM`,
        [bu, currMonth, lastYearMonth]
    );
    if (rows.length < 2) return null;
    const [y, c] = rows;
    const chg = (v1, v2) => Number(v2) - Number(v1);
    const pct = (v1, v2) => Number(v1) !== 0
        ? ((Number(v2) - Number(v1)) / Math.abs(Number(v1)) * 100).toFixed(2)
        : null;
    return {
        exact_match: true, last_year_period: lastYearMonth,
        sale_chg: pct(y.sale_amt, c.sale_amt),
        sale_delta: chg(y.sale_amt, c.sale_amt).toFixed(2),
        gross_margin_chg: chg(y.gross_margin, c.gross_margin).toFixed(2),
        net_profit_chg: pct(y.net_profit_amt, c.net_profit_amt),
        Z_score_chg: chg(y.Z_score, c.Z_score).toFixed(2),
        debt_ratio_chg: chg(y.debt_ratio, c.debt_ratio).toFixed(2)
    };
}

async function buildCashPosition(bu) {
    // 优先用 mgm_cash_safe_level 表的数值；否则估算
    const [[safeRow]] = await pool.execute(
        'SELECT safe_amount FROM mgm_cash_safe_level WHERE bu_no=? LIMIT 1', [bu]
    );
    const [curr] = await pool.execute(
        `SELECT (cash_amt + deposite_amt) AS cash FROM mgm_finance_summary
         WHERE bu_no=? ORDER BY YYYY_MM DESC LIMIT 1`, [bu]
    );
    let safeLevel;
    if (safeRow?.safe_amount) {
        safeLevel = Number(safeRow.safe_amount);
    } else {
        // 估算：近 3 月平均支出 × 1.5
        const [recent] = await pool.execute(
            `SELECT sale_exp_amt + MGM_EXP_amt + finance_EXP_amt AS exp
             FROM mgm_finance_summary WHERE bu_no=? ORDER BY YYYY_MM DESC LIMIT 3`, [bu]
        );
        if (recent.length === 3) {
            const avg = recent.reduce((s, r) => s + (Number(r.exp) || 0), 0) / 3;
            safeLevel = avg * 1.5;
        }
    }
    const cash = Number(curr[0]?.cash || 0);
    const ratio = safeLevel > 0 ? cash / safeLevel : null;
    let flag = 'green';
    if (ratio != null) {
        if (ratio < 0.5) flag = 'red';
        else if (ratio < 0.8) flag = 'yellow';
    }
    return {
        cash: cash.toFixed(2),
        safe_level: safeLevel?.toFixed(2) || null,
        ratio: ratio != null ? (ratio * 100).toFixed(1) + '%' : null,
        flag
    };
}

async function buildPeerPosition(bu, yearMonth) {
    const industry = BU_INDUSTRY[bu];
    const year = Number(yearMonth.split('-')[0]);
    const [[curr]] = await pool.execute(
        'SELECT gross_margin, net_margin, debt_ratio, Z_score FROM mgm_finance_summary WHERE bu_no=? ORDER BY YYYY_MM DESC LIMIT 1',
        [bu]
    );
    const [bench] = await pool.execute(
        `SELECT kpi_id, p25, median, p75 FROM industry_benchmark
         WHERE industry=? AND year=? AND kpi_id IN ('gross_profit', 'net_profit_margin', 'debt_ratio', 'altman_z1')`,
        [industry, year]
    );
    const kpiMap = { gross_profit: 'gross_margin', net_profit_margin: 'net_margin', debt_ratio: 'debt_ratio', altman_z1: 'Z_score' };
    const result = { industry, year };
    for (const b of bench) {
        const myVal = Number(curr[kpiMap[b.kpi_id]]);
        const p25 = Number(b.p25), median = Number(b.median), p75 = Number(b.p75);
        let pos;
        if (myVal > p75) pos = '优於同业 P75';
        else if (myVal > median) pos = '优於同业中位';
        else if (myVal < p25) pos = '低於同业 P25';
        else if (myVal < median) pos = '低於同业中位';
        else pos = '约等于同业中位';
        result[b.kpi_id] = {
            my_val: myVal.toFixed(2),
            p25: p25.toFixed(2), median: median.toFixed(2), p75: p75.toFixed(2), pos
        };
    }
    return result;
}

async function buildGroupConsolidated(yearMonth) {
    const [rows] = await pool.execute(
        `SELECT bu_no, sale_amt, net_profit_amt FROM mgm_finance_summary WHERE YYYY_MM=?`,
        [yearMonth]
    );
    const totalSale = rows.reduce((s, r) => s + Number(r.sale_amt || 0), 0);
    const totalNp = rows.reduce((s, r) => s + Number(r.net_profit_amt || 0), 0);
    const mix = rows.map(r => ({
        bu: r.bu_no,
        sale: Number(r.sale_amt).toFixed(2),
        share: totalSale > 0 ? (Number(r.sale_amt) / totalSale * 100).toFixed(1) + '%' : '0%'
    })).sort((a, b) => Number(b.share) - Number(a.share));
    return {
        period: yearMonth,
        consolidated_sale: totalSale.toFixed(2),
        consolidated_net_profit: totalNp.toFixed(2),
        profit_margin: totalSale > 0 ? (totalNp / totalSale * 100).toFixed(2) + '%' : '0%',
        bu_contribution: mix
    };
}

// ===== 2. LLM 生成摘要 =====
const DAILY_SYSTEM_PROMPTS = {
    'zh-TW': `你是 ERMM 企業的資深財務長（CFO）。請根據提供的財務數據，撰寫每日/每月財務執行摘要。

要求：
1. 語言：繁體中文
2. 結構：**標題**（一句話概括當期狀態）+ 3~5 段條理清晰的分析 + **風險預警**（如有）+ **建議行動**
3. 先給總結論（1 句話），再給數據支撐
4. 所有金額千分位；百分比明確標示 %
5. 標明「數據來源：ermm_db · YYYY-MM」
6. 精煉、專業，避免空話`,
    'zh-CN': `你是 ERMM 企业的资深财务长（CFO）。请根据提供的财务数据，撰写每日/每月财务执行摘要。

要求：
1. 语言：简体中文
2. 结构：**标题**（一句话概括当期状态）+ 3~5 段条理清晰的分析 + **风险预警**（如有）+ **建议行动**
3. 先给总结论（1 句话），再给数据支撑
4. 所有金额千分位；百分比明确标示 %
5. 标明「数据来源：ermm_db · YYYY-MM」
6. 精炼、专业，避免空话`,
    'en': `You are the CFO of ERMM Group. Write a daily/monthly financial executive summary based on the data provided.

Requirements:
1. Language: English
2. Structure: **Title** (one-sentence state) + 3~5 paragraphs of structured analysis + **Risk Alerts** (if any) + **Recommended Actions**
3. Conclusion first, then supporting figures
4. All amounts with thousand separators; percentages marked with %
5. Cite "Data source: ermm_db · YYYY-MM"
6. Concise, professional, no fluff`
};

async function generateSummary(aggregate, lang) {
    const uiLang = normalizeLang(lang);

    // 取 LLM provider
    const [[cfg]] = await pool.execute('SELECT * FROM llm_config WHERE is_default=1 OR status="USE" LIMIT 1');
    if (!cfg) throw new Error('未設定 LLM 服務商');
    if (!cfg.api_key) throw new Error(`「${cfg.provider_name}」尚未設定 API Key`);

    // 拼 prompt
    const period = aggregate.companies.HM?.period || aggregate.generated_at;
    const modules = aggregate.modules_included.join(' + ');
    const context = {
        _meta: {
            period, modules_covered: modules,
            generated_at: aggregate.generated_at,
            companies: ALL_BU.join(', ')
        },
        data: aggregate,
        instructions: {
            title: '用一句話概括當期財務狀態',
            sections: [
                '1. 集團合併概況：三公司合計營收/淨利 + 各公司佔比',
                '2. 個別公司表現：每家公司的 KPI 亮點/不足',
                '3. YoY 變動分析：同比增減 + 可能原因推論',
                '4. 風險預警：Z-score / 現金水位 / 負債比率 的紅黃燈',
                '5. 建議行動：2~5 條可執行的動作（具體到部門/金額/時限）'
            ],
            data_source: `ermm_db · ${period}`
        }
    };

    const messages = [
        { role: 'system', content: DAILY_SYSTEM_PROMPTS[uiLang] },
        { role: 'user', content: JSON.stringify(context, null, 2) }
    ];

    const t0 = Date.now();
    const content = await chatCompletion(
        { base_url: cfg.base_url, api_key: cfg.api_key, model: cfg.model },
        messages,
        { temperature: 0.2, max_tokens: 4096, timeout: 120000 }
    );
    const duration = Date.now() - t0;

    // 解析输出中的标题（取第一行 **xxx** 或第一句话）
    const lines = content.trim().split('\n').filter(l => l.trim());
    let title = lines[0]?.replace(/[#*\s]/g, '').slice(0, 80) || 'AI 执行摘要';

    return {
        title, content, duration_ms: duration,
        provider: cfg.provider_name, model: cfg.model
    };
}

// ===== 3. 路由 =====

// POST /api/daily-summary/generate — 手动生成
router.post('/generate', async (req, res) => {
    const t0 = Date.now();
    try {
        const { lang, force } = req.body;

        // 检查今天是否已生成过
        if (!force) {
            const today = new Date().toISOString().slice(0, 10);
            const [[exists]] = await pool.execute(
                'SELECT uid FROM daily_ai_summary WHERE summary_date=? AND is_active=1', [today]
            );
            if (exists?.uid) {
                // 返回今天已有的
                const [[row]] = await pool.execute(
                    'SELECT * FROM daily_ai_summary WHERE uid=?', [exists.uid]
                );
                return ok(res, { regenerated: false, summary: row, note: '今天的摘要已存在，如需重生成請加 force=true' });
            }
        }

        // Step 1: 聚合
        const aggregate = await buildAggregateData();

        // Step 2: 调 LLM 生成（可能失败，失败时存聚合数据 + fallback 文字）
        let title = '', content = '', provider = '', model = '', duration_ms = 0, alerts_json = null, actions_json = null;
        try {
            const r = await generateSummary(aggregate, lang || 'zh-TW');
            title = r.title; content = r.content;
            provider = r.provider; model = r.model; duration_ms = r.duration_ms;
        } catch (llmErr) {
            console.error('[daily-summary] LLM 生成失敗，使用 fallback:', llmErr.message);
            title = `每日財務快報（${aggregate.generated_at}）— LLM 暫不可用`;
            content = buildFallbackText(aggregate, lang || 'zh-TW', llmErr.message);
            provider = 'fallback';
        }

        // Step 3: 存表
        const period = aggregate.companies.HM?.period || aggregate.generated_at;
        const [[latest]] = await pool.execute('SELECT MAX(YYYY_MM) AS m FROM mgm_finance_summary');
        await pool.execute(
            `INSERT INTO daily_ai_summary
             (summary_date, period_label, source_modules, trigger_type,
              provider, model, data_json, title, content, alerts_json,
              xuser_id, xuser_name, duration_ms)
             VALUES (?, ?, ?, 'manual', ?, ?, CAST(? AS JSON), ?, ?, CAST(? AS JSON), ?, ?, ?)`,
            [
                aggregate.generated_at, period,
                aggregate.modules_included.join(','),
                provider, model,
                JSON.stringify(aggregate),
                title, content,
                JSON.stringify(aggregate.alerts || []),
                (req.user?.user_id) || null,
                (req.user?.user_name) || null,
                duration_ms
            ]
        );

        const totalMs = Date.now() - t0;
        ok(res, {
            regenerated: true,
            summary_date: aggregate.generated_at,
            period, title, content,
            provider, model, duration_ms,
            total_ms: totalMs,
            alerts: aggregate.alerts,
            is_llm: provider !== 'fallback'
        });
    } catch (err) { fail500(res, err); }
});

// GET /api/daily-summary/latest — 最新一条
router.get('/latest', async (req, res) => {
    try {
        const [[row]] = await pool.execute(
            `SELECT * FROM daily_ai_summary WHERE is_active=1 ORDER BY generated_time DESC LIMIT 1`
        );
        if (!row) {
            // 无历史时，只聚合数据返回（让前端显示"尚未生成，点击生成"状态）
            const agg = await buildAggregateData();
            return ok(res, { has_summary: false, aggregate: agg });
        }
        let data = row.data_json;
        if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) {} }
        let alerts = row.alerts_json;
        if (typeof alerts === 'string') { try { alerts = JSON.parse(alerts); } catch (e) {} }
        ok(res, { has_summary: true, ...row, data_json: data, alerts_json: alerts });
    } catch (err) { fail500(res, err); }
});

// GET /api/daily-summary/history — 历史分页
router.get('/history', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || '1'));
        const pageSize = Math.min(50, parseInt(req.query.pageSize || '10'));
        const offset = (page - 1) * pageSize;
        const [[cnt]] = await pool.execute(
            'SELECT COUNT(*) AS c FROM daily_ai_summary WHERE is_active=1'
        );
        const [rows] = await pool.execute(
            `SELECT uid, summary_date, generated_time, period_label, source_modules,
                    trigger_type, provider, title, duration_ms
             FROM daily_ai_summary WHERE is_active=1
             ORDER BY generated_time DESC LIMIT ? OFFSET ?`,
            [pageSize, offset]
        );
        ok(res, { list: rows, total: cnt.c, page, pageSize });
    } catch (err) { fail500(res, err); }
});

// GET /api/daily-summary/aggregate — 只拿聚合数据（不调 LLM，用于手动看实时状态）
router.get('/aggregate', async (req, res) => {
    try {
        const data = await buildAggregateData();
        ok(res, data);
    } catch (err) { fail500(res, err); }
});

// ===== Fallback 文字（LLM 失败时用规则引擎生成可读文本）=====
function buildFallbackText(agg, lang, llmErr) {
    const T = {
        'zh-TW': { alertTitle: '⚠️ 以下為規則引擎自動生成（LLM 暫不可用）',
                    subTitle: '=== 集團每日財務快報 ===',
                    group: '集團合併概況', company: '個別公司狀態', risk: '風險預警', cash: '現金水位' },
        'zh-CN': { alertTitle: '⚠️ 以下为规则引擎自动生成（LLM 暂不可用）',
                    subTitle: '=== 集团每日财务快报 ===',
                    group: '集团合并概况', company: '个别公司状态', risk: '风险预警', cash: '现金水位' },
        'en': { alertTitle: '⚠️ Auto-generated by rule engine (LLM unavailable)',
                subTitle: '=== Group Daily Finance Flash ===',
                group: 'Consolidated', company: 'By Company', risk: 'Risk Alerts', cash: 'Cash Position' }
    };
    const t = T[lang] || T['zh-TW'];

    let txt = `${t.alertTitle}\nLLM Error: ${llmErr.message}\n\n${t.subTitle} (${agg.generated_at})\n\n`;

    // Group
    const g = agg.group_consolidated;
    txt += `【${t.group}】\n合計營收: ${Number(g.consolidated_sale).toLocaleString()} | 合計淨利: ${Number(g.consolidated_net_profit).toLocaleString()} | 利潤率: ${g.profit_margin}\n`;
    g.bu_contribution.forEach(b => txt += `  · ${b.bu}: 佔比 ${b.share}\n`);
    txt += '\n';

    // Per company
    txt += `【${t.company}】\n`;
    for (const bu of ALL_BU) {
        const c = agg.companies[bu];
        if (!c) continue;
        txt += `${bu}: sale=${Number(c.sale).toLocaleString()} | 毛利=${c.gross_margin}% | 净利=${c.net_margin}% | Z=${c.Z_score} | 负债率=${c.debt_ratio}%\n`;
        if (c.yoy) {
            txt += `  YoY: 營收${c.yoy.sale_chg >= 0 ? '↑' : '↓'}${Math.abs(c.yoy.sale_chg)}% | 毛利${c.yoy.gross_margin_chg >= 0 ? '↑' : '↓'}${Math.abs(c.yoy.gross_margin_chg)}pt\n`;
        }
    }
    txt += '\n';

    // Risk + Cash
    txt += `【${t.risk}】\n`;
    agg.risk_ranking.forEach(r => {
        const flag = r.flag === 'high_risk' ? '🔴' : r.flag === 'watch' ? '🟡' : '🟢';
        txt += `  ${flag} ${r.bu}: Z=${Number(r.Z_score).toFixed(2)}\n`;
    });
    txt += '\n';

    txt += `【${t.cash}】\n`;
    for (const bu of ALL_BU) {
        const cp = agg.companies[bu]?.cash_position;
        if (cp) {
            const flag = cp.flag === 'red' ? '🔴' : cp.flag === 'yellow' ? '🟡' : '🟢';
            txt += `  ${flag} ${bu}: 現金=${Number(cp.cash).toLocaleString()} | 安全水位=${cp.safe_level ? Number(cp.safe_level).toLocaleString() : 'N/A'} | ratio=${cp.ratio}\n`;
        }
    }

    return txt;
}

module.exports = router;
