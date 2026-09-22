/**
 * 遷移腳本：cams_xuser 增加 admin 欄位
 *   admin VARCHAR(10) NOT NULL DEFAULT '普通者'
 *   選項：管理員 / 普通者
 *   預設將 U0001 設為管理員（其餘為普通者）
 *
 * 用法：node database/add_admin_column.js
 * 幂等：欄位已存在時不會重複新增
 */
const { pool } = require('../config/db');

(async () => {
    const [cols] = await pool.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='cams_xuser' AND COLUMN_NAME='admin'`
    );
    if (cols.length === 0) {
        await pool.execute(`ALTER TABLE cams_xuser ADD COLUMN admin VARCHAR(10) NOT NULL DEFAULT '普通者' COMMENT '管理員/普通者'`);
        console.log('① 已新增欄位 cams_xuser.admin（VARCHAR(10) DEFAULT 普通者）');
    } else {
        console.log('① 欄位 cams_xuser.admin 已存在，跳過新增');
    }

    // 異常值一律歸為普通者
    const [fix] = await pool.execute(
        `UPDATE cams_xuser SET admin='普通者' WHERE admin IS NULL OR admin NOT IN ('管理員','普通者')`
    );
    console.log(`② 異常值歸類為普通者，影響 ${fix.affectedRows} 筆`);

    // 預設管理員
    const [up] = await pool.execute(
        `UPDATE cams_xuser SET admin='管理員' WHERE xuser_id='U0001' AND admin<>'管理員'`
    );
    console.log(`③ U0001 設為管理員，影響 ${up.affectedRows} 筆`);

    const [stat] = await pool.execute(
        `SELECT admin, COUNT(*) n FROM cams_xuser GROUP BY admin`
    );
    console.log('④ 目前帳號分布:', stat.map(r => `${r.admin}=${r.n}`).join(', '));

    process.exit(0);
})().catch(err => { console.error('遷移失敗:', err.message); process.exit(1); });
