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
    priceLabel: '¥999',
    priceNote: '终身买断 · 一次付清 · 后续修订不再收费',

    /** 价格对比（用于锚定） */
    priceAnchor: '一次一对一咨询的价格（市面 300–600/小时）',

    /* ------------------------------------------------------------------
       服务端校验（一码一机）
       ------------------------------------------------------------------
       留空 → 走本地校验（能挡顺手转发，挡不住把码发群里）
       填了 → 走 Cloudflare Worker，首次激活绑定设备，此后只有这台能用

       部署见 assets/paywall-worker.js 顶部的步骤说明。
       形如：'https://zhouyi-license.你的账号.workers.dev'
       ------------------------------------------------------------------ */
    workerUrl: 'https://zhouyi-api.huangminzhe321.workers.dev',

    /* ------------------------------------------------------------------
       收款码（人工确认模式）
       ------------------------------------------------------------------
       个人收款码没有支付回调，服务器无法自动知道「谁付了钱」。
       所以流程是：
         用户扫码付款 → 点「我已完成付款」→ 你在后台核对到账 → 点确认 → 自动解锁

       图片放在 assets/ 下，填相对路径即可。
       留空则该渠道不显示。
       ------------------------------------------------------------------ */
    payQr: {
      wechat: 'assets/qr-wechat.png',
      alipay: 'assets/qr-alipay.png',
    },

    /** 付款时的提示语（告诉用户备注订单号，方便你对账） */
    payNote: '付款时请在备注里填上订单号，这样能更快确认。',

    /* ------------------------------------------------------------------
       登录方式
       ------------------------------------------------------------------
       'google' —— 只允许 Google 账号登录（当前）
       'both'   —— Google + 邮箱密码
                   （需要先在 Resend 验证域名，否则客户收不到验证码）

       后端 worker/index.js 的 AUTH_MODE 环境变量要与此一致，双保险。
       ------------------------------------------------------------------ */
    authMode: 'google',

    /* ------------------------------------------------------------------
       两档定价
       ------------------------------------------------------------------
       定位：不卖「会员」（那暗示持续服务），卖「买断一套工具」。

       写法原则：不写功能，写他会拿到什么。
         ❌「能看 384 条爻辞解读」
         ✅「你卡住的时候，能在 5 分钟内找到对应的处境和出路」
       ------------------------------------------------------------------ */
    tiers: [
      {
        id: 'PREM',
        name: '六十四卦困境对照表',
        price: 999,
        tagline: '你现在遇到的情况，历史上都有人遇到过',
        featured: true,
        items: [
          ['384 个处境对照',
           '按处境查，不用按卦查。说不清自己卡在哪的时候，扫一遍就能定位。'],
          ['每个处境配三条',
           '这个处境在说什么 · 该做什么（带数字门槛）· 历史上谁遇到过、他怎么选的、结果如何'],
          ['一次 60 分钟一对一诊断',
           '把你自己的具体情况，对到那 384 条里去'],
          ['后续修订免费',
           '内容持续校订，已购版本更新不再收费'],
        ],
        excludes: [
          '你想让我告诉你「辞还是不辞」，我不做这个判断',
          '算命、占卜、择日、改运 —— 本站不提供',
        ],
        note: '限前 100 名含一对一诊断',
      },
      {
        id: 'FULL',
        name: '全站通行',
        price: 1999,
        tagline: '六十四卦 + 孙子兵法 + 史料库，以及后续所有新增',
        featured: false,
        items: [
          ['六十四卦全部内容', '上档全部，含 384 个处境与一对一诊断'],
          ['孙子兵法模块', '同一套「处境 → 出路」的方法，换个原料'],
          ['史料库检索', '我自己在用的 28 部正史全文检索，查典故、写东西直接用'],
          ['后续新增经典免费', '史记精读、资治通鉴精选等，出来就是你的'],
        ],
        excludes: [
          '同上：不做判断、不做占卜',
        ],
        note: '',
      },
    ],

    /* ------------------------------------------------------------------
       平台 1：面包多 mbd.pub

       注册：https://mbd.pub   大陆手机号即可，实名只要身份证正反面
       费率：官方文档口径矛盾（6% 与 13% 并存，页面未更新）
             —— 以你注册后在后台看到的为准，不要以文档为准

       ⚠️ 三个实测确认的坑（来源：官方帮助中心 42 篇全文）

       ① 没有「卡密」功能
          「卡密」「激活码」「授权码」「自动发货」在全部文档中出现 0 次。
          真实机制是变通用法：
            自动回复 → 触发条件「购买指定作品」→ 发送规则「回复递减文字」
          官方原话：「如果你要提供给每个购买者不同的『兑换码』，
                     则可以使用递减消息，保证每个人得到的都不一样」
          设置路径：mbd.pub/o/config/reply（【仅 PC 端】可设）

       ② 码用完会【静默断供】
          官方明文：「当内容库为空时，将停止自动回复」
          → 不能自动补充，买家付了钱收不到码，你也不知道。
          → 上架后必须自己定期检查码的余量。

       ③ 提现门槛
          想开「闪电结算」要先拿「面包多认证」，
          认证条件：100 次销售记录 或 外部平台 1000+ 粉丝。
          新人默认开不了 → 只能走普通模式 T+7。

       ⚠️ 品类红线：官方把「宣扬封建迷信」列为可举报，处置含封号。
          explore 分类里没有玄学位置。上架时品类选「学习 / 资料」，
          定位写「传统文化研读资料」，不要写「算命 / 占卜 / 预测」。
       ------------------------------------------------------------------ */
    mbd: {
      enabled: false,                 // ← 拿到商品链接后改成 true
      name: '面包多',
      desc: '支持微信/支付宝 · 购买后自动回复授权码',
      // 商品 ID 或完整短链的尾段，例如 'abcd1234'
      productId: '',
      // 也可以直接粘贴完整链接（优先级高于 productId）
      directUrl: '',
      fee: '',                        // 官方口径矛盾，填你后台看到的真实数字
    },

    /* ------------------------------------------------------------------
       平台 2：爱发电 afdian.com

       注册：https://afdian.com  个人可开
       费率：6%（无门槛，区别于面包多需要认证）
       用法：填你的主页 uid，再填「方案」id（可选）

       ✅ 发码功能官方文档描述比面包多直白（原话）：
          「自动随机回复这个功能会帮你一行一行地分发激活码」
       ⚠️ 缺点：结算压到次月 1 号（最长约 60 天）
       ------------------------------------------------------------------ */
    afdian: {
      enabled: false,
      name: '爱发电',
      desc: '支持支付宝/微信 · 购买后自动分发激活码',
      userId: '',                     // 你的主页 uid，例如 'abc123'
      planId: '',                     // 可选：某个具体方案的 id
      directUrl: '',
      fee: '6%',
    },

    /* ------------------------------------------------------------------
       平台 3：小报童 xiaobot.net
       注册：https://xiaobot.net  个人可开
       用法：填专栏 slug（专栏地址尾段）
       ⚠️ 费率未经本站核实，以你注册后后台显示的为准
       ------------------------------------------------------------------ */
    xiaobot: {
      enabled: false,
      name: '小报童',
      desc: '微信内直接读 · 无需跳转浏览器 · 更新有提醒',
      slug: '',                       // 专栏地址尾段，例如 'zhouyi'
      directUrl: '',
      fee: '',                        // 未核实
    },

    /* ------------------------------------------------------------------
       平台 4：Gumroad  ← 海外读者 / 有外币卡的用户

       注册：https://gumroad.com
       用法：填商品 permalink，例如 'zhouyi-premium'

       ✅ 技术上最专业的一个 —— 有原生 License Key API
          （支持 verify / enable / disable / decrement / rotate），
          比你自建发码体系更省事。
       ⚠️ 费率：调研查到 10% + $0.50，Discover 渠道 30%。
          以官网当期公示为准。
       ------------------------------------------------------------------ */
    gumroad: {
      enabled: false,
      name: 'Gumroad',
      desc: 'For international readers · card / PayPal',
      permalink: '',
      directUrl: '',
      fee: '10% + $0.50',             // 来源：调研，以官网为准
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
     * 定价档位。每档：{ id, name, price, tagline, items[[标题,说明]], excludes[], note, featured }
     * @returns {Array}
     */
    tiers() {
      return Array.isArray(PAYMENT_CONFIG.tiers) ? PAYMENT_CONFIG.tiers : [];
    },

    /** 取某档配置 */
    tier(id) {
      return this.tiers().find((t) => t.id === id) || null;
    },

    /** 服务端校验地址（空 = 走本地校验） */
    workerUrl() {
      return PAYMENT_CONFIG.workerUrl || '';
    },

    /** 收款码图片地址：{ wechat, alipay } */
    payQr() {
      return PAYMENT_CONFIG.payQr || {};
    },

    /** 付款提示语（提醒备注订单号） */
    payNote() {
      return PAYMENT_CONFIG.payNote || '';
    },

    /** 登录方式：'google' 只允许 Google；'both' 也允许邮箱密码 */
    authMode() {
      return PAYMENT_CONFIG.authMode || 'google';
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
