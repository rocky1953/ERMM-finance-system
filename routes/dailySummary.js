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
// 不依赖 aiqa.js 的内部 normalizeLang（aiqa 只导出 router）
function normalizeLang(input) {
    const l = String(input || 'zh-TW').toLowerCase();
    if (l.startsWith('zh')) return 'zh-TW'; // 统一繁中（AI 摘要习惯繁中输出）
    if (l.startsWith('en')) return 'en';
    return 'zh-TW';
}

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
    'zh-TW': `你是 ERMM 集團的資深財務長（CFO），精通企業財務分析、風險評估、現金流量管理。
請根據我提供的財務數據，撰寫一份精煉的每日/每月財務執行摘要。

寫作要求：
- 語言：繁體中文
- 先給【一句話總結】（開頭加粗），再給數據支撐
- 結構：① 集團合併概況 ② 三公司個別表現 ③ YoY 同比分析 ④ 風險預警 ⑤ 建議行動
- 所有金額用千分位格式；百分比標示 %
- 風險標記用符號：🟢安全 / 🟡灰色 / 🔴危險
- 具體、精煉、有洞察，避免空話
- 結尾標註：數據來源 ermm_db`,
    'zh-CN': `你是 ERMM 集团的资深财务长（CFO），精通企业财务分析、风险评估、现金流量管理。
请根据我提供的财务数据，撰写一份精炼的每日/每月财务执行摘要。

写作要求：
- 语言：简体中文
- 先给【一句话总结】（开头加粗），再给数据支撑
- 结构：① 集团合并概况 ② 三公司个别表现 ③ YoY 同比分析 ④ 风险预警 ⑤ 建议行动
- 所有金额用千分位格式；百分比标示 %
- 风险标记用符号：🟢安全 / 🟡灰色 / 🔴危险
- 具体、精炼、有洞察，避免空话
- 结尾标注：数据来源 ermm_db`,
    'en': `You are the CFO of ERMM Group, expert in financial analysis, risk assessment, cash flow management.
Write a concise daily/monthly executive summary based on the data I provide.

Requirements:
- Language: English
- Start with a **one-sentence conclusion** (bold), then supporting figures
- Structure: ① Consolidated overview ② By-company performance ③ YoY analysis ④ Risk alerts ⑤ Recommended actions
- All amounts with thousand separators; percentages marked with %
- Risk symbols: 🟢Safe / 🟡Watch / 🔴Danger
- Specific, insightful, no fluff
- Cite: Data source ermm_db`
};

async function generateSummary(aggregate, lang) {
    const uiLang = normalizeLang(lang);

    // 取 LLM provider — 复用 getDefaultProvider（先 is_default=1，再 status='USE'）
    const cfg = await getDefaultProvider(pool);
    if (!cfg) throw new Error('未設定 LLM 服務商');

    // 精簡版 context — 只傳 LLM 真正需要的數字，砍掉所有冗余字段
    const period = aggregate.companies.HM?.period || aggregate.generated_at;

    // 精簡 companies
    const slimCompanies = {};
    for (const bu of ALL_BU) {
        const c = aggregate.companies[bu];
        if (!c) continue;
        slimCompanies[bu] = {
            sale: +c.sale, gross_margin: +c.gross_margin, net_margin: +c.net_margin,
            net_profit: +c.net_profit, Z_score: +c.Z_score, debt_ratio: +c.debt_ratio,
            current_ratio: +c.current_ratio, AR: +c.AR, cash: +c.cash, loan: +c.loan,
            yoy: c.yoy ? { sale_chg: +c.yoy.sale_chg, gross_margin_chg: +c.yoy.gross_margin_chg,
                          Z_score_chg: +c.yoy.Z_score_chg, debt_ratio_chg: +c.yoy.debt_ratio_chg } : null,
            cash_position: c.cash_position ? { ratio: c.cash_position.ratio, flag: c.cash_position.flag } : null,
            peer: c.peer_position ? Object.fromEntries(
                Object.entries(c.peer_position).filter(([k]) => k !== 'industry' && k !== 'year')
                    .map(([k, v]) => [k, { my: +v.my_val, pos: v.pos }])
            ) : null
        };
    }

    const context = {
        period, generated_at: aggregate.generated_at,
        group: {
            consolidated_sale: +aggregate.group_consolidated.consolidated_sale,
            consolidated_net_profit: +aggregate.group_consolidated.consolidated_net_profit,
            profit_margin: aggregate.group_consolidated.profit_margin,
            bu_contribution: aggregate.group_consolidated.bu_contribution
        },
        companies: slimCompanies,
        risk_ranking: aggregate.risk_ranking,
        alerts: aggregate.alerts
    };

    // 用緊湊格式 JSON — 減少 token（不用 null, 2 縮排）
    const promptContent = `財務數據期間：${period}\n\n${JSON.stringify(context)}`;

    const messages = [
        { role: 'system', content: DAILY_SYSTEM_PROMPTS[uiLang] },
        { role: 'user', content: promptContent }
    ];

    const t0 = Date.now();
    console.log('[daily-summary] 调 chatCompletion provider=' + cfg.provider_name + ' model=' + cfg.model + ' prompt_size=' + promptContent.length);
    const content = await chatCompletion(
        { base_url: cfg.base_url, api_key: cfg.api_key, model: cfg.model },
        messages,
        { temperature: 0.2, max_tokens: 4096, timeout: 120000 }
    );
    const duration = Date.now() - t0;
    console.log('[daily-summary] chatCompletion 返回 type=' + typeof content + ' len=' + (content?.length || 'null') + ' duration=' + duration);

    // 解析输出中的标题 — 取前 30 字符的第一句
    const cleanContent = content.trim();
    const lines = cleanContent.split('\n').filter(l => l.trim());
    let title = '';
    for (const l of lines.slice(0, 5)) {
        const t = l.replace(/^[#*\s]+/, '').trim().slice(0, 80);
        // 跳过 instructions 复述的标题
        if (t && !t.includes('用戶') && !t.includes('请根据') && !t.includes('根據提供的')) {
            title = t; break;
        }
    }
    if (!title) title = lines[0]?.replace(/^[#*\s]+/, '').trim().slice(0, 80) || 'AI 执行摘要';

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
        console.log('[daily-summary] LLM 摘要生成成功！provider=' + r.provider + ' duration=' + r.duration_ms + 'ms content_len=' + (r.content?.length || 0));
        title = r.title; content = r.content;
        provider = r.provider; model = r.model; duration_ms = r.duration_ms;
    } catch (llmErr) {
            console.error('[daily-summary] LLM 生成失敗，使用 fallback:', llmErr?.message || String(llmErr), llmErr?.stack || '');
            title = `每日財務快報（${aggregate.generated_at}）— LLM 暫不可用`;
            content = buildFallbackText(aggregate, lang || 'zh-TW', llmErr?.message || String(llmErr) || 'unknown');
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
