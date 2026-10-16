"""v3 13-24 卦自查：字数 / 爻辞逐字 / 象传逐字 / 禁用词 / 设问密度。"""
import io, sys, json, re, argparse
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

DATA = json.load(open(r'D:\zhouyi-site\build\_hex13-24.json', encoding='utf-8'))
V3 = Path(r'D:\zhouyi-site\content\v3')

BAD_WORDS = ['待核', '声明', '注释', '各家观点', '分歧', '参考文献',
             '本节', '上文', '下文', '我们', '之所以', '咱', '兄弟们']

ap = argparse.ArgumentParser()
ap.add_argument('--n', type=int, default=0)
args = ap.parse_args()

nums = [args.n] if args.n else sorted(int(k) for k in DATA)
rows = []
for n in nums:
    d = DATA[str(n)]
    p = list(V3.glob(str(n).zfill(2) + '-*.md'))
    if not p:
        print(str(n).zfill(2), '!!! 文件不存在')
        continue
    p = p[0]
    t = p.read_text(encoding='utf-8')
    han = len(re.findall(r'[\u4e00-\u9fff]', t))
    problems = []

    if not (4000 <= han <= 6000):
        problems.append('字数 ' + str(han) + ' 超范围')

    for i, y in enumerate(d['yao'], 1):
        core = y.split('：', 1)[1].rstrip('。')
        if core not in t:
            problems.append('爻辞' + str(i) + '缺: ' + core)
    for i, y in enumerate(d['yaoXiang'], 1):
        if y not in t:
            problems.append('象传' + str(i) + '缺: ' + y)

    for b in BAD_WORDS:
        c = t.count(b)
        if c:
            problems.append('禁用词 ' + b + ' x' + str(c))
    for m in re.finditer('说明', t):
        lo = max(0, m.start() - 12)
        problems.append('「说明」出现: ...' + t[lo:m.start() + 14] + '...')

    tl = t.count('**铁律：')
    ex = t.count('**什么情况')
    q = t.count('？')
    print('%-10s 汉字 %-5d 设问 %-3d 铁律 %d 例外 %d  %s'
          % (p.name, han, q, tl, ex, 'OK' if not problems else '问题:'))
    for x in problems:
        print('        - ' + x)
    rows.append((p.name, han, q, tl, ex, len(problems)))

print()
print('合计汉字:', sum(r[1] for r in rows))
print('有问题的篇数:', sum(1 for r in rows if r[5]))
