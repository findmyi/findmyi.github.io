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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/health') return json({ ok: true, ts: Date.now() });
    if (request.method !== 'POST') return json({ ok: false, reason: 'method' }, 405);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, reason: 'badjson' }, 400);
    }

    const { action, key: rawKey, device } = body || {};

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
      const v = validateKey(rawKey);
      if (!v) return json({ ok: false, reason: 'invalid' });

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

      const ids = Array.isArray(body.ids) ? body.ids.slice(0, 8) : [];
      if (!ids.length) return json({ ok: false, reason: 'noids' });

      const out = {};
      for (const id of ids) {
        if (!/^[a-z0-9_]{1,24}$/.test(id)) continue;
        if (!tierCovers(rec.tier, id)) { out[id] = null; continue; }
        out[id] = await env.KEYS.get('content:' + id);
      }
      return json({ ok: true, tier: rec.tier, contents: out });
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
