/**
 * CTO-05 合同主檔前端頁面
 * 合同列表（篩選 + 統計 + 到期預警）+ 新增/編輯彈窗 + 關聯 PO 查詢
 */
const CT_L = (zh, tw, en) => ({ 'zh-CN': zh, 'zh-TW': tw, en }[I18N.lang] ?? zh);
const CT_TYPE_EN = { '采购':'Purchase','销售':'Sales','服务':'Service','框架协议':'Framework','保密协议':'NDA' };
const ctTypeLabel = (v) => I18N.lang === 'en' ? (CT_TYPE_EN[v] || v) : v;

registerPage('contracts', async (c) => {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h2 style="margin:0;font-size:20px;">📝 ${CT_L('合同主档', '合同主檔', 'Contract Master')}
                <small style="font-size:13px;color:#7f8c8d;font-weight:normal;">${CT_L('采购/销售/服务/框架协议合同管理', '採購/銷售/服務/框架協議合同管理', 'Purchase/Sales/Service/Framework Contract Mgmt')}</small></h2>
            <div>
                <button class="btn btn-primary" onclick="Contracts.openModal()">＋ ${CT_L('新增合同', '新增合同', 'New Contract')}</button>
            </div>
        </div>

        <div id="contractStats" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;"></div>

        <div class="card" style="padding:12px 16px;margin-bottom:16px;">
            <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
                <input type="text" id="qContractNo" placeholder="${CT_L('合同编号', '合同編號', 'Contract No.')}" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;width:160px;">
                <input type="text" id="qPartner" placeholder="${CT_L('合同相对方', '合同相對方', 'Counterparty')}" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;width:180px;">
                <select id="qType" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;">
                    <option value="">${CT_L('全部类型', '全部類型', 'All Types')}</option>
                    <option value="采购">${CT_L('采购', '採購', 'Purchase')}</option>
                    <option value="销售">${CT_L('销售', '銷售', 'Sales')}</option>
                    <option value="服务">${CT_L('服务', '服務', 'Service')}</option>
                    <option value="框架协议">${CT_L('框架协议', '框架協議', 'Framework')}</option>
                    <option value="保密协议">${CT_L('保密协议', '保密協議', 'NDA')}</option>
                </select>
                <select id="qStatus" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;">
                    <option value="">${CT_L('全部状态', '全部狀態', 'All Statuses')}</option>
                    <option value="ACTIVE">${CT_L('有效', '有效', 'Active')}</option>
                    <option value="EXPIRED">${CT_L('已过期', '已過期', 'Expired')}</option>
                    <option value="TERMINATED">${CT_L('已终止', '已終止', 'Terminated')}</option>
                    <option value="DRAFT">${CT_L('草稿', '草稿', 'Draft')}</option>
                </select>
                <button class="btn btn-outline" onclick="Contracts.refresh()">🔍 ${CT_L('查询', '查詢', 'Search')}</button>
                <button class="btn btn-outline" onclick="Contracts.resetFilter()">${CT_L('重置', '重置', 'Reset')}</button>
            </div>
        </div>

        <div class="card" style="overflow:auto;height:calc(100vh - 360px);">
            <div id="contractList" style="min-width:1100px;">${CT_L('载入中...', '載入中...', 'Loading...')}</div>
        </div>

        <div id="contractModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;align-items:center;justify-content:center;">
            <div class="card" style="width:860px;max-height:90vh;overflow:auto;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <h3 style="margin:0;" id="cmTitle">${CT_L('新增合同', '新增合同', 'New Contract')}</h3>
                    <button onclick="Contracts.closeModal()" style="border:none;background:none;font-size:22px;cursor:pointer;">✕</button>
                </div>
                <div id="cmBody"></div>
            </div>
        </div>
    `;

    await Contracts.refresh();
    await Contracts.loadStats();
});

const Contracts = {
    stats: null,
    list: [],
    editingId: null,

    async refresh() {
        const params = new URLSearchParams();
        const bu_no = document.getElementById('globalBU')?.value;
        if (bu_no) params.set('bu_no', bu_no);
        const no = document.getElementById('qContractNo')?.value?.trim();
        if (no) params.set('contract_no', no);
        const pn = document.getElementById('qPartner')?.value?.trim();
        if (pn) params.set('partner_name', pn);
        const tp = document.getElementById('qType')?.value;
        if (tp) params.set('contract_type', tp);
        const st = document.getElementById('qStatus')?.value;
        if (st) params.set('contract_status', st);

        try {
            const res = await API.get(`/api/contracts/?${params.toString()}`);
            this.list = res.data || [];
            this.renderList();
        } catch (e) {
            document.getElementById('contractList').innerHTML = `<p style="color:#e74c3c;padding:16px;">${CT_L('加载失败', '載入失敗', 'Load failed')}: ${e.message}</p>`;
        }
    },

    resetFilter() {
        ['qContractNo','qPartner'].forEach(id => { const el = document.getElementById(id); if (el) el.value=''; });
        ['qType','qStatus'].forEach(id => { const el = document.getElementById(id); if (el) el.value=''; });
        this.refresh();
    },

    renderList() {
        const container = document.getElementById('contractList');
        if (!this.list.length) {
            container.innerHTML = `<p style="padding:32px;text-align:center;color:#7f8c8d;">${CT_L('暂无合同数据', '暫無合同數據', 'No contract data')}</p>`;
            return;
        }

        const rows = this.list.map(r => {
            const statusColor = r.contract_status === 'ACTIVE' ? '#27ae60'
                : r.contract_status === 'EXPIRED' ? '#e67e22'
                : r.contract_status === 'TERMINATED' ? '#e74c3c'
                : '#95a5a6';
            const amount = r.contract_amount ? new Intl.NumberFormat('zh-TW', { style: 'currency', currency: r.currency || 'RMB' }).format(r.contract_amount) : '-';
            const isExpiringSoon = r.contract_status === 'ACTIVE' && r.expire_date
                && new Date(r.expire_date) - new Date() < 90 * 86400000;

            return `<tr>
                <td style="padding:10px;border-bottom:1px solid #ecf0f1;"><b>${r.contract_no}</b></td>
                <td style="padding:10px;border-bottom:1px solid #ecf0f1;">${r.contract_name}</td>
                <td style="padding:10px;border-bottom:1px solid #ecf0f1;"><span style="background:#3498db;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;">${r.bu_no}</span></td>
                <td style="padding:10px;border-bottom:1px solid #ecf0f1;">${ctTypeLabel(r.contract_type)}</td>
                <td style="padding:10px;border-bottom:1px solid #ecf0f1;">${r.partner_name}</td>
                <td style="padding:10px;border-bottom:1px solid #ecf0f1;text-align:right;">${amount}</td>
                <td style="padding:10px;border-bottom:1px solid #ecf0f1;">${r.sign_date || '-'}</td>
                <td style="padding:10px;border-bottom:1px solid #ecf0f1;">
                    ${r.expire_date || '-'}
                    ${isExpiringSoon ? `<span style="color:#e74c3c;font-size:11px;margin-left:4px;">⚠️${CT_L('即将到期', '即將到期', 'Expiring soon')}</span>` : ''}
                </td>
                <td style="padding:10px;border-bottom:1px solid #ecf0f1;">
                    <span style="color:${statusColor};font-weight:600;">${r.contract_status}</span>
                </td>
                <td style="padding:10px;border-bottom:1px solid #ecf0f1;">
                    ${r.po_id ? `<span style="background:#f1c40f;padding:2px 8px;border-radius:4px;font-size:12px;">PO ${r.po_id}</span>` : '-'}
                </td>
                <td style="padding:10px;border-bottom:1px solid #ecf0f1;text-align:right;white-space:nowrap;">
                    <button class="btn btn-outline" style="padding:4px 10px;font-size:12px;" onclick="Contracts.openModal(${r.uid})">${CT_L('编辑', '編輯', 'Edit')}</button>
                    <button class="btn btn-outline" style="padding:4px 10px;font-size:12px;color:#e74c3c;border-color:#e74c3c;" onclick="Contracts.delete(${r.uid},'${r.contract_no}')">${CT_L('删除', '刪除', 'Delete')}</button>
                </td>
            </tr>`;
        }).join('');

        container.innerHTML = `
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead style="background:#f8f9fa;position:sticky;top:0;">
                    <tr>
                        <th style="padding:10px;text-align:left;">${CT_L('合同编号', '合同編號', 'Contract No.')}</th>
                        <th style="padding:10px;text-align:left;">${CT_L('合同名称', '合同名稱', 'Contract Name')}</th>
                        <th style="padding:10px;text-align:left;">${CT_L('公司', '公司', 'Company')}</th>
                        <th style="padding:10px;text-align:left;">${CT_L('类型', '類型', 'Type')}</th>
                        <th style="padding:10px;text-align:left;">${CT_L('相对方', '相對方', 'Counterparty')}</th>
                        <th style="padding:10px;text-align:right;">${CT_L('金额', '金額', 'Amount')}</th>
                        <th style="padding:10px;text-align:left;">${CT_L('签订日', '簽訂日', 'Sign Date')}</th>
                        <th style="padding:10px;text-align:left;">${CT_L('到期日', '到期日', 'Expire Date')}</th>
                        <th style="padding:10px;text-align:left;">${CT_L('状态', '狀態', 'Status')}</th>
                        <th style="padding:10px;text-align:left;">${CT_L('关联单号', '關聯單號', 'Related Doc')}</th>
                        <th style="padding:10px;text-align:right;">${CT_L('操作', '操作', 'Action')}</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            <div style="padding:12px;color:#7f8c8d;font-size:12px;text-align:center;">${CT_L('共', '共', 'Total')} ${this.list.length} ${CT_L('条', '條', 'records')}</div>
        `;
    },

    async loadStats() {
        try {
            const bu_no = document.getElementById('globalBU')?.value;
            const qs = bu_no ? `?bu_no=${bu_no}` : '';
            const res = await API.get(`/api/contracts/stats${qs}`);
            const data = res.data || {};
            const totalByType = {};
            let totalActiveAmount = 0, totalActiveCount = 0;
            (data.breakdown || []).forEach(r => {
                totalByType[r.contract_type] = (totalByType[r.contract_type] || 0) + r.cnt;
                if (r.contract_status === 'ACTIVE') { totalActiveAmount += Number(r.total_amount || 0); totalActiveCount += r.cnt; }
            });
            const cards = [
                { label: CT_L('有效合同数', '有效合同數', 'Active Contracts'), value: totalActiveCount, icon: '📋', color: '#27ae60' },
                { label: CT_L('有效合同总额 (RMB)', '有效合同總額 (RMB)', 'Active Total (RMB)'), value: new Intl.NumberFormat('zh-TW', { notation: 'compact' }).format(totalActiveAmount), icon: '💰', color: '#3498db' },
                { label: CT_L('90天内到期', '90天內到期', 'Expiring in 90d'), value: data.expiring_90d || 0, icon: '⏰', color: '#e67e22' },
                { label: CT_L('采购合同', '採購合同', 'Purchase Contracts'), value: totalByType['采购'] || 0, icon: '🛒', color: '#9b59b6' },
            ];
            document.getElementById('contractStats').innerHTML = cards.map(c => `
                <div class="card" style="padding:16px;display:flex;align-items:center;gap:14px;">
                    <div style="font-size:32px;">${c.icon}</div>
                    <div>
                        <div style="font-size:12px;color:#7f8c8d;">${c.label}</div>
                        <div style="font-size:20px;font-weight:600;color:${c.color};">${c.value}</div>
                    </div>
                </div>
            `).join('');
        } catch (e) { /* stats 失敗不阻塞列表 */ }
    },

    async openModal(uid) {
        this.editingId = uid || null;
        const modal = document.getElementById('contractModal');
        document.getElementById('cmTitle').textContent = uid ? CT_L('编辑合同', '編輯合同', 'Edit Contract') : CT_L('新增合同', '新增合同', 'New Contract');

        let data = {};
        if (uid) {
            try {
                const res = await API.get(`/api/contracts/${uid}`);
                data = res.data;
            } catch (e) { alert(CT_L('加载失败', '載入失敗', 'Load failed') + ': ' + e.message); return; }
        }

        const bu_no = data.bu_no || document.getElementById('globalBU')?.value || '';

        document.getElementById('cmBody').innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div><label>${CT_L('合同编号', '合同編號', 'Contract No.')} *</label><input id="fContractNo" value="${data.contract_no || ''}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;" ${uid ? 'readonly style="background:#f5f5f5;"' : ''}></div>
                <div><label>${CT_L('合同名称', '合同名稱', 'Contract Name')} *</label><input id="fContractName" value="${data.contract_name || ''}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;"></div>
                <div><label>${CT_L('公司', '公司', 'Company')} *</label>
                    <select id="fBuNo" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;">
                        <option value="HM" ${bu_no==='HM'?'selected':''}>HM</option>
                        <option value="HN" ${bu_no==='HN'?'selected':''}>HN</option>
                        <option value="SZ" ${bu_no==='SZ'?'selected':''}>SZ</option>
                    </select>
                </div>
                <div><label>${CT_L('合同类型', '合同類型', 'Contract Type')}</label>
                    <select id="fType" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;">
                        ${['采购','销售','服务','框架协议','保密协议'].map(v=>`<option value="${v}" ${v===data.contract_type?'selected':''}>${CT_L(v, v==='采购'?'採購':v==='销售'?'銷售':v==='服务'?'服務':v==='框架协议'?'框架協議':'保密協議', v==='采购'?'Purchase':v==='销售'?'Sales':v==='服务'?'Service':v==='框架协议'?'Framework':'NDA')}</option>`).join('')}
                    </select>
                </div>
                <div><label>${CT_L('相对方', '相對方', 'Counterparty')} *</label><input id="fPartner" value="${data.partner_name || ''}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;"></div>
                <div><label>${CT_L('相对方类型', '相對方類型', 'Counterparty Type')}</label>
                    <select id="fPartnerType" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;">
                        <option value="SUPPLIER" ${data.partner_type==='SUPPLIER'?'selected':''}>${CT_L('供应商', '供應商', 'Supplier')}</option>
                        <option value="CUSTOMER" ${data.partner_type==='CUSTOMER'?'selected':''}>${CT_L('客户', '客戶', 'Customer')}</option>
                        <option value="OTHER" ${data.partner_type==='OTHER'?'selected':''}>${CT_L('其他', '其他', 'Other')}</option>
                    </select>
                </div>
                <div><label>${CT_L('合同金额', '合同金額', 'Amount')}</label><input id="fAmount" type="number" step="0.01" value="${data.contract_amount ?? ''}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;"></div>
                <div><label>${CT_L('币种', '幣別', 'Currency')}</label>
                    <select id="fCurrency" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;">
                        ${['RMB','TWD','HKD','USD'].map(v=>`<option ${v===(data.currency||'RMB')?'selected':''}>${v}</option>`).join('')}
                    </select>
                </div>
                <div><label>${CT_L('签订日期', '簽訂日期', 'Sign Date')}</label><input id="fSignDate" type="date" value="${data.sign_date || ''}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;"></div>
                <div><label>${CT_L('到期日期', '到期日期', 'Expire Date')}</label><input id="fExpire" type="date" value="${data.expire_date || ''}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;"></div>
                <div><label>${CT_L('合同状态', '合同狀態', 'Status')}</label>
                    <select id="fStatus" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;">
                        ${[['ACTIVE',CT_L('有效','有效','Active')],['EXPIRED',CT_L('已过期','已過期','Expired')],['TERMINATED',CT_L('已终止','已終止','Terminated')],['DRAFT',CT_L('草稿','草稿','Draft')]].map(([v,l])=>`<option value="${v}" ${v===data.contract_status?'selected':''}>${l}</option>`).join('')}
                    </select>
                </div>
                <div><label>${CT_L('关联 PO 编号', '關聯 PO 編號', 'Related PO No.')}</label>
                    <div style="display:flex;gap:6px;">
                        <input id="fPoId" value="${data.po_id || ''}" placeholder="PO-xxxx" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:6px;">
                        <button type="button" onclick="Contracts.openPoPicker()" class="btn btn-outline" style="padding:6px 10px;">${CT_L('选择 PO', '選 PO', 'Pick PO')}</button>
                    </div>
                </div>
            </div>
            <div style="margin-top:12px;">
                <label>${CT_L('备注', '備註', 'Remark')}</label>
                <textarea id="fRemark" rows="2" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;">${data.remark || ''}</textarea>
            </div>
            <div style="margin-top:16px;display:flex;justify-content:flex-end;gap:10px;">
                <button class="btn btn-outline" onclick="Contracts.closeModal()">${CT_L('取消', '取消', 'Cancel')}</button>
                <button class="btn btn-primary" onclick="Contracts.save()">${CT_L('保存', '保存', 'Save')}</button>
            </div>
        `;

        modal.style.display = 'flex';
    },

    closeModal() {
        document.getElementById('contractModal').style.display = 'none';
    },

    async save() {
        const get = id => document.getElementById(id)?.value?.trim();
        const body = {
            contract_no: get('fContractNo'),
            contract_name: get('fContractName'),
            bu_no: get('fBuNo'),
            contract_type: get('fType'),
            partner_name: get('fPartner'),
            partner_type: get('fPartnerType'),
            contract_amount: get('fAmount') ? Number(get('fAmount')) : null,
            currency: get('fCurrency'),
            sign_date: get('fSignDate') || null,
            expire_date: get('fExpire') || null,
            contract_status: get('fStatus'),
            po_id: get('fPoId') || null,
            remark: get('fRemark'),
        };

        try {
            if (this.editingId) {
                await API.put(`/api/contracts/${this.editingId}`, body);
            } else {
                await API.post('/api/contracts/', body);
            }
            alert(CT_L('保存成功 ✓', '保存成功 ✓', 'Saved ✓'));
            this.closeModal();
            await Promise.all([this.refresh(), this.loadStats()]);
        } catch (e) {
            alert(CT_L('保存失败', '保存失敗', 'Save failed') + ': ' + e.message);
        }
    },

    async delete(uid, contractNo) {
        if (!confirm(`${CT_L('确定删除合同', '確定刪除合同', 'Delete contract')} ${contractNo}? ${CT_L('（逻辑删除）', '（邏輯刪除）', '(logical delete)')}`)) return;
        try {
            await API.delete(`/api/contracts/${uid}`);
            await Promise.all([this.refresh(), this.loadStats()]);
        } catch (e) { alert(CT_L('删除失败', '刪除失敗', 'Delete failed') + ': ' + e.message); }
    },

    async openPoPicker() {
        const bu_no = document.getElementById('fBuNo')?.value;
        const keyword = prompt(CT_L('输入 PO 编号或供应商名称（可选）', '輸入 PO 編號或供應商名稱（可選）', 'Enter PO No. or supplier name (optional)')) || '';
        try {
            const qs = new URLSearchParams();
            if (bu_no) qs.set('bu_no', bu_no);
            if (keyword) qs.set('keyword', keyword);
            const res = await API.get(`/api/contracts/po-options?${qs.toString()}`);
            const list = res.data || [];
            if (!list.length) { alert(CT_L('没有符合的 PO', '沒有符合的 PO', 'No matching PO')); return; }
            const msg = list.map((p, i) => `${i+1}. ${p.po_id} | ${p.supplier_name} | ${p.po_amount} ${p.po_date} | ${p.xitems?.substring(0,30) || ''}`).join('\n');
            const sel = prompt(`${CT_L('选择 PO：', '選 PO：', 'Pick PO:')}\n${msg}\n\n${CT_L('输入序号', '輸入序號', 'Enter index')} (1-${list.length}):`);
            const idx = Number(sel) - 1;
            if (idx >= 0 && idx < list.length) {
                document.getElementById('fPoId').value = list[idx].po_id;
            }
        } catch (e) { alert(CT_L('加载失败', '載入失敗', 'Load failed') + ': ' + e.message); }
    },
};
