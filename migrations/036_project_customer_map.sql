-- 036 客户-项目映射（COO-02 / CFO-06 共用）
-- 背景：ermm_erp_so 仅有 client_id，无 project_id；项目维度损益与出货自动引入
--       需要客户到项目的稳定映射，避免全部落到「未分派项目」
-- 做法：1) 为每个出货客户建立「默认项目」（不覆盖客户原有项目）
--       2) 建立 project_customer_map（client_id → project_id），供 CFO-06 与 COO-02 共用

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS project_customer_map (
  uid         int          NOT NULL AUTO_INCREMENT,
  client_id   varchar(50)  NOT NULL COMMENT 'ERP 客户编码（ermm_erp_so.client_id）',
  client_name varchar(200) DEFAULT NULL,
  project_id  varchar(50)  NOT NULL,
  project_name varchar(200) DEFAULT NULL,
  source      varchar(20)  NOT NULL DEFAULT 'seed' COMMENT 'seed / manual',
  update_by   varchar(50)  DEFAULT NULL,
  update_time datetime     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (uid),
  UNIQUE KEY uk_client (client_id),
  KEY idx_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客户-项目映射';

-- 1) 为每个有出货的客户补一个默认项目（客户已存在则挂到同一客户下）
INSERT INTO mgm_customer_projects (customer_id, customer_name, project_id, project_name, status)
SELECT t.cust_id, t.cust_name, CONCAT('PJ-SO-', t.client_id), CONCAT(t.client_name, ' 默认项目'), 'active'
FROM (
  SELECT s.client_id, s.client_name,
         COALESCE((SELECT MIN(p.customer_id) FROM mgm_customer_projects p WHERE p.customer_name = s.client_name), s.client_id) AS cust_id,
         COALESCE((SELECT MIN(p.customer_name) FROM mgm_customer_projects p WHERE p.customer_name = s.client_name), s.client_name) AS cust_name
  FROM (
    SELECT client_id, MAX(client_name) AS client_name
    FROM ermm_erp_so
    WHERE dn_qty > 0 AND client_id IS NOT NULL AND client_id <> ''
    GROUP BY client_id
  ) s
) t
ON DUPLICATE KEY UPDATE project_name=VALUES(project_name),
    customer_id=VALUES(customer_id), customer_name=VALUES(customer_name);

-- 2) 建立客户 → 默认项目映射
INSERT INTO project_customer_map (client_id, client_name, project_id, project_name, source)
SELECT client_id, client_name, CONCAT('PJ-SO-', client_id), CONCAT(client_name, ' 默认项目'), 'seed'
FROM (
  SELECT client_id, MAX(client_name) AS client_name
  FROM ermm_erp_so
  WHERE dn_qty > 0 AND client_id IS NOT NULL AND client_id <> ''
  GROUP BY client_id
) s
ON DUPLICATE KEY UPDATE client_name=VALUES(client_name),
    project_id=VALUES(project_id), project_name=VALUES(project_name),
    source=IF(source='manual', source, 'seed');

INSERT INTO schema_migrations (version, applied_at, description) VALUES
('036_project_customer_map', NOW(), '客户-项目映射与出货客户默认项目（COO-02/CFO-06）')
ON DUPLICATE KEY UPDATE applied_at=NOW();

SELECT COUNT(*) AS mapped_clients FROM project_customer_map;
SELECT '✅ 036 客户-项目映射迁移完成' AS result;
