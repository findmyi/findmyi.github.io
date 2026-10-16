"""独立复核：直接从 hex-*.mjs 取原文，逐字比对 13-24 的爻辞与象传，
并检查标题形制、加粗处境、铁律/例外配对。"""
import io, sys, re
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
BUILD = Path(r'D:\zhouyi-site\build')
V3 = Path(r'D:\zhouyi-site\content\v3')

txt = ''
for f in ['hex-01-16.mjs', 'hex-17-32.mjs']:
    txt += (BUILD / f).read_text(encoding='utf-8') + '\n'

DATA = {}
for b in re.split(r'\n  \{\n', txt):
    m = re.match(r"\s*n:\s*(\d+),\s*id:\s*'([^']+)',\s*name:\s*'([^']+)'", b)
    if not m:
        continue
    n = int(m.group(1))
    if not (13 <= n <= 24):
        continue

    def arr(key):
        mm = re.search(key + r':\s*\[(.*?)\n    \]', b, re.S)
        return re.findall(r"'([^']*)'", mm.group(1)) if mm else []

    DATA[n] = {'name': m.group(3), 'yao': arr('yao'), 'yaoXiang': arr('yaoXiang')}

total_err = 0
for n in sorted(DATA):
    d = DATA[n]
    p = list(V3.glob(str(n).zfill(2) + '-*.md'))[0]
    t = p.read_text(encoding='utf-8')
    errs = []

    # 1) 爻辞逐字
    for i, y in enumerate(d['yao'], 1):
        core = y.split('：', 1)[1].rstrip('。')
        if core not in t:
            errs.append('爻辞%d 缺: %s' % (i, core))
    # 2) 象传逐字
    for i, y in enumerate(d['yaoXiang'], 1):
        if y not in t:
            errs.append('象传%d 缺: %s' % (i, y))
    # 3) 标题形制
    if not re.search(r'^# .+卦 · ', t, re.M):
        errs.append('缺 H1 标题')
    # 4) 六爻小标题
    heads = re.findall(r'^## (.+)$', t, re.M)
    yao_heads = [h for h in heads if re.match(r'^(初|六|九|上)[九六二三四五]', h)]
    if len(yao_heads) != 6:
        errs.append('爻小标题 %d 个（应 6）' % len(yao_heads))
    # 5) 小标题含「—— 判词」
    for h in yao_heads:
        if '——' not in h:
            errs.append('小标题缺判词: ' + h)
    # 6) 引用块
    if t.count('> **') < 6:
        errs.append('原文引用块 < 6')
    if t.count('> 象曰：') < 6:
        errs.append('象曰行 < 6')
    # 7) 铁律 / 例外配对
    if t.count('**铁律：') != 6:
        errs.append('铁律 %d' % t.count('**铁律：'))
    if t.count('**什么情况') != 6:
        errs.append('例外 %d' % t.count('**什么情况'))
    # 8) 加粗处境块数
    bold = len(re.findall(r'^\*\*[^*]+\*\*$', t, re.M))
    if bold < 6:
        errs.append('加粗独立段仅 %d' % bold)
    # 9) 末节
    if '## 最后：' not in t:
        errs.append('缺「## 最后：」')

    total_err += len(errs)
    print('%-10s %s' % (p.name, 'OK' if not errs else '问题 ' + str(len(errs))))
    for e in errs:
        print('    - ' + e)

print()
print('总问题数:', total_err)
