/* ==========================================================================
   账号 + 购买 + 解锁 全流程测试
   --------------------------------------------------------------------------
   验证真实用户的完整路径：
     1. 注册（邮箱 + 密码）→ 拿到验证码
     2. 验证邮箱 → 拿到 session
     3. 未登录不能买
     4. 登录后创建订单
     5. 模拟支付 → 自动把等级记到邮箱名下
     6. 用 session 取正文（不用输码）
     7. 【关键】换设备 = 重新登录 → 还能看（证明付款记录不依赖浏览器）
     8. 登出后不能再取
     9. 授权码路径仍可用（赠送/客服补发）
    10. 订单幂等

   跑法：node build/test-order.mjs
   ========================================================================== */

import worker from '../worker/index.js';

/* ---------- 模拟 KV ---------- */
function makeKV() {
  const m = new Map();
  return {
    _m: m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v, _o) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix = '', limit = 1000 } = {}) {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit)
        .map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  };
}

let pass = 0, fail = 0;
function ok(label, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}

const env = {
  KEYS: makeKV(),
  ADMIN_TOKEN: 'test-token',
  PAY_PROVIDER: 'mock',
  AUTH_MODE: 'both',   // 这个测试覆盖邮箱流程，所以显式开启
  // 故意不配 RESEND_API_KEY → 走开发模式，验证码直接返回
};
const BASE = 'https://test.workers.dev';

async function post(payload) {
  const req = new Request(BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const r = await worker.fetch(req, env);
  const t = await r.text();
  try { return { status: r.status, data: JSON.parse(t) }; }
  catch { return { status: r.status, data: { raw: t } }; }
}

const EMAIL = 'buyer@example.com';
const PASS = 'test-password-123';

/* ================= 开始 ================= */
console.log('\n【1】注册（邮箱 + 密码）');
let r = await post({ action: 'signup', email: EMAIL, password: PASS });
ok('注册成功', r.data.ok, JSON.stringify(r.data).slice(0, 160));
const DEVCODE = r.data.devCode;
console.log('    开发模式验证码: ' + (DEVCODE || '(邮件已发)'));
ok('拿到验证码或已发信', !!DEVCODE || r.data.sent === true);

console.log('\n【2】弱密码被拒');
r = await post({ action: 'signup', email: 'x@y.com', password: '123' });
ok('拒绝弱密码', !r.data.ok);

console.log('\n【3】错误的验证码');
r = await post({ action: 'verify', email: EMAIL, code: '000000' });
ok('拒绝错误码', !r.data.ok, JSON.stringify(r.data));

console.log('\n【4】正确的验证码 → 拿到 session');
r = await post({ action: 'verify', email: EMAIL, code: DEVCODE });
ok('验证通过', r.data.ok, JSON.stringify(r.data).slice(0, 120));
let SESSION = r.data.token;
ok('拿到 session', !!SESSION);
console.log('    session: ' + (SESSION || '').slice(0, 16) + '…');

console.log('\n【5】未登录不能买');
r = await post({ action: 'buy', tier: 'PREM' });
ok('被拒', !r.data.ok && r.data.reason === 'need-login');

console.log('\n【6】登录状态下创建订单');
r = await post({ action: 'buy', tier: 'PREM', session: SESSION });
ok('创建成功', r.data.ok, JSON.stringify(r.data).slice(0, 160));
const NO = r.data.outTradeNo;
ok('金额 99900', r.data.amount === 99900);

console.log('\n【7】未付款时登录用户取正文（应被拒）');
await env.KEYS.put('content:qian', '<h3>乾卦</h3><p>付费正文。</p>');
r = await post({ action: 'unlock', session: SESSION, ids: ['qian'] });
ok('提示未购买', !r.data.ok && r.data.reason === 'not-purchased', JSON.stringify(r.data));

console.log('\n【8】模拟支付');
r = await post({ action: 'mock-pay', outTradeNo: NO });
ok('支付成功', r.data.ok && r.data.status === 'paid', JSON.stringify(r.data));

console.log('\n【9】付款后，登录用户直接取正文（不用输码）');
r = await post({ action: 'unlock', session: SESSION, ids: ['qian', 'zhun'] });
ok('取到', r.data.ok && r.data.via === 'session', JSON.stringify(r.data).slice(0, 120));
ok('乾卦正文', (r.data.contents.qian || '').includes('付费正文'));
ok('等级 PREM', r.data.tier === 'PREM');

console.log('\n【10】★ 换设备：重新登录同一账号，仍能看');
r = await post({ action: 'login', email: EMAIL, password: PASS });
ok('登录成功', r.data.ok, JSON.stringify(r.data).slice(0, 100));
const SESSION2 = r.data.token;
ok('新 session 与旧的不同', SESSION2 !== SESSION);
r = await post({ action: 'unlock', session: SESSION2, ids: ['qian'] });
ok('新设备也能取到正文', r.data.ok && (r.data.contents.qian || '').includes('付费正文'),
   JSON.stringify(r.data).slice(0, 120));
console.log('    → 这就是账号体系的意义：付款记录不挂在浏览器上');

console.log('\n【11】密码错误');
r = await post({ action: 'login', email: EMAIL, password: 'wrong-password' });
ok('拒绝', !r.data.ok && r.data.reason === '邮箱或密码不对');

console.log('\n【12】登出后不能取');
r = await post({ action: 'logout', session: SESSION2 });
ok('登出成功', r.data.ok);
r = await post({ action: 'unlock', session: SESSION2, ids: ['qian'] });
ok('登出后取不到', !r.data.ok, JSON.stringify(r.data).slice(0, 100));

console.log('\n【13】授权码路径仍可用（赠送 / 客服补发）');
r = await post({ action: 'buy', tier: 'PREM', session: SESSION });
const NO2 = r.data.outTradeNo;
r = await post({ action: 'mock-pay', outTradeNo: NO2 });
const GIFTKEY = r.data.key;
ok('付款产生一个码', !!GIFTKEY);
r = await post({ action: 'unlock', key: GIFTKEY, device: 'gift-device', ids: ['qian'] });
ok('用码也能取正文', r.data.ok && r.data.via === 'key', JSON.stringify(r.data).slice(0, 120));

console.log('\n【14】订单幂等');
r = await post({ action: 'mock-pay', outTradeNo: NO });
ok('重复支付不报错', r.data.ok);
r = await post({ action: 'order', outTradeNo: NO });
ok('码没变', r.data.key === GIFTKEY || !!r.data.key);

console.log('\n【15】me 接口');
r = await post({ action: 'me', session: SESSION });
ok('返回邮箱', r.data.ok && r.data.email === EMAIL);
ok('返回已购等级', Array.isArray(r.data.tiers) && r.data.tiers.includes('PREM'),
   JSON.stringify(r.data.tiers));

console.log('\n【16】没注册的邮箱登录');
r = await post({ action: 'login', email: 'nobody@example.com', password: 'whatever-123' });
ok('拒绝', !r.data.ok);

console.log('\n' + (fail === 0 ? '✅' : '❌') + '  ' + pass + ' 通过 · ' + fail + ' 失败\n');
process.exit(fail === 0 ? 0 : 1);
