/**
 * 行動追蹤看板頁面
 * 待處理 / 進行中 / 已完成 三欄 Kanban
 */
registerPage('actions', async (c) => {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h2 style="margin:0;font-size:20px;">行動追蹤看板 <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">從紅燈到行動的閉環管理</small></h2>
            <button class="btn btn-primary" onclick="ActionForm.open()">➕ 新建行動</button>
        </div>
        <div class="kanban-board" id="kanbanBoard">${t('loading')}</div>
    `;
    await loadActions();
});

async function loadActions() {
    const el = document.getElementById('kanbanBoard');
    try {
        const res = await API.get(`/api/action?bu_no=${State.bu_no}`);
        const tasks = res.data || [];
        const cols = { pending: [], doing: [], done: [] };
        tasks.forEach(t => {
            if (cols[t.status]) cols[t.status].push(t);
            else cols.done.push(t);
        });
        el.innerHTML = `
            <div class="kanban-col">
                <div class="kanban-col-hd"><span>⏳ 待處理</span><span class="kb-cnt">${cols.pending.length}</span></div>
                ${cols.pending.map(taskCard).join('') || '<div class="kb-empty">暫無任務</div>'}
            </div>
            <div class="kanban-col">
                <div class="kanban-col-hd"><span>🔄 進行中</span><span class="kb-cnt">${cols.doing.length}</span></div>
                ${cols.doing.map(taskCard).join('') || '<div class="kb-empty">暫無任務</div>'}
            </div>
            <div class="kanban-col">
                <div class="kanban-col-hd"><span>✅ 已完成</span><span class="kb-cnt">${cols.done.length}</span></div>
                ${cols.done.map(taskCard).join('') || '<div class="kb-empty">暫無任務</div>'}
            </div>
        `;
    } catch (e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

function taskCard(t) {
    const isOverdue = t.status !== 'done' && t.due_date && new Date(t.due_date) < new Date();
    const prColor = t.priority === 'high' ? '#e74c3c' : t.priority === 'medium' ? '#f39c12' : '#95a5a6';
    return `<div class="kb-card ${isOverdue ? 'overdue' : ''}" onclick="ActionDetail.open(${t.uid})">
        <div class="kb-card-ttl">${t.title}${t.source_kpi ? ` <span style="font-size:10px;color:#7f8c8d;">[${t.source_kpi}]</span>` : ''}</div>
        <div class="kb-card-desc">${t.description || ''}</div>
        ${t.status === 'doing' ? `<div class="kb-prg"><div class="kb-prg-fg" style="width:${t.progress || 0}%"></div></div>` : ''}
        <div class="kb-card-meta">
            <span class="kb-av">${(t.assignee || '?').charAt(0)}</span>
            <span class="kb-due">${t.due_date ? '📅 ' + t.due_date : ''}</span>
            <span class="kb-pr" style="color:${prColor}">${t.priority}</span>
        </div>
    </div>`;
}

// 新建任務表單
const ActionForm = {
    open() {
        UI.modal('新建行動任務', `
            <div class="form-row"><label>任務標題 *</label><input id="af_title" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;"></div>
            <div class="form-row"><label>描述</label><textarea id="af_desc" rows="3" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;"></textarea></div>
            <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div><label>負責人</label><input id="af_assignee" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;"></div>
                <div><label>截止日</label><input type="date" id="af_due" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;"></div>
            </div>
            <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div><label>優先級</label><select id="af_pr" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;"><option value="low">低</option><option value="medium" selected>中</option><option value="high">高</option></select></div>
                <div><label>來源指標</label><input id="af_kpi" placeholder="如 gross_profit" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;"></div>
            </div>
        `, `<button class="btn btn-ghost" onclick="UI.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="ActionForm.save()">儲存</button>`);
    },
    async save() {
        const data = {
            bu_no: State.bu_no,
            title: document.getElementById('af_title').value.trim(),
            description: document.getElementById('af_desc').value,
            assignee: document.getElementById('af_assignee').value,
            due_date: document.getElementById('af_due').value,
            priority: document.getElementById('af_pr').value,
            source_kpi: document.getElementById('af_kpi').value,
            created_by: Auth.getUser()?.user_name || ''
        };
        if (!data.title) { UI.toast('請輸入標題', 'error'); return; }
        try {
            await API.post('/api/action', data);
            UI.toast('行動任務已建立', 'success');
            UI.closeModal();
            loadActions();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};

// 任務詳情（更新狀態/進度）
const ActionDetail = {
    open(uid) {
        API.get(`/api/action/${uid}`).then(res => {
            const t = res.data;
            UI.modal(`任務：${t.title}`, `
                <p><b>描述：</b>${t.description || '-'}</p>
                <p><b>負責人：</b>${t.assignee || '-'} ｜ <b>截止日：</b>${t.due_date || '-'} ｜ <b>優先級：</b>${t.priority}</p>
                <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">
                    <div><label>狀態</label>
                        <select id="ad_status" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;">
                            <option value="pending" ${t.status==='pending'?'selected':''}>待處理</option>
                            <option value="doing" ${t.status==='doing'?'selected':''}>進行中</option>
                            <option value="done" ${t.status==='done'?'selected':''}>已完成</option>
                        </select>
                    </div>
                    <div><label>進度 ${t.progress}%</label>
                        <input type="range" id="ad_prg" min="0" max="100" value="${t.progress}" oninput="document.getElementById('ad_prg_v').textContent=this.value+'%'">
                        <span id="ad_prg_v">${t.progress}%</span>
                    </div>
                </div>
            `, `<button class="btn btn-ghost" onclick="UI.closeModal()">關閉</button>
                <button class="btn btn-danger" onclick="ActionDetail.del(${t.uid})">刪除</button>
                <button class="btn btn-primary" onclick="ActionDetail.save(${t.uid})">儲存</button>`);
        });
    },
    async save(uid) {
        try {
            await API.put(`/api/action/${uid}`, {
                status: document.getElementById('ad_status').value,
                progress: Number(document.getElementById('ad_prg').value)
            });
            UI.toast('已更新', 'success');
            UI.closeModal();
            loadActions();
        } catch (e) { UI.toast(e.message, 'error'); }
    },
    async del(uid) {
        if (!confirm('確認刪除此任務?')) return;
        try {
            await API.del(`/api/action/${uid}`);
            UI.toast('已刪除', 'success');
            UI.closeModal();
            loadActions();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};
