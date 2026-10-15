/**
 * 构建脚本：合并 64 卦数据 → 生成 manifest.json / articles/*.html / search.json
 * 用法：node build/build.mjs
 */
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HEX_1_16 } from './hex-01-16.mjs';
import { HEX_17_32 } from './hex-17-32.mjs';
import { HEX_33_48 } from './hex-33-48.mjs';
import { HEX_49_64 } from './hex-49-64.mjs';
import { FRONT } from './front.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const ALL = [...HEX_1_16, ...HEX_17_32, ...HEX_33_48, ...HEX_49_64];

/* ---------------- id 归一化 ----------------
 * 四段数据独立编写，出现 3 组拼音撞名。此处按「卦名拼音 + 区分后缀」
 * 显式改名，保留原 id 语义，避免破坏各分片文件的引用。
 */
const ID_FIX = {
  10: 'lvlv',    // 履 (lǚ) —— 与 56 旅 (lǚ) 撞名
  56: 'lv',      // 旅 保留
  27: 'yi',      // 颐 (yí) 保留
  42: 'yiyi',    // 益 (yì) —— 与 27 颐 撞名
  39: 'jian',    // 蹇 (jiǎn) 保留
  53: 'jianjian',// 渐 (jiàn) —— 与 39 蹇 撞名
};
for (const h of ALL) {
  if (ID_FIX[h.n]) h.id = ID_FIX[h.n];
}

/* ---------------- 校验 ---------------- */
const problems = [];
if (ALL.length !== 64) problems.push(`卦数不是 64，实际 ${ALL.length}`);
const seenN = new Set(), seenId = new Set();
for (const h of ALL) {
  if (seenN.has(h.n)) problems.push(`序号重复：${h.n}`);
  if (seenId.has(h.id)) problems.push(`id 重复：${h.id}`);
  seenN.add(h.n); seenId.add(h.id);
  for (let i = 1; i <= 64; i++) if (!seenN.has(i) && i === h.n) { /* noop */ }
  if (!h.gua || !h.yao || h.yao.length !== 6) problems.push(`${h.n} ${h.name}：爻辞不是 6 条`);
  if (!h.symbol) problems.push(`${h.n} ${h.name}：缺 symbol`);
  if (!Array.isArray(h.binary) || h.binary.length !== 6) problems.push(`${h.n} ${h.name}：binary 不是 6 位`);
}
for (let i = 1; i <= 64; i++) if (!seenN.has(i)) problems.push(`缺第 ${i} 卦`);

if (problems.length) {
  console.error('❌ 数据校验失败：');
  problems.forEach((p) => console.error('   - ' + p));
  process.exit(1);
}

/* ---------------- 分组 ----------------
 * 前置三组（卷首/基础/方法）承载「体」，六十四卦两组承载「术」。
 * 没有前置，六十四卦只是签文；有了前置，它才是可用的决策框架。
 */
const GROUPS = [
  { key: 'preface', no: 1, isFront: true, name: '卷首 · 先读这里', sub: '在进入六十四卦之前，先建立正确的认知框架' },
  { key: 'basics',  no: 2, isFront: true, name: '基础篇 · 体', sub: '阴阳、八卦、爻位、成书 —— 六十四卦的语言与前提' },
  { key: 'method',  no: 3, isFront: true, name: '方法篇 · 用', sub: '怎么读、怎么用、怎么不读偏' },
  { key: 'shang',   no: 4, isFront: false, name: '上经 · 乾坤至离', sub: '自天地之始，至日月之明 —— 前三十卦', range: [1, 30] },
  { key: 'xia',     no: 5, isFront: false, name: '下经 · 咸恒至未济', sub: '自人伦之感，至事之未竟 —— 后三十四卦', range: [31, 64] },
];
function groupOf(n) { return n <= 30 ? 'shang' : 'xia'; }

