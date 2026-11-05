/**
 * 將 docs/*.md 轉換為可直接瀏覽的 HTML（含側邊欄目錄、Mermaid 圖表渲染）
 * 用法：node scripts/generate_docs_html.js
 * 產出：docs/同名.html 與 public/同名.html
 */
const fs = require('fs');
const path = require('path');
// 使用專案內已 vendor 的 marked（UMD），避免依賴 node_modules
const { marked } = require(path.join(__dirname, '..', 'public', 'vendor', 'marked.min.js'));

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const PUBLIC = path.join(ROOT, 'public');

const FILES = [
    {
        md: 'ERMM_系統架構與流程圖.md',
        title: 'ERMM 系統架構與流程圖',
        subtitle: '技術棧 · 分層架構 · 運行時流程 · AI 智能層',
        accent: '#1976d2',
        accentSoft: '#e3f2fd'
    },
    {
        md: 'ERMM_系統架構與模組資料表關係圖.md',
        title: 'ERMM 系統架構與模組資料表關係圖',
        subtitle: '分層架構 · 模組 × 資料表 · ER 圖 · 索引與遷移',
        accent: '#6a1b9a',
        accentSoft: '#ede7f6'
    }
];

function buildMarkdown() {
    let counter = 0;
    let firstH1 = true;
    const toc = [];

    const renderer = {
        heading(a, b) {
            // 兼容 marked v12（token 物件）與舊式（text, level）呼叫
            const isToken = a && typeof a === 'object';
            const depth = isToken ? a.depth : b;
            const src = isToken ? (a.text || '') : a;
            const tokensArr = isToken && a.tokens && a.tokens.length ? a.tokens : null;
            const html = tokensArr ? renderTokens(tokensArr) : inlineFormat(src);
            const text = html.replace(/<[^>]+>/g, '');
            counter += 1;
            const id = 'sec-' + counter;
            if (depth === 1 && firstH1) {
                firstH1 = false; // 文件標題由 hero 呈現，不重複
                return '';
            }
            if (depth <= 3) {
                toc.push({ depth, id, text });
            }
            return `<h${depth} id="${id}">${html}</h${depth}>`;
        },
        code(a, b) {
            const isToken = a && typeof a === 'object';
            const lang = ((isToken ? a.lang : b) || '').trim();
            const body = isToken ? a.text : a;
            if (lang === 'mermaid') {
                return `<div class="diagram"><div class="mermaid">${escapeHtml(body)}</div></div>`;
            }
            const cls = lang ? ` class="language-${lang}"` : '';
            return `<pre class="code-block"><code${cls}>${escapeHtml(body)}</code></pre>`;
        }
    };

    marked.use({ renderer });
    return { getToc: () => toc, reset: () => { counter = 0; firstH1 = true; toc.length = 0; } };
}

function inlineFormat(s) {
    let out = escapeHtml(s);
    out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\b_(\S(?:[^_]*?\S)?)_\b/g, '<em>$1</em>');
    out = out.replace(/`(.+?)`/g, '<code>$1</code>');
    out = out.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
    return out;
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function renderTokens(tokens) {
    return tokens.map(t => {
        if (t.type === 'text') {
            let s = escapeHtml(t.text || '');
            s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
            s = s.replace(/`(.+?)`/g, '<code>$1</code>');
            s = s.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
            return s;
        }
        if (t.type === 'strong') return '<strong>' + renderTokens(t.tokens || []) + '</strong>';
        if (t.type === 'code') return '<code>' + escapeHtml(t.text || '') + '</code>';
        if (t.type === 'link') return '<a href="' + escapeHtml(t.href || '#') + '">' + renderTokens(t.tokens || []) + '</a>';
        if (t.type === 'escape') return escapeHtml(t.text || '');
        return escapeHtml(t.raw || t.text || '');
    }).join('');
}

