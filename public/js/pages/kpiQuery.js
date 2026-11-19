/**
 * 财务预警 KPI 查询（YG001~YG004）
 */

// ====== 語系輔助 ======
// 資料以 {zh,tw,en} 儲存，渲染時依目前語言解析（切換語言即時生效）
const KQ_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] ?? zh);
function KQ_T(v) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
        return v[I18N.lang] || v.zh || v['zh-CN'] || Object.values(v)[0] || '';
    }
    return v;
}

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

// ====== 類別顯示標籤（key 為簡體中文，做為 catBg / CATEGORY_DESC 查找鍵；value 為三語顯示）======
const CAT_LABELS = {
    '偿债能力':   { zh:'偿债能力',   tw:'償債能力',   en:'Solvency' },
    '营运能力':   { zh:'营运能力',   tw:'營運能力',   en:'Operating Efficiency' },
    '获利能力':   { zh:'获利能力',   tw:'獲利能力',   en:'Profitability' },
    '成长能力':   { zh:'成长能力',   tw:'成長能力',   en:'Growth' },
    'Z模型':      { zh:'Z模型',      tw:'Z模型',      en:'Z-Model' },
    'Z1模型':     { zh:'Z1模型',     tw:'Z1模型',     en:'Z1 Model' },
    'Z2模型':     { zh:'Z2模型',     tw:'Z2模型',     en:'Z2 Model' },
    'GGR模型':    { zh:'GGR模型',    tw:'GGR模型',    en:'GGR Model' },
    'BZ模型':     { zh:'BZ模型',     tw:'BZ模型',     en:'BZ-Model' },
    '巴萨模型':   { zh:'巴萨模型',   tw:'巴薩模型',   en:'Basa Model' },
    'BZ巴萨利润': { zh:'BZ巴萨利润', tw:'BZ巴薩利潤', en:'BZ/Basa Profit' },
    '利润异常':   { zh:'利润异常',   tw:'利潤異常',   en:'Profit Anomaly' },
    '资产异常':   { zh:'资产异常',   tw:'資產異常',   en:'Asset Anomaly' },
    '股东权益':   { zh:'股东权益',   tw:'股東權益',   en:"Shareholders' Equity" },
    '获利绩效':   { zh:'获利绩效',   tw:'獲利績效',   en:'Profit Performance' },
    '管理指标':   { zh:'管理指标',   tw:'管理指標',   en:'Management Metrics' },
    '业务指标':   { zh:'业务指标',   tw:'業務指標',   en:'Business Metrics' },
    '营运资产模型':{ zh:'营运资产模型',tw:'營運資產模型',en:'Working Asset Model' },
    '沃尔比重模型':{ zh:'沃尔比重模型',tw:'沃爾比重模型',en:'Wall Ratio Model' },
    'A值模型':    { zh:'A值模型',    tw:'A值模型',    en:'A-Score Model' },
    '模型分析':   { zh:'模型分析',   tw:'模型分析',   en:'Model Analysis' },
    '手工':       { zh:'手工',       tw:'手工',       en:'Manual' },
    '未分类':     { zh:'未分类',     tw:'未分類',     en:'Uncategorized' },
};
const catLabel = (k) => (CAT_LABELS[k] ? KQ_T(CAT_LABELS[k]) : k);

