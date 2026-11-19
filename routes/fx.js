/**
 * CFO-08 汇率敞口与对冲
 *
 * 基础币别 RMB：
 * 1. 敞口 = 应收/现金/其他（正）－ 应付/借款（负），按原币记录并折合 RMB。
 * 2. 折算汇率取 consol_exchange_rate.rate_to_twd 的交叉汇率：
 *    1 原币 = rate_to_twd(原币) / rate_to_twd(RMB) RMB。
 * 3. 敞口来源支持手工录入，以及从「未付款的非 RMB 应付」和「非 RMB 使用中贷款」同步。
 * 4. 对冲合约按名义本金折合 RMB，覆盖率 = 有效对冲金额 / 敞口总额。
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const audit = require('../services/audit');

const { perms, readScope } = require('../middleware/perms');
const BUS = ['HM', 'HN', 'SZ'];
const TYPES = ['AR', 'AP', 'LOAN', 'CASH', 'OTHER'];
const HEDGE_STATUS = ['ACTIVE', 'SETTLED', 'CANCELLED'];
const EXPOSURE_LIMIT = 5000000;   // 敞口总额上限（RMB）
const MIN_COVERAGE = 80;          // 对冲覆盖率下限（%）

const n = (v) => Number(v || 0);
const r2 = (v) => { const x = Number(v); return Number.isFinite(x) ? Math.round((x + Number.EPSILON) * 100) / 100 : 0; };
const normalizeCcy = (v) => String(v || '').trim().toUpperCase();
const validMonth = (v) => /^\d{4}-\d{2}$/.test(String(v || '').trim());

async function latestMonth(bu) {
    const [rows] = await pool.execute(
        'SELECT MAX(YYYY_MM) AS m FROM mgm_finance_summary WHERE bu_no=?', [bu]);
    return rows[0]?.m || new Date().toISOString().slice(0, 7);
}

// 取目标月份及之前最近的汇率；外币缺失时回退到最新可用月份
async function loadRates(YYYY_MM) {
    const [rows] = await pool.execute(
        `SELECT YYYY_MM, currency, rate_to_twd FROM consol_exchange_rate
          WHERE rate_to_twd>0 ORDER BY YYYY_MM DESC`);
    const le = new Map();
    const all = new Map();
    for (const r of rows) {
        const c = normalizeCcy(r.currency);
        if (!all.has(c)) all.set(c, r);
        if (r.YYYY_MM <= YYYY_MM && !le.has(c)) le.set(c, r);
    }
    const pick = (c) => le.get(c) || all.get(c) || null;
    const rmbRow = pick('RMB');
    const base = rmbRow ? n(rmbRow.rate_to_twd) : 1;
    const map = { RMB: { rate: 1, month: YYYY_MM } };
    const warnings = [];
    if (!rmbRow) warnings.push('汇率表缺少 RMB 基准汇率，按 1:1 折算');
    for (const c of all.keys()) {
        if (c === 'RMB') continue;
        const row = pick(c);
        if (!row || !(n(row.rate_to_twd) > 0)) {
            map[c] = { rate: 1, month: null };
            warnings.push(`汇率表缺少 ${c} 汇率，暂按 1:1 折算`);
            continue;
        }
        map[c] = { rate: r2(n(row.rate_to_twd) / (base || 1)), month: row.YYYY_MM };
        if (row.YYYY_MM !== YYYY_MM) {
            warnings.push(`${c} 无 ${YYYY_MM} 汇率，使用 ${row.YYYY_MM} 汇率 ${map[c].rate}`);
        }
    }
    return { map, warnings };
}

function rateOf(rates, ccy) {
    const r = rates.map[ccy];
    return r && r.rate > 0 ? r.rate : 1;
}

function buildOverview(bu_no, YYYY_MM, items, hedges, rates) {
    const currencies = {};
    const ensure = (ccy) => {
        if (!currencies[ccy]) {
            currencies[ccy] = { currency: ccy, AR: 0, AP: 0, LOAN: 0, CASH: 0, OTHER: 0, net: 0, hedge: 0 };
        }
        return currencies[ccy];
    };

    let gross = 0;
    for (const it of items) {
        const row = ensure(it.currency);
        const amt = r2(it.amount_rmb);
        // 应收/现金/其他为正敞口；应付/借款为负敞口
        const sign = (it.exposure_type === 'AR' || it.exposure_type === 'CASH' || it.exposure_type === 'OTHER') ? 1 : -1;
        if (row[it.exposure_type] !== undefined) row[it.exposure_type] = r2(row[it.exposure_type] + amt);
        row.net = r2(row.net + sign * amt);
        gross = r2(gross + Math.abs(amt));
    }

    let hedged = 0;
    for (const h of hedges) {
        if (h.status !== 'ACTIVE') continue;
        const row = ensure(h.currency);
        row.hedge = r2(row.hedge + n(h.amount_rmb));
        hedged = r2(hedged + n(h.amount_rmb));
    }

    const list = Object.values(currencies).sort((a, b) => a.currency.localeCompare(b.currency));
    for (const row of list) row.net_after_hedge = r2(row.net - row.hedge);

    const net = r2(list.reduce((s, r) => s + r.net, 0));
    const coverage = gross > 0 ? r2(hedged * 100 / gross) : 0;

    const risks = [];
    if (Math.abs(net) > EXPOSURE_LIMIT) {
        risks.push({
            type: 'EXPOSURE', level: 'danger',
            message: `净敞口 ${r2(net)} RMB 超过上限 ${EXPOSURE_LIMIT} RMB`
        });
    }
    if (gross > 0 && coverage < MIN_COVERAGE) {
        risks.push({
            type: 'COVERAGE', level: 'warning',
            message: `对冲覆盖率 ${coverage}% 低于下限 ${MIN_COVERAGE}%`
        });
    }

    return {
        bu_no,
        YYYY_MM,
        base_currency: 'RMB',
        totals: {
            gross_exposure: gross,
            net_exposure: net,
            hedged_amount: hedged,
            coverage
        },
        currencies: list,
        risks,
        limits: { exposure_limit: EXPOSURE_LIMIT, min_coverage: MIN_COVERAGE },
        warnings: rates.warnings,
        rate_source: rates.map
    };
}

async function loadOverview(bu_no, YYYY_MM) {
    const [items] = await pool.execute(
        'SELECT * FROM fx_exposure_item WHERE bu_no=? AND YYYY_MM=? ORDER BY exposure_type, currency, uid',
        [bu_no, YYYY_MM]);
    const [hedges] = await pool.execute(
        'SELECT * FROM fx_hedge WHERE bu_no=? AND YYYY_MM=? ORDER BY status, currency, uid',
        [bu_no, YYYY_MM]);
    const rates = await loadRates(YYYY_MM);
    const used = [...items, ...hedges].map(x => normalizeCcy(x.currency));
    for (const c of new Set(used)) {
        if (c && !rates.map[c]) rates.warnings.push(`汇率表缺少 ${c} 汇率，暂按 1:1 折算`);
    }
    const summary = buildOverview(bu_no, YYYY_MM, items, hedges, rates);
    return { ...summary, items, hedges };
}

function parseItem(body) {
    const exposure_type = String(body.exposure_type || '').toUpperCase();
    const currency = normalizeCcy(body.currency);
    const amount_fx = n(body.amount_fx);
    if (!TYPES.includes(exposure_type)) return { error: '敞口类型无效' };
    if (!currency) return { error: '请填写币别' };
    if (!(amount_fx >= 0)) return { error: '原币金额必须大于等于 0' };
    return {
        exposure_type, currency, amount_fx,
        rate: body.rate_to_rmb !== undefined && body.rate_to_rmb !== ''
            ? n(body.rate_to_rmb) : null,
        counterparty: body.counterparty || null,
        due_date: body.due_date || null,
        remark: body.remark || null
    };
}

function parseHedge(body) {
    const currency = normalizeCcy(body.currency);
    const notional_fx = n(body.notional_fx);
    const status = String(body.status || 'ACTIVE').toUpperCase();
    if (!currency) return { error: '请填写币别' };
    if (!(notional_fx >= 0)) return { error: '名义本金必须大于等于 0' };
    if (!HEDGE_STATUS.includes(status)) return { error: '对冲状态无效' };
    return {
        hedge_type: String(body.hedge_type || 'FORWARD').toUpperCase(),
        currency, notional_fx, status,
        rate: body.rate_to_rmb !== undefined && body.rate_to_rmb !== ''
            ? n(body.rate_to_rmb) : null,
        hedge_rate: body.hedge_rate !== undefined && body.hedge_rate !== '' ? n(body.hedge_rate) : null,
        maturity_date: body.maturity_date || null,
        counterparty: body.counterparty || null,
        remark: body.remark || null
    };
}

// 总览
router.get('/overview', async (req, res) => {
    try {
        const bu = String(req.query.bu_no || 'HM').toUpperCase();
        if (!BUS.includes(bu)) return fail(res, '公司别仅支持 HM/HN/SZ');
        const month = validMonth(req.query.YYYY_MM) ? req.query.YYYY_MM : await latestMonth(bu);
        const data = await loadOverview(bu, month);
        ok(res, data);
    } catch (err) { fail500(res, err); }
});

// 敞口明细
router.get('/items', async (req, res) => {
    try {
        const bu = String(req.query.bu_no || 'HM').toUpperCase();
        const month = String(req.query.YYYY_MM || '').trim();
        if (!BUS.includes(bu) || !validMonth(month)) return fail(res, '参数错误');
        const [rows] = await pool.execute(
            'SELECT * FROM fx_exposure_item WHERE bu_no=? AND YYYY_MM=? ORDER BY exposure_type, currency, uid',
            [bu, month]);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.post('/items', async (req, res) => {
    try {
        const bu = String(req.body.bu_no || '').toUpperCase();
        const month = String(req.body.YYYY_MM || '').trim();
        if (!BUS.includes(bu) || !validMonth(month)) return fail(res, '公司别或月份无效');
        const p = parseItem(req.body);
        if (p.error) return fail(res, p.error);
        const rate = p.rate !== null ? p.rate : rateOf(await loadRates(month), p.currency);
        const [r] = await pool.execute(
            `INSERT INTO fx_exposure_item
                (bu_no, YYYY_MM, exposure_type, currency, amount_fx, rate_to_rmb, amount_rmb,
                 counterparty, due_date, source, source_ref, remark)
             VALUES (?,?,?,?,?,?,?,?,?,'MANUAL',NULL,?)`,
            [bu, month, p.exposure_type, p.currency, p.amount_fx, rate,
             r2(p.amount_fx * rate), p.counterparty, p.due_date, p.remark]);
        const result = { uid: r.insertId, bu_no: bu, YYYY_MM: month,
            exposure_type: p.exposure_type, currency: p.currency,
            amount_fx: p.amount_fx, amount_rmb: r2(p.amount_fx * rate), counterparty: p.counterparty };
        audit.log(req, { module: 'fx', action: 'CREATE', businessType: 'FX-ITEM',
            businessId: String(r.insertId), summary: `新增FX敞口 ${bu}/${month}/${p.currency} ¥${r2(p.amount_fx * rate)}`,
            after: result });
        ok(res, { uid: r.insertId, rate_to_rmb: rate, amount_rmb: r2(p.amount_fx * rate) });
    } catch (err) { fail500(res, err); }
});

router.put('/items/:uid', async (req, res) => {
    try {
        const [exist] = await pool.execute('SELECT * FROM fx_exposure_item WHERE uid=?', [req.params.uid]);
        if (!exist.length) return fail(res, '敞口明细不存在', 404);
        const p = parseItem(req.body);
        if (p.error) return fail(res, p.error);
        const rate = p.rate !== null ? p.rate : rateOf(await loadRates(exist[0].YYYY_MM), p.currency);
        await pool.execute(
            `UPDATE fx_exposure_item SET exposure_type=?, currency=?, amount_fx=?, rate_to_rmb=?,
                amount_rmb=?, counterparty=?, due_date=?, remark=? WHERE uid=?`,
            [p.exposure_type, p.currency, p.amount_fx, rate, r2(p.amount_fx * rate),
             p.counterparty, p.due_date, p.remark, req.params.uid]);
        audit.log(req, { module: 'fx', action: 'UPDATE', businessType: 'FX-ITEM',
            businessId: String(req.params.uid), summary: `修改FX敞口 ${req.params.uid} ${exist[0].currency}`,
            before: exist[0],
            after: { exposure_type: p.exposure_type, currency: p.currency, amount_fx: p.amount_fx,
                     amount_rmb: r2(p.amount_fx * rate), counterparty: p.counterparty } });
        ok(res, { msg: '已更新' });
    } catch (err) { fail500(res, err); }
});

router.delete('/items/:uid', async (req, res) => {
    try {
        const [exist] = await pool.execute('SELECT * FROM fx_exposure_item WHERE uid=?', [req.params.uid]);
        await pool.execute('DELETE FROM fx_exposure_item WHERE uid=?', [req.params.uid]);
        audit.log(req, { module: 'fx', action: 'DELETE', businessType: 'FX-ITEM',
            businessId: String(req.params.uid), summary: `删除FX敞口 ${req.params.uid} ${exist[0]?.currency || ''}`,
            before: exist[0] });
        ok(res, { msg: '已删除' });
    } catch (err) { fail500(res, err); }
});

// 对冲合约
router.get('/hedges', async (req, res) => {
    try {
        const bu = String(req.query.bu_no || 'HM').toUpperCase();
        const month = String(req.query.YYYY_MM || '').trim();
        if (!BUS.includes(bu) || !validMonth(month)) return fail(res, '参数错误');
        const [rows] = await pool.execute(
            'SELECT * FROM fx_hedge WHERE bu_no=? AND YYYY_MM=? ORDER BY status, currency, uid',
            [bu, month]);
        ok(res, rows);
    } catch (err) { fail500(res, err); }
});

router.post('/hedges', async (req, res) => {
    try {
        const bu = String(req.body.bu_no || '').toUpperCase();
        const month = String(req.body.YYYY_MM || '').trim();
        if (!BUS.includes(bu) || !validMonth(month)) return fail(res, '公司别或月份无效');
        const p = parseHedge(req.body);
        if (p.error) return fail(res, p.error);
        const rate = p.rate !== null ? p.rate : rateOf(await loadRates(month), p.currency);
        const [r] = await pool.execute(
            `INSERT INTO fx_hedge
                (bu_no, YYYY_MM, hedge_type, currency, notional_fx, rate_to_rmb, amount_rmb,
                 hedge_rate, maturity_date, counterparty, status, remark)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [bu, month, p.hedge_type, p.currency, p.notional_fx, rate, r2(p.notional_fx * rate),
             p.hedge_rate, p.maturity_date, p.counterparty, p.status, p.remark]);
        audit.log(req, { module: 'fx', action: 'CREATE', businessType: 'FX-HEDGE',
            businessId: String(r.insertId), summary: `新增FX对冲 ${bu}/${month}/${p.currency} ¥${r2(p.notional_fx * rate)}`,
            after: { uid: r.insertId, bu_no: bu, YYYY_MM: month, hedge_type: p.hedge_type,
                     currency: p.currency, notional_fx: p.notional_fx, amount_rmb: r2(p.notional_fx * rate) } });
        ok(res, { uid: r.insertId, rate_to_rmb: rate, amount_rmb: r2(p.notional_fx * rate) });
    } catch (err) { fail500(res, err); }
});

router.put('/hedges/:uid', async (req, res) => {
    try {
        const [exist] = await pool.execute('SELECT * FROM fx_hedge WHERE uid=?', [req.params.uid]);
        if (!exist.length) return fail(res, '对冲合约不存在', 404);
        const p = parseHedge(req.body);
        if (p.error) return fail(res, p.error);
        const rate = p.rate !== null ? p.rate : rateOf(await loadRates(exist[0].YYYY_MM), p.currency);
        await pool.execute(
            `UPDATE fx_hedge SET hedge_type=?, currency=?, notional_fx=?, rate_to_rmb=?,
                amount_rmb=?, hedge_rate=?, maturity_date=?, counterparty=?, status=?, remark=?
             WHERE uid=?`,
            [p.hedge_type, p.currency, p.notional_fx, rate, r2(p.notional_fx * rate),
             p.hedge_rate, p.maturity_date, p.counterparty, p.status, p.remark, req.params.uid]);
        audit.log(req, { module: 'fx', action: 'UPDATE', businessType: 'FX-HEDGE',
            businessId: String(req.params.uid), summary: `修改FX对冲 ${req.params.uid} ${exist[0].currency}`,
            before: exist[0],
            after: { hedge_type: p.hedge_type, currency: p.currency, notional_fx: p.notional_fx,
                     amount_rmb: r2(p.notional_fx * rate), status: p.status } });
        ok(res, { msg: '已更新' });
    } catch (err) { fail500(res, err); }
});

router.delete('/hedges/:uid', async (req, res) => {
    try {
        const [exist] = await pool.execute('SELECT * FROM fx_hedge WHERE uid=?', [req.params.uid]);
        await pool.execute('DELETE FROM fx_hedge WHERE uid=?', [req.params.uid]);
        audit.log(req, { module: 'fx', action: 'DELETE', businessType: 'FX-HEDGE',
            businessId: String(req.params.uid), summary: `删除FX对冲 ${req.params.uid} ${exist[0]?.currency || ''}`,
            before: exist[0] });
        ok(res, { msg: '已删除' });
    } catch (err) { fail500(res, err); }
});

// 从应付明细 / 银行贷款同步敞口（覆盖非手工来源）
router.post('/sync', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const bu = String(req.body.bu_no || '').toUpperCase();
        const month = String(req.body.YYYY_MM || '').trim();
        if (!BUS.includes(bu) || !validMonth(month)) return fail(res, '公司别或月份无效');

        const rates = await loadRates(month);
        const warnings = [...rates.warnings];

        const [pays] = await conn.execute(
            `SELECT uid, currency_ab, amount, supplier_name, should_date, invoice_num
               FROM pay_detail
              WHERE bu_no=? AND pay_date IS NULL
                AND currency_ab IS NOT NULL AND UPPER(currency_ab)<>'RMB'`,
            [bu]);
        const [loans] = await conn.execute(
            `SELECT uid, unit, loan_amt, payback_amt, bank_id, loan_id, end_date, status1
               FROM mgm_bank_loan_details
              WHERE bu_no=? AND status1 IN ('使用中','Active')
                AND unit IS NOT NULL AND UPPER(unit)<>'RMB'`,
            [bu]);
        const [noUnit] = await conn.execute(
            `SELECT COUNT(*) AS c FROM mgm_bank_loan_details
              WHERE bu_no=? AND status1 IN ('使用中','Active') AND (unit IS NULL OR unit='')`,
            [bu]);
        if (n(noUnit[0]?.c) > 0) {
            warnings.push(`${noUnit[0].c} 笔贷款未填币别，未纳入敞口，请补录币别`);
        }
        warnings.push('发票明细无币别栏，应收敞口请手工录入');

        await conn.beginTransaction();
        await conn.execute(
            "DELETE FROM fx_exposure_item WHERE bu_no=? AND YYYY_MM=? AND source<>'MANUAL'",
            [bu, month]);

        let created = 0;
        const missing = new Set();
        for (const p of pays) {
            const ccy = normalizeCcy(p.currency_ab);
            if (!rates.map[ccy]) missing.add(ccy);
            const rate = rateOf(rates, ccy);
            await conn.execute(
                `INSERT INTO fx_exposure_item
                    (bu_no, YYYY_MM, exposure_type, currency, amount_fx, rate_to_rmb, amount_rmb,
                     counterparty, due_date, source, source_ref, remark)
                 VALUES (?,?,?,?,?,?,?,?,?,'PAYABLE',?,?)`,
                [bu, month, 'AP', ccy, n(p.amount), rate, r2(n(p.amount) * rate),
                 p.supplier_name || null, p.should_date || null,
                 `PAY:${p.uid}`, p.invoice_num ? `发票 ${p.invoice_num}` : null]);
            created++;
        }
        for (const l of loans) {
            const ccy = normalizeCcy(l.unit);
            if (!rates.map[ccy]) missing.add(ccy);
            const rate = rateOf(rates, ccy);
            const outstanding = r2(n(l.loan_amt) - n(l.payback_amt));
            await conn.execute(
                `INSERT INTO fx_exposure_item
                    (bu_no, YYYY_MM, exposure_type, currency, amount_fx, rate_to_rmb, amount_rmb,
                     counterparty, due_date, source, source_ref, remark)
                 VALUES (?,?,?,?,?,?,?,?,?,'LOAN',?,?)`,
                [bu, month, 'LOAN', ccy, outstanding, rate, r2(outstanding * rate),
                 l.bank_id || null, l.end_date || null,
                 `LOAN:${l.uid}`, l.loan_id || null]);
            created++;
        }
        await conn.commit();
        if (missing.size) warnings.push(`汇率表缺少 ${[...missing].join('/')} 汇率，暂按 1:1 折算`);
        ok(res, { created, payable: pays.length, loan: loans.length, warnings });
    } catch (err) {
        try { await conn.rollback(); } catch { /* ignore */ }
        fail500(res, err);
    } finally {
        conn.release();
    }
});

