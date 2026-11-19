-- 039 补录 2026 年 RMB 折算汇率
-- 依据系统 CURRENCY 码表 RMB 基准汇率（1.08）补录 2026-01 ~ 2026-12；
-- 如取得实际月度汇率，可在「关账 → 折算汇率」页面按月调整。

SET NAMES utf8mb4;

INSERT INTO consol_exchange_rate (YYYY_MM, currency, rate_to_twd, rate_to_usd, rate_type, source)
SELECT CONCAT('2026-', LPAD(m.n, 2, '0')), 'RMB', 1.08, NULL, 'AVG', 'CURRENCY_CODE'
FROM (
    SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
    UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8
    UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12
) m
ON DUPLICATE KEY UPDATE
    rate_to_twd = VALUES(rate_to_twd),
    rate_type   = VALUES(rate_type),
    source      = VALUES(source);

INSERT INTO schema_migrations (version, applied_at, description) VALUES
('039_consol_rate_2026', NOW(), '补录 2026 年 RMB 折算汇率（1.08）')
ON DUPLICATE KEY UPDATE applied_at=NOW();

SELECT YYYY_MM, currency, rate_to_twd, rate_type, source
FROM consol_exchange_rate
WHERE YYYY_MM LIKE '2026-%' AND currency='RMB'
ORDER BY YYYY_MM;
