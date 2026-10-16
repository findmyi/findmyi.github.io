/* ==========================================================================
   授权码 · 服务端校验增强层（一码一机）
   --------------------------------------------------------------------------
   背景：
     基础层（license.js）的校验是【本地】的 —— 挡住的是「顺手转发」，
     挡不住「把码发到群里」。

     本层加上服务端：首次使用把码绑定到一台设备，此后只有这台能用。

   设计原则（很重要）：
     【绝不因为服务端挂了而锁死已购用户】

     Worker 通  → 走服务端，一码一机
     Worker 挂  → 自动降级成本地校验，已购用户照常使用
     首次激活   → 服务端说「已被别的设备用了」才拒绝

   加载顺序（index.html）：
     license.js → license-server.js → app.js
   ========================================================================== */

(function (global) {
  'use strict';

  const DEVICE_KEY = 'zhouyi.device';

  /* ==========================================================================
     设备指纹
     --------------------------------------------------------------------------
     不是 UUID —— 是浏览器特征 + 随机种子，稳定且不侵犯隐私。
     清缓存会变，这是有意的：正常用户不会清缓存。
     ========================================================================== */
  function deviceId() {
    let id = null;
    try {
      id = localStorage.getItem(DEVICE_KEY);
    } catch { /* 隐私模式 */ }
    if (id) return id;

    // 采集稳定特征（不含任何个人身份信息）
    const parts = [
      navigator.language || '',
      navigator.platform || '',
      screen.width + 'x' + screen.height,
      screen.colorDepth || '',
      new Date().getTimezoneOffset(),
      navigator.hardwareConcurrency || '',
      navigator.maxTouchPoints || '',
    ].join('|');

    id = 'd' + global.License.fnv1a(parts).toString(36)
       + '-' + Math.random().toString(36).slice(2, 10);

    try {
      localStorage.setItem(DEVICE_KEY, id);
    } catch { /* 写不进去也不影响本次会话 */ }
    return id;
  }

  /* ==========================================================================
     服务端调用
     ========================================================================== */

  /**
   * 调用 Worker。
   * @returns {Promise<{ok:boolean, tier?:string, reason?:string, offline?:boolean}>}
   */
  async function callWorker(action, key) {
    const cfg = (global.PAYMENT_CONFIG || {});
    const url = cfg.workerUrl || '';
    if (!url) return { ok: false, reason: 'noworker', offline: true };

    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 6000);   // 6 秒超时

      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, key, device: deviceId() }),
        signal: ctl.signal,
      });
      clearTimeout(timer);

      if (!r.ok && r.status >= 500) {
        return { ok: false, reason: 'server', offline: true };
      }
      return await r.json();
    } catch {
      // 网络错误 / 超时 → 视为离线，降级
      return { ok: false, reason: 'network', offline: true };
    }
  }

  /* ==========================================================================
     增强的激活流程

     返回结构与 License.activate 一致，另外多两个字段：
       source: 'server' | 'local'
       reason: 失败原因（用于给用户看的话术）
     ========================================================================== */
  async function activate(raw) {
    // 1. 先做本地格式校验 —— 格式错的没必要打网络
    const local = global.License.validate(raw);
    if (!local.ok) return { ok: false, reason: local.reason };

    // 2. 问服务端（如果配了）
    const res = await callWorker('redeem', local.key);

    if (res.offline) {
      // 服务端不可用 → 降级：信任本地校验
      const a = global.License.activate(local.key);
      if (!a.ok) return a;
      return { ok: true, tier: a.tier, label: a.label, source: 'local' };
    }

    if (!res.ok) {
      // 服务端明确拒绝 —— 这里要区分原因，给不同话术
      const MSG = {
        used: '这个授权码已经在另一台设备上激活了。授权码为一人一码，如需换机请联系我们。',
        revoked: '这个授权码已被停用。如果你认为这是误判，请联系我们。',
        notfound: '系统里查不到这个授权码。请核对是否抄错，或联系卖家确认发货。',
        invalid: '授权码格式不正确。请检查是否漏抄或抄错了字符。',
      };
      return { ok: false, reason: MSG[res.reason] || '授权码校验未通过，请稍后重试或联系我们。' };
    }

    // 3. 服务端通过 → 本地保存
    const a = global.License.activate(local.key);
    if (!a.ok) return a;
    return { ok: true, tier: a.tier, label: a.label, source: 'server' };
  }

  /** 仅检查（不绑定），用于「已购用户换设备前的自查」 */
  async function check(raw) {
    const local = global.License.validate(raw);
    if (!local.ok) return { ok: false, reason: local.reason };
    const res = await callWorker('check', local.key);
    if (res.offline) return { ok: true, tier: local.tier, source: 'local' };
    return res;
  }

  /* ==========================================================================
     导出（挂在 License 上，不覆盖原有 API）
     ========================================================================== */
  global.LicenseServer = {
    deviceId,
    activate,
    check,
    callWorker,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.LicenseServer;
  }
})(typeof window !== 'undefined' ? window : globalThis);
