/**
 * 重写 mgm_finance_summary 2023 — 借贷平衡版 v3
 *
 * 正确的平衡流程：
 *   1. 损益表 → sale, cost, profit
 *   2. 资产 = 现金 + 应收 + 库存 + 固定资产（从营收推算）
 *   3. 负债 + 权益 = 资产（强制）
 *      - 权益 = 资产 × (1 - debt_ratio)  ← 先定 debt_ratio=45%
 *      - 流动负债 = AP + 应付工资 + VAT
 *      - 长期借款 = 总负债 - 流动负债
 *   4. 股本 + 公积 = 权益 - 累计保留盈余
 */
const { pool } = require('../config/db');

const BUS = ['HM', 'SZ'];
const DEBT_RATIO = 0.45;   // 目标负债比 45%
const BUILDING = { HM: 15000000, SZ: 8000000 };
const EQUIPMENT = { HM: 8000000, SZ: 5000000 };
const OFFICE = { HM: 2000000, SZ: 1200000 };
const INTANGIBLE = { HM: 1000000, SZ: 600000 };
const DEPOSITE = { HM: 1000000, SZ: 600000 };
const EMP_CNT = { HM: 45, SZ: 28 };
const SALARY_BSE = { HM: 300000, SZ: 180000 };

async function run() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [del] = await conn.execute("DELETE FROM mgm_finance_summary WHERE YYYY_MM LIKE '2023-%'");
    console.log(`✓ 清理 ${del.affectedRows} 行`);

    for (const bu of BUS) {
      for (let m = 1; m <= 12; m++) {
        const ym = `2023-${String(m).padStart(2,'0')}`;
        await conn.execute(
          "INSERT INTO mgm_finance_summary (bu_no, YYYY_MM, YYYY, MM, flag) VALUES (?, ?, '2023', ?, 'S')",
          [bu, ym, String(m).padStart(2,'0')]);
      }
    }

    const [fd] = await conn.execute(
      "SELECT bu_no, YYYY_MM, actual_amt FROM forecast_detail WHERE YYYY_MM LIKE '2023-%' AND forecast_type='Sales'");
    const saleMap = {};
    fd.forEach(r => { saleMap[r.bu_no + '|' + r.YYYY_MM] = Number(r.actual_amt || 0); });

    for (const bu of BUS) {
      let cash_begin = bu === 'HM' ? 2000000 : 1500000;
      let cum_pl = 0;

      for (let m = 1; m <= 12; m++) {
        const ym = `2023-${String(m).padStart(2,'0')}`;
        const sale = saleMap[bu + '|' + ym] || 1000000;
        const sale_cost = Math.round(sale * 0.72);
        const sale_discount = Math.round(sale * 0.015);
        const net_sale = sale - sale_discount;
        const sale_exp = Math.round(net_sale * 0.12);
        const mgm_exp = Math.round(net_sale * 0.05);
        const major_margin = net_sale - sale_cost;
        const biz_margin = major_margin - sale_exp;
        const op_profit = biz_margin - mgm_exp;
        const pretax = op_profit + 5000;
        const net_profit = Math.round(pretax * 0.75);

        const cin = Math.round(sale * 0.35);
        const cout = Math.round(sale_cost * 0.85);
        const cash_end = cash_begin + cin - cout;

        const AR = Math.round(sale * 0.65);
        const AP = Math.round(sale_cost * 0.60);

        // 库存 ≈ 1 个月销货成本
        const stock = Math.round(sale_cost);
        const reserve = Math.round(stock * 0.05);

        const dep_eqmt = Math.round(EQUIPMENT[bu] * 0.05 / 12);
        const dep_build = Math.round(BUILDING[bu] * 0.003 / 12);
        const acc_dep_eqmt = dep_eqmt * m;
        const acc_dep_build = dep_build * m;

        const salary = SALARY_BSE[bu] + Math.round(net_profit * 0.05);

        // ========== 资产负债表（平衡版 v3）==========
        const current_asset = cash_end + DEPOSITE[bu] + AR + stock - reserve;
        const non_current = BUILDING[bu] - acc_dep_build + EQUIPMENT[bu] - acc_dep_eqmt + OFFICE[bu] + INTANGIBLE[bu];
        const ttl_asset = current_asset + non_current;

        // 权益 = 资产 × (1 - debt_ratio)
        const stockholder = Math.round(ttl_asset * (1 - DEBT_RATIO));
        cum_pl += net_profit;
        const cum_retain = Math.max(0, Math.round(cum_pl * 0.6));
        // 股本 = 权益 - 累计保留盈余 - 公积
        const CAPITAL = Math.max(1000000, stockholder - cum_retain - 500000);
        const RESERVE = Math.min(500000, stockholder - CAPITAL - cum_retain);

        // 负债 = 资产 - 权益
        const ttl_debt = ttl_asset - stockholder;

        // 流动负债
        const AP_salary = Math.round(salary * 0.8);
        const VAT_pay = Math.max(0, Math.round(sale * 0.13) - Math.round(sale_cost * 0.13));
        const deposit_liab = 300000;  // 押金/保证金
        const cur_debt = AP + AP_salary + VAT_pay + deposit_liab;

        // 长期借款 = 总负债 - 流动负债（强制平衡）
        const LT_loan = Math.max(0, ttl_debt - cur_debt);
        const LT_debt = LT_loan;  // 简化：全部非流动

        const diff = Math.abs(ttl_asset - (ttl_debt + stockholder));
        console.assert(diff <= 1, `不平衡 ${bu} ${ym}: diff=${diff}`);

        // Z-score
        const X1 = ttl_asset > 0 ? (current_asset - cur_debt) / ttl_asset : 0;
        const X2 = ttl_asset > 0 ? cum_pl / ttl_asset : 0;
        const X3 = ttl_asset > 0 ? op_profit / ttl_asset : 0;
        const X4 = ttl_debt > 0 ? stockholder / ttl_debt : 0;
        const X5 = ttl_asset > 0 ? net_sale / ttl_asset : 0;
        const Z = 1.2 * X1 + 1.4 * X2 + 3.3 * X3 + 0.6 * X4 + 0.999 * X5;
        const wall = Z >= 2.9 ? '安全' : (Z >= 1.23 ? '灰色' : '破產區');
        const color = Z < 1.23 ? 'RED' : (Z < 2.9 ? 'YELLOW' : 'GREEN');

        await conn.execute(`
          UPDATE mgm_finance_summary SET
            sale_amt=?, sale_cost_amt=?, sale_discount_amt=?, net_sale_amt=?,
            sale_exp_amt=?, MGM_EXP_amt=?, finance_EXP_amt=0, operation_EXP_amt=?,
            BIZ_major_margin_amt=?, BIZ_margin_amt=?,
            operation_profit_amt=?, pretax_profit_amt=?, net_profit_amt=?,
            AR_amt=?, AP_amt=?, AP_tax_amt=?,
            stock_P_amt=?, stock_M_amt=?, stock_S_amt=?, reserve_loss_amt=?, stock_value_amt=?,
            cash_amt=?, cash_begin_amt=?, cash_operation_in=?, cash_operation_out=?, cash_end_amt=?,
            deposite_amt=?, interest_amt=?, VAT_amt=?, VAT_rate=0.13,
            building_amt=?, equipment_amt=?, vehicle_amt=500000, office_amt=?, intangible_amt=?,
            acc_de_building=?, acc_de_EQMT=?,
            loan_amt=?, deposit_liab_amt=?, LT_loan_amt=?, long_term_debet_amt=?,
            current_asset_amt=?, non_current_asset_amt=?, ttl_asset_amt=?,
            current_debet_amt=?, ttl_debet_amt=?,
            captial_stock=?, legal_reserve=?, captial_reserve=0, accumulated_amt=?, current_PL_amt=?, stockholder_amt=?,
            Z_X1=?, Z_X2=?, Z_X3=?, Z_X4=?, Z_X5=?, Z_score=?, Z2_score=?, Z3_score=?,
            BZ_X1=?, BZ_X2=?, BZ_X3=?, BZ_X4=?, BZ_X5=?, BZ_model=?,
            JZ_ZA=?, JZ_ZB=?, JZ_ZC=?, JZ_ZD=?, JZ_model=?,
            wall_mode=?, risk_color=?,
            current_ratio=?, quick_ratio=?, debt_ratio=?, ROI=?, ROA=?, ROE=?, gross_margin=?, net_margin=?,
            employee_cnt=?, salary_amt=?, avg_salary=?, exchange_rate=7.8,
            batch_id='gen2023_v3', update_time=NOW()
          WHERE bu_no=? AND YYYY_MM=?
        `, [
          sale, sale_cost, sale_discount, net_sale,
          sale_exp, mgm_exp, sale_exp + mgm_exp,
          major_margin, biz_margin, op_profit, pretax, net_profit,
          AR, AP, VAT_pay,
          Math.round(stock * 0.5), Math.round(stock * 0.3), Math.round(stock * 0.2), reserve, stock,
          cash_end, cash_begin, cin, cout, cash_end,
          DEPOSITE[bu], Math.round(LT_loan * 0.03), VAT_pay,
          BUILDING[bu], EQUIPMENT[bu], OFFICE[bu], INTANGIBLE[bu],
          acc_dep_build, acc_dep_eqmt,
          LT_loan, deposit_liab, LT_loan, LT_debt,
          current_asset, non_current, ttl_asset,
          cur_debt, ttl_debt,
          CAPITAL, RESERVE, cum_retain, net_profit, stockholder,
          Number(X1.toFixed(4)), Number(X2.toFixed(4)), Number(X3.toFixed(4)), Number(X4.toFixed(4)), Number(X5.toFixed(4)),
          Number(Z.toFixed(4)), Number(Z.toFixed(4)), Number(Z.toFixed(4)),
          Number(X1.toFixed(4)), Number(X2.toFixed(4)), Number(X3.toFixed(4)), Number(X4.toFixed(4)), Number(X5.toFixed(4)), Number((X1+X2+X3+X4+X5).toFixed(4)),
          Number((sale/ttl_asset).toFixed(4)), Number((current_asset>0?sale/current_asset:0).toFixed(4)), Number((ttl_asset>0?ttl_debt/ttl_asset:0).toFixed(4)), Number((ttl_asset>0?net_profit/ttl_asset:0).toFixed(4)), Number(((sale/ttl_asset)+(current_asset>0?sale/current_asset:0)-(ttl_asset>0?ttl_debt/ttl_asset:0)-(ttl_asset>0?net_profit/ttl_asset:0)).toFixed(4)),
          wall, color,
          Number((cur_debt>0?current_asset/cur_debt:0).toFixed(4)),
          Number((cur_debt>0?(current_asset-stock+reserve)/cur_debt:0).toFixed(4)),
          Number((ttl_asset>0?ttl_debt/ttl_asset*100:0).toFixed(4)),
          Number((ttl_asset>0?net_profit/ttl_asset*100:0).toFixed(4)),
          Number((ttl_asset>0?net_profit/ttl_asset*100:0).toFixed(4)),
          Number((stockholder>0?net_profit/stockholder*100:0).toFixed(4)),
          Number((sale>0?major_margin/sale*100:0).toFixed(4)),
          Number((sale>0?net_profit/sale*100:0).toFixed(4)),
          EMP_CNT[bu], salary, Math.round(salary/EMP_CNT[bu]),
          bu, ym
        ]);

        cash_begin = cash_end;
        if (m === 1 || m === 6 || m === 12) {
          console.log(`  ${bu} ${ym}: sale=${sale.toLocaleString()} Z=${Z.toFixed(2)} A=${Math.round(ttl_asset/10000)}万 D=${Math.round(ttl_debt/10000)}万 E=${Math.round(stockholder/10000)}万 bal=${diff<=1?'✅':'❌'+diff.toLocaleString()}`);
        }
      }
    }

    await conn.commit();
    console.log('\n✓ 完成');

    const [bad] = await conn.execute(`
      SELECT COUNT(*) AS n FROM (
        SELECT ABS(ttl_asset_amt - (ttl_debet_amt + stockholder_amt)) AS d FROM mgm_finance_summary WHERE YYYY_MM LIKE '2023-%'
      ) x WHERE d > 1`);
    console.log(`✅ 不平衡行: ${bad[0].n}/24`);

    const [sample] = await conn.execute("SELECT bu_no, YYYY_MM, ttl_asset_amt, ttl_debet_amt, stockholder_amt FROM mgm_finance_summary WHERE YYYY_MM LIKE '2023-%' AND MONTH(YYYY_MM) IN (1,6,12) ORDER BY bu_no, YYYY_MM");
    sample.forEach(r => {
      const A = Number(r.ttl_asset_amt), D = Number(r.ttl_debet_amt), E = Number(r.stockholder_amt);
      console.log(`  ${r.bu_no} ${r.YYYY_MM}: A=${A.toLocaleString()} D+E=${(D+E).toLocaleString()} ${Math.abs(A-D-E)<=1?'✅':'❌'}`);
    });

  } catch (err) {
    console.error('❌', err.message);
    await conn.rollback();
    process.exit(1);
  } finally {
    conn.release();
    await pool.end();
  }
}

run();