// ====== 页面设定 ======
const YG_CONFIG = {
    yg001: {
        title: { zh:'YG001 财务预警【KPI】指标管理', tw:'YG001 財務預警【KPI】指標管理', en:'YG001 Financial Warning — KPI Management' },
        sections: [
            { title: { zh:'偿债能力', tw:'償債能力', en:'Solvency' }, color: '#2c3e50', color2: '#3498db', rows: [
                { id: 'current_ratio', cat: '偿债能力', name: { zh:'流动比率', tw:'流動比率', en:'Current Ratio' }, low:1.5, high:3.0, pct_type:'asc' },
                { id: 'quick_ratio',   cat: '偿债能力', name: { zh:'速动比率', tw:'速動比率', en:'Quick Ratio' }, low:0.8, high:2.0, pct_type:'asc' },
                { id: 'debt_ratio',    cat: '偿债能力', name: { zh:'负债比率(%)', tw:'負債比率(%)', en:'Debt Ratio (%)' }, low:50, high:70, pct_type:'asc' },
                { id: 'cash_ratio',    cat: '偿债能力', name: { zh:'现金比率(%)', tw:'現金比率(%)', en:'Cash Ratio (%)' }, low:10, high:30, pct_type:'asc' },
                { id: 'interest_cov',  cat: '偿债能力', name: { zh:'利息保障倍数', tw:'利息保障倍數', en:'Interest Coverage' }, low:3, high:10, pct_type:'asc' },
            ]},
            { title: { zh:'营运能力', tw:'營運能力', en:'Operating Efficiency' }, color: '#2874a6', color2: '#5dade2', rows: [
                { id: 'inventory_turn', cat: '营运能力', name: { zh:'存货周转率', tw:'存貨週轉率', en:'Inventory Turnover' }, low:4, high:10, pct_type:'asc' },
                { id: 'ar_turn',        cat: '营运能力', name: { zh:'应收账款周转率', tw:'應收帳款週轉率', en:'AR Turnover' }, low:6, high:15, pct_type:'asc' },
                { id: 'ar_days',        cat: '营运能力', name: { zh:'应收账款天数', tw:'應收帳款天數', en:'AR Days' }, low:10, high:60, pct_type:'desc' },
                { id: 'total_asset_turn',cat:'营运能力',name: { zh:'总资产周转率', tw:'總資產週轉率', en:'Total Asset Turnover' }, low:0.5, high:1.5, pct_type:'asc' },
                { id: 'fixed_asset_turn',cat:'营运能力',name: { zh:'固定资产周转率', tw:'固定資產週轉率', en:'Fixed Asset Turnover' }, low:0.5, high:3, pct_type:'asc' },
            ]},
            { title: { zh:'获利 / 成长', tw:'獲利 / 成長', en:'Profitability / Growth' }, color: '#27ae60', color2: '#2ecc71', rows: [
                { id: 'gross_profit',   cat: '获利能力', name: { zh:'销售毛利率(%)', tw:'銷售毛利率(%)', en:'Gross Margin (%)' }, low:20, high:45, pct_type:'asc' },
                { id: 'net_profit_margin',cat:'获利能力',name: { zh:'销售净利率(%)', tw:'銷售淨利率(%)', en:'Net Margin (%)' }, low:5, high:20, pct_type:'asc' },
                { id: 'roa',            cat: '获利能力', name: { zh:'资产报酬率ROA(%)', tw:'資產報酬率ROA(%)', en:'ROA (%)' }, low:3, high:15, pct_type:'asc' },
                { id: 'roe',            cat: '获利能力', name: { zh:'权益报酬率ROE(%)', tw:'權益報酬率ROE(%)', en:'ROE (%)' }, low:8, high:25, pct_type:'asc' },
                { id: 'sale_growth',    cat: '成长能力', name: { zh:'销售成长率(%)', tw:'銷售成長率(%)', en:'Sales Growth (%)' }, low:-10, high:20, pct_type:'asc' },
                { id: 'profit_growth',  cat: '成长能力', name: { zh:'净利成长率(%)', tw:'淨利成長率(%)', en:'Net Profit Growth (%)' }, low:-10, high:25, pct_type:'asc' },
                { id: 'capital_growth', cat: '成长能力', name: { zh:'资本积累率(%)', tw:'資本積累率(%)', en:'Capital Accumulation (%)' }, low:1, high:10, pct_type:'asc' },
            ]},
            { title: { zh:'模型分析', tw:'模型分析', en:'Model Analysis' }, color: '#8e44ad', color2: '#bb8fce', rows: [
                { id: 'altman_z1', cat: 'Z模型', name: { zh:'Z1 值(上市公司)', tw:'Z1 值(上市公司)', en:'Z1 (Listed)' }, low:1.81, high:2.675, pct_type:'asc' },
                { id: 'altman_z2', cat: 'Z模型', name: { zh:'Z2 值(非上市)', tw:'Z2 值(非上市)', en:'Z2 (Unlisted)' }, low:1.1, high:2.9, pct_type:'asc' },
                { id: 'bach_bz',   cat: 'BZ模型',name: { zh:'BZ 值(巴赫利)', tw:'BZ 值(巴赫利)', en:'BZ (Bach)' }, low:0.5, high:5, pct_type:'asc' },
            ]},
        ]
    },

    yg002: {
        title: { zh:'YG002 财务预警【KPI】指标管理（行业对照）', tw:'YG002 財務預警【KPI】指標管理（行業對照）', en:'YG002 Financial Warning — KPI (Industry Benchmark)' },
        sections: [
            { title: { zh:'股东权益 / 获利绩效', tw:'股東權益 / 獲利績效', en:'Equity / Profitability' }, color: '#2c3e50', color2: '#2980b9', rows: [
                { id: 'roe',            cat: '股东权益', name: { zh:'ROE (%)', tw:'ROE (%)', en:'ROE (%)' }, low:5, high:20, pct_type:'asc' },
                { id: 'roa',            cat: '股东权益', name: { zh:'ROA (%)', tw:'ROA (%)', en:'ROA (%)' }, low:3, high:12, pct_type:'asc' },
                { id: 'gross_profit',   cat: '获利绩效', name: { zh:'毛利率(%)', tw:'毛利率(%)', en:'Gross Margin (%)' }, low:15, high:45, pct_type:'asc' },
                { id: 'net_profit_margin',cat:'获利绩效',name: { zh:'净利率(%)', tw:'淨利率(%)', en:'Net Margin (%)' }, low:5, high:20, pct_type:'asc' },
                { id: 'interest_cov',   cat: '获利绩效', name: { zh:'利息保障倍数', tw:'利息保障倍數', en:'Interest Coverage' }, low:3, high:10, pct_type:'asc' },
                { id: 'debt_ratio',     cat: '获利绩效', name: { zh:'负债比(%)', tw:'負債比(%)', en:'Debt Ratio (%)' }, low:50, high:70, pct_type:'asc' },
            ]},
            { title: { zh:'管理 / 业务指标', tw:'管理 / 業務指標', en:'Management / Business Metrics' }, color: '#16a085', color2: '#27ae60', rows: [
                { id: 'inventory_turn', cat: '管理指标', name: { zh:'存货周转率', tw:'存貨週轉率', en:'Inventory Turnover' }, low:4, high:12, pct_type:'asc' },
                { id: 'ar_turn',        cat: '管理指标', name: { zh:'应收账款周转率', tw:'應收帳款週轉率', en:'AR Turnover' }, low:6, high:20, pct_type:'asc' },
                { id: 'ar_days',        cat: '管理指标', name: { zh:'应收账款天数', tw:'應收帳款天數', en:'AR Days' }, low:10, high:60, pct_type:'desc' },
                { id: 'total_asset_turn',cat:'业务指标',name: { zh:'总资产周转率', tw:'總資產週轉率', en:'Total Asset Turnover' }, low:0.5, high:2.0, pct_type:'asc' },
                { id: 'equity_turn',    cat: '业务指标', name: { zh:'股东权益周转率', tw:'股東權益週轉率', en:'Equity Turnover' }, low:2, high:5, pct_type:'asc' },
                { id: 'cash_conv_days', cat: '业务指标', name: { zh:'现金周转天数', tw:'現金週轉天數', en:'Cash Conversion Cycle' }, low:0, high:60, pct_type:'desc' },
                { id: 'sale_growth',    cat: '业务指标', name: { zh:'销售成长率(%)', tw:'銷售成長率(%)', en:'Sales Growth (%)' }, low:-5, high:20, pct_type:'asc' },
                { id: 'profit_growth',  cat: '业务指标', name: { zh:'净利成长率(%)', tw:'淨利成長率(%)', en:'Net Profit Growth (%)' }, low:-10, high:25, pct_type:'asc' },
                { id: 'capital_growth', cat: '业务指标', name: { zh:'资本积累率(%)', tw:'資本積累率(%)', en:'Capital Accumulation (%)' }, low:1, high:10, pct_type:'asc' },
            ]},
        ]
    },

    yg003: {
        title: { zh:'YG003 财务预警【报表异常】甄别分析', tw:'YG003 財務預警【報表異常】甄別分析', en:'YG003 Financial Warning — Report Anomaly Detection' },
        sections: [
            { title: { zh:'资产异常', tw:'資產異常', en:'Asset Anomaly' }, color: '#c0392b', color2: '#e74c3c', rows: [
                { id: 'cash_ratio',      cat: '资产异常', name: { zh:'货币资金占比(%)', tw:'貨幣資金占比(%)', en:'Cash Ratio (%)' }, low:5, high:15, pct_type:'asc' },
                { id: 'ar_turn',         cat: '资产异常', name: { zh:'应收账款周转率', tw:'應收帳款週轉率', en:'AR Turnover' }, low:5, high:15, pct_type:'asc' },
                { id: 'ar_days',         cat: '资产异常', name: { zh:'应收账款天数', tw:'應收帳款天數', en:'AR Days' }, low:20, high:60, pct_type:'desc' },
                { id: 'inventory_turn',  cat: '资产异常', name: { zh:'存货周转率', tw:'存貨週轉率', en:'Inventory Turnover' }, low:5, high:10, pct_type:'asc' },
                { id: 'total_asset_turn',cat:'资产异常', name: { zh:'总资产周转率', tw:'總資產週轉率', en:'Total Asset Turnover' }, low:0.5, high:2, pct_type:'asc' },
                { id: 'fixed_asset_turn',cat:'资产异常',name: { zh:'固定资产周转率', tw:'固定資產週轉率', en:'Fixed Asset Turnover' }, low:1, high:5, pct_type:'asc' },
            ]},
            { title: { zh:'利润异常', tw:'利潤異常', en:'Profit Anomaly' }, color: '#d35400', color2: '#f39c12', rows: [
                { id: 'gross_profit',   cat: '利润异常', name: { zh:'毛利率(%)', tw:'毛利率(%)', en:'Gross Margin (%)' }, low:15, high:50, pct_type:'asc' },
                { id: 'net_profit_margin',cat:'利润异常',name: { zh:'净利率(%)', tw:'淨利率(%)', en:'Net Margin (%)' }, low:5, high:20, pct_type:'asc' },
                { id: 'interest_cov',   cat: '利润异常', name: { zh:'利息保障倍数', tw:'利息保障倍數', en:'Interest Coverage' }, low:2, high:10, pct_type:'asc' },
                { id: 'debt_ratio',     cat: '利润异常', name: { zh:'负债比(%)', tw:'負債比(%)', en:'Debt Ratio (%)' }, low:50, high:70, pct_type:'asc' },
                { id: 'sale_growth',    cat: '利润异常', name: { zh:'销售成长率(%)', tw:'銷售成長率(%)', en:'Sales Growth (%)' }, low:-10, high:20, pct_type:'asc' },
                { id: 'profit_growth',  cat: '利润异常', name: { zh:'净利成长率(%)', tw:'淨利成長率(%)', en:'Net Profit Growth (%)' }, low:-10, high:25, pct_type:'asc' },
            ]},
        ]
    },

    yg004: {
        title: { zh:'YG004 财务【预测模型分析】指标', tw:'YG004 財務【預測模型分析】指標', en:'YG004 Financial — Forecast Model Analysis' },
        sections: [
            { title: { zh:'Altman Z 模型', tw:'Altman Z 模型', en:'Altman Z Model' }, color: '#6c3483', color2: '#8e44ad', rows: [
                { id: 'altman_z1',  cat: 'Z1模型', name: { zh:'Z1 值(上市公司)', tw:'Z1 值(上市公司)', en:'Z1 (Listed)' }, low:1.81, high:2.675, pct_type:'desc' },
                { id: 'altman_z2',  cat: 'Z2模型', name: { zh:'Z2 值(非上市)', tw:'Z2 值(非上市)', en:'Z2 (Unlisted)' }, low:1.1, high:2.9, pct_type:'desc' },
                { id: 'altman_ggr', cat: 'GGR模型',name: { zh:'GGR 值', tw:'GGR 值', en:'GGR Value' }, low:1, high:5, pct_type:'desc' },
            ]},
            { title: { zh:'BZ / 巴萨利润模型', tw:'BZ / 巴薩利潤模型', en:'BZ / Basa Profit Model' }, color: '#1e8449', color2: '#27ae60', rows: [
                { id: 'bach_bz',           cat: 'BZ模型', name: { zh:'BZ 值(巴赫利)', tw:'BZ 值(巴赫利)', en:'BZ (Bach)' }, low:0.5, high:5, pct_type:'desc' },
                { id: 'bz_debt_ratio',     cat: '巴萨模型',name: { zh:'利润总额/流动负债(%)', tw:'利潤總額/流動負債(%)', en:'Profit / Current Liabilities (%)' }, low:2, high:8, pct_type:'desc' },
                { id: 'bz_receivable_turn',cat:'巴萨模型',name: { zh:'流动比率', tw:'流動比率', en:'Current Ratio' }, low:1.5, high:3, pct_type:'desc' },
                { id: 'bz_quick',          cat:'巴萨模型',name: { zh:'速动比率', tw:'速動比率', en:'Quick Ratio' }, low:0.8, high:2, pct_type:'desc' },
            ]},
            { title: { zh:'营运资产模型', tw:'營運資產模型', en:'Working Asset Model' }, color: '#1f618d', color2: '#2e86c1', rows: [
                { id: 'oa_working_asset', cat: '营运资产模型', name: { zh:'营运资产额(营运资本+长期投资)', tw:'營運資產額(營運資本+長期投資)', en:'Working Assets (WC + LT Investment)' }, low:0, high:0, pct_type:'desc' },
                { id: 'oa_cover_cl',      cat: '营运资产模型', name: { zh:'营运资产/流动负债', tw:'營運資產/流動負債', en:'Working Assets / Current Liabilities' }, low:0.5, high:1.0, pct_type:'desc' },
                { id: 'oa_wc_ratio',      cat: '营运资产模型', name: { zh:'营运资本比率(营运资本/流动资产)', tw:'營運資本比率(營運資本/流動資產)', en:'WC Ratio (WC / Current Assets)' }, low:0.1, high:0.3, pct_type:'desc' },
                { id: 'oa_equity_debt',   cat: '营运资产模型', name: { zh:'净值/负债总额', tw:'淨值/負債總額', en:'Net Worth / Total Liabilities' }, low:0.5, high:1.0, pct_type:'desc' },
            ]},
            { title: { zh:'沃尔比重模型 (Alexander Wall)', tw:'沃爾比重模型 (Alexander Wall)', en:'Wall Ratio Model (Alexander Wall)' }, color: '#b9770e', color2: '#f39c12', rows: [
                { id: 'wall_score', cat: '沃尔比重模型', name: { zh:'沃尔综合评分(满分100)', tw:'沃爾綜合評分(滿分100)', en:'Wall Composite Score (max 100)' }, low:80, high:100, pct_type:'desc' },
                { id: 'wall_de',    cat: '沃尔比重模型', name: { zh:'净值/负债(标准1.50)', tw:'淨值/負債(標準1.50)', en:'Net Worth / Debt (std 1.50)' }, low:1.0, high:1.5, pct_type:'desc' },
                { id: 'wall_af',    cat: '沃尔比重模型', name: { zh:'总资产/固定资产(标准2.50)', tw:'總資產/固定資產(標準2.50)', en:'Total Assets / Fixed Assets (std 2.50)' }, low:1.5, high:2.5, pct_type:'desc' },
                { id: 'wall_se',    cat: '沃尔比重模型', name: { zh:'销售额/净值(标准3.00)', tw:'銷售額/淨值(標準3.00)', en:'Sales / Net Worth (std 3.00)' }, low:2.0, high:3.0, pct_type:'desc' },
            ]},
            { title: { zh:'A值模型 (Argenti A-score)', tw:'A值模型 (Argenti A-score)', en:'A-Score Model (Argenti)' }, color: '#922b21', color2: '#c0392b', rows: [
                { id: 'a_total',      cat: 'A值模型', name: { zh:'A值-总分(>25高风险)', tw:'A值-總分(>25高風險)', en:'A-Score Total (>25 high risk)' }, low:18, high:25, pct_type:'asc' },
                { id: 'a_deficiency', cat: 'A值模型', name: { zh:'管理缺陷代理分(0~43)', tw:'管理缺陷代理分(0~43)', en:'Mgmt Deficiency Score (0~43)' }, low:10, high:20, pct_type:'asc' },
                { id: 'a_accounting', cat: 'A值模型', name: { zh:'会计错误代理分(0~15)', tw:'會計錯誤代理分(0~15)', en:'Accounting Error Score (0~15)' }, low:5, high:10, pct_type:'asc' },
                { id: 'a_symptom',    cat: 'A值模型', name: { zh:'破产征兆代理分(0~42)', tw:'破產徵兆代理分(0~42)', en:'Bankruptcy Symptom Score (0~42)' }, low:10, high:20, pct_type:'asc' },
            ]},
        ]
    },
};

