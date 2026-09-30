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
            for (let yy = y + 1; yy >= y - 25; yy--) {
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
                        ${mgr ? `<button class="btn" style="background:#8e44ad;color:#fff;" onclick="DRApp.openSignoff()">📝 ${t('dr.sign.title')}</button>
                                 <button class="btn" style="background:#5d6d7e;color:#fff;" onclick="DRApp.openAudit()">📜 ${t('dr.audit.title')}</button>
                                 <button class="btn" style="background:#1a5276;color:#fff;" onclick="DRApp.openTimeliness()">📊 ${t('dr.tl.title')}</button>
                                 <button class="btn" style="background:#117a65;color:#fff;" onclick="DRApp.openSummary()">📋 ${t('dr.sum.title')}</button>
                                 <button class="btn" style="background:#b9770e;color:#fff;" onclick="DRApp.openTargets()">🎯 ${t('dr.tgt.title')}</button>
                                 <button class="btn" style="background:#1b4f72;color:#fff;" onclick="DRApp.openDashboard()">📈 ${t('dr.eff.title')}</button>
                                 <button class="btn" style="background:#78281f;color:#fff;" onclick="DRApp.openMgmtReport()">📑 ${t('dr.mbr.title')}</button>
                                 <button class="btn" style="background:#7d6608;color:#fff;" onclick="DRApp.openAnnualReview()">🏆 ${t('dr.ar.title')}</button>` : ''}
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
                    <tr${Number(r.locked) ? ' style="background:#fdf6e3;"' : ''}>
                        <td>${(this.filters.page - 1) * this.filters.pageSize + i + 1}</td>
                        <td>${esc(r.report_date)}${Number(r.locked) ? ' <span title="' + t('dr.sign.locked_tip') + '">🔒</span>' : ''}</td>
                        <td class="num">${UI.fmt(r.total_hours)}</td>
                        <td style="max-width:280px;" title="${esc(r.work_text || '')}">${esc(r.work_text || '-')}</td>
                        <td style="${delayTdCls}" ${tdAttrs('delay')}>${hasDelay ? esc(r.projects1) : '-'}</td>
                        <td style="${unresTdCls}" ${tdAttrs('unres')}>${hasUnres ? esc(r.projects2) : '-'}</td>
                        <td>${uname}</td>
                        <td>
                            <button class="btn btn-sm btn-info" title="${t('edit')}" data-edit-id="${Number(r.id) || 0}" data-edit-date="${esc(r.report_date)}">✏️</button>
                            ${Number(r.locked) ? '' : `<button class="btn btn-danger btn-sm" data-del-id="${Number(r.id) || 0}">🗑</button>`}
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

        renderForm(dateStr, loaded, signLock) {
            this._formSignLock = signLock || null;
            const sl = !!signLock;
            const windowLocked = Math.abs(this.daysFromToday(dateStr)) > 7;
            const clients = (this.meta.clients || []).map(x => `<option value="${esc(x)}">`).join('');
            const items = (this.meta.items || []).map(x => `<option value="${esc(x)}">`).join('');
            const lockBanner = sl ? `
                    <div style="background:#fdf2e3;border:1px solid #e67e22;color:#a04000;padding:10px 14px;border-radius:8px;margin-bottom:10px;">
                        🔒 <b>${t('dr.sign.form_banner')}</b>
                        ${signLock.locked_by_name ? '　' + t('dr.sign.locked_by') + '：' + esc(signLock.locked_by_name) : ''}
                        ${signLock.locked_time ? '　' + t('dr.sign.locked_time') + '：' + esc(String(signLock.locked_time).replace('T', ' ').slice(0, 16)) : ''}
                        <div style="font-size:0.9em;margin-top:2px;">${t('dr.sign.form_banner_hint')}</div>
                    </div>` : '';
            this.c.innerHTML = `
                <div class="card">
                    ${lockBanner}
                    <div class="toolbar" style="flex-wrap:wrap;gap:10px;">
                        <label><b>${t('dr.form.report_date')}：</b><input type="date" id="drFormDate" value="${dateStr}" ${sl ? 'disabled' : 'onchange="DRApp.onDateChange()"'}></label>
                        ${sl ? '' : `<button class="btn" onclick="DRApp.showGuide()">📖 ${t('dr.btn.guide')}</button>`}
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
                        ${sl ? '' : `<button class="btn btn-sm" onclick="DRApp.addRow()">➕ ${t('dr.btn.add_row')}</button>`}
                        <span style="margin-left:auto;font-weight:700;">${t('dr.form.total_hours')}：<span id="drFormTotal">0.00</span> ${t('dr.axis.hours')}</span>
                    </div>

                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;">
                        <div>
                            <label><b>${t('dr.form.delay_today')}</b></label>
                            <textarea id="drFormP1" rows="8" style="width:100%;margin-top:4px;min-height:160px;" placeholder="${(!sl && windowLocked) ? t('dr.form.lock_hint') : ''}" ${(sl || windowLocked) ? 'disabled' : ''}>${loaded ? esc(loaded.projects1 || '') : ''}</textarea>
                        </div>
                        <div>
                            <label><b>${t('dr.form.unresolved_now')}</b></label>
                            <textarea id="drFormP2" rows="8" style="width:100%;margin-top:4px;min-height:160px;" placeholder="${(!sl && windowLocked) ? t('dr.form.lock_hint') : ''}" ${(sl || windowLocked) ? 'disabled' : ''}>${loaded ? esc(loaded.projects2 || '') : ''}</textarea>
                        </div>
                    </div>
                    ${(!sl && windowLocked) ? `<div style="color:#e67e22;margin-top:8px;">⚠️ ${t('dr.form.lock_hint')}</div>` : ''}

                    <div class="toolbar" style="margin-top:14px;">
                        ${sl ? '' : `<button class="btn btn-primary" id="drSaveBtn" onclick="DRApp.save()">💾 ${t('save')}</button>`}
                        <button class="btn" data-keep="1" onclick="DRApp.back()">↩️ ${t('dr.btn.back')}</button>
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
                if (!row) {
                    // 当天无日报：查本人当月签核锁，锁定则禁止新增
                    const ym = dateStr.slice(0, 7).replace('-', '/');
                    const lres = await API.get('/api/daily-report/locks?bu_no=' + encodeURIComponent(State.bu_no) +
                        '&YYYY_MM=' + encodeURIComponent(ym) + '&user_id=' + encodeURIComponent(this.me ? this.me.user_id : ''));
                    const lrow = (lres.data || [])[0];
                    const signLock = lrow && lrow.locked
                        ? { locked_by: lrow.locked_by, locked_by_name: lrow.locked_by_name, locked_time: lrow.locked_time }
                        : null;
                    this.formRows = [{ projects: '', from_time: '08:00', to_time: '08:30', wk_type: '日常工作', client_id: '', items_id: '' }];
                    this.renderForm(dateStr, null, signLock);
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
                this.renderForm(dateStr, m, got.data.lock);
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
                    from_time: this.snapHalf(tr.querySelector('.dr-f-from').value),
                    to_time: this.snapHalf(tr.querySelector('.dr-f-to').value),
                    wk_type: tr.querySelector('.dr-f-wk').value,
                    client_id: tr.querySelector('.dr-f-client').value.trim(),
                    items_id: tr.querySelector('.dr-f-items').value.trim()
                });
            });
            return rows;
        },

        // 时间分钟强制对齐到 00/30（手动键入时纠偏）
        snapHalf(value) {
            const m = /^(\d{1,2}):(\d{2})$/.exec((value || '').trim());
            if (!m) return value || '';
            const hh = Number(m[1]);
            const mm = Number(m[2]);
            const snapped = mm < 15 ? 0 : mm < 45 ? 30 : 60;
            const h = snapped === 60 ? (hh + 1) % 24 : hh;
            const mi = snapped === 60 ? 0 : snapped;
            return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
        },

        // 可选时间点：08:00 ~ 23:30，每半小时一个（分钟只有 00/30）
        timeSlots() {
            const list = [];
            for (let h = 8; h <= 23; h++) {
                list.push(String(h).padStart(2, '0') + ':00');
                if (h < 23) list.push(String(h).padStart(2, '0') + ':30');
            }
            list.push('23:30');
            return list;
        },

        // 渲染时间下拉（替代原生 input[type=time]，确保分钟只能选 00/30）
        timeSelect(cls, cur, disabled) {
            const dis = disabled ? ' disabled' : '';
            const slots = this.timeSlots();
            let extra = '';
            if (!cur) {
                extra = '<option value="" selected>--:--</option>';
            } else if (!slots.includes(cur)) {
                // 历史异常值兜底：保留原值选项，避免下拉空白
                extra = '<option value="' + esc(cur) + '" selected>' + esc(cur) + '</option>';
            }
            const opts = slots.map(v =>
                `<option value="${v}" ${v === cur ? 'selected' : ''}>${v}</option>`).join('');
            return `<select class="${cls}" style="width:95px;min-height:48px;"${dis} onchange="DRApp.syncRowTimes()">${extra}${opts}</select>`;
        },

        syncRowTimes() {
            // 先把 from/to 分钟对齐到 00/30 并回写，防止手动键入非半点值
            document.querySelectorAll('#drFormRows tr.dr-row').forEach(tr => {
                const f = tr.querySelector('.dr-f-from');
                const to = tr.querySelector('.dr-f-to');
                if (f) { const v = this.snapHalf(f.value); if (v !== f.value) f.value = v; }
                if (to) { const v = this.snapHalf(to.value); if (v !== to.value) to.value = v; }
            });
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
            // 自动沿用上一行结束时间作为新行开始，预设 30 分钟（不超过 23:30）
            let nf = '', nt = '';
            const last = this.formRows[this.formRows.length - 1];
            if (last && /^([01]\d|2[0-3]):[0-5]\d$/.test(last.to_time || '')) {
                const [h, m] = last.to_time.split(':').map(Number);
                const endMin = h * 60 + m + 30;
                if (endMin <= 23 * 60 + 30) {
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
            const ro = !!this._formSignLock;
            const dis = ro ? ' disabled' : '';
            tb.innerHTML = this.formRows.map((r, i) => `
                <tr class="dr-row" data-idx="${i}">
                    <td>${i + 1}</td>
                    <td><input class="dr-f-project" style="width:100%;min-width:200px;min-height:48px;" value="${esc(r.projects || '')}"${dis}></td>
                    <td>${this.timeSelect('dr-f-from', r.from_time || '', ro)}</td>
                    <td>${this.timeSelect('dr-f-to', r.to_time || '', ro)}</td>
                    <td><select class="dr-f-wk" style="min-height:48px;"${dis}>${wks.map(w => `<option value="${esc(w)}" ${r.wk_type === w ? 'selected' : ''}>${this.wkLabel(w)}</option>`).join('')}</select></td>
                    <td class="num dr-f-hours" style="min-height:48px;">-</td>
                    <td><input class="dr-f-client" style="width:125px;min-height:48px;" list="drClientList" value="${esc(r.client_id || '')}"${dis}></td>
                    <td><input class="dr-f-items" style="width:125px;min-height:48px;" list="drItemsList" value="${esc(r.items_id || '')}"${dis}></td>
                    <td>${ro ? '' : `<button class="btn btn-danger btn-sm" onclick="DRApp.delRow(this)">✕</button>`}</td>
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
                if (fh < 8 || th * 60 + tm > 23 * 60 + 30) { UI.toast(t('dr.msg.time_invalid'), 'error'); return; }
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
            this.renderForm(reportDate || m.report_date, m, got.data.lock);
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

        // ============ P1-① 提交及时率看板 ============
        openTimeliness() {
            this.view = 'timeliness';
            this.destroyCharts();
            const now = new Date();
            if (!this._tlYM) {
                this._tlYM = { year: now.getFullYear(), mm: String(now.getMonth() + 1).padStart(2, '0') };
            }
            this.c.innerHTML = `
                <div class="card">
                    <div class="toolbar" style="flex-wrap:wrap;gap:10px;">
                        <label><b>${t('dr.tl.period')}：</b>
                            <select id="tlYear">${this.yearOptions(this._tlYM.year)}</select> /
                            <select id="tlMonth">${this.monthOptions(this._tlYM.mm)}</select>
                        </label>
                        <button class="btn btn-primary" onclick="DRApp.loadTimeliness()">🔍 ${t('dr.btn.query')}</button>
                        <button class="btn" style="margin-left:auto;" onclick="DRApp.back()">↩️ ${t('dr.btn.back')}</button>
                    </div>
                    <div id="tlBody" style="margin-top:12px;">${t('loading')}</div>
                </div>`;
            this.loadTimeliness();
        },

        async loadTimeliness() {
            const el = document.getElementById('tlBody');
            if (!el) return;
            const y = document.getElementById('tlYear').value;
            const mm = document.getElementById('tlMonth').value;
            this._tlYM = { year: y, mm };
            const ym = y + '/' + mm;
            el.innerHTML = `<p style="color:#7f8c8d;">${t('loading')}</p>`;
            try {
                const res = await API.get('/api/daily-report/timeliness?bu_no=' + encodeURIComponent(State.bu_no) + '&YYYY_MM=' + encodeURIComponent(ym));
                const rows = res.data || [];
                if (rows.length === 0) { el.innerHTML = UI.empty('📭', t('dr.tl.empty')); return; }
                const rateColor = (r) => r >= 90 ? '#27ae60' : r >= 70 ? '#e67e22' : '#e74c3c';
                el.innerHTML = `<table class="data-table">
                    <thead><tr>
                        <th>${t('dr.tl.col.writer')}</th><th>${t('dr.tl.col.depart')}</th>
                        <th>${t('dr.tl.col.due')}</th><th>${t('dr.tl.col.submitted')}</th>
                        <th>${t('dr.tl.col.on_time')}</th><th>${t('dr.tl.col.late')}</th>
                        <th>${t('dr.tl.col.missing')}</th><th>${t('dr.tl.col.rate')}</th>
                    </tr></thead>
                    <tbody>${rows.map(r => `
                        <tr>
                            <td>${esc(r.user_id)} - ${esc(r.user_name || '')}</td>
                            <td>${esc(r.depart_id || '-')}</td>
                            <td class="num">${r.due}</td>
                            <td class="num">${r.submitted}</td>
                            <td class="num" style="color:#27ae60;">${r.on_time}</td>
                            <td class="num" style="color:${r.late ? '#e67e22' : ''};">${r.late}</td>
                            <td class="num" style="color:${r.missing ? '#e74c3c' : ''};">${r.missing}</td>
                            <td class="num" style="font-weight:700;color:${rateColor(r.rate)};">${r.rate}%</td>
                        </tr>`).join('')}
                    </tbody></table>`;
            } catch (e) {
                el.innerHTML = `<p style="color:#e74c3c;">${esc(e.message)}</p>`;
            }
        },

        // ============ P1-② 月度绩效自动汇总 ============
        openSummary() {
            this.view = 'summary';
            this.destroyCharts();
            const now = new Date();
            if (!this._sumYM) {
                this._sumYM = { year: now.getFullYear(), mm: String(now.getMonth() + 1).padStart(2, '0') };
            }
            this.c.innerHTML = `
                <div class="card">
                    <div class="toolbar" style="flex-wrap:wrap;gap:10px;">
                        <label><b>${t('dr.sum.period')}：</b>
                            <select id="sumYear">${this.yearOptions(this._sumYM.year)}</select> /
                            <select id="sumMonth">${this.monthOptions(this._sumYM.mm)}</select>
                        </label>
                        <button class="btn btn-primary" onclick="DRApp.loadSummary()">🔍 ${t('dr.btn.query')}</button>
                        <button class="btn" style="margin-left:auto;" onclick="DRApp.back()">↩️ ${t('dr.btn.back')}</button>
                    </div>
                    <div id="sumBody" style="margin-top:12px;">${t('loading')}</div>
                </div>`;
            this.loadSummary();
        },

        async loadSummary() {
            const el = document.getElementById('sumBody');
            if (!el) return;
            const y = document.getElementById('sumYear').value;
            const mm = document.getElementById('sumMonth').value;
            this._sumYM = { year: y, mm };
            const ym = y + '/' + mm;
            el.innerHTML = `<p style="color:#7f8c8d;">${t('loading')}</p>`;
            try {
                const res = await API.get('/api/daily-report/monthly-summary?bu_no=' + encodeURIComponent(State.bu_no) + '&YYYY_MM=' + encodeURIComponent(ym));
                const rows = res.data || [];
                if (rows.length === 0) { el.innerHTML = UI.empty('📭', t('dr.sum.empty')); return; }
                const tgtBadge = (val, over) => {
                    if (val == null) return '-';
                    if (over != null && over > 0) return `<span style="color:#e74c3c;font-weight:700;">${val} (↑${over})</span>`;
                    return `<span style="color:#27ae60;">${val}</span>`;
                };
                const achieveColor = (v) => v == null ? '#7f8c8d' : v >= 100 ? '#27ae60' : v >= 80 ? '#e67e22' : '#e74c3c';
                el.innerHTML = `<table class="data-table" style="font-size:0.9em;">
                    <thead><tr>
                        <th>${t('dr.sum.col.writer')}</th><th>${t('dr.sum.col.depart')}</th>
                        <th>${t('dr.sum.col.days')}</th><th>${t('dr.sum.col.hours')}</th>
                        <th>${t('dr.sum.col.target_h')}</th><th>${t('dr.sum.col.achieve')}</th>
                        <th>${t('dr.sum.col.delays')}</th><th>${t('dr.sum.col.max_delays')}</th>
                        <th>${t('dr.sum.col.unresolved')}</th><th>${t('dr.sum.col.max_unsolved')}</th>
                        <th>${t('dr.sum.col.work_ratio')}</th><th>${t('dr.sum.col.min_work')}</th>
                        <th>${t('dr.sum.col.avg_h')}</th>
                    </tr></thead>
                    <tbody>${rows.map(r => `
                        <tr>
                            <td>${esc(r.user_id)} - ${esc(r.user_name || '')}</td>
                            <td>${esc(r.depart_id || '-')}</td>
                            <td class="num">${r.report_days}</td>
                            <td class="num" style="font-weight:700;">${UI.fmt(r.total_hours)}</td>
                            <td class="num">${r.target_hours != null ? UI.fmt(r.target_hours) : '-'}</td>
                            <td class="num" style="font-weight:700;color:${achieveColor(r.hours_achieve)};">${r.hours_achieve != null ? r.hours_achieve + '%' : '-'}</td>
                            <td class="num" style="color:${r.delay_cnt ? '#e67e22' : ''};">${r.delay_cnt}</td>
                            <td class="num">${tgtBadge(r.max_delays, r.delay_over)}</td>
                            <td class="num" style="color:${r.unresolved_cnt ? '#e74c3c' : ''};">${r.unresolved_cnt}</td>
                            <td class="num">${tgtBadge(r.max_unresolved, r.unresolved_over)}</td>
                            <td class="num">${r.work_ratio}%</td>
                            <td class="num">${r.min_work_ratio != null ? r.min_work_ratio + '%' : '-'}</td>
                            <td class="num">${UI.fmt(r.avg_hours)}</td>
                        </tr>`).join('')}
                    </tbody></table>`;
            } catch (e) {
                el.innerHTML = `<p style="color:#e74c3c;">${esc(e.message)}</p>`;
            }
        },

        // ============ P1-③ 目标设定与管理 ============
        openTargets() {
            this.view = 'targets';
            this.destroyCharts();
            const now = new Date();
            if (!this._tgtYM) {
                this._tgtYM = { year: now.getFullYear(), mm: String(now.getMonth() + 1).padStart(2, '0') };
            }
            this.c.innerHTML = `
                <div class="card">
                    <div class="toolbar" style="flex-wrap:wrap;gap:10px;">
                        <label><b>${t('dr.tgt.period')}：</b>
                            <select id="tgtYear">${this.yearOptions(this._tgtYM.year)}</select> /
                            <select id="tgtMonth">${this.monthOptions(this._tgtYM.mm)}</select>
                        </label>
                        <button class="btn btn-primary" onclick="DRApp.loadTargets()">🔍 ${t('dr.btn.query')}</button>
                        <button class="btn btn-success" onclick="DRApp.addTargetRow()">➕ ${t('dr.tgt.add_row')}</button>
                        <button class="btn btn-primary" onclick="DRApp.saveTargets()">💾 ${t('save')}</button>
                        <button class="btn" style="margin-left:auto;" onclick="DRApp.back()">↩️ ${t('dr.btn.back')}</button>
                    </div>
                    <div id="tgtBody" style="margin-top:12px;">${t('loading')}</div>
                </div>`;
            this.loadTargets();
        },

        async loadTargets() {
            const el = document.getElementById('tgtBody');
            if (!el) return;
            const y = document.getElementById('tgtYear').value;
            const mm = document.getElementById('tgtMonth').value;
            this._tgtYM = { year: y, mm };
            const ym = y + '/' + mm;
            el.innerHTML = `<p style="color:#7f8c8d;">${t('loading')}</p>`;
            try {
                const res = await API.get('/api/daily-report/targets?bu_no=' + encodeURIComponent(State.bu_no) + '&YYYY_MM=' + encodeURIComponent(ym));
                const rows = res.data || [];
                this._tgtRows = rows.length > 0 ? rows : [];
                this.renderTargetTable();
            } catch (e) {
                el.innerHTML = `<p style="color:#e74c3c;">${esc(e.message)}</p>`;
            }
        },

        renderTargetTable() {
            const el = document.getElementById('tgtBody');
            if (!el) return;
            const rows = this._tgtRows || [];
            if (rows.length === 0) {
                el.innerHTML = UI.empty('🎯', t('dr.tgt.empty'));
                return;
            }
            el.innerHTML = `<table class="data-table" style="font-size:0.9em;">
                <thead><tr>
                    <th>${t('dr.tgt.col.writer')}</th>
                    <th>${t('dr.tgt.col.target_hours')}</th>
                    <th>${t('dr.tgt.col.max_delays')}</th>
                    <th>${t('dr.tgt.col.max_unresolved')}</th>
                    <th>${t('dr.tgt.col.min_work_ratio')}</th>
                    <th>${t('dr.tgt.col.remark')}</th>
                    <th>${t('dr.tgt.col.set_by')}</th>
                    <th></th>
                </tr></thead>
                <tbody>${rows.map((r, i) => `
                    <tr data-tgt-idx="${i}">
                        <td>${esc(r.user_id)} - ${esc(r.user_name || '')}<input type="hidden" class="tgt-uid" value="${esc(r.user_id)}"></td>
                        <td><input class="tgt-th" type="number" step="0.5" style="width:80px;" value="${r.target_hours != null ? r.target_hours : ''}" placeholder="-"></td>
                        <td><input class="tgt-md" type="number" step="1" style="width:60px;" value="${r.max_delays != null ? r.max_delays : ''}" placeholder="-"></td>
                        <td><input class="tgt-mu" type="number" step="1" style="width:60px;" value="${r.max_unresolved != null ? r.max_unresolved : ''}" placeholder="-"></td>
                        <td><input class="tgt-mw" type="number" step="1" min="0" max="100" style="width:60px;" value="${r.min_work_ratio != null ? r.min_work_ratio : ''}" placeholder="-"></td>
                        <td><input class="tgt-rm" style="width:200px;" value="${esc(r.remark || '')}"></td>
                        <td style="font-size:0.85em;color:#7f8c8d;">${esc(r.set_by_name || '')}<br>${this.fmtDT(r.set_time)}</td>
                        <td><button class="btn btn-danger btn-sm" data-tgt-del="${i}">✕</button></td>
                    </tr>`).join('')}
                </tbody></table>`;
            el.querySelectorAll('button[data-tgt-del]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = Number(btn.dataset.tgtDel);
                    this._tgtRows.splice(idx, 1);
                    this.renderTargetTable();
                });
            });
        },

        addTargetRow() {
            const uid = prompt(t('dr.tgt.input_uid'));
            if (!uid) return;
            if (!this._tgtRows) this._tgtRows = [];
            if (this._tgtRows.find(r => r.user_id === uid)) {
                UI.toast(t('dr.tgt.duplicate'), 'error'); return;
            }
            this._tgtRows.push({ user_id: uid, user_name: uid, target_hours: null, max_delays: null, max_unresolved: null, min_work_ratio: null, remark: '', set_by_name: '', set_time: null });
            this.renderTargetTable();
        },

        async saveTargets() {
            const rows = this._tgtRows || [];
            if (rows.length === 0) { UI.toast(t('dr.tgt.empty_rows'), 'error'); return; }
            const ym = this._tgtYM.year + '/' + this._tgtYM.mm;
            const targets = rows.map(r => {
                const tr = document.querySelector(`tr[data-tgt-idx="${rows.indexOf(r)}"]`);
                if (!tr) return null;
                return {
                    user_id: tr.querySelector('.tgt-uid').value,
                    target_hours: tr.querySelector('.tgt-th').value,
                    max_delays: tr.querySelector('.tgt-md').value,
                    max_unresolved: tr.querySelector('.tgt-mu').value,
                    min_work_ratio: tr.querySelector('.tgt-mw').value,
                    remark: tr.querySelector('.tgt-rm').value
                };
            }).filter(Boolean);
            try {
                const res = await API.post('/api/daily-report/targets', { bu_no: State.bu_no, YYYY_MM: ym, targets });
                UI.toast(res.message || 'OK', 'success');
                this.loadTargets();
            } catch (e) { UI.toast(e.message, 'error'); }
        },

        // ============ P2-① 人效仪表盘 ============
        openDashboard() {
            this.view = 'dashboard';
            this.destroyCharts();
            const now = new Date();
            if (!this._dashYM) {
                this._dashYM = { year: this.filters.year || now.getFullYear(), mm: this.filters.month || String(now.getMonth() + 1).padStart(2, '0') };
            }
            this.c.innerHTML = `
                <div class="card">
                    <div class="toolbar" style="flex-wrap:wrap;gap:10px;">
                        <label><b>${t('dr.eff.period')}：</b>
                            <select id="dashYear">${this.yearOptions(this._dashYM.year)}</select> /
                            <select id="dashMonth">${this.monthOptions(this._dashYM.mm)}</select>
                        </label>
                        <button class="btn btn-primary" onclick="DRApp.loadDashboard()">🔍 ${t('dr.btn.query')}</button>
                        <button class="btn" style="margin-left:auto;" onclick="DRApp.back()">↩️ ${t('dr.btn.back')}</button>
                    </div>
                    <div id="dashBody" style="margin-top:12px;">${t('loading')}</div>
                </div>`;
            this.loadDashboard();
        },

        async loadDashboard() {
            const el = document.getElementById('dashBody');
            if (!el) return;
            const y = document.getElementById('dashYear').value;
            const mm = document.getElementById('dashMonth').value;
            this._dashYM = { year: y, mm };
            const ym = y + '/' + mm;
            el.innerHTML = `<p style="color:#7f8c8d;">${t('loading')}</p>`;
            try {
                const res = await API.get('/api/daily-report/efficiency-dashboard?bu_no=' + encodeURIComponent(State.bu_no) + '&YYYY_MM=' + encodeURIComponent(ym));
                const d = res.data;
                const k = d.kpi;
                const fmtMoney = v => UI.fmt(v);
                const kpiCard = (label, val, sub, color) => `
                    <div style="background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                        <div style="color:#7f8c8d;font-size:0.85em;">${esc(label)}</div>
                        <div style="font-size:1.5em;font-weight:700;color:${color || '#2c3e50'};margin:4px 0;">${esc(val)}</div>
                        <div style="font-size:0.8em;color:#95a5a6;">${esc(sub || '')}</div>
                    </div>`;

                const cross = d.crossValidation;
                const rateColor = cross.match_rate >= 80 ? '#27ae60' : cross.match_rate >= 50 ? '#e67e22' : '#e74c3c';

                el.innerHTML = `
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px;">
                        ${kpiCard(t('dr.eff.kpi.output'), fmtMoney(k.total_output), `${t('dr.eff.kpi.invoice')}: ${fmtMoney(k.invoice_amt)}`, '#2980b9')}
                        ${kpiCard(t('dr.eff.kpi.emp'), k.employee_cnt, `${t('dr.eff.kpi.reporter')}: ${k.report_user_cnt}`, '#8e44ad')}
                        ${kpiCard(t('dr.eff.kpi.per_output'), fmtMoney(k.per_capita_output), t('dr.eff.kpi.per_output_sub'), '#27ae60')}
                        ${kpiCard(t('dr.eff.kpi.per_hours'), UI.fmt(k.per_capita_hours) + ' h', `${t('dr.eff.kpi.total_hours')}: ${UI.fmt(k.total_hours)} h`, '#e67e22')}
                        ${kpiCard(t('dr.eff.kpi.salary'), fmtMoney(k.salary_total), `${t('dr.eff.kpi.per_salary')}: ${fmtMoney(k.per_capita_salary)}`, '#c0392b')}
                    </div>

                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:16px;">
                        <div>
                            <h4 style="margin:0 0 10px 0;">${t('dr.eff.dept_title')}</h4>
                            <table class="data-table" style="font-size:0.9em;">
                                <thead><tr><th>${t('dr.sum.col.depart')}</th><th>${t('dr.eff.kpi.emp')}</th><th>${t('dr.eff.kpi.hours')}</th><th>${t('dr.eff.kpi.per_hours')}</th><th>${t('dr.eff.dept_share')}</th></tr></thead>
                                <tbody>${d.departments.map(dp => `
                                    <tr>
                                        <td>${esc(dp.depart_id)}</td>
                                        <td class="num">${dp.emp_cnt}</td>
                                        <td class="num">${UI.fmt(dp.total_hours)}</td>
                                        <td class="num">${UI.fmt(dp.per_capita_hours)}</td>
                                        <td class="num" style="color:#1a5276;font-weight:700;">${dp.output_share}%</td>
                                    </tr>`).join('') || `<tr><td colspan="5" style="text-align:center;color:#95a5a6;">${t('dr.empty')}</td></tr>`}
                                </tbody>
                            </table>
                        </div>
                        <div>
                            <h4 style="margin:0 0 10px 0;">${t('dr.eff.cross_title')}</h4>
                            <div style="background:#f8f9fa;padding:12px;border-radius:6px;margin-bottom:10px;">
                                <span style="font-size:1.8em;font-weight:700;color:${rateColor};">${cross.match_rate}%</span>
                                <span style="color:#7f8c8d;margin-left:8px;">${t('dr.eff.cross_rate')}</span>
                                <div style="font-size:0.85em;color:#7f8c8d;margin-top:4px;">
                                    ${t('dr.eff.cross_matched')}: ${cross.matched_cnt} / ${cross.report_item_cnt}
                                    ${cross.unmatched_cnt > 0 ? `<span style="color:#e74c3c;">（${t('dr.eff.cross_unmatched')}: ${cross.unmatched_cnt}）</span>` : ''}
                                </div>
                            </div>
                            <table class="data-table" style="font-size:0.85em;">
                                <thead><tr><th>${t('dr.eff.cross_item')}</th><th>${t('dr.eff.cross_report')}</th><th>ERP</th><th>${t('dr.eff.cross_status')}</th></tr></thead>
                                <tbody>${cross.items.slice(0, 8).map(it => `
                                    <tr>
                                        <td>${esc(it.items_id)}</td>
                                        <td class="num">${it.report_cnt}</td>
                                        <td class="num">${it.erp_doc_type || '-'} (${it.erp_doc_cnt})</td>
                                        <td>${it.matched ? '<span style="color:#27ae60;">✓</span>' : '<span style="color:#e74c3c;">✗</span>'}</td>
                                    </tr>`).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div>
                        <h4 style="margin:0 0 10px 0;">${t('dr.eff.trend_title')}（${t('dr.eff.trend_6m')}）</h4>
                        <div style="background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:12px;">
                            <canvas id="dashTrend" height="100"></canvas>
                        </div>
                    </div>`;

                // 趋势双轴图：产值（柱）+ 工时（线）
                const labels = d.trend.map(t => t.YYYY_MM);
                this.charts.push(new Chart(document.getElementById('dashTrend'), {
                    type: 'bar',
                    data: {
                        labels,
                        datasets: [
                            { type: 'bar', label: t('dr.eff.kpi.output'), data: d.trend.map(t => t.output), backgroundColor: 'rgba(41,128,185,0.6)', yAxisID: 'y', order: 2 },
                            { type: 'line', label: t('dr.eff.kpi.hours'), data: d.trend.map(t => t.total_hours), borderColor: '#e67e22', backgroundColor: 'rgba(230,126,34,0.2)', tension: 0.3, yAxisID: 'y1', order: 1 }
                        ]
                    },
                    options: {
                        responsive: true,
                        plugins: { legend: { position: 'top' } },
                        scales: {
                            y: { type: 'linear', position: 'left', title: { display: true, text: t('dr.eff.kpi.output') } },
                            y1: { type: 'linear', position: 'right', title: { display: true, text: t('dr.eff.kpi.hours') }, grid: { drawOnChartArea: false } }
                        }
                    }
                }));
            } catch (e) { el.innerHTML = `<p style="color:#e74c3c;">${esc(e.message)}</p>`; }
        },

        // ============ P2-② 月度经营+人效报告 ============
        openMgmtReport() {
            this.view = 'mgmtReport';
            this.destroyCharts();
            const now = new Date();
            if (!this._mbrYM) {
                this._mbrYM = { year: this.filters.year || now.getFullYear(), mm: this.filters.month || String(now.getMonth() + 1).padStart(2, '0') };
            }
            this.c.innerHTML = `
                <div class="card">
                    <div class="toolbar" style="flex-wrap:wrap;gap:10px;">
                        <label><b>${t('dr.mbr.period')}：</b>
                            <select id="mbrYear">${this.yearOptions(this._mbrYM.year)}</select> /
                            <select id="mbrMonth">${this.monthOptions(this._mbrYM.mm)}</select>
                        </label>
                        <button class="btn btn-primary" onclick="DRApp.loadMgmtReport()">🔍 ${t('dr.btn.query')}</button>
                        <button class="btn" style="background:#78281f;color:#fff;" onclick="DRApp.pushMgmtReport()">📤 ${t('dr.mbr.push')}</button>
                        <button class="btn" style="background:#1a5276;color:#fff;" onclick="DRApp.openMgmtInbox()">📨 ${t('dr.mbr.inbox')}</button>
                        <button class="btn" style="margin-left:auto;" onclick="DRApp.back()">↩️ ${t('dr.btn.back')}</button>
                    </div>
                    <div id="mbrBody" style="margin-top:12px;">${t('loading')}</div>
                </div>`;
            this.loadMgmtReport();
        },

        async loadMgmtReport() {
            const el = document.getElementById('mbrBody');
            if (!el) return;
            const y = document.getElementById('mbrYear').value;
            const mm = document.getElementById('mbrMonth').value;
            this._mbrYM = { year: y, mm };
            const ym = y + '/' + mm;
            el.innerHTML = `<p style="color:#7f8c8d;">${t('loading')}</p>`;
            try {
                const res = await API.get('/api/daily-report/monthly-business-report?bu_no=' + encodeURIComponent(State.bu_no) + '&YYYY_MM=' + encodeURIComponent(ym));
                const r = res.data;
                const b = r.business, h = r.hr, e = r.efficiency;
                const momTag = b.output_mom != null
                    ? `<span style="color:${b.output_mom >= 0 ? '#27ae60' : '#e74c3c'};font-size:0.85em;">(${b.output_mom >= 0 ? '↑' : '↓'} ${Math.abs(b.output_mom)}%)</span>`
                    : '';
                el.innerHTML = `
                    <h3 style="margin:0 0 12px 0;color:#2c3e50;">📑 ${t('dr.mbr.title')} · ${esc(r.period)}</h3>
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:18px;">
                        <div style="background:#eaf2f8;padding:14px;border-radius:8px;">
                            <div style="font-weight:700;color:#1a5276;margin-bottom:6px;">💰 ${t('dr.mbr.business')}</div>
                            <div>${t('dr.eff.kpi.output')}: <b>${UI.fmt(b.output)}</b> ${momTag}</div>
                            <div>${t('dr.mbr.invoice')}: ${UI.fmt(b.invoice_amt)} (${b.invoice_cnt} ${t('dr.mbr.pen')})</div>
                            <div>${t('dr.mbr.po')}: ${UI.fmt(b.po_amt)} (${b.po_cnt} ${t('dr.mbr.pen')})</div>
                            <div>${t('dr.mbr.so')}: ${b.so_cnt} ${t('dr.mbr.pen')}</div>
                        </div>
                        <div style="background:#f4ecf7;padding:14px;border-radius:8px;">
                            <div style="font-weight:700;color:#6c3483;margin-bottom:6px;">👥 ${t('dr.mbr.hr')}</div>
                            <div>${t('dr.eff.kpi.emp')}: <b>${h.employee_cnt}</b></div>
                            <div>${t('dr.eff.kpi.salary')}: ${UI.fmt(h.salary_total)}</div>
                            <div>${t('dr.eff.kpi.per_salary')}: ${UI.fmt(h.avg_salary)}</div>
                        </div>
                        <div style="background:#e8f8f5;padding:14px;border-radius:8px;">
                            <div style="font-weight:700;color:#117a65;margin-bottom:6px;">⚙️ ${t('dr.mbr.efficiency')}</div>
                            <div>${t('dr.eff.kpi.per_output')}: <b>${UI.fmt(e.per_capita_output)}</b></div>
                            <div>${t('dr.eff.kpi.per_hours')}: ${UI.fmt(e.per_capita_hours)} h</div>
                            <div>${t('dr.sum.col.work_ratio')}: ${e.work_ratio}%</div>
                            <div>${t('dr.mbr.report_users')}: ${e.report_users} (${e.report_days} ${t('dr.mbr.days')})</div>
                        </div>
                    </div>

                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;">
                        <div>
                            <h4 style="margin:0 0 10px 0;">🏆 ${t('dr.mbr.top')}</h4>
                            <table class="data-table" style="font-size:0.9em;">
                                <thead><tr><th>#</th><th>${t('dr.sum.col.writer')}</th><th>${t('dr.sum.col.depart')}</th><th>${t('dr.sum.col.hours')}</th></tr></thead>
                                <tbody>${r.top_performers.map((u, i) => `
                                    <tr><td>${i + 1}</td><td>${esc(u.user_id)} ${esc(u.user_name || '')}</td><td>${esc(u.depart_id || '-')}</td><td class="num">${UI.fmt(u.total_hours)}</td></tr>`).join('') || `<tr><td colspan="4" style="text-align:center;color:#95a5a6;">${t('dr.empty')}</td></tr>`}
                                </tbody>
                            </table>
                        </div>
                        <div>
                            <h4 style="margin:0 0 10px 0;">⚠️ ${t('dr.mbr.bottom')}</h4>
                            <table class="data-table" style="font-size:0.9em;">
                                <thead><tr><th>#</th><th>${t('dr.sum.col.writer')}</th><th>${t('dr.sum.col.depart')}</th><th>${t('dr.sum.col.hours')}</th></tr></thead>
                                <tbody>${r.bottom_performers.map((u, i) => `
                                    <tr style="background:#fdf6e3;"><td>${i + 1}</td><td>${esc(u.user_id)} ${esc(u.user_name || '')}</td><td>${esc(u.depart_id || '-')}</td><td class="num">${UI.fmt(u.total_hours)}</td></tr>`).join('') || `<tr><td colspan="4" style="text-align:center;color:#95a5a6;">${t('dr.empty')}</td></tr>`}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div style="margin-top:18px;">
                        <h4 style="margin:0 0 10px 0;">🏢 ${t('dr.eff.dept_title')}</h4>
                        <table class="data-table" style="font-size:0.9em;">
                            <thead><tr><th>${t('dr.sum.col.depart')}</th><th>${t('dr.eff.kpi.emp')}</th><th>${t('dr.eff.kpi.hours')}</th><th>${t('dr.eff.kpi.per_hours')}</th></tr></thead>
                            <tbody>${r.departments.map(dp => `
                                <tr>
                                    <td>${esc(dp.depart_id)}</td>
                                    <td class="num">${dp.emp_cnt}</td>
                                    <td class="num">${UI.fmt(dp.total_hours)}</td>
                                    <td class="num">${dp.emp_cnt > 0 ? UI.fmt(Math.round(dp.total_hours / dp.emp_cnt * 100) / 100) : 0}</td>
                                </tr>`).join('') || `<tr><td colspan="4" style="text-align:center;color:#95a5a6;">${t('dr.empty')}</td></tr>`}
                            </tbody>
                        </table>
                    </div>

                    <div style="margin-top:14px;font-size:0.8em;color:#95a5a6;">${t('dr.mbr.gen_at')}: ${esc(r.generated_at)}</div>`;
            } catch (e) { el.innerHTML = `<p style="color:#e74c3c;">${esc(e.message)}</p>`; }
        },

        async pushMgmtReport() {
            const y = document.getElementById('mbrYear').value;
            const mm = document.getElementById('mbrMonth').value;
            const ym = y + '/' + mm;
            try {
                const res = await API.post('/api/daily-report/monthly-business-report/push', { bu_no: State.bu_no, YYYY_MM: ym });
                const d = res.data;
                if (d.delivered) {
                    UI.toast(`${t('dr.mbr.pushed_ok')}：${esc(ym)} → ${d.recipients.length} 位高管`, 'success');
                } else {
                    UI.toast(`${t('dr.mbr.push_failed')}：${esc(d.message || '')}`, 'error');
                }
            } catch (e) { UI.toast(e.message, 'error'); }
        },

        // ============ P2-② 高管報告收件箱 ============
        openMgmtInbox() {
            this.view = 'mgmtInbox';
            this.destroyCharts();
            this.c.innerHTML = `
                <div class="card">
                    <div class="toolbar" style="flex-wrap:wrap;gap:10px;">
                        <h3 style="margin:0;">📨 ${t('dr.mbr.inbox')}</h3>
                        <button class="btn" style="margin-left:auto;" onclick="DRApp.openMgmtReport()">↩️ ${t('dr.mbr.back_to_report')}</button>
                    </div>
                    <div id="inboxBody" style="margin-top:12px;">${t('loading')}</div>
                </div>`;
            this.loadMgmtInbox();
        },

        async loadMgmtInbox() {
            const el = document.getElementById('inboxBody');
            if (!el) return;
            try {
                const res = await API.get('/api/daily-report/mgmt-reports?bu_no=' + encodeURIComponent(State.bu_no));
                const rows = res.data || [];
                if (rows.length === 0) {
                    el.innerHTML = `<p style="color:#95a5a6;text-align:center;padding:30px;">${t('dr.empty')}</p>`;
                    return;
                }
                const statusBadge = s => {
                    if (s === 'PUSHED') return '<span style="background:#d4efdf;color:#196f3d;padding:2px 8px;border-radius:10px;font-size:0.8em;">✓ ' + t('dr.mbr.st_pushed') + '</span>';
                    if (s === 'FAILED') return '<span style="background:#fadbd8;color:#922b21;padding:2px 8px;border-radius:10px;font-size:0.8em;">✗ ' + t('dr.mbr.st_failed') + '</span>';
                    return '<span style="background:#fcf3cf;color:#7d6608;padding:2px 8px;border-radius:10px;font-size:0.8em;">' + t('dr.mbr.st_pending') + '</span>';
                };
                el.innerHTML = `
                    <table class="data-table" style="font-size:0.9em;">
                        <thead><tr>
                            <th>${t('dr.mbr.col_period')}</th><th>${t('dr.mbr.col_status')}</th>
                            <th>${t('dr.mbr.col_output')}</th><th>${t('dr.mbr.col_emp')}</th><th>${t('dr.mbr.col_per_output')}</th>
                            <th>${t('dr.mbr.col_pusher')}</th><th>${t('dr.mbr.col_push_time')}</th>
                            <th>${t('dr.mbr.col_delivered')}</th><th>${t('dr.mbr.col_recipients')}</th>
                            <th>${t('dr.mbr.col_action')}</th>
                        </tr></thead>
                        <tbody>${rows.map(r => `
                            <tr>
                                <td><b>${esc(r.YYYY_MM)}</b></td>
                                <td>${statusBadge(r.status)}</td>
                                <td class="num">${UI.fmt(Number(r.output) || 0)}</td>
                                <td class="num">${Number(r.employee_cnt) || 0}</td>
                                <td class="num">${UI.fmt(Number(r.per_capita_output) || 0)}</td>
                                <td>${esc(r.pushed_by_name || r.pushed_by || '-')}</td>
                                <td style="font-size:0.8em;">${esc(r.pushed_time || '-')}</td>
                                <td style="font-size:0.8em;">${esc(r.delivered_time || '-')}${r.error_msg ? `<div style="color:#e74c3c;font-size:0.75em;">${esc(r.error_msg)}</div>` : ''}</td>
                                <td style="font-size:0.75em;max-width:180px;word-break:break-all;">${esc(r.recipients || '-')}</td>
                                <td><button class="btn btn-primary" style="padding:2px 10px;font-size:0.8em;" onclick="DRApp.viewMgmtReport(${r.id})">${t('dr.mbr.col_view')}</button></td>
                            </tr>`).join('')}
                        </tbody>
                    </table>`;
            } catch (e) { el.innerHTML = `<p style="color:#e74c3c;">${esc(e.message)}</p>`; }
        },

        async viewMgmtReport(id) {
            try {
                const res = await API.get('/api/daily-report/mgmt-reports/' + id);
                const r = res.data;
                const rd = r.report_data || {};
                const b = rd.business || {}, h = rd.hr || {}, e = rd.efficiency || {};
                const deptRows = (rd.departments || []).map(d => `
                    <tr><td>${esc(d.depart_id)}</td><td class="num">${d.emp_cnt}</td><td class="num">${UI.fmt(d.total_hours)}</td></tr>`).join('');
                const topRows = (rd.top_performers || []).map((u, i) => `
                    <tr><td>${i + 1}</td><td>${esc(u.user_id)} ${esc(u.user_name || '')}</td><td>${esc(u.depart_id || '-')}</td><td class="num">${UI.fmt(u.total_hours)}</td></tr>`).join('');
                this.c.innerHTML = `
                    <div class="card">
                        <div class="toolbar" style="flex-wrap:wrap;gap:10px;">
                            <h3 style="margin:0;">📑 ${esc(r.bu_no)} · ${esc(r.YYYY_MM)}</h3>
                            <button class="btn" style="margin-left:auto;" onclick="DRApp.openMgmtInbox()">↩️ ${t('dr.mbr.back_to_inbox')}</button>
                        </div>
                        <div style="margin-top:12px;">
                            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px;">
                                <div style="background:#eaf2f8;padding:14px;border-radius:8px;">
                                    <div style="font-weight:700;color:#1a5276;margin-bottom:6px;">💰 ${t('dr.mbr.business')}</div>
                                    <div>${t('dr.eff.kpi.output')}: <b>${UI.fmt(b.output)}</b></div>
                                    <div>${t('dr.mbr.invoice')}: ${UI.fmt(b.invoice_amt)}</div>
                                    <div>${t('dr.mbr.po')}: ${UI.fmt(b.po_amt)}</div>
                                </div>
                                <div style="background:#f4ecf7;padding:14px;border-radius:8px;">
                                    <div style="font-weight:700;color:#6c3483;margin-bottom:6px;">👥 ${t('dr.mbr.hr')}</div>
                                    <div>${t('dr.eff.kpi.emp')}: <b>${h.employee_cnt}</b></div>
                                    <div>${t('dr.eff.kpi.salary')}: ${UI.fmt(h.salary_total)}</div>
                                </div>
                                <div style="background:#e8f8f5;padding:14px;border-radius:8px;">
                                    <div style="font-weight:700;color:#117a65;margin-bottom:6px;">⚙️ ${t('dr.mbr.efficiency')}</div>
                                    <div>${t('dr.eff.kpi.per_output')}: <b>${UI.fmt(e.per_capita_output)}</b></div>
                                    <div>${t('dr.eff.kpi.per_hours')}: ${e.per_capita_hours} h</div>
                                </div>
                            </div>
                            <h4>🏆 Top 5</h4>
                            <table class="data-table" style="font-size:0.9em;margin-bottom:16px;">
                                <thead><tr><th>#</th><th>${t('dr.sum.col.writer')}</th><th>${t('dr.sum.col.depart')}</th><th>${t('dr.sum.col.hours')}</th></tr></thead>
                                <tbody>${topRows}</tbody>
                            </table>
                            <h4>🏢 部門</h4>
                            <table class="data-table" style="font-size:0.9em;">
                                <thead><tr><th>${t('dr.sum.col.depart')}</th><th>${t('dr.eff.kpi.emp')}</th><th>${t('dr.eff.kpi.hours')}</th></tr></thead>
                                <tbody>${deptRows}</tbody>
                            </table>
                            <div style="margin-top:14px;font-size:0.8em;color:#7f8c8d;">
                                ${t('dr.mbr.col_push_time')}: ${esc(r.pushed_time)} · ${t('dr.mbr.col_pusher')}: ${esc(r.pushed_by_name)}
                            </div>
                        </div>
                    </div>`;
            } catch (e) { UI.toast(e.message, 'error'); }
        },

        // ============ M1 年度績效自動生成 + 分佈圖 ============
        openAnnualReview() {
            this.view = 'annualReview';
            this.destroyCharts();
            const now = new Date();
            if (!this._arY) this._arY = String(now.getFullYear());
            this.c.innerHTML = `
                <div class="card">
                    <div class="toolbar" style="flex-wrap:wrap;gap:10px;">
                        <label><b>${t('dr.ar.year')}：</b><select id="arYear">${this.yearOptions(this._arY)}</select></label>
                        <label>${t('dr.ar.grade')}：
                            <select id="arGrade">
                                <option value="">${t('dr.ar.all_grades')}</option>
                                <option value="S">S</option><option value="A">A</option>
                                <option value="B">B</option><option value="C">C</option>
                            </select>
                        </label>
                        <label>${t('dr.sum.col.depart')}：
                            <select id="arDept"><option value="">${t('dr.ar.all_depts')}</option></select>
                        </label>
                        <button class="btn btn-primary" onclick="DRApp.loadAnnualReview()">🔍 ${t('dr.btn.query')}</button>
                        <button class="btn" style="background:#7d6608;color:#fff;" onclick="DRApp.generateAnnualReview()">⚙️ ${t('dr.ar.generate')}</button>
                        <button class="btn" style="background:#1b4f72;color:#fff;" onclick="DRApp.exportAnnualReview()">📥 ${t('dr.ar.export')}</button>
                        <button class="btn" style="margin-left:auto;" onclick="DRApp.back()">↩️ ${t('dr.btn.back')}</button>
                    </div>
                    <div id="arBody" style="margin-top:12px;">${t('loading')}</div>
                </div>`;
            // 部門下拉（從 meta 填充）
            const deptSel = document.getElementById('arDept');
            (this.meta?.depts || []).forEach(d => {
                const o = document.createElement('option');
                o.value = d.dept_id || d; o.textContent = d.dept_name || d.dept_id || d;
                deptSel.appendChild(o);
            });
            this.loadAnnualReview();
        },

        async loadAnnualReview() {
            const el = document.getElementById('arBody');
            if (!el) return;
            const y = document.getElementById('arYear').value;
            const grade = document.getElementById('arGrade').value;
            const dept = document.getElementById('arDept').value;
            this._arY = y;
            el.innerHTML = `<p style="color:#7f8c8d;">${t('loading')}</p>`;
            try {
                let url = '/api/daily-report/annual-review?bu_no=' + encodeURIComponent(State.bu_no) + '&year=' + encodeURIComponent(y);
                if (grade) url += '&grade=' + encodeURIComponent(grade);
                if (dept) url += '&depart_id=' + encodeURIComponent(dept);
                const res = await API.get(url);
                const d = res.data;
                this._arData = d;
                const list = d.list || [];
                const dist = d.distribution || { grade_counts: {}, histogram: [], dept_grade: [], avg_score: 0, total: 0 };
                if (dist.total === 0) {
                    el.innerHTML = `<div style="text-align:center;padding:40px;color:#95a5a6;">
                        <p style="font-size:2em;">🏆</p>
                        <p>${t('dr.ar.empty').replace('{year}', y)}</p>
                        <p style="font-size:0.9em;">${t('dr.ar.empty_hint')}</p>
                    </div>`;
                    return;
                }
                const GRADE_STYLE = {
                    S: 'background:#f1c40f;color:#7e5500;',
                    A: 'background:#27ae60;color:#fff;',
                    B: 'background:#e67e22;color:#fff;',
                    C: 'background:#e74c3c;color:#fff;'
                };
                const badge = g => `<span style="display:inline-block;width:26px;height:26px;line-height:26px;border-radius:50%;text-align:center;font-weight:700;${GRADE_STYLE[g] || ''}">${esc(g)}</span>`;
                const gc = dist.grade_counts;

                el.innerHTML = `
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px;">
                        <div style="background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:12px;text-align:center;">
                            <div style="color:#7f8c8d;font-size:0.85em;">${t('dr.ar.headcount')}</div>
                            <div style="font-size:1.6em;font-weight:700;color:#2c3e50;">${dist.total}</div>
                        </div>
                        <div style="background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:12px;text-align:center;">
                            <div style="color:#7f8c8d;font-size:0.85em;">${t('dr.ar.avg_score')}</div>
                            <div style="font-size:1.6em;font-weight:700;color:#1b4f72;">${UI.fmt(dist.avg_score)}</div>
                        </div>
                        <div style="background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:12px;text-align:center;">
                            <div style="color:#7f8c8d;font-size:0.85em;">S/A ${t('dr.ar.excellent')}</div>
                            <div style="font-size:1.6em;font-weight:700;color:#27ae60;">${((gc.S || 0) + (gc.A || 0))} <span style="font-size:0.55em;color:#95a5a5;">(${dist.total ? Math.round(((gc.S || 0) + (gc.A || 0)) / dist.total * 1000) / 10 : 0}%)</span></div>
                        </div>
                        <div style="background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:12px;text-align:center;">
                            <div style="color:#7f8c8d;font-size:0.85em;">S / A / B / C</div>
                            <div style="font-size:1.2em;font-weight:700;padding-top:6px;">
                                <span style="color:#b7950b;">${gc.S || 0}</span> /
                                <span style="color:#27ae60;">${gc.A || 0}</span> /
                                <span style="color:#e67e22;">${gc.B || 0}</span> /
                                <span style="color:#e74c3c;">${gc.C || 0}</span>
                            </div>
                        </div>
                    </div>

                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:18px;">
                        <div style="background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:12px;">
                            <h4 style="margin:0 0 8px;text-align:center;font-size:0.95em;">${t('dr.ar.chart_grade')}</h4>
                            <canvas id="arGradeChart" height="180"></canvas>
                        </div>
                        <div style="background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:12px;">
                            <h4 style="margin:0 0 8px;text-align:center;font-size:0.95em;">${t('dr.ar.chart_hist')}</h4>
                            <canvas id="arHistChart" height="180"></canvas>
                        </div>
                        <div style="background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:12px;">
                            <h4 style="margin:0 0 8px;text-align:center;font-size:0.95em;">${t('dr.ar.chart_dept')}</h4>
                            <canvas id="arDeptChart" height="180"></canvas>
                        </div>
                    </div>

                    <table class="data-table" style="font-size:0.9em;">
                        <thead><tr>
                            <th>#</th><th>${t('dr.sum.col.writer')}</th><th>${t('dr.sum.col.depart')}</th>
                            <th>${t('dr.ar.total')}</th><th>${t('dr.ar.grade')}</th>
                            <th>${t('dr.ar.s_hours')}</th><th>${t('dr.ar.s_timely')}</th>
                            <th>${t('dr.ar.s_work')}</th><th>${t('dr.ar.s_penalty')}</th>
                            <th>${t('dr.ar.months')}</th><th>${t('dr.ar.over_m')}</th><th>${t('dr.ar.detail')}</th>
                        </tr></thead>
                        <tbody>${list.map((r, i) => `
                            <tr style="cursor:pointer;" onclick="DRApp.viewAnnualDetail(${r.id})">
                                <td class="num">${i + 1}</td>
                                <td>${esc(r.user_id)} ${esc(r.user_name || '')}</td>
                                <td>${esc(r.depart_id || '-')}</td>
                                <td class="num" style="font-weight:700;font-size:1.05em;">${UI.fmt(r.total_score)}</td>
                                <td style="text-align:center;">${badge(r.grade)}</td>
                                <td class="num">${UI.fmt(r.score_hours)}</td>
                                <td class="num">${UI.fmt(r.score_timeliness)}</td>
                                <td class="num">${UI.fmt(r.score_workratio)}</td>
                                <td class="num">${UI.fmt(r.score_penalty)}</td>
                                <td class="num">${r.months_submitted}</td>
                                <td class="num" style="color:${r.over_months > 0 ? '#e74c3c' : '#27ae60'};font-weight:700;">${r.over_months}</td>
                                <td><button class="btn btn-primary" style="padding:2px 10px;font-size:0.8em;">${t('dr.ar.view')}</button></td>
                            </tr>`).join('')}
                        </tbody>
                    </table>`;

                // 圖1：等第甜甜圈
                this.charts.push(new Chart(document.getElementById('arGradeChart'), {
                    type: 'doughnut',
                    data: {
                        labels: ['S', 'A', 'B', 'C'],
                        datasets: [{
                            data: [gc.S || 0, gc.A || 0, gc.B || 0, gc.C || 0],
                            backgroundColor: ['#f1c40f', '#27ae60', '#e67e22', '#e74c3c']
                        }]
                    },
                    options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } }
                }));
                // 圖2：分數直方圖
                this.charts.push(new Chart(document.getElementById('arHistChart'), {
                    type: 'bar',
                    data: {
                        labels: dist.histogram.map(h => h.bin),
                        datasets: [{ label: t('dr.ar.headcount'), data: dist.histogram.map(h => h.count),
                            backgroundColor: 'rgba(27,79,114,0.65)' }]
                    },
                    options: { responsive: true, plugins: { legend: { display: false } },
                        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
                }));
                // 圖3：部門 × 等第堆疊
                const deptRows = dist.dept_grade;
                this.charts.push(new Chart(document.getElementById('arDeptChart'), {
                    type: 'bar',
                    data: {
                        labels: deptRows.map(x => x.depart_id || '-'),
                        datasets: [
                            { label: 'S', data: deptRows.map(x => x.S), backgroundColor: '#f1c40f' },
                            { label: 'A', data: deptRows.map(x => x.A), backgroundColor: '#27ae60' },
                            { label: 'B', data: deptRows.map(x => x.B), backgroundColor: '#e67e22' },
                            { label: 'C', data: deptRows.map(x => x.C), backgroundColor: '#e74c3c' }
                        ]
                    },
                    options: { responsive: true,
                        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } },
                        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } }
                }));
            } catch (e) { el.innerHTML = `<p style="color:#e74c3c;">${esc(e.message)}</p>`; }
        },

        async generateAnnualReview() {
            const y = document.getElementById('arYear').value;
            if (!confirm(t('dr.ar.confirm_gen').replace('{year}', y))) return;
            const btn = document.querySelector('#arBody')?.previousElementSibling?.querySelector('button[onclick^="DRApp.generateAnnualReview"]');
            try {
                if (btn) { btn.disabled = true; btn.textContent = '⏳ ' + t('loading'); }
                const res = await API.post('/api/daily-report/annual-review/generate', { bu_no: State.bu_no, yyyy: y });
                UI.toast(res.message || t('dr.ar.gen_ok'), 'success');
                this.loadAnnualReview();
            } catch (e) { UI.toast(e.message, 'error'); }
            finally { if (btn) { btn.disabled = false; btn.textContent = '⚙️ ' + t('dr.ar.generate'); } }
        },

        exportAnnualReview() {
            const y = document.getElementById('arYear').value;
            API.download('/api/daily-report/export/annual-review.xlsx?bu_no=' + encodeURIComponent(State.bu_no) + '&year=' + encodeURIComponent(y))
                .catch(e => UI.toast(e.message, 'error'));
        },

        async viewAnnualDetail(id) {
            this.view = 'annualDetail';
            this.destroyCharts();
            this.c.innerHTML = `<div class="card"><p style="color:#7f8c8d;">${t('loading')}</p></div>`;
            try {
                const res = await API.get('/api/daily-report/annual-review/' + id);
                const r = res.data;
                const months = (r.review_data && r.review_data.months) || [];
                const GRADE_STYLE = {
                    S: 'background:#f1c40f;color:#7e5500;', A: 'background:#27ae60;color:#fff;',
                    B: 'background:#e67e22;color:#fff;', C: 'background:#e74c3c;color:#fff;'
                };
                this.c.innerHTML = `
                    <div class="card">
                        <div class="toolbar" style="flex-wrap:wrap;gap:10px;">
                            <h3 style="margin:0;">🏆 ${esc(r.yyyy)} ${t('dr.ar.title')} · ${esc(r.user_id)} ${esc(r.user_name || '')}
                                <span style="display:inline-block;width:30px;height:30px;line-height:30px;border-radius:50%;text-align:center;font-weight:700;margin-left:8px;${GRADE_STYLE[r.grade] || ''}">${esc(r.grade)}</span>
                                <span style="font-size:0.8em;color:#7f8c8d;margin-left:8px;">${esc(r.depart_id || '')}</span>
                            </h3>
                            <button class="btn" style="margin-left:auto;" onclick="DRApp.openAnnualReview()">↩️ ${t('dr.ar.back_list')}</button>
                        </div>
                        <div style="margin-top:14px;">
                            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:18px;">
                                <div style="background:#fef9e7;padding:14px;border-radius:8px;text-align:center;">
                                    <div style="color:#7f8c8d;font-size:0.85em;">${t('dr.ar.total')}</div>
                                    <div style="font-size:1.8em;font-weight:700;color:#7d6608;">${UI.fmt(Number(r.total_score))}</div>
                                </div>
                                <div style="background:#eaf2f8;padding:14px;border-radius:8px;">
                                    <div style="color:#7f8c8d;font-size:0.85em;margin-bottom:6px;">${t('dr.ar.s_hours')}（40%）</div>
                                    <div style="font-size:1.3em;font-weight:700;">${UI.fmt(Number(r.score_hours))}</div>
                                </div>
                                <div style="background:#e8f8f5;padding:14px;border-radius:8px;">
                                    <div style="color:#7f8c8d;font-size:0.85em;margin-bottom:6px;">${t('dr.ar.s_timely')}（30%）</div>
                                    <div style="font-size:1.3em;font-weight:700;">${UI.fmt(Number(r.score_timeliness))}</div>
                                </div>
                                <div style="background:#f4ecf7;padding:14px;border-radius:8px;">
                                    <div style="color:#7f8c8d;font-size:0.85em;margin-bottom:6px;">${t('dr.ar.s_work')}（20%）</div>
                                    <div style="font-size:1.3em;font-weight:700;">${UI.fmt(Number(r.score_workratio))}</div>
                                </div>
                                <div style="background:#fdedec;padding:14px;border-radius:8px;">
                                    <div style="color:#7f8c8d;font-size:0.85em;margin-bottom:6px;">${t('dr.ar.s_penalty')}（10%）</div>
                                    <div style="font-size:1.3em;font-weight:700;">${UI.fmt(Number(r.score_penalty))}</div>
                                </div>
                            </div>
                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px;">
                                <div style="background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:12px;">
                                    <h4 style="margin:0 0 8px;text-align:center;font-size:0.95em;">${t('dr.ar.radar')}</h4>
                                    <canvas id="arRadar" height="200"></canvas>
                                </div>
                                <div style="background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:12px;">
                                    <h4 style="margin:0 0 8px;text-align:center;font-size:0.95em;">${t('dr.ar.trend12')}</h4>
                                    <canvas id="arLine" height="200"></canvas>
                                </div>
                            </div>
                            <h4>${t('dr.ar.month_detail')}</h4>
                            <table class="data-table" style="font-size:0.85em;">
                                <thead><tr>
                                    <th>${t('dr.ar.col_ym')}</th><th>${t('dr.sum.col.days')}</th>
                                    <th>${t('dr.sum.col.hours')}</th><th>${t('dr.sum.col.target_h')}</th>
                                    <th>${t('dr.sum.col.achieve')}</th><th>${t('dr.sum.col.work_ratio')}</th>
                                    <th>${t('dr.sum.col.delays')}</th><th>${t('dr.sum.col.unresolved')}</th>
                                    <th>${t('dr.ar.col_locked')}</th>
                                </tr></thead>
                                <tbody>${months.map(m => `
                                    <tr${m.locked ? ' style="background:#fef9e7;"' : ''}>
                                        <td><b>${esc(m.YYYY_MM)}</b></td>
                                        <td class="num">${m.report_days}${m.due_days ? '/' + m.due_days : ''}</td>
                                        <td class="num">${UI.fmt(m.total_hours)}</td>
                                        <td class="num">${m.target_hours != null ? UI.fmt(m.target_hours) : '-'}</td>
                                        <td class="num" style="color:${m.hours_achieve == null ? '#95a5a6' : m.hours_achieve >= 100 ? '#27ae60' : m.hours_achieve >= 85 ? '#e67e22' : '#e74c3c'};">${m.hours_achieve != null ? m.hours_achieve + '%' : '-'}</td>
                                        <td class="num">${m.work_ratio}%</td>
                                        <td class="num" style="color:${m.max_delays != null && m.delay_cnt > m.max_delays ? '#e74c3c' : ''};">${m.delay_cnt}${m.max_delays != null ? '/' + m.max_delays : ''}</td>
                                        <td class="num" style="color:${m.max_unresolved != null && m.unresolved_cnt > m.max_unresolved ? '#e74c3c' : ''};">${m.unresolved_cnt}${m.max_unresolved != null ? '/' + m.max_unresolved : ''}</td>
                                        <td style="text-align:center;">${m.locked ? '🔒' : ''}</td>
                                    </tr>`).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>`;

                // 雷達圖（四維標準化）
                this.charts.push(new Chart(document.getElementById('arRadar'), {
                    type: 'radar',
                    data: {
                        labels: [t('dr.ar.s_hours'), t('dr.ar.s_timely'), t('dr.ar.s_work'), t('dr.ar.s_penalty')],
                        datasets: [{
                            label: r.user_name || r.user_id,
                            data: [Number(r.score_hours), Number(r.score_timeliness), Number(r.score_workratio), Number(r.score_penalty)],
                            backgroundColor: 'rgba(125,102,8,0.2)', borderColor: '#7d6608', pointBackgroundColor: '#7d6608'
                        }]
                    },
                    options: { responsive: true, scales: { r: { min: 0, max: 100, ticks: { stepSize: 25 } } } }
                }));
                // 12 月趨勢
                this.charts.push(new Chart(document.getElementById('arLine'), {
                    type: 'line',
                    data: {
                        labels: months.map(m => m.YYYY_MM),
                        datasets: [
                            { label: t('dr.sum.col.achieve'), data: months.map(m => m.hours_achieve),
                              borderColor: '#2980b9', backgroundColor: 'rgba(41,128,185,0.1)', tension: 0.3, yAxisID: 'y' },
                            { label: t('dr.sum.col.work_ratio'), data: months.map(m => m.work_ratio),
                              borderColor: '#27ae60', backgroundColor: 'rgba(39,174,92,0.08)', tension: 0.3, yAxisID: 'y', borderDash: [5, 4] }
                        ]
                    },
                    options: { responsive: true,
                        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } },
                        scales: {
                            y: { min: 0, max: 120, title: { display: true, text: '%' } }
                        } }
                }));
            } catch (e) {
                this.c.innerHTML = `<div class="card"><p style="color:#e74c3c;">${esc(e.message)}</p></div>`;
            }
        },

        // ============ 签核管理面板 ============
        openSignoff() {
            this.view = 'signoff';
            this.destroyCharts();
            const now = new Date();
            if (!this._signYM) {
                this._signYM = { year: this.filters.year || now.getFullYear(), mm: this.filters.month || String(now.getMonth() + 1).padStart(2, '0') };
            }
            this.c.innerHTML = `
                <div class="card">
                    <div class="toolbar" style="flex-wrap:wrap;gap:10px;">
                        <label><b>${t('dr.sign.period')}：</b>
                            <select id="drsYear">${this.yearOptions(this._signYM.year)}</select> /
                            <select id="drsMonth">${this.monthOptions(this._signYM.mm)}</select>
                        </label>
                        <button class="btn btn-primary" onclick="DRApp.loadLocks()">🔍 ${t('dr.btn.query')}</button>
                        <button class="btn" style="background:#8e44ad;color:#fff;" onclick="DRApp.lockSelected()">🔒 ${t('dr.sign.lock_selected')}</button>
                        <button class="btn" style="background:#6c3483;color:#fff;" onclick="DRApp.lockAll()">🔒 ${t('dr.sign.lock_all')}</button>
                        <button class="btn" style="margin-left:auto;" onclick="DRApp.back()">↩️ ${t('dr.btn.back')}</button>
                    </div>
                    <div id="drsBody" style="margin-top:12px;">${t('loading')}</div>
                </div>`;
            this.loadLocks();
        },

        signYM() {
            const y = document.getElementById('drsYear').value;
            const mm = document.getElementById('drsMonth').value;
            this._signYM = { year: y, mm };
            return `${y}/${mm}`;
        },

        async loadLocks() {
            const el = document.getElementById('drsBody');
            if (!el) return;
            const ym = this.signYM();
            const senior = !!(this.me && this.me.isSenior);
            el.innerHTML = `<p style="color:#7f8c8d;">${t('loading')}</p>`;
            try {
                const res = await API.get('/api/daily-report/locks?bu_no=' + encodeURIComponent(State.bu_no) + '&YYYY_MM=' + encodeURIComponent(ym));
                const rows = res.data || [];
                this._lockRows = rows;
                if (rows.length === 0) {
                    el.innerHTML = UI.empty('📭', t('dr.sign.empty'));
                    return;
                }
                const statusBadge = (r) => {
                    if (r.locked) return `<span style="color:#8e44ad;font-weight:700;">🔒 ${t('dr.sign.status.locked')}</span>`;
                    if (r.lock_status === 'UNLOCKED') return `<span style="color:#7f8c8d;">🔓 ${t('dr.sign.status.unlocked')}</span>`;
                    return `<span style="color:#27ae60;">${t('dr.sign.status.none')}</span>`;
                };
                const lockInfo = (r) => r.locked
                    ? `${esc(r.locked_by_name || r.locked_by || '')}<br><span style="color:#7f8c8d;font-size:0.85em;">${this.fmtDT(r.locked_time)}</span>`
                    : (r.lock_status === 'UNLOCKED'
                        ? `<span style="color:#d35400;">${esc(r.unlocked_by_name || r.unlocked_by || '')} ${this.fmtDT(r.unlocked_time)}</span><br><span style="color:#7f8c8d;font-size:0.85em;">${esc(r.unlock_reason || '')}</span>`
                        : '-');
                el.innerHTML = `<table class="data-table">
                    <thead><tr>
                        <th style="width:36px;"></th>
                        <th>${t('dr.sign.col.writer')}</th><th>${t('dr.sign.col.depart')}</th>
                        <th>${t('dr.sign.col.reports')}</th><th>${t('dr.sign.col.hours')}</th>
                        <th>${t('dr.sign.col.delays')}</th><th>${t('dr.sign.col.unresolved')}</th>
                        <th>${t('dr.sign.col.status')}</th><th>${t('dr.sign.col.info')}</th>
                        <th>${t('dr.sign.col.action')}</th>
                    </tr></thead>
                    <tbody>${rows.map(r => `
                        <tr${r.locked ? ' style="background:#f4ecf7;"' : ''}>
                            <td><input type="checkbox" class="drs-chk" data-uid="${esc(r.user_id)}" ${r.locked ? 'disabled' : ''}></td>
                            <td>${esc(r.user_id)} - ${esc(r.user_name || '')}</td>
                            <td>${esc(r.depart_id || '-')}</td>
                            <td class="num">${r.report_cnt}</td>
                            <td class="num">${UI.fmt(r.hours)}</td>
                            <td class="num" style="color:${r.delays ? '#e67e22' : ''};">${r.delays}</td>
                            <td class="num" style="color:${r.unresolved ? '#e74c3c' : ''};">${r.unresolved}</td>
                            <td>${statusBadge(r)}</td>
                            <td style="max-width:220px;font-size:0.88em;">${lockInfo(r)}</td>
                            <td>${(senior && r.locked) ? `<button class="btn btn-sm" style="background:#d35400;color:#fff;" data-unlock-uid="${esc(r.user_id)}" data-unlock-name="${esc(r.user_name || r.user_id)}">🔓 ${t('dr.sign.unlock')}</button>` : '-'}</td>
                        </tr>`).join('')}
                    </tbody></table>`;
                el.querySelectorAll('button[data-unlock-uid]').forEach(btn => {
                    btn.addEventListener('click', () => this.askUnlock(btn.dataset.unlockUid, btn.dataset.unlockName));
                });
            } catch (e) {
                el.innerHTML = `<p style="color:#e74c3c;">${t('dr.msg.load_fail')}: ${esc(e.message)}</p>`;
            }
        },

        async lockSelected() {
            const uids = Array.from(document.querySelectorAll('.drs-chk:checked')).map(c => c.dataset.uid);
            if (uids.length === 0) { UI.toast(t('dr.sign.pick_first'), 'error'); return; }
            if (!confirm(t('dr.sign.confirm_lock').replace('{n}', uids.length))) return;
            const ym = this._signYM.year + '/' + this._signYM.mm;
            try {
                const res = await API.post('/api/daily-report/lock', { bu_no: State.bu_no, YYYY_MM: ym, user_ids: uids });
                UI.toast(res.message || 'OK', 'success');
                this.loadLocks();
            } catch (e) { UI.toast(e.message, 'error'); }
        },

        async lockAll() {
            if (!confirm(t('dr.sign.confirm_lock_all'))) return;
            const ym = this._signYM.year + '/' + this._signYM.mm;
            try {
                const res = await API.post('/api/daily-report/lock', { bu_no: State.bu_no, YYYY_MM: ym, batch: true });
                UI.toast(res.message || 'OK', 'success');
                this.loadLocks();
            } catch (e) { UI.toast(e.message, 'error'); }
        },

        askUnlock(uid, uname) {
            UI.modal(`🔓 ${t('dr.sign.unlock')} - ${esc(uname)} (${esc(uid)})`, `
                <div style="line-height:1.8;margin-bottom:8px;color:#a04000;">${t('dr.sign.unlock_notice')}</div>
                <label><b>${t('dr.sign.unlock_reason')}：</b></label>
                <textarea id="drsUnlockReason" rows="4" style="width:100%;margin-top:4px;" placeholder="${t('dr.sign.unlock_reason_ph')}"></textarea>
            `, `
                <button class="btn btn-primary" onclick="DRApp.doUnlock('${esc(uid)}','${esc(uname)}')">${t('confirm')}</button>
                <button class="btn" onclick="UI.closeModal()">${t('cancel')}</button>
            `);
        },

        async doUnlock(uid, uname) {
            const reason = (document.getElementById('drsUnlockReason').value || '').trim();
            if (!reason) { UI.toast(t('dr.sign.reason_required'), 'error'); return; }
            const ym = this._signYM.year + '/' + this._signYM.mm;
            try {
                const res = await API.post('/api/daily-report/unlock', { bu_no: State.bu_no, YYYY_MM: ym, user_id: uid, reason });
                UI.closeModal();
                UI.toast(res.message || 'OK', 'success');
                this.loadLocks();
            } catch (e) { UI.toast(e.message, 'error'); }
        },

        // ============ 审计日志查询弹窗 ============
        openAudit() {
            const now = new Date();
            this._auditFilter = { year: now.getFullYear(), mm: String(now.getMonth() + 1).padStart(2, '0'), action: '', page: 1 };
            UI.modal(`📜 ${t('dr.audit.title')}`, `
                <div style="min-width:780px;max-width:90vw;">
                    <div class="toolbar" style="flex-wrap:wrap;gap:8px;">
                        <select id="draYear">${this.yearOptions(this._auditFilter.year)}</select> /
                        <select id="draMonth">${this.monthOptions(this._auditFilter.mm)}</select>
                        <select id="draAction">
                            <option value="">${t('dr.all')}</option>
                            ${['CREATE', 'UPDATE', 'DELETE', 'LOCK', 'UNLOCK'].map(a =>
                                `<option value="${a}">${t('dr.audit.act.' + a)}</option>`).join('')}
                        </select>
                        <button class="btn btn-primary btn-sm" onclick="DRApp.loadAudit(1)">🔍 ${t('dr.btn.query')}</button>
                    </div>
                    <div id="draBody" style="margin-top:10px;max-height:60vh;overflow:auto;">${t('loading')}</div>
                </div>
            `, `<button class="btn" onclick="UI.closeModal()">${t('modal.close')}</button>`);
            this.loadAudit(1);
        },

        auditActionBadge(a) {
            const colors = { CREATE: '#27ae60', UPDATE: '#2980b9', DELETE: '#e74c3c', LOCK: '#8e44ad', UNLOCK: '#d35400' };
            const key = 'dr.audit.act.' + a;
            return `<span style="background:${colors[a] || '#7f8c8d'};color:#fff;padding:2px 8px;border-radius:10px;font-size:0.82em;white-space:nowrap;">${t(key)}</span>`;
        },

        async loadAudit(page) {
            const el = document.getElementById('draBody');
            if (!el) return;
            const f = this._auditFilter;
            f.year = document.getElementById('draYear').value;
            f.mm = document.getElementById('draMonth').value;
            f.action = document.getElementById('draAction').value;
            f.page = page || 1;
            const qs = new URLSearchParams({ bu_no: State.bu_no, page: f.page, pageSize: 15 });
            if (f.year && f.mm) qs.set('YYYY_MM', f.year + '/' + f.mm);
            if (f.action) qs.set('action', f.action);
            el.innerHTML = `<p style="color:#7f8c8d;">${t('loading')}</p>`;
            try {
                const res = await API.get('/api/daily-report/audit-logs?' + qs.toString());
                const rows = res.data.list || [];
                this._auditRows = rows;
                if (rows.length === 0) { el.innerHTML = UI.empty('📭', t('dr.audit.empty')); return; }
                const pages = Math.max(1, Math.ceil(res.data.total / res.data.pageSize));
                el.innerHTML = `<table class="data-table" style="font-size:0.88em;">
                    <thead><tr>
                        <th>${t('dr.audit.col.time')}</th><th>${t('dr.audit.col.action')}</th>
                        <th>${t('dr.audit.col.target')}</th><th>${t('dr.audit.col.operator')}</th>
                        <th>${t('dr.audit.col.ip')}</th><th>${t('dr.audit.col.remark')}</th><th></th>
                    </tr></thead>
                    <tbody>${rows.map((r, i) => `
                        <tr>
                            <td style="white-space:nowrap;">${this.fmtDT(r.created_time)}</td>
                            <td>${this.auditActionBadge(r.action)}</td>
                            <td>${esc(r.target_user_name || r.target_user_id)}<br><span style="color:#7f8c8d;font-size:0.9em;">${esc(r.YYYY_MM || '')} ${esc(r.report_date || '')}</span></td>
                            <td>${esc(r.operator_name || r.operator_id)}</td>
                            <td style="font-size:0.85em;">${esc(r.operator_ip || '-')}</td>
                            <td style="max-width:200px;font-size:0.85em;color:#d35400;">${esc(r.remark || '-')}</td>
                            <td><button class="btn btn-sm" data-diff-idx="${i}">${t('dr.audit.view_diff')}</button></td>
                        </tr>`).join('')}
                    </tbody></table>
                    <div class="toolbar" style="justify-content:flex-end;gap:8px;margin-top:8px;">
                        <button class="btn btn-sm" ${f.page <= 1 ? 'disabled' : ''} onclick="DRApp.loadAudit(${f.page - 1})">◀</button>
                        <span>${f.page} / ${pages}</span>
                        <button class="btn btn-sm" ${f.page >= pages ? 'disabled' : ''} onclick="DRApp.loadAudit(${f.page + 1})">▶</button>
                    </div>`;
                el.querySelectorAll('button[data-diff-idx]').forEach(btn => {
                    btn.addEventListener('click', () => this.showAuditDiff(Number(btn.dataset.diffIdx)));
                });
            } catch (e) {
                el.innerHTML = `<p style="color:#e74c3c;">${esc(e.message)}</p>`;
            }
        },

        showAuditDiff(idx) {
            const r = (this._auditRows || [])[idx];
            if (!r) return;
            const pretty = (val) => {
                if (val == null || val === '') return '(' + t('dr.audit.none') + ')';
                if (typeof val === 'string') {
                    try { val = JSON.parse(val); } catch (e) { return val; }
                }
                return JSON.stringify(val, null, 2);
            };
            const block = (title, val) => `
                <div style="margin-top:8px;"><b>${title}</b></div>
                <pre style="background:#f8f9fa;border:1px solid #e0e0e0;border-radius:6px;padding:8px;max-height:260px;overflow:auto;font-size:12px;white-space:pre-wrap;word-break:break-all;">${esc(pretty(val))}</pre>`;
            UI.modal(`${t('dr.audit.view_diff')} #${r.id} - ${this.auditActionBadge(r.action)}`,
                `<div style="min-width:640px;max-width:88vw;max-height:72vh;overflow:auto;">
                    <div style="color:#7f8c8d;font-size:0.9em;">${this.fmtDT(r.created_time)}　${esc(r.operator_name || '')} (${esc(r.operator_id)})　${esc(r.operator_ip || '')}</div>
                    ${block(t('dr.audit.old_data'), r.old_data)}
                    ${block(t('dr.audit.new_data'), r.new_data)}
                    ${r.remark ? `<div style="margin-top:8px;color:#d35400;"><b>${t('dr.audit.col.remark')}：</b>${esc(r.remark)}</div>` : ''}
                </div>`,
                `<button class="btn btn-primary" onclick="UI.closeModal()">${t('modal.close')}</button>`);
        },

        // 日期时间格式化（mysql datetime / ISO 一律转本地 YYYY-MM-DD HH:mm）
        fmtDT(v) {
            if (!v) return '-';
            const s = String(v);
            if (s.includes('T')) {
                const d = new Date(s);
                if (!isNaN(d.getTime())) {
                    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ` +
                        `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                }
            }
            return s.slice(0, 16);
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
