import { readFileSync, readdirSync } from 'node:fs';

const css = readFileSync('D:/zhouyi-site/assets/app.css', 'utf8');
const js = readFileSync('D:/zhouyi-site/assets/app.js', 'utf8');
const html = readFileSync('D:/zhouyi-site/index.html', 'utf8');

const checks = [
  ['三视图（封面/目录/正文）', html.includes('id="coverView"') && html.includes('id="tocView"') && html.includes('id="articleView"')],
  ['hash 路由 #/ #/toc #/p/', js.includes("'#/p/'") && js.includes("'#/toc'") && js.includes('hashchange')],
  ['manifest.json 驱动目录', js.includes("getJSON('data/manifest.json')") && js.includes('M.meta.groups')],
  ['articles/{id}.html 片段', js.includes('articles/${id}.html')],
  ['search.json 全文搜索', js.includes("getJSON('data/search.json')")],
  ['本页目录 TOC', css.includes('.art-toc') && js.includes('buildToc')],
  ['阅读进度', css.includes('.read-progress') && js.includes('onScroll')],
  ['上一篇/下一篇', js.includes('function buildNav') && js.includes('byN(a.n - 1)')],
  ['明暗主题', css.includes('data-theme="dark"') && js.includes('toggleTheme')],
  ['卦象浮动面板', js.includes('renderPetPanel')],
  ['阅读位置记忆', js.includes("LS.set('last'")],
  ['响应式', css.includes('@media (max-width')],
  ['打印样式', css.includes('@media print')],
];

let pass = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  if (ok) pass++;
}
console.log(`\n  ${pass}/${checks.length} 项通过`);
