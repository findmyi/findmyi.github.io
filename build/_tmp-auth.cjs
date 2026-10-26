const fs = require('fs');
const p = 'D:/zhouyi-site/worker/auth.js';
let s = fs.readFileSync(p, 'utf8');

// 1) 验证码改为密码学随机
const oldCode = `const code = String(Math.floor(100000 + Math.random() * 900000));`;
const newCode = `const codeBuf = new Uint8Array(1);
    crypto.getRandomValues(codeBuf);
    const code = String(100000 + (codeBuf[0] % 900000));`;
if (!s.includes(oldCode)) {
  console.error('code gen not found');
  process.exit(1);
}
s = s.replace(oldCode, newCode);

// 2) 在 kvDel 之后插入限流与 logoutAll
const anchor = `async function kvDel(env, k) {
  await env.KEYS.delete(k);
}`;
const insert = `async function kvDel(env, k) {
  await env.KEYS.delete(k);
}

/** 按 key 简单限流：windowMs 内最多 max 次 */
async function rateLimit(env, key, max, windowMs) {
  const now = Date.now();
  let hits = [];
  try {
    hits = JSON.parse((await env.KEYS.get(key)) || '[]');
    if (!Array.isArray(hits)) hits = [];
  } catch {
    hits = [];
  }
  hits = hits.filter((t) => now - t < windowMs);
  if (hits.length >= max) return false;
  hits.push(now);
  await env.KEYS.put(key, JSON.stringify(hits), {
    expirationTtl: Math.ceil(windowMs / 1000) + 60,
  });
  return true;
}

function ipOf(req) {
  return (req && req.headers && req.headers.get('cf-connecting-ip')) || 'anon';
}`;
if (!s.includes(anchor)) {
  console.error('kvDel anchor not found');
  process.exit(1);
}
s = s.replace(anchor, insert);

fs.writeFileSync(p, s);
console.log('auth.js base patched');
