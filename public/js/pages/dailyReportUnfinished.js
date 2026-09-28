/**
 * 工作未完成分析页面
 *   视图：chart 人员未完成笔数柱状图 / detail 延误明细(五模式分页) / monthly 每月工作小时
 * 全局唯一对象 DRUnfin
 */
(function () {
    const WK_KEYS = {
        '日常工作': 'dr.wk.work', '职业发展': 'dr.wk.career', '财务状况': 'dr.wk.finance',
        '健康': 'dr.wk.health', '娱乐休闲': 'dr.wk.leisure', '家庭': 'dr.wk.family',
        '朋友圈': 'dr.wk.friends', '个人成长': 'dr.wk.growth', '自我实现': 'dr.wk.actualize'
    };

    // 柱顶数值标签插件（每次渲染随图销毁）
    const barValuePlugin = {
        id: 'druBarValue',
        afterDraw(chart) {
            const { ctx } = chart;
            chart.data.datasets.forEach((ds, si) => {
                const meta = chart.getDatasetMeta(si);
                if (meta.hidden) return;
                meta.data.forEach((bar, i) => {
                    const v = ds.data[i];
                    if (v == null) return;
                    ctx.save();
                    ctx.fillStyle = '#2c3e50';
                    ctx.font = 'bold 12px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(String(v), bar.x, bar.y - 6);
                    ctx.restore();
                });
            });
        }
    };

    // 防 XSS：用户/数据库来源字符串拼入 HTML 前必须转义
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    const DRUnfin = {
        c: null,
        meta: null,
        me: null,
        charts: [],
        view: 'chart',
        persons: [],
        // 图表页筛选状态（跨视图持久化）
        chartFilters: {
            year: new Date().getFullYear(),
            month: String(new Date().getMonth() + 1).padStart(2, '0'),
            depart_id: ''
        },
        detail: { user_id: '', user_name: '', year: '', month: '', page: 1, pageSize: 10, rows: [], total: 0 },
        monthly: { user_id: '', user_name: '', year: '' },

        wkLabel(v) { return WK_KEYS[v] ? t(WK_KEYS[v]) : (v || '-'); },
        destroyCharts() { this.charts.forEach(ch => { try { ch.destroy(); } catch (e) { } }); this.charts = []; },

        yearOptions(sel) {
            const y = new Date().getFullYear();
            let html = '';
            for (let yy = y + 1; yy >= y - 6; yy--) {
                html += `<option value="${yy}" ${String(sel) === String(yy) ? 'selected' : ''}>${yy}</option>`;
            }
            return html;
        },
        monthOptions(sel) {
            let html = '';
            for (let m = 1; m <= 12; m++) {
                const mm = String(m).padStart(2, '0');
                html += `<option value="${mm}" ${sel === mm ? 'selected' : ''}>${mm}</option>`;
            }
            return html;
        },
        writerOptions(sel) {
            const writers = (this.meta && this.meta.writers) || [];
            return writers.map(w => `<option value="${esc(w.user_id)}" ${sel === w.user_id ? 'selected' : ''}>${esc(w.user_id)} - ${esc(w.user_name || '')}</option>`).join('');
        },
        deptOptions(sel) {
            const ds = (this.meta && this.meta.departments) || [];
            return `<option value="">${t('dr.all')}</option>` +
                ds.map(d => `<option value="${esc(d)}" ${sel === d ? 'selected' : ''}>${esc(d)}</option>`).join('');
        },
        wkOptions() {
            return (this.meta.wk_types || []).map(w => `<option value="${esc(w)}">${this.wkLabel(w)}</option>`).join('');
        },

        async loadMeta() {
            if (this.meta) return;
            const res = await API.get('/api/daily-report/meta');
            this.meta = res.data;
            this.me = res.data.me;
        },

        // ============ 柱状图视图 ============
        renderChart() {
            this.view = 'chart';
            this.destroyCharts();
            const mgr = !!(this.me && this.me.isManager);
            const { year, month, depart_id } = this.chartFilters;
            this.c.innerHTML = `
                <div class="card">
                    <div class="toolbar" style="flex-wrap:wrap;gap:10px;">
                        ${mgr ? `<label>${t('dr.depart')}：<select id="druDept">${this.deptOptions(depart_id)}</select></label>` : ''}
                        <label>${t('dr.year')}：<select id="druYear">${this.yearOptions(year)}</select></label>
                        <label>${t('dr.month')}：<select id="druMonth">${this.monthOptions(month)}</select></label>
                        <button class="btn btn-primary" onclick="DRUnfin.loadChart()">🔍 ${t('dr.btn.query')}</button>
                    </div>
                    <div style="margin-top:14px;position:relative;height:380px;"><canvas id="druChart"></canvas></div>
                    <div id="druLegend" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;"></div>
                </div>`;
            this.loadChart();
        },

        async loadChart() {
            const y = document.getElementById('druYear').value;
            const m = document.getElementById('druMonth').value;
            const de = document.getElementById('druDept');
            // 同步回持久化 chartFilters
            this.chartFilters.year = y;
            this.chartFilters.month = m;
            this.chartFilters.depart_id = de ? de.value : '';
            const qs = new URLSearchParams({ bu_no: State.bu_no, year: y, month: m });
            if (de && de.value) qs.set('depart_id', de.value);
            try {
                const res = await API.get('/api/daily-report/analysis/unfinished?' + qs.toString());
                this.persons = res.data;
                this.destroyCharts();
                const chart = new Chart(document.getElementById('druChart'), {
                    type: 'bar',
                    plugins: [barValuePlugin],
                    data: {
                        labels: this.persons.map(p => p.user_name || p.user_id),
                        datasets: [{
                            label: t('dr.an.unfinished_cnt'),
                            data: this.persons.map(p => p.unfinished_cnt),
                            backgroundColor: this.persons.map((_, i) => ['#e74c3c', '#e67e22', '#f39c12', '#3498db', '#27ae60', '#9b59b6', '#1abc9c', '#34495e'][i % 8])
                        }]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: {
                            y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: t('dr.an.unfinished_cnt') } },
                            x: { title: { display: true, text: t('dr.axis.person') } }
                        },
                        onClick: (evt, els) => {
                            if (!els || els.length === 0) return;
                            const p = this.persons[els[0].index];
                            if (p) this.openDetail(p.user_id, p.user_name, y, m);
                        }
                    }
                });
                this.charts.push(chart);

                // 人员快捷按钮（点击柱图的备用入口）；用户标识走 data 属性 + 事件绑定，禁止内联拼接
                const legend = document.getElementById('druLegend');
                if (this.persons.length === 0) {
                    legend.textContent = t('dr.empty');
                } else {
                    legend.innerHTML = this.persons.map((p, i) =>
                        `<button type="button" class="btn btn-sm dru-legend-btn" data-idx="${i}"
                            style="border-color:${chart.data.datasets[0].backgroundColor[i]};"></button>`
                    ).join('');
                    legend.querySelectorAll('.dru-legend-btn').forEach(btn => {
                        const p = this.persons[Number(btn.dataset.idx)];
                        btn.textContent = `${p.user_name || p.user_id} (${p.unfinished_cnt})`;
                        btn.addEventListener('click', () => this.openDetail(p.user_id, p.user_name, y, m));
                    });
                }
            } catch (e) {
                UI.toast(e.message, 'error');
            }
        },

        // ============ 延误明细视图 ============
        openDetail(userId, userName, year, month) {
            // 同步到图表页筛选状态，确保 backChart() 返回时重建的年份/月份保持一致
            this.chartFilters.year = String(year);
            this.chartFilters.month = String(month);
            this.view = 'detail';
            this.destroyCharts();
            this.detail = { user_id: userId, user_name: userName || userId, year, month, page: 1, pageSize: 10, rows: [], total: 0 };
            this.renderDetail();
        },

        renderDetail() {
            const d = this.detail;
            const ym = `${d.year}/${d.month}`;
            const title = t('dr.delay.title').replace('{user}', esc(d.user_name)).replace('{ym}', ym);
            this.c.innerHTML = `
                <div class="card">
                    <h3 style="margin-bottom:12px;">${title}</h3>
                    <div class="toolbar" style="flex-wrap:wrap;gap:10px;">
                        <label>${t('dr.writer')}：<input value="${esc(d.user_name || d.user_id)}" disabled style="width:140px;"></label>
                        <label>${t('dr.year')}：<select id="drudYear" onchange="DRUnfin.changeDetailYM()">${this.yearOptions(d.year)}</select></label>
                        <label>${t('dr.month')}：<select id="drudMonth" onchange="DRUnfin.changeDetailYM()">${this.monthOptions(d.month)}</select></label>
                        <button class="btn btn-primary" onclick="DRUnfin.queryDetail()">🔍 ${t('dr.btn.query')}</button>
                        <button class="btn" onclick="DRUnfin.openMonthly()">📈 ${t('dr.btn.monthly')}</button>
                        <button class="btn btn-warning" onclick="DRUnfin.relink()">🔗 ${t('dr.btn.relink')}</button>
                        <button class="btn" style="margin-left:auto;" onclick="DRUnfin.backChart()">↩️ ${t('dr.btn.back')}</button>
                    </div>
                    <div id="drudTable" style="margin-top:12px;">${t('loading')}</div>
                    <div class="toolbar" id="drudPager" style="justify-content:center;gap:6px;flex-wrap:wrap;"></div>
                </div>`;
            this.loadDetail();
        },

        changeDetailYM() {
            this.detail.year = document.getElementById('drudYear').value;
            this.detail.month = document.getElementById('drudMonth').value;
            this.detail.page = 1;
            this.loadDetail();
        },

        queryDetail() {
            this.detail.year = document.getElementById('drudYear').value;
            this.detail.month = document.getElementById('drudMonth').value;
            this.detail.page = 1;
            this.loadDetail();
        },

        backChart() { this.renderChart(); },

        async loadDetail() {
            const d = this.detail;
            const qs = new URLSearchParams({
                bu_no: State.bu_no, year: d.year, month: d.month,
                user_id: d.user_id, page: d.page, pageSize: d.pageSize
            });
            const el = document.getElementById('drudTable');
            try {
                const res = await API.get('/api/daily-report/analysis/delays?' + qs.toString());
                d.rows = res.data.list;
                d.total = res.data.total;
                d.page = res.data.page;
                if (d.rows.length === 0) {
                    el.innerHTML = UI.empty('📝', t('dr.empty'));
                } else {
                    el.innerHTML = `<table class="data-table">
                        <thead><tr>
                            <th>${t('dr.col.seq')}</th>
                            <th style="width:130px;">${t('dr.work_date')}</th>
                            <th>${t('dr.delay_content')}</th>
                            <th>${t('dr.still_unresolved')}</th>
                        </tr></thead>
                        <tbody>${d.rows.map((r, i) => `
                            <tr>
                                <td>${(d.page - 1) * d.pageSize + i + 1}</td>
                                <td>${esc(r.report_date)}</td>
                                <td style="color:#e67e22;">${r.projects1 ? esc(r.projects1) : '-'}</td>
                                <td style="color:#e74c3c;">${r.projects2 ? esc(r.projects2) : '-'}</td>
                            </tr>`).join('')}</tbody>
                    </table>`;
                }
                this.renderDetailPager();
            } catch (e) {
                if (el) {
                    el.innerHTML = `<p class="dru-detail-err" style="color:#e74c3c"></p>`;
                    el.querySelector('.dru-detail-err').textContent = e.message;
                }
            }
        },

        // 五模式分页：第一页 / 前10页 / 页码跳转 / 后10页 / 最后一页
        renderDetailPager() {
            const pg = document.getElementById('drudPager');
            const d = this.detail;
            const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
            const cur = d.page;
            const start = Math.max(1, Math.floor((cur - 1) / 10) * 10 + 1);
            const end = Math.min(pages, start + 9);
            let nums = '';
            for (let p = start; p <= end; p++) {
                nums += `<button class="btn btn-sm ${p === cur ? 'btn-primary' : ''}" onclick="DRUnfin.goDetailPage(${p})">${p}</button>`;
            }
            pg.innerHTML = `
                <button class="btn btn-sm" ${cur <= 1 ? 'disabled' : ''} onclick="DRUnfin.goDetailPage(1)">${t('dr.pg.first')}</button>
                <button class="btn btn-sm" ${start <= 1 ? 'disabled' : ''} onclick="DRUnfin.goDetailPage(${start - 10})">${t('dr.pg.prev10')}</button>
                ${nums}
                <button class="btn btn-sm" ${end >= pages ? 'disabled' : ''} onclick="DRUnfin.goDetailPage(${end + 1})">${t('dr.pg.next10')}</button>
                <button class="btn btn-sm" ${cur >= pages ? 'disabled' : ''} onclick="DRUnfin.goDetailPage(${pages})">${t('dr.pg.last')}</button>
                <span style="margin-left:8px;">${t('dr.pg.jump')}
                    <input type="number" min="1" max="${pages}" value="${cur}" id="druJump" style="width:64px;" onkeydown="if(event.key==='Enter')DRUnfin.jumpPage()">
                </span>
                <span style="margin-left:8px;color:#7f8c8d;">${t('dr.page_total').replace('{n}', d.total)}</span>`;
        },
        goDetailPage(p) {
            const pages = Math.max(1, Math.ceil(this.detail.total / this.detail.pageSize));
            if (p < 1 || p > pages) return;
            this.detail.page = p;
            this.loadDetail();
        },
        jumpPage() {
            const v = Number(document.getElementById('druJump').value);
            if (v) this.goDetailPage(v);
        },

        async relink() {
            const d = this.detail;
            if (!d.user_id) { UI.toast(t('dr.msg.need_writer'), 'error'); return; }
            try {
                const res = await API.post('/api/daily-report/relink', {
                    bu_no: State.bu_no, year: Number(d.year), month: d.month, user_id: d.user_id
                });
                const msg = t('dr.msg.relink_ok')
                    .replace('{c}', res.data.master_rows)
                    .replace('{a}', res.data.derived_rows).replace('{b}', res.data.relinked_rows);
                UI.toast(msg, 'success');
                this.loadDetail();
            } catch (e) { UI.toast(e.message, 'error'); }
        },

        // ============ 每月工作小时视图 ============
        openMonthly() {
            this.view = 'monthly';
            this.destroyCharts();
            this.monthly = { user_id: this.detail.user_id, user_name: this.detail.user_name, year: this.detail.year };
            this.renderMonthly();
        },

        renderMonthly() {
            const m = this.monthly;
            const mgr = !!(this.me && this.me.isManager);
            this.c.innerHTML = `
                <div class="card">
                    <h3 style="margin-bottom:12px;">${t('dr.an.monthly_title')} - ${esc(m.user_name || m.user_id)}</h3>
                    <div class="toolbar" style="flex-wrap:wrap;gap:10px;">
                        ${mgr ? `<label>${t('dr.depart')}：<select id="drumDept">${this.deptOptions('')}</select></label>` : ''}
                        <label>${t('dr.writer')}：<select id="drumUser">${this.writerOptions(m.user_id)}</select></label>
                        <label>${t('dr.year')}：<select id="drumYear">${this.yearOptions(m.year)}</select></label>
                        <label style="display:flex;align-items:center;gap:4px;">
                            <input type="checkbox" id="drumByType" onchange="DRUnfin.toggleWk()"> ${t('dr.an.time_by_type')}
                        </label>
                        <label id="drumWkWrap" style="display:none;">${t('dr.an.category')}：
                            <select id="drumWk">${this.wkOptions()}</select>
                        </label>
                        <button class="btn btn-primary" onclick="DRUnfin.loadMonthly()">🔍 ${t('dr.btn.query')}</button>
                        <button class="btn" style="margin-left:auto;" onclick="DRUnfin.backDetail()">↩️ ${t('dr.btn.back')}</button>
                    </div>
                    <div style="margin-top:14px;position:relative;height:380px;"><canvas id="drumChart"></canvas></div>
                    <div id="drumDetail" style="margin-top:18px;"></div>
                </div>`;
            if (!mgr) {
                document.getElementById('drumUser').innerHTML =
                    `<option value="${esc(this.me.user_id)}">${esc(this.me.user_name)}</option>`;
            }
            this.loadMonthly();
        },

        toggleWk() {
            const c = document.getElementById('drumByType');
            document.getElementById('drumWkWrap').style.display = c.checked ? '' : 'none';
        },

        backDetail() {
            this.destroyCharts();
            this.renderDetail();
        },

        async loadMonthly() {
            const u = document.getElementById('drumUser').value;
            const y = document.getElementById('drumYear').value;
            const de = document.getElementById('drumDept');
            const byType = document.getElementById('drumByType').checked;
            const wk = document.getElementById('drumWk');
            const qs = new URLSearchParams({ bu_no: State.bu_no, year: y });
            if (u) qs.set('user_id', u);
            // monthly-hours 不支持部门过滤；部门用于撰写人切换参考，参数保留不发送
            if (byType) {
                qs.set('timeByType', '1');
                if (wk && wk.value) qs.set('wk_type', wk.value);
            }
            try {
                const res = await API.get('/api/daily-report/analysis/monthly-hours?' + qs.toString());
                const rows = res.data;
                this.destroyCharts();
                this.charts.push(new Chart(document.getElementById('drumChart'), {
                    type: 'bar',
                    plugins: [barValuePlugin],
                    data: {
                        labels: rows.map(r => r.label),
                        datasets: [{
                            label: t('dr.an.work_series'),
                            data: rows.map(r => Number(r.hours)),
                            backgroundColor: '#3498db'
                        }]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: {
                            y: { beginAtZero: true, title: { display: true, text: t('dr.axis.hours') } },
                            x: { title: { display: true, text: t('dr.axis.month') } }
                        },
                        onClick: (evt, els) => {
                            if (!els || els.length === 0) return;
                            const r = rows[els[0].index];
                            if (r) this.loadMonthlyDetail(r.YYYY_MM, r.label);
                        }
                    }
                }));
                void de;
            } catch (e) {
                UI.toast(e.message, 'error');
            }
        },

        // 点击月柱 → 显示该月明细（依勾选的时间类别过滤）
        async loadMonthlyDetail(YYYY_MM, label) {
            const u = document.getElementById('drumUser').value;
            const y = document.getElementById('drumYear').value;
            const byType = document.getElementById('drumByType').checked;
            const wk = document.getElementById('drumWk');
            const detailEl = document.getElementById('drumDetail');
            const qs = new URLSearchParams({ bu_no: State.bu_no, year: y, YYYY_MM });
            if (u) qs.set('user_id', u);
            if (byType && wk && wk.value) qs.set('wk_type', wk.value);
            const catLabel = byType && wk && wk.value ? ' \u00b7 ' + this.wkLabel(wk.value) : '';
            detailEl.innerHTML = '<p style="color:#7f8c8d;">' + t('loading') + '</p>';
            try {
                const res = await API.get('/api/daily-report/analysis/monthly-detail?' + qs.toString());
                const rows = res.data || [];
                if (rows.length === 0) {
                    detailEl.innerHTML = UI.empty('\u{1F4CB}', t('dr.empty'));
                    return;
                }
                const total = rows.reduce((s, r) => s + Number(r.use_time || 0), 0);
                const that = this;
                const bodyRows = rows.map(function(r) {
                    return '<tr>' +
                        '<td>' + esc(r.report_date) + '</td>' +
                        '<td>' + esc(r.from_time || '') + (r.to_time ? ' ~ ' + esc(r.to_time) : '') + '</td>' +
                        '<td>' + esc(that.wkLabel(r.wk_type)) + '</td>' +
                        '<td style="max-width:320px;" title="' + esc(r.projects || '') + '">' + esc(r.projects || '-') + '</td>' +
                        '<td>' + esc(r.client_id || '-') + '</td>' +
                        '<td>' + esc(r.items_id || '-') + '</td>' +
                        '<td class="num">' + UI.fmt(r.use_time) + '</td>' +
                        '</tr>';
                }).join('');
                const header = '<h4 style="margin:0 0 10px 0;color:#2c3e50;">' +
                    '\u{1F4C5} ' + esc(label) + esc(catLabel) +
                    '<span style="font-size:0.85em;color:#7f8c8d;font-weight:normal;">' +
                    '(' + rows.length + ' ' + t('dr.an.detail_count') + ', ' +
                    t('dr.an.total_hours') + ': ' + UI.fmt(total) + ' ' +
                    t('dr.axis.hours') + ')</span></h4>';
                const tbl = '<table class="data-table">' +
                    '<thead><tr>' +
                    '<th>' + t('dr.col.date') + '</th>' +
                    '<th>' + t('dr.an.time_range') + '</th>' +
                    '<th>' + t('dr.an.wk_type') + '</th>' +
                    '<th>' + t('dr.col.work') + '</th>' +
                    '<th>' + t('dr.an.client') + '</th>' +
                    '<th>' + t('dr.an.items') + '</th>' +
                    '<th>' + t('dr.col.hours') + '</th>' +
                    '</tr></thead><tbody>' + bodyRows + '</tbody></table>';
                detailEl.innerHTML = header + tbl;
            } catch (e) {
                detailEl.innerHTML = '<p style="color:#e74c3c;">' + t('dr.msg.load_fail') + ': ' + e.message + '</p>';
            }
        }
    };

    window.DRUnfin = DRUnfin;

    registerPage('dailyReportUnfinished', async (c, params = {}) => {
        DRUnfin.c = c;
        try {
            await DRUnfin.loadMeta();
        } catch (e) {
            c.innerHTML = `<div class="card"><p class="dru-load-err" style="color:#e74c3c"></p></div>`;
            c.querySelector('.dru-load-err').textContent = t('dr.msg.load_fail') + ': ' + e.message;
            return;
        }
        const { autoDetail } = params || {};
        if (autoDetail && autoDetail.user_id && autoDetail.year && autoDetail.month) {
            DRUnfin.openDetail(autoDetail.user_id, autoDetail.user_name || autoDetail.user_id, String(autoDetail.year), autoDetail.month);
        } else {
            DRUnfin.renderChart();
        }
    });
})();