// ====== 指标说明字典（用于点“预警类别”弹窗显示项目目的与公式）======
const _D = (zh, tw, en) => ({ zh, tw, en });
const KPI_DESC = {
    // --- 偿债能力 ---
    current_ratio:   { purpose:_D('衡量企业用流动资产偿还短期债务的能力','衡量企業用流動資產償還短期債務的能力','Measures the ability to repay short-term debts with current assets'),
                       formula:_D('流动资产 ÷ 流动负债','流動資產 ÷ 流動負債','Current Assets ÷ Current Liabilities'),
                       interpret:_D('≥2 为健全；<1 表示短期偿债压力大','≥2 為健全；<1 表示短期償債壓力大','≥2 is sound; <1 indicates high short-term debt pressure') },
    quick_ratio:     { purpose:_D('衡量企业用速动资产（现金+应收）偿还短期债务的能力，排除存货变现风险','衡量企業用速動資產（現金+應收）償還短期債務的能力，排除存貨變現風險','Measures ability to repay short-term debts with quick assets (cash + receivables), excluding inventory liquidity risk'),
                       formula:_D('(流动资产 − 存货) ÷ 流动负债','(流動資產 − 存貨) ÷ 流動負債','(Current Assets − Inventory) ÷ Current Liabilities'),
                       interpret:_D('≥1 为标准；<0.5 表示速动资金不足','≥1 為標準；<0.5 表示速動資金不足','≥1 is standard; <0.5 indicates insufficient quick funds') },
    debt_ratio:      { purpose:_D('衡量总资产中仰赖负债的比例，判断财务杠杆程度','衡量總資產中仰賴負債的比例，判斷財務槓桿程度','Measures the proportion of total assets financed by liabilities, indicating financial leverage'),
                       formula:_D('(短期借款 + 应付账款 + 应付税金 + 应付薪资 + 其他应付) ÷ 资产总额 × 100%','(短期借款 + 應付帳款 + 應付稅金 + 應付薪資 + 其他應付) ÷ 資產總額 × 100%','(Short-term Borrowings + AP + Taxes Payable + Salaries Payable + Other Payables) ÷ Total Assets × 100%'),
                       interpret:_D('越低越稳健；≤50% 安全，50-70% 注意，>70% 表示杠杆过高','越低越穩健；≤50% 安全，50-70% 注意，>70% 表示槓桿過高','Lower is more conservative; ≤50% safe, 50-70% caution, >70% excessive leverage') },
    interest_cov:    { purpose:_D('衡量企业利润支付利息费用的能力','衡量企業利潤支付利息費用的能力','Measures the ability of profits to cover interest expense'),
                       formula:_D('(税前利润 + 利息支出) ÷ 利息支出','(稅前利潤 + 利息支出) ÷ 利息支出','(Pretax Profit + Interest Expense) ÷ Interest Expense'),
                       interpret:_D('≥3 为安全；<1 表示利息都付不出来','≥3 為安全；<1 表示利息都付不出來','≥3 is safe; <1 means interest cannot be covered') },
    cash_ratio:      { purpose:_D('衡量企业用现金与存款直接偿还流动负债的能力，是最保守的偿债指标','衡量企業用現金與存款直接償還流動負債的能力，是最保守的償債指標','Measures the ability to repay current liabilities directly with cash and deposits; the most conservative solvency metric'),
                       formula:_D('(现金 + 银行存款) ÷ 流动负债 × 100%','(現金 + 銀行存款) ÷ 流動負債 × 100%','(Cash + Bank Deposits) ÷ Current Liabilities × 100%'),
                       interpret:_D('≥20% 为健全；<5% 表示现金吃紧','≥20% 為健全；<5% 表示現金吃緊','≥20% is sound; <5% indicates tight cash') },

    // --- 营运能力 ---
    inventory_turn:  { purpose:_D('衡量存货被销售/消耗的速度','衡量存貨被銷售/消耗的速度','Measures how quickly inventory is sold/consumed'),
                       formula:_D('销货成本 ÷ 存货总额','銷貨成本 ÷ 存貨總額','COGS ÷ Total Inventory'),
                       interpret:_D('越高表示存货周转越快、积压越少','越高表示存貨週轉越快、積壓越少','Higher means faster inventory turnover and less overstock') },
    ar_turn:         { purpose:_D('衡量应收账款回收速度','衡量應收帳款回收速度','Measures the collection speed of accounts receivable'),
                       formula:_D('销售额 ÷ 应收账款','銷售額 ÷ 應收帳款','Sales ÷ Accounts Receivable'),
                       interpret:_D('越高表示收账越快','越高表示收帳越快','Higher means faster collection') },
    ar_days:         { purpose:_D('衡量应收账款平均回收天数','衡量應收帳款平均回收天數','Measures the average collection days of accounts receivable'),
                       formula:_D('365 ÷ (销售额 ÷ 应收账款)','365 ÷ (銷售額 ÷ 應收帳款)','365 ÷ (Sales ÷ Accounts Receivable)'),
                       interpret:_D('越低越好；超过 90 天表示收账太慢','越低越好；超過 90 天表示收帳太慢','Lower is better; >90 days means collection is too slow') },
    total_asset_turn:{ purpose:_D('衡量总资产创造营业收入的效率','衡量總資產創造營業收入的效率','Measures the efficiency of total assets in generating revenue'),
                       formula:_D('销售额 ÷ 资产总额','銷售額 ÷ 資產總額','Sales ÷ Total Assets'),
                       interpret:_D('越高表示资产运用效率越好','越高表示資產運用效率越好','Higher means better asset utilization') },
    fixed_asset_turn:{ purpose:_D('衡量固定资产（厂房、设备）创造收入的效率','衡量固定資產（廠房、設備）創造收入的效率','Measures the efficiency of fixed assets (plant, equipment) in generating revenue'),
                       formula:_D('销售额 ÷ 固定资产合计','銷售額 ÷ 固定資產合計','Sales ÷ Total Fixed Assets'),
                       interpret:_D('越高表示设备利用率越高','越高表示設備利用率越高','Higher means higher equipment utilization') },
    equity_turn:     { purpose:_D('衡量股东权益创造营业收入的效率','衡量股東權益創造營業收入的效率',"Measures the efficiency of shareholders' equity in generating revenue"),
                       formula:_D('销售额 ÷ 股东权益净值','銷售額 ÷ 股東權益淨值',"Sales ÷ Net Shareholders' Equity"),
                       interpret:_D('越高表示股东资金运用效率越好','越高表示股東資金運用效率越好','Higher means better utilization of shareholder funds') },
    cash_conv_days:  { purpose:_D('衡量从支付供应商到收回客户款项的现金周期','衡量從支付供應商到收回客戶款項的現金週期','Measures the cash cycle from paying suppliers to collecting customer payments'),
                       formula:_D('存货周转天数 + 应收账款天数 − 应付账款天数','存貨週轉天數 + 應收帳款天數 − 應付帳款天數','Inventory Days + AR Days − AP Days'),
                       interpret:_D('越低越好；负值代表无需垫款','越低越好；負值代表無需墊款','Lower is better; negative means no funding needed') },

    // --- 获利能力 ---
    gross_profit:    { purpose:_D('衡量商品/服务的基本获利空间','衡量商品/服務的基本獲利空間','Measures the basic profit margin of goods/services'),
                       formula:_D('(销售额 − 销货成本) ÷ 销售额 × 100%','(銷售額 − 銷貨成本) ÷ 銷售額 × 100%','(Sales − COGS) ÷ Sales × 100%'),
                       interpret:_D('越高越好；反映产品定价与成本控制','越高越好；反映產品定價與成本控制','Higher is better; reflects pricing and cost control') },
    net_profit_margin:{purpose:_D('衡量销售额最终转化为净利的比例','衡量銷售額最終轉化為淨利的比例','Measures the proportion of sales ultimately converted to net profit'),
                       formula:_D('税后净利 ÷ 销售额 × 100%','稅後淨利 ÷ 銷售額 × 100%','Net Income ÷ Sales × 100%'),
                       interpret:_D('越高越好；反映整体获利效率','越高越好；反映整體獲利效率','Higher is better; reflects overall profitability') },
    roa:             { purpose:_D('衡量总资产创造净利的报酬率','衡量總資產創造淨利的報酬率','Measures the return on total assets from net profit'),
                       formula:_D('税后净利 ÷ 资产总额 × 100%','稅後淨利 ÷ 資產總額 × 100%','Net Income ÷ Total Assets × 100%'),
                       interpret:_D('越高越好；反映资产运用效率','越高越好；反映資產運用效率','Higher is better; reflects asset utilization') },
    roe:             { purpose:_D('衡量股东权益创造净利的报酬率（股东最关心的指标）','衡量股東權益創造淨利的報酬率（股東最關心的指標）',"Measures the return on shareholders' equity from net profit (the metric shareholders care about most)"),
                       formula:_D('税后净利 ÷ 股东权益净值 × 100%','稅後淨利 ÷ 股東權益淨值 × 100%',"Net Income ÷ Net Shareholders' Equity × 100%"),
                       interpret:_D('越高越好；一般 ≥15% 为优秀','越高越好；一般 ≥15% 為優秀','Higher is better; ≥15% is generally excellent') },

    // --- 成长能力 ---
    sale_growth:     { purpose:_D('衡量销售额较上期的成长幅度','衡量銷售額較上期的成長幅度','Measures the growth rate of sales versus the prior period'),
                       formula:_D('(本期销售额 − 前期销售额) ÷ 前期销售额 × 100%','(本期銷售額 − 前期銷售額) ÷ 前期銷售額 × 100%','(Current Sales − Prior Sales) ÷ Prior Sales × 100%'),
                       interpret:_D('正值代表成长；连续负值代表业务萎缩','正值代表成長；連續負值代表業務萎縮','Positive means growth; consecutive negatives mean business contraction') },
    profit_growth:   { purpose:_D('衡量净利较上期的成长幅度','衡量淨利較上期的成長幅度','Measures the growth rate of net profit versus the prior period'),
                       formula:_D('(本期净利 − 前期净利) ÷ |前期净利| × 100%','(本期淨利 − 前期淨利) ÷ |前期淨利| × 100%','(Current Net Profit − Prior Net Profit) ÷ |Prior Net Profit| × 100%'),
                       interpret:_D('正值代表获利成长','正值代表獲利成長','Positive means profit growth') },
    capital_growth:  { purpose:_D('衡量资本积累速度','衡量資本積累速度','Measures the speed of capital accumulation'),
                       formula:_D('(本期股本 − 前期股本) ÷ 前期股本 × 100%','(本期股本 − 前期股本) ÷ 前期股本 × 100%','(Current Capital − Prior Capital) ÷ Prior Capital × 100%'),
                       interpret:_D('正值代表增资或保留盈余积累','正值代表增資或保留盈餘積累','Positive means capital increase or retained earnings accumulation') },

    // --- Z / BZ 模型 ---
    altman_z1:       { purpose:_D('Altman Z1 模型（上市公司）— 综合预测破产几率','Altman Z1 模型（上市公司）— 綜合預測破產機率','Altman Z1 Model (listed companies) — comprehensive bankruptcy probability forecast'),
                       formula:_D('1.2×(营运资本/总资产) + 1.4×(保留盈余/总资产) + 3.3×(EBIT/总资产) + 0.6×(权益/负债市值) + 0.999×(销售额/总资产)','1.2×(營運資本/總資產) + 1.4×(保留盈餘/總資產) + 3.3×(EBIT/總資產) + 0.6×(權益/負債市值) + 0.999×(銷售額/總資產)','1.2×(Working Capital/Total Assets) + 1.4×(Retained Earnings/Total Assets) + 3.3×(EBIT/Total Assets) + 0.6×(Equity/Total Liabilities at Market) + 0.999×(Sales/Total Assets)'),
                       interpret:_D('≥2.675 安全；1.81~2.675 灰色区；<1.81 破产风险高','≥2.675 安全；1.81~2.675 灰色區；<1.81 破產風險高','≥2.675 safe; 1.81~2.675 gray zone; <1.81 high bankruptcy risk') },
    altman_z2:       { purpose:_D('Altman Z2 模型（非上市公司）— 综合预测破产几率','Altman Z2 模型（非上市公司）— 綜合預測破產機率','Altman Z2 Model (unlisted companies) — comprehensive bankruptcy probability forecast'),
                       formula:_D('6.56×(营运资本/总资产) + 3.26×(保留盈余/总资产) + 6.72×(EBIT/总资产) + 1.05×(权益/负债)','6.56×(營運資本/總資產) + 3.26×(保留盈餘/總資產) + 6.72×(EBIT/總資產) + 1.05×(權益/負債)','6.56×(Working Capital/Total Assets) + 3.26×(Retained Earnings/Total Assets) + 6.72×(EBIT/Total Assets) + 1.05×(Equity/Liabilities)'),
                       interpret:_D('≥2.9 安全；1.1~2.9 灰色区；<1.1 破产风险高','≥2.9 安全；1.1~2.9 灰色區；<1.1 破產風險高','≥2.9 safe; 1.1~2.9 gray zone; <1.1 high bankruptcy risk') },
    altman_ggr:      { purpose:_D('GGR 模型（日本学者提出）— 综合财务体质评分','GGR 模型（日本學者提出）— 綜合財務體質評分','GGR Model (proposed by Japanese scholars) — comprehensive financial health score'),
                       formula:_D('3.2×(股本+资本公积)/总资产 + 1.1×流动比率 + 1.1×(税前利润/总资产)','3.2×(股本+資本公積)/總資產 + 1.1×流動比率 + 1.1×(稅前利潤/總資產)','3.2×(Capital + Capital Reserve)/Total Assets + 1.1×Current Ratio + 1.1×(Pretax Profit/Total Assets)'),
                       interpret:_D('≥5 优良；1~5 普通；<1 有破产风险','≥5 優良；1~5 普通；<1 有破產風險','≥5 excellent; 1~5 average; <1 bankruptcy risk') },
    bach_bz:         { purpose:_D('Bach BZ 值（巴赫利模型）— 利润与资产/销售的综合比率','Bach BZ 值（巴赫利模型）— 利潤與資產/銷售的綜合比率','Bach BZ Value (Bach model) — composite ratio of profit to assets/sales'),
                       formula:_D('(EBIT/总资产) × (EBIT/销售额) × 100','(EBIT/總資產) × (EBIT/銷售額) × 100','(EBIT/Total Assets) × (EBIT/Sales) × 100'),
                       interpret:_D('≥5 健康；0.5~5 普通；<0.5 亏损边缘','≥5 健康；0.5~5 普通；<0.5 虧損邊緣','≥5 healthy; 0.5~5 average; <0.5 near loss') },

    // --- YG003 资产异常 / 利润异常 ---
    // (大部分已涵盖在上述指标，补充 YG003 特有)

    // --- 营运资产模型 ---
    oa_working_asset:{ purpose:_D('衡量企业日常营运所投入的资产规模（绝对金额）','衡量企業日常營運所投入的資產規模（絕對金額）','Measures the scale of assets invested in daily operations (absolute amount)'),
                       formula:_D('营运资本 + 长期投资 = (流动资产 − 流动负债) + 长期投资','營運資本 + 長期投資 = (流動資產 − 流動負債) + 長期投資','Working Capital + Long-term Investment = (Current Assets − Current Liabilities) + Long-term Investment'),
                       interpret:_D('正值=营运资金充足；负值=短期偿债压力大','正值=營運資金充足；負值=短期償債壓力大','Positive = sufficient working capital; negative = high short-term debt pressure') },
    oa_cover_cl:     { purpose:_D('衡量营运资产对流动负债的覆盖程度','衡量營運資產對流動負債的覆蓋程度','Measures the coverage of current liabilities by working assets'),
                       formula:_D('营运资产额 ÷ 流动负债','營運資產額 ÷ 流動負債','Working Assets ÷ Current Liabilities'),
                       interpret:_D('≥1.0 安全；<0.5 覆盖不足','≥1.0 安全；<0.5 覆蓋不足','≥1.0 safe; <0.5 insufficient coverage') },
    oa_wc_ratio:     { purpose:_D('衡量流动资产中净营运资金的占比','衡量流動資產中淨營運資金的占比','Measures the proportion of net working capital in current assets'),
                       formula:_D('营运资本 ÷ 流动资产','營運資本 ÷ 流動資產','Working Capital ÷ Current Assets'),
                       interpret:_D('≥30% 弹性充足；<10% 短期负债占比过高','≥30% 彈性充足；<10% 短期負債占比過高','≥30% sufficient flexibility; <10% excessive short-term liabilities') },
    oa_equity_debt:  { purpose:_D('衡量净值对负债的保障程度','衡量淨值對負債的保障程度','Measures the protection of liabilities by net worth'),
                       formula:_D('股东权益净值 ÷ 负债总额','股東權益淨值 ÷ 負債總額',"Net Shareholders' Equity ÷ Total Liabilities"),
                       interpret:_D('≥1.0 稳健；<0.5 杠杆过高','≥1.0 穩健；<0.5 槓桿過高','≥1.0 sound; <0.5 excessive leverage') },

    // --- 沃尔比重模型 ---
    wall_score:      { purpose:_D('Alexander Wall 综合评分（满分 100）— 7 项比率加权','Alexander Wall 綜合評分（滿分 100）— 7 項比率加權','Alexander Wall composite score (max 100) — 7 weighted ratios'),
                       formula:_D('Σ(实际比率÷标准比率×权重)，7 项含流动比率(25%)、净值/负债(25%)等','Σ(實際比率÷標準比率×權重)，7 項含流動比率(25%)、淨值/負債(25%)等','Σ(Actual Ratio ÷ Standard Ratio × Weight), 7 items including Current Ratio (25%), Net Worth/Debt (25%), etc.'),
                       interpret:_D('≥100 优良；80~100 可接受；<80 财务体质偏弱','≥100 優良；80~100 可接受；<80 財務體質偏弱','≥100 excellent; 80~100 acceptable; <80 weak financial health') },
    wall_de:         { purpose:_D('沃尔模型组件：净值/负债（标准 1.50）','沃爾模型組件：淨值/負債（標準 1.50）','Wall model component: Net Worth/Debt (standard 1.50)'),
                       formula:_D('股东权益 ÷ 负债总额','股東權益 ÷ 負債總額',"Shareholders' Equity ÷ Total Liabilities"),
                       interpret:_D('越高越好，权重 25%','越高越好，權重 25%','Higher is better, weight 25%') },
    wall_af:         { purpose:_D('沃尔模型组件：总资产/固定资产（标准 2.50）','沃爾模型組件：總資產/固定資產（標準 2.50）','Wall model component: Total Assets/Fixed Assets (standard 2.50)'),
                       formula:_D('资产总额 ÷ 固定资产合计','資產總額 ÷ 固定資產合計','Total Assets ÷ Total Fixed Assets'),
                       interpret:_D('越高越好，权重 15%','越高越好，權重 15%','Higher is better, weight 15%') },
    wall_se:         { purpose:_D('沃尔模型组件：销售额/净值（标准 3.00）','沃爾模型組件：銷售額/淨值（標準 3.00）','Wall model component: Sales/Net Worth (standard 3.00)'),
                       formula:_D('销售额 ÷ 股东权益','銷售額 ÷ 股東權益',"Sales ÷ Shareholders' Equity"),
                       interpret:_D('越高越好，权重 5%','越高越好，權重 5%','Higher is better, weight 5%') },

    // --- A值模型 ---
    a_total:         { purpose:_D('Argenti A-score — 管理缺陷+会计错误+破产征兆综合（越高越危险）','Argenti A-score — 管理缺陷+會計錯誤+破產徵兆綜合（越高越危險）','Argenti A-score — composite of management deficiency + accounting errors + bankruptcy symptoms (higher is riskier)'),
                       formula:_D('管理缺陷分(0~43) + 会计错误分(0~15) + 破产征兆分(0~42)','管理缺陷分(0~43) + 會計錯誤分(0~15) + 破產徵兆分(0~42)','Management deficiency score (0~43) + accounting error score (0~15) + bankruptcy symptom score (0~42)'),
                       interpret:_D('≤18 安全；18~25 警戒；>25 高破产风险','≤18 安全；18~25 警戒；>25 高破產風險','≤18 safe; 18~25 caution; >25 high bankruptcy risk') },
    a_deficiency:    { purpose:_D('管理缺陷代理分（杠杆过高、流动比率低、利息保障不足、ROE低、销售下滑）','管理缺陷代理分（槓桿過高、流動比率低、利息保障不足、ROE低、銷售下滑）','Management deficiency proxy score (excessive leverage, low current ratio, insufficient interest coverage, low ROE, declining sales)'),
                       formula:_D('5 项条件加总，每项触发 +8~10 分','5 項條件加總，每項觸發 +8~10 分','Sum of 5 conditions, each triggered +8~10 points'),
                       interpret:_D('越高越危险；≥20 表示管理面严重缺陷','越高越危險；≥20 表示管理面嚴重缺陷','Higher is riskier; ≥20 indicates serious management deficiency') },
    a_accounting:    { purpose:_D('会计错误代理分（现金比率过低、应收账款天数过长）','會計錯誤代理分（現金比率過低、應收帳款天數過長）','Accounting error proxy score (too-low cash ratio, too-long AR days)'),
                       formula:_D('2 项条件加总（现金比率<5% +8、应收天数>90 +7）','2 項條件加總（現金比率<5% +8、應收天數>90 +7）','Sum of 2 conditions (cash ratio <5% +8, AR days >90 +7)'),
                       interpret:_D('越高越危险；≥10 表示现金/收账有问题','越高越危險；≥10 表示現金/收帳有問題','Higher is riskier; ≥10 indicates cash/collection issues') },
    a_symptom:       { purpose:_D('破产征兆代理分（营业亏损、营运资金为负、Z2<1.1）','破產徵兆代理分（營業虧損、營運資金為負、Z2<1.1）','Bankruptcy symptom proxy score (operating loss, negative working capital, Z2<1.1)'),
                       formula:_D('3 项条件加总（各 +12~15 分）','3 項條件加總（各 +12~15 分）','Sum of 3 conditions (each +12~15 points)'),
                       interpret:_D('越高越危险；≥20 表示已出现实质破产征兆','越高越危險；≥20 表示已出現實質破產徵兆','Higher is riskier; ≥20 indicates material bankruptcy symptoms') },
};

