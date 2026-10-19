/* ==========================================================================
   用户系统：注册 / 邮箱验证 / 登录 / 会话 / Google OAuth
   --------------------------------------------------------------------------
   为什么需要它：
     付费内容不能只靠「浏览器 localStorage 里的授权码」——
     换设备、清缓存就丢了，用户付了 999 却找不回来。
     必须有账号作为身份锚点。

   两种登录方式：
     ① 邮箱 + 密码（必须邮箱验证）
     ② Google 账号

   --------------------------------------------------------------------------
   KV 数据模型

     user:<email>        → { id, email, passHash, salt, verified, createdAt }
     user:g:<googleSub>  → <email>              （Google 登录索引）
     sess:<token>        → { email, exp }        （会话，7 天）
     vc:<email>          → { code, exp, tries }  （邮箱验证码，10 分钟）
     key:<code>          → { tier, email, ... }  （授权码归属到邮箱）

   --------------------------------------------------------------------------
   需要的环境变量 / Secret

     RESEND_API_KEY      发验证邮件（resend.com，免费 3000 封/月）
     MAIL_FROM           发件人，如 "周易六十四卦 <noreply@你的域名>"
                         没有自有域名时可用 "onboarding@resend.dev"（只能发给自己）
     GOOGLE_CLIENT_ID    Google OAuth
     GOOGLE_CLIENT_SECRET
     SITE_URL            站点地址，用于拼回调与邮件里的链接

   未配置时自动降级：
     · 没有 RESEND_API_KEY → 验证码直接返回给前端（开发模式，页面会提示）
     · 没有 GOOGLE_CLIENT_ID → Google 登录按钮隐藏
   ========================================================================== */

/**
 * 会话有效期。
 *
 * 为什么是 90 天而不是 7 天：
 *   买断制产品，用户一年可能只来几次。7 天就要重登一次，
 *   每次登录都是一次流失机会。90 天覆盖一个季度，
 *   绝大多数用户在整个使用周期里只需要登录一次。
 *
 * 安全权衡：
 *   session token 是 48 位随机十六进制，不绑定 IP。
 *   一旦泄露，攻击者能看付费内容 —— 但内容是静态文章，
 *   危害远小于「用户嫌麻烦不看了」的损失。
 *   真要提升安全性，应该做「设备列表 + 主动踢出」，而不是缩短有效期。
 */
const SESSION_DAYS = 90;
const CODE_TTL_MIN = 10;
const MAX_TRIES = 5;

/* ---------------- 小工具 ---------------- */

const enc = new TextEncoder();

function b64url(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s) {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

function randHex(n = 16) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** PBKDF2-SHA256 派生密码哈希（迭代 10 万次） */
async function hashPassword(password, saltHex) {
  const salt = fromB64url(b64url(enc.encode(saltHex)));
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return b64url(bits);
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function normEmail(e) {
  return String(e || '').trim().toLowerCase();
}

function validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
}

/* ---------------- KV 读写 ---------------- */

async function kvGet(env, k) {
  const raw = await env.KEYS.get(k);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function kvPut(env, k, v, ttl) {
  const opts = ttl ? { expirationTtl: ttl } : undefined;
  await env.KEYS.put(k, JSON.stringify(v), opts);
}

async function kvDel(env, k) {
  await env.KEYS.delete(k);
}

/* ==========================================================================
   邮件发送
   ========================================================================== */

async function sendMail(env, { to, subject, html }) {
  const key = env.RESEND_API_KEY;
  if (!key) return { ok: false, reason: 'no-mail-key' };

  const from = env.MAIL_FROM || 'onboarding@resend.dev';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'authorization': 'Bearer ' + key,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, reason: 'resend:' + (j.message || r.status) };
    return { ok: true, id: j.id };
  } catch (e) {
    return { ok: false, reason: 'network:' + e.message };
  }
}

function codeMailHtml(code) {
  return `<!DOCTYPE html><html><body style="margin:0;background:#f6f3ec;padding:36px 0;
font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
<div style="max-width:420px;margin:0 auto;background:#fffdf9;border:1px solid #e0d8c8;
border-radius:14px;padding:34px">
<div style="font-size:11px;letter-spacing:.16em;color:#a8322a;margin-bottom:12px">周易六十四卦</div>
<h1 style="font-size:19px;margin:0 0 14px;color:#1c1a17">验证你的邮箱</h1>
<p style="font-size:14px;line-height:1.9;color:#44403a;margin:0 0 22px">
下面是验证码，${CODE_TTL_MIN} 分钟内有效：</p>
<div style="font-size:34px;font-weight:700;letter-spacing:.18em;color:#a8322a;
text-align:center;padding:16px;background:#f3efe7;border-radius:9px;margin-bottom:22px">${code}</div>
<p style="font-size:12.5px;line-height:1.8;color:#9a938a;margin:0">
如果不是你本人操作，忽略这封邮件即可。</p>
</div></body></html>`;
}

