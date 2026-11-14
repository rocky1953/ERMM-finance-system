/**
 * 销售履约与信用服务（COO-03）
 *
 * 已用额度口径 = 未收款 AR 余额 + 已出货未开票金额 - 已核准/已冲销退货金额
 *   - 未收款 AR 余额：mgm_invoice_details (TX_type='AR') 的 sub_amt - payment，仅取正值
 *   - 已出货未开票：ermm_erp_so.dn_qty * unit_price，且该 SO 无 order_id 关联的 AR 发票
 *   - 已核准退货：sales_return (status IN APPROVED/CLOSED)
 * 额度为 0 视为「未设定额度」，不做超限拦截。
 */

const { pool } = require('../config/db');

/** 客户全集：销售订单客户 ∪ AR 发票客户 */
async function getClientUniverse(bu_no) {
    const params = [];
    let soFilter = 'client_id IS NOT NULL';
    let arFilter = "TX_type='AR' AND client_id IS NOT NULL";
    if (bu_no) {
        soFilter += ' AND bu_no=?';
        arFilter += ' AND bu_no=?';
        params.push(bu_no, bu_no);
    }
    const [rows] = await pool.execute(`
        SELECT client_id, MAX(client_name) AS client_name FROM (
            SELECT client_id, COALESCE(client_name, client_id) AS client_name
            FROM ermm_erp_so WHERE ${soFilter}
            UNION ALL
            SELECT client_id, client_id AS client_name
            FROM mgm_invoice_details WHERE ${arFilter}
        ) t
        GROUP BY client_id
        ORDER BY client_id`, params);
    return rows;
}

/** 额度使用与逾期情况（按 client_id 汇总） */
async function getUsageMap(bu_no) {
    const map = {};
    const ensure = (id) => (map[id] = map[id] || {
        unpaid: 0, shipped_no_invoice: 0, returns: 0,
        overdue_amt: 0, overdue_cnt: 0
    });

    const buUnpaid = bu_no ? 'AND bu_no=?' : '';
    const [unpaid] = await pool.execute(`
        SELECT client_id,
               COALESCE(SUM(GREATEST(COALESCE(sub_amt,0) - COALESCE(payment,0), 0)),0) unpaid
        FROM mgm_invoice_details
        WHERE TX_type='AR' AND client_id IS NOT NULL ${buUnpaid}
        GROUP BY client_id`, bu_no ? [bu_no] : []);
    unpaid.forEach(r => { ensure(r.client_id).unpaid = Number(r.unpaid); });

    const [shipped] = await pool.execute(`
        SELECT s.client_id,
               COALESCE(SUM(s.dn_qty * COALESCE(s.unit_price,0)),0) amt
        FROM ermm_erp_so s
        WHERE s.client_id IS NOT NULL AND s.dn_qty > 0
          ${bu_no ? 'AND s.bu_no=?' : ''}
          AND NOT EXISTS (
              SELECT 1 FROM mgm_invoice_details i
              WHERE i.TX_type='AR' AND i.order_id = s.so_nbr
          )
        GROUP BY s.client_id`, bu_no ? [bu_no] : []);
    shipped.forEach(r => { ensure(r.client_id).shipped_no_invoice = Number(r.amt); });

    const [returns] = await pool.execute(`
        SELECT client_id, COALESCE(SUM(return_amount),0) amt
        FROM sales_return
        WHERE status IN ('APPROVED','CLOSED') AND client_id IS NOT NULL
          ${buUnpaid}
        GROUP BY client_id`, bu_no ? [bu_no] : []);
    returns.forEach(r => { ensure(r.client_id).returns = Number(r.amt); });

    // 逾期：超过客户账期天数（未设额度客户默认 30 天）
    const [overdue] = await pool.execute(`
        SELECT i.client_id, COUNT(*) cnt,
               COALESCE(SUM(i.sub_amt - COALESCE(i.payment,0)),0) amt
        FROM mgm_invoice_details i
        LEFT JOIN sales_credit_limit c
               ON c.bu_no = i.bu_no AND c.client_id = i.client_id
        WHERE i.TX_type='AR' AND i.client_id IS NOT NULL
          AND i.sub_amt > COALESCE(i.payment,0)
          AND DATEDIFF(CURDATE(), COALESCE(i.pay_date, i.wk_date)) > COALESCE(c.credit_days, 30)
          ${bu_no ? 'AND i.bu_no=?' : ''}
        GROUP BY i.client_id`, bu_no ? [bu_no] : []);
    overdue.forEach(r => {
        const e = ensure(r.client_id);
        e.overdue_amt = Number(r.amt);
        e.overdue_cnt = Number(r.cnt);
    });

    Object.values(map).forEach(e => {
        const used = e.unpaid + e.shipped_no_invoice - e.returns;
        e.used = used > 0 ? Math.round(used * 100) / 100 : 0;
    });
    return map;
}

