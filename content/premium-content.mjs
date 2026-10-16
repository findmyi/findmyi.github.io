/* ==========================================================================
   付费内容配置
   --------------------------------------------------------------------------
   结构：
     PREMIUM[id] = {
       tier,       授权等级（PREM = 全站通行）
       teaser,     免费可见的引子（进静态 HTML）
       depth,      付费正文（【绝不】进静态产物）
       sample,     样例节选（进付费卡，给读者尝一口）
       includes,   交付物清单（进付费卡）
     }

   ⚠️ 铁律：depth 只在构建期供校验使用，绝不写入 articles/*.html。
      绕过前端校验也拿不到内容 —— 因为静态文件里根本没有。

   depth 的真实内容在 premium-v3.mjs（由 build/md2premium.py 从
   content/v2/*.md 与 content/新版-*.md 生成）。本文件只做装配。
   ========================================================================== */

import { PREMIUM_V3, PREMIUM_V3_IDS } from './premium-v3.mjs';

/** 每卦一致的交付说明 —— 读者关心的是「我买到什么」 */
const INCLUDES = [
  '六爻逐爻拆解：每一爻给你处境定位、具体动作、例外情况',
  '一个真实的历史选择：谁在同样的位置上做对了或做错了',
  '一句能带走的判词：好记，能用',
];

/** 每卦的引子：说明付费部分解决什么问题（免费部分只讲「这一卦说什么」） */
function teaserFor(name) {
  return `上面讲的是${name}卦说了什么。下面讲的是——你现在在这个位置上，具体该怎么做。`;
}

/** 样例：取 depth 的开头两段，让读者先尝一口。
 *  字段名必须是 quote / body / fade —— app.js 的付费卡按这三个字段渲染。 */
function sampleOf(html) {
  const paras = [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, '').trim())
    .filter((s) => s.length > 20);
  if (!paras.length) return null;
  const quote = paras[0];
  const body = paras[1] || '';
  return {
    quote,
    body,
    fade: '……',
  };
}

export const PREMIUM = {};
for (const id of PREMIUM_V3_IDS) {
  const depth = PREMIUM_V3[id];
  PREMIUM[id] = {
    tier: 'PREM',
    teaser: teaserFor('这一'),
    depth,
    sample: sampleOf(depth),
    includes: INCLUDES,
  };
}

/* 引子里带上卦名，读起来更具体 */
const NAME_FIX = {
  qian: '乾', kun: '坤', zhun: '屯', meng: '蒙', xu: '需', song: '讼',
  shi: '师', bi: '比', xiaoxu: '小畜', lvlv: '履', tai: '泰', pi: '否',
  tongren: '同人', dayou: '大有', qian2: '谦', yu: '豫', sui: '随', gu: '蛊',
  lin: '临', guan: '观', shike: '噬嗑', bi2: '贲', bo: '剥', fu: '复',
  wuwang: '无妄', daxu: '大畜', yi: '颐', daguo: '大过', kan: '坎', li: '离',
  xian: '咸', heng: '恒', dun: '遁', dazhuang: '大壮', jin: '晋', mingyi: '明夷',
  jiaren: '家人', kui: '睽', jian: '蹇', xie: '解', sun: '损', yiyi: '益',
  guai: '夬', gou: '姤', cui: '萃', sheng: '升', kun4: '困', jing: '井',
  ge: '革', ding: '鼎', zhen: '震', gen: '艮', jianjian: '渐', guimei: '归妹',
  feng: '丰', lv: '旅', xun: '巽', dui: '兑', huan: '涣', jie: '节',
  zhongfu: '中孚', xiaoguo: '小过', jiji: '既济', weiji: '未济',
};
for (const [id, name] of Object.entries(NAME_FIX)) {
  if (PREMIUM[id]) PREMIUM[id].teaser = teaserFor(name);
}

export const PREMIUM_IDS = Object.keys(PREMIUM);

export function premiumOf(id) {
  return PREMIUM[id] || null;
}

