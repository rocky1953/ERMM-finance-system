-- ===== ermm_knowledge 知识库表 =====
-- 用于 AI 问答 RAG：预算摘要 / 年报 / 税务备忘 / 内部制度等结构化知识
-- 轻量 RAG：用 MySQL 全文搜索 + 关键词匹配，不用向量数据库
CREATE TABLE IF NOT EXISTS ermm_knowledge (
    uid INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(200) NOT NULL COMMENT '知识条目标题',
    content TEXT NOT NULL COMMENT '正文内容（可 Markdown）',
    category VARCHAR(50) COMMENT '分类：tax/budget/annual/policy/benchmark/other',
    bu_no VARCHAR(20) DEFAULT 'ALL' COMMENT '公司别 / ALL = 集团通用',
    year VARCHAR(10) DEFAULT NULL COMMENT '适用年度',
    YYYY_MM VARCHAR(10) DEFAULT NULL COMMENT '适用月份（可选）',
    source VARCHAR(200) COMMENT '来源：文件名 / 部门 / 录入人',
    tags VARCHAR(500) COMMENT '标签（逗号分隔）：毛利率,税负,税务筹划...',
    importance INT DEFAULT 1 COMMENT '重要性 1-5，搜索时加权',
    is_active TINYINT DEFAULT 1,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_cat (category),
    INDEX idx_bu (bu_no),
    INDEX idx_year (year),
    INDEX idx_active (is_active),
    FULLTEXT INDEX ft_content (title, content, tags)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI 问答知识库（RAG 数据源）';

-- ===== 种子数据：自动从现有财务数据生成知识条目 =====
-- 这 12 条自动生成的条目让 AI 问答立即有料可查

-- 1) HM 公司年度财务摘要（3 年）
INSERT INTO ermm_knowledge (title, content, category, bu_no, year, tags, importance, source) VALUES
('HM 2025 年财务摘要',
 'HM 公司 2025 年度关键财务指标：\n- 全年营业收入约 3.3 亿元（以 12 月累计）\n- 毛利率约 35%\n- 净利率约 9%\n- Z-score Altman 风险值约 2.49（灰色地带，需关注）\n- 负债比率约 34%\n- AR 收现天数约 34 天\n- 同业对比：制造业 2025 中位数 Z≈2.5，HM 与中位数持平',
 'annual', 'HM', '2025', '财务摘要,Altman,毛利率,净利率,负债比率', 5, 'SYSTEM-auto'),

('HM 2024 年财务摘要',
 'HM 公司 2024 年度关键财务指标：\n- 全年营业收入约 2.9 亿元\n- 毛利率约 33%\n- 净利率约 10%\n- Z-score Altman 风险值约 2.47（灰色地带）\n- 负债比率约 36%',
 'annual', 'HM', '2024', '财务摘要,Altman', 5, 'SYSTEM-auto'),

('HM 2023 年财务摘要',
 'HM 公司 2023 年度关键财务指标：\n- 全年营业收入约 1.2 亿元\n- Z-score Altman 风险值约 1.26（接近破产区，2023 年亏损约 180 万）\n- 已计提累计亏损',
 'annual', 'HM', '2023', '财务摘要,Altman,亏损', 5, 'SYSTEM-auto'),

-- 2) SZ 公司年度摘要
('SZ 2025 年财务摘要',
 'SZ 公司 2025 年度关键财务指标：\n- 营业收入约 2.1 亿元\n- Z-score Altman 风险值约 2.35（灰色地带）\n- ROE 约 4.66%\n- 负债比率约 37%\n- AR 收现天数极短约 13 天（回款迅速）',
 'annual', 'SZ', '2025', '财务摘要,Altman,ROE', 5, 'SYSTEM-auto'),

('SZ 2024 年财务摘要',
 'SZ 公司 2024 年度关键财务指标：\n- 营业收入约 2.0 亿元\n- Z-score Altman 风险值约 2.23（灰色地带）',
 'annual', 'SZ', '2024', '财务摘要,Altman', 5, 'SYSTEM-auto'),

('SZ 2023 年财务摘要',
 'SZ 公司 2023 年度关键财务指标：\n- Z-score Altman 风险值约 1.27（接近破产区，当年亏损约 120 万）',
 'annual', 'SZ', '2023', '财务摘要,Altman,亏损', 5, 'SYSTEM-auto'),

-- 3) HN 公司年度摘要
('HN 2025 年财务摘要',
 'HN 公司 2025 年度关键财务指标：\n- 营业收入约 1.4 亿元\n- Z-score Altman 风险值约 2.77（接近安全区）\n- ROE 约 4.5%\n- 负债比率约 34%\n- AR 收现天数约 12 天（批发零售业特性，回款最快）',
 'annual', 'HN', '2025', '财务摘要,Altman', 5, 'SYSTEM-auto'),

('HN 2024 年财务摘要',
 'HN 公司 2024 年度关键财务指标：\n- 营业收入约 1.3 亿元\n- Z-score Altman 风险值约 2.53（灰色地带）',
 'annual', 'HN', '2024', '财务摘要,Altman', 5, 'SYSTEM-auto'),

-- 4) 同业标杆摘要（3 年）
('制造业同业标杆 2023-2025',
 '制造业（HM/SZ 所属产业）同业关键指标中位数：\n- 毛利率 2023:26%, 2024:27%, 2025:28%\n- 净利率 2023:3%, 2024:4%, 2025:5%\n- 负债比率 2023:48%, 2024:46%, 2025:45%\n- Altman Z-score 中位数 2023:2.3, 2024:2.4, 2025:2.5\n\nHM 2025 毛利率 35% > 同业 28%（优于同业 P75 区间）\nSZ 2025 毛利率也高于同业中位数',
 'benchmark', 'ALL', '2025', '同业标杆,制造业,毛利率,Altman', 4, 'SYSTEM-benchmark'),

('批发零售业同业标杆 2023-2025',
 '批发零售业（HN 所属产业）同业关键指标中位数：\n- 毛利率 2023:18%, 2024:19%, 2025:20%\n- 净利率 2023:2%, 2024:3%, 2025:3%\n- 负债比率 2023:55%, 2024:53%, 2025:52%\n\nHN 2025 毛利率高于同业中位数约 5 个百分点',
 'benchmark', 'ALL', '2025', '同业标杆,批发零售', 4, 'SYSTEM-benchmark'),

-- 5) 税务制度备忘
('台湾营利事业所得税相关规定',
 '台湾营利事业所得税（营所税）主要规定：\n- 税率：20%（2018 年起，50 万以下获利 18%）\n- 报税期限：每年 5 月 1 日至 5 月 31 日\n- 暂缴申报：9 月\n- 可抵扣项目：折旧、坏账准备上限 1%\n- 亏损扣抵：10 年内亏损可抵消以后年度营利（条件：会计年度连续 3 年营业亏损）',
 'tax', 'ALL', NULL, '营所税,税率,报税期限,亏损扣抵', 5, 'TAX-memo'),

('两岸税务协定重点',
 '海峡两岸避免双重课税及加强税务合作协议（2015 生效）：\n- 营利事业：一方已缴所得税，另一方得予抵免\n- 个人劳务：停留 183 天以内通常不须当地缴税\n- 技术服务费：若一方为常设机构则在当地缴税\n- 投资收益（股利）：预提所得税上限 10%',
 'tax', 'ALL', NULL, '两岸税务,双重课税,抵免,常设机构', 4, 'TAX-memo');

-- ===== 读取知识库 =====
-- SELECT * FROM ermm_knowledge WHERE is_active=1 AND (bu_no='ALL' OR bu_no='HM') ORDER BY importance DESC;
