#!/usr/bin/env node
/* ==========================================================================
   生成可被搜索引擎与 AI 爬虫读取的独立页面
   --------------------------------------------------------------------------
   为什么需要这一步：

     现有架构是单页应用（SPA）+ hash 路由（#/p/qian），
     文章存在 articles/*.html 里，是【纯片段】——
       没有 <html>、没有 <head>、没有 <title>、没有 <h1>

     搜索引擎和 AI 爬虫看到的是「一个没有标题的 HTML 片段」，
     等于 64 篇正文在世界眼里不存在。

   本脚本做的事：
     读 data/manifest.json + articles/*.html
     → 为每一篇生成 p/<id>.html（完整独立页面）
     → 生成 sitemap.xml / robots.txt / llms.txt

   ⚠️ 只生成【免费部分】。付费正文仍然只在 Cloudflare KV 里。
   ========================================================================== */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SITE = 'https://huangminzhe321-art.github.io/zhouyi';
const SITE_NAME = '周易六十四卦';

const OUT = join(ROOT, 'p');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const manifest = JSON.parse(readFileSync(join(ROOT, 'data/manifest.json'), 'utf8'));

/* 所有文章：64 卦 + 15 前置 */
const all = [
  ...(manifest.front || []).map((a) => ({ ...a, kind: 'front' })),
  ...(manifest.articles || []).map((a) => ({ ...a, kind: 'hex' })),
];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 纯文本截断（用于 description） */
function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function readFragment(id) {
  const f = join(ROOT, 'articles', id + '.html');
  return existsSync(f) ? readFileSync(f, 'utf8') : '';
}

/* ---------------- 页面 CSS（内联，避免额外请求） ---------------- */
const CSS = `
:root{--paper:#fbf8f1;--paper2:#f3efe7;--ink:#1c1a17;--ink2:#44403a;--ink3:#6b645a;
--line:#e8e2d8;--line2:#d9d2c6;--red:#a8322a;
--serif:"Songti SC","Source Han Serif SC","Noto Serif CJK SC",Georgia,serif;
--sans:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:16.5px/1.9 var(--sans);
-webkit-font-smoothing:antialiased}
.wrap{max-width:720px;margin:0 auto;padding:0 22px 90px}
.nav{padding:22px 0 0;font:13px var(--serif);color:var(--ink3);letter-spacing:.03em}
.nav a{color:var(--ink3);text-decoration:none}
.nav a:hover{color:var(--red)}
.nav .sep{margin:0 8px;color:var(--line2)}
h1{font:700 30px/1.4 var(--serif);margin:26px 0 8px;letter-spacing:.01em}
.meta{font:13px var(--serif);color:var(--ink3);padding-bottom:22px;
border-bottom:1px solid var(--line);margin-bottom:30px}
.meta span{margin-right:14px}
h2{font:700 20px/1.5 var(--serif);margin:42px 0 14px;padding-left:11px;
border-left:3px solid var(--red)}
h3{font:700 16.5px/1.6 var(--serif);margin:26px 0 10px}
p{margin:0 0 15px;color:var(--ink2)}
ul,ol{margin:0 0 15px;padding-left:22px;color:var(--ink2)}
li{margin-bottom:6px}
strong{color:var(--ink);font-weight:700}
a{color:var(--red)}
.scripture{background:var(--paper2);border-left:3px solid var(--line2);
padding:18px 20px;border-radius:0 8px 8px 0;margin:0 0 22px}
.scripture .sp-label{display:block;font:11px var(--serif);letter-spacing:.16em;
color:var(--ink3);margin-bottom:7px}
.scripture p{margin:0;font-family:var(--serif);font-size:18px;line-height:2;color:var(--ink)}
.cta{margin:54px 0 0;padding:26px 24px;background:var(--paper2);
border:1px solid var(--line2);border-radius:11px}
.cta-tt{font:700 17px var(--serif);margin-bottom:9px}
.cta-sub{font:14px/1.8 var(--serif);color:var(--ink3);margin:0 0 17px}
.cta a.go{display:inline-block;padding:12px 24px;background:var(--red);color:#fff;
border-radius:7px;text-decoration:none;font:700 14.5px var(--serif)}
.cta a.go:hover{background:#8d2a23}
footer{margin-top:60px;padding-top:24px;border-top:1px solid var(--line);
font:13px/1.9 var(--serif);color:var(--ink3)}
footer a{color:var(--ink3);text-decoration:none;margin-right:16px}
footer a:hover{color:var(--red)}
@media(max-width:620px){h1{font-size:25px}h2{font-size:18.5px}body{font-size:16px}}
`;

