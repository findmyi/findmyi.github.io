/* ==========================================================================
   支付通道适配层
   --------------------------------------------------------------------------
   目标：让 Worker 用同一套订单流程，接不同支付商。

   每个 provider 必须实现两个函数：
     createOrder({ outTradeNo, amount, title, notifyUrl, returnUrl })
       → { ok, payUrl?, qrCode?, providerTradeNo?, raw? }
     verifyNotify({ request, rawBody, headers })
       → { ok, outTradeNo, providerTradeNo, amount? } | null

   已实现的 provider：
     · mock     —— 开发用，不真的收钱（用于跑通流程/自测）
     · xorpay   —— 小微商户聚合支付（个人可签，有回调）
     · afdian   —— 爱发电（跳转型，靠 webhook 或轮询订单）

   ⚠️ 换支付商只需在 wrangler.toml 里改 PAY_PROVIDER，并填对应 secret。
   ========================================================================== */

/* ---------------- 通用 ---------------- */

function ok(obj) { return { ok: true, ...obj }; }
function err(reason) { return { ok: false, reason }; }

/* ==========================================================================
   1) mock —— 开发/自测用
   --------------------------------------------------------------------------
   创建订单后立刻返回一个假的二维码地址。
   付款由管理员调用 action:'mock-pay' 手动触发（模拟支付成功回调）。
   ========================================================================== */
export const mock = {
  name: 'mock',

  // 注意：所有 provider 的方法签名统一是 (env, params)
  async createOrder(env, { outTradeNo, amount, title, returnUrl }) {
    // 假的收银台：本站提供一个 /mock-pay 页面，点一下就"付款成功"
    const qs = new URLSearchParams({
      no: outTradeNo || '',
      amount: String(amount || 0),
      title: title || '',
    });
    if (returnUrl) qs.set('ret', returnUrl);
    return ok({ payUrl: '/mock-pay?' + qs.toString(), qrCode: null, providerTradeNo: 'MOCK-' + outTradeNo });
  },

  async verifyNotify() {
    // mock 不走外部回调，由内部接口直接驱动
    return null;
  },
};

/* ==========================================================================
   2) xorpay —— 小微商户聚合支付
   --------------------------------------------------------------------------
   个人可签约（身份证 + 银行卡），资金由持牌机构结算到本人银行卡。
   具体接口参数以官方文档为准，这里给出通用骨架。

   需要的 secret：
     XORPAY_AID      商户号
     XORPAY_APP_SECRET  密钥
     XORPAY_NOTIFY_URL  回调地址（部署后填）
   ========================================================================== */
export const xorpay = {
  name: 'xorpay',

  async createOrder(env, { outTradeNo, amount, title, notifyUrl, returnUrl }) {
    const aid = env.XORPAY_AID;
    const secret = env.XORPAY_APP_SECRET;
    if (!aid || !secret) return err('xorpay-not-configured');

    // ⚠️ 下面是通用骨架。真实字段名/签名算法必须以 XorPay 后台文档为准。
    //    上线前必须替换成官方要求的签名方式。
    const payload = new URLSearchParams({
      aid,
      name: title || '周易六十四卦 · 终身买断',
      pay_type: 'native',            // 扫码
      price: (amount / 100).toFixed(2),   // 分 → 元
      order_id: outTradeNo,
      notify_url: notifyUrl,
      return_url: returnUrl || '',
    });

    try {
      const r = await fetch('https://xorpay.com/api/pay/' + aid, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: payload.toString(),
      });
      const j = await r.json();
      if (!j || j.status !== 'ok') return err('xorpay-create-failed:' + JSON.stringify(j).slice(0, 120));
      return ok({
        payUrl: j.info && j.info.url ? j.info.url : null,
        qrCode: j.info && j.info.qr ? j.info.qr : null,
        providerTradeNo: j.aoid || '',
      });
    } catch (e) {
      return err('xorpay-network:' + e.message);
    }
  },

  async verifyNotify(env, { rawBody }) {
    // ⚠️ 必须验签，否则任何人都能伪造"已支付"回调
    const secret = env.XORPAY_APP_SECRET;
    if (!secret) return null;

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return null;
    }

    // 真实实现要用官方签名算法比对。这里留出校验位。
    if (!body || body.aoid === undefined && body.order_id === undefined) return null;
    if (body.status !== 'payed') return null;

    return {
      ok: true,
      outTradeNo: body.order_id,
      providerTradeNo: String(body.aoid || ''),
      amount: Math.round(Number(body.real_price || body.price || 0) * 100),
    };
  },
};

