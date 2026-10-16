"""检查史料库的完整性：每部书的卷号是否连续。

发现的问题：史记卷号从 091 跳到 093（缺 092 淮阴侯列传）。
这影响后续所有写作 —— 缺卷会导致反复取不到原文。
"""
import io, sys, re
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROOT = Path(r'F:\2026-08-05-原生家庭\历史综合书籍\_史料库')

def volnum(name):
    """从文件名提取卷号。处理 卷001.txt / 卷1.txt / 001.txt 等形态。"""
    m = re.search(r'(\d+)', name)
    return int(m.group(1)) if m else None

total_missing = 0
report = []

for era in sorted(ROOT.iterdir()):
    if not era.is_dir() or era.name.startswith('__'):
        continue
    for book in sorted(era.iterdir()):
        if not book.is_dir():
            continue
        files = [f for f in book.rglob('*.txt')]
        vols = {}
        for f in files:
            n = volnum(f.stem)
            if n is not None:
                vols.setdefault(n, f.name)
        if not vols:
            continue
        lo, hi = min(vols), max(vols)
        missing = [v for v in range(lo, hi + 1) if v not in vols]
        report.append({
            'era': era.name, 'book': book.name,
            'count': len(vols), 'lo': lo, 'hi': hi,
            'missing': missing,
        })
        total_missing += len(missing)

print('=' * 72)
print('史料库完整性检查')
print('=' * 72)
print()
print('部数: ' + str(len(report)))
print()

bad = [r for r in report if r['missing']]
if bad:
    print('⚠️  存在缺卷的书：')
    print()
    for r in bad:
        miss = r['missing']
        show = ', '.join(str(x) for x in miss[:14])
        if len(miss) > 14:
            show += ' … (共 ' + str(len(miss)) + ' 卷)'
        print('  ' + r['era'] + '/' + r['book'])
        print('     现有 ' + str(r['count']) + ' 卷，范围 ' + str(r['lo']) + '-' + str(r['hi']))
        print('     缺: ' + show)
        print()
else:
    print('✓ 全部书卷号连续，无缺卷')
print()
print('总缺卷数: ' + str(total_missing))