/** 信用额度明细行（客户全集 × 额度 × 使用） */
async function getCreditRows(bu_no) {
    const [limits] = await pool.execute(
        `SELECT * FROM sales_credit_limit ${bu_no ? 'WHERE bu_no=?' : ''}`,
        bu_no ? [bu_no] : []);
    const limitMap = {};
    limits.forEach(l => { limitMap[l.client_id] = l; });

    const universe = await getClientUniverse(bu_no);
    const usage = await getUsageMap(bu_no);
    const ids = new Set(universe.map(u => u.client_id));
    Object.keys(limitMap).forEach(id => ids.add(id));

    const rows = Array.from(ids).map(id => {
        const l = limitMap[id] || {};
        const u = usage[id] || { used: 0, unpaid: 0, shipped_no_invoice: 0, returns: 0, overdue_amt: 0, overdue_cnt: 0 };
        const limit = Number(l.credit_limit || 0);
        const used = Number(u.used || 0);
        const available = limit > 0 ? Math.round((limit - used) * 100) / 100 : null;
        return {
            client_id: id,
            client_name: l.client_name || (universe.find(x => x.client_id === id) || {}).client_name || id,
            credit_limit: limit,
            credit_days: Number(l.credit_days || 30),
            status: l.status || 'USE',
            has_limit: limit > 0,
            used,
            available,
            usage_rate: limit > 0 ? Math.round(used / limit * 1000) / 10 : null,
            over_limit: limit > 0 && used > limit,
            over_amount: limit > 0 && used > limit ? Math.round((used - limit) * 100) / 100 : 0,
            unpaid: Number(u.unpaid || 0),
            shipped_no_invoice: Number(u.shipped_no_invoice || 0),
            returns: Number(u.returns || 0),
            overdue_amt: Number(u.overdue_amt || 0),
            overdue_cnt: Number(u.overdue_cnt || 0),
            remark: l.remark || ''
        };
    }).sort((a, b) => b.used - a.used);
    return rows;
}

/** 下单信用预检：仅当客户已设额度且状态为启用时拦截 */
async function checkCredit(bu_no, client_id, addAmount) {
    const [rows] = await pool.execute(
        'SELECT * FROM sales_credit_limit WHERE bu_no=? AND client_id=?', [bu_no, client_id]);
    const cfg = rows[0];
    const limit = Number(cfg?.credit_limit || 0);
    const usage = await getUsageMap(bu_no);
    const used = Number((usage[client_id] || {}).used || 0);
    const add = Number(addAmount || 0);
    if (!cfg || limit <= 0) {
        return { has_limit: false, blocked: false, limit: 0, used, available: null, add_amount: add };
    }
    const available = Math.round((limit - used) * 100) / 100;
    const blocked = cfg.status === 'HOLD' || used + add > limit;
    return {
        has_limit: true,
        status: cfg.status,
        limit,
        used,
        available,
        add_amount: add,
        over_amount: used + add > limit ? Math.round((used + add - limit) * 100) / 100 : 0,
        blocked,
        reason: cfg.status === 'HOLD' ? '客户信用已冻结'
            : (used + add > limit ? '超出信用额度' : '')
    };
}

module.exports = { getClientUniverse, getUsageMap, getCreditRows, checkCredit };