// ====== 类别说明字典（key 為簡體中文查找鍵，value 為三語）======
const CATEGORY_DESC = {
    '偿债能力':  { purpose:_D('衡量企业用资产偿还债务的能力，分为短期（流动/速动/现金比率）与长期（负债比/利息保障）','衡量企業用資產償還債務的能力，分為短期（流動/速動/現金比率）與長期（負債比/利息保障）','Measures the ability to repay debts with assets, split into short-term (current/quick/cash ratio) and long-term (debt ratio/interest coverage)'),
                  action:_D('若偏低：筹措长期资金、延缓付款、加强收账','若偏低：籌措長期資金、延緩付款、加強收帳','If low: raise long-term funds, defer payments, strengthen collections') },
    '营运能力':  { purpose:_D('衡量企业资产的运用效率（存货卖得快不快、应收收得快不快、资产创造收入的效率）','衡量企業資產的運用效率（存貨賣得快不快、應收收得快不快、資產創造收入的效率）','Measures asset utilization efficiency (how fast inventory sells, how fast AR collects, how efficiently assets generate revenue)'),
                  action:_D('改善方向：降低存货积压、加强应收催收、提高设备利用率','改善方向：降低存貨積壓、加強應收催收、提高設備利用率','Improvement: reduce inventory buildup, strengthen AR collection, improve equipment utilization') },
    '获利能力':  { purpose:_D('衡量企业赚钱的本领 — 从毛利率（产品定价）到净利率（整体效率）到 ROE（股东报酬）','衡量企業賺錢的本領 — 從毛利率（產品定價）到淨利率（整體效率）到 ROE（股東報酬）','Measures profitability — from gross margin (pricing) to net margin (overall efficiency) to ROE (shareholder return)'),
                  action:_D('提升方向：提高售价、降低成本、控制费用、最佳化资本结构','提升方向：提高售價、降低成本、控制費用、最佳化資本結構','Improvement: raise prices, reduce costs, control expenses, optimize capital structure') },
    '成长能力':  { purpose:_D('衡量企业扩张速度 — 销售、净利、资本的年增率','衡量企業擴張速度 — 銷售、淨利、資本的年增率','Measures expansion speed — annual growth of sales, net profit, and capital'),
                  action:_D('若为负：检查市场萎缩、竞争加剧、产品老化','若為負：檢查市場萎縮、競爭加劇、產品老化','If negative: check market contraction, intensifying competition, product obsolescence') },
    'Z模型':     { purpose:_D('Altman Z1/Z2 模型 — 以多项财务比率加权综合打分，预测企业破产几率','Altman Z1/Z2 模型 — 以多項財務比率加權綜合打分，預測企業破產機率','Altman Z1/Z2 model — weighted composite score of multiple financial ratios to forecast bankruptcy probability'),
                  action:_D('Z<1.81 立即启动危机应变；1.81~2.675 改善财务结构','Z<1.81 立即啟動危機應變；1.81~2.675 改善財務結構','Z<1.81 activate crisis response immediately; 1.81~2.675 improve financial structure') },
    'Z1模型':    { purpose:_D('Altman Z1（上市公司版）— 5 项比率加权，用市值计算权益负债比','Altman Z1（上市公司版）— 5 項比率加權，用市值計算權益負債比','Altman Z1 (listed version) — 5 weighted ratios, equity/liability ratio computed at market value'),
                  action:_D('≥2.675 安全区','≥2.675 安全區','≥2.675 safe zone') },
    'Z2模型':    { purpose:_D('Altman Z2（非上市公司版）— 4 项比率加权，不需市值资料','Altman Z2（非上市公司版）— 4 項比率加權，不需市值資料','Altman Z2 (unlisted version) — 4 weighted ratios, no market value data needed'),
                  action:_D('≥2.9 安全区','≥2.9 安全區','≥2.9 safe zone') },
    'GGR模型':   { purpose:_D('日本 GGR 模型 — 以股本、流动比率、资产报酬率综合评分','日本 GGR 模型 — 以股本、流動比率、資產報酬率綜合評分','Japanese GGR model — composite score from capital, current ratio, and ROA'),
                  action:_D('≥5 优良','≥5 優良','≥5 excellent') },
    'BZ模型':    { purpose:_D('Bach BZ 值 — 以 EBIT/资产 × EBIT/销售额 综合评估获利效率','Bach BZ 值 — 以 EBIT/資產 × EBIT/銷售額 綜合評估獲利效率','Bach BZ value — evaluates profitability via EBIT/Assets × EBIT/Sales'),
                  action:_D('≥5 健康','≥5 健康','≥5 healthy') },
    '巴萨模型':  { purpose:_D('巴萨利润模型 — 以利润/负债、流动比率、速动比率综合判读财务安全','巴薩利潤模型 — 以利潤/負債、流動比率、速動比率綜合判讀財務安全','Basa profit model — judges financial safety via profit/liabilities, current ratio, quick ratio'),
                  action:_D('流动比率≥1.5、速动比率≥0.8 为安全','流動比率≥1.5、速動比率≥0.8 為安全','Current ratio ≥1.5 and quick ratio ≥0.8 are safe') },
    'BZ巴萨利润':{ purpose:_D('BZ / 巴萨利润模型 — 多项利润与偿债比率综合评分','BZ / 巴薩利潤模型 — 多項利潤與償債比率綜合評分','BZ / Basa profit model — composite score of multiple profit and solvency ratios'),
                  action:_D('各项比率若同时偏低表示财务体质弱','各項比率若同時偏低表示財務體質弱','Multiple ratios low simultaneously indicates weak financial health') },
    '利润异常':  { purpose:_D('YG003 利润异常预警 — 监控毛利率、净利率、利息保障、负债比与成长率','YG003 利潤異常預警 — 監控毛利率、淨利率、利息保障、負債比與成長率','YG003 profit anomaly alert — monitors gross margin, net margin, interest coverage, debt ratio, and growth'),
                  action:_D('任一红灯需分析获利下滑原因（售价?成本?费用?）','任一紅燈需分析獲利下滑原因（售價?成本?費用?）','Any red light requires analyzing the cause of profit decline (price? cost? expense?)') },
    '资产异常':  { purpose:_D('YG003 资产异常预警 — 监控存货、应收、固定资产的周转率异常','YG003 資產異常預警 — 監控存貨、應收、固定資產的週轉率異常','YG003 asset anomaly alert — monitors abnormal turnover of inventory, AR, and fixed assets'),
                  action:_D('存货周转低→积压；应收周转低→收账慢；固定资产周转低→设备闲置','存貨週轉低→積壓；應收週轉低→收帳慢；固定資產週轉低→設備閒置','Low inventory turnover → overstock; low AR turnover → slow collection; low fixed asset turnover → idle equipment') },
    '股东权益':  { purpose:_D('从股东角度看获利 — ROE（股东报酬率）与 ROA（资产报酬率）','從股東角度看獲利 — ROE（股東報酬率）與 ROA（資產報酬率）',"Profitability from shareholders' perspective — ROE (return on equity) and ROA (return on assets)"),
                  action:_D('ROE<8% 代表股东报酬偏低','ROE<8% 代表股東報酬偏低','ROE <8% indicates low shareholder return') },
    '获利绩效':  { purpose:_D('综合获利指标 — 毛利率、净利率、利息保障、负债比','綜合獲利指標 — 毛利率、淨利率、利息保障、負債比','Composite profitability metrics — gross margin, net margin, interest coverage, debt ratio'),
                  action:_D('多项同时红灯表示获利与杠杆均有问题','多項同時紅燈表示獲利與槓桿均有問題','Multiple simultaneous red lights indicate both profitability and leverage issues') },
    '管理指标':  { purpose:_D('内部管理效率指标 — 存货/应收周转率','內部管理效率指標 — 存貨/應收週轉率','Internal management efficiency metrics — inventory / AR turnover'),
                  action:_D('用于评估营运管理绩效','用於評估營運管理績效','Used to evaluate operational management performance') },
    '业务指标':  { purpose:_D('业务规模与成长指标 — 总资产周转、权益周转、现金周期、成长率','業務規模與成長指標 — 總資產週轉、權益週轉、現金週期、成長率','Business scale and growth metrics — total asset turnover, equity turnover, cash cycle, growth rates'),
                  action:_D('用于评估业务扩张与资金效率','用於評估業務擴張與資金效率','Used to evaluate business expansion and capital efficiency') },
    '营运资产模型':{ purpose:_D('衡量日常营运的资产规模与结构 — 营运资产额/流动负债、营运资本比率、净值/负债','衡量日常營運的資產規模與結構 — 營運資產額/流動負債、營運資本比率、淨值/負債','Measures the scale and structure of daily operating assets — working assets/current liabilities, WC ratio, net worth/liabilities'),
                  action:_D('若营运资产为负表示短期偿债有缺口，需补充营运资金','若營運資產為負表示短期償債有缺口，需補充營運資金','Negative working assets indicates a short-term solvency gap requiring additional working capital') },
    '沃尔比重模型':{ purpose:_D('Alexander Wall 1928 年提出的 7 项比率加权综合评分（满分 100）','Alexander Wall 1928 年提出的 7 項比率加權綜合評分（滿分 100）','7 weighted ratios composite score proposed by Alexander Wall in 1928 (max 100)'),
                  action:_D('<80 分逐项检查哪项比率偏离标准最多，针对性改善','<80 分逐項檢查哪項比率偏離標準最多，針對性改善','<80 points: check which ratio deviates most from standard and improve it specifically') },
    'A值模型':   { purpose:_D('Argenti A-score 破产预测 — 管理缺陷(0-43) + 会计错误(0-15) + 破产征兆(0-42)','Argenti A-score 破產預測 — 管理缺陷(0-43) + 會計錯誤(0-15) + 破產徵兆(0-42)','Argenti A-score bankruptcy forecast — management deficiency (0-43) + accounting errors (0-15) + bankruptcy symptoms (0-42)'),
                  action:_D('总分>25 高风险；逐构面检查失分原因并改善','總分>25 高風險；逐構面檢查失分原因並改善','Total >25 high risk; check loss causes by dimension and improve') },
    '模型分析':  { purpose:_D('综合预测模型分析 — Altman Z、BZ 等模型交叉验证财务体质','綜合預測模型分析 — Altman Z、BZ 等模型交叉驗證財務體質','Composite forecast model analysis — cross-validate financial health via Altman Z, BZ, etc.'),
                  action:_D('多模型同时红灯 → 高风险预警','多模型同時紅燈 → 高風險預警','Multiple models red simultaneously → high-risk alert') },
    '手工':      { purpose:_D('手动维护的 KPI（无公式对应，由使用者直接输入目标值与当前值）','手動維護的 KPI（無公式對應，由使用者直接輸入目標值與當前值）','Manually maintained KPIs (no formula, user inputs target and current values directly)'),
                  action:_D('于 KPI 门槛页面维护','於 KPI 門檻頁面維護','Maintained on the KPI threshold page') },
};

