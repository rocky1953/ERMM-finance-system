/**
 * T-3 数据质量自动扫描 — 前端页面
 */
registerPage('dataQuality', async (c) => {
    const container = document.createElement('div');
    container.id = 'dq-container';
    container.style.cssText = 'min-height:600px;';
    c.innerHTML = '';
    c.appendChild(container);

    const SEV_COLOR = {
        ERROR: { bg: '#fee2e2', border: '#ef4444', dot: '#dc2626', label: '🔴 ERROR' },
        WARN:  { bg: '#fef3c7', border: '#eab308', dot: '#ca8a04', label: '🟡 WARN' },
        INFO:  { bg: '#dbeafe', border: '#3b82f6', dot: '#2563eb', label: '🔵 INFO' }
    };

    async function apiScan() {
        const token = localStorage.getItem('token') || '';
        const res = await fetch('/api/data-quality/scan', { headers: { Authorization: 'Bearer ' + token } });
        const j = await res.json();
        return j.data;
    }

    async function loadAndRender() {
        container.innerHTML = `<div style="padding:40px;text-align:center;color:#94a3b8;">⏳ 正在扫描所有数据表...</div>`;
        try {
            const data = await apiScan();
            container.innerHTML = renderAll(data);
            const btn = container.querySelector('[data-rescan]');
            if (btn) btn.onclick = () => loadAndRender();
        } catch (err) {
            container.innerHTML = `<div style="padding:40px;text-align:center;color:#dc2626;">❌ 扫描失败: ${err.message}</div>`;
        }
    }

    function renderAll(data) {
        const c = data.counts;
        let html = `
        <div style="margin-bottom:16px;">
            <h1 style="margin:0;font-size:20px;font-weight:700;color:#1e293b;">🛠️ 數據質量自動掃描</h1>
            <p style="margin:4px 0 14px;color:#64748b;font-size:13px;">20+ 項自動檢查：Z_score 未計算 · 重複記錄 · 金額異常 · 逾期 forecast · AR 對帳差異 · 表級健康度</p>
            <button data-rescan style="padding:8px 20px;border-radius:8px;background:#3b82f6;color:#fff;border:none;cursor:pointer;font-weight:600;font-size:13px;">🔄 重新掃描</button>
        </div>`;

        // 概览卡片
        const cards = [
            { label: '掃描檢查項', value: '20+', sub: '7 大類', color: '#0ea5e9' },
            { label: '掃描耗時', value: data.duration_ms + 'ms', sub: '全表級', color: '#22c55e' },
            { label: '🔴 ERROR', value: c.ERROR, sub: '需立即處理', color: '#dc2626' },
            { label: '🟡 WARN', value: c.WARN, sub: '建議處理', color: '#eab308' },
            { label: '🔵 INFO', value: c.INFO, sub: '提示資訊', color: '#3b82f6' }
        ];
        html += `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px;">`;
        cards.forEach(cc => {
            html += `<div style="background:#fff;border-radius:10px;padding:14px;border-left:4px solid ${cc.color};box-shadow:0 1px 2px rgba(0,0,0,.06);">
                <div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">${cc.label}</div>
                <div style="font-size:20px;font-weight:700;color:#1e293b;">${cc.value}</div>
                <div style="font-size:11px;color:#64748b;margin-top:2px;">${cc.sub}</div>
            </div>`;
        });
        html += `</div>`;

        // 按分类
        for (const [catId, cat] of Object.entries(data.byCat)) {
            const hasIssues = cat.issues && cat.issues.length > 0;
            html += `<div style="background:#fff;border-radius:10px;margin-bottom:12px;box-shadow:0 1px 2px rgba(0,0,0,.06);overflow:hidden;opacity:${hasIssues ? '1' : '0.65'};">
                <div style="padding:12px 20px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;">
                    <div style="font-size:14px;font-weight:600;color:#334155;">${cat.icon || ''} ${cat.label}</div>
                    <div style="font-size:12px;">${hasIssues
                        ? `<span style="color:#dc2626;font-weight:600;">● ${cat.issues.length} 項問題</span>`
                        : `<span style="color:#16a34a;font-weight:600;">✅ 全綠</span>`}</div>
                </div>`;
            if (!hasIssues) {
                html += `<div style="padding:14px 20px;color:#94a3b8;font-size:12px;">此類別未發現問題</div>`;
            } else {
                cat.issues.forEach(iss => {
                    const sc = SEV_COLOR[iss.severity] || SEV_COLOR.INFO;
                    html += `<div style="padding:12px 20px;border-bottom:1px solid #f8fafc;border-left:3px solid ${sc.border};">
                        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
                            <span style="background:${sc.bg};color:${sc.dot};padding:2px 10px;border-radius:6px;font-weight:700;font-size:11px;white-space:nowrap;">${sc.label}</span>
                            <span style="font-size:12px;color:#94a3b8;">rule_id=${iss.rule_id} · ${iss.table}</span>
                        </div>
                        <div style="font-size:13px;color:#1e293b;font-weight:500;margin-bottom:4px;">${iss.message}</div>
                        ${iss.detail ? `<div style="font-size:12px;color:#64748b;line-height:1.5;">${iss.detail}</div>` : ''}
                    </div>`;
                });
            }
            html += `</div>`;
        }
        return html;
    }

    await loadAndRender();
});
