#!/usr/bin/env node
/* ==========================================================================
   处境索引数据
   --------------------------------------------------------------------------
   把 384 条「处境 → 铁律 → 例外」变成可检索的数据。

   数据来源（按优先级）：
     1. build/_situ-tags.json   —— WorkBuddy 打的标签（人工语义标注，最准）
     2. 兜底：按爻位自动映射（粗糙，但保证功能可用）

   输出：data/situ.json
     {
       "tags": [{ code, name, desc, count }],
       "items": [{ n, gua, pos, tag, subs, verdict, situ, rule, exc }]
     }
   ========================================================================== */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/* ---------------- 8 个标签 ---------------- */
const TAGS = [
  { code: 'S1', name: '想上去，上不去', desc: '位置低、有本事、没机会，说了没人听' },
  { code: 'S2', name: '刚被看见，站不稳', desc: '刚出头、刚提拔，根基还浅，有人盯着' },
  { code: 'S3', name: '卡在中间', desc: '承上启下，两头受气，最忙也最容易背锅' },
  { code: 'S4', name: '到了高位，怕掉', desc: '已经成了，位置最高，反而睡不好' },
  { code: 'S5', name: '被打压，动不了', desc: '被排挤、被算计、被架空，动一下就错' },
  { code: 'S6', name: '面临选择，不敢动', desc: '要不要做、选哪个，站在关口上' },
  { code: 'S7', name: '已经崩了，要重来', desc: '失败了、损失已成，得从头收拾' },
  { code: 'S8', name: '在等，什么也做不了', desc: '时机不到，只能熬着' },
];

/* 兜底：按爻位映射（初→S1 二→S2 三→S3 四→S6 五→S4 上→S7）
   ⚠️ pos 的格式是「初九 / 九二 / 六三 / 上六」——
   爻序可能在首字（初、上），也可能在次字（二三四五）。 */
const LEVEL_TAG = ['S1', 'S2', 'S3', 'S6', 'S4', 'S7'];   // 1..6 爻

function levelOf(pos) {
  const s = String(pos || '');
  if (!s) return 1;
  if (s[0] === '初') return 1;
  if (s[0] === '上') return 6;
  const idx = ['二', '三', '四', '五'].indexOf(s[1]) + 2;
  return idx >= 2 ? idx : 1;
}

/* ---------------- 读源数据 ---------------- */
const ironPath = join(ROOT, 'build/_ironrules.json');
if (!existsSync(ironPath)) {
  console.error('❌ 找不到 build/_ironrules.json');
  process.exit(1);
}
const iron = JSON.parse(readFileSync(ironPath, 'utf8'));

/* ---------------- 读标签（可能没有） ---------------- */
const tagsPath = join(ROOT, 'build/_situ-tags.json');
let tagMap = null;
let tagSource = 'fallback';
if (existsSync(tagsPath)) {
  try {
    const arr = JSON.parse(readFileSync(tagsPath, 'utf8'));
    if (Array.isArray(arr) && arr.length === iron.length) {
      tagMap = new Map();
      for (const t of arr) {
        tagMap.set(t.n + '|' + t.pos, { main: t.main, sub: t.sub || [] });
      }
      tagSource = 'workbuddy';
    } else {
      console.warn('⚠️ _situ-tags.json 条数不对（' + (arr && arr.length) + '/' + iron.length + '），改用兜底');
    }
  } catch (e) {
    console.warn('⚠️ _situ-tags.json 解析失败：' + e.message + '，改用兜底');
  }
}

/* ---------------- 合并 ---------------- */
const items = iron.map((x) => {
  let main, subs;
  if (tagMap) {
    const t = tagMap.get(x.n + '|' + x.pos);
    main = t ? t.main : 'S1';
    subs = t ? t.sub : [];
  } else {
    main = LEVEL_TAG[levelOf(x.pos) - 1] || 'S1';
    subs = [];
  }
  return {
    n: x.n,
    gua: x.gua,
    pos: x.pos,
    tag: main,
    subs,
    verdict: x.verdict,
    situ: x.situ,
    rule: x.rule,
    exc: x.exc,
    yao: x.yao,
  };
});

/* ---------------- 统计 ---------------- */
const counts = {};
for (const it of items) counts[it.tag] = (counts[it.tag] || 0) + 1;

const tags = TAGS.map((t) => ({ ...t, count: counts[t.code] || 0 }));

const out = {
  generated: new Date().toISOString().slice(0, 10),
  source: tagSource,
  total: items.length,
  tags,
  items,
};

writeFileSync(join(ROOT, 'data/situ.json'), JSON.stringify(out), 'utf8');

console.log('✅ data/situ.json');
console.log('   数据来源：' + (tagSource === 'workbuddy' ? 'WorkBuddy 语义标注' : '兜底（按爻位，替换标签后可提升质量）'));
console.log('   条目：' + items.length);
console.log('   分布：' + tags.map((t) => t.code + '=' + t.count).join('  '));
