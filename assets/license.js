/* ==========================================================================
   周易六十四卦 · 授权码（License Key）校验模块
   --------------------------------------------------------------------------
   ⚠️ 安全声明 —— 请务必读完再决定定价策略
   --------------------------------------------------------------------------
   本站是纯静态站点（GitHub Pages，无后端）。因此授权码只能在浏览器端
   离线校验。这意味着：

     1. 校验算法对任何人都是可见的（F12 打开就能读到这个文件）。
     2. 任何拿到算法的人都能自己造出一个「合法」的授权码。
     3. 因此本模块提供的是【混淆 / 摩擦】，不是【安全】。

   它能挡住的是：
     ✓ 顺手把文章链接转发给朋友的人（对方看不懂为什么打不开）
     ✓ 搜索引擎爬到付费正文（付费段本来就不写进 HTML —— 见下）
     ✓ 普通读者误以为可以随便看

   它挡不住的是：
     ✗ 任何会用 F12 的人
     ✗ 拿到 key 之后的再分享

   【最重要的一条原则】
     付费内容不要在客户端「藏」，而要在构建期就【不发布】。
     本站的做法是：付费深度内容（premium/*.html）单独存放，
     构建时只有拿到 key 的验证接口（未来接 Cloudflare Worker）
     才会返回正文。当前实现里，锁住的段落只有**摘要**进了 HTML，
     完整正文根本不在静态产物中。这样即使校验被绕过，也拿不到内容。

   【升级路径】
     见 assets/paywall-worker.example.js —— 一个 Cloudflare Worker
     示例：把 key 校验 + 正文下发放到服务端，前端只拿渲染结果。
     到那一步，「绕过前端校验」就彻底无效了。

   授权码格式
   --------------------------------------------------------------------------
     ZY - TTTT - XXXX - XXXX - C
     │    │      │      │      └─ 校验位（1 位）
     │    │      │      └─ 随机体（4 位）
     │    │      └─ 随机体（4 位）
     │    └─ 等级码（4 位，见 TIERS）
     └─ 前缀（固定 ZY，周易 ZhouYi）

   例：ZY-PREM-7K2M-9QX4-M

   校验算法：对去掉校验位后的字符串做 FNV-1a 32 位哈希，
   再对无歧义字符表取模，得到 1 位校验字符。
   为什么用 FNV-1a 而不是 SHA-256：校验位只需挡住「抄错一位」，
   没必要上 Web Crypto（它是异步的，会让 unlock() 也变成异步）。
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---------- 配置 ---------- */

  /** localStorage 键名：所有已解锁的授权码 */
  const STORAGE_KEY = 'zhouyi.licenses';

  /**
   * 等级定义。key 会出现在授权码里，所以必须是【定长 4 字符】
   * —— 授权码靠位置切片解析，长度不齐会让后续字段整体错位。
   * scope = 该等级解锁的文章 id 列表；'*' 表示全部。
   */
  const TIERS = {
    PREM: {
      label: '全站通行',
      desc: '解锁六十四卦全部深度解读',
      scope: '*',
    },
    QK00: {
      label: '乾坤专享',
      desc: '仅解锁乾、坤两卦的深度解读',
      scope: ['qian', 'kun'],
    },
  };

  /** 等级码固定宽度 */
  const TIER_LEN = 4;

  /** 前缀 */
  const PREFIX = 'ZY';

  /* 无歧义字符表：32 个字符里去掉了 0 O 1 I L U（易与数字/彼此混淆）。
     注意：这是一张【查找表】，不是位打包 —— 校验位只需 1 个字符，
     表长不必是 2 的幂。用 % ALPHABET.length 取模即可。 */
  const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  const KEY_LEN = 15;   // ZY + 等级4 + 随机4 + 随机4 + 校验1

  /* ---------- 校验位算法 ---------- */

  /**
   * FNV-1a 32 位哈希。
   * @param {string} s 输入（会先统一成大写）
   * @returns {number} 0 .. 2^32-1
   */
  function fnv1a(s) {
    let h = 0x811c9dc5;                       // FNV offset basis
    const str = String(s).toUpperCase();
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      // h *= 16777619，用移位避免 32 位溢出精度问题
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  /**
   * 由「前缀-等级-随机体」算出 1 位校验字符。
   * @param {string} body 形如 "ZY-PREM-7K2M-9QX4"
   */
  function checksum(body) {
    return ALPHABET[fnv1a(body) % ALPHABET.length];
  }

  /* ---------- 归整 ---------- */

  /**
   * 把用户输入的各种写法归一化成标准形式。
   * 容忍：小写、空格、中文标点、缺横线、全角字符。
   * @param {string} raw
   * @returns {string} 形如 ZY-PREM-7K2M-9QX4-M（失败返回 ''）
   */
  function normalize(raw) {
    if (raw == null) return '';
    // 全角转半角 + 只保留字母数字
    const s = String(raw)
      .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (s.length !== KEY_LEN) return '';
    if (s.slice(0, 2) !== PREFIX) return '';
    const tier = s.slice(2, 2 + TIER_LEN);
    const r1 = s.slice(6, 10);
    const r2 = s.slice(10, 14);
    const ck = s.slice(14, 15);
    return [PREFIX, tier, r1, r2, ck].join('-');
  }

  /**
   * 校验一个授权码。
   * @param {string} raw 用户输入
   * @returns {{ok:boolean, key?:string, tier?:string, reason?:string}}
   */
  function validate(raw) {
    const key = normalize(raw);
    if (!key) {
      return { ok: false, reason: '格式不正确。授权码形如 ZY-PREM-7K2M-9QX4-M（ZY + 4 段，共 15 位字符）。' };
    }
    const parts = key.split('-');
    const tier = parts[1];
    if (!TIERS[tier]) {
      return { ok: false, reason: `未知的授权等级「${tier}」。请核对购买时收到的邮件。` };
    }
    const body = parts.slice(0, 4).join('-');
    const expect = checksum(body);
    if (expect !== parts[4]) {
      return { ok: false, reason: '校验位不匹配。请检查是否漏抄或抄错了字符。' };
    }
    return { ok: true, key, tier };
  }

  /* ---------- 存储 ---------- */

  function readStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function writeStore(arr) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
      return true;
    } catch {
      return false; // 隐私模式 / 配额满
    }
  }

  /* ---------- 对外 API ---------- */

  const License = {
    STORAGE_KEY,
    TIERS,
    PREFIX,
    ALPHABET,
    KEY_LEN,

    normalize,
    validate,
    checksum,
    fnv1a,

    /** 已保存的全部授权码（字符串数组） */
    all() {
      return readStore();
    },

    /**
     * 已解锁的等级列表。未知等级会被过滤掉。
     * @returns {string[]} 如 ['PREM']
     */
    activeTiers() {
      return readStore()
        .map((k) => validate(k))
        .filter((r) => r.ok)
        .map((r) => r.tier);
    },

    /** 是否已激活任意授权 */
    isActive() {
      return this.activeTiers().length > 0;
    },

    /**
     * 激活一个授权码并持久化。
     * @param {string} raw
     * @returns {{ok:boolean, tier?:string, label?:string, reason?:string}}
     */
    activate(raw) {
      const res = validate(raw);
      if (!res.ok) return res;

      const list = readStore();
      if (!list.includes(res.key)) {
        list.push(res.key);
        if (!writeStore(list)) {
          return { ok: false, reason: '浏览器拒绝写入本地存储（可能处于隐私模式）。请关闭无痕浏览后重试。' };
        }
      }
      return { ok: true, tier: res.tier, label: TIERS[res.tier].label };
    },

    /** 撤销本机全部授权（换机/退款场景） */
    clear() {
      writeStore([]);
    },

    /**
     * 某等级是否覆盖某篇文章。
     * @param {string[]} tiers
     * @param {string} articleId
     */
    tiersCover(tiers, articleId) {
      return tiers.some((t) => {
        const def = TIERS[t];
        if (!def) return false;
        return def.scope === '*' || def.scope.indexOf(articleId) !== -1;
      });
    },

    /**
     * 授权码里允许出现的字符集（供生成脚本与输入框过滤复用）。
     */
    isAllowedChar(ch) {
      return ALPHABET.indexOf(String(ch).toUpperCase()) !== -1;
    },
  };

  /* ---------- 导出 ---------- */

  if (typeof module !== 'undefined' && module.exports) module.exports = License;
  global.License = License;

  /* 同时在 app.js 加载前挂到 window.Entitlement 的底层依赖上，
     实际的门面（isUnlocked / unlock）在 app.js 中定义。 */
})(typeof window !== 'undefined' ? window : globalThis);
