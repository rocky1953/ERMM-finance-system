/**
 * 財務預警 KPI 查詢（YG001~YG004）
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
 * 點燈邏輯 — 依 DB 判定方向 pct_type (與後端一致)
 * asc  = 值高=差 → 值越低越綠
 * desc = 值低=差 → 值越高越綠
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

// 點燈邏輯：依 YG 門檻區間顯示 4 色燈（理想/標準/差/很差）
function lights(v, low, midLow, midHigh, high, asc) {
    if (v === null || v === undefined || isNaN(v)) return [null,null,null,null];
    // asc = 越高越好
    if (asc) {
        // 低於 midLow = 很差 (紅), midLow~low = 差 (橙), low~midHigh = 標準 (黄), midHigh~high = 好 (綠), 超過 high = 理想 (綠)
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

// ====== 頁面設定 ======
const YG_CONFIG = {
    yg001: {
        title: 'YG001 財務預警【KPI】指標管理',
        sections: [
            { title: '償債能力', color: '#2c3e50', color2: '#3498db', rows: [
                { id: 'current_ratio', cat: '償債能力', name: '流動比率',       low:1.5,  high:3.0, pct_type:'asc' },
                { id: 'quick_ratio',   cat: '償債能力', name: '速動比率',       low:0.8,  high:2.0, pct_type:'asc' },
                { id: 'debt_ratio',    cat: '償債能力', name: '負債比率(%)',    low:50,   high:70,  pct_type:'asc' },
                { id: 'cash_ratio',    cat: '償債能力', name: '現金比率(%)',    low:10,   high:30,  pct_type:'asc' },
                { id: 'interest_cov',  cat: '償債能力', name: '利息保障倍數',   low:3,    high:10,  pct_type:'asc' },
            ]},
            { title: '營運能力', color: '#2874a6', color2: '#5dade2', rows: [
                { id: 'inventory_turn', cat: '營運能力', name: '存貨周轉率', low:4,  high:10, pct_type:'asc' },
                { id: 'ar_turn',        cat: '營運能力', name: '應收帳款周轉率', low:6, high:15, pct_type:'asc' },
                { id: 'ar_days',        cat: '營運能力', name: '應收帳款天數', low:10, high:60, pct_type:'desc' },
                { id: 'total_asset_turn',cat:'營運能力',name: '總資產周轉率', low:0.5, high:1.5, pct_type:'asc' },
                { id: 'fixed_asset_turn',cat:'營運能力',name: '固定資產周轉率', low:0.5, high:3, pct_type:'asc' },
            ]},
            { title: '獲利 / 成長', color: '#27ae60', color2: '#2ecc71', rows: [
                { id: 'gross_profit',   cat: '獲利能力', name: '銷售毛利率(%)', low:20, high:45, pct_type:'asc' },
                { id: 'net_profit_margin',cat:'獲利能力',name: '銷售淨利率(%)', low:5,  high:20, pct_type:'asc' },
                { id: 'roa',            cat: '獲利能力', name: '資產報酬率ROA(%)', low:3, high:15, pct_type:'asc' },
                { id: 'roe',            cat: '獲利能力', name: '權益報酬率ROE(%)', low:8, high:25, pct_type:'asc' },
                { id: 'sale_growth',    cat: '成長能力', name: '銷售成長率(%)', low:-10, high:20, pct_type:'asc' },
                { id: 'profit_growth',  cat: '成長能力', name: '淨利成長率(%)', low:-10, high:25, pct_type:'asc' },
                { id: 'capital_growth', cat: '成長能力', name: '資本積累率(%)', low:1,   high:10, pct_type:'asc' },
            ]},
            { title: '模型分析', color: '#8e44ad', color2: '#bb8fce', rows: [
                { id: 'altman_z1', cat: 'Z模型', name: 'Z1 值(上市公司)', low:1.81, high:2.675, pct_type:'asc' },
                { id: 'altman_z2', cat: 'Z模型', name: 'Z2 值(非上市)',   low:1.1,  high:2.9,   pct_type:'asc' },
                { id: 'bach_bz',   cat: 'BZ模型',name: 'BZ 值(巴赫利)',   low:0.5,  high:5,     pct_type:'asc' },
            ]},
        ]
    },

    yg002: {
        title: 'YG002 財務預警【KPI】指標管理（行業對照）',
        sections: [
            { title: '股東權益 / 獲利績效', color: '#2c3e50', color2: '#2980b9', rows: [
                { id: 'roe',            cat: '股東權益', name: 'ROE (%)',           low:5,  high:20, pct_type:'asc' },
                { id: 'roa',            cat: '股東權益', name: 'ROA (%)',           low:3,  high:12, pct_type:'asc' },
                { id: 'gross_profit',   cat: '獲利績效', name: '毛利率(%)',         low:15, high:45, pct_type:'asc' },
                { id: 'net_profit_margin',cat:'獲利績效',name: '淨利率(%)',         low:5,  high:20, pct_type:'asc' },
                { id: 'interest_cov',   cat: '獲利績效', name: '利息保障倍數',      low:3,  high:10, pct_type:'asc' },
                { id: 'debt_ratio',     cat: '獲利績效', name: '負債比(%)',         low:50, high:70, pct_type:'asc' },
            ]},
            { title: '管理 / 業務指標', color: '#16a085', color2: '#27ae60', rows: [
                { id: 'inventory_turn', cat: '管理指標', name: '存貨周轉率', low:4, high:12, pct_type:'asc' },
                { id: 'ar_turn',        cat: '管理指標', name: '應收帳款周轉率', low:6, high:20, pct_type:'asc' },
                { id: 'ar_days',        cat: '管理指標', name: '應收帳款天數', low:10, high:60, pct_type:'desc' },
                { id: 'total_asset_turn',cat:'業務指標',name: '總資產周轉率', low:0.5, high:2.0, pct_type:'asc' },
                { id: 'equity_turn',    cat: '業務指標', name: '股東權益周轉率', low:2,  high:5, pct_type:'asc' },
                { id: 'cash_conv_days', cat: '業務指標', name: '現金周轉天數', low:0,  high:60, pct_type:'desc' },
                { id: 'sale_growth',    cat: '業務指標', name: '銷售成長率(%)', low:-5, high:20, pct_type:'asc' },
                { id: 'profit_growth',  cat: '業務指標', name: '淨利成長率(%)', low:-10,high:25, pct_type:'asc' },
                { id: 'capital_growth', cat: '業務指標', name: '資本積累率(%)', low:1,  high:10, pct_type:'asc' },
            ]},
        ]
    },

    yg003: {
        title: 'YG003 財務預警【報表異常】甄別分析',
        sections: [
            { title: '資產異常', color: '#c0392b', color2: '#e74c3c', rows: [
                { id: 'cash_ratio',      cat: '資產異常', name: '貨幣資金佔比(%)',  low:5,  high:15, pct_type:'asc' },
                { id: 'ar_turn',         cat: '資產異常', name: '應收帳款周轉率',   low:5,  high:15, pct_type:'asc' },
                { id: 'ar_days',         cat: '資產異常', name: '應收帳款天數',     low:20, high:60, pct_type:'desc' },
                { id: 'inventory_turn',  cat: '資產異常', name: '存貨周轉率',       low:5,  high:10, pct_type:'asc' },
                { id: 'total_asset_turn',cat:'資產異常', name: '總資產周轉率',     low:0.5, high:2, pct_type:'asc' },
                { id: 'fixed_asset_turn',cat:'資產異常',name: '固定資產周轉率',   low:1,  high:5,  pct_type:'asc' },
            ]},
            { title: '利潤異常', color: '#d35400', color2: '#f39c12', rows: [
                { id: 'gross_profit',   cat: '利潤異常', name: '毛利率(%)',        low:15, high:50, pct_type:'asc' },
                { id: 'net_profit_margin',cat:'利潤異常',name: '淨利率(%)',        low:5,  high:20, pct_type:'asc' },
                { id: 'interest_cov',   cat: '利潤異常', name: '利息保障倍數',     low:2,  high:10, pct_type:'asc' },
                { id: 'debt_ratio',     cat: '利潤異常', name: '負債比(%)',        low:50, high:70, pct_type:'asc' },
                { id: 'sale_growth',    cat: '利潤異常', name: '銷售成長率(%)',    low:-10,high:20, pct_type:'asc' },
                { id: 'profit_growth',  cat: '利潤異常', name: '淨利成長率(%)',    low:-10,high:25, pct_type:'asc' },
            ]},
        ]
    },

    yg004: {
        title: 'YG004 財務【預測模型分析】指標',
        sections: [
            { title: 'Altman Z 模型', color: '#6c3483', color2: '#8e44ad', rows: [
                { id: 'altman_z1',  cat: 'Z1模型', name: 'Z1 值(上市公司)', low:1.81, high:2.675, pct_type:'desc' },
                { id: 'altman_z2',  cat: 'Z2模型', name: 'Z2 值(非上市)',   low:1.1,  high:2.9,   pct_type:'desc' },
                { id: 'altman_ggr', cat: 'GGR模型',name: 'GGR 值',          low:1,    high:5,     pct_type:'desc' },
            ]},
            { title: 'BZ / 巴萨利潤模型', color: '#1e8449', color2: '#27ae60', rows: [
                { id: 'bach_bz',           cat: 'BZ模型', name: 'BZ 值(巴赫利)',        low:0.5, high:5,  pct_type:'desc' },
                { id: 'bz_debt_ratio',     cat: '巴萨模型',name: '利潤總額/流動負債(%)', low:2,  high:8,  pct_type:'desc' },
                { id: 'bz_receivable_turn',cat:'巴萨模型',name:'流動比率',              low:1.5,high:3,  pct_type:'desc' },
                { id: 'bz_quick',          cat:'巴萨模型',name:'速動比率',              low:0.8,high:2,  pct_type:'desc' },
            ]},
            { title: '營運資產模型', color: '#1f618d', color2: '#2e86c1', rows: [
                { id: 'oa_working_asset', cat: '營運資產模型', name: '營運資產額(營運資本+長期投資)', low:0,  high:0,    pct_type:'desc' },
                { id: 'oa_cover_cl',      cat: '營運資產模型', name: '營運資產/流動負債',           low:0.5,high:1.0, pct_type:'desc' },
                { id: 'oa_wc_ratio',      cat: '營運資產模型', name: '營運資本比率(營運資本/流動資產)', low:0.1,high:0.3,pct_type:'desc' },
                { id: 'oa_equity_debt',   cat: '營運資產模型', name: '淨值/負債總額',               low:0.5,high:1.0, pct_type:'desc' },
            ]},
            { title: '沃爾比重模型 (Alexander Wall)', color: '#b9770e', color2: '#f39c12', rows: [
                { id: 'wall_score', cat: '沃爾比重模型', name: '沃爾綜合評分(滿分100)',          low:80,  high:100, pct_type:'desc' },
                { id: 'wall_de',    cat: '沃爾比重模型', name: '淨值/負債(標準1.50)',           low:1.0, high:1.5, pct_type:'desc' },
                { id: 'wall_af',    cat: '沃爾比重模型', name: '總資產/固定資產(標準2.50)',      low:1.5, high:2.5, pct_type:'desc' },
                { id: 'wall_se',    cat: '沃爾比重模型', name: '銷售額/淨值(標準3.00)',         low:2.0, high:3.0, pct_type:'desc' },
            ]},
            { title: 'A值模型 (Argenti A-score)', color: '#922b21', color2: '#c0392b', rows: [
                { id: 'a_total',      cat: 'A值模型', name: 'A值-總分(>25高風險)',    low:18, high:25, pct_type:'asc' },
                { id: 'a_deficiency', cat: 'A值模型', name: '管理缺陷代理分(0~43)',   low:10, high:20, pct_type:'asc' },
                { id: 'a_accounting', cat: 'A值模型', name: '會計錯誤代理分(0~15)',   low:5,  high:10, pct_type:'asc' },
                { id: 'a_symptom',    cat: 'A值模型', name: '破產徵兆代理分(0~42)',   low:10, high:20, pct_type:'asc' },
            ]},
        ]
    },
};

// ====== 指標說明字典（用於點「預警類別」彈窗顯示項目目的與公式）======
const KPI_DESC = {
    // --- 償債能力 ---
    current_ratio:   { purpose:'衡量企業用流動資產償還短期債務的能力', formula:'流動資產 ÷ 流動負債', interpret:'≥2 為健全；<1 表示短期償債壓力大' },
    quick_ratio:     { purpose:'衡量企業用速動資產（現金+應收）償還短期債務的能力，排除存貨變現風險', formula:'(流動資產 − 存貨) ÷ 流動負債', interpret:'≥1 為標準；<0.5 表示速動資金不足' },
    debt_ratio:      { purpose:'衡量總資產中仰賴負債的比例，判斷財務槓桿程度', formula:'(短期借款 + 應付帳款 + 應付稅金 + 應付薪資 + 其他應付) ÷ 資產總額 × 100%', interpret:'越低越穩健；≤50% 安全，50-70% 注意，>70% 表示槓桿過高' },
    interest_cov:    { purpose:'衡量企業利潤支付利息費用的能力', formula:'(稅前利潤 + 利息支出) ÷ 利息支出', interpret:'≥3 為安全；<1 表示利息都付不出來' },
    cash_ratio:      { purpose:'衡量企業用現金與存款直接償還流動負債的能力，是最保守的償債指標', formula:'(現金 + 銀行存款) ÷ 流動負債 × 100%', interpret:'≥20% 為健全；<5% 表示現金吃緊' },

    // --- 營運能力 ---
    inventory_turn:  { purpose:'衡量存貨被銷售/消耗的速度', formula:'銷貨成本 ÷ 存貨總額', interpret:'越高表示存貨週轉越快、積壓越少' },
    ar_turn:         { purpose:'衡量應收帳款回收速度', formula:'銷售額 ÷ 應收帳款', interpret:'越高表示收帳越快' },
    ar_days:         { purpose:'衡量應收帳款平均回收天數', formula:'365 ÷ (銷售額 ÷ 應收帳款)', interpret:'越低越好；超過 90 天表示收帳太慢' },
    total_asset_turn:{ purpose:'衡量總資產創造營業收入的效率', formula:'銷售額 ÷ 資產總額', interpret:'越高表示資產運用效率越好' },
    fixed_asset_turn:{ purpose:'衡量固定資產（廠房、設備）創造收入的效率', formula:'銷售額 ÷ 固定資產合計', interpret:'越高表示設備利用率越高' },
    equity_turn:     { purpose:'衡量股東權益創造營業收入的效率', formula:'銷售額 ÷ 股東權益淨值', interpret:'越高表示股東資金運用效率越好' },
    cash_conv_days:  { purpose:'衡量從支付供應商到收回客戶款項的現金週期', formula:'存貨週轉天數 + 應收帳款天數 − 應付帳款天數', interpret:'越低越好；負值代表無需墊款' },

    // --- 獲利能力 ---
    gross_profit:    { purpose:'衡量商品/服務的基本獲利空間', formula:'(銷售額 − 銷貨成本) ÷ 銷售額 × 100%', interpret:'越高越好；反映產品定價與成本控制' },
    net_profit_margin:{purpose:'衡量銷售額最終轉化為淨利的比例', formula:'稅後淨利 ÷ 銷售額 × 100%', interpret:'越高越好；反映整體獲利效率' },
    roa:             { purpose:'衡量總資產創造淨利的報酬率', formula:'稅後淨利 ÷ 資產總額 × 100%', interpret:'越高越好；反映資產運用效率' },
    roe:             { purpose:'衡量股東權益創造淨利的報酬率（股東最關心的指標）', formula:'稅後淨利 ÷ 股東權益淨值 × 100%', interpret:'越高越好；一般 ≥15% 為優秀' },

    // --- 成長能力 ---
    sale_growth:     { purpose:'衡量銷售額較上期的成長幅度', formula:'(本期銷售額 − 前期銷售額) ÷ 前期銷售額 × 100%', interpret:'正值代表成長；連續負值代表業務萎縮' },
    profit_growth:   { purpose:'衡量淨利較上期的成長幅度', formula:'(本期淨利 − 前期淨利) ÷ |前期淨利| × 100%', interpret:'正值代表獲利成長' },
    capital_growth:  { purpose:'衡量資本積累速度', formula:'(本期股本 − 前期股本) ÷ 前期股本 × 100%', interpret:'正值代表增資或保留盈餘積累' },

    // --- Z / BZ 模型 ---
    altman_z1:       { purpose:'Altman Z1 模型（上市公司）— 綜合預測破產機率', formula:'1.2×(營運資本/總資產) + 1.4×(保留盈餘/總資產) + 3.3×(EBIT/總資產) + 0.6×(權益/負債市值) + 0.999×(銷售額/總資產)', interpret:'≥2.675 安全；1.81~2.675 灰色區；<1.81 破產風險高' },
    altman_z2:       { purpose:'Altman Z2 模型（非上市公司）— 綜合預測破產機率', formula:'6.56×(營運資本/總資產) + 3.26×(保留盈餘/總資產) + 6.72×(EBIT/總資產) + 1.05×(權益/負債)', interpret:'≥2.9 安全；1.1~2.9 灰色區；<1.1 破產風險高' },
    altman_ggr:      { purpose:'GGR 模型（日本學者提出）— 綜合財務體質評分', formula:'3.2×(股本+資本公積)/總資產 + 1.1×流動比率 + 1.1×(稅前利潤/總資產)', interpret:'≥5 優良；1~5 普通；<1 有破產風險' },
    bach_bz:         { purpose:'Bach BZ 值（巴赫利模型）— 利潤與資產/銷售的綜合比率', formula:'(EBIT/總資產) × (EBIT/銷售額) × 100', interpret:'≥5 健康；0.5~5 普通；<0.5 虧損邊緣' },

    // --- YG003 資產異常 / 利潤異常 ---
    // (大部分已涵蓋在上述指標，補充 YG003 特有)

    // --- 營運資產模型 ---
    oa_working_asset:{ purpose:'衡量企業日常營運所投入的資產規模（絕對金額）', formula:'營運資本 + 長期投資 = (流動資產 − 流動負債) + 長期投資', interpret:'正值=營運資金充足；負值=短期償債壓力大' },
    oa_cover_cl:     { purpose:'衡量營運資產對流動負債的覆蓋程度', formula:'營運資產額 ÷ 流動負債', interpret:'≥1.0 安全；<0.5 覆蓋不足' },
    oa_wc_ratio:     { purpose:'衡量流動資產中淨營運資金的佔比', formula:'營運資本 ÷ 流動資產', interpret:'≥30% 彈性充足；<10% 短期負債占比過高' },
    oa_equity_debt:  { purpose:'衡量淨值對負債的保障程度', formula:'股東權益淨值 ÷ 負債總額', interpret:'≥1.0 穩健；<0.5 槓桿過高' },

    // --- 沃爾比重模型 ---
    wall_score:      { purpose:'Alexander Wall 綜合評分（滿分 100）— 7 項比率加權', formula:'Σ(實際比率÷標準比率×權重)，7 項含流動比率(25%)、淨值/負債(25%)等', interpret:'≥100 優良；80~100 可接受；<80 財務體質偏弱' },
    wall_de:         { purpose:'沃爾模型組件：淨值/負債（標準 1.50）', formula:'股東權益 ÷ 負債總額', interpret:'越高越好，權重 25%' },
    wall_af:         { purpose:'沃爾模型組件：總資產/固定資產（標準 2.50）', formula:'資產總額 ÷ 固定資產合計', interpret:'越高越好，權重 15%' },
    wall_se:         { purpose:'沃爾模型組件：銷售額/淨值（標準 3.00）', formula:'銷售額 ÷ 股東權益', interpret:'越高越好，權重 5%' },

    // --- A值模型 ---
    a_total:         { purpose:'Argenti A-score — 管理缺陷+會計錯誤+破產徵兆綜合（越高越危險）', formula:'管理缺陷分(0~43) + 會計錯誤分(0~15) + 破產徵兆分(0~42)', interpret:'≤18 安全；18~25 警戒；>25 高破產風險' },
    a_deficiency:    { purpose:'管理缺陷代理分（槓桿過高、流動比率低、利息保障不足、ROE低、銷售下滑）', formula:'5 項條件加總，每項觸發 +8~10 分', interpret:'越高越危險；≥20 表示管理面嚴重缺陷' },
    a_accounting:    { purpose:'會計錯誤代理分（現金比率過低、應收帳款天數過長）', formula:'2 項條件加總（現金比率<5% +8、應收天數>90 +7）', interpret:'越高越危險；≥10 表示現金/收帳有問題' },
    a_symptom:       { purpose:'破產徵兆代理分（營業虧損、營運資金為負、Z2<1.1）', formula:'3 項條件加總（各 +12~15 分）', interpret:'越高越危險；≥20 表示已出現實質破產徵兆' },
};

// ====== 類別說明字典 ======
const CATEGORY_DESC = {
    '償債能力':  { purpose:'衡量企業用資產償還債務的能力，分為短期（流動/速動/現金比率）與長期（負債比/利息保障）', action:'若偏低：籌措長期資金、延緩付款、加強收帳' },
    '營運能力':  { purpose:'衡量企業資產的運用效率（存貨賣得快不快、應收收得快不快、資產創造收入的效率）', action:'改善方向：降低存貨積壓、加強應收催收、提高設備利用率' },
    '獲利能力':  { purpose:'衡量企業賺錢的本領 — 從毛利率（產品定價）到淨利率（整體效率）到 ROE（股東報酬）', action:'提升方向：提高售價、降低成本、控制費用、最佳化資本結構' },
    '成長能力':  { purpose:'衡量企業擴張速度 — 銷售、淨利、資本的年增率', action:'若為負：檢查市場萎縮、競爭加劇、產品老化' },
    'Z模型':     { purpose:'Altman Z1/Z2 模型 — 以多項財務比率加權綜合打分，預測企業破產機率', action:'Z<1.81 立即啟動危機應變；1.81~2.675 改善財務結構' },
    'Z1模型':    { purpose:'Altman Z1（上市公司版）— 5 項比率加權，用市值計算權益負債比', action:'≥2.675 安全區' },
    'Z2模型':    { purpose:'Altman Z2（非上市公司版）— 4 項比率加權，不需市值資料', action:'≥2.9 安全區' },
    'GGR模型':   { purpose:'日本 GGR 模型 — 以股本、流動比率、資產報酬率綜合評分', action:'≥5 優良' },
    'BZ模型':    { purpose:'Bach BZ 值 — 以 EBIT/資產 × EBIT/銷售額 綜合評估獲利效率', action:'≥5 健康' },
    '巴萨模型':  { purpose:'巴薩利潤模型 — 以利潤/負債、流動比率、速動比率綜合判讀財務安全', action:'流動比率≥1.5、速動比率≥0.8 為安全' },
    'BZ巴萨利润':{ purpose:'BZ / 巴薩利潤模型 — 多項利潤與償債比率綜合評分', action:'各項比率若同時偏低表示財務體質弱' },
    '利潤異常':  { purpose:'YG003 利潤異常預警 — 監控毛利率、淨利率、利息保障、負債比與成長率', action:'任一紅燈需分析獲利下滑原因（售價?成本?費用?）' },
    '資產異常':  { purpose:'YG003 資產異常預警 — 監控存貨、應收、固定資產的週轉率異常', action:'存貨週轉低→積壓；應收週轉低→收帳慢；固定資產週轉低→設備閒置' },
    '股東權益':  { purpose:'從股東角度看獲利 — ROE（股東報酬率）與 ROA（資產報酬率）', action:'ROE<8% 代表股東報酬偏低' },
    '獲利績效':  { purpose:'綜合獲利指標 — 毛利率、淨利率、利息保障、負債比', action:'多項同時紅燈表示獲利與槓桿均有問題' },
    '管理指標':  { purpose:'內部管理效率指標 — 存貨/應收週轉率', action:'用於評估營運管理績效' },
    '業務指標':  { purpose:'業務規模與成長指標 — 總資產週轉、權益週轉、現金週期、成長率', action:'用於評估業務擴張與資金效率' },
    '營運資產模型':{ purpose:'衡量日常營運的資產規模與結構 — 營運資產額/流動負債、營運資本比率、淨值/負債', action:'若營運資產為負表示短期償債有缺口，需補充營運資金' },
    '沃爾比重模型':{ purpose:'Alexander Wall 1928 年提出的 7 項比率加權綜合評分（滿分 100）', action:'<80 分逐項檢查哪項比率偏離標準最多，針對性改善' },
    'A值模型':   { purpose:'Argenti A-score 破產預測 — 管理缺陷(0-43) + 會計錯誤(0-15) + 破產徵兆(0-42)', action:'總分>25 高風險；逐構面檢查失分原因並改善' },
    '模型分析':  { purpose:'綜合預測模型分析 — Altman Z、BZ 等模型交叉驗證財務體質', action:'多模型同時紅燈 → 高風險預警' },
    '手工':      { purpose:'手動維護的 KPI（無公式對應，由使用者直接輸入目標值與當前值）', action:'於 KPI 門檻頁面維護' },
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

// ===== 點目標值 → 開 KPI 門檻編輯 =====
let _currentYgPage = null;

// 打開 KPI 門檻編輯視窗（複用 kpi.js 的 KpiThresholdForm）
window.openKpiThreshold = function(uid, currentValue) {
    if (typeof KpiThresholdForm === 'undefined') {
        UI.toast(t('kpiQuery.kpi_not_loaded'),'error');
        return;
    }
    window._onKpiSaved = function(kpiId) {
        // KPI 存檔後，自動刷新當前 YG 頁
        if (_currentYgPage) ygLoad(_currentYgPage);
    };
    KpiThresholdForm.open(uid, currentValue);
};

// ===== YG 頁面載入 =====
window.ygLoad = async function(pageId) {
    _currentYgPage = pageId;
    const bu = document.getElementById('ygBU').value;
    const y = document.getElementById('ygY').value;
    const m = document.getElementById('ygM').value;
    const body = document.getElementById(pageId + '_body');
    if (!bu || !y || !m) { body.innerHTML = `<p style="color:#e74c3c;padding:20px;">${t('kpiQuery.no_bu_ym')}</p>`; return; }

    try {
        const res = await API.get(`/api/kpi-query/query?bu_no=${bu}&YYYY_MM=${y}/${String(m).padStart(2,'0')}`);
        const kpis = res.data || {};
        const cfg = YG_CONFIG[pageId];
        body.innerHTML = cfg.sections.map(s => renderSection(kpis, s)).join('');
    } catch (e) {
        body.innerHTML = `<p style="color:#e74c3c;padding:20px;">${t('kpiQuery.load_fail')}: ${e.message}</p>`;
    }
};

function renderSection(kpis, sec) {
    // 先按類別分組（讓點擊「預警類別」可一次看到同組所有項目）
    const catMap = {};
    sec.rows.forEach(row => {
        const cat = row.cat || '未分類';
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
            '獲利能力': '#fdebd0', '獲利績效': '#fdebd0',
            '營運能力': '#d6eaf8',
            '模型分析': '#e8daef', 'Z模型': '#e8daef', 'Z1模型': '#e8daef', 'Z2模型': '#e8daef', 'GGR模型': '#e8daef', 'BZ模型': '#e8daef',
            'BZ巴萨利润': '#d5f5e3', '巴萨模型': '#d5f5e3',
            '利潤異常': '#fadbd8', '資產異常': '#fadbd8',
            '營運資產模型': '#d6eaf8',
            '沃爾比重模型': '#fdebd0',
            'A值模型': '#fadbd8',
        };
        const catName = row.cat || item.category || '-';
        // 序列化同類別的 rows 給 onclick 使用
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

// ====== 點「預警類別」→ 顯示該類別所有項目的說明與目的 ======
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

// KPI 上一頁 / 下一頁（yg001 ↔ yg002 ↔ yg003 ↔ yg004）
window.ygPageShift = function(pageId, delta) {
    const pages = Object.keys(YG_CONFIG);     // ['yg001','yg002','yg003','yg004']
    const idx = pages.indexOf(pageId);
    const next = Math.max(0, Math.min(pages.length - 1, idx + delta));
    if (next === idx) {
        UI.toast(idx === 0 ? t('kpiQuery.first_page') : t('kpiQuery.last_page'), 'info');
        return;
    }
    // 保留當前公司別 / 年 / 月到 State，讓下一頁預設相同
    State.bu_no = document.getElementById('ygBU').value || State.bu_no;
    const y = document.getElementById('ygY').value;
    const m = document.getElementById('ygM').value;
    if (y && m) State.YYYY_MM = `${y}/${String(m).padStart(2,'0')}`;
    navigate(pages[next]);
};

// 註冊頁面
for (const pageId of Object.keys(YG_CONFIG)) {
    registerPage(pageId, buildYGRender(pageId));
}
