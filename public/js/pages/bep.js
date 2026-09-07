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

    function getInputVals() {
        return {
            consumable:        Number(document.getElementById('bep_consumable').value) || 0,
            packaging:         Number(document.getElementById('bep_packaging').value) || 0,
            processing:        Number(document.getElementById('bep_processing').value) || 0,
            misc_purchase:     Number(document.getElementById('bep_misc_purchase').value) || 0,
            freight:           Number(document.getElementById('bep_freight').value) || 0,
            customs:           Number(document.getElementById('bep_customs').value) || 0,
            service_part_comp: Number(document.getElementById('bep_service_part_comp').value) || 0,
            variable_expense:  Number(document.getElementById('bep_variable_expense').value) || 0,
            fixed_cost:        Number(document.getElementById('bep_fixed_cost').value) || 0
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
        document.getElementById('bep_sale_show').textContent       = fmt(sale);
        document.getElementById('bep_sale_show2').textContent      = fmt(sale);

        const gapEl = document.getElementById('bep_gap_show');
        gapEl.textContent = fmt(c.gap);
        gapEl.style.color = c.gap >= 0 ? '#27ae60' : '#c0392b';
        const arrow = document.getElementById('bep_gap_arrow');
        if (arrow) {
            if (c.gap >= 0) { arrow.textContent = ' 已達平衡'; arrow.style.color = '#27ae60'; }
            else { arrow.textContent = ' 不足訂單'; arrow.style.color = '#c0392b'; }
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
        document.getElementById('bep_fixed_cost').value         = d.fixed_cost || 0;
    }

    async function load() {
        const bu = document.getElementById('bepBU').value || State.bu_no || 'HM';
        const ym = document.getElementById('bepYM').value;
        if (!ym) { UI.toast('請先選擇年月', 'warn'); return; }
        State.bu_no = bu;
        try {
            const r = await fetch('/api/bep/query?bu_no=' + bu + '&YYYY_MM=' + ym);
            const j = await r.json();
            if (!j.success) { UI.toast(j.message, 'error'); return; }
            BEP = j.data;
            fillInputs(BEP);
            showCalc(BEP.sale_amt, getInputVals());
        } catch (e) { UI.toast('載入失敗: ' + e.message, 'error'); }
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
            fixed_cost: v.fixed_cost,
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
            showCalc(BEP.sale_amt, getInputVals());
            UI.toast('已保存', 'success');
        } catch (e) { UI.toast('保存失敗: ' + e.message, 'error'); }
    }

    function liveCalc() {
        if (!BEP) return;
        showCalc(Number(BEP.sale_amt) || 0, getInputVals());
    }

    function getHTML() {
        const today = new Date();
        const defYM = today.getFullYear() + '/' + String(today.getMonth() + 1).padStart(2, '0');
        return '<div class="bep-wrap">'
            + '<div class="bep-toolbar">'
            + '<label>公司別:</label>'
            + '<select id="bepBU"><option value="HM">HM</option><option value="SZ">SZ</option><option value="HN">HN</option></select>'
            + '<label>年/月:</label>'
            + '<input type="text" id="bepYM" placeholder="YYYY/MM" value="' + defYM + '">'
            + '<button class="btn-refresh" onclick="bepLoad()">載入</button>'
            + '<button class="btn-live" onclick="bepLiveCalc()">即時重算</button>'
            + '<button class="btn-save" onclick="bepSave()">保存門檻</button>'
            + '</div>'

            + '<div class="bep-container">'

            + '<div class="bep-card"><h3>1. 邊際貢獻 = 銷售金額 - 變動成本</h3>'
            + '<div class="bep-formula" style="grid-template-columns:1fr 40px 1fr 40px 1fr;">'
            + '<div class="bep-box sale"><div class="lbl">銷售金額</div><div class="val" id="bep_sale_show">-</div></div>'
            + '<div class="bep-op">-</div>'
            + '<div class="bep-box varCost"><div class="lbl">變動成本</div><div class="val" id="bep_varCost_show">-</div></div>'
            + '<div class="bep-op">=</div>'
            + '<div class="bep-box cm"><div class="lbl">邊際貢獻</div><div class="val" id="bep_cm_show">-</div></div>'
            + '</div>'
            + '<div class="bep-formula" style="grid-template-columns:1fr 40px 1fr 40px 1fr;margin-top:10px;">'
            + '<div class="bep-box mat"><div class="lbl">材料</div><div class="val" id="bep_material_show">-</div></div>'
            + '<div class="bep-op">+</div>'
            + '<div style="padding:14px;border-radius:10px;border:2px solid #f1c40f;background:#fef9e7;">'
            + '<div class="lbl" style="color:#7d6608;">變動費用</div>'
            + '<input type="number" id="bep_variable_expense" class="bep-input-yellow">'
            + '</div>'
            + '<div class="bep-op">=</div>'
            + '<div class="bep-box varCost"><div class="lbl">變動成本</div><div class="val" id="bep_varCost_show2">-</div></div>'
            + '</div>'
            + '</div>'

            + '<div class="bep-card"><h3>2. 損益平衡點 = 固定成本 / 邊際貢獻率</h3>'
            + '<div class="bep-formula" style="grid-template-columns:1fr 40px 1fr 40px 1fr;">'
            + '<div style="padding:14px;border-radius:10px;border:2px solid #8e44ad;background:#e8daef;">'
            + '<div class="lbl" style="color:#6c3483;">固定成本</div>'
            + '<input type="number" id="bep_fixed_cost" class="bep-input-purple">'
            + '</div>'
            + '<div class="bep-op">/</div>'
            + '<div class="bep-box cmRate"><div class="lbl">邊際貢獻率</div><div class="val" id="bep_cmRate_show">-</div></div>'
            + '<div class="bep-op">=</div>'
            + '<div class="bep-box bep"><div class="lbl">損益平衡點</div><div class="val" id="bep_bep_show">-</div></div>'
            + '</div>'
            + '<div class="bep-gap-note">'
            + '不足訂單金額: <span id="bep_gap_show" class="amt" style="color:#c0392b;">-</span>'
            + '<span id="bep_gap_arrow"></span>'
            + '</div>'
            + '</div>'

            + '<div class="bep-card"><h3>3. 邊際貢獻率 = 邊際貢獻 / 銷售金額</h3>'
            + '<div class="bep-formula" style="grid-template-columns:1fr 40px 1fr 40px 1fr;">'
            + '<div class="bep-box cm"><div class="lbl">邊際貢獻</div><div class="val" id="bep_cm_show2">-</div></div>'
            + '<div class="bep-op">/</div>'
            + '<div class="bep-box sale"><div class="lbl">銷售金額</div><div class="val" id="bep_sale_show2">-</div></div>'
            + '<div class="bep-op">=</div>'
            + '<div class="bep-box cmRate"><div class="lbl">邊際貢獻率</div><div class="val" id="bep_cmRate_show2">-</div></div>'
            + '</div>'
            + '</div>'

            + '<div class="bep-card"><h3>4. 材料明細（黃色可編輯）</h3>'
            + '<div class="bep-edit">'
            + '<div class="field"><label>消耗品</label><input type="number" id="bep_consumable"></div>'
            + '<div class="field"><label>包裝費</label><input type="number" id="bep_packaging"></div>'
            + '<div class="field"><label>加工費</label><input type="number" id="bep_processing"></div>'
            + '<div class="field"><label>雜項購置</label><input type="number" id="bep_misc_purchase"></div>'
            + '<div class="field"><label>運費</label><input type="number" id="bep_freight"></div>'
            + '<div class="field"><label>進出口費用</label><input type="number" id="bep_customs"></div>'
            + '<div class="field"><label>服務零件與賠償</label><input type="number" id="bep_service_part_comp"></div>'
            + '<div class="field blue"><label>材料自動合計</label><div id="bep_material_field" style="font-weight:700;color:#1a5276;padding:6px 0;">-</div></div>'
            + '<div class="field" style="grid-column:span 2;"><label>備註</label><input type="text" id="bep_remark"></div>'
            + '</div>'
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
            + '.bep-input-purple{border:1px solid #8e44ad;background:#fff;color:#6c3483;}'
            + '.bep-input-yellow{border:1px solid #f4d03f;background:#fffef9;color:#7d6608;}'
            + '.bep-gap-note{text-align:right;margin-top:10px;font-size:0.9em;}'
            + '.bep-gap-note .amt{font-size:1.2em;font-weight:700;}'
            + '</style>';
    }

    window.bepLoad = load;
    window.bepSave = save;
    window.bepLiveCalc = liveCalc;

    let _debounce;
    function onInput() {
        clearTimeout(_debounce);
        _debounce = setTimeout(liveCalc, 250);
    }

    registerPage('bep', async function(container) {
        container.innerHTML = getHTML();
        var ids = ['bep_consumable','bep_packaging','bep_processing','bep_misc_purchase',
                   'bep_freight','bep_customs','bep_service_part_comp',
                   'bep_variable_expense','bep_fixed_cost'];
        ids.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('input', onInput);
        });
        setTimeout(load, 100);
    });
})();
