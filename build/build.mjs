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
import { HEX_STORY } from './yao-story.mjs';
import { REF_SECTIONS, REF_STATS, CORPORA } from './refs-page.mjs';
import { PREMIUM, PREMIUM_IDS, premiumOf } from '../content/premium-content.mjs';
import { PREMIUM_V2, PREMIUM_V2_IDS } from '../content/premium-v2.mjs';

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
  { key: 'refs',    no: 6, isFront: true, name: '参考书目', sub: '经 · 注 · 史 —— 本站内容所依据的典籍' },
];
function groupOf(n) { return n <= 30 ? 'shang' : 'xia'; }

/* ---------------- 正文片段 ---------------- */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------------- 卦 · 历史故事（引流块） ----------------
 * 放在六爻之后，作为进入「完整解读」的钩子。
 * 该卦没有配故事时整块不输出，页面不会出现空壳。
 */
function hexStoryBlock(h) {
  const s = hexStoryOf(h.id);
  if (!s) return '';
  const tag = s.level === 'dian' ? '爻辞本旨' : '义理类比';
  return `
<aside class="hex-story" data-level="${esc(s.level)}">
  <div class="hs-head">
    <span class="hs-label">史 事</span>
    <span class="hs-who">${esc(s.who)}</span>
    <span class="hs-era">${esc(s.era)}</span>
    <span class="hs-tag" title="说明本故事与卦的关系">${tag}</span>
  </div>
  <p class="hs-text">${esc(s.text)}</p>
  <div class="hs-cta">
    <span class="hs-hook">${esc(s.hook)}</span>
    <a class="hs-btn" href="#/p/${esc(h.id)}">完整解读</a>
  </div>
</aside>`;
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

  /* ---------------- 付费段 ----------------
   * 只有 teaser（引子）会进静态 HTML。
   * depth（真正的深度正文）留在 content/premium-content.mjs 里，
   * 永远不写进静态产物 —— 这样绕过前端校验也拿不到内容。
   * 前端 renderPaywall() 据 data-premium 属性决定是否渲染付费卡。
   */
  const prem = premiumOf(h.id);
  let premiumSection = '';
  if (prem) {
    premiumSection = `
<section class="pw-gated" id="s-premium" data-premium="${esc(h.id)}" data-tier="${esc(prem.tier)}">
  <h2 id="p-teaser">深度解读 · 付费章节</h2>
  <div class="pw-teaser">
    <span class="pw-tag">PREMIUM</span>
    <p>${esc(prem.teaser)}</p>
    <span class="pw-more">完整章节包含逐爻拆解、历史印证与自测方法 —— 下方可解锁。</span>
  </div>
</section>
`;
  }

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
${premiumSection}
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

/* ---------------- 参考书目页正文 ---------------- */
function refsHTML() {
  const parts = [];
  parts.push(`<p>本站的经文校订、白话解读与处世应用，参考了下列著作。这些资料构成一套完整的
<strong>「经—注—史」三层结构</strong>：以《周易》原典为经，以历代注疏为解，以史书中的真实决策为印证。</p>`);

  parts.push(`<div class="ref-stats">
    <div><b>${REF_STATS.total}</b><span>部典籍</span></div>
    <div><b>${REF_STATS.volumes.toLocaleString()}</b><span>卷</span></div>
    <div><b>${REF_STATS.sections}</b><span>个门类</span></div>
  </div>`);

  for (const s of REF_SECTIONS) {
    parts.push(`<h2 id="ref-${s.key}">${esc(s.name)}</h2>`);
    parts.push(`<p class="ref-sub">${esc(s.sub)}　·　${s.items.length} 条</p>`);
    parts.push('<ul class="ref-list">');
    for (const it of s.items) {
      const vol = it.volumes ? `<span class="rf-vol">${it.volumes} 卷</span>` : '';
      const au = it.author ? `<span class="rf-au">${esc(it.author)}</span>` : '';
      parts.push(`<li>
        <span class="rf-tt">${esc(it.title)}</span>
        ${au}${vol}
      </li>`);
    }
    parts.push('</ul>');
  }

  return parts.join('\n');
}

/* ---------------- 伏羲六十四卦圆图次序 ----------------
 * 依据：
 *   邵雍《皇极经世》先天横图 + 朱熹《易學啟蒙》圆图说
 *   「圓圖之左方自震之初為冬至…以至於乾之末而交夏至；
 *     其右方自巽之初為夏至…以至于坤之末而交冬至」
 *
 * 算法：先按先天序（乾兑离震巽坎艮坤）生成横图 8×8，
 *       再把后半段倒序折回，弯成圆图。
 *
 * 校验特征（构建时强制断言）：
 *   ① index 0  = 乾          ② index 32 = 坤（正对乾）
 *   ③ 复紧邻坤（一阳来复）    ④ 对径 32 对全部互为错卦
 */
const XIANTIAN = ['乾', '兑', '离', '震', '巽', '坎', '艮', '坤'];
const TRI = {
  乾: [1, 1, 1], 兑: [1, 1, 0], 离: [1, 0, 1], 震: [1, 0, 0],
  巽: [0, 1, 1], 坎: [0, 1, 0], 艮: [0, 0, 1], 坤: [0, 0, 0],
};

const _heng = [];
for (const lo of XIANTIAN) {
  for (const up of XIANTIAN) {
    _heng.push({ lower: lo, upper: up, bin: [...TRI[lo], ...TRI[up]].join('') });
  }
}
const CIRCLE = [..._heng.slice(0, 32), ..._heng.slice(32).reverse()];

/** 二进制串 → 卦对象 */
const BIN2HEX = new Map(ALL.map((h) => [h.binary.join(''), h]));

// 构建时断言：圆图次序必须满足四条经典特征
{
  const errs = [];
  const at = (i) => BIN2HEX.get(CIRCLE[i].bin);

  if (at(0)?.name !== '乾') errs.push(`圆图 12 点应为乾，实为 ${at(0)?.name}`);
  if (at(32)?.name !== '坤') errs.push(`圆图 6 点应为坤，实为 ${at(32)?.name}`);
  if (at(31)?.name !== '复') errs.push(`坤位前一位应为复，实为 ${at(31)?.name}`);
  if (at(1)?.name !== '姤' && at(63)?.name !== '姤') errs.push('圆图缺少姤的一阴生位置');

  let pairs = 0;
  for (let i = 0; i < 32; i++) {
    const a = CIRCLE[i].bin, b = CIRCLE[(i + 32) % 64].bin;
    if ([...a].every((c, j) => c !== b[j])) pairs++;
  }
  if (pairs !== 32) errs.push(`对径互为错卦应 32 对，实为 ${pairs}`);

  if (errs.length) {
    console.error('❌ 圆图次序校验失败：');
    errs.forEach((e) => console.error('   - ' + e));
    process.exit(1);
  }
}

/** 每卦在圆图上的位置索引（供前端使用） */
const CIRCLE_ORDER = CIRCLE.map((c, i) => {
  const h = BIN2HEX.get(c.bin);
  return { i, id: h ? h.id : '', n: h ? h.n : 0, name: h ? h.name : '' };
});
const CIRCLE_INDEX = Object.fromEntries(CIRCLE_ORDER.filter((x) => x.id).map((x) => [x.id, x.i]));

/* ---------------- manifest ---------------- */
const articles = ALL.map((h) => {
  const g = GROUPS.find((x) => x.key === groupOf(h.n));
  const plain = h.read + h.use;
  const prem = premiumOf(h.id);
  return {
    id: h.id,
    n: h.n,
    name: h.name,
    full: h.full,
    symbol: h.symbol,
    upper: h.upper,
    lower: h.lower,
    binary: h.binary,
    group: groupOf(h.n),
    groupName: g.name,
    groupSub: g.sub,
    yaoCount: h.yao.length,
    /* tier 驱动前端的付费墙。缺省即 'free' —— 前端据此优雅降级：
       若整个 manifest 没有 tier 字段，全站都当作免费。 */
    tier: prem ? 'premium' : 'free',
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
      ...(prem ? [{ id: 'p-teaser', t: '深度解读 · 付费章节' }] : []),
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

/* ---------------- 参考书目 manifest 条目 ---------------- */
const refArticles = [
  {
    id: 'refs',
    n: 15,
    seq: 15,
    isFront: true,
    isRefs: true,
    name: '参考书目',
    short: '参考书目',
    title: '参考书目：本站内容所依据的典籍',
    full: '',
    symbol: '',
    upper: '', lower: '',
    group: 'refs',
    groupName: '参考书目',
    groupSub: '经 · 注 · 史 三层资料结构',
    yaoCount: 0,
    mins: 6,
    quote: '',
    excerpt: `${REF_STATS.total} 部典籍 · ${REF_STATS.volumes.toLocaleString()} 卷。含《周易》原典与今译、历代易学注疏、春秋占例、历代史料与历史人物。`,
    keywords: ['参考书目', '易学', '史料', '典籍'],
    secs: REF_SECTIONS.map((s) => ({ id: `ref-${s.key}`, t: s.name })),
  },
];

const frontAll = [...frontArticles, ...refArticles];

const manifest = {
  meta: {
    book: '周易六十四卦全解',
    version: '1.3',
    total: 64,
    frontTotal: frontAll.length,
    /** 伏羲圆图索引：id → 圆上第几位（0 = 正上乾，顺时针） */
    circleIndex: CIRCLE_INDEX,
    /* 首页小面板用的史事引流块：id → { who, era, text, hook }。
       只有配了故事的卦才出现在这里，前端据此决定是否渲染整块。 */
    hexStory: Object.fromEntries(
      Object.entries(HEX_STORY)
        // 留空的卦（text 为空）不进 manifest —— 前端据此隐藏整块，
        // 宁可没有，也不显示半截故事。
        .filter(([, s]) => s && typeof s.text === 'string' && s.text.trim())
        .map(([id, s]) => [id, {
          who: s.who, era: s.era, text: s.text, level: s.level,
        }])
    ),
    /* 付费配置摘要：前端据此构建付费卡（价格/交付物/样例）。
       若此字段缺失，前端自动降级为「全站免费」。 */
    premium: {
      enabled: PREMIUM_IDS.length > 0,
      ids: PREMIUM_IDS,
      count: PREMIUM_IDS.length,
      tiers: [...new Set(Object.values(PREMIUM).map((p) => p.tier))],
      /** 每篇的付费卡数据（不含 depth —— 那部分永不发布） */
      cards: Object.fromEntries(
        Object.entries(PREMIUM).map(([id, p]) => [id, {
          tier: p.tier,
          includes: p.includes || [],
          sample: p.sample || null,
        }])
      ),
    },
    groups: GROUPS.map((g) => ({
      ...g,
      count: g.isFront
        ? frontAll.filter((a) => a.group === g.key).length
        : articles.filter((a) => a.group === g.key).length,
    })),
  },
  front: frontAll,
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
  /* 付费章节只把 teaser 入索引 —— depth 不发布，自然也不进搜索 */
  if (premiumOf(h.id)) {
    searchItems.push({
      id: h.id, s: h.symbol, t: `${h.name}卦 · 深度解读（付费）`,
      w: '深度', k: (h.keywords || []).join(' ') + ' 深度解读 付费',
      x: premiumOf(h.id).teaser,
    });
  }
});

/* 参考书目：每部典籍单独入索引 */
REF_SECTIONS.forEach((s) => {
  s.items.forEach((it) => {
    searchItems.push({
      id: 'refs', s: '书', t: it.title,
      w: s.name, k: '参考书目 典籍 ' + s.name,
      x: `${it.author || ''} ${it.volumes ? it.volumes + '卷' : ''} ${s.sub}`,
    });
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
// 参考书目页
writeFileSync(join(artDir, 'refs.html'), refsHTML(), 'utf8');

/* ---------------- 报告 ---------------- */
const totalArticles = ALL.length + FRONT.length + 1;
console.log(`✅ 构建完成`);
console.log(`   前置篇      ${FRONT.length} 篇 + 参考书目 1 页`);
console.log(`   卦数        ${ALL.length}`);
console.log(`   爻辞条数    ${ALL.reduce((s, h) => s + h.yao.length, 0)}`);
console.log(`   正文文件    articles/*.html  ×${totalArticles}`);
console.log(`   参考典籍    ${REF_STATS.total} 部 · ${REF_STATS.volumes} 卷 · 语料 ${REF_STATS.corpus}`);
console.log(`   搜索条目    ${searchItems.length}`);
console.log(`   付费文章    ${PREMIUM_IDS.length} 篇（${PREMIUM_IDS.join(' / ')}）`);
if (PREMIUM_IDS.length) {
  const depthChars = Object.values(PREMIUM).reduce((s, p) => s + p.depth.length, 0);
  console.log(`   ↳ 付费正文  ${depthChars} 字【未发布】· 仅 teaser 进静态产物`);
}
console.log(`   manifest    data/manifest.json`);





