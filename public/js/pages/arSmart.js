/**
 * O-3 AR 催收智能排序 — 前端页面
 * 
 * 功能:
 *   1. 顶部 tab 切换 HM/SZ/HN
 *   2. 概览卡片（AR 总额 / 逾期金额 / 平均账龄 / 风险等级 / 高优先客户数）
 *   3. 账龄分布柱状图
 *   4. 智能催收排序表（按 score DESC，分 urgent/high/medium/low 四档）
 *   5. 每行显示催收行动建议
 *
 * 接口:
 *   GET /api/ar-smart/overview?bu_no=X
 *   GET /api/ar-smart/collections?bu_no=X&topN=30
 */

let currentBU = 'HM';
let apiHeaders = null;

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

function money(n) {
    const num = Number(n) || 0;
    if (num >= 1e8) return (num / 1e8).toFixed(2) + ' 億';
    if (num >= 1e4) return (num / 1e4).toFixed(0) + ' 萬';
    return num.toLocaleString();
}

function tierColor(score) {
    if (score >= 70) return { bg: '#fee2e2', border: '#ef4444', dot: '#dc2626', label: '🔴 緊急' };
    if (score >= 50) return { bg: '#ffedd5', border: '#f97316', dot: '#ea580c', label: '🟠 高優先' };
    if (score >= 30) return { bg: '#fef3c7', border: '#eab308', dot: '#ca8a04', label: '🟡 常規' };
    return { bg: '#dcfce7', border: '#22c55e', dot: '#16a34a', label: '🟢 正常' };
}

function riskBadge(flag) {
    const map = {
        danger: { bg: '#fee2e2', fg: '#dc2626', txt: '⚠️ 風險偏高' },
        watch:  { bg: '#fef3c7', fg: '#ca8a04', txt: '🟡 關注中' },
        safe:   { bg: '#dcfce7', fg: '#16a34a', txt: '✅ 安全' }
    };
    const c = map[flag] || map.safe;
    return `<span style="background:${c.bg};color:${c.fg};padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600;">${c.txt}</span>`;
}

async function apiGet(path) {
    const token = localStorage.getItem('token') || '';
    const res = await fetch(path, { headers: { Authorization: 'Bearer ' + token } });
    const j = await res.json();
    return j.data;
}

async function loadAndRender() {
    const container = document.getElementById('ar-smart-container');
    if (!container) return;

    container.innerHTML = `<div style="padding:40px;text-align:center;color:#94a3b8;">⏳ 載入中...</div>`;

    try {
        const [ov, cols] = await Promise.all([
            apiGet(`/api/ar-smart/overview?bu_no=${currentBU}`),
            apiGet(`/api/ar-smart/collections?bu_no=${currentBU}&topN=30`)
        ]);

        container.innerHTML = '';
        container.appendChild(buildHeader());
        container.appendChild(buildOverview(ov));
        container.appendChild(buildAgeBars(ov.age_buckets));
        container.appendChild(buildCollectionsTable(cols));
    } catch (err) {
        container.innerHTML = `<div style="padding:40px;text-align:center;color:#dc2626;">❌ 載入失敗: ${err.message}</div>`;
    }
}

function buildHeader() {
    const wrap = h('div', { class: 'page-header' }, [
        h('h1', { style: 'margin:0;font-size:20px;font-weight:700;color:#1e293b;' }, '🎯 AR 應收帳款智能催收排序'),
        h('p', { style: 'margin:4px 0 16px;color:#64748b;font-size:13px;' },
            '根據帳齡 · 逾期天數 · 金額規模 · 公司風險 · 佔 AR 總額比例 五維度綜合評分，自動生成催收行動建議')
    ]);

    const tabs = h('div', { style: 'display:flex;gap:6px;margin-bottom:16px;' },
        ['HM', 'SZ', 'HN'].map(bu => {
            const active = bu === currentBU;
            return h('button', {
                class: 'btn',
                style: `padding:8px 18px;border-radius:8px;border:1px solid ${active ? '#3b82f6' : '#e2e8f0'};background:${active ? '#3b82f6' : '#fff'};color:${active ? '#fff' : '#334155'};cursor:pointer;font-weight:600;font-size:13px;transition:all .15s;`,
                onclick: () => { currentBU = bu; loadAndRender(); }
            }, `${bu} ${active ? '●' : ''}`);
        })
    );
    wrap.appendChild(tabs);
    return wrap;
}

function buildOverview(ov) {
    const cards = [
        { label: 'AR 總額', value: money(ov.total_amount), sub: `${ov.total_invoices} 筆發票`, color: '#3b82f6' },
        { label: '未收金額', value: money(ov.unpaid_amount), sub: '總金額 - 已付', color: '#8b5cf6' },
        { label: '逾期金額', value: money(ov.overdue_amount), sub: `逾期 ${ov.overdue_pct}`, color: '#f97316' },
        { label: '平均帳齡', value: `${ov.avg_age_days} 天`, sub: `風險: ${ov.risk_flag}`, color: '#0ea5e9' },
        { label: '緊急催收', value: ov.high_priority + ov.medium_priority, sub: `緊急=${ov.high_priority} 高=${ov.medium_priority}`, color: '#dc2626' }
    ];

    const row = h('div', { style: 'display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px;' });
    cards.forEach(c => {
        const card = h('div', {
            style: 'background:#fff;border-radius:10px;padding:14px;border-left:4px solid ' + c.color + ';box-shadow:0 1px 2px rgba(0,0,0,.06);'
        }, [
            h('div', { style: 'font-size:11px;color:#94a3b8;margin-bottom:4px;' }, c.label),
            h('div', { style: 'font-size:20px;font-weight:700;color:#1e293b;' }, c.value),
            h('div', { style: 'font-size:11px;color:#64748b;margin-top:2px;' }, c.sub)
        ]);
        row.appendChild(card);
    });
    return row;
}

