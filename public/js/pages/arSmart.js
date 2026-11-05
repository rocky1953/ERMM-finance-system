/**
 * O-3 AR 催收智能排序 — 前端页面
 */
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
        const cc = map[flag] || map.safe;
        return `<span style="background:${cc.bg};color:${cc.fg};padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600;">${cc.txt}</span>`;
    }

    async function apiGet(path) {
        const token = localStorage.getItem('token') || '';
        const res = await fetch(path, { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
        const j = await res.json();
        if (!j || !j.success) throw new Error((j && j.message) || 'API 回應失敗');
        if (!j.data) throw new Error('API 無 data 欄位');
        return j.data;
    }

    async function loadAndRender() {
        container.innerHTML = `<div style="padding:40px;text-align:center;color:#94a3b8;">⏳ 載入中...</div>`;
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
            container.innerHTML = `<div style="padding:40px;text-align:center;color:#dc2626;">❌ 載入失敗: ${err.message}</div>`;
        }
    }

    function renderAll(ov, cols) {
        let html = `
        <div style="margin-bottom:16px;">
            <h1 style="margin:0;font-size:20px;font-weight:700;color:#1e293b;">🎯 AR 應收帳款智能催收排序</h1>
            <p style="margin:4px 0 14px;color:#64748b;font-size:13px;">根據帳齡 · 逾期天數 · 金額規模 · 公司風險 · 佔 AR 總額比例 五維度綜合評分，自動生成催收行動建議</p>
            <div style="display:flex;gap:6px;">
                ${['HM','SZ','HN'].map(bu => {
                    const active = bu === currentBU;
                    return `<button data-bu="${bu}" style="padding:8px 18px;border-radius:8px;border:1px solid ${active ? '#3b82f6' : '#e2e8f0'};background:${active ? '#3b82f6' : '#fff'};color:${active ? '#fff' : '#334155'};cursor:pointer;font-weight:600;font-size:13px;">${bu}</button>`;
                }).join('')}
            </div>
        </div>`;

        // 5 张概览卡片
        const cards = [
            { label: 'AR 總額', value: money(ov.total_amount), sub: `${ov.total_invoices} 筆發票`, color: '#3b82f6' },
            { label: '未收金額', value: money(ov.unpaid_amount), sub: '總金額 - 已付', color: '#8b5cf6' },
            { label: '逾期金額', value: money(ov.overdue_amount), sub: `逾期 ${ov.overdue_pct}`, color: '#f97316' },
            { label: '平均帳齡', value: `${ov.avg_age_days} 天`, sub: `風險: ${ov.risk_flag}`, color: '#0ea5e9' },
            { label: '緊急催收客戶', value: ov.high_priority + ov.medium_priority, sub: `緊急=${ov.high_priority} 高=${ov.medium_priority}`, color: '#dc2626' }
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
                <div style="font-size:14px;font-weight:600;color:#334155;margin-bottom:12px;">📊 AR 帳齡分佈</div>
                <div style="display:flex;align-items:flex-end;gap:14px;height:110px;">`;
            ov.age_buckets.forEach(b => {
                const hgt = Math.max(4, (Number(b.amount) / maxAmt) * 100);
                const color = b.label.includes('90+') ? '#ef4444' : b.label.includes('61') ? '#f97316' : b.label.includes('31') ? '#eab308' : '#22c55e';
                html += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
                    <div style="font-size:10px;color:#64748b;">${money(b.amount)}</div>
                    <div style="width:100%;height:${hgt}%;background:${color};border-radius:4px 4px 0 0;min-height:4px;"></div>
                    <div style="font-size:11px;color:#475569;margin-top:4px;">${b.label}</div>
                    <div style="font-size:10px;color:#94a3b8;">${b.count} 筆</div>
                </div>`;
            });
            html += `</div></div>`;
        }

        // 智能催收排序表
        const list = cols.list || [];
        html += `<div style="background:#fff;border-radius:10px;overflow:hidden;margin-bottom:20px;box-shadow:0 1px 2px rgba(0,0,0,.06);">
            <div style="padding:14px 20px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;">
                <div style="font-size:14px;font-weight:600;color:#334155;">🎯 智能催收排序（依評分由高到低）</div>
                <div style="font-size:11px;color:#94a3b8;">共 ${cols.total_clients} 個客戶 / ${cols.total_records} 筆發票</div>
            </div>
            <table style="width:100%;border-collapse:collapse;">
                <thead><tr style="background:#f8fafc;">
                    <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#475569;text-align:center;border-bottom:1px solid #e2e8f0;">評分</th>
                    <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#475569;text-align:left;border-bottom:1px solid #e2e8f0;">客戶</th>
                    <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#475569;text-align:left;border-bottom:1px solid #e2e8f0;">未收金額</th>
                    <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#475569;text-align:center;border-bottom:1px solid #e2e8f0;">最老帳齡</th>
                    <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#475569;text-align:center;border-bottom:1px solid #e2e8f0;">發票數</th>
                    <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#475569;text-align:center;border-bottom:1px solid #e2e8f0;">風險</th>
                    <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#475569;text-align:left;border-bottom:1px solid #e2e8f0;">催收行動建議</th>
                </tr></thead>
                <tbody>`;
        list.forEach(row => {
            const tc = tierColor(row.score);
            html += `<tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:10px 12px;text-align:center;"><span style="background:${tc.bg};border:1px solid ${tc.border};color:${tc.dot};border-radius:6px;padding:3px 10px;font-weight:700;font-size:13px;">${row.score}</span></td>
                <td style="padding:10px 12px;font-weight:600;color:#1e293b;">${row.client}</td>
                <td style="padding:10px 12px;color:#334155;">${money(row.unpaid_amount)}</td>
                <td style="padding:10px 12px;text-align:center;color:#64748b;">${row.oldest_age_days} 天</td>
                <td style="padding:10px 12px;text-align:center;color:#64748b;">${row.invoice_count}</td>
                <td style="padding:10px 12px;">${riskBadge(row.risk_flag)}</td>
                <td style="padding:10px 12px;color:#334155;font-size:12px;line-height:1.5;">${row.action}</td>
            </tr>`;
        });
        html += `</tbody></table></div>`;

        return html;
    }

    // 启动加载
    await loadAndRender();
});
