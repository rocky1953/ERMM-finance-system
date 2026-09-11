/**
 * 補齊月度資料：為 monthly_items / mgm_account_details / ermm_erp_so_dn
 * 在 2024/01 ~ 2025/12 全部 24 個月份補上測試資料，
 * 確保不論選哪個月份都有資料可查。
 *
 * 用法：node database/fill_monthly_data.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const BU_NO = ['HM', 'HN', 'SZ'];
const MONTHS = [];
for (let y = 2024; y <= 2025; y++) {
    for (let m = 1; m <= 12; m++) {
        MONTHS.push(`${y}/${String(m).padStart(2, '0')}`);
    }
}

const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];

async function main() {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'ERMM_db',
        charset: 'utf8mb4', dateStrings: true,
    });

    const itemTypes = ['租金', '水電', '薪資', '保險', '辦公用品', '旅費', '交際費', '折舊', '維修', '郵電'];
    const nameMap = { '租金': '廠房租金', '水電': '水電費', '薪資': '員工薪資', '保險': '勞健保費', '辦公用品': '文具用品', '旅費': '差旅費', '交際費': '交際應酬', '折舊': '設備折舊', '維修': '設備維修', '郵電': '電話網路' };
    const monthlyRows = [];
    for (const bu of BU_NO) {
        for (const ym of MONTHS) {
            // 每月 2 筆
            for (let k = 0; k < 2; k++) {
                const type = pick(itemTypes);
                monthlyRows.push([bu, ym, type, nameMap[type], 10000 + rand(200000), `${ym.replace('/', '-')}-${String(10 + rand(18)).padStart(2, '0')}`, 'CR', `${type} 測試`]);
            }
        }
    }
    const [mr] = await conn.query('INSERT INTO monthly_items (bu_no, YYYY_MM, item_type, item_name, item_amt, pay_date, DB_CR, remark) VALUES ?', [monthlyRows]);

    const acctGroups = [
        { type: '資產', group: '流動資產', sub: '現金及約當現金', name: '庫存現金', dbcr: 'DR' },
        { type: '資產', group: '流動資產', sub: '應收款項', name: '應收帳款', dbcr: 'DR' },
        { type: '資產', group: '非流動資產', sub: '固定資產', name: '機器設備', dbcr: 'DR' },
        { type: '負債', group: '流動負債', sub: '應付款項', name: '應付帳款', dbcr: 'CR' },
        { type: '負債', group: '長期負債', sub: '長期借款', name: '銀行長期借款', dbcr: 'CR' },
        { type: '權益', group: '股東權益', sub: '股本', name: '普通股股本', dbcr: 'CR' },
        { type: '收入', group: '營業收入', sub: '銷貨收入', name: '產品銷售收入', dbcr: 'CR' },
        { type: '成本', group: '營業成本', sub: '銷貨成本', name: '產品銷貨成本', dbcr: 'DR' },
        { type: '費用', group: '營業費用', sub: '薪資費用', name: '員工薪資', dbcr: 'DR' },
        { type: '費用', group: '營業費用', sub: '租金費用', name: '廠房租金', dbcr: 'DR' },
    ];
    const acctRows = [];
    for (const bu of BU_NO) {
        for (const ym of MONTHS) {
            for (let k = 0; k < 2; k++) {
                const g = pick(acctGroups);
                acctRows.push([bu, ym, g.type, g.group, g.sub, g.name, 50000 + rand(1000000), g.dbcr, `${g.name} 測試`]);
            }
        }
    }
    const [ar] = await conn.query('INSERT INTO mgm_account_details (bu_no, YYYY_MM, acct_type, group_id, sub_group, acct_name, sub_amt, DB_CR, remark) VALUES ?', [acctRows]);

    const items = ['原料A', '原料B', '原料C', '包材', '螺絲', '電子元件', '鋼板', '銅線', '塑膠粒', '電線', '軸承', '紙箱'];
    const clients = ['客戶A', '客戶B', '客戶C', '客戶D', '客戶E', '客戶F', '客戶G', '客戶H'];
    const dnRows = [];
    let seq = 1;
    for (const bu of BU_NO) {
        for (const ym of MONTHS) {
            for (let k = 0; k < 1; k++) {
                const soNbr = `SO${bu}${ym.replace('/', '')}${String(seq++).padStart(4, '0')}`;
                const [y, m] = ym.split('/');
                const date = `${y}-${m}-${String(10 + rand(18)).padStart(2, '0')}`;
                const soQty = 100 + rand(900);
                const dnQty = Math.floor(soQty * (0.5 + Math.random() * 0.5));
                dnRows.push([bu, soNbr, pick(items), pick(clients), date, dnQty, soQty]);
            }
        }
    }
    const [dr] = await conn.query('INSERT INTO ermm_erp_so_dn (bu_no, so_nbr, xitems, client_name, DN_date, DN_qty, so_qty) VALUES ?', [dnRows]);

    await conn.end();

    console.log('✅ 月度資料補齊完成：');
    console.log('='.repeat(50));
    console.log(`   monthly_items 新增: ${mr.affectedRows} 筆 (3 公司 × 24 月 × 2 = 144)`);
    console.log(`   mgm_account_details 新增: ${ar.affectedRows} 筆 (3 公司 × 24 月 × 2 = 144)`);
    console.log(`   ermm_erp_so_dn 新增: ${dr.affectedRows} 筆 (3 公司 × 24 月 × 1 = 72)`);
    console.log('='.repeat(50));
    console.log('💡 現在 2024/01 ~ 2025/12 每個月、每家公司都有資料可查');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