function buildAgeBars(buckets) {
    if (!buckets || buckets.length === 0) return h('div');
    const max = Math.max(...buckets.map(b => Number(b.amount || 0)), 1);

    const barsWrap = h('div', {
        style: 'background:#fff;border-radius:10px;padding:16px 20px;margin-bottom:20px;box-shadow:0 1px 2px rgba(0,0,0,.06);'
    }, [
        h('div', { style: 'font-size:14px;font-weight:600;color:#334155;margin-bottom:12px;' }, '📊 AR 帳齡分佈'),
        h('div', { style: 'display:flex;align-items:flex-end;gap:14px;height:110px;' },
            buckets.map(b => {
                const hgt = Math.max(4, (Number(b.amount) / max) * 100);
                const color = b.label.includes('90+') ? '#ef4444' : b.label.includes('61') ? '#f97316' : b.label.includes('31') ? '#eab308' : '#22c55e';
                return h('div', { style: 'flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;' }, [
                    h('div', { style: 'font-size:10px;color:#64748b;' }, money(b.amount)),
                    h('div', {
                        style: `width:100%;height:${hgt}%;background:${color};border-radius:4px 4px 0 0;min-height:4px;transition:height .3s;`
                    }),
                    h('div', { style: 'font-size:11px;color:#475569;margin-top:4px;' }, b.label),
                    h('div', { style: 'font-size:10px;color:#94a3b8;' }, b.count + ' 筆')
                ]);
            })
        )
    ]);
    return barsWrap;
}

function buildCollectionsTable(cols) {
    const list = cols.list || [];
    const wrap = h('div', {
        style: 'background:#fff;border-radius:10px;padding:0;margin-bottom:20px;box-shadow:0 1px 2px rgba(0,0,0,.06);overflow:hidden;'
    }, [
        h('div', { style: 'padding:14px 20px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;' }, [
            h('div', { style: 'font-size:14px;font-weight:600;color:#334155;' }, '🎯 智能催收排序（依評分由高到低）'),
            h('div', { style: 'font-size:11px;color:#94a3b8;' }, `共 ${cols.total_clients} 個客戶 / ${cols.total_records} 筆發票`)
        ])
    ]);

    // 表头
    const thead = h('tr', { style: 'background:#f8fafc;' });
    ['評分', '客戶', '未收金額', '最老帳齡', '發票數', '風險', '催收行動'].forEach((t, i) => {
        thead.appendChild(h('th', { style: `padding:10px 12px;font-size:12px;font-weight:600;color:#475569;text-align:${i === 0 || i === 3 || i === 4 ? 'center' : 'left'};border-bottom:1px solid #e2e8f0;` }, t));
    });

    const tbody = h('tbody');
    list.forEach(row => {
        const tc = tierColor(row.score);
        const tr = h('tr', { style: 'border-bottom:1px solid #f1f5f9;transition:background .15s;cursor:default;',
            onmouseenter: e => e.currentTarget.style.background = '#f8fafc',
            onmouseleave: e => e.currentTarget.style.background = ''
        });

        // 评分列（醒目 pill）
        tr.appendChild(h('td', { style: 'padding:10px 12px;text-align:center;' }, h('span', {
            style: `background:${tc.bg};border:1px solid ${tc.border};color:${tc.dot};border-radius:6px;padding:3px 10px;font-weight:700;font-size:13px;`
        }, `${row.score}`)));

        tr.appendChild(h('td', { style: 'padding:10px 12px;font-weight:600;color:#1e293b;' }, row.client));

        tr.appendChild(h('td', { style: 'padding:10px 12px;color:#334155;' }, money(row.unpaid_amount)));

        tr.appendChild(h('td', { style: 'padding:10px 12px;text-align:center;color:#64748b;' }, `${row.oldest_age_days} 天`));
        tr.appendChild(h('td', { style: 'padding:10px 12px;text-align:center;color:#64748b;' }, String(row.invoice_count)));
        tr.appendChild(h('td', { style: 'padding:10px 12px;' }, riskBadge(row.risk_flag)));

        // 催收行动
        tr.appendChild(h('td', { style: 'padding:10px 12px;color:#334155;font-size:12px;line-height:1.5;' }, row.action));

        tbody.appendChild(tr);
    });

    const table = h('table', { style: 'width:100%;border-collapse:collapse;' }, [thead, tbody]);
    wrap.appendChild(table);
    return wrap;
}

// 导出给系统侧边栏用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        name: 'ar-smart',
        label: 'AR 智能催收',
        icon: '🎯',
        path: '/pages/arSmart.js',
        init: async () => { await loadAndRender(); },
        render: (container) => {
            container.id = 'ar-smart-container';
            container.innerHTML = '';
            loadAndRender();
        }
    };
}
