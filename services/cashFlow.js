/**
 * 现金流量归类与汇总
 * 数据来源：mgm_casher_details（现金日记账）
 *
 * 分类规则（按 amt_type 关键词）：
 *   筹资活动：借款/贷款/还款/利息支出/股利/分红/增资/融资
 *   投资活动：利息收入/设备采购/购置/固定资产/投资/股权/理财/处置
 *   其余默认经营活动
 * 借贷方向：DR/借 = 流入，CR/贷 = 流出
 */
const OPERATING = 'OPERATE';
const INVESTING = 'INVEST';
const FINANCING = 'FINANCE';

const FINANCE_KEYWORDS = ['借款', '贷款', '还款', '还本', '利息支出', '股利', '分红', '增资', '筹资', '融资'];
const INVEST_KEYWORDS = ['利息收入', '设备采购', '购置', '固定资产', '投资', '股权', '理财', '处置'];

function classifyCashType(amtType) {
    const t = String(amtType || '').trim();
    if (!t) return OPERATING;
    if (FINANCE_KEYWORDS.some(k => t.includes(k))) return FINANCING;
    if (INVEST_KEYWORDS.some(k => t.includes(k))) return INVESTING;
    return OPERATING;
}

function cashDirection(dbcr) {
    const raw = String(dbcr || '').trim();
    const v = raw.toUpperCase();
    if (v === 'DR' || raw === '借' || raw === '借方') return 'IN';
    if (v === 'CR' || raw === '贷' || raw === '貸' || raw === '贷方' || raw === '貸方') return 'OUT';
    return null;
}

function emptyFlow() {
    return {
        operation_in: 0, operation_out: 0,
        invest_in: 0, invest_out: 0,
        finance_in: 0, finance_out: 0
    };
}

const r2 = v => Math.round((v + Number.EPSILON) * 100) / 100;

// 读取某公司指定月份区间的现金日记账，按活动类型汇总
async function loadMonthlyFlows(conn, buNo, fromYM, toYM) {
    const [rows] = await conn.execute(`
        SELECT YYYY_MM, amt_type, DB_CR, SUM(sub_amt) AS amt
          FROM mgm_casher_details
         WHERE bu_no=? AND YYYY_MM IS NOT NULL AND YYYY_MM >= ? AND YYYY_MM <= ?
         GROUP BY YYYY_MM, amt_type, DB_CR
    `, [buNo, fromYM, toYM]);

    const map = {};
    const skipped = [];
    for (const r of rows) {
        const dir = cashDirection(r.DB_CR);
        if (!dir) {
            skipped.push(`${r.YYYY_MM} ${r.amt_type} DB_CR=${r.DB_CR}`);
            continue;
        }
        const ym = String(r.YYYY_MM);
        if (!map[ym]) map[ym] = emptyFlow();
        const type = classifyCashType(r.amt_type);
        const key = type === FINANCING
            ? (dir === 'IN' ? 'finance_in' : 'finance_out')
            : type === INVESTING
                ? (dir === 'IN' ? 'invest_in' : 'invest_out')
                : (dir === 'IN' ? 'operation_in' : 'operation_out');
        map[ym][key] = r2(map[ym][key] + Number(r.amt || 0));
    }
    return { map, skipped };
}

// 按公司重算所有已有 summary 月份的现金流字段（期初 = 上月期末，首个有数据月份期初为 0）
async function syncCashFlow(conn, buNo) {
    const [sumRows] = await conn.execute(
        'SELECT uid, YYYY_MM, cash_amt FROM mgm_finance_summary WHERE bu_no=? ORDER BY YYYY_MM',
        [buNo]
    );
    if (sumRows.length === 0) return { updated: 0, skipped: [] };

    const fromYM = String(sumRows[0].YYYY_MM);
    const toYM = String(sumRows[sumRows.length - 1].YYYY_MM);
    const { map, skipped } = await loadMonthlyFlows(conn, buNo, fromYM, toYM);

    let running = 0;
    let updated = 0;
    for (const row of sumRows) {
        const ym = String(row.YYYY_MM);
        let f = map[ym] ? { ...map[ym] } : emptyFlow();
        // 无现金日记账明细时，用财务汇总的净现金流作为经营活动净额兜底，避免字段全为 0
        const hasFlows = Object.values(f).some(v => Number(v) !== 0);
        if (!hasFlows && Number(row.cash_amt || 0) !== 0) {
            const netAmt = r2(Number(row.cash_amt));
            if (netAmt > 0) f.operation_in = netAmt;
            else f.operation_out = r2(-netAmt);
        }
        const net = f.operation_in - f.operation_out
            + f.invest_in - f.invest_out
            + f.finance_in - f.finance_out;
        const begin = running;
        const end = r2(begin + net);
        await conn.execute(`
            UPDATE mgm_finance_summary SET
                cash_begin_amt=?, cash_operation_in=?, cash_operation_out=?,
                cash_invest_in=?, cash_invest_out=?, cash_finance_in=?, cash_finance_out=?,
                cash_end_amt=?
            WHERE uid=?
        `, [
            r2(begin), f.operation_in, f.operation_out,
            f.invest_in, f.invest_out, f.finance_in, f.finance_out,
            end, row.uid
        ]);
        running = end;
        updated++;
    }
    return { updated, skipped };
}

module.exports = { classifyCashType, cashDirection, loadMonthlyFlows, syncCashFlow };
