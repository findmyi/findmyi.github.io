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

/* ---------------- 选择器 ---------------- */

const PROVIDERS = { mock, xorpay, afdian };

export function getProvider(name) {
  return PROVIDERS[String(name || 'mock').toLowerCase()] || mock;
}

export const PROVIDER_NAMES = Object.keys(PROVIDERS);