function page({ title, subtitle, accent, accentSoft, body, toc, mermaidSrc, otherHref, generatedAt }) {
    const tocHtml = toc
        .filter(t => t.depth <= 3)
        .map(t => `<a class="toc-item d${t.depth}" href="#${t.id}">${t.text}</a>`)
        .join('\n');

    return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
:root{--accent:${accent};--accent-soft:${accentSoft};--ink:#1f2733;--muted:#6b7785;--line:#e3e8ef;--bg:#f6f8fb;}
*{box-sizing:border-box;}
body{margin:0;font-family:"Segoe UI","Microsoft JhengHei","PingFang TC",system-ui,sans-serif;color:var(--ink);background:var(--bg);line-height:1.7;}
.layout{display:flex;min-height:100vh;}
aside{width:280px;flex:0 0 280px;background:#fff;border-right:1px solid var(--line);position:sticky;top:0;height:100vh;overflow-y:auto;padding:22px 16px 40px;}
.brand{font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin-bottom:6px;}
.brand-sub{font-size:12px;color:var(--muted);margin-bottom:18px;line-height:1.5;}
.toc-item{display:block;font-size:13px;color:#39424e;text-decoration:none;padding:6px 10px;border-radius:6px;border-left:3px solid transparent;}
.toc-item.d2{padding-left:22px;color:var(--muted);}
.toc-item.d3{padding-left:34px;font-size:12px;color:#8a95a3;}
.toc-item:hover{background:var(--accent-soft);}
.toc-item.active{background:var(--accent-soft);border-left-color:var(--accent);color:var(--accent);font-weight:600;}
.side-foot{margin-top:24px;padding-top:14px;border-top:1px dashed var(--line);font-size:12px;color:var(--muted);line-height:1.8;}
.side-foot a{color:var(--accent);text-decoration:none;}
main{flex:1;min-width:0;padding:34px 46px 90px;max-width:1080px;}
.hero{background:linear-gradient(135deg,var(--accent),#3949ab);color:#fff;border-radius:14px;padding:26px 30px;margin-bottom:30px;}
.hero h1{margin:0 0 8px;font-size:26px;font-weight:700;}
.hero p{margin:0;font-size:13px;opacity:.92;}
.doc h1{font-size:24px;margin:44px 0 14px;padding-bottom:10px;border-bottom:2px solid var(--accent);color:var(--accent);}
.doc h2{font-size:19px;margin:34px 0 12px;padding-left:12px;border-left:4px solid var(--accent);}
.doc h3{font-size:16px;margin:26px 0 10px;color:#2c3e50;}
.doc p{margin:10px 0;}
.doc ul,.doc ol{margin:10px 0 10px 22px;padding-left:8px;}
.doc li{margin:5px 0;}
.doc blockquote{margin:14px 0;padding:10px 16px;background:#fff;border-left:4px solid var(--accent);border-radius:0 8px 8px 0;color:#4a5568;font-size:13.5px;box-shadow:0 1px 3px rgba(0,0,0,.05);}
.doc table{width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.06);border-radius:8px;overflow:hidden;}
.doc th{background:var(--accent-soft);color:#243b53;text-align:left;font-weight:600;padding:9px 12px;border-bottom:2px solid var(--line);}
.doc td{padding:8px 12px;border-bottom:1px solid var(--line);vertical-align:top;}
.doc tr:last-child td{border-bottom:none;}
.doc tr:nth-child(even) td{background:#fbfcfe;}
.doc code{background:#eef2f7;padding:1px 6px;border-radius:4px;font-family:Consolas,"Courier New",monospace;font-size:12.5px;color:#0b5394;}
.doc pre.code-block{background:#1e2530;color:#dbe4ee;padding:14px 16px;border-radius:8px;overflow:auto;font-size:12.5px;line-height:1.6;}
.doc pre.code-block code{background:none;color:inherit;padding:0;}
.diagram{background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px;margin:18px 0;overflow:auto;text-align:center;}
.mermaid{font-size:13px;}
.doc a{color:var(--accent);}
.hr{border:none;height:1px;background:var(--line);margin:26px 0;}
@media(max-width:900px){
  .layout{flex-direction:column;}
  aside{position:relative;width:auto;height:auto;flex:none;border-right:none;border-bottom:1px solid var(--line);}
  main{padding:22px 18px 70px;}
  .hero h1{font-size:20px;}
}
@media print{
  aside{display:none;}
  main{max-width:100%;padding:0;}
  .hero{background:#fff;color:var(--ink);border:1px solid var(--line);}
}
</style>
</head>
<body>
<div class="layout">
<aside>
  <div class="brand">ERMM Docs</div>
  <div class="brand-sub">${subtitle}</div>
  <nav id="toc">
${tocHtml}
  </nav>
  <div class="side-foot">
    產生時間：${generatedAt}<br>
    <a href="http://localhost:3008/" target="_blank">← 返回 ERMM 系統</a><br>
    <a href="${otherHref}">切換另一份文件</a>
  </div>
</aside>
<main>
  <div class="hero">
    <h1>${title}</h1>
    <p>${subtitle} ｜ 由 Markdown 自動產生（唯讀文件）</p>
  </div>
  <article class="doc">
${body}
  </article>
</main>
</div>
<script src="${mermaidSrc}"></script>
<script>
  if (window.mermaid) {
    mermaid.initialize({ startOnLoad: true, theme: 'default', securityLevel: 'loose',
      flowchart: { htmlLabels: true, curve: 'basis' }, er: { useMaxWidth: true } });
  }
  const links = Array.from(document.querySelectorAll('#toc .toc-item'));
  const heads = links.map(a => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
  function spy() {
    let idx = 0;
    heads.forEach((h, i) => { if (h.getBoundingClientRect().top <= 90) idx = i; });
    links.forEach((a, i) => a.classList.toggle('active', i === idx));
  }
  document.addEventListener('scroll', spy, { passive: true });
  spy();
</script>
</body>
</html>`;
}

(function main() {
    const md = buildMarkdown();
    const generatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');

    for (const f of FILES) {
        const src = path.join(DOCS, f.md);
        const raw = fs.readFileSync(src, 'utf8');
        md.reset();

        // 移除頂部的引用區塊（由 hero 呈現）
        const body = marked.parse(raw);

        const common = { ...f, body, toc: md.getToc(), generatedAt };
        const isFlow = f.md.includes('流程圖');
        const htmlDoc = page({
            ...common,
            mermaidSrc: '../public/vendor/mermaid.min.js',
            otherHref: isFlow ? 'ERMM_系統架構與模組資料表關係圖.html' : 'ERMM_系統架構與流程圖.html'
        });
        const htmlPub = page({
            ...common,
            mermaidSrc: '/vendor/mermaid.min.js',
            otherHref: isFlow ? '/docs/data-model' : '/docs/architecture'
        });

        const outDoc = path.join(DOCS, f.md.replace(/\.md$/, '.html'));
        const outPub = path.join(PUBLIC, f.md.replace(/\.md$/, '.html'));
        fs.writeFileSync(outDoc, htmlDoc, 'utf8');
        fs.writeFileSync(outPub, htmlPub, 'utf8');
        console.log(`✔ ${path.relative(ROOT, outDoc)}  ${(htmlDoc.length / 1024).toFixed(1)} KB`);
        console.log(`✔ ${path.relative(ROOT, outPub)}  ${(htmlPub.length / 1024).toFixed(1)} KB`);
    }
})();
