/* ==========================================================================
   周易六十四卦 · 支付接入层（config-driven）
   --------------------------------------------------------------------------
   纯静态站点没有后端，所以这里【不处理支付】——它只做两件事：

     1. 把「商品」映射成各平台正确的购买链接（buyUrl）
     2. 给页面提供统一的按钮文案 / 价格 / 跳转目标

   真正的收款、发货、对账都在平台侧完成。本站不接触任何资金流，
   这也是唯一合规的做法（见 content/premium-guide.md）。

   ⛔ 绝对不要接：码支付 / 虎皮椒 / 迅虎 / 蓝兔 等「免签支付」。
      它们是无牌照的二次清算（二清），资金冻结风险极高，且违法。
   ========================================================================== */
(function (global) {
  'use strict';

  /* ==========================================================================
     ① 站点所有者需要填写的部分
     ==========================================================================
     把下面每一项的值换成你自己的。留空('')的条目会在页面上自动隐藏，
     所以你可以先只填一个平台，其余保持空字符串即可。
     ========================================================================== */
  const PAYMENT_CONFIG = {
    /** 站点展示用的货币符号与价格（人民币结算；海外平台走美元） */
    currency: 'CNY',
    priceLabel: '¥29',
    priceNote: '一次买断 · 永久可读 · 后续修订免费',

    /** 价格对比（用于锚定，可留空） */
    priceAnchor: '一杯咖啡的价格',

    /* ------------------------------------------------------------------
       平台 1：面包多 mbd.pub  ← 个人首选，自动发货 + API
       注册：https://mbd.pub  需要实名，无需营业执照
       费率：约 5%（以平台当期公示为准）
       用法：在后台建一个「商品」，把商品 ID 填到 productId
       ------------------------------------------------------------------ */
    mbd: {
      enabled: false,                 // ← 拿到商品链接后改成 true
      name: '面包多',
      desc: '自动发货 · 支持微信/支付宝 · 购买后立即拿到授权码',
      // 商品 ID 或完整短链的尾段，例如 'abcd1234'
      productId: '',
      // 也可以直接粘贴完整链接（优先级高于 productId）
      directUrl: '',
      fee: '约 5%',
    },

    /* ------------------------------------------------------------------
       平台 2：爱发电 afdian.com  ← 会员制，适合连载更新
       注册：https://afdian.com  个人可开通
       费率：约 6%
       用法：填你的主页 uid，再填「方案」id（可选）
       ------------------------------------------------------------------ */
    afdian: {
      enabled: false,
      name: '爱发电',
      desc: '按月订阅 · 更新自动推送 · 适合长期跟读',
      userId: '',                     // 你的主页 uid，例如 'abc123'
      planId: '',                     // 可选：某个具体方案的 id
      directUrl: '',
      fee: '约 6%',
    },

    /* ------------------------------------------------------------------
       平台 3：小报童 xiaobot.net  ← 微信生态内阅读体验最好
       注册：https://xiaobot.net  个人可开
       费率：约 10%（含微信支付通道费）
       用法：填专栏 slug
       ------------------------------------------------------------------ */
    xiaobot: {
      enabled: false,
      name: '小报童',
      desc: '微信内直接读 · 无需跳转浏览器 · 更新有提醒',
      slug: '',                       // 专栏地址尾段，例如 'zhouyi'
      directUrl: '',
      fee: '约 10%',
    },

    /* ------------------------------------------------------------------
       平台 4：Gumroad  ← 海外读者 / 有外币卡的用户
       注册：https://gumroad.com  中国大陆主体可直接注册（Stripe 不支持大陆主体，
             但 Gumroad 作为 MoR 替你收款，所以可行）
       费率：10% + 支付通道费
       用法：填商品 permalink，例如 'zhouyi-premium'
       注意：License Key API 可自动发码，但需要你在后台开启
       ------------------------------------------------------------------ */
    gumroad: {
      enabled: false,
      name: 'Gumroad',
      desc: 'For international readers · card / PayPal',
      permalink: '',
      directUrl: '',
      fee: '10%',
    },

    /* ------------------------------------------------------------------
       兜底：手动发货（微信/支付宝收款码 + 人工发码）
       ⚠️ 个人静态收款码用于经营性收款属于违规（央行 2022 规定），
          仅建议在「未办执照前的极小规模测试」阶段临时使用，
          且必须尽快转为个体工商户 + 平台收款。
       ------------------------------------------------------------------ */
    manual: {
      enabled: false,
      name: '手动发货',
      desc: '添加微信，说明来意，人工发送授权码（24 小时内）',
      contact: '',                    // 你的微信号 / 邮箱
      note: '个人收款码仅适用于极小规模测试，正式经营请走平台。',
    },
  };

  /* ==========================================================================
     ② URL 构造器 —— 每个平台的链接规则
     ========================================================================== */

  const BUILDERS = {
    /**
     * 面包多：https://mbd.pub/o/{productId}
     * 短链形式：https://mbd.pub/o/bread/{productId}
     * 这里用通用商品页形式，兼容性最好。
     */
    mbd(cfg) {
      if (cfg.directUrl) return cfg.directUrl;
      if (!cfg.productId) return '';
      return `https://mbd.pub/o/${encodeURIComponent(cfg.productId)}`;
    },

    /**
     * 爱发电：
     *   主页   https://afdian.com/a/{userId}
     *   方案   https://afdian.com/a/{userId}?plan_id={planId}
     *   直购   https://afdian.com/order/create?plan_id={planId}
     */
    afdian(cfg) {
      if (cfg.directUrl) return cfg.directUrl;
      if (!cfg.userId) return '';
      const base = `https://afdian.com/a/${encodeURIComponent(cfg.userId)}`;
      if (!cfg.planId) return base;
      return `${base}?plan_id=${encodeURIComponent(cfg.planId)}`;
    },

    /** 小报童：https://xiaobot.net/p/{slug} */
    xiaobot(cfg) {
      if (cfg.directUrl) return cfg.directUrl;
      if (!cfg.slug) return '';
      return `https://xiaobot.net/p/${encodeURIComponent(cfg.slug)}`;
    },

    /** Gumroad：https://{permalink}.gumroad.com/l/{permalink} */
    gumroad(cfg) {
      if (cfg.directUrl) return cfg.directUrl;
      if (!cfg.permalink) return '';
      const p = encodeURIComponent(cfg.permalink);
      return `https://${p}.gumroad.com/l/${p}`;
    },

    /** 手动发货没有链接，只有联系方式 */
    manual(cfg) {
      return cfg.contact ? String(cfg.contact) : '';
    },
  };

  /* ==========================================================================
     ③ 对外 API
     ========================================================================== */

  const Payment = {
    config: PAYMENT_CONFIG,

    /**
     * 取某平台的购买链接。
     * @param {string} platform 'mbd' | 'afdian' | 'xiaobot' | 'gumroad' | 'manual'
     * @returns {string} 未配置时返回 ''
     */
    buyUrl(platform) {
      const cfg = PAYMENT_CONFIG[platform];
      const build = BUILDERS[platform];
      if (!cfg || !build) return '';
      return build(cfg);
    },

    /**
     * 当前已启用且链接有效的平台列表，按优先级排序。
     * 页面按这个列表渲染购买按钮 —— 顺序即优先级。
     * @returns {Array<{id:string,name:string,desc:string,url:string,fee:string,isManual:boolean}>}
     */
    channels() {
      const ORDER = ['mbd', 'afdian', 'xiaobot', 'gumroad', 'manual'];
      return ORDER
        .map((id) => {
          const cfg = PAYMENT_CONFIG[id] || {};
          const url = this.buyUrl(id);
          return {
            id,
            name: cfg.name || id,
            desc: cfg.desc || '',
            fee: cfg.fee || '',
            url,
            isManual: id === 'manual',
            enabled: !!cfg.enabled && !!url,
          };
        })
        .filter((c) => c.enabled);
    },

    /** 是否至少配置了一个购买渠道 */
    isConfigured() {
      return this.channels().length > 0;
    },

    /** 主渠道（列表第一个），用于主按钮 */
    primaryChannel() {
      return this.channels()[0] || null;
    },

    /** 价格文案，直接放进模板 */
    priceText() {
      return PAYMENT_CONFIG.priceLabel || '';
    },

    /**
     * 未配置任何渠道时的兜底文案 —— 让站点在「还没填链接」时
     * 也不至于显示一个死按钮。
     */
    fallbackNote() {
      return this.isConfigured()
        ? ''
        : '购买渠道尚未配置。站点所有者请打开 assets/payment.js 填写 PAYMENT_CONFIG。';
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Payment;
  global.Payment = Payment;
})(typeof window !== 'undefined' ? window : globalThis);
