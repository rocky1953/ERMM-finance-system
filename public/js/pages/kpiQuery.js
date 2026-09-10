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
                { id: 'debt_ratio',    cat: '償債能力', name: '負債比率(%)',    low:20,   high:60,  pct_type:'desc' },
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
                { id: 'debt_ratio',     cat: '獲利績效', name: '負債比(%)',         low:20, high:60, pct_type:'desc' },
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
                { id: 'debt_ratio',     cat: '利潤異常', name: '負債比(%)',        low:20, high:60, pct_type:'desc' },
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

// ====== 共用 render ======
function buildYGRender(pageId) {
    const cfg = YG_CONFIG[pageId];
    return async (c) => {
        c.innerHTML = `
            <div class="card">
                <div class="toolbar">
                    <label>公司別：<select id="ygBU" onchange="ygLoad('${pageId}')">
                        <option value="">請選擇</option>
                        <option value="HM">HM</option><option value="HN">HN</option><option value="SZ">SZ</option>
                    </select></label>
                    <label>年：<input type="number" id="ygY" min="2000" max="2100" style="width:80px;" onchange="ygLoad('${pageId}')"></label>
                    <label>月：<input type="number" id="ygM" min="1" max="12" style="width:60px;" onchange="ygLoad('${pageId}')"></label>
                    <button class="btn btn-success" onclick="ygLoad('${pageId}')">🔄 更新</button>
                    <button class="btn" onclick="ygShift('${pageId}',-1)">◀ 上一月</button>
                    <button class="btn" onclick="ygShift('${pageId}',+1)">下一月 ▶</button>
                    <span style="color:#999;margin:0 6px;">|</span>
                    <button class="btn" onclick="ygPageShift('${pageId}',-1)">◀ KPI上一頁</button>
                    <button class="btn btn-primary" onclick="ygPageShift('${pageId}',+1)">KPI下一頁 ▶</button>
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
window.openKpiThreshold = function(uid) {
    if (typeof KpiThresholdForm === 'undefined') {
        UI.toast('KPI 門檻模組未載入，請先點「KPI 門檻」頁面','error');
        return;
    }
    window._onKpiSaved = function(kpiId) {
        // KPI 存檔後，自動刷新當前 YG 頁
        if (_currentYgPage) ygLoad(_currentYgPage);
    };
    KpiThresholdForm.open(uid);
};

// ===== YG 頁面載入 =====
window.ygLoad = async function(pageId) {
    _currentYgPage = pageId;
    const bu = document.getElementById('ygBU').value;
    const y = document.getElementById('ygY').value;
    const m = document.getElementById('ygM').value;
    const body = document.getElementById(pageId + '_body');
    if (!bu || !y || !m) { body.innerHTML = '<p style="color:#e74c3c;padding:20px;">⚠️ 請先選擇 公司別 / 年 / 月</p>'; return; }

    try {
        const res = await API.get(`/api/kpi-query/query?bu_no=${bu}&YYYY_MM=${y}/${String(m).padStart(2,'0')}`);
        const kpis = res.data || {};
        const cfg = YG_CONFIG[pageId];
        body.innerHTML = cfg.sections.map(s => renderSection(kpis, s)).join('');
    } catch (e) {
        body.innerHTML = `<p style="color:#e74c3c;padding:20px;">❌ 載入失敗：${e.message}</p>`;
    }
};

function renderSection(kpis, sec) {
    const rows = sec.rows.map(row => {
        const item = kpis[row.id] || { id: row.id, name: row.name, current_value: null, KPI1: row.low, KPI2: row.high, unit: '' };
        const v = item.current_value;
        // 優先用 DB 門檻 (KPI1/KPI2)，否則用 row.low/row.high
        const low  = (item.KPI1 !== undefined && item.KPI1 !== null && item.KPI1 !== 0) ? item.KPI1 : row.low;
        const high = (item.KPI2 !== undefined && item.KPI2 !== null && item.KPI2 !== 0) ? item.KPI2 : row.high;
        const color = light(v, low, high, item.pct_type || row.pct_type);
        const targetCell = item.uid
            ? `<td class="num" style="cursor:pointer;color:#2980b9;text-decoration:underline;" title="點擊調整目標門檻" onclick="openKpiThreshold(${item.uid})">${fmt(low)} ~ ${fmt(high)}</td>`
            : `<td class="num" style="color:#999;" title="尚未在 KPI 門檻頁定義，點 KPI 門檻頁新增">${fmt(low)} ~ ${fmt(high)}</td>`;
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
        return `
            <tr>
                <td style="background:${catBg[row.cat] || '#eaecee'};font-weight:bold;">${row.cat || item.category || '-'}</td>
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
                    <th style="width:90px;">預警類別</th>
                    <th style="text-align:left;">項目名稱</th>
                    <th style="width:140px;">目標值</th>
                    <th style="width:130px;">當前值</th>
                    <th style="width:80px;">狀態</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

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
        UI.toast(idx === 0 ? '已在第一頁' : '已在最後一頁', 'info');
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
