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
            + '<div class="bep-box varCost bep-clickable" onclick="bepShowVarCostDetail()"><div class="lbl">變動成本 <span style="font-size:.7em;color:#888;">(點擊明細)</span></div><div class="val" id="bep_varCost_show">-</div></div>'
            + '<div class="bep-op">=</div>'
            + '<div class="bep-box cm"><div class="lbl">邊際貢獻</div><div class="val" id="bep_cm_show">-</div></div>'
            + '</div>'
            + '<div class="bep-formula" style="grid-template-columns:1fr 40px 1fr 40px 1fr;margin-top:10px;">'
            + '<div class="bep-box mat bep-clickable" onclick="bepShowVarCostDetail()"><div class="lbl">材料 <span style="font-size:.7em;color:#888;">(點擊明細)</span></div><div class="val" id="bep_material_show">-</div></div>'
            + '<div class="bep-op">+</div>'
            + '<div style="padding:14px;border-radius:10px;border:2px solid #f1c40f;background:#fef9e7;">'
            + '<div class="lbl" style="color:#7d6608;">變動費用</div>'
            + '<input type="number" id="bep_variable_expense" class="bep-input-yellow">'
            + '</div>'
            + '<div class="bep-op">=</div>'
            + '<div class="bep-box varCost bep-clickable" onclick="bepShowVarCostDetail()"><div class="lbl">變動成本 <span style="font-size:.7em;color:#888;">(點擊明細)</span></div><div class="val" id="bep_varCost_show2">-</div></div>'
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

            // === 變動成本明細彈窗 ===
            + '<div id="bep_modal" class="bep-modal-overlay" onclick="bepCloseVarCostDetail(event)">'
            + '<div class="bep-modal-card" onclick="event.stopPropagation()">'
            + '<div class="bep-modal-header">'
            + '<span class="bep-modal-title">📊 變動成本明細</span>'
            + '<button class="bep-modal-close" onclick="bepCloseVarCostDetail()">✕</button>'
            + '</div>'
            + '<div class="bep-modal-body" id="bep_varCost_modal_body"></div>'
            + '<div class="bep-modal-footer">'
            + '<button class="bep-btn-close" onclick="bepCloseVarCostDetail()">關閉</button>'
            + '</div>'
            + '</div></div>'

            // === 項目歷史趨勢子彈窗 (z-index 更高) ===
            + '<div id="bep_item_modal" class="bep-modal-overlay" style="z-index:10000;" onclick="bepCloseItemDetail(event)">'
            + '<div class="bep-modal-card" onclick="event.stopPropagation()">'
            + '<div class="bep-modal-header" id="bep_item_modal_header">'
            + '<span class="bep-modal-title" id="bep_item_modal_title">📈 項目趨勢</span>'
            + '<button class="bep-modal-close" onclick="bepCloseItemDetail()">✕</button>'
            + '</div>'
            + '<div class="bep-modal-body" id="bep_item_modal_body"></div>'
            + '<div class="bep-modal-footer">'
            + '<button class="bep-btn-close" onclick="bepCloseItemDetail()">關閉</button>'
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

            // 可點擊卡片樣式
            + '.bep-clickable{cursor:pointer;transition:transform .15s,box-shadow .15s;}'
            + '.bep-clickable:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.15);}'

            // === Modal 彈窗樣式 ===
            + '.bep-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;z-index:9999;align-items:center;justify-content:center;}'
            + '.bep-modal-overlay.show{display:flex;}'
            + '.bep-modal-card{background:#fff;border-radius:12px;width:90%;max-width:620px;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.25);overflow:hidden;}'
            + '.bep-modal-header{display:flex;justify-content:space-between;align-items:center;padding:14px 20px;background:linear-gradient(135deg,#c0392b,#e74c3c);color:#fff;}'
            + '.bep-modal-title{font-size:1.05em;font-weight:700;}'
            + '.bep-modal-close{background:none;border:none;color:#fff;font-size:1.3em;cursor:pointer;padding:0 4px;line-height:1;}'
            + '.bep-modal-close:hover{opacity:.7;}'
            + '.bep-modal-body{padding:16px 20px;overflow-y:auto;flex:1;}'
            + '.bep-modal-footer{padding:12px 20px;border-top:1px solid #eee;text-align:right;background:#fafafa;}'
            + '.bep-btn-close{padding:6px 20px;background:#7f8c8d;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer;}'
            + '.bep-btn-close:hover{background:#5d6d7e;}'

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
    function showVarCostDetail() {
        // 優先用閉包 BEP；若尚未初始化則從 DOM 顯示值解析
        let sale = 0;
        if (BEP && BEP.sale_amt) {
            sale = Number(BEP.sale_amt) || 0;
        } else {
            var el = document.getElementById('bep_sale_show');
            if (el && el.textContent && el.textContent !== '-') {
                sale = Number(el.textContent.replace(/,/g, '')) || 0;
            }
        }
        if (sale <= 0) { UI.toast('請先載入資料', 'warn'); return; }

        const vals = getInputVals();
        const c = compute(sale, vals);

        const materialItems = [
            { name: '消耗品',            key: 'consumable',        color: '#e74c3c' },
            { name: '包裝費',            key: 'packaging',         color: '#3498db' },
            { name: '加工費',            key: 'processing',        color: '#9b59b6' },
            { name: '雜項購置',          key: 'misc_purchase',     color: '#f39c12' },
            { name: '運費',              key: 'freight',           color: '#1abc9c' },
            { name: '進出口費用',        key: 'customs',           color: '#e67e22' },
            { name: '服務零件與賠償',    key: 'service_part_comp', color: '#34495e' }
        ];

        const vb = vals.variable_expense;  // 變動費用
        const matTotal = c.material;       // 材料合計
        const grandTotal = c.variable_cost; // 變動成本總計

        function pctOf(amt, base) {
            if (!base) return '0.00%';
            return (Number(amt) / Number(base) * 100).toFixed(2) + '%';
        }

        // 組裝表格 HTML
        let html = '<div style="margin-bottom:14px;padding:10px 14px;background:#f8f9fa;border-radius:6px;border-left:4px solid #2980b9;">'
                 + '<strong>期間:</strong> ' + (document.getElementById('bepBU').value || 'HM') + ' / ' + (document.getElementById('bepYM').value || '-')
                 + '&nbsp;&nbsp;|&nbsp;&nbsp;'
                 + '<strong>銷售金額:</strong> ' + fmt(sale)
                 + '&nbsp;&nbsp;|&nbsp;&nbsp;'
                 + '<strong>邊際貢獻率:</strong> ' + fmtPct(c.cm_rate)
                 + '</div>';

        html += '<table class="bep-detail-table">'
             + '<thead><tr>'
             + '<th style="width:40%;">項目</th>'
             + '<th>金額 (本幣)</th>'
             + '<th class="pct">佔變動成本%</th>'
             + '<th class="pct">佔銷售額%</th>'
             + '</tr></thead><tbody>';

        // 材料明細（每行可點擊看趨勢）
        for (let i = 0; i < materialItems.length; i++) {
            const it = materialItems[i];
            const amt = vals[it.key];
            html += '<tr class="bep-row-clickable" onclick="bepShowItemDetail(\'' + it.key + '\',\'' + it.name + '\',\'' + it.color + '\')">'
                  + '<td><span class="label-cell"><span class="dot" style="background:' + it.color + ';"></span>' + it.name + '</span></td>'
                  + '<td>' + fmt(amt) + '</td>'
                  + '<td class="pct">' + pctOf(amt, grandTotal) + '</td>'
                  + '<td class="pct">' + pctOf(amt, sale) + '</td>'
                  + '</tr>';
        }

        // 材料合計 row（可點擊）
        html += '<tr class="subtotal bep-row-clickable" onclick="bepShowItemDetail(\'material_sum\',\'材料合計\',\'#7f8c8d\')">'
              + '<td>材料合計</td>'
              + '<td>' + fmt(matTotal) + '</td>'
              + '<td class="pct">' + pctOf(matTotal, grandTotal) + '</td>'
              + '<td class="pct">' + pctOf(matTotal, sale) + '</td>'
              + '</tr>';

        // 變動費用 row（可點擊）
        html += '<tr class="bep-row-clickable" onclick="bepShowItemDetail(\'variable_expense\',\'變動費用\',\'#f1c40f\')">'
              + '<td><span class="label-cell"><span class="dot" style="background:#f1c40f;"></span>變動費用</span></td>'
              + '<td>' + fmt(vb) + '</td>'
              + '<td class="pct">' + pctOf(vb, grandTotal) + '</td>'
              + '<td class="pct">' + pctOf(vb, sale) + '</td>'
              + '</tr>';

        // 分隔
        html += '<tr style="height:6px;"><td colspan="4" style="border:none;"></td></tr>';

        // 變動成本總計（可點擊）
        html += '<tr class="total bep-row-clickable" onclick="bepShowItemDetail(\'variable_cost\',\'變動成本總計\',\'#c0392b\')">'
              + '<td>變動成本總計 (材料 + 變動費用)</td>'
              + '<td>' + fmt(grandTotal) + '</td>'
              + '<td class="pct">100.00%</td>'
              + '<td class="pct">' + pctOf(grandTotal, sale) + '</td>'
              + '</tr>';

        html += '</tbody></table>';

        // 附加公式鏈小提示
        html += '<div style="margin-top:14px;padding:10px 14px;background:#e8daef;border-radius:6px;font-size:.88em;color:#6c3483;">'
              + '<strong>📐 公式鏈:</strong><br>'
              + '變動成本 = 材料合計 (' + fmt(matTotal) + ') + 變動費用 (' + fmt(vb) + ') = <strong>' + fmt(grandTotal) + '</strong><br>'
              + '邊際貢獻 = 銷售金額 (' + fmt(sale) + ') − 變動成本 = <strong>' + fmt(c.contribution_margin) + '</strong><br>'
              + '損益平衡點 = 固定成本 (' + fmt(vals.fixed_cost) + ') ÷ (邊際貢獻率 ' + fmtPct(c.cm_rate) + ') = <strong>' + fmt(c.bep) + '</strong>'
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
        if (title) title.textContent = itemName + ' — 明細資料';

        // loading + tab 結構
        document.getElementById('bep_item_modal_body').innerHTML =
            '<div style="text-align:center;padding:40px;color:#7f8c8d;">載入中...</div>';
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
                '<div style="text-align:center;padding:40px;color:#c0392b;">載入失敗: ' + e.message + '</div>';
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
                 + '<button class="bep-tab-btn ' + (activeTab === 'detail' ? 'active' : '') + '" onclick="bepSwitchItemTab(\'detail\')">📋 交易明細</button>'
                 + '<button class="bep-tab-btn ' + (activeTab === 'trend' ? 'active' : '') + '" onclick="bepSwitchItemTab(\'trend\')">📈 歷史趨勢</button>'
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

        // 映射說明 header
        if (data.no_mapping) {
            html += '<div style="padding:12px 16px;background:#fef9e7;border-radius:6px;border-left:4px solid #f1c40f;margin-bottom:12px;">'
                  + '💡 <strong>' + itemName + '</strong><br>'
                  + '<span style="font-size:.88em;color:#7d6608;">' + data.reason + '</span><br>'
                  + '<span style="font-size:.85em;color:#888;">可用「歷史趨勢」tab 查看年度數值變化</span>'
                  + '</div>';
            return html;
        }

        // 摘要 header
        html += '<div style="padding:12px 16px;background:#f8f9fa;border-radius:6px;margin-bottom:12px;font-size:.9em;">'
              + '<strong>📋 ' + itemName + ' 交易明細</strong>'
              + '<span style="color:#7f8c8d;margin-left:12px;">映射: ' + data.label + '</span><br>'
              + '<span style="font-size:.85em;color:#888;">共 ' + data.summary.count + ' 筆 | '
              + '收入 DR: ' + fmt(data.summary.total_debit) + ' | '
              + '支出 CR: ' + fmt(data.summary.total_credit) + ' | '
              + '累計餘額: ' + fmt(data.summary.final_balance) + '</span>'
              + '</div>';

        if (data.records.length === 0) {
            html += '<div style="text-align:center;padding:30px;color:#7f8c8d;">本月份無相關交易記錄</div>';
            return html;
        }

        // 表格（跟用戶圖片一樣的格式：日期 | 憑證號 | 摘要 | 收入 | 支出 | 餘額）
        html += '<table class="bep-trend-table">'
             + '<thead><tr>'
             + '<th style="width:12%;">日期</th>'
             + '<th style="width:18%;">憑證號</th>'
             + '<th>摘要</th>'
             + '<th style="width:14%;">收入 (DR)</th>'
             + '<th style="width:14%;">支出 (CR)</th>'
             + '<th style="width:14%;">累計餘額</th>'
             + '</tr></thead><tbody>';

        for (var i = 0; i < data.records.length; i++) {
            var r = data.records[i];
            html += '<tr>'
                  + '<td>' + (r.wk_date || '-') + '</td>'
                  + '<td style="font-family:monospace;">' + (r.num_vman || '-') + '</td>'
                  + '<td>' + (r.amt_type || '-') + '</td>'
                  + '<td style="color:#27ae60;">' + (r.debit > 0 ? fmt(r.debit) : '') + '</td>'
                  + '<td style="color:#c0392b;">' + (r.credit > 0 ? fmt(r.credit) : '') + '</td>'
                  + '<td style="font-weight:600;">' + fmt(r.balance) + '</td>'
                  + '</tr>';
        }

        // 合計 row
        html += '<tr style="background:#f8f9fa;font-weight:700;">'
              + '<td colspan="3" style="text-align:right;">合計 (' + data.summary.count + ' 筆)</td>'
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
            return '<div style="text-align:center;padding:30px;color:#7f8c8d;">無 ' + data.year + ' 年歷史資料</div>';
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
                  + '💡 <strong>' + itemName + '</strong> 本年度各月金額相同（固定基準值），無月度波動。</div>';
        }

        html += '<div class="bep-stats-row">'
              + '<div class="bep-stat-card blue"><div class="lbl">全年合計</div><div class="val">' + fmt(sumV) + '</div></div>'
              + '<div class="bep-stat-card orange"><div class="lbl">月平均</div><div class="val">' + fmt(avgV) + '</div></div>'
              + '<div class="bep-stat-card green"><div class="lbl">年度變化</div><div class="val ' + (yoy >= 0 ? 'bep-mom-up' : 'bep-mom-down') + '">' + (yoy >= 0 ? '+' : '') + yoy.toFixed(1) + '%</div></div>'
              + '</div>';

        html += '<div class="bep-trend-wrap"><div class="bep-trend-title">📊 ' + itemName + ' 月度趨勢 (' + data.year + ')</div><div class="bep-bar-chart">';
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

        html += '<table class="bep-trend-table"><thead><tr><th>年月</th><th>金額</th><th>月增減</th></tr></thead><tbody>';
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

    // ESC 鍵關閉 — 優先級：先子彈窗，再父彈窗
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            var itemModal = document.getElementById('bep_item_modal');
            var mainModal = document.getElementById('bep_modal');
            if (itemModal && itemModal.classList.contains('show')) {
                itemModal.classList.remove('show');
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
