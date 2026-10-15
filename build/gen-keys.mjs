#!/usr/bin/env node
/**
 * 授权码生成器
 * ---------------------------------------------------------------------------
 * 用法：
 *   node build/gen-keys.mjs                      # 默认生成 20 个 PREM 码
 *   node build/gen-keys.mjs --n 100              # 生成 100 个
 *   node build/gen-keys.mjs --tier QK --n 50     # 生成乾坤专享码（等同 QK00）
 *   node build/gen-keys.mjs --note "小红书6月"    # 标注批次
 *   node build/gen-keys.mjs --out build/keys.csv # 指定输出路径
 *
 * 输出 CSV 列：key, tier, issued, note
 *   key    授权码本体
 *   tier   等级（PREM / QK00）
 *   issued 签发时间（ISO 8601）
 *   note   批次备注
 *
 * 算法与 assets/license.js 完全一致（FNV-1a + 32 字符无歧义字母表）。
 * ---------------------------------------------------------------------------
 * ⚠️ 安全提醒：本方案是【离线校验】，任何拿到算法的人都能自造授权码。
 *    本脚本生成的是「方便你发货」，不是「防破解」。详见
 *    content/premium-guide.md 与 assets/paywall-worker.example.js。
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/* ---------------- 与前端保持一字不差的算法 ---------------- */
const PREFIX = 'ZY';
/* 无歧义字符表：去掉 0 O 1 I L U —— 共 30 个字符。
   校验位 = ALPHABET[fnv1a(body) % ALPHABET.length]。
   必须与 assets/license.js 完全一致，改动请同步三处
   （license.js / gen-keys.mjs / paywall-worker.example.js）。 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
/* 等级码必须【定长 4 字符】：授权码靠位置切片解析，
   长度不齐会让后面的随机体与校验位整体错位。 */
const TIERS = ['PREM', 'QK00'];                    // 与 assets/license.js 的 TIERS 对齐
const TIER_LABEL = { PREM: '全站通行', QK00: '乾坤专享' };

function fnv1a(s) {
  let h = 0x811c9dc5;
  const str = String(s).toUpperCase();
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

const checksum = (body) => ALPHABET[fnv1a(body) % ALPHABET.length];

/** 随机取 n 个字符（crypto.randomInt，避免 Math.random 的可预测性） */
function randBlock(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[randomInt(0, ALPHABET.length)];
  return s;
}

/** 生成一个授权码：ZY-TTTT-XXXX-XXXX-C */
function makeKey(tier) {
  // 最多重试几次，避免极端情况下重复
  for (let attempt = 0; attempt < 10; attempt++) {
    const body = [PREFIX, tier, randBlock(4), randBlock(4)].join('-');
    const key = `${body}-${checksum(body)}`;
    if (!SEEN.has(key)) { SEEN.add(key); return key; }
  }
  throw new Error('生成授权码失败：随机体反复碰撞（几乎不可能发生）');
}

const SEEN = new Set();

/* ---------------- 参数解析 ---------------- */
function parseArgs(argv) {
  const out = { n: 20, tier: 'PREM', note: '', out: 'build/keys.csv', json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--n' || a === '-n') out.n = Number(argv[++i]);
    else if (a === '--tier' || a === '-t') out.tier = String(argv[++i]).toUpperCase();
    else if (a === '--note') out.note = String(argv[++i]);
    else if (a === '--out' || a === '-o') out.out = String(argv[++i]);
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else { console.error(`未知参数：${a}`); process.exit(1); }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`授权码生成器

  node build/gen-keys.mjs [选项]

  --n, -n <数量>     生成多少个（默认 20）
  --tier, -t <等级>  授权等级：${TIERS.join(' | ')}（默认 PREM）
                     其中 ${TIERS.map((t) => `${t}=${TIER_LABEL[t]}`).join('，')}
  --note <文本>      批次备注，写进 CSV 的 note 列
  --out, -o <路径>   输出文件（默认 build/keys.csv）
  --json             以 JSON 输出到 stdout，不写文件
  -h, --help         显示本帮助`);
  process.exit(0);
}

if (!TIERS.includes(args.tier)) {
  // 宽容匹配：允许只写 "QK" 之类的简写，自动补零到定长
  const guess = TIERS.find((t) => t.startsWith(args.tier));
  if (args.tier.length >= 2 && guess) {
    console.log(`  · 等级「${args.tier}」按定长规则等同于「${guess}」`);
    args.tier = guess;
  } else {
    console.error(`❌ 未知等级「${args.tier}」，可选：${TIERS.join(' / ')}`);
    process.exit(1);
  }
}
if (!Number.isInteger(args.n) || args.n < 1 || args.n > 100000) {
  console.error('❌ --n 必须是 1..100000 之间的整数');
  process.exit(1);
}

/* ---------------- 生成 ---------------- */
const issued = new Date().toISOString();
const rows = [];
for (let i = 0; i < args.n; i++) {
  rows.push({ key: makeKey(args.tier), tier: args.tier, issued, note: args.note });
}

/* ---- 自检：生成的每一个码都必须能通过校验 ---- */
for (const r of rows) {
  const s = r.key.replace(/-/g, '');
  const body = `${s.slice(0, 2)}-${s.slice(2, 6)}-${s.slice(6, 10)}-${s.slice(10, 14)}`;
  if (checksum(body) !== s.slice(14, 15)) {
    console.error(`❌ 自检失败：${r.key} 校验位不匹配`);
    process.exit(1);
  }
}

/* ---------------- 输出 ---------------- */

/** CSV 字段转义：含逗号/引号/换行时用双引号包裹 */
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

if (args.json) {
  console.log(JSON.stringify({ count: rows.length, keys: rows }, null, 2));
  process.exit(0);
}

const outPath = resolve(ROOT, args.out);
mkdirSync(dirname(outPath), { recursive: true });
if (!existsSync(dirname(outPath))) {
  console.error(`❌ 无法创建输出目录：${dirname(outPath)}`);
  process.exit(1);
}

// 前面加 BOM，Excel 打开中文备注不乱码
const csv = '\uFEFF' + [
  'key,tier,issued,note',
  ...rows.map((r) => [r.key, r.tier, r.issued, r.note].map(csvCell).join(',')),
].join('\r\n') + '\r\n';

writeFileSync(outPath, csv, 'utf8');

/* ---------------- 报告 ---------------- */
console.log('✅ 授权码生成完成');
console.log(`   数量      ${rows.length}`);
console.log(`   等级      ${args.tier}`);
console.log(`   批次备注  ${args.note || '（无）'}`);
console.log(`   输出      ${outPath}`);
console.log('');
console.log('   前 5 个：');
rows.slice(0, 5).forEach((r) => console.log(`     ${r.key}`));
if (rows.length > 5) console.log(`     … 其余 ${rows.length - 5} 个见 CSV`);
console.log('');
console.log('   ⚠️  离线校验只能防顺手转发，不能防破解。');
console.log('      单份内容价值较高时，请按 content/premium-guide.md 升级到');
console.log('      Cloudflare Worker 服务端校验（模板见 assets/paywall-worker.example.js）。');