/* ==========================================================================
   会话
   ========================================================================== */

async function createSession(env, email) {
  const token = randHex(24);
  const exp = Date.now() + SESSION_DAYS * 86400_000;
  await kvPut(env, 'sess:' + token, { email, exp }, SESSION_DAYS * 86400);
  return { token, exp };
}

async function readSession(env, token) {
  if (!token || typeof token !== 'string') return null;
  const s = await kvGet(env, 'sess:' + token);
  if (!s) return null;
  if (s.exp < Date.now()) { await kvDel(env, 'sess:' + token); return null; }
  return s;
}

/** 供 index.js 复用 */
export { readSession };

/* ==========================================================================
   公开方法
   ========================================================================== */

/** 注册：建用户（未验证）+ 发验证码 */
export async function signup(env, { email, password }) {
  const e = normEmail(email);
  if (!validEmail(e)) return { ok: false, reason: '邮箱格式不正确' };
  if (typeof password !== 'string' || password.length < 8) {
    return { ok: false, reason: '密码至少 8 位' };
  }
  if (password.length > 128) return { ok: false, reason: '密码太长' };

  const exist = await kvGet(env, 'user:' + e);
  if (exist && exist.verified) {
    return { ok: false, reason: '这个邮箱已经注册过，请直接登录' };
  }

  const salt = randHex(16);
  const passHash = await hashPassword(password, salt);

  const user = exist || {
    id: randHex(12),
    email: e,
    createdAt: Date.now(),
  };
  user.salt = salt;
  user.passHash = passHash;
  user.verified = false;

  await kvPut(env, 'user:' + e, user);

  return await issueCode(env, e);
}

/** 生成并发送验证码 */
export async function issueCode(env, email) {
  const e = normEmail(email);
  const user = await kvGet(env, 'user:' + e);
  if (!user) return { ok: false, reason: '没有这个账号，请先注册' };

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await kvPut(env, 'vc:' + e, {
    code, exp: Date.now() + CODE_TTL_MIN * 60_000, tries: 0,
  }, CODE_TTL_MIN * 60);

  const sent = await sendMail(env, {
    to: e,
    subject: '验证你的邮箱 · 周易六十四卦',
    html: codeMailHtml(code),
  });

  if (!sent.ok) {
    // 没配发信服务时，把码返回给前端（仅供本地调试；线上必须配 RESEND_API_KEY）
    return {
      ok: true,
      devCode: sent.reason === 'no-mail-key' ? code : undefined,
      warn: sent.reason === 'no-mail-key'
        ? '未配置 RESEND_API_KEY，验证码直接显示（仅开发用）'
        : '邮件发送失败：' + sent.reason,
    };
  }
  return { ok: true, sent: true };
}

/** 校验验证码 → 标记已验证 → 发会话 */
export async function verifyCode(env, { email, code }) {
  const e = normEmail(email);
  const rec = await kvGet(env, 'vc:' + e);
  if (!rec) return { ok: false, reason: '验证码已过期，请重新发送' };
  if (rec.exp < Date.now()) return { ok: false, reason: '验证码已过期，请重新发送' };
  if (rec.tries >= MAX_TRIES) return { ok: false, reason: '尝试次数过多，请重新发送' };

  rec.tries = (rec.tries || 0) + 1;
  await kvPut(env, 'vc:' + e, rec, CODE_TTL_MIN * 60);

  if (!timingSafeEqual(String(code || '').trim(), rec.code)) {
    return { ok: false, reason: '验证码不对，还剩 ' + Math.max(0, MAX_TRIES - rec.tries) + ' 次' };
  }

  const user = await kvGet(env, 'user:' + e);
  if (!user) return { ok: false, reason: '账号不存在' };
  user.verified = true;
  user.verifiedAt = Date.now();
  await kvPut(env, 'user:' + e, user);
  await kvDel(env, 'vc:' + e);

  const sess = await createSession(env, e);
  return { ok: true, ...sess, email: e };
}

/** 登录（邮箱 + 密码） */
export async function login(env, { email, password }) {
  const e = normEmail(email);
  if (!validEmail(e)) return { ok: false, reason: '邮箱格式不正确' };

  const user = await kvGet(env, 'user:' + e);
  if (!user) return { ok: false, reason: '邮箱或密码不对' };
  if (!user.verified) {
    // 未验证的话，重发码
    const r = await issueCode(env, e);
    return { ok: false, needVerify: true, reason: '邮箱还没验证，已重新发送验证码', devCode: r.devCode };
  }

  const hash = await hashPassword(String(password || ''), user.salt);
  if (!timingSafeEqual(hash, user.passHash)) {
    return { ok: false, reason: '邮箱或密码不对' };
  }

  const sess = await createSession(env, e);
  return { ok: true, ...sess, email: e };
}

