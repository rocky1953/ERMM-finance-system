/**
 * 預警通知中心頁面
 */
registerPage('alerts', async (c) => {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h2 style="margin:0;font-size:20px;">預警通知中心 <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">觸閾值即自動推播</small></h2>
            <div>
                <button class="btn btn-outline" onclick="Alert.markAllRead()" style="margin-right:6px;">全部已讀</button>
                <button class="btn btn-success" onclick="loadAlerts()">🔄 重新整理</button>
            </div>
        </div>
        <div class="card"><div class="card-title">通知列表</div><div id="alertList">${t('loading')}</div></div>
    `;
    await loadAlerts();
});

async function loadAlerts() {
    const el = document.getElementById('alertList');
    try {
        const res = await API.get(`/api/alert/logs?bu_no=${State.bu_no}&limit=50`);
        const logs = res.data || [];
        if (logs.length === 0) { el.innerHTML = UI.empty('🔔', '暫無預警通知'); return; }
        el.innerHTML = logs.map(l => {
            const ic = l.level === 'danger' ? '🔴' : l.level === 'warning' ? '🟡' : '🔵';
            const bg = l.is_read ? '' : 'background:#fffafa;border-left:4px solid #e74c3c;';
            return `<div class="alert-item" style="${bg}">
                <div class="alert-ic">${ic}</div>
                <div class="alert-bd">
                    <div class="alert-at">${l.title}${l.is_read ? '' : ' <span style="font-size:10px;background:#e74c3c;color:#fff;padding:1px 6px;border-radius:3px;">未讀</span>'}</div>
                    <div class="alert-ad">${l.message || ''}</div>
                    ${l.suggestion ? `<div class="alert-sg">💡 建議：${l.suggestion}</div>` : ''}
                    <div class="alert-meta">⏰ ${l.created_at?.substring(0, 16) || ''} · 通道：${l.channel || '-'}</div>
                </div>
                <div class="alert-act">
                    ${!l.is_read ? `<button class="btn btn-sm btn-info" onclick="Alert.markRead(${l.uid})">已讀</button>` : ''}
                    <button class="btn btn-sm btn-primary" onclick="navigate('actions')">建立行動</button>
                </div>
            </div>`;
        }).join('');
    } catch (e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

const Alert = {
    async markRead(uid) {
        try {
            await API.put(`/api/alert/logs/${uid}/read`);
            UI.toast('已標記已讀', 'success');
            loadAlerts();
        } catch (e) { UI.toast(e.message, 'error'); }
    },
    async markAllRead() {
        try {
            await API.put('/api/alert/logs/read-all', { bu_no: State.bu_no });
            UI.toast('全部已標記已讀', 'success');
            loadAlerts();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};
