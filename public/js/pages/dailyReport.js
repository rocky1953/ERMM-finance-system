/**
 * 工作日报表页面
 *   视图：list 列表查询 / form 新增编辑 / analysis 分析（time 时间分类、client 客户类别、wheel 生命平衡轮）
 * 全局唯一对象 DRApp（避免跨页函数名冲突）
 */
(function () {
    // DB 存中文 wk_type → i18n key
    const WK_KEYS = {
        '日常工作': 'dr.wk.work', '职业发展': 'dr.wk.career', '财务状况': 'dr.wk.finance',
        '健康': 'dr.wk.health', '娱乐休闲': 'dr.wk.leisure', '家庭': 'dr.wk.family',
        '朋友圈': 'dr.wk.friends', '个人成长': 'dr.wk.growth', '自我实现': 'dr.wk.actualize'
    };
    const COLORS = ['#3498db', '#9b59b6', '#e67e22', '#27ae60', '#1abc9c', '#e74c3c', '#f39c12', '#34495e', '#16a085'];

    // 防 XSS：所有源自用户输入（或数据库历史值）的字符串拼入 HTML 前必须转义
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    const DRApp = {
        c: null,
        meta: null,
        me: null,
        charts: [],
        view: 'list',
        filters: { year: '', month: '', depart_id: '', user_id: '', date_from: '', date_to: '', status1: '', page: 1, pageSize: 10 },
        list: [],
        total: 0,
        formRows: [],

        todayStr() {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        },
        wkLabel(v) { return WK_KEYS[v] ? t(WK_KEYS[v]) : (v || '-'); },

        destroyCharts() { this.charts.forEach(ch => { try { ch.destroy(); } catch (e) { } }); this.charts = []; },

        yearOptions(sel) {
            const y = new Date().getFullYear();
            let html = `<option value="">${t('dr.all')}</option>`;
            for (let yy = y + 1; yy >= y - 6; yy--) {
                html += `<option value="${yy}" ${String(sel) === String(yy) ? 'selected' : ''}>${yy}</option>`;
            }
            return html;
        },
        monthOptions(sel) {
            let html = `<option value="">${t('dr.all')}</option>`;
            for (let m = 1; m <= 12; m++) {
                const mm = String(m).padStart(2, '0');
                html += `<option value="${mm}" ${sel === mm ? 'selected' : ''}>${mm}</option>`;
            }
            return html;
        },
        writerOptions(sel) {
            const writers = (this.meta && this.meta.writers) || [];
            let html = `<option value="">${t('dr.all')}</option>` +
                writers.map(w => `<option value="${esc(w.user_id)}" ${sel === w.user_id ? 'selected' : ''}>${esc(w.user_id)} - ${esc(w.user_name || '')}</option>`).join('');
            return html;
        },
        deptOptions(sel) {
            const ds = (this.meta && this.meta.departments) || [];
            return `<option value="">${t('dr.all')}</option>` +
                ds.map(d => `<option value="${esc(d)}" ${sel === d ? 'selected' : ''}>${esc(d)}</option>`).join('');
        },

        // ============ 列表视图 ============
        async loadMeta() {
            if (this.meta) return;
            const res = await API.get('/api/daily-report/meta');
            this.meta = res.data;
            this.me = res.data.me;
            if (!this.filters.year) this.filters.year = new Date().getFullYear();
        },

        renderList() {
            this.view = 'list';
            this.destroyCharts();
            const mgr = !!(this.me && this.me.isManager);
            this.c.innerHTML = `
                <div class="card">
                    <div class="toolbar" style="flex-wrap:wrap;gap:10px;">
                        <label>${t('dr.year')}：<select id="drfYear">${this.yearOptions(this.filters.year)}</select></label>
                        <label>${t('dr.month')}：<select id="drfMonth">${this.monthOptions(this.filters.month)}</select></label>
                        ${mgr ? `<label>${t('dr.depart')}：<select id="drfDept">${this.deptOptions(this.filters.depart_id)}</select></label>
                                 <label>${t('dr.writer')}：<select id="drfUser">${this.writerOptions(this.filters.user_id)}</select></label>` : ''}
                        <label>${t('dr.date_from')}：<input type="date" id="drfFrom" value="${this.filters.date_from}"></label>
                        <label>${t('dr.date_to')}：<input type="date" id="drfTo" value="${this.filters.date_to}"></label>
                        <label>${t('dr.status')}：<select id="drfStatus">
                            <option value="">${t('dr.all')}</option>
                            <option value="USE" ${this.filters.status1 === 'USE' ? 'selected' : ''}>${t('dr.status.use')}</option>
                            <option value="NOUSE" ${this.filters.status1 === 'NOUSE' ? 'selected' : ''}>${t('dr.status.nouse')}</option>
                        </select></label>
                        <button class="btn btn-primary" onclick="DRApp.applyFilter()">🔍 ${t('dr.btn.query')}</button>
                    </div>
                    <div class="toolbar" style="flex-wrap:wrap;gap:8px;margin-top:6px;">
                        <button class="btn btn-success" onclick="DRApp.openForm()">➕ ${t('dr.btn.add')}</button>
                        <button class="btn" onclick="DRApp.openAnalysis('time')">📊 ${t('dr.btn.an_time')}</button>
                        <button class="btn" onclick="DRApp.openAnalysis('client')">🧩 ${t('dr.btn.an_client')}</button>
                        <button class="btn" onclick="DRApp.openAnalysis('wheel')">☸️ ${t('dr.btn.an_wheel')}</button>
                        <span style="margin-left:auto;color:#7f8c8d;font-size:0.9em;" id="drTotal"></span>
                    </div>
                    <div id="drTable">${t('loading')}</div>
                    <div class="toolbar" id="drPager" style="justify-content:flex-end;gap:8px;"></div>
                </div>`;
            this.loadList();
        },

        applyFilter() {
            this.filters.year = document.getElementById('drfYear').value;
            this.filters.month = document.getElementById('drfMonth').value;
            const de = document.getElementById('drfDept'), us = document.getElementById('drfUser');
            this.filters.depart_id = de ? de.value : '';
            this.filters.user_id = us ? us.value : '';
            this.filters.date_from = document.getElementById('drfFrom').value;
            this.filters.date_to = document.getElementById('drfTo').value;
            this.filters.status1 = document.getElementById('drfStatus').value;
            this.filters.page = 1;
            this.loadList();
        },

        async loadList() {
            const el = document.getElementById('drTable');
            if (!el) return;
            try {
                const f = this.filters;
                const qs = new URLSearchParams({ bu_no: State.bu_no, page: f.page, pageSize: f.pageSize });
                if (f.year) qs.set('year', f.year);
                if (f.month) qs.set('month', f.month);
                if (f.depart_id) qs.set('depart_id', f.depart_id);
                if (f.user_id) qs.set('user_id', f.user_id);
                if (f.date_from) qs.set('date_from', f.date_from);
                if (f.date_to) qs.set('date_to', f.date_to);
                if (f.status1) qs.set('status1', f.status1);

                const res = await API.get('/api/daily-report?' + qs.toString());
                this.list = res.data.list;
                this.total = res.data.total;
                f.page = res.data.page; f.pageSize = res.data.pageSize;
                this.renderTable();
                this.renderPager();
            } catch (e) {
                el.innerHTML = `<p style="color:#e74c3c">${t('dr.msg.load_fail')}: ${e.message}</p>`;
            }
        },

        renderTable() {
            const el = document.getElementById('drTable');
            const tot = document.getElementById('drTotal');
            if (tot) tot.textContent = t('dr.page_total').replace('{n}', this.total);
            if (this.list.length === 0) { el.innerHTML = UI.empty('📝', t('dr.empty')); return; }
            el.innerHTML = `<table class="data-table">
                <thead><tr>
                    <th>${t('dr.col.seq')}</th><th>${t('dr.col.date')}</th><th>${t('dr.col.hours')}</th>
                    <th>${t('dr.col.work')}</th><th>${t('dr.col.delay')}</th>
                    <th>${t('dr.col.unresolved')}</th><th>${t('dr.col.writer')}</th>
                    <th>${t('dr.col.action')}</th>
                </tr></thead>
                <tbody>${this.list.map((r, i) => {
                    const uid = esc(r.user_id || '');
                    const uname = esc(r.user_name || r.user_id || '');
                    const yearMonth = (r.report_date || '').slice(0, 7).split('-');
                    const year = yearMonth[0] || '';
                    const month = yearMonth[1] || '';
                    const hasDelay = !!r.projects1;
                    const hasUnres = !!r.projects2;
                    const cellClickCls = 'dr-cell-jump';
                    const delayTdCls = 'max-width:180px;color:#e67e22;' + (hasDelay ? 'cursor:pointer;text-decoration:underline;' : '');
                    const unresTdCls = 'max-width:180px;color:#e74c3c;' + (hasUnres ? 'cursor:pointer;text-decoration:underline;' : '');
                    const tdAttrs = (kind) => {
                        const has = kind === 'delay' ? hasDelay : hasUnres;
                        return has ? `class="${cellClickCls}" data-jump-kind="${kind}" data-jump-uid="${uid}" data-jump-uname="${uname}" data-jump-year="${year}" data-jump-month="${month}"` : '';
                    };
                    return `
                    <tr>
                        <td>${(this.filters.page - 1) * this.filters.pageSize + i + 1}</td>
                        <td>${esc(r.report_date)}</td>
                        <td class="num">${UI.fmt(r.total_hours)}</td>
                        <td style="max-width:280px;" title="${esc(r.work_text || '')}">${esc(r.work_text || '-')}</td>
                        <td style="${delayTdCls}" ${tdAttrs('delay')}>${hasDelay ? esc(r.projects1) : '-'}</td>
                        <td style="${unresTdCls}" ${tdAttrs('unres')}>${hasUnres ? esc(r.projects2) : '-'}</td>
                        <td>${uname}</td>
                        <td>
                            <button class="btn btn-sm btn-info" title="${t('edit')}" data-edit-id="${Number(r.id) || 0}" data-edit-date="${esc(r.report_date)}">✏️</button>
                            <button class="btn btn-danger btn-sm" data-del-id="${Number(r.id) || 0}">🗑</button>
                        </td>
                    </tr>`;
                }).join('')}</tbody>
            </table>`;
            // 编辑 / 删除事件 + 延误/未解单元格跳转（委托）
            el.querySelectorAll('button[data-edit-id]').forEach(btn => {
                btn.addEventListener('click', () => this.edit(Number(btn.dataset.editId), btn.dataset.editDate));
            });
            el.querySelectorAll('button[data-del-id]').forEach(btn => {
                btn.addEventListener('click', () => this.del(Number(btn.dataset.delId)));
            });
            el.querySelectorAll('td.dr-cell-jump').forEach(td => {
                td.style.cursor = 'pointer';
                td.title = t('dr.jump_to_unfinished') || '';
                td.addEventListener('click', () => {
                    navigate('dailyReportUnfinished', {
                        autoDetail: {
                            user_id: td.dataset.jumpUid,
                            user_name: td.dataset.jumpUname,
                            year: Number(td.dataset.jumpYear),
                            month: td.dataset.jumpMonth
                        }
                    });
                });
            });
        },

        renderPager() {
            const pg = document.getElementById('drPager');
            if (!pg) return;
            const pages = Math.max(1, Math.ceil(this.total / this.filters.pageSize));
            const p = this.filters.page;
            pg.innerHTML = `
                <button class="btn btn-sm" ${p <= 1 ? 'disabled' : ''} onclick="DRApp.goPage(1)">⏮</button>
                <button class="btn btn-sm" ${p <= 1 ? 'disabled' : ''} onclick="DRApp.goPage(${p - 1})">◀</button>
                <span>${p} / ${pages}</span>
                <button class="btn btn-sm" ${p >= pages ? 'disabled' : ''} onclick="DRApp.goPage(${p + 1})">▶</button>
                <button class="btn btn-sm" ${p >= pages ? 'disabled' : ''} onclick="DRApp.goPage(${pages})">⏭</button>`;
        },
        goPage(p) { this.filters.page = p; this.loadList(); },

        async del(id) {
            if (!confirm(t('dr.msg.del_confirm'))) return;
            try {
                await API.del('/api/daily-report/' + id);
                UI.toast(t('dr.msg.deleted'), 'success');
                this.loadList();
            } catch (e) { UI.toast(e.message, 'error'); }
        },

        // ============ 表单视图 ============
        openForm() {
            this.view = 'form';
            this.destroyCharts();
            this.formRows = [{ projects: '', from_time: '08:00', to_time: '08:30', wk_type: '日常工作', client_id: '', items_id: '' }];
            this.renderForm(this.todayStr(), null);
        },

        renderForm(dateStr, loaded) {
            const locked = Math.abs(this.daysFromToday(dateStr)) > 7;
            const clients = (this.meta.clients || []).map(x => `<option value="${esc(x)}">`).join('');
            const items = (this.meta.items || []).map(x => `<option value="${esc(x)}">`).join('');
            this.c.innerHTML = `
                <div class="card">
                    <div class="toolbar" style="flex-wrap:wrap;gap:10px;">
                        <label><b>${t('dr.form.report_date')}：</b><input type="date" id="drFormDate" value="${dateStr}" onchange="DRApp.onDateChange()"></label>
                        <button class="btn" onclick="DRApp.showGuide()">📖 ${t('dr.btn.guide')}</button>
                        <span id="drFormHint" style="color:#e67e22;font-size:0.9em;"></span>
                    </div>

                    <h3 style="margin:14px 0 8px;">${t('dr.form.detail_title')}</h3>
                    <table class="data-table">
                        <thead><tr>
                            <th style="width:50px;">${t('dr.col.seq')}</th>
                            <th>${t('dr.col.project')}</th>
                            <th style="width:110px;">${t('dr.col.from')}</th>
                            <th style="width:110px;">${t('dr.col.to')}</th>
                            <th style="width:140px;">${t('dr.col.wk_type')}</th>
                            <th style="width:80px;">${t('dr.col.hours')}</th>
                            <th style="width:140px;">${t('dr.col.client')}</th>
                            <th style="width:140px;">${t('dr.col.items')}</th>
                            <th style="width:60px;"></th>
                        </tr></thead>
                        <tbody id="drFormRows"></tbody>
                    </table>
                    <div class="toolbar" style="margin-top:8px;">
                        <button class="btn btn-sm" onclick="DRApp.addRow()">➕ ${t('dr.btn.add_row')}</button>
                        <span style="margin-left:auto;font-weight:700;">${t('dr.form.total_hours')}：<span id="drFormTotal">0.00</span> ${t('dr.axis.hours')}</span>
                    </div>

                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;">
                        <div>
                            <label><b>${t('dr.form.delay_today')}</b></label>
                            <textarea id="drFormP1" rows="8" style="width:100%;margin-top:4px;min-height:160px;" placeholder="${locked ? t('dr.form.lock_hint') : ''}" ${locked ? 'disabled' : ''}>${loaded ? esc(loaded.projects1 || '') : ''}</textarea>
                        </div>
                        <div>
                            <label><b>${t('dr.form.unresolved_now')}</b></label>
                            <textarea id="drFormP2" rows="8" style="width:100%;margin-top:4px;min-height:160px;" placeholder="${locked ? t('dr.form.lock_hint') : ''}" ${locked ? 'disabled' : ''}>${loaded ? esc(loaded.projects2 || '') : ''}</textarea>
                        </div>
                    </div>
                    ${locked ? `<div style="color:#e67e22;margin-top:8px;">⚠️ ${t('dr.form.lock_hint')}</div>` : ''}

                    <div class="toolbar" style="margin-top:14px;">
                        <button class="btn btn-primary" id="drSaveBtn" onclick="DRApp.save()">💾 ${t('save')}</button>
                        <button class="btn" onclick="DRApp.back()">↩️ ${t('dr.btn.back')}</button>
                    </div>
                    <datalist id="drClientList">${clients}</datalist>
                    <datalist id="drItemsList">${items}</datalist>
                </div>`;
            this.refreshRows();
        },

        daysFromToday(dateStr) {
            const t0 = new Date(dateStr + 'T00:00:00');
            const n = new Date();
            const today = new Date(n.getFullYear(), n.getMonth(), n.getDate());
            return Math.round((t0 - today) / 86400000);
        },

        onDateChange() {
            const dateStr = document.getElementById('drFormDate').value;
            if (!dateStr) return;
            // 切换日期：尝试载入该日本人已有日报
            this.loadExisting(dateStr);
        },

        async loadExisting(dateStr) {
            // 以本人身份查该日日报（员工后端强制本人；经理显式传自己）
            const qs = new URLSearchParams({
                bu_no: State.bu_no, date_from: dateStr, date_to: dateStr, page: 1, pageSize: 1
            });
            if (this.me && this.me.isManager) qs.set('user_id', this.me.user_id);
            try {
                const res = await API.get('/api/daily-report?' + qs.toString());
                const row = (res.data.list || [])[0];
                if (!row) { // 空白表单，仅应用锁定状态
                    const locked = Math.abs(this.daysFromToday(dateStr)) > 7;
                    const p1 = document.getElementById('drFormP1'), p2 = document.getElementById('drFormP2');
                    if (p1) { p1.value = ''; p1.disabled = locked; }
                    if (p2) { p2.value = ''; p2.disabled = locked; }
                    const hint = document.getElementById('drFormHint');
                    if (hint) hint.textContent = '';
                    return;
                }
                const got = await API.get('/api/daily-report/' + row.id);
                const m = got.data.master;
                this.formRows = got.data.details.map(d => ({
                    projects: d.projects || '', from_time: d.from_time || '', to_time: d.to_time || '',
                    wk_type: d.wk_type || '日常工作', client_id: d.client_id || '', items_id: d.items_id || ''
                }));
                this.renderForm(dateStr, m);
                const hint = document.getElementById('drFormHint');
                if (hint) hint.textContent = 'ID #' + m.id;
            } catch (e) {
                UI.toast(e.message, 'error');
            }
        },

        readRowsFromDom() {
            const trs = document.querySelectorAll('#drFormRows tr.dr-row');
            const rows = [];
            trs.forEach(tr => {
                rows.push({
                    projects: tr.querySelector('.dr-f-project').value.trim(),
                    from_time: tr.querySelector('.dr-f-from').value,
                    to_time: tr.querySelector('.dr-f-to').value,
                    wk_type: tr.querySelector('.dr-f-wk').value,
                    client_id: tr.querySelector('.dr-f-client').value.trim(),
                    items_id: tr.querySelector('.dr-f-items').value.trim()
                });
            });
            return rows;
        },

        syncRowTimes() {
            // 时间变更后重算各行小时与合计
            this.formRows = this.readRowsFromDom();
            const trs = document.querySelectorAll('#drFormRows tr.dr-row');
            let total = 0;
            trs.forEach((tr, i) => {
                const r = this.formRows[i];
                const h = this.calcHours(r.from_time, r.to_time);
                tr.querySelector('.dr-f-hours').textContent = h === null ? '-' : UI.fmt(h);
                if (h !== null) total += h;
            });
            const tot = document.getElementById('drFormTotal');
            if (tot) tot.textContent = UI.fmt(Math.round(total * 100) / 100);
        },

        calcHours(from, to) {
            const re = /^([01]\d|2[0-3]):[0-5]\d$/;
            if (!re.test(from || '') || !re.test(to || '')) return null;
            const [fh, fm] = from.split(':').map(Number);
            const [th, tm] = to.split(':').map(Number);
            const mins = (th * 60 + tm) - (fh * 60 + fm);
            if (mins <= 0) return null;
            return Math.round(mins / 60 * 100) / 100;
        },

        addRow() {
            this.formRows = this.readRowsFromDom();
            // 自动沿用上一行结束时间作为新行开始，预设 30 分钟（不超过 18:00）
            let nf = '', nt = '';
            const last = this.formRows[this.formRows.length - 1];
            if (last && /^([01]\d|2[0-3]):[0-5]\d$/.test(last.to_time || '')) {
                const [h, m] = last.to_time.split(':').map(Number);
                const endMin = h * 60 + m + 30;
                if (endMin <= 18 * 60) {
                    nf = last.to_time;
                    nt = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
                }
            }
            if (!nf) { nf = '08:00'; nt = '08:30'; }
            this.formRows.push({ projects: '', from_time: nf, to_time: nt, wk_type: '日常工作', client_id: '', items_id: '' });
            this.refreshRows();
        },
        delRow(btn) {
            this.formRows = this.readRowsFromDom();
            const idx = Number(btn.closest('tr').dataset.idx);
            this.formRows.splice(idx, 1);
            if (this.formRows.length === 0) this.formRows.push({ projects: '', from_time: '', to_time: '', wk_type: '日常工作', client_id: '', items_id: '' });
            this.refreshRows();
        },

        refreshRows() {
            const tb = document.getElementById('drFormRows');
            if (!tb) return;
            const wks = (this.meta.wk_types || ['日常工作']);
            tb.innerHTML = this.formRows.map((r, i) => `
                <tr class="dr-row" data-idx="${i}">
                    <td>${i + 1}</td>
                    <td><input class="dr-f-project" style="width:100%;min-width:200px;min-height:48px;" value="${esc(r.projects || '')}"></td>
                    <td><input type="time" class="dr-f-from" style="width:95px;min-height:48px;" min="08:00" max="18:00" value="${esc(r.from_time || '')}" onchange="DRApp.syncRowTimes()"></td>
                    <td><input type="time" class="dr-f-to" style="width:95px;min-height:48px;" min="08:00" max="18:00" value="${esc(r.to_time || '')}" onchange="DRApp.syncRowTimes()"></td>
                    <td><select class="dr-f-wk" style="min-height:48px;">${wks.map(w => `<option value="${esc(w)}" ${r.wk_type === w ? 'selected' : ''}>${this.wkLabel(w)}</option>`).join('')}</select></td>
                    <td class="num dr-f-hours" style="min-height:48px;">-</td>
                    <td><input class="dr-f-client" style="width:125px;min-height:48px;" list="drClientList" value="${esc(r.client_id || '')}"></td>
                    <td><input class="dr-f-items" style="width:125px;min-height:48px;" list="drItemsList" value="${esc(r.items_id || '')}"></td>
                    <td><button class="btn btn-danger btn-sm" onclick="DRApp.delRow(this)">✕</button></td>
                </tr>`).join('');
            this.syncRowTimes();
        },

        async save() {
            if (this._saving) return; // 防重复提交（双击竞态）
            const dateStr = document.getElementById('drFormDate').value;
            if (!dateStr) { UI.toast(t('dr.msg.date_required'), 'error'); return; }
            const rows = this.readRowsFromDom();
            if (rows.length === 0) { UI.toast(t('dr.msg.detail_required'), 'error'); return; }
            for (const r of rows) {
                if (!r.projects) { UI.toast(t('dr.msg.project_required'), 'error'); return; }
                const h = this.calcHours(r.from_time, r.to_time);
                if (h === null) { UI.toast(t('dr.msg.time_invalid'), 'error'); return; }
                const [fh] = r.from_time.split(':').map(Number);
                const [th, tm] = r.to_time.split(':').map(Number);
                if (fh < 8 || th * 60 + tm > 18 * 60) { UI.toast(t('dr.msg.time_invalid'), 'error'); return; }
                // 每笔工作时间必须 ≥ 30 分钟，否则阻止保存
                if (h < 0.5) { UI.toast(t('dr.msg.under_30min'), 'error'); return; }
            }

            const body = {
                bu_no: State.bu_no,
                report_date: dateStr,
                projects1: document.getElementById('drFormP1').value.trim(),
                projects2: document.getElementById('drFormP2').value.trim(),
                details: rows
            };
            const btn = document.getElementById('drSaveBtn');
            this._saving = true;
            if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
            try {
                const res = await API.post('/api/daily-report', body);
                UI.toast(res.message || t('dr.msg.saved'), 'success');
                this.back();
            } catch (e) { UI.toast(e.message, 'error'); }
            finally {
                this._saving = false;
                if (btn) { btn.disabled = false; btn.style.opacity = ''; }
            }
        },

        back() { this.renderList(); },

        async edit(id, reportDate) {
            this.view = 'form';
            this.destroyCharts();
            const got = await API.get('/api/daily-report/' + id);
            if (!got || !got.data) return;
            const m = got.data.master;
            this.formRows = got.data.details.map(d => ({
                projects: d.projects || '', from_time: d.from_time || '', to_time: d.to_time || '',
                wk_type: d.wk_type || '日常工作', client_id: d.client_id || '', items_id: d.items_id || ''
            }));
            this.renderForm(reportDate || m.report_date, m);
            const hint = document.getElementById('drFormHint');
            if (hint) hint.textContent = 'ID #' + m.id;
        },

        showGuide() {
            UI.modal(`📖 ${t('dr.guide.title')}`, `
                <div style="line-height:1.8;margin-bottom:12px;">${t('dr.guide.unit_rule')}</div>
                <div style="font-weight:700;color:#e74c3c;">${t('dr.guide.wrong')}</div>
                <table class="data-table" style="margin:6px 0 12px;">
                    <thead><tr><th>From~To</th><th>${t('dr.col.project')}</th><th>時數</th></tr></thead>
                    <tbody><tr><td>08:00 ~ 08:15</td>
                        <td>${t('dr.guide.example_tasks')}</td><td class="num">0.25</td></tr></tbody>
                </table>
                <div style="font-weight:700;color:#27ae60;">${t('dr.guide.right')}</div>
                <table class="data-table" style="margin:6px 0 0;">
                    <thead><tr><th>From~To</th><th>${t('dr.col.project')}</th><th>時數</th></tr></thead>
                    <tbody>
                        <tr><td>08:00 ~ 08:30</td><td>a</td><td class="num">0.50</td></tr>
                        <tr><td>08:30 ~ 09:00</td><td>b</td><td class="num">0.50</td></tr>
                        <tr><td>09:00 ~ 09:30</td><td>c</td><td class="num">0.50</td></tr>
                    </tbody>
                </table>
            `, `<button class="btn btn-primary" onclick="UI.closeModal()">${t('confirm')}</button>`);
        },

        // ============ 分析视图 ============
        openAnalysis(kind) {
            this.view = 'analysis';
            this.destroyCharts();
            const mgr = !!(this.me && this.me.isManager);
            const year = new Date().getFullYear();
            const mm = String(new Date().getMonth() + 1).padStart(2, '0');
            const deptFilter = kind === 'time' && mgr
                ? `<label>${t('dr.depart')}：<select id="draDept">${this.deptOptions('')}</select></label>` : '';
            const writerFilter = `
                <label>${t('dr.writer')}：<select id="draUser">${mgr ? this.writerOptions(this.me.user_id) : ''}</select></label>`;
            const writerVal = mgr ? this.me.user_id : (this.me ? this.me.user_id : '');

            this.c.innerHTML = `
                <div class="card">
                    <div class="toolbar" style="flex-wrap:wrap;gap:10px;">
                        ${deptFilter}
                        ${writerFilter}
                        <label>${t('dr.year')}：<select id="draYear">${this.yearOptions(year)}</select></label>
                        <label>${t('dr.month')}：<select id="draMonth">${this.monthOptions(mm)}</select></label>
                        <button class="btn btn-primary" onclick="DRApp.runAnalysis('${kind}')">🔍 ${t('dr.btn.query')}</button>
                        <button class="btn" style="margin-left:auto;" onclick="DRApp.back()">↩️ ${t('dr.btn.back')}</button>
                    </div>
                    <div id="draBody" style="margin-top:14px;">${t('loading')}</div>
                </div>`;
            if (!mgr) {
                const sel = document.getElementById('draUser');
                sel.innerHTML = `<option value="${esc(this.me.user_id)}">${esc(this.me.user_name)}</option>`;
            }
            this.runAnalysis(kind);
        },

        analysisParams() {
            const p = { bu_no: State.bu_no, year: '', month: '', depart_id: '', user_id: '' };
            const y = document.getElementById('draYear'), mo = document.getElementById('draMonth');
            const d = document.getElementById('draDept'), u = document.getElementById('draUser');
            if (y) p.year = y.value;
            if (mo) p.month = mo.value;
            if (d) p.depart_id = d.value;
            if (u) p.user_id = u.value;
            return p;
        },

        async runAnalysis(kind) {
            const body = document.getElementById('draBody');
            this.destroyCharts();
            const p = this.analysisParams();
            try {
                if (kind === 'time') {
                    body.innerHTML = `
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;">
                            <div><canvas id="drChartBar" height="260"></canvas></div>
                            <div><canvas id="drChartDonut" height="260"></canvas></div>
                        </div>`;
                    const qs = new URLSearchParams(p);
                    const res = await API.get('/api/daily-report/analysis/time-category?' + qs.toString());
                    const labels = res.data.map(r => this.wkLabel(r.wk_type));
                    const data = res.data.map(r => Number(r.hours));
                    this.charts.push(new Chart(document.getElementById('drChartBar'), {
                        type: 'bar',
                        data: { labels, datasets: [{ label: t('dr.axis.hours'), data, backgroundColor: COLORS }] },
                        options: { responsive: true, plugins: { legend: { display: false } },
                            scales: { y: { beginAtZero: true, title: { display: true, text: t('dr.axis.hours') } } } }
                    }));
                    this.charts.push(new Chart(document.getElementById('drChartDonut'), {
                        type: 'doughnut',
                        data: { labels, datasets: [{ data, backgroundColor: COLORS }] },
                        options: { responsive: true, plugins: {
                            tooltip: { callbacks: { label: (ctx) => {
                                const sum = ctx.dataset.data.reduce((s, v) => s + Number(v || 0), 0) || 1;
                                return `${ctx.label}: ${UI.fmt(ctx.parsed)} (${(ctx.parsed / sum * 100).toFixed(1)}%)`;
                            } } } } }
                    }));
                } else if (kind === 'client') {
                    body.innerHTML = `
                        <div style="max-width:520px;margin:0 auto;"><canvas id="drChartClient" height="260"></canvas></div>
                        <div style="text-align:center;margin-top:12px;font-size:15px;font-weight:700;color:#2c3e50;">
                            ${t('dr.an.total_hours')}：<span id="drClientTotal" style="color:#2980b9;"></span>
                        </div>`;
                    const qs = new URLSearchParams(p);
                    const res = await API.get('/api/daily-report/analysis/client?' + qs.toString());
                    const labels = res.data.list.map(r => r.client_id ? r.client_id : t('dr.an.client_none'));
                    const data = res.data.list.map(r => Number(r.hours));
                    document.getElementById('drClientTotal').textContent = UI.fmt(res.data.total_hours) + ' ' + t('dr.axis.hours');
                    if (data.length === 0) { body.insertAdjacentHTML('afterbegin', UI.empty('🧩', t('dr.empty'))); }
                    this.charts.push(new Chart(document.getElementById('drChartClient'), {
                        type: 'doughnut',
                        data: { labels, datasets: [{ data, backgroundColor: COLORS }] },
                        options: { responsive: true, plugins: {
                            tooltip: { callbacks: { label: (ctx) => {
                                const sum = ctx.dataset.data.reduce((s, v) => s + Number(v || 0), 0) || 1;
                                return `${ctx.label}: ${UI.fmt(ctx.parsed)} (${(ctx.parsed / sum * 100).toFixed(1)}%)`;
                            } } } } }
                    }));
                } else if (kind === 'wheel') {
                    body.innerHTML = `
                        <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:18px;align-items:center;">
                            <div><canvas id="drChartWheel" height="280"></canvas></div>
                            <div><canvas id="drChartWL" height="200"></canvas></div>
                        </div>
                        <div id="drWheelBanner" style="margin-top:14px;padding:14px 18px;border-radius:8px;font-size:14px;line-height:1.7;"></div>`;
                    const qs = new URLSearchParams(p);
                    const res = await API.get('/api/daily-report/analysis/balance-wheel?' + qs.toString());
                    const d = res.data;
                    const labels = d.wheel.map(r => this.wkLabel(r.wk_type));
                    const data = d.wheel.map(r => Number(r.hours));
                    this.charts.push(new Chart(document.getElementById('drChartWheel'), {
                        type: 'radar',
                        data: { labels, datasets: [{ label: t('dr.axis.hours'), data,
                            backgroundColor: 'rgba(155,89,182,0.25)', borderColor: '#9b59b6', pointBackgroundColor: '#9b59b6' }] },
                        options: { responsive: true, scales: { r: { beginAtZero: true } } }
                    }));
                    this.charts.push(new Chart(document.getElementById('drChartWL'), {
                        type: 'bar',
                        data: { labels: [t('dr.an.work_hours'), t('dr.an.life_hours')],
                            datasets: [{ data: [Number(d.work_hours), Number(d.life_hours)], backgroundColor: ['#3498db', '#27ae60'] }] },
                        options: { indexAxis: 'y', plugins: { legend: { display: false } },
                            scales: { x: { beginAtZero: true, title: { display: true, text: t('dr.axis.hours') } } } }
                    }));
                    const total = Number(d.work_hours) + Number(d.life_hours);
                    const ratio = total > 0 ? Number(d.life_hours) / total : 0;
                    const key = ratio < 0.2 ? 'dr.wheel.suggest_low' : ratio < 0.4 ? 'dr.wheel.suggest_mid' : 'dr.wheel.suggest_high';
                    const banner = document.getElementById('drWheelBanner');
                    banner.style.background = ratio < 0.2 ? '#fdecea' : ratio < 0.4 ? '#fef6e7' : '#eafaf1';
                    banner.style.color = ratio < 0.2 ? '#c0392b' : ratio < 0.4 ? '#b9770e' : '#1e8449';
                    banner.textContent = '💡 ' + t(key);
                }
            } catch (e) {
                body.innerHTML = `<p style="color:#e74c3c"></p>`;
                body.querySelector('p').textContent = e.message;
            }
        }
    };

    window.DRApp = DRApp;

    registerPage('dailyReport', async (c) => {
        DRApp.c = c;
        try {
            await DRApp.loadMeta();
        } catch (e) {
            c.innerHTML = `<div class="card"><p class="dr-load-err" style="color:#e74c3c"></p></div>`;
            c.querySelector('.dr-load-err').textContent = t('dr.msg.load_fail') + ': ' + e.message;
            return;
        }
        DRApp.renderList();
    });
})();
