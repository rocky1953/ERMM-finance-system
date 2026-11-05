/**
 * T-3 数据质量自动扫描 — 前端页面
 */

let scanResult = null;

async function apiScan() {
    const token = localStorage.getItem('token') || '';
    const res = await fetch('/api/data-quality/scan', { headers: { Authorization: 'Bearer ' + token } });
    const j = await res.json();
    return j.data;
}

const SEV_COLOR = {
    ERROR: { bg: '#fee2e2', border: '#ef4444', dot: '#dc2626', label: '🔴 ERROR' },
    WARN:  { bg: '#fef3c7', border: '#eab308', dot: '#ca8a04', label: '🟡 WARN' },
    INFO:  { bg: '#dbeafe', border: '#3b82f6', dot: '#2563eb', label: '🔵 INFO' }
};

function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
        if (k === 'style') el.style.cssText = v;
        else if (k === 'class') el.className = v;
        else if (k === 'onclick') el.onclick = v;
        else el.setAttribute(k, v);
    }
    if (children) (Array.isArray(children) ? children : [children]).forEach(c => {
        if (c == null || c === false) return;
        el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
}

async function loadAndRender() {
    const container = document.getElementById('dq-container');
    if (!container) return;
    container.innerHTML = `<div style="padding:40px;text-align:center;color:#94a3b8;">⏳ 正在扫描所有数据表...</div>`;

    try {
        const data = await apiScan();
        scanResult = data;
        container.innerHTML = '';
        container.appendChild(buildHeader());
        container.appendChild(buildSummaryCards(data));
        container.appendChild(buildByCategory(data));
    } catch (err) {
        container.innerHTML = `<div style="padding:40px;text-align:center;color:#dc2626;">❌ 扫描失败: ${err.message}</div>`;
    }
}

function buildHeader() {
    const wrap = h('div', { class: 'page-header' }, [
        h('h1', { style: 'margin:0;font-size:20px;font-weight:700;color:#1e293b;' }, '🛠️ 數據質量自動掃描'),
        h('p', { style: 'margin:4px 0 16px;color:#64748b;font-size:13px;' },
            '20+ 項自動檢查：Z_score 未計算 · 重複記錄 · 金額異常 · 逾期 forecast · AR 對帳差異 · 表級健康度'),
        h('button', {
            class: 'btn',
            style: 'padding:8px 20px;border-radius:8px;background:#3b82f6;color:#fff;border:none;cursor:pointer;font-weight:600;font-size:13px;transition:background .15s;',
            onclick: () => loadAndRender()
        }, '🔄 重新掃描')
    ]);
    return wrap;
}

function buildSummaryCards(data) {
    const c = data.counts;
    const cards = [
        { label: '掃描檢查項', value: '20+', sub: '7 大類 / 每類多項', color: '#0ea5e9' },
        { label: '掃描耗時', value: data.duration_ms + 'ms', sub: '全表級', color: '#22c55e' },
        { label: '🔴 ERROR', value: c.ERROR, sub: '需立即處理', color: '#dc2626' },
        { label: '🟡 WARN',  value: c.WARN,  sub: '建議處理', color: '#eab308' },
        { label: '🔵 INFO',  value: c.INFO,  sub: '提示資訊', color: '#3b82f6' }
    ];
    const row = h('div', { style: 'display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px;' });
    cards.forEach(card => {
        row.appendChild(h('div', {
            style: 'background:#fff;border-radius:10px;padding:14px;border-left:4px solid ' + card.color + ';box-shadow:0 1px 2px rgba(0,0,0,.06);'
        }, [
            h('div', { style: 'font-size:11px;color:#94a3b8;margin-bottom:4px;' }, card.label),
            h('div', { style: 'font-size:20px;font-weight:700;color:#1e293b;' }, String(card.value)),
            h('div', { style: 'font-size:11px;color:#64748b;margin-top:2px;' }, card.sub)
        ]));
    });
    return row;
}

function buildByCategory(data) {
    const wrap = h('div', {});
    for (const [catId, cat] of Object.entries(data.byCat)) {
        const hasIssues = cat.issues && cat.issues.length > 0;
        wrap.appendChild(h('div', {
            style: `background:#fff;border-radius:10px;padding:0;margin-bottom:12px;box-shadow:0 1px 2px rgba(0,0,0,.06);overflow:hidden;opacity:${hasIssues ? '1' : '0.65'};`
        }, [
            h('div', { style: 'padding:12px 20px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;cursor:pointer;' }, [
                h('div', { style: 'font-size:14px;font-weight:600;color:#334155;' }, `${cat.icon || ''} ${cat.label}`),
                h('div', { style: 'font-size:12px;' }, hasIssues
                    ? `<span style="color:#dc2626;font-weight:600;">● ${cat.issues.length} 項問題</span>`
                    : `<span style="color:#16a34a;font-weight:600;">✅ 全綠</span>`)
            ]),
            hasIssues ? buildIssueList(cat.issues) : h('div', { style: 'padding:14px 20px;color:#94a3b8;font-size:12px;' }, '此類別未發現問題')
        ]));
    }
    return wrap;
}

function buildIssueList(issues) {
    const list = h('div', {});
    issues.forEach(iss => {
        const sc = SEV_COLOR[iss.severity] || SEV_COLOR.INFO;
        list.appendChild(h('div', {
            style: 'padding:12px 20px;border-bottom:1px solid #f8fafc;border-left:3px solid ' + sc.border + ';transition:background .15s;',
            onmouseenter: e => e.currentTarget.style.background = '#fafafa',
            onmouseleave: e => e.currentTarget.style.background = ''
        }, [
            h('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:4px;' }, [
                h('span', {
                    style: `background:${sc.bg};color:${sc.dot};padding:2px 10px;border-radius:6px;font-weight:700;font-size:11px;white-space:nowrap;`
                }, sc.label),
                h('span', { style: 'font-size:12px;color:#94a3b8;' }, `rule_id=${iss.rule_id} · ${iss.table}`)
            ]),
            h('div', { style: 'font-size:13px;color:#1e293b;font-weight:500;margin-bottom:4px;' }, iss.message),
            iss.detail ? h('div', { style: 'font-size:12px;color:#64748b;line-height:1.5;' }, iss.detail) : null
        ]));
    });
    return list;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        name: 'dataQuality', label: '数据质量扫描', icon: '🛠️',
        path: '/pages/dataQuality.js',
        render: (container) => {
            container.id = 'dq-container';
            container.innerHTML = '';
            loadAndRender();
        },
        init: () => loadAndRender()
    };
}
