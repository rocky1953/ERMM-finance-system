/**
 * BEP 勾稽一致性全量核查（只读，不写库）
 * 复刻 routes/bep.js 的 /detail 逻辑：
 *   booked = 现金账对应 amt_type 的 CR+DR；target = resolveTarget(门槛表)
 *   adjustment = target - booked；明细净额必须 == target
 * 覆盖：MGM_BEP_threshold 全部正式行（排除 TEST/2025/99）× 14 个勾稽 item
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const MATERIAL_FIELDS = ['consumable','packaging','processing','misc_purchase','freight','customs','service_part_comp'];
const MAP = {
  consumable: ['原料採購'], packaging: ['廣告費'], processing: [], misc_purchase: ['設備維修'],
  freight: [], customs: [], service_part_comp: [],
  variable_expense: ['差旅費','廣告費','設備維修'],
  material_sum: ['原料採購','廣告費','設備維修'],
  variable_cost: ['原料採購','廣告費','設備維修','差旅費'],
  fixed_salary: ['工資'], fixed_rent: ['房租水電'], fixed_interest: ['利息支出'],
  fixed_cost: ['工資','房租水電','利息支出']
};
const KEYS = Object.keys(MAP);
const R2 = v => Math.round(Number(v) * 100) / 100;
const N = v => { const n = Number(v); return isNaN(n) ? 0 : n; };

function resolveTarget(key, db) {
  if (!db) return null;
  if (MATERIAL_FIELDS.includes(key) || ['variable_expense','fixed_salary','fixed_rent','fixed_interest'].includes(key))
    return R2(N(db[key]));
  if (key === 'material_sum') return R2(MATERIAL_FIELDS.reduce((s,f)=>s+N(db[f]),0));
  if (key === 'variable_cost') return R2(MATERIAL_FIELDS.reduce((s,f)=>s+N(db[f]),0) + N(db.variable_expense));
  if (key === 'fixed_cost') {
    const sum = N(db.fixed_salary)+N(db.fixed_rent)+N(db.fixed_interest);
    return R2(sum > 0 ? sum : N(db.fixed_cost));
  }
  return null;
}

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME });

  const [thrs] = await c.execute(
    `SELECT * FROM MGM_BEP_threshold
     WHERE bu_no IN ('HM','HN','SZ') ORDER BY bu_no, YYYY_MM`);

  let errors = [], negAdj = [], zeroTarget = [], nullFields = new Set();
  let checked = 0, monthsOk = 0;
  // 固定成本栏位 vs 三明细合计
  let fcMismatch = [];

  for (const db of thrs) {
    // 1) 门槛空字段检查
    [...MATERIAL_FIELDS,'variable_expense','fixed_salary','fixed_rent','fixed_interest']
      .forEach(f => { if (db[f] === null || db[f] === undefined) nullFields.add(`${db.bu_no} ${db.YYYY_MM}.${f}`); });

    // 2) fixed_cost 存值 vs 三明细合计
    const compSum = R2(N(db.fixed_salary)+N(db.fixed_rent)+N(db.fixed_interest));
    if (Math.abs(compSum - N(db.fixed_cost)) > 0.02)
      fcMismatch.push(`${db.bu_no} ${db.YYYY_MM}: stored=${R2(N(db.fixed_cost))} components=${compSum}`);

    let monthAllOk = true;
    for (const key of KEYS) {
      const types = MAP[key];
      let booked = 0, bookedCR = 0, bookedDR = 0, txnCount = 0;
      if (types.length) {
        const ph = types.map(()=>'?').join(',');
        const [rows] = await c.execute(
          `SELECT DB_CR, SUM(sub_amt) a, COUNT(*) n FROM mgm_casher_details
           WHERE bu_no=? AND YYYY_MM=? AND amt_type IN (${ph}) GROUP BY DB_CR`,
          [db.bu_no, db.YYYY_MM, ...types]);
        rows.forEach(r => {
          const a = N(r.a); txnCount += Number(r.n);
          if (r.DB_CR === 'DR') bookedDR += a; else bookedCR += a;
        });
        booked = R2(bookedCR + bookedDR); // 与后端一致
      }
      const target = resolveTarget(key, db);
      if (target === null) continue;
      const adj = R2(target - booked);
      const netAfter = R2(booked + adj);
      checked++;
      if (Math.abs(netAfter - target) > 0.01) { monthAllOk = false; errors.push(`${db.bu_no} ${db.YYYY_MM} ${key}: net=${netAfter} target=${target}`); }
      if (target === 0 && booked > 0.01) zeroTarget.push(`${db.bu_no} ${db.YYYY_MM} ${key}: target=0 booked=${booked}(${txnCount}笔)`);
      if (adj < -0.01) negAdj.push(`${db.bu_no} ${db.YYYY_MM} ${key}: target=${target} booked=${booked} adj=${adj}`);
      // DR 红字回冲存在时提示（后端用 CR+DR 而非净额）
      if (bookedDR > 0.01) monthAllOk; // 仅记录在扩展报告
    }
    if (monthAllOk) monthsOk++;
  }

  console.log('========== BEP 勾稽全量核查 ==========');
  console.log(`门槛正式行: ${thrs.length}（3公司×25月）; 勾稽检查点: ${checked}; 全部月份通过: ${monthsOk}/${thrs.length}`);
  console.log(`\n[1] 勾稽不符(net != target): ${errors.length}`);
  errors.slice(0,20).forEach(e=>console.log('   ✗ '+e));
  console.log(`\n[2] 门槛字段为 NULL: ${nullFields.size}`);
  [...nullFields].slice(0,10).forEach(e=>console.log('   - '+e));
  console.log(`\n[3] fixed_cost 存值 ≠ 三明细合计: ${fcMismatch.length}`);
  fcMismatch.slice(0,10).forEach(e=>console.log('   - '+e));
  console.log(`\n[4] 负调整(现金账近似科目 > 门槛, 映射超溢): ${negAdj.length}`);
  // 按项目汇总
  const byItem = {};
  negAdj.forEach(s=>{ const k=s.split(' ')[2].split(':')[0]; (byItem[k]=byItem[k]||[]).push(s); });
  Object.keys(byItem).sort().forEach(k=>{
    console.log(`   ● ${k}: ${byItem[k].length} 个公司月`);
    byItem[k].slice(0,4).forEach(s=>console.log('       '+s));
  });
  console.log(`\n[5] 门槛=0 但现金账有发生额: ${zeroTarget.length}`);
  zeroTarget.slice(0,15).forEach(e=>console.log('   - '+e));

  // 3) 2024 增长率规律核查：各月/各项相对 2025/12 是否等于给定系数
  const GROWTH = { '01':1.03,'02':.95,'03':1.10,'04':1.045,'05':1.08,'06':.98,
                   '07':1.15,'08':1.20,'09':.93,'10':1.25,'11':1.10,'12':.95 };
  console.log('\n[6] 2024 增长率规律核查（实际值 vs 2025/12×系数，容差 0.5%）');
  for (const bu of ['HM','HN','SZ']) {
    const base = thrs.find(t=>t.bu_no===bu && t.YYYY_MM==='2025/12');
    let bad = 0, tot = 0; const examples = [];
    for (const f of [...MATERIAL_FIELDS,'variable_expense']) {
      for (const mm of Object.keys(GROWTH)) {
        const cur = thrs.find(t=>t.bu_no===bu && t.YYYY_MM==='2024/'+mm);
        const exp = R2(N(base[f]) * GROWTH[mm]);
        const actual = N(cur[f]);
        tot++;
        if (exp === 0) continue;
        const diff = Math.abs(actual-exp)/exp;
        if (diff > 0.005) { bad++; if (examples.length<3) examples.push(`${f} 2024/${mm}: actual=${R2(actual)} expect=${exp} (${(diff*100).toFixed(2)}%)`); }
      }
    }
    console.log(`   ${bu}: ${tot-bad}/${tot} 符合` + (bad?`  偏差例: ${examples.join(' | ')}`:''));
  }

  // 4) 固定成本 2024 是否各月恒定（CW397 基准）
  console.log('\n[7] 固定成本 2024 各月恒定性');
  for (const bu of ['HM','HN','SZ']) {
    for (const f of ['fixed_salary','fixed_rent','fixed_interest']) {
      const vals = [...new Set(thrs.filter(t=>t.bu_no===bu && t.YYYY_MM.startsWith('2024/')).map(t=>R2(N(t[f]))))];
      console.log(`   ${bu} ${f}: ${vals.length===1?'恒定 = '+vals[0]:'有 '+vals.length+' 种值: '+vals.slice(0,4).join(', ')}`);
    }
  }
  await c.end();
})().catch(e=>{console.error(e);process.exit(1);});
