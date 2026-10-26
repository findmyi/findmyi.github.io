const fs = require('fs');
const p = 'D:/zhouyi-site/worker/auth.js';
let s = fs.readFileSync(p, 'utf8');

function injectAfter(header, bodySnippet, insert) {
  const i = s.indexOf(header);
  if (i < 0) throw new Error('header not found: ' + header);
  const j = s.indexOf(bodySnippet, i);
  if (j < 0) throw new Error('snippet not found after ' + header);
  const at = j + bodySnippet.length;
  s = s.slice(0, at) + insert + s.slice(at);
}

// signup: after email validate
injectAfter(
  'export async function signup(env, { email, password }) {',
  `if (!validEmail(e)) return { ok: false, reason: '邮箱格式不正确' };`,
  `
  if (!(await rateLimit(env, 'rl:signup:' + e, 5, 15 * 60_000))) {
    return { ok: false, reason: '尝试太频繁，请稍后再试' };
  }`
);

// login: after email validate
injectAfter(
  'export async function login(env, { email, password }) {',
  `if (!validEmail(e)) return { ok: false, reason: '邮箱格式不正确' };`,
  `
  if (!(await rateLimit(env, 'rl:login:' + e, 10, 15 * 60_000))) {
    return { ok: false, reason: '尝试太频繁，请稍后再试' };
  }`
);

// issueCode: after normEmail
injectAfter(
  'export async function issueCode(env, email) {',
  `const e = normEmail(email);`,
  `
  if (!(await rateLimit(env, 'rl:code:' + e, 5, 10 * 60_000))) {
    return { ok: false, reason: '验证码发送太频繁，请稍后再试' };
  }`
);

// logoutAll after logout
const logoutFn = `export async function logout(env, token) {
  if (token) await kvDel(env, 'sess:' + token);
  return { ok: true };
}`;
if (!s.includes(logoutFn)) {
  console.error('logout not found');
  process.exit(1);
}
s = s.replace(
  logoutFn,
  logoutFn + `

/** 该账号在所有设备上下线（吊销全部 session） */
export async function logoutAll(env, token) {
  const s = await readSession(env, token);
  if (!s) return { ok: false, reason: 'not-logged-in' };
  const email = normEmail(s.email);
  let cursor = undefined;
  let n = 0;
  do {
    const page = await env.KEYS.list({ prefix: 'sess:', cursor });
    for (const k of page.list_complete ? page.keys : page.keys) {
      const rec = await kvGet(env, k.name);
      if (rec && normEmail(rec.email) === email) {
        await kvDel(env, k.name);
        n++;
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return { ok: true, revoked: n };
}`
);

fs.writeFileSync(p, s);
console.log('auth.js login/signup/code rate-limit + logoutAll ok');
