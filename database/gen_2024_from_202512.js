/**
 * gen_2024_from_202512.js
 * ------------------------------------------------------------------
 * 以 2025/12 各 BU 的資料為基準，重新生成 2024 全年（01~12月）測試資料。
 *
 * 口徑（已與使用者確認）：
 *   A. 各月「獨立」相對 2025/12 基準：金額/數量 = 基準值 × (1 + 當月增長率)
 *   B. 先把 8 張表 2024 年現有資料備份到帶時間戳的備份表，再於交易內清空重生成
 *   C. 覆蓋 2025/12 有基準資料的 8 張月度表
 *
 * 增長率：1月+3% 2月-5% 3月+10% 4月+4.5% 5月+8% 6月-2%
 *         7月+15% 8月+20% 9月-7% 10月+25% 11月+10% 12月-5%
 *
 * 用法：
 *   node database/gen_2024_from_202512.js           # 預演（不寫庫）
 *   node database/gen_2024_from_202512.js --apply   # 實際備份+清空+生成
 * ------------------------------------------------------------------
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const BUS = ['HM', 'HN', 'SZ'];
const BASE_YM = '2025/12';
const YEAR = '2024';
const STAMP = (() => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
})();

// 月份增長率（key=月）
const GROWTH = {
    1: 0.03, 2: -0.05, 3: 0.10, 4: 0.045, 5: 0.08, 6: -0.02,
    7: 0.15, 8: 0.20, 9: -0.07, 10: 0.25, 11: 0.10, 12: -0.05
};
const MONTHS = [1,2,3,4,5,6,7,8,9,10,11,12];
const factor = m => 1 + GROWTH[m];

const r2 = n => Math.round(Number(n) * 100) / 100;
const r4 = n => Math.round(Number(n) * 10000) / 10000;
const num = v => (v === null || v === undefined || v === '') ? null : Number(v);
const pad2 = n => String(n).padStart(2, '0');
const pad3 = n => String(n).padStart(3, '0');
const clampDay = s => {
    const d = parseInt(String(s || '').slice(-2), 10);
    return Math.max(1, Math.min(28, isNaN(d) ? 15 : d));
};

// 各表的「2024 年資料」判定條件（用於備份與清空）
const SCOPE = {
    mgm_finance_summary: { where: "YYYY_MM LIKE '2024/%'", base: "bu_no=? AND YYYY_MM=?" },
    mgm_invoice_details: { where: "YYYY_MM LIKE '2024/%'", base: "bu_no=? AND YYYY_MM=?" },
    ermm_arap_detail:    { where: "YYYY_MM LIKE '2024/%'", base: "bu_no=? AND YYYY_MM=?" },
    mgm_casher_details:  { where: "YYYY_MM LIKE '2024/%'", base: "bu_no=? AND YYYY_MM=?" },
    mgm_bep_threshold:   { where: "YYYY_MM LIKE '2024/%'", base: "bu_no=? AND YYYY_MM=?" },
    ermm_erp_po:         { where: "YYYY_MM LIKE '2024/%'", base: "bu_no=? AND YYYY_MM=?" },
    ermm_erp_so:         { where: "YYYY_MM LIKE '2024/%'", base: "bu_no=? AND YYYY_MM=?" },
    pay_detail:          { where: "YEAR(should_date)=2024", base: "bu_no=? AND DATE_FORMAT(should_date,'%Y/%m')=?" },
};
const TABLES = Object.keys(SCOPE);
const SKIP_COLS = ['uid', 'create_time', 'update_time'];

/**
 * 把一列日期字串 'YYYY-MM-DD' 換成目標年月（保留日，clamp 1..28）；null 保留
 */
function shiftDate(val, yyyy, mm) {
    if (val === null || val === undefined || val === '') return null;
    const day = clampDay(val);
    return `${yyyy}-${pad2(mm)}-${pad2(day)}`;
}

