/**
 * AI 問答路由
 * 自然語言財務查詢（規則引擎實現，可串接 LLM）
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const { PROVIDERS, chatCompletion } = require('../utils/llmClient');

// 問答接口
router.post('/ask', async (req, res) => {
    try {
        const { question, bu_no, YYYY_MM, useLLM, provider, lang } = req.body;
        if (!question) return fail(res, '請輸入問題');
        const bu = bu_no || 'HM';
        const mm = YYYY_MM || null;

        // 勾選 LLM：所有問答交由大語言模型（帶入 ermm_db 財務資料作為上下文）
        if (useLLM) {
            const pvd = String(provider || '').toLowerCase();
            if (!PROVIDERS[pvd]) return fail(res, '請選擇 LLM 服務商（Kimi 或 DeepSeek）');
            try {
                const result = await askLLM(question, bu, mm, pvd, lang);
                return ok(res, result);
            } catch (e) {
                // Key 未設定 / 無財務資料等可預期情況回 400，其餘回 500
                if (e.code === 'LLM_KEY_MISSING' || e.code === 'NO_FINANCE_DATA') return fail(res, e.message);
                return fail500(res, e);
            }
        }

        // 未勾選：走規則引擎自然語言查詢 ermm_db
        const result = await analyzeQuestion(question.toLowerCase(), bu, mm);
        ok(res, result);
    } catch (err) { fail500(res, err); }
});

// 快速問題清單（依 UI 語言回傳對應版本）
const SUGGESTIONS = {
    'zh-TW': [
        '本月毛利率是多少？',
        '哪個產品毛利最低？',
        '現金流量預測如何？',
        '負債比率是否偏高？',
        '各部門利潤貢獻排名',
        '預算達成率如何？',
        '集團合併營收多少？',
        '應收帳款周轉率'
    ],
    'zh-CN': [
        '本月毛利率是多少？',
        '哪个产品毛利最低？',
        '现金流量预测如何？',
        '负债比率是否偏高？',
        '各部门利润贡献排名',
        '预算达成率如何？',
        '集团合并营收多少？',
        '应收账款周转率'
    ],
    'en': [
        'What is the gross margin this month?',
        'Which product has the lowest gross profit?',
        'How does the cash flow forecast look?',
        'Is the debt ratio too high?',
        'Department profit contribution ranking',
        'How is the budget achievement rate?',
        "What is the group's consolidated revenue?",
        'Accounts receivable turnover'
    ]
};

router.get('/suggestions', (req, res) => {
    const lang = normalizeLang(req.query.lang);
    ok(res, SUGGESTIONS[lang] || SUGGESTIONS['zh-TW']);
});

// 語言歸一化：支援 zh-TW/zh-HK/zh-CN/zh/en 等寫法，輸出 zh-TW / zh-CN / en
function normalizeLang(input) {
    const s = String(input || '').toLowerCase().replace('_', '-');
    if (s.startsWith('en')) return 'en';
    if (s.includes('cn') || s.includes('sg') || s.includes('hans')) return 'zh-CN';
    return 'zh-TW'; // 預設繁體中文（含 zh-TW、zh-HK、zh、未知值）
}

// 依 UI 語言產生 LLM 系統提示詞（硬性約束回答語言，避免跟隨提問語言）
const SYSTEM_PROMPTS = {
    'zh-TW': '你是 ERMM 企業的資深財務分析師。請遵守以下規則：'
        + '1. 只根據使用者提供的財務資料回答問題；'
        + '2. 所有金額保留小數點後 2 位並加上千分位；'
        + '3. 毛利率、負債比率等百分比必須明確標示 %；'
        + '4. 無論使用者用何種語言或簡繁體提問，你的回答「必須全部使用繁體中文」，不得輸出簡體字；'
        + '5. 條理清晰，先給結論再給數據依據；'
        + '6. 資料不足時明確指出缺少什麼，不可編造數字；'
        + '7. 直接回答問題，不要複述、引用或解釋這些規則，也不要描述使用者的要求。',
    'zh-CN': '你是 ERMM 企业的资深财务分析师。请遵守以下规则：'
        + '1. 只根据用户提供的财务资料回答问题；'
        + '2. 所有金额保留小数点后 2 位并加上千分位；'
        + '3. 毛利率、负债比率等百分比必须明确标示 %；'
        + '4. 无论用户用何种语言或繁简体提问，你的回答「必须全部使用简体中文」，不得输出繁体字；'
        + '5. 条理清晰，先给结论再给数据依据；'
        + '6. 资料不足时明确指出缺少什么，不可编造数字；'
        + '7. 直接回答问题，不要复述、引用或解释这些规则，也不要描述用户的要求。',
    'en': 'You are a senior financial analyst at ERMM. Follow these rules: '
        + '1. Answer only based on the financial data provided by the user. '
        + '2. All monetary amounts must have exactly 2 decimal places and thousand separators. '
        + '3. Percentages such as gross margin and debt ratio must be explicitly marked with %. '
        + '4. Regardless of the language used in the question, your entire answer MUST be written in English only; do not output any Chinese characters. '
        + '5. Be well structured: conclusion first, then supporting figures. '
        + '6. If the data is insufficient, state exactly what is missing; never fabricate numbers. '
        + '7. Answer the question directly; do not repeat, quote, or explain these instructions, and do not describe the user\u2019s request.'
};

// 格式標準化：將各種輸入格式統一為 YYYY/MM
function normalizeYYYYMM(input) {
    if (!input) return null;
    const s = String(input).trim();
    // 已經是 YYYY/MM 格式
    if (/^\d{4}\/\d{1,2}$/.test(s)) {
        const [y, m] = s.split('/');
        return `${y}/${m.padStart(2, '0')}`;
    }
    // YYYY-MM 格式（瀏覽器 <input type="month"> 預設值）
    if (/^\d{4}-\d{1,2}$/.test(s)) {
        const [y, m] = s.split('-');
        return `${y}/${m.padStart(2, '0')}`;
    }
    // YYYYMM 純數字格式
    if (/^\d{6}$/.test(s)) {
        return `${s.slice(0, 4)}/${s.slice(4, 6)}`;
    }
    return null;
}

// 取得指定公司+月份的財務摘要；無資料或未指定月份時回退最新一期
async function getFinanceRow(bu_no, stdMM) {
    let r = {};
    if (stdMM) {
        const [rows] = await pool.execute(
            'SELECT * FROM mgm_finance_summary WHERE bu_no=? AND YYYY_MM=?', [bu_no, stdMM]
        );
        r = rows[0] || {};
        // 若指定月份無資料，回退到最新一期
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

// 問題分析引擎（規則引擎，未勾選 LLM 時使用）
async function analyzeQuestion(q, bu_no, YYYY_MM) {
    // 格式標準化
    const stdMM = normalizeYYYYMM(YYYY_MM);

    const r = await getFinanceRow(bu_no, stdMM);

    // 毛利率相關
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

    // 淨利率
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

    // 負債比率
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

    // 流動比率
    if (q.includes('流動') || q.includes('流动') || q.includes('current ratio') || q.includes('償債') || q.includes('偿债')) {
        return {
            answer: `${r.YYYY_MM} 流動比率為 ${Number(r.current_ratio || 0).toFixed(2)}`,
            detail: `流動資產 ${Number(r.current_asset_amt || 0).toLocaleString()}，流動負債 ${Number(r.current_debet_amt || 0).toLocaleString()}`,
            suggestion: Number(r.current_ratio) < 1.5 ? '⚠️ 流動比率低於 1.5，短期償債能力不足' : '✅ 流動比率良好',
            metric: 'current_ratio', value: r.current_ratio
        };
    }

    // 現金
    if (q.includes('現金') || q.includes('现金') || q.includes('cash')) {
        const cash = Number(r.cash_amt || 0) + Number(r.deposite_amt || 0);
        return {
            answer: `${r.YYYY_MM} 現金及約當現金餘額為 ${cash.toLocaleString()}`,
            detail: `現金 ${Number(r.cash_amt || 0).toLocaleString()}，銀行存款 ${Number(r.deposite_amt || 0).toLocaleString()}`,
            suggestion: '至「現金流量預測」查看未來 13 週現金水位',
            metric: 'cash', value: cash
        };
    }

    // 應收周轉
    if (q.includes('應收') || q.includes('应收') || q.includes('receivable') || q.includes('ar') || q.includes('周轉') || q.includes('周转')) {
        return {
            answer: `${r.YYYY_MM} 應收帳款周轉率為 ${Number(r.receivable_turnover || 0).toFixed(2)} 次`,
            detail: `應收帳款餘額 ${Number(r.AR_amt || 0).toLocaleString()}`,
            suggestion: Number(r.receivable_turnover) < 4 ? '⚠️ 應收周轉率偏低，建議加強催收' : '✅ 應收周轉正常',
            metric: 'ar_turn', value: r.receivable_turnover
        };
    }

    // ROE
    if (q.includes('roe') || q.includes('權益報酬') || q.includes('权益报酬') || q.includes('股東') || q.includes('股东')) {
        return {
            answer: `${r.YYYY_MM} ROE 為 ${Number(r.ROE || 0).toFixed(2)}%`,
            detail: `淨利 ${Number(r.net_profit_amt || 0).toLocaleString()}，股東權益 ${Number(r.stockholder_amt || 0).toLocaleString()}`,
            suggestion: Number(r.ROE) < 8 ? '⚠️ ROE 低於 8%，股東報酬率待提升' : '✅ ROE 表現良好',
            metric: 'roe', value: r.ROE
        };
    }

    // 預算
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

    // 合併
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

    // 部門
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

    // 預設回應
    return {
        answer: `目前可查詢：毛利率、淨利率、負債比率、流動比率、現金餘額、應收周轉率、ROE、預算達成、合併報表、部門損益等。請換個方式提問。`,
        detail: `當前公司：${bu_no}，最新一期：${r.YYYY_MM || '無'}`,
        suggestion: '可點擊下方建議問題快速查詢',
        metric: 'general', value: null
    };
}

/**
 * LLM 問答（勾選大語言模型時使用）
 * 先從 ermm_db 取出該公司該月財務資料作為上下文，再請 LLM 根據資料回答，
 * 避免模型憑空編造數字。
 */
