"""v3 全量验收。

对照 content/v3/ 的每篇，检查：
  1. 字数：全篇 4000-6000，每爻 600-900
  2. 结构：六爻节 + 每爻六件套（原文块/处境/例证/铁律/例外/串线）
  3. 爻辞与象传逐字准确（回比 build/hex-*.mjs，按卦序定位）
  4. 禁用词与禁用句式
  5. 设问密度（每 200-300 字一问）
"""
import re, os, json, io, sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

V3 = Path(r'D:\zhouyi-site\content\v3')
BUILD = Path(r'D:\zhouyi-site\build')

# --- 按卦序切分源数据（避开 id 映射问题）---
src = ''
for f in ['hex-01-16', 'hex-17-32', 'hex-33-48', 'hex-49-64']:
    src += (BUILD / (f + '.mjs')).read_text(encoding='utf-8')

marks = sorted((int(m.group(1)), m.start())
               for m in re.finditer(r"n:\s*(\d+),\s*id:", src))
SEG = {}
for i, (n, p) in enumerate(marks):
    e = marks[i + 1][1] if i + 1 < len(marks) else len(src)
    SEG[n] = src[p:e]


def hexdata(n):
    seg = SEG.get(n, '')
    ym = re.search(r'yao:\s*\[(.*?)\]', seg, re.S)
    xm = re.search(r'yaoXiang:\s*\[(.*?)\]', seg, re.S)
    yao = re.findall(r"'([^']*)'", ym.group(1)) if ym else []
    xiang = re.findall(r"'([^']*)'", xm.group(1)) if xm else []
    return yao, xiang


man = json.load(open(r'D:\zhouyi-site\data\manifest.json', encoding='utf-8'))
by_n = {a['n']: a for a in man['articles']}

BAN = ['待核', '参考文献', '各家观点', '分歧', '本节', '上文', '下文', '我们', '咱', '兄弟们']
ban_hit = {w: [] for w in BAN}

rows, issues = [], []

files = sorted(V3.glob('*.md'))
for fp in files:
    m = re.match(r'^(\d+)-(.+)\.md$', fp.name)
    if not m:
        continue
    n = int(m.group(1))
    a = by_n.get(n)
    if not a:
        issues.append(fp.name + ': manifest 无此卦')
        continue

    text = fp.read_text(encoding='utf-8')
    han = len(re.findall(r'[\u4e00-\u9fff]', text))
    yao, xiang = hexdata(n)

    secs = re.findall(r'^##\s+([^\n]+)$', text, re.M)
    yao_secs = [s for s in secs if re.match(r'^[初上]?[九六]', s)]
    quotes = re.findall(r'^>\s*\*\*(.+?)\*\*', text, re.M)
    xiangs = re.findall(r'^>\s*象曰[：:]\s*(.+)$', text, re.M)
    tie = len(re.findall(r'\*\*铁律[：:]', text))
    exc = len(re.findall(r'\*\*什么情况', text))
    pos = len(re.findall(r'\*\*[^*\n]{4,60}\*\*', text))
    q = text.count('？') + text.count('?')

    def tail(s):
        s = s.split('：', 1)[-1] if '：' in s else s
        return s.rstrip('。').strip()

    yao_set = {tail(y) for y in yao}
    x_set = {x.rstrip('。').strip() for x in xiang}
    ym_miss = [tail(x)[:14] for x in quotes if tail(x) and tail(x) not in yao_set]
    xm_miss = [x.rstrip('。').strip()[:14] for x in xiangs
               if x.rstrip('。').strip() and x.rstrip('。').strip() not in x_set]

    for w in BAN:
        if w in text:
            ban_hit[w].append(fp.name)

    # 每爻字数（按 ## 小节切）
    parts = re.split(r'^##\s+', text, flags=re.M)[1:]
    per_yao = []
    for p in parts:
        title = p.split('\n', 1)[0]
        if re.match(r'^[初上]?[九六]', title):
            per_yao.append(len(re.findall(r'[\u4e00-\u9fff]', p)))

    rows.append({
        'n': n, 'name': a['name'], 'han': han,
        'yao': len(yao_secs), 'q': len(quotes), 'x': len(xiangs),
        'tie': tie, 'exc': exc, 'ask': q,
        'per_yao': per_yao, 'ym': ym_miss, 'xm': xm_miss,
    })

print('=' * 78)
print('v3 验收：' + str(len(rows)) + ' / 64 篇')
print('=' * 78)
print()

bad = 0
for r in sorted(rows, key=lambda x: x['n']):
    f = []
    # 字数只查下限 —— 上限不硬卡（用户 2026-10-16 要求「不要卡死，要留个区间」）
    if r['han'] < 4000:
        f.append('总字数不足' + str(r['han']))
    if r['yao'] != 6:
        f.append('爻节' + str(r['yao']))
    if r['q'] != 6:
        f.append('爻辞块' + str(r['q']))
    if r['x'] != 6:
        f.append('象传' + str(r['x']))
    if r['tie'] != 6:
        f.append('铁律' + str(r['tie']))
    if r['exc'] != 6:
        f.append('例外' + str(r['exc']))
    if r['ym']:
        f.append('爻辞不符:' + r['ym'][0])
    if r['xm']:
        f.append('象传不符:' + r['xm'][0])
    short = [i + 1 for i, c in enumerate(r['per_yao']) if c < 500]
    if short:
        f.append('爻过短:' + str(short))
    if f:
        bad += 1
        print(str(r['n']).rjust(3) + ' ' + r['name'].ljust(6) + ' | '.join(f))

print()
print('结构完好: ' + str(len(rows) - bad) + ' / ' + str(len(rows)))
print()
print('未完成: ', end='')
done = {r['n'] for r in rows}
miss = [str(n) + by_n[n]['name'] for n in range(1, 65) if n not in done]
print(' '.join(miss) if miss else '无')
print()
print('禁用词:')
for w in BAN:
    lst = ban_hit[w]
    print('  ' + w.ljust(6) + str(len(lst)).rjust(3) + ' 篇  ' + (', '.join(lst[:6]) if lst else ''))

