/**
 * 銷售預估訂單模組 — 建表 + 種子資料
 * 1) mgm_customer_projects（客戶專案主檔，供業務員選單）
 * 2) mgm_preorder_lists（銷售預估訂單，preorder_Id 為 RUID：PRYYYY-#####）
 * 3) 種入 2023~2025 全年預估訂單
 * 執行：node database/add_preorder.js
 */
const { pool } = require('../config/db');

// 可重現亂數
function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rnd = mulberry32(20261108);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const CUSTOMERS = [
    { id: 'CUST-001', name: '华为技术', projects: [['PJ-HW-MATE', 'Mate系列结构件'], ['PJ-HW-IOT', 'IoT模组']] },
    { id: 'CUST-002', name: '小米通讯', projects: [['PJ-MI-BAND', '手环机构件'], ['PJ-MI-HOME', '智能家居面板']] },
    { id: 'CUST-003', name: '华南经销商', projects: [['PJ-HN-2023', '2023华南分销'], ['PJ-HN-2024', '2024华南分销'], ['PJ-HN-2025', '2025华南分销']] },
    { id: 'CUST-004', name: '华东经销商', projects: [['PJ-HD-2023', '2023华东分销'], ['PJ-HD-2024', '2024华东分销']] },
    { id: 'CUST-005', name: '出口日本', projects: [['PJ-JP-OSAKA', '大阪渠道'], ['PJ-JP-TOKYO', '东京渠道']] },
    { id: 'CUST-006', name: '华润集团', projects: [['PJ-CR-RETAIL', '零售通路'], ['PJ-CR-MALL', '商场专柜']] }
];
const SALES = [
    { id: 'U0017', name: '林伟豪' },
    { id: 'U0018', name: '孙铭轩' }
];
// 狀態權重依年份：歷史年度多已結案，當年度多進行中
const STATUS_BY_YEAR = {
    2023: ['won', 'won', 'won', 'lost', 'cancelled'],
    2024: ['won', 'won', 'won', 'lost', 'won', 'cancelled'],
    2025: ['won', 'confirmed', 'confirmed', 'draft', 'lost', 'won', 'draft']
};
const REMARKS = ['季度框架内', '客户已口头确认', '待报价审批', '重点跟进', '竞争对手压价', '需技术评审', '样品已送测', '预算内项目'];

async function run() {
    // 1. 建表（與 migrations/020 同結構）
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS mgm_customer_projects (
            uid INT AUTO_INCREMENT PRIMARY KEY,
            customer_id VARCHAR(50) NOT NULL,
            customer_name VARCHAR(200) NOT NULL,
            project_id VARCHAR(50) NOT NULL,
            project_name VARCHAR(200) NOT NULL,
            status VARCHAR(20) DEFAULT 'active',
            create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uk_cust_proj (customer_id, project_id),
            KEY idx_cust (customer_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='客戶專案主檔';
    `);
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS mgm_preorder_lists (
            uid INT AUTO_INCREMENT PRIMARY KEY,
            preorder_Id VARCHAR(30) NOT NULL,
            user_id VARCHAR(50) DEFAULT NULL,
            user_name VARCHAR(100) DEFAULT NULL,
            customer_id VARCHAR(50) DEFAULT NULL,
            project_id VARCHAR(50) DEFAULT NULL,
            project_name VARCHAR(200) DEFAULT NULL,
            order_amt DECIMAL(18,2) DEFAULT 0,
            order_date DATE DEFAULT NULL,
            status VARCHAR(20) DEFAULT 'draft',
            remark TEXT,
            create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_preorder_id (preorder_Id),
            KEY idx_date (order_date),
            KEY idx_customer (customer_id),
            KEY idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='銷售預估訂單';
    `);
    console.log('✅ 兩張表已建立');

    // 2. 客戶專案主檔
    let cpCount = 0;
    for (const c of CUSTOMERS) {
        for (const [pid, pname] of c.projects) {
            await pool.execute(
                `INSERT INTO mgm_customer_projects (customer_id, customer_name, project_id, project_name)
                 VALUES (?,?,?,?)
                 ON DUPLICATE KEY UPDATE customer_name=VALUES(customer_name), project_name=VALUES(project_name)`,
                [c.id, c.name, pid, pname]);
            cpCount++;
        }
    }
    console.log(`✅ 客戶專案主檔 ${cpCount} 筆（${CUSTOMERS.length} 客戶）`);

    // 3. 預估訂單 2023~2025 全年（每月 3~6 筆）
    const [exist] = await pool.execute('SELECT COUNT(*) AS cnt FROM mgm_preorder_lists');
    if (exist[0].cnt > 0) {
        console.log(`⚠️  已有 ${exist[0].cnt} 筆預估訂單，略過種子（如需重建請先 TRUNCATE mgm_preorder_lists）`);
    } else {
        const rows = [];
        const seqByYear = { 2023: 1, 2024: 1, 2025: 1 };
        for (let year = 2023; year <= 2025; year++) {
            for (let month = 0; month < 12; month++) {
                const nOrders = 3 + Math.floor(rnd() * 4); // 3~6
                for (let i = 0; i < nOrders; i++) {
                    const cust = pick(CUSTOMERS);
                    const [pid, pname] = pick(cust.projects);
                    const sales = pick(SALES);
                    const day = 1 + Math.floor(rnd() * 28);
                    const amt = Math.round((200000 + rnd() * 2800000) / 100) * 100;
                    const status = pick(STATUS_BY_YEAR[year]);
                    const preorderId = `PR${year}-${String(seqByYear[year]++).padStart(5, '0')}`;
                    rows.push([
                        preorderId, sales.id, sales.name, cust.id, pid, pname,
                        amt, `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
                        status, rnd() < 0.6 ? pick(REMARKS) : null
                    ]);
                }
            }
        }
        const placeholders = rows.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',');
        await pool.execute(
            `INSERT INTO mgm_preorder_lists
                (preorder_Id, user_id, user_name, customer_id, project_id, project_name, order_amt, order_date, status, remark)
             VALUES ${placeholders}`, rows.flat());
        console.log(`✅ 預估訂單已種入 ${rows.length} 筆（2023~2025）`);
    }

    const [cnt] = await pool.execute(
        'SELECT YEAR(order_date) AS y, COUNT(*) AS cnt, SUM(order_amt) AS amt FROM mgm_preorder_lists GROUP BY y ORDER BY y');
    console.table(cnt);
    await pool.end();
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
