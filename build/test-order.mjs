/* ==========================================================================
   订单流程端到端测试（本地）
   --------------------------------------------------------------------------
   验证「用户网站自助购买」这条链路：
     1. 创建订单
     2. 查订单（pending）
     3. 模拟支付
     4. 查订单（paid + 拿到码）
     5. 用这个码兑换（绑定设备）
     6. 用这个码取正文
     7. 换设备用同一个码 → 应被拒
     8. 重复支付回调 → 幂等（不重复发码）

   跑法：node build/test-order.mjs
   ========================================================================== */

import worker from '../worker/index.js';

/* ---------- 模拟 KV（支持 expirationTtl） ---------- */
function makeKV() {
  const m = new Map();
  return {
    _m: m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v, _opts) { m.set(k, v); },
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
};
const BASE = 'https://test.workers.dev';

async function post(payload, path = '/') {
  const req = new Request(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const r = await worker.fetch(req, env);
  const text = await r.text();
  try { return { status: r.status, data: JSON.parse(text) }; }
  catch { return { status: r.status, data: { raw: text } }; }
}

async function get(path) {
  const r = await worker.fetch(new Request(BASE + path), env);
  return { status: r.status, text: await r.text() };
}

/* ================= 开始 ================= */
console.log('\n【1】创建订单（PREM ¥999）');
let r = await post({ action: 'buy', tier: 'PREM' });
ok('创建成功', r.data.ok, JSON.stringify(r.data));
const NO = r.data.outTradeNo;
console.log('    订单号: ' + NO);
ok('金额 99900 分', r.data.amount === 99900, String(r.data.amount));
ok('provider 是 mock', r.data.provider === 'mock');
ok('有支付地址', !!r.data.payUrl, r.data.payUrl || '');

console.log('\n【2】查订单（应为 pending，且不给码）');
r = await post({ action: 'order', outTradeNo: NO });
ok('查到', r.data.ok);
ok('状态 pending', r.data.status === 'pending', r.data.status);
ok('不给码', r.data.key === null, String(r.data.key));

console.log('\n【3】模拟支付');
r = await post({ action: 'mock-pay', outTradeNo: NO });
ok('支付成功', r.data.ok && r.data.status === 'paid', JSON.stringify(r.data));
const KEY = r.data.key;
console.log('    发出授权码: ' + KEY);
ok('拿到码', !!KEY);

console.log('\n【4】再查订单（应为 paid + 有码）');
r = await post({ action: 'order', outTradeNo: NO });
ok('状态 paid', r.data.status === 'paid');
ok('返回同一个码', r.data.key === KEY);

console.log('\n【5】幂等：重复支付不应换码');
r = await post({ action: 'mock-pay', outTradeNo: NO });
ok('标记已支付过', r.data.ok);
r = await post({ action: 'order', outTradeNo: NO });
ok('码没变', r.data.key === KEY, r.data.key);

console.log('\n【6】用这个码兑换（绑定设备）');
r = await post({ action: 'redeem', key: KEY, device: 'buyer-device' });
ok('兑换成功', r.data.ok, JSON.stringify(r.data));
ok('等级 PREM', r.data.tier === 'PREM');

console.log('\n【7】取付费正文');
// 先塞一篇测试正文
await env.KEYS.put('content:qian', '<h3>乾卦</h3><p>这是付费正文。</p>');
r = await post({ action: 'unlock', key: KEY, device: 'buyer-device', ids: ['qian'] });
ok('取到正文', r.data.ok && !!r.data.contents.qian, JSON.stringify(r.data).slice(0, 160));
ok('内容正确', (r.data.contents.qian || '').includes('付费正文'));

console.log('\n【8】换设备用同一个码（应被拒）');
r = await post({ action: 'unlock', key: KEY, device: 'another-device', ids: ['qian'] });
ok('被拒', !r.data.ok && r.data.reason === 'used', JSON.stringify(r.data));

console.log('\n【9】错误等级 / 错误订单号');
r = await post({ action: 'buy', tier: 'BADT' });
ok('非法等级被拒', !r.data.ok);
r = await post({ action: 'order', outTradeNo: 'not-exist-123' });
ok('不存在的订单被拒', !r.data.ok);

console.log('\n【10】mock 收银台页面');
const page = await get('/mock-pay?no=' + NO + '&amount=99900&title=测试');
ok('返回 HTML', page.status === 200 && page.text.includes('模拟收银台'));
ok('含金额', page.text.includes('999.00'));

console.log('\n' + (fail === 0 ? '✅' : '❌') + '  ' + pass + ' 通过 · ' + fail + ' 失败\n');
process.exit(fail === 0 ? 0 : 1);
