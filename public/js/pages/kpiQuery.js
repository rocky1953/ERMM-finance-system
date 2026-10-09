/**
 * 财务预警 KPI 查询（YG001~YG004）
 */

// ====== 共用工具 ======
function dot(color) {
    const map = { GREEN: '#27ae60', YELLOW: '#f39c12', RED: '#e74c3c', GRAY: '#95a5a6' };
    const c = map[color] || map.GRAY;
    return `<span class="dot" style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${c};box-shadow:inset -2px -2px 4px rgba(0,0,0,.3);margin-right:3px;"></span>`;
}

function fmt(v, dec = 2) {
    if (v === null || v === undefined) return '-';
    const n = Number(v);
    if (isNaN(n)) return '-';
    return n.toLocaleString('zh-CN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/**
 * 点灯逻辑 — 依 DB 判定方向 pct_type (与后端一致)
 * asc  = 值高=差 → 值越低越绿
 * desc = 值低=差 → 值越高越绿
 */
function light(val, low, high, pct_type) {
    if (val === null || val === undefined || isNaN(val)) return null;
    if ((!low && !high) || low === high) return null;
    const asc = pct_type !== 'desc';

    if (asc) {
        if (val <= low)            return 'GREEN';
        if (val > high)            return 'RED';
        return 'YELLOW';
    } else {
        if (val >= high)           return 'GREEN';
        if (val < low)             return 'RED';
        return 'YELLOW';
    }
}

// 点灯逻辑：依 YG 门槛区间显示 4 色灯（理想/标准/差/很差）
function lights(v, low, midLow, midHigh, high, asc) {
    if (v === null || v === undefined || isNaN(v)) return [null,null,null,null];
    // asc = 越高越好
    if (asc) {
        // 低于 midLow = 很差 (红), midLow~low = 差 (橙), low~midHigh = 标准 (黄), midHigh~high = 好 (绿), 超过 high = 理想 (绿)
        if (v < midLow) return ['RED','RED','RED','RED'];
        if (v < low)    return ['YELLOW','RED','GRAY','GRAY'];
        if (v <= midHigh)return ['GREEN','YELLOW','GRAY','GRAY'];
        if (v <= high)  return ['GREEN','GREEN','GREEN','GREEN'];
        return ['GREEN','GREEN','GREEN','GREEN'];
    } else {
        // desc = 越低越好
        if (v > midHigh) return ['RED','RED','RED','RED'];
        if (v > high)    return ['YELLOW','RED','GRAY','GRAY'];
        if (v >= low)    return ['GREEN','YELLOW','GRAY','GRAY'];
        if (v >= midLow) return ['GREEN','GREEN','GREEN','GREEN'];
        return ['GREEN','GREEN','GREEN','GREEN'];
    }
}

// ====== 页面设定 ======
const YG_CONFIG = {
    yg001: {
        title: 'YG001 财务预警【KPI】指标管理',
        sections: [
            { title: '偿债能力', color: '#2c3e50', color2: '#3498db', rows: [
                { id: 'current_ratio', cat: '偿债能力', name: '流动比率',       low:1.5,  high:3.0, pct_type:'asc' },
                { id: 'quick_ratio',   cat: '偿债能力', name: '速动比率',       low:0.8,  high:2.0, pct_type:'asc' },
                { id: 'debt_ratio',    cat: '偿债能力', name: '负债比率(%)',    low:50,   high:70,  pct_type:'asc' },
                { id: 'cash_ratio',    cat: '偿债能力', name: '现金比率(%)',    low:10,   high:30,  pct_type:'asc' },
                { id: 'interest_cov',  cat: '偿债能力', name: '利息保障倍数',   low:3,    high:10,  pct_type:'asc' },
            ]},
            { title: '营运能力', color: '#2874a6', color2: '#5dade2', rows: [
                { id: 'inventory_turn', cat: '营运能力', name: '存货周转率', low:4,  high:10, pct_type:'asc' },
                { id: 'ar_turn',        cat: '营运能力', name: '应收账款周转率', low:6, high:15, pct_type:'asc' },
                { id: 'ar_days',        cat: '营运能力', name: '应收账款天数', low:10, high:60, pct_type:'desc' },
                { id: 'total_asset_turn',cat:'营运能力',name: '总资产周转率', low:0.5, high:1.5, pct_type:'asc' },
                { id: 'fixed_asset_turn',cat:'营运能力',name: '固定资产周转率', low:0.5, high:3, pct_type:'asc' },
            ]},
            { title: '获利 / 成长', color: '#27ae60', color2: '#2ecc71', rows: [
                { id: 'gross_profit',   cat: '获利能力', name: '销售毛利率(%)', low:20, high:45, pct_type:'asc' },
                { id: 'net_profit_margin',cat:'获利能力',name: '销售净利率(%)', low:5,  high:20, pct_type:'asc' },
                { id: 'roa',            cat: '获利能力', name: '资产报酬率ROA(%)', low:3, high:15, pct_type:'asc' },
                { id: 'roe',            cat: '获利能力', name: '权益报酬率ROE(%)', low:8, high:25, pct_type:'asc' },
                { id: 'sale_growth',    cat: '成长能力', name: '销售成长率(%)', low:-10, high:20, pct_type:'asc' },
                { id: 'profit_growth',  cat: '成长能力', name: '净利成长率(%)', low:-10, high:25, pct_type:'asc' },
                { id: 'capital_growth', cat: '成长能力', name: '资本积累率(%)', low:1,   high:10, pct_type:'asc' },
            ]},
            { title: '模型分析', color: '#8e44ad', color2: '#bb8fce', rows: [
                { id: 'altman_z1', cat: 'Z模型', name: 'Z1 值(上市公司)', low:1.81, high:2.675, pct_type:'asc' },
                { id: 'altman_z2', cat: 'Z模型', name: 'Z2 值(非上市)',   low:1.1,  high:2.9,   pct_type:'asc' },
                { id: 'bach_bz',   cat: 'BZ模型',name: 'BZ 值(巴赫利)',   low:0.5,  high:5,     pct_type:'asc' },
            ]},
        ]
    },

    yg002: {
        title: 'YG002 财务预警【KPI】指标管理（行业对照）',
        sections: [
            { title: '股东权益 / 获利绩效', color: '#2c3e50', color2: '#2980b9', rows: [
                { id: 'roe',            cat: '股东权益', name: 'ROE (%)',           low:5,  high:20, pct_type:'asc' },
                { id: 'roa',            cat: '股东权益', name: 'ROA (%)',           low:3,  high:12, pct_type:'asc' },
                { id: 'gross_profit',   cat: '获利绩效', name: '毛利率(%)',         low:15, high:45, pct_type:'asc' },
                { id: 'net_profit_margin',cat:'获利绩效',name: '净利率(%)',         low:5,  high:20, pct_type:'asc' },
                { id: 'interest_cov',   cat: '获利绩效', name: '利息保障倍数',      low:3,  high:10, pct_type:'asc' },
                { id: 'debt_ratio',     cat: '获利绩效', name: '负债比(%)',         low:50, high:70, pct_type:'asc' },
            ]},
            { title: '管理 / 业务指标', color: '#16a085', color2: '#27ae60', rows: [
                { id: 'inventory_turn', cat: '管理指标', name: '存货周转率', low:4, high:12, pct_type:'asc' },
                { id: 'ar_turn',        cat: '管理指标', name: '应收账款周转率', low:6, high:20, pct_type:'asc' },
                { id: 'ar_days',        cat: '管理指标', name: '应收账款天数', low:10, high:60, pct_type:'desc' },
                { id: 'total_asset_turn',cat:'业务指标',name: '总资产周转率', low:0.5, high:2.0, pct_type:'asc' },
                { id: 'equity_turn',    cat: '业务指标', name: '股东权益周转率', low:2,  high:5, pct_type:'asc' },
                { id: 'cash_conv_days', cat: '业务指标', name: '现金周转天数', low:0,  high:60, pct_type:'desc' },
                { id: 'sale_growth',    cat: '业务指标', name: '销售成长率(%)', low:-5, high:20, pct_type:'asc' },
                { id: 'profit_growth',  cat: '业务指标', name: '净利成长率(%)', low:-10,high:25, pct_type:'asc' },
                { id: 'capital_growth', cat: '业务指标', name: '资本积累率(%)', low:1,  high:10, pct_type:'asc' },
            ]},
        ]
    },

    yg003: {
        title: 'YG003 财务预警【报表异常】甄别分析',
        sections: [
            { title: '资产异常', color: '#c0392b', color2: '#e74c3c', rows: [
                { id: 'cash_ratio',      cat: '资产异常', name: '货币资金占比(%)',  low:5,  high:15, pct_type:'asc' },
                { id: 'ar_turn',         cat: '资产异常', name: '应收账款周转率',   low:5,  high:15, pct_type:'asc' },
                { id: 'ar_days',         cat: '资产异常', name: '应收账款天数',     low:20, high:60, pct_type:'desc' },
                { id: 'inventory_turn',  cat: '资产异常', name: '存货周转率',       low:5,  high:10, pct_type:'asc' },
                { id: 'total_asset_turn',cat:'资产异常', name: '总资产周转率',     low:0.5, high:2, pct_type:'asc' },
                { id: 'fixed_asset_turn',cat:'资产异常',name: '固定资产周转率',   low:1,  high:5,  pct_type:'asc' },
            ]},
            { title: '利润异常', color: '#d35400', color2: '#f39c12', rows: [
                { id: 'gross_profit',   cat: '利润异常', name: '毛利率(%)',        low:15, high:50, pct_type:'asc' },
                { id: 'net_profit_margin',cat:'利润异常',name: '净利率(%)',        low:5,  high:20, pct_type:'asc' },
                { id: 'interest_cov',   cat: '利润异常', name: '利息保障倍数',     low:2,  high:10, pct_type:'asc' },
                { id: 'debt_ratio',     cat: '利润异常', name: '负债比(%)',        low:50, high:70, pct_type:'asc' },
                { id: 'sale_growth',    cat: '利润异常', name: '销售成长率(%)',    low:-10,high:20, pct_type:'asc' },
                { id: 'profit_growth',  cat: '利润异常', name: '净利成长率(%)',    low:-10,high:25, pct_type:'asc' },
            ]},
        ]
    },

    yg004: {
        title: 'YG004 财务【预测模型分析】指标',
        sections: [
            { title: 'Altman Z 模型', color: '#6c3483', color2: '#8e44ad', rows: [
                { id: 'altman_z1',  cat: 'Z1模型', name: 'Z1 值(上市公司)', low:1.81, high:2.675, pct_type:'desc' },
                { id: 'altman_z2',  cat: 'Z2模型', name: 'Z2 值(非上市)',   low:1.1,  high:2.9,   pct_type:'desc' },
                { id: 'altman_ggr', cat: 'GGR模型',name: 'GGR 值',          low:1,    high:5,     pct_type:'desc' },
            ]},
            { title: 'BZ / 巴萨利润模型', color: '#1e8449', color2: '#27ae60', rows: [
                { id: 'bach_bz',           cat: 'BZ模型', name: 'BZ 值(巴赫利)',        low:0.5, high:5,  pct_type:'desc' },
                { id: 'bz_debt_ratio',     cat: '巴萨模型',name: '利润总额/流动负债(%)', low:2,  high:8,  pct_type:'desc' },
                { id: 'bz_receivable_turn',cat:'巴萨模型',name:'流动比率',              low:1.5,high:3,  pct_type:'desc' },
                { id: 'bz_quick',          cat:'巴萨模型',name:'速动比率',              low:0.8,high:2,  pct_type:'desc' },
            ]},
            { title: '营运资产模型', color: '#1f618d', color2: '#2e86c1', rows: [
                { id: 'oa_working_asset', cat: '营运资产模型', name: '营运资产额(营运资本+长期投资)', low:0,  high:0,    pct_type:'desc' },
                { id: 'oa_cover_cl',      cat: '营运资产模型', name: '营运资产/流动负债',           low:0.5,high:1.0, pct_type:'desc' },
                { id: 'oa_wc_ratio',      cat: '营运资产模型', name: '营运资本比率(营运资本/流动资产)', low:0.1,high:0.3,pct_type:'desc' },
                { id: 'oa_equity_debt',   cat: '营运资产模型', name: '净值/负债总额',               low:0.5,high:1.0, pct_type:'desc' },
            ]},
            { title: '沃尔比重模型 (Alexander Wall)', color: '#b9770e', color2: '#f39c12', rows: [
                { id: 'wall_score', cat: '沃尔比重模型', name: '沃尔综合评分(满分100)',          low:80,  high:100, pct_type:'desc' },
                { id: 'wall_de',    cat: '沃尔比重模型', name: '净值/负债(标准1.50)',           low:1.0, high:1.5, pct_type:'desc' },
                { id: 'wall_af',    cat: '沃尔比重模型', name: '总资产/固定资产(标准2.50)',      low:1.5, high:2.5, pct_type:'desc' },
                { id: 'wall_se',    cat: '沃尔比重模型', name: '销售额/净值(标准3.00)',         low:2.0, high:3.0, pct_type:'desc' },
            ]},
            { title: 'A值模型 (Argenti A-score)', color: '#922b21', color2: '#c0392b', rows: [
                { id: 'a_total',      cat: 'A值模型', name: 'A值-总分(>25高风险)',    low:18, high:25, pct_type:'asc' },
                { id: 'a_deficiency', cat: 'A值模型', name: '管理缺陷代理分(0~43)',   low:10, high:20, pct_type:'asc' },
                { id: 'a_accounting', cat: 'A值模型', name: '会计错误代理分(0~15)',   low:5,  high:10, pct_type:'asc' },
                { id: 'a_symptom',    cat: 'A值模型', name: '破产征兆代理分(0~42)',   low:10, high:20, pct_type:'asc' },
            ]},
        ]
    },
};

// ====== 指标说明字典（用于点“预警类别”弹窗显示项目目的与公式）======
const KPI_DESC = {
    // --- 偿债能力 ---
    current_ratio:   { purpose:'衡量企业用流动资产偿还短期债务的能力', formula:'流动资产 ÷ 流动负债', interpret:'≥2 为健全；<1 表示短期偿债压力大' },
    quick_ratio:     { purpose:'衡量企业用速动资产（现金+应收）偿还短期债务的能力，排除存货变现风险', formula:'(流动资产 − 存货) ÷ 流动负债', interpret:'≥1 为标准；<0.5 表示速动资金不足' },
    debt_ratio:      { purpose:'衡量总资产中仰赖负债的比例，判断财务杠杆程度', formula:'(短期借款 + 应付账款 + 应付税金 + 应付薪资 + 其他应付) ÷ 资产总额 × 100%', interpret:'越低越稳健；≤50% 安全，50-70% 注意，>70% 表示杠杆过高' },
    interest_cov:    { purpose:'衡量企业利润支付利息费用的能力', formula:'(税前利润 + 利息支出) ÷ 利息支出', interpret:'≥3 为安全；<1 表示利息都付不出来' },
    cash_ratio:      { purpose:'衡量企业用现金与存款直接偿还流动负债的能力，是最保守的偿债指标', formula:'(现金 + 银行存款) ÷ 流动负债 × 100%', interpret:'≥20% 为健全；<5% 表示现金吃紧' },

    // --- 营运能力 ---
    inventory_turn:  { purpose:'衡量存货被销售/消耗的速度', formula:'销货成本 ÷ 存货总额', interpret:'越高表示存货周转越快、积压越少' },
    ar_turn:         { purpose:'衡量应收账款回收速度', formula:'销售额 ÷ 应收账款', interpret:'越高表示收账越快' },
    ar_days:         { purpose:'衡量应收账款平均回收天数', formula:'365 ÷ (销售额 ÷ 应收账款)', interpret:'越低越好；超过 90 天表示收账太慢' },
    total_asset_turn:{ purpose:'衡量总资产创造营业收入的效率', formula:'销售额 ÷ 资产总额', interpret:'越高表示资产运用效率越好' },
    fixed_asset_turn:{ purpose:'衡量固定资产（厂房、设备）创造收入的效率', formula:'销售额 ÷ 固定资产合计', interpret:'越高表示设备利用率越高' },
    equity_turn:     { purpose:'衡量股东权益创造营业收入的效率', formula:'销售额 ÷ 股东权益净值', interpret:'越高表示股东资金运用效率越好' },
    cash_conv_days:  { purpose:'衡量从支付供应商到收回客户款项的现金周期', formula:'存货周转天数 + 应收账款天数 − 应付账款天数', interpret:'越低越好；负值代表无需垫款' },

    // --- 获利能力 ---
    gross_profit:    { purpose:'衡量商品/服务的基本获利空间', formula:'(销售额 − 销货成本) ÷ 销售额 × 100%', interpret:'越高越好；反映产品定价与成本控制' },
    net_profit_margin:{purpose:'衡量销售额最终转化为净利的比例', formula:'税后净利 ÷ 销售额 × 100%', interpret:'越高越好；反映整体获利效率' },
    roa:             { purpose:'衡量总资产创造净利的报酬率', formula:'税后净利 ÷ 资产总额 × 100%', interpret:'越高越好；反映资产运用效率' },
    roe:             { purpose:'衡量股东权益创造净利的报酬率（股东最关心的指标）', formula:'税后净利 ÷ 股东权益净值 × 100%', interpret:'越高越好；一般 ≥15% 为优秀' },

    // --- 成长能力 ---
    sale_growth:     { purpose:'衡量销售额较上期的成长幅度', formula:'(本期销售额 − 前期销售额) ÷ 前期销售额 × 100%', interpret:'正值代表成长；连续负值代表业务萎缩' },
    profit_growth:   { purpose:'衡量净利较上期的成长幅度', formula:'(本期净利 − 前期净利) ÷ |前期净利| × 100%', interpret:'正值代表获利成长' },
    capital_growth:  { purpose:'衡量资本积累速度', formula:'(本期股本 − 前期股本) ÷ 前期股本 × 100%', interpret:'正值代表增资或保留盈余积累' },

    // --- Z / BZ 模型 ---
    altman_z1:       { purpose:'Altman Z1 模型（上市公司）— 综合预测破产几率', formula:'1.2×(营运资本/总资产) + 1.4×(保留盈余/总资产) + 3.3×(EBIT/总资产) + 0.6×(权益/负债市值) + 0.999×(销售额/总资产)', interpret:'≥2.675 安全；1.81~2.675 灰色区；<1.81 破产风险高' },
    altman_z2:       { purpose:'Altman Z2 模型（非上市公司）— 综合预测破产几率', formula:'6.56×(营运资本/总资产) + 3.26×(保留盈余/总资产) + 6.72×(EBIT/总资产) + 1.05×(权益/负债)', interpret:'≥2.9 安全；1.1~2.9 灰色区；<1.1 破产风险高' },
    altman_ggr:      { purpose:'GGR 模型（日本学者提出）— 综合财务体质评分', formula:'3.2×(股本+资本公积)/总资产 + 1.1×流动比率 + 1.1×(税前利润/总资产)', interpret:'≥5 优良；1~5 普通；<1 有破产风险' },
    bach_bz:         { purpose:'Bach BZ 值（巴赫利模型）— 利润与资产/销售的综合比率', formula:'(EBIT/总资产) × (EBIT/销售额) × 100', interpret:'≥5 健康；0.5~5 普通；<0.5 亏损边缘' },

    // --- YG003 资产异常 / 利润异常 ---
    // (大部分已涵盖在上述指标，补充 YG003 特有)

    // --- 营运资产模型 ---
    oa_working_asset:{ purpose:'衡量企业日常营运所投入的资产规模（绝对金额）', formula:'营运资本 + 长期投资 = (流动资产 − 流动负债) + 长期投资', interpret:'正值=营运资金充足；负值=短期偿债压力大' },
    oa_cover_cl:     { purpose:'衡量营运资产对流动负债的覆盖程度', formula:'营运资产额 ÷ 流动负债', interpret:'≥1.0 安全；<0.5 覆盖不足' },
    oa_wc_ratio:     { purpose:'衡量流动资产中净营运资金的占比', formula:'营运资本 ÷ 流动资产', interpret:'≥30% 弹性充足；<10% 短期负债占比过高' },
    oa_equity_debt:  { purpose:'衡量净值对负债的保障程度', formula:'股东权益净值 ÷ 负债总额', interpret:'≥1.0 稳健；<0.5 杠杆过高' },

    // --- 沃尔比重模型 ---
    wall_score:      { purpose:'Alexander Wall 综合评分（满分 100）— 7 项比率加权', formula:'Σ(实际比率÷标准比率×权重)，7 项含流动比率(25%)、净值/负债(25%)等', interpret:'≥100 优良；80~100 可接受；<80 财务体质偏弱' },
    wall_de:         { purpose:'沃尔模型组件：净值/负债（标准 1.50）', formula:'股东权益 ÷ 负债总额', interpret:'越高越好，权重 25%' },
    wall_af:         { purpose:'沃尔模型组件：总资产/固定资产（标准 2.50）', formula:'资产总额 ÷ 固定资产合计', interpret:'越高越好，权重 15%' },
    wall_se:         { purpose:'沃尔模型组件：销售额/净值（标准 3.00）', formula:'销售额 ÷ 股东权益', interpret:'越高越好，权重 5%' },

    // --- A值模型 ---
    a_total:         { purpose:'Argenti A-score — 管理缺陷+会计错误+破产征兆综合（越高越危险）', formula:'管理缺陷分(0~43) + 会计错误分(0~15) + 破产征兆分(0~42)', interpret:'≤18 安全；18~25 警戒；>25 高破产风险' },
    a_deficiency:    { purpose:'管理缺陷代理分（杠杆过高、流动比率低、利息保障不足、ROE低、销售下滑）', formula:'5 项条件加总，每项触发 +8~10 分', interpret:'越高越危险；≥20 表示管理面严重缺陷' },
    a_accounting:    { purpose:'会计错误代理分（现金比率过低、应收账款天数过长）', formula:'2 项条件加总（现金比率<5% +8、应收天数>90 +7）', interpret:'越高越危险；≥10 表示现金/收账有问题' },
    a_symptom:       { purpose:'破产征兆代理分（营业亏损、营运资金为负、Z2<1.1）', formula:'3 项条件加总（各 +12~15 分）', interpret:'越高越危险；≥20 表示已出现实质破产征兆' },
};

// ====== 类别说明字典 ======
const CATEGORY_DESC = {
    '偿债能力':  { purpose:'衡量企业用资产偿还债务的能力，分为短期（流动/速动/现金比率）与长期（负债比/利息保障）', action:'若偏低：筹措长期资金、延缓付款、加强收账' },
    '营运能力':  { purpose:'衡量企业资产的运用效率（存货卖得快不快、应收收得快不快、资产创造收入的效率）', action:'改善方向：降低存货积压、加强应收催收、提高设备利用率' },
    '获利能力':  { purpose:'衡量企业赚钱的本领 — 从毛利率（产品定价）到净利率（整体效率）到 ROE（股东报酬）', action:'提升方向：提高售价、降低成本、控制费用、最佳化资本结构' },
    '成长能力':  { purpose:'衡量企业扩张速度 — 销售、净利、资本的年增率', action:'若为负：检查市场萎缩、竞争加剧、产品老化' },
    'Z模型':     { purpose:'Altman Z1/Z2 模型 — 以多项财务比率加权综合打分，预测企业破产几率', action:'Z<1.81 立即启动危机应变；1.81~2.675 改善财务结构' },
    'Z1模型':    { purpose:'Altman Z1（上市公司版）— 5 项比率加权，用市值计算权益负债比', action:'≥2.675 安全区' },
    'Z2模型':    { purpose:'Altman Z2（非上市公司版）— 4 项比率加权，不需市值资料', action:'≥2.9 安全区' },
    'GGR模型':   { purpose:'日本 GGR 模型 — 以股本、流动比率、资产报酬率综合评分', action:'≥5 优良' },
    'BZ模型':    { purpose:'Bach BZ 值 — 以 EBIT/资产 × EBIT/销售额 综合评估获利效率', action:'≥5 健康' },
    '巴萨模型':  { purpose:'巴萨利润模型 — 以利润/负债、流动比率、速动比率综合判读财务安全', action:'流动比率≥1.5、速动比率≥0.8 为安全' },
    'BZ巴萨利润':{ purpose:'BZ / 巴萨利润模型 — 多项利润与偿债比率综合评分', action:'各项比率若同时偏低表示财务体质弱' },
    '利润异常':  { purpose:'YG003 利润异常预警 — 监控毛利率、净利率、利息保障、负债比与成长率', action:'任一红灯需分析获利下滑原因（售价?成本?费用?）' },
    '资产异常':  { purpose:'YG003 资产异常预警 — 监控存货、应收、固定资产的周转率异常', action:'存货周转低→积压；应收周转低→收账慢；固定资产周转低→设备闲置' },
    '股东权益':  { purpose:'从股东角度看获利 — ROE（股东报酬率）与 ROA（资产报酬率）', action:'ROE<8% 代表股东报酬偏低' },
    '获利绩效':  { purpose:'综合获利指标 — 毛利率、净利率、利息保障、负债比', action:'多项同时红灯表示获利与杠杆均有问题' },
    '管理指标':  { purpose:'内部管理效率指标 — 存货/应收周转率', action:'用于评估营运管理绩效' },
    '业务指标':  { purpose:'业务规模与成长指标 — 总资产周转、权益周转、现金周期、成长率', action:'用于评估业务扩张与资金效率' },
    '营运资产模型':{ purpose:'衡量日常营运的资产规模与结构 — 营运资产额/流动负债、营运资本比率、净值/负债', action:'若营运资产为负表示短期偿债有缺口，需补充营运资金' },
    '沃尔比重模型':{ purpose:'Alexander Wall 1928 年提出的 7 项比率加权综合评分（满分 100）', action:'<80 分逐项检查哪项比率偏离标准最多，针对性改善' },
    'A值模型':   { purpose:'Argenti A-score 破产预测 — 管理缺陷(0-43) + 会计错误(0-15) + 破产征兆(0-42)', action:'总分>25 高风险；逐构面检查失分原因并改善' },
    '模型分析':  { purpose:'综合预测模型分析 — Altman Z、BZ 等模型交叉验证财务体质', action:'多模型同时红灯 → 高风险预警' },
    '手工':      { purpose:'手动维护的 KPI（无公式对应，由使用者直接输入目标值与当前值）', action:'于 KPI 门槛页面维护' },
};

// ====== 共用 render ======
function buildYGRender(pageId) {
    const cfg = YG_CONFIG[pageId];
    return async (c) => {
        c.innerHTML = `
            <div class="card">
                <div class="toolbar">
                    <label>${t('kpiQuery.toolbar.bu')}：<select id="ygBU" onchange="ygLoad('${pageId}')">
                        <option value="">${t('kpiQuery.toolbar.bu_placeholder')}</option>
                        <option value="HM">HM</option><option value="HN">HN</option><option value="SZ">SZ</option>
                    </select></label>
                    <label>${t('kpiQuery.toolbar.year')}：<input type="number" id="ygY" min="2000" max="2100" style="width:80px;" onchange="ygLoad('${pageId}')"></label>
                    <label>${t('kpiQuery.toolbar.month')}：<input type="number" id="ygM" min="1" max="12" style="width:60px;" onchange="ygLoad('${pageId}')"></label>
                    <button class="btn btn-success" onclick="ygLoad('${pageId}')">${t('kpiQuery.toolbar.update')}</button>
                    <button class="btn" onclick="ygShift('${pageId}',-1)">${t('kpiQuery.toolbar.prev_month')}</button>
                    <button class="btn" onclick="ygShift('${pageId}',+1)">${t('kpiQuery.toolbar.next_month')}</button>
                    <span style="color:#999;margin:0 6px;">|</span>
                    <button class="btn" onclick="ygPageShift('${pageId}',-1)">${t('kpiQuery.toolbar.prev_page')}</button>
                    <button class="btn btn-primary" onclick="ygPageShift('${pageId}',+1)">${t('kpiQuery.toolbar.next_page')}</button>
                </div>
                <h2 style="text-align:center;background:linear-gradient(90deg,#2c3e50,#3498db);color:#fff;padding:10px;border-radius:6px;margin:10px 0;">
                    ${cfg.title}
                </h2>
                <div id="${pageId}_body" style="display:flex;gap:16px;flex-wrap:wrap;"></div>
            </div>
        `;
        const bu = State.bu_no || '';
        const ym = State.YYYY_MM || '';
        document.getElementById('ygBU').value = bu;
        if (ym && ym.includes('/')) {
            const [y, m] = ym.split('/');
            document.getElementById('ygY').value = y;
            document.getElementById('ygM').value = m;
        } else {
            const now = new Date();
            document.getElementById('ygY').value = now.getFullYear();
            document.getElementById('ygM').value = now.getMonth() + 1;
        }
        await ygLoad(pageId);
    };
}

// ===== 点目标值 → 开 KPI 门槛编辑 =====
let _currentYgPage = null;

// 打开 KPI 门槛编辑视窗（复用 kpi.js 的 KpiThresholdForm）
window.openKpiThreshold = function(uid, currentValue) {
    if (typeof KpiThresholdForm === 'undefined') {
        UI.toast(t('kpiQuery.kpi_not_loaded'),'error');
        return;
    }
    window._onKpiSaved = function(kpiId) {
        // KPI 存档后，自动刷新当前 YG 页
        if (_currentYgPage) ygLoad(_currentYgPage);
    };
    KpiThresholdForm.open(uid, currentValue);
};

// ===== YG 页面载入 =====
window.ygLoad = async function(pageId) {
    _currentYgPage = pageId;
    const bu = document.getElementById('ygBU').value;
    const y = document.getElementById('ygY').value;
    const m = document.getElementById('ygM').value;
    const body = document.getElementById(pageId + '_body');
    if (!bu || !y || !m) { body.innerHTML = `<p style="color:#e74c3c;padding:20px;">${t('kpiQuery.no_bu_ym')}</p>`; return; }

    try {
        const res = await API.get(`/api/kpi-query/query?bu_no=${bu}&YYYY_MM=${y}-${String(m).padStart(2,'0')}`);
        const kpis = res.data || {};
        const cfg = YG_CONFIG[pageId];
        body.innerHTML = cfg.sections.map(s => renderSection(kpis, s)).join('');
    } catch (e) {
        body.innerHTML = `<p style="color:#e74c3c;padding:20px;">${t('kpiQuery.load_fail')}: ${e.message}</p>`;
    }
};

function renderSection(kpis, sec) {
    // 先按类别分组（让点击“预警类别”可一次看到同组所有项目）
    const catMap = {};
    sec.rows.forEach(row => {
        const cat = row.cat || '未分类';
        if (!catMap[cat]) catMap[cat] = [];
        catMap[cat].push(row);
    });

    const rows = sec.rows.map(row => {
        const item = kpis[row.id] || { id: row.id, name: row.name, current_value: null, KPI1: row.low, KPI2: row.high, unit: '' };
        const v = item.current_value;
        const low  = (item.KPI1 !== undefined && item.KPI1 !== null && item.KPI1 !== 0) ? item.KPI1 : row.low;
        const high = (item.KPI2 !== undefined && item.KPI2 !== null && item.KPI2 !== 0) ? item.KPI2 : row.high;
        const color = light(v, low, high, item.pct_type || row.pct_type);
        const targetCell = item.uid
            ? `<td class="num" style="cursor:pointer;color:#2980b9;text-decoration:underline;" title="${t('kpiQuery.target.click_hint')}" onclick="openKpiThreshold(${item.uid}, ${v !== null && v !== undefined ? v : 0})">${fmt(low)} ~ ${fmt(high)}</td>`
            : `<td class="num" style="color:#999;" title="${t('kpiQuery.target.not_defined')}">${fmt(low)} ~ ${fmt(high)}</td>`;
        const catBg = {
            '获利能力': '#fdebd0', '获利绩效': '#fdebd0',
            '营运能力': '#d6eaf8',
            '模型分析': '#e8daef', 'Z模型': '#e8daef', 'Z1模型': '#e8daef', 'Z2模型': '#e8daef', 'GGR模型': '#e8daef', 'BZ模型': '#e8daef',
            'BZ巴萨利润': '#d5f5e3', '巴萨模型': '#d5f5e3',
            '利润异常': '#fadbd8', '资产异常': '#fadbd8',
            '营运资产模型': '#d6eaf8',
            '沃尔比重模型': '#fdebd0',
            'A值模型': '#fadbd8',
        };
        const catName = row.cat || item.category || '-';
        // 序列化同类别的 rows 给 onclick 使用
        const catRowsJson = encodeURIComponent(JSON.stringify(catMap[catName].map(r => ({
            id: r.id, name: r.name, low: r.low, high: r.high, pct_type: r.pct_type
        }))));
        return `
            <tr>
                <td style="background:${catBg[catName] || '#eaecee'};font-weight:bold;cursor:pointer;border-bottom:1px solid rgba(0,0,0,0.1);"
                    title="${t('kpiQuery.cat.title_hint')}: ${catName}"
                    onmouseover="this.style.textDecoration='underline'"
                    onmouseout="this.style.textDecoration='none'"
                    onclick="showCategoryDetail('${catName}', '${catRowsJson}')">${catName}</td>
                <td style="text-align:left;">${row.name || item.name || item.id}</td>
                ${targetCell}
                <td class="num"><b style="color:${color==='RED'?'#e74c3c':color==='YELLOW'?'#e67e22':color==='GREEN'?'#27ae60':'#333'};">${fmt(v)}</b>${item.unit?`<span style="color:#7f8c8d;font-size:11px;"> ${item.unit}</span>`:''}</td>
                <td>${dot(color)}</td>
            </tr>`;
    }).join('');

    return `
        <div style="flex:1;min-width:460px;border:1px solid #34495e;border-radius:8px;background:#fafafa;">
            <div style="background:linear-gradient(90deg,${sec.color},${sec.color2});color:#fff;padding:8px 14px;border-radius:8px 8px 0 0;font-weight:bold;letter-spacing:1px;">
                ${sec.title}
            </div>
            <table class="data-table" style="margin:0;">
                <thead><tr>
                    <th style="width:90px;">${t('kpiQuery.th.category')}</th>
                    <th style="text-align:left;">${t('kpiQuery.th.name')}</th>
                    <th style="width:140px;">${t('kpiQuery.th.target')}</th>
                    <th style="width:130px;">${t('kpiQuery.th.current')}</th>
                    <th style="width:80px;">${t('kpiQuery.th.status')}</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

// ====== 点“预警类别”→ 显示该类别所有项目的说明与目的 ======
window.showCategoryDetail = function(catName, catRowsJson) {
    const catRows = JSON.parse(decodeURIComponent(catRowsJson));
    const catDesc = CATEGORY_DESC[catName] || { purpose:'—', action:'—' };

    const rowsHtml = catRows.map(r => {
        const desc = KPI_DESC[r.id];
        const pctLabel = r.pct_type === 'asc' ? t('kpiQuery.threshold_asc') : (r.pct_type === 'desc' ? t('kpiQuery.threshold_desc') : '—');
        return `
            <div style="border-left:3px solid #2980b9;padding:10px 14px;margin:12px 0;background:#fff;border-radius:0 6px 6px 0;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="font-size:1em;font-weight:bold;color:#1a5276;">📊 ${r.name || r.id}</div>
                    <div style="font-size:0.8em;color:#7f8c8d;background:#f0f3f4;padding:2px 8px;border-radius:10px;">
                        ${t('kpiQuery.threshold_label')} ${fmt(r.low)} ~ ${fmt(r.high)} · ${pctLabel}
                    </div>
                </div>
                ${desc ? `
                    <div style="margin:6px 0;"><b style="color:#2c3e50;">${t('kpiQuery.desc.purpose')}</b><span>${desc.purpose}</span></div>
                    <div style="margin:4px 0;"><b style="color:#2c3e50;">${t('kpiQuery.desc.formula')}</b><code style="background:#f4f6f7;padding:2px 8px;border-radius:4px;font-size:0.92em;">${desc.formula}</code></div>
                    <div style="margin:4px 0;color:#555;font-size:0.92em;">${t('kpiQuery.desc.interpret')}${desc.interpret}</div>
                ` : `<div style="color:#999;font-size:0.9em;">${t('kpiQuery.desc.empty')}</div>`}
            </div>`;
    }).join('');

    UI.modal(t('kpiQuery.modal.title').replace('{cat}', catName), `
        <div style="background:#eaf2f8;border:1px solid #85c1e9;border-radius:8px;padding:14px 18px;margin-bottom:16px;">
            <div style="font-weight:bold;color:#1a5276;margin-bottom:6px;">${t('kpiQuery.modal.purpose')}</div>
            <div style="color:#2c3e50;margin-bottom:8px;">${catDesc.purpose}</div>
            <div style="font-weight:bold;color:#1e8449;margin-bottom:4px;">${t('kpiQuery.modal.action')}</div>
            <div style="color:#1e8449;">${catDesc.action}</div>
        </div>
        <div style="font-weight:bold;color:#2c3e50;margin-bottom:6px;">${t('kpiQuery.modal.include').replace('{n}', catRows.length)}</div>
        ${rowsHtml}
    `, `<button class="btn" onclick="UI.closeModal()">${t('modal.close')}</button>`);
};

window.ygShift = function(pageId, delta) {
    let y = parseInt(document.getElementById('ygY').value) || 2024;
    let m = parseInt(document.getElementById('ygM').value) || 1;
    m += delta;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    document.getElementById('ygY').value = y;
    document.getElementById('ygM').value = m;
    ygLoad(pageId);
};

// KPI 上一页 / 下一页（yg001 ↔ yg002 ↔ yg003 ↔ yg004）
window.ygPageShift = function(pageId, delta) {
    const pages = Object.keys(YG_CONFIG);     // ['yg001','yg002','yg003','yg004']
    const idx = pages.indexOf(pageId);
    const next = Math.max(0, Math.min(pages.length - 1, idx + delta));
    if (next === idx) {
        UI.toast(idx === 0 ? t('kpiQuery.first_page') : t('kpiQuery.last_page'), 'info');
        return;
    }
    // 保留当前公司别 / 年 / 月到 State，让下一页预设相同
    State.bu_no = document.getElementById('ygBU').value || State.bu_no;
    const y = document.getElementById('ygY').value;
    const m = document.getElementById('ygM').value;
    if (y && m) State.YYYY_MM = `${y}-${String(m).padStart(2,'0')}`;
    navigate(pages[next]);
};

// 注册页面
for (const pageId of Object.keys(YG_CONFIG)) {
    registerPage(pageId, buildYGRender(pageId));
}
