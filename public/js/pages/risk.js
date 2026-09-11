/**
 * 風險預警模型頁面
 */
registerPage('risk', async (c) => {
    c.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <button class="btn btn-warning" onclick="calcRisk()">⚠️ ${t('risk.calc')}</button>
                <button class="btn btn-success" onclick="loadRisk()">🔄 ${t('refresh')}</button>
                <span style="color:#7f8c8d;font-size:0.85em;margin-left:8px">💡 ${t('risk.click_hint')}</span>
            </div>
            <div id="riskContent">${t('loading')}</div>
        </div>
    `;
    loadRisk();
});

let _riskData = null;

async function loadRisk() {
    const el = document.getElementById('riskContent');
    try {
        const res = await API.get(`/api/risk?bu_no=${State.bu_no}&YYYY_MM=${State.YYYY_MM}`);
        const rows = res.data || [];
        if (rows.length === 0) { el.innerHTML = UI.empty('⚠️', t('risk.no_data')); return; }
        const r = rows[0];
        _riskData = r;
        const zVal = Number(r.Z_score || 0);
        // 從 Z 值重算顏色與狀態，不依賴 DB 可能過時的 risk_color / wall_mode
        const zColor = zVal >= 2.9 ? 'green' : (zVal >= 1.23 ? 'yellow' : 'red');
        const zWallMode = zVal >= 2.9 ? t('dash.safe') : (zVal >= 1.23 ? t('dash.grey') : t('dash.bankrupt'));
        // Z2-Score: >=2.9 安全, >=1.23 灰色, <1.23 破產區
        const z2 = Number(r.Z2_score || 0);
        const z2Color = z2 >= 2.9 ? 'green' : (z2 >= 1.23 ? 'yellow' : 'red');
        const z2Mode = z2 >= 2.9 ? t('dash.safe') : (z2 >= 1.23 ? t('dash.grey') : t('dash.bankrupt'));
        // Z3-Score: >=2.6 安全, >=1.1 灰色, <1.1 破產區
        const z3 = Number(r.Z3_score || 0);
        const z3Color = z3 >= 2.6 ? 'green' : (z3 >= 1.1 ? 'yellow' : 'red');
        const z3Mode = z3 >= 2.6 ? t('dash.safe') : (z3 >= 1.1 ? t('dash.grey') : t('dash.bankrupt'));
        // BZ: >=0 安全, <0 破產區
        const bz = Number(r.BZ_model || 0);
        const bzColor = bz >= 0 ? 'green' : 'red';
        const bzMode = bz >= 0 ? t('dash.safe') : t('dash.bankrupt');
        // JZ: >=0 安全, <0 破產區
        const jz = Number(r.JZ_model || 0);
        const jzColor = jz >= 0 ? 'green' : 'red';
        const jzMode = jz >= 0 ? t('dash.safe') : t('dash.bankrupt');
        // 流動比率: >=1.5 安全, >=1 灰色, <1 破產區
        const cr = Number(r.current_ratio || 0);
        const crColor = cr >= 1.5 ? 'green' : (cr >= 1 ? 'yellow' : 'red');
        const crMode = cr >= 1.5 ? t('dash.safe') : (cr >= 1 ? t('dash.grey') : t('dash.bankrupt'));
        // 負債比: <=50 安全, <=70 灰色, >70 破產區
        const dr = Number(r.debt_ratio || 0);
        const drColor = dr <= 50 ? 'green' : (dr <= 70 ? 'yellow' : 'red');
        const drMode = dr <= 50 ? t('dash.safe') : (dr <= 70 ? t('dash.grey') : t('dash.bankrupt'));
        // ROE: >=0 安全, <0 破產區
        const roe = Number(r.ROE || 0);
        const roeColor = roe >= 0 ? 'green' : 'red';
        const roeMode = roe >= 0 ? t('dash.safe') : t('dash.bankrupt');
        el.innerHTML = `
            <div class="kpi-grid">
                <div class="kpi-card ${zColor}" style="cursor:pointer" onclick="RiskHelp.open('z')">
                    <div class="kpi-label">${t('risk.z_score')}</div>
                    <div class="kpi-value">${UI.fmt(zVal, 4)}</div>
                    <div class="kpi-badge ${zColor}">${zWallMode}</div>
                    <div class="kpi-sub">${t('risk.threshold')}</div>
                </div>
                <div class="kpi-card ${z2Color}" style="cursor:pointer" onclick="RiskHelp.open('z2')">
                    <div class="kpi-label">${t('risk.z2')}</div>
                    <div class="kpi-value">${UI.fmt(r.Z2_score, 4)}</div>
                    <div class="kpi-badge ${z2Color}">${z2Mode}</div>
                </div>
                <div class="kpi-card ${z3Color}" style="cursor:pointer" onclick="RiskHelp.open('z3')">
                    <div class="kpi-label">${t('risk.z3')}</div>
                    <div class="kpi-value">${UI.fmt(r.Z3_score, 4)}</div>
                    <div class="kpi-badge ${z3Color}">${z3Mode}</div>
                </div>
                <div class="kpi-card ${bzColor}" style="cursor:pointer" onclick="RiskHelp.open('bz')">
                    <div class="kpi-label">${t('risk.bz')}</div>
                    <div class="kpi-value">${UI.fmt(r.BZ_model, 4)}</div>
                    <div class="kpi-badge ${bzColor}">${bzMode}</div>
                </div>
                <div class="kpi-card ${jzColor}" style="cursor:pointer" onclick="RiskHelp.open('jz')">
                    <div class="kpi-label">${t('risk.jz')}</div>
                    <div class="kpi-value">${UI.fmt(r.JZ_model, 4)}</div>
                    <div class="kpi-badge ${jzColor}">${jzMode}</div>
                </div>
                <div class="kpi-card ${crColor}" style="cursor:pointer" onclick="RiskHelp.open('cr')">
                    <div class="kpi-label">${t('risk.current_ratio')}</div>
                    <div class="kpi-value">${UI.fmt(r.current_ratio, 4)}</div>
                    <div class="kpi-badge ${crColor}">${crMode}</div>
                    <div class="kpi-sub">${t('risk.quick_ratio')} ${UI.fmt(r.quick_ratio, 4)}</div>
                </div>
                <div class="kpi-card ${drColor}" style="cursor:pointer" onclick="RiskHelp.open('dr')">
                    <div class="kpi-label">${t('risk.debt_ratio')}</div>
                    <div class="kpi-value">${UI.fmt(r.debt_ratio, 1)}%</div>
                    <div class="kpi-badge ${drColor}">${drMode}</div>
                </div>
                <div class="kpi-card ${roeColor}" style="cursor:pointer" onclick="RiskHelp.open('roe')">
                    <div class="kpi-label">${t('risk.roe')}</div>
                    <div class="kpi-value">${UI.fmt(r.ROE, 2)}%</div>
                    <div class="kpi-badge ${roeColor}">${roeMode}</div>
                    <div class="kpi-sub">${t('risk.roa')} ${UI.fmt(r.ROA, 2)}%</div>
                </div>
            </div>
        `;
    } catch(e) { el.innerHTML = `<p style="color:#e74c3c">${e.message}</p>`; }
}

// ===== 風險指標說明彈窗 =====
const RiskHelp = {
    open(key) {
        const r = _riskData || {};
        const v = (k) => Number(r[k] || 0);
        const cfg = {
            z: {
                title: t('risk.z_score'),
                color: v('Z_score') >= 2.9 ? 'green' : (v('Z_score') >= 1.23 ? 'yellow' : 'red'),
                value: UI.fmt(v('Z_score'), 4),
                status: v('Z_score') >= 2.9 ? t('dash.safe') : (v('Z_score') >= 1.23 ? t('dash.grey') : t('dash.bankrupt')),
                purpose: t('risk.desc.z.purpose'),
                formula: 'Z = 1.2·X1 + 1.4·X2 + 3.3·X3 + 0.6·X4 + 0.999·X5',
                vars: [
                    { name: 'X1', desc: t('risk.desc.z.x1'), val: UI.fmt(v('Z_X1'), 4) },
                    { name: 'X2', desc: t('risk.desc.z.x2'), val: UI.fmt(v('Z_X2'), 4) },
                    { name: 'X3', desc: t('risk.desc.z.x3'), val: UI.fmt(v('Z_X3'), 4) },
                    { name: 'X4', desc: t('risk.desc.z.x4'), val: UI.fmt(v('Z_X4'), 4) },
                    { name: 'X5', desc: t('risk.desc.z.x5'), val: UI.fmt(v('Z_X5'), 4) },
                ],
                zones: [
                    { range: 'Z ≥ 2.9', label: t('dash.safe'), color: 'green' },
                    { range: '1.23 ≤ Z < 2.9', label: t('dash.grey'), color: 'yellow' },
                    { range: 'Z < 1.23', label: t('dash.bankrupt'), color: 'red' },
                ]
            },
            z2: {
                title: t('risk.z2'),
                color: v('Z2_score') >= 2.9 ? 'green' : (v('Z2_score') >= 1.23 ? 'yellow' : 'red'),
                value: UI.fmt(v('Z2_score'), 4),
                status: v('Z2_score') >= 2.9 ? t('dash.safe') : (v('Z2_score') >= 1.23 ? t('dash.grey') : t('dash.bankrupt')),
                purpose: t('risk.desc.z2.purpose'),
                formula: 'Z2 = 0.717·X1 + 0.847·X2 + 3.107·X3 + 0.420·X4 + 0.998·X5',
                vars: [
                    { name: 'X1', desc: t('risk.desc.z.x1'), val: UI.fmt(v('Z_X1'), 4) },
                    { name: 'X2', desc: t('risk.desc.z.x2'), val: UI.fmt(v('Z_X2'), 4) },
                    { name: 'X3', desc: t('risk.desc.z.x3'), val: UI.fmt(v('Z_X3'), 4) },
                    { name: 'X4', desc: t('risk.desc.z.x4'), val: UI.fmt(v('Z_X4'), 4) },
                    { name: 'X5', desc: t('risk.desc.z.x5'), val: UI.fmt(v('Z_X5'), 4) },
                ],
                zones: [
                    { range: 'Z2 ≥ 2.9', label: t('dash.safe'), color: 'green' },
                    { range: '1.23 ≤ Z2 < 2.9', label: t('dash.grey'), color: 'yellow' },
                    { range: 'Z2 < 1.23', label: t('dash.bankrupt'), color: 'red' },
                ]
            },
            z3: {
                title: t('risk.z3'),
                color: v('Z3_score') >= 2.6 ? 'green' : (v('Z3_score') >= 1.1 ? 'yellow' : 'red'),
                value: UI.fmt(v('Z3_score'), 4),
                status: v('Z3_score') >= 2.6 ? t('dash.safe') : (v('Z3_score') >= 1.1 ? t('dash.grey') : t('dash.bankrupt')),
                purpose: t('risk.desc.z3.purpose'),
                formula: 'Z3 = 6.56·X1 + 3.26·X2 + 6.72·X3 + 1.05·X4',
                vars: [
                    { name: 'X1', desc: t('risk.desc.z.x1'), val: UI.fmt(v('Z_X1'), 4) },
                    { name: 'X2', desc: t('risk.desc.z.x2'), val: UI.fmt(v('Z_X2'), 4) },
                    { name: 'X3', desc: t('risk.desc.z.x3'), val: UI.fmt(v('Z_X3'), 4) },
                    { name: 'X4', desc: t('risk.desc.z.x4'), val: UI.fmt(v('Z_X4'), 4) },
                ],
                zones: [
                    { range: 'Z3 ≥ 2.6', label: t('dash.safe'), color: 'green' },
                    { range: '1.1 ≤ Z3 < 2.6', label: t('dash.grey'), color: 'yellow' },
                    { range: 'Z3 < 1.1', label: t('dash.bankrupt'), color: 'red' },
                ]
            },
            bz: {
                title: t('risk.bz'),
                color: v('BZ_model') >= 0 ? 'green' : 'red',
                value: UI.fmt(v('BZ_model'), 4),
                status: v('BZ_model') >= 0 ? t('dash.safe') : t('dash.bankrupt'),
                purpose: t('risk.desc.bz.purpose'),
                formula: 'BZ = X1 + X2 + X3 + X4 + X5',
                vars: [
                    { name: 'X1', desc: t('risk.desc.z.x1'), val: UI.fmt(v('BZ_X1') || v('Z_X1'), 4) },
                    { name: 'X2', desc: t('risk.desc.z.x2'), val: UI.fmt(v('BZ_X2') || v('Z_X2'), 4) },
                    { name: 'X3', desc: t('risk.desc.z.x3'), val: UI.fmt(v('BZ_X3') || v('Z_X3'), 4) },
                    { name: 'X4', desc: t('risk.desc.z.x4'), val: UI.fmt(v('BZ_X4') || v('Z_X4'), 4) },
                    { name: 'X5', desc: t('risk.desc.z.x5'), val: UI.fmt(v('BZ_X5') || v('Z_X5'), 4) },
                ],
                zones: [
                    { range: 'BZ ≥ 0', label: t('dash.safe'), color: 'green' },
                    { range: 'BZ < 0', label: t('dash.bankrupt'), color: 'red' },
                ]
            },
            jz: {
                title: t('risk.jz'),
                color: v('JZ_model') >= 0 ? 'green' : 'red',
                value: UI.fmt(v('JZ_model'), 4),
                status: v('JZ_model') >= 0 ? t('dash.safe') : t('dash.bankrupt'),
                purpose: t('risk.desc.jz.purpose'),
                formula: 'JZ = ZA + ZB − ZC − ZD',
                vars: [
                    { name: 'ZA', desc: t('risk.desc.jz.za'), val: UI.fmt(v('JZ_ZA'), 4) },
                    { name: 'ZB', desc: t('risk.desc.jz.zb'), val: UI.fmt(v('JZ_ZB'), 4) },
                    { name: 'ZC', desc: t('risk.desc.jz.zc'), val: UI.fmt(v('JZ_ZC'), 4) },
                    { name: 'ZD', desc: t('risk.desc.jz.zd'), val: UI.fmt(v('JZ_ZD'), 4) },
                ],
                zones: [
                    { range: 'JZ ≥ 0', label: t('dash.safe'), color: 'green' },
                    { range: 'JZ < 0', label: t('dash.bankrupt'), color: 'red' },
                ]
            },
            cr: {
                title: t('risk.current_ratio'),
                color: v('current_ratio') >= 1.5 ? 'green' : (v('current_ratio') >= 1 ? 'yellow' : 'red'),
                value: UI.fmt(v('current_ratio'), 4),
                status: v('current_ratio') >= 1.5 ? t('dash.safe') : (v('current_ratio') >= 1 ? t('dash.grey') : t('dash.bankrupt')),
                purpose: t('risk.desc.cr.purpose'),
                formula: t('risk.desc.cr.formula'),
                extra: `<div style="margin-top:8px">${t('risk.quick_ratio')}: <strong>${UI.fmt(v('quick_ratio'), 4)}</strong></div>`,
                zones: [
                    { range: '≥ 1.5', label: t('dash.safe'), color: 'green' },
                    { range: '1.0 ~ 1.5', label: t('dash.grey'), color: 'yellow' },
                    { range: '< 1.0', label: t('dash.bankrupt'), color: 'red' },
                ]
            },
            dr: {
                title: t('risk.debt_ratio'),
                color: v('debt_ratio') <= 50 ? 'green' : (v('debt_ratio') <= 70 ? 'yellow' : 'red'),
                value: UI.fmt(v('debt_ratio'), 1) + '%',
                status: v('debt_ratio') <= 50 ? t('dash.safe') : (v('debt_ratio') <= 70 ? t('dash.grey') : t('dash.bankrupt')),
                purpose: t('risk.desc.dr.purpose'),
                formula: t('risk.desc.dr.formula'),
                zones: [
                    { range: '≤ 50%', label: t('dash.safe'), color: 'green' },
                    { range: '50% ~ 70%', label: t('dash.grey'), color: 'yellow' },
                    { range: '> 70%', label: t('dash.bankrupt'), color: 'red' },
                ]
            },
            roe: {
                title: t('risk.roe'),
                color: v('ROE') >= 0 ? 'green' : 'red',
                value: UI.fmt(v('ROE'), 2) + '%',
                status: v('ROE') >= 0 ? t('dash.safe') : t('dash.bankrupt'),
                purpose: t('risk.desc.roe.purpose'),
                formula: t('risk.desc.roe.formula'),
                extra: `<div style="margin-top:8px">${t('risk.roa')}: <strong>${UI.fmt(v('ROA'), 2)}%</strong></div>`,
                zones: [
                    { range: '≥ 0%', label: t('dash.safe'), color: 'green' },
                    { range: '< 0%', label: t('dash.bankrupt'), color: 'red' },
                ]
            },
        };
        const m = cfg[key];
        if (!m) return;

        const colorMap = { green: '#27ae60', yellow: '#f39c12', red: '#e74c3c' };
        const badgeColor = colorMap[m.color] || '#7f8c8d';

        const varsRows = (m.vars || []).map(v =>
            `<tr><td style="font-weight:bold;color:#2980b9">${v.name}</td><td>${v.desc}</td><td class="num">${v.val}</td></tr>`
        ).join('');

        const zonesRows = m.zones.map(z => {
            const isCur = (m.status === z.label);
            return `<tr style="${isCur ? 'background:' + colorMap[z.color] + '22;font-weight:bold' : ''}">
                <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${colorMap[z.color]};margin-right:6px"></span>${z.label}</td>
                <td class="num">${z.range}</td>
                ${isCur ? `<td style="color:${colorMap[z.color]}">← ${t('risk.desc.current')}</td>` : '<td></td>'}
            </tr>`;
        }).join('');

        const body = `
            <div style="line-height:1.8;font-size:14px">
                <div style="background:${badgeColor}15;padding:16px;border-radius:8px;margin-bottom:14px;border-left:4px solid ${badgeColor}">
                    <div style="font-size:2em;font-weight:bold;color:#2c3e50">${m.value}</div>
                    <span style="display:inline-block;margin-top:4px;padding:2px 12px;border-radius:12px;color:#fff;background:${badgeColor}">${m.status}</span>
                </div>
                <div style="margin-bottom:14px">
                    <strong>📋 ${t('risk.desc.purpose')}：</strong>${m.purpose}
                </div>
                <div style="background:#f8f9fa;padding:10px 14px;border-radius:6px;margin-bottom:14px">
                    <strong>🧮 ${t('risk.desc.formula')}：</strong><code style="background:#fff;padding:2px 6px;border-radius:4px">${m.formula}</code>
                </div>
                ${m.extra || ''}
                ${varsRows ? `
                <div style="margin-bottom:14px">
                    <strong>📊 ${t('risk.desc.variables')}：</strong>
                    <table class="data-table" style="margin-top:6px">
                        <thead><tr><th>變數</th><th>說明</th><th>${t('risk.desc.value')}</th></tr></thead>
                        <tbody>${varsRows}</tbody>
                    </table>
                </div>` : ''}
                <div>
                    <strong>🎯 ${t('risk.desc.zones')}：</strong>
                    <table class="data-table" style="margin-top:6px">
                        <thead><tr><th>${t('risk.desc.status')}</th><th>${t('risk.desc.range')}</th><th></th></tr></thead>
                        <tbody>${zonesRows}</tbody>
                    </table>
                </div>
            </div>`;
        const footer = `<button class="btn" onclick="UI.closeModal()">${t('modal.close')}</button>`;
        UI.modal(m.title, body, footer);
    }
};

async function calcRisk() {
    try {
        const res = await API.post('/api/risk/calc', { bu_no: State.bu_no, YYYY_MM: State.YYYY_MM });
        const d = res.data;
        UI.toast(`${t('risk.calc_done')}: Z=${d.Z_models.Z_score.value} (${d.risk_color})`, 'success');
        loadRisk();
    } catch(e) { UI.toast(e.message,'error'); }
}
