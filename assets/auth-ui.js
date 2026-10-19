/* ==========================================================================
   前端账号层
   --------------------------------------------------------------------------
   职责：
     · 保存 session（localStorage）
     · 提供 登录 / 注册 / 验证 / 登出 的 UI
     · 给上层一个「当前用户是谁、买了什么」的查询

   用法：
     AuthUI.session()          → token 或 ''
     await AuthUI.me()         → { ok, email, tiers }
     AuthUI.open('login')      → 打开登录弹层
   ========================================================================== */

(function (global) {
  'use strict';

  const SKEY = 'zhouyi.session';
  const EKEY = 'zhouyi.email';

  function workerUrl() {
    return (global.Payment && global.Payment.workerUrl()) || '';
  }

  function session() {
    try { return localStorage.getItem(SKEY) || ''; } catch { return ''; }
  }

  function email() {
    try { return localStorage.getItem(EKEY) || ''; } catch { return ''; }
  }

  function save(token, mail) {
    try {
      if (token) localStorage.setItem(SKEY, token); else localStorage.removeItem(SKEY);
      if (mail) localStorage.setItem(EKEY, mail); else localStorage.removeItem(EKEY);
    } catch { /* 隐私模式 */ }
  }

  async function call(payload) {
    const w = workerUrl();
    if (!w) return { ok: false, reason: 'no-worker' };
    try {
      const r = await fetch(w, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return await r.json();
    } catch {
      return { ok: false, reason: 'network' };
    }
  }

  /* ---------------- 状态缓存 ---------------- */
  let _me = null;
  let _meAt = 0;

  async function me(force) {
    const t = session();
    if (!t) return { ok: false, reason: 'no-session' };
    if (!force && _me && Date.now() - _meAt < 30_000) return _me;
    const r = await call({ action: 'me', session: t });
    if (r.ok) { _me = r; _meAt = Date.now(); }
    else if (r.reason === 'not-logged-in') { save('', ''); _me = null; }
    return r;
  }

  function isLoggedIn() { return !!session(); }

  function hasTier(tier) {
    if (!_me || !_me.tiers) return false;
    if (_me.tiers.indexOf('FULL') !== -1) return true;
    return _me.tiers.indexOf(tier) !== -1;
  }

  function anyTier() {
    return !!(_me && _me.tiers && _me.tiers.length);
  }

  /* ---------------- UI ---------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function makeModal() {
    let m = document.getElementById('authModal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'authModal';
    m.className = 'auth-modal';
    m.hidden = true;
    m.innerHTML = '<div class="auth-box"><button class="auth-close" data-auth-close aria-label="关闭">×</button>'
      + '<div class="auth-body" id="authBody"></div></div>';
    document.body.appendChild(m);
    m.addEventListener('click', (e) => {
      if (e.target === m || e.target.hasAttribute('data-auth-close')) close();
    });
    return m;
  }

  function open(tab) {
    const m = makeModal();
    m.hidden = false;
    requestAnimationFrame(() => m.classList.add('on'));
    render(tab || 'login');
  }

  function close() {
    const m = document.getElementById('authModal');
    if (m) { m.hidden = true; m.classList.remove('on'); }
  }

  let mode = 'login';       // login | signup | verify
  let pendingEmail = '';

  function render(tab) {
    if (tab) mode = tab;
    const body = document.getElementById('authBody');
    if (!body) return;

    if (mode === 'verify') {
      body.innerHTML = [
        '<div class="auth-tt">验证邮箱</div>',
        '<p class="auth-sub">验证码已发送到 <b>' + esc(pendingEmail) + '</b>，10 分钟内有效。</p>',
        '<input class="auth-input" id="authCode" inputmode="numeric" maxlength="6" placeholder="6 位验证码">',
        '<div class="auth-msg" id="authMsg"></div>',
        '<button class="auth-btn" id="authDo">验证并登录</button>',
        '<div class="auth-foot"><a href="#" data-auth-resend>重新发送验证码</a></div>',
      ].join('');
      document.getElementById('authDo').onclick = doVerify;
      body.querySelector('[data-auth-resend]').onclick = async (e) => {
        e.preventDefault();
        const r = await call({ action: 'resend', email: pendingEmail });
        msg(r.ok
          ? (r.devCode ? '已重发（开发模式码：' + r.devCode + '）' : '已重发，请查收邮件')
          : (r.reason || '发送失败'));
        if (r.devCode) { const i = document.getElementById('authCode'); if (i) i.value = r.devCode; }
      };
      setTimeout(() => { const i = document.getElementById('authCode'); if (i) i.focus(); }, 60);
      return;
    }

    const isLogin = mode === 'login';
    body.innerHTML = [
      '<div class="auth-tt">' + (isLogin ? '登录' : '注册') + '</div>',
      '<p class="auth-sub">' + (isLogin
        ? '登录后，你在任何设备买的都会自动恢复。'
        : '注册需要验证邮箱。买过的内容在任何设备登录都能看。') + '</p>',
      '<input class="auth-input" id="authEmail" type="email" placeholder="邮箱" autocomplete="email"',
      '       value="' + esc(isLogin ? email() : '') + '">',
      '<input class="auth-input" id="authPass" type="password" placeholder="密码（至少 8 位）"',
      '       autocomplete="' + (isLogin ? 'current-password' : 'new-password') + '">',
      '<div class="auth-msg" id="authMsg"></div>',
      '<button class="auth-btn" id="authDo">' + (isLogin ? '登录' : '注册并发送验证码') + '</button>',
      '<div class="auth-or"><span>或</span></div>',
      '<button class="auth-btn ghost" id="authGoogle">用 Google 账号继续</button>',
      '<div class="auth-foot">',
      isLogin
        ? '还没有账号？<a href="#" data-auth-switch="signup">注册</a>'
        : '已有账号？<a href="#" data-auth-switch="login">登录</a>',
      '</div>',
    ].join('');

    document.getElementById('authDo').onclick = isLogin ? doLogin : doSignup;
    document.getElementById('authGoogle').onclick = doGoogle;
    body.querySelector('[data-auth-switch]').onclick = (e) => {
      e.preventDefault();
      render(e.target.dataset.authSwitch);
    };

    // 回车提交
    body.querySelectorAll('.auth-input').forEach((el) => {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') (isLogin ? doLogin : doSignup)();
      });
    });
  }

  function msg(s, isErr) {
    const m = document.getElementById('authMsg');
    if (!m) return;
    m.textContent = s || '';
    m.className = 'auth-msg' + (isErr ? ' is-err' : '');
  }

  function val(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  async function doSignup() {
    const e = val('authEmail'), p = val('authPass');
    if (!e || !p) return msg('邮箱和密码都要填', true);
    msg('发送中…');
    const r = await call({ action: 'signup', email: e, password: p });
    if (!r.ok) return msg(r.reason || '注册失败', true);

    // 注册成功后先去验证
    pendingEmail = e;
    mode = 'verify';
    render();
    if (r.devCode) {
      const i = document.getElementById('authCode');
      if (i) i.value = r.devCode;
      msg('开发模式：验证码已自动填入（未配置 RESEND_API_KEY）');
    }
  }

  async function doLogin() {
    const e = val('authEmail'), p = val('authPass');
    if (!e || !p) return msg('邮箱和密码都要填', true);
    msg('登录中…');
    const r = await call({ action: 'login', email: e, password: p });
    if (r.ok) {
      save(r.token, r.email);
      await me(true);
      close();
      global.dispatchEvent(new Event('zhouyi:auth'));
      if (global.toast) global.toast('已登录 · ' + r.email);
      return;
    }
    if (r.needVerify) {
      pendingEmail = e;
      mode = 'verify';
      render();
      if (r.devCode) {
        const i = document.getElementById('authCode');
        if (i) i.value = r.devCode;
      }
      return msg(r.reason || '需要验证邮箱');
    }
    msg(r.reason || '登录失败', true);
  }

  async function doVerify() {
    const code = val('authCode');
    if (!code) return msg('请输入验证码', true);
    msg('验证中…');
    const r = await call({ action: 'verify', email: pendingEmail, code });
    if (!r.ok) return msg(r.reason || '验证失败', true);
    save(r.token, r.email);
    await me(true);
    close();
    global.dispatchEvent(new Event('zhouyi:auth'));
    if (global.toast) global.toast('已验证 · ' + r.email);
  }

  function doGoogle() {
    const w = workerUrl();
    if (!w) return msg('服务端未配置', true);

    // 记住来源，便于回调后跳回
    try { localStorage.setItem('zhouyi.authReturn', location.hash || '#/'); } catch {}

    // 优先用静默模式：如果浏览器已经登录了 Google，
    // 就不弹「选择账号」页，直接拿到授权。
    // 用户没登录或需要确认时，Google 会自动降级到正常授权页。
    location.href = w.replace(/\/$/, '') + '/auth/google';
  }

  async function logout() {
    const t = session();
    if (t) await call({ action: 'logout', session: t });
    save('', '');
    _me = null;
    global.dispatchEvent(new Event('zhouyi:auth'));
    if (global.toast) global.toast('已退出登录');
  }

  /** 处理 Google 回调（URL 里带 ?auth=ok&s=...&e=...） */
  function handleCallback() {
    const h = location.hash || '';
    const q = h.indexOf('?');
    if (q === -1) return false;
    const p = new URLSearchParams(h.slice(q + 1));
    const st = p.get('auth');
    if (!st) return false;

    if (st === 'ok' && p.get('s')) {
      save(p.get('s'), p.get('e') || '');
      _me = null;
      history.replaceState(null, '', location.pathname + (h.split('?')[0] || '#/'));
      global.dispatchEvent(new Event('zhouyi:auth'));
      if (global.toast) global.toast('已用 Google 登录 · ' + (p.get('e') || ''));
      me(true);
      return true;
    }
    if (st === 'err' || st === 'denied') {
      history.replaceState(null, '', location.pathname + (h.split('?')[0] || '#/'));
      if (global.toast) global.toast('Google 登录失败：' + (p.get('r') || st));
      return true;
    }
    return false;
  }

  global.AuthUI = {
    session, email, isLoggedIn, me, hasTier, anyTier,
    open, close, logout, handleCallback, call,
    get cached() { return _me; },
  };
})(window);
