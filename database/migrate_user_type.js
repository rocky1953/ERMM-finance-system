/**
 * 一次性迁移：cams_xuser.xuser_type "部門經理/部门经理" → "部門主管/部门主管"
 * 繁体值转繁体、简体值转简体，保留原有书写习惯；幂等，可安全重跑
 */
const { pool } = require('../config/db');

(async () => {
    try {
        const [okT] = await pool.query(`
            UPDATE cams_xuser
               SET xuser_type = '部門主管'
             WHERE xuser_type = '部門經理'
        `);
        const [okS] = await pool.query(`
            UPDATE cams_xuser
               SET xuser_type = '部门主管'
             WHERE xuser_type = '部门经理'
        `);
        console.log('已更新筆數（繁/簡）：', okT.affectedRows, '/', okS.affectedRows);

        const [rows] = await pool.query(`SELECT DISTINCT xuser_type FROM cams_xuser ORDER BY xuser_type`);
        console.log('\n遷移後 xuser_type 取值：');
        console.table(rows);
    } catch (e) {
        console.error('遷移失敗：', e.message);
    } finally {
        await pool.end();
    }
})();
