/* ==========================================================================
   【可选·进阶】Cloudflare Worker 服务端校验示例
   --------------------------------------------------------------------------
   文件后缀是 .example.js —— 不会被站点加载，它是给你抄的模板。

   什么时候需要它？
     当单份付费内容的价值超过「用户懒得破解」的程度时。
     前端校验（assets/license.js）本质是混淆，能挡顺手转发，
     挡不住 F12。要真正防住，必须把「校验」和「正文」都放到服务端。

   怎么用（约 15 分钟）：
     1. 注册 Cloudflare（免费额度：10 万次请求/天，足够）
     2. 新建 Worker，把下面的代码粘进去
     3. 在 Worker 的 Settings → Variables 里加一个 KEYS 变量：
          KEYS = "ZY-PREM-7K2M-9QX4-D,ZY-PREM-XXXX-XXXX-X"
        （或升级为 KV / D1 存储，见文末 TODO）
     4. 把付费正文放进 R2 存储桶或 KV，键名 premium/{articleId}.html
     5. 前端把 fetch 指向这个 Worker 的 URL

   前端调用示例（替换 assets/app.js 里的 article() 即可）：

     async function article(id) {
       if (!Entitlement.needsPaywall(id)) return getText(`articles/${id}.html`);
       const key = License.all()[0] || '';
       const r = await fetch(PAYMENT_WORKER_URL, {
         method: 'POST',
         headers: { 'content-type': 'application/json' },
         body: JSON.stringify({ id, key }),
       });
       if (!r.ok) throw new Error('HTTP ' + r.status);
       return r.text();   // Worker 直接返回正文 HTML
     }

   此时：付费正文根本不在静态产物里，绕过前端毫无意义。
   ========================================================================== */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

/* ---- 复用与 assets/license.js 完全相同的校验算法 ---- */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';   // 30 字符，去掉 0 O 1 I L U
const KEY_LEN = 15;                                   // ZY+等级4+随机4+随机4+校验1

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
  const parts = [s.slice(0, 2), s.slice(2, 6), s.slice(6, 10), s.slice(10, 14), s.slice(14, 15)];
  const body = parts.slice(0, 4).join('-');
  if (ALPHABET[fnv1a(body) % ALPHABET.length] !== parts[4]) return null;
  return { key: parts.join('-'), tier: parts[1] };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') {
      return new Response('method not allowed', { status: 405, headers: CORS });
    }

    let body;
    try { body = await request.json(); } catch {
      return new Response('bad json', { status: 400, headers: CORS });
    }

    const { id, key } = body || {};
    if (!/^[a-z0-9-]{1,40}$/.test(String(id || ''))) {
      return new Response('bad id', { status: 400, headers: CORS });
    }

    /* ---- ① 校验授权码 ---- */
    const lic = validateKey(key);
    if (!lic) {
      return new Response('invalid license', { status: 401, headers: CORS });
    }

    /* ---- ② 查白名单：这个码是否真的卖出去过？ ---- */
    // 生产环境请换成 KV：await env.KEYS_KV.get(lic.key)
    const allowed = String(env.KEYS || '')
      .split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
    if (!allowed.includes(lic.key)) {
      return new Response('license not recognised', { status: 403, headers: CORS });
    }

    /* ---- ③ 等级是否有权看这一篇 ---- */
    const QK_SCOPE = ['qian', 'kun'];
    if (lic.tier === 'QK' && !QK_SCOPE.includes(id)) {
      return new Response('tier does not cover this article', { status: 403, headers: CORS });
    }

    /* ---- ④ 取正文 ---- */
    // 演示：从 R2 取。也可以换成 KV 或直接内联的 HTML 字符串。
    const obj = await env.PREMIUM.get(`premium/${id}.html`);
    if (!obj) return new Response('not found', { status: 404, headers: CORS });

    return new Response(obj.body, {
      headers: {
        ...CORS,
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',   // 授权内容不进 CDN 缓存
      },
    });
  },
};

/* ==========================================================================
   TODO：升级到 KV 的步骤
   --------------------------------------------------------------------------
   wrangler kv:namespace create KEYS
   # 把返回的 id 写进 wrangler.toml：
   #   kv_namespaces = [{ binding = "KEYS_KV", id = "<id>" }]
   然后批量导入已售出的授权码：
   for (const k of keys) await env.KEYS_KV.put(k, JSON.stringify({ tier: 'PREM', issued: Date.now() }));
   这样就能支持【吊销】——退款后删掉 KV 记录即可，前端换 key 也没用。
   ========================================================================== */
