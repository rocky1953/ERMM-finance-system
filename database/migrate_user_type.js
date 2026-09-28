/**
 * 一次性迁移：cams_xuser.xuser_type "部門經理" → "部門主管"（繁体）
 * 幂等，可安全重跑
 */
const { pool } = require('../config/db');

(async () => {
    try {
        const [ok] = await pool.query(`
            UPDATE cams_xuser
               SET xuser_type = '部門主管'
             WHERE xuser_type = '部門經理'
        `);
        console.log('已更新筆數：', ok.affectedRows);

        const [rows] = await pool.query(`SELECT DISTINCT xuser_type FROM cams_xuser ORDER BY xuser_type`);
        console.log('\n遷移後 xuser_type 取值：');
        console.table(rows);
    } catch (e) {
        console.error('遷移失敗：', e.message);
    } finally {
        await pool.end();
    }
})();
