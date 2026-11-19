/**
 * T-3 数据质量自动扫描 — 前端页面
 */
const DQ_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] ?? zh);

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
        'I-PAY': DQ_L('将 payment 修正为发票金额（sub_amt），消除超收/超付', '將 payment 修正為發票金額（sub_amt），消除超收/超付', 'Correct payment to the invoice amount (sub_amt), removing over/under-collection'),
        'F-OLD': DQ_L('为 forecast_detail 增加 status 字段（若缺）并将过期月份标记为 archive', '為 forecast_detail 增加 status 欄位（若缺）並將過期月份標記為 archive', 'Add a status column to forecast_detail (if missing) and mark expired months as archive'),
        'I-DUP': DQ_L('重复发票去重：每组 invoice_no 仅保留 uid 最小一笔（其余删除）', '重複發票去重：每組 invoice_no 僅保留 uid 最小一筆（其餘刪除）', 'Deduplicate invoices: keep only the record with the smallest uid per invoice_no group (delete the rest)'),
        'S-DUP': DQ_L('财务摘要去重：每组 bu_no+YYYY_MM 仅保留 uid 最小一笔（其余删除）', '財務摘要去重：每組 bu_no+YYYY_MM 僅保留 uid 最小一筆（其餘刪除）', 'Deduplicate financial summaries: keep only the record with the smallest uid per bu_no+YYYY_MM group (delete the rest)')
    };

    async function apiScan() {
        const token = Auth.getToken();
        const res = await fetch('/api/data-quality/scan', { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
        const j = await res.json();
        if (!j || !j.success) throw new Error((j && j.message) || DQ_L('API 响应失败', 'API 回應失敗', 'API response failed'));
        if (!j.data) throw new Error(DQ_L('API 无 data 字段', 'API 無 data 欄位', 'API returned no data field'));
        return j.data;
    }

    async function loadAndRender() {
        container.innerHTML = `<div style="padding:40px;text-align:center;color:#94a3b8;">${DQ_L('⏳ 正在扫描所有数据表...', '⏳ 正在掃描所有資料表...', '⏳ Scanning all data tables...')}</div>`;
        try {
            const data = await apiScan();
            container.innerHTML = renderAll(data);
            const btn = container.querySelector('[data-rescan]');
            if (btn) btn.onclick = () => loadAndRender();
        } catch (err) {
            container.innerHTML = `<div style="padding:40px;text-align:center;color:#dc2626;">${DQ_L('❌ 扫描失败: ', '❌ 掃描失敗: ', '❌ Scan failed: ')}${err.message}</div>`;
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
            <h1 style="margin:0;font-size:20px;font-weight:700;color:#1e293b;">${DQ_L('🛠️ 数据质量自动扫描', '🛠️ 數據質量自動掃描', '🛠️ Data Quality Auto Scan')}</h1>
            <p style="margin:4px 0 14px;color:#64748b;font-size:13px;">${DQ_L('20+ 项自动检查：Z_score 未计算 · 重复记录 · 金额异常 · 逾期 forecast · AR 对账差异 · 表级健康度', '20+ 項自動檢查：Z_score 未計算 · 重複記錄 · 金額異常 · 逾期 forecast · AR 對帳差異 · 表級健康度', '20+ automated checks: Z_score missing · duplicate records · abnormal amounts · stale forecast · AR reconciliation gaps · table health')}</p>
            <button data-rescan style="padding:8px 20px;border-radius:8px;background:#3b82f6;color:#fff;border:none;cursor:pointer;font-weight:600;font-size:13px;">${DQ_L('🔄 重新扫描', '🔄 重新掃描', '🔄 Rescan')}</button>
        </div>`;

        // 概览卡片
        const cards = [
            { label: DQ_L('扫描检查项', '掃描檢查項', 'Check Items'), value: '20+', sub: DQ_L('7 大类', '7 大類', '7 categories'), color: '#0ea5e9' },
            { label: DQ_L('扫描耗时', '掃描耗時', 'Scan Duration'), value: data.duration_ms + 'ms', sub: DQ_L('全表级', '全表級', 'table-level'), color: '#22c55e' },
            { label: '🔴 ERROR', value: c.ERROR, sub: DQ_L('需立即处理', '需立即處理', 'action required now'), color: '#dc2626' },
            { label: '🟡 WARN', value: c.WARN, sub: DQ_L('建议处理', '建議處理', 'fix recommended'), color: '#eab308' },
            { label: '🔵 INFO', value: c.INFO, sub: DQ_L('提示信息', '提示資訊', 'informational'), color: '#3b82f6' }
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
                    <div style="font-size:14px;font-weight:600;color:#334155;">${cat.icon || ''} ${I18N.fixAlert(cat.label)}</div>
                    <div style="font-size:12px;">${hasIssues
                        ? `<span style="color:#dc2626;font-weight:600;">● ${cat.issues.length} ${DQ_L('项问题', '項問題', 'issues')}</span>`
                        : `<span style="color:#16a34a;font-weight:600;">${DQ_L('✅ 全绿', '✅ 全綠', '✅ All Clear')}</span>`}</div>
                </div>`;
            if (!hasIssues) {
                html += `<div style="padding:14px 20px;color:#94a3b8;font-size:12px;">${DQ_L('此类别未发现问题', '此類別未發現問題', 'No issues in this category')}</div>`;
            } else {
                cat.issues.forEach(iss => {
                    const sc = SEV_COLOR[iss.severity] || SEV_COLOR.INFO;
                    const fixable = !!FIXABLE[iss.rule_id];
                    html += `<div data-rule="${iss.rule_id}" style="padding:12px 20px;border-bottom:1px solid #f8fafc;border-left:3px solid ${sc.border};cursor:pointer;transition:background .15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
                        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
                            <span style="background:${sc.bg};color:${sc.dot};padding:2px 10px;border-radius:6px;font-weight:700;font-size:11px;white-space:nowrap;">${sc.label}</span>
                            <span style="font-size:12px;color:#94a3b8;">rule_id=${iss.rule_id} · ${iss.table}</span>
                            <span style="margin-left:auto;font-size:11px;color:${fixable ? '#2563eb' : '#94a3b8'};white-space:nowrap;">${fixable ? DQ_L('🔧 可修复 · 点击查看明细', '🔧 可修復 · 點擊查看明細', '🔧 Fixable · click for details') : DQ_L('点击查看明细 →', '點擊查看明細 →', 'Click for details →')}</span>
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
                    <button type="button" class="btn" data-close>${DQ_L('关闭', '關閉', 'Close')}</button>
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
        ov.querySelector('#dqTitle').textContent = `📋 ${DQ_L('规则', '規則', 'Rule')} ${ruleId} ${DQ_L('明细', '明細', 'Details')}`;
        ov.querySelector('#dqSub').textContent = DQ_L('加载中...', '載入中...', 'Loading...');
        ov.querySelector('#dqNote').textContent = '';
        body.innerHTML = `<div style="text-align:center;padding:30px;color:#94a3b8;">${DQ_L('⏳ 加载中...', '⏳ 載入中...', '⏳ Loading...')}</div>`;
        // 重設 footer（保留關閉鈕）
        footer.innerHTML = `<button type="button" class="btn" data-close>${DQ_L('关闭', '關閉', 'Close')}</button>`;
        ov.classList.add('show');

        try {
            const token = Auth.getToken();
            const res = await fetch(`/api/data-quality/rule-detail?rule_id=${encodeURIComponent(ruleId)}`, { headers: { Authorization: 'Bearer ' + token } });
            const j = await res.json();
            if (!j || !j.success) throw new Error((j && j.message) || DQ_L('API 失败', 'API 失敗', 'API request failed'));
            const { rows, cols, note } = j.data || {};
            ov.querySelector('#dqSub').textContent = `${DQ_L('共', '共', 'Total')} ${rows.length} ${DQ_L('笔命中资料', '筆命中資料', 'matched records')}`;

            if (!cols || cols.length === 0) {
                body.innerHTML = `<div style="text-align:center;padding:30px;color:#64748b;">ℹ️ ${note || DQ_L('此规则无逐笔明细', '此規則無逐筆明細', 'No row-level details for this rule')}</div>`;
            } else if (rows.length === 0) {
                body.innerHTML = `<div style="text-align:center;padding:30px;color:#16a34a;">${DQ_L('✅ 已无命中资料（可能已修复）', '✅ 已無命中資料（可能已修復）', '✅ No matching records left (may already be fixed)')}</div>`;
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
                fixBtn.textContent = DQ_L('🔧 一键修复', '🔧 一鍵修復', '🔧 One-click Fix');
                fixBtn.onclick = () => DQ.doFix(ruleId, FIXABLE[ruleId]);
                footer.prepend(fixBtn);
            }
        } catch (err) {
            body.innerHTML = `<p style="color:#dc2626">❌ ${err.message}</p>`;
        }
    };

    DQ.doFix = async function (ruleId, label) {
        if (!confirm(`${DQ_L('确认执行修复？\n\n规则：', '確認執行修復？\n\n規則：', 'Confirm fix?\n\nRule: ')}${ruleId}\n${DQ_L('动作：', '動作：', 'Action: ')}${label}\n\n${DQ_L('此操作将直接修改数据库，建议先确认明细资料。', '此操作將直接修改資料庫，建議先確認明細資料。', 'This modifies the database directly. Please review the details first.')}`)) return;
        const ov = DQ.ensureModal();
        const body = ov.querySelector('#dqBody');
        body.innerHTML = `<div style="text-align:center;padding:30px;color:#2563eb;">${DQ_L('⏳ 修复执行中...', '⏳ 修復執行中...', '⏳ Fixing...')}</div>`;
        try {
            const token = Auth.getToken();
            const res = await fetch('/api/data-quality/rule-fix', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
                body: JSON.stringify({ rule_id: ruleId })
            });
            const j = await res.json();
            if (!j || !j.success) throw new Error((j && j.message) || DQ_L('修复失败', '修復失敗', 'Fix failed'));
            body.innerHTML = `<div style="text-align:center;padding:30px;">
                <div style="font-size:34px;margin-bottom:10px;">✅</div>
                <div style="font-size:16px;font-weight:700;color:#16a34a;margin-bottom:6px;">${DQ_L('修复完成：影响 ', '修復完成：影響 ', 'Fix completed: ')}${j.data.affected} ${DQ_L('笔', '筆', 'records')}</div>
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
