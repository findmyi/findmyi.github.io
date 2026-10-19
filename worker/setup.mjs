#!/usr/bin/env node
/* ==========================================================================
   一键部署 Cloudflare Worker
   --------------------------------------------------------------------------
   前提：已经跑过 `wrangler login` 并且授权成功。

   做这几件事（每步都能单独跑）：
     1. 检查登录状态
     2. 建 KV 命名空间 ZHOUYI（已存在则复用）
     3. 把 KV id 写进 wrangler.toml
     4. 部署 Worker
     5. 设置 ADMIN_TOKEN（可用 --token=xxx 指定，否则随机生成）
     6. 批量灌入 64 篇付费正文
     7. 生成首批授权码（默认 200 个）

   用法：
     node worker/setup.mjs                 # 全跑
     node worker/setup.mjs --step=kv       # 只建 KV
     node worker/setup.mjs --step=deploy
     node worker/setup.mjs --step=token
     node worker/setup.mjs --step=content
     node worker/setup.mjs --step=keys --count=200 --tier=PREM
   ========================================================================== */

import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOML = join(HERE, 'wrangler.toml');
const KV_JSON = join(HERE, 'content-kv.json');
const WRANGLER = process.env.WRANGLER_BIN || 'wrangler';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v === undefined ? true : v];
    })
);

const step = args.step || 'all';

