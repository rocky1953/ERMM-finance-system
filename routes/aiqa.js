/**
 * AI 問答路由（T-1 RAG 增強版）
 * =====================================================
 * 兩種模式：
 *   1. 未勾選 LLM：規則引擎自然語言查詢 ermm_db（原有功能）
 *   2. 勾選 LLM：LLM + RAG 融合回答
 *      - RAG 知識庫檢索（ermm_knowledge：全文搜索 + 關鍵詞加權）
 *      - YoY 同期對比 + 12 個月趨勢
 *      - 同業標竿（industry_benchmark：p10/p25/median/p75/p90）
 *      - 對話記憶（conversation_id：最近 5 輪上下文）
 *      - 回答標註資料來源
 * =====================================================
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const { chatCompletion, getDefaultProvider } = require('../utils/llmClient');

// 公司→產業別映射（硬編碼，配合 industry_benchmark 表）
const BU_INDUSTRY = { HM: '制造业', SZ: '制造业', HN: '批发零售业' };

// ===== 問答接口（原有接口，向後兼容，新增參數 conversation_id / useKnowledge / history）=====
router.post('/ask', async (req, res) => {
    try {
        const { question, bu_no, YYYY_MM, useLLM, provider, lang, conversation_id, useKnowledge, history } = req.body;
        if (!question) return fail(res, '請輸入問題');
        const bu = String(bu_no || 'HM').toUpperCase();
        const mm = YYYY_MM || null;
        const convId = conversation_id || null;

        // 勾選 LLM → 走 RAG + LLM 融合回答
        if (useLLM) {
            const pvd = String(provider || '').toLowerCase();
            let providerToUse = pvd;
            if (!providerToUse) {
                const defaultCfg = await getDefaultProvider(pool);
                if (!defaultCfg) return fail(res, '尚未設定任何 LLM 服務商，請至「系統設定 → API Key 管理」');
                providerToUse = defaultCfg.provider;
            }

            // === E2 多輪記憶 DB 持久化 ===
            // 前端可選傳 history；若沒傳且有 convId，後端自動從 DB 拉最近 5 輪
            let finalHistory = Array.isArray(history) ? history : [];
            if (finalHistory.length === 0 && convId) {
                try {
                    finalHistory = await loadConversationFromDB(convId);
                    console.log(`[aiqa] 從 DB 補充對話記憶 conv=${convId}, 補 ${finalHistory.length} 輪`);
                } catch (e) {
                    console.warn('[aiqa] loadConversationFromDB 失敗（不影響主流程）:', e.message);
                }
            }

            try {
                const result = await askLLMRAG(question, bu, mm, providerToUse, lang, {
                    conversation_id: convId,
                    useKnowledge: useKnowledge !== false,
                    history: finalHistory
                });
                try {
                    await saveAIRecord({
                        bu_no: bu, question, answer: result.answer,
                        remark: `${result.provider || ''} · ${result.detail || ''}`,
                        user: req.user,
                        xuser_name: req.body.xuser_name,
                        conversation_id: convId
                    });
                } catch (saveErr) {
                    console.error('[aiqa] 對談記錄落庫失敗：', saveErr.message);
                }
                return ok(res, result);
            } catch (e) {
                if (e.code === 'LLM_KEY_MISSING' || e.code === 'NO_FINANCE_DATA') return fail(res, e.message);
                return fail500(res, e);
            }
        }

        // 未勾選 → 原有規則引擎（加上 KB 參考來源增強）
        const result = await analyzeQuestion(question.toLowerCase(), bu, mm);

        // === E3 規則引擎融合 RAG ===
        // 規則引擎也查知識庫 + 同業標竿，附加到 response 的 kb_refs / benchmark 字段
        try {
            const kbHits = await searchKnowledge(question, bu, 3);
            if (kbHits.length > 0) {
                result.kb_refs = kbHits.map(k => ({
                    title: k.title, category: k.category, score: Number(k.score || 0).toFixed(2)
                }));
                // 在 suggestion 末追加 KB 參考提示
                const kbHint = kbHits.slice(0, 2).map(k => `📚 ${k.title}`).join('；');
                result.suggestion = (result.suggestion || '') + `｜參考：${kbHint}`;
            }

            // 同業標竿快速對比（給規則引擎 KPI 查詢加上「vs 同業」標籤）
            const stdMM = normalizeYYYYMM(mm);
            const yyyy = stdMM ? Number(stdMM.split('-')[0]) : new Date().getFullYear();
            const bench = await getIndustryBenchmark(bu, yyyy);
            if (bench && result.value != null && typeof result.value === 'number') {
                // 嘗試匹配 KPI 到 benchmark
                const kpiMap = {
                    gross_margin: 'gross_profit', net_margin: 'net_profit_margin',
                    debt_ratio: 'debt_ratio', current_ratio: 'current_ratio',
                    roe: 'net_profit_margin', ar_turn: 'ar_turn'
                };
                const bkpi = kpiMap[result.metric];
                const benchRow = bench.benchmarks.find(b => b.kpi === bkpi);
                if (benchRow) {
                    const myVal = Number(result.value);
                    const median = Number(benchRow.median);
                    const p75 = Number(benchRow.p75);
                    const p25 = Number(benchRow.p25);
                    let pos = '≈ 同業中位';
                    if (myVal > p75) pos = '↑ 優於同業 P75';
                    else if (myVal > median) pos = '↑ 優於同業中位';
                    else if (myVal < p25) pos = '↓ 低於同業 P25';
                    else if (myVal < median) pos = '↓ 低於同業中位';
                    result.benchmark_pos = {
                        industry: bench.industry,
                        year: bench.year,
                        median, p25, p75, myVal, pos
                    };
                    result.detail = (result.detail || '') + `｜同業 ${bench.industry} ${bench.year} 中位 ${median}，本公司 ${myVal.toFixed(2)} ${pos}`;
                }
            }
        } catch (ragErr) {
            console.warn('[aiqa] 規則引擎 KB 增強失敗（不影響主流程）:', ragErr.message);
        }

        ok(res, result);
    } catch (err) { fail500(res, err); }
});

// ===== 知識庫瀏覽 / 搜索（新增接口）=====
router.get('/knowledge', async (req, res) => {
    try {
        const keyword = String(req.query.keyword || '').trim();
        const bu_no = String(req.query.bu_no || '').toUpperCase();
        const category = String(req.query.category || '').trim();
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
        const offset = (page - 1) * pageSize;

        const where = ['k.is_active = 1'];
        const params = [];
        if (keyword) {
            // 先嘗試 FULLTEXT，不支援時 fallback 到 LIKE
            where.push('(k.title LIKE ? OR k.content LIKE ? OR k.tags LIKE ?)');
            const kw = `%${keyword}%`;
            params.push(kw, kw, kw);
        }
        if (bu_no) { where.push('(k.bu_no = ? OR k.bu_no = "ALL")'); params.push(bu_no); }
        if (category) { where.push('k.category = ?'); params.push(category); }
        const whereSql = where.join(' AND ');

        const [[cntRow]] = await pool.execute(
            `SELECT COUNT(*) AS total FROM ermm_knowledge k WHERE ${whereSql}`, params
        );
        const [rows] = await pool.execute(
            `SELECT k.uid, k.title, LEFT(k.content, 200) AS content_preview,
                    k.category, k.bu_no, k.year, k.tags, k.importance, k.source,
                    DATE_FORMAT(k.update_time, '%Y-%m-%d %H:%i') AS update_time
             FROM ermm_knowledge k WHERE ${whereSql}
             ORDER BY k.importance DESC, k.uid DESC LIMIT ? OFFSET ?`,
            [...params, pageSize, offset]
        );
        ok(res, { list: rows, total: cntRow.total, page, pageSize });
    } catch (err) { fail500(res, err); }
});

// ===== 對話記憶：取得某 conversation_id 的最近 5 輪 =====
router.get('/conversation/:convId', async (req, res) => {
    try {
        const convId = req.params.convId;
        const [rows] = await pool.execute(
            `SELECT uid, ai_records, remark, DATE_FORMAT(created_time, '%Y-%m-%d %H:%i:%s') AS created_time
             FROM ermm_ai_records WHERE remark LIKE ? ORDER BY uid DESC LIMIT 10`,
            [`%conv:${convId}%`]
        );
        const list = rows.reverse().map(r => {
            let rec = r.ai_records;
            if (typeof rec === 'string') { try { rec = JSON.parse(rec); } catch (e) { rec = {}; } }
            return { question: rec.question || '', answer: rec.answer || '' };
        });
        ok(res, { list });
    } catch (err) { fail500(res, err); }
});

// ===== 快速問題清單 =====
const SUGGESTIONS = {
    'zh-TW': [
        '本月毛利率是多少？',
        '哪個產品毛利最低？',
        '現金流量預測如何？',
        '負債比率是否偏高？',
        '各部門利潤貢獻排名',
        '預算達成率如何？',
        '集團合併營收多少？',
        '應收帳款周轉率',
        '跟去年同期比怎麼樣？',
        '跟同業比呢？',
        '未來半年現金水位預測',
        'Z-score 風險等級'
    ],
    'zh-CN': [
        '本月毛利率是多少？',
        '哪个产品毛利最低？',
        '现金流量预测如何？',
        '负债比率是否偏高？',
        '各部门利润贡献排名',
        '预算达成率如何？',
        '集团合并营收多少？',
        '应收账款周转率',
        '跟去年同期比怎么样？',
        '跟同业比呢？',
        '未来半年现金水位预测',
        'Z-score 风险等级'
    ],
    'en': [
        'What is the gross margin this month?',
        'Which product has the lowest gross profit?',
        'How does the cash flow forecast look?',
        'Is the debt ratio too high?',
        'Department profit contribution ranking',
        'How is the budget achievement rate?',
        "What is the group's consolidated revenue?",
        'Accounts receivable turnover',
        'How does it compare to last year?',
        'How does it compare to industry peers?',
        'Cash runway forecast for next 6 months',
        'Z-score risk level'
    ]
};
router.get('/suggestions', (req, res) => {
    const lang = normalizeLang(req.query.lang);
    ok(res, SUGGESTIONS[lang] || SUGGESTIONS['zh-TW']);
});

// ===== 對談記錄查詢（原有接口）=====
router.get('/records', async (req, res) => {
    try {
        const isAdmin = req.user && req.user.admin === 'Yes';
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
        const offset = (page - 1) * pageSize;

        const where = ['1=1'];
        const params = [];
        if (req.query.bu_no) { where.push('bu_no=?'); params.push(String(req.query.bu_no).toUpperCase()); }
        if (req.query.keyword) {
            where.push("(JSON_UNQUOTE(JSON_EXTRACT(ai_records, '$.question')) LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(ai_records, '$.answer')) LIKE ?)");
            const kw = `%${req.query.keyword}%`;
            params.push(kw, kw);
        }
        if (isAdmin && req.query.xuser_id) {
            where.push('xuser_id=?');
            params.push(String(req.query.xuser_id));
        } else if (!isAdmin) {
            if (req.user && req.user.user_id) { where.push('xuser_id=?'); params.push(req.user.user_id); }
        }
        const whereSql = where.join(' AND ');

        const [[cntRow]] = await pool.execute(
            `SELECT COUNT(*) AS total FROM ermm_ai_records WHERE ${whereSql}`, params
        );
        const [rows] = await pool.execute(
            `SELECT uid, bu_no, xuser_id, xuser_name, ai_records, remark,
                    DATE_FORMAT(created_time, '%Y/%m/%d %H:%i:%s') AS created_time
             FROM ermm_ai_records WHERE ${whereSql}
             ORDER BY uid DESC LIMIT ? OFFSET ?`,
            [...params, pageSize, offset]
        );
        const list = rows.map(r => {
            let rec = r.ai_records;
            if (typeof rec === 'string') { try { rec = JSON.parse(rec); } catch (e) { rec = { question: '', answer: rec }; } }
            return {
                uid: r.uid, bu_no: r.bu_no, xuser_id: r.xuser_id, xuser_name: r.xuser_name,
                question: (rec && rec.question) || '',
                answer: (rec && rec.answer) || '',
                remark: r.remark || '', created_time: r.created_time
            };
        });
        ok(res, { list, total: cntRow.total, page, pageSize });
    } catch (err) { fail500(res, err); }
});

// ============================================================
//  RAG 核心函式
// ============================================================

/**
 * 知識庫檢索（輕量 RAG）
 * 先做關鍵詞匹配（title + tags 權重較高），再補 FULLTEXT 全文搜索，加權排序
 * 回傳 [{title, content, score, category, source}]
 */
