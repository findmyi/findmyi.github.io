/**
 * 截图脚本：滚动到付费卡并截图（供验证付费墙渲染）
 * 用法：node build/_shot-paywall.mjs [文章id]
 *
 * 为什么需要它：付费卡在正文之后，`--screenshot` 只截首屏。
 * 这里用 Chrome DevTools Protocol 先滚动到 #paywall，再截图。
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ID = process.argv[2] || 'qian';
const URL = `http://127.0.0.1:8848/#/p/${ID}`;
const OUT = `D:\\zhouyi-site\\build\\shots\\paywall-${ID}.png`;
const PORT = 9222;

mkdirSync('D:\\zhouyi-site\\build\\shots', { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=D:\\zhouyi-site\\build\\.chrome-profile',
  '--window-size=1400,1500',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 简单 JSON HTTP 请求 */
async function getJSON(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
  return res.json();
}

async function main() {
  // 等 CDP 就绪
  let target = null;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await getJSON('/json/list');
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Chrome CDP 未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1400, height: 1500, deviceScaleFactor: 1, mobile: false,
  });

  await send('Page.navigate', { url: URL });
  await sleep(2500);   // 等 manifest + 正文 + 付费卡渲染

  // 报告状态，便于断言
  const probe = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      hasPaywall: !!document.querySelector('.paywall'),
      hasForm: !!document.querySelector('#pwForm'),
      hasPrice: !!document.querySelector('.pw-price'),
      buyButtons: document.querySelectorAll('.pw-buy-btn').length,
      includes: document.querySelectorAll('.pw-list li').length,
      hasSample: !!document.querySelector('.pw-sample'),
      hasTrust: !!document.querySelector('.pw-trust'),
      hasDisclaimer: !!document.querySelector('.pw-disclaimer'),
      hasTeaser: !!document.querySelector('.pw-teaser'),
      unlockedBar: !!document.querySelector('.pw-unlocked-bar'),
    })`,
    returnByValue: true,
  });
  console.log('付费卡探针:', probe.result.value);

  // 滚到付费卡
  const scroll = await send('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector('.paywall');
      if (!el) return 'no-paywall';
      const y = el.getBoundingClientRect().top + window.scrollY - 40;
      window.scrollTo(0, y);
      return String(Math.round(y));
    })()`,
    returnByValue: true,
  });
  console.log('滚动位置:', scroll.result.value);
  await sleep(900);

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('✅ 截图已保存:', OUT);

  ws.close();
  chrome.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error('❌', e.message);
  try { chrome.kill(); } catch {}
  process.exit(1);
});
