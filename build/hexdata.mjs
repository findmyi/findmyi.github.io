/* ==========================================================================
   经文数据查询
   --------------------------------------------------------------------------
   从 build/hex-*.mjs 汇总出「某卦免费区已公开的经文」。

   用途：付费墙测试需要区分两种「出现在静态页里的文字」——
     · 免费区本来就有的经文（卦辞/彖传/象传/爻辞/爻象）→ 正常，不算泄漏
     · 只应存在于 depth 里的解读文字 → 若出现在静态页就是泄漏
   没有这份数据，测试会把经文误判成泄漏。
   ========================================================================== */

import { HEX_1_16 } from './hex-01-16.mjs';
import { HEX_17_32 } from './hex-17-32.mjs';
import { HEX_33_48 } from './hex-33-48.mjs';
import { HEX_49_64 } from './hex-49-64.mjs';

const ALL = [...HEX_1_16, ...HEX_17_32, ...HEX_33_48, ...HEX_49_64];

/* 源文件用的 id 与 manifest 不完全一致，这里按卦序 n 建索引，避开该问题 */
const BY_N = new Map(ALL.map((h) => [h.n, h]));

/* manifest id → 卦序 n 的映射（由 data/manifest.json 提供，构建期注入亦可） */
import { readFileSync } from 'node:fs';
let ID_TO_N = new Map();
try {
  const man = JSON.parse(
    readFileSync(new URL('../data/manifest.json', import.meta.url), 'utf8'));
  ID_TO_N = new Map(man.articles.map((a) => [a.id, a.n]));
} catch {
  /* manifest 尚未生成时留空 —— 调用方会退化为按 id 直查 */
}

/**
 * 取某卦免费区已公开的全部经文句子。
 * @param {string} id manifest 里的卦 id
 * @returns {string[]} 经文句子数组（未去重，调用方按需处理）
 */
export function scriptureOf(id) {
  const n = ID_TO_N.get(id);
  const h = n != null ? BY_N.get(n) : ALL.find((x) => x.id === id);
  if (!h) return [];
  const out = [];
  for (const key of ['gua', 'tuan', 'xiang', 'read', 'use']) {
    if (h[key]) out.push(String(h[key]));
  }
  for (const key of ['yao', 'yaoXiang']) {
    if (Array.isArray(h[key])) out.push(...h[key].map(String));
  }
  return out;
}

/** 按卦序取整条数据 */
export function hexOf(n) {
  return BY_N.get(n) || null;
}

export const ALL_HEXES = ALL;

