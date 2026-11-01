/**
 * ERMM 系统架构图
 * 点击左侧「ERMM」标志打开；纯 SVG 渲染，无外部依赖。
 * 支持简体中文 / 繁体中文 / 英文切换，卡片可点击跳转到对应模块。
 */
const SystemMap = (() => {
    const W = 1280;
    const H = 870;
    const CARD_H = 72;
    const GAP = 16;
    const TOP = 66;
    const FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif";
    const NUMERALS = ['①', '②', '③', '④', '⑤'];

    const LANGS = [
        { code: 'zh-CN', label: '简体中文' },
        { code: 'zh-TW', label: '繁體中文' },
        { code: 'en', label: 'English' },
    ];

    const TEXT = {
        'zh-CN': {
            title: 'ERMM 系统架构图',
            langLabel: '语言',
            flow: ['数据接入', 'ERP 原始单据', '结算与资金', '核算与税务', '报表与决策'],
            hint: '点击模块卡片可跳转；实线为数据流，虚线为主档 / 配置支撑。',
            download: '下载 SVG',
            close: '关闭',
            supportTitle: '支撑层',
            clickOpen: '（点击打开）',
            lanes: {
                ingest: '数据接入', doc: 'ERP 原始单据', settle: '结算与资金',
                gl: '核算与税务', bi: '报表与决策',
            },
            nodes: {
                extErp: ['第三方 ERP', '接单 / 采购 / 制造资料'],
                excel: ['Excel 导入', '双语表头 · 13 张资料表'],
                sql: ['SQL 线上整合', '数据源 · 定时任务 · 别名映射'],
                batch: ['批次管线', 'Step1~Step7 加工与重算'],
                ingestCheck: ['导入校验', '必填 · 唯一键 · 错误日志'],
                po: ['采购订单 PO', 'PO 暂存 → 正式 PO'],
                so: ['销售订单 SO', 'SO 交货单 DN'],
                mo: ['制造工单 MO', '用料 / 工艺 / 报工 / 生产明细'],
                inv: ['在途与库存', '在途价格 · 每日库存状态'],
                masterRef: ['主档引用', '客户 · 供应商 · 物料'],
                arap: ['应收应付 ARAP', '客户应收 · 供应商应付'],
                invoice: ['发票管理', '销项 / 进项 · 对账'],
                pay: ['付款明细', '付款申请与核销'],
                check: ['票据管理', '应收 / 应付票据'],
                bank: ['银行贷款', '额度 · 利息 · 还款'],
                cash: ['现金日记账', '资金收支流水'],
                finance: ['财务入账 / 总账', '凭证 · 科目 · 月结'],
                tax: ['电子化报税', '增值税 / 企业所得税 / 个税'],
                xitems: ['库存减值', '库龄 · 减值率 · 现值'],
                mgmt: ['管理会计', '成本 · 部门 · 项目核算'],
                summary: ['财务摘要', '收入 · 成本 · 利润 · 现金流'],
                report: ['三大报表', '资产负债表 / 利润表 / 现金流量表'],
                consolidation: ['合并报表', '分公司 / 关系人抵销'],
                budget: ['预算与预测', '预算编制 · 财务预测 · 现金预测'],
                kpi: ['风险与 KPI', '预警指标 · 门槛 · 异常甄别'],
                drill: ['多维下钻', '行动追踪 · 预警通知'],
                ai: ['AI 问答 / 情景模拟', '自然语言查询 · What-if'],
            },
            support: {
                master: ['主档管理', '往来对象 · 分公司 · KPI 门槛'],
                system: ['系统管理', '使用者 · 系统设定 · 数据源 · 执行日志'],
            },
            labels: {
                '订单': '订单', 'Excel': 'Excel', 'SQL': 'SQL', 'Step1~7': 'Step1~7',
                '校验': '校验', '应付': '应付', '应收': '应收', '成本': '成本',
                '减值': '减值', '总账': '总账', '资金': '资金', '税额': '税额',
                '汇总': '汇总', '报表': '报表', '合并': '合并', 'KPI': 'KPI',
                '下钻': '下钻', '投产': '投产', '入库': '入库', '对账': '对账',
                '付款': '付款', '预警': '预警', '模拟': '模拟',
            },
        },

        'zh-TW': {
            title: 'ERMM 系統架構圖',
            langLabel: '語言',
            flow: ['資料接入', 'ERP 原始單據', '結算與資金', '核算與稅務', '報表與決策'],
            hint: '點擊模組卡片可跳轉；實線為資料流，虛線為主檔 / 設定支撐。',
            download: '下載 SVG',
            close: '關閉',
            supportTitle: '支撐層',
            clickOpen: '（點擊開啟）',
            lanes: {
                ingest: '資料接入', doc: 'ERP 原始單據', settle: '結算與資金',
                gl: '核算與稅務', bi: '報表與決策',
            },
            nodes: {
                extErp: ['第三方 ERP', '接單 / 採購 / 製造資料'],
                excel: ['Excel 匯入', '雙語表頭 · 13 張資料表'],
                sql: ['SQL 線上整合', '資料源 · 定時任務 · 別名映射'],
                batch: ['批次管線', 'Step1~Step7 加工與重算'],
                ingestCheck: ['匯入校驗', '必填 · 唯一鍵 · 錯誤日誌'],
                po: ['採購訂單 PO', 'PO 暫存 → 正式 PO'],
                so: ['銷售訂單 SO', 'SO 交貨單 DN'],
                mo: ['製造工單 MO', '用料 / 工藝 / 報工 / 生產明細'],
                inv: ['在途與庫存', '在途價格 · 每日庫存狀態'],
                masterRef: ['主檔引用', '客戶 · 供應商 · 物料'],
                arap: ['應收應付 ARAP', '客戶應收 · 供應商應付'],
                invoice: ['發票管理', '銷項 / 進項 · 對帳'],
                pay: ['付款明細', '付款申請與核銷'],
                check: ['票據管理', '應收 / 應付票據'],
                bank: ['銀行貸款', '額度 · 利息 · 還款'],
                cash: ['現金日記帳', '資金收支流水'],
                finance: ['財務入帳 / 總帳', '憑證 · 科目 · 月結'],
                tax: ['電子化報稅', '增值稅 / 企業所得稅 / 個稅'],
                xitems: ['庫存減值', '庫齡 · 減值率 · 現值'],
                mgmt: ['管理會計', '成本 · 部門 · 專案核算'],
                summary: ['財務摘要', '收入 · 成本 · 利潤 · 現金流'],
                report: ['三大報表', '資產負債表 / 損益表 / 現金流量表'],
                consolidation: ['合併報表', '分公司 / 關係人抵銷'],
                budget: ['預算與預測', '預算編製 · 財務預測 · 現金預測'],
                kpi: ['風險與 KPI', '預警指標 · 門檻 · 異常甄別'],
                drill: ['多維下鑽', '行動追蹤 · 預警通知'],
                ai: ['AI 問答 / 情景模擬', '自然語言查詢 · What-if'],
            },
            support: {
                master: ['主檔管理', '往來對象 · 分公司 · KPI 門檻'],
                system: ['系統管理', '使用者 · 系統設定 · 資料源 · 執行日誌'],
            },
            labels: {
                '订单': '訂單', 'Excel': 'Excel', 'SQL': 'SQL', 'Step1~7': 'Step1~7',
                '校验': '校驗', '应付': '應付', '应收': '應收', '成本': '成本',
                '减值': '減值', '总账': '總帳', '资金': '資金', '税额': '稅額',
                '汇总': '彙總', '报表': '報表', '合并': '合併', 'KPI': 'KPI',
                '下钻': '下鑽', '投产': '投產', '入库': '入庫', '对账': '對帳',
                '付款': '付款', '预警': '預警', '模拟': '模擬',
            },
        },

        'en': {
            title: 'ERMM System Architecture',
            langLabel: 'Language',
            flow: ['Data Ingest', 'ERP Documents', 'Settlement & Treasury', 'Accounting & Tax', 'Reporting & Decisions'],
            hint: 'Click a module card to open it; solid lines are data flows, dashed lines are master data / configuration support.',
            download: 'Download SVG',
            close: 'Close',
            supportTitle: 'Support Layer',
            clickOpen: ' (click to open)',
            lanes: {
                ingest: 'Data Ingest', doc: 'ERP Documents', settle: 'Settlement & Treasury',
                gl: 'Accounting & Tax', bi: 'Reporting & Decisions',
            },
            nodes: {
                extErp: ['Third-party ERP', 'Sales / Purchase / Mfg'],
                excel: ['Excel Import', 'Bilingual headers · 13 tables'],
                sql: ['SQL Integration', 'Sources · Jobs · Alias mapping'],
                batch: ['Batch Pipeline', 'Step1–7 processing'],
                ingestCheck: ['Import Validation', 'Required · Unique keys · Errors'],
                po: ['Purchase Order (PO)', 'PO staging → Official PO'],
                so: ['Sales Order (SO)', 'SO · Delivery Note (DN)'],
                mo: ['Manufacturing Order', 'MO · Components · Routing · Reporting'],
                inv: ['In-Transit & Inventory', 'Transit price · Daily stock'],
                masterRef: ['Master Data Ref.', 'Customer · Supplier · Item'],
                arap: ['AR / AP', 'Customer AR · Supplier AP'],
                invoice: ['Invoice Management', 'Output / Input · Reconciliation'],
                pay: ['Payment Details', 'Payment requests & write-off'],
                check: ['Notes Management', 'AR / AP notes'],
                bank: ['Bank Loans', 'Limits · Interest · Repayment'],
                cash: ['Cash Journal', 'Cash receipts & payments'],
                finance: ['GL Posting / Ledger', 'Vouchers · Accounts · Month-end'],
                tax: ['E-Tax Filing', 'VAT / CIT / IIT'],
                xitems: ['Inventory Impairment', 'Ageing · Rate · Current value'],
                mgmt: ['Management Accounting', 'Cost · Department · Project'],
                summary: ['Financial Summary', 'Revenue · Cost · Profit · Cash'],
                report: ['Three Statements', 'Balance Sheet / P&L / Cash Flow'],
                consolidation: ['Consolidated Statements', 'Branches / Intercompany elimination'],
                budget: ['Budget & Forecast', 'Budgeting · Forecast · Cash forecast'],
                kpi: ['Risk & KPI', 'Alerts · Thresholds · Anomaly'],
                drill: ['Drill-down', 'Action tracking · Alerts'],
                ai: ['AI Q&A / Simulation', 'Natural language · What-if'],
            },
            support: {
                master: ['Master Data', 'Partners · Branches · KPI thresholds'],
                system: ['System Administration', 'Users · Settings · Sources · Logs'],
            },
            labels: {
                '订单': 'Order', 'Excel': 'Excel', 'SQL': 'SQL', 'Step1~7': 'Step1–7',
                '校验': 'Validate', '应付': 'AP', '应收': 'AR', '成本': 'Cost',
                '减值': 'Impair', '总账': 'GL', '资金': 'Cash', '税额': 'VAT',
                '汇总': 'Summary', '报表': 'Report', '合并': 'Consol.', 'KPI': 'KPI',
                '下钻': 'Drill', '投产': 'Produce', '入库': 'Receipt', '对账': 'Recon.',
                '付款': 'Payment', '预警': 'Alert', '模拟': 'Sim.',
            },
        },
    };

    const LANES = [
        { id: 'ingest', color: '#8e44ad', x: 20, w: 210, y: 20, h: 710 },
        { id: 'doc', color: '#1e8449', x: 250, w: 210, y: 20, h: 710 },
        { id: 'settle', color: '#d35400', x: 480, w: 210, y: 20, h: 710 },
        { id: 'gl', color: '#2874a6', x: 710, w: 210, y: 20, h: 710 },
        { id: 'bi', color: '#c0392b', x: 940, w: 320, y: 20, h: 710 },
    ];

    const NODES = [
        { id: 'extErp', lane: 'ingest', row: 0, icon: '🏭', page: 'integration' },
        { id: 'excel', lane: 'ingest', row: 1, icon: '📥', page: 'integration' },
        { id: 'sql', lane: 'ingest', row: 2, icon: '🔌', page: 'integration' },
        { id: 'batch', lane: 'ingest', row: 3, icon: '⚙️', page: 'batch' },
        { id: 'ingestCheck', lane: 'ingest', row: 4, icon: '🧪', page: 'integration' },

        { id: 'po', lane: 'doc', row: 0, icon: '🛒', page: 'po' },
        { id: 'so', lane: 'doc', row: 1, icon: '📦', page: 'so' },
        { id: 'mo', lane: 'doc', row: 2, icon: '🏭', page: '' },
        { id: 'inv', lane: 'doc', row: 3, icon: '🚚', page: 'xitems' },
        { id: 'masterRef', lane: 'doc', row: 4, icon: '👥', page: 'relation' },

        { id: 'arap', lane: 'settle', row: 0, icon: '📐', page: 'arap' },
        { id: 'invoice', lane: 'settle', row: 1, icon: '🧾', page: 'invoice' },
        { id: 'pay', lane: 'settle', row: 2, icon: '💳', page: 'pay' },
        { id: 'check', lane: 'settle', row: 3, icon: '📝', page: 'check' },
        { id: 'bank', lane: 'settle', row: 4, icon: '🏦', page: 'bank' },
        { id: 'cash', lane: 'settle', row: 5, icon: '💵', page: 'cash' },

        { id: 'finance', lane: 'gl', row: 0, icon: '📒', page: 'finance' },
        { id: 'tax', lane: 'gl', row: 1, icon: '🧮', page: 'tax' },
        { id: 'xitems', lane: 'gl', row: 2, icon: '📦', page: 'xitems' },
        { id: 'mgmt', lane: 'gl', row: 3, icon: '🏢', page: 'mgmtAccounting' },

        { id: 'summary', lane: 'bi', row: 0, icon: '📋', page: 'summary' },
        { id: 'report', lane: 'bi', row: 1, icon: '📈', page: 'report' },
        { id: 'consolidation', lane: 'bi', row: 2, icon: '📋', page: 'consolidation' },
        { id: 'budget', lane: 'bi', row: 3, icon: '📊', page: 'budget' },
        { id: 'kpi', lane: 'bi', row: 4, icon: '⚠️', page: 'risk' },
        { id: 'drill', lane: 'bi', row: 5, icon: '🔍', page: 'drilldown' },
        { id: 'ai', lane: 'bi', row: 6, icon: '🤖', page: 'aiqa' },
    ];

    const EDGES = [
        // 数据接入 → 原始单据
        { from: 'extErp', to: 'po', label: '订单' },
        { from: 'excel', to: 'so', label: 'Excel' },
        { from: 'sql', to: 'mo', label: 'SQL' },
        { from: 'batch', to: 'inv', label: 'Step1~7' },
        { from: 'ingestCheck', to: 'masterRef', label: '校验' },

        // 原始单据 → 结算 / 核算
        { from: 'po', to: 'arap', label: '应付' },
        { from: 'so', to: 'arap', label: '应收' },
        { from: 'mo', to: 'mgmt', label: '成本', busY: 690 },
        { from: 'inv', to: 'xitems', label: '减值', busY: 722 },

        // 结算 → 核算
        { from: 'arap', to: 'finance', label: '总账' },
        { from: 'cash', to: 'finance', label: '资金' },
        { from: 'invoice', to: 'tax', label: '税额' },

        // 核算 → 报表
        { from: 'finance', to: 'summary', label: '汇总' },
        { from: 'finance', to: 'report', label: '报表' },
        { from: 'report', to: 'consolidation', label: '合并', internal: true },
        { from: 'summary', to: 'kpi', label: 'KPI', internal: true },
        { from: 'report', to: 'drill', label: '下钻', internal: true },

        // 单据内部关联
        { from: 'so', to: 'mo', label: '投产', internal: true, showLabel: true },
        { from: 'po', to: 'inv', label: '入库', internal: true, showLabel: true },

        // 结算内部关联
        { from: 'arap', to: 'invoice', label: '对账', internal: true, showLabel: true },
        { from: 'arap', to: 'pay', label: '付款', internal: true },
        { from: 'pay', to: 'cash' },
        { from: 'check', to: 'cash' },
        { from: 'bank', to: 'cash' },

        // 核算 / 决策内部关联
        { from: 'xitems', to: 'finance', label: '减值', internal: true },
        { from: 'kpi', to: 'drill', label: '预警', internal: true },
        { from: 'budget', to: 'ai', label: '模拟', internal: true },

        // 主档 / 系统支撑（虚线）
        { from: 'master', to: 'po', dashed: true },
        { from: 'master', to: 'arap', dashed: true },
        { from: 'system', to: 'batch', dashed: true },
    ];

    const laneById = Object.fromEntries(LANES.map(l => [l.id, l]));
    const nodeById = {};
    for (const n of NODES) {
        const lane = laneById[n.lane];
        nodeById[n.id] = {
            ...n,
            x: lane.x + 12,
            y: lane.y + TOP - 20 + n.row * (CARD_H + GAP),
            w: lane.w - 24,
            h: CARD_H,
            color: lane.color,
            laneId: lane.id,
        };
    }

    function currentLang() {
        const l = (typeof I18N !== 'undefined' && I18N.lang) || 'zh-CN';
        return TEXT[l] ? l : 'zh-CN';
    }

    function dict() {
        return TEXT[currentLang()];
    }

    function esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // 中文：依「·」分段，过长时硬切
    function wrapSub(text, max) {
        const segs = String(text).split('·').map(s => s.trim()).filter(Boolean);
        const lines = [];
        let cur = '';
        for (const seg of segs) {
            const add = cur ? ` · ${seg}` : seg;
            if ((cur + add).length <= max) {
                cur += add;
            } else {
                if (cur) lines.push(cur);
                cur = seg;
            }
            while (cur.length > max) {
                lines.push(cur.slice(0, max));
                cur = cur.slice(max);
            }
        }
        if (cur) lines.push(cur);
        return lines.slice(0, 2);
    }

    // 英文：依空白断词
    function wrapWords(text, max) {
        const words = String(text).split(/\s+/).filter(Boolean);
        const lines = [];
        let cur = '';
        for (const word of words) {
            const add = cur ? ` ${word}` : word;
            if ((cur + add).length <= max) {
                cur += add;
            } else {
                if (cur) lines.push(cur);
                cur = word;
            }
            while (cur.length > max) {
                lines.push(cur.slice(0, max));
                cur = cur.slice(max);
            }
        }
        if (cur) lines.push(cur);
        return lines.slice(0, 2);
    }

    function renderNode(n) {
        const T = dict();
        const en = currentLang() === 'en';
        const [title, sub] = T.nodes[n.id] || [n.id, ''];
        const maxChars = en ? 26 : Math.floor((n.w - 24) / 10.5);
        const subLines = en ? wrapWords(sub, maxChars) : wrapSub(sub, maxChars);
        const pageAttr = n.page ? ` data-page="${esc(n.page)}"` : '';
        const fullTitle = `${n.icon} ${title}`;
        return `<g class="sysmap-node"${pageAttr}>
            <title>${esc(fullTitle)} — ${esc(sub)}${n.page ? esc(T.clickOpen) : ''}</title>
            <rect class="sysmap-card" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="8"
                  fill="#ffffff" stroke="#e2e8f0" stroke-width="1.2"/>
            <rect x="${n.x}" y="${n.y + 10}" width="4" height="${n.h - 20}" rx="2" fill="${n.color}"/>
            <text x="${n.x + 14}" y="${n.y + 27}" font-family="${FONT}" font-size="${en ? 12 : 13}" font-weight="600" fill="#1e293b">${esc(fullTitle)}</text>
            ${subLines.map((line, i) => `<text x="${n.x + 14}" y="${n.y + 47 + i * 14}" font-family="${FONT}" font-size="${en ? 10 : 10.5}" fill="#64748b">${esc(line)}</text>`).join('')}
        </g>`;
    }

    function renderSupport(id, x, y, w, h, icon, page) {
        const T = dict();
        const [title, sub] = T.support[id] || [id, ''];
        const pageAttr = page ? ` data-page="${esc(page)}"` : '';
        return `<g class="sysmap-node"${pageAttr}>
            <title>${esc(icon + ' ' + title)} — ${esc(sub)}${page ? esc(T.clickOpen) : ''}</title>
            <rect class="sysmap-card" x="${x}" y="${y}" width="${w}" height="${h}" rx="10"
                  fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.2"/>
            <rect x="${x}" y="${y + 14}" width="4" height="${h - 28}" rx="2" fill="#64748b"/>
            <text x="${x + 16}" y="${y + 32}" font-family="${FONT}" font-size="13" font-weight="600" fill="#334155">${esc(icon + ' ' + title)}</text>
            <text x="${x + 16}" y="${y + 54}" font-family="${FONT}" font-size="10.5" fill="#64748b">${esc(sub)}</text>
        </g>`;
    }

    function edgeGeom(a, b, edge) {
        if (edge.busY) {
            const sx = a.x + a.w;
            const sy = a.y + a.h / 2;
            const tx = b.x;
            const ty = b.y + b.h / 2;
            return {
                d: `M ${sx} ${sy} L ${sx + 10} ${sy} L ${sx + 10} ${edge.busY} L ${tx - 10} ${edge.busY} L ${tx - 10} ${ty} L ${tx} ${ty}`,
                mid: { x: (sx + tx) / 2, y: edge.busY - 6 },
            };
        }
        if (b.x >= a.x + a.w) {
            const sx = a.x + a.w;
            const sy = a.y + a.h / 2;
            const tx = b.x;
            const ty = b.y + b.h / 2;
            const dx = Math.max(24, (tx - sx) * 0.45);
            return {
                d: `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`,
                mid: { x: (sx + tx) / 2, y: (sy + ty) / 2 },
            };
        }
        if (a.laneId === b.laneId) {
            const down = b.y > a.y;
            const sx = a.x + a.w;
            const sy = down ? a.y + a.h : a.y;
            const tx = b.x + b.w;
            const ty = down ? b.y : b.y + b.h;
            const outX = Math.max(sx, tx) + 12;
            return {
                d: down
                    ? `M ${sx} ${sy} C ${outX} ${sy + 8}, ${outX} ${ty - 8}, ${tx} ${ty}`
                    : `M ${sx} ${sy} C ${outX} ${sy - 8}, ${outX} ${ty + 8}, ${tx} ${ty}`,
                mid: { x: outX + 4, y: (sy + ty) / 2 },
            };
        }
        // 支撑层向上回指
        const sx = a.x + a.w / 2;
        const sy = a.y;
        const tx = b.x + b.w / 2;
        const ty = b.y + b.h;
        return {
            d: `M ${sx} ${sy} C ${sx} ${sy - 50}, ${tx} ${ty + 50}, ${tx} ${ty}`,
            mid: { x: (sx + tx) / 2, y: (sy + ty) / 2 },
        };
    }

    function buildSvg() {
        const T = dict();
        const parts = [];
        parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(T.title)}">`);
        parts.push(`<defs>
            <marker id="smArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"/>
            </marker>
            <marker id="smArrowDash" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#cbd5e1"/>
            </marker>
        </defs>`);
        parts.push(`<rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="#f8fafc"/>`);

        // 业务域色带
        LANES.forEach((lane, i) => {
            const laneTitle = `${NUMERALS[i]} ${T.lanes[lane.id] || lane.id}`;
            parts.push(`<rect x="${lane.x}" y="${lane.y}" width="${lane.w}" height="${lane.h}" rx="14" fill="#ffffff" stroke="#e2e8f0" stroke-width="1"/>`);
            parts.push(`<rect x="${lane.x}" y="${lane.y}" width="${lane.w}" height="4" rx="2" fill="${lane.color}"/>`);
            parts.push(`<text x="${lane.x + 12}" y="${lane.y + 27}" font-family="${FONT}" font-size="12.5" font-weight="700" fill="${lane.color}">${esc(laneTitle)}</text>`);
        });

        // 连线（先画，卡片覆盖其上）
        for (const e of EDGES) {
            const a = nodeById[e.from];
            const b = nodeById[e.to];
            if (!a || !b) continue;
            const g = edgeGeom(a, b, e);
            const stroke = e.dashed ? '#cbd5e1' : '#94a3b8';
            const dash = e.dashed ? ' stroke-dasharray="5 4"' : '';
            const marker = e.dashed ? 'smArrowDash' : 'smArrow';
            parts.push(`<path d="${g.d}" fill="none" stroke="${stroke}" stroke-width="1.6"${dash} marker-end="url(#${marker})" opacity="0.9"/>`);
            if (e.label && (!e.internal || e.showLabel)) {
                const label = T.labels[e.label] || e.label;
                const w = Math.max(28, String(label).length * 11 + 10);
                parts.push(`<g class="sysmap-edge-label">
                    <rect x="${g.mid.x - w / 2}" y="${g.mid.y - 10}" width="${w}" height="17" rx="8" fill="#f8fafc" opacity="0.95"/>
                    <text x="${g.mid.x}" y="${g.mid.y + 2}" text-anchor="middle" font-family="${FONT}" font-size="9.5" fill="#64748b">${esc(label)}</text>
                </g>`);
            }
        }

        // 卡片
        for (const n of NODES) parts.push(renderNode(nodeById[n.id]));

        // 支撑层
        parts.push(`<rect x="20" y="748" width="1240" height="94" rx="14" fill="#f1f5f9" stroke="#e2e8f0"/>`);
        parts.push(`<text x="34" y="770" font-family="${FONT}" font-size="11" font-weight="700" fill="#94a3b8">${esc(T.supportTitle)}</text>`);
        parts.push(renderSupport('master', 20, 778, 600, 56, '👥', 'relation'));
        parts.push(renderSupport('system', 650, 778, 610, 56, '🔧', 'system'));

        parts.push('</svg>');
        return parts.join('');
    }

    return {
        open() {
            const T = dict();
            const lang = currentLang();
            const svg = buildSvg();
            let ov = document.getElementById('sysmapOverlay');
            if (!ov) {
                ov = document.createElement('div');
                ov.id = 'sysmapOverlay';
                ov.className = 'sysmap-overlay';
                document.body.appendChild(ov);
            }
            ov.innerHTML = `
                <div class="sysmap-panel">
                    <div class="sysmap-head">
                        <div>
                            <h3>🏢 ${esc(T.title)}</h3>
                            <div class="sysmap-flow">
                                ${T.flow.map((s, i) => `${i ? '<i>→</i>' : ''}<span>${esc(s)}</span>`).join('')}
                            </div>
                        </div>
                        <div class="sysmap-actions">
                            <label class="sysmap-lang-label" for="sysmapLang">${esc(T.langLabel)}</label>
                            <select id="sysmapLang" class="sysmap-lang" onchange="SystemMap.setLang(this.value)">
                                ${LANGS.map(l => `<option value="${l.code}" ${l.code === lang ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}
                            </select>
                            <button class="btn btn-outline" onclick="SystemMap.download()">⬇️ ${esc(T.download)}</button>
                            <button class="btn btn-primary" onclick="SystemMap.close()">${esc(T.close)}</button>
                        </div>
                    </div>
                    <div class="sysmap-toolbar">
                        <span class="sysmap-hint">${esc(T.hint)}</span>
                        <div class="sysmap-legend">
                            ${LANES.map(l => `<span><i class="dot" style="background:${l.color}"></i>${esc(T.lanes[l.id] || l.id)}</span>`).join('')}
                            <span><i class="dot" style="background:#64748b"></i>${esc(T.supportTitle)}</span>
                        </div>
                    </div>
                    <div class="sysmap-wrap">${svg}</div>
                </div>`;
            ov.classList.add('show');
            ov.onclick = (e) => { if (e.target === ov) SystemMap.close(); };
            ov.querySelectorAll('.sysmap-node[data-page]').forEach(g => {
                g.addEventListener('click', () => {
                    const page = g.getAttribute('data-page');
                    SystemMap.close();
                    if (page && typeof navigate === 'function') navigate(page);
                });
            });
        },

        setLang(lang) {
            if (typeof I18N !== 'undefined' && I18N.setLang) {
                I18N.setLang(lang);
                const globalSel = document.getElementById('globalLang');
                if (globalSel) globalSel.value = lang;
                const loginSel = document.getElementById('loginLang');
                if (loginSel) loginSel.value = lang;
            }
            this.open();
        },

        close() {
            const ov = document.getElementById('sysmapOverlay');
            if (ov) ov.classList.remove('show');
        },

        download() {
            const svg = document.querySelector('.sysmap-wrap svg');
            if (!svg) return;
            const clone = svg.cloneNode(true);
            clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            const text = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
            const blob = new Blob([text], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ERMM_System_Architecture_${currentLang()}.svg`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        },
    };
})();
