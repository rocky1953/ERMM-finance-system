/**
 * CEO-05 组织人效分析页面
 * KPI + 部门编制与人效 + 近 6 个月趋势 + 目标贯通（公司→部门→个人）
 */
function hrEsc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function hrShiftMonth(ym, delta) {
    const [y, m] = String(ym || '').split('-').map(Number);
    const d = new Date(y || new Date().getFullYear(), (m || 1) - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// 三语标签：依当前界面语言取字（zh-CN / zh-TW / en）
const HE_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] ?? zh);

registerPage('hrEfficiency', async (c) => {
    const bu = ['HM', 'HN', 'SZ'].includes(State.bu_no) ? State.bu_no : 'HM';
    HrEff.bu = bu;
    // 初次載入依「畫面最上方」全域年月
    HrEff.month = (State.YYYY_MM && /^\d{4}-\d{2}$/.test(State.YYYY_MM)) ? State.YYYY_MM : '';
    const buOpts = await CodeHelper.buSel({ selected: bu });
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
            <h2 style="margin:0;font-size:20px;">${HE_L('组织人效分析', '組織人效分析', 'Org HR Efficiency')}
                <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">${HE_L('：金额单位 RMB', '：金額單位 RMB', ': Amounts in RMB')}</small>
            </h2>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <select id="heBu" class="form-control" style="width:90px;" onchange="HrEff.reload()">${buOpts}</select>
                <input id="heMonth" type="month" class="form-control" style="width:150px;" onchange="HrEff.reload()">
                <button class="btn btn-ghost" onclick="HrEff.openCopy()">${HE_L('复制上月编制', '複製上月編制', 'Copy Last Month Plan')}</button>
                <button class="btn btn-primary" onclick="HrEff.openPlan()">+ ${HE_L('新增部门编制', '新增部門編制', 'New Dept Plan')}</button>
                <button class="btn btn-success" onclick="HrEff.load()">${HE_L('刷新', '重新整理', 'Refresh')}</button>
            </div>
        </div>
        <div id="heKpi" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:14px;"></div>
        <div class="card" style="margin-bottom:14px;">
            <div class="card-title">${HE_L('部门编制与人效', '部門編制與人效', 'Dept Headcount & Efficiency')}</div>
            <div id="heDeptTable">${t('loading')}</div>
        </div>
        <div class="card" style="margin-bottom:14px;">
            <div class="card-title">${HE_L('近 6 个月人效趋势', '近 6 個月人效趨勢', '6-Month Efficiency Trend')}</div>
            <div id="heTrend">${t('loading')}</div>
        </div>
        <div class="card">
            <div class="card-title">${HE_L('目标贯通（公司 → 部门 → 个人）', '目標貫通（公司 → 部門 → 個人）', 'Goal Alignment (Company → Dept → Person)')}</div>
            <div id="heTree">${t('loading')}</div>
        </div>
    `;
    document.getElementById('heBu').value = bu;
    if (HrEff.month) document.getElementById('heMonth').value = HrEff.month;
    await HrEff.load();
});

const HrEff = {
    bu: 'HM',
    month: '',
    data: null,

    async reload() {
        this.bu = document.getElementById('heBu').value;
        this.month = String(document.getElementById('heMonth').value || '').trim();
        await this.load();
    },

    async load() {
        const box = document.getElementById('heDeptTable');
        if (box) box.innerHTML = t('loading');
        try {
            let url = `/api/hr-efficiency/overview?bu_no=${encodeURIComponent(this.bu)}`;
            if (this.month) url += `&YYYY_MM=${encodeURIComponent(this.month)}`;
            const res = await API.get(url);
            this.data = res.data;
            this.month = res.data.period;
            const mi = document.getElementById('heMonth');
            if (mi && !mi.value) mi.value = this.month;
            this.renderKpis();
            this.renderDepartments();
            this.renderTrend();
            this.loadTree();
        } catch (e) {
            if (box) box.innerHTML = `<p style="color:#e74c3c;padding:12px;">${hrEsc(e.message)}</p>`;
        }
    },

    renderKpis() {
        const el = document.getElementById('heKpi');
        if (!el) return;
        const k = (this.data && this.data.kpi) || {};
        const rate = k.headcount_rate;
        const cards = [
            [HE_L('实际人数', '實際人數', 'Actual HC'), UI.fmt(k.employee_cnt || 0), '#2c3e50'],
            [HE_L('编制人数', '編制人數', 'Planned HC'), UI.fmt(k.plan_headcount || 0), '#2c3e50'],
            [HE_L('人数差异', '人數差異', 'HC Gap'), k.headcount_gap == null ? '-' : (k.headcount_gap > 0 ? '+' : '') + k.headcount_gap,
                k.headcount_gap > 0 ? '#e67e22' : '#27ae60'],
            [HE_L('编制达成率', '編制達成率', 'Staffing Rate'), rate == null ? '-' : rate + '%', rate != null && rate > 100 ? '#e67e22' : '#27ae60'],
            [HE_L('总产值', '總產值', 'Total Output'), '¥ ' + UI.fmt(k.total_output || 0), '#2980b9'],
            [HE_L('人均产值', '人均產值', 'Output per Capita'), '¥ ' + UI.fmt(k.per_capita_output || 0), '#2980b9'],
            [HE_L('薪资总额', '薪資總額', 'Total Salary'), '¥ ' + UI.fmt(k.salary_total || 0), '#8e44ad'],
            [HE_L('人均薪资', '人均薪資', 'Salary per Capita'), '¥ ' + UI.fmt(k.per_capita_salary || 0), '#8e44ad'],
            [HE_L('人工成本率', '人工成本率', 'Labor Cost Rate'), k.labor_cost_rate == null ? '-' : k.labor_cost_rate + '%', '#e74c3c'],
            [HE_L('总工时', '總工時', 'Total Hours'), UI.fmt(k.total_hours || 0), '#16a085'],
            [HE_L('人均工时', '人均工時', 'Hours per Capita'), UI.fmt(k.per_capita_hours || 0), '#16a085'],
            [HE_L('日报人数', '日報人數', 'Daily Report Users'), UI.fmt(k.report_user_cnt || 0), '#7f8c8d']
        ];
        el.innerHTML = cards.map(([label, val, color]) => `
            <div class="card" style="margin:0;padding:14px;">
                <div style="color:#7f8c8d;font-size:.82em;">${label}</div>
                <div style="font-size:1.3em;font-weight:700;margin-top:6px;color:${color};">${val}</div>
            </div>`).join('');
    },

    renderDepartments() {
        const el = document.getElementById('heDeptTable');
        if (!el) return;
        const rows = (this.data && this.data.departments) || [];
        if (!rows.length) {
            el.innerHTML = `<p style="color:#7f8c8d;padding:12px;">${HE_L('本月暂无可统计的部门数据，请先维护部门编制或日报。', '本月暫無可統計的部門數據，請先維護部門編制或日報。', 'No department data this month. Maintain department plans or daily reports first.')}</p>`;
            return;
        }
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table">
                <thead><tr>
                    <th>${HE_L('部门', '部門', 'Department')}</th>
                    <th style="text-align:right;">${HE_L('编制人数', '編制人數', 'Planned HC')}</th>
                    <th style="text-align:right;">${HE_L('实际人数', '實際人數', 'Actual HC')}</th>
                    <th style="text-align:right;">${HE_L('差异', '差異', 'Gap')}</th>
                    <th style="text-align:right;">${HE_L('达成率', '達成率', 'Rate')}</th>
                    <th style="text-align:right;">${HE_L('工时合计', '工時合計', 'Total Hours')}</th>
                    <th style="text-align:right;">${HE_L('人均工时', '人均工時', 'Hours per Capita')}</th>
                    <th style="text-align:right;">${HE_L('工时占比', '工時占比', 'Hours Share')}</th>
                    <th style="text-align:right;">${HE_L('及时率', '及時率', 'Timeliness')}</th>
                    <th style="text-align:right;">${HE_L('工作占比', '工作占比', 'Work Ratio')}</th>
                    <th>${HE_L('操作', '操作', 'Actions')}</th>
                </tr></thead>
                <tbody>
                ${rows.map(r => {
                    const gap = r.headcount_gap;
                    const gapColor = gap == null ? '#7f8c8d' : (gap > 0 ? '#e67e22' : (gap < 0 ? '#27ae60' : '#7f8c8d'));
                    return `<tr>
                        <td><b>${hrEsc(r.depart_name)}</b></td>
                        <td style="text-align:right;">${r.plan_headcount || 0}</td>
                        <td style="text-align:right;">${r.actual_headcount == null ? '-' : r.actual_headcount}</td>
                        <td style="text-align:right;color:${gapColor};">${gap == null ? '-' : (gap > 0 ? '+' : '') + gap}</td>
                        <td style="text-align:right;">${r.headcount_rate == null ? '-' : r.headcount_rate + '%'}</td>
                        <td style="text-align:right;">${UI.fmt(r.total_hours)}</td>
                        <td style="text-align:right;">${UI.fmt(r.per_capita_hours)}</td>
                        <td style="text-align:right;">${r.output_share}%</td>
                        <td style="text-align:right;">${r.timeliness_rate}%</td>
                        <td style="text-align:right;">${r.work_ratio}%</td>
                        <td style="white-space:nowrap;">
                            <button class="btn btn-ghost" onclick="HrEff.editByDept('${hrEsc(r.depart_name)}')">${HE_L('编辑', '編輯', 'Edit')}</button>
                            ${r.uid ? `<button class="btn btn-danger" onclick="HrEff.delPlan(${r.uid})">${HE_L('删除', '刪除', 'Delete')}</button>` : ''}
                        </td>
                    </tr>`;
                }).join('')}
                </tbody>
            </table></div>`;
    },

    renderTrend() {
        const el = document.getElementById('heTrend');
        if (!el) return;
        const rows = (this.data && this.data.trend) || [];
        el.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table">
                <thead><tr>
                    <th>${HE_L('月份', '月份', 'Month')}</th>
                    <th style="text-align:right;">${HE_L('实际人数', '實際人數', 'Actual HC')}</th>
                    <th style="text-align:right;">${HE_L('编制人数', '編制人數', 'Planned HC')}</th>
                    <th style="text-align:right;">${HE_L('产值', '產值', 'Output')}</th>
                    <th style="text-align:right;">${HE_L('人均产值', '人均產值', 'Output per Capita')}</th>
                    <th style="text-align:right;">${HE_L('薪资总额', '薪資總額', 'Total Salary')}</th>
                    <th style="text-align:right;">${HE_L('人均薪资', '人均薪資', 'Salary per Capita')}</th>
                    <th style="text-align:right;">${HE_L('人工成本率', '人工成本率', 'Labor Cost Rate')}</th>
                </tr></thead>
                <tbody>
                ${rows.map(r => `<tr>
                    <td>${hrEsc(r.period)}</td>
                    <td style="text-align:right;">${UI.fmt(r.employee_cnt)}</td>
                    <td style="text-align:right;">${UI.fmt(r.plan_headcount)}</td>
                    <td style="text-align:right;">${UI.fmt(r.output)}</td>
                    <td style="text-align:right;">${UI.fmt(r.per_capita_output)}</td>
                    <td style="text-align:right;">${UI.fmt(r.salary_amt)}</td>
                    <td style="text-align:right;">${UI.fmt(r.per_capita_salary)}</td>
                    <td style="text-align:right;">${r.labor_cost_rate == null ? '-' : r.labor_cost_rate + '%'}</td>
                </tr>`).join('')}
                </tbody>
            </table></div>`;
    },

    async loadTree() {
        const el = document.getElementById('heTree');
        if (!el) return;
        const year = (this.month || '').slice(0, 4) || String(new Date().getFullYear());
        try {
            const res = await API.get(`/api/strategy/overview?YYYY=${year}&bu_no=${encodeURIComponent(this.bu)}`);
            const tree = (res.data && res.data.tree) || [];
            if (!tree.length) {
                el.innerHTML = `<p style="color:#7f8c8d;padding:12px;">
                    ${HE_L(`${year} 年暂无 BSC 目标，请先到「战略目标/平衡计分卡」建立公司 → 部门 → 个人三级目标。`, `${year} 年暫無 BSC 目標，請先到「戰略目標/平衡計分卡」建立公司 → 部門 → 個人三級目標。`, `No BSC objectives for ${year} yet. Create company → department → personal objectives in "Strategic Goals / BSC" first.`)}</p>`;
                return;
            }
            el.innerHTML = `
                <div style="overflow-x:auto;">
                <table class="data-table">
                    <thead><tr>
                        <th>${HE_L('目标', '目標', 'Objective')}</th><th>${HE_L('层级', '層級', 'Level')}</th><th style="text-align:right;">${HE_L('权重', '權重', 'Weight')}</th>
                        <th style="text-align:right;">${HE_L('目标值', '目標值', 'Target')}</th><th style="text-align:right;">${HE_L('实际值', '實際值', 'Actual')}</th>
                        <th style="text-align:right;">${HE_L('达成率', '達成率', 'Rate')}</th><th>${HE_L('状态', '狀態', 'Status')}</th>
                    </tr></thead>
                    <tbody>${tree.map(n => this.treeRows(n, 0)).join('')}</tbody>
                </table></div>`;
        } catch (e) {
            el.innerHTML = `<p style="color:#e74c3c;padding:12px;">${hrEsc(e.message)}</p>`;
        }
    },

    treeRows(node, depth) {
        const levelLabel = { COMPANY: HE_L('公司', '公司', 'Company'), DEPARTMENT: HE_L('部门', '部門', 'Department'), PERSONAL: HE_L('个人', '個人', 'Personal') }[node.level] || node.level || '-';
        const statusCls = {
            ON_TRACK: 'bg-success', WARNING: 'bg-warning', LAGGING: 'bg-danger', PENDING: 'bg-info'
        }[node.status] || '';
        const statusText = {
            ON_TRACK: HE_L('达成', '達成', 'On Track'), WARNING: HE_L('警示', '警示', 'Warning'), LAGGING: HE_L('落后', '落後', 'Lagging'), PENDING: HE_L('未填报', '未填報', 'Pending')
        }[node.status] || (node.status || '-');
        const self = `<tr>
            <td style="padding-left:${12 + depth * 22}px;">${depth ? '└ ' : ''}${hrEsc(node.objective_name)}</td>
            <td>${levelLabel}</td>
            <td style="text-align:right;">${node.weight == null ? '-' : node.weight + '%'}</td>
            <td style="text-align:right;">${UI.fmt(node.target_value)}</td>
            <td style="text-align:right;">${node.actual_value == null ? '-' : UI.fmt(node.actual_value)}</td>
            <td style="text-align:right;">${node.achievement == null ? '-' : node.achievement + '%'}</td>
            <td><span class="badge ${statusCls}">${statusText}</span></td>
        </tr>`;
        return self + ((node.children || []).map(ch => this.treeRows(ch, depth + 1)).join(''));
    },

    editByDept(departName) {
        const rows = (this.data && this.data.departments) || [];
        const row = rows.find(r => r.depart_name === departName);
        this.openPlan(row || { depart_name: departName, plan_headcount: 0, plan_labor_cost: 0 });
    },

    openPlan(row) {
        const r = row && row.depart_name ? row : null;
        const v = {
            depart_name: r ? r.depart_name : '',
            plan_headcount: r ? r.plan_headcount : 0,
            actual_headcount: r && r.actual_headcount != null ? r.actual_headcount : '',
            plan_labor_cost: r ? r.plan_labor_cost : 0,
            note: r ? (r.note || '') : ''
        };
        UI.modal(r ? HE_L('编辑部门编制', '編輯部門編制', 'Edit Dept Plan') : HE_L('新增部门编制', '新增部門編制', 'New Dept Plan'), `
            <div class="form-grid">
                <div><label>${HE_L('部门名称', '部門名稱', 'Department Name')}</label>
                    <input id="he_dep" class="form-input" value="${hrEsc(v.depart_name)}" ${r ? 'disabled' : ''} placeholder="${HE_L('如：财务部', '如：財務部', 'e.g. Finance')}"></div>
                <div><label>${HE_L('编制人数', '編制人數', 'Planned HC')}</label>
                    <input type="number" min="0" step="1" id="he_plan" class="form-input" value="${v.plan_headcount}"></div>
                <div><label>${HE_L('实际人数（可空）', '實際人數（可空）', 'Actual HC (optional)')}</label>
                    <input type="number" min="0" step="1" id="he_actual" class="form-input" value="${v.actual_headcount}"></div>
                <div><label>${HE_L('编制人工成本', '編制人工成本', 'Planned Labor Cost')}</label>
                    <input type="number" min="0" step="0.01" id="he_cost" class="form-input" value="${v.plan_labor_cost}"></div>
                <div class="col-2"><label>${HE_L('备注', '備註', 'Note')}</label>
                    <input id="he_note" class="form-input" value="${hrEsc(v.note)}"></div>
            </div>
            <p style="color:#7f8c8d;font-size:.85em;margin-top:10px;">${HE_L('编制月份：', '編制月份：', 'Plan month: ')}${hrEsc(this.month || '')} · ${HE_L('公司：', '公司：', 'BU: ')}${hrEsc(this.bu)}</p>
        `, `
            <button class="btn btn-ghost" onclick="UI.closeModal()">${HE_L('取消', '取消', 'Cancel')}</button>
            <button class="btn btn-primary" onclick="HrEff.savePlan(${r && r.uid ? r.uid : 0})">${HE_L('保存', '儲存', 'Save')}</button>
        `);
    },

    async savePlan(uid) {
        const body = {
            bu_no: this.bu,
            period: this.month,
            depart_name: document.getElementById('he_dep').value.trim(),
            plan_headcount: Number(document.getElementById('he_plan').value) || 0,
            plan_labor_cost: Number(document.getElementById('he_cost').value) || 0,
            note: document.getElementById('he_note').value.trim()
        };
        const actualRaw = document.getElementById('he_actual').value;
        body.actual_headcount = actualRaw === '' ? null : Number(actualRaw);
        if (!body.depart_name) return UI.toast(HE_L('请填写部门名称', '請填寫部門名稱', 'Department name is required'), 'error');
        try {
            const res = uid
                ? await API.put(`/api/hr-efficiency/headcount-plans/${uid}`, body)
                : await API.post('/api/hr-efficiency/headcount-plans', body);
            UI.toast(res.message || 'OK', 'success');
            UI.closeModal();
            this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    async delPlan(uid) {
        if (!confirm(HE_L('确认删除该部门编制？', '確認刪除該部門編制？', 'Delete this department plan?'))) return;
        try {
            const res = await API.del(`/api/hr-efficiency/headcount-plans/${uid}`);
            UI.toast(res.message || 'OK', 'success');
            this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    },

    openCopy() {
        const target = this.month || new Date().toISOString().slice(0, 7);
        const from = hrShiftMonth(target, -1);
        UI.modal(HE_L('复制上月编制', '複製上月編制', 'Copy Last Month Plan'), `
            <div class="form-grid">
                <div><label>${HE_L('来源月份', '來源月份', 'From Month')}</label><input type="month" id="he_from" class="form-input" value="${hrEsc(from)}"></div>
                <div><label>${HE_L('目标月份', '目標月份', 'To Month')}</label><input type="month" id="he_to" class="form-input" value="${hrEsc(target)}"></div>
            </div>
            <p style="color:#7f8c8d;font-size:.85em;margin-top:10px;">${HE_L('仅复制目标月份尚不存在的部门，已有编制不会被覆盖。', '僅複製目標月份尚不存在的部門，已有編制不會被覆蓋。', 'Only departments not yet present in the target month are copied; existing plans are not overwritten.')}</p>
        `, `
            <button class="btn btn-ghost" onclick="UI.closeModal()">${HE_L('取消', '取消', 'Cancel')}</button>
            <button class="btn btn-primary" onclick="HrEff.doCopy()">${HE_L('开始复制', '開始複製', 'Start Copy')}</button>
        `);
    },

    async doCopy() {
        const body = {
            bu_no: this.bu,
            from_period: document.getElementById('he_from').value,
            to_period: document.getElementById('he_to').value
        };
        try {
            const res = await API.post('/api/hr-efficiency/headcount-plans/copy', body);
            UI.toast(res.message || 'OK', 'success');
            UI.closeModal();
            if (body.to_period !== this.month) {
                this.month = body.to_period;
                const mi = document.getElementById('heMonth');
                if (mi) mi.value = this.month;
            }
            this.load();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
};
