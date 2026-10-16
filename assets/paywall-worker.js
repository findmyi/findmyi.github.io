/* ==========================================================================
   周易六十四卦 · 授权码服务端校验（Cloudflare Worker + KV）
   --------------------------------------------------------------------------
   解决的问题：前端校验（assets/license.js）只是混淆，挡住的是「顺手转发」，
   挡不住「把码发到群里」。本 Worker 做三件事：

     1. 校验授权码合法性（与 license.js 同一套算法）
     2. 【一码一机】首次使用时把码绑定到一台设备，此后只有这台能用
     3. 返回付费正文（正文不在静态产物里，绕过前端毫无意义）

   --------------------------------------------------------------------------
   部署步骤（约 20 分钟，全部免费）

   ① 注册 Cloudflare（免费）
      https://dash.cloudflare.com/sign-up

   ② 建 KV 命名空间
      控制台左侧 → Storage & Databases → KV → Create namespace
      名字填：ZHOUYI_KEYS
      建好后记下它的 ID

   ③ 建 Worker
      左侧 → Workers & Pages → Create → Worker
      名字填：zhouyi-license
      把本文件的代码整段粘进去，Deploy

   ④ 绑定 KV
      Worker 页面 → Settings → Bindings → Add → KV Namespace
      Variable name 填：KEYS        （必须一字不差）
      KV namespace 选：ZHOUYI_KEYS
      保存

   ⑤ 导入授权码
      在 Worker 页面 → Settings → 或本地用 wrangler：
        wrangler kv:key put --binding=KEYS "key:ZY-PREM-XXXX-XXXX-X" "unused"
      批量导入见文末的 importKeys()

   ⑥ 把 Worker 的 URL 填进 assets/payment.js 的 workerUrl 字段

   --------------------------------------------------------------------------
   数据模型（KV）

     key:ZY-PREM-XXXX-XXXX-X   →  {"tier":"PREM","bind":null,"used":0,"at":null}
     key:ZY-PREM-XXXX-XXXX-X   →  {"tier":"PREM","bind":"a1b2c3...","used":1,"at":1712...}

     bind   = 设备指纹（首次使用时的浏览器指纹哈希）
     used   = 使用次数
     at     = 首次使用时间戳

   设备指纹由前端生成（见 assets/license.js 的 deviceId()），
   存 localStorage —— 清缓存会变，这是有意的：正常用户不会清。
   ========================================================================== */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

/* ---- 与 assets/license.js 完全相同的校验算法 ---- */
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

function validateKey(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== KEY_LEN || s.slice(0, 2) !== 'ZY') return null;
  const body = s.slice(0, KEY_LEN - 1);
  const check = s.slice(KEY_LEN - 1);
  const expect = ALPHABET[fnv1a(body) % ALPHABET.length];
  if (check !== expect) return null;
  return { key: s, tier: s.slice(2, 6) };
}

/* ---- 工具：JSON 响应 ---- */
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

/* ==========================================================================
   主入口

   请求体：{ action: 'redeem' | 'check' | 'revoke', key: '...', device: '...' }
   响应：  { ok: true, tier: 'PREM', bound: true }
          { ok: false, reason: 'invalid' | 'used' | 'notfound' | 'already' }
   ========================================================================== */
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }
    if (request.method !== 'POST') {
      return json({ ok: false, reason: 'method' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, reason: 'badjson' }, 400);
    }

    const { action, key: rawKey, device } = body || {};

    const v = validateKey(rawKey);
    if (!v) return json({ ok: false, reason: 'invalid' });

    const storeKey = 'key:' + v.key;
    const raw = await env.KEYS.get(storeKey);

    /* ---------------- 管理员撤销 ----------------
       用 env.ADMIN_TOKEN 保护。设置方法：
       Worker → Settings → Variables → 加密变量 ADMIN_TOKEN = 你自己的随机串
    */
    if (action === 'revoke') {
      if (!env.ADMIN_TOKEN || body.token !== env.ADMIN_TOKEN) {
        return json({ ok: false, reason: 'forbidden' }, 403);
      }
      await env.KEYS.put(storeKey, JSON.stringify({
        tier: v.tier, bind: null, used: 0, at: null, revoked: true,
      }));
      return json({ ok: true, revoked: true });
    }

    /* ---------------- 首次兑换：绑定设备 ---------------- */
    if (action === 'redeem') {
      if (!device) return json({ ok: false, reason: 'nodevice' });

      // 首次使用：写入 KV
      if (raw === null) {
        await env.KEYS.put(storeKey, JSON.stringify({
          tier: v.tier, bind: device, used: 1, at: Date.now(),
        }));
        return json({ ok: true, tier: v.tier, bound: true, first: true });
      }

      let rec;
      try {
        rec = JSON.parse(raw);
      } catch {
        return json({ ok: false, reason: 'corrupt' });
      }

      if (rec.revoked) return json({ ok: false, reason: 'revoked' });

      // 已绑定到别的设备 → 拒绝（这就是「一码一人」）
      if (rec.bind && rec.bind !== device) {
        return json({ ok: false, reason: 'used' });
      }

      // 同设备复访：更新计数
      rec.used = (rec.used || 0) + 1;
      rec.bind = device;
      await env.KEYS.put(storeKey, JSON.stringify(rec));
      return json({ ok: true, tier: rec.tier, bound: true });
    }

    /* ---------------- 仅校验（不绑定） ---------------- */
    if (action === 'check') {
      if (raw === null) return json({ ok: false, reason: 'notfound' });
      let rec;
      try {
        rec = JSON.parse(raw);
      } catch {
        return json({ ok: false, reason: 'corrupt' });
      }
      if (rec.revoked) return json({ ok: false, reason: 'revoked' });
      if (rec.bind && device && rec.bind !== device) {
        return json({ ok: false, reason: 'used' });
      }
      return json({ ok: true, tier: rec.tier });
    }

    return json({ ok: false, reason: 'unknown' }, 400);
  },
};

/* ==========================================================================
   批量导入授权码（在本地跑，需要 wrangler）

   先装 wrangler：
     npm i -g wrangler
     wrangler login

   然后在项目根目录跑（把 keys.csv 的第一列换成你的码）：
     node -e "
       const fs=require('fs');
       const keys=fs.readFileSync('build/keys.csv','utf8')
         .split(/\r?\n/).map(l=>l.split(',')[0].trim()).filter(k=>k.startsWith('ZY-'));
       const out=keys.map(k=>JSON.stringify({key:k.replace(/-/g,''),tier:k.split('-')[1],
         bind:null,used:0,at:null})).join('\n');
       fs.writeFileSync('build/kv-bulk.json', out);
       console.log('导出 '+keys.length+' 条 → build/kv-bulk.json');
     "

   再批量写进 KV：
     wrangler kv bulk put --binding=KEYS build/kv-bulk.json

   ========================================================================== */
