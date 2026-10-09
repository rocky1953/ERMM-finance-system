/**
 * 预警通知中心页面
 * M3：新增“日报告警规则”页签（主管）、通知列表网域筛选、立即扫描
 */
// 防 XSS：数据库字串拼入 HTML 前统一转义
function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

registerPage('alerts', async (c) => {
    const mgr = Auth.isManager();
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
            <h2 style="margin:0;font-size:20px;">${t('alert.title')} <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">${t('alert.subtitle')}</small></h2>
            <div id="alertTopActions">
                <button class="btn btn-outline" onclick="Alert.markAllRead()" style="margin-right:6px;">${t('alert.mark_all')}</button>
                <button class="btn btn-success" onclick="Alert.refresh()">🔄 ${t('refresh')}</button>
            </div>
        </div>
        <div class="tabs" style="margin-bottom:14px;">
            <button class="tab-btn active" id="atabLogs" onclick="Alert.switchTab('logs')">🔔 ${t('alert.tab_logs')}</button>
            ${mgr ? `<button class="tab-btn" id="atabRules" onclick="Alert.switchTab('rules')">📋 ${t('alert.tab_dr_rules')}</button>` : ''}
        </div>
        <div id="alertLogsPane">
            <div class="filter-bar" style="margin-bottom:12px;display:flex;gap:6px;align-items:center;">
                <span style="font-size:13px;color:#7f8c8d;">${t('alert.domain_label')}：</span>
                <button class="btn btn-sm btn-primary" id="adomAll" onclick="Alert.setDomain('')">${t('alert.domain_all')}</button>
                <button class="btn btn-sm btn-outline" id="adomFinance" onclick="Alert.setDomain('FINANCE')">${t('alert.domain_finance')}</button>
                <button class="btn btn-sm btn-outline" id="adomDr" onclick="Alert.setDomain('DAILY_REPORT')">${t('alert.domain_dr')}</button>
            </div>
            <div class="card"><div class="card-title">${t('alert.log_list')}</div><div id="alertList">${t('loading')}</div></div>
        </div>
        <div id="alertRulesPane" style="display:none;">
            <div class="card">
                <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
                    <span>📋 ${t('alert.dr_rules_title')}</span>
                    ${mgr ? `<button class="btn btn-sm btn-warning" onclick="Alert.runScan()">▶ ${t('alert.dr.scan_btn')}</button>` : ''}
                </div>
                <div id="drRuleList">${t('loading')}</div>
                <div id="drScanResult" style="margin-top:12px;"></div>
            </div>
        </div>
    `;
    Alert.domain = '';
    Alert.tab = 'logs';
    await Alert.loadLogs();
});

const Alert = {
    tab: 'logs',
    domain: '',
    rules: [],

    async refresh() {
        if (this.tab === 'rules') await this.loadRules();
        else await this.loadLogs();
    },

    switchTab(tab) {
        this.tab = tab;
        document.getElementById('atabLogs').classList.toggle('active', tab === 'logs');
        const r = document.getElementById('atabRules');
        if (r) r.classList.toggle('active', tab === 'rules');
        document.getElementById('alertLogsPane').style.display = tab === 'logs' ? '' : 'none';
        document.getElementById('alertRulesPane').style.display = tab === 'rules' ? '' : 'none';
        document.getElementById('alertTopActions').style.display = tab === 'logs' ? '' : 'none';
        if (tab === 'rules') this.loadRules();
    },

    setDomain(d) {
        this.domain = d;
        for (const [k, v] of [['adomAll', ''], ['adomFinance', 'FINANCE'], ['adomDr', 'DAILY_REPORT']]) {
            const el = document.getElementById(k);
            if (el) el.className = `btn btn-sm ${d === v ? 'btn-primary' : 'btn-outline'}`;
        }
        this.loadLogs();
    },

    async loadLogs() {
        const el = document.getElementById('alertList');
        try {
            let url = `/api/alert/logs?bu_no=${State.bu_no}&limit=50`;
            if (this.domain) url += `&domain=${this.domain}`;
            const res = await API.get(url);
            const logs = res.data || [];
            if (logs.length === 0) { el.innerHTML = UI.empty('🔔', t('alert.empty')); return; }
            el.innerHTML = logs.map(l => {
                const ic = l.level === 'danger' ? '🔴' : l.level === 'warning' ? '🟡' : '🔵';
                const bg = l.is_read ? '' : 'background:#fffafa;border-left:4px solid #e74c3c;';
                const domainBadge = l.alert_domain === 'DAILY_REPORT'
                    ? `<span style="font-size:10px;background:#8e44ad;color:#fff;padding:1px 6px;border-radius:3px;margin-left:4px;">${t('alert.domain_dr')}</span>`
                    : `<span style="font-size:10px;background:#7f8c8d;color:#fff;padding:1px 6px;border-radius:3px;margin-left:4px;">${t('alert.domain_finance')}</span>`;
                const scope = (l.alert_domain === 'DAILY_REPORT' && l.scope_name)
                    ? `<div class="alert-meta">👤 ${esc(l.scope_name)}</div>` : '';
                return `<div class="alert-item" style="${bg}">
                    <div class="alert-ic">${ic}</div>
                    <div class="alert-bd">
                        <div class="alert-at">${esc(l.title || '')}${domainBadge}${l.is_read ? '' : ' <span style="font-size:10px;background:#e74c3c;color:#fff;padding:1px 6px;border-radius:3px;">' + t('alert.unread') + '</span>'}</div>
                        <div class="alert-ad">${esc(l.message || '')}</div>
                        ${l.suggestion ? `<div class="alert-sg">💡 ${t('alert.suggestion')}：${esc(l.suggestion)}</div>` : ''}
                        ${scope}
                        <div class="alert-meta">⏰ ${(l.created_at || '').substring(0, 16)} · ${t('alert.channel')}：${esc(l.channel || '-')}</div>
                    </div>
                    <div class="alert-act">
                        ${!l.is_read ? `<button class="btn btn-sm btn-info" onclick="Alert.markRead(${l.uid})">${t('alert.mark_read')}</button>` : ''}
                        <button class="btn btn-sm btn-primary" onclick="navigate('actions')">${t('alert.create_action')}</button>
                    </div>
                </div>`;
            }).join('');
        } catch (e) { el.innerHTML = `<p style="color:#e74c3c">${esc(e.message)}</p>`; }
    },

    // ============ 日报规则 ============
    async loadRules() {
        const el = document.getElementById('drRuleList');
        el.innerHTML = t('loading');
        try {
            const res = await API.get('/api/alert/daily-rules');
            this.rules = res.data || [];
            if (this.rules.length === 0) { el.innerHTML = UI.empty('📋', t('alert.dr.rules_empty')); return; }
            el.innerHTML = `
                <div style="overflow-x:auto;">
                <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead><tr style="background:#f8f9fa;">
                        <th style="padding:8px;border:1px solid #eee;text-align:left;">${t('alert.dr.rule_name')}</th>
                        <th style="padding:8px;border:1px solid #eee;text-align:left;">${t('alert.dr.rule_desc')}</th>
                        <th style="padding:8px;border:1px solid #eee;">${t('alert.dr.threshold')}</th>
                        <th style="padding:8px;border:1px solid #eee;">${t('alert.dr.cooldown')}</th>
                        <th style="padding:8px;border:1px solid #eee;">${t('alert.dr.status')}</th>
                        <th style="padding:8px;border:1px solid #eee;">${t('common_op')}</th>
                    </tr></thead>
                    <tbody>
                        ${this.rules.map((r, i) => this.ruleRow(r, i)).join('')}
                    </tbody>
                </table>
                </div>`;
        } catch (e) { el.innerHTML = `<p style="color:#e74c3c">${esc(e.message)}</p>`; }
    },

    ruleDesc(r) {
        const c = r.rule_config || {};
        const f1 = v => Number(v).toFixed(1);
        switch (r.kpi_id) {
            case 'DR_MISSING_DAYS': return t('alert.dr.r1_desc', { days: f1(r.threshold), danger: f1(c.danger_days || 5) });
            case 'DR_DAILY_HOURS': return t('alert.dr.r2_desc', { min: f1(c.min_hours ?? 2), max: f1(c.max_hours ?? r.threshold) });
            case 'DR_MONTH_HOURS_DEV': return t('alert.dr.r3_desc', { pct: Math.round(Number(r.threshold) * 100), win: c.window_months || 6, day: c.min_eval_day || 10 });
            case 'DR_DELAY_OVER': return t('alert.dr.r4_desc');
            case 'DR_MONTH_UNLOCKED': return t('alert.dr.r5_desc', { hour: Math.round(Number(c.hour || r.threshold)) });
            default: return r.cond;
        }
    },

    ruleThresholdText(r) {
        const c = r.rule_config || {};
        const f1 = v => Number(v).toFixed(1);
        switch (r.kpi_id) {
            case 'DR_MISSING_DAYS': return `≥ ${f1(r.threshold)} / ${f1(c.danger_days || 5)} ${t('alert.dr.days_unit')}`;
            case 'DR_DAILY_HOURS': return `${f1(c.min_hours ?? 2)} ~ ${f1(c.max_hours ?? r.threshold)} h`;
            case 'DR_MONTH_HOURS_DEV': return `±${Math.round(Number(r.threshold) * 100)}%`;
            case 'DR_DELAY_OVER': return t('alert.dr.from_target');
            case 'DR_MONTH_UNLOCKED': return `${Math.round(Number(c.hour || r.threshold))}:00`;
            default: return String(r.threshold);
        }
    },

    ruleRow(r, i) {
        const on = Number(r.status) === 1;
        return `<tr>
            <td style="padding:8px;border:1px solid #eee;font-weight:600;white-space:nowrap;">${esc(r.rule_name)}</td>
            <td style="padding:8px;border:1px solid #eee;color:#555;">${this.ruleDesc(r)}</td>
            <td style="padding:8px;border:1px solid #eee;text-align:center;white-space:nowrap;">${this.ruleThresholdText(r)}</td>
            <td style="padding:8px;border:1px solid #eee;text-align:center;">${Math.round(Number(r.cooldown_hours))}${t('alert.dr.hours_unit')}</td>
            <td style="padding:8px;border:1px solid #eee;text-align:center;">
                <label class="switch" style="display:inline-block;position:relative;width:38px;height:20px;">
                    <input type="checkbox" ${on ? 'checked' : ''} onchange="Alert.toggleRule(${i}, this.checked)" style="opacity:0;width:0;height:0;">
                    <span style="position:absolute;cursor:pointer;inset:0;background:${on ? '#27ae60' : '#ccc'};border-radius:20px;transition:.2s;">
                        <span style="position:absolute;height:16px;width:16px;left:${on ? '20px' : '2px'};top:2px;background:#fff;border-radius:50%;transition:.2s;"></span>
                    </span>
                </label>
            </td>
            <td style="padding:8px;border:1px solid #eee;text-align:center;white-space:nowrap;">
                <button class="btn btn-sm btn-outline" onclick="Alert.editRule(${i})">${t('common_edit')}</button>
            </td>
        </tr>`;
    },

    async toggleRule(i, on) {
        const r = this.rules[i];
        try {
            await API.put(`/api/alert/daily-rules/${r.uid}`, { status: on ? 1 : 0 });
            UI.toast(t('alert.dr.saved'), 'success');
            r.status = on ? 1 : 0;
        } catch (e) { UI.toast(e.message, 'error'); this.loadRules(); }
    },

    editRule(i) {
        const r = this.rules[i];
        const c = r.rule_config || {};
        let fields = '';
        const num = (key, label, val, step = 'any', min = 0) =>
            `<div style="margin-bottom:10px;"><label style="display:block;font-size:13px;color:#555;margin-bottom:4px;">${label}</label>
             <input id="rf_${key}" type="number" class="form-control" step="${step}" min="${min}" value="${val}"></div>`;

        const f1 = v => Number(v).toFixed(1);
        switch (r.kpi_id) {
            case 'DR_MISSING_DAYS':
                fields = num('threshold', t('alert.dr.f_warn_days'), f1(r.threshold), 1, 1)
                       + num('danger_days', t('alert.dr.f_danger_days'), f1(c.danger_days ?? 5), 1, 1)
                       + num('cooldown', t('alert.dr.f_cooldown'), Math.round(Number(r.cooldown_hours)), 1, 1);
                break;
            case 'DR_DAILY_HOURS':
                fields = num('min_hours', t('alert.dr.f_min_hours'), f1(c.min_hours ?? 2))
                       + num('max_hours', t('alert.dr.f_max_hours'), f1(c.max_hours ?? r.threshold))
                       + num('cooldown', t('alert.dr.f_cooldown'), Math.round(Number(r.cooldown_hours)), 1, 1);
                break;
            case 'DR_MONTH_HOURS_DEV':
                fields = num('threshold', t('alert.dr.f_dev_pct'), Math.round(Number(r.threshold) * 100), 1, 1)
                       + num('window_months', t('alert.dr.f_window'), c.window_months ?? 6, 1, 3)
                       + num('min_eval_day', t('alert.dr.f_min_day'), c.min_eval_day ?? 10, 1, 1)
                       + num('cooldown', t('alert.dr.f_cooldown'), Math.round(Number(r.cooldown_hours)), 1, 1);
                break;
            case 'DR_DELAY_OVER':
                fields = `<div class="alert alert-warning" style="background:#fff8e1;padding:10px;border-radius:6px;font-size:13px;margin-bottom:10px;">${t('alert.dr.r4_edit_tip')}</div>`
                       + num('cooldown', t('alert.dr.f_cooldown'), Math.round(Number(r.cooldown_hours)), 1, 1);
                break;
            case 'DR_MONTH_UNLOCKED':
                fields = num('hour', t('alert.dr.f_hour'), Math.round(Number(c.hour ?? 16)), 1, 0)
                       + num('cooldown', t('alert.dr.f_cooldown'), Math.round(Number(r.cooldown_hours)), 1, 1);
                break;
        }
        UI.modal(`⚙️ ${t('alert.dr.edit_title')}：${esc(r.rule_name)}`,
            `<div style="min-width:320px;">${fields}</div>`,
            `<button class="btn btn-outline" onclick="UI.closeModal()">${t('common_cancel')}</button>
             <button class="btn btn-primary" onclick="Alert.saveRule(${i})">${t('common_save')}</button>`);
    },

    async saveRule(i) {
        const r = this.rules[i];
        const get = (k) => { const el = document.getElementById(`rf_${k}`); return el ? Number(el.value) : undefined; };
        const body = {};
        const c = { ...(r.rule_config || {}) };
        switch (r.kpi_id) {
            case 'DR_MISSING_DAYS':
                body.threshold = get('threshold');
                c.danger_days = get('danger_days');
                body.cooldown_hours = get('cooldown');
                break;
            case 'DR_DAILY_HOURS':
                c.min_hours = get('min_hours');
                c.max_hours = get('max_hours');
                body.threshold = c.max_hours;
                body.cooldown_hours = get('cooldown');
                break;
            case 'DR_MONTH_HOURS_DEV':
                body.threshold = get('threshold') / 100;
                c.window_months = get('window_months');
                c.min_eval_day = get('min_eval_day');
                body.cooldown_hours = get('cooldown');
                break;
            case 'DR_DELAY_OVER':
                body.cooldown_hours = get('cooldown');
                break;
            case 'DR_MONTH_UNLOCKED':
                c.hour = get('hour');
                body.threshold = c.hour;
                body.cooldown_hours = get('cooldown');
                break;
        }
        body.rule_config = c;
        try {
            await API.put(`/api/alert/daily-rules/${r.uid}`, body);
            UI.closeModal();
            UI.toast(t('alert.dr.saved'), 'success');
            this.loadRules();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async runScan() {
        const box = document.getElementById('drScanResult');
        box.innerHTML = `<div style="padding:10px;color:#7f8c8d;">⏳ ${t('alert.dr.scanning')}</div>`;
        try {
            const res = await API.post('/api/alert/daily-scan/run', { bu_no: State.bu_no });
            const r = res.data || {};
            const created = r.created || [];
            box.innerHTML = `
                <div style="border:1px solid #d5f5e3;background:#eafaf1;border-radius:8px;padding:12px;font-size:13px;">
                    <div style="font-weight:700;color:#1e8449;margin-bottom:6px;">✅ ${t('alert.dr.scan_done')}（${r.bu_no} · ${(r.as_of || '').substring(0, 16).replace('T', ' ')}）</div>
                    <div>🆕 ${t('alert.dr.scan_created')}：<b>${created.length}</b>　
                         🔕 ${t('alert.dr.scan_suppressed')}：<b>${r.suppressed ?? 0}</b>　
                         🎯 ${t('alert.dr.scan_no_target')}：<b>${r.skipped_no_target ?? 0}</b>　
                         📊 ${t('alert.dr.scan_no_hist')}：<b>${r.insufficient_history ?? 0}</b></div>
                    <div>📧 ${t('alert.dr.scan_emailed')}：<b>${r.emailed ?? 0}</b>　❌ ${t('alert.dr.scan_email_fail')}：<b>${r.email_failed ?? 0}</b></div>
                    ${(r.errors || []).length ? `<div style="color:#c0392b;margin-top:6px;">⚠️ ${(r.errors || []).map(esc).join('；')}</div>` : ''}
                    ${created.length ? `<div style="margin-top:8px;">${created.map(x => `<span style="display:inline-block;background:#fff;border:1px solid #ddd;border-radius:4px;padding:2px 8px;margin:2px;font-size:12px;">${x.level === 'danger' ? '🔴' : '🟡'} ${esc(x.scope_name || x.scope_id)}：${esc(x.title || x.kpi_id)}</span>`).join('')}</div>` : ''}
                </div>`;
            this.loadLogs();
        } catch (e) {
            box.innerHTML = `<div style="color:#e74c3c;font-size:13px;">❌ ${esc(e.message)}</div>`;
        }
    },

    async markRead(uid) {
        try {
            await API.put(`/api/alert/logs/${uid}/read`);
            UI.toast(t('alert.mark_read_ok'), 'success');
            this.loadLogs();
        } catch (e) { UI.toast(e.message, 'error'); }
    },
    async markAllRead() {
        try {
            await API.put('/api/alert/logs/read-all', { bu_no: State.bu_no });
            UI.toast(t('alert.mark_all_ok'), 'success');
            this.loadLogs();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};