async function askLLM(question, bu_no, YYYY_MM, provider, lang) {
    const uiLang = normalizeLang(lang);

    // 1. 取 LLM 服務商設定
    const [cfgRows] = await pool.execute(
        'SELECT * FROM llm_config WHERE provider=?', [provider]
    );
    if (cfgRows.length === 0) throw new Error('LLM 服務商設定不存在，請聯絡管理員執行遷移腳本');
    const cfg = cfgRows[0];
    if (!cfg.api_key) {
        const err = new Error(`「${cfg.provider_name}」尚未設定 API Key，請點擊 ⚙️ API Key 管理進行設定`);
        err.code = 'LLM_KEY_MISSING';
        throw err;
    }

    // 2. 取財務資料並組裝上下文
    const stdMM = normalizeYYYYMM(YYYY_MM);
    const r = await getFinanceRow(bu_no, stdMM);
    if (!r.YYYY_MM) {
        const err = new Error(`資料庫中查無 ${bu_no} 公司的財務資料，無法提供給 LLM 分析`);
        err.code = 'NO_FINANCE_DATA';
        throw err;
    }

    const num = (v) => Number(v || 0);
    const sale = num(r.sale_amt), cost = num(r.sale_cost_amt);
    const gross = sale - cost;
    const vals = {
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
        cash: num(r.cash_amt).toFixed(2), deposit: num(r.deposite_amt).toFixed(2),
        cashTotal: (num(r.cash_amt) + num(r.deposite_amt)).toFixed(2),
        totalAsset: num(r.ttl_asset_amt).toFixed(2), totalDebt: num(r.ttl_debet_amt).toFixed(2),
        debtRatio: num(r.ttl_asset_amt) > 0 ? (num(r.ttl_debet_amt) / num(r.ttl_asset_amt) * 100).toFixed(2) : '0.00',
        equity: num(r.stockholder_amt).toFixed(2),
        ROE: num(r.stockholder_amt) > 0 ? (num(r.net_profit_amt) / num(r.stockholder_amt) * 100).toFixed(2) : '0.00',
        currentAsset: num(r.current_asset_amt).toFixed(2),
        currentDebt: num(r.current_debet_amt).toFixed(2),
        currentRatio: Number(r.current_ratio || 0).toFixed(2),
        employeeCnt: num(r.employee_cnt).toFixed(0),
        salary: num(r.salary_amt).toFixed(2)
    };

    // 財務欄位鍵名依 UI 語言在地化，避免英文模式下中文欄位誤導模型輸出中文
    const FIELD_LABELS = {
        'zh-TW': { bu_no: '公司別', period: '資料期間', sale: '銷售收入', cost: '銷售成本', gross: '毛利', grossMargin: '毛利率(%)', saleExp: '銷售費用', mgmtExp: '管理費用', finExp: '財務費用', netProfit: '淨利潤', netMargin: '淨利率(%)', AR: '應收帳款', AP: '應付帳款', loan: '銀行借款', cash: '現金', deposit: '銀行存款', cashTotal: '現金及約當現金', totalAsset: '總資產', totalDebt: '總負債', debtRatio: '負債比率(%)', equity: '股東權益', ROE: 'ROE(%)', currentAsset: '流動資產', currentDebt: '流動負債', currentRatio: '流動比率', employeeCnt: '員工人數', salary: '薪資總額', _src: '財務資料（來源 ermm_db）', _q: '問題' },
        'zh-CN': { bu_no: '公司', period: '数据期间', sale: '销售收入', cost: '销售成本', gross: '毛利', grossMargin: '毛利率(%)', saleExp: '销售费用', mgmtExp: '管理费用', finExp: '财务费用', netProfit: '净利润', netMargin: '净利率(%)', AR: '应收账款', AP: '应付账款', loan: '银行借款', cash: '现金', deposit: '银行存款', cashTotal: '现金及约当现金', totalAsset: '总资产', totalDebt: '总负债', debtRatio: '负债比率(%)', equity: '股东权益', ROE: 'ROE(%)', currentAsset: '流动资产', currentDebt: '流动负债', currentRatio: '流动比率', employeeCnt: '员工人数', salary: '薪资总额', _src: '财务资料（来源 ermm_db）', _q: '问题' },
        'en': { bu_no: 'Company', period: 'Period', sale: 'Revenue', cost: 'Cost of sales', gross: 'Gross profit', grossMargin: 'Gross margin (%)', saleExp: 'Selling expense', mgmtExp: 'Admin expense', finExp: 'Finance expense', netProfit: 'Net profit', netMargin: 'Net margin (%)', AR: 'Accounts receivable', AP: 'Accounts payable', loan: 'Bank loan', cash: 'Cash on hand', deposit: 'Bank deposit', cashTotal: 'Cash and cash equivalents', totalAsset: 'Total assets', totalDebt: 'Total liabilities', debtRatio: 'Debt ratio (%)', equity: "Shareholders' equity", ROE: 'ROE (%)', currentAsset: 'Current assets', currentDebt: 'Current liabilities', currentRatio: 'Current ratio', employeeCnt: 'Headcount', salary: 'Total salary', _src: 'Financial data (source: ermm_db)', _q: 'Question' }
    };
    const labels = FIELD_LABELS[uiLang];
    const ctx = {};
    for (const [k, v] of Object.entries(vals)) ctx[labels[k]] = v;

    // 3. 呼叫 LLM（系統提示詞語言 = UI 語言）
    const messages = [
        { role: 'system', content: SYSTEM_PROMPTS[uiLang] },
        {
            role: 'user',
            content: `${labels._src}：\n${JSON.stringify(ctx, null, 2)}\n\n${labels._q}：${question}`
        }
    ];
    const content = await chatCompletion(
        { base_url: cfg.base_url, api_key: cfg.api_key, model: cfg.model },
        messages,
        { temperature: 0.2, max_tokens: 2048, timeout: 60000 }
    );

    const footers = {
        'zh-TW': { detail: `資料來源：ermm_db · ${bu_no} · ${r.YYYY_MM}`, suggestion: `由 ${cfg.provider_name}（${cfg.model}）生成，AI 回答僅供參考` },
        'zh-CN': { detail: `数据来源：ermm_db · ${bu_no} · ${r.YYYY_MM}`, suggestion: `由 ${cfg.provider_name}（${cfg.model}）生成，AI 回答仅供参考` },
        'en': { detail: `Source: ermm_db · ${bu_no} · ${r.YYYY_MM}`, suggestion: `Generated by ${cfg.provider_name} (${cfg.model}). For reference only.` }
    };
    return {
        answer: content,
        detail: footers[uiLang].detail,
        suggestion: footers[uiLang].suggestion,
        metric: 'llm',
        provider: cfg.provider_name
    };
}

module.exports = router;
