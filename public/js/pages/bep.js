/**
 * BEP 損益平衡分析頁面
 * 對應 routes/bep.js
 */
(() => {
    const fmt = v => {
        const n = Number(v);
        if (!isFinite(n)) return '0';
        return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    const fmtPct = v => (Number(v) || 0).toFixed(2) + '%';

    let BEP = null;

    function compute(sale_amt, vals) {
        const material = vals.consumable + vals.packaging + vals.processing
                       + vals.misc_purchase + vals.freight + vals.customs + vals.service_part_comp;
        const variable_cost = material + vals.variable_expense;
        const contribution_margin = sale_amt - variable_cost;
        const cm_rate = sale_amt > 0 ? (contribution_margin / sale_amt) * 100 : 0;
        const bep = cm_rate > 0 ? vals.fixed_cost / (cm_rate / 100) : 0;
        const gap = sale_amt - bep;
        return { material, variable_cost, contribution_margin, cm_rate, bep, gap };
    }

    function numVal(id) {
        const el = document.getElementById(id);
        return el ? (Number(el.value) || 0) : 0;
    }

    function getInputVals() {
        const fixed_salary   = numVal('bep_fixed_salary');
        const fixed_rent     = numVal('bep_fixed_rent');
        const fixed_interest = numVal('bep_fixed_interest');
        return {
            consumable:        numVal('bep_consumable'),
            packaging:         numVal('bep_packaging'),
            processing:        numVal('bep_processing'),
            misc_purchase:     numVal('bep_misc_purchase'),
            freight:           numVal('bep_freight'),
            customs:           numVal('bep_customs'),
            service_part_comp: numVal('bep_service_part_comp'),
            variable_expense:  numVal('bep_variable_expense'),
            fixed_salary,
            fixed_rent,
            fixed_interest,
            fixed_cost:        fixed_salary + fixed_rent + fixed_interest
        };
    }

    function showCalc(sale, vals) {
        const c = compute(sale, vals);
        document.getElementById('bep_material_show').textContent  = fmt(c.material);
        document.getElementById('bep_material_field').textContent  = fmt(c.material);
        document.getElementById('bep_varCost_show').textContent   = fmt(c.variable_cost);
        document.getElementById('bep_varCost_show2').textContent  = fmt(c.variable_cost);
        document.getElementById('bep_cm_show').textContent         = fmt(c.contribution_margin);
        document.getElementById('bep_cm_show2').textContent        = fmt(c.contribution_margin);
        document.getElementById('bep_cmRate_show').textContent    = fmtPct(c.cm_rate);
        document.getElementById('bep_cmRate_show2').textContent   = fmtPct(c.cm_rate);
        document.getElementById('bep_bep_show').textContent        = fmt(c.bep);
        document.getElementById('bep_sale_show2').textContent      = fmt(sale);
        const fxShow = document.getElementById('bep_fixed_cost_show');
        if (fxShow) fxShow.textContent = fmt(vals.fixed_cost);
        refreshFixedModalUI(sale, vals, c);

        const gapEl = document.getElementById('bep_gap_show');
        gapEl.textContent = fmt(c.gap);
        gapEl.style.color = c.gap >= 0 ? '#27ae60' : '#c0392b';
        const label = document.getElementById('bep_gap_label');
        const arrow = document.getElementById('bep_gap_arrow');
        if (label && arrow) {
            if (c.gap >= 0) {
                label.textContent = t('bep.gap.excess');
                label.style.color = '#27ae60';
                arrow.textContent = ' ' + t('bep.gap.reached');
                arrow.style.color = '#27ae60';
            } else {
                label.textContent = t('bep.gap.shortage');
                label.style.color = '#c0392b';
                arrow.textContent = ' ' + t('bep.gap.not_reached');
                arrow.style.color = '#c0392b';
            }
        }
    }

    function fillInputs(d) {
        document.getElementById('bep_consumable').value        = d.consumable || 0;
        document.getElementById('bep_packaging').value         = d.packaging || 0;
        document.getElementById('bep_processing').value        = d.processing || 0;
        document.getElementById('bep_misc_purchase').value     = d.misc_purchase || 0;
        document.getElementById('bep_freight').value           = d.freight || 0;
        document.getElementById('bep_customs').value           = d.customs || 0;
        document.getElementById('bep_service_part_comp').value = d.service_part_comp || 0;
        document.getElementById('bep_variable_expense').value  = d.variable_expense || 0;

        // 固定成本明細：舊資料僅有 fixed_cost 總額時，依 65/22/13 預設比例拆分
        let salary   = Number(d.fixed_salary)   || 0;
        let rent     = Number(d.fixed_rent)     || 0;
        let interest = Number(d.fixed_interest) || 0;
        const total  = Number(d.fixed_cost)     || 0;
        if (salary + rent + interest === 0 && total > 0) {
            rent     = Math.round(total * 0.22 * 100) / 100;
            interest = Math.round(total * 0.13 * 100) / 100;
            salary   = Math.round((total - rent - interest) * 100) / 100;
        }
        document.getElementById('bep_fixed_salary').value   = salary;
        document.getElementById('bep_fixed_rent').value     = rent;
        document.getElementById('bep_fixed_interest').value = interest;
    }

    async function load() {
        const bu = document.getElementById('bepBU').value || State.bu_no || 'HM';
        const ym = document.getElementById('bepYM').value;
        if (!ym) { UI.toast(t('bep.msg.need_ym'), 'warn'); return; }
        State.bu_no = bu;
        try {
            const r = await fetch('/api/bep/query?bu_no=' + bu + '&YYYY_MM=' + ym);
            const j = await r.json();
            if (!j.success) { UI.toast(j.message, 'error'); return; }
            BEP = j.data;
            fillInputs(BEP);
            const saleInput = document.getElementById('bep_sale_input');
            if (saleInput) saleInput.value = BEP.sale_amt || 0;
            showCalc(BEP.sale_amt, getInputVals());
        } catch (e) { UI.toast(t('bep.msg.load_fail') + ': ' + e.message, 'error'); }
    }

    async function save() {
        const bu = document.getElementById('bepBU').value || State.bu_no || 'HM';
        const ym = document.getElementById('bepYM').value;
        const v = getInputVals();
        const payload = {
            bu_no: bu, YYYY_MM: ym,
            consumable: v.consumable, packaging: v.packaging, processing: v.processing,
            misc_purchase: v.misc_purchase, freight: v.freight, customs: v.customs,
            service_part_comp: v.service_part_comp, variable_expense: v.variable_expense,
            fixed_salary: v.fixed_salary, fixed_rent: v.fixed_rent,
            fixed_interest: v.fixed_interest, fixed_cost: v.fixed_cost,
            remark: document.getElementById('bep_remark').value || null
        };
        try {
            const r = await fetch('/api/bep/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const j = await r.json();
            if (!j.success) { UI.toast(j.message, 'error'); return; }
            BEP = j.data;
            fillInputs(BEP);
            const saleInput = document.getElementById('bep_sale_input');
            if (saleInput) saleInput.value = BEP.sale_amt || 0;
            showCalc(BEP.sale_amt, getInputVals());
            UI.toast(t('bep.msg.saved'), 'success');
        } catch (e) { UI.toast(t('bep.msg.save_fail') + ': ' + e.message, 'error'); }
    }

    function liveCalc() {
        const saleEl = document.getElementById('bep_sale_input');
        const sale = saleEl ? Number(saleEl.value) || 0 : 0;
        showCalc(sale, getInputVals());
    }

    function getHTML() {
        const today = new Date();
        const defYM = today.getFullYear() + '/' + String(today.getMonth() + 1).padStart(2, '0');
        return '<div class="bep-wrap">'
            + '<div class="bep-toolbar">'
            + '<label>' + t('bep.toolbar.bu') + ':</label>'
            + '<select id="bepBU"><option value="HM">HM</option><option value="SZ">SZ</option><option value="HN">HN</option></select>'
            + '<label>' + t('bep.toolbar.ym') + ':</label>'
            + '<input type="text" id="bepYM" placeholder="YYYY/MM" value="' + defYM + '">'
            + '<button class="btn-refresh" onclick="bepLoad()">' + t('bep.toolbar.load') + '</button>'
            + '<button class="btn-live" onclick="bepLiveCalc()">' + t('bep.toolbar.recalc') + '</button>'
            + '<button class="btn-save" onclick="bepSave()">' + t('bep.toolbar.save') + '</button>'
            + '</div>'

            + '<div class="bep-container">'

            + '<div class="bep-card"><h3>' + t('bep.c1.title') + '</h3>'
            + '<div class="bep-formula" style="grid-template-columns:1fr 40px 1fr 40px 1fr;">'
            + '<div class="bep-box sale"><div class="lbl">' + t('bep.c1.sale') + ' <span style="font-size:.7em;color:#888;">' + t('bep.c1.sale_hint') + '</span></div><input type="number" step="0.01" class="bep-input-sale" id="bep_sale_input" value="-"></div>'
            + '<div class="bep-op">-</div>'
            + '<div class="bep-box varCost bep-clickable" onclick="bepShowVarCostDetail()"><div class="lbl">' + t('bep.c1.varcost') + ' <span style="font-size:.7em;color:#888;">' + t('bep.c1.varcost_hint') + '</span></div><div class="val" id="bep_varCost_show">-</div></div>'
            + '<div class="bep-op">=</div>'
            + '<div class="bep-box cm"><div class="lbl">' + t('bep.c1.cm') + '</div><div class="val" id="bep_cm_show">-</div></div>'
            + '</div>'
            + '<div class="bep-formula" style="grid-template-columns:1fr 40px 1fr 40px 1fr;margin-top:10px;">'
            + '<div class="bep-box mat bep-clickable" onclick="bepShowVarCostDetail()"><div class="lbl">' + t('bep.c1.mat') + ' <span style="font-size:.7em;color:#888;">' + t('bep.c1.mat_hint') + '</span></div><div class="val" id="bep_material_show">-</div></div>'
            + '<div class="bep-op">+</div>'
            + '<div style="padding:14px;border-radius:10px;border:2px solid #f1c40f;background:#fef9e7;">'
            + '<div class="lbl" style="color:#7d6608;">' + t('bep.c1.vexp') + '</div>'
            + '<input type="number" id="bep_variable_expense" class="bep-input-yellow">'
            + '</div>'
            + '<div class="bep-op">=</div>'
            + '<div class="bep-box varCost bep-clickable" onclick="bepShowVarCostDetail()"><div class="lbl">' + t('bep.c1.varcost') + ' <span style="font-size:.7em;color:#888;">' + t('bep.c1.varcost_hint') + '</span></div><div class="val" id="bep_varCost_show2">-</div></div>'
            + '</div>'
            + '</div>'

            + '<div class="bep-card"><h3>' + t('bep.c2.title') + '</h3>'
            + '<div class="bep-formula" style="grid-template-columns:1fr 40px 1fr 40px 1fr;">'
            + '<div class="bep-box fixed bep-clickable" onclick="bepShowFixedCostDetail()">'
            + '<div class="lbl">' + t('bep.c2.fx') + ' <span style="font-size:.7em;color:#888;">' + t('bep.c2.fx_hint') + '</span></div>'
            + '<div class="val" id="bep_fixed_cost_show" style="color:#6c3483;">-</div>'
            + '</div>'
            + '<div class="bep-op">/</div>'
            + '<div class="bep-box cmRate"><div class="lbl">' + t('bep.c2.cmrate') + '</div><div class="val" id="bep_cmRate_show">-</div></div>'
            + '<div class="bep-op">=</div>'
            + '<div class="bep-box bep"><div class="lbl">' + t('bep.c2.bep') + '</div><div class="val" id="bep_bep_show">-</div></div>'
            + '</div>'
            + '<div class="bep-gap-note">'
            + '<span id="bep_gap_label" class="lbl-gap" style="color:#c0392b;">' + t('bep.gap.shortage') + '</span>'
            + ': <span id="bep_gap_show" class="amt" style="color:#c0392b;">-</span>'
            + '<span id="bep_gap_arrow"></span>'
            + '</div>'
            + '</div>'

            + '<div class="bep-card"><h3>' + t('bep.c3.title') + '</h3>'
            + '<div class="bep-formula" style="grid-template-columns:1fr 40px 1fr 40px 1fr;">'
            + '<div class="bep-box cm"><div class="lbl">' + t('bep.c1.cm') + '</div><div class="val" id="bep_cm_show2">-</div></div>'
            + '<div class="bep-op">/</div>'
            + '<div class="bep-box sale"><div class="lbl">' + t('bep.c1.sale') + '</div><div class="val" id="bep_sale_show2">-</div></div>'
            + '<div class="bep-op">=</div>'
            + '<div class="bep-box cmRate"><div class="lbl">' + t('bep.c2.cmrate') + '</div><div class="val" id="bep_cmRate_show2">-</div></div>'
            + '</div>'
            + '</div>'

            + '<div class="bep-card"><h3>' + t('bep.c4.title') + '</h3>'
            + '<div class="bep-edit">'
            + '<div class="field"><label>' + t('bep.edit.consumable') + '</label><input type="number" id="bep_consumable"></div>'
            + '<div class="field"><label>' + t('bep.edit.packaging') + '</label><input type="number" id="bep_packaging"></div>'
            + '<div class="field"><label>' + t('bep.edit.processing') + '</label><input type="number" id="bep_processing"></div>'
            + '<div class="field"><label>' + t('bep.edit.misc_purchase') + '</label><input type="number" id="bep_misc_purchase"></div>'
            + '<div class="field"><label>' + t('bep.edit.freight') + '</label><input type="number" id="bep_freight"></div>'
            + '<div class="field"><label>' + t('bep.edit.customs') + '</label><input type="number" id="bep_customs"></div>'
            + '<div class="field"><label>' + t('bep.edit.service_part_comp') + '</label><input type="number" id="bep_service_part_comp"></div>'
            + '<div class="field blue"><label>' + t('bep.edit.material_auto') + '</label><div id="bep_material_field" style="font-weight:700;color:#1a5276;padding:6px 0;">-</div></div>'
            + '<div class="field" style="grid-column:span 2;"><label>' + t('bep.edit.remark') + '</label><input type="text" id="bep_remark"></div>'
            + '</div>'
            + '</div>'

            + '</div></div>'

            // === 變動成本明細彈窗 ===
            + '<div id="bep_modal" class="bep-modal-overlay" onclick="bepCloseVarCostDetail(event)">'
            + '<div class="bep-modal-card" onclick="event.stopPropagation()">'
            + '<div class="bep-modal-header">'
            + '<span class="bep-modal-title">📊 ' + t('bep.vcm.title') + '</span>'
            + '<button class="bep-modal-close" onclick="bepCloseVarCostDetail()">✕</button>'
            + '</div>'
            + '<div class="bep-modal-body" id="bep_varCost_modal_body"></div>'
            + '<div class="bep-modal-footer">'
            + '<button class="bep-btn-close" onclick="bepCloseVarCostDetail()">' + t('modal.close') + '</button>'
            + '</div>'
            + '</div></div>'

            // === 項目歷史趨勢子彈窗 (z-index 更高) ===
            + '<div id="bep_item_modal" class="bep-modal-overlay" style="z-index:10000;" onclick="bepCloseItemDetail(event)">'
            + '<div class="bep-modal-card" onclick="event.stopPropagation()">'
            + '<div class="bep-modal-header" id="bep_item_modal_header">'
            + '<span class="bep-modal-title" id="bep_item_modal_title">📈 ' + t('bep.im.title_trend') + '</span>'
            + '<button class="bep-modal-close" onclick="bepCloseItemDetail()">✕</button>'
            + '</div>'
            + '<div class="bep-modal-body" id="bep_item_modal_body"></div>'
            + '<div class="bep-modal-footer">'
            + '<button class="bep-btn-close" onclick="bepCloseItemDetail()">' + t('modal.close') + '</button>'
            + '</div>'
            + '</div></div>'

            // === 固定成本明細彈窗（紫色，欄位可編輯） ===
            + '<div id="bep_fixed_modal" class="bep-modal-overlay" onclick="bepCloseFixedCostDetail(event)">'
            + '<div class="bep-modal-card" onclick="event.stopPropagation()">'
            + '<div class="bep-modal-header purple">'
            + '<span class="bep-modal-title">💜 ' + t('bep.fcm.title') + t('bep.fcm.subtitle') + '</span>'
            + '<button class="bep-modal-close" onclick="bepCloseFixedCostDetail()">✕</button>'
            + '</div>'
            + '<div class="bep-modal-body">'
            + '<div style="margin-bottom:14px;padding:10px 14px;background:#f8f9fa;border-radius:6px;border-left:4px solid #8e44ad;font-size:.9em;" id="bep_fixed_info"></div>'
            + '<table class="bep-detail-table">'
            + '<thead><tr>'
            + '<th style="width:26%;">' + t('bep.vcm.col.item') + '</th>'
            + '<th style="width:24%;">' + t('bep.fcm.col.amount') + '</th>'
            + '<th class="pct">' + t('bep.fcm.col.pct_fx') + '</th>'
            + '<th class="pct">' + t('bep.fcm.col.pct_sale') + '</th>'
            + '<th style="width:14%;">' + t('bep.fcm.col.detail') + '</th>'
            + '</tr></thead><tbody>'
            + '<tr>'
            + '<td><span class="label-cell"><span class="dot" style="background:#8e44ad;"></span>' + t('bep.fcm.item.fixed_salary') + '</span></td>'
            + '<td><input type="number" step="0.01" id="bep_fixed_salary" class="bep-input-fixed"></td>'
            + '<td class="pct" id="bep_fixed_salary_pct">-</td>'
            + '<td class="pct" id="bep_fixed_salary_pct_sale">-</td>'
            + '<td><button class="bep-btn-detail" onclick="bepShowItemDetail(\'fixed_salary\',\'' + t('bep.fcm.item.fixed_salary') + '\',\'#8e44ad\')">📋 ' + t('bep.fcm.col.detail') + '</button></td>'
            + '</tr>'
            + '<tr>'
            + '<td><span class="label-cell"><span class="dot" style="background:#af7ac5;"></span>' + t('bep.fcm.item.fixed_rent') + '</span></td>'
            + '<td><input type="number" step="0.01" id="bep_fixed_rent" class="bep-input-fixed"></td>'
            + '<td class="pct" id="bep_fixed_rent_pct">-</td>'
            + '<td class="pct" id="bep_fixed_rent_pct_sale">-</td>'
            + '<td><button class="bep-btn-detail" onclick="bepShowItemDetail(\'fixed_rent\',\'' + t('bep.fcm.item.fixed_rent') + '\',\'#af7ac5\')">📋 ' + t('bep.fcm.col.detail') + '</button></td>'
            + '</tr>'
            + '<tr>'
            + '<td><span class="label-cell"><span class="dot" style="background:#6c3483;"></span>' + t('bep.fcm.item.fixed_interest') + '</span></td>'
            + '<td><input type="number" step="0.01" id="bep_fixed_interest" class="bep-input-fixed"></td>'
            + '<td class="pct" id="bep_fixed_interest_pct">-</td>'
            + '<td class="pct" id="bep_fixed_interest_pct_sale">-</td>'
            + '<td><button class="bep-btn-detail" onclick="bepShowItemDetail(\'fixed_interest\',\'' + t('bep.fcm.item.fixed_interest') + '\',\'#6c3483\')">📋 ' + t('bep.fcm.col.detail') + '</button></td>'
            + '</tr>'
            + '<tr class="total bep-row-clickable" onclick="bepShowItemDetail(\'fixed_cost\',\'' + t('bep.fcm.item.total') + '\',\'#6c3483\')">'
            + '<td>' + t('bep.fcm.item.total') + ' (' + t('bep.fcm.item.fixed_salary') + ' + ' + t('bep.fcm.item.fixed_rent') + ' + ' + t('bep.fcm.item.fixed_interest') + ')</td>'
            + '<td id="bep_fixed_total_show">-</td>'
            + '<td class="pct">100.00%</td>'
            + '<td class="pct" id="bep_fixed_total_pct_sale">-</td>'
            + '<td><button class="bep-btn-detail" onclick="event.stopPropagation();bepShowItemDetail(\'fixed_cost\',\'' + t('bep.fcm.item.total') + '\',\'#6c3483\')">📋 ' + t('bep.fcm.col.detail') + '</button></td>'
            + '</tr>'
            + '</tbody></table>'
            + '<div style="margin-top:14px;padding:10px 14px;background:#f5eef8;border-radius:6px;font-size:.88em;color:#6c3483;" id="bep_fixed_hint"></div>'
            + '<div style="margin-top:10px;font-size:.82em;color:#7f8c8d;">💡 ' + t('bep.fcm.hint_title') + '</div>'
            + '</div>'
            + '<div class="bep-modal-footer">'
            + '<button class="bep-btn-close" onclick="bepCloseFixedCostDetail()">' + t('modal.close') + '</button>'
            + '</div>'
            + '</div></div>'

            + '<style>'
            + '.bep-wrap{font-family:"Microsoft JhengHei",sans-serif;}'
            + '.bep-toolbar{display:flex;align-items:center;gap:12px;padding:12px 16px;background:linear-gradient(135deg,#3498db,#2980b9);color:#fff;border-radius:8px;margin-bottom:18px;flex-wrap:wrap;}'
            + '.bep-toolbar label{font-size:0.9em;opacity:.9;}'
            + '.bep-toolbar select,.bep-toolbar input[type=text]{padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.15);color:#fff;font-weight:600;}'
            + '.bep-toolbar select option{color:#333;background:#fff;}'
            + '.bep-toolbar button{padding:6px 16px;border:none;border-radius:6px;font-weight:600;cursor:pointer;color:#fff;font-size:0.9em;}'
            + '.btn-refresh{background:#2980b9;}'
            + '.btn-refresh:hover{background:#1f6fa0;}'
            + '.btn-live{background:#d68910;}'
            + '.btn-live:hover{background:#b9770e;}'
            + '.btn-save{background:#229954;}'
            + '.btn-save:hover{background:#1e8449;}'
            + '.bep-container{display:grid;gap:14px;}'
            + '.bep-card{background:#fff;border-radius:10px;padding:16px;box-shadow:0 2px 10px rgba(0,0,0,.08);}'
            + '.bep-card h3{margin:0 0 12px;font-size:1.05em;color:#2c3e50;border-bottom:2px solid #3498db;padding-bottom:6px;display:inline-block;}'
            + '.bep-formula{display:grid;gap:12px;align-items:stretch;}'
            + '.bep-box{padding:14px 16px;border-radius:10px;text-align:center;border:2px solid transparent;display:flex;flex-direction:column;justify-content:center;}'
            + '.bep-box .lbl{font-size:0.82em;color:#555;margin-bottom:4px;font-weight:500;}'
            + '.bep-box .val{font-size:1.25em;font-weight:700;}'
            + '.bep-box.sale{background:#d4e6f1;border-color:#2980b9;}'
            + '.bep-box.varCost{background:#fadbd8;border-color:#c0392b;}'
            + '.bep-box.cm{background:#d5f5e3;border-color:#27ae60;}'
            + '.bep-box.fixed{background:#e8daef;border-color:#8e44ad;}'
            + '.bep-box.cmRate{background:#fef9e7;border-color:#f39c12;}'
            + '.bep-box.bep{background:#d5dbdb;border-color:#555;}'
            + '.bep-box.mat{background:#eaecee;border-color:#7f8c8d;}'
            + '.bep-op{display:flex;align-items:center;justify-content:center;font-size:1.8em;font-weight:800;color:#34495e;}'
            + '.bep-edit{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;}'
            + '.bep-edit .field{background:#fef9e7;padding:10px 14px;border-radius:6px;border-left:4px solid #f1c40f;}'
            + '.bep-edit label{display:block;font-size:0.78em;color:#7d6608;margin-bottom:4px;font-weight:600;}'
            + '.bep-edit input[type=number],.bep-edit input[type=text]{width:100%;padding:6px 8px;border:1px solid #f4d03f;border-radius:4px;font-size:0.95em;background:#fffef9;box-sizing:border-box;}'
            + '.bep-edit input:focus{outline:none;border-color:#f39c12;background:#fff;}'
            + '.bep-edit .field.blue{background:#d4e6f1;border-left-color:#2980b9;}'
            + '.bep-edit .field.blue label{color:#1a5276;}'
            + '.bep-input-purple,.bep-input-yellow{width:100%;padding:4px 6px;border-radius:4px;font-weight:700;font-size:1.05em;}'
            + '.bep-input-purple{border:1px solid #8e44ad;background:#f5eef8;color:#6c3483;}'
            + '.bep-input-yellow{border:1px solid #f4d03f;background:#fffef9;color:#7d6608;}'
            + '.bep-input-sale{width:100%;padding:6px 8px;border-radius:6px;font-weight:700;font-size:1.25em;text-align:center;border:1.5px solid #2980b9;background:#fff;color:#1a5276;outline:none;}'
            + '.bep-input-sale:focus{box-shadow:0 0 0 2px rgba(41,128,185,0.25);}'
            + '.bep-gap-note{text-align:right;margin-top:10px;font-size:0.9em;}'
            + '.bep-gap-note .amt{font-size:1.2em;font-weight:700;}'

            // 可點擊卡片樣式
            + '.bep-clickable{cursor:pointer;transition:transform .15s,box-shadow .15s;}'
            + '.bep-clickable:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.15);}'

            // === Modal 彈窗樣式 ===
            + '.bep-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;z-index:9999;align-items:center;justify-content:center;}'
            + '.bep-modal-overlay.show{display:flex;}'
            + '.bep-modal-card{background:#fff;border-radius:12px;width:90%;max-width:620px;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.25);overflow:hidden;}'
            + '.bep-modal-header{display:flex;justify-content:space-between;align-items:center;padding:14px 20px;background:linear-gradient(135deg,#c0392b,#e74c3c);color:#fff;}'
            + '.bep-modal-header.purple{background:linear-gradient(135deg,#6c3483,#8e44ad);}'
            + '.bep-modal-title{font-size:1.05em;font-weight:700;}'
            + '.bep-modal-close{background:none;border:none;color:#fff;font-size:1.3em;cursor:pointer;padding:0 4px;line-height:1;}'
            + '.bep-modal-close:hover{opacity:.7;}'
            + '.bep-modal-body{padding:16px 20px;overflow-y:auto;flex:1;}'
            + '.bep-modal-footer{padding:12px 20px;border-top:1px solid #eee;text-align:right;background:#fafafa;}'
            + '.bep-btn-close{padding:6px 20px;background:#7f8c8d;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer;}'
            + '.bep-btn-close:hover{background:#5d6d7e;}'

            // 固定成本明細彈窗專用
            + '.bep-input-fixed{width:100%;padding:6px 8px;border:1px solid #bb8fce;border-radius:4px;font-size:.95em;font-weight:600;background:#faf5fc;color:#6c3483;box-sizing:border-box;}'
            + '.bep-input-fixed:focus{outline:none;border-color:#8e44ad;background:#fff;box-shadow:0 0 0 2px rgba(142,68,173,.18);}'
            + '.bep-btn-detail{padding:3px 10px;background:#8e44ad;color:#fff;border:none;border-radius:5px;font-size:.82em;font-weight:600;cursor:pointer;white-space:nowrap;}'
            + '.bep-btn-detail:hover{background:#6c3483;}'

            // 彈窗內表格
            + '.bep-detail-table{width:100%;border-collapse:collapse;font-size:.92em;}'
            + '.bep-detail-table th,.bep-detail-table td{padding:8px 12px;text-align:right;border-bottom:1px solid #ecf0f1;}'
            + '.bep-detail-table th:first-child,.bep-detail-table td:first-child{text-align:left;}'
            + '.bep-detail-table thead th{background:#f8f9fa;color:#2c3e50;font-weight:700;}'
            + '.bep-detail-table .subtotal td{background:#fef9e7;font-weight:700;color:#7d6608;}'
            + '.bep-detail-table .total td{background:#d5f5e3;font-weight:800;color:#1e8449;font-size:1em;}'
            + '.bep-detail-table .pct{color:#7f8c8d;font-size:.85em;}'
            + '.bep-detail-table .negative{color:#c0392b;}'
            + '.bep-detail-table .label-cell{display:flex;align-items:center;gap:6px;}'
            + '.bep-detail-table .dot{width:10px;height:10px;border-radius:50%;display:inline-block;}'

            // 可點擊 row
            + '.bep-row-clickable{cursor:pointer;transition:background .15s;}'
            + '.bep-row-clickable:hover{background:#f0f4f8 !important;}'

            // 趨勢柱狀圖
            + '.bep-trend-wrap{margin-top:14px;}'
            + '.bep-trend-title{font-weight:700;color:#2c3e50;margin-bottom:8px;}'
            + '.bep-bar-chart{display:flex;align-items:flex-end;gap:4px;height:140px;padding:0 6px;border-bottom:2px solid #bdc3c7;border-left:2px solid #bdc3c7;margin-bottom:6px;}'
            + '.bep-bar-col{flex:1;display:flex;flex-direction:column;align-items:center;min-width:20px;}'
            + '.bep-bar{width:100%;border-radius:3px 3px 0 0;transition:height .3s;background:#3498db;}'
            + '.bep-bar-val{font-size:.72em;color:#555;margin-bottom:2px;font-weight:600;}'
            + '.bep-bar-label{font-size:.68em;color:#7f8c8d;margin-top:4px;}'
            + '.bep-trend-table{width:100%;border-collapse:collapse;font-size:.88em;margin-top:12px;}'
            + '.bep-trend-table th,.bep-trend-table td{padding:6px 10px;text-align:right;border-bottom:1px solid #ecf0f1;}'
            + '.bep-trend-table th:first-child,.bep-trend-table td:first-child{text-align:left;}'
            + '.bep-trend-table thead th{background:#f8f9fa;color:#2c3e50;font-weight:700;}'
            + '.bep-mom-up{color:#27ae60;}'
            + '.bep-mom-down{color:#c0392b;}'
            + '.bep-stats-row{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;}'
            + '.bep-stat-card{flex:1;min-width:130px;padding:10px 14px;border-radius:8px;text-align:center;}'
            + '.bep-stat-card .lbl{font-size:.78em;color:#555;margin-bottom:4px;}'
            + '.bep-stat-card .val{font-size:1.1em;font-weight:700;}'
            + '.bep-stat-card.blue{background:#d4e6f1;}'
            + '.bep-stat-card.green{background:#d5f5e3;}'
            + '.bep-stat-card.orange{background:#fef9e7;}'
            + '.bep-stat-card.red{background:#fadbd8;}'

            // Tab 切換
            + '.bep-tab-bar{display:flex;gap:0;border-bottom:2px solid #bdc3c7;margin-bottom:14px;}'
            + '.bep-tab-btn{flex:1;padding:8px 16px;background:none;border:none;font-weight:600;cursor:pointer;color:#7f8c8d;font-size:.95em;border-bottom:3px solid transparent;margin-bottom:-2px;transition:all .15s;}'
            + '.bep-tab-btn:hover{color:#2c3e50;background:#f8f9fa;}'
            + '.bep-tab-btn.active{color:#2980b9;border-bottom-color:#2980b9;background:#eaf2f8;}'

            + '</style>';
    }

    window.bepLoad = load;
    window.bepSave = save;
    window.bepLiveCalc = liveCalc;

    // === 變動成本明細彈窗 ===
    // 把名稱編碼為可安全放進 onclick="..." 屬性的 JS 字串（雙引號轉 &quot;，
    // 避免名稱裡的雙引號截斷 HTML 屬性導致點擊無反應）
    function J(s) {
        return JSON.stringify(String(s == null ? '' : s)).replace(/"/g, '&quot;');
    }
    function showVarCostDetail() {
        // 優先用閉包 BEP；若尚未初始化則從 DOM 顯示值解析
        let sale = 0;
        const saleInput = document.getElementById('bep_sale_input');
        if (saleInput && saleInput.value) {
            sale = Number(saleInput.value) || 0;
        } else if (BEP && BEP.sale_amt) {
            sale = Number(BEP.sale_amt) || 0;
        }
        if (sale <= 0) { UI.toast(t('bep.msg.need_data'), 'warn'); return; }

        const vals = getInputVals();
        const c = compute(sale, vals);

        const materialItems = [
            { name: t('bep.edit.consumable'),         key: 'consumable',        color: '#e74c3c' },
            { name: t('bep.edit.packaging'),          key: 'packaging',         color: '#3498db' },
            { name: t('bep.edit.processing'),         key: 'processing',        color: '#9b59b6' },
            { name: t('bep.edit.misc_purchase'),      key: 'misc_purchase',     color: '#f39c12' },
            { name: t('bep.edit.freight'),            key: 'freight',           color: '#1abc9c' },
            { name: t('bep.edit.customs'),            key: 'customs',           color: '#e67e22' },
            { name: t('bep.edit.service_part_comp'),  key: 'service_part_comp', color: '#34495e' }
        ];

        const vb = vals.variable_expense;  // variable expense
        const matTotal = c.material;       // material total
        const grandTotal = c.variable_cost; // total variable cost

        function pctOf(amt, base) {
            if (!base) return '0.00%';
            return (Number(amt) / Number(base) * 100).toFixed(2) + '%';
        }

        // 組裝表格 HTML
        let html = '<div style="margin-bottom:14px;padding:10px 14px;background:#f8f9fa;border-radius:6px;border-left:4px solid #2980b9;">'
                 + '<strong>' + t('bep.vcm.period_label') + ':</strong> ' + (document.getElementById('bepBU').value || 'HM') + ' / ' + (document.getElementById('bepYM').value || '-')
                 + '&nbsp;&nbsp;|&nbsp;&nbsp;'
                 + '<strong>' + t('bep.c1.sale') + ':</strong> ' + fmt(sale)
                 + '&nbsp;&nbsp;|&nbsp;&nbsp;'
                 + '<strong>' + t('bep.c2.cmrate') + ':</strong> ' + fmtPct(c.cm_rate)
                 + '</div>';

        html += '<table class="bep-detail-table">'
             + '<thead><tr>'
             + '<th style="width:40%;">' + t('bep.vcm.col.item') + '</th>'
             + '<th>' + t('bep.vcm.col.amount') + '</th>'
             + '<th class="pct">' + t('bep.vcm.col.pct_total') + '</th>'
             + '<th class="pct">' + t('bep.vcm.col.pct_sale') + '</th>'
             + '</tr></thead><tbody>';

        // 材料明細（每行可點擊看趨勢）
        for (let i = 0; i < materialItems.length; i++) {
            const it = materialItems[i];
            const amt = vals[it.key];
            html += '<tr class="bep-row-clickable" onclick="bepShowItemDetail(\'' + it.key + '\',' + J(it.name) + ',\'' + it.color + '\')">'
                  + '<td><span class="label-cell"><span class="dot" style="background:' + it.color + ';"></span>' + it.name + '</span></td>'
                  + '<td>' + fmt(amt) + '</td>'
                  + '<td class="pct">' + pctOf(amt, grandTotal) + '</td>'
                  + '<td class="pct">' + pctOf(amt, sale) + '</td>'
                  + '</tr>';
        }

        // 材料合計 row（可點擊）
        html += '<tr class="subtotal bep-row-clickable" onclick="bepShowItemDetail(\'material_sum\',' + J(t('bep.vcm.item.material')) + ',\'#7f8c8d\')">'
              + '<td>' + t('bep.vcm.item.material') + '</td>'
              + '<td>' + fmt(matTotal) + '</td>'
              + '<td class="pct">' + pctOf(matTotal, grandTotal) + '</td>'
              + '<td class="pct">' + pctOf(matTotal, sale) + '</td>'
              + '</tr>';

        // 變動費用 row（可點擊）
        html += '<tr class="bep-row-clickable" onclick="bepShowItemDetail(\'variable_expense\',' + J(t('bep.vcm.item.variable_expense')) + ',\'#f1c40f\')">'
              + '<td><span class="label-cell"><span class="dot" style="background:#f1c40f;"></span>' + t('bep.vcm.item.variable_expense') + '</span></td>'
              + '<td>' + fmt(vb) + '</td>'
              + '<td class="pct">' + pctOf(vb, grandTotal) + '</td>'
              + '<td class="pct">' + pctOf(vb, sale) + '</td>'
              + '</tr>';

        // 分隔
        html += '<tr style="height:6px;"><td colspan="4" style="border:none;"></td></tr>';

        // 變動成本總計（可點擊）
        html += '<tr class="total bep-row-clickable" onclick="bepShowItemDetail(\'variable_cost\',' + J(t('bep.vcm.item.variable_cost')) + ',\'#c0392b\')">'
              + '<td>' + t('bep.vcm.total_formula') + '</td>'
              + '<td>' + fmt(grandTotal) + '</td>'
              + '<td class="pct">100.00%</td>'
              + '<td class="pct">' + pctOf(grandTotal, sale) + '</td>'
              + '</tr>';

        html += '</tbody></table>';

        // 附加公式鏈小提示
        html += '<div style="margin-top:14px;padding:10px 14px;background:#e8daef;border-radius:6px;font-size:.88em;color:#6c3483;">'
              + '<strong>' + t('bep.formula_title') + ':</strong><br>'
              + t('bep.formula.vc_eq') + t('bep.vcm.item.material') + ' (' + fmt(matTotal) + ') + ' + t('bep.vcm.item.variable_expense') + ' (' + fmt(vb) + ') = <strong>' + fmt(grandTotal) + '</strong><br>'
              + t('bep.formula.cm_eq') + t('bep.c1.sale') + ' (' + fmt(sale) + ') − ' + t('bep.c1.varcost') + ' = <strong>' + fmt(c.contribution_margin) + '</strong><br>'
              + t('bep.formula.bep_eq') + t('bep.c2.fx') + ' (' + fmt(vals.fixed_cost) + ') ÷ (' + t('bep.c2.cmrate') + ' ' + fmtPct(c.cm_rate) + ') = <strong>' + fmt(c.bep) + '</strong>'
              + '</div>';

        document.getElementById('bep_varCost_modal_body').innerHTML = html;
        document.getElementById('bep_modal').classList.add('show');
    }

    function closeVarCostDetail(e) {
        // 從遮罩點擊或按鈕觸發都安全，不影響 stopPropagation
        if (e && e.target && e.target.id !== 'bep_modal' && e.type === 'click') {
            // 只在遮罩本身觸發時關閉（card 內部用 stopPropagation 擋住了）
            // 這裡是額外保護：遮罩 onclick 也會調用 closeVarCostDetail(event)
            // stopPropagation 在 card onclick 上，所以冒泡到 overlay 的是遮罩本身的 click
        }
        document.getElementById('bep_modal').classList.remove('show');
    }

    window.bepShowVarCostDetail = showVarCostDetail;
    window.bepCloseVarCostDetail = closeVarCostDetail;

    // === 固定成本明細彈窗（欄位可編輯 + 可鑽取交易明細/趨勢） ===
    const FIXED_ITEMS = [
        { key: 'fixed_salary',   name: t('bep.fcm.item.fixed_salary'),     color: '#8e44ad' },
        { key: 'fixed_rent',     name: t('bep.fcm.item.fixed_rent'),       color: '#af7ac5' },
        { key: 'fixed_interest', name: t('bep.fcm.item.fixed_interest'),   color: '#6c3483' }
    ];

    function pctText(amt, base) {
        if (!base) return '0.00%';
        return (Number(amt) / Number(base) * 100).toFixed(2) + '%';
    }

    function refreshFixedModalUI(sale, vals, c) {
        const total = vals.fixed_cost;
        FIXED_ITEMS.forEach(function(it) {
            const amt = vals[it.key];
            const pctEl = document.getElementById('bep_' + it.key + '_pct');
            const pctSaleEl = document.getElementById('bep_' + it.key + '_pct_sale');
            if (pctEl) pctEl.textContent = pctText(amt, total);
            if (pctSaleEl) pctSaleEl.textContent = pctText(amt, sale);
        });
        const totalEl = document.getElementById('bep_fixed_total_show');
        if (totalEl) totalEl.textContent = fmt(total);
        const totalSaleEl = document.getElementById('bep_fixed_total_pct_sale');
        if (totalSaleEl) totalSaleEl.textContent = pctText(total, sale);

        const info = document.getElementById('bep_fixed_info');
        if (info) {
            info.innerHTML = '<strong>' + t('bep.fcm.col.period') + ':</strong> ' + (document.getElementById('bepBU').value || 'HM')
                + ' / ' + (document.getElementById('bepYM').value || '-')
                + '&nbsp;&nbsp;|&nbsp;&nbsp;<strong>' + t('bep.c1.sale') + ':</strong> ' + fmt(sale)
                + '&nbsp;&nbsp;|&nbsp;&nbsp;<strong>' + t('bep.c2.cmrate') + ':</strong> ' + fmtPct(c.cm_rate);
        }
        const hint = document.getElementById('bep_fixed_hint');
        if (hint) {
            hint.innerHTML = '<strong>' + t('bep.formula_title') + ':</strong><br>'
                + t('bep.formula.fx_eq') + t('bep.fcm.item.fixed_salary') + ' (' + fmt(vals.fixed_salary) + ') + ' + t('bep.fcm.item.fixed_rent')
                + ' (' + fmt(vals.fixed_rent) + ') + ' + t('bep.fcm.item.fixed_interest') + ' (' + fmt(vals.fixed_interest) + ') = <strong>' + fmt(total) + '</strong><br>'
                + t('bep.formula.bep_eq') + t('bep.c2.fx') + ' (' + fmt(total) + ') ÷ (' + t('bep.c2.cmrate') + ' ' + fmtPct(c.cm_rate)
                + ') = <strong>' + fmt(c.bep) + '</strong>';
        }
    }

    function showFixedCostDetail() {
        let sale = 0;
        const saleInput = document.getElementById('bep_sale_input');
        if (saleInput && saleInput.value) {
            sale = Number(saleInput.value) || 0;
        } else if (BEP && BEP.sale_amt) {
            sale = Number(BEP.sale_amt) || 0;
        }
        if (sale <= 0) { UI.toast(t('bep.msg.need_data'), 'warn'); return; }

        const vals = getInputVals();
        const c = compute(sale, vals);
        refreshFixedModalUI(sale, vals, c);
        document.getElementById('bep_fixed_modal').classList.add('show');
    }

    function closeFixedCostDetail() {
        const m = document.getElementById('bep_fixed_modal');
        if (m) m.classList.remove('show');
    }

    window.bepShowFixedCostDetail = showFixedCostDetail;
    window.bepCloseFixedCostDetail = closeFixedCostDetail;

    // === 項目明細子彈窗（交易明細 + 歷史趨勢 tab） ===
    let _itemDetailCache = {};

    function showItemDetail(key, itemName, color) {
        const bu = document.getElementById('bepBU').value || 'HM';
        const ym = document.getElementById('bepYM').value || '';
        const year = ym.substring(0, 4) || '2025';

        // 設定子彈窗 header 顏色 + 標題
        var header = document.getElementById('bep_item_modal_header');
        if (header) header.style.background = 'linear-gradient(135deg,' + color + ',' + color + 'cc)';
        var title = document.getElementById('bep_item_modal_title');
        if (title) title.textContent = itemName + t('bep.item.detail_suffix');

        // loading + tab 結構
        document.getElementById('bep_item_modal_body').innerHTML =
            '<div style="text-align:center;padding:40px;color:#7f8c8d;">' + t('loading') + '</div>';
        document.getElementById('bep_item_modal').classList.add('show');

        // 同時 fetch 兩個 API
        Promise.all([
            fetch('/api/bep/detail?bu_no=' + bu + '&YYYY_MM=' + ym + '&item_key=' + encodeURIComponent(key))
                .then(function(r) { return r.json(); }),
            fetch('/api/bep/history?bu_no=' + bu + '&year=' + year)
                .then(function(r) { return r.json(); })
        ]).then(function(results) {
            var detail = results[0];
            var history = results[1];
            _itemDetailCache = { key: key, itemName: itemName, color: color, ym: ym, bu: bu };

            if (!detail.success) { UI.toast(detail.message, 'error'); return; }
            if (!history.success) { history = { data: { months: [] } }; }

            renderItemModalWithTabs(key, itemName, color, detail.data, history.data, ym);
        }).catch(function(e) {
            document.getElementById('bep_item_modal_body').innerHTML =
                '<div style="text-align:center;padding:40px;color:#c0392b;">' + t('bep.msg.load_fail') + ': ' + e.message + '</div>';
        });
    }

    function switchItemTab(tabName) {
        var c = _itemDetailCache;
        if (!c) return;
        // 重新 fetch（快取已在 render 時存好，這裡直接重叫 showItemDetail 的 render 部分不太方便，
        // 簡化做法：保存 state 後重觸發渲染）
        var itemKey = c.key;
        var itemName = c.itemName;
        var color = c.color;
        var bu = document.getElementById('bepBU').value || 'HM';
        var ym = document.getElementById('bepYM').value || '';
        var year = ym.substring(0, 4) || '2025';

        Promise.all([
            fetch('/api/bep/detail?bu_no=' + bu + '&YYYY_MM=' + ym + '&item_key=' + encodeURIComponent(itemKey))
                .then(function(r) { return r.json(); }),
            fetch('/api/bep/history?bu_no=' + bu + '&year=' + year)
                .then(function(r) { return r.json(); })
        ]).then(function(results) {
            renderItemModalWithTabs(itemKey, itemName, color, results[0].data, results[1].data, ym, tabName);
        });
    }

    // 主渲染：tab + 交易明細 + 趨勢圖
    function renderItemModalWithTabs(key, itemName, color, detailData, historyData, currentYM, activeTab) {
        activeTab = activeTab || 'detail';

        // Tab header
        var html = '<div class="bep-tab-bar">'
                 + '<button class="bep-tab-btn ' + (activeTab === 'detail' ? 'active' : '') + '" onclick="bepSwitchItemTab(\'detail\')">📋 ' + t('bep.im.tab.detail') + '</button>'
                 + '<button class="bep-tab-btn ' + (activeTab === 'trend' ? 'active' : '') + '" onclick="bepSwitchItemTab(\'trend\')">📈 ' + t('bep.im.tab.trend') + '</button>'
                 + '</div>';

        if (activeTab === 'detail') {
            html += renderDetailTable(detailData, itemName, color);
        } else {
            html += renderTrendInline(key, itemName, color, historyData, currentYM);
        }

        document.getElementById('bep_item_modal_body').innerHTML = html;
    }

    // === 交易明細表（跟用戶圖片一致的格式） ===
    function renderDetailTable(data, itemName, color) {
        var html = '';

        // 映射說明 header（僅在既無現金科目映射、也無門檻資料可勾稽時提示）
        if (data.no_mapping && !data.reconcile && data.records.length === 0) {
            html += '<div style="padding:12px 16px;background:#fef9e7;border-radius:6px;border-left:4px solid #f1c40f;margin-bottom:12px;">'
                  + '💡 <strong>' + itemName + '</strong><br>'
                  + '<span style="font-size:.88em;color:#7d6608;">' + data.reason + '</span><br>'
                  + '<span style="font-size:.85em;color:#888;">' + t('bep.im.note') + '</span>'
                  + '</div>';
            return html;
        }

        // 摘要 header
        html += '<div style="padding:12px 16px;background:#f8f9fa;border-radius:6px;margin-bottom:12px;font-size:.9em;">'
              + '<strong>📋 ' + itemName + ' ' + t('bep.item.detail_title') + '</strong>'
              + '<span style="color:#7f8c8d;margin-left:12px;">' + t('bep.item.mapping') + ': ' + data.label + '</span><br>'
              + '<span style="font-size:.85em;color:#888;">' + t('bep.item.count').replace('{count}', data.summary.count) + ' | '
              + t('bep.item.dr') + ': ' + fmt(data.summary.total_debit) + ' | '
              + t('bep.item.cr') + ': ' + fmt(data.summary.total_credit) + ' | '
              + t('bep.item.balance') + ': ' + fmt(data.summary.final_balance) + '</span>'
              + '</div>';

        // 與門檻值勾稽說明（變動費用）
        if (data.reconcile) {
            var rc = data.reconcile;
            html += '<div style="padding:12px 16px;background:#fff8e1;border:1px solid #f1c40f;border-radius:6px;margin-bottom:12px;font-size:.88em;">'
                  + '<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span style="color:#7f8c8d;">' + t('bep.im.reconcile_booked') + '：</span><span>' + fmt(rc.booked_credit) + '</span></div>'
                  + '<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span style="color:#7d6608;">' + t('bep.im.reconcile_other') + '：</span><span>' + fmt(rc.adjustment_amount) + '</span></div>'
                  + '<div style="display:flex;justify-content:space-between;border-top:1px dashed #f1c40f;padding-top:6px;font-weight:700;color:#b9770e;"><span>' + t('bep.im.reconcile_total') + '：</span><span>' + fmt(rc.target_amount) + '</span></div>'
                  + '<div style="margin-top:6px;color:#999;font-size:.92em;">' + t('bep.im.reconcile_hint') + '</div>'
                  + '</div>';
        }

        if (data.records.length === 0) {
            html += '<div style="text-align:center;padding:30px;color:#7f8c8d;">' + t('bep.im.no_records') + '</div>';
            return html;
        }

        // 表格（跟用戶圖片一樣的格式：日期 | 憑證號 | 摘要 | 收入 | 支出 | 餘額）
        html += '<table class="bep-trend-table">'
             + '<thead><tr>'
             + '<th style="width:12%;">' + t('bep.im.col.date') + '</th>'
             + '<th style="width:18%;">' + t('bep.im.col.voucher') + '</th>'
             + '<th>' + t('bep.im.col.remark') + '</th>'
             + '<th style="width:14%;">' + t('bep.im.col.income') + '</th>'
             + '<th style="width:14%;">' + t('bep.im.col.col_expense') + '</th>'
             + '<th style="width:14%;">' + t('bep.im.col.col_balance') + '</th>'
             + '</tr></thead><tbody>';

        for (var i = 0; i < data.records.length; i++) {
            var r = data.records[i];
            if (r.is_adjustment) {
                // 勾稽調整行（非真實憑證）：無日期/憑證號，淡黃底＋斜體標示
                html += '<tr style="background:#fffdf2;font-style:italic;color:#7d6608;">'
                      + '<td style="color:#b0b0b0;">—</td>'
                      + '<td style="color:#b0b0b0;">—</td>'
                      + '<td>' + t('bep.im.other_allocated') + '</td>'
                      + '<td style="color:#27ae60;">' + (r.debit > 0 ? fmt(r.debit) : '') + '</td>'
                      + '<td style="color:#c0392b;">' + (r.credit > 0 ? fmt(r.credit) : '') + '</td>'
                      + '<td style="font-weight:600;">' + fmt(r.balance) + '</td>'
                      + '</tr>';
                continue;
            }
            html += '<tr>'
                  + '<td>' + (r.wk_date || '-') + '</td>'
                  + '<td style="font-family:monospace;">' + (r.num_vman || '-') + '</td>'
                  + '<td>' + (r.amt_type || '-') + '</td>'
                  + '<td style="color:#27ae60;">' + (r.debit > 0 ? fmt(r.debit) : '') + '</td>'
                  + '<td style="color:#c0392b;">' + (r.credit > 0 ? fmt(r.credit) : '') + '</td>'
                  + '<td style="font-weight:600;">' + fmt(r.balance) + '</td>'
                  + '</tr>';
        }

        // 合計 row（含調整行時，合計＝門檻值）
        var totalLabel = t('bep.item.total_count').replace('{count}', data.summary.count);
        if (data.summary.adjustment_count > 0) totalLabel += ' (+' + data.summary.adjustment_count + ')';
        html += '<tr style="background:#f8f9fa;font-weight:700;">'
              + '<td colspan="3" style="text-align:right;">' + totalLabel + '</td>'
              + '<td style="color:#27ae60;">' + fmt(data.summary.total_debit) + '</td>'
              + '<td style="color:#c0392b;">' + fmt(data.summary.total_credit) + '</td>'
              + '<td>' + fmt(data.summary.final_balance) + '</td>'
              + '</tr>';

        html += '</tbody></table>';
        return html;
    }

    // 簡化版趨勢渲染（單獨 tab 用）
    function renderTrendInline(key, itemName, color, data, currentYM) {
        if (!data.months || data.months.length === 0) {
            return '<div style="text-align:center;padding:30px;color:#7f8c8d;">' + t('bep.item.no_history').replace('{year}', data.year) + '</div>';
        }

        function itemVal(m) {
            if (key === 'material_sum') return m.material;
            if (key === 'variable_cost') return m.variable_cost;
            return m[key] || 0;
        }

        var months = data.months;
        var values = months.map(itemVal);
        var maxV = Math.max.apply(null, values);
        var sumV = values.reduce(function(a, b) { return a + b; }, 0);
        var avgV = sumV / values.length;
        var firstVal = values[0] || 0;
        var lastVal = values[values.length - 1] || 0;
        var yoy = firstVal > 0 ? ((lastVal - firstVal) / firstVal * 100) : 0;
        var isFlat = values.every(function(v) { return Math.abs(v - values[0]) < 0.01; });

        var html = '';
        if (isFlat) {
            html += '<div style="padding:10px 14px;background:#fef9e7;border-radius:6px;margin-bottom:12px;border-left:4px solid #f1c40f;">'
                  + '💡 <strong>' + itemName + '</strong> ' + t('bep.item.same_amount_hint') + '</div>';
        }

        html += '<div class="bep-stats-row">'
              + '<div class="bep-stat-card blue"><div class="lbl">' + t('bep.trend.stat.total') + '</div><div class="val">' + fmt(sumV) + '</div></div>'
              + '<div class="bep-stat-card orange"><div class="lbl">' + t('bep.trend.stat.avg') + '</div><div class="val">' + fmt(avgV) + '</div></div>'
              + '<div class="bep-stat-card green"><div class="lbl">' + t('bep.trend.stat.yoy') + '</div><div class="val ' + (yoy >= 0 ? 'bep-mom-up' : 'bep-mom-down') + '">' + (yoy >= 0 ? '+' : '') + yoy.toFixed(1) + '%</div></div>'
              + '</div>';

        html += '<div class="bep-trend-wrap"><div class="bep-trend-title">📊 ' + itemName + ' ' + t('bep.trend.title') + ' (' + data.year + ')</div><div class="bep-bar-chart">';
        for (var i = 0; i < months.length; i++) {
            var v = values[i];
            var h = maxV > 0 ? (v / maxV * 100) : 0;
            var mm = months[i].YYYY_MM.substring(5);
            var isCur = months[i].YYYY_MM === currentYM;
            var barColor = isCur ? '#e74c3c' : color;
            html += '<div class="bep-bar-col">'
                  + '<div class="bep-bar-val">' + fmt(Math.round(v / 1000)) + 'K</div>'
                  + '<div class="bep-bar" style="height:' + h + '%;background:' + barColor + ';"></div>'
                  + '<div class="bep-bar-label">' + mm + '</div>'
                  + '</div>';
        }
        html += '</div></div>';

        html += '<table class="bep-trend-table"><thead><tr><th>' + t('bep.trend.col.ym') + '</th><th>' + t('bep.trend.col.amount') + '</th><th>' + t('bep.trend.col.mom') + '</th></tr></thead><tbody>';
        for (var j = 0; j < months.length; j++) {
            var vv = values[j];
            var mom = j === 0 ? '-' : (values[j-1] > 0 ? ((vv - values[j-1]) / values[j-1] * 100).toFixed(2) + '%' : '-');
            var momClass = mom !== '-' && !isNaN(parseFloat(mom)) ? (parseFloat(mom) >= 0 ? 'bep-mom-up' : 'bep-mom-down') : '';
            html += '<tr><td>' + months[j].YYYY_MM + '</td><td>' + fmt(vv) + '</td><td class="' + momClass + '">' + mom + '</td></tr>';
        }
        html += '</tbody></table>';
        return html;
    }

    function closeItemDetail() {
        var m = document.getElementById('bep_item_modal');
        if (m) m.classList.remove('show');
    }

    window.bepShowItemDetail = showItemDetail;
    window.bepCloseItemDetail = closeItemDetail;
    window.bepSwitchItemTab = switchItemTab;

    // ESC 鍵關閉 — 優先級：先子彈窗，再固定成本彈窗，最後變動成本彈窗
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            var itemModal = document.getElementById('bep_item_modal');
            var fixedModal = document.getElementById('bep_fixed_modal');
            var mainModal = document.getElementById('bep_modal');
            if (itemModal && itemModal.classList.contains('show')) {
                itemModal.classList.remove('show');
            } else if (fixedModal && fixedModal.classList.contains('show')) {
                fixedModal.classList.remove('show');
            } else if (mainModal && mainModal.classList.contains('show')) {
                mainModal.classList.remove('show');
            }
        }
    });

    let _debounce;
    function onInput() {
        clearTimeout(_debounce);
        _debounce = setTimeout(liveCalc, 250);
    }

    registerPage('bep', async function(container) {
        container.innerHTML = getHTML();
        var ids = ['bep_sale_input','bep_consumable','bep_packaging','bep_processing','bep_misc_purchase',
                   'bep_freight','bep_customs','bep_service_part_comp',
                   'bep_variable_expense','bep_fixed_salary','bep_fixed_rent','bep_fixed_interest'];
        ids.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('input', onInput);
        });
        setTimeout(load, 100);
    });
})();