async function searchKnowledge(query, bu_no, limit = 5) {
    const kw = String(query || '').trim();
    if (!kw || kw.length < 1) return [];
    const words = kw.split(/[\s,，。？?！!、;；]+/).filter(w => w.length > 0);

    try {
        // 策略 1：MySQL FULLTEXT 全文搜索（title + content + tags）
        // 注意：FULLTEXT 對中文效果有限，但英文/數字/混合詞有效
        const ftKeyword = words.filter(w => /[a-zA-Z0-9]/.test(w)).join(' ');
        let ftRows = [];
        if (ftKeyword) {
            try {
                const [res] = await pool.execute(
                    `SELECT uid, title, content, category, bu_no, source, tags, importance,
                            MATCH(title, content, tags) AGAINST(?) AS ft_score
                     FROM ermm_knowledge
                     WHERE is_active = 1
                       AND (bu_no = ? OR bu_no = 'ALL')
                       AND MATCH(title, content, tags) AGAINST(? IN BOOLEAN MODE)
                     ORDER BY ft_score DESC, importance DESC
                     LIMIT ${limit}`,
                    [`${ftKeyword}*`, bu_no, `${ftKeyword}*`]
                );
                ftRows = res;
            } catch (ftErr) {
                // FULLTEXT 失敗（可能是沒有有效的英文/數字詞）→ 跳過
                console.log('[aiqa] FULLTEXT 跳過:', ftErr.message);
            }
        }

        // 策略 2：關鍵詞 LIKE 匹配（對中文友好，任意詞命中即可 → OR 聚合，靠 score 排序）
        const likeConditions = words.map(w => {
            const safeW = w.replace(/'/g, "''");
            return `(title LIKE '%${safeW}%' OR content LIKE '%${safeW}%' OR tags LIKE '%${safeW}%')`;
        }).join(' OR ')

        const [kwRows] = await pool.execute(
            `SELECT uid, title, content, category, bu_no, source, tags, importance,
                    (CASE WHEN title LIKE ? THEN 3 ELSE 0 END +
                     CASE WHEN tags LIKE ? THEN 2 ELSE 0 END +
                     CASE WHEN content LIKE ? THEN 1 ELSE 0 END +
                     importance * 0.5) AS kw_score
             FROM ermm_knowledge
             WHERE is_active = 1
               AND (bu_no = ? OR bu_no = 'ALL')
               AND (${likeConditions})
             ORDER BY kw_score DESC
             LIMIT ${limit}`,
            [`%${kw}%`, `%${kw}%`, `%${kw}%`, bu_no]
        );

        // 融合兩個結果集，去重後按分數排序
        const merged = new Map();
        for (const r of ftRows) {
            merged.set(r.uid, { ...r, score: Number(r.ft_score || 0) + Number(r.importance || 1) });
        }
        for (const r of kwRows) {
            const existing = merged.get(r.uid);
            const score = Number(r.kw_score || 0);
            if (existing) {
                existing.score = Math.max(existing.score, score);
            } else {
                merged.set(r.uid, { ...r, score });
            }
        }
        const sorted = Array.from(merged.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        return sorted.map(r => ({
            title: r.title,
            content: r.content,
            category: r.category,
            source: r.source,
            score: Number(r.score || 0).toFixed(2)
        }));
    } catch (err) {
        console.error('[aiqa] searchKnowledge 錯誤:', err.message);
        return [];
    }
}

/**
 * 取得 YoY 同期對比 + 12 個月趨勢
 * 回傳 { yoy: { current, lastYear, delta, deltaPct }, trend: [{YYYY_MM, sale, net_profit, Z_score}] }
 */
async function getYoYContext(bu_no, YYYY_MM) {
    let targetMM = YYYY_MM;
    if (!targetMM) {
        const [latest] = await pool.execute(
            'SELECT YYYY_MM FROM mgm_finance_summary WHERE bu_no=? ORDER BY YYYY_MM DESC LIMIT 1',
            [bu_no]
        );
        targetMM = latest[0]?.YYYY_MM || null;
    }
    if (!targetMM) return { yoy: null, trend: [] };

    // 去年同月
    const [y, m] = targetMM.split('-').map(Number);
    const lastYearMM = `${y - 1}-${String(m).padStart(2, '0')}`;

    // 當月 + 去年同月（含容錯：去年同月缺失時自動回退去年最接近月份）
    const [bothRows] = await pool.execute(
        'SELECT YYYY_MM, sale_amt, sale_cost_amt, net_profit_amt, ttl_asset_amt, ttl_debet_amt, Z_score, gross_margin, net_margin, debt_ratio, current_ratio FROM mgm_finance_summary WHERE bu_no=? AND YYYY_MM IN (?, ?)',
        [bu_no, targetMM, lastYearMM]
    );
    let curr = bothRows.find(r => r.YYYY_MM === targetMM);
    let prev = bothRows.find(r => r.YYYY_MM === lastYearMM);

    // 容錯：去年同月沒資料時，取去年最接近的月份
    if (!prev) {
        const [fallback] = await pool.execute(
            `SELECT YYYY_MM FROM mgm_finance_summary WHERE bu_no=? AND YYYY_MM < ?
             ORDER BY YYYY_MM DESC LIMIT 1`,
            [bu_no, targetMM]
        );
        if (fallback[0]) {
            const [fbRows] = await pool.execute(
                'SELECT * FROM mgm_finance_summary WHERE bu_no=? AND YYYY_MM=?',
                [bu_no, fallback[0].YYYY_MM]
            );
            prev = fbRows[0];
            if (prev) {
                prev._period = prev.YYYY_MM; // 標記實際對比月份非去年同月
            }
        }
    }

    // 輔助函數：計算變動率 + 標記方向（好/壞）
    const calcDelta = (cVal, pVal, reverseSign = false) => {
        // reverseSign=true 時，上升 = 壞（如負債率）；false 時上升 = 好（如毛利率）
        if (cVal == null || pVal == null) return { delta: null, deltaPct: null, trend: null };
        const delta = Number(cVal) - Number(pVal);
        const deltaPct = Number(pVal) !== 0 ? ((delta / Math.abs(Number(pVal))) * 100).toFixed(2) : null;
        const isGood = reverseSign ? delta < 0 : delta > 0;
        const trend = Math.abs(delta) < 0.01 ? '→' : (isGood ? '↑' : '↓');
        return { delta: delta.toFixed(2), deltaPct, trend };
    };

    const yoy = {
        period: curr?.YYYY_MM || targetMM,
        lastYearPeriod: prev?.YYYY_MM || lastYearMM,
        isExactYoY: prev ? prev.YYYY_MM === lastYearMM : false,

        sale: curr ? Number(curr.sale_amt || 0).toFixed(2) : null,
        sale_lastYear: prev ? Number(prev.sale_amt || 0).toFixed(2) : null,
        sale_delta: curr && prev ? (Number(curr.sale_amt || 0) - Number(prev.sale_amt || 0)).toFixed(2) : null,
        sale_deltaPct: calcDelta(curr?.sale_amt, prev?.sale_amt, false).deltaPct,
        sale_trend: calcDelta(curr?.sale_amt, prev?.sale_amt, false).trend,

        netProfit: curr ? Number(curr.net_profit_amt || 0).toFixed(2) : null,
        netProfit_lastYear: prev ? Number(prev.net_profit_amt || 0).toFixed(2) : null,
        netProfit_deltaPct: calcDelta(curr?.net_profit_amt, prev?.net_profit_amt, false).deltaPct,
        netProfit_trend: calcDelta(curr?.net_profit_amt, prev?.net_profit_amt, false).trend,

        grossMargin: curr ? Number(curr.gross_margin || 0).toFixed(2) : null,
        grossMargin_lastYear: prev ? Number(prev.gross_margin || 0).toFixed(2) : null,
        grossMargin_delta: calcDelta(curr?.gross_margin, prev?.gross_margin, false).delta,
        grossMargin_trend: calcDelta(curr?.gross_margin, prev?.gross_margin, false).trend,

        netMargin: curr ? Number(curr.net_margin || 0).toFixed(2) : null,
        netMargin_lastYear: prev ? Number(prev.net_margin || 0).toFixed(2) : null,
        netMargin_delta: calcDelta(curr?.net_margin, prev?.net_margin, false).delta,
        netMargin_trend: calcDelta(curr?.net_margin, prev?.net_margin, false).trend,

        Z_score: curr ? Number(curr.Z_score || 0).toFixed(2) : null,
        Z_score_lastYear: prev ? Number(prev.Z_score || 0).toFixed(2) : null,
        Z_score_delta: calcDelta(curr?.Z_score, prev?.Z_score, false).delta,
        Z_score_trend: calcDelta(curr?.Z_score, prev?.Z_score, false).trend,

        debtRatio: curr ? Number(curr.debt_ratio || 0).toFixed(2) : null,
        debtRatio_lastYear: prev ? Number(prev.debt_ratio || 0).toFixed(2) : null,
        debtRatio_delta: calcDelta(curr?.debt_ratio, prev?.debt_ratio, true).delta,
        debtRatio_trend: calcDelta(curr?.debt_ratio, prev?.debt_ratio, true).trend,

        currentRatio: curr ? Number(curr.current_ratio || 0).toFixed(2) : null,
        currentRatio_lastYear: prev ? Number(prev.current_ratio || 0).toFixed(2) : null,
        currentRatio_delta: calcDelta(curr?.current_ratio, prev?.current_ratio, false).delta,
        currentRatio_trend: calcDelta(curr?.current_ratio, prev?.current_ratio, false).trend
    };

    // 12 個月趨勢
    const [trendRows] = await pool.execute(
        `SELECT YYYY_MM, sale_amt, net_profit_amt, Z_score, gross_margin, net_margin
         FROM mgm_finance_summary WHERE bu_no=? AND YYYY_MM <= ?
         ORDER BY YYYY_MM DESC LIMIT 12`,
        [bu_no, targetMM]
    );
    const trend = trendRows.reverse().map(r => ({
        period: r.YYYY_MM,
        sale: Number(r.sale_amt || 0).toFixed(2),
        netProfit: Number(r.net_profit_amt || 0).toFixed(2),
        Z_score: Number(r.Z_score || 0).toFixed(2),
        grossMargin: Number(r.gross_margin || 0).toFixed(2),
        netMargin: Number(r.net_margin || 0).toFixed(2)
    }));

    return { yoy, trend };
}

/**
 * 取得同業標竿分位數
 */
async function getIndustryBenchmark(bu_no, year) {
    const industry = BU_INDUSTRY[bu_no];
    if (!industry) return null;
    const targetYear = year || new Date().getFullYear();

    // 取該公司主要 KPI 的同業分位
    const [rows] = await pool.execute(
        `SELECT kpi_id, p10, p25, median, p75, p90 FROM industry_benchmark
         WHERE industry=? AND year=? AND kpi_id IN ('gross_profit', 'net_profit_margin', 'debt_ratio', 'current_ratio', 'altman_z1', 'ar_turn', 'bz_quick')
         ORDER BY kpi_id`,
        [industry, targetYear]
    );
    if (rows.length === 0) return null;

    return {
        industry,
        year: targetYear,
        benchmarks: rows.map(r => ({
            kpi: r.kpi_id,
            p10: Number(r.p10 || 0).toFixed(2),
            p25: Number(r.p25 || 0).toFixed(2),
            median: Number(r.median || 0).toFixed(2),
            p75: Number(r.p75 || 0).toFixed(2),
            p90: Number(r.p90 || 0).toFixed(2)
        }))
    };
}

/**
 * 融合 RAG 所有資料，產生 LLM prompt 上下文
 */
async function buildRAGContext(question, bu_no, YYYY_MM, opts = {}) {
    const sources = ['db']; // 標記資料來源
    const ctx = {};

    // 1. 基礎財務資料（原有）
    const stdMM = normalizeYYYYMM(YYYY_MM);
    const r = await getFinanceRow(bu_no, stdMM);
    if (!r.YYYY_MM) return { ctx: null, sources: ['empty'], knowledgeHits: [] };

    const num = (v) => Number(v || 0);
    const sale = num(r.sale_amt), cost = num(r.sale_cost_amt);
    const gross = sale - cost;
    ctx.basic = {
        bu_no, period: r.YYYY_MM,
        sale: sale.toFixed(2), cost: cost.toFixed(2), gross: gross.toFixed(2),
        grossMargin: sale > 0 ? (gross / sale * 100).toFixed(2) : '0.00',
        saleExp: num(r.sale_exp_amt).toFixed(2),
        mgmtExp: num(r.MGM_EXP_amt).toFixed(2),
        finExp: num(r.finance_EXP_amt).toFixed(2),
        netProfit: num(r.net_profit_amt).toFixed(2),
        netMargin: sale > 0 ? (num(r.net_profit_amt) / sale * 100).toFixed(2) : '0.00',
        AR: num(r.AR_amt).toFixed(2), AP: num(r.AP_amt).toFixed(2),
        loan: num(r.loan_amt).toFixed(2),
        cashTotal: (num(r.cash_amt) + num(r.deposite_amt)).toFixed(2),
        totalAsset: num(r.ttl_asset_amt).toFixed(2), totalDebt: num(r.ttl_debet_amt).toFixed(2),
        debtRatio: num(r.ttl_asset_amt) > 0 ? (num(r.ttl_debet_amt) / num(r.ttl_asset_amt) * 100).toFixed(2) : '0.00',
        equity: num(r.stockholder_amt).toFixed(2),
        ROE: num(r.stockholder_amt) > 0 ? (num(r.net_profit_amt) / num(r.stockholder_amt) * 100).toFixed(2) : '0.00',
        currentRatio: Number(r.current_ratio || 0).toFixed(2),
        Z_score: Number(r.Z_score || 0).toFixed(2),
        receivableTurnover: Number(r.receivable_turnover || 0).toFixed(2)
    };

    // 2. YoY + 趨勢（RAG 新增）
    const { yoy, trend } = await getYoYContext(bu_no, stdMM);
    if (yoy) {
        ctx.yoy = yoy;
        sources.push('yoy');
    }
    if (trend.length > 0) {
        ctx.trend = trend;
        sources.push('trend');
    }

    // 3. 同業標竿（RAG 新增）
    const bench = await getIndustryBenchmark(bu_no, r.YYYY ? Number(r.YYYY) : null);
    if (bench) {
        ctx.benchmark = bench;
        sources.push('benchmark');
    }

    // 4. 知識庫檢索（RAG 新增，可關閉）
    let knowledgeHits = [];
    if (opts.useKnowledge !== false) {
        knowledgeHits = await searchKnowledge(question, bu_no, 5);
        if (knowledgeHits.length > 0) {
            ctx.knowledge = knowledgeHits.map(k => ({
                title: k.title,
                content: k.content.slice(0, 500),
                category: k.category,
                source: k.source
            }));
            sources.push('knowledge');
        }
    }

    // 5. 對話記憶（RAG 新增）
    let conversationHistory = [];
    if (Array.isArray(opts.history) && opts.history.length > 0) {
        conversationHistory = opts.history.slice(-5); // 最近 5 輪
        sources.push('memory');
    }

    return { ctx, sources, knowledgeHits, conversationHistory };
}

// ============================================================
//  askLLMRAG — LLM + RAG 融合回答（替代原有 askLLM）
// ============================================================
async function askLLMRAG(question, bu_no, YYYY_MM, provider, lang, opts = {}) {
    const uiLang = normalizeLang(lang);

    // 1. 取 LLM 服務商設定
    const [cfgRows] = await pool.execute('SELECT * FROM llm_config WHERE provider=?', [provider]);
    if (cfgRows.length === 0) throw new Error('LLM 服務商設定不存在，請聯絡管理員');
    const cfg = cfgRows[0];
    if (!cfg.api_key) {
        const err = new Error(`「${cfg.provider_name}」尚未設定 API Key，請點擊 ⚙️ API Key 管理進行設定`);
        err.code = 'LLM_KEY_MISSING';
        throw err;
    }

    // 2. 融合 RAG 上下文
    const { ctx, sources, knowledgeHits, conversationHistory } = await buildRAGContext(
        question, bu_no, YYYY_MM, opts
    );
    if (!ctx) {
        const err = new Error(`資料庫中查無 ${bu_no} 公司的財務資料`);
        err.code = 'NO_FINANCE_DATA';
        throw err;
    }

    // 3. 組裝 prompt（分語言）
    const PROMPT_LABELS = {
        'zh-TW': {
            basic: '【基礎財務資料 · 來源：ermm_db 即時查詢】',
            yoy: '【去年同期比較 · 來源：ermm_db】',
            trend: '【過去 12 個月趨勢 · 來源：ermm_db】',
            benchmark: '【同業標竿分位數 · 來源：industry_benchmark】',
            knowledge: '【知識庫參考資料 · 來源：内部知识库】',
            memory: '【之前的對話紀錄（最近 5 輪）】',
            q: '問題',
            rule_knowledge: '- 引用知識庫內容時，請標註「📚 來自知識庫」',
            rule_db: '- 引用即時財務資料時，請標註「📊 來自資料庫即時查詢」',
            rule_ai: '- 若為你的分析推論，請標註「🧠 AI 分析」',
            rule_sources: '- 回答結尾列出本次使用的所有資料來源',
            footers: {
                knowledge: `知識庫命中 ${knowledgeHits.length} 條`,
                yoy: '已納入 YoY 同期對比',
                trend: '已納入 12 個月趨勢',
                benchmark: '已納入同業標竿',
                memory: `已納入對話記憶 ${conversationHistory.length} 輪`
            }
        },
        'zh-CN': {
            basic: '【基础财务数据 · 来源：ermm_db 实时查询】',
            yoy: '【去年同期对比 · 来源：ermm_db】',
            trend: '【过去 12 个月趋势 · 来源：ermm_db】',
            benchmark: '【同业标杆分位数 · 来源：industry_benchmark】',
            knowledge: '【知识库参考资料 · 来源：内部知识库】',
            memory: '【之前的对话记录（最近 5 轮）】',
            q: '问题',
            rule_knowledge: '- 引用知识库内容时，请标注「📚 来自知识库」',
            rule_db: '- 引用实时财务数据时，请标注「📊 来自数据库实时查询」',
            rule_ai: '- 若为你的分析推论，请标注「🧠 AI 分析」',
            rule_sources: '- 回答结尾列出本次使用的所有数据来源',
            footers: {
                knowledge: `知识库命中 ${knowledgeHits.length} 条`,
                yoy: '已纳入 YoY 同期对比',
                trend: '已纳入 12 个月趋势',
                benchmark: '已纳入同业标杆',
                memory: `已纳入对话记忆 ${conversationHistory.length} 轮`
            }
        },
        'en': {
            basic: '【Basic Financial Data · Source: ermm_db real-time query】',
            yoy: '【YoY Comparison · Source: ermm_db】',
            trend: '【12-Month Trend · Source: ermm_db】',
            benchmark: '【Industry Benchmark Percentiles · Source: industry_benchmark】',
            knowledge: '【Knowledge Base References · Source: internal knowledge base】',
            memory: '【Previous Conversation History (last 5 turns)】',
            q: 'Question',
            rule_knowledge: '- When citing knowledge base content, mark it with "📚 From Knowledge Base"',
            rule_db: '- When citing real-time financial data, mark it with "📊 From DB Query"',
            rule_ai: '- When providing your own analysis, mark it with "🧠 AI Analysis"',
            rule_sources: '- At the end of your answer, list ALL data sources used',
            footers: {
                knowledge: `${knowledgeHits.length} knowledge base hit(s)`,
                yoy: 'YoY comparison included',
                trend: '12-month trend included',
                benchmark: 'Industry benchmark included',
                memory: `${conversationHistory.length} turns of conversation memory included`
            }
        }
    };
    const L = PROMPT_LABELS[uiLang];

    // 組裝 user prompt 內容
    const sections = [];

    // 基礎資料
    sections.push(`${L.basic}\n${JSON.stringify(ctx.basic, null, 2)}`);

    // YoY
    if (ctx.yoy) sections.push(`${L.yoy}\n${JSON.stringify(ctx.yoy, null, 2)}`);

    // 趨勢
    if (ctx.trend) sections.push(`${L.trend}\n${JSON.stringify(ctx.trend, null, 2)}`);

    // 同業
    if (ctx.benchmark) sections.push(`${L.benchmark}\n${JSON.stringify(ctx.benchmark, null, 2)}`);

    // 知識庫
    if (ctx.knowledge && ctx.knowledge.length > 0) {
        sections.push(`${L.knowledge}\n${ctx.knowledge.map((k, i) =>
            `[${i + 1}] ${k.title} (${k.category}, source: ${k.source})\n${k.content}`
        ).join('\n\n')}`);
    }

    // 對話記憶
    if (conversationHistory.length > 0) {
        sections.push(`${L.memory}\n${conversationHistory.map((h, i) =>
            `Turn ${i + 1}: Q: ${h.question}\nA: ${h.answer}`
        ).join('\n\n')}`);
    }

    // 最終問題
    sections.push(`${L.q}：${question}`);

    const userPrompt = sections.join('\n\n' + '─'.repeat(40) + '\n\n');

    // 4. 呼叫 LLM
    const messages = [
        { role: 'system', content: SYSTEM_PROMPTS[uiLang] },
        { role: 'user', content: userPrompt }
    ];
    const content = await chatCompletion(
        { base_url: cfg.base_url, api_key: cfg.api_key, model: cfg.model },
        messages,
        { temperature: 0.2, max_tokens: 3072, timeout: 90000 }
    );

    // 5. 組裝 detail 與 suggestion
    const flagMap = {
        db: L.basic.includes('来源') ? '📊 資料庫即時查詢' : '📊 DB Query',
        yoy: L.footers.yoy,
        trend: L.footers.trend,
        benchmark: L.footers.benchmark,
        knowledge: L.footers.knowledge,
        memory: L.footers.memory
    };
    const detailParts = sources
        .filter(s => s !== 'db' && flagMap[s])
        .map(s => flagMap[s]);
    const sourceTags = {
        'zh-TW': { detail: `資料來源：ermm_db · ${bu_no}`, suggestion: `由 ${cfg.provider_name}（${cfg.model}）生成 · AI 回答僅供參考` },
        'zh-CN': { detail: `数据来源：ermm_db · ${bu_no}`, suggestion: `由 ${cfg.provider_name}（${cfg.model}）生成 · AI 回答仅供参考` },
        'en': { detail: `Source: ermm_db · ${bu_no}`, suggestion: `Generated by ${cfg.provider_name} (${cfg.model}) · For reference only` }
    };

    return {
        answer: content,
        detail: `${sourceTags[uiLang].detail} · ${detailParts.join(' · ')}`,
        suggestion: sourceTags[uiLang].suggestion,
        metric: 'llm',
        provider: cfg.provider_name,
        // 給前端用的 RAG 資訊
        ragSources: sources,
        knowledgeHits: knowledgeHits.map(k => ({
            title: k.title, category: k.category, score: k.score
        }))
    };
}

// ============================================================
//  原有保留函式（normalize / 規則引擎 / 存檔 / 取資料）
// ============================================================

function normalizeLang(input) {
    const s = String(input || '').toLowerCase().replace('_', '-');
    if (s.startsWith('en')) return 'en';
    if (s.includes('cn') || s.includes('sg') || s.includes('hans')) return 'zh-CN';
    return 'zh-TW';
}

const SYSTEM_PROMPTS = {
    'zh-TW': '你是 ERMM 企業的資深財務分析師。請遵守以下規則：'
        + '1. 只根據使用者提供的財務資料回答問題；'
        + '2. 所有金額保留小數點後 2 位並加上千分位；'
        + '3. 毛利率、負債比率等百分比必須明確標示 %；'
        + '4. 無論使用者用何種語言或簡繁體提問，你的回答「必須全部使用繁體中文」，不得輸出簡體字；'
        + '5. 條理清晰，先給結論再給數據依據；'
        + '6. 資料不足時明確指出缺少什麼，不可編造數字；'
        + '7. 直接回答問題，不要複述、引用或解釋這些規則，也不要描述使用者的要求；'
        + '8. 回答中標註資料來源：📊 來自資料庫即時查詢 / 📚 來自知識庫 / 🧠 AI 分析。',
    'zh-CN': '你是 ERMM 企业的资深财务分析师。请遵守以下规则：'
        + '1. 只根据用户提供的财务资料回答问题；'
        + '2. 所有金额保留小数点后 2 位并加上千分位；'
        + '3. 毛利率、负债比率等百分比必须明确标示 %；'
        + '4. 无论用户用何种语言或繁简体提问，你的回答「必须全部使用简体中文」，不得输出繁体字；'
        + '5. 条理清晰，先给结论再给数据依据；'
        + '6. 资料不足时明确指出缺少什么，不可编造数字；'
        + '7. 直接回答问题，不要复述、引用或解释这些规则，也不要描述用户的要求；'
        + '8. 回答中标注数据来源：📊 来自数据库实时查询 / 📚 来自知识库 / 🧠 AI 分析。',
    'en': 'You are a senior financial analyst at ERMM. Follow these rules: '
        + '1. Answer only based on the financial data provided by the user. '
        + '2. All monetary amounts must have exactly 2 decimal places and thousand separators. '
        + '3. Percentages such as gross margin and debt ratio must be explicitly marked with %. '
        + '4. Regardless of the language used in the question, your entire answer MUST be written in English only; do not output any Chinese characters. '
        + '5. Be well structured: conclusion first, then supporting figures. '
        + '6. If the data is insufficient, state exactly what is missing; never fabricate numbers. '
        + '7. Answer the question directly; do not repeat, quote, or explain these instructions, and do not describe the user\u2019s request. '
        + '8. Mark your sources in the answer: 📊 DB Query / 📚 Knowledge Base / 🧠 AI Analysis.'
};

function normalizeYYYYMM(input) {
    if (!input) return null;
    const s = String(input).trim();
    if (/^\d{4}-\d{1,2}$/.test(s)) {
        const [y, m] = s.split('-');
        return `${y}-${m.padStart(2, '0')}`;
    }
    if (/^\d{4}\/\d{1,2}$/.test(s)) {
        const [y, m] = s.split('/');
        return `${y}-${m.padStart(2, '0')}`;
    }
    if (/^\d{6}$/.test(s)) {
        return `${s.slice(0, 4)}-${s.slice(4, 6)}`;
    }
    return null;
}

// === E2 新增：從 DB 載入 conversation_id 的歷史對話 ===
async function loadConversationFromDB(convId, limit = 5) {
    if (!convId) return [];
    const [rows] = await pool.execute(
        `SELECT ai_records FROM ermm_ai_records WHERE remark LIKE ?
         ORDER BY uid DESC LIMIT ${limit}`,
        [`%conv:${convId}%`]
    );
    // 倒序 → 時間正序（最早在前）
    return rows.reverse().map(r => {
        let rec = r.ai_records;
        if (typeof rec === 'string') { try { rec = JSON.parse(rec); } catch (e) { rec = {}; } }
        return { question: rec.question || '', answer: rec.answer || '' };
    }).filter(h => h.question && h.answer);
}

async function saveAIRecord({ bu_no, question, answer, remark, user, xuser_name, conversation_id }) {
    const xuserId = (user && user.user_id) || 'unknown';
    let xuserName = String(xuser_name || '').trim();
    if (!xuserName && xuserId !== 'unknown') {
        const [rows] = await pool.execute(
            'SELECT xuser_name FROM cams_xuser WHERE xuser_id=? LIMIT 1', [xuserId]
        );
        xuserName = (rows[0] && rows[0].xuser_name) || xuserId;
    }
    let fullRemark = String(remark || '').slice(0, 200);
    if (conversation_id) fullRemark = `conv:${conversation_id} · ${fullRemark}`;
    await pool.execute(
        `INSERT INTO ermm_ai_records (bu_no, xuser_id, xuser_name, ai_records, remark)
         VALUES (?, ?, ?, CAST(? AS JSON), ?)`,
        [
            bu_no, xuserId, xuserName,
            JSON.stringify({ question: String(question), answer: String(answer) }),
            fullRemark
        ]
    );
}

async function getFinanceRow(bu_no, stdMM) {
    let r = {};
    if (stdMM) {
        const [rows] = await pool.execute(
            'SELECT * FROM mgm_finance_summary WHERE bu_no=? AND YYYY_MM=?', [bu_no, stdMM]
        );
        r = rows[0] || {};
        if (!r.YYYY_MM) {
            const [latest] = await pool.execute(
                'SELECT * FROM mgm_finance_summary WHERE bu_no=? ORDER BY YYYY_MM DESC LIMIT 1', [bu_no]
            );
            r = latest[0] || {};
        }
    } else {
        const [latest] = await pool.execute(
            'SELECT * FROM mgm_finance_summary WHERE bu_no=? ORDER BY YYYY_MM DESC LIMIT 1', [bu_no]
        );
        r = latest[0] || {};
    }
    return r;
}

// 規則引擎（保留原有 analyzeQuestion 不變）
async function analyzeQuestion(q, bu_no, YYYY_MM) {
    const stdMM = normalizeYYYYMM(YYYY_MM);
    const r = await getFinanceRow(bu_no, stdMM);

    if (q.includes('毛利') || q.includes('gross')) {
        const sale = Number(r.sale_amt || 0);
        const cost = Number(r.sale_cost_amt || 0);
        const gp = sale - cost;
        const gpm = sale > 0 ? (gp / sale * 100) : 0;
        return {
            answer: `${r.YYYY_MM} 毛利率為 ${gpm.toFixed(2)}%`,
            detail: `銷售收入 ${sale.toLocaleString()}，銷售成本 ${cost.toLocaleString()}，毛利 ${gp.toLocaleString()}`,
            suggestion: gpm < 20 ? '⚠️ 毛利率低於 20% 門檻，建議檢討產品組合與成本結構' : '✅ 毛利率表現良好',
            metric: 'gross_margin', value: gpm
        };
    }

    if (q.includes('淨利') || q.includes('净利') || q.includes('net profit')) {
        const sale = Number(r.sale_amt || 0);
        const np = Number(r.net_profit_amt || 0);
        const npm = sale > 0 ? (np / sale * 100) : 0;
        return {
            answer: `${r.YYYY_MM} 淨利率為 ${npm.toFixed(2)}%`,
            detail: `淨利 ${np.toLocaleString()}，銷售收入 ${sale.toLocaleString()}`,
            suggestion: npm < 5 ? '⚠️ 淨利率偏低，建議檢討費用結構' : '✅ 淨利率表現正常',
            metric: 'net_margin', value: npm
        };
    }

    if (q.includes('負債') || q.includes('负债') || q.includes('debt') || q.includes('槓桿') || q.includes('杠杆')) {
        const asset = Number(r.ttl_asset_amt || 1);
        const debt = Number(r.ttl_debet_amt || 0);
        const dr = (debt / asset * 100);
        return {
            answer: `${r.YYYY_MM} 負債比率為 ${dr.toFixed(2)}%`,
            detail: `總資產 ${asset.toLocaleString()}，總負債 ${debt.toLocaleString()}`,
            suggestion: dr > 70 ? '🚨 負債比率過高，建議償還借款降低財務槓桿' : dr > 50 ? '⚠️ 負債比率偏高，需持續關注' : '✅ 負債比率健康',
            metric: 'debt_ratio', value: dr
        };
    }

    if (q.includes('流動') || q.includes('流动') || q.includes('current ratio') || q.includes('償債') || q.includes('偿债')) {
        return {
            answer: `${r.YYYY_MM} 流動比率為 ${Number(r.current_ratio || 0).toFixed(2)}`,
            detail: `流動資產 ${Number(r.current_asset_amt || 0).toLocaleString()}，流動負債 ${Number(r.current_debet_amt || 0).toLocaleString()}`,
            suggestion: Number(r.current_ratio) < 1.5 ? '⚠️ 流動比率低於 1.5，短期償債能力不足' : '✅ 流動比率良好',
            metric: 'current_ratio', value: r.current_ratio
        };
    }

    if (q.includes('現金') || q.includes('现金') || q.includes('cash')) {
        const cash = Number(r.cash_amt || 0) + Number(r.deposite_amt || 0);
        return {
            answer: `${r.YYYY_MM} 現金及約當現金餘額為 ${cash.toLocaleString()}`,
            detail: `現金 ${Number(r.cash_amt || 0).toLocaleString()}，銀行存款 ${Number(r.deposite_amt || 0).toLocaleString()}`,
            suggestion: '至「現金流量預測」查看未來 13 週現金水位',
            metric: 'cash', value: cash
        };
    }

    if (q.includes('應收') || q.includes('应收') || q.includes('receivable') || q.includes('ar') || q.includes('周轉') || q.includes('周转')) {
        return {
            answer: `${r.YYYY_MM} 應收帳款周轉率為 ${Number(r.receivable_turnover || 0).toFixed(2)} 次`,
            detail: `應收帳款餘額 ${Number(r.AR_amt || 0).toLocaleString()}`,
            suggestion: Number(r.receivable_turnover) < 4 ? '⚠️ 應收周轉率偏低，建議加強催收' : '✅ 應收周轉正常',
            metric: 'ar_turn', value: r.receivable_turnover
        };
    }

    if (q.includes('roe') || q.includes('權益報酬') || q.includes('权益报酬') || q.includes('股東') || q.includes('股东')) {
        return {
            answer: `${r.YYYY_MM} ROE 為 ${Number(r.ROE || 0).toFixed(2)}%`,
            detail: `淨利 ${Number(r.net_profit_amt || 0).toLocaleString()}，股東權益 ${Number(r.stockholder_amt || 0).toLocaleString()}`,
            suggestion: Number(r.ROE) < 8 ? '⚠️ ROE 低於 8%，股東報酬率待提升' : '✅ ROE 表現良好',
            metric: 'roe', value: r.ROE
        };
    }

    if (q.includes('預算') || q.includes('预算') || q.includes('budget') || q.includes('達成') || q.includes('达成')) {
        const [bud] = await pool.execute(
            `SELECT account_name, SUM(budget_amt) AS b, SUM(actual_amt) AS a
             FROM budget_detail WHERE bu_no=? AND YYYY_MM LIKE ? GROUP BY account_name`,
            [bu_no, `${r.YYYY || new Date().getFullYear()}%`]
        );
        const items = bud.map(x => `${x.account_name}: 預算 ${Number(x.b).toLocaleString()} / 實際 ${Number(x.a).toLocaleString()} (達成率 ${Number(x.b)>0?(Number(x.a)/Number(x.b)*100).toFixed(1):0}%)`).join('<br>');
        return {
            answer: `${r.YYYY} 年度預算執行情形`,
            detail: items,
            suggestion: '至「預算編制」查看完整差異分析',
            metric: 'budget', value: null
        };
    }

    if (q.includes('合併') || q.includes('合并') || q.includes('集團') || q.includes('集团') || q.includes('consolidat')) {
        const [sum] = await pool.execute(
            `SELECT SUM(sale_amt) AS s, SUM(net_profit_amt) AS p FROM mgm_finance_summary WHERE YYYY_MM=?`, [r.YYYY_MM]
        );
        return {
            answer: `${r.YYYY_MM} 集團合併營收 ${Number(sum[0].s || 0).toLocaleString()}`,
            detail: `合併淨利 ${Number(sum[0].p || 0).toLocaleString()}`,
            suggestion: '至「合併報表」查看完整合併報表',
            metric: 'consolidated', value: sum[0].s
        };
    }

    if (q.includes('部門') || q.includes('部门') || q.includes('department') || q.includes('利潤中心') || q.includes('利润中心')) {
        const [dept] = await pool.execute(
            `SELECT d.dept_name, SUM(p.profit_amt) AS profit FROM mgmt_dept_pl p JOIN mgmt_dept d ON p.bu_no=d.bu_no AND p.dept_code=d.dept_code WHERE p.bu_no=? AND p.YYYY_MM LIKE ? GROUP BY d.dept_name ORDER BY profit DESC`,
            [bu_no, `${r.YYYY || new Date().getFullYear()}%`]
        );
        const items = dept.map((x, i) => `${i+1}. ${x.dept_name}: ${Number(x.profit).toLocaleString()}`).join('<br>');
        return {
            answer: `${r.YYYY || new Date().getFullYear()} 年各部門利潤貢獻排名`,
            detail: items,
            suggestion: '至「管理會計」查看完整部門損益表',
            metric: 'department', value: null
        };
    }

    return {
        answer: `目前可查詢：毛利率、淨利率、負債比率、流動比率、現金餘額、應收周轉率、ROE、預算達成、合併報表、部門損益等。請換個方式提問。`,
        detail: `當前公司：${bu_no}，最新一期：${r.YYYY_MM || '無'}`,
        suggestion: '可點擊下方建議問題快速查詢',
        metric: 'general', value: null
    };
}

module.exports = router;