async function main() {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'ERMM_db',
        multipleStatements: true,
        dateStrings: true
    });

    // 通用動態 INSERT（依實際存在的列）
    async function insertRow(table, obj) {
        const cols = Object.keys(obj).filter(k => !SKIP_COLS.includes(k));
        const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
        const vals = cols.map(c => (obj[c] === undefined ? null : obj[c]));
        await conn.execute(sql, vals);
    }

    // ============ 各表的「一列基準 → 一列目標」轉換 ============

    // 1. 財務摘要：所有 *_amt 金額 ×factor，比率/評分/匯率/人數/股東權益不動；事後重算會計勾稽
    function mapSummary(base, m) {
        const f = factor(m);
        const row = { ...base };
        delete row.uid; delete row.create_time; delete row.update_time;
        row.YYYY_MM = `${YEAR}/${pad2(m)}`;
        row.YYYY = YEAR; row.MM = pad2(m);
        for (const k of Object.keys(row)) {
            if (/_amt$/.test(k)) {
                const n = num(row[k]);
                if (n !== null && n !== 0) row[k] = r2(n * f);
            }
        }
        // 會計恆等式：A = L + E
        const totalAsset = num(row.ttl_asset_amt) || 0;
        const totalDebet = num(row.ttl_debet_amt) || 0;
        const equityCap = (num(row.captial_stock) || 0) + (num(row.captial_reserve) || 0) + (num(row.legal_reserve) || 0);
        const currentPL = num(row.current_PL_amt) || 0;
        row.accumulated_amt = r2(totalAsset - totalDebet - equityCap - currentPL);
        row.stockholder_amt = r2(totalAsset - totalDebet);
        row.retained_income_amt = row.accumulated_amt;
        return row;
    }

    // 2. 發票明細
    function mapInvoice(base, m, seq) {
        const f = factor(m);
        const row = { ...base };
        delete row.uid; delete row.create_time; delete row.update_time;
        row.YYYY_MM = `${YEAR}/${pad2(m)}`;
        ['sub_amt', 'VAT_amt', 'payment'].forEach(k => {
            const n = num(row[k]); if (n !== null) row[k] = r2(n * f);
        });
        row.wk_date = shiftDate(base.wk_date, YEAR, m);
        row.pay_date = shiftDate(base.pay_date, YEAR, m);
        const tx = base.TX_type || 'IV';
        row.invoice_no = `${tx}${base.bu_no}${YEAR}${pad2(m)}${pad3(seq)}`;
        return row;
    }

    // 3. 付款明細（無 YYYY_MM）
    function mapPay(base, m) {
        const f = factor(m);
        const row = { ...base };
        delete row.uid; delete row.create_time; delete row.update_time;
        const n = num(row.amount); if (n !== null) row.amount = r2(n * f);
        row.should_date = shiftDate(base.should_date, YEAR, m);
        row.invoice_date = shiftDate(base.invoice_date, YEAR, m);
        row.pay_date = shiftDate(base.pay_date, YEAR, m);
        row.entry_date = shiftDate(base.entry_date, YEAR, m);
        row.data_year = YEAR;
        if (base.invoice_num) row.invoice_num = String(base.invoice_num).replace(/2025/g, YEAR);
        return row;
    }

    // 4. ARAP 彙總
    function mapArap(base, m) {
        const f = factor(m);
        const row = { ...base };
        delete row.uid; delete row.update_time;
        row.YYYY_MM = `${YEAR}/${pad2(m)}`;
        row.YYYY = YEAR;
        ['AR_amt', 'AP_amt', 'AR_ageing', 'AP_ageing'].forEach(k => {
            const n = num(row[k]); if (n !== null) row[k] = r2(n * f);
        });
        row.batch_id = 'GEN2024';
        return row;
    }

    // 5. 現金日記帳
    function mapCasher(base, m, seq) {
        const f = factor(m);
        const row = { ...base };
        delete row.uid; delete row.create_time; delete row.update_time;
        const n = num(row.sub_amt); if (n !== null) row.sub_amt = r2(n * f);
        row.YYYY_MM = `${YEAR}/${pad2(m)}`;
        row.YYYY = YEAR; row.MM = pad2(m);
        row.wk_date = shiftDate(base.wk_date, YEAR, m);
        const tag = `${YEAR}${pad2(m)}`;
        let nv = base.num_vman ? String(base.num_vman).replace('202512', tag) : `V${base.bu_no}${tag}${pad3(seq)}`;
        if (base.num_vman && nv === String(base.num_vman)) nv = `${base.num_vman}-${tag}${pad2(seq)}`;
        row.num_vman = nv;
        return row;
    }

    // 6. BEP 門檻（所有成本項統一 ×factor）
    const BEP_AMT = ['consumable','packaging','processing','misc_purchase','freight','customs',
        'service_part_comp','variable_expense','fixed_salary','fixed_rent','fixed_interest','fixed_cost'];
    function mapBep(base, m) {
        const f = factor(m);
        const row = { ...base };
        delete row.uid; delete row.create_time; delete row.update_time;
        row.YYYY_MM = `${YEAR}/${pad2(m)}`;
        BEP_AMT.forEach(k => {
            const n = num(row[k]); if (n !== null) row[k] = r2(n * f);
        });
        return row;
    }

    // 7. 採購單 PO：數量 ×factor、單價/匯率不變，重算金額與本幣額、VAT
    function mapPO(base, m, seq) {
        const f = factor(m);
        const row = { ...base };
        delete row.uid; delete row.create_time;
        ['po_qty', 'inventory_qty', 'qty_balance_approved', 'qty_balance_closed'].forEach(k => {
            const n = num(row[k]); if (n !== null) row[k] = r4(n * f);
        });
        const qty = num(row.po_qty) || 0;
        const price = num(base.unit_price) || 0;
        const rate = num(base.exchange_rate) || 0;
        const amtOld = num(base.po_amount) || 0;
        const vatOld = num(base.vat_amt) || 0;
        row.po_amount = r2(qty * price);
        row.po_amount_local = r2(row.po_amount * rate);
        row.vat_amt = amtOld > 0 ? r2(row.po_amount * vatOld / amtOld) : r2(vatOld * f);
        row.YYYY_MM = `${YEAR}/${pad2(m)}`;
        row.YYYY = YEAR; row.MM = pad2(m);
        row.po_date = shiftDate(base.po_date, YEAR, m);
        row.po_id = `PO${YEAR.slice(2)}${pad2(m)}${pad3(seq)}`;
        row.batch_id = 'GEN2024';
        // po_status / po_sub_status / supplier_type / deliver_ontime 等中文枚舉值原樣保留
        return row;
    }

    // 8. 銷售單 SO：數量 ×factor、單價不變（金額=qty×price 前端重算）
    function mapSO(base, m, seq) {
        const f = factor(m);
        const row = { ...base };
        delete row.uid; delete row.create_time;
        ['so_qty', 'dn_qty'].forEach(k => {
            const n = num(row[k]); if (n !== null) row[k] = r4(n * f);
        });
        row.YYYY_MM = `${YEAR}/${pad2(m)}`;
        row.YYYY = YEAR; row.MM = pad2(m);
        row.so_date = shiftDate(base.so_date, YEAR, m);
        row.so_nbr = `SO${YEAR.slice(2)}${pad2(m)}${pad3(seq)}`;
        // status 中文枚舉值原樣保留
        return row;
    }

    const MAPPERS = {
        mgm_finance_summary: mapSummary,
        mgm_invoice_details: mapInvoice,
        pay_detail:          mapPay,
        ermm_arap_detail:    mapArap,
        mgm_casher_details:  mapCasher,
        mgm_bep_threshold:   mapBep,
        ermm_erp_po:         mapPO,
        ermm_erp_so:         mapSO
    };

    // ============ 預先載入各 BU 2025/12 基準 ============
    const bases = {};   // bases[table][bu] = [rows]
    for (const tbl of TABLES) {
        bases[tbl] = {};
        for (const bu of BUS) {
            const [rows] = await conn.execute(
                `SELECT * FROM ${tbl} WHERE ${SCOPE[tbl].base}`, [bu, BASE_YM]);
            bases[tbl][bu] = rows;
        }
    }

    // ============ 預演統計 ============
    let planTotal = 0;
    console.log(`模式: ${APPLY ? '★★★ 實際寫庫 (--apply) ★★★' : '預演 DRY-RUN（不會寫庫，加 --apply 才執行）'}`);
    console.log(`基準月: ${BASE_YM}　生成: ${YEAR}/01~12　BU: ${BUS.join('/')}　備份戳: ${STAMP}\n`);
    for (const tbl of TABLES) {
        let tblTotal = 0;
        const perBu = BUS.map(bu => {
            const n = bases[tbl][bu].length;
            tblTotal += n * 12;
            return `${bu}:${n}行×12`;
        });
        planTotal += tblTotal;
        console.log(`  ${tbl.padEnd(22)} 基準[${perBu.join('  ')}]  => 預計生成 ${tblTotal} 行`);
    }
    console.log(`\n預計插入總行數: ${planTotal}`);

    if (!APPLY) {
        console.log('\n✅ 預演完成，未寫庫。確認無誤後執行：node database/gen_2024_from_202512.js --apply');
        await conn.end();
        return;
    }

    // ============ 1) 備份 2024 現有資料 ============
    console.log('\n===== 1) 備份 2024 現有資料 =====');
    for (const tbl of TABLES) {
        const bak = `${tbl}__bak2024_${STAMP}`;
        await conn.execute(`CREATE TABLE ${bak} LIKE ${tbl}`);
        await conn.execute(`INSERT INTO ${bak} SELECT * FROM ${tbl} WHERE ${SCOPE[tbl].where}`);
        const [[c]] = await conn.execute(`SELECT COUNT(*) c FROM ${bak}`);
        console.log(`  ${bak}  <= ${c.c} 行`);
    }

    // ============ 2) 交易內：清空 + 重生成 ============
    console.log('\n===== 2) 清空 2024 並重新生成 =====');
    await conn.beginTransaction();
    let inserted = 0;
    try {
        for (const tbl of TABLES) {
            const [del] = await conn.execute(`DELETE FROM ${tbl} WHERE ${SCOPE[tbl].where}`);
            console.log(`  清空 ${tbl}: ${del.affectedRows} 行`);
        }

        for (const bu of BUS) {
            for (const m of MONTHS) {
                for (const tbl of TABLES) {
                    const src = bases[tbl][bu];
                    if (!src || src.length === 0) continue;
                    let seq = 0;
                    for (const baseRow of src) {
                        seq++;
                        await insertRow(tbl, MAPPERS[tbl](baseRow, m, seq));
                        inserted++;
                    }
                }
            }
        }
        await conn.commit();
        console.log(`  ✅ 已提交，插入 ${inserted} 行`);
    } catch (e) {
        await conn.rollback();
        console.error('  ❌ 寫入失敗已 ROLLBACK（備份表仍保留）:', e.message);
        throw e;
    }

    // ============ 3) 驗證 ============
    console.log('\n===== 3) 驗證 2024 各月行數 =====');
    for (const tbl of TABLES) {
        const [rows] = await conn.execute(
            `SELECT ${tbl === 'pay_detail'
                ? "DATE_FORMAT(should_date,'%Y/%m') ym" : 'YYYY_MM ym'}, COUNT(*) c
             FROM ${tbl} WHERE ${SCOPE[tbl].where} GROUP BY ym ORDER BY ym`);
        const map = Object.fromEntries(rows.map(r => [r.ym, r.c]));
        const line = MONTHS.map(m => map[`${YEAR}/${pad2(m)}`] || 0).join(',');
        console.log(`  ${tbl.padEnd(22)} [${line}]`);
    }

    console.log('\n🎉 完成！如需還原，可使用上述備份表（__bak2024_' + STAMP + '）');
    await conn.end();
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
