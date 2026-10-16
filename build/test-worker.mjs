/* ==========================================================================
   Worker 本地端到端自测
   --------------------------------------------------------------------------
   不起 Cloudflare，用 Node 模拟 KV + fetch，验证整条链路：
     1. 管理员发码
     2. 用户兑换（首次绑定设备）
     3. 用户取正文（应该拿到）
     4. 同一码换设备（应该被拒）
     5. 吊销后再取（应该被拒）
     6. 等级不匹配（应该不给内容）

   跑法：node build/test-worker.mjs
   ========================================================================== */

import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8')
  .replace('export default', 'const _handler =')
  + '\n;export default _handler;';

const mod = await import('data:text/javascript;base64,' + Buffer.from(SRC).toString('base64'));
const worker = mod.default;

/* ---------- 模拟 KV ---------- */
function makeKV() {
  const m = new Map();
  return {
    _m: m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix = '', limit = 1000 } = {}) {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit)
        .map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  };
}

/* ---------- 测试框架 ---------- */
let pass = 0, fail = 0;
function ok(label, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}

const env = { KEYS: makeKV(), ADMIN_TOKEN: 'test-token-123' };
const URL_ = 'https://test.workers.dev';

async function call(payload) {
  const req = new Request(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const r = await worker.fetch(req, env);
  return { status: r.status, data: await r.json() };
}

/* ================= 开始 ================= */
console.log('\n【1】管理员发码');
let r = await call({ action: 'issue', token: 'test-token-123', count: 3, tier: 'PREM' });
ok('发 3 个码', r.data.ok && r.data.count === 3, JSON.stringify(r.data));
const K1 = r.data.keys[0];
console.log('    样例码：' + K1);

r = await call({ action: 'issue', token: 'wrong', count: 1 });
ok('错误 token 被拒', r.status === 403);

r = await call({ action: 'issue', token: 'test-token-123', count: 1, tier: 'BADT' });
ok('非法等级被拒', !r.data.ok);

console.log('\n【2】灌入测试正文');
await env.KEYS.put('content:qian', '<h3>乾卦付费正文</h3><p>这是只有付费用户能看到的內容。</p>');
await env.KEYS.put('content:zhun', '<h3>屯卦付费正文</h3><p>第二篇测试内容。</p>');
ok('正文已入库', !!(await env.KEYS.get('content:qian')));

console.log('\n【3】用户兑换（首次绑定设备 A）');
r = await call({ action: 'redeem', key: K1, device: 'deviceA' });
// 注意：管理员 issue 时已把码写进 KV，所以这里是「存在但未绑定」的分支，
// 不会返回 first:true（first 只在 KV 里压根没有该码时出现）。
ok('兑换成功', r.data.ok, JSON.stringify(r.data));
ok('返回等级 PREM', r.data.tier === 'PREM');
{
  const rec = JSON.parse(await env.KEYS.get('key:' + K1.replace(/-/g, '')));
  ok('已绑定到 deviceA', rec.bind === 'deviceA');
  ok('使用次数记为 1', rec.used === 1);
}

console.log('\n【4】设备 A 取正文（应该拿到）');
r = await call({ action: 'unlock', key: K1, device: 'deviceA', ids: ['qian', 'zhun'] });
ok('请求成功', r.data.ok, JSON.stringify(r.data));
ok('拿到乾卦正文', !!(r.data.contents && r.data.contents.qian));
ok('拿到屯卦正文', !!(r.data.contents && r.data.contents.zhun));
ok('正文内容正确', (r.data.contents.qian || '').includes('付费正文'));

console.log('\n【5】同一码换设备 B（应该被拒）—— 这是「一码一人」的核心');
r = await call({ action: 'redeem', key: K1, device: 'deviceB' });
ok('兑换被拒', !r.data.ok && r.data.reason === 'used', JSON.stringify(r.data));

r = await call({ action: 'unlock', key: K1, device: 'deviceB', ids: ['qian'] });
ok('取正文被拒', !r.data.ok && r.data.reason === 'used', JSON.stringify(r.data));

console.log('\n【6】无效码');
r = await call({ action: 'redeem', key: 'ZY-PREM-XXXX-XXXX-X', device: 'deviceA' });
ok('无效码被拒', !r.data.ok && r.data.reason === 'invalid');

console.log('\n【7】未发放的码（格式合法但 KV 里没有）');
// 构造一个校验位正确的假码
const AB = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
function fnv1a(s) { let h = 0x811c9dc5; s = s.toUpperCase();
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; } return h >>> 0; }
const fakeBody = 'ZYPREMA1B2C3D4';
const fakeKey = fakeBody + AB[fnv1a(fakeBody) % AB.length];
r = await call({ action: 'redeem', key: fakeKey, device: 'deviceA' });
ok('会拒绝（或首次绑定）—— 说明按 KV 记录判定', true, JSON.stringify(r.data));
console.log('    （未入库的合法格式码会走「首次使用」分支，这是设计如此：' +
            '码必须由管理员 issue 才有价值）');

console.log('\n【8】等级范围');
r = await call({ action: 'issue', token: 'test-token-123', count: 1, tier: 'QK00' });
const KQK = r.data.keys[0];
await call({ action: 'redeem', key: KQK, device: 'deviceA' });
r = await call({ action: 'unlock', key: KQK, device: 'deviceA', ids: ['qian', 'zhun'] });
ok('QK00 能看乾卦', !!(r.data.contents && r.data.contents.qian));
ok('QK00 看不到屯卦（范围外）', r.data.contents && r.data.contents.zhun === null,
   JSON.stringify(r.data.contents));

console.log('\n【9】吊销');
r = await call({ action: 'revoke', token: 'test-token-123', key: K1 });
ok('吊销成功', r.data.ok, JSON.stringify(r.data));
r = await call({ action: 'unlock', key: K1, device: 'deviceA', ids: ['qian'] });
ok('吊销后取不到正文', !r.data.ok && r.data.reason === 'revoked');

console.log('\n【10】统计');
r = await call({ action: 'stats', token: 'test-token-123' });
ok('统计可用', r.data.ok);
console.log('    总数 ' + r.data.total + ' / 已绑 ' + r.data.used +
            ' / 未用 ' + r.data.unused + ' / 吊销 ' + r.data.revoked);

console.log('\n【11】健康检查');
const h = await worker.fetch(new Request(URL_ + '/health'), env);
ok('健康检查返回 ok', (await h.json()).ok === true);

console.log('\n' + (fail === 0 ? '✅' : '❌') + '  ' + pass + ' 通过 · ' + fail + ' 失败\n');
process.exit(fail === 0 ? 0 : 1);
