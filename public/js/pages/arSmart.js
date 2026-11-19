/**
 * O-3 AR 催收智能排序 — 前端页面
 */
const ARS_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] ?? zh);
// 后端账龄标签为闭集中文，EN 模式下归一化
const ARS_AGE_MAP = { '0-30天': '0-30 d', '31-60天': '31-60 d', '61-90天': '61-90 d', '90+天': '90+ d' };
function arsAgeLabel(l) { return I18N.lang === 'en' ? (ARS_AGE_MAP[l] || l) : l; }

registerPage('arSmart', async (c) => {
    // 注入页面容器（复用 _pageContent 逻辑）
    const container = document.createElement('div');
    container.id = 'ar-smart-container';
    container.style.cssText = 'min-height:600px;';
    c.innerHTML = '';
    c.appendChild(container);

    let currentBU = 'HM';

    function money(n) {
        const num = Number(n) || 0;
        if (num >= 1e8) return (num / 1e8).toFixed(2) + ' ' + ARS_L('亿', '億', '×100M');
        if (num >= 1e4) return (num / 1e4).toFixed(0) + ' ' + ARS_L('万', '萬', '×10K');
        return num.toLocaleString();
    }

    function tierColor(score) {
        if (score >= 70) return { bg: '#fee2e2', border: '#ef4444', dot: '#dc2626', label: ARS_L('🔴 紧急', '🔴 緊急', '🔴 Urgent') };
        if (score >= 50) return { bg: '#ffedd5', border: '#f97316', dot: '#ea580c', label: ARS_L('🟠 高优先', '🟠 高優先', '🟠 High Priority') };
        if (score >= 30) return { bg: '#fef3c7', border: '#eab308', dot: '#ca8a04', label: ARS_L('🟡 常规', '🟡 常規', '🟡 Regular') };
        return { bg: '#dcfce7', border: '#22c55e', dot: '#16a34a', label: ARS_L('🟢 正常', '🟢 正常', '🟢 Normal') };
    }

    function riskBadge(flag) {
        const map = {
            danger: { bg: '#fee2e2', fg: '#dc2626', txt: ARS_L('⚠️ 风险偏高', '⚠️ 風險偏高', '⚠️ High Risk') },
            watch:  { bg: '#fef3c7', fg: '#ca8a04', txt: ARS_L('🟡 关注中', '🟡 關注中', '🟡 Watching') },
            safe:   { bg: '#dcfce7', fg: '#16a34a', txt: ARS_L('✅ 安全', '✅ 安全', '✅ Safe') }
        };
        const cc = map[flag] || map.safe;
        return `<span style="background:${cc.bg};color:${cc.fg};padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600;">${cc.txt}</span>`;
    }

    async function apiGet(path) {
        const token = Auth.getToken();
        const res = await fetch(path, { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
        const j = await res.json();
        if (!j || !j.success) throw new Error((j && j.message) || ARS_L('API 响应失败', 'API 回應失敗', 'API response failed'));
        if (!j.data) throw new Error(ARS_L('API 无 data 字段', 'API 無 data 欄位', 'API returned no data field'));
        return j.data;
    }

    async function loadAndRender() {
        container.innerHTML = `<div style="padding:40px;text-align:center;color:#94a3b8;">${ARS_L('⏳ 加载中...', '⏳ 載入中...', '⏳ Loading...')}</div>`;
        try {
            const [ov, cols] = await Promise.all([
                apiGet(`/api/ar-smart/overview?bu_no=${currentBU}`),
                apiGet(`/api/ar-smart/collections?bu_no=${currentBU}&topN=30`)
            ]);
            container.innerHTML = renderAll(ov, cols);
            // 绑定事件
            container.querySelectorAll('[data-bu]').forEach(btn => {
                btn.onclick = () => { currentBU = btn.dataset.bu; loadAndRender(); };
            });
        } catch (err) {
            container.innerHTML = `<div style="padding:40px;text-align:center;color:#dc2626;">${ARS_L('❌ 载入失败: ', '❌ 載入失敗: ', '❌ Load failed: ')}${err.message}</div>`;
        }
    }

    function renderAll(ov, cols) {
        let html = `
        <div style="margin-bottom:16px;">
            <h1 style="margin:0;font-size:20px;font-weight:700;color:#1e293b;">${ARS_L('🎯 AR 应收账款智能催收排序', '🎯 AR 應收帳款智能催收排序', '🎯 AR Smart Collection Ranking')}</h1>
            <p style="margin:4px 0 14px;color:#64748b;font-size:13px;">${ARS_L('根据账龄 · 逾期天数 · 金额规模 · 公司风险 · 占 AR 总额比例 五维度综合评分，自动生成催收行动建议', '根據帳齡 · 逾期天數 · 金額規模 · 公司風險 · 佔 AR 總額比例 五維度綜合評分，自動生成催收行動建議', 'Five-dimension scoring on aging · overdue days · amount · company risk · share of AR total, with automatic collection action suggestions')}</p>
            <div style="display:flex;gap:6px;">
                ${['HM','SZ','HN'].map(bu => {
                    const active = bu === currentBU;
                    return `<button data-bu="${bu}" style="padding:8px 18px;border-radius:8px;border:1px solid ${active ? '#3b82f6' : '#e2e8f0'};background:${active ? '#3b82f6' : '#fff'};color:${active ? '#fff' : '#334155'};cursor:pointer;font-weight:600;font-size:13px;">${bu}</button>`;
                }).join('')}
            </div>
        </div>`;

        // 5 张概览卡片
        const cards = [
            { label: ARS_L('AR 总额', 'AR 總額', 'AR Total'), value: money(ov.total_amount), sub: `${ov.total_invoices} ${ARS_L('笔发票', '筆發票', 'invoices')}`, color: '#3b82f6' },
            { label: ARS_L('未收金额', '未收金額', 'Unpaid Amount'), value: money(ov.unpaid_amount), sub: ARS_L('总金额 - 已付', '總金額 - 已付', 'Total - Paid'), color: '#8b5cf6' },
            { label: ARS_L('逾期金额', '逾期金額', 'Overdue Amount'), value: money(ov.overdue_amount), sub: `${ARS_L('逾期 ', '逾期 ', 'Overdue ')}${ov.overdue_pct}`, color: '#f97316' },
            { label: ARS_L('平均账龄', '平均帳齡', 'Avg Aging'), value: `${ov.avg_age_days} ${ARS_L('天', '天', 'days')}`, sub: `${ARS_L('风险: ', '風險: ', 'Risk: ')}${ov.risk_flag}`, color: '#0ea5e9' },
            { label: ARS_L('紧急催收客户', '緊急催收客戶', 'Urgent Collection Clients'), value: ov.high_priority + ov.medium_priority, sub: `${ARS_L('紧急=', '緊急=', 'Urgent=')}${ov.high_priority} ${ARS_L('高=', '高=', 'High=')}${ov.medium_priority}`, color: '#dc2626' }
        ];
        html += `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px;">`;
        cards.forEach(c => {
            html += `<div style="background:#fff;border-radius:10px;padding:14px;border-left:4px solid ${c.color};box-shadow:0 1px 2px rgba(0,0,0,.06);">
                <div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">${c.label}</div>
                <div style="font-size:20px;font-weight:700;color:#1e293b;">${c.value}</div>
                <div style="font-size:11px;color:#64748b;margin-top:2px;">${c.sub}</div>
            </div>`;
        });
        html += `</div>`;

        // 账龄分布
        if (ov.age_buckets && ov.age_buckets.length > 0) {
            const maxAmt = Math.max(...ov.age_buckets.map(b => Number(b.amount)), 1);
            html += `<div style="background:#fff;border-radius:10px;padding:16px 20px;margin-bottom:20px;box-shadow:0 1px 2px rgba(0,0,0,.06);">
                <div style="font-size:14px;font-weight:600;color:#334155;margin-bottom:12px;">${ARS_L('📊 AR 账龄分布', '📊 AR 帳齡分佈', '📊 AR Aging Distribution')}</div>
                <div style="display:flex;align-items:flex-end;gap:14px;height:110px;">`;
            ov.age_buckets.forEach(b => {
                const hgt = Math.max(4, (Number(b.amount) / maxAmt) * 100);
                const color = b.label.includes('90+') ? '#ef4444' : b.label.includes('61') ? '#f97316' : b.label.includes('31') ? '#eab308' : '#22c55e';
                html += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
                    <div style="font-size:10px;color:#64748b;">${money(b.amount)}</div>
                    <div style="width:100%;height:${hgt}%;background:${color};border-radius:4px 4px 0 0;min-height:4px;"></div>
                    <div style="font-size:11px;color:#475569;margin-top:4px;">${arsAgeLabel(b.label)}</div>
                    <div style="font-size:10px;color:#94a3b8;">${b.count} ${ARS_L('笔', '筆', 'records')}</div>
                </div>`;
            });
            html += `</div></div>`;
        }

        // 智能催收排序表
        const list = cols.list || [];
        html += `<div style="background:#fff;border-radius:10px;overflow:hidden;margin-bottom:20px;box-shadow:0 1px 2px rgba(0,0,0,.06);">
            <div style="padding:14px 20px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;">
                <div style="font-size:14px;font-weight:600;color:#334155;">${ARS_L('🎯 智能催收排序（依评分由高到低）', '🎯 智能催收排序（依評分由高到低）', '🎯 Smart Collection Ranking (score high to low)')}</div>
                <div style="font-size:11px;color:#94a3b8;">${ARS_L('共', '共', 'Total')} ${cols.total_clients} ${ARS_L('个客户 /', '個客戶 /', 'clients /')} ${cols.total_records} ${ARS_L('笔发票', '筆發票', 'invoices')}</div>
            </div>
            <table style="width:100%;border-collapse:collapse;">
                <thead><tr style="background:#f8fafc;">
                    <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#475569;text-align:center;border-bottom:1px solid #e2e8f0;">${ARS_L('评分', '評分', 'Score')}</th>
                    <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#475569;text-align:left;border-bottom:1px solid #e2e8f0;">${ARS_L('客户', '客戶', 'Client')}</th>
                    <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#475569;text-align:left;border-bottom:1px solid #e2e8f0;">${ARS_L('未收金额', '未收金額', 'Unpaid')}</th>
                    <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#475569;text-align:center;border-bottom:1px solid #e2e8f0;">${ARS_L('最老账龄', '最老帳齡', 'Oldest Aging')}</th>
                    <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#475569;text-align:center;border-bottom:1px solid #e2e8f0;">${ARS_L('发票数', '發票數', 'Invoices')}</th>
                    <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#475569;text-align:center;border-bottom:1px solid #e2e8f0;">${ARS_L('风险', '風險', 'Risk')}</th>
                    <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#475569;text-align:left;border-bottom:1px solid #e2e8f0;">${ARS_L('催收行动建议', '催收行動建議', 'Collection Action')}</th>
                </tr></thead>
                <tbody>`;
        list.forEach(row => {
            const tc = tierColor(row.score);
            html += `<tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:10px 12px;text-align:center;"><span style="background:${tc.bg};border:1px solid ${tc.border};color:${tc.dot};border-radius:6px;padding:3px 10px;font-weight:700;font-size:13px;">${row.score}</span></td>
                <td style="padding:10px 12px;font-weight:600;color:#1e293b;">${row.client}</td>
                <td style="padding:10px 12px;color:#334155;">${money(row.unpaid_amount)}</td>
                <td style="padding:10px 12px;text-align:center;color:#64748b;">${row.oldest_age_days} ${ARS_L('天', '天', 'days')}</td>
                <td style="padding:10px 12px;text-align:center;color:#64748b;">${row.invoice_count}</td>
                <td style="padding:10px 12px;">${riskBadge(row.risk_flag)}</td>
                <td style="padding:10px 12px;color:#334155;font-size:12px;line-height:1.5;">${I18N.fixAlert(row.action)}</td>
            </tr>`;
        });
        html += `</tbody></table></div>`;

        return html;
    }

    // 启动加载
    await loadAndRender();
});
