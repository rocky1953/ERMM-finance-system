-- 040 补录 2023~2026 年 RMB 折算汇率
-- 依据系统 CURRENCY 码表 RMB 基准汇率（1.08）补齐 2023-01 ~ 2026-12 共 48 个月；
-- 如取得实际月度汇率，可在「关账 → 折算汇率」页面按月调整。

SET NAMES utf8mb4;

INSERT INTO consol_exchange_rate (YYYY_MM, currency, rate_to_twd, rate_to_usd, rate_type, source)
SELECT CONCAT(v.y, '-', LPAD(v.m, 2, '0')), 'RMB', 1.08, NULL, 'AVG', 'CURRENCY_CODE'
FROM (
    SELECT ys.y, ms.m
    FROM (
        SELECT 2023 AS y UNION ALL SELECT 2024 UNION ALL SELECT 2025 UNION ALL SELECT 2026
    ) ys
    CROSS JOIN (
        SELECT 1 AS m UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
        UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8
        UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12
    ) ms
) v
ON DUPLICATE KEY UPDATE
    rate_to_twd = VALUES(rate_to_twd),
    source      = VALUES(source);

INSERT INTO schema_migrations (version, applied_at, description) VALUES
('040_consol_rate_2023_2026', NOW(), '补录 2023~2026 年 RMB 折算汇率（1.08）')
ON DUPLICATE KEY UPDATE applied_at=NOW();

SELECT LEFT(YYYY_MM, 4) AS yr, COUNT(*) AS months,
       MIN(rate_to_twd) AS min_rate, MAX(rate_to_twd) AS max_rate
FROM consol_exchange_rate
WHERE currency='RMB' AND YYYY_MM BETWEEN '2023-01' AND '2026-12'
GROUP BY LEFT(YYYY_MM, 4)
ORDER BY yr;
