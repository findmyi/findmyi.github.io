/* ==========================================================================
   周易六十四卦 · 授权与内容服务
   Cloudflare Worker + KV
   --------------------------------------------------------------------------
   解决的问题（这是整个付费体系的生死线）：

     付费正文【不能】放在静态站里 —— 放了就等于免费公开。
     但也不能不放 —— 那样用户解锁后看不到内容。

     唯一解法：正文存在服务端，验码之后才下发。

     静态站（index.html / assets / articles / data）
        └─ 只有免费内容 + 付费卡
     Worker（本文件）+ KV
        ├─ 订单 → 生成授权码
        ├─ 授权码 → 校验 / 绑定设备 / 撤销
        └─ 授权码 + 文章 id → 【下发付费正文】

   --------------------------------------------------------------------------
   接口

     POST /                 统一入口，body 是 JSON：{ action, ... }
       action: 'redeem'     兑换授权码（首次绑定设备）
       action: 'unlock'     取付费正文（验码后下发）
       action: 'issue'      管理员发码（需 token）
       action: 'revoke'     管理员吊销（需 token）
       action: 'stats'      管理员看统计（需 token）

     GET  /health           健康检查

   --------------------------------------------------------------------------
   部署

   ① 建 KV
      Cloudflare 控制台 → Storage & Databases → KV → Create namespace
      名字：ZHOUYI

   ② 建 Worker
      Workers & Pages → Create → Worker，命名 zhouyi-api
      把本文件粘进去 → Deploy

   ③ 绑定
      Worker → Settings → Bindings：
        · KV Namespace：变量名 KEYS  → 选 ZHOUYI
        · Secret：变量名 ADMIN_TOKEN → 自己设一个随机串（管理员用）

   ④ 灌数据（两种，都要）
      · 授权码：见文末 importKeys()
      · 付费正文：见文末 importContents()
        正文键名：content:{文章id}，值是 HTML

   ⑤ 把 Worker 地址填进站点 assets/payment.js 的 workerUrl
   ========================================================================== */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

import { getProvider } from './pay.js';
import * as auth from './auth.js';

/* ---- 与 assets/license.js 完全相同的算法 ---- */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const KEY_LEN = 15;

function fnv1a(s) {
  let h = 0x811c9dc5;
  const str = String(s).toUpperCase();
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function validateKey(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== KEY_LEN || s.slice(0, 2) !== 'ZY') return null;

  // ⚠️ 关键：checksum 的输入必须是【带连字符】的 ZY-PREM-XXXX-XXXX，
  //    与 assets/license.js 的 checksum(body) 完全一致。
  //    早前这里用了无连字符的 s.slice(0,14)，导致和前端算出来的码对不上。
  const pretty = prettyKey(s);
  const body = pretty.slice(0, pretty.length - 2);   // 去掉末尾的 "-C"
  if (s.slice(KEY_LEN - 1) !== ALPHABET[fnv1a(body) % ALPHABET.length]) return null;

  return { key: s, tier: s.slice(2, 6), pretty };
}

function prettyKey(s) {
  return [s.slice(0, 2), s.slice(2, 6), s.slice(6, 10), s.slice(10, 14), s.slice(14)]
    .join('-');
}

/** 生成一个新授权码（管理员用） */
function genKey(tier) {
  const t = String(tier || 'PREM').toUpperCase().slice(0, 4).padEnd(4, '0');
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let r1 = '', r2 = '';
  for (let i = 0; i < 4; i++) r1 += ALPHABET[buf[i] % ALPHABET.length];
  for (let i = 4; i < 8; i++) r2 += ALPHABET[buf[i] % ALPHABET.length];

  // 与 validateKey / license.js 一致：checksum 吃带连字符的 body
  const body = ['ZY', t, r1, r2].join('-');
  return (body + '-' + ALPHABET[fnv1a(body) % ALPHABET.length]).replace(/-/g, '');
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

/* ---- 等级覆盖规则：哪个等级能看哪些文章 ---- */
const TIER_SCOPE = {
  PREM: '*',                    // 全站通行（第一档 999）
  FULL: '*',                    // 全站通行（第二档 1999）
  QK00: ['qian', 'kun'],        // 乾坤专享（保留）
};
const TIER_RANK = { QK00: 1, PREM: 2, FULL: 3 };

function tierCovers(tier, id) {
  const scope = TIER_SCOPE[tier];
  if (!scope) return false;
  if (scope === '*') return true;
  return scope.indexOf(id) !== -1;
}

/** 归一化邮箱（和 auth.js 保持一致） */
function normEmailLite(e) {
  return String(e || '').trim().toLowerCase();
}

/* ==========================================================================
   订单系统
   --------------------------------------------------------------------------
   订单存在 KV：order:<outTradeNo> → {
     tier, amount, status: 'pending'|'paid'|'failed',
     key?, at, providerTradeNo, title
   }

   状态机：pending ──支付回调──▶ paid（此时才生成授权码）
           pending ──超时/失败──▶ failed
   ========================================================================== */

/** 价格表（分）。与 assets/payment.js 的 tiers 必须一致。 */
const PRICE = { PREM: 99900, FULL: 199900 };
const TITLE = {
  PREM: '周易六十四卦 · 困境对照表（终身买断）',
  FULL: '周易六十四卦 · 全站通行（终身买断）',
};

function genOutTradeNo() {
  const buf = new Uint8Array(9);
  crypto.getRandomValues(buf);
  let s = '';
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < buf.length; i++) s += A[buf[i] % A.length];
  return 'ZY' + Date.now().toString(36).toUpperCase() + s;
}