/** 查当前登录用户（带已购等级） */
export async function me(env, token) {
  const s = await readSession(env, token);
  if (!s) return { ok: false, reason: 'not-logged-in' };

  const user = await kvGet(env, 'user:' + s.email);
  const tiers = await tiersOfEmail(env, s.email);

  return {
    ok: true,
    email: s.email,
    verified: !!(user && user.verified),
    tiers,
    exp: s.exp,
  };
}

export async function logout(env, token) {
  if (token) await kvDel(env, 'sess:' + token);
  return { ok: true };
}

/** 某邮箱买过哪些等级 */
export async function tiersOfEmail(env, email) {
  const idx = await kvGet(env, 'purch:' + normEmail(email));
  if (!idx) return [];
  return Array.isArray(idx.tiers) ? idx.tiers : [];
}

/** 把某等级记到邮箱名下（付款成功后调用） */
export async function grantTier(env, email, tier) {
  const e = normEmail(email);
  if (!e) return;
  const idx = (await kvGet(env, 'purch:' + e)) || { tiers: [], at: [] };
  if (!idx.tiers.includes(tier)) idx.tiers.push(tier);
  idx.at = idx.at || [];
  idx.at.push(Date.now());
  await kvPut(env, 'purch:' + e, idx);
}

/* ==========================================================================
   Google OAuth
   ========================================================================== */

/**
 * 生成 Google 授权地址。
 * @param {string} origin Worker 自己的 origin（必须有，不能用 SITE_URL）
 *
 * ⚠️ redirect_uri 必须指向 Worker（本服务），不能指向静态站点：
 *    只有 Worker 持有 GOOGLE_CLIENT_SECRET，能完成 code → token 的交换。
 *    这个值还必须和 Google 控制台里登记的「已获授权的重定向 URI」完全一致。
 */
export function googleAuthUrl(env, state, origin) {
  const cid = env.GOOGLE_CLIENT_ID;
  if (!cid) return null;
  const base = String(origin || '').replace(/\/$/, '');
  if (!base) return null;
  const redirect = base + '/auth/google/callback';
  const p = new URLSearchParams({
    client_id: cid,
    redirect_uri: redirect,
    response_type: 'code',
    scope: 'openid email profile',
    state: state || randHex(8),
    access_type: 'online',
    prompt: 'select_account',
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + p.toString();
}

/** 用 code 换用户信息 */
export async function googleExchange(env, code, origin) {
  const cid = env.GOOGLE_CLIENT_ID;
  const csec = env.GOOGLE_CLIENT_SECRET;
  if (!cid || !csec) return { ok: false, reason: 'google-not-configured' };

  const base = String(origin || '').replace(/\/$/, '');
  if (!base) return { ok: false, reason: 'no-origin' };
  const redirect = base + '/auth/google/callback';

  let tok;
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: cid,
        client_secret: csec,
        redirect_uri: redirect,
        grant_type: 'authorization_code',
      }).toString(),
    });
    tok = await r.json();
  } catch (e) {
    return { ok: false, reason: 'token-network:' + e.message };
  }

  if (!tok || !tok.id_token) {
    return { ok: false, reason: 'google-token-failed:' + JSON.stringify(tok).slice(0, 120) };
  }

  // 解析 id_token（JWT 的第二段）。此处不验签——
  // 因为 id_token 是我们直连 Google token 端点换来的，可信来源。
  let claims;
  try {
    claims = JSON.parse(new TextDecoder().decode(fromB64url(tok.id_token.split('.')[1])));
  } catch {
    return { ok: false, reason: 'bad-id-token' };
  }

  const email = normEmail(claims.email);
  if (!email) return { ok: false, reason: 'no-email-in-token' };
  if (claims.email_verified === false) return { ok: false, reason: 'google-email-unverified' };

  // 建/取本地用户
  let user = await kvGet(env, 'user:' + email);
  if (!user) {
    user = {
      id: randHex(12),
      email,
      verified: true,          // Google 已验证
      createdAt: Date.now(),
      via: 'google',
      googleSub: claims.sub,
    };
    await kvPut(env, 'user:' + email, user);
  } else if (!user.verified) {
    user.verified = true;
    user.verifiedAt = Date.now();
    await kvPut(env, 'user:' + email, user);
  }
  if (claims.sub) await kvPut(env, 'user:g:' + claims.sub, { email });

  const sess = await createSession(env, email);
  return { ok: true, ...sess, email, via: 'google' };
}
