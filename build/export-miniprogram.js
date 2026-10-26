/**
 * 小程序素材生成器
 * 从网站的 situ.json / quiz.js 提取，输出成小程序能直接 require 的格式
 */

const fs = require('fs');
const path = require('path');

const ROOT = 'D:/zhouyi-site';
const OUT = path.join(ROOT, 'miniprogram/data');

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

/* ---------------- 1. 处境数据（384 条，精简字段） ---------------- */
const situ = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/situ.json'), 'utf8'));

// 字段名压到最短，能省 30% 体积
const slim = situ.items.map((x) => ({
  n: x.n,
  g: x.gua,           // 卦名
  p: x.pos,           // 爻位
  s: x.stage,         // 阶段 P1-P6
  v: x.verdict,       // 判词（一句话）
  w: x.situ,          // 你在哪
  r: x.rule,          // 该做什么
  e: x.exc || '',     // 什么情况下不适用
  y: x.yao || '',     // 爻辞原文（四个字，如「潜龙勿用」）
}));

/* 按阶段分组 —— 用【数组下标】做唯一 key
   注意：原数据里 n 是「卦号」1-64，每卦六爻共用同一个 n。
   用它当 key 会让每卦只剩最后一条（上爻），这是踩过的坑。 */
const byStage = {};
slim.forEach((it, i) => {
  if (!byStage[it.s]) byStage[it.s] = [];
  byStage[it.s].push(i);
});

const situJs = `/**
 * 处境数据 · 384 条
 * 由网站 data/situ.json 生成，字段名已压缩以省包体
 *
 * g  卦名（乾/坤/屯…）      共 64 卦
 * p  爻位（初九/六二/…）    每卦 6 条
 * s  阶段 P1-P6             每阶段 64 条
 * v  判词（12 字，一句话）
 * w  你在哪（61 字）
 * r  该做什么（98 字）
 * e  什么情况下不适用（65 字）
 * y  爻辞原文（如「潜龙勿用」）
 *
 * ⚠️ 没有唯一 id 字段！
 *    原始数据的 n 是「卦号 1-64」，每卦六爻共用，不能当 key。
 *    取单条请用【数组下标】或 ofStage/ofGua 返回的对象本身。
 */

const SITUATIONS = ${JSON.stringify(slim)};

/** 阶段 → 数组下标（不是卦号！） */
const STAGE_INDEX = ${JSON.stringify(byStage)};

/** 按阶段取全部处境（每组 64 条） */
function ofStage(code) {
  return (STAGE_INDEX[code] || []).map((i) => SITUATIONS[i]);
}

/** 按卦名取该卦的六条（初爻到上爻） */
function ofGua(gua) {
  return SITUATIONS.filter((x) => x.g === gua);
}

/** 按数组下标取一条（0-383） */
function at(i) {
  return SITUATIONS[i] || null;
}

/** 全部 64 卦名，按通行卦序 */
const GUA_ORDER = ${JSON.stringify([...new Set(slim.map((x) => x.g))])};

module.exports = { SITUATIONS, STAGE_INDEX, GUA_ORDER, ofStage, ofGua, at };
`;

fs.writeFileSync(path.join(OUT, 'situations.js'), situJs, 'utf8');
console.log('✓ situations.js  ' + (Buffer.byteLength(situJs) / 1024).toFixed(0) + ' KB  （384 条）');

/* ---------------- 2. 题库 + 六阶段 ---------------- */
const quizSrc = fs.readFileSync(path.join(ROOT, 'assets/quiz.js'), 'utf8');
global.window = {};
eval(quizSrc);
const Q = global.window.Quiz;

// 六个阶段
const stages = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map((code) => {
  const st = Q.stageOf(code);
  return {
    code,
    name: st.name,
    ask: st.ask,
    summary: st.summary,
    advice: st.advice,
    caution: st.caution,
  };
});

// 通用题 8 道
const common = Q.common.map((q) => ({
  id: q.id,
  q: q.q,
  hint: q.hint || '',
  opts: q.opts.map((o) => ({ t: o.t, s: o.s })),
}));

// 三套分流题
const tracks = [
  { key: 'work', name: '工作上的位置，或者去留', qs: [] },
  { key: 'money', name: '钱的事 —— 收入、投入、值不值', qs: [] },
  { key: 'love', name: '和某个人的关系', qs: [] },
];

for (const t of tracks) {
  const list = Q.tracks[t.key] || [];
  t.qs = list.map((q) => ({
    id: q.id,
    q: q.q,
    hint: q.hint || '',
    opts: q.opts.map((o) => ({ t: o.t, s: o.s })),
  }));
}