/* ---------------- 正文片段 ---------------- */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function articleHTML(h) {
  const g = GROUPS.find((x) => x.key === groupOf(h.n));
  const yaoItems = h.yao.map((y, i) => {
    const pos = ['初', '二', '三', '四', '五', '上'][i];
    return `<li data-pos="${esc(pos)}">${esc(y)}${
      h.yaoXiang && h.yaoXiang[i] ? `<span class="yao-xiang">象曰：${esc(h.yaoXiang[i])}</span>` : ''
    }</li>`;
  }).join('\n');

  const kw = (h.keywords || []).map((k) => `<span class="kw">${esc(k)}</span>`).join('');

  return `<h2 id="s-gua">卦辞</h2>
<div class="scripture">
  <span class="sp-label">卦 辞</span>
  <p>${esc(h.gua)}</p>
</div>

<h2 id="s-tuan">彖传</h2>
<div class="scripture">
  <span class="sp-label">彖 传</span>
  <p>${esc(h.tuan)}</p>
</div>

<h2 id="s-xiang">大象传</h2>
<div class="scripture">
  <span class="sp-label">象 传</span>
  <p>${esc(h.xiang)}</p>
</div>

<h2 id="s-yao">爻辞 · 六爻</h2>
<ul class="yao-list">
${yaoItems}
</ul>
${h.yong ? `<div class="scripture"><span class="sp-label">附</span><p>${esc(h.yong)}</p></div>` : ''}

<h2 id="s-read">白话解读</h2>
<div class="vernacular">
  <span class="vn-label">现 代 解 读</span>
  <p>${esc(h.read)}</p>
</div>

<h2 id="s-use">处世应用</h2>
<div class="apply">
  <span class="ap-label">如 何 用 在 当 下</span>
  <p>${esc(h.use)}</p>
</div>

<h2 id="s-kw">关键词</h2>
<div class="kw-row">${kw}</div>
`;
}

/* ---------------- 前置篇正文片段 ---------------- */
function frontHTML(f) {
  const parts = [];
  for (const sec of f.body) {
    parts.push(`<h2 id="${esc(sec.id)}">${esc(sec.h)}</h2>`);
    for (const p of (sec.ps || [])) parts.push(`<p>${inline(p)}</p>`);
    if (sec.ul) {
      parts.push('<ul>' + sec.ul.map((li) => `<li>${inline(li)}</li>`).join('') + '</ul>');
    }
    for (const p of (sec.ps2 || [])) parts.push(`<p>${inline(p)}</p>`);
    if (sec.ul2) {
      parts.push('<ul>' + sec.ul2.map((li) => `<li>${inline(li)}</li>`).join('') + '</ul>');
    }
  }
  const kw = (f.keywords || []).map((k) => `<span class="kw">${esc(k)}</span>`).join('');
  if (kw) parts.push(`<h2 id="s-kw">关键词</h2>\n<div class="kw-row">${kw}</div>`);
  return parts.join('\n');
}

