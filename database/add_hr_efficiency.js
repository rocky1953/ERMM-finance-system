/**
 * P2 高管人效战情 — 建表脚本（幂等）
 *   daily_report_erp_xref     日报 items_id ↔ ERP 单据类型映射表
 *   daily_report_mgmt_report  月度经营+人效报告推送日志
 *
 * 执行：node database/add_hr_efficiency.js
 */
const { pool } = require('../config/db');

async function run() {
    const conn = await pool.getConnection();
    try {
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS daily_report_erp_xref (
                id INT AUTO_INCREMENT PRIMARY KEY,
                bu_no VARCHAR(20) NOT NULL,
                items_id VARCHAR(100) NOT NULL COMMENT '日报明细的 items_id',
                erp_doc_type VARCHAR(30) NOT NULL COMMENT 'ERP 单据类型: SO/PO/INVOICE',
                erp_ref_field VARCHAR(50) DEFAULT 'xitems' COMMENT 'ERP 表关联字段',
                remark VARCHAR(200) DEFAULT NULL,
                create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uk_bu_items (bu_no, items_id),
                KEY idx_erp_type (bu_no, erp_doc_type)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='日报项目与ERP单据映射'
        `);
        console.log('✅ daily_report_erp_xref 已建立');

        await conn.execute(`
            CREATE TABLE IF NOT EXISTS daily_report_mgmt_report (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                bu_no VARCHAR(20) NOT NULL,
                YYYY_MM VARCHAR(10) NOT NULL COMMENT '报告月份 YYYY/MM',
                report_data JSON NOT NULL COMMENT '完整报告内容',
                pushed_by VARCHAR(50) DEFAULT NULL,
                pushed_by_name VARCHAR(100) DEFAULT NULL,
                pushed_time DATETIME DEFAULT NULL,
                status VARCHAR(20) DEFAULT 'PENDING' COMMENT 'PENDING/PUSHED',
                create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_bu_ym (bu_no, YYYY_MM),
                KEY idx_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='月度经营+人效报告推送记录'
        `);
        console.log('✅ daily_report_mgmt_report 已建立');

        // 初始 seed 映射（HM 公司常用 items_id）
        const seeds = [
            ['HM', 'ERP-2025', 'SO',      'xitems', 'ERP系统相关工作对应销售订单'],
            ['HM', 'PUR-2025', 'PO',      'xitems', '采购工作对应采购订单'],
            ['HM', 'FIN-AUDIT','INVOICE', 'client_id', '财务稽核对应开票单据'],
            ['HM', 'HR-2025',  'SO',      'xitems', '人事工作关联销售人力成本'],
            ['HM', 'IT-2025',  'SO',      'xitems', 'IT项目对应销售订单'],
            ['HM', 'BSC-2025', 'SO',      'xitems', 'BSC项目对应销售订单'],
            ['HM', 'PROJ-001', 'SO',      'xitems', '项目一对应销售订单'],
            ['HM', 'PROJ-002', 'PO',      'xitems', '项目二对应采购订单'],
            ['HM', 'IT-2005',  'SO',      'xitems', 'IT项目对应销售订单'],
            ['HM', 'BSC-2005', 'SO',      'xitems', 'BSC项目对应销售订单'],
            ['HM', 'PUR-2005', 'PO',      'xitems', '采购工作对应采购订单'],
            ['HM', 'HR-2005',  'SO',      'xitems', '人事工作关联销售人力成本'],
            ['HM', 'ERP-2005', 'SO',      'xitems', 'ERP系统相关工作对应销售订单']
        ];
        const stmt = await conn.prepare(
            `INSERT IGNORE INTO daily_report_erp_xref
                (bu_no, items_id, erp_doc_type, erp_ref_field, remark)
             VALUES (?,?,?,?,?)`
        );
        for (const s of seeds) { await stmt.execute(s); }
        await stmt.close();
        console.log(`✅ daily_report_erp_xref 初始映射 ${seeds.length} 条`);
    } finally {
        conn.release();
    }
    await pool.end();
}
run().catch(e => { console.error(e); process.exit(1); });