async function putOrder(env, no, rec) {
  await env.KEYS.put('order:' + no, JSON.stringify(rec), {
    // 订单 7 天后自动过期，避免 KV 无限膨胀
    expirationTtl: 60 * 60 * 24 * 7,
  });
}

async function getOrder(env, no) {
  const raw = await env.KEYS.get('order:' + no);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * 标记已付款并放权。
 *
 * 两种放权方式同时做：
 *   ① 记到订单的邮箱名下（purch:<email>）← 登录即可恢复，换设备不受影响
 *   ② 生成一个授权码（可用于赠送 / 手动发放 / 老流程兼容）
 *
 * 幂等：已 paid 的直接返回原记录（支付商可能重复回调）。
 */
async function markPaidAndIssue(env, no, providerTradeNo) {
  const rec = await getOrder(env, no);
  if (!rec) return { ok: false, reason: 'notfound' };
  if (rec.status === 'paid' && rec.key) return rec;      // 幂等

  const tier = rec.tier || 'PREM';
  const rawKey = genKey(tier);
  const pretty = prettyKey(rawKey);

  rec.status = 'paid';
  rec.key = pretty;
  rec.at = Date.now();
  rec.providerTradeNo = providerTradeNo || rec.providerTradeNo || '';

  await putOrder(env, no, rec);

  // ① 绑定到邮箱 —— 这是主路径
  if (rec.email) {
    await auth.grantTier(env, rec.email, tier);
  }

  // ② 同时留一个码（可赠送 / 客服补发 / 老流程）
  await env.KEYS.put('key:' + rawKey, JSON.stringify({
    tier, bind: null, used: 0, at: null, order: no, email: rec.email || null,
  }));

  return rec;
}

/** 创建订单 */
async function createOrder(env, url, body, email) {
  const tier = String(body.tier || 'PREM').toUpperCase();
  if (!PRICE[tier]) return json({ ok: false, reason: 'badtier' });

  const provider = getProvider(env.PAY_PROVIDER || 'mock');
  const no = genOutTradeNo();
  const amount = PRICE[tier];
  const origin = url.origin;

  const rec = {
    tier,
    amount,
    email: email || null,          // ← 订单归到这个邮箱
    status: 'pending',
    at: Date.now(),
    provider: provider.name,
    title: TITLE[tier],
  };
  await putOrder(env, no, rec);

  const res = await provider.createOrder(env, {
    outTradeNo: no,
    amount,
    title: TITLE[tier],
    notifyUrl: origin + '/notify',
    returnUrl: body.returnUrl || '',
    tier,
  });

  if (!res.ok) {
    await putOrder(env, no, { ...rec, status: 'failed', err: res.reason });
    return json({ ok: false, reason: res.reason });
  }

  return json({
    ok: true,
    outTradeNo: no,
    tier,
    amount,
    provider: provider.name,
    payUrl: res.payUrl || null,
    qrCode: res.qrCode || null,
  });
}

/** 支付回调 */
async function handleNotify(request, env, url) {
  const provider = getProvider(env.PAY_PROVIDER || 'mock');

  let rawBody = '';
  try {
    rawBody = await request.text();
  } catch {
    return new Response('bad body', { status: 400, headers: CORS });
  }

  const headers = Object.fromEntries(request.headers);

  let v = null;
  try {
    v = await provider.verifyNotify(env, { rawBody, headers, request });
  } catch {
    v = null;
  }

  if (!v || !v.ok) {
    return new Response('verify failed', { status: 400, headers: CORS });
  }

  const rec = await markPaidAndIssue(env, v.outTradeNo, v.providerTradeNo);

  // 不同支付商要求的应答格式不同，这里给一个通用的成功应答
  if (provider.name === 'xorpay') {
    return new Response('success', { headers: CORS });
  }
  return new Response(JSON.stringify({ ec: 200, em: 'ok' }), {
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

/** mock 收银台（只在 PAY_PROVIDER=mock 时可用） */
function mockPayPage(url, env) {
  const no = url.searchParams.get('no') || '';
  const amount = url.searchParams.get('amount') || '0';
  const title = url.searchParams.get('title') || '';
  const yuan = (Number(amount) / 100).toFixed(2);

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>模拟收银台</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f3ec;color:#1c1a17;
display:flex;align-items:center;justify-content:center;min-height:100vh}
.box{background:#fffdf9;border:1px solid #e0d8c8;border-radius:14px;padding:34px 38px;max-width:420px;
box-shadow:0 20px 50px -30px rgba(0,0,0,.35);text-align:center}
.tag{display:inline-block;background:#a8322a;color:#fff;font-size:11px;letter-spacing:.14em;
padding:4px 12px;border-radius:99px;margin-bottom:18px}
h1{font-size:19px;margin:0 0 8px;font-weight:700}
.t{color:#6b645a;font-size:13.5px;line-height:1.7;margin:0 0 22px}
.price{font-size:38px;font-weight:700;color:#a8322a;margin:0 0 4px}
.price small{font-size:18px}
.no{font-size:11.5px;color:#9a938a;margin:0 0 26px;font-family:ui-monospace,monospace}
button{width:100%;padding:14px;border:0;border-radius:9px;background:#a8322a;color:#fff;
font-size:15px;font-weight:700;cursor:pointer;font-family:inherit}
button:disabled{opacity:.5;cursor:default}
.done{margin-top:18px;font-size:14px;color:#2f7a4f;font-weight:700;display:none}
.note{margin-top:20px;font-size:11.5px;color:#9a938a;line-height:1.6}
</style></head>
<body><div class="box">
<div class="tag">模拟收银台 · 不产生真实扣款</div>
<h1>${title || '周易六十四卦'}</h1>
<p class="t">这是开发用的模拟支付页。点下面的按钮即视为"付款成功"。</p>
<div class="price"><small>￥</small>${yuan}</div>
<p class="no">订单号 ${no}</p>
<button id="pay">模拟支付成功</button>
<div class="done" id="done">✓ 已支付，正在返回网站…</div>
<div class="note">正式收款时需要把 PAY_PROVIDER 换成真实支付商（xorpay / afdian）。</div>
</div>
<script>
document.getElementById('pay').onclick = async function(){
  this.disabled = true; this.textContent = '处理中…';
  try {
    const r = await fetch('/', {method:'POST',headers:{'content-type':'application/json'},
      body: JSON.stringify({action:'mock-pay', outTradeNo: ${JSON.stringify(no)}})});
    const d = await r.json();
    if (d.ok) {
      document.getElementById('done').style.display = 'block';
      this.style.display = 'none';
      const ret = ${JSON.stringify(url.searchParams.get('ret') || '')};
      setTimeout(() => { if (ret) location.href = ret; }, 900);
    } else {
      this.disabled = false; this.textContent = '失败：' + (d.reason || '未知');
    }
  } catch(e) {
    this.disabled = false; this.textContent = '网络错误，重试';
  }
};
</script></body></html>`;

  return new Response(html, {
    headers: { ...CORS, 'content-type': 'text/html; charset=utf-8' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/health') return json({ ok: true, ts: Date.now() });

    /* ================= 支付回调（独立路径，不走 action） ================= */
    if (url.pathname === '/notify') {
      return handleNotify(request, env, url);
    }

    /* ================= mock 收银台页面（仅开发用） ================= */
    if (url.pathname === '/mock-pay' && request.method === 'GET') {
      return mockPayPage(url, env);
    }

    /* ================= Google 登录 ================= */
    if (url.pathname === '/auth/google' && request.method === 'GET') {
      const u = auth.googleAuthUrl(env, url.searchParams.get('state') || '', url.origin);
      if (!u) return new Response('Google 登录未配置（缺 GOOGLE_CLIENT_ID）', { status: 503, headers: CORS });
      return Response.redirect(u, 302);
    }

    if (url.pathname === '/auth/google/callback' && request.method === 'GET') {
      const code = url.searchParams.get('code');
      const site = (env.SITE_URL || '').replace(/\/$/, '');
      if (!code) return Response.redirect(site + '/#/?auth=denied', 302);

      const r = await auth.googleExchange(env, code, url.origin);
      if (!r.ok) {
        return Response.redirect(site + '/#/?auth=err&r=' + encodeURIComponent(r.reason || ''), 302);
      }
      // 把 session 通过 fragment 交给前端（fragment 不会进服务器日志）
      return Response.redirect(
        site + '/#/?auth=ok&s=' + encodeURIComponent(r.token) + '&e=' + encodeURIComponent(r.email),
        302);
    }

    if (request.method !== 'POST') return json({ ok: false, reason: 'method' }, 405);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, reason: 'badjson' }, 400);
    }

    const { action, key: rawKey, device, session } = body || {};

    /* ================= 账号 ================= */
    if (action === 'signup') return json(await auth.signup(env, body));
    if (action === 'verify') return json(await auth.verifyCode(env, body));
    if (action === 'login') return json(await auth.login(env, body));
    if (action === 'logout') return json(await auth.logout(env, session));
    if (action === 'me') return json(await auth.me(env, session));
    if (action === 'resend') return json(await auth.issueCode(env, body.email));

    /* ================= 在线购买：创建订单 ================= */
    if (action === 'buy') {
      // 必须先登录 —— 否则付款记录没有身份锚点，换设备就找不回来
      const sess = await auth.readSession(env, session);
      if (!sess) return json({ ok: false, reason: 'need-login' });
      return createOrder(env, url, body, sess.email);
    }

    /* ================= 在线购买：查订单（前端轮询） ================= */
    if (action === 'order') {
      const no = String(body.outTradeNo || '').trim();
      if (!/^[A-Za-z0-9_-]{6,40}$/.test(no)) return json({ ok: false, reason: 'badno' });
      const rec = await getOrder(env, no);
      if (!rec) return json({ ok: false, reason: 'notfound' });
      return json({
        ok: true,
        status: rec.status,                  // pending | paid | failed
        tier: rec.tier,
        key: rec.status === 'paid' ? rec.key : null,   // 只有已付款才给码
      });
    }

    /* ================= mock：模拟支付成功（仅开发） ================= */
    if (action === 'mock-pay') {
      if (String(env.PAY_PROVIDER || 'mock') !== 'mock') {
        return json({ ok: false, reason: 'not-mock-mode' }, 403);
      }
      const no = String(body.outTradeNo || '').trim();
      const rec = await getOrder(env, no);
      if (!rec) return json({ ok: false, reason: 'notfound' });
      if (rec.status === 'paid') return json({ ok: true, status: 'paid', already: true });
      const filled = await markPaidAndIssue(env, no, 'MOCK');
      return json({ ok: true, status: 'paid', key: filled.key });
    }

    /* ================= 管理员接口 ================= */
    if (action === 'issue' || action === 'revoke' || action === 'stats') {
      if (!env.ADMIN_TOKEN || body.token !== env.ADMIN_TOKEN) {
        return json({ ok: false, reason: 'forbidden' }, 403);
      }

      if (action === 'issue') {
        const n = Math.min(Math.max(parseInt(body.count, 10) || 1, 1), 500);
        const tier = String(body.tier || 'PREM').toUpperCase();
        if (!TIER_SCOPE[tier]) return json({ ok: false, reason: 'badtier' });

        const keys = [];
        for (let i = 0; i < n; i++) {
          const k = genKey(tier);
          await env.KEYS.put('key:' + k, JSON.stringify({
            tier, bind: null, used: 0, at: null, order: body.order || null,
          }));
          keys.push(prettyKey(k));
        }
        return json({ ok: true, count: keys.length, keys });
      }

      if (action === 'revoke') {
        const v = validateKey(rawKey);
        if (!v) return json({ ok: false, reason: 'invalid' });
        await env.KEYS.put('key:' + v.key, JSON.stringify({
          tier: v.tier, bind: null, used: 0, at: null, revoked: true,
        }));
        return json({ ok: true, revoked: v.pretty });
      }

      if (action === 'stats') {
        const list = await env.KEYS.list({ prefix: 'key:', limit: 1000 });
        let used = 0, total = 0, revoked = 0;
        for (const k of list.keys) {
          total++;
          const raw = await env.KEYS.get(k.name);
          if (!raw) continue;
          try {
            const r = JSON.parse(raw);
            if (r.revoked) revoked++;
            else if (r.bind) used++;
          } catch { /* ignore */ }
        }
        return json({ ok: true, total, used, unused: total - used - revoked, revoked });
      }
    }

    /* ================= 兑换授权码 ================= */
    if (action === 'redeem') {
      const v = validateKey(rawKey);
      if (!v) return json({ ok: false, reason: 'invalid' });
      if (!device) return json({ ok: false, reason: 'nodevice' });

      const storeKey = 'key:' + v.key;
      const raw = await env.KEYS.get(storeKey);

      // 首次使用
      if (raw === null) {
        await env.KEYS.put(storeKey, JSON.stringify({
          tier: v.tier, bind: device, used: 1, at: Date.now(),
        }));
        return json({ ok: true, tier: v.tier, key: v.pretty, first: true });
      }

      let rec;
      try { rec = JSON.parse(raw); } catch { return json({ ok: false, reason: 'corrupt' }); }

      if (rec.revoked) return json({ ok: false, reason: 'revoked' });
      if (rec.bind && rec.bind !== device) return json({ ok: false, reason: 'used' });

      rec.used = (rec.used || 0) + 1;
      rec.bind = device;
      await env.KEYS.put(storeKey, JSON.stringify(rec));
      return json({ ok: true, tier: rec.tier, key: v.pretty });
    }

    /* ================= 取付费正文（核心） ================= */
    if (action === 'unlock') {
      const ids = Array.isArray(body.ids) ? body.ids.slice(0, 8) : [];
      if (!ids.length) return json({ ok: false, reason: 'noids' });

      /* ---- 路径 ①：已登录 → 按邮箱的购买记录放权（主路径） ---- */
      const sess = await auth.readSession(env, session);
      if (sess) {
        const tiers = await auth.tiersOfEmail(env, sess.email);
        if (!tiers.length) {
          return json({ ok: false, reason: 'not-purchased', email: sess.email });
        }
        const out = {};
        for (const id of ids) {
          if (!/^[a-z0-9_]{1,24}$/.test(id)) continue;
          const can = tiers.some((t) => tierCovers(t, id));
          out[id] = can ? await env.KEYS.get('content:' + id) : null;
        }
        // 取最宽的那个等级作为展示用
        const best = tiers.includes('FULL') ? 'FULL' : (tiers.includes('PREM') ? 'PREM' : tiers[0]);
        return json({ ok: true, via: 'session', email: sess.email, tier: best, contents: out });
      }

      /* ---- 路径 ②：授权码（赠送 / 客服补发 / 老用户） ---- */
      const v = validateKey(rawKey);
      if (!v) return json({ ok: false, reason: 'need-login-or-key' });

      const storeKey = 'key:' + v.key;
      const raw = await env.KEYS.get(storeKey);
      if (raw === null) return json({ ok: false, reason: 'notfound' });

      let rec;
      try { rec = JSON.parse(raw); } catch { return json({ ok: false, reason: 'corrupt' }); }

      if (rec.revoked) return json({ ok: false, reason: 'revoked' });
      // 已绑别的设备 → 拒绝
      if (rec.bind && device && rec.bind !== device) {
        return json({ ok: false, reason: 'used' });
      }

      // 绑了邮箱的码：允许同邮箱通过（email 参数由前端带上）
      if (rec.email && normEmailLite(body.email) === normEmailLite(rec.email)) {
        // 放行
      }

      const out = {};
      for (const id of ids) {
        if (!/^[a-z0-9_]{1,24}$/.test(id)) continue;
        if (!tierCovers(rec.tier, id)) { out[id] = null; continue; }
        out[id] = await env.KEYS.get('content:' + id);
      }
      return json({ ok: true, via: 'key', tier: rec.tier, contents: out });
    }

    return json({ ok: false, reason: 'unknown' }, 400);
  },
};

/* ==========================================================================
   灌数据

   ---- 一、授权码 ----
   先生成（本地）：
     node build/gen-keys.mjs --n 200 --tier PREM
   再批量写（需要 wrangler，见 README）：
     用 admin 接口更简单：
     curl -X POST https://你的worker.workers.dev \
       -H 'content-type: application/json' \
       -d '{"action":"issue","token":"你的ADMIN_TOKEN","count":200,"tier":"PREM"}'

   ---- 二、付费正文 ----
   本地跑 build/export-content.mjs 会产出 content-kv.json（每行一条
   {key, value}），然后：
     wrangler kv bulk put --binding=KEYS content-kv.json
   或者用 wrangler kv key put 逐条写。

   ⚠️ 正文必须写进 KV，不能留在静态站 —— 否则整个付费墙没有意义。
   ========================================================================== */
