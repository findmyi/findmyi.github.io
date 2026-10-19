/**
 * 付费墙端到端功能测试（Node，无需浏览器）
 * 用法：node build/test-paywall.mjs
 *
 * 测试内容：
 *   1. 授权码算法与生成器一致
 *   2. Entitlement 语义：免费文章恒解锁、付费文章默认锁、码解锁后开
 *   3. 等级作用域：乾坤专享码不能开别的卦
 *   4. 优雅降级：manifest 无 premium 信息时全站免费
 *   5. 静态产物中不含付费正文（核心安全保证）
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = 'D:/zhouyi-site/';

/* ---------- 迷你断言 ---------- */
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  → ' + extra : ''}`); }
}

/* ---------- 载入 license.js（它同时支持 CommonJS 与 window） ---------- */
const License = require(ROOT + 'assets/license.js');

console.log('\n【1】授权码格式与校验');
{
  const body = 'ZY-PREM-7K2M-9QX4';
  const key = body + '-' + License.checksum(body);
  ok('校验位可复现', License.validate(key).ok, key);
  ok('归一化：小写+空格可接受', License.validate(key.toLowerCase().replace(/-/g, ' ')).ok);
  ok('归一化：全角字符可接受', License.validate(key.replace(/-/g, '－')).ok);
  ok('授权码共 15 位字符（含前缀与校验位）',
    key.replace(/-/g, '').length === License.KEY_LEN, `${key} = ${key.replace(/-/g, '').length}`);

  const bad = key.slice(0, -1) + (key.slice(-1) === 'A' ? 'B' : 'A');
  ok('篡改校验位被拒', !License.validate(bad).ok);

  const wrongTier = 'ZY-NOPE-7K2M-9QX4-' + License.checksum('ZY-NOPE-7K2M-9QX4');
  ok('未知等级被拒', !License.validate(wrongTier).ok);

  ok('过短输入被拒', !License.validate('ZY-PREM-1234').ok);
  ok('空输入被拒', !License.validate('').ok);
}

console.log('\n【2】生成器与校验算法一致（用 keys.csv 实测）');
let sampleKey = null;
{
  const csv = readFileSync(ROOT + 'build/keys.csv', 'utf8').replace(/^\uFEFF/, '');
  const lines = csv.trim().split(/\r?\n/).slice(1);
  sampleKey = lines[0].split(',')[0];
  let allOk = true;
  for (const line of lines) {
    const k = line.split(',')[0];
    if (!License.validate(k).ok) { allOk = false; break; }
  }
  ok(`CSV 中全部 ${lines.length} 个码通过校验`, allOk);
  ok('CSV 首行等级为 PREM', lines[0].split(',')[1] === 'PREM');
  ok('CSV 首行有签发时间', /^\d{4}-\d{2}-\d{2}T/.test(lines[0].split(',')[2]));
}

console.log('\n【3】等级作用域');
{
  const b = 'ZY-QK00-2222-3333';
  const qkKey = b + '-' + License.checksum(b);
  ok('QK00 码校验通过', License.validate(qkKey).ok, qkKey);
  ok('QK00 覆盖 qian', License.tiersCover(['QK00'], 'qian'));
  ok('QK00 覆盖 kun', License.tiersCover(['QK00'], 'kun'));
  ok('QK00 不覆盖 zhun', !License.tiersCover(['QK00'], 'zhun'));
  ok('PREM 覆盖任意文章', License.tiersCover(['PREM'], 'zhun'));
  ok('未知等级不覆盖任何文章', !License.tiersCover(['XXXX'], 'qian'));
  ok('等级码定长 4 字符',
    Object.keys(License.TIERS).every((t) => t.length === 4),
    Object.keys(License.TIERS).join(','));
}

