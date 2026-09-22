/**
 * 遷移腳本：cams_xuser 增加 email、tel_no、xuser_type 欄位
 *   email       VARCHAR(100)  郵箱
 *   tel_no      VARCHAR(30)   電話
 *   xuser_type  VARCHAR(20)   使用者類別（一般員工/部門經理/高階主管）
 *
 * 幂等：欄位已存在時跳過
 */
const { pool } = require('../config/db');

const NEW_COLS = [
    { name: 'email',      ddl: "ADD COLUMN email VARCHAR(100) DEFAULT NULL COMMENT '郵箱'" },
    { name: 'tel_no',     ddl: "ADD COLUMN tel_no VARCHAR(30) DEFAULT NULL COMMENT '電話'" },
    { name: 'xuser_type', ddl: "ADD COLUMN xuser_type VARCHAR(20) NOT NULL DEFAULT '一般員工' COMMENT '使用者類別'" },
];

(async () => {
    for (const col of NEW_COLS) {
        const [exists] = await pool.query(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='cams_xuser' AND COLUMN_NAME=?`,
            [col.name]
        );
        if (exists.length === 0) {
            await pool.execute(`ALTER TABLE cams_xuser ${col.ddl}`);
            console.log(`✅ 已新增欄位: ${col.name}`);
        } else {
            console.log(`⏭️ 欄位已存在，跳過: ${col.name}`);
        }
    }

    // 異常值歸為預設
    await pool.execute(
        `UPDATE cams_xuser SET xuser_type='一般員工' WHERE xuser_type IS NULL OR xuser_type NOT IN ('一般員工','部門經理','高階主管')`
    );

    const [stat] = await pool.execute(
        `SELECT xuser_type, COUNT(*) n FROM cams_xuser GROUP BY xuser_type`
    );
    console.log('目前分布:', stat.map(r => `${r.xuser_type}=${r.n}`).join(', '));
    process.exit(0);
})().catch(err => { console.error('遷移失敗:', err.message); process.exit(1); });