const quizJs = `/**
 * 题库 + 六阶段
 * 由网站 assets/quiz.js 生成
 *
 * 结构：
 *   1 道分流题（三选一）→ 8 道通用题 + 4 道领域题 = 12 题
 *   计分后落到 P1-P6 之一
 */

/** 分流题 */
const SCREEN = {
  q: ${JSON.stringify(Q.screen.q)},
  opts: ${JSON.stringify(Q.screen.opts.map((o) => ({ t: o.t, track: o.track })))},
};

/** 八个阶段（每个阶段含：一句话、说明、该做什么、什么时候不适用） */
const STAGES = ${JSON.stringify(stages, null, 2)};

/** 通用题 8 道（三套都要答） */
const COMMON = ${JSON.stringify(common, null, 2)};

/** 领域题，每套 4 道 */
const TRACKS = ${JSON.stringify(tracks, null, 2)};

const SCORE_ORDER = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];

/**
 * 计分：把所有被选中选项的分值累加，取得分最高的阶段
 * @param {Array} answers  每个元素是选中选项的 { s: {P1:3, P2:1} }
 * @returns {string} P1-P6
 */
function score(answers) {
  const total = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0 };
  for (const a of answers) {
    if (!a || !a.s) continue;
    for (const k of Object.keys(a.s)) {
      total[k] = (total[k] || 0) + a.s[k];
    }
  }
  let best = 'P3';
  let bestVal = -1;
  for (const k of SCORE_ORDER) {
    if (total[k] > bestVal) {
      bestVal = total[k];
      best = k;
    }
  }
  return best;
}

/** 取某套题的全部题目（8 通用 + 4 领域） */
function questionsFor(track) {
  const t = TRACKS.find((x) => x.key === track);
  return COMMON.concat(t ? t.qs : []);
}

/** 取阶段信息 */
function stageOf(code) {
  return STAGES.find((x) => x.code === code) || null;
}

module.exports = { SCREEN, STAGES, COMMON, TRACKS, score, questionsFor, stageOf, TOTAL: COMMON.length + 4 };
`;

fs.writeFileSync(path.join(OUT, 'quiz.js'), quizJs, 'utf8');
console.log('✓ quiz.js        ' + (Buffer.byteLength(quizJs) / 1024).toFixed(0) + ' KB  （12 题 × 3 套 + 6 阶段）');

/* ---------------- 3. 挑出的「三条处境」逻辑 ---------------- */
const pickerJs = `/**
 * 从某阶段里挑出最像用户的 3 条处境
 *
 * 选法：把该阶段的 64 条按「判词冲击力」排一下 ——
 * 判词短的更有力，太长的人记不住。
 * 再均匀取 3 条，避免全是同一个卦。
 */

const { ofStage } = require('./situations');

function pickThree(stageCode) {
  const list = ofStage(stageCode).slice();

  // 判词 8-16 字的优先（太长记不住，太短没味道）
  list.sort((a, b) => {
    const da = Math.abs((a.v || '').length - 12);
    const db = Math.abs((b.v || '').length - 12);
    return da - db;
  });

  const picked = [];
  const usedGua = new Set();

  for (const it of list) {
    if (picked.length >= 3) break;
    // 尽量不同卦
    if (usedGua.has(it.g)) continue;
    usedGua.add(it.g);
    picked.push(it);
  }

  // 不够三条就放宽限制
  for (const it of list) {
    if (picked.length >= 3) break;
    if (!picked.includes(it)) picked.push(it);
  }

  return picked;
}

module.exports = { pickThree };
`;

fs.writeFileSync(path.join(OUT, 'picker.js'), pickerJs, 'utf8');
console.log('✓ picker.js      ' + (Buffer.byteLength(pickerJs) / 1024).toFixed(1) + ' KB  （挑三条处境的算法）');

/* ---------------- 4. 校验 ---------------- */
console.log('');
console.log('=== 校验 ===');
const totalSize = fs.readdirSync(OUT).reduce((a, f) => a + fs.statSync(path.join(OUT, f)).size, 0);
console.log('  总大小: ' + (totalSize / 1024).toFixed(0) + ' KB  （小程序主包上限 2 MB）');
console.log('  处境条数: ' + slim.length);
console.log('  阶段数: ' + stages.length);
console.log('  通用题: ' + common.length + ' 道');
console.log('  领域题: ' + tracks.map((t) => t.key + ' ' + t.qs.length + ' 道').join(' / '));
console.log('  单套题数: ' + (common.length + 4) + ' 道');
