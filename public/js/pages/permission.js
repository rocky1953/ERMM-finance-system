/**
 * 功能模块使用权限管理
 * 表格：行=模块，列=一般/操作员/管理员，支持列头全选/反选
 */
const PermissionPage = {
    matrix: [],

    async load() {
        if (!Auth.isLoggedIn()) { Auth.showLogin(); return; }
        document.getElementById('pageTitle').textContent = '功能模块使用权限';

        if (!Auth.isAdmin()) {
            document.getElementById('pageContent').innerHTML = `
                <div class="card" style="padding:40px;text-align:center;color:#e74c3c;">
                    ⛔ 僅管理員可進入此頁面
                </div>`;
            return;
        }
        await this.loadMatrix();
    },

    async loadMatrix() {
        const el = document.getElementById('pageContent');
        el.innerHTML = `<div style="padding:40px;text-align:center;color:#999;">⏳ 載入權限矩陣…</div>`;
        try {
            const res = await API.get('/api/permission/matrix');
            this.matrix = res.data || [];
            this.render();
        } catch (e) {
            el.innerHTML = `<div class="card" style="padding:40px;color:#e74c3c;">${e.message}</div>`;
        }
    },

    render() {
        const el = document.getElementById('pageContent');
        // 按 module_group 分组
        const groups = {};
        for (const m of this.matrix) {
            if (!groups[m.module_group]) groups[m.module_group] = [];
            groups[m.module_group].push(m);
        }
        const groupNames = Object.keys(groups);

        // 表头带全选/反选按钮（用户要求）
        const header = `
            <div class="page-header">
                <div style="font-weight:700;font-size:18px;">功能模組使用權限清單</div>
                <div style="color:#888;font-size:13px;">
                    點擊各分組表頭的「☑/☐」按鈕可全選或全部取消該分組、該角色的模組權限，不影響其他分組
                </div>
            </div>
        `;

        // 列头全选/反选按钮（仅作用于当前分组的模块）
        const colHeader = (role, label, group) => `
            <div style="text-align:center;min-width:140px;">
                <div style="font-weight:600;">${label}</div>
                <div style="margin-top:4px;">
                    <button class="btn btn-ghost" style="padding:2px 8px;font-size:12px;"
                        onclick="PermissionPage.colToggle('${role}', true, '${group}')">☑ 全選</button>
                    <button class="btn btn-ghost" style="padding:2px 8px;font-size:12px;"
                        onclick="PermissionPage.colToggle('${role}', false, '${group}')">☐ 取消</button>
                </div>
            </div>
        `;

        // 分组渲染
        let body = '';
        for (const g of groupNames) {
            const rows = groups[g];
            const gid = 'grp_' + g.replace(/[^a-zA-Z0-9]/g, '_');

            // 分组级按钮
            body += `
            <div class="card" style="margin-bottom:20px;">
                <div style="padding:12px 16px;background:#f8f9fa;border-bottom:1px solid #eee;font-weight:700;display:flex;justify-content:space-between;align-items:center;">
                    <span>📁 ${g} <span style="color:#888;font-weight:normal;font-size:13px;">（${rows.length} 個模組）</span></span>
                    <div>
                        <button class="btn btn-ghost" style="padding:2px 8px;font-size:12px;"
                            onclick="PermissionPage.groupToggle('${g}', 'general', true)">一般全部選</button>
                        <button class="btn btn-ghost" style="padding:2px 8px;font-size:12px;"
                            onclick="PermissionPage.groupToggle('${g}', 'general', false)">一般取消</button>
                        <button class="btn btn-ghost" style="padding:2px 8px;font-size:12px;"
                            onclick="PermissionPage.groupToggle('${g}', 'operator', true)">操作員全部選</button>
                        <button class="btn btn-ghost" style="padding:2px 8px;font-size:12px;"
                            onclick="PermissionPage.groupToggle('${g}', 'operator', false)">操作員取消</button>
                        <button class="btn btn-ghost" style="padding:2px 8px;font-size:12px;"
                            onclick="PermissionPage.groupToggle('${g}', 'admin', true)">管理員全部選</button>
                        <button class="btn btn-ghost" style="padding:2px 8px;font-size:12px;"
                            onclick="PermissionPage.groupToggle('${g}', 'admin', false)">管理員取消</button>
                    </div>
                </div>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th style="width:200px;">功能模組</th>
                            <th style="width:150px;">模組代碼</th>
                            <th>${colHeader('general', '一般', g)}</th>
                            <th>${colHeader('operator', '操作員', g)}</th>
                            <th>${colHeader('admin', '管理員', g)}</th>
                        </tr>
                    </thead>
                    <tbody>
                    ${rows.map(r => `
                        <tr id="row_${r.module_code}">
                            <td style="font-weight:600;">${r.module_name}</td>
                            <td style="color:#888;font-family:monospace;">${r.module_code}</td>
                            ${['general','operator','admin'].map(r2 => `
                                <td style="text-align:center;">
                                    <input type="checkbox" id="chk_${r.module_code}_${r2}"
                                        ${r['allow_' + r2] ? 'checked' : ''}
                                        onchange="PermissionPage.saveOne('${r.module_code}','${r2}')"
                                        style="width:18px;height:18px;cursor:pointer;">
                                </td>
                            `).join('')}
                        </tr>
                    `).join('')}
                    </tbody>
                </table>
            </div>`;
        }

        el.innerHTML = header + body;
    },

    // 保存单个勾选
    async saveOne(code, role) {
        const colMap = { general: 'allow_general', operator: 'allow_operator', admin: 'allow_admin' };
        const el = document.getElementById('chk_' + code + '_' + role);
        const val = el.checked ? 1 : 0;
        try {
            await API.post('/api/permission/module/' + encodeURIComponent(code), { [colMap[role]]: val });
            // 本地 matrix 同步
            const row = this.matrix.find(x => x.module_code === code);
            if (row) row[colMap[role]] = val;
        } catch (e) {
            el.checked = !el.checked;  // 还原
            UI.toast(e.message, 'error');
        }
    },

    // 列头全选/反选（指定角色；有 group 时仅该分组，否则全部模块）
    async colToggle(role, enable, group) {
        const colMap = { general: 'allow_general', operator: 'allow_operator', admin: 'allow_admin' };
        const targets = group ? this.matrix.filter(m => m.module_group === group) : this.matrix.slice();
        const codes = targets.map(m => m.module_code);
        if (!codes.length) return;
        try {
            UI.toast(`${enable ? '全選' : '全部取消'} ${codes.length} 個模組${group ? `「${group}」` : ''} → ${role}`, 'info');
            await API.post('/api/permission/batch', { role, enabled: enable ? 1 : 0, module_codes: codes });
            // 本地更新（仅影响目标模块）
            targets.forEach(m => { m[colMap[role]] = enable ? 1 : 0; });
            // DOM 更新
            codes.forEach(c => {
                const el = document.getElementById('chk_' + c + '_' + role);
                if (el) el.checked = enable;
            });
            UI.toast('✅ 已更新', 'success');
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // 分组级批量
    async groupToggle(group, role, enable) {
        const colMap = { general: 'allow_general', operator: 'allow_operator', admin: 'allow_admin' };
        try {
            UI.toast(`${enable ? '全選' : '全部取消'} 「${group}」→ ${role}`, 'info');
            await API.post('/api/permission/batch', { role, enabled: enable ? 1 : 0, group_code: group });
            // 本地更新
            this.matrix.forEach(m => {
                if (m.module_group === group) m[colMap[role]] = enable ? 1 : 0;
            });
            // DOM 更新
            this.matrix.forEach(m => {
                if (m.module_group === group) {
                    const el = document.getElementById('chk_' + m.module_code + '_' + role);
                    if (el) el.checked = enable;
                }
            });
            UI.toast('✅ 已更新', 'success');
        } catch (e) { UI.toast(e.message, 'error'); }
    },
};

registerPage('permission', () => PermissionPage.load());
