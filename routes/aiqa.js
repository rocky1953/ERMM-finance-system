/**
 * AI 問答路由
 * 自然語言財務查詢（規則引擎實現，可串接 LLM）
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');

// 問答接口
router.post('/ask', async (req, res) => {
    try {
        const { question, bu_no, YYYY_MM } = req.body;
        if (!question) return fail(res, '請輸入問題');
        const bu = bu_no || 'HM';
        const mm = YYYY_MM || null;

        const result = await analyzeQuestion(question.toLowerCase(), bu, mm);
        ok(res, result);
    } catch (err) { fail500(res, err); }
});

// 快速問題清單
router.get('/suggestions', (req, res) => {
    ok(res, [
        '本月毛利率是多少？',
        '哪個產品毛利最低？',
        '現金流量預測如何？',
        '負債比率是否偏高？',
        '各部門利潤貢獻排名',
        '預算達成率如何？',
        '集團合併營收多少？',
        '應收帳款周轉率'
    ]);
});

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

// 問題分析引擎
async function analyzeQuestion(q, bu_no, YYYY_MM) {
    // 格式標準化
    const stdMM = normalizeYYYYMM(YYYY_MM);

    // 取得指定月份資料，若無指定則取最新一期
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
    if (q.includes('淨利') || q.includes('net profit') || q.includes('淨利率')) {
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
    if (q.includes('負債') || q.includes('debt') || q.includes('槓桿')) {
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
    if (q.includes('流動') || q.includes('current ratio') || q.includes('償債')) {
        return {
            answer: `${r.YYYY_MM} 流動比率為 ${Number(r.current_ratio || 0).toFixed(2)}`,
            detail: `流動資產 ${Number(r.current_asset_amt || 0).toLocaleString()}，流動負債 ${Number(r.current_debet_amt || 0).toLocaleString()}`,
            suggestion: Number(r.current_ratio) < 1.5 ? '⚠️ 流動比率低於 1.5，短期償債能力不足' : '✅ 流動比率良好',
            metric: 'current_ratio', value: r.current_ratio
        };
    }

    // 現金
    if (q.includes('現金') || q.includes('cash')) {
        const cash = Number(r.cash_amt || 0) + Number(r.deposite_amt || 0);
        return {
            answer: `${r.YYYY_MM} 現金及約當現金餘額為 ${cash.toLocaleString()}`,
            detail: `現金 ${Number(r.cash_amt || 0).toLocaleString()}，銀行存款 ${Number(r.deposite_amt || 0).toLocaleString()}`,
            suggestion: '至「現金流量預測」查看未來 13 週現金水位',
            metric: 'cash', value: cash
        };
    }

    // 應收周轉
    if (q.includes('應收') || q.includes('ar') || q.includes('周轉')) {
        return {
            answer: `${r.YYYY_MM} 應收帳款周轉率為 ${Number(r.receivable_turnover || 0).toFixed(2)} 次`,
            detail: `應收帳款餘額 ${Number(r.AR_amt || 0).toLocaleString()}`,
            suggestion: Number(r.receivable_turnover) < 4 ? '⚠️ 應收周轉率偏低，建議加強催收' : '✅ 應收周轉正常',
            metric: 'ar_turn', value: r.receivable_turnover
        };
    }

    // ROE
    if (q.includes('roe') || q.includes('權益報酬') || q.includes('股東')) {
        return {
            answer: `${r.YYYY_MM} ROE 為 ${Number(r.ROE || 0).toFixed(2)}%`,
            detail: `淨利 ${Number(r.net_profit_amt || 0).toLocaleString()}，股東權益 ${Number(r.stockholder_amt || 0).toLocaleString()}`,
            suggestion: Number(r.ROE) < 8 ? '⚠️ ROE 低於 8%，股東報酬率待提升' : '✅ ROE 表現良好',
            metric: 'roe', value: r.ROE
        };
    }

    // 預算
    if (q.includes('預算') || q.includes('budget') || q.includes('達成')) {
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
    if (q.includes('合併') || q.includes('集團') || q.includes('consolidat')) {
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
    if (q.includes('部門') || q.includes('department') || q.includes('利潤中心')) {
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

module.exports = router;
