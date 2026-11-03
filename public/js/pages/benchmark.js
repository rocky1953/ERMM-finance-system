/**
 * 同业标杆维护页面
 *   - 行业 / 年份筛选
 *   - 内联编辑 P10 / P25 / Median / P75 / P90 / Note
 *   - 保存按钮
 */
registerPage('benchmark', async (c) => {
    c.innerHTML = `<div style="text-align:center;padding:40px;color:#999;">${t('loading')}</div>`;

    let meta = { industries: [], years: [] };
    let rows = [];
    let filterInd = '';
    let filterYear = '';

    // 加载 meta + rows
    async function load() {
        const [mRes, lRes] = await Promise.all([
            API.get('/api/benchmark/meta'),
            API.get(`/api/benchmark/list?industry=${encodeURIComponent(filterInd)}&year=${filterYear}`),
        ]);
        meta = mRes.data;
        rows = lRes.data;
        render();
    }

    // 保存一行
    async function saveRow(uid, data) {
        const r = await API.post('/api/benchmark/upsert', data);
        if (r.success) UI.toast('✅ OK', 'success'); else UI.toast('❌ ' + r.message, 'error');
    }

    function render() {
        const indOpts = ['', ...meta.industries].map(i =>
            `<option value="${i}" ${filterInd===i?'selected':''}>${i||'—'}</option>`
        ).join('');
        const yrOpts = ['', ...meta.years].map(y =>
            `<option value="${y}" ${String(filterYear)===String(y)?'selected':''}>${y||'—'}</option>`
        ).join('');

        const tableHtml = rows.map(r => `
            <tr data-uid="${r.uid}">
                <td><code style="font-size:12px;">${r.kpi_id}</code></td>
                <td>${r.industry}</td>
                <td>${r.year}</td>
                ${['p10','p25','median','p75','p90'].map(k => `
                    <td><input data-k="${k}" type="number" step="0.001" value="${r[k] ?? ''}"
                               style="width:80px;padding:4px;border:1px solid #ddd;border-radius:4px;"></td>
                `).join('')}
                <td><input data-k="note" value="${r.note ?? ''}"
                           style="width:160px;padding:4px;border:1px solid #ddd;border-radius:4px;"></td>
                <td><button class="btn btn-primary" style="padding:4px 10px;font-size:12px;"
                            onclick="saveBenchRow(this)">💾</button></td>
            </tr>
        `).join('');

        c.innerHTML = `
            <div class="card" style="margin-bottom:16px;">
                <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;">
                    <h2 style="margin:0;font-size:20px;">📊 ${t('benchmark.title') || '同业标杆维护'}</h2>
                    <div style="flex:1;min-width:200px;"></div>
                    <label>${t('benchmark.industry') || '行业'}：
                        <select id="bmInd" style="padding:6px;border:1px solid #ddd;border-radius:6px;">${indOpts}</select>
                    </label>
                    <label>${t('benchmark.year') || '年份'}：
                        <select id="bmYear" style="padding:6px;border:1px solid #ddd;border-radius:6px;">${yrOpts}</select>
                    </label>
                    <button class="btn btn-success" onclick="benchQuery()">🔍 ${t('benchmark.query') || '查询'}</button>
                    <button class="btn" onclick="benchAddNew()">➕ ${t('benchmark.addNew') || '新增'}</button>
                </div>
            </div>

            <div class="card">
                <table class="data-table" style="width:100%;border-collapse:collapse;">
                    <thead>
                        <tr style="background:#f8f9fa;">
                            <th style="padding:10px;text-align:left;">KPI ID</th>
                            <th style="padding:10px;text-align:left;">${t('benchmark.industry') || '行业'}</th>
                            <th style="padding:10px;text-align:left;">${t('benchmark.year') || '年份'}</th>
                            <th style="padding:10px;text-align:center;">P10</th>
                            <th style="padding:10px;text-align:center;">P25</th>
                            <th style="padding:10px;text-align:center;">Median</th>
                            <th style="padding:10px;text-align:center;">P75</th>
                            <th style="padding:10px;text-align:center;">P90</th>
                            <th style="padding:10px;text-align:left;">${t('benchmark.note') || '备注'}</th>
                            <th style="padding:10px;"></th>
                        </tr>
                    </thead>
                    <tbody>${tableHtml || `<tr><td colspan="10" style="padding:30px;text-align:center;color:#999;">${t('benchmark.empty') || '暂无数据'}</td></tr>`}</tbody>
                </table>
            </div>
        `;

        // 绑定筛选
        document.getElementById('bmInd').onchange = e => { filterInd = e.target.value; };
        document.getElementById('bmYear').onchange = e => { filterYear = e.target.value; };
    }

    window.benchQuery = async function() {
        filterInd = document.getElementById('bmInd').value;
        filterYear = document.getElementById('bmYear').value;
        await load();
    };

    window.saveBenchRow = async function(btn) {
        const tr = btn.closest('tr');
        const uid = Number(tr.dataset.uid);
        const inputs = tr.querySelectorAll('input[data-k]');
        const data = { uid };
        // 从当前 row 对象补 KPI ID / industry / year
        const orig = rows.find(r => r.uid === uid);
        if (orig) { data.kpi_id = orig.kpi_id; data.industry = orig.industry; data.year = orig.year; }
        inputs.forEach(inp => {
            const v = inp.value.trim();
            const k = inp.dataset.k;
            if (k === 'note') data.note = v || null;
            else data[k] = v === '' ? null : Number(v);
        });
        await saveRow(uid, data);
    };

    window.benchAddNew = async function() {
        const kpi_id = prompt(t('benchmark.prompt_kpi') || '请输入 KPI ID（如 roe）');
        if (!kpi_id) return;
        const industry = prompt(t('benchmark.prompt_industry') || '行业（制造业 / 批发零售业）') || '制造业';
        const year = prompt(t('benchmark.prompt_year') || '年份', new Date().getFullYear()) || new Date().getFullYear();
        await saveRow(0, { kpi_id, industry, year, p10:null, p25:null, median:null, p75:null, p90:null, note:'新增' });
        await load();
    };

    await load();
});