// ====== 共用 render ======
function buildYGRender(pageId) {
    const cfg = YG_CONFIG[pageId];
    return async (c) => {
        const _buAll = await CodeHelper.buSel({includeAll:true});
        c.innerHTML = `
            <div class="card">
                <div class="toolbar">
                    <label>${t('kpiQuery.toolbar.bu')}：<select id="ygBU" onchange="ygLoad('${pageId}')">
                        ${_buAll}
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
                    ${KQ_T(cfg.title)}
                </h2>
                <div id="${pageId}_body" style="display:flex;gap:16px;flex-wrap:wrap;"></div>
            </div>
        `;
        const bu = State.bu_no || '';
        const ym = State.YYYY_MM || '';
        document.getElementById('ygBU').value = bu;
        if (ym) {
            // 兼容 "2025-06"（标准）与 "2025/6"（旧格式）
            const sep = ym.includes('/') ? '/' : '-';
            const [y, m] = ym.split(sep);
            document.getElementById('ygY').value = y;
            document.getElementById('ygM').value = parseInt(m, 10);
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
        body.innerHTML = `<p style="color:#e74c3c;padding:20px;">${t('kpiQuery.load_fail')}: ${KQ_L('该月无财务摘要资料','該月無財務摘要資料','No financial summary for this month')}</p>`;
    }
};

// ====== 渲染同业标杆区间条 + vs 同业徽标 ======
function renderBenchmark(item) {
    const b = item.benchmark;
    const rank = item.vs_industry;
    if (!b || rank === null || rank === undefined) return '';
    const v = item.current_value;
    if (v === null || v === undefined || isNaN(v)) return '';

    // 区间两端：p10 ~ p90；超出两端的部分用边界截
    const p10 = b.p10, p90 = b.p90;
    const span = p90 - p10;
    if (!span || span === 0) return '';

    // 当前值在区间条上的位置百分比（0-100 对应 p10~p90），允许越界（clip 到 -10~110）
    let posPct = ((v - p10) / span) * 100;
    posPct = Math.max(-10, Math.min(110, posPct));

    // median 位置
    const medPct = ((b.median - p10) / span) * 100;

    // 区间条配色：灰渐变两端 + median 黑线 + 当前值红三角
    const barHtml = `
        <div style="position:relative;width:120px;height:14px;margin:2px 0;">
            <div style="position:absolute;left:0;top:3px;bottom:3px;background:linear-gradient(90deg,#ecf0f1 0%,#d5f5e3 25%,#d5f5e3 75%,#ecf0f1 100%);width:100%;border-radius:2px;"></div>
            <div style="position:absolute;left:${medPct}%;top:1px;bottom:1px;width:1px;background:#2c3e50;"></div>
            <div style="position:absolute;left:${posPct}%;top:-2px;transform:translateX(-50%);
                        border-left:5px solid transparent;border-right:5px solid transparent;border-top:7px solid #c0392b;"></div>
        </div>
    `;

    // vs_industry 徽标（rank 直接就是百分位，越大越优于同业）
    const rankPct = rank;
    const good = rank >= 60;
    const neutral = rank >= 40 && rank < 60;
    const vsColor = good ? '#27ae60' : (neutral ? '#f39c12' : '#e74c3c');
    const vsLabel = good ? t('kpiQuery.vs_better') : (neutral ? t('kpiQuery.vs_peer') : t('kpiQuery.vs_worse'));
    const badgeHtml = `<span style="color:${vsColor};font-weight:600;font-size:11px;">${vsLabel} ${rankPct}%</span>`;

    return `<div style="min-width:150px;">${barHtml}${badgeHtml}</div>`;
}

function renderSection(kpis, sec) {
    // 先按类别分组（让点击“预警类别”可一次看到同组所有项目）
    // cat 以簡體中文做為穩定查找鍵（catBg / CATEGORY_DESC），顯示時再轉語言
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
        const catKey = row.cat || item.category || '未分类';
        const catName = catLabel(catKey);
        // 序列化同类别的 rows 给 onclick 使用（name 保留三語物件，弹窗渲染時再解析）
        const catRowsJson = encodeURIComponent(JSON.stringify(catMap[catKey].map(r => ({
            id: r.id, name: r.name, low: r.low, high: r.high, pct_type: r.pct_type
        }))));
        return `
            <tr>
                <td style="background:${catBg[catKey] || '#eaecee'};font-weight:bold;cursor:pointer;border-bottom:1px solid rgba(0,0,0,0.1);"
                    title="${t('kpiQuery.cat.title_hint')}: ${catName}"
                    onmouseover="this.style.textDecoration='underline'"
                    onmouseout="this.style.textDecoration='none'"
                    onclick="showCategoryDetail('${catKey}', '${catRowsJson}')">${catName}</td>
                <td style="text-align:left;">${row.name ? KQ_T(row.name) : (item.name || item.id)}</td>
                ${targetCell}
                <td class="num"><b style="color:${color==='RED'?'#e74c3c':color==='YELLOW'?'#e67e22':color==='GREEN'?'#27ae60':'#333'};">${fmt(v)}</b>${item.unit?`<span style="color:#7f8c8d;font-size:11px;"> ${item.unit}</span>`:''}</td>
                <td>${dot(color)}</td>
                <td>${renderBenchmark(item)}</td>
            </tr>`;
    }).join('');

    return `
        <div style="flex:1;min-width:460px;border:1px solid #34495e;border-radius:8px;background:#fafafa;">
            <div style="background:linear-gradient(90deg,${sec.color},${sec.color2});color:#fff;padding:8px 14px;border-radius:8px 8px 0 0;font-weight:bold;letter-spacing:1px;">
                ${KQ_T(sec.title)}
            </div>
            <table class="data-table" style="margin:0;">
                <thead><tr>
                    <th style="width:90px;">${t('kpiQuery.th.category')}</th>
                    <th style="text-align:left;">${t('kpiQuery.th.name')}</th>
                    <th style="width:140px;">${t('kpiQuery.th.target')}</th>
                    <th style="width:130px;">${t('kpiQuery.th.current')}</th>
                    <th style="width:80px;">${t('kpiQuery.th.status')}</th>
                    <th style="width:190px;">${t('kpiQuery.th.benchmark')}</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

// ====== 点“预警类别”→ 显示该类别所有项目的说明与目的 ======
window.showCategoryDetail = function(catKey, catRowsJson) {
    const catRows = JSON.parse(decodeURIComponent(catRowsJson));
    const catDesc = CATEGORY_DESC[catKey] || { purpose:_D('—','—','—'), action:_D('—','—','—') };
    const catName = catLabel(catKey);

    const rowsHtml = catRows.map(r => {
        const desc = KPI_DESC[r.id];
        const pctLabel = r.pct_type === 'asc' ? t('kpiQuery.threshold_asc') : (r.pct_type === 'desc' ? t('kpiQuery.threshold_desc') : '—');
        return `
            <div style="border-left:3px solid #2980b9;padding:10px 14px;margin:12px 0;background:#fff;border-radius:0 6px 6px 0;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="font-size:1em;font-weight:bold;color:#1a5276;">📊 ${r.name ? KQ_T(r.name) : r.id}</div>
                    <div style="font-size:0.8em;color:#7f8c8d;background:#f0f3f4;padding:2px 8px;border-radius:10px;">
                        ${t('kpiQuery.threshold_label')} ${fmt(r.low)} ~ ${fmt(r.high)} · ${pctLabel}
                    </div>
                </div>
                ${desc ? `
                    <div style="margin:6px 0;"><b style="color:#2c3e50;">${t('kpiQuery.desc.purpose')}</b><span>${KQ_T(desc.purpose)}</span></div>
                    <div style="margin:4px 0;"><b style="color:#2c3e50;">${t('kpiQuery.desc.formula')}</b><code style="background:#f4f6f7;padding:2px 8px;border-radius:4px;font-size:0.92em;">${KQ_T(desc.formula)}</code></div>
                    <div style="margin:4px 0;color:#555;font-size:0.92em;">${t('kpiQuery.desc.interpret')}${KQ_T(desc.interpret)}</div>
                ` : `<div style="color:#999;font-size:0.9em;">${t('kpiQuery.desc.empty')}</div>`}
            </div>`;
    }).join('');

    UI.modal(t('kpiQuery.modal.title').replace('{cat}', catName), `
        <div style="background:#eaf2f8;border:1px solid #85c1e9;border-radius:8px;padding:14px 18px;margin-bottom:16px;">
            <div style="font-weight:bold;color:#1a5276;margin-bottom:6px;">${t('kpiQuery.modal.purpose')}</div>
            <div style="color:#2c3e50;margin-bottom:8px;">${KQ_T(catDesc.purpose)}</div>
            <div style="font-weight:bold;color:#1e8449;margin-bottom:4px;">${t('kpiQuery.modal.action')}</div>
            <div style="color:#1e8449;">${KQ_T(catDesc.action)}</div>
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
