/**
 * 端到端验证：授权码解锁流程（真实浏览器）
 * 用法：node build/_verify-unlock.mjs
 *
 * 验证：
 *   1. 未授权 → 付费卡出现，正文不含付费内容
 *   2. 输入错误的码 → 报错，仍锁着
 *   3. 输入正确的 PREM 码 → 解锁条出现，付费卡消失
 *   4. 刷新后仍保持解锁（localStorage 生效）
 *   5. 输入 QK00 码 → 乾坤开，未济仍锁
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9223;
mkdirSync('D:\\zhouyi-site\\build\\shots', { recursive: true });

// 自备两份密钥：不依赖上一次生成的 keys.csv（否则会串档位）。
// 算法必须与 assets/license.js 完全一致 —— 直接复用其实现，避免手抄出错。
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const License = require('D:\\zhouyi-site\\assets\\license.js');

function makeKey(tier, a, b) {
  const body = `ZY-${tier}-${a}-${b}`;
  return `${body}-${License.checksum(body)}`;
}

const PREM_KEY = makeKey('PREM', 'TEST', 'PREM');
const QK_KEY = makeKey('QK00', 'TEST', 'QKAY');

// 自检：确保生成的码真能通过校验，否则测试本身无意义
for (const [name, k] of [['PREM', PREM_KEY], ['QK00', QK_KEY]]) {
  const r = License.validate(k);
  if (!r.ok) {
    console.error(`\n❌ 测试自身出错：${name} 码 ${k} 未通过 License.validate —— ${r.reason}`);
    console.error('   请检查 build/_verify-unlock.mjs 的密钥生成是否与 assets/license.js 同步。\n');
    process.exit(1);
  }
}

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=D:\\zhouyi-site\\build\\.chrome-verify',
  '--window-size=1400,1500',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  → ' + extra : ''}`); }
};

async function main() {
  let target = null;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch {}
    await sleep(250);
  }
  if (!target) throw new Error('Chrome CDP 未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1400, height: 1500, deviceScaleFactor: 1, mobile: false,
  });

  /** 在页面里求值 */
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr.slice(0, 60));
    return r.result.value;
  };

  const goto = async (hash) => {
    await send('Page.navigate', { url: 'http://127.0.0.1:8848/' + hash });
    await sleep(2200);
  };

  const state = () => evaluate(`JSON.stringify({
    locked: !!document.querySelector('.paywall'),
    unlocked: !!document.querySelector('.pw-unlocked-bar'),
    msg: (document.querySelector('#pwMsg')||{}).textContent || '',
    label: (document.querySelector('.pw-unlocked-bar span:nth-child(2)')||{}).textContent || '',
  })`);

  /* ---------- 清空 localStorage，从干净状态开始 ---------- */
  await goto('#/');
  await evaluate(`localStorage.clear(); 'cleared'`);

  console.log('\n【1】未授权：乾卦应被锁');
  await goto('#/p/qian');
  let s = JSON.parse(await state());
  ok('付费卡出现', s.locked);
  ok('未出现解锁条', !s.unlocked);
  ok('正文里没有 teaser 残留（已替换为付费卡）',
    !(await evaluate(`!!document.querySelector('.pw-teaser')`)));
  ok('Entitlement 全局可用', await evaluate(`typeof window.Entitlement === 'object'`));
  ok('免费卦（屯）不受影响', await evaluate(
    `(async()=>{location.hash='#/p/zhun';await new Promise(r=>setTimeout(r,1600));
      return !document.querySelector('.paywall') && !document.querySelector('.pw-unlocked-bar');})()`));

  console.log('\n【2】输入错误的授权码');
  await goto('#/p/qian');
  await evaluate(`(()=>{
    location.hash='#/p/qian';
    return true;
  })()`);
  await sleep(1600);
  await evaluate(`(()=>{
    const i=document.querySelector('#pwInput');
    i.value='ZY-PREM-2222-3333-2';
    i.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#pwForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    return true;
  })()`);
  await sleep(600);
  s = JSON.parse(await state());
  ok('仍处于锁定状态', s.locked);
  ok('显示了错误提示', s.msg.length > 0, s.msg);
  ok('提示内容提到校验位', s.msg.includes('校验位') || s.msg.includes('格式'), s.msg);

  console.log('\n【3】输入正确的 PREM 授权码');
  await evaluate(`(()=>{
    const i=document.querySelector('#pwInput');
    i.value='${PREM_KEY}';
    i.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#pwForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    return true;
  })()`);
  await sleep(2200);
  s = JSON.parse(await state());
  console.log(`     （使用授权码 ${PREM_KEY}）`);
  ok('解锁条出现', s.unlocked);
  ok('付费卡消失', !s.locked);
  ok('显示授权等级', s.label.includes('全站通行'), s.label);
  ok('localStorage 已写入', await evaluate(
    `(JSON.parse(localStorage.getItem('zhouyi.licenses')||'[]')).length === 1`));

  console.log('\n【4】刷新后保持解锁');
  await goto('#/p/qian');
  s = JSON.parse(await state());
  ok('刷新后仍解锁', s.unlocked && !s.locked);

  console.log('\n【5】PREM 解锁未济');
  await goto('#/p/weiji');
  s = JSON.parse(await state());
  ok('未济已解锁', s.unlocked && !s.locked);

  console.log('\n【6】清除授权后重新上锁');
  await evaluate(`document.querySelector('#pwReset').click(); true`);
  await sleep(1800);
  s = JSON.parse(await state());
  ok('重新上锁', s.locked && !s.unlocked);
  ok('localStorage 已清空', await evaluate(
    `(JSON.parse(localStorage.getItem('zhouyi.licenses')||'[]')).length === 0`));

  console.log('\n【7】QK00 码：乾坤开、未济锁');
  await goto('#/p/kun');
  await evaluate(`(()=>{
    const i=document.querySelector('#pwInput');
    i.value='${QK_KEY}';
    i.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#pwForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    return true;
  })()`);
  await sleep(2200);
  s = JSON.parse(await state());
  console.log(`     （使用授权码 ${QK_KEY}）`);
  ok('坤已解锁', s.unlocked, s.msg);
  ok('等级显示为乾坤专享', s.label.includes('乾坤专享'), s.label);

  await goto('#/p/weiji');
  s = JSON.parse(await state());
  ok('未济仍被锁（QK00 不含）', s.locked);

  console.log('\n【8】视觉：已解锁状态截图');
  await goto('#/p/qian');
  await evaluate(`(()=>{const e=document.querySelector('.pw-unlocked-bar');
    if(e) window.scrollTo(0, e.getBoundingClientRect().top+window.scrollY-260); return true;})()`);
  await sleep(700);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('D:\\zhouyi-site\\build\\shots\\paywall-unlocked.png',
    Buffer.from(shot.data, 'base64'));
  console.log('   已保存 build/shots/paywall-unlocked.png');

  console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} 通过 · ${fail} 失败\n`);
  ws.close(); chrome.kill();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('❌', e.message);
  try { chrome.kill(); } catch {}
  process.exit(1);
});
