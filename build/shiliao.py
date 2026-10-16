"""史事检索工具 —— 从一手正史里找素材。

给 64 卦写作用的取材工具。与 hexref.py（取注疏）互补：这个取史事。

用法：
    python shiliao.py 商鞅                    # 全库搜「商鞅」
    python shiliao.py 商鞅 --book 史記         # 只在史记里搜
    python shiliao.py 商鞅 --context 400      # 每处前后各取 400 字
    python shiliao.py --list                  # 列出所有书

注意：中文路径下 glob.glob() 会静默返回空，本脚本一律用 pathlib。
"""
import io, sys, argparse
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROOT = Path(r'F:\2026-08-05-原生家庭\历史综合书籍\_史料库')

BOOKS = {}          # 书名 -> 目录
for era in sorted(ROOT.iterdir()):
    if not era.is_dir() or era.name.startswith('__'):
        continue
    for b in sorted(era.iterdir()):
        if b.is_dir():
            BOOKS[b.name] = b


def search(needle, book=None, ctx=300, limit=8):
    """在史书里搜关键词，返回命中片段。"""
    targets = {book: BOOKS[book]} if book and book in BOOKS else BOOKS
    hits = []
    for name, d in targets.items():
        for f in sorted(d.rglob('*.txt')):
            try:
                t = f.read_text(encoding='utf-8', errors='ignore')
            except Exception:
                continue
            start = 0
            while len(hits) < limit * 6:
                i = t.find(needle, start)
                if i < 0:
                    break
                lo = max(0, i - ctx)
                hi = min(len(t), i + len(needle) + ctx)
                hits.append((name, f.relative_to(d).as_posix(), t[lo:hi].replace('\n', '')))
                start = i + len(needle)
                if len(hits) >= limit * 6:
                    break
            if len(hits) >= limit * 6:
                break
        if len(hits) >= limit * 6:
            break
    return hits[:limit]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('needle', nargs='?', help='要搜的人物/事件')
    ap.add_argument('--book', default='', help='限定书目，如 史記')
    ap.add_argument('--context', type=int, default=300, help='前后取字数')
    ap.add_argument('--limit', type=int, default=6, help='最多返回几处')
    ap.add_argument('--list', action='store_true', help='列出所有书')
    args = ap.parse_args()

    if args.list or not args.needle:
        print('史料库共 ' + str(len(BOOKS)) + ' 部：')
        print()
        for name, d in BOOKS.items():
            n = len(list(d.rglob('*.txt')))
            print('  ' + name.ljust(12) + str(n).rjust(4) + ' 卷')
        return

    hits = search(args.needle, args.book or None, args.context, args.limit)
    if not hits:
        print('未找到「' + args.needle + '」')
        return

    print('「' + args.needle + '」命中 ' + str(len(hits)) + ' 处：')
    print()
    for name, rel, snip in hits:
        print('=' * 70)
        print(name + ' / ' + rel)
        print('=' * 70)
        print(snip)
        print()


if __name__ == '__main__':
    main()
