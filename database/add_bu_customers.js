/**
 * HM/HN/SZ 三公司各新增 30 筆「客戶」往來對象（relation_detail）
 * 並在 mgm_customer_projects 為每位客戶建立預設專案，
 * 使「銷售預估訂單」客戶 listbox 可直接勾連選用。
 * 執行：node database/add_bu_customers.js
 */
const { pool } = require('../config/db');

const NAMES = {
    HM: ['港华电子', '中港科技', '维港实业', '九龙电子', '新界贸易', '恒基电子', '长江实业', '新鸿基科技',
        '嘉里物流', '太古实业', '怡和科技', '和记黄埔', '信和电子', '恒隆贸易', '南丰实业', '华人置业',
        '鹰君科技', '合和实业', '丽新电子', '信德科技', '美心食品', '大家乐集团', '维他奶国际', '港铁工程',
        '电讯盈科', '数码通电讯', '香港宽频', '中华电力', '港灯集团', '煤气公司'],
    HN: ['华南精密', '湖南智造', '湘江电子', '洞庭科技', '株洲机电', '湘潭电子', '衡阳精工', '岳阳贸易',
        '常德实业', '益阳电子', '郴州科技', '永州机电', '怀化实业', '娄底电子', '邵阳精工', '吉首贸易',
        '张家界科技', '华南光电', '湖南新能源', '湘江智造', '长沙电子', '华南五金', '湖南建材', '湘江物流',
        '华南食品', '湖南纺织', '湘江化工', '华南医药', '湖南矿业', '湘江汽配'],
    SZ: ['深圳华为', '腾讯科技', '大疆创新', '中兴电子', '比亚迪', '创维集团', '康佳电子', '华强北电子',
        '深圳迈瑞', '大族激光', '汇顶科技', '深信服', '金蝶软件', '用友深圳', '顺丰科技', '平安科技',
        '招商蛇口', '万科企业', '华侨城', '深圳能源', '深圳燃气', '盐田港集团', '深圳机场', '深圳地铁',
        '光启技术', '柔宇科技', '优必选', '云天励飞', '商汤深圳', '海能达']
};

function pad(n) { return String(n).padStart(3, '0'); }

(async () => {
    let relAdded = 0, projAdded = 0;
    for (const bu of ['HM', 'HN', 'SZ']) {
        for (let i = 1; i <= 30; i++) {
            const custId = `${bu}-C${pad(i)}`;
            const custName = NAMES[bu][i - 1];
            // 1) 往來對象（已存在則略過）
            const [exist] = await pool.execute(
                'SELECT uid FROM relation_detail WHERE relation_id=?', [custId]);
            if (!exist.length) {
                await pool.execute(
                    `INSERT INTO relation_detail (bu_no, relation_id, relation_name, relation_type, contact_person, contact_phone, inuse_flag)
                     VALUES (?,?,?,?,?,?, 'USE')`,
                    [bu, custId, custName, '客户', `联系人${i}`, `13${bu === 'HM' ? 5 : bu === 'HN' ? 6 : 7}${String(10000000 + i * 137).slice(0, 8)}`]);
                relAdded++;
            }
            // 2) 預設專案（供預估訂單勾連）
            const projId = `PJ-${bu}-${pad(i)}`;
            const projName = `${custName}年度框架项目`;
            await pool.execute(
                `INSERT INTO mgm_customer_projects (customer_id, customer_name, project_id, project_name)
                 VALUES (?,?,?,?)
                 ON DUPLICATE KEY UPDATE customer_name=VALUES(customer_name), project_name=VALUES(project_name)`,
                [custId, custName, projId, projName]);
            projAdded++;
        }
    }
    console.log(`✅ 往來對象新增 ${relAdded} 筆（客戶），專案主檔同步 ${projAdded} 筆`);
    const [cnt] = await pool.execute(
        `SELECT bu_no, COUNT(*) AS cnt FROM relation_detail WHERE relation_type='客户' GROUP BY bu_no ORDER BY bu_no`);
    console.table(cnt);
    await pool.end();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