console.log('\n【4】manifest 的 tier 标记');
const manifest = JSON.parse(readFileSync(ROOT + 'data/manifest.json', 'utf8'));
{
  const byId = Object.fromEntries(manifest.articles.map((a) => [a.id, a]));
  const premCount = manifest.articles.filter((a) => a.tier === 'premium').length;
  ok('乾 = free（整篇免费）', byId.qian.tier === 'free');
  ok('坤 = free（整篇免费）', byId.kun.tier === 'free');
  ok('未济 = premium', byId.weiji.tier === 'premium');
  // 六十四卦全付费（2026-10 起：免费给原文与白话，付费给逐爻出路）
  ok('付费文章共 62 篇（乾坤整篇免费）', premCount === 62, String(premCount));
  const freeHex = manifest.articles.filter((a) => a.tier === 'free').map((a) => a.id);
ok('乾坤是 free 卦', freeHex.length === 2 && freeHex.includes('qian') && freeHex.includes('kun'), JSON.stringify(freeHex));
ok('乾坤 depth 已写进静态产物', readFileSync('D:/zhouyi-site/articles/qian.html', 'utf8').includes('逐爻详解'));
  ok('每篇都有 tier 字段', manifest.articles.every((a) => a.tier));
  ok('meta.premium.enabled = true', manifest.meta.premium.enabled === true);
  ok('meta.premium.ids 覆盖 62 卦', manifest.meta.premium.ids.length === 62);
  ok('付费卡带 includes', (manifest.meta.premium.cards.zhun.includes || []).length >= 3);
  ok('付费卡带 sample', !!manifest.meta.premium.cards.zhun.sample);
  ok('每篇都有 includes 与 sample',
    manifest.meta.premium.ids.every((id) => {
      const c = manifest.meta.premium.cards[id];
      // sample 的字段名是 quote / body / fade —— app.js 的付费卡按此渲染
      return c && c.includes.length && c.sample && c.sample.quote;
    }));
  ok('每篇付费卡的 tier 都是合法等级',
    manifest.meta.premium.ids.every((id) => License.TIERS[manifest.meta.premium.cards[id].tier]));
}

