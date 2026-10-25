/**
 * ERMM 系统架构图
 * 点击左侧「ERMM」标志打开；纯 SVG 渲染，无外部依赖。
 * 卡片可点击跳转到对应模块；实线为数据流，虚线为主档/配置支撑。
 */
const SystemMap = (() => {
    const W = 1280;
    const H = 870;
    const CARD_H = 72;
    const GAP = 16;
    const TOP = 66;
    const FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif";

    const LANES = [
        { id: 'ingest', title: '① 数据接入', color: '#8e44ad', x: 20, w: 210, y: 20, h: 710 },
        { id: 'doc', title: '② ERP 原始单据', color: '#1e8449', x: 250, w: 210, y: 20, h: 710 },
        { id: 'settle', title: '③ 结算与资金', color: '#d35400', x: 480, w: 210, y: 20, h: 710 },
        { id: 'gl', title: '④ 核算与税务', color: '#2874a6', x: 710, w: 210, y: 20, h: 710 },
        { id: 'bi', title: '⑤ 报表与决策', color: '#c0392b', x: 940, w: 320, y: 20, h: 710 },
    ];

    const NODES = [
        { id: 'extErp', lane: 'ingest', row: 0, icon: '🏭', title: '第三方 ERP', sub: '接单 / 采购 / 制造资料', page: 'integration' },
        { id: 'excel', lane: 'ingest', row: 1, icon: '📥', title: 'Excel 导入', sub: '双语表头 · 13 张资料表', page: 'integration' },
        { id: 'sql', lane: 'ingest', row: 2, icon: '🔌', title: 'SQL 线上整合', sub: '数据源 · 定时任务 · 别名映射', page: 'integration' },
        { id: 'batch', lane: 'ingest', row: 3, icon: '⚙️', title: '批次管线', sub: 'Step1~Step7 加工与重算', page: 'batch' },
        { id: 'ingestCheck', lane: 'ingest', row: 4, icon: '🧪', title: '导入校验', sub: '必填 · 唯一键 · 错误日志', page: 'integration' },

        { id: 'po', lane: 'doc', row: 0, icon: '🛒', title: '采购订单 PO', sub: 'PO 暂存 → 正式 PO', page: 'po' },
        { id: 'so', lane: 'doc', row: 1, icon: '📦', title: '销售订单 SO', sub: 'SO 交货单 DN', page: 'so' },
        { id: 'mo', lane: 'doc', row: 2, icon: '🏭', title: '制造工单 MO', sub: '用料 / 工艺 / 报工 / 生产明细', page: '' },
        { id: 'inv', lane: 'doc', row: 3, icon: '🚚', title: '在途与库存', sub: '在途价格 · 每日库存状态', page: 'xitems' },
        { id: 'masterRef', lane: 'doc', row: 4, icon: '👥', title: '主档引用', sub: '客户 · 供应商 · 物料', page: 'relation' },

        { id: 'arap', lane: 'settle', row: 0, icon: '📐', title: '应收应付 ARAP', sub: '客户应收 · 供应商应付', page: 'arap' },
        { id: 'invoice', lane: 'settle', row: 1, icon: '🧾', title: '发票管理', sub: '销项 / 进项 · 对账', page: 'invoice' },
        { id: 'pay', lane: 'settle', row: 2, icon: '💳', title: '付款明细', sub: '付款申请与核销', page: 'pay' },
        { id: 'check', lane: 'settle', row: 3, icon: '📝', title: '票据管理', sub: '应收 / 应付票据', page: 'check' },
        { id: 'bank', lane: 'settle', row: 4, icon: '🏦', title: '银行贷款', sub: '额度 · 利息 · 还款', page: 'bank' },
        { id: 'cash', lane: 'settle', row: 5, icon: '💵', title: '现金日记账', sub: '资金收支流水', page: 'cash' },

        { id: 'finance', lane: 'gl', row: 0, icon: '📒', title: '财务入账 / 总账', sub: '凭证 · 科目 · 月结', page: 'finance' },
        { id: 'tax', lane: 'gl', row: 1, icon: '🧮', title: '电子化报税', sub: '增值税 / 企业所得税 / 个税', page: 'tax' },
        { id: 'xitems', lane: 'gl', row: 2, icon: '📦', title: '库存减值', sub: '库龄 · 减值率 · 现值', page: 'xitems' },
        { id: 'mgmt', lane: 'gl', row: 3, icon: '🏢', title: '管理会计', sub: '成本 · 部门 · 项目核算', page: 'mgmtAccounting' },

        { id: 'summary', lane: 'bi', row: 0, icon: '📋', title: '财务摘要', sub: '收入 · 成本 · 利润 · 现金流', page: 'summary' },
        { id: 'report', lane: 'bi', row: 1, icon: '📈', title: '三大报表', sub: '资产负债表 / 利润表 / 现金流量表', page: 'report' },
        { id: 'consolidation', lane: 'bi', row: 2, icon: '📋', title: '合并报表', sub: '分公司 / 关系人抵销', page: 'consolidation' },
        { id: 'budget', lane: 'bi', row: 3, icon: '📊', title: '预算与预测', sub: '预算编制 · 财务预测 · 现金预测', page: 'budget' },
        { id: 'kpi', lane: 'bi', row: 4, icon: '⚠️', title: '风险与 KPI', sub: '预警指标 · 门槛 · 异常甄别', page: 'risk' },
        { id: 'drill', lane: 'bi', row: 5, icon: '🔍', title: '多维下钻', sub: '行动追踪 · 预警通知', page: 'drilldown' },
        { id: 'ai', lane: 'bi', row: 6, icon: '🤖', title: 'AI 问答 / 情景模拟', sub: '自然语言查询 · What-if', page: 'aiqa' },
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
        { from: 'so', to: 'mo', label: '投产', internal: true },
        { from: 'po', to: 'inv', label: '入库', internal: true },

        // 结算内部关联
        { from: 'arap', to: 'invoice', label: '对账', internal: true },
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

    function esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

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

    function renderNode(n) {
        if (!n) return '';
        const maxChars = Math.floor((n.w - 24) / 10.5);
        const subLines = wrapSub(n.sub, maxChars);
        const pageAttr = n.page ? ` data-page="${esc(n.page)}"` : '';
        const title = `${n.icon} ${n.title}`;
        return `<g class="sysmap-node"${pageAttr}>
            <title>${esc(title)} — ${esc(n.sub)}${n.page ? '（点击打开）' : ''}</title>
            <rect class="sysmap-card" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="8"
                  fill="#ffffff" stroke="#e2e8f0" stroke-width="1.2"/>
            <rect x="${n.x}" y="${n.y + 10}" width="4" height="${n.h - 20}" rx="2" fill="${n.color}"/>
            <text x="${n.x + 14}" y="${n.y + 27}" font-family="${FONT}" font-size="13" font-weight="600" fill="#1e293b">${esc(title)}</text>
            ${subLines.map((line, i) => `<text x="${n.x + 14}" y="${n.y + 47 + i * 14}" font-family="${FONT}" font-size="10.5" fill="#64748b">${esc(line)}</text>`).join('')}
        </g>`;
    }

    function renderSupport(id, x, y, w, h, icon, title, sub, page) {
        const pageAttr = page ? ` data-page="${esc(page)}"` : '';
        return `<g class="sysmap-node"${pageAttr}>
            <title>${esc(icon + ' ' + title)} — ${esc(sub)}${page ? '（点击打开）' : ''}</title>
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
        const parts = [];
        parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="ERMM 系统架构图">`);
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
        for (const lane of LANES) {
            parts.push(`<rect x="${lane.x}" y="${lane.y}" width="${lane.w}" height="${lane.h}" rx="14" fill="#ffffff" stroke="#e2e8f0" stroke-width="1"/>`);
            parts.push(`<rect x="${lane.x}" y="${lane.y}" width="${lane.w}" height="4" rx="2" fill="${lane.color}"/>`);
            parts.push(`<text x="${lane.x + 12}" y="${lane.y + 27}" font-family="${FONT}" font-size="12.5" font-weight="700" fill="${lane.color}">${esc(lane.title)}</text>`);
        }

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
            if (e.label && (!e.internal || e.label === '投产' || e.label === '入库' || e.label === '对账')) {
                const w = Math.max(28, String(e.label).length * 11 + 10);
                parts.push(`<g class="sysmap-edge-label">
                    <rect x="${g.mid.x - w / 2}" y="${g.mid.y - 10}" width="${w}" height="17" rx="8" fill="#f8fafc" opacity="0.95"/>
                    <text x="${g.mid.x}" y="${g.mid.y + 2}" text-anchor="middle" font-family="${FONT}" font-size="9.5" fill="#64748b">${esc(e.label)}</text>
                </g>`);
            }
        }

        // 卡片
        for (const n of NODES) parts.push(renderNode(nodeById[n.id]));

        // 支撑层
        parts.push(`<rect x="20" y="748" width="1240" height="94" rx="14" fill="#f1f5f9" stroke="#e2e8f0"/>`);
        parts.push(`<text x="34" y="770" font-family="${FONT}" font-size="11" font-weight="700" fill="#94a3b8">支撑层</text>`);
        parts.push(renderSupport('master', 20, 778, 600, 56, '👥', '主档管理', '往来对象 · 分公司 · KPI 门槛', 'relation'));
        parts.push(renderSupport('system', 650, 778, 610, 56, '🔧', '系统管理', '使用者 · 系统设定 · 数据源 · 执行日志', 'system'));

        parts.push('</svg>');
        return parts.join('');
    }

    return {
        open() {
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
                            <h3>🏢 ERMM 系统架构图</h3>
                            <div class="sysmap-flow">
                                <span>数据接入</span><i>→</i><span>ERP 原始单据</span><i>→</i>
                                <span>结算与资金</span><i>→</i><span>核算与税务</span><i>→</i><span>报表与决策</span>
                            </div>
                        </div>
                        <div class="sysmap-actions">
                            <button class="btn btn-outline" onclick="SystemMap.download()">⬇️ 下载 SVG</button>
                            <button class="btn btn-primary" onclick="SystemMap.close()">关闭</button>
                        </div>
                    </div>
                    <div class="sysmap-toolbar">
                        <span class="sysmap-hint">点击模块卡片可跳转；<b>实线</b>为数据流，<b>虚线</b>为主档 / 配置支撑。</span>
                        <div class="sysmap-legend">
                            ${LANES.map(l => `<span><i class="dot" style="background:${l.color}"></i>${esc(l.title.replace(/^[①-⑤]\s*/, ''))}</span>`).join('')}
                            <span><i class="dot" style="background:#64748b"></i>支撑层</span>
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
            a.download = 'ERMM_系统架构图.svg';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        },
    };
})();
