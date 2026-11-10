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

        // ===== 漏斗（點擊 bar 顯示該階段明細） =====
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
                    <div style="background:#eee;border-radius:6px;overflow:hidden;cursor:pointer;" title="${t('warRoom.click_detail') || '點擊查看明細'}" onclick="WarRoom.openFunnel('${s.stage}')">
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

// ===== 漏斗明細鑽取彈窗 =====
WarRoom._funnelMeta = {
    PO: {
        title: () => t('warRoom.funnel_po') || '採購金額',
        cols: [
            { k: 'po_id', label: '采购单号' },
            { k: 'supplier_name', label: '供应商', wide: true },
            { k: 'xitems', label: '品项' },
            { k: 'po_qty', label: '数量', num: true, qty: true },
            { k: 'unit_price_local', label: '单价', num: true, money: true },
            { k: 'po_amount_local', label: '金额', num: true, money: true, sum: true },
            { k: 'po_date', label: '日期' },
            { k: 'po_status', label: '状态' }
        ]
    },
    SO: {
        title: () => t('warRoom.funnel_so') || '銷售訂單',
        cols: [
            { k: 'so_nbr', label: '订单号' },
            { k: 'client_id', label: '客户', wide: true },
            { k: 'xitems', label: '品项' },
            { k: 'so_qty', label: '数量', num: true, qty: true },
            { k: 'unit_price', label: '单价', num: true, money: true },
            { k: 'amt', label: '金额', num: true, money: true, sum: true }
        ]
    },
    DN: {
        title: () => t('warRoom.funnel_dn') || '交貨出庫',
        cols: [
            { k: 'DN_date', label: '出货日期' },
            { k: 'so_nbr', label: '订单号' },
            { k: 'client_name', label: '客户', wide: true },
            { k: 'xitems', label: '品项' },
            { k: 'DN_qty', label: '出库数量', num: true, qty: true, sum: true },
            { k: 'so_qty', label: '订单数量', num: true, qty: true },
            { k: 'est_amt', label: '推估金额', num: true, money: true, sum: true }
        ]
    },
    AR: {
        title: () => t('warRoom.funnel_ar') || '應收(回款)',
        cols: [
            { k: 'invoice_no', label: '发票号' },
            { k: 'order_id', label: '订单号' },
            { k: 'client_id', label: '客户', wide: true },
            { k: 'sub_amt', label: '发票金额', num: true, money: true, sum: true },
            { k: 'payment', label: '已收款', num: true, money: true, sum: true },
            { k: 'wk_date', label: '开票日期' },
            { k: 'ageing_days', label: '账龄(天)', num: true }
        ]
    }
};

WarRoom.ensureFunnelModal = function () {
    if (!document.getElementById('wrFunnelStyle')) {
        const st = document.createElement('style');
        st.id = 'wrFunnelStyle';
        st.textContent = `
.wr-funnel-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;z-index:9999;align-items:center;justify-content:center;}
.wr-funnel-overlay.show{display:flex;}
.wr-funnel-card{background:#fff;border-radius:12px;width:90%;max-width:960px;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.25);overflow:hidden;}
.wr-funnel-header{display:flex;justify-content:space-between;align-items:center;padding:14px 20px;background:linear-gradient(135deg,#2c3e50,#34495e);color:#fff;}
.wr-funnel-title{font-size:1.05em;font-weight:700;}
.wr-funnel-close{background:none;border:none;color:#fff;font-size:1.3em;cursor:pointer;padding:0 4px;line-height:1;}
.wr-funnel-close:hover{opacity:.7;}
.wr-funnel-sub{padding:8px 20px;background:#f8f9fa;color:#7f8c8d;font-size:.88em;border-bottom:1px solid #ecf0f1;}
.wr-funnel-body{padding:16px 20px;overflow-y:auto;flex:1;}
.wr-funnel-footer{padding:12px 20px;border-top:1px solid #eee;text-align:right;background:#fafafa;}
.wr-funnel-table{width:100%;border-collapse:collapse;font-size:.9em;}
.wr-funnel-table th,.wr-funnel-table td{padding:8px 10px;border-bottom:1px solid #ecf0f1;}
.wr-funnel-table thead th{background:#f8f9fa;color:#2c3e50;font-weight:700;text-align:left;}
.wr-funnel-table th.num,.wr-funnel-table td.num{text-align:right;font-variant-numeric:tabular-nums;}
.wr-funnel-table tbody tr:hover{background:#f4f8fc;}
.wr-funnel-table tfoot td{font-weight:800;background:#eaf2f8;color:#1a5276;}`;
        document.head.appendChild(st);
    }
    let ov = document.getElementById('wrFunnelOverlay');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'wrFunnelOverlay';
    ov.className = 'wr-funnel-overlay';
    ov.innerHTML = `
        <div class="wr-funnel-card">
            <div class="wr-funnel-header">
                <span class="wr-funnel-title" id="wrFunnelTitle"></span>
                <button type="button" class="wr-funnel-close" data-close>✕</button>
            </div>
            <div class="wr-funnel-sub" id="wrFunnelSub"></div>
            <div class="wr-funnel-body" id="wrFunnelBody"></div>
            <div class="wr-funnel-footer">
                <button type="button" class="btn" data-close>${t('modal.close') || '關閉'}</button>
            </div>
        </div>`;
    document.body.appendChild(ov);
    const card = ov.firstElementChild;
    ov.addEventListener('click', (e) => { if (!card.contains(e.target)) ov.classList.remove('show'); });
    ov.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => ov.classList.remove('show')));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ov.classList.remove('show'); });
    return ov;
};

