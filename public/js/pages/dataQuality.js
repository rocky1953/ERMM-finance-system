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

    // 可一鍵修復的規則（與後端 RULE_FIX 對應）
    const FIXABLE = {
        'I-PAY': '將 payment 修正為發票金額（sub_amt），消除超收/超付',
        'F-OLD': '為 forecast_detail 增加 status 欄位（若缺）並將過期月份標記為 archive',
        'I-DUP': '重複發票去重：每組 invoice_no 僅保留 uid 最小一筆（其餘刪除）',
        'S-DUP': '財務摘要去重：每組 bu_no+YYYY_MM 僅保留 uid 最小一筆（其餘刪除）'
    };

    async function apiScan() {
        const token = Auth.getToken();
        const res = await fetch('/api/data-quality/scan', { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
        const j = await res.json();
        if (!j || !j.success) throw new Error((j && j.message) || 'API 回應失敗');
        if (!j.data) throw new Error('API 無 data 欄位');
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

    // 問題項點擊 → 明細彈窗（事件委託）
    container.addEventListener('click', (e) => {
        const row = e.target.closest('[data-rule]');
        if (row) DQ.openRule(row.getAttribute('data-rule'));
    });

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
                    const fixable = !!FIXABLE[iss.rule_id];
                    html += `<div data-rule="${iss.rule_id}" style="padding:12px 20px;border-bottom:1px solid #f8fafc;border-left:3px solid ${sc.border};cursor:pointer;transition:background .15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
                        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
                            <span style="background:${sc.bg};color:${sc.dot};padding:2px 10px;border-radius:6px;font-weight:700;font-size:11px;white-space:nowrap;">${sc.label}</span>
                            <span style="font-size:12px;color:#94a3b8;">rule_id=${iss.rule_id} · ${iss.table}</span>
                            <span style="margin-left:auto;font-size:11px;color:${fixable ? '#2563eb' : '#94a3b8'};white-space:nowrap;">${fixable ? '🔧 可修復 · 點擊查看明細' : '點擊查看明細 →'}</span>
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

    // ===== 明細彈窗 + 一鍵修復 =====
    const DQ = {};
    window.DQ = DQ; // 事件委託在閉包內，彈窗按鈕也走委託；掛 window 便於除錯

    DQ.ensureModal = function () {
        if (!document.getElementById('dqModalStyle')) {
            const st = document.createElement('style');
            st.id = 'dqModalStyle';
            st.textContent = `
.dq-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;z-index:9999;align-items:center;justify-content:center;}
.dq-overlay.show{display:flex;}
.dq-card{background:#fff;border-radius:12px;width:90%;max-width:920px;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.25);overflow:hidden;}
.dq-header{display:flex;justify-content:space-between;align-items:center;padding:14px 20px;background:linear-gradient(135deg,#1e293b,#334155);color:#fff;}
.dq-title{font-size:1.05em;font-weight:700;}
.dq-close{background:none;border:none;color:#fff;font-size:1.3em;cursor:pointer;padding:0 4px;line-height:1;}
.dq-close:hover{opacity:.7;}
.dq-sub{padding:8px 20px;background:#f8f9fa;color:#64748b;font-size:.88em;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;}
.dq-body{padding:16px 20px;overflow-y:auto;flex:1;}
.dq-footer{padding:12px 20px;border-top:1px solid #e2e8f0;text-align:right;background:#fafafa;display:flex;gap:8px;justify-content:flex-end;}
.dq-table{width:100%;border-collapse:collapse;font-size:.9em;}
.dq-table th,.dq-table td{padding:8px 10px;border-bottom:1px solid #e2e8f0;}
.dq-table thead th{background:#f8f9fa;color:#1e293b;font-weight:700;text-align:left;white-space:nowrap;}
.dq-table th.num,.dq-table td.num{text-align:right;font-variant-numeric:tabular-nums;}
.dq-table tbody tr:hover{background:#f1f5f9;}
.dq-badge{display:inline-block;padding:2px 10px;border-radius:6px;font-weight:700;font-size:11px;}`;
            document.head.appendChild(st);
        }
        let ov = document.getElementById('dqModalOverlay');
        if (ov) return ov;
        ov = document.createElement('div');
        ov.id = 'dqModalOverlay';
        ov.className = 'dq-overlay';
        ov.innerHTML = `
            <div class="dq-card">
                <div class="dq-header">
                    <span class="dq-title" id="dqTitle"></span>
                    <button type="button" class="dq-close" data-close>✕</button>
                </div>
                <div class="dq-sub"><span id="dqSub"></span><span id="dqNote" style="color:#94a3b8;"></span></div>
                <div class="dq-body" id="dqBody"></div>
                <div class="dq-footer" id="dqFooter">
                    <button type="button" class="btn" data-close>關閉</button>
                </div>
            </div>`;
        document.body.appendChild(ov);
        const card = ov.firstElementChild;
        // 關閉走事件委託：footer 按鈕每次開啟都會重建，必須委託到 overlay 才不會失效
        ov.addEventListener('click', (e) => {
            if (e.target.closest('[data-close]')) { ov.classList.remove('show'); return; }
            if (!card.contains(e.target)) ov.classList.remove('show');
        });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ov.classList.remove('show'); });
        return ov;
    };

    const DQ_NUM_KEY = /(_amt|_score|sub_amt|payment|cnt|days|diff|uid)$/i;
    DQ.fmtCell = function (k, v) {
        if (v === null || v === undefined || v === '') return '-';
        if (DQ_NUM_KEY.test(k) && !isNaN(Number(v))) {
            const n = Number(v);
            return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        return String(v);
    };

    DQ.openRule = async function (ruleId) {
        const ov = DQ.ensureModal();
        const body = ov.querySelector('#dqBody');
        const footer = ov.querySelector('#dqFooter');
        ov.querySelector('#dqTitle').textContent = `📋 規則 ${ruleId} 明細`;
        ov.querySelector('#dqSub').textContent = '載入中...';
        ov.querySelector('#dqNote').textContent = '';
        body.innerHTML = `<div style="text-align:center;padding:30px;color:#94a3b8;">⏳ 載入中...</div>`;
        // 重設 footer（保留關閉鈕）
        footer.innerHTML = `<button type="button" class="btn" data-close>關閉</button>`;
        ov.classList.add('show');

        try {
            const token = Auth.getToken();
            const res = await fetch(`/api/data-quality/rule-detail?rule_id=${encodeURIComponent(ruleId)}`, { headers: { Authorization: 'Bearer ' + token } });
            const j = await res.json();
            if (!j || !j.success) throw new Error((j && j.message) || 'API 失敗');
            const { rows, cols, note } = j.data || {};
            ov.querySelector('#dqSub').textContent = `共 ${rows.length} 筆命中資料`;

            if (!cols || cols.length === 0) {
                body.innerHTML = `<div style="text-align:center;padding:30px;color:#64748b;">ℹ️ ${note || '此規則無逐筆明細'}</div>`;
            } else if (rows.length === 0) {
                body.innerHTML = `<div style="text-align:center;padding:30px;color:#16a34a;">✅ 已無命中資料（可能已修復）</div>`;
            } else {
                body.innerHTML = `<div style="overflow-x:auto;"><table class="dq-table">
                    <thead><tr>${cols.map(c => `<th class="${DQ_NUM_KEY.test(c) ? 'num' : ''}">${c}</th>`).join('')}</tr></thead>
                    <tbody>${rows.map(r => `<tr>${cols.map(c => {
                        const isNum = DQ_NUM_KEY.test(c) && r[c] !== null && r[c] !== '';
                        return `<td class="${isNum ? 'num' : ''}">${DQ.fmtCell(c, r[c])}</td>`;
                    }).join('')}</tr>`).join('')}</tbody>
                </table></div>`;
                if (note) ov.querySelector('#dqNote').textContent = note;
            }

            // 一鍵修復按鈕
            if (FIXABLE[ruleId]) {
                const fixBtn = document.createElement('button');
                fixBtn.type = 'button';
                fixBtn.style.cssText = 'padding:8px 18px;border-radius:8px;background:#2563eb;color:#fff;border:none;cursor:pointer;font-weight:600;font-size:13px;';
                fixBtn.textContent = `🔧 一鍵修復`;
                fixBtn.onclick = () => DQ.doFix(ruleId, FIXABLE[ruleId]);
                footer.prepend(fixBtn);
            }
        } catch (err) {
            body.innerHTML = `<p style="color:#dc2626">❌ ${err.message}</p>`;
        }
    };

    DQ.doFix = async function (ruleId, label) {
        if (!confirm(`確認執行修復？\n\n規則：${ruleId}\n動作：${label}\n\n此操作將直接修改資料庫，建議先確認明細資料。`)) return;
        const ov = DQ.ensureModal();
        const body = ov.querySelector('#dqBody');
        body.innerHTML = `<div style="text-align:center;padding:30px;color:#2563eb;">⏳ 修復執行中...</div>`;
        try {
            const token = Auth.getToken();
            const res = await fetch('/api/data-quality/rule-fix', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
                body: JSON.stringify({ rule_id: ruleId })
            });
            const j = await res.json();
            if (!j || !j.success) throw new Error((j && j.message) || '修復失敗');
            body.innerHTML = `<div style="text-align:center;padding:30px;">
                <div style="font-size:34px;margin-bottom:10px;">✅</div>
                <div style="font-size:16px;font-weight:700;color:#16a34a;margin-bottom:6px;">修復完成：影響 ${j.data.affected} 筆</div>
                <div style="font-size:12px;color:#64748b;">${j.data.label}</div>
            </div>`;
            // 修復後重新掃描主頁面（彈窗保持顯示結果）
            loadAndRender();
        } catch (err) {
            body.innerHTML = `<p style="color:#dc2626">❌ ${err.message}</p>`;
        }
    };

    await loadAndRender();
});
