/**
 * 5 張空表測試資料產生器
 * 產生 30 筆／表，涵蓋 cams_xuser / ermm_erp_so_dn / monthly_items / mgm_account_details / relation_detail
 *
 * 用法：node database/gen_test_data_5tables.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const BU_NO = ['HM', 'HN', 'SZ'];
const YYYY_MM_LIST = ['2025/10', '2025/09', '2025/08'];

const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
const pad = (n, len = 2) => String(n).padStart(len, '0');
const fmtDate = (d) => d.toISOString().slice(0, 10);
const randDate = (year, month) => {
    const day = 1 + rand(28);
    return `${year}-${pad(month)}-${pad(day)}`;
};

function hashPwd(pwd) {
    return crypto.createHash('sha256').update(String(pwd)).digest('hex');
}

async function main() {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'ERMM_db',
        charset: 'utf8mb4',
        dateStrings: true,
    });

    const totals = {};

    // ============ 1. cams_xuser 使用者 ============
    const depts = ['財務部', '業務部', '採購部', '倉管部', '人事部', '資訊部', '總經理室'];
    const surnames = ['陳', '林', '王', '李', '張', '劉', '楊', '黃', '趙', '吳', '周', '徐', '孫', '馬', '朱'];
    const givenNames = ['偉豪', '美玲', '俊傑', '雅婷', '志強', '淑芬', '建宏', '佩珊', '文豪', '靜怡', '國棟', '麗華', '承恩', '惠君', '銘軒'];
    const userRows = [];
    for (let i = 1; i <= 30; i++) {
        const uid = `U${pad(i, 4)}`;
        const name = pick(surnames) + pick(givenNames);
        const dept = pick(depts);
        const client_id = pick(BU_NO);
        const flag = i % 7 === 0 ? 'NOUSE' : 'USE';
        userRows.push([uid, hashPwd('123456'), name, dept, client_id, flag]);
    }
    const [ur] = await conn.query(
        'INSERT IGNORE INTO cams_xuser (xuser_id, xuser_password, xuser_name, xuser_dept, client_id, inuse_flag) VALUES ?',
        [userRows]
    );
    totals['cams_xuser'] = ur.affectedRows;

    // ============ 2. ermm_erp_so_dn 交貨單 ============
    const items = ['原料A', '原料B', '原料C', '包材', '螺絲', '電子元件', '鋼板', '銅線', '塑膠粒', '電線', '軸承', '紙箱'];
    const clients = ['客戶A', '客戶B', '客戶C', '客戶D', '客戶E', '客戶F', '客戶G', '客戶H'];
    const dnRows = [];
    for (let i = 1; i <= 30; i++) {
        const bu = pick(BU_NO);
        const soNbr = `SO${bu}${pad(20251000 + i)}`;
        const item = pick(items);
        const client = pick(clients);
        const date = randDate(2025, 10);
        const soQty = 100 + rand(900);
        const dnQty = Math.floor(soQty * (0.5 + Math.random() * 0.5));
        dnRows.push([bu, soNbr, item, client, date, dnQty, soQty]);
    }
    const [dr] = await conn.query(
        'INSERT INTO ermm_erp_so_dn (bu_no, so_nbr, xitems, client_name, DN_date, DN_qty, so_qty) VALUES ?',
        [dnRows]
    );
    totals['ermm_erp_so_dn'] = dr.affectedRows;

    // ============ 3. monthly_items 月度項目 ============
    const itemTypes = ['租金', '水電', '薪資', '保險', '辦公用品', '旅費', '交際費', '折舊', '維修', '郵電'];
    const crNames = {
        '租金': '廠房租金', '水電': '水電費', '薪資': '員工薪資', '保險': '勞健保費',
        '辦公用品': '文具用品', '旅費': '差旅費', '交際費': '交際應酬', '折舊': '設備折舊',
        '維修': '設備維修', '郵電': '電話網路'
    };
    const monthlyRows = [];
    for (let i = 1; i <= 30; i++) {
        const bu = pick(BU_NO);
        const ym = pick(YYYY_MM_LIST);
        const type = pick(itemTypes);
        const name = crNames[type];
        const amt = 10000 + rand(200000);
        const [y, m] = ym.split('/');
        const payDate = randDate(Number(y), Number(m));
        const dbcr = 'CR'; // 月度項目多為支出
        monthlyRows.push([bu, ym, type, name, amt, payDate, dbcr, `${type} 測試資料`]);
    }
    const [mr] = await conn.query(
        'INSERT INTO monthly_items (bu_no, YYYY_MM, item_type, item_name, item_amt, pay_date, DB_CR, remark) VALUES ?',
        [monthlyRows]
    );
    totals['monthly_items'] = mr.affectedRows;

    // ============ 4. mgm_account_details 帳戶明細 ============
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
    for (let i = 1; i <= 30; i++) {
        const bu = pick(BU_NO);
        const ym = pick(YYYY_MM_LIST);
        const g = pick(acctGroups);
        const amt = 50000 + rand(1000000);
        acctRows.push([bu, ym, g.type, g.group, g.sub, g.name, amt, g.dbcr, `${g.name} 測試資料`]);
    }
    const [ar] = await conn.query(
        'INSERT INTO mgm_account_details (bu_no, YYYY_MM, acct_type, group_id, sub_group, acct_name, sub_amt, DB_CR, remark) VALUES ?',
        [acctRows]
    );
    totals['mgm_account_details'] = ar.affectedRows;

    // ============ 5. relation_detail 往來對象 ============
    const relTypes = ['客戶', '供應商', '關係人'];
    const companies = ['鴻明', '鴻南', '深圳'];
    const relNames = {
        '客戶': ['台北貿易', '高雄實業', '台中科技', '台南紡織', '新竹電子', '桃園機械', '彰化化工', '雲林食品'],
        '供應商': ['聯華原料', '大同包材', '義美五金', '台塑石化', '中鋼材料', '南亞塑膠', '東元電機', '光寶科技'],
        '關係人': ['關係企業A', '關係企業B', '子公司C', '母公司D', '合資公司E']
    };
    const cities = ['台北市', '新北市', '桃園市', '台中市', '台南市', '高雄市', '新竹市', '彰化市'];
    const streets = ['中正路', '中山路', '民權路', '民生路', '建國路', '自由路', '和平路', '博愛路'];
    const relRows = [];
    for (let i = 1; i <= 30; i++) {
        const bu = pick(BU_NO);
        const rid = `R${pad(i, 4)}`;
        const type = pick(relTypes);
        const name = pick(relNames[type]) + pick(['有限公司', '股份有限公司', '']);
        const contact = pick(surnames) + pick(givenNames);
        const phone = `0${pick(['2', '3', '4', '7', '6', '7'])}-${pad(1000000 + rand(9000000), 7)}`;
        const addr = `${pick(cities)}${pick(streets)}${100 + rand(900)}號`;
        const taxId = pad(10000000 + rand(90000000), 8);
        const flag = i % 8 === 0 ? 'NOUSE' : 'USE';
        relRows.push([bu, rid, name, type, contact, phone, addr, taxId, flag]);
    }
    const [rr] = await conn.query(
        'INSERT INTO relation_detail (bu_no, relation_id, relation_name, relation_type, contact_person, contact_phone, address, tax_id, inuse_flag) VALUES ?',
        [relRows]
    );
    totals['relation_detail'] = rr.affectedRows;

    await conn.end();

    console.log('✅ 測試資料產生完成：');
    console.log('='.repeat(50));
    for (const [t, c] of Object.entries(totals)) {
        console.log(`   ${t}: ${c} 筆`);
    }
    console.log('='.repeat(50));
    console.log(`   合計：${Object.values(totals).reduce((a, b) => a + b, 0)} 筆`);
    console.log('');
    console.log('💡 使用者預設密碼：123456（SHA256 加密）');
    console.log('💡 資料分布：HM / HN / SZ 三家公司，月份 2025/08~10');
}

main().catch(err => {
    console.error('❌ 產生失敗:', err.message);
    process.exit(1);
});