function run(cmd, opts = {}) {
  process.stdout.write('  $ ' + cmd + '\n');
  return execSync(cmd, {
    cwd: HERE,
    encoding: 'utf8',
    stdio: opts.quiet ? 'pipe' : 'inherit',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
}

function runCapture(cmd) {
  process.stdout.write('  $ ' + cmd + '\n');
  return execSync(cmd, {
    cwd: HERE,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
}

/* ---------------- 1. 检查登录 ---------------- */
function checkLogin() {
  console.log('\n[1/7] 检查登录状态');
  try {
    const out = runCapture(`${WRANGLER} whoami`);
    if (/not authenticated/i.test(out)) {
      console.error('\n❌ 还没登录。先跑：wrangler login');
      process.exit(1);
    }
    console.log('  ✓ 已登录');
    return out;
  } catch (e) {
    const msg = (e.stdout || '') + (e.stderr || '');
    if (/not authenticated/i.test(msg)) {
      console.error('\n❌ 还没登录。先跑：wrangler login');
      process.exit(1);
    }
    console.log('  ⚠ whoami 输出异常，继续尝试');
    return msg;
  }
}

/* ---------------- 2. 建 KV ---------------- */
function ensureKV() {
  console.log('\n[2/7] 建 KV 命名空间 ZHOUYI');

  // 先看是否已有
  let list = '';
  try {
    list = runCapture(`${WRANGLER} kv namespace list`);
  } catch {
    list = '';
  }

  let id = null;
  try {
    const arr = JSON.parse(list);
    const hit = arr.find((n) => n.title === 'ZHOUYI');
    if (hit) {
      id = hit.id;
      console.log('  ✓ 已存在，复用 id=' + id);
    }
  } catch {
    /* list 不是 JSON 就跳过 */
  }

  if (!id) {
    const out = runCapture(`${WRANGLER} kv namespace create ZHOUYI`);
    const m = out.match(/id\s*=\s*"([^"]+)"/) || out.match(/"id"\s*:\s*"([^"]+)"/);
    if (!m) {
      console.error('  ❌ 没解析到 id，原始输出：\n' + out);
      process.exit(1);
    }
    id = m[1];
    console.log('  ✓ 已创建 id=' + id);
  }

  // 写进 toml
  let toml = readFileSync(TOML, 'utf8');
  if (/id\s*=\s*"PLACEHOLDER_KV_ID"/.test(toml)) {
    toml = toml.replace(/id\s*=\s*"PLACEHOLDER_KV_ID"/, `id = "${id}"`);
    writeFileSync(TOML, toml, 'utf8');
    console.log('  ✓ 已写进 wrangler.toml');
  } else {
    // 已填过，检查是否一致
    const cur = toml.match(/id\s*=\s*"([^"]+)"/);
    if (cur && cur[1] !== id) {
      toml = toml.replace(/id\s*=\s*"[^"]+"/, `id = "${id}"`);
      writeFileSync(TOML, toml, 'utf8');
      console.log('  ✓ 更新 wrangler.toml 里的 id');
    } else {
      console.log('  ✓ wrangler.toml 里的 id 已正确');
    }
  }
  return id;
}

/* ---------------- 3. 部署 ---------------- */
function deploy() {
  console.log('\n[3/7] 部署 Worker');
  run(`${WRANGLER} deploy`);
  console.log('  ✓ 部署完成');
}

/* ---------------- 4. 设置 ADMIN_TOKEN ---------------- */
function setToken() {
  console.log('\n[4/7] 设置 ADMIN_TOKEN');

  let token = args.token;
  if (!token || token === true) {
    token = 'zy-' + randomBytes(12).toString('hex');
    console.log('  未指定 --token，已随机生成');
  }

  // wrangler secret put 从 stdin 读值
  try {
    execSync(`${WRANGLER} secret put ADMIN_TOKEN`, {
      cwd: HERE,
      input: token + '\n',
      stdio: ['pipe', 'inherit', 'inherit'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    });
  } catch (e) {
    console.error('  ❌ 设置失败。也可以去 Cloudflare 控制台手动加 Secret。');
    process.exit(1);
  }

  const f = join(HERE, 'ADMIN_TOKEN.txt');
  writeFileSync(f, token + '\n', 'utf8');
  console.log('  ✓ 已设置');
  console.log('  ⚠ ADMIN_TOKEN 已存到 worker/ADMIN_TOKEN.txt —— 别提交给 git');
  return token;
}

/* ---------------- 5. 灌正文 ---------------- */
function importContent() {
  console.log('\n[5/7] 灌入付费正文');
  if (!existsSync(KV_JSON)) {
    console.error('  ❌ 找不到 ' + KV_JSON);
    console.error('     先跑：python build/export-content.py');
    process.exit(1);
  }
  const size = (readFileSync(KV_JSON).length / 1024 / 1024).toFixed(2);
  console.log('  content-kv.json ' + size + ' MB');
  run(`${WRANGLER} kv bulk put --binding=KEYS "${KV_JSON}" --remote`);
  console.log('  ✓ 正文已入库');
}

/* ---------------- 6. 生成授权码 ---------------- */
function genKeys(workerUrl) {
  console.log('\n[6/7] 生成授权码');

  const count = Number(args.count || 200);
  const tier = String(args.tier || 'PREM').toUpperCase();
  const tokenFile = join(HERE, 'ADMIN_TOKEN.txt');
  if (!existsSync(tokenFile)) {
    console.error('  ❌ 找不到 ADMIN_TOKEN.txt，先跑 --step=token');
    process.exit(1);
  }
  const token = readFileSync(tokenFile, 'utf8').trim();

  if (!workerUrl) {
    console.error('  ❌ 不知道 Worker 地址');
    process.exit(1);
  }

  const body = JSON.stringify({ action: 'issue', token, count, tier });
  const cmd = `curl.exe -s -X POST "${workerUrl}" -H "content-type: application/json" -d "${body.replace(/"/g, '\\"')}"`;
  const out = runCapture(cmd);

  let data;
  try {
    data = JSON.parse(out);
  } catch {
    console.error('  ❌ 返回不是 JSON：\n' + out);
    process.exit(1);
  }
  if (!data.ok) {
    console.error('  ❌ 失败：' + JSON.stringify(data));
    process.exit(1);
  }

  const f = join(HERE, `keys-${tier}-${data.count}.txt`);
  writeFileSync(f, data.keys.join('\n') + '\n', 'utf8');
  console.log('  ✓ 生成 ' + data.count + ' 个 ' + tier + ' 码');
  console.log('  ✓ 已存到 worker/' + `keys-${tier}-${data.count}.txt`);
  console.log('    前三个：' + data.keys.slice(0, 3).join('  '));
  return data.keys;
}

/* ---------------- 主流程 ---------------- */
function main() {
  console.log('════════ 周易站点 · Cloudflare 一键部署 ════════');

  if (step === 'all' || step === 'check') checkLogin();
  let kvId = null;
  if (step === 'all' || step === 'kv') kvId = ensureKV();
  if (step === 'all' || step === 'deploy') deploy();
  if (step === 'all' || step === 'token') setToken();
  if (step === 'all' || step === 'content') importContent();

  // 拿 Worker 地址
  let workerUrl = args.url;
  if (!workerUrl) {
    try {
      const out = runCapture(`${WRANGLER} deployments status --json`);
      const j = JSON.parse(out);
      workerUrl = (j.versions || j).find?.((v) => v.url)?.url || '';
    } catch { /* ignore */ }
  }
  if (!workerUrl) {
    try {
      const toml = readFileSync(TOML, 'utf8');
      const name = toml.match(/name\s*=\s*"([^"]+)"/)?.[1];
      if (name) console.log('\n  ℹ Worker 地址形如 https://' + name + '.你的子域.workers.dev');
      console.log('     拿到后可以跑：node worker/setup.mjs --step=keys --url=https://xxx.workers.dev');
    } catch { /* ignore */ }
  }

  if (workerUrl && (step === 'all' || step === 'keys')) genKeys(workerUrl);

  console.log('\n════════ 完成 ════════');
  if (step === 'all') {
    console.log('\n接下来：');
    console.log('  1. 把 Worker 地址填进 assets/payment.js 的 workerUrl');
    console.log('  2. 重新构建 + 推送');
    console.log('  3. 打开线上站点，用一个码测试解锁');
  }
}

main();
