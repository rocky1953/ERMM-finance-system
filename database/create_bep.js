const { pool } = require('../config/db');

(async () => {
  try {
    await pool.execute(`CREATE TABLE IF NOT EXISTS MGM_BEP_threshold (
      uid INT AUTO_INCREMENT PRIMARY KEY,
      bu_no VARCHAR(10) NOT NULL,
      YYYY_MM VARCHAR(8) NOT NULL,
      consumable DECIMAL(18,2) DEFAULT 0 COMMENT '消耗品',
      packaging DECIMAL(18,2) DEFAULT 0 COMMENT '包裝費',
      processing DECIMAL(18,2) DEFAULT 0 COMMENT '加工費',
      misc_purchase DECIMAL(18,2) DEFAULT 0 COMMENT '雜項購置',
      freight DECIMAL(18,2) DEFAULT 0 COMMENT '運費',
      customs DECIMAL(18,2) DEFAULT 0 COMMENT '進出口費用',
      service_part_comp DECIMAL(18,2) DEFAULT 0 COMMENT '服務零件與賠償',
      variable_expense DECIMAL(18,2) DEFAULT 0 COMMENT '變動費用',
      fixed_cost DECIMAL(18,2) DEFAULT 0 COMMENT '固定成本',
      remark VARCHAR(500) DEFAULT NULL,
      create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_bu_ym (bu_no, YYYY_MM)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('✅ MGM_BEP_threshold 建立成功');

    const [s] = await pool.execute(
      "SELECT YYYY_MM, sale_amt FROM MGM_finance_summary WHERE bu_no='HM' ORDER BY YYYY_MM DESC LIMIT 1"
    );
    console.log('HM 最近月份 sale:', s[0]?.YYYY_MM, s[0]?.sale_amt);

    const ym = s[0]?.YYYY_MM || '202412';
    await pool.execute(
      `INSERT INTO MGM_BEP_threshold
       (bu_no, YYYY_MM, consumable, packaging, processing, misc_purchase,
        freight, customs, service_part_comp, variable_expense, fixed_cost)
       VALUES ('HM', ?, 1296206.36, 142720.31, 500, 598049.55,
               500, 361949.49, 1102926.29, 3581202, 14040578.64)
       ON DUPLICATE KEY UPDATE
        consumable=VALUES(consumable), packaging=VALUES(packaging),
        processing=VALUES(processing), misc_purchase=VALUES(misc_purchase),
        freight=VALUES(freight), customs=VALUES(customs),
        service_part_comp=VALUES(service_part_comp),
        variable_expense=VALUES(variable_expense),
        fixed_cost=VALUES(fixed_cost)`,
      [ym]
    );
    console.log('✅ Seed HM', ym, '完成');

    const [b] = await pool.execute('SELECT * FROM MGM_BEP_threshold');
    console.log('目前筆數:', b.length);
    pool.end();
  } catch (e) { console.error(e.message); process.exit(1); }
})();
