/**
 * 行动追踪看板页面
 * 待处理 / 进行中 / 已完成 三栏 Kanban
 * 状态/优先级下拉来自 ACTION_STATUS / ACTION_PRIORITY 码表
 */
const ACT_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] ?? zh);

// 码值 → 多语言标签（不依赖 DB 里存的 value_description，避免英文模式出中文）
const ACT_PR_LABEL = {
    low:    ACT_L('低', '低', 'Low'),
    medium: ACT_L('中', '中', 'Medium'),
    high:   ACT_L('高', '高', 'High')
};
const ACT_ST_LABEL = {
    pending: ACT_L('待处理', '待處理', 'Pending'),
    doing:   ACT_L('进行中', '進行中', 'In Progress'),
    done:    ACT_L('已完成', '已完成', 'Done')
};

registerPage('actions', async (c) => {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h2 style="margin:0;font-size:20px;">${ACT_L('行动追踪看板', '行動追蹤看板', 'Action Tracking')} <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">${ACT_L('从红灯到行动的闭环管理', '從紅燈到行動的閉環管理', 'Closed-loop management from red flags to actions')}</small></h2>
            <button class="btn btn-primary" onclick="ActionForm.open()">${ACT_L('➕ 新建行动', '➕ 新建行動', '➕ New Action')}</button>
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
        const empty = `<div class="kb-empty">${ACT_L('暂无任务', '暫無任務', 'No tasks')}</div>`;
        el.innerHTML = `
            <div class="kanban-col">
                <div class="kanban-col-hd"><span>${ACT_L('⏳ 待处理', '⏳ 待處理', '⏳ Pending')}</span><span class="kb-cnt">${cols.pending.length}</span></div>
                ${cols.pending.map(taskCard).join('') || empty}
            </div>
            <div class="kanban-col">
                <div class="kanban-col-hd"><span>${ACT_L('🔄 进行中', '🔄 進行中', '🔄 In Progress')}</span><span class="kb-cnt">${cols.doing.length}</span></div>
                ${cols.doing.map(taskCard).join('') || empty}
            </div>
            <div class="kanban-col">
                <div class="kanban-col-hd"><span>${ACT_L('✅ 已完成', '✅ 已完成', '✅ Done')}</span><span class="kb-cnt">${cols.done.length}</span></div>
                ${cols.done.map(taskCard).join('') || empty}
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

// 下拉选项生成（读码表，回退硬编码；显示文字按当前语言映射）
async function _actionPrOpts() {
    const list = await CodeHelper.list('ACTION_PRIORITY', [
        { code_value: 'low' },
        { code_value: 'medium' },
        { code_value: 'high' }
    ]);
    return list.map(o => `<option value="${o.code_value}">${ACT_PR_LABEL[o.code_value] || o.value_description || o.code_value}</option>`).join('');
}
async function _actionStOpts() {
    const list = await CodeHelper.list('ACTION_STATUS', [
        { code_value: 'pending' },
        { code_value: 'doing' },
        { code_value: 'done' }
    ]);
    return list.map(o => `<option value="${o.code_value}">${ACT_ST_LABEL[o.code_value] || o.value_description || o.code_value}</option>`).join('');
}

// 新建任务表单
const ActionForm = {
    async open() {
        const prSel = await _actionPrOpts();
        UI.modal(ACT_L('新建行动任务', '新建行動任務', 'New Action Task'), `
            <div class="form-row"><label>${ACT_L('任务标题 *', '任務標題 *', 'Task Title *')}</label><input id="af_title" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;"></div>
            <div class="form-row"><label>${ACT_L('描述', '描述', 'Description')}</label><textarea id="af_desc" rows="3" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;"></textarea></div>
            <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div><label>${ACT_L('负责人', '負責人', 'Assignee')}</label><input id="af_assignee" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;"></div>
                <div><label>${ACT_L('截止日', '截止日', 'Due Date')}</label><input type="date" id="af_due" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;"></div>
            </div>
            <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div><label>${ACT_L('优先级', '優先級', 'Priority')}</label>
                    <select id="af_pr" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;">${prSel}</select></div>
                <div><label>${ACT_L('来源指标', '來源指標', 'Source KPI')}</label><input id="af_kpi" placeholder="${ACT_L('如 gross_profit', '如 gross_profit', 'e.g. gross_profit')}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;"></div>
            </div>
        `, `<button class="btn btn-ghost" onclick="UI.closeModal()">${ACT_L('取消', '取消', 'Cancel')}</button>
            <button class="btn btn-primary" onclick="ActionForm.save()">${ACT_L('储存', '儲存', 'Save')}</button>`);
        document.getElementById('af_pr').value = 'medium';
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
        if (!data.title) { UI.toast(ACT_L('请输入标题', '請輸入標題', 'Please enter a title'), 'error'); return; }
        try {
            await API.post('/api/action', data);
            UI.toast(ACT_L('行动任务已建立', '行動任務已建立', 'Action task created'), 'success');
            UI.closeModal();
            loadActions();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};

// 任务详情（更新状态/进度）
const ActionDetail = {
    async open(uid) {
        const res = await API.get(`/api/action/${uid}`);
        const t = res.data;
        const stSel = await _actionStOpts();
        UI.modal(`${ACT_L('任务：', '任務：', 'Task: ')}${t.title}`, `
            <p><b>${ACT_L('描述：', '描述：', 'Description: ')}</b>${t.description || '-'}</p>
            <p><b>${ACT_L('负责人：', '負責人：', 'Assignee: ')}</b>${t.assignee || '-'} ｜ <b>${ACT_L('截止日：', '截止日：', 'Due Date: ')}</b>${t.due_date || '-'} ｜ <b>${ACT_L('优先级：', '優先級：', 'Priority: ')}</b>${t.priority}</p>
            <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">
                <div><label>${ACT_L('状态', '狀態', 'Status')}</label>
                    <select id="ad_status" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;">
                        ${stSel}
                    </select>
                </div>
                <div><label>${ACT_L('进度', '進度', 'Progress')} ${t.progress}%</label>
                    <input type="range" id="ad_prg" min="0" max="100" value="${t.progress}" oninput="document.getElementById('ad_prg_v').textContent=this.value+'%'">
                    <span id="ad_prg_v">${t.progress}%</span>
                </div>
            </div>
        `, `<button class="btn btn-ghost" onclick="UI.closeModal()">${ACT_L('关闭', '關閉', 'Close')}</button>
            <button class="btn btn-danger" onclick="ActionDetail.del(${t.uid})">${ACT_L('删除', '刪除', 'Delete')}</button>
            <button class="btn btn-primary" onclick="ActionDetail.save(${t.uid})">${ACT_L('储存', '儲存', 'Save')}</button>`);
        if (t.status) document.getElementById('ad_status').value = t.status;
    },
    async save(uid) {
        try {
            await API.put(`/api/action/${uid}`, {
                status: document.getElementById('ad_status').value,
                progress: Number(document.getElementById('ad_prg').value)
            });
            UI.toast(ACT_L('已更新', '已更新', 'Updated'), 'success');
            UI.closeModal();
            loadActions();
        } catch (e) { UI.toast(e.message, 'error'); }
    },
    async del(uid) {
        if (!confirm(ACT_L('确认删除此任务?', '確認刪除此任務?', 'Delete this task?'))) return;
        try {
            await API.del(`/api/action/${uid}`);
            UI.toast(ACT_L('已删除', '已刪除', 'Deleted'), 'success');
            UI.closeModal();
            loadActions();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};
