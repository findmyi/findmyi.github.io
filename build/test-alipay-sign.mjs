/* ==========================================================================
   支付宝当面付：签名与验签的本地验证
   --------------------------------------------------------------------------
   不连支付宝，用自生成的 RSA 密钥验证：
     1. signContent 排序规则对不对
     2. 签名能被验签通过
     3. 篡改参数后验签必须失败（防伪造回调）
     4. PEM 头尾会被正确剥离

   跑法：node build/test-alipay-sign.mjs
   ========================================================================== */

import { webcrypto } from 'node:crypto';

// Node 22 已内置 globalThis.crypto（只读），直接用；老版本才需要补
if (!globalThis.crypto) globalThis.crypto = webcrypto;

let pass = 0, fail = 0;
function ok(label, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}

/* ---- 复制 worker/pay.js 里的同款实现（保持行为一致） ---- */
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
function signContent(params) {
  return Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type' && params[k] !== '' && params[k] != null)
    .sort()
    .map((k) => k + '=' + params[k])
    .join('&');
}
async function importPrivateKey(pem) {
  return crypto.subtle.importKey('pkcs8', b64ToBytes(stripPem(pem)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}
async function importPublicKey(pem) {
  return crypto.subtle.importKey('spki', b64ToBytes(stripPem(pem)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

/* ---- 生成测试密钥对 ---- */
const kp = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']);
const privDer = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
const pubDer = await crypto.subtle.exportKey('spki', kp.publicKey);

// 模拟支付宝工具导出的 PEM（带换行与头尾）
const privPem = '-----BEGIN PRIVATE KEY-----\n' +
  bytesToB64(privDer).match(/.{1,64}/g).join('\n') + '\n-----END PRIVATE KEY-----';
const pubPem = '-----BEGIN PUBLIC KEY-----\n' +
  bytesToB64(pubDer).match(/.{1,64}/g).join('\n') + '\n-----END PUBLIC KEY-----';

console.log('\n【1】PEM 处理');
ok('私钥 PEM 能被导入', !!(await importPrivateKey(privPem)));
ok('公钥 PEM 能被导入', !!(await importPublicKey(pubPem)));
ok('stripPem 去掉了头尾', !stripPem(privPem).includes('BEGIN'));
ok('stripPem 去掉了换行', !stripPem(privPem).includes('\n'));

console.log('\n【2】签名串排序规则');
const p = {
  app_id: '2021000000000000',
  method: 'alipay.trade.precreate',
  charset: 'utf-8',
  sign_type: 'RSA2',
  timestamp: '2026-10-19 16:00:00',
  version: '1.0',
  biz_content: '{"out_trade_no":"ZY123"}',
  notify_url: 'https://example.com/notify',
};
const c = signContent(p);
ok('sign / sign_type 被排除', !/\bsign(_type)?=/.test(c));
ok('按 key 升序（app_id 在最前）', c.startsWith('app_id='));
ok('biz_content 排在 charset 之前（字母序 b < c）', c.indexOf('biz_content') < c.indexOf('charset'));
ok('用 & 连接', (c.match(/&/g) || []).length === Object.keys(p).length - 2);

console.log('\n【3】签名与验签');
const data = new TextEncoder().encode(c);
const key = await importPrivateKey(privPem);
const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, data);
const sigB64 = bytesToB64(sig);
ok('签名为 base64', /^[A-Za-z0-9+/=]+$/.test(sigB64));
ok('签名长度合理（2048 位 → 344 字符左右）', sigB64.length > 300 && sigB64.length < 400, sigB64.length);

const pub = await importPublicKey(pubPem);
ok('原始签名验签通过', await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pub, sig, data));

console.log('\n【4】★ 篡改必须验签失败（防伪造回调）');
const tampered = new TextEncoder().encode(c.replace('ZY123', 'ZY999'));
ok('改了订单号 → 验签失败', !(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pub, sig, tampered)));

const tampered2 = new TextEncoder().encode(c + '&extra=1');
ok('加了参数 → 验签失败', !(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pub, sig, tampered2)));

// 用另一对密钥的签名去验
const kp2 = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']);
const fakeSig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp2.privateKey, data);
ok('别人签的名 → 验签失败', !(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pub, fakeSig, data)));

console.log('\n【5】回调参数解析');
const notifyBody = 'gmt_create=2026-10-19+15%3A55%3A00&charset=utf-8&out_trade_no=ZYABC123'
  + '&trade_status=TRADE_SUCCESS&total_amount=999.00&trade_no=2026101922001&sign=xxx&sign_type=RSA2';
const parsed = Object.fromEntries(new URLSearchParams(notifyBody));
ok('能解析出 out_trade_no', parsed.out_trade_no === 'ZYABC123');
ok('能解析出 trade_status', parsed.trade_status === 'TRADE_SUCCESS');
ok('total_amount 转分正确', Math.round(Number(parsed.total_amount) * 100) === 99900);

console.log('\n' + (fail === 0 ? '✅' : '❌') + '  ' + pass + ' 通过 · ' + fail + ' 失败\n');
process.exit(fail === 0 ? 0 : 1);
