/**
 * 系统码表管理
 * 通用字典维护界面：type 左侧列表 + 右侧码值表（增删改）+ 新增弹窗
 */
registerPage('codeTable', async (c) => {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h2 style="margin:0;font-size:20px;">📚 ${t('codeTable.title') || '系统码表管理'}
                <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">${t('codeTable.sub') || '维护全局字典（类型 / 码值 / 描述 / 数字参数）'}</small></h2>
            <div>
                <button class="btn btn-primary" onclick="CodeTable.addType()">＋ ${t('codeTable.new_type') || '新增类型'}</button>
                <button class="btn btn-outline" onclick="CodeTable.addCode()">＋ ${t('codeTable.new_code') || '新增码值'}</button>
            </div>
        </div>
        <div style="display:flex;gap:16px;height:calc(100vh - 180px);">
            <!-- 左侧：类型列表 -->
            <div class="card" style="width:260px;overflow:auto;">
                <div class="card-title">${t('codeTable.code_types') || '字典类型'}</div>
                <div id="ctTypeList"></div>
            </div>
            <!-- 右侧：码值表 -->
            <div class="card" style="flex:1;overflow:auto;">
                <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
                    <span>${t('codeTable.code_values') || '码值列表'}：<b id="ctCurType">-</b></span>
                    <span id="ctStat" style="font-size:12px;color:#7f8c8d;"></span>
                </div>
                <div id="ctCodeList">${t('loading')}</div>
            </div>
        </div>
    `;
    await CodeTable.init();
});

const CodeTable = {
    types: [],       // [{code_type, cnt, has_active}]
    curType: null,
    codes: [],

    async init() {
        try {
            const res = await API.get('/api/codes/types');
            this.types = res.data || [];
            this.renderTypes();
            if (this.types.length) {
                this.curType = this.types[0].code_type;
                await this.loadCodes();
            }
        } catch (e) {
            document.getElementById('ctTypeList').innerHTML = `<p style="color:#e74c3c;padding:16px;">${e.message}</p>`;
        }
    },

    renderTypes() {
        const el = document.getElementById('ctTypeList');
        if (!this.types.length) { el.innerHTML = '<p style="color:#7f8c8d;padding:16px;">（尚无类型）</p>'; return; }
        el.innerHTML = this.types.map(t => `
            <div class="ct-type-item" data-type="${esc(t.code_type)}"
                 style="padding:10px 12px;border-bottom:1px solid #ecf0f1;cursor:pointer;
                        background:${this.curType === t.code_type ? '#eef4ff' : 'transparent'};
                        border-left:3px solid ${this.curType === t.code_type ? '#2563eb' : 'transparent'};">
                <div style="font-weight:600;color:#2c3e50;">${esc(t.code_type)}</div>
                <div style="font-size:11px;color:#7f8c8d;">${t.cnt} 项${t.has_active ? '' : ' · 全部停用'}</div>
            </div>
        `).join('');
        el.querySelectorAll('.ct-type-item').forEach(d => {
            d.onclick = () => { this.curType = d.dataset.type; this.renderTypes(); this.loadCodes(); };
        });
    },

    async loadCodes() {
        const el = document.getElementById('ctCodeList');
        const stat = document.getElementById('ctStat');
        document.getElementById('ctCurType').textContent = this.curType;
        if (!this.curType) { el.innerHTML = ''; stat.textContent = ''; return; }
        el.innerHTML = `<p style="color:#7f8c8d;padding:16px;">${t('loading')}</p>`;
        try {
            const res = await API.get(`/api/codes/list?code_type=${encodeURIComponent(this.curType)}`);
            this.codes = res.data || [];
            stat.textContent = `共 ${this.codes.length} 项`;
            this.renderCodes();
        } catch (e) { el.innerHTML = `<p style="color:#e74c3c;padding:16px;">${e.message}</p>`; stat.textContent = ''; }
    },

    renderCodes() {
        const el = document.getElementById('ctCodeList');
        if (!this.codes.length) {
            el.innerHTML = `<p style="color:#7f8c8d;padding:16px;">（${t('codeTable.empty') || '该类型下暂无码值，点右上「＋新增码值」添加'}）</p>`;
            return;
        }
        el.innerHTML = `
        <table class="data-table">
            <thead><tr>
                <th>${t('codeTable.code_value') || '码值'}</th>
                <th>${t('codeTable.desc') || '描述'}</th>
                <th class="num">N1</th>
                <th class="num">N2</th>
                <th class="num">N3</th>
                <th>${t('codeTable.alpha') || '附加'}</th>
                <th style="width:60px;">${t('codeTable.status') || '状态'}</th>
                <th style="width:80px;">${t('codeTable.action') || '操作'}</th>
            </tr></thead>
            <tbody>${this.codes.map(c => `
                <tr data-id="${c.id}">
                    <td><b>${esc(c.code_value)}</b></td>
                    <td>${esc(c.value_description || '-')}</td>
                    <td class="num">${c.value_number1 ?? '-'}</td>
                    <td class="num">${c.value_number2 ?? '-'}</td>
                    <td class="num">${c.value_number3 ?? '-'}</td>
                    <td style="font-size:11px;color:#7f8c8d;">${esc([c.value_alpha1, c.value_alpha2].filter(Boolean).join(' · ') || '-')}</td>
                    <td>${c.inuse_flag === 'USE' ? '<span style="color:#27ae60;">●</span>' : '<span style="color:#95a5a6;">○</span>'}</td>
                    <td>
                        <button class="btn btn-outline" style="padding:3px 8px;font-size:12px;" onclick="CodeTable.edit(${c.id})">✎</button>
                        <button class="btn" style="padding:3px 8px;font-size:12px;color:#e74c3c;" onclick="CodeTable.del(${c.id}, '${esc(c.code_value)}')">🗑</button>
                    </td>
                </tr>`).join('')}</tbody>
        </table>`;
    },

    // ------- 弹窗：新增类型 -------
    async addType() {
        const name = prompt(t('codeTable.prompt_new_type') || '请输入新的字典类型代号（英文，如 RELATION_TYPE、WK_TYPE）：', '');
        if (!name) return;
        const clean = name.trim().toUpperCase().replace(/\s+/g, '_');
        if (!/^[A-Z0-9_]+$/.test(clean)) { alert(t('codeTable.bad_name') || '类型代号只能是大写英文字母、数字和下划线'); return; }
        // 同时创建第一笔码值作为入口
        const val = prompt(t('codeTable.prompt_first_value') || `为类型「${clean}」输入第一笔码值（可留空，之后再加）：`, '');
        try {
            await API.post('/api/codes', { code_type: clean, code_value: (val || clean).trim(), inuse_flag: 'USE' });
            await API.post('/api/codes/refresh', { code_type: clean });
            Codes.invalidate(clean);
            this.curType = clean;
            this.init();
        } catch (e) { alert(e.message); }
    },

    // ------- 弹窗：新增码值 -------
    addCode() {
        if (!this.curType) { alert(t('codeTable.no_type') || '请先选择或新增一个类型'); return; }
        this._openForm(null, this.curType);
    },

    edit(id) {
        const c = this.codes.find(x => x.id === id);
        if (!c) return;
        this._openForm(c, c.code_type);
    },

    _openForm(row, defaultType) {
        const edit = !!row;
        const title = edit ? (t('codeTable.edit_code') || '编辑码值') : (t('codeTable.new_code') || '新增码值');
        const mask = document.createElement('div');
        mask.className = 'modal-mask';
        mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center;';
        mask.innerHTML = `<div style="background:#fff;border-radius:10px;width:520px;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,0.2);">
            <div style="display:flex;justify-content:space-between;margin-bottom:12px;">
                <h3 style="margin:0;">${title}</h3>
                <button onclick="this.closest('.modal-mask').remove()" style="border:none;background:transparent;font-size:20px;cursor:pointer;">✕</button>
            </div>
            <div style="display:grid;grid-template-columns:100px 1fr;gap:10px;align-items:center;">
                <label>类型</label>
                <select id="ctFType" ${edit ? 'disabled' : ''} style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                    ${this.types.map(t => `<option value="${esc(t.code_type)}" ${t.code_type===defaultType?'selected':''}>${esc(t.code_type)}</option>`).join('')}
                    ${!edit ? '<option value="__NEW__">（+ 新增类型…）</option>' : ''}
                </select>
                <label>码值 <span style="color:#e74c3c;">*</span></label>
                <input id="ctFValue" value="${esc(row?.code_value || '')}" style="padding:7px;border:1px solid #ddd;border-radius:6px;" ${edit ? '' : ''}>
                <label>描述</label>
                <input id="ctFDesc" value="${esc(row?.value_description || '')}" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                <label>数字1</label>
                <input id="ctFN1" type="number" step="any" value="${row?.value_number1 ?? ''}" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                <label>数字2</label>
                <input id="ctFN2" type="number" step="any" value="${row?.value_number2 ?? ''}" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                <label>数字3</label>
                <input id="ctFN3" type="number" step="any" value="${row?.value_number3 ?? ''}" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                <label>附加α</label>
                <input id="ctFA1" value="${esc(row?.value_alpha1 || '')}" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                <label>附加β</label>
                <input id="ctFA2" value="${esc(row?.value_alpha2 || '')}" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                <label>排序</label>
                <input id="ctFSort" type="number" value="${row?.sort_order ?? 99}" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                <label>状态</label>
                <select id="ctFStatus" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                    <option value="USE" ${row?.inuse_flag!=='N'?'selected':''}>● ${t('codeTable.active') || '启用'}</option>
                    <option value="N" ${row?.inuse_flag==='N'?'selected':''}>○ ${t('codeTable.inactive') || '停用'}</option>
                </select>
            </div>
            <div style="text-align:right;margin-top:16px;">
                <button class="btn" onclick="this.closest('.modal-mask').remove()">${t('codeTable.cancel') || '取消'}</button>
                <button class="btn btn-primary" id="ctFSave">${t('codeTable.save') || '保存'}</button>
            </div>
        </div>`;
        document.body.appendChild(mask);
        mask.addEventListener('click', (e) => { if (e.target === mask) mask.remove(); });

        document.getElementById('ctFSave').onclick = async () => {
            let codeType = document.getElementById('ctFType').value;
            if (codeType === '__NEW__') {
                const n = prompt(t('codeTable.prompt_new_type') || '新类型代号（大写英文）：');
                if (!n) return;
                codeType = n.trim().toUpperCase().replace(/\s+/g, '_');
            }
            const code_value = document.getElementById('ctFValue').value.trim();
            if (!code_value) { alert(t('codeTable.empty_value') || '码值不能为空'); return; }
            const body = {
                code_type: codeType,
                code_value,
                value_description: document.getElementById('ctFDesc').value,
                value_number1: document.getElementById('ctFN1').value,
                value_number2: document.getElementById('ctFN2').value,
                value_number3: document.getElementById('ctFN3').value,
                value_alpha1: document.getElementById('ctFA1').value,
                value_alpha2: document.getElementById('ctFA2').value,
                sort_order: Number(document.getElementById('ctFSort').value || 99),
                inuse_flag: document.getElementById('ctFStatus').value
            };
            try {
                if (edit) {
                    await API.put(`/api/codes/${row.id}`, body);
                } else {
                    await API.post('/api/codes', body);
                }
                // 通知后端清缓存 + 前端清缓存
                await API.post('/api/codes/refresh', { code_type: codeType });
                Codes.invalidate(codeType);
                mask.remove();
                this.curType = codeType;
                await this.init();
            } catch (e) { alert(e.message); }
        };
    },

    async del(id, label) {
        if (!confirm(`${t('codeTable.confirm_delete') || '确定删除码值'}「${label}」?`)) return;
        try {
            await API.delete(`/api/codes/${id}`);
            if (this.curType) {
                await API.post('/api/codes/refresh', { code_type: this.curType });
                Codes.invalidate(this.curType);
            }
            this.loadCodes();
        } catch (e) { alert(e.message); }
    }
};