/* ==========================================================================
   3) afdian —— 爱发电（跳转型）
   --------------------------------------------------------------------------
   爱发电本身能发码，但要让"付款后自动解锁"，需要它的 webhook 推给我们。

   官方文档（guide.afdian.com/creator/developer）:
     回调含 out_trade_no / user_id / user_private_id / status(2=成功)
     官方要求：做幂等（可能重复请求）+ Webhook 与 API 双保险

   需要的 secret：
     AFDIAN_USER_ID
     AFDIAN_TOKEN      （用于主动查订单，做双保险）
   ========================================================================== */
export const afdian = {
  name: 'afdian',

  async createOrder(env, { outTradeNo, tier }) {
    const url = env.AFDIAN_BUY_URL;   // 你的爱发电商品链接
    if (!url) return err('afdian-not-configured');
    return ok({ payUrl: url + (url.includes('?') ? '&' : '?') + 'ref=' + outTradeNo, qrCode: null });
  },

  async verifyNotify(env, { rawBody }) {
    let p;
    try {
      p = JSON.parse(rawBody);
    } catch {
      return null;
    }
    // 爱发电的 webhook 结构：{ ec, em, data: { order: {...} } }
    const order = p && p.data && p.data.order;
    if (!order) return null;
    if (Number(order.status) !== 2) return null;
    return {
      ok: true,
      outTradeNo: order.out_trade_no,
      providerTradeNo: String(order.out_trade_no || ''),
      amount: Math.round(Number(order.total_amount || 0) * 100),
    };
  },
};

/* ==========================================================================
   4) alipay —— 支付宝当面付（扫码支付）
   --------------------------------------------------------------------------
   ⚠️ 前提：必须有营业执照（个体户或企业）。个人签不了。

   签约路径：
     https://open.alipay.com → 创建应用 → 添加「当面付」能力 → 签约

   需要的 secret：
     ALIPAY_APP_ID          应用 APPID
     ALIPAY_PRIVATE_KEY     应用私钥（PKCS#8，单行、不带 BEGIN/END 头尾）
     ALIPAY_PUBLIC_KEY      支付宝公钥（用于验签回调）
     ALIPAY_GATEWAY         可选，默认 https://openapi.alipay.com/gateway.do

   接口：alipay.trade.precreate（预下单，返回二维码内容）
   回调：异步通知，必须用支付宝公钥验签，否则任何人都能伪造「已支付」
   ========================================================================== */

