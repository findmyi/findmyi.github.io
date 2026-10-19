#!/usr/bin/env node
/* ==========================================================================
   处境索引数据
   --------------------------------------------------------------------------
   384 条「处境 → 铁律 → 例外」，怎么让用户找到对应的那一条？

   ⚠️ 走过的弯路：先试过「8 类困境」（想上去上不去 / 被打压 / 面临选择…），
   让外部模型打了 384 条标签，结果是硬套 ——
       S6「面临选择」占了 144 条（37.5%）
       S5「被打压」里混进了「谦·六五 该出兵了」这种意思相反的条目
   根因：8 类是对「用户感受」的猜测，而 384 条 Actual 内容是「爻位处境」。

   现在改用《周易》自身的结构：**六爻就是六个阶段**。
     初爻 = 位置最低、还没起来
     二爻 = 有了一点位置，开始被看见
     三爻 = 承上启下的中间态，最忙最险
     四爻 = 离核心很近，在关口上
     五爻 = 主位，最高
     上爻 = 过顶，该收了

   这是 384 条数据自带的、100% 准确的分类，不需要任何语义判断。

   输出：
     data/situ.json
       stages: [{ code, name, ask, desc, count }]
       items:  [{ n, gua, pos, stage, feel, verdict, situ, rule, exc, yao }]
       feel 是旧的外部标注（8 类），保留供「相近处境」用，不再作为主索引。
   ========================================================================== */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/* ---------------- 六个阶段 ----------------
   name  : 用户看得懂的阶段名
   ask   : 一句自测问句 —— 用户照着就能判断自己在哪
   desc  : 这个阶段的处境特征
   ------------------------------------------ */
const STAGES = [
  {
    code: 'P1', level: 1, name: '还没起来',
    ask: '你说的话没人听，做的事没人跟',
    desc: '位置最低的时候。有想法、有本事，但没有分量。这一阶段的功课不是表态，是攒。',
  },
  {
    code: 'P2', level: 2, name: '刚被看见',
    ask: '有人开始注意你了，但还不稳',
    desc: '从没人知道到有人知道你。活儿被人夸，人还没被记住。这一阶段要让人看见一次真本事。',
  },
  {
    code: 'P3', level: 3, name: '最难的中段',
    ask: '上面要交代，下面要带，两头受气',
    desc: '承上启下的位置。事都是你在推，锅也都是你在背。最忙、最险、也最容易出错。',
  },
  {
    code: 'P4', level: 4, name: '在关口上',
    ask: '离核心很近了，但要不要迈那一步，你不敢定',
    desc: '已经贴近决策圈，但还没进去。往前一步是核心，退后一步还是外人。这一阶段最考验判断。',
  },
  {
    code: 'P5', level: 5, name: '到顶了',
    ask: '位置最高，责任最重，反而睡不好',
    desc: '主位。所有人都看着你，所有决定都从你这儿出。这一阶段的危险不是做不成，是做过了。',
  },
  {
    code: 'P6', level: 6, name: '该收了',
    ask: '已经过顶了，感觉在往下走',
    desc: '物极必反的位置。硬待着会出事，体面地退反而是解法。这一阶段考的是分寸，不是能力。',
  },
];

const LEVELS = ['初', '二', '三', '四', '五', '上'];

/** 从「初九 / 九二 / 上六」里取爻序 1..6 */
function levelOf(pos) {
  const s = String(pos || '');
  if (!s) return 1;
  if (s[0] === '初') return 1;
  if (s[0] === '上') return 6;
  const i = ['二', '三', '四', '五'].indexOf(s[1]);
  return i >= 0 ? i + 2 : 1;
}

/* ---------------- 读源数据 ---------------- */
const ironPath = join(ROOT, 'build/_ironrules.json');
if (!existsSync(ironPath)) {
  console.error('❌ 找不到 build/_ironrules.json');
  process.exit(1);
}
const iron = JSON.parse(readFileSync(ironPath, 'utf8'));

/* ---------------- 旧标签（可选，仅作 feel 字段保留） ---------------- */
const tagsPath = join(ROOT, 'build/_situ-tags.json');
let feelMap = null;
if (existsSync(tagsPath)) {
  try {
    const arr = JSON.parse(readFileSync(tagsPath, 'utf8'));
    if (Array.isArray(arr) && arr.length === iron.length) {
      feelMap = new Map();
      for (const t of arr) feelMap.set(t.n + '|' + t.pos, t.main);
    }
  } catch { /* 忽略，feel 只是辅助信息 */ }
}

/* ---------------- 合并 ---------------- */
const items = iron.map((x) => {
  const lv = levelOf(x.pos);
  const st = STAGES[lv - 1];
  return {
    n: x.n,
    gua: x.gua,
    pos: x.pos,
    stage: st.code,
    level: lv,
    feel: feelMap ? (feelMap.get(x.n + '|' + x.pos) || '') : '',
    verdict: x.verdict,
    situ: x.situ,
    rule: x.rule,
    exc: x.exc,
    yao: x.yao,
  };
});

/* ---------------- 统计 ---------------- */
const counts = {};
for (const it of items) counts[it.stage] = (counts[it.stage] || 0) + 1;

const stages = STAGES.map((s) => ({ ...s, count: counts[s.code] || 0 }));

const out = {
  generated: new Date().toISOString().slice(0, 10),
  total: items.length,
  basis: '六爻阶段（《周易》固有结构，非语义猜测）',
  stages,
  items,
};

writeFileSync(join(ROOT, 'data/situ.json'), JSON.stringify(out), 'utf8');

console.log('✅ data/situ.json');
console.log('   索引方式：六爻阶段（数据自带结构，100% 准确）');
console.log('   条目：' + items.length);
console.log('   ' + stages.map((s) => s.code + ' ' + s.name + '=' + s.count).join('  '));
if (feelMap) console.log('   旧 8 类标注已降级为 feel 字段（供「相近处境」用）');