WarRoom.funnelNumFmt = function (v, kind) {
    const n = Number(v || 0);
    if (kind === 'money') return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (kind === 'qty') return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(1);
    return n.toLocaleString('en-US');
};

WarRoom.openFunnel = async function (stage) {
    const meta = this._funnelMeta[stage];
    if (!meta) return;
    const bu = document.getElementById('wrBu').value;
    const ym = document.getElementById('wrMonth').value;
    const ov = this.ensureFunnelModal();
    const body = ov.querySelector('#wrFunnelBody');
    ov.querySelector('#wrFunnelTitle').textContent = `📋 ${meta.title()} 明細`;
    ov.querySelector('#wrFunnelSub').textContent = `${bu}  ·  ${ym || '全期間'}`;
    body.innerHTML = `<div style="text-align:center;padding:30px;color:#999;">${t('loading') || '載入中...'}</div>`;
    ov.classList.add('show');

    try {
        const res = await API.get(`/api/war-room/funnel-detail?bu_no=${bu}&YYYY_MM=${ym}&stage=${stage}`);
        const rows = res.data || [];
        if (rows.length === 0) {
            body.innerHTML = `<div style="text-align:center;padding:30px;color:#999;">${t('warRoom.no_data') || '暫無資料'}</div>`;
            return;
        }
        // 合計行（僅對標記 sum 的欄位）
        const sums = {};
        meta.cols.forEach(c => {
            if (c.sum) sums[c.k] = rows.reduce((s, r) => s + Number(r[c.k] || 0), 0);
        });
        body.innerHTML = `<div style="overflow-x:auto;"><table class="wr-funnel-table">
            <thead><tr>${meta.cols.map(c => `<th class="${c.num ? 'num' : ''}"${c.wide ? ' style="white-space:nowrap;min-width:110px;"' : ''}>${c.label}</th>`).join('')}</tr></thead>
            <tbody>${rows.map(r => `<tr>${meta.cols.map(c => {
                const v = r[c.k];
                const txt = (v === null || v === undefined || v === '') ? '-' : (c.num ? this.funnelNumFmt(v, c.money ? 'money' : 'qty') : String(v));
                return `<td class="${c.num ? 'num' : ''}"${c.wide ? ' style="white-space:nowrap;min-width:110px;"' : ''}>${txt}</td>`;
            }).join('')}</tr>`).join('')}</tbody>
            ${(() => {
                const firstSumIdx = meta.cols.findIndex(x => x.sum);
                if (firstSumIdx < 0) return '';
                return `<tfoot><tr>${meta.cols.map((c, i) => {
                    if (i === 0) return `<td colspan="${firstSumIdx || 1}"><b>合計（${rows.length} 筆）</b></td>`;
                    if (c.sum) return `<td class="num"><b>${this.funnelNumFmt(sums[c.k], c.money ? 'money' : 'qty')}</b></td>`;
                    return `<td></td>`;
                }).join('')}</tr></tfoot>`;
            })()}
        </table></div>`;

        // CSV 匯出按鈕
        let btn = ov.querySelector('.wr-funnel-export');
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-primary wr-funnel-export';
            ov.querySelector('.wr-funnel-footer').prepend(btn);
        }
        btn.textContent = `📥 ${t('export') || '匯出'}`;
        btn.onclick = () => WarRoom.exportFunnelCSV(meta, rows, `${stage}_${bu}_${ym || 'all'}`);
    } catch (e) {
        body.innerHTML = `<p style="color:#e74c3c">❌ ${e.message}</p>`;
    }
};

WarRoom.exportFunnelCSV = function (meta, rows, filename) {
    const esc = (s) => {
        let text = String(s === null || s === undefined ? '' : s);
        if (/^-?[0-9,]+(\.\d+)?$/.test(text)) text = text.replace(/,/g, '');
        if (/[",\n]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
        return text;
    };
    const lines = [meta.cols.map(c => c.label).join(',')];
    rows.forEach(r => lines.push(meta.cols.map(c => esc(r[c.k])).join(',')));
    // 合計
    const sums = meta.cols.filter(c => c.sum);
    if (sums.length) {
        lines.push(meta.cols.map(c => c === sums[0] ? '合計' : (c.sum ? esc(rows.reduce((s, r) => s + Number(r[c.k] || 0), 0)) : '')).join(','));
    }
    const csv = '\ufeff' + lines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.csv') ? filename : filename + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
};