/** 把 PEM 里的换行和头尾去掉，只留 base64 */
function stripPem(s) {
  return String(s || '')
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let s = '';
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

/** 导入 PKCS#8 私钥，用于 RSASSA-PKCS1-v1_5 / SHA-256（= 支付宝的 RSA2） */
async function importPrivateKey(pem) {
  const der = b64ToBytes(stripPem(pem));
  return crypto.subtle.importKey(
    'pkcs8', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
}

/** 导入支付宝公钥（SPKI），用于验签 */
async function importPublicKey(pem) {
  const der = b64ToBytes(stripPem(pem));
  return crypto.subtle.importKey(
    'spki', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['verify']
  );
}

/** 支付宝要求：参数按 key 升序，用 & 拼 k=v，值不 URL 编码 */
function signContent(params) {
  return Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type' && params[k] !== '' && params[k] != null)
    .sort()
    .map((k) => k + '=' + params[k])
    .join('&');
}

/** 上海时间 yyyy-MM-dd HH:mm:ss */
function alipayTimestamp() {
  const d = new Date(Date.now() + 8 * 3600_000);
  const p = (n) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) +
    ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
}

export const alipay = {
  name: 'alipay',

  async createOrder(env, { outTradeNo, amount, title, notifyUrl, returnUrl }) {
    const appId = env.ALIPAY_APP_ID;
    const priv = env.ALIPAY_PRIVATE_KEY;
    if (!appId || !priv) return err('alipay-not-configured');

    const gateway = env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do';

    // 业务参数
    const biz = {
      out_trade_no: outTradeNo,
      total_amount: (amount / 100).toFixed(2),
      subject: (title || '周易六十四卦').slice(0, 256),
      product_code: 'FACE_TO_FACE_PAYMENT',
      timeout_express: '30m',
    };

    // 公共参数
    const params = {
      app_id: appId,
      method: 'alipay.trade.precreate',
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: alipayTimestamp(),
      version: '1.0',
      notify_url: notifyUrl || '',
      biz_content: JSON.stringify(biz),
    };
    if (returnUrl) params.return_url = returnUrl;

    // 签名
    let signB64;
    try {
      const key = await importPrivateKey(priv);
      const data = new TextEncoder().encode(signContent(params));
      const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, data);
      signB64 = bytesToB64(sig);
    } catch (e) {
      return err('alipay-sign-failed:' + e.message);
    }

    // 请求
    const body = new URLSearchParams({ ...params, sign: signB64 });
    let j;
    try {
      const r = await fetch(gateway, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: body.toString(),
      });
      j = await r.json();
    } catch (e) {
      return err('alipay-network:' + e.message);
    }

    // 响应结构：{ alipay_trade_precreate_response: {...}, sign: '...' }
    const resp = j && j.alipay_trade_precreate_response;
    if (!resp || resp.code !== '10000') {
      const msg = resp ? (resp.code + ' ' + (resp.sub_msg || resp.msg || '')) : JSON.stringify(j).slice(0, 160);
      return err('alipay-create-failed:' + msg);
    }

    return ok({
      payUrl: resp.qr_code || null,     // 二维码内容（不是图片，前端用它渲染）
      qrCode: null,
      providerTradeNo: outTradeNo,
      qrText: resp.qr_code || null,
    });
  },

  /** 异步通知验签 */
  async verifyNotify(env, { rawBody }) {
    const pub = env.ALIPAY_PUBLIC_KEY;
    if (!pub) return null;

    let p;
    try {
      p = Object.fromEntries(new URLSearchParams(rawBody));
    } catch {
      return null;
    }
    if (!p.sign) return null;

    // 用除 sign / sign_type 外的参数重算签名串
    const content = signContent(p);

    let valid = false;
    try {
      const key = await importPublicKey(pub);
      const sig = b64ToBytes(decodeURIComponent(p.sign));
      valid = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5', key, sig,
        new TextEncoder().encode(content)
      );
    } catch {
      return null;
    }
    if (!valid) return null;

    if (p.trade_status !== 'TRADE_SUCCESS' && p.trade_status !== 'TRADE_FINISHED') return null;

    return {
      ok: true,
      outTradeNo: p.out_trade_no,
      providerTradeNo: String(p.trade_no || ''),
      amount: Math.round(Number(p.total_amount || 0) * 100),
    };
  },
};

/* ---------------- 选择器 ---------------- */

const PROVIDERS = { mock, xorpay, afdian, alipay };

export function getProvider(name) {
  return PROVIDERS[String(name || 'mock').toLowerCase()] || mock;
}

export const PROVIDER_NAMES = Object.keys(PROVIDERS);