// 按当前敞口生成预警（24 小时去重）
router.post('/scan', async (req, res) => {
    try {
        const bu = String(req.body.bu_no || 'HM').toUpperCase();
        if (!BUS.includes(bu)) return fail(res, '公司别仅支持 HM/HN/SZ');
        const month = validMonth(req.body.YYYY_MM) ? req.body.YYYY_MM : await latestMonth(bu);
        const data = await loadOverview(bu, month);
        if (!data.risks.length) return ok(res, { created: 0, risks: [], message: '当前无风险项' });

        const dedupKey = `FX|${bu}|${month}`;
        const [dup] = await pool.execute(
            `SELECT uid FROM alert_log WHERE dedup_key=?
              AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) LIMIT 1`, [dedupKey]);
        if (dup.length) return ok(res, { created: 0, risks: data.risks, message: '24 小时内已生成过同类预警' });

        const level = data.risks.some(r => r.level === 'danger') ? 'danger' : 'warning';
        const title = `⚠️ ${bu} ${month} 汇率敞口预警`;
        const message = data.risks.map(r => `• ${r.message}`).join('\n');
        const suggestion = '请检视敞口币别与到期结构，评估新增远期/互换等对冲工具，或调整收付款币别。';
        await pool.execute(
            `INSERT INTO alert_log
                (rule_id, bu_no, kpi_id, kpi_name, current_value, threshold, level,
                 title, message, suggestion, channel, alert_domain, dedup_key, notify_status)
             VALUES (NULL,?, 'FX_EXPOSURE', '汇率敞口', ?, ?, ?, ?, ?, ?, 'inapp', 'FINANCE', ?, 'SKIPPED')`,
            [bu, data.totals.net_exposure, EXPOSURE_LIMIT, level, title, message, suggestion, dedupKey]);

        ok(res, { created: 1, risks: data.risks });
    } catch (err) { fail500(res, err); }
});

module.exports = router;
