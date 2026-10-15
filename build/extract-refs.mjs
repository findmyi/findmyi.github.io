/**
 * 扫描 F:\2026-08-05-原生家庭\历史综合书籍 全书库
 * 生成 build/refs.mjs（分层：易学典籍 / 易学注疏 / 历史人物 / 其他）
 */
import { readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'F:\\2026-08-05-原生家庭\\历史综合书籍';

const books = [];
const corpora = [];

function walk(dir, rel = '') {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (e.name === '__pycache__') continue;
      walk(full, r);
    } else {
      const ext = (e.name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
      let size = 0;
      try { size = statSync(full).size; } catch {}
      if (['epub', 'pdf', 'djvu', 'mobi', 'azw3'].includes(ext)) {
        books.push({ path: r, name: e.name, ext, size });
      } else if (['txt', 'json', 'jsonl', 'md'].includes(ext)) {
        corpora.push({ path: r, ext, size, dir: rel });
      }
    }
  }
}
walk(ROOT);

/* ---------- 书籍解析 ---------- */
/** 已知作者名单（用于从脏文件名中精确提取） */
const KNOWN_AUTHORS = [
  '王弼', '楼宇烈', '南怀瑾', '徐芹庭', '王云五', '周振甫', '韩鹏杰', '梁冬',
  '章伟文', '李鼎祚', '孔颖达', '程颐', '朱熹', '苏轼', '杨万里', '京房', '郑玄',
  '于豪亮', '孙武', '张景', '张松辉', '陈桐生', '石磊', '冯军旗', '冯客',
  '渤海小吏', '当年明月', '阎崇年', '高天流云', '李强', '江城', '华杉',
  '罗伯特·格林', '尼尔·史特劳斯', '苏珊·福沃德', '玛丽亚·康妮科娃',
  '詹姆斯·c.斯科特', '格尔哈特·伦斯基', '梁宁', '李笑来', '安东尼·普拉卡尼斯',
  'Apollo', 'Gabriel', 'Kevin Hart', 'Neil Strauss',
];