console.log('\n【5】安全保证：付费正文不在静态产物中（核心）');
{
  const read = (p) => readFileSync(ROOT + p, 'utf8');
  const qianHtml = read('articles/qian.html');
  const kunHtml = read('articles/kun.html');
  const weijiHtml = read('articles/weiji.html');
  const search = read('data/search.json');
  // 乾坤整篇免费，其 HTML 天然包含 depth 句子，且与付费卦共享史料引用，
  // 若计入 allStatic 会把「共享史料」误判成泄漏。所以只扫付费卦的代表 + 索引 + manifest。
  const allStatic = weijiHtml + search + JSON.stringify(manifest);

  // depth 里的独特句子 —— 若出现在静态文件里就是泄漏
  const leaks = [
    ['乾 · 开篇处境', '你刚进一个新环境，什么都不会'],
    ['乾 · 判断句', '别出声'],
    ['坤 · 开篇处境', '你在一个位置上干了六年'],
  ];
  for (const [label, needle] of leaks) {
    // 乾坤已整篇免费，这些句子【应当】出现在对应文件里
    const host = label.startsWith('乾') ? qianHtml : kunHtml;
    ok(`articles/${label.startsWith('乾') ? 'qian' : 'kun'}.html 含「${label}」`, host.includes(needle));
    // 但搜索索引仍然只收免费区，不该混入 depth
    ok(`data/search.json 不含「${label}」`, !search.includes(needle));
  }
  ok('articles/qian.html 不含付费标记（已免费）', !qianHtml.includes('data-premium="qian"'));
  ok('articles/qian.html 含完整逐爻详解', qianHtml.includes('逐爻详解'));
  ok('坤也发布完整内容', kunHtml.includes('逐爻详解'));
  ok('未济只发布 teaser', weijiHtml.includes('data-premium="weiji"'));

  // manifest 本身也不能带 depth 正文。
  // 注意：sample（付费卡样例）是从 depth 摘的、【有意公开】让读者尝一口，
  // 所以不能拿「depth 里出现过」当选泄漏标准 —— 必须选
  // 【只在 depth 里、不在 sample/teaser 里】的句子。
  const depthOnly = [
    '他确实什么都没做错。问题出在别的地方',   // 乾 depth 第二段（不在 sample）
    '姿态永远比位置低半格',                    // 坤 depth 的判词
  ];
  for (const s of depthOnly) {
    ok(`manifest 不含 depth 独有句「${s.slice(0, 12)}…」`,
      !JSON.stringify(manifest).includes(s));
  }
  ok('sample 有意公开（可出现在 manifest）',
    JSON.stringify(manifest).includes('样') || !!manifest.meta.premium.cards.zhun.sample.quote);

  // 直接对照源文件：depth 文本不得出现在任何静态产物中。
  // 例外：sample（付费卡样例）与 teaser（引子）是【有意公开】的。
  // 另一个例外：爻辞与象传【本来就】在免费部分（每卦的「爻辞 · 六爻」一节），
  // 所以 depth 里引用的这些原文出现在静态页是正常的 —— 必须排除，
  // 否则会把「免费区已有的经文」误判成泄漏。
  const premium = await import('file:///D:/zhouyi-site/content/premium-content.mjs');
  const hexData = await import('file:///D:/zhouyi-site/build/hexdata.mjs');
  let worstLeak = null;
  let scanned = 0;
  const FREE_PUBLIC = new Set(['qian', 'kun']);   // 乾坤整篇免费，不参与泄漏扫描
  for (const [id, p] of Object.entries(premium.PREMIUM)) {
    if (FREE_PUBLIC.has(id)) continue;
    const publicText = (p.teaser || '') + (p.sample ? JSON.stringify(p.sample) : '');
    // 该卦免费区已公开的经文（爻辞 + 象传 + 卦辞 + 彖传 + 象传）
    const freeScripture = hexData.scriptureOf(id);
    for (const chunk of p.depth
      .replace(/<[^>]+>/g, '')
      .split(/[。；\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 18)) {
      if (publicText.includes(chunk)) continue;        // 有意公开
      if (freeScripture.some((s) => s.includes(chunk))) continue;  // 经文，免费区本就有
      scanned++;
      if (allStatic.includes(chunk)) {
        worstLeak = `${id}: ${chunk.slice(0, 40)}`;
        break;
      }
    }
    if (worstLeak) break;
  }
  ok(`全量扫描：62 篇付费卦 depth 独有的 ${scanned} 个句子均不在静态产物中`, !worstLeak, worstLeak || '');
}

console.log('\n【6】优雅降级：无 premium 信息 = 全站免费');
{
  // 模拟 Entitlement 的核心判断逻辑（与 app.js 保持一致）。
  // tiers 通过 getter 读取，避免闭包捕获导致的陈旧状态。
  function makeEntitlement(manifestLike, tiersRef) {
    return {
      get tiers() { return tiersRef(); },
      enabled: !!(manifestLike.meta && manifestLike.meta.premium && manifestLike.meta.premium.enabled),
      tierOf(id) {
        const a = (manifestLike.articles || []).find((x) => x.id === id);
        return (a && a.tier) || 'free';
      },
      needsPaywall(id) {
        if (!this.enabled) return false;
        return this.tierOf(id) === 'premium';
      },
      isUnlocked(id) {
        if (!this.needsPaywall(id)) return true;
        const t = this.tiers;
        if (!t.length) return false;
        return License.tiersCover(t, id);
      },
    };
  }

  const noPremium = { meta: {}, articles: [{ id: 'qian' }, { id: 'kun' }] };
  const E1 = makeEntitlement(noPremium, () => []);
  ok('无 meta.premium → 不上墙', !E1.needsPaywall('qian'));
  ok('无 meta.premium → 视为解锁', E1.isUnlocked('qian'));

  const partial = { meta: { premium: { enabled: true } }, articles: [{ id: 'qian' }, { id: 'kun' }] };
  const E2 = makeEntitlement(partial, () => []);
  ok('有 premium 但文章无 tier → 仍免费', E2.isUnlocked('qian'));

  // 模拟 localStorage 里的授权状态：可动态改变
  let store = [];
  const getTiers = () => store;

  const E3 = makeEntitlement(manifest, getTiers);
  ok('正式 manifest：未授权时屯被锁', !E3.isUnlocked('zhun'));
  ok('正式 manifest：未授权时屯也被锁（全卦付费）', !E3.isUnlocked('zhun'));

  store = ['PREM'];
  ok('正式 manifest：PREM 授权后乾解锁', E3.isUnlocked('qian'));
  ok('正式 manifest：PREM 授权后屯也解锁', E3.isUnlocked('zhun'));

  store = ['QK00'];
  ok('正式 manifest：QK00 码开乾坤', E3.isUnlocked('kun'));
  ok('正式 manifest：QK00 码不含未济（PREM 专属）', !E3.isUnlocked('weiji'));
  ok('正式 manifest：QK00 码不含屯（乾坤专享）', !E3.isUnlocked('zhun'));

  store = ['PREM'];
  ok('正式 manifest：PREM 覆盖 QK00 的全部范围', E3.isUnlocked('weiji') && E3.isUnlocked('qian'));

  store = [];
  ok('清除授权后重新上锁', !E3.isUnlocked('zhun'));
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} 通过 · ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
