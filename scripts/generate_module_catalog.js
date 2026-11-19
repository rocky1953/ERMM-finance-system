/**
 * 產生「功能模組清單」HTML（一次性建置腳本）
 * 資料來源：cams_module_permission + 人工撰寫的功能說明
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

// 模組功能說明（依 module_code）
const DESC = {
    dashboard: '高管經營總覽：收入／成本／毛利／現金與預警卡片，支持柱體下鑽至 AR/AP 發票明細',
    actions: 'KPI 異常行動項追蹤，待處理／進行中／已完成三態管理',
    alerts: '預警中心：內置告警規則與告警記錄，支援 Email／Lark／企微推送',
    drilldown: 'KPI 多維穿透，按公司／期間／維度下鑽至單據明細',
    cashForecast: '13 周現金流預測與安全水位，含 Monte Carlo 機率預測（P10/P50/P90）',
    mgmtAccounting: '部門損益與管理會計口徑分析',
    budget: '年度預算編制、明細維護與提交審批留痕',
    consolidation: '多公司（HM/HN/SZ）合併報表與內部抵消',
    aiqa: '自然語言問財務數據：RAG 檢索知識庫 + 預設 LLM 作答（服務商唯讀）',
    scenario: '多情景假設測算，方案可命名保存與回看',
    warRoom: '高管實時經營作戰看板',
    benchmark: '同業標桿指標對標與排名',
    rollingBudget: '12 個月滾動預算，損益／資產負債／現金流三表聯動 + 13 周現金',
    profitAnalysis: '客戶／產品／渠道／項目四維毛利與淨利分析',
    inventoryTurnover: '庫齡結構、周轉率／DSI、呆滯清單下發與補貨建議',
    boardPack: '董事會／投資人報告包：六大區塊生成與 PDF／PPTX 導出',
    projectProfit: '項目概覽／項目損益／年度預算／成本歸集／收入確認五頁籤',
    fxExposure: '外幣敞口測算與避險工具登記',
    taxPlanning: '稅收優惠適用與稅務風險籌劃',
    strategy: '公司→部門→個人三級 BSC 目標、進度記錄與得分對比',
    cashLiquidity: '資金計劃項、流動性缺口與投資／融資安排',
    investment: '投資項目預算與現金流測算',
    taxCompliance: '稅務法規台賬、合規事項與申報任務跟蹤',
    hrEfficiency: '部門編制、人均產值、人工成本率與人效趨勢',

    po: '採購訂單查詢與維護（ermm_erp_po）',
    so: '銷售訂單查詢與維護',
    preorder: '銷售預估訂單，關聯客戶與項目',
    dn: '出貨單（DN）登記與銷售訂單對應',
    tempPo: '採購訂單暫存草稿，確認後轉正式 PO',
    salesCredit: '客戶信用額度、銷售退貨登記與履約風險清單',

    approvals: '通用審批待辦中心，跨業務類型統一處理 APPROVE／REJECT',
    expense: '費用報銷與借支核銷全流程（草稿→提交→審批→付款）',
    payRequest: '付款申請、按月排程、銀行回單登記與 AR/AP 核銷',
    closing: '月結關賬日曆、任務分派與實例跟蹤',
    prRequest: '請購單申請與審批，通過後轉採購',
    poMatch: '採購三單匹配（請購／採購／到貨），差異核對',
    cash: '現金日記賬登記與餘額核對',
    invoice: '銷項／進項發票管理',
    pay: '付款流水明細',
    check: '應收／應付票據管理',
    bank: '銀行貸款本金、利息與還款計劃',
    arMatch: '收款登記與應收發票匹配核銷',
    arap: '應收應付台賬，由 SO／PO 自動產生',
    arSmart: 'AR 智能催收評分（賬齡／逾期／金額／風險），四級燈號排序',
    dataQuality: '全庫 7 大類 20+ 項數據質量體檢（只掃描不自動修復）',
    codeTable: '系統碼表維護：下拉選項、公司別、稅率、匯率',
    dailyReport: '工作日報填報、審核、鎖定與目標對比',
    dailyReportUnfinished: '基於日報明細統計延誤與未完成事項',
    audit: '全量操作審計：查詢、統計、按模塊／用戶分析與導出',
    llmAudit: 'AI 治理駕駛艙：調用審計、成本分析、限流配額、模型計價',

    batch: '批次管線（Step1~Step7）加工與重算控制',
    integration: '第三方資料整合：Excel 導入／SQL 線上／批次作業／數據源／執行日誌',
    system: '系統參數與系統碼配置',
    user: '使用者、部門與角色維護',
    kpi: 'KPI 指標定義、門檻與查詢配置',
    branch: '分公司（HM/HN/SZ）基本資料',
    relation: '客戶／供應商往來單位資料',
    contracts: '合同主檔：關聯 PO/SO，含金額、期限、付款條件與到期預警',
    permission: '功能模塊權限矩陣（81 模塊 × 三角色）與按鈕級權限配置',

    docArchitecture: '系統架構與流程圖（HTML，只讀文檔）',
    docExecutive: '高管價值簡報（HTML，只讀文檔）',
    docDataModel: '系統架構與模塊資料表關係圖（HTML，只讀文檔）',
    docManualCeo: 'CEO 操作手冊（HTML，只讀文檔）',
    docManualCfo: 'CFO 操作手冊（HTML，只讀文檔）',
    docManualCto: 'CTO 操作手冊（HTML，只讀文檔）',
    docManualCoo: 'COO 操作手冊（HTML，只讀文檔）',

    summary: '月度財務摘要：收入／成本／毛利／費用／淨利',
    report: '資產負債表、利潤表、現金流量表',
    risk: '財務風險指標監控與預警',
    forecast: '財務數據預測（WMA + 線性回歸）',
    trend: '年度趨勢圖表',
    monthly: '月度項目匯總',
    bep: '盈虧平衡點測算與門檻維護',
    account: '會計科目與科目餘額',
    finance: '財務入賬／報稅／勾稽（RUID 全鏈路）',
    tax: '電子化報稅：VAT／CIT／IIT 算稅→核對→提交',
    xitems: '料件與存貨日狀態明細',

    yg001: 'KPI 預警指標查詢',
    yg002: 'KPI 指標管理',
    yg003: '報表異常甄別',
    yg004: '預測模型分析'
};

(async () => {
    const [rows] = await pool.query(
        `SELECT module_code, module_name, module_group, allow_general, allow_operator, allow_admin
         FROM cams_module_permission ORDER BY sort_order, module_code`
    );

    const groups = ['仪表板', '经营决策', 'ERP 原始单据', '日常作业', '财务分析', '财务预警', '系统主档', '系统文件'];
    const byGroup = {};
    for (const g of groups) byGroup[g] = [];
    for (const r of rows) (byGroup[r.module_group] || (byGroup[r.module_group] = [])).push(r);

    const cnt = {
        total: rows.length,
        groups: groups.length,
        g: rows.filter(r => r.allow_general).length,
        o: rows.filter(r => r.allow_operator).length,
        a: rows.filter(r => r.allow_admin).length
    };

    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const sectionHtml = groups.map(g => {
        const list = byGroup[g] || [];
        if (!list.length) return '';
        const body = list.map(r => {
            const desc = DESC[r.module_code] || '—';
            const badge = v => v
                ? '<span class="ok" title="允许">✓</span>'
                : '<span class="no" title="无权限">—</span>';
            return `<tr data-code="${esc(r.module_code)}" data-name="${esc(r.module_name)}" data-desc="${esc(desc)}">
                <td class="mname">${esc(r.module_name)}</td>
                <td><code>${esc(r.module_code)}</code></td>
                <td class="mdesc">${esc(desc)}</td>
                <td class="c">${badge(r.allow_general)}</td>
                <td class="c">${badge(r.allow_operator)}</td>
                <td class="c">${badge(r.allow_admin)}</td>
            </tr>`;
        }).join('');
        return `<section class="group" data-group="${esc(g)}">
            <h2>${esc(g)} <span class="count">${list.length} 个模块</span></h2>
            <div class="tw">
                <table>
                    <thead><tr>
                        <th style="width:150px;">模块名称</th>
                        <th style="width:130px;">模块代码</th>
                        <th>功能说明</th>
                        <th style="width:64px;" class="c">一般</th>
                        <th style="width:64px;" class="c">操作员</th>
                        <th style="width:64px;" class="c">管理员</th>
                    </tr></thead>
                    <tbody>${body}</tbody>
                </table>
            </div>
        </section>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ERMM 功能模块清单</title>
<style>
    :root { --navy:#0f2d4a; --blue:#1e5a8a; --accent:#2563eb; --line:#e2e8f0; --muted:#64748b; --bg:#f5f7fa; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:#1f2937;
           font-family:"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",system-ui,sans-serif; line-height:1.6; }
    header { background:linear-gradient(135deg,#0f2d4a,#1e5a8a 60%,#2563eb); color:#fff; padding:28px 32px 22px; }
    header h1 { margin:0 0 6px; font-size:24px; font-weight:700; letter-spacing:.5px; }
    header .sub { font-size:13px; opacity:.85; }
    .stats { display:flex; gap:26px; margin-top:18px; flex-wrap:wrap; }
    .stat { background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.22);
            border-radius:10px; padding:8px 16px; min-width:104px; }
    .stat b { display:block; font-size:20px; line-height:1.2; }
    .stat span { font-size:12px; opacity:.85; }
    .toolbar { position:sticky; top:0; z-index:20; background:#fff; border-bottom:1px solid var(--line);
               padding:12px 32px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
    .toolbar input { flex:1; min-width:220px; max-width:420px; padding:8px 12px; border:1px solid #cbd5e1;
                     border-radius:8px; font-size:13px; }
    .toolbar input:focus { outline:2px solid var(--accent); outline-offset:1px; border-color:var(--accent); }
    .chip { border:1px solid #cbd5e1; background:#fff; color:#334155; border-radius:16px; padding:5px 12px;
            font-size:12px; cursor:pointer; }
    .chip:hover { border-color:var(--accent); color:var(--accent); }
    .chip.active { background:var(--accent); border-color:var(--accent); color:#fff; }
    .hint { font-size:12px; color:var(--muted); margin-left:auto; }
    main { padding:20px 32px 48px; }
    section.group { margin-bottom:22px; }
    section.group h2 { font-size:16px; color:var(--navy); margin:0 0 8px; padding-left:10px;
                       border-left:4px solid var(--accent); }
    .count { font-size:12px; color:var(--muted); font-weight:400; margin-left:6px; }
    .tw { background:#fff; border:1px solid var(--line); border-radius:10px; overflow:auto; }
    table { width:100%; border-collapse:collapse; font-size:13px; min-width:720px; }
    thead th { background:var(--navy); color:#fff; font-weight:600; text-align:left; padding:10px 12px;
               position:sticky; top:0; white-space:nowrap; }
    tbody td { padding:9px 12px; border-top:1px solid #eef2f7; vertical-align:top; }
    tbody tr:nth-child(even) { background:#fbfcfe; }
    tbody tr:hover { background:#f0f7ff; }
    .mname { font-weight:600; color:#0f2d4a; }
    code { background:#eef2f7; color:#334155; padding:1px 6px; border-radius:4px; font-size:12px;
           font-family:Consolas,Monaco,monospace; }
    .mdesc { color:#475569; }
    .c { text-align:center; white-space:nowrap; }
    .ok { color:#15803d; font-weight:700; }
    .no { color:#cbd5e1; }
    .empty { text-align:center; color:var(--muted); padding:40px; background:#fff;
             border:1px dashed #cbd5e1; border-radius:10px; }
    footer { padding:0 32px 32px; font-size:12px; color:var(--muted); }
    @media print {
        body { background:#fff; }
        .toolbar { position:static; }
        .chip, .toolbar input { display:none; }
        section.group { break-inside:avoid; }
        thead th { position:static; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    }
</style>
</head>
<body>
<header>
    <h1>ERMM 财务模块管理系统 · 功能模块清单</h1>
    <div class="sub">共 ${cnt.total} 个功能模块 / ${cnt.groups} 个分组 · 权限矩阵来源 cams_module_permission · 生成日期 ${new Date().toISOString().slice(0, 10)}</div>
    <div class="stats">
        <div class="stat"><b>${cnt.total}</b><span>功能模块</span></div>
        <div class="stat"><b>${cnt.groups}</b><span>功能分组</span></div>
        <div class="stat"><b>${cnt.g}</b><span>一般员工可用</span></div>
        <div class="stat"><b>${cnt.o}</b><span>操作员可用</span></div>
        <div class="stat"><b>${cnt.a}</b><span>管理员可用</span></div>
    </div>
</header>

<div class="toolbar">
    <input type="text" id="kw" placeholder="搜索模块名称 / 代码 / 功能说明…">
    <button class="chip active" data-g="all">全部</button>
    ${groups.map(g => `<button class="chip" data-g="${esc(g)}">${esc(g)}</button>`).join('')}
    <span class="hint" id="hint">显示 ${cnt.total} 个模块</span>
</div>

<main id="list">
${sectionHtml}
<div class="empty" id="empty" style="display:none;">没有符合条件的模块</div>
</main>

<footer>
    说明：✓ = 该角色具备模块访问权限（后端 middleware/moduleGuard.js 据此拦截 API，未授权返回 403 MODULE_DENIED）；— = 无权限。<br>
    模块权限可在「系统主档 → 功能权限」中调整，调整后最多 60 秒生效。
</footer>

<script>
(function () {
    var kw = document.getElementById('kw');
    var chips = Array.prototype.slice.call(document.querySelectorAll('.chip'));
    var sections = Array.prototype.slice.call(document.querySelectorAll('section.group'));
    var hint = document.getElementById('hint');
    var empty = document.getElementById('empty');
    var activeGroup = 'all';

    function apply() {
        var q = (kw.value || '').trim().toLowerCase();
        var shown = 0;
        sections.forEach(function (sec) {
            var group = sec.getAttribute('data-group');
            var groupOk = activeGroup === 'all' || group === activeGroup;
            var rows = sec.querySelectorAll('tbody tr');
            var visible = 0;
            rows.forEach(function (tr) {
                var text = (tr.getAttribute('data-name') + ' ' + tr.getAttribute('data-code') + ' ' + tr.getAttribute('data-desc')).toLowerCase();
                var hit = !q || text.indexOf(q) >= 0;
                var show = groupOk && hit;
                tr.style.display = show ? '' : 'none';
                if (show) visible++;
            });
            sec.style.display = (groupOk && visible > 0) ? '' : 'none';
            shown += visible;
        });
        hint.textContent = '显示 ' + shown + ' 个模块';
        empty.style.display = shown ? 'none' : '';
    }

    kw.addEventListener('input', apply);
    chips.forEach(function (c) {
        c.addEventListener('click', function () {
            chips.forEach(function (x) { x.classList.remove('active'); });
            c.classList.add('active');
            activeGroup = c.getAttribute('data-g');
            apply();
        });
    });
    apply();
})();
</script>
</body>
</html>`;

    const out = path.join(__dirname, '..', 'docs', 'ERMM_功能模組清單.html');
    fs.writeFileSync(out, html, 'utf8');
    console.log(`✔ 已生成 ${out}（${(Buffer.byteLength(html) / 1024).toFixed(1)} KB，${cnt.total} 模块 / ${cnt.groups} 分组）`);
    await pool.end();
})();