function cleanTitle(raw) {
  let t = raw.replace(/\.(epub|pdf|djvu|mobi|azw3)$/i, '');
  // 去掉 z-library 等来源尾注（连同其外层括号）
  t = t.replace(/\s*\((?:z-library|1lib|z-lib|zlib)[\s\S]*$/i, '');
  // 去掉 ` ( 作者... )` 这类长括号（含逗号、年份、数字的）
  t = t.replace(/\s*\([^()]*(?:,\s*[^()]*){1,}\)\s*/g, ' ');
  // 去掉纯英文/数字的括号尾注
  t = t.replace(/\s*\([A-Za-z0-9 ,.·\-]+\)\s*$/g, '');
  t = t.replace(/\s{2,}/g, ' ').trim();
  t = t.replace(/[\s,，、]+$/, '');
  return t;
}

function pickAuthor(raw) {
  for (const a of KNOWN_AUTHORS) {
    if (raw.includes(a)) return a;
  }
  // 回退：取结尾括号里较短的片段
  const paren = raw.match(/\(([^()]{2,30})\)/g) || [];
  for (let i = paren.length - 1; i >= 0; i--) {
    const t = paren[i].slice(1, -1).trim();
    if (/z-library|1lib|z-lib/i.test(t)) continue;
    if (/^\d+$/.test(t)) continue;
    return t;
  }
  return '（佚名）';
}

function parseBook(b) {
  return {
    title: cleanTitle(b.name),
    author: pickAuthor(b.name),
    format: b.ext,
    path: b.path,
    size: b.size,
  };
}

/* ---------- 分类 ---------- */
const YIJING_STEM = /周易|易经|易学|易傳|易传|八卦|卦|王弼|周易正義|周易正义|誠齋易傳|東坡易傳|伊川易傳|周易本義|周易玩辭|易學啟蒙|周易述|易經通注|御纂周易/;

function classify(rel, title) {
  if (rel.startsWith('_周易库')) return 'yijing';
  if (rel.startsWith('_易学库')) return 'yishu';
  if (rel.startsWith('_春秋库')) return 'chunqiu';
  if (rel.startsWith('_史料库')) return 'shiliao';
  if (YIJING_STEM.test(title)) return 'yijing';
  return 'history';
}

const CATS = {
  yijing:  { no: 1, name: '《周易》原典与今译', sub: '通行本原文、白话译注与解卦方法' },
  yishu:   { no: 2, name: '历代易学注疏', sub: '汉魏至清的易学大家注本（四库全书本等）' },
  chunqiu: { no: 3, name: '春秋占例', sub: '《左传》《国语》中的真实占筮记录' },
  shiliao: { no: 4, name: '历代史料', sub: '按朝代整理的正史与编年史料' },
  history: { no: 5, name: '历史与人物', sub: '断代史、人物评传与史论' },
};

const items = books.map((b) => {
  const p = parseBook(b);
  return { ...p, cat: classify(b.path, p.title) };
});

// 去重（同名同格式）
const seen = new Set();
const uniq = items.filter((b) => {
  const k = b.title + '|' + b.format;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

const order = ['yijing', 'yishu', 'chunqiu', 'shiliao', 'history'];
uniq.sort((a, b) => {
  const d = order.indexOf(a.cat) - order.indexOf(b.cat);
  return d !== 0 ? d : a.title.localeCompare(b.title, 'zh');
});

/* ---------- 语料统计（易学库/春秋库/史料库的分卷文本） ---------- */
const byDir = {};
for (const c of corpora) {
  const key = c.dir || '(根)';
  if (!byDir[key]) byDir[key] = { files: 0, bytes: 0 };
  byDir[key].files++;
  byDir[key].bytes += c.size;
}

/* ---------- 从语料库识别「典籍级」条目 ----------
 * _易学库 与 _史料库 里是分卷 .txt，本身没有电子书文件，
 * 但它们是最有价值的注疏与正史，必须单独成条目。
 */
const canonBooks = [];
for (const [dir, v] of Object.entries(byDir)) {
  if (!dir.startsWith('_易学库') && !dir.startsWith('_史料库') && !dir.startsWith('_春秋库')) continue;

  // 取最内层带书名的目录：去掉 卷NN.txt / 全覽.txt / 总目.txt 之类的散文件
  const segs = dir.split('/');
  const bookSeg = segs.slice(1).filter((s) => !/^(卷|圖|图|全覽|全览|总目|凡例)/.test(s)).pop();
  if (!bookSeg) continue;

  let cat = 'yishu';
  if (dir.startsWith('_史料库')) cat = 'shiliao';
  if (dir.startsWith('_春秋库')) cat = 'chunqiu';

  // 朝代标注
  const dynasty = segs[1] && /^\d{2}_/.test(segs[1]) ? segs[1].replace(/^\d{2}_/, '') : '';

  const exist = canonBooks.find((b) => b.title === bookSeg && b.cat === cat);
  if (exist) {
    exist.volumes += v.files;
  } else {
    canonBooks.push({
      title: bookSeg + (dynasty ? `（${dynasty}）` : ''),
      author: dynasty || '历代',
      format: '分卷文本',
      cat,
      size: v.bytes,
      volumes: v.files,
    });
  }
}

// 合并：电子书 + 典藏分卷
const allItems = [...uniq, ...canonBooks];
allItems.sort((a, b) => {
  const d = order.indexOf(a.cat) - order.indexOf(b.cat);
  if (d !== 0) return d;
  return (b.volumes || 0) - (a.volumes || 0) || a.title.localeCompare(b.title, 'zh');
});

/* ---------- 输出 ---------- */
const out = `/**
 * 参考书目（自动生成 · 勿手改）
 * 源：F:\\2026-08-05-原生家庭\\历史综合书籍
 * 生成：node build/extract-refs.mjs
 */

export const REF_CATS = ${JSON.stringify(CATS, null, 2)};

export const REFS = ${JSON.stringify(allItems.map((b) => ({
  title: b.title,
  author: b.author,
  format: b.format,
  cat: b.cat,
  size: b.size,
  volumes: b.volumes || 0,
})), null, 2)};

/** 语料库规模（分卷文本总量） */
export const CORPUS_TOTAL = ${corpora.length};

export const CORPORA = ${JSON.stringify(
  Object.entries(byDir)
    .map(([dir, v]) => ({ dir, files: v.files, kb: Math.round(v.bytes / 1024) }))
    .sort((a, b) => b.files - a.files)
    .slice(0, 24),
  null, 2
)};
`;

writeFileSync(join(import.meta.dirname, 'refs.mjs'), out, 'utf8');

console.log(`✅ 扫描完成`);
console.log(`   电子书 ${uniq.length} 本 + 典藏分卷 ${canonBooks.length} 部 = ${allItems.length} 条`);
console.log(`   分卷语料 ${corpora.length} 个文本`);
console.log('');
const cnt = {};
for (const b of allItems) cnt[b.cat] = (cnt[b.cat] || 0) + 1;
for (const k of order) if (cnt[k]) console.log(`   ${CATS[k].name.padEnd(22)} ${cnt[k]} 条`);
console.log('');
console.log('   易学注疏明细:');
canonBooks.filter(b=>b.cat==='yishu').slice(0,12)
  .forEach(b=>console.log(`     ${b.title.padEnd(36)} ${b.volumes} 卷`));

