﻿﻿﻿/**
 * 关账页面：日历 + 任务清单 + 抵消分录 + 折算汇率
 */
const ClosingPage = {
    tab: 'calendar',  // calendar | elimination | rate
    YYYY_MM: '',

    async load() {
        const el = document.getElementById('pageContent');
        if (!el) return;
        if (!Auth.isLoggedIn()) { Auth.showLogin(); return; }
        // 默认取最新可用月份
        if (!this.YYYY_MM) {
            const res = await API.get('/api/consolidation/income?YYYY_MM=2025-12').catch(() => null);
            this.YYYY_MM = '2025-12';
        }
        this.renderTabs();
        try {
            if (this.tab === 'calendar') await this.renderCalendar();
            else if (this.tab === 'elimination') await this.renderElimination();
            else if (this.tab === 'rate') await this.renderRate();
        } catch (e) {
            el.innerHTML = `<div style="padding:20px;color:#e74c3c;">${appEsc(e.message)}</div>`;
        }
    },

    renderTabs() {
        document.getElementById('pageTitle').textContent = APP_L('关账管理', '關賬管理', 'Closing Management');
        document.getElementById('pageContent').innerHTML = `
            <div class="page-header">
                <div class="tabs">
                    <div class="tab-item ${this.tab==='calendar'?'active':''}" onclick="ClosingPage.switchTab('calendar')">${APP_L('关账日历', '關賬日曆', 'Closing Calendar')}</div>
                    <div class="tab-item ${this.tab==='elimination'?'active':''}" onclick="ClosingPage.switchTab('elimination')">${APP_L('抵消分录', '抵消分錄', 'Elimination Entries')}</div>
                    <div class="tab-item ${this.tab==='rate'?'active':''}" onclick="ClosingPage.switchTab('rate')">${APP_L('折算汇率', '折算匯率', 'Exchange Rates')}</div>
                </div>
                <div class="page-actions">
                    <input id="closingMonth" type="month" value="${this.YYYY_MM}" style="padding:4px 8px;border:1px solid #ccc;border-radius:4px;">
                    <button class="btn btn-primary" onclick="ClosingPage.loadMonth()">${APP_L('切换月份', '切換月份', 'Go')}</button>
                </div>
            </div>
            <div id="closingBody"></div>
        `;
        const tabsEl = document.querySelector('#pageContent .tabs');
        if (tabsEl && typeof bindTabs === 'function') bindTabs(tabsEl);
    },

    switchTab(t) { this.tab = t; this.load(); },
    loadMonth() {
        const m = document.getElementById('closingMonth');
        if (m) { this.YYYY_MM = m.value; this.load(); }
    },

    // ======== 关账日历 ========
    async renderCalendar() {
        const el = document.getElementById('closingBody');
        const res = await API.get(`/api/closing/calendar?YYYY_MM=${this.YYYY_MM}`);
        const rows = res.data;

        el.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-top:12px;">
            ${rows.map(r => this.cardHtml(r)).join('')}
            </div>
            <div style="margin-top:20px;padding:16px;background:#f8f9fa;border-radius:8px;">
                <h4>${APP_L('批量关账', '批量關賬', 'Batch Close')}</h4>
                <p style="color:#7f8c8d;">${APP_L('提示：未完成任务超过 0 项时，仅管理员可强制关账。', '提示：未完成任務超過 0 項時，僅管理員可強制關賬。', 'Tip: Only admins can force-close when tasks remain undone.')}</p>
                <button class="btn btn-primary" onclick="ClosingPage.batchClose()">${APP_L('一键关账全部公司', '一鍵關賬全部公司', 'Close All')}</button>
            </div>
        `;
    },

    cardHtml(r) {
        const appEsc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
        const closed = r.status === 'CLOSED';
        const pct = r.task_pct ?? 0;
        return `
            <div style="border:1px solid ${closed ? '#27ae60' : '#ecf0f1'};border-radius:10px;padding:16px;background:${closed ? '#eafff5' : '#fff'};">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <h3 style="margin:0;">${appEsc(r.bu_no)}</h3>
                    <span class="badge ${closed ? 'bg-success' : 'bg-warning'}">${closed ? APP_L('已关账', '已關賬', 'Closed') : APP_L('进行中', '進行中', 'Open')}</span>
                </div>
                <div style="margin-top:12px;">
                    <div style="display:flex;justify-content:space-between;font-size:13px;color:#7f8c8d;">
                        <span>${APP_L('任务完成度', '任務完成度', 'Tasks')}</span>
                        <span>${r.task_done}/${r.task_total} (${pct}%)</span>
                    </div>
                    <div style="height:8px;background:#ecf0f1;border-radius:4px;margin-top:4px;overflow:hidden;">
                        <div style="height:100%;width:${pct}%;background:${pct===100?'#27ae60':'#f39c12'};transition:width .3s;"></div>
                    </div>
                </div>
                ${closed ? `
                    <div style="margin-top:10px;font-size:12px;color:#7f8c8d;">
                        ${APP_L('关账时间', '關賬時間', 'Closed')}：${appEsc(String(r.close_time||'').substring(0,16).replace('T',' '))}<br>
                        ${APP_L('关账人', '關賬人', 'By')}：${appEsc(r.closed_by||'-')}
                    </div>` : ''}
                <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="btn btn-ghost" onclick="ClosingPage.openChecklist('${r.bu_no}')">${APP_L('任务清单', '任務清單', 'Checklist')}</button>
                    ${closed
                        ? `<button class="btn btn-ghost" onclick="ClosingPage.reopen('${r.bu_no}')" ${Auth.isAdmin()?'':'disabled'}>${APP_L('重开', '重開', 'Reopen')}</button>`
                        : `<button class="btn btn-primary" onclick="ClosingPage.closeOne('${r.bu_no}')">${APP_L('关账', '關賬', 'Close')}</button>`
                    }
                </div>
            </div>
        `;
    },

    async closeOne(bu) {
        try {
            const res = await API.post(`/api/closing/calendar/${bu}/${this.YYYY_MM}/close`, {});
            UI.toast(res.message, 'success');
            this.renderCalendar();
        } catch (e) { UI.toast(e.message, 'error'); }
    },
    async reopen(bu) {
        if (!confirm(APP_L('确认重开关账？', '確認重開關賬？', 'Reopen this period?'))) return;
        try {
            await API.post(`/api/closing/calendar/${bu}/${this.YYYY_MM}/reopen`, {});
            UI.toast(APP_L('已重开', '已重開', 'Reopened'), 'success');
            this.renderCalendar();
        } catch (e) { UI.toast(e.message, 'error'); }
    },
    async batchClose() {
        if (!confirm(APP_L('确认关账全部公司？', '確認關賬全部公司？', 'Close all companies?'))) return;
        const companies = ['HM', 'HN', 'SZ'];
        let done = 0, failed = 0;
        for (const bu of companies) {
            try {
                await API.post(`/api/closing/calendar/${bu}/${this.YYYY_MM}/close`, {});
                done++;
            } catch (e) { failed++; }
        }
        UI.toast(`${APP_L('完成', '完成', 'Done')}: ${done}/${companies.length}`, 'success');
        this.renderCalendar();
    },

    // ======== 任务清单弹窗 ========
    async openChecklist(bu) {
        const appEsc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
        const res = await API.get(`/api/closing/checklist?bu_no=${bu}&YYYY_MM=${this.YYYY_MM}`);
        const items = res.data;
        const cats = { INPUT:APP_L('输入项','輸入項','Input'), CALC:APP_L('计算项','計算項','Calc'), CONSOL:APP_L('合并项','合併項','Consol'), REPORT:APP_L('报表项','報表項','Report') };

        const rows = items.map(it => `
            <tr>
                <td style="width:32px;"><input type="checkbox" ${it.status==='DONE'||it.status==='NA'?'checked':''} onchange="ClosingPage.toggleTask(${it.id}, this.checked)"></td>
                <td>${it.sort_order}</td>
                <td><b>${appEsc(it.task_name)}</b><br><small style="color:#7f8c8d;">${appEsc(it.task_code)}</small></td>
                <td>${cats[it.category] || it.category}</td>
                <td>${it.status==='DONE'?APP_L('已完成','已完成','Done'):it.status==='NA'?APP_L('不适用','不適用','N/A'):APP_L('待处理','待處理','Open')}</td>
                <td>${appEsc(it.done_by || '-')}</td>
                <td>${appEsc(String(it.done_time || '').substring(0,16).replace('T',' '))}</td>
            </tr>`).join('');

        UI.modal(
            `${bu} ${this.YYYY_MM} - ${APP_L('关账任务清单', '關賬任務清單', 'Closing Checklist')}`,
            `<div style="overflow-x:auto;">
                <table class="data-table" style="font-size:13px;">
                    <thead><tr>
                        <th></th><th>#</th><th>${APP_L('任务', '任務', 'Task')}</th><th>${APP_L('类别', '類別', 'Category')}</th>
                        <th>${APP_L('状态', '狀態', 'Status')}</th><th>${APP_L('完成人', '完成人', 'By')}</th><th>${APP_L('完成时间', '完成時間', 'Time')}</th>
                    </tr></thead><tbody>${rows}</tbody>
                </table>
             </div>`,
            `<button class="btn btn-ghost" onclick="UI.closeModal()">${APP_L('关闭', '關閉', 'Close')}</button>`
        );
    },
    async toggleTask(id, checked) {
        try {
            await API.put(`/api/closing/checklist/${id}`, { status: checked ? 'DONE' : 'OPEN' });
            this.renderCalendar();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    // ======== 抵消分录 ========
    async renderElimination() {
        const el = document.getElementById('closingBody');
        const res = await API.get(`/api/closing/elimination?YYYY_MM=${this.YYYY_MM}`);
        const rows = res.data;
        const appEsc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

        el.innerHTML = `
            <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
                <button class="btn btn-ghost" onclick="ClosingPage.autoGenElim()">${APP_L('自动生成内部销售冲销', '自動生成內部銷售沖銷', 'Auto Gen Internal Sale')}</button>
                <button class="btn btn-primary" onclick="ClosingPage.openElimForm()">${APP_L('+ 新增抵消分录', '+ 新增抵消分錄', '+ New Entry')}</button>
                ${Auth.isAdmin() ? `<button class="btn btn-warning" onclick="ClosingPage.bulkConfirm()">${APP_L('批量确认全部', '批量確認全部', 'Bulk Confirm')}</button>` : ''}
            </div>
            <div style="margin-top:12px;overflow-x:auto;">
            <table class="data-table">
                <thead><tr>
                    <th>${APP_L('发起方', '發起方', 'From')}</th><th>${APP_L('接收方', '接收方', 'To')}</th>
                    <th>${APP_L('类型', '類型', 'Type')}</th><th>${APP_L('金额', '金額', 'Amount')}</th>
                    <th>${APP_L('汇率', '匯率', 'Rate')}</th><th>${APP_L('新台币', '新台幣', 'TWD')}</th>
                    <th>${APP_L('来源', '來源', 'Source')}</th><th>${APP_L('状态', '狀態', 'Status')}</th>
                    <th>${APP_L('操作', '操作', 'Actions')}</th>
                </tr></thead>
                <tbody>${rows.length ? rows.map(r => `
                    <tr>
                        <td>${appEsc(r.bu_no_from)}</td>
                        <td>${appEsc(r.bu_no_to)}</td>
                        <td>${appEsc(r.entry_type)}</td>
                        <td style="text-align:right;">${UI.fmt(r.amount)} ${appEsc(r.currency)}</td>
                        <td>${r.rate_to_twd}</td>
                        <td style="text-align:right;">${UI.fmt(r.amount_twd)}</td>
                        <td>${r.source==='AUTO_INTERNAL_SALE'?'🔄':'✏️'}</td>
                        <td>${r.is_confirmed?'<span class="badge bg-success">'+APP_L('已确认','已確認','Confirmed')+'</span>':'<span class="badge bg-warning">'+APP_L('待确认','待確認','Pending')+'</span>'}</td>
                        <td>
                            <button class="btn btn-ghost" onclick="ClosingPage.openElimForm(${r.id})">${APP_L('编辑','編輯','Edit')}</button>
                            ${!r.is_confirmed?`<button class="btn btn-ghost" onclick="ClosingPage.confirmElim(${r.id})">${APP_L('确认','確認','Confirm')}</button>`:''}
                            <button class="btn btn-danger" onclick="ClosingPage.delElim(${r.id})">${APP_L('删除','刪除','Del')}</button>
                        </td>
                    </tr>`).join('') : `<tr><td colspan="9" style="text-align:center;color:#999;padding:20px;">${APP_L('暂无抵消分录', '暫無抵消分錄', 'No entries yet')}</td></tr>`}
                </tbody>
            </table></div>
        `;
    },

    async autoGenElim() {
        try {
            const res = await API.post('/api/closing/elimination/generate', { YYYY_MM: this.YYYY_MM });
            UI.toast(res.message, 'success');
            this.renderElimination();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async openElimForm(id) {
        const appEsc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
        let d = { YYYY_MM: this.YYYY_MM, bu_no_from: 'HM', bu_no_to: 'HN', entry_type: 'SALE', amount: 0, currency: 'TWD', rate_to_twd: 1, is_confirmed: false, remark: '' };
        if (id) {
            // 简单读取列表中数据（也可调用详情）
            const res = await API.get(`/api/closing/elimination?YYYY_MM=${this.YYYY_MM}`);
            d = res.data.find(x => x.id === id) || d;
        }
        UI.modal(
            (id ? APP_L('编辑抵消分录', '編輯抵消分錄', 'Edit Elimination') : APP_L('新增抵消分录', '新增抵消分錄', 'New Elimination')),
            `
            <div class="form-grid">
                <div><label>${APP_L('年月', '年月', 'Period')}</label><input class="form-input" id="f_ym" value="${this.YYYY_MM}"></div>
                <div><label>${APP_L('发起方', '發起方', 'From')}</label><select class="form-input" id="f_from">${['HM','HN','SZ'].map(v=>`<option ${d.bu_no_from===v?'selected':''}>${v}</option>`).join('')}</select></div>
                <div><label>${APP_L('接收方', '接收方', 'To')}</label><select class="form-input" id="f_to">${['HM','HN','SZ'].map(v=>`<option ${d.bu_no_to===v?'selected':''}>${v}</option>`).join('')}</select></div>
                <div><label>${APP_L('类型', '類型', 'Type')}</label><select class="form-input" id="f_type">${['SALE','AR','AP','LOAN','DIVIDEND','OTHER'].map(v=>`<option ${d.entry_type===v?'selected':''}>${v}</option>`).join('')}</select></div>
                <div><label>${APP_L('金额', '金額', 'Amount')}</label><input type="number" step="0.01" class="form-input" id="f_amt" value="${d.amount}"></div>
                <div><label>${APP_L('币种', '幣種', 'Currency')}</label><select class="form-input" id="f_cur">${['TWD','USD','RMB','EUR','HKD','JPY'].map(v=>`<option ${d.currency===v?'selected':''}>${v}</option>`).join('')}</select></div>
                <div><label>${APP_L('汇率', '匯率', 'Rate')}</label><input type="number" step="0.000001" class="form-input" id="f_rate" value="${d.rate_to_twd || 1}"></div>
                <div class="col-2"><label>${APP_L('备注', '備註', 'Remark')}</label><input class="form-input" id="f_remark" value="${appEsc(d.remark||'')}"></div>
                <div><label><input type="checkbox" id="f_conf" ${d.is_confirmed?'checked':''}> ${APP_L('确认生效', '確認生效', 'Confirm')}</label></div>
            </div>
            `,
            `<button class="btn btn-ghost" onclick="UI.closeModal()">${APP_L('取消', '取消', 'Cancel')}</button>
             <button class="btn btn-primary" onclick="ClosingPage.saveElim(${id||0})">${APP_L('保存', '保存', 'Save')}</button>`
        );
    },

    async saveElim(id) {
        const f = (sel) => document.querySelector(sel).value;
        const body = {
            YYYY_MM: f('#f_ym'), bu_no_from: f('#f_from'), bu_no_to: f('#f_to'),
            entry_type: f('#f_type'), amount: Number(f('#f_amt')) || 0,
            currency: f('#f_cur'), rate_to_twd: Number(f('#f_rate')) || 1,
            remark: f('#f_remark'), is_confirmed: document.querySelector('#f_conf').checked
        };
        try {
            const res = id ? await API.put(`/api/closing/elimination/${id}`, body) : await API.post('/api/closing/elimination', body);
            UI.toast(res.message, 'success');
            UI.closeModal();
            this.renderElimination();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async confirmElim(id) {
        if (!Auth.isAdmin()) return UI.toast(APP_L('仅管理员可确认', '僅管理員可確認', 'Admin only'), 'error');
        try {
            await API.put(`/api/closing/elimination/${id}`, { is_confirmed: true });
            UI.toast(APP_L('已确认', '已確認', 'Confirmed'), 'success');
            this.renderElimination();
        } catch (e) { UI.toast(e.message, 'error'); }
    },
    async bulkConfirm() {
        if (!confirm(APP_L('确认全部待确认分录？', '確認全部待確認分錄？', 'Confirm all pending?'))) return;
        const res = await API.get(`/api/closing/elimination?YYYY_MM=${this.YYYY_MM}`);
        for (const r of res.data.filter(x => !x.is_confirmed)) {
            try { await API.put(`/api/closing/elimination/${r.id}`, { is_confirmed: true }); } catch(e) {}
        }
        UI.toast(APP_L('已全部确认', '已全部確認', 'All confirmed'), 'success');
        this.renderElimination();
    },
    async delElim(id) {
        if (!confirm(APP_L('确认删除？', '確認刪除？', 'Confirm delete?'))) return;
        try { await API.del(`/api/closing/elimination/${id}`); this.renderElimination(); }
        catch (e) { UI.toast(e.message, 'error'); }
    },

    // ======== 折算汇率 ========
    async renderRate() {
        const el = document.getElementById('closingBody');
        const res = await API.get(`/api/closing/rates?YYYY_MM=${this.YYYY_MM}`);
        const rates = res.data;

        el.innerHTML = `
            <div style="margin-top:12px;">
                <table class="data-table" id="rateTable">
                    <thead><tr>
                        <th>${APP_L('币种', '幣種', 'Currency')}</th>
                        <th>${APP_L('对TWD汇率', '對TWD匯率', 'Rate to TWD')}</th>
                        <th>${APP_L('对USD汇率', '對USD匯率', 'Rate to USD')}</th>
                        <th>${APP_L('类型', '類型', 'Type')}</th>
                        <th>${APP_L('来源', '來源', 'Source')}</th>
                    </tr></thead>
                    <tbody id="rateRows">
                    ${['TWD','USD','RMB','EUR','HKD','JPY'].map(cur => {
                        const r = rates.find(x => x.currency === cur) || { currency: cur, rate_to_twd: cur==='TWD'?1:'', rate_to_usd:'', rate_type:'AVG', source:'CURRENCY_CODE' };
                        return `<tr>
                            <td><b>${cur}</b></td>
                            <td><input type="number" step="0.000001" class="form-input" value="${r.rate_to_twd}" data-cur="${cur}" data-k="rate_to_twd"></td>
                            <td><input type="number" step="0.000001" class="form-input" value="${r.rate_to_usd || ''}" data-cur="${cur}" data-k="rate_to_usd"></td>
                            <td><select class="form-input" data-cur="${cur}" data-k="rate_type">${['AVG','END','OPEN'].map(v=>`<option ${r.rate_type===v?'selected':''}>${v}</option>`).join('')}</select></td>
                            <td>${r.source}</td>
                        </tr>`;
                    }).join('')}
                    </tbody>
                </table>
                <div style="margin-top:12px;display:flex;gap:8px;">
                    <button class="btn btn-primary" onclick="ClosingPage.saveRates()">${APP_L('保存汇率', '保存匯率', 'Save Rates')}</button>
                    <button class="btn btn-ghost" onclick="ClosingPage.copyFromCode()">${APP_L('从码表同步', '從碼表同步', 'Sync from Code')}</button>
                </div>
            </div>
        `;
    },

    async saveRates() {
        const rows = document.querySelectorAll('#rateRows tr');
        const rates = [];
        for (const tr of rows) {
            const cur = tr.querySelector('[data-k="rate_to_twd"]').dataset.cur;
            rates.push({
                currency: cur,
                rate_to_twd: Number(tr.querySelector('[data-k="rate_to_twd"]').value) || 0,
                rate_to_usd: Number(tr.querySelector('[data-k="rate_to_usd"]').value) || null,
                rate_type: tr.querySelector('[data-k="rate_type"]').value,
                source: 'MANUAL'
            });
        }
        try {
            const res = await API.post('/api/closing/rates', { YYYY_MM: this.YYYY_MM, rates });
            UI.toast(res.message, 'success');
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async copyFromCode() {
        const [cur] = await CodeHelper.list('CURRENCY');
        if (!cur.length) return UI.toast(APP_L('码表无数据', '碼表無數據', 'No code data'), 'error');
        const rows = document.querySelectorAll('#rateRows tr');
        for (const tr of rows) {
            const cur2 = tr.querySelector('[data-k="rate_to_twd"]').dataset.cur;
            const match = cur.find(c => c.code_value === cur2);
            if (match && cur2 !== 'TWD') {
                tr.querySelector('[data-k="rate_to_twd"]').value = match.value_number1;
            }
        }
        UI.toast(APP_L('已填充，请检查后保存', '已填充，請檢查後保存', 'Filled, please save'), 'success');
    }
};

registerPage('closing', () => ClosingPage.load());