/* 支持 **加粗** 与「」的行内格式（先转义再替换，避免注入） */
function inline(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/* ---------------- manifest ---------------- */
const articles = ALL.map((h) => {
  const g = GROUPS.find((x) => x.key === groupOf(h.n));
  const plain = h.read + h.use;
  return {
    id: h.id,
    n: h.n,
    name: h.name,
    full: h.full,
    symbol: h.symbol,
    upper: h.upper,
    lower: h.lower,
    group: groupOf(h.n),
    groupName: g.name,
    groupSub: g.sub,
    yaoCount: h.yao.length,
    mins: Math.max(2, Math.round((h.gua.length + h.tuan.length + h.xiang.length + h.yao.join('').length + plain.length) / 420)),
    quote: h.gua.length > 46 ? h.gua.slice(0, 46) + '…' : h.gua,
    excerpt: h.read.length > 78 ? h.read.slice(0, 78) + '…' : h.read,
    keywords: h.keywords || [],
    secs: [
      { id: 's-gua', t: '卦辞' },
      { id: 's-tuan', t: '彖传' },
      { id: 's-xiang', t: '大象传' },
      { id: 's-yao', t: '爻辞 · 六爻' },
      { id: 's-read', t: '白话解读' },
      { id: 's-use', t: '处世应用' },
      { id: 's-kw', t: '关键词' },
    ],
  };
});

/* ---------------- 前置篇 manifest 条目 ---------------- */
const frontArticles = FRONT.map((f, i) => {
  const g = GROUPS.find((x) => x.key === f.group);
  const plain = f.body.flatMap((s) => [...(s.ps || []), ...(s.ul || []), ...(s.ps2 || []), ...(s.ul2 || [])]).join('');
  return {
    id: f.id,
    n: i + 1,                 // 目录内显示序号 1..13
    seq: i + 1,
    isFront: true,
    name: f.name,
    short: f.short,
    full: '',                 // 前置篇没有卦象全称
    symbol: '',
    upper: '', lower: '',
    group: f.group,
    groupName: g.name,
    groupSub: g.sub,
    yaoCount: 0,
    mins: f.mins || Math.max(3, Math.round(plain.length / 420)),
    quote: '',
    excerpt: f.excerpt || (plain.length > 78 ? plain.slice(0, 78) + '…' : plain),
    keywords: f.keywords || [],
    secs: f.body.map((s) => ({ id: s.id, t: s.h })),
  };
});

const manifest = {
  meta: {
    book: '周易六十四卦全解',
    version: '1.1',
    total: 64,
    frontTotal: frontArticles.length,
    groups: GROUPS.map((g) => ({
      ...g,
      count: g.isFront
        ? frontArticles.filter((a) => a.group === g.key).length
        : articles.filter((a) => a.group === g.key).length,
    })),
  },
  front: frontArticles,
  articles,
};

/* ---------------- 搜索索引 ---------------- */
const searchItems = [];

// 前置篇：按小节切分入索引
FRONT.forEach((f) => {
  const g = GROUPS.find((x) => x.key === f.group);
  searchItems.push({
    id: f.id, s: '◆', t: `${f.name} · ${f.title}`,
    w: '前置', k: (f.keywords || []).join(' '),
    x: f.excerpt || '',
  });
  f.body.forEach((sec) => {
    const text = [...(sec.ps || []), ...(sec.ul || []), ...(sec.ps2 || []), ...(sec.ul2 || [])]
      .join(' ').replace(/\*\*/g, '');
    searchItems.push({
      id: f.id, s: '◆', t: `${f.name} · ${sec.h}`,
      w: '前置', k: (f.keywords || []).join(' '),
      x: text,
    });
  });
});

ALL.forEach((h) => {
  const meta = articles.find((a) => a.id === h.id);
  searchItems.push({
    id: h.id, s: h.symbol, t: `${h.n}. ${h.name}卦 · ${h.full}`,
    w: '卦名', k: (h.keywords || []).join(' '),
    x: `${h.gua} ${h.read}`,
  });
  searchItems.push({
    id: h.id, s: h.symbol, t: `${h.name}卦 · 卦辞`,
    w: '经文', k: (h.keywords || []).join(' '),
    x: h.gua,
  });
  h.yao.forEach((y, i) => {
    searchItems.push({
      id: h.id, s: h.symbol, t: `${h.name}卦 · ${['初', '二', '三', '四', '五', '上'][i]}爻`,
      w: '爻辞', k: (h.keywords || []).join(' '),
      x: `${y} ${(h.yaoXiang && h.yaoXiang[i]) || ''}`,
    });
  });
  searchItems.push({
    id: h.id, s: h.symbol, t: `${h.name}卦 · 白话解读`,
    w: '解读', k: (h.keywords || []).join(' '),
    x: h.read,
  });
  searchItems.push({
    id: h.id, s: h.symbol, t: `${h.name}卦 · 处世应用`,
    w: '应用', k: (h.keywords || []).join(' '),
    x: h.use,
  });
});

/* ---------------- 写出 ---------------- */
const dataDir = join(ROOT, 'data');
const artDir = join(ROOT, 'articles');
if (existsSync(artDir)) rmSync(artDir, { recursive: true });
mkdirSync(dataDir, { recursive: true });
mkdirSync(artDir, { recursive: true });

writeFileSync(join(dataDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
writeFileSync(join(dataDir, 'search.json'), JSON.stringify({ items: searchItems }), 'utf8');

for (const h of ALL) {
  writeFileSync(join(artDir, `${h.id}.html`), articleHTML(h), 'utf8');
}
for (const f of FRONT) {
  writeFileSync(join(artDir, `${f.id}.html`), frontHTML(f), 'utf8');
}

/* ---------------- 报告 ---------------- */
console.log(`✅ 构建完成`);
console.log(`   前置篇      ${FRONT.length} 篇`);
console.log(`   卦数        ${ALL.length}`);
console.log(`   爻辞条数    ${ALL.reduce((s, h) => s + h.yao.length, 0)}`);
console.log(`   正文文件    articles/*.html  ×${ALL.length + FRONT.length}`);
console.log(`   搜索条目    ${searchItems.length}`);
console.log(`   manifest    data/manifest.json`);