/* ---------------- 单个页面 ---------------- */
function page(a) {
  const frag = readFragment(a.id);
  const isHex = a.kind === 'hex';

  const title = isHex
    ? `${a.name}卦 · ${a.full || ''} — ${SITE_NAME}解读`
    : `${a.name} — ${SITE_NAME}`;

  const desc = clip(a.excerpt || a.quote || `《周易》${a.name}卦的卦辞、彖传、象传、爻辞原文与白话解读。`, 110);

  const canonical = `${SITE}/p/${a.id}.html`;

  const crumb = isHex
    ? `<a href="${SITE}/">${SITE_NAME}</a><span class="sep">/</span><a href="${SITE}/#/toc">目录</a><span class="sep">/</span><span>第 ${a.n} 卦</span>`
    : `<a href="${SITE}/">${SITE_NAME}</a><span class="sep">/</span><a href="${SITE}/#/toc">目录</a><span class="sep">/</span><span>${esc(a.groupName || '前置')}</span>`;

  const metaLine = [
    isHex ? `第 ${a.n} 卦` : '',
    a.full ? esc(a.full) : '',
    a.yaoCount ? `${a.yaoCount} 爻` : '',
    a.mins ? `约 ${a.mins} 分钟` : '',
    a.groupName ? esc(a.groupName) : '',
  ].filter(Boolean).map((s) => `<span>${s}</span>`).join('');

  /* JSON-LD：让搜索引擎与 AI 知道这是什么 */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description: desc,
    inLanguage: 'zh-CN',
    url: canonical,
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE },
    author: { '@type': 'Person', name: '周易六十四卦' },
    publisher: { '@type': 'Organization', name: SITE_NAME },
    about: isHex
      ? [{ '@type': 'Thing', name: `${a.name}卦` }, { '@type': 'Book', name: '周易' }]
      : [{ '@type': 'Thing', name: a.name }],
  };

  const ctaTitle = '完整解读需要购买';
  const ctaSub = '上面的卦辞、彖传、象传、爻辞、白话与处世应用是免费的。'
    + '逐爻拆解你所处的阶段、史书中的真实印证、以及判断方法，是付费部分。';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:locale" content="zh_CN">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">

<div class="nav">${crumb}</div>

<h1>${isHex ? `${esc(a.name)}卦 · ${esc(a.full || '')}` : esc(a.name)}</h1>
<div class="meta">${metaLine}</div>

<article>
${frag}
</article>

<div class="cta">
  <div class="cta-tt">${ctaTitle}</div>
  <p class="cta-sub">${ctaSub}</p>
  <a class="go" href="${SITE}/#/p/${a.id}">到站内查看（可登录、可购买）→</a>
</div>

<footer>
  <a href="${SITE}/">首页</a>
  <a href="${SITE}/#/toc">全部目录</a>
  <a href="${SITE}/#/s">按处境查找</a>
  <a href="${SITE}/privacy.html">隐私政策</a>
  <a href="${SITE}/terms.html">服务条款</a>
  <div style="margin-top:12px">本站是对《周易》的研读与解读，不是占卜、算命或预测服务。</div>
</footer>

</div>
</body>
</html>`;
}

/* ---------------- 生成 ---------------- */
let count = 0;
const urls = [];

for (const a of all) {
  const html = page(a);
  if (!html.includes('<article>')) continue;
  writeFileSync(join(OUT, a.id + '.html'), html, 'utf8');
  urls.push({
    loc: `${SITE}/p/${a.id}.html`,
    title: a.kind === 'hex' ? `${a.name}卦 · ${a.full || ''}` : a.name,
  });
  count++;
}

/* ---------------- sitemap.xml ---------------- */
const today = new Date().toISOString().slice(0, 10);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><lastmod>${today}</lastmod><priority>1.0</priority></url>
  <url><loc>${SITE}/#/toc</loc><lastmod>${today}</lastmod><priority>0.8</priority></url>
${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${today}</lastmod><priority>0.7</priority></url>`).join('\n')}
  <url><loc>${SITE}/privacy.html</loc><lastmod>${today}</lastmod><priority>0.2</priority></url>
  <url><loc>${SITE}/terms.html</loc><lastmod>${today}</lastmod><priority>0.2</priority></url>
</urlset>
`;
writeFileSync(join(ROOT, 'sitemap.xml'), sitemap, 'utf8');

/* ---------------- robots.txt ---------------- */
const robots = `# ${SITE_NAME}
User-agent: *
Allow: /

# AI 爬虫显式允许（内容希望被引用）
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;
writeFileSync(join(ROOT, 'robots.txt'), robots, 'utf8');

/* ---------------- llms.txt ---------------- */
const hexLines = (manifest.articles || [])
  .map((a) => `- [${a.name}卦 · ${a.full || ''}](${SITE}/p/${a.id}.html)：${clip(a.excerpt || '', 60)}`)
  .join('\n');

const frontLines = (manifest.front || [])
  .map((a) => `- [${a.name}](${SITE}/p/${a.id}.html)：${clip(a.excerpt || '', 60)}`)
  .join('\n');

const llms = `# ${SITE_NAME}

> 对《周易》六十四卦的逐卦研读：每一卦给出卦辞、彖传、象传、六十四爻爻辞原文与白话解读，
> 并提供「在你现在这个处境下该怎么做」的对照。内容基于历代注疏与一手史书，
> 标注出处，区分「史料记载」与「解读」。本站不是占卜、算命或预测服务。

## 这个站与众不同的地方

多数《周易》网站按「卦」组织内容，读者要先知道自己在哪一卦。
本站额外按「读者所处的处境」组织索引（384 条），
把「你现在遇到什么事」映射到具体的卦与爻，并给出可执行的判断与它的失效边界。

## 前置阅读（15 篇，全部免费）

${frontLines}

## 六十四卦（每卦的经文、传文、白话、处世应用免费；逐爻深度解读付费）

${hexLines}

## 说明

- 所有页面为中文
- 经文与传文引用自通行本
- 史事引自《史记》《汉书》《资治通鉴》等正史，注明出处
- 付费部分不在公开页面中，需登录并购买后由服务端下发
`;
writeFileSync(join(ROOT, 'llms.txt'), llms, 'utf8');

console.log(`✅ 生成 p/*.html  ${count} 篇`);
console.log(`✅ sitemap.xml   ${urls.length + 4} 个 URL`);
console.log(`✅ robots.txt    含 AI 爬虫白名单`);
console.log(`✅ llms.txt      ${(manifest.articles || []).length} 卦 + ${(manifest.front || []).length} 篇前置`);
