/**
 * 生成 2023 年度（1~12月）测试资料并写入 ermm_db
 *
 * 10 类资料 → 目标表：
 *   1. 采购明细        → ermm_erp_po           (po_amount)
 *   2. 销售明细        → mgm_invoice_details   (TX_type='AR', sub_amt)
 *   3. 现金流量日记账   → mgm_casher_details    (DR=收入 / CR=支出)
 *   4. 应收应付明细     → ermm_arap_detail      (月度汇总)
 *   5. 订单明细        → ermm_erp_so           (so_qty × unit_price)
 *   6. 预测订单明细     → forecast_detail       (forecast_type='Sales')
 *   7. 库存明细及跌价   → e2_xitems_daily_status(stock_value / current_lose)
 *   8. 呆帐明细        → mgm_account_details   (sub_group='呆帐损失')
 *   9. 出货明细        → ermm_erp_so_dn        (DN_qty)
 *
 * 成长规则：1月为基点，之后每月以上月为基点依序成长：
 *   20%、10%、35%、-15%、28%、15%、23%、-10%、15%、42%、5%
 *
 * 公司别：HM(60%) + SZ(40%)；先删除既有 2023 资料（幂等重跑），单事务写入。
 */
const { pool } = require('../config/db');

// ===== 可复现随机（LCG） =====
let seed = 20231001;
function rnd() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
function randInt(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
const r2 = x => Math.round(x * 100) / 100;
const r4 = x => Math.round(x * 10000) / 10000;
const pad2 = n => String(n).padStart(2, '0');
const NOW = new Date();

// ===== 月度成长系数 =====
const RATES = [0.20, 0.10, 0.35, -0.15, 0.28, 0.15, 0.23, -0.10, 0.15, 0.42, 0.05];
const FACTORS = [1];
RATES.reduce((acc, r) => { const v = acc * (1 + r); FACTORS.push(v); return v; }, 1);

// ===== 基础配置 =====
const BUS = [{ bu: 'HM', share: 0.6 }, { bu: 'SZ', share: 0.4 }];
const BASE = { po: 3000000, so: 5000000, ar: 4800000, cashIn: 4500000, cashOut: 4200000, arAmt: 5500000, apAmt: 3200000, inv: 9000000, bad: 120000 };
const SUPPLIERS = [
    { name: '中国钢铁', item: '钢板', price: 500 },
    { name: '台塑化学', item: '塑胶粒', price: 80 },
    { name: '香港电线', item: '电线', price: 120 },
    { name: '中石油化工', item: '化工原料', price: 350 },
    { name: '富士康精密', item: '电子元件', price: 45 },
    { name: '宝钢集团', item: '型钢', price: 420 },
];
const CLIENTS = [
    { name: '和记黄埔', item: '钢制成品', price: 1200 },
    { name: '长江实业', item: '塑胶制品', price: 200 },
    { name: '新世界发展', item: '电线组装', price: 280 },
    { name: '恒基兆业', item: '五金制品', price: 150 },
    { name: '新鸿基地产', item: '机电设备', price: 950 },
    { name: '华润集团', item: '包装成品', price: 35 },
];
const INV_ITEMS = [
    { item: '原料X', price: 100 }, { item: '原料Y', price: 250 },
    { item: '包装材料', price: 20 }, { item: '设备零件', price: 500 },
    { item: '半成品A', price: 300 }, { item: '成品B', price: 800 },
    { item: '零件C', price: 60 }, { item: '五金件D', price: 45 },
];
const CASH_IN = [{ t: '销货收入', w: 0.55 }, { t: '应收款收回', w: 0.35 }, { t: '利息收入', w: 0.05 }, { t: '其他收入', w: 0.05 }];
const CASH_OUT = [{ t: '原料采购', w: 0.50 }, { t: '工资', w: 0.20 }, { t: '房租水电', w: 0.10 }, { t: '税费缴纳', w: 0.10 }, { t: '利息支出', w: 0.05 }, { t: '设备维修', w: 0.05 }];
const AGEING = [ // [类别, 天数范围, 减值率%]
    { cat: 'A 正常', lo: 5, hi: 30, red: 0 },
    { cat: 'B 31-90天', lo: 31, hi: 90, red: 5 },
    { cat: 'C 91-180天', lo: 91, hi: 180, red: 15 },
    { cat: 'D 超过180天', lo: 200, hi: 400, red: 30 },
];

function daysInMonth(m) { return new Date(2023, m, 0).getDate(); }
function randDate(m) { return `2023-${pad2(m)}-${pad2(randInt(1, daysInMonth(m)))}`; }
function monthEnd(m) { return `2023-${pad2(m)}-${pad2(daysInMonth(m))}`; }

// 将 target 精确拆成 n 笔（合计=target，末笔吸收分位误差）
function splitExact(target, n) {
    for (let t = 0; t < 60; t++) {
        const w = Array.from({ length: n }, () => 0.5 + rnd());
        const s = w.reduce((a, b) => a + b, 0);
        const parts = w.map(x => r2(target * x / s));
        const fix = r2(target - parts.reduce((a, b) => a + b, 0));
        if (fix > 0 && fix < target * 0.4) { parts[n - 1] = r2(parts[n - 1] + fix); return parts; }
    }
    const each = r2(target / n);
    const parts = Array(n).fill(each);
    parts[n - 1] = r2(target - each * (n - 1));
    return parts;
}

// 依权重类型拆分（现金收支科目）
function splitByType(target, types, nPer) {
    const out = [];
    const totalW = types.reduce((s, x) => s + x.w, 0);
    for (const tp of types) {
        const amt = target * tp.w / totalW;
        const parts = splitExact(amt, nPer);
        parts.forEach(p => out.push({ type: tp.t, amt: p }));
    }
    return out;
}

// ===== 生成资料 =====
function generate() {
    const po = [], so = [], dn = [], inv = [], cash = [], arap = [], fc = [], stock = [], bad = [];
    const actualSales = {}; // key: `${bu}|${m}` → AR 金额（供预测 actual_amt 用）

    for (let m = 1; m <= 12; m++) {
        const f = FACTORS[m - 1];
        const ym = `2023-${pad2(m)}`;
        let poSeq = 0, soSeq = 0, invSeq = 0;

        for (const { bu, share } of BUS) {
            // ---- 1. 采购明细 ermm_erp_po（5笔/BU/月）----
            const poTarget = BASE.po * f * share;
            const poAmts = splitExact(poTarget, 5);
            for (const amt of poAmts) {
                const sup = pick(SUPPLIERS);
                po.push([bu, `PO23${pad2(m)}${String(++poSeq).padStart(4, '0')}`, sup.name, sup.item,
                    randDate(m), r4(amt / sup.price), sup.price, sup.price, 1,
                    amt, amt, r2(amt * 0.13), '2023', pad2(m), ym,
                    rnd() < 0.7 ? '审核通过' : '已完成', rnd() < 0.85 ? 'Y' : 'N', 0, 'GEN2023', NOW]);
            }

            // ---- 5. 订单明细 ermm_erp_so（5笔/BU/月）----
            const soTarget = BASE.so * f * share;
            const soNbrs = [];
            // 每月每 BU：4 张全量交付（合计 80% 订单额）+ 1 张部分交付 0.75（占 20%）
            // → 月度出货价值恒 = 订单价值 × 0.95，严格跟随成长率
            const soAmts2 = splitExact(soTarget * 0.8, 4);
            const soPlan = [...soAmts2.map(a => ({ amt: a, ratio: 1 })), { amt: r2(soTarget * 0.2), ratio: 0.75 }];
            // 打乱全量/部分交付的产品归属（金额档位不变）
            if (rnd() < 0.5) soPlan.reverse();
            for (const { amt, ratio } of soPlan) {
                const cli = pick(CLIENTS);
                const qty = r4(amt / cli.price);
                const soNbr = `SO${bu}2023${pad2(m)}${String(++soSeq).padStart(4, '0')}`;
                const soDate = randDate(m);
                soNbrs.push({ nbr: soNbr, cli: cli.name, item: cli.item, qty, dnQty: r4(qty * ratio), soDate });
                so.push([bu, soNbr, cli.name, cli.name, cli.item, soDate,
                    qty, r4(qty * ratio), cli.price, '2023', pad2(m), ym,
                    ratio === 1 ? '已交付' : '部分交付', null, NOW]);
            }

            // ---- 9. 出货明细 ermm_erp_so_dn（每张 SO 一笔 DN）----
            for (const s of soNbrs) {
                const d = new Date(s.soDate); d.setDate(d.getDate() + randInt(3, 15));
                const dnDate = d.getMonth() === m - 1 ? d.toISOString().slice(0, 10) : monthEnd(m);
                dn.push([bu, s.nbr, s.item, s.cli, dnDate, s.dnQty, s.qty, NOW]);
            }

            // ---- 2. 销售明细 mgm_invoice_details（AR 发票 5笔/BU/月）----
            const arTarget = BASE.ar * f * share;
            const arAmts = splitExact(arTarget, 5);
            let arSum = 0, arIdx = 0;
            for (const amt of arAmts) {
                arSum = r2(arSum + amt);
                const cli = pick(CLIENTS);
                const wkDate = randDate(m);
                const payment = r2(amt * (0.3 + rnd() * 0.7));
                const paid = payment >= amt;
                let payDate = null;
                if (paid) { const d = new Date(wkDate); d.setDate(d.getDate() + randInt(15, 60)); payDate = d.toISOString().slice(0, 10); }
                const age = Math.floor((NOW - new Date(wkDate)) / 86400000);
                inv.push([bu, 'AR', soNbrs[arIdx++ % soNbrs.length].nbr, cli.name,
                    `AR${bu}2023${pad2(m)}${String(++invSeq).padStart(3, '0')}`,
                    amt, 'VAT', 13, r2(amt * 0.13), wkDate, payDate, payment, age, 'CR', ym, null, NOW, NOW]);
            }
            actualSales[`${bu}|${m}`] = arSum;

            // ---- 3. 现金流量日记账（收入3笔+支出3笔/BU/月）----
            const cin = splitByType(BASE.cashIn * f * share, CASH_IN, 1);
            const cout = splitByType(BASE.cashOut * f * share, CASH_OUT, 1);
            let cvSeq = 0;
            for (const c of [...cin.map(x => ({ ...x, dc: 'DR' })), ...cout.map(x => ({ ...x, dc: 'CR' }))]) {
                cash.push([bu, c.type, null, `CV${bu}2023${pad2(m)}${String(++cvSeq).padStart(2, '0')}`,
                    c.amt, c.dc, '2023', pad2(m), ym, randDate(m), null, null, NOW, NOW]);
            }

            // ---- 4. 应收应付明细 ermm_arap_detail（1笔/BU/月）----
            arap.push([bu, '2023', ym,
                r2(BASE.arAmt * f * share), r2(BASE.apAmt * f * share),
                r2(BASE.arAmt * f * share * (0.25 + rnd() * 0.15)),
                r2(BASE.apAmt * f * share * (0.20 + rnd() * 0.15)),
                'GEN2023', NOW]);

            // ---- 6. 预测订单明细 forecast_detail（1笔/BU/月，Sales）----
            // 偏差系数逐 BU 恒定（HM +4% / SZ -3%）→ 预测成长率与实际业绩成长率完全一致
            const actual = actualSales[`${bu}|${m}`];
            const forecast = r2(actual * (bu === 'HM' ? 1.04 : 0.97));
            fc.push([bu, ym, 'Sales', forecast, actual, r2(forecast - actual),
                '2023年销售预测（订单）', NOW, NOW]);

            // ---- 7. 库存明细及跌价 e2_xitems_daily_status（6笔/BU/月）----
            const invTarget = BASE.inv * f * share;
            // 固定价值权重 + 固定减值档位 → 月度跌价总额恒 = 库存价值 × 6.85%，严格跟随成长率
            // 权重: [0.25,0.20,0.18,0.15,0.12,0.10] × 减值: [0,5,0,15,5,30] → 加权 6.85%
            const INV_W = [0.25, 0.20, 0.18, 0.15, 0.12, 0.10];
            const INV_RED = [0, 5, 0, 15, 5, 30];
            for (let k = 0; k < 6; k++) {
                const it = pick(INV_ITEMS);           // 物料随机（影响数量不影响价值结构）
                const red = INV_RED[k];
                const sv = r2(invTarget * INV_W[k]);  // 价值份额固定
                const ag = AGEING.find(a => a.red === red);
                stock.push([bu, it.item, null, r4(sv / it.price), it.price, 1,
                    sv, randInt(ag.lo, ag.hi), ag.cat, red,
                    r2(sv * (1 - red / 100)), r2(sv * red / 100), monthEnd(m), NOW]);
            }

            // ---- 8. 呆帐明细 mgm_account_details（1笔/BU/月，严格按成长率）----
            bad.push([bu, ym, '费用', '营业费用', '呆帐损失',
                `呆帐-${pick(CLIENTS).name}`, r2(BASE.bad * f * share),
                'DR', null, NOW, NOW]);
        }
    }
    return { po, so, dn, inv, cash, arap, fc, stock, bad };
}

// ===== 批次 INSERT =====
function buildInsert(table, cols, rows) {
    const ph = `(${cols.map(() => '?').join(',')})`;
    const values = [];
    const params = [];
    for (const r of rows) { values.push(ph); params.push(...r); }
    return { sql: `INSERT INTO ${table} (${cols.join(',')}) VALUES ${values.join(',')}`, params };
}
async function insertChunks(conn, table, cols, rows) {
    for (let i = 0; i < rows.length; i += 40) {
        const { sql, params } = buildInsert(table, cols, rows.slice(i, i + 40));
        await conn.execute(sql, params);
    }
}

// ===== 主流程 =====
async function main() {
    const d = generate();
    console.log(`生成笔数: PO=${d.po.length} SO=${d.so.length} DN=${d.dn.length} AR发票=${d.inv.length} 现金=${d.cash.length} AR/AP=${d.arap.length} 预测=${d.fc.length} 库存=${d.stock.length} 呆帐=${d.bad.length} 合计=${d.po.length + d.so.length + d.dn.length + d.inv.length + d.cash.length + d.arap.length + d.fc.length + d.stock.length + d.bad.length}`);

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // 清除既有 2023 资料（幂等）
        await conn.execute(`DELETE FROM ermm_erp_po WHERE YYYY_MM LIKE '2023%'`);
        await conn.execute(`DELETE FROM ermm_erp_so WHERE YYYY_MM LIKE '2023%'`);
        await conn.execute(`DELETE FROM ermm_erp_so_dn WHERE DN_date BETWEEN '2023-01-01' AND '2023-12-31'`);
        await conn.execute(`DELETE FROM mgm_casher_details WHERE YYYY_MM LIKE '2023%'`);
        await conn.execute(`DELETE FROM ermm_arap_detail WHERE YYYY_MM LIKE '2023%'`);
        await conn.execute(`DELETE FROM forecast_detail WHERE YYYY_MM LIKE '2023%'`);
        await conn.execute(`DELETE FROM mgm_invoice_details WHERE YYYY_MM LIKE '2023%' AND TX_type='AR'`);
        await conn.execute(`DELETE FROM e2_xitems_daily_status WHERE stock_date BETWEEN '2023-01-01' AND '2023-12-31'`);
        await conn.execute(`DELETE FROM mgm_account_details WHERE YYYY_MM LIKE '2023%' AND sub_group='呆帐损失'`);

        await insertChunks(conn, 'ermm_erp_po',
            ['bu_no','po_id','supplier_name','xitems','po_date','po_qty','unit_price','unit_price_local','exchange_rate','po_amount','po_amount_local','vat_amt','YYYY','MM','YYYY_MM','po_status','deliver_ontime','inventory_qty','batch_id','create_time'], d.po);
        await insertChunks(conn, 'ermm_erp_so',
            ['bu_no','so_nbr','client_id','client_name','xitems','so_date','so_qty','dn_qty','unit_price','YYYY','MM','YYYY_MM','status','remark','create_time'], d.so);
        await insertChunks(conn, 'ermm_erp_so_dn',
            ['bu_no','so_nbr','xitems','client_name','DN_date','DN_qty','so_qty','create_time'], d.dn);
        await insertChunks(conn, 'mgm_invoice_details',
            ['bu_no','TX_type','order_id','client_id','invoice_no','sub_amt','tax_type','tax_rate','VAT_amt','wk_date','pay_date','payment','ageing_days','DB_CR','YYYY_MM','remark','create_time','update_time'], d.inv);
        await insertChunks(conn, 'mgm_casher_details',
            ['bu_no','amt_type','client_id','num_vman','sub_amt','DB_CR','YYYY','MM','YYYY_MM','wk_date','bank_acct','remark','create_time','update_time'], d.cash);
        await insertChunks(conn, 'ermm_arap_detail',
            ['bu_no','YYYY','YYYY_MM','AR_amt','AP_amt','AR_ageing','AP_ageing','batch_id','update_time'], d.arap);
        await insertChunks(conn, 'forecast_detail',
            ['bu_no','YYYY_MM','forecast_type','forecast_amt','actual_amt','diff_amt','remark','create_time','update_time'], d.fc);
        await insertChunks(conn, 'e2_xitems_daily_status',
            ['bu_no','xitems','item_name','qty_balance','unit_price','exchange_rate','stock_value','ageing_days','ageing_category','reduce_percentage','current_value','current_lose','stock_date','create_time'], d.stock);
        await insertChunks(conn, 'mgm_account_details',
            ['bu_no','YYYY_MM','acct_type','group_id','sub_group','acct_name','sub_amt','DB_CR','remark','create_time','update_time'], d.bad);

        await conn.commit();
        console.log('✅ 2023 年度测试资料已全部写入（单事务提交）');
    } catch (e) {
        await conn.rollback();
        console.error('❌ 写入失败已回滚:', e.message);
        process.exitCode = 1;
    } finally {
        conn.release();
        await pool.end();
    }
}
main().catch(e => { console.error(e); process.exit(1); });
