#!/usr/bin/env node
/**
 * KV 备份导出（键 + 值，jsonl，可 wrangler kv bulk put 恢复）
 * 用法：node build/backup-kv.mjs
 * 产出：worker/backups/kv-<时间戳>.jsonl
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ACCOUNT = '3c42788f6e1e9a866634592a37ca0da2';
const NS = '6abf60ac747241b58df60e9d4ce11cdf';
const TOKEN = readFileSync(join(ROOT, 'worker', '.cf-token'), 'utf8').trim();

const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/storage/kv/namespaces/${NS}`;

async function cfJson(path) {
  const r = await fetch(API + path, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors || j));
  return j.result;
}

async function cfText(path) {
  const r = await fetch(API + path, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + path);
  return await r.text();
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = join(ROOT, 'worker', 'backups');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `kv-${stamp}.jsonl`);

const keys = [];
let cursor = '';
do {
  const q = cursor ? `?per_page=1000&cursor=${encodeURIComponent(cursor)}` : '?per_page=1000';
  const r = await fetch(API + '/keys' + q, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors || j));
  const list = Array.isArray(j.result) ? j.result : (j.result && j.result.keys) || [];
  for (const k of list) keys.push(k.name);
  const info = j.result_info || {};
  cursor = info.cursor && !info.list_complete ? info.cursor : '';
} while (cursor);

let n = 0;
const lines = [];
for (const key of keys) {
  const val = await cfText(`/values/${encodeURIComponent(key)}`);
  lines.push(JSON.stringify({ key, value: val }));
  n++;
  if (n % 50 === 0) console.log(`  ... ${n}/${keys.length}`);
}

writeFileSync(out, lines.join('\n') + '\n', 'utf8');
console.log(`OK exported ${n} keys -> ${out}`);
console.log('Restore: cd worker && wrangler kv bulk put --binding=KEYS <file> --remote');
console.log('Keep a copy off this machine.');
