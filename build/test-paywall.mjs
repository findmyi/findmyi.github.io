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
  ok('乾 = premium', byId.qian.tier === 'premium');
  ok('坤 = premium', byId.kun.tier === 'premium');
  ok('未济 = premium（PREM 专属示例）', byId.weiji.tier === 'premium');
  ok('付费文章共 3 篇',
    manifest.articles.filter((a) => a.tier === 'premium').length === 3,
    String(manifest.articles.filter((a) => a.tier === 'premium').length));
  ok('其余 61 卦 = free',
    manifest.articles.filter((a) => a.tier === 'free').length === 61);
  ok('每篇都有 tier 字段', manifest.articles.every((a) => a.tier));
  ok('meta.premium.enabled = true', manifest.meta.premium.enabled === true);
  ok('meta.premium.ids 含乾坤未济', manifest.meta.premium.ids.join() === 'qian,kun,weiji');
  ok('付费卡带 includes', (manifest.meta.premium.cards.qian.includes || []).length >= 3);
  ok('付费卡带 sample', !!manifest.meta.premium.cards.qian.sample);
  ok('三篇都有 includes 与 sample',
    manifest.meta.premium.ids.every((id) => {
      const c = manifest.meta.premium.cards[id];
      return c && c.includes.length && c.sample && c.sample.quote && c.sample.body;
    }));
  ok('每篇付费卡的 tier 都是合法等级',
    manifest.meta.premium.ids.every((id) => License.TIERS[manifest.meta.premium.cards[id].tier]));
}

console.log('\n【5】安全保证：付费正文不在静态产物中（核心）');
{
  const qianHtml = readFileSync(ROOT + 'articles/qian.html', 'utf8');
  const kunHtml = readFileSync(ROOT + 'articles/kun.html', 'utf8');
  const weijiHtml = readFileSync(ROOT + 'articles/weiji.html', 'utf8');
  const search = readFileSync(ROOT + 'data/search.json', 'utf8');
  const allStatic = qianHtml + kunHtml + weijiHtml + search + JSON.stringify(manifest);

  // depth 里的独特句子 —— 若出现在静态文件里就是泄漏。
  // 注意：必须选【只存在于 depth、不存在于 teaser】的短语，
  // 否则会把公开的 teaser 误判成泄漏。
  const leaks = [
    ['乾 · 三家分晋', '三家分晋'],
    ['乾 · 用九结论', '不要有首领'],
    ['乾 · 自测法', '你在初九'],
    ['坤 · 黄裳解读', '居高位而不显'],
    ['坤 · 用六解读', '长久地守正'],
  ];
  for (const [label, needle] of leaks) {
    ok(`articles/qian.html 不含「${label}」`, !qianHtml.includes(needle));
    ok(`data/search.json 不含「${label}」`, !search.includes(needle));
  }
  ok('articles/qian.html 含 teaser 标记', qianHtml.includes('data-premium="qian"'));
  ok('articles/qian.html 含 teaser 文本', qianHtml.includes('一条完整的时间轴'));
  ok('坤只发布 teaser', kunHtml.includes('data-premium="kun"'));
  ok('坤 teaser 有意公开（不是泄漏）', kunHtml.includes('不可替代性'));

  // manifest 本身也不能带 depth。
  // 注意：includes（交付物清单）里出现「三家分晋」是【有意的】——
  // 它是对读者的承诺描述，不是正文。所以这里只检查 depth 的完整句子。
  const depthSentences = [
    '智伯瑶的失败是一个标准的「亢龙」样本',
    '黄是中色，裳是下衣',
  ];
  for (const s of depthSentences) {
    ok(`manifest 不含 depth 句子「${s.slice(0, 12)}…」`, !JSON.stringify(manifest).includes(s));
  }
  ok('交付物清单可以提及史例（有意公开）',
    JSON.stringify(manifest).includes('三家分晋'));

  // 直接对照源文件：depth 文本不得出现在任何静态产物中。
  // 例外：sample（付费卡样例）与 teaser（引子）是【有意公开】的，
  // 若某句同时出现在 depth 和 sample/teaser 里，它公开是正常的 —— 跳过。
  const premium = await import('file:///D:/zhouyi-site/content/premium-content.mjs');
  let worstLeak = null;
  let scanned = 0;
  for (const [id, p] of Object.entries(premium.PREMIUM)) {
    const publicText = (p.teaser || '') + (p.sample ? p.sample.quote + p.sample.body + p.sample.fade : '');
    for (const chunk of p.depth
      .replace(/<[^>]+>/g, '')
      .split(/[。；\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 18)) {
      if (publicText.includes(chunk)) continue;   // 有意公开，不算泄漏
      scanned++;
      if (allStatic.includes(chunk)) {
        worstLeak = `${id}: ${chunk.slice(0, 40)}`;
        break;
      }
    }
    if (worstLeak) break;
  }
  ok(`全量扫描：depth 独有的 ${scanned} 个句子均不在静态产物中`, !worstLeak, worstLeak || '');
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
  ok('正式 manifest：未授权时乾被锁', !E3.isUnlocked('qian'));
  ok('正式 manifest：未授权时免费卦正常', E3.isUnlocked('zhun'));

  store = ['PREM'];
  ok('正式 manifest：PREM 授权后乾解锁', E3.isUnlocked('qian'));
  ok('正式 manifest：PREM 授权后免费卦不受影响', E3.isUnlocked('zhun'));

  store = ['QK00'];
  ok('正式 manifest：QK00 码开乾坤', E3.isUnlocked('kun'));
  ok('正式 manifest：QK00 码不含未济（PREM 专属）', !E3.isUnlocked('weiji'));
  ok('正式 manifest：免费卦在 QK00 下依然可读', E3.isUnlocked('zhun'));

  store = ['PREM'];
  ok('正式 manifest：PREM 覆盖 QK00 的全部范围', E3.isUnlocked('weiji') && E3.isUnlocked('qian'));

  store = [];
  ok('清除授权后重新上锁', !E3.isUnlocked('qian'));
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} 通过 · ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
