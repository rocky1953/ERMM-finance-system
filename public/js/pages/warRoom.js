/**
 * 戰情聯動看板
 * PO → SO → DN → 回款 漏斗 + 跨 BU 即時卡片
 */
const WarRoom = {
    async load() {
        const bu = document.getElementById('wrBu').value;
        const ym = document.getElementById('wrMonth').value;
        const url = `/api/war-room/overview?bu_no=${bu}${ym ? '&YYYY_MM=' + ym : ''}`;
        const res = await API.get(url);
        return res.data;
    },

    fmt(n) {
        const v = Number(n || 0);
        const lang = I18N.lang;
        if (lang === 'en') {
            if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(2) + 'B';
            if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
            if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K';
            return v.toLocaleString('en-US');
        }
        // zh-CN / zh-TW
        if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2) + ' 億';
        if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(1) + ' 萬';
        return v.toLocaleString();
    },

    stageLabel(s) {
        const lang = I18N.lang;
        if (lang === 'en') return s.label_en;
        if (lang === 'zh-CN') return s.label_cn;
        return s.label_tw;
    },

    render(d) {
        const box = document.getElementById('wrBody');
        if (!d || (!d.funnel && !d.cross_bu)) {
            box.innerHTML = `<div class="card"><p style="color:#999;">${t('warRoom.no_data')}</p></div>`;
            return;
        }

        // ===== 漏斗 =====
        const funnel = (d.funnel || []).map((s, i) => {
            const max = Math.max(...d.funnel.map(f => f.value || 0), 1);
            const pct = Math.max(4, (s.value / max) * 100);
            const colors = ['#3498db', '#2ecc71', '#f39c12', '#e74c3c'];
            return `
                <div style="margin-bottom:14px;">
                    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
                        <b>${this.stageLabel(s)}</b>
                        <span>${this.fmt(s.value)}${I18N.lang === 'en' ? '' : ' 元'}${s.qty ? (I18N.lang === 'en' ? ' (' + this.fmt(s.qty) + ' pcs)' : '（' + this.fmt(s.qty) + ' 件）') : ''}</span>
                    </div>
                    <div style="background:#eee;border-radius:6px;overflow:hidden;">
                        <div style="width:${pct}%;background:${colors[i]};height:28px;border-radius:6px;display:flex;align-items:center;justify-content:flex-end;padding-right:10px;color:#fff;font-size:12px;font-weight:600;transition:width .4s;">
                            ${s.value > 0 ? '' : ''}
                        </div>
                    </div>
                </div>`;
        }).join('');

        // ===== 指標卡片 =====
        const m = d.metrics || {};
        const cards = [
            { k: 'warRoom.po_cnt', v: m.po_cnt, unit: '', color: '#3498db' },
            { k: 'warRoom.so_cnt', v: m.so_cnt, unit: '', color: '#2ecc71' },
            { k: 'warRoom.dn_cnt', v: m.dn_cnt, unit: '', color: '#f39c12' },
            { k: 'warRoom.fulfill_rate', v: m.fulfill_rate, unit: '%', color: '#9b59b6' },
            { k: 'warRoom.on_time_rate', v: m.on_time_rate, unit: '%', color: '#1abc9c' },
            { k: 'warRoom.cash', v: m.cash, unit: 'amt', color: '#27ae60' },
            { k: 'warRoom.inventory', v: m.inventory, unit: 'amt', color: '#e67e22' },
            { k: 'warRoom.ar', v: m.ar, unit: 'amt', color: '#e74c3c' },
            { k: 'warRoom.ap', v: m.ap, unit: 'amt', color: '#34495e' }
        ];
        const cardsHtml = cards.map(c => `
            <div class="card" style="padding:14px;margin:0;">
                <div style="font-size:12px;color:#7f8c8d;">${t(c.k)}</div>
                <div style="font-size:22px;font-weight:700;color:${c.color};margin-top:4px;">
                    ${c.unit === 'amt' ? this.fmt(c.v) : (c.unit === '%' ? Number(c.v).toFixed(1) + '%' : c.v)}
                </div>
            </div>
        `).join('');

        // ===== 跨 BU 表格 =====
        const cross = d.cross_bu || [];
        const crossHtml = cross.length ? `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>${t('warRoom.col_bu')}</th>
                        <th>${t('warRoom.col_po')}</th>
                        <th>${t('warRoom.col_so')}</th>
                        <th>${t('warRoom.col_sale')}</th>
                        <th>${t('warRoom.col_cash')}</th>
                        <th>${t('warRoom.col_ar')}</th>
                        <th>${t('warRoom.col_ap')}</th>
                        <th>${t('warRoom.col_inv')}</th>
                        <th>${t('warRoom.col_loan')}</th>
                    </tr>
                </thead>
                <tbody>
                    ${cross.map(r => `
                        <tr>
                            <td><b>${r.bu_no}</b></td>
                            <td>${this.fmt(r.po_amt)}</td>
                            <td>${this.fmt(r.so_amt)}</td>
                            <td>${this.fmt(r.sale_amt)}</td>
                            <td style="color:#27ae60;font-weight:600;">${this.fmt(r.cash)}</td>
                            <td style="color:#e74c3c;">${this.fmt(r.ar)}</td>
                            <td>${this.fmt(r.ap)}</td>
                            <td>${this.fmt(r.inventory)}</td>
                            <td>${this.fmt(r.loan)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        ` : `<div style="color:#999;">${t('warRoom.no_data')}</div>`;

        box.innerHTML = `
            <div class="card" style="margin-bottom:16px;">
                <div class="card-title">${t('warRoom.funnel')} <small style="color:#7f8c8d;font-weight:normal;">${d.YYYY_MM || ''}</small></div>
                ${funnel}
            </div>
            <div class="card" style="margin-bottom:16px;">
                <div class="card-title">${t('warRoom.metrics')}</div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;">
                    ${cardsHtml}
                </div>
            </div>
            <div class="card">
                <div class="card-title">${t('warRoom.cross_bu')}</div>
                ${crossHtml}
            </div>
        `;
    }
};

registerPage('warRoom', async (c) => {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
            <h2 style="margin:0;font-size:20px;">${t('warRoom.title')} <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">${t('warRoom.subtitle')}</small></h2>
            <div>
                <select id="wrBu" style="padding:7px;border:1px solid #ddd;border-radius:6px;">
                    <option value="HM">HM</option>
                    <option value="SZ">SZ</option>
                    <option value="HN">HN</option>
                </select>
                <input type="month" id="wrMonth" style="padding:7px;border:1px solid #ddd;border-radius:6px;margin-left:6px;">
                <button class="btn btn-primary" onclick="WarRoom.refresh()" style="margin-left:6px;">🔄 ${t('refresh')}</button>
            </div>
        </div>
        <div id="wrBody"><div style="text-align:center;padding:40px;color:#999;">${t('loading')}</div></div>
    `;
    document.getElementById('wrBu').value = State.bu_no;
    document.getElementById('wrMonth').value = State.YYYY_MM;
    WarRoom.refresh();
});

WarRoom.refresh = async function () {
    State.bu_no = document.getElementById('wrBu').value;
    const box = document.getElementById('wrBody');
    box.innerHTML = `<div style="text-align:center;padding:40px;color:#999;">${t('loading')}</div>`;
    try {
        const d = await WarRoom.load();
        WarRoom.render(d);
    } catch (e) {
        box.innerHTML = `<div class="card"><p style="color:#e74c3c">❌ ${t('load_failed')}: ${e.message}</p></div>`;
    }
};
