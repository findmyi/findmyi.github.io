#!/usr/bin/env node
/* ==========================================================================
   生成授权码 → 直接写成 Cloudflare KV 的批量导入格式
   --------------------------------------------------------------------------
   为什么不用 Worker 的 /issue 接口：
     本机的 PowerShell TLS 栈与系统代理不兼容，连不上 *.workers.dev。
     但 wrangler 走 api.cloudflare.com（能通），所以直接写 KV 更稳。

   生成的 KV 记录格式必须和 Worker 里的 redeem 分支一致：
     key:<无连字符大写码>  →  {"tier":"PREM","bind":null,"used":0,"at":null}

   用法：
     node worker/gen-keys-kv.mjs --n 200 --tier PREM
   产出：
     worker/keys-kv.json       ← wrangler kv bulk put 用
     worker/keys-PREM-200.txt  ← 给人看的码列表
   ========================================================================== */

import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v === undefined ? true : v];
    })
);

const N = Number(args.n || 200);
const TIER = String(args.tier || 'PREM').toUpperCase();
const OUT_JSON = join(HERE, 'keys-kv.json');
const OUT_TXT = join(HERE, `keys-${TIER}-${N}.txt`);

/* ---- 与 assets/license.js 完全一致的算法 ---- */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';   // 30 字符，去掉 0 O 1 I L U
const KEY_LEN = 15;                                   // ZY + 等级4 + 随机4 + 随机4 + 校验1

function fnv1a(s) {
  let h = 0x811c9dc5;
  const str = String(s).toUpperCase();
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function checksum(body) {
  return ALPHABET[fnv1a(body) % ALPHABET.length];
}

function pretty(s) {
  return [s.slice(0, 2), s.slice(2, 6), s.slice(6, 10), s.slice(10, 14), s.slice(14)].join('-');
}

/* ---- 生成 ---- */
const ALPHA_LEN = KEY_LEN - 1;   // 前 14 位：ZY + 4 位等级 + 8 位随机
if (TIER.length !== 4) {
  console.error('❌ 等级必须是 4 个字符，例如 PREM / FULL / QK00');
  process.exit(1);
}

const seen = new Set();
const keys = [];

while (keys.length < N) {
  const buf = randomBytes(8);
  let r1 = '', r2 = '';
  for (let i = 0; i < 4; i++) r1 += ALPHABET[buf[i] % ALPHABET.length];
  for (let i = 4; i < 8; i++) r2 += ALPHABET[buf[i] % ALPHABET.length];

  // ⚠️ 关键：license.js 的 checksum() 吃的是【带连字符】的 body
  //    形如 "ZY-PREM-7K2M-9QX4"，不是无连字符的。
  const body = ['ZY', TIER, r1, r2].join('-');
  const ck = checksum(body);
  const prettyKey = body + '-' + ck;              // ZY-PREM-XXXX-XXXX-C
  const rawKey = prettyKey.replace(/-/g, '');      // ZYPREMXXXXXXXXC（15 位）

  if (seen.has(rawKey)) continue;
  seen.add(rawKey);
  keys.push({ raw: rawKey, pretty: prettyKey });
}

/* ---- 两种输出 ---- */
const kvRows = keys.map((k) => ({
  key: 'key:' + k.raw,
  value: JSON.stringify({ tier: TIER, bind: null, used: 0, at: null }),
}));

writeFileSync(OUT_JSON, JSON.stringify(kvRows, null, 0), 'utf8');
writeFileSync(OUT_TXT, keys.map((k) => k.pretty).join('\n') + '\n', 'utf8');

console.log('✅ 生成 ' + keys.length + ' 个 ' + TIER + ' 授权码');
console.log('   KV 导入文件: ' + OUT_JSON + '  (' + (kvRows.length) + ' 条)');
console.log('   码列表:      ' + OUT_TXT);
console.log('');
console.log('   前三个: ' + keys.slice(0, 3).map((k) => k.pretty).join('  '));
console.log('');
console.log('下一步：');
console.log('   cd D:\\zhouyi-site\\worker');
console.log('   wrangler kv bulk put --binding=KEYS keys-kv.json --remote');
